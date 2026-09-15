import { describe, expect, it } from "vitest";
import { RequestContextBuilder } from "../../src/core/request-context.js";
import type { Message } from "../../src/core/types.js";
import { buildContextProjection, estimateMessageChars, splitConversationUnits } from "../../src/core/context.js";

function turn(index: number, content = `u${index}`): Message[] {
  return [
    { role: "user", content },
    { role: "assistant", content: `a${index}` },
  ];
}

describe("context projection", () => {
  it("groups tool calls and results into one complete conversation unit", () => {
    const messages: Message[] = [
      { role: "system", content: "system" },
      { role: "user", content: "读取文件" },
      { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "read_text_file", arguments: '{"path":"README.md"}' }] },
      { role: "tool", toolCallId: "call-1", content: "README" },
      { role: "assistant", content: "已读取" },
      { role: "user", content: "下一步" },
      { role: "assistant", content: "继续" },
    ];

    expect(splitConversationUnits(messages).map(unit => unit.messages)).toEqual([
      messages.slice(1, 5),
      messages.slice(5),
    ]);
  });

  it("keeps system and current unit while selecting recent complete units", () => {
    const messages: Message[] = [
      { role: "system", content: "system" },
      ...turn(1),
      ...turn(2),
      ...turn(3),
    ];
    const projection = buildContextProjection(messages, { maxTurns: 2, maxChars: 10_000 });

    expect(projection.messages).toEqual([
      messages[0],
      ...messages.slice(3),
    ]);
    expect(projection.truncated).toBe(true);
    expect(projection.units).toHaveLength(2);
  });

  it("honors the character budget without splitting the current unit", () => {
    const messages: Message[] = [
      { role: "system", content: "system" },
      ...turn(1, "old content"),
      ...turn(2, "current content"),
    ];
    const currentUnitChars = messages.slice(3).reduce((total, message) => total + estimateMessageChars(message), 0);
    const projection = buildContextProjection(messages, { maxTurns: 20, maxChars: currentUnitChars + 10 });

    expect(projection.messages).toEqual([messages[0], ...messages.slice(3)]);
    expect(projection.messages).not.toContainEqual(messages[1]);
    expect(projection.units).toHaveLength(1);
  });

  it("rejects invalid projection limits", () => {
    expect(() => buildContextProjection([], { maxTurns: 0, maxChars: 10 })).toThrow("maxContextTurns");
    expect(() => buildContextProjection([], { maxTurns: 1, maxChars: 0 })).toThrow("maxContextChars");
  });

  it("builds a deterministic agent request without mutating history", () => {
    const history: Message[] = [{ role: "system", content: "system" }, { role: "user", content: "继续" }];
    const builder = new RequestContextBuilder({ capabilities: [] });
    const request = builder.build(history, "agent_step", "偏好简洁", {
      goal: "完成任务", confirmedConstraints: [], openQuestions: [], assumptions: [],
    });
    expect(request.messages).toEqual(expect.arrayContaining([
      history[0], history[1],
      expect.objectContaining({ role: "system", content: expect.stringContaining("偏好简洁") }),
      expect.objectContaining({ role: "system", content: expect.stringContaining("完成任务") }),
    ]));
    expect(history).toEqual([{ role: "system", content: "system" }, { role: "user", content: "继续" }]);
  });
});
