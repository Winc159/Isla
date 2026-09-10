import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { ChatSession } from "../core/session.js";
import { parseProtocolRequest } from "./parser.js";
import { ProtocolWriter } from "./writer.js";
import { ProtocolApprovalService } from "./approval.js";
export async function runProtocol(input: Readable, output: import("node:stream").Writable, session: ChatSession, provider: string, model: string, options: { readonly onNewSession?: () => void; readonly onToolStarted?: (id: string, tool: string) => void; readonly onToolFinished?: (id: string, tool: string) => void } = {}): Promise<void> {
  const writer = new ProtocolWriter(output);
  writer.write({ type: "ready", provider, model });
  const ids = new Set<string>();
  const rl = createInterface({ input, crlfDelay: Infinity });
  const iterator = rl[Symbol.asyncIterator]();
  const nextRequest = async () => { const next = await iterator.next(); if (next.done) throw new Error("INPUT_EOF"); return parseProtocolRequest(next.value); };
  for await (const line of rl) {
    if (!line.trim()) continue;
    let request;
    try { request = parseProtocolRequest(line); } catch (error) { writer.write({ type: "error", code: String(error instanceof Error ? error.message : error), message: "请求格式无效", recoverable: true }); continue; }
    if (ids.has(request.id)) { writer.write({ type: "error", id: request.id, code: "DUPLICATE_ID", message: "请求 id 已使用", recoverable: false }); continue; }
    ids.add(request.id);
    if (request.type === "exit") { writer.write({ type: "bye", id: request.id }); break; }
    if (request.type === "new_session") { options.onNewSession?.(); writer.write({ type: "session_changed", id: request.id, sessionId: request.id }); continue; }
    if (request.type === "approval_response") { writer.write({ type: "error", id: request.id, code: "UNEXPECTED_APPROVAL", message: "当前没有等待中的审批", recoverable: true }); continue; }
    if (request.type !== "prompt") continue;
    writer.write({ type: "response_start", id: request.id });
    try {
      const response = await session.sendStream(request.text, text => writer.write({ type: "response_delta", id: request.id, text }));
      writer.write({ type: "response_end", id: request.id, text: response.text });
    } catch (error) {
      writer.write({ type: "error", id: request.id, code: "PROMPT_FAILED", message: error instanceof Error ? error.message : String(error), recoverable: true });
    }
  }
}
