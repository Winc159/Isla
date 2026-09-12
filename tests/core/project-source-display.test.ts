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
        return { text: "done" };
      },
    };
    const root = await mkdtemp(join(tmpdir(), "isla-source-display-"));
    await writeFile(join(root, "note.md"), "x\n");
    const response = await new ChatSession(provider, { projectRoot: root, enableTools: true, onSessionStateChanged: async () => undefined }).send("search for x");
    expect(response.projectSources).toEqual([{ path: "note.md", startLine: 1 }]);
  });
});
