'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fn}=require('./chain_v2_fixture.cjs');
const source=fs.readFileSync(path.join(__dirname,'../frontend/shared/docking-actions.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
function gate(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function setup(){
  const elements={},events={posts:[],toasts:[],renders:0,persists:0,closed:0,modal:null};
  let responseHook=null,fetchGate=null,failure=null;
  const project=title=>({isDemand:true,demandContract:'industry-demand-v1',demandTitle:title,topic:'生物医药',sourceProjectKey:'parent',sourceAnalysisTopic:'生物医药',sourcePriorityKey:title,workspaceId:'parent',submissionState:'submitted',stage:4,clues:[{id:'same-clue',name:'企业甲',tone:'slate',status:'待核验'}]});
  const c={PROJECTS:{a:project('滤器'),b:project('填料')},DEMANDS:[{id:'d-a',projKey:'a',topic:'滤器',res:'none'},{id:'d-b',projKey:'b',topic:'填料',res:'none'}],DOCK_LOGS:{},_authEpoch:1,cur:'parent',view:'home',window:{},console,Date,Math,JSON,Number,String,URL,
    document:{getElementById:id=>elements[id]||null},
    industryDemandProjectTitle:p=>p.demandTitle||p.topic,
    toast:message=>events.toasts.push(message),render:()=>events.renders++,persist:()=>events.persists++,closeModal:()=>events.closed++,
    openModal(title,body,footer){events.modal={title,body,footer};for(const id of ['dockingLogType','dockingLogNote','dockingLogSave','dockingLogError','dockingLogFiles','dockingLogFileList'])elements[id]={value:id==='dockingLogType'?'visit':'',textContent:'',innerHTML:'',disabled:false,isConnected:true};}
  };
  function response(body){
    const p=clone(c.PROJECTS[body.projectKey]);
    const record={id:'event-'+events.posts.length,contract:'docking-action-v1',requestId:body.requestId,kind:body.action==='request_verification'?'verification_request':'contact_log',ts:1000,actor:'tester'};
    if(body.clueId!=null)record.clueId=body.clueId;
    if(body.record)Object.assign(record,clone(body.record));
    else {record.note='申请已保存';record.type='verification_request';record.files=[];p.clues.find(row=>row.id===body.clueId).verificationRequest={contract:'docking-action-v1',id:record.id,status:'requested'};}
    return {ok:true,status:200,json:async()=>({ok:true,created:true,projectKey:body.projectKey,project:p,logs:[record].concat(clone(c.DOCK_LOGS[body.projectKey]||[])),demand:clone(c.DEMANDS.find(row=>row.projKey===body.projectKey))})};
  }
  c.fetch=async(url,options)=>{assert.equal(url,'/api/docking-action');assert.equal(options.credentials,'same-origin');assert.equal(options.method,'POST');const body=JSON.parse(options.body);events.posts.push(body);if(fetchGate)await fetchGate.promise;if(failure)throw failure;return responseHook?responseHook(body,response):response(body);};
  vm.createContext(c);vm.runInContext(source,c);
  return {c,elements,events,setGate:value=>fetchGate=value,setFailure:value=>failure=value,setResponse:hook=>responseHook=hook};
}
function form(e,key='a',clueId='same-clue',note='已电话了解产品规格，尚未确认落地意向。'){
  assert.equal(e.c.openDockingLog(key,clueId),true);e.elements.dockingLogType.value='call';e.elements.dockingLogNote.value=note;
}
test('legacy colors and status text cannot establish verification',()=>{
  const e=setup();for(const data of [{tone:'teal',status:'核验通过'},{tone:'amber',status:'资源核验中'}]){
    const value=e.c.dockingClueState('a',{id:'same-clue',...data});assert.equal(value.key,'legacy');assert.equal(value.label,'历史状态待复核');assert.equal(value.canRequest,true);
  }
  assert.equal(e.c.dockingClueState('a',{id:'same-clue',verificationRequest:{status:'requested'}}).key,'pending');
});
test('server-owned request remains a request rather than a verified claim',()=>{
  const e=setup(),clue=e.c.PROJECTS.a.clues[0];clue.verificationRequest={id:'server-event',contract:'docking-action-v1',status:'requested'};
  const value=e.c.dockingClueState('a',clue);assert.equal(value.key,'requested');assert.equal(value.canRequest,false);assert.match(value.detail,/尚未形成核验结论/);
});
test('follow-up state is bound to the exact demand, clue, and server event contract',()=>{
  const e=setup();e.c.DOCK_LOGS.a=[{kind:'contact_log',clueId:'same-clue',note:'legacy'}];assert.equal(e.c.dockingClueState('a',e.c.PROJECTS.a.clues[0]).key,'pending');
  e.c.DOCK_LOGS.a.push({id:'event',contract:'docking-action-v1',kind:'contact_log',clueId:'same-clue'});
  assert.equal(e.c.dockingClueState('a',e.c.PROJECTS.a.clues[0]).key,'followed');assert.equal(e.c.dockingClueState('a',e.c.PROJECTS.a.clues[0]).canRequest,true);
  assert.equal(e.c.dockingClueState('b',e.c.PROJECTS.b.clues[0]).key,'pending');
});
test('missing clue identity cannot create a verification request',async()=>{
  const e=setup();assert.equal(e.c.dockingClueState('a',{name:'incomplete'}).canRequest,false);assert.equal(await e.c.requestDockingVerification('a','missing'),false);assert.equal(e.events.posts.length,0);
});
test('saved event list keeps legacy records, filters malformed values, and sorts without mutating source',()=>{
  const e=setup();e.c.DOCK_LOGS.a=[{ts:1,note:'old'},null,'bad',{ts:3,note:'new'},{note:'no timestamp'}];const before=JSON.stringify(e.c.DOCK_LOGS.a);
  assert.deepEqual(Array.from(e.c.dockingLogRecords('a'),row=>row.note),['new','old','no timestamp']);assert.equal(JSON.stringify(e.c.DOCK_LOGS.a),before);e.c.DOCK_LOGS.b={invalid:true};assert.equal(e.c.dockingLogRecords('b').length,0);
});
test('verification uses one server request, does not mutate before acknowledgement, and preserves stage',async()=>{
  const e=setup(),g=gate();e.setGate(g);const before=JSON.stringify(e.c.PROJECTS),pending=e.c.requestDockingVerification('a','same-clue');
  assert.equal(e.events.posts.length,1);assert.equal(JSON.stringify(e.c.PROJECTS),before);assert.equal(e.events.persists,0);assert.equal(await e.c.requestDockingVerification('a','same-clue'),false);
  g.resolve();assert.equal(await pending,true);assert.equal(e.events.posts.length,1);assert.equal(e.c.PROJECTS.a.stage,4);assert.equal(e.c.PROJECTS.a.clues[0].tone,'slate');assert.equal(e.c.dockingClueState('a',e.c.PROJECTS.a.clues[0]).key,'requested');assert.equal(e.c.DOCK_LOGS.b,undefined);assert.equal(e.events.persists,1);assert.match(e.events.toasts.at(-1),/申请已保存/);
});
test('failed verification does not manufacture local progress and retries the same request id',async()=>{
  const e=setup();e.setFailure(new Error('network offline'));const before=JSON.stringify(e.c.PROJECTS);assert.equal(await e.c.requestDockingVerification('a','same-clue'),false);assert.equal(JSON.stringify(e.c.PROJECTS),before);assert.equal(e.c.DOCK_LOGS.a,undefined);assert.equal(e.events.persists,0);
  e.setFailure(null);assert.equal(await e.c.requestDockingVerification('a','same-clue'),true);assert.equal(e.events.posts[0].requestId,e.events.posts[1].requestId);
});
test('two demands with the same clue id have independent request receipts',async()=>{
  const e=setup();assert.equal(await e.c.requestDockingVerification('a','same-clue'),true);assert.equal(e.c.PROJECTS.b.clues[0].verificationRequest,undefined);
  assert.equal(await e.c.requestDockingVerification('b','same-clue'),true);assert.notEqual(e.events.posts[0].requestId,e.events.posts[1].requestId);assert.notEqual(e.c.DOCK_LOGS.a[0].id,e.c.DOCK_LOGS.b[0].id);
});
for(const kind of ['wrong-project','missing-receipt','wrong-record'])test('untrusted '+kind+' acknowledgement cannot update local state',async()=>{
  const e=setup();form(e);const before=JSON.stringify(e.c.PROJECTS);
  e.setResponse(async(body,normal)=>{const result=await normal(body).json();if(kind==='wrong-project')result.projectKey='b';else if(kind==='missing-receipt')result.logs=[];else result.logs[0].note='not the submitted note';return {ok:true,status:200,json:async()=>result};});
  assert.equal(await e.c.submitDockingLog(),false);assert.equal(JSON.stringify(e.c.PROJECTS),before);assert.equal(e.events.persists,0);assert.equal(e.c.DOCK_LOGS.a,undefined);
});
test('late response after an authentication change cannot populate another account',async()=>{
  const e=setup(),g=gate();e.setGate(g);form(e);const pending=e.c.submitDockingLog();e.c._authEpoch=2;g.resolve();assert.equal(await pending,false);assert.equal(e.c.DOCK_LOGS.a,undefined);assert.equal(e.events.persists,0);assert.equal(e.events.toasts.length,0);
});
test('late response after demand identity changes cannot overwrite the new demand',async()=>{
  const e=setup(),g=gate();e.setGate(g);form(e);const pending=e.c.submitDockingLog();e.c.PROJECTS.a.demandTitle='变更后的独立需求';g.resolve();assert.equal(await pending,false);assert.equal(e.c.PROJECTS.a.demandTitle,'变更后的独立需求');assert.equal(e.c.DOCK_LOGS.a,undefined);
});
test('modal identifies the concrete demand and enterprise with escaped user text',()=>{
  const e=setup();e.c.PROJECTS.a.demandTitle='<img src=x onerror=bad>';e.c.PROJECTS.a.clues[0].name='A & B';form(e);assert.match(e.events.modal.body,/&lt;img src=x onerror=bad&gt;/);assert.match(e.events.modal.body,/A &amp; B/);assert.doesNotMatch(e.events.modal.body,/<img src=x/);
});
test('note is saved only after server acknowledgement without changing the selected screen',async()=>{
  const e=setup(),g=gate();form(e);e.setGate(g);const pending=e.c.submitDockingLog();assert.equal(e.c.DOCK_LOGS.a,undefined);assert.equal(e.events.closed,0);assert.equal(e.elements.dockingLogSave.disabled,true);assert.equal(await e.c.submitDockingLog(),false);
  g.resolve();assert.equal(await pending,true);assert.equal(e.c.DOCK_LOGS.a[0].kind,'contact_log');assert.equal(e.c.DOCK_LOGS.a[0].note,e.events.posts[0].record.note);assert.equal(e.c.cur,'parent');assert.equal(e.c.view,'home');assert.equal(e.c.PROJECTS.a.stage,4);assert.equal(e.events.closed,1);assert.equal(e.events.renders,1);assert.equal(e.events.posts.length,1);
});
test('network failure preserves form content and files, and exact retry retains request id',async()=>{
  const e=setup();form(e);e.c.DOCKING_LOG_DRAFT.files=[{name:'note.txt',size:4,dataUrl:'data:text/plain;base64,dGVzdA=='}];e.setFailure(new Error('connection lost'));assert.equal(await e.c.submitDockingLog(),false);assert.match(e.elements.dockingLogNote.value,/产品规格/);assert.equal(e.c.DOCKING_LOG_DRAFT.files.length,1);assert.equal(e.elements.dockingLogSave.disabled,false);assert.equal(e.events.closed,0);assert.match(e.elements.dockingLogError.textContent,/connection lost/);
  e.setFailure(null);assert.equal(await e.c.submitDockingLog(),true);assert.equal(e.events.posts[0].requestId,e.events.posts[1].requestId);assert.deepEqual(e.events.posts[0],e.events.posts[1]);
});
test('ambiguous save prevents changing payload under an unresolved request id',async()=>{
  const e=setup();form(e);e.setFailure(new Error('timeout'));assert.equal(await e.c.submitDockingLog(),false);e.elements.dockingLogNote.value='another content';e.setFailure(null);assert.equal(await e.c.submitDockingLog(),false);assert.equal(e.events.posts.length,1);assert.match(e.elements.dockingLogError.textContent,/按原内容重试/);
});
test('definitively rejected content can be corrected with a new request id',async()=>{
  const e=setup();form(e);e.setResponse(()=>({ok:false,status:400,json:async()=>({message:'invalid attachment'})}));assert.equal(await e.c.submitDockingLog(),false);e.elements.dockingLogNote.value='corrected';e.setResponse(null);assert.equal(await e.c.submitDockingLog(),true);assert.notEqual(e.events.posts[0].requestId,e.events.posts[1].requestId);
});
test('empty, oversized and invalid-form submissions do not reach the server',async()=>{
  const e=setup();form(e,'a','same-clue','');assert.equal(await e.c.submitDockingLog(),false);e.elements.dockingLogNote.value='x'.repeat(10001);assert.equal(await e.c.submitDockingLog(),false);e.elements.dockingLogNote.value='text';e.elements.dockingLogType.value='verified';assert.equal(await e.c.submitDockingLog(),false);assert.equal(e.events.posts.length,0);
});
test('attachment validation enforces exact count, size, extension and type boundaries',()=>{
  const e=setup(),file=(size,name='note.txt',dataUrl)=>({size,name,...(dataUrl?{dataUrl}:{})});
  assert.equal(e.c.dockingValidateFiles([file(5*1024*1024),file(5*1024*1024)]),'');
  for(const files of [[file(5*1024*1024+1)],[file(5*1024*1024),file(5*1024*1024),file(1)],Array.from({length:6},()=>file(1)),[file(0)],[file(10,'script.html')],[file(10,'../secret.txt')],[file(1,'note.txt','data:text/html;base64,eA==')]])assert.ok(e.c.dockingValidateFiles(files),JSON.stringify(files));
  assert.equal(e.c.dockingValidateFiles([file(4,'note.txt','data:text/plain;base64,dGVzdA==')]),'');
});
test('pending file read prevents save, and legacy attachments are still validated before posting',async()=>{
  const e=setup();form(e);e.c.DOCKING_LOG_DRAFT.reading=true;assert.equal(await e.c.submitDockingLog(),false);e.c.DOCKING_LOG_DRAFT.reading=false;e.c.DOCKING_LOG_DRAFT.files=[{name:'bad.html',size:1,dataUrl:'data:text/html;base64,eA=='}];assert.equal(await e.c.submitDockingLog(),false);assert.equal(e.events.posts.length,0);
});
test('successful server write stays successful when local cache is unavailable',async()=>{
  const e=setup();e.c.persist=()=>{throw new Error('quota');};form(e);assert.equal(await e.c.submitDockingLog(),true);assert.equal(e.c.DOCK_LOGS.a.length,1);assert.match(e.events.toasts.at(-1),/记录已保存/);
});
test('legacy entry opens the new acknowledged save path and retains original text on failure',async()=>{
  const e=setup();e.elements['dock-note-a']={value:'原有记录草稿'};e.c.__dockType={a:'email'};e.c.__dockFiles={a:[]};e.setFailure(new Error('offline'));assert.equal(await e.c.recordDockingLegacyLog('a'),false);assert.equal(e.elements['dock-note-a'].value,'原有记录草稿');assert.equal(e.elements.dockingLogNote.value,'原有记录草稿');assert.equal(e.events.posts[0].record.type,'email');assert.equal(e.c.DOCK_LOGS.a,undefined);
});
test('contact sheet contains only supplied materials and never invents a contact or SLA',()=>{
  const e=setup(),empty=e.c.dockingContactMaterialHtml({name:'某企业',tone:'teal'});assert.match(empty,/尚未提供联系人资料/);assert.match(empty,/尚未提供触达路径/);assert.doesNotMatch(empty,/1 个工作日|已完成可达性|已通知|核验通过 ·/);
  const supplied=e.c.dockingContactMaterialHtml({contactName:'李<测试>',contactPhone:'123',contactPath:'已发送官网邮箱'});assert.match(supplied,/李&lt;测试&gt;/);assert.match(supplied,/123/);assert.match(supplied,/已发送官网邮箱/);assert.match(supplied,/待核对/);
});
for(const side of ['index','ops']){
  const tail=fs.readFileSync(path.join(__dirname,'../frontend',side,side==='index'?'script-02-sections':'script-03-sections','12-tail.js'),'utf8');
  test(side+' legacy buttons use explicit action receipts and cannot change stage or tone',()=>{
    const calls=[],c={PROJECTS:{a:{stage:4,clues:[{id:'x',tone:'slate'}]}},requestDockingVerification:(...args)=>calls.push(['request',...args]),openDockingLog:(...args)=>calls.push(['log',...args]),recordDockingLegacyLog:(...args)=>calls.push(['save',...args])};vm.createContext(c);
    for(const name of ['requestVerify','arrangeDocking','saveDockLog'].concat(side==='index'?['advanceStage']:[]))vm.runInContext(fn(tail,name),c);
    const before=JSON.stringify(c.PROJECTS);c.requestVerify('a','x');c.arrangeDocking('a','x');if(side==='index')c.advanceStage('a');c.saveDockLog('a');assert.equal(JSON.stringify(c.PROJECTS),before);assert.deepEqual(calls,[['request','a','x'],['log','a','x']].concat(side==='index'?[['log','a']]:[]).concat([['save','a']]));
  });
  if(side==='index'){
    test('legacy demand sync preserves concrete title and never infers verified state from stage or colors',()=>{
      const c={PROJECTS:{a:{demandContract:'industry-demand-v1',demandTitle:'滤器',topic:'生物医药',sourceAnalysisTopic:'生物医药',stage:5,clues:[{tone:'teal'}]}},DEMANDS:[{id:'d-a',projKey:'a',topic:'wrong old title',res:'none',resLabel:'待研判',stage:4}]};vm.createContext(c);vm.runInContext(fn(tail,'syncDemandStage'),c);c.syncDemandStage('a');assert.equal(c.DEMANDS[0].topic,'滤器');assert.equal(c.DEMANDS[0].analysisTopic,'生物医药');assert.equal(c.DEMANDS[0].res,'none');assert.equal(c.DEMANDS[0].resLabel,'待研判');assert.equal(c.DEMANDS[0].stage,4);assert.equal(c.DEMANDS[0].clues,1);
    });
    test('legacy contact footer does not pretend to notify a resource team',()=>{
      const c={};vm.createContext(c);vm.runInContext(fn(tail,'contactCardFoot'),c);assert.match(c.contactCardFoot(),/关闭/);assert.doesNotMatch(c.contactCardFoot(),/通知|toast|核验通过/);
    });
  }
}
function manualForm(e,clueId){
  assert.equal(e.c.openDockingClueEditor('a',clueId),true);
  for(const [key,value] of Object.entries({name:'实际录入企业',kind:'生物工艺过滤耗材',region:'上海',reason:'有相关产品，生产能力待核验',sourceURL:'https://example.com/products'}))e.elements['dockingClue-'+key]={value};
  e.elements.dockingClueError={textContent:''};e.elements.dockingClueSave={disabled:false,textContent:'保存企业资料',isConnected:true};
}
test('manual editor does not add placeholder enterprises before acknowledgement',()=>{
  const e=setup(),before=JSON.stringify(e.c.PROJECTS);manualForm(e);assert.equal(JSON.stringify(e.c.PROJECTS),before);assert.doesNotMatch(e.events.modal.body,/待填写企业名称|核验状态|tone-btn/);
});
test('manual enterprise save waits for POST and matching GET and preserves exact demand binding',async()=>{
  const e=setup(),g=gate();manualForm(e);let server,calls=[];
  e.c.fetch=async(url,options)=>{assert.equal(url,'/api/sync');calls.push(options.method||'GET');if(options.method==='POST'){server=JSON.parse(options.body);await g.promise;return {ok:true,json:async()=>({ok:true})};}return {ok:true,json:async()=>server};};
  const before=JSON.stringify(e.c.PROJECTS),pending=e.c.saveDockingClue();assert.equal(JSON.stringify(e.c.PROJECTS),before);assert.equal(e.elements.dockingClueSave.disabled,true);g.resolve();assert.equal(await pending,true);assert.deepEqual(calls,['POST','GET']);assert.equal(e.c.PROJECTS.a.clues.length,2);assert.equal(e.c.PROJECTS.b.clues.length,1);assert.equal(e.c.PROJECTS.a.clues[1].name,'实际录入企业');assert.equal(e.c.PROJECTS.a.clues[1].source,'manual_entry');assert.equal(e.c.PROJECTS.a.clues[1].tone,'slate');assert.equal(e.c.PROJECTS.a.stage,4);
});
test('manual save failure preserves draft and reuses a stable enterprise id on retry',async()=>{
  const e=setup();manualForm(e);let readFailure=true,server,calls=[];
  e.c.fetch=async(url,options)=>{if(options.method==='POST'){server=JSON.parse(options.body);calls.push(server.PROJECTS.a.clues.at(-1).id);return {ok:true,json:async()=>({ok:true})};}if(readFailure)throw Error('readback offline');return {ok:true,json:async()=>server};};
  assert.equal(await e.c.saveDockingClue(),false);assert.equal(e.c.PROJECTS.a.clues.length,1);assert.equal(e.elements['dockingClue-name'].value,'实际录入企业');readFailure=false;assert.equal(await e.c.saveDockingClue(),true);assert.equal(calls[0],calls[1]);assert.equal(e.c.PROJECTS.a.clues.length,2);
});
test('source-backed enterprise records open read-only without an editable conclusion',()=>{
  const e=setup();e.c.PROJECTS.a.clues[0].evidence=[{quote:'product source',url:'https://example.com'}];assert.equal(e.c.openDockingClueEditor('a','same-clue'),true);assert.match(e.events.modal.title,/只读/);assert.equal(e.c.DOCKING_CLUE_DRAFT,null);assert.doesNotMatch(e.events.modal.body,/核验状态|dockingClue-name/);
});
test('manual edit retains existing verification and evidence fields',async()=>{
  const e=setup(),clue=e.c.PROJECTS.a.clues[0];clue.source='manual_entry';clue.verificationRequest={id:'saved',contract:'docking-action-v1',status:'requested'};clue.evidence=[{quote:'original product text'}];manualForm(e,'same-clue');let server;
  e.c.fetch=async(url,options)=>{if(options.method==='POST'){server=JSON.parse(options.body);return {ok:true,json:async()=>({ok:true})};}return {ok:true,json:async()=>server};};
  assert.equal(await e.c.saveDockingClue(),true);assert.equal(e.c.PROJECTS.a.clues[0].verificationRequest.id,'saved');assert.equal(e.c.PROJECTS.a.clues[0].evidence[0].quote,'original product text');assert.equal(e.c.PROJECTS.a.clues[0].tone,'slate');
});
test('manual save rejects readback mismatch and unsafe source links',async()=>{
  const e=setup();manualForm(e);e.elements['dockingClue-sourceURL'].value='javascript:alert(1)';assert.equal(await e.c.saveDockingClue(),false);assert.match(e.elements.dockingClueError.textContent,/http/);
  e.elements['dockingClue-sourceURL'].value='';e.c.fetch=async(url,options)=>({ok:true,json:async()=>options.method==='POST'?{ok:true}:{PROJECTS:clone(e.c.PROJECTS)}});assert.equal(await e.c.saveDockingClue(),false);assert.equal(e.c.PROJECTS.a.clues.length,1);assert.match(e.elements.dockingClueError.textContent,/核对/);
});
function delayedActionResponse(e,body){
  const project=clone(e.c.PROJECTS[body.projectKey]),event={id:'delayed-'+body.requestId,contract:'docking-action-v1',requestId:body.requestId,kind:body.action==='request_verification'?'verification_request':'contact_log',ts:1000,actor:'tester',files:[]};
  if(body.clueId!=null)event.clueId=body.clueId;
  if(body.record)Object.assign(event,clone(body.record));
  else {event.note='申请已保存';project.clues.find(c=>c.id===body.clueId).verificationRequest={id:event.id,contract:'docking-action-v1',status:'requested'};}
  return {ok:true,created:true,projectKey:body.projectKey,project,logs:[event].concat(clone(e.c.DOCK_LOGS[body.projectKey]||[])),demand:clone(e.c.DEMANDS.find(d=>d.projKey===body.projectKey))};
}
test('delayed verification response preserves concurrent clue edits, new clues, stage and demand progress',async()=>{
  const e=setup(),g=gate();let reply;
  e.c.fetch=async(url,options)=>{reply=delayedActionResponse(e,JSON.parse(options.body));await g.promise;return {ok:true,json:async()=>reply};};
  const original=e.c.PROJECTS.a,clue=original.clues[0],pending=e.c.requestDockingVerification('a','same-clue');
  clue.name='已更新企业名称';clue.reason='新保存的产品资料';original.clues.push({id:'new-clue',name:'第二家企业'});original.stage=6;e.c.DEMANDS[0].res='matched';e.c.DEMANDS[0].stage=6;
  g.resolve();assert.equal(await pending,true);assert.equal(e.c.PROJECTS.a,original);assert.equal(original.clues[0],clue);assert.equal(clue.name,'已更新企业名称');assert.equal(clue.reason,'新保存的产品资料');assert.equal(original.clues.length,2);assert.equal(original.stage,6);assert.equal(e.c.DEMANDS[0].res,'matched');assert.equal(e.c.DEMANDS[0].stage,6);assert.equal(clue.verificationRequest.id,reply.logs[0].id);
});
test('delayed response cannot roll back a newer saved verification receipt',async()=>{
  const e=setup(),g=gate();e.c.fetch=async(url,options)=>{const reply=delayedActionResponse(e,JSON.parse(options.body));await g.promise;return {ok:true,json:async()=>reply};};
  const pending=e.c.requestDockingVerification('a','same-clue'),newer={id:'newer-event',contract:'docking-action-v1',status:'requested',requestedAt:3000};e.c.PROJECTS.a.clues[0].verificationRequest=newer;g.resolve();assert.equal(await pending,true);assert.equal(e.c.PROJECTS.a.clues[0].verificationRequest,newer);
});
test('delayed log acknowledgement keeps newer logs and current project with stable event deduplication',async()=>{
  const e=setup(),g=gate();form(e);const legacy={ts:500,type:'call',note:'既有电话记录'};e.c.DOCK_LOGS.a=[legacy];let reply;
  e.c.fetch=async(url,options)=>{reply=delayedActionResponse(e,JSON.parse(options.body));reply.logs.push(clone(legacy));await g.promise;return {ok:true,json:async()=>reply};};
  const original=e.c.PROJECTS.a,pending=e.c.submitDockingLog(),newer={id:'newer-event',contract:'docking-action-v1',kind:'contact_log',ts:3000,type:'note',note:'同时保存的另一条记录'};
  e.c.DOCK_LOGS.a=[newer,legacy];original.clues[0].reason='另一窗口更新的理由';original.stage=7;e.c.DEMANDS[0].stage=7;
  g.resolve();assert.equal(await pending,true);assert.equal(e.c.PROJECTS.a,original);assert.equal(original.clues[0].reason,'另一窗口更新的理由');assert.equal(original.stage,7);assert.equal(e.c.DEMANDS[0].stage,7);assert.deepEqual(Array.from(e.c.DOCK_LOGS.a,row=>row.id||'legacy'),['newer-event',reply.logs[0].id,'legacy']);
  const merged=e.c.dockingMergeLogRecords('a',reply.logs);assert.equal(merged.length,3);assert.equal(merged[0],newer);
});
test('delayed manual readback merges only target fields and keeps other clue changes, logs and stage',async()=>{
  const e=setup(),g=gate();e.c.PROJECTS.a.clues[0].source='manual_entry';manualForm(e,'same-clue');let snapshot;
  e.c.fetch=async(url,options)=>{if(options.method==='POST'){snapshot=JSON.parse(options.body);return {ok:true,json:async()=>({ok:true})};}await g.promise;return {ok:true,json:async()=>snapshot};};
  const original=e.c.PROJECTS.a,pending=e.c.saveDockingClue();await new Promise(setImmediate);original.clues.push({id:'concurrent-clue',name:'并发新增企业'});original.stage=6;e.c.DOCK_LOGS.a=[{id:'new-record',contract:'docking-action-v1',kind:'contact_log',ts:3000,note:'并发记录'}];
  g.resolve();assert.equal(await pending,true);assert.equal(e.c.PROJECTS.a,original);assert.equal(original.clues.length,2);assert.equal(original.clues[1].name,'并发新增企业');assert.equal(original.clues[0].name,'实际录入企业');assert.equal(original.stage,6);assert.equal(e.c.DOCK_LOGS.a[0].id,'new-record');
});
for(const action of ['edit','delete'])test('delayed manual response cannot undo concurrent target '+action,async()=>{
  const e=setup(),g=gate();e.c.PROJECTS.a.clues[0].source='manual_entry';manualForm(e,'same-clue');let snapshot;
  e.c.fetch=async(url,options)=>{if(options.method==='POST'){snapshot=JSON.parse(options.body);return {ok:true,json:async()=>({ok:true})};}await g.promise;return {ok:true,json:async()=>snapshot};};
  const original=e.c.PROJECTS.a,pending=e.c.saveDockingClue();await new Promise(setImmediate);if(action==='edit')original.clues[0].name='较新编辑';else original.clues=[];
  g.resolve();assert.equal(await pending,false);assert.equal(e.c.PROJECTS.a,original);assert.equal(action==='edit'?original.clues[0].name:original.clues.length,action==='edit'?'较新编辑':0);assert.match(e.elements.dockingClueError.textContent,/已保存.*刷新核对/);assert.equal(e.events.persists,0);
});

test('lost verification acknowledgement accepts same request already processed by the administrator',async()=>{
  const e=setup();let attempt=0;
  e.setResponse((body,base)=>{if(attempt++===0)throw new Error('lost reply');const response=base(body),json=response.json;response.json=async()=>{const data=await json();Object.assign(data.project.clues[0].verificationRequest,{status:'completed',version:1,outcome:'insufficient',reply:'需要更多资料',evidence:'当前产品原文不完整'});return data;};return response;});
  assert.equal(await e.c.requestDockingVerification('a','same-clue'),false);
  assert.equal(await e.c.requestDockingVerification('a','same-clue'),true);
  assert.equal(e.events.posts[0].requestId,e.events.posts[1].requestId);
  assert.equal(e.c.PROJECTS.a.clues[0].verificationRequest.status,'completed');
  assert.equal(e.c.PROJECTS.a.clues[0].verificationRequest.reply,'需要更多资料');
});
