import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { ResourceConfigV1 } from "./config.js";
import { migrateResourceDatabase } from "./database-schema.js";
import { parseConfirmResourceJobRequestV1, parseCreateResourceJobRequestV1, type ResourceJobSnapshotV1 } from "./contracts.js";
import { parseResourceShareText, parseShareTextNeedsWorker, splitResourceShareText } from "./parser.js";
import { chooseResourceName } from "./naming.js";
import { chooseResourceNameWithWorker } from "./title-worker.js";
import { ResourceScheduler } from "./scheduler.js";
import type { ArchiveOrganizeRequest, ArchiveOrganizeResult } from "./archive-organizer.js";
import type { BaiduDownloadRequest, BaiduDownloadResult } from "./baidu-download-runner.js";
import type { BdpanContext } from "./bdpan-runner.js";
import { RESOURCE_TOOLBOX } from "./toolbox.js";
import { RESOURCE_WEB_UI } from "./web-ui.js";
import { inspectArchive } from "./archive.js";
import type { ResourceInferenceClient } from "./inference-client.js";
import type { ResourceWorkerSettings } from "./worker-settings.js";
import type { ResourceSettingsStore } from "./settings.js";

export interface ResourceServiceOptions {
  readonly config: ResourceConfigV1;
  readonly token?: string;
  readonly archiveOrganizer?: { organize(request: ArchiveOrganizeRequest, signal?: AbortSignal): Promise<ArchiveOrganizeResult> };
  readonly baiduDownloader?: { download(request: BaiduDownloadRequest, context: BdpanContext, signal?: AbortSignal): Promise<BaiduDownloadResult> };
  readonly baiduBrowser?: { list(path: string, context: BdpanContext, signal?: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }> };
  readonly inferenceClient?: ResourceInferenceClient;
  readonly workerSettings?: ResourceWorkerSettings;
  readonly resourceSettings?: ResourceSettingsStore;
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
    this.scanTimer = setInterval(() => { void this.scanSavedFolders(false); }, this.options.config.scanning.intervalMs);
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
      this.sendHtml(response, RESOURCE_WEB_UI);
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
      if (request.method === "GET" && url.pathname === "/api/v1/resource/local/tree") { this.send(response, 200, this.listLocalTree(url.searchParams.get("rootId") ?? "", url.searchParams.get("path") ?? ".")); return; }
      if (request.method === "POST" && url.pathname === "/api/v1/resource/scans") { this.send(response, 202, this.scanFolder(await this.readBody(request), true)); return; }
      if (request.method === "POST" && url.pathname === "/api/v1/resource/jobs/batch") { this.send(response, 201, { jobs: this.createBatchJobs(await this.readBody(request)) }); return; }
      if (request.method === "POST" && url.pathname === "/api/v1/resource/jobs") { this.send(response, 201, { job: this.createJob(await this.readBody(request)) }); return; }
      if (request.method === "GET" && url.pathname === "/api/v1/resource/jobs") { this.send(response, 200, { jobs: this.listJobs() }); return; }
      const match = url.pathname.match(/^\/api\/v1\/resource\/jobs\/([^/]+)(?:\/(cancel|confirm|retry|repeat))?$/u);
      if (!match) { this.send(response, 404, { error: { code: "NOT_FOUND", message: "资源不存在。", retryable: false } }); return; }
      const id = decodeURIComponent(match[1]!);
      if (request.method === "GET" && !match[2]) { const job = this.getJob(id); if (!job) { this.send(response, 404, { error: { code: "JOB_NOT_FOUND", message: "任务不存在。", retryable: false } }); return; } this.send(response, 200, { job }); return; }
      if (request.method === "DELETE" && !match[2]) { this.send(response, 200, { deleted: this.deleteTerminalJob(id) }); return; }
      if (request.method === "POST" && match[2] === "cancel") { this.send(response, 200, { accepted: this.cancelJob(id) }); return; }
      if (request.method === "POST" && match[2] === "confirm") { this.send(response, 202, { accepted: this.confirmJob(id, await this.readBody(request)) }); return; }
      if (request.method === "POST" && match[2] === "retry") { this.send(response, 202, { accepted: this.retryJob(id, await this.readBody(request)) }); return; }
      if (request.method === "POST" && match[2] === "repeat") { this.send(response, 201, { job: this.repeatJob(id) }); return; }
      this.send(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "方法不支持。", retryable: false } });
    } catch (error) { this.send(response, 400, { error: { code: error instanceof Error ? error.message : "RESOURCE_REQUEST_FAILED", message: "请求无效。", retryable: false } }); }
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

  private listLocalTree(rootId: string, relativePath: string): Record<string, unknown> {
    const root = this.options.config.managedRoots.find(item => item.id === rootId);
    if (!root) throw new Error("MANAGED_ROOT_INVALID");
    if (relativePath.includes("..") || /^[\\/]/u.test(relativePath)) throw new Error("SCAN_PATH_INVALID");
    const target = resolve(root.path, relativePath);
    const relativeTarget = relative(root.path, target);
    if (relativeTarget.startsWith("..") || relativeTarget.includes(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("SCAN_PATH_INVALID");
    if (!existsSync(target) || !statSync(target).isDirectory()) throw new Error("LOCAL_DIRECTORY_NOT_FOUND");
    const entries = readdirSync(target, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => ({ name: entry.name, path: relativePath === "." ? entry.name : join(relativePath, entry.name).replaceAll("\\", "/"), type: "directory" }));
    return { rootId, path: relativePath, entries };
  }

  private health(): Record<string, unknown> { return { ok: true, service: "resource", database: "ready", isla: { configured: true }, queue: { queued: this.count("queued"), running: this.count("running") } }; }
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
  private findArchives(folder: string): readonly string[] {
    const archives: string[] = []; const queue = [folder];
    while (queue.length) {
      const current = queue.pop()!;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { queue.push(path); continue; }
        if (!entry.isFile()) continue;
        const fd = openSync(path, "r");
        try { const header = Buffer.alloc(1024 * 1024); const length = readSync(fd, header, 0, header.length, 0); const inspected = inspectArchive(path, header.subarray(0, length), lstatSync(path).size); if (inspected.isArchive && (!inspected.part || inspected.part.role === "first")) archives.push(path); } finally { closeSync(fd); }
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
  private async scanSavedFolders(force: boolean): Promise<void> {
    const watches = this.db.prepare("SELECT managed_root_id, relative_path, destination_root_id FROM resource_folder_watches WHERE enabled = 1").all() as unknown as Array<{ managed_root_id: string; relative_path: string; destination_root_id: string }>;
    for (const watch of watches) { try { this.scanFolder({ managedRootId: watch.managed_root_id, relativePath: watch.relative_path, destinationRootId: watch.destination_root_id }, force); } catch { /* 单个目录不可用不阻塞其他 watch，下次周期继续 */ } }
  }
  private listJobs(): readonly ResourceJobSnapshotV1[] { return (this.db.prepare("SELECT * FROM resource_jobs ORDER BY updated_at DESC").all() as unknown as JobRow[]).map(row => this.toJob(row)); }
  private getJob(id: string): ResourceJobSnapshotV1 | undefined { const row = this.db.prepare("SELECT * FROM resource_jobs WHERE id = ?").get(id) as unknown as JobRow | undefined; return row ? this.toJob(row) : undefined; }
  private confirmJob(id: string, value: unknown): boolean {
    const decision = parseConfirmResourceJobRequestV1(value);
    const row = this.db.prepare("SELECT revision, source, input_json, parse_result_json, pending_decision_json FROM resource_jobs WHERE id = ?").get(id) as { revision: number; source: string; input_json: string; parse_result_json: string | null; pending_decision_json: string | null } | undefined;
    if (!row || !row.pending_decision_json) throw new Error("JOB_NOT_WAITING_USER");
    const pending = JSON.parse(row.pending_decision_json) as ResourceJobSnapshotV1["pendingDecision"];
    if (decision.revision !== row.revision || decision.decisionId !== pending?.id) throw new Error("DECISION_STALE");
    if (decision.action === "reject") return this.cancelJob(id);
    if (decision.action === "provide_values" && pending.type === "provide_archive_password") {
      const supplied = [decision.values?.password, ...(Array.isArray(decision.values?.passwords) ? decision.values.passwords : [])].filter((value): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 256).map(value => value.trim());
      if (supplied.length === 0) throw new Error("ARCHIVE_PASSWORD_REQUIRED");
      const now = new Date().toISOString(); const insert = this.db.prepare("INSERT OR IGNORE INTO resource_job_secrets (job_id, kind, secret_value, created_at) VALUES (?, 'archive-password', ?, ?)"); for (const password of supplied.slice(0, 20)) insert.run(id, password, now);
      if (row.source === "baidu") this.startBaiduExtraction(id, row.input_json, row.parse_result_json);
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
    const input = parseCreateResourceJobRequestV1(JSON.parse(inputJson) as unknown); if (input.tool !== "archive-organizer" || input.input.kind !== "managed-folder") throw new Error("ARCHIVE_INPUT_INVALID"); const archiveInput = input.input;
    const sourceRoot = this.options.config.managedRoots.find(root => root.id === archiveInput.managedRootId); const destinationRoot = this.options.config.managedRoots.find(root => root.id === input.destinationRootId && root.outputEnabled);
    if (!sourceRoot || !destinationRoot) throw new Error("MANAGED_ROOT_INVALID");
    const archivePath = resolve(sourceRoot.path, archiveInput.relativePath); if (relative(sourceRoot.path, archivePath).startsWith("..") || archivePath === sourceRoot.path) throw new Error("ARCHIVE_PATH_OUTSIDE_ROOT");
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
    this.setStage(id, "inspecting", "queued"); const discovered = this.findArchives(downloadDirectory);
    // bdpan may create a directory at the requested destination. Scan its
    // contents before deciding that the download is not an archive; this also
    // catches archives whose names were deliberately changed to .mp4/.bin.
    if (discovered.length === 0) throw new Error(this.findLikelyMedia(downloadDirectory).length > 0 ? "DOWNLOADED_CONTENT_IS_MEDIA" : "DOWNLOADED_ARCHIVE_NOT_FOUND");
    const downloadPath = discovered[0]!;
    const name = await chooseResourceNameWithWorker(this.options.inferenceClient, { ...(parsed.titleCandidates ? { titleCandidates: parsed.titleCandidates } : {}), downloadedNames: [basename(downloadPath)], completedAt: new Date() }); const outputPath = availableOutputPath(destinationRoot.path, name.name); const stagingPath = join(this.options.config.stagingPath, id, "extracted");
    const passwordCandidates = this.passwordCandidates(id, parsed.archivePasswordCandidates ?? []);
    const extraction = this.scheduler.enqueue(id, "extraction", signal => { this.setStage(id, "extracting", "running"); return this.options.archiveOrganizer!.organize({ archivePath: downloadPath, stagingPath, outputPath, passwordCandidates }, signal); });
    void extraction.promise.then(extracted => { if (extracted.successfulPasswordIndex !== undefined) this.recordSuccessfulPassword(passwordCandidates[extracted.successfulPasswordIndex]); this.completeJob(id, extracted.totalBytes); }).catch(error => this.handleJobError(id, error, "inspecting"));
  }
  private completeJob(id: string, totalBytes: number): void { const now = new Date().toISOString(); this.db.prepare("UPDATE resource_jobs SET status = 'completed', stage = 'completed', revision = revision + 1, progress_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify({ ratio: 1, completedBytes: totalBytes, totalBytes }), now, id); }
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
    const row = this.db.prepare("SELECT revision, status, source, input_json, parse_result_json, failure_json FROM resource_jobs WHERE id = ?").get(id) as { revision: number; status: string; source: string; input_json: string; parse_result_json: string | null; failure_json: string | null } | undefined;
    if (!row || row.status !== "failed" || !row.failure_json) throw new Error("JOB_NOT_RETRYABLE");
    if (row.revision !== revision) throw new Error("DECISION_STALE");
    const failure = JSON.parse(row.failure_json) as { retryable?: boolean; resumeStage?: ResourceJobSnapshotV1["stage"] };
    if (!failure.retryable) throw new Error("JOB_NOT_RETRYABLE");
    if (row.source === "baidu" && failure.resumeStage === "queued_download") this.startBaiduJob(id, row.input_json, row.parse_result_json);
    else if (row.source === "baidu" && failure.resumeStage === "inspecting") void this.startBaiduExtraction(id, row.input_json, row.parse_result_json);
    else if (row.source === "managed-folder" && failure.resumeStage === "inspecting") this.startArchiveJob(id, row.input_json);
    else throw new Error("RETRY_STAGE_UNSUPPORTED");
    return true;
  }
  private setStage(id: string, stage: ResourceJobSnapshotV1["stage"], status: ResourceJobSnapshotV1["status"]): void { this.db.prepare("UPDATE resource_jobs SET status = ?, stage = ?, revision = revision + 1, updated_at = ? WHERE id = ?").run(status, stage, new Date().toISOString(), id); }
  private cancelJob(id: string): boolean { const row = this.db.prepare("SELECT status, revision FROM resource_jobs WHERE id = ?").get(id) as { status?: string; revision?: number } | undefined; if (!row || row.status === "completed" || row.status === "failed" || row.status === "cancelled") return false; const now = new Date().toISOString(); this.db.prepare("UPDATE resource_jobs SET status = 'cancelled', revision = revision + 1, updated_at = ? WHERE id = ?").run(now, id); this.db.prepare("INSERT INTO resource_events (id, job_id, sequence, type, data_json, occurred_at) SELECT ?, id, COALESCE((SELECT MAX(sequence) + 1 FROM resource_events WHERE job_id = resource_jobs.id), 1), 'job.cancelled', '{}', ? FROM resource_jobs WHERE id = ?").run(randomUUID(), now, id); return true; }
  private deleteTerminalJob(id: string): boolean { const row = this.db.prepare("SELECT status FROM resource_jobs WHERE id = ?").get(id) as { status?: string } | undefined; if (!row) return false; if (!['completed', 'failed', 'cancelled'].includes(row.status ?? '')) throw new Error("JOB_NOT_TERMINAL"); this.db.exec("BEGIN IMMEDIATE"); try { this.db.prepare("UPDATE resource_file_ledger SET job_id = NULL WHERE job_id = ?").run(id); this.db.prepare("DELETE FROM resource_jobs WHERE id = ?").run(id); this.db.exec("COMMIT"); return true; } catch (error) { this.db.exec("ROLLBACK"); throw error; } }
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
}

interface JobRow { id: string; revision: number; source: string; status: string; stage: string; destination_root_id: string; input_json: string; parse_result_json: string | null; progress_json: string; model_snapshot_json: string | null; pending_decision_json: string | null; failure_json: string | null; created_at: string; updated_at: string; }

function archiveOutputStem(name: string): string {
  const stripped = name.replace(/(?:\.part0*1|\.0*01|\.r00)$/iu, "").replace(/(?:\.(?:zip|7z|rar|tar|gz|tgz|bz2|xz|mp4|bin|download))+$/giu, "").trim();
  return stripped || "resource";
}

function availableOutputPath(root: string, name: string): string {
  const direct = join(root, name); if (!existsSync(direct)) return direct;
  for (let index = 2; index <= 999; index += 1) { const candidate = join(root, `${name} (${index})`); if (!existsSync(candidate)) return candidate; }
  throw new Error("OUTPUT_NAME_EXHAUSTED");
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
