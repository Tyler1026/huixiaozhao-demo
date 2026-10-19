/* ================= /整合联动层 ================= */

var AUTH=null, _authState='unknown', _authError='', _authPending=null, _authEpoch=0;
function _authEscape(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function _safeProfiles(profiles){
  var result={}, fields=['name','phone','wechat','org','dept','title','city','ts','role','projKey','projectKeys','user','resident'];
  Object.keys(profiles||{}).forEach(function(user){var p=profiles[user];if(!p||typeof p!=='object')return;var item={};fields.forEach(function(k){if(p[k]!==undefined)item[k]=p[k];});result[user]=item;});
  return result;
}
function _safeSyncSnapshot(raw){
  var data=Object.assign({},raw||{});
  ['USER_PROFILES','CITY_ACCOUNTS','INVITE_CODES','CITY_WORKSPACES','ACCOUNTS','AUTH','auth','password','pwd','token'].forEach(function(k){delete data[k];});
  if(data.REPORTSTATE){data.REPORTSTATE=Object.assign({},data.REPORTSTATE);Object.keys(data.REPORTSTATE).forEach(function(key){var state=Object.assign({},data.REPORTSTATE[key]);Object.keys(state).forEach(function(field){if(/^chain/.test(field)||field==='pendingChainSaves')delete state[field];});data.REPORTSTATE[key]=state;});}
  if(data.PROJECTS){data.PROJECTS=Object.assign({},data.PROJECTS);Object.keys(data.PROJECTS).forEach(function(key){data.PROJECTS[key]=Object.assign({},data.PROJECTS[key]);delete data.PROJECTS[key].segmentLevels;});}
  if(data.huixiaozhao_kb_v1)data.huixiaozhao_kb_v1=_safeSyncSnapshot(data.huixiaozhao_kb_v1);
  return data;
}
function saveAuth(){try{localStorage.removeItem('hxz_auth');}catch(_){} }
function _purgeAuthCache(){
  saveAuth();
  try{var raw=localStorage.getItem('huixiaozhao_kb_v1');if(raw)localStorage.setItem('huixiaozhao_kb_v1',JSON.stringify(_safeSyncSnapshot(JSON.parse(raw))));}catch(_){}
}
function _authJson(path,body){
  var controller=typeof AbortController!=='undefined'?new AbortController():null;
  var timer;
  var options={credentials:'same-origin',headers:{'Accept':'application/json'}};
  if(body!==undefined){options.method='POST';options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  if(controller)options.signal=controller.signal;
  var request=fetch(path,options).then(function(response){
    return response.json().catch(function(){throw new Error('服务响应异常，请重试');}).then(function(data){
      if(response.ok===false||!data||data.ok!==true){
        var error=new Error(data&&data.message||'服务暂时不可用，请稍后重试');error.status=response.status;error.code=data&&data.error;
        if(response.status===401&&path!=='/api/auth/login'&&path!=='/api/auth/register'&&path!=='/api/auth/session'){_authForget();if(typeof render==='function')render();}
        throw error;
      }
      return data;
    });
  });
  var deadline=new Promise(function(_,reject){timer=setTimeout(function(){if(controller)controller.abort();reject(new Error('请求超时，请重试'));},20000);});
  return Promise.race([request,deadline]).then(function(data){clearTimeout(timer);return data;},function(error){clearTimeout(timer);throw error;});
}
function loadAuth(){
  if(_authPending)return _authPending;
  _purgeAuthCache();_authState='checking';
  _authPending=_authJson('/api/auth/session').then(function(data){
    if(data.authenticated!==true)throw Object.assign(new Error('请登录'),{status:401});
    _authAccept(data.auth);
  }).catch(function(error){
    if(error.status===401){_authForget();}else{AUTH=null;_authResetView();_authState='unavailable';_authError=error.message;}
  }).then(function(){_authPending=null;if(typeof render==='function')render();});
  return _authPending;
}
function logout(){
  if(logout._pending)return logout._pending;
  logout._pending=_authJson('/api/auth/logout',{}).then(function(){_authForget();render();}).catch(function(error){toast(error.message||'退出失败，请重试');}).then(function(){logout._pending=null;});
  return logout._pending;
}
/* A new direction inherits its selected parent's workspace, including in the admin UI. */
function _projectWorkspaceId(parentKey){
  parentKey=parentKey||cur;
  var parent=PROJECTS[parentKey];
  if(AUTH&&AUTH.scope==='admin')return parent&&parent.workspaceId||parentKey||AUTH.projKey||null;
  var authorized=typeof _authWorkspaceOf==='function'?_authWorkspaceOf(parentKey):null;
  return authorized||AUTH&&AUTH.projKey||null;
}
function _authReadSync(response){
  if(response.status===401){_authForget();render();throw new Error('登录已过期，请重新登录');}
  if(response.ok===false)throw new Error('工作区暂时不可用');
  return response.json();
}
function _authResetView(){
  PROJECTS={};USER_PROFILES={};CITY_ACCOUNTS={};INVITE_CODES={};REPORT_REQUESTS=[];
  ['REPORTSTATE','REPORT_HISTORY','UPLOADS','KB_FILE_CHUNKS','KB_CHAT','KB_CONFIRMS','KB_CONFIRM_TOMBS','KB_ITEM_TOMBS','KB_UNLOCKED','PENDING_CONFIRMS','DOCK_LOGS','SUBPROJ','UPLOAD_TOMBS','KB_CHAT_TOMBS','CITY_BASE_PACKAGES','CITY_WORKSPACES'].forEach(function(k){if(typeof window[k]!=='undefined')window[k]={};});
  ['DEMANDS','REPORT_REQUESTS','OPS_ENT'].forEach(function(k){if(typeof window[k]!=='undefined')window[k]=[];});
  if(window._syncTimer){clearTimeout(window._syncTimer);window._syncTimer=null;}
  window._serverSyncLock=false;window._verifyInProgress=false;window._reportGenerating=false;
  window.DELETED_PROJECTS=[];window.DELETED_CLUES=[];window.__lastSyncFp=null;
  cur=null;view='login';window._opsDataReady=false;
  if(document.body&&document.body.classList&&typeof document.body.classList.remove==='function')document.body.classList.remove('ops-mode');
  _opsRenderedTab=null;_opsRenderedScope=null;if(typeof ragResetChat==='function')ragResetChat(null,false);
  render._opsRestored=false;render._opsLoadError='';
  try{['huixiaozhao_kb_v1','hxz_auth','hxz_uploads','hxz_reportstate','hxz_rpt_history','hxz_report_history','HXZ_UPLOAD_TOMBS','HXZ_KBCHAT_TOMBS','hxz_subproj'].forEach(function(k){localStorage.removeItem(k);});}catch(_){}
}
function _authAccept(auth){
  if(!auth||typeof auth.user!=='string'||!Array.isArray(auth.projectKeys))throw new Error('登录响应不完整，请重试');
  _authEpoch++;_authResetView();
  AUTH={user:auth.user,scope:auth.scope||'user',role:auth.role||'member',projectKeys:auth.projectKeys.slice(),projKey:auth.projKey||null};
  _authState='ready';_authError='';return AUTH;
}
function _authForget(){_authEpoch++;AUTH=null;_authState='anonymous';_authResetView();}
function opsIcon(key,size){
  return typeof hxzIcon==='function' ? hxzIcon(key,{size:size||20}) : '';
}
function opsBrandMark(){
  return '<span class="ops-brand-mark" aria-hidden="true"><b></b><b></b><b></b><b></b></span>';
}
function opsBrandImage(kind){
  return typeof OPS_BRAND_IMAGES!=='undefined' && OPS_BRAND_IMAGES[kind] || '';
}
function opsLoginPage(){
  return '<main class="ops-login-shell"><div class="ops-login-layout">'+
    '<aside class="ops-login-brand" aria-label="慧小招管理工作台">'+
      '<div class="ops-login-brandline">'+opsBrandMark()+'<div><strong>慧小招</strong><span>城市研究与招商协同</span></div></div>'+
      '<div class="ops-login-intro"><p class="ops-login-eyebrow">城市 · 资源 · 行动</p><p class="ops-login-title">让城市招商，<br>有据可循。</p><p class="ops-login-description">把城市的可能，<br>变成清楚的下一步。</p></div>'+
      '<img class="ops-login-visual" src="'+opsBrandImage('city')+'" alt="青绿色城市建筑概念图">'+
      '<div class="ops-login-brandfoot"><span class="ops-login-brandrule"></span><span>报告任务<span class="ops-login-dot">·</span>城市智库<span class="ops-login-dot">·</span>招商协同</span></div>'+
    '</aside>'+
    '<section class="ops-login-panel" aria-labelledby="opsLoginTitle"><div class="ops-login-form">'+
      '<span class="ops-login-badge">'+opsIcon('security',15)+'管理工作台</span><h1 id="opsLoginTitle">管理端登录</h1><p class="ops-login-subtitle">使用管理员账号和密码，继续城市招商工作。</p>'+
      '<div class="ops-login-fields"><label class="ops-login-field" for="opsLoginUser"><span>管理员账号</span><input id="opsLoginUser" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="输入管理员账号" aria-describedby="opsLoginError"></label>'+
      '<label class="ops-login-field" for="opsLoginPwd"><span>登录密码</span><input id="opsLoginPwd" type="password" autocomplete="current-password" placeholder="输入密码" aria-describedby="opsLoginError" onkeydown="if(event.key===&quot;Enter&quot;)opsLogin()"></label></div>'+
      '<p id="opsLoginError" class="ops-login-error" role="alert" aria-live="polite"></p><button type="button" class="ops-login-submit" onclick="opsLogin()"><span>登录管理端</span>'+opsIcon('next',18)+'</button>'+
      '<div class="ops-login-switch"><span>进入城市团队工作区</span><a href="/">前往政府端'+opsIcon('external',15)+'</a></div>'+
      '<p class="ops-login-footnote">本入口面向已授权的管理人员</p>'+
    '</div></section></div></main>';
}
function opsLogin(){
  if(opsLogin._pending)return opsLogin._pending;
  var user=document.getElementById('opsLoginUser'),pwd=document.getElementById('opsLoginPwd'),errorEl=document.getElementById('opsLoginError');
  var data={username:(user&&user.value||'').trim().toLowerCase(),password:pwd&&pwd.value||''};
  if(!data.username||!data.password){if(errorEl)errorEl.textContent='请输入管理员账号和密码';return;}
  opsLogin._pending=_authJson('/api/auth/login',data).then(function(data){_authAccept(data.auth);render();}).catch(function(error){if(errorEl)errorEl.textContent=error.message;}).then(function(){opsLogin._pending=null;});
  return opsLogin._pending;
}
function render(){
  if(typeof _authState==='undefined')return;
  var root=document.getElementById('root');if(!root)return;
  if(_authState==='unknown'){loadAuth();}
  if(_authState==='unknown'||_authState==='checking'){root.innerHTML='<div style="padding:60px;text-align:center">正在验证管理端登录状态…</div>';return;}
  if(_authState==='unavailable'){root.innerHTML='<div style="padding:60px;text-align:center">'+_authEscape(_authError||'认证服务暂时不可用')+'<p><button onclick="loadAuth()">重试</button></p></div>';return;}
  if(!AUTH){root.innerHTML=opsLoginPage();return;}
  if(AUTH.scope!=='admin'){root.innerHTML='<div style="padding:60px;text-align:center"><h2>当前账号无管理权限</h2><p><a href="/">前往政府端</a> <button onclick="logout()">退出并切换账号</button></p></div>';return;}
  if(!window._opsDataReady){
    if(render._opsLoadError){root.innerHTML='<div style="padding:60px;text-align:center">工作区加载失败<p><button onclick="render._opsLoadError=null;render._opsRestored=false;render()">重试</button> <button onclick="logout()">退出登录</button></p></div>';return;}
    root.innerHTML='<div style="padding:60px;text-align:center">正在加载管理数据…</div>';
    if(!render._opsRestored){render._opsRestored=true;restoreFromServer(function(ok){if(!ok)render._opsLoadError='unavailable';render();});}
    return;
  }
  renderOpsV2();
}
function opsRefreshData(){
  if(AUTH&&AUTH.scope==='admin'&&window._opsDataReady)return restoreFromServer(function(ok){
    if(ok){render._opsLoadError='';renderOpsV2();}
    else{render._opsRestored=false;render._opsLoadError='unavailable';render();}
  });
}
render();
if(!window._opsAuthPoll)window._opsAuthPoll=setInterval(opsRefreshData,15000);



/* ══════════════════════════════════════════════════════════════
   管理端 v3 — 工作台、业务、客户、资源分组导航
   ══════════════════════════════════════════════════════════════ */

/* ─ 管理端展示状态：筛选条件只在浏览器中保存，不写业务数据 ─ */
var opsTab = 'overview';
var OPS_ENT = OPS_ENT || [];
var OPS_UI = {invitations:{query:'',status:'all',distribution:'all'},users:{query:'',city:''},reports:{query:'',status:'all'},demands:{query:'',city:'',status:'all'},rag:{tab:'materials'}};
var _opsRenderedTab = null, _opsRenderedScope = null;
var OPS_NAV = [
  {label:'工作台',items:[{id:'overview',icon:'workspace',label:'运营总览'}]},
  {label:'业务管理',items:[{id:'reports',icon:'report',label:'报告任务'},{id:'demands',icon:'demand',label:'招商项目'},{id:'profile',icon:'city',label:'城市画像'},{id:'rag',icon:'city-library',label:'城市智库'}]},
  {label:'客户管理',items:[{id:'invitations',icon:'permissions',label:'邀请码'},{id:'users',icon:'account',label:'注册用户'}]},
  {label:'资源管理',items:[{id:'enterprises',icon:'enterprise',label:'企业资源库'}]}
];
function opsNavItem(id){var found=null;OPS_NAV.forEach(function(g){g.items.forEach(function(t){if(t.id===id)found=t;});});return found;}
function opsGo(tab){if(!opsNavItem(tab))return;opsTab=tab;renderOpsV2();}
function opsHandler(name,value){return _authEscape(name+'('+JSON.stringify(String(value))+')');}
function opsPageHead(title,description,actions){return '<div class="ops-ui-pagehead"><div><div class="ops-ui-eyebrow">管理工作台</div><h1>'+_authEscape(title)+'</h1><p class="ops-ui-subtitle">'+_authEscape(description||'')+'</p></div><div class="ops-ui-actions">'+(actions||'')+'</div></div>';}
function opsDate(value){if(!value)return '—';var date=new Date(value);return isNaN(date.getTime())?'—':date.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
function opsEmpty(title,note,scene){
  var artwork=scene&&typeof opsBrandImage==='function'?opsBrandImage(scene):'';
  return '<div class="ops-ui-empty">'+(artwork?'<img class="ops-brand-empty-visual" src="'+artwork+'" alt="城市研究概念图">':'<div class="ops-brand-empty-icon">'+(typeof opsIcon==='function'?opsIcon('empty',32):'')+'</div>')+'<strong>'+_authEscape(title)+'</strong><p>'+_authEscape(note||'')+'</p></div>';
}
/* Only the server registry identifies a city's primary workspace. Historic
   report stores and same-city projects are never promoted by their labels. */
function opsCityWorkspace(city){
  var map=typeof CITY_WORKSPACES!=='undefined'&&CITY_WORKSPACES;
  if(!map||!Object.prototype.hasOwnProperty.call(map,city))return null;
  var entry=map[city];return entry&&typeof entry==='object'&&typeof entry.projectKey==='string'&&entry.projectKey?entry:null;
}
function opsWorkspaceKind(key){
  var project=PROJECTS[key]||{},city=opsCityWorkspace(project.city);
  if(city&&city.projectKey===key)return '地区主工作区';
  if(/^report_/.test(key))return '历史报告基础库';
  return '旧工作区';
}
function opsWorkspaceMembers(key){
  return Object.keys(USER_PROFILES||{}).filter(function(user){var p=USER_PROFILES[user]||{};return Array.isArray(p.projectKeys)?p.projectKeys.indexOf(key)>=0:p.projKey===key;});
}
function opsMonthlyInfo(city){
  var workspace=opsCityWorkspace(city);if(!workspace)return {label:'未设置月度更新',next:'—',tone:'is-muted'};
  var monthly=(typeof REPORT_REQUESTS!=='undefined'?REPORT_REQUESTS:[]).filter(function(r){return r&&r.city===city&&r.projectKey===workspace.projectKey&&r.autoPublish===true&&/^\d{4}-\d{2}$/.test(r.scheduledMonth||'');}).sort(function(a,b){return String(b.scheduledMonth).localeCompare(String(a.scheduledMonth))||(b.ts||0)-(a.ts||0);})[0];
  var label=workspace.monthlyEnabled?'已启用，等待首轮更新':'已停用',tone='is-muted';
  if(monthly){
    label=monthly.scheduledMonth+' · '+(monthly.publicationSkipped==='newer-report-already-published'?'已有更新版本':monthly.status==='done'?(monthly.pushed?'已更新':'待发布'):({pending:'排队中',running:'生成中',failed:'需处理',blocked:'需处理',cancelled:'已取消'}[monthly.status]||'待处理'));
    tone=monthly.status==='done'&&monthly.pushed?'is-on':['failed','blocked','cancelled'].indexOf(monthly.status)>=0?'is-danger':'is-muted';
  }
  if(!workspace.monthlyEnabled){label='已停用'+(monthly?' · '+label:'');tone='is-muted';}
  var next='—',date=new Date(workspace.nextReportAt);
  if(workspace.monthlyEnabled&&workspace.nextReportAt&&!isNaN(date.getTime()))next=date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})+'（北京时间）';
  return {label:label,next:next,tone:tone};
}
function opsMonthlyCell(city){var info=opsMonthlyInfo(city);return '<span class="ops-ui-badge '+info.tone+'">'+_authEscape(info.label)+'</span><div class="ops-ui-cell-meta">下次：'+_authEscape(info.next)+'</div>';}
function opsFilterChange(section,key,value){if(!OPS_UI[section])return;OPS_UI[section][key]=value;opsRefreshList(section);}
function opsRefreshList(section){
  var targets={invitations:['opsInviteResults',opsInviteResults],users:['opsUserResults',opsUserResults],reports:['opsReportResults',function(){return rrPanel(OPS_UI.reports);}],demands:['opsDemandResults',opsDemandResults]};
  var target=targets[section],el=target&&document.getElementById(target[0]);if(el){var saved=section==='reports'?opsCaptureView():null;el.innerHTML=target[1]();if(typeof opsDecorateBrand==='function')opsDecorateBrand(el);if(saved)opsRestoreView(saved);}
}
/* Keep the active field and unfinished report form intact during the read-only poll. */
function opsCaptureView(){
  var active=document.activeElement,state={focus:null,drafts:[]};
  if(active&&active.id&&/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)&&active.type!=='password'&&active.type!=='file')state.focus={id:active.id,value:active.value,start:active.selectionStart,end:active.selectionEnd};
  var content=document.getElementById('opsContent');
  if(content&&content.querySelectorAll)Array.prototype.forEach.call(content.querySelectorAll('input[id],textarea[id],select[id]'),function(el){if(el.type!=='password'&&el.type!=='file'&&el.id.indexOf('ops')!==0)state.drafts.push({id:el.id,value:el.value,checked:el.checked});});
  return state;
}
function opsRestoreView(state){
  state.drafts.forEach(function(item){var el=document.getElementById(item.id);if(el&&!el.disabled){el.value=item.value;if(el.type==='checkbox'||el.type==='radio')el.checked=item.checked;}});
  if(state.focus){var el=document.getElementById(state.focus.id);if(el&&!el.disabled){el.value=state.focus.value;if(el.focus)el.focus({preventScroll:true});if(el.setSelectionRange&&typeof state.focus.start==='number')try{el.setSelectionRange(state.focus.start,state.focus.end);}catch(_){}}}
}
function renderOpsV2(){
  if(!AUTH||AUTH.scope!=='admin'||!window._opsDataReady){render();return;}
  var root=$('#root');if(!root)return;
  if(document.body&&document.body.classList&&typeof document.body.classList.add==='function')document.body.classList.add('ops-mode');
  if(!opsNavItem(opsTab))opsTab='overview';
  var scope=opsTab==='rag'?'rag:'+String(ragProjKey()||''):opsTab;
  var samePage=_opsRenderedTab===opsTab&&_opsRenderedScope===scope,content=document.getElementById('opsContent');
  var scrollTop=samePage&&content?content.scrollTop:0;
  var saved=samePage?opsCaptureView():null;
  root.innerHTML=opsShell();if(typeof opsDecorateBrand==='function')opsDecorateBrand(root);bind();_opsRenderedTab=opsTab;_opsRenderedScope=scope;
  if(saved)opsRestoreView(saved);
  var next=document.getElementById('opsContent');if(next)next.scrollTop=scrollTop;
}
function opsShell(){
  var pages={overview:opsOverview,reports:opsReports,demands:opsDemands,profile:opsCityProfile,rag:opsRag,invitations:opsInvitations,users:opsUsers,enterprises:opsEnterprises};
  return '<div class="app-shell ops-v3">'+opsTopbarV2()+'<div class="ops-ui-layout">'+opsTabBar()+'<main id="opsContent" class="ops-ui-content" aria-label="'+_authEscape(opsNavItem(opsTab).label)+'">'+pages[opsTab]()+'</main></div></div>';
}
function opsTopbarV2(){
  return '<header class="ops-ui-topbar"><div class="ops-ui-brand">'+opsBrandMark()+'<span>慧小招<span class="ops-ui-brand-caption">城市招商管理工作台</span></span></div><div class="ops-ui-breadcrumb">管理工作台 <span>/</span> <strong>'+_authEscape(opsNavItem(opsTab).label)+'</strong></div><div class="ops-ui-topbar-actions"><label class="ops-ui-operator" title="材料上传时的署名，登录权限由当前管理员账号决定">操作人<input id="opsOperatorInput" value="'+_authEscape(getOpsOperator())+'" placeholder="填写署名" onchange="setOpsOperator(this.value)"></label><button class="ops-ui-button" onclick="logout()">'+opsIcon('logout',16)+'退出登录</button></div></header>';
}
/* 当前操作人显示名独立于服务端认证，"当前操作人"是本地轻量设置（localStorage持久化），
   随每次上传/入库写进 chunk.account，供 ragOriginStyle() 展示具体是谁上传的材料。
   不是真正的账号鉴权，只是一个自报家门的标签——足够解决"避免误判材料来源"这个
   展示层需求；操作权限仍完全由服务端登录态决定。 */
var OPS_OPERATOR_KEY='huixiaozhao_ops_operator';
function getOpsOperator(){
  try{ return localStorage.getItem(OPS_OPERATOR_KEY)||''; }catch(e){ return ''; }
}
function setOpsOperator(name){
  name=(name||'').trim();
  try{ localStorage.setItem(OPS_OPERATOR_KEY, name); }catch(e){}
}

function opsTabBar(){
  return '<nav class="ops-ui-sidebar" aria-label="管理端导航">'+OPS_NAV.map(function(group){return '<div class="ops-ui-nav-group"><div class="ops-ui-nav-label">'+group.label+'</div>'+group.items.map(function(item){var active=opsTab===item.id;return '<button class="ops-ui-nav-button'+(active?' is-active':'')+'"'+(active?' aria-current="page"':'')+' onclick="'+opsHandler('opsGo',item.id)+'"><span class="ops-ui-nav-icon" aria-hidden="true">'+opsIcon(item.icon,20)+'</span><span>'+item.label+'</span></button>';}).join('')+'</div>';}).join('')+'</nav>';
}


/* ══ Tab: 城市智库 RAG（材料·检索·推送日志）══ */
var ragCity=null, ragTopic=0, ragQuery='', ragHits=null, ragLog=null, ragFilter='';
var ragOverviewOpen=false; // 默认聚焦当前工作区，可展开查看所有独立工作区
// 对话更新 RAG：多轮消息 [{role,content}]；ragChatPending=可入库的最近一条 AI 结论草稿
var ragChatMsgs=[],ragChatBusy=false,ragChatPending=null,ragChatWorkspace=null,ragChatEpoch=0,ragChatHint='';
function ragResetChat(key,notice){
  ragChatEpoch=(ragChatEpoch||0)+1;ragChatWorkspace=key||null;ragChatMsgs=[];ragChatBusy=false;ragChatPending=null;
  ragChatHint=notice?'已切换工作区，上一个工作区的对话已清空。':'';
}
function ragEnsureChatWorkspace(key){if(ragChatWorkspace!==key)ragResetChat(key,!!ragChatWorkspace);}
function ragClearChat(){ragResetChat(ragChatWorkspace,false);renderOpsV2();}
function ragCanCommitMessage(message,key){return !!message&&message.role==='assistant'&&!message.streaming&&!!message.content&&message.workspaceKey===key&&ragChatWorkspace===key&&ragProjKey()===key&&ragChatMsgs.indexOf(message)>=0;}

/* 工作区总览与下拉框保留准确来源，只有服务端登记的项目是地区主工作区。 */
function ragSelectWorkspace(key){ragCity=key;ragTopic=0;ragHits=null;renderOpsV2();}
function ragWorkspaceOverview(activeKey){
  var keys=Object.keys(PROJECTS).filter(function(k){var p=PROJECTS[k];return p&&Array.isArray(p.kb);});
  if(keys.length<=1)return '';
  var byCity=Object.create(null);
  keys.forEach(function(k){var c=PROJECTS[k].city||k;(byCity[c]=byCity[c]||[]).push(k);});
  var rows=Object.keys(byCity).sort().map(function(city){
    var workspace=opsCityWorkspace(city);
    var items=byCity[city].map(function(key){
      var p=PROJECTS[key],count=(p.kb||[]).reduce(function(n,t){return n+(t.known||[]).length;},0),isOn=key===activeKey;
      return '<button class="ops-ui-recent-row" onclick="'+opsHandler('ragSelectWorkspace',key)+'"'+(isOn?' aria-current="true"':'')+'><span><strong>'+_authEscape(opsWorkspaceKind(key))+'</strong><small>'+_authEscape(key)+'</small></span><span>'+count+' 条材料</span></button>';
    }).join('');
    return '<section class="ops-ui-card" style="margin-bottom:10px"><div class="ops-ui-card-head"><h2>'+_authEscape(city)+'</h2><span class="ops-ui-muted">'+(workspace?'已设置地区主工作区':'未设置地区主工作区')+'</span></div>'+items+'</section>';
  }).join('');
  return '<div class="ops-ui-card" style="margin-bottom:16px"><button class="ops-ui-button" onclick="ragOverviewOpen=!ragOverviewOpen;renderOpsV2()">工作区与报告来源 · '+keys.length+' 项'+(ragOverviewOpen?' ▴':' ▾')+'</button>'+(ragOverviewOpen?'<div style="margin-top:12px;max-height:320px;overflow-y:auto">'+rows+'</div>':'')+'</div>';
}
function ragProjKey(){
  // 【2026-09-18】放宽：原来要求 kb 里已有材料，导致「＋新增城市」建的空城市
  // 会在下面 keys.indexOf(ragCity) 处被踢回旧城市，新城市切不进去也传不了材料。
  // 只要有 kb 数组结构就算有效城市；默认选中仍优先已初始化/材料多的项目（见下 sort）。
  var keys=Object.keys(PROJECTS).filter(function(k){var p=PROJECTS[k];return p&&Array.isArray(p.kb);});
  if(!keys.length) return null;
  if(!ragCity||keys.indexOf(ragCity)<0){
    // 默认优先：流水线初始化过的项目(kbInitTs) > 材料量最大的项目
    var best=keys.slice().sort(function(a,b){
      var pa=PROJECTS[a],pb=PROJECTS[b];
      var ma=opsWorkspaceKind(a)==='地区主工作区'?1:0,mb=opsWorkspaceKind(b)==='地区主工作区'?1:0;if(ma!==mb)return mb-ma;
      var ia=pa.kbInitTs?1:0, ib=pb.kbInitTs?1:0;
      if(ia!==ib) return ib-ia;
      var ca=pa.kb.reduce(function(s,t){return s+(t.known||[]).length;},0);
      var cb=pb.kb.reduce(function(s,t){return s+(t.known||[]).length;},0);
      return cb-ca;
    })[0];
    ragCity=best;
  }
  return keys.indexOf(ragCity)>=0?ragCity:keys[0];
}
function ragCityOptions(){
  var activeKey=ragProjKey();
  return Object.keys(PROJECTS).filter(function(key){return PROJECTS[key]&&Array.isArray(PROJECTS[key].kb);}).sort(function(a,b){var x=PROJECTS[a].city||a,y=PROJECTS[b].city||b;return x.localeCompare(y)||a.localeCompare(b);}).map(function(key){var p=PROJECTS[key],count=p.kb.reduce(function(n,t){return n+(t.known||[]).length;},0);return '<option value="'+_authEscape(key)+'"'+(key===activeKey?' selected':'')+'>'+_authEscape((p.city||key)+' · '+opsWorkspaceKind(key)+' · '+key+' · '+count+' 条材料')+'</option>';}).join('');
}
function opsRagSelectTab(tab){if(['materials','upload','query','history'].indexOf(tab)<0)return;OPS_UI.rag.tab=tab;renderOpsV2();}
function opsRag(){
  var key=ragProjKey();ragEnsureChatWorkspace(key);
  var actions='<button class="ops-ui-button is-primary" onclick="ragAddCityModal()">＋ 设置地区工作区</button>';
  var head=opsPageHead('城市智库','按工作区维护材料、补充事实和核对检索结果。',actions);
  if(!key)return '<div class="ops-ui-page">'+head+opsEmpty('暂无已初始化的城市智库','先设置地区主工作区与邀请码，再上传材料或生成城市报告。','research')+'</div>';
  var p=PROJECTS[key],total=p.kb.reduce(function(n,t){return n+(t.known||[]).length;},0),rs=REPORTSTATE[key]||{};
  var current=OPS_UI.rag.tab;
  var tabs=[['materials','材料浏览'],['upload','上传补充'],['query','检索问答'],['history','版本与日志']];
  var tabbar='<div class="ops-ui-subnav" role="group" aria-label="智库功能">'+tabs.map(function(tab){return '<button class="ops-ui-subnav-button'+(current===tab[0]?' is-active':'')+'" aria-pressed="'+(current===tab[0]?'true':'false')+'" onclick="'+opsHandler('opsRagSelectTab',tab[0])+'">'+tab[1]+'</button>';}).join('')+'</div>';
  var body=current==='materials'?ragBaseVsSupportLayout(p,key):current==='upload'?ragUploadPanel(p,key):current==='query'?ragSearchBox()+ragChatBox(p,key):ragVersionPanel(p,key)+ragPushLog();
  return '<div class="ops-ui-page">'+head+'<div class="ops-ui-workspacebar"><label class="ops-ui-filter">当前工作区<select id="opsRagWorkspace" onchange="ragCity=this.value;ragTopic=0;ragHits=null;renderOpsV2()">'+ragCityOptions()+'</select></label><span class="ops-ui-muted">'+_authEscape(opsWorkspaceKind(key))+' · '+_authEscape(p.org||'未填写单位')+' · 初始化于 '+opsDate(p.kbInitTs)+'</span></div>'+ragWorkspaceOverview(key)+'<div class="ops-ui-metric-grid">'+ragStatCard('<span data-ops-icon="resource"></span>','智库材料',total+' 条','当前工作区')+ragStatCard('<span data-ops-icon="folder"></span>','主题分区',p.kb.length+' 个','材料按主题整理')+ragStatCard('<span data-ops-icon="document"></span>','研判报告',rs.text?Math.round(rs.text.length/100)/10+'k 字':'未生成',rs.finalized?'已定稿 · 政府端可见':'')+ragStatCard('<span data-ops-icon="traceability"></span>','历史版本',(p.kbVersions||[]).length+' 版','可在版本与日志中查看')+'</div>'+tabbar+'<section class="ops-ui-section">'+body+'</section></div>';
}
/* 城市入口与邀请码共用服务端创建逻辑，不能在浏览器另造同城主工作区。 */
function ragAddCityModal(){openInviteCodeModal();}
function ragDoAddCity(){return doGenerateInviteCode();}

