import { createHash } from "node:crypto";
import type { ModelRequest } from "./types.js";
import type { ModelRequestSnapshot } from "./journal.js";

export function stableSerialize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function createRequestSnapshot(request: ModelRequest, provider: string, model: string, promptVersion = "v0", retrievedSourceIds: readonly string[] = []): ModelRequestSnapshot {
  const snapshot = {
    provider, model, promptVersion,
    messages: request.messages,
    ...(request.tools ? { tools: [...request.tools].sort((left, right) => left.name.localeCompare(right.name)) } : {}),
    ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
    retrievedSourceIds: [...retrievedSourceIds],
  };
  return { ...snapshot, requestHash: hash(snapshot) };
}

export function verifyRequestSnapshot(snapshot: ModelRequestSnapshot): boolean {
  const { requestHash: _, ...content } = snapshot;
  return hash(content) === snapshot.requestHash;
}

function hash(value: unknown): string { return createHash("sha256").update(stableSerialize(value)).digest("hex"); }

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortValue(item)]));
}
