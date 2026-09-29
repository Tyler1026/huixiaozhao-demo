/* ===== 空白引导页（用户首次进入 / 无项目时） ===== */
function opsTopbarEmpty(){
  return '<div class="top-bar"><div class="top-brand"><div class="brand-icon">慧</div><span style="font-weight:700;font-size:15px;color:#0b183b">慧小招</span></div>'+
    '<div style="flex:1"></div><span style="font-size:12px;color:#9aa5b5">运营端</span></div>';
}

/* ═══════════ 登录页 ═══════════ */
function loginPage(){
  return '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#eef3ff 0%,#f8faff 55%,#f2ecff 100%)">'+
    '<div style="width:min(400px,92vw);background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(11,31,65,.13);padding:38px 34px 30px">'+
      '<div style="text-align:center;margin-bottom:24px">'+
        '<div style="width:56px;height:56px;margin:0 auto 12px;border-radius:15px;background:linear-gradient(135deg,#1a56db,#6366f1);display:grid;place-items:center;font-size:28px;color:#fff;font-weight:700">慧</div>'+
        '<h1 style="margin:0;font-size:21px;color:#0b183b;letter-spacing:-.01em">慧小招 · 城市智库</h1>'+
        '<p style="margin:6px 0 0;font-size:12.5px;color:#8492a6">AI 招商智能体 · 请登录进入你的城市工作区</p>'+
      '</div>'+
      '<div style="display:grid;gap:13px">'+
        '<label style="display:grid;gap:6px;font-size:12px;color:#52637a">账号'+
          '<input id="loginUser" type="text" autocomplete="username" placeholder="如 suizhou" onkeydown="if(event.key===\'Enter\')doLogin()" style="min-height:44px;padding:9px 12px;border:1px solid #d8e0ed;border-radius:9px;outline:0;font-size:14px"></label>'+
        '<label style="display:grid;gap:6px;font-size:12px;color:#52637a">密码'+
          '<span style="position:relative;display:block">'+
          '<input id="loginPwd" type="password" autocomplete="current-password" placeholder="请输入密码" onkeydown="if(event.key===\'Enter\')doLogin()" style="width:100%;box-sizing:border-box;min-height:44px;padding:9px 42px 9px 12px;border:1px solid #d8e0ed;border-radius:9px;outline:0;font-size:14px">'+
          '<span id="loginPwdEye" onclick="togglePwd(\'loginPwd\',this)" title="显示/隐藏密码" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);cursor:pointer;display:flex;align-items:center;color:#8492a6">'+eyeSvg(false)+'</span>'+
          '</span></label>'+
        '<div id="loginErr" style="display:none;font-size:12px;color:#dc2626;margin-top:-4px"></div>'+
        '<button onclick="doLogin()" style="min-height:46px;margin-top:4px;border:none;border-radius:10px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;font-size:15px;font-weight:650;cursor:pointer;letter-spacing:.3px">登录</button>'+
        '<button onclick="gotoRegister()" style="min-height:44px;border:1.5px solid #d8e0ed;border-radius:10px;background:#fff;color:#1a56db;font-size:14px;font-weight:600;cursor:pointer">注册新账号</button>'+
      '</div>'+
      '<div style="margin-top:20px;padding-top:16px;border-top:1px solid #f0f4ff;font-size:11.5px;color:#9aa5b5;line-height:1.7">'+
        '<div style="font-weight:650;color:#6b7688;margin-bottom:4px">演示账号</div>'+
        '· <b>suizhou</b> / suizhou —— 随州常驻工作区（含完整数据）<br>'+
        '· <b>admin</b> / admin —— 通用账号，可新建任意城市'+
      '</div>'+
    '</div></div>';
}
function gotoRegister(){
  view='register'; render._routed=true; render();
  // 登录门禁下 INVITE_CODES 尚未从服务器拉取，此时直接校验会误报「邀请码不存在」。
  // 进入注册页立即拉一次最新邀请码库，若用户已输入内容则拉完自动重新校验一遍。
  restoreFromServer(function(){ if(typeof onInviteCodeInput==='function') onInviteCodeInput(); });
}
function regBack(){ view='login'; render._routed=true; render(); }
function regErr(msg){ var e=document.getElementById('regErr'); if(e){ e.textContent=msg; e.style.display=msg?'block':'none'; } }