/* ── 接口1 UI：管理员上传文件补充/修正（极简：选文件+主题+性质）── */
function ragUploadPanel(p,key){
  var topicOpts=(p.kb||[]).map(function(t){return '<option value="'+t.t.replace(/"/g,'')+'">'+t.t+'</option>';}).join('')+
    '<option value="__new__">＋ 新建主题</option>';
  var uploads=(p.kbUploads||[]).slice().reverse().slice(0,3);
  var log=uploads.length?('<div style="margin-top:9px;font-size:11px;color:#8492a6;line-height:1.7">'+
    uploads.map(function(u){var t=new Date(u.ts);var nt=u.nature==='fix'?'<span data-ops-icon="warning" data-ops-icon-size="12"></span> 修正':'<span data-ops-icon="success" data-ops-icon-size="12"></span> 佐证';return nt+' '+u.filename+' → '+u.topic+'（+'+u.chunks+'条）';}).join('<br>')+'</div>'):'';
  return '<div style="border:1px solid #e3ebf6;border-radius:10px;background:#fff;padding:14px 16px">'+
    '<div style="font-size:13px;font-weight:700;color:#0b183b;margin-bottom:4px"><span data-ops-icon="attachment"></span> 上传文件 · 补充 / 修正</div>'+
    '<div style="font-size:11px;color:#8492a6;margin-bottom:11px">选择文件即可，AI 自动切分入库；佐证=绿色追加，修正=黄色覆盖</div>'+
    '<div style="display:flex;gap:8px;margin-bottom:9px">'+
      '<select id="ragUpTopic" style="flex:1;min-height:38px;padding:4px 9px;border:1px solid #d8e0ed;border-radius:7px;font-size:12px">'+topicOpts+'</select>'+
      '<select id="ragUpNature" style="flex:0 0 118px;min-height:38px;padding:4px 9px;border:1px solid #d8e0ed;border-radius:7px;font-size:12px"><option value="support">🟢 佐证补充</option><option value="fix">🟡 修正覆盖</option></select>'+
    '</div>'+
    '<label id="ragDrop" style="display:flex;align-items:center;justify-content:center;gap:8px;min-height:60px;border:1.5px dashed #b9cbe4;border-radius:9px;background:#f8fbff;color:#5a7398;font-size:12.5px;cursor:pointer">'+
      '<span style="font-size:18px"><span data-ops-icon="folder"></span></span><span id="ragUpFileName">点击选择文件（.pdf / .docx / .txt / .md / .csv）</span>'+
      '<input type="file" id="ragUpFile" accept=".pdf,.docx,.txt,.md,.csv" onchange="ragReadFile(this,\''+key+'\')" style="display:none"></label>'+
    log+'</div>';
}
function ragReadFile(inp,key){
  var epoch=originalUploadEpoch();
  var f=inp.files&&inp.files[0];if(!f)return;
  if(f.size>20*1024*1024){toast('单个文件不能超过 20MB');return;}
  var nm=document.getElementById('ragUpFileName');if(nm)nm.textContent='正在读取：'+f.name;
  var rb=new FileReader();
  rb.onload=function(){if(!originalUploadSessionCurrent(epoch))return;ragDoUpload(key,null,f.name,String(rb.result||'').split(',')[1]||'',epoch);};
  rb.onerror=function(){if(originalUploadSessionCurrent(epoch))toast('文件读取失败');};
  rb.readAsDataURL(f);
}
function ragDoUpload(key, text, name, fileB64, epoch){
  if(epoch===undefined)epoch=originalUploadEpoch();
  if(!originalUploadSessionCurrent(epoch))return;
  var bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
  var uploadId=Array.from(bytes).map(function(b){return ('0'+b.toString(16)).slice(-2);}).join('');
  var topic=(document.getElementById('ragUpTopic')||{}).value||'';
  var nature=(document.getElementById('ragUpNature')||{}).value||'support';
  if(!fileB64 && (!text||!text.trim())){toast&&toast('文件内容为空');return;}
  var p=PROJECTS[key];if(!p)return;
  var restLabel='点击选择文件（.pdf / .docx / .txt / .md / .csv）';
  function send(finalTopic){
    if(!originalUploadSessionCurrent(epoch))return;
    var mode=nature==='fix'?'replace':'append';
    var nm=document.getElementById('ragUpFileName'); if(nm)nm.textContent='正在解析入库…';
    var payload={projectKey:key,city:p.city,topic:finalTopic,filename:name||'上传文件',
        mode:mode,origin:'admin',nature:nature,by:(getOpsOperator()||'管理端'),source:'file'};
    if(fileB64){ payload.fileB64=fileB64;payload.uploadId=uploadId; } else { payload.text=text; }
    fetch('/api/kb-upload',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)})
      .then(function(r){return r.json();}).then(function(res){
        if(!originalUploadSessionCurrent(epoch))return;
        if(res.ok){
          var extra=res.matched?('，命中已有 '+res.matched+' 条'):'';
          toast&&toast('已入库 '+res.chunks+' 条（'+(nature==='fix'?'修正':'佐证')+'）'+extra);
          restoreFromServer(function(){if(originalUploadSessionCurrent(epoch))renderOpsV2();});
        }
        else{toast&&toast('上传失败：'+(res.message||res.error||''));if(nm)nm.textContent=restLabel;}
      }).catch(function(e){if(!originalUploadSessionCurrent(epoch))return;toast&&toast('上传出错');if(nm)nm.textContent=restLabel;});
  }
  // 新建主题：用页面内 modal 取名（不使用原生 prompt）
  if(topic==='__new__'){
    ragCommitModal({key:key,city:p.city,topics:(p.kb||[]).map(function(t){return t.t;}),
      defaultTopic:'__new__',preview:(text||name||''),
      onConfirm:function(finalTopic,finalNature){if(!originalUploadSessionCurrent(epoch))return; nature=finalNature||nature; send(finalTopic||'管理员补充资料'); }});
  } else {
    send(topic);
  }
}
/* ── 接口2 UI：版本管理（时间线快照+回滚）── */
function ragVersionPanel(p,key){
  var vers=(p.kbVersions||[]).slice().reverse();
  var curTot=(p.kb||[]).reduce(function(s,t){return s+(t.known||[]).length;},0);
  var rows=vers.length?vers.map(function(v){
    var t=new Date(v.ts);var tm=(t.getMonth()+1)+'/'+t.getDate()+' '+t.getHours()+':'+('0'+t.getMinutes()).slice(-2);
    return '<div style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:7px;border-bottom:1px solid #f2f5f9" onmouseover="this.style.background=\'#f6faff\'" onmouseout="this.style.background=\'transparent\'">'+
      '<span style="flex:0 0 auto;padding:2px 7px;border-radius:9px;background:#ebf3fd;color:#013582;font-size:10px;font-weight:600">v'+v.ver+'</span>'+
      '<span style="font-size:11px;color:#40506a;flex:1">'+tm+(v.label?' · '+v.label:'')+' · '+v.chunks+' 条</span>'+
      '<button onclick="ragRollback(\''+key+'\','+v.ver+')" style="border:1px solid #d8e0ed;background:#fff;color:#0757ad;border-radius:6px;font-size:10.5px;cursor:pointer;padding:3px 9px">回滚到此版本</button></div>';
  }).join(''):'<div style="font-size:11.5px;color:#9aa5b5;padding:8px 0">暂无历史版本 —— 每次重新研判会自动存一版</div>';
  return '<div style="border:1px solid #e3ebf6;border-radius:10px;background:#fff;padding:14px 16px">'+
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'+
      '<div style="font-size:13px;font-weight:700;color:#0b183b"><span data-ops-icon="traceability"></span> 版本历史</div>'+
      '<button onclick="ragSnapshot(\''+key+'\')" style="margin-left:auto;border:1px solid #bfe5e0;background:#e4f5f3;color:#006d70;border-radius:6px;font-size:10.5px;cursor:pointer;padding:4px 10px"><span data-ops-icon="traceability"></span> 存当前为快照</button></div>'+
    '<div style="font-size:11px;color:#8492a6;margin-bottom:10px">同一城市多次研判按时间留存；可随时回滚到任一历史版本（当前 '+curTot+' 条）</div>'+
    '<div style="max-height:180px;overflow:auto">'+rows+'</div></div>';
}
function ragSnapshot(key){
  var p=PROJECTS[key];var label=prompt('为当前版本加个标注（可选，如：8月政策更新前）：','')||'';
  fetch('/api/kb-version',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'snapshot',projectKey:key,city:p.city,label:label})})
    .then(function(r){return r.json();}).then(function(res){
      if(res.ok){toast&&toast('已存为 v'+res.ver);restoreFromServer(function(){renderOpsV2();});}
      else{toast&&toast('快照失败：'+(res.error||''));}
    });
}
function ragRollback(key,ver){
  var p=PROJECTS[key];
  if(!confirm('确定回滚「'+p.city+'」智库到 v'+ver+'？当前版本会被覆盖（建议先存快照）。'))return;
  fetch('/api/kb-version',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'rollback',projectKey:key,city:p.city,ver:ver})})
    .then(function(r){return r.json();}).then(function(res){
      if(res.ok){toast&&toast('已回滚到 v'+ver);restoreFromServer(function(){renderOpsV2();});}
      else{toast&&toast('回滚失败：'+(res.error||''));}
    });
}
function ragStatCard(ic,label,val,sub){
  return '<div style="border:1px solid #e3ebf6;border-radius:10px;background:#fff;padding:14px 16px">'+
    '<div style="font-size:12px;color:#8492a6;display:flex;align-items:center;gap:6px"><span>'+ic+'</span>'+label+'</div>'+
    '<div style="font-size:20px;font-weight:750;color:#0b183b;margin:6px 0 2px">'+val+'</div>'+
    '<div style="font-size:11px;color:#9aa5b5">'+(sub||'')+'</div></div>';
}

function ragEsc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function ragSearchBox(){
  return '<div style="border:1px solid #e3ebf6;border-radius:10px;background:#fff;padding:14px 16px">'+
    '<div style="display:flex;gap:10px;align-items:center">'+
      '<input id="ragQ" value="'+(ragQuery||'').replace(/"/g,'&quot;')+'" placeholder="检索验证：输入问题，看 RAG 实际召回哪些材料（如：工业用地价格 / 氢能补链）" '+
        'onkeydown="if(event.key===\'Enter\')ragDoSearch()" '+
        'style="flex:1;min-height:40px;padding:8px 12px;border:1px solid #d8e0ed;border-radius:8px;font-size:13px">'+
      '<button class="primary-button" style="min-height:40px" onclick="ragDoSearch()">检索测试</button>'+
      (ragHits?'<button class="ghost-button" style="min-height:40px" onclick="ragHits=null;ragQuery=\'\';renderOpsV2()">清除</button>':'')+
    '</div>'+(ragHits?ragHitsView():'')+'</div>';
}
/* Keep original items for source/annotation rendering; index only plain text. */
function ragItemText(item){
  var value=item&&typeof item==='object'?item.text:item;
  return typeof value==='string'?value:(typeof value==='number'||typeof value==='boolean'?String(value):'');
}
function ragDoSearch(){
  var q=(document.getElementById('ragQ')||{}).value||'';
  if(!q.trim())return;
  ragQuery=q;
  var key=ragProjKey(), p=PROJECTS[key];
  var corpus=[];
  (p&&Array.isArray(p.kb)?p.kb:[]).forEach(function(t){
    if(!t)return;
    var topic=ragItemText(t.t);
    (Array.isArray(t.known)?t.known:[]).forEach(function(item,i){
      var annotations=item&&Array.isArray(item.annotations)?item.annotations:[];
      var text=[ragItemText(item)].concat(annotations.map(ragItemText)).filter(Boolean).join('\n');
      corpus.push({id:topic+':'+i,topic:topic,tags:[],text:text,cite:topic,item:item});
    });
  });
  var hits=[];
  try{ hits=(typeof kbSearch==='function')?(kbSearch(q,corpus,8)||[]):[]; }catch(e){ hits=[]; }
  if(!hits.length){
    var terms=q.trim().split(/\s+/);
    hits=corpus.map(function(c){var s=0;terms.forEach(function(t){if(c.text.indexOf(t)>=0)s+=2;if(c.topic.indexOf(t)>=0)s+=1;});return{c:c,s:s};})
      .filter(function(x){return x.s>0;}).sort(function(a,b){return b.s-a.s;}).slice(0,8).map(function(x){return x.c;});
  }
  ragHits=hits;
  renderOpsV2();
}
function ragHitsView(){
  if(!ragHits.length) return '<div style="margin-top:12px;padding:12px;background:#fff5e9;border:1px solid #efcfaa;border-radius:8px;font-size:12.5px;color:#7a4a1f">未召回任何材料 —— 该问题在当前智库中没有覆盖，政府端问这个问题时 AI 只能靠通用知识回答（幻觉风险），建议补充相关材料。</div>';
  var qTerms=ragQuery.trim();
  return '<div style="margin-top:12px">'+
    '<div style="font-size:12px;color:#667590;margin-bottom:8px">「'+ragEsc(ragQuery)+'」召回 <b style="color:#0757ad">'+ragHits.length+'</b> 条材料（按相关度排序，即政府端提问时喂给 AI 的上下文）：</div>'+
    ragHits.map(function(h,i){
      var card=ragRenderChunk(Object.prototype.hasOwnProperty.call(h,'item')?h.item:h.text,i+1,qTerms);
      // 前3名加蓝框+主题标；其余灰
      var head='<div style="display:flex;gap:8px;align-items:center;margin:0 0 4px 24px">'+
        '<span style="font-size:10px;font-weight:700;color:#fff;background:'+(i<3?'#0757ad':'#9aa5b5')+';border-radius:8px;padding:1px 7px">TOP '+(i+1)+'</span>'+
        '<span style="font-size:11px;color:#0757ad">'+ragEsc(h.topic)+'</span></div>';
      return '<div style="'+(i<3?'border-left:3px solid #0757ad;padding-left:8px;margin-bottom:2px':'padding-left:11px')+'">'+head+card+'</div>';
    }).join('')+'</div>';
}
/* ── 对话更新 RAG：与 AI 就该城市智库对话，认可某条结论后「加入智库」显式落库 ── */
function ragChatBox(p,key){
  var msgs=ragChatMsgs.map(function(m,i){
    if(m.workspaceKey!==key)return '';
    if(m.role==='user'){
      return '<div style="display:flex;justify-content:flex-end;margin:6px 0"><div style="max-width:78%;background:#0757ad;color:#fff;border-radius:12px 12px 2px 12px;padding:8px 12px;font-size:12.5px;line-height:1.6;white-space:pre-wrap">'+ragEsc(m.content)+'</div></div>';
    }
    var canAdd=ragCanCommitMessage(m,key);
    var addBtn=canAdd?('<div style="margin-top:6px"><button onclick="ragChatCommit('+i+','+_authEscape(JSON.stringify(key))+')" style="border:1px solid #bfe5e0;background:#e4f5f3;color:#006d70;border-radius:6px;font-size:11px;cursor:pointer;padding:4px 11px">＋ 把这条结论加入智库</button></div>'):'';
    return '<div style="display:flex;justify-content:flex-start;margin:6px 0"><div style="max-width:82%;background:#f4f7fc;color:#1e2a44;border-radius:12px 12px 12px 2px;padding:8px 12px;font-size:12.5px;line-height:1.7;white-space:pre-wrap">'+ragEsc(m.content||(m.streaming?'…':''))+addBtn+'</div></div>';
  }).join('');
  var body=ragChatMsgs.length?msgs:'<div style="color:#9aa5b5;font-size:12px;text-align:center;padding:22px 8px;line-height:1.7">与 AI 讨论该城市智库，补充或修正事实。<br>认可某条结论后，点「加入智库」即可显式落库（可控、留痕）。</div>';
  return '<div style="border:1px solid #e3ebf6;border-radius:10px;background:#fff;padding:14px 16px;margin-top:14px">'+
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'+
      '<div style="font-size:13px;font-weight:700;color:#0b183b"><span data-ops-icon="comment"></span> 对话更新智库</div>'+
      '<span style="font-size:11px;color:#8492a6">基于当前智库对话，确认结论后入库</span>'+
      (ragChatMsgs.length?'<button onclick="ragClearChat()" style="margin-left:auto;border:1px solid #d8e0ed;background:#fff;color:#5a7398;border-radius:6px;font-size:11px;cursor:pointer;padding:3px 10px">清空对话</button>':'')+
    '</div>'+
    (ragChatHint?'<p class="ops-ui-muted" role="status">'+_authEscape(ragChatHint)+'</p>':'')+
    '<div id="ragChatScroll" style="max-height:280px;overflow:auto;padding:2px 2px 6px">'+body+'</div>'+
    '<div style="display:flex;gap:8px;margin-top:8px">'+
      '<input id="ragChatIn" placeholder="例：产业链缺口有哪些？该市规上工业企业最新数是多少？" '+
        'onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();ragChatSend('+_authEscape(JSON.stringify(key))+');}" '+
        (ragChatBusy?'disabled ':'')+'style="flex:1;min-height:40px;padding:8px 12px;border:1px solid #d8e0ed;border-radius:8px;font-size:13px'+(ragChatBusy?';background:#f4f6f9':'')+'">'+
      '<button class="primary-button" style="min-height:40px" '+(ragChatBusy?'disabled':'')+' onclick="ragChatSend('+_authEscape(JSON.stringify(key))+')">'+(ragChatBusy?'生成中…':'发送')+'</button>'+
    '</div></div>';
}
function ragChatScrollBottom(){ var el=document.getElementById('ragChatScroll'); if(el)el.scrollTop=el.scrollHeight; }
function ragChatSend(key){
  if(key!==ragProjKey()||!PROJECTS[key])return;
  ragEnsureChatWorkspace(key);
  if(ragChatBusy)return;
  var inp=document.getElementById('ragChatIn');var q=inp?(inp.value||'').trim():'';
  if(!q)return;
  var p=PROJECTS[key],requestEpoch=++ragChatEpoch;
  function current(){return requestEpoch===ragChatEpoch&&ragChatWorkspace===key&&ragProjKey()===key;}
  var corpus=[];
  (p.kb||[]).forEach(function(t){(t.known||[]).forEach(function(txt,i){var s=(txt&&typeof txt==='object')?(txt.text||''):txt;corpus.push({id:t.t+':'+i,topic:t.t,text:s,cite:t.t});});});
  ragChatMsgs.push({role:'user',content:q,workspaceKey:key});
  var aiMsg={role:'assistant',content:'',streaming:true,workspaceKey:key};ragChatMsgs.push(aiMsg);
  ragChatBusy=true;ragChatHint='';renderOpsV2();ragChatScrollBottom();
  var hist=ragChatMsgs.filter(function(m){return m.workspaceKey===key&&m.content&&!m.streaming;}).slice(-8).map(function(m){return {role:m.role,content:m.content};});
  return fetch('/api/kb-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q,chunks:corpus,city:p.city,mode:'chat',stream:true,history:hist})})
    .then(function(resp){
      if(!current())return;
      if(!resp.ok||!resp.body)throw new Error('HTTP '+resp.status);
      var reader=resp.body.getReader(),dec=new TextDecoder(),buf='';
      function stale(){
        if(current())return false;
        try{var cancelled=reader.cancel&&reader.cancel();if(cancelled&&cancelled.catch)cancelled.catch(function(){});}catch(_){}
        return true;
      }
      function pump(){
        if(stale())return;
        return reader.read().then(function(r){
          if(stale())return;
          if(r.done){aiMsg.streaming=false;ragChatBusy=false;renderOpsV2();ragChatScrollBottom();return;}
          buf+=dec.decode(r.value,{stream:true});
          var lines=buf.split('\n');buf=lines.pop();
          lines.forEach(function(line){
            if(!current())return;
            line=line.trim();if(line.indexOf('data:')!==0)return;
            var d=line.slice(5).trim();if(!d||d==='[DONE]')return;
            try{var j=JSON.parse(d),delta=((j.choices||[{}])[0].delta||{}).content||'';if(delta&&current()){aiMsg.content+=delta;renderOpsV2();ragChatScrollBottom();}}catch(_){}
          });
          return pump();
        });
      }
      return pump();
    }).catch(function(e){if(!current())return;aiMsg.streaming=false;aiMsg.content=(aiMsg.content||'')+'\n[生成失败：'+e.message+']';ragChatBusy=false;renderOpsV2();});
}
function ragChatCommit(msgIdx, key){
  var m=ragChatMsgs[msgIdx];if(!ragCanCommitMessage(m,key)){if(typeof toast==='function')toast('工作区已变化，请在当前工作区重新确认结论。');return;}
  var p=PROJECTS[key];
  // 用页面内 modal 替代 prompt/confirm（嵌入式浏览器不支持原生弹窗）
  ragCommitModal({
    key:key, city:p.city, topics:(p.kb||[]).map(function(t){return t.t;}),
    defaultTopic:((p.kb||[])[ragTopic]||{}).t||'对话补充',
    preview:m.content,
    onConfirm:function(topic,nature){
      if(!ragCanCommitMessage(m,key)){if(typeof toast==='function')toast('工作区已变化，原结论未写入，请重新确认。');return;}
      var mode=nature==='fix'?'replace':'append';
      fetch('/api/kb-upload',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({projectKey:key,city:p.city,topic:topic,text:m.content,
          filename:'对话确认',mode:mode,origin:'admin',nature:nature,by:(getOpsOperator()||'管理端'),source:'chat'})})
        .then(function(r){return r.json();}).then(function(res){
          if(res.ok){
            var extra=res.matched?('，命中已有 '+res.matched+' 条'):'';
            toast&&toast('已加入智库 '+res.chunks+' 条（'+(nature==='fix'?'修正':'佐证')+'）'+extra);
            m.committed=true;
            restoreFromServer(function(){renderOpsV2();});
          } else { toast&&toast('入库失败：'+(res.error||'')); }
        }).catch(function(e){toast&&toast('入库出错');});
    }
  });
}
/* ── 通用入库确认弹窗（自建 modal，不依赖 window.prompt/confirm）── */
function ragCommitModal(opt){
  var old=document.getElementById('ragCommitModal'); if(old)old.parentNode.removeChild(old);
  var topics=opt.topics||[]; var def=opt.defaultTopic||topics[0]||'对话补充';
  var newVal='__new__';
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  var opts=topics.map(function(t){return '<option value="'+esc(t)+'"'+(t===def?' selected':'')+'>'+esc(t)+'</option>';}).join('')+
    '<option value="'+newVal+'">＋ 新建主题…</option>';
  var prev=(opt.preview||'').slice(0,140)+((opt.preview||'').length>140?'…':'');
  var wrap=document.createElement('div');
  wrap.id='ragCommitModal';
  wrap.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(10,20,40,.42);display:flex;align-items:center;justify-content:center';
  wrap.innerHTML=
    '<div style="width:440px;max-width:92vw;background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.28);padding:20px 22px">'+
      '<div style="font-size:15px;font-weight:750;color:#0b183b;margin-bottom:4px">加入「'+esc(opt.city)+'」城市智库</div>'+
      '<div style="font-size:12px;color:#8492a6;margin-bottom:12px">确认目标主题与入库性质，确认后写入 RAG 库（问答时可被检索命中）</div>'+
      (prev?'<div style="font-size:12px;color:#40506a;background:#f4f7fc;border:1px solid #e3ebf6;border-radius:8px;padding:8px 10px;margin-bottom:12px;max-height:78px;overflow:auto;line-height:1.6">'+esc(prev)+'</div>':'')+
      '<div style="font-size:12px;font-weight:600;color:#40506a;margin-bottom:5px">目标主题</div>'+
      '<select id="ragCmTopic" onchange="ragCmToggleNew()" style="width:100%;min-height:38px;padding:6px 10px;border:1px solid #d8e0ed;border-radius:8px;font-size:13px;margin-bottom:8px">'+opts+'</select>'+
      '<input id="ragCmNewTopic" placeholder="输入新主题名称" style="display:none;width:100%;min-height:38px;padding:6px 10px;border:1px solid #d8e0ed;border-radius:8px;font-size:13px;margin-bottom:10px;box-sizing:border-box">'+
      '<div style="font-size:12px;font-weight:600;color:#40506a;margin:6px 0 5px">入库性质</div>'+
      '<div style="display:flex;gap:10px;margin-bottom:16px">'+
        '<label style="flex:1;display:flex;align-items:center;gap:6px;border:1px solid #bfe5e0;background:#f2fbf9;border-radius:8px;padding:8px 10px;font-size:12.5px;cursor:pointer"><input type="radio" name="ragCmNature" value="support" checked><span data-ops-icon="success"></span> 佐证补充（追加）</label>'+
        '<label style="flex:1;display:flex;align-items:center;gap:6px;border:1px solid #f0d99a;background:#fffaf0;border-radius:8px;padding:8px 10px;font-size:12.5px;cursor:pointer"><input type="radio" name="ragCmNature" value="fix"><span data-ops-icon="warning"></span> 修正覆盖</label>'+
      '</div>'+
      '<div style="display:flex;justify-content:flex-end;gap:10px">'+
        '<button onclick="ragCmClose()" style="border:1px solid #d8e0ed;background:#fff;color:#5a7398;border-radius:8px;font-size:13px;cursor:pointer;padding:8px 16px">取消</button>'+
        '<button onclick="ragCmSubmit()" class="primary-button" style="min-height:38px">确认加入</button>'+
      '</div>'+
    '</div>';
  wrap.addEventListener('click',function(e){if(e.target===wrap)ragCmClose();});
  document.body.appendChild(wrap);
  if(typeof opsDecorateBrand==='function')opsDecorateBrand(wrap);
  window.__ragCmOnConfirm=opt.onConfirm;
}
function ragCmToggleNew(){
  var sel=document.getElementById('ragCmTopic'), inp=document.getElementById('ragCmNewTopic');
  if(!sel||!inp)return;
  if(sel.value==='__new__'){inp.style.display='block';inp.focus();}else{inp.style.display='none';}
}
function ragCmClose(){var w=document.getElementById('ragCommitModal');if(w)w.parentNode.removeChild(w);window.__ragCmOnConfirm=null;}
function ragCmSubmit(){
  var sel=document.getElementById('ragCmTopic');
  var topic=sel?sel.value:'';
  if(topic==='__new__'){topic=((document.getElementById('ragCmNewTopic')||{}).value||'').trim();
    if(!topic){toast&&toast('请填写新主题名称');return;}}
  var nature='support';
  var r=document.querySelectorAll('input[name="ragCmNature"]');
  for(var i=0;i<r.length;i++){if(r[i].checked)nature=r[i].value;}
  var cb=window.__ragCmOnConfirm; ragCmClose();
  if(typeof cb==='function')cb(topic,nature);
}
/* 【2026-09-29】管理端左右结构布局：左=城市基础包(nature=base，只读，独立报告流程
   产出)，右=按账号分组的补充材料(support/interview/fix)。取代原来"主题导航+材料列表"
   混合展示——那种视图分不清一条材料是流水线基础研判还是某个账号自己补的，也看不出
   到底是谁补的。左侧完全只读；右侧脱离主题概念，平铺该工作区全部补充材料按账号分组。*/
function ragBaseVsSupportLayout(p,key){
  var base=getCityBasePackage(p.city);
  var baseHtml=!base?
    '<div style="padding:24px 16px;text-align:center;color:#9aa5b5;font-size:12.5px">'+
      '该城市还没有基础包<br>请先在「报告任务」生成并发布报告，再为城市配置基础包。'+
    '</div>':
    base.map(function(t){
      return '<div style="padding:10px 14px;border-bottom:1px solid #eef2f7">'+
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">'+
          '<span style="font-size:13px">'+t.icon+'</span>'+
          '<span style="font-size:12.5px;font-weight:650;color:#0b183b">'+ragEsc(t.t)+'</span>'+
          '<span style="font-size:10.5px;color:#9aa5b5;margin-left:auto">'+(t.known||[]).length+' 条</span>'+
        '</div>'+
        (t.sub?'<div style="font-size:10.5px;color:#7c8aa0">'+ragEsc(t.sub)+(t.tag?' · '+ragEsc(t.tag):'')+'</div>':'')+
      '</div>';
    }).join('');
  var baseTotal=base?base.reduce(function(s,t){return s+(t.known||[]).length;},0):0;
  var left='<div style="border:1px solid #e3ebf6;border-radius:10px;background:#fff;overflow:hidden;align-self:start">'+
    '<div style="padding:12px 14px;background:#fafbfd;border-bottom:1px solid #eef2f7">'+
      '<div style="font-size:12.5px;font-weight:700;color:#0b183b"><span data-ops-icon="resource"></span> 基础包（只读）</div>'+
      '<div style="font-size:10.5px;color:#9aa5b5;margin-top:2px">城市研判基础材料 · 共 '+baseTotal+' 条 · 全部工作区共享同一份</div>'+
    '</div>'+
    '<div style="max-height:420px;overflow-y:auto">'+baseHtml+'</div>'+
    '<div style="padding:10px 14px;border-top:1px solid #eef2f7">'+
      '<button onclick="opsTab=\'reports\';renderOpsV2()" style="width:100%;min-height:32px;border:1px solid #d8e0ed;border-radius:7px;background:#fff;color:#3d5471;font-size:11.5px;cursor:pointer">↻ 需要更新？去「报告任务」发起报告重跑</button>'+
    '</div>'+
  '</div>';
  // 收集该工作区全部主题下的补充材料(base之外)，按account分组
  var byAccount={};
  p.kb.forEach(function(t){
    (t.known||[]).forEach(function(it){
      if(!(it&&typeof it==='object')) return;
      if(it.nature==='base') return; // 基础包内容不在右侧重复出现
      var who=it.account||(it.origin==='admin'?'管理员':(it.origin==='user'?'用户':'未知'));
      (byAccount[who]=byAccount[who]||[]).push(it);
    });
  });
  var accounts=Object.keys(byAccount).sort(function(a,b){return byAccount[b].length-byAccount[a].length;});
  var rightHtml=!accounts.length?
    '<div style="padding:24px 16px;text-align:center;color:#9aa5b5;font-size:12.5px">还没有账号补充过材料</div>':
    accounts.map(function(who){
      var items=byAccount[who];
      return '<div style="margin-bottom:14px">'+
        '<div style="display:flex;align-items:center;gap:6px;padding:0 2px 6px;border-bottom:1px solid #eef2f7">'+
          '<span style="font-size:12.5px;font-weight:700;color:#0b183b"><span data-ops-icon="account"></span> '+ragEsc(who)+'</span>'+
          '<span style="font-size:10.5px;color:#9aa5b5">'+items.length+' 条</span>'+
        '</div>'+
        items.map(function(it,i){return ragRenderChunk(it,i+1,null);}).join('')+
      '</div>';
    }).join('');
  var right='<div style="border:1px solid #e3ebf6;border-radius:10px;background:#fbfcfe;padding:12px 14px;max-height:560px;overflow-y:auto">'+
    '<div style="font-size:12.5px;font-weight:700;color:#0b183b;margin-bottom:8px"><span data-ops-icon="team"></span> 补充材料（按账号）<span style="color:#9aa5b5;font-weight:400;margin-left:4px">'+accounts.length+' 个账号</span></div>'+
    rightHtml+
  '</div>';
  return '<div style="display:grid;grid-template-columns:280px 1fr;gap:14px;margin-top:14px">'+left+right+'</div>';
}
/* 结构化渲染一条智库材料：标题章 → 正文（加粗、数字高亮、关键词高亮）→ 来源徽章 */
// 来源+性质 → 标识条颜色与徽章
// 【2026-09-29】徽标文字改为具体账号名（如"kbtest3"）而不是笼统的"管理员/用户"，
// 方便管理员核对材料到底是谁上传的、避免误判"这条是不是别的团队搞混了"。
// account 缺失时（历史数据/系统级写入）降级为原来的通用角色词。
function ragOriginStyle(origin,nature,account){
  var who=account?ragEsc(account):null;
  // AI 采集=中性；管理员佐证=绿 / 修正=黄；用户佐证或确认=绿 / 修改=红
  if(origin==='admin'){
    var adminLabel=who||'管理员';
    return nature==='fix'?{bar:'#e0a516',badge:'<span data-ops-icon="warning" data-ops-icon-size="12"></span> '+adminLabel+' 修正',bg:'#fffaf0',bc:'#f0d99a',bt:'#8a6d1b'}
                         :{bar:'#0aa696',badge:'<span data-ops-icon="success" data-ops-icon-size="12"></span> '+adminLabel+' 佐证',bg:'#f2fbf9',bc:'#bfe5e0',bt:'#087067'};
  }
  if(origin==='user'){
    var userLabel=who||'用户';
    if(nature==='fix') return {bar:'#e0574a',badge:'<span data-ops-icon="error" data-ops-icon-size="12"></span> '+userLabel+' 修改',bg:'#fdf3f2',bc:'#f2c3bd',bt:'#b0362a'};
    return {bar:'#0aa696',badge:(nature==='confirm'?'<span data-ops-icon="success" data-ops-icon-size="12"></span> '+userLabel+' 确认':'<span data-ops-icon="success" data-ops-icon-size="12"></span> '+userLabel+' 补充'),bg:'#f2fbf9',bc:'#bfe5e0',bt:'#087067'};
  }
  return null; // AI 基础材料：无标识条
}
// markdown 表格 → HTML table（输入已 HTML 转义）
function ragMdTables(s){
  var lines=s.split('\n');
  var out=[], i=0;
  while(i<lines.length){
    var ln=lines[i];
    // 表格起点：以 | 开头、含至少2个 |，下一行是分隔行 |---|---|
    if(/^\s*\|.*\|/.test(ln) && i+1<lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i+1].replace(/&\w+;/g,''))){
      var header=ln, sep=lines[i+1], rows=[], j=i+2;
      while(j<lines.length && /^\s*\|.*\|/.test(lines[j])){ rows.push(lines[j]); j++; }
      var splitCells=function(r){ return r.trim().replace(/^\||\|$/g,'').split('|').map(function(c){return c.trim();}); };
      var ths=splitCells(header);
      var thead='<tr>'+ths.map(function(c){return '<th style="padding:5px 9px;background:#eef3fb;color:#013582;font-weight:650;text-align:left;border:1px solid #d3e0f0;white-space:nowrap">'+c+'</th>';}).join('')+'</tr>';
      var tbody=rows.map(function(r,ri){
        var tds=splitCells(r);
        return '<tr style="background:'+(ri%2?'#f8fbff':'#fff')+'">'+tds.map(function(c){return '<td style="padding:5px 9px;border:1px solid #e6edf6;color:#334155;vertical-align:top">'+c+'</td>';}).join('')+'</tr>';
      }).join('');
      out.push('<div style="overflow-x:auto;margin:7px 0"><table style="border-collapse:collapse;font-size:11.5px;min-width:100%;line-height:1.5">'+thead+tbody+'</table></div>');
      i=j;
    } else {
      out.push(ln); i++;
    }
  }
  return out.join('\n');
}
function ragRenderChunk(raw, idx, hl){
  // 兼容结构化 chunk（对象）与旧字符串
  var origin='ai', nature='base', srcName='', annots=[], account='';
  if(raw && typeof raw==='object'){ origin=raw.origin||'ai'; nature=raw.nature||'base'; srcName=raw.src||''; annots=Array.isArray(raw.annotations)?raw.annotations.filter(function(a){return a&&typeof a==='object';}):[]; account=raw.account||''; }
  var text=ragItemText(raw);
  // 1) 抽取【标题】前缀
  var title=null; var m=text.match(/^【([^】]{2,40})】\s*/);
  if(m){ title=m[1]; text=text.slice(m[0].length); }
  // 2) 抽取（来源：URL，日期）尾注（可多个，取全部）
  var sources=[];
  text=text.replace(/[（(]来源[:：]\s*(https?:\/\/[^，,）)\s]+)\s*[，,]?\s*([\d]{4}-[\d]{2}-[\d]{2})?\s*[）)]/g,function(_,url,date){
    sources.push({url:url,date:date||''});return '';});
  var pending=/未获公开来源|待核实|二手来源/.test(text);
  // 3) 转义后做行内渲染 —— 先把 markdown 表格转成 HTML table
  var html=ragMdTables(ragEsc(text.trim()));
  html=html.replace(/\*\*([^*]{1,60})\*\*/g,'<b style="color:#0b183b">$1</b>');   // **bold**
  // 数字高亮：避开 HTML 标签内部（表格已生成标签）
  html=html.replace(/(^|[^\w.<])(\d[\d,.]*\s*(?:亿元|万元|亿|万吨|万人|万辆|万平|公里|千米|元\/㎡|元|%|个|家|条|亿千瓦时))(?![^<]*>)/g,
    '$1<span style="color:#0757ad;font-weight:650">$2</span>');                    // 数字+单位高亮
  html=html.replace(/(✅|⚠️|❌|❓)/g,'<span style="font-size:11px">$1</span>');
  if(hl){
    String(hl).trim().split(/\s+/).filter(function(w){return w.length>=2;}).forEach(function(w){
      var esc=w.replace(/[.*+?^${}()|[\]\\]/g,'\\'+'$'+'&');
      html=html.replace(new RegExp('('+esc+')(?![^<]*>)','g'),'<mark style="background:#ffe9a8;padding:0 2px;border-radius:3px">$1</mark>');
    });
  }
  // 4) 组装卡片
  var srcHtml=sources.map(function(s){
    var dom=(s.url.match(/^https?:\/\/([^\/]+)/)||[])[1]||'';
    var gov=/gov\.cn|cninfo|sse\.com|szse\.cn|landchina/.test(dom);
    return '<a href="'+s.url+'" target="_blank" title="'+s.url+'" style="display:inline-flex;align-items:center;gap:4px;font-size:10.5px;padding:2px 8px;border-radius:9px;text-decoration:none;'+
      (gov?'background:#e4f5f3;color:#006d70;border:1px solid #bfe5e0':'background:#eef3fb;color:#0757ad;border:1px solid #d3e3f8')+'">'+
      (gov?'<span data-ops-icon="public-service" data-ops-icon-size="12"></span>':'<span data-ops-icon="citation" data-ops-icon-size="12"></span>')+' '+dom+(s.date?' · '+s.date:'')+' ↗</a>';
  }).join(' ');
  if(pending) srcHtml+=(srcHtml?' ':'')+'<span style="display:inline-flex;font-size:10.5px;padding:2px 8px;border-radius:9px;background:#fff0de;color:#a34c09;border:1px solid #f2d9b8"><span data-ops-icon="warning" data-ops-icon-size="12"></span> 待核实</span>';
  // 来源标识：AI 基础材料无条；具体账号标注加彩色左条+徽章
  var os=ragOriginStyle(origin,nature,account);
  var origBadge=os?('<span style="display:inline-flex;align-items:center;font-size:10px;padding:2px 8px;border-radius:9px;background:'+os.bg+';color:'+os.bt+';border:1px solid '+os.bc+'">'+os.badge+(srcName?' · '+ragEsc(srcName):'')+'</span>'):'';
  var barCss=os?('border-left:3px solid '+os.bar+';'):'';
  var cardBg=os?os.bg:'#fff';
  return '<div style="border:1px solid #e9eef5;'+barCss+'border-radius:10px;padding:11px 14px;margin-bottom:8px;background:'+cardBg+';transition:box-shadow .15s" '+
      'onmouseover="this.style.boxShadow=\'0 2px 10px rgba(7,87,173,.08)\'" onmouseout="this.style.boxShadow=\'none\'">'+
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:'+((title||srcHtml||origBadge)?'5px':'0')+'">'+
      '<span style="flex-shrink:0;font-size:10px;color:#b0bac7;font-variant-numeric:tabular-nums">'+String(idx).padStart(2,'0')+'</span>'+
      (title?'<span style="font-size:12px;font-weight:700;color:#013582;background:#ebf3fd;padding:1px 9px;border-radius:6px">'+ragEsc(title)+'</span>':'')+
      origBadge+
    '</div>'+
    '<div style="font-size:12.5px;color:#334155;line-height:1.75;padding-left:24px">'+html+'</div>'+
    (annots.length?ragAnnots(annots):'')+
    (srcHtml?'<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;padding-left:24px">'+srcHtml+'</div>':'')+
  '</div>';
}
// 就地标注：已有条目被上传材料佐证/修正时，在条目内嵌入显示
function ragAnnots(annots){
  return '<div style="margin-top:7px;margin-left:24px;padding-left:10px;border-left:2px solid #e2e8f2;display:flex;flex-direction:column;gap:5px">'+
    annots.map(function(a){
      var os=ragOriginStyle(a.origin,a.nature,a.account);
      if(!os) return '';
      var who=a.account?ragEsc(a.account):(a.origin==='admin'?'管理员':'用户');
      var act=a.nature==='fix'?'修正':(a.nature==='confirm'?'确认':'佐证');
      return '<div style="font-size:11px;color:'+os.bt+';background:'+os.bg+';border:1px solid '+os.bc+';border-radius:7px;padding:5px 9px">'+
        '<b>'+(a.nature==='fix'?(a.origin==='user'?'<span data-ops-icon="error" data-ops-icon-size="12"></span>':'<span data-ops-icon="warning" data-ops-icon-size="12"></span>'):'<span data-ops-icon="success" data-ops-icon-size="12"></span>')+' '+who+act+'</b>'+(a.src?' · '+ragEsc(a.src):'')+
        '：'+ragEsc(ragItemText(a).slice(0,140))+'</div>';
    }).join('')+'</div>';
}
function ragPushLog(){
  var logs=(ragLog&&ragLog.recs)||null;
  return '<div style="border:1px solid #e3ebf6;border-radius:10px;background:#fff;padding:14px 16px;margin-top:14px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
      '<div><span style="font-size:13px;font-weight:700;color:#0b183b">推送视图 · RAG 调用审计</span>'+
      '<span style="font-size:11px;color:#9aa5b5;margin-left:8px">政府端每次 AI 问答/研判实际消费了哪些智库材料</span></div>'+
      '<button class="ghost-button" style="min-height:32px;font-size:12px" onclick="ragLoadLog()">'+(logs?'刷新':'加载调用日志')+'</button></div>'+
    (logs===null?'<div style="color:#9aa5b5;font-size:12.5px">点击「加载调用日志」拉取 /rag-log 审计记录</div>':
     !logs.length?'<div style="color:#9aa5b5;font-size:12.5px">暂无调用记录 —— 政府端还没有发起过 AI 问答</div>':
     ragLogSummary(logs)+'<div style="max-height:340px;overflow-y:auto">'+logs.slice().reverse().slice(0,30).map(function(rec){
       var t=rec.ts?new Date(rec.ts):null;
       var tm=t?(t.getMonth()+1)+'/'+t.getDate()+' '+t.getHours()+':'+('0'+t.getMinutes()).slice(-2):'';
       var up=rec.upload_chunks||0;
       var kb=rec.kb_chunks!=null?rec.kb_chunks:Math.max(0,(rec.total_chunks||0)-up);
       var tot=rec.total_chunks||0;
       var kbPct=tot?Math.round(kb/tot*100):0;
       return '<div style="padding:8px 0;border-bottom:1px dashed #e9eef5">'+
         '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
           '<span style="font-size:11px;color:#9aa5b5;font-variant-numeric:tabular-nums">'+tm+'</span>'+
           '<span style="font-size:11px;padding:1px 7px;border-radius:8px;background:#ebf3fd;color:#013582">'+(rec.mode||'chat')+'</span>'+
           '<span style="font-size:12.5px;color:#0b183b;font-weight:600">'+ragEsc(rec.question||'').slice(0,60)+'</span></div>'+
         '<div style="display:flex;align-items:center;gap:10px;margin-top:5px">'+
           '<div style="flex:0 0 120px;height:6px;border-radius:3px;background:#eef1f5;overflow:hidden">'+
             '<div style="height:100%;width:'+kbPct+'%;background:linear-gradient(90deg,#0757ad,#007f82)"></div></div>'+
           '<span style="font-size:11.5px;color:#667590">消费 '+tot+' 条（智库 '+kb+' + 上传 '+up+'）'+(rec.city?' · '+rec.city:'')+'</span></div></div>';
     }).join('')+'</div>')+'</div>';
}
function ragLogSummary(logs){
  var n=logs.length,tot=0,up=0;
  logs.forEach(function(r){tot+=(r.total_chunks||0);up+=(r.upload_chunks||0);});
  return '<div style="display:flex;gap:18px;padding:8px 0 10px;font-size:12px;color:#3d5471;border-bottom:1px solid #eef2f7;margin-bottom:6px">'+
    '<span>累计调用 <b>'+n+'</b> 次</span><span>消费材料 <b>'+tot+'</b> 条</span>'+
    '<span>智库占比 <b>'+(tot?Math.round((tot-up)/tot*100):0)+'%</b></span>'+
    '<span>用户上传占比 <b>'+(tot?Math.round(up/tot*100):0)+'%</b></span></div>';
}
function ragLoadLog(){
  fetch('/rag-log?format=json').then(function(r){return r.json();}).then(function(recs){
    ragLog={recs:Array.isArray(recs)?recs:[]};renderOpsV2();
  }).catch(function(){ragLog={recs:[]};renderOpsV2();});
}
/* ══ Tab: 城市画像（客观条件 + 招商偏好）══
   数据源：① onboarding 招商偏好问卷（PROJECTS[k].onboarding，政府端填写）
           ② 城市智库 RAG 全量材料（PROJECTS[k].kb[].known[]）
   结论由后端 mode=city_profile 生成结构化 JSON，缓存在 PROJECTS[k].profile，
   打开即读缓存；材料更新后点「重新生成」重算。 */
