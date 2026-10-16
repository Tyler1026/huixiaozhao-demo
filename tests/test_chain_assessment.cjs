'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,clone,topic}=require('./chain_v2_fixture.cjs');
function assessment(overrides={}){return {contract:'chain-assessment-v1',state:'ready',level:'unknown',evidence_strength:'insufficient',summary:'基于现有材料，尚需补充核查。',dimensions:['supply','dependency','capacity','coordination'].map(key=>({key,level:'unknown',evidence_strength:'insufficient',findings:[]})),findings:[],next_checks:[],...overrides};}
function judgment(level,overrides={}){return {contract:'chain-judgment-v1',level,basis:'明确材料与本地条件的研判',reason:'结合现有基础，优先核对配套和实施条件。',evidence_ids:['S1'],...overrides};}
function finding(overrides={}){return {id:'f1',target_id:'n1',dimension:'supply',kind:'gap',scope:'local',scope_label:'本地实际条件',quote:'当地关键配套仍存在缺口，需核对建设及投产状态。',evidence_id:'S1',source:{id:'S1',url:'https://official.example/source',title:'地方正式披露',published_at:'2026-09-09T00:00:00.000Z',retrieved_at:'2026-10-16T06:24:43.303057+00:00'},severity:'high',...overrides};}
for(const app of ['index','ops']){
 test(app+' assessment labels use a separate bounded vocabulary and never infer from legacy levels',()=>{
  const {c}=setup(app),labels={weak:'优先补链',attention:'优先补链',supported:'已有基础',unknown:'待研判'};
  for(const [level,label] of Object.entries(labels)){const html=c.chainNodeCardHtml({name:'测试环节',level:'strong',status:'reported',assessment:assessment({level})});assert.ok(html.includes('>'+label+'</span>'));assert.match(html,/材料披露 · 待核/);assert.doesNotMatch(html,/相对完善|>无风险<|本地优势/);}
  for(const value of [undefined,{contract:'old',state:'ready',level:'weak'},assessment({state:'unavailable',level:'weak'})]){const card=c.chainNodeCardHtml({name:'旧环节',level:'weak',assessment:value});assert.match(card,/待研判/);assert.doesNotMatch(card,/优先补链/);}
 });
 test(app+' unknown and plans do not become local weakness, with material strength independently visible',()=>{
  const {c}=setup(app),plan=finding({kind:'plan',quote:'计划补强关键配套，建设尚未完成。'}),industry=finding({id:'f2',scope:'industry',quote:'行业普遍面临配套约束。'});
  const value=assessment({evidence_strength:'multiple_sources',findings:[plan,industry]});
  const card=c.chainNodeCardHtml({name:'计划节点',level:'weak',status:'planned',assessment:value});assert.match(card,/证据不足/);assert.match(card,/多源材料/);assert.match(card,/规划 \/ 计划 · 待核/);assert.doesNotMatch(card,/明显薄弱|本地短板依据/);
  assert.match(card,/规划补强 · 尚未落地/);assert.match(card,/行业背景 · 不代表本地情况/);
  const supported=assessment({level:'supported',evidence_strength:'single_source'});assert.match(c.chainAssessmentBadge(supported),/已有基础/);assert.doesNotMatch(c.chainAssessmentBadge(supported),/单源材料/);assert.match(c.chainAssessmentDetails(supported),/已有支撑.*单源材料/);
 });
 test(app+' chain overview shows four independent dimensions and counts assessed and unassessed nodes',()=>{
  const {c}=setup(app),value=assessment({level:'attention',evidence_strength:'single_source',summary:'关键依赖仍需核查。',dimensions:[{key:'supply',label:'供给能力',level:'supported',evidence_strength:'multiple_sources',findings:[]},{key:'dependency',label:'关键依赖',level:'weak',evidence_strength:'single_source',findings:[]}]});
  const nodes=[{assessment:assessment({level:'weak'})},{assessment:assessment({level:'attention'})},{assessment:assessment({level:'supported'})},{assessment:assessment()},{}];
  const html=c.chainAssessmentPanel(value,nodes);for(const key of ['supply','dependency','capacity','coordination'])assert.ok(html.includes('data-dimension="'+key+'"'));
  assert.match(html,/本次 5 个材料节点/);assert.match(html,/补链研判/);assert.match(html,/以引用材料对应时间为准，不代表实时认证/);assert.match(html,/关键依赖仍需核查/);assert.match(html,/优先补链 <b[^>]*>2<\/b>/);assert.match(html,/待研判 <b[^>]*>2<\/b>/);assert.match(html,/更新研判/);
  const capacity=html.match(/data-dimension="capacity"([\s\S]*?)<\/div><div class="chain-assessment-dimension"/)[1];assert.match(capacity,/尚未评价/);assert.doesNotMatch(capacity,/存在短板/);assert.match(html,/<details class="chain-factual-dimensions"/);
 });
 test(app+' compact assessment criteria remain collapsed and explain all four non-numeric rules',()=>{
  const {c}=setup(app),html=c.chainAssessmentPanel(assessment(),[]);
  const detail=html.match(/<details class="chain-assessment-criteria"([^>]*)>([\s\S]*?)<\/details>/);assert.ok(detail);assert.doesNotMatch(detail[1],/\bopen\b/);
  for(const text of ['三色研判口径','优先补链','重点培育','已有基础','不代表已确认现实缺口或中等能力','待研判','不等于薄弱','非百分制','不按来源数量评分','规划与行业背景不计作已确认的本地短板'])assert.ok(detail[2].includes(text),text);
  assert.ok(html.indexOf('研判依据')<html.indexOf('三色研判口径'));
 });
 test(app+' evidence expansion separates local gaps, capability, plans and industry context with complete quotes',()=>{
  const {c}=setup(app),local=finding(),plan=finding({id:'plan',kind:'plan',quote:'规划配套升级，不能证明已落地。'}),industry=finding({id:'industry',scope:'industry',quote:'行业总体约束，不证明本地存在短板。'}),capability=finding({id:'capability',kind:'capability',quote:'已有配套服务，但不表示能够覆盖全部需求。'});
  const value=assessment({findings:[local,plan,industry,capability],dimensions:[{key:'supply',findings:[local]}],next_checks:['核对产能、投产时间及适用范围。']});
  const html=c.chainAssessmentDetails(value);assert.match(html,/研判依据（4条）/);
  const gaps=html.match(/class="chain-finding-group local_gap"([\s\S]*?)<\/section>/)[1];assert.ok(gaps.includes(local.quote));assert.ok(!gaps.includes(plan.quote));assert.ok(!gaps.includes(industry.quote));assert.match(html,/本地支撑依据/);assert.match(html,/规划补强/);assert.match(html,/行业背景/);
  assert.match(html,/发布：2026-09-09/);assert.equal(c.chainAssessmentDate('2025-09-09T00:00:00Z',false),'2025-09-09');assert.match(c.chainAssessmentFindingHtml(finding({source:{}})),/发布：日期未知/);assert.match(html,/检索：[0-9-]+ [0-9:]+（本地）/);assert.ok(!html.includes('.303057'));assert.match(html,/href="https:\/\/official.example\/source"/);assert.match(html,/核对产能、投产时间及适用范围/);
 });
 test(app+' invalid rating tokens and untrusted labels, summaries, quotes and links cannot escape HTML',()=>{
  const {c}=setup(app),value=assessment({level:'weak" onclick="alert(1)',evidence_strength:'multiple_sources" style="x',summary:'<img src=x onerror=x>',dimensions:[{key:'supply',label:'<script>x</script>',level:'<b>weak</b>'}],findings:[finding({scope_label:'<img src=x>',quote:'<svg onload=x>',source:{url:'javascript:alert(1)',title:'<b>title</b>',published_at:'<i>date</i>'}})],next_checks:['<script>bad</script>']});
  const html=c.chainAssessmentPanel(value,[{assessment:value}]);assert.match(html,/待研判/);assert.match(html,/待补证/);assert.doesNotMatch(html,/<img|<script|<svg|href="javascript|onclick="alert/);assert.match(html,/&lt;img/);assert.match(html,/&lt;svg/);assert.match(html,/&lt;b&gt;title/);
 });
 test(app+' new judgment controls three colors independently from factual evidence and never maps unknown to yellow',()=>{
  const {c}=setup(app),labels={strong:'已有基础',mid:'重点培育',weak:'优先补链',unknown:'待研判'};
  for(const [level,label] of Object.entries(labels)){const value=assessment({level:'unknown',judgment:judgment(level)}),html=c.chainNodeCardHtml({name:'产业环节',level:'strong',status:'planned',assessment:value});assert.ok(html.includes('>'+label+'</span>'));assert.match(html,/规划 \/ 计划/);assert.equal(c.chainAssessmentView(value).level,level);}
  const unresolved=assessment({level:'weak',judgment:judgment('unknown')});assert.equal(c.chainAssessmentView(unresolved).level,'unknown');assert.match(c.chainAssessmentDetails(unresolved),/事实层评价：明显薄弱/);
  assert.equal(c.chainAssessmentView(assessment({level:'unknown'})).level,'unknown');
 });
 test(app+' judgment reason and basis are escaped, sources remain complete and rendering never mutates evidence ids',()=>{
  const {c}=setup(app),value=assessment({judgment:judgment('mid',{reason:'<img src=x onerror=x> 规划培育建议',basis:'<script>bad</script>',evidence_ids:['S1','S1']}),findings:[finding()]});
  const node={name:'中试平台',status:'planned',assessment:value,sources:[{id:'S1',url:'https://official.example/plan',quote:'原文明确这是拟建项目，尚未投产。',published_at:'2025-01-02'}]},before=JSON.stringify(value);
  const html=c.chainNodeCardHtml(node),main=html.split('<details')[0];assert.match(main,/重点培育/);assert.match(main,/依据 1 条/);assert.doesNotMatch(main,/单源材料|多源材料|证据不足/);
  assert.doesNotMatch(html,/<img|<script/);assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);assert.match(html,/研判依据/);assert.match(html,/规划 \/ 计划/);assert.match(html,/原文明确这是拟建项目，尚未投产/);assert.match(html,/发布：2025-01-02/);assert.equal(JSON.stringify(value),before);
 });
 test(app+' main card uses sentence-level judgment basis rather than conflicting paragraph status',()=>{
  const {c}=setup(app),node={name:'卫星制造',status:'planned',assessment:assessment({judgment:judgment('strong',{basis:'local_capability',reason:'原句披露已具备组建及制造基础。'})}),sources:[{id:'S1',url:'https://official.example/capability',quote:'已组建公司，后续规划开展制造。'}]},before=JSON.stringify(node);
  const html=c.chainNodeCardHtml(node),main=html.split('<details')[0];assert.match(main,/已有基础/);assert.match(main,/本地基础/);assert.doesNotMatch(main,/规划培育|规划 \/ 计划/);assert.match(html,/原始材料属性：规划 \/ 计划/);assert.equal(JSON.stringify(node),before);
  for(const [basis,label] of [['local_gap','本地短板'],['local_plan','规划培育'],['industry_risk','行业风险']]){const card=c.chainNodeCardHtml({...node,assessment:assessment({judgment:judgment('mid',{basis})})});assert.ok(card.split('<details')[0].includes(label));}
 });
 test(app+' compact overview counts three action priorities and pending nodes while fact dimensions stay collapsed',()=>{
  const {c}=setup(app),value=assessment({judgment:judgment('mid')}),nodes=['strong','mid','weak','unknown'].map(level=>({assessment:assessment({judgment:judgment(level)})}));
  const html=c.chainAssessmentPanel(value,nodes,1);assert.match(html,/含待归类 1 项/);for(const text of ['已有基础','重点培育','优先补链','待研判'])assert.match(html,new RegExp(text+' <b[^>]*>1<\\/b>'));
  assert.match(html,/黄色表示规划培育或行业风险关注，不代表已确认本地缺口/);assert.match(html,/<details class="chain-factual-dimensions"/);assert.doesNotMatch(html,/<details[^>]*\bopen\b/);
  assert.equal(c.chainNeedsAssessment(nodes,value),false);assert.equal(c.chainNeedsAssessment([{assessment:assessment()}],value),true);assert.equal(c.chainNeedsAssessment(nodes,assessment()),true);assert.equal(c.chainNeedsAssessment([{}],value),true);
 });
 test(app+' malformed new judgment levels cannot become CSS or replace pending with a guessed category',()=>{
  const {c}=setup(app);for(const level of ['mid" onclick="alert(1)','__proto__','orange']){const value=assessment({level:'weak',judgment:judgment(level)}),html=c.chainNodeCardHtml({name:'待判环节',assessment:value});assert.equal(c.chainAssessmentView(value).level,'unknown');assert.equal(c.chainNeedsAssessment([{assessment:value}],value),true);assert.match(html,/judgment-unknown/);assert.doesNotMatch(html,/onclick="alert|judgment-orange|judgment-__proto__/);}
 });
 test(app+' optional assessment survives server persistence and remains compatible with v2 caches',async()=>{
  const e=setup(app),value=assessment({level:'weak',evidence_strength:'single_source',findings:[finding()]});e.setTransform(event=>{event.chain[0].nodes[0].assessment=clone(value);event.evidence.assessment=clone(value);return event;});
  assert.equal(await e.c.requestChainGeneration(),true);assert.deepEqual(clone(e.c.REPORTSTATE.p.chainByTopic[topic][0].nodes[0].assessment),value);assert.deepEqual(clone(e.c.REPORTSTATE.p.chainEvidenceByTopic[topic].assessment),value);assert.ok(e.c.currentEvidenceChain(topic));assert.match(e.c.chainMapHtml(e.c.P()),/明显薄弱/);
  delete e.c.REPORTSTATE.p.chainByTopic[topic][0].nodes[0].assessment;delete e.c.REPORTSTATE.p.chainEvidenceByTopic[topic].assessment;assert.ok(e.c.currentEvidenceChain(topic));const old=e.c.chainMapHtml(e.c.P());assert.match(old,/尚未评价/);assert.match(old,/更新图谱并评价/);
 });
}
