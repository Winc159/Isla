import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ArchiveOrganizer, SevenZipTool } from "../resource/archive-organizer.js";
import { BaiduDownloadRunner } from "../resource/baidu-download-runner.js";
import { BdpanRunner } from "../resource/bdpan-runner.js";
import { loadOrCreateResourceConfig } from "../resource/config.js";
import { ResourceService } from "../resource/service.js";
import { ResourceInferenceClient } from "../resource/inference-client.js";
import { loadOrCreateLocalRuntimeConfig } from "../config/local-runtime.js";
import { ResourceWorkerSettings } from "../resource/worker-settings.js";
import { ConfigStore, defaultConfigPath } from "../config/store.js";
import { ResourceSettingsStore } from "../resource/settings.js";

const configPath = resolve(process.argv[2] ?? process.env.ISLA_RESOURCE_CONFIG ?? join(homedir(), ".isla", "resource.json"));
const runtimeConfig = await loadOrCreateLocalRuntimeConfig();
const config = await loadOrCreateResourceConfig(configPath, runtimeConfig);
const inferenceClient = new ResourceInferenceClient({ endpoint: config.isla.endpoint, token: config.isla.token });
const sevenZip = resolveSevenZip();
const bdpan = resolveBdpan();
const service = new ResourceService({
  config,
  archiveOrganizer: new ArchiveOrganizer(new SevenZipTool(sevenZip), config.limits),
  baiduDownloader: new BaiduDownloadRunner(new BdpanRunner(bdpan, process.env.BDPAN_CONFIG_PATH)),
  baiduBrowser: new BdpanRunner(bdpan, process.env.BDPAN_CONFIG_PATH),
  inferenceClient,
  workerSettings: new ResourceWorkerSettings(new ConfigStore(defaultConfigPath()), { endpoint: config.isla.endpoint, token: config.isla.token }),
  resourceSettings: new ResourceSettingsStore(configPath, runtimeConfig),
  token: process.env.ISLA_RESOURCE_TOKEN ?? runtimeConfig.resource.token,
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
