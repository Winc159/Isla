import { spawn } from "node:child_process";
import { rgPath } from "@vscode/ripgrep";
import { ToolFailure } from "./errors.js";

const RAW_OUTPUT_MAX_BYTES = 5 * 1024 * 1024;
const STDERR_MAX_BYTES = 8 * 1024;
const SEARCH_TIMEOUT_MS = 10_000;

export interface RipgrepResult {
  readonly stdout: string;
  readonly noMatches: boolean;
}

export async function runRipgrep(cwd: string, args: readonly string[], signal?: AbortSignal): Promise<RipgrepResult> {
  if (signal?.aborted) throw new ToolFailure("TURN_CANCELLED", "当前回合已取消。");

  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, args, { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let stopReason: "cancelled" | "timeout" | "too-large" | undefined;

    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      action();
    };
    const stop = (reason: typeof stopReason): void => {
      if (stopReason) return;
      stopReason = reason;
      child.kill();
    };
    const onAbort = (): void => stop("cancelled");
    const timeout = setTimeout(() => stop("timeout"), SEARCH_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > RAW_OUTPUT_MAX_BYTES) return stop("too-large");
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes >= STDERR_MAX_BYTES) return;
      const retained = chunk.subarray(0, STDERR_MAX_BYTES - stderrBytes);
      stderr.push(retained);
      stderrBytes += retained.byteLength;
    });
    child.on("error", error => finish(() => reject(new ToolFailure("PROJECT_DISCOVERY_FAILED", `ripgrep could not start: ${error.message}`))));
    child.on("close", code => finish(() => {
      if (stopReason === "cancelled") return reject(new ToolFailure("TURN_CANCELLED", "当前回合已取消。"));
      if (stopReason === "timeout") return reject(new ToolFailure("PROJECT_DISCOVERY_TIMEOUT", "project discovery timed out"));
      if (stopReason === "too-large") return reject(new ToolFailure("PROJECT_DISCOVERY_TOO_LARGE", "project discovery raw output exceeded 5 MiB; narrow pattern or path"));
      if (code === 0 || code === 1) return resolve({ stdout: Buffer.concat(stdout).toString("utf8"), noMatches: code === 1 });
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      reject(new ToolFailure("PROJECT_DISCOVERY_FAILED", detail ? `ripgrep failed: ${detail}` : `ripgrep exited with code ${code ?? "unknown"}`));
    }));
  });
}
