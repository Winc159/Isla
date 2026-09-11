import { describe, expect, it } from "vitest";
import { CompletionChecker } from "../../src/core/completion.js";

describe("CompletionChecker", () => {
  const checker = new CompletionChecker();
  it("requires read evidence for inspect", () => {
    expect(checker.check({ kind: "inspect", requiredEvidence: ["read_text_file"] }, []).complete).toBe(false);
    expect(checker.check({ kind: "inspect", requiredEvidence: ["read_text_file"] }, ["read_text_file"]).complete).toBe(true);
  });
  it("accepts directory evidence for a directory request but not file content", () => {
    expect(checker.check({ kind: "inspect", requiredEvidence: ["目录列表"] }, ["list_directory"]).complete).toBe(true);
    expect(checker.check({ kind: "inspect", requiredEvidence: ["文件内容"] }, ["list_directory"]).complete).toBe(false);
  });
  it("requires a successful write for execute", () => {
    expect(checker.check({ kind: "execute" }, []).complete).toBe(false);
    expect(checker.check({ kind: "execute" }, [], true).complete).toBe(true);
  });
  it("allows answer and discussion without tools", () => {
    expect(checker.check({ kind: "answer" }, []).complete).toBe(true);
    expect(checker.check({ kind: "discuss" }, []).complete).toBe(true);
  });
});
