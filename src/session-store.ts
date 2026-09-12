import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Message } from "./core/types.js";
import type { ContextCheckpoint, SessionContext } from "./core/context.js";
import { validateSessionJournal, type SessionJournal } from "./core/journal.js";

export type { ContextCheckpoint, SessionContext } from "./core/context.js";

export interface StoredSessionV1 {
  readonly version: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly messages: readonly Message[];
  readonly journal?: SessionJournal;
}

export interface StoredSessionV2 {
  readonly version: 2;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly messages: readonly Message[];
  readonly context?: SessionContext;
  readonly journal?: SessionJournal;
}

export interface StoredSessionV3 {
  readonly version: 3;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly messages: readonly Message[];
  readonly context?: SessionContext;
  readonly journal: SessionJournal;
}

export type StoredSession = StoredSessionV1 | StoredSessionV2 | StoredSessionV3;

export interface SessionState {
  readonly messages: readonly Message[];
  readonly context?: SessionContext;
  readonly journal?: SessionJournal;
}

export interface SessionStore {
  list(provider: string, model: string): Promise<StoredSession[]>;
  loadLatest(provider: string, model: string): Promise<StoredSession | undefined>;
  create(provider: string, model: string, messages: readonly Message[]): Promise<StoredSession>;
  save(session: StoredSession, state: SessionState): Promise<StoredSession>;
}

export class JsonSessionStore implements SessionStore {
  constructor(
    private readonly directory = join(homedir(), ".isla", "sessions"),
    private readonly onWarning: (message: string) => void = message => process.stderr.write(`${message}\n`),
  ) {}

