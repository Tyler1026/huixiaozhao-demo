const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../frontend/index/script-02-sections/12-tail.js'),'utf8');
function declaration(name,input=source){const start=input.search(new RegExp('(?:async )?function '+name+'\\('));assert.ok(start>=0,name);const end=input.slice(start+1).search(/\n(?:async )?function /);return input.slice(start,end<0?undefined:start+1+end);}
const helpers=['reportStateFields','reportStateStamp','reportTopicStamp','mergeTopicStamps','topicLifecycle','mergeTopicProjectLifecycle','mergeTopicReportState','mergeTopicReportStates','mergeTopicReportHistory','applyTopicStateIntegrity','topicOperationStamp','touchTopicPending','clearTopicReportData'];
const clone=x=>JSON.parse(JSON.stringify(x));
function environment(app='index'){
 const c={PROJECTS:{p:{city:'甲市',topic:'A',customTopics:['A'],stageByTopic:{A:3}}},REPORTSTATE:{p:report('A',100,2)},REPORT_HISTORY:{p:[{topic:'A',ts:100,text:'history'}]},PENDING_CONFIRMS:{},cur:'p',view:'report',_authEpoch:1,_aiTopicsGenerating:{},window:{},Date,TextDecoder,TextEncoder,console,
   document:{getElementById(){return null;}},P(){return c.PROJECTS[c.cur];},persist(){},saveReportHistory(){},confirm(){return true;},toast(){},render(){},hasRealKbData(){return true;},buildKBCorpus(){return [];},balancedIndustryChunks(){return ['材料'];},curOnbPrefs(){return {};}};
 const input=app==='index'?source:fs.readFileSync(path.join(__dirname,'../frontend/ops/script-03-sections/12-tail.js'),'utf8');
 vm.createContext(c);vm.runInContext(helpers.map(n=>declaration(n,input)).join('\n'),c);return c;
}
function report(t,ts,phase){return {topic:t,text:t+ts,ts,phase,aiReportByTopic:{[t]:t+ts},tsByTopic:{[t]:ts},phaseByTopic:{[t]:phase},pendingByTopic:{[t]:[{text:'条件',status:'pending'}]},researchByTopic:{[t]:{runId:String(ts)}},materialDirectoryByTopic:{[t]:{v:ts}},evidenceStatusByTopic:{[t]:'unreviewed'},partialByTopic:{[t]:{ts:ts+10,reportTs:ts,text:'part'}}};}
test('browser merges independent topic versions and accepts an explicitly newer draft',()=>{
 const c=environment(),old=report('A',300,2),incoming=report('A',100,1),other=report('B',400,2);
 for(const f of c.reportStateFields().concat(['pendingByTopic']))incoming[f]=Object.assign({},incoming[f],other[f]);incoming.topic='B';incoming.ts=400;
 let merged=c.mergeTopicReportState(old,incoming,{});assert.equal(merged.aiReportByTopic.A,'A300');assert.equal(merged.phaseByTopic.B,2);
 merged=c.mergeTopicReportState(merged,report('A',500,1),{});assert.equal(merged.phaseByTopic.A,1);assert.equal(merged.researchByTopic.A.runId,'500');
});
test('browser confirmation withdrawal and edits survive stale same-report snapshots',()=>{
 const c=environment(),old=report('A',100,1),edited=clone(old);edited.pendingByTopic.A[0]={text:'条件',editedText:'编辑条件',status:'edited'};edited.pendingRevisionByTopic={A:200};edited.pendingReportTsByTopic={A:100};
 let merged=c.mergeTopicReportState(edited,old,{});assert.equal(merged.pendingByTopic.A[0].status,'edited');
 const withdrawn=clone(merged);withdrawn.pendingRevisionByTopic.A=300;withdrawn.pendingByTopic.A[0].status='pending';
 merged=c.mergeTopicReportState(withdrawn,edited,{});assert.equal(merged.pendingByTopic.A[0].status,'pending');assert.equal(merged.pendingByTopic.A[0].editedText,'编辑条件');
});
test('deleting a direction removes partial, material, evidence, stage, history and graph buckets',()=>{
 const c=environment();c.PROJECTS.p.topic='B';c.REPORTSTATE.p.chainByTopic={A:[{seg:'中游'}]};vm.runInContext(declaration('deleteCustomTopic'),c);c.deleteCustomTopic('A');
 for(const field of c.reportStateFields().concat(['pendingByTopic','partialByTopic','chainByTopic']))assert.equal(c.REPORTSTATE.p[field]&&c.REPORTSTATE.p[field].A,undefined,field);
 assert.equal(c.PROJECTS.p.stageByTopic.A,undefined);assert.equal(c.REPORT_HISTORY.p.length,0);assert.ok(c.PROJECTS.p.topicDeletedAt.A>100);
});
test('old browser state cannot revive deleted reports after explicit same-name re-add',()=>{
 const c=environment(),old=report('A',100,2),project={topic:'A',customTopics:['A'],topicDeletedAt:{A:200},topicCreatedAt:{A:300},stageByTopic:{A:2}};
 const merged=c.mergeTopicReportState({},old,project);assert.equal(merged.aiReportByTopic.A,undefined);
 const p=c.mergeTopicProjectLifecycle(project,{topic:'A',customTopics:['A'],stageByTopic:{A:5}});assert.equal(p.stageByTopic.A,2);
 const fresh=c.mergeTopicReportState(merged,report('A',400,1),project);assert.equal(fresh.phaseByTopic.A,1);
});
test('history deletions and direction tombstones survive stale history lists',()=>{
 const c=environment();c.REPORTSTATE.p.historyDeletedAt={['A\0'+100]:200};
 assert.equal(c.mergeTopicReportHistory(c.REPORT_HISTORY,c.REPORT_HISTORY,c.REPORTSTATE,c.PROJECTS).p.length,0);
});
test('manual finalize is retained within the report version and reset by newer generation',()=>{
 const c=environment(),locked=report('A',100,2);locked.finalized=true;
 assert.equal(c.mergeTopicReportState(locked,report('A',100,2),{}).finalized,true);
 assert.equal(c.mergeTopicReportState(locked,report('A',200,1),{}).finalized,false);
});
test('AI direction response stays in its captured city when another project becomes current',async()=>{
 const c=environment();c.PROJECTS.q={city:'乙市',topic:'B'};let resolve;c.fetch=()=>new Promise(r=>{resolve=r;});vm.runInContext(declaration('ensureAiTopics'),c);
 const pending=c.ensureAiTopics();c.cur='q';let sent=false;
 const wire='data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify({topics:[{label:'甲市方向'}]})}}]})+'\n';
 resolve({ok:true,body:{getReader(){return {async read(){if(sent)return {done:true};sent=true;return {done:false,value:new TextEncoder().encode(wire)};}};}}});await pending;
 assert.equal(c.PROJECTS.p.aiTopics.list[0].label,'甲市方向');assert.equal(c.PROJECTS.q.aiTopics,undefined);
});
test('source events preserve archive boundary, PDF scope, analysis and public research',()=>{
 const c=environment();vm.runInContext(declaration('reportStreamMetadataEvent'),c);const metadata={};
 c.reportStreamMetadataEvent(metadata,{type:'research.evidence',sources:[{id:'e',quote:'原文',archived:true,archive_retrieved_at:'2026-10-16',fulltext_scope:'pdf_pages_2_3',pdf_page:2,source_status:'source',origin_id:'origin'}]});
 c.reportStreamMetadataEvent(metadata,{type:'research.complete',analysis:{status:'evidence_only'},publicResearch:{status:'ready'}});
 assert.equal(metadata.sources[0].archived,true);assert.equal(metadata.sources[0].pdf_page,2);assert.equal(metadata.sources[0].fulltext_scope,'pdf_pages_2_3');assert.equal(metadata.sources[0].source_status,'source');assert.equal(metadata.analysis.status,'evidence_only');assert.equal(metadata.publicResearch.status,'ready');
});
test('analysis badge distinguishes evidence summaries from generated judgments',()=>{
 const c=environment(),input=fs.readFileSync(path.join(__dirname,'../frontend/index/script-02-sections/09.js'),'utf8');c.nativeReportState=()=>null;
 vm.runInContext(declaration('topicScoreDisplay',input),c);
 c.REPORTSTATE.p.researchByTopic.A.analysis={status:'evidence_only'};assert.equal(c.topicScoreDisplay('A','p'),'资料摘要 · 研判依据待补');
 c.REPORTSTATE.p.researchByTopic.A.analysis.status='supported_analysis';assert.equal(c.topicScoreDisplay('A','p'),'研判已生成 · 结论待核验');
});

