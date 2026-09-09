import type { Message } from "../core/types.js";
import { DEFAULT_PERSONALITY_PROMPT, RUNTIME_POLICY_PROMPT } from "./base.js";
import { PromptRegistry } from "./registry.js";
import type { ToolCapability } from "../tools/types.js";

export function composeRequestMessages(history: readonly Message[], capabilities: readonly ToolCapability[]): Message[] {
  if (!capabilities.length) return [...history];
  const registry = createDefaultPromptRegistry();
  return registry.compose(history, {
    capabilities: capabilities.map(capability => ({ id: capability.id, instructions: capability.instructions })),
  });
}

export function createDefaultPromptRegistry(): PromptRegistry {
  const registry = new PromptRegistry();
  registry.register({ id: "identity", order: -1000, render: () => DEFAULT_PERSONALITY_PROMPT });
  registry.register({ id: "runtime-policy", order: 500, render: () => RUNTIME_POLICY_PROMPT });
  registry.register({
    id: "capabilities",
    order: 1000,
    render: context => context.capabilities.length
      ? context.capabilities.map(capability => `能力 ${capability.id}:\n${capability.instructions}`).join("\n\n")
      : undefined,
  });
  return registry;
}
