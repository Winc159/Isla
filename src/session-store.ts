import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Message } from "./core/types.js";
import type { ContextCheckpoint, SessionContext } from "./core/context.js";
import { validateSessionJournal, type SessionJournal } from "./core/journal.js";
import type { TaskBrief } from "./core/agent-loop.js";
import { migrateTaskBrief, type TaskStateV1 } from "./core/task-state.js";
import type { SkillCatalogEntry } from "./skills/types.js";

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
  readonly task?: TaskBrief;
  readonly journal: SessionJournal;
}

export interface StoredSessionV4 {
  readonly version: 4;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly workspaceKey: string;
  readonly messages: readonly Message[];
  readonly context?: SessionContext;
  readonly task?: TaskStateV1;
  readonly journal: SessionJournal;
}

export interface StoredSkillCatalogV1 {
  readonly version: 1;
  readonly entries: readonly Pick<SkillCatalogEntry, "name" | "description" | "modelInvocable" | "userInvocable">[];
}

export interface StoredSessionV5 extends Omit<StoredSessionV4, "version"> {
  readonly version: 5;
  readonly skillCatalog: StoredSkillCatalogV1;
}

export type StoredSession = StoredSessionV1 | StoredSessionV2 | StoredSessionV3 | StoredSessionV4 | StoredSessionV5;

export interface SessionState {
  readonly messages: readonly Message[];
  readonly context?: SessionContext;
  readonly journal?: SessionJournal;
  readonly task?: TaskBrief | TaskStateV1;
  readonly skillCatalog?: StoredSkillCatalogV1;
}

export interface SessionStore {
  list(provider: string, model: string): Promise<StoredSession[]>;
  listAll?: () => Promise<StoredSession[]>;
  loadLatest(provider: string, model: string, currentWorkspaceKey?: string): Promise<StoredSession | undefined>;
  create(provider: string, model: string, messages: readonly Message[], currentWorkspaceKey?: string): Promise<StoredSession>;
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

  async loadLatest(provider: string, model: string, currentWorkspaceKey?: string): Promise<StoredSession | undefined> {
    const sessions = await this.list(provider, model);
    return sessions.find(session => currentWorkspaceKey === undefined || ((session.version === 4 || session.version === 5) && session.workspaceKey === currentWorkspaceKey));
  }

