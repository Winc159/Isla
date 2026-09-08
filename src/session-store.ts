import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Message } from "./core/types.js";

export interface StoredSession {
  readonly version: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly messages: readonly Message[];
}

export interface SessionStore {
  loadLatest(provider: string, model: string): Promise<StoredSession | undefined>;
  create(provider: string, model: string, messages: readonly Message[]): Promise<StoredSession>;
  save(session: StoredSession, messages: readonly Message[]): Promise<StoredSession>;
}

export class JsonSessionStore implements SessionStore {
  constructor(private readonly directory = join(homedir(), ".isla", "sessions")) {}

  async loadLatest(provider: string, model: string): Promise<StoredSession | undefined> {
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory))
      .filter(file => file.endsWith(".json"))
      .sort()
      .reverse();
    for (const file of files) {
      const session = parseSession(await readFile(join(this.directory, file), "utf8"));
      if (session.provider === provider && session.model === model) return session;
    }
    return undefined;
  }

  async create(provider: string, model: string, messages: readonly Message[]): Promise<StoredSession> {
    const now = new Date().toISOString();
    const session: StoredSession = {
      version: 1,
      id: `${now.replaceAll(":", "-")}-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      provider,
      model,
      messages: [...messages],
    };
    return this.write(session);
  }

  async save(session: StoredSession, messages: readonly Message[]): Promise<StoredSession> {
    return this.write({ ...session, updatedAt: new Date().toISOString(), messages: [...messages] });
  }

  private async write(session: StoredSession): Promise<StoredSession> {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, `${session.id}.json`);
    const temporaryPath = `${path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
    return session;
  }
}

function parseSession(source: string): StoredSession {
  const value: unknown = JSON.parse(source);
  if (!isStoredSession(value)) throw new Error("Invalid Isla session file");
  return value;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return session.version === 1
    && typeof session.id === "string"
    && typeof session.createdAt === "string"
    && typeof session.updatedAt === "string"
    && typeof session.provider === "string"
    && typeof session.model === "string"
    && Array.isArray(session.messages)
    && session.messages.every(isMessage);
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return (message.role === "system" || message.role === "user" || message.role === "assistant")
    && typeof message.content === "string";
}
