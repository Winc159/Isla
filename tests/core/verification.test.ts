import { describe, expect, it } from "vitest";
import { deriveVerificationStatus } from "../../src/core/verification.js";
import type { SessionJournal } from "../../src/core/journal.js";

function journal(actions: SessionJournal["turns"][number]["actions"]): SessionJournal {
  return { version: 1, turns: [{ id: "t", sequence: 1, startedAt: "now", endedAt: "now", status: "completed", userMessageIndex: 0, assistantMessageIndex: 1, attempts: [], actions }] };
}

describe("verification state", () => {
  it("derives changes and checks in action order", () => {
    expect(deriveVerificationStatus(journal([]))).toBe("not_applicable");
    expect(deriveVerificationStatus(journal([{ type: "workspace_mutation", step: 0, tool: "edit_text_file" }]))).toBe("not_run");
    expect(deriveVerificationStatus(journal([{ type: "workspace_mutation", step: 0, tool: "edit_text_file" }, { type: "verification", step: 1, outcome: "passed" }]))).toBe("passed_after_last_change");
    expect(deriveVerificationStatus(journal([{ type: "workspace_mutation", step: 0, tool: "edit_text_file" }, { type: "verification", step: 1, outcome: "failed" }]))).toBe("failed_after_last_change");
  });
  it("invalidates a prior pass after a later mutation", () => {
    expect(deriveVerificationStatus(journal([{ type: "workspace_mutation", step: 0, tool: "write_text_file" }, { type: "verification", step: 1, outcome: "passed" }, { type: "workspace_mutation", step: 2, tool: "edit_text_file" }]))).toBe("not_run");
  });
});
