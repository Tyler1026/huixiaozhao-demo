/* ===== 每秒轻量刷新：只更新计时文字，不重绘整页 ===== */
setInterval(function(){
  var r=(REPORT_REQUESTS||[]).find(function(x){return x.status==='running';});
  if(!r) return;
  var el=document.getElementById('rrElapsed');
  if(el){
    // 正式运行时间 = 服务端累计 activeMs + 距最近一次上报的实时增量（仅当上报未断流时）
    var liveDelta=r.progressTs?Math.max(0,Math.min(Date.now()-r.progressTs,6*60000)):0;
    var ms=(r.activeMs!=null)?(r.activeMs+liveDelta):(Date.now()-(r.claimTs||r.ts));
    var s=Math.floor(ms/1000)%60,m=Math.floor(ms/60000)%60,h=Math.floor(ms/3600000);
    el.textContent='有效运行 '+(h?h+':':'')+('0'+m).slice(-2)+':'+('0'+s).slice(-2);
  }
  var up=document.getElementById('rrLastUpd');
  if(up&&r.progressTs){
    var sec=Math.floor((Date.now()-r.progressTs)/1000);
    up.textContent=(sec<60?sec+' 秒前更新':Math.floor(sec/60)+' 分钟前更新');
  }
},1000);
function rrElapsed(ms){
  var m=Math.floor(ms/60000);
  return m<1?'刚刚':m<60?m+' 分钟':Math.floor(m/60)+' 小时 '+(m%60)+' 分';
}
function rrTimeSplit(r){
  // 三口径：active=有效运行（产出在推进）/ stall=空转（在线但停滞）/ gap=断点（睡眠离线）
  var liveDelta=r.progressTs?Math.max(0,Math.min(Date.now()-r.progressTs,6*60000)):0;
  var act=(r.activeMs!=null)?(r.activeMs+(r.pendingIdleMs||0)+liveDelta):(Date.now()-(r.claimTs||r.ts));
  return {active:rrElapsed(act), activeMs:act,
          stall:(r.stallMs?rrElapsed(r.stallMs):null),
          gap:(r.gapMs?rrElapsed(r.gapMs):null), gapCount:r.gapCount||0};
}
// 专员归属阶段（按 activity.id 分组到 6 个研判阶段）
var RR_STAGE_OF={economic_profiler:0,population_profiler:0,transport_land_profiler:0,life_support_profiler:0,industry_analyst:0,competition_scout:0,policy_researcher:0,
  chain_mapper:1,enterprise_hunter_1:2,enterprise_hunter_2:2,enterprise_hunter_3:2,fact_checker:3,scoring_engine:4,action_planner:4,compact_writer:5};
