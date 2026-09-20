import { access, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { sandboxDenied } from "../tools/errors.js";

export type SandboxOperation = "read" | "write" | "list";

const DEFAULT_SENSITIVE_NAMES = new Set([".env", ".env.local", ".env.production", ".env.development", "id_rsa", "id_ed25519"]);

export class SandboxPolicy {
  readonly root: string;
  constructor(rootDirectory: string, private readonly sensitiveNames = DEFAULT_SENSITIVE_NAMES) {
    this.root = resolve(rootDirectory);
  }

  async resolvePath(path: string, operation: SandboxOperation): Promise<string> {
    if (!path.trim() || isAbsolute(path)) throw sandboxDenied("sandbox path must be a non-empty relative path");
    const candidate = resolve(this.root, path);
    this.assertInsideRoot(candidate);
    const existing = await this.findExistingPath(candidate);
    const checked = existing ?? await this.resolveExistingParent(candidate);
    this.assertInsideRoot(checked);
    if (this.isSensitive(candidate) || this.isSensitive(checked)) throw sandboxDenied("sandbox path refers to a protected secret file");
    if (operation === "write" && existing && existing !== candidate) throw sandboxDenied("sandbox refuses writing through a symlink");
    return candidate;
  }

  async resolveRootOrDirectory(path: string): Promise<string> {
    if (path === "") return this.root;
    return this.resolvePath(path, "list");
  }

  async assertWriteTarget(target: string): Promise<void> {
    this.assertInsideRoot(target);
    const parent = await realpath(dirname(target));
    this.assertInsideRoot(parent);
    try {
      const actual = await realpath(target);
      const normalizedActual = process.platform === "win32" ? actual.toLowerCase() : actual;
      const normalizedTarget = process.platform === "win32" ? target.toLowerCase() : target;
      if (normalizedActual !== normalizedTarget) throw sandboxDenied("sandbox refuses writing through a symlink");
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }

  private async findExistingPath(candidate: string): Promise<string | undefined> {
    try { return await realpath(candidate); } catch { return undefined; }
  }

  private async resolveExistingParent(candidate: string): Promise<string> {
    let current = dirname(candidate);
    while (current !== this.root) {
      try { return await realpath(current); } catch { current = dirname(current); }
    }
    return this.root;
  }

  private assertInsideRoot(candidate: string): void {
    const relativePath = relative(this.root, candidate);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) throw sandboxDenied("sandbox path must stay inside the project directory");
  }

  private isSensitive(path: string): boolean {
    return this.sensitiveNames.has(path.split(/[\\/]/).pop()?.toLowerCase() ?? "");
  }
}

export async function assertSandboxRoot(root: string): Promise<void> {
  await access(root);
}
