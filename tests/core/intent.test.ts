import { describe, expect, it } from "vitest";
import { IntentClassifier } from "../../src/core/intent.js";
import { FakeProvider } from "../support/fake-provider.js";

describe("IntentClassifier", () => {
  it("parses a structured inspect intent with an intent-only prompt", async () => {
    const provider = new FakeProvider([{ text: '{"kind":"inspect","goal":"了解项目","needsHistory":false,"needsTools":true,"requiresUserConfirmation":false,"missingInformation":[]}' }]);
    const result = await new IntentClassifier(provider).classify("查看当前文件夹，了解一下自己");
    expect(result.kind).toBe("inspect");
    expect(provider.requests[0]?.messages.map(message => message.content).join("\n")).not.toContain("个人助理");
  });

  it("uses the input to safely recover a discussion intent when the provider returns invalid JSON", async () => {
    const result = await new IntentClassifier(new FakeProvider([{ text: "我认为这是执行" }])).classify("讨论如何修改");
    expect(result.kind).toBe("discuss");
    expect(result.requiresUserConfirmation).toBe(false);
  });

  it("corrects a valid but overly cautious unknown for an ordinary greeting", async () => {
    const result = await new IntentClassifier(new FakeProvider([{ text: '{"kind":"unknown","goal":"你好呀","needsHistory":false,"needsTools":false,"requiresUserConfirmation":true,"missingInformation":[]}' }])).classify("你好呀");
    expect(result.kind).toBe("answer");
    expect(result.requiresUserConfirmation).toBe(false);
  });

  it.each([
    ["你好", "answer"],
    ["你是谁", "answer"],
    ["查看项目", "inspect"],
    ["讨论如何修改", "discuss"],
    ["修改文件", "execute"],
    ["帮我处理一下", "unknown"],
  ] as const)("uses a safe fallback for %s", async (input, kind) => {
    const result = await new IntentClassifier(new FakeProvider([{ text: "invalid" }])).classify(input);
    expect(result.kind).toBe(kind);
  });
});
