import { describe, expect, it } from "vitest";
import { ContextResolver, type TurnSummary } from "../../src/core/context.js";

const summaries: TurnSummary[] = [
  { turn: 1, category: "runtime", summary: "讨论 Tool Loop 完成判定", decisions: ["保留 8 轮上限"], pending: [] },
  { turn: 2, category: "ui", summary: "讨论 CLI 输入", decisions: [], pending: [] },
];

describe("ContextResolver", () => {
  it("does not select summaries when history is unnecessary", () => {
    expect(new ContextResolver().select({ needsHistory: false, goal: "查看项目" }, summaries).summaryTurns).toEqual([]);
  });

  it("selects relevant summaries by goal", () => {
    expect(new ContextResolver().select({ needsHistory: true, goal: "之前 Tool Loop 的完成判定" }, summaries).summaryTurns).toEqual([1]);
  });

  it("falls back to recent turns when no summary matches", () => {
    const result = new ContextResolver().select({ needsHistory: true, goal: "讨论数据库" }, summaries);
    expect(result.summaryTurns).toEqual([]);
    expect(result.recentTurns).toBe(2);
  });
});

