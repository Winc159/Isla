import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChatSession } from "../../src/core/session.js";
import type { ModelRequest, ToolResponse } from "../../src/core/types.js";

describe("project source display", () => {
  it("returns only sources actually produced by search_project", async () => {
    let step = 0;
    const provider = {
      id: "fake", model: "fake", async generate(_request: ModelRequest) { return { text: "done" }; },
      async generateWithTools(_request: ModelRequest): Promise<ToolResponse> {
        if (step++ === 0) return { text: "", toolCalls: [{ id: "s", name: "search_project", arguments: JSON.stringify({ query: "x" }) }] };
        const toolMessage = [..._request.messages].reverse().find(message => message.role === "tool");
        const sourceId = [...(toolMessage?.content.matchAll(/project:v1:[0-9a-f]{64}/g) ?? [])][0]?.[0];
        return { text: `done ${sourceId ? `[[source:${sourceId}]]` : ""}` };
      },
    };
    const root = await mkdtemp(join(tmpdir(), "isla-source-display-"));
    await writeFile(join(root, "note.md"), "x\n");
    const response = await new ChatSession(provider, { projectRoot: root, enableTools: true, onSessionStateChanged: async () => undefined }).send("search for x");
    expect(response.projectSources).toEqual([{ path: "note.md", startLine: 1 }]);
    expect(response.text).toBe("done ");
  });

  it("omits unknown citations and removes their markers", async () => {
    const provider = { id: "fake", model: "fake", async generate(_request: ModelRequest) { return { text: "answer [[source:project:v1:" + "b".repeat(64) + "]]" }; } };
    const response = await new ChatSession(provider, { onSessionStateChanged: async () => undefined }).send("hello");
    expect(response.text).toBe("answer ");
    expect(response.projectSources).toBeUndefined();
  });
});
