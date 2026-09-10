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
  readonly requiredEvidence?: readonly string[];
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
          "返回字段：kind、goal、needsHistory、needsTools、requiresUserConfirmation、missingInformation、requiredEvidence。",
          `用户输入：${input}`,
        ].join("\n") },
      ], this.options.capabilities ?? [], "intent"),
    };
    try {
      const response = await this.provider.generate(request);
      return normalizeIntent(parseIntent(response.text), input);
    } catch {
      return fallbackIntent(input);
    }
  }
}

function normalizeIntent(result: IntentResult, input: string): IntentResult {
  if (result.kind !== "unknown") return result;
  const fallback = fallbackIntent(input);
  return fallback.kind === "unknown" ? result : fallback;
}

function fallbackIntent(input: string): IntentResult {
  const goal = input.trim();
  if (/(删除|删掉|清空|覆盖|替换全部|执行命令|运行脚本|发布|部署|提交代码|推送代码|修改文件|写入文件|创建文件)/u.test(goal)) {
    return { kind: "execute", goal, needsHistory: false, needsTools: true, requiresUserConfirmation: true, missingInformation: [] };
  }
  if (/(查看|检查|读取|列出|搜索|查找|了解一下|看看).*(项目|文件|目录|文件夹|源码|代码|能力|当前)/u.test(goal)) {
    return { kind: "inspect", goal, needsHistory: false, needsTools: true, requiresUserConfirmation: false, missingInformation: [] };
  }
  if (/(讨论|分析|比较|设计|方案|如何修改|怎么改|建议)/u.test(goal)) {
    return { kind: "discuss", goal, needsHistory: true, needsTools: false, requiresUserConfirmation: false, missingInformation: [] };
  }
  if (/(随便|帮我处理一下|弄一下|搞定它|处理这个|改一下)/u.test(goal)) {
    return { kind: "unknown", goal, needsHistory: false, needsTools: false, requiresUserConfirmation: false, missingInformation: ["需要明确是查看、讨论还是执行"] };
  }
  return { kind: "answer", goal, needsHistory: true, needsTools: false, requiresUserConfirmation: false, missingInformation: [] };
}

function parseIntent(text: string): IntentResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Intent response is not JSON");
  const value = JSON.parse(match[0]) as Partial<IntentResult>;
  if (!["answer", "inspect", "discuss", "execute", "unknown"].includes(value.kind ?? "")) throw new Error("Invalid intent kind");
  if (typeof value.goal !== "string" || typeof value.needsHistory !== "boolean" || typeof value.needsTools !== "boolean" || typeof value.requiresUserConfirmation !== "boolean" || !Array.isArray(value.missingInformation) || !value.missingInformation.every(item => typeof item === "string")) throw new Error("Invalid intent result");
  return value as IntentResult;
}
