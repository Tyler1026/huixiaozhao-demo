/* ===== AI 招商团队实时工作台（政府端可见，业务化，无内部术语）===== */

/* 项目级阶段链：标准5阶段 + 该项目自定义追加阶段（客户反馈第4章第3条：后续阶段不写死） */
function projStages(p){
  var base=STAGES.map(function(s){return s.slice();});
  if(p && p.customStages && p.customStages.length){
    for(var i=0;i<p.customStages.length;i++) base.push([p.customStages[i],'自定义阶段']);
  }
  return base;
}
function stageNameOf(p,n){
  var st=projStages(p);
  return (n>=1 && st[n-1]) ? st[n-1][0] : '完成';
}
function stageDescOf(p,n){
  var st=projStages(p);
  return (n>=1 && st[n-1]) ? st[n-1][1] : '';
}

/* 前台时间线：读项目 stageLog 留痕动态渲染，区分已完成/当前进行中/下一步 */
function stageTimelineHtml(p){
  if(!p) return '';
  var st = projStages(p);
  var cur = p.stage || 1;
  var log = (p.stageLog || []).slice();
  // 尚未进入对接流程（阶段1-2为分析阶段）
  if(cur < 3){
    return '<div style="display:flex;gap:12px">'+
      '<div style="display:flex;flex-direction:column;align-items:center">'+
        '<div style="width:28px;height:28px;border-radius:50%;background:#f0f4ff;border:2px solid #e8edf5;display:flex;align-items:center;justify-content:center;color:#9aa5b5;font-size:12px;flex-shrink:0">◔</div>'+
      '</div>'+
      '<div style="padding:2px 0 16px">'+
        '<div style="font-size:13px;font-weight:650;color:#9aa5b5">尚未进入招商对接流程</div>'+
        '<div style="font-size:12px;color:#b0bac8;margin-top:2px">完成研判与方向确认后提交招商需求即进入</div>'+
      '</div>'+
    '</div>';
  }
  // 已完成阶段：stageLog 中 to < cur 的阶段（去重，旧→新）
  var doneStages = [];
  log.slice().reverse().forEach(function(l){
    if(l.to < cur && doneStages.indexOf(l.to) < 0) doneStages.push(l.to);
  });
  var nodes = [];
  // 固定起点：需求已递交
  nodes.push({title:'需求已递交', desc:'已同步招商需求与报告证据链', state:'done', note:'', time:null});
  // 已完成推进阶段
  doneStages.forEach(function(toStage){
    var entry = null;
    for(var i=0;i<log.length;i++){ if(log[i].to===toStage){ entry=log[i]; break; } }
    nodes.push({
      title: stageNameOf(p, toStage),
      desc: entry && entry.note ? entry.note : '',
      state:'done', note:'', time: entry ? entry.ts : null
    });
  });
  // 当前阶段（含该阶段的最新回复说明）
  var curEntry = null;
  for(var ci=0;ci<log.length;ci++){ if(log[ci].to===cur){ curEntry=log[ci]; break; } }
  nodes.push({title: stageNameOf(p, cur), desc:(curEntry&&curEntry.note)?curEntry.note:'当前进行中', state:'current', note:'', time: curEntry?curEntry.ts:null});
  // 下一步
  var next = cur + 1;
  if(next <= st.length){
    nodes.push({title: stageNameOf(p, next), desc:'下一步（等待资源端推进）', state:'next', note:'', time:null});
  }
  // 渲染
  return nodes.map(function(nd, i){
    var isLast = (i === nodes.length - 1);
    var dotBg = nd.state==='done' ? '#1a56db' : nd.state==='current' ? '#f59e0b' : '#f0f4ff';
    var dotBorder = nd.state==='next' ? 'border:2px solid #e8edf5;' : '';
    var dotColor = nd.state==='next' ? '#9aa5b5' : '#fff';
    var dotText = nd.state==='done' ? '✓' : nd.state==='current' ? '◔' : (nd.state==='next' ? '' : '');
    var titleColor = nd.state==='next' ? '#9aa5b5' : '#0b183b';
    var timeHtml = nd.time ? '<span style="font-size:10px;color:#9aa5b5;margin-left:8px">'+new Date(nd.time).toLocaleString('zh-CN')+'</span>' : '';
    return '<div style="display:flex;gap:12px">'+
      '<div style="display:flex;flex-direction:column;align-items:center">'+
        '<div style="width:28px;height:28px;border-radius:50%;background:'+dotBg+';'+dotBorder+'display:flex;align-items:center;justify-content:center;color:'+dotColor+';font-size:12px;flex-shrink:0">'+dotText+'</div>'+
        (isLast?'':'<div style="width:2px;flex:1;background:#e8edf5;margin:4px 0"></div>')+
      '</div>'+
      '<div style="padding:2px 0 '+(isLast?'0':'16px')+'">'+
        '<div style="font-size:13px;font-weight:650;color:'+titleColor+'">'+nd.title+timeHtml+'</div>'+
        '<div style="font-size:12px;color:'+(nd.state==='next'?'#b0bac8':'#8492a6')+';margin-top:2px">'+nd.desc+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
}

