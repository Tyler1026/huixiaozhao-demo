'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,clone,topic}=require('./chain_v2_fixture.cjs');
function assessment(overrides={}){return {contract:'chain-assessment-v1',state:'ready',level:'unknown',evidence_strength:'insufficient',summary:'基于现有材料，尚需补充核查。',dimensions:['supply','dependency','capacity','coordination'].map(key=>({key,level:'unknown',evidence_strength:'insufficient',findings:[]})),findings:[],next_checks:[],...overrides};}
function finding(overrides={}){return {id:'f1',target_id:'n1',dimension:'supply',kind:'gap',scope:'local',scope_label:'本地实际条件',quote:'当地关键配套仍存在缺口，需核对建设及投产状态。',evidence_id:'S1',source:{id:'S1',url:'https://official.example/source',title:'地方正式披露',published_at:'2026-09-09T00:00:00.000Z',retrieved_at:'2026-10-16T06:24:43.303057+00:00'},severity:'high',...overrides};}
for(const app of ['index','ops']){
 test(app+' assessment labels use a separate bounded vocabulary and never infer from legacy levels',()=>{
  const {c}=setup(app),labels={weak:'明显薄弱',attention:'存在短板',supported:'已有支撑',unknown:'证据不足'};
  for(const [level,label] of Object.entries(labels)){const html=c.chainNodeCardHtml({name:'测试环节',level:'strong',status:'reported',assessment:assessment({level})});assert.ok(html.includes('>'+label+'</span>'));assert.match(html,/材料披露 · 待核/);assert.doesNotMatch(html,/相对完善|>无风险<|本地优势/);}
  for(const value of [undefined,{contract:'old',state:'ready',level:'weak'},assessment({state:'unavailable',level:'weak'})]){const card=c.chainNodeCardHtml({name:'旧环节',level:'weak',assessment:value});assert.match(card,/尚未评价/);assert.doesNotMatch(card,/明显薄弱/);}
 });
 test(app+' unknown and plans do not become local weakness, with material strength independently visible',()=>{
  const {c}=setup(app),plan=finding({kind:'plan',quote:'计划补强关键配套，建设尚未完成。'}),industry=finding({id:'f2',scope:'industry',quote:'行业普遍面临配套约束。'});
  const value=assessment({evidence_strength:'multiple_sources',findings:[plan,industry]});
  const card=c.chainNodeCardHtml({name:'计划节点',level:'weak',status:'planned',assessment:value});assert.match(card,/证据不足/);assert.match(card,/多源材料/);assert.match(card,/规划 \/ 计划 · 待核/);assert.doesNotMatch(card,/明显薄弱|本地短板依据/);
  assert.match(card,/规划补强 · 尚未落地/);assert.match(card,/行业背景 · 不代表本地情况/);
  assert.match(c.chainAssessmentBadge(assessment({level:'supported',evidence_strength:'single_source'})),/已有支撑.*单源材料/);
 });
 test(app+' chain overview shows four independent dimensions and counts assessed and unassessed nodes',()=>{
  const {c}=setup(app),value=assessment({level:'attention',evidence_strength:'single_source',summary:'关键依赖仍需核查。',dimensions:[{key:'supply',label:'供给能力',level:'supported',evidence_strength:'multiple_sources',findings:[]},{key:'dependency',label:'关键依赖',level:'weak',evidence_strength:'single_source',findings:[]}]});
  const nodes=[{assessment:assessment({level:'weak'})},{assessment:assessment({level:'attention'})},{assessment:assessment({level:'supported'})},{assessment:assessment()},{}];
  const html=c.chainAssessmentPanel(value,nodes);for(const key of ['supply','dependency','capacity','coordination'])assert.ok(html.includes('data-dimension="'+key+'"'));
  assert.match(html,/本次 5 个节点/);assert.match(html,/资料披露的薄弱线索与支撑/);assert.match(html,/以引用材料对应时间为准，不代表实时认证/);assert.match(html,/关键依赖仍需核查/);assert.match(html,/明显薄弱 <b[^>]*>1<\/b>/);assert.match(html,/尚未评价 <b[^>]*>1<\/b>/);assert.match(html,/更新图谱并评价/);
  const capacity=html.match(/data-dimension="capacity"([\s\S]*?)<\/div><div class="chain-assessment-dimension"/)[1];assert.match(capacity,/尚未评价/);assert.doesNotMatch(capacity,/存在短板/);
 });
 test(app+' evidence expansion separates local gaps, capability, plans and industry context with complete quotes',()=>{
  const {c}=setup(app),local=finding(),plan=finding({id:'plan',kind:'plan',quote:'规划配套升级，不能证明已落地。'}),industry=finding({id:'industry',scope:'industry',quote:'行业总体约束，不证明本地存在短板。'}),capability=finding({id:'capability',kind:'capability',quote:'已有配套服务，但不表示能够覆盖全部需求。'});
  const value=assessment({findings:[local,plan,industry,capability],dimensions:[{key:'supply',findings:[local]}],next_checks:['核对产能、投产时间及适用范围。']});
  const html=c.chainAssessmentDetails(value);assert.match(html,/评价依据（4条）/);
  const gaps=html.match(/class="chain-finding-group local_gap"([\s\S]*?)<\/section>/)[1];assert.ok(gaps.includes(local.quote));assert.ok(!gaps.includes(plan.quote));assert.ok(!gaps.includes(industry.quote));assert.match(html,/本地支撑依据/);assert.match(html,/规划补强/);assert.match(html,/行业背景/);
  assert.match(html,/发布：2026-09-09/);assert.equal(c.chainAssessmentDate('2025-09-09T00:00:00Z',false),'2025-09-09');assert.match(c.chainAssessmentFindingHtml(finding({source:{}})),/发布：日期未知/);assert.match(html,/检索：[0-9-]+ [0-9:]+（本地）/);assert.ok(!html.includes('.303057'));assert.match(html,/href="https:\/\/official.example\/source"/);assert.match(html,/核对产能、投产时间及适用范围/);
 });
 test(app+' invalid rating tokens and untrusted labels, summaries, quotes and links cannot escape HTML',()=>{
  const {c}=setup(app),value=assessment({level:'weak" onclick="alert(1)',evidence_strength:'multiple_sources" style="x',summary:'<img src=x onerror=x>',dimensions:[{key:'supply',label:'<script>x</script>',level:'<b>weak</b>'}],findings:[finding({scope_label:'<img src=x>',quote:'<svg onload=x>',source:{url:'javascript:alert(1)',title:'<b>title</b>',published_at:'<i>date</i>'}})],next_checks:['<script>bad</script>']});
  const html=c.chainAssessmentPanel(value,[{assessment:value}]);assert.match(html,/证据不足/);assert.match(html,/待补证/);assert.doesNotMatch(html,/<img|<script|<svg|href="javascript|onclick="alert/);assert.match(html,/&lt;img/);assert.match(html,/&lt;svg/);assert.match(html,/&lt;b&gt;title/);
 });
 test(app+' optional assessment survives server persistence and remains compatible with v2 caches',async()=>{
  const e=setup(app),value=assessment({level:'weak',evidence_strength:'single_source',findings:[finding()]});e.setTransform(event=>{event.chain[0].nodes[0].assessment=clone(value);event.evidence.assessment=clone(value);return event;});
  assert.equal(await e.c.requestChainGeneration(),true);assert.deepEqual(clone(e.c.REPORTSTATE.p.chainByTopic[topic][0].nodes[0].assessment),value);assert.deepEqual(clone(e.c.REPORTSTATE.p.chainEvidenceByTopic[topic].assessment),value);assert.ok(e.c.currentEvidenceChain(topic));assert.match(e.c.chainMapHtml(e.c.P()),/明显薄弱/);
  delete e.c.REPORTSTATE.p.chainByTopic[topic][0].nodes[0].assessment;delete e.c.REPORTSTATE.p.chainEvidenceByTopic[topic].assessment;assert.ok(e.c.currentEvidenceChain(topic));const old=e.c.chainMapHtml(e.c.P());assert.match(old,/尚未评价/);assert.match(old,/更新图谱并评价/);
 });
}
