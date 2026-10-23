export const RESOURCE_WEB_UI = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Isla Resource</title>
  <style>
    :root { color-scheme: light; --ink:#172333; --muted:#667487; --paper:#f3f6f9; --panel:#fff; --line:#d8e0e8; --blue:#2764d7; --blue-soft:#e8f0ff; --amber:#c87616; --amber-soft:#fff1d9; --green:#17785b; --red:#b63c3c; --shadow:0 18px 48px rgba(35,52,72,.10); --radius:18px; }
    * { box-sizing:border-box; }
    body { margin:0; min-width:320px; min-height:100vh; color:var(--ink); background:linear-gradient(135deg,#f8fafc 0%,var(--paper) 58%,#eaf0f6 100%); font:15px/1.55 "Aptos","Segoe UI",system-ui,sans-serif; }
    button,input,textarea,select { font:inherit; }
    button,input,textarea,select { border:1px solid var(--line); border-radius:10px; }
    button { cursor:pointer; }
    :focus-visible { outline:3px solid rgba(39,100,215,.26); outline-offset:2px; }
    .shell { width:min(1440px,100%); margin:auto; padding:30px; }
    header { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; margin-bottom:22px; }
    .eyebrow,.mono { font-family:ui-monospace,"Cascadia Code",monospace; letter-spacing:.08em; text-transform:uppercase; }
    .eyebrow { color:var(--blue); font-size:12px; font-weight:700; }
    h1 { margin:3px 0 0; font-size:clamp(28px,4vw,46px); line-height:1.08; letter-spacing:-.045em; }
    .sub { max-width:540px; margin:8px 0 0; color:var(--muted); }
    .connection { display:flex; align-items:center; gap:8px; padding:8px 12px; background:rgba(255,255,255,.7); border:1px solid var(--line); border-radius:999px; white-space:nowrap; }
    .dot { width:8px; height:8px; border-radius:50%; background:var(--amber); box-shadow:0 0 0 4px var(--amber-soft); }
    .connection.online .dot { background:var(--green); box-shadow:0 0 0 4px #dff4ec; }
    .lanes { display:grid; grid-template-columns:1fr 1fr; gap:1px; overflow:hidden; margin-bottom:20px; border:1px solid var(--line); border-radius:14px; background:var(--line); box-shadow:var(--shadow); }
    .settings { margin-bottom:20px; padding:20px 22px; }
    .settings-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; align-items:end; }
    .settings .inline { margin-top:14px; }
    .settings-status { color:var(--muted); }
    .root-row { display:grid; grid-template-columns:minmax(120px,.7fr) minmax(220px,2fr) auto auto auto; gap:8px; align-items:end; margin-top:10px; }
    .lane { display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:12px; padding:13px 16px; background:rgba(255,255,255,.92); }
    .lane-mark { width:10px; height:34px; border-radius:99px; background:var(--blue); }
    .lane:nth-child(2) .lane-mark { background:var(--amber); }
    .lane strong { display:block; }
    .lane small { color:var(--muted); }
    .count { min-width:34px; padding:5px 9px; text-align:center; background:var(--paper); border-radius:9px; font:700 14px ui-monospace,monospace; }
    main { display:grid; grid-template-columns:minmax(0,420px) minmax(480px,1fr); gap:20px; align-items:start; }
    .card { background:rgba(255,255,255,.94); border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); }
    .composer { overflow:hidden; }
    .tabs { display:grid; grid-template-columns:1fr 1fr; background:#edf2f7; border-bottom:1px solid var(--line); }
    .tab { padding:16px; border:0; border-radius:0; background:transparent; color:var(--muted); font-weight:650; }
    .tab[aria-selected="true"] { color:var(--blue); background:var(--panel); box-shadow:inset 0 -3px var(--blue); }
    .form { display:none; padding:22px; }
    .form.active { display:block; }
    .form h2,.queue h2 { margin:0; font-size:20px; }
    .form p { margin:5px 0 20px; color:var(--muted); }
    label { display:block; margin:14px 0 6px; font-size:13px; font-weight:700; }
    textarea,input,select { width:100%; padding:11px 12px; background:#fbfcfe; color:var(--ink); }
    textarea { min-height:150px; resize:vertical; }
    .hint { margin-top:6px; color:var(--muted); font-size:12px; }
    .primary { width:100%; margin-top:20px; padding:12px 16px; border-color:var(--blue); background:var(--blue); color:white; font-weight:700; }
    .primary:hover { background:#1d54bd; }
    .queue { min-height:520px; overflow:hidden; }
    .queue-head { display:flex; align-items:center; justify-content:space-between; gap:15px; padding:20px 22px; border-bottom:1px solid var(--line); }
    .queue-head p { margin:3px 0 0; color:var(--muted); font-size:13px; }
    .refresh { padding:8px 12px; color:var(--blue); background:var(--blue-soft); border-color:transparent; }
    .jobs { display:grid; gap:10px; padding:12px; background:#f7f9fc; }
    .job { padding:16px; border:1px solid var(--line); border-radius:14px; background:white; box-shadow:0 2px 8px rgba(20,32,54,.04); }
    .job:last-child { border-bottom:0; }
    .job-top { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; }
    .job-title { display:flex; align-items:center; gap:10px; min-width:0; }
    .job-title strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .badge { flex:0 0 auto; padding:3px 8px; border-radius:99px; background:var(--paper); color:var(--muted); font-size:12px; }
    .badge.waiting_user { color:var(--amber); background:var(--amber-soft); }
    .badge.running,.badge.queued { color:var(--blue); background:var(--blue-soft); }
    .badge.completed { color:var(--green); background:#dff4ec; }
    .badge.failed { color:var(--red); background:#fbe8e8; }
    .meta { margin-top:7px; color:var(--muted); font:12px ui-monospace,"Cascadia Code",monospace; overflow-wrap:anywhere; }
    .decision,.failure { margin-top:13px; padding:13px; border-radius:11px; }
    .decision { background:var(--amber-soft); border:1px solid #f0d4a4; }
    .failure { color:var(--red); background:#fbeeee; border:1px solid #efcaca; }
    .decision p,.failure p { margin:0 0 10px; }
    .actions { display:flex; flex-wrap:wrap; gap:8px; }
    .actions button { padding:7px 11px; background:white; color:var(--ink); }
    .actions .approve { border-color:var(--blue); background:var(--blue); color:white; }
    .correction { margin:10px 0; min-height:84px; background:white; }
    .empty { display:grid; place-items:center; min-height:420px; padding:30px; text-align:center; color:var(--muted); }
    .empty-mark { width:70px; height:70px; margin:0 auto 16px; border:1px dashed #aab7c5; border-radius:18px; background:repeating-linear-gradient(135deg,#f7f9fb,#f7f9fb 7px,#eef3f7 7px,#eef3f7 14px); }
    .toast { position:fixed; right:24px; bottom:24px; max-width:min(420px,calc(100vw - 48px)); padding:12px 16px; border:0; border-radius:11px; background:var(--ink); color:white; box-shadow:var(--shadow); opacity:0; visibility:hidden; pointer-events:none; transform:translateY(12px); transition:opacity .2s ease,transform .2s ease,visibility 0s linear .2s; }
    .inline { display:flex; gap:8px; align-items:center; } .inline input { flex:1; } #baidu-tree { display:grid; gap:6px; max-height:180px; overflow:auto; margin-top:8px; } #baidu-tree button { text-align:left; }
    .toast.show { opacity:1; visibility:visible; transform:translateY(0); transition-delay:0s; }
    .progress { height:8px; margin-top:10px; overflow:hidden; border-radius:99px; background:#e8edf3; }
    .progress > span { display:block; height:100%; border-radius:inherit; background:var(--blue); transition:width .25s ease; }
    @media (max-width:900px) { .shell{padding:20px}.lanes,main,.settings-grid,.root-row{grid-template-columns:1fr}.queue{min-height:400px}header{align-items:flex-start;flex-direction:column}.connection{align-self:flex-start} }
    @media (max-width:520px) { .shell{padding:12px}.lane{padding:11px}.form,.job,.queue-head{padding:16px}.job-top{display:block}.badge{display:inline-block;margin-top:8px} }
    @media (prefers-reduced-motion:reduce) { *,*::before,*::after{scroll-behavior:auto!important;transition:none!important} }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div><div class="eyebrow">Isla / Resource Desk</div><h1>资源处理工作台</h1><p class="sub">粘贴分享信息，或从受管目录选择压缩包。下载与解压独立排队，遇到问题可以在原任务上修正并继续。</p></div>
      <div id="connection" class="connection"><span class="dot"></span><span>正在连接</span></div>
    </header>
    <section class="lanes" aria-label="处理通道">
      <div class="lane"><span class="lane-mark"></span><div><strong>下载通道</strong><small>百度网盘 · 可并行</small></div><span id="download-count" class="count">0</span></div>
      <div class="lane"><span class="lane-mark"></span><div><strong>解压通道</strong><small>检查 · 解压 · 整理</small></div><span id="extract-count" class="count">0</span></div>
    </section>
    <section class="card settings" aria-labelledby="directories-title">
      <h2 id="directories-title">资源目录</h2><p class="sub">只配置 Isla 可以扫描和整理到的目录。保存后重启 Resource 生效。</p>
      <form id="directories-form"><div id="directory-roots"></div><div class="inline"><button class="secondary" id="add-directory" type="button">添加目录</button><button class="secondary" type="submit">保存目录设置</button><span id="directories-status" class="settings-status">正在读取…</span></div></form>
    </section>
    <section class="card settings" aria-labelledby="worker-title">
      <h2 id="worker-title">Resource Worker</h2><p class="sub">可选的结构化推理 Worker。密钥只允许输入或替换，页面不会回显已保存值；保存后重启 Resident Host 生效。</p>
      <form id="worker-form">
        <div class="settings-grid">
          <label><input id="worker-enabled" type="checkbox"> 启用 Worker</label>
          <label for="worker-provider">Provider<select id="worker-provider"><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option><option value="bailian">Bailian</option><option value="local">Local</option></select></label>
          <label for="worker-model">模型<input id="worker-model" placeholder="模型名称"></label>
          <label for="worker-base-url">Base URL<input id="worker-base-url" placeholder="按 Provider 需要填写"></label>
        </div>
        <label for="worker-api-key">API Key（留空保留已保存密钥）</label><input id="worker-api-key" type="password" autocomplete="new-password" placeholder="未配置">
        <div class="inline"><button class="secondary" type="submit">保存 Worker 设置</button><button class="secondary" id="worker-test" type="button">测试当前状态</button><span id="worker-status" class="settings-status">正在读取…</span></div>
      </form>
    </section>
    <main>
      <section class="card composer">
        <div class="tabs" role="tablist"><button class="tab" role="tab" data-tab="download" aria-selected="true">百度下载</button><button class="tab" role="tab" data-tab="archive" aria-selected="false">文件解压 / 整理</button></div>
        <form id="download-form" class="form active">
          <h2>新建下载任务</h2><p>没有模型也会用规则识别链接、提取码和解压密码。</p>
          <label for="share-text">分享信息</label><textarea id="share-text" required placeholder="粘贴分享链接、提取码、解压密码和资源名称…"></textarea>
          <label for="download-destination">整理到</label><select id="download-destination" required></select>
          <div class="hint">也可以先浏览自己的百度网盘目录：</div>
          <div class="inline"><input id="baidu-path" value="/" placeholder="百度网盘路径，例如 /apps/bdpan"><button class="secondary" type="button" id="baidu-up">上一级</button><button class="secondary" type="button" id="browse-baidu">查询目录</button></div>
          <div id="baidu-tree" class="hint"></div>
          <div class="inline"><button class="secondary" type="button" id="download-baidu-path">下载当前路径</button><button class="secondary" type="button" id="download-baidu-selected">下载已选文件</button></div>
          <button class="primary" type="submit">解析并预览</button>
        </form>
        <form id="archive-form" class="form">
          <h2>长期整理文件夹</h2><p>选择 Isla 管理的目录；现在扫描一次，以后也会周期检查新增压缩包。</p>
          <label for="source-root">需要整理的目录</label><select id="source-root" required></select>
          <label for="relative-path">子文件夹（可选）</label><input id="relative-path" value="." placeholder="待整理">
          <div class="inline"><button class="secondary" type="button" id="local-up">上一级</button><button class="secondary" type="button" id="browse-local">浏览子文件夹</button></div>
          <div id="local-tree" class="hint"></div>
          <div class="hint">“.” 表示整个受管目录。支持改后缀和分卷包；已处理文件由账本去重。</div>
          <label for="archive-destination">整理到</label><select id="archive-destination" required></select>
          <button class="primary" type="submit">开始扫描并长期整理</button>
        </form>
      </section>
      <section class="card queue">
        <div class="queue-head"><div><h2>任务队列</h2><p>每 2 秒自动刷新；需要你处理的任务会保留在这里。</p></div><button id="refresh" class="refresh" type="button">刷新</button></div>
        <div id="jobs" class="jobs"><div class="empty"><div><div class="empty-mark"></div><strong>还没有资源任务</strong><div>从左侧创建第一个任务。</div></div></div></div>
      </section>
    </main>
  </div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <script>
    const api = '/api/v1/resource';
    const labels = {queued:'排队中',running:'处理中',waiting_user:'等待确认',cancelling:'正在取消',completed:'已完成',failed:'失败',cancelled:'已取消'};
    function jobLabel(job) { if(job.status==='queued'&&job.stage==='inspecting') return '等待检查'; if(job.status==='queued'&&job.stage==='extracting') return '等待解压'; if(job.status==='running'&&['inspecting','extracting','publishing'].includes(job.stage)) return '文件整理中'; if(job.status==='completed'&&job.source==='baidu') return '下载/整理完成'; return labels[job.status]||job.status; }
    const stages = {preview:'预览',queued_download:'等待下载',downloading:'正在下载',transferring:'正在传输',settling:'正在等待文件稳定',inspecting:'正在检查文件类型',grouping_volumes:'正在检查分卷',testing_archive:'正在验证压缩包',extracting:'正在解压',verifying:'正在验证解压产物',publishing:'正在整理',completed:'完成'};
    let config;
    let workerSettings;
    let directorySettings;
    const baiduSelected = new Set();
    const el = id => document.getElementById(id);
    async function request(path, options={}) { const response=await fetch(api+path,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options.headers||{})}}); const body=await response.json().catch(()=>({})); if(!response.ok) throw new Error(body.error?.message||('请求失败 '+response.status)); return body; }
    let toastTimer;
    function notify(message) { const toast=el('toast'); toast.textContent=message; toast.classList.add('show'); window.clearTimeout(toastTimer); toastTimer=window.setTimeout(()=>{toast.classList.remove('show');window.setTimeout(()=>{if(!toast.classList.contains('show'))toast.textContent='';},220);},2600); }
    function fillSelect(id, roots, selected) { const node=el(id); node.replaceChildren(...roots.map(root=>{const option=document.createElement('option');option.value=root.id;option.textContent=root.label;option.selected=root.id===selected;return option;})); }
    function node(tag, className, text) { const item=document.createElement(tag); if(className)item.className=className; if(text!==undefined)item.textContent=text; return item; }
    function actionButton(text, className, handler) { const button=node('button',className,text); button.type='button'; button.addEventListener('click',handler); return button; }
    async function decide(job, action, values) { await request('/jobs/'+encodeURIComponent(job.id)+'/confirm',{method:'POST',body:JSON.stringify({decisionId:job.pendingDecision.id,revision:job.revision,action,...(values?{values}:{})})}); notify('任务已更新'); await loadJobs(); }
    function renderDecision(job, host) { const decision=job.pendingDecision; if(!decision||['completed','failed','cancelled'].includes(job.status))return; const box=node('div','decision'); box.append(node('p','',decision.message)); if(decision.type==='correct_share_input'){const input=node('textarea','correction');input.placeholder='修改后的分享信息';box.append(input);box.append(actionButton('重新解析','approve',()=>decide(job,'replace_input',{text:input.value})));} else if(decision.type==='provide_archive_password'||decision.type==='provide_share_code'){const input=node('input','correction');input.type='text';input.inputMode='text';input.autocomplete='off';input.spellcheck=false;input.placeholder=decision.type==='provide_archive_password'?'输入解压密码（支持中文，不会保存到页面）':'输入四位分享码';box.append(input);const actions=node('div','actions');actions.append(actionButton('提交并继续','approve',()=>decide(job,'provide_values',decision.type==='provide_archive_password'?{password:input.value}:{shareCode:input.value})));actions.append(actionButton('取消任务','',()=>cancelJob(job)));box.append(actions);} else { const actions=node('div','actions'); actions.append(actionButton(decision.type==='handle_login'?'已完成登录，继续':'处理完成，继续','approve',()=>decide(job,'approve'))); actions.append(actionButton('取消任务','',()=>cancelJob(job))); box.append(actions); } host.append(box); }
    async function cancelJob(job) {
      try {
        const result = await request('/jobs/'+encodeURIComponent(job.id)+'/cancel',{method:'POST',body:'{}'});
        if (result && result.accepted === false) { notify('任务已经结束，无法取消'); }
        else { notify('任务已取消'); }
        await loadJobs();
      } catch (error) {
        notify(error && error.message ? '取消失败：'+error.message : '取消失败');
      }
    }
    async function retryJob(job, mode) { try { await request('/jobs/'+encodeURIComponent(job.id)+'/retry',{method:'POST',body:JSON.stringify({revision:job.revision,...(mode?{mode}: {})})}); notify(mode==='organize'?'已从文件整理阶段继续':'已从安全阶段继续：'+(stages[job.failure?.resumeStage]||'任务')); await loadJobs(); } catch(error) { notify('重试失败：'+(error&&error.message?error.message:'网络连接失败')); await loadJobs(); } }
    const expandedLogs=new Set();
    const expandedTrees=new Set();
    async function showJobLog(job, host) { expandedLogs.add(job.id); const box=node('div','meta'); box.className='job-log'; box.textContent='正在读取处理日志…'; host.append(box); try { const result=await request('/jobs/'+encodeURIComponent(job.id)+'/events'); box.replaceChildren(); (result.events||[]).forEach(event=>box.append(node('div','meta',new Date(event.occurredAt).toLocaleString()+' · '+event.type+' · '+JSON.stringify(event.data)))); if(!(result.events||[]).length)box.textContent='暂无处理日志'; } catch { box.textContent='日志读取失败'; } }
    async function showJobTree(job, host) { expandedTrees.add(job.id); const box=node('div','meta'); box.className='job-tree'; box.textContent='正在读取资源树…'; host.append(box); try { const result=await request('/jobs/'+encodeURIComponent(job.id)+'/tree'); box.replaceChildren(); const tree=result.tree||[]; if(!tree.length){box.textContent='暂无资源树记录';return;} tree.forEach(item=>box.append(node('div','meta',(item.parentId?'└─ ':'')+item.kind+' · '+item.status+' · '+item.path+(item.sizeBytes?' · '+formatBytes(item.sizeBytes):'')))); } catch { box.textContent='资源树读取失败'; } }
    async function deleteJob(job) { try { const result=await request('/jobs/'+encodeURIComponent(job.id),{method:'DELETE'});if(result.deleted){notify('任务记录已清除');await loadJobs();}else notify('任务记录不存在或已清除'); } catch(error) { notify(error && error.message ? '清除失败：'+error.message : '清除失败'); } }
    async function repeatJob(job) { await request('/jobs/'+encodeURIComponent(job.id)+'/repeat',{method:'POST',body:'{}'});notify('已创建新的下载任务');await loadJobs(); }
    function renderJobs(jobs) { const host=el('jobs'); host.replaceChildren(); if(!jobs.length){const empty=node('div','empty');const inner=node('div');inner.append(node('div','empty-mark'));inner.append(node('strong','', '还没有资源任务'));inner.append(node('div','', '从左侧创建第一个任务。'));empty.append(inner);host.append(empty);return;} jobs.forEach(job=>{const article=node('article','job');const top=node('div','job-top');const title=node('div','job-title');title.append(node('strong','',job.stage==='inspecting'||job.stage==='extracting'||job.stage==='publishing'?'文件整理任务':'百度下载任务'));top.append(title);top.append(node('span','badge '+job.status,jobLabel(job)));article.append(top);article.append(node('div','meta',(stages[job.stage]||job.stage)+' · '+job.id.slice(0,8)+' · '+new Date(job.updatedAt).toLocaleString()));if(job.progress?.ratio!==undefined){const percent=Math.max(0,Math.min(100,Math.round(job.progress.ratio*100)));article.append(node('div','meta','进度 '+percent+'%'));const bar=node('div','progress');const fill=node('span');fill.style.width=percent+'%';bar.append(fill);article.append(bar);}if(job.failure&&!job.pendingDecision&&['failed','waiting_user'].includes(job.status)){const failure=node('div','failure');failure.append(node('p','',job.failure.message+'（'+job.failure.code+'）'));if(job.failure.retryable)failure.append(actionButton('从安全阶段重试','',()=>retryJob(job)));article.append(failure);}renderDecision(job,article);if(['completed','failed','cancelled'].includes(job.status)){const actions=node('div','actions');if(job.source==='baidu'){if(job.status==='completed')actions.append(actionButton('从文件整理阶段重试','',()=>retryJob(job,'organize')));actions.append(actionButton('重新下载','',()=>repeatJob(job)));}actions.append(actionButton('清除记录','',()=>deleteJob(job)));article.append(actions);}host.append(article);}); const active=jobs.filter(job=>job.status==='queued'||job.status==='running');el('download-count').textContent=String(active.filter(job=>job.source==='baidu'&&(job.stage==='queued_download'||job.stage==='downloading'||job.stage==='transferring')).length);el('extract-count').textContent=String(active.filter(job=>['inspecting','grouping_volumes','testing_archive','extracting','verifying','publishing'].includes(job.stage)).length); }
    function refreshVisibleJobState(jobs) { document.querySelectorAll('#jobs .job').forEach((article,index)=>{const job=jobs[index];if(!job)return;const badge=article.querySelector('.badge');if(badge){badge.className='badge '+job.status;badge.textContent=jobLabel(job);}const metas=article.querySelectorAll('.meta');if(metas[0])metas[0].textContent=(stages[job.stage]||job.stage)+' · '+job.id.slice(0,8)+' · '+new Date(job.updatedAt).toLocaleString();}); }
    async function loadJobs() { try { const focused=document.activeElement; if(focused&&focused.closest&&focused.closest('.job')&&(focused.tagName==='INPUT'||focused.tagName==='TEXTAREA')) return; const body=await request('/jobs'); if(expandedLogs.size>0)refreshVisibleJobState(body.jobs); else renderJobs(body.jobs); el('connection').classList.add('online'); el('connection').lastElementChild.textContent='服务正常'; } catch(error) { el('connection').classList.remove('online'); el('connection').lastElementChild.textContent='连接失败'; notify(error.message); } }
    async function createJob(payload, form, batch=false) { const button=form.querySelector('button[type=submit]');button.disabled=true;try{const result=await request(batch?'/jobs/batch':'/jobs',{method:'POST',body:JSON.stringify(payload)});form.reset();notify(batch?'已创建 '+result.jobs.length+' 个下载任务':'任务已创建，请确认预览');await loadJobs();}catch(error){notify(error.message);}finally{button.disabled=false;} }
    async function createScan(form) { const button=form.querySelector('button[type=submit]');button.disabled=true;try{const result=await request('/scans',{method:'POST',body:JSON.stringify({managedRootId:el('source-root').value,relativePath:el('relative-path').value||'.',destinationRootId:el('archive-destination').value})});notify('扫描完成，发现 '+result.jobs.length+' 个新压缩包；已开启长期整理');await loadJobs();}catch(error){notify(error.message);}finally{button.disabled=false;} }
    function renderWorker(settings){workerSettings=settings;el('worker-enabled').checked=settings.enabled;el('worker-provider').value=settings.provider||'openai';el('worker-model').value=settings.model||'';el('worker-base-url').value=settings.baseURL||'';el('worker-api-key').value='';el('worker-api-key').placeholder=settings.apiKeyConfigured?'已配置；留空表示保留':'未配置';el('worker-status').textContent=settings.active?'Worker 已运行':settings.enabled?'已保存，等待 Resident Host 重启':'Worker 未启用';}
    async function loadWorker(){try{renderWorker(await request('/settings/worker'));}catch(error){el('worker-status').textContent='Worker 设置不可用';notify(error.message);}}
    function rootRow(root={}){const row=node('div','root-row');row.dataset.id=root.id||('root-'+Math.random().toString(36).slice(2,8));const label=node('input');label.placeholder='显示名称';label.value=root.label||'';label.dataset.field='label';const path=node('input');path.placeholder='绝对路径';path.value=root.path||'';path.dataset.field='path';const scan=node('label','','扫描');const scanInput=document.createElement('input');scanInput.type='checkbox';scanInput.checked=root.scanEnabled!==false;scanInput.dataset.field='scan';scan.prepend(scanInput);const output=node('label','','输出');const outputInput=document.createElement('input');outputInput.type='checkbox';outputInput.checked=root.outputEnabled!==false;outputInput.dataset.field='output';output.prepend(outputInput);row.append(label,path,scan,output,actionButton('移除','secondary',()=>row.remove()));return row;}
    function renderDirectories(settings){directorySettings=settings;const host=el('directory-roots');host.replaceChildren(...settings.managedRoots.map(root=>rootRow(root)));el('directories-status').textContent='已加载 '+settings.managedRoots.length+' 个目录';}
    async function loadDirectories(){try{renderDirectories(await request('/settings/directories'));}catch(error){el('directories-status').textContent='目录设置不可用';notify(error.message);}}
    el('add-directory').addEventListener('click',()=>el('directory-roots').append(rootRow()));
    el('directories-form').addEventListener('submit',async event=>{event.preventDefault();if(!directorySettings)return;const roots=[...el('directory-roots').children].map((row,index)=>({id:row.dataset.id||('root-'+(index+1)),label:row.querySelector('[data-field=label]').value,path:row.querySelector('[data-field=path]').value,scanEnabled:row.querySelector('[data-field=scan]').checked,outputEnabled:row.querySelector('[data-field=output]').checked}));const defaultRoot=roots.find(root=>root.outputEnabled);if(!defaultRoot){notify('至少需要一个可输出目录');return;}try{const saved=await request('/settings/directories',{method:'PUT',body:JSON.stringify({revision:directorySettings.revision,managedRoots:roots,defaultDestinationRootId:defaultRoot.id})});renderDirectories(saved);notify('目录设置已保存，重启 Resource 后生效');}catch(error){notify(error.message);}});
    el('worker-form').addEventListener('submit',async event=>{event.preventDefault();if(!workerSettings)return;const enabled=el('worker-enabled').checked;const payload={revision:workerSettings.revision,enabled,...(enabled?{provider:el('worker-provider').value,model:el('worker-model').value,baseURL:el('worker-base-url').value||undefined,apiKey:el('worker-api-key').value||undefined}:{})};try{renderWorker(await request('/settings/worker',{method:'PUT',body:JSON.stringify(payload)}));notify('Worker 设置已保存，重启 Resident Host 后生效');}catch(error){notify(error.message);}});
    el('worker-test').addEventListener('click',async()=>{try{const result=await request('/settings/worker/test',{method:'POST',body:'{}'});el('worker-status').textContent=result.active?'Worker 已运行':'Worker 尚未运行，请检查或重启 Resident Host';}catch(error){notify(error.message);}});
    document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(item=>item.setAttribute('aria-selected',String(item===tab)));document.querySelectorAll('.form').forEach(form=>form.classList.toggle('active',form.id===tab.dataset.tab+'-form'));}));
    el('download-form').addEventListener('submit',event=>{event.preventDefault();createJob({tool:'baidu-download',input:{kind:'share-text',text:el('share-text').value},destinationRootId:el('download-destination').value,startMode:'automatic'},event.currentTarget,true);});
    el('archive-form').addEventListener('submit',event=>{event.preventDefault();createScan(event.currentTarget);});
    const originalRenderJobs=renderJobs; renderJobs=function(jobs){originalRenderJobs(jobs);document.querySelectorAll('#jobs .job').forEach((article,index)=>{const job=jobs[index];const button=actionButton(expandedLogs.has(job.id)?'收起处理日志':'展开处理日志','',()=>{if(expandedLogs.has(job.id)){expandedLogs.delete(job.id);article.querySelector('.job-log')?.remove();button.textContent='展开处理日志';}else{button.textContent='收起处理日志';showJobLog(job,article);}});const treeButton=actionButton(expandedTrees.has(job.id)?'收起资源树':'查看资源树','',()=>{if(expandedTrees.has(job.id)){expandedTrees.delete(job.id);article.querySelector('.job-tree')?.remove();treeButton.textContent='查看资源树';}else{treeButton.textContent='收起资源树';showJobTree(job,article);}});article.append(button,treeButton);if(expandedLogs.has(job.id))showJobLog(job,article);if(expandedTrees.has(job.id))showJobTree(job,article);});};
    const parentPath=path=>path==='/'?'/':(path.split('/').slice(0,-1).join('/')||'/');
    const formatBytes=size=>size>=1048576?(size/1048576).toFixed(1)+' MB':size>=1024?(size/1024).toFixed(1)+' KB':size+' B';
    el('baidu-up').addEventListener('click',()=>{el('baidu-path').value=parentPath(el('baidu-path').value||'/');el('browse-baidu').click();});
    el('browse-baidu').addEventListener('click',async()=>{const path=el('baidu-path').value||'/';try{const result=await request('/baidu/tree?path='+encodeURIComponent(path));const entries=Array.isArray(result.entries)?result.entries:[];const host=el('baidu-tree');host.replaceChildren();if(!entries.length){host.textContent='目录为空或未返回文件';return;}entries.forEach(item=>{const row=node('div','inline');const itemPath=item.path||item.server_filename||'';if(!item.isdir){const check=document.createElement('input');check.type='checkbox';check.checked=baiduSelected.has(itemPath);check.addEventListener('change',()=>check.checked?baiduSelected.add(itemPath):baiduSelected.delete(itemPath));row.append(check);}const button=actionButton((item.isdir?'📁 ':'📄 ')+(item.server_filename||itemPath),'secondary',()=>{el('baidu-path').value=itemPath;if(item.isdir)el('browse-baidu').click();else notify('已选择文件路径');});row.append(button);row.append(node('span','meta',item.isdir?'文件夹':formatBytes(Number(item.size)||0)+' · '+(item.server_mtime?new Date(item.server_mtime).toLocaleString():'')));host.append(row);});}catch(error){notify(error.message);}});
    async function createRemotePathJob(path){return request('/jobs',{method:'POST',body:JSON.stringify({tool:'baidu-download',input:{kind:'baidu-path',path},destinationRootId:el('download-destination').value,startMode:'automatic'})});}
    el('download-baidu-path').addEventListener('click',async()=>{const path=el('baidu-path').value||'/';if(!window.confirm('确认下载当前路径？文件夹可能包含大量内容：'+path))return;try{await createRemotePathJob(path);notify('下载任务已创建');await loadJobs();}catch(error){notify(error.message);}});
    el('download-baidu-selected').addEventListener('click',async()=>{const paths=[...baiduSelected];if(!paths.length){notify('请先勾选文件');return;}try{for(const path of paths)await createRemotePathJob(path);baiduSelected.clear();notify('已创建 '+paths.length+' 个下载任务');await loadJobs();}catch(error){notify(error.message);}});
    el('local-up').addEventListener('click',()=>{el('relative-path').value=parentPath('/'+(el('relative-path').value||'.')).slice(1)||'.';el('browse-local').click();});
    el('browse-local').addEventListener('click',async()=>{const path=el('relative-path').value||'.';try{const result=await request('/local/tree?rootId='+encodeURIComponent(el('source-root').value)+'&path='+encodeURIComponent(path));const host=el('local-tree');host.replaceChildren();if(!result.entries.length){host.textContent='没有子文件夹';return;}result.entries.forEach(item=>host.append(actionButton('📁 '+item.name,'secondary',()=>{el('relative-path').value=item.path;el('browse-local').click();})));}catch(error){notify(error.message);}});
    el('refresh').addEventListener('click',loadJobs);
    (async()=>{try{config=await request('/config/public');const outputs=config.managedRoots.filter(root=>root.outputEnabled);fillSelect('download-destination',outputs,config.defaultDestinationRootId);fillSelect('archive-destination',outputs,config.defaultDestinationRootId);fillSelect('source-root',config.managedRoots.filter(root=>root.scanEnabled),config.managedRoots[0]?.id);await Promise.all([loadJobs(),loadWorker(),loadDirectories()]);window.setInterval(loadJobs,2000);}catch(error){notify(error.message);}})();
  </script>
</body>
</html>`;
