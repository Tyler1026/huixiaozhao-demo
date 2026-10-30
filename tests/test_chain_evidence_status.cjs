'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function setup(side){const source=fs.readFileSync(path.join(__dirname,'../frontend',side,side==='index'?'script-02-sections':'script-03-sections','12-tail.js'),'utf8'),c={URL};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function escapeChainText('),source.indexOf('function chainMapHtml(')),c);return c;}
function node(){const quote='甲企业的电解槽已交付。';return {name:'电解槽',status:'reported',sources:[{id:'S1',url:'https://official.example/material',quote}],facts:[{kind:'source_statement',scope:'source_statement_only',evidence_id:'S1',statement:quote}],assessment:{contract:'chain-assessment-v1',state:'ready',level:'unknown',judgment:{contract:'chain-judgment-v3',level:'unknown',status:'unavailable',reason:'缺少供需比较',evidence_ids:[],missing:['本地采购需求']}}};}
for(const side of ['index','ops']){
 test(side+' unknown remains unrated while bound delivered-product records are visible',()=>{
  const c=setup(side),n=node(),before=JSON.stringify(n),html=c.chainLayoutNodeHtml(n,0);
  assert.match(html,/data-chain-rating="unknown"/);assert.match(html,/尚不能评价/);
  assert.match(html,/已有产品资料/);assert.match(html,/已有交付或运行记录/);assert.match(html,/待补比较依据/);
  assert.equal(c.chainNeedsAssessment([n],n.assessment),true);assert.equal(JSON.stringify(n),before);
  assert.doesNotMatch(html,/data-chain-rating="(?:strong|mid|weak)"/);
 });
 test(side+' planned and industry evidence labels stay separate from actual weakness',()=>{
  const c=setup(side),n=node();n.status='planned';n.sources[0].quote='规划培育电解槽产业。';n.facts[0].statement=n.sources[0].quote;
  n.assessment.findings=[{kind:'gap',scope:'industry',evidence_id:'S1',quote:n.sources[0].quote}];
  const html=c.chainNodeCardHtml(n);assert.match(html,/规划培育材料/);assert.match(html,/行业约束资料/);assert.match(html,/judgment-unknown/);
  assert.doesNotMatch(html,/已有交付或运行记录/);
 });
 test(side+' forged or incomplete records never acquire product or delivery labels',()=>{
  const c=setup(side);
  for(const alter of [n=>n.sources[0].url='javascript:alert(1)',n=>n.facts[0].statement='电解槽已交付但原文没有这句话',n=>n.facts[0].evidence_id='missing',n=>n.sources[0].quote='甲企业正在研发电解槽，并已交付另一个水泵。']){
   const n=node();alter(n);const html=c.chainLayoutNodeHtml(n,0);assert.doesNotMatch(html,/已有交付或运行记录/);assert.match(html,/data-chain-rating="unknown"/);
  }
 });
 test(side+' unknown and unavailable assessments offer an actionable update; completed summaries do not loop',()=>{
  const c=setup(side),n=node();let html=c.chainAssessmentPanel(n.assessment,[n],0);
  assert.match(html,/待评环节：电解槽/);assert.match(html,/onclick="requestChainGeneration\((?:this)?\)"/);assert.match(html,/补查材料并更新评价/);
  n.assessment.judgment={contract:'chain-judgment-v3',level:'strong',status:'assessed',evidence_ids:['S1']};
  const overall={contract:'chain-assessment-v1',state:'ready',judgment:{contract:'chain-judgment-v3',level:'unknown',status:'summary'}};
  assert.equal(c.chainNeedsAssessment([n],overall),false);
  n.assessment.judgment.status='unavailable';assert.equal(c.chainNeedsAssessment([n],overall),true);
 });
}
