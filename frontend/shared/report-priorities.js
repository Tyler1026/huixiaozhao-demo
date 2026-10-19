/* Project the server-reviewed priorities belonging to this exact saved report.
 * This is a display adapter, not another recommendation or scoring pipeline. */
function reportAnalyticalPriorities(state, topic){
  if(!state||typeof topic!=='string'||!topic)return [];
  var text=state.aiReportByTopic&&state.aiReportByTopic[topic];
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
    if(['focus','comparison','reason','action'].some(function(key){return typeof row[key]!=='string'||!row[key].trim();}))return;
    var focus=row.focus.trim();if(seen[focus]||!Array.isArray(row.evidence_ids)||!row.evidence_ids.length)return;
    var ids=[],valid=true;
    row.evidence_ids.forEach(function(id){
      if(typeof id!=='string'||!sourceMap[id]||conflicts[id])valid=false;
      else if(ids.indexOf(id)<0)ids.push(id);
    });
    if(!valid||!ids.length)return;
    seen[focus]=true;
    out.push({focus:focus,scope:row.scope,scopeLabel:scopes[row.scope],comparison:row.comparison,reason:row.reason,action:row.action,
      evidence_ids:ids,sources:ids.map(function(id){return Object.assign({},sourceMap[id]);}),state:row.state,
      missing:Array.isArray(row.missing)?row.missing.filter(function(item){return typeof item==='string'&&item.trim();}):[]});
  });
  return out;
}
