/* Project the server-reviewed priorities belonging to this exact saved report.
 * This is a display adapter, not another recommendation or scoring pipeline. */
function reportOpportunityInfo(type){
  var kinds={
    constraint:{label:'约束补链',boundary:'基于原文披露的实际需求或约束，提交时仍需明确具体诉求和适用条件。'},
    planned_development:{label:'规划培育',boundary:'依据正式规划形成的培育机会，不表示本地存在现实供给缺口。'},
    capability_collaboration:{label:'产业协作',boundary:'依据已有产品和能力形成的协作方向，不表示本地存在供给缺口，也不表示企业已有投资或采购意向。'},
    validation_collaboration:{label:'联合验证',boundary:'围绕研发或应用验证形成的合作方向，不表示已量产或已有采购订单。'},
    project_followup:{label:'项目跟进',boundary:'根据本地已披露的项目或建设线索提出对接建议；须核实当前进展和具体需求，不表示已确认采购、投资意向或本地产业缺口。'}
  };
  return Object.prototype.hasOwnProperty.call(kinds,type)?kinds[type]:null;
}
function reportAnalyticalPriorities(state, topic){
  if(!state||typeof topic!=='string'||!topic)return [];
  var byTopic=state.aiReportByTopic||{};
  var text=Object.prototype.hasOwnProperty.call(byTopic,topic)?byTopic[topic]:state.topic===topic?state.text:null;
  var research=state.researchByTopic&&state.researchByTopic[topic];
  if(typeof text!=='string'||!text.trim()||!research||research.topic!==topic||research.reportText!==text)return [];
  var analysis=research.analysis;
  if(!analysis||analysis.contract!=='topic-report-analysis-v2'||!Array.isArray(analysis.priorities)||!Array.isArray(research.sources))return [];
  var sourceMap=Object.create(null),conflicts=Object.create(null),scopes={local:'本地原文范围',local_enterprise:'本地关联企业业务',industry:'行业共性，非本地缺失',project:'具名项目范围'};
  research.sources.forEach(function(source){
    if(!source||typeof source.id!=='string'||!source.id||typeof source.quote!=='string'||!source.quote.trim()||typeof source.url!=='string')return;
    var url;try{url=new URL(source.url);}catch(e){return;}
    if(url.protocol!=='https:'||!url.hostname||url.username||url.password)return;
    if(sourceMap[source.id]&&(sourceMap[source.id].url!==source.url||sourceMap[source.id].quote!==source.quote))conflicts[source.id]=true;
    var clean={id:source.id,url:source.url,quote:source.quote};
    ['title','label','published_at','published','retrieved_at','archive_retrieved_at','source_type','source_id','support_status','fulltext_scope','pdf_page'].forEach(function(key){
      if(typeof source[key]==='string'||typeof source[key]==='number')clean[key]=source[key];
    });
    if(source.archived===true)clean.archived=true;
    sourceMap[source.id]=clean;
  });
  var seen=Object.create(null),out=[];
  analysis.priorities.forEach(function(row){
    if(!row||row.state!=='reviewed_inference'||!Object.prototype.hasOwnProperty.call(scopes,row.scope))return;
    var opportunity=row.opportunity_type==null?'constraint':row.opportunity_type;
    var kind=reportOpportunityInfo(opportunity);if(!kind)return;
    if(['focus','comparison','reason','action'].some(function(key){return typeof row[key]!=='string'||!row[key].trim();}))return;
    var focus=row.focus.trim();if(seen[focus]||!Array.isArray(row.evidence_ids)||!row.evidence_ids.length)return;
    var ids=[],valid=true;
    row.evidence_ids.forEach(function(id){
      if(typeof id!=='string'||!sourceMap[id]||conflicts[id])valid=false;
      else if(ids.indexOf(id)<0)ids.push(id);
    });
    if(!valid||!ids.length)return;
    seen[focus]=true;
    out.push({focus:focus,scope:row.scope,scopeLabel:scopes[row.scope],opportunity_type:opportunity,opportunityLabel:kind.label,opportunityBoundary:kind.boundary,comparison:row.comparison,reason:row.reason,action:row.action,
      evidence_ids:ids,sources:ids.map(function(id){return Object.assign({},sourceMap[id]);}),state:row.state,
      missing:Array.isArray(row.missing)?row.missing.filter(function(item){return typeof item==='string'&&item.trim();}):[]});
  });
  return out;
}
