'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),topic='核电换热设备',body='完整的当前方向正文以及已保存材料。'.repeat(12);
const clone=x=>JSON.parse(JSON.stringify(x));
function fn(source,name){const i=source.search(new RegExp('(?:async )?function '+name+'\\('));assert.ok(i>=0,name);const n=source.slice(i+1).search(/\n(?:async )?function /);return source.slice(i,n<0?undefined:i+1+n);}
function gate(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function setup(app){
 const file=app==='index'?'frontend/index/script-02-sections/12-tail.js':'frontend/ops/script-03-sections/12-tail.js',source=fs.readFileSync(path.join(root,file),'utf8');
 const events={model:0,posts:[],reads:0,renders:0},storage={};let server={},postGate=null,failure=null,readTransform=x=>x,storageWorks=true;
 const c={PROJECTS:{p:{topic,city:'闵行区',reportRequestId:'r1'}},REPORTSTATE:{p:{topic,text:body,aiReportByTopic:{[topic]:body},ts:100}},cur:'p',view:'report',_authEpoch:1,_chainGenInFlight:{},window:{},LS_KEY:'state',KB_API:'/api/kb-chat',source:'source-1',Date,JSON,AbortController,
  P:()=>c.PROJECTS[c.cur],localStorage:{getItem:k=>storage[k]||null},
  persist(){if(storageWorks)storage.state=JSON.stringify({PROJECTS:c.PROJECTS,REPORTSTATE:c.REPORTSTATE});},render(){events.renders++;},setTimeout:()=>1,clearTimeout(){},document:{getElementById:()=>null},reportTextForTopic:t=>c.REPORTSTATE.p.aiReportByTopic[t],escapeChainText:s=>s,
  async fetch(url,init){if(url!=='/api/sync'){events.model++;return {ok:true};}if(init&&init.method==='POST'){const payload=JSON.parse(init.body);events.posts.push(payload);if(postGate)await postGate.promise;if(failure instanceof Error)throw failure;if(failure)return {ok:failure.http!==false,status:failure.status,json:async()=>({ok:false})};server=Object.assign({},clone({PROJECTS:c.PROJECTS,REPORTSTATE:c.REPORTSTATE}),{PROJECTS:clone(c.PROJECTS),REPORTSTATE:clone(c.REPORTSTATE)});Object.assign(server.REPORTSTATE.p,payload.REPORTSTATE.p);return {ok:true,json:async()=>({ok:true})};}events.reads++;return {ok:true,json:async()=>readTransform(clone(server))};},
  readTopicReportStream:async()=>({text:'[]'})};
 vm.createContext(c);
 const shared=fs.readFileSync(path.join(root,'frontend',app,app==='index'?'script-02-sections':'script-03-sections','12-part-00.js'),'utf8');vm.runInContext(fn(shared,'savedEvidenceIdentity'),c);
 for(const n of ['_correctChainLevel','_normalizeChain','currentEvidenceChain','chainSnapshotIdentity','chainSavedSourceMatches','chainSaveCurrent','savePendingChain','syncTopicReportInputs','generateChainFromReport','requestChainGeneration','_renderRichChain','chainMapHtml'])vm.runInContext(fn(source,n),c);
 return {c,events,storage,setGate:g=>postGate=g,setFailure:x=>failure=x,setRead:f=>readTransform=f,setStorage:x=>storageWorks=x,server:()=>server};
}
function pending(c){return c.REPORTSTATE.p.pendingChainSaves[topic];}
function oldCache(c){c.REPORTSTATE.p.chainByTopic={[topic]:[{seg:'中游',nodes:[{name:'旧图'}]}]};c.REPORTSTATE.p.chainEvidenceByTopic={[topic]:{scope:'legacy'}};return clone(c.REPORTSTATE.p.chainByTopic);}
for(const app of ['index','ops']){
 test(app+' waits for save acknowledgement; exact captured snapshot survives restore and five-second stale timer',async()=>{
  const e=setup(app),{c,events,storage}=e,g=gate();e.setGate(g);const work=c.generateChainFromReport(topic);await new Promise(setImmediate);
  assert.equal(events.model,1);assert.equal(events.posts.length,1);assert.equal(c.REPORTSTATE.p.chainStatusByTopic[topic],'saving');assert.equal(c.currentEvidenceChain(topic),null);assert.match(c.chainMapHtml(c.P()),/正在保存/);
  const target=events.posts[0].REPORTSTATE.p;assert.equal(target.chainStatusByTopic[topic],'ready');assert.equal(target.chainEvidenceByTopic[topic].topic,topic);assert.ok(Number.isInteger(target.chainEvidenceByTopic[topic].generatedAt));assert.equal(target.ts,undefined);assert.equal(target.text,undefined);assert.equal(events.posts[0].PROJECTS.p.kb,undefined);
  // Simulate an equal-ts restore and a timer overwriting localStorage while POST waits.
  c.REPORTSTATE.p={topic,text:body,aiReportByTopic:{[topic]:body},ts:100};storage.state='{}';g.resolve();await work;
  assert.equal(c.REPORTSTATE.p.chainStatusByTopic[topic],'ready');assert.equal(c.currentEvidenceChain(topic).length,3);assert.equal(events.model,1);
  c.REPORTSTATE=clone(e.server().REPORTSTATE);assert.equal(c.currentEvidenceChain(topic).length,3);assert.equal(events.reads,1);
 });
 test(app+' retry after HTTP, JSON or network save failure uses saved graph without another model request',async()=>{
  for(const failure of [{http:false},{http:true},new Error('network')]){const e=setup(app),{c,events}=e,old=oldCache(c);e.setFailure(failure);await c.generateChainFromReport(topic);
   assert.equal(events.model,1);assert.equal(c.REPORTSTATE.p.chainStatusByTopic[topic],'save_failed');assert.deepEqual(clone(c.REPORTSTATE.p.chainByTopic),old);assert.match(c.chainMapHtml(c.P()),/重试保存图谱/);assert.ok(pending(c));
   const version=pending(c).evidence.generatedAt;e.setFailure(null);await c.requestChainGeneration();assert.equal(events.model,1);assert.equal(events.posts.length,2);assert.equal(c.REPORTSTATE.p.chainEvidenceByTopic[topic].generatedAt,version);assert.equal(c.currentEvidenceChain(topic).length,3);
  }
 });
 test(app+' a server acknowledgement without the exact saved bundle remains pending',async()=>{
  const e=setup(app),{c}=e;e.setRead(x=>{delete x.REPORTSTATE.p.chainByTopic;return x;});await c.generateChainFromReport(topic);assert.equal(c.REPORTSTATE.p.chainStatusByTopic[topic],'save_failed');assert.equal(c.currentEvidenceChain(topic),null);assert.ok(pending(c));
 });
 test(app+' reordered JSON properties from server do not invalidate an identical graph',async()=>{
  const e=setup(app),{c}=e;e.setRead(x=>{const meta=x.REPORTSTATE.p.chainEvidenceByTopic[topic];x.REPORTSTATE.p.chainEvidenceByTopic[topic]=Object.fromEntries(Object.entries(meta).reverse());return x;});await c.generateChainFromReport(topic);assert.equal(c.REPORTSTATE.p.chainStatusByTopic[topic],'ready');
 });
 test(app+' changed body, topic, source, request or auth during save cannot promote old results',async()=>{
  for(const change of [c=>c.REPORTSTATE.p.aiReportByTopic[topic]+='变更',c=>{c.PROJECTS.p.topic='其他方向';c.PROJECTS.p.kb=[{known:['topic changed']}];},c=>c.PROJECTS.p.kb=[{known:['new-source']}],c=>c.PROJECTS.p.reportRequestId='r2',c=>c._authEpoch++]){
   const e=setup(app),{c}=e,g=gate(),old=oldCache(c);e.setGate(g);const work=c.generateChainFromReport(topic);await new Promise(setImmediate);change(c);g.resolve();await work;assert.deepEqual(clone(c.REPORTSTATE.p.chainByTopic),old);assert.equal(c.currentEvidenceChain(topic),null);
  }
 });
 test(app+' pending result with wrong topic, body, scope or source cannot be saved directly',async()=>{
  const e=setup(app),{c,events}=e;e.setFailure(new Error('offline'));await c.generateChainFromReport(topic);e.setFailure(null);
  const valid=clone(pending(c));for(const field of ['topic','reportText','scope','sourceIdentity','requestId','contract']){c.REPORTSTATE.p.pendingChainSaves[topic]=clone(valid);c.REPORTSTATE.p.pendingChainSaves[topic].evidence[field]='wrong';const count=events.posts.length;assert.equal(await c.savePendingChain('p',topic,1),false);assert.equal(events.posts.length,count);}
 });
 test(app+' local snapshot failure does not claim saved or send an empty sync payload',async()=>{
  const e=setup(app),{c,events}=e;e.setStorage(false);await c.generateChainFromReport(topic);assert.equal(events.posts.length,0);assert.equal(c.REPORTSTATE.p.chainStatusByTopic[topic],'save_failed');e.setStorage(true);await c.requestChainGeneration();assert.equal(events.model,1);assert.equal(c.REPORTSTATE.p.chainStatusByTopic[topic],'ready');
 });
 test(app+' forbidden base write keeps the generated graph and gives a refresh message, not a model error',async()=>{
  const e=setup(app),{c,events}=e;e.setFailure({http:false,status:403});await c.generateChainFromReport(topic);assert.ok(pending(c));assert.equal(events.model,1);assert.match(c.chainMapHtml(c.P()),/报告基础版本已更新，请刷新后重试保存/);assert.doesNotMatch(c.chainMapHtml(c.P()),/图谱生成未完成/);
 });
 test(app+' authoritative source change is never overwritten by a local stale base package',async()=>{
  const e=setup(app),{c,events}=e;e.setRead(x=>{x.PROJECTS.p.kb=[{known:['server latest source']}];return x;});await c.generateChainFromReport(topic);assert.equal(c.currentEvidenceChain(topic),null);assert.match(c.chainMapHtml(c.P()),/材料或报告已更新/);assert.equal(events.posts[0].PROJECTS.p.kb,undefined);assert.deepEqual(Object.keys(events.posts[0].REPORTSTATE.p).sort(),['chainByTopic','chainEvidenceByTopic','chainStatusByTopic']);
 });
 test(app+' no-argument input sync still reads current local storage for full generation',async()=>{
  const e=setup(app),{c,events}=e;c.persist();await c.syncTopicReportInputs();assert.equal(events.posts.length,1);assert.equal(events.posts[0].REPORTSTATE.p.text,body);
 });
}
