import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

if (!existsSync(join(process.cwd(), "dist", "cli.js"))) {
  execFileSync(process.execPath, [join(process.cwd(), "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], { cwd: process.cwd(), stdio: "pipe" });
}

describe("NDJSON subprocess", () => {
  it("starts the built CLI, exchanges a prompt, and exits with JSON stdout", async () => {
    const sessionDir = join(tmpdir(), `isla-e2e-${randomUUID()}`);
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "你好，子进程测试通过。" } }] }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not expose a port");
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;
    const child = spawn(process.execPath, ["dist/cli.js", "--env", "--protocol", "ndjson"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ISLA_PROVIDER: "local",
        ISLA_MODEL: "e2e-test-model",
        ISLA_BASE_URL: baseUrl,
        ISLA_SESSION_DIR: sessionDir,
        ISLA_TIMEOUT_MS: "5000",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines: string[] = [];
    const errors: string[] = [];
    child.stderr.on("data", chunk => errors.push(String(chunk)));
    const rl = createInterface({ input: child.stdout });
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`ready timeout; stderr=${errors.join("").slice(-1000)}`)), 15_000);
      rl.on("line", line => {
        lines.push(line);
        try {
          const event = JSON.parse(line) as { type: string };
          if (event.type === "ready") { clearTimeout(timer); resolve(); }
        } catch { reject(new Error("stdout contained invalid JSON")); }
      });
      child.once("error", reject);
    });
    await ready;
    child.stdin.write('{"type":"prompt","id":"p1","text":"你好"}\n');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("response timeout")), 30_000);
      const check = () => {
        if (lines.some(line => {
          try {
            const event = JSON.parse(line) as { type: string; id?: string };
            return event.type === "response_end" && event.id === "p1";
          } catch {
            return false;
          }
        })) {
          clearTimeout(timer);
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });
    child.stdin.write('{"type":"exit","id":"e1"}\n');
    const exitCode = await new Promise<number | null>(resolve => child.once("close", resolve));
    await new Promise<void>(resolve => server.close(() => resolve()));
    expect(exitCode).toBe(0);
    const responseEnd = lines.map(line => JSON.parse(line) as { type: string; id?: string }).find(event => event.type === "response_end" && event.id === "p1");
    expect(responseEnd).toBeDefined();
    expect(errors.join("")).not.toMatch(/api[_-]?key|authorization|deepseek[_-]?api/i);
    expect(lines.every(line => { try { JSON.parse(line); return true; } catch { return false; } })).toBe(true);
  }, 60_000);
});
