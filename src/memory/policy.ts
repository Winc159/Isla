import type { CoreMemoryBlockName, MemoryProvenance, MemoryStatus } from "./types.js";
export type MemoryWriteSource = "explicit-user" | "verified-tool" | "inferred" | "external";
export interface MemoryPolicyInput { readonly source: MemoryWriteSource; readonly content: string; readonly target?: CoreMemoryBlockName; readonly toolSucceeded?: boolean; readonly actor?: "user" | "agent"; }
export interface MemoryPolicyDecision { readonly allowed: boolean; readonly status?: MemoryStatus; readonly provenance?: MemoryProvenance; readonly reason?: string; }
const secretPattern = /(api[_ -]?key|access[_ -]?token|authorization|bearer\s+|-----begin|\bsk-[a-z0-9])/i;
export function evaluateMemoryWrite(input: MemoryPolicyInput): MemoryPolicyDecision {
  if (secretPattern.test(input.content)) return { allowed: false, reason: "memory content appears to contain a secret" };
  if (input.target === "persona" && input.actor !== "user") return { allowed: false, reason: "persona can only be changed by the user" };
  if (input.source === "external") return { allowed: false, reason: "external content cannot become memory automatically" };
  if (input.source === "verified-tool" && input.toolSucceeded !== true) return { allowed: false, reason: "only successful tools can produce verified memory" };
  if (input.source === "inferred") return { allowed: true, status: "candidate", provenance: "inferred" };
  return { allowed: true, status: "active", provenance: input.source };
}
