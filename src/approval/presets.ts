import type { ToolPermission } from "./types.js";

export type PermissionPreset = "readonly" | "workspace";
export function allowsWithoutApproval(preset: PermissionPreset, permission: ToolPermission): boolean {
  return permission.kind === "filesystem-read" && (preset === "readonly" || preset === "workspace");
}
