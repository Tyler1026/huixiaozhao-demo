'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.join(__dirname,'..');
function pick(file,name){const source=fs.readFileSync(path.join(base,file),'utf8'),start=source.indexOf('function '+name+'('),next=source.indexOf('\nfunction ',start+1);assert.ok(start>=0,name);return source.slice(start,next<0?undefined:next);}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function boot(){
  const project={id:'d',isDemand:true,submissionState:'submitted',demandOrigin:'direct',demandContract:'industry-demand-v1',city:'闵行区',topic:'生物医药设备',demandTitle:'生物医药设备',stage:4,demandSpec:{source:'user_direct',description:'寻找符合实际生产需求的设备供应企业。',conditions:'先核对产品',contactName:'陈先生',contactMethod:'测试联系方式'},clues:[{id:'c',name:'流程测试企业',reason:'客户录入，尚待核对',verificationRequest:{id:'v1',contract:'docking-action-v1',status:'requested',version:0,requestedAt:100,requestedBy:'customer'}}]};
  const elements={},calls={send:[],toast:[],render:0},pending=[];
  const c={PROJECTS:{d:project},DEMANDS:[{projKey:'d'}],REPORTSTATE:{},UPLOADS:{},OPS_ENT:[],OPS_UI:{demands:{city:'',query:'',status:'all'}},DOCK_LOGS:{d:[]},_authEpoch:1,window:{__opsProjOpen:{d:true}},Date,URL,console,
    document:{getElementById(id){return elements[id]||null;}},
    _authEscape(value){return String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll("'",'&#39;').replaceAll('<','&lt;').replaceAll('>','&gt;');},
    dockingRequestId(){return 'req-'+(++c.sequence);},sequence:0,
    dockingLogRecords(key){return c.DOCK_LOGS[key]||[];},dockingValidateFiles(files){return files.some(f=>!/^data:application\/pdf;base64,/.test(f.dataUrl))?'invalid':'';},
    toast(message){calls.toast.push(message);},renderOpsV2(){calls.render++;},opsDate(value){return 'date:'+value;},
    async dockingSendWorkflow(body){calls.send.push(JSON.parse(JSON.stringify(body)));const d=deferred();pending.push(d);return d.promise;},
  };
  c.dockingActionCall=(name,args)=>c._authEscape(name+'('+args.map(v=>JSON.stringify(v)).join(',')+')');
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(base,'frontend/ops/docking-receiving.js'),'utf8'),c);
  vm.runInContext(pick('frontend/ops/script-03-sections/17.js','opsDemandSpecificationHtml'),c);
  return {c,project,calls,elements,pending};
}
function setForm(elements,prefix,key,values){for(const [name,value] of Object.entries(values))elements[prefix+'-'+name+'-'+key]={value};}

