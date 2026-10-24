'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

async function boot(){
  const root=path.join(__dirname,'..');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'frontend/manifest.json'),'utf8'));
  const html=manifest['ops.html'].parts.map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('');
  const nodes={},storage=new Map(),calls=[],toasts=[];
  const element=()=>({style:{},classList:{add(){},remove(){},contains(){return false;}},appendChild(){},setAttribute(){},remove(){},click(){}});
  const document={activeElement:null,getElementById:id=>nodes[id]||null,
    querySelector:selector=>selector[0]==='#'?nodes[selector.slice(1)]||null:null,
    querySelectorAll:()=>[],addEventListener(){},documentElement:{style:{}},head:element(),body:element(),createElement:element};
  const ctx={console:{log(){},warn(){}},Date,Math,Promise,JSON,AbortController,TextEncoder,TextDecoder,URL,Uint8Array,Blob,
    location:{origin:'http://localhost',search:'',href:'http://localhost/ops'},navigator:{},performance:{now:()=>Date.now()},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    document,setInterval(){},setTimeout(){},clearTimeout(){},addEventListener(){},
    fetch:async()=>({status:401,ok:false,json:async()=>({ok:false})})};
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(!/\bsrc=/.test(match[1]))vm.runInContext(match[2],ctx,{filename:'ops.html'});
  }
  for(let i=0;i<40;i++)await Promise.resolve();
  ctx.AUTH={user:'admin',scope:'admin',projectKeys:[],projKey:null};ctx._authState='ready';ctx._opsDataReady=true;
  ctx.PROJECTS={workspace:{id:'workspace',city:'测试城市'}};ctx.REPORTSTATE={};ctx.PENDING_CONFIRMS={};ctx.OPS_ENT=[];ctx._opsServerHadData=true;
  ctx.DELETED_OPS_ENT=[];ctx.confirm=()=>true;ctx.renderOpsV2=()=>{};ctx.toast=value=>toasts.push(value);
  let responder=async()=>({ok:true});
  ctx.fetch=async(url,options)=>{const request={url,body:JSON.parse(options.body)};calls.push(request);const data=await responder(request);return {ok:true,status:200,json:async()=>data};};
  ctx.FileReader=class{
    readAsText(file){queueMicrotask(()=>file.error?this.onerror():this.onload({target:{result:file.text}}));}
  };
  return {ctx,calls,toasts,responder:fn=>{responder=fn;}};
}
const file=(name,text)=>({name,text});

test('last enterprise deletion submits an explicit identity and waits for the server receipt',async()=>{
  const h=await boot();h.ctx.OPS_ENT=[{id:'last-enterprise',name:'最后一家'}];
  let finish;h.responder(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=h.ctx.opsEntDelete(0);
  assert.equal(h.ctx.OPS_ENT.length,0);
  assert.deepEqual(h.calls[0].body.DELETED_OPS_ENT,['last-enterprise']);
  assert.equal(Object.hasOwn(h.calls[0].body,'OPS_ENT'),false,'empty-list protection stays intact');
  assert.equal(h.toasts.includes('已删除并保存'),false);
  finish({ok:true});await pending;
  assert.equal(h.toasts.at(-1),'已删除并保存');
});

test('cancel leaves the enterprise and server untouched',async()=>{
  const h=await boot();h.ctx.OPS_ENT=[{id:'keep',name:'保留'}];h.ctx.confirm=()=>false;
  await h.ctx.opsEntDelete(0);
  assert.equal(h.ctx.OPS_ENT.length,1);assert.equal(h.calls.length,0);
});

test('legacy enterprise without an ID saves its identity before deletion',async()=>{
  const h=await boot();h.ctx.OPS_ENT=[{name:'旧企业'}];
  await h.ctx.opsEntDelete(0);
  assert.equal(h.calls.length,2);
  const id=h.calls[0].body.OPS_ENT[0].id;
  assert.ok(id);assert.deepEqual(h.calls[1].body.DELETED_OPS_ENT,[String(id)]);
});

test('failed deletion is visibly unsaved and its exact intent can be retried',async()=>{
  const h=await boot();h.ctx.OPS_ENT=[{id:'delete-retry',name:'重试'}];h.responder(async()=>{throw Error('offline');});
  await h.ctx.opsEntDelete(0);
  assert.match(h.toasts.at(-1),/删除尚未保存/);assert.equal(h.toasts.includes('已删除并保存'),false);
  assert.ok(h.ctx.WORKSPACE_SYNC.pending);
  h.responder(async()=>({ok:true}));assert.equal(await h.ctx.workspaceSyncSend(),true);
  assert.deepEqual(h.calls[1].body.DELETED_OPS_ENT,['delete-retry']);assert.equal(h.ctx.WORKSPACE_SYNC.pending,null);
});

test('a failed legacy identity save must be confirmed on the next delete attempt',async()=>{
  const h=await boot();h.ctx.OPS_ENT=[{name:'旧企业重试'}];
  h.responder(async()=>{throw Error('offline');});
  await h.ctx.opsEntDelete(0);
  assert.equal(h.ctx.OPS_ENT.length,1);
  assert.match(h.toasts.at(-1),/企业编号尚未保存/);
  const id=h.ctx.OPS_ENT[0].id;
  h.responder(async()=>({ok:true}));await h.ctx.opsEntDelete(0);
  assert.equal(h.calls.length,3);
  assert.equal(h.calls[1].body.OPS_ENT[0].id,id,'retry establishes the same ID on the server first');
  assert.deepEqual(h.calls[2].body.DELETED_OPS_ENT,[id]);
  assert.equal(h.ctx.OPS_ENT.length,0);
});

test('CSV and profile files save in one completed batch with unique enterprise IDs',async()=>{
  const h=await boot();
  await h.ctx.opsEntImportFiles([
    file('first.csv','企业名称,行业\n企业甲,软件\n企业乙,设备'),
    file('second.csv','企业名称,行业\n企业丙,服务'),
    file('profile.txt','企业名称：企业丁\n行业：材料'),
    file('convert.xlsx','binary')
  ]);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'/api/sync');
  assert.equal(h.calls[0].body.OPS_ENT.length,4);
  assert.equal(new Set(h.calls[0].body.OPS_ENT.map(e=>e.id)).size,4);
  assert.match(h.toasts.at(-1),/已导入并保存 4 家企业/);assert.match(h.toasts.at(-1),/另存为 CSV/);
});

