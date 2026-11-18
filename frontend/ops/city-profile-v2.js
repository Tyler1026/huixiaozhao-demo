/* City profiles: facts, reviewed implications, public policy and actual preferences. */
function cpProfileRevision(key){
  var project=PROJECTS[key]||{},text=savedEvidenceIdentity(key,project.topic||'')+'|'+JSON.stringify(project.onboarding||{}),hash=2166136261;
  for(var i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return 'profile-v2-'+(hash>>>0).toString(16);
}
function cpProfileEvidence(refs){
  return (Array.isArray(refs)?refs:[]).map(function(ref){return '<blockquote style="margin:10px 0;padding:10px 12px;background:#f8faff;border-left:3px solid #cbd7e6;line-height:1.85">'+cpSourceText(ref.quote||'')+'</blockquote>'+funnelEvidenceLinks({evidence:[ref]});}).join('');
}
function cpProfileInsights(prof){
  if(prof.profile_contract!=='city-profile-v2')return '';
  var rows=Array.isArray(prof.analysis)?prof.analysis.filter(function(a){return a&&a.kind!=='overview';}):[];
  var names={strength:'可发挥的条件',constraint:'约束与核查重点',opportunity:'可推进机会'};
  var cards=rows.map(function(row){
    return '<article class="ops-ui-card" style="padding:16px"><span class="ops-ui-badge is-muted">'+cpEsc(names[row.kind]||'分析推断')+' · AI研判待核</span><h3 style="margin:10px 0">'+cpEsc(row.focus)+'</h3><p style="line-height:1.85">'+cpEsc(row.implication)+'</p><p style="line-height:1.85;color:#0f766e"><b>下一步：</b>'+cpEsc(row.action)+'</p><details><summary>查看研判依据</summary>'+cpProfileEvidence(row.evidence||[])+'</details></article>';
  });
  var body='<section style="margin:18px 0"><h2 style="font-size:16px">招商研判与下一步</h2><p class="ops-ui-muted">依据已保存材料形成的分析推断；与下方原文披露和实际招商偏好分开展示。</p>';
  body+=cards.length?'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px">'+cards.join('')+'</div>':'<div class="ops-ui-card" style="padding:16px">本轮尚无通过复核的研判，请查看已整理材料和待补事项。</div>';
  var overview=(prof.analysis||[]).find(function(a){return a.kind==='overview';});
  if(overview)body+='<details style="margin:12px 0"><summary>城市总览的依据与核查建议</summary><p>'+cpEsc(overview.action)+'</p>'+cpProfileEvidence(overview.evidence||[])+'</details>';
  return body+'</section>';
}
function cpProfilePolicies(prof){
  if(prof.profile_contract!=='city-profile-v2')return '';
  return '<section style="margin:20px 0"><h2 style="font-size:16px">公开政策与规划导向</h2><p class="ops-ui-muted">政策支持、产业目标和补贴条件按原文展示，不替代企业规模、投资强度等实际招商偏好。</p>'+cpObjBlock('政策与适用条件','',prof.policyDirections||[])+'</section>';
}
var cpProfilePreviousObject=cpObjBlock;
cpObjBlock=function(title,icon,rows){
  rows=Array.isArray(rows)?rows.filter(function(r){return r&&typeof r==='object';}):[];
  if(!rows.length)return '<section class="ops-ui-card" style="padding:16px"><h3>'+icon+' '+cpEsc(title)+'</h3><p class="ops-ui-muted">当前材料尚未形成可用条目，请补充对应年度、辖区和原始来源；不代表当地没有该项条件。</p></section>';
  return '<section class="ops-ui-card" style="padding:16px"><h3>'+icon+' '+cpEsc(title)+'</h3>'+rows.map(function(row){
    var text=String(row.value||''),caption=text.replace(/https?:\/\/[^\s）)]+/g,'').slice(0,150);
    return '<div style="padding:12px 0;border-bottom:1px solid #eef2f7"><b>'+cpEsc(row.label||title)+'</b><span class="ops-ui-muted" style="margin-left:8px;font-size:11px">材料披露 · 待核</span><p style="line-height:1.8;margin:6px 0">'+cpEsc(caption)+(text.length>150?'…':'')+'</p><details><summary>展开完整原文与来源</summary><div style="line-height:1.9;overflow-wrap:anywhere;margin-top:10px">'+cpSourceText(text)+(row.detail?'<p>'+cpEsc(row.detail)+'</p>':'')+(row.evidence&&row.evidence.length?funnelEvidenceLinks({evidence:row.evidence}):row.cite?'<p>来源：'+cpSourceText(row.cite)+'</p>':'')+'</div></details></div>';
  }).join('')+'</section>';
};
var cpProfilePreviousCharts=cpChartsSection;
cpChartsSection=function(prof){
  if(prof.profile_contract!=='city-profile-v2')return typeof _cpReadableCharts==='function'?_cpReadableCharts(prof):cpProfilePreviousCharts(prof);
  var charts=prof.charts||{},metrics=Array.isArray(prof.metrics)?prof.metrics:[],cards=[];
  metrics.forEach(function(row){
    cards.push(cpChartBox((row.label||'地区生产总值')+' · '+row.year+'年',
      '<p class="ops-ui-muted">'+cpEsc(row.city)+' · '+cpEsc(row.year)+'年披露口径</p><strong style="font-size:26px;color:#1d4ed8">'+cpEsc(row.value)+' <small>'+cpEsc(row.unit)+'</small></strong><details style="margin-top:10px"><summary>查看数据原文</summary>'+cpProfileEvidence(row.evidence||[])+'</details>',row.cite));
  });
  if(charts.structure)cards.push(cpChartStructure(charts.structure));
  if(Array.isArray(charts.gdp_trend)&&charts.gdp_trend.length>=2){
    cards.push(cpChartGdp(charts.gdp_trend)+'<details style="margin-bottom:12px"><summary>GDP各年份的原始依据</summary>'+cpProfileEvidence(charts.gdp_trend.reduce(function(all,r){return all.concat(r.evidence||[]);},[]))+'</details>');
  }
  var missing=[];
  if(!charts.structure)missing.push('三次产业结构缺少明确年份和完整占比');
  if(!Array.isArray(charts.gdp_trend)||charts.gdp_trend.length<2)missing.push('GDP走势尚缺同单位的两个年度数据');
  if(!cards.length&&!missing.length)return '';
  return '<section style="margin:18px 0"><h2 style="font-size:16px">可追溯的城市指标</h2><p class="ops-ui-muted">仅展示原文明确的本市、年度、单位和数值；规划目标不当现状，不用外地数据补图。</p>'+(cards.length?'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px">'+cards.join('')+'</div>':'')+(missing.length?'<p class="ops-ui-muted">待补数据：'+missing.map(cpEsc).join('；')+'。</p>':'')+'</section>';
};

function cpProfileDisplaySummary(prof){
  var summary=String(prof.summary||'');
  if(prof.profile_contract!=='city-profile-v2'||summary.indexOf('已按六个维度整理当前工作区材料')!==0)return summary;
  var rows=Array.isArray(prof.analysis)?prof.analysis:[],overview=rows.find(function(a){return a.kind==='overview';});
  if(overview)return overview.implication;
  var first=rows.find(function(a){return a.kind==='strength';})||rows[0],constraint=rows.find(function(a){return a.kind==='constraint';});
  if(!first)return summary;
  return [first.implication,constraint&&constraint!==first?constraint.implication:'',first.action?'优先核查：'+first.action:''].filter(Boolean).join(' ');
}
