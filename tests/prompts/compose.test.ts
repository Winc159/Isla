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
    expect(messages[3]?.content).toContain("直接返回 write_text_file Tool Call");
    expect(messages[3]?.content).toContain("批准由 Runtime 自动发起");
    expect(messages[2]?.content).toContain("只能使用当前会话中用户明确提供的约束");
    expect(messages[2]?.content).not.toContain("只负责理解当前任务并返回一个 JSON");
  });

  it("keeps identity and capabilities together in the agent-step phase", () => {
    const messages = composeRequestMessages(
      [{ role: "user", content: "查看项目" }],
      [createProjectFilesCapability(process.cwd())],
      "agent_step",
    );
    expect(messages.map(message => message.content).join("\n")).toContain("简洁、可靠的个人助理");
    expect(messages.map(message => message.content).join("\n")).toContain("能力 project-files");
  });
});
