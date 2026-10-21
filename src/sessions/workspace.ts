import { createHash } from "node:crypto";
import { resolve, normalize } from "node:path";

export function workspaceKey(workspaceRoot: string): string {
  const normalized = normalize(resolve(workspaceRoot)).replaceAll("\\", "/");
  const canonical = process.platform === "win32" ? normalized.toLowerCase() : normalized;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
