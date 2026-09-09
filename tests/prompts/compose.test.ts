import { describe, expect, it } from "vitest";
import { composeRequestMessages } from "../../src/prompts/compose.js";
import { createProjectFilesCapability } from "../../src/tools/project-files.js";

describe("prompt composition", () => {
  it("keeps requests unchanged when no capability is loaded", () => {
    const history = [{ role: "user" as const, content: "你好" }];
    expect(composeRequestMessages(history, [])).toEqual(history);
  });

  it("layers personality, runtime policy, capability instructions, and history", () => {
    const messages = composeRequestMessages(
      [{ role: "system", content: "自定义人格" }, { role: "user", content: "读取文件" }],
      [createProjectFilesCapability(process.cwd())],
    );
    expect(messages.map(message => message.role)).toEqual(["system", "system", "system", "system", "user"]);
    expect(messages[3]?.content).toContain("不得根据历史上下文猜测");
  });
});
