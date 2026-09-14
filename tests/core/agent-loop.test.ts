import { describe, expect, it } from "vitest";
import { evaluateCompletionGate, parseTurnDecision, type StepResult } from "../../src/core/agent-loop.js";
import { ChatSession } from "../../src/core/session.js";
import type { ModelRequest, ModelResponse, ToolResponse } from "../../src/core/types.js";

describe("agent loop decision compatibility", () => {
  it("keeps parsing legacy decisions during migration", () => {
    const decision = parseTurnDecision(JSON.stringify({
      kind: "clarify",
      questions: ["计划几天？"],
      task: { goal: "项目", confirmedConstraints: [{ text: "用户事实", sourceMessageIndex: 0 }], openQuestions: ["天数"], assumptions: [] },
    }), [{ role: "user", content: "项目" }]);
    expect(decision.kind).toBe("clarify");
  });
});

describe("v0.2.7.4 step contract", () => {
  it("represents tool calls and user yield as the only step results", () => {
    const calls: StepResult = { kind: "capability_calls", calls: [{ id: "search-1", name: "web_search", arguments: '{"query":"current facts"}' }] };
    const yieldResult: StepResult = { kind: "yield", text: "已完成。" };
    expect(calls.kind).toBe("capability_calls");
    expect(yieldResult.kind).toBe("yield");
  });

  it("allows a first model step to expose tools before any decision", () => {
    const request: ModelRequest = { messages: [{ role: "user", content: "研究当前事实" }], tools: [{ name: "web_search", description: "Search", parameters: { type: "object" } }] };
    expect(request.tools?.map(tool => tool.name)).toEqual(["web_search"]);
  });

  it("rejects missing required evidence once and then blocks", () => {
    expect(evaluateCompletionGate({ requiredExternalEvidence: true, successfulExternalEvidence: false })).toMatchObject({ accepted: false, reason: "required_evidence_missing", observation: expect.stringContaining("completion_rejected") });
    expect(evaluateCompletionGate({ requiredExternalEvidence: true, successfulExternalEvidence: false, priorRejections: ["required_evidence_missing"] })).toMatchObject({ accepted: false, terminal: "blocked" });
    expect(evaluateCompletionGate({ requiredExternalEvidence: false, successfulExternalEvidence: false })).toEqual({ accepted: true });
  });
});

describe("agent loop", () => {
  it("starts with all tools and continues after a tool result", async () => {
    const requests: ModelRequest[] = [];
    let calls = 0;
    const provider = {
      id: "fake", model: "fake",
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        requests.push(request); calls += 1;
        return calls === 1
          ? { text: "中间过程", toolCalls: [{ id: "read-1", name: "read_text_file", arguments: JSON.stringify({ path: "README.md" }) }] }
          : { text: "读取完成" };
      },
    };
    const response = await new ChatSession(provider, { enableTools: true, agentLoop: true, projectRoot: process.cwd() }).send("读取项目说明");
    expect(response.text).toBe("读取完成");
    expect(requests[0]?.tools?.length).toBeGreaterThan(0);
    expect(requests[1]?.messages.at(-1)).toMatchObject({ role: "tool", toolCallId: "read-1" });
  });

  it("yields directly when the first tool-capable step has no tool call", async () => {
    let requests = 0;
    const provider = {
      id: "fake", model: "fake",
      async generateWithTools(_request: ModelRequest): Promise<ToolResponse> { requests += 1; return { text: "你好" }; },
    };
    await expect(new ChatSession(provider, { enableTools: true, agentLoop: true, projectRoot: process.cwd() }).send("你好")).resolves.toMatchObject({ text: "你好" });
    expect(requests).toBe(1);
  });

  it("does not let a legacy TaskBrief hide tools from the first step", async () => {
    let firstRequest: ModelRequest | undefined;
    const provider = {
      id: "fake", model: "fake",
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> { firstRequest = request; return { text: "继续处理" }; },
    };
    await new ChatSession(provider, {
      enableTools: true,
      agentLoop: true,
      projectRoot: process.cwd(),
      task: { goal: "继续任务", confirmedConstraints: [], openQuestions: ["旧问题"], assumptions: [], clarificationTurns: 1 },
    }).send("继续");
    expect(firstRequest?.tools?.length).toBeGreaterThan(0);
    expect(firstRequest?.messages.some(message => message.content.includes("继续任务"))).toBe(true);
  });
});
