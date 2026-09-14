import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

describe("Profile NDJSON acceptance", () => {
  it("starts from config without TTY and exits through NDJSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "isla-profile-e2e-"));
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "profile dialogue ok" } }] }));
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not expose a port");
    const configPath = join(root, "config.json");
    await writeFile(configPath, JSON.stringify({ version: 1, defaultProfile: "local-test", profiles: {
      "local-test": { provider: "local", model: "fixture-model", baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: "test-only-profile-key", appearance: { personality: "minimal", logLevel: "quiet" }, tools: { webFetch: { enabled: true, allowedHosts: ["example.com"] } } },
    } }));
    const child = spawn(process.execPath, [join(process.cwd(), "dist", "cli.js"), "--config", configPath, "--profile", "local-test", "--protocol", "ndjson"], {
      cwd: process.cwd(),
      env: { ...process.env, USERPROFILE: root, HOME: root, HOMEDRIVE: "", HOMEPATH: "", ISLA_TIMEOUT_MS: "5000" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines: string[] = []; const errors: string[] = [];
    child.stderr.on("data", chunk => errors.push(String(chunk)));
    const rl = createInterface({ input: child.stdout });
    const events: Array<{ type: string; id?: string; text?: string; provider?: string; model?: string; workspace?: string; capabilities?: { toolCalling: boolean; cancellation: boolean; streaming: boolean; webFetch?: boolean } }> = [];
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`ready timeout; stderr=${errors.join("").slice(-1000)}`)), 15_000);
      rl.on("line", line => { lines.push(line); try { const event = JSON.parse(line); events.push(event); if (event.type === "ready") { clearTimeout(timer); resolve(); } } catch { reject(new Error("stdout contained invalid JSON")); } });
      child.once("error", reject);
    });
    try {
      await ready;
      expect(events[0]).toMatchObject({ type: "ready", provider: "local", model: "fixture-model", workspace: process.cwd(), capabilities: { toolCalling: true, cancellation: true, streaming: false, webFetch: true } });
      child.stdin.write('{"type":"exit","id":"e1"}\n');
      const exitCode = await new Promise<number | null>(resolve => child.once("close", resolve));
      expect(exitCode).toBe(0);
      expect(events.some(e => e.type === "bye" && e.id === "e1")).toBe(true);
      expect(lines.every(line => { try { JSON.parse(line); return true; } catch { return false; } })).toBe(true);
      expect(lines.join("\n")).not.toContain("test-only-profile-key");
      expect(errors.join("\n")).not.toContain("test-only-profile-key");
    } finally {
      child.kill();
      rl.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
