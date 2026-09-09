import type { ToolCapability } from "../tools/types.js";

export function composeCapabilityPrompt(capabilities: readonly ToolCapability[]): string | undefined {
  if (!capabilities.length) return undefined;
  return capabilities.map(capability => `能力 ${capability.id}:\n${capability.instructions}`).join("\n\n");
}
