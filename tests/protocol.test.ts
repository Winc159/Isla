import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PassThrough, Writable, Readable } from "node:stream";
import { parseProtocolRequest } from "../src/protocol/parser.js";
import { ProtocolWriter } from "../src/protocol/writer.js";
import { runProtocol } from "../src/protocol/runner.js";
import { ChatSession } from "../src/core/session.js";
import { FakeProvider } from "./support/fake-provider.js";
import type { ModelRequest, ModelResponse, ToolResponse } from "../src/core/types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUserInteractionCapability } from "../src/tools/user-interaction.js";

let protocolRoot: string;
beforeEach(async () => { protocolRoot = await mkdtemp(join(tmpdir(), "isla-protocol-")); });
afterEach(async () => { await rm(protocolRoot, { recursive: true, force: true }); });

async function waitForOutput(read: () => string, expected: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!read().includes(expected)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for protocol output: ${expected}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe("NDJSON protocol", () => {
  it("parses valid requests and rejects invalid input", () => {
    expect(parseProtocolRequest('{"type":"prompt","id":"1","text":"你好"}')).toMatchObject({ type: "prompt" });
    expect(parseProtocolRequest('{"type":"models_list","id":"m1","query":"qwen"}')).toMatchObject({ type: "models_list", query: "qwen" });
    expect(parseProtocolRequest('{"type":"models_use","id":"m2","model":"qwen-plus"}')).toMatchObject({ type: "models_use", model: "qwen-plus" });
    expect(() => parseProtocolRequest("bad")).toThrow("INVALID_JSON");
    expect(() => parseProtocolRequest('{"type":"prompt","id":"1","text":""}')).toThrow("INVALID_REQUEST");
    expect(() => parseProtocolRequest('{"type":"approval_response","id":"1","approvalId":"","approved":true}')).toThrow("INVALID_REQUEST");
    expect(() => parseProtocolRequest('{"type":"approval_response","id":"1","approvalId":"a","approved":true,"remember":"yes"}')).toThrow("INVALID_REQUEST");
  });
  it("writes one JSON event per line", async () => {
    let output = "";
    const writer = new ProtocolWriter(new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } }));
    writer.write({ type: "ready", provider: "fake", model: "fake-model" });
    await writer.flush();
    expect(JSON.parse(output)).toEqual({ type: "ready", provider: "fake", model: "fake-model" });
  });
  it("lists and switches models through NDJSON callbacks", async () => {
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    let selected = "";
    await runProtocol(Readable.from(['{"type":"models_list","id":"m1","query":"qwen"}\n{"type":"models_use","id":"m2","model":"qwen-plus"}\n{"type":"exit","id":"e1"}\n']), out, new ChatSession(new FakeProvider([])), "bailian", "qwen-plus", { listModels: async () => [{ id: "qwen-plus", capabilities: [], features: [] }], useModel: async model => { selected = model; } });
    const events = output.trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
    expect(events).toEqual(expect.arrayContaining([{ type: "models_list", id: "m1", models: [{ id: "qwen-plus", capabilities: [], features: [] }] }, { type: "model_changed", id: "m2", model: "qwen-plus", effective: "next_start" }]));
    expect(selected).toBe("qwen-plus");
  });
  it("writes provisional model step events without changing the response contract", async () => {
    let output = "";
    const writer = new ProtocolWriter(new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } }));
    writer.write({ type: "model_step_start", id: "p1", step: 1, attempt: 1 });
    writer.write({ type: "model_delta", id: "p1", step: 1, attempt: 1, text: "增量", provisional: true });
    writer.write({ type: "model_step_end", id: "p1", step: 1, attempt: 1, result: "candidate_yield" });
    await writer.flush();
    expect(output.trim().split("\n").map(line => JSON.parse(line))).toEqual([
      { type: "model_step_start", id: "p1", step: 1, attempt: 1 },
      { type: "model_delta", id: "p1", step: 1, attempt: 1, text: "增量", provisional: true },
      { type: "model_step_end", id: "p1", step: 1, attempt: 1, result: "candidate_yield" },
    ]);
  });
  it("flushes queued output before returning", async () => {
    let output = "";
    const writer = new ProtocolWriter(new Writable({ write(chunk, _encoding, callback) { setTimeout(() => { output += chunk.toString(); callback(); }, 10); } }));
    writer.write({ type: "ready", provider: "fake", model: "fake-model" });
    writer.write({ type: "bye", id: "exit" });
    await writer.flush();
    expect(output.trim().split("\n")).toHaveLength(2);
  });
  it("runs a prompt and exits using only protocol events", async () => {
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    await runProtocol(Readable.from(['{"type":"prompt","id":"p1","text":"你好"}\n{"type":"exit","id":"e1"}\n']), out, new ChatSession(new FakeProvider([{ text: "你好" }])), "fake", "fake-model");
    const events = output.trim().split("\n").map(line => JSON.parse(line) as { type: string });
    expect(events.map(event => event.type)).toEqual(["ready", "response_start", "response_end", "bye"]);
    expect(JSON.parse(output.trim().split("\n")[2])).toMatchObject({ type: "response_end", elapsedMs: expect.any(Number), verificationStatus: "not_applicable" });
  });
  it("forwards native model step events through NDJSON", async () => {
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    const provider = {
      id: "stream-fake", model: "stream-model", streamingEnabled: true,
      generate: async () => ({ text: "unused" }),
      generateStream: async function* () {
        yield { type: "text_delta", index: 0, delta: "流" } as const;
        yield { type: "finish", reason: "stop", model: "stream-model" } as const;
      },
    };
    await runProtocol(Readable.from(['{"type":"prompt","id":"p1","text":"你好"}\n{"type":"exit","id":"e1"}\n']), out, undefined, "stream-fake", "stream-model", {
      createSession: (_approval, events) => new ChatSession(provider, { onModelStepEvent: events.onModelStepEvent }),
    });
    const events = output.trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
    expect(events.map(event => event.type)).toEqual(["ready", "response_start", "model_step_start", "model_delta", "model_step_end", "response_end", "bye"]);
    expect(events[3]).toMatchObject({ type: "model_delta", id: "p1", text: "流", provisional: true });
  });
  it("reports an explicit and accurate capability snapshot in ready", async () => {
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    const capabilities = { toolCalling: true, cancellation: false, streaming: false } as const;
    await runProtocol(Readable.from(['{"type":"exit","id":"e1"}\n']), out, new ChatSession(new FakeProvider([])), "fake", "fake-model", { workspace: protocolRoot, capabilities });
    expect(JSON.parse(output.trim().split("\n")[0]!)).toEqual({ type: "ready", provider: "fake", model: "fake-model", workspace: protocolRoot, capabilities });
  });

  it("cancels an active prompt and emits one cancelled terminal event", async () => {
    const input = new PassThrough();
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    let started!: () => void;
    const providerStarted = new Promise<void>(resolve => { started = resolve; });
    const provider = { id: "fake", model: "fake-model", generate: async (_request: ModelRequest, options?: { signal?: AbortSignal }) => { started(); return await new Promise<ModelResponse>((_resolve, reject) => options?.signal?.addEventListener("abort", () => { const error = new Error("aborted"); error.name = "AbortError"; reject(error); }, { once: true })); } };
    const running = runProtocol(input, out, new ChatSession(provider), "fake", "fake-model", { capabilities: { toolCalling: false, cancellation: true, streaming: false } });
    input.write('{"type":"prompt","id":"p1","text":"等待"}\n');
    await providerStarted;
    input.write('{"type":"cancel","id":"c1","targetId":"p1"}\n');
    await new Promise(resolve => setTimeout(resolve, 10));
    input.end('{"type":"exit","id":"e1"}\n');
    await running;
    const events = output.trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
    expect(events).toEqual(expect.arrayContaining([{ type: "cancel_ack", id: "c1", targetId: "p1", accepted: true }, { type: "response_cancelled", id: "p1", elapsedMs: expect.any(Number) }]));
    expect(events.filter(event => event.type === "response_end" || event.type === "response_cancelled" || event.type === "error" && event.id === "p1")).toHaveLength(1);
  });

  it("projects only safe cited sources on response_end", async () => {
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    const session = { send: async () => ({ text: "依据", projectSources: [{ path: "docs/policy.md", startLine: 12 }] }) } as unknown as ChatSession;
    await runProtocol(Readable.from(['{"type":"prompt","id":"p1","text":"依据"}\n{"type":"exit","id":"e1"}\n']), out, session, "fake", "fake-model");
    const responseEnd = output.trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>).find(event => event.type === "response_end");
    expect(responseEnd).toMatchObject({ projectSources: [{ path: "docs/policy.md", startLine: 12 }] });
    expect(JSON.stringify(responseEnd)).not.toMatch(/project:v1|excerpt|query|[A-Fa-f0-9]{64}/);
  });

  it("maps tool lifecycle callbacks to protocol events", async () => {
    class ToolProvider extends FakeProvider {
      private calls = 0;
      async generateWithTools(_request: ModelRequest): Promise<ToolResponse> {
        this.calls += 1;
        return this.calls === 1
          ? { text: "", toolCalls: [{ id: "call-1", name: "list_directory", arguments: JSON.stringify({ path: "" }) }] }
          : { text: "检查完成" };
      }
    }
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    const provider = new ToolProvider([]);
    await runProtocol(Readable.from(['{"type":"prompt","id":"p1","text":"查看项目"}\n{"type":"exit","id":"e1"}\n']), out, undefined, "fake", "fake-model", {
      createSession: (_approval, events) => new ChatSession(provider, { projectRoot: process.cwd(), enableTools: true, onToolStarted: events.onToolStarted, onToolFinished: events.onToolFinished }),
    });
    const events = output.trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool_start", id: "p1", tool: "list_directory" }),
      expect.objectContaining({ type: "tool_end", id: "p1", tool: "list_directory", ok: true }),
    ]));
  });

  it("replaces the in-memory session on new_session", async () => {
    let created = 0;
    const provider = new FakeProvider([{ text: "first" }, { text: "second" }]);
    const input = Readable.from((async function* () {
      yield '{"type":"prompt","id":"p1","text":"第一轮"}\n';
      await new Promise(resolve => setTimeout(resolve, 10));
      yield '{"type":"new_session","id":"n1"}\n';
      yield '{"type":"prompt","id":"p2","text":"第二轮"}\n';
      await new Promise(resolve => setTimeout(resolve, 10));
      yield '{"type":"exit","id":"e1"}\n';
    })());
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    await runProtocol(input, out, undefined, "fake", "fake-model", {
      createSession: () => { created += 1; return new ChatSession(provider); },
    });
    const events = output.trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
    expect(created).toBe(2);
    expect(events).toEqual(expect.arrayContaining([{ type: "session_changed", id: "n1", sessionId: "n1" }]));
    expect(events.filter(event => event.type === "response_end")).toHaveLength(2);
  });

  it("does not expose raw prompt failure details on stdout", async () => {
    const provider = new FakeProvider([new Error("EPERM: secret-private-path")]);
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    await runProtocol(Readable.from(['{"type":"prompt","id":"p1","text":"你好"}\n{"type":"exit","id":"e1"}\n']), out, new ChatSession(provider), "fake", "fake-model");
    expect(output).not.toContain("secret-private-path");
    expect(output).toContain("PERSISTENCE_FAILED");
  });

  it("emits only error when a prompt fails, never an empty response_end", async () => {
    const provider = new FakeProvider([new Error("network unavailable")]);
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    await runProtocol(Readable.from(['{"type":"prompt","id":"p1","text":"你好"}\n{"type":"exit","id":"e1"}\n']), out, new ChatSession(provider), "fake", "fake-model");
    const events = output.trim().split("\n").map(line => JSON.parse(line) as { type: string; id?: string; code?: string; text?: string });
    expect(events.some(event => event.type === "error" && event.id === "p1" && event.code === "PROVIDER_NETWORK")).toBe(true);
    expect(events.some(event => event.type === "response_end" && event.id === "p1")).toBe(false);
  });

  it("resumes a write tool after an approval response", async () => {
    class WriteProvider extends FakeProvider {
      private calls = 0;
      async generate(): Promise<ModelResponse> {
        return { text: "unused" };
      }
      async generateWithTools(): Promise<ToolResponse> {
        this.calls += 1;
        return this.calls === 1
          ? { text: "", toolCalls: [{ id: "write-1", name: "write_text_file", arguments: JSON.stringify({ path: "approval-e2e.txt", content: "test" }) }] }
          : { text: "写入完成" };
      }
    }
    const input = new PassThrough();
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    const running = runProtocol(input, out, undefined, "fake", "fake-model", {
      createSession: (approval, events) => new ChatSession(new WriteProvider([]), {
        projectRoot: protocolRoot, enableTools: true, approvalPolicy: "ask", approvalService: approval,
        onToolStarted: events.onToolStarted, onToolFinished: events.onToolFinished,
      }),
    });
    input.write('{"type":"prompt","id":"p1","text":"写入测试文件"}\n');
    await waitForOutput(() => output, '"type":"approval_request"');
    input.end('{"type":"approval_response","id":"a1","approvalId":"approval-1","approved":true}\n{"type":"exit","id":"e1"}\n');
    await running;
    const events = output.trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
    expect(events).toEqual(expect.arrayContaining([
      { type: "approval_request", id: "p1", approvalId: "approval-1", tool: "write_text_file", permission: "filesystem-write", summary: "创建文本文件 approval-e2e.txt；4 个字符；内容预览：test" },
      { type: "tool_end", id: "p1", tool: "write_text_file", ok: true },
    ]));
    expect(events.some(event => event.type === "response_end" && event.id === "p1")).toBe(true);
  });

  it("pauses and resumes the same turn through question_request and question_response", async () => {
    class QuestionProvider extends FakeProvider {
      private calls = 0;
      async generate(): Promise<ModelResponse> { return { text: "unused" }; }
      async generateWithTools(): Promise<ToolResponse> {
        this.calls += 1;
        return this.calls === 1
          ? { text: "", toolCalls: [{ id: "question-call-1", name: "ask_user_question", arguments: JSON.stringify({ questions: [{ id: "mode", question: "Choose mode", options: [{ label: "Safe" }, { label: "Fast" }] }] }) }] }
          : { text: "已按 Safe 模式继续" };
      }
    }
    const input = new PassThrough();
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    const running = runProtocol(input, out, undefined, "fake", "fake-model", {
      createSession: (_approval, events, questions) => new ChatSession(new QuestionProvider([]), {
        enableTools: true,
        capabilities: [createUserInteractionCapability(questions)],
        onToolStarted: events.onToolStarted,
        onToolFinished: events.onToolFinished,
      }),
    });
    input.write('{"type":"prompt","id":"p1","text":"开始任务"}\n');
    await waitForOutput(() => output, '"type":"question_request"');
    input.end('{"type":"question_response","id":"q1","questionId":"question-1","answers":[{"id":"mode","selected":["Safe"]}]}\n{"type":"exit","id":"e1"}\n');
    await running;

    const events = output.trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "question_request", id: "p1", questionId: "question-1" }),
      { type: "tool_end", id: "p1", tool: "ask_user_question", ok: true },
    ]));
    expect(events.some(event => event.type === "response_end" && event.id === "p1" && event.text === "已按 Safe 模式继续")).toBe(true);
  });

  it("ends with a rejected tool result when approval is denied", async () => {
    class RejectProvider extends FakeProvider {
      async generate(): Promise<ModelResponse> {
        return { text: "unused" };
      }
      async generateWithTools(): Promise<ToolResponse> {
        return { text: "", toolCalls: [{ id: "write-rejected", name: "write_text_file", arguments: JSON.stringify({ path: "approval-rejected.txt", content: "test" }) }] };
      }
    }
    const input = new PassThrough();
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    const running = runProtocol(input, out, undefined, "fake", "fake-model", {
      createSession: (approval, events) => new ChatSession(new RejectProvider([]), {
        projectRoot: protocolRoot, enableTools: true, approvalPolicy: "ask", approvalService: approval,
        onToolStarted: events.onToolStarted, onToolFinished: events.onToolFinished,
      }),
    });
    input.write('{"type":"prompt","id":"p1","text":"写入测试文件"}\n');
    await waitForOutput(() => output, '"type":"approval_request"');
    input.end('{"type":"approval_response","id":"a1","approvalId":"approval-1","approved":false}\n{"type":"exit","id":"e1"}\n');
    await running;
    const events = output.trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
    expect(events).toEqual(expect.arrayContaining([
      { type: "tool_end", id: "p1", tool: "write_text_file", ok: false, code: "USER_REJECTED" },
    ]));
    expect(events.some(event => event.type === "response_end" && event.id === "p1")).toBe(true);
  });

  it("stops after repeated tool failures with a blocked response", async () => {
    class FailingProvider extends FakeProvider {
      async generate(): Promise<ModelResponse> {
        return { text: "unused" };
      }
      async generateWithTools(): Promise<ToolResponse> {
        return { text: "", toolCalls: [{ id: `unknown-${Date.now()}`, name: "missing_tool", arguments: "{}" }] };
      }
    }
    const input = Readable.from((async function* () {
      yield '{"type":"prompt","id":"p1","text":"执行测试操作"}\n';
      await new Promise(resolve => setTimeout(resolve, 20));
      yield '{"type":"exit","id":"e1"}\n';
    })());
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    await runProtocol(input, out, undefined, "fake", "fake-model", {
      createSession: (_approval, events) => new ChatSession(new FailingProvider([]), {
        projectRoot: protocolRoot, enableTools: true,
        onToolStarted: events.onToolStarted, onToolFinished: events.onToolFinished,
      }),
    });
    const events = output.trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
    expect(events.filter(event => event.type === "tool_end")).toHaveLength(2);
    expect(events.some(event => event.type === "response_end" && event.id === "p1" && String(event.text).includes("连续失败"))).toBe(true);
  });
});
