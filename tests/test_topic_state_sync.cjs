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
function refreshedResearch(topic,text,stamp,id){return {topic,reportText:text,sources:[{id,url:'https://official.example/'+id,quote:'原始材料'}],analysis:{contract:'topic-report-analysis-v2',priorities:[]},directionRefresh:{generatedAt:stamp}};}
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
 test(app+' same-report direction refresh wins independently and keeps its sources and priorities atomic',()=>{
  const c=environment(app),old=report('A',100,2),fresh=clone(old);
  c.URL=URL;vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/shared/report-priorities.js'),'utf8'),c);
  old.researchByTopic.A=refreshedResearch('A','A100',150,'old');
  fresh.researchByTopic.A={topic:'A',reportText:'A100',sources:[{id:'new',url:'https://official.example/new',quote:'新方向的原始材料'}],analysis:{contract:'topic-report-analysis-v2',priorities:[{focus:'新方向',scope:'industry',state:'reviewed_inference',comparison:'条件比较',reason:'已有依据',action:'具体行动',evidence_ids:['new']}]},directionRefresh:{generatedAt:200}};
  const before=JSON.stringify([old,fresh]);
  for(const [left,right] of [[old,fresh],[fresh,old]]){
   const merged=c.mergeTopicReportState(left,right,{});
   assert.deepEqual(clone(merged.researchByTopic.A),fresh.researchByTopic.A);
   assert.equal(c.reportAnalyticalPriorities(merged,'A').length,1,'the newer sources and priorities must reach the actual display adapter together');
   assert.equal(merged.aiReportByTopic.A,'A100');assert.equal(merged.tsByTopic.A,100);assert.equal(merged.phaseByTopic.A,2);
  }
  assert.equal(JSON.stringify([old,fresh]),before);
 });
 test(app+' direction metadata cannot cross a different report version, body, topic, phase or native receipt',()=>{
  const c=environment(app),old=report('A',100,2);old.researchByTopic.A=refreshedResearch('A','A100',150,'old');
  for(const mismatch of ['body','topic','phase','receipt','timestamp']){
   const incoming=clone(old);incoming.researchByTopic.A=refreshedResearch('A','A100',999,'wrong');
   if(mismatch==='body'){incoming.aiReportByTopic.A='changed';incoming.text='changed';incoming.researchByTopic.A.reportText='changed';}
   if(mismatch==='topic')incoming.researchByTopic.A.topic='B';
   if(mismatch==='phase')incoming.phaseByTopic.A=1;
   if(mismatch==='receipt'){old.sourceReportId='native-one';incoming.sourceReportId='native-two';}
   if(mismatch==='timestamp')incoming.tsByTopic.A=99;
   assert.deepEqual(clone(c.mergeTopicReportState(old,incoming,{}).researchByTopic.A),old.researchByTopic.A,mismatch);
   delete old.sourceReportId;
  }
  for(const sameBody of [false,true]){
   const newer=report('A',200,2);if(sameBody)newer.text=newer.aiReportByTopic.A='A100';
   newer.researchByTopic.A={topic:'A',reportText:newer.text,sources:[{id:'new-report'}]};
   assert.deepEqual(clone(c.mergeTopicReportState(old,newer,{}).researchByTopic.A),newer.researchByTopic.A);
  }
 });
 test(app+' independent refresh requires a bounded finite timestamp and complete sources with v2 analysis',()=>{
  const c=environment(app),old=report('A',100,2);c.Date={now:()=>1000};
  old.researchByTopic.A=refreshedResearch('A','A100',150,'old');
  const invalid=[['missing timestamp',x=>delete x.directionRefresh.generatedAt],['zero',x=>x.directionRefresh.generatedAt=0],['negative',x=>x.directionRefresh.generatedAt=-1],['NaN',x=>x.directionRefresh.generatedAt=NaN],['infinite',x=>x.directionRefresh.generatedAt=Infinity],['string',x=>x.directionRefresh.generatedAt='200'],['future',x=>x.directionRefresh.generatedAt=301001],['missing sources',x=>delete x.sources],['invalid sources',x=>x.sources={}],['missing analysis',x=>delete x.analysis],['wrong contract',x=>x.analysis.contract='other'],['invalid priorities',x=>x.analysis.priorities={}]];
  for(const [label,mutate] of invalid){
   const incoming=clone(old);incoming.researchByTopic.A=refreshedResearch('A','A100',200,'invalid');mutate(incoming.researchByTopic.A);
   assert.deepEqual(clone(c.mergeTopicReportState(old,incoming,{}).researchByTopic.A),old.researchByTopic.A,label);
  }
  const bounded=clone(old);bounded.researchByTopic.A=refreshedResearch('A','A100',301000,'bounded');
  assert.deepEqual(clone(c.mergeTopicReportState(old,bounded,{}).researchByTopic.A),bounded.researchByTopic.A,'the five-minute skew limit is inclusive');
 });
 test(app+' a refreshed parent never replaces the frozen sources of a separate submitted child record',()=>{
  const c=environment(app),old=report('A',100,2),fresh=clone(old),child=clone(old);
  old.researchByTopic.A=refreshedResearch('A','A100',150,'old');
  fresh.researchByTopic.A=refreshedResearch('A','A100',200,'new');
  child.sourceReportId='frozen-child';child.researchByTopic.A=refreshedResearch('A','A100',120,'frozen');
  const merged=c.mergeTopicReportStates({parent:old,child},{parent:fresh,child:clone(child)},{child:{isDemand:true,workspaceId:'parent'}});
  assert.deepEqual(clone(merged.parent.researchByTopic.A),fresh.researchByTopic.A);
  assert.deepEqual(clone(merged.child.researchByTopic.A),child.researchByTopic.A);
 });
 test(app+' legacy current text permits a matching independent refresh but never imports another topic',()=>{
  const c=environment(app),old={topic:'A',text:'legacy',ts:100,phase:2,researchByTopic:{A:{topic:'A',reportText:'legacy',sources:[]}}},fresh=clone(old);
  fresh.researchByTopic.A=refreshedResearch('A','legacy',200,'new');
  assert.deepEqual(clone(c.mergeTopicReportState(old,fresh,{}).researchByTopic.A),fresh.researchByTopic.A);
  fresh.researchByTopic.A.topic='B';assert.deepEqual(clone(c.mergeTopicReportState(old,fresh,{}).researchByTopic.A),old.researchByTopic.A);
 });
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
