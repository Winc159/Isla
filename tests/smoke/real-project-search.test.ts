import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const enabled = process.env.ISLA_RUN_REAL_SMOKE === "1";
const configured = Boolean(process.env.DEEPSEEK_API_KEY && process.env.ISLA_MODEL);
const tracePath = process.env.ISLA_NDJSON_LOG;

describe.skipIf(!enabled || !configured)("real v0.2.3 project search", () => {
  it("uses search_project and returns a verifiable source", async () => {
    const root = await mkdtemp(join(tmpdir(), "isla-real-project-search-"));
    const sessionDir = await mkdtemp(join(tmpdir(), "isla-real-project-session-"));
    const memoryDir = await mkdtemp(join(tmpdir(), "isla-real-project-memory-"));
    await writeFile(join(root, "PROJECT-FACT.md"), "Isla 的唯一验收代号是 ORBIT-731。\n", "utf8");
    const child = spawn(process.execPath, [resolve("dist/cli.js"), "--protocol", "ndjson"], { cwd: root, env: { ...process.env, ISLA_PROVIDER: "deepseek", ISLA_SESSION_DIR: sessionDir, ISLA_MEMORY_DB: join(memoryDir, "memory.sqlite"), ISLA_MEMORY_ENABLED: "0" }, stdio: ["pipe", "pipe", "pipe"] });
    const events: Array<{ type: string; tool?: string; ok?: boolean; text?: string }> = [];
    const stderr: string[] = [];
    child.stderr.on("data", chunk => stderr.push(String(chunk).replace(/api[_-]?key|authorization/gi, "[redacted]")));
    const lines = createInterface({ input: child.stdout });
    lines.on("line", line => { if (tracePath) appendFileSync(tracePath, `${line}\n`, "utf8"); try { events.push(JSON.parse(line) as typeof events[number]); } catch { /* protocol assertion below will fail */ } });
    try {
      await waitFor(() => events.some(event => event.type === "ready"), 30_000, () => `events=${JSON.stringify(events)} stderr=${stderr.join("").slice(-1000)}`);
      child.stdin.write(`${JSON.stringify({ type: "prompt", id: "project-search-1", text: "请使用 search_project 工具搜索项目中关于 ORBIT-731 的事实，不要使用其他文件工具；然后回答它出现在哪个相对路径和第几行。" })}\n`);
      await waitFor(() => events.some(event => event.type === "response_end"), 90_000, () => `events=${JSON.stringify(events)} stderr=${stderr.join("").slice(-1000)}`);
      expect(events).toContainEqual(expect.objectContaining({ type: "tool_start", tool: "search_project" }));
      expect(events).toContainEqual(expect.objectContaining({ type: "tool_end", tool: "search_project", ok: true }));
      expect(events.find(event => event.type === "response_end")?.text).toMatch(/PROJECT-FACT\.md|第.?1.?行|1/);
      child.stdin.write(`${JSON.stringify({ type: "exit", id: "project-search-exit" })}\n`);
    } finally {
      child.kill(); lines.close(); await rm(sessionDir, { recursive: true, force: true }); await rm(memoryDir, { recursive: true, force: true }); await rm(root, { recursive: true, force: true });
    }
  }, 150_000);
});

async function waitFor(predicate: () => boolean, timeoutMs: number, diagnostics?: () => string): Promise<void> {
  const started = Date.now();
  while (!predicate()) { if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for real project search event; ${diagnostics?.() ?? "no diagnostics"}`); await new Promise(resolvePromise => setTimeout(resolvePromise, 100)); }
}
