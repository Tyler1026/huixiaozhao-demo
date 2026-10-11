'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function source(app){return fs.readFileSync(path.join(__dirname,'../frontend',app,app==='ops'?'script-03-sections':'script-02-sections','14-tail.js'),'utf8');}
function fn(text,name){const at=text.indexOf('function '+name+'(');assert.ok(at>=0);return text.slice(at).match(/^function [\s\S]*?^}/m)[0];}
function boot(){
  const disk=new Map(),listeners={},calls=[];
  const ctx={console:{log(){},warn(){}},Date,Math,JSON,Promise,
    AUTH:{scope:'admin',user:'offline-admin',projectKeys:[]},_authState:'ready',_authEpoch:1,
    RESET_GEN:'new',cur:null,view:'knowledge',LS_KEY:'huixiaozhao_kb_v1',_lastUserScrollMs:0,
    localStorage:{getItem:k=>disk.get(k)||null,setItem:(k,v)=>disk.set(k,v),removeItem:k=>disk.delete(k)},
    addEventListener:(name,cb)=>{listeners[name]=cb;},_safeSyncSnapshot:x=>x,_authFilterProjects:x=>x,
    _safeProfiles:x=>x||{},_authReadSync:r=>r.json(),
    _mergeKbItemTombs(){},_applyKbItemTombs(){},_mergeTombs(){},_mergeConfirms:x=>x,
    _mergeChunks:(a,b)=>a||b||{},_mergeUploads:(a,b)=>a||b||{},_mergeKbChatTombs(){},_mergeUploadTombs(){},
    _mergeKbChat:(a,b)=>a||b||{},_applyUploadTombs(){},_slimUploads:()=>({}),migrateKbChatToCity(){},
    render(){calls.push('render');},setTimeout(){},syncDemandStage(){}};
  for(const key of ['PROJECTS','UPLOADS','KB_CONFIRMS','KB_CONFIRM_TOMBS','KB_ITEM_TOMBS','KB_FILE_CHUNKS','KB_UNLOCKED','REPORTSTATE','REPORT_HISTORY','PENDING_CONFIRMS','DOCK_LOGS','KB_CHAT','KB_CHAT_TOMBS','UPLOAD_TOMBS','CITY_BASE_PACKAGES','CITY_WORKSPACES','SUBPROJ'])ctx[key]={};
  for(const key of ['OPS_ENT','DEMANDS','REPORT_REQUESTS','DELETED_PROJECTS','DELETED_CLUES'])ctx[key]=[];
  ctx.window=ctx;vm.createContext(ctx);return {ctx,listeners,calls,disk};
}
function storageBoot(){const h=boot(),text=source('index');vm.runInContext(text.slice(text.indexOf("window.addEventListener('storage'"),text.indexOf('\nvar UPLOADS={}')),h.ctx);return h;}
function event(generation='old',user='offline-admin'){const data={clientUser:user,PROJECTS:{old:{city:'OFFLINE old data',kb:[]}},REPORTSTATE:{old:{text:'OFFLINE old report'}}};if(generation!==undefined)data.RESET_GEN=generation;return {key:'huixiaozhao_kb_v1',newValue:JSON.stringify(data)};}
function snapshot(generation,old=false){return {RESET_GEN:generation,PROJECTS:old?{old:{city:'OFFLINE old data',kb:[]}}:{},OPS_ENT:[],REPORT_REQUESTS:[],DEMANDS:[]};}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('old or generation-less storage snapshots never mutate current business state',async()=>{
  for(const generation of ['old',undefined]){
    const h=storageBoot();h.ctx.PROJECTS={fresh:{city:'OFFLINE fresh'}};h.ctx.REPORTSTATE={fresh:{text:'fresh'}};
    let resolve,calls=0;h.ctx.restoreFromServer=()=>{calls++;return new Promise(r=>{resolve=r;});};
    const bad=event(generation);if(generation===undefined){const payload=JSON.parse(bad.newValue);delete payload.RESET_GEN;bad.newValue=JSON.stringify(payload);}
    h.listeners.storage(bad);h.listeners.storage(bad);
    assert.deepEqual(Object.keys(h.ctx.PROJECTS),['fresh']);assert.deepEqual(Object.keys(h.ctx.REPORTSTATE),['fresh']);
    assert.equal(h.ctx.RESET_GEN,'new');assert.equal(calls,1);assert.equal(h.ctx._resetGenerationSyncPending,true);
    resolve();await flush();assert.equal(h.ctx._resetGenerationSyncPending,false);
    h.listeners.storage(bad);assert.equal(calls,2);
  }
});

test('same generation still performs ordinary storage synchronization',()=>{
  const h=storageBoot();h.ctx.restoreFromServer=()=>{throw Error('same generation must not refresh');};
  h.listeners.storage(event('new'));
  assert.deepEqual(Object.keys(h.ctx.PROJECTS),['old']);assert.equal(h.ctx.REPORTSTATE.old.text,'OFFLINE old report');
  assert.equal(h.ctx.RESET_GEN,'new');assert.equal(h.calls.filter(x=>x==='render').length,1);
});

