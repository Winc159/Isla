import type { SafeErrorRecord } from "./errors.js";
import { RuntimeError } from "./errors.js";
import type { ModelResponse, TokenUsage, ToolCall, ToolResponse } from "./types.js";

export type ModelStreamEvent =
  | { readonly type: "text_delta"; readonly index: number; readonly delta: string }
  | { readonly type: "tool_call_delta"; readonly index: number; readonly id?: string; readonly name?: string; readonly argumentsDelta: string }
  | { readonly type: "usage"; readonly usage: TokenUsage }
  | { readonly type: "finish"; readonly reason: "stop" | "tool_calls" | "max_tokens" | "failed" | "cancelled"; readonly model?: string; readonly error?: SafeErrorRecord };

interface PartialToolCall {
  id?: string;
  name?: string;
  arguments: string;
}

export interface AssembledModelStream {
  readonly response: ToolResponse;
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  readonly usage?: TokenUsage;
}

/** 将 Provider 原生事件收敛为一个完整、可执行的模型 Step。 */
export class ModelStreamAssembler {
  private readonly textParts: string[] = [];
  private readonly toolCalls = new Map<number, PartialToolCall>();
  private usage: TokenUsage | undefined;
  private model: string | undefined;
  private finished = false;

  add(event: ModelStreamEvent): void {
    if (this.finished) throw protocolError("模型流在 finish 后仍产生事件。");
    if (event.type === "text_delta") {
      if (!Number.isInteger(event.index) || event.index < 0) throw protocolError("文本增量 index 无效。");
      this.textParts.push(event.delta);
      return;
    }
    if (event.type === "tool_call_delta") {
      if (!Number.isInteger(event.index) || event.index < 0) throw protocolError("Tool Call index 无效。");
      const current = this.toolCalls.get(event.index) ?? { arguments: "" };
      if (event.id !== undefined) {
        if (current.id !== undefined && current.id !== event.id) throw protocolError(`Tool Call ${event.index} 的 id 不一致。`);
        current.id = event.id;
      }
      if (event.name !== undefined) {
        if (current.name !== undefined && current.name !== event.name) throw protocolError(`Tool Call ${event.index} 的名称不一致。`);
        current.name = event.name;
      }
      current.arguments += event.argumentsDelta;
      this.toolCalls.set(event.index, current);
      return;
    }
    if (event.type === "usage") {
      this.usage = event.usage;
      return;
    }
    this.finished = true;
    this.model = event.model;
    if (event.reason !== "stop" && event.reason !== "tool_calls") {
      throw new RuntimeError(event.error ?? { code: event.reason === "cancelled" ? "TURN_CANCELLED" : "PROVIDER_INVALID_RESPONSE", recoverable: false, message: event.reason === "cancelled" ? "当前回合已取消。" : "模型流未正常完成。" });
    }
  }

  finish(): AssembledModelStream {
    if (!this.finished) throw protocolError("模型流缺少 finish 终态。");
    const calls: ToolCall[] = [];
    for (const [index, partial] of [...this.toolCalls.entries()].sort(([a], [b]) => a - b)) {
      if (!partial.id || !partial.name || !partial.arguments.trim()) throw protocolError(`Tool Call ${index} 未完整组装。`);
      calls.push({ id: partial.id, name: partial.name, arguments: partial.arguments });
    }
    const text = this.textParts.join("");
    const response: ToolResponse = { text, ...(calls.length ? { toolCalls: calls } : {}), ...(this.usage ? { usage: this.usage } : {}), ...(this.model ? { model: this.model } : {}) };
    return { response, text, toolCalls: calls, ...(this.usage ? { usage: this.usage } : {}) };
  }
}

function protocolError(message: string): RuntimeError {
  return new RuntimeError({ code: "PROVIDER_INVALID_RESPONSE", recoverable: false, message });
}