/* 注册页：邀请码+账号+密码+个人资料。城市由邀请码决定，不可手填。 */
function registerPage(){
  function reqLabel(label){
    return '<span>'+label.replace(/\s\*$/,'<span style="color:#dc2626;font-weight:700">\u2009*</span>')+'</span>';
  }
  function fld(id,label,ph,type){
    if(type==='password'){
      return '<label style="display:grid;gap:5px;font-size:12px;color:#52637a">'+reqLabel(label)+
        '<span style="position:relative;display:block">'+
        '<input id="'+id+'" type="password" placeholder="'+ph+'" oninput="regClearInvalid(this)" style="width:100%;box-sizing:border-box;min-height:42px;padding:8px 42px 8px 12px;border:1px solid #d8e0ed;border-radius:9px;outline:0;font-size:14px">'+
        '<span onclick="togglePwd(\''+id+'\',this)" title="显示/隐藏密码" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);cursor:pointer;display:flex;align-items:center;color:#8492a6">'+eyeSvg(false)+'</span>'+
        '</span></label>';
    }
    return '<label style="display:grid;gap:5px;font-size:12px;color:#52637a">'+reqLabel(label)+
      '<input id="'+id+'" type="'+(type||'text')+'" placeholder="'+ph+'" oninput="regClearInvalid(this)" style="min-height:42px;padding:8px 12px;border:1px solid #d8e0ed;border-radius:9px;outline:0;font-size:14px"></label>';
  }
  return '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#eef3ff 0%,#f8faff 55%,#f2ecff 100%);padding:24px 0">'+
    '<div style="width:min(440px,92vw);background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(11,31,65,.13);padding:34px 32px 26px">'+
      '<div style="text-align:center;margin-bottom:20px">'+
        '<div style="width:52px;height:52px;margin:0 auto 10px;border-radius:14px;background:linear-gradient(135deg,#1a56db,#6366f1);display:grid;place-items:center;font-size:26px;color:#fff;font-weight:700">慧</div>'+
        '<h1 style="margin:0;font-size:19px;color:#0b183b">注册政府端账号</h1>'+
        '<p style="margin:6px 0 0;font-size:12px;color:#8492a6">凭邀请码加入你的城市工作区，完善资料便于招商团队电话/微信联系</p>'+
      '</div>'+
      '<div style="display:grid;gap:11px">'+
        '<label style="display:grid;gap:5px;font-size:12px;color:#52637a">'+reqLabel('邀请码 *')+
          '<span style="position:relative;display:block">'+
          '<input id="regInviteCode" type="text" placeholder="向招商团队获取邀请码" oninput="regClearInvalid(this);onInviteCodeInput()" autocomplete="off" style="width:100%;box-sizing:border-box;min-height:42px;padding:8px 12px;border:1px solid #d8e0ed;border-radius:9px;outline:0;font-size:14px;text-transform:uppercase;letter-spacing:.5px">'+
          '</span>'+
        '</label>'+
        '<div id="regInviteHint" style="font-size:12px;color:#8492a6;margin-top:-4px">输入邀请码后自动识别所在城市</div>'+
        '<label style="display:grid;gap:5px;font-size:12px;color:#52637a">所在城市（由邀请码自动确定）'+
          '<input id="regCity" type="text" disabled placeholder="—" style="min-height:42px;padding:8px 12px;border:1px solid #e6ebf3;border-radius:9px;outline:0;font-size:14px;background:#f6f8fc;color:#52637a"></label>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
          fld('regUser','登录账号名 *','如 zhangsan')+
          fld('regPwd','登录密码 *','设置密码','password')+
        '</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
          fld('regName','姓名 *','真实姓名')+
          fld('regPhone','手机号码 *','11位手机号')+
        '</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
          fld('regWechat','微信号 *','微信号')+
          fld('regOrg','所在单位 *','如 随州市招商局')+
        '</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
          fld('regDept','部门 *','如 投资促进科')+
          fld('regTitle','职务 *','如 科长')+
        '</div>'+
        '<div id="regErr" style="display:none;font-size:12px;color:#dc2626;margin-top:-2px"></div>'+
        '<button onclick="doRegister()" style="min-height:46px;margin-top:4px;border:none;border-radius:10px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;font-size:15px;font-weight:650;cursor:pointer">提交注册并登录</button>'+
        '<button onclick="regBack()" style="min-height:40px;border:none;background:none;color:#8492a6;font-size:13px;cursor:pointer">← 返回登录</button>'+
      '</div>'+
    '</div></div>';
}

