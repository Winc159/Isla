import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createShellInvocation } from "../../src/tools/shell-adapter.js";
import { resolveWorkdir, runCommand, scrubEnvironment } from "../../src/tools/subprocess-runner.js";

const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe("shell adapter", () => {
  it("runs direct executable argv without shell expansion", async () => {
    const result = await runCommand(process.cwd(), { executable: process.execPath, argv: ["-e", "process.stdout.write(process.argv[1])", "a;b"] });
    expect(result.shell).toBe("direct");
    expect(result.stdout.text).toBe("a;b");
  });
  it("passes the command as one bash argv element", () => expect(createShellInvocation("echo 'a b'", "linux")).toEqual({ shell: "bash", argv: ["bash", "-c", "echo 'a b'"] }));
  it("uses non-interactive PowerShell on Windows", () => expect(createShellInvocation("Write-Output x", "win32")).toEqual({ shell: "powershell", argv: ["pwsh", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Write-Output x"] }));
});

describe("subprocess runner", () => {
  it("runs a command with separated output and exit code", async () => {
    const result = await runCommand(process.cwd(), { command: "Write-Output out; Write-Error err; exit 3" });
    expect(result.exitCode).toBe(3); expect(result.stdout.text).toContain("out"); expect(result.stderr.text).toContain("err");
  });
  it("rejects workdir escape and files", async () => {
    await expect(resolveWorkdir(process.cwd(), ".." )).rejects.toThrow("inside");
    const root = await mkdtemp(join(tmpdir(), "isla-runner-")); cleanup.push(root);
    await writeFile(join(root, "file"), "x");
    await expect(resolveWorkdir(root, "file")).rejects.toThrow("directory");
  });
  it("clamps timeout and aborts the process", async () => {
    const controller = new AbortController();
    const pending = runCommand(process.cwd(), { command: `& '${process.execPath}' -e 'setTimeout(() => {}, 10000)'`, timeoutMs: 10_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await expect(pending).resolves.toMatchObject({ aborted: true });
  });
  it("bounds each output stream", async () => {
    const result = await runCommand(process.cwd(), { command: `& '${process.execPath}' -e 'process.stdout.write("x".repeat(70000)); process.stderr.write("y".repeat(70000))'` });
    expect(Buffer.byteLength(result.stdout.text)).toBe(64_000); expect(result.stdout.truncated).toBe(true);
    expect(Buffer.byteLength(result.stderr.text)).toBe(64_000); expect(result.stderr.truncated).toBe(true);
  });
  it("filters credential-shaped environment names", () => {
    expect(scrubEnvironment({ PATH: "x", API_KEY: "secret", authorization: "secret", SAFE: "ok" })).toEqual({ PATH: "x", SAFE: "ok" });
  });
});
