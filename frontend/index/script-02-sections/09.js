/* ===== 运营端：跨城市需求池（沿用政府端三栏结构）===== */
function renderOps(){
  if(!DEMANDS.length){$('#root').innerHTML='<div class="app-shell">'+opsTopbarEmpty()+'<div style="display:flex;align-items:center;justify-content:center;height:80vh;flex-direction:column;gap:16px"><div style="font-size:32px">📭</div><div style="font-weight:650;color:#0b183b">暂无需求</div><div style="color:#667590;font-size:13px">切换到政府端，完成第一个研判后需求会出现在这里。</div><button class="primary-button" style="margin-top:8px" onclick="setRole(\'gov\')">去政府端开始研判</button></div></div>';return;}
  if(curDemand===null)curDemand=DEMANDS[0].id;
  $('#root').innerHTML=
   '<div class="app-shell">'+
    opsTopbar()+
    '<div class="app-content">'+opsSidebar()+
      '<div class="pane-divider"><span class="divider-grip"><i class="i">⋮</i></span></div>'+
      '<div class="content-column"><div class="workspace">'+
        '<div class="main-pane">'+opsMain()+'</div>'+
        (detailOpen?('<div class="detail-pane">'+opsDetail()+'</div>')
                   :('<button class="reopen-detail" onclick="toggleDetail()"><i class="i">🧾</i>展开详情</button>'))+
      '</div></div>'+
    '</div>'+
    opsFooter()+
   '</div>';
  bind();
}
function opsTopbar(){
  return '<div class="topbar">'+
    '<div class="brand-block"><img src="'+brandLogo()+'"><div><strong>慧小招</strong><span>运营端 · 资源调度</span></div></div>'+
    '<div class="org-block"><i class="i">🧭</i><strong style="font-weight:650">周总 · 资源调度中心</strong>'+
      '<span style="margin:0 10px;color:#cbd7e6">/</span><strong style="color:var(--blue-dark)">全国需求池</strong></div>'+
    /* roleSwitch removed — ops runs on separate port 5051 */
    '<div class="top-meta"><span><i class="i">🏙️</i>覆盖 3 个试点城市</span><span><i class="i">📥</i>'+DEMANDS.length+' 条在办需求</span></div>'+
  '</div>';
}
function opsSidebar(){
  var items=[['📥','需求池','各地干部提交',1],['🗺️','城市总览','试点城市进展',0],['🤝','资源库','可对接企业',0]];
  return '<div class="sidebar"><div class="nav-list">'+
    items.map(function(n){return '<button class="nav-item'+(n[3]?' active':'')+'"'+(n[3]?'':' onclick="toast(\'该模块示意中\')"')+'><i class="i">'+n[0]+'</i><span class="nav-copy"><strong>'+n[1]+'</strong><small>'+n[2]+'</small></span></button>';}).join('')+
    '</div><div class="system-status"><span></span>运营端 · 周总视图</div></div>';
}
function opsFooter(){
  var stat={matched:0,checking:0,none:0};DEMANDS.forEach(function(d){stat[d.res]++});
  return '<div class="progress-footer"><div class="progress-track">'+
    '<div class="progress-step done"><div class="progress-node"><i class="i">✓</i></div><div class="progress-copy"><strong>已匹配</strong><small>'+stat.matched+' 条可对接</small></div></div><div class="progress-line"></div>'+
    '<div class="progress-step current"><div class="progress-node">◔</div><div class="progress-copy"><strong>核验中</strong><small>'+stat.checking+' 条待核验</small></div></div><div class="progress-line"></div>'+
    '<div class="progress-step"><div class="progress-node">•</div><div class="progress-copy"><strong>暂无资源</strong><small>'+stat.none+' 条待跟踪</small></div></div>'+
    '</div><div class="progress-mobile">需求池：共 '+DEMANDS.length+' 条 · 已匹配 '+stat.matched+' / 核验中 '+stat.checking+' / 暂无 '+stat.none+'</div></div>';
}
// 中间：需求列表（政府端 prompt-row 同款）
function opsMain(){
  return '<div class="page">'+
    '<div class="page-header"><div><span class="eyebrow">DEMAND POOL</span><h1>跨城市需求池</h1>'+
    '<p>各地招商干部经双确认后递交的正式需求，点任意一条在右侧判断资源、组织对接。</p></div></div>'+
    '<div class="knowledge-scroll"><div class="prompt-list" style="margin-left:0;width:100%">'+
      DEMANDS.map(function(d){var rc=RES_COLOR[d.res];var on=d.id===curDemand;
        return '<button onclick="pickDemand(\''+d.id+'\')" style="width:100%;display:flex;align-items:center;gap:14px;padding:14px 18px;border:1px solid '+(on?'var(--blue)':'var(--line)')+';border-radius:10px;background:'+(on?'#f3f7fd':'#fff')+';cursor:pointer;text-align:left">'+
          '<i class="i" style="font-size:22px;flex:0 0 auto">📥</i>'+
          '<span style="flex:1;min-width:0;display:grid;gap:3px"><strong style="font-size:14.5px">'+d.city+' · '+d.topic+'</strong>'+
          '<small style="color:var(--muted);font-size:12px">'+d.gov+' · 递交于 '+d.submit+'</small></span>'+
          '<span class="status-tag" style="flex:0 0 auto;color:'+rc.c+';background:'+rc.bg+'">'+d.resLabel+'</span></button>';
      }).join('')+
    '</div></div></div>';
}
// 右侧：需求详情（政府端 detail-pane 同款结构）
function opsDetail(){
  var d=DEMANDS.find(function(x){return x.id===curDemand})||DEMANDS[0];var rc=RES_COLOR[d.res];
  return '<button class="collapse-detail" onclick="toggleDetail()"><i class="i">✕</i></button>'+
    '<div class="detail-page">'+
    '<div class="detail-header"><div><span class="eyebrow">DEMAND DETAIL</span><h2>'+d.city+' · '+d.topic+'</h2><p>'+d.gov+'</p></div></div>'+
    '<div class="detail-scroll">'+
      '<div class="detail-block"><h3>递交需求</h3><p class="detail-copy">'+d.need+'</p><span class="source-note">递交于 '+d.submit+'</span></div>'+
      '<div class="detail-block"><h3>资源端判断</h3><div class="'+(d.res==='none'?'warning-callout':'info-callout')+'" style="margin-top:0"><b style="color:'+rc.c+'">'+d.resLabel+'</b> · '+d.note+'</div></div>'+
      '<div class="detail-block"><h3>候选线索</h3>'+(d.clues>0?'<ul class="source-list"><li><i class="i">🔗</i>已派生 '+d.clues+' 家脱敏候选线索<small>由政府端报告缺口结论派生</small></li></ul>':'<div class="fact-with-icon warning"><i class="i">⚠</i><div><strong>暂无匹配线索</strong><span>建议纳入长期跟踪或对接外部渠道</span></div></div>')+'</div>'+
      '<div class="boundary-note"><i class="i">🔒</i>资源可达性、关键人触达由资源团队线下核验；系统只做需求汇总、状态跟踪与提醒，不自动联系企业。</div>'+
    '</div>'+
    '<div class="detail-actions-stack" style="gap:8px;padding:12px 22px 16px">'+
      '<button class="primary-button" onclick="opsAction(\''+d.id+'\')"><i class="i">'+(d.res==='matched'?'🤝':d.res==='checking'?'🔍':'📌')+'</i>'+(d.res==='matched'?'安排招商对接':d.res==='checking'?'查看核验进度':'纳入长期跟踪')+'</button>'+
      '<small>对接进度会同步回该城市干部的「当前研判」时间线</small>'+
    '</div></div>';
}
function pickDemand(id){curDemand=id;detailOpen=true;render()}
function opsAction(id){
  var d=DEMANDS.find(function(x){return x.id===id});if(!d)return;
  if(d.res==='matched'){
    // 已匹配 → 弹出对接安排表单（真实内容）
    var body='<p class="modal-intro">为「'+d.city+' · '+d.topic+'」安排招商对接，确认后将同步回该城市干部的「当前研判」时间线。</p>'+
      '<div class="kv"><span class="kk" style="width:74px;color:#8490a5">需求方</span><span class="vv">'+d.gov+'</span></div>'+
      '<div class="kv"><span class="kk" style="width:74px;color:#8490a5">候选线索</span><span class="vv">'+d.clues+' 家脱敏企业（资源端核验通过）</span></div>'+
      '<div class="form-stack" style="margin-top:12px"><label>拟对接时间<input value="本周内 · 待与双方确认"></label>'+
      '<label>对接方式<input value="资源端带队实地走访 + 政企座谈"></label></div>';
    openModal('安排招商对接',body,'<button class="secondary-button" onclick="closeModal()">取消</button><button class="primary-button" onclick="closeModal();toast(\'对接安排已发起，将通知 '+d.gov+'\')">确认发起对接</button>');
  }else if(d.res==='checking'){
    // 核验中 → 弹出核验进度详情
    var body='<p class="modal-intro">「'+d.city+' · '+d.topic+'」资源可达性核验进度：</p>'+
      '<div class="timeline"><div class="timeline-item done"><div class="timeline-dot"><i class="i">✓</i></div><div><div class="timeline-title"><strong>需求已接收</strong></div><p>已同步需求与报告证据链。</p></div></div>'+
      '<div class="timeline-item current"><div class="timeline-dot"><i class="i">◔</i></div><div><div class="timeline-title"><strong>资源匹配中</strong></div><p>正在核验 '+d.clues+' 家候选线索的真实意向与决策层触达。</p></div></div>'+
      '<div class="timeline-item"><div class="timeline-dot"><i class="i">•</i></div><div><div class="timeline-title"><strong>反馈可对接企业</strong></div><p>核验完成后回传该城市干部。</p></div></div></div>';
    openModal('资源核验进度',body,'<button class="primary-button" onclick="closeModal()">知道了</button>');
  }else{
    // 暂无资源 → 弹出长期跟踪确认
    var body='<p class="modal-intro">「'+d.city+' · '+d.topic+'」当前资源库暂无直接匹配，可纳入长期跟踪或对接外部渠道。</p>'+
      '<div class="fact-with-icon warning"><i class="i">⚠</i><div><strong>暂无匹配线索</strong><span>纳入跟踪后，有新资源进入将自动提醒</span></div></div>';
    openModal('纳入长期跟踪',body,'<button class="secondary-button" onclick="closeModal()">取消</button><button class="primary-button" onclick="closeModal();toast(\'已纳入长期跟踪，有匹配将提醒\')">确认纳入</button>');
  }
}
function brandLogo(){return 'data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" rx="25" fill="#0757ad"/><text x="25" y="33" font-size="22" fill="white" text-anchor="middle" font-family="sans-serif">慧</text></svg>')}
function topbar(p){
  return '<div class="topbar">'+
    '<div class="brand-block"><img src="data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"50\" height=\"50\"><rect width=\"50\" height=\"50\" rx=\"25\" fill=\"%230757ad\"/><text x=\"25\" y=\"33\" font-size=\"22\" fill=\"white\" text-anchor=\"middle\" font-family=\"sans-serif\">慧</text></svg>')+'"><div><strong>慧小招</strong><span>AI 招商智能体</span></div></div>'+
    // 机构与身份固定（账号绑定，不可切换）；当前方向只读展示，切换在「招商对接」进行
    '<div class="org-block"><i class="i">🏛️</i>'+
      '<strong style="font-weight:650">'+p.org+' · '+(p&&p.who||'—')+'</strong>'+
      '<span style="margin:0 10px;color:#cbd7e6">/</span>'+
      '<strong id="topbarTopic" style="color:var(--blue-dark)">'+p.topic+'</strong>'+
    '</div>'+
    '<div class="top-meta"><span><i class="i">🛰️</i>'+p.city+'城市智库已连接</span><span><i class="i">🕒</i>'+nowLabel()+'产业信息更新至 '+nowLabel()+'</span>'+
      '<span style="position:relative;cursor:pointer" onclick="toggleNotif(event)"><i class="i">🔔</i>'+
        (unreadCount()>0?'<b style="position:absolute;top:-4px;right:-6px;min-width:15px;height:15px;padding:0 3px;border-radius:8px;background:#c85b09;color:#fff;font-size:9px;line-height:15px;text-align:center;font-weight:700">'+unreadCount()+'</b>':'')+
        '<div id="notifPanel" style="display:none;position:absolute;top:30px;right:0;width:380px;max-height:520px;overflow-y:auto;background:#fff;border:1px solid #d8e0ed;border-radius:12px;box-shadow:0 12px 32px rgba(11,24,59,.16);z-index:70;text-align:left;cursor:default" onclick="event.stopPropagation()">'+notifList()+'</div>'+
      '</span>'+
      (AUTH?'<button onclick="logout()" title="退出登录" style="display:inline-flex;align-items:center;gap:5px;min-height:32px;padding:0 11px;border:1px solid #f0d8d8;border-radius:8px;background:#fff;color:#b5504a;font-size:12.5px;cursor:pointer">\u21aa 退出</button>':'')+
      '</div>'+
  '</div>';
}

