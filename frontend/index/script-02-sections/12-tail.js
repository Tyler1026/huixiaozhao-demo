
function isClueDeleted(projKey, clue){
  var t=window.DELETED_CLUES||[];
  if(!t.length) return false;
  var isObj=(clue&&typeof clue==='object');
  var nm=isObj?clue.name:null;
  var id=isObj?clue.id:clue;
  if(_clueNameKey(nm) && t.indexOf(_clueTombKey(projKey, clue))>=0) return true;
  if(id!=null && !_isReusableClueId(id) && t.indexOf(_clueLegacyTombKey(projKey, id))>=0) return true;
  return false;
}

function renderCluesTwoPanel(projKey){
  var p = PROJECTS[projKey]; if(!p) return '';
  var all = visibleClues(p, projKey);
  if(!window.__clueGroupOpen) window.__clueGroupOpen={};
  var gkey = function(seg){ return projKey+'::'+seg; };
  // 默认展开策略：teal 与 amber 默认展开，slate 默认折叠
  var defOpen = {teal:true, amber:true, slate:false};
  var isOpen = function(seg){
    var v=window.__clueGroupOpen[gkey(seg)];
    return (v===undefined)?defOpen[seg]:v;
  };

  // 政府端已无 AI 扫描态线索（历史 ai_scan 数据在 visibleClues 里已被过滤）
  var renderOne = function(c,ci){
    return clueCard(c, projKey, ci);
  };

  var segMeta = {
    teal:  {label:'可安排沟通', dot:'#22c55e', bg:'#f0fdf4', col:'#166534'},
    amber: {label:'核验中',     dot:'#f59e0b', bg:'#fffbeb', col:'#92400e'},
    slate: {label:'待接触',     dot:'#9aa5b5', bg:'#f5f7fb', col:'#6b7280'}
  };

  var section = function(seg){
    var m=segMeta[seg];
    var list=all.filter(function(c){return (c.tone||'slate')===seg;});
    if(!list.length) return '';
    var open=isOpen(seg);
    var head='<button onclick="toggleClueGroup(\''+projKey+'\',\''+seg+'\')" '+
      'style="width:100%;display:flex;align-items:center;gap:8px;padding:10px 12px;background:'+m.bg+';border:1px solid '+m.dot+'33;border-radius:10px;cursor:pointer;text-align:left;margin-bottom:'+(open?'10px':'0')+'">'+
      '<span style="width:8px;height:8px;border-radius:50%;background:'+m.dot+';flex-shrink:0"></span>'+
      '<span style="font-size:12.5px;font-weight:750;color:'+m.col+'">'+m.label+'</span>'+
      '<span style="font-size:11px;padding:1px 7px;background:#fff;color:'+m.col+';border-radius:10px;border:1px solid '+m.dot+'33">'+list.length+'家</span>'+
      '<div style="flex:1"></div>'+
      '<span style="font-size:12px;color:#9aa5b5">'+(open?'▲':'▼')+'</span>'+
    '</button>';
    var body=open ? '<div style="margin-bottom:14px">'+list.map(renderOne).join('')+'</div>' : '';
    return head+body;
  };

  var sections = section('teal')+section('amber')+section('slate');

  // 顶部工具条：扫描 / 录入 操作 + 空态
  var tools = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">'+
    '<span style="font-size:12px;font-weight:750;color:#0b183b;letter-spacing:.3px">候选企业线索</span>'+
    '<span style="font-size:11px;padding:2px 7px;background:#eef2ff;color:#4338ca;border-radius:10px">共 '+all.length+' 家</span>'+
    '<div style="flex:1"></div>'+
    // 政府端不做企业扫描：候选企业由管理端 AI 漏斗精选推送，此处只保留手动录入
    '<button onclick="addClueManual(\''+projKey+'\')" style="padding:4px 10px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;font-size:11.5px;color:#166534;cursor:pointer;font-weight:600">+ 录入</button>'+
  '</div>';

  var empty = '<div style="text-align:center;padding:20px;background:#f9fafb;border-radius:10px;border:1px solid #e8edf5">'+
    '<div style="font-size:12.5px;color:#9aa5b5;margin-bottom:4px">暂无候选企业线索</div>'+
    '<div style="font-size:11.5px;color:#b0b8c4;margin-bottom:10px">待接触企业由资源端 AI 漏斗精选后推送，也可手动录入</div>'+
    '<button onclick="addClueManual(\''+projKey+'\')" style="padding:6px 14px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;font-size:12px;color:#166534;cursor:pointer;font-weight:600">+ 手动录入企业</button>'+
  '</div>';

  return '<div>'+tools+(all.length?sections:empty)+'</div>';
}

function toggleClueGroup(projKey, seg){
  if(!window.__clueGroupOpen) window.__clueGroupOpen={};
  var key=projKey+'::'+seg;
  var defOpen={teal:true, amber:true, slate:false};
  var cur=window.__clueGroupOpen[key];
  var now=(cur===undefined)?defOpen[seg]:cur;
  window.__clueGroupOpen[key]=!now;
  render();
}

/* 政府端 AI 扫描已下线：候选企业只来自管理端 AI 漏斗推送或干部手动录入。
   原 scanClueCard / convertToClue / dismissScanClue 随入口一并移除。 */




function deriveCluesFromReport(projKey){
  var rs = REPORTSTATE[projKey];
  var p  = PROJECTS[projKey];
  if(!rs || !rs.text || !p) return;
  if(p.clues && p.clues.length > 0) return; // 已有线索不重复派生

  var text = rs.text;
  var lines = text.split('\n');
  var items = [];

  // 从 TOP5 / ❌缺失 行提取缺口
  var gaps = [];
  var inTop5 = false;
  for(var i=0; i<lines.length; i++){
    var l = lines[i];
    if(l.indexOf('补链优先级')>=0 || l.indexOf('TOP5')>=0 || l.indexOf('优先级清单')>=0) inTop5=true;
    if(inTop5 && l.trim().charAt(0)==='|'){
      var cells = l.trim().slice(1,-1).split('|').map(function(c){return c.replace(/[*★]/g,'').trim();});
      var isSep = cells.every(function(c){return /^[\s\-:]+$/.test(c);});
      if(isSep || cells[0]==='排名' || cells[0]==='缺口节点') continue;
      var rank = parseInt(cells[0]);
      if(!isNaN(rank) && rank>=1 && rank<=3 && cells[1]) gaps.push(cells[1]);
    }
    if(inTop5 && gaps.length>=3) break;
  }
  // 降级：找 ❌ 行
  if(!gaps.length){
    lines.forEach(function(l){
      if(l.indexOf('❌')>=0 && gaps.length<3){
        var c = l.replace(/^[*\-•|#\s]+/,'').replace(/❌|\*\*/g,'').trim();
        if(c.length>4 && c.length<50) gaps.push(c);
      }
    });
  }

  // 每个缺口生成一条脱敏候选线索
  var regionMap = ['长三角','华南','华东','华中'];
  var kindSuffix = ['系统集成商','制造企业','配套企业'];
  gaps.slice(0,3).forEach(function(gap, idx){
    items.push({
      id: 'clue_' + projKey + '_' + idx,
      name: '脱敏企业 ' + String.fromCharCode(65+idx) + '（' + gap.slice(0,8) + '·代号）',
      kind: gap + kindSuffix[idx%3],
      region: regionMap[idx%4],
      source: '慧小招研判报告（' + new Date().toLocaleDateString('zh-CN') + '）',
      status: '待资源核验',
      tone: 'slate',
      reason: '直接补「' + gap + '」缺口，与' + p.city + '本地链主形成配套需求。',
      signal: '基于报告缺口判断，具体企业投资意向与决策层触达可能性需资源团队核验。',
      questions: [
        '企业是否有异地布局或产能扩张计划',
        '与' + p.city + '本地链主的配套合作可行性',
        '落地规模与首批场景要求'
      ]
    });
  });

  if(!p.clues) p.clues = [];
  p.clues = p.clues.concat(items);
  persist();
}

/* ── 线索卡片渲染 ── */
function clueCard(clue, projKey, idx){
  var toneMap = {
    slate: {bg:'#f5f7fb', border:'#e8edf5', dot:'#9aa5b5', label:'待接触'},
    amber: {bg:'#fffbeb', border:'#fde68a', dot:'#f59e0b', label:'核验中'},
    teal:  {bg:'#f0fdf4', border:'#86efac', dot:'#22c55e', label:'可安排沟通'}
  };
  var t = toneMap[clue.tone] || toneMap.slate;
  var isExpanded = (window.__clueOpen === clue.id);

  var questionsHtml = clue.questions.length
    ? '<div style="margin-top:10px"><div style="font-size:11px;font-weight:650;color:#6b7280;letter-spacing:.3px;margin-bottom:5px">核验问题</div>'+
      clue.questions.map(function(q,qi){
        return '<div style="display:flex;gap:6px;padding:5px 0;border-bottom:1px solid #f3f4f6">'+
          '<span style="color:#9aa5b5;flex-shrink:0;font-size:12px">'+(qi+1)+'.</span>'+
          '<span style="font-size:12.5px;color:#374151">'+q+'</span>'+
        '</div>';
      }).join('')+'</div>'
    : '';

  var expandedDetail = isExpanded
    ? '<div style="padding:12px 16px 14px;border-top:1px solid '+t.border+';background:'+t.bg+'">'+
        '<div style="margin-bottom:8px">'+
          '<div style="font-size:11px;font-weight:650;color:#6b7280;letter-spacing:.3px;margin-bottom:4px">为什么值得核验</div>'+
          '<div style="font-size:13px;color:#1f2937;line-height:1.65">'+(clue.reason||clue.fit||('AI 漏斗按「'+(clue.gap||'该方向')+'」精筛，适配度 '+(clue.fit_score||0)+' 分，建议资源团队核验企业投资意向。'))+'</div>'+
          // 优质标注：有扩张需求 / 派系关联（无则不显示）
          (clue.expansion?'<div style="font-size:12px;color:#166534;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:7px;padding:5px 9px;margin-top:6px;line-height:1.55">🚀 <strong>有扩张需求</strong>：'+clue.expansion+'</div>':'')+
          (clue.faction?'<div style="font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:7px;padding:5px 9px;margin-top:6px;line-height:1.55">🤝 <strong>派系关联</strong>：'+clue.faction+'</div>':'')+
          // 评分卡分项构成（仅当有分项数据时展示）
          ((clue.score_match!=null||clue.score_relocate!=null||clue.score_strength!=null)?'<div style="font-size:11px;color:#9aa5b5;margin-top:6px">适配度构成：匹配 '+(clue.score_match||0)+' + 可招引 '+(clue.score_relocate||0)+' + 实力 '+(clue.score_strength||0)+' = '+(clue.fit_score||0)+' 分'+(clue.score_reason?' · '+clue.score_reason:'')+'</div>':'')+
        '</div>'+
        '<div style="margin-bottom:8px">'+
          '<div style="font-size:11px;font-weight:650;color:#6b7280;letter-spacing:.3px;margin-bottom:4px">公开信号与资源边界</div>'+
          '<div style="font-size:12.5px;color:#4b5563;line-height:1.6">'+clue.signal+'</div>'+
        '</div>'+
        questionsHtml+
        '<div style="display:flex;gap:8px;margin-top:12px">'+
          (clue.tone==='slate'
            ? '<button onclick="requestVerify(\''+projKey+'\',\''+clue.id+'\')" '+
                'style="flex:1;padding:8px;background:#fffbeb;border:1.5px solid #fde68a;border-radius:8px;font-size:12.5px;font-weight:600;color:#92400e;cursor:pointer">'+
                '🔍 请资源团队核验</button>'
            : clue.tone==='amber'
            ? '<button onclick="arrangeDocking(\''+projKey+'\',\''+clue.id+'\')" '+
                'style="flex:1;padding:8px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;font-size:12.5px;font-weight:600;color:#166534;cursor:pointer">'+
                '✓ 核验通过，可安排沟通</button>'
            : '<button onclick="arrangeDocking(\''+projKey+'\',\''+clue.id+'\')" '+
                'style="flex:1;padding:8px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;font-size:12.5px;font-weight:600;color:#166534;cursor:pointer">'+
                '✓ 安排首次沟通</button>'
          )+
          '<button onclick="editClue(\''+projKey+'\',\''+clue.id+'\')" '+
            'style="padding:8px 12px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:8px;font-size:12px;color:#4a5568;cursor:pointer">'+
            '✎ 编辑</button>'+
          '<button onclick="confirmDeleteClue(\''+projKey+'\',\''+clue.id+'\')" '+
            'style="padding:8px 12px;background:#fef2f2;border:1.5px solid #fecaca;border-radius:8px;font-size:12px;color:#b91c1c;cursor:pointer">'+
            '\u2715 移除企业</button>'+
        '</div>'+
      '</div>'
    : '';

  return '<div style="border-radius:12px;border:1.5px solid '+t.border+';overflow:hidden;background:#fff;margin-bottom:8px">'+
    '<button onclick="toggleClue(\''+clue.id+'\')" '+
      'style="width:100%;display:flex;align-items:center;gap:12px;padding:12px 16px;background:'+(isExpanded?t.bg:'#fff')+';border:none;cursor:pointer;text-align:left">'+
      '<span style="width:8px;height:8px;border-radius:50%;background:'+t.dot+';flex-shrink:0;box-shadow:0 0 0 2px '+t.border+'"></span>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13.5px;font-weight:700;color:#0b183b;margin-bottom:2px">'+cleanCoName(clue.name)+'</div>'+
        '<div style="font-size:12px;color:#8492a6">'+clue.kind+' · '+clue.region+'</div>'+
      '</div>'+
      '<span style="padding:3px 10px;background:'+t.bg+';color:'+t.dot+';border:1px solid '+t.border+';border-radius:20px;font-size:11.5px;font-weight:600;flex-shrink:0;white-space:nowrap">'+t.label+'</span>'+
      // 删除该企业：外层是 <button>，不能再嵌 button（HTML 非法），沿用项目卡片的 span+onclick 写法
      '<span onclick="event.stopPropagation();confirmDeleteClue(\''+projKey+'\',\''+clue.id+'\')" title="移除这家企业" '+
        'style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;color:#c0c8d4;background:transparent;border:1px solid transparent;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;margin-left:2px;transition:background .15s,color .15s" '+
        'onmouseover="this.style.background=\'#fef2f2\';this.style.color=\'#dc2626\';this.style.borderColor=\'#fecaca\'" '+
        'onmouseout="this.style.background=\'transparent\';this.style.color=\'#c0c8d4\';this.style.borderColor=\'transparent\'">\u2715</span>'+
      '<span style="font-size:12px;color:#9aa5b5;margin-left:2px">'+(isExpanded?'▲':'▼')+'</span>'+
    '</button>'+
    expandedDetail+
  '</div>';
}

/* ── 操作函数 ── */
function cleanCoName(n){
  if(!n) return n||'';
  // 去掉企业名后的（脱敏）/（代号：xxx）/(...) 等括号后缀，只保留企业名称
  return String(n).replace(/[\uff08(][^\uff09)]*[\uff09)]\s*$/,'').trim();
}
function toggleClue(id){
  window.__clueOpen = (window.__clueOpen===id) ? null : id;
  // 记录当前滚动容器位置：render() 整页重渲染会把 scrollTop 归零，导致展开卡片时视图弹回顶部
  var sc=document.querySelector('.report-scroll,.clues-scroll,.knowledge-scroll,.conversation-scroll,.docking-scroll');
  var top=sc?sc.scrollTop:0;
  render();
  // 重渲染后恢复滚动位置，让展开/折叠就地发生
  var restore=function(){
    var sc2=document.querySelector('.report-scroll,.clues-scroll,.knowledge-scroll,.conversation-scroll,.docking-scroll');
    if(sc2) sc2.scrollTop=top;
  };
  restore();
  // 再在下一帧恢复一次，防止浏览器异步重排把 scrollTop 又归零
  if(window.requestAnimationFrame) requestAnimationFrame(restore);
}

/* 【2026-09-17 新增】把政府端的阶段/线索进度同步到管理端需求池（DEMANDS）。
   管理端 ops.html 渲染完全依赖 DEMANDS 里的 res / resLabel / clues 字段，
   而旧实现推进阶段时只改 PROJECTS[k].stage，从不更新 DEMANDS，
   导致政府端已到「资源匹配」，管理端仍显示「待研判」甚至没有进度 —— 即"管理端没同步"。
   res 取值须与 ops.html 的 RES_COLOR 一致：none / checking / matched。 */
function syncDemandStage(projKey){
  try{
    var p=PROJECTS[projKey]; if(!p) return;
    if(typeof DEMANDS==='undefined'||!Array.isArray(DEMANDS)) return;
    var d=null;
    for(var i=0;i<DEMANDS.length;i++){
      var it=DEMANDS[i]; if(!it) continue;
      if(it.projKey===projKey || it.id===projKey || it.id==='d'+projKey){ d=it; break; }
    }
    if(!d) return;
    var clues=p.clues||[];
    var teal=0,amber=0;
    clues.forEach(function(c){ if(!c) return; if(c.tone==='teal')teal++; else if(c.tone==='amber')amber++; });
    var st=Number(p.stage)||0;
    // 阶段/线索 → 管理端资源状态（只进不退，避免旧快照把已推进的状态拉回）
    var res='none', label='待研判';
    if(st>=5 || teal>0){ res='matched'; label='已匹配'; }
    else if(st>=4 || amber>0){ res='checking'; label='核验中'; }
    else if(st>=3){ res='none'; label='待资源匹配'; }
    var rank={none:1,checking:2,matched:3};
    if((rank[res]||0)>=(rank[d.res]||0)){ d.res=res; d.resLabel=label; }
    d.clues=clues.length;
    if(p.topic!=null) d.topic=p.topic;
    d.stage=st;
    d.projKey=projKey;
  }catch(_e){}
}
function requestVerify(projKey, clueId){
  var p = PROJECTS[projKey]; if(!p) return;
  var c = (p.clues||[]).find(function(x){return x.id===clueId;});
  if(!c) return;
  c.tone = 'amber';
  c.status = '资源核验中';
  // 推进 stage 到 4（资源匹配）
  p.stage = Math.max(p.stage, 4);
  // 【2026-09-17】方向级进度同写，否则刷新后被 stageByTopic 旧值回灌，退回「确认需求」
  if(!p.stageByTopic) p.stageByTopic={};
  if(p.topic!=null) p.stageByTopic[p.topic]=Math.max(Number(p.stageByTopic[p.topic])||0, p.stage);
  // 【2026-09-17】同步管理端需求池，修复"管理端没同步"
  syncDemandStage(projKey);
  persist();
  render();
  toast('✓ 已发起资源核验，等待团队回传');
}

function arrangeDocking(projKey, clueId){
  var p = PROJECTS[projKey]; if(!p) return;
  var c = (p.clues||[]).find(function(x){return x.id===clueId;});
  if(!c) return;
  c.tone = 'teal';
  c.status = '可安排首次沟通';
  p.stage = Math.max(p.stage, 5);
  if(!p.stageByTopic) p.stageByTopic={};
  if(p.topic!=null) p.stageByTopic[p.topic]=Math.max(Number(p.stageByTopic[p.topic])||0, p.stage);
  syncDemandStage(projKey);
  persist();
  render();
  toast('✓ 已标记为可安排沟通，进入招商对接阶段');
  showContactCard(projKey, clueId);
}

/* ── 核验通过后弹出：如何联系这家企业（折叠卡片）── */
function showContactCard(projKey, clueId){
  var p = PROJECTS[projKey]; if(!p) return;
  var c = (p.clues||[]).find(function(x){return x.id===clueId;});
  if(!c) return;
  window.__contactOpen = true;
  openModal('可安排沟通 · 如何联系这家企业', contactCardBody(c), contactCardFoot());
}

function toggleContactCard(){
  window.__contactOpen = !window.__contactOpen;
  var b = document.getElementById('contactCardBox'); if(!b) return;
  var d = b.querySelector('.cc-detail'), a = b.querySelector('.cc-arrow');
  if(d) d.style.display = window.__contactOpen ? 'block' : 'none';
  if(a) a.textContent = window.__contactOpen ? '▲' : '▼';
}

function contactCardBody(c){
  var open = window.__contactOpen;
  var head =
    '<div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;background:#f0fdf4;border:1px solid #86efac;border-radius:12px">'+
      '<div style="width:36px;height:36px;border-radius:50%;background:#22c55e;display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;flex-shrink:0">✓</div>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:14px;font-weight:750;color:#065f46">核验通过 · 可安排首次沟通</div>'+
        '<div style="font-size:12.5px;color:#166534;margin-top:3px;line-height:1.6">「'+c.name+'」已通过资源端可达性核验，下面是推荐的触达路径。</div>'+
      '</div>'+
    '</div>';
  return '<div id="contactCardBox">'+ head + contactCardDetail(c) +'</div>';
}

function contactCardDetail(c){
  var open = window.__contactOpen;
  var toggle =
    '<button onclick="toggleContactCard()" style="width:100%;display:flex;align-items:center;gap:8px;margin-top:12px;padding:11px 14px;background:#fff;border:1.5px solid #e8edf5;border-radius:10px;cursor:pointer;text-align:left">'+
      '<span style="font-size:13px;font-weight:700;color:#0b183b;flex:1">📇 如何联系这家企业</span>'+
      '<span class="cc-arrow" style="font-size:12px;color:#9aa5b5">'+(open?'▲':'▼')+'</span>'+
    '</button>';
  var detail = '<div class="cc-detail" style="display:'+(open?'block':'none')+';margin-top:10px">'+
    contactPathHtml(c) + contactPersonHtml(c) + contactBoundaryHtml() +
  '</div>';
  return toggle + detail;
}

function contactPathHtml(c){
  var steps = [
    ['1','资源端移交对接窗口','资源团队已完成可达性核验，将脱敏企业「'+c.name+'」的对接窗口与关键人角色移交招商干部。'],
    ['2','政企首次沟通','由招商干部或授权领导发起首次沟通，介绍'+((PROJECTS[cur]&&PROJECTS[cur].city)||'本地')+'承接条件与合作意向，确认企业投资意愿。'],
    ['3','实地走访与落地洽谈','沟通达成初步意向后，安排企业实地走访承接园区，进入政策/选址/配套的正式洽谈。']
  ];
  var rows = steps.map(function(s){
    return '<div style="display:flex;gap:12px">'+
      '<div style="display:flex;flex-direction:column;align-items:center">'+
        '<div style="width:24px;height:24px;border-radius:50%;background:#1a56db;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;flex-shrink:0">'+s[0]+'</div>'+
        (s[0]!=='3'?'<div style="width:2px;flex:1;background:#e8edf5;margin:4px 0"></div>':'')+
      '</div>'+
      '<div style="padding:1px 0 '+(s[0]!=='3'?'14px':'2px')+'">'+
        '<div style="font-size:13px;font-weight:650;color:#0b183b">'+s[1]+'</div>'+
        '<div style="font-size:12px;color:#667590;margin-top:2px;line-height:1.6">'+s[2]+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
  return '<div style="padding:14px 16px;border:1px solid #e8edf5;border-radius:12px;margin-bottom:10px">'+
    '<div style="font-size:11px;font-weight:650;color:#6b7280;letter-spacing:.3px;margin-bottom:12px">推荐触达路径</div>'+
    rows +
  '</div>';
}
function contactPersonHtml(c){
  var rows = [
    ['对接窗口','资源团队 · 项目对接专员','由资源端在核验通过后 1 个工作日内推送脱敏对接卡'],
    ['企业关键人','决策层触达路径已核实','真实姓名/职务/联系方式由资源团队保管，线下移交'],
    ['建议对接方','招商干部 + 授权领导','以政企身份发起首次沟通，规格匹配决策层']
  ];
  var body = rows.map(function(r){
    return '<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid #f3f4f6">'+
      '<span style="width:64px;flex-shrink:0;font-size:12px;color:#8490a5">'+r[0]+'</span>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:12.5px;font-weight:600;color:#1f2937">'+r[1]+'</div>'+
        '<div style="font-size:11.5px;color:#8492a6;margin-top:1px;line-height:1.5">'+r[2]+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
  return '<div style="padding:14px 16px;border:1px solid #e8edf5;border-radius:12px;margin-bottom:10px">'+
    '<div style="font-size:11px;font-weight:650;color:#6b7280;letter-spacing:.3px;margin-bottom:6px">对接联系人（脱敏）</div>'+
    body +
  '</div>';
}
function contactBoundaryHtml(){
  return '<div style="display:flex;align-items:flex-start;gap:8px;padding:11px 13px;background:#f7f8fa;border-radius:10px;font-size:11px;color:#8492a6;line-height:1.6">'+
    '<span style="flex-shrink:0">🔒</span>'+
    '<span>使用边界：政府端仅展示脱敏对接窗口与触达路径；企业真实名称、关键人联系方式由资源团队线下保管移交，系统不自动联系企业、不跳过确认关口。</span>'+
  '</div>';
}

function contactCardFoot(){
  return '<button class="secondary-button" onclick="closeModal()">稍后处理</button>'+
    '<button class="primary-button" onclick="closeModal();toast(\'✓ 已通知资源团队协调触达，请留意对接进度\')">通知资源团队协调</button>';
}

function editClue(projKey, clueId){
  var p = PROJECTS[projKey]; if(!p) return;
  var c = (p.clues||[]).find(function(x){return x.id===clueId;});
  if(!c) return;

  var layer = document.createElement('div');
  layer.id = 'clueEditLayer';
  layer.onclick = function(e){ if(e.target===layer) layer.remove(); };
  layer.style.cssText = 'position:fixed;inset:0;background:rgba(11,24,59,.4);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;backdrop-filter:blur(4px)';

  layer.innerHTML =
    '<div style="background:#fff;border-radius:20px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;box-shadow:0 24px 80px rgba(11,24,59,.18)">'+
      '<div style="padding:20px 24px;border-bottom:1px solid #f0f4ff;display:flex;align-items:center;justify-content:space-between">'+
        '<div style="font-size:15px;font-weight:750;color:#0b183b">编辑企业线索</div>'+
        '<button onclick="document.getElementById(\'clueEditLayer\').remove()" style="background:none;border:none;font-size:18px;color:#9aa5b5;cursor:pointer">✕</button>'+
      '</div>'+
      '<div style="padding:20px 24px">'+
        '<div style="margin-bottom:14px">'+
          '<label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:6px">企业名称（脱敏代号）</label>'+
          '<input id="cedit-name" value="'+c.name.replace(/"/g,'&quot;')+'" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none" onfocus="this.style.border=\'1.5px solid #6366f1\'" onblur="this.style.border=\'1.5px solid #e8edf5\'"/>'+
        '</div>'+
        '<div style="margin-bottom:14px">'+
          '<label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:6px">企业方向</label>'+
          '<input id="cedit-kind" value="'+c.kind.replace(/"/g,'&quot;')+'" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none" onfocus="this.style.border=\'1.5px solid #6366f1\'" onblur="this.style.border=\'1.5px solid #e8edf5\'"/>'+
        '</div>'+
        '<div style="margin-bottom:14px">'+
          '<label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:6px">区域</label>'+
          '<input id="cedit-region" value="'+c.region+'" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none" onfocus="this.style.border=\'1.5px solid #6366f1\'" onblur="this.style.border=\'1.5px solid #e8edf5\'"/>'+
        '</div>'+
        '<div style="margin-bottom:14px">'+
          '<label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:6px">为什么值得核验</label>'+
          '<textarea id="cedit-reason" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none;resize:vertical;min-height:72px;line-height:1.6" onfocus="this.style.border=\'1.5px solid #6366f1\'" onblur="this.style.border=\'1.5px solid #e8edf5\'">'+c.reason+'</textarea>'+
        '</div>'+
        '<div style="margin-bottom:20px">'+
          '<label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:6px">核验状态</label>'+
          '<div style="display:flex;gap:8px">'+
            ['slate:待接触','amber:核验中','teal:可安排沟通'].map(function(s){
              var parts=s.split(':'), val=parts[0], label=parts[1];
              var isActive=c.tone===val;
              return '<button onclick="this.parentNode.querySelectorAll(\'.tone-btn\').forEach(function(b){b.style.background=\'#f5f7fb\';b.style.fontWeight=\'400\'});this.style.background=\'#eff6ff\';this.style.fontWeight=\'700\';window.__clueEditTone=\''+val+'\'" '+
                'class="tone-btn" '+
                'style="flex:1;padding:7px 0;border:1.5px solid #e8edf5;border-radius:8px;font-size:12px;cursor:pointer;background:'+(isActive?'#eff6ff':'#f5f7fb')+';font-weight:'+(isActive?'700':'400')+';color:#0b183b">'+label+'</button>';
            }).join('')+
          '</div>'+
        '</div>'+
        '<button onclick="saveClueEdit(\''+projKey+'\',\''+clueId+'\')" '+
          'style="width:100%;padding:12px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:10px;font-size:13.5px;font-weight:650;cursor:pointer">'+
          '保存修改</button>'+
      '</div>'+
    '</div>';

  window.__clueEditTone = c.tone;
  document.body.appendChild(layer);
}

function saveClueEdit(projKey, clueId){
  var p = PROJECTS[projKey]; if(!p) return;
  var c = (p.clues||[]).find(function(x){return x.id===clueId;});
  if(!c) return;
  var name   = document.getElementById('cedit-name');
  var kind   = document.getElementById('cedit-kind');
  var region = document.getElementById('cedit-region');
  var reason = document.getElementById('cedit-reason');
  if(name)   c.name   = name.value.trim() || c.name;
  if(kind)   c.kind   = kind.value.trim() || c.kind;
  if(region) c.region = region.value.trim() || c.region;
  if(reason) c.reason = reason.value.trim() || c.reason;
  c.tone = window.__clueEditTone || c.tone;
  var toneStatusMap = {slate:'待接触',amber:'资源核验中',teal:'可安排首次沟通'};
  c.status = toneStatusMap[c.tone] || c.status;
  persist();
  document.getElementById('clueEditLayer').remove();
  render();
  toast('✓ 线索已更新');
}

function addClueManual(projKey){
  var p = PROJECTS[projKey]; if(!p) return;
  if(!p.clues) p.clues = [];
  var newClue = {
    id: 'clue_manual_'+Date.now().toString(36),
    name: '待填写企业名称',
    kind: '待填写企业方向',
    region: '待填写区域',
    source: '招商干部录入',
    status: '待资源核验',
    tone: 'slate',
    reason: '待填写核验理由',
    signal: '来源：招商干部录入，需人工核验',
    questions: ['核验企业主营方向','确认与本次招商需求的结合点','判断资源可达性与沟通窗口']
  };
  p.clues.push(newClue);
  persist();
  render();
  // 自动打开编辑弹窗
  setTimeout(function(){ editClue(projKey, newClue.id); }, 100);
}

/* ══════════════════════════════════════════════════════════════
   projMgmtPage 完整重写
   ══════════════════════════════════════════════════════════════ */
function projMgmtPage(p){
  // 账号按城市独立：只显示当前登录城市（cur 项目所在城市）的项目
  var _myCity = (cur && PROJECTS[cur] && PROJECTS[cur].city) ? PROJECTS[cur].city : null;
  var projKeys = Object.keys(PROJECTS).filter(function(k){
    var x = PROJECTS[k]; if(!x) return false;
    if(_myCity && x.city !== _myCity) return false;
    // 关键修复：招商对接只显示「已正式提交的招商需求」子项目。
    // 父项目/城市产业分析工作区(如 sz、p*)的 topic 会随产业分析选中方向变化，
    // 绝不能进列表——否则「招商对接第一条随选中方向变」。
    // 兼容旧数据：老的立项子项目没有 isDemand 标记，用 isMainProject 兜底排除主项目，
    // 并要求 stage>=3（真正提交过需求才会到确认需求阶段）。
    if(x.isDemand === true) return true;
    return false; // 只认isDemand===true，不再用stage>=3兜底（防止产业分析项目误入招商对接）
  });
  if(!projKeys.length){
    return '<div class="page">'+
      '<div class="page-header"><div><span class="eyebrow">PROJECTS</span><h1>招商对接</h1>'+
      '<p>研判报告确认后，提交招商需求的方向会出现在这里。</p></div></div>'+
      '<div class="knowledge-scroll"><div style="text-align:center;padding:60px 20px">'+
        '<div style="font-size:36px;margin-bottom:12px">📂</div>'+
        '<div style="font-size:15px;font-weight:700;color:#0b183b;margin-bottom:8px">暂无立项</div>'+
        '<div style="font-size:13px;color:#8492a6;line-height:1.7;margin-bottom:20px">'+
          '在「产业分析」生成完整产业报告后，<br>点击「🏁 可立项招引方向」中的「提交招商需求 →」按钮建立项目'+
        '</div>'+
        '<button onclick="go(\'report\')" style="padding:10px 24px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:10px;font-size:13.5px;font-weight:650;cursor:pointer">前往产业分析 →</button>'+
      '</div></div></div>';
  }

  var groups = projKeys.map(function(k){
    var x = PROJECTS[k];
    var sc = stColor(x.stage);
    var expanded = (window.__projOpen === k);

    // 政府端不再自动派生「脱敏企业」假线索——待接触企业只由管理端 AI 漏斗推送
    // deriveCluesFromReport(k);
    // 待接触企业只来自管理端 AI 漏斗推送(status:'gov_push')或干部手动录入，不注入任何假数据
    if(PROJECTS[k] && !PROJECTS[k].clues) PROJECTS[k].clues=[];

    var clues = visibleClues(x, k);
    var teal  = clues.filter(function(c){return c.tone==='teal';}).length;
    var amber = clues.filter(function(c){return c.tone==='amber';}).length;
    var slate = clues.filter(function(c){return (c.tone||'slate')==='slate';}).length;

    // 线索摘要标签
    var cluesSummary = clues.length
      ? (teal?'<span style="padding:2px 8px;background:#f0fdf4;color:#166534;border-radius:12px;font-size:11px;margin-left:4px">'+teal+'条可沟通</span>':'')
        +(amber?'<span style="padding:2px 8px;background:#fffbeb;color:#92400e;border-radius:12px;font-size:11px;margin-left:4px">'+amber+'条核验中</span>':'')
        +(slate?'<span style="padding:2px 8px;background:#f5f7fb;color:#6b7280;border-radius:12px;font-size:11px;margin-left:4px">'+slate+'条待接触</span>':'')
      : '<span style="font-size:11px;color:#9aa5b5;margin-left:4px">待生成线索</span>';

    // 展开内容
    var expandedContent = '';
    if(expanded){
      // 进度条：标准5阶段 + 管理端为该项目新增的自定义阶段。
      // 【2026-09-18 修复】原来这里写死 STAGES，管理端新增的「第一次会议」等阶段
      // 只出现在右上角徽章（走 stageNameOf→projStages），蓝色进度条里看不到。
      var _stagesX = projStages(x);
      var _fsX = _stagesX.length > 6 ? '10px' : '11px';
      var stageBar = '<div style="margin-bottom:16px">'+
        '<div style="display:flex;gap:0;border-radius:8px;overflow:hidden;border:1px solid #e8edf5">'+
        _stagesX.map(function(s,si){
          var n=si+1;
          var isDone = n < x.stage;
          var isCur  = n === x.stage;
          var bg = isDone?'#1a56db':isCur?'#eff6ff':'#f9fafb';
          var color = isDone?'#fff':isCur?'#1a56db':'#9aa5b5';
          var fw = isCur?'700':'400';
          return '<div style="flex:1;min-width:0;padding:8px 6px;text-align:center;background:'+bg+';border-right:1px solid #e8edf5;cursor:'+(n<=x.stage?'default':'pointer')+';" '+
            (n===x.stage+1?'onclick="advanceStage(\''+k+'\')" title=\"点击推进到下一阶段\"':'')+'>' +
            '<div style="font-size:'+_fsX+';font-weight:'+fw+';color:'+color+';line-height:1.35;word-break:break-all">'+
              (isDone?'✓ ':'')+(isCur?'⬤ ':'')+s[0]+
            '</div>'+
            (isCur&&s[1]?'<div style="font-size:9px;color:#6b7f9c;margin-top:2px;line-height:1.3">'+s[1]+'</div>':'')+
          '</div>';
        }).join('')+
        '</div></div>';

      // 历史报告
      var reportHist = '';
      var rs = REPORTSTATE[k];
      if(rs){
        reportHist = '<div style="margin-bottom:14px;padding:10px 14px;background:#f8faff;border-radius:10px;border:1px solid #e8edf5">'+
          '<div style="display:flex;align-items:center;gap:8px">'+
            '<span style="font-size:14px">📋</span>'+
            '<div style="flex:1">'+
              '<div style="font-size:13px;font-weight:650;color:#0b183b">产业分析报告</div>'+
              '<div style="font-size:11.5px;color:#8492a6">置信度 '+topicScore(rs.topic, k)+'% · '+new Date(rs.ts).toLocaleDateString('zh-CN')+'</div>'+
            '</div>'+
            '<button onclick="cur=\''+k+'\';viewCurrentReport()" style="padding:5px 12px;background:#fff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:12px;color:#1a56db;cursor:pointer">查看报告</button>'+
          '</div>'+
        '</div>';
      }

      // stage=2 引导：前往产业分析生成本方向报告
      var stageGuide = '';
      if(x.stage===2){
        // stage=2：报告已从父项目继承，直接引导确认方向
        stageGuide=
          '<div style="margin-bottom:16px;padding:14px 16px;background:linear-gradient(135deg,#eff6ff,#f0f9ff);border:1.5px solid #bfdbfe;border-radius:12px">'+
            '<div style="display:flex;align-items:center;gap:10px">'+
              '<span style="font-size:24px">🎯</span>'+
              '<div style="flex:1">'+
                '<div style="font-size:13.5px;font-weight:700;color:#1d4ed8;margin-bottom:3px">下一步：确认「'+x.topic+'」研判方向</div>'+
                '<div style="font-size:12px;color:#4a5568;line-height:1.6">研判报告已从母项目继承，可直接确认方向并提交招引需求。</div>'+
              '</div>'+
              '<button onclick="(function(){cur=\''+k+'\';view=\'report\';render();})()" '+
                'style="padding:9px 18px;background:#1a56db;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:650;cursor:pointer;white-space:nowrap;flex-shrink:0">'+
                '查看并确认 →</button>'+
            '</div>'+
          '</div>';
      } else if(x.stage===3){
        stageGuide=
          '<div style="margin-bottom:16px;padding:14px 16px;background:linear-gradient(135deg,#f0fdf4,#f0f9ff);border:1.5px solid #86efac;border-radius:12px">'+
            '<div style="display:flex;align-items:center;gap:10px">'+
              '<span style="font-size:24px">📤</span>'+
              '<div style="flex:1">'+
                '<div style="font-size:13.5px;font-weight:700;color:#166534;margin-bottom:3px">下一步：正式提交招引需求</div>'+
                '<div style="font-size:12px;color:#4a5568;line-height:1.6">研判已完成。提交后候选企业线索自动派生，可发起资源核验。</div>'+
              '</div>'+
              '<button onclick="cur=\''+k+'\';submitDemand()" '+
                'style="padding:9px 18px;background:#22c55e;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:650;cursor:pointer;white-space:nowrap;flex-shrink:0">'+
                '提交招引需求 →</button>'+
            '</div>'+
          '</div>';
      } else if(x.stage>=4){
        var _tealN=teal, _amberN=amber, _slateN=slate;
        var _g=nextStepGuide(k,x,_tealN,_amberN,_slateN);
        if(_g) stageGuide=_g;
      }
      // 线索列表
      var cluesList = renderCluesTwoPanel(k)+
        // 递交按钮
        (x.stage>=3 && x.stage<4
          ? '<button onclick="advanceStage(\''+k+'\')" style="width:100%;margin-top:12px;padding:11px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:10px;font-size:13.5px;font-weight:650;cursor:pointer">📤 正式递交需求，进入资源匹配</button>'
          : ''
        );

      // 对接进度（原招商对接模块，仅 stage>=3 显示）
      var dockInline = (x.stage>=3) ? dockProgressInline(k) : '';

      expandedContent = '<div style="padding:0 16px 16px">'+
        stageBar+
        stageGuide+
        reportHist+
        cluesList+
        dockInline+
      '</div>';
    }

    return '<div style="margin-bottom:12px;border-radius:14px;border:1.5px solid '+(expanded?'#bfdbfe':'#e8edf5')+';overflow:hidden;background:#fff">'+
      '<button onclick="toggleProjGroup(\''+k+'\')" '+
        'style="width:100%;display:flex;align-items:center;gap:12px;padding:14px 18px;background:'+(expanded?'#f8faff':'#fff')+';border:none;cursor:pointer;text-align:left">'+
        '<span style="font-size:22px;flex-shrink:0">🎯</span>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">'+
            '<strong style="font-size:14px;color:#0b183b">'+x.topic+'</strong>'+
            cluesSummary+
          '</div>'+
          '<div style="font-size:12px;color:#8492a6;margin-top:3px">'+x.city+' · '+stageNameOf(x,x.stage)+' · '+clues.length+'条线索</div>'+
        '</div>'+
        '<span style="padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:600;background:'+sc.bg+';color:'+sc.c+'">'+stageNameOf(x,x.stage)+'</span>'+
        // sz 是城市智库主项目(承载 kb/城市报告)，不可删除；仅派生的招商方向项目可删
        (isMainProject(k) ? '' :
          '<span onclick="event.stopPropagation();confirmDeleteProject(\''+k+'\')" title="取消该方向的招商申请" '+
          'style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;margin-left:2px">\u2715</span>')+
        '<span style="font-size:13px;color:#9aa5b5;margin-left:4px">'+(expanded?'▲':'▼')+'</span>'+
      '</button>'+
      expandedContent+
    '</div>';
  }).join('');

  return '<div class="page">'+
    '<div class="page-header"><div>'+
      '<span class="eyebrow">PROJECTS</span><h1>招商对接 · 企业线索</h1>'+
      '<p>展开产业方向查看候选企业线索、研判报告与阶段进度；发起资源核验或安排首次沟通。</p>'+
    '</div></div>'+
    '<div class="knowledge-scroll">'+
      '<div style="width:100%">'+groups+'</div>'+
      '<div style="margin-top:10px;padding:10px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e8edf5;font-size:12px;color:#8492a6">'+
        'ⓘ 企业线索仅展示脱敏代号、公开依据和核验问题；具体资源可达性由资源团队人工核验，系统不自动联系企业。'+
      '</div>'+
    '</div></div>';
}

/* 下一步引导条：根据当前阶段与线索状态给出"当前该做什么"+主操作 */
function nextStepGuide(k,x,teal,amber,slate){
  var box=function(bg,bd,col,icon,title,desc){
    return '<div style="margin-bottom:16px;padding:14px 16px;background:'+bg+';border:1.5px solid '+bd+';border-radius:12px">'+
      '<div style="display:flex;align-items:center;gap:10px">'+
        '<span style="font-size:24px">'+icon+'</span>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:13.5px;font-weight:700;color:'+col+';margin-bottom:3px">'+title+'</div>'+
          '<div style="font-size:12px;color:#4a5568;line-height:1.6">'+desc+'</div>'+
        '</div>'+
      '</div></div>';
  };
  if(x.stage===4){
    if(slate>0) return box('linear-gradient(135deg,#fffbeb,#fefce8)','#fde68a','#92400e','\uD83D\uDD0D','\u5f53\u524d\uff1a'+slate+' \u6761\u5019\u9009\u7ebf\u7d22\u5f85\u53d1\u8d77\u6838\u9a8c','\u5c55\u5f00\u4e0b\u65b9\u7ebf\u7d22\u5361\u7247\uff0c\u70b9\u300c\u8bf7\u8d44\u6e90\u56e2\u961f\u6838\u9a8c\u300d\u628a\u7ebf\u7d22\u63a8\u8fdb\u5230\u6838\u9a8c\u4e2d\u3002');
    if(amber>0) return box('linear-gradient(135deg,#fffbeb,#fff7ed)','#fdba74','#9a3412','\u23F3','\u5f53\u524d\uff1a'+amber+' \u6761\u7ebf\u7d22\u6838\u9a8c\u4e2d','\u8d44\u6e90\u56e2\u961f\u6b63\u5728\u6838\u9a8c\u4f01\u4e1a\u771f\u5b9e\u610f\u5411\u4e0e\u51b3\u7b56\u5c42\u89e6\u8fbe\uff0c\u6838\u9a8c\u901a\u8fc7\u540e\u5373\u53ef\u5b89\u6392\u6c9f\u901a\u3002');
    return box('linear-gradient(135deg,#eff6ff,#f0f9ff)','#bfdbfe','#1d4ed8','\uD83D\uDD0D','\u5f53\u524d\uff1a\u7b49\u5f85\u5019\u9009\u7ebf\u7d22','\u5728\u4e0b\u65b9 AI \u626b\u63cf\u6216\u56e2\u961f\u63a8\u8350\u4e2d\u9009\u5b9a\u5019\u9009\u4f01\u4e1a\uff0c\u53d1\u8d77\u8d44\u6e90\u6838\u9a8c\u3002');
  }
  // 已推进到管理端新增的自定义阶段（序号超过标准5阶段）：按阶段名展示，
  // 否则引导条会一直停在「可安排首次沟通」，与右上角徽章/蓝色进度条不一致。
  if(x.stage>5){
    var _cn=stageNameOf(x,x.stage);
    var _slog=(x.stageLog||[]);
    var _snote='';
    for(var _si=0;_si<_slog.length;_si++){ if(_slog[_si].to===x.stage&&_slog[_si].note){ _snote=_slog[_si].note; break; } }
    return box('linear-gradient(135deg,#f5f3ff,#eff6ff)','#c4b5fd','#5b21b6','\uD83D\uDCC5','\u5f53\u524d\uff1a'+_cn,
      _snote||('\u8be5\u65b9\u5411\u5df2\u63a8\u8fdb\u5230\u300c'+_cn+'\u300d\uff0c\u53ef\u5728\u4e0b\u65b9\u5bf9\u63a5\u8bb0\u5f55\u4e2d\u767b\u8bb0\u8fdb\u5c55\u3002'));
  }
  if(x.stage>=5){
    return box('linear-gradient(135deg,#f0fdf4,#f0f9ff)','#86efac','#166534','\u2705','\u5f53\u524d\uff1a'+(teal||0)+' \u6761\u7ebf\u7d22\u53ef\u5b89\u6392\u6c9f\u901a','\u5c55\u5f00\u53ef\u6c9f\u901a\u7ebf\u7d22\u67e5\u770b\u300c\u5982\u4f55\u8054\u7cfb\u8fd9\u5bb6\u4f01\u4e1a\u300d\uff0c\u5e76\u5728\u4e0b\u65b9\u5bf9\u63a5\u8bb0\u5f55\u4e2d\u767b\u8bb0\u8fdb\u5c55\u3002');
  }
  return '';
}
/* 推进阶段 */
function advanceStage(projKey){
  var p = PROJECTS[projKey]; if(!p) return;
  // 上限取项目实际阶段链长度（含管理端自定义阶段），不再写死 5
  if(p.stage < projStages(p).length){
    p.stage++;
    if(!p.stageByTopic)p.stageByTopic={};
    if(p.topic!=null)p.stageByTopic[p.topic]=p.stage;
    syncDemandStage(projKey);
    persist();
    render();
    var stageName = stageNameOf(p, p.stage);
    toast('✓ 已推进到「' + stageName + '」阶段');
  }
}

function toggleProjGroup(k){
  window.__projOpen=(window.__projOpen===k)?null:k;
  render();
}
/* 取消该方向的招商申请（删除项目）— 弹窗确认后执行 */
/* ── 移除候选企业线索（带墓碑，防服务端合并复活）── */
function confirmDeleteClue(projKey, clueId){
  var p=PROJECTS[projKey]; if(!p) return;
  var c=(p.clues||[]).filter(function(x){return x&&x.id===clueId;})[0];
  if(!c){ toast('该企业已不在列表中'); return; }
  var nm=cleanCoName(c.name)||'该企业';
  var body='<div class="confirm-summary" style="border-color:#fecaca;background:#fef2f2">'+
      '<i class="i" style="color:#dc2626">⚠️</i>'+
      '<div><strong>确认从待接触企业中移除「'+nm+'」？</strong>'+
      '<p>移除后该企业不再出现在本方向的候选企业线索里，其核验状态与核验问题一并删除，此操作不可撤销。'+
      '如后续仍需跟进，可让管理端 AI 漏斗重新推送。</p></div>'+
    '</div>';
  var foot='<button class="secondary-button" onclick="closeModal()">再想想</button>'+
    '<button class="primary-button" style="background:#dc2626;border-color:#dc2626" '+
      'onclick="doDeleteClue(\''+projKey+'\',\''+clueId+'\')">确认移除</button>';
  openModal('移除候选企业', body, foot);
}
function doDeleteClue(projKey, clueId){
  var p=PROJECTS[projKey]; if(!p){ closeModal(); return; }
  var c=(p.clues||[]).filter(function(x){return x&&x.id===clueId;})[0];
  var nm=c?(cleanCoName(c.name)||'该企业'):'该企业';
  // 墓碑：服务端 _merge_clues 保留服务端独有线索，没有墓碑删除会被合并复活
  if(!window.DELETED_CLUES) window.DELETED_CLUES=[];
  // 按企业名写墓碑（取不到整条时才退回 id）：位置型 id 跨漏斗会指向别的企业
  var tk=_clueTombKey(projKey, c||clueId);
  if(window.DELETED_CLUES.indexOf(tk)<0) window.DELETED_CLUES.push(tk);
  p.clues=(p.clues||[]).filter(function(x){ return !(x && x.id===clueId); });
  if(window.__clueOpen===clueId) window.__clueOpen=null;
  // 线索数变化要同步回管理端需求池，否则管理端仍显示旧的「N 家线索」
  try{ syncDemandStage(projKey); }catch(_){}
  persist();
  closeModal();
  render();
  toast('已移除「'+nm+'」');
}

function confirmDeleteProject(k){
  var x=PROJECTS[k]; if(!x) return;
  var safeTopic=(x.topic||'该方向').replace(/'/g,'’');
  var body='<div class="confirm-summary" style="border-color:#fecaca;background:#fef2f2">'+
      '<i class="i" style="color:#dc2626">⚠️</i>'+
      '<div><strong>确认取消「'+x.topic+'」的招商申请？</strong>'+
      '<p>该方向的研判报告、候选企业线索、对接进度将一并删除，此操作不可撤销。</p></div>'+
    '</div>';
  var foot='<button class="secondary-button" onclick="closeModal()">再想想</button>'+
    '<button class="primary-button" style="background:#dc2626;border-color:#dc2626" '+
      'onclick="doDeleteProject(\''+k+'\')">确认取消申请</button>';
  openModal('取消招商申请', body, foot);
}
/* 主项目判定：城市智库主锚点(承载 kb/城市报告)，不可删除。
   sz=随州主锚点；非常驻账号的城市锚点 id 即城市名(autoProvisionCity 用 city 作 key)。 */
function isMainProject(k){
  if(k==='sz') return true;
  var x=PROJECTS[k]; if(!x) return false;
  // 城市锚点：id 等于城市名(如 '上海'/'武汉')
  if(x.id===x.city) return true;
  // 城市锚点主题：「XX主导产业补链招引」——承载城市智库 kb，不可删除
  if(/主导产业补链招引/.test(x.topic||'')) return true;
  // 兜底：某城市只剩一个项目时，它就是该城市锚点，禁止删空
  if(x.city){
    var _sameCity=Object.keys(PROJECTS).filter(function(pk){
      return PROJECTS[pk] && PROJECTS[pk].city===x.city;
    });
    if(_sameCity.length<=1) return true;
  }
  return false;
}
function doDeleteProject(k){
  var x=PROJECTS[k]; if(!x){ closeModal(); return; }
  if(isMainProject(k)){ closeModal(); toast('城市主项目不可删除'); return; }
  var topic=x.topic||'该方向';
  var delCity=x.city||'';
  // 删除墓碑：记录已删项目 key，persist 带给服务端做永久移除。
  // 服务端 _merge_map 只增不减，没有墓碑时删除会被其他会话的快照合并复活（删了又回来）。
  if(!window.DELETED_PROJECTS) window.DELETED_PROJECTS=[];
  if(window.DELETED_PROJECTS.indexOf(k)<0) window.DELETED_PROJECTS.push(k);
  // 删除项目及其关联状态
  delete PROJECTS[k];
  if(typeof REPORTSTATE!=='undefined') delete REPORTSTATE[k];
  if(typeof PENDING_CONFIRMS!=='undefined') delete PENDING_CONFIRMS[k];
  if(typeof UPLOADS!=='undefined') delete UPLOADS[k];
  if(typeof KB_FILE_CHUNKS!=='undefined') delete KB_FILE_CHUNKS[k];
  // 同步清理管理端需求池里对应记录(避免删了方向管理端还挂着需求)
  if(typeof DEMANDS!=='undefined' && Array.isArray(DEMANDS)){
    window.DEMANDS=DEMANDS.filter(function(d){return d.id!==k;});
  }
  if(window.__projOpen===k) window.__projOpen=null;
  // 若删的是当前项目，只在【同城】项目间回退，绝不跨城(否则会跳出其他城市报告)；
  // 同城优先回退到主锚点(sz/城市锚点)，其次同城任意项目。
  if(cur===k){
    var _sameCity=Object.keys(PROJECTS).filter(function(pk){
      return PROJECTS[pk] && PROJECTS[pk].city===delCity;
    });
    var _anchor=_sameCity.filter(isMainProject)[0];
    cur = _anchor || _sameCity[0] || (PROJECTS['sz']?'sz':null) || Object.keys(PROJECTS)[0] || null;
    view='home';
  }
  persist();
  closeModal();
  render();
  toast('✓ 已取消「'+topic+'」的招商申请');
}
// 招引项目独立工作页 = 该方向的"对话作战室"（雷总三栏：中=持续对话，右=证据卡片）
function subWorkPage(p){
  var subs=subprojOf(cur);var s=subs[curSub];
  if(!s){view='home';return projMgmtPage(p);}
  var dir=P();var st=REPORTSTATE[cur];
  var stg=s.stage||4;var sc=stColor(stg);
  var stageName=stageNameOf(s, stg);
  // 顶部上下文条：项目本质信息 + 已双确认（一屏交代"这是什么项目/推进到哪"）
  var ctx='<div class="context-bar" style="margin:0 22px">'+
    '<div class="context-icon"><i class="i">🎯</i></div>'+
    '<div style="flex:1;min-width:0"><strong>'+s.dir+'</strong>'+
      '<span>来源：'+s.from+' 报告 v'+(st?st.ver:1)+(st&&st.finalized?'（已定稿）':'')+' · 候选：'+(s.clueName||'暂无')+' · 双确认已完成</span></div>'+
    '<span class="status-tag" style="color:'+sc.c+';background:'+sc.bg+'">'+stageName+'</span></div>';
  return '<div class="page">'+
    '<div style="display:flex;align-items:center;gap:10px;padding:12px 22px 6px">'+
      '<button class="ghost-button" onclick="go(\'home\')"><i class="i">‹</i>返回招商对接</button><div style="flex:1"></div>'+
      '<button class="ghost-button" onclick="exportSub()"><i class="i">📤</i>导出项目材料</button></div>'+
    ctx+
    '<div class="conversation-scroll" id="conv">'+
      '<div class="message"><img src="'+aiAvatar()+'"><div class="message-bubble">'+
        '<p>这是「<strong>'+s.dir.split(' · ')[0]+'</strong>」招引项目的工作区。它由'+s.from+'研判报告的补链方向经双确认后自动生成，候选线索为 <strong>'+(s.clueName||'暂无')+'</strong>。</p>'+
        '<p>我可以基于这个项目的上下文，帮你把下一步的<strong>材料</strong>准备出来——起草对接方案、列核验清单、写领导汇报、或补充该方向其它可招引环节。生成的都是草稿，需你确认，系统不会自动联系企业。</p></div></div>'+
      '<div class="prompt-list">'+
        promptRow('📝','起草企业对接方案','面向候选企业的初步对接思路与本地承接优势',"subQuick('draft')")+
        promptRow('🔍','生成核验问题清单','对接前需向企业核实的关键问题（供资源端参考）',"subQuick('verify')")+
        promptRow('📤','写给领导的进展汇报','把该项目当前状态汇总成一段可上报的进展',"subQuick('report')")+
        promptRow('➕','补充该方向其它招引环节','围绕本方向，研判还可以补哪些上下游环节',"subQuick('expand')")+
      '</div>'+
    '</div>'+composer()+'</div>';
}
// 项目工作区快捷指令：基于项目上下文，AI生成对应材料草稿（人工可编辑，不自动联系企业）
function subQuick(kind){
  var subs=subprojOf(cur);var s=subs[curSub];if(!s)return;
  var pl=$('.prompt-list');if(pl)pl.remove();
  var dirName=s.dir.split(' · ')[0];
  var p=P();
  var ask={
    draft:'帮我起草一份面向「'+dirName+'」候选企业的初步对接方案',
    verify:'对接前，我需要向「'+dirName+'」候选企业核实哪些关键问题？',
    report:'把「'+dirName+'」这个项目的当前进展汇总成一段给领导的汇报',
    expand:'围绕「'+dirName+'」这个方向，还可以补充研判哪些上下游环节？'
  }[kind]||('关于「'+dirName+'」项目，请给出建议');
  addU(ask);
  setTimeout(function(){ subReply(kind,s,p); },500);
}
function subReply(kind,s,p){
  var dirName=s.dir.split(' · ')[0];
  var body,tag,fileHint;
  var _kbInd2=p.kb&&p.kb[0]||{};var _kbPark2=p.kb&&p.kb[1]||{};
  var _kbFirm2=p.kb&&p.kb[2]||{};var _kbPol2=p.kb&&p.kb[3]||{};
  var _ind2Txt=(_kbInd2.known||[]).slice(0,2).join('；')||p.city+'产业基础扎实，具体配套率见产业链图谱';
  var _park2Txt=(_kbPark2.known||[]).slice(0,1).join('')||p.city+'高新区/经开区具备承接载体';
  var _pol2Txt=(_kbPol2.known||[]).slice(0,1).join('')||'本地产业扶持政策方向明确，专项资金额度待确认';
  if(kind==='draft'){
    tag='对接方案（草稿 · 待确认）';fileHint='对接方案';
    body='<p>已结合<strong>'+s.from+'</strong>报告结论与'+p.city+'本地承接条件，起草「'+dirName+'」初步对接方案草稿——</p>'+
      '<div class="report" style="margin-top:6px"><div class="rbody" style="padding:12px 14px;font-size:12.5px;line-height:1.9;color:#33415a">'+
        '<b>一、'+p.city+'承接优势</b><br>'+_ind2Txt+'。'+_park2Txt+'，可与候选企业形成上下游/场景协同配套。<br>'+
        '<b>二、对企业的核心价值点</b><br>本地整车/改装产量大（配套采购需求稳定）；'+(_kbFirm2.known||[]).slice(0,1).join('')||'骨干链主提供稳定订单'+'；示范场景开放可加速企业渗透市场。<br>'+
        '<b>三、拟对接方式</b><br>由资源端核验「'+s.clueName+'」真实意向后，安排实地走访'+p.city+'承接园区 + 政企座谈；我方准备承接材料与可用时段。<br>'+
        '<b>四、待补充确认</b><br>'+_pol2Txt+'；首选承接园区地块需向领导确认后填入本方案。'+
      '</div></div>';
  }else if(kind==='verify'){
    tag='核验清单（供资源端参考）';fileHint='核验清单';
    var qs=(P().clues||[]).filter(function(c){return c.name===s.clueName})[0];
    var list=(qs&&qs.qs)?qs.qs:['未来三年产能与异地布局计划','对落地城市的应用场景与政策诉求','与本地存量企业的配套/联合开发可能性'];
    body='<p>对接「'+dirName+'」候选企业前，建议资源端重点核实以下问题（系统不直接联系企业）——</p>'+
      '<div class="report" style="margin-top:6px"><div class="rbody" style="padding:12px 14px"><ol class="number-list">'+
      list.map(function(q,i){return '<li><span>'+(i+1)+'</span>'+q+'</li>'}).join('')+'</ol></div></div>';
  }else if(kind==='report'){
    tag='进展汇报（草稿）';fileHint='进展汇报';
    var _rptKb=p.kb&&p.kb[0]||{};var _rptInd=(_rptKb.known||[])[0]||p.city+'产业基础扎实';
    body='<p>已把「'+dirName+'」项目当前状态汇总为一段可上报进展——</p>'+
      '<div class="report" style="margin-top:6px"><div class="rbody" style="padding:12px 14px;font-size:12.5px;line-height:1.9;color:#33415a">'+
      '关于随州「'+s.from+'」方向的「'+dirName+'」招引项目：'+
      '产业基础：'+_rptInd+'。'+
      '当前进展：已完成研判报告并经干部+授权领导双确认，形成正式招商需求并递交资源端。候选线索：'+(s.clueName||'待资源端补充')+'，资源端正核验企业真实意向与决策层触达，预计 2 个工作日反馈。'+
      '下一步：资源核验通过后安排实地走访随州承接园区，并准备政策/园区/配套等承接材料。</div></div>';
  }else{
    tag='方向拓展建议';fileHint='拓展建议';
    // 从当前项目 kb[0] 的 known 推导上下游
    var _kbExpand=p.kb&&p.kb[0]||{};
    var _expandItems=[];
    (_kbExpand.known||[]).forEach(function(kn){
      if(/外购|缺口|空白|全靠/.test(kn)){
        // 找到缺口关键词，截取主语作为建议方向
        var short=kn.replace('本地仍属空白','').replace('几乎全部外购','').replace('全部外购','').replace('缺乏本地供给','').trim();
        if(short.length>4&&short.length<40)_expandItems.push(short+'（补链候选）');
      }
    });
    if(!_expandItems.length){
      _expandItems=['上游关键部件 / 材料本地配套','面向新场景的系统集成能力','检测认证 / 中试等生产性服务环节'];
    }
    body='<p>围绕「'+dirName+'」，从产业链上下游看，以下环节尚可深入研判——</p>'+
      '<div class="report" style="margin-top:6px"><div class="rbody" style="padding:12px 14px"><ul class="check-list">'+
      _expandItems.map(function(x){return '<li><i class="i">•</i>'+x+'</li>'}).join('')+
      '</ul></div></div><p style="margin-top:6px;font-size:12px;color:#667590">如需研判某个环节，可到「产业分析」新增产业方向。</p>';
  }
  var d=addA(body+'<div class="answer-note" style="margin-top:8px">⚠ 以上为 AI 生成草稿，关键判断需人工确认；系统不自动联系企业、不跳过确认关口。</div>');
  // 生成结果附操作条：导出该材料
  if(d){var bar=document.createElement('div');bar.style.cssText='margin:8px 0 0 60px';
    bar.innerHTML='<button class="ghost-button" style="font-size:11.5px;padding:5px 10px" onclick="exportSub()"><i class="i">📤</i>连同项目材料一起导出</button>'+
      '<span style="font-size:11px;color:#9aa5b5;margin-left:8px">'+tag+'</span>';
    var c=$('#conv');if(c)c.appendChild(bar);sd();}
}
// 导出项目卡
function exportSub(){
  var subs=subprojOf(cur);var s=subs[curSub];if(!s){toast('项目不存在');return;}
  var p=P();var now=new Date().toLocaleString('zh-CN');var L=[];
  L.push('招引项目卡 · '+s.name.split(' · ')[0]);
  L.push('导出时间：'+now+'　|　编制：'+p.org+' · '+p.who);
  L.push('====================================================\n');
  L.push('招引方向：'+s.dir);
  L.push('来源产业方向：'+s.from);
  L.push('候选企业（脱敏）：'+(s.clueName||'暂无'));
  L.push('确认状态：干部确认 + 授权确认 已完成，已正式递交');
  L.push('当前阶段：'+stageNameOf(s, s.stage||4));
  L.push('');
  L.push('----------------------------------------------------');
  L.push('对接进度：需求已递交 → 资源匹配中 → 安排招商对接（待资源回传）');
  L.push('使用边界：脱敏展示，不显示内部人脉路径；对接由资源端线下推进，系统不自动联系企业。');
  var blob=new Blob([L.join('\n')],{type:'text/plain;charset=utf-8'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='招引项目_'+s.name.split(' · ')[0]+'.txt';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  toast('已导出项目卡：'+s.name.split(' · ')[0]);
}
// 招商对接：独立tab，展示所有项目的对接进度
/* ══════════════════════════════════════════════════════════════
   招商对接页面重建
   ══════════════════════════════════════════════════════════════ */

/* 对接记录存储 {projKey: [{ts, note, type}]} */
var DOCK_LOGS = DOCK_LOGS || {};

function pickDock(key){
  window.__dockPick=key;
  render();
}

function dockingPage(p){
  // 只显示「已正式提交的招商需求」子项目(isDemand)。父项目(城市产业分析工作区,如 sz / p*)
  // 绝不进招商对接——它的 topic 会随选中方向变化、stage 也可能被推进,之前误入导致
  // 「没提交就出现在招商对接」「线索/进度全堆到某个产业」。
  var projKeys=cityKeys().filter(function(k){return PROJECTS[k]&&PROJECTS[k].isDemand===true&&PROJECTS[k].stage>=3;});

  if(!projKeys.length){
    return '<div class="page">'+
      '<div class="page-header"><div><span class="eyebrow">DOCKING</span><h1>招商对接</h1>'+
      '<p>招引需求提交后，资源核验与对接进度会出现在这里。</p></div></div>'+
      '<div class="knowledge-scroll"><div style="text-align:center;padding:60px 20px">'+
        '<div style="font-size:36px;margin-bottom:12px">🤝</div>'+
        '<div style="font-size:15px;font-weight:700;color:#0b183b;margin-bottom:8px">尚未提交招引需求</div>'+
        '<div style="font-size:13px;color:#8492a6;line-height:1.7;margin-bottom:20px">'+
          '在「招商对接」中提交招引需求后，<br>候选线索的资源核验与对接进度会出现在这里'+
        '</div>'+
        '<button onclick="go(\'home\')" style="padding:10px 24px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:10px;font-size:13.5px;font-weight:650;cursor:pointer">前往招商对接 →</button>'+
      '</div></div></div>';
  }

  if(!window.__dockPick || !PROJECTS[window.__dockPick]) window.__dockPick=projKeys[0];
  var pk=window.__dockPick;
  var px=PROJECTS[pk];
  var clues=px.clues||[];
  var logs=DOCK_LOGS[pk]||[];

  // ── 左侧项目列表 ──
  var projectList=projKeys.map(function(k){
    var x=PROJECTS[k];
    var sc=stColor(x.stage);
    var xClues=x.clues||[];
    var teal=xClues.filter(function(c){return c.tone==='teal';}).length;
    var amber=xClues.filter(function(c){return c.tone==='amber';}).length;
    var isOn=(k===pk);
    return '<button onclick="pickDock(\''+k+'\')" style="width:100%;text-align:left;padding:12px 14px;border:1.5px solid '+(isOn?'#1a56db':'#e8edf5')+';border-radius:12px;background:'+(isOn?'#f0f4ff':'#fff')+';cursor:pointer;margin-bottom:8px">'+
      '<div style="display:flex;align-items:center;gap:10px">'+
        '<span style="font-size:18px;flex-shrink:0">🎯</span>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:13px;font-weight:700;color:#0b183b;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+x.topic+'</div>'+
          '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
            (teal?'<span style="padding:1px 7px;background:#f0fdf4;color:#166534;border-radius:10px;font-size:11px">'+teal+'条可沟通</span>':'')+
            (amber?'<span style="padding:1px 7px;background:#fffbeb;color:#92400e;border-radius:10px;font-size:11px">'+amber+'条核验中</span>':'')+
            (!teal&&!amber?'<span style="padding:1px 7px;background:#f5f7fb;color:#6b7280;border-radius:10px;font-size:11px">'+xClues.length+'条待接触</span>':'')+
          '</div>'+
        '</div>'+
        '<span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;background:'+sc.bg+';color:'+sc.c+';flex-shrink:0">'+stageNameOf(x,x.stage)+'</span>'+
      '</div>'+
    '</button>';
  }).join('');

  // ── 右侧：时间线 + 候选线索状态 + 对接记录 ──

  // 递交时间线（读 stageLog 留痕动态渲染）
  var timeline=
    '<div style="margin-bottom:20px">'+
      '<div style="font-size:12px;font-weight:650;color:#4a5568;letter-spacing:.3px;margin-bottom:12px">递交时间线</div>'+
      '<div style="display:flex;flex-direction:column;gap:0">'+stageTimelineHtml(px)+'</div>'+
    '</div>';

  // 候选企业状态
  var clueStatus=clues.length
    ? '<div style="margin-bottom:20px">'+
        '<div style="font-size:12px;font-weight:650;color:#4a5568;letter-spacing:.3px;margin-bottom:10px">候选企业线索</div>'+
        clues.map(function(c){
          var toneMap={slate:{bg:'#f5f7fb',dot:'#9aa5b5',label:'待接触'},amber:{bg:'#fffbeb',dot:'#f59e0b',label:'核验中'},teal:{bg:'#f0fdf4',dot:'#22c55e',label:'可安排沟通'}};
          var t=toneMap[c.tone]||toneMap.slate;
          return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:'+t.bg+';border-radius:10px;margin-bottom:6px">'+
            '<span style="width:8px;height:8px;border-radius:50%;background:'+t.dot+';flex-shrink:0"></span>'+
            '<div style="flex:1;min-width:0">'+
              '<div style="font-size:13px;font-weight:650;color:#0b183b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+c.name+'</div>'+
              '<div style="font-size:11.5px;color:#8492a6">'+c.kind+'</div>'+
            '</div>'+
            '<span style="padding:2px 8px;background:'+t.bg+';color:'+t.dot+';border:1px solid;border-radius:20px;font-size:11px;font-weight:600;flex-shrink:0">'+t.label+'</span>'+
          '</div>';
        }).join('')+
      '</div>'
    : '<div style="margin-bottom:20px;padding:14px;background:#f9fafb;border-radius:10px;font-size:13px;color:#9aa5b5;text-align:center">'+
        '尚无候选线索 · 在「招商对接」中发起资源核验后出现'+
      '</div>';

  // 对接记录
  var dockLogs=
    '<div>'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'+
        '<span style="font-size:12px;font-weight:650;color:#4a5568;letter-spacing:.3px">对接记录</span>'+
        '<span style="font-size:11px;color:#9aa5b5">'+logs.length+'条</span>'+
      '</div>'+
      (logs.length
        ? logs.map(function(l){
            var typeIcon={visit:'🤝',call:'📞',email:'📧',material:'📎'}[l.type]||'📝';
            return '<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #f0f4ff">'+
              '<span style="font-size:16px;flex-shrink:0">'+typeIcon+'</span>'+
              '<div style="flex:1">'+
                '<div style="font-size:12.5px;color:#1e293b;line-height:1.6">'+l.note+'</div>'+
                '<div style="font-size:11px;color:#9aa5b5;margin-top:3px">'+new Date(l.ts).toLocaleString('zh-CN')+'</div>'+
                ((l.files&&l.files.length)?'<div style="margin-top:6px;display:flex;flex-direction:column;gap:4px">'+l.files.map(function(f,fi){return '<button onclick="dockDownloadAttach(\''+pk+'\','+l.ts+','+fi+')" style="display:flex;align-items:center;gap:6px;padding:5px 9px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:7px;font-size:11.5px;color:#4338ca;cursor:pointer;text-align:left"><span>📎</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+f.name+'</span><span style="color:#9aa5b5;font-size:10.5px">↓</span></button>';}).join('')+'</div>':'')+
              '</div>'+
              '<button onclick="deleteDockLog(\''+pk+'\','+l.ts+')" title="删除这条记录" style="flex-shrink:0;width:24px;height:24px;padding:0;background:none;border:none;color:#c0c8d4;font-size:15px;cursor:pointer;border-radius:6px;line-height:1" onmouseover="this.style.background=\'#fef2f2\';this.style.color=\'#ef4444\'" onmouseout="this.style.background=\'none\';this.style.color=\'#c0c8d4\'">✕</button>'+
            '</div>';
          }).join('')
        : '<div style="font-size:12.5px;color:#9aa5b5;padding:8px 0">暂无对接记录</div>'
      )+
      // 录入区
      '<div style="margin-top:12px">'+
        '<div style="display:flex;gap:6px;margin-bottom:8px">'+
          ['visit:🤝拜访','call:📞电话','email:📧邮件','material:📎材料'].map(function(str){
            var parts=str.split(':'), val=parts[0], label=parts[1];
            return '<button onclick="setDockType(\''+pk+'\',\''+val+'\')" id="dtype-'+pk+'-'+val+'" '+
              'style="padding:5px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:12px;cursor:pointer;background:#f5f7fb;color:#4a5568">'+label+'</button>';
          }).join('')+
        '</div>'+
        '<textarea id="dock-note-'+pk+'" placeholder="记录本次沟通内容、关键信息或待跟进事项…" '+
          'style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;resize:vertical;min-height:64px;outline:none;line-height:1.6" '+
          'onfocus="this.style.border=\'1.5px solid #6366f1\'" onblur="this.style.border=\'1.5px solid #e8edf5\'"></textarea>'+
        '<input id="dock-file-'+pk+'" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg" style="display:none" onchange="dockFileSelected(\''+pk+'\',this)" />'+
        '<div id="dock-attach-'+pk+'" style="margin-top:8px"></div>'+
        '<div style="display:flex;gap:8px;margin-top:8px">'+
          '<button onclick="document.getElementById(\'dock-file-'+pk+'\').click()" '+
            'style="flex-shrink:0;padding:9px 14px;background:#fff;border:1.5px solid #c4b5fd;border-radius:8px;font-size:13px;color:#6d28d9;cursor:pointer;font-weight:600">📎 添加附件</button>'+
          '<button onclick="saveDockLog(\''+pk+'\')" '+
            'style="flex:1;padding:9px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:650;cursor:pointer">'+
            '保存对接记录</button>'+
        '</div>'+
      '</div>'+
    '</div>';


  var nextStep='';
  if(px.stage===3){
    nextStep='<div style="padding:12px 14px;background:#fffbeb;border:1.5px solid #fde68a;border-radius:12px;margin-bottom:16px">'+
      '<div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:6px">⏳ 等待资源核验启动</div>'+
      '<div style="font-size:12px;color:#4a5568;line-height:1.7">候选线索已录入，等待资源团队判断可触达路径。可在「招商对接」中点「请资源团队核验」推进。</div>'+
    '</div>';
  } else if(px.stage===4){
    nextStep='<div style="padding:12px 14px;background:#fff7ed;border:1.5px solid #fed7aa;border-radius:12px;margin-bottom:16px">'+
      '<div style="font-size:12px;font-weight:700;color:#c2410c;margin-bottom:6px">🔍 资源核验进行中（预计2个工作日）</div>'+
      '<div style="font-size:12px;color:#4a5568;line-height:1.7">政府侧待办：准备<strong>园区承接条件说明</strong>（可用厂房/能耗指标）和<strong>可用时段</strong>，核验通过后即可安排首次沟通。</div>'+
    '</div>';
  } else if(px.stage>5){
    // 管理端新增的自定义阶段：按阶段名展示，避免一直停在「可安排首次沟通」
    nextStep='<div style="padding:12px 14px;background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:12px;margin-bottom:16px">'+
      '<div style="font-size:12px;font-weight:700;color:#5b21b6;margin-bottom:6px">📅 当前阶段：'+stageNameOf(px,px.stage)+'</div>'+
      '<div style="font-size:12px;color:#4a5568;line-height:1.7">资源端已把该方向推进到「'+stageNameOf(px,px.stage)+'」，可在下方对接记录中登记进展。</div>'+
    '</div>';
  } else if(px.stage>=5){
    nextStep='<div style="padding:12px 14px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;margin-bottom:16px">'+
      '<div style="font-size:12px;font-weight:700;color:#166534;margin-bottom:6px">✓ 可安排首次沟通</div>'+
      '<div style="font-size:12px;color:#4a5568;line-height:1.7">政府侧待办：确认<strong>接待时段</strong>、准备<strong>承接方案</strong>（园区/政策/配套）。在下方填写对接记录跟踪进展。</div>'+
    '</div>';
  }

  // 查看/下载报告
  var reportActions=REPORTSTATE[pk]
    ? '<div style="display:flex;gap:8px;margin-bottom:16px">'+
        '<button onclick="cur=\''+pk+'\';viewCurrentReport()" style="flex:1;padding:9px;background:#f8faff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:12.5px;color:#1a56db;cursor:pointer;font-weight:600">📋 查看研判报告</button>'+
        '<button onclick="cur=\''+pk+'\';downloadReport(\'full\')" style="padding:9px 14px;background:#f8faff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:12.5px;color:#1a56db;cursor:pointer">⬇ 下载</button>'+
      '</div>'
    : '';

  return '<div class="page">'+
    '<div class="page-header"><div><span class="eyebrow">DOCKING</span><h1>招商对接</h1>'+
    '<p>已递交需求的核验进度与对接记录。候选企业信息均为脱敏展示，资源细节由资源团队掌握。</p></div></div>'+
    '<div style="display:grid;grid-template-columns:280px 1fr;gap:16px;height:calc(100vh - 130px);padding:0 22px 16px;overflow:hidden">'+
      // 左列
      '<div style="overflow-y:auto;padding-right:8px">'+
        '<div style="font-size:11px;font-weight:650;color:#9aa5b5;letter-spacing:.5px;margin-bottom:10px;padding-top:2px">已提交项目</div>'+
        projectList+
      '</div>'+
      // 右列
      '<div style="overflow-y:auto;padding-left:8px;border-left:1px solid #f0f4ff">'+
        nextStep+
        reportActions+
        timeline+
        dockLogs+
        '<div style="margin-top:14px;padding:10px 12px;background:#f9fafb;border-radius:8px;font-size:11.5px;color:#9aa5b5;line-height:1.6">'+
          'ⓘ 政府端展示边界：仅展示脱敏状态与下一步；企业真实名称、联系方式由资源团队保管。系统不会自动联系企业。'+
        '</div>'+
      '</div>'+
    '</div></div>';
}

/* ══════════════════════════════════════════════════════════════
   对接进度（内联）— 在「招商对接」页内展示
   在展开的项目卡片内展示：递交时间线 + 候选状态 + 对接记录
   ══════════════════════════════════════════════════════════════ */
function dockProgressInline(pk){
  var px=PROJECTS[pk]; if(!px) return '';
  var clues=px.clues||[];
  var logs=DOCK_LOGS[pk]||[];

  var timeline=
    '<div style="margin-bottom:18px">'+
      '<div style="font-size:12px;font-weight:650;color:#4a5568;letter-spacing:.3px;margin-bottom:12px">递交时间线</div>'+
      '<div style="display:flex;flex-direction:column;gap:0">'+stageTimelineHtml(px)+'</div>'+
    '</div>';

  var clueStatus=clues.length
    ? '<div style="margin-bottom:18px">'+
        '<div style="font-size:12px;font-weight:650;color:#4a5568;letter-spacing:.3px;margin-bottom:10px">候选企业线索</div>'+
        clues.map(function(c){
          var toneMap={slate:{bg:'#f5f7fb',dot:'#9aa5b5',label:'待接触'},amber:{bg:'#fffbeb',dot:'#f59e0b',label:'核验中'},teal:{bg:'#f0fdf4',dot:'#22c55e',label:'可安排沟通'}};
          var t=toneMap[c.tone]||toneMap.slate;
          return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:'+t.bg+';border-radius:10px;margin-bottom:6px">'+
            '<span style="width:8px;height:8px;border-radius:50%;background:'+t.dot+';flex-shrink:0"></span>'+
            '<div style="flex:1;min-width:0">'+
              '<div style="font-size:13px;font-weight:650;color:#0b183b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+c.name+'</div>'+
              '<div style="font-size:11.5px;color:#8492a6">'+c.kind+'</div>'+
            '</div>'+
            '<span style="padding:2px 8px;background:'+t.bg+';color:'+t.dot+';border:1px solid;border-radius:20px;font-size:11px;font-weight:600;flex-shrink:0">'+t.label+'</span>'+
          '</div>';
        }).join('')+
      '</div>'
    : '';

  var dockLogs=
    '<div>'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'+
        '<span style="font-size:12px;font-weight:650;color:#4a5568;letter-spacing:.3px">对接记录</span>'+
        '<span style="font-size:11px;color:#9aa5b5">'+logs.length+'条</span>'+
      '</div>'+
      (logs.length
        ? logs.map(function(l){
            var typeIcon={visit:'🤝',call:'📞',email:'📧',material:'📎'}[l.type]||'📝';
            return '<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #f0f4ff">'+
              '<span style="font-size:16px;flex-shrink:0">'+typeIcon+'</span>'+
              '<div style="flex:1">'+
                '<div style="font-size:12.5px;color:#1e293b;line-height:1.6">'+l.note+'</div>'+
                '<div style="font-size:11px;color:#9aa5b5;margin-top:3px">'+new Date(l.ts).toLocaleString('zh-CN')+'</div>'+
                ((l.files&&l.files.length)?'<div style="margin-top:6px;display:flex;flex-direction:column;gap:4px">'+l.files.map(function(f,fi){return '<button onclick="dockDownloadAttach(\''+pk+'\','+l.ts+','+fi+')" style="display:flex;align-items:center;gap:6px;padding:5px 9px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:7px;font-size:11.5px;color:#4338ca;cursor:pointer;text-align:left"><span>📎</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+f.name+'</span><span style="color:#9aa5b5;font-size:10.5px">↓</span></button>';}).join('')+'</div>':'')+
              '</div>'+
              '<button onclick="deleteDockLog(\''+pk+'\','+l.ts+')" title="删除这条记录" style="flex-shrink:0;width:24px;height:24px;padding:0;background:none;border:none;color:#c0c8d4;font-size:15px;cursor:pointer;border-radius:6px;line-height:1" onmouseover="this.style.background=\'#fef2f2\';this.style.color=\'#ef4444\'" onmouseout="this.style.background=\'none\';this.style.color=\'#c0c8d4\'">✕</button>'+
            '</div>';
          }).join('')
        : '<div style="font-size:12.5px;color:#9aa5b5;padding:8px 0">暂无对接记录</div>'
      )+
      '<div style="margin-top:12px">'+
        '<div style="display:flex;gap:6px;margin-bottom:8px">'+
          ['visit:🤝拜访','call:📞电话','email:📧邮件','material:📎材料'].map(function(str){
            var parts=str.split(':'), val=parts[0], label=parts[1];
            return '<button onclick="setDockType(\''+pk+'\',\''+val+'\')" id="dtype-'+pk+'-'+val+'" '+
              'style="padding:5px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:12px;cursor:pointer;background:#f5f7fb;color:#4a5568">'+label+'</button>';
          }).join('')+
        '</div>'+
        '<textarea id="dock-note-'+pk+'" placeholder="记录本次沟通内容、关键信息或待跟进事项…" '+
          'style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;resize:vertical;min-height:64px;outline:none;line-height:1.6" '+
          'onfocus="this.style.border=\'1.5px solid #6366f1\'" onblur="this.style.border=\'1.5px solid #e8edf5\'"></textarea>'+
        '<input id="dock-file-'+pk+'" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg" style="display:none" onchange="dockFileSelected(\''+pk+'\',this)" />'+
        '<div id="dock-attach-'+pk+'" style="margin-top:8px"></div>'+
        '<div style="display:flex;gap:8px;margin-top:8px">'+
          '<button onclick="document.getElementById(\'dock-file-'+pk+'\').click()" '+
            'style="flex-shrink:0;padding:9px 14px;background:#fff;border:1.5px solid #c4b5fd;border-radius:8px;font-size:13px;color:#6d28d9;cursor:pointer;font-weight:600">📎 添加附件</button>'+
          '<button onclick="saveDockLog(\''+pk+'\')" '+
            'style="flex:1;padding:9px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:650;cursor:pointer">'+
            '保存对接记录</button>'+
        '</div>'+
      '</div>'+
    '</div>';


  var nextStep='';
  if(px.stage===3){
    nextStep='<div style="padding:12px 14px;background:#fffbeb;border:1.5px solid #fde68a;border-radius:12px;margin-bottom:16px">'+
      '<div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:6px">⏳ 等待资源核验启动</div>'+
      '<div style="font-size:12px;color:#4a5568;line-height:1.7">候选线索已录入，等待资源团队判断可触达路径。可点上方进度条推进阶段。</div>'+
    '</div>';
  } else if(px.stage===4){
    nextStep='<div style="padding:12px 14px;background:#fff7ed;border:1.5px solid #fed7aa;border-radius:12px;margin-bottom:16px">'+
      '<div style="font-size:12px;font-weight:700;color:#c2410c;margin-bottom:6px">🔍 资源核验进行中（预计2个工作日）</div>'+
      '<div style="font-size:12px;color:#4a5568;line-height:1.7">政府侧待办：准备<strong>园区承接条件说明</strong>（可用厂房/能耗指标）和<strong>可用时段</strong>，核验通过后即可安排首次沟通。</div>'+
    '</div>';
  } else if(px.stage>5){
    // 管理端新增的自定义阶段：按阶段名展示，避免一直停在「可安排首次沟通」
    nextStep='<div style="padding:12px 14px;background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:12px;margin-bottom:16px">'+
      '<div style="font-size:12px;font-weight:700;color:#5b21b6;margin-bottom:6px">📅 当前阶段：'+stageNameOf(px,px.stage)+'</div>'+
      '<div style="font-size:12px;color:#4a5568;line-height:1.7">资源端已把该方向推进到「'+stageNameOf(px,px.stage)+'」，可在下方对接记录中登记进展。</div>'+
    '</div>';
  } else if(px.stage>=5){
    nextStep='<div style="padding:12px 14px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;margin-bottom:16px">'+
      '<div style="font-size:12px;font-weight:700;color:#166534;margin-bottom:6px">✓ 可安排首次沟通</div>'+
      '<div style="font-size:12px;color:#4a5568;line-height:1.7">政府侧待办：确认<strong>接待时段</strong>、准备<strong>承接方案</strong>（园区/政策/配套）。在下方填写对接记录跟踪进展。</div>'+
    '</div>';
  }

  return '<div id="dockInline-'+pk+'" style="margin-top:16px;padding:16px;background:#fbfcff;border:1.5px solid #e8edf5;border-radius:12px">'+
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">'+
      '<span style="font-size:16px">🤝</span>'+
      '<span style="font-size:13.5px;font-weight:700;color:#0b183b">招商对接进度</span>'+
    '</div>'+
    nextStep+
    timeline+
    dockLogs+
  '</div>';
}

/* ── 对接记录辅助函数 ── */
var __dockType = {};
function setDockType(projKey, type){
  __dockType[projKey] = type;
  // 更新按钮样式
  ['visit','call','email','material'].forEach(function(t){
    var btn=document.getElementById('dtype-'+projKey+'-'+t);
    if(!btn) return;
    btn.style.background = t===type ? '#eff6ff' : '#f5f7fb';
    btn.style.borderColor = t===type ? '#bfdbfe' : '#e8edf5';
    btn.style.color = t===type ? '#1a56db' : '#4a5568';
  });
}

// 待保存的附件暂存（按项目）
var __dockFiles = {};
function dockFileSelected(projKey, inp){
  var files=Array.from(inp.files||[]);
  if(!files.length) return;
  if(!__dockFiles[projKey]) __dockFiles[projKey]=[];
  var pending=files.length;
  files.forEach(function(f){
    var reader=new FileReader();
    reader.onload=function(){
      __dockFiles[projKey].push({name:f.name, size:f.size, dataUrl:reader.result});
      pending--;
      if(pending===0) renderDockAttachDraft(projKey);
    };
    reader.readAsDataURL(f);
  });
  // 选材料附件时自动把类型切到"材料"
  setDockType(projKey,'material');
}
function renderDockAttachDraft(projKey){
  var box=document.getElementById('dock-attach-'+projKey);
  if(!box) return;
  var arr=__dockFiles[projKey]||[];
  if(!arr.length){ box.innerHTML=''; return; }
  box.innerHTML=arr.map(function(f,i){
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;margin-bottom:6px">'+
      '<span style="font-size:13px">📎</span>'+
      '<span style="flex:1;min-width:0;font-size:12px;color:#4338ca;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+f.name+'</span>'+
      '<span style="font-size:11px;color:#9aa5b5">'+dockFileSize(f.size)+'</span>'+
      '<button onclick="removeDockDraftFile(\''+projKey+'\','+i+')" title="移除" style="background:none;border:none;color:#c0c8d4;font-size:14px;cursor:pointer;padding:0 2px">\u2715</button>'+
    '</div>';
  }).join('');
}
function removeDockDraftFile(projKey, idx){
  if(!__dockFiles[projKey]) return;
  __dockFiles[projKey].splice(idx,1);
  renderDockAttachDraft(projKey);
}
function dockFileSize(b){
  if(b==null) return '';
  if(b<1024) return b+'B';
  if(b<1048576) return (b/1024).toFixed(0)+'KB';
  return (b/1048576).toFixed(1)+'MB';
}
function dockDownloadAttach(projKey, ts, idx){
  var logs=DOCK_LOGS[projKey]||[];
  var l=logs.filter(function(x){return x.ts===ts;})[0];
  if(!l||!l.files||!l.files[idx]) return;
  var f=l.files[idx];
  var a=document.createElement('a');
  a.href=f.dataUrl; a.download=f.name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function saveDockLog(projKey){
  var ta=document.getElementById('dock-note-'+projKey);
  var files=__dockFiles[projKey]||[];
  var note=ta?ta.value.trim():'';
  if(!note && !files.length){toast('请填写对接记录内容或添加附件');return;}
  if(!DOCK_LOGS[projKey]) DOCK_LOGS[projKey]=[];
  DOCK_LOGS[projKey].unshift({
    ts: Date.now(),
    note: note||'（附件）',
    type: __dockType[projKey]||'visit',
    files: files.slice()
  });
  persist();
  if(ta) ta.value='';
  __dockFiles[projKey]=[];
  refreshDockInline(projKey);
  toast('\u2713 对接记录已保存');
}

// 局部刷新对接进度区，避免整页 render 导致滚动跳回顶部
function refreshDockInline(projKey){
  var box=document.getElementById('dockInline-'+projKey);
  if(box){ box.outerHTML=dockProgressInline(projKey);
    // 恢复已选择的记录类型高亮
    if(__dockType[projKey]) setDockType(projKey,__dockType[projKey]);
  } else { render(); }
}

// 删除一条对接记录
function deleteDockLog(projKey, ts){
  if(!DOCK_LOGS[projKey]) return;
  DOCK_LOGS[projKey]=DOCK_LOGS[projKey].filter(function(l){return l.ts!==ts;});
  persist();
  refreshDockInline(projKey);
  toast('已删除该对接记录');
}
function ctxBar(icon,strong,span){
  return '<div class="context-bar"><div class="context-icon"><i class="i">'+icon+'</i></div>'+
    '<div><strong>'+strong+'</strong><span>'+span+'</span></div>'+
    '<span class="context-fresh"><i class="i">🕒</i>今日 06:00 已更新</span></div>';
}
function composer(){
  var sub=view==='subwork';
  var isKb=view==='knowledge';
  var activeTopic=null;
  if(isKb){var b=document.getElementById('kbTopicBadge');
    if(b){var tel=b.querySelectorAll('div>div');tel.forEach(function(d){if(d.style&&d.fontSize==='13px')activeTopic=d.textContent.trim();});
      if(!activeTopic){var els=b.querySelectorAll('div');els.forEach(function(d){if(d.textContent&&d.textContent.length>4&&d.textContent.length<20)activeTopic=d.textContent.trim();});}
    }
  }
  var pillColors={'主导产业与产业链':'background:#eff6ff;color:#1d4ed8;border:1.5px solid #bfdbfe',
    '园区与承载条件':'background:#f0fdf4;color:#166534;border:1.5px solid #bbf7d0',
    '链主与存量企业':'background:#fdf4ff;color:#6b21a8;border:1.5px solid #e9d5ff',
    '政策、规划与领导关注':'background:#fffbeb;color:#92400e;border:1.5px solid #fde68a'};
  var topicPill='';
  if(isKb&&activeTopic){
    var ps=pillColors[activeTopic]||'background:#f5f7fb;color:#4a5568;border:1.5px solid #e8edf5';
    topicPill='<div style="display:flex;align-items:center;gap:6px;padding:6px 14px 2px">'+
      '<span style="font-size:11px;color:#9aa5b5">正在询问：</span>'+
      '<span style="padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600;'+ps+'">'+activeTopic+'</span>'+
      '<button onclick="clearKbActiveTopic()" style="background:none;border:none;color:#b0bac8;font-size:13px;cursor:pointer;padding:0 3px" title="取消">✕</button>'+
    '</div>';
  }
  var ph=isKb&&activeTopic?'针对「'+activeTopic+'」提问，我会优先检索该主题数据…':
      isKb?'直接输入问题，例如：'+P().city+'补链的核心缺口有哪些？':
      sub?'针对本项目：让我起草对接方案、列核验清单、写领导汇报，或补充招引环节…':
      '可直接描述产业方向、细分环节、目标企业或领导交办任务，我会结合城市智库与最新公开信息研判…';
  return '<div class="composer-wrap">'+topicPill+'<div class="composer">'+
    '<div class="composer-tools">'+
      '<button onclick="uploadHint()"><i class="i"></i>上传材料</button>'+
      (isKb&&activeTopic?'<button onclick="clearKbActiveTopic()"><i class="i">⌂</i>全局问答</button>':'')+
      '<button onclick="go(\'knowledge\')"><i class="i"></i>'+P().city+'城市智库</button></div>'+
    '<textarea id="composerTa" placeholder="'+ph+'"></textarea>'+
    '<button class="send-button" onclick="sendMsg()"><i class="i">➤</i></button></div>'+
    '<div class="composer-helper"><span>支持上传：政府工作报告 / 领导发言稿 / 产业报告 / 园区资料 / 企业名单</span>'+
    '<button onclick="uploadHint()">查看建议材料清单</button></div></div>';
}

function renderComposer(){
  var wrap=document.querySelector('.composer-wrap');
  if(!wrap)return;
  var tmp=document.createElement('div');
  tmp.innerHTML=composer();
  wrap.replaceWith(tmp.firstChild);
  bind();
}

/* topic helpers */
function editTopic(){
  var d=document.getElementById('topicDisplay');
  var e=document.getElementById('topicEdit');
  var inp=document.getElementById('topicInput');
  if(d)d.style.display='none';
  if(e)e.style.display='block';
  if(inp){inp.focus();inp.select();}
}
function saveTopic(){
  var inp=document.getElementById('topicInput');
  var t=inp&&inp.value.trim();
  if(!t)return;
  var p=P();if(!p)return;
  p.topic=t; persist();
  var txt=document.getElementById('topicText');
  if(txt)txt.textContent=t;
  cancelTopicEdit();
  toast('\u2713 \u7814\u5224\u65b9\u5411\u5df2\u66f4\u65b0\u4e3a\u300c'+t+'\u300d');
}
function cancelTopicEdit(){
  var d=document.getElementById('topicDisplay');
  var e=document.getElementById('topicEdit');
  if(d)d.style.display='flex';
  if(e)e.style.display='none';
}

/* ── 产业分析页辅助函数 ── */

// 选择研判方向（卡片点击 or 自定义输入）
function selectTopic(val, isCustom){
  var p=P(); if(!p||!val||!val.trim()) return;
  // 自定义方向落库：存进 customTopics，保证日后顶部方向卡片持久显示、可切回找到报告
  if(isCustom){
    if(!p.customTopics) p.customTopics=[];
    var _v=val.trim();
    if(p.customTopics.indexOf(_v)<0) p.customTopics.push(_v);
    // 重新添加时从已删除列表移除，否则会被过滤不显示
    if(p.deletedTopics){ p.deletedTopics=p.deletedTopics.filter(function(d){return d!==_v;}); }
  }
  // 切换方向前：把当前方向的待确认事项存回该方向的桶
  if(cur && REPORTSTATE[cur]){
    if(!REPORTSTATE[cur].pendingByTopic) REPORTSTATE[cur].pendingByTopic={};
    var _oldTopic=p.topic;
    if(_oldTopic && typeof PENDING_CONFIRMS!=='undefined' && PENDING_CONFIRMS[cur])
      REPORTSTATE[cur].pendingByTopic[_oldTopic]=PENDING_CONFIRMS[cur];
  }
  // 方向级进度：切换前先保存当前方向的进度阶段
  if(!p.stageByTopic) p.stageByTopic={};
  if(p.topic!=null && p.stage!=null) p.stageByTopic[p.topic]=p.stage;
  p.topic=val.trim();
  // 加载新方向的独立进度阶段（新方向默认从「AI 研判」起步，资料准备为城市级共享已完成）
  if(p.stageByTopic[p.topic]!=null){ p.stage=p.stageByTopic[p.topic]; }
  else { p.stage=2; p.stageByTopic[p.topic]=p.stage; }
  // 切换后：加载新方向的待确认事项（无缓存则从该方向报告文本解析）
  if(cur && REPORTSTATE[cur]){
    var _pb=REPORTSTATE[cur].pendingByTopic||{};
    var _np=_pb[p.topic];
    if(!_np||!_np.length){
      var _rtxt=getTopicReport(p.topic)||'';
      _np=parsePendingItems(_rtxt);
    }
    PENDING_CONFIRMS[cur]=_np||[];
    if(!REPORTSTATE[cur].pendingByTopic) REPORTSTATE[cur].pendingByTopic={};
    REPORTSTATE[cur].pendingByTopic[p.topic]=PENDING_CONFIRMS[cur];
  }
  persist();
  var badge=document.getElementById('currentTopicBadge');
  if(badge) badge.textContent=p.topic;
  var _tbTopic=document.getElementById('topbarTopic');
  if(_tbTopic) _tbTopic.textContent=p.topic;
  if(!isCustom){
    var inp=document.getElementById('topicCustomInput');
    if(inp) inp.value='';
  }
  // 同步刷新报告区（切换方向时换报告文本+图谱）
  var _ra=document.getElementById('reportArea');
  if(_ra){
    var _rs=REPORTSTATE[cur];
    // 该方向是否已有报告（AI/预埋/当前/历史），据此决定渲染报告 or 空状态。
    // 修复：切到从未生成过报告的新方向时，不再沿用旧方向(如香菇)的报告文本。
    var _nt=reportTextForTopic(p.topic);
    var _hasPend=(PENDING_CONFIRMS[cur]&&PENDING_CONFIRMS[cur].length);
    if(_rs&&(_nt||_hasPend)){
      // 用方向级 phase 同步项目级 phase，避免"切到新方向仍停在旧方向 phase=2"污染确认面板/按钮
      if(_nt){ _rs.text=_nt; }
      else { _rs.text=''; }
      _rs.topic=p.topic;
      _rs.phase=(_rs.phaseByTopic&&_rs.phaseByTopic[p.topic])||((_nt&&_nt.length>1000)?2:1);
      // 后台从 RAG 生成该方向真实 AI 报告（预埋占位，就绪后替换）
      ensureAiReport(p.topic, p.city);
      setReportAreaHtml(_ra,reportHtml(p));
      var _cmEl=document.getElementById('chainMapBlock');
      if(_cmEl){ _cmEl.innerHTML=chainMapHtml(p); }
      else{
        var _cm2=document.createElement('div');
        _cm2.id='chainMapBlock';
        _cm2.innerHTML=chainMapHtml(p);
        _ra.appendChild(_cm2);
      }
      // 恢复当前方向的招引方向卡片
      var _aiEl=document.getElementById('actionItemsBlock');
      if(!_aiEl){_aiEl=document.createElement('div');_aiEl.id='actionItemsBlock';_ra.appendChild(_aiEl);}
      _aiEl.innerHTML=restoreActionItems();
      // 恢复确认面板
      if(!document.getElementById('confirmPanel-'+cur)){
        var _cpHtml=restoreConfirmPanel();
        if(_cpHtml){var _cpDiv=document.createElement('div');_cpDiv.innerHTML=_cpHtml;while(_cpDiv.firstChild){_ra.appendChild(_cpDiv.firstChild);}}
      }
    } else {
      // 当前方向无报告，清空报告区显示空状态
      _ra.innerHTML='<div id="reportHistoryArea"></div>'+
        '<div style="text-align:center;padding:48px 20px">'+
          '<div style="font-size:40px;margin-bottom:12px">📊</div>'+
          '<div style="font-size:15px;font-weight:700;color:#0b183b;margin-bottom:8px">'+
            '选择上方产业分析方向，点击「产业智能分析」'+
          '</div>'+
          '<div style="font-size:12.5px;color:#8492a6;line-height:1.6">'+
            '基于城市智库数据，AI 将自动生成产业链分析报告'+
          '</div>'+
        '</div>';
    }
  }
  // 同步刷新右侧面板（报告状态·研判方向）
  var _dp=document.querySelector('.detail-pane');
  if(_dp){
    _dp.innerHTML='<button class="collapse-detail" onclick="toggleDetail()"><i class="i">✕</i></button>'+
      '<div class="detail-page">'+detailReport(p)+'</div>';
  }
  // 刷新历史报告（只显示当前方向的）
  var _ra2=document.getElementById('reportArea');
  if(_ra2){
    var _ha2=document.getElementById('reportHistoryArea');
    if(!_ha2){ _ha2=document.createElement('div'); _ha2.id='reportHistoryArea'; _ra2.insertBefore(_ha2, _ra2.firstChild); }
    renderHistoryReports(cur, p.topic);
  }
  // 切换方向后刷新底部行动栏（按新方向重判：产业智能分析 / 重新产业分析）
  var _bb=document.querySelector('.report-bottom-bar');
  if(_bb) _bb.innerHTML=reportBottomBarInner(p);
  // 刷新底部进度条（按新方向的独立阶段渲染）
  var _pf=document.querySelector('.progress-footer');
  if(_pf) _pf.outerHTML=progressFooter(p);
  // 重渲染卡片高亮
  var cardGrid=document.getElementById('topicCardGrid');
  if(!cardGrid) return;
  var topics=generateTopicsFromKb(p);
  cardGrid.innerHTML=topics.map(function(t){
    return topicCardHtml(t, p.topic===t.label);
  }).join('');
}

// 触发生成报告
/* ══════════════════════════════════════════════════════════════
   产业分析 — 待确认事项结构化面板
   流程：进入页面自动触发草稿 → 解析⚠️ → 渲染确认面板 → 全部确认后解锁完整报告
   ══════════════════════════════════════════════════════════════ */

// 待确认事项状态 {projKey: [{text, status:'pending'|'confirmed'|'edited', editedText, files:[]}]}
var PENDING_CONFIRMS = PENDING_CONFIRMS || {};

/* 解析草稿文本，提取待确认事项。兼容两种格式：
   ① 列表：每条一行（可能以 ⚠️/•/- 开头）
   ② markdown 表格：|序号|待确认事项|影响|关联决策|  —— 需跳过表头/分隔行，只取「待确认事项」列 */
function parsePendingItems(text){
  var items = [];
  var lines = text.split('\n');
  var inPending = false;
  var tableItemCol = -1;   // 表格中「待确认事项」列的索引；-1 表示尚未确定
  function stripMd(s){
    return (s||'').replace(/\*\*/g,'').replace(/^⚠️?\s*[:：]?/,'').replace(/^⚠\s*[:：]?/,'').trim();
  }
  lines.forEach(function(line){
    var raw = line.trim();
    var clean = line.replace(/^[\s\-•*]+/, '').trim();
    if(!clean) return;
    // 章节标题行：一、/① 开头，或 ## / ### 开头
    var isHead = /^([一二三四五六七八九十]+[、．.]|[①②③④⑤⑥⑦⑧⑨⑩]|#{1,3}\s)/.test(clean);
    if(isHead){
      // 进入「待确认」章节：兼容 draft 的「③待确认：」与 full 报告的「五、待确认事项」
      inPending = /待确认/.test(clean);
      tableItemCol = -1;   // 切换章节时重置表格列定位
      return;
    }
    if(!inPending) return;

    // ── markdown 表格行处理 ──
    if(raw.indexOf('|') >= 0){
      // 分隔行 |:---:|---|：整行只由 | - : 空格组成 → 跳过
      if(/^\|?[\s:\-|]+\|?$/.test(raw)) return;
      var cells = raw.replace(/^\|/,'').replace(/\|$/,'').split('|').map(function(c){return c.trim();});
      // 表头行：含「待确认事项」或「序号」等列名 → 记录目标列后跳过，不作为条目
      var headerIdx = cells.findIndex(function(c){return /待确认事项|确认事项|事项/.test(c) && c.length<=8;});
      var looksHeader = headerIdx>=0 || cells.some(function(c){return /^序号$|^影响$|^关联决策$/.test(c);});
      if(looksHeader){ if(headerIdx>=0) tableItemCol=headerIdx; return; }
      // 数据行：优先取「待确认事项」列，否则取最长的非纯符号单元格
      var pick='';
      if(tableItemCol>=0 && cells[tableItemCol]) pick=cells[tableItemCol];
      if(!pick){
        cells.forEach(function(c){
          var cc=stripMd(c);
          if(cc.length>pick.length && !/^[✅❌⚠️\d\s]*$/.test(cc)) pick=cc;
        });
      }
      var t = stripMd(pick);
      if(t.length>=2 && !/^[✅❌]/.test(t)) items.push({text:t, status:'pending', editedText:'', files:[]});
      return;
    }

    // ── 普通列表行 ──
    var t2 = stripMd(clean);
    if(/^[✅❌]/.test(t2)) return;
    if(t2.length >= 2) items.push({text: t2, status:'pending', editedText:'', files:[]});
  });
  // 兜底：如果未找到待确认章节内的条目，则提取所有含⚠️的行作为待确认
  if(!items.length){
    lines.forEach(function(line){
      var raw=line.trim();
      if(raw.indexOf('\u26a0\ufe0f')>=0 || raw.indexOf('\u26a0')>=0){
        var clean=raw.replace(/^[\s\-•*|#]+/,'').replace(/\*\*/g,'').replace(/^\u26a0\ufe0f?\s*[:：]?/,'').trim();
        if(clean.length>8 && clean.length<200){
          var seen2=items.some(function(it){return it.text===clean;});
          if(!seen2) items.push({text:clean,confirmed:false,status:'pending',editedText:'',files:[]});
        }
      }
    });
  }
  return items;
}


/* ══ 报告历史记录 ══ */
var REPORT_HISTORY = REPORT_HISTORY || {};

function saveReportHistory(){try{localStorage.setItem('hxz_rpt_history',JSON.stringify(REPORT_HISTORY));}catch(e){}}
function loadReportHistory(){try{var d=localStorage.getItem('hxz_rpt_history');if(d)REPORT_HISTORY=JSON.parse(d);}catch(e){}}
loadReportHistory();
// 补充：从 aiReportByTopic 构建历史（解决 rs.text 清空后历史报告为空的问题）
function getReportHistoryForProject(key){
  var rs=REPORTSTATE[key]; if(!rs) return [];
  // 优先用 aiReportByTopic 构建（每个有完整报告的方向是一条历史）
  var fromAi=[];
  if(rs.aiReportByTopic){
    Object.keys(rs.aiReportByTopic).forEach(function(t){
      var txt=rs.aiReportByTopic[t];
      if(!txt || txt.length<=100) return;
      // score/phase/ts 必须按方向读，否则历史卡片会显示 0% 与错误时间/阶段（fix 2026-08-28）
      var _phase = (rs.phaseByTopic && rs.phaseByTopic[t]) || (rs.topic===t ? rs.phase : 2) || 2;
      var _score;
      // 【2026-09-21】回退重算必须带 key：否则历史卡片会用当前项目的数据
      //   为别的项目算分，同一报告又多出第三个置信度。
      if(rs.scoreByTopic && rs.scoreByTopic[t]!=null) _score=rs.scoreByTopic[t];
      else if(rs.topic===t && rs.score!=null) _score=rs.score;
      else { try{ _score=topicScore(t, key); }catch(e){ _score=0; } }
      // 【2026-09-21】ts 缺失时原来兜底 Date.now()，导致该历史卡每次渲染都显示「刚刚」
      //   （实测 1.5 秒内两次取值不同）。改为回退到项目级 ts，仍缺失才用当前时间并标记。
      var _ts = (rs.tsByTopic && rs.tsByTopic[t]) || (rs.topic===t ? rs.ts : 0) || rs.ts || 0;
      fromAi.push({topic:t, text:txt, rep:txt, ts:_ts, score:_score, phase:_phase});
    });
  }
  // 合并 REPORT_HISTORY（去重）
  var hist=REPORT_HISTORY[key]||[];
  var merged=fromAi.slice();
  hist.forEach(function(h){
    if(h.text && h.text.length>100 && !merged.some(function(m){return m.topic===h.topic;})){
      merged.push(h);
    }
  });
  return merged;
}

function archiveCurrentReport(key){
  var rs=REPORTSTATE[key];
  if(!rs) return; // 首次生成报告时 REPORTSTATE[key] 尚不存在，归档旧报告时可能为空
  var _archTxt=(rs.aiReportByTopic&&rs.topic)?rs.aiReportByTopic[rs.topic]||rs.text:''; if(!_archTxt) return;
  if(!REPORT_HISTORY[key]) REPORT_HISTORY[key]=[];
  // 避免重复归档（同 ts）
  var exists=REPORT_HISTORY[key].some(function(h){return h.ts===rs.ts;});
  if(!exists){
    REPORT_HISTORY[key].unshift({text:_archTxt,topic:rs.topic, rep:_archTxt,ts:rs.ts,score:rs.score,phase:rs.phase});
    if(REPORT_HISTORY[key].length>10) REPORT_HISTORY[key]=REPORT_HISTORY[key].slice(0,10);
    saveReportHistory();
  }
}

function deleteHistoryReport(key, idx){
  if(!REPORT_HISTORY[key]) return;
  var _h=REPORT_HISTORY[key][idx]; var _label=_h&&_h.topic?('「'+_h.topic+'」'):'该条';
  if(!confirm('确定删除'+_label+'历史报告？删除后无法恢复。')) return;
  REPORT_HISTORY[key].splice(idx,1);
  saveReportHistory();
  renderHistoryReports(key);
}

function toggleHistoryReport(key, idx){
  var body=document.getElementById('hrpt-body-'+key+'-'+idx);
  var ico=document.getElementById('hrpt-ico-'+key+'-'+idx);
  if(!body) return;
  var open=body.style.display!=='none';
  body.style.display=open?'none':'block';
  if(ico) ico.textContent=open?'▶':'▼';
}

var _histShowAll = false;  // 历史报告区：false=仅当前方向，true=该城市全部方向
function toggleHistShowAll(){ _histShowAll=!_histShowAll; var k=cur; if(k) renderHistoryReports(k); }
function renderHistoryReports(key, topicFilter){
  var container=document.getElementById('reportHistoryArea');
  if(!container) return;
  var p=P();
  var currentTopic=topicFilter || (p?p.topic:'');
  var allReports=getReportHistoryForProject(key);
  var totalCount=allReports.length;
  // 携带原始索引（删除/展开用），再按时间降序排序
  var list=allReports.map(function(rep,oi){return {rep:rep,oi:oi};});
  // _histShowAll=true 时列出该城市全部方向的历史（含自定义方向），否则只看当前方向
  if(currentTopic && !_histShowAll) list=list.filter(function(x){
    if(x.rep.topic===currentTopic) return true;
    // 模糊匹配：核心关键词重叠>60%视为同方向
    var a=currentTopic.replace(/[补链引入引育升级招商培育系统软硬件本地配套软性Tier1]/g,'');
    var b=(x.rep.topic||'').replace(/[补链引入引育升级招商培育系统软硬件本地配套软性Tier1]/g,'');
    var overlap=0; for(var i=0;i<a.length;i++){if(b.indexOf(a[i])>=0)overlap++;}
    return a.length>0&&overlap/a.length>0.6;
  });
  list.sort(function(a,b){return (b.rep.ts||0)-(a.rep.ts||0);});
  // 无任何历史报告则整块隐藏；有历史但当前方向为空时仍显示切换入口
  if(!totalCount){container.innerHTML='';return;}
  var otherCount=totalCount-list.length;
  var h='<div style="margin-bottom:12px">';
  h+='<div style="font-size:11.5px;font-weight:700;color:#64748b;letter-spacing:.3px;margin-bottom:6px;display:flex;align-items:center;gap:6px">';
  h+='<span style="display:inline-block;width:3px;height:12px;background:#94a3b8;border-radius:2px"></span>';
  h+='<span>历史报告（'+list.length+' 份）</span>';
  // 全部方向 / 仅当前方向 切换
  h+='<button onclick="toggleHistShowAll()" style="margin-left:auto;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid '+(_histShowAll?'#1a56db':'#cbd5e1')+';background:'+(_histShowAll?'#eff6ff':'#fff')+';color:'+(_histShowAll?'#1d4ed8':'#64748b')+'">'+
    (_histShowAll?'✓ 全部方向（'+totalCount+'）':'查看全部方向'+(totalCount>list.length?'（'+totalCount+'）':''))+'</button>';
  h+='</div>';
  if(!list.length){
    container.innerHTML=h+'<div style="font-size:11.5px;color:#94a3b8;padding:8px 2px">当前方向暂无历史报告。点上方「查看全部方向」可查看该城市其他方向（含自定义方向）的历史报告。</div></div>';
    return;
  }
  list.forEach(function(x,i){
    var rep=x.rep; var oi=x.oi;
    var dt=rep.ts?new Date(rep.ts).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'未知时间';
    var phaseLabel=rep.phase===2?'完整报告':'初步草稿';
    var phaseColor=rep.phase===2?'#1d4ed8':'#92400e';
    var phaseBg=rep.phase===2?'#dbeafe':'#fef3c7';
    h+='<div style="border-radius:12px;border:1.5px solid #e2e8f0;overflow:hidden;margin-bottom:6px;background:#fff">';
    // 折叠头（DOM id 与删除均用原始索引 oi，避免"全部方向"排序后删错报告）
    h+='<div style="padding:10px 14px;background:#f8faff;display:flex;align-items:center;gap:8px;cursor:pointer" onclick="toggleHistoryReport(\''+key+'\','+oi+')">';
    h+='<span id="hrpt-ico-'+key+'-'+oi+'" style="font-size:10px;color:#94a3b8;flex-shrink:0">▶</span>';
    h+='<span style="font-size:11px;padding:1px 7px;border-radius:10px;background:'+phaseBg+';color:'+phaseColor+';font-weight:700">'+phaseLabel+'</span>';
    h+='<span style="font-size:12px;font-weight:600;color:#374151;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+rep.topic+'</span>';
    h+='<span style="font-size:11px;color:#94a3b8;flex-shrink:0">'+dt+'</span>';
    if(rep.score!=null) h+='<span style="font-size:11px;color:#64748b;flex-shrink:0;margin-left:4px">'+rep.score+'%</span>';
    // 全部方向模式下，点报告可一键切回该方向
    h+='<button onclick="event.stopPropagation();selectTopic(\''+String(rep.topic).replace(/'/g,"\\'")+'\')" title="切到该方向" style="flex-shrink:0;margin-left:6px;padding:2px 8px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;font-size:11px;color:#1d4ed8;cursor:pointer;font-weight:600">切到此方向</button>';
    h+='<button onclick="event.stopPropagation();deleteHistoryReport(\''+key+'\','+oi+')" style="flex-shrink:0;margin-left:4px;padding:2px 8px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;font-size:11px;color:#ef4444;cursor:pointer;font-weight:600">删除</button>';
    h+='</div>';
    // 折叠体（默认收起）
    h+='<div id="hrpt-body-'+key+'-'+oi+'" style="display:none;padding:14px 16px;font-size:12.5px;color:#1e293b;line-height:1.8;border-top:1px solid #f0f4ff;max-height:400px;overflow-y:auto">';
    // 简单 markdown 渲染
    var txt=rep.text||'';
    txt=txt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    txt=txt.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
    txt=txt.replace(/^#{1,3}\s(.+)$/gm,'<div style="font-weight:700;color:#0b183b;margin:8px 0 3px">$1</div>');
    txt=txt.replace(/^[-•]\s(.+)$/gm,'<div style="padding-left:12px;margin:2px 0">· $1</div>');
    txt=txt.replace(/\n\n/g,'<br>');
    h+=txt;
    h+='</div>';
    h+='</div>';
  });
  h+='</div>';
  container.innerHTML=h;
}

/* 渲染待确认面板（插在草稿下方） */
function renderConfirmPanel(items, projKey){
  if(!items || !items.length) return '';

  var rows = items.map(function(item, idx){
    var isDone = item.status === 'confirmed' || item.status === 'edited';
    var displayText = item.editedText || item.text;
    var filesBadge = item.files && item.files.length
      ? '<span style="margin-left:6px;padding:1px 7px;background:#f0fdf4;color:#166534;border-radius:10px;font-size:10.5px;border:1px solid #86efac">'+item.files.length+' 个附件</span>'
      : '';

    if(isDone){
      return '<div id="ci-'+projKey+'-'+idx+'" style="display:flex;gap:10px;align-items:flex-start;padding:12px 14px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px">'+
        '<span style="color:#22c55e;font-size:16px;flex-shrink:0;margin-top:1px">✓</span>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:13px;color:#14532d;line-height:1.65">'+displayText+filesBadge+'</div>'+
          (item.status==='edited'?'<div style="font-size:11px;color:#22c55e;margin-top:3px">已修改并确认</div>':'<div style="font-size:11px;color:#22c55e;margin-top:3px">已确认</div>')+
        '</div>'+
        '<button onclick="uncfmItem(\''+projKey+'\','+idx+')" style="padding:3px 8px;background:none;border:1px solid #86efac;border-radius:6px;font-size:11px;color:#22c55e;cursor:pointer;flex-shrink:0">撤回</button>'+
      '</div>';
    }

    return '<div id="ci-'+projKey+'-'+idx+'" style="border-radius:12px;background:#fffbeb;border:1.5px solid #fed7aa;overflow:hidden;transition:box-shadow .2s" onmouseenter="this.style.boxShadow=\'0 2px 8px rgba(245,158,11,0.15)\'" onmouseleave="this.style.boxShadow=\'none\'">'+
      '<div style="padding:13px 15px">'+
        '<div style="display:flex;gap:10px;align-items:flex-start">'+
          '<span style="flex-shrink:0;width:22px;height:22px;background:#fef3c7;border:1.5px solid #fcd34d;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;margin-top:1px">⚠️</span>'+
          '<div id="ci-text-'+projKey+'-'+idx+'" style="flex:1;font-size:13px;color:#78350f;line-height:1.7;font-weight:500">'+displayText+'</div>'+
        '</div>'+
        // 编辑框（默认隐藏）
        '<div id="ci-edit-'+projKey+'-'+idx+'" style="display:none;margin-top:10px">'+
          '<textarea id="ci-ta-'+projKey+'-'+idx+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #6366f1;border-radius:8px;font-size:13px;color:#1e293b;resize:vertical;min-height:64px;outline:none;line-height:1.6">'+displayText+'</textarea>'+
          // 附件上传
          '<div id="ci-drop-'+projKey+'-'+idx+'" '+
            'onclick="ciPickFile(\''+projKey+'\','+idx+')" '+
            'ondragover="event.preventDefault();this.style.background=\'#eef2ff\'" '+
            'ondragleave="this.style.background=\'#f8faff\'" '+
            'ondrop="ciDropFile(event,\''+projKey+'\','+idx+')" '+
            'style="margin-top:8px;padding:10px;border:1.5px dashed #c7d2fe;border-radius:8px;text-align:center;cursor:pointer;background:#f8faff;font-size:12px;color:#6366f1">'+
            '<span id="ci-file-hint-'+projKey+'-'+idx+'">📎 上传附件（可选，拖拽或点击）</span>'+
          '</div>'+
          '<input id="ci-finp-'+projKey+'-'+idx+'" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.csv" style="display:none" onchange="ciFileSelected(this,\''+projKey+'\','+idx+')"/>'+
          '<div style="display:flex;gap:8px;margin-top:8px">'+
            '<button onclick="ciSave(\''+projKey+'\','+idx+')" style="flex:1;padding:7px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer">✓ 保存修改</button>'+
            '<button onclick="ciCancelEdit(\''+projKey+'\','+idx+')" style="padding:7px 12px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:8px;font-size:12.5px;color:#4a5568;cursor:pointer">取消</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
      // 操作栏
      '<div style="padding:10px 15px;background:linear-gradient(135deg,#fefce8,#fef9c3);border-top:1px solid #fde68a;display:flex;gap:8px">'+
        '<button onclick="cfmItem(\''+projKey+'\','+idx+')" style="flex:1;padding:8px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1.5px solid #86efac;border-radius:10px;font-size:12.5px;font-weight:700;color:#166534;cursor:pointer;transition:all .15s" onmouseenter="this.style.background=\'#dcfce7\'" onmouseleave="this.style.background=\'linear-gradient(135deg,#f0fdf4,#dcfce7)\'">✓ 确认</button>'+
        '<button onclick="ciShowEdit(\''+projKey+'\','+idx+')" style="flex:1;padding:8px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:1.5px solid #c4b5fd;border-radius:10px;font-size:12.5px;font-weight:600;color:#6d28d9;cursor:pointer" onmouseenter="this.style.background=\'#ede9fe\'" onmouseleave="this.style.background=\'linear-gradient(135deg,#f5f3ff,#ede9fe)\'">✎ 修改内容</button>'+
      '</div>'+
    '</div>';
  }).join('');

  var total = items.length;
  var done = items.filter(function(x){return x.status==='confirmed'||x.status==='edited';}).length;
  var allDone = done === total;

  // 折叠状态：首次全部确认时默认收起，否则展开；用户手动切换后记忆
  if(window.__cpCollapsed==null) window.__cpCollapsed={};
  if(window.__cpCollapsed[projKey]==null) window.__cpCollapsed[projKey]=allDone;
  var collapsed=window.__cpCollapsed[projKey];

  return '<div id="confirmPanel-'+projKey+'" style="margin-top:20px;border-radius:16px;border:1.5px solid #fde68a;overflow:hidden;box-shadow:0 2px 10px rgba(245,158,11,0.1)">'+
    '<div onclick="toggleConfirmPanel(\''+projKey+'\')" style="padding:13px 18px;background:linear-gradient(135deg,#fffbeb,#fef9c3);border-bottom:1px solid #fde68a;display:flex;align-items:center;gap:10px;cursor:pointer">'+
      '<span style="font-size:18px">📋</span>'+
      '<div style="flex:1">'+
        '<div style="font-size:13px;font-weight:800;color:#92400e;letter-spacing:.2px">待确认事项</div>'+
        '<div style="font-size:11px;color:#b45309;margin-top:1px">全部确认后方可生成完整五章报告</div>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:8px">'+
        '<span id="cp-progress-'+projKey+'" style="font-size:12px;font-weight:700;color:'+(allDone?'#166534':'#92400e')+'">'+done+' / '+total+'</span>'+
        '<div style="width:80px;height:6px;background:#fef3c7;border-radius:3px;overflow:hidden">'+
          '<div id="cp-bar-'+projKey+'" style="height:100%;width:'+(total?Math.round(done/total*100):0)+'%;background:linear-gradient(90deg,#f59e0b,#22c55e);border-radius:3px;transition:width .5s"></div>'+
        '</div>'+
        '<span id="cp-caret-'+projKey+'" style="font-size:13px;color:#92400e;display:inline-block;transition:transform .18s;transform:rotate('+(collapsed?'0':'180')+'deg)">▾</span>'+
      '</div>'+
    '</div>'+
    '<div id="cp-body-'+projKey+'" style="display:'+(collapsed?'none':'block')+'">'+
      '<div style="padding:12px 16px;display:flex;flex-direction:column;gap:8px;background:#fff" id="cp-items-'+projKey+'">'+rows+'</div>'+
      '<div id="cp-unlock-'+projKey+'" style="padding:12px 18px;background:'+(allDone?'linear-gradient(135deg,#f0fdf4,#dcfce7)':'#f9fafb')+';border-top:1px solid '+(allDone?'#86efac':'#f0f4ff')+';display:flex;align-items:center;justify-content:center;gap:8px">'+
        (allDone
          ? '<span style="font-size:13px;font-weight:700;color:#166534">✓ 所有事项已确认，请点击下方蓝色按钮生成完整报告</span>'
          : '<span style="font-size:12.5px;color:#9aa5b5">还有 <strong style="color:#f59e0b">'+(total-done)+'</strong> 条事项待确认</span>'
        )+
      '</div>'+
    '</div>'+
  '</div>';
}

/* 折叠/展开待确认事项面板 */
function toggleConfirmPanel(projKey){
  if(window.__cpCollapsed==null) window.__cpCollapsed={};
  window.__cpCollapsed[projKey]=!window.__cpCollapsed[projKey];
  var body=document.getElementById('cp-body-'+projKey);
  var caret=document.getElementById('cp-caret-'+projKey);
  var collapsed=window.__cpCollapsed[projKey];
  if(body) body.style.display=collapsed?'none':'block';
  if(caret) caret.style.transform='rotate('+(collapsed?'0':'180')+'deg)';
}

/* 更新进度条和解锁状态 */
function updateConfirmProgress(projKey){
  var items=PENDING_CONFIRMS[projKey]||[];
  var total=items.length;
  var done=items.filter(function(x){return x.status==='confirmed'||x.status==='edited';}).length;
  var allDone=done===total&&total>0;
  var prog=document.getElementById('cp-progress-'+projKey);
  if(prog) prog.textContent=done+' / '+total+' 已确认';
  var bar=document.getElementById('cp-bar-'+projKey);
  if(bar) bar.style.width=(total?Math.round(done/total*100):0)+'%';
  var unlock=document.getElementById('cp-unlock-'+projKey);
  if(unlock){
    unlock.style.background=allDone?'#f0fdf4':'#f9fafb';
    unlock.style.borderColor=allDone?'#86efac':'#e8edf5';
    unlock.innerHTML=allDone
      ?'<span style="font-size:13px;font-weight:650;color:#166534">✓ 所有事项已确认，请点击下方蓝色按钮生成完整报告</span>'
      :'<span style="font-size:13px;color:#9aa5b5">还剩 '+(total-done)+' 条待确认</span>';
  }
  // 始终强制重建底部操作栏
  var bottomBar=document.querySelector('.report-bottom-bar');
  if(!bottomBar) return persist();
  // 全部确认后推进到「资源匹配」阶段
  var _p=P(); if(_p && allDone && _p.stage<4){ _p.stage=4; }
  // 【2026-09-17】删除"未全部确认就把 stage 4 降回 3"的降级：待确认事项是研判阶段的产物，
  // 需求已递交进入资源匹配后，任何一次报告区重渲染都会把阶段拉回「确认需求」。
  // if(_p && !allDone && _p.stage===4){ _p.stage=3; }  // 已废弃：阶段只进不退
  if(allDone){
    bottomBar.innerHTML=
      '<div style="flex:1;font-size:12.5px;color:#166534;background:#f0fdf4;padding:10px 14px;border-radius:10px;border:1px solid #86efac">✓ 所有待确认事项已完成</div>'+
      '<button onclick="triggerReport(2)" style="padding:12px 24px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:650;cursor:pointer;box-shadow:0 4px 16px rgba(26,86,219,.3)">生成完整产业报告 →</button>'+
      '<button onclick="doUpload()" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">📎 补充材料</button>';
  } else {
    bottomBar.innerHTML=
      '<div style="flex:1;font-size:12.5px;color:#92400e;background:#fffbeb;padding:10px 14px;border-radius:10px;border:1px solid #fde68a">请确认上方 '+(total-done)+' 条待确认事项后生成完整产业报告</div>'+
      '<button disabled style="padding:12px 20px;background:#e8edf5;color:#9aa5b5;border:none;border-radius:12px;font-size:13.5px;cursor:not-allowed">完成确认后解锁 →</button>'+
      '<button onclick="doUpload()" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">📎 补充材料</button>';
  }
  persist();
}

/* 确认一条 */
function cfmItem(projKey, idx){
  if(!PENDING_CONFIRMS[projKey]) return;
  PENDING_CONFIRMS[projKey][idx].status = 'confirmed';
  var card = document.getElementById('ci-'+projKey+'-'+idx);
  if(card){
    var item = PENDING_CONFIRMS[projKey][idx];
    var displayText = item.editedText || item.text;
    var filesBadge = item.files&&item.files.length?'<span style="margin-left:6px;padding:1px 7px;background:#f0fdf4;color:#166534;border-radius:10px;font-size:10.5px;border:1px solid #86efac">'+item.files.length+' 个附件</span>':'';
    card.style.cssText='display:flex;gap:10px;align-items:flex-start;padding:12px 14px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px';
    card.innerHTML=
      '<span style="color:#22c55e;font-size:16px;flex-shrink:0;margin-top:1px">✓</span>'+
      '<div style="flex:1;min-width:0"><div style="font-size:13px;color:#14532d;line-height:1.65">'+displayText+filesBadge+'</div>'+
      '<div style="font-size:11px;color:#22c55e;margin-top:3px">已确认</div></div>'+
      '<button onclick="uncfmItem(\''+projKey+'\','+idx+')" style="padding:3px 8px;background:none;border:1px solid #86efac;border-radius:6px;font-size:11px;color:#22c55e;cursor:pointer;flex-shrink:0">撤回</button>';
  }
  persist(); // 同步确认状态到服务器
  updateConfirmProgress(projKey);
  refreshTopReliability();
}

/* 撤回确认 */
function uncfmItem(projKey, idx){
  if(!PENDING_CONFIRMS[projKey]) return;
  PENDING_CONFIRMS[projKey][idx].status = 'pending';
  // 重新渲染整个面板
  var panel = document.getElementById('confirmPanel-'+projKey);
  if(panel){
    var tmp = document.createElement('div');
    tmp.innerHTML = renderConfirmPanel(PENDING_CONFIRMS[projKey], projKey);
    panel.replaceWith(tmp.firstChild);
  }
  persist(); // 同步撤回到服务器
  updateConfirmProgress(projKey);
  refreshTopReliability();
}

/* 确认/撤回后即时刷新顶部大进度条（侧栏完成度条 + 招商问答页顶部横幅） */
function refreshTopReliability(){
  try{ refreshKbProgress(); }catch(e){}
  // 招商问答页(kbPage)顶部横幅：若当前正显示该页，重渲染以更新百分比/文案
  try{
    if(view==='knowledge'&&typeof render==='function'){ render(); }
  }catch(e){}
  try{ persist(); }catch(e){}
}

/* 显示编辑框 */
function ciShowEdit(projKey, idx){
  var edit = document.getElementById('ci-edit-'+projKey+'-'+idx);
  var ta   = document.getElementById('ci-ta-'+projKey+'-'+idx);
  var item = PENDING_CONFIRMS[projKey] && PENDING_CONFIRMS[projKey][idx];
  if(edit){ edit.style.display='block'; }
  if(ta && item){ ta.value = item.editedText || item.text; ta.focus(); ta.select(); }
}

/* 取消编辑 */
function ciCancelEdit(projKey, idx){
  var edit = document.getElementById('ci-edit-'+projKey+'-'+idx);
  if(edit) edit.style.display='none';
}

/* 保存修改 */
function ciSave(projKey, idx){
  var ta = document.getElementById('ci-ta-'+projKey+'-'+idx);
  if(!ta||!ta.value.trim()) return;
  var item = PENDING_CONFIRMS[projKey][idx];
  item.editedText = ta.value.trim();
  item.status = 'edited';
  var card = document.getElementById('ci-'+projKey+'-'+idx);
  if(card){
    var displayText = item.editedText;
    var filesBadge = item.files&&item.files.length?'<span style="margin-left:6px;padding:1px 7px;background:#f0fdf4;color:#166534;border-radius:10px;font-size:10.5px;border:1px solid #86efac">'+item.files.length+' 个附件</span>':'';
    card.style.cssText='display:flex;gap:10px;align-items:flex-start;padding:12px 14px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px';
    card.innerHTML=
      '<span style="color:#22c55e;font-size:16px;flex-shrink:0;margin-top:1px">✓</span>'+
      '<div style="flex:1;min-width:0"><div style="font-size:13px;color:#14532d;line-height:1.65">'+displayText+filesBadge+'</div>'+
      '<div style="font-size:11px;color:#22c55e;margin-top:3px">已修改并确认</div></div>'+
      '<button onclick="uncfmItem(\''+projKey+'\','+idx+')" style="padding:3px 8px;background:none;border:1px solid #86efac;border-radius:6px;font-size:11px;color:#22c55e;cursor:pointer;flex-shrink:0">撤回</button>';
  }
  updateConfirmProgress(projKey);
  toast('✓ 修改已保存');
}

/* 附件相关 */
function ciPickFile(projKey, idx){
  var inp = document.getElementById('ci-finp-'+projKey+'-'+idx);
  if(inp) inp.click();
}
function ciDropFile(e, projKey, idx){
  e.preventDefault();
  var files = Array.from(e.dataTransfer&&e.dataTransfer.files||[]);
  if(files.length) ciAttachFiles(files, projKey, idx);
}
function ciFileSelected(inp, projKey, idx){
  var files = Array.from(inp&&inp.files||[]);
  if(files.length) ciAttachFiles(files, projKey, idx);
}
function ciAttachFiles(files, projKey, idx){
  var item = PENDING_CONFIRMS[projKey] && PENDING_CONFIRMS[projKey][idx];
  if(!item) return;
  if(!item.files) item.files = [];
  files.forEach(function(f){ item.files.push({name:f.name, size:f.size, ts:Date.now()}); });
  ingestFiles(files, null);  // 加入城市智库 corpus
  var hint = document.getElementById('ci-file-hint-'+projKey+'-'+idx);
  if(hint) hint.innerHTML = '✅ 已上传 '+item.files.length+' 个附件：'+item.files.map(function(f){return f.name;}).join('、');
  persist();
  toast('📎 已上传 '+files.length+' 个附件并加入知识库');
}


/* 立项卡片 */
/* 恢复确认面板（如果有待确认事项） */
function restoreConfirmPanel(){
  // 完整报告（该方向 phase=2）不显示待确认面板：待确认事项已是报告正文第五章的一部分。
  // 注意：必须用方向级 phaseByTopic 判据——项目级 phase 是单例，切到新方向仍停在旧方向的 2，
  // 会错误地抑制新方向的确认面板（表现为"待确认事项没点就消失"）。
  var _rs = cur && REPORTSTATE[cur];
  var _tp = (P()||{}).topic;
  if(_rs && _tp && _rs.phaseByTopic && _rs.phaseByTopic[_tp]===2) return '';
  // 若当前方向待确认事项为空，按方向缓存/报告文本恢复
  if(cur && REPORTSTATE[cur] && (!PENDING_CONFIRMS[cur] || !PENDING_CONFIRMS[cur].length)){
    var _p=P(); var _topic=_p?_p.topic:'';
    var _pb=REPORTSTATE[cur].pendingByTopic||{};
    var _np=_topic?_findPendingForTopic(REPORTSTATE[cur],_topic):null;
    if((!_np||!_np.length)&&_topic){
      var _rtxt=getTopicReport(_topic)||'';
      _np=parsePendingItems(_rtxt);
    }
    if(_np&&_np.length){
      PENDING_CONFIRMS[cur]=_np;
      if(!REPORTSTATE[cur].pendingByTopic) REPORTSTATE[cur].pendingByTopic={};
      if(_topic) REPORTSTATE[cur].pendingByTopic[_topic]=_np;
    }
  }
  if(!cur || !PENDING_CONFIRMS[cur] || !PENDING_CONFIRMS[cur].length) return '';
  var reanalyzeBtn = '<div style="margin-bottom:12px;display:flex;gap:10px;align-items:center">'+
    '<button onclick="startAiInterview()" style="padding:10px 20px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:650;cursor:pointer"> 重新分析（AI访谈）</button>'+
    '<span style="font-size:12px;color:#8492a6">重新选择方向并通过AI访谈补充信息后生成新报告</span>'+
  '</div>';
  return reanalyzeBtn + renderConfirmPanel(PENDING_CONFIRMS[cur], cur);
}

/* 从产业链图谱 AI 研判结果(segmentLevels)派生可立项招引方向：
   weak(缺口)第一梯队、mid(培育)第二梯队；携带判定依据 + 对标企业(type=target)。
   图谱研判一次，招引方向/补链清单/报告清单全部从这份结果派生，保证单一事实源。 */
function deriveActionItemsFromChain(){
  if(!cur || !PROJECTS[cur]) return null;
  var p=P();
  var topic = p ? p.topic : '';
  if(!topic) return null;
  var entries=[];
  var _chainKey = pickChainKey(topic);
  var _isDynamic = false;
  if(_chainKey){
    // 路径 A：硬编码链 → 走 _slFor(topic)
    var sl = _slFor(topic);
    if(!sl || sl.__chainKey!==_chainKey) return null;
    var _chainNodes = _chainNodeNames(_chainKey);
    for(var k in sl){
      if(k==='__chainKey') continue;
      if(_chainNodes.length && _chainNodes.indexOf(k)<0) continue;
      entries.push({name:k, level:sl[k].level||'mid', basis:sl[k].basis||'',
                    confidence:sl[k].confidence||'medium', benchmarks:null});
    }
  } else {
    // 路径 B：动态图谱（chainByTopic[topic]）
    var rs = REPORTSTATE[cur];
    var dyn = rs && rs.chainByTopic && rs.chainByTopic[topic];
    if(!Array.isArray(dyn) || !dyn.length) return null;
    _isDynamic = true;
    dyn.forEach(function(seg){
      (seg.nodes||[]).forEach(function(nd){
        if(!nd || !nd.name) return;
        entries.push({
          name: nd.name,
          level: (nd.level==='strong'||nd.level==='mid'||nd.level==='weak') ? nd.level : 'mid',
          basis: nd.note || '',
          confidence: 'medium',
          benchmarks: Array.isArray(nd.benchmark) ? nd.benchmark.slice() : []
        });
      });
    });
  }
  var order={weak:0, mid:1};
  var candidates=entries.filter(function(e){ return e.level==='weak'||e.level==='mid'; });
  if(!candidates.length) return null;
  candidates.sort(function(a,b){
    var oa = order[a.level]!=null ? order[a.level] : 9;
    var ob = order[b.level]!=null ? order[b.level] : 9;
    return oa-ob;
  });
  var attrMap={weak:'补链缺口', mid:'培育增强'};
  var confPct={high:'85%', medium:'70%', low:'55%'};
  return candidates.slice(0,3).map(function(e, i){
    var benchEnts;
    if(_isDynamic){
      // 动态图谱：对标企业直接取 node.benchmark（该方向 AI 派生，天然不跨方向）
      benchEnts = e.benchmarks || [];
    } else {
      var bench=(OPS_ENT||[]).filter(function(ent){
        if(ent.type==='local') return false;
        if(ent.segment===e.name) return true;
        if((ent.gap||'').indexOf(e.name)>=0) return true;
        return (ent.matches||[]).some(function(m){ return (m.gap||'').indexOf(e.name)>=0; });
      });
      benchEnts = bench.map(function(b){ return b.name; });
    }
    return {rank:i+1, gap:e.name, attr:attrMap[e.level]||'', score:'', level:e.level, basis:e.basis,
            confidencePct: confPct[e.confidence]||'70%', fromChain:true,
            benchEnts: benchEnts};
  });
}

/* 从REPORTSTATE恢复已保存的招引方向卡片 */
function restoreActionItems(){
  if(!cur || !REPORTSTATE[cur]) return '';
  var p=P();
  var topic=p?p.topic:'';
  // 优先：从产业链图谱 AI 研判结果(segmentLevels)派生招引方向，单一事实源。
  // 只有图谱尚未研判（无 weak/mid 环节）时才回退到报告文本解析。
  var items = deriveActionItemsFromChain();
  if(!items || !items.length){
    var byTopic=REPORTSTATE[cur].actionItemsByTopic||{};
    var _pre=getTopicReport(topic);
    if(_pre){
      items=parseActionItems(_pre);
    } else {
      items=parseActionItems(reportTextForTopic(P().topic)||'');
    }
    if(items && items.length){
      if(!REPORTSTATE[cur].actionItemsByTopic) REPORTSTATE[cur].actionItemsByTopic={};
      REPORTSTATE[cur].actionItemsByTopic[topic]=items;
    }
  }
  if(!items||!items.length) return '';
  var p = P(); if(!p) return '';
  var colors=['#1a56db','#6366f1','#0891b2'];
  var icons=['\ud83e\udd47','\ud83e\udd48','\ud83e\udd49'];

  return '<div style="margin-top:20px;padding:0 4px">'+
    '<div style="font-size:13px;font-weight:700;color:#0b183b;margin-bottom:10px">\ud83c\udf96 可立项招引方向 <span style="font-size:12px;color:#8492a6;font-weight:400">· 点击「提交招商需求」自动生成招商项目，进入招商对接</span></div>'+
    items.map(function(it,idx){
      var color=colors[idx%3];
      var safeGap=it.gap.replace(/"/g,'&quot;');
      var safeCity=p.city.replace(/"/g,'&quot;');
      var safeTopic=p.topic.replace(/"/g,'&quot;');
      return '<div style="border-radius:14px;border:2px solid '+color+';overflow:hidden;background:#fff;margin-bottom:10px">'+
        '<div style="padding:12px 16px;background:'+color+';display:flex;align-items:center;gap:8px">'+
          '<span style="font-size:18px">'+icons[idx]+'</span>'+
          '<span style="font-size:13px;font-weight:700;color:#fff;flex:1">'+it.gap+'</span>'+
          (it.attr?'<span style="padding:2px 8px;background:rgba(255,255,255,.2);border-radius:8px;font-size:11px;color:#fff">'+it.attr+'</span>':'')+
        '</div>'+
        '<div style="padding:12px 16px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px">'+
          '<div style="font-size:12px;color:#4a5568;flex:1;min-width:0">'+safeCity+' · '+safeTopic+'<br>置信度 '+(it.confidencePct||'100%')+' · 来源：'+(it.fromChain?'慧小招 AI 产业链研判':'慧小招实测报告')+
            (it.basis?'<div style="margin-top:4px;font-size:11px;color:#94a3b8;line-height:1.5">'+String(it.basis).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>':'')+
            (it.benchEnts&&it.benchEnts.length?'<div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:4px">'+it.benchEnts.slice(0,3).map(function(b){return '<span style="font-size:10.5px;color:#1a56db;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:1px 6px;white-space:nowrap">🎯 '+String(b).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>';}).join('')+'</div>':'')+
          '</div>'+
          (function(){
            // 幂等：同城同 gap 已存在 isDemand 项目 → 直接渲染“↩ 撤回提交”（用 _findExistingDemand 规范化匹配）
            var _existKey=_findExistingDemand(p.city, it.gap);
            if(_existKey){
              return '<button data-projkey="'+_existKey+'" onclick="withdrawDemand(\''+_existKey+'\',this,\''+safeGap+'\',\''+safeCity+'\',\''+safeTopic+'\',\''+color+'\')" style="padding:8px 18px;background:#fff;color:#dc2626;border:1.5px solid #fca5a5;border-radius:10px;font-size:12.5px;font-weight:650;cursor:pointer;flex-shrink:0">↩ 撤回提交</button>';
            }
            return '<button onclick="importToProject(\''+safeGap+'\',\''+safeCity+'\',\''+safeTopic+'\',this)" style="padding:8px 18px;background:'+color+';color:#fff;border:none;border-radius:10px;font-size:12.5px;font-weight:650;cursor:pointer;flex-shrink:0">提交招商需求 →</button>';
          })()+
        '</div>'+
      '</div>';
    }).join('')+
  '</div>';
}

/* 从报告文本解析TOP3招引方向（供渲染与切换方向时复用） */
function parseActionItems(text){
  var items=[];
  if(!text) return items;
  var tlines=text.split('\n');
  var inTop5=false;
  for(var i=0;i<tlines.length;i++){
    var l=tlines[i];
    if(l.indexOf('补链优先级')>=0||l.indexOf('TOP5')>=0||l.indexOf('优先级清单')>=0||l.indexOf('承接优先方向')>=0||l.indexOf('补链优先级TOP3')>=0) inTop5=true;
    if(inTop5&&l.trim().charAt(0)==='|'){
      var cells=l.trim().slice(1,-1).split('|').map(function(c){return c.replace(/[*\u2605<>]/g,'').trim();});
      if(cells.length>=2){
        var isSep=cells.every(function(c){return /^[\s\-:]+$/.test(c);});
        if(isSep||cells[0]==='排名'||cells[0]==='缺口节点'||cells[0]==='缺口'||cells[0]==='方向') continue;
        var rank=parseInt(cells[0]);
        if(!isNaN(rank)&&rank>=1&&rank<=3&&cells[1]){
          items.push({rank:rank,gap:cells[1],attr:cells[2]||'',score:cells[cells.length-1]||''});
        }
      }
    }
    if(inTop5&&items.length>=3) break;
  }
  if(!items.length){
    tlines.forEach(function(l){
      if((l.indexOf('\u274c')>=0||l.indexOf('缺失')>=0||l.indexOf('全部外购')>=0)&&items.length<3){
        var clean=l.replace(/^[*\-\u2022|#\s]+/,'').replace(/\u274c|\*\*/g,'').trim();
        if(clean.length>4&&clean.length<60) items.push({rank:items.length+1,gap:clean,attr:'',score:''});
      }
    });
  }
  return items;
}

function renderActionItems(text, p, r){
  if(!text||!p) return;
  var area=document.getElementById('reportArea');
  if(!area) return;

  var items=[];
  var tlines=text.split('\n');
  var inTop5=false;
  for(var i=0;i<tlines.length;i++){
    var l=tlines[i];
    if(l.indexOf('补链优先级')>=0||l.indexOf('TOP5')>=0||l.indexOf('优先级清单')>=0) inTop5=true;
    if(inTop5&&l.trim().charAt(0)==='|'){
      var cells=l.trim().slice(1,-1).split('|').map(function(c){return c.replace(/[*★<>]/g,'').trim();});
      if(cells.length>=2){
        var isSep=cells.every(function(c){return /^[\s\-:]+$/.test(c);});
        if(isSep||cells[0]==='排名'||cells[0]==='缺口节点'||cells[0]==='缺口') continue;
        var rank=parseInt(cells[0]);
        if(!isNaN(rank)&&rank>=1&&rank<=3&&cells[1]){
          items.push({rank:rank,gap:cells[1],attr:cells[2]||'',score:cells[cells.length-1]||''});
        }
      }
    }
    if(inTop5&&items.length>=3) break;
  }

  if(!items.length){
    tlines.forEach(function(l){
      if((l.indexOf('❌')>=0||l.indexOf('缺失')>=0||l.indexOf('全部外购')>=0)&&items.length<3){
        var clean=l.replace(/^[*\-•|#\s]+/,'').replace(/❌|\*\*/g,'').trim();
        if(clean.length>4&&clean.length<60) items.push({rank:items.length+1,gap:clean,attr:'',score:''});
      }
    });
  }
  if(!items.length) return;
  // 持久化招引方向卡片数据（按方向分别存储）
  if(cur && REPORTSTATE[cur]) {
    if(!REPORTSTATE[cur].actionItemsByTopic) REPORTSTATE[cur].actionItemsByTopic={};
    var _topic=p?p.topic:'';
    if(_topic) REPORTSTATE[cur].actionItemsByTopic[_topic]=items;
    REPORTSTATE[cur].actionItems=items; // backward compat
    persist();
  }


  var colors=['#1a56db','#6366f1','#0891b2'];
  var icons=['🥇','🥈','🥉'];

  var cards=items.map(function(it,idx){
    var color=colors[idx%3];
    var safeGap=it.gap.replace(/"/g,'&quot;');
    var safeCity=p.city.replace(/"/g,'&quot;');
    var safeTopic=p.topic.replace(/"/g,'&quot;');
    return '<div style="border-radius:14px;border:2px solid '+color+';overflow:hidden;background:#fff;margin-bottom:2px">'+
      '<div style="padding:12px 16px;background:'+color+';display:flex;align-items:center;gap:8px">'+
        '<span style="font-size:18px">'+icons[idx]+'</span>'+
        '<span style="font-size:13px;font-weight:700;color:#fff;flex:1">'+it.gap+'</span>'+
        (it.attr?'<span style="padding:2px 8px;background:rgba(255,255,255,.2);color:#fff;border-radius:20px;font-size:11px">'+it.attr+'</span>':'')+
      '</div>'+
      '<div style="padding:12px 16px;display:flex;align-items:center;gap:10px">'+
        '<div style="flex:1;font-size:12px;color:#4a5568;line-height:1.6">'+
          '<strong>'+p.city+'</strong> · '+p.topic+'<br>'+
          '置信度 '+r.score+'% · 来源：慧小招实测报告'+
        '</div>'+
        (function(){
          // 幂等按钮：若同城同 gap 已存在 isDemand 项目，就直接渲染为“↩ 撤回提交”，
          // 用 _findExistingDemand 规范化匹配，避免同一诉求措辞不同重复入表。
          var _existKey=_findExistingDemand(p.city, it.gap);
          if(_existKey){
            return '<button data-gap="'+safeGap+'" data-city="'+safeCity+'" data-topic="'+safeTopic+'" data-projkey="'+_existKey+'"'+
              ' onclick="withdrawDemand(this.getAttribute(\'data-projkey\'),this,this.getAttribute(\'data-gap\'),this.getAttribute(\'data-city\'),this.getAttribute(\'data-topic\'),\''+color+'\')"'+
              ' style="padding:8px 16px;background:#fff;color:#dc2626;border:1.5px solid #fca5a5;border-radius:10px;font-size:12.5px;font-weight:650;cursor:pointer;white-space:nowrap;flex-shrink:0">'+
              '↩ 撤回提交'+
              '</button>';
          }
          return '<button data-gap="'+safeGap+'" data-city="'+safeCity+'" data-topic="'+safeTopic+'"'+
            ' onclick="importToProject(this.getAttribute(\'data-gap\'),this.getAttribute(\'data-city\'),this.getAttribute(\'data-topic\'),this)"'+
            ' style="padding:8px 16px;background:'+color+';color:#fff;border:none;border-radius:10px;font-size:12.5px;font-weight:650;cursor:pointer;white-space:nowrap;flex-shrink:0">'+
            '提交招商需求 →'+
            '</button>';
        })()+
      '</div>'+
    '</div>';
  }).join('');

  var wrapper=document.createElement('div');
  wrapper.innerHTML=
    '<div style="margin-top:20px;padding:16px;background:#f8faff;border-radius:14px;border:1.5px solid #e8edf5">'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">'+
        '<span style="font-size:13px;font-weight:750;color:#0b183b;letter-spacing:.2px">🏁 可立项招引方向</span>'+
        '<span style="font-size:11px;color:#9aa5b5">· 点击「提交招商需求」自动生成招商项目，进入招商对接</span>'+
      '</div>'+
      '<div>'+cards+'</div>'+
    '</div>';
  area.appendChild(wrapper);
}

/* ── 需求幂等公共 helper ──
   规范化 topic：去空白 + 去常见后缀（补链/升级/招引/引入/引育/培育/招商/Tier1/新能源），
   避免"新能源冷藏车制冷机组补链"和"新能源冷藏车电动制冷机组总成"这类同一诉求
   因措辞不同被判为两条需求，重复进招商对接。 */
function _normalizeTopic(t){
  if(!t) return '';
  return String(t).replace(/\s+/g,'')
    .replace(/(补链|升级|招引|引入|引育|培育|招商|Tier1|新能源|方向|产业)/g,'')
    .toLowerCase();
}
/* 返回同城 + 同(规范化)topic 的已存在 isDemand 项目 key，找不到返回 null */
function _findExistingDemand(city, topic){
  if(!city || !topic) return null;
  var _nt=_normalizeTopic(topic);
  // 精确匹配优先
  var exactKey=Object.keys(PROJECTS).find(function(k){
    var x=PROJECTS[k]; return x&&x.isDemand&&x.city===city&&x.topic===topic;
  });
  if(exactKey) return exactKey;
  // 规范化匹配（宽松）
  return Object.keys(PROJECTS).find(function(k){
    var x=PROJECTS[k]; return x&&x.isDemand&&x.city===city&&_normalizeTopic(x.topic)===_nt;
  }) || null;
}
/* 清理已存在的同 city+topic 重复 isDemand 项目：保留最早创建的，删除后来者。
   在 loadReportState / persist 之后调用，一次性把历史遗留的双招收敛。 */
function _dedupeDemands(){
  try{
    var seen={}; // {city||normTopic: earliestKey}
    var toDel=[];
    Object.keys(PROJECTS).forEach(function(k){
      var x=PROJECTS[k]; if(!x||!x.isDemand) return;
      var _sig=(x.city||'')+'||'+_normalizeTopic(x.topic||'');
      if(!seen[_sig]){ seen[_sig]=k; return; }
      // 有重复：比较创建时间戳（key 里的 base36 部分即 Date.now）
      var _a=parseInt(seen[_sig].replace('proj_',''),36);
      var _b=parseInt(k.replace('proj_',''),36);
      if(isNaN(_a)||isNaN(_b)){ toDel.push(k); return; }
      if(_b<_a){ toDel.push(seen[_sig]); seen[_sig]=k; }
      else{ toDel.push(k); }
    });
    toDel.forEach(function(k){
      if(PROJECTS[k]) delete PROJECTS[k];
      if(typeof REPORTSTATE!=='undefined' && REPORTSTATE[k]) delete REPORTSTATE[k];
      if(typeof DEMANDS!=='undefined'){
        for(var i=DEMANDS.length-1;i>=0;i--){ if(DEMANDS[i].id===k||DEMANDS[i].projKey===k) DEMANDS.splice(i,1); }
      }
    });
    if(toDel.length) console.info('[dedupe] removed duplicate isDemand projects:', toDel);
  }catch(e){ console.warn('[dedupe] failed:', e.message); }
}

/* 提交招商需求 */
function importToProject(gap, city, topic, btnEl){
  var p=P();
  var _city=city||(p&&p.city)||'';
  // 幂等：同城同 gap(即 topic) 已存在 isDemand 项目则直接切到“已提交/可撤回”，不再新建。
  // 用 _findExistingDemand 做规范化匹配，避免 "XX补链" 与 "XX制造总成" 措辞不同被判为两条需求。
  var _dupKey=_findExistingDemand(_city, gap);
  if(_dupKey){
    toast('该方向已提交招商需求，可在招商对接页撤回');
    if(btnEl){
      var _origColor2=btnEl.style.background||'#1a56db';
      btnEl.textContent='↩ 撤回提交';
      btnEl.style.background='#fff';
      btnEl.style.color='#dc2626';
      btnEl.style.border='1.5px solid #fca5a5';
      btnEl.style.cursor='pointer';
      btnEl.setAttribute('data-projkey', _dupKey);
      btnEl.onclick=function(){ withdrawDemand(_dupKey, btnEl, gap, _city, topic, _origColor2); };
    }
    return;
  }
  var key='proj_'+Date.now().toString(36);
  PROJECTS[key]={
    id:key, city:_city, org:_city+'市招商局', who:p?p.who:'负责人',
    topic:gap, stage:3,  // 立项即跳过研判，直接到「确认需求」
    isDemand:true,       // 标记为「已正式提交的招商需求项目」——只有它们才进招商对接列表
    kb: p ? JSON.parse(JSON.stringify(p.kb)) : [],
    report: REPORTSTATE[cur] ? {
      title:(city||p.city)+'·'+gap+'招商研判报告',
      lead:gap+'方向招引，基于慧小招实测报告',
      sections:[{h:'研判依据',p:(REPORTSTATE[cur].text||'').substring(0,300)+'…',type:'real',ev:'慧小招研判报告',chk:''}],
      summary:[['数据来源','慧小招实测'],['置信度',topicScore(P()&&P().topic)+'%'],['生成时间',new Date().toLocaleDateString('zh-CN')]]
    } : null,
    clues:[]
  };
  // 把父项目的报告复制给新项目（让产业分析页可以直接使用）
  if(cur && REPORTSTATE[cur] && !REPORTSTATE[key]){
    REPORTSTATE[key]=JSON.parse(JSON.stringify(REPORTSTATE[cur]));
    REPORTSTATE[key].topic=gap;   // 更新 topic 为新方向
    REPORTSTATE[key].phase=2;     // 保留完整报告（研判已完成）
  }
  // 同步到管理端需求池（DEMANDS）
  if(typeof DEMANDS==='undefined') window.DEMANDS=[];
  DEMANDS.push({
    id:key,
    city:city||p.city,
    topic:gap,
    from:topic||p.topic,
    who:p?p.who:'负责人',
    org:(city||p.city)+'市招商局',
    ts:Date.now(),
    status:'pending'
  });
  // 不切换 cur — 保留当前研判页所有状态
  persist();
  // 招商需求立即同步到服务器（绕过5秒防抖），防止刷新丢失、管理端看不到
  try{ fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:localStorage.getItem(LS_KEY)||'{}'}).catch(function(){}); }catch(_){}
  // 更新按钮为「已提交·可撤回」状态
  if(btnEl){
    // 先捕获原按钮底色（color 在本函数作用域并不存在，此前撤回回调引用它会抛 ReferenceError 导致按钮点不动）
    var _origColor=btnEl.style.background||'#1a56db';
    btnEl.textContent='↩ 撤回提交';
    btnEl.style.background='#fff';
    btnEl.style.color='#dc2626';
    btnEl.style.border='1.5px solid #fca5a5';
    btnEl.style.cursor='pointer';
    btnEl.setAttribute('data-projkey', key);
    btnEl.onclick=function(){ withdrawDemand(key, btnEl, gap, city, topic, _origColor); };
  }
  toast('✓ 已提交招商需求（可撤回）');
}

/* 撤回招商需求：删除生成的项目 + 需求池记录，同步到管理端 */
function withdrawDemand(key, btnEl, gap, city, topic, color){
  // 删除项目及其派生数据
  if(PROJECTS[key]) delete PROJECTS[key];
  if(REPORTSTATE[key]) delete REPORTSTATE[key];
  if(typeof DOCK_LOGS!=='undefined' && DOCK_LOGS[key]) delete DOCK_LOGS[key];
  if(typeof PENDING_CONFIRMS!=='undefined' && PENDING_CONFIRMS[key]) delete PENDING_CONFIRMS[key];
  if(typeof UPLOADS!=='undefined' && UPLOADS[key]) delete UPLOADS[key];
  // 删除需求池记录（importToProject 用 id===key）
  if(typeof DEMANDS!=='undefined'){
    for(var i=DEMANDS.length-1;i>=0;i--){ if(DEMANDS[i].id===key || DEMANDS[i].projKey===key) DEMANDS.splice(i,1); }
  }
  // 若当前正停留在被撤回的项目上，回退 cur
  if(cur===key) cur=null;
  persist();   // 同步到 /api/sync，管理端自动移除
  // 恢复按钮为「提交招商需求」
  if(btnEl){
    btnEl.textContent='提交招商需求 →';
    btnEl.style.background=color||'#1a56db';
    btnEl.style.color='#fff';
    btnEl.style.border='none';
    btnEl.style.cursor='pointer';
    btnEl.removeAttribute('data-projkey');
    btnEl.onclick=function(){ importToProject(gap, city, topic, btnEl); };
  }
  toast('已撤回，管理端项目同步移除');
}

function showImportConfirm(projKey, gap){
  var old=document.getElementById('importConfirmLayer');
  if(old) old.remove();

  // 注入 fadeUp keyframe（只注一次）
  if(!document.getElementById('fadeUpStyle')){
    var st=document.createElement('style');st.id='fadeUpStyle';
    st.textContent='@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(st);
  }

  var layer=document.createElement('div');
  layer.id='importConfirmLayer';
  // 点遮罩关闭
  layer.onclick=function(e){ if(e.target===layer) layer.remove(); };
  layer.style.cssText='position:fixed;inset:0;background:rgba(11,24,59,.4);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);padding:20px;box-sizing:border-box';

  var safeGap=gap.replace(/</g,'&lt;').replace(/>/g,'&gt;');

  layer.innerHTML=
    '<div style="background:#fff;border-radius:24px;width:100%;max-width:440px;overflow:hidden;box-shadow:0 24px 80px rgba(11,24,59,.18);animation:fadeUp .3s ease">'+

      // ── 顶部彩条 ──
      '<div style="background:linear-gradient(135deg,#1a56db,#6366f1);padding:28px 28px 24px;position:relative">'+
        '<button onclick="document.getElementById(\'importConfirmLayer\').remove()" '+
          'style="position:absolute;top:14px;right:14px;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.2);border:none;color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1" '+
          'onmouseover="this.style.background=\'rgba(255,255,255,.35)\'" onmouseout="this.style.background=\'rgba(255,255,255,.2)\'">✕</button>'+
        '<div style="font-size:32px;margin-bottom:10px">🏁</div>'+
        '<div style="font-size:18px;font-weight:750;color:#fff;margin-bottom:4px">发送成功</div>'+
        '<div style="font-size:13px;color:rgba(255,255,255,.75)">已自动生成招商项目</div>'+
      '</div>'+

      // ── 内容区 ──
      '<div style="padding:24px 28px">'+
        '<div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;background:#f8faff;border-radius:12px;border:1.5px solid #dbeafe;margin-bottom:18px">'+
          '<span style="font-size:20px;flex-shrink:0;margin-top:2px">📋</span>'+
          '<div>'+
            '<div style="font-size:13.5px;font-weight:700;color:#0b183b;margin-bottom:3px">'+safeGap+'</div>'+
            '<div style="font-size:12px;color:#8492a6;line-height:1.6">城市智库数据已同步 · 处于「确认需求」阶段</div>'+
          '</div>'+
        '</div>'+
        '<p style="font-size:13px;color:#4a5568;margin:0 0 20px;line-height:1.7">'+
          '你可以继续完善当前研判报告，或前往招商对接查看新项目。'+
        '</p>'+

        // ── 按钮 ──
        '<div style="display:flex;flex-direction:column;gap:8px">'+
          '<button onclick="(function(){document.getElementById(\'importConfirmLayer\').remove();cur=\''+projKey+'\';view=\'home\';render();})()" '+
            'style="width:100%;padding:13px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:650;cursor:pointer;letter-spacing:.2px" '+
            'onmouseover="this.style.opacity=\'0.92\'" onmouseout="this.style.opacity=\'1\'">'+
            '前往招商对接 →'+
          '</button>'+
          '<button onclick="document.getElementById(\'importConfirmLayer\').remove()" '+
            'style="width:100%;padding:12px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13.5px;color:#4a5568;cursor:pointer" '+
            'onmouseover="this.style.background=\'#eef2ff\'" onmouseout="this.style.background=\'#f5f7fb\'">'+
            '继续当前研判'+
          '</button>'+
        '</div>'+
      '</div>'+
    '</div>';

  document.body.appendChild(layer);
}


/* ══ AI 访谈流程（产业分析前的逐步提问） ══ */
var _interviewState = { answers: [], currentQ: 0, topic: '' };

/* 添加自定义方向为新卡片 */
function addCustomTopic(){
  var inp=document.getElementById('topicCustomInput');
  var val=(inp?inp.value:'').trim();
  if(!val){toast('请输入方向名称');return;}
  // 选中该方向
  selectTopic(val, true);
  // 清空输入框
  if(inp) inp.value='';
  toast('✓ 已添加方向「'+val+'」');
}

/* 统一的方向卡片 HTML。自定义方向(type==='custom')右上角带删除键。 */
/* 方向卡片标题显示：统一加「产业」二字（仅显示层，不改底层 label 身份标识）。
   已含「产业」的不重复加，避免出现「服装产业产业」。 */
function topicDisplayLabel(label){
  var s=String(label||'').trim();
  if(!s) return s;
  if(s.indexOf('产业')>=0) return s;   // 已包含则不再追加
  return s+'产业';
}
function topicCardHtml(t, isActive){
  var isCustom=(t.type==='custom');
  var delBtn=isCustom
    ? '<span onclick="event.stopPropagation();deleteCustomTopic(this.getAttribute(\'data-del\'))" data-del="'+String(t.label).replace(/"/g,'&quot;')+'" title="删除该自定义方向" '+
        'style="position:absolute;top:8px;right:8px;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;'+
        'border-radius:50%;background:#fef2f2;border:1px solid #fecaca;color:#dc2626;font-size:13px;line-height:1;cursor:pointer;z-index:2">×</span>'
    : '';
  return '<button onclick="selectTopic(this.getAttribute(\'data-v\'))" data-v="'+String(t.label).replace(/"/g,'&quot;')+'" style="'+
    'position:relative;display:flex;flex-direction:column;align-items:flex-start;padding:14px 16px;'+
    'background:'+(isActive?'linear-gradient(135deg,#eff6ff,#f0f9ff)':'#fff')+';'+
    'border:2px solid '+(isActive?'#1a56db':'#e8edf5')+';'+
    'border-radius:14px;cursor:pointer;text-align:left;transition:all .15s;flex:1;min-width:0">'+
    delBtn+
    '<span style="font-size:20px;margin-bottom:6px">'+(t.icon||'📌')+'</span>'+
    '<span style="font-size:13px;font-weight:700;color:#0b183b;display:block;margin-bottom:4px">'+topicDisplayLabel(t.label)+'</span>'+
    '<span style="font-size:11.5px;color:#8492a6;line-height:1.4">'+(t.desc||'自定义产业方向')+'</span>'+
    (isActive?'<div style="margin-top:8px;width:8px;height:8px;border-radius:50%;background:#1a56db"></div>':'')+
  '</button>';
}

/* 删除自定义方向卡片 */
function deleteCustomTopic(label){
  var p=P(); if(!p||!label) return;
  // 允许删除AI推荐方向和自定义方向
  if(!confirm('确定删除自定义方向「'+label+'」？该方向下的报告与历史将一并清除。')) return;
  // 从自定义方向列表移除
  if(p.customTopics) p.customTopics=p.customTopics.filter(function(t){return t!==label;});
  // 记录已删除的方向（防止AI缓存刷新后复活）
  if(!p.deletedTopics) p.deletedTopics=[];
  if(p.deletedTopics.indexOf(label)<0) p.deletedTopics.push(label);
  // 同时从AI推荐缓存中移除
  if(p.aiTopics&&p.aiTopics.list){
    p.aiTopics.list=p.aiTopics.list.filter(function(t){return t.label!==label;});
  }
  // 清理该方向相关缓存：AI报告、待确认、招引方向、历史、方向级阶段标记
  // 关键修复：必须连同 phaseByTopic / userGeneratedTopics 一起删除，否则刷新后从服务端
  // restore，这两个字段还在，报告会被判定为「已生成」而重新渲染出来（删了又回来的 bug）。
  if(cur && REPORTSTATE[cur]){
    var _rs=REPORTSTATE[cur];
    if(_rs.aiReportByTopic) delete _rs.aiReportByTopic[label];
    if(_rs.pendingByTopic) delete _rs.pendingByTopic[label];
    if(_rs.actionItemsByTopic) delete _rs.actionItemsByTopic[label];
    if(_rs.phaseByTopic) delete _rs.phaseByTopic[label];
    if(_rs.userGeneratedTopics) delete _rs.userGeneratedTopics[label];
    if(_rs.reportByTopic) delete _rs.reportByTopic[label];
    if(_rs.scoreByTopic) delete _rs.scoreByTopic[label];
    // 若被删方向正是项目级 REPORTSTATE 当前指向的方向，清空残留的项目级正文/阶段，
    // 避免刷新后 reportHtml 仍读到旧方向的 text。
    if(_rs.topic===label){ _rs.text=''; _rs.phase=1; _rs.topic=''; _rs.finalized=false; }
  }
  // 清理该方向的待确认事项（PENDING_CONFIRMS 若按方向细分）
  if(cur && typeof PENDING_CONFIRMS!=='undefined' && PENDING_CONFIRMS[cur]){
    if(P()&&P().topic===label) PENDING_CONFIRMS[cur]=[];
  }
  if(cur && typeof REPORT_HISTORY!=='undefined' && REPORT_HISTORY[cur]){
    REPORT_HISTORY[cur]=REPORT_HISTORY[cur].filter(function(h){return !h||h.topic!==label;});
    saveReportHistory();
  }
  // 若删的是当前选中方向，切回第一个推荐方向
  if(p.topic===label){
    var _tps=generateTopicsFromKb(p).filter(function(t){return t.type!=='custom';});
    var _fallback=(_tps[0]&&_tps[0].label)||(p.city+'主导产业补链');
    persist();
    selectTopic(_fallback);
    toast('✓ 已删除方向「'+label+'」');
    return;
  }
  persist();
  // 仅刷新卡片网格
  var cardGrid=document.getElementById('topicCardGrid');
  if(cardGrid){
    var topics=generateTopicsFromKb(p);
    cardGrid.innerHTML=topics.map(function(t){return topicCardHtml(t,p.topic===t.label);}).join('');
  }
  toast('✓ 已删除方向「'+label+'」');
}

function startAiInterview(){
  var p=P(); if(!p) return;
  var inp=document.getElementById('topicCustomInput');
  if(inp&&inp.value.trim()) p.topic=inp.value.trim();
  if(!p.topic){toast('请先选择或输入产业方向');return;}
  window._reportGenerating=true; // 阻止ensureAiTopics回调触发render()覆盖访谈UI
  persist();

  _interviewState = { answers: [], currentQ: 0, topic: p.topic };

  // 定义访谈问题（根据产业分析缺少的维度逐个提问）
  _interviewState.questions = [
    { id:'industry_base', q:'关于「'+p.topic+'」方向，'+p.city+'目前的产业基础情况如何？（如：现有企业数量、产值规模、产业链已覆盖的环节等）' },
    { id:'park_info', q:'承接该方向的目标园区是哪个？园区有哪些配套条件？（如：土地面积、标准厂房、已入驻企业、优惠政策等）' },
    { id:'policy', q:'当地政府针对「'+p.topic+'」方向有哪些专项政策支持？（如：专项资金额度、税收优惠、人才引进补贴等）' },
    { id:'target_enterprise', q:'目前已有意向接触的目标企业有哪些？它们的规模和合作意向如何？' },
    { id:'connections', q:'我们可能会尝试通过高校圈和商会圈接触企业高管。为便于梳理可用关系网络，想了解贵方主要领导的毕业院校、曾长期居住的城市，以及曾在哪些城市担任过主职工作。' },
    { id:'gaps', q:'您认为目前该方向最急需补齐的产业链环节是什么？有没有已经明确的"卡脖子"问题？' }
  ];

  renderInterviewUI();
}

function renderInterviewUI(){
  var area=document.getElementById('reportArea');
  if(!area) return;
  var q = _interviewState.questions[_interviewState.currentQ];
  var total = _interviewState.questions.length;
  var cur = _interviewState.currentQ + 1;
  var p=P();

  var answeredHtml = _interviewState.answers.map(function(a, i){
    if(!a.text) return '';
    return '<div style="margin-bottom:8px;padding:8px 12px;background:#f8faff;border-radius:8px;font-size:12px">'+
      '<div style="color:#9aa5b5;margin-bottom:2px">Q'+(i+1)+'：'+_interviewState.questions[i].q+'</div>'+
      '<div style="color:#1e293b">'+a.text+'</div>'+
    '</div>';
  }).filter(Boolean).join('');

  area.innerHTML =
    '<div style="padding:20px">'+
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">'+
        '<div style="width:36px;height:36px;background:linear-gradient(135deg,#1a56db,#6366f1);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;font-weight:800">AI</div>'+
        '<div>'+
          '<div style="font-size:15px;font-weight:700;color:#0b183b">产业分析访谈</div>'+
          '<div style="font-size:12px;color:#8492a6">方向：'+_interviewState.topic+' · 问题 '+cur+'/'+total+'</div>'+
        '</div>'+
        '<div style="flex:1"></div>'+
        '<div style="width:120px;height:6px;background:#e8edf5;border-radius:3px;overflow:hidden">'+
          '<div style="width:'+(cur/total*100)+'%;height:100%;background:linear-gradient(90deg,#1a56db,#6366f1);border-radius:3px;transition:width .3s"></div>'+
        '</div>'+
        '<span style="font-size:11px;color:#9aa5b5">'+cur+'/'+total+'</span>'+
      '</div>'+
      (answeredHtml?'<div style="margin-bottom:12px;max-height:120px;overflow-y:auto">'+answeredHtml+'</div>':'')+
      '<div style="background:#fff;border:1.5px solid #e8edf5;border-radius:14px;padding:20px;margin-bottom:16px">'+
        '<div style="font-size:14px;color:#1e293b;line-height:1.8;margin-bottom:16px">'+q.q+'</div>'+
        '<textarea id="interviewAnswer" placeholder="输入您的回答…（如暂时不清楚可点击跳过）" style="width:100%;box-sizing:border-box;min-height:100px;padding:12px;border:1.5px solid #e8edf5;border-radius:10px;font-size:13px;line-height:1.7;outline:none;resize:vertical" >'+(_interviewState.answers[_interviewState.currentQ]?(_interviewState.answers[_interviewState.currentQ].text||''):'')+'</textarea>'+
      '</div>'+
      '<div style="display:flex;gap:10px;align-items:center">'+
        (_interviewState.currentQ>0?'<button onclick="interviewPrev()" style="padding:10px 20px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:10px;font-size:13px;color:#4a5568;cursor:pointer;font-weight:600">← 上一题</button>':'')+
        '<div style="flex:1"></div>'+
        '<button onclick="interviewSkip()" style="padding:10px 20px;background:#fff;border:1.5px solid #e8edf5;border-radius:10px;font-size:13px;color:#9aa5b5;cursor:pointer">跳过</button>'+
        (cur<total?'<button onclick="interviewNext()" style="padding:10px 24px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:650;cursor:pointer">下一题 →</button>':
        '<button onclick="interviewDone()" style="padding:10px 24px;background:linear-gradient(135deg,#059669,#10b981);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:650;cursor:pointer">完成访谈，开始分析</button>')+
      '</div>'+
    '</div>';
}

function interviewNext(){
  var textarea=document.getElementById('interviewAnswer');
  var text=(textarea?textarea.value:'').trim();
  if(!text){
    toast('请先作答，或点击「跳过」');
    if(textarea){ textarea.focus(); textarea.style.border='1.5px solid #f59e0b'; }
    return;
  }
  _interviewState.answers[_interviewState.currentQ]={text:text, id:_interviewState.questions[_interviewState.currentQ].id};
  _interviewState.currentQ++;
  renderInterviewUI();
}

function interviewSkip(){
  _interviewState.answers[_interviewState.currentQ]={text:'', id:_interviewState.questions[_interviewState.currentQ].id, skipped:true};
  _interviewState.currentQ++;
  if(_interviewState.currentQ>=_interviewState.questions.length){
    interviewDone();
  } else {
    renderInterviewUI();
  }
}

function interviewPrev(){
  var textarea=document.getElementById('interviewAnswer');
  var text=(textarea?textarea.value:'').trim();
  _interviewState.answers[_interviewState.currentQ]={text:text, id:_interviewState.questions[_interviewState.currentQ].id};
  _interviewState.currentQ--;
  renderInterviewUI();
}

function interviewDone(){
  // Save last answer
  var textarea=document.getElementById('interviewAnswer');
  // 边界保护：全部跳过后 currentQ 可能已越界(=questions.length)，直接读 .id 会崩溃导致报告永远无法触发
  if(textarea && _interviewState.questions[_interviewState.currentQ]){
    var text=textarea.value.trim();
    _interviewState.answers[_interviewState.currentQ]={text:text, id:_interviewState.questions[_interviewState.currentQ].id};
  }
  // Collect all non-empty answers into context for the analysis
  var context=_interviewState.answers.filter(function(a){return a&&a.text;}).map(function(a){
    var qObj=_interviewState.questions.find(function(q){return q.id===a.id;});
    return '【'+qObj.q.substring(0,20)+'…】'+a.text;
  }).join('\n');
  // Store interview context for use in triggerReport
  window._interviewContext=context;
  // 将有答案的问答存入kb"产业分析AI问答"板块（供管理端城市智库RAG查看）
  var _qaItems=_interviewState.answers.filter(function(a){return a&&a.text;}).map(function(a){
    var qObj=_interviewState.questions.find(function(q){return q.id===a.id;});
    return {text:'【'+_interviewState.topic+'】'+qObj.q+'\n答：'+a.text, origin:'user', nature:'interview'};
  });
  if(_qaItems.length){
    var p=P(); if(p&&p.kb){
      // 查找或创建"产业分析AI问答"板块
      var _qaSection=p.kb.find(function(s){return s.t==='产业分析AI问答';});
      if(!_qaSection){
        _qaSection={icon:'🤖',t:'产业分析AI问答',sub:'政府端访谈问答记录',tag:'ai-interview',known:[],calls:[]};
        p.kb.push(_qaSection);
      }
      // 追加新的问答条目（去重：同方向同问题不重复添加）
      _qaItems.forEach(function(item){
        var exists=_qaSection.known.some(function(k){
          var kt=typeof k==='string'?k:(k.text||'');
          return kt===item.text;
        });
        if(!exists) _qaSection.known.push(item);
      });
      persist();
    }
  }
  // Now trigger the actual analysis
  triggerReport(1);
}

function triggerReport(phase){
  window._reportGenerating=true;
  phase=phase||1;
  var p=P(); if(!p) return;
  var inp=document.getElementById('topicCustomInput');
  if(inp&&inp.value.trim()) p.topic=inp.value.trim();
  persist();
  var area=document.getElementById('reportArea');
  if(!area) return;
  var r=kbReadiness();
  var corpus=buildKBCorpus(p.city);
  var interviewCtx=window._interviewContext||'';
  var query=phase===1
    ? '请基于'+p.city+'城市智库数据，针对「'+p.topic+'」方向'+(interviewCtx?'，结合以下访谈信息：\n'+interviewCtx+'\n':'')+',快速输出300字以内草稿：①3个关键缺口（附数据）②3个招引方向（标类型）③3条待确认事项（⚠️开头）④数据可靠性。用⚠️标注不确定判断。'
    : '请基于'+p.city+'城市智库数据，针对「'+p.topic+'」方向，输出完整招商研判报告。\n**严格规则**：\n1. 所有具体数字（金额/比例/面积/家数）**必须**来自给定知识片段原文，禁止编造或推测；\n2. 若某数字知识片段中没有，写「待核实」或省略，不要凭常识补写；\n3. 尤其是政策数字（补贴上限/比例/临床奖励等）必须逐字引用片段原文；\n4. 引用政策/园区数字时后面加括号标注来源片段编号（如「按10%最高5000万元支持（政策规划研究）」）。\n\n严格按五章结构：\n一、产业基础判断（具体数字，来自知识片段）\n二、产业链缺口分析（逐环节标注✅已有/⚠️薄弱/❌缺失，标注本地化属性A必须本地化/B可跨区域/C优先本地化）\n三、补链优先级清单TOP5（表格格式：缺口节点|本地化属性|经济拉动★|招引可行性★|综合优先级）\n四、目标企业画像（每个TOP缺口：目标企业类型+规模+开口话术模板）\n五、待确认事项（⚠️标注每条需确认的专项资金/园区地块/政策口径）';
  var chunks=kbSearch(query,corpus,phase===1?5:8);
  // 关键修复：政策/园区类权威片段无论向量匹配得分如何，都强制注入报告 context。
  // 否则 AI 会在报告里编造"固投1亿元以上按30%补贴"这种与知识库权威值冲突的数字。
  (function(){
    var authTopics=['政策','园区','规划','产业','主导','链主','企业'];
    var byId={}; chunks.forEach(function(c){byId[c.id]=1;});
    corpus.forEach(function(c){
      if(byId[c.id]) return;
      var topic=c.topic||''; var tags=(c.tags||[]).join(',');
      var isAuth=authTopics.some(function(t){return topic.indexOf(t)>=0 || tags.indexOf(t)>=0;});
      // 含数字（%、亿元、万元、平方公里等）的政策/园区/规划片段是数字来源，必须进 prompt
      var hasNum=/\d/.test(c.text||'');
      if(isAuth && hasNum){ chunks.push(c); byId[c.id]=1; }
    });
    // 上限 20 条，避免 prompt 过长
    if(chunks.length>20) chunks=chunks.slice(0,20);
  })();
  var t0=Date.now(); var accText='';
  if(!document.getElementById('spinStyle')){
    var s=document.createElement('style');s.id='spinStyle';
    s.textContent='@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(s);
  }
  // 保留/创建历史报告容器
  if(!document.getElementById('reportHistoryArea')){
    var _ha=document.createElement('div');
    _ha.id='reportHistoryArea';
    area.insertBefore(_ha, area.firstChild);
  }
  renderHistoryReports(cur);
  // 清除旧报告内容（保留历史区）
  Array.from(area.children).forEach(function(c){if(c.id!=='reportHistoryArea')c.remove();});
  setReportAreaHtml(area,
    '<div style="border-radius:16px;border:1.5px solid '+(phase===1?'#fed7aa':'#bfdbfe')+';overflow:hidden;margin-bottom:8px;box-shadow:0 2px 12px rgba(0,0,0,0.06)">'+
      '<div style="padding:14px 18px;background:'+(phase===1?'linear-gradient(135deg,#fffbeb,#fef3c7)':'linear-gradient(135deg,#eff6ff,#f0f9ff)')+';border-bottom:1px solid '+(phase===1?'#fde68a':'#e0f2fe')+';display:flex;align-items:center;gap:10px">'+
        '<span style="font-size:20px">'+(phase===1?'📋':'📊')+'</span>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:13.5px;font-weight:800;color:'+(phase===1?'#92400e':'#1d4ed8')+';letter-spacing:.2px">'+(phase===1?'初步研判草稿':'完整产业分析报告')+'</div>'+
          '<div style="font-size:11.5px;color:'+(phase===1?'#b45309':'#3b82f6')+';margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+p.topic+'</div>'+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:8px">'+
          '<span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:'+(topicScore(p.topic)>=80?'#dcfce7':'#fef9c3')+';color:'+(topicScore(p.topic)>=80?'#166534':'#92400e')+';border:1px solid '+(topicScore(p.topic)>=80?'#86efac':'#fde68a')+'">置信度 '+topicScore(p.topic)+'%</span>'+
          '<div id="reportSpinner" style="width:18px;height:18px;border:2.5px solid #e2e8f0;border-top-color:'+(phase===1?'#f59e0b':'#1a56db')+';border-radius:50%;animation:spin 1s linear infinite;flex-shrink:0"></div>'+
        '</div>'+
      '</div>'+
      '<div id="reportContent" style="padding:20px 22px;font-size:13px;color:#1e293b;line-height:1.85;min-height:80px">'+
        '<div style="display:flex;align-items:center;gap:8px;color:#9aa5b5">'+
          '<div style="width:6px;height:6px;border-radius:50%;background:'+(phase===1?'#f59e0b':'#1a56db')+';animation:spin .8s linear infinite"></div>'+
          '<span style="font-size:12.5px">'+(phase===1?'AI 正在分析产业链数据，约 10 秒…':'定点深度分析中，约 60 秒…')+'</span>'+
        '</div>'+
      '</div>'+
      '<div id="reportFooter" style="display:none;padding:8px 18px;background:#f8faff;border-top:1px solid #f0f4ff;font-size:11px;color:#9aa5b5"></div>'+
    '</div>');
  var content=document.getElementById('reportContent');
  // ── phase 2「定点分析」：≥60s 的分步分析动画，报告在分析走完后才揭示 ──
  var analysisGate={ready:false, done:false, minElapsed:false, cb:null};
  if(phase===2 && content){
    var steps=[
      ['🔍 检索城市智库与上传材料','匹配「'+p.topic+'」相关知识片段'],
      ['🧬 拆解产业链环节','逐环节判定 ✅已有 / ⚠️薄弱 / ❌缺失'],
      ['📊 量化缺口与本地化属性','测算经济拉动与招引可行性'],
      ['🏭 定点匹配目标企业','筛选具备扩张/迁移信号的候选'],
      ['🧩 生成补链优先级清单','排序 TOP5 并核验数据来源'],
      ['📝 撰写研判结论','结构化五章报告 + 待确认事项']
    ];
    var stepHtml='<div style="display:flex;flex-direction:column;gap:2px">'+
      steps.map(function(s,i){
        return '<div id="anaStep'+i+'" style="display:flex;align-items:flex-start;gap:10px;padding:9px 4px;opacity:.35;transition:opacity .4s">'+
          '<span id="anaIco'+i+'" style="flex-shrink:0;width:20px;height:20px;border-radius:50%;border:2px solid #cbd5e1;display:inline-flex;align-items:center;justify-content:center;font-size:11px;color:#94a3b8">'+(i+1)+'</span>'+
          '<div style="flex:1"><div style="font-size:13px;font-weight:650;color:#0b183b">'+s[0]+'</div>'+
          '<div style="font-size:11.5px;color:#8492a6;margin-top:1px">'+s[1]+'</div></div>'+
          '<span id="anaChk'+i+'" style="flex-shrink:0;font-size:13px;color:#22c55e;opacity:0">✓</span>'+
        '</div>';
      }).join('')+
      '<div style="margin-top:10px"><div style="height:5px;background:#f0f4ff;border-radius:3px;overflow:hidden"><div id="anaBar" style="height:100%;width:0;background:linear-gradient(90deg,#1a56db,#6366f1);border-radius:3px;transition:width .6s"></div></div>'+
      '<div id="anaHint" style="font-size:11px;color:#9aa5b5;margin-top:6px;text-align:center">定点分析中，预计约 60 秒…</div></div>'+
    '</div>';
    content.innerHTML=stepHtml;
    var totalMs=62000, perStep=totalMs/steps.length;
    var si=0;
    function lightStep(i){
      var el=document.getElementById('anaStep'+i); if(!el)return;
      el.style.opacity='1';
      var ico=document.getElementById('anaIco'+i);
      if(ico){ico.style.borderColor='#1a56db';ico.style.color='#1a56db';ico.style.borderTopColor='#1a56db';ico.style.animation='spin 1s linear infinite';}
      var bar=document.getElementById('anaBar'); if(bar)bar.style.width=Math.round((i+0.5)/steps.length*100)+'%';
    }
    function finishStep(i){
      var ico=document.getElementById('anaIco'+i);
      if(ico){ico.style.animation='';ico.style.background='#22c55e';ico.style.borderColor='#22c55e';ico.textContent='';}
      var chk=document.getElementById('anaChk'+i); if(chk)chk.style.opacity='1';
    }
    function runStep(){
      if(si>0)finishStep(si-1);
      if(si<steps.length){ lightStep(si); si++; setTimeout(runStep, perStep); }
      else {
        var bar=document.getElementById('anaBar'); if(bar)bar.style.width='100%';
        var hint=document.getElementById('anaHint');
        analysisGate.minElapsed=true;
        if(analysisGate.ready){ analysisGate.reveal&&analysisGate.reveal(); }
        else if(hint){ hint.textContent='分析完成，正在整合模型输出…'; }
      }
    }
    setTimeout(runStep, 300);
  }
  function renderMd(md){
    md=md.replace(/\n{3,}/g,'\n\n');
    md=md.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    md=md.replace(/\*\*([^*\n]+)\*\*/g,'<strong style="color:#0b183b">$1</strong>');
    md=md.replace(/`([^`]+)`/g,'<code style="background:#f0f4ff;color:#1a56db;padding:1px 5px;border-radius:4px;font-size:11.5px">$1</code>');
    md=md.replace(/⚠️/g,'<span style="color:#d97706;font-weight:600">⚠️</span>');
    md=md.replace(/✅/g,'<span style="color:#16a34a">✅</span>');
    md=md.replace(/❌/g,'<span style="color:#dc2626">❌</span>');
    md=md.replace(/★+/g,function(m){return '<span style="color:#f59e0b;letter-spacing:1px">'+m+'</span>';});
    md=md.replace(/A[=]必须本地化/g,'<span style="padding:1px 6px;background:#fee2e2;color:#991b1b;border-radius:4px;font-size:11px;font-weight:600">A 必须本地化</span>');
    md=md.replace(/B[=]可跨区域/g,'<span style="padding:1px 6px;background:#dbeafe;color:#1e3a8a;border-radius:4px;font-size:11px;font-weight:600">B 可跨区域</span>');
    md=md.replace(/C[=]优先本地化/g,'<span style="padding:1px 6px;background:#d1fae5;color:#064e3b;border-radius:4px;font-size:11px;font-weight:600">C 优先本地化</span>');
    // 章节标题：## 一、格式 和 纯 一、格式，统一渲染，防止双重
    md=md.replace(/^#{0,3}\s*([一二三四五六七八九十]+)[、]\s*(.+)$/gm,function(m,num,title){
      return '<div style="display:flex;align-items:center;gap:10px;margin:20px 0 8px;padding-bottom:7px;border-bottom:2px solid #1a56db">'+
        '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;background:#1a56db;color:#fff;border-radius:50%;font-size:12px;font-weight:700;flex-shrink:0">'+num+'</span>'+
        '<span style="font-size:14px;font-weight:750;color:#0b183b">'+title+'</span>'+
      '</div>';
    });
    md=md.replace(/^###\s(.+)$/gm,'<div style="font-size:13px;font-weight:700;color:#4a5568;margin:10px 0 4px;padding-left:10px;border-left:3px solid #6366f1">$1</div>');
    md=md.replace(/^##\s(.+)$/gm,'<div style="font-size:13.5px;font-weight:750;color:#0b183b;margin:12px 0 6px;padding:5px 12px;background:#f8faff;border-radius:8px;border-left:4px solid #1a56db">$1</div>');
    md=md.replace(/^#\s(.+)$/gm,'<div style="font-size:15px;font-weight:800;color:#0b183b;margin:14px 0 8px">$1</div>');
    // 表格逐行解析（正确跳过分隔行）
    var outLines=[]; var inTbl=false;
    var mdLines=md.split('\n');
    for(var li=0;li<mdLines.length;li++){
      var line=mdLines[li];
      var tr=line.trim();
      if(tr.charAt(0)==='|'&&tr.charAt(tr.length-1)==='|'){
        var isSep=tr.slice(1,-1).split('|').every(function(c){return /^[\s\-:]+$/.test(c);});
        if(isSep) continue;
        var cells=tr.slice(1,-1).split('|').map(function(c){return c.trim();});
        if(!inTbl){
          inTbl=true;
          outLines.push('<div style="overflow-x:auto;margin:10px 0"><table style="width:100%;border-collapse:collapse;font-size:12.5px">');
          outLines.push('<thead><tr>'+cells.map(function(c){
            return '<th style="padding:8px 12px;background:#f0f4ff;border:1px solid #dbeafe;font-weight:700;color:#1e3a8a;text-align:left;white-space:nowrap">'+c+'</th>';
          }).join('')+'</tr></thead><tbody>');
        } else {
          outLines.push('<tr>'+cells.map(function(c,ci){
            return '<td style="padding:8px 12px;border:1px solid #e8edf5;color:#1e293b;vertical-align:top;background:'+(ci===0?'#fafbff':'#fff')+'">'+c+'</td>';
          }).join('')+'</tr>');
        }
      } else {
        if(inTbl){outLines.push('</tbody></table></div>');inTbl=false;}
        outLines.push(line);
      }
    }
    if(inTbl)outLines.push('</tbody></table></div>');
    md=outLines.join('\n');
    // 列表
    md=md.replace(/^[-•]\s(.+)$/gm,'<li style="margin:4px 0;color:#1e293b">$1</li>');
    md=md.replace(/^\d+\.\s(.+)$/gm,'<li style="margin:4px 0;color:#1e293b">$1</li>');
    // 段落：空行分隔，block 元素不再包裹
    var parts=md.split('\n\n');
    md=parts.map(function(chunk){
      var c=chunk.trim();
      if(!c) return '';
      if(/^<(div|table|ul|ol|li|thead|tbody|tr)/.test(c)) return c;
      return '<p style="margin:5px 0;line-height:1.85;color:#1e293b">'+c.replace(/\n/g,'<br>')+'</p>';
    }).filter(Boolean).join('\n');
    return md;
  }
  // 超时保护：45秒后abort挂起的流式连接，强制触发catch处理部分文本
  // Abort之前的请求（防止多次triggerReport并行冲突）
  if(window._activeReportAbort) try{window._activeReportAbort.abort();}catch(e){}
  var _abortCtrl=new AbortController();
  window._activeReportAbort=_abortCtrl;
  var _reportTimeout=setTimeout(function(){
    _abortCtrl.abort();
    if(accText.length>50){
      console.warn('[report] timeout 45s, forcing reveal with partial text, len='+accText.length);
      window._reportGenerating=false;
      var _c=document.getElementById('reportContent');
      if(_c) _c.innerHTML='<p style="margin:0">'+renderMd(accText)+'</p>';
      var _sp=document.getElementById('reportSpinner'); if(_sp) _sp.style.display='none';
      // 写入REPORTSTATE（含phaseByTopic确保render后bottomBar正确识别草稿状态）
      REPORTSTATE[cur]=REPORTSTATE[cur]||{};
      REPORTSTATE[cur].text=accText; REPORTSTATE[cur].topic=p.topic; REPORTSTATE[cur].ts=Date.now();
      REPORTSTATE[cur].phase=1;
      if(!REPORTSTATE[cur].phaseByTopic) REPORTSTATE[cur].phaseByTopic={};
      REPORTSTATE[cur].phaseByTopic[p.topic]=1;
      if(!REPORTSTATE[cur].aiReportByTopic) REPORTSTATE[cur].aiReportByTopic={};
      REPORTSTATE[cur].aiReportByTopic[p.topic]=accText;
      // 冻结当前部分报告的置信度，避免超时后 UI 继续漂移
      if(!REPORTSTATE[cur].scoreByTopic) REPORTSTATE[cur].scoreByTopic={};
      delete REPORTSTATE[cur].scoreByTopic[p.topic];
      REPORTSTATE[cur].score=topicScore(p.topic);
      REPORTSTATE[cur].scoreByTopic[p.topic]=REPORTSTATE[cur].score;
      if(!REPORTSTATE[cur].userGeneratedTopics) REPORTSTATE[cur].userGeneratedTopics={};
      REPORTSTATE[cur].userGeneratedTopics[p.topic]=true;
      var _bb=document.querySelector('.report-bottom-bar');
      if(_bb && phase===1){
        var _pi=parsePendingItems(accText);
        if(_pi.length>0){ PENDING_CONFIRMS[cur]=_pi; if(!REPORTSTATE[cur].pendingByTopic)REPORTSTATE[cur].pendingByTopic={}; REPORTSTATE[cur].pendingByTopic[p.topic]=_pi; }
        persist();
        _bb.innerHTML=
          '<div style="flex:1;font-size:12.5px;color:#92400e;background:#fffbeb;padding:10px 14px;border-radius:10px;border:1px solid #fde68a;line-height:1.6">'+
            '初步研判已完成（部分数据可能因超时截断），确认方向后生成完整五章报告'+
          '</div>'+
          '<button onclick="triggerReport(2)" style="padding:12px 20px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:13.5px;font-weight:650;cursor:pointer;white-space:nowrap">生成完整产业报告 \u2192</button>'+
          '<button onclick="doUpload()" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">\ud83d\udcce 补充材料</button>';
      } else { persist(); }
    }
  }, phase===2?180000:90000); // phase2需要>62s动画+AI响应时间
  fetch('/api/kb-chat',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question:query,chunks:chunks,city:p.city,stream:true,mode:phase===1?'draft':'full',prefs:curOnbPrefs()}),
    signal:_abortCtrl.signal
  }).then(function(resp){
    if(!resp.ok){
      if(content) content.innerHTML='<span style="color:#ef4444">服务错误：'+resp.status+'<br><small>AI 服务暂时不可用，请稍后重试</small></span>';
      return;
    }
    var reader=resp.body.getReader(); var decoder=new TextDecoder(); var buf='';
    function pump(){
      return reader.read().then(function(d){
        if(d.done){
          // phase 2：DeepSeek 已返回，但报告须等「定点分析」动画走完（≥60s）才揭示
          if(phase===2 && !analysisGate.minElapsed){
            analysisGate.ready=true;
            analysisGate.reveal=function(){ revealReport(); };
            return;
          }
          revealReport();
          return;
        }
        buf+=decoder.decode(d.value,{stream:true});
        var lines2=buf.split('\n'); buf=lines2.pop();
        lines2.forEach(function(line){
          if(!line.startsWith('data:')) return;
          var d2=line.slice(5).trim(); if(d2==='[DONE]') return;
          try{
            var j=JSON.parse(d2);
            var delta=j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content||'';
            // phase 2 分析动画期间先缓冲，不实时冲掉分析步骤
            if(delta){ accText+=delta; window._liveAccText=accText; var _liveC=document.getElementById('reportContent'); if(_liveC && phase!==2) _liveC.innerHTML='<p style="margin:0">'+renderMd(accText)+'</p>'; }
          }catch(e){}
        });
        pump();
        return;
        return;

        function revealReport(){
          if(_reportTimeout) clearTimeout(_reportTimeout);
          window._liveAccText=null; // 生成完毕，清除临时文本
  // 报告完成后自动生成产业链图谱（仅无硬编码链的方向才需要动态生成）
  // 先清除当前方向的旧链缓存，确保基于新报告重新生成（不影响其他方向）
  var _rp=P(); if(_rp&&_rp.topic&&!pickChainKey(_rp.topic)){
    if(REPORTSTATE[cur]&&REPORTSTATE[cur].chainByTopic) REPORTSTATE[cur].chainByTopic[_rp.topic]=null;
    generateChainFromReport(_rp.topic, accText, _rp.city);
  }
          var elapsed=Date.now()-t0;
          var _liveContent=document.getElementById('reportContent'); if(_liveContent) _liveContent.innerHTML='<p style="margin:0">'+renderMd(accText)+'</p>';
          // 归档旧报告
          archiveCurrentReport(cur);
          renderHistoryReports(cur);
          // 保留累积字段(aiReportByTopic/userGeneratedTopics/pendingByTopic 等)，避免整体覆盖丢失
          var _prevRs=REPORTSTATE[cur]||{};
          var _nowTs=Date.now();
          // 计算最终置信度前先把 accText 挂到方向缓存 + 清掉旧冻结值，
          // 保证 topicScore 基于本次完整报告重算一次，然后再写回冻结。
          if(_prevRs.aiReportByTopic){ _prevRs.aiReportByTopic[p.topic]=accText; }
          if(_prevRs.scoreByTopic){ delete _prevRs.scoreByTopic[p.topic]; }
          var _nowScore=topicScore(p.topic);
          REPORTSTATE[cur]={text:accText,topic:p.topic,ts:_nowTs,score:_nowScore,phase:phase,
            aiReportByTopic:_prevRs.aiReportByTopic||{},
            userGeneratedTopics:_prevRs.userGeneratedTopics||{},
            pendingByTopic:_prevRs.pendingByTopic||{},
            phaseByTopic:_prevRs.phaseByTopic||{},
            actionItemsByTopic:_prevRs.actionItemsByTopic||{},
            scoreByTopic:_prevRs.scoreByTopic||{},
            tsByTopic:_prevRs.tsByTopic||{},
            chainByTopic:_prevRs.chainByTopic||{}};
          // 标记该方向为「用户已显式生成」，允许日后后台 AI 刷新（新方向在此之前不会凭空生成报告）
          REPORTSTATE[cur].userGeneratedTopics[p.topic]=true;
          // 用户生成的报告也作为该方向的 AI 报告缓存，刷新后可正确恢复
          REPORTSTATE[cur].aiReportByTopic[p.topic]=accText;
          // 按方向记录阶段（1=草稿/2=完整）：项目级 phase 是单例、切方向会污染，方向级才是权威判据
          REPORTSTATE[cur].phaseByTopic[p.topic]=phase;
          // 按方向记录 score/ts：历史卡片必须读方向级字段，否则会出现 0% 与错误时间戳（fix 2026-08-28）
          REPORTSTATE[cur].scoreByTopic[p.topic]=_nowScore;
          REPORTSTATE[cur].tsByTopic[p.topic]=_nowTs;
          persist();
          var sp=document.getElementById('reportSpinner');if(sp)sp.style.display='none';
          var footer=document.getElementById('reportFooter');
          if(footer){
            var cites=[...new Set(chunks.map(function(c){return c.cite;}).filter(Boolean))];
            footer.innerHTML='数据来源：'+cites.map(function(c){
              return '<span style="padding:1px 6px;background:#f0f4ff;color:#1a56db;border-radius:4px;font-size:10.5px">'+c+'</span>';
            }).join(' ')+' · DeepSeek · '+elapsed+'ms · 置信度 '+topicScore(p.topic)+'%';
            footer.style.display='block';
          }
          var bottomBar=document.querySelector('.report-bottom-bar');
          if(bottomBar){
            if(phase===1){
              // 解析⚠️ → 渲染确认面板
              var pendingItems=parsePendingItems(accText);
              if(pendingItems.length>0){
                // draft 的待确认清单是本方向的权威来源：以新解析结果为准，
                // 但保留同文本条目的已有确认状态，避免误混旧方向残留项。
                var _prevByText={};
                (PENDING_CONFIRMS[cur]||[]).forEach(function(x){ _prevByText[x.text]=x; });
                PENDING_CONFIRMS[cur]=pendingItems.map(function(it){
                  var prev=_prevByText[it.text];
                  return prev?prev:it;
                });
                // 按当前方向缓存，切换方向时可正确恢复
                if(!REPORTSTATE[cur].pendingByTopic) REPORTSTATE[cur].pendingByTopic={};
                REPORTSTATE[cur].pendingByTopic[p.topic]=PENDING_CONFIRMS[cur];
                persist();
                // 把确认面板插到报告区下方（避免重复）
                var reportArea=document.getElementById('reportArea');
                if(reportArea && !document.getElementById('confirmPanel-'+cur)){
                  var panelHtml=renderConfirmPanel(PENDING_CONFIRMS[cur],cur);
                  var panelDiv=document.createElement('div');
                  panelDiv.innerHTML=panelHtml;
                  reportArea.appendChild(panelDiv.firstChild);
                }
              }
              // 底部：根据是否有待确认项决定按钮状态
              var hasPending=PENDING_CONFIRMS[cur]&&PENDING_CONFIRMS[cur].length>0;
              var allDone=hasPending&&PENDING_CONFIRMS[cur].every(function(x){return x.status==='confirmed'||x.status==='edited';});
              bottomBar.innerHTML=
                '<div style="flex:1;font-size:12.5px;color:#92400e;background:#fffbeb;padding:10px 14px;border-radius:10px;border:1px solid #fde68a;line-height:1.6">'+
                  (hasPending&&!allDone?'请确认上方待确认事项后，才可生成完整产业报告':'以上为初步研判草稿，确认方向后生成完整五章报告')+
                '</div>'+
                '<button onclick="triggerReport(2)" '+(allDone||!hasPending?'':'disabled style="opacity:.4;cursor:not-allowed;"')+' style="padding:12px 20px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:13.5px;font-weight:650;cursor:pointer;white-space:nowrap">' +(allDone||!hasPending?'生成完整产业报告 →':'待确认后生成 →')+'</button>'+
                '<button onclick="doUpload()" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">📎 补充材料</button>';
            } else {
              bottomBar.innerHTML=
                '<button onclick="startAiInterview()" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">🔄 重新生成</button>'+
                '<button onclick="doUpload()" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">📎 补充材料</button>'+
                '<button onclick="submitDemand()" style="flex:1;padding:12px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:650;cursor:pointer">✓ 批量提交招商需求</button>';
              // 产业链图谱：完整报告生成后动态追加，避免须重新进入页面才能看到
              var _raEl=document.getElementById('reportArea');
              if(_raEl && !document.getElementById('chainMapBlock')){
                var _cmEl=document.createElement('div');
                _cmEl.id='chainMapBlock';
                _cmEl.innerHTML=chainMapHtml(p);
                _raEl.appendChild(_cmEl);
              }
            }
          }
          // 数据已全部保存，解锁
          window._reportGenerating=false;
          if(phase===2){
            // phase2完整报告：等图谱生成完再render（图谱+招引方向一并显示）
            var _chainDone=REPORTSTATE[cur]&&REPORTSTATE[cur].chainByTopic&&REPORTSTATE[cur].chainByTopic[p.topic]&&REPORTSTATE[cur].chainByTopic[p.topic]!=='loading';
            if(_chainDone){
              if(view==='report') render();
            } else {
              // 图谱还在生成，先显示报告正文，图谱完成后会自动触发render
              if(view==='report') render();
            }
          } else {
            // phase1草稿：直接render显示草稿+待确认面板
            if(view==='report') render();
          }
          return;
        }
      });
    }
    pump();
  }).catch(function(err){
    if(_reportTimeout) clearTimeout(_reportTimeout);
    // 流中断但已有部分文本时，仍然显示草稿结果（Railway超时常见）
    if(accText.length>50){
      window._reportGenerating=false;
      if(content) content.innerHTML='<p style="margin:0">'+renderMd(accText)+'</p>';
      var _sp2=document.getElementById('reportSpinner'); if(_sp2) _sp2.style.display='none';
      // 保存已有结果
      var _prevRs2=REPORTSTATE[cur]||{};
      var _nowTs2=Date.now();
      var _nowScore2=topicScore(p.topic);
      REPORTSTATE[cur]={text:accText,topic:p.topic,ts:_nowTs2,score:_nowScore2,phase:phase,
        aiReportByTopic:_prevRs2.aiReportByTopic||{},userGeneratedTopics:_prevRs2.userGeneratedTopics||{},
        pendingByTopic:_prevRs2.pendingByTopic||{},phaseByTopic:_prevRs2.phaseByTopic||{},
        actionItemsByTopic:_prevRs2.actionItemsByTopic||{},
        scoreByTopic:_prevRs2.scoreByTopic||{},tsByTopic:_prevRs2.tsByTopic||{},
        chainByTopic:_prevRs2.chainByTopic||{}};
      REPORTSTATE[cur].aiReportByTopic[p.topic]=accText;
      REPORTSTATE[cur].phaseByTopic[p.topic]=phase;
      // 按方向记录 score/ts（fix 2026-08-28）
      REPORTSTATE[cur].scoreByTopic[p.topic]=_nowScore2;
      REPORTSTATE[cur].tsByTopic[p.topic]=_nowTs2;
      // phase1时解析待确认并显示底部按钮
      var _bb2=document.querySelector('.report-bottom-bar');
      if(_bb2 && phase===1){
        var _pi2=parsePendingItems(accText);
        if(_pi2.length>0){ PENDING_CONFIRMS[cur]=_pi2; if(!REPORTSTATE[cur].pendingByTopic)REPORTSTATE[cur].pendingByTopic={}; REPORTSTATE[cur].pendingByTopic[p.topic]=_pi2; }
        var _hasPending2=_pi2.length>0;
        _bb2.innerHTML=
          '<div style="flex:1;font-size:12.5px;color:#92400e;background:#fffbeb;padding:10px 14px;border-radius:10px;border:1px solid #fde68a;line-height:1.6">初步研判完成，确认方向后可生成完整五章报告</div>'+
          '<button onclick="triggerReport(2)" style="padding:12px 20px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:13.5px;font-weight:650;cursor:pointer;white-space:nowrap">生成完整产业报告 \u2192</button>'+
          '<button onclick="doUpload()" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">\ud83d\udcce 补充材料</button>';
        // 渲染确认面板
        if(_pi2.length>0){
          var _ra2=document.getElementById('reportArea');
          if(_ra2 && !document.getElementById('confirmPanel-'+cur)){
            var _pd2=document.createElement('div'); _pd2.innerHTML=renderConfirmPanel(_pi2,cur); _ra2.appendChild(_pd2.firstChild);
          }
        }
      }
      persist();
    } else {
      if(content) content.innerHTML='<span style="color:#ef4444">连接失败：'+err.message+'<br><small>AI 服务暂时不可用，请稍后重试</small></span>';
      window._reportGenerating=false;
    }
  });
}

// 提交招引需求到管理端需求池
function submitDemand(){
  var p=P(); if(!p) return;
  var rs=REPORTSTATE[cur];
  if(!rs){toast('请先生成研判报告'); return;}
  var topic=p.topic;
  // 关键修复：招商需求必须针对「当前研判方向」创建一个独立的 isDemand 子项目，
  // 而不是把父项目工作区(cur, 如 sz)本身推进 stage/派生线索——那会让父项目连同它
  // 随方向变化的 topic 一起混入招商对接，且各方向线索全堆到父项目上。
  // 幂等：同一城市同一方向已提交过则不重复建。
  var dupKey=_findExistingDemand(p.city, topic);
  // 同一需求重复点击只重试同步，不能重复创建，也不能假定已入库。
  var key=dupKey||('proj_'+Date.now().toString(36));
  window._demandSyncPending=window._demandSyncPending||{};
  if(window._demandSyncPending[key]){toast('正在提交，请稍候'); return;}
  if(!dupKey){
  PROJECTS[key]={
    id:key, city:p.city, org:p.org, who:p.who,
    topic:topic, stage:3, isDemand:true,
    kb: JSON.parse(JSON.stringify(p.kb||[])),
    report:null, clues:[],
    stageLog:[{ts:Date.now(), from:2, to:3, note:'招商需求已正式递交', who:'政府端'}]
  };
  // 把当前方向的报告复制给子项目，供招商对接/线索派生使用
  REPORTSTATE[key]=JSON.parse(JSON.stringify(rs));
  REPORTSTATE[key].topic=topic;
  REPORTSTATE[key].phase=2;

  DEMANDS.push({
    id:'d'+Date.now().toString(36),
    projKey:key,
    city:p.city, gov:p.org+'·'+p.who,
    topic:topic, domain:topic.replace('补链','').replace('升级',''),
    need:'基于研判报告（置信度'+topicScore(topic)+'%），见报告全文',
    submit:'刚刚', res:'none', resLabel:'待研判', clues:0,
    note:rs.text?rs.text.slice(0,120)+'…':'', ai:''
  });
  // 待接触企业只由管理端 AI 漏斗精选推送，政府端不再自动派生「脱敏企业」假线索
  // deriveCluesFromReport(key);
  }
  persist();
  window._demandSyncPending[key]=true;
  toast('正在提交，请稍候');
  return Promise.resolve().then(function(){
    var payload=JSON.parse(localStorage.getItem(LS_KEY)||'{}');
    if(!payload.PROJECTS || !payload.PROJECTS[key]) throw new Error('本地保存失败');
    return fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  }).then(function(response){
    if(!response.ok) throw new Error('HTTP '+response.status);
    return response.json();
  }).then(function(result){
    if(!result || result.ok!==true) throw new Error((result&&(result.error||result.rejected))||'服务端未确认保存');
    toast('招引需求已提交，待管理端 AI 漏斗推送精准企业');
  }).catch(function(error){
    console.warn('[demand] sync failed:',error.message);
    toast('提交未确认：'+error.message+'；请重试（不会重复创建需求）');
  }).then(function(){delete window._demandSyncPending[key];});
}

// REPORTSTATE: 存储已生成的报告

// reportHtml: 如果已有报告，直接渲染
/* 各产业链的环节节点名清单（与 chainMapHtml 里的 CHAINS 保持一致），
   供 deriveActionItemsFromChain 等做"当前链环节隔离"，杜绝跨链污染。 */
var CHAIN_NODE_NAMES = {
  '香菇': ['菌种研发','种植采摘','初加工','精深加工','多糖/功能成分提取','品牌出口'],
  '氢能': ['氢气制备','储氢系统','氢燃料电堆','电控系统','车身驾驶室','整车改装'],
  '应急': ['无人机本体','应急机器人','5G通信模块','篷布/风机','移动应急整车'],
  '产业转移': ['沿海存量产能','本地承载能力','配套供应链','品牌/研发']
};
function _chainNodeNames(chainKey){ return CHAIN_NODE_NAMES[chainKey] || []; }

/* 按方向名（topic）隔离产业链图谱数据。
   旧结构：PROJECTS[cur].segmentLevels = { __chainKey, 环节A:{...}, 环节B:{...} }
     问题：所有方向共用一份，同一 chainKey 下的多个 topic 会互相覆盖（例如
           "生物医药制造产能承接"和"创新医疗器械注册承接制造"都归为"产业转移"链，
           后者切过来会命中缓存直接复用前者的研判，AI 根本没跑第二次）。
   新结构：PROJECTS[cur].segmentLevels[topic] = { __chainKey, 环节A:{...}, ... }
     每个方向各存各的图谱结果，切方向 = 换缓存槽。
   兼容：旧顶层结构如果 __chainKey===pickChainKey(topic) 会被识别为该 topic 的数据。 */
function _slFor(topic){
  if(!cur || !PROJECTS[cur] || !PROJECTS[cur].segmentLevels) return null;
  var root = PROJECTS[cur].segmentLevels;
  if(!topic) return null;
  // 新结构：sl[topic] 是对象且带 __chainKey，直接返回
  var per = root[topic];
  if(per && typeof per==='object' && per.__chainKey){
    return per;
  }
  // 兼容旧顶层结构：只有当顶层 __chainKey 与当前 topic 匹配时才把它当作该 topic 的数据
  if(root.__chainKey && root.__chainKey===pickChainKey(topic)){
    return root;
  }
  return null;
}
/* 拿到或创建 sl[topic] 的写入容器；旧顶层 __chainKey 数据保留不动，新数据走方向级。 */
function _slEnsure(topic){
  if(!cur || !PROJECTS[cur]) return null;
  if(!PROJECTS[cur].segmentLevels) PROJECTS[cur].segmentLevels={};
  var root = PROJECTS[cur].segmentLevels;
  if(!topic) return null;
  if(!root[topic] || typeof root[topic]!=='object'){
    root[topic] = {};
  }
  return root[topic];
}

/* 统一选链：topic 关键词 → 产业链 key。匹配不到返回 null（不兜底香菇）。
   覆盖 topic 全称的各种变体（AI 生成的方向名可能是「氢燃料电池电堆及系统招引」）。 */
function pickChainKey(topic){
  topic = topic || '';
  if(/氢能|氢燃料|燃料电池|电堆|储氢|供氢/.test(topic)) return '氢能';
  if(/应急|安全|无人机|机器人|消防|篷布|救援|指挥车/.test(topic)) return '应急';
  if(/香菇|蘑菇|菌|多糖|多肽|食用菌|精深加工|生物提取/.test(topic)) return '香菇';
  // 已废弃「产业转移」通用兜底：具体产业方向（生物医药承接/器械承接等）曾被这个正则
  // 全部吸走塞进同一份通用四节点（沿海存量产能/本地承载/配套供应链/品牌研发）图谱，
  // 导致跨方向串显。现在返回 null，让 chainMapHtml 走 generateChainFromReport 动态生成
  // 各方向真实的产业链拓扑（CDMO / 病毒载体 / 中试放大等）。
  return null;
}

/* ══════ 产业链图谱 — 研判后自动生成 ══════ */

/* ── AI 动态生成产业链图谱数据 ── */
/* 根据 note/level_basis 文本关键词校正 AI 的 level 误判（AI 常保守全判 mid）。
   命中缺口词→weak，命中优势词→strong，否则保留原判。 */
function _correctChainLevel(node){
  var txt=((node.note||'')+' '+(node.level_basis||'')+' '+(node.basis||'')).toLowerCase?
    ((node.note||'')+' '+(node.level_basis||'')+' '+(node.basis||'')):'';
  var t=(node.note||'')+' '+(node.level_basis||'')+' '+(node.basis||'');
  var weakRe=/(缺失|空白|无本地|无整机|依赖外[采购]|外购|受制于人|尚无|暂无|没有本地|100%依赖|全部外[采购]|不足5%|严重依赖)/;
  var strongRe=/(龙头|已量产|量产|全国占比|全国前列|全国第[一二三]|领先|示范基地|集群效应|30年|市场占比\d|占全国|居首|冠军|标杆|上市公司|全球)/;
  var lv=node.level;
  if(lv!=='weak' && weakRe.test(t)) lv='weak';
  else if(lv!=='strong' && strongRe.test(t) && !weakRe.test(t)) lv='strong';
  if(lv!=='strong'&&lv!=='mid'&&lv!=='weak') lv='mid';
  return lv;
}
/* 将 AI 返回的 chain 规范化为泳道格式 [{seg,nodes:[{name,level,note,local_leaders,benchmark}]}]。
   兼容两种结构：① 泳道数组 [{seg,nodes}] ② 扁平对象 {segments:[{name,level,...}]}。 */
function _normalizeChain(parsed){
  var segMap={'上游':[], '中游':[], '下游':[]};
  function pushNode(seg, nd){
    if(!nd||!nd.name) return;
    var node={
      name: nd.name,
      level: (nd.level==='strong'||nd.level==='mid'||nd.level==='weak')?nd.level:'mid',
      note: nd.note||nd.level_basis||nd.basis||'',
      local_leaders: (nd.local_leaders||nd.locals||[]).map(function(e){return typeof e==='string'?e:(e&&(e.name||e.company))||'';}).filter(Boolean),
      benchmark: (nd.benchmark||nd.benchmarks||[]).map(function(e){return typeof e==='string'?e:(e&&(e.name||e.company))||'';}).filter(Boolean)
    };
    node.level=_correctChainLevel(node);
    var s=(seg||'').indexOf('上')>=0?'上游':(seg||'').indexOf('下')>=0?'下游':(seg||'').indexOf('中')>=0?'中游':null;
    if(!s){ // 扁平结构无分组：按顺序均分到上/中/下游
      s='中游';
    }
    segMap[s].push(node);
  }
  if(Array.isArray(parsed) && parsed.length && parsed[0] && parsed[0].nodes){
    // 泳道结构
    parsed.forEach(function(sg){ (sg.nodes||[]).forEach(function(nd){ pushNode(sg.seg, nd); }); });
  } else {
    // 扁平结构：{segments:[...]} 或 [{name,level,...}]
    var flat = (parsed&&parsed.segments)?parsed.segments:(Array.isArray(parsed)?parsed:[]);
    var n=flat.length;
    flat.forEach(function(nd,i){
      var seg = nd.seg || (i< Math.ceil(n/3)?'上游':i< Math.ceil(n*2/3)?'中游':'下游');
      pushNode(seg, nd);
    });
  }
  var out=[];
  ['上游','中游','下游'].forEach(function(s){ if(segMap[s].length) out.push({seg:s, nodes:segMap[s]}); });
  return out;
}
/* 鲁棒提取器：不依赖整体JSON合法（AI常输出破损JSON）。
   核心：环节名带"上游/中游/下游："前缀，据此切块，块内正则提取 level/note/企业。
   企业对象里的 "name" 不会被误当环节（因其无上/中/下游前缀）。 */
function _extractChainRobust(raw){
  // 环节节点特征：name 后 140 字符内紧跟 "level":"strong|mid|weak"（企业对象跟的是 region/kind，不跟 level）。
  // 兼容两种AI输出：① name带"上游/中游/下游："前缀 ② 扁平无前缀（此时按顺序均分上/中/下游）。
  var re=/"name"\s*:\s*"([^"]{2,50})"[\s\S]{0,140}?"level"\s*:\s*"(strong|mid|weak)"/g;
  var marks=[], m;
  while((m=re.exec(raw))!==null){ marks.push({name:m[1], level:m[2], idx:m.index}); }
  if(marks.length<2) return null;
  var nodes=[];
  for(var i=0;i<marks.length;i++){
    var blk=raw.slice(marks[i].idx, (i+1<marks.length)?marks[i+1].idx:raw.length);
    var rawName=marks[i].name;
    var segM=rawName.match(/^(上游|中游|下游)[：:]/);
    var seg=segM?segM[1]:'';
    var name=rawName.replace(/^(上游|中游|下游)[：:]\s*/,'');
    var basisM=blk.match(/"(?:level_basis|note|basis)"\s*:\s*"([^"]{0,200})"/);
    // local_leaders 段（benchmarks 之前）
    var localSeg=((blk.split(/"local_leaders?"\s*:/)[1]||'').split(/"benchmarks?"/)[0]);
    var localNames=[], lm, reL=/"name"\s*:\s*"([^"]{2,40})"/g;
    while((lm=reL.exec(localSeg))!==null) localNames.push(lm[1]);
    if(!localNames.length){ var sm, reS=/"([^"]{3,40}(?:公司|集团|厂|研究院|中心|基地))"/g; while((sm=reS.exec(localSeg))!==null) localNames.push(sm[1]); }
    // benchmarks 段
    var benchSeg=(blk.split(/"benchmarks?"\s*:/)[1]||'');
    var benchNames=[], bm, reB=/"name"\s*:\s*"([^"]{2,40})"/g;
    while((bm=reB.exec(benchSeg))!==null) benchNames.push(bm[1]);
    // 过滤企业名噪声：环节名/含空白残留的不算企业
    function _cleanEnts(arr){ return arr.map(function(x){return (x||'').replace(/\s+$/,'').trim();}).filter(function(x){ return x && x.length>=3 && /(公司|集团|厂|研究院|中心|基地|科技|股份|电动|半导体|重工|汽车)/.test(x); }); }
    localNames=_cleanEnts(localNames); benchNames=_cleanEnts(benchNames);
    var node={name:name, seg:seg, level:marks[i].level, note:(basisM?basisM[1]:''), local_leaders:localNames.slice(0,3), benchmark:benchNames.slice(0,3)};
    node.level=_correctChainLevel(node);
    nodes.push(node);
  }
  // 分组：有前缀用前缀；无前缀按顺序均分上/中/下游
  var hasSeg=nodes.some(function(n){return n.seg;});
  var segMap={'上游':[], '中游':[], '下游':[]};
  var n=nodes.length;
  nodes.forEach(function(nd,i){
    var seg=nd.seg || (i<Math.ceil(n/3)?'上游':i<Math.ceil(n*2/3)?'中游':'下游');
    segMap[seg].push({name:nd.name, level:nd.level, note:nd.note, local_leaders:nd.local_leaders, benchmark:nd.benchmark});
  });
  var out=[];
  ['上游','中游','下游'].forEach(function(sg){ if(segMap[sg].length) out.push({seg:sg, nodes:segMap[sg]}); });
  return (out.length && out.some(function(s){return s.nodes.length;}))?out:null;
}
function generateChainFromReport(topic, reportText, city){
  if(!topic) return;
  var rs=REPORTSTATE[cur]; if(!rs) return;
  if(!rs.chainByTopic) rs.chainByTopic={};
  // 已有缓存且是有效数组则跳过（字符串 'loading' 走下面的陈旧检查）
  if(Array.isArray(rs.chainByTopic[topic]) && rs.chainByTopic[topic].length) return;
  // 陈旧 'loading' 兜底：若无真正在跑的任务，视作上次卡死残留，直接清掉允许重试
  var _inflightKey=(cur||'')+'|'+topic;
  if(rs.chainByTopic[topic]==='loading' && _chainGenInFlight[_inflightKey]) return;
  if(rs.chainByTopic[topic]==='loading') rs.chainByTopic[topic]=null;
  // 报告太短时模糊匹配aiReportByTopic找更完整的版本
  if((!reportText || reportText.length<800) && rs.aiReportByTopic){
    var _core=topic.replace(/[补链引入引育升级招商培育系统软硬件本地配套软性Tier1新能源]/g,'');
    Object.keys(rs.aiReportByTopic).forEach(function(k){
      var kc=k.replace(/[补链引入引育升级招商培育系统软硬件本地配套软性Tier1新能源]/g,'');
      var ov=0; for(var i=0;i<_core.length;i++){if(kc.indexOf(_core[i])>=0)ov++;}
      if(_core.length>0&&ov/_core.length>0.5){var t=rs.aiReportByTopic[k]; if(t&&t.length>(reportText?reportText.length:0)) reportText=t;}
    });
  }
  if(!reportText || reportText.length<100) return;
  rs.chainByTopic[topic]='loading';
  _chainGenInFlight[_inflightKey]=true;
  var prompt='你是产业链研判专家。请基于以下'+(city||'本市')+'的产业分析报告，梳理「'+topic+'」的完整产业链，按上游/中游/下游分类逐环节研判。\n\n'
    +'报告内容：\n'+reportText.substring(0,2600)+'\n\n'
    +'严格输出JSON数组（不要markdown代码块、不要任何JSON之外的文字），结构：\n'
    +'[{"seg":"上游","nodes":[{"name":"环节名","level":"strong|mid|weak","note":"35字内现状(含具体数据/企业/配套率)","local_leaders":["本地代表企业全称"],"benchmark":["外地对标企业全称"]}]},{"seg":"中游","nodes":[...]},{"seg":"下游","nodes":[...]}]\n\n'
    +'level判定标准（务必区分，禁止全部判mid）：\n'
    +'- strong=优势：本地已有龙头/量产/全国占比领先/成熟集群（报告出现"已有/量产/龙头/全国占比/领先/示范基地"等）\n'
    +'- weak=缺口：本地缺失/空白/依赖外购/受制于人/无本地供应（报告出现"缺失/空白/无本地/依赖外采/外购/受制于人/尚无"等）\n'
    +'- mid=培育：本地有一定基础但规模不足、需增强（仅在既非明显优势也非明显缺口时使用）\n\n'
    +'铁律：\n'
    +'1. 必须综合运用strong/mid/weak三种判定，一条产业链通常同时存在优势环节、培育环节和缺口环节，绝不允许所有环节都判同一级别。\n'
    +'2. note必须引用报告中的具体事实（企业名/产值/产能/占比），不得空泛。\n'
    +'3. local_leaders只填报告或你确知的真实本地企业全称；确实没有则填[]。benchmark填外地真实对标企业全称；没有填[]。禁止编造企业名，禁止拿外地企业冒充本地。\n'
    +'4. 每个seg下2-4个节点，总共6-10个节点。只输出JSON。';
  var _abortCtrl=new AbortController();
  var _chainTimeout=setTimeout(function(){ _abortCtrl.abort(); rs.chainByTopic[topic]=null; _chainGenInFlight[_inflightKey]=false; persist(); var _b=document.getElementById('chainMapBlock'); if(_b) _b.innerHTML='<div style="padding:20px;text-align:center;color:#94a3b8;font-size:12.5px">图谱生成超时，请重新进入产业分析触发</div>'; },90000);
  fetch(KB_API,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question:prompt, chunks:[], city:city||'', stream:true, mode:'chain', prefs:curOnbPrefs()}),
    signal:_abortCtrl.signal
  }).then(function(r){
    clearTimeout(_chainTimeout);
    var reader=r.body.getReader(); var decoder=new TextDecoder(); var acc='';
    function pump(){
      return reader.read().then(function(res){
        if(res.done){
          // 流结束，解析累积的JSON。AI常输出破损JSON，故双路径：
          // ① JSON.parse 快速路径（成功且节点充足则用）② 鲁棒环节标记提取器（不依赖JSON合法）
          var _chain=null;
          try{
            var jsonStr=acc.replace(/```json?\n?/g,'').replace(/```/g,'').trim();
            var _oa=jsonStr.indexOf('{'), _ob=jsonStr.lastIndexOf('}');
            var _ja=jsonStr.indexOf('['), _jb=jsonStr.lastIndexOf(']');
            var _cand=jsonStr;
            if(_oa>=0&&_ob>_oa&&(_ja<0||_oa<_ja)) _cand=jsonStr.slice(_oa,_ob+1);
            else if(_ja>=0&&_jb>_ja) _cand=jsonStr.slice(_ja,_jb+1);
            // 修复AI常见破损：把 "count":value" 这类删掉（前端不用count字段）
            _cand=_cand.replace(/,?\s*"(?:local|national)_count"\s*:\s*\{[^}]*\}/g,'')
                       .replace(/,?\s*"(?:local|national)_count"\s*:[^\n,}]*/g,'')
                       .replace(/"([^"\\]{4,80})\s{2,}"?(level|note|seg|name|level_basis)/g,'"$1","$2');
            var parsed=JSON.parse(_cand);
            var c1=_normalizeChain(parsed);
            // 快速路径若节点过少（<4）或全同级，可能解析残缺，交给鲁棒提取器补充
            var _total=c1.reduce(function(a,s){return a+(s.nodes?s.nodes.length:0);},0);
            if(_total>=4) _chain=c1;
          }catch(e){ console.warn('[chain] JSON.parse failed, using robust extractor:',e.message); }
          // 鲁棒提取器（主力，尤其JSON破损时）
          if(!_chain){
            try{ _chain=_extractChainRobust(acc.replace(/```json?\n?/g,'').replace(/```/g,'')); }catch(_e2){ console.warn('[chain] robust extract failed:',_e2.message); }
          }
          if(Array.isArray(_chain)&&_chain.length>=2 && _chain.some(function(s){return s.nodes&&s.nodes.length;})){
            rs.chainByTopic[topic]=_chain; _chainGenInFlight[_inflightKey]=false; persist();
            if(view==='report') render();
          } else {
            rs.chainByTopic[topic]=null; _chainGenInFlight[_inflightKey]=false; persist();
            if(view==='report') render();
          }
          return;
        }
        var chunk=decoder.decode(res.value,{stream:true});
        // 解析SSE格式
        chunk.split('\n').forEach(function(line){
          if(line.indexOf('data: ')===0){
            var d=line.slice(6).trim();
            if(d==='[DONE]') return;
            try{var j=JSON.parse(d); var c=j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content; if(c) acc+=c;}catch(_){}
          }
        });
        return pump();
      });
    }
    return pump();
  }).catch(function(e){ rs.chainByTopic[topic]=null; _chainGenInFlight[_inflightKey]=false; clearTimeout(_chainTimeout); persist();
    var block3=document.getElementById('chainMapBlock');
    if(block3&&e.name!=='AbortError') block3.innerHTML='<div style="padding:20px;text-align:center;color:#94a3b8;font-size:12.5px">图谱生成失败：'+e.message+'</div>';
  });
}


/* 模糊匹配 pendingByTopic key：topic名可能随AI推荐变化，用关键词重叠度匹配 */
function _findPendingForTopic(rs, topic){
  if(!rs||!rs.pendingByTopic||!topic) return [];
  // 精确匹配优先
  if(rs.pendingByTopic[topic]) return rs.pendingByTopic[topic];
  // 模糊匹配：提取topic中的核心关键词（去掉"补链/引入/升级/招商"等后缀）
  var core=topic.replace(/[补链|引入|引育|升级|招商|培育|Tier1|系统|软硬件]/g,'').replace(/\s+/g,'');
  var bestKey=null, bestScore=0;
  Object.keys(rs.pendingByTopic).forEach(function(k){
    var kCore=k.replace(/[补链|引入|引育|升级|招商|培育|Tier1|系统|软硬件|本地配套|软性]/g,'').replace(/\s+/g,'');
    // 计算重叠字符数
    var overlap=0;
    for(var i=0;i<core.length;i++){ if(kCore.indexOf(core[i])>=0) overlap++; }
    var score=core.length>0?overlap/core.length:0;
    if(score>bestScore){ bestScore=score; bestKey=k; }
  });
  // 重叠度>60%认为是同一方向
  return (bestScore>0.6 && bestKey) ? rs.pendingByTopic[bestKey] : [];
}

/* 丰富泳道格式渲染（动态AI图谱也用此格式，与硬编码链一致） */
function _renderRichChain(topic, segments, recs, p){
  var LEVEL={
    strong:{bg:'#f0fdf4',bd:'#16a34a',fc:'#15803d',tag:'优势',tbg:'#dcfce7',tfc:'#15803d'},
    mid:   {bg:'#fefce8',bd:'#d97706',fc:'#92400e',tag:'培育',tbg:'#fef9c3',tfc:'#92400e'},
    weak:  {bg:'#fef2f2',bd:'#ef4444',fc:'#991b1b',tag:'缺口',tbg:'#fee2e2',tfc:'#b91c1c'}
  };
  var SEGMETA={
    '上游':{bg:'#eef2ff',fc:'#4338ca',bd:'#c7d2fe',tag:'UPSTREAM'},
    '中游':{bg:'#f0fdf4',fc:'#166534',bd:'#bbf7d0',tag:'MIDSTREAM'},
    '下游':{bg:'#fff7ed',fc:'#9a3412',bd:'#fed7aa',tag:'DOWNSTREAM'}
  };
  var h='<div style="margin-top:16px;border-radius:16px;border:1.5px solid #e2e8f0;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06)">';
  h+='<div style="padding:12px 18px;background:linear-gradient(135deg,#1e3a5f,#1a56db);display:flex;align-items:center;gap:10px">';
  h+='<span style="font-size:20px">\ud83d\udcca</span>';
  h+='<div><div style="font-size:13.5px;font-weight:800;color:#fff;letter-spacing:.3px">'+topic+' 产业链图谱</div>';
  h+='<div style="font-size:11px;color:rgba(255,255,255,0.7);margin-top:1px">上游 → 中游 → 下游 · 当前产业分析方向「'+topic+'」</div></div>';
  h+='<div style="margin-left:auto;display:flex;gap:8px">';
  [{t:'优势',bg:'#16a34a'},{t:'培育',bg:'#d97706'},{t:'缺口',bg:'#ef4444'}].forEach(function(lg){
    h+='<span style="background:'+lg.bg+';color:#fff;border-radius:20px;padding:2px 9px;font-size:10.5px;font-weight:700">'+lg.t+'</span>';
  });
  h+='</div></div>';
  h+='<div style="padding:16px;background:#f8faff;display:flex;flex-direction:column;gap:12px">';
  segments.forEach(function(seg){
    var sm=SEGMETA[seg.seg]||SEGMETA['中游'];
    h+='<div style="display:flex;gap:12px;align-items:stretch">';
    h+='<div style="flex-shrink:0;width:44px;border-radius:10px;background:'+sm.bg+';border:1.5px solid '+sm.bd+';display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px 2px">';
    h+='<span style="font-size:13px;font-weight:800;color:'+sm.fc+';letter-spacing:2px;writing-mode:vertical-rl">'+seg.seg+'</span>';
    h+='<span style="font-size:7.5px;color:'+sm.fc+';opacity:.55;letter-spacing:.5px;writing-mode:vertical-rl">'+sm.tag+'</span>';
    h+='</div>';
    h+='<div style="flex:1;display:flex;align-items:stretch;gap:0;overflow-x:auto;padding-bottom:2px">';
    (seg.nodes||[]).forEach(function(nd,i){
      var lv=LEVEL[nd.level]||LEVEL.mid;
      h+='<div style="flex:1;min-width:96px;background:'+lv.bg+';border:2px solid '+lv.bd+';border-radius:12px;padding:10px 8px;display:flex;flex-direction:column;align-items:center;text-align:center">';
      h+='<span style="background:'+lv.tbg+';color:'+lv.tfc+';border-radius:10px;padding:1px 8px;font-size:10px;font-weight:800;margin-bottom:5px">'+lv.tag+'</span>';
      h+='<div style="font-size:12px;font-weight:700;color:'+lv.fc+';line-height:1.35;margin-bottom:5px">'+nd.name+'</div>';
      if(nd.level==='strong'){
        h+='<div style="font-size:10.5px;font-weight:700;color:#15803d;background:#f0fdf4;border:1px solid #16a34a;border-radius:20px;padding:2px 9px;margin-bottom:6px;white-space:nowrap">\u2705 本地优势</div>';
      } else if(nd.level==='weak'){
        h+='<div style="font-size:10.5px;font-weight:700;color:#b91c1c;background:#fef2f2;border:1px solid #ef4444;border-radius:20px;padding:2px 9px;margin-bottom:6px;white-space:nowrap">\u274c 缺口</div>';
      } else {
        h+='<div style="font-size:10.5px;font-weight:700;color:#92400e;background:#fefce8;border:1px solid #d97706;border-radius:20px;padding:2px 9px;margin-bottom:6px;white-space:nowrap">\ud83d\udd36 培育中</div>';
      }
      if(nd.note) h+='<div style="font-size:10px;color:#64748b;line-height:1.4">'+nd.note+'</div>';
      if(nd.local_leaders&&nd.local_leaders.length){
        h+='<div style="margin-top:7px;padding-top:6px;border-top:1px dashed '+lv.bd+';width:100%;text-align:center">';
        h+='<div style="font-size:9px;color:#94a3b8;font-weight:700;margin-bottom:3px">\ud83c\udfe0 本地代表企业</div>';
        h+='<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center">';
        nd.local_leaders.slice(0,3).forEach(function(e){h+='<span style="font-size:9.5px;color:#0f172a;background:#fff;border:1px solid '+lv.bd+';border-radius:10px;padding:1px 6px;white-space:nowrap">'+(typeof e==="string"?e:e.name)+'</span>';});
        h+='</div></div>';
      }
      if(nd.benchmark&&nd.benchmark.length){
        h+='<div style="margin-top:7px;padding-top:6px;border-top:1px dashed '+lv.bd+';width:100%;text-align:center">';
        h+='<div style="font-size:9px;color:#94a3b8;font-weight:700;margin-bottom:3px">\ud83c\udfaf 对标企业</div>';
        h+='<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center">';
        nd.benchmark.slice(0,3).forEach(function(e){h+='<span style="font-size:9.5px;color:#0f172a;background:#fff;border:1px solid '+lv.bd+';border-radius:10px;padding:1px 6px;white-space:nowrap">'+(typeof e==="string"?e:e.name)+'</span>';});
        h+='</div></div>';
      }
      h+='</div>';
      if(i<(seg.nodes||[]).length-1) h+='<div style="display:flex;align-items:center;flex-shrink:0;padding:0 4px;color:#94a3b8;font-size:16px">→</div>';
    });
    h+='</div></div>';
  });
  h+='</div>';
  if(recs&&recs.length){
    h+='<div style="padding:12px 16px;background:#fff;border-top:1px solid #e8edf5">';
    h+='<div style="font-size:12px;font-weight:700;color:#1d4ed8;margin-bottom:8px">\ud83c\udfaf 补链优先推荐</div>';
    h+='<div style="display:flex;flex-direction:column;gap:6px">';
    recs.forEach(function(rec,i){
      h+='<div style="display:flex;align-items:flex-start;gap:8px">';
      h+='<span style="background:#dbeafe;color:#1d4ed8;border-radius:6px;padding:1px 7px;font-size:11px;font-weight:700;flex-shrink:0;line-height:1.6">'+(i+1)+'</span>';
      h+='<div style="font-size:12px;color:#1e293b"><strong>'+(rec.l||rec.name||'')+'</strong> <span style="color:#64748b">· '+(rec.why||rec.reason||'')+'</span></div>';
      h+='</div>';
    });
    h+='</div></div>';
  }
  h+='</div>';
  return h;
}


function chainMapHtml(p){
  if(!p) return '';
  var topic=p.topic||'';

  /* P2：图谱环节名 → 企业库(OPS_ENT)对标企业匹配
     按环节名关键词匹配企业 kind/gap 字段，动态关联，不再硬编码 */
  var ENT_KW = {
    '菌种':['菌种','育种'],
    '种植':['种植','菌'],
    '初加工':['加工','食用菌'],
    '精深加工':['提取','加工','食用菌','多糖'],
    '多糖':['提取','多糖','植物提取'],
    '品牌':['品牌','出口'],
    '氢气制备':['制氢','氢'],
    '储氢':['储氢','瓶','氢能'],
    '电堆':['电堆','燃料电池','氢燃料'],
    '电控':['电控','晶振','动力'],
    '驾驶室':['驾驶室','车身','整车'],
    '整车':['整车','改装','专用车','动力'],
    '无人机':['无人机'],
    '机器人':['机器人'],
    '5G':['5G','通信'],
    '篷布':['篷布','风机'],
    '应急整车':['应急','消防','整车'],
    '沿海存量':['转移','承接'],
    '承载':['园区','厂房'],
    '配套':['零部件','配套'],
    '研发':['研发','品牌']
  };
  function matchEnts(nodeName){
    if(!(window.OPS_ENT && window.OPS_ENT.length)) return [];
    var kws = null;
    for(var k in ENT_KW){
      if(nodeName.indexOf(k)>=0){ kws=ENT_KW[k]; break; }
    }
    if(!kws) return [];
    var hits=[];
    window.OPS_ENT.forEach(function(e){
      var hay=(e.kind||'')+' '+(e.gap||'');
      var ok=kws.some(function(kw){ return hay.indexOf(kw)>=0; });
      if(ok && hits.length<3) hits.push({name:e.name, kind:e.kind});
    });
    return hits;
  }


  /* ── 各产业链节点数据（三段泳道：上游/中游/下游）──
     note=环节现状描述；local/national 为历史宏观参考数据（已不再渲染，
     节点气泡的「本地/对标」改为从企业库 OPS_ENT 动态统计） */
  var CHAINS={
    '香菇':[
      {seg:'上游', nodes:[
        {name:'菌种研发', level:'weak', local:0, national:87, note:'国外7925/7917品种垄断，本地企业100%依赖进口菌种，育种话语权缺失导致种源成本居高'},
        {name:'种植采摘', level:'strong', local:'12万+', national:'—', note:'全球白花菇约50%产自随州，种植面积与经验积累30年+，是全产业链最强环节'}
      ]},
      {seg:'中游', nodes:[
        {name:'初加工', level:'mid', local:68, national:3200, note:'已有多家企业入驻做烘干/分级，但设备老旧、标准化程度低，产能利用率不足60%'},
        {name:'精深加工', level:'weak', local:2, national:1200, note:'仅裕国/肽源2家，覆盖不足原料总量5%，大量鲜菇以低价原料形式外流，附加值损失巨大'}
      ]},
      {seg:'下游', nodes:[
        {name:'多糖/功能成分提取', level:'weak', local:1, national:410, note:'香菇多糖市场价超8万元/kg，本地几乎空白，高端提取物全部依赖外省企业加工后回购'},
        {name:'品牌出口', level:'strong', local:3, national:600, note:'品源「菇的辣克」2024签约1亿美元+2025续签3亿美元，品牌溢价已形成，出口竞争力强'}
      ]}
    ],
    '氢能':[
      {seg:'上游', nodes:[
        {name:'氢气制备', level:'weak', local:0, national:460, note:'本地无制氢装置，车用氢气全部从武汉/十堰外购，运输成本高且供应链稳定性差'}
      ]},
      {seg:'中游', nodes:[
        {name:'储氢系统', level:'weak', local:0, national:180, note:'占整车14%成本，高压瓶阀/管路全部外采，新楚风量产后需求剧增但本地零供应商'},
        {name:'氢燃料电堆', level:'weak', local:0, national:120, note:'占整车53%核心成本，是最大缺口；新楚风49T氢重卡已量产，电堆依赖外购严重压缩利润'},
        {name:'电控系统', level:'mid', local:2, national:800, note:'泰晶车规级晶振(AEC-Q200)、犇星电解液已配套，覆盖部分电控需求，但整体配套率仍偏低'},
        {name:'车身驾驶室', level:'strong', local:1, national:150, note:'齐星本地自供，驾驶室年产能超2万套，质量与交期稳定，是整车降本的核心支撑环节'}
      ]},
      {seg:'下游', nodes:[
        {name:'整车改装', level:'strong', local:97, national:900, note:'97家整车改装资质企业，全国占比>10%；程力/新楚风/齐星量产能力强，专汽集群效应显著'}
      ]}
    ],
    '应急':[
      {seg:'上游', nodes:[
        {name:'无人机本体', level:'weak', local:0, national:260, note:'指挥车搭载无人机全部外采迅北斗，本地无整机制造能力，核心部件受制于人'},
        {name:'应急机器人', level:'weak', local:0, national:340, note:'消防/救援机器人依赖外采启灵等品牌，随州整车平台有集成需求但无本地机器人供应商'},
        {name:'5G通信模块', level:'mid', local:0, national:120, note:'政策已引导布局，但尚无企业实质落地；应急指挥对5G低延迟通信需求强，缺口正在放大'}
      ]},
      {seg:'中游', nodes:[
        {name:'篷布/风机', level:'strong', local:1, national:80, note:'金龙篷布全国市场占比30%，材料工艺积累深厚，军民两用认证齐全，是国内应急装备核心供应商'}
      ]},
      {seg:'下游', nodes:[
        {name:'移动应急整车', level:'strong', local:12, national:220, note:'国家安全应急产业示范基地，博利特高空系留无人机消防车、齐星无人机指挥车、江南泡沫车均已量产，年产值超300亿'}
      ]}
    ],
    '产业转移':[
      {seg:'上游', nodes:[
        {name:'沿海存量产能', level:'weak', local:'—', national:'—', note:'沿海用工成本年均涨幅8-10%，土地稀缺，制造企业有强烈转移意愿但尚未找到合适承接地'}
      ]},
      {seg:'中游', nodes:[
        {name:'本地承载能力', level:'mid', local:6, national:'—', note:'经开区/高新区标准厂房充裕，用工成本比沿海低35-40%，但配套服务与物流效率仍有差距'},
        {name:'配套供应链', level:'mid', local:220, national:'—', note:'汽车零部件/食品包装等配套已有基础，但电子/精密制造配套薄弱，承接高端制造仍有短板'}
      ]},
      {seg:'下游', nodes:[
        {name:'品牌/研发', level:'strong', local:45, national:'—', note:'承接后可依托本地专汽/香菇产业链快速形成订单支撑，政府配套政策完善，研发留存率高'}
      ]}
    ]
  };

  var RECS={
    '香菇':[
      {l:'菌种研发',why:'国内外垄断，突破即建立技术壁垒'},
      {l:'精深加工/多糖提取',why:'品源亿美元订单驱动，高附加值'},
      {l:'功能性食品OEM',why:'品牌溢价高，补全出口→内销闭环'}
    ],
    '氢能':[
      {l:'氢燃料电堆',why:'成本占整车53%，新楚风氢重卡已量产'},
      {l:'储氢系统',why:'整车14%成本全部外采，需求确定'},
      {l:'电堆密封/碳纸',why:'核心耗材，可快速形成本地供应'}
    ],
    '应急':[
      {l:'应急机器人',why:'国家安全应急示范基地，差异化赛道'},
      {l:'无人机本体',why:'应急指挥配套需求强，政策加持'},
      {l:'5G应急通信',why:'数字化应急升级趋势，市场空间大'}
    ],
    '产业转移':[
      {l:'沿海劳动密集型制造',why:'成本套利明显，承接意愿强'},
      {l:'汽车零部件配套',why:'专汽产业链延伸，就地配套'},
      {l:'食品加工',why:'农业资源丰富，冷链条件具备'}
    ]
  };

  /* 匹配产业链：调用统一的 pickChainKey（topic 关键词 → 链）。
     匹配不到时返回 null，不再无脑兜底香菇。 */
  var key=pickChainKey(topic);
  // AI动态生成的图谱数据（仅在无硬编码链时使用）
  var _dynChain=null;
  if(cur && REPORTSTATE[cur] && REPORTSTATE[cur].chainByTopic){ _dynChain=REPORTSTATE[cur].chainByTopic[topic]; }

  // 硬编码链优先：有对应key则直接用硬编码数据走丰富渲染，忽略动态数据
  if(!key){
    // 无硬编码链：用动态数据走丰富渲染，或触发生成
    if(_dynChain==='loading'){
      // 陈旧标记兜底：无真正在跑的生成任务 → 清空并重触发
      var _ifk=(cur||'')+'|'+topic;
      if(!_chainGenInFlight[_ifk]){
        REPORTSTATE[cur].chainByTopic[topic]=null; _dynChain=null;
        try{saveReportState();}catch(_){}
        var _rpt3=typeof reportTextForTopic==='function'?reportTextForTopic(topic):null;
        if(_rpt3) setTimeout(function(){ generateChainFromReport(topic, _rpt3, p.city); },0);
      } else {
        return '<div style="margin-top:16px;padding:20px;border-radius:14px;border:1.5px dashed #cbd5e1;background:#f8fafc;text-align:center;color:#64748b;font-size:12.5px">'+'<div style="font-size:26px;margin-bottom:8px">⏳</div>正在生成产业链图谱…</div>';
      }
    }
    if(Array.isArray(_dynChain) && _dynChain.length>=2){
      // 动态数据也用丰富泳道格式渲染（与硬编码完全一致的视觉风格）
      return _renderRichChain(topic, _dynChain, null, p);
    }
    // 无数据：尝试触发AI动态生成
    var _rpt2=typeof reportTextForTopic==='function'?reportTextForTopic(topic):null;
    if(_rpt2 && !_dynChain){ generateChainFromReport(topic, _rpt2, p.city); }
    return '<div style="margin-top:16px;padding:20px;border-radius:14px;border:1.5px dashed #cbd5e1;background:#f8fafc;text-align:center;color:#64748b;font-size:12.5px;line-height:1.7">'+
      '<div style="font-size:26px;margin-bottom:8px">🧭</div>'+
      '「'+topic+'」暂未匹配到对应的产业链图谱<br>'+
      '<span style="font-size:11.5px;color:#94a3b8">正在为该方向生成专属产业链图谱，通常需 30–60 秒。如长时间未出现，可在城市智库补充该产业数据后重试。</span>'+
    '</div>';
  }

  var segments=CHAINS[key];
  var recs=RECS[key];

  /* ── P2：图谱节点关联目标企业库（OPS_ENT，跨端同步）──
     根据环节名关键词，从企业库匹配目标企业，展示"对标企业" */
  var ENT_HINTS={
    '菌种研发':['菌种','育种'],
    '种植采摘':['种植'],
    '初加工':['初加工','烘干','分级'],
    '精深加工':['精深','多糖','多肽','提取'],
    '多糖/功能成分提取':['多糖','多肽','提取'],
    '品牌出口':['品牌','出口','菇'],
    '氢气制备':['制氢','氢'],
    '储氢系统':['储氢','瓶阀'],
    '氢燃料电堆':['电堆','燃料电池'],
    '电控系统':['电控','晶振','电解液'],
    '车身驾驶室':['驾驶室'],
    '整车改装':['整车','改装','专用车'],
    '无人机本体':['无人机'],
    '应急机器人':['机器人'],
    '5G通信模块':['5G','通信'],
    '篷布/风机':['篷布','风机'],
    '移动应急整车':['应急','消防','指挥车'],
    '沿海存量产能':['转移','沿海'],
    '本地承载能力':['承载','厂房'],
    '配套供应链':['配套','零部件'],
    '品牌/研发':['研发','品牌']
  };
  function matchEnts(ndName){
    var hints=ENT_HINTS[ndName]||[ndName];
    return (OPS_ENT||[]).filter(function(e){
      var hay=((e.kind||'')+' '+(e.gap||'')+' '+(e.signal||''));
      return hints.some(function(k){ return hay.indexOf(k)>=0; });
    });
  }

  var LEVEL={
    strong:{bg:'#f0fdf4',bd:'#16a34a',fc:'#15803d',tag:'优势',tbg:'#dcfce7',tfc:'#15803d'},
    mid:   {bg:'#fefce8',bd:'#d97706',fc:'#92400e',tag:'培育',tbg:'#fef9c3',tfc:'#92400e'},
    weak:  {bg:'#fef2f2',bd:'#ef4444',fc:'#991b1b',tag:'缺口',tbg:'#fee2e2',tfc:'#b91c1c'}
  };

  var SEGMETA={
    '上游':{bg:'#eef2ff',fc:'#4338ca',bd:'#c7d2fe',tag:'UPSTREAM'},
    '中游':{bg:'#f0fdf4',fc:'#166534',bd:'#bbf7d0',tag:'MIDSTREAM'},
    '下游':{bg:'#fff7ed',fc:'#9a3412',bd:'#fed7aa',tag:'DOWNSTREAM'}
  };

  var chainIcon={'香菇':'🍄','氢能':'⚡','应急':'🚨','产业转移':'🏭'};
  var icon=chainIcon[key]||'📊';

  var h='<div style="margin-top:16px;border-radius:16px;border:1.5px solid #e2e8f0;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06)">';

  /* 标题 */
  h+='<div style="padding:12px 18px;background:linear-gradient(135deg,#1e3a5f,#1a56db);display:flex;align-items:center;gap:10px">';
  h+='<span style="font-size:20px">'+icon+'</span>';
  h+='<div><div style="font-size:13.5px;font-weight:800;color:#fff;letter-spacing:.3px">'+key+'产业链图谱</div>';
  h+='<div style="font-size:11px;color:rgba(255,255,255,0.7);margin-top:1px">上游 → 中游 → 下游 · 当前产业分析方向「'+topic+'」</div></div>';
  /* 图例 */
  h+='<div style="margin-left:auto;display:flex;gap:8px">';
  [{t:'优势',bg:'#16a34a'},{t:'培育',bg:'#d97706'},{t:'缺口',bg:'#ef4444'}].forEach(function(lg){
    h+='<span style="background:'+lg.bg+';color:#fff;border-radius:20px;padding:2px 9px;font-size:10.5px;font-weight:700">'+lg.t+'</span>';
  });
  h+='</div></div>';

  /* 三段泳道 */
  h+='<div style="padding:16px;background:#f8faff;display:flex;flex-direction:column;gap:12px">';
  segments.forEach(function(seg){
    var sm=SEGMETA[seg.seg]||SEGMETA['中游'];
    h+='<div style="display:flex;gap:12px;align-items:stretch">';
    /* 泳道标签 */
    h+='<div style="flex-shrink:0;width:44px;border-radius:10px;background:'+sm.bg+';border:1.5px solid '+sm.bd+';display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px 2px">';
    h+='<span style="font-size:13px;font-weight:800;color:'+sm.fc+';letter-spacing:2px;writing-mode:vertical-rl">'+seg.seg+'</span>';
    h+='<span style="font-size:7.5px;color:'+sm.fc+';opacity:.55;letter-spacing:.5px;writing-mode:vertical-rl">'+sm.tag+'</span>';
    h+='</div>';
    /* 节点链 */
    h+='<div style="flex:1;display:flex;align-items:stretch;gap:0;overflow-x:auto;padding-bottom:2px">';
    seg.nodes.forEach(function(nd,i){
      /* 从方向级容器读研判结果：sl[topic] 与当前链匹配才生效，否则硬编码兜底。
         杜绝"多个方向共用同一 chainKey（如都归为产业转移）而互相污染"。 */
      var _pForSl = P();
      var _slPer = _slFor(_pForSl ? _pForSl.topic : '');
      var _sl = (_slPer && _slPer.__chainKey===key) ? _slPer[nd.name] : null;
      var effLevel = _sl ? _sl.level : nd.level;
      var lv=LEVEL[effLevel]||LEVEL.mid;
      /* 企业匹配（区分 type=local 本地存量 / 其余=对标招引） */
      var _hints = ENT_HINTS[nd.name] || [nd.name];
      var _localEnts = (OPS_ENT||[]).filter(function(e){
        if(e.type!=='local') return false;
        var hay=((e.kind||'')+' '+(e.gap||'')+' '+(e.note||'')+' '+(e.signal||''));
        return _hints.some(function(k){ return hay.indexOf(k)>=0; });
      });
      var _benchEnts = (OPS_ENT||[]).filter(function(e){
        if(e.type==='local') return false;
        var hay=((e.kind||'')+' '+(e.gap||'')+' '+(e.note||'')+' '+(e.signal||''));
        return _hints.some(function(k){ return hay.indexOf(k)>=0; });
      });

      h+='<div style="flex:1;min-width:96px;background:'+lv.bg+';border:2px solid '+lv.bd+';border-radius:12px;padding:10px 8px;display:flex;flex-direction:column;align-items:center;text-align:center">';
      h+='<span style="background:'+lv.tbg+';color:'+lv.tfc+';border-radius:10px;padding:1px 8px;font-size:10px;font-weight:800;margin-bottom:5px">'+lv.tag+'</span>';
      h+='<div style="font-size:12px;font-weight:700;color:'+lv.fc+';line-height:1.35;margin-bottom:5px">'+nd.name+'</div>';
      /* 状态气泡：按 level 区分（自动研判后为最终判定，硬编码兜底） */
      if(effLevel==='strong'){
        h+='<div style="font-size:10.5px;font-weight:700;color:#15803d;background:#f0fdf4;border:1px solid #16a34a;border-radius:20px;padding:2px 9px;margin-bottom:6px;white-space:nowrap">✅ 本地优势</div>';
      } else if(effLevel==='weak'){
        h+='<div style="font-size:10.5px;font-weight:700;color:#b91c1c;background:#fef2f2;border:1px solid #ef4444;border-radius:20px;padding:2px 9px;margin-bottom:6px;white-space:nowrap">❌ 缺口</div>';
      } else {
        h+='<div style="font-size:10.5px;font-weight:700;color:#92400e;background:#fefce8;border:1px solid #d97706;border-radius:20px;padding:2px 9px;margin-bottom:6px;white-space:nowrap">🔶 培育中</div>';
      }
      h+='<div style="font-size:10px;color:#64748b;line-height:1.4">'+nd.note+'</div>';
      /* 本地代表企业（优势/培育环节展示本地企业） */
      if(_localEnts.length){
        h+='<div style="margin-top:7px;padding-top:6px;border-top:1px dashed '+lv.bd+';width:100%;text-align:center">';
        h+='<div style="font-size:9px;color:#94a3b8;font-weight:700;letter-spacing:.3px;margin-bottom:3px">🏠 本地代表企业</div>';
        h+='<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center">';
        _localEnts.slice(0,3).forEach(function(e){
          h+='<span style="font-size:9.5px;color:#0f172a;background:#fff;border:1px solid '+lv.bd+';border-radius:10px;padding:1px 6px;white-space:nowrap">'+e.name+'</span>';
        });
        h+='</div></div>';
      }
      /* 对标企业（缺口环节展示招引目标） */
      if(_benchEnts.length){
        h+='<div style="margin-top:7px;padding-top:6px;border-top:1px dashed '+lv.bd+';width:100%;text-align:center">';
        h+='<div style="font-size:9px;color:#94a3b8;font-weight:700;letter-spacing:.3px;margin-bottom:3px">🎯 对标企业</div>';
        h+='<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center">';
        _benchEnts.slice(0,3).forEach(function(e){
          h+='<span style="font-size:9.5px;color:#0f172a;background:#fff;border:1px solid '+lv.bd+';border-radius:10px;padding:1px 6px;white-space:nowrap">'+e.name+'</span>';
        });
        h+='</div></div>';
      }
      h+='</div>';
      /* 箭头 */
      if(i<seg.nodes.length-1){
        h+='<div style="display:flex;align-items:center;flex-shrink:0;padding:0 4px;color:#94a3b8;font-size:16px">→</div>';
      }
    });
    h+='</div></div>';
  });
  h+='</div>';

  /* 补链推荐 */
  h+='<div style="padding:12px 16px;background:#fff;border-top:1px solid #e8edf5">';
  h+='<div style="font-size:12px;font-weight:700;color:#1d4ed8;margin-bottom:8px">🎯 补链优先推荐</div>';
  h+='<div style="display:flex;flex-direction:column;gap:6px">';
  recs.forEach(function(rec,i){
    h+='<div style="display:flex;align-items:flex-start;gap:8px">';
    h+='<span style="background:#dbeafe;color:#1d4ed8;border-radius:6px;padding:1px 7px;font-size:11px;font-weight:700;flex-shrink:0;line-height:1.6">'+(i+1)+'</span>';
    h+='<div style="font-size:12px;color:#1e293b"><strong>'+rec.l+'</strong> <span style="color:#64748b">· '+rec.why+'</span></div>';
    h+='</div>';
  });
  h+='</div></div>';
  h+='</div>';
  /* 打开图谱即自动整链研判（异步，结果落地后 re-render；只跑一次） */
  var _nodeNames=[];
  segments.forEach(function(seg){ seg.nodes.forEach(function(nd){ _nodeNames.push(nd.name); }); });
  // 检索该城市 RAG 库中与本链相关的调研片段，作为研判的事实依据（单一事实源）
  var _chainChunks=[];
  try {
    var _corpus=buildKBCorpus(p.city||'随州');
    var _q=(topic||key)+' '+_nodeNames.join(' ')+' 产业链 缺口 龙头企业 本地 外购';
    _chainChunks=kbSearch(_q, _corpus, 8);
  } catch(e){ console.warn('chain corpus build failed:', e && e.message); }
  setTimeout(function(){ researchChain(key, topic, (p.city||'随州'), _nodeNames, _chainChunks); }, 0);
  return h;
}

/* ── P3a：AI 自动整链研判（打开图谱即自动调研整条链所有环节）──
   调用 /api/kb-chat mode=chain（后端 SYSTEM_RESEARCH_CHAIN 强约束来源），
   把结果落地到 PROJECTS[cur].segmentLevels + 企业库 OPS_ENT（type=local/target）。
   只跑一次：segmentLevels 已有该链研判结果则跳过，避免每次渲染重复调用。 */
var _chainResearching = {};
function researchChain(chainKey, topic, city, nodeNames, chunks){
  // 用 topic 做去重键：多个方向可能落到同一 chainKey（如两个"承接"方向都归为"产业转移"），
  // 用 chainKey 做键会让后来的方向被误判"正在进行"直接跳过、复用前一份研判结果。
  var _reKey = (topic || chainKey);
  if(_chainResearching[_reKey]) return;
  nodeNames = nodeNames || [];
  chunks = chunks || [];
  // 已研判过则跳过：读方向级容器 sl[topic]，环节齐了就复用；不齐清标记重跑。
  var sl = _slFor(topic);
  if(sl && sl.__chainKey===chainKey){
    if(nodeNames.length && nodeNames.every(function(n){ return !!sl[n]; })) return;
    delete sl.__chainKey;
  }
  // 切换到新链：清掉当前 topic 容器里不属于本链 nodeNames 的残留环节（历史跨链污染），
  // 保证图谱只反映当前方向 × 当前链的研判。
  if(sl){
    Object.keys(sl).forEach(function(kk){
      if(kk==='__chainKey') return;
      if(nodeNames.indexOf(kk)<0) delete sl[kk];
    });
  }
  _chainResearching[_reKey]=true;
  // 用 chainKey（干净的链名，如「香菇」）而非 topic（方向全称，如「香菇产业精深加工升级」）构造问题，
  // 避免方向全称里的限定词（精深加工升级）误导模型缩小范围、返回空 local_leaders。
  var q='请对'+city+'产业链「'+chainKey+'」的以下环节逐一研判（强弱判定/本地代表企业/外地对标企业）：'+nodeNames.join('、');
  // 改流式：mode=chain 生成慢，非流式易被 Railway 网关(~60s)判超时→502。
  // SSE 累积成完整 content 后，后续 JSON 解析逻辑保持不变。
  fetch('/api/kb-chat',{
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question:q, city:city, mode:'chain', stream:true, chunks:chunks, prefs:curOnbPrefs()})
  }).then(function(resp){
    if(!resp.ok || !resp.body) throw new Error('HTTP '+resp.status);
    var reader=resp.body.getReader(), decoder=new TextDecoder(), buf='', content='';
    function pump(){
      return reader.read().then(function(d){
        if(d.done) return content;
        buf+=decoder.decode(d.value,{stream:true});
        var lines2=buf.split('\n'); buf=lines2.pop();
        lines2.forEach(function(line){
          if(!line.startsWith('data:')) return;
          var d2=line.slice(5).trim(); if(d2==='[DONE]') return;
          try{
            var j=JSON.parse(d2);
            var delta=j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content||'';
            if(delta) content+=delta;
          }catch(e){}
        });
        return pump();
      });
    }
    return pump();
  }).then(function(content){
    content = content || '';
    var m = content.match(/\{[\s\S]*\}/);
    if(!m){ throw new Error('AI 未返回有效数据'); }
    var data = JSON.parse(m[0]);
    var segResults = (data && data.segments) || [];

    // 1) 落地强弱判定：写入方向级容器 sl[topic]，避免两个方向共用同一 chainKey 时互相覆盖
    var _slBucket = _slEnsure(topic);
    if(!_slBucket){ throw new Error('failed to init segmentLevels bucket for topic '+topic); }
    segResults.forEach(function(sr){
      var segName = sr && (sr.segment || sr.name);
      if(!segName) return;
      _slBucket[segName]={
        level: sr.level || 'mid',
        basis: sr.level_basis || '',
        confidence: (data && data.confidence) || 'medium',
        ts: Date.now()
      };
    });
    // 校验：所有 nodeNames 都落地了才标记完成
    var allDone = nodeNames.every(function(n){ return !!_slBucket[n]; });
    if(allDone && segResults.length >= nodeNames.length){
      _slBucket.__chainKey=chainKey;
    }

    // 2) 落地本地代表企业（type=local）与对标企业（type=target）
    // 先清理本链历史研判企业：字段名 bug 曾导致 gap="undefined环节" 的脏数据；
    // 以及本轮环节（nodeNames）名下已落地的旧记录，保证重跑结果干净、不重复。
    OPS_ENT = (OPS_ENT||[]).filter(function(e){
      var gapBad = (e.gap||'').indexOf('undefined')>=0;
      var inChain = e.segment && nodeNames.indexOf(e.segment)>=0;
      var matchesChain = (e.matches||[]).some(function(m){
        return nodeNames.some(function(n){ return (m.gap||'').indexOf(n)>=0; });
      });
      return !(gapBad || inChain || matchesChain);
    });
    var addedLocal=0, addedBench=0;
    segResults.forEach(function(sr){
      if(!sr) return;
      var segName = sr.segment || sr.name;
      (sr.local_leaders||[]).forEach(function(t){
        if(!t || !t.name) return;
        if(OPS_ENT.some(function(e){return e.name===t.name;})) return;
        OPS_ENT.push({name:t.name, kind:'', region:city, type:'local',
          segment:segName, revenue:'待核实', gap:(segName+'环节·本地'),
          signal:'', signalSrc:t.source||'', hasMoveSignal:false,
          source:t.source||'', note:t.role||'', matches:[]});
        addedLocal++;
      });
      (sr.benchmarks||[]).forEach(function(t){
        if(!t || !t.name) return;
        if(OPS_ENT.some(function(e){return e.name===t.name;})) return;
        OPS_ENT.push({name:t.name, kind:t.kind||'', region:t.region||'', type:'target',
          segment:segName, revenue:'待核实', gap:(t.match||(segName+'环节')),
          signal:t.signal||'', signalSrc:t.source||'',
          hasMoveSignal:!!(t.signal),
          source:t.source||'', note:t.match||'',
          matches:[{city:city, gap:(segName+'环节')}]});
        addedBench++;
      });
    });

    persist();
    if(addedLocal || addedBench){ toast('✓ 产业链图谱已完成 AI 研判（本地 '+addedLocal+' 家 · 对标 '+addedBench+' 家）'); }
    // 只在用户仍停留于该链图谱时【局部更新】图谱 DOM，避免整页 render 造成的"莫名刷新"、
    // 也避免 render→chainMapHtml→researchChain 的循环触发。
    var _p2=P();
    var _block=document.getElementById('chainMapBlock');
    if(_block && _p2 && view==='report' && pickChainKey(_p2.topic)===chainKey){
      _block.innerHTML=chainMapHtml(_p2);
    }
  }).catch(function(e){
    console.warn('chain research failed:', e && e.message);
  }).finally(function(){
    _chainResearching[_reKey]=false;
  });
}

/* 从图谱研判结果(segmentLevels)生成「补链优先级清单」markdown 表格，
   供报告正文第三章对齐：weak(缺口)→mid(培育)→strong(优势) 排序，携带对标企业。 */
function chainPriorityMarkdown(){
  if(!cur || !PROJECTS[cur]) return '';
  var p=P();
  var topic = p ? p.topic : '';
  if(!topic) return '';
  // 数据源二选一：
  //   A) 硬编码链（氢能/应急/香菇）：走 _slFor(topic) + OPS_ENT 对标企业
  //   B) 动态图谱（生物医药承接/医疗器械承接等）：走 chainByTopic[topic]，对标企业从图谱节点
  //      自身的 benchmark 字段取，避免用全局 OPS_ENT 造成跨方向串显（这是修复前第三章始终
  //      看到"临港/宁波舟山港/张江/苏州/联影/药明康德"的根因——那些企业挂在通用环节 gap 下）。
  var entries=[];
  var _chainKey = pickChainKey(topic);
  var _isDynamic = false;
  if(_chainKey){
    // 路径 A：硬编码链
    var sl = _slFor(topic);
    if(!sl || sl.__chainKey!==_chainKey) return '';
    var _chainNodes = _chainNodeNames(_chainKey);
    for(var k in sl){
      if(k==='__chainKey') continue;
      if(_chainNodes.length && _chainNodes.indexOf(k)<0) continue;
      entries.push({name:k, level:sl[k].level||'mid', benchmarks:null});
    }
  } else {
    // 路径 B：动态图谱（chainByTopic[topic] 是 [{seg,nodes:[{name,level,benchmark,...}]}]）
    var rs = REPORTSTATE[cur];
    var dyn = rs && rs.chainByTopic && rs.chainByTopic[topic];
    if(!Array.isArray(dyn) || !dyn.length) return '';
    _isDynamic = true;
    dyn.forEach(function(seg){
      (seg.nodes||[]).forEach(function(nd){
        if(!nd || !nd.name) return;
        entries.push({
          name: nd.name,
          level: (nd.level==='strong'||nd.level==='mid'||nd.level==='weak') ? nd.level : 'mid',
          benchmarks: Array.isArray(nd.benchmark) ? nd.benchmark.slice() : []
        });
      });
    });
  }
  var order={weak:0, mid:1, strong:2};
  entries.sort(function(a,b){
    var oa = order[a.level]!=null ? order[a.level] : 9;
    var ob = order[b.level]!=null ? order[b.level] : 9;
    return oa-ob;
  });
  if(!entries.length) return '';
  var lvlTxt={weak:'缺口', mid:'培育', strong:'优势'};
  var rows=entries.map(function(e,i){
    var benchStr;
    if(_isDynamic){
      // 动态图谱：对标企业直接取 node.benchmark（该方向 AI 自己派生，天然不跨方向）
      benchStr = (e.benchmarks && e.benchmarks.length)
                   ? e.benchmarks.slice(0,2).join('、')
                   : '—';
    } else {
      // 硬编码链：沿用 OPS_ENT 匹配
      var bench=(OPS_ENT||[]).filter(function(ent){
        if(ent.type==='local') return false;
        if(ent.segment===e.name) return true;
        if((ent.gap||'').indexOf(e.name)>=0) return true;
        return (ent.matches||[]).some(function(m){ return (m.gap||'').indexOf(e.name)>=0; });
      });
      benchStr = bench.length ? bench.slice(0,2).map(function(b){return b.name;}).join('、') : '—';
    }
    return '| '+(i+1)+' | '+e.name+' | '+lvlTxt[e.level]+' | '+benchStr+' |';
  }).join('\n');
  return '## 三、补链优先级清单（AI 产业链研判）\n\n'
    + '| 排名 | 缺口/环节 | 强弱判定 | 对标企业 |\n'
    + '|---|---|---|---|\n'
    + rows + '\n';
}

/* 报告正文第三章「补链优先级清单」跟随图谱研判结果：
   若已有整链研判，用 chainPriorityMarkdown 替换报告文本里的第三章（或文末追加），
   保证报告正文与产业链图谱的缺口/强弱判定完全一致。 */
function alignChainToReport(text){
  if(!text) return text;
  var tbl = chainPriorityMarkdown();
  if(!tbl) return text;
  var re = /##\s*三[、.](?:补链优先级清单|补链优先级|承接优先方向)[^\n]*[\s\S]*?(?=\n\s*##\s|$)/;
  if(re.test(text)) return text.replace(re, tbl);
  return text + '\n\n' + tbl;
}

function reportHtml(p){
  var rs=REPORTSTATE[cur]; if(!rs) return '';
  var r=kbReadiness();
  function renderMd(md){
    md=md.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    md=md.replace(/\*\*([^*\n]+)\*\*/g,'<strong style="color:#0b183b">$1</strong>');
    md=md.replace(/⚠️/g,'<span style="color:#d97706;font-weight:600">⚠️</span>');
    md=md.replace(/✅/g,'<span style="color:#16a34a">✅</span>');
    md=md.replace(/❌/g,'<span style="color:#dc2626">❌</span>');
    md=md.replace(/★+/g,function(m){return '<span style="color:#f59e0b">'+m+'</span>';});
    md=md.replace(/^#{0,3}\s*([一二三四五六七八九十]+)[、]\s*(.+)$/gm,
      '<div style="display:flex;align-items:center;gap:10px;margin:18px 0 8px;padding-bottom:6px;border-bottom:2px solid #1a56db">'+
        '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;background:#1a56db;color:#fff;border-radius:50%;font-size:12px;font-weight:700">$1</span>'+
        '<span style="font-size:14px;font-weight:750;color:#0b183b">$2</span></div>');
    md=md.replace(/^###\s(.+)$/gm,'<div style="font-size:13px;font-weight:700;color:#4a5568;margin:10px 0 4px;padding-left:10px;border-left:3px solid #6366f1">$1</div>');
    md=md.replace(/^##\s(.+)$/gm,'<div style="font-size:13.5px;font-weight:750;color:#0b183b;margin:12px 0 6px;padding:5px 12px;background:#f8faff;border-radius:8px;border-left:4px solid #1a56db">$1</div>');
    // 表格
    var outLines=[]; var inTbl=false;
    md.split('\n').forEach(function(line){
      var tr=line.trim();
      if(tr.charAt(0)==='|'&&tr.charAt(tr.length-1)==='|'){
        if(tr.slice(1,-1).split('|').every(function(c){return /^[\s\-:]+$/.test(c);})) return;
        var cells=tr.slice(1,-1).split('|').map(function(c){return c.trim();});
        if(!inTbl){inTbl=true;outLines.push('<div style="overflow-x:auto;margin:10px 0"><table style="width:100%;border-collapse:collapse;font-size:12.5px">');
          outLines.push('<thead><tr>'+cells.map(function(c){return '<th style="padding:7px 10px;background:#f0f4ff;border:1px solid #dbeafe;font-weight:700;color:#1e3a8a;text-align:left">'+c+'</th>';}).join('')+'</tr></thead><tbody>');}
        else outLines.push('<tr>'+cells.map(function(c,ci){return '<td style="padding:7px 10px;border:1px solid #e8edf5;color:#1e293b;background:'+(ci===0?'#fafbff':'#fff')+'">'+c+'</td>';}).join('')+'</tr>');
      } else {if(inTbl){outLines.push('</tbody></table></div>');inTbl=false;} outLines.push(line);}
    });
    if(inTbl)outLines.push('</tbody></table></div>');
    md=outLines.join('\n');
    md=md.replace(/^[-•]\s(.+)$/gm,'<li style="margin:4px 0;color:#1e293b">$1</li>');
    var parts=md.split('\n\n');
    md=parts.map(function(chunk){var c=chunk.trim();if(!c)return '';if(/^<(div|table|ul)/.test(c))return c;return '<p style="margin:5px 0;line-height:1.85;color:#1e293b">'+c.replace(/\n/g,'<br>')+'</p>';}).filter(Boolean).join('\n');
    return md;
  }
  return '<div style="border-radius:14px;border:1.5px solid #e8edf5;overflow:hidden;margin-bottom:8px">'+
    '<div style="padding:12px 16px;background:#f8faff;border-bottom:1px solid #e8edf5;display:flex;align-items:center;gap:8px">'+
      '<span style="font-size:12px;font-weight:650;color:#1a56db">📋 产业分析报告</span>'+
      '<span style="font-size:11.5px;color:#4a5568">'+p.topic+'</span>'+
      '<span style="margin-left:auto;font-size:11px;color:'+(topicScore(p.topic)>=80?'#22c55e':'#f59e0b')+'">置信度 '+topicScore(p.topic)+'%</span>'+
      '<button onclick="downloadReport(\'full\')" style="padding:4px 10px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:12px;color:#1a56db;cursor:pointer;font-weight:600;margin-left:6px">⬇ 下载</button>'+
    '</div>'+
    '<div style="padding:16px 18px;font-size:13px;color:#1e293b;line-height:1.8">'+
      // 按方向取报告正文：项目级 rs.text 是单例，切到未生成报告的新方向会串显旧方向正文
      '<p style="margin:0">'+renderMd(alignChainToReport((typeof reportTextForTopic==='function'?reportTextForTopic(p.topic):null)||''))+'</p>'+
    '</div>'+
  '</div>';
}

/* 产业隔离检索：识别 RAG 库里的独立产业集群，每个产业均衡取片段。
   避免某个片段密度高的产业(如香菇)霸占检索结果，保证 AI 归纳的方向覆盖多产业。
   做法：用产业关键词把 corpus 分桶，每桶各取最相关的 N 条，再合并去重。 */
function balancedIndustryChunks(city, corpus){
  if(!corpus || !corpus.length) return [];
  // 城市级产业簇定义(可扩展)：每个产业一组关键词。随州=专汽/氢能/应急/香菇。
  var INDUSTRY_CLUSTERS = {
    '随州': [
      {name:'专用汽车', kw:'专用汽车 专汽 整车 改装 底盘 动力总成 程力 齐星 楚胜'},
      {name:'氢能专用车', kw:'氢能 氢燃料电池 电堆 储氢瓶 新楚风 氢重卡'},
      {name:'安全应急装备', kw:'安全应急 应急装备 消防 无人机 应急机器人 移动应急 卫星通信'},
      {name:'香菇产业', kw:'香菇 菌种 食用菌 多糖 多肽 精深加工 裕国 品源 肽源'}
    ]
  };
  var clusters = INDUSTRY_CLUSTERS[city];
  // 无预定义簇的城市：按 chunk 的 topic 字段自动分桶(每个 topic 一个产业)
  if(!clusters){
    var byTopic={};
    corpus.forEach(function(c){ var t=c.topic||'其它'; (byTopic[t]=byTopic[t]||[]).push(c); });
    var out0=[];
    Object.keys(byTopic).forEach(function(t){ out0=out0.concat(byTopic[t].slice(0,3)); });
    return out0.slice(0,14);
  }
  // 每个产业簇各检索最相关的 4 条片段；记录哪些产业实际命中了片段
  var picked=[], seen={}, coveredNames=[];
  clusters.forEach(function(cl){
    var hits=kbSearch(city+' '+cl.kw, corpus, 4);
    var got=0;
    hits.forEach(function(h){
      var id=h.id||h.text;
      if(seen[id]) return;
      seen[id]=true; picked.push(h); got++;
    });
    if(got>0) coveredNames.push(cl.name);
  });
  picked._industries = coveredNames;  // 附带覆盖的产业清单，供 prompt 使用
  return picked;
}

/* AI 驱动的招商方向推荐：读 RAG 库让 DeepSeek 归纳该城市 3-5 个方向。
   结果缓存到 PROJECTS[cur].aiTopics（含 ts），完成后刷新方向卡片。
   AI 未就绪/失败时页面用正则兜底(generateTopicsFromKb)，路演无感知。 */
/* 是否已有可支撑方向生成的真实数据：随州种子数据 / 已上传材料 / 已确认结论。
   新城市仅有 generateKbConclusions 的"AI初判"占位文本时，视为无真实数据——
   此时不生成任何研究方向，避免"零上传却凭空出方向"。 */
function hasRealKbData(p){
  p=p||P(); if(!p) return false;
  // 已移除"随州直接视为有数据"的特权：随州与其他城市一视同仁。
  // 真实数据四类：上传材料 / 解析片段 / 确认结论 / AI流水线预置的实质板块条目。
  // 前三类缺失但第四类存在时，亦应视为有数据，避免“智能包导入的城市”被以“零活动”为由锁死。
  if(cur && (UPLOADS[cur]||[]).length>0) return true;                 // 已上传材料
  if(cur && (KB_FILE_CHUNKS[cur]||[]).length>0) return true;          // 已解析文件片段
  if(cur && KB_CONFIRMS[cur]){                                        // 已确认过任一结论
    var kc=KB_CONFIRMS[cur];
    for(var ki in kc){ if(kc[ki]){ for(var xi in kc[ki]){ if(kc[ki][xi]) return true; } } }
  }
  // 新增：AI 流水线/智能包预置的板块条目（p.kb[i].known）也是真实数据。
  // 迷你内测账号（如松江 city62883）无 UPLOADS/CHUNKS/CONFIRMS，但 kb 中已存在几百条实质文本，
  // 之前会被判为无数据→产业分析永远出不了方向。门槛：累计 ≥ 5 条实质文本(≥ 20 字)。
  if(p.kb && p.kb.length){
    var _real=0;
    for(var _i=0;_i<p.kb.length;_i++){
      var _k=p.kb[_i]; if(!_k||!_k.known) continue;
      for(var _j=0;_j<_k.known.length;_j++){
        var _t=(typeof _kbText==='function'?_kbText(_k.known[_j]):(typeof _k.known[_j]==='string'?_k.known[_j]:(_k.known[_j]&&_k.known[_j].text||'')))||'';
        if(_t && _t.length>=20){ _real++; if(_real>=5) return true; }
      }
    }
  }
  return false;
}

var _aiTopicsGenerating = {};
function ensureAiTopics(){
  var p=P(); if(!p||!cur) return;
  if(!hasRealKbData(p)) return;   // 无真实数据不生成方向
  var city=p.city||'随州';
  var key=cur;
  if(_aiTopicsGenerating[key]) return;
  // 已有AI方向缓存则不重复生成（永不自动过期，只有用户主动"重新分析"才刷新）
  // 避免方向名自动变化导致报告/待确认/图谱等数据key全部失配
  if(p.aiTopics && p.aiTopics.list && p.aiTopics.list.length) return;
  var corpus, chunks;
  try {
    corpus=buildKBCorpus(city);
    // 产业隔离：先识别 RAG 库里的独立产业集群，每个产业均衡取片段，
    // 避免笼统 query 让片段密度高的产业(如香菇)霸占检索结果、导致方向全集中在单一产业。
    chunks=balancedIndustryChunks(city, corpus);
  } catch(e){ return; }
  if(!chunks || !chunks.length) return;
  _aiTopicsGenerating[key]=true;
  var _inds=(chunks._industries&&chunks._industries.length)?chunks._industries:null;
  var q='请归纳'+city+'当前最值得推进的产业招商分析方向。';
  if(_inds){
    q+='知识片段覆盖以下'+_inds.length+'个产业：'+_inds.join('、')+'。'+
      '硬性要求：①必须覆盖上述每一个产业，每个产业至少归纳1个方向；'+
      '②同一产业最多2个方向；③优先保证产业覆盖面，而不是在单一产业里挖多个方向。'+
      '④总数控制在'+_inds.length+'~'+(_inds.length+1)+'个。';
  } else {
    q+='知识片段覆盖多个不同产业，你必须让方向分布到不同产业上，每个有明显缺口/升级空间的产业至少归纳1个方向，禁止把方向全集中在单一产业。';
  }
  // 改流式：mode=topics 非流式易被 Railway 网关(~60s)判超时→502。
  // SSE 累积成完整 txt 后，后续 JSON 解析逻辑保持不变。
  fetch('/api/kb-chat',{
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question:q, chunks:chunks, city:city, mode:'topics', stream:true, prefs:curOnbPrefs()})
  }).then(function(resp){
    if(!resp.ok || !resp.body) throw new Error('HTTP '+resp.status);
    var reader=resp.body.getReader(), decoder=new TextDecoder(), buf='', txt='';
    function pump(){
      return reader.read().then(function(d){
        if(d.done) return txt;
        buf+=decoder.decode(d.value,{stream:true});
        var lines2=buf.split('\n'); buf=lines2.pop();
        lines2.forEach(function(line){
          if(!line.startsWith('data:')) return;
          var d2=line.slice(5).trim(); if(d2==='[DONE]') return;
          try{
            var j=JSON.parse(d2);
            var delta=j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content||'';
            if(delta) txt+=delta;
          }catch(e){}
        });
        return pump();
      });
    }
    return pump();
  }).then(function(txt){
    txt = txt || '';
    var m=txt.match(/\{[\s\S]*\}/);
    if(!m) return;
    var data; try{ data=JSON.parse(m[0]); }catch(e){ return; }
    var list=(data.topics||[]).filter(function(t){return t&&t.label;}).map(function(t){
      return {label:String(t.label).trim(), icon:t.icon||'📌', type:t.type||'补链', desc:t.desc||'', fromAi:true};
    });
    if(!list.length) return;
    // 保留用户自定义方向（custom:true），不被AI刷新覆盖
    var _prevList=(PROJECTS[cur].aiTopics&&PROJECTS[cur].aiTopics.list)||[];
    var _customTopics=_prevList.filter(function(t){return t.custom;});
    _customTopics.forEach(function(ct){
      var dup=list.some(function(t){return t.label===ct.label;});
      if(!dup) list.push(ct);
    });
    PROJECTS[cur].aiTopics={list:list, ts:Date.now()};
    persist();
    if(view==='report' && !window._reportGenerating) render();
  }).catch(function(e){
    console.warn('ensureAiTopics failed:', e && e.message);
  }).finally(function(){
    _aiTopicsGenerating[key]=false;
  });
}

/* 正则兜底方向推荐（AI 未就绪时用）：按关键词匹配 RAG 文本 */
function generateTopicsFromKb(p){
  if(!p) return [];
  // 关键修复：数据门槛置于最前，忽略历史脏的 aiTopics 缓存。
  // 无真实数据(仅AI初判占位)时不产出任何方向，避免"零上传却凭空出方向"（含旧数据残留的 aiTopics）。
  // 用户手动添加的 customTopics 属于显式操作，始终保留。
  if(!hasRealKbData(p)){
    var _del0=p.deletedTopics||[]; return (p.customTopics||[]).filter(function(ct){return _del0.indexOf(ct)<0;}).map(function(ct){
      return {label:ct, icon:'\ud83d\udccc', type:'custom', desc:'\u81ea\u5b9a\u4e49\u65b9\u5411'};
    });
  }
  // AI 生成的方向优先（RAG 驱动，单一事实源）
  if(p && p.aiTopics && p.aiTopics.list && p.aiTopics.list.length){
    var aiList=p.aiTopics.list.slice();
    var customs0=(p.customTopics||[]);
    customs0.forEach(function(ct){
      if(!aiList.some(function(t){return t.label===ct;})){
        aiList.push({label:ct, icon:'\ud83d\udccc', type:'custom', desc:'\u81ea\u5b9a\u4e49\u65b9\u5411'});
      }
    });
    var _del1=p.deletedTopics||[]; aiList=aiList.filter(function(t){return _del1.indexOf(t.label)<0;});
    return aiList;
  }
  if(!p||!p.kb) return [];
  var allKnown=[];
  p.kb.forEach(function(k){ (k.known||[]).forEach(function(x){ allKnown.push(x); }); });
  // 通用方向推荐：不硬编码特定城市关键词，直接从RAG库内容提取产业关键词
  // 当AI推荐不可用时，给出通用占位方向
  topics=[
    {label:p.city+'主导产业补链',icon:'\ud83c\udfed',type:'补链',desc:'基于城市智库产业链缺口分析'},
    {label:p.city+'产业转移承接',icon:'\ud83d\udd04',type:'承接转移',desc:'承接产业转移，利用区位成本优势'},
    {label:p.city+'特色产业升级',icon:'\u2b06\ufe0f',type:'精深加工',desc:'现有产业向高附加值延伸'},
  ];
  // Append user-defined custom topics
  var customs = (p.customTopics||[]);
  customs.forEach(function(ct){
    if(!topics.some(function(t){return t.label===ct;})){
      topics.push({label:ct, icon:'\ud83d\udccc', type:'custom', desc:'\u81ea\u5b9a\u4e49\u65b9\u5411'});
    }
  });
  // 过滤掉用户明确删除过的方向
  var _del=p.deletedTopics||[];
  topics=topics.filter(function(t){return _del.indexOf(t.label)<0;});
  return topics;
}


function homePage(p){
  var r=kbReadiness();

  // ── 可靠性横幅 ──
  var reliabilityBanner=
    '<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;background:'+(r.score>=80?'#f0fdf4':'#fffbeb')+';border-bottom:1px solid '+(r.score>=80?'#86efac':'#fde68a')+'">'+
      '<div style="flex:1;min-width:0">'+
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'+
          '<span style="font-size:12px;font-weight:650;color:'+(r.score>=80?'#166534':'#92400e')+'">从城市智库继承数据</span>'+
          '<span style="font-size:11px;color:'+(r.score>=80?'#22c55e':'#f59e0b')+';font-weight:700">'+r.score+'%</span>'+
          '<span style="font-size:11px;color:'+(r.score>=80?'#22c55e':'#f59e0b')+'">'+r.label+'</span>'+
          '<span title="置信度计算：确认⚠️事项×60% + 上传材料×10%（上限40%）。确认全部4条→+60，上传2份材料→+20，合计80%自动解锁" style="font-size:11px;color:#9aa5b5;cursor:help;text-decoration:underline dotted;margin-left:4px">ⓘ 如何提升</span>'+
        '</div>'+
        '<div style="height:4px;background:'+(r.score>=80?'#dcfce7':'#fef3c7')+';border-radius:2px;overflow:hidden">'+
          '<div style="height:100%;width:'+r.score+'%;background:'+(r.score>=80?'#22c55e':'#f59e0b')+';border-radius:2px;transition:width .4s"></div>'+
        '</div>'+
      '</div>'+
      (r.score<80
        ? '<button onclick="go(\'knowledge\')" style="flex-shrink:0;padding:6px 12px;background:#fff;border:1.5px solid #fde68a;border-radius:8px;font-size:12px;color:#92400e;cursor:pointer;font-weight:600">补充城市智库 →</button>'
        : '<span style="flex-shrink:0;font-size:12px;color:#22c55e">✓ 可直接生成产业分析</span>'
      )+
    '</div>';

  // ── 推荐方向卡片 ──
  // 后台从 RAG 库生成 AI 推荐方向（正则兜底先占位，AI 就绪后替换）
  ensureAiTopics();
  var recommendedTopics=generateTopicsFromKb(p);

  var topicCards=recommendedTopics.map(function(t){
    return topicCardHtml(t, p.topic===t.label);
  }).join('');
  // AI方向正在生成中（无AI缓存）→ 显示loading占位（不管正则兜底有没有结果）
  if(_aiTopicsGenerating[cur] && !(p.aiTopics && p.aiTopics.list && p.aiTopics.list.length)){
    topicCards='<div style="flex:1;padding:22px 18px;background:#f8faff;border:1.5px solid #e8edf5;border-radius:14px;text-align:center">'+
      '<div style="display:inline-block;width:24px;height:24px;border:3px solid #e2e8f0;border-top-color:#6366f1;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:10px"></div>'+
      '<div style="font-size:13px;font-weight:700;color:#0b183b;margin-bottom:4px">AI 正在分析产业方向…</div>'+
      '<div style="font-size:12px;color:#8492a6;line-height:1.6">基于城市智库数据生成推荐方向，约 10-20 秒</div>'+
    '</div>';
  }
  // 无真实数据(未上传材料)时不显示凭空方向，改为引导先上传/确认智库
  else if(!recommendedTopics.length){
    topicCards='<div style="flex:1;padding:22px 18px;background:#f8faff;border:1.5px dashed #cbd5e1;border-radius:14px;text-align:center">'+
      '<div style="font-size:22px;margin-bottom:8px">📥</div>'+
      '<div style="font-size:13px;font-weight:700;color:#0b183b;margin-bottom:4px">暂无产业分析方向</div>'+
      '<div style="font-size:12px;color:#8492a6;line-height:1.6">请先到「城市智库」上传政府/产业材料并确认结论，<br>系统将据此生成该城市的招商分析方向</div>'+
      '<button onclick="go(\'knowledge\')" style="margin-top:12px;padding:8px 18px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:10px;font-size:12.5px;font-weight:650;cursor:pointer">去完善城市智库 →</button>'+
    '</div>';
  }

  var topicSelector=
    '<div style="padding:0 0 20px">'+
      '<div style="font-size:12px;font-weight:650;color:#4a5568;margin-bottom:10px;letter-spacing:.3px">选择产业分析方向</div>'+
      '<div id="topicCardGrid" style="display:flex;gap:10px;margin-bottom:12px">'+topicCards+'</div>'+
      '<div style="display:flex;align-items:center;gap:8px">'+
        '<div style="flex:1;position:relative">'+
          '<input id="topicCustomInput" placeholder="或输入自定义方向…" value="" '+
            'style="width:100%;box-sizing:border-box;padding:10px 14px;border:1.5px solid #e8edf5;border-radius:10px;font-size:13px;color:#0b183b;outline:none;transition:border .15s" '+
            'onfocus="this.style.border=\'1.5px solid #6366f1\'" '+
            'onblur="this.style.border=\'1.5px solid #e8edf5\'" '+
            'onkeydown="if(event.key===\'Enter\'){event.preventDefault();addCustomTopic();}" />'+
        '</div>'+
        '<button onclick="addCustomTopic()" style="flex-shrink:0;padding:10px 18px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:650;cursor:pointer;white-space:nowrap">确认添加</button'+
        '</div>'+
      '</div>'+
    '</div>';

  // ── 报告区 ──
  // 进入产业分析页时清除旧报告状态，强制重新分析
  if(REPORTSTATE[cur]&&REPORTSTATE[cur].phase===1){
    // 保留 Phase 2 完整报告，但草稿不缓存展示
  }
  var reportArea=
    '<div id="reportArea">'+
      '<div id="reportHistoryArea"></div>'+
      (window._reportGenerating
        ? '<div style="border-radius:16px;border:1.5px solid #fed7aa;overflow:hidden;margin-bottom:8px">'+
            '<div style="padding:14px 18px;background:linear-gradient(135deg,#fffbeb,#fef3c7);border-bottom:1px solid #fde68a;display:flex;align-items:center;gap:10px">'+
              '<div style="width:18px;height:18px;border:2.5px solid #e2e8f0;border-top-color:#f59e0b;border-radius:50%;animation:spin 1s linear infinite"></div>'+
              '<div style="font-size:13px;font-weight:700;color:#92400e">初步研判草稿生成中…</div>'+
            '</div>'+
            '<div id="reportContent" style="padding:20px 22px;font-size:13px;color:#1e293b;line-height:1.85;min-height:80px"></div>'+
          '</div>'
        : (REPORTSTATE[cur]&&REPORTSTATE[cur].phaseByTopic&&REPORTSTATE[cur].phaseByTopic[p.topic]===2)
        ? reportHtml(p)+'<div id="chainMapBlock" style="animation:fadeIn .6s ease-out">'+chainMapHtml(p)+'</div>'+'<div id="actionItemsBlock" style="animation:fadeIn .8s ease-out .3s both">'+restoreActionItems()+'</div>'+restoreConfirmPanel()
        : (REPORTSTATE[cur]&&REPORTSTATE[cur].text)||(PENDING_CONFIRMS[cur]&&PENDING_CONFIRMS[cur].length)||(REPORTSTATE[cur]&&p&&_findPendingForTopic(REPORTSTATE[cur],p.topic).length)
        ? reportHtml(p)+restoreConfirmPanel()
        : '<div style="text-align:center;padding:48px 20px">'+
            '<div style="font-size:40px;margin-bottom:12px">📋</div>'+
            '<div style="font-size:15px;font-weight:700;color:#0b183b;margin-bottom:8px">'+
              '选择上方产业分析方向，点击「🔍 产业智能分析」'+
            '</div>'+
            '<div style="font-size:12.5px;color:#8492a6;line-height:1.8">'+
              '① AI 先出初步草稿（约10秒）② 逐条确认待确认事项 ③ 生成完整五章报告'+
            '</div>'+
          '</div>'
      )+
    '</div>';
  // 生成中切换方向后切回：恢复reportContent中已有的流式文本
  if(window._reportGenerating && window._liveAccText){
    setTimeout(function(){
      var _rc=document.getElementById('reportContent');
      if(_rc && !_rc.textContent.trim()) _rc.innerHTML='<p style="margin:0">'+window._liveAccText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')+'</p>';
    },0);
  }
  // 自动触发 Phase 1（若非完整报告）
  setTimeout(function(){ renderHistoryReports(cur); }, 0);




  return '<div class="page">'+
    reliabilityBanner+
    '<div class="conversation-scroll" style="padding:16px 22px 0">'+
      topicSelector+
      reportArea+
    '</div>'+
    // 底部行动栏（替代 composer）—— 内容按当前方向渲染，切换方向时同步刷新
    '<div class="report-bottom-bar" style="border-top:1px solid #f0f4ff;background:#fff;padding:12px 22px;display:flex;gap:10px;align-items:center">'+
      reportBottomBarInner(p)+
    '</div>'+
  '</div>';
}

/* 底部行动栏内容（按当前方向 topic 判断）。抽成函数，供初次渲染与切换方向时复用刷新。 */
function reportBottomBarInner(p){
  var _hasFull = topicHasFullReport(p.topic);
  // 检测该方向是否已完成草稿(phase1)但尚未生成完整报告
  var _hasDraft = !_hasFull && REPORTSTATE[cur] && REPORTSTATE[cur].phaseByTopic && REPORTSTATE[cur].phaseByTopic[p.topic]===1;
  if(_hasDraft){
    return '<div style="flex:1;font-size:12.5px;color:#92400e;background:#fffbeb;padding:10px 14px;border-radius:10px;border:1px solid #fde68a;line-height:1.6">初步研判已完成，确认待确认事项后生成完整五章报告</div>'+
      '<button onclick="triggerReport(2)" style="padding:12px 20px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:13.5px;font-weight:650;cursor:pointer;white-space:nowrap">生成完整产业报告 \u2192</button>'+
      '<button onclick="doUpload()" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">\ud83d\udcce 补充材料</button>';
  }
  return (_hasFull
      ? ('<button onclick="viewCurrentReport()" '+
          'style="flex:1;padding:13px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:650;cursor:pointer;letter-spacing:.2px">📊 查看完整报告</button>'+
         '<button onclick="downloadReport(\'full\')" style="padding:13px 16px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:12px;font-size:13px;color:#1a56db;cursor:pointer;font-weight:600">⬇ 下载</button>'+
         '<button onclick="startAiInterview()" style="padding:13px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:12.5px;color:#4a5568;cursor:pointer">🔄 重新产业分析</button>')
      : ('<button id="generateBtn" onclick="startAiInterview()" '+
          'style="flex:1;padding:13px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:650;cursor:pointer;letter-spacing:.2px">'+
          '🔍 产业智能分析'+
    '</button>'))+
    '<button onclick="doUpload()" style="padding:13px 16px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">📎 补充材料</button>'+
    // 提交招引需求：仅在该方向已有完整报告时才出现（无报告不该能提交）
    (_hasFull
      ? '<button onclick="submitDemand()" style="padding:13px 16px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;font-size:13px;color:#166534;cursor:pointer;font-weight:600">提交招引需求 →</button>'
      : ''
    );
}


function promptRow(icon,strong,small,fn){
  return '<button class="prompt-row" onclick="'+fn+'"><i class="i">'+icon+'</i><span><strong>'+strong+'</strong><small>'+small+'</small></span><i class="i">➜</i></button>';
}
function aiAvatar(){return 'data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46"><rect width="46" height="46" rx="23" fill="#ebf3fd"/><text x="23" y="30" font-size="18" fill="#0757ad" text-anchor="middle" font-family="sans-serif">慧</text></svg>')}

// 统计三类记忆条数
function memBankStats(){
  var p=P();
  var textN=0, fileN=0, chatN=0;
  var _mk=(typeof cityKeys==='function')?cityKeys():[cur]; _mk.forEach(function(k){ var cf=KB_CONFIRMS[k]||{};
  Object.keys(cf).forEach(function(ki){ Object.keys(cf[ki]||{}).forEach(function(){ textN++; }); });
  fileN+=(UPLOADS[k]||[]).length; });
  // 统计当前城市全部会话的用户提问数
  (function(){ var st=kbSessionStore(cur); if(st){ st.sessions.forEach(function(s){ (s.messages||[]).forEach(function(m){ if(m.role==='user') chatN++; }); }); } })();
  return {textN:textN, fileN:fileN, chatN:chatN, total:textN+fileN+chatN};
}
function memBankBadge(){
  var s=memBankStats();
  if(!s.total)return '';
  return ' <span style="display:inline-block;min-width:16px;padding:0 5px;background:#6366f1;color:#fff;border-radius:9px;font-size:10px;line-height:16px;text-align:center;font-weight:700">'+s.total+'</span>';
}
// 动态当前日期时间（替代硬编码的"7月20日 06:00"）
function nowLabel(){
  var d=new Date();
  var pad=function(n){return n<10?'0'+n:''+n;};
  return (d.getMonth()+1)+'月'+d.getDate()+'日 '+pad(d.getHours())+':'+pad(d.getMinutes());
}
function fmtTs(ts){
  if(!ts)return '';
  var d=new Date(ts);
  var pad=function(n){return n<10?'0'+n:''+n;};
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes());
}
function memTab(id,label,n,active){
  return '<button onclick="switchMemTab(\''+id+'\')" data-memtab="'+id+'" '+
    'style="flex:1;padding:10px 8px;border:none;border-bottom:2.5px solid '+(active?'#6366f1':'transparent')+';'+
    'background:none;cursor:pointer;font-size:13px;font-weight:'+(active?'700':'500')+';color:'+(active?'#4338ca':'#8492a6')+';transition:.15s">'+
    label+'<span style="display:inline-block;margin-left:5px;min-width:18px;padding:0 6px;background:'+(active?'#eef2ff':'#f1f5f9')+';color:'+(active?'#4f46e5':'#94a3b8')+';border-radius:9px;font-size:11px;line-height:18px;font-weight:700">'+n+'</span></button>';
}
var _memTab='text';
function openMemoryBank(){
  _memTab='text';
  var p=P();
  openModal('\🧠 '+(p.city||'城市')+'智库 · 记忆库',
    '<div style="margin:-4px 0 2px;font-size:12px;color:#8492a6;line-height:1.6">这里沉淀了本智库的全部长期记忆——确认过的关键结论、上传的政府材料、以及历史问答。每一条都可追溯来源与时间。</div>'+
    '<div id="memTabBar" style="display:flex;border-bottom:1px solid #eef2f7;margin:12px 0 4px"></div>'+
    '<div id="memBody" style="min-height:220px;max-height:56vh;overflow-y:auto;padding:4px 2px"></div>',
    '<button class="primary-button" onclick="closeModal()">完成</button>');
  renderMemTabs();
  renderMemBody();
}
function renderMemTabs(){
  var s=memBankStats();
  var bar=document.getElementById('memTabBar'); if(!bar)return;
  bar.innerHTML=
    memTab('text','\📝 文字记忆',s.textN,_memTab==='text')+
    memTab('file','\📎 文件记忆',s.fileN,_memTab==='file')+
    memTab('chat','\💬 问答记忆',s.chatN,_memTab==='chat');
}
function switchMemTab(id){ _memTab=id; renderMemTabs(); renderMemBody(); }
function memEmpty(txt){
  return '<div style="text-align:center;padding:48px 20px;color:#b0bac8">'+
    '<div style="font-size:38px;margin-bottom:10px;opacity:.5">\🗂️</div>'+
    '<div style="font-size:13px">'+txt+'</div></div>';
}
function renderMemBody(){
  var box=document.getElementById('memBody'); if(!box)return;
  if(_memTab==='text') box.innerHTML=memTextView();
  else if(_memTab==='file') box.innerHTML=memFileView();
  else box.innerHTML=memChatView();
}
function memTextView(){
  var p=P(); var rows=[]; var _tk=(typeof cityKeys==='function')?cityKeys():[cur]; _tk.forEach(function(pk){ var cf=KB_CONFIRMS[pk]||{}; var pp=PROJECTS[pk]||{};
  /* rows 已在函数首行声明，勿在此重置 */
  Object.keys(cf).forEach(function(ki){
  var topic=(pp.kb&&pp.kb[ki])?pp.kb[ki].t:'未知主题';
  var icon=(pp.kb&&pp.kb[ki])?pp.kb[ki].icon:'\📌';
    Object.keys(cf[ki]||{}).forEach(function(ii){
      var rec=cf[ki][ii]; if(!rec)return;
      rows.push({topic:topic, icon:icon, text:rec.text||'', status:rec.status||'confirmed', ts:rec.ts||0, projKey:pk, kbIdx:parseInt(ki,10), itemIdx:parseInt(ii,10)});
    });
  });
  }); if(!rows.length) return memEmpty('还没有确认或修改过的结论。<br>在主题卡里点「确认」或「编辑」后，会沉淀到这里。');
  rows.sort(function(a,b){return b.ts-a.ts;});
  return '<div style="margin-bottom:10px;text-align:right">'+
      '<button onclick="clearMemText()" style="font-size:11px;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:4px 10px;cursor:pointer">清空文字记忆</button>'+
    '</div>'+
    rows.map(function(r){
    var isEdit=r.status==='edited';
    var badge=isEdit
      ? '<span style="background:#eef2ff;color:#4f46e5;padding:1px 8px;border-radius:10px;font-size:10.5px;font-weight:700">\u270e 领导修改</span>'
      : '<span style="background:#ecfdf5;color:#059669;padding:1px 8px;border-radius:10px;font-size:10.5px;font-weight:700">\u2713 确认</span>';
    return '<div style="border:1px solid #eef2f7;border-left:3px solid '+(isEdit?'#6366f1':'#10b981')+';border-radius:10px;padding:11px 13px;margin-bottom:9px;background:#fff">'+
      '<div style="display:flex;align-items:center;gap:7px;margin-bottom:6px">'+
        '<span style="font-size:14px">'+r.icon+'</span>'+
        '<span style="font-size:11.5px;color:#6366f1;font-weight:650">'+r.topic+'</span>'+
        badge+
        '<span style="margin-left:auto;font-size:10.5px;color:#b0bac8">'+fmtTs(r.ts)+'</span>'+
        '<button onclick="delMemText(\''+r.projKey+'\','+r.kbIdx+','+r.itemIdx+')" title="删除该条记忆" style="background:none;border:none;color:#cbd5e1;font-size:14px;cursor:pointer;padding:0 2px;line-height:1" onmouseover="this.style.color=\'#dc2626\'" onmouseout="this.style.color=\'#cbd5e1\'">\u2715</button>'+
      '</div>'+
      '<div style="font-size:13px;color:#1e293b;line-height:1.7">'+highlightKeyData(r.text)+'</div>'+
    '</div>';
  }).join('');
}
function memFileView(){
  var _fk=(typeof cityKeys==='function')?cityKeys():[cur]; var ups=[]; _fk.forEach(function(pk){ (UPLOADS[pk]||[]).forEach(function(u){ if(!!u.size||!!u.ts){ var _u=Object.assign({},u); _u._pk=pk; ups.push(_u); } }); }); var p=P();
  if(!ups.length) return memEmpty('还没有上传过材料。<br>在问答框点「\📎 补充材料」上传政府文件（PDF/Word/TXT），会真正解析入库。');
  var list=ups.slice().reverse();
  return '<div style="margin-bottom:10px;text-align:right">'+
      '<button onclick="clearMemFile()" style="font-size:11px;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:4px 10px;cursor:pointer">清空文件记忆</button>'+
    '</div>'+
    list.map(function(u){
    var _up=PROJECTS[u._pk]||p; var kb=(u.kbIdx!=null&&_up.kb&&_up.kb[u.kbIdx])?_up.kb[u.kbIdx].t:(_up.city?_up.city+'·城市智库':'城市智库');
    var sizeStr=u.size?(Math.round(u.size/1024)+' KB'):'';
    var ts=u.ts||0; var when=ts?fmtTs(ts):(u.at||'');
    var ext=(u.name||'').split('.').pop().toLowerCase();
    var emap={pdf:'\📕',doc:'\📘',docx:'\📘',xls:'\📗',xlsx:'\📗',csv:'\📗',txt:'\📄',md:'\📄',json:'\📄'};
    var fico=emap[ext]||'\U0001f4ce';
    var chunks=(u.chunks!=null)?u.chunks:0;
    var parsed=chunks>0;
    var pill=u.pending
      ? '<span style="background:#fef9c3;color:#a16207;padding:1px 8px;border-radius:10px;font-size:10.5px;font-weight:700">\u23f3 解析中</span>'
      : (parsed
        ? '<span style="background:#ecfdf5;color:#059669;padding:1px 8px;border-radius:10px;font-size:10.5px;font-weight:700">\u2713 已解析 '+chunks+' 片段</span>'
        : '<span style="background:#fef2f2;color:#dc2626;padding:1px 8px;border-radius:10px;font-size:10.5px;font-weight:700">\u26a0 仅记录文件名</span>');
    return '<div style="border:1px solid #eef2f7;border-radius:10px;padding:11px 13px;margin-bottom:9px;background:#fff;display:flex;align-items:flex-start;gap:11px">'+
      '<span style="font-size:26px;flex-shrink:0">'+fico+'</span>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="display:flex;align-items:flex-start;gap:6px">'+
          '<div style="flex:1;font-size:13px;font-weight:600;color:#1e293b;word-break:break-all;line-height:1.4">'+u.name+'</div>'+
          '<button onclick="delMemFile(\''+(u._pk||cur)+'\',\''+encodeURIComponent(u.name)+'\','+(u.ts||0)+')" title="删除该文件记忆" style="background:none;border:none;color:#cbd5e1;font-size:14px;cursor:pointer;padding:0 2px;line-height:1;flex-shrink:0" onmouseover="this.style.color=\'#dc2626\'" onmouseout="this.style.color=\'#cbd5e1\'">\u2715</button>'+
        '</div>'+
        '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-top:6px">'+
          pill+
          '<span style="font-size:11px;color:#8492a6">\📁 '+kb+'</span>'+
          (sizeStr?'<span style="font-size:11px;color:#b0bac8">'+sizeStr+'</span>':'')+
          '<span style="margin-left:auto;font-size:10.5px;color:#b0bac8">'+when+'</span>'+
        '</div>'+
      '</div>'+
    '</div>';
  }).join('');
}
function memChatView(){
  var st=kbSessionStore(cur);
  var sessions = st ? st.sessions.slice() : [];
  // 只显示有内容的会话，倒序（新会话在上）
  sessions = sessions.filter(function(s){return s.messages&&s.messages.length;}).reverse();
  if(!sessions.length) return memEmpty('还没有问答记录。<br>在下方对话框提问后，历史会按会话分组保留在这里。');
  return '<div style="margin-bottom:10px;text-align:right">'+
      '<button onclick="clearMemChat()" style="font-size:11px;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:4px 10px;cursor:pointer">清空全部问答记忆</button>'+
    '</div>'+
    sessions.map(function(s){
      var isActive = st && st.activeId===s.id;
      var head = '<div style="display:flex;align-items:center;gap:8px;margin:14px 0 8px;padding-bottom:6px;border-bottom:1px solid #eef2f7">'+
        '<span style="font-size:13px;line-height:1">💬</span>'+
        '<strong style="font-size:12.5px;color:#1e293b">'+(s.title||'新对话')+'</strong>'+
        (isActive?'<span style="font-size:10px;color:#0757ad;background:#ebf3fd;border-radius:8px;padding:1px 7px">当前</span>':'')+
        '<span style="font-size:10.5px;color:#94a3b8">'+fmtTs(s.ts)+' · '+(s.messages||[]).filter(function(m){return m.role==='user';}).length+' 问</span>'+
        '<button onclick="memSwitchSession(\''+s.id+'\')" style="margin-left:auto;font-size:10.5px;color:#0757ad;background:#fff;border:1px solid #cfe0f1;border-radius:7px;padding:2px 9px;cursor:pointer">进入续聊</button>'+
        '<button onclick="memDeleteSession(\''+s.id+'\')" title="删除整个会话" style="font-size:10.5px;color:#dc2626;background:#fff;border:1px solid #fecaca;border-radius:7px;padding:2px 9px;cursor:pointer">删除</button>'+
      '</div>';
      var body = (s.messages||[]).map(function(m){
        var isU=m.role==='user';
        if(m.role==='ingest-actions'||m.role==='new-facts') return '';
        return '<div style="margin-bottom:9px;display:flex;'+(isU?'justify-content:flex-end':'justify-content:flex-start')+'">'+
          '<div style="max-width:82%;border-radius:12px;padding:8px 12px;font-size:12.5px;line-height:1.65;'+
            (isU?'background:#eef2ff;color:#3730a3;border:1px solid #e0e7ff':'background:#f8fafc;color:#1e293b;border:1px solid #eef2f7')+'">'+
            '<div style="font-size:10px;color:#94a3b8;margin-bottom:3px;font-weight:600">'+(isU?'招商干部':'慧小招 AI')+(m.ts?' \u00b7 '+fmtTs(m.ts):'')+'</div>'+
            (m.text!=null?m.text:(m.content!=null?m.content.replace(/</g,'&lt;').replace(/\n/g,'<br>'):(m.html||'')))+
          '</div>'+
        '</div>';
      }).join('');
      return head+body;
    }).join('');
}
// 记忆库里点"进入续聊"→切到该会话并跳到对话页
function memSwitchSession(id){ kbSwitchSession(id); go('knowledge'); }
function memDeleteSession(id){
  if(!confirm('确定删除整个会话吗？该会话下的问答记录将不可恢复。')) return;
  kbDeleteSession(id); renderMemTabs(); renderMemBody(); toast('会话已删除');
}
function clearMemChat(){
  if(!cur)return;
  if(!confirm('确定清空全部问答记忆吗？所有会话都会被删除，此操作不可恢复。')) return;
  var _ck=kbChatKey(cur);
  // 清空同样要逐会话打墓碑，否则刷新后全部从服务端复活
  try{ ((KB_CHAT[_ck]||{}).sessions||[]).forEach(function(s){ _tombKbChatSession(_ck, s.id); }); }catch(_){}
  KB_CHAT[_ck]={sessions:[],activeId:null}; persist();
  renderMemTabs(); renderMemBody();
  toast('问答记忆已清空');
}
/* 记忆库·文字记忆：删除单条（对应 KB_CONFIRMS[cur][kbIdx][itemIdx]，同时把 known 里的 ✅ 标记还原为 ⚠️ 待确认） */
function delMemText(pk, kbIdx, itemIdx){
  pk=pk||cur;
  if(!pk||!KB_CONFIRMS[pk]||!KB_CONFIRMS[pk][kbIdx])return;
  if(!confirm('删除这条文字记忆？该结论将回到「待确认」状态。')) return;
  delete KB_CONFIRMS[pk][kbIdx][itemIdx];
  _tombConfirm(pk,kbIdx,itemIdx);  // 打墓碑，防止被 _mergeConfirms 从对端回灌复活
  if(!Object.keys(KB_CONFIRMS[pk][kbIdx]).length) delete KB_CONFIRMS[pk][kbIdx];
  // 把知识片段里对应条目的 ✅ 前缀还原为 ⚠️（回到待确认），保持数据一致
  var p=P();
  var p=PROJECTS[pk]||{};
  if(p&&p.kb&&p.kb[kbIdx]&&p.kb[kbIdx].known&&p.kb[kbIdx].known[itemIdx]){
    var t=p.kb[kbIdx].known[itemIdx];
    var _tx=(t&&typeof t==='object')?t.text:String(t||'');
    if(_tx.indexOf('\u2705')===0){ if(t&&typeof t==='object') t.text=_tx.replace(/^\u2705\s*/,'\u26a0\ufe0f '); else p.kb[kbIdx].known[itemIdx]=_tx.replace(/^\u2705\s*/,'\u26a0\ufe0f '); }
  }
  persist();
  if(typeof refreshKbProgress==='function') refreshKbProgress();
  renderMemTabs(); renderMemBody();
  toast('已删除该条文字记忆');
}
/* 记忆库·文字记忆：清空全部 */
function clearMemText(){
  if(!cur)return;
  if(!confirm('确定清空全部文字记忆吗？所有已确认结论将回到「待确认」状态，不可恢复。')) return;
  var p=P();
  // 还原所有 ✅ 为 ⚠️（遍历本城市所有招商方向）
  var _ck=(typeof cityKeys==='function')?cityKeys():[cur];
  _ck.forEach(function(pk){ var p=PROJECTS[pk]||{}; if(!KB_CONFIRMS[pk])return;
  Object.keys(KB_CONFIRMS[pk]).forEach(function(ki){
    Object.keys(KB_CONFIRMS[pk][ki]||{}).forEach(function(ii){
      if(p&&p.kb&&p.kb[ki]&&p.kb[ki].known&&p.kb[ki].known[ii]){
        var t=p.kb[ki].known[ii];
        var _tx2=(t&&typeof t==='object')?t.text:String(t||''); if(_tx2.indexOf('\u2705')===0){ if(t&&typeof t==='object') t.text=_tx2.replace(/^\u2705\s*/,'\u26a0\ufe0f '); else p.kb[ki].known[ii]=_tx2.replace(/^\u2705\s*/,'\u26a0\ufe0f '); }
      }
    });
  });
  Object.keys(KB_CONFIRMS[pk]||{}).forEach(function(ki){
    Object.keys(KB_CONFIRMS[pk][ki]||{}).forEach(function(ii){ _tombConfirm(pk,ki,ii); });
  });
  KB_CONFIRMS[pk]={}; }); persist();
  if(typeof refreshKbProgress==='function') refreshKbProgress();
  renderMemTabs(); renderMemBody();
  toast('文字记忆已清空');
}
/* 记忆库·文件记忆：删除单条（按 name+ts 定位；同时清理该文件产生的 corpus chunks） */
function delMemFile(pk, encName, ts){
  pk=pk||cur;
  /* guard moved below */
  var name=decodeURIComponent(encName||''); if(!UPLOADS[pk])return;
  if(!confirm('删除文件记忆「'+name+'」？其解析产生的知识片段也会一并移除。')) return;
  _tombUploadFile(pk, name);   // 先打墓碑：服务端已改为只增不减，不打墓碑会被合并回来
  UPLOADS[pk]=UPLOADS[pk].filter(function(u){ return !(u.name===name && (u.ts||0)===(ts||0)); });
  // 清理该文件解析出的 corpus 片段
  if(KB_FILE_CHUNKS[pk]) KB_FILE_CHUNKS[pk]=(KB_FILE_CHUNKS[pk]||[]).filter(function(c){ return c.file!==name && c.source!==name; });
  // (旧的按当前方向清理逻辑已由上一行按 pk 清理取代)
  persist();
  if(typeof refreshKbProgress==='function') refreshKbProgress();
  renderMemTabs(); renderMemBody();
  toast('已删除该文件记忆');
}
/* 记忆库·文件记忆：清空全部 */
function clearMemFile(){
  if(!cur)return;
  if(!confirm('确定清空全部文件记忆吗？所有已上传材料及其解析片段将被移除，不可恢复。')) return;
  var _ck=(typeof cityKeys==='function')?cityKeys():[cur];
  // 清空同样要逐文件打墓碑，否则下次同步全部复活
  _ck.forEach(function(pk){ (UPLOADS[pk]||[]).forEach(function(u){ if(u&&u.name) _tombUploadFile(pk,u.name); }); });
  _ck.forEach(function(pk){ UPLOADS[pk]=[]; if(KB_FILE_CHUNKS[pk]) KB_FILE_CHUNKS[pk]=[]; });
  persist();
  if(typeof refreshKbProgress==='function') refreshKbProgress();
  renderMemTabs(); renderMemBody();
  toast('文件记忆已清空');
}
/* 招商问答：一键回到顶部 */
function kbScrollTop(){
  var sc=document.getElementById('kbScroll');
  if(sc) sc.scrollTo({top:0,behavior:'smooth'});
}
/* 滚动超过一屏时显示回到顶部按钮（rAF 节流 + 变化判断，避免每帧 style 写入） */
var _kbTopBtnPending=false, _kbTopBtnLastShown=null;
function kbToggleTopBtn(){
  if(_kbTopBtnPending) return;
  _kbTopBtnPending=true;
  requestAnimationFrame(function(){
    _kbTopBtnPending=false;
    var sc=document.getElementById('kbScroll'), btn=document.getElementById('kbTopBtn');
    if(!sc||!btn) return;
    var _shown = sc.scrollTop>300;
    if(_shown!==_kbTopBtnLastShown){ btn.style.display = _shown ? 'flex' : 'none'; _kbTopBtnLastShown=_shown; }
  });
}
function kbPage(p){
  return '<div class="page" style="position:relative">'+
    (function(){
      var r=kbReadiness();
      return '<div class="page-header"><div>'+
        '<span class="eyebrow">CITY INTELLIGENCE</span><h1>城市智库 · 招商问答</h1>'+
        '<p>点击主题卡展开详细结论，或直接在下方对话框提问。</p>'+
        '<div id="kbPageProgress">'+kbPageProgressInner(r)+'</div>'+
        '</div>'+
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'+
        '<div style="position:relative;display:inline-block" onmouseenter="document.getElementById(\'uploadHint\').style.display=\'block\'" onmouseleave="document.getElementById(\'uploadHint\').style.display=\'none\'">'+
        '<button onclick="uploadHint()" style="padding:9px 18px;background:#eff6ff;border:1.5px solid #1a56db;border-radius:10px;font-size:13px;font-weight:700;color:#1a56db;cursor:pointer">上传补充材料</button>'+
        '<div id="uploadHint" style="display:none;position:absolute;top:calc(100% + 4px);left:0;background:#fff;border:1.5px solid #e8edf5;border-radius:12px;padding:14px 16px;box-shadow:0 6px 20px rgba(0,0,0,.08);width:260px;z-index:100">'+
          '<div style="font-size:12px;color:#4a5568;line-height:1.7">支持上传：政府工作报告、会议讲话稿、产业报告、园区资料、企业名单等</div>'+
        '</div>'+
        '</div>'+
        '<button class="ghost-button" onclick="openMemoryBank()" style="border-color:#c7d2fe;color:#4f46e5"> 记忆库'+memBankBadge()+'</button>'+
        '<button class="ghost-button" onclick="showDownloadReport()"><i class="i"></i>下载分析报告</button>'+
        '</div>'+
        '</div>';
    })()+

    '<div class="knowledge-scroll" id="kbScroll" onscroll="kbToggleTopBtn()"><div class="topic-grid">'+
      p.kb.map(function(k,i){
        if(!k.known||!k.known.length) return '';
        if(!k.sub&&!k.tag) return '';
        var tagColor=k.known&&k.known.length?
          (k.tag.indexOf('待')>=0?'color:#c08a2a;background:#fff8e6':'color:#006d70;background:#e4f5f3'):
          'color:#9aa5b5;background:#f5f7fb';
        var dot=k.known&&k.known.length?'<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#22c55e;margin-right:5px;vertical-align:middle"></span>':'';
        var firstKnown=_getPickedKnown(i)[0]||'';
        if(firstKnown&&firstKnown.length>80) firstKnown=firstKnown.substring(0,80)+'…';
        // 用户手动补充/修改的结论：全部在卡片上单独高亮展示（最新在前）
        var _userAdded=_getUserAddedKnown(i);
        var _userHtml='';
        if(_userAdded.length){
          _userHtml='<div style="border-top:1px dashed #c7d2fe;padding-top:8px;margin-top:8px;display:flex;flex-direction:column;gap:5px">'+
            _userAdded.map(function(u){
              var _txt=u.replace(/^✅\s*/,''); if(_txt.length>72) _txt=_txt.substring(0,72)+'…';
              return '<div style="font-size:11.5px;color:#166534;line-height:1.55;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:7px;padding:5px 8px">'+
                '<span style="font-weight:700;color:#15803d">补充</span> '+highlightKeyData(_txt)+'</div>';
            }).join('')+
          '</div>';
        }
        // 待确认条目数：额外附加显示，让干部一眼看到还有多少事实没核实
        var _warnN=_getWarnKnown(i).length;
        var _warnBadge=_warnN?'<span style="padding:1px 7px;background:#fffbeb;color:#b45309;border:1px solid #fde68a;border-radius:20px;font-size:10.5px;font-weight:700;flex-shrink:0">⚠ '+_warnN+' 条待确认</span>':'';
        return '<button class="topic-row" onclick="kbDetail('+i+')">'+
          '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">'+
            '<span style="font-size:20px">'+k.icon+'</span>'+
            '<strong style="font-size:13px;color:#0b183b">'+k.t+'</strong>'+
            _warnBadge+
            '<em style="'+tagColor+';margin-left:auto;flex-shrink:0">'+dot+(_getDisplayTag(i)||k.tag)+'</em>'+
          '</div>'+
          '<small style="display:block;font-size:11.5px;color:#8492a6;margin-bottom:6px;line-height:1.4">'+(_getDisplaySub(i)||k.sub)+'</small>'+
          (firstKnown&&!_userAdded.length?'<div style="font-size:12px;color:#33415a;line-height:1.65;border-top:1px solid #f0f4ff;padding-top:8px;margin-top:auto">'+highlightKeyData(firstKnown)+'</div>':'')+
          _userHtml+
        '</button>';
      }).join('')+
    '</div>'+
    '<div class="suggestion-strip">可以这样问：'+
    '<button onclick="askKB(\''+P().city+'补链的核心缺口有哪些？\')">补链的核心缺口</button>'+
    '<button onclick="askKB(\''+P().city+'各园区如何分工承接不同细分产业？\')">园区分工承接方案</button>'+
    '<button onclick="askKB(\'本地链主企业还缺哪些关键上游配套？\')">链主缺口分析</button>'+
    '</div>'+
    // 折叠条
    '<div id="kbConvWrap">'+
    '<div id="kbConvToggle" onclick="toggleKbConv()" '+
      'style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;'+
      'background:#f5f7fb;border:1px solid #e8edf5;border-radius:10px;cursor:pointer;margin-bottom:6px;user-select:none">'+
      '<span style="font-size:12.5px;font-weight:650;color:#334155">💬 问答记录</span>'+
      '<span id="kbConvCount" style="font-size:11.5px;color:#8492a6"></span>'+
      '<span id="kbConvArrow" style="font-size:12px;color:#8492a6;transition:transform .2s">▲</span>'+
    '</div>'+
    '<div id="kbSessionBar"></div>'+
    '<div id="kbConv" style="padding:0 0 8px">'+
      '<div class="message" style="margin-top:0"><img src="'+aiAvatar()+'">'+
      '<div class="message-bubble"><p>'+p.city+'城市智库已就位，你可以直接提问——AI 正在结合本市数据生成建议问题：</p>'+
      '<ul id="kbSuggestList" style="margin:6px 0 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px">'+
      '<li style="font-size:12.5px;color:#9aa5b5">· 正在生成建议问题…</li>'+
      '</ul></div></div>'+
    '</div></div></div>'+composer()+
    '<button id="kbTopBtn" onclick="kbScrollTop()" title="回到顶部" '+
      'style="position:absolute;right:26px;bottom:190px;z-index:30;width:44px;height:44px;'+
      'display:none;align-items:center;justify-content:center;border:1px solid #d6e0f0;'+
      'border-radius:50%;background:#fff;color:#1a56db;font-size:20px;cursor:pointer;'+
      'box-shadow:0 4px 14px rgba(11,41,82,.16);transition:opacity .2s">↑</button>'+
    '</div>';
}
function settingsPage(p){
  return '<div class="page">'+
    '<div class="page-header"><div><span class="eyebrow">PERSONALIZATION</span><h1>个人与提醒设置</h1>'+
    '<p>调整个性化范围，但不改变确认关口与资源核验责任。</p></div></div>'+
    '<div class="settings-scroll">'+
    '<div class="settings-section"><h2>账号身份（由系统开通，不可修改）</h2>'+
      '<div class="form-grid">'+
      '<label>所属单位<input value="'+p.org+'" disabled></label>'+
      '<label>姓名 / 角色<input value="'+p.who+' / 招商干部" disabled></label>'+
      '<label>所属地区<input value="'+p.city+'" disabled></label>'+
      '<label>数据权限<input value="仅限 '+p.city+' 城市智库" disabled></label></div>'+
      '<div class="boundary-note" style="margin-top:14px"><i class="i">🔒</i>账号的地区与身份在开通时绑定，用户不可自行更改；如需变更请联系系统管理员。</div></div>'+
    onboardingSettingsSection(p)+
    '<div class="settings-section"><h2>提醒偏好（可自行调整）</h2>'+
      '<div class="toggle-row"><span><strong>状态变化通知</strong><small>需求进度更新时提醒我</small></span><input type="checkbox" checked></div>'+
      '<div class="toggle-row"><span><strong>超时提醒</strong><small>3 个工作日无更新时提醒</small></span><input type="checkbox" checked></div>'+
      '<div class="toggle-row"><span><strong>每日摘要</strong><small>每天 09:00 汇总进行中事项</small></span><input type="checkbox" checked></div>'+
      '<button class="primary-button settings-save" onclick="toast(\'提醒偏好已保存\')">保存偏好</button></div>'+
    '<div class="settings-section"><h2>系统会据此调整</h2><ul class="plain-list">'+
      ['首页任务提示','报告中的产业关注顺序','进度提醒频率'].map(function(x){return '<li>'+x+'</li>'}).join('')+'</ul>'+
      '<div class="boundary-note"><i class="i">🔒</i>干部与确认关口、资源核验责任和企业触达边界，不会因个人设置而跳过。</div></div>'+
    '</div></div>';
}
/* 招商偏好画像：设置页可查看+修改（收起展示，点「修改」重开问卷）*/
function onboardingSettingsSection(p){
  var ob=p&&p.onboarding;
  var rows= ob ? ONBOARD_Q.map(function(item){
      var v=ob[item.k];
      var txt=(!v||(Array.isArray(v)&&!v.length))?'<span style="color:#b0bac8">未填写</span>':(Array.isArray(v)?v.join('、'):v);
      return '<div style="display:flex;gap:12px;padding:11px 0;border-bottom:1px solid #f0f4ff">'+
        '<span style="font-size:16px;width:24px;text-align:center;flex:0 0 24px">'+item.icon+'</span>'+
        '<div style="flex:1;min-width:0"><div style="font-size:12px;color:#8492a6;margin-bottom:2px">'+item.q+'</div>'+
        '<div style="font-size:13px;color:#0b183b;font-weight:600;line-height:1.5">'+txt+'</div></div></div>';
    }).join('')
    : '<div style="padding:14px 0;color:#8492a6;font-size:13px">尚未填写招商偏好。填写后，AI 研判会据此聚焦您关注的园区、企业规模与产业方向。</div>';
  return '<div class="settings-section"><h2 style="display:flex;align-items:center;justify-content:space-between">招商偏好画像'+
      '<button class="ghost-button" style="min-height:34px;font-size:12px" onclick="editOnboarding()">'+(ob?'修改':'去填写')+'</button></h2>'+
      rows+
      '<div class="boundary-note" style="margin-top:14px"><i class="i">🎯</i>该画像指导 AI 的招商方向与企业匹配研判，可随时修改，修改后下次研判即生效。</div></div>';
}
function editOnboarding(){
  var p=PROJECTS[cur]; if(!p)return;
  openOnboarding(p.onboarding||null, function(ans){
    p.onboarding=ans; persist();
    if(typeof render==='function')render();
    if(typeof toast==='function')toast('招商偏好已更新');
  }, p.city, true);   // 设置页进入：始终允许关闭（含首次「去填写」）
}
