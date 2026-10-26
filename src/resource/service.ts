import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { closeSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, writeSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResourceConfigV1 } from "./config.js";
import { migrateResourceDatabase } from "./database-schema.js";
import { parseConfirmResourceJobRequestV1, parseCreateResourceJobRequestV1, type ResourceEventTypeV1, type ResourceJobSnapshotV1 } from "./contracts.js";
import { parseResourceShareText, parseShareTextNeedsWorker, splitResourceShareText } from "./parser.js";
import { chooseResourceName } from "./naming.js";
import { chooseResourceNameWithWorker } from "./title-worker.js";
import { ResourceScheduler } from "./scheduler.js";
import type { ArchiveOrganizeRequest, ArchiveOrganizeResult } from "./archive-organizer.js";
import type { BaiduDownloadRequest, BaiduDownloadResult } from "./baidu-download-runner.js";
import type { BdpanContext } from "./bdpan-runner.js";
import { RESOURCE_TOOLBOX } from "./toolbox.js";
import { inspectArchive } from "./archive.js";
import type { ResourceInferenceClient } from "./inference-client.js";
import type { ResourceWorkerSettings } from "./worker-settings.js";
import type { ResourceSettingsStore } from "./settings.js";
import { probeResourceExternalTools, type ExternalToolReport } from "./external-tools.js";

export interface ResourceServiceOptions {
  readonly config: ResourceConfigV1;
  readonly token?: string;
  readonly archiveOrganizer?: { organize(request: ArchiveOrganizeRequest, signal?: AbortSignal): Promise<ArchiveOrganizeResult> };
  readonly baiduDownloader?: { download(request: BaiduDownloadRequest, context: BdpanContext, signal?: AbortSignal): Promise<BaiduDownloadResult> };
  readonly baiduBrowser?: { list(path: string, context: BdpanContext, signal?: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }>; run?(operation: "whoami", args: readonly string[], context: BdpanContext, signal?: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }>; loginUrl?(context: BdpanContext): Promise<{ code: number; stdout: string; stderr: string }>; loginCode?(code: string, context: BdpanContext): Promise<{ code: number; stdout: string; stderr: string }> };
  readonly inferenceClient?: ResourceInferenceClient;
  readonly workerSettings?: ResourceWorkerSettings;
  readonly resourceSettings?: ResourceSettingsStore;
  readonly trashPolicy?: { readonly retentionMs: number; readonly maxBytes: number };
}

export interface ResourceServiceAddress {
  readonly host: string;
  readonly port: number;
  readonly token: string;
}

export class ResourceService {
  readonly token: string;
  private readonly db: DatabaseSync;
  private readonly server = createServer((request, response) => { void this.handle(request, response); });
  private closed = false;
  private readonly scheduler: ResourceScheduler;
  private scanTimer?: NodeJS.Timeout;
  private externalTools: readonly ExternalToolReport[] = [];

  constructor(private readonly options: ResourceServiceOptions) {
    mkdirSync(dirname(options.config.databasePath), { recursive: true });
    this.db = new DatabaseSync(options.config.databasePath, { enableForeignKeyConstraints: true, timeout: 5_000, defensive: true });
    migrateResourceDatabase(this.db);
    this.scheduler = new ResourceScheduler(this.db, { concurrency: options.config.concurrency });
    this.token = options.token ?? randomBytes(32).toString("hex");
  }