  async listAll(): Promise<StoredSession[]> {
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory)).filter(file => file.endsWith(".json"));
    const sessions: StoredSession[] = [];
    for (const file of files) {
      try { sessions.push(parseSession(await readFile(join(this.directory, file), "utf8"))); }
      catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        this.onWarning(`Skipped invalid Isla session ${file}: ${message}`);
      }
    }
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async create(provider: string, model: string, messages: readonly Message[], currentWorkspaceKey?: string, skillCatalog?: StoredSkillCatalogV1): Promise<StoredSession> {
    const now = new Date().toISOString();
    const session: StoredSession = skillCatalog ? {
      version: 5,
      id: `${now.replaceAll(":", "-")}-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      provider,
      model,
      workspaceKey: currentWorkspaceKey ?? "legacy",
      messages: [...messages],
      skillCatalog,
      journal: emptyJournal(),
    } : {
      version: 4,
      id: `${now.replaceAll(":", "-")}-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      provider,
      model,
      workspaceKey: currentWorkspaceKey ?? "legacy",
      messages: [...messages],
      journal: emptyJournal(),
    };
    return this.write(session);
  }

  async save(session: StoredSession, state: SessionState): Promise<StoredSession> {
    const updatedAt = nextUpdatedAt(session.updatedAt);
    const next = {
      version: session.version === 5 || state.skillCatalog !== undefined ? 5 : 4,
      id: session.id,
      createdAt: session.createdAt,
      updatedAt,
      provider: session.provider,
      model: session.model,
      workspaceKey: session.version === 4 || session.version === 5 ? session.workspaceKey : "legacy",
      messages: [...state.messages],
      ...(state.context ? { context: state.context } : {}),
      ...(state.task ? { task: isTaskState(state.task) ? state.task : migrateTaskBrief(state.task, state.messages) } : {}),
      journal: state.journal ?? ('journal' in session ? session.journal : emptyJournal()),
      ...((session.version === 5 || state.skillCatalog !== undefined) ? { skillCatalog: state.skillCatalog ?? (session.version === 5 ? session.skillCatalog : { version: 1, entries: [] }) } : {}),
    } as StoredSessionV4 | StoredSessionV5;
    return this.write(next, session.updatedAt);
  }

  private async write(session: StoredSessionV4 | StoredSessionV5, expectedUpdatedAt?: string): Promise<StoredSessionV4 | StoredSessionV5> {
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
  if (value.version === 4) return {
    version: 4,
    id: value.id,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    provider: value.provider,
    model: value.model,
    workspaceKey: value.workspaceKey,
    messages: value.messages,
    ...(value.context ? { context: value.context } : {}),
    ...(value.task ? { task: value.task } : {}),
    journal: value.journal,
  };
  if (value.version === 5) return {
    version: 5,
    id: value.id,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    provider: value.provider,
    model: value.model,
    workspaceKey: value.workspaceKey,
    messages: value.messages,
    ...(value.context ? { context: value.context } : {}),
    ...(value.task ? { task: value.task } : {}),
    journal: value.journal,
    skillCatalog: value.skillCatalog,
  };
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
  return (session.version === 1 || session.version === 2 || session.version === 3 || session.version === 4 || session.version === 5)
    && typeof session.id === "string"
    && typeof session.createdAt === "string"
    && typeof session.updatedAt === "string"
    && typeof session.provider === "string"
    && typeof session.model === "string"
    && Array.isArray(session.messages)
    && session.messages.every(isMessage)
    && (session.version === 1 || session.context === undefined || isSessionContext(session.context))
    && (session.version !== 3 || session.task === undefined || isTaskBrief(session.task))
    && (session.version !== 4 && session.version !== 5 || (typeof session.workspaceKey === "string" && (session.task === undefined || isTaskState(session.task))))
    && (session.version !== 5 || isSkillCatalog(session.skillCatalog))
    && (session.version !== 3 && session.version !== 4 || isSessionJournal(session.journal));
}

function isTaskBrief(value: unknown): value is TaskBrief {
  if (!value || typeof value !== "object") return false;
  const task = value as Record<string, unknown>;
  return typeof task.goal === "string" && Array.isArray(task.confirmedConstraints)
    && Array.isArray(task.openQuestions) && Array.isArray(task.assumptions);
}

function isSkillCatalog(value: unknown): value is StoredSkillCatalogV1 {
  if (!value || typeof value !== "object") return false;
  const catalog = value as Record<string, unknown>;
  return catalog.version === 1 && Array.isArray(catalog.entries) && catalog.entries.every(entry => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    return typeof item.name === "string" && typeof item.description === "string" && typeof item.modelInvocable === "boolean" && typeof item.userInvocable === "boolean";
  });
}

function isTaskState(value: unknown): value is TaskStateV1 {
  if (!value || typeof value !== "object") return false;
  const task = value as Record<string, unknown>;
  return task.version === 1 && Number.isInteger(task.revision) && typeof task.goal === "string"
    && (task.status === "active" || task.status === "blocked" || task.status === "completed")
    && Array.isArray(task.constraints) && Array.isArray(task.assumptions) && Array.isArray(task.openQuestions)
    && Array.isArray(task.steps) && Array.isArray(task.blockers) && typeof task.updatedAt === "string";
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
    && typeof message.content === "string"
    && (message.source === undefined || isMessageSource(message.source));
}

function isMessageSource(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return source.kind === "skill-invocation" && source.scope === "turn"
    && typeof source.name === "string" && Boolean(source.name.trim())
    && Number.isInteger(source.userMessageIndex) && (source.userMessageIndex as number) >= 0;
}
