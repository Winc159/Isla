import { describe, expect, it } from "vitest";
import { createToolCapabilities } from "../../src/tools/composition.js";

describe("tool capability composition", () => {
  it("always includes project files and omits disabled optional capabilities", () => {
    const capabilities = createToolCapabilities({ workspaceRoot: process.cwd() });

    expect(capabilities.map(capability => capability.id)).toEqual(["project-files", "project-discovery", "command-execution"]);
    expect(capabilities[0]?.tools.map(tool => tool.definition.name)).toEqual([
      "list_directory",
      "read_text_file",
      "search_project",
      "edit_text_file",
      "write_text_file",
    ]);
    expect(capabilities[1]?.tools.map(tool => tool.definition.name)).toEqual(["glob_project", "grep_project"]);
  });

  it("adds enabled web tools through the same composition entry", () => {
    const capabilities = createToolCapabilities({
      workspaceRoot: process.cwd(),
      webSearch: {
        enabled: true,
        provider: "deepseek-official",
        apiKey: "test-only-key",
        model: "search-model",
        maxResults: 8,
        timeoutMs: 30_000,
        maxOutputChars: 12_000,
      },
    });

    expect(capabilities.map(capability => capability.id)).toEqual(["project-files", "project-discovery", "command-execution", "web"]);
    expect(capabilities[3]?.tools.map(tool => tool.definition.name)).toEqual(["web_search"]);
  });

  it("adds user interaction only when an input adapter is available", () => {
    const capabilities = createToolCapabilities({ workspaceRoot: process.cwd(), userQuestionService: { ask: async () => ({ answers: [] }) } });

    expect(capabilities.map(capability => capability.id)).toEqual(["project-files", "project-discovery", "command-execution", "user-interaction"]);
    expect(capabilities[3]?.tools.map(tool => tool.definition.name)).toEqual(["ask_user_question"]);
  });
});
