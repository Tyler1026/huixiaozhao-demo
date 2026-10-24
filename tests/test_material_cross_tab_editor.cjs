"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const fixtureFile=path.join(__dirname,'test_kb_detail_render.cjs'),actualRequire=createRequire(fixtureFile);
const fixture={__dirname,path,console,Buffer,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,module:{exports:{}}};
fixture.require=name=>name==='node:test'?()=>{}:actualRequire(name);
vm.runInNewContext(fs.readFileSync(fixtureFile,'utf8')+'\nmodule.exports={actionHarness,kbEditReply,pendingKbEdit};',fixture,{filename:fixtureFile});
const {actionHarness,kbEditReply,pendingKbEdit}=fixture.module.exports;
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const tail=read('frontend/index/script-02-sections/14-tail.js'),auth=read('frontend/index/script-02-sections/03.js'),layout=read('frontend/index/script-02-sections/12-tail.js');
function between(s,a,b){const x=s.indexOf(a),y=s.indexOf(b,x+a.length);assert.ok(x>=0&&y>x);return s.slice(x,y);}
const KEY='workspace-a',ID='me5-note';
function note(extra={}){return {id:ID,sectionIndex:0,sectionTitle:'政策',sourceIndex:null,sourceItem:null,baseReportVersion:null,text:'原始并发补充。',revision:1,ts:1,account:'reviewer',status:'edited',...extra};}
function setup({source=false,revised=false,isNew=false,boundWorkspace=false}={}){
 const h=actionHarness(source?[{text:'原始来源正文。',origin:'report'}]:[]),c=h.c;
 Object.assign(c,{_authState:'ready',AUTH:{user:'reviewer',scope:'project',role:'member',projKey:KEY,projectKeys:[KEY]},PROJECTS:{[KEY]:h.project},LS_KEY:'huixiaozhao_kb_v1',view:'knowledge',_lastUserScrollMs:0,
  REPORTSTATE:{},REPORT_HISTORY:{},UPLOADS:{},UPLOAD_TOMBS:{},KB_CHAT:{},KB_UNLOCKED:{},PENDING_CONFIRMS:{},DOCK_LOGS:{},CITY_BASE_PACKAGES:{},DEMANDS:[],render(){},
  _mergeChunks:(incoming,old)=>incoming||old,_mergeKbItemTombs(){},_applyKbItemTombs(){},_mergeTombs(){},_mergeConfirms:x=>x,
  applyTopicStateIntegrity(){},_mergeKbChatTombs(){},_mergeUploadTombs(){},_mergeKbChat:(incoming,old)=>incoming||old,_applyUploadTombs(){},
  mergeTopicReportStates:(old,incoming)=>incoming||old,mergeTopicReportHistory:(old,incoming)=>incoming||old});
 if(boundWorkspace)h.project.workspaceId=KEY;
 c.P=()=>c.PROJECTS[c.cur]||{};
 vm.runInContext(between(auth,'function _safeSyncSnapshot(','function saveAuth(')+'\n'+between(auth,'function _authProjectKeys(','/* A new direction'),c);
 vm.runInContext(between(layout,'function reportStateStamp(','function mergeTopicReportState('),c);
 vm.runInContext(between(tail,"window.addEventListener('storage',",'var UPLOADS={};'),c);
 if(!source&&!isNew)c.KB_EDITS[KEY]={[ID]:note()};
 if(revised){h.project.baseReportVersion='r1';c.KB_EDITS[KEY]={[ID]:note({sourceIndex:0,sourceItem:JSON.parse(JSON.stringify(h.project.kb[0].known[0])),baseReportVersion:'r1'})};}
 assert.equal(c.kbOpenEditor(0,0,isNew,-1),true);h.textarea().value='尚未提交的 WINNER 草稿。';c.kbEditorChanged();
 return h;
}
function snapshot(h,mutate){const c=h.c,data=JSON.parse(JSON.stringify({PROJECTS:c.PROJECTS,REPORTSTATE:c.REPORTSTATE,KB_FILE_CHUNKS:c.KB_FILE_CHUNKS,clientUser:c.AUTH.user,RESET_GEN:c.RESET_GEN,syncTs:1}));if(mutate)mutate(data);return data;}
function receive(h,data){h.listeners.storage({key:h.c.LS_KEY,newValue:JSON.stringify(data)});}
function retained(h,draft){assert.ok(h.c.kbEditSession);assert.equal(h.textarea().value,draft);assert.notEqual(h.c.kbEditSession.saving,true);assert.equal(h.effects.persist,0);}
test('same-account unchanged storage restore can save an existing note once without losing its draft',async()=>{
 const h=setup(),old=h.c.P(),draft=h.textarea().value;
 receive(h,snapshot(h));assert.notEqual(h.c.P(),old,'real storage listener installs a distinct project');
 await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,1,'benign cross-tab read must not block before POST');
 assert.equal(h.effects.requests[0].body.editId,ID);assert.equal(h.effects.requests[0].body.expectedRevision,1);assert.equal(h.effects.requests[0].body.text,draft);
 assert.equal(h.c.KB_EDITS[KEY][ID].revision,2);assert.equal(h.c.kbEditSession,null);
});

