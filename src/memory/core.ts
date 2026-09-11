import type { CoreMemoryBlock, CoreMemoryBlockName } from "./types.js";
import type { MemoryStore } from "./store.js";
export const DEFAULT_CORE_MEMORY_BUDGETS: Readonly<Record<CoreMemoryBlockName, number>> = { persona: 2_000, user: 4_000, workspace: 6_000 };
export class CoreMemory {
  constructor(private readonly store: MemoryStore, private readonly budgets = DEFAULT_CORE_MEMORY_BUDGETS) {}
  initialize(defaults: Readonly<Record<CoreMemoryBlockName, string>>): void { for (const name of ["persona", "user", "workspace"] as const) if (!this.store.getBlock(name)) this.store.saveBlock(name, defaults[name], this.budgets[name]); }
  get(name: CoreMemoryBlockName): CoreMemoryBlock | undefined { return this.store.getBlock(name); }
  render(): string { return (["persona", "user", "workspace"] as const).map(name => { const block = this.get(name); return block ? `## ${name}\n${block.content}` : ""; }).filter(Boolean).join("\n\n"); }
}
