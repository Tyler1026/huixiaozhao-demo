'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../frontend/shared/industry-demands.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
function gate(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function boot(legacy=false){
 const topic='氢基能源与长时储能装备补链',text='原产业报告正文必须保持不变';
 const research={topic,reportText:text,analysis:{contract:'topic-report-analysis-v2',priorities:[]},sources:[]};
 const state={topic,phase:2,phaseByTopic:{[topic]:2},text,aiReportByTopic:{[topic]:text},score:19,ts:7,researchByTopic:legacy?{}:{[topic]:research}};
 const events={posts:[],renders:0,persists:0,syncs:0,timers:[]};let transport=null,identity=JSON.stringify({b:2,a:1});
 const c={cur:'p',PROJECTS:{p:{id:'p',topic,city:'闵行区'}},REPORTSTATE:{p:state},_authEpoch:1,window:{},AbortController,
  savedEvidenceIdentity:()=>identity,render:()=>events.renders++,persist:()=>events.persists++,toast(){},
  syncTopicReportInputs:async()=>{events.syncs++;},setTimeout(fn,ms){events.timers.push(ms);return 1;},clearTimeout(){},
  fetch:async(url,init)=>{const request={url,init,body:JSON.parse(init.body)};events.posts.push(request);return transport?transport(request):{ok:true,json:async()=>result(request)};}};
 function result(request){return {ok:true,projectKey:'p',topic,sourceIdentity:JSON.stringify({a:1,b:2}),updated:true,
  reportResearch:{topic,reportText:text,analysis:{contract:'topic-report-analysis-v2',priorities:[{focus:'电解槽装备',state:'reviewed_inference'}]},sources:[{id:'S1',url:'https://official.example/source',quote:'原文'}]}};}
 vm.createContext(c);vm.runInContext(code,c);return {c,state,events,topic,text,research,result,setTransport:value=>transport=value,setIdentity:value=>identity=value};
}
test('explicit refresh updates only research metadata with the exact saved report identity',async()=>{
 const e=boot(),before=clone(e.state);assert.equal(await e.c.refreshReportPriorities(),true);
 const {url,init,body}=e.events.posts[0];assert.equal(url,'/api/kb-chat');assert.equal(init.credentials,'same-origin');
 assert.equal(body.purpose,'report_priorities');assert.equal(body.mode,'research');assert.equal(body.question,e.topic);assert.equal(body.stream,false);
 assert.equal(body.reportMetadataIdentity,JSON.stringify(e.research));assert.equal(body.projectKey,'p');
 assert.equal(e.state.text,before.text);assert.deepEqual(clone(e.state.aiReportByTopic),before.aiReportByTopic);assert.deepEqual(clone(e.state.phaseByTopic),before.phaseByTopic);
 assert.equal(e.state.ts,before.ts);assert.equal(e.state.score,before.score);assert.equal(e.events.persists,1);
 assert.equal(e.state.researchByTopic[e.topic].analysis.priorities.length,1);assert.equal(e.c.reportPriorityUpdateState('p',e.topic).pending,false);
 assert.ok(e.events.timers.includes(360000));
});
test('legacy phase-two reports with no research send null and can receive a source-bound entry',async()=>{
 const e=boot(true);assert.equal(await e.c.refreshReportPriorities(),true);assert.equal(e.events.posts[0].body.reportMetadataIdentity,'null');
 assert.equal(e.state.researchByTopic[e.topic].reportText,e.text);assert.equal(e.state.phase,2);
});
test('pending refresh disables duplicate work and does not mutate report before acknowledgement',async()=>{
 const e=boot(),g=gate(),before=JSON.stringify(e.state);e.setTransport(async request=>{await g.promise;return {ok:true,json:async()=>e.result(request)};});
 const pending=e.c.refreshReportPriorities();await Promise.resolve();await Promise.resolve();
 assert.equal(e.c.reportPriorityUpdateState('p',e.topic).pending,true);assert.equal(await e.c.refreshReportPriorities(),false);assert.equal(e.events.posts.length,1);assert.equal(JSON.stringify(e.state),before);
 g.resolve();assert.equal(await pending,true);
});
for(const legacy of [false,true])test('no new directions preserves '+(legacy?'absent':'existing')+' metadata and offers manual continuation',async()=>{
 const e=boot(legacy),before=JSON.stringify(e.state);e.setTransport(()=>({ok:true,json:async()=>({ok:true,projectKey:'p',topic:e.topic,sourceIdentity:JSON.stringify({a:1,b:2}),updated:false,reportResearch:legacy?null:clone(e.research)})}));
 assert.equal(await e.c.refreshReportPriorities(),false);assert.equal(JSON.stringify(e.state),before);assert.equal(e.events.persists,0);
 assert.match(e.c.reportPriorityUpdateState('p',e.topic).message,/自行填写招商需求/);
});
for(const change of ['epoch','topic','workspace','phase','text','material','metadata'])test('changed '+change+' rejects an in-flight refresh without replacing local metadata',async()=>{
 const e=boot(),g=gate();e.setTransport(async request=>{await g.promise;return {ok:true,json:async()=>e.result(request)};});
 const pending=e.c.refreshReportPriorities();await Promise.resolve();await Promise.resolve();
 if(change==='epoch')e.c._authEpoch++;
 if(change==='topic')e.c.PROJECTS.p.topic='另一个方向';
 if(change==='workspace'){e.c.PROJECTS.other={topic:e.topic};e.c.cur='other';}
 if(change==='phase')e.state.phaseByTopic[e.topic]=1;
 if(change==='text')e.state.aiReportByTopic[e.topic]='新正文';
 if(change==='material')e.setIdentity(JSON.stringify({a:1,b:3}));
 if(change==='metadata')e.state.researchByTopic[e.topic].sources.push({id:'new'});
 const before=JSON.stringify(e.state);g.resolve();assert.equal(await pending,false);assert.equal(JSON.stringify(e.state),before);assert.equal(e.events.persists,0);
});
for(const field of ['projectKey','topic','sourceIdentity','reportText','updated'])test('mismatched '+field+' response cannot be adopted',async()=>{
 const e=boot(),before=JSON.stringify(e.state);e.setTransport(request=>{const value=e.result(request);if(field==='reportText')value.reportResearch.reportText='other';else value[field]=field==='updated'?'true':'other';return {ok:true,json:async()=>value};});
 assert.equal(await e.c.refreshReportPriorities(),false);assert.equal(JSON.stringify(e.state),before);assert.equal(e.events.persists,0);assert.equal(e.c.reportPriorityUpdateState('p',e.topic).error,true);
});
test('server error exposes retryable state without marking new directions saved',async()=>{
 const e=boot(),before=JSON.stringify(e.state);e.setTransport(()=>({ok:false,json:async()=>({message:'本轮来源检索未完成'})}));
 assert.equal(await e.c.refreshReportPriorities(),false);assert.equal(JSON.stringify(e.state),before);assert.match(e.c.reportPriorityUpdateState('p',e.topic).message,/本轮来源检索未完成/);
});
test('draft phase and changed research provenance never launch paid research',async()=>{
 for(const change of ['draft','provenance']){const e=boot();if(change==='draft')e.state.phaseByTopic[e.topic]=1;else e.state.researchByTopic[e.topic].reportText='旧正文';
  assert.equal(await e.c.refreshReportPriorities(),false);assert.equal(e.events.posts.length,0);}
});
