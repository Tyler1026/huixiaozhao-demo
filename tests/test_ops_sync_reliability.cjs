'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root=require('node:path').join(__dirname,'..');
const source=file=>fs.readFileSync(root+'/'+file,'utf8');
function fn(text,name){return text.slice(text.indexOf('function '+name+'(')).match(/^function [\s\S]*?^}/m)[0];}
const tail=source('frontend/ops/script-03-sections/14-tail.js'),ui=source('frontend/ops/script-03-sections/17.js');
function boot(){
 const requests=[],timers=new Map(),notices=[];let id=0,now=100000;
 const c={AUTH:{scope:'admin',user:'admin'},_authEpoch:1,_serverRestoreSeq:0,console:{warn(){}},Promise,AbortController,
 Date:{now:()=>now},Math,JSON,cur:'p',RESET_GEN:'same',LS_KEY:'state',document:{hidden:false},
 _opsDataReady:true,PROJECTS:{p:{city:'随州市',draft:'keep me'}},OPS_ENT:[],REPORTSTATE:{},REPORT_HISTORY:{},
 localStorage:{setItem(){},removeItem(){}},_safeSyncSnapshot:x=>x,_safeProfiles:x=>x||{},
 _acceptServerGeneration:()=>false,_mergeKbItemTombs(){},_applyKbItemTombs(){},_mergeTombs(){},_mergeConfirms:x=>x,
 mergeTopicProjectLifecycle:(a,b)=>b,mergeTopicReportStates:(a,b)=>b||{},mergeTopicReportHistory:(a,b)=>b||{},applyTopicStateIntegrity(){},
 _authReadSync(r){if(r.status===401){c.AUTH=null;c._authEpoch++;c._opsDataReady=false;throw Error('expired');}if(r.ok===false)throw Error('server');return r.json();},
 fetch(url,options){return new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));},
 setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(n){timers.delete(n);},
 opsEntImportFiles(){},opsEntDelete(){},render(){c.rendered++;},renderOpsV2(){c.renders++;},rendered:0,renders:0,
 opsLoadNotice:s=>notices.push(s)};
 c.window=c;vm.createContext(c);vm.runInContext(fn(tail,'restoreFromServer')+'\n'+fn(ui,'opsRefreshData'),c);
 return {c,requests,timers,notices,setTime:n=>now=n,reply(i=0,s={PROJECTS:{p:{city:'随州市'}},RESET_GEN:'same'}){requests[i].resolve({ok:true,status:200,json:async()=>s});}};
}
const flush=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
test('slow poll stays single-flight across intervals and preserves both callbacks',async()=>{
 const h=boot(),calls=[];const a=h.c.restoreFromServer(ok=>calls.push(ok));
 for(let n=0;n<20;n++)h.c.opsRefreshData();const b=h.c.restoreFromServer(ok=>calls.push(ok));
 assert.equal(h.requests.length,1);assert.equal(h.c._serverRestoreSeq,1);
 h.reply();await Promise.all([a,b]);assert.deepEqual(calls,[true,true]);assert.equal(h.c._opsDataReady,true);assert.equal(h.timers.size,0);
});
test('deadline cancels the transfer including a pending body and retains last loaded data',async()=>{
 const h=boot(),old=h.c.PROJECTS;let body;
 const pending=h.c.restoreFromServer();h.requests[0].resolve({ok:true,json:()=>new Promise(r=>body=r)});await flush();
 [...h.timers.values()][0].fn();assert.equal(await pending,false);assert.equal(h.requests[0].options.signal.aborted,true);
 assert.equal(h.c.PROJECTS,old);assert.equal(h.c._opsDataReady,true);assert.equal(h.timers.size,0);
 body({PROJECTS:{wrong:{}},RESET_GEN:'same'});await flush();assert.equal(h.c.PROJECTS,old);
});
test('background failure retains the page, backs off, and successful retry clears warning',async()=>{
 const h=boot(),old=h.c.PROJECTS;const first=h.c.opsRefreshData();h.requests[0].reject(Error('offline'));await first;
 assert.equal(h.c.PROJECTS,old);assert.equal(h.c.rendered,0);assert.match(h.notices.at(-1),/上次成功加载/);
 h.c.opsRefreshData();assert.equal(h.requests.length,1);h.setTime(130000);const next=h.c.opsRefreshData();h.reply(1);await next;
 assert.equal(h.c.renders,1);assert.equal(h.notices.at(-1),'');assert.equal(h.c.restoreFromServer._retryAt,0);
});
test('forced read after a write cancels old transfer and prevents old state rollback',async()=>{
 const h=boot();const a=h.c.restoreFromServer();const b=h.c.restoreFromServer(undefined,{force:true});
 assert.equal(h.requests.length,2);assert.equal(h.requests[0].options.signal.aborted,true);
 h.reply(1,{PROJECTS:{new:{}},RESET_GEN:'same'});await b;h.reply(0,{PROJECTS:{old:{}},RESET_GEN:'same'});await a;
 assert.deepEqual(Object.keys(h.c.PROJECTS),['new']);
});
test('late unauthorized response from old session cannot sign out new session',async()=>{
 const h=boot();const old=h.c.restoreFromServer();h.c._authEpoch++;h.c.AUTH={scope:'admin',user:'new'};
 const next=h.c.restoreFromServer();h.requests[0].resolve({status:401,ok:false,json:async()=>({})});await old;
 assert.equal(h.c.AUTH.user,'new');h.reply(1);await next;assert.equal(h.c.AUTH.user,'new');
});
test('render callback failure is not misreported as data load failure',async()=>{
 const h=boot();const p=h.c.restoreFromServer(()=>{throw Error('render bug');});h.reply();assert.equal(await p,true);
 assert.equal(h.c._opsDataReady,true);assert.equal(h.c.restoreFromServer._lastError,'');
});
test('initial failure reports retryable state and automatically retries after backoff',async()=>{
 const h=boot();h.c._opsDataReady=false;h.c.render._opsLoadError='unavailable';
 const p=h.c.opsRefreshData();h.requests[0].reject(Error('offline'));await p;assert.equal(h.c.rendered,1);
 h.setTime(130000);const next=h.c.opsRefreshData();h.reply(1);await next;assert.equal(h.c._opsDataReady,true);assert.equal(h.c.render._opsLoadError,'');
});