  async list(provider: string, model: string): Promise<StoredSession[]> {
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory)).filter(file => file.endsWith(".json"));
    const sessions: StoredSession[] = [];
    for (const file of files) {
      try {
        const session = parseSession(await readFile(join(this.directory, file), "utf8"));
        if (session.provider === provider && session.model === model) sessions.push(session);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        this.onWarning(`Skipped invalid Isla session ${file}: ${message}`);
      }
    }
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async loadLatest(provider: string, model: string): Promise<StoredSession | undefined> {
    return (await this.list(provider, model))[0];
  }

  async create(provider: string, model: string, messages: readonly Message[]): Promise<StoredSessionV3> {
    const now = new Date().toISOString();
    const session: StoredSession = {
      version: 3,
      id: `${now.replaceAll(":", "-")}-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      provider,
      model,
      messages: [...messages],
      journal: emptyJournal(),
    };
    return this.write(session);
  }

  async save(session: StoredSession, state: SessionState): Promise<StoredSessionV3> {
    const updatedAt = nextUpdatedAt(session.updatedAt);
    return this.write({
      version: 3,
      id: session.id,
      createdAt: session.createdAt,
      updatedAt,
      provider: session.provider,
      model: session.model,
      messages: [...state.messages],
      ...(state.context ? { context: state.context } : {}),
      journal: state.journal ?? ('journal' in session ? session.journal : emptyJournal()),
    }, session.updatedAt);
  }

  private async write(session: StoredSessionV3, expectedUpdatedAt?: string): Promise<StoredSessionV3> {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, `${session.id}.json`);
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    const lockPath = `${path}.lock`;
    const lock = await acquireLock(lockPath);
    try {
      if (expectedUpdatedAt !== undefined) {
        const current = parseSession(await readFile(path, "utf8"));
        if (current.updatedAt !== expectedUpdatedAt) {
          throw new Error(`Session ${session.id} was updated by another Isla process`);
        }
      }
      await writeFile(temporaryPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
      await rename(temporaryPath, path);
      return session;
    } finally {
      await unlink(temporaryPath).catch(() => {});
      try {
        await lock.close();
      } finally {
        await unlink(lockPath).catch(() => {});
      }
    }
  }
}

const staleLockMs = 30_000;

async function acquireLock(lockPath: string): Promise<FileHandle> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(String(process.pid), "utf8");
        return handle;
      } catch (error) {
        await handle.close();
        await unlink(lockPath).catch(() => {});
        throw error;
      }
    } catch (error) {
      if (!isLockConflict(lockPath, error)) throw lockError(lockPath, error);
      if (await isStaleLock(lockPath)) {
        await unlink(lockPath).catch(() => {});
      } else if (attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 25));
      } else {
        throw lockError(lockPath, error);
      }
    }
  }
  throw new Error(`Unable to lock Isla session ${lockPath}`);
}

async function isStaleLock(lockPath: string): Promise<boolean> {
  try {
    const pid = Number(await readFile(lockPath, "utf8"));
    if (Number.isInteger(pid) && pid > 0) return !isProcessRunning(pid);
    return Date.now() - (await stat(lockPath)).mtimeMs > staleLockMs;
  } catch {
    return false;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isFileExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST";
}

function isLockConflict(lockPath: string, error: unknown): boolean {
  if (isFileExistsError(error)) return true;
  return (error as NodeJS.ErrnoException).code === "EPERM" && existsSync(lockPath);
}

function lockError(lockPath: string, cause: unknown): Error {
  if (isFileExistsError(cause)) return new Error(`Isla session is being written by another process: ${lockPath}`);
  return cause instanceof Error ? cause : new Error("Unable to lock Isla session");
}

function nextUpdatedAt(previous: string): string {
  const now = Date.now();
  const previousTime = Date.parse(previous);
  return new Date(Number.isNaN(previousTime) ? now : Math.max(now, previousTime + 1)).toISOString();
}

export function parseStoredSession(source: string): StoredSession {
  const value: unknown = JSON.parse(source);
  if (!isStoredSession(value)) throw new Error("Invalid Isla session file");
  if (value.version === 1) {
    return {
      version: 1,
      id: value.id,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      provider: value.provider,
      model: value.model,
      messages: value.messages,
      journal: emptyJournal(),
    };
  }
  if (value.version === 2) return {
    version: 2,
    id: value.id,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    provider: value.provider,
    model: value.model,
    messages: value.messages,
    ...(value.context ? { context: value.context } : {}),
    journal: emptyJournal(),
  };
  validateSessionJournal(value.journal, value.messages);
  return {
    version: 3,
    id: value.id,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    provider: value.provider,
    model: value.model,
    messages: value.messages,
    ...(value.context ? { context: value.context } : {}),
    journal: value.journal,
  };
}

function parseSession(source: string): StoredSession { return parseStoredSession(source); }

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return (session.version === 1 || session.version === 2 || session.version === 3)
    && typeof session.id === "string"
    && typeof session.createdAt === "string"
    && typeof session.updatedAt === "string"
    && typeof session.provider === "string"
    && typeof session.model === "string"
    && Array.isArray(session.messages)
    && session.messages.every(isMessage)
    && (session.version === 1 || session.context === undefined || isSessionContext(session.context))
    && (session.version !== 3 || isSessionJournal(session.journal));
}

function emptyJournal(): SessionJournal { return { version: 1, turns: [] }; }

function isSessionJournal(value: unknown): value is SessionJournal {
  if (!value || typeof value !== "object") return false;
  const journal = value as Record<string, unknown>;
  return journal.version === 1 && Array.isArray(journal.turns);
}

function isSessionContext(value: unknown): value is SessionContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Record<string, unknown>;
  if (context.version !== 1) return false;
  if (context.checkpoint === undefined) return true;
  const checkpoint = context.checkpoint;
  if (!checkpoint || typeof checkpoint !== "object") return false;
  const record = checkpoint as Record<string, unknown>;
  return Number.isInteger(record.throughMessageIndex)
    && (record.throughMessageIndex as number) >= 0
    && typeof record.createdAt === "string"
    && typeof record.provider === "string"
    && typeof record.model === "string"
    && typeof record.content === "string";
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return (message.role === "system" || message.role === "user" || message.role === "assistant" || message.role === "tool")
    && typeof message.content === "string";
}
