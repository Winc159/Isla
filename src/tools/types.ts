import type { ToolDefinition } from "../core/types.js";

export interface Tool {
  readonly definition: ToolDefinition;
  execute(argumentsJson: string): Promise<string>;
}

export interface ToolCapability {
  readonly id: string;
  readonly instructions: string;
  readonly tools: readonly Tool[];
}
