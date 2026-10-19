import { describe, expect, it } from "vitest";
import { BaiduDownloadRunner } from "../../src/resource/baidu-download-runner.js";

const context = { agentName: "isla", sessionInput: "用户原始输入", sessionId: "1784035443-a1b2c3" } as const;
describe("Baidu download runner", () => {
  it("maps a share download to the Skill command and preserves structured result fields", async () => {
    let captured: readonly string[] = [];
    const runner = new BaiduDownloadRunner({ run: async (_operation, args) => { captured = args; return { code: 0, stdout: JSON.stringify({ agent_reply: "完成", saved_path: "目标目录/文件.zip" }), stderr: "" }; } });
    await expect(runner.download({ shareUrl: "https://pan.baidu.com/s/fixture", destinationPath: "D:/staging", shareCode: "ab12", remoteTarget: "/apps/bdpan/inbox" }, context)).resolves.toMatchObject({ code: 0, agentReply: "完成", savedPath: "目标目录/文件.zip" });
    expect(captured).toEqual(["https://pan.baidu.com/s/fixture", "D:/staging", "-p", "ab12", "-t", "/apps/bdpan/inbox"]);
  });

  it("rejects non-Baidu URLs before starting a child process", async () => { const runner = new BaiduDownloadRunner({ run: async () => { throw new Error("must not run"); } }); await expect(runner.download({ shareUrl: "https://example.com/file", destinationPath: "D:/staging" }, context)).rejects.toThrow("BDPAN_SHARE_URL_INVALID"); });
  it("accepts share/init links produced by the Baidu web UI", async () => { const runner = new BaiduDownloadRunner({ run: async () => ({ code: 0, stdout: "{}", stderr: "" }) }); await expect(runner.download({ shareUrl: "https://pan.baidu.com/share/init?surl=fixture_01", destinationPath: "D:/staging/file.pkg", shareCode: "ab12" }, context)).resolves.toMatchObject({ code: 0 }); });
  it("downloads a file from the authenticated user's drive without share flags", async () => { let captured: readonly string[] = []; const runner = new BaiduDownloadRunner({ run: async (_operation, args) => { captured = args; return { code: 0, stdout: "{}", stderr: "" }; } }); await runner.download({ remotePath: "/apps/bdpan/file.pkg", destinationPath: "D:/staging/file.pkg" }, context); expect(captured).toEqual(["/apps/bdpan/file.pkg", "D:/staging/file.pkg"]); });
  it("uses the bdpan JSON business code even when the process exits zero", async () => {
    const runner = new BaiduDownloadRunner({ run: async () => ({ code: 0, stdout: JSON.stringify({ code: 1, data: null, error: "prohibit transfer self share link" }), stderr: "" }) });
    await expect(runner.download({ shareUrl: "https://pan.baidu.com/s/fixture", destinationPath: "D:/staging" }, context)).resolves.toMatchObject({ code: 1, error: "prohibit transfer self share link" });
  });
  it("reads successful fields from the nested bdpan data object", async () => {
    const runner = new BaiduDownloadRunner({ run: async () => ({ code: 0, stdout: JSON.stringify({ code: 0, data: { agent_reply: "完成", saved_path: "D:/staging/file.zip" }, error: "" }), stderr: "" }) });
    await expect(runner.download({ shareUrl: "https://pan.baidu.com/s/fixture", destinationPath: "D:/staging" }, context)).resolves.toMatchObject({ code: 0, agentReply: "完成", savedPath: "D:/staging/file.zip" });
  });
});
