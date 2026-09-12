import { describe, expect, it } from "vitest";
import { PROJECT_SEARCH_DEFAULTS, ProjectSearchValidationError, validateProjectSearchQuery } from "../src/project-search/types.js";

describe("project search contract", () => {
  it("keeps explicit valid query options unchanged", () => {
    const query = { text: "  Session  ", path: "docs", limit: 3, maxChars: 1000, contextLines: 0 } as const;
    expect(validateProjectSearchQuery(query)).toBe(query);
    expect(PROJECT_SEARCH_DEFAULTS).toMatchObject({ limit: 20, maxChars: 8000, contextLines: 1 });
  });

  it.each([
    ["EMPTY_QUERY", { text: "   " }],
    ["INVALID_PATH", { text: "x", path: "\0" }],
    ["INVALID_LIMIT", { text: "x", limit: 0 }],
    ["INVALID_MAX_CHARS", { text: "x", maxChars: -1 }],
    ["INVALID_CONTEXT_LINES", { text: "x", contextLines: -1 }],
  ] as const)("rejects %s", (code, query) => {
    expect(() => validateProjectSearchQuery(query)).toThrowError(ProjectSearchValidationError);
    try { validateProjectSearchQuery(query); } catch (error) { expect(error).toMatchObject({ code }); }
  });

  it("accepts a missing optional path and zero context lines", () => {
    expect(validateProjectSearchQuery({ text: "x", contextLines: 0 })).toEqual({ text: "x", contextLines: 0 });
  });
});