  async start(): Promise<ResourceServiceAddress> {
    if (this.closed) throw new Error("RESOURCE_SERVICE_CLOSED");
    await new Promise<void>((resolve, reject) => { this.server.once("error", reject); this.server.listen(this.options.config.listen.port, this.options.config.listen.host, resolve); });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("RESOURCE_SERVICE_ADDRESS_UNAVAILABLE");
    this.recoverQueuedJobs();
    this.cleanupTrash();
    this.externalTools = await probeResourceExternalTools();
    this.scanTimer = setInterval(() => { void this.scanSavedFolders(false); this.cleanupExpiredStaging(); }, this.options.config.scanning.intervalMs);
    this.scanTimer.unref();
    return { host: this.options.config.listen.host, port: address.port, token: this.token };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.scanTimer) clearInterval(this.scanTimer);
    await new Promise<void>(resolve => this.server.close(() => resolve())).catch(() => undefined); await this.scheduler.stop();
    this.db.close();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === "GET" && request.url === "/api/v1/resource/health") { this.send(response, 200, this.health()); return; }
    if (request.method === "GET" && request.url === "/resource") {
      if (!this.originAllowed(request)) { this.send(response, 403, { error: { code: "ORIGIN_FORBIDDEN", message: "请求来源不被允许。", retryable: false } }); return; }
      response.setHeader("set-cookie", `isla_resource=${this.token}; HttpOnly; SameSite=Strict; Path=/api/v1/resource`);
      const webUi = this.reactWebUi();
      if (!webUi) { this.send(response, 503, { error: { code: "RESOURCE_UI_NOT_BUILT", message: "Resource UI 尚未构建，请先运行 npm run resource:ui:build。", retryable: false } }); return; }
      this.sendHtml(response, webUi);
      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/resource/assets/")) {
      const asset = request.url.slice("/resource/".length);
      const path = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/resource-ui", asset);
      if (!existsSync(path)) { response.statusCode = 404; response.end("Not found"); return; }
      response.setHeader("content-type", extname(path) === ".js" ? "text/javascript; charset=utf-8" : extname(path) === ".css" ? "text/css; charset=utf-8" : "application/octet-stream");
      response.setHeader("cache-control", "public, max-age=31536000, immutable"); response.end(readFileSync(path));
      return;
    }
    if (!this.authorized(request)) { this.send(response, 401, { error: { code: "UNAUTHORIZED", message: "认证失败。", retryable: false } }); return; }
    if (!this.originAllowed(request)) { this.send(response, 403, { error: { code: "ORIGIN_FORBIDDEN", message: "请求来源不被允许。", retryable: false } }); return; }
    try {
      const url = new URL(request.url ?? "/", `http://${this.options.config.listen.host}`);
      if (request.method === "GET" && url.pathname === "/api/v1/resource/config/public") { this.send(response, 200, this.publicConfig()); return; }
      if (request.method === "GET" && url.pathname === "/api/v1/resource/settings/worker") { if (!this.options.workerSettings) throw new Error("WORKER_SETTINGS_UNAVAILABLE"); this.send(response, 200, await this.options.workerSettings.read()); return; }
      if (request.method === "PUT" && url.pathname === "/api/v1/resource/settings/worker") { if (!this.options.workerSettings) throw new Error("WORKER_SETTINGS_UNAVAILABLE"); this.send(response, 200, await this.options.workerSettings.update(await this.readBody(request))); return; }
      if (request.method === "POST" && url.pathname === "/api/v1/resource/settings/worker/test") { if (!this.options.workerSettings) throw new Error("WORKER_SETTINGS_UNAVAILABLE"); this.send(response, 200, { active: await this.options.workerSettings.active() }); return; }
      if (request.method === "GET" && url.pathname === "/api/v1/resource/settings/directories") { if (!this.options.resourceSettings) throw new Error("RESOURCE_SETTINGS_UNAVAILABLE"); this.send(response, 200, await this.options.resourceSettings.read()); return; }
      if (request.method === "PUT" && url.pathname === "/api/v1/resource/settings/directories") { if (!this.options.resourceSettings) throw new Error("RESOURCE_SETTINGS_UNAVAILABLE"); this.send(response, 200, { ...(await this.options.resourceSettings.update(await this.readBody(request))), restartRequired: true }); return; }
      if (request.method === "GET" && url.pathname === "/api/v1/resource/baidu/tree") { this.send(response, 200, await this.listBaiduTree(url.searchParams.get("path") ?? "/")); return; }
      if (request.method === "GET" && url.pathname === "/api/v1/resource/baidu/status") { this.send(response, 200, await this.baiduStatus()); return; }
      if (request.method === "POST" && url.pathname === "/api/v1/resource/baidu/login/start") { this.send(response, 200, await this.baiduLoginStart()); return; }
      if (request.method === "POST" && url.pathname === "/api/v1/resource/baidu/login/complete") { this.send(response, 200, await this.baiduLoginComplete(await this.readBody(request))); return; }
      if (request.method === "GET" && url.pathname === "/api/v1/resource/local/tree") { this.send(response, 200, this.listLocalTree(url.searchParams.get("rootId") ?? "", url.searchParams.get("path") ?? ".")); return; }
      if (request.method === "POST" && url.pathname === "/api/v1/resource/files/rename") { this.send(response, 200, this.renameManagedPath(await this.readBody(request))); return; }
      if (request.method === "POST" && url.pathname === "/api/v1/resource/files/move") { this.send(response, 200, this.moveManagedPath(await this.readBody(request))); return; }
      if (request.method === "POST" && url.pathname === "/api/v1/resource/files/trash") { this.send(response, 200, this.trashManagedPath(await this.readBody(request))); return; }
      if (request.method === "GET" && url.pathname === "/api/v1/resource/files/trash") { this.send(response, 200, { entries: this.listTrash() }); return; }
      if (request.method === "POST" && url.pathname === "/api/v1/resource/files/restore") { this.send(response, 200, this.restoreTrash(await this.readBody(request))); return; }
      if (request.method === "GET" && url.pathname === "/api/v1/resource/settings/passwords") { this.send(response, 200, { passwords: this.listArchivePasswords() }); return; }
      if (request.method === "POST" && url.pathname === "/api/v1/resource/settings/passwords") { this.send(response, 201, { passwords: this.addArchivePasswords(await this.readBody(request)) }); return; }
      if (request.method === "DELETE" && url.pathname === "/api/v1/resource/settings/passwords") { this.send(response, 200, { deleted: this.deleteArchivePasswords(await this.readBody(request)) }); return; }
      if (request.method === "POST" && url.pathname === "/api/v1/resource/scans") { this.send(response, 202, this.scanFolder(await this.readBody(request), true)); return; }
      if (request.method === "POST" && url.pathname === "/api/v1/resource/jobs/batch") { this.send(response, 201, { jobs: this.createBatchJobs(await this.readBody(request)) }); return; }
      if (request.method === "POST" && url.pathname === "/api/v1/resource/jobs") { const value = await this.readBody(request); const idempotencyKey = request.headers["idempotency-key"]; if (Array.isArray(idempotencyKey)) throw new Error("IDEMPOTENCY_KEY_INVALID"); this.send(response, 201, idempotencyKey ? this.createIdempotentJob(value, idempotencyKey) : { job: this.createJob(value) }); return; }
      if (request.method === "GET" && url.pathname === "/api/v1/resource/jobs") { const hasLimit = url.searchParams.has("limit"); const requested = hasLimit ? Number(url.searchParams.get("limit")) : undefined; const status = url.searchParams.get("status") ?? undefined; if (requested !== undefined && (!Number.isSafeInteger(requested) || requested < 1 || requested > 100)) throw new Error("JOB_LIMIT_INVALID"); if (status && !["queued", "running", "waiting_user", "cancelling", "completed", "failed", "cancelled"].includes(status)) throw new Error("JOB_STATUS_INVALID"); const jobs = this.listJobs(status, requested); this.send(response, 200, { jobs: url.searchParams.get("projection") === "agent" ? jobs.map(job => projectAgentJob(job, this.listArtifactTree(job.id))) : jobs }); return; }
      const match = url.pathname.match(/^\/api\/v1\/resource\/jobs\/([^/]+)(?:\/(cancel|confirm|retry|repeat|events|tree))?$/u);
      if (!match) { this.send(response, 404, { error: { code: "NOT_FOUND", message: "资源不存在。", retryable: false } }); return; }
      const id = decodeURIComponent(match[1]!);
      if (request.method === "GET" && !match[2]) { const job = this.getJob(id); if (!job) { this.send(response, 404, { error: { code: "JOB_NOT_FOUND", message: "任务不存在。", retryable: false } }); return; } this.send(response, 200, { job: url.searchParams.get("projection") === "agent" ? projectAgentJob(job, this.listArtifactTree(id)) : job }); return; }
      if (request.method === "GET" && match[2] === "events") { this.send(response, 200, { events: this.listJobEvents(id) }); return; }
      if (request.method === "GET" && match[2] === "tree") { const tree = this.listArtifactTree(id); const artifactId = url.searchParams.get("artifactId"); this.send(response, 200, { tree: artifactId ? tree.filter(item => item.id === artifactId) : tree }); return; }
      if (request.method === "DELETE" && !match[2]) { this.send(response, 200, { deleted: this.deleteTerminalJob(id) }); return; }
      if (request.method === "POST" && match[2] === "cancel") { const value = await this.readBody(request); const revision = value && typeof value === "object" && "expectedRevision" in value ? (value as { expectedRevision?: unknown }).expectedRevision : undefined; this.send(response, 200, { accepted: this.cancelJob(id, Number.isSafeInteger(revision) ? revision as number : undefined) }); return; }
      if (request.method === "POST" && match[2] === "confirm") { this.send(response, 202, { accepted: this.confirmJob(id, await this.readBody(request)) }); return; }
      if (request.method === "POST" && match[2] === "retry") { this.send(response, 202, { accepted: this.retryJob(id, await this.readBody(request)) }); return; }
      if (request.method === "POST" && match[2] === "repeat") { this.send(response, 201, { job: this.repeatJob(id) }); return; }
      this.send(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "方法不支持。", retryable: false } });
    } catch (error) {
      const requestError = error instanceof ResourceRequestError ? error : undefined;
      this.send(response, 400, { error: { code: requestError?.code ?? (error instanceof Error ? error.message : "RESOURCE_REQUEST_FAILED"), message: requestError?.userMessage ?? "请求无效。", retryable: false, ...(requestError?.details ? { details: requestError.details } : {}) } });
    }
  }

  private async listBaiduTree(path: string): Promise<Record<string, unknown>> {
    if (!this.options.baiduBrowser) throw new Error("BDPAN_BROWSER_UNAVAILABLE");
    if (!path.startsWith("/") || path.includes("\0") || path.includes("..")) throw new Error("BDPAN_REMOTE_PATH_INVALID");
    const context: BdpanContext = { agentName: "isla", sessionInput: `list ${path}`, sessionId: `list-${Date.now()}` };
    const result = await this.options.baiduBrowser.list(path, context);
    let payload: unknown;
    try { payload = JSON.parse(result.stdout); } catch { throw new Error("BDPAN_RESPONSE_INVALID"); }
    if (result.code !== 0 || (payload && typeof payload === "object" && "code" in payload && Number((payload as { code?: unknown }).code) !== 0)) throw new Error("BDPAN_LIST_FAILED");
    return { path, entries: payload };
  }
  private async baiduStatus(): Promise<Record<string, unknown>> { if (!this.options.baiduBrowser?.run) return { status: "unavailable", message: "bdpan runner 未配置。" }; const context: BdpanContext = { agentName: "isla", sessionInput: "whoami", sessionId: `whoami-${Date.now()}` }; try { const result = await this.options.baiduBrowser.run("whoami", [], context); if (result.code !== 0) return { status: "signed_out", message: "百度网盘尚未登录。" }; let payload: unknown; try { payload = JSON.parse(result.stdout); } catch { payload = undefined; } const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : {}; return { status: "signed_in", account: typeof data.account === "string" ? data.account : typeof data.username === "string" ? data.username : undefined }; } catch { return { status: "unavailable", message: "无法执行 bdpan，请运行 npm run doctor。" }; } }
  private async baiduLoginStart(): Promise<Record<string, unknown>> { if (!this.options.baiduBrowser?.loginUrl) throw new Error("BDPAN_LOGIN_UNAVAILABLE"); const result = await this.options.baiduBrowser.loginUrl({ agentName: "isla", sessionInput: "login", sessionId: `login-${Date.now()}` }); if (result.code !== 0) throw new Error("BDPAN_LOGIN_URL_FAILED"); return { authorization: result.stdout.trim() }; }
  private async baiduLoginComplete(value: unknown): Promise<Record<string, unknown>> { if (!this.options.baiduBrowser?.loginCode || !value || typeof value !== "object" || typeof (value as { code?: unknown }).code !== "string") throw new Error("BDPAN_LOGIN_CODE_INVALID"); const result = await this.options.baiduBrowser.loginCode((value as { code: string }).code, { agentName: "isla", sessionInput: "login", sessionId: `login-${Date.now()}` }); if (result.code !== 0) throw new Error("BDPAN_LOGIN_FAILED"); return { status: "signed_in" }; }

  private listLocalTree(rootId: string, relativePath: string): Record<string, unknown> {
    const root = this.options.config.managedRoots.find(item => item.id === rootId);
    if (!root) throw new Error("MANAGED_ROOT_INVALID");
    if (relativePath.includes("..") || /^[\\/]/u.test(relativePath)) throw new Error("SCAN_PATH_INVALID");
    const target = resolve(root.path, relativePath);
    const relativeTarget = relative(root.path, target);
    if (relativeTarget.startsWith("..") || relativeTarget.includes(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("SCAN_PATH_INVALID");
    if (!existsSync(target) || !statSync(target).isDirectory()) throw new Error("LOCAL_DIRECTORY_NOT_FOUND");
    this.assertRealPathInsideRoot(root.path, target);
    const entries = readdirSync(target, { withFileTypes: true }).filter(entry => entry.name !== ".isla-trash" && !entry.isSymbolicLink()).map(entry => { const entryPath = relativePath === "." ? entry.name : join(relativePath, entry.name).replaceAll("\\", "/"); const fullPath = join(target, entry.name); const info = lstatSync(fullPath); return { name: entry.name, path: entryPath, type: entry.isDirectory() ? "directory" : "file", size: entry.isDirectory() ? undefined : info.size, modifiedAt: info.mtime.toISOString(), ...(entry.isFile() ? { archiveCandidate: this.isArchiveCandidate(fullPath) } : {}) }; });
    return { rootId, path: relativePath, entries };
  }

  private isArchiveCandidate(path: string): boolean { const fd = openSync(path, "r"); try { const info = lstatSync(path); const header = Buffer.alloc(Math.min(1024 * 1024, info.size)); const length = readSync(fd, header, 0, header.length, 0); return inspectArchive(path, header.subarray(0, length), info.size).isArchive; } finally { closeSync(fd); } }

  private managedTarget(value: unknown, key = "path"): { root: ResourceConfigV1["managedRoots"][number]; path: string; absolute: string } {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("FILE_REQUEST_INVALID"); const input = value as Record<string, unknown>; const rootId = input.rootId; const path = input[key]; if (typeof rootId !== "string" || typeof path !== "string" || !path || path.includes("..") || /^[\\/]/u.test(path)) throw new Error("FILE_PATH_INVALID"); const root = this.options.config.managedRoots.find(item => item.id === rootId); if (!root) throw new Error("MANAGED_ROOT_INVALID"); const absolute = resolve(root.path, path); const rel = relative(root.path, absolute); if (rel.startsWith("..") || /^[\\/]/u.test(rel) || rel === ".isla-trash" || rel.startsWith(`.isla-trash${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("FILE_PATH_RESERVED"); return { root, path, absolute }; }
  private renameManagedPath(value: unknown): Record<string, unknown> { const target = this.managedTarget(value); const name = value as { name?: unknown }; if (typeof name.name !== "string" || !name.name.trim() || name.name.includes("\\") || name.name.includes("/")) throw new Error("FILE_NAME_INVALID"); if (!existsSync(target.absolute)) throw new Error("FILE_NOT_FOUND"); this.assertRealPathInsideRoot(target.root.path, target.absolute); const destination = join(dirname(target.absolute), name.name.trim()); if (existsSync(destination)) throw new Error("FILE_DESTINATION_EXISTS"); this.assertPathAvailable(target.root.id, target.path, relative(target.root.path, destination).replaceAll("\\", "/")); renameSync(target.absolute, destination); return { path: relative(target.root.path, destination).replaceAll("\\", "/") }; }
  private moveManagedPath(value: unknown): Record<string, unknown> { const source = this.managedTarget(value); const input = value as { destinationPath?: unknown }; if (typeof input.destinationPath !== "string") throw new Error("FILE_DESTINATION_INVALID"); const destination = this.managedTarget({ rootId: source.root.id, path: input.destinationPath }); if (!existsSync(source.absolute) || !existsSync(destination.absolute) || !statSync(destination.absolute).isDirectory()) throw new Error("FILE_DESTINATION_INVALID"); this.assertRealPathInsideRoot(source.root.path, source.absolute); this.assertRealPathInsideRoot(source.root.path, destination.absolute); const target = join(destination.absolute, basename(source.absolute)); if (existsSync(target)) throw new Error("FILE_DESTINATION_EXISTS"); this.assertPathAvailable(source.root.id, source.path, relative(source.root.path, target).replaceAll("\\", "/")); renameSync(source.absolute, target); return { path: relative(source.root.path, target).replaceAll("\\", "/") }; }
  private trashManagedPath(value: unknown): Record<string, unknown> { const source = this.managedTarget(value); if (!existsSync(source.absolute)) throw new Error("FILE_NOT_FOUND"); this.assertRealPathInsideRoot(source.root.path, source.absolute); this.assertPathAvailable(source.root.id, source.path); const trashRoot = join(source.root.path, ".isla-trash"); mkdirSync(trashRoot, { recursive: true }); const id = randomUUID(); const trashPath = join(trashRoot, id); renameSync(source.absolute, trashPath); const size = this.pathSize(trashPath); const now = new Date().toISOString(); this.db.prepare("INSERT INTO resource_trash_entries (id, managed_root_id, original_path, trash_path, size_bytes, deleted_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, source.root.id, source.path, trashPath, size, now); this.cleanupTrash(); return { id, originalPath: source.path, sizeBytes: size }; }
  private listTrash(): readonly Record<string, unknown>[] { return this.db.prepare("SELECT id, managed_root_id AS managedRootId, original_path AS originalPath, size_bytes AS sizeBytes, deleted_at AS deletedAt FROM resource_trash_entries ORDER BY deleted_at DESC").all() as unknown as Array<Record<string, unknown>>; }
  private restoreTrash(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as { id?: unknown }).id !== "string") throw new Error("TRASH_REQUEST_INVALID"); const row = this.db.prepare("SELECT * FROM resource_trash_entries WHERE id = ?").get((value as { id: string }).id) as { id: string; managed_root_id: string; original_path: string; trash_path: string } | undefined; if (!row) throw new Error("TRASH_ENTRY_NOT_FOUND"); const root = this.options.config.managedRoots.find(item => item.id === row.managed_root_id); if (!root || !existsSync(row.trash_path)) throw new Error("TRASH_ENTRY_NOT_FOUND"); const target = resolve(root.path, row.original_path); if (existsSync(target)) throw new Error("FILE_DESTINATION_EXISTS"); this.assertPathAvailable(root.id, row.original_path); mkdirSync(dirname(target), { recursive: true }); this.assertRealPathInsideRoot(root.path, dirname(target)); renameSync(row.trash_path, target); this.db.prepare("DELETE FROM resource_trash_entries WHERE id = ?").run(row.id); return { restored: row.original_path }; }
  private assertRealPathInsideRoot(rootPath: string, targetPath: string): void { const root = realpathSync(rootPath); const target = realpathSync(targetPath); const rel = relative(root, target); if (rel.startsWith("..") || /^[\\/]/u.test(rel)) throw new Error("FILE_SYMLINK_ESCAPE"); }
  private assertPathAvailable(rootId: string, ...paths: readonly string[]): void { const claims = this.activeManagedClaims(rootId); for (const path of paths) { const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, ""); const claim = claims.find(item => pathsIntersect(normalized, item.path)); if (claim) throw new ResourceRequestError("FILE_IN_USE", "文件正在被资源任务使用。", { jobId: claim.jobId, path: normalized }); } }
  private activeManagedClaims(rootId: string): readonly { jobId: string; path: string }[] {
    const rows = this.db.prepare("SELECT id, input_json FROM resource_jobs WHERE status IN ('queued','running','waiting_user','cancelling')").all() as unknown as Array<{ id: string; input_json: string }>;
    const claims: Array<{ jobId: string; path: string }> = [];
    for (const row of rows) { try { const input = parseCreateResourceJobRequestV1(JSON.parse(row.input_json)); if (input.input.kind !== "managed-folder" && input.input.kind !== "managed-file") continue; if (input.input.managedRootId === rootId) claims.push({ jobId: row.id, path: input.input.relativePath.replaceAll("\\", "/") }); } catch { /* 旧任务输入损坏时不扩大文件占用范围 */ } }
    const root = this.options.config.managedRoots.find(item => item.id === rootId);
    if (!root) return claims;
    for (const row of this.db.prepare("SELECT a.job_id AS jobId, a.relative_path AS path FROM resource_artifacts a JOIN resource_jobs j ON j.id = a.job_id WHERE j.status IN ('queued','running','waiting_user','cancelling')").all() as unknown as Array<{ jobId: string; path: string }>) { const rel = relative(root.path, row.path).replaceAll("\\", "/"); if (rel && rel !== "." && !rel.startsWith("..") && !/^[\\/]/u.test(rel)) claims.push({ jobId: row.jobId, path: rel }); }
    return claims;
  }
  private pathSize(path: string): number { const info = lstatSync(path); if (info.isFile()) return info.size; return readdirSync(path).reduce((sum, entry) => sum + this.pathSize(join(path, entry)), 0); }
  private cleanupTrash(): void { const max = this.options.trashPolicy?.maxBytes ?? 100 * 1024 * 1024 * 1024; const expiry = Date.now() - (this.options.trashPolicy?.retentionMs ?? 30 * 24 * 60 * 60 * 1000); const rows = this.db.prepare("SELECT * FROM resource_trash_entries ORDER BY deleted_at ASC").all() as unknown as Array<{ id: string; trash_path: string; size_bytes: number; deleted_at: string }>; let total = rows.reduce((sum, row) => sum + row.size_bytes, 0); for (const row of rows) { if (total <= max && Date.parse(row.deleted_at) >= expiry) continue; if (existsSync(row.trash_path)) rmSync(row.trash_path, { recursive: true, force: true }); this.db.prepare("DELETE FROM resource_trash_entries WHERE id = ?").run(row.id); total -= row.size_bytes; } }

  private listArchivePasswords(): readonly Record<string, unknown>[] { return (this.db.prepare("SELECT password, success_count AS successCount, first_succeeded_at AS firstSucceededAt, last_succeeded_at AS lastSucceededAt FROM resource_archive_passwords ORDER BY success_count DESC, last_succeeded_at DESC").all() as unknown as Array<Record<string, unknown>>); }
  private addArchivePasswords(value: unknown): readonly Record<string, unknown>[] {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PASSWORDS_REQUEST_INVALID");
    const raw = (value as { passwords?: unknown }).passwords;
    if (!Array.isArray(raw)) throw new Error("PASSWORDS_REQUEST_INVALID");
    const passwords = [...new Set(raw.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(item => item.length > 0 && item.length <= 256))].slice(0, 500);
    const now = new Date().toISOString(); const insert = this.db.prepare("INSERT INTO resource_archive_passwords (password, success_count, first_succeeded_at, last_succeeded_at) VALUES (?, 0, ?, ?) ON CONFLICT(password) DO NOTHING"); for (const password of passwords) insert.run(password, now, now);
    return this.listArchivePasswords();
  }
  private deleteArchivePasswords(value: unknown): number {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PASSWORDS_REQUEST_INVALID");
    const raw = (value as { passwords?: unknown }).passwords;
    if (!Array.isArray(raw)) throw new Error("PASSWORDS_REQUEST_INVALID");
    const passwords = raw.filter((item): item is string => typeof item === "string" && item.length <= 256);
    const remove = this.db.prepare("DELETE FROM resource_archive_passwords WHERE password = ?"); let deleted = 0; for (const password of passwords) deleted += Number(remove.run(password).changes ?? 0); return deleted;
  }

  private health(): Record<string, unknown> { return { ok: true, apiVersion: 1, service: "resource", database: "ready", isla: { configured: true }, queue: { queued: this.count("queued"), running: this.count("running") }, externalTools: this.externalTools }; }
  private publicConfig(): Record<string, unknown> { return { version: 1, tools: RESOURCE_TOOLBOX, managedRoots: this.options.config.managedRoots.map(root => ({ id: root.id, label: root.label, scanEnabled: root.scanEnabled, outputEnabled: root.outputEnabled })), defaultDestinationRootId: this.options.config.defaultDestinationRootId, concurrency: this.options.config.concurrency, scanning: this.options.config.scanning }; }
  private createBatchJobs(value: unknown): readonly ResourceJobSnapshotV1[] {
    const input = parseCreateResourceJobRequestV1(value);
    if (input.tool !== "baidu-download" || input.input.kind !== "share-text") throw new Error("BATCH_INPUT_INVALID");
    const blocks = splitResourceShareText(input.input.text);
    if (blocks.length === 0) return [this.createJob(input)];
    return blocks.map(text => {
      const jobInput = { ...input, input: { kind: "share-text" as const, text } };
      const job = this.createJob(jobInput);
      const parsed = parseResourceShareText(text);
      if (input.startMode === "automatic" && ((input.input.kind === "share-text" && parsed.shareUrls.length === 1) || input.input.kind === "baidu-path") && this.options.baiduDownloader) {
        this.startBaiduJob(job.id, JSON.stringify(jobInput), JSON.stringify(parsed));
        return this.getJob(job.id)!;
      }
      return job;
    });
  }
  private createJob(value: unknown): ResourceJobSnapshotV1 {
    const input = parseCreateResourceJobRequestV1(value);
    const destination = this.options.config.managedRoots.find(root => root.id === input.destinationRootId && root.outputEnabled);
    if (!destination) throw new Error("DESTINATION_ROOT_INVALID");
    const ruleResult = input.tool === "baidu-download" && input.input.kind === "share-text" ? parseResourceShareText(input.input.text) : { shareUrls: [], shareCodeCandidates: [], archivePasswordCandidates: [], titleCandidates: [], warnings: [] };
    const now = new Date().toISOString();
    const id = randomUUID();
    const missingShare = input.tool === "baidu-download" && input.input.kind === "share-text" && ruleResult.shareUrls.length === 0;
    const record: ResourceJobSnapshotV1 = { version: 1, id, revision: 1, source: input.tool === "baidu-download" ? "baidu" : "managed-folder", status: "waiting_user", stage: "preview", destinationRootId: input.destinationRootId, createdAt: now, updatedAt: now, progress: {}, pendingDecision: { id: randomUUID(), type: missingShare ? "correct_share_input" : "confirm_parse_result", resumeStage: missingShare ? "parsing_rules" : input.tool === "baidu-download" ? "queued_download" : "inspecting", message: missingShare ? "没有识别到有效分享链接，请修改原始输入后继续。" : input.tool === "baidu-download" && input.input.kind === "baidu-path" ? `将从我的网盘下载：${input.input.path}` : input.tool === "baidu-download" ? "请确认分享链接和解析结果。" : "请确认待解压目录和输出位置。", actions: missingShare ? ["replace_input", "reject"] : ["approve", "reject", "provide_values", "choose_destination"] } };
    this.db.prepare("INSERT INTO resource_jobs (id, version, revision, source, status, stage, destination_root_id, input_json, parse_result_json, progress_json, pending_decision_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, 1, 1, record.source, record.status, record.stage, record.destinationRootId, JSON.stringify(input), JSON.stringify(ruleResult), JSON.stringify(record.progress), JSON.stringify(record.pendingDecision), now, now);
    this.db.prepare("INSERT INTO resource_events (id, job_id, sequence, type, data_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)").run(randomUUID(), id, 1, "job.created", JSON.stringify({ stage: "parsing_rules" }), now, randomUUID(), id, 2, "job.waiting_user", JSON.stringify({ stage: "preview", warningCount: ruleResult.warnings.length }), now);
    if (input.tool === "baidu-download" && input.input.kind === "share-text" && this.options.inferenceClient && parseShareTextNeedsWorker(ruleResult)) void this.enrichShareParse(id, input.input.text, ruleResult);
    if (input.tool === "baidu-download" && input.input.kind === "baidu-path" && input.startMode === "automatic" && this.options.baiduDownloader) {
      this.startBaiduJob(id, JSON.stringify(input), JSON.stringify(ruleResult));
      return this.getJob(id)!;
    }
    return record;
  }
  private createIdempotentJob(value: unknown, key: string): { readonly job: ResourceJobSnapshotV1 } {
    if (typeof key !== "string" || !/^[a-f0-9]{64}$/u.test(key)) throw new Error("IDEMPOTENCY_KEY_INVALID");
    const input = parseCreateResourceJobRequestV1(value);
    const normalized = { ...input, startMode: "after-preview" as const };
    const requestHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    const existing = this.db.prepare("SELECT request_hash, response_json FROM resource_idempotency WHERE scope = 'agent' AND key = ?").get(key) as { request_hash: string; response_json: string } | undefined;
    if (existing) { if (existing.request_hash !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT"); return JSON.parse(existing.response_json) as { job: ResourceJobSnapshotV1 }; }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const again = this.db.prepare("SELECT request_hash, response_json FROM resource_idempotency WHERE scope = 'agent' AND key = ?").get(key) as { request_hash: string; response_json: string } | undefined;
      if (again) { if (again.request_hash !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT"); const response = JSON.parse(again.response_json) as { job: ResourceJobSnapshotV1 }; this.db.exec("COMMIT"); return response; }
      const response = { job: this.createJob(normalized) };
      this.db.prepare("INSERT INTO resource_idempotency (scope, key, request_hash, response_json, created_at) VALUES ('agent', ?, ?, ?, ?)").run(key, requestHash, JSON.stringify(response), new Date().toISOString());
      this.db.exec("COMMIT");
      return response;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private async enrichShareParse(id: string, rawText: string, ruleResult: ReturnType<typeof parseResourceShareText>): Promise<void> {
    try {
      const result = await this.options.inferenceClient!.run({ requestId: randomUUID(), role: "resource-worker", task: "resource.parse-share-text", schema: "resource.parse-result.v1", input: { rawText, ruleResult } });
      const output = result.output as ReturnType<typeof parseResourceShareText>;
      const merged = { shareUrls: [...new Set([...ruleResult.shareUrls, ...output.shareUrls])], shareCodeCandidates: [...new Set([...ruleResult.shareCodeCandidates, ...output.shareCodeCandidates])], archivePasswordCandidates: [...new Set([...ruleResult.archivePasswordCandidates, ...output.archivePasswordCandidates])], titleCandidates: [...new Set([...ruleResult.titleCandidates, ...output.titleCandidates])], warnings: [...new Set([...ruleResult.warnings, ...output.warnings])] };
      const row = this.db.prepare("SELECT input_json FROM resource_jobs WHERE id = ?").get(id) as { input_json?: string } | undefined;
      const input = row?.input_json ? parseCreateResourceJobRequestV1(JSON.parse(row.input_json)) : undefined;
      const hasShare = merged.shareUrls.length > 0;
      const pending = hasShare ? { id: randomUUID(), type: "confirm_parse_result" as const, resumeStage: "queued_download" as const, message: "已通过 Worker 补充分享链接，请确认解析结果。", actions: ["approve", "reject", "provide_values", "choose_destination"] as const } : undefined;
      const now = new Date().toISOString();
      this.db.prepare("UPDATE resource_jobs SET parse_result_json = ?, pending_decision_json = ?, revision = revision + 1, updated_at = ? WHERE id = ?").run(JSON.stringify(merged), pending ? JSON.stringify(pending) : null, now, id);
      if (hasShare && input?.startMode === "automatic" && merged.shareUrls.length === 1 && this.options.baiduDownloader && row?.input_json) this.startBaiduJob(id, row.input_json, JSON.stringify(merged));
    } catch { /* Worker 不可用时保留规则解析结果，交给现有人工路径 */ }
  }
  private scanFolder(value: unknown, force: boolean): { readonly watchId: string; readonly jobs: readonly ResourceJobSnapshotV1[] } {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SCAN_REQUEST_INVALID");
    const request = value as { managedRootId?: unknown; relativePath?: unknown; destinationRootId?: unknown };
    if (typeof request.managedRootId !== "string" || typeof request.relativePath !== "string" || typeof request.destinationRootId !== "string") throw new Error("SCAN_REQUEST_INVALID");
    if (request.relativePath.includes("..") || /^[\\/]/u.test(request.relativePath)) throw new Error("SCAN_PATH_INVALID");
    const sourceRoot = this.options.config.managedRoots.find(root => root.id === request.managedRootId && root.scanEnabled);
    const destinationRoot = this.options.config.managedRoots.find(root => root.id === request.destinationRootId && root.outputEnabled);
    if (!sourceRoot || !destinationRoot) throw new Error("MANAGED_ROOT_INVALID");
    const folder = resolve(sourceRoot.path, request.relativePath || ".");
    if (relative(sourceRoot.path, folder).startsWith("..") || !statSync(folder).isDirectory()) throw new Error("SCAN_PATH_INVALID");
    const now = new Date().toISOString();
    const existingWatch = this.db.prepare("SELECT id FROM resource_folder_watches WHERE managed_root_id = ? AND relative_path = ? AND destination_root_id = ?").get(sourceRoot.id, request.relativePath || ".", destinationRoot.id) as { id: string } | undefined;
    const watchId = existingWatch?.id ?? randomUUID();
    this.db.prepare("INSERT INTO resource_folder_watches (id, managed_root_id, relative_path, destination_root_id, enabled, created_at, last_scanned_at) VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(managed_root_id, relative_path, destination_root_id) DO UPDATE SET enabled = 1, last_scanned_at = excluded.last_scanned_at").run(watchId, sourceRoot.id, request.relativePath || ".", destinationRoot.id, now, now);
    const jobs: ResourceJobSnapshotV1[] = [];
    for (const archivePath of this.findArchives(folder)) {
      const relativePath = relative(sourceRoot.path, archivePath).replaceAll("\\", "/"); const stats = statSync(archivePath);
      const ledger = this.db.prepare("SELECT size_bytes, modified_at_ms, state, stable_observations FROM resource_file_ledger WHERE managed_root_id = ? AND relative_path = ?").get(sourceRoot.id, relativePath) as { size_bytes: number; modified_at_ms: number; state: string; stable_observations: number } | undefined;
      const unchanged = ledger?.size_bytes === stats.size && ledger.modified_at_ms === stats.mtimeMs;
      if (unchanged && (ledger?.state === "completed" || ledger?.state === "queued")) continue;
      const observations = unchanged ? (ledger?.stable_observations ?? 0) + 1 : 1;
      this.db.prepare("INSERT INTO resource_file_ledger (managed_root_id, relative_path, size_bytes, modified_at_ms, state, stable_observations, discovered_at, observed_at) VALUES (?, ?, ?, ?, 'settling', ?, ?, ?) ON CONFLICT(managed_root_id, relative_path) DO UPDATE SET size_bytes = excluded.size_bytes, modified_at_ms = excluded.modified_at_ms, state = 'settling', stable_observations = ?, observed_at = excluded.observed_at").run(sourceRoot.id, relativePath, stats.size, stats.mtimeMs, observations, now, now, observations);
      if (!force && observations < 2) continue;
      const input = { tool: "archive-organizer" as const, input: { kind: "managed-folder" as const, managedRootId: sourceRoot.id, relativePath }, destinationRootId: destinationRoot.id, startMode: "automatic" as const };
      const job = this.createJob(input); this.startArchiveJob(job.id, JSON.stringify(input));
      this.db.prepare("UPDATE resource_file_ledger SET state = 'queued', job_id = ? WHERE managed_root_id = ? AND relative_path = ?").run(job.id, sourceRoot.id, relativePath);
      jobs.push(this.getJob(job.id)!);
    }
    return { watchId, jobs };
  }
  private findArchives(folder: string, includeVolumes = false): readonly string[] {
    const archives: string[] = []; const queue = [folder];
    while (queue.length) {
      const current = queue.pop()!;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { queue.push(path); continue; }
        if (!entry.isFile()) continue;
        const fd = openSync(path, "r");
        try { const header = Buffer.alloc(1024 * 1024); const length = readSync(fd, header, 0, header.length, 0); const inspected = inspectArchive(path, header.subarray(0, length), lstatSync(path).size); if (inspected.isArchive && (includeVolumes || !inspected.part || inspected.part.role === "first")) archives.push(path); } finally { closeSync(fd); }
      }
    }
    return archives.sort((a, b) => a.localeCompare(b));
  }
  private findLikelyMedia(folder: string): readonly string[] {
    const media: string[] = []; const queue = [folder];
    while (queue.length) {
      const current = queue.pop()!;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { queue.push(path); continue; }
        if (!entry.isFile()) continue;
        const fd = openSync(path, "r");
        try { const header = Buffer.alloc(1024 * 1024); const length = readSync(fd, header, 0, header.length, 0); const inspected = inspectArchive(path, header.subarray(0, length), lstatSync(path).size); if (inspected.likelyMedia && !inspected.isArchive) media.push(path); } finally { closeSync(fd); }
      }
    }
    return media.sort((a, b) => a.localeCompare(b));
  }
  private findEmbeddedArchives(folder: string): readonly { path: string; offset: number }[] {
    const results: { path: string; offset: number }[] = [];
    const queue = [folder];
    const signatures = [Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("Rar!\x1a\x07\x00", "binary"), Buffer.from("Rar!\x1a\x07\x01\x00", "binary"), Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])];
    while (queue.length) {
      const current = queue.pop()!;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { queue.push(path); continue; }
        if (!entry.isFile() || /^(?:embedded-|archive-probe|embedded\.)/u.test(entry.name)) continue;
        const fd = openSync(path, "r");
        try {
          const size = lstatSync(path).size;
          const chunkSize = 16 * 1024 * 1024;
          const overlap = 8;
          let offset = 0;
          let tail = Buffer.alloc(0);
          while (offset < size) {
            const buffer = Buffer.alloc(Math.min(chunkSize, size - offset));
            const length = readSync(fd, buffer, 0, buffer.length, offset);
            if (!length) break;
            const data = Buffer.concat([tail, buffer.subarray(0, length)]);
            const base = offset - tail.length;
            const found = signatures.map(signature => data.indexOf(signature)).filter(index => index >= 0).sort((a, b) => a - b)[0];
            if (found !== undefined && base + found > 0) {
              const absolute = base + found;
              const signature = signatures.find(item => data.indexOf(item) === found);
              if (signature?.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && !this.hasZipEndMarker(fd, size, absolute)) { tail = data.subarray(Math.max(0, data.length - overlap)); offset += length; continue; }
              results.push({ path, offset: absolute }); break;
            }
            tail = data.subarray(Math.max(0, data.length - overlap));
            offset += length;
          }
        } finally { closeSync(fd); }
      }
    }
    return results.sort((a, b) => a.path.localeCompare(b.path) || a.offset - b.offset);
  }
  private hasZipEndMarker(fd: number, size: number, offset: number): boolean {
    const tailSize = Math.min(8 * 1024 * 1024, size - offset); const buffer = Buffer.alloc(tailSize); const length = readSync(fd, buffer, 0, tailSize, size - tailSize); if (!length) return false;
    const base = size - tailSize; return [Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.from([0x50, 0x4b, 0x06, 0x06])].some(marker => { const position = buffer.indexOf(marker); return position >= 0 && base + position > offset; });
  }
  private materializeEmbeddedArchive(source: { path: string; offset: number }, directory: string): string {
    mkdirSync(directory, { recursive: true }); const output = join(directory, `embedded-${basename(source.path)}-${source.offset}.zip`); const input = openSync(source.path, "r"); const out = openSync(output, "w"); try { const size = statSync(source.path).size; const buffer = Buffer.alloc(16 * 1024 * 1024); let position = source.offset; while (position < size) { const length = readSync(input, buffer, 0, Math.min(buffer.length, size - position), position); if (!length) break; writeSync(out, buffer, 0, length); position += length; } } finally { closeSync(input); closeSync(out); } return output;
  }
  private async scanSavedFolders(force: boolean): Promise<void> {
    const watches = this.db.prepare("SELECT managed_root_id, relative_path, destination_root_id FROM resource_folder_watches WHERE enabled = 1").all() as unknown as Array<{ managed_root_id: string; relative_path: string; destination_root_id: string }>;
    for (const watch of watches) { try { this.scanFolder({ managedRootId: watch.managed_root_id, relativePath: watch.relative_path, destinationRootId: watch.destination_root_id }, force); } catch { /* 单个目录不可用不阻塞其他 watch，下次周期继续 */ } }
  }
  private listJobs(status?: string, limit?: number): readonly ResourceJobSnapshotV1[] { const sqlLimit = limit === undefined ? "" : " LIMIT ?"; const rows = status ? this.db.prepare(`SELECT * FROM resource_jobs WHERE status = ? ORDER BY updated_at DESC${sqlLimit}`).all(...(limit === undefined ? [status] : [status, limit])) : this.db.prepare(`SELECT * FROM resource_jobs ORDER BY updated_at DESC${sqlLimit}`).all(...(limit === undefined ? [] : [limit])); return (rows as unknown as JobRow[]).map(row => this.toJob(row)); }
  private recoverQueuedJobs(): void {
    const rows = this.db.prepare("SELECT id, source, status, stage, input_json, parse_result_json FROM resource_jobs WHERE status IN ('queued','running') ORDER BY updated_at ASC").all() as unknown as Array<{ id: string; source: string; status: string; stage: ResourceJobSnapshotV1["stage"]; input_json: string; parse_result_json: string | null }>;
    for (const row of rows) {
      try {
        const lease = this.db.prepare("SELECT 1 FROM resource_leases WHERE job_id = ? LIMIT 1").get(row.id);
        if (!lease && row.status === "running") {
          const now = new Date().toISOString();
          this.db.prepare("UPDATE resource_jobs SET status = 'failed', revision = revision + 1, failure_json = ?, updated_at = ? WHERE id = ? AND status IN ('queued','running')").run(JSON.stringify({ code: "TASK_RECOVERY_REQUIRED", message: "服务恢复时发现任务没有活动执行租约，已停止假运行状态；可以从安全阶段重试。", retryable: true, resumeStage: row.stage === "queued_download" ? "queued_download" : "inspecting" }), now, row.id);
          this.appendJobEvent(row.id, "job.recovered_stale", { previousStage: row.stage });
          continue;
        }
        if (row.source === "baidu" && row.stage === "queued_download") this.startBaiduJob(row.id, row.input_json, row.parse_result_json);
        else if (row.source === "baidu" && ["inspecting", "grouping_volumes", "testing_archive", "extracting", "verifying", "publishing"].includes(row.stage)) void this.startBaiduExtraction(row.id, row.input_json, row.parse_result_json).catch(error => this.handleJobError(row.id, error, "inspecting"));
      } catch (error) { this.handleJobError(row.id, error, row.stage === "queued_download" ? "queued_download" : "inspecting"); }
    }
  }
  private getJob(id: string): ResourceJobSnapshotV1 | undefined { const row = this.db.prepare("SELECT * FROM resource_jobs WHERE id = ?").get(id) as unknown as JobRow | undefined; return row ? this.toJob(row) : undefined; }
  private listJobEvents(id: string): readonly Record<string, unknown>[] { return (this.db.prepare("SELECT sequence, type, data_json, occurred_at FROM resource_events WHERE job_id = ? ORDER BY sequence").all(id) as unknown as Array<{ sequence: number; type: string; data_json: string; occurred_at: string }>).map(row => ({ sequence: row.sequence, type: row.type, data: JSON.parse(row.data_json), occurredAt: row.occurred_at })); }
  private listArtifactTree(id: string): readonly Record<string, unknown>[] {
    return (this.db.prepare("SELECT id, kind, relative_path, size_bytes, verification_status, source_artifact_id, metadata_json, created_at, updated_at FROM resource_artifacts WHERE job_id = ? ORDER BY relative_path").all(id) as unknown as Array<{ id: string; kind: string; relative_path: string; size_bytes: number | null; verification_status: string; source_artifact_id: string | null; metadata_json: string; created_at: string; updated_at: string }>).map(row => ({ id: row.id, kind: row.kind, path: row.relative_path, sizeBytes: row.size_bytes, status: row.verification_status, parentId: row.source_artifact_id, metadata: JSON.parse(row.metadata_json), createdAt: row.created_at, updatedAt: row.updated_at }));
  }
  private recordArtifact(id: string, path: string, kind: string, status: string, parentId?: string, metadata: Record<string, unknown> = {}): string {
    const now = new Date().toISOString();
    const existing = this.db.prepare("SELECT id FROM resource_artifacts WHERE job_id = ? AND relative_path = ?").get(id, path) as { id?: string } | undefined;
    const artifactId = existing?.id ?? randomUUID();
    const size = existsSync(path) && lstatSync(path).isFile() ? lstatSync(path).size : null;
    this.db.prepare("INSERT INTO resource_artifacts (id, job_id, kind, relative_path, size_bytes, verification_status, source_artifact_id, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(job_id, relative_path) DO UPDATE SET kind=excluded.kind, size_bytes=excluded.size_bytes, verification_status=excluded.verification_status, source_artifact_id=excluded.source_artifact_id, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at").run(artifactId, id, kind, path, size, status, parentId ?? null, JSON.stringify(metadata), now, now);
    return artifactId;
  }
  private appendJobEvent(id: string, type: ResourceEventTypeV1, data: Record<string, unknown>): void { const now = new Date().toISOString(); this.db.prepare("INSERT INTO resource_events (id, job_id, sequence, type, data_json, occurred_at) SELECT ?, id, COALESCE((SELECT MAX(sequence) + 1 FROM resource_events WHERE job_id = resource_jobs.id), 1), ?, ?, ? FROM resource_jobs WHERE id = ?").run(randomUUID(), type, JSON.stringify(data), now, id); }
  private confirmJob(id: string, value: unknown): boolean {
    const decision = parseConfirmResourceJobRequestV1(value);
    const row = this.db.prepare("SELECT revision, source, input_json, parse_result_json, pending_decision_json FROM resource_jobs WHERE id = ?").get(id) as { revision: number; source: string; input_json: string; parse_result_json: string | null; pending_decision_json: string | null } | undefined;
    if (!row || !row.pending_decision_json) throw new Error("JOB_NOT_WAITING_USER");
    const pending = JSON.parse(row.pending_decision_json) as ResourceJobSnapshotV1["pendingDecision"];
    if (decision.revision !== row.revision || decision.decisionId !== pending?.id) throw new Error("DECISION_STALE");
    if (decision.action === "reject") return this.cancelJob(id);
    if (decision.action === "choose_destination") {
      const destinationRootId = typeof decision.values?.destinationRootId === "string" ? decision.values.destinationRootId : "";
      const destination = this.options.config.managedRoots.find(root => root.id === destinationRootId && root.outputEnabled);
      if (!destination) throw new Error("DESTINATION_ROOT_INVALID");
      const nextPending = { ...pending, id: randomUUID(), message: "已选择输出目录，请继续确认任务预览。", actions: pending.actions.filter(action => action !== "choose_destination") };
      this.db.prepare("UPDATE resource_jobs SET revision = revision + 1, destination_root_id = ?, pending_decision_json = ?, updated_at = ? WHERE id = ?").run(destinationRootId, JSON.stringify(nextPending), new Date().toISOString(), id);
      return true;
    }
    if (decision.action === "provide_values" && pending.type === "provide_archive_password") {
      const supplied = [decision.values?.password, ...(Array.isArray(decision.values?.passwords) ? decision.values.passwords : [])].filter((value): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 256).map(value => value.trim());
      if (supplied.length === 0) throw new Error("ARCHIVE_PASSWORD_REQUIRED");
      const now = new Date().toISOString(); const insert = this.db.prepare("INSERT OR IGNORE INTO resource_job_secrets (job_id, kind, secret_value, created_at) VALUES (?, 'archive-password', ?, ?)"); for (const password of supplied.slice(0, 20)) insert.run(id, password, now);
      if (row.source === "baidu") void this.startBaiduExtraction(id, row.input_json, row.parse_result_json).catch(error => this.handleJobError(id, error, "inspecting"));
      else this.startArchiveJob(id, row.input_json);
      return true;
    }
    if (decision.action === "provide_values" && pending.type === "provide_share_code") {
      const shareCode = typeof decision.values?.shareCode === "string" ? decision.values.shareCode.trim() : ""; if (!/^[A-Za-z0-9]{4}$/u.test(shareCode)) throw new Error("SHARE_CODE_INVALID");
      this.db.prepare("INSERT OR REPLACE INTO resource_job_secrets (job_id, kind, secret_value, created_at) VALUES (?, 'share-code', ?, ?)").run(id, shareCode, new Date().toISOString());
      this.startBaiduJob(id, row.input_json, row.parse_result_json); return true;
    }
    if (decision.action === "approve" && pending.resumeStage === "inspecting") { this.startArchiveJob(id, row.input_json); return true; }
    if (decision.action === "approve" && pending.resumeStage === "queued_download") { this.startBaiduJob(id, row.input_json, row.parse_result_json); return true; }
    if (decision.action !== "replace_input") return true;
    const text = typeof decision.values?.text === "string" ? decision.values.text : "";
    const input = parseCreateResourceJobRequestV1(JSON.parse(row.input_json) as unknown);
    if (input.tool !== "baidu-download") throw new Error("INPUT_REPLACEMENT_NOT_SUPPORTED");
    const updated = parseCreateResourceJobRequestV1({ ...input, input: { kind: "share-text", text } });
    const parsed = parseResourceShareText(text);
    const missingShare = parsed.shareUrls.length === 0;
    const now = new Date().toISOString();
    const nextPending: NonNullable<ResourceJobSnapshotV1["pendingDecision"]> = { id: randomUUID(), type: missingShare ? "correct_share_input" : "confirm_parse_result", resumeStage: missingShare ? "parsing_rules" : "queued_download", message: missingShare ? "仍未识别到有效分享链接，请再次修改。" : "已重新解析，请确认分享链接和解析结果。", actions: missingShare ? ["replace_input", "reject"] : ["approve", "reject", "provide_values", "choose_destination"] };
    this.db.prepare("UPDATE resource_jobs SET revision = revision + 1, input_json = ?, parse_result_json = ?, pending_decision_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(updated), JSON.stringify(parsed), JSON.stringify(nextPending), now, id);
    if (!missingShare && updated.startMode === "automatic" && this.options.baiduDownloader) this.startBaiduJob(id, JSON.stringify(updated), JSON.stringify(parsed));
    return true;
  }
  private startArchiveJob(id: string, inputJson: string): void {
    if (!this.options.archiveOrganizer) throw new Error("ARCHIVE_ORGANIZER_NOT_CONFIGURED");
    const input = parseCreateResourceJobRequestV1(JSON.parse(inputJson) as unknown); if (input.tool !== "archive-organizer" || (input.input.kind !== "managed-folder" && input.input.kind !== "managed-file")) throw new Error("ARCHIVE_INPUT_INVALID"); const archiveInput = input.input;
    const sourceRoot = this.options.config.managedRoots.find(root => root.id === archiveInput.managedRootId); const destinationRoot = this.options.config.managedRoots.find(root => root.id === input.destinationRootId && root.outputEnabled);
    if (!sourceRoot || !destinationRoot) throw new Error("MANAGED_ROOT_INVALID");
    const archivePath = resolve(sourceRoot.path, archiveInput.relativePath); if (relative(sourceRoot.path, archivePath).startsWith("..") || archivePath === sourceRoot.path || !existsSync(archivePath) || !statSync(archivePath).isFile()) throw new Error("ARCHIVE_PATH_OUTSIDE_ROOT");
    const decision = chooseResourceName({ downloadedNames: [archiveOutputStem(basename(archivePath))], completedAt: new Date() }); const outputPath = availableOutputPath(destinationRoot.path, decision.name); const stagingPath = join(this.options.config.stagingPath, id, "extracted"); const now = new Date().toISOString();
    this.db.prepare("UPDATE resource_jobs SET status = 'queued', stage = 'inspecting', revision = revision + 1, pending_decision_json = NULL, failure_json = NULL, updated_at = ? WHERE id = ?").run(now, id);
    const passwordCandidates = this.passwordCandidates(id);
    const task = this.scheduler.enqueue(id, "extraction", async signal => { this.setStage(id, "extracting", "running"); return this.options.archiveOrganizer!.organize({ archivePath, stagingPath, outputPath, passwordCandidates }, signal); });
    void task.promise.then(result => { if (result.successfulPasswordIndex !== undefined) this.recordSuccessfulPassword(passwordCandidates[result.successfulPasswordIndex]); const completedAt = new Date().toISOString(); this.db.prepare("UPDATE resource_jobs SET status = 'completed', stage = 'completed', revision = revision + 1, progress_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify({ ratio: 1, completedBytes: result.totalBytes, totalBytes: result.totalBytes }), completedAt, id); this.db.prepare("UPDATE resource_file_ledger SET state = 'completed', observed_at = ? WHERE job_id = ?").run(completedAt, id); }).catch(error => { this.db.prepare("UPDATE resource_file_ledger SET state = 'failed', observed_at = ? WHERE job_id = ?").run(new Date().toISOString(), id); this.handleJobError(id, error, "inspecting"); });
  }
  private startBaiduJob(id: string, inputJson: string, parseResultJson: string | null): void {
    if (!this.options.baiduDownloader) throw new Error("BAIDU_DOWNLOADER_NOT_CONFIGURED");
    const input = parseCreateResourceJobRequestV1(JSON.parse(inputJson) as unknown); if (input.tool !== "baidu-download" || (input.input.kind !== "share-text" && input.input.kind !== "baidu-path")) throw new Error("BAIDU_INPUT_INVALID");
    const parsed = parseResultJson ? JSON.parse(parseResultJson) as { shareUrls?: string[]; shareCodeCandidates?: string[]; archivePasswordCandidates?: string[]; titleCandidates?: string[] } : {};
    const shareUrl = parsed.shareUrls?.[0]; const remotePath = input.input.kind === "baidu-path" ? input.input.path : undefined; if (!shareUrl && !remotePath) throw new Error("SHARE_URL_NOT_FOUND");
    const destinationRoot = this.options.config.managedRoots.find(root => root.id === input.destinationRootId && root.outputEnabled); if (!destinationRoot) throw new Error("DESTINATION_ROOT_INVALID");
    const downloadDirectory = join(this.options.config.stagingPath, id, "download"); const assumedDownloadPath = join(downloadDirectory, "downloaded.bin"); mkdirSync(downloadDirectory, { recursive: true });
    const context: BdpanContext = { agentName: "isla", sessionInput: input.input.kind === "share-text" ? input.input.text : input.input.path, sessionId: `${Math.floor(Date.now() / 1000)}-${id.replaceAll("-", "").slice(0, 6)}` };
    this.db.prepare("UPDATE resource_jobs SET failure_json = NULL, pending_decision_json = NULL WHERE id = ?").run(id);
    this.setStage(id, "queued_download", "queued");
    const suppliedShareCode = (this.db.prepare("SELECT secret_value FROM resource_job_secrets WHERE job_id = ? AND kind = 'share-code' ORDER BY created_at DESC LIMIT 1").get(id) as { secret_value?: string } | undefined)?.secret_value;
    const shareCode = suppliedShareCode ?? parsed.shareCodeCandidates?.[0];
    const download = this.scheduler.enqueue(id, "download", signal => { this.setStage(id, "downloading", "running"); return this.options.baiduDownloader!.download({ ...(shareUrl ? { shareUrl, remoteTarget: `jobs/${id}` } : {}), ...(remotePath ? { remotePath } : {}), destinationPath: assumedDownloadPath, ...(shareCode ? { shareCode } : {}) }, context, signal); });
    void download.promise.then(result => {
      if (result.code !== 0) throw new Error(classifyBaiduDownloadFailure(result));
      if (!this.options.archiveOrganizer) { this.setStage(id, "completed", "completed"); return; }
      void this.startBaiduExtraction(id, inputJson, parseResultJson);
    }).catch(error => this.handleJobError(id, error, "queued_download"));
  }
  private async startBaiduExtraction(id: string, inputJson: string, parseResultJson: string | null): Promise<void> {
    if (!this.options.archiveOrganizer) throw new Error("ARCHIVE_ORGANIZER_NOT_CONFIGURED");
    const input = parseCreateResourceJobRequestV1(JSON.parse(inputJson) as unknown); if (input.tool !== "baidu-download") throw new Error("BAIDU_INPUT_INVALID");
    const parsed = parseResultJson ? JSON.parse(parseResultJson) as { archivePasswordCandidates?: string[]; titleCandidates?: string[] } : {};
    const destinationRoot = this.options.config.managedRoots.find(root => root.id === input.destinationRootId && root.outputEnabled); if (!destinationRoot) throw new Error("DESTINATION_ROOT_INVALID");
    const downloadDirectory = join(this.options.config.stagingPath, id, "download"); const assumedDownloadPath = join(downloadDirectory, "downloaded.bin");
    this.db.prepare("UPDATE resource_jobs SET pending_decision_json = NULL, failure_json = NULL WHERE id = ?").run(id);
    this.setStage(id, "inspecting", "running"); this.appendJobEvent(id, "resource.inspecting", { directory: downloadDirectory }); const discovered = this.findArchives(downloadDirectory); this.appendJobEvent(id, "resource.archives_found", { count: discovered.length, paths: discovered.slice(0, 20).map(path => basename(path)) });
    // bdpan may create a directory at the requested destination. Scan its
    // contents before deciding that the download is not an archive; this also
    // catches archives whose names were deliberately changed to .mp4/.bin.
    let downloadPath = discovered[0];
    const downloadedTree = join(downloadDirectory, "downloaded.bin");
    const publishDownloadedTree = existsSync(downloadedTree) && lstatSync(downloadedTree).isDirectory();
    if (!downloadPath && !publishDownloadedTree) {
      const embedded = this.findEmbeddedArchives(downloadDirectory); this.appendJobEvent(id, "resource.embedded_archives_found", { count: embedded.length, offsets: embedded.slice(0, 20).map(item => item.offset), paths: embedded.slice(0, 20).map(item => basename(item.path)) });
      if (embedded.length > 0) downloadPath = this.materializeEmbeddedArchive(embedded[0]!, downloadDirectory);
      const media = embedded.length > 0 ? [] : this.findLikelyMedia(downloadDirectory);
      if (media.length === 0 && !downloadPath) throw new Error("DOWNLOADED_ARCHIVE_NOT_FOUND");
      if (downloadPath) { /* use the extracted embedded archive */ }
      else {
      // Some resources are advertised as RAR but arrive with a media suffix.
      // Probe a copy with a .rar suffix; the original download is preserved.
      downloadPath = join(downloadDirectory, "archive-probe.rar");
      copyFileSync(media[0]!, downloadPath);
      }
    }
    downloadPath ??= downloadedTree;
    const name = await chooseResourceNameWithWorker(this.options.inferenceClient, { ...(parsed.titleCandidates ? { titleCandidates: parsed.titleCandidates } : {}), downloadedNames: [basename(downloadPath)], completedAt: new Date() }); const outputPath = availableOutputPath(destinationRoot.path, name.name); const stagingPath = join(this.options.config.stagingPath, id, "extracted"); const embeddedArchive = basename(downloadPath).startsWith("embedded-");
    const passwordCandidates = this.passwordCandidates(id, parsed.archivePasswordCandidates ?? []);
    const extraction = this.scheduler.enqueue(id, "extraction", async signal => {
      this.setStage(id, "extracting", "running");
      if (publishDownloadedTree) {
        this.appendJobEvent(id, "resource.directory_publishing", { source: downloadedTree });
        mkdirSync(outputPath, { recursive: true });
        cpSync(downloadedTree, outputPath, { recursive: true, errorOnExist: true });
        const embedded = this.findEmbeddedArchives(downloadDirectory);
        const nestedRoot = join(outputPath, "嵌套压缩包");
        const nestedResults: ArchiveOrganizeResult[] = [];
        let finalOutputPath: string | undefined;
        for (let index = 0; index < embedded.length; index += 1) {
          const candidate = embedded[index]!;
          const candidatePath = this.materializeEmbeddedArchive(candidate, join(stagingPath, "embedded", String(index + 1)));
          const candidateArtifact = this.recordArtifact(id, relative(downloadDirectory, candidatePath), "archive", "validated", undefined, { source: candidate.path, offset: candidate.offset });
          const nestedOutput = join(nestedRoot, String(index + 1).padStart(2, "0"));
          this.appendJobEvent(id, "resource.nested_extract_started", { index: index + 1, source: basename(candidate.path), offset: candidate.offset });
          try {
            const result = await this.options.archiveOrganizer!.organize({ archivePath: candidatePath, stagingPath: join(stagingPath, "nested", String(index + 1)), outputPath: nestedOutput, passwordCandidates }, signal);
            this.recordArtifact(id, relative(downloadDirectory, nestedOutput), "extracted", "completed", candidateArtifact, { fileCount: result.files.length, totalBytes: result.totalBytes });
            nestedResults.push(result);
            this.appendJobEvent(id, "resource.nested_extract_completed", { index: index + 1, outputPath: nestedOutput, fileCount: result.files.length, totalBytes: result.totalBytes });
            const innerArchives = this.findArchives(nestedOutput, true);
            if (innerArchives.length > 0) {
              const firstVolume = innerArchives[0]!; const normalizedFirst = /\.rar$/iu.test(firstVolume) ? firstVolume : `${firstVolume.replace(/\.[^.]+$/u, "")}.rar`; if (normalizedFirst !== firstVolume) renameSync(firstVolume, normalizedFirst);
              const innerOutput = join(nestedOutput, "解压内容");
              this.appendJobEvent(id, "resource.volume_group_detected", { index: index + 1, firstVolume: basename(innerArchives[0]!), count: innerArchives.length });
              const innerResult = await this.options.archiveOrganizer!.organize({ archivePath: normalizedFirst, stagingPath: join(stagingPath, "volumes", String(index + 1)), outputPath: innerOutput, passwordCandidates }, signal);
              const volumeArtifact = this.recordArtifact(id, relative(downloadDirectory, normalizedFirst), "volume-group", "validated", candidateArtifact, { count: innerArchives.length });
              this.recordArtifact(id, relative(downloadDirectory, innerOutput), "extracted", "completed", volumeArtifact, { fileCount: innerResult.files.length, totalBytes: innerResult.totalBytes });
              nestedResults.push(innerResult);
              this.appendJobEvent(id, "resource.volume_group_extracted", { index: index + 1, outputPath: innerOutput, fileCount: innerResult.files.length, totalBytes: innerResult.totalBytes });
              let recursiveRoot = innerOutput;
              for (let depth = 1; depth <= 3; depth += 1) {
                // Prefer files that are already complete archives. Scanning their
                // bytes for signatures creates false positives (notably RAR5
                // payloads containing a random PK marker).
                const directArchives = this.findArchives(recursiveRoot, true);
                const recursive = directArchives.length > 0
                  ? directArchives.map(path => ({ path, offset: 0 }))
                  : this.findEmbeddedArchives(recursiveRoot);
                if (!recursive.length) break;
                this.appendJobEvent(id, "resource.recursive_archives_found", { depth, count: recursive.length, offsets: recursive.slice(0, 20).map(item => item.offset) });
                const recursiveRootNext = join(recursiveRoot, `递归解压-${depth}`); mkdirSync(recursiveRootNext, { recursive: true });
                for (let recursiveIndex = 0; recursiveIndex < recursive.length; recursiveIndex += 1) {
                  const item = recursive[recursiveIndex]!; const extractedArchive = item.offset === 0 ? item.path : this.materializeEmbeddedArchive(item, join(stagingPath, "recursive", String(index + 1), String(depth), String(recursiveIndex + 1)));
                  const recursiveOutput = join(recursiveRootNext, String(recursiveIndex + 1).padStart(2, "0"));
                  try {
                    const recursiveArtifact = this.recordArtifact(id, relative(downloadDirectory, extractedArchive), "archive", "validated", volumeArtifact, { depth, embedded: item.offset !== 0, offset: item.offset });
                    const recursiveResult = await this.options.archiveOrganizer!.organize({ archivePath: extractedArchive, stagingPath: join(stagingPath, "recursive-output", String(index + 1), String(depth), String(recursiveIndex + 1)), outputPath: recursiveOutput, passwordCandidates }, signal);
                    this.recordArtifact(id, relative(downloadDirectory, recursiveOutput), "extracted", "completed", recursiveArtifact, { fileCount: recursiveResult.files.length, totalBytes: recursiveResult.totalBytes });
                    finalOutputPath = recursiveOutput;
                    nestedResults.push(recursiveResult); this.appendJobEvent(id, "resource.recursive_archive_extracted", { depth, index: recursiveIndex + 1, outputPath: recursiveOutput, fileCount: recursiveResult.files.length, totalBytes: recursiveResult.totalBytes });
                  } catch (error) { this.appendJobEvent(id, "resource.recursive_archive_failed", { depth, index: recursiveIndex + 1, code: error instanceof Error ? error.message : "RESOURCE_JOB_FAILED" }); }
                }
                recursiveRoot = recursiveRootNext;
              }
            }
          } catch (error) {
            this.appendJobEvent(id, "resource.nested_extract_failed", { index: index + 1, code: error instanceof Error ? error.message : "RESOURCE_JOB_FAILED" });
          }
        }
        // The selected destination is the user-facing result. Keep the
        // original downloaded tree there, but move only the deepest extracted
        // payload into a clean final folder and remove bulky intermediates.
        const finalSource = finalOutputPath;
        if (finalSource && existsSync(finalSource)) {
          const finalPath = join(outputPath, "最终内容");
          mkdirSync(finalPath, { recursive: true });
          cpSync(finalSource, finalPath, { recursive: true });
        }
        rmSync(nestedRoot, { recursive: true, force: true });
        this.removeEmptyDirectories(outputPath);
        const files = listPublishedFiles(outputPath); const totalBytes = files.reduce((sum, file) => sum + file.size, 0); this.appendJobEvent(id, "resource.published", { outputPath, fileCount: files.length, totalBytes, nestedArchives: nestedResults.length, intermediatesRemoved: true });
        return { inspection: inspectArchive(downloadPath, Buffer.alloc(0)), outputPath, files, totalBytes };
      }
      if (!embeddedArchive) return this.options.archiveOrganizer!.organize({ archivePath: downloadPath, stagingPath, outputPath, passwordCandidates }, signal);
      const outerOutput = join(stagingPath, "outer");
      await this.options.archiveOrganizer!.organize({ archivePath: downloadPath, stagingPath: join(stagingPath, "outer-stage"), outputPath: outerOutput, passwordCandidates }, signal);
      const nested = this.findArchives(outerOutput)[0];
      if (!nested) throw new Error("NESTED_ARCHIVE_NOT_FOUND");
      this.setStage(id, "extracting", "running");
      return this.options.archiveOrganizer!.organize({ archivePath: nested, stagingPath: join(stagingPath, "inner-stage"), outputPath, passwordCandidates }, signal);
    });
    void extraction.promise.then(extracted => { if (extracted.successfulPasswordIndex !== undefined) this.recordSuccessfulPassword(passwordCandidates[extracted.successfulPasswordIndex]); const sourceArtifact = this.recordArtifact(id, relative(downloadDirectory, downloadPath!), "archive", "validated"); this.recordArtifact(id, relative(destinationRoot.path, extracted.outputPath), "extracted", "completed", sourceArtifact, { fileCount: extracted.files.length, totalBytes: extracted.totalBytes }); this.completeJob(id, extracted.totalBytes); }).catch(error => this.handleJobError(id, error, "inspecting"));
  }
  private completeJob(id: string, totalBytes: number): void { this.cleanupIntermediateStaging(id); const now = new Date().toISOString(); this.db.prepare("UPDATE resource_jobs SET status = 'completed', stage = 'completed', revision = revision + 1, progress_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify({ ratio: 1, completedBytes: totalBytes, totalBytes }), now, id); }
  private cleanupIntermediateStaging(id: string): void { rmSync(join(this.options.config.stagingPath, id, "extracted"), { recursive: true, force: true }); this.appendJobEvent(id, "resource.intermediates_removed", { path: "extracted" }); }
  private cleanupExpiredStaging(): void {
    if (!existsSync(this.options.config.stagingPath)) return;
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const entry of readdirSync(this.options.config.stagingPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const taskPath = join(this.options.config.stagingPath, entry.name);
      try { if (statSync(taskPath).mtimeMs < cutoff) rmSync(taskPath, { recursive: true, force: true }); } catch { /* another worker may be using it */ }
    }
  }
  private removeEmptyDirectories(root: string, preserve = true): void {
    if (!existsSync(root) || !lstatSync(root).isDirectory()) return;
    for (const entry of readdirSync(root, { withFileTypes: true })) if (entry.isDirectory()) this.removeEmptyDirectories(join(root, entry.name), false);
    try { if (!preserve && readdirSync(root).length === 0) rmdirSync(root); } catch { /* best effort */ }
  }
  private failJob(id: string, error: unknown, resumeStage: ResourceJobSnapshotV1["stage"]): void { const now = new Date().toISOString(); const code = error instanceof Error ? error.message : "RESOURCE_JOB_FAILED"; const message = code === "DOWNLOADED_CONTENT_IS_MEDIA" ? "下载内容经文件头识别为媒体文件，未发现可解压的压缩包；为避免误信伪装文件，任务未继续。" : code === "DOWNLOADED_ARCHIVE_NOT_FOUND" ? "下载目录中未发现可识别的压缩包。" : "资源任务执行失败。"; this.db.prepare("UPDATE resource_jobs SET status = 'failed', revision = revision + 1, failure_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify({ code, message, retryable: true, resumeStage }), now, id); }
  private handleJobError(id: string, error: unknown, resumeStage: ResourceJobSnapshotV1["stage"]): void {
    const code = error instanceof Error ? error.message : "RESOURCE_JOB_FAILED"; const now = new Date().toISOString();
    const intervention = code === "ARCHIVE_PASSWORD_REQUIRED" ? { type: "provide_archive_password", message: "压缩包需要密码，自动密码候选均未成功。请输入解压密码后继续。", actions: ["provide_values", "reject"] as const }
      : code === "ARCHIVE_VOLUME_INCOMPLETE" ? { type: "resolve_volume_group", message: "压缩分卷不完整。请把缺少的分卷放回原目录后继续。", actions: ["approve", "reject"] as const }
      : code === "BDPAN_SHARE_CODE_REQUIRED" ? { type: "provide_share_code", message: "分享码缺失或不正确。请输入四位分享码后继续。", actions: ["provide_values", "reject"] as const }
      : code === "BDPAN_AUTH_REQUIRED" ? { type: "handle_login", message: "百度网盘登录已失效。请完成登录后继续。", actions: ["approve", "reject"] as const }
      : code === "BDPAN_CAPTCHA_REQUIRED" ? { type: "handle_captcha", message: "百度要求完成验证码。处理完成后可继续当前任务。", actions: ["approve", "reject"] as const }
      : code === "BDPAN_RISK_CONTROL" ? { type: "handle_risk_control", message: "百度触发风控。请在官方客户端处理后继续。", actions: ["approve", "reject"] as const }
      : code === "BDPAN_SELF_SHARE_FORBIDDEN" ? { type: "correct_share_input", message: "百度禁止处理当前账号自己创建的分享，请更换外部分享链接。", actions: ["replace_input", "reject"] as const }
      : undefined;
    if (!intervention) { this.failJob(id, error, resumeStage); return; }
    const pending = { id: randomUUID(), type: intervention.type, resumeStage, message: intervention.message, actions: intervention.actions };
    this.db.prepare("UPDATE resource_jobs SET status = 'waiting_user', revision = revision + 1, pending_decision_json = ?, failure_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(pending), JSON.stringify({ code, message: intervention.message, retryable: true, resumeStage }), now, id);
  }
  private passwordCandidates(id: string, parsed: readonly string[] = []): string[] {
    const supplied = (this.db.prepare("SELECT secret_value FROM resource_job_secrets WHERE job_id = ? AND kind = 'archive-password' ORDER BY created_at DESC").all(id) as unknown as Array<{ secret_value: string }>).map(row => row.secret_value);
    const frequent = (this.db.prepare("SELECT password FROM resource_archive_passwords ORDER BY success_count DESC, last_succeeded_at DESC LIMIT 20").all() as unknown as Array<{ password: string }>).map(row => row.password);
    return [...new Set([...supplied, ...parsed, ...frequent])].slice(0, 20);
  }
  private recordSuccessfulPassword(password: string | undefined): void { if (!password) return; const now = new Date().toISOString(); this.db.prepare("INSERT INTO resource_archive_passwords (password, success_count, first_succeeded_at, last_succeeded_at) VALUES (?, 1, ?, ?) ON CONFLICT(password) DO UPDATE SET success_count = success_count + 1, last_succeeded_at = excluded.last_succeeded_at").run(password, now, now); }
  private retryJob(id: string, value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isSafeInteger((value as { revision?: unknown }).revision)) throw new Error("RETRY_REVISION_INVALID");
    const revision = (value as { revision: number }).revision;
    const organizeOnly = (value as { mode?: unknown }).mode === "organize";
    const row = this.db.prepare("SELECT revision, status, source, input_json, parse_result_json, failure_json FROM resource_jobs WHERE id = ?").get(id) as { revision: number; status: string; source: string; input_json: string; parse_result_json: string | null; failure_json: string | null } | undefined;
    if (!organizeOnly && row?.status === "running") throw new Error("JOB_ALREADY_RUNNING");
    if (organizeOnly) {
      if (!row || row.source !== "baidu" || !["completed", "failed"].includes(row.status)) throw new Error(row?.status === "running" ? "JOB_ALREADY_RUNNING" : "ORGANIZE_RETRY_UNAVAILABLE");
      if (row.revision !== revision) throw new Error("DECISION_STALE");
      this.setStage(id, "inspecting", "running"); this.appendJobEvent(id, "resource.organize_retry_started", {});
      setImmediate(() => void this.startBaiduExtraction(id, row.input_json, row.parse_result_json).catch(error => this.handleJobError(id, error, "inspecting")));
      return true;
    }
    if (!row || row.status !== "failed" || !row.failure_json) throw new Error("JOB_NOT_RETRYABLE");
    if (row.revision !== revision) throw new Error("DECISION_STALE");
    const failure = JSON.parse(row.failure_json) as { retryable?: boolean; resumeStage?: ResourceJobSnapshotV1["stage"] };
    if (!failure.retryable) throw new Error("JOB_NOT_RETRYABLE");
    if (row.source === "baidu" && failure.resumeStage === "queued_download") this.startBaiduJob(id, row.input_json, row.parse_result_json);
    else if (row.source === "baidu" && failure.resumeStage === "inspecting") setImmediate(() => void this.startBaiduExtraction(id, row.input_json, row.parse_result_json).catch(error => this.handleJobError(id, error, "inspecting")));
    else if (row.source === "managed-folder" && failure.resumeStage === "inspecting") this.startArchiveJob(id, row.input_json);
    else throw new Error("RETRY_STAGE_UNSUPPORTED");
    return true;
  }
  private setStage(id: string, stage: ResourceJobSnapshotV1["stage"], status: ResourceJobSnapshotV1["status"]): void { this.db.prepare("UPDATE resource_jobs SET status = ?, stage = ?, revision = revision + 1, updated_at = ? WHERE id = ?").run(status, stage, new Date().toISOString(), id); }
  private cancelJob(id: string, expectedRevision?: number): boolean { const row = this.db.prepare("SELECT status, revision FROM resource_jobs WHERE id = ?").get(id) as { status?: string; revision?: number } | undefined; if (!row || row.status === "completed" || row.status === "failed" || row.status === "cancelled") return false; if (expectedRevision !== undefined && expectedRevision !== row.revision) throw new Error("JOB_REVISION_STALE"); const now = new Date().toISOString(); this.db.prepare("UPDATE resource_jobs SET status = 'cancelled', revision = revision + 1, updated_at = ? WHERE id = ?").run(now, id); this.db.prepare("INSERT INTO resource_events (id, job_id, sequence, type, data_json, occurred_at) SELECT ?, id, COALESCE((SELECT MAX(sequence) + 1 FROM resource_events WHERE job_id = resource_jobs.id), 1), 'job.cancelled', '{}', ? FROM resource_jobs WHERE id = ?").run(randomUUID(), now, id); return true; }
  private deleteTerminalJob(id: string): boolean { const row = this.db.prepare("SELECT status FROM resource_jobs WHERE id = ?").get(id) as { status?: string } | undefined; if (!row) return false; if (!['completed', 'failed', 'cancelled'].includes(row.status ?? '')) throw new Error("JOB_NOT_TERMINAL"); this.db.exec("BEGIN IMMEDIATE"); try { this.db.prepare("UPDATE resource_file_ledger SET job_id = NULL WHERE job_id = ?").run(id); this.db.prepare("DELETE FROM resource_jobs WHERE id = ?").run(id); this.db.exec("COMMIT"); rmSync(join(this.options.config.stagingPath, id), { recursive: true, force: true }); return true; } catch (error) { this.db.exec("ROLLBACK"); throw error; } }
  private repeatJob(id: string): ResourceJobSnapshotV1 { const row = this.db.prepare("SELECT status, input_json FROM resource_jobs WHERE id = ?").get(id) as { status?: string; input_json?: string } | undefined; if (!row?.input_json || !['completed', 'failed', 'cancelled'].includes(row.status ?? '')) throw new Error("JOB_NOT_REPEATABLE"); const input = parseCreateResourceJobRequestV1(JSON.parse(row.input_json) as unknown); return this.createJob({ ...input, startMode: "automatic" }); }
  private toJob(row: JobRow): ResourceJobSnapshotV1 { return { version: 1, id: row.id, revision: row.revision, source: row.source as ResourceJobSnapshotV1["source"], status: row.status as ResourceJobSnapshotV1["status"], stage: row.stage as ResourceJobSnapshotV1["stage"], destinationRootId: row.destination_root_id, createdAt: row.created_at, updatedAt: row.updated_at, progress: JSON.parse(row.progress_json) as ResourceJobSnapshotV1["progress"], ...(row.model_snapshot_json ? { modelSnapshot: JSON.parse(row.model_snapshot_json) as NonNullable<ResourceJobSnapshotV1["modelSnapshot"]> } : {}), ...(row.pending_decision_json ? { pendingDecision: JSON.parse(row.pending_decision_json) as NonNullable<ResourceJobSnapshotV1["pendingDecision"]> } : {}), ...(row.failure_json ? { failure: JSON.parse(row.failure_json) as NonNullable<ResourceJobSnapshotV1["failure"]> } : {}) }; }
  private count(status: string): number { return Number((this.db.prepare("SELECT COUNT(*) AS count FROM resource_jobs WHERE status = ?").get(status) as { count: number }).count); }
  private authorized(request: IncomingMessage): boolean {
    const bearer = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : undefined;
    const cookie = request.headers.cookie?.split(";").map(item => item.trim()).find(item => item.startsWith("isla_resource="))?.slice("isla_resource=".length);
    const credential = bearer ?? cookie;
    if (!credential) return false;
    const provided = Buffer.from(credential); const expected = Buffer.from(this.token);
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  }
  private originAllowed(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    if (origin === undefined) return true;
    if (this.options.config.listen.allowedOrigins.includes(origin)) return true;
    try {
      const parsed = new URL(origin);
      const host = request.headers.host;
      return parsed.protocol === "http:" && host !== undefined && parsed.host === host;
    } catch { return false; }
  }
  private async readBody(request: IncomingMessage): Promise<unknown> { let text = ""; for await (const chunk of request) { text += chunk.toString(); if (text.length > this.options.config.limits.maxInputChars) throw new Error("REQUEST_TOO_LARGE"); } return JSON.parse(text || "{}"); }
  private send(response: ServerResponse, status: number, body: unknown): void { response.statusCode = status; response.setHeader("content-type", "application/json; charset=utf-8"); response.end(JSON.stringify(body)); }
  private sendHtml(response: ServerResponse, body: string): void { response.statusCode = 200; response.setHeader("content-type", "text/html; charset=utf-8"); response.setHeader("cache-control", "no-store"); response.end(body); }
  private reactWebUi(): string | undefined { const path = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/resource-ui/index.html"); return existsSync(path) ? readFileSync(path, "utf8") : undefined; }
}

interface JobRow { id: string; revision: number; source: string; status: string; stage: string; destination_root_id: string; input_json: string; parse_result_json: string | null; progress_json: string; model_snapshot_json: string | null; pending_decision_json: string | null; failure_json: string | null; created_at: string; updated_at: string; }

class ResourceRequestError extends Error {
  constructor(readonly code: string, readonly userMessage: string, readonly details?: Record<string, unknown>) { super(code); }
}

function pathsIntersect(left: string, right: string): boolean { const a = left.replace(/^\.\//u, "").replace(/\/$/u, ""); const b = right.replace(/^\.\//u, "").replace(/\/$/u, ""); return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`); }

function archiveOutputStem(name: string): string {
  const stripped = name.replace(/(?:\.part0*1|\.0*01|\.r00)$/iu, "").replace(/(?:\.(?:zip|7z|rar|tar|gz|tgz|bz2|xz|mp4|bin|download))+$/giu, "").trim();
  return stripped || "resource";
}

function availableOutputPath(root: string, name: string): string {
  const direct = join(root, name); if (!existsSync(direct)) return direct;
  for (let index = 2; index <= 999; index += 1) { const candidate = join(root, `${name} (${index})`); if (!existsSync(candidate)) return candidate; }
  throw new Error("OUTPUT_NAME_EXHAUSTED");
}

function listPublishedFiles(root: string): { relativePath: string; size: number }[] {
  const files: { relativePath: string; size: number }[] = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("PUBLISHED_SYMLINK_FORBIDDEN");
      if (entry.isDirectory()) queue.push(path);
      else if (entry.isFile()) files.push({ relativePath: path.slice(root.length + 1), size: statSync(path).size });
    }
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function classifyBaiduDownloadFailure(result: BaiduDownloadResult): string {
  const detail = `${result.error ?? ""}\n${result.stderr}`;
  if (/13045|prohibit transfer self share link/iu.test(detail)) return "BDPAN_SELF_SHARE_FORBIDDEN";
  if (/提取码|分享码|pwd|password.*(?:wrong|invalid)|errno=12/iu.test(detail)) return "BDPAN_SHARE_CODE_REQUIRED";
  if (/验证码|captcha/iu.test(detail)) return "BDPAN_CAPTCHA_REQUIRED";
  if (/风控|risk control|risk_control/iu.test(detail)) return "BDPAN_RISK_CONTROL";
  if (/token|登录|认证|unauth/iu.test(detail)) return "BDPAN_AUTH_REQUIRED";
  return "BAIDU_DOWNLOAD_FAILED";
}

function projectAgentJob(job: ResourceJobSnapshotV1, artifacts: readonly Record<string, unknown>[] = []): Record<string, unknown> {
  return {
    version: job.version, id: job.id, revision: job.revision, source: job.source, status: job.status, stage: job.stage,
    destinationRootId: job.destinationRootId, createdAt: job.createdAt, updatedAt: job.updatedAt,
    progress: { ...(job.progress.ratio === undefined ? {} : { ratio: job.progress.ratio }), ...(job.progress.completedBytes === undefined ? {} : { completedBytes: job.progress.completedBytes }), ...(job.progress.totalBytes === undefined ? {} : { totalBytes: job.progress.totalBytes }) },
    artifacts: artifacts.slice(0, 20).map(artifact => ({ id: artifact.id, kind: artifact.kind, path: artifact.path, ...(typeof artifact.sizeBytes === "number" ? { sizeBytes: artifact.sizeBytes } : {}), status: artifact.status, ...(typeof artifact.parentId === "string" ? { parentId: artifact.parentId } : {}) })),
    ...(job.pendingDecision ? { pendingDecision: { id: job.pendingDecision.id, type: job.pendingDecision.type, actions: job.pendingDecision.actions.slice(0, 8) } } : {}),
    ...(job.failure ? { failure: { code: job.failure.code, retryable: job.failure.retryable, ...(job.failure.resumeStage ? { resumeStage: job.failure.resumeStage } : {}) } } : {}),
  };
}