var cpCity=null, cpBusy=false, cpErr='', cpRaw='';

/* 有材料的城市：按城市去重，代表项取材料最多者（与 ragCityOptions 同口径）*/
function cpCityMap(){
  var byCity=Object.create(null);
  Object.keys(PROJECTS).forEach(function(k){
    var p=PROJECTS[k];
    if(!p||!p.kb||!p.kb.some(function(t){return (t.known||[]).length;})) return;
    var c=p.city||k;
    if(!byCity[c]){ byCity[c]=k; return; }
    var pc=PROJECTS[byCity[c]];
    var nc=pc.kb.reduce(function(s,t){return s+(t.known||[]).length;},0);
    var nk=p.kb.reduce(function(s,t){return s+(t.known||[]).length;},0);
    if(nk>nc) byCity[c]=k;
  });
  Object.keys(byCity).forEach(function(city){
    var registry=typeof CITY_WORKSPACES!=='undefined'&&CITY_WORKSPACES[city];
    if(registry&&PROJECTS[registry.projectKey])byCity[city]=registry.projectKey;
  });
  return byCity;
}
function cpProjKey(){
  var m=cpCityMap(), cities=Object.keys(m);
  if(!cities.length) return null;
  if(cpCity && m[cpCity]) return m[cpCity];
  cpCity=cities[0];
  return m[cpCity];
}
/* 只读当前选定工作区：同城名称不构成资料共享授权。 */
function cpCorpus(city){
  var out=[], selected=cpCityMap()[city];
  Object.keys(PROJECTS).forEach(function(k){
    var p=PROJECTS[k];
    if(!p||k!==selected) return;
    (p.kb||[]).forEach(function(t){
      (t.known||[]).forEach(function(it,i){
        var s=(it&&typeof it==='object')?(it.text||''):it;
        if(!s) return;
        var org=(it&&typeof it==='object')?(it.origin||''):'';
        var nat=(it&&typeof it==='object')?(it.nature||''):'';
        var src=(it&&typeof it==='object')?(it.src||''):'';
        out.push({id:k+':'+t.t+':'+i, topic:t.t, text:s,
                  cite:(src||t.t)+(nat?('·'+nat):''), origin:org, nature:nat});
      });
    });
  });
  return out;
}
/* 该城市的问卷答案：同城任一项目填过就算（政府端按项目存）*/
function cpOnboarding(city){
  var found=null, selected=cpCityMap()[city];
  Object.keys(PROJECTS).forEach(function(k){
    var p=PROJECTS[k];
    if(!p||k!==selected||found) return;
    if(p.onboarding && Object.keys(p.onboarding).length) found=p.onboarding;
  });
  return found;
}
/* 问卷 → {options,custom}（与政府端 onboardingPrefs 同口径，管理端自带一份避免跨文件依赖）*/
var CP_Q=[['park','您重点招商的产业园区是'],['capacity','产业园区的承载能力为'],
          ['scale','理想的招商企业规模为'],['industry','优先招引的产业方向为'],
          ['invest','期望的企业投资强度为']];
function cpPrefs(ob){
  if(!ob) return null;
  var opts=[], cus=[], cmap=ob.__custom||{};
  CP_Q.forEach(function(q){
    var v=ob[q[0]];
    if(v&&(!Array.isArray(v)||v.length)) opts.push('· '+q[1]+'：'+(Array.isArray(v)?v.join('、'):v));
    if(cmap[q[0]]) cus.push('· '+q[1]+'：'+cmap[q[0]]);
  });
  if(!opts.length&&!cus.length) return null;
  return {options:opts.join('\n'), custom:cus.join('\n')};
}
/* 访谈类材料条数：访谈信息完备度的客观指标 */
function cpInterviewCount(city){
  return cpCorpus(city).filter(function(c){return c.nature==='interview';}).length;
}
/* ── 生成画像：吃全量语料 + 问卷 → 结构化 JSON 缓存到 PROJECTS[key].profile ── */
function cpGenerate(force){
  var key=cpProjKey();if(!key||cpBusy)return;
  var p=PROJECTS[key],city=p.city||key,topic=p.topic||'',requestId=p.reportRequestId||null,epoch=typeof _authEpoch==='number'?_authEpoch:0;
  var sourceIdentity=savedEvidenceIdentity(key,topic);
  function current(){return PROJECTS[key]&&(PROJECTS[key].topic||'')===topic&&savedEvidenceIdentity(key,topic)===sourceIdentity&&(typeof _authEpoch==='number'?_authEpoch:0)===epoch;}
  var corpus=cpCorpus(city);
  if(!corpus.length){cpErr='该城市暂无智库材料，无法生成画像';renderOpsV2();return;}
  cpBusy=true;cpErr='';cpRaw='';renderOpsV2();
  var ob=cpOnboarding(city);
  var body={question:'为'+city+'生成城市画像：客观自身条件与招商偏好',projectKey:key,topic:topic,reportRequestId:requestId,mode:'city_profile',stream:true};
  fetch('/api/kb-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(async function(resp){
      if(!resp.ok){
        var problem={};try{var parsed=await resp.json();if(parsed&&typeof parsed==='object')problem=parsed;}catch(_){}
        var code=problem.code||(typeof problem.error==='string'?problem.error:(problem.error||{}).code)||'';
        var known=['evidence_changed','report_changed','topic_mismatch','topic_changed','evidence_missing','confirmation_required','project_required','auth_required','workspace_forbidden','membership_disabled','session_unavailable','storage_unavailable'];
        var safeMessage=known.indexOf(code)>=0&&typeof problem.message==='string'?problem.message:'';
        if(!safeMessage&&resp.status===409)safeMessage='材料或方向已更新，旧画像已保留，请刷新后重新生成。';
        throw new Error(safeMessage||'画像生成未完成，旧结果已保留，请稍后重试（HTTP '+resp.status+'）');
      }
      var result=await readTopicReportStream(resp,function(){});
      if(!current())throw new Error('工作区或报告版本已变化，旧响应未写入');
      var obj=JSON.parse(result.text);
      if(obj.projectKey!==key||obj.topic!==topic||(obj.reportRequestId||null)!==requestId)throw new Error('画像来源版本已变化，旧画像已保留');
      cpFinish(key,result.text,corpus.length,!!ob);
    }).catch(function(e){cpBusy=false;cpErr='生成失败：'+e.message;renderOpsV2();});
}
/* 【2026-09-17】JSON 保守修复：把字符串值内部的裸双引号替换成中文引号。
   逐字符扫描并跟踪是否处于字符串内；只有当一个双引号后面紧跟的不是
   结构字符（, } ] : 或换行结尾）时，才判定它是文中引用而非字符串结束符。
   同时顺手去掉对象/数组尾部多余逗号。不改变任何合法 JSON 的语义。 */
function cpRepairJson(t){
  var out='', inStr=false, esc=false, _qOpen=false;
  for(var i=0;i<t.length;i++){
    var ch=t[i];
    if(esc){ out+=ch; esc=false; continue; }
    if(ch==='\\'){ out+=ch; esc=true; continue; }
    if(ch==='"'){
      if(!inStr){ inStr=true; out+=ch; continue; }
      // 处于字符串内遇到双引号：向后看第一个非空白字符判断它是不是真正的结束引号
      var j=i+1;
      while(j<t.length && (t[j]===' '||t[j]==='\t'||t[j]==='\r'||t[j]==='\n')) j++;
      var nx=j<t.length?t[j]:'';
      if(nx===','||nx==='}'||nx===']'||nx===':'||nx===''){ inStr=false; out+=ch; }
      else { out+=(_qOpen?'\u201d':'\u201c'); _qOpen=!_qOpen; }   // 文中引用 -> 中文引号(左右交替)，避免截断字符串
      continue;
    }
    out+=ch;
  }
  // 去掉 , 后紧跟 } 或 ] 的尾随逗号
  return out.replace(/,\s*([}\]])/g,'$1');
}
/* 解析并落库：容错剥离可能的 markdown 围栏 */
function cpFinish(key, txt, nChunks, hadOb){
  cpBusy=false;
  var s=(txt||'').trim();
  cpRaw=s;
  var a=s.indexOf('{'), b=s.lastIndexOf('}');
  if(a<0||b<=a){ cpErr='返回内容不是有效 JSON，请重试'; renderOpsV2(); return; }
  var obj=null, _jsonTxt=s.slice(a,b+1);
  try{ obj=JSON.parse(_jsonTxt); }
  catch(e){
    // 【2026-09-17】DeepSeek 常在中文字符串里直接用英文双引号做引用，
    // 例如 "summary": "随州是"中国专用汽车之都"，..." —— 双引号提前闭合字符串，
    // 整个画像就卡在 position 20 解析失败。这里做一次保守修复再重试，
    // 而不是直接让用户重新生成（重生成大概率仍会踩同一个坑）。
    try{ obj=JSON.parse(cpRepairJson(_jsonTxt)); }
    catch(e2){ cpErr='画像 JSON 解析失败：'+e.message+'（可重新生成）'; renderOpsV2(); return; }
  }
  if(!obj||typeof obj!=='object'||obj.evidence_contract!=='saved-excerpts-v1'||obj.projectKey!==key){ cpErr='画像来源校验未通过，旧画像已保留'; renderOpsV2(); return; }
  obj.__ts=Date.now(); obj.__chunks=nChunks; obj.__hasOnboarding=!!hadOb;
  PROJECTS[key].profile=obj;
  cpErr='';
  try{ persist(); }catch(e){}
  renderOpsV2();
  try{ toast&&toast('城市画像已生成（消费 '+nChunks+' 条材料）'); }catch(e){}
}
/* ── 渲染 ── */
function cpEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function cpCityOptions(){
  var m=cpCityMap();
  return Object.keys(m).map(function(c){
    var n=cpCorpus(c).length;
    return '<option value="'+cpEsc(c)+'"'+(c===cpCity?' selected':'')+'>'+cpEsc(c)+'（'+n+' 条）</option>';
  }).join('');
}
function cpStat(icon,label,val,sub){
  return '<div style="border:1px solid #e8edf5;border-radius:10px;padding:12px 14px;background:#fff">'+
    '<div style="font-size:11px;color:#9aa5b5;display:flex;align-items:center;gap:5px"><span>'+icon+'</span>'+cpEsc(label)+'</div>'+
    '<div style="font-size:16px;font-weight:750;color:#0b183b;margin-top:5px">'+cpEsc(val)+'</div>'+
    (sub?'<div style="font-size:11px;color:#9aa5b5;margin-top:2px">'+cpEsc(sub)+'</div>':'')+'</div>';
}
/* 客观条件分组卡 */
function cpObjBlock(title, icon, rows){
  rows=rows||[];
  if(!rows.length) return '';
  return '<div style="border:1px solid #e8edf5;border-radius:10px;background:#fff;overflow:hidden">'+
    '<div style="padding:10px 14px;background:#f8faff;border-bottom:1px solid #eef2f7;font-size:13px;font-weight:700;color:#0b183b">'+icon+' '+cpEsc(title)+'</div>'+
    '<div style="padding:4px 14px 10px">'+
    rows.map(function(r){
      if(!r||typeof r!=='object') return '';
      return '<div style="padding:9px 0;border-bottom:1px solid #f4f7fb">'+
        '<div style="display:flex;gap:10px;align-items:baseline">'+
          '<div style="font-size:12px;color:#7a879b;min-width:88px;flex-shrink:0">'+cpEsc(r.label)+'</div>'+
          '<div style="font-size:13px;font-weight:650;color:#0b183b;flex:1">'+cpEsc(r.value)+'</div>'+
        '</div>'+
        (r.detail?'<div style="font-size:12px;color:#5a7398;margin:3px 0 0 98px;line-height:1.6">'+cpEsc(r.detail)+'</div>':'')+
        (r.evidence&&r.evidence.length?funnelEvidenceLinks({evidence:r.evidence}):(r.cite?'<div style="font-size:10.5px;color:#a8b3c4;margin:3px 0 0 98px">来源：'+cpEsc(r.cite)+'</div>':''))+
      '</div>';
    }).join('')+'</div></div>';
}
/* 偏好维度卡：区分 stated / inferred，标注置信度 */
function cpPrefCard(label, icon, d){
  d=d||{};
  var items=Array.isArray(d.items)?d.items:[];
  var isStated=(d.source==='stated');
  var conf=d.confidence||'low';
  var cc={high:['#0f766e','#e9f7f6','高'],medium:['#b45309','#fff7ed','中'],low:['#64748b','#f1f5f9','低']}[conf]||['#64748b','#f1f5f9','低'];
  var sc=isStated?['#1d4ed8','#eff6ff','问卷明示']:['#7c3aed','#f5f3ff','材料反推'];
  return '<div style="border:1px solid '+(isStated?'#bfdbfe':'#e8edf5')+';border-radius:10px;background:#fff;padding:12px 14px">'+
    '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px">'+
      '<span style="font-size:14px">'+icon+'</span>'+
      '<span style="font-size:13px;font-weight:700;color:#0b183b">'+cpEsc(label)+'</span>'+
      '<span style="font-size:10px;padding:2px 7px;border-radius:5px;color:'+sc[0]+';background:'+sc[1]+';font-weight:650">'+sc[2]+'</span>'+
      '<span style="font-size:10px;padding:2px 7px;border-radius:5px;color:'+cc[0]+';background:'+cc[1]+'">置信度'+cc[2]+'</span>'+
    '</div>'+
    (items.length
      ? '<div style="display:flex;flex-wrap:wrap;gap:6px">'+items.map(function(x){
          return '<span style="font-size:12px;padding:4px 9px;border-radius:14px;background:#f1f5fb;color:#28405f">'+cpEsc(x)+'</span>';
        }).join('')+'</div>'
      : '<div style="font-size:12px;color:#a8b3c4">未标定——材料中无足够依据</div>')+
    (d.basis?'<div style="font-size:11.5px;color:#5a7398;margin-top:8px;line-height:1.65;padding-top:7px;border-top:1px solid #f4f7fb">依据：'+cpEsc(d.basis)+'</div>':'')+
  '</div>';
}
/* 要点列表（优势/短板/缺口/冲突）*/
function cpList(title, icon, arr, color, bg){
  arr=Array.isArray(arr)?arr.filter(Boolean):[];
  if(!arr.length) return '';
  return '<div style="border:1px solid #e8edf5;border-radius:10px;background:#fff;overflow:hidden">'+
    '<div style="padding:10px 14px;background:'+bg+';border-bottom:1px solid #eef2f7;font-size:13px;font-weight:700;color:'+color+'">'+icon+' '+cpEsc(title)+'</div>'+
    '<div style="padding:10px 14px">'+arr.map(function(x,i){
      return '<div style="display:flex;gap:8px;padding:5px 0;font-size:12.5px;color:#33465f;line-height:1.7">'+
        '<span style="color:'+color+';flex-shrink:0;font-weight:700">'+(i+1)+'.</span><span>'+cpEsc(x)+'</span></div>';
    }).join('')+'</div></div>';
}
/* ══ 城市画像·纯图表区 ══
   零依赖内联 SVG（ops.html 无图表库，且不能加 CDN——离线 demo 会挂）。
   数据来自后端 profile.charts（纯数字），不做字符串正则解析，避免措辞一变就崩。 */
