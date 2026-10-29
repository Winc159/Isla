import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatSession } from "../../src/core/session.js";
import { FakeProvider } from "../support/fake-provider.js";
import type { Message, ModelRequest, ModelResponse, ToolResponse } from "../../src/core/types.js";
import { createProjectFilesCapability } from "../../src/tools/project-files.js";
import { createCommandExecutionCapability } from "../../src/tools/command-execution.js";
import { createTaskStateCapability } from "../../src/tools/task-state.js";
import { createControlCapability } from "../../src/tools/control.js";
import type { WorkPlanV1 } from '../../src/core/work-plan.js';
import type { ToolCapability } from '../../src/tools/types.js';
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
let sessionRoot: string;
beforeEach(async () => {
  sessionRoot = await mkdtemp(join(tmpdir(), "isla-session-test-"));
  await writeFile(join(sessionRoot, "README.md"), "# fixture\n", "utf8");
});
afterEach(async () => { await rm(sessionRoot, { recursive: true, force: true }); });
describe("session", () => {
  it('persists evidence-backed progress without invalidating Act approval', async () => {
    const plan: WorkPlanV1 = { version:1,planId:'progress-plan',revision:1,progressRevision:0,replanCount:0,goal:'Fix and verify',constraints:[],assumptions:[],steps:[{id:'inspect',title:'Inspect',kind:'inspect',status:'pending',dependencies:[]},{id:'change',title:'Change',kind:'change',status:'pending',dependencies:['inspect']},{id:'verify',title:'Verify',kind:'verify',status:'pending',dependencies:['change']}],risks:[],verification:['tests pass'],openQuestions:[],status:'active',approvedRevision:1,updatedAt:new Date().toISOString() };
    const journal = { version:1 as const, turns:[{id:'evidence-turn',sequence:1,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),status:'completed' as const,userMessageIndex:0,assistantMessageIndex:1,attempts:[],actions:[{type:'tool' as const,step:1,callId:'inspect-call',tool:'read_text_file',ok:true},{type:'workspace_mutation' as const,step:2,callId:'change-call',tool:'edit_text_file' as const},{type:'tool' as const,step:2,callId:'change-call',tool:'edit_text_file',ok:true},{type:'verification' as const,step:3,callId:'verify-call',outcome:'passed' as const},{type:'tool' as const,step:3,callId:'verify-call',tool:'run_command',ok:true}]}] };
    const persisted: Array<{workPlan?:WorkPlanV1}> = [];
    const session = new ChatSession(new FakeProvider([]),{workPlan:plan,workMode:{version:1,mode:'act',revision:1,actApprovedRevision:1,updatedAt:new Date().toISOString()},journal,messages:[{role:'user',content:'task'},{role:'assistant',content:'started'}],onSessionStateChanged:async state=>{persisted.push(state);}});
    const saveProgress = async (steps: WorkPlanV1['steps'], status: WorkPlanV1['status']='active') => session.updateWorkPlan({...session.currentWorkPlan!,steps,status},1);
    await saveProgress([{...plan.steps[0]!,status:'in_progress'},plan.steps[1]!,plan.steps[2]!]);
    await saveProgress([{...plan.steps[0]!,status:'completed',evidenceCallIds:['inspect-call']},plan.steps[1]!,plan.steps[2]!]);
    await saveProgress([session.currentWorkPlan!.steps[0]!,{...plan.steps[1]!,status:'in_progress'},plan.steps[2]!]);
    await saveProgress([session.currentWorkPlan!.steps[0]!,{...plan.steps[1]!,status:'completed',evidenceCallIds:['change-call']},plan.steps[2]!]);
    await saveProgress([session.currentWorkPlan!.steps[0]!,session.currentWorkPlan!.steps[1]!,{...plan.steps[2]!,status:'in_progress'}]);
    await saveProgress([session.currentWorkPlan!.steps[0]!,session.currentWorkPlan!.steps[1]!,{...plan.steps[2]!,status:'completed',evidenceCallIds:['verify-call']}],'completed');
    expect(session.currentWorkPlan).toMatchObject({revision:1,progressRevision:6,approvedRevision:1,status:'completed',steps:[{status:'completed',evidenceCallIds:['inspect-call']},{status:'completed',evidenceCallIds:['change-call']},{status:'completed',evidenceCallIds:['verify-call']}]});
    expect(persisted.at(-1)?.workPlan).toEqual(session.currentWorkPlan);
    expect(session.currentWorkMode).toMatchObject({mode:'act',actApprovedRevision:1});
  });

  it('returns to Plan after an explicit bounded replan proposal and requires a new approval', async () => {
    class ReplanProvider extends FakeProvider {
      private calls=0;
      override async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        this.requests.push(request); this.calls++;
        if(this.calls===1)return {text:'',toolCalls:[{id:'replan-1',name:'propose_replan',arguments:JSON.stringify({strategyRevision:2,summary:'当前方法不可行',nextStep:'先检查依赖假设'})}]};
        return {text:'已记录新计划方向，等待用户重新批准。'};
      }
    }
    const plan:WorkPlanV1={version:1,planId:'replan-plan',revision:1,progressRevision:0,replanCount:0,goal:'Finish work',constraints:[],assumptions:[],steps:[{id:'step-1',title:'Implement',status:'in_progress',dependencies:[]}],risks:[],verification:['tests pass'],openQuestions:[],status:'active',approvedRevision:1,updatedAt:new Date().toISOString()};
    const session=new ChatSession(new ReplanProvider([]),{enableTools:true,capabilities:[createControlCapability()],workPlan:plan,workMode:{version:1,mode:'act',revision:1,actApprovedRevision:1,updatedAt:new Date().toISOString()}});
    await expect(session.send('继续任务')).resolves.toMatchObject({text:'已记录新计划方向，等待用户重新批准。'});
    expect(session.currentWorkMode.mode).toBe('plan');
    expect(session.currentWorkPlan).toMatchObject({revision:1,replanCount:1,status:'blocked'});
    expect(session.currentWorkPlan?.replanReason).toContain('当前方法不可行');
    expect(session.currentWorkPlan?.approvedRevision).toBeUndefined();
    expect(session.currentWorkMode.actApprovedRevision).toBeUndefined();
    await expect(session.setWorkMode('act',true)).rejects.toThrow('ACT_REQUIRES_EXPLICIT_PLAN_APPROVAL');
  });

  it('increments the structural revision and invalidates approval for a Plan-mode edit', async () => {
    const plan:WorkPlanV1={version:1,planId:'revision-plan',revision:1,progressRevision:4,replanCount:0,goal:'Old goal',constraints:[],assumptions:[],steps:[{id:'step-1',title:'Do work',status:'pending',dependencies:[]}],risks:[],verification:[],openQuestions:[],status:'active',approvedRevision:1,updatedAt:new Date().toISOString()};
    const session=new ChatSession(new FakeProvider([]),{workPlan:plan,workMode:{version:1,mode:'plan',revision:2,updatedAt:new Date().toISOString()}});
    await session.updateWorkPlan({...plan,goal:'New goal'},1);
    expect(session.currentWorkPlan).toMatchObject({revision:2,progressRevision:0,goal:'New goal'});
    expect(session.currentWorkPlan?.approvedRevision).toBeUndefined();
    expect(session.currentWorkMode.mode).toBe('plan');
  });

  it('accepts pre-completed Plan steps only when current Session evidence supports them', async () => {
    const evidenceJournal={version:1 as const,turns:[{id:'inspect-turn',sequence:1,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),status:'completed' as const,userMessageIndex:0,assistantMessageIndex:1,attempts:[],actions:[{type:'tool' as const,step:1,callId:'plan-read',tool:'read_text_file',ok:true}]}]};
    const session=new ChatSession(new FakeProvider([]),{workMode:{version:1,mode:'plan',revision:1,updatedAt:new Date().toISOString()},journal:evidenceJournal});
    const planned:WorkPlanV1={version:1,planId:'evidence-plan',revision:0,goal:'Fix and verify',constraints:[],assumptions:[],steps:[{id:'inspect',title:'Inspect',kind:'inspect',status:'completed',dependencies:[],evidenceCallIds:['plan-read']},{id:'change',title:'Change',kind:'change',status:'pending',dependencies:['inspect']},{id:'verify',title:'Verify',kind:'verify',status:'pending',dependencies:['change']}],risks:[],verification:['tests pass'],openQuestions:[],status:'active',updatedAt:new Date().toISOString()};
    await session.updateWorkPlan(planned,0);
    expect(session.currentWorkPlan?.revision).toBe(1);
    expect(session.currentWorkPlan?.steps[0]).toMatchObject({id:'inspect',status:'completed',evidenceCallIds:['plan-read']});
    const nextSession=new ChatSession(new FakeProvider([]),{workMode:{version:1,mode:'plan',revision:1,updatedAt:new Date().toISOString()}});
    await expect(nextSession.updateWorkPlan(planned,0)).rejects.toThrow('PLAN_COMPLETION_EVIDENCE_REQUIRED');
  });

  it('persists the replan cap as blocked and revokes Act after the limit', async () => {
    class ReplanProvider extends FakeProvider {
      override async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        this.requests.push(request);
        return {text:'',toolCalls:[{id:'replan-limit',name:'propose_replan',arguments:JSON.stringify({strategyRevision:2,summary:'再次失败',nextStep:'需要用户检查'})}]};
      }
    }
    const plan:WorkPlanV1={version:1,planId:'replan-cap',revision:3,progressRevision:2,replanCount:2,goal:'Finish work',constraints:[],assumptions:[],steps:[{id:'step-1',title:'Implement',status:'in_progress',dependencies:[]}],risks:[],verification:['tests pass'],openQuestions:[],status:'active',approvedRevision:3,updatedAt:new Date().toISOString()};
    const session=new ChatSession(new ReplanProvider([]),{enableTools:true,capabilities:[createControlCapability()],workPlan:plan,workMode:{version:1,mode:'act',revision:3,actApprovedRevision:3,updatedAt:new Date().toISOString()}});
    await expect(session.send('继续任务')).resolves.toMatchObject({outcome:'blocked'});
    expect(session.currentWorkMode.mode).toBe('plan');
    expect(session.currentWorkPlan).toMatchObject({status:'blocked',replanCount:2,replanReason:'再次失败'});
    expect(session.currentWorkPlan?.approvedRevision).toBeUndefined();
  });

  it("closes idempotently and rejects new turns after shutdown", async () => {
    const session = new ChatSession(new FakeProvider([{ text: "响应" }]));
    await session.close();
    await session.close();
    await expect(session.send("已关闭后仍发送")).rejects.toMatchObject({ code: "UNKNOWN", recoverable: false });
  });

  it("settles an explicit submit proposal in the Host and ignores model terminal fields", async () => {
    class SubmitProvider extends FakeProvider {
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        this.requests.push(request);
        return { text: "", toolCalls: [{ id: "submit-1", name: "submit_result", arguments: JSON.stringify({ text: "已完成", status: "completed" }) }] };
      }
    }
    const response = await new ChatSession(new SubmitProvider([]), { enableTools: true, capabilities: [createControlCapability()] }).send("完成这个问题");
    expect(response).toMatchObject({ text: "已完成", outcome: "completed" });
  });
  it('settles an Act plan from matching successful evidence even when the model omits progress updates', async () => {
    const plan: WorkPlanV1 = { version:1,planId:'evidence-settlement',revision:1,progressRevision:0,replanCount:0,goal:'Inspect, change and verify',constraints:[],assumptions:[],steps:[{id:'inspect',title:'Read source',kind:'inspect',status:'pending',dependencies:[]},{id:'change',title:'Modify source',kind:'change',status:'pending',dependencies:['inspect']},{id:'verify',title:'Run tests',kind:'verify',status:'pending',dependencies:['change']}],risks:[],verification:['Tests pass'],openQuestions:[],status:'active',approvedRevision:1,updatedAt:new Date().toISOString() };
    const tools: ToolCapability = { id:'project-files',instructions:'test tools',tools:[
      { definition:{name:'read_text_file',description:'read',parameters:{type:'object'}},execute:async()=> 'source read' },
      { definition:{name:'edit_text_file',description:'change',parameters:{type:'object'}},execute:async()=> 'source changed' },
      { definition:{name:'run_command',description:'verify',parameters:{type:'object'}},execute:async()=>({content:'5 tests passed',details:{type:'command_execution',shell:'direct',workdir:sessionRoot,exitCode:0,signal:null,timedOut:false,aborted:false,purpose:'verification',stdoutTruncated:false,stderrTruncated:false}}) },
    ]};
    const toolResponses: ToolResponse[] = [
      {text:'',toolCalls:[{id:'inspect-evidence',name:'read_text_file',arguments:'{}'}]},
      {text:'',toolCalls:[{id:'change-evidence',name:'edit_text_file',arguments:'{}'}]},
      {text:'',toolCalls:[{id:'verify-evidence',name:'run_command',arguments:'{}'}]},
      {text:'',toolCalls:[{id:'submit-evidence',name:'submit_result',arguments:JSON.stringify({text:'已验证 5 项测试全部通过。'})}]},
    ];
    const provider = new class extends FakeProvider {
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> { this.requests.push(request); return toolResponses.shift() ?? {text:'No more fake responses'}; }
    }([]);
    const session = new ChatSession(provider,{enableTools:true,capabilities:[tools,createControlCapability()],workPlan:plan,workMode:{version:1,mode:'act',revision:1,actApprovedRevision:1,updatedAt:new Date().toISOString()}});
    await expect(session.send('复核、修改并验证')).resolves.toMatchObject({text:'已验证 5 项测试全部通过。',outcome:'completed'});
    expect(session.currentWorkPlan).toMatchObject({status:'completed',progressRevision:3,steps:[{id:'inspect',status:'completed',evidenceCallIds:['inspect-evidence']},{id:'change',status:'completed',evidenceCallIds:['change-evidence']},{id:'verify',status:'completed',evidenceCallIds:['verify-evidence']} ]});
  });
  it('settles an evidence-backed Act plan before a direct final answer without submit_result', async () => {
    const plan: WorkPlanV1 = { version:1,planId:'direct-final-plan',revision:1,progressRevision:0,replanCount:0,goal:'Inspect and verify',constraints:[],assumptions:[],steps:[{id:'inspect',title:'Read source',kind:'inspect',status:'pending',dependencies:[]},{id:'verify',title:'Run tests',kind:'verify',status:'pending',dependencies:['inspect']}],risks:[],verification:['Tests pass'],openQuestions:[],status:'active',approvedRevision:1,updatedAt:new Date().toISOString() };
    const tools: ToolCapability = { id:'project-files',instructions:'test tools',tools:[
      { definition:{name:'read_text_file',description:'read',parameters:{type:'object'}},execute:async()=> 'source read' },
      { definition:{name:'run_command',description:'verify',parameters:{type:'object'}},execute:async()=>({content:'5 tests passed',details:{type:'command_execution',shell:'direct',workdir:sessionRoot,exitCode:0,signal:null,timedOut:false,aborted:false,purpose:'verification',stdoutTruncated:false,stderrTruncated:false}}) },
    ]};
    const toolResponses: ToolResponse[] = [
      {text:'',toolCalls:[{id:'direct-inspect',name:'read_text_file',arguments:'{}'}]},
      {text:'',toolCalls:[{id:'direct-verify',name:'run_command',arguments:'{}'}]},
      {text:'检查和测试均已完成。'},
    ];
    const provider = new class extends FakeProvider {
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> { this.requests.push(request); return toolResponses.shift() ?? {text:'unexpected'}; }
    }([]);
    const session = new ChatSession(provider,{enableTools:true,capabilities:[tools,createControlCapability()],workPlan:plan,workMode:{version:1,mode:'act',revision:1,actApprovedRevision:1,updatedAt:new Date().toISOString()}});
    await expect(session.send('只读检查并运行测试')).resolves.toMatchObject({text:'检查和测试均已完成。'});
    expect(session.currentWorkPlan).toMatchObject({status:'completed',progressRevision:2,steps:[{id:'inspect',status:'completed',evidenceCallIds:['direct-inspect']},{id:'verify',status:'completed',evidenceCallIds:['direct-verify']} ]});
  });
  it("fails closed before spending a tool step when external search is unavailable", async () => {
    const provider = { id: "fake", model: "fake", async generateWithTools(): Promise<ToolResponse> { throw new Error("should not call model"); } };
    const response = await new ChatSession(provider, { enableTools: true, agentLoop: true, projectRoot: sessionRoot }).send("请搜索网上公开资料并核实这个事实");
    expect(response).toMatchObject({ outcome: "blocked" });
    expect(response.text).toContain("没有可用的外部来源发现能力");
  });
  it("injects retrieved history as data and tolerates retrieval failure", async () => {
    const provider = new FakeProvider([{ text: "回答" }, { text: "继续回答" }]);
    const session = new ChatSession(provider, { retrieveContext: async input => input === "first" ? "不可信历史：偏好简洁" : Promise.reject(new Error("search unavailable")) });
    await session.send("first");
    expect(provider.requests[0]?.messages.some(message => message.content.includes("不可信历史：偏好简洁"))).toBe(true);
    await expect(session.send("second")).resolves.toMatchObject({ text: "继续回答" });
  });
  it("keeps system policy before retrieved data and current input", async () => {
    const provider = new FakeProvider([{ text: "ok" }]);
    await new ChatSession(provider, { systemPrompt: "SYSTEM POLICY", retrieveContext: async () => "MEMORY DATA" }).send("CURRENT INPUT");
    const contents = provider.requests[0]!.messages.map(message => message.content);
    const memoryIndex = contents.findIndex(content => content.includes("MEMORY DATA"));
    const currentIndex = contents.indexOf("CURRENT INPUT");
    expect(contents.indexOf("SYSTEM POLICY")).toBeLessThan(memoryIndex);
    expect(memoryIndex).toBeLessThan(currentIndex);
    expect(provider.requests[0]!.messages.find(message => message.content.includes("MEMORY DATA"))?.role).toBe("system");
  });
  it("indexes only after the final assistant message and ignores indexing failure", async () => {
    const snapshots: readonly Message[][] = [];
    const provider = new FakeProvider([{ text: "done" }]);
    await expect(new ChatSession(provider, { onTurnCommitted: async messages => { (snapshots as Message[][]).push(messages); throw new Error("index failed"); } }).send("work")).resolves.toMatchObject({ text: "done" });
    expect(snapshots[0]?.at(-1)).toEqual({ role: "assistant", content: "done" });
  });
  it("emits transient observer events in order", async () => {
    const events: string[] = [];
    const provider = new FakeProvider([{ text: "回答" }]);
    await new ChatSession(provider, { onSessionEvent: async event => { events.push(event.type); } }).send("你好");
    expect(events).toEqual(["user", "assistant"]);
  });


  it("loads a requested project file and continues with the tool result", async () => {
    class ToolProvider extends FakeProvider {
      private toolRequestCount = 0;
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        this.requests.push(request);
        this.toolRequestCount += 1;
        if (this.toolRequestCount > 1) return { text: "最终回答" };
        return { text: "", toolCalls: [{ id: "1", name: "read_text_file", arguments: JSON.stringify({ path: "README.md" }) }] };
      }
    }
    const p = new ToolProvider([{ text: "最终回答" }]);
    const s = new ChatSession(p, { projectRoot: sessionRoot, enableTools: true });
    await expect(s.send("读取 README")).resolves.toMatchObject({ text: "最终回答" });
    expect(p.requests.find(request => request.tools)?.tools?.map(tool => tool.name)).toEqual(["list_directory", "read_text_file", "search_project", "edit_text_file", "write_text_file"]);
  });
  it("supports read-only evidence before a discussion", async () => {
    class DiscussionProvider extends FakeProvider {
      private calls = 0;
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        this.requests.push(request);
        this.calls += 1;
        if (this.calls === 1) return { text: "", toolCalls: [{ id: "read-1", name: "read_text_file", arguments: JSON.stringify({ path: "README.md" }) }] };
        return { text: "基于读取到的源码，建议保留单一输入泵。" };
      }
    }
    const provider = new DiscussionProvider([]);
    const response = await new ChatSession(provider, { projectRoot: sessionRoot, enableTools: true }).send("讨论如何改进当前项目的审批流程，可以读取相关源码，但不要修改文件");
    expect(response.text).toContain("单一输入泵");
    expect(provider.requests.find(request => request.tools)?.tools?.map(tool => tool.name)).toEqual(["list_directory", "read_text_file", "search_project", "edit_text_file", "write_text_file"]);
  });
  it("reads, precisely edits, and continues to the next model step", async () => {
    class EditProvider extends FakeProvider {
      private calls = 0;
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        this.requests.push(request);
        this.calls += 1;
        if (this.calls === 1) return { text: "", toolCalls: [{ id: "read-edit", name: "read_text_file", arguments: JSON.stringify({ path: "README.md" }) }] };
        if (this.calls === 2) return { text: "", toolCalls: [{ id: "edit-once", name: "edit_text_file", arguments: JSON.stringify({ path: "README.md", oldText: "fixture", newText: "updated" }) }] };
        if (this.calls === 3) return { text: "", toolCalls: [{ id: "verify-once", name: "run_command", arguments: JSON.stringify({ command: "echo ok", purpose: "verification" }) }] };
        return { text: "精确修改完成" };
      }
    }
    const provider = new EditProvider([]);
    const approvedTools: string[] = [];
    const response = await new ChatSession(provider, {
      projectRoot: sessionRoot,
      enableTools: true,
      capabilities: [createProjectFilesCapability(sessionRoot), createCommandExecutionCapability(sessionRoot)],
      permissionPreset: "workspace",
      approvalPolicy: "ask",
      approvalService: { request: async request => { approvedTools.push(request.toolName); return { approved: true }; } },
    }).send("把 README 标题中的 fixture 改成 updated");
    expect(response.text).toBe("精确修改完成");
    expect(response.verificationStatus).toBe("passed_after_last_change");
    expect(await readFile(join(sessionRoot, "README.md"), "utf8")).toBe("# updated\n");
    expect(provider.requests).toHaveLength(4);
    expect(approvedTools).toEqual(["edit_text_file", "run_command"]);
    expect(provider.requests[2]?.messages).toContainEqual(expect.objectContaining({ role: "tool", toolCallId: "edit-once", content: "已编辑 README.md；替换 1 处" }));
  }, 15000);

  it("returns a concise task result without reinjecting the full state in the same turn", async () => {
    class TaskProvider extends FakeProvider {
      private calls = 0;
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        this.requests.push(request);
        this.calls += 1;
        if (this.calls === 1) return { text: "", toolCalls: [{ id: "task-1", name: "update_task_state", arguments: JSON.stringify({ goal: "完成任务", status: "active", constraints: [], assumptions: [], openQuestions: [], steps: [{ title: "实现", status: "in_progress" }], blockers: [] }) }] };
        return { text: "任务状态已保存" };
      }
    }
    const provider = new TaskProvider([]);
    const response = await new ChatSession(provider, { enableTools: true, capabilities: [createTaskStateCapability()] }).send("开始任务");
    expect(response.text).toBe("任务状态已保存");
    expect(provider.requests[1]?.messages).toContainEqual(expect.objectContaining({ role: "tool", toolCallId: "task-1", content: "任务状态已保存：active，步骤 0/1，阻塞 0。" }));
    expect(provider.requests[1]?.messages.some(message => message.role === "system" && message.content.includes("当前任务状态"))).toBe(false);
  });

  it("treats an identical task snapshot as idempotent", async () => {
    const state = { goal: "完成任务", status: "active" as const, constraints: [], assumptions: [], openQuestions: [], steps: [{ title: "实现", status: "in_progress" as const }], blockers: [] };
    class TaskProvider extends FakeProvider {
      private calls = 0;
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        this.requests.push(request);
        this.calls += 1;
        if (this.calls <= 2) return { text: "", toolCalls: [{ id: `task-${this.calls}`, name: "update_task_state", arguments: JSON.stringify(state) }] };
        return { text: "继续执行" };
      }
    }
    const revisions: number[] = [];
    await new ChatSession(new TaskProvider([]), {
      enableTools: true,
      capabilities: [createTaskStateCapability()],
      onSessionStateChanged: async current => {
        if (current.task && "version" in current.task) revisions.push(current.task.revision);
      },
    }).send("开始任务");
    expect(new Set(revisions.filter(revision => revision > 0))).toEqual(new Set([1]));
  });
  it("persists tool calls and results as canonical messages", async () => {
    class ToolProvider extends FakeProvider {
      private calls = 0;
      async generateWithTools(): Promise<ToolResponse> {
        this.calls += 1;
        if (this.calls === 1) return { text: "", toolCalls: [{ id: "1", name: "list_directory", arguments: JSON.stringify({ path: "" }) }] };
        if (this.calls === 2) return { text: "", toolCalls: [{ id: "2", name: "read_text_file", arguments: JSON.stringify({ path: "README.md" }) }] };
        return { text: "最终回答" };
      }
    }
    const p = new ToolProvider([]);
    const snapshots: Array<readonly Message[]> = [];
    await new ChatSession(p, { projectRoot: sessionRoot, enableTools: true, onMessagesChanged: async messages => { snapshots.push(messages); } }).send("读取 README");
    expect(snapshots.some(messages => messages.some(message => message.role === "tool" && message.toolCallId === "2"))).toBe(true);
    expect(snapshots.some(messages => messages.some(message => message.role === "system" && message.content.includes("[[evidence_cards]]")))).toBe(true);
  });
  it("stops the tool loop after approval rejection", async () => {
    class WriteProvider extends FakeProvider {
      toolCalls = 0;
      async generateWithTools(): Promise<ToolResponse> {
        this.toolCalls += 1;
        return { text: "", toolCalls: [{ id: String(this.toolCalls), name: "write_text_file", arguments: JSON.stringify({ path: "rejected.txt", content: "x" }) }] };
      }
    }
    const provider = new WriteProvider([]);
    const session = new ChatSession(provider, {
      enableTools: true,
      projectRoot: sessionRoot,
      approvalPolicy: "ask",
      approvalService: { request: async () => ({ approved: false, reason: "拒绝" }) },
    });
    await expect(session.send("创建文件")).resolves.toMatchObject({ outcome: "blocked", text: "用户拒绝了工具调用，已停止本轮执行。" });
    expect(provider.toolCalls).toBe(1);
  });
  it("does not repeat an already successful identical write", async () => {
    class RepeatingWriteProvider extends FakeProvider {
      toolCalls = 0;
      async generateWithTools(): Promise<ToolResponse> {
        this.toolCalls += 1;
        return { text: "", toolCalls: [{ id: String(this.toolCalls), name: "write_text_file", arguments: JSON.stringify({ path: "repeat.txt", content: "x" }) }] };
      }
    }
    const provider = new RepeatingWriteProvider([]);
    const session = new ChatSession(provider, {
      enableTools: true,
      projectRoot: sessionRoot,
      approvalPolicy: "ask",
      permissionPreset: "workspace",
      approvalService: { request: async () => ({ approved: true }) },
    });
    const response = await session.send("创建文件");
    expect(response).toMatchObject({ outcome: "completed", text: "写入已完成，已停止重复写入。" });
    expect(provider.toolCalls).toBe(2);
  });
  it("lets the model finish naturally after a successful write", async () => {
    class SingleWriteProvider extends FakeProvider {
      requestsWithTools: ModelRequest[] = [];
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        this.requestsWithTools.push(request);
        if (this.requestsWithTools.length === 1) return { text: "", toolCalls: [{ id: "write-once", name: "write_text_file", arguments: JSON.stringify({ path: "write-once.txt", content: "x" }) }] };
        return { text: "写入完成" };
      }
    }
    const root = await mkdtemp(join(tmpdir(), "isla-write-once-"));
    try {
      const provider = new SingleWriteProvider([]);
      const session = new ChatSession(provider, {
        enableTools: true,
        projectRoot: root,
        permissionPreset: "workspace",
        approvalPolicy: "ask",
        approvalService: { request: async () => ({ approved: true }) },
      });
      const response = await session.send("创建文件");
      expect(response.text).toBe("写入完成");
      expect(provider.requestsWithTools[0]?.toolChoice).toBeUndefined();
      expect(provider.requestsWithTools[1]?.toolChoice).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("does not replace a model answer with an intent-specific fixed failure", async () => {
    class InspectProvider extends FakeProvider {
      async generateWithTools(): Promise<ToolResponse> { return { text: "我已经查看完了" }; }
    }
    const provider = new InspectProvider([]);
    await expect(new ChatSession(provider, { projectRoot: sessionRoot, enableTools: true }).send("查看项目")).resolves.toMatchObject({ text: "我已经查看完了" });
  });
  it("maintains ordered context", async () => { const p = new FakeProvider([{ text: "a1" }, { text: "a2" }]); const s = new ChatSession(p, { systemPrompt: "system" }); await s.send("u1"); await s.send("u2"); expect(p.requests[1]?.messages).toEqual([{ role: "system", content: "system" }, { role: "user", content: "u1" }, { role: "assistant", content: "a1" }, { role: "user", content: "u2" }]); });
  it("keeps failed user input", async () => { const p = new FakeProvider([new Error("no") , { text: "retry" }]); const s = new ChatSession(p); await expect(s.send("u1")).rejects.toThrow(); await s.send("retry"); expect(p.requests[1]?.messages).toEqual([{ role: "user", content: "u1" }, { role: "user", content: "retry" }]); });
  it("persists user input before the provider call and assistant output after success", async () => {
    const snapshots: unknown[] = [];
    const p = new FakeProvider([{ text: "a1" }]);
    const s = new ChatSession(p, { onMessagesChanged: async messages => { snapshots.push(messages); } });
    await s.send("u1");
    expect(snapshots).toEqual([
      [{ role: "user", content: "u1" }],
      [{ role: "user", content: "u1" }, { role: "assistant", content: "a1" }],
    ]);
  });
  it("rolls back an assistant message when persisting it fails", async () => {
    let saves = 0;
    const p = new FakeProvider([{ text: "hidden" }, { text: "visible" }]);
    const s = new ChatSession(p, {
      onMessagesChanged: async () => {
        saves += 1;
        if (saves === 2) throw new Error("disk full");
      },
    });

    await expect(s.send("u1")).rejects.toThrow("disk full");
    await s.send("u2");

    expect(p.requests[1]?.messages).toEqual([
      { role: "user", content: "u1" },
      { role: "user", content: "u2" },
    ]);
  });
  it("sends only the latest configured turns while retaining the full persisted history", async () => {
    const snapshots: (readonly unknown[])[] = [];
    const p = new FakeProvider(Array.from({ length: 20 }, (_, index) => ({ text: `a${index + 1}` })));
    const s = new ChatSession(p, {
      systemPrompt: "system",
      maxContextTurns: 20,
      onMessagesChanged: async messages => { snapshots.push(messages); },
    });
    for (let index = 1; index <= 20; index += 1) await s.send(`u${index}`);
    expect(p.requests[19]?.messages[0]).toEqual({ role: "system", content: "system" });
    expect(p.requests[19]?.messages[1]).toEqual({ role: "user", content: "u1" });
    expect(p.requests[19]?.messages).toHaveLength(40);
    expect(snapshots.at(-1)).toHaveLength(41);
  });
  it("creates and persists a checkpoint before the main request", async () => {
    const summary = [
      "## 当前目标\n继续任务",
      "## 已完成事项\n完成旧轮次",
      "## 已确认决策与约束\n保留事实源",
      "## 待处理事项\n处理当前问题",
      "## 可验证证据\n旧工具结果",
      "## 话题关系\n主话题",
      "## 不确定或缺失信息\n无",
    ].join("\n");
    class CompactingProvider extends FakeProvider {
      private answers = 0;
      override async generate(request: ModelRequest): Promise<ModelResponse> {
        this.requests.push(request);
        if (request.messages[0]?.content.includes("会话压缩器")) return { text: summary };
        this.answers += 1;
        return { text: `a${this.answers}` };
      }
    }
    const states: Array<{ readonly messages: readonly Message[]; readonly context?: unknown }> = [];
    const provider = new CompactingProvider([]);
    const session = new ChatSession(provider, {
      maxContextTurns: 2,
      contextRetainTurns: 1,
      onSessionStateChanged: async state => { states.push(state); },
    });
    await session.send("u1");
    await session.send("u2");
    await session.send("u3");

    const mainRequest = provider.requests.at(-1)!;
    expect(mainRequest.messages.some(message => message.content.includes("以下是较早会话的历史压缩检查点"))).toBe(true);
    expect(mainRequest.messages).toContainEqual({ role: "user", content: "u3" });
    expect(mainRequest.messages).not.toContainEqual({ role: "user", content: "u1" });
    expect(states.at(-1)?.context).toMatchObject({ checkpoint: { throughMessageIndex: 3, content: summary } });
    expect(states.at(-1)?.messages).toHaveLength(6);
  });
  it("falls back to raw context when compression output is invalid", async () => {
    class InvalidCompactingProvider extends FakeProvider {
      private calls = 0;
      override async generate(request: ModelRequest): Promise<ModelResponse> {
        this.requests.push(request);
        this.calls += 1;
        return { text: request.messages[0]?.content.includes("会话压缩器") ? "不是有效检查点" : `a${this.calls}` };
      }
    }
    const provider = new InvalidCompactingProvider([]);
    const session = new ChatSession(provider, { maxContextTurns: 2, contextRetainTurns: 1 });
    await session.send("u1");
    await session.send("u2");
    await session.send("u3");
    const mainRequest = provider.requests.at(-1)!;
    expect(mainRequest.messages).toContainEqual({ role: "user", content: "u2" });
    expect(mainRequest.messages).toContainEqual({ role: "user", content: "u3" });
  });

  it("forces compaction when the final token estimate exceeds the input budget", async () => {
    const summary = [
      "## 当前目标\n继续",
      "## 已完成事项\n旧内容",
      "## 已确认决策与约束\n保留当前请求",
      "## 待处理事项\n回答",
      "## 可验证证据\n响应",
      "## 话题关系\n同一任务",
      "## 不确定或缺失信息\n无",
    ].join("\n");
    class TokenCompactingProvider extends FakeProvider {
      override async generate(request: ModelRequest): Promise<ModelResponse> {
        this.requests.push(request);
        if (request.messages[0]?.content.includes("会话压缩器")) return { text: summary };
        return { text: "done" };
      }
    }
    const provider = new TokenCompactingProvider([]);
    const session = new ChatSession(provider, { maxContextTokens: 1_000, maxContextTurns: 20, maxContextChars: 60_000 });
    await session.send(`first-${"旧内容".repeat(150)}`);
    await session.send(`second-${"更多内容".repeat(150)}`);

    expect(provider.requests.some(request => request.messages[0]?.content.includes("会话压缩器"))).toBe(true);
    const mainRequest = provider.requests.at(-1)!;
    expect(mainRequest.messages.some(message => message.content.includes("以下是较早会话的历史压缩检查点"))).toBe(true);
    expect(mainRequest.messages).toContainEqual({ role: "user", content: `second-${"更多内容".repeat(150)}` });
  });

  it("cancels the active turn, preserves the user, and reaches idle without an assistant", async () => {
    let started!: () => void;
    const providerStarted = new Promise<void>(resolve => { started = resolve; });
    const provider = {
      id: "cancel-test", model: "cancel-model",
      generate: async (_request: ModelRequest, options?: { signal?: AbortSignal }) => await new Promise<ModelResponse>((resolve, reject) => {
        started();
        options?.signal?.addEventListener("abort", () => { const error = new Error("The operation was aborted"); error.name = "AbortError"; reject(error); }, { once: true });
      }),
    };
    const states: Array<{ readonly messages: readonly Message[]; readonly journal?: any }> = [];
    const session = new ChatSession(provider, { onSessionStateChanged: async state => { states.push(state); } });
    const pending = session.send("cancel me");
    await providerStarted;
    expect(session.cancelActiveTurn()).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: "TURN_CANCELLED" });
    await session.whenIdle();
    expect(states.at(-1)?.messages).toEqual([{ role: "user", content: "cancel me" }]);
    expect(states.at(-1)?.journal?.turns.at(-1)).toMatchObject({ status: "cancelled", error: { code: "TURN_CANCELLED" } });
  });

  it('rejects a single oversized request before calling the provider', async () => {
    let calls = 0;
    const provider = { id: 'budget-test', model: 'budget-model', generate: async () => { calls += 1; return { text: 'unexpected' }; } };
    const session = new ChatSession(provider, { maxContextTokens: 10, maxOutputTokens: 20, contextReserveTokens: 1 });
    await expect(session.send('这是一段明显超过输入预算的长文本')).rejects.toMatchObject({ code: 'CONTEXT_INPUT_TOO_LARGE' });
    expect(calls).toBe(0);
  });
});