test('duplicate, empty, unreadable and unsupported inputs do not produce false success',async()=>{
  const h=await boot();h.ctx.OPS_ENT=[{id:'existing',name:'已有企业'}];
  await h.ctx.opsEntImportFiles([file('duplicate.csv','企业名称\n已有企业'),file('empty.txt',''),file('invalid.exe','企业名称：错误'),{name:'broken.csv',error:true}]);
  assert.equal(h.ctx.OPS_ENT.length,1);assert.equal(h.calls.length,0);
  assert.match(h.toasts.at(-1),/格式不支持/);assert.match(h.toasts.at(-1),/读取失败/);
});

test('CSV success is shown only after persistence; failed save retains a retryable snapshot',async()=>{
  const h=await boot();let finish;h.responder(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=h.ctx.opsEntImportFiles([file('save.csv','企业名称\n待保存企业')]);
  for(let i=0;i<10&&!finish;i++)await Promise.resolve();
  assert.equal(h.calls.length,1);assert.equal(h.toasts.some(v=>v.includes('已导入并保存')),false);
  finish({ok:false});await pending;
  assert.match(h.toasts.at(-1),/尚未保存/);assert.ok(h.ctx.WORKSPACE_SYNC.pending);
  h.responder(async()=>({ok:true}));assert.equal(await h.ctx.workspaceSyncSend(),true);
  assert.equal(h.calls[1].body.OPS_ENT[0].name,'待保存企业');
});

test('refresh polling cannot replace rows while a file batch or deletion is pending',async()=>{
  const h=await boot();let completeRead,refreshes=0;
  h.ctx.restoreFromServer=()=>{refreshes++;};
  h.ctx.FileReader=class{readAsText(file){completeRead=()=>this.onload({target:{result:file.text}});}};
  const importing=h.ctx.opsEntImportFiles([file('pending.csv','企业名称\n慢速读取企业')]);
  h.ctx.opsRefreshData();assert.equal(refreshes,0);
  completeRead();await importing;
  h.ctx.opsRefreshData();assert.equal(refreshes,1);
  let completeSave;h.responder(()=>new Promise(resolve=>{completeSave=resolve;}));
  const deleting=h.ctx.opsEntDelete(0);
  h.ctx.opsRefreshData();assert.equal(refreshes,1);
  completeSave({ok:true});await deleting;
  h.ctx.opsRefreshData();assert.equal(refreshes,2);
});

test('a server read started before an import cannot overwrite the new batch on late arrival',async()=>{
  const h=await boot();let returnRead;
  const post=h.ctx.fetch;
  h.ctx.fetch=(url,options)=>options.method==='POST'?post(url,options):new Promise(resolve=>{returnRead=resolve;});
  const read=h.ctx.restoreFromServer();
  await h.ctx.opsEntImportFiles([file('new.csv','企业名称\n新导入企业')]);
  returnRead({ok:true,status:200,json:async()=>({PROJECTS:h.ctx.PROJECTS,OPS_ENT:[]})});
  await read;
  assert.equal(h.ctx.OPS_ENT.length,1);assert.equal(h.ctx.OPS_ENT[0].name,'新导入企业');
});
