/* Explicit docking receipts: a request or a note never certifies an enterprise. */
var DOCKING_LOG_DRAFT=null;
var DOCKING_CLUE_DRAFT=null;
var DOCKING_VERIFY_REQUESTS={};
var DOCKING_FILE_TYPES={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',txt:'text/plain',csv:'text/csv',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
function dockingActionText(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function dockingActionCall(name,args){return dockingActionText(name+'('+args.map(function(value){return JSON.stringify(value);}).join(',')+')');}
function dockingLogRecords(key){
  var rows=typeof DOCK_LOGS!=='undefined'&&DOCK_LOGS&&DOCK_LOGS[key];
  return (Array.isArray(rows)?rows:[]).filter(function(row){return row&&typeof row==='object'&&!Array.isArray(row);}).slice().sort(function(a,b){return (Number(b.ts)||0)-(Number(a.ts)||0);});
}
function dockingMergeLogRecords(key,received){
  var seen=Object.create(null),merged=[];
  dockingLogRecords(key).concat(Array.isArray(received)?received:[]).forEach(function(row){
    if(!row||typeof row!=='object'||Array.isArray(row))return;
    var identity=typeof row.id==='string'&&row.id?'id:'+row.id:'legacy:'+JSON.stringify([row.ts==null?null:row.ts,row.type||'',row.note||'']);
    if(seen[identity])return;seen[identity]=true;merged.push(row);
  });
  return merged.sort(function(a,b){return (Number(b.ts)||0)-(Number(a.ts)||0);});
}
function dockingClueState(key,clue){
  if(!clue||typeof clue!=='object')return {key:'pending',label:'待核验',tone:'slate',detail:'尚未保存核验记录。',canRequest:false};
  var hasId=typeof clue.id==='string'&&!!clue.id;
  var request=clue.verificationRequest;
  if(request&&request.contract==='docking-action-v1'&&typeof request.id==='string'&&request.id){
    if(request.status==='processing')return {key:'processing',label:'核验处理中',tone:'blue',detail:request.reply||'资源团队正在核对本条企业线索。',canRequest:false};
    if(request.status==='needs_info')return {key:'needs_info',label:'核验需补充资料',tone:'amber',detail:request.reply||'请补充企业资料或待核问题。',canRequest:false};
    if(request.status==='completed'){var labels={further_contact:'建议进一步对接',not_suitable:'本次需求不适配',insufficient:'依据仍不足'};return {key:'completed',label:labels[request.outcome]||'已反馈核验结果',tone:request.outcome==='further_contact'?'teal':request.outcome==='not_suitable'?'rose':'amber',detail:request.reply||'核验记录已反馈，请查看具体依据。',canRequest:false};}
    return {key:'requested',label:'已申请核验',tone:'amber',detail:'核验申请已保存，等待资源团队处理；尚未形成核验结论。',canRequest:false};
  }
  if(hasId&&dockingLogRecords(key).some(function(row){return row.contract==='docking-action-v1'&&row.kind==='contact_log'&&row.clueId===clue.id&&typeof row.id==='string'&&row.id;})){
    return {key:'followed',label:'已记录跟进',tone:'blue',detail:'已保存这家企业的跟进记录，具体情况以记录内容为准，尚不代表核验通过。',canRequest:true};
  }
  if(clue.review&&clue.review.scope==='human_match_review_pending'&&clue.review.product&&clue.review.demand)return {key:'matched',label:'已核对产品适配',tone:'blue',detail:'已有产品与需求的人工适配意见，联系情况与投资意向仍待核实。',canRequest:hasId};
  if(clue.tone==='teal'||clue.tone==='amber'||/核验通过|已核验|可安排|可沟通|核验中/.test(String(clue.status||''))){
    return {key:'legacy',label:'历史状态待复核',tone:'slate',detail:'原有状态尚无对应的核验凭据，需要重新核对；颜色不作为核验结论。',canRequest:hasId};
  }
  return {key:'pending',label:'待核验',tone:'slate',detail:hasId?'尚未保存核验申请，可先核对产品依据并记录具体问题。':'线索标识缺失，请先完善企业资料。',canRequest:hasId};
}
function dockingActionEpoch(){return typeof _authEpoch==='number'?_authEpoch:0;}
function dockingProjectIdentity(project){
  if(!project)return '';
  return JSON.stringify(['workspaceId','parentProjectKey','parentKey','sourceProjectKey','sourceAnalysisTopic','sourcePriorityKey','demandTitle','topic','submissionState'].map(function(key){return project[key]==null?null:project[key];}));
}
function dockingActionContext(key,clueId){
  var project=typeof PROJECTS!=='undefined'&&PROJECTS[key];
  if(!project||project.isDemand!==true){toast('请先选择已提交的具体招商需求');return null;}
  var clue=clueId==null?null:(Array.isArray(project.clues)?project.clues:[]).find(function(item){return item&&item.id===clueId;});
  if(clueId!=null&&!clue){toast('这条企业线索已变化，请刷新后重新选择');return null;}
  return {key:key,clueId:clueId==null?null:clueId,epoch:dockingActionEpoch(),identity:dockingProjectIdentity(project)};
}
function dockingActionContextCurrent(context){
  var project=typeof PROJECTS!=='undefined'&&PROJECTS[context.key];
  return context.epoch===dockingActionEpoch()&&project&&project.isDemand===true&&dockingProjectIdentity(project)===context.identity&&(context.clueId==null||(Array.isArray(project.clues)?project.clues:[]).some(function(clue){return clue&&clue.id===context.clueId;}));
}
function dockingActionRequestId(){
  if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')return 'dock-'+crypto.randomUUID();
  return 'dock-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
}
function dockingActionError(message,definitive){var error=new Error(message);error.definitive=!!definitive;return error;}
async function dockingSendAction(context,body){
  if(!dockingActionContextCurrent(context))throw dockingActionError('当前会话、需求或企业已变化，请重新打开后操作。',true);
  var response=await fetch('/api/docking-action',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  var result;try{result=await response.json();}catch(_){throw dockingActionError('未收到保存结果，请按原内容重试。');}
  if(!response.ok||!result||result.ok!==true)throw dockingActionError(result&&result.message||result&&result.error||'操作尚未保存，请重试。',response.status>=400&&response.status<500&&response.status!==408);
  if(!dockingActionContextCurrent(context))return null;
  if(result.projectKey!==context.key||!result.project||result.project.isDemand!==true||dockingProjectIdentity(result.project)!==context.identity||!Array.isArray(result.logs)||(result.demand&&result.demand.projKey!==context.key))throw dockingActionError('服务端返回的需求不一致，请刷新核对后重试。');
  var kind=body.action==='request_verification'?'verification_request':'contact_log';
  var receipt=result.logs.find(function(row){return row&&row.contract==='docking-action-v1'&&row.requestId===body.requestId&&row.kind===kind&&(row.clueId==null?null:row.clueId)===context.clueId;});
  if(!receipt||!receipt.id)throw dockingActionError('服务端未返回本次保存凭据，请按原内容重试。');
  if(body.record&&(receipt.type!==body.record.type||receipt.note!==body.record.note||JSON.stringify(receipt.files||[])!==JSON.stringify(body.record.files||[])))throw dockingActionError('返回的跟进内容与本次提交不一致，请刷新核对。');
  if(body.action==='request_verification'){
    var clue=(result.project.clues||[]).find(function(item){return item&&item.id===context.clueId;});
    if(!clue||!clue.verificationRequest||clue.verificationRequest.contract!=='docking-action-v1'||clue.verificationRequest.id!==receipt.id||['requested','processing','needs_info','completed'].indexOf(clue.verificationRequest.status)<0)throw dockingActionError('未收到企业核验申请的保存凭据，请按原请求重试。');
  }
  // This response may predate a concurrent note, clue edit or stage update.
  // Merge only the operation's immutable receipt into the current project.
  if(body.action==='request_verification'){
    var currentClue=(PROJECTS[context.key].clues||[]).find(function(item){return item&&item.id===context.clueId;});
    if(currentClue){var savedRequest=currentClue.verificationRequest,returnedRequest=clue.verificationRequest;if(!savedRequest||savedRequest.contract!=='docking-action-v1'||(savedRequest.id===returnedRequest.id&&Number(returnedRequest.version||0)>Number(savedRequest.version||0)))currentClue.verificationRequest=JSON.parse(JSON.stringify(returnedRequest));}
  }
  if(typeof DOCK_LOGS==='undefined'||!DOCK_LOGS)DOCK_LOGS={};
  DOCK_LOGS[context.key]=dockingMergeLogRecords(context.key,result.logs);
  try{if(typeof persist==='function')persist();}catch(_){/* The server receipt remains authoritative when local storage is full. */}
  return result;
}
function dockingLogError(message){var box=document.getElementById('dockingLogError');if(box)box.textContent=message;else toast(message);}
function openDockingLog(key,clueId,operation){
  var context=dockingActionContext(key,clueId);if(!context)return false;
  if(DOCKING_LOG_DRAFT&&DOCKING_LOG_DRAFT.pending&&DOCKING_LOG_DRAFT.context.epoch===context.epoch){toast('正在保存上一条记录，请稍候');return false;}
  var project=PROJECTS[key],clue=context.clueId==null?null:(project.clues||[]).find(function(item){return item.id===context.clueId;});
  DOCKING_LOG_DRAFT={context:context,requestId:dockingActionRequestId(),files:[],pending:false,reading:false,attempt:null,uncertain:false};
  var supplement=operation==='supplement_demand';if(supplement){DOCKING_LOG_DRAFT.operation=operation;DOCKING_LOG_DRAFT.expectedVersion=Number(dockingIntake(project).version)||0;}
  var title=typeof industryDemandProjectTitle==='function'?industryDemandProjectTitle(project):project.demandTitle||project.topic||'';
  var body='<div class="docking-log-form"><div class="docking-log-context"><span>招商需求</span><strong>'+dockingActionText(title)+'</strong>'+(clue?'<span>对应企业</span><strong>'+dockingActionText(clue.name||'名称未记录')+'</strong>':'<p>'+(supplement?'按照管理端反馈补充说明或材料，内容将回传到这条需求。':'本次记录归入这条需求，可在企业卡片中记录单家企业的跟进。')+'</p>')+'</div><label for="dockingLogType"'+(supplement?' hidden':'')+'>跟进方式</label><select id="dockingLogType"'+(supplement?' hidden disabled':'')+'><option value="visit">拜访交流</option><option value="call">电话沟通</option><option value="email">邮件沟通</option><option value="material">材料往来</option><option value="note">跟进备注</option></select><label for="dockingLogNote">'+(supplement?'补充说明':'实际情况')+'</label><textarea id="dockingLogNote" rows="5" maxlength="10000" placeholder="'+(supplement?'填写管理端要求的说明，或上传相关材料':'记录实际沟通内容、了解到的情况和下一步事项')+'"></textarea><label for="dockingLogFiles">附件 <span>（选填）</span></label><input id="dockingLogFiles" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.doc,.docx,.xlsx,.pptx" onchange="dockingAddLogFiles(this)"><p class="docking-form-help">最多 5 个附件，单个不超过 5 MB，合计不超过 10 MB。支持文档、图片和 UTF-8 文本。</p><div id="dockingLogFileList"></div><p class="docking-form-help">记录保存后可追溯；记录本身不代表企业核验通过或投资意向已确认。</p><p id="dockingLogError" class="docking-form-error" role="alert"></p></div>';
  openModal(supplement?'补充需求资料':'记录真实跟进',body,'<button class="secondary-button" onclick="closeModal()">取消</button><button id="dockingLogSave" class="primary-button" onclick="submitDockingLog()">'+(supplement?'提交补充资料':'保存跟进记录')+'</button>');return true;
}
function dockingLogFileList(){
  var box=document.getElementById('dockingLogFileList'),draft=DOCKING_LOG_DRAFT;if(!box||!draft)return;
  box.innerHTML=draft.files.map(function(file,index){return '<div class="docking-draft-file"><span>'+dockingActionText(file.name)+' <small>'+Math.max(1,Math.round(file.size/1024))+' KB</small></span><button type="button" aria-label="移除 '+dockingActionText(file.name)+'" onclick="dockingRemoveLogFile('+index+')">移除</button></div>';}).join('');
}
function dockingRemoveLogFile(index){var draft=DOCKING_LOG_DRAFT;if(!draft||draft.pending||draft.reading)return;draft.files.splice(index,1);dockingLogFileList();}
function dockingValidateFiles(files){
  if(!Array.isArray(files)||files.length>5)return '附件最多 5 个。';
  var total=0;
  for(var i=0;i<files.length;i++){
    var file=files[i],name=file&&file.name,type=name&&DOCKING_FILE_TYPES[String(name).split('.').pop().toLowerCase()];
    if(typeof name!=='string'||!name.trim()||name!==name.trim()||name.length>180||/[\\/\x00-\x1f\x7f]/.test(name)||!type)return '请选择支持的文档、图片或文本文件。';
    if(!Number.isInteger(file.size)||file.size<=0||file.size>5*1024*1024)return '单个附件须大于 0 且不超过 5 MB。';
    total+=file.size;if(total>10*1024*1024)return '附件合计不能超过 10 MB。';
    if(file.dataUrl!=null&&(!new RegExp('^data:'+type.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+';base64,[A-Za-z0-9+/]*={0,2}$').test(file.dataUrl)))return '附件内容格式不正确，请重新选择文件。';
  }
  return '';
}
async function dockingAddLogFiles(input){
  var draft=DOCKING_LOG_DRAFT;if(!draft||draft.pending||draft.reading)return false;
  var files=Array.prototype.slice.call(input.files||[]),problem=dockingValidateFiles(draft.files.concat(files));
  if(problem){dockingLogError(problem);input.value='';return false;}
  draft.reading=true;input.disabled=true;
  try{
    var read=await Promise.all(files.map(function(file){return new Promise(function(resolve,reject){var reader=new FileReader();reader.onerror=function(){reject(new Error('附件读取失败，请重新选择。'));};reader.onload=function(){var value=String(reader.result||''),comma=value.indexOf(',');if(comma<0){reject(new Error('附件读取失败，请重新选择。'));return;}var mime=DOCKING_FILE_TYPES[file.name.split('.').pop().toLowerCase()];resolve({name:file.name,size:file.size,dataUrl:'data:'+mime+';base64,'+value.slice(comma+1)});};reader.readAsDataURL(file);});}));
    if(DOCKING_LOG_DRAFT!==draft||!dockingActionContextCurrent(draft.context))return false;
    var invalid=dockingValidateFiles(draft.files.concat(read));if(invalid)throw new Error(invalid);
    draft.files=draft.files.concat(read);dockingLogFileList();dockingLogError('');return true;
  }catch(error){if(DOCKING_LOG_DRAFT===draft)dockingLogError(error.message||'附件读取失败，请重试。');return false;}
  finally{draft.reading=false;input.disabled=false;input.value='';}
}
function openDockingSupplement(key){return openDockingLog(key,null,'supplement_demand');}

async function submitDockingLog(){
  var draft=DOCKING_LOG_DRAFT;if(!draft||draft.pending)return false;
  if(draft.reading){dockingLogError('附件正在读取，请稍候再保存。');return false;}
  if(!dockingActionContextCurrent(draft.context)){dockingLogError('当前会话、需求或企业已变化，请重新打开后记录。');return false;}
  var noteBox=document.getElementById('dockingLogNote'),typeBox=document.getElementById('dockingLogType'),button=document.getElementById('dockingLogSave');
  var note=noteBox&&typeof noteBox.value==='string'?noteBox.value.trim():'',type=typeBox&&typeBox.value||'note';
  if(['visit','call','email','material','note'].indexOf(type)<0||note.length>10000||(!note&&!draft.files.length)){dockingLogError('请填写实际跟进情况，或添加相关附件；正文不超过 10000 字。');return false;}
  var fileError=dockingValidateFiles(draft.files);if(fileError){dockingLogError(fileError);return false;}
  var body={projectKey:draft.context.key,action:'save_log',requestId:draft.requestId,record:{type:type,note:note,files:draft.files.map(function(file){return {name:file.name,size:file.size,dataUrl:file.dataUrl};})}};
  if(draft.operation==='supplement_demand'){body.action='supplement_demand';body.expectedVersion=draft.expectedVersion;body.record={note:note,files:body.record.files};}
  if(draft.context.clueId!=null)body.clueId=draft.context.clueId;
  var fingerprint=JSON.stringify(body);
  if(draft.uncertain&&draft.attempt!==fingerprint){dockingLogError('上次保存结果尚未确认，请先按原内容重试；确认保存后再补充新的记录。');return false;}
  if(draft.attempt&&draft.attempt!==fingerprint){draft.requestId=dockingActionRequestId();body.requestId=draft.requestId;fingerprint=JSON.stringify(body);}
  draft.attempt=fingerprint;draft.pending=true;dockingLogError('');
  if(button){button.disabled=true;button.textContent='正在保存…';}
  try{
    var result=await (draft.operation==='supplement_demand'?dockingSendWorkflow(body):dockingSendAction(draft.context,body));if(!result)return false;
    if(DOCKING_LOG_DRAFT===draft){DOCKING_LOG_DRAFT=null;closeModal();}
    if(typeof render==='function')render();toast(draft.operation==='supplement_demand'?'补充资料已提交，管理端可在该需求下继续处理':result.created?'跟进记录已保存':'这条跟进记录已保存，没有重复创建');return true;
  }catch(error){draft.uncertain=!error.definitive;if(DOCKING_LOG_DRAFT===draft&&draft.context.epoch===dockingActionEpoch())dockingLogError(error.message||'保存未完成，请按原内容重试。');return false;}
  finally{draft.pending=false;if(button&&button.isConnected!==false){button.disabled=false;button.textContent=draft.operation==='supplement_demand'?'提交补充资料':'保存跟进记录';}}
}
async function requestDockingVerification(key,clueId){
  var context=dockingActionContext(key,clueId);if(!context)return false;
  var clue=(PROJECTS[key].clues||[]).find(function(item){return item&&item.id===clueId;});
  if(!dockingClueState(key,clue).canRequest){toast('这条线索已申请核验，尚未形成核验结论');return false;}
  var mapKey=JSON.stringify([context.epoch,key,clueId]),request=DOCKING_VERIFY_REQUESTS[mapKey];
  if(request&&request.pending)return false;
  if(!request||request.identity!==context.identity)request=DOCKING_VERIFY_REQUESTS[mapKey]={requestId:dockingActionRequestId(),identity:context.identity,pending:false};
  request.pending=true;
  try{
    var result=await dockingSendAction(context,{projectKey:key,action:'request_verification',requestId:request.requestId,clueId:clueId});if(!result)return false;
    delete DOCKING_VERIFY_REQUESTS[mapKey];if(typeof render==='function')render();toast(result.created?'核验申请已保存，等待资源团队处理':'核验申请已保存，没有重复创建');return true;
  }catch(error){if(context.epoch===dockingActionEpoch())toast(error.message||'申请未保存，请重试。');return false;}
  finally{request.pending=false;}
}
function recordDockingLegacyLog(key){
  var note=document.getElementById('dock-note-'+key),text=note&&typeof note.value==='string'?note.value:'',files=typeof __dockFiles!=='undefined'&&__dockFiles[key]||[],type=typeof __dockType!=='undefined'&&__dockType[key]||'visit';
  if(!openDockingLog(key))return false;
  var noteBox=document.getElementById('dockingLogNote'),typeBox=document.getElementById('dockingLogType');if(noteBox)noteBox.value=text;if(typeBox&&['visit','call','email','material','note'].indexOf(type)>=0)typeBox.value=type;
  DOCKING_LOG_DRAFT.files=files.map(function(file){return {name:file.name,size:file.size,dataUrl:file.dataUrl};});dockingLogFileList();return submitDockingLog().then(function(saved){
    if(saved){if(note&&note.value===text)note.value='';if(typeof __dockFiles!=='undefined'&&__dockFiles[key]===files)__dockFiles[key]=[];}
    return saved;
  });
}
function dockingContactPathHtml(clue){
  var text=clue&&(clue.contactPath||clue.contactRoute||clue.reachPath);
  return '<section class="docking-contact-material"><h3>已存触达说明</h3><p>'+dockingActionText(typeof text==='string'&&text.trim()?text:'尚未提供触达路径。可在取得实际沟通信息后补充记录。')+'</p></section>';
}
function dockingContactPeopleHtml(clue){
  clue=clue||{};var people=[];
  if(Array.isArray(clue.contacts))people=clue.contacts.filter(function(item){return item&&typeof item==='object';});
  if(clue.contact&&typeof clue.contact==='object'&&!Array.isArray(clue.contact))people.push(clue.contact);
  if(clue.contactInfo&&typeof clue.contactInfo==='object'&&!Array.isArray(clue.contactInfo))people.push(clue.contactInfo);
  if(typeof clue.contactName==='string'||typeof clue.contactPhone==='string'||typeof clue.contactEmail==='string')people.push({name:clue.contactName,phone:clue.contactPhone,email:clue.contactEmail,role:clue.contactRole});
  var rows=people.map(function(person){return [['姓名',person.name],['职务',person.role||person.title],['单位',person.organization],['电话',person.phone],['邮箱',person.email],['来源',person.source]].filter(function(row){return typeof row[1]==='string'&&row[1].trim();}).map(function(row){return '<div><span>'+row[0]+'</span><strong>'+dockingActionText(row[1])+'</strong></div>';}).join('');}).filter(Boolean);
  return '<section class="docking-contact-material"><h3>已存联系人资料 · 待核对</h3>'+(rows.length?rows.map(function(row){return '<div class="docking-contact-person">'+row+'</div>';}).join(''):'<p>尚未提供联系人资料。系统不会生成联系人或联系方式。</p>')+'</section>';
}
function dockingContactMaterialHtml(clue){return '<div class="docking-contact-material"><p>这里只展示已保存的资料。资料的存在不代表可达性、投资意向或核验结论已确认。</p>'+dockingContactPathHtml(clue)+dockingContactPeopleHtml(clue)+'</div>';}
function showDockingContactCard(key,clueId){
  var context=dockingActionContext(key,clueId);if(!context)return false;var project=PROJECTS[key],clue=(project.clues||[]).find(function(item){return item.id===clueId;});
  openModal('已存联系资料 · '+dockingActionText(clue.name||'名称未记录'),dockingContactMaterialHtml(clue),'<button class="secondary-button" onclick="closeModal()">关闭</button><button class="primary-button" onclick="closeModal();'+dockingActionCall('openDockingLog',[key,clueId])+'">记录实际跟进</button>');return true;
}
function dockingIsManualClue(clue){return !!clue&&(clue.source==='manual_entry'||clue.source==='manual'||clue.source==='招商干部录入'||clue.status==='manual_entry');}
function openDockingClueEditor(key,clueId){
  var context=dockingActionContext(key,clueId);if(!context)return false;
  if(DOCKING_CLUE_DRAFT&&DOCKING_CLUE_DRAFT.pending&&DOCKING_CLUE_DRAFT.context.epoch===context.epoch){toast('正在保存企业资料，请稍候');return false;}
  var project=PROJECTS[key],clue=context.clueId==null?null:(project.clues||[]).find(function(item){return item.id===context.clueId;});
  if(clue&&!dockingIsManualClue(clue)){
    DOCKING_CLUE_DRAFT=null;
    openModal('企业资料 · 只读','<div class="docking-log-form"><div class="docking-log-context"><strong>'+dockingActionText(clue.name||'名称未记录')+'</strong><p>'+dockingActionText([clue.kind,clue.region].filter(Boolean).join(' · '))+'</p></div><p>'+dockingActionText(clue.reason||'尚未保存匹配理由')+'</p><p class="docking-form-help">这条企业资料来自已保存的来源记录。补充核验情况请使用“记录跟进”，保留原始资料及其依据。</p></div>','<button class="secondary-button" onclick="closeModal()">关闭</button><button class="primary-button" onclick="closeModal();'+dockingActionCall('openDockingLog',[key,clueId])+'">记录跟进</button>');return true;
  }
  DOCKING_CLUE_DRAFT={context:context,id:clue?clue.id:'clue_manual_'+dockingActionRequestId(),pending:false,original:clue?JSON.stringify(clue):null};
  var title=typeof industryDemandProjectTitle==='function'?industryDemandProjectTitle(project):project.demandTitle||project.topic||'';
  var fields=[['name','企业名称',200],['kind','主营业务',200],['region','所在区域',200],['sourceURL','来源链接（选填）',2048]];
  var body='<div class="docking-log-form"><div class="docking-log-context"><span>招商需求</span><strong>'+dockingActionText(title)+'</strong></div>'+fields.map(function(field){return '<label for="dockingClue-'+field[0]+'">'+field[1]+'</label><input id="dockingClue-'+field[0]+'" maxlength="'+field[2]+'" value="'+dockingActionText(clue&&clue[field[0]]||'')+'">';}).join('')+'<label for="dockingClue-reason">与本条需求的关系</label><textarea id="dockingClue-reason" maxlength="4000" rows="4" placeholder="填写已了解到的主营产品、与具体需求的关系和待核问题">'+dockingActionText(clue&&clue.reason||'')+'</textarea><p class="docking-form-help">手工录入的资料会标为待核验；来源链接不代表原文内容或企业能力已经核实。</p><p id="dockingClueError" class="docking-form-error" role="alert"></p></div>';
  openModal(clue?'编辑手工企业资料':'录入企业资料',body,'<button class="secondary-button" onclick="closeModal()">取消</button><button id="dockingClueSave" class="primary-button" onclick="saveDockingClue()">保存企业资料</button>');return true;
}
async function saveDockingClue(){
  var draft=DOCKING_CLUE_DRAFT;if(!draft||draft.pending)return false;
  var error=document.getElementById('dockingClueError'),button=document.getElementById('dockingClueSave');
  function fail(message){if(error)error.textContent=message;else toast(message);}
  if(!dockingActionContextCurrent(draft.context)){fail('当前会话、需求或企业已变化，请重新打开后操作。');return false;}
  var fields={};for(var name of ['name','kind','region','reason','sourceURL']){var input=document.getElementById('dockingClue-'+name);fields[name]=input&&typeof input.value==='string'?input.value.trim():'';}
  if(!fields.name||fields.name.length>200||fields.kind.length>200||fields.region.length>200||fields.reason.length>4000||fields.sourceURL.length>2048){fail('请填写企业名称，并将其他字段控制在表单长度范围内。');return false;}
  if(fields.sourceURL){try{var url=new URL(fields.sourceURL);if(['http:','https:'].indexOf(url.protocol)<0||url.username||url.password)throw new Error();fields.sourceURL=url.href;}catch(_){fail('来源链接应为有效的 http 或 https 地址。');return false;}}
  var project=JSON.parse(JSON.stringify(PROJECTS[draft.context.key])),clues=Array.isArray(project.clues)?project.clues:[],existing=clues.find(function(clue){return clue&&clue.id===draft.id;});
  if(draft.original&&(!existing||!dockingIsManualClue(existing)||JSON.stringify(existing)!==draft.original)){fail('这条企业资料已更新，请重新打开后编辑。');return false;}
  var targetBefore=existing?JSON.stringify(existing):null;
  var next=Object.assign(existing||{id:draft.id,source:'manual_entry',status:'manual_entry',tone:'slate',investment_intent:'unknown',evidence:[],questions:[]},fields);
  if(!existing)clues.push(next);project.clues=clues;
  var payload={PROJECTS:{}};payload.PROJECTS[draft.context.key]=project;if(typeof RESET_GEN!=='undefined')payload.RESET_GEN=RESET_GEN;
  draft.pending=true;if(button){button.disabled=true;button.textContent='正在保存…';}if(error)error.textContent='';
  try{
    var posted=await fetch('/api/sync',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-HXZ-Report-Client':'website'},body:JSON.stringify(payload)}),ack=await posted.json();
    if(!posted.ok||!ack||ack.ok!==true)throw new Error(ack&&ack.message||ack&&ack.error||'企业资料尚未保存，请重试。');
    if(!dockingActionContextCurrent(draft.context)){
      if(draft.context.epoch===dockingActionEpoch())fail('企业资料已保存，但当前线索或需求已更新，请刷新核对。');return false;
    }
    var response=await fetch('/api/sync',{credentials:'same-origin',headers:{'X-HXZ-Report-Client':'website'}}),raw=await response.json();
    if(!response.ok)throw new Error(raw&&raw.message||'无法核对保存结果，请重试。');
    if(!dockingActionContextCurrent(draft.context)){
      if(draft.context.epoch===dockingActionEpoch())fail('企业资料已保存，但当前线索或需求已更新，请刷新核对。');return false;
    }
    var state=raw&&raw.huixiaozhao_kb_v1&&raw.huixiaozhao_kb_v1.PROJECTS?raw.huixiaozhao_kb_v1:raw,saved=state&&state.PROJECTS&&state.PROJECTS[draft.context.key],rows=saved&&Array.isArray(saved.clues)?saved.clues.filter(function(clue){return clue&&clue.id===draft.id;}):[];
    if(!saved||dockingProjectIdentity(saved)!==draft.context.identity||rows.length!==1||Object.keys(fields).some(function(field){return (rows[0][field]||'')!==fields[field];}))throw new Error('尚未核对到完整的企业资料，请重试；不会重复添加这家企业。');
    var currentProject=PROJECTS[draft.context.key],currentClues=Array.isArray(currentProject.clues)?currentProject.clues:[],currentTarget=currentClues.find(function(clue){return clue&&clue.id===draft.id;});
    if((currentTarget?JSON.stringify(currentTarget):null)!==targetBefore||(typeof isClueDeleted==='function'&&isClueDeleted(draft.context.key,rows[0]))){fail('企业资料已保存，但这条线索已有新的编辑或删除，请刷新核对。');return false;}
    if(currentTarget)Object.keys(fields).forEach(function(field){currentTarget[field]=rows[0][field];});
    else {currentClues.push(JSON.parse(JSON.stringify(rows[0])));currentProject.clues=currentClues;}
    try{if(typeof persist==='function')persist();}catch(_){}
    if(DOCKING_CLUE_DRAFT===draft){DOCKING_CLUE_DRAFT=null;closeModal();}
    if(typeof render==='function')render();toast('企业资料已保存，后续仍需核验');return true;
  }catch(exception){if(DOCKING_CLUE_DRAFT===draft&&draft.context.epoch===dockingActionEpoch())fail(exception.message||'保存未完成，请重试。');return false;}
  finally{draft.pending=false;if(button&&button.isConnected!==false){button.disabled=false;button.textContent='保存企业资料';}}
}

/* Workflow acknowledgements merge only the server-owned state they changed. */
function dockingRequestId(){return dockingActionRequestId();}
function dockingIntake(project){
  var value=project&&project.intake;
  return value&&value.contract==='docking-action-v1'?value:{status:'submitted',version:0};
}
function dockingIntakeStatus(project){
  var intake=dockingIntake(project);if(intake.status==='submitted'&&intake.lastSupplementAt)return {label:'已补充 · 待复核',tone:'blue',status:'submitted'};var states={submitted:['待受理','neutral'],processing:['处理中','blue'],needs_info:['待补充资料','amber'],feedback:['已反馈','teal']},choice=states[intake.status]||states.submitted;
  return {label:choice[0],tone:choice[1],status:intake.status||'submitted'};
}
async function dockingSendWorkflow(body){
  var context=dockingActionContext(body.projectKey,body.clueId);if(!context)throw dockingActionError('需求或企业已变化，请刷新后重试。',true);
  var response=await fetch('/api/docking-action',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  var result;try{result=await response.json();}catch(_){throw dockingActionError('未收到保存结果，请按原内容重试。');}
  if(!response.ok||!result||result.ok!==true)throw dockingActionError(result&&result.message||result&&result.error||'操作尚未保存，请重试。',response.status>=400&&response.status<500&&response.status!==408);
  if(!dockingActionContextCurrent(context))return null;
  if(result.projectKey!==context.key||!result.project||dockingProjectIdentity(result.project)!==context.identity||!Array.isArray(result.logs))throw dockingActionError('返回的需求不一致，请刷新核对。');
  var receipt=result.logs.find(function(e){return e&&e.contract==='docking-action-v1'&&e.requestId===body.requestId&&e.kind===body.action&&(e.clueId||null)===(body.clueId||null);});
  if(!receipt||!receipt.id)throw dockingActionError('尚未收到本次操作的保存凭据，请按原内容重试。');
  var record=body.record||{},fields=body.action==='review_demand'?['status','owner','nextStep','note']:body.action==='review_verification'?['status','note','outcome','evidence']:body.action==='supplement_demand'?['note','files']:['note'];
  if(fields.some(function(field){if(!(field in record))return false;return JSON.stringify(receipt[field])!==JSON.stringify(record[field]);})||(body.action==='advance_stage'&&receipt.to!==record.target)||!Number.isInteger(receipt.version))throw dockingActionError('保存凭据与本次提交内容不一致，请刷新核对。');
  var project=PROJECTS[context.key],incoming=result.project;
  if(body.action==='review_demand'||body.action==='supplement_demand'){
    if(!incoming.intake||incoming.intake.contract!=='docking-action-v1'||!Number.isInteger(incoming.intake.version)||incoming.intake.version<receipt.version)throw dockingActionError('受理状态回执不完整，请刷新核对。');
    if(incoming.intake.version===receipt.version&&((receipt.status!=null&&incoming.intake.status!==receipt.status)||(body.action==='review_demand'&&(incoming.intake.reply!==receipt.note||incoming.intake.owner!==receipt.owner||incoming.intake.nextStep!==receipt.nextStep))))throw dockingActionError('受理状态与保存凭据不一致，请刷新核对。');
    if(incoming.intake.version>=(Number(dockingIntake(project).version)||0))project.intake=JSON.parse(JSON.stringify(incoming.intake));
  }
  if(body.action==='review_verification'){
    var target=(project.clues||[]).find(function(c){return c.id===body.clueId;}),saved=(incoming.clues||[]).find(function(c){return c.id===body.clueId;}),request=saved&&saved.verificationRequest;
    if(!target||!request||request.contract!=='docking-action-v1'||!Number.isInteger(request.version)||request.version<receipt.version)throw dockingActionError('核验处理回执不完整，请刷新核对。');
    if(request.version===receipt.version&&(request.status!==receipt.status||request.reply!==receipt.note||(receipt.outcome!=null&&request.outcome!==receipt.outcome)||(receipt.evidence!=null&&request.evidence!==receipt.evidence)))throw dockingActionError('核验状态与保存凭据不一致，请刷新核对。');
    if(request.version>=Number(target.verificationRequest&&target.verificationRequest.version||0))target.verificationRequest=JSON.parse(JSON.stringify(request));
  }
  if(body.action==='advance_stage'){
    if(!Number.isInteger(incoming.stageVersion)||!Number.isInteger(incoming.stage)||incoming.stageVersion<receipt.version)throw dockingActionError('阶段更新回执不完整，请刷新核对。');
    if(incoming.stageVersion===receipt.version&&incoming.stage!==receipt.to)throw dockingActionError('阶段状态与保存凭据不一致，请刷新核对。');
    if(incoming.stageVersion>=Number(project.stageVersion||0)){project.stage=incoming.stage;project.stageVersion=incoming.stageVersion;project.stageLog=JSON.parse(JSON.stringify(incoming.stageLog||[]));if(incoming.stageByTopic)project.stageByTopic=JSON.parse(JSON.stringify(incoming.stageByTopic));}
  }
  if(typeof DOCK_LOGS==='undefined'||!DOCK_LOGS)DOCK_LOGS={};DOCK_LOGS[context.key]=dockingMergeLogRecords(context.key,result.logs);
  try{if(typeof persist==='function')persist();}catch(_){}
  return result;
}
