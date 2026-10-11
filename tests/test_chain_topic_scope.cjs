const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
function declaration(source,name){
  const start=source.search(new RegExp('(?:async )?function '+name+'\\('));
  assert.ok(start>=0,name);
  const next=source.slice(start+1).search(/\n(?:async )?function /);
  return source.slice(start,next<0?undefined:start+1+next);
}
function setup(file,result){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  const report='本次核电换热设备报告保留原文、条件、主体和来源。'.repeat(8);
  const events={calls:0,persist:0}, storage={};let stored={};
  const c={PROJECTS:{p:{topic:'核电换热设备',city:'闵行区',reportRequestId:'r1'}},
    REPORTSTATE:{p:{topic:'核电换热设备',aiReportByTopic:{'核电换热设备':report}}},
    cur:'p',window:{},LS_KEY:'test',localStorage:{getItem:k=>storage[k]||null},Date,view:'report',_authEpoch:1,_chainGenInFlight:{},KB_API:'/api/kb-chat',
    savedEvidenceIdentity:()=>JSON.stringify({workspace:'p',city:'闵行区',topic:'核电换热设备',selectedTopic:'核电换热设备',requestId:'r1',kb:[[]],onboarding:{},report}),P:()=>c.PROJECTS.p,persist:()=>{events.persist++;storage.test=JSON.stringify({PROJECTS:c.PROJECTS,REPORTSTATE:c.REPORTSTATE});},render:()=>{},
    fetch:async(url,init)=>{if(url==='/api/sync'){if(init&&init.method==='POST'){const delta=JSON.parse(init.body);stored={PROJECTS:c.PROJECTS,REPORTSTATE:JSON.parse(JSON.stringify(c.REPORTSTATE))};Object.assign(stored.REPORTSTATE.p,delta.REPORTSTATE.p);return {ok:true,json:async()=>({ok:true})};}return {ok:true,json:async()=>stored};}events.calls++;return {ok:true};},
    readTopicReportStream:async()=>({text:JSON.stringify(result)}),
    setTimeout:()=>1,clearTimeout:()=>{},AbortController,
    document:{getElementById:()=>null},reportTextForTopic:()=>report,
    escapeChainText:s=>String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;')};
  vm.createContext(c);
  vm.runInContext(['_correctChainLevel','_normalizeChain','currentEvidenceChain','chainSnapshotIdentity','chainSavedSourceMatches','chainSaveCurrent','savePendingChain','syncTopicReportInputs','generateChainFromReport','_renderRichChain','chainMapHtml'].map(n=>declaration(source,n)).join('\n'),c);
  return {c,events,report};
}
for(const [surface,file] of [['user','frontend/index/script-02-sections/12-tail.js'],['admin','frontend/ops/script-03-sections/12-tail.js']]){
  test(surface+' empty source-grounded graph completes and shows three generic material gaps',async()=>{
    const {c,events}=setup(file,[]);
    await c.generateChainFromReport('核电换热设备');
    const rs=c.REPORTSTATE.p;
    assert.equal(rs.chainStatusByTopic['核电换热设备'],'ready');
    assert.equal(events.calls,1);
    assert.equal(rs.chainByTopic['核电换热设备'].length,3);
    assert.ok(rs.chainByTopic['核电换热设备'].every(s=>s.nodes.length===0));
    const html=c.chainMapHtml(c.PROJECTS.p);
    assert.equal((html.match(/资料待补/g)||[]).length,3);
    assert.ok(!html.includes('生物医药'));
    assert.ok(!html.includes('重试生成'));
  });
  test(surface+' partial graph keeps sourced node and gaps without inventing other names',async()=>{
    const result=[{seg:'中游',nodes:[{name:'核级换热器',level:'unknown',note:'待核',sourceRecords:[{urls:['https://official.example/product']}]}]}];
    const {c}=setup(file,result);
    await c.generateChainFromReport('核电换热设备');
    const html=c.chainMapHtml(c.PROJECTS.p);
    assert.ok(html.includes('核级换热器'));
    assert.ok(html.includes('https://official.example/product'));
    assert.equal((html.match(/资料待补/g)||[]).length,2);
    assert.equal(c.REPORTSTATE.p.chainEvidenceByTopic['核电换热设备'].scope,'current-topic-v1');
  });
  test(surface+' legacy same-report mixed-topic cache is not reused or destroyed',()=>{
    const {c,report}=setup(file,[]),rs=c.REPORTSTATE.p;
    rs.chainByTopic={'核电换热设备':[{seg:'中游',nodes:[{name:'生物医药出海环节'}]}]};
    rs.chainEvidenceByTopic={'核电换热设备':{contract:'saved-excerpts-v1',requestId:'r1',reportText:report,sourceIdentity:report}};
    assert.equal(c.currentEvidenceChain('核电换热设备'),null);
    assert.ok(!c.chainMapHtml(c.PROJECTS.p).includes('生物医药出海环节'));
    assert.equal(rs.chainByTopic['核电换热设备'][0].nodes[0].name,'生物医药出海环节');
  });
  test(surface+' malformed result stays incomplete and cannot store a completed map',async()=>{
    const {c}=setup(file,{segments:[]});
    await c.generateChainFromReport('核电换热设备');
    assert.equal(c.REPORTSTATE.p.chainStatusByTopic['核电换热设备'],'failed');
    assert.equal(c.currentEvidenceChain('核电换热设备'),null);
  });
}