/* 切换城市功能已移除：现改为只能通过账号密码登录进入对应城市，不允许前端切换到其他城市 */
function stColor(s){return s>=4?{bg:'#e4f5f3',c:'#006d70'}:s>=3?{bg:'#ebf3fd',c:'#013582'}:{bg:'#fff0de',c:'#a34c09'}}

/* kb lock/readiness */
var KB_UNLOCKED={};

function kbReadiness(){
  var p=P(); if(!p||!p.kb) return {score:0,total:0,confirmed:0,files:0,label:'未开始',color:'#9aa5b5'};
  // 只统计 ⚠️ 条目作为「待确认」分母
  // 普通事实性条目（AI 从报告提取）默认已确认，不要求领导操作
  var warnTotal=0, warnConfirmed=0;
  p.kb.forEach(function(k,ki){
    (k.known||[]).forEach(function(x,xi){
      x=_kbText(x);
      /* 【2026-09-23 修复】计分分母必须与显示层同口径：跳过占位/垃圾条目。
         根因：ops.html addKbItem() 先把「⚠️ 请在此输入补充内容（保存后写入知识库）」
         占位符 push 进 kb.known 再弹编辑框，用户取消/关掉弹窗后占位符就永久留在数据里。
         政府端 13 处显示路径都用 _isJunkKbItem 过滤掉了它，干部看不见；
         但这里不过滤 → 占位符计入待确认分母，且永远无法被确认。
         实测随州 4 个项目各 6 条占位：确认率被从 100% 压到 60%、
         就绪分从 100 压到 92，pendingWarn 常驻 6 条清不掉。
         只在计分时跳过，不动 kb.known 数据本身（数据完整性铁律）。 */
      if(typeof _isJunkKbItem==='function' && _isJunkKbItem(x)) return;
      // 归一化 emoji 变体选择符(U+FE0F)：报告RAG回填的条目常用裸码 ⚠(U+26A0)/✅(U+2705)，
      // 若判断串带 ️ 会匹配不到 → warnTotal=0 → 确认率误判为满分白送30分(松江虚高80%根因)。
      var _x=x.replace(/\ufe0f/g,'');
      var isWarn=_x.indexOf('\u26a0')>=0;
      var isDone=_x.trim().indexOf('\u2705')===0;
      if(!isWarn&&!isDone) return;  // 非⚠️且非✅，跳过
      warnTotal++;
      var conf=KB_CONFIRMS[cur]&&KB_CONFIRMS[cur][ki]&&KB_CONFIRMS[cur][ki][xi];
      if(conf||isDone) warnConfirmed++;
    });
  });
  // 注意：城市智库进度只统计智库条目（⚠️/✅）+ 上传材料，不纳入产业分析报告页的
  // 待确认事项（PENDING_CONFIRMS）。报告页确认待确认事项属于「某个研判方向」的动作，
  // 只应提升该方向的报告置信度（见 topicScore），不应改变城市智库整体完成度。
  var uploads=(UPLOADS[cur]||[]).length;
  // 统计所有 known 条目总数（不止⚠️/✅），用于判断板块是否真的有数据
  var knownTotal=0;
  p.kb.forEach(function(k){
    (k.known||[]).forEach(function(x){
      // 占位/垃圾条目不计入数据覆盖度，否则空占位也能把覆盖率刷上去
      if(typeof _isJunkKbItem==='function' && _isJunkKbItem(_kbText(x))) return;
      knownTotal++;
    });
  });
  // 关键修复：完全无数据（板块空 + 零上传 + 无解析片段/确认）时，完成度必须为 0（未开始），
  // 而不是把"无⚠️条目"当成"全部完成"错误给到 80 分。
  if(knownTotal===0 && uploads===0 && !hasRealKbData(p)){
    return {score:0,total:0,confirmed:0,files:0,label:'未开始',color:'#9aa5b5'};
  }
  // 评分：数据覆盖度×80 + 上传材料×10（上限20）+ ⚠️确认率×20
  // 这套权重决定「数据够不够」，是 isLocked 的解锁依据，不要动 ——
  // 调低它会把原本能自动解锁的城市（如松江 83%）打到门槛下，
  // 导致产业分析/招商对接突然打不开（实测踩过）。
  var coverRate=Math.min(1, knownTotal/20); // 有20条以上数据视为数据覆盖满分
  var uploadBonus=Math.min(20, uploads*10); // 每份材料10分，最多20
  var warnRate=warnTotal>0?warnConfirmed/warnTotal:1; // 无⚠️条目时视为满率（不惩罚）
  var score=Math.min(100, Math.round(coverRate*80 + uploadBonus + warnRate*20));
  // 未确认的 ⚠️ 待确认条数（只数真正待确认的，不含已核验 ✅）
  var pendingWarn=0;
  p.kb.forEach(function(k,ki){
    (k.known||[]).forEach(function(x,xi){
      var _raw=_kbText(x);
      // 与上面分母同口径：占位/垃圾条目不算待确认（否则进度条永远卡着清不掉）
      if(typeof _isJunkKbItem==='function' && _isJunkKbItem(_raw)) return;
      var _t=_raw.replace(/\ufe0f/g,'');
      if(_t.indexOf('\u26a0')<0) return;
      var _c=KB_CONFIRMS[cur]&&KB_CONFIRMS[cur][ki]&&KB_CONFIRMS[cur][ki][xi];
      if(!_c) pendingWarn++;
    });
  });
  // 硬门槛：还有待确认事项没核实，就不能算「已就绪」——
  // 干部看到 93%/96% 已就绪却还有 10 条待确认，会误以为数据可以直接用。
  // rawScore = 不含待确认门槛的原始分，代表「数据本身够不够」。
  // 解锁门槛(isLocked)必须用它，否则待确认未清零会把产业分析/招商对接整个锁住——
  // 待确认是"要核实"，不是"数据不够"，不该连带剥夺已有功能。
  var rawScore=score;
  // 【2026-09-18 优化】原来是 `if(pendingWarn>0) score=Math.min(score,79)` ——一刀切到 79，
  // 导致确认了 1 条还是 79、确认了 13 条也还是 79，干部完全看不到自己的进展。
  // 改为线性封顶：封顶值随确认进度从 60 递增到 99，每确认一条都会动；
  // 仍保留「未清零不得显示已就绪(≥99)」的初衷，只有全部确认才能到 100。
  if(pendingWarn>0){
    var _wr=(warnTotal>0)?(warnConfirmed/warnTotal):0;   // 已确认占比
    // 封顶值随确认进度从 79 递增到 99。
    // 注意：起点必须是 79（旧门槛值）而不是 60 —— 否则一条未确认时
    // 松江会从 79% 掲到 60%，干部会以为数据倒退了（实测模拟踩过）。
    // 取 max 保证“只涨不降”：未确认任何一条时与旧逻辑一致，每确认一条再往上走。
    var _cap=Math.max(79, 79+Math.round(_wr*20));        // 79 → 99 线性
    score=Math.min(score, _cap);
  }
  // 【2026-09-18】标签带上板块名：pendingWarn 是跸板块累加，
  // 干部在园区板块确认完看到数字不动会以为没生效。
  var _pendSecs=[];
  try{
    p.kb.forEach(function(k,ki){
      var _n=0;
      (k.known||[]).forEach(function(x,xi){
        var _t=_kbText(x).replace(/\ufe0f/g,'');
        if(_t.indexOf('\u26a0')<0) return;
        if(!(KB_CONFIRMS[cur]&&KB_CONFIRMS[cur][ki]&&KB_CONFIRMS[cur][ki][xi])) _n++;
      });
      if(_n>0) _pendSecs.push(String(k.t||'').replace(/[\u3001\uff0c].*$/,''));
    });
  }catch(_e){}
  var _secHint=_pendSecs.length?('\uff08'+_pendSecs.join('\u3001')+'\uff09'):'';
  // 标签带上「已确认/总数」，干部能看到自己推进了多少
  var _progHint=(warnTotal>0)?(' · 已确认 '+warnConfirmed+'/'+warnTotal):'';
  var label=pendingWarn>0
    ? (pendingWarn+' 条待确认'+_secHint+_progHint)
    : (score>=80?'已就绪':score>=50?'基本完整':score>=20?'待补充':'未开始');
  var color=pendingWarn>0
    ? '#f59e0b'
    : (score>=80?'#22c55e':score>=50?'#f59e0b':score>=20?'#3b82f6':'#9aa5b5');
  return {score:score,rawScore:rawScore,total:warnTotal,confirmed:warnConfirmed,files:uploads,
          label:label,color:color,pendingWarn:pendingWarn};
}