test('other user storage event neither loads data nor starts a refresh',()=>{
  const h=storageBoot();let calls=0;h.ctx.restoreFromServer=()=>{calls++;};
  h.listeners.storage(event('old','another-user'));
  assert.deepEqual(Object.keys(h.ctx.PROJECTS),[]);assert.equal(calls,0);
});

test('failed generation refresh remains retryable without adopting the snapshot',async()=>{
  const h=storageBoot();h.ctx.restoreFromServer=()=>Promise.reject(new Error('offline failure'));
  h.listeners.storage(event());await flush();assert.equal(h.ctx._resetGenerationSyncPending,false);
  assert.deepEqual(Object.keys(h.ctx.PROJECTS),[]);assert.equal(h.ctx.RESET_GEN,'new');
  h.ctx.restoreFromServer=()=>{throw new Error('sync throw');};h.listeners.storage(event());
  assert.equal(h.ctx._resetGenerationSyncPending,false);assert.deepEqual(Object.keys(h.ctx.PROJECTS),[]);
});

for(const app of ['ops','index']){
  test(app+' late earlier GET cannot roll back accepted generation or ready state',async()=>{
    const h=boot(),pending=[];h.ctx.RESET_GEN='old';h.ctx.fetch=()=>new Promise(resolve=>pending.push(resolve));
    vm.runInContext(fn(source(app),'_acceptServerGeneration')+'\n'+fn(source(app),'restoreFromServer'),h.ctx);
    const callbacks=[];
    const first=h.ctx.restoreFromServer(ok=>callbacks.push(['first',ok]));
    const second=h.ctx.restoreFromServer(ok=>callbacks.push(['second',ok]));
    pending[1]({json:async()=>snapshot('new')});await second;
    pending[0]({json:async()=>snapshot('old',true)});await first;
    assert.equal(h.ctx.RESET_GEN,'new');assert.deepEqual(Object.keys(h.ctx.PROJECTS),[]);
    assert.deepEqual(callbacks,[['second',true]]);
    if(app==='ops')assert.equal(h.ctx._opsDataReady,true);else assert.equal(h.ctx._serverSyncLock,false);
  });
  test(app+' stale failure cannot release the latest GET lock or change readiness',async()=>{
    const h=boot(),pending=[];h.ctx.fetch=()=>new Promise((resolve,reject)=>pending.push({resolve,reject}));
    h.ctx._opsDataReady=true;
    vm.runInContext(fn(source(app),'_acceptServerGeneration')+'\n'+fn(source(app),'restoreFromServer'),h.ctx);
    let staleCallback=false;
    const first=h.ctx.restoreFromServer(()=>{staleCallback=true;}),second=h.ctx.restoreFromServer(()=>{});
    pending[0].reject(new Error('offline old failure'));await first;
    assert.equal(staleCallback,false);
    if(app==='ops')assert.equal(h.ctx._opsDataReady,true);else assert.equal(h.ctx._serverSyncLock,true);
    pending[1].resolve({json:async()=>snapshot('new')});await second;
    assert.equal(h.ctx.RESET_GEN,'new');
  });
  test(app+' delayed JSON from earlier GET is discarded after a newer request starts',async()=>{
    const h=boot(),pending=[];let resolveJson;
    h.ctx.fetch=()=>new Promise(resolve=>pending.push(resolve));
    vm.runInContext(fn(source(app),'_acceptServerGeneration')+'\n'+fn(source(app),'restoreFromServer'),h.ctx);
    const first=h.ctx.restoreFromServer(()=>{});
    pending[0]({json:()=>new Promise(resolve=>{resolveJson=resolve;})});await flush();
    const second=h.ctx.restoreFromServer(()=>{});pending[1]({json:async()=>snapshot('new')});await second;
    resolveJson(snapshot('old',true));await first;
    assert.equal(h.ctx.RESET_GEN,'new');assert.deepEqual(Object.keys(h.ctx.PROJECTS),[]);
  });
  test(app+' changed generation clears derived project cache in memory and storage',()=>{
    const h=boot();h.ctx.SUBPROJ={old:[{name:'OFFLINE obsolete'}]};h.disk.set('hxz_subproj','obsolete');
    vm.runInContext(fn(source(app),'_acceptServerGeneration'),h.ctx);
    assert.equal(h.ctx._acceptServerGeneration({RESET_GEN:'new'}),false);
    assert.ok(h.ctx.SUBPROJ.old);assert.equal(h.ctx._acceptServerGeneration({RESET_GEN:'next'}),true);
    assert.deepEqual(Object.keys(h.ctx.SUBPROJ),[]);assert.equal(h.disk.has('hxz_subproj'),false);
  });
}
