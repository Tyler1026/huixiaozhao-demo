/* City profiles: concise dashboard over unchanged source-bound facts and reviewed analysis. */
function cpProfileRevision(key){
  var project=PROJECTS[key]||{},text=savedEvidenceIdentity(key,project.topic||'')+'|'+JSON.stringify(project.onboarding||{}),hash=2166136261;
  for(var i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return 'profile-v2-'+(hash>>>0).toString(16);
}
function cpProfileEvidence(refs){
  return (Array.isArray(refs)?refs:[]).map(function(ref){return '<blockquote class="cp-source-quote">'+cpSourceText(ref.quote||'')+'</blockquote>'+funnelEvidenceLinks({evidence:[ref]});}).join('');
}
function cpProfileExcerpt(value,limit){
  var text=String(value||'').replace(/\s+/g,' ').trim();
  if(text.length<=limit)return text;
  var prefix=text.slice(0,limit),stop=prefix.lastIndexOf('。');
  return stop>=Math.floor(limit*.45)?prefix.slice(0,stop+1):prefix+'…';
}
function cpProfileDisplaySummary(prof){
  var summary=String(prof.summary||'');
  if(prof.profile_contract!=='city-profile-v2'||summary.indexOf('已按六个维度整理当前工作区材料')!==0)return summary;
  var rows=Array.isArray(prof.analysis)?prof.analysis:[],overview=rows.find(function(a){return a.kind==='overview';});
  if(overview)return overview.implication;
  var first=rows.find(function(a){return a.kind==='strength';})||rows[0],constraint=rows.find(function(a){return a.kind==='constraint';});
  if(!first)return summary;
  return [first.implication,constraint&&constraint!==first?constraint.implication:'',first.action?'优先核查：'+first.action:''].filter(Boolean).join(' ');
}
function cpProfileOverview(prof){
  var rows=Array.isArray(prof.analysis)?prof.analysis:[],first=rows.find(function(a){return a.kind==='strength';})||rows.find(function(a){return a.kind!=='overview';}),constraint=rows.find(function(a){return a.kind==='constraint';});
  var summary=cpProfileDisplaySummary(prof);
  if(!summary&&!first)return '';
  var points=first?'<div class="cp-overview-grid">'+
    '<div><span>城市底盘</span><p>'+cpEsc(cpProfileExcerpt(first.implication,92))+'</p></div>'+
    '<div><span>主要约束</span><p>'+cpEsc(constraint?cpProfileExcerpt(constraint.implication,92):'本轮暂无通过复核的约束研判，不代表没有约束。')+'</p></div>'+
    '<div><span>优先核查</span><p>'+cpEsc(cpProfileExcerpt(first.action,92))+'</p></div></div>':
    '<p class="cp-overview-lead">'+cpEsc(cpProfileExcerpt(summary,180))+'</p>';
  return '<section class="cp-overview"><div class="cp-section-head"><h2>画像总览</h2><span>研判待核 · 要点摘读</span></div>'+points+
    '<details class="cp-details"><summary>展开完整总览与限定条件</summary><div class="cp-full-text">'+cpSourceText(summary)+'</div></details></section>';
}
function cpProfileInsights(prof){
  if(prof.profile_contract!=='city-profile-v2')return '';
  var rows=Array.isArray(prof.analysis)?prof.analysis.filter(function(a){return a&&a.kind!=='overview';}):[];
  var groups=[['strength','可发挥条件','condition'],['opportunity','可推进机会','opportunity'],['constraint','主要约束','constraint']];
  var columns=groups.map(function(group){
    var items=rows.filter(function(a){return a.kind===group[0];});
    return '<section class="cp-insight-column is-'+group[2]+'"><header><h3>'+group[1]+'</h3><span>'+items.length+' 条研判</span></header>'+
      (items.length?items.map(function(row){return '<article class="cp-insight"><h4>'+cpEsc(row.focus)+'</h4><p class="cp-excerpt">'+cpEsc(cpProfileExcerpt(row.implication,68))+'</p>'+
        '<p class="cp-next"><b>下一步</b>'+cpEsc(cpProfileExcerpt(row.action,68))+'</p>'+
        '<details class="cp-details"><summary>完整分析与依据</summary><div class="cp-full-text"><p>'+cpEsc(row.implication)+'</p><p><b>下一步：</b>'+cpEsc(row.action)+'</p>'+cpProfileEvidence(row.evidence||[])+'</div></details></article>';}).join(''):
        '<p class="cp-empty">本轮暂无该类通过复核的研判。</p>')+'</section>';
  }).join('');
  return '<section class="cp-section"><div class="cp-section-head"><h2>招商研判与下一步</h2><span>AI研判待核 · 展开可查看完整限定条件</span></div><div class="cp-insight-grid">'+columns+'</div></section>';
}
function cpProfileObject(title,icon,rows){
  rows=Array.isArray(rows)?rows.filter(function(r){return r&&typeof r==='object';}):[];
  function item(row){
    var text=String(row.value||'');
    return '<div class="cp-fact"><b>'+cpEsc(row.label||title)+'</b><p class="cp-excerpt">'+cpEsc(cpProfileExcerpt(text,72))+'</p>'+
      '<details class="cp-details"><summary>原文与来源 · 待核</summary><div class="cp-full-text">'+cpSourceText(text)+(row.detail?'<p>'+cpEsc(row.detail)+'</p>':'')+
      (row.evidence&&row.evidence.length?funnelEvidenceLinks({evidence:row.evidence}):row.cite?'<p>来源：'+cpSourceText(row.cite)+'</p>':'')+'</div></details></div>';
  }
  return '<section class="cp-facet"><header><h3>'+icon+' '+cpEsc(title)+'</h3><span>'+rows.length+' 条材料</span></header>'+
    (rows.length?rows.slice(0,2).map(item).join('')+(rows.length>2?'<details class="cp-details cp-more"><summary>其余 '+(rows.length-2)+' 条材料</summary>'+rows.slice(2).map(item).join('')+'</details>':''):
    '<p class="cp-empty">当前材料尚未形成可用条目；不代表当地没有该项条件。</p>')+'</section>';
};
function cpProfilePolicies(prof){
  if(prof.profile_contract!=='city-profile-v2')return '';
  var rows=Array.isArray(prof.policyDirections)?prof.policyDirections:[];
  return '<details class="cp-section cp-secondary"><summary>公开政策与规划导向 <span>'+rows.length+' 条材料</span></summary><p class="cp-note">政策支持和补贴不替代实际招商偏好，适用范围与兑现条件以原文为准。</p>'+cpProfileObject('政策与适用条件','',rows)+'</details>';
}
function cpProfilePreferences(prof){
  var pref=prof.preference||{},dimensions=[['industry','优先产业'],['park','重点园区'],['scale','企业规模'],['invest','投资强度'],['capacity','承载条件']];
  return '<section class="cp-section"><div class="cp-section-head"><h2>实际招商偏好</h2><span>问卷陈述 · 不用政策反推</span></div><div class="cp-preference-grid">'+dimensions.map(function(pair){
    var row=pref[pair[0]]||{},stated=row.source==='stated',items=Array.isArray(row.items)?row.items.filter(function(v){return typeof v==='string'&&v.trim();}):[];
    return '<div class="cp-preference"><h3>'+pair[1]+'</h3><span class="cp-status">'+(stated?'已填写':items.length?'资料推断 · 待核':'待填写')+'</span>'+
      (items.length?'<p>'+cpEsc(cpProfileExcerpt(items.join('、'),60))+'</p><details class="cp-details"><summary>完整内容与依据</summary><div class="cp-full-text">'+items.map(function(v){return '<p>'+cpEsc(v)+'</p>';}).join('')+'<p>'+cpEsc(row.basis||'')+'</p></div></details>':'')+'</div>';
  }).join('')+'</div></section>';
}
function cpProfileGaps(prof){
  var gaps=Array.isArray(prof.gaps)?prof.gaps:[],conflicts=Array.isArray(prof.conflicts)?prof.conflicts:[];
  var body=conflicts.length?'<div class="cp-conflicts"><h3>问卷与材料冲突</h3>'+conflicts.map(function(x){return '<p>'+cpEsc(x)+'</p>';}).join('')+'</div>':'';
  if(gaps.length)body+='<details class="cp-section cp-secondary"><summary>待补材料与核查说明 <span>'+gaps.length+' 项</span></summary><ul>'+gaps.map(function(x){return '<li>'+cpEsc(x)+'</li>';}).join('')+'</ul></details>';
  return body;
}
var cpProfilePreviousCharts=cpChartsSection;
cpChartsSection=function(prof){
  if(prof.profile_contract!=='city-profile-v2')return typeof _cpReadableCharts==='function'?_cpReadableCharts(prof):cpProfilePreviousCharts(prof);
  var charts=prof.charts||{},metrics=Array.isArray(prof.metrics)?prof.metrics:[],cards=[];
  metrics.forEach(function(row){
    cards.push(cpChartBox((row.label||'地区生产总值')+' · '+row.year+'年',
      '<p class="cp-note">'+cpEsc(row.city)+' · '+cpEsc(row.year)+'年披露口径</p><strong class="cp-metric-value">'+cpEsc(row.value)+' <small>'+cpEsc(row.unit)+'</small></strong>'+
      '<details class="cp-details"><summary>查看数据原文</summary>'+cpProfileEvidence(row.evidence||[])+'</details>',row.cite));
  });
  if(charts.structure)cards.push('<div>'+cpChartStructure(charts.structure)+'<details class="cp-details"><summary>产业结构原文与口径</summary>'+cpProfileEvidence(charts.structure.evidence||[])+'</details></div>');
  if(Array.isArray(charts.gdp_trend)&&charts.gdp_trend.length>=2)cards.push('<div>'+cpChartGdp(charts.gdp_trend)+'<details class="cp-details"><summary>各年份原始依据</summary>'+cpProfileEvidence(charts.gdp_trend.reduce(function(all,r){return all.concat(r.evidence||[]);},[]))+'</details></div>');
  var missing=[];
  if(!charts.structure)missing.push('三次产业结构缺少明确年份和完整占比');
  if(!Array.isArray(charts.gdp_trend)||charts.gdp_trend.length<2)missing.push('GDP走势尚缺同单位的两个年度数据');
  return '<section class="cp-section"><div class="cp-section-head"><h2>城市指标与图表</h2><span>按原文年度与辖区展示</span></div>'+
    (cards.length?'<div class="cp-chart-grid">'+cards.join('')+'</div>':'<div class="cp-chart-empty">当前暂无满足年份、单位和辖区校验的数值，暂不绘图。</div>')+
    (missing.length?'<details class="cp-details"><summary>待补图表与统计口径</summary><p class="cp-note">'+missing.map(cpEsc).join('；')+'。未绘图不代表该市没有该项条件；规划目标不作现状，缺值不记为零。</p></details>':'')+'</section>';
};
function cpProfileCoverage(objective,groups){
  var counts=groups.map(function(g){return Array.isArray(objective[g[0]])?objective[g[0]].length:0;}),max=Math.max.apply(null,counts.concat([1]));
  return '<figure class="cp-coverage"><figcaption>画像材料分布 <span>按收录条数展示，非城市实力评分</span></figcaption><div class="cp-coverage-grid">'+groups.map(function(g,i){return '<div><span>'+cpEsc(g[1])+'</span><b>'+counts[i]+' 条</b><i aria-hidden="true"><em style="width:'+(counts[i]/max*100).toFixed(1)+'%"></em></i></div>';}).join('')+'</div></figure>';
}
function cpProfileBody(prof){
  var objective=prof.objective||{},groups=[['economy','经济体量','funding'],['structure','产业结构','industry-analysis'],['industry','主导产业','industry'],['park','园区与承载','city'],['anchor','企业与项目','enterprise'],['cost','配套与成本','citation']];
  var covered=groups.filter(function(g){return Array.isArray(objective[g[0]])&&objective[g[0]].length;}).length;
  return cpProfileOverview(prof)+cpChartsSection(prof)+cpProfileInsights(prof)+
    '<section class="cp-section"><div class="cp-section-head"><h2>城市条件一览</h2><span>'+covered+'/6 类有材料</span></div>'+cpProfileCoverage(objective,groups)+'<div class="cp-facet-grid">'+groups.map(function(g){return cpProfileObject(g[1],'<span data-ops-icon="'+g[2]+'"></span>',objective[g[0]]);}).join('')+'</div></section>'+
    cpProfilePreferences(prof)+cpProfilePolicies(prof)+cpProfileGaps(prof);
}