function cpNum(v){ var n=parseFloat(v); return isFinite(n)?n:null; }

/* ── 图1：三次产业结构（堆叠条 + 图例）── */
function cpChartStructure(s){
  if(!s) return '';
  var a=cpNum(s.primary), b=cpNum(s.secondary), c=cpNum(s.tertiary);
  if(a===null||b===null||c===null) return '';
  var tot=a+b+c; if(tot<=0) return '';
  var W=460,H=54,pad=0;
  var segs=[['第一产业',a,'#f59e0b'],['第二产业',b,'#1a56db'],['第三产业',c,'#0ea5a4']];
  var x=pad,bars='',lab='';
  segs.forEach(function(g){
    var w=(g[1]/tot)*(W-pad*2);
    bars+='<rect x="'+x.toFixed(1)+'" y="12" width="'+w.toFixed(1)+'" height="26" fill="'+g[2]+'"/>';
    if(w>42) lab+='<text x="'+(x+w/2).toFixed(1)+'" y="29" fill="#fff" font-size="12" font-weight="700" text-anchor="middle">'+g[1]+'%</text>';
    x+=w;
  });
  var legend=segs.map(function(g){
    return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:#5a7398">'+
      '<i style="width:9px;height:9px;border-radius:2px;background:'+g[2]+';display:inline-block"></i>'+g[0]+' '+g[1]+'%</span>';
  }).join('<span style="width:14px;display:inline-block"></span>');
  return cpChartBox('三次产业结构'+(s.year?'（'+cpEsc(s.year)+'）':''),
    '<svg viewBox="0 0 '+W+' '+H+'" width="100%" height="'+H+'" preserveAspectRatio="none">'+bars+lab+'</svg>'+
    '<div style="margin-top:8px">'+legend+'</div>', s.cite);
}

/* ── 图2：GDP 走势（折线 + 数据点）── */
function cpChartGdp(arr){
  if(!Array.isArray(arr)||arr.length<2) return '';
  var pts=arr.map(function(d){return {y:String(d.year||''),v:cpNum(d.value)};})
             .filter(function(d){return d.v!==null;});
  if(pts.length<2) return '';
  var W=460,H=150,L=52,R=12,T=14,B=26;
  var vs=pts.map(function(p){return p.v;});
  var mx=Math.max.apply(null,vs), mn=Math.min.apply(null,vs);
  var lo=mn-(mx-mn)*0.25, hi=mx+(mx-mn)*0.18; if(hi===lo){hi=lo+1;}
  var px=function(i){ return L+(pts.length===1?0:i*(W-L-R)/(pts.length-1)); };
  var py=function(v){ return T+(hi-v)/(hi-lo)*(H-T-B); };
  var line=pts.map(function(p,i){return (i?'L':'M')+px(i).toFixed(1)+' '+py(p.v).toFixed(1);}).join(' ');
  var area=line+' L'+px(pts.length-1).toFixed(1)+' '+(H-B)+' L'+px(0).toFixed(1)+' '+(H-B)+' Z';
  var g='',dots='',xl='';
  [0,0.5,1].forEach(function(f){
    var v=lo+(hi-lo)*f, y=py(v);
    g+='<line x1="'+L+'" y1="'+y.toFixed(1)+'" x2="'+(W-R)+'" y2="'+y.toFixed(1)+'" stroke="#eef2f7"/>'+
       '<text x="'+(L-6)+'" y="'+(y+3.5).toFixed(1)+'" fill="#9aa5b5" font-size="10" text-anchor="end">'+Math.round(v)+'</text>';
  });
  pts.forEach(function(p,i){
    dots+='<circle cx="'+px(i).toFixed(1)+'" cy="'+py(p.v).toFixed(1)+'" r="3.5" fill="#fff" stroke="#1a56db" stroke-width="2"/>'+
          '<text x="'+px(i).toFixed(1)+'" y="'+(py(p.v)-9).toFixed(1)+'" fill="#1d4ed8" font-size="10.5" font-weight="700" text-anchor="middle">'+p.v+'</text>';
    xl+='<text x="'+px(i).toFixed(1)+'" y="'+(H-8)+'" fill="#7a879b" font-size="10.5" text-anchor="middle">'+cpEsc(p.y)+'</text>';
  });
  return cpChartBox('GDP 总量走势（亿元）',
    '<svg viewBox="0 0 '+W+' '+H+'" width="100%" height="'+H+'">'+g+
    '<path d="'+area+'" fill="#1a56db" opacity="0.07"/>'+
    '<path d="'+line+'" fill="none" stroke="#1a56db" stroke-width="2.2" stroke-linejoin="round"/>'+
    dots+xl+'</svg>','');
}

/* ── 图3：增速对比（横向条）── */
function cpChartGrowth(arr){
  if(!Array.isArray(arr)||!arr.length) return '';
  var rows=arr.map(function(d){return {l:String(d.label||''),v:cpNum(d.value),u:d.unit||'%'};})
              .filter(function(d){return d.v!==null;}).slice(0,6);
  if(!rows.length) return '';
  var mx=Math.max.apply(null,rows.map(function(r){return Math.abs(r.v);}))||1;
  var body=rows.map(function(r){
    var w=Math.abs(r.v)/mx*100, neg=r.v<0;
    return '<div style="display:flex;align-items:center;gap:9px;padding:5px 0">'+
      '<div style="width:118px;flex-shrink:0;font-size:11.5px;color:#5a7398;text-align:right;line-height:1.35">'+cpEsc(r.l)+'</div>'+
      '<div style="flex:1;background:#f1f5fb;border-radius:4px;height:19px;position:relative;overflow:hidden">'+
        '<div style="width:'+w.toFixed(1)+'%;height:100%;border-radius:4px;background:'+(neg?'linear-gradient(90deg,#f87171,#ef4444)':'linear-gradient(90deg,#60a5fa,#1a56db)')+'"></div></div>'+
      '<div style="width:52px;flex-shrink:0;font-size:12px;font-weight:700;color:'+(neg?'#b91c1c':'#1d4ed8')+'">'+r.v+cpEsc(r.u)+'</div>'+
    '</div>';
  }).join('');
  return cpChartBox('关键增速指标', body, '');
}
/* ── 图4：产业链环节强弱（招商最关心：哪里缺）── */
function cpChartChain(arr){
  if(!Array.isArray(arr)||!arr.length) return '';
  var M={strong:['#0f766e','#e9f7f6','本地强'],weak:['#b45309','#fff7ed','薄弱'],missing:['#b91c1c','#fef2f2','缺失']};
  var rows=arr.filter(function(d){return d&&d.node&&M[d.status];}).slice(0,12);
  if(!rows.length) return '';
  var cnt={strong:0,weak:0,missing:0};
  rows.forEach(function(r){cnt[r.status]++;});
  var chips=rows.map(function(r){
    var m=M[r.status];
    return '<div style="display:flex;align-items:center;gap:7px;padding:6px 9px;border-radius:7px;background:'+m[1]+';border:1px solid '+m[0]+'22">'+
      '<span style="width:7px;height:7px;border-radius:50%;background:'+m[0]+';flex-shrink:0"></span>'+
      '<span style="font-size:12px;color:#28405f;flex:1">'+cpEsc(r.node)+'</span>'+
      '<span style="font-size:10px;font-weight:700;color:'+m[0]+'">'+m[2]+'</span></div>';
  }).join('');
  var bar='';
  var tot=rows.length;
  [['strong',M.strong],['weak',M.weak],['missing',M.missing]].forEach(function(g){
    if(!cnt[g[0]]) return;
    bar+='<div style="width:'+(cnt[g[0]]/tot*100).toFixed(1)+'%;background:'+g[1][0]+';display:flex;align-items:center;justify-content:center">'+
      '<span style="font-size:10px;color:#fff;font-weight:700">'+cnt[g[0]]+'</span></div>';
  });
  return cpChartBox('产业链环节强弱分布',
    '<div style="display:flex;height:20px;border-radius:5px;overflow:hidden;margin-bottom:10px">'+bar+'</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">'+chips+'</div>', '');
}

/* ── 图5：与竞争城市对比（同口径指标）── */
function cpChartCompare(c){
  if(!c||!c.self) return '';
  var self={l:String(c.self.label||'本市'),v:cpNum(c.self.value)};
  if(self.v===null) return '';
  var peers=(Array.isArray(c.peers)?c.peers:[]).map(function(p){return {l:String(p.label||''),v:cpNum(p.value)};})
              .filter(function(p){return p.v!==null;}).slice(0,4);
  var all=[self].concat(peers);
  var mx=Math.max.apply(null,all.map(function(r){return r.v;}))||1;
  var u=c.unit||'';
  var body=all.map(function(r,i){
    var isSelf=(i===0), w=r.v/mx*100;
    return '<div style="display:flex;align-items:center;gap:9px;padding:5px 0">'+
      '<div style="width:74px;flex-shrink:0;font-size:11.5px;font-weight:'+(isSelf?'750':'400')+';color:'+(isSelf?'#0b183b':'#7a879b')+';text-align:right">'+cpEsc(r.l)+'</div>'+
      '<div style="flex:1;background:#f1f5fb;border-radius:4px;height:19px;overflow:hidden">'+
        '<div style="width:'+w.toFixed(1)+'%;height:100%;border-radius:4px;background:'+(isSelf?'linear-gradient(90deg,#1a56db,#6366f1)':'#cbd7e6')+'"></div></div>'+
      '<div style="width:50px;flex-shrink:0;font-size:12px;font-weight:'+(isSelf?'750':'600')+';color:'+(isSelf?'#1d4ed8':'#7a879b')+'">'+r.v+cpEsc(u)+'</div>'+
    '</div>';
  }).join('');
  return cpChartBox((c.metric?cpEsc(c.metric):'指标')+' · 与竞争城市对比', body, '');
}

/* ── 图6：招商偏好置信度雷达（五维，反映画像可信程度）── */
function cpChartPrefRadar(pref){
  if(!pref) return '';
  var dims=[['industry','产业方向'],['park','园区'],['scale','企业规模'],['invest','投资强度'],['capacity','承载能力']];
  var SC={high:3,medium:2,low:1};
  var vals=dims.map(function(d){
    var x=pref[d[0]]||{};
    var s=SC[x.confidence]||0;
    if(!(x.items||[]).length) s=Math.min(s,1);
    return {n:d[1],v:s,stated:(x.source==='stated')};
  });
  var W=300,H=210,cx=W/2,cy=H/2+4,R=72,N=vals.length;
  var ang=function(i){ return -Math.PI/2 + i*2*Math.PI/N; };
  var pt=function(i,f){ return [cx+Math.cos(ang(i))*R*f, cy+Math.sin(ang(i))*R*f]; };
  var grid='';
  [1,0.667,0.333].forEach(function(f){
    var d=vals.map(function(_,i){var p=pt(i,f);return (i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1);}).join(' ')+' Z';
    grid+='<path d="'+d+'" fill="none" stroke="#e8edf5"/>';
  });
  vals.forEach(function(_,i){
    var p=pt(i,1);
    grid+='<line x1="'+cx+'" y1="'+cy+'" x2="'+p[0].toFixed(1)+'" y2="'+p[1].toFixed(1)+'" stroke="#eef2f7"/>';
  });
  var poly=vals.map(function(d,i){var p=pt(i,Math.max(d.v,0.001)/3);return (i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1);}).join(' ')+' Z';
  var dots='',labs='';
  vals.forEach(function(d,i){
    var p=pt(i,Math.max(d.v,0.001)/3);
    dots+='<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="3" fill="'+(d.stated?'#1a56db':'#7c3aed')+'"/>';
    var lp=pt(i,1.3), a=ang(i);
    var anc=Math.abs(Math.cos(a))<0.3?'middle':(Math.cos(a)>0?'start':'end');
    labs+='<text x="'+lp[0].toFixed(1)+'" y="'+(lp[1]+3.5).toFixed(1)+'" fill="#5a7398" font-size="10.5" text-anchor="'+anc+'">'+cpEsc(d.n)+'</text>';
  });
  var nStated=vals.filter(function(d){return d.stated;}).length;
  return cpChartBox('招商偏好置信度（'+nStated+'/5 维来自问卷）',
    '<svg viewBox="0 0 '+W+' '+H+'" width="100%" height="'+H+'">'+grid+
    '<path d="'+poly+'" fill="#1a56db" opacity="0.16" stroke="#1a56db" stroke-width="1.8"/>'+dots+labs+'</svg>'+
    '<div style="font-size:10.5px;color:#9aa5b5;text-align:center;margin-top:-4px">外圈=置信度高 · 蓝点=问卷明示 · 紫点=材料反推</div>','');
}

/* ── 图7：优势/短板/缺口 数量对比（一眼看画像健康度）── */
function cpChartBalance(prof){
  var g=[['不可复制优势',(prof.strength||[]).length,'#0f766e'],
         ['真实短板',(prof.weakness||[]).length,'#b45309'],
         ['问卷冲突',(prof.conflicts||[]).length,'#b91c1c'],
         ['画像缺口',(prof.gaps||[]).length,'#4f46e5']];
  if(!g.some(function(x){return x[1];})) return '';
  var mx=Math.max.apply(null,g.map(function(x){return x[1];}))||1;
  // TOP=数值标签预留高度：柱高按 (H-BOT-TOP) 缩放，否则最高柱的标签会被裁到 viewBox 外
  var H=128, bw=44, gap=26, W=g.length*(bw+gap), TOP=20, BOT=24;
  var bars='';
  g.forEach(function(x,i){
    var h=x[1]/mx*(H-BOT-TOP), bx=i*(bw+gap)+gap/2, by=H-BOT-h;
    bars+='<rect x="'+bx+'" y="'+by.toFixed(1)+'" width="'+bw+'" height="'+Math.max(h,1).toFixed(1)+'" rx="4" fill="'+x[2]+'" opacity="0.85"/>'+
          '<text x="'+(bx+bw/2)+'" y="'+(by-5).toFixed(1)+'" fill="'+x[2]+'" font-size="12" font-weight="750" text-anchor="middle">'+x[1]+'</text>'+
          '<text x="'+(bx+bw/2)+'" y="'+(H-8)+'" fill="#7a879b" font-size="10" text-anchor="middle">'+x[0]+'</text>';
  });
  return cpChartBox('画像结论分布', '<svg viewBox="0 0 '+W+' '+H+'" width="100%" height="'+H+'">'+bars+'</svg>', '');
}

/* 图表卡外壳 */
function cpChartBox(title, inner, cite){
  return '<div style="border:1px solid #e8edf5;border-radius:10px;background:#fff;padding:13px 15px">'+
    '<div style="font-size:12.5px;font-weight:700;color:#0b183b;margin-bottom:10px">'+cpEsc(title)+'</div>'+
    inner+
    (cite?'<div style="font-size:10px;color:#a8b3c4;margin-top:7px">来源：'+cpEsc(cite)+'</div>':'')+
  '</div>';
}

/* ── 纯图表区总装 ── */
function cpChartsSection(prof){
  var ch=prof.charts||{};
  var cards=[
    cpChartStructure(ch.structure),
    cpChartGdp(ch.gdp_trend),
    cpChartGrowth(ch.growth),
    cpChartCompare(ch.compare),
    cpChartChain(ch.chain),
    cpChartPrefRadar(prof.preference),
    cpChartBalance(prof)
  ].filter(Boolean);
  if(!cards.length) return '';
  // 图表放在最前，必须先交代读图前提：年份口径不统一、未覆盖项、以及本轮缺哪些图。
  // 否则读者会把不同年份的数字横向比较，或误以为"没画的图=该市没有这项"。
  var prem=cpChartsPremise(prof, ch, cards.length);
  return '<div style="font-size:14px;font-weight:750;color:#0b183b;margin:18px 0 4px;padding-left:9px;border-left:3px solid #0ea5a4">一、数据图表</div>'+
    prem+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start">'+cards.join('')+'</div>';
}

/* 读图前提说明：口径 / 数据源 / 本轮未出图的项 */
function cpChartsPremise(prof, ch, nCards){
  // 年份：从 structure.year 与 gdp_trend 年份汇总，提示口径可能跨年
  var yrs={};
  if(ch.structure&&ch.structure.year) yrs[String(ch.structure.year)]=1;
  (ch.gdp_trend||[]).forEach(function(d){ if(d&&d.year) yrs[String(d.year)]=1; });
  var yl=Object.keys(yrs).sort();
  // 本轮缺哪些图（明确告知，避免"没画=没有"的误读）
  var miss=[];
  if(!ch.structure)  miss.push('三次产业结构');
  if(!(ch.gdp_trend&&ch.gdp_trend.length>1)) miss.push('GDP走势');
  if(!(ch.growth&&ch.growth.length))  miss.push('增速指标');
  if(!ch.compare)    miss.push('竞争城市对比');
  if(!(ch.chain&&ch.chain.length))    miss.push('产业链强弱');
  var items=[];
  items.push('<b>数据源</b>：本市智库材料（含政府公报、统计公报与上传佐证），'+
             '仅呈现可提取到纯数值的指标，缺数据的图自动隐藏、不以 0 充数');
  if(yl.length) items.push('<b>年份口径</b>：图中数据年份为 '+yl.map(cpEsc).join('、')+
             '，各指标统计年度可能不一致，横向比较前请先核对年份');
  items.push('<b>统计口径</b>：绝对量按现价、增速按不变价；公报数为快报口径，'+
             '后续经普查修订可能与本图存在差异');
  if(miss.length) items.push('<b>本轮未出图</b>：'+miss.join('、')+
             '——材料中暂无可用纯数值，非该市不存在该项');
  items.push('<b>偏好类图表</b>：置信度雷达反映的是判断依据强弱，'+
             '非该市招商意愿强弱');
  return '<div style="border:1px solid #d6e6f2;background:#f6fbfe;border-radius:9px;padding:11px 13px;margin:0 0 12px 0">'+
    '<div style="font-size:11px;font-weight:750;color:#0e7490;letter-spacing:.06em;margin-bottom:6px">读图前提 · 共 '+nCards+' 张图</div>'+
    items.map(function(x){
      return '<div style="font-size:11.5px;color:#4a6480;line-height:1.75;padding:1.5px 0">· '+x+'</div>';
    }).join('')+
  '</div>';
}

/* ── 主视图 ── */
function opsCityProfile(){
  var key=cpProjKey();
  if(!key)return '<div class="ops-ui-page">'+opsPageHead('城市画像','查看城市客观条件、招商偏好及其依据。')+opsEmpty('暂无可画像的城市','请先在「报告任务」生成报告并发布到城市智库。')+'</div>';
  var p=PROJECTS[key], city=p.city||key;
  var prof=p.profile||null;
  var nChunks=cpCorpus(city).length;
  var ob=cpOnboarding(city);
  var nItv=cpInterviewCount(city);
  var ts=prof&&prof.__ts?new Date(prof.__ts):null;
  var tsStr=ts?((ts.getMonth()+1)+'/'+ts.getDate()+' '+ts.getHours()+':'+('0'+ts.getMinutes()).slice(-2)):'—';
  var stale=(prof&&prof.__chunks&&nChunks>prof.__chunks);

  var action='<button class="ops-ui-button is-primary" onclick="cpGenerate(1)"'+(cpBusy?' disabled':'')+'>'+(cpBusy?'生成中…':prof?'重新生成':'生成城市画像')+'</button>';
  var head=opsPageHead('城市画像','查看城市客观条件、招商偏好及其依据。',action)+'<div class="ops-ui-workspacebar"><label class="ops-ui-filter">当前城市<select id="opsProfileCity" onchange="cpCity=this.value;cpErr=\'\';renderOpsV2()">'+cpCityOptions()+'</select></label><span class="ops-ui-muted">'+cpEsc(p.org||'')+(prof?' · 生成于 '+tsStr:'')+'</span></div>';

  // 数据源条：明确告诉运营方这份画像吃了什么
  var srcBar='<div class="ops-ui-metric-grid">'+
    cpStat('<span data-ops-icon="resource"></span>','智库材料', nChunks+' 条', '画像事实底座')+
    cpStat('<span data-ops-icon="demand"></span>','招商偏好问卷', ob?'已填写':'未填写', ob?'作为 stated 证据校准':'偏好只能反推')+
    cpStat('<span data-ops-icon="contact"></span>','干部访谈', nItv+' 条', nItv?'偏好与信息完备度参考':'暂无访谈记录')+
    cpStat('<span data-ops-icon="traceability"></span>','画像状态', prof?(stale?'待更新':'已生成'):'未生成', stale?'材料已新增，建议重算':'')+
  '</div>';

  if(cpErr) head+='<div style="padding:11px 14px;border:1px solid #fecaca;background:#fef2f2;border-radius:9px;color:#b91c1c;font-size:12.5px;margin-bottom:12px">'+cpEsc(cpErr)+'</div>';

  if(cpBusy) return '<div class="ops-ui-page">'+head+srcBar+
    '<div style="border:1px solid #e8edf5;border-radius:10px;background:#fff;padding:34px;text-align:center">'+
      '<div style="font-size:13px;font-weight:700;color:#0b183b">正在读取 '+cpEsc(city)+' 全量智库材料并刻画画像…</div>'+
      '<div style="font-size:12px;color:#9aa5b5;margin-top:6px;line-height:1.7">依据当前工作区 '+nChunks+' 条材料，保留可追溯的完整摘录<br>分析期间可继续查看材料，结果按当前版本校验</div>'+
    '</div></div>';

  if(!prof) return '<div class="ops-ui-page">'+head+srcBar+
    '<div style="border:1px dashed #cbd7e6;border-radius:10px;background:#fbfcfe;padding:34px;text-align:center">'+
      '<div style="font-size:30px;margin-bottom:8px"><span data-ops-icon="city" data-ops-icon-size="36"></span></div>'+
      '<div style="font-size:14px;font-weight:700;color:#0b183b">尚未生成 '+cpEsc(city)+' 的城市画像</div>'+
      '<div style="font-size:12.5px;color:#5a7398;margin-top:8px;line-height:1.8">画像会从 '+nChunks+' 条智库材料反推该市的客观条件（经济体量·产业结构·园区承载·链主·配套）<br>与招商偏好（产业方向·园区·企业规模·投资强度），每条结论标注来源与置信度'+
      (ob?'<br>并用已填写的招商偏好问卷做校准':'<br><b style="color:#b45309">该市未填写招商偏好问卷，偏好部分将全部为「材料反推」</b>')+'</div>'+
      '<button onclick="cpGenerate(1)" style="margin-top:16px;padding:10px 20px;border-radius:9px;border:none;cursor:pointer;font-size:13px;font-weight:650;color:#fff;background:linear-gradient(135deg,#1a56db,#6366f1)">开始生成</button>'+
    '</div></div>';

  var o=prof.objective||{}, pref=prof.preference||{};
  var body='';
  if(prof.summary) body+='<div style="border:1px solid #bfdbfe;background:#f5f9ff;border-radius:10px;padding:14px 16px;margin-bottom:14px">'+
    '<div style="font-size:11px;font-weight:750;color:#1d4ed8;letter-spacing:.08em;margin-bottom:6px">画像总览</div>'+
    '<div style="font-size:13.5px;color:#22364f;line-height:1.85">'+cpEsc(prof.summary)+'</div></div>';

  // 一、数据图表（图最直观，放最前；细节文字在后）
  body+=cpChartsSection(prof);

  // 二、客观自身条件
  var objBlocks=[
    cpObjBlock('经济体量','<span data-ops-icon="funding"></span>',o.economy), cpObjBlock('产业结构','<span data-ops-icon="industry-analysis"></span>',o.structure),
    cpObjBlock('主导产业','<span data-ops-icon="industry"></span>',o.industry), cpObjBlock('园区与承载','<span data-ops-icon="city"></span>',o.park),
    cpObjBlock('链主企业','<span data-ops-icon="enterprise"></span>',o.anchor),   cpObjBlock('配套与成本','<span data-ops-icon="citation"></span>',o.cost)
  ].filter(Boolean);
  body+='<div style="font-size:14px;font-weight:750;color:#0b183b;margin:18px 0 10px;padding-left:9px;border-left:3px solid #1d4ed8">二、客观自身条件</div>';
  body+= objBlocks.length
    ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start">'+objBlocks.join('')+'</div>'
    : '<div style="font-size:12.5px;color:#a8b3c4;padding:12px 0">材料中未提取到可量化的客观条件</div>';

  // 三、招商偏好
  body+='<div style="font-size:14px;font-weight:750;color:#0b183b;margin:20px 0 4px;padding-left:9px;border-left:3px solid #7c3aed">三、招商偏好</div>';
  body+='<div style="font-size:11.5px;color:#8492a6;margin:0 0 10px 12px">'+
    (prof.__hasOnboarding?'蓝框=问卷明示（stated），其余=材料反推（inferred）':'该市未填问卷，全部为材料反推，建议补填问卷提升置信度')+'</div>';
  body+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start">'+
    cpPrefCard('优先产业方向','<span data-ops-icon="industry"></span>',pref.industry)+
    cpPrefCard('重点园区','<span data-ops-icon="city"></span>',pref.park)+
    cpPrefCard('理想企业规模','<span data-ops-icon="industry-analysis"></span>',pref.scale)+
    cpPrefCard('期望投资强度','<span data-ops-icon="funding"></span>',pref.invest)+
    cpPrefCard('承载能力','<span data-ops-icon="land"></span>',pref.capacity)+
  '</div>';

  // 四、优劣势与缺口
  var lists=[
    cpList('不可复制优势','<span data-ops-icon="success"></span>',prof.strength,'#0f766e','#e9f7f6'),
    cpList('真实短板','<span data-ops-icon="warning"></span>',prof.weakness,'#b45309','#fff7ed'),
    cpList('问卷与材料冲突','<span data-ops-icon="warning"></span>',prof.conflicts,'#b91c1c','#fef2f2'),
    cpList('画像缺口·待补材料','<span data-ops-icon="attachment"></span>',prof.gaps,'#4f46e5','#f5f3ff')
  ].filter(Boolean);
  if(lists.length){
    body+='<div style="font-size:14px;font-weight:750;color:#0b183b;margin:20px 0 10px;padding-left:9px;border-left:3px solid #0f766e">四、优劣势与画像缺口</div>';
    body+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start">'+lists.join('')+'</div>';
  }

  // 信息完备度（原「干部配合度」——措辞会指向对方担责，客户看到易生嫌隙；
  // 改为只描述材料本身状态：待补充 / 部分完备 / 较完备）
  var eng=prof.engagement||{};
  if(eng.level||(eng.signals||[]).length){
    var el={high:['#0f766e','#e9f7f6','较完备'],medium:['#b45309','#fff7ed','部分完备'],low:['#5a7398','#f1f5f9','待补充']}[eng.level]||['#64748b','#f1f5f9','待评估'];
    body+='<div style="margin-top:14px;border:1px solid #e8edf5;border-radius:10px;background:#fff;padding:12px 14px">'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'+
        '<span style="font-size:13px;font-weight:700;color:#0b183b"><span data-ops-icon="contact"></span> 访谈信息完备度</span>'+
        '<span style="font-size:10px;padding:2px 8px;border-radius:5px;color:'+el[0]+';background:'+el[1]+';font-weight:650">'+el[2]+'</span></div>'+
      (eng.signals||[]).map(function(s){
        return '<div style="font-size:12px;color:#5a7398;line-height:1.7;padding:3px 0">· '+cpEsc(s)+'</div>';
      }).join('')+'</div>';
  }
  return '<div class="ops-ui-page">'+head+srcBar+body+'</div>';
}

