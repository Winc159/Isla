import { describe, expect, it } from "vitest";
import { SessionQuery } from "../src/session-query.js";
import type { SessionStore, StoredSession } from "../src/session-store.js";

const workspace = "a".repeat(64);
const otherWorkspace = "b".repeat(64);
function session(id: string, workspaceKey: string, provider = "fake", model = "m1"): StoredSession {
  return { version: 4, id, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: `2026-09-18T00:00:0${id.length}.000Z`, provider, model, workspaceKey, messages: [{ role: "user", content: `任务 ${id} token=secret-value` }, { role: "assistant", content: "完成" }, { role: "tool", toolCallId: "c1", content: "private tool output" }], task: { version: 1, revision: 1, goal: `任务 ${id}`, status: "active", constraints: [], assumptions: [], openQuestions: [], steps: [{ id: "s1", title: "步骤", status: "completed" }], blockers: [], updatedAt: "2026-09-18T00:00:00.000Z" }, journal: { version: 1, turns: [] } };
}

function queryStore(sessions: readonly StoredSession[]): SessionStore { return { list: async () => [], listAll: async () => sessions, loadLatest: async () => undefined, create: async () => sessions[0]!, save: async () => sessions[0]! }; }

describe("SessionQuery", () => {
  it("searches only the current workspace across providers and redacts secrets", async () => {
    const result = await new SessionQuery(queryStore([session("one", workspace), session("two", otherWorkspace, "deepseek", "chat"), session("three", workspace, "bailian", "qwen")])).search({ workspaceKey: workspace, query: "任务" });
    expect(result.sessions.map(item => item.sessionId)).toEqual(["three", "one"]);
    expect(result.sessions[0]).toMatchObject({ provider: "bailian", model: "qwen", task: { completedSteps: 1 } });
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(JSON.stringify(result)).not.toContain("private tool output");
  });

  it("reads bounded user and assistant history without tool messages", async () => {
    const result = await new SessionQuery(queryStore([session("one", workspace)])).read({ workspaceKey: workspace, sessionId: "one" });
    expect(result.messages.map(message => message.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(result)).not.toContain("private tool output");
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  it("does not reveal sessions from another workspace", async () => {
    const query = new SessionQuery(queryStore([session("other", otherWorkspace)]));
    expect((await query.search({ workspaceKey: workspace })).sessions).toHaveLength(0);
    await expect(query.read({ workspaceKey: workspace, sessionId: "other" })).rejects.toMatchObject({ code: "SESSION_QUERY_NOT_FOUND" });
  });
});
