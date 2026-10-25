'use strict';
// Actual navigation/authenticated restore functions; transport and DOM are local doubles.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
function between(text,a,b){const from=text.indexOf(a),to=text.indexOf(b,from+a.length);assert.ok(from>=0&&to>from);return text.slice(from,to);}
const ROOT='workspace-a',KEY='proj-demand-a';
function snapshot(){
 const spec={title:'Existing direct need',description:'Synthetic explicit need',conditions:'',source:'user_direct',verificationStatus:'user_stated'};
 const p={id:KEY,workspaceId:ROOT,parentProjectKey:ROOT,city:'Local A',demandTitle:spec.title,topic:spec.title,isDemand:true,submissionState:'submitted',demandContract:'industry-demand-v1',demandOrigin:'direct',submittedAt:123456,submittedBy:'member-a',demandSpec:spec,directRequestId:'direct-request',directRequestFingerprint:'a'.repeat(64),kb:[],clues:[]};
 const d={id:'d-demand-a',projKey:KEY,city:p.city,demandTitle:spec.title,topic:spec.title,demandContract:p.demandContract,demandOrigin:'direct',submittedAt:p.submittedAt,submittedBy:p.submittedBy,demandSpec:structuredClone(spec),need:spec.description,note:'',directRequestId:p.directRequestId,directRequestFingerprint:p.directRequestFingerprint};
 return {PROJECTS:{[ROOT]:{id:ROOT,workspaceId:ROOT,city:'Local A',kb:[]},[KEY]:p},DEMANDS:[d],RESET_GEN:'generation-1',REPORTSTATE:{},DELETED_PROJECTS:[]};
}
function harness(){
 const calls=[],effects=[],writes=[],listeners={};let server=snapshot();
 const c={console:{log(){}},Array,Object,String,Number,Math,Date,JSON,Promise,Set,cur:ROOT,view:'knowledge',detailData:null,detailOpen:false,
  AUTH:{user:'member-a',scope:'project',role:'member',projKey:ROOT,projectKeys:[ROOT]},_authEpoch:1,_authState:'ready',RESET_GEN:'generation-1',LS_KEY:'fixture',
  PROJECTS:{[ROOT]:structuredClone(server.PROJECTS[ROOT])},DEMANDS:[],REPORTSTATE:{},REPORT_HISTORY:{},UPLOADS:{},KB_EDITS:{},KB_CONFIRMS:{},KB_FILE_CHUNKS:{},KB_UNLOCKED:{},PENDING_CONFIRMS:{},DOCK_LOGS:{},KB_CHAT:{},KB_CHAT_TOMBS:{},KB_ITEM_TOMBS:{},KB_CONFIRM_TOMBS:{},UPLOAD_TOMBS:{},OPS_ENT:[],CITY_BASE_PACKAGES:{},CITY_WORKSPACES:{},USER_PROFILES:{},INVITE_CODES:{},SUBPROJ:{},DELETED_PROJECTS:[],DELETED_CLUES:[],
  P:()=>c.PROJECTS[c.cur]||{},kbReadiness:()=>({score:56,rawScore:56,color:'gray',confirmed:0,total:0,files:2}),hasRealKbData:()=>true,
  kbReadinessSummary:()=>({sectionText:'2/4',statusText:'pending',explanation:'quantity only'}),openModal:(...v)=>effects.push(['modal',...v]),render:()=>effects.push(['render']),toast:()=>{},industryAnalysisWorkspaceKey:()=>ROOT,
  localStorage:{setItem:(...v)=>writes.push(v),removeItem(){}},_safeSyncSnapshot:x=>x,_slimUploads:()=>({}),_safeProfiles:x=>x||{},_authReadSync:r=>r.json(),
  mergeTopicProjectLifecycle:(_,v)=>v,mergeTopicReportStates:(_,v)=>v||{},mergeTopicReportHistory:(_,v)=>v||{},_mergeUploads:v=>v||{},_mergeChunks:v=>v||{},_mergeConfirms:v=>v||{},_mergeKbChat:v=>v||{},
  _mergeKbItemTombs(){},_applyKbItemTombs(){},_mergeTombs(){},_mergeKbChatTombs(){},_mergeUploadTombs(){},_applyUploadTombs(){},applyTopicStateIntegrity(){},
  addEventListener:(name,fn)=>listeners[name]=fn,
  fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>structuredClone(server)};},
  document:{getElementById:()=>null},persist:()=>effects.push(['persist']),closeModal:()=>effects.push(['close']),escapeChainText:x=>String(x),dockingActionEpoch:()=>c._authEpoch,dockingRequestId:()=> 'fixture-request',dockingActionError:message=>new Error(message),
 };
 c.window=c;vm.createContext(c);
 const auth=read('frontend/index/script-02-sections/03.js'),tail=read('frontend/index/script-02-sections/14-tail.js');
 vm.runInContext(between(auth,'function _authProjectKeys(','/* A new direction'),c);
 const access=path.join(root,'frontend/index/submitted-demand-access.js');if(fs.existsSync(access))vm.runInContext(fs.readFileSync(access,'utf8'),c);
 vm.runInContext(read('frontend/shared/industry-demands.js'),c);
 vm.runInContext(between(auth,'function _authResetView(){','function _authAccept('),c);
 vm.runInContext(between(tail,'function _acceptServerGeneration(','function clearPersist(){'),c);
 vm.runInContext(between(tail,"window.addEventListener('storage',",'var UPLOADS={};'),c);
 vm.runInContext(between(read('frontend/index/script-02-sections/09.js'),'function isLocked(v){','function unlockView(v){'),c);
 vm.runInContext(between(read('frontend/index/script-02-sections/10.js'),'function go(v){','function bind(){'),c);
 return {c,calls,effects,writes,listeners,setServer:x=>server=structuredClone(x),async receive(x=snapshot()){server=structuredClone(x);let ok=false;await c.restoreFromServer(v=>ok=v);assert.equal(ok,true);c.cur=ROOT;c.view='knowledge';return x;}};
}
test('authenticated GET permits existing direct demand tracking below the material threshold',async()=>{
 const h=harness();await h.receive();const before=JSON.stringify(h.c.KB_UNLOCKED);h.c.go('home');
 assert.equal(h.c.view,'home');assert.equal(h.effects.filter(v=>v[0]==='modal').length,0);assert.equal(JSON.stringify(h.c.KB_UNLOCKED),before);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'/api/sync');assert.equal(h.calls[0].options.credentials,'same-origin');
});
test('existing tracking exemption also applies while the current project is the same authorized demand',async()=>{const h=harness();await h.receive();h.c.cur=KEY;assert.equal(h.c.isLocked('home'),false);assert.equal(h.c.isLocked('docking'),false);});
test('existing demand never exempts AI report readiness or modifies confirmation records',async()=>{const h=harness();await h.receive();assert.equal(h.c.isLocked('home'),false);assert.equal(h.c.isLocked('report'),true);assert.equal(JSON.stringify(h.c.KB_CONFIRMS),'{}');});
test('ordinary local draft and fabricated DEMANDS pair cannot create a server receipt',()=>{const h=harness(),s=snapshot();h.c.PROJECTS=s.PROJECTS;h.c.DEMANDS=s.DEMANDS;assert.equal(h.c.isLocked('home'),true);});
test('an empty authoritative GET never trusts a locally preserved fabricated demand',async()=>{const h=harness(),s=snapshot();h.c.PROJECTS=s.PROJECTS;h.c.DEMANDS=s.DEMANDS;delete s.PROJECTS[KEY];s.DEMANDS=[];await h.receive(s);assert.equal(h.c.isLocked('home'),true);});
for(const [label,change] of [
 ['missing receipt',s=>s.DEMANDS=[]],['legacy contract',s=>delete s.PROJECTS[KEY].demandContract],['unsubmitted',s=>s.PROJECTS[KEY].submissionState='pending'],['ordinary isDemand draft',s=>s.PROJECTS[KEY].submissionState='draft'],
 ['deleted project',s=>s.DELETED_PROJECTS=[KEY]],['archived project',s=>s.PROJECTS[KEY].archived=true],['wrong workspace',s=>s.PROJECTS[KEY].workspaceId='other'],['wrong parent',s=>s.PROJECTS[KEY].parentProjectKey='other'],
 ['root pretending to be demand',s=>{s.PROJECTS[ROOT]=s.PROJECTS[KEY];delete s.PROJECTS[KEY];s.PROJECTS[ROOT].id=ROOT;s.DEMANDS[0].projKey=ROOT;}],
 ['duplicate demand row',s=>s.DEMANDS.push(structuredClone(s.DEMANDS[0]))],['mismatched receipt origin',s=>s.DEMANDS[0].demandOrigin='report'],['mismatched fingerprint',s=>s.DEMANDS[0].directRequestFingerprint='b'.repeat(64)],['mismatched submittedBy',s=>s.DEMANDS[0].submittedBy='different'],['mismatched title',s=>s.DEMANDS[0].demandTitle='different'],['foreign city',s=>s.PROJECTS[KEY].city='Other city']
])test('GET does not exempt '+label,async()=>{const h=harness(),s=snapshot();change(s);await h.receive(s);assert.equal(h.c.isLocked('home'),true);});
for(const [label,change] of [['account',c=>c.AUTH.user='other'],['role',c=>c.AUTH.role='owner'],['membership',c=>c.AUTH.projectKeys=[]],['workspace',c=>c.AUTH.projKey='other'],['epoch',c=>c._authEpoch++],['generation',c=>c.RESET_GEN='generation-2']])test('stored receipt is unusable after '+label+' changes',async()=>{const h=harness();await h.receive();assert.equal(h.c.isLocked('home'),false);change(h.c);assert.equal(h.c.isLocked('home'),true);});
test('actual auth reset discards proof even if the old identity is restored locally',async()=>{const h=harness();await h.receive();assert.equal(h.c.isLocked('home'),false);const p=h.c.PROJECTS,d=h.c.DEMANDS;h.c._authResetView();h.c.cur=ROOT;h.c.PROJECTS=p;h.c.DEMANDS=d;assert.equal(h.c.isLocked('home'),true);});
test('new GET removes proof for a revoked or deleted demand despite local merge preservation',async()=>{const h=harness();await h.receive();assert.equal(h.c.isLocked('home'),false);const s=snapshot();delete s.PROJECTS[KEY];s.DEMANDS=[];await h.receive(s);assert.equal(h.c.isLocked('home'),true);});
test('newer GET wins over a delayed older GET',async()=>{
 const h=harness(),queue=[];h.c.fetch=()=>new Promise(resolve=>queue.push(resolve));
 const a=h.c.restoreFromServer(()=>{}),b=h.c.restoreFromServer(()=>{});const empty=snapshot();delete empty.PROJECTS[KEY];empty.DEMANDS=[];
 queue[1]({ok:true,json:async()=>empty});await b;queue[0]({ok:true,json:async()=>snapshot()});await a;h.c.cur=ROOT;assert.equal(h.c.isLocked('home'),true);
});
test('current demand identity cannot change underneath a stored server receipt',async()=>{const h=harness();await h.receive();assert.equal(h.c.isLocked('home'),false);h.c.DEMANDS[0].id='fabricated-new-id';assert.equal(h.c.isLocked('home'),true);});
test('intake status change is not a new submission identity and remains viewable',async()=>{const h=harness();await h.receive();h.c.PROJECTS[KEY].intake={status:'needs_info',version:2};assert.equal(h.c.isLocked('home'),false);});
test('validated actual direct-submission success registers tracking without a manual unlock',async()=>{
 const h=harness(),s=snapshot(),values={Title:s.PROJECTS[KEY].demandTitle,Description:s.PROJECTS[KEY].demandSpec.description,Conditions:'',ContactName:'',ContactMethod:''};
 s.PROJECTS[KEY].demandSpec.contactName='';s.PROJECTS[KEY].demandSpec.contactMethod='';s.DEMANDS[0].demandSpec=structuredClone(s.PROJECTS[KEY].demandSpec);
 h.c.document.getElementById=id=>id.startsWith('directDemand')&&id!=='directDemandError'&&id!=='directDemandSubmit'?{value:values[id.slice('directDemand'.length)],removeAttribute(){}}:null;
 h.c.DIRECT_DEMAND_DRAFT={key:ROOT,epoch:1,requestId:'direct-request',pending:false};
 h.c.fetch=async()=>({ok:true,json:async()=>({ok:true,projectKey:KEY,project:s.PROJECTS[KEY],demand:s.DEMANDS[0],reportState:{}})});
 assert.equal(await h.c.submitDirectDemand(),true);assert.equal(h.c.isLocked('home'),false);assert.equal(h.c.isLocked('report'),true);assert.equal(JSON.stringify(h.c.KB_UNLOCKED),'{}');
});
test('report-derived server receipt also permits tracking without granting report access',async()=>{
 const h=harness(),s=snapshot(),p=s.PROJECTS[KEY],d=s.DEMANDS[0];
 p.demandOrigin=d.demandOrigin='report';p.demandSpec.source=d.demandSpec.source='user_confirmed';p.topic=p.sourceAnalysisTopic='Source analysis';d.analysisTopic=p.topic;
 p.sourceProjectKey=d.sourceProjectKey=ROOT;p.sourcePriorityKey=d.sourcePriorityKey='priority-1';p.sourceReportIdentity='saved-identity';p.sourceReportFingerprint='b'.repeat(64);p.selectedPriority=d.selectedPriority={focus:'capacity',scope:'local'};
 await h.receive(s);assert.equal(h.c.isLocked('home'),false);assert.equal(h.c.isLocked('report'),true);
});
test('a fresh accepted generation can establish only its new server receipt',async()=>{const h=harness(),s=snapshot();s.RESET_GEN='generation-2';await h.receive(s);assert.equal(h.c.RESET_GEN,'generation-2');assert.equal(h.c.isLocked('home'),false);});
test('storage event with a fabricated submitted pair cannot create navigation proof',async()=>{
 const h=harness(),s=snapshot();s.clientUser=h.c.AUTH.user;h.listeners.storage({key:h.c.LS_KEY,newValue:JSON.stringify(s)});
 assert.equal(h.c.isLocked('home'),true);
});
test('generic cache writes never serialize the server navigation proof',async()=>{const h=harness();await h.receive();assert.equal(h.c.isLocked('home'),false);assert.ok(h.writes.length);for(const [,value] of h.writes)assert.doesNotMatch(value,/SUBMITTED_DEMAND_ACCESS|submittedDemandAccess|proofs|direct-request.*identity/);});
test('same-epoch identity changes while GET is pending cannot adopt its receipt',async()=>{
 const h=harness();let deliver;h.c.fetch=()=>new Promise(resolve=>deliver=resolve);const pending=h.c.restoreFromServer(()=>{});h.c.AUTH.user='other-account';deliver({ok:true,json:async()=>snapshot()});await pending;h.c.cur=ROOT;assert.equal(h.c.isLocked('home'),true);
});
test('auth-reset pending GET cannot restore old proof even if its generation differs',async()=>{
 const h=harness();let deliver;h.c.fetch=()=>new Promise(resolve=>deliver=resolve);const pending=h.c.restoreFromServer(()=>{});h.c._authResetView();const s=snapshot();s.RESET_GEN='older-generation';deliver({ok:true,json:async()=>s});await pending;h.c.cur=ROOT;assert.equal(h.c.isLocked('home'),true);
});
test('higher material readiness and explicit report override retain their original behavior',()=>{
 const h=harness();h.c.kbReadiness=()=>({rawScore:80,score:79});assert.equal(h.c.isLocked('report'),false);assert.equal(h.c.isLocked('home'),false);
 h.c.kbReadiness=()=>({rawScore:0,score:0});assert.equal(h.c.isLocked('report'),true);h.c.KB_UNLOCKED[ROOT]={report:true};assert.equal(h.c.isLocked('report'),false);
});
