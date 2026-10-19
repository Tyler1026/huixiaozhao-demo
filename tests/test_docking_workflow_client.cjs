'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../frontend/shared/docking-actions.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const contract='docking-action-v1';
function gate(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function bodyFor(action){
  const body={projectKey:'a',action,requestId:'request-'+action,expectedVersion:0};
  if(action==='review_demand')body.record={status:'processing',owner:'负责人甲',nextStep:'核对供货记录',note:'已受理，将逐项核对需求'};
  if(action==='supplement_demand')body.record={note:'补充客户的采购规格',files:[{name:'note.txt',size:4,dataUrl:'data:text/plain;base64,dGVzdA=='}]};
  if(action==='review_verification'){body.clueId='c1';body.record={status:'completed',note:'可以进一步核对合作条件',outcome:'further_contact',evidence:'已查阅企业产品说明中的规格范围'};}
  if(action==='advance_stage')body.record={target:5,note:'已完成当前阶段的信息核对'};
  return body;
}
function boot(){
  const events={posts:[],persists:0,toasts:[]};let transport=null;
  const project=id=>({id,workspaceId:'parent',parentProjectKey:'parent',isDemand:true,demandContract:'industry-demand-v1',demandOrigin:'direct',submissionState:'submitted',topic:'滤器',demandTitle:'滤器',stage:4,stageVersion:0,stageLog:[],intake:{contract,version:0,status:'needs_info',owner:'负责人甲'},clues:[{id:'c1',name:'企业甲',reason:'原匹配说明',tone:'slate',verificationRequest:{id:'verification-c1',contract,version:0,status:'requested'}},{id:'c2',name:'企业乙',tone:'slate'}]});
  const c={PROJECTS:{a:project('a'),b:project('b')},DEMANDS:[{id:'d-a',projKey:'a',res:'none'},{id:'d-b',projKey:'b',res:'none'}],DOCK_LOGS:{a:[{id:'old-log',contract,kind:'contact_log',ts:100,note:'此前记录'}]},_authEpoch:1,console,Date,Math,Number,String,JSON,URL,document:{getElementById:()=>null},toast:message=>events.toasts.push(message),persist:()=>events.persists++};
  function receipt(body){
    const p=clone(c.PROJECTS[body.projectKey]),version=body.expectedVersion+1,record=clone(body.record),event={id:'event-'+body.requestId,contract,requestId:body.requestId,projectKey:body.projectKey,kind:body.action,version,ts:1000,actor:'admin',actorRole:'admin',files:[],...record};
    if(body.clueId)event.clueId=body.clueId;
    if(body.action==='review_demand')p.intake={...p.intake,...record,reply:record.note,version};
    if(body.action==='supplement_demand'){p.intake={...p.intake,status:'submitted',version,lastSupplementAt:1000,lastSupplementBy:'client'};event.status='submitted';}
    if(body.action==='review_verification'){const clue=p.clues.find(x=>x.id===body.clueId);clue.verificationRequest={...clue.verificationRequest,...record,reply:record.note,version,updatedAt:1000,updatedBy:'admin'};}
    if(body.action==='advance_stage'){event.to=record.target;event.from=p.stage;delete event.target;p.stage=record.target;p.stageVersion=version;p.stageLog=[{id:event.id,contract,ts:event.ts,from:event.from,to:event.to,note:record.note,who:'admin'}].concat(p.stageLog);}
    return {ok:true,created:true,projectKey:body.projectKey,project:p,logs:[event,...clone(c.DOCK_LOGS[body.projectKey]||[])],demand:clone(c.DEMANDS.find(x=>x.projKey===body.projectKey))};
  }
  c.fetch=async(url,options)=>{assert.equal(url,'/api/docking-action');assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');const body=JSON.parse(options.body);events.posts.push(body);return transport?transport(body):{ok:true,status:200,json:async()=>receipt(body)};};
  vm.createContext(c);vm.runInContext(source,c);
  return {c,events,receipt,setTransport:value=>transport=value};
}
function snapshot(e){return JSON.stringify([e.c.PROJECTS,e.c.DEMANDS,e.c.DOCK_LOGS]);}

for(const action of ['review_demand','supplement_demand','review_verification','advance_stage'])test(action+' applies only after an acknowledged exact operation receipt',async()=>{
  const e=boot(),body=bodyFor(action),g=gate(),before=snapshot(e);let result;
  e.setTransport(async sent=>{result=e.receipt(sent);await g.promise;return {ok:true,status:200,json:async()=>result};});
  const pending=e.c.dockingSendWorkflow(body);assert.equal(snapshot(e),before);assert.equal(e.events.persists,0);assert.deepEqual(e.events.posts[0],body);
  g.resolve();assert.ok(await pending);assert.equal(e.events.persists,1);assert.equal(e.c.DOCK_LOGS.a[0].id,result.logs[0].id);assert.deepEqual(clone(e.c.PROJECTS.b),JSON.parse(before)[0].b);assert.deepEqual(clone(e.c.DEMANDS),JSON.parse(before)[1]);
  if(action==='review_demand'){assert.equal(e.c.PROJECTS.a.intake.status,'processing');assert.equal(e.c.PROJECTS.a.intake.reply,body.record.note);assert.equal(e.c.PROJECTS.a.stage,4);}
  if(action==='supplement_demand'){assert.equal(e.c.PROJECTS.a.intake.status,'submitted');assert.equal(e.c.PROJECTS.a.intake.version,1);assert.equal(e.c.DOCK_LOGS.a[0].files[0].name,'note.txt');assert.equal(e.c.PROJECTS.a.stage,4);}
  if(action==='review_verification'){assert.equal(e.c.PROJECTS.a.clues[0].verificationRequest.outcome,'further_contact');assert.equal(e.c.PROJECTS.a.clues[0].tone,'slate');assert.equal(e.c.PROJECTS.a.stage,4);}
  if(action==='advance_stage'){assert.equal(e.c.PROJECTS.a.stage,5);assert.equal(e.c.PROJECTS.a.stageVersion,1);assert.equal(e.c.PROJECTS.a.stageLog[0].note,body.record.note);assert.equal(e.c.PROJECTS.a.intake.status,'needs_info');}
});
for(const action of ['review_demand','supplement_demand','review_verification','advance_stage'])test(action+' ignores a stale response after account replacement',async()=>{
  const e=boot(),g=gate();e.setTransport(async sent=>{const result=e.receipt(sent);await g.promise;return {ok:true,status:200,json:async()=>result};});const pending=e.c.dockingSendWorkflow(bodyFor(action));
  e.c._authEpoch++;e.c.PROJECTS={};e.c.DEMANDS=[];e.c.DOCK_LOGS={};const before=snapshot(e);g.resolve();assert.equal(await pending,null);assert.equal(snapshot(e),before);assert.equal(e.events.persists,0);
});
test('changed demand identity before acknowledgement cannot apply an old workflow result',async()=>{
  const e=boot(),g=gate();e.setTransport(async sent=>{const result=e.receipt(sent);await g.promise;return {ok:true,status:200,json:async()=>result};});const pending=e.c.dockingSendWorkflow(bodyFor('review_demand'));
  e.c.PROJECTS.a.demandTitle='替换后的需求';const before=snapshot(e);g.resolve();assert.equal(await pending,null);assert.equal(snapshot(e),before);
});
test('deleted target clue before acknowledgement cannot be restored by verification result',async()=>{
  const e=boot(),g=gate();e.setTransport(async sent=>{const result=e.receipt(sent);await g.promise;return {ok:true,status:200,json:async()=>result};});const pending=e.c.dockingSendWorkflow(bodyFor('review_verification'));
  e.c.PROJECTS.a.clues.splice(0,1);const before=snapshot(e);g.resolve();assert.equal(await pending,null);assert.equal(snapshot(e),before);
});
const corruptions={
  'project key':r=>{r.projectKey='b';},'demand identity':r=>{r.project.demandTitle='其他需求';},'missing receipt':r=>{r.logs=[];},'receipt contract':r=>{r.logs[0].contract='other';},'receipt id':r=>{r.logs[0].id='';},'receipt request':r=>{r.logs[0].requestId='other';},'receipt kind':r=>{r.logs[0].kind='other';},'receipt note':r=>{r.logs[0].note='另一条处理记录';},'receipt version':r=>{r.logs[0].version=1.5;},'incoming version behind receipt':r=>{r.project.intake.version=0;},'missing intake contract':r=>{delete r.project.intake.contract;}
};
for(const [name,corrupt] of Object.entries(corruptions))test('rejects mismatched '+name+' without changing local state',async()=>{
  const e=boot(),before=snapshot(e);e.setTransport(sent=>{const result=e.receipt(sent);corrupt(result);return {ok:true,status:200,json:async()=>result};});await assert.rejects(e.c.dockingSendWorkflow(bodyFor('review_demand')));assert.equal(snapshot(e),before);assert.equal(e.events.persists,0);
});
for(const action of ['review_demand','supplement_demand','review_verification','advance_stage'])test(action+' validates action-specific receipt fields before merging',async()=>{
  const e=boot(),before=snapshot(e);e.setTransport(sent=>{const result=e.receipt(sent);if(action==='review_demand')result.logs[0].owner='其他负责人';if(action==='supplement_demand')result.logs[0].files=[];if(action==='review_verification')result.logs[0].outcome='not_suitable';if(action==='advance_stage')result.logs[0].to=6;return {ok:true,status:200,json:async()=>result};});
  await assert.rejects(e.c.dockingSendWorkflow(bodyFor(action)));assert.equal(snapshot(e),before);assert.equal(e.events.persists,0);
});
for(const action of ['review_demand','review_verification','advance_stage'])test(action+' keeps a newer concurrently loaded server version and all unrelated fields',async()=>{
  const e=boot(),g=gate();let result;e.setTransport(async sent=>{result=e.receipt(sent);await g.promise;return {ok:true,status:200,json:async()=>result};});const project=e.c.PROJECTS.a,pending=e.c.dockingSendWorkflow(bodyFor(action));
  project.clues[0].reason='并发编辑的匹配说明';project.clues.push({id:'c3',name:'新增企业'});e.c.DEMANDS[0].res='updated';const newEvent={id:'newer-log',contract,ts:3000,kind:'contact_log',note:'后来的跟进记录'};e.c.DOCK_LOGS.a.unshift(newEvent);
  if(action==='review_demand')project.intake={contract,version:3,status:'feedback',reply:'更新后的反馈'};
  if(action==='review_verification')project.clues[0].verificationRequest={id:'verification-c1',contract,version:3,status:'completed',outcome:'not_suitable',reply:'更新后的企业结论'};
  if(action==='advance_stage'){project.stage=6;project.stageVersion=3;project.stageLog=[{id:'newer-stage',note:'更新后的阶段记录'}];}
  g.resolve();assert.ok(await pending);assert.equal(e.c.PROJECTS.a,project);assert.equal(project.clues[0].reason,'并发编辑的匹配说明');assert.equal(project.clues[2].name,'新增企业');assert.equal(e.c.DEMANDS[0].res,'updated');assert.equal(e.c.DOCK_LOGS.a[0].id,'newer-log');assert.equal(e.c.DOCK_LOGS.a.filter(x=>x.id===result.logs[0].id).length,1);
  if(action==='review_demand')assert.equal(project.intake.version,3);if(action==='review_verification')assert.equal(project.clues[0].verificationRequest.version,3);if(action==='advance_stage'){assert.equal(project.stage,6);assert.equal(project.stageLog[0].id,'newer-stage');}
});
for(const action of ['review_demand','review_verification','advance_stage'])test(action+' updates target state while preserving concurrent unrelated state',async()=>{
  const e=boot(),g=gate();e.setTransport(async sent=>{const result=e.receipt(sent);await g.promise;return {ok:true,status:200,json:async()=>result};});const project=e.c.PROJECTS.a,pending=e.c.dockingSendWorkflow(bodyFor(action));
  project.clues[1].name='并发更新企业乙';project.clues.push({id:'c3',name:'新增企业'});
  if(action!=='review_demand')project.intake.reply='并发受理备注';if(action!=='advance_stage'){project.stage=6;project.stageVersion=5;}
  g.resolve();assert.ok(await pending);assert.equal(project.clues[1].name,'并发更新企业乙');assert.equal(project.clues[2].name,'新增企业');if(action!=='review_demand')assert.equal(project.intake.reply,'并发受理备注');if(action!=='advance_stage')assert.equal(project.stage,6);
});
test('HTTP failures distinguish definite rejection from unknown save outcome without mutation',async()=>{
  for(const status of [400,403,408,409,503]){const e=boot(),before=snapshot(e);e.setTransport(()=>({ok:false,status,json:async()=>({ok:false,message:'未能保存'})}));try{await e.c.dockingSendWorkflow(bodyFor('review_demand'));assert.fail('expected error');}catch(error){assert.equal(error.definitive,status<500&&status!==408);}assert.equal(snapshot(e),before);assert.equal(e.events.persists,0);}
});
test('network and malformed JSON responses leave state untouched and are uncertain',async()=>{
  for(const malformed of [false,true]){const e=boot(),before=snapshot(e);e.setTransport(()=>{if(!malformed)throw new Error('network');return {ok:true,status:200,json:async()=>{throw new Error('bad JSON');}};});await assert.rejects(e.c.dockingSendWorkflow(bodyFor('review_demand')));assert.equal(snapshot(e),before);assert.equal(e.events.persists,0);}
});
test('acknowledged duplicate response merges one immutable event and accepts later server version',async()=>{
  const e=boot(),body=bodyFor('review_demand');let result=e.receipt(body);result.created=false;result.project.intake={...result.project.intake,version:3,status:'feedback',reply:'后续反馈'};e.setTransport(()=>({ok:true,status:200,json:async()=>clone(result)}));
  assert.ok(await e.c.dockingSendWorkflow(body));assert.ok(await e.c.dockingSendWorkflow(body));assert.equal(e.c.PROJECTS.a.intake.version,3);assert.equal(e.c.DOCK_LOGS.a.filter(x=>x.id===result.logs[0].id).length,1);
});
for(const action of ['review_demand','review_verification','advance_stage'])test(action+' rejects state that contradicts its same-version receipt',async()=>{
  const e=boot(),before=snapshot(e);e.setTransport(sent=>{const result=e.receipt(sent);if(action==='review_demand')result.project.intake.status='needs_info';if(action==='review_verification')result.project.clues[0].verificationRequest.outcome='not_suitable';if(action==='advance_stage')result.project.stage=4;return {ok:true,status:200,json:async()=>result};});
  await assert.rejects(e.c.dockingSendWorkflow(bodyFor(action)));assert.equal(snapshot(e),before);assert.equal(e.events.persists,0);
});