/* 邀请码输入实时校验：合法则锁定展示城市，非法则清空城市并提示 */
function onInviteCodeInput(){
  var el=document.getElementById('regInviteCode'); if(!el) return;
  var cityEl=document.getElementById('regCity'); var hintEl=document.getElementById('regInviteHint');
  var code=el.value.trim();
  if(!code){ if(cityEl)cityEl.value=''; if(hintEl){hintEl.textContent='输入邀请码后自动识别所在城市';hintEl.style.color='#8492a6';} return; }
  var v=validateInviteCode(code);
  if(v.ok){
    if(cityEl)cityEl.value=v.city||'';
    if(hintEl){hintEl.textContent='✓ 邀请码有效，将加入「'+(v.city||'')+'」工作区';hintEl.style.color='#0a8f5c';}
  }else{
    if(cityEl)cityEl.value='';
    if(hintEl){hintEl.textContent=v.msg;hintEl.style.color='#dc2626';}
  }
}

function regMarkInvalid(id){ var el=document.getElementById(id); if(el){ el.style.borderColor='#dc2626'; el.style.boxShadow='0 0 0 3px rgba(220,38,38,.12)'; } }
function regClearInvalid(el){ if(el){ el.style.borderColor='#d8e0ed'; el.style.boxShadow='none'; } var e=document.getElementById('regErr'); if(e){ e.style.display='none'; } }
function doRegister(){
  function v(id){ var el=document.getElementById(id); return el?el.value.trim():''; }
  var inviteCode=v('regInviteCode'), u=v('regUser').toLowerCase(), pw=v('regPwd'), name=v('regName'), phone=v('regPhone'),
      wechat=v('regWechat'), org=v('regOrg'), dept=v('regDept'), title=v('regTitle');
  var fields=[['regInviteCode',inviteCode,'邀请码'],['regUser',u,'登录账号名'],['regPwd',pw,'登录密码'],['regName',name,'姓名'],['regPhone',phone,'手机号码'],['regWechat',wechat,'微信号'],['regOrg',org,'所在单位'],['regDept',dept,'部门'],['regTitle',title,'职务']];
  var missing=fields.filter(function(f){return !f[1];});
  if(missing.length){
    missing.forEach(function(f){ regMarkInvalid(f[0]); });
    var first=document.getElementById(missing[0][0]);
    if(first){ first.focus(); first.scrollIntoView({behavior:'smooth',block:'center'}); }
    regErr('还有 '+missing.length+' 项未填：'+missing.map(function(f){return f[2];}).join('、'));
    if(typeof toast==='function') toast('请填写：'+missing.map(function(f){return f[2];}).join('、'));
    return;
  }
  if(!/^1[3-9]\d{9}$/.test(phone)){ regMarkInvalid('regPhone'); var pe=document.getElementById('regPhone'); if(pe){pe.focus();} regErr('手机号码格式不正确（应为11位手机号）'); if(typeof toast==='function') toast('手机号码格式不正确'); return; }
  if(ACCOUNTS[u]){ regErr('该账号为系统保留账号，请换一个'); return; }
  // 先从服务器拉最新邀请码库+用户库再校验，避免用本地过期数据误判
  var proceed=function(){
    if(USER_PROFILES[u]){ regErr('该账号已被注册'); return; }
    var inv=validateInviteCode(inviteCode);
    if(!inv.ok){ regMarkInvalid('regInviteCode'); regErr(inv.msg); return; }
    var city=inv.city, role=inv.role||'member';
    // 邀请码可重复使用：用同一个码注册的多个账号加入同一工作区（团队协作）；
    // 不同邀请码即使城市名相同也是完全独立的工作区，隔离边界是 projKey 不是城市名。
    // 不再限制"一城市一账号"。
    USER_PROFILES[u]={name:name,phone:phone,wechat:wechat,org:org,dept:dept,title:title,city:city,pwd:pw,ts:Date.now(),role:role,inviteCode:inv.code,projKey:inv.projKey||null};
    // 记录邀请码使用历史，供管理端追踪谁用了这个码
    if(!INVITE_CODES[inv.code].usedBy) INVITE_CODES[inv.code].usedBy=[];
    INVITE_CODES[inv.code].usedBy.push({user:u,ts:Date.now()});
    persist();
    AUTH={user:u, city:city, projKey:inv.projKey||null, resident:false, who:name, org:org, role:role};
    saveAuth();
    cur=null; view='setup'; render._restored=false; render._routed=false; render._serverSynced=false;
    // 立即强制同步注册用户到服务端(绕过5秒防抖):必须在restoreFromServer之前完成POST,
    // 否则5秒内页面已多次restore/render,本地USER_PROFILES可能被服务端旧数据覆盖前尚未推送,
    // 表现为"注册用户没同步到管理端"。
    // 关键安全:未登录状态PROJECTS/OPS_ENT可能是空,若直接推整个localStorage会清空服务端全库。
    // 改为只推 USER_PROFILES + INVITE_CODES 增量,避免空快照灾难。
    try{
      var _incBody={USER_PROFILES:USER_PROFILES, INVITE_CODES:INVITE_CODES};
      if(typeof RESET_GEN!=='undefined'&&RESET_GEN) _incBody.RESET_GEN=RESET_GEN;
      _incBody.syncTs=Date.now();
      var _xhr=new XMLHttpRequest();
      _xhr.open('POST','/api/sync',false);  // 同步XHR:确保注册数据先到服务端
      _xhr.setRequestHeader('Content-Type','application/json');
      _xhr.send(JSON.stringify(_incBody));
      console.log('[register] sync POST status:', _xhr.status, 'body keys:USER_PROFILES,INVITE_CODES');
    }catch(e){ console.warn('[register] sync POST failed:',e&&e.message); }
    var done=false; var fb=setTimeout(function(){ if(!done){done=true;render();} },2000);
    restoreFromServer(function(){ if(!done){done=true;clearTimeout(fb);render();} });
    toast('✓ 注册成功，欢迎 '+name);
  };
  restoreFromServer(function(){ proceed(); });
  // 服务器无数据时 restoreFromServer 回调可能不触发，兜底
  setTimeout(function(){ if(!AUTH){ proceed(); } }, 1500);
}

