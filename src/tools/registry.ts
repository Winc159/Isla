import type { ToolDefinition } from "../core/types.js";
import type { Tool, ToolCapability } from "./types.js";

export class ToolRegistry {
  private readonly toolsByName = new Map<string, Tool>();

  register(tool: Tool): void {
    const name = tool.definition.name;
    if (this.toolsByName.has(name)) throw new Error(`Duplicate tool name: ${name}`);
    this.toolsByName.set(name, tool);
  }

  registerCapability(capability: ToolCapability): void {
    for (const tool of capability.tools) this.register(tool);
  }

  get(name: string): Tool | undefined { return this.toolsByName.get(name); }

  definitions(): readonly ToolDefinition[] {
    return [...this.toolsByName.values()].map(tool => tool.definition);
  }
}