function opsReportRows(){return (REPORT_REQUESTS||[]).concat(typeof _rrOutboxRows==='function'?_rrOutboxRows():[]);}
function opsReportLabel(row){if(row.submissionBlocked||['failed','cancelled','blocked'].indexOf(row.status)>=0)return '需处理';return {done:'已完成',pending:'排队中',running:'运行中'}[row.status]||'待处理';}
function opsBrandOverviewHero(){
  return '<section class="ops-brand-hero" aria-label="城市招商协同"><div class="ops-brand-hero-copy"><span class="ops-brand-kicker">城市有底稿 · 招商有方向</span><h2>把城市、资源与项目，<br>连接起来。</h2><p>围绕城市研究、资料管理与项目跟进，<br>让每一项招商工作都有清楚的下一步。</p></div><div class="ops-brand-hero-art"><img src="'+opsBrandImage('city')+'" alt="城市与园区建筑概念图"><span>城市招商 · 协同工作</span></div></section>';
}
function opsBrandShortcuts(){
  var items=[['reports','report','报告与研究','跟进城市报告的生成、下载和发布'],['rag','city-library','城市知识底稿','整理资料、补充依据与共享知识'],['demands','investment-docking','招商项目协同','接收需求、核验企业与记录反馈']];
  return '<div class="ops-brand-flow" aria-label="快捷工作入口">'+items.map(function(item){return '<button type="button" class="ops-brand-shortcut" onclick="'+opsHandler('opsGo',item[0])+'">'+opsIcon(item[1],23)+'<span>'+item[2]+'<small>'+item[3]+'</small></span>'+opsIcon('next',15)+'</button>';}).join('')+'</div>';
}
function opsOverview(){
  var projects=Object.keys(PROJECTS||{}),cities=Object.create(null);projects.forEach(function(k){var p=PROJECTS[k];if(p&&p.city)cities[p.city]=true;});
  var users=Object.keys(USER_PROFILES||{}),codes=Object.keys(INVITE_CODES||{}),reports=opsReportRows();
  var demandCount=projects.filter(function(k){return PROJECTS[k]&&PROJECTS[k].isDemand===true;}).length;
  var activeReports=reports.filter(function(r){return !r.submissionBlocked&&(r.status==='pending'||r.status==='running');}).length;
  var attention=reports.filter(function(r){return r.submissionBlocked||['failed','cancelled','blocked'].indexOf(r.status)>=0;}).length;
  var activeCodes=codes.filter(function(c){return !INVITE_CODES[c].revoked;}).length;
  var metrics=[['报告任务',reports.length,activeReports+' 进行中 · '+attention+' 需处理','reports'],['招商项目',demandCount,Object.keys(cities).length+' 个城市工作数据','demands'],['生效邀请码',activeCodes,codes.length+' 个邀请码总计','invitations'],['注册用户',users.length,'查看联系人与所属工作区','users']];
  var stats='<div class="ops-ui-stats">'+metrics.map(function(m){return '<button class="ops-ui-stat" onclick="'+opsHandler('opsGo',m[3])+'"><span class="ops-brand-stat-label">'+opsIcon({reports:'report',demands:'demand',invitations:'permissions',users:'account'}[m[3]],17)+m[0]+'</span><strong class="ops-ui-stat-value">'+m[1]+'</strong><span class="ops-ui-muted">'+m[2]+'</span></button>';}).join('')+'</div>';
  var recentReports=reports.slice().sort(function(a,b){return (b.ts||0)-(a.ts||0);}).slice(0,5);
  var reportBody=recentReports.length?'<div class="ops-ui-recent">'+recentReports.map(function(r){return '<button class="ops-ui-recent-row" onclick="'+opsHandler('opsGo','reports')+'"><span><strong>'+_authEscape(r.city||'未填写城市')+'</strong><small>'+_authEscape(r.id||'报告申请')+' · '+opsDate(r.ts)+'</small></span><span class="ops-ui-badge '+(opsReportLabel(r)==='需处理'?'is-danger':r.status==='done'?'is-on':'is-muted')+'">'+opsReportLabel(r)+'</span></button>';}).join('')+'</div>':opsEmpty('暂无报告任务','在报告任务中选择城市并提交申请。');
  var recentInvites=codes.slice().sort(function(a,b){return (INVITE_CODES[b].createdAt||0)-(INVITE_CODES[a].createdAt||0);}).slice(0,5);
  var inviteBody=recentInvites.length?'<div class="ops-ui-recent">'+recentInvites.map(function(code){var inv=INVITE_CODES[code];return '<button class="ops-ui-recent-row" onclick="'+opsHandler('opsGo','invitations')+'"><span><strong>'+_authEscape(inv.city||'未填写城市')+'</strong><small>工作区 '+_authEscape(inv.projKey||'—')+' · '+(inv.usedBy||[]).length+' 人使用</small></span><span class="ops-ui-badge '+(inv.revoked?'is-danger':inv.distributed?'is-on':'is-muted')+'">'+(inv.revoked?'已作废':inv.distributed?'已分发':'待分发')+'</span></button>';}).join('')+'</div>':opsEmpty('暂无邀请码','生成邀请码后，可邀请城市团队注册加入。');
  return '<div class="ops-ui-page">'+opsPageHead('运营总览','从这里查看待处理事项，进入具体页面开展工作。','<button class="ops-ui-button is-primary" onclick="opsGo(\'reports\')">进入报告任务</button>')+opsBrandOverviewHero()+stats+opsBrandShortcuts()+'<div class="ops-ui-dashboard"><section class="ops-ui-card"><div class="ops-ui-card-head"><h2>最近报告任务</h2><button class="ops-ui-button" onclick="opsGo(\'reports\')">查看全部</button></div>'+reportBody+'</section><section class="ops-ui-card"><div class="ops-ui-card-head"><h2>最近邀请码</h2><button class="ops-ui-button" onclick="opsGo(\'invitations\')">管理邀请码</button></div>'+inviteBody+'</section></div></div>';
}
function opsReports(){
  var state=OPS_UI.reports;
  return '<div class="ops-ui-page">'+opsPageHead('报告任务','查看每月城市报告更新、实时进度，以及下载和发布已完成的报告。')+opsMonthlyOverview()+'<div class="ops-ui-toolbar"><label class="ops-ui-search">搜索任务<input id="opsReportSearch" value="'+_authEscape(state.query)+'" placeholder="搜索城市 / 省份 / 任务编号" oninput="opsFilterChange(\'reports\',\'query\',this.value)"></label><label class="ops-ui-filter">任务状态<select id="opsReportStatus" onchange="opsFilterChange(\'reports\',\'status\',this.value)">'+[['all','全部状态'],['active','进行中'],['done','已完成'],['attention','需处理']].map(function(item){return '<option value="'+item[0]+'"'+(state.status===item[0]?' selected':'')+'>'+item[1]+'</option>';}).join('')+'</select></label></div><div id="opsReportResults">'+rrPanel(state)+'</div></div>';
}
function opsMonthlyOverview(){
  var map=typeof CITY_WORKSPACES!=='undefined'&&CITY_WORKSPACES||{},cities=Object.keys(map).filter(function(city){return !!opsCityWorkspace(city);}).sort();
  if(!cities.length)return opsEmpty('暂无月度更新地区','在「地区与邀请码」设置地区主工作区后，每月 1 日 09:00（北京时间）更新报告。');
  return '<section class="ops-ui-card" style="margin-bottom:16px"><div class="ops-ui-card-head"><h2>月度报告更新</h2><span class="ops-ui-muted">每月 1 日 09:00（北京时间）</span></div><div class="ops-ui-table-wrap"><table class="ops-ui-table"><thead><tr><th scope="col">地区</th><th scope="col">状态与下次更新</th></tr></thead><tbody>'+cities.map(function(city){return '<tr><td>'+_authEscape(city)+'</td><td>'+opsMonthlyCell(city)+'</td></tr>';}).join('')+'</tbody></table></div></section>';
}
function opsDemandSpecificationHtml(item){
  if(!item||(!item.demandSpec&&item.demandContract!=='industry-demand-v1'))return '';
  var spec=item.demandSpec||{},priority=item.selectedPriority||{},direct=item.demandOrigin==='direct'||spec.source==='user_direct';
  var origin=item.sourceAnalysisTopic||item.analysisTopic||'';
  var scopes={local:'本地原文范围',local_enterprise:'本地关联企业业务',industry:'行业共性，非本地缺失',project:'具名项目范围'};
  var sources=(Array.isArray(priority.sources)?priority.sources:[]).filter(function(source){
    if(!source||typeof source.quote!=='string'||!source.quote.trim())return false;
    try{var url=new URL(source.url);return url.protocol==='https:'&&!!url.hostname&&!url.username&&!url.password;}catch(e){return false;}
  });
  function line(label,value){return value?'<div style="margin-top:7px"><strong style="color:#52627a">'+label+'</strong><div style="white-space:pre-line;color:#334155">'+_authEscape(value)+'</div></div>':'';}
  return '<div class="ops-demand-specification" style="font-size:12px;line-height:1.75">'+
    line('具体招引诉求',spec.description||item.need||'')+
    line('补充条件',spec.conditions||'')+line('需求联系人',spec.contactName||'')+line('联系方式',spec.contactMethod||'')+
    (direct?'<p class="ops-receiving-help">来源：客户直接提交。以上诉求与条件由客户填写，接单后需逐项沟通确认。</p>':'<div style="margin-top:12px;padding-top:10px;border-top:1px solid #e2e8f0">'+
      line('来源分析方向',origin)+line('对应招引建议',priority.focus||'')+line('分析适用范围',scopes[priority.scope]||'')+
      '<details style="margin-top:8px"><summary style="cursor:pointer;color:#1d4ed8">查看原建议与依据</summary>'+
        line('建议依据',priority.reason||'')+line('对照分析',priority.comparison||'')+line('原建议行动',priority.action||'')+
        sources.map(function(source){return '<div style="margin-top:8px"><a href="'+_authEscape(source.url)+'" target="_blank" rel="noopener noreferrer">'+_authEscape(source.title||source.label||source.id||'查看来源原文')+'</a><blockquote style="margin:5px 0;white-space:pre-line">'+_authEscape(source.quote)+'</blockquote></div>';}).join('')+
      '</details>'+
    '</div><p style="margin:8px 0 0;color:#8492a6">企业筛选与核验以本条具体诉求为准；来源报告仅提供分析背景。</p>')+'</div>';
}
function opsDemands(){
  var state=OPS_UI.demands,cities=Object.create(null);Object.keys(PROJECTS||{}).forEach(function(k){var p=PROJECTS[k];if(p&&p.isDemand===true&&p.city)cities[p.city]=true;});
  return '<div class="ops-ui-page">'+opsPageHead('招商项目','接收客户的具体需求，明确承办人，处理企业核验并向客户反馈。')+opsReceivingOverview()+'<div class="ops-ui-toolbar"><label class="ops-ui-search">搜索项目<input id="opsDemandSearch" value="'+_authEscape(state.query)+'" placeholder="搜索需求 / 来源方向 / 城市 / 单位" oninput="opsFilterChange(\'demands\',\'query\',this.value)"></label><label class="ops-ui-filter">处理状态<select id="opsDemandStatus" onchange="opsSetReceivingFilter(this.value)">'+[['all','全部状态'],['submitted','待受理'],['processing','处理中'],['needs_info','待客户补充'],['feedback','已反馈']].map(function(item){return '<option value="'+item[0]+'"'+(state.status===item[0]?' selected':'')+'>'+item[1]+'</option>';}).join('')+'</select></label><label class="ops-ui-filter">城市<select id="opsDemandCity" onchange="opsFilterChange(\'demands\',\'city\',this.value)"><option value="">全部城市</option>'+Object.keys(cities).sort().map(function(city){return '<option value="'+_authEscape(city)+'"'+(state.city===city?' selected':'')+'>'+_authEscape(city)+'</option>';}).join('')+'</select></label></div><div id="opsDemandResults">'+opsDemandResults()+'</div></div>';
}

/* ══ 招商项目：保留既有项目操作 ══ */
function opsDemandResults(){
  // 管理端（运营方）跨城市查看所有项目
  // 关键修复：只显示「已正式提交招商需求」的子项目。父项目/城市产业分析工作区
  // (如 sz、id==城市名、topic 形如「XX产业链招引」的占位项目) 的 topic 会随政府端
  // 选中的产业方向实时变化，绝不能当招商项目展示——否则政府端点氢气，管理端就跟着变。
  var projKeys = Object.keys(PROJECTS).filter(function(k){
    var x=PROJECTS[k]; if(!x) return false;
    // 只显示政府端正式提交的招商需求（isDemand=true），与政府端保持一致
    if(x.isDemand!==true)return false;
    if(typeof opsIsSubmittedDemand==='function'&&!opsIsSubmittedDemand(k,x))return false;
    var state=OPS_UI.demands,q=state.query.trim().toLowerCase();
    return (!state.city||x.city===state.city)&&(!state.status||state.status==='all'||(typeof opsIntakeStatus==='function'&&opsIntakeStatus(x)===state.status))&&(!q||[k,x.city,x.topic,x.demandTitle,x.org,(x.demandSpec||{}).description,(x.demandSpec||{}).conditions,(x.selectedPriority||{}).focus].join(' ').toLowerCase().indexOf(q)>=0);
  });

  if(!projKeys.length)return opsEmpty('暂无符合条件的招商项目','政府端正式提交的招商需求会出现在这里；可调整筛选后再查看。');

  function opsProjCard(k){
    var p  = demandDisplayProject(k, PROJECTS[k]);
    var rs = REPORTSTATE[k];
    // 渲染只展示现有数据；企业分析由明确的操作按钮触发。
    var ups = (UPLOADS[k]||[]);
    var clues = (p.clues||[]);
    // 已确认结论：按该项目「当前产业方向」自己确认的待确认事项数统计
    var confirmedCount = 0;
    (function(){
      var topic = p.topic || '';
      var pend = null;
      // 优先取该方向缓存的 pendingByTopic
      if(rs && rs.pendingByTopic && topic && rs.pendingByTopic[topic]) pend = rs.pendingByTopic[topic];
      // 回退：该项目当前 PENDING_CONFIRMS（单方向项目）
      if((!pend||!pend.length) && typeof PENDING_CONFIRMS!=='undefined' && PENDING_CONFIRMS[k]) pend = PENDING_CONFIRMS[k];
      if(pend && pend.length){
        confirmedCount = pend.filter(function(x){return x.status==='confirmed'||x.status==='edited';}).length;
      }
    })();
    var stage = p.stage||1;
    var directDemand=p.demandOrigin==='direct'||(p.demandSpec||{}).source==='user_direct';
    var stageNames = projStages(p);
    var stageName  = directDemand&&stage<=4?'已提交需求':stageNameOf(p, stage);
    var stageColors= ['#9aa5b5','#f59e0b','#3b82f6','#6366f1','#22c55e'];
    var stageColor = stageColors[stage-1]||'#8b5cf6';

    // 需求摘要：从 DEMANDS 里找关联的
    var demand = DEMANDS.find(function(d){return d.projKey===k;});

    // 候选线索统计
    var aiClues  = clues.filter(function(c){return c.status==='ai_scan';});
    var opsClues = clues.filter(function(c){return c.status==='ops_rec';});
    // 资源归属以具体项目为准；同城的其他需求不能共用推送统计。
    function matchesThisProject(m){
      return !!m && m.projKey===k && (!m.city || m.city===p.city);
    }
    var matchedEnts = OPS_ENT.filter(function(e){
      return (e.matches||[]).some(matchesThisProject);
    });
    var pushedEnts = matchedEnts.filter(function(e){return (e.matches||[]).some(function(m){return matchesThisProject(m)&&m.pushed===true;});});
    var checking = matchedEnts.filter(function(e){return !(e.matches||[]).some(function(m){return matchesThisProject(m)&&m.pushed===true;});});

    var _pOpen = !!(window.__opsProjOpen && window.__opsProjOpen[k]);
    return '<div style="background:#fff;border:1.5px solid #e8edf5;border-radius:16px;overflow:hidden;margin-bottom:16px">' +
      // 头部
      '<div onclick="toggleOpsProj(' + _authEscape(JSON.stringify(k)) + ')" style="padding:16px 20px;background:#f8faff;border-bottom:1px solid ' + (_pOpen?'#e8edf5':'transparent') + ';display:flex;align-items:center;gap:12px;cursor:pointer">' +
        '<span style="font-size:12px;color:#1a56db;display:inline-block;transform:rotate(' + (_pOpen?'90':'0') + 'deg);transition:transform .15s">&#9654;</span>' +
        '<div style="font-size:14px;color:#0b183b;font-weight:700">' + _authEscape(typeof industryDemandProjectTitle==='function'?industryDemandProjectTitle(p):p.topic) + '</div>' +
        '<div style="margin-left:auto;text-align:right;display:flex;align-items:center;gap:8px">' +
          (typeof opsIntakeBadge==='function'?opsIntakeBadge(p):'') +
          '<div style="padding:4px 12px;background:' + stageColor + ';color:#fff;border-radius:20px;font-size:12px;font-weight:650;display:inline-block">' + _authEscape(stageName) + '</div>' +
        '</div>' +
      '</div>' +
      (_pOpen ? (
      (typeof opsReceivingPanel==='function'?opsReceivingPanel(k,p):'') +
      (typeof opsVerificationPanel==='function'?opsVerificationPanel(k,p):'') +
      (typeof opsCustomerActivity==='function'?opsCustomerActivity(k):'') +
      // Direct submissions have no report-generation milestones.
      (directDemand?'':'<div style="padding:12px 20px;border-bottom:1px solid #f0f4ff;display:flex;gap:0">' +
        stageNames.map(function(s,si){
          var n=si+1;
          var isDone=(n<stage), isCur=(n===stage);
          var bg=isDone?'#1a56db':isCur?'#eff6ff':'#f5f7fb';
          var color=isDone?'#fff':isCur?'#1a56db':'#9aa5b5';
          var fw=isCur?'700':'400';
          return '<div style="flex:1;padding:6px 4px;text-align:center;background:'+bg+';font-size:10.5px;font-weight:'+fw+';color:'+color+';border-right:1px solid #e8edf5">' +
            (isDone?'<span data-ops-icon="success" data-ops-icon-size="12"></span> ':'')+_authEscape(s[0])+'</div>';
        }).join('') +
      '</div>') +
      // 阶段推进面板：回复说明 + 选下一阶段 + 新增自定义阶段 + 留痕列表
      '<div style="padding:12px 20px;border-bottom:1px solid #e0e7ff;background:#fafbff">' +
        '<div style="font-size:12px;font-weight:700;color:#1a56db;margin-bottom:8px">'+(directDemand?'对接进展记录':'项目阶段记录')+'</div>' +
        '<textarea id="stage-note-' + _authEscape(k) + '" placeholder="记录本次阶段变化的实际依据；客户回复请使用上方受理面板" ' +
          'style="width:100%;box-sizing:border-box;padding:8px 12px;border:1.5px solid #e8edf5;border-radius:8px;font-size:12.5px;resize:vertical;min-height:50px;outline:none;line-height:1.6"></textarea>' +
        '<div style="display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap">' +
          '<select id="stage-target-' + _authEscape(k) + '" style="flex:1;min-width:140px;padding:8px 12px;border:1.5px solid #e8edf5;border-radius:8px;font-size:12.5px;background:#fff;color:#0b183b;outline:none">' + stageOptions(p, k) + '</select>' +
          '<button onclick="saveStageAdvance(' + _authEscape(JSON.stringify(k)) + ')" style="padding:8px 14px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:8px;font-size:12.5px;font-weight:650;cursor:pointer;white-space:nowrap">保存并推进</button>' +
          '<button onclick="addCustomStage(' + _authEscape(JSON.stringify(k)) + ')" style="padding:8px 12px;background:#fff;border:1.5px solid #c4b5fd;border-radius:8px;font-size:12.5px;color:#6d28d9;cursor:pointer;font-weight:600;white-space:nowrap">＋ 新增阶段</button>' +
        '</div>' +
        renderStageLog(p) +
      '</div>' +
      // 统计网格
      '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;border-bottom:1px solid #f0f4ff">' +
        statCell('<span data-ops-icon="search"></span> AI扫描线索', aiClues.length+'条', aiClues.length>0?'#6d28d9':'#9aa5b5') +
        statCell('已推送待核资源', pushedEnts.length+'条', pushedEnts.length>0?'#b45309':'#9aa5b5') +
        statCell('候选待核', checking.length+'条', checking.length>0?'#b45309':'#9aa5b5') +
      '</div>' +
      // 指标说明
      '<div style="padding:10px 20px;background:#fbfcff;border-bottom:1px solid #f0f4ff;display:flex;flex-direction:column;gap:6px">' +
        '<div style="display:flex;align-items:flex-start;gap:7px;font-size:11.5px;color:#6b7280;line-height:1.6">' +
          '<span style="color:#6d28d9;font-weight:700;flex-shrink:0"><span data-ops-icon="search"></span> AI扫描线索</span>' +
          '<span>从当前工作区材料整理的<b>待筛选企业</b>。有来源仅代表材料可追溯；须逐家核对产品、需求和适配理由后才能推送。</span>' +
        '</div>' +
        '<div style="display:flex;align-items:flex-start;gap:7px;font-size:11.5px;color:#6b7280;line-height:1.6">' +
          '<span style="color:#b45309;font-weight:700;flex-shrink:0">资源待核</span>' +
          '<span>仅统计<b>关联当前项目</b>的企业资源。「已推送待核资源」表示已推送到本项目；「候选待核」表示已匹配但尚未推送。推送只代表信息送达，业务适配与真实投资意向仍需逐项核实。</span>' +
        '</div>' +
      '</div>' +
      // 需求块
      (p.demandSpec||p.demandContract==='industry-demand-v1' ? (typeof opsReceivingPanel==='function'?'':
        '<div style="padding:14px 20px;background:#f8faff;border-bottom:1px solid #e2e8f0">'+
          '<div style="font-size:11.5px;font-weight:650;color:#1d4ed8;margin-bottom:6px">独立招商需求</div>'+
          opsDemandSpecificationHtml(p)+
        '</div>')
      : demand ?
        '<div style="padding:14px 20px;background:#fffbeb;border-bottom:1px solid #fde68a">' +
          '<div style="font-size:11.5px;font-weight:650;color:#92400e;margin-bottom:6px"><span data-ops-icon="demand"></span> 招引需求</div>' +
          '<div style="font-size:13px;color:#1e293b;line-height:1.65"><strong>' + _authEscape(demand.topic||p.topic||'') + '</strong>' + (demand.domain?' · ' + _authEscape(demand.domain):'') + '</div>' +
          '<div style="font-size:12px;color:#8492a6;margin-top:3px">' + _authEscape(demand.need||'需求详情见研判报告') + '</div>' +
        '</div>'
      : rs ?
        '<div style="padding:12px 20px;background:#f9fafb;border-bottom:1px solid #f0f4ff">' +
          '<div style="font-size:12px;color:#8492a6">'+_authEscape(topicScoreDisplay(p.topic,k))+'；需求尚未提交</div>' +
        '</div>'
      : '<div style="padding:12px 20px;background:#f9fafb;border-bottom:1px solid #f0f4ff">' +
          '<div style="font-size:12px;color:#b0bac8">尚未生成研判报告</div>' +
        '</div>'
      ) +
      // AI 企业漏斗（真实 DeepSeek 分析）
      funnelBlock(k) +
      // 操作
      '<div style="padding:12px 20px;display:flex;gap:8px;flex-wrap:wrap">' +
        (rs ? '<button onclick="opsViewCityReport(' + _authEscape(JSON.stringify(k)) + ')" style="padding:7px 14px;background:#f8faff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:12.5px;color:#1a56db;cursor:pointer"><span data-ops-icon="report"></span> 查看报告</button>' : '') +
      '</div>'
      ) : '') +
    '</div>';
  }

  // AI 企业漏斗展示块（真实 DeepSeek 分析结果 + 一键推送 Top8）
  function funnelBlock(k){
    var p=PROJECTS[k]; if(!p) return '';
    var fn=p.funnel; var running=(typeof _funnelRunning!=='undefined')&&_funnelRunning[k];
    if(!window.__funnelCollapse) window.__funnelCollapse={};
    var collapsed=window.__funnelCollapse[k]===true;
    var head='<div style="padding:12px 20px 4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
      '<span onclick="toggleFunnelBlock('+_authEscape(JSON.stringify(k))+')" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none">'+'<span style="font-size:11px;color:#6d28d9;display:inline-block;transform:rotate('+(collapsed?'-90':'0')+'deg)">▼</span>'+'<span style="font-size:12.5px;font-weight:750;color:#0b183b">AI 企业漏斗</span>'+'</span>'+
      (fn?'<span style="font-size:11px;padding:2px 8px;background:#f5f3ff;color:#6d28d9;border-radius:10px">材料待筛选 '+fn.companies.length+' 家</span>':'')+
      '<div style="flex:1"></div>'+
      (fn&&fn.companies&&fn.companies.length?'<button onclick="showFunnelPyramid('+_authEscape(JSON.stringify(k))+')" style="padding:4px 10px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:11.5px;color:#1a56db;cursor:pointer;font-weight:600;margin-right:8px"><span data-ops-icon="industry-analysis"></span> 分级图谱</button>':'')+
      (running?'<span style="font-size:11.5px;color:#6d28d9"><span data-ops-icon="loading"></span> 分析中…</span>':'<button onclick="loadAIScanClues('+_authEscape(JSON.stringify(k))+')" style="padding:4px 10px;background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:8px;font-size:11.5px;color:#6d28d9;cursor:pointer;font-weight:600"><span data-ops-icon="refresh"></span> 重新分析</button>')+
    '</div>';
    if(collapsed) return head;
    if(fn&&fn.evidence_contract!=='saved-excerpts-v1')return head+'<div style="padding:12px 20px;color:#92400e">此旧清单尚未逐条核对来源。请重新分析后查看和推送。</div>';
    var body;
    if(running && !fn){
      body='<div style="margin:6px 20px 14px;text-align:center;padding:20px;background:#faf9ff;border-radius:10px;border:1px solid #ede9fe;font-size:12.5px;color:#6d28d9">⏳ AI 正在整理本条需求相关的材料企业，尚未完成业务适配审核…</div>';
    } else if(!fn){
      body='<div style="margin:6px 20px 14px;text-align:center;padding:18px;background:#f9fafb;border-radius:10px;border:1px solid #e8edf5">'+
        '<div style="font-size:12.5px;color:#9aa5b5;margin-bottom:8px">尚未生成企业漏斗</div>'+
        '<button onclick="loadAIScanClues('+_authEscape(JSON.stringify(k))+')" style="padding:6px 14px;background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:8px;font-size:12px;color:#6d28d9;cursor:pointer;font-weight:600"><span data-ops-icon="search"></span> 立即 AI 分析</button>'+
      '</div>';
    } else {
      var pushedTip=fn.pushed?'<span style="font-size:11px;color:#166534;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:3px 9px"><span data-ops-icon="success"></span> 已推送 '+(fn.pushedNames?fn.pushedNames.length:0)+' 家到政府端</span>':'';
      var pushBtn=fn.companies.length?'<button onclick="pushFunnelTopToGov('+_authEscape(JSON.stringify(k))+',8)" style="padding:7px 14px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:8px;font-size:12.5px;font-weight:650;cursor:pointer">逐家核对产品与需求后推送</button>':'<div role="status" style="color:#92400e;line-height:1.7">当前材料没有足够的相关企业证据，请补充产品名录或原始来源后重新分析。这不代表现实中不存在相关企业。</div>';
      if(!window.__funnelExpand) window.__funnelExpand={};
      var expandAll=window.__funnelExpand[k]===true;
      var COLLAPSE_N=8;
      var showList=expandAll?fn.companies:fn.companies.slice(0,COLLAPSE_N);
      var rows=showList.map(function(c,i){
        var isTop=i<8;
        return '<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid #f1f3f7">'+
          '<span style="flex-shrink:0;width:22px;height:22px;background:'+(isTop?'#eef2ff':'#f5f7fb')+';color:'+(isTop?'#4338ca':'#9aa5b5')+';border-radius:50%;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center">'+(i+1)+'</span>'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:12.5px;font-weight:650;color:#0b183b;display:flex;align-items:center;gap:6px;flex-wrap:wrap">'+
              '<span>'+_authEscape(c.name)+'</span>'+
              (c.listed?'<span style="font-size:10px;color:#6d28d9;background:#f5f3ff;border-radius:6px;padding:1px 6px">'+_authEscape(c.listed)+'</span>':'')+
              (isTop?'<span style="font-size:10px;color:#1a56db;background:#eff6ff;border-radius:6px;padding:1px 6px">待核候选</span>':'')+
            '</div>'+
            '<div style="font-size:11px;color:#8492a6;margin-top:2px">'+_authEscape(c.region||'')+(c.kind?' \u00b7 '+_authEscape(c.kind):'')+'</div>'+
            (c.fit?'<div style="font-size:11px;color:#4a5568;margin-top:3px;line-height:1.5">'+_authEscape(c.fit)+'</div>':'')+
            (c.signal
              ? '<div style="font-size:10.5px;color:#b45309;margin-top:3px;line-height:1.5"><span data-ops-icon="notification"></span> '+_authEscape(c.signal)+'</div>'
              : '<div style="font-size:10.5px;color:#b45309;margin-top:3px;line-height:1.5"><span data-ops-icon="document"></span> '+_authEscape(c.score_reason||c.fit||'仅为材料企业，需逐家核对业务适配和投资意向')+'</div>')+
            // 优质标注：有扩张需求 / 派系关联（无则不显示）
            (c.expansion?'<div style="font-size:10.5px;color:#166534;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:2px 7px;margin-top:4px;display:inline-block;line-height:1.5"><span data-ops-icon="progress"></span> 有扩张需求：'+_authEscape(c.expansion)+'</div>':'')+
            (c.faction?'<div style="font-size:10.5px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:2px 7px;margin-top:4px;margin-left:4px;display:inline-block;line-height:1.5"><span data-ops-icon="investment-docking"></span> 派系关联：'+_authEscape(c.faction)+'</div>':'')+
            // 评分卡分项构成
            '<div style="font-size:10px;color:#9aa5b5;margin-top:4px">业务适配待核 · 投资意向未知 · 实力待核</div>'+
            funnelEvidenceLinks(c)+
          '</div>'+
          '<span style="flex-shrink:0;font-size:13px;font-weight:800;color:'+(c.fit_score>=80?'#16a34a':c.fit_score>=60?'#d97706':'#6b7280')+'">'+_authEscape(c.fit_score==null?'待核':c.fit_score)+'<span style="font-size:10px;font-weight:600">'+(c.fit_score==null?'':'分')+'</span></span>'+
        '</div>';
      }).join('');
      var toggle='';
      if(fn.companies.length>COLLAPSE_N){
        toggle=expandAll
          ? '<div onclick="toggleFunnelExpand(' +_authEscape(JSON.stringify(k))+ ')" style="text-align:center;font-size:12px;color:#6d28d9;padding:10px 0 2px;cursor:pointer;font-weight:600">\u6536\u8d77 \u25b2</div>'
          : '<div onclick="toggleFunnelExpand(' +_authEscape(JSON.stringify(k))+ ')" style="text-align:center;font-size:12px;color:#6d28d9;padding:10px 0 2px;cursor:pointer;font-weight:600">\u5c55\u5f00\u5168\u90e8 '+fn.companies.length+' \u5bb6 \u25bc</div>';
      }
      body='<div style="margin:6px 20px 14px;padding:12px 14px;background:#fbfcff;border:1px solid #e8edf5;border-radius:10px">'+
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">'+pushBtn+pushedTip+'</div>'+
        rows+toggle+
      '</div>';
      '</div>';
    }
    return head+body;
  }

  // 按城市分组
  var cityGroups = Object.create(null); var cityOrder = [];
  projKeys.forEach(function(k){
    var c = (PROJECTS[k]||{}).city || '未分类';
    if(!cityGroups[c]){ cityGroups[c]=[]; cityOrder.push(c); }
    cityGroups[c].push(k);
  });
  if(window.__opsCityOpen == null){
    window.__opsCityOpen = Object.create(null);
    cityOrder.forEach(function(c){ window.__opsCityOpen[c] = true; });
  }
  var groups = cityOrder.map(function(city){
    var keys = cityGroups[city];
    var isOpen = window.__opsCityOpen[city] !== false;
    var maxStageProject = keys.map(function(k){return demandDisplayProject(k,PROJECTS[k]);}).reduce(function(latest,p){
      return !latest || p.stage>latest.stage?p:latest;
    },null);
    var maxStage = maxStageProject.stage;
    // 材料/城市智库确认是「城市级共享数据」，政府端上传在城市工作区(父项目 sz)上，
    // 而 keys 已过滤掉父项目 → 必须按「该城市全部项目」统计，否则显示「暂无材料」。
    var allCityKeys = Object.keys(PROJECTS).filter(function(k){ return (PROJECTS[k]||{}).city === city; });
    var totalUps = allCityKeys.reduce(function(n,k){ return n+((UPLOADS[k]||[]).length); }, 0);
    // 城市智库确认（城市级共享数据）：汇总该城市各项目的 KB_CONFIRMS
    var cityKbConfirms = allCityKeys.reduce(function(n,k){
      var cf = KB_CONFIRMS[k]||{};
      return n + Object.keys(cf).reduce(function(m,ki){return m+Object.keys(cf[ki]).length;},0);
    }, 0);
    var org = (PROJECTS[keys[0]]||{}).org || '';
    var header = '<div onclick="toggleOpsCity(' + _authEscape(JSON.stringify(city)) + ')" style="display:flex;align-items:center;gap:12px;padding:16px 20px;background:#eef4ff;border:1.5px solid #d6e4ff;border-radius:14px;cursor:pointer;margin-bottom:' + (isOpen?'14px':'0') + '">' +
      '<span style="font-size:13px;color:#1a56db;display:inline-block;transform:rotate(' + (isOpen?'90':'0') + 'deg)">&#9654;</span>' +
      '<span style="font-size:16px;font-weight:750;color:#0b183b">' + _authEscape(city) + '</span>' +
      '<span style="font-size:12px;color:#8492a6">' + _authEscape(org) + '</span>' +
      '<span style="margin-left:auto;display:flex;align-items:center;gap:10px">' +
        '<span style="font-size:12px;color:#4a5568">' + keys.length + ' 个项目</span>' +
        (cityKbConfirms>0 ? '<span style="font-size:12px;color:#1d4ed8;font-weight:600"><span data-ops-icon="success"></span> 城市智库已确认 ' + cityKbConfirms + ' 条</span>' : '') +
        (totalUps>0 ? '<button onclick="event.stopPropagation();opsViewCityUploads(' + _authEscape(JSON.stringify(encodeURIComponent(city))) + ')" style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:12px;color:#1a56db;cursor:pointer;font-weight:600"><span data-ops-icon="attachment"></span> 上传材料 ' + totalUps + ' 份 · 查看</button>' : '<span style="font-size:12px;color:#9aa5b5">暂无材料</span>') +
        '<span style="padding:3px 10px;background:#1a56db;color:#fff;border-radius:20px;font-size:11px;font-weight:650">' + _authEscape((maxStageProject.demandOrigin==='direct'||(maxStageProject.demandSpec||{}).source==='user_direct')&&maxStage<=4?'已提交需求':stageNameOf(maxStageProject,maxStage)) + '</span>' +
      '</span>' +
    '</div>';
    var body = isOpen ? '<div style="padding-left:6px">' + keys.map(opsProjCard).join('') + '</div>' : '';
    return '<div style="margin-bottom:18px">' + header + body + '</div>';
  }).join('');

  return '<div class="ops-ui-results-meta">'+cityOrder.length+' 个城市 · '+projKeys.length+' 个项目</div>'+groups;
}

