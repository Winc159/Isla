import { describe, expect, it } from "vitest";
import { ChatSession } from "../../src/core/session.js";
import { FakeProvider } from "../support/fake-provider.js";
import type { ModelRequest, ModelResponse, ToolResponse } from "../../src/core/types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
describe("session", () => {
  it("emits reconstructable session events in order", async () => {
    const events: string[] = [];
    const provider = new FakeProvider([{ text: "回答" }]);
    await new ChatSession(provider, { onSessionEvent: async event => { events.push(event.type); } }).send("你好");
    expect(events).toEqual(["user", "assistant", "turn_summary"]);
  });

  it("resumes the original execution after confirmation instead of asking again", async () => {
    class ExecuteProvider extends FakeProvider {
      toolCalls = 0;
      async generate(): Promise<ModelResponse> {
        return { text: '{"kind":"execute","goal":"修改文件","needsHistory":false,"needsTools":true,"requiresUserConfirmation":true,"missingInformation":[]}' };
      }
      async generateWithTools(): Promise<ToolResponse> {
        this.toolCalls += 1;
        return { text: "未完成写入" };
      }
    }
    const provider = new ExecuteProvider([]);
    const session = new ChatSession(provider, { enableTools: true, projectRoot: process.cwd() });
    await expect(session.send("修改文件")).resolves.toMatchObject({ text: expect.stringContaining("执行前需要") });
    await expect(session.send("确认执行")).resolves.not.toMatchObject({ text: expect.stringContaining("执行前需要") });
    expect(provider.toolCalls).toBe(2);
  });

  it("uses the execution phase and retries once when a confirmed write omits its tool call", async () => {
    class CorrectedWriteProvider extends FakeProvider {
      toolRequests: ModelRequest[] = [];
      async generate(): Promise<ModelResponse> {
        return { text: '{"kind":"execute","goal":"创建文件","needsHistory":false,"needsTools":true,"requiresUserConfirmation":true,"missingInformation":[]}' };
      }
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        this.toolRequests.push(request);
        if (this.toolRequests.length === 1) return { text: "我准备写入" };
        if (this.toolRequests.length === 2) return { text: "", toolCalls: [{ id: "write-1", name: "write_text_file", arguments: JSON.stringify({ path: "execution-phase.txt", content: "ok" }) }] };
        return { text: "写入完成" };
      }
    }
    const provider = new CorrectedWriteProvider([]);
    const session = new ChatSession(provider, {
      enableTools: true,
      projectRoot: process.cwd(),
      permissionPreset: "workspace",
      approvalPolicy: "ask",
      approvalService: { request: async () => ({ approved: false, reason: "test rejection" }) },
    });
    await session.send("创建文件");
    await expect(session.send("确认执行")).resolves.toMatchObject({ outcome: "blocked", text: "用户拒绝了工具调用，已停止本轮执行。" });
    expect(provider.toolRequests).toHaveLength(2);
    expect(provider.toolRequests[0]?.messages.some(message => message.role === "system" && message.content.includes("已确认的执行阶段"))).toBe(true);
    expect(provider.toolRequests[1]?.messages.at(-1)?.content).toContain("只返回 write_text_file Tool Call");
    expect(provider.toolRequests.every(request => request.toolChoice && typeof request.toolChoice === "object" && request.toolChoice.name === "write_text_file")).toBe(true);
  });

  it("loads a requested project file and continues with the tool result", async () => {
    class ToolProvider extends FakeProvider {
      private toolRequestCount = 0;
      async generate(): Promise<ModelResponse> { return { text: '{"kind":"inspect","goal":"读取 README","needsHistory":false,"needsTools":true,"requiresUserConfirmation":false,"missingInformation":[]}' }; }
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        this.requests.push(request);
        this.toolRequestCount += 1;
        if (this.toolRequestCount > 1) return { text: "最终回答" };
        return { text: "", toolCalls: [{ id: "1", name: "read_text_file", arguments: JSON.stringify({ path: "README.md" }) }] };
      }
    }
    const p = new ToolProvider([{ text: "最终回答" }]);
    const s = new ChatSession(p, { projectRoot: process.cwd(), enableTools: true });
    await expect(s.send("读取 README")).resolves.toMatchObject({ text: "最终回答" });
    expect(p.requests.find(request => request.tools)?.tools?.map(tool => tool.name)).toEqual(["list_directory", "read_text_file", "write_text_file"]);
  });
  it("supports read-only evidence before a discussion", async () => {
    class DiscussionProvider extends FakeProvider {
      private calls = 0;
      async generate(): Promise<ModelResponse> { return { text: '{"kind":"discuss","goal":"基于当前源码讨论审批流程","needsHistory":true,"needsTools":false,"requiresUserConfirmation":false,"missingInformation":[],"requiredEvidence":["文件内容"]}' }; }
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        this.requests.push(request);
        this.calls += 1;
        if (this.calls === 1) return { text: "", toolCalls: [{ id: "read-1", name: "read_text_file", arguments: JSON.stringify({ path: "README.md" }) }] };
        return { text: "基于读取到的源码，建议保留单一输入泵。" };
      }
    }
    const provider = new DiscussionProvider([]);
    const response = await new ChatSession(provider, { projectRoot: process.cwd(), enableTools: true }).send("讨论如何改进当前项目的审批流程，可以读取相关源码，但不要修改文件");
    expect(response.text).toContain("单一输入泵");
    expect(provider.requests.find(request => request.tools)?.tools?.map(tool => tool.name)).toEqual(["list_directory", "read_text_file"]);
  });
  it("supports tools on the streaming session path", async () => {
    class ToolProvider extends FakeProvider {
      private calls = 0;
      async generate(): Promise<ModelResponse> { return { text: '{"kind":"inspect","goal":"读取 README","needsHistory":false,"needsTools":true,"requiresUserConfirmation":false,"missingInformation":[]}' }; }
      async generateWithTools(): Promise<ToolResponse> {
        this.calls += 1;
        if (this.calls === 1) return { text: "", toolCalls: [{ id: "1", name: "list_directory", arguments: JSON.stringify({ path: "" }) }] };
        if (this.calls === 2) return { text: "", toolCalls: [{ id: "2", name: "read_text_file", arguments: JSON.stringify({ path: "README.md" }) }] };
        return { text: "流式最终回答" };
      }
    }
    const p = new ToolProvider([]);
    const chunks: string[] = [];
    await new ChatSession(p, { projectRoot: process.cwd(), enableTools: true }).sendStream("读取 README", chunk => chunks.push(chunk));
    expect(chunks.join("")).toBe("流式最终回答");
  });
  it("stops the tool loop after approval rejection", async () => {
    class WriteProvider extends FakeProvider {
      toolCalls = 0;
      async generate(): Promise<ModelResponse> { return { text: '{"kind":"execute","goal":"创建文件","needsHistory":false,"needsTools":true,"requiresUserConfirmation":false,"missingInformation":[]}' }; }
      async generateWithTools(): Promise<ToolResponse> {
        this.toolCalls += 1;
        return { text: "", toolCalls: [{ id: String(this.toolCalls), name: "write_text_file", arguments: JSON.stringify({ path: "rejected.txt", content: "x" }) }] };
      }
    }
    const provider = new WriteProvider([]);
    const session = new ChatSession(provider, {
      enableTools: true,
      projectRoot: process.cwd(),
      approvalPolicy: "ask",
      approvalService: { request: async () => ({ approved: false, reason: "拒绝" }) },
    });
    await expect(session.send("创建文件")).resolves.toMatchObject({ text: expect.stringContaining("执行前需要") });
    await expect(session.send("确认执行")).resolves.toMatchObject({ outcome: "blocked", text: "用户拒绝了工具调用，已停止本轮执行。" });
    expect(provider.toolCalls).toBe(1);
  });
  it("does not repeat an already successful identical write", async () => {
    class RepeatingWriteProvider extends FakeProvider {
      toolCalls = 0;
      async generate(): Promise<ModelResponse> { return { text: '{"kind":"execute","goal":"创建文件","needsHistory":false,"needsTools":true,"requiresUserConfirmation":false,"missingInformation":[]}' }; }
      async generateWithTools(): Promise<ToolResponse> {
        this.toolCalls += 1;
        return { text: "", toolCalls: [{ id: String(this.toolCalls), name: "write_text_file", arguments: JSON.stringify({ path: "repeat.txt", content: "x" }) }] };
      }
    }
    const provider = new RepeatingWriteProvider([]);
    const session = new ChatSession(provider, {
      enableTools: true,
      projectRoot: process.cwd(),
      approvalPolicy: "ask",
      permissionPreset: "workspace",
      approvalService: { request: async () => ({ approved: true }) },
    });
    await session.send("创建文件");
    const response = await session.send("确认执行");
    expect(response).toMatchObject({ outcome: "completed", text: "写入已完成，已停止重复写入。" });
    expect(provider.toolCalls).toBe(2);
  });
  it("stops forcing the write tool after the first successful write", async () => {
    class SingleWriteProvider extends FakeProvider {
      requestsWithTools: ModelRequest[] = [];
      async generate(): Promise<ModelResponse> { return { text: '{"kind":"execute","goal":"创建文件","needsHistory":false,"needsTools":true,"requiresUserConfirmation":false,"missingInformation":[]}' }; }
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
      await session.send("创建文件");
      const response = await session.send("确认执行");
      expect(response.text).toBe("写入完成");
      expect(provider.requestsWithTools[0]?.toolChoice).toEqual({ name: "write_text_file" });
      expect(provider.requestsWithTools[1]?.toolChoice).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("keeps send and sendStream state behavior aligned", async () => {
    const sendEvents: string[] = [];
    const streamEvents: string[] = [];
    const sendProvider = new FakeProvider([{ text: "同一回答" }]);
    const streamProvider = new FakeProvider([{ text: "同一回答" }]);
    const send = new ChatSession(sendProvider, { onSessionEvent: async event => { sendEvents.push(event.type); } });
    const stream = new ChatSession(streamProvider, { onSessionEvent: async event => { streamEvents.push(event.type); } });

    const direct = await send.send("同一个问题");
    const chunks: string[] = [];
    const streamed = await stream.sendStream("同一个问题", text => chunks.push(text));

    expect(streamed).toMatchObject(direct);
    expect(chunks.join("")).toBe(direct.text);
    expect(streamEvents).toEqual(sendEvents);
    expect(streamProvider.requests[0]?.messages).toEqual(sendProvider.requests[0]?.messages);
  });
  it("does not complete an inspect request without a successful read", async () => {
    class InspectProvider extends FakeProvider {
      async generateWithTools(): Promise<ToolResponse> { return { text: "我已经查看完了" }; }
    }
    const provider = new InspectProvider([{ text: '{"kind":"inspect","goal":"查看项目","needsHistory":false,"needsTools":true,"requiresUserConfirmation":false,"missingInformation":[]}' }]);
    await expect(new ChatSession(provider, { projectRoot: process.cwd(), enableTools: true }).send("查看项目")).resolves.toMatchObject({ text: "未完成检查：尚未获得相关文件或目录的成功读取结果。", outcome: "blocked" });
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
