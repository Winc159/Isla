import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { IslaRuntime } from "../src/core/runtime.js";
import type { Message } from "../src/core/types.js";
import type { SessionStore, StoredSession } from "../src/session-store.js";
import { FakeProvider } from "./support/fake-provider.js";

class MemorySessionStore implements SessionStore {
  readonly sessions: StoredSession[] = [];
  async loadLatest(provider: string, model: string) { return [...this.sessions].reverse().find(session => session.provider === provider && session.model === model); }
  async create(provider: string, model: string, messages: readonly Message[]) {
    const session: StoredSession = { version: 1, id: String(this.sessions.length + 1), createdAt: "now", updatedAt: "now", provider, model, messages: [...messages] };
    this.sessions.push(session);
    return session;
  }
  async save(session: StoredSession, messages: readonly Message[]) {
    const updated = { ...session, messages: [...messages] };
    this.sessions[this.sessions.findIndex(item => item.id === session.id)] = updated;
    return updated;
  }
}

function writable(append: (text: string) => void, isTTY = false) {
  const stream = new Writable({ write(chunk, _encoding, callback) { append(chunk.toString()); callback(); } });
  return Object.assign(stream, { isTTY });
}

describe("cli", () => {
  it("answers and exits without network", async () => {
    const p = new FakeProvider([{ text: "ok" }]);
    const r = new IslaRuntime().use({ name: "fake", setup: c => c.registerProvider(p) });
    const store = new MemorySessionStore();
    let out = "";
    let err = "";
    await runCli(Readable.from(["你好\n", "/exit\n"]), writable(text => { out += text; }, true), writable(text => { err += text; }), r, "fake", "fake-model", undefined, false, 20, store);
    expect(out).toContain("isla> ok");
    expect(out).toContain("生成中");
    expect(out).toContain("\x1b[2K");
    expect(out).toMatch(/耗时 \d+\.\d+s/);
    expect(out).not.toContain("you> 你好");
    expect(err).toBe("");
  });

  it("resumes the latest session and starts isolated context with /new", async () => {
    const p = new FakeProvider([{ text: "a1" }, { text: "a2" }, { text: "a3" }]);
    const r = new IslaRuntime().use({ name: "fake", setup: c => c.registerProvider(p) });
    const store = new MemorySessionStore();
    let out = "";
    const output = writable(text => { out += text; });
    const errors = writable(() => {});
    await runCli(Readable.from(["u1\n", "/exit\n"]), output, errors, r, "fake", "fake-model", undefined, false, 20, store);
    await runCli(Readable.from(["u2\n", "/new\n", "u3\n", "/exit\n"]), output, errors, r, "fake", "fake-model", undefined, false, 20, store);
    expect(p.requests[1]?.messages).toEqual([
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
    ]);
    expect(p.requests[2]?.messages).toEqual([{ role: "user", content: "u3" }]);
    expect(store.sessions).toHaveLength(2);
    expect(out).toContain("\x1b[2J\x1b[3J\x1b[H");
  });
});
