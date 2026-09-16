import { describe, expect, it, vi } from "vitest";
import { createAskUserQuestionTool } from "../../src/tools/user-interaction.js";

describe("ask_user_question tool", () => {
  it("pauses on the question service and returns stable ids in JSON", async () => {
    const ask = vi.fn(async () => ({ answers: [{ id: "mode", selected: ["Safe"] }] }));
    const tool = createAskUserQuestionTool({ ask });
    const output = await tool.execute(JSON.stringify({ questions: [{ id: "mode", question: "Choose mode", options: [{ label: "Safe" }] }] }));

    expect(ask).toHaveBeenCalledWith({ questions: [{ id: "mode", question: "Choose mode", options: [{ label: "Safe" }] }] }, {});
    expect(JSON.parse(output as string)).toEqual({ answers: [{ id: "mode", selected: ["Safe"] }] });
  });

  it("rejects empty, duplicate, and excessive questions", async () => {
    const tool = createAskUserQuestionTool({ ask: vi.fn() });
    await expect(tool.execute('{"questions":[]}')).rejects.toMatchObject({ code: "INVALID_ARGUMENTS" });
    await expect(tool.execute(JSON.stringify({ questions: [{ id: "same", question: "One?" }, { id: "same", question: "Two?" }] }))).rejects.toMatchObject({ code: "INVALID_ARGUMENTS" });
    await expect(tool.execute(JSON.stringify({ questions: [1, 2, 3, 4].map(id => ({ id: String(id), question: "Question?" })) }))).rejects.toMatchObject({ code: "INVALID_ARGUMENTS" });
  });
});
