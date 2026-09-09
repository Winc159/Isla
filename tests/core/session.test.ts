import { describe, expect, it } from "vitest";
import { ChatSession } from "../../src/core/session.js";
import { FakeProvider } from "../support/fake-provider.js";
import type { ModelRequest, ToolResponse } from "../../src/core/types.js";
describe("session", () => {
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
    const s = new ChatSession(p, { projectRoot: process.cwd(), enableTools: true });
    await expect(s.send("读取 README")).resolves.toMatchObject({ text: "最终回答" });
    expect(p.requests[0]?.tools?.map(tool => tool.name)).toEqual(["list_directory", "read_text_file", "write_text_file"]);
  });
  it("supports tools on the streaming session path", async () => {
    class ToolProvider extends FakeProvider {
      private calls = 0;
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
