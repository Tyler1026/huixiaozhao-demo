'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,topic}=require('./chain_v2_fixture.cjs');
for(const app of ['index','ops']){
 test(app+' empty results disclose insufficient materials and permit regeneration without false strength legends',async()=>{
  const e=setup(app);e.setTransform(event=>{event.chain=['上游','中游','下游'].map(seg=>({seg,nodes:[]}));event.status='empty';return event;});await e.c.requestChainGeneration();
  const html=e.c.chainMapHtml(e.c.P());assert.equal(e.c.REPORTSTATE.p.chainStatusByTopic[topic],'empty');assert.equal((html.match(/资料待补/g)||[]).length,3);assert.match(html,/不能据此判断/);assert.match(html,/更新图谱并评价/);assert.doesNotMatch(html,/材料称优势|材料称培育|材料称薄弱/);
 });
 test(app+' unknown nodes use only a pending legend and parallel cards without inferred edges',async()=>{
  const e=setup(app);e.setTransform(event=>{event.chain[0].nodes.push({name:'重要耗材',level:'unknown',status:'reported'});return event;});await e.c.requestChainGeneration();const html=e.c.chainMapHtml(e.c.P());assert.match(html,/待核/);assert.doesNotMatch(html,/→|本地优势|培育中|材料称优势|材料称薄弱/);assert.match(html,/不代表已证实的供应或工序连接/);assert.match(html,/公开分类依据，不表示本地已有能力/);
 });
 test(app+' planned, negated and reported wording stays distinct from verification',async()=>{
  const e=setup(app);e.setTransform(event=>{event.chain[0].nodes=[{name:'拟建环节',level:'strong',status:'planned'},{name:'否定项',level:'strong',status:'reported',negated:true},{name:'材料已提及',level:'unknown',status:'reported'}];return event;});await e.c.requestChainGeneration();const html=e.c.chainMapHtml(e.c.P());assert.match(html,/规划 \/ 计划/);assert.match(html,/否定或排除表述/);assert.match(html,/材料披露/);assert.match(html,/未独立核实/);assert.doesNotMatch(html,/材料称优势/);
 });
 test(app+' unclassified items stay separate and complete source quotes remain expandable',async()=>{
  const e=setup(app),url='https://official.example/very/long/path?item=1';e.setTransform(event=>{event.unclassified=[{name:'跨界材料项',level:'unknown',status:'reported',note:'材料介绍 [官方来源]('+url+')',classification:{reason:'现有信息不足以判断上中下游'},sources:[{id:'S2',url,quote:'完整原文，不得截断。'.repeat(30),title:'正式披露'}]}];return event;});await e.c.requestChainGeneration();const html=e.c.chainMapHtml(e.c.P());assert.match(html,/尚未分类的材料项/);assert.match(html,/现有信息不足以判断上中下游/);assert.match(html,/<details class="industry-chain-sources"/);assert.ok(html.includes('完整原文，不得截断。'.repeat(30)));const node=e.c.chainNodeCardHtml(e.c.REPORTSTATE.p.chainUnclassifiedByTopic[topic][0]);assert.ok(!node.split('<details')[0].includes(url));assert.ok(node.includes('href="'+url+'"'));
 });
 test(app+' compact cards show status and sources while shared qualifications appear only in the header',()=>{
  const e=setup(app),generic='按通用产业链口径分类，不代表本地已具备能力。',note='保留来源原文和限定；分类为分析口径，不代表本地能力、强弱或投资意向。';
  const node={name:'代表环节',status:'reported',level:'unknown',note,classification:{lane:'上游',reason:generic},sources:[{url:'https://official.example/source',quote:'原文内容保留完整。'}]};
  const card=e.c.chainNodeCardHtml(node);assert.match(card,/材料披露 · 待核/);assert.match(card,/查看原文与来源/);assert.ok(!card.includes(generic));assert.ok(!card.includes(note));
  const html=e.c._renderRichChain(topic,[{seg:'上游',nodes:Array.from({length:30},()=>node)}],null,e.c.P(),[],'partial',{});
  assert.equal((html.match(/本次资料中的代表环节，非完整行业清单/g)||[]).length,1);assert.equal((html.match(/内容未独立核实/g)||[]).length,1);
 });
 test(app+' title, node name and classification text are escaped and credential links are discarded',async()=>{
  const e=setup(app);const html=e.c._renderRichChain('<img src=x onerror=alert(1)>',[{seg:'上游',nodes:[{name:'<script>x</script>',level:'bad" onclick="x',classification:{reason:'<b>raw</b>'},sources:[{url:'https://user:pass@example.com/a',quote:'<img src=x>'}]}]}],null,e.c.P(),[],'partial',{});assert.doesNotMatch(html,/<script>|<img|<b>|href="https:\/\/user/);assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);assert.match(html,/&lt;b&gt;/);
 });
}
