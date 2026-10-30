'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
for(const [page,section] of [['index','script-02-sections'],['ops','script-03-sections']]){
 const head=fs.readFileSync(`frontend/${page}/${section}/12-part-00.js`,'utf8');
 const tail=fs.readFileSync(`frontend/${page}/${section}/12-tail.js`,'utf8');
 const run=head.slice(head.indexOf('function runAIFunnel('),head.indexOf('/* 【2026-09-22'));
 const reader=tail.slice(tail.indexOf('async function readTopicReportStream('),tail.indexOf('async function syncTopicReportInputs('));
 function boot(fail=false){
  const companies=Array.from({length:50},(_,i)=>({name:`企业${i}`,rank:i+1,ranking_score:100-i,
    ranking_status:'ai_inference',fit_score:100-i,evidence:[{id:`s${i}`,quote:`企业${i}生产产品`,urls:['https://official.example/']}]}));
  const output={companies,topic:'隔膜补链',projectKey:'p',reportRequestId:'r1',evidence_contract:'saved-excerpts-v1'};
  const events=[{type:'funnel_progress',message:'全国原文检索已完成'},fail?{error:{message:'检索暂未完成，旧结果保留'}}:
    {choices:[{delta:{content:JSON.stringify(output)},finish_reason:'stop'}]}];
  let saved=0,posted;const node={textContent:''};
  const nodes={funnelProgPhase:node,funnelProgBar:{style:{}},funnelProgPct:{textContent:''}};
  const c={PROJECTS:{p:{topic:'隔膜补链',reportRequestId:'r1',funnel:{companies:[{name:'原企业'}]}}},_funnelRunning:{},
    _authEpoch:1,KB_API_OPS:'/api/kb-chat',document:{getElementById:id=>nodes[id]||null},Date,JSON,Promise,Error,Math,TextDecoder,
    _funnelProg:{pct:0},clearInterval(){},
    opsDemandContextRequestId:()=> 'r1',savedEvidenceIdentity:()=> 'unchanged',persist:()=>saved++,reportStreamMetadataEvent(){},
    _funnelClueId:(key,name)=>key+name,fetch:async(url,init)=>{posted=JSON.parse(init.body);return {ok:true,text:async()=>events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')+'data: [DONE]\n\n'};}};
  const start=tail.indexOf('function updateFunnelProgress('),end=tail.indexOf('function closeFunnelProgressModal(',start);
  const progress=start>=0?tail.slice(start,end):'';
  c.window=c;vm.createContext(c);vm.runInContext(run+'\n'+reader+'\n'+progress,c);
  return {c,node,nodes,get saved(){return saved;},get posted(){return posted;}};
 }
 test(`${page}: fifty ranked companies and actual progress reach the saved frontend result`,async()=>{
  const h=boot();let error;await new Promise(resolve=>h.c.runAIFunnel('p',e=>{error=e;resolve();}));
  assert.equal(error,null);assert.equal(h.c.PROJECTS.p.funnel.companies.length,50);
  assert.equal(h.c.PROJECTS.p.funnel.companies[49].rank,50);assert.equal(h.saved,1);
  assert.equal(h.node.textContent,'全国原文检索已完成');assert.equal(h.posted.mode,'funnel');
 });
 test(`${page}: upstream failure preserves prior companies and releases busy state`,async()=>{
  const h=boot(true);let error;await new Promise(resolve=>h.c.runAIFunnel('p',e=>{error=e;resolve();}));
  assert.match(error,/旧结果保留/);assert.equal(h.saved,0);
  assert.equal(h.c.PROJECTS.p.funnel.companies[0].name,'原企业');assert.equal(h.c._funnelRunning.p,undefined);
 });
 test(`${page}: progress is visible while the stream is still open`,async()=>{
  const h=boot();const enc=new TextEncoder();let finish,read=0,settled=false;
  const event='data: '+JSON.stringify({type:'funnel_progress',stage:'search',completed:1,total:2,message:'正在检索 1/2 项'})+'\n\n';
  h.c.fetch=async()=>({ok:true,body:{getReader:()=>({read:async()=>{
    read++;if(read===1)return {value:enc.encode(event.slice(0,19))};
    if(read===2)return {value:enc.encode(event.slice(19))};
    if(read===3)return new Promise(resolve=>finish=()=>resolve({value:enc.encode('data: '+JSON.stringify({error:{message:'测试终止，旧结果保留'}})+'\n\ndata: [DONE]\n\n')}));
    return {done:true};
  }})}});
  const done=new Promise(resolve=>h.c.runAIFunnel('p',()=>{settled=true;resolve();},(pct,status)=>{
    if(h.c.updateFunnelProgress)h.c.updateFunnelProgress(pct,status);
  }));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false);assert.equal(h.node.textContent,'正在检索 1/2 项');
  if(page==='ops')assert.equal(h.nodes.funnelProgBar.style.width,'42.5%');
  finish();await done;assert.equal(h.saved,0);
 });
 test(`${page}: a silent connection expires visibly and preserves old candidates`,async()=>{
  const h=boot();let expire,reject,cleared=false,error;
  h.c.AbortController=class {constructor(){this.signal={};}abort(){reject(new Error('aborted'));}};
  h.c.setTimeout=(fn,ms)=>{assert.equal(ms,480000);expire=fn;return 7;};
  h.c.clearTimeout=id=>{assert.equal(id,7);cleared=true;};
  h.c.fetch=(url,options)=>{assert.equal(options.cache,'no-store');assert.ok(options.signal);return new Promise((resolve,fail)=>reject=fail);};
  const done=new Promise(resolve=>h.c.runAIFunnel('p',e=>{error=e;resolve();}));
  expire();await done;
  assert.match(error,/8分钟/);assert.equal(cleared,true);assert.equal(h.saved,0);
  assert.equal(h.c.PROJECTS.p.funnel.companies[0].name,'原企业');assert.equal(h.c._funnelRunning.p,undefined);
 });
}
