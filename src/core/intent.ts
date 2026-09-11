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
    const request = this.createRequest(input);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.provider.generate(attempt === 0 ? request : {
          ...request,
          messages: [...request.messages, { role: "user", content: "上一个结果无效。只返回符合字段和类型要求的单个 JSON 对象。" }],
        });
        return normalizeIntent(parseIntent(response.text), input);
      } catch {
        // One bounded retry is intentional; fallback below is deterministic.
      }
    }
    return fallbackIntent(input);
  }

  private createRequest(input: string): ModelRequest {
    return {
      messages: composeRequestMessages([
        { role: "system", content: "你是 Isla 的意图分类器。只返回一个 JSON 对象，不要 Markdown，不要解释。" },
        { role: "user", content: [
          "判断下面的用户输入属于 answer、inspect、discuss、execute 或 unknown。",
          "问候、自我介绍、询问你是谁、能做什么或能力边界属于 answer；不要因为上下文中存在 Tool 能力就改判为 inspect。",
          "只有用户明确要求读取、查看、检查、列出或搜索项目/文件/目录等外部证据时才是 inspect。",
          "讨论如何做不等于要求执行；只要主要语义是讨论、分析、比较、设计或建议，就优先归类为 discuss，即使文本包含删除、修改等例子。只有明确要求现在改变外部状态才是 execute。",
          "answer、discuss、unknown 必须 needsTools=false 且 requiresUserConfirmation=false；inspect 必须 needsTools=true 且 requiresUserConfirmation=false；unknown 必须不调用 Tool。",
          "返回字段：kind、goal、needsHistory、needsTools、requiresUserConfirmation、missingInformation、requiredEvidence。requiredEvidence 必须是字符串数组；没有证据要求时返回空数组。",
          `用户输入：${input}`,
        ].join("\n") },
      ], this.options.capabilities ?? [], "intent"),
    };
  }
}

function normalizeIntent(result: IntentResult, input: string): IntentResult {
  const fallback = fallbackIntent(input);
  if (fallback.kind === "discuss" && result.kind === "execute") return fallback;
  if (fallback.kind === "execute" && result.kind !== "execute") return fallback;
  if (result.kind === "inspect" && isCapabilityQuestion(input)) return fallbackIntent(input);
  if (result.kind === "unknown") return fallback.kind === "unknown" ? normalizeFields(result) : fallback;
  return normalizeFields(result);
}

function normalizeFields(result: IntentResult): IntentResult {
  if (result.kind === "unknown" || result.kind === "answer" || result.kind === "discuss") {
    return { ...result, needsTools: false, requiresUserConfirmation: false, requiredEvidence: [] };
  }
  if (result.kind === "inspect") {
    return { ...result, needsTools: true, requiresUserConfirmation: false, requiredEvidence: result.requiredEvidence ?? [] };
  }
  return { ...result, needsTools: true, requiresUserConfirmation: true, requiredEvidence: result.requiredEvidence ?? [] };
}

function isCapabilityQuestion(input: string): boolean {
  const goal = input.trim();
  return /(?:你是谁|你能做什么|你的能力|能力边界|能帮我做什么|what are you|who are you|what can you do|your capabilities|capability boundary)/iu.test(goal)
    && !/(?:读取|查看|检查|列出|搜索|查找|read|inspect|list|search)\s*(?:项目|文件|目录|源码|代码|project|file|directory|source|code)?/iu.test(goal);
}

function fallbackIntent(input: string): IntentResult {
  const goal = input.trim();
  if (/(讨论|分析|比较|设计|方案|建议|debate|analy[sz]e|compare|design|plan|advise|discuss)/iu.test(goal)) {
    return { kind: "discuss", goal, needsHistory: true, needsTools: false, requiresUserConfirmation: false, missingInformation: [], requiredEvidence: [] };
  }
  if (/(删除|删掉|清空|覆盖|替换全部|执行命令|运行脚本|发布|部署|提交代码|推送代码|修改文件|写入文件|创建文件|write_text_file)/iu.test(goal)
    || /(?:创建|新建).*(?:文件|[\w.-]+\.(?:txt|md|json|ya?ml|ts|tsx|js|jsx))/iu.test(goal)) {
    return { kind: "execute", goal, needsHistory: false, needsTools: true, requiresUserConfirmation: true, missingInformation: [] };
  }
  if (/(查看|检查|读取|列出|搜索|查找|了解一下|看看).*(项目|文件|目录|文件夹|源码|代码|能力|当前)/u.test(goal)) {
    const requiredEvidence = /(目录|文件夹|list|directory|folder)/iu.test(goal)
      ? ["目录列表"]
      : /(文件|源码|代码|file|source|code)/iu.test(goal)
        ? ["文件内容"]
        : [];
    return { kind: "inspect", goal, needsHistory: false, needsTools: true, requiresUserConfirmation: false, missingInformation: [], requiredEvidence };
  }
  if (/(随便|帮我处理一下|弄一下|搞定它|处理这个|改一下)/u.test(goal)) {
    return { kind: "unknown", goal, needsHistory: false, needsTools: false, requiresUserConfirmation: false, missingInformation: ["需要明确是查看、讨论还是执行"] };
  }
  return { kind: "answer", goal, needsHistory: true, needsTools: false, requiresUserConfirmation: false, missingInformation: [] };
}

function parseIntent(text: string): IntentResult {
  const value = JSON.parse(text.trim()) as Partial<IntentResult>;
  if (!["answer", "inspect", "discuss", "execute", "unknown"].includes(value.kind ?? "")) throw new Error("Invalid intent kind");
  if (typeof value.goal !== "string" || typeof value.needsHistory !== "boolean" || typeof value.needsTools !== "boolean" || typeof value.requiresUserConfirmation !== "boolean" || !Array.isArray(value.missingInformation) || !value.missingInformation.every(item => typeof item === "string") || (value.requiredEvidence !== undefined && (!Array.isArray(value.requiredEvidence) || !value.requiredEvidence.every(item => typeof item === "string")))) throw new Error("Invalid intent result");
  return value as IntentResult;
}
