'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs'), path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const source=read('frontend/ops/script-03-sections/12-part-00.js');
const tail=read('frontend/ops/script-03-sections/12-tail.js');
const profile=read('frontend/ops/script-03-sections/17.js');
const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
function boot(){
 const calls=[], nodes={}, messages=[];
 const c={console,JSON,Math,Date,Promise,URL,TextDecoder,TextEncoder,PROJECTS:{a:{id:'a',city:'同城',topic:'当前方向',reportRequestId:'r1',funnel:{old:true}}},REPORTSTATE:{a:{text:'完整报告'}},cur:'other',
  document:{getElementById:id=>nodes[id]||null},persist(){},render(){},renderOpsV2(){},toast:m=>messages.push(m),_authEscape:s=>String(s),_funnelClueId:(_k,n)=>n,
  fetch:async(url,o)=>{calls.push({url,body:JSON.parse(o.body)});return {ok:true,text:async()=>''};}};
 c.window=c;vm.createContext(c);vm.runInContext(source,c);const reader=tail.slice(tail.indexOf('async function readTopicReportStream('),tail.indexOf('async function syncTopicReportInputs('));vm.runInContext(reader,c);
 return {c,calls,nodes,messages};
}
function stream(obj,stop=true){return {ok:true,text:async()=> 'data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(obj)},finish_reason:stop?'stop':null}]})+'\n\ndata: [DONE]\n\n'};}
const grounded={evidence_contract:'saved-excerpts-v1',projectKey:'a',topic:'当前方向',reportRequestId:'r1',companies:[{name:'公司甲',evidence:[{urls:['https://example.invalid/source']}],score_relocate:null}]};

test('funnel uses exact server project/topic/request and rejects premature EOF',async()=>{
 const h=boot();h.c.fetch=async(u,o)=>{h.calls.push({url:u,body:JSON.parse(o.body)});return stream(grounded,false);};let result;
 h.c.runAIFunnel('a',e=>result=e);await flush();
 assert.match(result,/没有确认生成完成|中断/);assert.equal(h.c.PROJECTS.a.funnel.old,true);
 assert.equal(h.calls[0].body.projectKey,'a');assert.equal(h.calls[0].body.reportRequestId,'r1');assert.equal(h.calls[0].body.topic,'当前方向');
 assert.equal('chunks' in h.calls[0].body,false);assert.doesNotMatch(h.calls[0].body.question,/完整报告/);
});
test('funnel accepts grounded completion, deduplicates names and ignores model totals',async()=>{
 const h=boot();h.c.fetch=async()=>stream({...grounded,total_scanned:46,companies:[...grounded.companies,...grounded.companies]});let result;
 h.c.runAIFunnel('a',(err,out)=>result={err,out});await flush();
 assert.equal(result.err,null);assert.equal(result.out.total,1);assert.equal(result.out.companies.length,1);assert.equal(result.out.companies[0].score_relocate,null);
});
test('cross-project structured response never replaces old candidates',async()=>{
 const h=boot();h.c.fetch=async()=>stream({...grounded,projectKey:'other'});let err;
 h.c.runAIFunnel('a',e=>err=e);await flush();assert.match(err,/来源校验/);assert.equal(h.c.PROJECTS.a.funnel.old,true);
});
test('late same-key report refresh or auth epoch cannot overwrite candidates',async()=>{
 for(const change of ['report','epoch','evidence']){
  const h=boot();let release;h.c._authEpoch=1;h.c.fetch=()=>new Promise(resolve=>release=resolve);let err;
  h.c.runAIFunnel('a',e=>err=e);
  if(change==='report')h.c.PROJECTS.a.reportRequestId='new';
  if(change==='epoch')h.c._authEpoch++;
  if(change==='evidence')h.c.PROJECTS.a.kb=[{known:['new source']}];
  release(stream(grounded));await flush();
  assert.match(err,/已变化/);assert.equal(h.c.PROJECTS.a.funnel.old,true);
 }
});
test('source hyperlinks allow http(s) only',()=>{
 const h=boot();let html=h.c.funnelEvidenceLinks({evidence:[{urls:['javascript:alert(1)','https://safe.invalid/a','https://user:pass@private.invalid']}]});
 assert.match(html,/https:\/\/safe.invalid\/a/);assert.doesNotMatch(html,/javascript|private.invalid/);
});
test('manual push requires two source anchors and per-company review, sends no company body',async()=>{
 const h=boot();vm.runInContext(tail.slice(tail.indexOf('function pushFunnelTopToGov('),tail.indexOf('function toggleFunnelExpand')),h.c);
 h.c.openModal=()=>{};h.c.PROJECTS.a.funnel={...grounded,companies:[{name:'公司甲',evidence:[{id:'e1',quote:'公司甲从事所需产品研发，来源为官方页面',urls:['https://example.invalid/source']}]}]};
 h.c.REPORTSTATE.a={topic:'当前方向',text:'当前方向需要研发及生产相关产品的企业',phase:2};
 h.c.pushFunnelTopToGov('a',8);h.nodes.funnelReviewError={};
 h.c.confirmFunnelReview('a',1);assert.equal(h.calls.length,0);assert.match(h.nodes.funnelReviewError.textContent,/勾选/);
 h.nodes['funnelReview-0']={checked:true};h.nodes['funnelProduct-0']={value:'0'};h.nodes['funnelDemand-0']={value:'0'};h.nodes['funnelReason-0']={value:'已核查产品原文与当前需求的具体业务对应'};
 h.c.closeModal=()=>{};h.c.fetch=async(u,o)=>{h.calls.push({url:u,body:JSON.parse(o.body)});return {ok:true,json:async()=>({ok:true,added:['公司甲'],skipped:[]})};};
 h.c.confirmFunnelReview('a',1);await flush();assert.equal(h.calls[0].url,'/api/funnel-review-push');assert.deepEqual(h.calls[0].body.names,['公司甲']);assert.equal('companies' in h.calls[0].body,false);
 assert.equal(h.calls[0].body.reviews[0].product.evidenceId,'e1');assert.equal(h.calls[0].body.reviews[0].demand.anchorId,'report:0');
});
test('city profile corpus and questionnaire never merge other same-city workspaces',()=>{
 const h=boot();h.c.cpCityMap=()=>({'同城':'a'});
 h.c.PROJECTS={a:{city:'同城',kb:[{t:'topic',known:[{text:'自己的材料'}]}],onboarding:{industry:['自己的偏好']}},b:{city:'同城',kb:[{t:'topic',known:['其他工作区机密']}],onboarding:{industry:['其他偏好']}}};
 const start=profile.indexOf('function cpCorpus('),end=profile.indexOf('/* 问卷 →',start);vm.runInContext(profile.slice(start,end),h.c);
 assert.equal(h.c.cpCorpus('同城').length,1);assert.equal(h.c.cpCorpus('同城')[0].text,'自己的材料');assert.equal(h.c.cpOnboarding('同城').industry[0],'自己的偏好');
});

test('normal polling with an equal snapshot preserves a valid funnel response',async()=>{
 const h=boot();let release;h.c.fetch=()=>new Promise(resolve=>release=resolve);let result;
 h.c.runAIFunnel('a',(err,out)=>result={err,out});
 h.c.PROJECTS=JSON.parse(JSON.stringify(h.c.PROJECTS));h.c.REPORTSTATE=JSON.parse(JSON.stringify(h.c.REPORTSTATE));
 release(stream(grounded));await flush();assert.equal(result.err,null);assert.equal(result.out.companies.length,1);
});
test('funnel conflict explains the next action while retaining existing candidates',async()=>{
 for(const page of ['index/script-02-sections','ops/script-03-sections']){
  const h=boot();vm.runInContext(read('frontend/'+page+'/12-part-00.js'),h.c);
  h.c.fetch=async()=>({ok:false,status:409,json:async()=>({error:'evidence_changed',message:'untrusted provider text'})});
  let error;h.c.runAIFunnel('a',e=>error=e);await flush();
  assert.match(error,/材料已更新.*原候选清单已保留.*刷新后重新分析/);
  assert.doesNotMatch(error,/untrusted provider/);assert.equal(h.c.PROJECTS.a.funnel.old,true);
 }
});
test('funnel unexpected error body is not shown and does not erase candidates',async()=>{
 const h=boot();h.c.fetch=async()=>({ok:false,status:502,json:async()=>({error:'provider_secret',message:'private diagnostic'})});
 let error;h.c.runAIFunnel('a',e=>error=e);await flush();
 assert.match(error,/502.*原候选清单已保留/);assert.doesNotMatch(error,/private diagnostic|provider_secret/);
 assert.equal(h.c.PROJECTS.a.funnel.old,true);
});
test('city profile accepts equal polling snapshots but rejects a real source change',async()=>{
 for(const changed of [false,true]){
  const h=boot();let release,finished=0;h.c.fetch=()=>new Promise(resolve=>release=resolve);
  Object.assign(h.c,{cpProjKey:()=> 'a',cpBusy:false,cpErr:'',cpRaw:'',cpCorpus:()=>[{text:'source'}],cpOnboarding:()=>null,cpFinish:()=>finished++});
  vm.runInContext(profile.slice(profile.indexOf('function cpGenerate('),profile.indexOf('/* 【2026-09-17】JSON')),h.c);
  h.c.cpGenerate(1);h.c.PROJECTS=JSON.parse(JSON.stringify(h.c.PROJECTS));
  if(changed)h.c.PROJECTS.a.kb=[{known:['changed source']}];
  release(stream({evidence_contract:'saved-excerpts-v1',projectKey:'a',topic:'当前方向',reportRequestId:'r1',objective:{}}));await flush();
  assert.equal(finished,changed?0:1);if(changed)assert.match(h.c.cpErr,/已变化/);
 }
});

 test('empty authoritative funnel clears an obsolete candidate list on both surfaces',async()=>{
 for(const page of ['index/script-02-sections','ops/script-03-sections']){
  const h=boot();vm.runInContext(read('frontend/'+page+'/12-part-00.js'),h.c);
  h.c.fetch=async()=>stream({...grounded,companies:[]});let result;
  h.c.runAIFunnel('a',(err,out)=>result={err,out});await flush();
  assert.equal(result.err,null);assert.equal(result.out.companies.length,0);assert.equal(result.out.total,0);
  assert.equal(h.c.PROJECTS.a.funnel.old,undefined);
 }
});
