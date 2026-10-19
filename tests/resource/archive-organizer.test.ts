import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ArchiveOrganizer, normalizeExtractedTree, SevenZipTool } from "../../src/resource/archive-organizer.js";

const executable = process.env.ISLA_7Z_PATH;
let root: string | undefined;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });
describe.skipIf(!executable)("archive organizer real tool", () => {
  it("inspects, tests, extracts, verifies and publishes a renamed archive", async () => {
    root = mkdtempSync(join(tmpdir(), "isla-archive-organizer-")); const input = join(root, "input"); mkdirSync(input); writeFileSync(join(input, "中文内容.txt"), "complete", "utf8");
    const archive = join(root, "fixture.mp4"); expect(spawnSync(executable!, ["a", "-tzip", archive, join(input, "*")], { stdio: "ignore" }).status).toBe(0);
    const organizer = new ArchiveOrganizer(new SevenZipTool(executable!), { maxFiles: 10, maxExtractedBytes: 10_000, maxSingleFileBytes: 10_000, maxExpansionRatio: 100 });
    const output = join(root, "published"); const result = await organizer.organize({ archivePath: archive, stagingPath: join(root, "staging"), outputPath: output });
    expect(result.inspection.format).toBe("zip"); expect(result.files).toEqual([{ relativePath: "中文内容.txt", size: 8 }]); expect(readFileSync(join(output, "中文内容.txt"), "utf8")).toBe("complete"); expect(existsSync(join(root, "staging"))).toBe(false);
  });
  it("tries bounded password candidates and reports the successful candidate index", async () => {
    root = mkdtempSync(join(tmpdir(), "isla-archive-password-")); const input = join(root, "input"); mkdirSync(input); writeFileSync(join(input, "secret.txt"), "protected", "utf8"); const archive = join(root, "protected.zip");
    expect(spawnSync(executable!, ["a", "-tzip", archive, join(input, "*"), "-pcorrect-password", "-mem=AES256"], { stdio: "ignore" }).status).toBe(0);
    const organizer = new ArchiveOrganizer(new SevenZipTool(executable!), { maxFiles: 10, maxExtractedBytes: 10_000, maxSingleFileBytes: 10_000, maxExpansionRatio: 100 });
    await expect(organizer.organize({ archivePath: archive, stagingPath: join(root, "missing-staging"), outputPath: join(root, "missing-output") })).rejects.toThrow("ARCHIVE_PASSWORD_REQUIRED");
    const result = await organizer.organize({ archivePath: archive, stagingPath: join(root, "staging"), outputPath: join(root, "output"), passwordCandidates: ["wrong", "correct-password"] });
    expect(result.successfulPasswordIndex).toBe(1); expect(readFileSync(join(root, "output", "secret.txt"), "utf8")).toBe("protected");
  });
});

describe("archive output tree normalization", () => {
  it("lifts a meaningless single wrapper and removes empty directories", () => {
    root = mkdtempSync(join(tmpdir(), "isla-archive-tree-")); const staging = join(root, "staging"); mkdirSync(join(staging, "未命名文件夹", "empty"), { recursive: true }); writeFileSync(join(staging, "未命名文件夹", "video.mp4"), "video");
    normalizeExtractedTree(staging, join(root, "有意义的电影名.zip"));
    expect(readFileSync(join(staging, "video.mp4"), "utf8")).toBe("video"); expect(existsSync(join(staging, "未命名文件夹"))).toBe(false);
  });

  it("preserves a meaningful series directory", () => {
    root = mkdtempSync(join(tmpdir(), "isla-archive-tree-")); const staging = join(root, "staging"); mkdirSync(join(staging, "第一季"), { recursive: true }); writeFileSync(join(staging, "第一季", "EP01.mp4"), "video");
    normalizeExtractedTree(staging, join(root, "完整系列.zip"));
    expect(readFileSync(join(staging, "第一季", "EP01.mp4"), "utf8")).toBe("video");
  });

  it("removes a meaningless wrapper inside a meaningful resource folder", () => {
    root = mkdtempSync(join(tmpdir(), "isla-archive-tree-")); const staging = join(root, "staging"); mkdirSync(join(staging, "电影名称", "新建文件夹"), { recursive: true }); writeFileSync(join(staging, "电影名称", "新建文件夹", "movie.mp4"), "video"); writeFileSync(join(staging, "电影名称", "新建文件夹", "cover.jpg"), "cover");
    normalizeExtractedTree(staging, join(root, "资源包.zip"));
    expect(readFileSync(join(staging, "电影名称", "movie.mp4"), "utf8")).toBe("video"); expect(readFileSync(join(staging, "电影名称", "cover.jpg"), "utf8")).toBe("cover"); expect(existsSync(join(staging, "电影名称", "新建文件夹"))).toBe(false);
  });
});