/* 按研判方向计算置信度。
   核心：每个方向的置信度应反映「该方向报告自身」的数据充实度，而非城市级共享分——
   否则所有方向都等于同一个 kbReadiness 基础分，显示成一样（如全部 96%）。
   构成：方向报告数据充实度（量化数据点数、待核实/待确认缺口数、报告完整度）
        + 城市智库基础背书（占小头）+ 上传/确认加分。分数按 topic 稳定可复现。 */
/* 方向名归一化：同一方向在父/子项目里可能有措辞差异
   （实测「IVD上游原料与生物试剂延链」vs「IVD上游原料与试剂延链」被当成两个方向，
   各自算出 60 与 49，对接页又现场重算出 56 —— 同一报告三个置信度）。
   去掉空白、标点与常见修饰词后比较，让冻结值能被命中。 */
function _normTopic(t){
  return String(t==null?'':t)
    .replace(/[\s\u3000\u3001\uff0c,\.\u3002\/\-—（）()【】\[\]]/g,'')
    .replace(/(与|和|及|的)/g,'')
    .replace(/(生物|高端|新型|核心|上游|下游)/g,'')
    .toLowerCase();
}
/* 在指定项目的 scoreByTopic 里查冻结分：先精确命中，再按归一化名回退 */
function _frozenScoreIn(pk, topic){
  var rs = pk && REPORTSTATE[pk];
  var map = rs && rs.scoreByTopic;
  if(!map || typeof map!=='object') return 0;
  var v = map[topic];
  if(typeof v==='number' && v>0) return v;
  var want=_normTopic(topic);
  var keys=Object.keys(map);
  for(var i=0;i<keys.length;i++){
    if(_normTopic(keys[i])===want){
      var v2=map[keys[i]];
      if(typeof v2==='number' && v2>0) return v2;
    }
  }
  return 0;
}
/* topicScore(topic, projKey)
   【2026-09-21 修复】原先冻结值只查 REPORTSTATE[cur]，而招商对接页是在子项目循环里
   调用的（rs=REPORTSTATE[k]，k 为子项目 key）。于是子项目的冻结分（存在
   REPORTSTATE[子项目].scoreByTopic）永远查不到，一律落到现场重算，同一份报告
   在报告页显示存储值、在对接页显示重算值（实测 60 vs 56、83 vs 60、80 vs 55）。
   现在允许传入 projKey：按该项目取自己的冻结值与自己的上传/确认数据。 */
