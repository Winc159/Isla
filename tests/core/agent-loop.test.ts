import { describe, expect, it } from "vitest";
import { parseTurnDecision } from "../../src/core/agent-loop.js";
import { ChatSession } from "../../src/core/session.js";
import type { ModelRequest, ModelResponse, ToolResponse } from "../../src/core/types.js";

describe("agent loop decision", () => {
  it("parses a clarification and validates its user source", () => {
    const decision = parseTurnDecision(JSON.stringify({
      kind: "clarify",
      questions: ["计划几天？"],
      task: { goal: "自驾游", confirmedConstraints: [{ text: "从重庆取车", sourceMessageIndex: 0 }], openQuestions: ["天数"], assumptions: [] },
    }), [{ role: "user", content: "从重庆取车自驾游" }]);
    expect(decision.kind).toBe("clarify");
    expect(decision.task.confirmedConstraints[0]?.sourceMessageIndex).toBe(0);
    expect(() => parseTurnDecision(JSON.stringify({ kind: "execute", objective: "查证", task: { goal: "x", confirmedConstraints: [{ text: "假的", sourceMessageIndex: 1 }], openQuestions: [], assumptions: [] } }), [{ role: "user", content: "x" }])).toThrow();
    expect(parseTurnDecision("```json\n" + JSON.stringify({ kind: "clarify", questions: ["日期？"], task: { goal: "旅行", confirmedConstraints: [], openQuestions: ["日期"], assumptions: [] } }) + "\n```", [{ role: "user", content: "旅行" }]).kind).toBe("clarify");
  });
});

describe("agent loop", () => {
  it("gates tools and synthesizes after execution", async () => {
    class Provider {
      readonly id = "fake"; readonly model = "fake"; readonly requests: ModelRequest[] = []; private calls = 0;
      async generate(request: ModelRequest): Promise<ModelResponse> {
        this.requests.push(request); this.calls += 1;
        if (this.calls === 1) return { text: JSON.stringify({ kind: "execute", objective: "查证并规划", task: { goal: "规划", confirmedConstraints: [{ text: "重庆取车", sourceMessageIndex: 0 }], openQuestions: [], assumptions: [] } }) };
        return { text: "完整综合方案" };
      }
      private toolCalls = 0;
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        this.requests.push(request);
        this.toolCalls += 1;
        if (this.toolCalls > 1) return { text: "证据已收集" };
        return { text: "", toolCalls: [{ id: "1", name: "read_text_file", arguments: JSON.stringify({ path: "README.md" }) }] };
      }
    }
    const provider = new Provider();
    const session = new ChatSession(provider, { enableTools: true, agentLoop: true, projectRoot: process.cwd() });
    const response = await session.send("重庆取车");
    expect(response.text).toBe("完整综合方案");
    expect(provider.requests[0]?.tools).toBeUndefined();
    expect(provider.requests[1]?.tools?.length).toBeGreaterThan(0);
    expect(provider.requests[2]?.tools?.length).toBeGreaterThan(0);
    expect(provider.requests[3]?.tools).toBeUndefined();
  });

  it("persists the current task brief when clarification is needed", async () => {
    const states: Array<{ task?: unknown; messages: readonly unknown[] }> = [];
    const provider = {
      id: "fake", model: "fake",
      async generate(): Promise<ModelResponse> {
        return { text: JSON.stringify({ kind: "clarify", questions: ["计划几天？"], task: { goal: "重庆自驾", confirmedConstraints: [{ text: "重庆取车", sourceMessageIndex: 0 }], openQuestions: ["天数"], assumptions: [] } }) };
      },
      async generateWithTools(): Promise<ToolResponse> { throw new Error("must not call tools"); },
    };
    const session = new ChatSession(provider, { enableTools: true, agentLoop: true, projectRoot: process.cwd(), onSessionStateChanged: async state => { states.push(state); } });
    await expect(session.send("重庆取车自驾游")).resolves.toMatchObject({ outcome: "needs_user" });
    const last = states.at(-1)!;
    expect(last.task).toMatchObject({ goal: "重庆自驾", confirmedConstraints: [{ sourceMessageIndex: 0 }] });
    expect(last.messages.at(-1)).toMatchObject({ role: "assistant" });
  });

  it("continues the original task after the user answers clarification", async () => {
    let generateCalls = 0;
    const provider = {
      id: "fake", model: "fake",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        generateCalls += 1;
        if (generateCalls === 1) return { text: JSON.stringify({ kind: "clarify", questions: ["几天？"], task: { goal: "重庆到广州自驾", confirmedConstraints: [], openQuestions: ["天数"], assumptions: [] } }) };
        if (generateCalls === 2) return { text: JSON.stringify({ kind: "execute", objective: "查证并规划", task: { goal: "重庆到广州自驾", confirmedConstraints: [{ text: "5天", sourceMessageIndex: 2 }], openQuestions: [], assumptions: [] } }) };
        return { text: "5天完整方案" };
      },
      async generateWithTools(): Promise<ToolResponse> { return { text: "证据已足够" }; },
    };
    const session = new ChatSession(provider, { enableTools: true, agentLoop: true, projectRoot: process.cwd() });
    await expect(session.send("重庆取车回广州自驾")).resolves.toMatchObject({ outcome: "needs_user" });
    await expect(session.send("5天，预算适中")).resolves.toMatchObject({ text: "5天完整方案" });
    expect(generateCalls).toBe(3);
  });

  it("cancels during understand without entering tools", async () => {
    let rejectRequest: ((error: Error) => void) | undefined;
    let toolCalls = 0;
    const provider = {
      id: "fake", model: "fake",
      async generate(_request: ModelRequest, options?: { signal?: AbortSignal }): Promise<ModelResponse> {
        return await new Promise<ModelResponse>((resolve, reject) => {
          rejectRequest = reject;
          options?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        });
      },
      async generateWithTools(): Promise<ToolResponse> { toolCalls += 1; return { text: "unexpected" }; },
    };
    const session = new ChatSession(provider, { enableTools: true, agentLoop: true, projectRoot: process.cwd() });
    const pending = session.send("规划旅行");
    while (!rejectRequest) await new Promise(resolve => setTimeout(resolve, 0));
    expect(session.cancelActiveTurn()).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: "TURN_CANCELLED" });
    expect(toolCalls).toBe(0);
  });
});
