import type { IntentResult } from "./intent.js";

export interface TurnSummary {
  readonly turn: number;
  readonly category: string;
  readonly summary: string;
  readonly decisions: readonly string[];
  readonly pending: readonly string[];
  readonly evidence: readonly string[];
  readonly outcome: "completed" | "needs_user" | "blocked";
}

export interface ContextSelection {
  readonly recentTurns: number;
  readonly summaryTurns: readonly number[];
  readonly reason: string;
}

export class ContextResolver {
  constructor(private readonly maxSummaryTurns = 3) {}

  select(intent: Pick<IntentResult, "needsHistory" | "goal">, summaries: readonly TurnSummary[]): ContextSelection {
    if (!intent.needsHistory || summaries.length === 0) return { recentTurns: 2, summaryTurns: [], reason: "历史不是当前意图所必需" };
    const terms = tokenize(intent.goal);
    const ranked = summaries
      .map(summary => ({ summary, score: scoreSummary(summary, terms) }))
      .sort((left, right) => right.score - left.score || right.summary.turn - left.summary.turn)
      .filter(item => item.score > 0)
      .slice(0, this.maxSummaryTurns)
      .map(item => item.summary.turn);
    return {
      recentTurns: 2,
      summaryTurns: ranked,
      reason: ranked.length ? "根据当前目标选择相关摘要" : "未找到相关摘要，使用最近对话",
    };
  }
}

function tokenize(text: string): readonly string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
}

function scoreSummary(summary: TurnSummary, terms: readonly string[]): number {
  const text = [summary.category, summary.summary, ...summary.decisions, ...summary.pending].join(" ").toLowerCase();
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}
