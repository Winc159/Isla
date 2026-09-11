import { describe, expect, it } from "vitest";
import { Writable, Readable } from "node:stream";
import { parseProtocolRequest } from "../src/protocol/parser.js";
import { ProtocolWriter } from "../src/protocol/writer.js";
import { runProtocol } from "../src/protocol/runner.js";
import { ChatSession } from "../src/core/session.js";
import { FakeProvider } from "./support/fake-provider.js";
import type { ModelRequest, ModelResponse, ToolResponse } from "../src/core/types.js";

describe("NDJSON protocol", () => {
  it("parses valid requests and rejects invalid input", () => {
    expect(parseProtocolRequest('{"type":"prompt","id":"1","text":"你好"}')).toMatchObject({ type: "prompt" });
    expect(() => parseProtocolRequest("bad")).toThrow("INVALID_JSON");
    expect(() => parseProtocolRequest('{"type":"prompt","id":"1","text":""}')).toThrow("INVALID_REQUEST");
    expect(() => parseProtocolRequest('{"type":"approval_response","id":"1","approvalId":"","approved":true}')).toThrow("INVALID_REQUEST");
    expect(() => parseProtocolRequest('{"type":"approval_response","id":"1","approvalId":"a","approved":true,"remember":"yes"}')).toThrow("INVALID_REQUEST");
  });
  it("writes one JSON event per line", async () => {
    let output = "";
    const writer = new ProtocolWriter(new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } }));
    await writer.write({ type: "ready", provider: "fake", model: "fake-model" });
    expect(JSON.parse(output)).toEqual({ type: "ready", provider: "fake", model: "fake-model" });
  });
  it("runs a prompt and exits using only protocol events", async () => {
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    await runProtocol(Readable.from(['{"type":"prompt","id":"p1","text":"你好"}\n{"type":"exit","id":"e1"}\n']), out, new ChatSession(new FakeProvider([{ text: "你好" }])), "fake", "fake-model");
    const events = output.trim().split("\n").map(line => JSON.parse(line) as { type: string });
    expect(events.map(event => event.type)).toEqual(["ready", "response_start", "response_delta", "response_end", "bye"]);
    expect(JSON.parse(output.trim().split("\n")[3])).toMatchObject({ type: "response_end", elapsedMs: expect.any(Number) });
  });

  it("maps tool lifecycle callbacks to protocol events", async () => {
    class ToolProvider extends FakeProvider {
      private calls = 0;
      async generate(): Promise<ModelResponse> { return { text: '{"kind":"inspect","goal":"查看项目","needsHistory":false,"needsTools":true,"requiresUserConfirmation":false,"missingInformation":[]}' }; }
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
      { type: "tool_start", id: "p1", tool: "list_directory" },
      { type: "tool_end", id: "p1", tool: "list_directory", ok: true },
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

  it("resumes a write tool after an approval response", async () => {
    class WriteProvider extends FakeProvider {
      private calls = 0;
      async generate(): Promise<ModelResponse> {
        return { text: '{"kind":"execute","goal":"写入测试文件","needsHistory":false,"needsTools":true,"requiresUserConfirmation":false,"missingInformation":[]}' };
      }
      async generateWithTools(): Promise<ToolResponse> {
        this.calls += 1;
        return this.calls === 1
          ? { text: "", toolCalls: [{ id: "write-1", name: "write_text_file", arguments: JSON.stringify({ path: "approval-e2e.txt", content: "test" }) }] }
          : { text: "写入完成" };
      }
    }
    const input = Readable.from((async function* () {
      yield '{"type":"prompt","id":"p1","text":"写入测试文件"}\n';
      await new Promise(resolve => setTimeout(resolve, 20));
      yield '{"type":"prompt","id":"c1","text":"确认执行"}\n';
      await new Promise(resolve => setTimeout(resolve, 20));
      yield '{"type":"approval_response","id":"a1","approvalId":"approval-1","approved":true}\n';
      await new Promise(resolve => setTimeout(resolve, 20));
      yield '{"type":"exit","id":"e1"}\n';
    })());
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    await runProtocol(input, out, undefined, "fake", "fake-model", {
      createSession: (approval, events) => new ChatSession(new WriteProvider([]), {
        projectRoot: process.cwd(), enableTools: true, approvalPolicy: "ask", approvalService: approval,
        onToolStarted: events.onToolStarted, onToolFinished: events.onToolFinished,
      }),
    });
    const events = output.trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
    expect(events).toEqual(expect.arrayContaining([
      { type: "approval_request", id: "c1", approvalId: "approval-1", tool: "write_text_file", permission: "filesystem-write", summary: "Execute write_text_file" },
      { type: "tool_end", id: "c1", tool: "write_text_file", ok: true },
    ]));
    expect(events.some(event => event.type === "response_end" && event.id === "c1")).toBe(true);
  });

  it("ends with a rejected tool result when approval is denied", async () => {
    class RejectProvider extends FakeProvider {
      async generate(): Promise<ModelResponse> {
        return { text: '{"kind":"execute","goal":"写入测试文件","needsHistory":false,"needsTools":true,"requiresUserConfirmation":false,"missingInformation":[]}' };
      }
      async generateWithTools(): Promise<ToolResponse> {
        return { text: "", toolCalls: [{ id: "write-rejected", name: "write_text_file", arguments: JSON.stringify({ path: "approval-rejected.txt", content: "test" }) }] };
      }
    }
    const input = Readable.from((async function* () {
      yield '{"type":"prompt","id":"p1","text":"写入测试文件"}\n';
      await new Promise(resolve => setTimeout(resolve, 20));
      yield '{"type":"prompt","id":"c1","text":"确认执行"}\n';
      await new Promise(resolve => setTimeout(resolve, 20));
      yield '{"type":"approval_response","id":"a1","approvalId":"approval-1","approved":false}\n';
      await new Promise(resolve => setTimeout(resolve, 20));
      yield '{"type":"exit","id":"e1"}\n';
    })());
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    await runProtocol(input, out, undefined, "fake", "fake-model", {
      createSession: (approval, events) => new ChatSession(new RejectProvider([]), {
        projectRoot: process.cwd(), enableTools: true, approvalPolicy: "ask", approvalService: approval,
        onToolStarted: events.onToolStarted, onToolFinished: events.onToolFinished,
      }),
    });
    const events = output.trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
    expect(events).toEqual(expect.arrayContaining([
      { type: "tool_end", id: "c1", tool: "write_text_file", ok: false, code: "USER_REJECTED" },
    ]));
    expect(events.some(event => event.type === "response_end" && event.id === "c1")).toBe(true);
  });

  it("stops after repeated tool failures with a blocked response", async () => {
    class FailingProvider extends FakeProvider {
      async generate(): Promise<ModelResponse> {
        return { text: '{"kind":"execute","goal":"执行测试操作","needsHistory":false,"needsTools":true,"requiresUserConfirmation":false,"missingInformation":[]}' };
      }
      async generateWithTools(): Promise<ToolResponse> {
        return { text: "", toolCalls: [{ id: `unknown-${Date.now()}`, name: "missing_tool", arguments: "{}" }] };
      }
    }
    const input = Readable.from((async function* () {
      yield '{"type":"prompt","id":"p1","text":"执行测试操作"}\n';
      await new Promise(resolve => setTimeout(resolve, 20));
      yield '{"type":"prompt","id":"c1","text":"确认执行"}\n';
      await new Promise(resolve => setTimeout(resolve, 20));
      yield '{"type":"exit","id":"e1"}\n';
    })());
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    await runProtocol(input, out, undefined, "fake", "fake-model", {
      createSession: (_approval, events) => new ChatSession(new FailingProvider([]), {
        projectRoot: process.cwd(), enableTools: true,
        onToolStarted: events.onToolStarted, onToolFinished: events.onToolFinished,
      }),
    });
    const events = output.trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
    expect(events.filter(event => event.type === "tool_end")).toHaveLength(2);
    expect(events.some(event => event.type === "response_end" && event.id === "c1" && String(event.text).includes("连续失败"))).toBe(true);
  });
});