function topicScore(topic, projKey){
  var _pk = projKey || cur;
  var cityBase = kbReadiness().score;   // 城市智库整体就绪度（所有方向共享的背书，占小头）
  if(!topic) return Math.min(96, Math.max(42, cityBase));

  // ── 冻结值优先：报告生成完成时写入 scoreByTopic[topic]，之后所有渲染直接读这个值，
  //    避免"同一份分析在不同渲染时刻（草稿 loading / 流式增长 / 完整报告）"取到不同快照
  //    导致徽章多值（曾观察到 60% / 62% / 68% / 89% 同报告并存）。
  //    查找顺序：该项目自己的冻结表 → 当前项目的冻结表（父项目继承场景）。
  var _frozen = _frozenScoreIn(_pk, topic);
  if(!_frozen && _pk!==cur) _frozen = _frozenScoreIn(cur, topic);
  if(_frozen>0) return _frozen;

  // ── 取该方向报告文本，度量其数据充实度 ──
  var txt = (typeof reportTextForTopic==='function' ? reportTextForTopic(topic) : '') || '';
  var dataScore;
  if(txt){
    // 量化数据点：报告中出现的数字（含百分比/金额/年份等），越多说明有据可依
    var numHits = (txt.match(/\d[\d,\.]*\s*(%|亿|万|元|家|台|辆|吨|个|km|公里|年|月)/g)||[]).length;
    // 缺口标记：待核实/待确认/待补充 越多说明数据越不足
    var gapHits = (txt.match(/待核实|待确认|待补充|暂无|缺失|未收录|无数据/g)||[]).length;
    // 报告完整度：长度（章节丰富度）
    var lenScore = Math.min(20, Math.round(txt.length/400));  // 每400字+1，上限+20
    var numScore = Math.min(28, numHits * 2);                 // 每个量化点+2，上限+28
    var gapPenalty = Math.min(30, gapHits * 3);               // 每个缺口-3，上限-30
    dataScore = 45 + numScore + lenScore - gapPenalty;        // 方向自身基准45
  } else {
    // 该方向尚未生成报告：给一个「仅基于城市数据的初判」低分，且各方向按名称稳定微调避免全同
    dataScore = 40 + (hashTopic(topic) % 7);  // 40~46 之间，方向间有区分
  }

  // ── 城市智库背书（占小头，避免完全脱离城市数据）──
  var cityAdj = Math.round((cityBase - 60) * 0.15);  // cityBase 高于60加分、低于60减分，幅度小

  // ── 上传/确认加分（作用于当前操作方向）──
  // 【2026-09-21】原先恒用 cur：为子项目算分时掺进了当前项目的上传/确认数据，
  //   这是同一方向分差能拉到 83 vs 60 的另一半原因。改为按目标项目取。
  var uploads = (UPLOADS[_pk]||[]).filter(function(u){return !!u.size||!!u.ts;}).length;
  var uploadAdj = Math.min(12, uploads * 3);
  var pend = PENDING_CONFIRMS[_pk]||[];
  var pendDone = pend.filter(function(it){return it&&(it.status==='confirmed'||it.status==='edited');}).length;
  var pendAdj = Math.min(12, pendDone * 2);

  var final = Math.round(dataScore + cityAdj + uploadAdj + pendAdj);
  return Math.min(96, Math.max(42, final));
}

