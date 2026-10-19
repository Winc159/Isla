import { describe, expect, it } from "vitest";
import { buildBdpanArgs } from "../../src/resource/bdpan-runner.js";

const context = { agentName: "isla", sessionInput: "用户提供的原始文本", sessionId: "1784035443-a1b2c3" } as const;
describe("bdpan runner contract", () => {
  it("adds required Skill context and JSON output", () => expect(buildBdpanArgs("download", ["https://pan.baidu.com/s/mock", "D:/downloads"], context)).toEqual(["download", "https://pan.baidu.com/s/mock", "D:/downloads", "--json", "--agentname", "isla", "--session-input", "用户提供的原始文本", "--session-id", "1784035443-a1b2c3"]));
  it("rejects remote paths outside the Skill sandbox", () => expect(() => buildBdpanArgs("ls", ["/tmp/private"], context)).toThrow("BDPAN_REMOTE_PATH_FORBIDDEN"));
  it("allows browsing the app root and bdpan root", () => {
    expect(buildBdpanArgs("ls", ["/"], context)[1]).toBe("/");
    expect(buildBdpanArgs("ls", ["/apps/bdpan"], context)[1]).toBe("/apps/bdpan");
  });
  it("does not provide a login operation", () => expect(() => buildBdpanArgs("whoami", ["login"], context)).toThrow("BDPAN_LOGIN_MUST_USE_SKILL_SCRIPT"));
});