for(const config of [{source:true},{source:true,revised:true},{isNew:true}])test('unchanged storage retains editor target '+JSON.stringify(config),async()=>{
 const h=setup(config),draft=h.textarea().value;receive(h,snapshot(h));await h.c.saveKbEdit(0,0);
 assert.equal(h.effects.requests.length,1);assert.equal(h.effects.requests[0].body.text,draft);
 assert.equal(h.effects.requests[0].body.sourceIndex,config.source?0:null);
});
test('unrelated new material and changed route fields do not redirect the stable note',async()=>{
 const h=setup(),draft=h.textarea().value;
 receive(h,snapshot(h,d=>{d.PROJECTS[KEY].kb[0].known.push('其他文件的新标记');d.PROJECTS[KEY].topic='其他显示方向';d.PROJECTS[KEY].stage=3;}));
 await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,1);assert.equal(h.effects.requests[0].body.editId,ID);assert.equal(h.effects.requests[0].body.text,draft);
});
test('snapshot does not rewrite the textarea, selection, or active element',()=>{
 const h=setup(),ta=h.textarea(),session=h.c.kbEditSession;ta.focus();ta.setSelectionRange(2,7);
 receive(h,snapshot(h));assert.equal(h.textarea(),ta);assert.equal(h.c.document.activeElement,ta);assert.equal(ta.selectionStart,2);assert.equal(ta.selectionEnd,7);assert.equal(h.c.kbEditSession,session);
});
for(const [name,change] of [
 ['different account',h=>{h.c.AUTH.user='other';}],['permission role changed',h=>{h.c.AUTH.role='viewer';}],
 ['membership removed',h=>{h.c.AUTH.projectKeys=[];}],['account scope changed',h=>{h.c.AUTH.scope='admin';}],
 ['authentication state changed',h=>{h.c._authState='anonymous';}],['authentication epoch changed',h=>{h.c._authEpoch++;}],
 ['workspace switched',h=>{h.c.cur='workspace-b';}],['reset generation changed',h=>{h.c.RESET_GEN='new-generation';}]
])test(name+' remains rejected with draft intact',async()=>{
 const h=setup(),data=snapshot(h),draft=h.textarea().value;change(h);receive(h,data);await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,0);retained(h,draft);
});
for(const [name,change] of [
 ['project removed',d=>{delete d.PROJECTS[KEY];}],['workspace relation changed',d=>{d.PROJECTS[KEY].workspaceId='different-workspace';}],
 ['city identity changed',d=>{d.PROJECTS[KEY].city='其他城市';}],['section removed',d=>{d.PROJECTS[KEY].kb=[];}],
 ['section title changed',d=>{d.PROJECTS[KEY].kb[0].t='不同板块';}],['section title ambiguous',d=>{d.PROJECTS[KEY].kb.push(JSON.parse(JSON.stringify(d.PROJECTS[KEY].kb[0])));}],
 ['section deleted',d=>{d.PROJECTS[KEY].deletedTopics=['政策'];}],['project version changed',d=>{d.PROJECTS[KEY].baseReportVersion='r2';}]
])test(name+' snapshot cannot revive the existing editor',async()=>{
 const h=setup(),draft=h.textarea().value;receive(h,snapshot(h,change));await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,0);retained(h,draft);
});
for(const [name,change] of [
 ['record revision',h=>{h.c.KB_EDITS[KEY][ID].revision=2;}],['record text',h=>{h.c.KB_EDITS[KEY][ID].text='另一用户已保存';}],
 ['record deleted',h=>{h.c.KB_EDITS[KEY][ID].deleted=true;}],['record removed',h=>{delete h.c.KB_EDITS[KEY][ID];}]
])test(name+' update blocks rebind rather than upgrading the expected version',async()=>{
 const h=setup(),draft=h.textarea().value;change(h);receive(h,snapshot(h));await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,0);retained(h,draft);
});
for(const revised of [false,true])test('source text replacement is rejected, revised='+revised,async()=>{
 const h=setup({source:true,revised}),draft=h.textarea().value;
 receive(h,snapshot(h,d=>{d.PROJECTS[KEY].kb[0].known[0].text='原件已经被更换';}));
 await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,0);retained(h,draft);
});
test('a rejected snapshot cannot later revive through a matching benign snapshot',async()=>{
 const h=setup(),original=snapshot(h),draft=h.textarea().value;receive(h,snapshot(h,d=>{d.PROJECTS[KEY].city='different';}));receive(h,original);
 await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,0);retained(h,draft);
});
test('server 409 after benign snapshot remains a real request failure and keeps expected revision',async()=>{
 const h=setup(),draft=h.textarea().value;receive(h,snapshot(h));
 h.c.fetch=async(url,options)=>{h.effects.requests.push({url,body:JSON.parse(options.body)});return {ok:false,status:409,json:async()=>({ok:false,message:'已更新，请重新打开资料'})};};
 await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,1);assert.equal(h.effects.requests[0].body.expectedRevision,1);assert.equal(h.c.KB_EDITS[KEY][ID].revision,1);retained(h,draft);
});
test('two synthetic clients keep independent expected revision; the second receives 409',async()=>{
 const a=setup(),b=setup();let version=1,text='原始并发补充。',count=0;
 const server=h=>async(url,options)=>{const body=JSON.parse(options.body);h.effects.requests.push({url,body});count++;
  if(body.expectedRevision!==version)return {ok:false,status:409,json:async()=>({ok:false,message:'修订冲突，请重新打开资料'})};
  version++;text=body.text;return kbEditReply(body,{revision:version});};
 a.c.fetch=server(a);b.c.fetch=server(b);receive(a,snapshot(a));receive(b,snapshot(b));
 await a.c.saveKbEdit(0,0);b.textarea().value='STALE 尝试';await b.c.saveKbEdit(0,0);
 assert.equal(count,2);assert.equal(version,2);assert.equal(text,'尚未提交的 WINNER 草稿。');assert.equal(b.effects.requests[0].body.expectedRevision,1);retained(b,'STALE 尝试');
});
test('successful response after a safe snapshot is installed into the current project only once',async()=>{
 const h=setup(),server=pendingKbEdit(h),pending=h.c.saveKbEdit(0,0),body=server.body();
 receive(h,snapshot(h));server.resolve(kbEditReply(body));await pending;
 assert.equal(h.effects.requests.length,1);assert.equal(h.effects.persist,1);assert.equal(h.c.kbEditSession,null);assert.equal(h.c.KB_EDITS[KEY][ID].revision,2);
});
test('late response after identity change does not install data into a new account',async()=>{
 const h=setup(),server=pendingKbEdit(h),pending=h.c.saveKbEdit(0,0),body=server.body();
 h.c._authEpoch++;h.c.AUTH.user='new-account';h.c.KB_EDITS={};server.resolve(kbEditReply(body));await pending;
 assert.equal(Object.keys(h.c.KB_EDITS).length,0);assert.equal(h.effects.persist,0);
});
function installRestore(h){
 const c=h.c,writes=[];
 Object.assign(c,{USER_PROFILES:{},CITY_ACCOUNTS:{},INVITE_CODES:{},KB_CONFIRM_TOMBS:{},KB_CHAT_TOMBS:{},OPS_ENT:[],DELETED_PROJECTS:[],DELETED_CLUES:[],_mergeUploads:(incoming,old)=>incoming||old,_safeProfiles:x=>x||{},_slimUploads:()=>({}),
  _acceptServerGeneration:()=>false,_authReadSync:r=>r.json(),localStorage:{setItem:(key,value)=>writes.push({key,value})}});
 vm.runInContext(between(tail,'function restoreFromServer(',"window.addEventListener('storage',"),c);
 return writes;
}
test('real GET restore writes the browser snapshot but permits an unchanged material save',async()=>{
 const h=setup(),c=h.c,writes=installRestore(h),old=c.P(),data=snapshot(h);data.KB_EDITS=JSON.parse(JSON.stringify(c.KB_EDITS));
 const save=c.fetch;c.fetch=async(url,options)=>options&&options.method==='POST'?save(url,options):{ok:true,json:async()=>data};
 let ok=false;await c.restoreFromServer(value=>{ok=value;});assert.equal(ok,true);assert.notEqual(c.P(),old);assert.ok(writes.some(x=>x.key===c.LS_KEY));
 await c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,1);assert.equal(h.effects.requests[0].body.expectedRevision,1);
});
test('real GET restore carrying a newer revision does not rebase the pending draft',async()=>{
 const h=setup(),c=h.c;installRestore(h);const data=snapshot(h);data.KB_EDITS={[KEY]:{[ID]:note({revision:2,text:'服务端已变更'})}};
 c.fetch=async()=>({ok:true,json:async()=>data});let ok=false;await c.restoreFromServer(value=>{ok=value;});assert.equal(ok,true);
 await c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,0);assert.equal(c.kbEditSession.revision,1);retained(h,'尚未提交的 WINNER 草稿。');
});

