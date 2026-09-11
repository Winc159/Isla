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
    expect(p.requests.find(request => request.tools)?.tools?.map(tool => tool.name)).toEqual(["list_directory", "read_text_file", "write_text_file"]);
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
    expect(provider.requests.find(request => request.tools)?.tools?.map(tool => tool.name)).toEqual(["list_directory", "read_text_file", "write_text_file"]);
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
    const p = new FakeProvider(Array.from({ length: 22 }, (_, index) => ({ text: `a${index + 1}` })));
    const s = new ChatSession(p, {
      systemPrompt: "system",
      maxContextTurns: 20,
      onMessagesChanged: async messages => { snapshots.push(messages); },
    });
    for (let index = 1; index <= 22; index += 1) await s.send(`u${index}`);
    expect(p.requests[21]?.messages[0]).toEqual({ role: "system", content: "system" });
    expect(p.requests[21]?.messages[1]).toEqual({ role: "user", content: "u3" });
    expect(p.requests[21]?.messages).toHaveLength(40);
    expect(snapshots.at(-1)).toHaveLength(45);
  });
});
