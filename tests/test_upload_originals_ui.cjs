'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const tail=read('frontend/index/script-02-sections/14-tail.js');
const core=tail.slice(tail.indexOf('function uploadOriginalUrl('),tail.indexOf('/* 文本切 chunk'));
const receipt={ok:true,upload:{name:'材料.txt',originalId:'a'.repeat(32),size:4,chunks:1,originalSha256:'c'.repeat(64)},original:{id:'a'.repeat(32)},fileChunks:[{id:'upload:aaa:0',text:'测试文字',originalId:'a'.repeat(32)}]};
function boot(){
  const calls=[],messages=[],finalized=[];
  class Reader{readAsDataURL(file){this.result='data:text/plain;base64,dGVzdA==';queueMicrotask(()=>this.onload());}}
  const c={Uint8Array,Array,Promise,JSON,String,encodeURIComponent,crypto:require('node:crypto').webcrypto,FileReader:Reader,
    cur:'p',PROJECTS:{p:{kb:[]},q:{kb:[]}},UPLOADS:{},KB_FILE_CHUNKS:{},UPLOAD_TOMBS:{},
    toast:m=>messages.push(m),finalizeIngest:(...a)=>finalized.push(a),
    fetch:async(url,opt)=>{calls.push({url,body:JSON.parse(opt.body)});return {json:async()=>receipt};}};
  vm.createContext(c);vm.runInContext(core,c);return {c,calls,messages,finalized};
}

test('file submission sends bytes and captured project, receives a durable ID without caching base64',async()=>{
  const h=boot();await h.c.ingestFiles([{name:'材料.txt',size:4}],null);
  assert.equal(h.calls[0].url,'/api/upload-file');assert.equal(h.calls[0].body.projectKey,'p');
  assert.match(h.calls[0].body.uploadId,/^[a-f0-9]{32}$/);assert.equal(h.calls[0].body.fileB64,'dGVzdA==');
  assert.equal(h.c.UPLOADS.p[0].originalId,'a'.repeat(32));assert.doesNotMatch(JSON.stringify(h.c.UPLOADS),/data:|fileB64|dataUrl/);
  assert.equal(h.finalized[0][1].length,1);
});
test('storage failure cannot create parsed chunks or report a saved original',async()=>{
  const h=boot();h.c.fetch=async()=>({json:async()=>({ok:false,message:'storage offline'})});
  const saved=await h.c.ingestFiles([{name:'材料.txt',size:4}],null);
  assert.equal(saved.length,0);assert.deepEqual(h.c.UPLOADS,{});assert.deepEqual(h.c.KB_FILE_CHUNKS,{});
  assert.equal(h.finalized[0][1].length,0);assert.equal(h.finalized[0][4][0].reason,'storage offline');
});
test('switching workspace while upload finishes never installs receipt into the other workspace',async()=>{
  const h=boot();let release;h.c.fetch=()=>new Promise(r=>{release=r;});
  const pending=h.c.ingestFiles([{name:'材料.txt',size:4}],null);
  for(let i=0;i<5;i++)await Promise.resolve();h.c.cur='q';release({json:async()=>receipt});await pending;
  assert.equal(h.c.UPLOADS.p.length,1);assert.equal(h.c.UPLOADS.q,undefined);assert.equal(h.finalized.length,0);
});
test('receipt application deduplicates IDs after server refresh',()=>{
  const h=boot();h.c.applyOriginalReceipt('p',receipt);h.c.applyOriginalReceipt('p',receipt);
  assert.equal(h.c.UPLOADS.p.length,1);assert.equal(h.c.KB_FILE_CHUNKS.p.length,1);
});
test('oversized and empty files do not issue requests',async()=>{
  const h=boot();await assert.rejects(h.c.submitOriginalFile({name:'large.txt',size:20*1024*1024+1},'p',null));
  await assert.rejects(h.c.submitOriginalFile({name:'empty.txt',size:0},'p',null));assert.equal(h.calls.length,0);
});
test('admin download targets exact original among duplicate filenames',()=>{
  const h=boot(),clicked=[];h.c.UPLOADS.p=[{name:'材料.txt',originalId:'a'.repeat(32)},{name:'材料.txt',originalId:'b'.repeat(32)}];
  h.c.document={createElement:()=>({click(){clicked.push(this.href);},remove(){}}),body:{appendChild(){}}};h.c.setTimeout=()=>{};
  const source=read('frontend/ops/script-03-sections/17.js');vm.runInContext(source.slice(source.indexOf('function opsDownloadFile('),source.indexOf('/* 查看城市研判报告 */')),h.c);
  h.c.opsDownloadFile('p','材料.txt','a'.repeat(32));assert.equal(clicked[0],'/api/upload-file?projectKey=p&uploadId='+'a'.repeat(32));
  h.c.opsDownloadFile('p','材料.txt','f'.repeat(32));assert.equal(clicked.length,1);assert.match(h.messages.at(-1),/未保存原件/);
});

