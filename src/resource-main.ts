import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ArchiveOrganizer, SevenZipTool } from "./resource/archive-organizer.js";
import { BaiduDownloadRunner } from "./resource/baidu-download-runner.js";
import { BdpanRunner } from "./resource/bdpan-runner.js";
import { parseResourceConfig } from "./resource/config.js";
import { ResourceService } from "./resource/service.js";

const configPath = resolve(process.argv[2] ?? process.env.ISLA_RESOURCE_CONFIG ?? join(homedir(), ".isla", "resource.json"));
if (!existsSync(configPath)) {
  console.error(`Resource 配置不存在：${configPath}`);
  console.error("请根据 README 的 Resource 配置示例创建文件，或传入配置路径。");
  process.exit(2);
}

const config = parseResourceConfig(readFileSync(configPath, "utf8"));
const sevenZip = resolveSevenZip();
const bdpan = resolveBdpan();
const service = new ResourceService({
  config,
  archiveOrganizer: new ArchiveOrganizer(new SevenZipTool(sevenZip), config.limits),
  baiduDownloader: new BaiduDownloadRunner(new BdpanRunner(bdpan, process.env.BDPAN_CONFIG_PATH)),
  baiduBrowser: new BdpanRunner(bdpan, process.env.BDPAN_CONFIG_PATH),
  ...(process.env.ISLA_RESOURCE_TOKEN ? { token: process.env.ISLA_RESOURCE_TOKEN } : {}),
});
const address = await service.start();
console.log(`Isla Resource 已启动：http://${address.host}:${address.port}/resource`);
console.log(`配置：${configPath}`);

let closing = false;
async function close(): Promise<void> { if (closing) return; closing = true; await service.close(); }
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { void close().finally(() => process.exit(0)); });

function resolveSevenZip(): string {
  if (process.env.ISLA_7Z_PATH) return process.env.ISLA_7Z_PATH;
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Isla", "tools", "7zip", "26.00", "7z.exe");
  return "7zz";
}

function resolveBdpan(): string {
  if (process.env.ISLA_BDPAN_PATH) return process.env.ISLA_BDPAN_PATH;
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "bdpan", "bdpan.exe");
  return "bdpan";
}
