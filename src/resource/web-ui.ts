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
    .jobs { display:grid; gap:0; }
    .job { padding:18px 22px; border-bottom:1px solid var(--line); }
    .job:last-child { border-bottom:0; }
    .job-top { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; }
    .job-title { display:flex; align-items:center; gap:10px; min-width:0; }
    .job-title strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .badge { flex:0 0 auto; padding:3px 8px; border-radius:99px; background:var(--paper); color:var(--muted); font-size:12px; }
    .badge.waiting_user { color:var(--amber); background:var(--amber-soft); }
    .badge.running,.badge.queued { color:var(--blue); background:var(--blue-soft); }
    .badge.completed { color:var(--green); background:#dff4ec; }
    .badge.failed { color:var(--red); background:#fbe8e8; }
    .meta { margin-top:7px; color:var(--muted); font:12px ui-monospace,"Cascadia Code",monospace; }
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
    .toast { position:fixed; right:24px; bottom:24px; max-width:min(420px,calc(100vw - 48px)); padding:12px 16px; border-radius:11px; background:var(--ink); color:white; box-shadow:var(--shadow); transform:translateY(130%); transition:transform .2s ease; }
    .inline { display:flex; gap:8px; align-items:center; } .inline input { flex:1; } #baidu-tree { display:grid; gap:6px; max-height:180px; overflow:auto; margin-top:8px; } #baidu-tree button { text-align:left; }
    .toast.show { transform:translateY(0); }
    @media (max-width:900px) { .shell{padding:20px}.lanes,main{grid-template-columns:1fr}.queue{min-height:400px}header{align-items:flex-start;flex-direction:column}.connection{align-self:flex-start} }
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
    const stages = {preview:'预览',queued_download:'等待下载',downloading:'正在下载',inspecting:'正在检查',extracting:'正在解压',publishing:'正在整理',completed:'完成'};
    let config;
    const baiduSelected = new Set();
    const el = id => document.getElementById(id);
    async function request(path, options={}) { const response=await fetch(api+path,{credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options.headers||{})}}); const body=await response.json().catch(()=>({})); if(!response.ok) throw new Error(body.error?.message||('请求失败 '+response.status)); return body; }
    function notify(message) { const toast=el('toast'); toast.textContent=message; toast.classList.add('show'); window.setTimeout(()=>toast.classList.remove('show'),2600); }
    function fillSelect(id, roots, selected) { const node=el(id); node.replaceChildren(...roots.map(root=>{const option=document.createElement('option');option.value=root.id;option.textContent=root.label;option.selected=root.id===selected;return option;})); }
    function node(tag, className, text) { const item=document.createElement(tag); if(className)item.className=className; if(text!==undefined)item.textContent=text; return item; }
    function actionButton(text, className, handler) { const button=node('button',className,text); button.type='button'; button.addEventListener('click',handler); return button; }
    async function decide(job, action, values) { await request('/jobs/'+encodeURIComponent(job.id)+'/confirm',{method:'POST',body:JSON.stringify({decisionId:job.pendingDecision.id,revision:job.revision,action,...(values?{values}:{})})}); notify('任务已更新'); await loadJobs(); }
    function renderDecision(job, host) { const decision=job.pendingDecision; if(!decision||['completed','failed','cancelled'].includes(job.status))return; const box=node('div','decision'); box.append(node('p','',decision.message)); if(decision.type==='correct_share_input'){const input=node('textarea','correction');input.placeholder='修改后的分享信息';box.append(input);box.append(actionButton('重新解析','approve',()=>decide(job,'replace_input',{text:input.value})));} else if(decision.type==='provide_archive_password'||decision.type==='provide_share_code'){const input=node('input','correction');input.type=decision.type==='provide_archive_password'?'password':'text';input.autocomplete='off';input.placeholder=decision.type==='provide_archive_password'?'输入解压密码（不会回显）':'输入四位分享码';box.append(input);const actions=node('div','actions');actions.append(actionButton('提交并继续','approve',()=>decide(job,'provide_values',decision.type==='provide_archive_password'?{password:input.value}:{shareCode:input.value})));actions.append(actionButton('取消任务','',()=>cancelJob(job)));box.append(actions);} else { const actions=node('div','actions'); actions.append(actionButton(decision.type==='handle_login'?'已完成登录，继续':'处理完成，继续','approve',()=>decide(job,'approve'))); actions.append(actionButton('取消任务','',()=>cancelJob(job))); box.append(actions); } host.append(box); }
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
    async function retryJob(job) { await request('/jobs/'+encodeURIComponent(job.id)+'/retry',{method:'POST',body:JSON.stringify({revision:job.revision})}); notify('任务已重新进入队列'); await loadJobs(); }
    async function deleteJob(job) { try { const result=await request('/jobs/'+encodeURIComponent(job.id),{method:'DELETE'});if(result.deleted){notify('任务记录已清除');await loadJobs();}else notify('任务记录不存在或已清除'); } catch(error) { notify(error && error.message ? '清除失败：'+error.message : '清除失败'); } }
    async function repeatJob(job) { await request('/jobs/'+encodeURIComponent(job.id)+'/repeat',{method:'POST',body:'{}'});notify('已创建新的下载任务');await loadJobs(); }
    function renderJobs(jobs) { const host=el('jobs'); host.replaceChildren(); if(!jobs.length){const empty=node('div','empty');const inner=node('div');inner.append(node('div','empty-mark'));inner.append(node('strong','', '还没有资源任务'));inner.append(node('div','', '从左侧创建第一个任务。'));empty.append(inner);host.append(empty);return;} jobs.forEach(job=>{const article=node('article','job');const top=node('div','job-top');const title=node('div','job-title');title.append(node('strong','',job.source==='baidu'?'百度下载任务':'文件解压任务'));top.append(title);top.append(node('span','badge '+job.status,labels[job.status]||job.status));article.append(top);article.append(node('div','meta',(stages[job.stage]||job.stage)+' · '+job.id.slice(0,8)+' · '+new Date(job.updatedAt).toLocaleString()));if(job.progress?.ratio!==undefined)article.append(node('div','meta','进度 '+Math.round(job.progress.ratio*100)+'%'));if(job.failure){const failure=node('div','failure');failure.append(node('p','',job.failure.message+'（'+job.failure.code+'）'));if(job.failure.retryable)failure.append(actionButton('从安全阶段重试','',()=>retryJob(job)));article.append(failure);}renderDecision(job,article);if(['completed','failed','cancelled'].includes(job.status)){const actions=node('div','actions');if(job.source==='baidu')actions.append(actionButton('重新下载','',()=>repeatJob(job)));actions.append(actionButton('清除记录','',()=>deleteJob(job)));article.append(actions);}host.append(article);}); const active=jobs.filter(job=>job.status==='queued'||job.status==='running');el('download-count').textContent=String(active.filter(job=>job.source==='baidu'&&(job.stage==='queued_download'||job.stage==='downloading'||job.stage==='transferring')).length);el('extract-count').textContent=String(active.filter(job=>['inspecting','grouping_volumes','testing_archive','extracting','verifying','publishing'].includes(job.stage)).length); }
    async function loadJobs() { try { const body=await request('/jobs'); renderJobs(body.jobs); el('connection').classList.add('online'); el('connection').lastElementChild.textContent='服务正常'; } catch(error) { el('connection').classList.remove('online'); el('connection').lastElementChild.textContent='连接失败'; notify(error.message); } }
    async function createJob(payload, form, batch=false) { const button=form.querySelector('button[type=submit]');button.disabled=true;try{const result=await request(batch?'/jobs/batch':'/jobs',{method:'POST',body:JSON.stringify(payload)});form.reset();notify(batch?'已创建 '+result.jobs.length+' 个下载任务':'任务已创建，请确认预览');await loadJobs();}catch(error){notify(error.message);}finally{button.disabled=false;} }
    async function createScan(form) { const button=form.querySelector('button[type=submit]');button.disabled=true;try{const result=await request('/scans',{method:'POST',body:JSON.stringify({managedRootId:el('source-root').value,relativePath:el('relative-path').value||'.',destinationRootId:el('archive-destination').value})});notify('扫描完成，发现 '+result.jobs.length+' 个新压缩包；已开启长期整理');await loadJobs();}catch(error){notify(error.message);}finally{button.disabled=false;} }
    document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(item=>item.setAttribute('aria-selected',String(item===tab)));document.querySelectorAll('.form').forEach(form=>form.classList.toggle('active',form.id===tab.dataset.tab+'-form'));}));
    el('download-form').addEventListener('submit',event=>{event.preventDefault();createJob({tool:'baidu-download',input:{kind:'share-text',text:el('share-text').value},destinationRootId:el('download-destination').value,startMode:'automatic'},event.currentTarget,true);});
    el('archive-form').addEventListener('submit',event=>{event.preventDefault();createScan(event.currentTarget);});
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
    (async()=>{try{config=await request('/config/public');const outputs=config.managedRoots.filter(root=>root.outputEnabled);fillSelect('download-destination',outputs,config.defaultDestinationRootId);fillSelect('archive-destination',outputs,config.defaultDestinationRootId);fillSelect('source-root',config.managedRoots.filter(root=>root.scanEnabled),config.managedRoots[0]?.id);await loadJobs();window.setInterval(loadJobs,2000);}catch(error){notify(error.message);}})();
  </script>
</body>
</html>`;
