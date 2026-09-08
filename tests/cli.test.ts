import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { IslaRuntime } from "../src/core/runtime.js";
import { FakeProvider } from "./support/fake-provider.js";
describe("cli", () => it("answers and exits without network", async () => { const p = new FakeProvider([{ text: "ok" }]); const r = new IslaRuntime().use({ name: "fake", setup: c => c.registerProvider(p) }); let out = ""; let err = ""; await runCli(Readable.from(["你好\n", "/exit\n"]), new Writable({ write(c, _e, cb) { out += c.toString(); cb(); } }), new Writable({ write(c, _e, cb) { err += c.toString(); cb(); } }), r, "fake", "fake-model"); expect(out).toContain("isla> ok"); expect(err).toBe(""); }));