for(const app of ['index','ops']){
 test(app+' shared lifecycle helpers keep the same atomic report and tombstone rules',()=>{
  const c=environment(app),p={topic:'A',topicDeletedAt:{A:200},topicCreatedAt:{A:300},stageByTopic:{A:2}};
  assert.equal(c.mergeTopicReportState({},report('A',100,2),p).aiReportByTopic.A,undefined);
  const fresh=c.mergeTopicReportState(report('A',500,2),report('A',600,1),{});assert.equal(fresh.phaseByTopic.A,1);
  const input=app==='index'?source:fs.readFileSync(path.join(__dirname,'../frontend/ops/script-03-sections/12-tail.js'),'utf8');
  c.PROJECTS.p.topic='B';vm.runInContext(declaration('deleteCustomTopic',input),c);c.deleteCustomTopic('A');assert.equal(c.REPORTSTATE.p.partialByTopic.A,undefined);assert.equal(c.REPORT_HISTORY.p.length,0);
 });
 test(app+' source metadata and analysis boundaries survive the stream',()=>{
  const c=environment(app),input=app==='index'?source:fs.readFileSync(path.join(__dirname,'../frontend/ops/script-03-sections/12-tail.js'),'utf8');
  vm.runInContext(declaration('reportStreamMetadataEvent',input),c);const metadata={},attestation={domain:'example.com',evidence_id:'tr_id',source_id:'source_id',url:'https://example.gov.cn/report',website_host:'www.example.com',website_text:'公司网址 www.example.com',unexpected:'omit'};c.reportStreamMetadataEvent(metadata,{type:'research.evidence',sources:[{archived:true,fulltext_scope:'pdf_excerpt',pdf_page:3,website_attestation:attestation}]});c.reportStreamMetadataEvent(metadata,{type:'research.complete',analysis:{status:'supported_analysis'},publicResearch:{status:'ready'}});
  assert.equal(metadata.sources[0].archived,true);assert.equal(metadata.sources[0].pdf_page,3);assert.equal(metadata.analysis.status,'supported_analysis');
  assert.equal(metadata.sources[0].website_attestation.evidence_id,'tr_id');assert.equal(metadata.sources[0].website_attestation.unexpected,undefined);attestation.domain='changed';assert.equal(metadata.sources[0].website_attestation.domain,'example.com');
 });
}
