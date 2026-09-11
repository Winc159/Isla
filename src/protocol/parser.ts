import type { ProtocolRequest } from "./types.js";
export function parseProtocolRequest(line: string): ProtocolRequest {
  let value: unknown;
  try { value = JSON.parse(line); } catch { throw new Error("INVALID_JSON"); }
  if (!value || typeof value !== "object") throw new Error("INVALID_REQUEST");
  const item = value as Record<string, unknown>;
  if (typeof item.type !== "string" || typeof item.id !== "string" || !item.id.trim()) throw new Error("INVALID_REQUEST");
  if (item.type === "prompt" && typeof item.text === "string" && item.text.trim()) return item as ProtocolRequest;
  if (item.type === "approval_response" && typeof item.approvalId === "string" && item.approvalId.trim() && typeof item.approved === "boolean" && (item.remember === undefined || typeof item.remember === "boolean")) return item as ProtocolRequest;
  if (item.type === "new_session" || item.type === "exit") return item as ProtocolRequest;
  throw new Error("INVALID_REQUEST");
}
