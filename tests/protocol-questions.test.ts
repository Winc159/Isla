import { describe, expect, it } from "vitest";
import { ProtocolUserQuestionService } from "../src/protocol/questions.js";

describe("ProtocolUserQuestionService", () => {
  it("waits for a matching response and preserves answer ids", async () => {
    const emitted: string[] = [];
    const service = new ProtocolUserQuestionService(questionId => emitted.push(questionId));
    const pending = service.ask({ questions: [{ id: "mode", question: "Choose?" }] });
    await Promise.resolve();

    expect(emitted).toEqual(["question-1"]);
    expect(service.resolve({ type: "question_response", id: "r1", questionId: "other", answers: [{ id: "mode", selected: ["Safe"] }] })).toBe(false);
    expect(service.resolve({ type: "question_response", id: "r2", questionId: "question-1", answers: [{ id: "wrong", selected: ["Safe"] }] })).toBe(false);
    expect(service.resolve({ type: "question_response", id: "r3", questionId: "question-1", answers: [{ id: "mode", selected: ["Safe"] }] })).toBe(true);
    await expect(pending).resolves.toEqual({ answers: [{ id: "mode", selected: ["Safe"] }] });
  });

  it("rejects the pending question on cancellation", async () => {
    const service = new ProtocolUserQuestionService(() => {});
    const controller = new AbortController();
    const pending = service.ask({ questions: [{ id: "mode", question: "Choose?" }] }, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "TURN_CANCELLED" });
  });
});
