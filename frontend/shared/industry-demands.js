/* One reviewed report suggestion creates one independently tracked demand. */
var INDUSTRY_DEMAND_DRAFT=null;
function industryDemandProjectTitle(project){return project&&project.demandContract==='industry-demand-v1'?project.demandTitle||project.topic:project&&project.topic||'';}
function industryDemandPriorityKey(item){return JSON.stringify([item.scope,item.focus]);}
function industryDemandExisting(key,topic,item){
  var priorityKey=industryDemandPriorityKey(item);
  return Object.keys(PROJECTS||{}).find(function(id){var p=PROJECTS[id];return p&&p.demandContract==='industry-demand-v1'&&p.sourceProjectKey===key&&p.sourceAnalysisTopic===topic&&p.sourcePriorityKey===priorityKey;})||null;
}
function industryDemandButtonHtml(project,item){
  var key=cur,topic=project.topic,existing=industryDemandExisting(key,topic,item);
  return '<button class="industry-priority-submit" type="button" data-demand-source="'+escapeChainText(key)+'" data-demand-topic="'+escapeChainText(topic)+'" data-demand-priority="'+escapeChainText(industryDemandPriorityKey(item))+'" onclick="openIndustryDemandComposer(this)">'+(existing?'查看这条需求':'形成招商需求')+'</button>';
}
function industryDemandSummaryHtml(project){
  var spec=project.demandSpec||{},priority=project.selectedPriority||{};
  return '<section class="industry-submitted-demand"><span class="industry-demand-eyebrow">独立招商需求</span><h3>'+escapeChainText(industryDemandProjectTitle(project))+'</h3><p>'+escapeChainText(spec.description||'')+'</p>'+(spec.conditions?'<h4>补充条件</h4><p>'+escapeChainText(spec.conditions)+'</p>':'')+'<div class="industry-demand-origin">来自分析：'+escapeChainText(project.sourceAnalysisTopic||project.topic)+'<br>对应建议：'+escapeChainText(priority.focus||'')+'</div><p class="industry-demand-boundary">以上为提交人确认的需求，原报告的事实核验状态保持不变。</p></section>';
}
function openIndustryDemandProject(key){
  if(!PROJECTS[key]||!PROJECTS[key].isDemand){toast('该需求当前不可用，请刷新后重试');return;}
  closeModal();INDUSTRY_DEMAND_DRAFT=null;cur=key;view='home';detailData=null;detailOpen=true;window.__projOpen=key;render();
}
function chooseIndustryDemand(){
  var p=P();if(!p)return false;
  if(p.isDemand){openIndustryDemandProject(cur);return false;}
  var items=reportAnalyticalPriorities(REPORTSTATE[cur],p.topic);
  if(!items.length){toast('当前报告尚未形成可提交的具体招引建议');return false;}
  if(typeof view!=='undefined'&&view!=='report'){view='report';render();}
  var block=document.getElementById('actionItemsBlock');
  if(block&&block.scrollIntoView)block.scrollIntoView({block:'start',behavior:'smooth'});
  toast('请选择一条具体招引建议，确认需求后单独提交');return false;
}
function openIndustryDemandComposer(button){
  var key=button.getAttribute('data-demand-source'),topic=button.getAttribute('data-demand-topic'),priorityKey=button.getAttribute('data-demand-priority');
  var p=PROJECTS[key],items=p&&reportAnalyticalPriorities(REPORTSTATE[key],topic),item=items&&items.find(function(row){return industryDemandPriorityKey(row)===priorityKey;});
  if(!p||p.isDemand||cur!==key||p.topic!==topic||!demandReportSnapshot(key,topic)||!item){toast('建议或报告已更新，请重新选择');return;}
  var existing=industryDemandExisting(key,topic,item);if(existing){openIndustryDemandProject(existing);return;}
  var identity=savedEvidenceIdentity(key,topic);if(!identity){toast('当前报告来源不完整，请刷新后重试');return;}
  var priority={};['focus','scope','comparison','reason','action','evidence_ids'].forEach(function(field){priority[field]=JSON.parse(JSON.stringify(item[field]));});
  INDUSTRY_DEMAND_DRAFT={key:key,topic:topic,sourceIdentity:identity,reportMetadataIdentity:JSON.stringify((REPORTSTATE[key].researchByTopic||{})[topic]),priority:priority,epoch:typeof _authEpoch==='number'?_authEpoch:0,pending:false};
  var rows=chainNodeSources({sources:item.sources});
  var body='<div class="industry-demand-composer"><p class="industry-demand-intro">将这一条建议单独形成需求，管理端将按下方具体诉求开展企业核验与对接。</p><div class="industry-demand-origin">分析方向：'+escapeChainText(topic)+'<br>原建议：'+escapeChainText(item.focus)+'<br>适用范围：'+escapeChainText(item.scopeLabel)+'</div><label for="industryDemandTitle">需求名称</label><input id="industryDemandTitle" maxlength="120" value="'+escapeChainText(item.focus)+'"><label for="industryDemandDescription">具体招引诉求</label><textarea id="industryDemandDescription" maxlength="6000" rows="4">'+escapeChainText(item.action)+'</textarea><label for="industryDemandConditions">补充条件 <span>（选填）</span></label><textarea id="industryDemandConditions" maxlength="2000" rows="3" placeholder="可填写希望对接的能力、合作方式、承接条件等"></textarea><details><summary>查看这条建议的分析与依据</summary><p>'+escapeChainText(item.reason)+'</p><p>'+escapeChainText(item.comparison)+'</p>'+rows.map(chainLayoutSourceHtml).join('')+'</details><p class="industry-demand-boundary">提交表示确认你的招引诉求，不会将报告中的待核信息改为已核实事实。</p><p id="industryDemandError" class="industry-demand-error" role="alert"></p></div>';
  openModal('确认这条招商需求',body,'<button class="secondary-button" onclick="closeModal()">取消</button><button id="industryDemandSubmit" class="primary-button" onclick="submitIndustryDemand()">确认提交本条需求</button>');
}
async function submitIndustryDemand(){
  var draft=INDUSTRY_DEMAND_DRAFT;if(!draft||draft.pending)return false;
  var error=document.getElementById('industryDemandError'),button=document.getElementById('industryDemandSubmit');
  function fail(message){if(error)error.textContent=message;else toast(message);}
  var epoch=typeof _authEpoch==='number'?_authEpoch:0;
  if(epoch!==draft.epoch||cur!==draft.key||!PROJECTS[draft.key]||PROJECTS[draft.key].topic!==draft.topic||savedEvidenceIdentity(draft.key,draft.topic)!==draft.sourceIdentity||JSON.stringify(((REPORTSTATE[draft.key]||{}).researchByTopic||{})[draft.topic])!==draft.reportMetadataIdentity){fail('报告或当前方向已更新，请关闭后重新选择建议。');return false;}
  var value=function(id){var el=document.getElementById(id);return el&&typeof el.value==='string'?el.value.trim():'';};
  var demand={title:value('industryDemandTitle'),description:value('industryDemandDescription'),conditions:value('industryDemandConditions')};
  if(!demand.title||demand.title.length>120){fail('请填写不超过120字的需求名称。');return false;}
  if(!demand.description||demand.description.length>6000){fail('请填写具体招引诉求，不超过6000字。');return false;}
  if(demand.conditions.length>2000){fail('补充条件请控制在2000字以内。');return false;}
  draft.pending=true;if(button){button.disabled=true;button.textContent='正在提交…';}if(error)error.textContent='';
  try{
    var response=await fetch('/api/industry-demand',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectKey:draft.key,topic:draft.topic,sourceIdentity:draft.sourceIdentity,reportMetadataIdentity:draft.reportMetadataIdentity,priority:draft.priority,demand:demand})});
    var result=await response.json();
    if(!response.ok||!result||result.ok!==true)throw new Error(result&&result.message||result&&result.error||'需求尚未保存，请重试。');
    if((typeof _authEpoch==='number'?_authEpoch:0)!==draft.epoch)return false;
    if(!result.projectKey||!result.project||result.project.demandContract!=='industry-demand-v1'||result.project.sourceProjectKey!==draft.key||result.project.sourceAnalysisTopic!==draft.topic||result.project.sourcePriorityKey!==industryDemandPriorityKey(draft.priority)||!result.demand||result.demand.projKey!==result.projectKey||!result.reportState)throw new Error('服务端返回的需求与所选建议不一致，请刷新核对。');
    PROJECTS[result.projectKey]=result.project;REPORTSTATE[result.projectKey]=result.reportState;
    var index=DEMANDS.findIndex(function(row){return row.id===result.demand.id;});if(index<0)DEMANDS.push(result.demand);else DEMANDS[index]=result.demand;
    persist();
    if(INDUSTRY_DEMAND_DRAFT===draft){closeModal();INDUSTRY_DEMAND_DRAFT=null;render();}
    toast(result.created?'这条招商需求已提交，可在招商对接中单独查看':'这条建议已有需求，已保留原提交内容');return true;
  }catch(exception){if((typeof _authEpoch==='number'?_authEpoch:0)===draft.epoch&&INDUSTRY_DEMAND_DRAFT===draft)fail(exception.message||'提交未完成，请重试。');return false;}
  finally{draft.pending=false;if(button&&button.isConnected!==false){button.disabled=false;button.textContent='确认提交本条需求';}}
}
