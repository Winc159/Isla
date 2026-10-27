import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../../src/tools/registry.js";
import { ToolRuntime } from "../../src/tools/runtime.js";
import { sandboxDenied } from "../../src/tools/errors.js";

describe("ToolRuntime", () => {
  it('enforces read-only plan/review modes at runtime', async () => {
    const registry = new ToolRegistry(); let writes = 0;
    registry.register({ definition:{name:'write_text_file',description:'',parameters:{}}, execute:async()=>{writes++;return 'ok';} });
    const runtime = new ToolRuntime(registry, { mode:()=> 'plan' });
    await expect(runtime.execute({id:'1',name:'write_text_file',arguments:'{}'})).resolves.toMatchObject({ok:false,code:'PERMISSION_DENIED'});
    expect(writes).toBe(0);
  });
  it('allows read-only research during Plan and only verification commands during Review', async()=>{
    const registry=new ToolRegistry();let ran=0;
    registry.register({definition:{name:'web_search',description:'',parameters:{}},execute:async()=>{ran++;return 'ok';}});
    const plan=new ToolRuntime(registry,{mode:()=> 'plan'});
    await expect(plan.execute({id:'1',name:'web_search',arguments:'{}'})).resolves.toMatchObject({ok:true});
    const commandRegistry=new ToolRegistry();commandRegistry.register({definition:{name:'run_command',description:'',parameters:{}},execute:async()=>{ran++;return 'ok';}});
    const review=new ToolRuntime(commandRegistry,{mode:()=> 'review'});
    await expect(review.execute({id:'2',name:'run_command',arguments:JSON.stringify({purpose:'other'})})).resolves.toMatchObject({ok:false,code:'PERMISSION_DENIED'});
    expect(ran).toBe(1);
  });

  it('requires the current approved plan revision for Act tools', async () => {
    const registry=new ToolRegistry();let ran=0;
    registry.register({definition:{name:'write_text_file',description:'',parameters:{}},execute:async()=>{ran++;return 'ok';}});
    const plan={version:1 as const,planId:'p',revision:2,goal:'g',constraints:[],assumptions:[],steps:[{id:'s',title:'step',status:'pending' as const,dependencies:[]}],risks:[],verification:['test'],openQuestions:[],status:'active' as const,updatedAt:new Date().toISOString(),approvedRevision:1};
    const runtime=new ToolRuntime(registry,{mode:()=> 'act',plan:()=>plan,actApproved:()=>false});
    await expect(runtime.execute({id:'1',name:'write_text_file',arguments:'{}'})).resolves.toMatchObject({ok:false,code:'PERMISSION_DENIED'});
    expect(ran).toBe(0);
  });

  it("normalizes success and unknown tools", async () => {
    const registry = new ToolRegistry();
    registry.register({ definition: { name: "echo", description: "", parameters: {} }, execute: async () => "ok" });
    const runtime = new ToolRuntime(registry);
    await expect(runtime.execute({ id: "1", name: "echo", arguments: "{}" })).resolves.toEqual({ ok: true, content: "ok" });
    await expect(runtime.execute({ id: "2", name: "missing", arguments: "{}" })).resolves.toMatchObject({ ok: false, code: "UNKNOWN_TOOL" });
  });

  it("preserves structured success details", async () => {
    const registry = new ToolRegistry();
    registry.register({ definition: { name: "structured", description: "", parameters: {} }, execute: async () => ({ content: "reference", details: { type: "project_search", sources: [{ id: `project:v1:${"a".repeat(64)}`, path: "docs/a.md", startLine: 2, endLine: 3 }], filesScanned: 1, truncated: false } }) });
    await expect(new ToolRuntime(registry).execute({ id: "1", name: "structured", arguments: "{}" })).resolves.toMatchObject({ ok: true, content: "reference", details: { type: "project_search", filesScanned: 1 } });
  });

  it("normalizes execution failures", async () => {
    const registry = new ToolRegistry();
    registry.register({ definition: { name: "bad", description: "", parameters: {} }, execute: async () => { throw new Error("disk unavailable"); } });
    await expect(new ToolRuntime(registry).execute({ id: "1", name: "bad", arguments: "{}" })).resolves.toEqual({ ok: false, code: "EXECUTION_FAILED", message: "disk unavailable" });
  });

  it("preserves sandbox denial as a structured error", async () => {
    const registry = new ToolRegistry();
    registry.register({ definition: { name: "read", description: "", parameters: {} }, execute: async () => { throw sandboxDenied("outside root"); } });
    await expect(new ToolRuntime(registry).execute({ id: "1", name: "read", arguments: "{}" })).resolves.toEqual({ ok: false, code: "SANDBOX_DENIED", message: "outside root" });
  });

  it("applies approval policy before execution", async () => {
    const registry = new ToolRegistry();
    let executed = false;
    registry.register({ definition: { name: "write", description: "", parameters: {} }, permission: { kind: "filesystem-write" }, execute: async () => { executed = true; return "written"; } });
    const runtime = new ToolRuntime(registry, { approvalPolicy: "ask", approvalService: { request: async () => ({ approved: false, reason: "no" }) }, permissionPreset: "workspace" });
    await expect(runtime.execute({ id: "1", name: "write", arguments: "{}" })).resolves.toMatchObject({ ok: false, code: "USER_REJECTED" });
    expect(executed).toBe(false);
  });

  it("validates and describes an action before requesting approval", async () => {
    const registry = new ToolRegistry();
    let summary = "";
    registry.register({
      definition: { name: "write", description: "", parameters: {} },
      permission: { kind: "filesystem-write" },
      describe: async () => "覆盖 notes.txt；3 个字符；内容预览：new",
      execute: async () => "written",
    });
    const runtime = new ToolRuntime(registry, {
      approvalPolicy: "ask",
      permissionPreset: "workspace",
      approvalService: { request: async request => { summary = request.summary; return { approved: false }; } },
    });
    await runtime.execute({ id: "1", name: "write", arguments: "{}" });
    expect(summary).toContain("覆盖 notes.txt");
  });

  it("allows reads without approval in workspace preset", async () => {
    const registry = new ToolRegistry();
    registry.register({ definition: { name: "read", description: "", parameters: {} }, permission: { kind: "filesystem-read" }, execute: async () => "read" });
    await expect(new ToolRuntime(registry, { approvalPolicy: "ask", permissionPreset: "workspace" }).execute({ id: "1", name: "read", arguments: "{}" })).resolves.toEqual({ ok: true, content: "read" });
  });

  it("fails closed when the execution signal is already aborted", async () => {
    const registry = new ToolRegistry();
    let executed = false;
    registry.register({ definition: { name: "write", description: "", parameters: {} }, execute: async () => { executed = true; return "written"; } });
    const controller = new AbortController();
    controller.abort();
    await expect(new ToolRuntime(registry).execute({ id: "1", name: "write", arguments: "{}" }, { signal: controller.signal })).resolves.toEqual({ ok: false, code: "TURN_CANCELLED", message: "当前回合已取消。" });
    expect(executed).toBe(false);
  });

  it("enforces matching persistent rules before execution", async () => {
    const registry = new ToolRegistry(); let executions = 0; let approvals = 0;
    registry.register({ definition: { name: "run_command", description: "", parameters: {} }, permission: { kind: "command-execute" }, execute: async () => { executions += 1; return "ok"; } });
    const runtime = new ToolRuntime(registry, { workspace: "C:/work", approvalPolicy: "never", policyRules: [{ id: "test-rule", effect: "allow", tool: "run_command", permission: "command-execute", workspace: "c:\\WORK", commandPrefix: ["node", "test.mjs"] }], approvalService: { request: async () => { approvals += 1; return { approved: false }; } } });
    await expect(runtime.execute({ id: "1", name: "run_command", arguments: JSON.stringify({ executable: "node", argv: ["test.mjs"] }) })).resolves.toMatchObject({ ok: true });
    await expect(runtime.execute({ id: "2", name: "run_command", arguments: JSON.stringify({ executable: "node", argv: ["deploy.mjs"] }) })).resolves.toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(executions).toBe(1); expect(approvals).toBe(0);
  });

  it("applies argv-scoped policy to managed process start", async () => {
    const registry = new ToolRegistry(); let executions = 0;
    registry.register({ definition: { name: 'exec_start', description: '', parameters: {} }, permission: { kind: 'command-execute' }, execute: async () => { executions += 1; return 'ok'; } });
    const runtime = new ToolRuntime(registry, { workspace: 'C:/work', approvalPolicy: 'never', policyRules: [{ id: 'allow-version', effect: 'allow', tool: 'exec_start', permission: 'command-execute', workspace: 'c:\\work', commandPrefix: ['node', '--version'] }] });
    await expect(runtime.execute({ id: '1', name: 'exec_start', arguments: JSON.stringify({ executable: 'node', argv: ['--version'] }) })).resolves.toMatchObject({ ok: true });
    await expect(runtime.execute({ id: '2', name: 'exec_start', arguments: JSON.stringify({ executable: 'node', argv: ['install.mjs'] }) })).resolves.toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(executions).toBe(1);
  });

  it('applies hostname-scoped persistent approvals to network tools', async () => {
    const registry = new ToolRegistry(); let executions = 0;
    registry.register({ definition: { name: 'web_fetch', description: '', parameters: {} }, permission: { kind: 'network' }, policyContext: () => ({ networkHost: 'docs.example.com' }), execute: async () => { executions += 1; return 'ok'; } });
    const runtime = new ToolRuntime(registry, { approvalPolicy: 'never', policyRules: [{ id: 'docs-only', effect: 'allow', permission: 'network', tool: 'web_fetch', networkHost: 'docs.example.com' }] });
    await expect(runtime.execute({ id: '1', name: 'web_fetch', arguments: '{}' })).resolves.toMatchObject({ ok: true });
    expect(executions).toBe(1);
  });

  it('requires each permission for a managed download before executing it', async () => {
    const registry = new ToolRegistry();
    const requests: string[] = [];
    let executed = false;
    registry.register({
      definition: { name: 'dependency_install', description: '', parameters: {} },
      permission: [{ kind: 'dependency-install' }, { kind: 'network-download' }],
      policyContext: () => ({ networkHost: 'artifacts.example.com' }),
      execute: async () => { executed = true; return 'installed'; },
    });
    const runtime = new ToolRuntime(registry, {
      workspace: 'C:/work', approvalPolicy: 'ask',
      approvalService: { request: async request => { requests.push(request.permission.kind); return { approved: request.permission.kind !== 'network-download' }; } },
    });
    await expect(runtime.execute({ id: '1', name: 'dependency_install', arguments: '{}' })).resolves.toMatchObject({ ok: false, code: 'USER_REJECTED' });
    expect(requests).toEqual(['dependency-install', 'network-download']);
    expect(executed).toBe(false);
  });

  it("maps a signal aborted during tool execution to cancellation", async () => {
    const registry = new ToolRegistry();
    const controller = new AbortController();
    registry.register({ definition: { name: "slow", description: "", parameters: {} }, execute: async (_args, options) => { await new Promise(resolve => setTimeout(resolve, 5)); controller.abort(); await new Promise(resolve => setTimeout(resolve, 1)); return "late"; } });
    await expect(new ToolRuntime(registry).execute({ id: "1", name: "slow", arguments: "{}" }, { signal: controller.signal })).resolves.toMatchObject({ ok: false, code: "TURN_CANCELLED" });
  });
});