test('direct demand shows customer requirement and contacts without inventing a report source',()=>{
  const {c,project}=boot(),html=c.opsReceivingPanel('d',project);
  assert.match(html,/客户直接提交/);assert.match(html,/寻找符合实际生产需求/);assert.match(html,/陈先生/);assert.match(html,/测试联系方式/);
  assert.doesNotMatch(html,/来源分析方向|查看原建议与依据/);assert.match(html,/待受理/);
  assert.ok(html.indexOf('寻找符合实际生产需求')<html.indexOf('处理状态'));
});
test('read-only rendering retains submitted state and marks supplemented intake accurately',()=>{
  const {c,project}=boot();const before=JSON.stringify(project);c.opsReceivingPanel('d',project);assert.equal(JSON.stringify(project),before);
  project.intake={contract:'docking-action-v1',status:'submitted',lastSupplementAt:100,version:2};assert.match(c.opsIntakeBadge(project),/已补充 · 待复核/);
});
test('form handlers pass field changes with valid escaped JavaScript',()=>{
  const {c}=boot(),encoded=c.opsDockingField('intake','d',null,'owner'),handler=encoded.replaceAll('&quot;','"').replaceAll('&#39;',"'");
  vm.runInContext('(function(){'+handler+'}).call({value:"承办人"})',c);
  assert.equal(c.opsDockingDraft('intake','d',null).values.owner,'承办人');
});
test('inbox counts only submitted demands, and supports all receiving states',()=>{
  const {c,project}=boot();c.PROJECTS.pending={...project,submissionState:'pending'};c.PROJECTS.unknown={...project,submissionState:undefined};c.PROJECTS.archived={...project,archived:true};c.PROJECTS.processing={...project,intake:{contract:'docking-action-v1',status:'processing'}};
  const html=c.opsReceivingOverview();assert.match(html,/待受理<\/span><strong>1<\/strong>/);assert.match(html,/处理中<\/span><strong>1<\/strong>/);assert.match(html,/待处理企业核验<\/span><strong>2<\/strong>/);
  assert.equal(c.opsIsSubmittedDemand('pending',c.PROJECTS.pending),false);assert.equal(c.opsIsSubmittedDemand('unknown',c.PROJECTS.unknown),false);
});
test('receiving action waits for a server receipt and sends version, owner and customer reply',async()=>{
  const {c,project,calls,elements,pending}=boot();setForm(elements,'receiving','d',{status:'processing',owner:'资源团队',nextStep:'核对产品目录',note:'需求已受理'});
  const before=JSON.stringify(project),promise=c.opsSaveReceiving('d');assert.equal(JSON.stringify(project),before);assert.equal(calls.render,0);
  assert.deepEqual(calls.send[0],{projectKey:'d',action:'review_demand',requestId:'req-1',expectedVersion:0,record:{status:'processing',owner:'资源团队',nextStep:'核对产品目录',note:'需求已受理'}});
  pending[0].resolve({ok:true,created:true});assert.equal(await promise,true);assert.equal(calls.render,1);assert.equal(elements['receiving-note-d'].value,'');
});
test('empty receiving fields never submit',async()=>{
  const {c,calls,elements}=boot();setForm(elements,'receiving','d',{status:'needs_info',owner:'',nextStep:'补充产品',note:'需要补充'});assert.equal(await c.opsSaveReceiving('d'),false);assert.equal(calls.send.length,0);assert.match(c.opsDockingDraft('intake','d',null).error,/负责人/);
});
test('ambiguous failure retains request id and blocks altered-content retry',async()=>{
  const {c,calls,elements,pending}=boot();setForm(elements,'receiving','d',{status:'processing',owner:'资源团队',nextStep:'核对目录',note:'收到需求'});
  let promise=c.opsSaveReceiving('d');pending[0].reject(new Error('network lost'));assert.equal(await promise,false);const first=calls.send[0];
  elements['receiving-note-d'].value='另一条回复';assert.equal(await c.opsSaveReceiving('d'),false);assert.equal(calls.send.length,1);
  elements['receiving-note-d'].value='收到需求';promise=c.opsSaveReceiving('d');assert.deepEqual(calls.send[1],first);pending[1].resolve({ok:true,created:false});assert.equal(await promise,true);
});
test('verification requires an explicit conclusion with evidence and is not optimistic',async()=>{
  const {c,project,calls,elements,pending}=boot();setForm(elements,'verification','d-c',{status:'completed',outcome:'further_contact',note:'已核对公开产品',evidence:''});
  assert.equal(await c.opsSaveVerification('d','c'),false);assert.equal(calls.send.length,0);
  elements['verification-evidence-d-c'].value='2026-10-19 核对产品目录；投资意向未确认';const before=JSON.stringify(project),promise=c.opsSaveVerification('d','c');assert.equal(JSON.stringify(project),before);
  assert.equal(calls.send[0].expectedVersion,0);assert.equal(calls.send[0].record.outcome,'further_contact');pending[0].resolve({ok:true,created:true});assert.equal(await promise,true);
  const html=c.opsVerificationPanel('d',project);assert.match(html,/不代表企业已确认投资意向/);
});
test('ongoing verification does not send a stale completed outcome',async()=>{
  const {c,calls,elements,pending}=boot();setForm(elements,'verification','d-c',{status:'needs_info',outcome:'further_contact',note:'需要提供产品目录',evidence:''});const promise=c.opsSaveVerification('d','c');assert.equal('outcome' in calls.send[0].record,false);pending[0].resolve({ok:true,created:true});await promise;
});
test('timeline displays real record details and only validated attachments',()=>{
  const {c}=boot();c.DOCK_LOGS.d=[{id:'1',kind:'review_demand',actor:'admin',actorRole:'admin',ts:1,note:'已受理 <script>',owner:'承办人',nextStep:'核对产品目录'},{id:'2',kind:'review_verification',ts:2,note:'已核对',outcome:'insufficient',evidence:'目录不足',files:[{name:'已保存.pdf',size:10,dataUrl:'data:application/pdf;base64,AA=='},{name:'bad.html',size:10,dataUrl:'data:text/html;base64,AA=='}]}];
  const html=c.opsCustomerActivity('d');assert.match(html,/需求处理回复/);assert.match(html,/企业核验反馈/);assert.match(html,/负责人：承办人/);assert.match(html,/下一步：核对产品目录/);assert.match(html,/现有材料无法形成结论/);assert.match(html,/核验依据：目录不足/);assert.match(html,/已保存.pdf/);assert.doesNotMatch(html,/bad.html|<script>/);assert.match(html,/&lt;script&gt;/);
});
test('stage update carries concurrency version and does not change local progress before acknowledgement',async()=>{
  const {c,project,calls,pending}=boot();project.stageVersion=3;const promise=c.opsSaveStageAction('d',5,'已完成首次正式沟通');assert.equal(project.stage,4);assert.equal(calls.send[0].expectedVersion,3);assert.deepEqual(calls.send[0].record,{target:5,note:'已完成首次正式沟通'});pending[0].resolve({ok:true,created:true});assert.equal(await promise,true);
});
test('auth epoch isolates drafts and pending replies',()=>{
  const {c}=boot(),first=c.opsDockingDraft('intake','d',null);first.values.note='旧会话回复';c._authEpoch++;const second=c.opsDockingDraft('intake','d',null);assert.notEqual(first,second);assert.equal(second.values.note,'');
});
