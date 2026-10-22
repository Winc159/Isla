import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ResourceService } from "../../src/resource/service.js";
import { parseResourceConfig } from "../../src/resource/config.js";

const makeConfig = (directory: string) => parseResourceConfig(JSON.stringify({ version: 1, listen: { host: "127.0.0.1", port: 0, allowedOrigins: ["http://127.0.0.1"] }, isla: { endpoint: "http://127.0.0.1:43110", token: "internal-test-token" }, databasePath: join(directory, "resource.sqlite"), stagingPath: join(directory, "staging"), managedRoots: [{ id: "library", label: "Library", path: join(directory, "library"), scanEnabled: true, outputEnabled: true }], defaultDestinationRootId: "library" }));
let service: ResourceService | undefined;
let directory: string | undefined;
afterEach(async () => { await service?.close(); service = undefined; if (directory) rmSync(directory, { recursive: true, force: true }); directory = undefined; });

describe("Resource service skeleton", () => {
  it("serves the two-tool WebUI with an HttpOnly same-origin session", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-resource-service-")); service = new ResourceService({ config: makeConfig(directory), token: "resource-token" }); const address = await service.start();
    const page = await fetch(`http://${address.host}:${address.port}/resource`); const html = await page.text(); const cookie = page.headers.get("set-cookie");
    expect(page.status).toBe(200); expect(page.headers.get("content-type")).toContain("text/html"); expect(html).toContain("百度下载"); expect(html).toContain("文件解压 / 整理"); expect(html).not.toContain("resource-token"); expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Strict");
    const config = await fetch(`http://${address.host}:${address.port}/api/v1/resource/config/public`, { headers: { cookie: cookie!.split(";")[0]! } });
    expect(config.status).toBe(200); expect(await config.json()).toMatchObject({ tools: [{ id: "baidu-download" }, { id: "archive-organizer" }] });
  });

  it("serves health and public config without leaking paths", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-resource-service-")); service = new ResourceService({ config: makeConfig(directory), token: "resource-token" }); const address = await service.start();
    expect((await fetch(`http://${address.host}:${address.port}/api/v1/resource/health`)).status).toBe(200);
    const response = await fetch(`http://${address.host}:${address.port}/api/v1/resource/config/public`, { headers: { authorization: "Bearer resource-token" } });
    const body = await response.json(); expect(body).toMatchObject({ version: 1, defaultDestinationRootId: "library" }); expect(JSON.stringify(body)).not.toContain(directory);
  });

  it("creates, lists, cancels and reloads a simulated job", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-resource-service-")); service = new ResourceService({ config: makeConfig(directory), token: "resource-token" }); const address = await service.start(); const headers = { authorization: "Bearer resource-token", "content-type": "application/json" };
    const created = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs`, { method: "POST", headers, body: JSON.stringify({ tool: "baidu-download", input: { kind: "share-text", text: "https://pan.baidu.com/s/fixture" }, destinationRootId: "library" }) }); const job = (await created.json() as { job: { id: string; status: string; stage: string } }).job; expect(created.status).toBe(201); expect(job).toMatchObject({ status: "waiting_user", stage: "preview" });
    expect((await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs`, { headers })).status).toBe(200);
    expect((await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${job.id}/cancel`, { method: "POST", headers })).status).toBe(200);
    await service.close(); service = new ResourceService({ config: makeConfig(directory), token: "resource-token" }); const second = await service.start(); const loaded = await fetch(`http://${second.host}:${second.port}/api/v1/resource/jobs/${job.id}`, { headers }); expect((await loaded.json() as { job: { status: string } }).job.status).toBe("cancelled");
  });

  it("creates one independent job per pasted Baidu resource block", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-resource-service-")); service = new ResourceService({ config: makeConfig(directory), token: "resource-token" }); const address = await service.start(); const headers = { authorization: "Bearer resource-token", "content-type": "application/json" };
    const created = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/batch`, { method: "POST", headers, body: JSON.stringify({ tool: "baidu-download", input: { kind: "share-text", text: "资源 A\nhttps://pan.baidu.com/s/a\n\n资源 B\nhttps://pan.baidu.com/s/b 提取码 bb22" }, destinationRootId: "library" }) });
    const body = await created.json() as { jobs: Array<{ id: string; status: string }> };
    expect(created.status).toBe(201); expect(body.jobs).toHaveLength(2); expect(new Set(body.jobs.map(job => job.id)).size).toBe(2); expect(body.jobs.every(job => job.status === "waiting_user")).toBe(true);
  });

  it("automatically starts unambiguous batch resources when automatic mode is requested", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-resource-service-")); const downloaded: string[] = [];
    const baiduDownloader = { download: async (request: { shareUrl: string }) => { downloaded.push(request.shareUrl); return { code: 0, stdout: "{}", stderr: "" }; } };
    service = new ResourceService({ config: makeConfig(directory), token: "resource-token", baiduDownloader }); const address = await service.start(); const headers = { authorization: "Bearer resource-token", "content-type": "application/json" };
    const response = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/batch`, { method: "POST", headers, body: JSON.stringify({ tool: "baidu-download", input: { kind: "share-text", text: "A\nhttps://pan.baidu.com/s/a\n\nB\nhttps://pan.baidu.com/s/b" }, destinationRootId: "library", startMode: "automatic" }) });
    expect(response.status).toBe(201); await new Promise(resolve => setTimeout(resolve, 30)); expect(downloaded).toEqual(["https://pan.baidu.com/s/a", "https://pan.baidu.com/s/b"]);
    const jobs = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs`, { headers }); expect((await jobs.json() as { jobs: Array<{ status: string }> }).jobs.every(job => job.status === "completed")).toBe(true);
  });

  it("maps bdpan self-share business failures to the download recovery stage", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-resource-service-"));
    const baiduDownloader = { download: async () => ({ code: 1, stdout: "{}", stderr: "", error: "errno=13045 prohibit transfer self share link" }) };
    service = new ResourceService({ config: makeConfig(directory), token: "resource-token", baiduDownloader }); const address = await service.start(); const headers = { authorization: "Bearer resource-token", "content-type": "application/json" };
    const response = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/batch`, { method: "POST", headers, body: JSON.stringify({ tool: "baidu-download", input: { kind: "share-text", text: "https://pan.baidu.com/s/self-share" }, destinationRootId: "library", startMode: "automatic" }) }); const id = (await response.json() as { jobs: Array<{ id: string }> }).jobs[0]!.id;
    await new Promise(resolve => setTimeout(resolve, 20)); const loaded = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${id}`, { headers }); expect((await loaded.json() as { job: { status: string; pendingDecision: { type: string }; failure: { code: string; resumeStage: string } } }).job).toMatchObject({ status: "waiting_user", pendingDecision: { type: "correct_share_input" }, failure: { code: "BDPAN_SELF_SHARE_FORBIDDEN", resumeStage: "queued_download" } });
  });

  it("rejects unauthenticated requests and arbitrary destination paths", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-resource-service-")); service = new ResourceService({ config: makeConfig(directory), token: "resource-token" }); const address = await service.start();
    expect((await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs`)).status).toBe(401);
    const response = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs`, { method: "POST", headers: { authorization: "Bearer resource-token", "content-type": "application/json" }, body: JSON.stringify({ tool: "baidu-download", input: { kind: "share-text", text: "https://pan.baidu.com/s/fixture" }, destinationRootId: directory }) }); expect(response.status).toBe(400);
  });

  it("keeps an invalid share job recoverable after user correction", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-resource-service-")); service = new ResourceService({ config: makeConfig(directory), token: "resource-token" }); const address = await service.start(); const headers = { authorization: "Bearer resource-token", "content-type": "application/json" };
    const created = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs`, { method: "POST", headers, body: JSON.stringify({ tool: "baidu-download", input: { kind: "share-text", text: "https://pan.baidu.com/s/链接里有汉字" }, destinationRootId: "library" }) });
    const job = (await created.json() as { job: { id: string; revision: number; pendingDecision: { id: string; type: string } } }).job;
    expect(job.pendingDecision.type).toBe("correct_share_input");
    const corrected = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${job.id}/confirm`, { method: "POST", headers, body: JSON.stringify({ decisionId: job.pendingDecision.id, revision: job.revision, action: "replace_input", values: { text: "https://pan.baidu.com/s/fixed-link 提取码 ab12" } }) });
    expect(corrected.status).toBe(202);
    const loaded = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${job.id}`, { headers });
    expect((await loaded.json() as { job: { revision: number; pendingDecision: { type: string } } }).job).toMatchObject({ revision: 2, pendingDecision: { type: "confirm_parse_result" } });
  });

  it("runs an approved archive-organizer job to completion without a worker model", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-resource-service-"));
    const archiveOrganizer = { organize: async (_request: unknown) => ({ inspection: { path: "fixture.pkg", format: "zip" as const, isArchive: true, likelyMedia: false, normalizedName: "fixture.zip", confidence: "high" as const }, outputPath: join(directory!, "library", "fixture"), files: [{ relativePath: "content.txt", size: 4 }], totalBytes: 4 }) };
    service = new ResourceService({ config: makeConfig(directory), token: "resource-token", archiveOrganizer }); const address = await service.start(); const headers = { authorization: "Bearer resource-token", "content-type": "application/json" };
    const created = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs`, { method: "POST", headers, body: JSON.stringify({ tool: "archive-organizer", input: { kind: "managed-folder", managedRootId: "library", relativePath: "fixture.pkg" }, destinationRootId: "library" }) }); const job = (await created.json() as { job: { id: string; revision: number; pendingDecision: { id: string } } }).job;
    expect((await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${job.id}/confirm`, { method: "POST", headers, body: JSON.stringify({ decisionId: job.pendingDecision.id, revision: job.revision, action: "approve" }) })).status).toBe(202);
    await new Promise(resolve => setTimeout(resolve, 25)); const loaded = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${job.id}`, { headers }); expect((await loaded.json() as { job: { status: string; stage: string } }).job).toMatchObject({ status: "completed", stage: "completed" });
  });

  it("chains an approved Baidu download into the independent extraction pool", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-resource-service-")); let downloaded = false; let extracted = false;
    const baiduDownloader = { download: async (request: { destinationPath?: string }) => { downloaded = true; if (request.destinationPath) writeFileSync(request.destinationPath, Buffer.from([0x50, 0x4b, 0x03, 0x04])); return { code: 0, stdout: "{}", stderr: "" }; } };
    const archiveOrganizer = { organize: async () => { extracted = true; return { inspection: { path: "downloaded.bin", format: "zip" as const, isArchive: true, likelyMedia: false, normalizedName: "downloaded.zip", confidence: "high" as const }, outputPath: join(directory!, "library", "课程资料"), files: [{ relativePath: "content.txt", size: 4 }], totalBytes: 4 }; } };
    service = new ResourceService({ config: makeConfig(directory), token: "resource-token", baiduDownloader, archiveOrganizer }); const address = await service.start(); const headers = { authorization: "Bearer resource-token", "content-type": "application/json" };
    const created = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs`, { method: "POST", headers, body: JSON.stringify({ tool: "baidu-download", input: { kind: "share-text", text: "课程资料\nhttps://pan.baidu.com/s/fixture 提取码 ab12" }, destinationRootId: "library" }) }); const job = (await created.json() as { job: { id: string; revision: number; pendingDecision: { id: string } } }).job;
    expect((await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${job.id}/confirm`, { method: "POST", headers, body: JSON.stringify({ decisionId: job.pendingDecision.id, revision: job.revision, action: "approve" }) })).status).toBe(202);
    await new Promise(resolve => setTimeout(resolve, 40)); const loaded = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${job.id}`, { headers }); expect((await loaded.json() as { job: { status: string; stage: string } }).job).toMatchObject({ status: "completed", stage: "completed" }); expect(downloaded).toBe(true); expect(extracted).toBe(true);
  });

  it("lets a user retry a failed archive job from its safe stage", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-resource-service-")); let attempts = 0;
    const archiveOrganizer = { organize: async () => { attempts += 1; if (attempts === 1) throw new Error("PASSWORD_REQUIRED"); return { inspection: { path: "fixture.pkg", format: "zip" as const, isArchive: true, likelyMedia: false, normalizedName: "fixture.zip", confidence: "high" as const }, outputPath: join(directory!, "library", "fixture"), files: [{ relativePath: "content.txt", size: 4 }], totalBytes: 4 }; } };
    service = new ResourceService({ config: makeConfig(directory), token: "resource-token", archiveOrganizer }); const address = await service.start(); const headers = { authorization: "Bearer resource-token", "content-type": "application/json" };
    const created = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs`, { method: "POST", headers, body: JSON.stringify({ tool: "archive-organizer", input: { kind: "managed-folder", managedRootId: "library", relativePath: "fixture.pkg" }, destinationRootId: "library" }) }); const job = (await created.json() as { job: { id: string; revision: number; pendingDecision: { id: string } } }).job;
    await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${job.id}/confirm`, { method: "POST", headers, body: JSON.stringify({ decisionId: job.pendingDecision.id, revision: job.revision, action: "approve" }) });
    await new Promise(resolve => setTimeout(resolve, 25)); let loaded = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${job.id}`, { headers }); const failed = (await loaded.json() as { job: { revision: number; status: string; failure: { retryable: boolean } } }).job; expect(failed).toMatchObject({ status: "failed", failure: { retryable: true } });
    expect((await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${job.id}/retry`, { method: "POST", headers, body: JSON.stringify({ revision: failed.revision }) })).status).toBe(202);
    await new Promise(resolve => setTimeout(resolve, 25)); loaded = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${job.id}`, { headers }); expect((await loaded.json() as { job: { status: string } }).job.status).toBe("completed"); expect(attempts).toBe(2);
  });

  it("registers a watched folder, auto-queues discovered archives and deduplicates completed files", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-resource-service-")); const library = join(directory, "library"); mkdirSync(join(library, "inbox"), { recursive: true }); writeFileSync(join(library, "inbox", "renamed.mp4"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));
    const archiveOrganizer = { organize: async () => ({ inspection: { path: "renamed.mp4", format: "zip" as const, isArchive: true, likelyMedia: false, normalizedName: "renamed.zip", confidence: "high" as const }, outputPath: join(library, "renamed"), files: [{ relativePath: "video.mp4", size: 4 }], totalBytes: 4 }) };
    service = new ResourceService({ config: makeConfig(directory), token: "resource-token", archiveOrganizer }); const address = await service.start(); const headers = { authorization: "Bearer resource-token", "content-type": "application/json" };
    const first = await fetch(`http://${address.host}:${address.port}/api/v1/resource/scans`, { method: "POST", headers, body: JSON.stringify({ managedRootId: "library", relativePath: "inbox", destinationRootId: "library" }) }); const firstBody = await first.json() as { watchId: string; jobs: Array<{ id: string }> };
    expect(first.status).toBe(202); expect(firstBody.watchId).toBeTruthy(); expect(firstBody.jobs).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 25));
    const second = await fetch(`http://${address.host}:${address.port}/api/v1/resource/scans`, { method: "POST", headers, body: JSON.stringify({ managedRootId: "library", relativePath: "inbox", destinationRootId: "library" }) }); expect((await second.json() as { jobs: unknown[] }).jobs).toHaveLength(0);
  });

  it("does not queue the same stable file again while its first extraction is still running", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-resource-service-")); const library = join(directory, "library"); mkdirSync(join(library, "inbox"), { recursive: true }); writeFileSync(join(library, "inbox", "queued.bin"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])); let finish: (() => void) | undefined;
    const archiveOrganizer = { organize: () => new Promise(resolve => { finish = () => resolve({ inspection: { path: "queued.bin", format: "zip" as const, isArchive: true, likelyMedia: false, normalizedName: "queued.zip", confidence: "high" as const }, outputPath: join(library, "queued"), files: [], totalBytes: 0 }); }) };
    service = new ResourceService({ config: makeConfig(directory), token: "resource-token", archiveOrganizer }); const address = await service.start(); const headers = { authorization: "Bearer resource-token", "content-type": "application/json" }; const body = JSON.stringify({ managedRootId: "library", relativePath: "inbox", destinationRootId: "library" });
    const first = await fetch(`http://${address.host}:${address.port}/api/v1/resource/scans`, { method: "POST", headers, body }); expect((await first.json() as { jobs: unknown[] }).jobs).toHaveLength(1);
    const second = await fetch(`http://${address.host}:${address.port}/api/v1/resource/scans`, { method: "POST", headers, body }); expect((await second.json() as { jobs: unknown[] }).jobs).toHaveLength(0);
    finish?.(); await new Promise(resolve => setTimeout(resolve, 10));
  });

  it("asks for a missing archive password, resumes the same job, then reuses the successful password", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-resource-service-")); const requests: Array<{ passwordCandidates?: readonly string[] }> = [];
    const archiveOrganizer = { organize: async (request: { passwordCandidates?: readonly string[] }) => { requests.push(request); const index = request.passwordCandidates?.indexOf("frequent-secret") ?? -1; if (index < 0) throw new Error("ARCHIVE_PASSWORD_REQUIRED"); return { inspection: { path: "protected.pkg", format: "zip" as const, isArchive: true, likelyMedia: false, normalizedName: "protected.zip", confidence: "high" as const }, outputPath: join(directory!, "library", `protected-${requests.length}`), files: [{ relativePath: "secret.txt", size: 4 }], totalBytes: 4, successfulPasswordIndex: index }; } };
    service = new ResourceService({ config: makeConfig(directory), token: "resource-token", archiveOrganizer }); const address = await service.start(); const headers = { authorization: "Bearer resource-token", "content-type": "application/json" };
    const create = async (name: string) => { const response = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs`, { method: "POST", headers, body: JSON.stringify({ tool: "archive-organizer", input: { kind: "managed-folder", managedRootId: "library", relativePath: name }, destinationRootId: "library" }) }); return (await response.json() as { job: { id: string; revision: number; pendingDecision: { id: string } } }).job; };
    const first = await create("protected-one.pkg"); await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${first.id}/confirm`, { method: "POST", headers, body: JSON.stringify({ decisionId: first.pendingDecision.id, revision: first.revision, action: "approve" }) }); await new Promise(resolve => setTimeout(resolve, 20));
    let loaded = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${first.id}`, { headers }); const waiting = (await loaded.json() as { job: { revision: number; status: string; pendingDecision: { id: string; type: string } } }).job; expect(waiting).toMatchObject({ status: "waiting_user", pendingDecision: { type: "provide_archive_password" } });
    await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${first.id}/confirm`, { method: "POST", headers, body: JSON.stringify({ decisionId: waiting.pendingDecision.id, revision: waiting.revision, action: "provide_values", values: { password: "frequent-secret" } }) }); await new Promise(resolve => setTimeout(resolve, 20)); loaded = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${first.id}`, { headers }); expect((await loaded.json() as { job: { status: string } }).job.status).toBe("completed");
    const second = await create("protected-two.pkg"); await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${second.id}/confirm`, { method: "POST", headers, body: JSON.stringify({ decisionId: second.pendingDecision.id, revision: second.revision, action: "approve" }) }); await new Promise(resolve => setTimeout(resolve, 20)); loaded = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${second.id}`, { headers }); expect((await loaded.json() as { job: { status: string } }).job.status).toBe("completed"); expect(requests.at(-1)?.passwordCandidates).toContain("frequent-secret");
  });

  it("browses managed folders without exposing absolute paths", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-resource-service-")); mkdirSync(join(directory, "library", "incoming", "series"), { recursive: true }); service = new ResourceService({ config: makeConfig(directory), token: "resource-token" }); const address = await service.start(); const headers = { authorization: "Bearer resource-token" };
    const response = await fetch(`http://${address.host}:${address.port}/api/v1/resource/local/tree?rootId=library&path=incoming`, { headers }); const body = await response.json() as { entries: Array<{ name: string; path: string }> };
    expect(response.status).toBe(200); expect(body.entries).toEqual([{ name: "series", path: "incoming/series", type: "directory" }]); expect(JSON.stringify(body)).not.toContain(directory);
  });

  it("automatically downloads an authenticated-drive path, can repeat it, and clears terminal records", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-resource-service-")); mkdirSync(join(directory, "library"), { recursive: true }); let downloads = 0;
    const baiduDownloader = { download: async () => { downloads += 1; return { code: 0, stdout: "{}", stderr: "" }; } };
    service = new ResourceService({ config: makeConfig(directory), token: "resource-token", baiduDownloader }); const address = await service.start(); const headers = { authorization: "Bearer resource-token", "content-type": "application/json" };
    const created = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs`, { method: "POST", headers, body: JSON.stringify({ tool: "baidu-download", input: { kind: "baidu-path", path: "/apps/bdpan/fixture.pkg" }, destinationRootId: "library", startMode: "automatic" }) }); const job = (await created.json() as { job: { id: string; pendingDecision?: unknown } }).job;
    await new Promise(resolve => setTimeout(resolve, 20)); let loaded = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${job.id}`, { headers }); expect((await loaded.json() as { job: { status: string; pendingDecision?: unknown } }).job).toMatchObject({ status: "completed" });
    const repeated = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${job.id}/repeat`, { method: "POST", headers, body: "{}" }); expect(repeated.status).toBe(201); await new Promise(resolve => setTimeout(resolve, 20)); expect(downloads).toBe(2);
    expect((await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${job.id}`, { method: "DELETE", headers })).status).toBe(200); loaded = await fetch(`http://${address.host}:${address.port}/api/v1/resource/jobs/${job.id}`, { headers }); expect(loaded.status).toBe(404);
  });
});
