import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatSession } from "../../src/core/session.js";
import { FakeProvider } from "../support/fake-provider.js";
import type { Message, ModelRequest, ModelResponse, ToolResponse } from "../../src/core/types.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
let sessionRoot: string;
beforeEach(async () => {
  sessionRoot = await mkdtemp(join(tmpdir(), "isla-session-test-"));
  await writeFile(join(sessionRoot, "README.md"), "# fixture\n", "utf8");
});
afterEach(async () => { await rm(sessionRoot, { recursive: true, force: true }); });
describe("session", () => {
  it("injects retrieved history as data and tolerates retrieval failure", async () => {
    const provider = new FakeProvider([{ text: "回答" }, { text: "继续回答" }]);
    const session = new ChatSession(provider, { retrieveContext: async input => input === "first" ? "不可信历史：偏好简洁" : Promise.reject(new Error("search unavailable")) });
    await session.send("first");
    expect(provider.requests[0]?.messages.some(message => message.content.includes("不可信历史：偏好简洁"))).toBe(true);
    await expect(session.send("second")).resolves.toMatchObject({ text: "继续回答" });
  });
  it("keeps system policy before retrieved data and current input", async () => {
    const provider = new FakeProvider([{ text: "ok" }]);
    await new ChatSession(provider, { systemPrompt: "SYSTEM POLICY", retrieveContext: async () => "MEMORY DATA" }).send("CURRENT INPUT");
    const contents = provider.requests[0]!.messages.map(message => message.content);
    const memoryIndex = contents.findIndex(content => content.includes("MEMORY DATA"));
    const currentIndex = contents.indexOf("CURRENT INPUT");
    expect(contents.indexOf("SYSTEM POLICY")).toBeLessThan(memoryIndex);
    expect(memoryIndex).toBeLessThan(currentIndex);
    expect(provider.requests[0]!.messages.find(message => message.content.includes("MEMORY DATA"))?.role).toBe("system");
  });
  it("indexes only after the final assistant message and ignores indexing failure", async () => {
    const snapshots: readonly Message[][] = [];
    const provider = new FakeProvider([{ text: "done" }]);
    await expect(new ChatSession(provider, { onTurnCommitted: async messages => { (snapshots as Message[][]).push(messages); throw new Error("index failed"); } }).send("work")).resolves.toMatchObject({ text: "done" });
    expect(snapshots[0]?.at(-1)).toEqual({ role: "assistant", content: "done" });
  });
  it("emits transient observer events in order", async () => {
    const events: string[] = [];
    const provider = new FakeProvider([{ text: "回答" }]);
    await new ChatSession(provider, { onSessionEvent: async event => { events.push(event.type); } }).send("你好");
    expect(events).toEqual(["user", "assistant"]);
  });


  it("loads a requested project file and continues with the tool result", async () => {
    class ToolProvider extends FakeProvider {
      private toolRequestCount = 0;
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        this.requests.push(request);
        this.toolRequestCount += 1;
        if (this.toolRequestCount > 1) return { text: "最终回答" };
        return { text: "", toolCalls: [{ id: "1", name: "read_text_file", arguments: JSON.stringify({ path: "README.md" }) }] };
      }
    }
    const p = new ToolProvider([{ text: "最终回答" }]);
    const s = new ChatSession(p, { projectRoot: sessionRoot, enableTools: true });
    await expect(s.send("读取 README")).resolves.toMatchObject({ text: "最终回答" });
    expect(p.requests.find(request => request.tools)?.tools?.map(tool => tool.name)).toEqual(["list_directory", "read_text_file", "search_project", "write_text_file"]);
  });
  it("supports read-only evidence before a discussion", async () => {
    class DiscussionProvider extends FakeProvider {
      private calls = 0;
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        this.requests.push(request);
        this.calls += 1;
        if (this.calls === 1) return { text: "", toolCalls: [{ id: "read-1", name: "read_text_file", arguments: JSON.stringify({ path: "README.md" }) }] };
        return { text: "基于读取到的源码，建议保留单一输入泵。" };
      }
    }
    const provider = new DiscussionProvider([]);
    const response = await new ChatSession(provider, { projectRoot: sessionRoot, enableTools: true }).send("讨论如何改进当前项目的审批流程，可以读取相关源码，但不要修改文件");
    expect(response.text).toContain("单一输入泵");
    expect(provider.requests.find(request => request.tools)?.tools?.map(tool => tool.name)).toEqual(["list_directory", "read_text_file", "search_project", "write_text_file"]);
  });
  it("persists tool calls and results as canonical messages", async () => {
    class ToolProvider extends FakeProvider {
      private calls = 0;
      async generateWithTools(): Promise<ToolResponse> {
        this.calls += 1;
        if (this.calls === 1) return { text: "", toolCalls: [{ id: "1", name: "list_directory", arguments: JSON.stringify({ path: "" }) }] };
        if (this.calls === 2) return { text: "", toolCalls: [{ id: "2", name: "read_text_file", arguments: JSON.stringify({ path: "README.md" }) }] };
        return { text: "最终回答" };
      }
    }
    const p = new ToolProvider([]);
    const snapshots: Array<readonly Message[]> = [];
    await new ChatSession(p, { projectRoot: sessionRoot, enableTools: true, onMessagesChanged: async messages => { snapshots.push(messages); } }).send("读取 README");
    expect(snapshots.some(messages => messages.some(message => message.role === "tool" && message.toolCallId === "2"))).toBe(true);
  });
  it("stops the tool loop after approval rejection", async () => {
    class WriteProvider extends FakeProvider {
      toolCalls = 0;
      async generateWithTools(): Promise<ToolResponse> {
        this.toolCalls += 1;
        return { text: "", toolCalls: [{ id: String(this.toolCalls), name: "write_text_file", arguments: JSON.stringify({ path: "rejected.txt", content: "x" }) }] };
      }
    }
    const provider = new WriteProvider([]);
    const session = new ChatSession(provider, {
      enableTools: true,
      projectRoot: sessionRoot,
      approvalPolicy: "ask",
      approvalService: { request: async () => ({ approved: false, reason: "拒绝" }) },
    });
    await expect(session.send("创建文件")).resolves.toMatchObject({ outcome: "blocked", text: "用户拒绝了工具调用，已停止本轮执行。" });
    expect(provider.toolCalls).toBe(1);
  });
  it("does not repeat an already successful identical write", async () => {
    class RepeatingWriteProvider extends FakeProvider {
      toolCalls = 0;
      async generateWithTools(): Promise<ToolResponse> {
        this.toolCalls += 1;
        return { text: "", toolCalls: [{ id: String(this.toolCalls), name: "write_text_file", arguments: JSON.stringify({ path: "repeat.txt", content: "x" }) }] };
      }
    }
    const provider = new RepeatingWriteProvider([]);
    const session = new ChatSession(provider, {
      enableTools: true,
      projectRoot: sessionRoot,
      approvalPolicy: "ask",
      permissionPreset: "workspace",
      approvalService: { request: async () => ({ approved: true }) },
    });
    const response = await session.send("创建文件");
    expect(response).toMatchObject({ outcome: "completed", text: "写入已完成，已停止重复写入。" });
    expect(provider.toolCalls).toBe(2);
  });
  it("lets the model finish naturally after a successful write", async () => {
    class SingleWriteProvider extends FakeProvider {
      requestsWithTools: ModelRequest[] = [];
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        this.requestsWithTools.push(request);
        if (this.requestsWithTools.length === 1) return { text: "", toolCalls: [{ id: "write-once", name: "write_text_file", arguments: JSON.stringify({ path: "write-once.txt", content: "x" }) }] };
        return { text: "写入完成" };
      }
    }
    const root = await mkdtemp(join(tmpdir(), "isla-write-once-"));
    try {
      const provider = new SingleWriteProvider([]);
      const session = new ChatSession(provider, {
        enableTools: true,
        projectRoot: root,
        permissionPreset: "workspace",
        approvalPolicy: "ask",
        approvalService: { request: async () => ({ approved: true }) },
      });
      const response = await session.send("创建文件");
      expect(response.text).toBe("写入完成");
      expect(provider.requestsWithTools[0]?.toolChoice).toBeUndefined();
      expect(provider.requestsWithTools[1]?.toolChoice).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("does not replace a model answer with an intent-specific fixed failure", async () => {
    class InspectProvider extends FakeProvider {
      async generateWithTools(): Promise<ToolResponse> { return { text: "我已经查看完了" }; }
    }
    const provider = new InspectProvider([]);
    await expect(new ChatSession(provider, { projectRoot: sessionRoot, enableTools: true }).send("查看项目")).resolves.toMatchObject({ text: "我已经查看完了" });
  });
  it("maintains ordered context", async () => { const p = new FakeProvider([{ text: "a1" }, { text: "a2" }]); const s = new ChatSession(p, { systemPrompt: "system" }); await s.send("u1"); await s.send("u2"); expect(p.requests[1]?.messages).toEqual([{ role: "system", content: "system" }, { role: "user", content: "u1" }, { role: "assistant", content: "a1" }, { role: "user", content: "u2" }]); });
  it("keeps failed user input", async () => { const p = new FakeProvider([new Error("no") , { text: "retry" }]); const s = new ChatSession(p); await expect(s.send("u1")).rejects.toThrow(); await s.send("retry"); expect(p.requests[1]?.messages).toEqual([{ role: "user", content: "u1" }, { role: "user", content: "retry" }]); });
  it("persists user input before the provider call and assistant output after success", async () => {
    const snapshots: unknown[] = [];
    const p = new FakeProvider([{ text: "a1" }]);
    const s = new ChatSession(p, { onMessagesChanged: async messages => { snapshots.push(messages); } });
    await s.send("u1");
    expect(snapshots).toEqual([
      [{ role: "user", content: "u1" }],
      [{ role: "user", content: "u1" }, { role: "assistant", content: "a1" }],
    ]);
  });
  it("rolls back an assistant message when persisting it fails", async () => {
    let saves = 0;
    const p = new FakeProvider([{ text: "hidden" }, { text: "visible" }]);
    const s = new ChatSession(p, {
      onMessagesChanged: async () => {
        saves += 1;
        if (saves === 2) throw new Error("disk full");
      },
    });

    await expect(s.send("u1")).rejects.toThrow("disk full");
    await s.send("u2");

    expect(p.requests[1]?.messages).toEqual([
      { role: "user", content: "u1" },
      { role: "user", content: "u2" },
    ]);
  });
  it("sends only the latest configured turns while retaining the full persisted history", async () => {
    const snapshots: (readonly unknown[])[] = [];
    const p = new FakeProvider(Array.from({ length: 20 }, (_, index) => ({ text: `a${index + 1}` })));
    const s = new ChatSession(p, {
      systemPrompt: "system",
      maxContextTurns: 20,
      onMessagesChanged: async messages => { snapshots.push(messages); },
    });
    for (let index = 1; index <= 20; index += 1) await s.send(`u${index}`);
    expect(p.requests[19]?.messages[0]).toEqual({ role: "system", content: "system" });
    expect(p.requests[19]?.messages[1]).toEqual({ role: "user", content: "u1" });
    expect(p.requests[19]?.messages).toHaveLength(40);
    expect(snapshots.at(-1)).toHaveLength(41);
  });
  it("creates and persists a checkpoint before the main request", async () => {
    const summary = [
      "## 当前目标\n继续任务",
      "## 已完成事项\n完成旧轮次",
      "## 已确认决策与约束\n保留事实源",
      "## 待处理事项\n处理当前问题",
      "## 可验证证据\n旧工具结果",
      "## 话题关系\n主话题",
      "## 不确定或缺失信息\n无",
    ].join("\n");
    class CompactingProvider extends FakeProvider {
      private answers = 0;
      override async generate(request: ModelRequest): Promise<ModelResponse> {
        this.requests.push(request);
        if (request.messages[0]?.content.includes("会话压缩器")) return { text: summary };
        this.answers += 1;
        return { text: `a${this.answers}` };
      }
    }
    const states: Array<{ readonly messages: readonly Message[]; readonly context?: unknown }> = [];
    const provider = new CompactingProvider([]);
    const session = new ChatSession(provider, {
      maxContextTurns: 2,
      contextRetainTurns: 1,
      onSessionStateChanged: async state => { states.push(state); },
    });
    await session.send("u1");
    await session.send("u2");
    await session.send("u3");

    const mainRequest = provider.requests.at(-1)!;
    expect(mainRequest.messages.some(message => message.content.includes("以下是较早会话的历史压缩检查点"))).toBe(true);
    expect(mainRequest.messages).toContainEqual({ role: "user", content: "u3" });
    expect(mainRequest.messages).not.toContainEqual({ role: "user", content: "u1" });
    expect(states.at(-1)?.context).toMatchObject({ checkpoint: { throughMessageIndex: 3, content: summary } });
    expect(states.at(-1)?.messages).toHaveLength(6);
  });
  it("falls back to raw context when compression output is invalid", async () => {
    class InvalidCompactingProvider extends FakeProvider {
      private calls = 0;
      override async generate(request: ModelRequest): Promise<ModelResponse> {
        this.requests.push(request);
        this.calls += 1;
        return { text: request.messages[0]?.content.includes("会话压缩器") ? "不是有效检查点" : `a${this.calls}` };
      }
    }
    const provider = new InvalidCompactingProvider([]);
    const session = new ChatSession(provider, { maxContextTurns: 2, contextRetainTurns: 1 });
    await session.send("u1");
    await session.send("u2");
    await session.send("u3");
    const mainRequest = provider.requests.at(-1)!;
    expect(mainRequest.messages).toContainEqual({ role: "user", content: "u2" });
    expect(mainRequest.messages).toContainEqual({ role: "user", content: "u3" });
  });

  it("cancels the active turn, preserves the user, and reaches idle without an assistant", async () => {
    let started!: () => void;
    const providerStarted = new Promise<void>(resolve => { started = resolve; });
    const provider = {
      id: "cancel-test", model: "cancel-model",
      generate: async (_request: ModelRequest, options?: { signal?: AbortSignal }) => await new Promise<ModelResponse>((resolve, reject) => {
        started();
        options?.signal?.addEventListener("abort", () => { const error = new Error("The operation was aborted"); error.name = "AbortError"; reject(error); }, { once: true });
      }),
    };
    const states: Array<{ readonly messages: readonly Message[]; readonly journal?: any }> = [];
    const session = new ChatSession(provider, { onSessionStateChanged: async state => { states.push(state); } });
    const pending = session.send("cancel me");
    await providerStarted;
    expect(session.cancelActiveTurn()).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: "TURN_CANCELLED" });
    await session.whenIdle();
    expect(states.at(-1)?.messages).toEqual([{ role: "user", content: "cancel me" }]);
    expect(states.at(-1)?.journal?.turns.at(-1)).toMatchObject({ status: "cancelled", error: { code: "TURN_CANCELLED" } });
  });
});
