import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ResidentHostClient } from '../../src/client/host-client.js';
import type { HostTurnEvent } from '../../src/host/server.js';
import type { WorkPlanV1, WorkMode } from '../../src/core/work-plan.js';

type Workspace = { workspaceRoot: string; workspaceKey: string };
type Session = { sessionId: string; provider: string; model: string; updatedAt: string; archivedAt?: string; match?: string };
type ChatMessage = { role: string; content: string };
type TurnView = { turnId: string; startedAt?: string; queuedFollowUps?: number };
type TimelineEvent = { key: string; title: string; detail?: string; state?: 'ok' | 'failed' | 'live' };
type ProcessView = { processId: string; state: string; adapter: string; tty: boolean; workdir: string; outputCursor: number; outputBytes: number; exitCode?: number | null };
type Approval = { id: string; tool: string; permission: string; summary: string };
type Question = { id: string; question: string; header?: string; options?: readonly { label: string; description?: string }[]; multiSelect?: boolean };
type PromptState = { approval?: Approval; questions?: { id: string; items: readonly Question[] } };
type Panel = 'plan' | 'activity' | 'checkpoints';
type Page = 'conversation' | 'memory' | 'jobs' | 'mcp' | 'settings';
type AnyRecord = Record<string, unknown>;

export function App() {
  const [client, setClient] = useState<ResidentHostClient>();
  const [workspace, setWorkspace] = useState<Workspace>();
  const [workspaceDraft, setWorkspaceDraft] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionSearch, setSessionSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [activeTurn, setActiveTurn] = useState<TurnView>();
  const [followUps, setFollowUps] = useState<{ id: string; text: string }[]>([]);
  const [liveText, setLiveText] = useState('');
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [promptState, setPromptState] = useState<PromptState>({});
  const [plan, setPlan] = useState<WorkPlanV1>();
  const [mode, setMode] = useState<WorkMode>('plan');
  const [checkpoints, setCheckpoints] = useState<AnyRecord[]>([]);
  const [processes, setProcesses] = useState<ProcessView[]>([]);
  const [processOutputs, setProcessOutputs] = useState<Record<string, string>>({});
  const [processCursors, setProcessCursors] = useState<Record<string, number>>({});
  const [checkpointPreview, setCheckpointPreview] = useState<unknown>();
  const [panel, setPanel] = useState<Panel>('plan');
  const [page, setPage] = useState<Page>('conversation');
  const [workspaceInput, setWorkspaceInput] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [memories, setMemories] = useState<AnyRecord[]>([]);
  const [memoryContent, setMemoryContent] = useState('');
  const [jobs, setJobs] = useState<AnyRecord[]>([]);
  const [mcpServers, setMcpServers] = useState<AnyRecord[]>([]);
  const [mcpAuthBusy, setMcpAuthBusy] = useState('');
  const [capabilities, setCapabilities] = useState<AnyRecord[]>([]);
  const [trace, setTrace] = useState<unknown>();
  const [context, setContext] = useState<unknown>();
  const generation = useRef(0);
  const sessionListRequest = useRef(0);
  const scrollArea = useRef<HTMLDivElement>(null);
  const storedSessionId = useMemo(() => sessionId, [sessionId]);

  useEffect(() => {
    if (!mobileSessionsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileSessionsOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileSessionsOpen]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/ui/bootstrap', { cache: 'no-store' });
        if (!response.ok) throw new Error('无法连接 Isla Host。请确认 Host 已启动，并通过它提供的地址打开工作台。');
        const bootstrap = await response.json() as { token: string; defaultWorkspaceRoot: string };
        if (cancelled) return;
        const api = new ResidentHostClient('', bootstrap.token);
        setClient(api);
        const savedRoot = localStorage.getItem('isla.workspaceRoot') || bootstrap.defaultWorkspaceRoot;
        setWorkspaceDraft(savedRoot);
        try { await connectWorkspace(api, savedRoot); }
        catch { if (!cancelled) setNotice('默认工作区当前不可用，请选择一个仍存在的文件夹路径。'); }
      } catch (error) { if (!cancelled) setNotice(errorMessage(error)); }
    })();
    return () => { cancelled = true; };
  }, []);

  const connectWorkspace = useCallback(async (api: ResidentHostClient, path: string) => {
    const result = await api.resolveWorkspace(path);
    localStorage.setItem('isla.workspaceRoot', result.workspaceRoot);
    setWorkspace(result);
    setWorkspaceDraft(result.workspaceRoot);
    setNotice('工作区已连接');
  }, []);

  const startMcpAuthorization = useCallback(async (serverId: string) => {
    if (!client) return;
    const popup = window.open('about:blank', '_blank');
    setMcpAuthBusy(serverId);
    try {
      const result = await client.startMcpOAuth(serverId);
      if (!/^https:\/\//u.test(result.authorizationUrl)) throw new Error('授权地址不安全，已拒绝打开。');
      if (popup) popup.location.replace(result.authorizationUrl);
      else setNotice('浏览器阻止了新窗口，请允许弹出窗口后重试。');
    } catch (error) {
      popup?.close();
      setNotice(errorMessage(error));
    } finally { setMcpAuthBusy(''); }
  }, [client]);

  const refreshSessions = useCallback(async (api = client, currentWorkspace = workspace, query = sessionSearch, archived = showArchived) => {
    if (!api || !currentWorkspace) return [] as Session[];
    const requestId = ++sessionListRequest.current;
    const result = await api.sessions(currentWorkspace.workspaceKey, query, archived);
    const list = [...result.sessions];
    if (requestId === sessionListRequest.current) setSessions(list);
    return list;
  }, [client, workspace, sessionSearch, showArchived]);

  const loadSession = useCallback(async (api: ResidentHostClient, id: string, currentWorkspace: Workspace) => {
    const ticket = ++generation.current;
    setMobileSessionsOpen(false);
    setSessionId(id);
    localStorage.setItem('isla.sessionId', id);
    setPage('conversation');
    setMessages([]); setTimeline([]); setLiveText(''); setPromptState({}); setPlan(undefined); setCheckpoints([]); setProcesses([]); setProcessOutputs({}); setProcessCursors({}); setActiveTurn(undefined); setFollowUps([]);
    const [history, work, checkpointList, traceView, contextView, active, processList] = await Promise.all([
      recentHistory(api, id), api.workPlan(id), api.checkpoints(id, currentWorkspace.workspaceRoot),
      api.sessionView(id, 'trace'), api.sessionView(id, 'context'), api.activeTurn(id), api.processes(id, currentWorkspace.workspaceRoot).catch(() => ({ processes: [] })),
    ]);
    if (ticket !== generation.current) return;
    setMessages([...history.messages]); setPlan(work.plan); setMode(work.mode?.mode ?? 'plan');
    setCheckpoints([...checkpointList.checkpoints] as AnyRecord[]); setTrace(traceView); setContext(contextView);
    setProcesses([...processList.processes]);
    if (active.active && active.turnId) { setActiveTurn({ turnId: active.turnId, startedAt: active.startedAt, queuedFollowUps: active.queuedFollowUps }); setFollowUps([...(active.followUps ?? [])]); }
  }, []);

  useEffect(() => {
    if (!client || !workspace) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await refreshSessions(client, workspace);
        if (cancelled) return;
        const saved = localStorage.getItem('isla.sessionId');
        const target = list.find(item => item.sessionId === saved) ?? list[0];
        if (target) await loadSession(client, target.sessionId, workspace);
      } catch (error) { if (!cancelled) setNotice(errorMessage(error)); }
    })();
    return () => { cancelled = true; };
  }, [client, workspace?.workspaceKey]);

  useEffect(() => {
    if (!client || !workspace) return;
    let cancelled = false;
    void (async () => {
      try {
        if (page === 'memory') {
          const result = await client.memory() as { records?: AnyRecord[] };
          if (!cancelled) setMemories(result.records ?? []);
        } else if (page === 'jobs') {
          const result = await client.resourceJobs() as { jobs?: AnyRecord[] };
          if (!cancelled) setJobs(result.jobs ?? []);
        } else if (page === 'mcp') {
          const [status, catalog] = await Promise.all([client.mcpStatus() as Promise<{ servers?: AnyRecord[] }>, client.capabilities() as Promise<{ entries?: AnyRecord[] }>]);
          if (!cancelled) { setMcpServers(status.servers ?? []); setCapabilities(catalog.entries ?? []); }
        }
      } catch (error) { if (!cancelled) setNotice(errorMessage(error)); }
    })();
    return () => { cancelled = true; };
  }, [client, page, workspace]);

  useEffect(() => {
    if (!client || page !== 'mcp') return;
    let cancelled = false;
    const refreshMcpStatus = async () => {
      try {
        const [status, catalog] = await Promise.all([client.mcpStatus() as Promise<{ servers?: AnyRecord[] }>, client.capabilities() as Promise<{ entries?: AnyRecord[] }>]);
        if (!cancelled) { setMcpServers(status.servers ?? []); setCapabilities(catalog.entries ?? []); }
      } catch (error) { if (!cancelled) setNotice(errorMessage(error)); }
    };
    window.addEventListener('focus', refreshMcpStatus);
    return () => { cancelled = true; window.removeEventListener('focus', refreshMcpStatus); };
  }, [client, page]);

  useEffect(() => {
    if (!client || !workspace || !sessionId || !activeTurn) return;
    let cancelled = false;
    let cursor = 0;
    const ticket = generation.current;
    const turn = activeTurn;
    const poll = async () => {
      while (!cancelled) {
        try {
          const batch = await client.turnEvents(sessionId, turn.turnId, cursor);
          if (batch.truncated && cursor < batch.firstSequence - 1) setNotice('Turn 较早的活动已超出内存回放窗口；当前状态仍可继续查看。');
          for (const item of batch.events) if (!cancelled) consumeEvent(item.event as HostTurnEvent, item.sequence);
          cursor = batch.nextSequence;
          const processList = await client.processes(sessionId, workspace.workspaceRoot).catch(() => undefined);
          if (processList && !cancelled) setProcesses([...processList.processes]);
          if (!batch.active) {
            if (!cancelled) {
              const nextTurn = await client.activeTurn(sessionId);
              if (nextTurn.active && nextTurn.turnId && nextTurn.turnId !== turn.turnId) {
                setLiveText(''); setTimeline([]); setPromptState({});
                setActiveTurn({ turnId: nextTurn.turnId, startedAt: nextTurn.startedAt, queuedFollowUps: nextTurn.queuedFollowUps });
                setFollowUps([...(nextTurn.followUps ?? [])]);
                return;
              }
              const selectedSession = sessionId;
              const [history, work, checkpointList, traceView, contextView, latestProcesses] = await Promise.all([
                recentHistory(client, sessionId), client.workPlan(sessionId), client.checkpoints(sessionId, workspace.workspaceRoot),
                client.sessionView(sessionId, 'trace'), client.sessionView(sessionId, 'context'), client.processes(sessionId, workspace.workspaceRoot).catch(() => ({ processes: [] })),
              ]);
              if (!cancelled && storedSessionId === selectedSession && generation.current === ticket) {
                setMessages([...history.messages]); setPlan(work.plan); setMode(work.mode?.mode ?? 'plan');
                setCheckpoints([...checkpointList.checkpoints] as AnyRecord[]); setTrace(traceView); setContext(contextView);
                setProcesses([...latestProcesses.processes]);
                setLiveText(''); setPromptState({});
                setActiveTurn(undefined);
              }
            }
            return;
          }
        } catch (error) {
          if (!cancelled) {
            const current = await client.activeTurn(sessionId).catch(() => undefined);
            if (current?.active && current.turnId && current.turnId !== turn.turnId) {
              setLiveText(''); setTimeline([]); setPromptState({});
              setActiveTurn({ turnId: current.turnId, startedAt: current.startedAt, queuedFollowUps: current.queuedFollowUps });
              setFollowUps([...(current.followUps ?? [])]);
            } else setNotice(`实时状态暂时不可用：${errorMessage(error)}`);
          }
        }
        await delay(600);
      }
    };
    void poll();
    return () => { cancelled = true; };
  }, [activeTurn?.turnId, client, sessionId, workspace?.workspaceRoot]);

  // A Turn may be started from another client (for example the remote CLI).
  // Keep idle Web clients subscribed to the selected Session so they can
  // discover it and attach the existing event replay without requiring refresh.
  useEffect(() => {
    if (!client || !sessionId || activeTurn) return;
    let cancelled = false;
    let checking = false;
    const discover = async () => {
      if (checking || cancelled) return;
      checking = true;
      try {
        const current = await client.activeTurn(sessionId);
        if (!cancelled && current.active && current.turnId) {
          setLiveText(''); setTimeline([]); setPromptState({});
          setActiveTurn({ turnId: current.turnId, startedAt: current.startedAt, queuedFollowUps: current.queuedFollowUps });
          setFollowUps([...(current.followUps ?? [])]);
        }
      } catch { /* transient host errors should not interrupt the conversation */ }
      finally { checking = false; }
    };
    void discover();
    const timer = window.setInterval(() => void discover(), 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeTurn, client, sessionId]);

  useEffect(() => { if (scrollArea.current) scrollArea.current.scrollTop = scrollArea.current.scrollHeight; }, [messages, liveText, timeline]);

  function consumeEvent(event: HostTurnEvent, sequence: number): void {
    if (event.type === 'turn_start' && event.followUpId) setFollowUps(items => items.filter(item => item.id !== event.followUpId));
    if (event.type === 'model_delta') setLiveText(value => value + event.text);
    if (event.type === 'model_step_start') appendTimeline({ key: `model-${sequence}`, title: `思考轮次 ${event.step}`, detail: `第 ${event.attempt} 次尝试`, state: 'live' });
    if (event.type === 'tool_start') appendTimeline({ key: `tool-${event.callId}`, title: event.tool, detail: '工具开始运行', state: 'live' });
    if (event.type === 'tool_end') appendTimeline({ key: `tool-${event.callId}`, title: event.tool, detail: event.ok ? '已完成' : `未完成 · ${event.code ?? 'TOOL_FAILED'}`, state: event.ok ? 'ok' : 'failed' });
    if (event.type === 'approval_requested') setPromptState({ approval: { id: event.approvalId, tool: event.tool, permission: event.permission, summary: event.summary } });
    if (event.type === 'question_requested') setPromptState({ questions: { id: event.questionId, items: event.questions } });
    if (event.type === 'turn_failed') setNotice(`本次任务未完成：${event.code}`);
    if (event.type === 'turn_cancelled') setNotice('任务已停止');
    if (event.type === 'turn_completed') setNotice('任务已完成');
    if (event.type === 'follow_up_dropped') { setFollowUps([]); setNotice(`${event.count} 条后续提示未执行；当前回合已结束，请检查会话后重新发送。`); }
  }

  function appendTimeline(item: TimelineEvent): void {
    setTimeline(items => {
      const found = items.findIndex(existing => existing.key === item.key);
      if (found < 0) return [...items, item].slice(-100);
      const next = [...items]; next[found] = item; return next;
    });
  }

  async function createSession(): Promise<void> {
    if (!client || !workspace) return;
    setBusy(true);
    try { const created = await client.createSession(workspace.workspaceKey); await refreshSessions(); await loadSession(client, created.sessionId, workspace); setNotice('新会话已创建'); }
    catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  }

  async function archiveSelected(archived: boolean): Promise<void> {
    if (!client || !sessionId || activeTurn) return;
    try {
      await client.setSessionArchived(sessionId, archived);
      if (!archived && showArchived) setShowArchived(false);
      const next = await refreshSessions(client, workspace, sessionSearch, archived ? showArchived : false);
      setNotice(archived ? '会话已归档' : '会话已恢复');
      if (archived && !showArchived) {
        const fallback = next[0];
        if (fallback && workspace) await loadSession(client, fallback.sessionId, workspace);
        else { setSessionId(''); setMessages([]); localStorage.removeItem('isla.sessionId'); }
      }
    } catch (error) { setNotice(errorMessage(error)); }
  }

  async function submitPrompt(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = draft.trim();
    if (!client || !workspace || !sessionId || !text) return;
    if (activeTurn) {
      const id = crypto.randomUUID();
      setBusy(true);
      try {
        const result = await client.followUpTurn(sessionId, activeTurn.turnId, text, id);
        setFollowUps(items => [...items, { id, text }]);
        setActiveTurn(current => current ? { ...current, queuedFollowUps: result.queuePosition } : current);
        setDraft(''); setNotice(`后续提示已排入第 ${result.queuePosition} 位`);
      } catch (error) { setNotice(errorMessage(error)); }
      finally { setBusy(false); }
      return;
    }
    setDraft(''); setLiveText(''); setTimeline([]); setPromptState({}); setBusy(true);
    try {
      const turn = await client.beginTurn(sessionId, text, workspace.workspaceRoot);
      setActiveTurn({ turnId: turn.turnId, startedAt: new Date().toISOString() });
      setNotice('Isla 正在处理');
      const history = await recentHistory(client, sessionId); setMessages([...history.messages]);
    } catch (error) { setDraft(text); setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function stopTurn(): Promise<void> {
    if (!client || !activeTurn || !sessionId) return;
    try { const result = await client.cancelTurn(sessionId, activeTurn.turnId); if (!result.accepted) setNotice('Turn 已经结束或无法取消'); }
    catch (error) { setNotice(errorMessage(error)); }
  }

  async function respondApproval(approved: boolean): Promise<void> {
    if (!client || !sessionId || !activeTurn || !promptState.approval) return;
    try {
      const result = await client.respond(sessionId, promptState.approval.id, activeTurn.turnId, { approved });
      if (result.accepted) setPromptState({});
    } catch (error) { setNotice(errorMessage(error)); }
  }

  async function respondQuestions(form: FormEvent<HTMLFormElement>): Promise<void> {
    form.preventDefault();
    if (!client || !sessionId || !activeTurn || !promptState.questions) return;
    const data = new FormData(form.currentTarget);
    const answers = promptState.questions.items.map(question => ({ id: question.id, selected: data.getAll(question.id).map(String), custom: String(data.get(`${question.id}:custom`) ?? '') }));
    try {
      const result = await client.respond(sessionId, promptState.questions.id, activeTurn.turnId, { answers });
      if (result.accepted) setPromptState({});
    } catch (error) { setNotice(errorMessage(error)); }
  }

  async function switchMode(next: WorkMode): Promise<void> {
    if (!client || !workspace || !sessionId) return;
    try {
      if (next === 'act' && plan && !window.confirm(`批准计划第 ${plan.revision} 版并进入执行？`)) return;
      await client.setWorkMode(sessionId, workspace.workspaceRoot, next, next === 'act' ? plan?.revision : undefined);
      const updated = await client.workPlan(sessionId); setPlan(updated.plan); setMode(updated.mode?.mode ?? next); setNotice(`已切换到${modeName(next)}模式`);
    } catch (error) { setNotice(errorMessage(error)); }
  }

  async function createWorkPlan(goal: string, lines: string): Promise<void> {
    if (!client || !workspace || !sessionId) return;
    const titles = lines.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
    if (!goal.trim() || !titles.length) { setNotice('请填写目标和至少一个计划步骤'); return; }
    const steps = titles.map((line, index) => {
      const match = line.match(/^(检查|调查|查看|读取|修改|实现|创建|验证|测试)[:：]\s*/u);
      const kind = match ? (['检查', '调查', '查看', '读取'].includes(match[1]!) ? 'inspect' : ['修改', '实现', '创建'].includes(match[1]!) ? 'change' : 'verify') : 'other';
      return { id: `step-${index + 1}`, title: line.replace(/^(检查|调查|查看|读取|修改|实现|创建|验证|测试)[:：]\s*/u, ''), status: 'pending' as const, dependencies: index ? [`step-${index}`] : [], kind };
    });
    const now = new Date().toISOString();
    const nextPlan: WorkPlanV1 = { version: 1, planId: crypto.randomUUID(), revision: 0, progressRevision: 0, replanCount: 0, goal: goal.trim(), constraints: [], assumptions: [], steps, risks: [], verification: steps.filter(step => step.kind === 'verify').map(step => step.title), openQuestions: [], status: 'active', updatedAt: now };
    try {
      await client.updateWorkPlan(sessionId, workspace.workspaceRoot, nextPlan, plan?.revision ?? 0);
      const updated = await client.workPlan(sessionId); setPlan(updated.plan); setMode(updated.mode?.mode ?? 'plan'); setNotice(`计划第 ${updated.plan?.revision ?? 1} 版已保存；执行前仍需显式批准。`);
    } catch (error) { setNotice(errorMessage(error)); }
  }

  async function previewCheckpoint(id: string): Promise<void> {
    if (!client || !workspace || !sessionId) return;
    try { setCheckpointPreview(await client.checkpointOperation(sessionId, workspace.workspaceRoot, 'preview', id)); }
    catch (error) { setNotice(errorMessage(error)); }
  }

  async function restoreCheckpoint(id: string): Promise<void> {
    if (!client || !workspace || !sessionId) return;
    if (window.prompt('恢复会覆盖工作区文件。输入 RESTORE 确认：') !== 'RESTORE') return;
    try { await client.checkpointOperation(sessionId, workspace.workspaceRoot, 'restore', id, true); setNotice('检查点已恢复'); setCheckpointPreview(undefined); }
    catch (error) { setNotice(errorMessage(error)); }
  }

  async function readProcessOutput(processId: string): Promise<void> {
    if (!client || !workspace || !sessionId) return;
    try {
      const result = await client.processOutput(sessionId, processId, workspace.workspaceRoot, processCursors[processId] ?? 0);
      const chunk = result.events.map(event => `${event.stream === 'stderr' ? '[stderr] ' : ''}${event.text}`).join('');
      setProcessOutputs(current => ({ ...current, [processId]: `${current[processId] ?? ''}${chunk}`.slice(-20_000) }));
      setProcessCursors(current => ({ ...current, [processId]: result.cursor }));
    } catch (error) { setNotice(errorMessage(error)); }
  }

  async function showMemory(id: string): Promise<void> {
    if (!client) return;
    try { const result = await client.memory('show', id) as AnyRecord; setMemoryContent(String(result.content ?? '')); }
    catch (error) { setNotice(errorMessage(error)); }
  }

  async function disableMemory(record: AnyRecord): Promise<void> {
    if (!client || typeof record.id !== 'string' || typeof record.revision !== 'number') return;
    if (!window.confirm('停用这条记忆？')) return;
    try { await client.disableMemory(record.id, record.revision); const result = await client.memory() as { records?: AnyRecord[] }; setMemories(result.records ?? []); setMemoryContent(''); }
    catch (error) { setNotice(errorMessage(error)); }
  }

  const submitWorkspace = async (event: FormEvent) => { event.preventDefault(); if (client) { try { await connectWorkspace(client, workspaceInput || workspaceDraft); localStorage.removeItem('isla.sessionId'); setSessionId(''); } catch (error) { setNotice(errorMessage(error)); } } };

  return <div className="app-shell">
    {mobileSessionsOpen && <button className="mobile-session-backdrop" aria-label="关闭会话导航" onClick={() => setMobileSessionsOpen(false)} />}
    <aside className={`sidebar ${mobileSessionsOpen ? 'mobile-open' : ''}`}>
      <div className="brand"><span className="brand-mark">i</span><span><strong>Isla</strong><small>AGENT WORKSPACE</small></span></div>
      <div className="sidebar-session-navigation" id="mobile-session-navigation">
      <div className="sidebar-label">工作区</div>
      <button className="workspace-chip" onClick={() => { setPage('settings'); setWorkspaceInput(workspace?.workspaceRoot ?? workspaceDraft); setMobileSessionsOpen(false); }} title={workspace?.workspaceRoot}>{workspace ? <><span className="status-dot" />{lastPath(workspace.workspaceRoot)}</> : '连接一个文件夹'}</button>
      <div className="sidebar-row"><span className="sidebar-label">{showArchived ? '已归档' : '最近会话'}</span><div className="session-toolbar"><button className="quiet-sidebar-button" onClick={() => { const archived = !showArchived; setShowArchived(archived); if (client && workspace) void refreshSessions(client, workspace, sessionSearch, archived); }} aria-pressed={showArchived}>{showArchived ? '返回' : '归档'}</button><button className="icon-button" onClick={() => void createSession()} disabled={!workspace || busy || showArchived} aria-label="新建会话">＋</button></div></div>
      <label className="session-search"><span className="sr-only">搜索会话内容</span><input value={sessionSearch} onChange={event => { setSessionSearch(event.target.value); if (client && workspace) void refreshSessions(client, workspace, event.target.value, showArchived); }} placeholder="搜索会话内容" /></label>
      <nav className="session-list" aria-label="最近会话">
        {sessions.map((item, index) => <button key={item.sessionId} className={`session-item ${item.sessionId === sessionId ? 'selected' : ''}`} onClick={() => workspace && client && void loadSession(client, item.sessionId, workspace)}>
          <span className="session-glyph">{index === 0 ? '◌' : '·'}</span><span><strong>{sessionLabel(item.sessionId)}</strong><small>{item.match ? item.match : formatDate(item.updatedAt)}</small></span>
        </button>)}
        {workspace && sessions.length === 0 && <p className="empty-small">{sessionSearch ? '没有找到匹配的会话。' : showArchived ? '这里还没有归档会话。' : '还没有会话。创建一个新会话，开始处理工作区里的任务。'}</p>}
        {sessionId && <button className="session-archive-action" onClick={() => void archiveSelected(!showArchived)} disabled={!!activeTurn}>{showArchived ? '恢复当前会话' : '归档当前会话'}</button>}
      </nav>
      </div>
      <div className="sidebar-bottom">
        <button className={`nav-link ${page === 'memory' ? 'active' : ''}`} onClick={() => { setPage('memory'); setMobileSessionsOpen(false); }}><span>◈</span>记忆</button>
        <button className={`nav-link ${page === 'jobs' ? 'active' : ''}`} onClick={() => { setPage('jobs'); setMobileSessionsOpen(false); }}><span>↗</span>后台任务</button>
        <button className={`nav-link ${page === 'mcp' ? 'active' : ''}`} onClick={() => { setPage('mcp'); setMobileSessionsOpen(false); }}><span>⌘</span>工具连接</button>
        <button className={`nav-link ${page === 'settings' ? 'active' : ''}`} onClick={() => { setPage('settings'); setWorkspaceInput(workspace?.workspaceRoot ?? workspaceDraft); setMobileSessionsOpen(false); }}><span>⚙</span>设置与诊断</button>
      </div>
      <div className="host-status"><span className="status-dot" />本机 Host <span className="host-version">v2</span></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs"><span>Isla</span><span className="crumb-slash">/</span><strong>{pageTitle(page)}</strong>{page === 'conversation' && sessionId && <span className="session-id">{sessionId}</span>}</div><div className="top-actions"><button className="mobile-session-toggle" aria-controls="mobile-session-navigation" aria-expanded={mobileSessionsOpen} onClick={() => setMobileSessionsOpen(value => !value)}>{sessionId ? `会话 · ${sessionLabel(sessionId)}` : '会话'}</button><span className={`mode-pill ${mode}`}>{modeName(mode)}</span>{activeTurn && <span className="working-indicator"><i />运行中</span>}</div></header>
      {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="关闭通知">×</button></div>}

      {page === 'conversation' && <div className="workbench">
        <section className="conversation-column">
          <div className="conversation-heading"><div><div className="eyebrow">当前工作</div><h1>{sessionId ? '把问题交给 Isla' : '从一个目标开始'}</h1><p>Isla 会先理解任务，再在工作区里逐步完成并验证。</p></div><div className="workspace-badge"><span className="status-dot" />{workspace ? lastPath(workspace.workspaceRoot) : '未连接工作区'}</div></div>
          {!sessionId ? <div className="welcome-card"><div className="welcome-mark">i<span>·</span></div><h2>让一个完整目标开始运转</h2><p>先连接本地文件夹，然后描述你希望最终得到什么。Isla 会保留进度、审批和验证结果。</p><button className="primary-button" onClick={() => setPage('settings')}>连接工作区 <span>→</span></button></div> : <>
            <div className="message-scroll" ref={scrollArea} aria-live="polite">
              {messages.map((message, index) => <article key={`${index}-${message.role}`} className={`message ${message.role}`}><div className="message-avatar">{message.role === 'user' ? '你' : 'i'}</div><div className="message-content"><div className="message-role">{message.role === 'user' ? '你' : 'Isla'}</div><p>{message.content}</p></div></article>)}
              {activeTurn && <article className="message assistant live-message"><div className="message-avatar pulse">i</div><div className="message-content"><div className="message-role">Isla <span className="live-label">正在工作</span></div>{liveText ? <p>{liveText}</p> : <div className="thinking-line"><i /><i /><i /><span>正在整理下一步</span></div>}</div></article>}
              {!messages.length && !activeTurn && <div className="conversation-empty"><span className="empty-orbit">◌</span><p>描述一个目标，而不是只给出下一条操作。</p><small>例如：检查这个模块的边界情况，修复问题，并运行相关测试。</small></div>}
            </div>
            {promptState.approval && <section className="approval-card" aria-label="待处理审批"><div className="approval-icon">!</div><div className="approval-copy"><strong>Isla 需要你的批准</strong><p>{promptState.approval.summary}</p><small>{promptState.approval.tool} · {promptState.approval.permission}</small></div><div className="approval-actions"><button className="quiet-button" onClick={() => void respondApproval(false)}>拒绝</button><button className="primary-button" onClick={() => void respondApproval(true)}>批准一次</button></div></section>}
            {promptState.questions && <form className="approval-card question-card" onSubmit={event => void respondQuestions(event)}><div className="approval-icon question-icon">?</div><div className="approval-copy"><strong>Isla 有个问题</strong>{promptState.questions.items.map(question => <fieldset key={question.id}><legend>{question.header || question.question}</legend>{question.options?.map(option => <label className="choice" key={option.label}><input type={question.multiSelect ? 'checkbox' : 'radio'} name={question.id} value={option.label} /><span>{option.label}{option.description && <small>{option.description}</small>}</span></label>)}<input className="text-answer" name={`${question.id}:custom`} placeholder="补充说明（可选）" /></fieldset>)}</div><button className="primary-button" type="submit">发送回答</button></form>}
            <form className="composer" onSubmit={event => void submitPrompt(event)}><label className="sr-only" htmlFor="prompt">描述目标</label><textarea id="prompt" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={activeTurn ? '补充一个后续目标…' : '描述你希望完成的目标…'} disabled={!workspace || !!sessions.find(item => item.sessionId === sessionId)?.archivedAt} rows={3} /><div className="composer-footer"><div className="composer-hint"><kbd>Enter</kbd> {activeTurn ? '加入后续' : '发送'} <span>·</span> <kbd>Shift Enter</kbd> 换行</div><div className="composer-actions">{activeTurn && <button className="stop-button" type="button" onClick={() => void stopTurn()}>停止</button>}<button className="send-button" type="submit" disabled={!draft.trim() || busy || !workspace || !!sessions.find(item => item.sessionId === sessionId)?.archivedAt}>{busy ? '正在提交…' : activeTurn ? '加入后续' : '发送'} <span>↗</span></button></div></div></form>
            {(followUps.length > 0 || (activeTurn?.queuedFollowUps ?? 0) > 0) && <div className="follow-up-queue" role="status"><strong>后续队列 · {Math.max(followUps.length, activeTurn?.queuedFollowUps ?? 0)}</strong>{followUps.map(item => <span key={item.id}>{item.text}</span>)}</div>}
            <div className="conversation-footnote">执行前会按操作类型请求批准 · 文件操作限制在当前工作区</div>
          </>}
        </section>
        <aside className="inspector">
          <div className="inspector-tabs" role="tablist">{(['plan', 'activity', 'checkpoints'] as Panel[]).map(item => <button key={item} role="tab" aria-selected={panel === item} className={panel === item ? 'selected' : ''} onClick={() => setPanel(item)}>{item === 'plan' ? '工作计划' : item === 'activity' ? '活动' : '检查点'}</button>)}</div>
          {panel === 'plan' && <PlanPanel plan={plan} mode={mode} onMode={next => void switchMode(next)} onCreate={input => void createWorkPlan(input.goal, input.steps)} />}
          {panel === 'activity' && <ActivityPanel timeline={timeline} trace={trace} context={context} processes={processes} processOutputs={processOutputs} onReadProcess={id => void readProcessOutput(id)} />}
          {panel === 'checkpoints' && <CheckpointPanel items={checkpoints} preview={checkpointPreview} onPreview={id => void previewCheckpoint(id)} onRestore={id => void restoreCheckpoint(id)} onClose={() => setCheckpointPreview(undefined)} />}
        </aside>
      </div>}

      {page === 'memory' && <section className="page-content"><PageHeading eyebrow="会话之外的长期信息" title="记忆" description="查看 Isla 记住的偏好与事实。内容只在你检查后管理。" />{memories.length ? <div className="record-grid">{memories.map(record => <article className="record-card" key={String(record.id)}><div className="record-meta"><span>{String(record.kind ?? '记忆')}</span><span className={`state-tag ${String(record.status)}`}>{String(record.status)}</span></div><h3>{String(record.id)}</h3><p>{String(record.scope ?? '个人')}</p><div className="record-actions"><button className="quiet-button" onClick={() => typeof record.id === 'string' && void showMemory(record.id)}>查看内容</button><button className="quiet-button danger-text" onClick={() => void disableMemory(record)}>停用</button></div></article>)}</div> : <EmptyState title="还没有可查看的记忆" text="对话中形成的长期信息会显示在这里。" />}{memoryContent && <div className="detail-drawer"><button className="drawer-close" onClick={() => setMemoryContent('')}>×</button><div className="eyebrow">记忆正文</div><pre>{memoryContent}</pre></div>}</section>}

      {page === 'jobs' && <section className="page-content"><PageHeading eyebrow="对话之外继续运行" title="后台任务" description="这里仅展示 Resource 服务提供的安全任务投影，不直接读取任务数据库。" />{jobs.length ? <div className="record-grid">{jobs.map((job, index) => <article className="record-card" key={String(job.jobId ?? index)}><div className="record-meta"><span>{String(job.type ?? 'Resource Job')}</span><span className={`state-tag ${String(job.status)}`}>{String(job.status)}</span></div><h3>{String(job.jobId ?? '任务')}</h3><p>{String(job.progress ?? job.summary ?? '状态由 Resource 服务管理')}</p><small>更新于 {formatDate(String(job.updatedAt ?? ''))}</small></article>)}</div> : <EmptyState title="当前没有可显示的任务" text="Resource 服务不可用时，任务状态仍由它自身管理；此页面不会尝试直接访问数据库。" />}</section>}

      {page === 'mcp' && <section className="page-content"><PageHeading eyebrow="已连接的工具能力" title="工具连接" description="管理 Resident Host 已配置的 MCP Server。需要登录的服务器可在此发起授权。" />{mcpServers.length ? <div className="record-grid">{mcpServers.map(server => <article className="record-card" key={String(server.id)}><div className="record-meta"><span>{String(server.transport ?? 'stdio')}</span><span className={`state-tag ${String(server.state)}`}>{String(server.state)}</span></div><h3>{String(server.id)}</h3><p>{String(server.toolCount ?? 0)} 个工具 · {server.required ? '必需' : '可选'}</p>{server.state === 'auth-required' && <button className="primary-button" disabled={mcpAuthBusy === String(server.id)} onClick={() => void startMcpAuthorization(String(server.id))}>{mcpAuthBusy === String(server.id) ? '正在准备授权…' : '连接并授权'}</button>}{Array.isArray(server.tools) && <div className="tag-list">{server.tools.map(String).map(tool => <span key={tool}>{tool}</span>)}</div>}</article>)}</div> : <EmptyState title="尚未连接 MCP Server" text="目前没有已配置的工具服务器。" />}<div className="section-heading"><h2>Host 能力目录</h2><span>{capabilities.length} 项</span></div><div className="capability-list">{capabilities.map((entry, index) => <div key={String(entry.id ?? index)}><strong>{String(entry.id ?? '能力')}</strong><span>{String(entry.summary ?? entry.description ?? '由 Resident Host 管理')}</span></div>)}</div></section>}

      {page === 'settings' && <section className="page-content settings-page"><PageHeading eyebrow="本机运行环境" title="设置与诊断" description="凭据与 Profile 仍由本机配置管理；Web 工作台不读取或保存 API Key。" /><form className="settings-card" onSubmit={submitWorkspace}><label htmlFor="workspace-path">工作区文件夹路径</label><div className="workspace-form-row"><input id="workspace-path" value={workspaceInput || workspaceDraft} onChange={event => setWorkspaceInput(event.target.value)} placeholder="输入本机文件夹路径" /><button className="primary-button" disabled={!client}>连接工作区</button></div><small>Isla 会在这个目录内运行工具。切换工作区会重新加载对应会话。</small></form><div className="settings-card diagnostics-card"><div><div className="eyebrow">当前连接</div><h2>Resident Host</h2><p>{workspace?.workspaceRoot ?? '尚未连接工作区'}</p></div><div className="diagnostic-grid"><span>服务范围<strong>仅本机</strong></span><span>活动 Turn<strong>{activeTurn ? '1' : '0'}</strong></span><span>模型配置<strong>{sessions.find(item => item.sessionId === sessionId)?.provider ?? 'Host'}</strong></span></div></div><div className="settings-card"><div className="eyebrow">隐私边界</div><p>认证凭据只保存在当前页面内存中，刷新后由同源 Host 重新提供；工作区路径与当前会话 ID 保存在本机浏览器，用于恢复界面状态。Tool 原始参数与凭据不会写入浏览器存储。</p></div></section>}
    </main>
  </div>;
}

function PlanPanel({ plan, mode, onMode, onCreate }: { plan?: WorkPlanV1; mode: WorkMode; onMode: (mode: WorkMode) => void; onCreate: (input: { goal: string; steps: string }) => void }) {
  const [goal, setGoal] = useState('');
  const [steps, setSteps] = useState('检查: 确认工作区和现有实现\n修改: 完成目标所需的最小改动\n验证: 运行相关测试并检查差异');
  return <div className="panel-body"><div className="panel-kicker">工作模式</div><div className="mode-switch">{(['plan', 'act', 'review'] as WorkMode[]).map(item => <button key={item} className={mode === item ? 'current' : ''} disabled={!plan && item !== 'plan'} onClick={() => item !== mode && onMode(item)}>{modeName(item)}</button>)}</div>{plan ? <><div className="plan-summary"><span className={`state-tag ${plan.status}`}>{plan.status === 'active' ? '进行中' : plan.status === 'blocked' ? '等待处理' : '已完成'}</span><span>计划 r{plan.revision} · 进度 {plan.progressRevision ?? 0}</span></div><h3 className="plan-goal">{plan.goal}</h3><div className="step-list">{plan.steps.map((step, index) => <div className={`plan-step ${step.status}`} key={step.id}><span className="step-node">{step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '·' : String(index + 1).padStart(2, '0')}</span><div><strong>{step.title}</strong><small>{stepKind(step.kind)}{step.evidenceCallIds?.length ? ` · ${step.evidenceCallIds.length} 条证据` : ''}</small></div></div>)}</div>{plan.verification.length > 0 && <div className="verification-box"><div className="panel-kicker">验收标准</div>{plan.verification.map((item, index) => <p key={index}>□ {item}</p>)}</div>}<div className="plan-approval-note">进入执行会明确批准当前计划 revision。计划结构变化后，需要重新批准。</div></> : <form className="plan-editor" onSubmit={event => { event.preventDefault(); onCreate({ goal, steps }); }}><div className="panel-empty compact"><span>⌁</span><strong>还没有结构化工作计划</strong><p>聊天中的计划文本不会自动视为已批准计划。整理目标与步骤后保存，再单独批准进入执行。</p></div><label htmlFor="plan-goal">目标</label><input id="plan-goal" value={goal} onChange={event => setGoal(event.target.value)} placeholder="例如：修复并验证这个模块的行为" /><label htmlFor="plan-steps">步骤（每行一项）</label><textarea id="plan-steps" value={steps} onChange={event => setSteps(event.target.value)} rows={5} /><small>可用“检查:”“修改:”“验证:”标注类型。保存仅创建计划，不会执行工具。</small><button className="primary-button" type="submit" disabled={!goal.trim()}>保存计划</button></form>}</div>;
}

function ActivityPanel({ timeline, trace, context, processes, processOutputs, onReadProcess }: { timeline: TimelineEvent[]; trace: unknown; context: unknown; processes: ProcessView[]; processOutputs: Record<string, string>; onReadProcess: (id: string) => void }) {
  return <div className="panel-body"><div className="panel-kicker">当前 Turn</div>{timeline.length ? <div className="activity-list">{timeline.map(item => <div className="activity-item" key={item.key}><span className={`activity-mark ${item.state ?? ''}`}>{item.state === 'ok' ? '✓' : item.state === 'failed' ? '!' : '·'}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div></div>)}</div> : <div className="panel-empty compact"><span>◌</span><strong>暂无活动</strong><p>模型阶段和安全的工具状态会显示在这里。</p></div>}{processes.length > 0 && <section className="process-output-section"><div className="panel-kicker">命令输出</div>{processes.map(process => <article className="process-output-card" key={process.processId}><div><strong>{process.workdir}</strong><small>{process.state} · {process.outputBytes} bytes · cursor {process.outputCursor}</small></div><button className="quiet-button" onClick={() => onReadProcess(process.processId)}>读取新输出</button>{processOutputs[process.processId] && <pre>{processOutputs[process.processId]}</pre>}</article>)}</section>}<details className="diagnostic-details"><summary>Session Trace</summary><pre>{formatJson(trace)}</pre></details><details className="diagnostic-details"><summary>Context 用量</summary><pre>{formatJson(context)}</pre></details></div>;
}

function CheckpointPanel({ items, preview, onPreview, onRestore, onClose }: { items: AnyRecord[]; preview: unknown; onPreview: (id: string) => void; onRestore: (id: string) => void; onClose: () => void }) {
  return <div className="panel-body"><div className="panel-kicker">工作区快照</div>{items.length ? <div className="checkpoint-list">{items.map(item => <article key={String(item.id)}><div className="checkpoint-date">{formatDate(String(item.createdAt ?? ''))}</div><strong>{String(item.id)}</strong><small>{item.gitHead ? `Git ${String(item.gitHead).slice(0, 8)}` : '工作区检查点'}</small><div className="checkpoint-actions"><button className="quiet-button" onClick={() => onPreview(String(item.id))}>查看差异</button><button className="quiet-button danger-text" onClick={() => onRestore(String(item.id))}>恢复</button></div></article>)}</div> : <div className="panel-empty"><span>◇</span><strong>还没有检查点</strong><p>开始修改前，Isla 可创建工作区快照供你检查和恢复。</p></div>}{preview !== undefined && <div className="diff-preview"><div className="diff-heading"><strong>差异预览</strong><button onClick={onClose}>×</button></div><pre>{formatCheckpointPreview(preview)}</pre></div>}</div>;
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div className="page-heading"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>; }
function EmptyState({ title, text }: { title: string; text: string }) { return <div className="empty-state"><span className="empty-orbit">◌</span><h2>{title}</h2><p>{text}</p></div>; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message.replace(/^HOST_HTTP_(\d+)$/u, 'Host 请求失败（HTTP $1）') : '请求失败'; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date); }
function lastPath(value: string): string { const parts = value.replaceAll('\\', '/').split('/').filter(Boolean); return parts.slice(-2).join('/') || value; }
function sessionLabel(value: string): string { return `对话 ${value.slice(-6)}`; }
function pageTitle(page: Page): string { return ({ conversation: '工作台', memory: '记忆', jobs: '后台任务', mcp: '工具连接', settings: '设置与诊断' })[page]; }
function modeName(mode: WorkMode): string { return ({ plan: '计划', act: '执行', review: '审查' })[mode]; }
function stepKind(kind?: string): string { return ({ inspect: '检查', change: '修改', verify: '验证', other: '步骤' })[kind ?? 'other'] ?? '步骤'; }
function formatJson(value: unknown): string { if (value === undefined) return '暂无数据'; try { return JSON.stringify(value, null, 2); } catch { return String(value); } }
function formatCheckpointPreview(value: unknown): string {
  if (typeof value !== 'object' || value === null) return formatJson(value);
  const preview = value as { restore?: unknown; remove?: unknown; diffs?: unknown; truncatedFiles?: unknown };
  if (!Array.isArray(preview.restore) || !Array.isArray(preview.remove) || !Array.isArray(preview.diffs)) return formatJson(value);
  const restore = preview.restore.filter((path): path is string => typeof path === 'string');
  const remove = preview.remove.filter((path): path is string => typeof path === 'string');
  const lines = ['将恢复：', ...(restore.length ? restore.map(path => `  ${path}`) : ['  （无）']), '', '将移除：', ...(remove.length ? remove.map(path => `  ${path}`) : ['  （无）'])];
  for (const item of preview.diffs) {
    if (typeof item !== 'object' || item === null) continue;
    const diff = item as { action?: unknown; path?: unknown; diff?: unknown; omittedReason?: unknown };
    lines.push('', `[${diff.action === 'restore' ? '恢复' : '移除'}] ${typeof diff.path === 'string' ? diff.path : '未知文件'}`);
    if (typeof diff.diff === 'string') lines.push(diff.diff);
    else if (typeof diff.omittedReason === 'string') lines.push(`差异内容已省略：${omittedDiffReason(diff.omittedReason)}`);
  }
  if (typeof preview.truncatedFiles === 'number' && preview.truncatedFiles > 0) lines.push('', `另有 ${preview.truncatedFiles} 个文件差异因输出上限而省略。`);
  return lines.join('\n');
}
function omittedDiffReason(reason: string): string { return ({ 'sensitive-content': '检测到敏感内容', 'diff-too-large': '差异过大', binary: '二进制文件', oversized: '文件过大', 'not-in-checkpoint': '文件不在检查点中' })[reason] ?? reason; }
function delay(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
async function recentHistory(api: ResidentHostClient, sessionId: string): Promise<{ readonly messages: readonly ChatMessage[]; readonly total: number }> {
  const count = await api.history(sessionId, 0, 1);
  return api.history(sessionId, Math.max(0, count.total - 100), 100);
}
