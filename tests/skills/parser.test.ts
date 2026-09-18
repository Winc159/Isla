import { describe, expect, it } from "vitest";
import { parseSkillText } from "../../src/skills/parser.js";

describe("skill parser", () => {
  it("parses a constrained bundle", () => {
    const result = parseSkillText("---\nname: release-check\ndescription: Check releases\n---\n\nRead package.json first.", "/tmp/release-check/SKILL.md", "workspace");
    expect(result.definition).toMatchObject({ name: "release-check", description: "Check releases", modelInvocable: true, userInvocable: true, content: "Read package.json first." });
  });

  it("rejects invalid names and mismatched directories", () => {
    expect(parseSkillText("---\nname: Release\ndescription: x\n---\nx", "/tmp/release/SKILL.md", "workspace").diagnostic?.code).toBe("SKILL_INVALID_NAME");
    expect(parseSkillText("---\nname: other\ndescription: x\n---\nx", "/tmp/release/SKILL.md", "workspace").diagnostic?.code).toBe("SKILL_INVALID_NAME");
  });

  it("accepts explicit invocation policy and rejects non-boolean values", () => {
    expect(parseSkillText("---\nname: private\ndescription: x\nmodel-invocable: false\nuser-invocable: true\n---\nx", "/tmp/private/SKILL.md", "workspace").definition).toMatchObject({ modelInvocable: false, userInvocable: true });
    expect(parseSkillText("---\nname: bad\ndescription: x\nmodel-invocable: yes\n---\nx", "/tmp/bad/SKILL.md", "workspace").diagnostic?.code).toBe("SKILL_INVALID");
  });

  it("bounds description and body", () => {
    expect(parseSkillText("---\nname: huge\ndescription: too long\n---\nbody", "/tmp/huge/SKILL.md", "workspace", { maxDescriptionChars: 3 }).diagnostic?.code).toBe("SKILL_TOO_LARGE");
  });
});