function eyeSvg(open){
  return open
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
}
function togglePwd(id,el){
  var inp=document.getElementById(id); if(!inp) return;
  var show=(inp.type==='password');
  inp.type=show?'text':'password';
  if(el){ el.innerHTML=eyeSvg(show); }
}
function loginErr(msg){ var e=document.getElementById('loginErr'); if(e){ e.textContent=msg; e.style.display='block'; } }
function doLogin(){
  var u=(document.getElementById('loginUser')||{}).value||'';
  var pw=(document.getElementById('loginPwd')||{}).value||'';
  u=u.trim().toLowerCase();
  var _verify=function(){
    var acc=ACCOUNTS[u];
    // 城市账号连接表（推送RAG时自动建立，resident账号直接进工作区）
    if(!acc && CITY_ACCOUNTS[u]){ var ca=CITY_ACCOUNTS[u]; acc={pwd:ca.pwd, city:ca.city||null, projKey:ca.projKey||null, resident:true, who:ca.who||u, org:ca.org||'', role:ca.role||'owner'}; }
    // 内置账号不存在时，查注册用户库
    if(!acc && USER_PROFILES[u]){ var up=USER_PROFILES[u]; acc={pwd:up.pwd, city:up.city||null, projKey:up.projKey||null, resident:!!up.resident, who:up.name||u, org:up.org||'', role:up.role||'member'}; }
    if(!acc){ loginErr('账号不存在'); return; }
    if(acc.pwd!==pw){ loginErr('密码错误'); return; }
    AUTH={user:u, city:acc.city, projKey:acc.projKey, resident:!!acc.resident, who:acc.who, org:acc.org, role:acc.role||'member'};
    saveAuth();
    cur=null; view='setup'; render._restored=false; render._routed=false; render._serverSynced=false;
    render();
  };
  // 先从服务器拉取注册用户库再校验（登录门禁下 USER_PROFILES 尚未加载，否则真实账号会报「账号不存在」）
  var _done=false;
  var _fb=setTimeout(function(){ if(!_done){_done=true;_verify();} },2500);
  restoreFromServer(function(){ if(!_done){_done=true;clearTimeout(_fb);_verify();} });
}

