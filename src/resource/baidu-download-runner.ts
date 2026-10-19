import type { BdpanCommandResult, BdpanContext } from "./bdpan-runner.js";
import { BdpanRunner } from "./bdpan-runner.js";

export interface BaiduDownloadRequest { readonly shareUrl?: string; readonly remotePath?: string; readonly destinationPath: string; readonly shareCode?: string; readonly remoteTarget?: string; }
export interface BaiduDownloadResult { readonly code: number; readonly stdout: string; readonly stderr: string; readonly agentReply?: string; readonly savedPath?: string; readonly error?: string; }

export interface BdpanCommandClient { run(operation: "download", args: readonly string[], context: BdpanContext, signal?: AbortSignal): Promise<BdpanCommandResult>; }

export class BaiduDownloadRunner {
  constructor(private readonly client: BdpanCommandClient = new BdpanRunner()) {}

  async download(request: BaiduDownloadRequest, context: BdpanContext, signal?: AbortSignal): Promise<BaiduDownloadResult> {
    if (!request.shareUrl && !request.remotePath) throw new Error("BDPAN_REMOTE_PATH_REQUIRED");
    if (request.shareUrl && !/^https:\/\/pan\.baidu\.com\/(?:s\/[A-Za-z0-9_-]+(?:\?.*)?|share\/init\?surl=[A-Za-z0-9_-]+(?:&.*)?)$/u.test(request.shareUrl)) throw new Error("BDPAN_SHARE_URL_INVALID");
    if (!request.destinationPath.trim() || request.destinationPath.includes("\0")) throw new Error("BDPAN_DESTINATION_INVALID");
    const args = [request.shareUrl ?? request.remotePath!, request.destinationPath, ...(request.shareCode ? ["-p", request.shareCode] : []), ...(request.shareUrl && request.remoteTarget ? ["-t", request.remoteTarget] : [])];
    const result = await this.client.run("download", args, context, signal);
    let parsed: Record<string, unknown> | undefined;
    try { parsed = JSON.parse(result.stdout) as Record<string, unknown>; } catch { /* 兼容非 JSON 错误输出，由上层按 code 处理 */ }
    const data = parsed?.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? parsed.data as Record<string, unknown> : undefined;
    const code = typeof parsed?.code === "number" ? parsed.code : result.code;
    const agentReply = typeof parsed?.agent_reply === "string" ? parsed.agent_reply : typeof data?.agent_reply === "string" ? data.agent_reply : undefined;
    const savedPath = typeof parsed?.saved_path === "string" ? parsed.saved_path : typeof data?.saved_path === "string" ? data.saved_path : undefined;
    const error = typeof parsed?.error === "string" ? parsed.error.slice(0, 1_024) : undefined;
    return { code, stdout: result.stdout, stderr: result.stderr, ...(agentReply ? { agentReply } : {}), ...(savedPath ? { savedPath } : {}), ...(error ? { error } : {}) };
  }
}
