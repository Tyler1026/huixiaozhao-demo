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
  const c={PROJECTS:{p:{topic:'隔膜补链',reportRequestId:'r1',funnel:{companies:[{name:'原企业'}]}}},_funnelRunning:{},
    _authEpoch:1,KB_API_OPS:'/api/kb-chat',document:{getElementById:()=>node},Date,JSON,Promise,Error,Math,
    opsDemandContextRequestId:()=> 'r1',savedEvidenceIdentity:()=> 'unchanged',persist:()=>saved++,reportStreamMetadataEvent(){},
    _funnelClueId:(key,name)=>key+name,fetch:async(url,init)=>{posted=JSON.parse(init.body);return {ok:true,text:async()=>events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')+'data: [DONE]\n\n'};}};
  c.window=c;vm.createContext(c);vm.runInContext(run+'\n'+reader,c);
  return {c,node,get saved(){return saved;},get posted(){return posted;}};
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
}
