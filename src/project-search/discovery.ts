import { lstat, open, readdir } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { SandboxPolicy } from "../sandbox/policy.js";
import { PROJECT_SEARCH_DEFAULTS, ProjectSearchValidationError } from "./types.js";

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "coverage"]);
const SENSITIVE_NAMES = new Set([".env", ".env.local", ".env.production", ".env.development", "id_rsa", "id_ed25519"]);

export interface ProjectFileDiscovery {
  readonly path: string;
  readonly absolutePath: string;
}

/** Enumerates readable text files in a workspace without following links. */
export async function discoverProjectFiles(projectRoot: string, searchPath = ""): Promise<readonly ProjectFileDiscovery[]> {
  const sandbox = new SandboxPolicy(projectRoot);
  let directory: string;
  try { directory = await sandbox.resolveRootOrDirectory(searchPath); }
  catch (error) { throw normalizeDiscoveryError(error); }
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProjectSearchValidationError("INVALID_PATH", "project search path must refer to a directory");
  return walk(projectRoot, directory, sandbox);
}

async function walk(root: string, directory: string, sandbox: SandboxPolicy): Promise<ProjectFileDiscovery[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: ProjectFileDiscovery[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) files.push(...await walk(root, absolutePath, sandbox));
      continue;
    }
    if (!entry.isFile() || SENSITIVE_NAMES.has(basename(entry.name).toLowerCase())) continue;
    const stat = await lstat(absolutePath);
    if (stat.size > PROJECT_SEARCH_DEFAULTS.maxFileBytes || await isBinary(absolutePath)) continue;
    await sandbox.resolvePath(relative(root, absolutePath), "read");
    files.push({ path: relative(root, absolutePath).replaceAll("\\", "/"), absolutePath });
  }
  return files;
}

async function isBinary(path: string): Promise<boolean> {
  const handle = await open(path, "r").catch(() => undefined);
  if (!handle) return true;
  try {
    const buffer = Buffer.alloc(8_192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } catch { return true; }
  finally { await handle.close(); }
}

function normalizeDiscoveryError(error: unknown): Error {
  if (error instanceof ProjectSearchValidationError) return error;
  const code = (error as { readonly code?: string }).code;
  if (code === "INVALID_PATH" || code === "SANDBOX_DENIED") return new ProjectSearchValidationError("INVALID_PATH", "project search path is invalid");
  return error instanceof Error ? error : new Error("project search path could not be resolved");
}
