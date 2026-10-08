import { describe, expect, it } from "vitest";
import { createProjectDiscoveryCapability } from "../../src/tools/project-discovery.js";
import { createProjectFilesCapability } from "../../src/tools/project-files.js";

describe("capability instructions", () => {
  it("requires reading source documents after discovery matches", () => {
    expect(createProjectDiscoveryCapability(process.cwd()).instructions).toContain("必须对最相关的源文档调用 read_text_file");
  });

  it("delegates user-requested write confirmation to Runtime Approval", () => {
    const instructions = createProjectFilesCapability(process.cwd()).instructions;
    expect(instructions).toContain("即使用户说“执行前先确认”");
    expect(instructions).toContain("直接发起写入 Tool Call");
  });
});
