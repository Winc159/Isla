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

type Event = { type: string; id?: string; tool?: string; callId?: string; query?: string; url?: string; text?: string; approvalId?: string; approved?: boolean; ok?: boolean; code?: string; sessionId?: string; message?: string; error?: string; capabilities?: { webFetch?: boolean; webSearch?: boolean } };

class Driver {
  readonly events: Event[] = [];
  readonly stderr: string[] = [];
  private readonly waiters = new Map<string, Array<(event: Event) => void>>();
  private readonly child: ChildProcessWithoutNullStreams;
  constructor(cwd: string, sessionDir: string, memoryPath: string, configPath?: string) {
    this.child = spawn(process.execPath, [resolve("dist/cli.js"), ...(configPath ? ["--config", configPath, "--profile", "eval"] : ["--env"]), "--protocol", "ndjson"], {
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
      let failurePoll: NodeJS.Timeout;
      const timer = setTimeout(() => { clearInterval(failurePoll); reject(new Error(`timeout waiting for ${type}${id ? `:${id}` : ""}; diagnostics=${formatDiagnostics(this.events)}; stderr=${this.stderr.join("").slice(-500)}`)); }, timeout);
      const done = (event: Event) => { clearTimeout(timer); clearInterval(failurePoll); resolve(event); };
      failurePoll = setInterval(() => {
        const failure = this.events.slice(from).find(event => event.type === "error" && (id === undefined || event.id === id));
        if (failure) { clearTimeout(timer); clearInterval(failurePoll); reject(new Error(`response error ${id ?? ""}: ${failure.code ?? "unknown"} ${failure.message ?? failure.error ?? ""}`)); }
      }, 50);
    const list = this.waiters.get(`${type}:${id ?? "*"}`) ?? [];
      list.push(done); this.waiters.set(`${type}:${id ?? "*"}`, list);
    });
  }
  async waitApproval(timeout = 90_000, from = 0): Promise<Event> {
    const existing = this.events.slice(from).find(event => event.type === "approval_request" && event.approvalId);
    if (existing) return existing;
    return this.wait("approval_request", undefined, timeout, from);
  }
  async waitResponse(id: string): Promise<Event> {
    const failure = this.events.find(event => event.type === "error" && event.id === id);
    if (failure) throw new Error(`response error ${id}: ${failure.code ?? "unknown"} ${failure.message ?? failure.error ?? ""}`);
    const event = await this.wait("response_end", id, 90_000);
    if (!event.text?.trim()) throw new Error(`empty response for ${id}`);
    return event;
  }
  async waitResponseApprovingNetwork(id: string, timeout = 180_000): Promise<Event> {
    const deadline = Date.now() + timeout;
    const approved = new Set<string>();
    let sequence = 0;
    while (Date.now() < deadline) {
      const failure = this.events.find(event => event.type === "error" && event.id === id);
      if (failure) throw new Error(`response error ${id}: ${failure.code ?? "unknown"} ${failure.message ?? failure.error ?? ""}`);
      const response = this.events.find(event => event.type === "response_end" && event.id === id);
      if (response) {
        if (!response.text?.trim()) throw new Error(`empty response for ${id}`);
        return response;
      }
      for (const approval of this.events.filter(event => event.type === "approval_request" && event.id === id && event.approvalId)) {
        if (approved.has(approval.approvalId!)) continue;
        approved.add(approval.approvalId!);
        this.send({ type: "approval_response", id: `${id}-approval-${++sequence}`, approvalId: approval.approvalId, approved: true });
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`timeout waiting for ${id}; diagnostics=${formatDiagnostics(this.events)}; stderr=${this.stderr.join("").slice(-500)}`);
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

function formatDiagnostics(events: readonly Event[]): string {
  return events.map(event => {
    if (event.type === "tool_start") return `${event.type}:${event.tool}${event.query ? ` query=${JSON.stringify(event.query)}` : ""}${event.url ? ` url=${event.url}` : ""}`;
    return `${event.type}${event.tool ? `:${event.tool}` : ""}${event.code ? `:${event.code}` : ""}${event.message ? `:${event.message}` : ""}`;
  }).join(" | ");
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

    driver.send({ type: "prompt", id: `reject-${round}`, text: "必须调用 write_text_file Tool：在当前项目目录创建 acceptance-rejected.txt，写入精确内容 rejected。不要只用自然语言回答，先发起 Tool Call 等待审批。" });
    const rejectedApproval = await driver.wait("approval_request");
    expect(rejectedApproval.approvalId).toBeTruthy();
    driver.send({ type: "approval_response", id: `reject-approval-${round}`, approvalId: rejectedApproval.approvalId, approved: false });
    await driver.waitResponse(`reject-${round}`);

    driver.send({ type: "new_session", id: `new-${round}` });
    const changed = await driver.wait("session_changed");
    expect(changed.sessionId).toBeTruthy();

    driver.send({ type: "prompt", id: `recall-${round}`, text: "本次验收记录的偏好是什么？请简洁回答。" });
    await driver.waitResponse(`recall-${round}`);

    driver.send({ type: "prompt", id: `approve-${round}`, text: "必须调用 write_text_file Tool：在当前项目目录创建 acceptance-approved.txt，写入精确内容 approved。不要只用自然语言回答，先发起 Tool Call 等待审批。" });
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

describe.skipIf(!enabled || !configured)("real Agent Loop clarification driver", () => {
  it("clarifies first, then continues the original task", async () => {
    const root = await mkdtemp(join(tmpdir(), `isla-agent-loop-${randomUUID()}-`));
    const sessions = await mkdtemp(join(tmpdir(), `isla-agent-loop-sessions-${randomUUID()}-`));
    const memory = await mkdtemp(join(tmpdir(), `isla-agent-loop-memory-${randomUUID()}-`));
    const driver = new Driver(root, sessions, join(memory, "memory.sqlite"));
    try {
      await driver.wait("ready", undefined, 30_000);
      driver.send({ type: "prompt", id: "clarify", text: "去重庆取车，然后自驾回广州，按照这个路线自驾游。" });
      const first = await driver.waitResponse("clarify");
      expect(first.outcome).toBe("needs_user");
      expect(driver.events.filter(event => event.type === "tool_start")).toHaveLength(0);
      expect(first.text).not.toMatch(/D1|D2|1400|1550|16\s*小时|19\s*小时/);
      driver.send({ type: "prompt", id: "continue", text: "补充：计划 5 天，预算适中，2 人 1 名驾驶员，优先自然风景，接受高速。请继续原任务。" });
      const second = await driver.waitResponse("continue");
      expect(second.text?.trim()).toBeTruthy();
      expect(driver.events.some(event => event.type === "response_end" && event.id === "continue")).toBe(true);
      driver.send({ type: "exit", id: "exit" });
      await driver.wait("bye", "exit", 30_000);
    } finally {
      await driver.close();
      await rm(root, { recursive: true, force: true });
      await rm(sessions, { recursive: true, force: true });
      await rm(memory, { recursive: true, force: true });
    }
  }, 300_000);
});

describe.skipIf(!enabled || !configured)("real Agent Loop web planning driver", () => {
  it("autonomously searches, reads, analyzes, and synthesizes a planning request", async () => {
    const root = await mkdtemp(join(tmpdir(), `isla-agent-web-${randomUUID()}-`));
    const sessions = await mkdtemp(join(tmpdir(), `isla-agent-web-sessions-${randomUUID()}-`));
    const configDir = await mkdtemp(join(tmpdir(), `isla-agent-web-config-${randomUUID()}-`));
    const configPath = join(configDir, "config.json");
    const source = JSON.parse(await readFile(join(process.env.USERPROFILE ?? "", ".isla", "config.json"), "utf8"));
    source.profiles.eval = { ...source.profiles.deepseek, sessionDirectory: sessions, memory: { ...(source.profiles.deepseek.memory ?? {}), database: join(configDir, "memory.sqlite") }, runtime: { ...(source.profiles.deepseek.runtime ?? {}), timeoutMs: 600_000 }, tools: { webSearch: { enabled: true, maxResults: 5, timeoutMs: 60_000 }, webFetch: { enabled: true, allowedHosts: ["deny.invalid"], allowSearchResultUrls: true } }, appearance: { logLevel: "quiet" } };
    await writeFile(configPath, JSON.stringify({ version: 1, defaultProfile: "eval", profiles: { eval: source.profiles.eval } }), "utf8");
    const driver = new Driver(root, sessions, join(configDir, "memory.sqlite"), configPath);
    try {
      await driver.wait("ready", undefined, 30_000);
      const ready = driver.events.find(event => event.type === "ready");
      expect(ready?.capabilities?.webFetch).toBe(true);
      expect(ready?.capabilities?.webSearch).toBe(true);
      driver.send({ type: "prompt", id: "plan-web", text: "国庆 10 月 1 日从重庆渝北提车，3 个人自驾回广州天河，10 月 6 日到即可，想在湘西多玩，其他路线和景点由你推荐。请直接给一版可修改的完整方案。" });
      const second = await driver.waitResponseApprovingNetwork("plan-web");
      expect(second.text?.trim()).toBeTruthy();
      // response_end omits the default completed outcome; an absent outcome
      // is the protocol's completed state.
      expect(second.outcome ?? "completed").toBe("completed");
      expect(driver.events.some(event => event.type === "tool_start" && event.tool === "web_search")).toBe(true);
      expect(driver.events.some(event => event.type === "tool_end" && event.tool === "web_search" && event.ok === true)).toBe(true);
      expect(driver.events.some(event => event.type === "tool_start" && event.tool === "web_fetch")).toBe(true);
      expect(driver.events.some(event => event.type === "tool_end" && event.tool === "web_fetch" && event.ok === true)).toBe(true);
    } finally {
      await driver.close();
      await rm(root, { recursive: true, force: true }); await rm(sessions, { recursive: true, force: true }); await rm(configDir, { recursive: true, force: true });
    }
  }, 180_000);
});
