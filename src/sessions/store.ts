import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Message } from "../core/types.js";
import type { ContextCheckpoint, SessionContext } from "../core/context.js";
import { validateSessionJournal, type SessionJournal } from "../core/journal.js";
import type { TaskBrief } from "../core/agent-loop.js";
import { migrateTaskBrief, type TaskStateV1 } from "../core/task-state.js";
import type { SkillCatalogEntry } from "../skills/types.js";
import type { CapabilityActivationStateV1 } from '../capabilities/routing.js';
import type { TaskContractV1 } from '../core/task-contract.js';
import type { WorkModeStateV1, WorkPlanV1 } from '../core/work-plan.js';
import { validateWorkPlan } from '../core/work-plan.js';

export type { ContextCheckpoint, SessionContext } from "../core/context.js";

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
  readonly capabilityActivation?: CapabilityActivationStateV1;
  readonly taskContract?: TaskContractV1;
}

export interface StoredSessionV6 extends Omit<StoredSessionV5, "version"> { readonly version: 6; readonly workPlan?: WorkPlanV1; readonly workMode?: WorkModeStateV1; }

export type StoredSession = StoredSessionV1 | StoredSessionV2 | StoredSessionV3 | StoredSessionV4 | StoredSessionV5 | StoredSessionV6;

export interface SessionState {
  readonly messages: readonly Message[];
  readonly context?: SessionContext;
  readonly journal?: SessionJournal;
  readonly task?: TaskBrief | TaskStateV1;
  readonly skillCatalog?: StoredSkillCatalogV1;
  readonly capabilityActivation?: CapabilityActivationStateV1;
  readonly workPlan?: WorkPlanV1;
  readonly workMode?: WorkModeStateV1;
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
    return sessions.find(session => currentWorkspaceKey === undefined || ((session.version === 4 || session.version === 5 || session.version === 6) && session.workspaceKey === currentWorkspaceKey));
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
      version: session.version >= 5 || state.skillCatalog !== undefined || state.workPlan !== undefined || state.workMode !== undefined ? 6 : 4,
      id: session.id,
      createdAt: session.createdAt,
      updatedAt,
      provider: session.provider,
      model: session.model,
      workspaceKey: session.version === 4 || session.version === 5 || session.version === 6 ? session.workspaceKey : "legacy",
      messages: [...state.messages],
      ...(state.context ? { context: state.context } : {}),
      ...(state.task ? { task: isTaskState(state.task) ? state.task : migrateTaskBrief(state.task, state.messages) } : {}),
      ...('taskContract' in state && state.taskContract ? { taskContract: state.taskContract } : {}),
      journal: state.journal ?? ('journal' in session ? session.journal : emptyJournal()),
      ...((session.version === 5 || session.version === 6 || state.skillCatalog !== undefined) ? { skillCatalog: state.skillCatalog ?? (session.version === 5 || session.version === 6 ? session.skillCatalog : { version: 1, entries: [] }) } : {}),
      ...(state.capabilityActivation ? { capabilityActivation: state.capabilityActivation } : ((session.version === 5 || session.version === 6) && session.capabilityActivation ? { capabilityActivation: session.capabilityActivation } : {})),
      ...('workPlan' in state && state.workPlan ? { workPlan: state.workPlan } : ('workPlan' in session && session.workPlan ? { workPlan: session.workPlan } : {})),
      ...('workMode' in state && state.workMode ? { workMode: state.workMode } : ('workMode' in session && session.workMode ? { workMode: session.workMode } : {})),
    } as StoredSessionV4 | StoredSessionV5 | StoredSessionV6;
    return this.write(next, session.updatedAt);
  }

  private async write(session: StoredSessionV4 | StoredSessionV5 | StoredSessionV6, expectedUpdatedAt?: string): Promise<StoredSessionV4 | StoredSessionV5 | StoredSessionV6> {
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
        await lock.release();
      }
    }
  }
}

const staleLockMs = 30_000;

interface SessionLock {
  readonly close: () => Promise<void>;
  readonly release: () => Promise<void>;
}

async function acquireLock(lockPath: string): Promise<SessionLock> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(String(process.pid), "utf8");
        return { close: () => handle.close(), release: () => unlink(lockPath).catch(() => {}) };
      } catch (error) {
        await handle.close();
        await unlink(lockPath).catch(() => {});
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM" && !existsSync(lockPath)) {
        return acquireDirectoryLock(lockPath);
      }
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

