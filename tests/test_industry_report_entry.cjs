'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fn}=require('./chain_v2_fixture.cjs');
for(const side of ['index','ops']){
 const source=fs.readFileSync(path.join(__dirname,'../frontend',side,side==='index'?'script-02-sections':'script-03-sections','12-tail.js'),'utf8');
 test(side+' both report phases retain a graph entry using only their current text',()=>{
  for(const phase of [1,2]){
   const c={cur:'p',REPORTSTATE:{p:{topic:'当前方向',phase,aiReportByTopic:{'当前方向':'原始研判材料'.repeat(30)}}},reportHtml:()=>'<article>报告</article>',chainMapHtml:()=>'<section>当前图谱</section>',restoreActionItems:()=>'<aside>研判建议</aside>',restoreConfirmPanel:()=>'<div>确认事项</div>'};vm.createContext(c);vm.runInContext(fn(source,'industrySavedReportHtml'),c);
   assert.match(c.industrySavedReportHtml({topic:'当前方向'}),/id="chainMapBlock"/);
   assert.doesNotMatch(c.industrySavedReportHtml({topic:'另一个没有报告的方向'}),/id="chainMapBlock"/);
  }
 });
 test(side+' saved topic catalog retains all directions without generated city placeholders',()=>{
  const c={};vm.createContext(c);vm.runInContext(fn(source,'generateTopicsFromKb'),c);
  const topics=Array.from({length:7},(_,i)=>({label:'材料方向'+i,desc:'来源摘要'+i}));
  assert.equal(c.generateTopicsFromKb({city:'城市',kb:[],aiTopics:{list:topics}}).length,7);
  assert.equal(c.generateTopicsFromKb({city:'城市',kb:[{known:['一般材料']}]}).length,0);
  assert.deepEqual(Array.from(c.generateTopicsFromKb({aiTopics:{list:topics},deletedTopics:['材料方向2'],customTopics:['人工输入','人工输入']}),x=>x.label),['材料方向0','材料方向1','材料方向3','材料方向4','材料方向5','材料方向6','人工输入']);
 });
 test(side+' every reviewed suggestion exposes its own distinct submission action',()=>{
  const project={topic:'产业主题'};const c={cur:'p',PROJECTS:{p:project},P:()=>project,REPORTSTATE:{p:{}},demandReportSnapshot:()=>({}),_findExistingDemand:()=>null,reportDemandActionButton:()=>'<button>提交</button>',escapeChainText:s=>String(s).replace(/</g,'&lt;'),chainNodeSources:n=>n.sources,chainLayoutSourceHtml:s=>'<blockquote>'+s.quote+'</blockquote>',reportAnalyticalPriorities:()=>['材料甲','设备乙'].map((focus,index)=>({focus,scope:'industry',scopeLabel:'行业共性',opportunity_type:index?'planned_development':'constraint',reason:'有来源的分析',action:'先确认接口，再组织样品测试',comparison:'具备现有产品基础，尚需验证应用条件',sources:[{quote:'原句'}]}))};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/shared/industry-demands.js'),'utf8')+'\n'+fn(source,'restoreActionItems'),c);
  const html=c.restoreActionItems();assert.equal((html.match(/class="industry-priority-card"/g)||[]).length,2);assert.match(html,/材料甲/);assert.match(html,/设备乙/);assert.equal((html.match(/>形成招商需求<\/button>/g)||[]).length,2);assert.equal((html.match(/data-demand-priority=/g)||[]).length,2);assert.match(html,/每条建议独立形成需求/);assert.doesNotMatch(html,/<button>提交<\/button>/);
  assert.match(html,/规划培育/);assert.match(html,/约束补链/);assert.match(html,/现有基础与条件/);assert.match(html,/推进路径/);assert.match(html,/先确认接口，再组织样品测试/);assert.match(html,/不表示本地存在现实供给缺口/);
  c.reportAnalyticalPriorities=()=>[];assert.doesNotMatch(c.restoreActionItems(),/class="industry-priority-card"/);assert.match(c.restoreActionItems(),/尚未形成/);
 });
}
