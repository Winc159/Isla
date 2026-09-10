import type { ModelProvider, ModelRequest } from "./types.js";
import { composeRequestMessages } from "../prompts/compose.js";

export type IntentKind = "answer" | "inspect" | "discuss" | "execute" | "unknown";

export interface IntentResult {
  readonly kind: IntentKind;
  readonly goal: string;
  readonly needsHistory: boolean;
  readonly needsTools: boolean;
  readonly requiresUserConfirmation: boolean;
  readonly missingInformation: readonly string[];
}

export interface IntentClassifierOptions {
  readonly systemPrompt?: string;
  readonly capabilities?: Parameters<typeof composeRequestMessages>[1];
}

export class IntentClassifier {
  constructor(private readonly provider: ModelProvider, private readonly options: IntentClassifierOptions = {}) {}

  async classify(input: string): Promise<IntentResult> {
    const request: ModelRequest = {
      messages: composeRequestMessages([
        { role: "system", content: "你是 Isla 的意图分类器。只返回一个 JSON 对象，不要 Markdown，不要解释。" },
        { role: "user", content: [
          "判断下面的用户输入属于 answer、inspect、discuss、execute 或 unknown。",
          "讨论如何做不等于要求执行；只有明确要求改变外部状态才是 execute。",
          "返回字段：kind、goal、needsHistory、needsTools、requiresUserConfirmation、missingInformation。",
          `用户输入：${input}`,
        ].join("\n") },
      ], this.options.capabilities ?? [], "intent"),
    };
    try {
      const response = await this.provider.generate(request);
      return parseIntent(response.text);
    } catch {
      return { kind: "unknown", goal: input, needsHistory: false, needsTools: false, requiresUserConfirmation: true, missingInformation: [] };
    }
  }
}

function parseIntent(text: string): IntentResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Intent response is not JSON");
  const value = JSON.parse(match[0]) as Partial<IntentResult>;
  if (!["answer", "inspect", "discuss", "execute", "unknown"].includes(value.kind ?? "")) throw new Error("Invalid intent kind");
  if (typeof value.goal !== "string" || typeof value.needsHistory !== "boolean" || typeof value.needsTools !== "boolean" || typeof value.requiresUserConfirmation !== "boolean" || !Array.isArray(value.missingInformation) || !value.missingInformation.every(item => typeof item === "string")) throw new Error("Invalid intent result");
  return value as IntentResult;
}