/* 方向名 → 稳定散列（用于未生成报告时给各方向一个可复现的区分微调，避免显示全同） */
function hashTopic(s){
  var h=0; s=String(s||'');
  for(var i=0;i<s.length;i++){ h=(h*31 + s.charCodeAt(i))>>>0; }
  return h;
}

function isLocked(v){
  if(['report','home','docking'].indexOf(v)<0) return false;
  if(!cur) return true;
  var p=P();
  // 已移除"随州始终解锁"特权：随州与新城市一致，产业分析/招商对接默认上锁，
  // 待城市智库有真实数据且完成度达标(≥80%)自动解锁，或用户手动强制解锁。
  // 用户手动强制解锁（点了"强制解锁"）优先级最高：明确表达了意愿就尊重，
  // 即使数据可靠性较低也放行。必须在 hasRealKbData 检查之前判断，否则新城市永远解不开锁。
  if(KB_UNLOCKED[cur]&&KB_UNLOCKED[cur][v]) return false;
  // 无真实数据(仅AI初判占位)且未手动解锁时锁定。
  if(!hasRealKbData(p)) return true;
  // 有真实数据后：数据覆盖达 80% 自动解锁。
  // 用 rawScore（不含待确认门槛）：待确认未核实只影响进度条标签，
  // 不能把干部本来能用的产业分析/招商对接锁掉。
  var _r=kbReadiness();
  return (_r.rawScore!==undefined?_r.rawScore:_r.score)<80;
}