function rrSpecialistCard(f){
  var st=f.state;
  var dot=st==='delivered'?'#0aa696':st==='working'?'#0757ad':st==='partial'?'#c85b09':'#b0bac7';
  var badge=st==='delivered'?'<span style="color:#0aa696">已交付</span>':
            st==='working'?'<span style="color:#0757ad">工作中<span class="rr-runner"></span></span>':
            st==='partial'?'<span style="color:#c85b09">补充中</span>':
            '<span style="color:#b0bac7">待命</span>';
  var pct=f.min?Math.min(100,Math.round((f.lines||0)/f.min*100)):0;
  var barCol=st==='delivered'?'#0aa696':st==='partial'?'#c85b09':'#0757ad';
  var mini=(st==='queued')?'':'<div style="height:3px;border-radius:2px;background:#eef1f5;margin-top:4px;overflow:hidden"><div class="'+(st==='working'?'rr-bar-live':'')+'" style="height:100%;width:'+pct+'%;background:'+barCol+'"></div></div>';
  // 数据来源 下拉框（点击浮出，按可靠度从高到低）
  var srcTab='';
  var srcs=f.sources||[];
  if(srcs.length){
    var ok='__rrSrc_'+f.id;
    var isOpen=window[ok];
    var menu=isOpen?('<div style="position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:50;'+
        'background:#fff;border:1px solid #cdd9e8;border-radius:9px;box-shadow:0 10px 28px rgba(11,31,65,.16);'+
        'padding:8px 10px;max-height:240px;overflow:auto">'+
        '<div style="font-size:10px;color:#8492a6;margin-bottom:6px">按数据可靠度从高到低</div>'+
        srcs.map(rrSrcRow).join('')+'</div>'):'';
    srcTab='<div style="margin-top:6px;border-top:1px dashed #edf1f6;padding-top:5px"><div style="position:relative">'+
      '<button onclick="event.stopPropagation();rrToggleSrc(\''+f.id+'\')" '+
        'style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:6px;'+
        'border:1px solid '+(isOpen?'#91b7e2':'#dce4ef')+';background:'+(isOpen?'#f3f8ff':'#fff')+';'+
        'border-radius:7px;color:#0757ad;font-size:10.5px;cursor:pointer;padding:5px 9px">'+
        '<span>📚 数据来源 · '+srcs.length+' 项</span><span style="color:#8aa0bd">'+(isOpen?'▲':'▼')+'</span></button>'+
      menu+'</div></div>';
  }
  return '<div style="padding:7px 9px;border:1px solid #eef2f7;border-radius:8px;background:'+(st==='working'?'#f6faff':'#fff')+'">'+
    '<div style="display:flex;align-items:center;gap:7px">'+
      '<span style="font-size:15px;position:relative">'+f.avatar+'<span class="'+(st==='working'?'rr-dot-live':'')+'" style="position:absolute;right:-2px;bottom:-1px;width:6px;height:6px;border-radius:50%;background:'+dot+';border:1.5px solid #fff"></span></span>'+
      '<b style="font-size:12px;color:#0b183b">'+f.name+'</b>'+
      '<span style="font-size:10.5px;margin-left:auto">'+badge+'</span></div>'+
    '<div style="font-size:11px;color:#667590;margin-top:3px;line-height:1.5">'+String(f.action||'').replace(/</g,'&lt;')+'</div>'+mini+srcTab+'</div>';
}
function rrToggleSrc(id){
  var key='__rrSrc_'+id;
  var cur=window[key];
  Object.keys(window).forEach(function(k){ if(k.indexOf('__rrSrc_')===0) window[k]=false; });
  window[key]=!cur;
  render();
}
function rrSrcRow(s){
  var tierMap={1:['#0aa696','权威'],2:['#0757ad','官方'],3:['#c07a12','媒体'],4:['#8492a6','行业'],5:['#9aa5b5','其他']};
  var tm=tierMap[s.tier]||tierMap[5];
  var name=s.url?('<a href="'+s.url+'" target="_blank" style="color:#0757ad;text-decoration:none">'+String(s.name)+' ↗</a>'):String(s.name);
  return '<div style="display:flex;align-items:center;gap:8px;font-size:11px;padding:7px 8px;border-radius:7px;border-bottom:1px solid #f2f5f9" '+
    'onmouseover="this.style.background=\'#f6faff\'" onmouseout="this.style.background=\'transparent\'">'+
    '<span style="flex:0 0 auto;min-width:34px;text-align:center;padding:2px 7px;border-radius:9px;color:#fff;background:'+tm[0]+';font-size:9.5px;font-weight:600">'+tm[1]+'</span>'+
    '<span style="color:#7a8798;flex:0 0 auto;min-width:56px">'+s.type+'</span>'+
    '<span style="color:#40506a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">'+name+'</span></div>';
}
function rrWaveRows(r){
  if(!r.waves||!r.waves.length) return '';
  var open=window.__rrWaveOpen&&window.__rrWaveOpen[r.id];
  var act=r.activity||[];
  // 按阶段分组专员
  var byStage={};
  act.forEach(function(f){var s=RR_STAGE_OF[f.id];if(s==null)return;(byStage[s]=byStage[s]||[]).push(f);});
  var rows=r.waves.map(function(w,wi){
    var ic=w.state==='done'?'✅':w.state==='running'?'<span class="rr-spin" style="width:11px;height:11px"></span>':'⚪';
    var col=w.state==='done'?'#0aa696':w.state==='running'?'#0757ad':'#9aa5b5';
    // 优先用专员卡片；无 activity 时回退到原章节芯片
    var body='';
    var specs=byStage[wi];
    if(specs&&specs.length){
      body='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px;margin:6px 0 2px 24px">'+
        specs.map(rrSpecialistCard).join('')+'</div>';
    } else if(w.state!=='waiting'){
      body='<div style="display:flex;flex-wrap:wrap;gap:5px;margin:4px 0 2px 24px">'+
        w.files.map(function(f){
          var fs=f.fstate||(f.done?'done':'missing');
          var sty,mark;
          if(fs==='done'){sty='background:#e4f5f3;color:#006d70';mark='✓ ';}
          else if(fs==='partial'){sty='background:#fdeef0;color:#b0364a;cursor:help';mark='⚠ ';}
          else {sty='background:#eef1f5;color:#8492a6';mark='· ';}
          var tip=f.detail?' title="'+String(f.detail).replace(/"/g,'&quot;')+'"':'';
          return '<span'+tip+' style="font-size:10.5px;padding:2px 8px;border-radius:9px;'+sty+'">'+mark+f.n+'</span>';
        }).join('')+'</div>';
    }
    return '<div style="padding:6px 0;border-bottom:1px dashed #e9eef5">'+
      '<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:'+col+'">'+
      '<span style="display:inline-flex;align-items:center">'+ic+'</span><b>'+w.label+'</b>'+
      '<span style="color:#8492a6;font-weight:400">'+w.done+'/'+w.total+'</span>'+
      (w.state==='running'?'<span style="color:#0757ad;font-size:11px">· 进行中<span class="rr-runner"></span></span>':w.state==='waiting'?'<span style="font-size:11px;color:#b0bac7">· 等待前序完成</span>':'')+'</div>'+body+'</div>';
  }).join('');
  var liveN=act.filter(function(f){return f.state==='working';}).length;
  var doneN=act.filter(function(f){return f.state==='delivered';}).length;
  var summary=act.length?('　<span style="font-size:11px;color:#8492a6">AI 招商团队 '+act.length+' 名专员 · '+doneN+' 已交付 · '+liveN+' 工作中</span>'):'';
  // 阶段进度条（第X/共6阶段），与政府端口径统一
  var stageBar='';
  var sTot=r.stageTotal||r.waves.length, sCur=r.stageCur||1, sDone=r.stageDone||0;
  if(sTot){
    var STLABEL=['基础数据采集','产业链测绘','目标企业挖掘','数据交叉核验','匹配评分与计划','决策报告生成'];
    stageBar='<div style="margin:8px 0 4px"><div style="display:flex;gap:4px">'+
      Array.from({length:sTot}).map(function(_,i){
        var st=i<sDone?'#0aa696':(i===sCur-1?'#0757ad':'#e0e7f0');
        return '<div style="flex:1;height:5px;border-radius:3px;background:'+st+'"></div>';
      }).join('')+'</div>'+
      '<div style="font-size:11px;color:#667590;margin-top:4px">第 '+sCur+' / '+sTot+' 阶段 · '+(r.stageName||STLABEL[Math.min(sCur-1,STLABEL.length-1)]||'')+'</div></div>';
  }
  return '<div style="margin-top:8px">'+stageBar+
    '<button onclick="window.__rrWaveOpen=window.__rrWaveOpen||{};window.__rrWaveOpen[\''+r.id+'\']=!'+(open?'true':'false')+';render()" '+
      'style="border:0;background:transparent;color:#0757ad;font-size:11.5px;cursor:pointer;padding:0">'+
      (open?'▾ 收起 AI 团队工作台':'▸ 展开 AI 团队工作台（'+r.waves.length+' 阶段）')+'</button>'+summary+
    (open?'<div style="margin-top:6px;padding:8px 12px;background:#fafcff;border:1px solid #eaf0f7;border-radius:8px">'+rows+'</div>':'')+
  '</div>';
}
function rrProgress(r){
  if(r.status!=='running') return '';
  var ts=rrTimeSplit(r);
  var fd=r.filesDone||0, ft=r.filesTotal||16;
  var pct=Math.min(96, Math.round(fd/ft*100));
  var step=r.step||'AI 研判启动中…';
  var eta=(r.etaMin!=null)?('预计还需 '+r.etaMin+' 分钟'):'预计约 40 分钟';
  var staleMin=r.progressTs?Math.floor((Date.now()-r.progressTs)/60000):null;
  var stale=staleMin!=null&&staleMin>5;
  var lastUpd=staleMin==null?'':staleMin<1?'刚更新':staleMin+' 分钟前更新';
  var gapBadge=ts.gap?('<span title="机器睡眠/离线导致的暂停时长（'+ts.gapCount+' 次断点），不计入有效运行时间" '+
    'style="margin-left:8px;font-size:10.5px;padding:1px 7px;border-radius:9px;background:#fff0de;color:#a34c09;cursor:help">⏸ 断点 '+ts.gap+(ts.gapCount>1?' × '+ts.gapCount:'')+'</span>'):'';
  var stallBadge=ts.stall?('<span title="机器在线但流水线产出停滞的时长（研判暂时停滞），不计入有效运行时间" '+
    'style="margin-left:6px;font-size:10.5px;padding:1px 7px;border-radius:9px;background:#fdeef0;color:#b0364a;cursor:help">⚠ 空转 '+ts.stall+'</span>'):'';
  gapBadge=stallBadge+gapBadge;
  return '<div style="margin-top:8px;padding:10px 12px;border:1px solid #e3ebf6;border-radius:8px;background:#f8fbff">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#3d5471;margin-bottom:7px">'+
      '<span><span class="'+(stale?'':'rr-dot-live')+'" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+(stale?'#c85b09':'#0aa696')+';margin-right:6px"></span>'+
      '<b style="color:#0757ad" class="rr-step-glow">'+step+'</b>'+(stale?' <span style="color:#c85b09">（'+staleMin+' 分钟无进展，系统正在自动补全）</span>':'')+'</span>'+
      '<span style="display:inline-flex;align-items:center"><span id="rrElapsed" style="font-variant-numeric:tabular-nums">有效运行 '+ts.active+'</span>'+gapBadge+'</span></div>'+
    '<div style="height:8px;border-radius:4px;background:#e6edf6;overflow:hidden;margin-bottom:7px">'+
      '<div class="'+(stale?'':'rr-bar-live')+'" style="height:100%;width:'+pct+'%;border-radius:4px;background:linear-gradient(90deg,#0757ad,#007f82);transition:width .6s"></div></div>'+
    '<div style="display:flex;justify-content:space-between;font-size:11.5px;color:#667590">'+
      '<span>已产出章节 '+fd+' / '+ft+' · '+pct+'%</span>'+
      '<span><span id="rrLastUpd">'+(lastUpd||'')+'</span>'+(lastUpd?' · ':'')+eta+'</span></div>'+
    rrIssuesBanner(r)+
    rrWaveRows(r)+'</div>';
}
function rrIssuesBanner(r){
  var iss=r.issues||[];
  if(!iss.length) return '';
  return '<div style="margin-top:8px;padding:9px 12px;border:1px solid #f2c3cb;border-radius:8px;background:#fdeef0">'+
    '<div style="font-size:11.5px;font-weight:700;color:#b0364a;margin-bottom:5px;display:flex;align-items:center;gap:6px">'+
      '<span>⚠ '+iss.length+' 个环节未达标</span>'+
      '<span style="font-weight:400;color:#c47080">系统正在自动补全</span></div>'+
    '<div style="display:flex;flex-direction:column;gap:3px">'+
      iss.map(function(s){
        var parts=String(s).split('：');
        return '<div style="font-size:11.5px;color:#7a2836;line-height:1.5">'+
          '<b style="color:#b0364a">'+(parts[0]||'')+'</b>'+(parts[1]?' — '+parts[1]:'')+'</div>';
      }).join('')+'</div></div>';
}
function rrPanel(){
  var rows=REPORT_REQUESTS.slice().reverse().map(function(r){
    var t=new Date(r.ts);var tm=(t.getMonth()+1)+'/'+t.getDate()+' '+t.getHours()+':'+('0'+t.getMinutes()).slice(-2);
    var doneInfo='';
    if(r.status==='done'){
      var dur='';
      if(r.activeMs){ dur=' · 正式运行 '+rrElapsed(r.activeMs)+(r.gapMs?'（另有断点 '+rrElapsed(r.gapMs)+'）':''); }
      else if(r.doneTs&&(r.claimTs||r.ts)){ dur=' · 耗时 '+rrElapsed(r.doneTs-(r.claimTs||r.ts)); }
      doneInfo=' · 智库材料 '+r.chunks+' 条已入库'+dur;
    }
    var dlBtn='';
    if(r.status==='done' && r.files && r.files.length){
      dlBtn='<button onclick="downloadReqFile(\''+r.id+'\',\'full\')" style="flex-shrink:0;padding:6px 12px;background:#eef2ff;border:1.5px solid #c7d2fe;border-radius:8px;font-size:12px;color:#4338ca;cursor:pointer;font-weight:600;white-space:nowrap">⬇ 原始报告(docx)</button>';
    }
    var pushCtrl='';
    if(r.status==='done'){
      if(r.pushed){
        pushCtrl='<span style="flex-shrink:0;font-size:12px;color:#166534;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:5px 11px;white-space:nowrap">✓ 已推送 · 账号 '+(r.account||'—')+'</span>';
      } else if(r.pushRequested){
        pushCtrl='<span style="flex-shrink:0;font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:5px 11px;white-space:nowrap">⏳ 推送中…</span>';
      } else {
        pushCtrl='<button onclick="pushReportToRag(\''+r.id+'\',this)" style="flex-shrink:0;padding:6px 14px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:8px;font-size:12.5px;font-weight:650;cursor:pointer;white-space:nowrap">🚀 推送到 RAG</button>';
      }
    }
    var cancelBtn='';
    if(r.status==='pending'||r.status==='running'){
      cancelBtn='<button onclick="cancelReportRequest(\''+r.id+'\',this)" style="flex-shrink:0;padding:6px 12px;background:#fff;border:1.5px solid #fca5a5;border-radius:8px;font-size:12px;color:#dc2626;cursor:pointer;font-weight:600;white-space:nowrap">✕ 取消</button>';
    }
    return '<div class="ops-row" style="align-items:flex-start;flex-direction:column"><div style="display:flex;align-items:center;gap:10px;width:100%">'+
      '<div class="r-ic"></div>'+
      '<div class="r-main"><div style="display:flex;align-items:center;gap:8px"><strong>'+r.province+' · '+r.city+'</strong>'+rrStatusBadge(r.status)+'</div>'+
      '<small>'+r.by+' · '+tm+' 发起'+doneInfo+(r.status==='failed'&&r.failReason?' · '+r.failReason:'')+'</small></div>'+
      '<div style="margin-left:auto;display:flex;align-items:center;gap:8px">'+dlBtn+pushCtrl+cancelBtn+'</div></div>'+
      rrProgress(r)+'</div>';
  }).join('')||'<div style="color:#8492a6;font-size:13px;padding:8px 2px">暂无申请记录</div>';
  return '<div style="border:1px solid var(--line);border-radius:10px;background:#fff;padding:18px 20px;margin:0 0 16px">'+
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><strong style="font-size:15px">发起城市报告生成</strong>'+
    '<span style="color:#8492a6;font-size:12px">AI 招商智能体 · 产出后自动初始化该城市智库</span></div>'+
    '<div style="display:flex;gap:10px;margin-bottom:14px">'+
      '<input id="rrProv" placeholder="省份，如 湖北" style="flex:0 0 150px;min-height:40px;padding:8px 11px;border:1px solid var(--line);border-radius:8px">'+
      '<input id="rrCity" placeholder="城市，如 随州" style="flex:0 0 150px;min-height:40px;padding:8px 11px;border:1px solid var(--line);border-radius:8px">'+
      '<button class="primary-button" style="min-height:40px" onclick="submitReportRequest()">发起申请</button></div>'+
    rows+'</div>';
}





var RES_COLOR={matched:{bg:'#e4f5f3',c:'#006d70'},checking:{bg:'#ebf3fd',c:'#013582'},none:{bg:'#fff0de',c:'#a34c09'}};

var role='ops';   // 管理端
var cur=null,view='home',detailOpen=false,detailData=null,curKb=null,curDemand=null,curSub=null;
// 报告版本迭代状态（每项目一份）：{ver, finalized, patches:[补充意见], edits:{结论index:新文字}}
var REPORTSTATE={};
function rs(){var k=cur;if(!REPORTSTATE[k])REPORTSTATE[k]={ver:1,finalized:false,patches:[],edits:{}};return REPORTSTATE[k];}
function P(){return cur&&PROJECTS[cur]||{}}
