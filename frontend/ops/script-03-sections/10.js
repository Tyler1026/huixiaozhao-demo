/* ===== 运营端：跨城市需求池（沿用政府端三栏结构）===== */
function renderOps(){
  if(!DEMANDS.length){$('#root').innerHTML='<div class="app-shell">'+opsTopbarEmpty()+'<div style="display:flex;align-items:center;justify-content:center;height:80vh;flex-direction:column;gap:16px"><div style="font-size:32px">📭</div><div style="font-weight:650;color:#0b183b">暂无需求</div><div style="color:#667590;font-size:13px">切换到政府端，完成第一个研判后需求会出现在这里。</div><button class="primary-button" style="margin-top:8px" onclick="setRole(\'gov\')">去政府端开始研判</button></div></div>';return;}
  if(curDemand===null&&DEMANDS.length)curDemand=DEMANDS[0].id;
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
    // 机构与身份固定（账号绑定，不可切换）；当前方向只读展示，切换在「项目管理」进行
    '<div class="org-block"><i class="i">🏛️</i>'+
      '<strong style="font-weight:650">'+p.org+' · '+(p&&p.who||'—')+'</strong>'+
      '<span style="margin:0 10px;color:#cbd7e6">/</span>'+
      '<strong style="color:var(--blue-dark)">'+p.topic+'</strong>'+
    '</div>'+
    roleSwitch()+
    '<div class="top-meta"><span><i class="i">🛰️</i>'+p.city+'城市智库已连接</span><span><i class="i">🕒</i>随州产业信息更新至 7月20日 06:00</span>'+
      '<span style="position:relative;cursor:pointer" onclick="toggleNotif(event)"><i class="i">🔔</i>'+
        (unreadCount()>0?'<b style="position:absolute;top:-4px;right:-6px;min-width:15px;height:15px;padding:0 3px;border-radius:8px;background:#c85b09;color:#fff;font-size:9px;line-height:15px;text-align:center;font-weight:700">'+unreadCount()+'</b>':'')+
        '<div id="notifPanel" style="display:none;position:absolute;top:30px;right:0;width:310px;background:#fff;border:1px solid #d8e0ed;border-radius:12px;box-shadow:0 12px 32px rgba(11,24,59,.16);z-index:70;overflow:hidden;text-align:left;cursor:default" onclick="event.stopPropagation()">'+notifList()+'</div>'+
      '</span></div>'+
  '</div>';
}
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
      var isWarn=x.indexOf('\u26a0\ufe0f')>=0;
      if(!isWarn) return;  // 非⚠️直接跳过，视为已确认
      warnTotal++;
      var conf=KB_CONFIRMS[cur]&&KB_CONFIRMS[cur][ki]&&KB_CONFIRMS[cur][ki][xi];
      if(conf||x.indexOf('\u2705')===0) warnConfirmed++;
    });
  });
  var uploads=(UPLOADS[cur]||[]).length;
  // 评分：⚠️确认率×60 + 上传加分×40
  var warnRate=warnTotal>0?warnConfirmed/warnTotal:1; // 无⚠️时视为全部完成
  var uploadBonus=Math.min(40, uploads*10);
  var score=Math.round(warnRate*60 + uploadBonus);
  var label=score>=80?'已就绪':score>=50?'基本完整':score>=20?'待补充':'未开始';
  var color=score>=80?'#22c55e':score>=50?'#f59e0b':score>=20?'#3b82f6':'#9aa5b5';
  return {score:score,total:warnTotal,confirmed:warnConfirmed,files:uploads,label:label,color:color};
}

function isLocked(v){
  if(['report','home','docking'].indexOf(v)<0) return false;
  if(!cur) return true;
  if(KB_UNLOCKED[cur]&&KB_UNLOCKED[cur][v]) return false;
  return kbReadiness().score<80;
}

function unlockView(v){
  if(!cur) return;
  if(!KB_UNLOCKED[cur]) KB_UNLOCKED[cur]={};
  KB_UNLOCKED[cur][v]=true;
  persist();
  closeModal();
  go(v);
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
      if(r.score>=80) return '✓ 已就绪 '+r.score+'% · '+conf+'条已确认';
      return conf>0?(conf+'条已确认 · '+uploads+'份材料 · '+r.score+'%'):'待完善 · 产业/园区/企业/政策';
    })(),
    report: (function(){
      if(!p) return '生成缺口分析与招引方向';
      var rs=REPORTSTATE[cur];
      if(!rs) return '待研判 · 选方向后点击生成';
      if(rs.phase===1){
        var pc=PENDING_CONFIRMS[cur]||[];
        var done=pc.filter(function(x){return x.status==='confirmed'||x.status==='edited';}).length;
        return done+'/'+pc.length+' 待确认 · 草稿已生成';
      }
      return '✓ 完整报告已生成 · '+rs.score+'%置信度';
    })(),
    home: (function(){
      if(!p) return '报告派生项目·对接需求';
      var stage=p.stage||1;
      var stageNames=['资料准备','AI研判','确认需求','资源匹配','招商对接'];
      var nProjects=Object.keys(PROJECTS).length;
      return nProjects+'个项目 · 当前「'+(stageNames[stage-1]||'进行中')+'」';
    })(),
    docking: (function(){
      if(!p||!p.clues||!p.clues.length) return '候选企业·可达性核验';
      var amber=p.clues.filter(function(c){return c.tag==='amber';}).length;
      return p.clues.length+'条线索 · '+amber+'条待核验';
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
    })()+
    '<div class="system-status"><span></span>系统运行正常</div></div>';
}
function progressFooter(p){
  p=p||P(); if(!cur||!PROJECTS[cur]||!p||!p.stage)return '';
  var _st=projStages(p);
  return '<div class="progress-footer"><div class="progress-track">'+
    _st.map(function(s,si){var n=si+1;var cls=n<p.stage?' done':n===p.stage?' current':'';
      var sv=[null,'report','home','docking',null][si];
      var locked=sv&&isLocked(sv);
      var nodeContent=n<p.stage?'<i class="i">\u2713</i>':locked?'&#128274;':n;
      var dimStyle=locked&&n!==p.stage?'opacity:.55':'';;
      return '<div class="progress-step'+cls+'" style="'+dimStyle+'" '+
        (sv?'onclick="go(\''+sv+'\')" style="cursor:pointer"':'')+'>'+
        '<div class="progress-node">'+nodeContent+'</div>'+
        '<div class="progress-copy"><strong>'+s[0]+(locked?' &#128274;':'')+'</strong><small>'+s[1]+'</small></div></div>'+
        (n<_st.length?'<div class="progress-line"></div>':'');
    }).join('')+'</div><div class="progress-mobile">📂 '+p.topic+' · 当前「'+stageNameOf(p,p.stage)+'」· 第 '+p.stage+'/'+_st.length+' 步（进度跟随所选产业方向）</div></div>';
}
