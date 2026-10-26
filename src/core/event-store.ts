import { mkdir, readFile, open, truncate } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createSessionEvent, isSessionEventV1, type SessionEventV1 } from './session-event-v1.js';
import type { SessionEvent } from './events.js';

export interface EventCursor { readonly sessionId: string; readonly sequence: number; }
export class FileEventStore {
  private readonly tails = new Map<string, number>();
  private readonly writes = new Map<string, Promise<void>>();
  constructor(private readonly directory: string) {}
  async append(sessionId: string, event: SessionEvent): Promise<SessionEventV1> {
    const previous = this.writes.get(sessionId) ?? Promise.resolve();
    let created!: SessionEventV1;
    const next = previous.then(async () => {
      const events = await this.read(sessionId);
      const sequence = Math.max(this.tails.get(sessionId) ?? 0, events.at(-1)?.sequence ?? 0) + 1;
      created = createSessionEvent(sessionId, sequence, event);
      await mkdir(this.directory, { recursive: true });
      const handle = await open(this.path(sessionId), 'a');
      try { await handle.writeFile(`${JSON.stringify(created)}\n`, 'utf8'); } finally { await handle.close(); }
      this.tails.set(sessionId, sequence);
    });
    this.writes.set(sessionId, next);
    await next;
    if (this.writes.get(sessionId) === next) this.writes.delete(sessionId);
    return created;
  }
  async read(sessionId: string, afterSequence = 0): Promise<SessionEventV1[]> {
    const path = this.path(sessionId);
    let source: string;
    try { source = await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const lines = source.split('\n'); const events: SessionEventV1[] = []; let validBytes = 0;
    for (const line of lines) {
      if (!line.trim()) { validBytes += Buffer.byteLength(line + '\n'); continue; }
      try { const value: unknown = JSON.parse(line); if (!isSessionEventV1(value) || value.sessionId !== sessionId) throw new Error('invalid'); events.push(value); validBytes += Buffer.byteLength(line + '\n'); }
      catch { await truncate(path, validBytes); break; }
    }
    return events.filter(event => event.sequence > afterSequence);
  }
  async cursor(sessionId: string): Promise<EventCursor> { const events = await this.read(sessionId); return { sessionId, sequence: events.at(-1)?.sequence ?? 0 }; }
  private path(sessionId: string): string { return join(this.directory, `${encodeURIComponent(sessionId)}.jsonl`); }
}
