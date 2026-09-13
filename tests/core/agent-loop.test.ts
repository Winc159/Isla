import { describe, expect, it } from "vitest";
import { parseTurnDecision } from "../../src/core/agent-loop.js";
import { ChatSession } from "../../src/core/session.js";
import type { ModelRequest, ModelResponse, ToolResponse } from "../../src/core/types.js";
import { createWebCapability } from "../../src/tools/web.js";
import type { WebFetchResult, WebSearchProvider } from "../../src/web/types.js";

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

  it("parses a bounded external evidence requirement", () => {
    const decision = parseTurnDecision(JSON.stringify({ kind: "execute", objective: "查当前路线", evidenceRequirement: { external: "required", topics: ["路线", "交通"] }, task: { goal: "旅行", confirmedConstraints: [], openQuestions: [], assumptions: [] } }), [{ role: "user", content: "查当前路线" }]);
    expect(decision.kind).toBe("execute");
    if (decision.kind === "execute") expect(decision.evidenceRequirement).toEqual({ external: "required", topics: ["路线", "交通"] });
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

  it("runs an offline search-fetch-synthesize chain and projects evidence", async () => {
    const events: string[] = [];
    const searchProvider: WebSearchProvider = { id: "fake-search", async search() { return { sources: [{ url: "https://example.com/route", title: "Route", snippet: "verified route" }], truncated: false }; } };
    const fetchResult: WebFetchResult = { requestedUrl: "https://example.com/route", finalUrl: "https://example.com/route", statusCode: 200, contentType: "text/plain", body: { kind: "text", content: "route details" }, bytesRead: 13, truncated: false };
    let phase = 0;
    let modelCalls = 0;
    let synthesisRequest: ModelRequest | undefined;
    const provider = {
      id: "fake", model: "fake",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        modelCalls += 1;
        if (request.messages.some(message => message.content.includes("successfulWebEvidence:"))) synthesisRequest = request;
        return modelCalls === 1 ? { text: JSON.stringify({ kind: "execute", objective: "查当前路线", evidenceRequirement: { external: "required", topics: ["路线"] }, task: { goal: "旅行规划", confirmedConstraints: [], openQuestions: [], assumptions: [] } }) } : { text: "路线综合结果" };
      },
      async generateWithTools(): Promise<ToolResponse> {
        phase += 1;
        if (phase === 1) return { text: "", toolCalls: [{ id: "search-1", name: "web_search", arguments: JSON.stringify({ query: "current route" }) }] };
        if (phase === 2) return { text: "", toolCalls: [{ id: "fetch-1", name: "web_fetch", arguments: JSON.stringify({ url: "https://example.com/route" }) }] };
        return { text: "tools complete" };
      },
    };
    const capability = createWebCapability({
      webSearch: { enabled: true, provider: "deepseek-official", apiKey: "unused", model: "unused", maxResults: 8, timeoutMs: 30_000, maxOutputChars: 12_000 },
      webFetch: { enabled: true, allowedHosts: ["example.com"], timeoutMs: 30_000, maxResponseBytes: 100_000, maxBodyChars: 10_000, maxOutputChars: 10_000, maxRedirects: 0 },
    });
    // Replace the production search implementation with an offline fake while retaining Tool boundaries.
    const tools = capability.tools.map(tool => tool.definition.name === "web_search" ? { ...tool, execute: async (args: string, options?: { readonly signal?: AbortSignal }) => { const value = JSON.parse(args) as { query: string }; const result = await searchProvider.search({ query: value.query, maxResults: 8 }, options); return { content: "search", details: { type: "web_search" as const, provider: "fake-search", query: value.query, sources: result.sources, truncated: result.truncated, hasProviderContent: false } }; } } : { ...tool, execute: async (_args: string) => ({ content: "fetch", details: { type: "web_fetch" as const, requestedUrl: fetchResult.requestedUrl, finalUrl: fetchResult.finalUrl, statusCode: fetchResult.statusCode, contentType: fetchResult.contentType, bodyKind: fetchResult.body.kind, bytesRead: fetchResult.bytesRead, truncated: fetchResult.truncated } }) });
    const session = new ChatSession(provider, { enableTools: true, agentLoop: true, projectRoot: process.cwd(), capabilities: [{ ...capability, tools }], approvalPolicy: "always", onToolStarted: tool => events.push(`start:${tool}`), onToolFinished: tool => events.push(`end:${tool}`) });
    const response = await session.send("查当前路线");
    expect(response.text).toBe("路线综合结果");
    expect(events).toEqual(["start:web_search", "end:web_search", "start:web_fetch", "end:web_fetch"]);
    expect(synthesisRequest?.messages.some(message => message.content.includes("successfulWebEvidence:"))).toBe(true);
    expect(synthesisRequest?.messages.some(message => message.content.includes("web_search:"))).toBe(true);
    expect(synthesisRequest?.messages.some(message => message.content.includes("web_fetch:"))).toBe(true);
  });

  it("requires conservative synthesis when required evidence is absent", async () => {
    let synthesisRequest: ModelRequest | undefined;
    let modelCalls = 0;
    const provider = {
      id: "fake", model: "fake",
      async generate(request: ModelRequest): Promise<ModelResponse> {
        modelCalls += 1;
        if (request.messages.some(message => message.content.includes("successfulWebEvidence:"))) synthesisRequest = request;
        return modelCalls === 1 ? { text: JSON.stringify({ kind: "execute", objective: "查当前价格", evidenceRequirement: { external: "required", topics: ["价格"] }, task: { goal: "采购比较", confirmedConstraints: [], openQuestions: [], assumptions: [] } }) } : { text: "价格未核实" };
      },
      async generateWithTools(): Promise<ToolResponse> { return { text: "没有可用 Web" }; },
    };
    const session = new ChatSession(provider, { enableTools: true, agentLoop: true, projectRoot: process.cwd() });
    await session.send("查当前价格");
    expect(synthesisRequest?.messages.some(message => message.content.includes("successfulWebEvidence: none"))).toBe(true);
    expect(synthesisRequest?.messages.some(message => message.content.includes("估算、未核实"))).toBe(true);
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
