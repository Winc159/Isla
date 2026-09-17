import { describe, expect, it } from "vitest";
import { evaluateCompletionGate } from "../../src/core/completion-gate.js";

describe("completion gate", () => {
  it("accepts ordinary yield without requiring a tool", () => {
    expect(evaluateCompletionGate({})).toEqual({ accepted: true });
  });

  it("rejects missing required evidence and bounds repeated repair", () => {
    const input = { requiredExternalEvidence: true, successfulExternalEvidence: false } as const;
    expect(evaluateCompletionGate(input)).toMatchObject({ accepted: false, reason: "required_evidence_missing" });
    expect(evaluateCompletionGate({ ...input, priorRejections: ["required_evidence_missing"] })).toMatchObject({ terminal: "blocked" });
  });

  it("requires one result for every tool call", () => {
    expect(evaluateCompletionGate({ toolCallIds: ["a", "b"], toolResultIds: ["a"] })).toMatchObject({ accepted: false, reason: "tool_result_missing" });
    expect(evaluateCompletionGate({ toolCallIds: ["a"], toolResultIds: ["a"] })).toEqual({ accepted: true });
  });

  it("rejects active, unapproved, and cancelled turns", () => {
    expect(evaluateCompletionGate({ activeToolCount: 1 })).toMatchObject({ reason: "active_tool" });
    expect(evaluateCompletionGate({ unapprovedActionCount: 1 })).toMatchObject({ reason: "approval_missing" });
    expect(evaluateCompletionGate({ cancelled: true })).toMatchObject({ reason: "turn_cancelled" });
  });

  it("does not reject subjective answer quality", () => {
    expect(evaluateCompletionGate({})).toEqual({ accepted: true });
  });

  it("requires one verification opportunity after a mutation", () => {
    const input = { verificationStatus: "not_run" } as const;
    expect(evaluateCompletionGate(input)).toMatchObject({ accepted: false, reason: "verification_missing_after_mutation" });
    expect(evaluateCompletionGate({ ...input, priorRejections: ["verification_missing_after_mutation"] })).toEqual({ accepted: true });
  });

  it("blocks repeated completion after a failed verification", () => {
    const input = { verificationStatus: "failed_after_last_change" } as const;
    expect(evaluateCompletionGate(input)).toMatchObject({ accepted: false, reason: "verification_failed_after_mutation" });
    expect(evaluateCompletionGate({ ...input, priorRejections: ["verification_failed_after_mutation"] })).toMatchObject({ accepted: false, terminal: "blocked" });
  });

  it("accepts completed or inapplicable verification states", () => {
    expect(evaluateCompletionGate({ verificationStatus: "passed_after_last_change" })).toEqual({ accepted: true });
    expect(evaluateCompletionGate({ verificationStatus: "not_applicable" })).toEqual({ accepted: true });
  });
});