function toggleFunnelBlock(k){
  if(!window.__funnelCollapse) window.__funnelCollapse={};
  window.__funnelCollapse[k]=!(window.__funnelCollapse[k]===true);
  try{ renderOpsV2&&renderOpsV2(); }catch(e){ try{render();}catch(_){} }
}

/* 折叠/展开某个城市分组 */
function toggleOpsCity(city){
  if(window.__opsCityOpen == null) window.__opsCityOpen = Object.create(null);
  window.__opsCityOpen[city] = (window.__opsCityOpen[city] === false);
  renderOpsV2();
}

/* 折叠/展开单个项目卡片（默认收起，点击头部展开） */
function toggleOpsProj(k){
  if(window.__opsProjOpen == null) window.__opsProjOpen = Object.create(null);
  window.__opsProjOpen[k] = !window.__opsProjOpen[k];
  try{ renderOpsV2&&renderOpsV2(); }catch(e){ try{render();}catch(_){} }
}

function statCell(label, value, color){
  return '<div style="padding:12px 16px;border-right:1px solid #f0f4ff">' +
    '<div style="font-size:11px;color:#9aa5b5;margin-bottom:3px">' + label + '</div>' +
    '<div style="font-size:15px;font-weight:700;color:' + color + '">' + value + '</div>' +
  '</div>';
}

function statCellClickable(label, value, color, onclick){
  return '<div style="padding:12px 16px;border-right:1px solid #f0f4ff;cursor:pointer;transition:background .15s" onclick="'+onclick+'" onmouseover="this.style.background=\'#eff6ff\'" onmouseout="this.style.background=\'\'">'+
    '<div style="font-size:11px;color:#9aa5b5;margin-bottom:3px">' + label + '</div>' +
    '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:15px;font-weight:700;color:' + color + '">' + value + '</span><span style="font-size:12px;color:#1a56db;font-weight:600;padding:4px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px">查看</span></div>' +
  '</div>';
}