/* 随州常驻：首次即预置完整数据，key 固定 sz，永不 onboarding */
/* 任意城市自动建项：非随州账号登录后名下无项目时调用 */
/* 【2026-09-17 新增】项目壳自愈：
   账号绑定了 projKey，但 PROJECTS[projKey] 被清掉（版本号清缓存 / 空快照覆盖 / 推RAG覆盖）时，
   报告数据仍存活在 REPORTSTATE[projKey] 与 REPORT_HISTORY[projKey]（独立 key，不随 LS_KEY 删除）。
   旧逻辑此时直接 autoProvisionCity 建空壳，导致界面显示完成度0%、智库0条，用户以为数据全丢。
   现改为：先尝试依据存活的报告数据重建项目壳，把历史方向与报告挂回去。
   返回重建出的 key，或 null（确无可恢复数据）。 */
function reviveProjectShell(projKey, city){
  if(!projKey) return null;
  if(PROJECTS[projKey]) return projKey;        // 壳还在，无需自愈
  var rs=(typeof REPORTSTATE!=='undefined'&&REPORTSTATE[projKey])||null;
  var rh=(typeof REPORT_HISTORY!=='undefined'&&REPORT_HISTORY[projKey])||null;
  var hasRs=rs && ((rs.text&&rs.text.length>0) || Object.keys(rs.aiReportByTopic||{}).length>0);
  var hasRh=rh && rh.length>0;
  if(!hasRs && !hasRh) return null;            // 没有任何可恢复数据，交回原流程
  var _city=city||(rs&&rs.city)||(AUTH&&AUTH.city)||'';
  var _c=(typeof generateKbConclusions==='function')?generateKbConclusions(_city):null;
  // 历史做过的方向：优先取报告状态里的记录，保留用户原有方向不丢
  var _topics=[];
  try{
    Object.keys((rs&&rs.aiReportByTopic)||{}).forEach(function(t){ if(_topics.indexOf(t)<0) _topics.push(t); });
    Object.keys((rs&&rs.userGeneratedTopics)||{}).forEach(function(t){ if(_topics.indexOf(t)<0) _topics.push(t); });
    (rh||[]).forEach(function(h){ if(h&&h.topic&&_topics.indexOf(h.topic)<0) _topics.push(h.topic); });
  }catch(_te){}
  var _stageByTopic={};
  _topics.forEach(function(t){ _stageByTopic[t]=4; });
  PROJECTS[projKey]={
    id:projKey, city:_city,
    org:(rs&&rs.org)||_city, who:(AUTH&&AUTH.who)||'负责人',
    topic:(rs&&rs.topic)||_topics[0]||(_city+'产业链招引'),
    stage:_topics.length?4:1,
    kb:_c?[
      {icon:'\ud83c\udfed',t:'主导产业与产业链',sub:_c.industry.sub,tag:_c.industry.tag,known:_c.industry.known,calls:['城市公开信息','产业链图谱']},
      {icon:'\ud83c\udfe2',t:'园区与承载条件',sub:_c.park.sub,tag:_c.park.tag,known:_c.park.known,calls:['园区基础资料','政府官网']},
      {icon:'\ud83c\udfd7\ufe0f',t:'链主与存量企业',sub:_c.firm.sub,tag:_c.firm.tag,known:_c.firm.known,calls:['企业名录','工商信息']},
      {icon:'\ud83d\udcdc',t:'政策、规划与领导关注',sub:_c.policy.sub,tag:_c.policy.tag,known:_c.policy.known,calls:['政府工作报告','领导发言']}
    ]:[],
    report:null, clues:[],
    customTopics:_topics.slice(),   // 显式保留历史方向，不受 hasRealKbData 门槛影响
    stageByTopic:_stageByTopic
  };
  // 已有报告的项目解锁后续步骤，避免自愈后又被上锁挡住
  try{ if(typeof KB_UNLOCKED!=='undefined' && _topics.length) KB_UNLOCKED[projKey]={report:true,home:true}; }catch(_ue){}
  // 待确认事项挂回
  try{
    if(typeof PENDING_CONFIRMS!=='undefined' && rs && rs.pendingByTopic){
      var _pt=(rs&&rs.topic)||_topics[0];
      if(_pt && rs.pendingByTopic[_pt]) PENDING_CONFIRMS[projKey]=rs.pendingByTopic[_pt];
    }
  }catch(_pe){}
  console.warn('[revive] rebuilt project shell '+projKey+' from surviving report data, topics='+_topics.length);
  return projKey;
}
function autoProvisionCity(city){
  city=(city||'').trim(); if(!city) return null;
  var exist=Object.keys(PROJECTS).filter(function(k){return PROJECTS[k]&&PROJECTS[k].city===city;});
  if(exist.length) return exist[0];
  var key='p'+Date.now().toString(36);
  var _c=generateKbConclusions(city);
  PROJECTS[key]={id:key, city:city, org:city+'市招商局', who:(AUTH&&AUTH.who)||'负责人', topic:city+'产业链招引', stage:1,
    kb:[
      {icon:'🏭',t:'主导产业与产业链',sub:_c.industry.sub,tag:_c.industry.tag,known:_c.industry.known,calls:['城市公开信息','产业链图谱']},
      {icon:'🏢',t:'园区与承载条件',sub:_c.park.sub,tag:_c.park.tag,known:_c.park.known,calls:['园区基础资料','政府官网']},
      {icon:'🏗️',t:'链主与存量企业',sub:_c.firm.sub,tag:_c.firm.tag,known:_c.firm.known,calls:['企业名录','工商信息']},
      {icon:'📜',t:'政策、规划与领导关注',sub:_c.policy.sub,tag:_c.policy.tag,known:_c.policy.known,calls:['政府工作报告','领导发言']}
    ],
    report:null, clues:[]};
  return key;
}
function provisionSuizhou(){
  if(!PROJECTS.sz){
    var _c=generateKbConclusions('随州');
    PROJECTS.sz={id:'sz',city:'随州',org:'随州市招商局',who:'张主任',topic:'随州主导产业补链招引',stage:5,
      kb:[
        {icon:'\ud83c\udfed',t:'主导产业与产业链',sub:_c.industry.sub,tag:_c.industry.tag,known:_c.industry.known,calls:['产业链缺口测绘报告']},
        {icon:'\ud83c\udfe2',t:'园区与承载条件',sub:_c.park.sub,tag:_c.park.tag,known:_c.park.known,calls:['产业链缺口测绘报告']},
        {icon:'\ud83c\udfd7\ufe0f',t:'链主与存量企业',sub:_c.firm.sub,tag:_c.firm.tag,known:_c.firm.known,calls:['产业链缺口测绘报告']},
        {icon:'\ud83d\udcdc',t:'政策、规划与领导关注',sub:_c.policy.sub,tag:_c.policy.tag,known:_c.policy.known,calls:['政策规划研究']}
      ],report:null,clues:[]};
  }
  /* 移除硬编码报告：产业分析报告由用户主动触发AI生成，不预设 */
  /* 不再默认解锁随州：与新城市一致，产业分析/招商对接默认上锁 */
  // 不在此处persist - 等restoreFromServer完成后再决定是否写回
  return 'sz';
}

