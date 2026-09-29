/* ===== 管理端扩展：数据 + 新模块 ===== */
var LEADER_DOCS=[];






var RESOURCES=[]; // 冷启动：空库
var MATCH_CHAT=[{who:'ai',text:'我是招商匹配助手。可以问我：这条需求该找哪类企业？有哪些外部渠道能找源？如何写定向招募话术？'}];
var RES_SEED=[
  {alias:'华南某燃料电池电堆企业',real:'（内部可见真名）',tag:'燃料电池电堆',domain:'燃料电池电堆',loc:'华南',intent:'有异地设厂意向',status:'可用',
   profile:'年产电堆约5000台，掌握金属双极板与膜电极核心工艺；现有产能饱和，公开释放异地扩产信号。',
   why:'随州新楚风49T氢重卡已量产、程力整车体量大，但电堆占整车成本53%全靠外购，该企业补最核心缺口，可直接与本地整车厂形成配套。',
   risk:'异地设厂尚在选址阶段，需核实真实投资时间表与决策层意向；同期有2个竞争城市在接触。'},
  {alias:'长三角某应急无人机集成商',real:'（内部可见真名）',tag:'应急机器人与无人机',domain:'应急机器人与无人机',loc:'长三角',intent:'具备可对接窗口',status:'可用',
   profile:'应急无人机系统集成商，产品线覆盖消防侦察/通信中继/载荷挂载；有区域总部下沉布局意愿。',
   why:'随州博利特系留无人机平台、齐星6架无人机指挥车均已量产，但无人机本体靠外采（依迅北斗），该企业落地可形成本地闭环，直接替代外购依赖。',
   risk:'更看重政府应急演练/示范场景开放程度，需确认随州曾都区安全应急示范基地能提供对应场景与奖补。'},
  {alias:'华东某香菇功能成分提取企业',real:'（内部可见真名）',tag:'香菇功能成分提取',domain:'香菇功能成分提取',loc:'华东',intent:'寻求中部原料产地合作',status:'可用',
   profile:'香菇多糖/多肽功能成分提取，下游对接保健品/生物医药客户；正在寻求贴近原料产地的生产基地。',
   why:'随州年产香菇约70万吨（全球白花菇约50%），就近落地可将原料采购成本降低40%+；与裕国药业/肽源形成产能协作，共同做大提取环节。',
   risk:'需核实洁净厂房等级与能耗是否符合GMP要求，以及随州现有产业园是否有配套条件。'}
];
var DOCK_ITEMS=[];



var CITY_FUNNEL=[];




var OPEN_ACCOUNTS=[];























