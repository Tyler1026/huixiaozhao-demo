
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
  // Compatibility only: viewing a report never creates synthetic companies.
  // Existing saved clues remain unchanged; new recommendations use review.
  return;
}

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
  var p=PROJECTS[projKey];
  if(!p||typeof DEMANDS==='undefined'||!Array.isArray(DEMANDS))return;
  var d=DEMANDS.find(function(item){return item&&(item.projKey===projKey||item.id===projKey||item.id==='d'+projKey);});
  if(!d)return;
  d.clues=(typeof visibleClues==='function'?visibleClues(p,projKey):(Array.isArray(p.clues)?p.clues:[])).length;
  d.projKey=projKey;
  if(p.demandContract==='industry-demand-v1'){
    d.topic=p.demandTitle||d.topic;
    d.analysisTopic=p.sourceAnalysisTopic||p.topic;
  }
}
function requestVerify(projKey, clueId){
  return requestDockingVerification(projKey,clueId);
}

function arrangeDocking(projKey, clueId){
  return openDockingLog(projKey,clueId);
}

/* ── 核验通过后弹出：如何联系这家企业（折叠卡片）── */
function showContactCard(projKey, clueId){
  return showDockingContactCard(projKey,clueId);
}

function toggleContactCard(){
  window.__contactOpen = !window.__contactOpen;
  var b = document.getElementById('contactCardBox'); if(!b) return;
  var d = b.querySelector('.cc-detail'), a = b.querySelector('.cc-arrow');
  if(d) d.style.display = window.__contactOpen ? 'block' : 'none';
  if(a) a.textContent = window.__contactOpen ? '▲' : '▼';
}

function contactCardBody(c){
  return dockingContactMaterialHtml(c);
}

function contactCardDetail(c){
  return dockingContactMaterialHtml(c);
}

function contactPathHtml(c){
  return dockingContactPathHtml(c);
}
function contactPersonHtml(c){
  return dockingContactPeopleHtml(c);
}
function contactBoundaryHtml(){
  return '<p class="docking-form-help">已存资料需要逐项核对；本页面不会自动联系企业，也不会生成联系人或核验结论。</p>';
}

function contactCardFoot(){
  return '<button class="secondary-button" onclick="closeModal()">关闭</button>';
}

function editClue(projKey, clueId){
  return openDockingClueEditor(projKey,clueId);
}

function saveClueEdit(projKey, clueId){
  return saveDockingClue();
}

function addClueManual(projKey){
  return openDockingClueEditor(projKey);
}

/* ══════════════════════════════════════════════════════════════
   projMgmtPage 完整重写
   ══════════════════════════════════════════════════════════════ */
function demandSubmissionState(key){
  var p=PROJECTS[key];if(!p||!p.isDemand)return 'not_submitted';
  if(window._demandSyncPending&&window._demandSyncPending[key])return 'pending';
  if(p.submissionState==='pending'||p.submissionState==='failed')return p.submissionState;
  var rows=typeof DEMANDS!=='undefined'?DEMANDS:[];
  return rows.some(function(d){return d&&d.projKey===key;})?'submitted':'not_submitted';
}
function demandEffectiveStage(key,p){
  return demandSubmissionState(key)==='submitted'?Math.max(Number(p.stage)||1,4):(Number(p.stage)||1);
}

// Read-only presentation of submitted demands; never rewrites business stages.
function demandDisplayProject(key,p){
  if(!p)return p;
  var demandKey=p.isDemand===true?key:_findExistingDemand(p.city,p.topic);
  var demand=demandKey&&PROJECTS[demandKey];
  return demand?Object.assign({},demand,{stage:demandEffectiveStage(demandKey,demand)}):p;
}

function reportDemandActionButton(p){
  if(!p||!demandReportSnapshot(cur,p.topic))return '';
  return '<button class="industry-priority-submit" type="button" onclick="chooseIndustryDemand()">'+(p.isDemand?'查看这条招商需求':'选择具体招引建议')+'</button>';
}

