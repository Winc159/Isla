import { describe, expect, it } from "vitest";
import { createSessionQueryCapability } from "../../src/tools/session-query.js";
import { SessionQuery } from "../../src/session-query.js";
import type { SessionStore, StoredSession } from "../../src/session-store.js";

const workspace = "a".repeat(64);
const stored: StoredSession = { version: 4, id: "session-1", createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:01.000Z", provider: "fake", model: "model", workspaceKey: workspace, messages: [{ role: "user", content: "查找旧任务" }, { role: "assistant", content: "历史答案" }], journal: { version: 1, turns: [] } };

const store: SessionStore = { list: async () => [], listAll: async () => [stored], loadLatest: async () => undefined, create: async () => stored, save: async () => stored };

describe("session query tools", () => {
  it("exposes narrow schemas and bounded historical results", async () => {
    const capability = createSessionQueryCapability(new SessionQuery(store), workspace, () => "current");
    expect(capability.tools.map(tool => tool.definition.name)).toEqual(["search_session_history", "read_session_context"]);
    expect(capability.tools[0]!.definition.parameters).toMatchObject({ additionalProperties: false });
    await expect(capability.tools[0]!.execute(JSON.stringify({ query: "旧任务" }))).resolves.toContain("session-1");
    await expect(capability.tools[1]!.execute(JSON.stringify({ session_id: "session-1" }))).resolves.toContain("历史答案");
  });

  it("rejects unknown fields", async () => {
    const capability = createSessionQueryCapability(new SessionQuery(store), workspace, () => "current");
    await expect(capability.tools[0]!.execute(JSON.stringify({ query: "任务", workspace: workspace }))).rejects.toMatchObject({ code: "SESSION_QUERY_INVALID" });
  });
});
