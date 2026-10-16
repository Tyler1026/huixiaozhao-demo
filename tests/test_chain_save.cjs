'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,gate,modelStarted,cache,clone,topic,report,fn}=require('./chain_v2_fixture.cjs');
for(const app of ['index','ops']){
 test(app+' syncs plain inputs before generation and adopts only the server-owned result',async()=>{
  const e=setup(app),g=gate();cache(e);e.c.PROJECTS.p.segmentLevels={legacy:true};e.setSyncGate(g);
  const work=e.c.requestChainGeneration();await new Promise(setImmediate);assert.equal(e.events.models,0);assert.equal(e.events.posts.length,1);
  const posted=e.events.posts[0];assert.equal(posted.PROJECTS.p.segmentLevels,undefined);assert.ok(Object.keys(posted.REPORTSTATE.p).every(k=>!k.startsWith('chain')&&k!=='pendingChainSaves'));
  assert.match(e.c.chainMapHtml(e.c.P()),/aria-busy="true"/);g.resolve();assert.equal(await work,true);
  assert.equal(e.events.models,1);assert.equal(e.events.posts.length,1);assert.equal(e.events.requests[0].purpose,'chain_map');
  assert.equal(e.c.REPORTSTATE.p.chainStatusByTopic[topic],'partial');assert.deepEqual(clone(e.c.REPORTSTATE.p.chainByTopic[topic]),e.server().REPORTSTATE.p.chainByTopic[topic]);
  assert.ok(e.c.currentEvidenceChain(topic));assert.equal(e.c.REPORTSTATE.p.aiReportByTopic[topic],report);
 });
 test(app+' missing commit event, interrupted stream and SSE error never replace an existing graph',async()=>{
  for(const stream of [{omitResult:true},{finish:null},{finish:'length'},{error:'服务端保存失败'}]){
   const e=setup(app),old=cache(e);e.setStream(stream);assert.equal(await e.c.requestChainGeneration(),false);
   assert.deepEqual(clone(e.c.REPORTSTATE.p.chainByTopic),old);assert.equal(e.c.REPORTSTATE.p.chainStatusByTopic[topic],'ready');assert.ok(e.c.REPORTSTATE.p.chainErrorByTopic[topic]);assert.ok(e.c.currentEvidenceChain(topic));
  }
 });
 test(app+' wrong source, report, scope, topic or missing fingerprint rejects result without a client save',async()=>{
  for(const field of ['sourceIdentity','reportText','scope','contract','topic','requestId','inputFingerprint','saved']){
   const e=setup(app),old=cache(e);e.setTransform(event=>{if(field==='saved')event.saved=false;else event.evidence[field]=field==='inputFingerprint'?'':'wrong';return event;});
   assert.equal(await e.c.requestChainGeneration(),false);assert.deepEqual(clone(e.c.REPORTSTATE.p.chainByTopic),old);assert.equal(e.events.posts.length,1);
  }
 });
 test(app+' all source edits and auth changes reject an in-flight old graph',async()=>{
  const changes=[c=>c.KB_EDITS.p={a:{text:'修订'}},c=>c.KB_CONFIRMS.p={a:'确认'},c=>c.KB_CONFIRM_TOMBS.p={a:1},c=>c.KB_ITEM_TOMBS.p={a:1},c=>c.UPLOADS.p=[{name:'新上传'}],c=>c.UPLOAD_TOMBS['p::old.pdf']=1,c=>c.KB_FILE_CHUNKS.p=[{text:'新正文'}],c=>c.PROJECTS.p.kb.push({known:['新增']}),c=>c.REPORTSTATE.p.aiReportByTopic[topic]+='新报告',c=>c.PROJECTS.p.reportRequestId='r2',c=>c._authEpoch++];
  for(const change of changes){const e=setup(app),g=gate(),old=cache(e);e.setModelGate(g);const work=e.c.requestChainGeneration();await modelStarted(e);change(e.c);g.resolve();assert.equal(await work,false);assert.deepEqual(clone(e.c.REPORTSTATE.p.chainByTopic),old);assert.equal(Object.keys(e.c._chainGenInFlight).length,0);}
 });
 test(app+' switching selected direction preserves the original direction result without cross-display',async()=>{
  const e=setup(app),g=gate();e.setModelGate(g);const work=e.c.requestChainGeneration();await modelStarted(e);
  e.c.PROJECTS.p.topic='其他方向';g.resolve();assert.equal(await work,true);assert.ok(e.c.currentEvidenceChain(topic));assert.equal(e.c.currentEvidenceChain('其他方向'),null);assert.doesNotMatch(e.c.chainMapHtml(e.c.P()),/核级换热器/);
  e.c.PROJECTS.p.topic=topic;assert.match(e.c.chainMapHtml(e.c.P()),/核级换热器/);
 });
 test(app+' failed input sync never calls the model, and retry can succeed',async()=>{
  const e=setup(app);e.setSyncFailure(Error('材料保存失败'));assert.equal(await e.c.requestChainGeneration(),false);assert.equal(e.events.models,0);assert.equal(Object.keys(e.c._chainGenInFlight).length,0);assert.match(e.c.chainMapHtml(e.c.P()),/材料保存失败/);
  e.setSyncFailure(null);assert.equal(await e.c.requestChainGeneration(),true);
 });
 test(app+' source conflicts stay actionable and preserve completed graph content',async()=>{
  const e=setup(app),old=cache(e);e.setModelFailure({status:409,body:{error:'evidence_changed'}});assert.equal(await e.c.requestChainGeneration(),false);assert.deepEqual(clone(e.c.REPORTSTATE.p.chainByTopic),old);assert.match(e.c.chainMapHtml(e.c.P()),/材料已更新/);
 });
 test(app+' local quota failure does not block an in-memory input sync or server-owned result',async()=>{
  const e=setup(app);e.setStorage(false);assert.equal(await e.c.requestChainGeneration(),true);assert.equal(e.events.posts.length,1);assert.ok(e.c.currentEvidenceChain(topic));
 });
 test(app+' result restores after JSON reserialization, while legacy v1 caches never qualify',async()=>{
  const e=setup(app);await e.c.requestChainGeneration();e.c.REPORTSTATE=clone(e.server().REPORTSTATE);const m=e.c.REPORTSTATE.p.chainEvidenceByTopic[topic];m.sourceIdentity=JSON.stringify(JSON.parse(m.sourceIdentity),null,2);assert.ok(e.c.currentEvidenceChain(topic));m.contract='saved-excerpts-v1';m.scope='current-topic-v1';assert.equal(e.c.currentEvidenceChain(topic),null);assert.match(e.c.chainMapHtml(e.c.P()),/版本已变化/);
 });
 test(app+' short reports show a reason and never display a nonfunctional generation action',async()=>{
  const e=setup(app);e.c.REPORTSTATE.p.aiReportByTopic[topic]='短报告';assert.equal(await e.c.requestChainGeneration(),false);assert.equal(e.events.posts.length,0);assert.equal(e.events.models,0);assert.match(e.c.chainMapHtml(e.c.P()),/不足 100 字/);assert.doesNotMatch(e.c.chainMapHtml(e.c.P()),/onclick="requestChainGeneration/);assert.equal(e.events.toasts.length,1);
 });
 test(app+' all generic sync snapshots strip graph writes without mutating local cached results',()=>{
  const e=setup(app);cache(e);e.c.REPORTSTATE.p.pendingChainSaves={a:{chain:[]}};const original=e.snapshot();const safe=e.c._safeSyncSnapshot(original);assert.ok(Object.keys(safe.REPORTSTATE.p).every(k=>!k.startsWith('chain')&&k!=='pendingChainSaves'));assert.ok(original.REPORTSTATE.p.chainByTopic);assert.equal(safe.REPORTSTATE.p.text,report);
 });
 test(app+' identity covers parent material and tombstones but ignores selected direction and graph outputs',()=>{
  const e=setup(app),c=e.c;c.PROJECTS.root={kb:[],onboarding:{}};c.PROJECTS.p.workspaceId='root';const before=c.savedEvidenceIdentity('p',topic);assert.deepEqual(Object.keys(JSON.parse(before).state).sort(),['fileChunks','kbConfirmTombs','kbConfirms','kbEdits','kbItemTombs','uploadTombs','uploads'].sort());c.PROJECTS.p.topic='other';cache(e);assert.equal(c.savedEvidenceIdentity('p',topic),before);c.KB_EDITS.root={x:{text:'父级修订'}};assert.notEqual(c.savedEvidenceIdentity('p',topic),before);
  c.KB_EDITS.root={};c.UPLOADS.root=[{name:'a',dataUrl:'one'}];const uploaded=c.savedEvidenceIdentity('p',topic);c.UPLOADS.root[0].dataUrl='two';assert.equal(c.savedEvidenceIdentity('p',topic),uploaded);c.UPLOAD_TOMBS['other::a']=1;assert.equal(c.savedEvidenceIdentity('p',topic),uploaded);c.UPLOAD_TOMBS['root::a']=2;assert.notEqual(c.savedEvidenceIdentity('p',topic),uploaded);
 });
}

test('actual admin persist filters graph writes while preserving the local cache',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');const e=setup('ops'),c=e.c;cache(e);
 Object.assign(c,{AUTH:{user:'reviewer',scope:'admin'},OPS_ENT:[],CITY_BASE_PACKAGES:{},KB_UNLOCKED:{},PENDING_CONFIRMS:{},DOCK_LOGS:{},DEMANDS:[],REPORT_REQUESTS:[],RESET_GEN:'generation'});
 c.window._opsDataReady=true;c.localStorage.setItem=(key,value)=>e.storage[key]=value;
 vm.runInContext(fn(fs.readFileSync(path.join(__dirname,'../frontend/ops/script-03-sections/14-part-00.js'),'utf8'),'persist'),c);
 c.persist();await new Promise(setImmediate);assert.equal(e.events.posts.length,1);assert.ok(e.c.REPORTSTATE.p.chainByTopic);
 assert.ok(JSON.parse(e.storage.state).REPORTSTATE.p.chainByTopic);assert.ok(Object.keys(e.events.posts[0].REPORTSTATE.p).every(k=>!k.startsWith('chain')));
});