for(const [name,change] of [
 ['account without an epoch bump',h=>{h.c.AUTH.user='new-account';h.c.KB_EDITS={};}],
 ['permission without an epoch bump',h=>{h.c.AUTH.role='viewer';}],
 ['reset generation',h=>{h.c.RESET_GEN='new-generation';}]
])test('late receipt after changed '+name+' is not installed',async()=>{
 const h=setup(),server=pendingKbEdit(h),pending=h.c.saveKbEdit(0,0),body=server.body();change(h);
 server.resolve(kbEditReply(body));await pending;assert.equal(h.effects.persist,0);
 assert.ok(!h.c.KB_EDITS[KEY]||h.c.KB_EDITS[KEY][ID].revision===1);
});
test('a newer source-bound deleted revision cannot be rebound as the opened restored source',async()=>{
 const h=actionHarness([{text:'原始资料',origin:'report'}]),c=h.c;
 c.KB_EDITS[KEY]={[ID]:note({deleted:true,sourceIndex:0,sourceItem:JSON.parse(JSON.stringify(h.project.kb[0].known[0])),baseReportVersion:null})};
 c.editKbItem(0,0,-1);h.textarea().value='恢复原文后新草稿';const s=c.kbEditorSnapshotSession();
 c.KB_EDITS[KEY][ID].revision=2;c.P=()=>({...h.project,kb:h.project.kb.map(k=>({...k,known:k.known.slice()}))});
 assert.equal(c.kbEditorRestoreSnapshot(s),false);await c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,0);
});

