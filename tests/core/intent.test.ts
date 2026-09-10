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

  it("falls back to unknown when the provider returns invalid JSON", async () => {
    const result = await new IntentClassifier(new FakeProvider([{ text: "我认为这是执行" }])).classify("讨论如何修改");
    expect(result.kind).toBe("unknown");
    expect(result.requiresUserConfirmation).toBe(true);
  });
});
