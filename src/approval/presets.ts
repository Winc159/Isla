import type { ToolPermission } from "./types.js";

export type PermissionPreset = "readonly" | "workspace";
export function allowsWithoutApproval(preset: PermissionPreset, permission: ToolPermission): boolean {
  return preset === "readonly" && permission.kind === "filesystem-read";
}