test('same workspace with explicit workspaceId survives an unchanged storage snapshot',async()=>{
 const h=setup({boundWorkspace:true});receive(h,snapshot(h));await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,1);assert.equal(h.effects.requests[0].body.projectKey,KEY);
});
test('source metadata-only change rejects rebind even with the same source text',async()=>{
 const h=setup({source:true}),draft=h.textarea().value;
 receive(h,snapshot(h,d=>{d.PROJECTS[KEY].kb[0].known[0].sourceFile='another-source.md';}));await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,0);retained(h,draft);
});
test('same revision with changed record metadata rejects rebind',async()=>{
 const h=setup(),draft=h.textarea().value;h.c.KB_EDITS[KEY][ID].account='different-author';receive(h,snapshot(h));await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,0);retained(h,draft);
});
test('real server reset generation path rejects the old editor without issuing a save',async()=>{
 const h=setup(),c=h.c;installRestore(h);
 vm.runInContext(between(tail,'function _acceptServerGeneration(','var _serverRestoreSeq='),c);
 const data=snapshot(h);data.RESET_GEN='server-generation-2';data.KB_EDITS={[KEY]:{[ID]:note()}};
 c.fetch=async()=>({ok:true,json:async()=>data});let ok=false;await c.restoreFromServer(value=>{ok=value;});assert.equal(ok,true);assert.equal(c.RESET_GEN,'server-generation-2');
 await c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,0);retained(h,'尚未提交的 WINNER 草稿。');
});
