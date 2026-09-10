import { describe, expect, it } from "vitest";
import { PromptRegistry } from "../../src/prompts/registry.js";
import { ToolRegistry } from "../../src/tools/registry.js";

describe("PromptRegistry", () => {
  it("renders sections in stable order and skips empty sections", () => {
    const registry = new PromptRegistry();
    registry.register({ id: "later", order: 10, render: () => "later" });
    registry.register({ id: "empty", order: 0, render: () => " " });
    registry.register({ id: "first", order: 0, render: () => "first" });
    expect(registry.render({ capabilities: [] })).toEqual(["first", "later"]);
  });

  it("rejects duplicate section IDs", () => {
    const registry = new PromptRegistry();
    registry.register({ id: "same", order: 0, render: () => "one" });
    expect(() => registry.register({ id: "same", order: 1, render: () => "two" })).toThrow();
  });

  it("filters sections by phase without changing legacy sections", () => {
    const registry = new PromptRegistry();
    registry.register({ id: "personality", order: 0, phases: ["discussion"], render: () => "personality" });
    registry.register({ id: "tools", order: 1, phases: ["tool-loop"], render: () => "tools" });
    registry.register({ id: "legacy", order: 2, render: () => "legacy" });
    expect(registry.render({ capabilities: [], phase: "discussion" })).toEqual(["personality", "legacy"]);
    expect(registry.render({ capabilities: [], phase: "tool-loop" })).toEqual(["tools", "legacy"]);
  });
});

describe("ToolRegistry", () => {
  const tool = (name: string) => ({
    definition: { name, description: name, parameters: {} },
    execute: async () => name,
  });

  it("registers, finds and exports tools", () => {
    const registry = new ToolRegistry();
    registry.register(tool("one"));
    expect(registry.get("one")).toBeTruthy();
    expect(registry.definitions().map(definition => definition.name)).toEqual(["one"]);
  });

  it("rejects duplicate tool names", () => {
    const registry = new ToolRegistry();
    registry.register(tool("same"));
    expect(() => registry.register(tool("same"))).toThrow();
  });
});
