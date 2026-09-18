import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { workspaceKey } from "../../src/session-workspace.js";

const enabled = process.env.ISLA_RUN_REAL_BAILIAN_SMOKE === "1";
const configPath = join(process.env.USERPROFILE ?? "", ".isla", "config.json");
const configured = await readConfig(configPath);

describe.skipIf(!enabled || !configured)("real Bailian Session Query evaluation", () => {
  it("lets Qwen search an isolated prior Session", async () => {
    const root = await mkdtemp(join(tmpdir(), `isla-real-query-root-${randomUUID()}-`));
    const sessions = await mkdtemp(join(tmpdir(), `isla-real-query-sessions-${randomUUID()}-`));
    const configDir = await mkdtemp(join(tmpdir(), `isla-real-query-config-${randomUUID()}-`));
    const evalConfig = join(configDir, "config.json");
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const source = JSON.parse(await readFile(configPath, "utf8")) as { version: number; defaultProfile: string; profiles: Record<string, Record<string, unknown>> };
      const base = source.profiles.bailian;
      const model = typeof base.model === "string" ? base.model : "qwen3.7-plus";
      const profile = { ...base, model, sessionDirectory: sessions, memory: { enabled: false, database: join(configDir, "memory.sqlite") }, appearance: { logLevel: "quiet" } };
      await writeFile(evalConfig, JSON.stringify({ version: 1, defaultProfile: "eval", profiles: { eval: profile } }), "utf8");
      const currentWorkspaceKey = workspaceKey(root);
      const prior = { version: 4, id: "prior-session", createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:01.000Z", provider: "bailian", model, workspaceKey: currentWorkspaceKey, messages: [{ role: "user", content: "本次隔离评估的历史暗号是 cobalt-seven。" }, { role: "assistant", content: "已记录。" }], journal: { version: 1, turns: [] } };
      await writeFile(join(sessions, "prior-session.json"), `${JSON.stringify(prior)}\n`, "utf8");
      const current = { ...prior, id: "current-session", updatedAt: "2026-09-18T00:00:02.000Z", messages: [], task: undefined };
      await writeFile(join(sessions, "current-session.json"), `${JSON.stringify(current)}\n`, "utf8");
      child = spawn(process.execPath, [resolve("dist/cli.js"), "--config", evalConfig, "--profile", "eval", "--protocol", "ndjson"], { cwd: root, env: { ...process.env, ISLA_MEMORY_ENABLED: "0" }, stdio: ["pipe", "pipe", "pipe"] });
      let output = "";
      let errorOutput = "";
      child.stdout.on("data", chunk => { output += String(chunk); });
      child.stderr.on("data", chunk => { errorOutput += String(chunk).replaceAll(/api[_-]?key|authorization/gi, "[redacted]"); });
      const waitFor = async (type: string, id?: string, timeout = 180_000): Promise<Record<string, unknown>> => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          const event = output.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>).find(item => item.type === type && (id === undefined || item.id === id));
          if (event) return event;
          await new Promise(resolveWait => setTimeout(resolveWait, 50));
        }
        throw new Error(`timeout waiting for ${type}; stderr=${errorOutput.slice(-500)}`);
      };
      await waitFor("ready");
      child.stdin.write(`${JSON.stringify({ type: "sessions_search", id: "search-1", query: "cobalt-seven" })}\n`);
      const search = await waitFor("sessions_result", "search-1");
      expect((search.sessions as Array<{ sessionId: string }>).some(session => session.sessionId === "prior-session")).toBe(true);
      child.stdin.write(`${JSON.stringify({ type: "prompt", id: "prompt-1", text: "必须使用 search_session_history 搜索 cobalt-seven，然后使用 read_session_context 读取命中的历史 Session，最后用一句话回答历史暗号。" })}\n`);
      const response = await waitFor("response_end", "prompt-1", 90_000);
      expect(String(response.text ?? "").trim()).toBeTruthy();
      expect(output).toContain('"tool":"search_session_history"');
      expect(output).toContain('"tool":"read_session_context"');
      expect(output).not.toContain("api_key");
    } finally {
      if (child && !child.killed) child.kill();
      if (child) await new Promise<void>(resolveClose => child!.once("close", () => resolveClose()));
      await rm(root, { recursive: true, force: true });
      await rm(sessions, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  }, 240_000);
});

async function readConfig(path: string): Promise<boolean> {
  try {
    const config = JSON.parse(await readFile(path, "utf8")) as { profiles?: Record<string, { provider?: string }> };
    return config.profiles?.bailian?.provider === "bailian";
  } catch { return false; }
}