async function acquireDirectoryLock(lockPath: string): Promise<SessionLock> {
  const directory = `${lockPath}.d`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await mkdir(directory);
      await writeFile(`${directory}/owner`, String(process.pid), "utf8");
      return {
        close: async () => {},
        release: async () => { await unlink(`${directory}/owner`).catch(() => {}); await import("node:fs/promises").then(fs => fs.rmdir(directory)).catch(() => {}); },
      };
    } catch (error) {
      if (!isFileExistsError(error)) throw lockError(directory, error);
      if (await isStaleLock(`${directory}/owner`)) {
        await unlink(`${directory}/owner`).catch(() => {});
        await import("node:fs/promises").then(fs => fs.rmdir(directory)).catch(() => {});
      } else if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 25));
      else throw lockError(directory, error);
    }
  }
  throw new Error(`Unable to lock Isla session ${directory}`);
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
  const journal = recoverInterruptedJournal(value.journal);
  validateSessionJournal(journal, value.messages);
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
    journal,
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
    journal,
    skillCatalog: value.skillCatalog,
    ...(value.taskContract ? { taskContract: value.taskContract } : {}),
    ...(value.capabilityActivation ? { capabilityActivation: value.capabilityActivation } : {}),
  };
  if (value.version === 6) return { ...value, journal };
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
  return (session.version === 1 || session.version === 2 || session.version === 3 || session.version === 4 || session.version === 5 || session.version === 6)
    && typeof session.id === "string"
    && typeof session.createdAt === "string"
    && typeof session.updatedAt === "string"
    && typeof session.provider === "string"
    && typeof session.model === "string"
    && Array.isArray(session.messages)
    && session.messages.every(isMessage)
    && (session.version === 1 || session.context === undefined || isSessionContext(session.context))
    && (session.version !== 3 || session.task === undefined || isTaskBrief(session.task))
    && (session.version < 4 || (typeof session.workspaceKey === "string" && (session.task === undefined || isTaskState(session.task))))
    && (session.version !== 5 && session.version !== 6 || isSkillCatalog(session.skillCatalog))
    && (session.version !== 5 && session.version !== 6 || session.capabilityActivation === undefined || isCapabilityActivation(session.capabilityActivation))
    && (session.version !== 6 || isOptionalPlanAndMode(session))
    && (session.version !== 3 && session.version !== 4 || isSessionJournal(session.journal));
}

function isOptionalPlanAndMode(session: Record<string, unknown>): boolean {
  if (session.workPlan !== undefined) { try { validateWorkPlan(session.workPlan); } catch { return false; } }
  if (session.workMode !== undefined) { const mode = session.workMode as Record<string, unknown>; if (!mode || mode.version !== 1 || !['plan','act','review'].includes(String(mode.mode)) || !Number.isInteger(mode.revision) || typeof mode.updatedAt !== 'string') return false; }
  return true;
}

function isTaskBrief(value: unknown): value is TaskBrief {
  if (!value || typeof value !== "object") return false;
  const task = value as Record<string, unknown>;
  return typeof task.goal === "string" && Array.isArray(task.confirmedConstraints)
    && Array.isArray(task.openQuestions) && Array.isArray(task.assumptions);
}

function recoverInterruptedJournal(journal: SessionJournal): SessionJournal {
  const now = new Date().toISOString();
  let changed = false;
  const turns = journal.turns.map(turn => {
    if (turn.status !== 'running') return turn;
    changed = true;
    return { ...turn, status: 'interrupted' as const, endedAt: turn.endedAt ?? now, error: { code: 'INTERRUPTED' as const, recoverable: true, message: '进程在本回合完成前退出；已在启动时恢复为可继续状态。' } };
  });
  return changed ? { ...journal, turns } : journal;
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

function isCapabilityActivation(value: unknown): value is CapabilityActivationStateV1 {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return state.version === 1 && Array.isArray(state.task) && state.task.every(item => {
    if (!item || typeof item !== 'object') return false;
    const entry = item as Record<string, unknown>;
    return typeof entry.id === 'string' && Number.isInteger(entry.activatedAtTurn) && Number.isInteger(entry.lastUsedAtTurn)
      && (entry.reason === 'runtime' || entry.reason === 'model' || entry.reason === 'user');
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
