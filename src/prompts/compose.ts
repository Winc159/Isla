import type { Message } from "../core/types.js";
import type { ToolCapability } from "../tools/types.js";
import { DEFAULT_PERSONALITY_PROMPT, RUNTIME_POLICY_PROMPT } from "./base.js";
import { composeCapabilityPrompt } from "./capabilities.js";

export function composeRequestMessages(history: readonly Message[], capabilities: readonly ToolCapability[]): Message[] {
  if (!capabilities.length) return [...history];
  const existingSystem = history.filter(message => message.role === "system");
  const conversation = history.filter(message => message.role !== "system");
  const capabilityPrompt = composeCapabilityPrompt(capabilities);
  return [
    { role: "system", content: DEFAULT_PERSONALITY_PROMPT },
    ...existingSystem,
    { role: "system", content: RUNTIME_POLICY_PROMPT },
    ...(capabilityPrompt ? [{ role: "system" as const, content: capabilityPrompt }] : []),
    ...conversation,
  ];
}