function unlockView(v){
  if(!cur) return;
  if(!KB_UNLOCKED[cur]) KB_UNLOCKED[cur]={};
  KB_UNLOCKED[cur][v]=true;
  persist();
  closeModal();
  go(v);
}

/* 城市智库完成度进度条内部 HTML（供 sidebar 首渲染 + 确认/上传后局部刷新复用） */
function kbPageProgressInner(r){
  r=r||kbReadiness();
  var warn='⚠️'; var info='ⓘ';
  return '<div style="display:flex;align-items:center;gap:10px;margin-top:8px">'+
    '<div style="flex:1;background:#f0f4ff;border-radius:4px;height:6px;overflow:hidden">'+
      '<div style="height:100%;width:'+r.score+'%;background:'+r.color+';border-radius:4px;transition:width .4s"></div>'+
    '</div>'+
    '<span style="font-size:12px;font-weight:700;color:'+r.color+'">'+r.score+'%</span>'+
    '<span style="font-size:11px;color:'+r.color+'">'+r.label+'</span>'+
    '<span title="计算方式：智库覆盖度×80% + 上传材料×10%（上限 20%）+ 确认'+warn+'事项×20%"'+
      ' style="font-size:11px;color:#9aa5b5;cursor:help;margin-left:2px">'+info+'</span>'+
  '</div>'+
  (r.score<80?'<p style="font-size:11.5px;color:#f59e0b;margin:5px 0 0">⚡ 上传越多材料、确认越多结论，研判数据可靠性越高（差 '+(80-r.score)+'% 自动解锁后续步骤）</p>':'');
}
function kbProgressInner(r){
  r=r||kbReadiness();
  return '<div style="padding:10px 14px 8px;border-top:1px solid #f0f4ff">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">'+
      '<span style="font-size:10.5px;color:#9aa5b5;letter-spacing:.3px">城市智库完成度</span>'+
      '<span style="font-size:11px;font-weight:700;color:'+r.color+'">'+r.score+'%</span>'+
    '</div>'+
    '<div style="height:4px;background:#f0f4ff;border-radius:2px;overflow:hidden">'+
      '<div style="height:100%;width:'+r.score+'%;background:'+r.color+';border-radius:2px;transition:width .4s"></div>'+
    '</div>'+
    '<div style="font-size:10.5px;color:'+r.color+';margin-top:4px">'+r.label+
      ((UPLOADS[cur]||[]).length>0?' &middot; '+(UPLOADS[cur]||[]).length+'份材料':'')+'</div>'+
  '</div>';
}
/* 确认/编辑/上传后即时刷新顶部完成度条（不整页重渲染，弹窗保持打开） */
function refreshKbProgress(){
  var r=kbReadiness();
  var box=document.getElementById('kbProgressBox');
  if(box) box.innerHTML=kbProgressInner(r);
  var pageBar=document.getElementById('kbPageProgress');
  if(pageBar) pageBar.innerHTML=kbPageProgressInner(r);
}
function sidebar(){
  var p=P();
  var r=kbReadiness();
  // 动态副标题：反映实际进度
  var navMeta={
    knowledge: (function(){
      if(!p) return '完善材料·产业/园区/企业/政策';
      var conf=KB_CONFIRMS[cur]?Object.keys(KB_CONFIRMS[cur]).reduce(function(n,ki){return n+Object.keys(KB_CONFIRMS[cur][ki]).length;},0):0;
      var uploads=(UPLOADS[cur]||[]).length;
      if(r.pendingWarn>0) return '⚠ '+r.pendingWarn+' 条待确认 · 数据覆盖 '+(r.rawScore!==undefined?r.rawScore:r.score)+'%';
  if(r.score>=80) return '✓ 已就绪 '+r.score+'% · '+conf+'条已确认';
      return conf>0?(conf+'条已确认 · '+uploads+'份材料 · '+r.score+'%'):'待完善 · 产业/园区/企业/政策';
    })(),
    report: '生成缺口分析与招引方向',
    home: '项目列表·对接进度',
    docking: (function(){
      var _vc=visibleClues(p, cur);
      if(!_vc.length) return '候选企业·可达性核验';
      var amber=_vc.filter(function(c){return c.tag==='amber';}).length;
      return _vc.length+'条线索 · '+amber+'条待核验';
    })()
  };
  return '<div class="sidebar"><div class="nav-list">'+
    NAV.map(function(n){
      var on=view===n[0]?' active':'';
      var locked=isLocked(n[0]);
      var lockBadge=locked?'<span style="font-size:10px;margin-left:auto;opacity:.5">&#128274;</span>':'';
      var dimCss=locked&&view!==n[0]?'opacity:.55;':'';
      var sub=navMeta[n[0]]||n[3]||'';
      return '<button class="nav-item'+on+'" onclick="go(\''+n[0]+'\')" style="'+dimCss+'">'+
        '<i class="i">'+n[1]+'</i>'+
        '<span class="nav-copy"><strong>'+n[2]+'</strong><small>'+sub+'</small></span>'+
        lockBadge+
      '</button>';
    }).join('')+'</div>'+
    (function(){
      if(!cur)return '';
      return '<div id="kbProgressBox">'+kbProgressInner(r)+'</div>';
    })()+
    '<div class="system-status"><span></span>系统运行正常</div></div>';
}
function progressFooter(p){
  return '';  // 底部阶段进度条已按需移除：大产业下有细分小产业，进度不在此统一体现
  p=p||P(); if(!cur||!PROJECTS[cur]||!p||!p.stage)return '';
  if(view==='home')return '';
  var _st=projStages(p);
  // 只渲染到当前阶段为止：未到达的步骤不预先画出，推进到哪一步才显示到哪一步
  var _shown=_st.slice(0, p.stage);
  return '<div class="progress-footer"><div class="progress-track">'+
    _shown.map(function(s,si){var n=si+1;var cls=n<p.stage?' done':' current';
      var sv=[null,'report','home','docking',null][si];
      var locked=sv&&isLocked(sv);
      var nodeContent=n<p.stage?'<i class="i">\u2713</i>':locked?'&#128274;':n;
      var dimStyle=locked&&n!==p.stage?'opacity:.55':'';
      return '<div class="progress-step'+cls+'" style="'+dimStyle+'" '+
        (sv?'onclick="go(\''+sv+'\')" style="cursor:pointer"':'')+'>'+
        '<div class="progress-node">'+nodeContent+'</div>'+
        '<div class="progress-copy"><strong>'+s[0]+(locked?' &#128274;':'')+'</strong><small>'+s[1]+'</small></div></div>'+
        (n<_shown.length?'<div class="progress-line"></div>':'');
    }).join('')+'</div><div class="progress-mobile">📂 '+p.topic+' · 当前「'+stageNameOf(p,p.stage)+'」· 第 '+p.stage+' 步（进度跟随所选产业方向）</div></div>';
}
