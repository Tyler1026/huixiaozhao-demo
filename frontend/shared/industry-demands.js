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
  if(project.demandOrigin==='direct'||spec.source==='user_direct')return '<section class="industry-submitted-demand"><span class="industry-demand-eyebrow">机构直接提交</span><h3>'+escapeChainText(industryDemandProjectTitle(project))+'</h3><p>'+escapeChainText(spec.description||'')+'</p>'+(spec.conditions?'<h4>补充条件</h4><p>'+escapeChainText(spec.conditions)+'</p>':'')+'<p class="industry-demand-boundary">该需求由提交人说明，管理端将按具体诉求受理。</p></section>';
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

/* A known customer need can enter the same receiving queue without a report. */
var DIRECT_DEMAND_DRAFT=null;
function directDemandWorkspaceKey(){
  var keys=typeof cityKeys==='function'?cityKeys():[];
  return keys.find(function(key){var p=PROJECTS[key];return p&&p.isDemand!==true&&(!p.workspaceId||p.workspaceId===key);})||null;
}
function openDirectDemandComposer(){
  var key=directDemandWorkspaceKey();if(!key){toast('当前账号没有可提交需求的工作区，请重新登录核对。');return false;}
  if(DIRECT_DEMAND_DRAFT&&DIRECT_DEMAND_DRAFT.pending){toast('上一条需求正在提交，请稍候。');return false;}
  if(!DIRECT_DEMAND_DRAFT||!DIRECT_DEMAND_DRAFT.uncertain||DIRECT_DEMAND_DRAFT.key!==key||DIRECT_DEMAND_DRAFT.epoch!==dockingActionEpoch())DIRECT_DEMAND_DRAFT={key:key,epoch:dockingActionEpoch(),requestId:dockingRequestId(),pending:false,uncertain:false,attempt:null};
  var body='<div class="docking-log-form"><div class="docking-log-context"><strong>直接提交明确的招商需求</strong><p>需求进入管理端受理队列。管理端会填写负责人、下一步及处理反馈，你可以在这里持续补充资料。</p></div><label for="directDemandTitle">需求名称</label><input id="directDemandTitle" maxlength="120" placeholder="填写具体的招引对象或合作需求"><label for="directDemandDescription">具体招引诉求</label><textarea id="directDemandDescription" maxlength="6000" rows="5" placeholder="说明需要什么类型的企业、产品或能力，以及希望达成的合作"></textarea><label for="directDemandConditions">承接条件与要求 <span>（选填）</span></label><textarea id="directDemandConditions" maxlength="2000" rows="3" placeholder="可填写园区载体、合作方式、时间要求和其他条件"></textarea><div class="docking-form-columns"><div><label for="directDemandContactName">对接人 <span>（选填）</span></label><input id="directDemandContactName" maxlength="80"></div><div><label for="directDemandContactMethod">联系方式 <span>（选填）</span></label><input id="directDemandContactMethod" maxlength="240" placeholder="电话、邮箱或其他联系方式"></div></div><p class="docking-form-help">以上内容按你提交的需求保存。提交后可继续补充相关材料。</p><p id="directDemandError" class="docking-form-error" role="alert"></p></div>';
  openModal('提交招商需求',body,'<button class="secondary-button" onclick="closeModal()">取消</button><button id="directDemandSubmit" class="primary-button" onclick="submitDirectDemand()">提交给管理端</button>');
  if(DIRECT_DEMAND_DRAFT.values){var values=DIRECT_DEMAND_DRAFT.values;[['Title','title'],['Description','description'],['Conditions','conditions'],['ContactName','contactName'],['ContactMethod','contactMethod']].forEach(function(pair){var el=document.getElementById('directDemand'+pair[0]);if(el)el.value=values[pair[1]]||'';});}
  return true;
}
async function submitDirectDemand(){
  var draft=DIRECT_DEMAND_DRAFT;if(!draft||draft.pending)return false;
  var error=document.getElementById('directDemandError'),button=document.getElementById('directDemandSubmit');
  function fail(message){if(error)error.textContent=message;else toast(message);}
  if(draft.epoch!==dockingActionEpoch()||directDemandWorkspaceKey()!==draft.key){fail('账号或工作区已变化，请重新打开需求表单。');return false;}
  function value(id){var el=document.getElementById(id);return el&&typeof el.value==='string'?el.value.trim():'';}
  var demand={title:value('directDemandTitle'),description:value('directDemandDescription'),conditions:value('directDemandConditions'),contactName:value('directDemandContactName'),contactMethod:value('directDemandContactMethod')};
  if(!demand.title||demand.title.length>120||!demand.description||demand.description.length>6000){fail('请填写需求名称（120字以内）和具体招引诉求（6000字以内）。');return false;}
  if(demand.conditions.length>2000||demand.contactName.length>80||demand.contactMethod.length>240){fail('补充内容超过长度限制，请精简后再提交。');return false;}
  var body={mode:'direct',projectKey:draft.key,requestId:draft.requestId,demand:demand},attempt=JSON.stringify(body);
  if(draft.uncertain&&draft.attempt!==attempt){fail('上次提交结果尚未确认，请先按原内容重试，避免产生重复需求。');return false;}
  if(draft.attempt&&draft.attempt!==attempt){draft.requestId=dockingRequestId();body.requestId=draft.requestId;attempt=JSON.stringify(body);}
  draft.values=JSON.parse(JSON.stringify(demand));draft.attempt=attempt;draft.pending=true;if(button){button.disabled=true;button.textContent='正在提交…';}fail('');
  try{
    var response=await fetch('/api/industry-demand',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result;
    try{result=await response.json();}catch(_){throw dockingActionError('未收到保存结果，请按原内容重试。');}
    if(!response.ok||!result||result.ok!==true)throw dockingActionError(result&&result.message||'需求尚未保存，请重试。',response.status>=400&&response.status<500&&response.status!==408);
    if(draft.epoch!==dockingActionEpoch()||directDemandWorkspaceKey()!==draft.key)return false;
    if(!result.projectKey||result.projectKey===draft.key||!result.project||result.project.id!==result.projectKey||result.project.isDemand!==true||result.project.submissionState!=='submitted'||result.project.demandContract!=='industry-demand-v1'||result.project.workspaceId!==draft.key||result.project.demandOrigin!=='direct'||result.project.directRequestId!==body.requestId||!result.demand||result.demand.demandContract!=='industry-demand-v1'||result.demand.demandOrigin!=='direct'||result.demand.directRequestId!==body.requestId||!result.demand.id||result.demand.projKey!==result.projectKey||Object.keys(demand).some(function(field){return !result.project.demandSpec||result.project.demandSpec[field]!==demand[field]||!result.demand.demandSpec||result.demand.demandSpec[field]!==demand[field];}))throw dockingActionError('保存回执与本条需求不一致，请刷新核对。');
    var forbidden=['selectedPriority','sourceProjectKey','sourceAnalysisTopic','sourcePriorityKey','sourceReportIdentity','sourceReportFingerprint'];
    if(forbidden.some(function(field){return field in result.project||field in result.demand;})||result.project.demandTitle!==demand.title||result.project.topic!==demand.title||result.demand.need!==demand.description||result.demand.note!==demand.conditions||result.demand.demandTitle!==demand.title||result.project.demandSpec.source!=='user_direct'||result.project.demandSpec.verificationStatus!=='user_stated'||!result.reportState||Object.keys(result.reportState).length)throw dockingActionError('直接需求回执包含不一致的来源或内容，请刷新核对。');
    var current=PROJECTS[result.projectKey];
    if(current&&(current.directRequestId!==body.requestId||current.workspaceId!==draft.key||current.demandOrigin!=='direct'))throw dockingActionError('已有需求与回执不一致，请刷新核对。');
    if(!current)PROJECTS[result.projectKey]=result.project;var index=DEMANDS.findIndex(function(row){return row.id===result.demand.id;});if(index<0)DEMANDS.push(result.demand);
    if(typeof REPORTSTATE!=='undefined'&&!REPORTSTATE[result.projectKey])REPORTSTATE[result.projectKey]=result.reportState||{};
    try{persist();}catch(_){}
    if(DIRECT_DEMAND_DRAFT===draft){DIRECT_DEMAND_DRAFT=null;closeModal();window.__projOpen=result.projectKey;if(typeof dockingViewState==='function'){dockingViewState().selected=result.projectKey;dockingViewState().filter='all';dockingViewState().search='';}view='home';render();}
    toast('招商需求已提交，等待管理端受理');return true;
  }catch(exception){draft.uncertain=!exception.definitive;if(DIRECT_DEMAND_DRAFT===draft&&draft.epoch===dockingActionEpoch())fail(exception.message||'提交未完成，请重试。');return false;}
  finally{draft.pending=false;if(button&&button.isConnected!==false){button.disabled=false;button.textContent='提交给管理端';}}
}