function projMgmtPage(p){return dockingWorkspacePage(p);}

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
  return openDockingLog(projKey);
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
  var safeTopic=(industryDemandProjectTitle(x)||'该需求').replace(/'/g,'’');
  var body='<div class="confirm-summary" style="border-color:#fecaca;background:#fef2f2">'+
      '<i class="i" style="color:#dc2626">⚠️</i>'+
      '<div><strong>确认取消「'+escapeChainText(industryDemandProjectTitle(x))+'」的招商申请？</strong>'+
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
  var topic=industryDemandProjectTitle(x)||'该需求';
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
          '<div style="font-size:13px;font-weight:700;color:#0b183b;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escapeChainText(industryDemandProjectTitle(x))+'</div>'+
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
  } else if(px.stage===4&&px.demandContract==='industry-demand-v1'){
    var reviewing=(px.clues||[]).filter(function(c){return c.tone==='amber';}).length;
    nextStep='<div class="industry-demand-origin" style="margin-bottom:16px"><strong>'+(reviewing?reviewing+' 条企业线索待核验':'等待候选企业与需求匹配核验')+'</strong><br>企业线索和对接进展以本条需求的实际记录为准。</div>';
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
  var px=demandDisplayProject(pk,PROJECTS[pk]); if(!px) return '';
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
  } else if(px.stage===4&&px.demandContract==='industry-demand-v1'){
    var reviewing=(px.clues||[]).filter(function(c){return c.tone==='amber';}).length;
    nextStep='<div class="industry-demand-origin" style="margin-bottom:16px"><strong>'+(reviewing?reviewing+' 条企业线索待核验':'等待候选企业与需求匹配核验')+'</strong><br>企业线索和对接进展以本条需求的实际记录为准。</div>';
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
  return recordDockingLegacyLog(projKey);
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
  if(isKb) return kbComposer();
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

function kbComposer(){
  var scope=typeof kbScopeTitle==='function'?kbScopeTitle():'';
  var busy=typeof kbIsRequestPending==='function'&&kbIsRequestPending();
  return '<div class="composer-wrap kb-composer-wrap">'+
    '<div class="kb-scope-bar"><span>提问范围</span><strong id="kbScopeLabel">'+_authEscape(scope||'全部知识')+'</strong>'+
    '<button type="button" onclick="clearKbActiveTopic()" title="切回全部知识">重置范围</button></div>'+
    '<div class="composer kb-composer"><label class="visually-hidden" for="composerTa">向城市智库提问</label>'+
    '<textarea id="composerTa" rows="2" placeholder="输入问题，或继续追问上一条回答…" aria-describedby="kbInputHelp"></textarea>'+
    '<button type="button" class="send-button" onclick="sendMsg()" aria-label="发送问题"'+(busy?' disabled':'')+'><i class="i">↑</i></button></div>'+
    '<div class="composer-helper" id="kbInputHelp"><span>Enter 发送 · Shift + Enter 换行</span><span>回答需结合原始来源核实</span></div></div>';
}
function renderComposer(){
  var wrap=document.querySelector('.composer-wrap');
  if(!wrap)return;
  var old=document.getElementById('composerTa');
  var draft=old?old.value:'', start=old?old.selectionStart:0, end=old?old.selectionEnd:0;
  var focused=old&&document.activeElement===old;
  var tmp=document.createElement('div');
  tmp.innerHTML=composer();
  wrap.replaceWith(tmp.firstChild);
  bind();
  var next=document.getElementById('composerTa');
  if(next){next.value=draft;if(focused){next.focus();next.setSelectionRange(start,end);}}
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

function reportStateFields(){
  return ['aiReportByTopic','phaseByTopic','tsByTopic','researchByTopic','materialDirectoryByTopic','evidenceStatusByTopic','scoreByTopic','userGeneratedTopics','reportByTopic','actionItemsByTopic'];
}
function reportStateStamp(value){return typeof value==='number'&&isFinite(value)&&value>0?value:0;}
function reportTopicStamp(state,topic){return reportStateStamp((state.tsByTopic||{})[topic])||(state.topic===topic?reportStateStamp(state.ts):0);}
function mergeTopicStamps(){
  var out={};Array.from(arguments).forEach(function(map){Object.keys(map||{}).forEach(function(t){out[t]=Math.max(out[t]||0,reportStateStamp(map[t]));});});return out;
}
function topicLifecycle(){
  var rows=Array.from(arguments),deleted=mergeTopicStamps.apply(null,rows.map(function(r){return (r||{}).topicDeletedAt;})),created=mergeTopicStamps.apply(null,rows.map(function(r){return (r||{}).topicCreatedAt;}));
  rows.forEach(function(r){((r||{}).deletedTopics||[]).forEach(function(t){deleted[t]=Math.max(deleted[t]||0,1);});});
  return {deleted:deleted,created:created};
}
function mergeTopicProjectLifecycle(old,incoming){
  old=old||{};incoming=incoming||{};var out=Object.assign({},incoming),life=topicLifecycle(old,incoming);
  out.topicDeletedAt=life.deleted;out.topicCreatedAt=life.created;
  out.deletedTopics=Object.keys(life.deleted).filter(function(t){return life.deleted[t]>=(life.created[t]||0);});
  out.customTopics=Array.from(new Set((old.customTopics||[]).concat(incoming.customTopics||[]))).filter(function(t){return out.deletedTopics.indexOf(t)<0;});
  out.stageByTopic=Object.assign({},old.stageByTopic||{},incoming.stageByTopic||{});
  out.deletedTopics.forEach(function(t){delete out.stageByTopic[t];});
  Object.keys(life.created).forEach(function(t){if(life.created[t]>((old.topicCreatedAt||{})[t]||0))out.stageByTopic[t]=(incoming.stageByTopic||{})[t]||2;});
  Object.keys(life.created).forEach(function(t){if(life.created[t]>((incoming.topicCreatedAt||{})[t]||0))out.stageByTopic[t]=(old.stageByTopic||{})[t]||2;});
  if(out.aiTopics)out.aiTopics=Object.assign({},out.aiTopics,{list:(out.aiTopics.list||[]).filter(function(t){return t&&out.deletedTopics.indexOf(t.label)<0;})});
  if(out.deletedTopics.indexOf(out.topic)>=0){out.topic='';out.stage=2;}
  else if(life.created[out.topic])out.stage=out.stageByTopic[out.topic]||2;
  return out;
}
function mergeTopicReportState(old,incoming,project){
  old=old||{};incoming=incoming||{};project=project||{};
  var fields=reportStateFields(),aux=['pendingByTopic','pendingRevisionByTopic','pendingReportTsByTopic','partialByTopic'];
  var out=Object.assign({},old,incoming),life=topicLifecycle(project,old,incoming),topics={};
  out.topicDeletedAt=life.deleted;out.topicCreatedAt=life.created;
  out.historyDeletedAt=mergeTopicStamps(old.historyDeletedAt,incoming.historyDeletedAt);
  fields.concat(aux).forEach(function(f){Object.keys(old[f]||{}).concat(Object.keys(incoming[f]||{})).forEach(function(t){topics[t]=true;});out[f]={};});
  Object.keys(topics).forEach(function(t){
    var tomb=life.deleted[t]||0,birth=life.created[t]||0;if(tomb&&tomb>=birth)return;
    var candidates=[old,incoming].filter(function(s){return !birth||reportTopicStamp(s,t)>=birth;});if(!candidates.length)return;
    var winner=candidates.reduce(function(a,b){return reportTopicStamp(b,t)>reportTopicStamp(a,t)?b:a;}),version=reportTopicStamp(winner,t);
    fields.forEach(function(f){if(Object.prototype.hasOwnProperty.call(winner[f]||{},t))out[f][t]=winner[f][t];});
    var editors=candidates.filter(function(s){return reportTopicStamp(s,t)===version&&((s.pendingReportTsByTopic||{})[t]===undefined||s.pendingReportTsByTopic[t]===version);});
    if(editors.length){var editor=editors.reduce(function(a,b){return reportStateStamp((b.pendingRevisionByTopic||{})[t])>reportStateStamp((a.pendingRevisionByTopic||{})[t])?b:a;});if(!editors.some(function(s){return reportStateStamp((s.pendingRevisionByTopic||{})[t]);}))editor=editors[editors.length-1];['pendingByTopic','pendingRevisionByTopic','pendingReportTsByTopic'].forEach(function(f){if(Object.prototype.hasOwnProperty.call(editor[f]||{},t))out[f][t]=editor[f][t];});}
    var parts=candidates.map(function(s){return (s.partialByTopic||{})[t];}).filter(function(p){return p&&reportStateStamp(p.ts)>version&&(p.reportTs===undefined||p.reportTs===version);});
    if(parts.length)out.partialByTopic[t]=parts.reduce(function(a,b){return reportStateStamp(b.ts)>reportStateStamp(a.ts)?b:a;});
  });
  var topic=incoming.topic||old.topic||'';if(life.deleted[topic]&&life.deleted[topic]>=(life.created[topic]||0))topic='';out.topic=topic;
  var viewOwner=reportTopicStamp(incoming,topic)>=reportTopicStamp(old,topic)?incoming:old;
  [['text','aiReportByTopic',''],['phase','phaseByTopic',1],['ts','tsByTopic',0],['score','scoreByTopic',null]].forEach(function(row){var fallback=viewOwner.topic===topic?(viewOwner[row[0]]===undefined?(old[row[0]]===undefined?row[2]:old[row[0]]):viewOwner[row[0]]):row[2];out[row[0]]=Object.prototype.hasOwnProperty.call(out[row[1]],topic)?out[row[1]][topic]:(topic?fallback:row[2]);});
  ['chainByTopic','chainEvidenceByTopic','chainStatusByTopic','chainUnclassifiedByTopic','chainErrorByTopic'].forEach(function(f){
    // Incoming server graph data remains authoritative; tombstones only remove.
    if(out[f]){out[f]=Object.assign({},out[f]);Object.keys(out[f]).forEach(function(t){if((life.deleted[t]&&life.deleted[t]>=(life.created[t]||0))||((life.created[t]||0)>reportTopicStamp(out,t)))delete out[f][t];});}
  });
  var currentVersion=Math.max(reportTopicStamp(old,topic),reportTopicStamp(incoming,topic));
  out.finalized=!!out.text&&[old,incoming].some(function(s){return s.topic===topic&&reportTopicStamp(s,topic)===currentVersion&&s.finalized;});return out;
}
function mergeTopicReportStates(old,incoming,projects){
  var out={};Object.keys(Object.assign({},old||{},incoming||{})).forEach(function(k){
    var a=(old||{})[k]||{},b=(incoming||{})[k]||{};
    out[k]=reportStateFields().some(function(f){return a[f]||b[f];})?mergeTopicReportState(a,b,(projects||{})[k]):Object.assign({},a,b);
  });return out;
}
function applyTopicStateIntegrity(){
  Object.keys(PROJECTS||{}).forEach(function(k){PROJECTS[k]=mergeTopicProjectLifecycle(PROJECTS[k],PROJECTS[k]);});
  REPORTSTATE=mergeTopicReportStates(REPORTSTATE,{},PROJECTS);
  REPORT_HISTORY=mergeTopicReportHistory(REPORT_HISTORY,{},REPORTSTATE,PROJECTS);
  Object.keys(REPORTSTATE).forEach(function(k){var state=REPORTSTATE[k],topic=(PROJECTS[k]||{}).topic;if(state.pendingByTopic)PENDING_CONFIRMS[k]=state.pendingByTopic[topic]||[];});
}
function mergeTopicReportHistory(old,incoming,states,projects){
  var out={};Object.keys(Object.assign({},old||{},incoming||{})).forEach(function(k){
    var state=(states||{})[k]||{},life=topicLifecycle(state,(projects||{})[k]),seen={};out[k]=[];
    ((old||{})[k]||[]).concat((incoming||{})[k]||[]).forEach(function(h){
      if(!h)return;var ts=reportStateStamp(h.ts),id=(h.topic||'')+'\u0000'+ts;
      if(seen[id]||(state.historyDeletedAt||{})[id]||ts<=(life.deleted[h.topic]||-1)||ts<(life.created[h.topic]||0))return;
      seen[id]=true;out[k].push(h);
    });out[k].sort(function(a,b){return reportStateStamp(b.ts)-reportStateStamp(a.ts);});out[k]=out[k].slice(0,10);
  });return out;
}
function topicOperationStamp(key,topic){
  var p=PROJECTS[key]||{},s=REPORTSTATE[key]||{};
  return Math.max(Date.now(),reportTopicStamp(s,topic)+1,((s.pendingRevisionByTopic||{})[topic]||0)+1,((p.topicDeletedAt||{})[topic]||0)+1,((p.topicCreatedAt||{})[topic]||0)+1);
}
function touchTopicPending(key,topic){
  var state=REPORTSTATE[key];if(!state)return;
  state.pendingRevisionByTopic=state.pendingRevisionByTopic||{};state.pendingReportTsByTopic=state.pendingReportTsByTopic||{};
  state.pendingRevisionByTopic[topic]=topicOperationStamp(key,topic);state.pendingReportTsByTopic[topic]=reportTopicStamp(state,topic);
}
function clearTopicReportData(key,topic){
  var state=REPORTSTATE[key]||{},p=PROJECTS[key]||{};
  reportStateFields().concat(['pendingByTopic','pendingRevisionByTopic','pendingReportTsByTopic','partialByTopic','chainByTopic','chainEvidenceByTopic','chainStatusByTopic','chainUnclassifiedByTopic','chainErrorByTopic']).forEach(function(f){if(state[f])delete state[f][topic];});
  if(state.topic===topic){state.text='';state.topic='';state.phase=1;state.ts=0;state.score=null;state.finalized=false;}
  if(p.stageByTopic)delete p.stageByTopic[topic];
  if(typeof REPORT_HISTORY!=='undefined'&&REPORT_HISTORY[key])REPORT_HISTORY[key]=REPORT_HISTORY[key].filter(function(h){return h&&h.topic!==topic;});
  if(p.topic===topic&&typeof PENDING_CONFIRMS!=='undefined')PENDING_CONFIRMS[key]=[];
}

// 选择研判方向（卡片点击 or 自定义输入）
function selectTopic(val, isCustom){
  var p=P(); if(!p||!val||!val.trim()) return;
  // 自定义方向落库：存进 customTopics，保证日后顶部方向卡片持久显示、可切回找到报告
  if(isCustom){
    if(!p.customTopics) p.customTopics=[];
    var _v=val.trim();
    if((p.topicDeletedAt||{})[_v]||(p.deletedTopics||[]).indexOf(_v)>=0){
      var born=topicOperationStamp(cur,_v);clearTopicReportData(cur,_v);
      p.topicCreatedAt=p.topicCreatedAt||{};p.topicCreatedAt[_v]=born;
    }
    if(p.customTopics.indexOf(_v)<0) p.customTopics.push(_v);
    // 重新添加时从已删除列表移除，否则会被过滤不显示
    if(p.deletedTopics){ p.deletedTopics=p.deletedTopics.filter(function(d){return d!==_v;}); }
  }
  // 切换方向前：把当前方向的待确认事项存回该方向的桶
  if(cur && REPORTSTATE[cur]){
    if(!REPORTSTATE[cur].pendingByTopic) REPORTSTATE[cur].pendingByTopic={};
    var _oldTopic=p.topic;
    if(_oldTopic && typeof PENDING_CONFIRMS!=='undefined' && PENDING_CONFIRMS[cur])
      REPORTSTATE[cur].pendingByTopic[_oldTopic]=currentPendingItems(cur);
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
  updateReportBusy();
  if(reportJobForTopic(cur,p.topic)){render();return;}
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
        '<div class="industry-empty" style="text-align:center;padding:48px 20px">'+
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
      '<div class="detail-page industry-detail">'+detailReport(p)+'</div>';
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
  if(typeof _viewScrollKey==='function')_renderedScrollKey=_viewScrollKey();
  if(typeof _restoreChainExplorer==='function')_restoreChainExplorer(null);
  if(typeof render==='function')render._markup=null;
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
// Freeze the score's meaning with the report. A missing score is not a request
// to estimate confidence from body length or reuse another topic's score.
function reportHistoryRecord(key, topic, text){
  var rs=REPORTSTATE[key]||{}, scores=rs.scoreByTopic||{};
  var unreviewed=(rs.evidenceStatusByTopic||{})[topic]==='unreviewed';
  var native=nativeReportState(topic,key), score=null;
  if(!unreviewed){
    if(native) score=nativeReportScore(topic,key);
    else if(Object.prototype.hasOwnProperty.call(scores,topic)) score=scores[topic];
    else if(rs.topic===topic) score=rs.score;
  }
  if(typeof score!=='number'||!isFinite(score)||score<0||score>100) score=null;
  return {
    topic:topic, text:text, rep:text,
    ts:(rs.tsByTopic||{})[topic]||(rs.topic===topic?rs.ts:0)||rs.ts||0,
    phase:(rs.phaseByTopic||{})[topic]||(rs.topic===topic?rs.phase:2)||2,
    score:score, evidenceStatus:unreviewed?'unreviewed':null,
    scoreBasis:native?native.scoreBasis:null,
    scoreStatus:native?native.scoreStatus:null,
    sourceReportId:native?native.sourceReportId:null
  };
}

function reportHistoryScoreDisplay(rep,key){
  var rs=REPORTSTATE[key]||{}, topic=rep.topic;
  var text=(rs.aiReportByTopic||{})[topic]||(rs.topic===topic?rs.text:null);
  var ts=(rs.tsByTopic||{})[topic]||(rs.topic===topic?rs.ts:0)||rs.ts||0;
  // The same current snapshot may have been archived before evidence metadata
  // was introduced. Its live explicit status still takes precedence.
  if(text===rep.text && ts===rep.ts){
    if((rs.evidenceStatusByTopic||{})[topic]==='unreviewed') return '内容待核验';
    if(nativeReportState(topic,key)) return topicScoreDisplay(topic,key);
  }
  if(rep.evidenceStatus==='unreviewed') return '内容待核验';
  var score=typeof rep.score==='number'&&isFinite(rep.score)&&rep.score>=0&&rep.score<=100?rep.score:null;
  if(rep.scoreBasis==='核验一致项比例' && rep.sourceReportId){
    if(rep.scoreStatus==='unclassified') return '核验分类待校核';
    if(rep.scoreStatus==='unavailable'||score===null) return '暂无核验结论';
    return '核验一致项比例 '+score+'%';
  }
  return score===null?'内容待核验':score+'%';
}

// 补充：从 aiReportByTopic 构建历史（解决 rs.text 清空后历史报告为空的问题）
function getReportHistoryForProject(key){
  var rs=REPORTSTATE[key]; if(!rs) return [];
  REPORT_HISTORY=mergeTopicReportHistory(REPORT_HISTORY,{},REPORTSTATE,PROJECTS);
  // 优先用 aiReportByTopic 构建（每个有完整报告的方向是一条历史）
  var fromAi=[];
  if(rs.aiReportByTopic){
    Object.keys(rs.aiReportByTopic).forEach(function(t){
      var txt=rs.aiReportByTopic[t];
      if(!txt || txt.length<=100) return;
      fromAi.push(reportHistoryRecord(key,t,txt));
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

function archiveCurrentReport(key,topic){
  var rs=REPORTSTATE[key];
  if(!rs) return;
  topic=topic||rs.topic;
  var text=(rs.aiReportByTopic||{})[topic]||(rs.topic===topic?rs.text:'');
  if(!text) return;
  if(!REPORT_HISTORY[key]) REPORT_HISTORY[key]=[];
  var record=reportHistoryRecord(key,topic,text);
  var existing=REPORT_HISTORY[key].findIndex(function(h){return h.topic===record.topic&&h.ts===record.ts;});
  if(existing>=0) REPORT_HISTORY[key][existing]=record;
  else REPORT_HISTORY[key].unshift(record);
  if(REPORT_HISTORY[key].length>10) REPORT_HISTORY[key]=REPORT_HISTORY[key].slice(0,10);
  saveReportHistory();
}

function deleteHistoryReport(key, idx){
  if(!REPORT_HISTORY[key]) return;
  var _h=REPORT_HISTORY[key][idx]; var _label=_h&&_h.topic?('「'+_h.topic+'」'):'该条';
  if(!confirm('确定删除'+_label+'历史报告？删除后无法恢复。')) return;
  var state=REPORTSTATE[key]||(REPORTSTATE[key]={});state.historyDeletedAt=state.historyDeletedAt||{};
  if(_h)state.historyDeletedAt[(_h.topic||'')+'\u0000'+(Number(_h.ts)||0)]=topicOperationStamp(key,_h.topic||'');
  REPORT_HISTORY[key].splice(idx,1);
  saveReportHistory();
  persist();
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
  if(currentTopic && !_histShowAll) list=list.filter(function(x){return x.rep.topic===currentTopic;});
  list.sort(function(a,b){return (b.rep.ts||0)-(a.rep.ts||0);});
  // 无任何历史报告则整块隐藏；有历史但当前方向为空时仍显示切换入口
  if(!totalCount){container.innerHTML='';return;}
  var otherCount=totalCount-list.length;
  var h='<div class="industry-history" style="margin-bottom:12px">';
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
    h+='<span style="font-size:11px;color:#64748b;flex-shrink:0;margin-left:4px">'+reportHistoryScoreDisplay(rep,key)+'</span>';
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
      return '<div class="industry-confirm-row is-done" id="ci-'+projKey+'-'+idx+'" style="display:flex;gap:10px;align-items:flex-start;padding:12px 14px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px">'+
        '<span style="color:#22c55e;font-size:16px;flex-shrink:0;margin-top:1px">✓</span>'+
        '<div style="flex:1;min-width:0">'+
          '<div class="industry-confirm-text" style="font-size:13px;color:#14532d;line-height:1.65">'+displayText+filesBadge+'</div>'+
          (item.status==='edited'?'<div style="font-size:11px;color:#22c55e;margin-top:3px">已修改并确认</div>':'<div style="font-size:11px;color:#22c55e;margin-top:3px">已确认</div>')+
        '</div>'+
        '<button onclick="uncfmItem(\''+projKey+'\','+idx+')" style="padding:3px 8px;background:none;border:1px solid #86efac;border-radius:6px;font-size:11px;color:#22c55e;cursor:pointer;flex-shrink:0">撤回</button>'+
      '</div>';
    }

    return '<div class="industry-confirm-row is-pending" id="ci-'+projKey+'-'+idx+'" style="border-radius:12px;background:#fffbeb;border:1.5px solid #fed7aa;overflow:hidden;transition:box-shadow .2s" onmouseenter="this.style.boxShadow=\'0 2px 8px rgba(245,158,11,0.15)\'" onmouseleave="this.style.boxShadow=\'none\'">'+
      '<div style="padding:13px 15px">'+
        '<div style="display:flex;gap:10px;align-items:flex-start">'+
          '<span style="flex-shrink:0;width:22px;height:22px;background:#fef3c7;border:1.5px solid #fcd34d;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;margin-top:1px">⚠️</span>'+
          '<div class="industry-confirm-text" id="ci-text-'+projKey+'-'+idx+'" style="flex:1;font-size:13px;color:#78350f;line-height:1.7;font-weight:500">'+displayText+'</div>'+
        '</div>'+
        // 编辑框（默认隐藏）
        '<div class="industry-confirm-edit" id="ci-edit-'+projKey+'-'+idx+'" style="display:none;margin-top:10px">'+
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
          '<input id="ci-finp-'+projKey+'-'+idx+'" type="file" multiple accept=".pdf,.docx,.txt,.md,.csv,.json" style="display:none" onchange="ciFileSelected(this,\''+projKey+'\','+idx+')"/>'+
          '<div style="display:flex;gap:8px;margin-top:8px">'+
            '<button onclick="ciSave(\''+projKey+'\','+idx+')" style="flex:1;padding:7px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer">✓ 保存修改</button>'+
            '<button onclick="ciCancelEdit(\''+projKey+'\','+idx+')" style="padding:7px 12px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:8px;font-size:12.5px;color:#4a5568;cursor:pointer">取消</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
      // 操作栏
      '<div class="industry-confirm-actions" style="padding:10px 15px;background:linear-gradient(135deg,#fefce8,#fef9c3);border-top:1px solid #fde68a;display:flex;gap:8px">'+
        '<button onclick="cfmItem(\''+projKey+'\','+idx+')" style="flex:1;padding:8px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1.5px solid #86efac;border-radius:10px;font-size:12.5px;font-weight:700;color:#166534;cursor:pointer;transition:all .15s" onmouseenter="this.style.background=\'#dcfce7\'" onmouseleave="this.style.background=\'linear-gradient(135deg,#f0fdf4,#dcfce7)\'">✓ 确认</button>'+
        '<button onclick="ciShowEdit(\''+projKey+'\','+idx+')" style="flex:1;padding:8px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:1.5px solid #c4b5fd;border-radius:10px;font-size:12.5px;font-weight:600;color:#6d28d9;cursor:pointer" onmouseenter="this.style.background=\'#ede9fe\'" onmouseleave="this.style.background=\'linear-gradient(135deg,#f5f3ff,#ede9fe)\'">✎ 修改内容</button>'+
      '</div>'+
    '</div>';
  }).join('');

  var total = items.length;
  var done = items.filter(function(x){return x.status==='confirmed'||(x.status==='edited'&&typeof x.editedText==='string'&&x.editedText.trim());}).length;
  var allDone = done === total;

  // 折叠状态：首次全部确认时默认收起，否则展开；用户手动切换后记忆
  if(window.__cpCollapsed==null) window.__cpCollapsed={};
  if(window.__cpCollapsed[projKey]==null) window.__cpCollapsed[projKey]=allDone;
  var collapsed=window.__cpCollapsed[projKey];

  return '<div class="industry-confirm" id="confirmPanel-'+projKey+'" style="margin-top:20px;border-radius:16px;border:1.5px solid #fde68a;overflow:hidden;box-shadow:0 2px 10px rgba(245,158,11,0.1)">'+
    '<div class="industry-confirm-head" onclick="toggleConfirmPanel(\''+projKey+'\')" style="padding:13px 18px;background:linear-gradient(135deg,#fffbeb,#fef9c3);border-bottom:1px solid #fde68a;display:flex;align-items:center;gap:10px;cursor:pointer">'+
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
      '<div class="industry-confirm-items" style="padding:12px 16px;display:flex;flex-direction:column;gap:8px;background:#fff" id="cp-items-'+projKey+'">'+rows+'</div>'+
      '<div class="industry-confirm-foot" id="cp-unlock-'+projKey+'" style="padding:12px 18px;background:'+(allDone?'linear-gradient(135deg,#f0fdf4,#dcfce7)':'#f9fafb')+';border-top:1px solid '+(allDone?'#86efac':'#f0f4ff')+';display:flex;align-items:center;justify-content:center;gap:8px">'+
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
  var topic=(PROJECTS[projKey]||{}).topic||'';
  var gate=fullReportConfirmation(projKey,topic);
  var items=gate.items, total=gate.total, done=gate.done, allDone=gate.ready;
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
  // Confirming research facts does not submit a demand or advance its business stage.
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
function currentPendingItems(key){
  var p=PROJECTS[key],rs=REPORTSTATE[key];if(!p||!rs)return [];
  var topic=p.topic,byTopic=rs.pendingByTopic||(rs.pendingByTopic={});
  var items=byTopic[topic];
  if(!Array.isArray(items)){
    items=rs.topic===topic&&!Object.keys(byTopic).length&&Array.isArray(PENDING_CONFIRMS[key])?PENDING_CONFIRMS[key]:[];
    byTopic[topic]=items;
  }
  PENDING_CONFIRMS[key]=items;
  return items;
}

function cfmItem(projKey, idx){
  var items=currentPendingItems(projKey);if(!items[idx])return;
  items[idx].status = 'confirmed';
  touchTopicPending(projKey,PROJECTS[projKey].topic);
  var card = document.getElementById('ci-'+projKey+'-'+idx);
  if(card){
    var item = PENDING_CONFIRMS[projKey][idx];
    var displayText = item.editedText || item.text;
    var filesBadge = item.files&&item.files.length?'<span style="margin-left:6px;padding:1px 7px;background:#f0fdf4;color:#166534;border-radius:10px;font-size:10.5px;border:1px solid #86efac">'+item.files.length+' 个附件</span>':'';
    if(card.classList){card.classList.remove('is-pending');card.classList.add('industry-confirm-row','is-done');}
    card.style.cssText='display:flex;gap:10px;align-items:flex-start;padding:12px 14px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px';
    card.innerHTML=
      '<span style="color:#22c55e;font-size:16px;flex-shrink:0;margin-top:1px">✓</span>'+
      '<div style="flex:1;min-width:0"><div class="industry-confirm-text" style="font-size:13px;color:#14532d;line-height:1.65">'+displayText+filesBadge+'</div>'+
      '<div style="font-size:11px;color:#22c55e;margin-top:3px">已确认</div></div>'+
      '<button onclick="uncfmItem(\''+projKey+'\','+idx+')" style="padding:3px 8px;background:none;border:1px solid #86efac;border-radius:6px;font-size:11px;color:#22c55e;cursor:pointer;flex-shrink:0">撤回</button>';
  }
  persist(); // 同步确认状态到服务器
  updateConfirmProgress(projKey);
  refreshTopReliability();
}

/* 撤回确认 */
function uncfmItem(projKey, idx){
  var items=currentPendingItems(projKey);if(!items[idx])return;
  items[idx].status = 'pending';
  touchTopicPending(projKey,PROJECTS[projKey].topic);
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
  var item = currentPendingItems(projKey)[idx];
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
  var item = currentPendingItems(projKey)[idx];if(!item)return;
  item.editedText = ta.value.trim();
  item.status = 'edited';
  touchTopicPending(projKey,PROJECTS[projKey].topic);
  var card = document.getElementById('ci-'+projKey+'-'+idx);
  if(card){
    var displayText = item.editedText;
    var filesBadge = item.files&&item.files.length?'<span style="margin-left:6px;padding:1px 7px;background:#f0fdf4;color:#166534;border-radius:10px;font-size:10.5px;border:1px solid #86efac">'+item.files.length+' 个附件</span>':'';
    if(card.classList){card.classList.remove('is-pending');card.classList.add('industry-confirm-row','is-done');}
    card.style.cssText='display:flex;gap:10px;align-items:flex-start;padding:12px 14px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px';
    card.innerHTML=
      '<span style="color:#22c55e;font-size:16px;flex-shrink:0;margin-top:1px">✓</span>'+
      '<div style="flex:1;min-width:0"><div class="industry-confirm-text" style="font-size:13px;color:#14532d;line-height:1.65">'+displayText+filesBadge+'</div>'+
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
  var epoch=originalUploadEpoch(),topic=(PROJECTS[projKey]||{}).topic,item=currentPendingItems(projKey)[idx];if(!item||cur!==projKey)return;
  var hint=document.getElementById('ci-file-hint-'+projKey+'-'+idx);
  if(hint)hint.textContent='正在保存附件原件…';
  return ingestFiles(files,null).then(function(saved){
    if(!originalUploadSessionCurrent(epoch))return;
    if(!item.files)item.files=[];
    saved.forEach(function(f){item.files.push(f._originalReceipt.upload);});
    touchTopicPending(projKey,topic);
    if(cur===projKey&&hint)hint.textContent='已保存 '+saved.length+' 个附件原件';
    persist();
  });
}


/* 立项卡片 */
/* 恢复确认面板（如果有待确认事项） */
function restoreConfirmPanel(){
  var rs=REPORTSTATE[cur],p=P();if(!rs||!p)return '';
  if((rs.phaseByTopic||{})[p.topic]===2)return '';
  var items=currentPendingItems(cur);
  if(!items.length){
    var text=(rs.aiReportByTopic||{})[p.topic]||(rs.topic===p.topic?rs.text:'');
    items=parsePendingItems(text||'');
    rs.pendingByTopic[p.topic]=items;PENDING_CONFIRMS[cur]=items;
  }
  return items.length?renderConfirmPanel(items,cur):'';
}

/* 从产业链图谱 AI 研判结果(segmentLevels)派生可立项招引方向：
   weak(缺口)第一梯队、mid(培育)第二梯队；携带判定依据 + 对标企业(type=target)。
   图谱研判一次，招引方向/补链清单/报告清单全部从这份结果派生，保证单一事实源。 */
function deriveActionItemsFromChain(){
  var p=P(),chain=p?currentEvidenceChain(p.topic,cur):null;
  if(!chain)return null;
  var items=[];
  chain.forEach(function(seg){(seg.nodes||[]).forEach(function(nd){
    if(nd.level==='weak'||nd.level==='mid'||nd.level==='unknown')items.push({gap:nd.name,level:nd.level,basis:nd.note||'',attr:nd.level==='unknown'?'待核':'材料研判',confidencePct:null,fromChain:true,benchEnts:nd.benchmark||[]});
  });});
  return items;
}

/* 从REPORTSTATE恢复已保存的招引方向卡片 */
function restoreActionItems(){
  var p=P();if(!p || !demandReportSnapshot(cur,p.topic))return '';
  if(p.demandContract==='industry-demand-v1')return industryDemandSummaryHtml(p)+reportDemandActionButton(p);
  var items=typeof reportAnalyticalPriorities==='function'?reportAnalyticalPriorities(REPORTSTATE[cur],p.topic):[];
  var directions='<section class="industry-priorities" aria-label="报告中的招引研判方向"><div class="industry-priorities-heading"><h3>报告中的招引研判方向</h3>'+(items.length?'<span>'+items.length+' 项来源支持的分析建议</span>':'')+'</div>';
  if(items.length){
    directions+='<div class="industry-priority-grid">'+items.map(function(item,index){
      var sources=chainNodeSources({sources:item.sources});
      return '<article class="industry-priority-card"><span class="industry-priority-scope">'+escapeChainText(item.scopeLabel)+'</span><h4>'+escapeChainText(item.focus)+'</h4><p class="industry-priority-reason">'+escapeChainText(item.reason)+'</p><div class="industry-priority-action"><strong>建议动作</strong><p>'+escapeChainText(item.action)+'</p></div><details><summary>比较依据与原文 · '+sources.length+' 条</summary><p>'+escapeChainText(item.comparison)+'</p>'+sources.map(chainLayoutSourceHtml).join('')+'</details>'+industryDemandButtonHtml(p,item)+'</article>';
    }).join('')+'</div>';
  }else directions+='<p class="industry-priority-empty">当前报告尚未形成经来源复核的具体招引建议。补充实际需求、供给与采购材料后可继续研判。</p>';
  directions+='</section>';
  return directions+'<p class="industry-demand-boundary">每条建议独立形成需求；请选择具体建议并确认招引诉求。</p>';
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

function renderActionItems(text,p,r){
  var area=document.getElementById('actionItemsBlock');
  if(area)area.innerHTML=restoreActionItems();
}

/* Legacy lookup trims whitespace only; concrete suggestions use their source identity. */
function _normalizeTopic(t){return typeof t==='string'?t.trim():'';}
/* 返回同城 + 同(规范化)topic 的已存在 isDemand 项目 key，找不到返回 null */
function _findExistingDemand(city, topic){
  if(!city || !topic) return null;
  var _nt=_normalizeTopic(topic);
  var workspace=typeof _projectWorkspaceId==='function'?_projectWorkspaceId(cur):null;
  function sameWorkspace(key){return !workspace||(typeof _authWorkspaceOf==='function'&&_authWorkspaceOf(key)===workspace);}
  // 精确匹配优先
  var exactKey=Object.keys(PROJECTS).find(function(k){
    var x=PROJECTS[k]; return x&&x.isDemand&&x.demandContract!=='industry-demand-v1'&&sameWorkspace(k)&&x.city===city&&x.topic===topic;
  });
  if(exactKey) return exactKey;
  // 仅忽略两端空白，不折叠产业、产品或需求词。
  return Object.keys(PROJECTS).find(function(k){
    var x=PROJECTS[k]; return x&&x.isDemand&&x.demandContract!=='industry-demand-v1'&&sameWorkspace(k)&&x.city===city&&_normalizeTopic(x.topic)===_nt;
  }) || null;
}
/* Keep the compatibility entry point without deleting historical records. */
function _dedupeDemands(){
  // Historical demands cannot be deleted or merged by a browser name heuristic.
  return 0;
}

/* 提交招商需求 */
function importToProject(){return chooseIndustryDemand();}

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
/* Show the saved direction name exactly; do not append an industry suffix. */
function topicDisplayLabel(label){
  return String(label||'').trim().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function topicCardHtml(t, isActive){
  var isCustom=(t.type==='custom');
  var delBtn=isCustom
    ? '<span onclick="event.stopPropagation();deleteCustomTopic(this.getAttribute(\'data-del\'))" data-del="'+String(t.label).replace(/"/g,'&quot;')+'" title="删除该自定义方向" '+
        'style="position:absolute;top:8px;right:8px;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;'+
        'border-radius:50%;background:#fef2f2;border:1px solid #fecaca;color:#dc2626;font-size:13px;line-height:1;cursor:pointer;z-index:2">×</span>'
    : '';
  return '<button class="industry-topic-card '+(isActive?'is-active':'')+'" onclick="selectTopic(this.getAttribute(\'data-v\'))" data-v="'+String(t.label).replace(/"/g,'&quot;')+'" style="'+
    'position:relative;display:flex;flex-direction:column;align-items:flex-start;padding:14px 16px;'+
    'background:'+(isActive?'linear-gradient(135deg,#eff6ff,#f0f9ff)':'#fff')+';'+
    'border:2px solid '+(isActive?'#1a56db':'#e8edf5')+';'+
    'border-radius:14px;cursor:pointer;text-align:left;transition:all .15s;flex:1;min-width:0">'+
    delBtn+
    '<span style="font-size:20px;margin-bottom:6px">'+(t.icon||'📌')+'</span>'+
    '<span style="font-size:13px;font-weight:700;color:#0b183b;display:block;margin-bottom:4px">'+topicDisplayLabel(t.label)+'</span>'+
    '<span style="font-size:11.5px;color:#8492a6;line-height:1.4">'+escapeChainText(t.desc||'自定义产业方向')+'</span>'+
    (t.desc?'<span style="font-size:9px;color:#9aa6b5;margin-top:4px">原始方向摘要 · 待核</span>':'')+
    (isActive?'<div style="margin-top:8px;width:8px;height:8px;border-radius:50%;background:#1a56db"></div>':'')+
  '</button>';
}

/* 删除自定义方向卡片 */
function deleteCustomTopic(label){
  var p=P(); if(!p||!label) return;
  // 允许删除AI推荐方向和自定义方向
  if(!confirm('确定删除自定义方向「'+label+'」？该方向下的报告与历史将一并清除。')) return;
  var wasSelected=p.topic===label,deletedAt=topicOperationStamp(cur,label);
  p.topicDeletedAt=p.topicDeletedAt||{};p.topicDeletedAt[label]=deletedAt;
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
  if(cur){
    var _rs=REPORTSTATE[cur]||(REPORTSTATE[cur]={});_rs.topicDeletedAt=_rs.topicDeletedAt||{};_rs.topicDeletedAt[label]=deletedAt;
    clearTopicReportData(cur,label);
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
  if(wasSelected){
    p.topic='';p.stage=2;
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
    '<div class="industry-interview" style="padding:20px">'+
      '<div class="industry-interview-head" style="display:flex;align-items:center;gap:12px;margin-bottom:16px">'+
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
      (answeredHtml?'<div class="industry-interview-answers" style="margin-bottom:12px;max-height:120px;overflow-y:auto">'+answeredHtml+'</div>':'')+
      '<div class="industry-interview-question" style="background:#fff;border:1.5px solid #e8edf5;border-radius:14px;padding:20px;margin-bottom:16px">'+
        '<div style="font-size:14px;color:#1e293b;line-height:1.8;margin-bottom:16px">'+q.q+'</div>'+
        '<textarea id="interviewAnswer" placeholder="输入您的回答…（如暂时不清楚可点击跳过）" style="width:100%;box-sizing:border-box;min-height:100px;padding:12px;border:1.5px solid #e8edf5;border-radius:10px;font-size:13px;line-height:1.7;outline:none;resize:vertical" >'+(_interviewState.answers[_interviewState.currentQ]?(_interviewState.answers[_interviewState.currentQ].text||''):'')+'</textarea>'+
      '</div>'+
      '<div class="industry-interview-actions" style="display:flex;gap:10px;align-items:center">'+
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
    return {text:'【'+_interviewState.topic+'】'+qObj.q+'\n答：'+a.text, origin:'user', nature:'interview', account:(AUTH&&AUTH.user)||''};
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

function fullReportConfirmation(key, topic){
  var rs=REPORTSTATE[key]||{}, byTopic=rs.pendingByTopic||{};
  var items=Object.prototype.hasOwnProperty.call(byTopic,topic)?byTopic[topic]:[];
  if(Array.isArray(items) && !items.length && rs.topic===topic && (!rs.pendingByTopic || !Object.keys(byTopic).length)) items=PENDING_CONFIRMS[key]||[];
  if(!Array.isArray(items)) items=[];
  var valid=items.filter(function(x){return x && typeof x.text==='string' && x.text.trim();});
  var done=valid.filter(function(x){return x.status==='confirmed'||(x.status==='edited'&&typeof x.editedText==='string'&&x.editedText.trim());}).length;
  var draft=rs.phaseByTopic && rs.phaseByTopic[topic]===1;
  return {ready:!!draft && valid.length>0 && valid.length===items.length && done===valid.length,
    total:valid.length,done:done,items:valid,
    message:!draft?'请先生成并确认当前方向的草稿':!valid.length?'草稿缺少待确认事项，请重新生成草稿或补充材料':'请先确认当前方向剩余 '+(valid.length-done)+' 条事项'};
}

function topicReportMarkup(text){
  return typeof reportMdToHtml==='function'?reportMdToHtml(text):String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

// Keep a request's material version separate from its generated answer. Switching
// cards is harmless; changing this direction's source records is not.
function reportMaterialIdentity(key,topic){
  var p=PROJECTS[key];if(!p)return null;
  var rs=REPORTSTATE[key]||{},root=p.workspaceId||key,keys=root===key?[key]:[root,key];
  function stable(v){
    if(Array.isArray(v))return v.map(stable);
    if(v&&typeof v==='object'){var out={};Object.keys(v).sort().forEach(function(k){if(v[k]!==undefined)out[k]=stable(v[k]);});return out;}
    return v;
  }
  var materials=keys.map(function(k){return {key:k,kb:(PROJECTS[k]||{}).kb||[],
    edits:typeof KB_EDITS!=='undefined'?KB_EDITS[k]||{}:{},
    chunks:typeof KB_FILE_CHUNKS!=='undefined'?KB_FILE_CHUNKS[k]||[]:[],
    uploads:typeof UPLOADS!=='undefined'?UPLOADS[k]||[]:[]};});
  return JSON.stringify(stable({workspace:root,city:p.city||'',topic:topic,requestId:p.reportRequestId||'',
    materials:materials,onboarding:p.onboarding||{},confirmations:(rs.pendingByTopic||{})[topic]||[],
    previousReport:(rs.aiReportByTopic||{})[topic]||(rs.topic===topic?rs.text:'')||''}));
}

async function reportClientFingerprint(identity){
  var provider=typeof crypto!=='undefined'?crypto:(typeof window!=='undefined'?window.crypto:null);
  if(!provider||!provider.subtle)throw new Error('当前浏览器无法校验材料版本，请使用安全连接后重试');
  var bytes=await provider.subtle.digest('SHA-256',new TextEncoder().encode(identity));
  return Array.from(new Uint8Array(bytes)).map(function(b){return ('0'+b.toString(16)).slice(-2);}).join('');
}

function reportJobForTopic(key,topic){
  return (window._topicReportProgress||{})[key+'\u0000'+topic]||null;
}

function reportRunBanner(p){
  var job=p&&reportJobForTopic(cur,p.topic);
  if(!job)return '';
  return '<div id="industryRunBanner" class="industry-run-banner" role="status" aria-live="polite">'+
    '<span class="industry-run-spinner" aria-hidden="true"></span><div><strong>'+(job.phase===2?'完整报告生成中':'初步草稿生成中')+'</strong>'+
    '<span id="industryRunMessage">'+escapeChainText(job.message||'正在准备当前方向材料…')+'</span></div></div>';
}

function refreshReportRunUi(){
  var p=P();if(!p)return;
  var job=reportJobForTopic(cur,p.topic),message=job&&job.message||'';
  ['reportRunStatus','industryRunMessage','industryBottomRunMessage','industryDetailRunMessage'].forEach(function(id){
    var el=document.getElementById(id);if(el&&job)el.textContent=message;
  });
  if(!document.querySelector)return;
  var host=document.getElementById('industryRunHost');if(host)host.innerHTML=reportRunBanner(p);
  var bar=document.querySelector('.report-bottom-bar');
  if(bar&&typeof reportBottomBarInner==='function')bar.innerHTML=reportBottomBarInner(p);
  var detail=document.querySelector('.detail-page');
  if(detail&&typeof detailReport==='function')detail.innerHTML=detailReport(p);
}

function reportSourceDate(value,withTime){
  var text=typeof value==='string'?value.trim():'';
  if(!text)return '未知';
  var parts=text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?)?$/);
  if(!parts)return text;
  var date=new Date(text),calendar=new Date(0);
  calendar.setUTCFullYear(Number(parts[1]),Number(parts[2])-1,Number(parts[3]));
  calendar.setUTCHours(0,0,0,0);
  if(!Number.isFinite(date.getTime())||calendar.getUTCFullYear()!==Number(parts[1])||calendar.getUTCMonth()!==Number(parts[2])-1||calendar.getUTCDate()!==Number(parts[3]))return text;
  if(!withTime)return parts[1]+'-'+parts[2]+'-'+parts[3];
  function pad(n){return String(n).padStart(2,'0');}
  return String(date.getFullYear()).padStart(4,'0')+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+' '+pad(date.getHours())+':'+pad(date.getMinutes());
}

function reportResearchSourcesHtml(p,key){
  key=key||cur;if(!p)return '';
  var rs=REPORTSTATE[key]||{},record=(rs.researchByTopic||{})[p.topic];
  var text=(rs.aiReportByTopic||{})[p.topic]||(rs.topic===p.topic?rs.text:'');
  if(!record||record.topic!==p.topic||record.reportText!==text||!Array.isArray(record.sources)||!record.sources.length)return '';
  var rows=record.sources.map(function(source,index){
    var url=reportSafeSourceUrl(source.url),label=escapeChainText(source.label||'S'+(index+1));
    var support={cross_checked:'交叉支持',single_source:'单源待复核'}[source.support_status]||'未核实';
    return '<li><div class="industry-source-heading"><span>'+label+'</span>'+
      (source.archived===true?'<div style="font-size:10px;color:#8294a5">公开原文库命中 · 非本次联网抓取'+(source.fulltext_scope?' · PDF摘录范围：'+escapeChainText(source.fulltext_scope):'')+'</div>':'')+
    (url?'<a href="'+escapeChainText(url)+'" target="_blank" rel="noopener noreferrer">'+escapeChainText(source.title||url)+'</a>':'<strong>'+escapeChainText(source.title||'来源未提供链接')+'</strong>')+'</div>'+
      '<div class="industry-source-date">'+(source.published_at?'发布：'+escapeChainText(reportSourceDate(source.published_at,false))+' · ':'')+
      (source.retrieved_at?'检索：'+escapeChainText(reportSourceDate(source.retrieved_at,true))+' · ':'')+support+'</div>'+
      (source.quote?'<blockquote>'+escapeChainText(source.quote)+'</blockquote>':'')+'</li>';
  }).join('');
  return '<details class="industry-sources"><summary>本次报告来源 <span>'+record.sources.length+' 条</span></summary>'+
    '<p>以下为本次生成保存的来源与摘录；来源可追溯不等于事实已核验。检索时间为本地时间。</p><ol>'+rows+'</ol></details>';
}

function reportSafeSourceUrl(value){
  if(typeof value!=='string'||/[\s<>"'\\]/.test(value))return '';
  try{var u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:'';}catch(e){return '';}
}

function reportStreamMetadataEvent(metadata,event){
  if(event.fingerprint)metadata.fingerprint=String(event.fingerprint).slice(0,256);
  if(event.clientMaterialFingerprint)metadata.clientMaterialFingerprint=String(event.clientMaterialFingerprint).slice(0,256);
  if(event.runId)metadata.runId=String(event.runId).slice(0,256);
  ['researchStatus','verificationStatus'].forEach(function(k){if(typeof event[k]==='string')metadata[k]=event[k].slice(0,100);});
  if(event.type==='research.status'&&typeof event.message==='string')metadata.message=event.message.slice(0,1000);
  if(event.type==='research.evidence'&&Array.isArray(event.sources)){
    metadata.sources=event.sources.slice(0,100).filter(function(x){return x&&typeof x==='object';}).map(function(x){
      var row={};['id','label','url','title','published_at','retrieved_at','quote','status','support_status','source_status','verification_status','source_type','source_id','origin_id','publisher_id','archive_retrieved_at','fulltext_scope','fulltext_sha256','website_attestation'].forEach(function(k){if(typeof x[k]==='string')row[k]=x[k].slice(0,k==='quote'?16000:4096);});
      if(typeof x.archived==='boolean')row.archived=x.archived;
      if(typeof x.pdf_page==='string'||typeof x.pdf_page==='number')row.pdf_page=x.pdf_page;
      if(x.website_attestation&&typeof x.website_attestation==='object'&&!Array.isArray(x.website_attestation)){
        var attestation={};['domain','website_host','evidence_id','source_id','url','website_text'].forEach(function(k){if(typeof x.website_attestation[k]==='string')attestation[k]=x.website_attestation[k].slice(0,4096);});
        if(Object.keys(attestation).length)row.website_attestation=attestation;
      }
      return row;
    });
  }
  if(event.type==='research.complete'){
    if(typeof event.status==='string')metadata.status=event.status.slice(0,100);
    if(event.checks&&typeof event.checks==='object')metadata.checks=event.checks;
    ['errors','queries','issues'].forEach(function(k){if(Array.isArray(event[k]))metadata[k]=event[k];});
    ['analysis','publicResearch'].forEach(function(k){if(event[k]&&typeof event[k]==='object')metadata[k]=JSON.parse(JSON.stringify(event[k]));});
  }
}

function viewPartialReport(){
  var p=P(), rs=REPORTSTATE[cur]||{};
  var part=p && rs.partialByTopic && rs.partialByTopic[p.topic];
  if(!part){toast('暂无未完成内容');return;}
  openModal('未完成内容 · 不作为正式报告', '<p>本次生成未完成，原正式报告已保留。</p><div>'+topicReportMarkup(part.text||'')+'</div>', '<button class="primary-button" onclick="closeModal()">关闭</button>');
}

async function readTopicReportStream(response, onText, onEvent){
  var text='', finish='', failure='', buffer='', ended=false,metadata={sources:[]};
  function line(raw){
    if(raw.indexOf('data:')!==0)return;
    var data=raw.slice(5).trim();
    if(!data)return;
    if(data==='[DONE]'){ended=true;return;}
    var event;try{event=JSON.parse(data);}catch(e){failure='响应格式不完整';return;}
    if(event.error){failure=event.error&&typeof event.error.message==='string'?event.error.message.slice(0,500):'生成服务未完成本次请求';return;}
    if(/^research\.(status|evidence|complete)$/.test(event.type||'')){
      reportStreamMetadataEvent(metadata,event);
      if(typeof onEvent==='function')onEvent(event,metadata);
    }
    if(/^chain\.(result|status)$/.test(event.type||'')&&typeof onEvent==='function')onEvent(event);
    var choice=(event.choices||[])[0]||{};
    var delta=(choice.delta||{}).content;
    if(typeof delta!=='string')delta=(choice.message||{}).content;
    if(typeof delta==='string' && delta){text+=delta;if(typeof onText==='function')onText(text);}
    if(choice.finish_reason){finish=choice.finish_reason;if(finish!=='stop')failure='生成提前结束（'+finish+'）';}
    if(event.type==='response.completed')finish='stop';
    if(event.type==='response.failed'||event.type==='response.incomplete')failure='生成未完成';
  }
  if(response.body && response.body.getReader){
    var reader=response.body.getReader(), decoder=new TextDecoder();
    try{
      while(true){var part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});var lines=buffer.split(/\r?\n/);buffer=lines.pop();lines.forEach(line);}
      buffer+=decoder.decode();if(buffer.trim())line(buffer);
    }catch(e){e.partialText=text;throw e;}
  }else{
    var raw=await response.text();
    if(raw.trim().charAt(0)==='{')line('data: '+raw);else raw.split(/\r?\n/).forEach(line);
  }
  if(failure || finish!=='stop' || !text.trim()){
    var error=new Error(failure||(!text.trim()?'服务未返回正文':'连接结束，但服务没有确认生成完成'));
    error.partialText=text;throw error;
  }
  return {text:text,finishReason:finish,transportEnded:ended,metadata:metadata};
}

async function syncTopicReportInputs(capturedSnapshot){
  if(window._syncTimer){clearTimeout(window._syncTimer);window._syncTimer=null;}
  var raw=capturedSnapshot===undefined?JSON.parse(localStorage.getItem(LS_KEY)||'{}'):capturedSnapshot;
  var snapshot=typeof _safeSyncSnapshot==='function'?_safeSyncSnapshot(raw):raw;
  var response=await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)});
  if(!response.ok)throw new Error(response.status===403?'报告基础版本已更新，请刷新后重试保存':'当前方向和确认事项尚未保存，请重试');
  var result=await response.json();
  if(!result || result.ok!==true)throw new Error('当前方向和确认事项保存未确认，请刷新后重试');
}

function isCompleteTopicReport(text){
  var pattern=/(?:^|\n)\s*#{0,3}\s*([一二三四五])[、.．][^\n]*\n/g, matches=[], match;
  while((match=pattern.exec(text))!==null)matches.push({chapter:match[1],start:match.index,end:pattern.lastIndex});
  if(matches.length!==5 || matches.map(function(m){return m.chapter;}).join('')!=='一二三四五')return false;
  return matches.every(function(m,i){return /[a-z0-9\u3400-\u9fff]/i.test(text.slice(m.end,i+1<matches.length?matches[i+1].start:text.length));});
}

function updateReportBusy(){
  window._reportGenerating=!!((window._topicReportJobs||{})[cur+'\u0000'+((P()||{}).topic||'')]);
}

function triggerReport(phase){
  phase=phase||1;
  var p=P();if(!p){updateReportBusy();return;}
  var inp=document.getElementById('topicCustomInput');
  var topic=inp&&inp.value.trim()?inp.value.trim():p.topic;
  if(!topic){updateReportBusy();toast('请先选择产业方向');return;}
  var key=cur, gate=fullReportConfirmation(key,topic);
  if(phase===2 && !gate.ready){updateReportBusy();toast(gate.message);return;}
  var area=document.getElementById('reportArea');if(!area){updateReportBusy();return;}
  window._topicReportJobs=window._topicReportJobs||{};
  var jobKey=key+'\u0000'+topic;
  if(window._topicReportJobs[jobKey]){toast('当前方向正在生成，请稍候');return;}
  var epoch=typeof _authEpoch==='undefined'?null:_authEpoch;
  var requestId=p.reportRequestId||'';
  var baseReportTs=reportTopicStamp(REPORTSTATE[key]||{},topic);
  var topicBirth=(p.topicCreatedAt||{})[topic]||0,topicDeath=(p.topicDeletedAt||{})[topic]||0;
  var materialIdentity=reportMaterialIdentity(key,topic),clientFingerprint='';
  var materialDirectory=typeof captureReportMaterialDirectory==='function'?captureReportMaterialDirectory(key,topic):null;
  var controller=new AbortController(),started=Date.now(),text='';
  window._topicReportJobs[jobKey]=controller;window._reportGenerating=true;
  window._topicReportProgress=window._topicReportProgress||{};
  window._topicReportProgress[jobKey]={phase:phase,message:'正在准备当前方向材料…',text:''};
  try{p.topic=topic;persist();}catch(error){delete window._topicReportJobs[jobKey];delete window._topicReportProgress[jobKey];updateReportBusy();toast('本地保存未完成，请重试');return Promise.resolve();}
  var query=phase===1
    ? '请基于'+p.city+'城市智库，针对「'+topic+'」输出简短草稿：三个关键缺口、三个招引方向、三个以⚠️开头的待确认事项和证据边界。事实与推断分开，没有证据写待核，不能写成不存在。'+(window._interviewContext?'\n访谈补充：'+window._interviewContext:'')
    : '请基于'+p.city+'城市智库，针对「'+topic+'」输出五章招商研判：一、产业基础判断；二、产业链缺口分析；三、补链优先级清单；四、目标企业画像；五、待确认事项。数字、政策门槛和有效期必须保留原文完整条件，并给出来源。不得将未检索到改写为不存在，不得将待核或推断改成事实。已确认事项：\n'+gate.items.map(function(x){return x.editedText||x.text;}).join('\n');
  var chunks;
  try{
    var corpus=buildKBCorpus(p.city);chunks=kbSearch(query,corpus,phase===1?8:20);
    setReportAreaHtml(area,'<div class="report-document industry-report industry-prose"><h2>'+(phase===1?'初步研判草稿':'完整产业研判')+'</h2><p id="reportRunStatus">正在读取当前方向材料，检索与来源核对完成后显示研判…</p><div id="reportContent"></div></div>');
    refreshReportRunUi();
  }catch(error){delete window._topicReportJobs[jobKey];delete window._topicReportProgress[jobKey];updateReportBusy();toast('读取本地材料未完成，请重试');return Promise.resolve();}
  function active(){return PROJECTS[key] && (PROJECTS[key].reportRequestId||'')===requestId && ((PROJECTS[key].topicCreatedAt||{})[topic]||0)===topicBirth && ((PROJECTS[key].topicDeletedAt||{})[topic]||0)===topicDeath && (epoch===null || epoch===_authEpoch);}
  function visible(){return active() && cur===key && P() && P().topic===topic;}
  function materialsCurrent(){return reportMaterialIdentity(key,topic)===materialIdentity;}
  function changedError(){var e=new Error('材料或确认事项已更新，本次结果未写入，请按最新材料重新生成');e.sourceChanged=true;return e;}
  function showStatus(message){
    var job=(window._topicReportProgress||{})[jobKey];if(job)job.message=message;
    if(visible())refreshReportRunUi();
  }
  function retainPartial(part,reason){
    if(!active()||reportTopicStamp(REPORTSTATE[key]||{},topic)!==baseReportTs)return;
    var rs=REPORTSTATE[key]||(REPORTSTATE[key]={});
    rs.partialByTopic=rs.partialByTopic||{};
    rs.partialByTopic[topic]={text:part||'',reason:reason,ts:topicOperationStamp(key,topic),reportTs:baseReportTs,phase:phase,status:'incomplete'};
    persist();
  }
  var timeout=setTimeout(function(){controller.abort();},phase===2?240000:180000);
  return reportClientFingerprint(materialIdentity).then(function(value){
    clientFingerprint=value;
    if(!materialsCurrent())throw changedError();
    return syncTopicReportInputs();
  }).then(function(){
    if(!active())throw new Error('登录状态已变更，本次生成已停止');
    if(!materialsCurrent())throw changedError();
    return fetch('/api/kb-chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
    body:JSON.stringify({question:query,chunks:chunks,city:p.city,stream:true,mode:phase===1?'draft':'full',prefs:curOnbPrefs(),purpose:phase===2?'topic_full':'topic_draft',projectKey:key,topic:topic,reportRequestId:requestId||null,confirmations:phase===2?gate.items:[],clientMaterialFingerprint:clientFingerprint})
    });
  }).then(function(response){
    if(!response.ok){
      return response.json().catch(function(){return {};}).then(function(error){throw new Error(typeof error.message==='string'?error.message.slice(0,500):'服务未接受请求（'+response.status+'）');});
    }
    showStatus('正在研究当前方向，检索与来源核对进展将在此显示');
    return readTopicReportStream(response,function(value){
      text=value;var job=(window._topicReportProgress||{})[jobKey];if(job)job.text=value;
      if(visible()){var el=document.getElementById('reportContent');if(el)el.innerHTML=topicReportMarkup(value);}
    },function(event,metadata){
      if(metadata.clientMaterialFingerprint&&metadata.clientMaterialFingerprint!==clientFingerprint){controller.abort();throw changedError();}
      if(event.type==='research.status'&&event.message)showStatus(event.message);
      else if(event.type==='research.evidence')showStatus('已读取 '+metadata.sources.length+' 条来源，继续核对并整理研判');
    });
  }).then(function(result){
    if(!active())return;
    if(!materialsCurrent())throw changedError();
    if(reportTopicStamp(REPORTSTATE[key]||{},topic)!==baseReportTs)throw changedError();
    if(result.metadata&&result.metadata.clientMaterialFingerprint&&result.metadata.clientMaterialFingerprint!==clientFingerprint)throw changedError();
    text=result.text;
    if(phase===2 && !isCompleteTopicReport(text)){var e=new Error('本次正文未包含完整五章，已保留为未完成内容');e.partialText=text;throw e;}
    var rs=REPORTSTATE[key]||(REPORTSTATE[key]={});
    if(typeof archiveCurrentReport==='function')archiveCurrentReport(key,topic);
    var now=topicOperationStamp(key,topic);
    ['aiReportByTopic','phaseByTopic','tsByTopic','scoreByTopic','userGeneratedTopics','pendingByTopic'].forEach(function(field){rs[field]=rs[field]||{};});
    rs.aiReportByTopic[topic]=text;rs.phaseByTopic[topic]=phase;rs.tsByTopic[topic]=now;
    rs.researchByTopic=rs.researchByTopic||{};
    rs.researchByTopic[topic]=Object.assign({},result.metadata||{},{topic:topic,reportText:text,clientMaterialFingerprint:clientFingerprint,generatedAt:now});
    if(materialDirectory){
      materialDirectory.reportText=text;rs.materialDirectoryByTopic=rs.materialDirectoryByTopic||{};
      rs.materialDirectoryByTopic[topic]=materialDirectory;
    }
    rs.userGeneratedTopics[topic]=true;
    if(rs.chainByTopic)delete rs.chainByTopic[topic];
    if(rs.chainEvidenceByTopic)delete rs.chainEvidenceByTopic[topic];
    if(rs.chainStatusByTopic)delete rs.chainStatusByTopic[topic];
    if(rs.chainUnclassifiedByTopic)delete rs.chainUnclassifiedByTopic[topic];
    if(rs.chainErrorByTopic)delete rs.chainErrorByTopic[topic];
    rs.evidenceStatusByTopic=rs.evidenceStatusByTopic||{};rs.evidenceStatusByTopic[topic]='unreviewed';
    rs.scoreByTopic[topic]=null;
    if(rs.partialByTopic)delete rs.partialByTopic[topic];
    if(phase===1){
      var previous=rs.pendingByTopic[topic]||[];
      rs.pendingByTopic[topic]=parsePendingItems(text).map(function(item){return previous.find(function(x){return x.text===item.text;})||item;});
      if(visible())PENDING_CONFIRMS[key]=rs.pendingByTopic[topic];
    }
    touchTopicPending(key,topic);
    if(visible()){rs.text=text;rs.topic=topic;rs.phase=phase;rs.ts=now;rs.score=null;rs.finalized=false;}
    persist();showStatus('正文已生成，正在确认云端保存…');
    return syncTopicReportInputs().then(function(){
      var analysis=(rs.researchByTopic[topic]||{}).analysis||{};
      var label=analysis.status==='evidence_only'?'资料摘要已保存 · 研判依据待补':analysis.status==='supported_analysis'?'研判已生成 · 结论待核验':phase===1?'草稿已保存，请确认当前方向事项':'报告已保存 · 请核对来源和结论';
      showStatus(label+' · '+Math.round((Date.now()-started)/1000)+'秒');if(visible())toast(label);
    },function(error){error.localReportSaved=true;throw error;});
  }).catch(function(error){
    if(error.localReportSaved){showStatus('报告已保存在本机，云端保存未确认；请重试同步。');if(visible())toast('报告已保存在本机，云端保存未确认；请重试同步。');return;}
    if(!error.sourceChanged&&materialsCurrent())retainPartial(error.partialText||text,error.message);
    showStatus(error.sourceChanged?error.message:'本次生成未完成，原正式报告已保留；可重试。');
    if(visible())toast(error.name==='AbortError'?'生成连接超时，未完成内容已保留':error.message);
  }).finally(function(){
    clearTimeout(timeout);delete window._topicReportJobs[jobKey];
    delete window._topicReportProgress[jobKey];
    updateReportBusy();
    if(visible())render();
  });
}


function demandReportSnapshot(key,topic){
  var rs=REPORTSTATE[key]||{}, native=nativeReportState(topic,key);
  var exactPhase=(rs.phaseByTopic||{})[topic];
  var full=native || exactPhase===2 || (exactPhase==null && rs.topic===topic && rs.phase===2);
  var text=(rs.aiReportByTopic||{})[topic] || (rs.topic===topic?rs.text:'');
  if(!full || typeof text!=='string' || !text.trim())return null;
  var copy={text:text,topic:topic,phase:2,ts:(rs.tsByTopic||{})[topic]||rs.ts||Date.now(),
    aiReportByTopic:{},phaseByTopic:{},tsByTopic:{},scoreByTopic:{},evidenceStatusByTopic:{}};
  copy.aiReportByTopic[topic]=text;copy.phaseByTopic[topic]=2;copy.tsByTopic[topic]=copy.ts;
  var directory=typeof reportMaterialDirectoryForContext==='function'?reportMaterialDirectoryForContext({key:key,project:PROJECTS[key],state:rs,topic:topic,text:text}):null;
  if(directory){copy.materialDirectoryByTopic={};copy.materialDirectoryByTopic[topic]=JSON.parse(JSON.stringify(directory));}
  copy.scoreByTopic[topic]=(rs.scoreByTopic||{})[topic];
  copy.evidenceStatusByTopic[topic]=(rs.evidenceStatusByTopic||{})[topic] || (native?'native':'unreviewed');
  var research=(rs.researchByTopic||{})[topic];
  if(research&&research.reportText===text){copy.researchByTopic={};copy.researchByTopic[topic]=JSON.parse(JSON.stringify(research));}
  if(native){['sourceReportId','scoreBasis','scoreStatus','score','sourceEngineReportId','sourceGeneration'].forEach(function(f){if(rs[f]!=null)copy[f]=rs[f];});}
  else{copy.score=null;copy.scoreByTopic[topic]=null;}
  return copy;
}

// 提交招引需求到管理端需求池
function submitDemand(){return chooseIndustryDemand();}

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
  return ['strong','mid','weak','unknown'].indexOf(node.level)>=0?node.level:'unknown';
}
/* 将 AI 返回的 chain 规范化为泳道格式 [{seg,nodes:[{name,level,note,local_leaders,benchmark}]}]。
   兼容两种结构：① 泳道数组 [{seg,nodes}] ② 扁平对象 {segments:[{name,level,...}]}。 */
function _normalizeChain(parsed){
  var segMap={'上游':[], '中游':[], '下游':[]};
  function pushNode(seg, nd){
    if(!nd||!nd.name) return;
    var node={
      name: nd.name,
      level: (nd.level==='strong'||nd.level==='mid'||nd.level==='weak')?nd.level:'unknown',
      sources: Array.isArray(nd.sources)?nd.sources:(nd.sourceRecords||[]).reduce(function(a,r){return a.concat((r.urls||[]).map(function(url){return {url:url,quote:r.quote};}));},[]),
      evidence_ids: Array.isArray(nd.evidence_ids)?nd.evidence_ids:[],
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
function currentEvidenceChain(topic,key){
  key=key||cur;
  var rs=REPORTSTATE[key];if(!rs)return null;
  var meta=(rs.chainEvidenceByTopic||{})[topic],chain=(rs.chainByTopic||{})[topic],status=(rs.chainStatusByTopic||{})[topic];
  return ['ready','partial','empty'].indexOf(status)>=0&&chainEvidenceMatches(meta,key,topic)&&Array.isArray(chain)?chain:null;
}

function chainSnapshotIdentity(value){
  if(Array.isArray(value))return '['+value.map(chainSnapshotIdentity).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(function(k){return JSON.stringify(k)+':'+chainSnapshotIdentity(value[k]);}).join(',')+'}';
  return JSON.stringify(value);
}

function chainSourceIdentity(value){
  if(typeof value!=='string')return null;
  try{var parsed=JSON.parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?chainSnapshotIdentity(parsed):null;}catch(error){return null;}
}

function chainEvidenceMatches(meta,key,topic){
  var p=PROJECTS[key],rs=REPORTSTATE[key];
  if(!p||!rs||!meta||meta.contract!=='source-bound-chain-v2'||meta.scope!=='current-topic-v2'||meta.topic!==topic)return false;
  var text=(rs.aiReportByTopic||{})[topic]||(rs.topic===topic?rs.text:'');
  return meta.requestId===(p.reportRequestId||rs.reportRequestId||'')&&meta.reportText===text&&typeof meta.inputFingerprint==='string'&&!!meta.inputFingerprint&&
    chainSourceIdentity(meta.sourceIdentity)!==null&&chainSourceIdentity(meta.sourceIdentity)===chainSourceIdentity(savedEvidenceIdentity(key,topic));
}

function chainInputSnapshot(key){
  var project=PROJECTS[key],root=project.workspaceId||key,keys=root===key?[key]:[root,key];
  var snapshot={PROJECTS:{},REPORTSTATE:{},syncTs:Date.now()};
  keys.forEach(function(k){if(PROJECTS[k])snapshot.PROJECTS[k]=PROJECTS[k];if(REPORTSTATE[k])snapshot.REPORTSTATE[k]=REPORTSTATE[k];});
  var input={KB_CONFIRMS:typeof KB_CONFIRMS!=='undefined'?KB_CONFIRMS:{},KB_CONFIRM_TOMBS:typeof KB_CONFIRM_TOMBS!=='undefined'?KB_CONFIRM_TOMBS:{},KB_ITEM_TOMBS:typeof KB_ITEM_TOMBS!=='undefined'?KB_ITEM_TOMBS:{},UPLOADS:typeof UPLOADS!=='undefined'?UPLOADS:{},KB_FILE_CHUNKS:typeof KB_FILE_CHUNKS!=='undefined'?KB_FILE_CHUNKS:{},UPLOAD_TOMBS:typeof UPLOAD_TOMBS!=='undefined'?UPLOAD_TOMBS:{}};
  Object.keys(input).forEach(function(field){snapshot[field]={};keys.forEach(function(k){if(input[field][k]!==undefined)snapshot[field][k]=input[field][k];});});
  Object.keys(input.UPLOAD_TOMBS).forEach(function(k){if(keys.some(function(key){return k.indexOf(key+'::')===0;}))snapshot.UPLOAD_TOMBS[k]=input.UPLOAD_TOMBS[k];});
  if(typeof RESET_GEN!=='undefined')snapshot.RESET_GEN=RESET_GEN;
  if(typeof AUTH!=='undefined'&&AUTH&&AUTH.user)snapshot.clientUser=AUTH.user;
  snapshot=JSON.parse(JSON.stringify(snapshot));
  Object.keys(snapshot.REPORTSTATE).forEach(function(k){Object.keys(snapshot.REPORTSTATE[k]).forEach(function(field){if(/^chain/.test(field)||field==='pendingChainSaves')delete snapshot.REPORTSTATE[k][field];});});
  Object.keys(snapshot.PROJECTS).forEach(function(k){delete snapshot.PROJECTS[k].segmentLevels;});
  Object.keys(snapshot.UPLOADS).forEach(function(k){snapshot.UPLOADS[k].forEach(function(upload){if(upload&&typeof upload==='object')delete upload.dataUrl;});});
  return snapshot;
}

function generateChainFromReport(topic, reportText, city, force){
  if(!topic||!cur||!REPORTSTATE[cur])return Promise.resolve(false);
  var key=cur,rs=REPORTSTATE[key],project=PROJECTS[key],requestId=project.reportRequestId||rs.reportRequestId||'',epoch=typeof _authEpoch==='undefined'?null:_authEpoch;
  var sourceIdentity=savedEvidenceIdentity(key,topic),inflight=key+'|'+topic;
  if(_chainGenInFlight[inflight])return Promise.resolve(false);
  if(!force&&currentEvidenceChain(topic,key))return Promise.resolve(true);
  var exact=(rs.aiReportByTopic||{})[topic]||(rs.topic===topic?rs.text:'');
  if(!exact||exact.trim().length<100){rs.chainErrorByTopic=rs.chainErrorByTopic||{};rs.chainErrorByTopic[topic]='当前报告正文不足 100 字，请先完善当前方向报告后再生成图谱。';if(typeof toast==='function')toast(rs.chainErrorByTopic[topic]);return Promise.resolve(false);}
  var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},480000);
  _chainGenInFlight[inflight]={message:'正在确认当前材料已保存…'};
  function active(){return PROJECTS[key]&&savedEvidenceIdentity(key,topic)===sourceIdentity&&(PROJECTS[key].reportRequestId||REPORTSTATE[key].reportRequestId||'')===requestId&&(epoch===null||epoch===_authEpoch);}
  function show(){
    if(cur!==key||!P()||P().topic!==topic||view!=='report')return;
    var block=document.getElementById('chainMapBlock'),job=_chainGenInFlight[inflight];
    if(!block){render();return;}
    if(job){
      var status=block.querySelector('.chain-generation-status');
      if(status){var message=status.querySelector('[data-chain-status-message]');if(message)message.textContent=job.message;return;}
      if(block.querySelector('.chain-explorer')){block.insertAdjacentHTML('afterbegin',chainGenerationStatusHtml(job));return;}
    }
    var old=typeof _captureChainExplorer==='function'?_captureChainExplorer():null;
    if(typeof _captureScroll==='function')_captureScroll();
    block.innerHTML=chainMapHtml(P());
    if(typeof _restoreChainExplorer==='function')_restoreChainExplorer(old);
    if(typeof _restoreScroll==='function')_restoreScroll(_scrollMemory.key,_scrollMemory.tops);
    if(typeof render==='function')render._markup=null;
  }
  var snapshot;
  try{snapshot=chainInputSnapshot(key);}catch(error){snapshot=null;}
  show();
  return (snapshot?syncTopicReportInputs(snapshot):Promise.reject(new Error('当前材料尚未保存，请刷新后重试。'))).then(function(){
    if(!active())throw new Error('材料或报告已更新，请重新生成图谱。');
    _chainGenInFlight[inflight].message='正在检索并整理公开原文…';show();
    return fetch(KB_API,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:controller.signal,
      body:JSON.stringify({question:'依据当前方向已保存的报告和材料生成有来源的产业链图谱；未分类项单列，禁止推断不存在的连接。',chunks:[],city:city||project.city,stream:true,mode:'chain',purpose:'chain_map',projectKey:key,topic:topic,reportRequestId:requestId||null,sourceIdentity:sourceIdentity})});
  }).then(async function(response){
    if(!response.ok){var errorBody=await response.json().catch(function(){return {};});var messages={evidence_changed:'材料已更新，请刷新后重新生成图谱。',report_changed:'报告版本已更新，请刷新后重新生成图谱。',topic_mismatch:'当前方向已更新，请刷新后重新生成图谱。',evidence_missing:'当前方向缺少可核查材料，请补充后重试。'};throw new Error(messages[errorBody.error||errorBody.code]||'图谱服务未接受请求（'+response.status+'），请稍后重试。');}
    var resultEvent=null;
    await readTopicReportStream(response,function(){},function(event){
      if(event.type==='chain.result')resultEvent=event;
      if((event.type==='chain.status'||event.type==='research.status')&&typeof event.message==='string'&&active()){_chainGenInFlight[inflight].message=event.message;show();}
    });
    if(!active())return false;
    if(!resultEvent||resultEvent.saved!==true||!Array.isArray(resultEvent.chain)||!Array.isArray(resultEvent.unclassified)||['ready','partial','empty'].indexOf(resultEvent.status)<0||!resultEvent.chain.every(function(segment){return segment&&['上游','中游','下游'].indexOf(segment.seg)>=0&&Array.isArray(segment.nodes);})||!chainEvidenceMatches(resultEvent.evidence,key,topic))throw new Error('图谱结果的材料版本未确认，请刷新后重新生成。');
    rs=REPORTSTATE[key];
    var copy=JSON.parse(JSON.stringify(resultEvent));
    rs.chainByTopic=rs.chainByTopic||{};rs.chainByTopic[topic]=copy.chain;
    rs.chainUnclassifiedByTopic=rs.chainUnclassifiedByTopic||{};rs.chainUnclassifiedByTopic[topic]=copy.unclassified;
    rs.chainEvidenceByTopic=rs.chainEvidenceByTopic||{};rs.chainEvidenceByTopic[topic]=copy.evidence;
    rs.chainStatusByTopic=rs.chainStatusByTopic||{};rs.chainStatusByTopic[topic]=copy.status;
    if(rs.chainErrorByTopic)delete rs.chainErrorByTopic[topic];
    if(rs.pendingChainSaves)delete rs.pendingChainSaves[topic];
    if(rs.chainSaveErrorByTopic)delete rs.chainSaveErrorByTopic[topic];
    try{persist();}catch(ignore){}return true;
  }).catch(function(error){
    if(!active())return false;
    rs=REPORTSTATE[key];rs.chainErrorByTopic=rs.chainErrorByTopic||{};
    rs.chainErrorByTopic[topic]=error&&error.name==='AbortError'?'图谱生成超时，已有结果已保留，请稍后重试。':error&&error.message||'图谱未完成，已有结果已保留，请稍后重试。';
    if(!chainEvidenceMatches((rs.chainEvidenceByTopic||{})[topic],key,topic)){rs.chainStatusByTopic=rs.chainStatusByTopic||{};rs.chainStatusByTopic[topic]='failed';}
    try{persist();}catch(ignore){}return false;
  }).finally(function(){clearTimeout(timer);delete _chainGenInFlight[inflight];if(epoch===null||epoch===_authEpoch)show();});
}

function requestChainGeneration(){
  var p=P();if(!p||!REPORTSTATE[cur])return Promise.resolve(false);
  return generateChainFromReport(p.topic,null,p.city,true);
}

function _findPendingForTopic(rs, topic){
  if(!rs||!rs.pendingByTopic||!topic) return [];
  return Array.isArray(rs.pendingByTopic[topic])?rs.pendingByTopic[topic]:[];
}

function escapeChainText(value){return String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');}

/* 丰富泳道格式渲染（动态AI图谱也用此格式，与硬编码链一致） */
function chainSafeSourceUrl(value){
  if(typeof value!=='string'||/[\s<>"'\\]/.test(value))return '';
  try{var parsed=new URL(value);return /^(https?:)$/.test(parsed.protocol)&&!parsed.username&&!parsed.password?parsed.href:'';}catch(error){return '';}
}

function chainNodeSources(node){
  var all=[];
  ['sources','sourceRecords','evidence'].forEach(function(field){if(Array.isArray(node[field]))all=all.concat(node[field]);});
  var seen={},rows=[];
  all.forEach(function(source){if(!source||typeof source!=='object')return;var urls=Array.isArray(source.urls)?source.urls:[source.url||source.source_url];urls=urls.map(chainSafeSourceUrl).filter(Boolean);
    var quote=typeof source.quote==='string'?source.quote:'',id=source.id||'',sig=JSON.stringify([id,urls,quote]);if(seen[sig])return;seen[sig]=true;
    rows.push({id:id,urls:urls,quote:quote,title:source.title||source.cite||'',date:source.published_at||source.date||'',retrieved:source.retrieved_at||'',archived:source.archived===true,fulltextScope:source.fulltext_scope||'',pdfPage:source.pdf_page||'',quoteRange:source.quote_range||source.excerpt_range||''});});
  return rows;
}

function chainNodeSourcesHtml(node){
  var rows=chainNodeSources(node),nature=node.negated===true?'否定或排除表述 · 待核':node.status==='planned'?'规划 / 计划 · 待核':node.status==='reported'?'材料披露 · 待核':'待核';
  return '<details class="industry-chain-sources" style="width:100%;margin-top:10px;text-align:left;font-size:11px;line-height:1.7"><summary>'+(rows.length?'查看原文与来源（'+rows.length+'）':'材料属性与待补来源')+'</summary><div class="industry-chain-source-scroll" style="max-height:320px;overflow:auto;overscroll-behavior:contain;margin-top:6px"><p style="font-size:10px;color:#8a9aa8">原始材料属性：'+nature+'</p>'+rows.map(function(row){
    return '<div style="padding:10px 0;border-top:1px solid #e2e8f0;overflow-wrap:anywhere">'+(row.title?'<strong>'+escapeChainText(row.title)+'</strong>':'')+
      (row.quote?'<blockquote style="margin:6px 0;padding-left:8px;border-left:2px solid #cbd5e1;white-space:pre-wrap">'+escapeChainText(row.quote)+'</blockquote>':'')+
      row.urls.map(function(url,index){return '<a href="'+escapeChainText(url)+'" target="_blank" rel="noopener noreferrer" style="margin-right:10px">打开来源 '+(index+1)+'</a>';}).join('')+'</div>';
  }).join('')+(!rows.length?'<p>来源待补充，当前表述尚未核实。</p>':'')+'</div></details>';
}

function actualWeaknessView(value){
  var j=value&&value.judgment;if(!value||value.contract!=='chain-assessment-v1'||!j||j.contract!=='chain-judgment-v3')return null;
  var styles={strong:{label:'已有支撑',color:'#2c7951',bg:'#eaf7ef',border:'#8aba9e',card:'#f4faf6'},mid:{label:'存在短板',color:'#8f6416',bg:'#fff4cf',border:'#d8bc69',card:'#fffcef'},weak:{label:'明显薄弱',color:'#b24738',bg:'#fdebe5',border:'#db8d7e',card:'#fff6f3'},unknown:{label:'尚不能评价',color:'#738293',bg:'#f5f7fa',border:'#cbd4de',card:'#fff'}};
  var valid=Object.prototype.hasOwnProperty.call(styles,j.level),level=valid?j.level:'unknown',s=styles[level];
  var scopes={local:'本地实际条件',local_enterprise:'关联企业风险',industry_shared:'行业共性约束'},dimensions={supply:'实际供给',dependency:'关键依赖',maturity:'工程成熟度',coordination:'配套协同'};
  var ids=Array.isArray(j.evidence_ids)?j.evidence_ids:[],facts={weak:'明显薄弱',attention:'存在短板',supported:'已有支撑',unknown:'证据不足'};
  return {available:true,judgment:valid,actual:true,reasoning:true,level:level,label:s.label,color:s.color,bg:s.bg,border:s.border,card:s.card,reason:j.reason||'',basis:j.dimension||'',basisLabel:[dimensions[j.dimension],scopes[j.scope]].filter(Boolean).join(' · '),evidenceCount:ids.filter(function(id,i){return ids.indexOf(id)===i;}).length,confidence:({high:'较高',medium:'中等',low:'较低'}[j.confidence]||''),method:'实际评价',action:j.action||'',comparison:j.comparison||'',factLabel:facts[value.level]||'尚未评价',evidence:({multiple_sources:'多源材料',single_source:'单源材料',insufficient:'待补证'}[value.evidence_strength]||'待补证')};
}

function chainAssessmentView(value){
  var actual=actualWeaknessView(value);if(actual)return actual;
  var styles={strong:{label:'已有基础',color:'#2c7951',bg:'#eaf7ef',border:'#8aba9e',card:'#f4faf6'},mid:{label:'重点培育',color:'#8f6416',bg:'#fff4cf',border:'#d8bc69',card:'#fffcef'},weak:{label:'优先补链',color:'#b24738',bg:'#fdebe5',border:'#db8d7e',card:'#fff6f3'},unknown:{label:'待研判',color:'#738293',bg:'#f5f7fa',border:'#cbd4de',card:'#fff'}};
  var factLabels={weak:'明显薄弱',attention:'存在短板',supported:'已有支撑',unknown:'证据不足'},materials={multiple_sources:'多源材料',single_source:'单源材料',insufficient:'待补证'};
  var container=value&&value.contract==='chain-assessment-v1',facts=container&&value.state==='ready';
  var judgment=container&&value.judgment&&['chain-judgment-v1','chain-judgment-v2'].indexOf(value.judgment.contract)>=0?value.judgment:null;
  var legacy={weak:'weak',attention:'weak',supported:'strong',unknown:'unknown'};
  var level=judgment?(Object.prototype.hasOwnProperty.call(styles,judgment.level)?judgment.level:'unknown'):(facts&&Object.prototype.hasOwnProperty.call(legacy,value.level)?legacy[value.level]:'unknown');
  var bases={existing_basis:'本地基础',enterprise_presence:'企业业务布局',local_constraint:'本地约束',capacity_mismatch:'供需不匹配',dependency_exposure:'依赖风险',policy_bottleneck:'政策识别的补链重点',policy_priority:'政策培育',industry_challenge:'行业挑战',insufficient:'依据待补充',aggregate:'综合研判',local_gap:'本地短板',local_capability:'本地基础',local_plan:'规划培育',industry_risk:'行业风险',insufficient:'依据待补充'};
  var style=styles[level],ids=judgment&&Array.isArray(judgment.evidence_ids)?judgment.evidence_ids.slice():[];
  if(!ids.length&&facts){(Array.isArray(value.findings)?value.findings:[]).forEach(function(row){if(row&&typeof row.evidence_id==='string')ids.push(row.evidence_id);});}
  var unique=ids.filter(function(id,index){return typeof id==='string'&&id&&ids.indexOf(id)===index;});
  return {available:!!judgment||!!facts,judgment:!!judgment&&Object.prototype.hasOwnProperty.call(styles,judgment.level),level:level,label:style.label,color:style.color,bg:style.bg,border:style.border,card:style.card,
    reason:judgment&&typeof judgment.reason==='string'?judgment.reason:facts&&typeof value.summary==='string'?value.summary:'',basis:judgment&&(judgment.rule||judgment.basis)||'',basisLabel:judgment&&(judgment.rule||judgment.basis)?(bases[judgment.rule||judgment.basis]||judgment.rule||judgment.basis):'',evidenceCount:unique.length,
    reasoning:!!judgment&&judgment.contract==='chain-judgment-v2',confidence:judgment&&({high:'较高',medium:'中等',low:'较低'}[judgment.confidence]||''),method:judgment&&judgment.method==='inference'?'分析推论':'直接依据',action:judgment&&typeof judgment.action==='string'?judgment.action:'',factLabel:facts&&Object.prototype.hasOwnProperty.call(factLabels,value.level)?factLabels[value.level]:'尚未评价',evidence:facts&&Object.prototype.hasOwnProperty.call(materials,value.evidence_strength)?materials[value.evidence_strength]:'待补证'};
}

function chainAssessmentBadge(value){
  var v=chainAssessmentView(value);
  return '<span class="chain-judgment-badge" style="display:inline-block;padding:4px 9px;border-radius:6px;background:'+v.bg+';color:'+v.color+';font-size:11px;font-weight:700;white-space:nowrap">'+v.label+'</span>'+
    (v.confidence?'<span class="chain-confidence" style="font-size:10px;color:#7e8d9b;margin-left:6px">'+v.method+' · '+v.confidence+'把握</span>':'')+
    (v.evidenceCount?'<span class="chain-source-count" style="font-size:10px;color:#8795a2;margin-left:7px;white-space:nowrap">依据 '+v.evidenceCount+' 条</span>':'');
}

function chainAssessmentDate(value,withTime){
  var text=typeof value==='string'?value.trim():'';if(!text)return '';
  var match=text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?)?$/);
  var date=new Date(text),check=new Date(0);if(!match||!Number.isFinite(date.getTime()))return text;
  check.setUTCFullYear(Number(match[1]),Number(match[2])-1,Number(match[3]));check.setUTCHours(0,0,0,0);
  if(check.getUTCFullYear()!==Number(match[1])||check.getUTCMonth()!==Number(match[2])-1||check.getUTCDate()!==Number(match[3]))return text;
  if(!withTime)return match[1]+'-'+match[2]+'-'+match[3];
  function pad(n){return String(n).padStart(2,'0');}
  return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+' '+pad(date.getHours())+':'+pad(date.getMinutes());
}

function chainAssessmentFindings(value){
  if(!value||value.contract!=='chain-assessment-v1'||value.state!=='ready')return [];
  var rows=Array.isArray(value.findings)?value.findings.slice():[];
  (Array.isArray(value.dimensions)?value.dimensions:[]).forEach(function(d){if(d&&Array.isArray(d.findings))rows=rows.concat(d.findings);});
  var seen={};return rows.filter(function(finding){if(!finding||typeof finding!=='object')return false;var id=JSON.stringify([finding.id||'',finding.target_id||'',finding.dimension||'',finding.kind||'',finding.evidence_id||'',finding.quote||'']);if(seen[id])return false;seen[id]=true;return true;});
}

function chainAssessmentFindingHtml(finding){
  var dims={supply:'本地供给',dependency:'外部依赖',capacity:'研发与产能',coordination:'产业协同'},source=finding.source&&typeof finding.source==='object'?finding.source:{};
  var scope=finding.scope==='local'?'本地':finding.scope==='industry'?'行业背景':'范围待核',scopeLabel=typeof finding.scope_label==='string'&&finding.scope_label?' · '+finding.scope_label:'';
  var quote=typeof finding.quote==='string'?finding.quote:typeof source.quote==='string'?source.quote:'';
  var url=chainSafeSourceUrl(source.url),published=chainAssessmentDate(source.published_at||source.date,false),retrieved=chainAssessmentDate(source.retrieved_at,true);
  return '<article class="chain-assessment-finding" style="padding:11px 0;border-top:1px solid #e1e8ef;overflow-wrap:anywhere"><div style="font-size:10px;color:#7b8e9f">范围：'+scope+escapeChainText(scopeLabel)+(dims[finding.dimension]?' · '+dims[finding.dimension]:'')+'</div>'+
    (quote?'<blockquote style="margin:6px 0;padding:8px 10px;border-left:2px solid #bccddd;background:#f8fafc;white-space:pre-wrap;color:#50677d">'+escapeChainText(quote)+'</blockquote>':'<p>尚缺可展示的原句。</p>')+
    (source.title?'<div style="font-size:11px;color:#657d92">'+escapeChainText(source.title)+'</div>':'')+
    '<div style="font-size:10px;color:#8294a5;margin-top:3px">发布：'+escapeChainText(published||'日期未知')+(retrieved?' · '+(source.archived===true?'原文归档：':'检索：')+escapeChainText(retrieved)+'（本地）':'')+'</div>'+
    (url?'<a href="'+escapeChainText(url)+'" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:5px;font-size:11px">打开原文来源</a>':'<span style="font-size:10px;color:#8294a5">来源链接待补充</span>')+'</article>';
}

function chainAssessmentDetails(value,node){
  if(!value||value.contract!=='chain-assessment-v1')return '';
  var view=chainAssessmentView(value),findings=chainAssessmentFindings(value),groups=[{key:'local_gap',label:'本地短板依据',rows:[]},{key:'local_capability',label:'本地支撑依据',rows:[]},{key:'plan',label:'规划补强 · 尚未落地',rows:[]},{key:'industry',label:'行业背景 · 不代表本地情况',rows:[]},{key:'context',label:'其他材料与范围待核',rows:[]}];
  findings.forEach(function(finding){var key=finding.kind==='plan'?'plan':finding.scope==='industry'?'industry':finding.scope==='local'&&finding.kind==='gap'?'local_gap':finding.scope==='local'&&finding.kind==='capability'?'local_capability':'context';groups.find(function(group){return group.key===key;}).rows.push(finding);});
  var summary=typeof value.summary==='string'?value.summary:'',checks=(Array.isArray(value.next_checks)?value.next_checks:[]).filter(function(text){return typeof text==='string'&&text.trim();});
  var analysis=value.judgment&&['chain-judgment-v2','chain-judgment-v3'].indexOf(value.judgment.contract)>=0?value.judgment:null;
  var premises=analysis&&Array.isArray(analysis.premises)?analysis.premises:[],limitations=analysis&&Array.isArray(analysis.limitations)?analysis.limitations:[];
  var comparisonHtml=view.actual&&view.comparison?'<p><strong>比较基准：</strong>'+escapeChainText(view.comparison)+'</p>':'';
  var counterHtml=analysis&&Array.isArray(analysis.counter_evidence)&&analysis.counter_evidence.length?'<strong>已核对的相反证据</strong>'+analysis.counter_evidence.map(chainAssessmentFindingHtml).join(''):'';
  var missingHtml=analysis&&Array.isArray(analysis.missing)&&analysis.missing.length?'<p><strong>仍缺：</strong>'+analysis.missing.map(escapeChainText).join('；')+'</p>':'';
  var analysisHtml=analysis?comparisonHtml+counterHtml+missingHtml+'<section class="chain-analysis-premises"><strong>判断依据链</strong>'+premises.map(function(p){var labels={operation:'实际生产/运营',dependency:'实际依赖',maturity:'当前工程阶段',constraint:'实际约束',benchmark:'比较基准',industry_fact:'行业事实',local_basis:'本地基础',local_presence:'企业所在地',local_affiliation:'本地企业关联',local_site:'设施所在地',enterprise_capability:'企业产品业务',local_demand:'本地需求',industry_requirement:'产业要求',policy_target:'政策目标',constraint:'约束条件'};return '<p style="margin:8px 0 0"><b>'+escapeChainText(labels[p.role]||p.role||'依据')+'</b> · '+escapeChainText(p.subject||'')+'</p>'+chainAssessmentFindingHtml(p);}).join('')+(view.action?'<p><strong>补链建议：</strong>'+escapeChainText(view.action)+'</p>':'')+(limitations.length?'<strong>判断边界</strong><ul>'+limitations.map(function(x){return '<li>'+escapeChainText(x)+'</li>';}).join('')+'</ul>':'')+'</section>':'';
  var sources=node?chainNodeSources(node):[],nature=node?(node.negated===true?'否定或排除表述':node.status==='planned'?'规划 / 计划':node.status==='reported'?'材料披露':'材料属性待核'):'';
  return '<details class="chain-assessment-details" style="margin-top:9px;font-size:11px;color:#5b7389;line-height:1.75"><summary style="cursor:pointer;font-weight:600">研判依据'+(findings.length?'（'+findings.length+'条）':'')+'</summary><div style="max-height:320px;overflow:auto;overscroll-behavior:contain;margin-top:7px">'+
    (view.reason?'<p style="margin:0 0 8px"><strong>研判建议：</strong>'+escapeChainText(view.reason)+'</p>':'')+
    analysisHtml+
    (view.basis?'<p style="margin:0 0 8px">依据类型：'+escapeChainText(view.basisLabel)+'</p>':'')+
    '<div style="font-size:10px;color:#8a9aa7;margin-bottom:6px">以引用材料对应时间为准，不代表实时认证。</div><div class="chain-fact-assessment" style="'+(view.actual?'display:none;':'')+'padding:7px 9px;border-radius:6px;background:#f4f7fa;font-size:10px">事实层评价：'+view.factLabel+' · '+view.evidence+(nature?' · '+nature:'')+'</div>'+
    (summary&&summary!==view.reason?'<p style="margin:8px 0">'+escapeChainText(summary)+'</p>':'')+
    groups.filter(function(group){return group.rows.length;}).map(function(group){return '<section class="chain-finding-group '+group.key+'"><strong style="display:block;margin-top:10px;color:#425d76">'+group.label+'</strong>'+group.rows.map(chainAssessmentFindingHtml).join('')+'</section>';}).join('')+
    (sources.length?'<section style="margin-top:10px"><strong>节点原文与来源</strong>'+sources.map(function(row){var published=chainAssessmentDate(row.date,false),retrieved=chainAssessmentDate(row.retrieved,true);return '<div style="padding:9px 0;border-top:1px solid #e3e9ee;overflow-wrap:anywhere">'+(row.title?'<strong>'+escapeChainText(row.title)+'</strong>':'')+(row.quote?'<blockquote style="margin:6px 0;padding-left:8px;border-left:2px solid #c6d2dd;white-space:pre-wrap">'+escapeChainText(row.quote)+'</blockquote>':'')+'<div style="font-size:10px;color:#8697a7">发布：'+escapeChainText(published||'日期未知')+(retrieved?' · '+(row.archived?'原文归档：':'检索：')+escapeChainText(retrieved)+'（本地）':'')+'</div>'+row.urls.map(function(url){return '<a href="'+escapeChainText(url)+'" target="_blank" rel="noopener noreferrer">打开原文来源</a>';}).join(' · ')+'</div>';}).join('')+'</section>':'')+
    (!findings.length&&!sources.length?'<p>暂无可展示的研判原句，请结合原文来源继续核对。</p>':'')+
    (checks.length?'<strong>后续核查与补证</strong><ul style="padding-left:18px;margin:5px 0">'+checks.map(function(text){return '<li>'+escapeChainText(text)+'</li>';}).join('')+'</ul>':'')+'</div></details>';
}

function chainAssessmentPanel(value,nodes,unclassifiedCount){
  var view=chainAssessmentView(value),counts={strong:0,mid:0,weak:0,unknown:0};nodes.forEach(function(node){counts[chainAssessmentView(node.assessment).level]++;});
  var dimensions=[{key:'supply',label:'本地供给'},{key:'dependency',label:'外部依赖'},{key:'capacity',label:'研发与产能'},{key:'coordination',label:'产业协同'}],received=value&&Array.isArray(value.dimensions)?value.dimensions:[];
  var distribution=(view.actual?[['weak','明显薄弱'],['mid','存在短板'],['strong','已有支撑'],['unknown','尚不能评价']]:[['weak','优先补链'],['mid','重点培育'],['strong','已有基础'],['unknown','待研判']]).map(function(item){return '<span class="chain-priority-count is-'+item[0]+'" style="display:inline-flex;gap:5px;align-items:center;font-size:11px;white-space:nowrap">'+item[1]+' <b style="font-size:13px">'+counts[item[0]]+'</b></span>';}).join('');
  var criteria='<details class="chain-assessment-criteria" style="flex:1 1 220px;min-width:0;margin-top:8px;font-size:11px;color:#687f92;line-height:1.75"><summary style="cursor:pointer;font-weight:600">三色研判口径</summary><div style="margin-top:7px;max-height:320px;overflow:auto"><ul style="padding-left:17px;margin:0"><li><strong>优先补链（红）</strong>：优先处理的补链方向，需结合依据核实约束与对接条件。</li><li><strong>重点培育（黄）</strong>：规划培育或行业风险的关注建议，不代表已确认现实缺口或中等能力。</li><li><strong>已有基础（绿）</strong>：已有能力或支撑线索，建议巩固拓展，不代表完整成熟或无风险。</li><li><strong>待研判（灰）</strong>：尚未形成有效研判，不等于薄弱，不强行归入三色。</li></ul><p style="margin:8px 0 0">三色为研判建议，非百分制，不按来源数量评分；规划与行业背景不计作已确认的本地短板。事实评价与证据质量见研判依据。</p></div></details>';
  var four='<details class="chain-factual-dimensions" style="flex:1 1 220px;min-width:0;margin-top:8px;font-size:11px;color:#687f92;line-height:1.75"><summary style="cursor:pointer;font-weight:600">四维事实评价</summary><div class="chain-assessment-dimensions" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:8px;margin-top:8px">'+dimensions.map(function(expected){var d=received.find(function(item){return item&&item.key===expected.key;}),v=d&&value&&value.contract==='chain-assessment-v1'&&value.state==='ready'?chainAssessmentView({contract:'chain-assessment-v1',state:'ready',level:d.level,evidence_strength:d.evidence_strength}):chainAssessmentView(null),label=d&&typeof d.label==='string'?d.label:expected.label;return '<div class="chain-assessment-dimension" data-dimension="'+expected.key+'" style="background:#fff;padding:9px;border:1px solid #e3eaf0;border-radius:7px"><div style="font-size:10px;color:#7a8e9f">'+escapeChainText(label)+'</div><div style="font-size:11px;margin-top:5px">'+v.factLabel+'</div><small style="color:#8a9ba9">'+v.evidence+'</small></div>';}).join('')+'</div></details>';
  if(view.actual)criteria='<details class="chain-assessment-criteria" style="margin-top:8px;font-size:11px;color:#687f92;line-height:1.75"><summary>实际薄弱程度口径</summary><p>绿色：已有真实生产、交付或在用支撑。黄色：存在已披露的具体短板或验证限制。红色：关键依赖或交付能力受到明显制约。灰色：尚不足以比较实际能力。</p><p>评价须给出具体依据和比较基准；政策支持、企业注册地址和未检索到供应商均不用于单独判色。行业共性与关联企业风险单独标注，不当作全区统一水平。</p></details>';
  var details=chainAssessmentDetails(value);
  return '<section class="chain-assessment-panel chain-priority-panel" style="margin:0 16px 14px;padding:13px 16px;border:1px solid #dfe8ef;border-radius:10px;background:#f8fbfd"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><strong style="font-size:14px;color:#294b63">'+(view.actual?'实际薄弱程度':'补链研判')+' <small style="font-size:10px;color:#8799a8;font-weight:400">'+(view.actual?'按实际能力与约束评价':'建议优先级')+'</small></strong><div>'+(view.actual&&value.judgment.status==='summary'?'逐环节评价':chainAssessmentBadge(value))+'</div></div>'+
    (view.reason?'<p class="chain-priority-reason" style="font-size:12px;line-height:1.75;color:#506d84;margin:8px 0 9px">'+escapeChainText(view.reason)+'</p>':'')+
    '<div class="chain-assessment-distribution" style="display:flex;flex-wrap:wrap;gap:8px 17px;margin-top:8px">'+distribution+'<span style="font-size:10px;color:#93a1ad">本次 '+nodes.length+' 个材料节点'+(unclassifiedCount?'（含待归类 '+unclassifiedCount+' 项）':'')+'</span></div>'+
    '<div style="font-size:10px;color:#8a9aa7;margin-top:7px">'+(view.actual?'政策提及不参与主颜色。评价范围、比较基准、原文与相反证据见各节点详情。':'黄色表示规划培育或行业风险关注，不代表已确认本地缺口。引用材料对应时间及证据质量见详情。')+'</div>'+
    ((!view.judgment||nodes.some(function(node){return !chainAssessmentView(node.assessment).judgment;}))?'<p style="font-size:10px;color:#7b8e9e;margin:8px 0 0">部分节点仍需补充深入研判。 <button class="chain-assessment-update" onclick="requestChainGeneration()" style="font-size:10px;padding:3px 7px;border:1px solid #d2dee7;border-radius:5px;color:#607f96;background:#fff">更新研判</button></p>':'')+
    '<div class="chain-assessment-explain" style="display:flex;flex-wrap:wrap;gap:0 17px;align-items:flex-start">'+(details?'<div style="flex:1 1 220px;min-width:0">'+details+'</div>':'')+criteria+(view.actual?'':four)+'</div></section>';
}

function chainNeedsAssessment(nodes,value){
  return !chainAssessmentView(value).judgment||nodes.some(function(node){return !chainAssessmentView(node.assessment).judgment;});
}

function chainNodeCardHtml(node){
  var view=chainAssessmentView(node.assessment),policyContext=view.actual&&node.assessment.judgment.policy_context&&node.assessment.judgment.policy_context.length,basisTags={local_gap:'本地短板',local_capability:'本地基础',local_plan:'规划培育',industry_risk:'行业风险'};
  var nature=view.reasoning?view.basisLabel:view.judgment&&Object.prototype.hasOwnProperty.call(basisTags,view.basis)?basisTags[view.basis]:'';
  var classification=node.classification&&typeof node.classification==='object'?node.classification:{},reason=classification.why||classification.reason;
  var exceptionReason=reason&&!/按通用.*口径分类/.test(reason)?reason:'';
  return '<div class="industry-chain-node judgment-'+view.level+'" style="align-self:start;min-width:0;background:'+view.card+';border:1px solid '+view.border+';border-top:3px solid '+view.border+';border-radius:9px;padding:13px 12px;text-align:left;overflow-wrap:anywhere">'+
    '<div class="chain-node-name" style="font-size:13px;font-weight:700;line-height:1.6;color:#304e68">'+escapeChainText(node.name||'未命名材料项')+'</div>'+
    '<div class="chain-assessment-tags" style="margin-top:7px;display:flex;flex-wrap:wrap;gap:5px">'+chainAssessmentBadge(node.assessment)+'</div>'+
    (view.reason?'<p class="chain-node-judgment-reason" title="'+escapeChainText(view.reason)+'" style="font-size:11px;color:#5c7589;line-height:1.7;margin:8px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">'+escapeChainText(view.reason)+'</p>':'')+
    (view.action?'<p class="chain-node-action" style="font-size:10px;color:#60798b;line-height:1.7;margin:6px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden"><b>建议：</b>'+escapeChainText(view.action)+'</p>':'')+
    (policyContext?'<div style="font-size:10px;color:#7c8b9b;margin-top:6px">另有政策规划材料 · 不参与判色</div>':'')+
    (nature?'<div class="chain-material-status" style="font-size:10px;color:#8d9ca9;margin-top:7px">'+nature+'</div>':'')+
    (exceptionReason?'<div style="font-size:10px;color:#8799a8;margin-top:7px">分组说明：'+escapeChainText(exceptionReason)+'</div>':'')+
    chainAssessmentDetails(node.assessment,node)+chainNodeSourcesHtml(node)+'</div>';
}

function _renderRichChain(topic, segments, recs, p, unclassified, status, evidence){
  unclassified=Array.isArray(unclassified)?unclassified:[];evidence=evidence||{};
  var nodes=[];segments.forEach(function(segment){nodes=nodes.concat(segment.nodes||[]);});nodes=nodes.concat(unclassified);
  var taxonomy=evidence.taxonomy&&typeof evidence.taxonomy==='object'?evidence.taxonomy:{};
  var h='<section class="industry-chain" style="margin-top:16px;border:1px solid #dfe7ee;border-radius:12px;overflow:hidden;background:#fff">'+
    '<div class="industry-chain-head" style="padding:16px 18px;display:flex;gap:12px;flex-wrap:wrap;border-bottom:1px solid #e2e8f0"><div><div style="font-weight:700;color:#325675">'+escapeChainText(topic)+' 产业链图谱</div>'+
    '<div style="font-size:11px;color:#64748b;margin-top:5px">'+escapeChainText(taxonomy.label||'产业环节资料分组')+'；并列展示，不代表已证实的供应或工序连接。</div></div></div>';
  if(!nodes.length)status='empty';
  else if(unclassified.length||segments.some(function(segment){return !(segment.nodes||[]).length;})||(evidence.coverage&&evidence.coverage.status==='partial'))status='partial';
  var notice=status==='empty'?'当前材料不足以形成有来源的环节图谱。请补充材料后重试；不能据此判断现实中不存在相关产业。':status==='partial'?'本次仅能整理部分环节，其余材料仍待补充或分类。':'';
  h+='<details class="industry-chain-notice" style="padding:8px 18px;margin:0;color:#8798a6;font-size:10px;line-height:1.8"><summary style="cursor:pointer">图谱范围与分类口径</summary><p style="margin:5px 0">本次资料中的代表环节，非完整行业清单。内容未独立核实；规划不代表已落地，分类不代表本地能力。'+(notice?'<br>'+notice:'')+(taxonomy.description?'<br>分类口径：'+escapeChainText(taxonomy.description):'')+'</p></details>';
  h+=chainAssessmentPanel(evidence.assessment,nodes,unclassified.length);
  var actual=chainAssessmentView(evidence.assessment).actual;
  if(actual){
    segments=segments.map(function(segment){return Object.assign({},segment,{nodes:(segment.nodes||[]).slice().sort(function(a,b){var ranks={weak:0,mid:1,strong:2,unknown:3};return ranks[chainAssessmentView(a.assessment).level]-ranks[chainAssessmentView(b.assessment).level];})});});
    if(nodes.some(function(node){return chainAssessmentView(node.assessment).level==='unknown';}))h+='<p style="margin:0 18px 10px;font-size:11px;color:#60798b">已归类的待核节点保留在对应泳道，以灰色显示；尚不能评价不等于薄弱，也不能据此推断现实缺失。</p>';
  }
  h+='<div class="industry-chain-body" style="padding:16px;display:flex;flex-direction:column;gap:14px;background:#f8fafc">';
  ['上游','中游','下游'].forEach(function(name){var segment=segments.find(function(item){return item.seg===name;})||{nodes:[]};
    h+='<div class="industry-chain-row" style="display:flex;gap:12px;align-items:stretch"><div class="industry-chain-label" style="align-self:flex-start;min-height:76px;width:44px;flex-shrink:0;padding:10px 3px;border:1px solid #dfe7ee;border-radius:7px;display:flex;align-items:center;justify-content:center"><span style="writing-mode:vertical-rl;font-size:12px;opacity:1;letter-spacing:3px">'+name+'</span></div><div class="industry-chain-nodes" style="flex:1;min-width:0;display:grid;align-items:start;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">'+
      ((segment.nodes||[]).length?segment.nodes.map(chainNodeCardHtml).join(''):'<div style="padding:18px;border:1px dashed #cbd5e1;border-radius:8px;font-size:12px;color:#64748b">资料待补：当前材料不足以说明该分组的环节，不能据此判断不存在。</div>')+'</div></div>';
  });
  if(unclassified.length)h+='<section class="industry-chain-unclassified" style="padding:14px;border:1px dashed #cbd5e1;border-radius:8px"><strong style="font-size:13px">尚未分类的材料项</strong><p style="font-size:12px;color:#64748b">现有材料不足以确定其产业环节，保留原文供核对。</p><div style="display:grid;align-items:start;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">'+unclassified.map(chainNodeCardHtml).join('')+'</div></section>';
  return h+'</div></section>';
}

/* Presentation only: layout and assessment share the same immutable evidence. */
var CHAIN_EXPLORER_UI=Object.create(null);
var CHAIN_OPEN_DRAWER=null;
function chainLayoutText(value){return typeof value==='string'?value.trim():'';}
function chainLayoutContains(text,part){return !!chainLayoutText(part)&&chainLayoutText(text).replace(/\s+/g,'').includes(chainLayoutText(part).replace(/\s+/g,''));}
function chainLayoutReviewedPremises(node){
  var view=chainAssessmentView(node.assessment),j=node.assessment&&node.assessment.judgment;
  if(!view.actual||!j||j.status!=='assessed'||view.level==='unknown')return [];
  return (Array.isArray(j.premises)?j.premises:[]).filter(function(p){
    if(!p||!p.source||!chainLayoutText(p.evidence_id)||p.source.id!==p.evidence_id||!Array.isArray(j.evidence_ids)||j.evidence_ids.indexOf(p.evidence_id)<0)return false;
    var rows=chainNodeSources({sources:[p.source]});
    return rows.length&&rows[0].urls.length&&chainLayoutText(rows[0].quote)&&chainLayoutText(p.statement)&&chainLayoutContains(rows[0].quote,p.statement)&&(!p.quote||chainLayoutContains(rows[0].quote,p.quote));
  });
}
function chainLayoutInfo(node){
  var original=chainNodeSources(node),premises=chainLayoutReviewedPremises(node),view=chainAssessmentView(node.assessment),j=node.assessment&&node.assessment.judgment;
  var assessed=!!(view.actual&&j&&j.status==='assessed'&&view.level!=='unknown'),rows=original.slice();
  premises.forEach(function(p){rows=rows.concat(chainNodeSources({sources:[p.source]}));});
  var seen=Object.create(null);
  rows=rows.filter(function(row){var key=JSON.stringify([row.id,row.urls,row.quote]);if(!row.urls.length||!chainLayoutText(row.quote)||seen[key])return false;seen[key]=true;return true;});
  var roles=['operation','maturity','dependency','constraint','industry_fact','enterprise_capability','benchmark'];
  var facts=premises.filter(function(p){return roles.indexOf(p.role)>=0&&chainLayoutContains(p.statement,node.name);}).slice().sort(function(a,b){return roles.indexOf(a.role)-roles.indexOf(b.role);});
  var companies=[],companySeen=Object.create(null);
  (assessed&&Array.isArray(j.enterprise_links)?j.enterprise_links:[]).forEach(function(link){
    if(!link||!chainLayoutText(link.company_subject)||companySeen[link.company_subject])return;
    var identityUrl=chainSafeSourceUrl(link.identity_url),businessUrl=chainSafeSourceUrl(link.business_url);if(!identityUrl||!businessUrl)return;
    var identity=premises.find(function(p){return p.evidence_id===link.presence_evidence_id&&['local_presence','local_affiliation'].indexOf(p.role)>=0&&p.subject===link.company_subject&&chainLayoutContains(p.source.quote,link.company_subject)&&chainSafeSourceUrl(p.source.url)===identityUrl;});
    var business=facts.find(function(p){return p.evidence_id===link.capability_evidence_id&&chainSafeSourceUrl(p.source.url)===businessUrl;});
    if(!identity||!business)return;
    companySeen[link.company_subject]=true;companies.push(link.company_subject);
  });
  var material=premises.filter(function(p){return roles.indexOf(p.role)>=0&&chainLayoutContains(p.source.quote,node.name);}).slice().sort(function(a,b){return roles.indexOf(a.role)-roles.indexOf(b.role);});
  var statement=(Array.isArray(node.facts)?node.facts:[]).find(function(f){return f&&f.kind==='source_statement'&&f.scope==='source_statement_only'&&chainLayoutContains(f.statement,node.name)&&rows.some(function(row){return row.id===f.evidence_id&&chainLayoutContains(row.quote,f.statement);});});
  var chosen=facts[0]||material[0],source=chosen?chainNodeSources({sources:[chosen.source]})[0]:statement?rows.find(function(row){return row.id===statement.evidence_id&&chainLayoutContains(row.quote,statement.statement);}):rows[0];
  var excerpt=chosen?(chainLayoutContains(chosen.statement,node.name)?chosen.statement:chosen.source.quote):statement?statement.statement:source?source.quote:'';
  // A saved level alone is not enough: a reviewed premise must resolve to
  // its original source and name this node in that source.
  assessed=assessed&&!!(facts.length||material.length);
  var label=assessed?'已有现状依据':node.negated?'含否定表述':node.status==='planned'?'含规划线索':rows.length?'已收录材料':'来源尚不完整';
  var scope=assessed?({local:'本地环节 / 应用',local_enterprise:'关联企业业务 · 不代表本地产能',industry_shared:'行业共同约束 · 非本地独有'}[j.scope]||'适用范围见依据'):'材料范围待核';
  var rawLabel=node.negated?'原始材料含否定或排除表述':node.status==='planned'?'原始材料含规划表述':node.status==='reported'?'原始材料为披露记录':'原始材料属性待核';
  return {assessed:assessed,ratingLevel:assessed?view.level:'unknown',ratingLabel:assessed?view.label:'尚不能评价',label:label,scope:scope,count:rows.length,rows:rows,original:original,companies:companies,excerpt:excerpt,date:source?chainAssessmentDate(source.date,false):'',rawLabel:rawLabel};
}
function chainExplorerKey(topic,p,evidence){
  return JSON.stringify([p&&p.id||typeof cur==='string'&&cur||'',topic,evidence.runId||evidence.generatedAt||'']);
}
function setChainExplorerMode(button,mode){
  if(mode!=='layout'&&mode!=='assessment')return;
  var root=button.closest('.chain-explorer');if(!root)return;
  var drawer=root._chainDrawer||root.querySelector('.chain-node-drawer');if(drawer&&!drawer.hidden)closeChainLayoutNode(drawer,false);
  var key=root.getAttribute('data-chain-key');if(key)CHAIN_EXPLORER_UI[key]=mode;
  root.setAttribute('data-chain-mode',mode);
  root.querySelectorAll('[data-chain-panel]').forEach(function(panel){panel.hidden=panel.getAttribute('data-chain-panel')!==mode;});
  root.querySelectorAll('[data-chain-mode-button]').forEach(function(tab){var active=tab.getAttribute('data-chain-mode-button')===mode;tab.classList.toggle('is-active',active);tab.setAttribute('aria-pressed',active?'true':'false');});
}
function openChainLayoutNode(button,index){
  var root=button.closest('.chain-explorer');if(!root||!/^\d+$/.test(String(index))||typeof document==='undefined'||!document.body)return;
  var template=root.querySelector('template[data-chain-detail="'+index+'"]'),drawer=root._chainDrawer||root.querySelector('.chain-node-drawer');
  if(!template||!drawer)return;
  if(CHAIN_OPEN_DRAWER)closeChainLayoutNode(CHAIN_OPEN_DRAWER,false);
  var content=drawer.querySelector('.chain-node-drawer-content');content.innerHTML=template.innerHTML;content.scrollTop=0;
  drawer._chainRoot=root;drawer._chainReturnFocus=button;root._chainDrawer=drawer;CHAIN_OPEN_DRAWER=drawer;
  // A body-level portal keeps fixed positioning outside transformed report containers.
  document.body.appendChild(drawer);drawer.hidden=false;
  button.setAttribute('aria-expanded','true');button.classList.add('is-selected');
  if(typeof MutationObserver!=='undefined'){
    drawer._chainObserver=new MutationObserver(function(){
      if(root.isConnected===false||button.isConnected===false)closeChainLayoutNode(drawer,false);
    });
    drawer._chainObserver.observe(document.body,{childList:true,subtree:true});
  }
  drawer.querySelector('button').focus();
}
function closeChainLayoutNode(button,restoreFocus){
  var drawer=button&&button.closest('.chain-node-drawer');if(!drawer)return;
  if(drawer._chainObserver){drawer._chainObserver.disconnect();drawer._chainObserver=null;}
  drawer.hidden=true;var trigger=drawer._chainReturnFocus,root=drawer._chainRoot;
  drawer._chainReturnFocus=null;drawer._chainRoot=null;
  if(CHAIN_OPEN_DRAWER===drawer)CHAIN_OPEN_DRAWER=null;
  if(root&&root._chainDrawer===drawer)root._chainDrawer=null;
  if(root){
    if(root.isConnected!==false&&trigger&&trigger.isConnected!==false)root.appendChild(drawer);
    else drawer.remove();
  }
  if(trigger){trigger.setAttribute('aria-expanded','false');trigger.classList.remove('is-selected');if(restoreFocus!==false&&trigger.isConnected!==false)trigger.focus();}
}
function chainLayoutExcerpt(text,name){
  if(typeof text!=='string'||!chainLayoutText(name))return '';
  var start=text.indexOf(name),end=start+name.length;
  if(start<0){
    // Only typography equivalence: retain source spelling and its original offsets.
    function fold(value){
      var out='',offset=0,starts=[],ends=[];
      for(var point of value){
        var normalized=point.normalize('NFKC').toLowerCase();
        for(var i=0;i<normalized.length;i++)if(!/\s/.test(normalized[i])){out+=normalized[i];starts.push(offset);ends.push(offset+point.length);}
        offset+=point.length;
      }
      return {text:out,starts:starts,ends:ends};
    }
    var source=fold(text),target=fold(name).text,index=target?source.text.indexOf(target):-1;
    if(index<0)return '';
    start=source.starts[index];end=source.ends[index+target.length-1];
  }
  var left=Math.max(0,start-16),right=Math.min(text.length,Math.max(left+96,end+28));
  return (left?'…':'')+text.slice(left,right)+(right<text.length?'…':'');
}
function chainLayoutNodeHtml(node,index){
  if(!chainLayoutText(node.name))return '';
  var info=chainLayoutInfo(node),excerpt=chainLayoutExcerpt(info.excerpt,node.name);
  return '<button type="button" class="chain-layout-node'+(info.assessed?'':' is-sparse')+'" data-chain-rating="'+info.ratingLevel+'" onclick="openChainLayoutNode(this,'+index+')" aria-haspopup="dialog" aria-expanded="false" aria-label="查看'+escapeChainText(node.name)+'的依据，薄弱评价：'+info.ratingLabel+'">'+
    '<span class="chain-layout-node-heading"><span class="chain-layout-node-name">'+escapeChainText(node.name)+'</span><span class="chain-layout-rating">'+info.ratingLabel+'</span></span>'+
    (info.companies.length?'<span class="chain-layout-entity">关联企业：'+info.companies.map(escapeChainText).join('、')+'</span>':'')+
    (excerpt?'<span class="chain-layout-node-summary"><span class="chain-layout-quote-label">'+(excerpt===info.excerpt?'原文':'原文节选')+'</span>'+escapeChainText(excerpt)+'</span>':'')+
    '<span class="chain-layout-fact-meta"><span>'+escapeChainText(info.scope)+'</span>'+(info.date?'<span>资料日期 '+escapeChainText(info.date)+'</span>':'')+'</span>'+
    '<span class="chain-layout-node-foot"><span class="chain-layout-status">'+info.label+'</span><span class="chain-layout-evidence">'+(info.count?'原文片段 '+info.count+' 条':'查看材料状态')+' <span aria-hidden="true">↗</span></span></span></button>';
}
function chainLayoutSourceHtml(row){
  var published=chainAssessmentDate(row.date,false),retrieved=chainAssessmentDate(row.retrieved,true);
  var location=[];if(row.pdfPage)location.push('PDF 页码：'+row.pdfPage);if(row.quoteRange)location.push('摘录范围：'+row.quoteRange);
  if(row.fulltextScope)location.push('归档范围：'+(row.fulltextScope==='entire_html_visible_text'?'网页可见正文':row.fulltextScope));
  return '<article class="chain-layout-source">'+(row.title?'<h4>'+escapeChainText(row.title)+'</h4>':'')+
    '<blockquote>'+escapeChainText(row.quote)+'</blockquote><p class="chain-layout-source-meta">'+(published?'发布：'+escapeChainText(published):'发布日期未提供')+(retrieved?' · '+(row.archived?'归档：':'检索：')+escapeChainText(retrieved):'')+'</p>'+
    (location.length?'<p class="chain-layout-source-meta">'+location.map(escapeChainText).join(' · ')+'</p>':'')+
    row.urls.map(function(url){return '<a href="'+escapeChainText(url)+'" target="_blank" rel="noopener noreferrer">打开原文来源</a>';}).join(' · ')+'</article>';
}
function chainLayoutDetailHtml(node,index){
  var info=chainLayoutInfo(node),j=node.assessment&&node.assessment.judgment,missing=j&&Array.isArray(j.missing)?j.missing:[];
  var description=info.assessed?'已有资料支持此处列出的有限判断，适用地域和时间以原文为准。':'材料收录状态不代表已落地；尚不能据此判断该环节强弱或现实中不存在。';
  var incomplete=info.original.filter(function(row){return !row.urls.length||!chainLayoutText(row.quote);});
  return '<template data-chain-detail="'+index+'"><div class="chain-detail-eyebrow">环节与依据</div><h3>'+escapeChainText(node.name)+'</h3>'+
    (info.companies.length?'<p class="chain-layout-entity">关联企业：'+info.companies.map(escapeChainText).join('、')+'</p>':'')+
    '<div class="chain-detail-status">'+info.label+' · '+escapeChainText(info.scope)+'</div><p>'+description+'</p><p class="chain-layout-source-meta">'+info.rawLabel+(Array.isArray(node.qualifiers)&&node.qualifiers.length?'；原文限定：'+node.qualifiers.map(escapeChainText).join('、'):'')+'</p>'+
    '<section class="chain-layout-originals"><h4>原文与来源</h4>'+(info.rows.length?info.rows.map(chainLayoutSourceHtml).join(''):'<p>尚无同时包含有效链接和原句的来源，不能据此判断产业缺失。</p>')+'</section>'+
    (incomplete.length?'<details class="chain-layout-incomplete"><summary>来源不完整的材料片段（'+incomplete.length+'）</summary>'+incomplete.map(function(row){return '<p>'+escapeChainText(row.quote||'此记录未提供原句。')+'</p>';}).join('')+'</details>':'')+
    (missing.length?'<h4>还需补充</h4><ul>'+missing.map(function(s){return '<li>'+escapeChainText(s)+'</li>';}).join('')+'</ul>':'')+
    chainAssessmentDetails(node.assessment,node)+'</template>';
}
function chainLayoutMetaHtml(evidence,status,count,unclassifiedCount){
  var coverage=evidence.coverage&&typeof evidence.coverage==='object'?evidence.coverage:{},taxonomy=evidence.taxonomy&&typeof evidence.taxonomy==='object'?evidence.taxonomy:{};
  var partial=status==='partial'||coverage.status==='partial'||unclassifiedCount>0;
  var label=!count?'尚未形成节点':partial?'部分材料已归类':'已整理本次材料';
  var generation=evidence.generation&&typeof evidence.generation==='object'?evidence.generation:{};
  var sourceOnly=generation.mode==='source_only';
  var record=evidence.nodeResearch&&typeof evidence.nodeResearch==='object'?evidence.nodeResearch:null;
  var supplement=record&&(chainLayoutText(record.status)||(Array.isArray(record.batches)&&record.batches.length)||(Array.isArray(record.errors)&&record.errors.length))?record:null;
  var errors=supplement&&Array.isArray(supplement.errors)?supplement.errors:[];
  var batches=supplement&&Array.isArray(supplement.batches)?supplement.batches:[];
  var unfinished=batches.filter(function(batch){return batch&&!batch.legacy_summary&&typeof batch.status==='string'&&batch.status!=='ready';}).length;
  var incomplete=supplement&&(supplement.status!=='ready'||errors.length||unfinished);
  var research={ready:supplement?'基础检索完成':'本轮检索完成',pending:'本轮检索不完整',partial:'本轮检索不完整',failed:'本轮检索未完成',unavailable:'本轮检索未完成'}[evidence.researchStatus]||'检索状态未记录';
  var supplementLabel=supplement?(incomplete?'补充核验未完整':'补充核验完成'):'';
  if(supplement&&supplement.status==='scope_mismatch')supplementLabel+='（材料范围不一致）';
  var errorMessages=errors.map(function(error){return typeof error==='string'?error:error&&typeof error.message==='string'?error.message:error&&typeof error.code==='string'?error.code:'';}).filter(Boolean);
  var time=typeof evidence.generatedAt==='number'?new Date(evidence.generatedAt):null;
  var date=time&&Number.isFinite(time.getTime())?chainAssessmentDate(time.toISOString(),true):'';
  return '<div class="chain-layout-context"><div class="chain-layout-context-row"><strong>'+label+'</strong><span>'+research+'</span>'+(supplementLabel?'<span>'+supplementLabel+'</span>':'')+(unfinished?'<span>未完成 '+unfinished+' 组</span>':'')+(errors.length?'<span>错误记录 '+errors.length+' 条</span>':'')+(date?'<span>图谱生成：'+escapeChainText(date)+'</span>':'')+'</div>'+
    (sourceOnly?'<p class="chain-source-only">本次仅按可追溯的归档原文整理环节；公开调研或模型整理未完成，未作新的强弱评价。</p>':'')+
    '<p>范围：当前方向、本次取得的材料；不是完整产业清单，不能据此推断现实缺失。</p>'+
    (chainLayoutText(taxonomy.description)?'<p>分类口径'+(chainLayoutText(taxonomy.label)?'（'+escapeChainText(taxonomy.label)+'）':'')+'：'+escapeChainText(taxonomy.description)+'</p>':'')+
    (chainLayoutText(coverage.meaning)?'<p>'+escapeChainText(coverage.meaning)+'</p>':'')+(errorMessages.length?'<details class="chain-layout-research-errors"><summary>查看补充核验记录</summary><ul>'+errorMessages.map(function(message){return '<li>'+escapeChainText(message)+'</li>';}).join('')+'</ul></details>':'')+'</div>';
}
function chainExplorerHtml(topic,segments,recs,p,unclassified,status,evidence){
  evidence=evidence||{};unclassified=(Array.isArray(unclassified)?unclassified:[]).filter(function(n){return n&&chainLayoutText(n.name);});
  segments=(Array.isArray(segments)?segments:[]).map(function(s){return {seg:s.seg,nodes:(Array.isArray(s.nodes)?s.nodes:[]).filter(function(n){return n&&chainLayoutText(n.name);})};});
  var nodes=[];segments.forEach(function(s){nodes=nodes.concat(s.nodes);});nodes=nodes.concat(unclassified);
  var withOriginal=nodes.filter(function(n){return chainLayoutInfo(n).count>0;}).length,assessed=nodes.filter(function(n){return chainLayoutInfo(n).assessed;}).length;
  var key=chainExplorerKey(topic,p,evidence),mode=CHAIN_EXPLORER_UI[key]==='assessment'?'assessment':'layout',index=0,templates=[];
  function card(n){var id=index++;templates.push(chainLayoutDetailHtml(n,id));return chainLayoutNodeHtml(n,id);}
  var lanes=['上游','中游','下游'].map(function(name,i){var group=segments.find(function(s){return s.seg===name;})||{nodes:[]};
    return '<section class="industry-chain-row"><div class="chain-lane-heading"><span class="chain-lane-index">0'+(i+1)+'</span><h3>'+name+'</h3><span class="chain-lane-total">'+group.nodes.length+' 个环节</span></div><div class="industry-chain-nodes">'+(group.nodes.length?group.nodes.map(card).join(''):'<div class="chain-layout-empty">本次材料未形成该组节点；不代表实际不存在。</div>')+'</div></section>';
  }).join('');
  var other=unclassified.length?'<details class="chain-layout-other"><summary>待归类材料 <span>'+unclassified.length+' 项</span></summary><p>暂不放入上中下游；原文及分类依据保留供核对。</p><div class="industry-chain-nodes">'+unclassified.map(card).join('')+'</div></details>':'';
  var metric=function(value,label){return '<div class="chain-overview-metric"><strong>'+value+'</strong><span>'+label+'</span></div>';};
  return '<section class="chain-explorer" data-chain-key="'+escapeChainText(key)+'" data-chain-mode="'+mode+'" aria-label="产业链布局与评价">'+
    '<div class="chain-explorer-toolbar"><div class="chain-explorer-title"><span>INDUSTRY LANDSCAPE</span><h2>'+escapeChainText(topic)+'<small>产业链图谱</small></h2><p>查看有出处的环节记录，评价与原文分开展示。</p></div><div class="chain-view-switch" aria-label="图谱视图"><button type="button" class="'+(mode==='layout'?'is-active':'')+'" data-chain-mode-button="layout" aria-pressed="'+(mode==='layout')+'" onclick="setChainExplorerMode(this,\'layout\')">产业布局</button><button type="button" class="'+(mode==='assessment'?'is-active':'')+'" data-chain-mode-button="assessment" aria-pressed="'+(mode==='assessment')+'" onclick="setChainExplorerMode(this,\'assessment\')">薄弱评价</button></div></div>'+
    '<div class="chain-overview-metrics">'+metric(nodes.length,'已整理环节 / 线索')+metric(withOriginal,'有原文的节点')+metric(assessed,'具备评价依据')+metric(unclassified.length,'产业位置待确认')+'</div>'+
    chainLayoutMetaHtml(evidence,status,nodes.length,unclassified.length)+
    '<div class="chain-explorer-layout" data-chain-panel="layout"'+(mode==='layout'?'':' hidden')+'><div class="chain-layout-caption"><span>按产业环节组织材料 · 色条与标签表示薄弱评价</span><span>并列展示，不表示已证实的供货关系</span></div><div class="industry-chain-body">'+lanes+'</div>'+other+'</div>'+
    '<div class="chain-explorer-assessment" data-chain-panel="assessment"'+(mode==='assessment'?'':' hidden')+'>'+_renderRichChain(topic,segments,recs,p,unclassified,status,evidence)+'</div>'+
    templates.join('')+'<aside class="chain-node-drawer" role="dialog" aria-label="环节详情与原文依据" hidden onkeydown="if(event.key===\'Escape\')closeChainLayoutNode(this)"><div class="chain-node-drawer-header"><span>资料与判断分开展示</span><button type="button" class="chain-node-drawer-close" aria-label="关闭环节详情" onclick="closeChainLayoutNode(this)">×</button></div><div class="chain-node-drawer-content"></div></aside></section>';
}

function chainGenerationStatusHtml(job){
  return job?'<div class="chain-generation-status" role="status" aria-live="polite" aria-busy="true"><span data-chain-status-message>'+escapeChainText(job.message||'正在生成产业链图谱…')+'</span><button disabled>生成中…</button></div>':'';
}

function chainMapHtml(p){
  if(!p)return '';
  var topic=p.topic||'',rs=REPORTSTATE[cur]||{},job=_chainGenInFlight[(cur||'')+'|'+topic];
  var progressHtml=chainGenerationStatusHtml(job);
  var chain=currentEvidenceChain(topic,cur),error=(rs.chainErrorByTopic||{})[topic];
  var errorHtml=error?'<p role="alert" style="color:#92400e;font-size:12px">'+escapeChainText(error)+'</p>':'';
  if(Array.isArray(chain)){var metadata=(rs.chainEvidenceByTopic||{})[topic]||{},allNodes=[];chain.forEach(function(segment){allNodes=allNodes.concat(segment.nodes||[]);});allNodes=allNodes.concat((rs.chainUnclassifiedByTopic||{})[topic]||[]);return progressHtml+errorHtml+(typeof chainExplorerHtml==='function'?chainExplorerHtml:_renderRichChain)(topic,chain,null,p,(rs.chainUnclassifiedByTopic||{})[topic],(rs.chainStatusByTopic||{})[topic],metadata)+'<div style="text-align:right;padding:10px 0"><button class="chain-generate-button" onclick="requestChainGeneration()">'+(chainNeedsAssessment(allNodes,metadata.assessment)?'更新图谱并评价':['empty','partial'].indexOf((rs.chainStatusByTopic||{})[topic])>=0?'补充材料后重新生成':'重新生成图谱')+'</button></div>'; }
  var text=typeof reportTextForTopic==='function'?reportTextForTopic(topic):'',short=!text||text.trim().length<100;
  var legacy=!!((rs.chainByTopic||{})[topic]||(rs.chainEvidenceByTopic||{})[topic]),failed=(rs.chainStatusByTopic||{})[topic]==='failed';
  if(job&&!Array.isArray(chain))return progressHtml+errorHtml;
  return '<div style="margin-top:16px;padding:20px;border:1px dashed #cbd5e1;border-radius:12px;background:#f8fafc;color:#64748b;font-size:12px;line-height:1.8">'+errorHtml+
    '<strong>'+escapeChainText(topic)+'</strong> · '+(legacy?'材料或图谱版本已变化，请重新生成。':'尚未生成基于当前材料的图谱。')+
    '<p>依据本次公开原文检索及保存材料背景整理；计划与材料披露均不代表已经落地，没有证据的连接不会绘制。</p>'+
    (short?'<p>当前报告正文不足 100 字，请先完善当前方向报告。</p>':'<button class="chain-generate-button" onclick="requestChainGeneration()">'+(legacy?'重新生成图谱':error||failed?'重试生成图谱':'生成产业链图谱')+'</button>')+'</div>';
}

function chainPriorityMarkdown(){
  var p=P(), segments=p?currentEvidenceChain(p.topic,cur):null;
  if(!segments)return '';
  var labels={weak:'缺口',mid:'培育',strong:'优势',unknown:'待核'}, rows=[];
  segments.forEach(function(seg){(seg.nodes||[]).forEach(function(nd){
    rows.push('| '+(rows.length+1)+' | '+String(nd.name||'').replace(/\|/g,'／')+' | '+(nd.assessment?chainAssessmentView(nd.assessment).label:(labels[nd.level]||'待核'))+' | '+(nd.benchmark||[]).join('、').replace(/\|/g,'／')+' |');
  });});
  return '## 产业链材料研判（独立视图，不替代报告正文）\n\n| 序号 | 环节 | 研判 | 对标材料 |\n|---|---|---|---|\n'+rows.join('\n');
}

function industrySavedReportHtml(p){
  var state=REPORTSTATE[cur]||{},text=(state.aiReportByTopic||{})[p.topic]||(state.topic===p.topic?state.text:'')||'';
  var chain=typeof text==='string'&&text.trim().length>=100?'<div id="chainMapBlock">'+chainMapHtml(p)+'</div>':'';
  return reportHtml(p)+chain+'<div id="actionItemsBlock">'+restoreActionItems()+'</div>'+restoreConfirmPanel();
}

function alignChainToReport(text){
  // Keep the delivered report immutable. A later diagram is a separate view.
  return text;
}

function reportHtml(p){
  var rs=REPORTSTATE[cur]; if(!rs) return '';
  var r=kbReadiness();

  return '<div class="industry-report" style="border-radius:14px;border:1.5px solid #e8edf5;overflow:hidden;margin-bottom:8px">'+
    '<div class="industry-report-head" style="padding:12px 16px;background:#f8faff;border-bottom:1px solid #e8edf5;display:flex;align-items:center;gap:8px">'+
      '<span class="industry-report-title" style="font-size:12px;font-weight:650;color:#1a56db">'+(topicHasFullReport(p.topic)?'完整产业报告':'初步研判草稿')+'</span>'+
      '<span class="industry-report-topic" style="font-size:11.5px;color:#4a5568">'+escapeChainText(p.topic)+'</span>'+
      '<span class="industry-report-score" style="margin-left:auto;font-size:11px;color:'+(topicScore(p.topic)>=80?'#22c55e':'#f59e0b')+'">'+topicScoreDisplay(p.topic)+'</span>'+
      '<button onclick="downloadReport(\'full\')" style="padding:4px 10px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:12px;color:#1a56db;cursor:pointer;font-weight:600;margin-left:6px">⬇ 下载</button>'+
    '</div>'+
    '<div class="industry-prose" style="padding:16px 18px;font-size:13px;color:#1e293b;line-height:1.8">'+
      // 按方向取报告正文：项目级 rs.text 是单例，切到未生成报告的新方向会串显旧方向正文
      reportMdToHtml(alignChainToReport((typeof reportTextForTopic==='function'?reportTextForTopic(p.topic):null)||''))+
    '</div>'+
    (typeof reportResearchSourcesHtml==='function'?reportResearchSourcesHtml(p):'')+
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
  var epoch=typeof _authEpoch==='number'?_authEpoch:null,requestId=p.reportRequestId||'';
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
  return fetch('/api/kb-chat',{
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
    var target=PROJECTS[key];
    if(!target||target.city!==city||(target.reportRequestId||'')!==requestId||(epoch!==null&&epoch!==_authEpoch))return;
    txt = txt || '';
    var m=txt.match(/\{[\s\S]*\}/);
    if(!m) return;
    var data; try{ data=JSON.parse(m[0]); }catch(e){ return; }
    var list=(data.topics||[]).filter(function(t){return t&&t.label;}).map(function(t){
      return {label:String(t.label).trim(), icon:t.icon||'📌', type:t.type||'补链', desc:t.desc||'', fromAi:true};
    });
    if(!list.length) return;
    // 保留用户自定义方向（custom:true），不被AI刷新覆盖
    list=list.filter(function(t){return (target.deletedTopics||[]).indexOf(t.label)<0;});
    var _prevList=(target.aiTopics&&target.aiTopics.list)||[];
    var _customTopics=_prevList.filter(function(t){return t.custom;});
    _customTopics.forEach(function(ct){
      var dup=list.some(function(t){return t.label===ct.label;});
      if(!dup) list.push(ct);
    });
    target.aiTopics={list:list, ts:Date.now()};
    persist();
    if(cur===key&&view==='report' && !window._reportGenerating) render();
  }).catch(function(e){
    console.warn('ensureAiTopics failed:', e && e.message);
  }).finally(function(){
    _aiTopicsGenerating[key]=false;
  });
}

/* 正则兜底方向推荐（AI 未就绪时用）：按关键词匹配 RAG 文本 */
function generateTopicsFromKb(p){
  if(!p)return [];
  var stored=p.aiTopics&&Array.isArray(p.aiTopics.list)?p.aiTopics.list:[];
  var custom=Array.isArray(p.customTopics)?p.customTopics:[],deleted=Array.isArray(p.deletedTopics)?p.deletedTopics:[],seen=Object.create(null),topics=[];
  function add(value,isCustom){
    var row=typeof value==='string'?{label:value}:value;
    if(!row||typeof row.label!=='string')return;
    var label=row.label.trim();if(!label||seen[label]||deleted.indexOf(label)>=0)return;
    seen[label]=true;topics.push({label:label,icon:typeof row.icon==='string'?row.icon:(isCustom?'📌':'📊'),type:isCustom?'custom':typeof row.type==='string'?row.type:'saved',desc:isCustom?'自定义方向':typeof row.desc==='string'?row.desc:''});
  }
  stored.forEach(function(row){add(row,false);});custom.forEach(function(row){add(row,true);});
  // Retain an explicitly saved current topic; never invent a city's industries.
  if(!topics.length&&typeof p.topic==='string')add(p.topic,false);
  return topics;
}


function homePage(p){
  var r=kbReadiness();
  var running=reportJobForTopic(cur,p.topic);

  // ── 可靠性横幅 ──
  var reliabilityBanner=
    '<div class="industry-readiness" style="display:flex;align-items:center;gap:12px;padding:12px 18px;background:'+(r.score>=80?'#f0fdf4':'#fffbeb')+';border-bottom:1px solid '+(r.score>=80?'#86efac':'#fde68a')+'">'+
      '<div style="flex:1;min-width:0">'+
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'+
          '<span style="font-size:12px;font-weight:650;color:'+(r.score>=80?'#166534':'#92400e')+'">从城市智库继承数据</span>'+
          '<span style="font-size:11px;color:'+(r.score>=80?'#22c55e':'#f59e0b')+';font-weight:700">'+r.score+'%</span>'+
          '<span style="font-size:11px;color:'+(r.score>=80?'#22c55e':'#f59e0b')+'">'+r.label+'</span>'+
          '<span title="仅表示材料覆盖与流程准备情况，不代表事实正确率。补充原始材料，并逐条核实待确认事项。" style="font-size:11px;color:#9aa5b5;cursor:help;text-decoration:underline dotted;margin-left:4px">ⓘ 如何提升</span>'+
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
    '<div class="industry-topics" style="padding:0 0 20px">'+
      '<div class="industry-section-caption" style="font-size:12px;font-weight:650;color:#4a5568;margin-bottom:10px;letter-spacing:.3px">选择产业分析方向</div>'+
      '<div id="topicCardGrid" class="industry-topic-grid" style="display:flex;gap:10px;margin-bottom:12px">'+topicCards+'</div>'+
      '<div class="industry-custom-topic" style="display:flex;align-items:center;gap:8px">'+
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
      (running
        ? '<div class="industry-report is-generating" style="border-radius:16px;border:1.5px solid #fed7aa;overflow:hidden;margin-bottom:8px">'+
            '<div style="padding:14px 18px;background:linear-gradient(135deg,#fffbeb,#fef3c7);border-bottom:1px solid #fde68a;display:flex;align-items:center;gap:10px">'+
              '<div style="width:18px;height:18px;border:2.5px solid #e2e8f0;border-top-color:#f59e0b;border-radius:50%;animation:spin 1s linear infinite"></div>'+
              '<div id="reportRunStatus" style="font-size:13px;font-weight:700;color:#92400e">'+escapeChainText(running.message||'正在生成…')+'</div>'+
            '</div>'+
            '<div id="reportContent" class="industry-prose" style="padding:20px 22px;font-size:13px;color:#1e293b;line-height:1.85;min-height:80px">'+topicReportMarkup(running.text||'')+'</div>'+
          '</div>'
        : (REPORTSTATE[cur]&&REPORTSTATE[cur].phaseByTopic&&REPORTSTATE[cur].phaseByTopic[p.topic]===2)
        ? industrySavedReportHtml(p)
        : (REPORTSTATE[cur]&&REPORTSTATE[cur].text)||(PENDING_CONFIRMS[cur]&&PENDING_CONFIRMS[cur].length)||(REPORTSTATE[cur]&&p&&_findPendingForTopic(REPORTSTATE[cur],p.topic).length)
        ? industrySavedReportHtml(p)
        : '<div class="industry-empty" style="text-align:center;padding:48px 20px">'+
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




  return '<div class="page industry-page">'+
    '<header class="industry-header"><div><span class="industry-kicker">INDUSTRY RESEARCH</span><h1 class="industry-heading">产业分析</h1><p>以城市智库为基础，梳理产业方向与招引机会</p></div><div class="industry-header-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></div></header>'+
    reliabilityBanner+
    '<div id="industryRunHost">'+reportRunBanner(p)+'</div>'+
    '<div class="conversation-scroll industry-scroll" style="padding:16px 22px 0">'+
      topicSelector+
      reportArea+
    '</div>'+
    // 底部行动栏（替代 composer）—— 内容按当前方向渲染，切换方向时同步刷新
    '<div class="report-bottom-bar industry-bottom-bar" style="border-top:1px solid #f0f4ff;background:#fff;padding:12px 22px;display:flex;gap:10px;align-items:center">'+
      reportBottomBarInner(p)+
    '</div>'+
  '</div>';
}

/* 底部行动栏内容（按当前方向 topic 判断）。抽成函数，供初次渲染与切换方向时复用刷新。 */
function reportBottomBarInner(p){
  var running=typeof reportJobForTopic==='function'?reportJobForTopic(cur,p.topic):null;
  if(running)return '<div class="industry-bottom-progress" role="status"><span class="industry-run-spinner" aria-hidden="true"></span><span id="industryBottomRunMessage">'+escapeChainText(running.message||'正在生成当前方向报告…')+'</span></div><button disabled aria-busy="true">'+(running.phase===2?'完整报告生成中…':'初步草稿生成中…')+'</button>';
  var _hasFull = topicHasFullReport(p.topic);
  // 检测该方向是否已完成草稿(phase1)但尚未生成完整报告
  var _hasDraft = !_hasFull && REPORTSTATE[cur] && REPORTSTATE[cur].phaseByTopic && REPORTSTATE[cur].phaseByTopic[p.topic]===1;
  var _rs=REPORTSTATE[cur]||{}, _partial=(_rs.partialByTopic||{})[p.topic];
  var _partialNote=_partial?'<div role="status" style="color:#92400e">上次生成未完成，正式报告未覆盖。<button onclick="viewPartialReport()">查看未完成内容</button></div>':'';
  if(_hasDraft){
    var _gate=fullReportConfirmation(cur,p.topic);
    if(!_gate.ready) return _partialNote+'<div style="flex:1;color:#92400e">'+_gate.message+'</div><button disabled>完成确认后生成完整报告</button><button onclick="startAiInterview()">重新生成草稿</button>';
    return _partialNote+'<div style="flex:1;font-size:12.5px;color:#92400e;background:#fffbeb;padding:10px 14px;border-radius:10px;border:1px solid #fde68a;line-height:1.6">待确认事项已完成，可生成完整五章报告</div>'+
      '<button onclick="triggerReport(2)" style="padding:12px 20px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:13.5px;font-weight:650;cursor:pointer;white-space:nowrap">生成完整产业报告 \u2192</button>'+
      '<button onclick="doUpload()" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">\ud83d\udcce 补充材料</button>';
  }
  return _partialNote+(_hasFull
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
    (_hasFull?reportDemandActionButton(p):'');
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
          '<div style="flex:1;font-size:13px;font-weight:600;color:#1e293b;word-break:break-all;line-height:1.4">'+_authEscape(u.name)+'</div>'+
          '<button onclick="delMemFile(\''+(u._pk||cur)+'\',\''+encodeURIComponent(u.name)+'\','+(u.ts||0)+')" title="删除该文件记忆" style="background:none;border:none;color:#cbd5e1;font-size:14px;cursor:pointer;padding:0 2px;line-height:1;flex-shrink:0" onmouseover="this.style.color=\'#dc2626\'" onmouseout="this.style.color=\'#cbd5e1\'">\u2715</button>'+
        '</div>'+
        '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-top:6px">'+
          pill+
          (uploadOriginalUrl(u._pk||cur,u)?'<a href="'+uploadOriginalUrl(u._pk||cur,u)+'" download style="font-size:11px">下载原件</a>':'<span style="font-size:11px;color:#8492a6">历史原件未保存</span>')+
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
/* City knowledge workbench: independent navigation, conversation and source panes. */
function kbDraftQuestion(question){
  var ta=document.getElementById('composerTa');
  if(!ta)return;
  if(ta.value.trim()&&ta.value.trim()!==question.trim()) ta.value+='\n'+question;
  else ta.value=question;
  kbClosePanels();ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);
}
function kbTogglePanel(name){
  var page=document.getElementById('kbWorkspace');if(!page)return;
  if(name==='sources'&&window.matchMedia('(min-width:1121px)').matches){
    var hidden=page.classList.toggle('kb-sources-hidden');
    var control=document.getElementById('kbToggle-sources');if(control){control.setAttribute('aria-expanded',String(!hidden));control.focus();}
    return;
  }
  var cls=name==='topics'?'kb-topics-open':'kb-sources-open';
  var open=!page.classList.contains(cls);
  page.classList.remove('kb-topics-open','kb-sources-open');
  if(open)page.classList.add(cls);
  ['topics','sources'].forEach(function(kind){var b=document.getElementById('kbToggle-'+kind);if(b)b.setAttribute('aria-expanded',String(open&&kind===name));});
  var closer=document.getElementById(name==='topics'?'kbTopicsClose':'kbSourcesClose');
  if(open&&closer)closer.focus();
  else {var trigger=document.getElementById('kbToggle-'+name);if(trigger)trigger.focus();}
}
function kbShowSourcesPanel(){
  var page=document.getElementById('kbWorkspace');if(!page)return;
  page.classList.remove('kb-sources-hidden','kb-topics-open');
  if(!window.matchMedia('(min-width:1121px)').matches)page.classList.add('kb-sources-open');
  var control=document.getElementById('kbToggle-sources');if(control)control.setAttribute('aria-expanded','true');
  var topics=document.getElementById('kbToggle-topics');if(topics)topics.setAttribute('aria-expanded','false');
}
function kbClosePanels(){
  var page=document.getElementById('kbWorkspace');if(!page)return;
  var kind=page.classList.contains('kb-topics-open')?'topics':(page.classList.contains('kb-sources-open')?'sources':'');
  page.classList.remove('kb-topics-open','kb-sources-open');
  ['topics','sources'].forEach(function(k){var b=document.getElementById('kbToggle-'+k);if(b)b.setAttribute('aria-expanded','false');});
  var sourceToggle=document.getElementById('kbToggle-sources');if(sourceToggle&&window.matchMedia('(min-width:1121px)').matches)sourceToggle.setAttribute('aria-expanded',String(!page.classList.contains('kb-sources-hidden')));
  if(kind){var trigger=document.getElementById('kbToggle-'+kind);if(trigger)trigger.focus();}
}
function kbWorkspaceSessionsHtml(){
  var st=typeof kbEnsureStore==='function'&&cur?kbEnsureStore(cur):null;
  if(!st||!st.sessions.length)return '<p class="kb-nav-empty">新建对话后，会自动保存在这里。</p>';
  return st.sessions.slice().sort(function(a,b){return (b.ts||0)-(a.ts||0);}).slice(0,8).map(function(session){
    var count=(session.messages||[]).filter(function(m){return m.role==='user';}).length;
    var code=_authEscape(JSON.stringify(session.id));
    return '<button type="button" class="kb-session-item'+(st.activeId===session.id?' active':'')+'" aria-current="'+(st.activeId===session.id?'true':'false')+'" onclick="kbSwitchSession('+code+');kbClosePanels()">'+
      '<span>'+_authEscape(session.title||'新对话')+'</span><small>'+count+' 轮</small></button>';
  }).join('');
}
function kbWorkspaceRefresh(){
  var page=document.getElementById('kbWorkspace'),control=document.getElementById('kbToggle-sources');
  kbBindOverviewScroll(page);
  if(page&&control)control.setAttribute('aria-expanded',String(window.matchMedia('(min-width:1121px)').matches?!page.classList.contains('kb-sources-hidden'):page.classList.contains('kb-sources-open')));
  var list=document.getElementById('kbWorkspaceSessions');if(list)list.innerHTML=kbWorkspaceSessionsHtml();
  var st=typeof kbEnsureStore==='function'&&cur?kbEnsureStore(cur):null;
  var session=st&&(st.sessions||[]).find(function(x){return x.id===st.activeId;});
  var messages=session&&session.messages||[];
  var welcome=document.getElementById('kbWelcome');
  if(welcome)welcome.hidden=messages.some(function(m){return m.role==='user'||m.role==='ai'||m.role==='assistant';});
}
// Respond to reading gestures, never to streaming/replay or layout-generated scrolls.
function kbSetOverviewCollapsed(page,collapsed,manual){
  if(!page)return false;
  var cards=page.querySelector('#kbOverviewCards'),toggle=page.querySelector('#kbOverviewToggle');
  if(!cards||!toggle)return false;
  collapsed=!!collapsed;
  if(collapsed&&!manual&&cards.contains(document.activeElement))return false;
  if(page.classList.contains('kb-overview-collapsed')===collapsed)return false;
  page.classList.toggle('kb-overview-collapsed',collapsed);
  page._kbOverviewIgnoreScrollUntil=Date.now()+320;
  cards.inert=collapsed;cards.setAttribute('aria-hidden',String(collapsed));
  toggle.setAttribute('aria-expanded',String(!collapsed));
  toggle.textContent=collapsed?'展开板块 ↓':'收起板块 ↑';
  return true;
}
function kbToggleOverview(){
  var page=document.getElementById('kbWorkspace');
  if(page)kbSetOverviewCollapsed(page,!page.classList.contains('kb-overview-collapsed'),true);
}
function kbBindOverviewScroll(page){
  if(!page||page._kbOverviewScrollBound)return;
  page._kbOverviewScrollBound=true;
  var distance=0,lastAt=0,touch=null,drag=null;
  function allowed(target,keyboard){
    var node=target&&target.nodeType===3?target.parentElement:target;
    if(!node||!node.closest)return true;
    var excluded='input,textarea,select,[contenteditable]:not([contenteditable="false"]),#kbTopicsPanel,#kbSourcesPanel,.kb-panel-backdrop';
    if(keyboard)excluded+=',button,a,summary,[role="button"]';
    return !node.closest(excluded);
  }
  function move(delta){
    if(!Number.isFinite(delta)||!delta)return;
    var now=Date.now();
    if(now-lastAt>240||distance*delta<0)distance=0;
    lastAt=now;distance+=delta;
    if(Math.abs(distance)<48)return;
    kbSetOverviewCollapsed(page,distance>0,false);distance=0;
  }
  page.addEventListener('wheel',function(e){
    if(e.ctrlKey||!allowed(e.target,false)||Math.abs(e.deltaX||0)>Math.abs(e.deltaY||0))return;
    var scale=e.deltaMode===1?16:(e.deltaMode===2?page.clientHeight:1);
    move(e.deltaY*scale);
  },{passive:true});
  page.addEventListener('touchstart',function(e){
    distance=0;
    touch=e.touches&&e.touches.length===1&&allowed(e.target,false)?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null;
  },{passive:true});
  page.addEventListener('touchmove',function(e){
    if(!touch||!e.touches||e.touches.length!==1){touch=null;return;}
    var point=e.touches[0],dx=touch.x-point.clientX,dy=touch.y-point.clientY;
    touch={x:point.clientX,y:point.clientY};
    if(Math.abs(dx)>Math.abs(dy))return;
    move(dy);
  },{passive:true});
  ['touchend','touchcancel'].forEach(function(type){page.addEventListener(type,function(){touch=null;distance=0;},{passive:true});});
  page.addEventListener('keydown',function(e){
    if(e.altKey||e.ctrlKey||e.metaKey||!allowed(e.target,true))return;
    var direct={PageDown:true,End:true,PageUp:false,Home:false};
    if(Object.prototype.hasOwnProperty.call(direct,e.key))kbSetOverviewCollapsed(page,direct[e.key],false);
    else if(e.key===' ')kbSetOverviewCollapsed(page,!e.shiftKey,false);
    else if(e.key==='ArrowDown'||e.key==='ArrowUp')move(e.key==='ArrowDown'?24:-24);
  });
  // Native scrollbar drags have a pointer intent; unrelated scroll events do not.
  function endDrag(){
    drag=null;distance=0;
    document.removeEventListener('pointerup',endDrag);
    document.removeEventListener('pointercancel',endDrag);
  }
  page.addEventListener('pointerdown',function(e){
    var node=e.target;
    if((node!==page&&node!==page.querySelector('#kbScroll'))||e.button!==0)return;
    var rect=node.getBoundingClientRect();
    if(e.clientX<rect.right-18||e.clientX>rect.right||node.scrollHeight<=node.clientHeight)return;
    endDrag();drag={node:node,top:node.scrollTop};
    document.addEventListener('pointerup',endDrag);
    document.addEventListener('pointercancel',endDrag);
  });
  page.addEventListener('scroll',function(e){
    if(!drag||e.target!==drag.node)return;
    var top=drag.node.scrollTop,delta=top-drag.top;drag.top=top;
    if(Date.now()<(page._kbOverviewIgnoreScrollUntil||0))return;
    move(delta);
  },{passive:true,capture:true});
}
function kbPage(p){
  var escape=_authEscape;
  var topicDescriptions={
    '主导产业与产业链':'看清产业结构、关键环节与补链方向',
    '园区与承载条件':'了解园区分工、空间载体与项目承接条件',
    '链主与存量企业':'梳理重点企业、上下游关系与配套需求',
    '政策、规划与领导关注':'查阅政策支持、发展规划与重点关注事项'
  };
  var topics=(p.kb||[]).map(function(k,i){
    return '<article class="kb-topic-card" data-kb-topic="'+i+'">'+
      '<button type="button" class="kb-topic-material" onclick="kbClosePanels();kbDetail('+i+')" aria-label="查看'+escape(k.t)+'资料">'+
      '<span class="kb-topic-number" aria-hidden="true">'+String(i+1).padStart(2,'0')+'</span><span class="kb-topic-title">'+escape(k.t)+'</span>'+
      '<p>'+escape(topicDescriptions[k.t]||'查阅本板块已有资料与补充材料')+'</p><span class="kb-topic-read">查看资料 <span aria-hidden="true">↗</span></span></button>'+
      '<button type="button" class="kb-topic-question" onclick="askAboutKb('+i+')" aria-label="围绕'+escape(k.t)+'提问">围绕此板块提问 <span aria-hidden="true">→</span></button></article>';
  }).join('');
  return '<div class="page kb-workspace" id="kbWorkspace" tabindex="0" aria-label="城市智库工作区">'+
    '<header class="kb-workbench-header"><div class="kb-heading"><span class="eyebrow">'+escape(p.city)+' · CITY INTELLIGENCE</span><h1>城市智库</h1></div>'+
    '<nav class="kb-toolbar" aria-label="智库工具"><button type="button" id="kbToggle-topics" class="kb-nav-toggle" aria-controls="kbTopicsPanel" aria-expanded="false" onclick="kbTogglePanel(\'topics\')">历史对话</button>'+
    '<button type="button" onclick="uploadHint()">上传材料</button><button type="button" onclick="openMemoryBank()">记忆库</button><button type="button" onclick="showDownloadReport()">下载报告</button>'+
    '<button type="button" id="kbToggle-sources" class="kb-source-toggle" aria-controls="kbSourcesPanel" aria-expanded="false" onclick="kbTogglePanel(\'sources\')">回答依据</button></nav></header>'+
    '<section class="kb-topic-overview" aria-labelledby="kbOverviewTitle"><div class="kb-overview-heading"><div><h2 id="kbOverviewTitle">城市知识全景</h2><p>从重点板块查阅资料，围绕具体问题深入分析。</p></div><div class="kb-overview-actions"><button type="button" class="kb-overview-toggle" id="kbOverviewToggle" aria-controls="kbOverviewCards" aria-expanded="true" onclick="kbToggleOverview()">收起板块 ↑</button><button type="button" class="kb-global-scope" onclick="clearKbActiveTopic();kbClosePanels()">全库提问 <span aria-hidden="true">↗</span></button></div></div><div id="kbOverviewCards" class="kb-overview-body" aria-hidden="false"><div class="kb-overview-clip"><div class="kb-topic-grid">'+topics+'</div></div></div></section>'+
    '<div class="kb-workbench-grid"><button class="kb-panel-backdrop" aria-label="关闭侧栏" onclick="kbClosePanels()"></button>'+
    '<aside id="kbTopicsPanel" class="kb-topics-panel" aria-label="历史会话"><div class="kb-pane-heading"><h2>历史对话</h2><button id="kbTopicsClose" class="kb-panel-close" type="button" onclick="kbClosePanels()" aria-label="关闭历史对话">×</button></div>'+
    '<button type="button" class="kb-new-conversation" onclick="kbNewSession(cur);kbClosePanels()"><span aria-hidden="true">＋</span> 新对话</button>'+
    '<section class="kb-nav-section kb-recent"><div class="kb-section-heading"><h3>最近对话</h3><button type="button" onclick="kbClosePanels();openKbHistory()">全部</button></div><div id="kbWorkspaceSessions">'+kbWorkspaceSessionsHtml()+'</div></section>'+
    '</aside>'+
    '<section class="kb-chat-panel" aria-label="城市智库对话"><div id="kbSessionBar"></div>'+
    '<div class="knowledge-scroll" id="kbScroll" onscroll="kbToggleTopBtn()"><section id="kbWelcome" class="kb-welcome">'+
    '<h2>围绕城市资料，继续深入分析</h2><p>选择上方板块提问，或直接输入你关心的问题。</p></section>'+
    '<div id="kbConvWrap"><div id="kbConv" role="log" aria-label="问答记录" aria-live="polite"></div></div></div>'+kbComposer()+
    '<button type="button" id="kbTopBtn" onclick="kbScrollTop()" title="回到对话顶部" aria-label="回到对话顶部">↑</button></section>'+
    '<aside id="kbSourcesPanel" class="kb-sources-panel" aria-label="当前回答的依据"><div class="kb-pane-heading"><h2 id="kbSourcesTitle">回答依据</h2><button id="kbSourcesClose" class="kb-panel-close" type="button" onclick="kbTogglePanel(\'sources\')" aria-label="关闭回答依据">×</button></div>'+
    '<p class="kb-source-intro">只列出当前回答送入模型的材料。来源链接供你回到原文核实。</p><div id="kbSourcesList"><div class="kb-sources-empty"><span aria-hidden="true">▤</span><strong>随回答查看依据</strong><p>发送问题后，这里会展示本次参考的片段与已有出处。</p></div></div></aside></div></div>';
}
function settingsPage(p){
  return '<div class="page">'+
    '<div class="page-header"><div><span class="eyebrow">PERSONALIZATION</span><h1>个人与提醒设置</h1>'+
    '<p>调整个性化范围，但不改变确认关口与资源核验责任。</p></div></div>'+
    '<div class="settings-scroll">'+authWorkspaceBlock('settings-section')+
    '<div class="settings-section"><h2>账号身份（由系统开通，不可修改）</h2>'+
      '<div class="form-grid">'+
      '<label>所属单位<input value="'+_authEscape(p.org)+'" disabled></label>'+
      '<label>姓名 / 角色<input value="'+_authEscape(p.who)+' / 招商干部" disabled></label>'+
      '<label>所属地区<input value="'+_authEscape(p.city)+'" disabled></label>'+
      '<label>数据权限<input value="仅限 '+_authEscape(p.city)+' 城市智库" disabled></label></div>'+
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
