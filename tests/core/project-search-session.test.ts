import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ChatSession } from "../../src/core/session.js";
import type { ModelRequest, ToolResponse } from "../../src/core/types.js";
import type { SessionJournal } from "../../src/core/journal.js";

describe("project search source tracking", () => {
  it("records only returned source IDs in the next attempt snapshot and journal", async () => {
    const root = await mkdtemp(join(tmpdir(), "isla-search-session-"));
    await mkdir(join(root, "docs")); await writeFile(join(root, "docs", "note.md"), "可靠检索\n");
    const requests: ModelRequest[] = [];
    let step = 0;
    const provider = {
      id: "fake", model: "fake-model",
      async generate(request: ModelRequest) { requests.push(request); return { text: "完成" }; },
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        requests.push(request);
        if (step++ === 0) return { text: "", toolCalls: [{ id: "search-1", name: "search_project", arguments: JSON.stringify({ query: "检索" }) }] };
        return { text: "完成" };
      },
    };
    const journal: SessionJournal = { version: 1, turns: [] };
    await new ChatSession(provider, { projectRoot: root, enableTools: true, journal, onSessionStateChanged: async () => undefined }).send("查找检索实现");
    expect(requests[1]?.messages.some(message => message.content.includes("project:v1:"))).toBe(true);
    expect(journal.turns[0]?.attempts[1]?.request.retrievedSourceIds).toHaveLength(1);
    expect(journal.turns[0]?.actions).toContainEqual(expect.objectContaining({ type: "project_retrieval", truncated: false }));
    expect(JSON.stringify(journal.turns[0]?.actions)).not.toContain("可靠检索");
  });
});
