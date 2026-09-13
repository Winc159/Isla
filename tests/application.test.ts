import { describe, expect, it } from "vitest";
import { createApplication, createStderrDiagnosticSink } from "../src/application.js";
import { IslaRuntime } from "../src/core/runtime.js";

describe("ApplicationContext resources", () => {
  it("owns an isolated memory/session resource set and closes idempotently", () => {
    const app = createApplication({
      provider: "local", model: "fixture", baseURL: "http://127.0.0.1:1/v1", apiKey: "fixture", timeoutMs: 1000,
      debug: false, maxContextTurns: 2, maxContextChars: 1000, contextRetainTurns: 1, modelRetries: 0,
      memoryEnabled: false, logLevel: "quiet", workspaceRoot: process.cwd(),
    }, new IslaRuntime());
    expect(app.runtime).toBeInstanceOf(IslaRuntime);
    expect(app.sessions).toBeDefined();
    expect(app.memory.enabled).toBe(false);
    expect(() => { app.close(); app.close(); }).not.toThrow();
  });
});

describe("diagnostic sink", () => {
  it.each([
    ["quiet", ["error"]],
    ["normal", ["warning", "error"]],
    ["debug", ["debug", "warning", "error"]],
  ] as const)("filters %s output", (level, expected) => {
    const chunks: string[] = [];
    const sink = createStderrDiagnosticSink(level, { write: (value: string) => { chunks.push(value); return true; } } as never);
    for (const severity of ["debug", "warning", "error"] as const) sink.emit({ code: `C_${severity}`, component: "test", severity, detail: "safe" });
    expect(chunks.map(chunk => chunk.match(/^\[(\w+)\]/)?.[1])).toEqual(expected);
  });
});
