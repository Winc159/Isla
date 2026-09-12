import { createInterface } from "node:readline";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { MemoryStore } from "../../src/memory/store.js";
import { describe, expect, it } from "vitest";

const enabled = process.env.ISLA_RUN_REAL_SMOKE === "1";
const configured = Boolean(process.env.DEEPSEEK_API_KEY && process.env.ISLA_MODEL);
const tracePath = process.env.ISLA_NDJSON_LOG?.trim();

if (tracePath) {
  mkdirSync(dirname(tracePath), { recursive: true });
  appendFileSync(tracePath, `\n=== Isla real NDJSON test ${new Date().toISOString()} ===\n`, "utf8");
}

function writeTrace(line: string): void {
  if (tracePath) appendFileSync(tracePath, `${new Date().toISOString()} ${line}\n`, "utf8");
}

type Event = { type: string; id?: string; text?: string; approvalId?: string; approved?: boolean; ok?: boolean; code?: string; sessionId?: string };

class Driver {
  readonly events: Event[] = [];
  readonly stderr: string[] = [];
  private readonly waiters = new Map<string, Array<(event: Event) => void>>();
  private readonly child: ChildProcessWithoutNullStreams;
  constructor(cwd: string, sessionDir: string, memoryPath: string) {
    this.child = spawn(process.execPath, [resolve("dist/cli.js"), "--env", "--protocol", "ndjson"], {
      cwd,
      env: { ...process.env, ISLA_PROVIDER: "deepseek", ISLA_SESSION_DIR: sessionDir, ISLA_MEMORY_DB: memoryPath, ISLA_MEMORY_ENABLED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const rl = createInterface({ input: this.child.stdout });
    this.child.stderr.on("data", chunk => this.stderr.push(String(chunk).replace(/api[_-]?key|authorization/gi, "[redacted]")));
    rl.on("line", line => {
      const event = JSON.parse(line) as Event;
      this.events.push(event);
      writeTrace(`[ndjson stdout] ${JSON.stringify(event)}`);
      for (const key of [`${event.type}:${event.id ?? "*"}`, `${event.type}:*`]) {
        const pending = this.waiters.get(key);
        pending?.splice(0).forEach(resolve => resolve(event));
      }
    });
  }
  send(request: object): void {
    writeTrace(`[ndjson stdin] ${JSON.stringify(request)}`);
    this.child.stdin.write(`${JSON.stringify(request)}\n`);
  }
  wait(type: string, id?: string, timeout = 25_000, from = 0): Promise<Event> {
    const matches = (event: Event) => event.type === type && (id === undefined || event.id === id);
    const existing = this.events.slice(from).find(matches);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}${id ? `:${id}` : ""}; events=${this.events.map(event => `${event.type}:${event.id ?? ""}${event.type === "response_end" && event.text ? `(${event.text.slice(0, 120)})` : ""}`).join(",")}; stderr=${this.stderr.join("").slice(-500)}`)), timeout);
      const done = (event: Event) => { clearTimeout(timer); resolve(event); };
      const list = this.waiters.get(`${type}:${id ?? "*"}`) ?? [];
      list.push(done); this.waiters.set(`${type}:${id ?? "*"}`, list);
    });
  }
  async waitResponse(id: string): Promise<Event> {
    const event = await this.wait("response_end", id, 90_000);
    if (!event.text?.trim()) throw new Error(`empty response for ${id}`);
    return event;
  }
  async close(): Promise<number | null> {
    if (!this.child.stdin.destroyed) this.child.stdin.end();
    return await new Promise(resolve => {
      const timer = setTimeout(() => { this.child.kill(); }, 5_000);
      this.child.once("close", code => { clearTimeout(timer); resolve(code); });
    });
  }
  abort(): void { if (!this.child.killed) this.child.kill(); }
}

async function runRound(round: number): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `isla-real-ndjson-${randomUUID()}-`));
  const sessions = await mkdtemp(join(tmpdir(), `isla-real-sessions-${randomUUID()}-`));
  const memory = await mkdtemp(join(tmpdir(), `isla-real-memory-${randomUUID()}-`));
  const memoryPath = join(memory, "memory.sqlite");
  await writeFile(join(root, "README.md"), "# Acceptance fixture\n\nApproval uses one matching approvalId.\n", "utf8");
  const driver = new Driver(root, sessions, memoryPath);
  try {
    await driver.wait("ready");
    driver.send({ type: "prompt", id: `answer-${round}`, text: "用一句话回答：你准备好了么？" });
    await driver.waitResponse(`answer-${round}`);

    driver.send({ type: "prompt", id: `remember-${round}`, text: "请记住：本次验收偏好是简洁回答。" });
    await driver.waitResponse(`remember-${round}`);

    driver.send({ type: "prompt", id: `inspect-${round}`, text: "查看当前目录并说明你能看到什么，只读取，不修改任何文件。" });
    await driver.waitResponse(`inspect-${round}`);

    driver.send({ type: "prompt", id: `discuss-${round}`, text: "讨论如何改进当前审批流程；可以读取相关源码，但不要修改文件。" });
    await driver.waitResponse(`discuss-${round}`);

    driver.send({ type: "prompt", id: `reject-${round}`, text: "在当前项目目录创建 acceptance-rejected.txt，写入精确内容 rejected。" });
    const rejectedApproval = await driver.wait("approval_request");
    expect(rejectedApproval.approvalId).toBeTruthy();
    driver.send({ type: "approval_response", id: `reject-approval-${round}`, approvalId: rejectedApproval.approvalId, approved: false });
    await driver.waitResponse(`reject-${round}`);

    driver.send({ type: "new_session", id: `new-${round}` });
    const changed = await driver.wait("session_changed");
    expect(changed.sessionId).toBeTruthy();

    driver.send({ type: "prompt", id: `recall-${round}`, text: "本次验收记录的偏好是什么？请简洁回答。" });
    await driver.waitResponse(`recall-${round}`);

    driver.send({ type: "prompt", id: `approve-${round}`, text: "在当前项目目录创建 acceptance-approved.txt，写入精确内容 approved。" });
    const approvedApproval = await driver.wait("approval_request", undefined, 90_000, driver.events.length);
    expect(approvedApproval.approvalId).toBeTruthy();
    driver.send({ type: "approval_response", id: `approve-approval-${round}`, approvalId: approvedApproval.approvalId, approved: true });
    await driver.waitResponse(`approve-${round}`);
    expect((await readFile(join(root, "acceptance-approved.txt"), "utf8")).trim()).toBe("approved");

    driver.send({ type: "exit", id: `exit-${round}` });
    const exit = await driver.wait("bye");
    expect(exit.id).toBe(`exit-${round}`);
    expect(driver.events.filter(event => event.type === "approval_request")).toHaveLength(2);
  } catch (error) {
    driver.abort();
    throw error;
  } finally {
    await driver.close();
    const memoryStore = new MemoryStore(memoryPath);
    try {
      const records = memoryStore.list({ status: "active" });
      expect(records.some(record => record.content.includes("简洁回答") && record.source?.sessionId), `active memory records=${JSON.stringify(records.map(record => ({ content: record.content, source: record.source })))}`).toBe(true);
    } finally { memoryStore.close(); }
    await rm(root, { recursive: true, force: true });
    await rm(sessions, { recursive: true, force: true });
    await rm(memory, { recursive: true, force: true });
  }
}

describe.skipIf(!enabled || !configured)("real NDJSON acceptance driver", () => {
  it("passes the complete scenario twice", async () => {
    await runRound(1);
    await runRound(2);
  }, 300_000);
});
