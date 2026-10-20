'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const context={URL};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/shared/report-priorities.js'),'utf8'),context);
const read=(state,topic='方向甲')=>JSON.parse(JSON.stringify(context.reportAnalyticalPriorities(state,topic)));
function fixture(){
  const priority=(focus,ids)=>({focus,state:'reviewed_inference',scope:'industry',comparison:'全国行业口径，不能推断本地供应。',reason:'原文披露了实际需求与供给约束。',action:'核实当地采购需求和供应主体。',evidence_ids:ids,missing:['本地供需数据']});
  return {aiReportByTopic:{方向甲:'报告正文'},researchByTopic:{方向甲:{topic:'方向甲',reportText:'报告正文',analysis:{contract:'topic-report-analysis-v2',priorities:[priority('产品甲',['a']),priority('产品乙',['b','a'])]},sources:[{id:'a',url:'https://example.gov.cn/a',quote:'产品甲的实际原文。',title:'来源甲',archived:true,archive_retrieved_at:'2026-10-17',pdf_page:3},{id:'b',url:'https://example.gov.cn/b',quote:'产品乙的实际原文。'}]}}};
}
test('displays every reviewed priority from its exact report without inventing rank or score',()=>{
  const state=fixture(),before=JSON.stringify(state),rows=read(state);
  assert.deepEqual(rows.map(x=>x.focus),['产品甲','产品乙']);
  assert.equal(rows[0].scopeLabel,'行业共性，非本地缺失');
  assert.equal(rows[0].sources[0].pdf_page,3);assert.equal(rows[0].sources[0].archived,true);
  assert.equal(rows[0].sources[0].archive_retrieved_at,'2026-10-17');
  assert.equal(rows[0].score,undefined);assert.equal(rows[0].rank,undefined);
  assert.equal(JSON.stringify(state),before);
  rows[0].sources[0].quote='changed';assert.equal(read(state)[0].sources[0].quote,'产品甲的实际原文。');
});
test('no fixed maximum and no fallback to current topic, old action cards, or graph nodes',()=>{
  const state=fixture(),meta=state.researchByTopic.方向甲;
  meta.analysis.priorities.push(...Array.from({length:4},(_,i)=>({...meta.analysis.priorities[0],focus:'追加产品'+i})));
  assert.equal(read(state).length,6);
  meta.analysis.priorities=[];state.topic='方向甲';state.actionItemsByTopic={方向甲:[{gap:'无出处旧卡'}]};state.chainByTopic={方向甲:[{nodes:[{name:'无出处节点',level:'weak'}]}]};
  assert.deepEqual(read(state),[]);
});
test('a different topic or changed report cannot inherit stale analytical priorities',()=>{
  for(const change of [s=>s.researchByTopic.方向甲.topic='方向乙',s=>s.researchByTopic.方向甲.reportText='旧正文',s=>delete s.aiReportByTopic.方向甲,s=>delete s.researchByTopic]){
    const state=fixture();change(state);assert.deepEqual(read(state),[]);
  }
  assert.deepEqual(read(fixture(),'方向乙'),[]);
});
test('a proposal, unrecognized scope, unsupported contract, or incomplete argument is not promoted',()=>{
  for(const change of [r=>r.state='pending_review',r=>r.scope='unknown',r=>r.focus='',r=>r.action='',r=>r.comparison='',r=>r.reason='']){
    const state=fixture();change(state.researchByTopic.方向甲.analysis.priorities[0]);assert.deepEqual(read(state).map(x=>x.focus),['产品乙']);
  }
  const state=fixture();state.researchByTopic.方向甲.analysis.contract='legacy';assert.deepEqual(read(state),[]);
});
test('all cited evidence must resolve to a nonempty source with a safe URL',()=>{
  for(const sourceChange of [s=>s.quote='',s=>s.url='javascript:alert(1)',s=>s.url='https://user:pass@example.com',s=>s.id='other',s=>s.url='https://']){
    const state=fixture();sourceChange(state.researchByTopic.方向甲.sources[0]);assert.deepEqual(read(state),[]);
  }
  const state=fixture();state.researchByTopic.方向甲.analysis.priorities[0].evidence_ids=['a','missing'];assert.deepEqual(read(state).map(x=>x.focus),['产品乙']);
});
test('ambiguous source ids are rejected, repeated citation ids are counted once',()=>{
  const state=fixture(),meta=state.researchByTopic.方向甲;
  meta.analysis.priorities[0].evidence_ids=['a','a'];assert.equal(read(state)[0].sources.length,1);
  meta.sources.push({...meta.sources[0],quote:'冲突原文'});assert.deepEqual(read(state),[]);
});
test('planned development remains a distinct reviewed opportunity with the same source requirements',()=>{
  const state=fixture(),rows=state.researchByTopic.方向甲.analysis.priorities;rows[0].opportunity_type='planned_development';
  const before=JSON.stringify(state),result=read(state);
  assert.equal(result[0].opportunity_type,'planned_development');assert.equal(result[0].opportunityLabel,'规划培育');
  assert.equal(result[1].opportunity_type,'constraint');assert.equal(result[1].opportunityLabel,'约束补链');
  assert.equal(JSON.stringify(state),before);
  rows[0].state='pending_review';assert.equal(read(state).length,1);
  rows[0].state='reviewed_inference';rows[0].evidence_ids=['missing'];assert.equal(read(state).length,1);
});