function renderOps(){
  document.body.classList.add('ops-mode');
  if(curDemand===null)curDemand=DEMANDS[0].id;
  var hasDetail=(opsView==='pool');
  var footer=(opsView==='pool')?opsFooter():'';
  $('#root').innerHTML=
   '<div class="app-shell">'+
    opsTopbar()+
    '<div class="app-content">'+opsSidebar()+
      '<div class="pane-divider"><span class="divider-grip"><i class="i">⋮</i></span></div>'+
      '<div class="content-column"><div class="workspace">'+
        '<div class="main-pane">'+opsRoute()+'</div>'+
        (hasDetail&&detailOpen?('<div class="detail-pane">'+opsDetail()+'</div>')
          :(hasDetail?('<button class="reopen-detail" onclick="toggleDetail()"><i class="i">🧾</i>展开详情</button>'):''))+
      '</div></div>'+
    '</div>'+
    footer+
   '</div>';
  bind();
}
function opsNav(v){opsView=v;detailOpen=true;render()}
function opsRoute(){
  switch(opsView){
    case 'pool': return opsMain();
    case 'leader': return opsLeader();
    case 'res': return opsRes();
    case 'match': return opsMatch();
    case 'dock': return opsDock();
    case 'city': return opsCity();
    case 'open': return opsOpen();
    case 'board': return opsBoard();
    default: return opsMain();
  }
}
function opsCrumb(){
  var map={pool:['📥','需求池','全国需求池'],leader:['📂','领导材料台','各地资料汇总'],res:['🤝','资源库','可对接企业'],match:['🧩','智能匹配','AI 撮合 + 核验'],dock:['🗂️','对接管理','落地看板'],city:['🗺️','城市总览','漏斗与卡点'],open:['🔑','账号·城市开通','对外开户'],board:['📊','数据看板','经营 KPI']};
  var c=map[opsView]||map.pool;
  return '<div class="org-block"><i class="i">'+c[0]+'</i><strong style="font-weight:650">'+c[1]+'</strong>'+
    '<span style="margin:0 10px;color:#cbd7e6">/</span><strong style="color:var(--blue-dark)">'+c[2]+'</strong></div>';
}
function opsTopbar(){
  return '<div class="topbar">'+
    '<div class="brand-block"><img src="'+brandLogo()+'"><div><strong>慧小招</strong><span>管理端 · 资源调度</span></div></div>'+
    opsCrumb()+
    '<div class="top-meta"><span><i class="i">🏙️</i>覆盖 '+OPEN_ACCOUNTS.length+' 个试点城市</span><span><i class="i">📥</i>'+DEMANDS.length+' 条在办需求</span></div>'+
  '</div>';
}
function opsSidebar(){
  // 按周总日常动线重排：主线在上(需求→匹配→对接→资源)，全局视野居中(总览/看板)，材料参考次之，账号管理沉底
  var items=[['📥','pool','需求池','各地干部提交'],['🧩','match','智能匹配','AI撮合+核验'],['🗂️','dock','对接管理','落地看板'],['🤝','res','资源库','可对接企业'],['🗺️','city','城市总览','漏斗与卡点'],['📊','board','数据看板','经营KPI'],['📂','leader','领导材料台','各地资料汇总'],['🔑','open','账号·城市开通','对外开户']];
  return '<div class="sidebar"><div class="nav-list">'+
    items.map(function(n){var on=opsView===n[1];return '<button class="nav-item'+(on?' active':'')+'" onclick="opsNav(\''+n[1]+'\')"><i class="i">'+n[0]+'</i><span class="nav-copy"><strong>'+n[2]+'</strong><small>'+n[3]+'</small></span></button>';}).join('')+
    '</div><div class="system-status"><span></span>管理端</div></div>';
}
function opsFooter(){
  var stat={matched:0,checking:0,none:0};DEMANDS.forEach(function(d){stat[d.res]++});
  return '<div class="progress-footer"><div class="progress-track">'+
    '<div class="progress-step done"><div class="progress-node"><i class="i">✓</i></div><div class="progress-copy"><strong>已匹配</strong><small>'+stat.matched+' 条可对接</small></div></div><div class="progress-line"></div>'+
    '<div class="progress-step current"><div class="progress-node">◔</div><div class="progress-copy"><strong>核验中</strong><small>'+stat.checking+' 条待核验</small></div></div><div class="progress-line"></div>'+
    '<div class="progress-step"><div class="progress-node">•</div><div class="progress-copy"><strong>暂无资源</strong><small>'+stat.none+' 条待跟踪</small></div></div>'+
    '</div><div class="progress-mobile">需求池：共 '+DEMANDS.length+' 条 · 已匹配 '+stat.matched+' / 核验中 '+stat.checking+' / 暂无 '+stat.none+'</div></div>';
}
// 需求状态 → 统一语义色
function demandBadge(res){var m={matched:'green',checking:'blue',none:'orange'};return m[res]||'gray';}
function opsMain(){
  var st={matched:0,checking:0,none:0};DEMANDS.forEach(function(d){if(st[d.res]!=null)st[d.res]++});
  var todayN=DEMANDS.filter(function(d){return /今天|刚刚/.test(d.submit)}).length;
  // AI 经营早报（对话气泡）
  var _stuckDemand=DEMANDS.find(function(d){return d.res==='none'});
  var _matchedFirst=DEMANDS.find(function(d){return d.res==='matched'});
  var brief='截至现在，需求池共 <strong>'+DEMANDS.length+'</strong> 条'+(todayN?'（今日新增 '+todayN+' 条）':'')+'：<strong>'+st.matched+'</strong> 条已匹配可安排对接，<strong>'+st.checking+'</strong> 条核验中，<strong>'+st.none+'</strong> 条暂无资源需找源。'+
    (_matchedFirst?'建议今天优先推进「'+_matchedFirst.city+' · '+_matchedFirst.topic+'」，候选线索已核验通过，等待安排实地走访；':'')+(st.none&&_stuckDemand?'「'+_stuckDemand.city+' · '+_stuckDemand.topic+'」卡在资源缺口（'+_stuckDemand.domain+'方向暂无企业），建议优先补录或走外部渠道。':'');
  var briefBubble='<div class="message"><img src="'+aiAvatar()+'"><div class="message-bubble"><p>'+brief+'</p></div></div>';
  var rows=DEMANDS.map(function(d){var on=d.id===curDemand;
    return '<div onclick="pickDemand(\''+d.id+'\')" class="ops-row'+(on?' on':'')+'" style="align-items:flex-start">'+
      '<div class="r-ic">📥</div>'+
      '<div class="r-main"><div style="display:flex;align-items:center;gap:8px"><strong>'+d.city+' · '+d.topic+'</strong><span class="ops-badge '+demandBadge(d.res)+'">'+d.resLabel+'</span></div>'+
      '<small>'+d.gov+' · 递交于 '+d.submit+' · 线索 '+(d.clues||0)+' 家</small>'+
      '<em style="display:flex;gap:5px;margin-top:4px"><span style="color:#0757ad">AI 初判</span>'+d.ai+'</em></div>'+
      '<i class="i" style="color:#c3cfdd;font-size:18px;align-self:center">›</i></div>';
  }).join('');
  return '<div class="page">'+
    '<div class="page-header"><div><span class="eyebrow">DEMAND POOL</span><h1>跨城市需求池</h1>'+
    '<p>各地招商干部经双确认后递交的正式需求，点任意一条在右侧判断资源、组织对接。</p></div></div>'+
    '<div class="conversation-scroll" style="padding:22px 28px 20px">'+
      briefBubble+
      '<div class="ops-chips" style="margin:2px 0 12px"><span class="lbl">筛选</span>'+
        '<span class="ops-badge green">已匹配 '+st.matched+'</span><span class="ops-badge blue">核验中 '+st.checking+'</span><span class="ops-badge orange">暂无资源 '+st.none+'</span></div>'+
      '<div class="ops-card"><div class="ops-card-head"><span class="t">📥 全部需求</span><span class="sub">点击查看详情 / 组织对接</span></div>'+
      '<div class="ops-card-body flush">'+rows+'</div></div>'+
    '</div></div>';
}
function opsDetail(){
  var d=DEMANDS.find(function(x){return x.id===curDemand})||DEMANDS[0];var rc=RES_COLOR[d.res];
  return '<button class="collapse-detail" onclick="toggleDetail()"><i class="i">✕</i></button>'+
    '<div class="detail-page">'+
    '<div class="detail-header"><div><span class="eyebrow">DEMAND DETAIL</span><h2>'+d.city+' · '+d.topic+'</h2><p>'+d.gov+'</p></div></div>'+
    '<div class="detail-scroll">'+
      '<div class="detail-block"><h3>递交需求</h3><p class="detail-copy">'+d.need+'</p><span class="source-note">递交于 '+d.submit+'</span></div>'+
      '<div class="detail-block"><h3>资源端判断</h3><div class="'+(d.res==='none'?'warning-callout':'info-callout')+'" style="margin-top:0"><b style="color:'+rc.c+'">'+d.resLabel+'</b> · '+d.note+'</div></div>'+
      '<div class="detail-block"><h3>候选线索</h3>'+(d.clues>0?'<ul class="source-list"><li><i class="i">🔗</i>已匹配 '+d.clues+' 家脱敏候选企业<small>资源端从企业资源库匹配并经人工核验</small></li></ul>':'<div class="fact-with-icon warning"><i class="i">⚠</i><div><strong>暂无匹配线索</strong><span>建议纳入长期跟踪或对接外部渠道</span></div></div>')+'</div>'+
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
    openModal('安排招商对接',body,'<button class="secondary-button" onclick="closeModal()">取消</button><button class="primary-button" onclick="doArrangeDock(\''+d.id+'\')">确认发起对接</button>');
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
function doArrangeDock(id){
  var d=DEMANDS.find(function(x){return x.id===id});if(!d)return;
  var contact=(d.gov.split('·')[1]||d.gov)+' / 待确认';
  var exist=DOCK_ITEMS.find(function(k){return k.city===d.city&&k.topic===d.topic});
  if(exist){exist.stage='对接中';exist.next='本周实地走访 + 政企座谈';}
  else{DOCK_ITEMS.unshift({id:'k'+Date.now(),city:d.city,topic:d.topic,company:(d.clues+' 家脱敏候选企业'),stage:'对接中',contact:contact,next:'本周实地走访 + 政企座谈'});}
  d.arranged=true;
  closeModal();render();
  toast('已发起对接，「'+d.city+' · '+d.topic+'」进入对接看板"对接中"');
}
function setRole(r){role=r;view='home';render();toast(r==='ops'?'已切换到管理端（全局）':'已切换到政府端（随州·张主任）')}
function opsLeader(){
  var cities=['all'].concat(LEADER_DOCS.map(function(d){return d.city}).filter(function(v,i,a){return a.indexOf(v)===i}));
  var chips=cities.map(function(c){var on=leaderFilter===c;
    return '<button class="ghost-button" style="min-height:30px;padding:5px 12px;'+(on?'background:#ebf3fd;color:#013582;border-color:#0757ad':'')+'" onclick="setLeaderFilter(\''+c+'\')">'+(c==='all'?'全部':c)+'</button>';
  }).join('');
  var list=LEADER_DOCS.map(function(d,i){return {d:d,i:i}}).filter(function(o){return leaderFilter==='all'||o.d.city===leaderFilter});
  var rows=list.map(function(o){var d=o.d;
    return '<button onclick="leaderAct('+o.i+')" style="width:100%;display:flex;align-items:center;gap:14px;padding:14px 18px;border:1px solid var(--line);border-radius:10px;background:#fff;cursor:pointer;text-align:left">'+
      '<i class="i" style="font-size:22px;flex:0 0 auto">📄</i>'+
      '<span style="flex:1;min-width:0;display:grid;gap:3px"><strong style="font-size:14.5px">'+d.name+'</strong>'+
      '<small style="color:var(--muted);font-size:12px">'+d.city+' · '+d.who+' · '+d.type+' · '+d.time+'</small>'+
      '<em style="color:#52627a;font-size:11px;font-style:normal">'+d.sum+'</em></span>'+
      '<span class="status-tag" style="flex:0 0 auto;color:#013582;background:#ebf3fd">'+d.topic+'</span></button>';
  }).join('')||'<div style="padding:20px;text-align:center;color:#9aa5b5;font-size:12.5px">该城市暂无材料</div>';
  return '<div class="page"><div class="page-header"><div><span class="eyebrow">LEADER MATERIALS</span><h1>领导材料台</h1>'+
    '<p>各地领导/干部在「资料准备」阶段上传的材料汇总。</p></div></div>'+
    '<div class="knowledge-scroll"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"><span style="font-size:12px;color:#8490a5;align-self:center;margin-right:2px">按城市筛选：</span>'+chips+'</div>'+
    '<div class="prompt-list" style="margin-left:0;width:100%">'+rows+'</div>'+
    '<div class="boundary-note"><i class="i">🔒</i>材料仅运营高层可见；系统只做汇总与解析，出谋划策由老板决策。</div></div></div>';
}
function setLeaderFilter(c){leaderFilter=c;render()}
function leaderAct(i){var d=LEADER_DOCS[i];
  var body='<p class="modal-intro">'+d.city+' · '+d.who+' 上传的《'+d.name+'》（'+d.type+'）</p>'+
    '<div class="detail-block" style="padding-top:0"><h3>AI 已解析摘要</h3><p class="detail-copy">'+d.sum+'</p></div>'+
    '<div class="detail-block"><h3>关联研判课题</h3><p class="detail-copy">'+d.topic+'</p></div>'+
    '<div class="info-callout" style="margin-top:8px">点「一键出谋划策」将基于该材料生成招商建议草稿，可编辑后下发给 '+d.who+'。</div>';
  openModal('材料详情 · '+d.city,body,'<button class="secondary-button" onclick="closeModal()">关闭</button><button class="primary-button" onclick="leaderAdvise('+i+')"><i class="i">✨</i>一键出谋划策</button>');
}
function leaderAdvise(i){var d=LEADER_DOCS[i];
  var _lt=d.topic||'';
  var _lbg=_lt.indexOf('氢能')>-1?'随州新楚风49T氢重卡已量产，电堆占整车成本53%全部外购，本地配套率仅41%（十堰75%+）':_lt.indexOf('应急')>-1?'随州移动应急装备2023产值324亿，应急机器人/无人机本体靠外采（启灵/迅北斗），智慧感知层空白':'随州香菇全产业链产值超500亿，品源4亿美元出口订单，菌种国外垄断、功能成分提取仅2家布局';
  var _lpk=_lt.indexOf('氢能')>-1?'专汽产业园/随州高新区':_lt.indexOf('应急')>-1?'曾都区国家安全应急产业示范基地':'随县香菇产业园';
  var draft='基于《'+d.name+'》（'+d.type+'）与随州城市智库，就「'+d.topic+'」建议：\n'+
    '① 产业背景：'+_lbg+'。\n'+
    '② 缺口研判：'+d.sum+'\n'+
    '③ 招引重点：优先补「'+_lt+'」最缺的核心环节（'+_lpk+'方向），匹配具异地设厂意向的龙头。\n'+
    '④ 承接准备：请'+d.who+'确认首选承接园区（'+_lpk+'）与专项资金口径，便于对接时报价。\n'+
    '⑤ 下一步：完善后作为研判输入下发给'+d.who+'，纳入其「资料准备」。';
  var body='<p class="modal-intro">基于《'+d.name+'》生成的招商建议草稿（可编辑后下发给 '+d.who+'）：</p>'+
    '<div class="form-stack"><label>招商建议草稿<textarea id="adviseTa" rows="9" style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:9px;font-size:13px;line-height:1.7;resize:vertical">'+draft+'</textarea></label></div>'+
    '<div class="answer-note">⚠ AI 生成草稿，需人工确认后再下发；出谋划策的决策权在老板/运营高层。</div>';
  openModal('招商建议草稿 · '+d.city+' · '+d.topic,body,'<button class="secondary-button" onclick="closeModal()">取消</button><button class="primary-button" onclick="closeModal();toast(\'已下发招商建议给 '+d.who+'\')"><i class="i">📤</i>确认下发 '+d.who+'</button>');
}
function opsRes(){
  var head='<div class="page"><div class="page-header"><div><span class="eyebrow">RESOURCE BASE</span><h1>资源库</h1>'+
    '<p>可对接企业 / 资本 / 园区档案库。</p></div>'+
    '<button class="ghost-button" onclick="resAdd()"><i class="i">➕</i>录入企业</button></div>';
  if(RESOURCES.length===0){
    return head+'<div class="knowledge-scroll"><div class="empty-page"><div class="empty-state">'+
      '<i class="i">🗄️</i><h1>资源库</h1>'+

      '<div class="topic-grid" style="margin:0;width:100%;grid-template-columns:1fr">'+
        '<button class="topic-row" onclick="resAdd()"><i class="i">✍️</i><span><strong>手动录入企业</strong><small>一家一家建档，打产业链标签</small></span></button>'+
        '<button class="topic-row" onclick="resImport()"><i class="i">📥</i><span><strong>批量导入名录</strong><small>Excel/CSV 一次导入行业名录</small></span></button>'+
        '<button class="topic-row" onclick="resChannel()"><i class="i">🔗</i><span><strong>对接外部渠道</strong><small>招商平台 / 行业协会 / 园区名录</small></span></button>'+
      '</div>'+
      '<div class="warning-callout" style="margin-top:18px;text-align:left"><strong>待补资源清单（由需求反推）</strong><p>燃料电池电堆（随州电堆外购占整车成本53%）/ 应急机器人与无人机（江南专汽/齐星依赖外采）/ 香菇功能成分提取（仅裕国/肽源2家布局）等缺口暂无资源，建议优先补录这三类企业。</p></div>'+
    '</div></div></div>';
  }
  var rows=RESOURCES.map(function(r,i){
    var vtag=r.verify==='ok'?'<span class="ops-badge green">已核验</span>':r.verify==='rej'?'<span class="ops-badge orange">已驳回</span>':'<span class="ops-badge gray">待核验</span>';
    return '<tr class="row-click" onclick="resView('+i+')"><td><strong>'+r.alias+'</strong></td><td>'+r.tag+'</td><td>'+r.loc+'</td><td>'+r.intent+'</td><td>'+vtag+'</td></tr>';
  }).join('');
  var domains=RESOURCES.map(function(r){return r.domain}).filter(function(v,i,a){return a.indexOf(v)===i});
  var lead='资源库现有 <strong>'+RESOURCES.length+'</strong> 家可对接企业，覆盖 '+domains.join(' / ')+'。'+(DEMANDS.filter(function(d){return d.res==='none';}).length?'「'+DEMANDS.filter(function(d){return d.res==='none';}).map(function(d){return d.domain;}).join('、')+'」方向仍是缺口，对应随州在办需求，建议优先补录以激活匹配。':'当前在办需求均已有候选资源，可进入核验流程。');
  var leadBubble='<div class="message"><img src="'+aiAvatar()+'"><div class="message-bubble"><p>'+lead+'</p></div></div>';
  return head+'<div class="conversation-scroll" style="padding:22px 28px 20px">'+leadBubble+
    '<div class="ops-card"><div class="ops-card-head"><span class="t">🏢 可对接企业库</span><span class="sub">共 '+RESOURCES.length+' 家 · 点行看档案</span></div>'+
    '<div class="ops-card-body flush"><table class="ops-table"><thead><tr><th>脱敏名</th><th>产业链标签</th><th>所在地</th><th>意向</th><th>核验状态</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>'+
    '<div style="margin-top:14px;display:flex;gap:10px"><button class="ghost-button" onclick="resImport()"><i class="i">📥</i>批量导入名录</button><button class="ghost-button" onclick="resChannel()"><i class="i">🔗</i>对接外部渠道</button></div></div></div>';
}
function resView(i){var r=RESOURCES[i];if(!r)return;
  var body='<div class="detail-block" style="padding-top:0"><h3>脱敏名（对政府端展示）</h3><p class="detail-copy">'+r.alias+'</p></div>'+
    '<div class="detail-block"><h3>企业真名（内部可见）</h3><p class="detail-copy">'+(r.real||'（内部可见真名）')+'</p></div>'+
    '<div class="kv"><span class="kk" style="width:90px;color:#8490a5">产业链标签</span><span class="vv">'+r.tag+'</span></div>'+
    '<div class="kv"><span class="kk" style="width:90px;color:#8490a5">所在地/意向</span><span class="vv">'+r.loc+' · '+r.intent+'</span></div>'+
    '<div class="kv"><span class="kk" style="width:90px;color:#8490a5">核验状态</span><span class="vv">'+(r.verify==='ok'?'✓ 已核验通过':r.verify==='rej'?'已驳回（'+(r.rejReason||'')+'）':'待核验')+'</span></div>'+
    '<div class="boundary-note" style="margin-top:12px"><i class="i">🔒</i>真名仅内部可见；派生到政府端时只展示脱敏名。</div>';
  openModal('企业档案 · '+r.alias,body,'<button class="primary-button" onclick="closeModal()">知道了</button>');
}
function resImport(){
  var body='<p class="modal-intro">从 Excel / CSV 批量导入行业名录，导入后自动打产业链标签、生成脱敏名。</p>'+
    '<div class="form-stack"><label>选择文件<input value="行业名录_示例.xlsx" readonly></label>'+
    '<label>默认产业链标签<input placeholder="如：氢能装备（可导入后逐条修正）"></label></div>'+
    '<div class="info-callout" style="margin-top:8px">Demo 演示：确认后将载入 '+RES_SEED.length+' 家示例企业入库。真实环境按表头字段映射批量建档。</div>';
  openModal('批量导入名录',body,'<button class="secondary-button" onclick="closeModal()">取消</button><button class="primary-button" onclick="resSeed()"><i class="i">📥</i>确认导入</button>');
}
function resChannel(){
  var body='<p class="modal-intro">当资源库无匹配时，从外部渠道找源，回流后入库。</p>'+
    '<div class="prompt-list" style="margin-left:0;width:100%">'+
      '<div class="topic-row" style="cursor:default"><i class="i">🏛️</i><span><strong>行业协会 / 龙头供应链名录</strong><small>向协会/链主索取上下游名单</small></span></div>'+
      '<div class="topic-row" style="cursor:default"><i class="i">💰</i><span><strong>产业基金 / 投行项目库</strong><small>从在投项目筛异地扩产标的</small></span></div>'+
      '<div class="topic-row" style="cursor:default"><i class="i">🤝</i><span><strong>异地商会 / 开发区互推</strong><small>与兄弟园区招商局交换线索</small></span></div>'+
    '</div>'+
    '<div class="boundary-note" style="margin-top:10px"><i class="i">🔒</i>渠道对接由资源团队线下推进；系统只登记来源与回流线索。</div>';
  openModal('对接外部渠道',body,'<button class="primary-button" onclick="closeModal()">知道了</button>');
}
function resAdd(){
  var body='<p class="modal-intro">新增可对接主体，真名仅内部可见，政府端只见脱敏名。</p>'+
    '<div class="form-stack"><label>脱敏名（对政府端展示）<input placeholder="如：华南某燃料电池电堆企业"></label>'+
    '<label>企业真名（内部）<input placeholder="内部可见"></label>'+
    '<label>产业链标签<input placeholder="如：燃料电池电堆"></label>'+
    '<label>所在地 / 设厂意向<input placeholder="如：华南 · 有异地设厂意向"></label></div>';
  openModal('录入企业',body,'<button class="secondary-button" onclick="closeModal()">取消</button><button class="primary-button" onclick="resSeed()">保存并入库</button>');
}
function resSeed(){RESOURCES=RES_SEED.slice();closeModal();toast('已入库随州种子企业 '+RESOURCES.length+' 家（电堆/无人机/香菇提取各1家），可去智能匹配');render()}
function matchDemand(){
  // 默认取第一条"非暂无资源"的需求；用户可切换
  if(matchDemandId){var f=DEMANDS.find(function(x){return x.id===matchDemandId});if(f)return f;}
  return DEMANDS.find(function(x){return x.res!=='none'})||DEMANDS[0];
}
function setMatchDemand(id){matchDemandId=id;render()}
function opsMatch(){
  var d=matchDemand();
  var head='<div class="page"><div class="page-header"><div><span class="eyebrow">AI MATCHING</span><h1>智能匹配</h1>'+
    '<p>为随州招商需求匹配资源库企业：三大核心缺口——①燃料电池电堆（整车成本53%全部外购）②应急机器人/无人机（靠外采启灵/迅北斗）③香菇功能成分提取（仅裕国/肽源2家）。AI给建议，你线下核实后记录结论。</p></div></div>';
  // 需求切换器（统一 chips）
  var picker='<div class="ops-chips"><span class="lbl">针对需求</span>'+
    DEMANDS.map(function(x){var on=x.id===d.id;var rc=RES_COLOR[x.res];
      return '<button class="ops-chip'+(on?' on':'')+'" onclick="setMatchDemand(\''+x.id+'\')"><span class="dot" style="background:'+rc.c+'"></span>'+x.city+' · '+x.topic.replace('补链','').replace('升级','').replace('智能化','')+'</button>';
    }).join('')+'</div>';
  // 候选企业：仅展示与该需求 domain 匹配的资源
  var pool=RESOURCES.map(function(r,gi){return {r:r,gi:gi}}).filter(function(o){return o.r.domain===d.domain;});
  var okCnt=pool.filter(function(o){return o.r.verify==='ok'}).length;
  // AI 匹配分析引导语（对话气泡，随需求与库存状态动态生成）
  var lead;
  if(RESOURCES.length===0){
    var _bg0=d.domain.indexOf('电堆')>-1?'该环节是随州氢能整车成本最大缺口（占53%），新楚风/程力急需本地配套':d.domain.indexOf('无人机')>-1||d.domain.indexOf('机器人')>-1?'随州江南专汽/齐星整机能力强但感知层全靠外采，是智慧应急补链最大突破口':'随州香菇年产70万吨全球第一，功能成分提取仅2家，是向价值链上移的核心瓶颈';
    lead='已锁定「'+d.city+' · '+d.topic+'」缺口：「'+d.domain+'」（'+_bg0+'）。资源库目前是空的——建议先补录该方向 2-3 家种子企业（可在右侧资源库冷启动），有内容后立即可以开始匹配。';
  }else if(pool.length===0){
    var _bg1=d.domain.indexOf('电堆')>-1?'电堆/储氢/空压机（随州整车成本53%缺口）':d.domain.indexOf('无人机')>-1||d.domain.indexOf('机器人')>-1?'应急机器人/无人机/5G通信（随州感知层外采依赖）':'香菇多糖/多肽提取/菌种研发（随州精深加工空白）';
    lead='「'+d.city+' · '+d.topic+'」缺口「'+d.domain+'」（'+_bg1+'）。已扫描资源库现有 '+RESOURCES.length+' 家企业，暂无该方向匹配项。建议：①去资源库补录 '+d.domain+' 方向企业；②或让我规划外部找源渠道（行业协会/产业基金/展会名单）。';
  }else{
    var _bg2=d.domain.indexOf('电堆')>-1?'，补随州整车成本53%最大缺口，与新楚风/程力直接配套':d.domain.indexOf('无人机')>-1||d.domain.indexOf('机器人')>-1?'，替代随州江南专汽/齐星对外采依赖':'，就近使用随州年产70万吨香菇原料，提取成本可降40%+';
    lead='针对「'+d.city+' · '+d.topic+'」缺口「'+d.domain+'」'+_bg2+'，从资源库匹配到 <strong>'+pool.length+' 家</strong>候选企业'+(okCnt?'（其中 '+okCnt+' 家已核验通过）':'')+'。下面每家我都给了匹配理由、证据和需要你线下核实的风险点——核验属实后点「核验通过」，即派生线索并进入对接看板。';
  }
  var leadBubble='<div class="message"><img src="'+aiAvatar()+'"><div class="message-bubble"><p>'+lead+'</p></div></div>';
  // prompt-row 引导卡
  var guides='<div class="prompt-list" style="margin:0 0 6px 60px;width:auto">'+
    promptRow('🔍','分析随州这条需求的缺口','拆解随州产业链，定位最该补的核心环节（电堆/机器人/提取）',"matchAsk('帮我分析随州这条需求的缺口在哪')")+
    promptRow('🏭','该找哪类企业，企业画像是什么','按随州需求缺口给出目标企业画像与优先级',"matchAsk('针对随州这条需求该找哪类企业？')")+
    promptRow('🌐','规划随州外部找源渠道','面向三大缺口（电堆/机器人/香菇提取），从哪些渠道补源',"matchAsk('有哪些外部渠道可以为随州找源？')")+
    promptRow('✍️','生成随州定向招募话术','含随州产业基础优势的企业邀请话术草稿',"matchAsk('帮我写一段针对随州的定向招募话术')")+
  '</div>';
  var boundary='<div class="ops-hint" style="background:#fbfaf5;color:#7a6b4a"><i class="i" style="color:#c08a2a">🔒</i>AI 只给匹配建议；真实意向与关键人触达由你线下核实，「核验通过」是记录你的人工结论并推动流转，系统不自动联系企业。</div>';
  function wrap(inner){return head+'<div class="conversation-scroll" style="padding:22px 28px 8px">'+picker+leadBubble+guides+inner+matchChatPanel()+'</div></div>';}
  if(RESOURCES.length===0){
    return wrap('<div class="ops-card" style="margin:6px 0 14px"><div class="ops-card-body"><div class="fact-with-icon warning"><i class="i">⚠</i><div><strong>资源库暂无企业</strong><span>先去资源库冷启动——随州优先补录：①燃料电池电堆企业（华南/长三角，对接新楚风/程力整车需求）②应急机器人/无人机集成商（长三角，替代启灵/迅北斗外采）③香菇功能成分提取企业（华东，就近使用70万吨原料）。录入后回来匹配。</span></div></div>'+
      '<div style="margin-top:12px"><button class="ghost-button" onclick="opsNav(\'res\')"><i class="i">🗄️</i>去资源库冷启动</button></div></div></div>');
  }
  if(pool.length===0){
    return wrap('<div class="ops-card" style="margin:6px 0 14px"><div class="ops-card-body"><div class="fact-with-icon warning"><i class="i">⚠</i><div><strong>资源库暂无「'+d.domain+'」方向的匹配企业</strong><span>可去资源库补录该方向，或从外部渠道找源。</span></div></div>'+
      '<div style="margin-top:12px;display:flex;gap:8px"><button class="ghost-button" onclick="opsNav(\'res\')"><i class="i">🗄️</i>去资源库补录</button><button class="ghost-button" onclick="resChannel()"><i class="i">🔗</i>对接外部渠道</button></div></div></div>'+boundary);
  }
  var cands=pool.map(function(o){
    var r=o.r;var gi=o.gi;var score=[94,88,83][gi%3];
    var done=r.verify==='ok';var rej=r.verify==='rej';
    var badge=done?'<span class="ops-badge green">✓ 已核验通过</span>':rej?'<span class="ops-badge orange">已驳回</span>':'<span class="ops-badge blue">置信度 '+score+'%</span>';
    var actions=done
      ? '<div style="font-size:11px;color:#8490a5;margin-top:8px">已派生脱敏线索，进入对接看板「匹配中」。</div>'
      : rej
      ? '<div style="font-size:11px;color:#a85408;margin-top:8px">已驳回：'+(r.rejReason||'')+'</div>'
      : '<div style="display:flex;gap:8px;margin-top:10px"><button class="primary-button" style="min-height:36px;padding:0 14px;font-size:12.5px" onclick="opsVerify('+gi+')"><i class="i">✓</i>核验通过</button>'+
        '<button class="ghost-button" style="min-height:36px;padding:0 14px;font-size:12.5px" onclick="opsReject('+gi+')">驳回</button></div>';
    return '<div class="ops-card cand-card"><div class="ops-card-body">'+
      '<div style="display:flex;align-items:flex-start;gap:12px">'+
        '<div class="r-ic" style="flex:0 0 40px;width:40px;height:40px;font-size:20px">🏢</div>'+
        '<div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><strong style="font-size:14.5px;color:#0b183b">'+r.alias+'</strong>'+badge+'</div>'+
          '<div style="font-size:11.5px;color:#8490a5;margin-top:3px">'+r.tag+' · '+r.loc+' · '+r.intent+'</div></div>'+
      '</div>'+
      '<div style="margin-top:12px;display:grid;gap:9px">'+
        '<div class="cand-line"><span class="cl-k">🏭 企业画像</span><span class="cl-v">'+r.profile+'</span></div>'+
        '<div class="cand-line"><span class="cl-k">🎯 匹配理由</span><span class="cl-v">'+r.why+'</span></div>'+
        '<div class="cand-line"><span class="cl-k">⚠ 需核实</span><span class="cl-v" style="color:#a85408">'+r.risk+'</span></div>'+
        '<div class="cand-line"><span class="cl-k">📎 证据</span><span class="cl-v">产业链图谱缺口分析 + 该企业公开扩产信息 + '+d.city+'城市智库</span></div>'+
      '</div>'+actions+'</div></div>';
  }).join('');
  var cardHead='<div class="ops-hint" style="margin-top:6px"><i class="i">🧩</i>AI 候选企业 · 匹配 <strong style="margin:0 3px">'+pool.length+'</strong> 家（缺口方向「'+d.domain+'」）<span class="grow"></span></div>';
  return wrap(cardHead+boundary+'<div class="ops-stack" style="margin-top:12px">'+cands+'</div>');
}
function opsVerify(i){
  var r=RESOURCES[i];if(!r)return;
  var d=matchDemand();
  var body='<p class="modal-intro">确认你已<strong>线下核实</strong>「'+r.alias+'」对「'+d.city+' · '+d.topic+'」的真实意向与可触达性？</p>'+
    '<div class="kv"><span class="kk" style="width:74px;color:#8490a5">候选企业</span><span class="vv">'+r.alias+'（'+r.tag+'·'+r.loc+'）</span></div>'+
    '<div class="kv"><span class="kk" style="width:74px;color:#8490a5">对应需求</span><span class="vv">'+d.city+' · '+d.topic+'</span></div>'+
    '<div class="info-callout" style="margin-top:10px">通过后：① 该企业以脱敏名派生为候选线索 ② 自动进入「对接管理」看板"匹配中" ③ 回写需求状态并通知该城市干部。系统仅记录你的人工结论，不代替核实、不自动联系企业。</div>';
  openModal('记录核验结论 · '+r.alias,body,'<button class="secondary-button" onclick="closeModal()">取消</button><button class="primary-button" onclick="doVerify('+i+')"><i class="i">✓</i>确认已核实·通过</button>');
}
function doVerify(i){
  var r=RESOURCES[i];if(!r)return;
  var d=matchDemand();
  r.verify='ok';
  d.res='matched';d.resLabel='已匹配';d.clues=(d.clues||0)+1;
  d.note='「'+r.alias+'」经人工核验通过，已进入对接流程。';
  // 进对接看板"匹配中"（去重）
  if(!DOCK_ITEMS.some(function(k){return k.company===r.alias&&k.topic===d.topic})){
    DOCK_ITEMS.unshift({id:'k'+Date.now(),city:d.city,topic:d.topic,company:r.alias,stage:'匹配中',contact:d.gov.split('·')[1]||d.gov+' / 待确认',next:'核验决策层触达，安排走访'});
  }
  // 漏斗 match+1
  var f=CITY_FUNNEL.find(function(x){return x.city===d.city});if(f)f.match++;
  // 【回传政府端】给对应城市干部推一条通知（黄金演示动线第4步）
  var pk=projKeyByCityTopic(d.city,d.topic);
  NOTIFS.unshift({id:'n'+Date.now(),type:'状态变化',icon:'🔵',proj:pk,title:d.topic+' · 资源端已反馈',desc:'资源端核验通过 1 家脱敏候选企业（'+r.alias+'），已进入对接流程，建议准备承接材料。',time:'刚刚',read:false});
  closeModal();render();
  toast('已记录核验结论：'+r.alias+' 通过，进入对接看板，并已通知政府端');
}
/* 按城市+课题反查政府端项目key（用于回传通知定位） */
function projKeyByCityTopic(city,topic){
  var hit=Object.keys(PROJECTS).find(function(k){return PROJECTS[k].city===city&&PROJECTS[k].topic===topic});
  return hit||null;
}
function opsReject(i){
  var r=RESOURCES[i];if(!r)return;
  var body='<p class="modal-intro">驳回候选「'+r.alias+'」，请记录驳回理由（供复盘）：</p>'+
    '<div class="form-stack"><label>驳回理由<input id="rejReason" placeholder="如：产能不符 / 无异地设厂意向 / 关键人无法触达"></label></div>';
  openModal('驳回候选 · '+r.alias,body,'<button class="secondary-button" onclick="closeModal()">取消</button><button class="primary-button" onclick="doReject('+i+')">确认驳回</button>');
}
function doReject(i){
  var r=RESOURCES[i];if(!r)return;
  var reason=(document.querySelector('#rejReason')||{}).value||'未填写理由';
  r.verify='rej';r.rejReason=reason;
  closeModal();render();
  toast('已驳回并记录理由：'+reason);
}
function matchChatPanel(){
  var logo=brandLogo();
  // 只有用户真正问过（>1条）才显示对话流，避免与顶部引导卡重复出现欢迎语
  var conv=MATCH_CHAT.filter(function(m,i){return !(i===0&&m.who==='ai')});
  var msgs=conv.map(function(m){
    if(m.who==='user'){return '<div class="message is-user"><div class="message-bubble"><p>'+m.text+'</p></div></div>';}
    return '<div class="message"><img src="'+logo+'"><div class="message-bubble"><p>'+m.text+'</p></div></div>';
  }).join('');
  return '<div class="ops-card" style="overflow:hidden">'+
    '<div class="ops-card-head"><span class="t">💬 追问 AI 匹配助手</span><span class="sub">基于当前需求与产业图谱</span></div>'+
    (msgs?'<div id="matchChatLog" style="max-height:280px;overflow:auto;padding:16px 16px 4px">'+msgs+'</div>':'')+
    '<div style="display:flex;gap:10px;align-items:flex-end;padding:12px 16px;border-top:1px solid var(--line-soft);background:#fafbfd">'+
      '<textarea id="matchChatInput" placeholder="继续问：换个方向找源 / 写招募话术 / 这家企业风险点…（Enter 发送）" rows="1" style="flex:1;min-height:42px;max-height:120px;padding:10px 12px;border:1px solid var(--line);border-radius:9px;outline:0;resize:none;font-size:14px;line-height:22px" onkeydown="matchChatKey(event)"></textarea>'+
      '<button class="send-button" style="position:static;width:46px;height:46px;flex:0 0 46px" onclick="matchSend()"><i class="i">➤</i></button></div></div>';
}
function matchAsk(q){var t=$('#matchChatInput'); if(t){t.value=q;} matchSend();}
function matchChatKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();matchSend();}}
function matchReply(q){
  var d=matchDemand();
  if(/渠道|找源|哪里找/.test(q)){
    var domainTip=d.domain||d.topic.replace('补链','').replace('升级','').replace('智能化','');
    return '针对「'+d.city+' · '+d.topic+'」（核心缺口：'+domainTip+'），建议外部找源渠道：① 全国「'+domainTip+'」行业协会/龙头供应链名录；② 产业基金/PE项目库（筛选有异地扩产意向的标的）；③ 与十堰/长三角/华南同类产业园开发区互推名单；④ 专利/招投标/展会公开信息监测（'+domainTip+'关键词）。确认方向后可一键生成定向招募话术。';
  }
  if(/话术|招募|文案/.test(q)){
    var _szzBase=d.topic.indexOf('氢能')>-1?'年产16万辆专用汽车整车与改装能力，新楚风49T氢重卡已量产':d.topic.indexOf('应急')>-1?'移动应急装备2023产值324亿，曾都区国家安全应急产业示范基地':'全产业链产值超500亿，区域品牌价值205.8亿连续3年全国第一';
    return '定向招募话术草稿：「随州正围绕「'+d.topic+'」补强核心产业链（'+d.domain+'方向），诚邀相关领域龙头企业深度合作。随州具备：'+_szzBase+'；完善的配套政策与一事一议机制。有意向者请对接招商专班。」可直接投放至行业协会/展会/定向拜访渠道。';
  }
  if(/缺口|缺什么|哪个环节/.test(q)){
    var _res=RESOURCES.filter(function(r){return r.domain===d.domain});
    return '「'+d.city+' · '+d.topic+'」产业链核心缺口在「'+d.domain+'」方向。'+(d.need||'')+      '当前资源库'+(_res.length?'已有 '+_res.length+' 家该方向候选企业，可直接进入匹配核验流程':'该方向企业尚空，建议先补录或走外部渠道找源')+'。';
  }
  return '针对「'+d.city+' · '+d.topic+'」，核心缺口方向为「'+d.domain+'」。AI建议优先匹配：具备落地意向、产业链位置直接补这一缺口的企业。当前资源库'+(RESOURCES.length===0?'尚空，建议先去资源库录入或从外部渠道找源':'共 '+RESOURCES.length+' 家候选，可逐条核验后派生线索')+'。';
}
function matchSend(){
  var t=$('#matchChatInput'); if(!t) return; var q=(t.value||'').trim(); if(!q) return;
  MATCH_CHAT.push({who:'user',text:q});
  MATCH_CHAT.push({who:'ai',text:matchReply(q)});
  render();
  setTimeout(function(){var log=$('#matchChatLog'); if(log){log.scrollTop=log.scrollHeight;}},30);
}
function opsDock(){
  var cols=[['匹配中','#013582','blue'],['对接中','#006d70','green'],['已对接','#5e6d82','gray'],['签约','#c85b09','orange']];
  function card(k){
    var alert=k.alert?'<div style="margin-top:7px;display:flex;gap:6px;font-size:11px;color:#a85408;background:#fdf0e0;border-radius:6px;padding:5px 8px;line-height:1.5"><span>🔔</span><span>'+k.alert+'</span></div>':'';
    return '<div class="kanban-card"><strong>'+k.city+' · '+k.topic.replace('补链','').replace('升级','').replace('智能化','')+'</strong>'+
    '<div class="kc-sub">🏢 '+k.company+'</div>'+
    (k.contact?'<div class="kc-sub">👤 '+k.contact+'</div>':'')+
    '<div class="kc-next">下一步：'+k.next+'</div>'+alert+
    (k.stage!=='签约'?'<div style="margin-top:8px;text-align:right"><button class="ghost-button" style="min-height:28px;padding:3px 10px;font-size:11px" onclick="dockAdvance(\''+k.id+'\')">推进 ›</button></div>':'')+
    '</div>';}
  var board=cols.map(function(c){
    var list=DOCK_ITEMS.filter(function(k){return k.stage===c[0]});
    var items=list.map(card).join('')||'<div style="color:#9aa7bb;font-size:12px;padding:10px 2px">—</div>';
    return '<div class="kanban-col"><div class="col-head"><span class="ops-badge '+c[2]+'">'+c[0]+'</span><span class="cnt">'+list.length+'</span></div>'+items+'</div>';
  }).join('');
  // AI 对接调度引导语
  var alertN=DOCK_ITEMS.filter(function(k){return k.alert}).length;
  var docking=DOCK_ITEMS.filter(function(k){return k.stage!=='签约'}).length;
  var lead='对接看板共 <strong>'+DOCK_ITEMS.length+'</strong> 个项目在推进'+(alertN?'，其中 <strong>'+alertN+'</strong> 个需要你关注（超时未更新）':'')+'。核验通过的项目会自动进「匹配中」，你线下推进后逐列往右推。'+(alertN?'建议先处理带🔔提醒的项目。':'');
  var leadBubble='<div class="message"><img src="'+aiAvatar()+'"><div class="message-bubble"><p>'+lead+'</p></div></div>';
  return '<div class="page"><div class="page-header"><div><span class="eyebrow">DOCKING BOARD</span><h1>对接管理</h1><p>核验通过后的落地看板，可推进状态；结果回写漏斗与看板。</p></div></div>'+
    '<div class="docking-scroll" style="padding:22px 28px 20px">'+leadBubble+
    '<div class="ops-card" style="margin-bottom:12px"><div class="ops-card-head"><span class="t">🗂️ 对接落地看板</span><span class="sub">匹配中 → 对接中 → 已对接 → 签约</span></div><div class="ops-card-body"><div class="kanban">'+board+'</div></div></div>'+
    '<div class="ops-hint" style="background:#f7f8fa;color:#8490a5"><i class="i" style="color:#8490a5">🔒</i>看板状态流转会记录操作人 + 时间 + 理由，进入审计日志。</div></div></div>';
}
function dockAdvance(id){
  var k=DOCK_ITEMS.find(function(x){return x.id===id});if(!k)return;
  var flow=['匹配中','对接中','已对接','签约'];
  var ni=flow.indexOf(k.stage)+1;if(ni>=flow.length){toast('已是签约状态');return;}
  var nextStage=flow[ni];
  var nextTip={'对接中':'实地走访 + 政企座谈','已对接':'推进落地条件磋商','签约':'签约落地，纳入统计'}[nextStage]||'';
  k.stage=nextStage;k.next=nextTip;
  render();
  toast('已推进「'+k.city+' · '+k.topic+'」→ '+nextStage);
}
function opsCity(){
  var cards=CITY_FUNNEL.map(function(c){
    var steps=[['提交',c.submit],['确认',c.confirm],['匹配',c.match],['对接',c.dock],['签约',c.sign]];
    var stuckIdx=-1;
    var bars=steps.map(function(s,i){var stuck=(i>0&&steps[i-1][1]-s[1]>=2);if(stuck&&stuckIdx<0)stuckIdx=i;
      return '<div class="fn-step"><div class="fn-v'+(stuck?' stuck':'')+'">'+s[1]+'</div><div class="fn-l">'+s[0]+'</div></div>';
    }).join('<div class="fn-arrow">›</div>');
    var conv=c.submit?Math.round(c.match/c.submit*100):0;var stuck=conv<50;
    var diag=stuck?'<div style="margin-top:10px;display:flex;gap:7px;font-size:11.5px;color:#a85408;background:#fdf0e0;border-radius:7px;padding:8px 10px;line-height:1.6"><span>🔎</span><span>AI 卡点诊断：随州「'+(c.city.indexOf('·')>-1?c.city.split('·')[1]:c.city)+'」卡在'+(steps[stuckIdx]?steps[stuckIdx][0]:'匹配')+'环节。根因：资源库该方向暂无企业（燃料电池电堆/应急机器人/香菇提取三类最缺），建议优先补录或走行业协会/基金项目库外部渠道。</span></div>':'<div style="margin-top:10px;display:flex;gap:7px;font-size:11.5px;color:#046d5b;background:#e3f6f0;border-radius:7px;padding:8px 10px"><span>✓</span><span>AI 诊断：转化顺畅，无明显卡点。</span></div>';
    return '<div class="ops-card" style="margin-bottom:12px"><div class="ops-card-head"><span class="t">🗺️ '+c.city+'</span><span class="ops-badge '+(stuck?'orange':'green')+'" style="margin-left:auto">匹配转化 '+conv+'%</span></div><div class="ops-card-body"><div class="funnel">'+bars+'</div>'+diag+'</div></div>';
  }).join('');
  var _stuckFunnel=CITY_FUNNEL.filter(function(c){return c.submit&&c.match/c.submit<0.5});
  var lead='当前跟踪随州 '+CITY_FUNNEL.length+' 个产业方向招商漏斗。'+(CITY_FUNNEL.length>0?'各方向从需求提交到匹配转化情况如下——':'')+(_stuckFunnel.length?'带橙色的「'+_stuckFunnel.map(function(c){return c.city;}).join('、')+'」方向存在卡点，根因多为资源库该方向企业不足，建议优先补源。':'各方向转化尚顺畅，可推进核验中需求的进度。');
  var leadBubble='<div class="message"><img src="'+aiAvatar()+'"><div class="message-bubble"><p>'+lead+'</p></div></div>';
  return '<div class="page"><div class="page-header"><div><span class="eyebrow">CITY OVERVIEW</span><h1>城市总览</h1><p>各试点城市漏斗、转化率与卡点（红色=停滞环节）。</p></div></div>'+
    '<div class="conversation-scroll" style="padding:22px 28px 20px">'+leadBubble+cards+'</div></div>';
}
function opsOpen(){
  var rows=OPEN_ACCOUNTS.map(function(a){
    var _aSpec=a.org.indexOf('氢能')>-1?'氢能专用车产业补链':a.org.indexOf('农业')>-1?'香菇深加工补链':'智慧应急装备补链';
    return '<tr><td><strong>'+a.city+'</strong></td><td>'+a.org+'<br><small style="color:#9aa5b5">'+_aSpec+'</small></td><td>'+a.who+' · '+a.role+'</td><td>'+a.crawl+'</td><td><span class="status-tag" style="color:#006d70;background:#e4f5f3">'+a.status+'</span></td></tr>';
  }).join('');
  return '<div class="page"><div class="page-header"><div><span class="eyebrow">ACCOUNT & CITY</span><h1>账号 · 城市开通</h1><p>为新城市注册、绑定政府端账号，并触发每日 0 点数据抓取。</p></div>'+
    '<button class="ghost-button" onclick="openCity()"><i class="i">🔑</i>开通新城市</button></div>'+
    '<div class="settings-scroll"><div class="ops-card" style="padding:14px 16px"><div class="ops-sec-title">🏙️ 已开通城市账号<span class="sub">共 '+OPEN_ACCOUNTS.length+' 个</span></div>'+
    '<table class="ops-table"><thead><tr><th>城市</th><th>招商单位</th><th>联系人/角色</th><th>数据抓取</th><th>状态</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div class="ops-card" style="padding:16px;margin-top:12px"><div class="ops-sec-title">⚙️ 开通即自动化</div>'+
    '<div class="toggle-row"><span><strong>每日 0 点数据抓取</strong><small>产业链/政策/行业公开信息，为 AI 研判备料</small></span><input type="checkbox" checked></div>'+
    '<div class="toggle-row"><span><strong>生成登录邀请链接</strong><small>发送给对应干部/领导</small></span><input type="checkbox" checked></div></div></div></div>';
}
function doOpenCity(){
  var ins=document.querySelectorAll('#modalLayer input');
  var city=(ins[0]&&ins[0].value.trim())||'新城市';
  var org=(ins[1]&&ins[1].value.trim())||(city+'市招商局');
  var who=(ins[2]&&ins[2].value.trim())||'待绑定';
  OPEN_ACCOUNTS.push({city:city,org:org,who:who,role:'干部',status:'已开通',crawl:'每日00:00 运行中'});
  closeModal();render();
  toast('已开通「'+city+'」并触发首轮 0 点抓取');
}
function opsBoard(){
  var st={matched:0,checking:0,none:0};DEMANDS.forEach(function(d){st[d.res]++});
  var total=DEMANDS.length;
  var reachable=st.matched+st.checking;  // 匹配率口径：可推进/总数（暂无资源不计入分子）
  var matchRate=total?Math.round(st.matched/total*100):0;
  var cities=OPEN_ACCOUNTS.length;  // 覆盖城市数由已开通账号动态取
  var signed=DOCK_ITEMS.filter(function(k){return k.stage==='签约'}).length;
  var docking=DOCK_ITEMS.filter(function(k){return k.stage==='对接中'||k.stage==='已对接'}).length;
  function tile(v,l,sub,cls){return '<div class="kpi-tile '+(cls||'')+'"><div class="kpi-label">'+l+'</div><div class="kpi-value">'+v+'</div>'+(sub?'<div class="kpi-sub">'+sub+'</div>':'')+'</div>';}
  var tiles='<div class="kpi-grid">'+
    tile(total,'📥 在办需求','跨 '+cities+' 城','accent')+
    tile(matchRate+'%','🎯 匹配率','已匹配/总需求','teal')+
    tile(st.matched,'✅ 已匹配','可安排对接')+
    tile(docking,'🤝 对接推进中','走访/座谈')+
    tile(st.checking,'🔍 核验中','待资源反馈','orange')+
    tile(st.none,'📭 暂无资源','待找源')+
  '</div>';
  // 各城市转化明细表
  var rows=CITY_FUNNEL.map(function(c){var conv=c.submit?Math.round(c.match/c.submit*100):0;
    var stuck=conv<50;
    return '<tr><td><strong>'+c.city+'</strong></td><td>'+c.submit+'</td><td>'+c.confirm+'</td><td>'+c.match+'</td><td>'+c.dock+'</td><td>'+c.sign+'</td>'+
      '<td><span class="status-tag" style="color:'+(stuck?'#c85b09':'#006d70')+';background:'+(stuck?'#fff0de':'#e4f5f3')+'">'+conv+'%</span></td></tr>';
  }).join('');
  var table='<div class="ops-card"><div class="ops-card-head"><span class="t">📊 各城市转化明细</span><span class="sub">红色转化率 = 存在卡点</span></div>'+
    '<div class="ops-card-body flush"><table class="ops-table"><thead><tr><th>城市</th><th>提交</th><th>确认</th><th>匹配</th><th>对接</th><th>签约</th><th>匹配转化</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
  // AI 经营洞察（对话气泡分析口吻）
  var topCity=CITY_FUNNEL.slice().sort(function(a,b){return (b.submit?b.match/b.submit:0)-(a.submit?a.match/a.submit:0)})[0];
  var stuckCity=CITY_FUNNEL.filter(function(c){return c.submit&&c.match/c.submit<0.5})[0];
  var _topName=topCity?topCity.city.replace('随州·','随州（')+(topCity.city.indexOf('·')>-1?'方向）':''):'—';
  var _stuckName=stuckCity?stuckCity.city.replace('随州·','随州（')+(stuckCity.city.indexOf('·')>-1?'方向）':''):null;
  var insight='本周经营面看三点：① 转化最快的是 <strong>'+_topName+'</strong>，需求到匹配跑得最顺；'+
    (_stuckName?'② <strong>'+_stuckName+'</strong> 卡在匹配环节，根因是资源库没有「'+(stuckCity.city.split('·')[1]||stuckCity.city)+'」方向企业——这是当前最大瓶颈，建议本周优先补录该方向；':'② 各方向转化尚均衡；')+
    '③ 全局匹配率 '+matchRate+'%，'+(st.none?st.none+' 条需求（'+DEMANDS.filter(function(d){return d.res==='none';}).map(function(d){return d.topic;}).join('/')+'）因暂无资源停滞，':'')+'资源库仍在冷启动。<strong>建议</strong>：本周集中补录燃料电池电堆 / 应急机器人与无人机 / 香菇功能成分提取三类企业，可直接激活 '+(st.checking+st.none)+' 条在办需求。';
  var insightBubble='<div class="message"><img src="'+aiAvatar()+'"><div class="message-bubble"><p>'+insight+'</p>'+
    '<div class="message-note">AI 基于当前需求池、资源库与漏斗数据生成；原型示意，接入真实后端后自动统计。</div></div></div>';
  return '<div class="page"><div class="page-header"><div><span class="eyebrow">DASHBOARD</span><h1>数据看板</h1><p>经营面：需求、匹配、对接、周期。</p></div></div>'+
    '<div class="report-scroll"><div class="ops-stack">'+tiles+
    '<div style="margin:2px 0"><div class="message" style="margin-bottom:0"><img src="'+aiAvatar()+'"><div class="message-bubble"><p>'+insight+'</p><div class="message-note">AI 基于当前需求池、资源库与漏斗数据生成；原型示意，接入真实后端后自动统计。</div></div></div></div>'+
    table+'</div></div></div>';
}
function roleSwitch(){
  return '';
}
/* ══ 文档正文提取：走服务端（2026-09-21）══
 * 背景：上传框 accept 第一个就是 .pdf，但页面此前只引了 mammoth(docx)，PDF 全部落到
 *   降级分支——只登记一句文件名，正文从未进入知识库，界面却照样提示「已摄取 N 个片段」。
 * 为什么不用浏览器端 pdf.js：本机实测 pdf.js 3.11 在该环境下无法完成解析——
 *   跨域 Worker 被浏览器拒绝创建（报错发生在 pdf.js 内部，getDocument 既不 resolve
 *   也不 reject），换同源 blob worker 与 disableWorker 主线程模式同样挂住不返回。
 *   卡死上传流程比不解析更糟，因此改用服务端 pdfplumber（server.py 本来就已引入）。
 * 返回 Promise<string>；解析失败/扫描件由服务端给出明确原因，前端如实展示。 */
function extractDocTextViaServer(file){
  return new Promise(function(resolve, reject){
    try{
      var fr=new FileReader();
      fr.onerror=function(){ reject(new Error('文件读取失败')); };
      fr.onload=function(ev){
        var dataUrl=String(ev.target.result||'');
        var b64=dataUrl.indexOf(',')>=0 ? dataUrl.slice(dataUrl.indexOf(',')+1) : '';
        if(!b64){ reject(new Error('文件内容为空')); return; }
        var to=setTimeout(function(){ reject(new Error('解析超时（服务端未在 60 秒内返回）')); }, 60000);
        fetch('/api/extract-text',{
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({filename:file.name, fileB64:b64})
        }).then(function(r){ return r.json(); }).then(function(j){
          clearTimeout(to);
          if(j && j.ok && String(j.text||'').trim()) resolve(String(j.text));
          else reject(new Error((j && j.error) || '未提取到文字内容'));
        }).catch(function(e){
          clearTimeout(to);
          reject(new Error('解析请求失败：'+((e&&e.message)||'网络错误')));
        });
      };
      fr.readAsDataURL(file);
    }catch(e){ reject(new Error('解析异常：'+((e&&e.message)||''))); }
  });
}

