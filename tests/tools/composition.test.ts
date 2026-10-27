import { describe, expect, it } from "vitest";
import { createToolCapabilities } from "../../src/tools/composition.js";
import { DependencyManager } from '../../src/dependencies/manager.js';

describe("tool capability composition", () => {
  it("always includes project files and omits disabled optional capabilities", () => {
    const capabilities = createToolCapabilities({ workspaceRoot: process.cwd() });

    expect(capabilities.map(capability => capability.id)).toEqual(["control", "project-files", "project-discovery", "command-execution", "task-state"]);
    expect(capabilities[1]?.tools.map(tool => tool.definition.name)).toEqual([
      "list_directory",
      "read_text_file",
      "search_project",
      "edit_text_file",
      "write_text_file",
    ]);
    expect(capabilities[2]?.tools.map(tool => tool.definition.name)).toEqual(["glob_project", "grep_project"]);
  });

  it("adds enabled web tools through the same composition entry", () => {
    const capabilities = createToolCapabilities({
      workspaceRoot: process.cwd(),
      webSearch: {
        enabled: true,
        provider: "deepseek-official",
        apiKey: "test-only-key",
        model: "search-model",
        maxResults: 8,
        timeoutMs: 30_000,
        maxOutputChars: 12_000,
      },
    });

    expect(capabilities.map(capability => capability.id)).toEqual(["control", "project-files", "project-discovery", "command-execution", "task-state", "web"]);
    expect(capabilities[5]?.tools.map(tool => tool.definition.name)).toEqual(["web_search"]);
  });

  it("adds user interaction only when an input adapter is available", () => {
    const capabilities = createToolCapabilities({ workspaceRoot: process.cwd(), userQuestionService: { ask: async () => ({ answers: [] }) } });

    expect(capabilities.map(capability => capability.id)).toEqual(["control", "project-files", "project-discovery", "command-execution", "task-state", "user-interaction"]);
    expect(capabilities[5]?.tools.map(tool => tool.definition.name)).toEqual(["ask_user_question"]);
  });

  it('exposes generic managed dependency operations only when a manager is supplied', () => {
    const manager = new DependencyManager({ manifests: [], root: 'D:/isla-test-toolchains' });
    const capabilities = createToolCapabilities({ workspaceRoot: process.cwd(), dependencyManager: manager });
    const dependency = capabilities.find(item => item.id === 'managed-dependencies');
    expect(dependency?.tools.map(tool => tool.definition.name)).toEqual(['dependency_catalog', 'dependency_list', 'dependency_install', 'dependency_uninstall']);
    expect(dependency?.tools.find(tool => tool.definition.name === 'dependency_install')?.permission).toEqual([{ kind: 'dependency-install' }, { kind: 'network-download' }]);
  });

  it("exposes Host settlement controls and ignores model terminal fields", async () => {
    const control = createToolCapabilities({ workspaceRoot: process.cwd() }).find(item => item.id === 'control')!;
    const submit = control.tools.find(item => item.definition.name === 'submit_result')!;
    await expect(submit.execute(JSON.stringify({ text: '完成', status: 'completed' }))).resolves.toMatchObject({ details: { proposal: { kind: 'submit', text: '完成' } } });
    await expect(submit.execute(JSON.stringify({ text: '完成' }))).resolves.toMatchObject({ details: { type: 'settlement_proposal', proposal: { kind: 'submit', text: '完成' } } });
    const replan = control.tools.find(item => item.definition.name === 'propose_replan')!;
    await expect(replan.execute(JSON.stringify({ strategyRevision: 1, summary: '换用测试入口', nextStep: '读取测试脚本' }))).resolves.toMatchObject({ details: { type: 'replan_proposal', strategyRevision: 1 } });
  });
});
