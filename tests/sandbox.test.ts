import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SandboxPolicy } from "../src/sandbox/policy.js";

const root = join(process.cwd(), ".tmp-sandbox-test");
const outside = join(process.cwd(), ".tmp-sandbox-outside");
afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("SandboxPolicy", () => {
  it("blocks traversal, protected names and symlink escapes", async () => {
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "secret.txt"), "secret", "utf8");
    await symlink(outside, join(root, "link"), "junction");
    const sandbox = new SandboxPolicy(root);
    await expect(sandbox.resolvePath("../outside.txt", "read")).rejects.toThrow("inside");
    await expect(sandbox.resolvePath(".env", "read")).rejects.toThrow("protected");
    await expect(sandbox.resolvePath("link/secret.txt", "read")).rejects.toThrow("inside");
  });
});
