import type { IntentResult } from "./intent.js";

export type CompletionDecision =
  | { readonly complete: true }
  | { readonly complete: false; readonly reason: string };

export class CompletionChecker {
  check(intent: Pick<IntentResult, "kind" | "requiredEvidence">, evidence: readonly string[], writeSucceeded = false): CompletionDecision {
    if (intent.kind === "answer" || intent.kind === "discuss") return { complete: true };
    if (intent.kind === "inspect") {
      if (evidence.length === 0) return { complete: false, reason: "尚未获得相关文件或目录的成功读取结果。" };
      const missing = (intent.requiredEvidence ?? []).filter(item => !evidenceSatisfies(item, evidence));
      if (missing.length > 0) return { complete: false, reason: `缺少必要证据：${missing.join("、")}` };
      return { complete: true };
    }
    if (intent.kind === "execute") return writeSucceeded ? { complete: true } : { complete: false, reason: "尚未获得目标写入成功结果。" };
    return { complete: false, reason: "意图未确定。" };
  }
}

function evidenceSatisfies(requirement: string, evidence: readonly string[]): boolean {
  if (evidence.includes(requirement)) return true;
  const value = requirement.toLowerCase();
  if (/(目录|文件夹|directory|folder|listing|list)/u.test(value)) return evidence.includes("list_directory");
  if (/(文件内容|源码|文本|文件|内容|file|source|text|content|read)/u.test(value)) return evidence.includes("read_text_file");
  return false;
}
