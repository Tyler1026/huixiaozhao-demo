'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.join(__dirname,'..'),source=fs.readFileSync(path.join(base,'frontend/ops/script-03-sections/12-part-00.js'),'utf8'),tail=fs.readFileSync(path.join(base,'frontend/ops/script-03-sections/12-tail.js'),'utf8');
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function boot(){
 const calls=[],nodes={},toasts=[],fingerprint='a'.repeat(64),project={id:'d',isDemand:true,submissionState:'submitted',demandContract:'industry-demand-v1',demandOrigin:'direct',directRequestFingerprint:fingerprint,topic:'生产设备企业',city:'闵行区',demandSpec:{title:'生产设备企业',description:'需要具备指定产品生产和持续交付能力的企业',source:'user_direct',verificationStatus:'user_stated'},clues:[]};
 const c={PROJECTS:{d:project},REPORTSTATE:{},JSON,Date,Math,Promise,URL,_authEpoch:1,document:{getElementById:id=>nodes[id]},_authEscape:String,toast:t=>toasts.push(t),openModal(){},closeModal(){},persist(){},render(){},_funnelClueId:(_key,name)=>name,readTopicReportStream:async r=>({text:await r.text()}),fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,text:async()=>''};}};
 c.window=c;vm.createContext(c);vm.runInContext(source,c);vm.runInContext(tail.slice(tail.indexOf('function pushFunnelTopToGov('),tail.indexOf('function toggleFunnelExpand(')),c);
 return {c,calls,nodes,toasts,project,fingerprint};
}
test('direct context identity names saved demand and does not create report fields',()=>{
 const {c,project,fingerprint}=boot();assert.equal(c.opsDemandContextRequestId('d'),'demand:'+fingerprint);assert.equal('reportRequestId' in project,false);assert.equal(c.REPORTSTATE.d,undefined);
 const identity=c.savedEvidenceIdentity('d',project.topic);assert.equal(JSON.parse(identity).requestId,'demand:'+fingerprint);project.directRequestFingerprint='b'.repeat(64);assert.notEqual(c.savedEvidenceIdentity('d',project.topic),identity);
});
test('report-derived project continues using its saved report identity',()=>{
 const {c,project}=boot();delete project.demandOrigin;project.reportRequestId='report-1';assert.equal(c.opsDemandContextRequestId('d'),'report-1');delete project.reportRequestId;c.REPORTSTATE.d={reportRequestId:'report-2'};assert.equal(c.opsDemandContextRequestId('d'),'report-2');
});
test('direct funnel sends immutable demand identity and accepts the matching response',async()=>{
 const {c,calls,project,fingerprint}=boot();c.fetch=async(url,o)=>{calls.push({url,body:JSON.parse(o.body)});return {ok:true,text:async()=>JSON.stringify({evidence_contract:'saved-excerpts-v1',projectKey:'d',topic:project.topic,reportRequestId:'demand:'+fingerprint,companies:[{name:'有原文的企业',evidence:[{id:'ev1',quote:'企业公开产品目录',urls:['https://official.example/products']}]}]})};};
 let result;c.runAIFunnel('d',(error,data)=>{result={error,data};});await flush();assert.equal(calls[0].body.reportRequestId,'demand:'+fingerprint);assert.equal(result.error,null);assert.equal(result.data.companies.length,1);assert.equal(c.REPORTSTATE.d,undefined);
});
test('changed direct submission fingerprint rejects a late funnel response',async()=>{
 const {c,project,fingerprint}=boot();let release;c.fetch=()=>new Promise(resolve=>release=resolve);let error;c.runAIFunnel('d',e=>error=e);project.directRequestFingerprint='b'.repeat(64);release({ok:true,text:async()=>JSON.stringify({evidence_contract:'saved-excerpts-v1',projectKey:'d',topic:project.topic,reportRequestId:'demand:'+fingerprint,companies:[]})});await flush();assert.match(error,/已变化/);assert.equal(project.funnel,undefined);
});
test('resource preview for direct demand uses user demand anchors and its own context',async()=>{
 const {c,calls,project,fingerprint}=boot();c.fetch=async(url,o)=>{calls.push({url,body:JSON.parse(o.body)});return {ok:true,json:async()=>({projectKey:'d',topic:project.topic,reportRequestId:'demand:'+fingerprint,source:'resource',evidence_contract:'saved-excerpts-v1',companies:[{name:'有原文的企业',resourceId:'res-1',evidence:[{id:'ev1',quote:'企业公开产品目录',urls:['https://official.example/products']}]}],demandAnchors:[{id:'demand:description',kind:'user_demand',quote:project.demandSpec.description}]})};};
 c.resourceReviewPreview('d',['res-1']);await flush();assert.equal(calls[0].body.reportRequestId,'demand:'+fingerprint);assert.equal(c.pushFunnelTopToGov.review.requestId,'demand:'+fingerprint);assert.equal(c.pushFunnelTopToGov.review.anchors[0].kind,'user_demand');assert.equal(c.pushFunnelTopToGov.review.anchors[0].quote,project.demandSpec.description);
});
