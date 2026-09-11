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

  it("retries one invalid structured response before falling back", async () => {
    const provider = new FakeProvider([
      { text: "not json" },
      { text: '{"kind":"answer","goal":"你好","needsHistory":true,"needsTools":false,"requiresUserConfirmation":false,"missingInformation":[],"requiredEvidence":[]}' },
    ]);
    await expect(new IntentClassifier(provider).classify("你好")).resolves.toMatchObject({ kind: "answer" });
    expect(provider.requests).toHaveLength(2);
  });

  it("normalizes contradictory tool fields and prioritizes discussion semantics", async () => {
    const provider = new FakeProvider([{ text: '{"kind":"execute","goal":"讨论删除旧文件的方案","needsHistory":false,"needsTools":true,"requiresUserConfirmation":true,"missingInformation":[]}' }]);
    await expect(new IntentClassifier(provider).classify("讨论删除旧文件的方案")).resolves.toMatchObject({ kind: "discuss", needsTools: false, requiresUserConfirmation: false });
    const answerProvider = new FakeProvider([{ text: '{"kind":"answer","goal":"你好","needsHistory":false,"needsTools":true,"requiresUserConfirmation":true,"missingInformation":[]}' }]);
    await expect(new IntentClassifier(answerProvider).classify("你好")).resolves.toMatchObject({ kind: "answer", needsTools: false, requiresUserConfirmation: false });
  });

  it("does not let explicit file creation be downgraded to inspect", async () => {
    const provider = new FakeProvider([{ text: '{"kind":"inspect","goal":"查看当前项目目录","needsHistory":false,"needsTools":true,"requiresUserConfirmation":false,"missingInformation":[],"requiredEvidence":["目录列表"]}' }]);
    await expect(new IntentClassifier(provider).classify("在当前项目目录创建 acceptance.txt，写入内容 ok")).resolves.toMatchObject({
      kind: "execute",
      needsTools: true,
      requiresUserConfirmation: true,
    });
  });

  it("corrects a valid but overly cautious unknown for an ordinary greeting", async () => {
    const result = await new IntentClassifier(new FakeProvider([{ text: '{"kind":"unknown","goal":"你好呀","needsHistory":false,"needsTools":false,"requiresUserConfirmation":true,"missingInformation":[]}' }])).classify("你好呀");
    expect(result.kind).toBe("answer");
    expect(result.requiresUserConfirmation).toBe(false);
  });

  it("keeps capability questions as answer even when the model returns inspect", async () => {
    const provider = new FakeProvider([{ text: '{"kind":"inspect","goal":"了解项目能力","needsHistory":false,"needsTools":true,"requiresUserConfirmation":false,"missingInformation":[]}' }]);
    const result = await new IntentClassifier(provider).classify("你是谁，你能做什么？");
    expect(result.kind).toBe("answer");
    expect(result.needsTools).toBe(false);
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

  it("derives evidence categories for fallback inspections", async () => {
    await expect(new IntentClassifier(new FakeProvider([{ text: "invalid" }])).classify("查看 README 文件")).resolves.toMatchObject({ kind: "inspect", requiredEvidence: ["文件内容"] });
    await expect(new IntentClassifier(new FakeProvider([{ text: "invalid" }])).classify("列出当前目录")).resolves.toMatchObject({ kind: "inspect", requiredEvidence: ["目录列表"] });
  });
});
