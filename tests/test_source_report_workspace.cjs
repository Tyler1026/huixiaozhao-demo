'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
function declaration(file,name){
 const s=read(file),at=s.indexOf('function '+name+'(');assert(at>=0,name);
 const match=s.slice(at).match(/^function [\s\S]*?^}/m);assert(match,name);return match[0];
}
const ROOT='city-workspace',CHILD='demand-apac',TOPIC='外资高端研发中心培育';
function boot(){
 const notes=[],modals=[],nodes={root:{innerHTML:''},reportHistoryArea:{innerHTML:''}};
 const topics=[TOPIC,'智能网联车数据合规承接','苏州产业链招引','先进材料外资增资承接','多级货运枢纽服务培育','半导体电子化学品补链'];
 const report=t=>'# '+t+'\n\n'+('有来源的原始报告正文，判断仍需核实。'.repeat(12));
 const saved='# 需求形成时的报告\n\n'+('原始版本仅说明研发中心的培育条件。'.repeat(12));
 const c={console,Date,URL,JSON,Promise,Set,Math,AUTH:{scope:'project',user:'test-member',projKey:ROOT,projectKeys:[ROOT]},_authEpoch:1,_authState:'ready',
  PROJECTS:{[ROOT]:{city:'苏州',workspaceId:ROOT,topic:topics[1],kb:['主导产业与产业链','园区与承载条件','链主与存量企业','政策、规划与领导关注'].map(t=>({t,known:Array.from({length:5},(_,i)=>t+'已存材料'+i)})),aiTopics:{list:topics.map(label=>({label}))}},
   [CHILD]:{city:'苏州',workspaceId:ROOT,parentProjectKey:ROOT,sourceProjectKey:ROOT,topic:TOPIC,sourceAnalysisTopic:TOPIC,isDemand:true,submissionState:'submitted',demandContract:'industry-demand-v1',demandTitle:'亚太总部、研发中心及智能制造基地',demandSpec:{source:'user_confirmed'},kb:[],clues:[]}},
  REPORTSTATE:{[ROOT]:{topic:topics[1],text:report(topics[1]),phase:2,aiReportByTopic:Object.fromEntries(topics.map(t=>[t,report(t)])),phaseByTopic:Object.fromEntries(topics.map(t=>[t,2]))},
   [CHILD]:{topic:TOPIC,text:saved,phase:2,aiReportByTopic:{[TOPIC]:saved},researchByTopic:{[TOPIC]:{topic:TOPIC,reportText:saved,sources:[]}}}},
  REPORT_HISTORY:{},UPLOADS:{[ROOT]:[{name:'a.docx'},{name:'b.docx'}]},KB_FILE_CHUNKS:{},KB_CONFIRMS:{},KB_UNLOCKED:{},PENDING_CONFIRMS:{},
  DEMANDS:[{id:'receipt',projKey:CHILD}],cur:ROOT,view:'home',role:'gov',detailOpen:true,detailData:null,_histShowAll:false,
  document:{body:{classList:{toggle(){}}},getElementById:id=>nodes[id]||null,querySelector:()=>null},
  toast:t=>notes.push(t),openModal:(...args)=>modals.push(args),closeModal(){},setTimeout:()=>1,clearTimeout(){},
  persist(){throw Error('Viewing a source must not write project state');},fetch(){throw Error('Viewing a source must not generate or fetch a report');},
  _authEscape:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  _kbText:x=>typeof x==='string'?x:x.text||'',hasRealKbData:()=>true,
  kbTopicPresentation:()=>({theme:'test',icon:'test'}),kbTopicArtwork:()=>'',kbTopicColumns:n=>n||1,kbWorkspaceSessionsHtml:()=>'',kbComposer:()=>'<textarea></textarea>',
  mergeTopicReportHistory:old=>old,nativeReportState:()=>null,
  bind(){},topbar:()=>'<header>材料量评分 '+c.kbReadiness().score+'分</header>',sidebar:()=>'<nav>城市智库 · AI 匹配研判</nav>',
  progressFooter:()=>'',detailPane:()=>'',_captureChainExplorer:()=>null,_captureScroll(){},_scrollMemory:{key:'',tops:{}},
  _restoreChainExplorer(){},_restoreScroll(){},_viewScrollKey:()=>c.view+'::'+c.cur,_chainRenderDataKey:()=>'',_renderedScrollKey:'',
  kbChatReplay(){},switchAuthWorkspace(){throw Error('Viewing a source must not switch account workspace');},
  projMgmtPage:()=>'<section>需求与建联</section>',homePage:()=>'<section>AI 匹配研判 · '+c.kbReadinessSummary().sectionText+'</section>',
 };
 c.window=c;c.$=s=>nodes[s.slice(1)];vm.createContext(c);
 const auth='frontend/index/script-02-sections/03.js',tail='frontend/index/script-02-sections/12-tail.js',readiness='frontend/index/script-02-sections/09.js';
 for(const [f,names] of [[auth,['_authProjectKeys','_authWorkspaceOf','P','cityKeys']],['frontend/index/script-02-sections/08.js',['industryAnalysisWorkspaceKey']],
  [readiness,['kbReadiness','kbReadinessSummary','isLocked']],[tail,['hasRealKbData','escapeChainText','demandSubmissionState','kbPage','reportHistoryRecord','getReportHistoryForProject','reportHistoryScoreDisplay','renderHistoryReports']],
  ['frontend/index/script-02-sections/00.js',['reportMdToHtml']],['frontend/index/script-02-sections/11.js',['mainPane']],['frontend/index/script-02-sections/10.js',['go']],['frontend/index/script-02-sections/05.js',['render']]]){
  vm.runInContext(names.map(n=>declaration(f,n)).join('\n'),c);
 }
 vm.runInContext(read('frontend/shared/report-publication.js')+'\n'+read('frontend/index/docking-workspace.js'),c);
 c.render._routed=true;c.render._serverSynced=true;
 return {c,nodes,notes,modals,saved,state:()=>JSON.stringify([c.PROJECTS,c.REPORTSTATE,c.UPLOADS,c.KB_CONFIRMS,c.KB_FILE_CHUNKS]),topics};
}
test('demand source -> city analysis -> knowledge retains four sections, quantity score and all six reports',()=>{
 const h=boot(),before=h.state();h.c.render();
 assert.equal(h.c.dockingOpenReport(CHILD),true);assert.equal(h.c.cur,ROOT);assert.equal(h.c.AUTH.projKey,ROOT);
 assert.match(h.modals[0][1],/需求形成时的报告/);assert.doesNotMatch(h.modals[0][1],/智能网联车数据合规承接/);
 h.c.closeModal();h.c.go('report');assert.equal(h.c.cur,ROOT);assert.equal(h.c.kbReadiness().score,100);
 assert.match(h.c.kbReadinessSummary().sectionText,/4\/4/);assert.equal(h.c.getReportHistoryForProject(ROOT).length,6);
 h.c.renderHistoryReports(ROOT);assert.match(h.nodes.reportHistoryArea.innerHTML,/查看全部方向（6）/);
 h.c.go('knowledge');assert.equal(h.c.cur,ROOT);assert.equal(h.c.AUTH.projKey,ROOT);
 assert.equal((h.nodes.root.innerHTML.match(/class="kb-topic-card"/g)||[]).length,4);
 assert.match(h.nodes.root.innerHTML,/材料量评分 100分/);assert.equal(h.state(),before);
});
test('old child selection is recovered by direct render, not only a sidebar click',()=>{
 const h=boot(),before=h.state();h.c.cur=CHILD;h.c.view='knowledge';h.c.render();
 assert.equal(h.c.cur,ROOT);assert.equal((h.nodes.root.innerHTML.match(/class="kb-topic-card"/g)||[]).length,4);
 assert.equal(h.c.kbReadiness().files,2);assert.equal(h.state(),before);
});
test('source preview does not replace the current city report or regenerate a deleted source direction',()=>{
 const h=boot();delete h.c.REPORTSTATE[ROOT].aiReportByTopic[TOPIC];h.c.PROJECTS[ROOT].deletedTopics=[TOPIC];
 const before=h.state();assert.equal(h.c.dockingOpenReport(CHILD),true);
 assert.match(h.modals[0][1],/需求形成时的报告/);assert.equal(h.state(),before);assert.equal(h.c.cur,ROOT);
});
test('source preview recovers a previously selected demand without changing its frozen report',()=>{
 const h=boot(),before=h.state();h.c.cur=CHILD;h.c.view='home';
 assert.equal(h.c.dockingOpenReport(CHILD),true);assert.equal(h.c.cur,ROOT);assert.equal(h.state(),before);
});
for(const [label,change] of [
 ['direct',h=>{h.c.PROJECTS[CHILD].demandOrigin='direct';}],
 ['missing snapshot',h=>{delete h.c.REPORTSTATE[CHILD];}],
 ['mismatched topic',h=>{h.c.REPORTSTATE[CHILD].topic='其他方向';h.c.REPORTSTATE[CHILD].aiReportByTopic={};}],
 ['wrong workspace',h=>{h.c.PROJECTS[CHILD].workspaceId='foreign';}],
 ['unauthorized parent',h=>{h.c.AUTH.projectKeys=[];}],
 ['missing parent',h=>{delete h.c.PROJECTS[ROOT];}],
 ['unsubmitted demand',h=>{h.c.PROJECTS[CHILD].submissionState='pending';}],
])test(label+' never shows a different report or mutates context',()=>{
 const h=boot();change(h);const before=h.state(),cur=h.c.cur,view=h.c.view;
 assert.equal(h.c.dockingOpenReport(CHILD),false);assert.equal(h.modals.length,0);assert.ok(h.notes.length);
 assert.equal(h.c.cur,cur);assert.equal(h.c.view,view);assert.equal(h.state(),before);
});
test('a genuinely empty city displays an explicit materials empty state',()=>{
 const h=boot();h.c.PROJECTS[ROOT].kb=[];h.c.UPLOADS[ROOT]=[];h.c.view='knowledge';h.c.render();
 assert.match(h.nodes.root.innerHTML,/尚未建立城市材料板块/);assert.match(h.nodes.root.innerHTML,/role="status"/);
 assert.doesNotMatch(h.nodes.root.innerHTML,/class="kb-topic-card"/);
});