test('late upload response after account switch cannot restore old plaintext or persist',async()=>{
  const h=boot();h.c._authEpoch=4;let release;
  h.c.fetch=()=>new Promise(r=>{release=r;});
  const pending=h.c.ingestFiles([{name:'材料.txt',size:4}],null);
  for(let i=0;i<5;i++)await Promise.resolve();
  h.c._authEpoch=5;h.c.cur='new-account';h.c.PROJECTS={};h.c.UPLOADS={};h.c.KB_FILE_CHUNKS={};
  release({json:async()=>receipt});const saved=await pending;
  assert.equal(saved.length,0);assert.deepEqual(h.c.UPLOADS,{});assert.deepEqual(h.c.KB_FILE_CHUNKS,{});assert.equal(h.finalized.length,0);
});
test('account switch during FileReader prevents any upload request',async()=>{
  const h=boot();h.c._authEpoch=1;let reader;
  h.c.FileReader=class{readAsDataURL(){reader=this;this.result='data:text/plain;base64,dGVzdA==';}};
  const pending=h.c.submitOriginalFile({name:'材料.txt',size:4},'p',null);
  h.c._authEpoch=2;reader.onload();await assert.rejects(pending,/登录状态已变化/);assert.equal(h.calls.length,0);
});
function setupBoot(){
  const h=boot();h.c._authEpoch=1;h.c.localStorage={getItem:()=>'{"PROJECTS":{"p":{}}}'};h.c._safeSyncSnapshot=x=>x;
  h.c.persist=()=>{h.persisted=(h.persisted||0)+1;};h.c.render=()=>{};
  const source=read('frontend/index/script-02-sections/08.js');
  vm.runInContext(source.slice(source.indexOf('function ingestSetupFiles('),source.indexOf('/* 点击「进入工作区」')),h.c);return h;
}
test('setup sync acknowledgement after account switch does not launch uploads',async()=>{
  const h=setupBoot();let release;
  h.c.fetch=(url)=>{h.calls.push(url);return new Promise(r=>{release=r;});};
  const pending=h.c.ingestSetupFiles([{name:'材料.txt',size:4}],'p');h.c._authEpoch=2;h.c.PROJECTS={};
  release({json:async()=>({ok:true})});await pending;
  assert.deepEqual(h.calls,['/api/sync']);assert.equal(h.persisted,undefined);assert.deepEqual(h.c.UPLOADS,{});
});
test('setup upload returning after account switch never applies its original or chunks',async()=>{
  const h=setupBoot();let release;
  h.c.fetch=(url)=>url==='/api/sync'?Promise.resolve({json:async()=>({ok:true})}):new Promise(r=>{release=r;});
  const pending=h.c.ingestSetupFiles([{name:'材料.txt',size:4}],'p');
  for(let i=0;i<12;i++)await Promise.resolve();assert.equal(typeof release,'function');
  h.c._authEpoch=2;h.c.PROJECTS={};h.c.UPLOADS={};h.c.KB_FILE_CHUNKS={};
  release({json:async()=>receipt});await pending;
  assert.deepEqual(h.c.UPLOADS,{});assert.deepEqual(h.c.KB_FILE_CHUNKS,{});assert.equal(h.persisted,undefined);
});
function adminUploadBoot(){
  const h=boot();h.c._authEpoch=1;h.c.document={getElementById:id=>id==='ragUpTopic'?{value:'产业'}:id==='ragUpNature'?{value:'support'}:{}};
  h.c.PROJECTS.p={city:'测试区',kb:[]};h.c.getOpsOperator=()=> 'admin';h.c.restoreFromServer=()=>{h.restored=true;};h.c.renderOpsV2=()=>{};
  const source=read('frontend/ops/script-03-sections/17.js');
  vm.runInContext(source.slice(source.indexOf('function ragReadFile('),source.indexOf('/* ── 接口2 UI')),h.c);return h;
}
test('admin account switch during file read prevents sending old material under new cookie',()=>{
  const h=adminUploadBoot();let reader;
  h.c.FileReader=class{readAsDataURL(){reader=this;this.result='data:text/plain;base64,dGVzdA==';}};
  h.c.ragReadFile({files:[{name:'材料.txt',size:4}]},'p');h.c._authEpoch=2;reader.onload();assert.equal(h.calls.length,0);
});
test('admin old response after logout cannot restore or render data',async()=>{
  const h=adminUploadBoot();let release;
  h.c.fetch=()=>new Promise(r=>{release=r;});h.c.ragDoUpload('p',null,'材料.txt','dGVzdA==');h.c._authEpoch=2;
  release({json:async()=>({ok:true,chunks:1})});for(let i=0;i<8;i++)await Promise.resolve();assert.equal(h.restored,undefined);
});
