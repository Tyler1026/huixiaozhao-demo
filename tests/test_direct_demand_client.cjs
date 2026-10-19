'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const code=['frontend/shared/docking-actions.js','frontend/shared/industry-demands.js'].map(name=>fs.readFileSync(path.join(root,name),'utf8')).join('\n');
const clone=value=>JSON.parse(JSON.stringify(value));
function gate(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function decode(text){return text.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');}
function boot(){
  const events={posts:[],toasts:[],persisted:0,renders:0,closed:0,modals:[]},dom={},viewState={};
  let transport=null,serial=0,keys=['parent'];
  const c={PROJECTS:{parent:{id:'parent',workspaceId:'parent',city:'闵行区',org:'测试机构',topic:'原有分析方向'},other:{id:'other',workspaceId:'other',city:'闵行区'}},DEMANDS:[],REPORTSTATE:{parent:{text:'现有报告应保留'}},DOCK_LOGS:{},_authEpoch:1,cur:'parent',view:'home',window:{},console,JSON,Date,Math,Number,String,URL,crypto:{randomUUID:()=>String(++serial)},
    cityKeys:()=>keys,document:{getElementById:id=>dom[id]||null},dockingViewState:()=>viewState,
    escapeChainText:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
    toast:message=>events.toasts.push(message),persist:()=>events.persisted++,render:()=>events.renders++,closeModal:()=>events.closed++,
    openModal(...args){events.modals.push(args);const markup=args[1]+args[2];for(const id of ['directDemandTitle','directDemandDescription','directDemandConditions','directDemandContactName','directDemandContactMethod','directDemandError','directDemandSubmit']){
      const textarea=markup.match(new RegExp('<textarea[^>]*id="'+id+'"[^>]*>([\\s\\S]*?)<\\/textarea>'));
      const input=markup.match(new RegExp('<input[^>]*id="'+id+'"[^>]*>'));
      const initial=textarea?decode(textarea[1]):input&&input[0].match(/\bvalue="([^"]*)"/);
      dom[id]={value:typeof initial==='string'?initial:initial?decode(initial[1]):'',textContent:'',disabled:false,isConnected:true};
    }},
    fetch:async(url,options)=>{const request={url,options,body:JSON.parse(options.body)};events.posts.push(request);return transport?transport(request):{ok:true,status:200,json:async()=>receipt(request)};}
  };
  function receipt(request){const body=request.body,key='direct-child-'+body.requestId;const spec={...clone(body.demand),source:'user_direct',verificationStatus:'user_stated'};const identity={demandContract:'industry-demand-v1',demandOrigin:'direct',directRequestId:body.requestId,directRequestFingerprint:'server-fingerprint'};return {ok:true,created:true,projectKey:key,
    project:{...identity,id:key,workspaceId:body.projectKey,parentProjectKey:body.projectKey,isDemand:true,submissionState:'submitted',topic:body.demand.title,demandTitle:body.demand.title,demandSpec:spec,stage:4,clues:[],submittedAt:1000},
    demand:{...identity,id:'receipt-'+body.requestId,projKey:key,title:body.demand.title,topic:body.demand.title,demandTitle:body.demand.title,domain:body.demand.title,need:body.demand.description,note:body.demand.conditions,demandSpec:clone(spec),res:'none',resLabel:'待受理'},reportState:{}};}
  vm.createContext(c);vm.runInContext(code,c);
  function open(){assert.equal(c.openDirectDemandComposer(),true);dom.directDemandTitle.value='生物制药滤器企业招引';dom.directDemandDescription.value='寻找有实际交付能力的滤器制造企业';dom.directDemandConditions.value='希望具备医药客户供货经验';dom.directDemandContactName.value='测试联系人';dom.directDemandContactMethod.value='仅用于本地流程测试';}
  return {c,events,dom,open,receipt,setTransport:value=>transport=value,setKeys:value=>keys=value};
}
function snapshot(e){return JSON.stringify([e.c.PROJECTS,e.c.DEMANDS,e.c.REPORTSTATE,e.c.DOCK_LOGS]);}

test('known demand submits without any source report and preserves its user-stated origin',async()=>{
  const e=boot();e.open();const rootBefore=clone(e.c.PROJECTS.parent),reportBefore=clone(e.c.REPORTSTATE.parent);
  assert.equal(await e.c.submitDirectDemand(),true);const request=e.events.posts[0],body=request.body;
  assert.equal(request.url,'/api/industry-demand');assert.equal(request.options.method,'POST');assert.equal(request.options.credentials,'same-origin');
  assert.deepEqual(Object.keys(body).sort(),['demand','mode','projectKey','requestId']);assert.equal(body.mode,'direct');assert.equal(body.projectKey,'parent');
  assert.deepEqual(Object.keys(body.demand).sort(),['conditions','contactMethod','contactName','description','title']);
  assert.equal(e.c.DEMANDS.length,1);const child=e.c.PROJECTS[e.c.DEMANDS[0].projKey];assert.equal(child.demandOrigin,'direct');assert.equal(child.demandSpec.source,'user_direct');assert.equal(child.demandSpec.verificationStatus,'user_stated');
  for(const field of ['selectedPriority','sourceProjectKey','sourcePriorityKey','sourceAnalysisTopic'])assert.equal(field in child,false);
  assert.deepEqual(clone(e.c.PROJECTS.parent),rootBefore);assert.deepEqual(clone(e.c.REPORTSTATE.parent),reportBefore);
  assert.equal(e.events.persisted,1);assert.equal(e.events.closed,1);assert.equal(e.c.window.__projOpen,child.id);assert.equal(e.c.DIRECT_DEMAND_DRAFT,null);
});
test('no local mutation or success before acknowledgement and repeated click is ignored',async()=>{
  const e=boot();e.open();const before=snapshot(e),g=gate();e.setTransport(async request=>{await g.promise;return {ok:true,status:200,json:async()=>e.receipt(request)};});
  const pending=e.c.submitDirectDemand();assert.equal(e.dom.directDemandSubmit.disabled,true);assert.equal(snapshot(e),before);assert.equal(e.events.persisted,0);assert.equal(e.events.toasts.length,0);
  assert.equal(await e.c.submitDirectDemand(),false);assert.equal(e.events.posts.length,1);g.resolve();assert.equal(await pending,true);assert.equal(e.dom.directDemandSubmit.disabled,false);
});
for(const failure of ['network','json','server','rejected'])test(failure+' failure retains draft and never claims success',async()=>{
  const e=boot();e.open();const before=snapshot(e);e.setTransport(()=>{if(failure==='network')throw new Error('connection lost');if(failure==='json')return {ok:true,status:200,json:async()=>{throw new Error('invalid JSON');}};return {ok:failure==='rejected',status:failure==='server'?503:200,json:async()=>({ok:false,message:'尚未保存'})};});
  assert.equal(await e.c.submitDirectDemand(),false);assert.equal(snapshot(e),before);assert.equal(e.events.persisted,0);assert.equal(e.events.closed,0);assert.equal(e.events.toasts.length,0);assert.ok(e.dom.directDemandError.textContent);assert.equal(e.dom.directDemandTitle.value,'生物制药滤器企业招引');assert.equal(e.dom.directDemandSubmit.disabled,false);
});
test('lost response retries the same id and payload and adopts one acknowledged demand',async()=>{
  const e=boot();e.open();let saved;
  e.setTransport(request=>{if(!saved){saved=e.receipt(request);throw new Error('lost after commit');}assert.equal(request.body.requestId,saved.project.directRequestId);return {ok:true,status:200,json:async()=>({...clone(saved),created:false})};});
  assert.equal(await e.c.submitDirectDemand(),false);assert.equal(e.c.DIRECT_DEMAND_DRAFT.uncertain,true);assert.equal(e.c.DEMANDS.length,0);
  assert.equal(await e.c.submitDirectDemand(),true);assert.deepEqual(e.events.posts[0].body,e.events.posts[1].body);assert.equal(e.c.DEMANDS.length,1);assert.equal(e.events.persisted,1);
});
test('changed content after uncertain response is blocked until original payload is retried',async()=>{
  const e=boot();e.open();e.setTransport(()=>{throw new Error('lost after commit');});assert.equal(await e.c.submitDirectDemand(),false);
  e.dom.directDemandDescription.value='不同的需求内容';assert.equal(await e.c.submitDirectDemand(),false);assert.equal(e.events.posts.length,1);assert.match(e.dom.directDemandError.textContent,/原内容重试/);
});
test('definitive rejection permits edited content under a fresh id',async()=>{
  const e=boot();e.open();e.setTransport(()=>({ok:false,status:400,json:async()=>({ok:false,message:'请修改需求'})}));assert.equal(await e.c.submitDirectDemand(),false);const first=e.events.posts[0].body.requestId;
  e.dom.directDemandDescription.value='修正后的完整需求';e.setTransport(null);assert.equal(await e.c.submitDirectDemand(),true);assert.notEqual(e.events.posts[1].body.requestId,first);assert.equal(e.c.DEMANDS[0].need,'修正后的完整需求');
});
for(const change of ['epoch','workspace'])test(change+' change before submit blocks stale form',async()=>{
  const e=boot();e.open();if(change==='epoch')e.c._authEpoch++;else e.setKeys(['other']);const before=snapshot(e);assert.equal(await e.c.submitDirectDemand(),false);assert.equal(e.events.posts.length,0);assert.equal(snapshot(e),before);assert.match(e.dom.directDemandError.textContent,/已变化/);
});
for(const change of ['epoch','workspace'])test(change+' change in flight cannot insert previous context data',async()=>{
  const e=boot();e.open();const g=gate();e.setTransport(async request=>{const saved=e.receipt(request);await g.promise;return {ok:true,status:200,json:async()=>saved};});
  const pending=e.c.submitDirectDemand();if(change==='epoch'){e.c._authEpoch++;e.c.PROJECTS={};e.c.DEMANDS=[];e.c.REPORTSTATE={};}else e.setKeys(['other']);const before=snapshot(e);g.resolve();assert.equal(await pending,false);assert.equal(snapshot(e),before);assert.equal(e.events.persisted,0);assert.equal(e.events.toasts.length,0);
});
test('in-flight reopening cannot replace the pending request identity',async()=>{
  const e=boot();e.open();const g=gate();e.setTransport(async request=>{await g.promise;return {ok:true,status:200,json:async()=>e.receipt(request)};});const draft=e.c.DIRECT_DEMAND_DRAFT,pending=e.c.submitDirectDemand();
  assert.equal(e.c.openDirectDemandComposer(),false);assert.equal(e.c.DIRECT_DEMAND_DRAFT,draft);g.resolve();assert.equal(await pending,true);
});
test('delayed direct receipt preserves newer receiving progress already loaded for the same demand',async()=>{
  const e=boot();e.open();const g=gate();let saved;
  e.setTransport(async request=>{saved=e.receipt(request);await g.promise;return {ok:true,status:200,json:async()=>saved};});
  const pending=e.c.submitDirectDemand();const key=saved.projectKey,project=clone(saved.project),demand=clone(saved.demand);
  project.intake={contract:'docking-action-v1',version:2,status:'feedback',reply:'管理端已经反馈'};project.stage=5;project.stageVersion=1;project.clues=[{id:'new-clue',name:'已推送企业'}];
  demand.clues=1;demand.res='matched';e.c.PROJECTS[key]=project;e.c.DEMANDS.push(demand);
  g.resolve();assert.equal(await pending,true);assert.equal(e.c.PROJECTS[key].intake.version,2);assert.equal(e.c.PROJECTS[key].stage,5);assert.equal(e.c.PROJECTS[key].clues[0].id,'new-clue');assert.equal(e.c.DEMANDS.length,1);assert.equal(e.c.DEMANDS[0].clues,1);assert.equal(e.c.DEMANDS[0].res,'matched');
});
test('reopening after a lost response restores the original request instead of duplicating it',async()=>{
  const e=boot();e.open();e.setTransport(()=>{throw new Error('lost after commit');});assert.equal(await e.c.submitDirectDemand(),false);const originalId=e.c.DIRECT_DEMAND_DRAFT.requestId,originalBody=clone(e.events.posts[0].body);
  e.c.closeModal();assert.equal(e.c.openDirectDemandComposer(),true);assert.equal(e.c.DIRECT_DEMAND_DRAFT.requestId,originalId);assert.equal(e.c.DIRECT_DEMAND_DRAFT.uncertain,true);assert.equal(e.dom.directDemandDescription.value,originalBody.demand.description);e.setTransport(null);assert.equal(await e.c.submitDirectDemand(),true);assert.deepEqual(e.events.posts[1].body,originalBody);
});
const corruptions={
  'truthy ok':r=>{r.ok='yes';},'project contract':r=>{r.project.demandContract='other';},'project id':r=>{r.project.id='other';},'project kind':r=>{r.project.isDemand=false;},'submission state':r=>{r.project.submissionState='draft';},'workspace':r=>{r.project.workspaceId='other';},'origin':r=>{r.project.demandOrigin='report';},'request id':r=>{r.project.directRequestId='other';},
  'root overwritten':r=>{r.projectKey='parent';r.project.id='parent';r.demand.projKey='parent';},'demand project':r=>{r.demand.projKey='other';},'demand contract':r=>{r.demand.demandContract='other';},'demand origin':r=>{r.demand.demandOrigin='report';},'demand request':r=>{r.demand.directRequestId='other';},'missing receipt id':r=>{delete r.demand.id;},
  'changed request description':r=>{r.project.demandSpec.description='wrong';},'changed demand description':r=>{r.demand.need='wrong';},'fabricated source priority':r=>{r.project.selectedPriority={focus:'invented'};},'fabricated source report':r=>{r.reportState={text:'invented report'};}
};
for(const [name,corrupt] of Object.entries(corruptions))test('mismatched '+name+' receipt is rejected before local mutation',async()=>{
  const e=boot();e.open();const before=snapshot(e);e.setTransport(request=>{const result=e.receipt(request);corrupt(result);return {ok:true,status:200,json:async()=>result};});assert.equal(await e.c.submitDirectDemand(),false);assert.equal(snapshot(e),before);assert.equal(e.events.persisted,0);assert.equal(e.events.closed,0);assert.ok(e.dom.directDemandError.textContent);
});
for(const [field,value] of [['directDemandTitle',''],['directDemandTitle','x'.repeat(121)],['directDemandDescription',''],['directDemandDescription','x'.repeat(6001)],['directDemandConditions','x'.repeat(2001)],['directDemandContactName','x'.repeat(81)],['directDemandContactMethod','x'.repeat(241)]])test(field+' enforces server input limit before POST',async()=>{
  const e=boot();e.open();e.dom[field].value=value;assert.equal(await e.c.submitDirectDemand(),false);assert.equal(e.events.posts.length,0);assert.ok(e.dom.directDemandError.textContent);
});
test('direct demand summary names direct submission without implying an analysis report',()=>{
  const e=boot();const html=e.c.industryDemandSummaryHtml({demandContract:'industry-demand-v1',demandOrigin:'direct',demandTitle:'<需求标题>',topic:'用户自填需求',demandSpec:{description:'<script>测试</script>',conditions:'现场承接条件',source:'user_direct'}});
  assert.match(html,/直接提交/);assert.doesNotMatch(html,/来自分析|对应建议|原报告/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});