/* 查看城市上传材料列表 */
function opsViewCityUploads(cityEnc){
  var city = decodeURIComponent(cityEnc);
  // 汇总该城市下所有项目的上传材料
  var items = [];
  Object.keys(PROJECTS).forEach(function(k){
    if((PROJECTS[k]||{}).city !== city) return;
    (UPLOADS[k]||[]).forEach(function(u){ items.push({proj:k, projTopic:(PROJECTS[k]||{}).topic||'', u:u}); });
  });
  if(!items.length){ toast('该城市暂无上传材料'); return; }
  var body = '<div style="display:flex;flex-direction:column;gap:10px">' +
    items.map(function(it){
      var u = it.u;
      var sizeStr = u.size ? (u.size>1048576 ? (u.size/1048576).toFixed(1)+'MB' : Math.round(u.size/1024)+'KB') : '';
      var dateStr = u.ts ? new Date(u.ts).toLocaleString('zh-CN') : (u.at || '');
      return '<div style="padding:12px 14px;background:#f8faff;border:1px solid #e8edf5;border-radius:10px;display:flex;align-items:center;gap:12px">' +
        '<div style="width:36px;height:36px;background:#eff6ff;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">' +
          (u.name.match(/\.pdf$/i)?'PDF':u.name.match(/\.xlsx?$/i)?'XLS':u.name.match(/\.docx?$/i)?'DOC':'') +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13px;font-weight:600;color:#0b183b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _authEscape(u.name) + '</div>' +
          '<div style="font-size:11.5px;color:#8492a6;margin-top:2px">' + (it.projTopic?it.projTopic+' · ':'') + (sizeStr?sizeStr+' · ':'') + dateStr + (u.chunks?' · '+u.chunks+'个知识片段':'') + '</div>' +
        '</div>' +
        '<button data-proj="'+it.proj+'" data-file="'+u.name.replace(/"/g,'&quot;')+'" data-original="'+(u.originalId||'')+'" onclick="opsViewFileChunks(this.dataset.proj,this.dataset.file,this.dataset.original)" style="flex-shrink:0;font-size:11px;color:#1a56db;padding:4px 10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;cursor:pointer">查看内容</button>' +
        '<button data-proj="'+it.proj+'" data-file="'+u.name.replace(/"/g,'&quot;')+'" data-original="'+(u.originalId||'')+'" onclick="opsDownloadFile(this.dataset.proj,this.dataset.file,this.dataset.original)" style="flex-shrink:0;margin-left:6px;font-size:11px;color:#166534;padding:4px 10px;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;cursor:pointer">下载</button>' +
      '</div>';
    }).join('') +
  '</div>';
  openModal(city + ' 上传材料（'+items.length+'份）', body,
    '<button class="secondary-button" onclick="closeModal()">关闭</button>');
}

function opsViewUploads(projKey){
  var ups = UPLOADS[projKey] || [];
  var p = PROJECTS[projKey] || {};
  if(!ups.length){ toast('该城市暂无上传材料'); return; }
  var body = '<div style="display:flex;flex-direction:column;gap:10px">' +
    ups.map(function(u, i){
      var sizeStr = u.size ? (u.size>1048576 ? (u.size/1048576).toFixed(1)+'MB' : Math.round(u.size/1024)+'KB') : '';
      var dateStr = u.ts ? new Date(u.ts).toLocaleString('zh-CN') : (u.at || '');
      return '<div style="padding:12px 14px;background:#f8faff;border:1px solid #e8edf5;border-radius:10px;display:flex;align-items:center;gap:12px">' +
        '<div style="width:36px;height:36px;background:#eff6ff;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">' +
          (u.name.match(/\.pdf$/i)?'PDF':u.name.match(/\.xlsx?$/i)?'XLS':u.name.match(/\.docx?$/i)?'DOC':'') +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13px;font-weight:600;color:#0b183b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _authEscape(u.name) + '</div>' +
          '<div style="font-size:11.5px;color:#8492a6;margin-top:2px">' + (sizeStr?sizeStr+' · ':'') + dateStr + (u.chunks?' · '+u.chunks+'个知识片段':'') + '</div>' +
        '</div>' +
        '<button data-proj="'+projKey+'" data-file="'+u.name.replace(/"/g,'&quot;')+'" data-original="'+(u.originalId||'')+'" onclick="opsViewFileChunks(this.dataset.proj,this.dataset.file,this.dataset.original)" style="flex-shrink:0;font-size:11px;color:#1a56db;padding:4px 10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;cursor:pointer">查看内容</button>' +
        '<button data-proj="'+projKey+'" data-file="'+u.name.replace(/"/g,'&quot;')+'" data-original="'+(u.originalId||'')+'" onclick="opsDownloadFile(this.dataset.proj,this.dataset.file,this.dataset.original)" style="flex-shrink:0;margin-left:6px;font-size:11px;color:#166534;padding:4px 10px;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;cursor:pointer">下载</button>' +
      '</div>';
    }).join('') +
  '</div>';
  openModal(' ' + p.city + ' 上传材料（'+ups.length+'份）', body,
    '<button class="secondary-button" onclick="closeModal()">关闭</button>');
}

/* 查看某个文件（优先显示原始文件，fallback到解析片段） */
function opsViewFileChunks(projKey, fname, originalId){
  var ups = UPLOADS[projKey] || [];
  var rec = null;
  for(var i=ups.length-1;i>=0;i--){ if(ups[i].name===fname && (originalId?ups[i].originalId===originalId:!ups[i].originalId)){ rec=ups[i]; break; } }
  function esc(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  var isPDF   = /\.pdf$/i.test(fname);
  var isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fname);
  var isText  = /\.(txt|md|markdown|csv|tsv|json|log|xml|yaml|yml|ini|htm|html)$/i.test(fname);
  var chunks  = (KB_FILE_CHUNKS[projKey]||[]).filter(function(c){ return originalId ? c.originalId === originalId : c.cite === fname; });
  var parsedHtml = chunks.length ? '<div style="padding:16px 20px;background:#f8faff;border:1px solid #e8edf5;border-radius:10px;font-size:13px;color:#1e293b;line-height:2;white-space:pre-wrap;max-height:50vh;overflow-y:auto">' + esc(chunks.map(function(c){ return c.text; }).join('\n\n')) + '</div>' : '';
  var closeBtn = '<button class="secondary-button" onclick="closeModal()">关闭</button>';

  var originalUrl=uploadOriginalUrl(projKey,rec);
  if(originalUrl){
    openModal(fname,'<div style="padding:12px">原件已保存，可下载核对。<p><a href="'+originalUrl+'" download>下载原始文件</a></p></div>'+parsedHtml,closeBtn);return;
  }
  if(rec && rec.dataUrl){
    if(isPDF){
      openModal(fname, '<iframe src="'+rec.dataUrl+'" style="width:100%;height:72vh;border:none;border-radius:8px"></iframe>', closeBtn);
      return;
    }
    if(isImage){
      openModal(fname, '<div style="text-align:center;max-height:72vh;overflow:auto"><img src="'+rec.dataUrl+'" style="max-width:100%;border-radius:8px"></div>', closeBtn);
      return;
    }
    if(isText){
      openModal(fname, '<div id="ftxtBox" style="padding:16px 20px;background:#f8faff;border:1px solid #e8edf5;border-radius:10px;font-size:13px;color:#1e293b;line-height:1.9;white-space:pre-wrap;max-height:64vh;overflow-y:auto">加载中…</div>', closeBtn);
      fetch(rec.dataUrl).then(function(r){ return r.text(); }).then(function(txt){
        var el=document.getElementById('ftxtBox'); if(el) el.textContent = txt;
      }).catch(function(){ var el=document.getElementById('ftxtBox'); if(el) el.textContent='无法读取文件内容'; });
      return;
    }
    // office / 其他格式：优先内联渲染文本，另附下载
    var dl = '<div style="padding:12px;text-align:center"><a href="'+rec.dataUrl+'" download="'+fname+'" style="display:inline-block;padding:10px 20px;background:#1a56db;color:#fff;border-radius:8px;text-decoration:none;font-size:13px">⬇ 下载原始文件</a>' +
      '<div style="font-size:12px;color:#8492a6;margin-top:8px">该格式（'+esc(fname.split('.').pop())+'）暂不支持浏览器内直接渲染，可下载后查看'+(parsedHtml?'；下方为已解析文本':'')+'</div></div>';
    openModal(fname, dl + (parsedHtml?'<div style="margin-top:12px">'+parsedHtml+'</div>':''), closeBtn);
    return;
  }
  // 历史解析文字不是原件，不能声称可还原文件。
  openModal(fname, '<p>历史材料未保存原件，请重新上传以纳入备份。</p>'+(parsedHtml || '<div style="padding:20px;text-align:center;color:#8492a6;font-size:13px">该文件的解析内容暂未保存。</div>'), closeBtn);
}


/* 下载上传的原始文件 */
function opsDownloadFile(projKey, fname, originalId){
  var ups = UPLOADS[projKey] || [];
  var rec = null;
  for(var i=ups.length-1;i>=0;i--){ if(ups[i].name===fname && (originalId?ups[i].originalId===originalId:!ups[i].originalId)){ rec=ups[i]; break; } }
  var originalUrl=uploadOriginalUrl(projKey,rec);
  if(!originalUrl&&(!rec || !rec.dataUrl)){ toast('历史材料未保存原件，请重新上传'); return; }
  var a=document.createElement('a');
  a.href=originalUrl||rec.dataUrl;
  a.download=fname;
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ a.remove(); }, 300);
}

/* 查看城市研判报告 */
function opsViewCityReport(projKey){
  var rs=REPORTSTATE[projKey],p=PROJECTS[projKey];
  if(!rs||!p){toast('暂无报告');return;}
  var topic=p.topic||rs.topic||'',text=(rs.aiReportByTopic||{})[topic]||(rs.topic===topic?rs.text:'');
  if(!text){toast('当前方向暂无报告');return;}
  var stamp=(rs.tsByTopic||{})[topic]||rs.ts;
  var status=typeof topicScoreDisplay==='function'?topicScoreDisplay(topic,projKey):'内容待核验';
  var layer=document.createElement('div');
  layer.setAttribute('role','dialog');layer.setAttribute('aria-modal','true');layer.setAttribute('aria-label','产业研判报告');
  layer.onclick=function(e){if(e.target===layer)layer.remove();};
  layer.style.cssText='position:fixed;inset:0;background:rgba(11,24,59,.4);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(3px)';
  layer.innerHTML='<div style="background:#fff;border-radius:20px;width:100%;max-width:1000px;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(11,24,59,.18)">'+
    '<div style="padding:18px 24px;border-bottom:1px solid #e4ebf3;display:flex;align-items:center;justify-content:space-between;flex-shrink:0"><div><div style="font-size:16px;font-weight:750;color:#0b183b">'+escapeChainText(p.city)+' · '+escapeChainText(topic)+'</div><div style="font-size:12px;color:#64748b;margin-top:6px">'+escapeChainText(status)+(stamp?' · '+escapeChainText(new Date(stamp).toLocaleDateString('zh-CN')):'')+'</div></div><button aria-label="关闭报告" onclick="this.closest(&quot;[role=dialog]&quot;).remove()" style="background:none;border:1px solid #d9e2ec;border-radius:8px;padding:5px 10px;font-size:18px;color:#64748b;cursor:pointer">✕</button></div>'+
    '<div style="flex:1;overflow-y:auto;padding:24px"><div class="report-document">'+topicReportMarkup(text)+'</div>'+reportResearchSourcesHtml(p,projKey)+'</div></div>';
  document.body.appendChild(layer);
}

/* == 客户管理：用户与邀请码各自拥有独立入口 == */
function opsUsers(){
  var state=OPS_UI.users,cities=Object.create(null);Object.keys(USER_PROFILES||{}).forEach(function(user){var city=USER_PROFILES[user]&&USER_PROFILES[user].city;if(city)cities[city]=true;});
  return '<div class="ops-ui-page">'+opsPageHead('注册用户','查找政府端联系人及其所属工作区。详细联系资料集中在详情中查看。')+'<div class="ops-ui-toolbar"><label class="ops-ui-search">搜索用户<input id="opsUserSearch" value="'+_authEscape(state.query)+'" placeholder="搜索账号 / 姓名 / 单位 / 手机 / 微信" oninput="opsFilterChange(\'users\',\'query\',this.value)"></label><label class="ops-ui-filter">城市<select id="opsUserCity" onchange="opsFilterChange(\'users\',\'city\',this.value)"><option value="">全部城市</option>'+Object.keys(cities).sort().map(function(city){return '<option value="'+_authEscape(city)+'"'+(state.city===city?' selected':'')+'>'+_authEscape(city)+'</option>';}).join('')+'</select></label></div><div id="opsUserResults">'+opsUserResults()+'</div></div>';
}
function opsUserResults(){
  var state=OPS_UI.users,q=state.query.trim().toLowerCase(),all=Object.keys(USER_PROFILES||{});
  var keys=all.filter(function(user){var p=USER_PROFILES[user]||{};return (!state.city||p.city===state.city)&&(!q||[user,p.name,p.city,p.org,p.phone,p.wechat,p.dept,p.title].join(' ').toLowerCase().indexOf(q)>=0);}).sort(function(a,b){return (USER_PROFILES[b].ts||0)-(USER_PROFILES[a].ts||0);});
  var meta='<div class="ops-ui-results-meta">显示 '+keys.length+' / '+all.length+' 位注册用户</div>';
  if(!keys.length)return meta+opsEmpty(all.length?'未找到匹配的用户':'暂无注册用户',all.length?'尝试其他关键词或清除城市筛选。':'用户使用邀请码完成注册后，会显示在这里。');
  var rows=keys.map(function(user){var p=USER_PROFILES[user]||{};return '<tr><td><div class="ops-ui-cell-title">'+_authEscape(p.name||user)+'</div><div class="ops-ui-cell-meta">@'+_authEscape(user)+'</div></td><td>'+_authEscape(p.city||'—')+'</td><td><div class="ops-ui-cell-title">'+_authEscape(p.org||'—')+'</div><div class="ops-ui-cell-meta">'+_authEscape([p.dept,p.title].filter(Boolean).join(' · ')||'—')+'</div></td><td><div>'+_authEscape(p.phone||'—')+'</div><div class="ops-ui-cell-meta">微信 '+_authEscape(p.wechat||'—')+'</div></td><td>'+opsDate(p.ts)+'</td><td><button class="ops-ui-button" onclick="'+opsHandler('opsViewUser',user)+'">查看详情</button></td></tr>';}).join('');
  return meta+'<div class="ops-ui-table-wrap"><table class="ops-ui-table ops-ui-user-table"><thead><tr><th scope="col">姓名 / 账号</th><th scope="col">城市</th><th scope="col">单位 / 部门职务</th><th scope="col">联系方式</th><th scope="col">注册时间</th><th scope="col">操作</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
function opsViewUser(user){
  var profile=USER_PROFILES[user];if(!profile)return;
  var fields=[['账号',user],['姓名',profile.name],['城市',profile.city],['手机',profile.phone],['微信',profile.wechat],['所在单位',profile.org],['部门',profile.dept],['职务',profile.title],['注册时间',opsDate(profile.ts)]];
  var keys=Array.isArray(profile.projectKeys)?profile.projectKeys.slice():profile.projKey?[profile.projKey]:[];
  if(profile.projKey&&keys.indexOf(profile.projKey)<0)keys.unshift(profile.projKey);
  var workspaces=keys.map(function(key){var p=PROJECTS[key]||{};return (p.city?p.city+' · ':'')+String(key);}).join('\n');
  fields.push(['所属工作区',workspaces||'—']);
  var body='<div class="ops-ui-detail-grid">'+fields.map(function(field){return '<div class="ops-ui-detail-item"><div class="ops-ui-detail-label">'+field[0]+'</div><div style="white-space:pre-wrap;overflow-wrap:anywhere">'+_authEscape(field[1]||'—')+'</div></div>';}).join('')+'</div>';
  openModal('用户详情 · '+_authEscape(profile.name||user),body,'<button class="ghost-button" onclick="closeModal()">关闭</button>');
}

/* 一个地区只登记一个主工作区；同一码多人加入，不从历史项目推断归属。 */
function opsInvitations(){
  var state=OPS_UI.invitations;
  return '<div class="ops-ui-page">'+opsPageHead('地区与邀请码','同一地区共用一个主工作区和当前邀请码。首位加入者为主账号，后续为成员；每月 1 日 09:00（北京时间）更新城市报告。','<button class="ops-ui-button is-primary" onclick="openInviteCodeModal()">＋ 设置地区 / 获取邀请码</button>')+'<div class="ops-ui-toolbar"><label class="ops-ui-search">搜索邀请码<input id="opsInviteSearch" value="'+_authEscape(state.query)+'" placeholder="搜索邀请码 / 地区 / 工作区 / 主账号 / 分发邮箱" oninput="opsFilterChange(\'invitations\',\'query\',this.value)"></label><label class="ops-ui-filter">有效状态<select id="opsInviteStatus" onchange="opsFilterChange(\'invitations\',\'status\',this.value)">'+[['all','全部状态'],['active','生效中'],['revoked','已作废']].map(function(item){return '<option value="'+item[0]+'"'+(state.status===item[0]?' selected':'')+'>'+item[1]+'</option>';}).join('')+'</select></label><label class="ops-ui-filter">分发状态<select id="opsInviteDistribution" onchange="opsFilterChange(\'invitations\',\'distribution\',this.value)">'+[['all','全部分发状态'],['pending','未分发'],['distributed','已分发']].map(function(item){return '<option value="'+item[0]+'"'+(state.distribution===item[0]?' selected':'')+'>'+item[1]+'</option>';}).join('')+'</select></label></div><div id="opsInviteResults">'+opsInviteResults()+'</div></div>';
}
function opsInviteResults(){
  var all=Object.keys(INVITE_CODES||{}).filter(function(code){return /^[A-Z0-9_-]{1,64}$/.test(code);});
  var state=OPS_UI.invitations,q=state.query.trim().toLowerCase();
  var codes=all.filter(function(code){var inv=INVITE_CODES[code],workspace=opsCityWorkspace(inv.city);return (state.status==='all'||(state.status==='active'?!inv.revoked:!!inv.revoked))&&(state.distribution==='all'||(state.distribution==='distributed'?!!inv.distributed:!inv.distributed))&&(!q||[code,inv.city,inv.projKey,inv.distributedEmail,workspace&&workspace.province,workspace&&workspace.ownerUser].join(' ').toLowerCase().indexOf(q)>=0);}).sort(function(a,b){return (INVITE_CODES[b].createdAt||0)-(INVITE_CODES[a].createdAt||0);});
  var active=all.filter(function(code){return !INVITE_CODES[code].revoked;}).length;
  var unissued=all.filter(function(code){return !INVITE_CODES[code].revoked&&!INVITE_CODES[code].distributed;}).length;
  var meta='<div class="ops-ui-results-meta">显示 '+codes.length+' / '+all.length+' 个邀请码 <span>生效 '+active+' · 待分发 '+unissued+'</span></div>';
  if(!codes.length)return meta+opsEmpty(all.length?'未找到匹配的邀请码':'还没有地区工作区',all.length?'尝试其他关键词或调整状态筛选。':'点击「设置地区 / 获取邀请码」，建立地区主工作区。');
  var rows=codes.map(function(code){
    var inv=INVITE_CODES[code],workspace=opsCityWorkspace(inv.city),primary=!!workspace&&workspace.projectKey===inv.projKey&&workspace.inviteCode===code;
    var owner=primary&&workspace.ownerUser,profile=owner&&USER_PROFILES[owner],members=primary?opsWorkspaceMembers(workspace.projectKey).length:(Array.isArray(inv.usedBy)?new Set(inv.usedBy).size:0);
    var ownerText=primary?(owner?(profile&&profile.name?profile.name+' · @'+owner:'@'+owner):'待首位成员注册'):'未归入地区主工作区';
    var copy='<button class="ops-ui-button ic-copy" data-code="'+code+'" onclick="copyInviteCode(this)" title="复制邀请码 '+code+'">复制</button>';
    var actions=inv.revoked?'<span class="ops-ui-muted">已停用</span>':'<button class="ops-ui-button" onclick="openMarkDistributedModal(\''+code+'\')">'+(inv.distributed?'修改分发':'标记分发')+'</button><button class="ops-ui-button is-danger" onclick="revokeInviteCode(\''+code+'\')">作废</button>';
    return '<tr><td class="ops-ui-invite-identity"><div class="ic-code-cell"><code class="ic-code">'+code+'</code>'+copy+'</div><div class="ops-ui-invite-status"><span class="ops-ui-badge '+(inv.revoked?'is-danger':'is-on')+'">'+(inv.revoked?'已作废':'生效中')+'</span></div><div class="ops-ui-cell-meta ic-time">创建于 '+opsDate(inv.createdAt)+'</div></td>'+
      '<td class="ops-ui-invite-workspace"><div class="ops-ui-cell-title">'+_authEscape(inv.city||'—')+'</div><div class="ops-ui-cell-meta">'+_authEscape(primary?'地区主工作区':'历史邀请码')+' · '+_authEscape(inv.projKey||'—')+'</div>'+(primary&&workspace.province?'<div class="ops-ui-cell-meta">'+_authEscape(workspace.province)+'</div>':'')+'</td>'+
      '<td class="ops-ui-invite-members"><div>'+_authEscape(ownerText)+'</div><div class="ops-ui-cell-meta">'+members+' 位'+(primary?'成员（含主账号）':'历史使用者')+'</div></td>'+
      '<td class="ops-ui-invite-monthly">'+(primary?opsMonthlyCell(inv.city):'<span class="ops-ui-muted">不参与月度更新</span>')+'</td>'+
      '<td class="ops-ui-invite-distribution"><span class="ops-ui-badge '+(inv.distributed?'is-on':'is-muted')+'">'+(inv.distributed?'已分发':'未分发')+'</span>'+(inv.distributed?'<div class="ops-ui-cell-meta">'+_authEscape(inv.distributedEmail||'未记录邮箱')+'</div>':'')+'</td>'+
      '<td class="ops-ui-invite-actions"><div class="ops-ui-row-actions">'+actions+'</div></td></tr>';
  }).join('');
  return meta+'<div class="ops-ui-table-wrap"><table class="ops-ui-table ops-ui-invite-table"><thead><tr><th scope="col" class="ops-ui-invite-identity">邀请码 / 状态</th><th scope="col" class="ops-ui-invite-workspace">地区 / 主工作区</th><th scope="col" class="ops-ui-invite-members">主账号 / 成员</th><th scope="col" class="ops-ui-invite-monthly">月度报告更新</th><th scope="col" class="ops-ui-invite-distribution">分发情况</th><th scope="col" class="ops-ui-invite-actions">操作</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
function inviteCodeSection(){return opsInvitations();}
/* 复制邀请码到剪贴板：优先用 Clipboard API，非安全上下文(如内网http)降级用
   textarea+execCommand，避免管理员在本地/内网环境用不了这个按钮。 */
function copyInviteCode(btn){
  var code=btn.getAttribute('data-code')||'';
  if(!code) return;
  function showCopied(){
    var prevHtml=btn.innerHTML, prevTitle=btn.title;
    btn.innerHTML='<span data-ops-icon="success"></span>'; btn.title='已复制'; if(typeof opsDecorateBrand==='function')opsDecorateBrand(btn); btn.classList.add('copied');
    setTimeout(function(){ btn.innerHTML=prevHtml; btn.title=prevTitle; btn.classList.remove('copied'); },1200);
  }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(code).then(showCopied).catch(function(){ _copyFallback(code, showCopied); });
  }else{
    _copyFallback(code, showCopied);
  }
}
function _copyFallback(text, onOk){
  try{
    var ta=document.createElement('textarea');
    ta.value=text; ta.style.position='fixed'; ta.style.opacity='0'; ta.style.left='-9999px';
    document.body.appendChild(ta); ta.focus(); ta.select();
    var ok=document.execCommand('copy');
    document.body.removeChild(ta);
    if(ok){ onOk(); } else { toast('复制失败，请手动选中邀请码'); }
  }catch(e){ toast('复制失败，请手动选中邀请码'); }
}
function openMarkDistributedModal(code){
  var inv=INVITE_CODES[code]; if(!inv) return;
  openModal('标记邀请码分发（'+code+'）',
    '<label style="display:grid;gap:6px;font-size:13px;color:#52637a">已分发邮箱<input id="distEmailInput" type="text" value="'+_authEscape(inv.distributedEmail||'')+'" placeholder="对方邮箱，方便核对是谁在用" style="min-height:40px;padding:8px 12px;border:1px solid #d8e0ed;border-radius:8px;outline:0;font-size:14px"></label>'+
    '<p style="margin:10px 0 0;font-size:12px;color:#8492a6">标记为已分发后，本码在列表里会显示分发邮箱，方便核对"发给了谁、有没有重复发"。</p>',
    '<button class="ghost-button" onclick="closeModal()">取消</button>'+
    (inv.distributed?'<button class="ghost-button" onclick="clearInviteDistributed(\''+code+'\')">清除分发标记</button>':'')+
    '<button class="primary-button" onclick="doMarkDistributed(\''+code+'\')">保存</button>');
}
function _saveAdminInvite(payload){
  if(!AUTH||AUTH.scope!=='admin'){toast('需要管理员登录');return Promise.resolve(false);}
  if(_saveAdminInvite._pending)return _saveAdminInvite._pending;
  var saveEpoch=_authEpoch;
  _saveAdminInvite._pending=_authJson('/api/admin/invites',payload).then(function(data){
    if(saveEpoch!==_authEpoch)throw new Error('会话已变化，请重新登录');
    var invite=data.invite,code=invite&&invite.code||payload.code;
    if(!code||(payload.action==='create'&&!invite))throw new Error('保存响应不完整，请刷新后检查');
    INVITE_CODES[code]=Object.assign({},INVITE_CODES[code]||{},invite||{},payload.action==='distribution'?{distributed:payload.distributed,distributedEmail:payload.distributedEmail}:{},payload.action==='revoke'?{revoked:true}:{});
    if(data.project){var key=INVITE_CODES[code].projKey||data.project.id;if(key)PROJECTS[key]=data.project;}
    if(data.cityWorkspace&&typeof data.cityWorkspace==='object'){if(typeof CITY_WORKSPACES==='undefined')window.CITY_WORKSPACES={};var city=INVITE_CODES[code].city||payload.city;if(city)CITY_WORKSPACES[city]=data.cityWorkspace;}
    if(payload.action==='create'&&opsTab==='rag')ragCity=INVITE_CODES[code].projKey||ragCity;
    closeModal();render();toast(payload.action==='create'?(data.reused?'已复用地区主工作区，当前邀请码已就绪':'地区主工作区和邀请码已就绪'):payload.action==='revoke'?'邀请码已作废':'分发标记已保存');return true;
  }).catch(function(error){toast(error.message||'保存失败，请重试');return false;}).then(function(result){_saveAdminInvite._pending=null;return result;});
  return _saveAdminInvite._pending;
}
function doMarkDistributed(code){
  var el=document.getElementById('distEmailInput'),email=(el&&el.value||'').trim();
  if(!email){toast('请输入分发邮箱');if(el)el.focus();return;}
  return _saveAdminInvite({action:'distribution',code:code,distributed:true,distributedEmail:email});
}
function clearInviteDistributed(code){return _saveAdminInvite({action:'distribution',code:code,distributed:false,distributedEmail:''});}
function openInviteCodeModal(){
  openModal('设置地区 / 获取邀请码',
    '<label style="display:grid;gap:6px;font-size:13px;color:#52637a">省级地区<input id="invProvinceInput" type="text" placeholder="如 湖北省；直辖市填上海市" style="min-height:40px;padding:8px 12px;border:1px solid #d8e0ed;border-radius:8px;font-size:14px"></label>'+
    '<label style="display:grid;gap:6px;font-size:13px;color:#52637a;margin-top:10px">城市 / 区县<input id="invCityInput" type="text" placeholder="如 随州市 / 闵行区" style="min-height:40px;padding:8px 12px;border:1px solid #d8e0ed;border-radius:8px;font-size:14px"></label>'+
    '<label style="display:grid;gap:6px;font-size:13px;color:#52637a;margin-top:10px">分发邮箱（选填）<input id="invEmailInput" type="text" placeholder="对方邮箱，方便日后核对" style="min-height:40px;padding:8px 12px;border:1px solid #d8e0ed;border-radius:8px;font-size:14px"></label>'+
    '<p style="margin:10px 0 0;font-size:12px;color:#8492a6">同一地区再次获取时复用现有主工作区和邀请码；已作废的码可换新，工作区不变。同一码可供多人加入，首位为主账号，后续为成员。每月 1 日 09:00（北京时间）自动更新报告。</p>',
    '<button class="ghost-button" onclick="closeModal()">取消</button><button class="primary-button" onclick="doGenerateInviteCode()">获取邀请码</button>');
}
function doGenerateInviteCode(){
  var provinceEl=document.getElementById('invProvinceInput'),province=(provinceEl&&provinceEl.value||'').trim();
  if(!province){toast('请输入省级地区');if(provinceEl)provinceEl.focus();return;}
  var el=document.getElementById('invCityInput'),city=(el&&el.value||'').trim();
  if(!city){toast('请输入目标城市');if(el)el.focus();return;}
  var emailEl=document.getElementById('invEmailInput');
  return _saveAdminInvite({action:'create',province:province,city:city,distributedEmail:(emailEl&&emailEl.value||'').trim()});
}
function revokeInviteCode(code){if(INVITE_CODES[code])return _saveAdminInvite({action:'revoke',code:code});}

/* == Tab2: 企业资源库 == */
function opsEnterprises(){
  var actions='<button class="ops-ui-button is-primary" onclick="opsEntAdd()">＋ 手动录入</button><button class="ops-ui-button" onclick="opsEntImport()">文件导入</button><button id="scanAllBtn" class="ops-ui-button" onclick="opsEntScanAll()">全局扫描</button>';
  return '<div class="ops-ui-page">'+opsPageHead('企业资源库','维护企业资料，筛选匹配资源并推送给目标城市。',actions)+'<div class="ops-ui-toolbar"><label class="ops-ui-search">搜索企业<input id="opsEntSearch" placeholder="搜索企业名称 / 标签 / 派系 / 方向" value="'+_authEscape(window._opsEntQ||'')+'" oninput="window._opsEntQ=this.value;opsEntRefreshList()"></label></div><div id="opsEnterpriseResults">'+opsEnterpriseResults()+'</div></div>';
}
function opsEnterpriseResults(){
  var filtered=opsEntFilter(OPS_ENT);
  return '<div class="ops-ui-results-meta">显示 '+filtered.length+' / '+OPS_ENT.length+' 家企业</div>'+(filtered.length?opsEntListV2(filtered):OPS_ENT.length?opsEmpty('未找到匹配的企业','尝试其他关键词。'):opsEntEmpty());
}

function opsEntFilter(list){
  var q=(window._opsEntQ||'').trim().toLowerCase();
  if(!q) return list;
  return list.filter(function(e){
    var haystack=(e.name+' '+e.kind+' '+e.region+' '+(e.gap||'')+' '+(e.tags||[]).join(' ')+' '+(e.faction||[]).map(function(f){return f.type+' '+f.label+' '+(f.person||'');}).join(' ')+' '+(e.note||'')+' '+(e.contact||'')).toLowerCase();
    return haystack.indexOf(q)>=0;
  });
}

function opsEntRefreshList(){var el=document.getElementById('opsEnterpriseResults');if(el){el.innerHTML=opsEnterpriseResults();if(typeof opsDecorateBrand==='function')opsDecorateBrand(el);}}

function opsEntListV2(list){
  return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
    list.map(function(e){
      var idx=OPS_ENT.indexOf(e);
      var matchCount=(e.matches||[]).filter(function(m){return !m.pushed;}).length;
      var statusColor=e.status==='scanned'?'#6d28d9':e.status==='pushed'?'#166534':'#9aa5b5';
      var statusBg=e.status==='scanned'?'#f5f3ff':e.status==='pushed'?'#f0fdf4':'#f5f7fb';
      var statusLabel=e.status==='scanned'?'已扫描'+matchCount+'匹配':e.status==='pushed'?'已推送':'待扫描';

      var tagsHtml=(e.tags||[]).length?'<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">'+(e.tags||[]).map(function(t){return '<span style="padding:2px 7px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;font-size:10.5px;color:#1a56db">'+_authEscape(t)+'</span>';}).join('')+'</div>':'';

      var factionHtml=(e.faction||[]).length?'<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">'+(e.faction||[]).map(function(f){var lbl=f.person?(f.person+' · '+f.label+(f.type==='校友会'?'毕业':'')):''+f.label;return '<span style="padding:2px 7px;background:#fef9e7;border:1px solid #fde68a;border-radius:10px;font-size:10.5px;color:#78350f">'+_authEscape(lbl)+'</span>';}).join('')+'</div>':'';

      var matchHtml=matchCount>0?'<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">'+(e.matches||[]).map(function(m){return '<span style="padding:2px 7px;background:'+(m.pushed?'#f0fdf4':'#f5f3ff')+';border:1px solid '+(m.pushed?'#86efac':'#c4b5fd')+';border-radius:10px;font-size:10.5px;color:'+(m.pushed?'#166534':'#6d28d9')+'">'+_authEscape(m.city)+'·'+_authEscape(m.gap)+(m.pushed?' <span data-ops-icon="success" data-ops-icon-size="12"></span>':'')+'</span>';}).join('')+'</div>':'';

      return '<div style="background:#fff;border:1.5px solid #e8edf5;border-radius:12px;padding:14px 16px;display:flex;flex-direction:column">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
          '<span style="font-size:14px;font-weight:750;color:#0b183b">'+_authEscape(e.name)+'</span>' +
          (e.hasMoveSignal?'<span style="padding:1px 6px;background:#f0fdf4;color:#166534;border-radius:10px;font-size:10px;border:1px solid #bbf7d0">扩张</span>':'') +
          '<span style="padding:1px 7px;background:'+statusBg+';color:'+statusColor+';border-radius:10px;font-size:10px;font-weight:600">'+statusLabel+'</span>' +
        '</div>' +
        '<div style="font-size:12px;color:#4a5568">'+_authEscape(e.kind)+' · '+_authEscape(e.region)+(e.revenue?' · '+_authEscape(e.revenue):'')+'</div>' +
        (e.gap?'<div style="font-size:11.5px;color:#667590;margin-top:2px">'+_authEscape(e.gap)+'</div>':'') +
        (e.signal&&e.signal!=='（无扩张信号）'?'<div style="font-size:11px;color:#b45309;margin-top:5px;line-height:1.5;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:6px 9px"><span data-ops-icon="notification"></span> '+_authEscape(e.signal)+'</div>':'') +
        (e.aiEvidenceStatus==='pending'?'<div style="margin-top:6px;padding:6px 9px;background:#fffbeb;border-radius:8px;font-size:11px;color:#92400e">含AI待核资料；不代表已核实事实或投资意向。'+enterpriseDraftSourcesHTML({sources:e.aiSources||Object.keys(e.aiEvidence||{}).reduce(function(out,k){return out.concat((e.aiEvidence[k]||{}).sources||[]);},[])})+'</div>':'')+
        tagsHtml +
        factionHtml +
        (e.contact?'<div style="margin-top:6px;font-size:11.5px;color:#4a5568"><b>'+_authEscape(e.contact)+'</b>'+(e.note?' · '+_authEscape(e.note):'')+'</div>':'') +
        matchHtml +
        '<div style="margin-top:auto;padding-top:8px;display:flex;gap:6px">' +
          '<button onclick="opsEntAiFillExisting('+idx+')" style="padding:6px 14px;background:linear-gradient(135deg,#1a56db,#6366f1);border:none;border-radius:8px;font-size:12px;color:#fff;cursor:pointer;font-weight:600">AI补全</button>'+
          '<button onclick="opsEntManualEdit('+idx+')" style="padding:6px 14px;background:#fff;border:1.5px solid #1a56db;border-radius:8px;font-size:12px;color:#1a56db;cursor:pointer;font-weight:600">手动编辑</button>' +
          '<button onclick="opsEntScanOne('+idx+')" style="padding:6px 14px;background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:8px;font-size:12px;color:#6d28d9;cursor:pointer;font-weight:600">'+(e.status==='scanned'||e.status==='pushed'?'重新扫描':'扫描')+'</button>' +
          '<button onclick="opsEntManualPushModal('+idx+')" style="padding:6px 14px;background:#eef2ff;border:1.5px solid #c7d2fe;border-radius:8px;font-size:12px;color:#4338ca;cursor:pointer;font-weight:600"><span data-ops-icon="target"></span> 定向推送</button>' +
          '<button onclick="opsEntDelete('+idx+')" style="padding:6px 14px;background:none;border:1.5px solid #e8edf5;border-radius:8px;font-size:12px;color:#9aa5b5;cursor:pointer">删除</button>' +
        '</div>' +
      '</div>';
    }).join('') +
  '</div>';
}

function opsEntEmpty(){
  var artwork=typeof opsBrandImage==='function'?opsBrandImage('collaboration'):'';
  return '<div style="text-align:center;padding:60px 20px;background:#f9fafb;border-radius:14px;border:1.5px dashed #e8edf5">' +
    (artwork?'<img class="ops-brand-empty-visual" src="'+artwork+'" alt="城市资源协作概念图">':'<div style="font-size:36px;margin-bottom:12px"><span data-ops-icon="enterprise" data-ops-icon-size="40"></span></div>') +
    '<div style="font-size:14px;font-weight:700;color:#0b183b;margin-bottom:6px">还没有企业</div>' +
    '<div style="font-size:13px;color:#8492a6;line-height:1.7;margin-bottom:20px">手动录入、上传文件批量导入，或直接粘贴企业名单<br>系统会自动扫描匹配适合推荐的城市方向</div>' +
    '<div style="display:flex;gap:10px;justify-content:center">' +
      '<button onclick="opsEntAdd()" style="padding:10px 20px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:10px;font-size:13.5px;font-weight:650;cursor:pointer">+ 手动录入</button>' +
      '<button onclick="opsEntImport()" style="padding:10px 20px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:10px;font-size:13.5px;color:#4a5568;cursor:pointer"><span data-ops-icon="folder"></span> 文件导入</button>' +
    '</div>' +
  '</div>';
}

function opsEntList(){
  return '<div style="display:flex;flex-direction:column;gap:10px">' +
    OPS_ENT.map(function(e,idx){
      var totalMatch = (e.matches||[]).length;
      var pushed = (e.matches||[]).filter(function(m){return m.pushed;}).length;
      var matchCount = totalMatch - pushed;
      var statusColor = e.status==='scanned'?'#6d28d9':e.status==='pushed'?'#166534':'#9aa5b5';
      var statusBg    = e.status==='scanned'?'#f5f3ff':e.status==='pushed'?'#f0fdf4':'#f5f7fb';
      var statusLabel = e.status==='scanned'?'已扫描 '+matchCount+'个匹配':e.status==='pushed'?'已推送':e.status==='manual'?'待扫描':'待扫描';
      return '<div style="background:#fff;border:1.5px solid #e8edf5;border-radius:14px;overflow:hidden">' +
        '<div style="padding:14px 18px;display:flex;align-items:flex-start;gap:12px">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">' +
              '<span style="font-size:14px;font-weight:700;color:#0b183b">' + e.name + '</span>' +
              (e.hasMoveSignal ? '<span style="padding:1px 7px;background:#f0fdf4;color:#166534;border-radius:10px;font-size:11px;border:1px solid #bbf7d0"><span data-ops-icon="success"></span> 有扩张信号</span>' :
                '<span style="padding:1px 7px;background:#fffbeb;color:#92400e;border-radius:10px;font-size:11px;border:1px solid #fde68a"><span data-ops-icon="warning"></span> 待核实信号</span>') +
            '</div>' +
            '<div style="font-size:12.5px;color:#4a5568">' + e.kind + ' · ' + e.region + '</div>' +
            (e.gap ? '<div style="font-size:12px;color:#8492a6;margin-top:2px">补链方向：' + e.gap + '</div>' : '') +
          '</div>' +
          '<div style="text-align:right;flex-shrink:0">' +
            '<div style="padding:3px 10px;background:'+statusBg+';color:'+statusColor+';border-radius:20px;font-size:11.5px;font-weight:600;margin-bottom:6px">' + statusLabel + '</div>' +
            '<div style="display:flex;gap:6px;justify-content:flex-end">' +
              (e.status!=='scanned'&&e.status!=='pushed' ?
                '<button onclick="opsEntScanOne('+idx+')" style="padding:5px 10px;background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:7px;font-size:11.5px;color:#6d28d9;cursor:pointer">扫描</button>' : '') +
              '<button onclick="opsEntDelete('+idx+')" style="padding:5px 8px;background:#fff5f5;border:1px solid #fecaca;border-radius:7px;font-size:11.5px;color:#ef4444;cursor:pointer">删</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        (matchCount>0 ?
          '<div style="padding:0 18px 12px">' +
            '<div style="font-size:11px;color:#9aa5b5;margin-bottom:6px">匹配方向：</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
              (e.matches||[]).map(function(m){
                return '<div style="padding:4px 10px;background:'+(m.pushed?'#f0fdf4':'#f5f3ff')+';border:1px solid '+(m.pushed?'#86efac':'#c4b5fd')+';border-radius:8px;font-size:11.5px;color:'+(m.pushed?'#166534':'#6d28d9')+'">' +
                  m.city + ' · ' + m.gap + (m.pushed?' <span data-ops-icon="success" data-ops-icon-size="12"></span>':'') +
                '</div>';
              }).join('') +
            '</div>' +
          '</div>' : '') +
      '</div>';
    }).join('') +
  '</div>';
}


/* ══ 企业录入/导入/扫描/推送 操作函数 ══ */

/* 手动录入 */
function opsEntAdd(){
  window._enterpriseNewDraft=null;
  window._enterpriseAddToken=(window._enterpriseAddToken||0)+1;
  var body=
    '<div style="display:flex;flex-direction:column;gap:12px">'+
    '<div style="display:flex;gap:10px;align-items:flex-end">'+
      '<div style="flex:1"><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:5px">企业名称</label>'+
      '<input id="oe-name" placeholder="输入企业全称，如：京东物流" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
      '<button onclick="opsEntAiFill()" id="oe-ai-btn" style="padding:8px 16px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:8px;font-size:12.5px;font-weight:650;cursor:pointer;white-space:nowrap;height:36px">AI 智能填充</button>'+
    '</div>'+
    '<div id="oe-ai-status" style="display:none;font-size:12px;color:#6366f1;padding:6px 10px;background:#f5f3ff;border-radius:8px"></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
      '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:5px">行业类型</label>'+
      '<input id="oe-kind" placeholder="如：燃料电池系统集成" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
      '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:5px">所在地区</label>'+
      '<input id="oe-region" placeholder="如：上海" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
      '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:5px">营收规模</label>'+
      '<input id="oe-revenue" placeholder="如：3.2亿" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
      '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:5px">员工规模</label>'+
      '<input id="oe-employees" placeholder="如：280人" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
    '</div>'+
    '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:5px">补链方向</label>'+
    '<input id="oe-gap" placeholder="如：氢能专用车产业补链·电堆系统" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
    '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:5px">企业标签</label>'+
    '<input id="oe-tags" placeholder="用逗号分隔，如：氢能,燃料电池,电堆集成,商用车" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
    '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:5px">人脉/派系（核心领导层校友会/商会）</label>'+
    '<input id="oe-faction" placeholder="如：李总·同济汽车系毕业,张总·深圳新能源商会" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
      '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:5px">联系人</label>'+
      '<input id="oe-contact" placeholder="如：张工 (商务总监)" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
      '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:5px">扩张信号</label>'+
      '<input id="oe-signal" placeholder="如：华中区寻找新基地" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
    '</div>'+
    '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:5px">备注</label>'+
    '<input id="oe-note" placeholder="其他补充信息" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
    '</div>';
  openModal('+ 手动录入企业',body,
    '<button class="secondary-button" onclick="closeModal()">取消</button>'+
    '<button class="primary-button" onclick="opsEntSaveV2()">保存</button>');
}

/* AI智能填充：输入企业名后自动查询公开信息填充表单 */
function enterpriseDraftText(text){
  var full='', stopped=false, error=false;
  text.split('\n').forEach(function(line){
    if(line.indexOf('data:')!==0)return;var raw=line.slice(5).trim();if(!raw||raw==='[DONE]')return;
    try{var obj=JSON.parse(raw),choice=(obj.choices||[])[0]||{};if(obj.error)error=true;if(choice.finish_reason==='stop')stopped=true;else if(choice.finish_reason)error=true;full+=(choice.delta||{}).content||'';}catch(_){}
  });
  if(error||!stopped||!full.trim())throw new Error('企业资料生成未完成，原有字段已保留');
  return full;
}
function enterpriseDraftInfo(text,name){
  var info=JSON.parse(enterpriseDraftText(text));
  if(!info||info.evidence_contract!=='enterprise-draft-v1'||info.entityName!==name)throw new Error('企业资料来源或企业身份不匹配');
  info.sources=(Array.isArray(info.sources)?info.sources:[]).filter(function(s){try{var u=new URL(s.url);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password;}catch(_){return false;}});
  info.signal='';info.hasMoveSignal=false;info.investment_intent='unknown';
  return info;
}
function enterpriseDraftSourcesHTML(info){
  var seen={},sources=(Array.isArray(info.sources)?info.sources:[]).filter(function(s){try{var u=new URL(s.url);if(!/^https?:$/.test(u.protocol)||u.username||u.password||seen[u.href])return false;seen[u.href]=true;return true;}catch(_){return false;}}).slice(0,20);
  return '<div style="margin:8px 0;font-size:12px;line-height:1.7;color:#92400e">AI搜索建议仍待核验，不代表已核实企业事实或投资意向。'+(sources.length?'请打开来源逐条核对：':'未返回可核查来源，不能采纳字段。')+'</div>'+sources.map(function(s,i){return '<a href="'+_authEscape(s.url)+'" target="_blank" rel="noopener noreferrer" style="display:block;word-break:break-all;font-size:12px">'+_authEscape(s.title||('来源 '+(i+1)))+' · '+_authEscape(s.url)+'</a>';}).join('');
}
function enterpriseFillRevision(e){
  function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object'){var result={};Object.keys(v).sort().forEach(function(k){result[k]=stable(v[k]);});return result;}return v;}
  return JSON.stringify(['name','kind','region','revenue','employees','gap','tags','faction','contact','signal','note','aiEvidence'].map(function(k){return e[k]===undefined?null:stable(e[k]);}));
}
function enterpriseFillTarget(e){
  var id=String(opsEntEnsureId(e)),runs=window._enterpriseFillRuns||(window._enterpriseFillRuns={});
  var token=(runs[id]||0)+1;runs[id]=token;
  return {id:id,name:e.name,revision:enterpriseFillRevision(e),epoch:typeof _authEpoch==='number'?_authEpoch:0,token:token};
}
function currentEnterpriseFillTarget(target){
  if(!target||(typeof _authEpoch==='number'?_authEpoch:0)!==target.epoch||(window._enterpriseFillRuns||{})[target.id]!==target.token)return null;
  var matches=OPS_ENT.filter(function(e){return String(e.id)===target.id;});
  var e=matches.length===1?matches[0]:null;
  return e&&e.name===target.name&&enterpriseFillRevision(e)===target.revision?e:null;
}
/* AI补全已有企业信息（标签/派系/营收等）- 需人工确认 */
function opsEntAiFillExisting(idx){
  var e = OPS_ENT[idx]; if(!e) return;
  var target=enterpriseFillTarget(e);persist();
  toast('正在为「'+e.name+'」查询信息…');

  var prompt='请查询企业「'+e.name+'」的以下公开信息，以JSON格式返回（不要markdown代码块）：'+
    '{"kind":"行业类型(简短)","region":"总部所在城市","revenue":"年营收(如3.2亿)","employees":"员工数(如280人)",'+
    '"tags":["标签1","标签2","标签3","标签4"],"faction":[{"person":"核心人物姓名","label":"其毕业院校或所属商会","type":"校友会或商会"}],'+
    '"gap":"该企业可能适合的产业补链方向","signal":"近期是否有产能扩张/异地投资信号(如有写具体内容,无则写空字符串)","note":"一句话企业简介"}'+
    '已知信息：行业='+e.kind+'，地区='+e.region+'，方向='+(e.gap||'')+
    '。要求：①faction重点列出CEO/董事长/CTO的毕业院校（校友会）和参与的商会组织；②tags包含行业关键词；③基于公开可查资料，不确定的标注"待核实"';

  fetch('/api/enterprise-enrich',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({entityName:e.name})
  }).then(function(r){return r.text();}).then(function(text){
    try{
      var info=enterpriseDraftInfo(text,target.name),current=currentEnterpriseFillTarget(target);
      if(!current){toast('企业资料或登录会话已变化，本次建议未应用');return;}
      // 弹出确认面板让用户逐项确认
      window._aiFillPending={target:target,info:info};
      showAiFillConfirm(OPS_ENT.indexOf(current),info,current);
    }catch(ex){toast('解析失败：'+ex.message);}
  }).catch(function(err){toast('连接失败：'+err.message);});
}

/* AI补全确认面板 */
function showAiFillConfirm(idx, info, e){
  var fields=[
    {key:'kind',label:'行业类型',old:e.kind,new:info.kind},
    {key:'region',label:'地区',old:e.region,new:info.region},
    {key:'revenue',label:'营收',old:e.revenue,new:info.revenue},
    {key:'employees',label:'员工数',old:e.employees,new:info.employees},
    {key:'gap',label:'补链方向',old:e.gap,new:info.gap},
    {key:'tags',label:'标签',old:(e.tags||[]).join(', '),new:(info.tags||[]).join(', ')},
    {key:'faction',label:'人脉/派系',old:(e.faction||[]).map(function(f){return (f.person||'')+' · '+(f.label||'');}).join(', '),
     new:(info.faction||[]).map(function(f){return (f.person||'')+' · '+(f.label||'');}).join(', ')},
    {key:'note',label:'备注',old:e.note,new:info.note}
  ];

  var rows=fields.map(function(f,fi){
    var hasOld=f.old&&f.old.trim();
    var hasNew=f.new&&f.new.trim();
    if(!hasNew) return '';
    if(hasOld && f.old===f.new) return '';
    var checked='';
    var safeNew=_authEscape(String(f.new));
    return '<div style="padding:10px 12px;background:#f8faff;border:1px solid #e8edf5;border-radius:8px;margin-bottom:8px">'+
      '<div style="display:flex;align-items:flex-start;gap:10px">'+
        '<input type="checkbox" data-field="'+f.key+'" '+checked+' style="margin-top:3px;width:16px;height:16px;cursor:pointer" />'+
        '<div style="flex:1">'+
          '<div style="font-size:12px;font-weight:650;color:#4a5568;margin-bottom:3px">'+f.label+'</div>'+
          (hasOld?'<div style="font-size:12px;color:#9aa5b5;text-decoration:line-through;margin-bottom:4px">现有：'+_authEscape(f.old)+'</div>':'')+
          '<div style="display:flex;align-items:center;gap:6px">'+
            '<span style="font-size:12px;color:#6d28d9;font-weight:600;flex-shrink:0">AI建议</span>'+
            '<input type="text" data-fieldval="'+f.key+'" value="'+safeNew+'" '+
              'style="flex:1;box-sizing:border-box;padding:6px 9px;border:1.5px solid #ddd6fe;border-radius:7px;font-size:13px;color:#1e293b;outline:none;background:#fff" '+
              'onfocus="this.style.border=\'1.5px solid #6d28d9\'" onblur="this.style.border=\'1.5px solid #ddd6fe\'" '+
              'oninput="var cb=this.closest(\'div[style*=background\']\')?this.closest(\'div\').parentNode.parentNode.querySelector(\'input[type=checkbox]\'):null;if(cb)cb.checked=true;" />'+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div>';
  }).filter(Boolean).join('');

  if(!rows){
    toast(info.notice||'AI未发现有来源的新信息可补全');return;
  }

  var body='<div style="max-height:60vh;overflow-y:auto">'+enterpriseDraftSourcesHTML(info)+
    '<div style="font-size:12.5px;color:#8492a6;margin:12px 0">核对来源后勾选需要保留的待核字段；原投资意向不会被AI改动。</div>'+
    rows+
  '</div>';

  openModal('AI补全确认 · '+e.name, body,
    '<button class="secondary-button" onclick="closeModal()">取消</button>'+
    '<button class="primary-button" onclick="applyAiFill()">保留选中待核资料</button>');
}

/* 应用AI补全（仅勾选的字段） */
/* 手动编辑企业信息 */
function opsEntManualEdit(idx){
  var e = OPS_ENT[idx]; if(!e) return;
  var body=
    '<div style="display:flex;flex-direction:column;gap:10px">'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
      '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:4px">行业类型</label>'+
      '<input id="me-kind" value="'+(e.kind||'')+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
      '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:4px">地区</label>'+
      '<input id="me-region" value="'+(e.region||'')+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
      '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:4px">营收</label>'+
      '<input id="me-revenue" value="'+(e.revenue||'')+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
      '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:4px">员工数</label>'+
      '<input id="me-employees" value="'+(e.employees||'')+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
    '</div>'+
    '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:4px">补链方向</label>'+
    '<input id="me-gap" value="'+(e.gap||'')+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
    '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:4px">标签（逗号分隔）</label>'+
    '<input id="me-tags" value="'+((e.tags||[]).join(','))+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
    '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:4px">人脉/派系（逗号分隔，格式：人名·院校/商会）</label>'+
    '<input id="me-faction" value="'+((e.faction||[]).map(function(f){return (f.person||"")+"·"+(f.label||"");}).join(","))+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
      '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:4px">联系人</label>'+
      '<input id="me-contact" value="'+(e.contact||'')+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
      '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:4px">扩张信号</label>'+
      '<input id="me-signal" value="'+(e.signal||'')+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
    '</div>'+
    '<div><label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:4px">备注</label>'+
    '<input id="me-note" value="'+(e.note||'')+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none"/></div>'+
    '</div>';
  window._manualEditIdx=idx;
  openModal('编辑 · '+e.name, body,
    '<button class="secondary-button" onclick="closeModal()">取消</button>'+
    '<button class="primary-button" onclick="applyManualEdit()">保存</button>');
}

function applyManualEdit(){
  var idx=window._manualEditIdx; var e=OPS_ENT[idx]; if(!e) return;
  opsEntEnsureId(e);
  e.kind=((document.getElementById('me-kind')||{}).value||'').trim();
  e.region=((document.getElementById('me-region')||{}).value||'').trim()||'待填写';
  e.revenue=((document.getElementById('me-revenue')||{}).value||'').trim();
  e.employees=((document.getElementById('me-employees')||{}).value||'').trim();
  e.gap=((document.getElementById('me-gap')||{}).value||'').trim();
  var tagsStr=((document.getElementById('me-tags')||{}).value||'').trim();
  e.tags=tagsStr?tagsStr.split(/[,，]/).map(function(t){return t.trim();}).filter(Boolean):[];
  var factionStr=((document.getElementById('me-faction')||{}).value||'').trim();
  e.faction=factionStr?factionStr.split(/[,，]/).map(function(f){
    var parts=f.trim().split('·');
    return {person:parts[0]||'',label:parts[1]||'',type:(parts[1]||'').indexOf('商会')>=0?'商会':'校友会'};
  }).filter(function(f){return f.person||f.label;}):[];
  e.contact=((document.getElementById('me-contact')||{}).value||'').trim();
  e.signal=((document.getElementById('me-signal')||{}).value||'').trim();
  e.hasMoveSignal=!!e.signal;
  e.note=((document.getElementById('me-note')||{}).value||'').trim();
  persist();
  closeModal();
  renderOpsV2();
  toast('已更新「'+e.name+'」');
}

function applyAiFill(){
  var pending=window._aiFillPending; if(!pending) return;
  var e=currentEnterpriseFillTarget(pending.target); var info=pending.info;
  if(!e){window._aiFillPending=null;toast('企业资料或登录会话已变化，请重新查询');return;}
  if(!info.sources||!info.sources.length){toast('缺少可核查来源，不能采纳');return;}
  var allowed=['kind','region','revenue','employees','gap','tags','faction','note'],accepted=[];
  var checkboxes=document.querySelectorAll('#modalLayer input[type=checkbox]');
  checkboxes.forEach(function(cb){
    if(!cb.checked) return;
    var field=cb.dataset.field;
    if(allowed.indexOf(field)<0||!info.field_status||info.field_status[field]!=='draft_unverified')return;
    // 读取输入框里（可能被手动修改过的）值，回退到 AI 原值
    var inp=document.querySelector('#modalLayer input[data-fieldval="'+field+'"]');
    var editedVal=inp?inp.value.trim():'';
    if(field==='tags'){ e.tags=editedVal?editedVal.split(/[,，、]+/).map(function(t){return t.trim();}).filter(Boolean):(info.tags||e.tags); }
    else if(field==='faction' && info.faction) e.faction=info.faction;
    else if(editedVal) e[field]=editedVal;
    else if(info[field]) e[field]=info[field];
    e.aiEvidence=e.aiEvidence||{};
    e.aiEvidence[field]={value:e[field],status:'pending',origin:'ai_search',sources:info.sources,at:Date.now()};
    accepted.push(field);
  });
  if(!accepted.length){toast('请核对来源后至少勾选一项');return;}
  e.aiEvidenceStatus='pending';window._aiFillPending=null;
  persist();
  closeModal();
  renderOpsV2();
  toast('已保留「'+e.name+'」待核资料，投资意向未改变');
}


function opsEntAiFill(){
  var nameInput=document.getElementById('oe-name'),name=((nameInput||{}).value||'').trim();
  if(!name){toast('请先输入企业名称');return;}
  var epoch=typeof _authEpoch==='number'?_authEpoch:0,formToken=window._enterpriseAddToken,run=(window._enterpriseNewRun||0)+1;window._enterpriseNewRun=run;
  function current(){return run===window._enterpriseNewRun&&epoch===(typeof _authEpoch==='number'?_authEpoch:0)&&formToken===window._enterpriseAddToken&&document.getElementById('oe-name')===nameInput&&nameInput.value.trim()===name;}
  var btn=document.getElementById('oe-ai-btn');
  var status=document.getElementById('oe-ai-status');
  if(btn){btn.disabled=true;btn.textContent='查询中…';}
  if(status){status.style.display='block';status.textContent='正在查询「'+name+'」的公开信息…';}

  var prompt='请查询企业「'+name+'」的以下公开信息，以JSON格式返回（不要markdown代码块）：'+
    '{"kind":"行业类型(简短)","region":"总部所在城市","revenue":"年营收(如3.2亿)","employees":"员工数(如280人)",'+
    '"tags":["标签1","标签2","标签3","标签4"],"faction":[{"person":"核心人物姓名","label":"其毕业院校或所属商会","type":"校友会或商会"}],'+
    '"gap":"该企业可能适合的产业补链方向","signal":"近期是否有产能扩张/异地投资信号(如有写具体内容,无则写空字符串)","note":"一句话企业简介"}'+
    '要求：①faction重点列出CEO/董事长/CTO的毕业院校（校友会）和参与的商会组织；②tags包含行业关键词；③信息必须基于公开可查资料，不确定的标注"待核实"';

  fetch('/api/enterprise-enrich',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({entityName:name})
  }).then(function(r){return r.text();}).then(function(text){
    if(!current())return;
    try{
      var info=enterpriseDraftInfo(text,name);
      window._enterpriseNewDraft={name:name,input:nameInput,epoch:epoch,token:formToken,info:info};
      // Fill form fields
      if(info.kind) document.getElementById('oe-kind').value=info.kind;
      if(info.region) document.getElementById('oe-region').value=info.region;
      if(info.revenue) document.getElementById('oe-revenue').value=info.revenue;
      if(info.employees) document.getElementById('oe-employees').value=info.employees;
      if(info.gap) document.getElementById('oe-gap').value=info.gap;
      if(info.tags&&info.tags.length) document.getElementById('oe-tags').value=info.tags.join(',');
      if(info.faction&&info.faction.length){
        document.getElementById('oe-faction').value=info.faction.map(function(f){
          return (f.person||'')+'·'+(f.label||'')+(f.type==='校友会'?'毕业':'');
        }).join(',');
      }
      if(info.note) document.getElementById('oe-note').value=info.note;
      if(status){status.innerHTML=enterpriseDraftSourcesHTML(info);status.style.color='#92400e';status.style.background='#fffbeb';}
    }catch(e){
      if(status){status.textContent='AI建议未应用：'+e.message;status.style.color='#d97706';status.style.background='#fffbeb';}
    }
    if(btn){btn.disabled=false;btn.textContent='AI 智能填充';}
  }).catch(function(e){
    if(!current())return;
    if(status){status.textContent='连接失败：'+e.message;status.style.color='#ef4444';status.style.background='#fef2f2';}
    if(btn){btn.disabled=false;btn.textContent='AI 智能填充';}
  });
}

