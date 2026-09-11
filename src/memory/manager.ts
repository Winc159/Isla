import type { CreateMemoryInput, MemoryRecord } from "./types.js";
import { evaluateMemoryWrite, type MemoryPolicyInput } from "./policy.js";
import type { MemoryStore } from "./store.js";

export class AutonomousMemoryManager {
  constructor(private readonly store: MemoryStore) {}

  propose(input: { readonly policy: MemoryPolicyInput; readonly memory: Omit<CreateMemoryInput, "provenance" | "status"> }): MemoryRecord | undefined {
    const decision = evaluateMemoryWrite(input.policy);
    if (!decision.allowed || !decision.provenance || !decision.status) return undefined;
    return this.store.create({ ...input.memory, provenance: decision.provenance, status: decision.status });
  }
}
