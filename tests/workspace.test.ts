import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorkspace } from "../src/workspace.js";

describe("workspace resolution", () => {
  it("prefers explicit, then profile, then cwd and returns an absolute real path", async () => {
    const root = await mkdtemp(join(tmpdir(), "isla-workspace-"));
    const profile = join(root, "profile");
    const explicit = join(root, "explicit");
    await mkdir(profile); await mkdir(explicit);
    await expect(resolveWorkspace(undefined, profile, root)).resolves.toBe(resolve(profile));
    await expect(resolveWorkspace(explicit, profile, root)).resolves.toBe(resolve(explicit));
    await expect(resolveWorkspace(undefined, undefined, root)).resolves.toBe(resolve(root));
  });

  it("fails before runtime creation for a missing path", async () => {
    const root = await mkdtemp(join(tmpdir(), "isla-workspace-"));
    await expect(resolveWorkspace(join(root, "missing"), undefined, root)).rejects.toThrow("accessible directory");
  });
});