/* Backfill only the explicitly selected entity; never rewrite existing IDs. */
function opsEntEnsureId(entity){
  if((typeof entity.id==='string'||typeof entity.id==='number'&&isFinite(entity.id))&&String(entity.id).trim()&&!/^(undefined|null)$/.test(String(entity.id)))return entity.id;
  var token='';
  try{if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')token=crypto.randomUUID();}catch(_){}
  if(!token)token=Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)+'_'+(++opsEntEnsureId.sequence).toString(36);
  var base='ent_'+token,id=base,suffix=0;
  while(OPS_ENT.some(function(other){return other!==entity&&String(other.id)===id;}))id=base+'_'+(++suffix);
  entity.id=id;
  return id;
}
opsEntEnsureId.sequence=0;
/* 保存企业（新版表单） */
function opsEntSaveV2(){
  var name=((document.getElementById('oe-name')||{}).value||'').trim();
  if(!name){toast('请填写企业名称');return;}
  var kind=((document.getElementById('oe-kind')||{}).value||'').trim();
  var region=((document.getElementById('oe-region')||{}).value||'').trim()||'待填写';
  var revenue=((document.getElementById('oe-revenue')||{}).value||'').trim();
  var employees=((document.getElementById('oe-employees')||{}).value||'').trim();
  var gap=((document.getElementById('oe-gap')||{}).value||'').trim();
  var tagsStr=((document.getElementById('oe-tags')||{}).value||'').trim();
  var factionStr=((document.getElementById('oe-faction')||{}).value||'').trim();
  var contact=((document.getElementById('oe-contact')||{}).value||'').trim();
  var signal=((document.getElementById('oe-signal')||{}).value||'').trim();
  var note=((document.getElementById('oe-note')||{}).value||'').trim();

  var tags=tagsStr?tagsStr.split(/[,，]/).map(function(t){return t.trim();}).filter(Boolean):[];
  var faction=factionStr?factionStr.split(/[,，]/).map(function(f){
    var parts=f.trim().split('·');
    var person=parts[0]||'';
    var label=parts[1]||'';
    var type=label.indexOf('毕业')>=0?'校友会':'商会';
    label=label.replace('毕业','');
    return {person:person,label:label,type:type};
  }).filter(function(f){return f.person||f.label;}):[];

  var ent={
    name:name,kind:kind,region:region,revenue:revenue,employees:employees,
    gap:gap,tags:tags,faction:faction,contact:contact,note:note,
    hasMoveSignal:!!signal,signal:signal,status:'manual',matches:[]
  };
  var draft=window._enterpriseNewDraft;
  if(draft&&draft.name===name&&draft.input===document.getElementById('oe-name')&&draft.epoch===(typeof _authEpoch==='number'?_authEpoch:0)&&draft.token===window._enterpriseAddToken&&draft.info.sources.length){
    ent.aiEvidence={};ent.aiSources=draft.info.sources;ent.aiEvidenceStatus='pending';
    ['kind','region','revenue','employees','gap','tags','faction','note'].forEach(function(field){
      if(draft.info.field_status&&draft.info.field_status[field]==='draft_unverified')ent.aiEvidence[field]={value:ent[field],status:'pending',origin:'ai_search',sources:draft.info.sources,at:Date.now()};
    });
  }
  window._enterpriseNewDraft=null;
  opsEntEnsureId(ent);
  OPS_ENT.push(ent);
  persist();
  closeModal();
  opsTab='enterprises'; renderOpsV2();
  toast('已录入「'+name+'」');
}


function opsEntSave(){
  var name  =((document.getElementById('oe-name')||{}).value||'').trim();
  var kind  =((document.getElementById('oe-kind')||{}).value||'').trim();
  var gap   =((document.getElementById('oe-gap')||{}).value||'').trim();
  var scale =((document.getElementById('oe-scale')||{}).value||'').trim();
  var signal=((document.getElementById('oe-signal')||{}).value||'').trim();
  if(!name){toast('请填写企业名称');return;}
  if(!signal){toast('扩张信号不能为空');return;}
  var ent={
    id:'ent_'+Date.now().toString(36),
    name:name, kind:kind, gap:gap, scale:scale,
    signal:signal, hasMoveSignal:true,
    region:kind.split('·').pop().trim()||'待填写',
    status:'manual', matches:[]
  };
  OPS_ENT.push(ent);
  opsEntScanOne(OPS_ENT.length-1, true);  // 静默扫描
  closeModal();
  opsTab='enterprises'; renderOpsV2();
  toast('已录入「'+name+'」，正在扫描匹配城市');
}

/* 文件导入：读取 TXT/CSV/MD，按行解析企业名+方向 */
/* 解析结构化表格（CSV/带表头多列）：一行一家企业 */
function parseEntTable(text){
  var rows=text.split(/\r?\n/).map(function(l){return l.trim();}).filter(Boolean);
  if(!rows.length) return 0;
  // 表头映射
  var header=rows[0].split(/[,\t，]/).map(function(s){return s.trim();});
  function col(names){ for(var i=0;i<header.length;i++){ for(var n=0;n<names.length;n++){ if(header[i].indexOf(names[n])>=0) return i; } } return -1; }
  var ci={name:col(['企业名称','名称','company','name']), ind:col(['行业']), prod:col(['产品','主营']),
    region:col(['所在地','地区','区域']), scale:col(['规模']), signal:col(['信号','扩张']),
    src:col(['来源']), match:col(['匹配','环节','方向'])};
  if(ci.name<0) ci.name=0;
  var added=0;
  for(var r=1;r<rows.length;r++){
    var p=rows[r].split(/[,\t，]/).map(function(s){return s.trim();});
    var name=p[ci.name]||'';
    if(name.length<2||name.length>40) continue;
    if(OPS_ENT.find(function(e){return e.name===name;})) continue;
    var signal=ci.signal>=0?(p[ci.signal]||''):'';
    var hasSig=!!signal && !/无(信号|公开)/.test(signal) && signal!=='-';
    OPS_ENT.push({
      id:'ent_'+Date.now().toString(36)+'_'+added,
      name:name,
      industry:ci.ind>=0?p[ci.ind]||'':'',
      product:ci.prod>=0?p[ci.prod]||'':'',
      region:ci.region>=0?p[ci.region]||'':'',
      scale:ci.scale>=0?p[ci.scale]||'':'',
      kind:ci.ind>=0?p[ci.ind]||'待扫描确认':'待扫描确认',
      gap:ci.match>=0?p[ci.match]||'':'',
      signal:hasSig?signal:'（无扩张信号）',
      signalSrc:ci.src>=0?p[ci.src]||'':'',
      hasMoveSignal:hasSig, status:'manual', matches:[]
    });
    added++;
  }
  return added;
}

/* 解析单个企业档案（多行 txt/md）：整个文件=一家企业，按「字段：值」提取 */
function parseEntProfile(text, fname){
  var lines=text.split(/\r?\n/).map(function(l){return l.trim();}).filter(Boolean);
  function field(labels){
    for(var i=0;i<lines.length;i++){
      var ln=lines[i];
      var ci=ln.indexOf('：'); if(ci<0) ci=ln.indexOf(':');
      if(ci<=0) continue;
      var label=ln.slice(0,ci).trim();
      for(var j=0;j<labels.length;j++){
        if(label===labels[j]||label.indexOf(labels[j])>=0){
          return ln.slice(ci+1).trim().replace(/[。.\s]+$/,'');
        }
      }
    }
    return '';
  }
  var name=field(['企业名称','企业名','名称']);
  if(!name){
    var tm=text.match(/企业档案[:：]\s*([^\n（(]+)/);
    if(tm) name=tm[1].trim();
  }
  if(!name){ name=(fname||'').replace(/\.(txt|md|csv)$/i,'').replace(/^企业[-_]?/,''); }
  name=name.trim();
  if(name.length<2) return 0;
  if(OPS_ENT.find(function(e){return e.name===name;})) return 0;
  var signal=field(['扩张/迁址信号','扩张信号','迁址信号','信号']);
  var industry=field(['所属行业','行业']);
  var product=field(['主营产品','产品']);
  var region=field(['所在地','地区','区域']);
  var scale=field(['规模']);
  var src=field(['信号来源','来源']);
  var match=field(['匹配环节','匹配','环节']);
  var noSig=/无(任何)?(公开)?(的)?(扩张|迁址|新建)/.test(text) || /信号来源[:：]\s*无/.test(text);
  var hasSig=!!signal && !noSig;
  OPS_ENT.push({
    id:'ent_'+Date.now().toString(36)+'_'+Math.floor(Math.random()*1000),
    name:name, industry:industry, product:product, region:region, scale:scale,
    kind:industry||'待扫描确认', gap:match,
    signal:hasSig?signal:'（无扩张信号）', signalSrc:src,
    hasMoveSignal:hasSig, status:'manual', matches:[]
  });
  return 1;
}

function opsEntImport(){
  var inp=document.createElement('input');
  inp.type='file'; inp.multiple=true;
  inp.accept='.txt,.csv,.md,.xlsx,.xls';
  inp.onchange=function(){
    var files=Array.from(inp.files||[]);
    if(!files.length)return;
    var total=0;
    var done=0;
    files.forEach(function(f){
      if(/\.(xlsx|xls)$/i.test(f.name)){
        // Excel: 只记录文件名提示，提醒用另存为 CSV
        toast('请将 '+f.name+' 另存为 CSV 格式后重新导入');
        done++; return;
      }
      var reader=new FileReader();
      reader.onload=function(e){
        var text=e.target.result||'';
        var added=0;
        var isCsv=/\.csv$/i.test(f.name);
        // 判定：CSV 或 带表头的多列文本 → 结构化逐行；否则 → 整个文件=一家企业档案
        var firstLine=(text.split(/\n/)[0]||'').trim();
        var looksTabular=isCsv || (/[,\t，]/.test(firstLine) && /企业名称|名称|company|name/i.test(firstLine));
        if(looksTabular){
          added+=parseEntTable(text);
        } else {
          added+=parseEntProfile(text, f.name);
        }
        total+=added;
        done++;
        if(done===files.length){
          opsTab='enterprises'; renderOpsV2();
          toast('已导入 '+total+' 家企业，点「全局扫描」评估匹配方向');
        }
      };
      reader.readAsText(f,'utf-8');
    });
  };
  inp.click();
}

/* 扫描单家企业：匹配所有城市的缺口方向 */
function opsEntScanOne(idx, silent){
  var e=OPS_ENT[idx]; if(!e) return;
  var matches=e.matches||[];  // 保留已有匹配，不清空
  var existingKeys={};
  matches.forEach(function(m){existingKeys[(m.projKey||m.city)+':'+m.gap]=true;});

  var gapKw=(e.gap||e.kind||'').toLowerCase();
  var nameKw=(e.name||'').toLowerCase();
  var tagKws=(e.tags||[]).map(function(t){return t.toLowerCase();});

  Object.keys(PROJECTS).forEach(function(k){
    var p=PROJECTS[k];
    var rs=REPORTSTATE[k];
    var kb=p.kb||[];

    // 从报告文本中提取缺口
    var gaps=[];
    if(rs&&rs.text){
      rs.text.split('\n').forEach(function(l){
        if(l.indexOf('\u274c')>=0||l.indexOf('\u26a0')>=0||l.indexOf('\u8584\u5f31')>=0||l.indexOf('\u7f3a\u5931')>=0){
          var clean=l.replace(/[\u274c\u2705\u26a0\ufe0f*#|]/g,'').replace(/\s+/g,' ').trim();
          if(clean.length>3&&clean.length<80) gaps.push(clean);
        }
      });
    }

    // 从KB主题卡中提取方向
    kb.forEach(function(card){
      if(card&&card.t) gaps.push(card.t);
      (card.known||[]).forEach(function(item){
        var c=item.replace(/[\u2705\u26a0\ufe0f\s]/g,'').trim();
        if(c.indexOf('\u7f3a')>=0||c.indexOf('\u8865\u94fe')>=0||c.indexOf('\u5f15\u8fdb')>=0){
          if(c.length>4&&c.length<60) gaps.push(c);
        }
      });
    });

    // 匹配逻辑：企业关键词 vs 城市缺口
    gaps.forEach(function(gapTxt){
      var gapLow=gapTxt.toLowerCase();
      var kws=(e.gap||'').toLowerCase().split(/[/\u3001\uff0c,\s]+/).filter(function(w){return w.length>1;});
      // 企业gap关键词命中缺口
      var hit=kws.some(function(kw){return gapLow.indexOf(kw)>=0;});
      // 企业tags命中缺口
      if(!hit) hit=tagKws.some(function(t){return t.length>1&&gapLow.indexOf(t)>=0;});
      // 企业kind命中缺口
      if(!hit){
        var kindKws=(e.kind||'').toLowerCase().split(/[/\u3001\uff0c,\s]+/).filter(function(w){return w.length>1;});
        hit=kindKws.some(function(kw){return gapLow.indexOf(kw)>=0;});
      }
      // 反向：缺口词出现在企业信息里
      if(!hit){
        var gapWords=gapLow.split(/[/\u3001\uff0c,\s]+/).filter(function(w){return w.length>1;});
        hit=gapWords.some(function(w){
          return nameKw.indexOf(w)>=0||gapKw.indexOf(w)>=0||(e.kind||'').toLowerCase().indexOf(w)>=0;
        });
      }
      if(hit){
        var key=k+':'+gapTxt.slice(0,25);
        if(!existingKeys[key]){
          existingKeys[key]=true;
          matches.push({city:p.city,projKey:k,gap:gapTxt.slice(0,25),pushed:false});
        }
      }
    });
  });

  // 去重并限制
  matches=matches.slice(0,8);
  OPS_ENT[idx].matches=matches;
  OPS_ENT[idx].status=matches.length>0?'scanned':'manual';
  if(!silent){
    persist(); renderOpsV2();
    toast(matches.length>0?'\u2713 \u626b\u63cf\u5b8c\u6210\uff0c\u627e\u5230 '+matches.length+' \u4e2a\u5339\u914d\u65b9\u5411':'\u672a\u627e\u5230\u5339\u914d\u65b9\u5411');
  }
}

/* 全局扫描所有企业 */
function opsEntScanAll(){
  var btn=document.getElementById('scanAllBtn');
  if(btn){btn.textContent='⏳ 扫描中…';btn.disabled=true;}
  var count=0;
  OPS_ENT.forEach(function(e,i){
    opsEntScanOne(i, true);
    count+=(e.matches||[]).length;
  });
  persist();
  renderOpsV2();
  toast('全局扫描完成，共找到 '+count+' 个匹配方向，可逐条推送');
}

/* 推送弹窗 */
function opsEntPushModal(idx){var e=OPS_ENT[idx];if(!e||!e.id){toast('请先保存有编号的企业');return;}resourceReviewChooseProject([String(e.id)]);}

function opsEntDoPush(entIdx, miArr){opsEntPushModal(entIdx);}

/* 删除企业 */
function opsEntDelete(idx){
  if(!confirm('确认删除该企业？')) return;
  OPS_ENT.splice(idx,1);
  renderOpsV2();
  toast('已删除');
}

/* 推送到指定城市（从城市概览页触发）*/
function opsPushEntToCity(projKey){resourceReviewChooseResources(projKey);}

function opsDoPushToCity(projKey, count){resourceReviewConfirmSelection(projKey);}

function opsEntImport(){
  var inp=document.createElement('input');
  inp.type='file'; inp.multiple=true;
  inp.accept='.txt,.csv,.md,.xlsx,.xls';
  inp.onchange=function(){
    var files=Array.from(inp.files||[]);
    if(!files.length)return;
    var total=0;
    var done=0;
    files.forEach(function(f){
      if(/\.(xlsx|xls)$/i.test(f.name)){
        // Excel: 只记录文件名提示，提醒用另存为 CSV
        toast('请将 '+f.name+' 另存为 CSV 格式后重新导入');
        done++; return;
      }
      var reader=new FileReader();
      reader.onload=function(e){
        var text=e.target.result||'';
        var added=0;
        var isCsv=/\.csv$/i.test(f.name);
        // 判定：CSV 或 带表头的多列文本 → 结构化逐行；否则 → 整个文件=一家企业档案
        var firstLine=(text.split(/\n/)[0]||'').trim();
        var looksTabular=isCsv || (/[,\t，]/.test(firstLine) && /企业名称|名称|company|name/i.test(firstLine));
        if(looksTabular){
          added+=parseEntTable(text);
        } else {
          added+=parseEntProfile(text, f.name);
        }
        total+=added;
        done++;
        if(done===files.length){
          opsTab='enterprises'; renderOpsV2();
          toast('已导入 '+total+' 家企业，点「全局扫描」评估匹配方向');
        }
      };
      reader.readAsText(f,'utf-8');
    });
  };
  inp.click();
}

/* 扫描单家企业：匹配所有城市的缺口方向 */
/* 领域聚类：把一段文本归到若干产业领域（用于企业↔缺口的语义匹配） */
function opsEntDomains(text){
  text=(text||'').toLowerCase();
  var DICT={
    'h2stack':['电堆','燃料电池','氢燃料','氢能','pem','fcv','双极板','膜电极'],
    'h2store':['储氢','氢瓶','瓶阀','高压气态','储氢瓶','气瓶','复合材料'],
    'powertrain':['动力总成','底盘','发动机','变速','传动','驱动桥'],
    'drone':['无人机','应急','机器人','卫星','通信模块','5g','低空','消防'],
    'mushroom':['香菇','食用菌','菌菇','菌种','多糖','多肽','提取','精深','预制菜','植物提取','烘干','菌棒','深加工']
  };
  var doms={};
  for(var d in DICT){ if(DICT[d].some(function(w){return text.indexOf(w)>=0;})) doms[d]=true; }
  return doms;
}

function opsEntScanOne(idx, silent){
  var e=OPS_ENT[idx]; if(!e) return;
  var preserved=(Array.isArray(e.matches)?e.matches:[]).filter(function(m){return m&&m.pushed===true;});
  var matches=[];
  // These are candidate hints only. A shared industry label is not evidence
  // that an enterprise serves every product requested by that industry.
  var entText=[e.name,e.gap,e.kind].concat(Array.isArray(e.tags)?e.tags:[]).filter(function(v){return typeof v==='string';}).join(' ');
  var entDoms=opsEntDomains(entText),entDomList=Object.keys(entDoms);
  function normalized(value){return String(value||'').toLowerCase().replace(/[\s，,。；;：:、/（）()\[\]【】“”"'·—-]+/g,'');}
  var entLiteral=normalized(entText);
  Object.keys(PROJECTS).forEach(function(k){
    var p=PROJECTS[k];
    if(!p||p.isDemand!==true)return;
    if(preserved.some(function(m){return m.projKey===k;}))return;
    if(p.demandContract==='industry-demand-v1'){
      var priority=p.selectedPriority||{},spec=p.demandSpec||{};
      var focus=typeof priority.focus==='string'?priority.focus.trim():'';
      var description=typeof spec.description==='string'?spec.description.trim():'';
      // A valid saved request is required. Do not read its frozen full report,
      // inherited KB, other recommendations or broad industry clusters here.
      if(!focus||!description)return;
      var terms=focus.split(/[/、，,；;：:\n]+/).map(normalized).filter(function(term){return term.length>1;});
      var hit=terms.some(function(term){return entLiteral.indexOf(term)>=0;});
      if(hit)matches.push({projKey:k,city:p.city,gap:industryDemandProjectTitle(p),sourcePriorityKey:p.sourcePriorityKey,
        matchBasis:'selected_demand_literal',verificationStatus:'pending',pushed:false});
      return;
    }
    var rs=REPORTSTATE[k],kb=Array.isArray(p.kb)?p.kb:[],gaps=[];
    if(rs&&typeof rs.text==='string'){
      rs.text.split('\n').forEach(function(l){
        if(l.indexOf('❌')>=0||l.indexOf('⚠')>=0||l.indexOf('薄弱')>=0||l.indexOf('缺失')>=0){
          var clean=l.replace(/[❌✅⚠️*#|]/g,'').replace(/\s+/g,' ').trim();
          if(clean.length>3&&clean.length<80)gaps.push(clean);
        }
      });
    }
    kb.forEach(function(card){
      (card&&Array.isArray(card.known)?card.known:[]).forEach(function(item){
        var c=ragItemText(item).replace(/[✅⚠️]/g,'').replace(/\s+/g,' ').trim();
        if((c.indexOf('缺')>=0||c.indexOf('薄弱')>=0||c.indexOf('补链')>=0||c.indexOf('引进')>=0)&&c.length>4&&c.length<80)gaps.push(c);
      });
    });
    gaps.forEach(function(gapTxt){
      var gapLow=gapTxt.toLowerCase();
      var kws=(e.gap||'').toLowerCase().split(/[/、，,\s]+/).filter(function(w){return w.length>1;});
      var hit=kws.some(function(kw){return gapLow.indexOf(kw)>=0;});
      if(!hit&&entDomList.length){var gapDoms=opsEntDomains(gapTxt);hit=entDomList.some(function(d){return gapDoms[d];});}
      if(hit)matches.push({projKey:k,city:p.city,gap:gapTxt.slice(0,25),pushed:false});
    });
  });
  var seen=Object.create(null),legacyCount=0;
  matches=matches.filter(function(m){
    var p=PROJECTS[m.projKey],key;
    if(p&&p.demandContract==='industry-demand-v1')key='demand:'+m.projKey;
    else{
      var g=(m.gap||'').replace(/[\s\-—：:（）()、，,。.]/g,'').replace(/^(核心缺口|缺失|薄弱|缺口方向)/,'');
      key='legacy:'+(m.city||'')+':'+g.slice(0,10);
      if(legacyCount>=6)return false;
    }
    if(seen[key])return false;
    seen[key]=true;if(!p||p.demandContract!=='industry-demand-v1')legacyCount++;
    return true;
  });
  OPS_ENT[idx].matches=preserved.concat(matches);
  OPS_ENT[idx].status=preserved.length?'pushed':matches.length?'scanned':'manual';
  if(!silent){
    persist();renderOpsV2();
    toast(matches.length?'扫描完成，找到 '+matches.length+' 条待核需求线索':'未新增待核需求线索，已推送记录保持不变');
  }
}

/* 全局扫描所有企业 */
function opsEntScanAll(){
  var btn=document.getElementById('scanAllBtn');
  if(btn){btn.textContent='⏳ 扫描中…';btn.disabled=true;}
  var count=0;
  OPS_ENT.forEach(function(e,i){
    opsEntScanOne(i, true);
    count+=(e.matches||[]).length;
  });
  persist();
  renderOpsV2();
  toast('全局扫描完成，共找到 '+count+' 个匹配方向，可逐条推送');
}

/* 推送弹窗 */
function opsEntPushModal(idx){var e=OPS_ENT[idx];if(!e||!e.id){toast('请先保存有编号的企业');return;}resourceReviewChooseProject([String(e.id)]);}

function opsEntDoPush(entIdx, miArr){opsEntPushModal(entIdx);}

/* 删除企业 */
function opsEntDelete(idx){
  if(!confirm('确认删除该企业？')) return;
  OPS_ENT.splice(idx,1);
  renderOpsV2();
  toast('已删除');
}

/* 推送到指定城市（从城市概览页触发）*/
function opsPushEntToCity(projKey){resourceReviewChooseResources(projKey);}

function opsDoPushToCity(projKey, count){resourceReviewConfirmSelection(projKey);}
