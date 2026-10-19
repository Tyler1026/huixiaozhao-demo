'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const full=['一、产业基础判断\n原有事实待核。','二、产业链缺口分析\n缺口待核。','三、补链优先级清单\n排序待核。','四、目标企业画像\n投资意向未知。','五、待确认事项\n政策条件待确认。'].join('\n');
function declaration(source,name){
  const start=source.search(new RegExp('(?:async )?function '+name+'\\('));assert.ok(start>=0,name);
  const next=source.slice(start+1).search(/\n(?:async )?function /);return source.slice(start,next<0?undefined:start+1+next);
}
function env(app='index'){
  const dir=path.join(root,'frontend',app,app==='index'?'script-02-sections':'script-03-sections');
  const source=fs.readFileSync(path.join(dir,'00.js'),'utf8'),tail=fs.readFileSync(path.join(dir,'12-tail.js'),'utf8');
  const project={id:'child',workspaceId:'root',isDemand:true,city:'闵行区',topic:'核电换热',kb:[{known:[{origin:'report',reportRequestId:'r-old',sourceFile:'old.md'}]}]};
  const state={topic:project.topic,text:full,aiReportByTopic:{[project.topic]:full},phaseByTopic:{[project.topic]:2},ts:1};
  const area={innerHTML:'',appendChild(){}},bar={innerHTML:''};
  const c={cur:'child',PROJECTS:{child:project,root:{id:'root',workspaceId:'root',reportRequestId:'r-new',kb:[{known:[{origin:'report',reportRequestId:'r-new',sourceFile:'parent-latest.md'}]}]}},REPORTSTATE:{child:state},UPLOADS:{},PENDING_CONFIRMS:{},DEMANDS:[],window:{},Date,JSON,URL,Blob,Promise,TextDecoder,AbortController,console,
    _authEpoch:1,LS_KEY:'test',crypto:require('node:crypto').webcrypto,TextEncoder,nativeReportState:()=>null,topicScoreDisplay:()=> '内容待核验',
    P:()=>c.PROJECTS[c.cur],reportTextForTopic:t=>(c.REPORTSTATE[c.cur].aiReportByTopic||{})[t]||'',
    document:{getElementById:id=>id==='reportArea'?area:null,querySelector:()=>bar,createElement:()=>({})},
    setTimeout:()=>1,clearTimeout(){},toast(){},render(){},persist(){},renderHistoryReports(){},origReportFiles:()=>null,
    chainMapHtml:()=>'<button>生成产业链图谱</button>',reportDemandActionButton:()=>'<button>需求</button>',escapeChainText:s=>s,
    localStorage:{getItem:()=> '{}'},buildKBCorpus:()=>[],kbSearch:()=>[],curOnbPrefs:()=>({}),parsePendingItems:()=>[],view:'report',
  };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root,'frontend/shared/industry-demands.js'),'utf8'),c);
  vm.runInContext(tail.slice(tail.indexOf('function reportStateFields('),tail.indexOf('function selectTopic(')),c);
  ['captureReportMaterialDirectory','reportMaterialDirectoryForContext','reportExportSourceHeading','reportExportSourceRecords','reportExportContext','reportMdToHtml','viewCurrentReport'].forEach(name=>vm.runInContext(declaration(source,name),c));
  if(app==='index')vm.runInContext(declaration(source,'setReportAreaHtml'),c);
  vm.runInContext(declaration(tail,'demandReportSnapshot'),c);
  return {c,project,state,source,tail,area,bar};
}
for(const app of ['index','ops']){
  test(app+' native material export keeps exact request filtering',()=>{
    const {c,project}=env(app);c.nativeReportState=()=>({});project.reportRequestId='r-new';
    project.kb[0].known.push({origin:'report',reportRequestId:'r-new',sourceFile:'correct.md'});
    let result=c.reportExportSourceRecords(c.reportExportContext());assert.deepEqual(Array.from(result,x=>x.value),['correct.md']);
    assert.equal(c.reportExportSourceHeading(c.reportExportContext()),'来源索引');
    delete project.reportRequestId;assert.equal(c.reportExportSourceRecords(c.reportExportContext()).length,0);
  });
  test(app+' legacy demand only exposes its saved directory, never the current parent package',()=>{
    const {c,project,state}=env(app),before=JSON.stringify([project,state]);
    const result=c.reportExportSourceRecords(c.reportExportContext());
    assert.deepEqual(Array.from(result,x=>x.value),['old.md']);
    assert.equal(result[0].kind,'保存材料');
    assert.equal(c.reportExportSourceHeading(c.reportExportContext()),'该需求当前保存的材料目录（非逐句引用）');
    assert.equal(JSON.stringify([project,state]),before);
    c.cur='root';c.PROJECTS.root.topic='核电换热';c.REPORTSTATE.root=state;
    assert.equal(c.reportExportSourceRecords(c.reportExportContext()).length,0,'a custom workspace without a frozen directory cannot substitute its newest KB');
  });
  test(app+' legacy custom text in a canonical workspace uses only that workspace current directory',()=>{
    const {c,project,state}=env(app);project.isDemand=false;state.userGeneratedTopics={[project.topic]:true};
    c.PROJECTS.sibling={isDemand:true,kb:[{known:[{sourceFile:'sibling-private.md'}]}]};
    state.materialDirectoryByTopic={other:{records:[{kind:'保存材料',value:'other-topic.md'}]}};
    assert.equal(c.reportExportSourceHeading(c.reportExportContext()),'当前工作区保存的材料目录（非逐句引用）');
    assert.deepEqual(Array.from(c.reportExportSourceRecords(c.reportExportContext()),x=>x.value),['old.md']);
    state.userGeneratedTopics={other:true};assert.equal(c.reportExportSourceRecords(c.reportExportContext()).length,0);
    assert.equal(c.reportExportSourceHeading(c.reportExportContext()),'正文链接（未核验）');
  });
  test(app+' frozen directory binds exact topic, text and owner; mismatches do not use live materials',()=>{
    const {c,state}=env(app),snapshot=c.captureReportMaterialDirectory('child','核电换热');snapshot.reportText=full;
    state.materialDirectoryByTopic={'核电换热':snapshot};
    assert.equal(c.reportExportSourceHeading(c.reportExportContext()),'生成时材料快照（非逐句引用）');
    c.PROJECTS.child.kb[0].known[0].sourceFile='new-own-material.md';
    assert.deepEqual(Array.from(c.reportExportSourceRecords(c.reportExportContext()),x=>x.value),['old.md']);
    for(const [field,value] of [['topic','另一方向'],['reportText','过期正文'],['projectKey','sibling'],['workspaceId','foreign']]){
      const old=snapshot[field];snapshot[field]=value;
      assert.equal(c.reportExportSourceRecords(c.reportExportContext()).length,0,field);
      snapshot[field]=old;
    }
  });
  test(app+' context key selects only own uploads and URL text is marked unverified',()=>{
    const {c,project,state}=env(app);c.UPLOADS={child:[{name:'own.pdf'},{name:'pending.pdf',pending:true},{name:'failed.pdf',parseFailed:true}],root:[{name:'parent.pdf'}]};
    state.aiReportByTopic[project.topic]+='\nhttps://example.gov.cn/policy';
    const context=c.reportExportContext();c.cur='root';
    const result=c.reportExportSourceRecords(context);
    assert.deepEqual(Array.from(result,x=>x.value),['old.md','own.pdf','https://example.gov.cn/policy']);
    assert.equal(result.at(-1).kind,'正文链接（未核验）');
  });
  test(app+' submission snapshots a matching directory deeply and preserves native metadata',()=>{
    const {c,state}=env(app),directory=c.captureReportMaterialDirectory('child','核电换热');directory.reportText=full;
    state.materialDirectoryByTopic={'核电换热':directory};
    const snapshot=c.demandReportSnapshot('child','核电换热');
    assert.equal(snapshot.materialDirectoryByTopic['核电换热'].records[0].value,'old.md');
    directory.records[0].value='mutated.md';
    assert.equal(snapshot.materialDirectoryByTopic['核电换热'].records[0].value,'old.md');
    assert.equal(snapshot.text,full);
    state.sourceReportId='native-id';state.score=0;c.nativeReportState=()=>({});
    assert.equal(c.demandReportSnapshot('child','核电换热').sourceReportId,'native-id');
  });
  test(app+' current report view uses one Markdown renderer and exact topic text',()=>{
    const {c,state,project,area}=env(app);state.text='wrong fallback';state.topic='other';
    state.aiReportByTopic[project.topic]='### 合格标题\n\n---\n\n|列一|列二|\n|---|---|\n|甲|乙|\n\n<script>bad</script>';
    c.viewCurrentReport();
    assert.match(area.innerHTML,/<h3>合格标题<\/h3>/);assert.match(area.innerHTML,/<hr>/);assert.match(area.innerHTML,/<table>/);
    assert.match(area.innerHTML,/&lt;script&gt;bad&lt;\/script&gt;/);assert.doesNotMatch(area.innerHTML,/wrong fallback|###|<script>/);
    assert.equal(state.text,'wrong fallback');
  });
  test(app+' action card identifies the selected demand without conflating it with its source report',()=>{
    const {c,tail,project}=env(app);c.demandReportSnapshot=()=>({});
    project.demandContract='industry-demand-v1';project.demandTitle='核级换热器招引';project.sourceAnalysisTopic='核电换热';project.selectedPriority={focus:'核级换热器'};project.demandSpec={description:'引入核级换热器生产能力'};
    vm.runInContext(['demandSubmissionState','reportDemandActionButton','restoreActionItems'].map(n=>declaration(tail,n)).join('\n'),c);
    const before=JSON.stringify(c.PROJECTS),html=c.restoreActionItems();assert.match(html,/独立招商需求/);assert.match(html,/核级换热器招引/);assert.match(html,/引入核级换热器生产能力/);assert.match(html,/来自分析：核电换热/);assert.match(html,/查看这条招商需求/);assert.doesNotMatch(html,/提交后，管理端将|提交当前方向/);
    c.DEMANDS.push({projKey:'child'});assert.equal(c.restoreActionItems(),html);
    assert.equal(JSON.stringify(c.PROJECTS),before);
  });
}
function wire(text,finish='stop'){
  const s='data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\n'+'data: '+JSON.stringify({choices:[{delta:{},finish_reason:finish}]})+'\n\ndata: [DONE]';
  return {ok:true,text:async()=>s};
}
test('actual generation rejects material changes, then freezes a stable directory without replacing it on failure',async()=>{
  const {c,project,state,tail}=env();state.phaseByTopic[project.topic]=1;state.pendingByTopic={[project.topic]:[{text:'确认方向',status:'confirmed'}]};
  c.syncTopicReportInputs=()=>Promise.resolve();c.setReportAreaHtml=()=>{};
  c.fetch=()=>{project.kb[0].known[0].sourceFile='new-live.md';return Promise.resolve(wire(full));};
  ['fullReportConfirmation','topicReportMarkup','reportMaterialIdentity','reportClientFingerprint','reportJobForTopic','reportRunBanner','refreshReportRunUi','reportStreamMetadataEvent','readTopicReportStream','isCompleteTopicReport','updateReportBusy','triggerReport'].forEach(n=>vm.runInContext(declaration(tail,n),c));
  const old=state.aiReportByTopic[project.topic];
  await c.triggerReport(2);
  assert.equal(state.aiReportByTopic[project.topic],old);assert.equal(state.materialDirectoryByTopic,undefined);
  c.fetch=()=>Promise.resolve(wire(full));
  await c.triggerReport(2);
  const snapshot=state.materialDirectoryByTopic[project.topic];assert.equal(snapshot.reportText,full);assert.equal(snapshot.records[0].value,'new-live.md');
  assert.equal(snapshot.contract,'saved-material-directory-v1');
  state.phaseByTopic[project.topic]=1;c.fetch=()=>Promise.resolve(wire('partial','length'));
  await c.triggerReport(2);assert.equal(state.materialDirectoryByTopic[project.topic],snapshot);
  assert.equal(snapshot.reportText,full);assert.equal(state.aiReportByTopic[project.topic],full);
});
