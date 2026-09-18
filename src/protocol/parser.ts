import type { ProtocolRequest } from "./types.js";
export function parseProtocolRequest(line: string): ProtocolRequest {
  let value: unknown;
  try { value = JSON.parse(line); } catch { throw new Error("INVALID_JSON"); }
  if (!value || typeof value !== "object") throw new Error("INVALID_REQUEST");
  const item = value as Record<string, unknown>;
  if (typeof item.type !== "string" || typeof item.id !== "string" || !item.id.trim()) throw new Error("INVALID_REQUEST");
  if (item.type === "prompt" && typeof item.text === "string" && item.text.trim()) return item as ProtocolRequest;
  if (item.type === "approval_response" && typeof item.approvalId === "string" && item.approvalId.trim() && typeof item.approved === "boolean" && (item.remember === undefined || typeof item.remember === "boolean")) return item as ProtocolRequest;
  if (item.type === "question_response" && typeof item.questionId === "string" && item.questionId.trim() && validQuestionAnswers(item.answers)) return item as ProtocolRequest;
  if (item.type === "cancel" && typeof item.targetId === "string" && item.targetId.trim()) return item as ProtocolRequest;
  if (item.type === "new_session" || item.type === "exit") return item as ProtocolRequest;
  if (item.type === "models_list" && (item.query === undefined || typeof item.query === "string")) return item as ProtocolRequest;
  if (item.type === "models_use" && typeof item.model === "string" && item.model.trim()) return item as ProtocolRequest;
  if (item.type === "task_get" || item.type === "sessions_list") return item as ProtocolRequest;
  if (item.type === "sessions_search" && (item.query === undefined || typeof item.query === "string") && (item.status === undefined || item.status === "active" || item.status === "blocked" || item.status === "completed")) return item as ProtocolRequest;
  if (item.type === "session_select" && typeof item.sessionId === "string" && item.sessionId.trim()) return item as ProtocolRequest;
  throw new Error("INVALID_REQUEST");
}

function validQuestionAnswers(value: unknown): boolean {
  return Array.isArray(value) && value.every(answer => {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) return false;
    const item = answer as Record<string, unknown>;
    return typeof item.id === "string" && Boolean(item.id.trim())
      && Array.isArray(item.selected) && item.selected.every(label => typeof label === "string")
      && (item.custom === undefined || typeof item.custom === "string");
  });
}
