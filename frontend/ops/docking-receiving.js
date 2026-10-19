/* Receiving and responding are acknowledged workflow actions, not local status edits. */
var OPS_DOCKING_DRAFTS=Object.create(null);
function opsIsSubmittedDemand(key,project){
  if(!project||project.isDemand!==true||project.archived===true||project.deleted===true||project.submissionState==='pending'||project.submissionState==='failed')return false;
  if(project.submissionState==='submitted')return true;
  return typeof DEMANDS!=='undefined'&&Array.isArray(DEMANDS)&&DEMANDS.some(function(row){return row&&row.projKey===key;});
}
function opsIntakeStatus(project){
  var intake=project&&project.intake;
  return intake&&intake.contract==='docking-action-v1'&&['processing','needs_info','feedback'].indexOf(intake.status)>=0?intake.status:'submitted';
}
function opsIntakeLabel(status){return {submitted:'待受理',processing:'处理中',needs_info:'待客户补充',feedback:'已反馈'}[status]||'待受理';}
function opsIntakeBadge(project){var status=opsIntakeStatus(project),label=status==='submitted'&&project.intake&&project.intake.lastSupplementAt?'已补充 · 待复核':opsIntakeLabel(status);return '<span class="ops-receiving-badge is-'+status+'">'+label+'</span>';}
function opsVerificationRequests(project){return (project&&Array.isArray(project.clues)?project.clues:[]).filter(function(clue){var r=clue&&clue.verificationRequest;return r&&r.contract==='docking-action-v1'&&typeof r.id==='string'&&r.id&&['requested','processing','needs_info','completed'].indexOf(r.status)>=0;});}
function opsSetReceivingFilter(status){if(['all','submitted','processing','needs_info','feedback'].indexOf(status)<0)return;OPS_UI.demands.status=status;var select=document.getElementById('opsDemandStatus');if(select)select.value=status;renderOpsV2();}
function opsReceivingOverview(){
  var keys=Object.keys(PROJECTS||{}).filter(function(key){return opsIsSubmittedDemand(key,PROJECTS[key]);}),counts={submitted:0,processing:0,needs_info:0,feedback:0},requested=0;
  keys.forEach(function(key){counts[opsIntakeStatus(PROJECTS[key])]++;requested+=opsVerificationRequests(PROJECTS[key]).filter(function(c){return c.verificationRequest.status!=='completed';}).length;});
  return '<div class="ops-receiving-overview">'+[['submitted','待受理'],['processing','处理中'],['needs_info','待客户补充'],['feedback','已反馈']].map(function(item){return '<button type="button" class="ops-receiving-metric'+(OPS_UI.demands.status===item[0]?' is-active':'')+'" onclick="'+dockingActionCall('opsSetReceivingFilter',[item[0]])+'"><span>'+item[1]+'</span><strong>'+counts[item[0]]+'</strong></button>';}).join('')+'<div class="ops-receiving-metric"><span>待处理企业核验</span><strong>'+requested+'</strong></div></div>';
}
function opsDockingDraft(kind,key,clueId){
  var mapKey=JSON.stringify([typeof _authEpoch==='number'?_authEpoch:0,kind,key,clueId||null]);
  if(OPS_DOCKING_DRAFTS[mapKey])return OPS_DOCKING_DRAFTS[mapKey];
  var project=PROJECTS[key]||{},request=kind==='verification'&&((project.clues||[]).find(function(c){return c&&c.id===clueId;})||{}).verificationRequest,record=kind==='verification'?request:project.intake;
  record=record&&record.contract==='docking-action-v1'?record:{};
  var draft={mapKey:mapKey,key:key,kind:kind,clueId:clueId||null,requestId:dockingRequestId(),expectedVersion:Number(record.version)||0,pending:false,uncertain:false,attempt:null,error:'',values:{status:kind==='verification'?(record.status==='needs_info'?'needs_info':record.status==='completed'?'completed':'processing'):(record.status||'processing'),owner:record.owner||'',nextStep:record.nextStep||'',note:'',outcome:record.outcome||'',evidence:record.evidence||''}};
  if(draft.values.status==='submitted')draft.values.status='processing';
  OPS_DOCKING_DRAFTS[mapKey]=draft;return draft;
}
function opsDockingDraftChange(kind,key,clueId,field,value){var draft=opsDockingDraft(kind,key,clueId);if(!draft.pending)draft.values[field]=String(value);}
function opsDockingField(kind,key,clueId,field){return dockingActionCall('opsDockingDraftChange',[kind,key,clueId,field]) .replace(/\)$/ ,',this.value)');}
function opsReceivingPanel(key,project){
  var draft=opsDockingDraft('intake',key,null),v=draft.values,intake=project.intake&&project.intake.contract==='docking-action-v1'?project.intake:null;
  return '<section class="ops-receiving-panel" aria-label="需求受理与客户回复"><div class="ops-receiving-head"><div><span class="ops-receiving-eyebrow">客户需求 · 接收与反馈</span><h3>明确负责人，把下一步交代清楚</h3></div>'+opsIntakeBadge(project)+'</div>'+
    (typeof opsDemandSpecificationHtml==='function'?'<div class="ops-receiving-spec">'+opsDemandSpecificationHtml(project)+'</div>':'')+
    (intake?'<div class="ops-receiving-current"><strong>'+_authEscape(intake.owner||'尚未指定负责人')+'</strong><span>最近处理 '+_authEscape(opsDate(intake.updatedAt))+' · '+_authEscape(intake.updatedBy||'管理端')+'</span>'+(intake.nextStep?'<p><b>下一步</b>'+_authEscape(intake.nextStep)+'</p>':'')+(intake.reply?'<p><b>已发给客户</b>'+_authEscape(intake.reply)+'</p>':'')+'</div>':'<p class="ops-receiving-help">客户已提交这条具体需求。受理后，负责人、下一步和回复将同步显示在客户端。</p>')+
    '<div class="ops-receiving-form"><label>处理状态<select id="receiving-status-'+_authEscape(key)+'" onchange="'+opsDockingField('intake',key,null,'status')+'">'+[['processing','受理并处理中'],['needs_info','需要客户补充'],['feedback','反馈本轮结果']].map(function(item){return '<option value="'+item[0]+'"'+(v.status===item[0]?' selected':'')+'>'+item[1]+'</option>';}).join('')+'</select></label>'+
    '<label>负责人<input id="receiving-owner-'+_authEscape(key)+'" maxlength="100" value="'+_authEscape(v.owner)+'" placeholder="填写实际承办人或团队" oninput="'+opsDockingField('intake',key,null,'owner')+'"></label>'+
    '<label class="is-wide">下一步安排<input id="receiving-nextStep-'+_authEscape(key)+'" maxlength="2000" value="'+_authEscape(v.nextStep)+'" placeholder="例如：核对企业产品目录，并于约定时间回复筛选结果" oninput="'+opsDockingField('intake',key,null,'nextStep')+'"></label>'+
    '<label class="is-wide">给客户的回复<textarea id="receiving-note-'+_authEscape(key)+'" maxlength="10000" rows="3" placeholder="说明已完成的工作、需要补充的材料或本轮结果" oninput="'+opsDockingField('intake',key,null,'note')+'">'+_authEscape(v.note)+'</textarea></label></div>'+
    '<div class="ops-receiving-submit"><p id="receiving-error-'+_authEscape(key)+'" role="alert">'+_authEscape(draft.error)+'</p><button id="receiving-save-'+_authEscape(key)+'" type="button" class="ops-ui-button is-primary"'+(draft.pending?' disabled':'')+' onclick="'+dockingActionCall('opsSaveReceiving',[key])+'">'+(draft.pending?'正在保存…':'保存并回复客户')+'</button></div></section>';
}
function opsCustomerActivity(key){
  var logs=typeof dockingLogRecords==='function'?dockingLogRecords(key):[];
  function filesHtml(files){return (Array.isArray(files)?files:[]).filter(function(file){return file&&typeof file.dataUrl==='string'&&typeof dockingValidateFiles==='function'&&!dockingValidateFiles([file]);}).map(function(file){return '<a class="ops-receiving-file" href="'+_authEscape(file.dataUrl)+'" download="'+_authEscape(file.name)+'">↓ '+_authEscape(file.name)+' <span>'+Math.max(1,Math.round(file.size/1024))+' KB</span></a>';}).join('');}
  var kinds={contact_log:'客户跟进记录',verification_request:'客户申请企业核验',review_demand:'需求处理回复',review_verification:'企业核验反馈',advance_stage:'项目阶段更新',supplement_demand:'客户补充材料'};
  return '<section class="ops-receiving-activity"><div class="ops-receiving-head"><div><span class="ops-receiving-eyebrow">双方协作记录</span><h3>客户材料与处理回执</h3></div><span class="ops-receiving-count">'+logs.length+' 条</span></div>'+(logs.length?'<div class="ops-receiving-timeline">'+logs.map(function(row){return '<article><div class="ops-receiving-event-head"><strong>'+_authEscape(kinds[row.kind]||row.type||'协作记录')+'</strong><span>'+_authEscape(opsDate(row.ts))+'</span></div><div class="ops-receiving-event-meta">'+_authEscape(row.actor||'未记录账号')+(row.actorRole==='admin'?' · 管理端':' · 客户端')+(row.clueName?' · '+_authEscape(row.clueName):'')+'</div>'+(row.note?'<p>'+_authEscape(row.note)+'</p>':'')+(row.owner?'<p>负责人：'+_authEscape(row.owner)+'</p>':'')+(row.nextStep?'<p>下一步：'+_authEscape(row.nextStep)+'</p>':'')+(row.outcome?'<p>本轮结论：'+_authEscape({further_contact:'具备进一步对接条件',not_suitable:'暂不适配本条需求',insufficient:'现有材料无法形成结论'}[row.outcome]||row.outcome)+'</p>':'')+(row.evidence?'<p>核验依据：'+_authEscape(row.evidence)+'</p>':'')+filesHtml(row.files)+'</article>';}).join('')+'</div>':'<p class="ops-receiving-help">客户尚未补充跟进记录。后续提交的说明、附件与处理回复将在这里保留。</p>')+'</section>';
}
function opsVerificationPanel(key,project){
  var clues=opsVerificationRequests(project);if(!clues.length)return '';
  var labels={requested:'待处理',processing:'核验中',needs_info:'待补充',completed:'已反馈'},outcomes={further_contact:'具备进一步对接条件',not_suitable:'暂不适配本条需求',insufficient:'现有材料无法形成结论'};
  return '<section class="ops-receiving-verifications"><div class="ops-receiving-head"><div><span class="ops-receiving-eyebrow">客户申请 · 企业核验</span><h3>逐家核对，逐家回复</h3></div><span class="ops-receiving-count">'+clues.length+' 家</span></div>'+clues.map(function(clue){var r=clue.verificationRequest,draft=opsDockingDraft('verification',key,clue.id),v=draft.values,token=key+'-'+clue.id;return '<article class="ops-verification-card"><div class="ops-receiving-head"><div><h4>'+_authEscape(clue.name||'未记录企业名称')+'</h4><p class="ops-receiving-help">申请人 '+_authEscape(r.requestedBy||'未记录')+' · '+_authEscape(opsDate(r.requestedAt))+'</p></div><span class="ops-receiving-badge is-'+(r.status==='completed'?'feedback':r.status==='needs_info'?'needs_info':'processing')+'">'+labels[r.status]+'</span></div>'+(clue.reason?'<p class="ops-receiving-context">客户提供的线索说明：'+_authEscape(clue.reason)+'</p>':'')+
      (r.reply?'<div class="ops-receiving-current"><strong>'+_authEscape(outcomes[r.outcome]||labels[r.status])+'</strong><p>'+_authEscape(r.reply)+'</p>'+(r.evidence?'<p><b>核验依据</b>'+_authEscape(r.evidence)+'</p>':'')+'</div>':'')+
      '<div class="ops-receiving-form"><label>核验状态<select id="verification-status-'+_authEscape(token)+'" onchange="'+opsDockingField('verification',key,clue.id,'status')+'">'+[['processing','开始 / 继续核验'],['needs_info','需要补充信息'],['completed','反馈核验结论']].map(function(item){return '<option value="'+item[0]+'"'+(v.status===item[0]?' selected':'')+'>'+item[1]+'</option>';}).join('')+'</select></label><label>本轮结论<select id="verification-outcome-'+_authEscape(token)+'" onchange="'+opsDockingField('verification',key,clue.id,'outcome')+'"><option value="">完成核验时选择</option>'+Object.keys(outcomes).map(function(value){return '<option value="'+value+'"'+(v.outcome===value?' selected':'')+'>'+outcomes[value]+'</option>';}).join('')+'</select></label>'+
      '<label class="is-wide">回复与待办<textarea id="verification-note-'+_authEscape(token)+'" rows="3" maxlength="10000" placeholder="说明本次实际核对的情况，以及需要客户配合的事项" oninput="'+opsDockingField('verification',key,clue.id,'note')+'">'+_authEscape(v.note)+'</textarea></label><label class="is-wide">核验依据<textarea id="verification-evidence-'+_authEscape(token)+'" rows="2" maxlength="10000" placeholder="记录来源、核对日期、产品适配情况和仍未确认的事项；完成核验时必填" oninput="'+opsDockingField('verification',key,clue.id,'evidence')+'">'+_authEscape(v.evidence)+'</textarea></label></div><p class="ops-receiving-help">“具备进一步对接条件”仅表示可继续沟通，不代表企业已确认投资意向。</p><div class="ops-receiving-submit"><p id="verification-error-'+_authEscape(token)+'" role="alert">'+_authEscape(draft.error)+'</p><button type="button" id="verification-save-'+_authEscape(token)+'" class="ops-ui-button is-primary"'+(draft.pending?' disabled':'')+' onclick="'+dockingActionCall('opsSaveVerification',[key,clue.id])+'">'+(draft.pending?'正在保存…':'保存核验反馈')+'</button></div></article>';}).join('')+'</section>';
}
function opsDockingReadFields(draft,fields,prefix){fields.forEach(function(field){var el=document.getElementById(prefix+'-'+field+'-'+draft.key+(draft.clueId?'-'+draft.clueId:''));if(el)draft.values[field]=String(el.value||'');});}
function opsDockingSetError(draft,message){draft.error=message;var id=(draft.kind==='verification'?'verification':'receiving')+'-error-'+draft.key+(draft.clueId?'-'+draft.clueId:''),el=document.getElementById(id);if(el)el.textContent=message;else toast(message);}
async function opsDockingSubmit(draft,body){
  if(draft.pending)return false;
  var fingerprint=JSON.stringify(body);
  if(draft.uncertain&&draft.attempt!==fingerprint){opsDockingSetError(draft,'上次保存结果尚未确认，请先按原内容重试，确认保存后再补充新的回复。');return false;}
  if(draft.attempt&&draft.attempt!==fingerprint){draft.requestId=dockingRequestId();body.requestId=draft.requestId;fingerprint=JSON.stringify(body);}
  draft.attempt=fingerprint;draft.pending=true;opsDockingSetError(draft,'');
  var id=(draft.kind==='verification'?'verification':'receiving')+'-save-'+draft.key+(draft.clueId?'-'+draft.clueId:''),button=document.getElementById(id);if(button){button.disabled=true;button.textContent='正在保存…';}
  try{var result=await dockingSendWorkflow(body);if(!result)return false;delete OPS_DOCKING_DRAFTS[draft.mapKey];var note=document.getElementById((draft.kind==='verification'?'verification':'receiving')+'-note-'+draft.key+(draft.clueId?'-'+draft.clueId:''));if(note)note.value='';if(typeof renderOpsV2==='function')renderOpsV2();toast(result.created?'回复已保存，客户端可查看':'这条回复已保存，没有重复创建');return true;}
  catch(error){draft.uncertain=!error.definitive;opsDockingSetError(draft,error.message||'保存未完成，请按原内容重试。');return false;}
  finally{draft.pending=false;if(button&&button.isConnected!==false){button.disabled=false;button.textContent=draft.kind==='verification'?'保存核验反馈':'保存并回复客户';}}
}
function opsSaveReceiving(key){
  var draft=opsDockingDraft('intake',key,null);opsDockingReadFields(draft,['status','owner','nextStep','note'],'receiving');var v=draft.values;
  if(['processing','needs_info','feedback'].indexOf(v.status)<0||!v.owner.trim()||!v.nextStep.trim()||!v.note.trim()){opsDockingSetError(draft,'请填写负责人、下一步安排和给客户的回复。');return Promise.resolve(false);}
  return opsDockingSubmit(draft,{projectKey:key,action:'review_demand',requestId:draft.requestId,expectedVersion:draft.expectedVersion,record:{status:v.status,owner:v.owner.trim(),nextStep:v.nextStep.trim(),note:v.note.trim()}});
}
function opsSaveVerification(key,clueId){
  var draft=opsDockingDraft('verification',key,clueId);opsDockingReadFields(draft,['status','outcome','note','evidence'],'verification');var v=draft.values;
  if(['processing','needs_info','completed'].indexOf(v.status)<0||!v.note.trim()){opsDockingSetError(draft,'请填写本次核验回复。');return Promise.resolve(false);}
  if(v.status==='completed'&&(['further_contact','not_suitable','insufficient'].indexOf(v.outcome)<0||!v.evidence.trim())){opsDockingSetError(draft,'反馈核验结论时，请选择本轮结论并填写具体核验依据。');return Promise.resolve(false);}
  var record={status:v.status,note:v.note.trim()};if(v.status==='completed')record.outcome=v.outcome;if(v.evidence.trim())record.evidence=v.evidence.trim();
  return opsDockingSubmit(draft,{projectKey:key,clueId:clueId,action:'review_verification',requestId:draft.requestId,expectedVersion:draft.expectedVersion,record:record});
}
async function opsSaveStageAction(key,target,note){
  var draft=opsDockingDraft('stage',key,null),project=PROJECTS[key];if(!project||draft.pending)return false;
  if(!draft.attempt)draft.expectedVersion=Number(project.stageVersion)||0;
  var body={projectKey:key,action:'advance_stage',requestId:draft.requestId,expectedVersion:draft.expectedVersion,record:{target:target,note:note}},fingerprint=JSON.stringify(body);
  if(draft.uncertain&&draft.attempt!==fingerprint){toast('上次保存结果尚未确认，请先按原内容重试。');return false;}
  if(draft.attempt&&draft.attempt!==fingerprint){draft.requestId=dockingRequestId();body.requestId=draft.requestId;fingerprint=JSON.stringify(body);}
  draft.attempt=fingerprint;draft.pending=true;
  try{var result=await dockingSendWorkflow(body);if(!result)return false;delete OPS_DOCKING_DRAFTS[draft.mapKey];var field=document.getElementById('stage-note-'+key);if(field)field.value='';if(typeof renderOpsV2==='function')renderOpsV2();toast('阶段更新已保存，客户端可查看');return true;}
  catch(error){draft.uncertain=!error.definitive;toast(error.message||'阶段更新尚未保存，请重试。');return false;}
  finally{draft.pending=false;}
}
