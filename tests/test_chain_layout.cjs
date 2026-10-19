'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(side){
 const f=side==='index'?'script-02-sections':'script-03-sections',s=fs.readFileSync(path.join(__dirname,'../frontend',side,f,'12-tail.js'),'utf8');
 const c={URL};vm.createContext(c);vm.runInContext(s.slice(s.indexOf('function escapeChainText('),s.indexOf('function chainMapHtml(')),c);return c;
}
const clone=value=>JSON.parse(JSON.stringify(value));
const source={id:'S1',url:'https://official.example/source',title:'试飞基地运行记录',published_at:'2026-05-06',quote:'闵行区试飞基地已正式启动运营。'};
function node(level='unknown',status='planned'){
 return {name:'试飞基地',status,sources:[clone(source),clone(source)],assessment:{contract:'chain-assessment-v1',state:'ready',level:'unknown',judgment:{contract:'chain-judgment-v3',status:level==='unknown'?'pending':'assessed',level,scope:'local',reason:'原文依据',premises:level==='unknown'?[]:[{evidence_id:'S1',role:'operation',subject:'试飞基地',statement:source.quote,quote:source.quote,source:clone(source)}],evidence_ids:['S1'],missing:['供应商及采购情况']}}};
}
function companyNode(){
 const n=node('strong','unverified'),s={id:'C1',url:'https://official.example/company',title:'企业设施记录',published_at:'2026-07-02',quote:'甲科技有限公司位于闵行区。甲科技有限公司已建成卫星激光通信终端产线。'};
 n.name='卫星激光通信终端产线';n.sources=[s];
 n.assessment.judgment={...n.assessment.judgment,scope:'local_enterprise',evidence_ids:['C1'],premises:[
  {evidence_id:'C1',role:'local_affiliation',subject:'甲科技有限公司',statement:'甲科技有限公司位于闵行区。',quote:s.quote,source:clone(s)},
  {evidence_id:'C1',role:'operation',subject:n.name,statement:'甲科技有限公司已建成卫星激光通信终端产线。',quote:s.quote,source:clone(s)}
 ],enterprise_links:[{company_subject:'甲科技有限公司',presence_evidence_id:'C1',capability_evidence_id:'C1',relation:'explicit_local_affiliation',identity_url:s.url,business_url:s.url}]};
 return n;
}
function fakeView(c,key){
 const panels=['layout','assessment'].map(name=>({getAttribute:()=>name,hidden:name==='assessment'}));
 const tabs=panels.map(p=>({getAttribute:p.getAttribute,classList:{toggle(k,v){this.active=v;}},setAttribute(k,v){this[k]=v;}}));
 const root={getAttribute:k=>k==='data-chain-key'?key:null,setAttribute(k,v){this[k]=v;},querySelector:()=>null,querySelectorAll:q=>q==='[data-chain-panel]'?panels:tabs};
 return {panels,tabs,root,button:{closest:()=>root}};
}
function portalFixture(c){
 function append(parent,child){if(child.parentNode){const old=child.parentNode.children;old.splice(old.indexOf(child),1);}parent.children.push(child);child.parentNode=parent;return child;}
 if(!c.document){
  const body={children:[],appendChild(child){return append(this,child);}};c.document={body};c._observers=[];
  c.MutationObserver=class {constructor(callback){this.callback=callback;c._observers.push(this);}observe(){this.active=true;}disconnect(){this.active=false;}fire(){if(this.active)this.callback();}};
 }
 const content={},close={focus(){this.focused=true;}},drawer={hidden:true,children:[],closest(){return this;},querySelector:q=>q==='button'?close:content,remove(){const a=this.parentNode.children;a.splice(a.indexOf(this),1);this.parentNode=null;}};
 const root={isConnected:true,children:[],appendChild(child){return append(this,child);},getAttribute:()=>null,setAttribute(){},querySelector:q=>q.startsWith('template')?{innerHTML:'<p>原文</p>'}:root.children.includes(drawer)?drawer:null,querySelectorAll:()=>[]};
 const button={isConnected:true,closest:()=>root,setAttribute(k,v){this[k]=v;},classList:{add(){this.selected=true;},remove(){this.selected=false;}},focus(){this.focused=true;}};
 root.appendChild(drawer);c.document.body.appendChild(root);
 return {root,drawer,button,content,close,body:c.document.body,observer:()=>c._observers[c._observers.length-1]};
}
for(const side of ['index','ops']){
 test(side+' layout counts actual records without mutating sources or assessment',()=>{
  const c=setup(side),groups=[{seg:'上游',nodes:[node()]},{seg:'中游',nodes:[node('strong')]},{seg:'下游',nodes:[]}],before=JSON.stringify(groups);
  const html=c.chainExplorerHtml('测试产业',groups,null,{},[],'partial',{});
  assert.match(html,/data-chain-mode="layout"/);assert.match(html,/data-chain-panel="assessment" hidden/);
  assert.equal((html.match(/class="chain-layout-node(?: |")/g)||[]).length,2);
  assert.match(html,/>2<\/strong><span>有原文的节点/);assert.match(html,/>1<\/strong><span>具备评价依据/);
  assert.match(html,/已有现状依据/);assert.match(html,/含规划线索/);assert.doesNotMatch(html,/企业 0 家|独立核实 2|未命名材料项/);
  assert.equal(JSON.stringify(groups),before);assert.equal(c.chainLayoutInfo(node('strong')).count,1);
 });
 test(side+' layout keeps textual green yellow red ratings only for source-bound reviewed nodes',()=>{
  const c=setup(side),labels={strong:'已有支撑',mid:'存在短板',weak:'明显薄弱',unknown:'尚不能评价'};
  for(const [level,label] of Object.entries(labels)){
   const n=node(level,'reported'),before=JSON.stringify(n),html=c.chainLayoutNodeHtml(n,0);
   assert.match(html,new RegExp('data-chain-rating="'+level+'"'));
   assert.ok(html.includes('<span class="chain-layout-rating">'+label+'</span>'));
   assert.ok(html.includes('薄弱评价：'+label));assert.equal(JSON.stringify(n),before);
  }
 });
 test(side+' stored ratings cannot color unreviewed or mismatched evidence',()=>{
  const c=setup(side),cases=[];
  let n=node('weak');n.assessment.judgment.status='pending';cases.push(n);
  n=node('mid');n.assessment.judgment.premises=[];cases.push(n);
  n=node('strong');n.assessment.judgment.premises[0].source.id='FORGED';cases.push(n);
  n=node('strong');n.assessment.judgment.premises[0].statement='原文没有这句话';cases.push(n);
  n=node('weak');n.assessment.judgment.premises[0].role='policy_target';cases.push(n);
  n=node('mid');n.assessment.judgment.premises[0].source.url='javascript:alert(1)';cases.push(n);
  n=node('strong');n.name='另一个完全无关的环节';cases.push(n);
  n=node('strong');n.assessment.judgment.contract='chain-judgment-v2';cases.push(n);
  for(const value of cases){
   const before=JSON.stringify(value),html=c.chainLayoutNodeHtml(value,0);
   assert.equal(c.chainLayoutInfo(value).assessed,false);
   assert.match(html,/data-chain-rating="unknown"/);assert.match(html,/>尚不能评价<\/span>/);
   assert.doesNotMatch(html,/data-chain-rating="(?:strong|mid|weak)"/);assert.equal(JSON.stringify(value),before);
  }
 });
 test(side+' current archived reviewed nodes retain their real ratings including paragraph references',()=>{
  const c=setup(side),fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/chain_layout_reviewed_sources_20261017.json'),'utf8'));
  assert.equal(fixture.nodes.length,4);
  for(const value of fixture.nodes){
   const before=JSON.stringify(value),level=value.assessment.judgment.level,info=c.chainLayoutInfo(value),html=c.chainLayoutNodeHtml(value,0);
   assert.equal(info.assessed,true,value.name);assert.equal(info.ratingLevel,level,value.name);
   assert.match(html,new RegExp('data-chain-rating="'+level+'"'));assert.ok(info.count>0);assert.equal(JSON.stringify(value),before);
  }
 });
 test(side+' only nonempty quotations with safe URLs count as original evidence',()=>{
  const c=setup(side),n=node();n.sources=[{id:'empty'},{id:'blank',url:source.url,quote:'  '},{id:'unsafe',url:'javascript:alert(1)',quote:'真实片段'},{id:'credentials',url:'https://user:pass@example.org',quote:'片段'}];
  const info=c.chainLayoutInfo(n),html=c.chainLayoutNodeHtml(n,0);
  assert.equal(info.count,0);assert.equal(info.label,'含规划线索');assert.doesNotMatch(html,/原文片段 [1-9]/);
  const groups=[{seg:'上游',nodes:[n]}];assert.match(c.chainExplorerHtml('方向',groups,null,{},[],'partial',{}),/>0<\/strong><span>有原文的节点/);
  const detail=c.chainLayoutDetailHtml(n,0);assert.match(detail,/来源不完整的材料片段/);assert.doesNotMatch(detail,/href="javascript|user:pass/);
 });
 test(side+' reviewed enterprise links expose only their bound company and original stage',()=>{
  const c=setup(side),n=companyNode(),before=JSON.stringify(n),info=c.chainLayoutInfo(n),html=c.chainLayoutNodeHtml(n,0);
  assert.deepEqual(Array.from(info.companies),['甲科技有限公司']);assert.equal(info.excerpt,'甲科技有限公司已建成卫星激光通信终端产线。');
  for(const text of ['关联企业：甲科技有限公司','2026-07-02','已建成卫星激光通信终端产线','不代表本地产能'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/已量产|本地产线已投产/);assert.equal(JSON.stringify(n),before);
 });
 test(side+' product and identity evidence cannot be reassigned to another subject',()=>{
  const c=setup(side),n=companyNode(),j=n.assessment.judgment;
  const full='甲科技有限公司位于闵行区。甲科技有限公司正在研制卫星激光通信终端产线。乙设备有限公司的水泵已交付。';
  n.sources[0].quote=full;j.premises.forEach(p=>{p.quote=full;p.source.quote=full;});
  j.premises[1].subject='水泵';j.premises[1].statement='乙设备有限公司的水泵已交付。';
  const info=c.chainLayoutInfo(n),html=c.chainLayoutNodeHtml(n,0);
  assert.equal(info.companies.length,0);assert.equal(info.excerpt,full);assert.doesNotMatch(html,/关联企业：/);
  j.premises[1].statement='甲科技有限公司正在研制卫星激光通信终端产线。';
  j.enterprise_links[0].company_subject='丙公司';assert.equal(c.chainLayoutInfo(n).companies.length,0);
 });
 test(side+' unreviewed or mismatched source IDs never supply enterprise facts',()=>{
  const c=setup(side),n=companyNode(),j=n.assessment.judgment;
  j.premises[1].source.id='FORGED';assert.equal(c.chainLayoutInfo(n).companies.length,0);
  j.premises[1].source.id='C1';j.premises[1].statement='甲科技有限公司已量产火箭。';assert.equal(c.chainLayoutInfo(n).companies.length,0);
  j.premises[1].statement='甲科技有限公司已建成卫星激光通信终端产线。';j.status='pending';
  assert.equal(c.chainLayoutInfo(n).companies.length,0);assert.equal(c.chainLayoutInfo(n).assessed,false);
 });
 test(side+' source-only nodes show quoted material without invented company or maturity',()=>{
  const c=setup(side),n=node(),info=c.chainLayoutInfo(n),html=c.chainLayoutNodeHtml(n,0);
  assert.equal(info.excerpt,source.quote);assert.equal(info.label,'含规划线索');assert.match(html,/原文/);assert.match(html,/2026-05-06/);
  assert.doesNotMatch(html,/关联企业：|已认证|本地量产|预计产能/);
 });
 test(side+' long source excerpts center the literal node while drawer retains the full quote',()=>{
  const c=setup(side),prefix='规划方案的其他事项。'.repeat(30),middle='相关配套材料。'.repeat(25),tail='其余内容仍应按完整原文核对。'.repeat(15);
  const quote=prefix+'计划研发火箭发动机。'+middle+'规划配置航电控制系统。'+tail;
  const first=c.chainLayoutExcerpt(quote,'火箭发动机'),second=c.chainLayoutExcerpt(quote,'航电控制系统');
  assert.match(first,/火箭发动机/);assert.match(second,/航电控制系统/);assert.notEqual(first,second);assert.ok(first.startsWith('…')&&first.endsWith('…'));assert.ok(first.indexOf('火箭发动机')<20);
  const n=node();n.name='航电控制系统';n.sources=[{...source,quote}];const before=JSON.stringify(n),card=c.chainLayoutNodeHtml(n,0),detail=c.chainLayoutDetailHtml(n,0);
  assert.match(card,/原文节选/);assert.ok(!card.includes(prefix));assert.ok(detail.includes(quote));assert.equal(JSON.stringify(n),before);
 });
 test(side+' excerpt typography matching preserves the original spelling and never invents text',()=>{
  const c=setup(side),text='其他事项。'.repeat(30)+'计划开展ｅＶＴＯＬ测试，实际交付仍待确认。'+'后续条款。'.repeat(30);
  const excerpt=c.chainLayoutExcerpt(text,'eVTOL');assert.ok(excerpt.includes('ｅＶＴＯＬ'));assert.ok(!excerpt.includes('eVTOL'));
  const short='试飞基地已启动。';assert.equal(c.chainLayoutExcerpt(short,'试飞基地'),short);assert.equal(c.chainLayoutExcerpt(short,'火箭发动机'),'');
 });
 test(side+' server source statements require the same valid source and do not upgrade ratings',()=>{
  const c=setup(side),n=node(),extra={id:'S2',url:'https://official.example/new',quote:'试飞基地已有实际运行记录。',published_at:'2026-06-02'};
  n.sources.push(extra);n.facts=[{kind:'source_statement',scope:'source_statement_only',evidence_id:'S2',statement:extra.quote,published_at:'2026-06-02'}];
  const before=JSON.stringify(n);assert.equal(c.chainLayoutInfo(n).excerpt,extra.quote);assert.equal(c.chainLayoutInfo(n).date,'2026-06-02');assert.equal(c.chainLayoutInfo(n).assessed,false);assert.equal(JSON.stringify(n),before);
  n.facts[0].evidence_id='FORGED';assert.equal(c.chainLayoutInfo(n).excerpt,source.quote);
  n.facts[0].evidence_id='S2';n.facts[0].statement='试飞基地已量产。';assert.equal(c.chainLayoutInfo(n).excerpt,source.quote);
 });
 test(side+' reviewed same-paragraph reference keeps full original context over an older plan',()=>{
  const c=setup(side),n=node('strong'),s={id:'S2',url:'https://official.example/actual',quote:'试飞基地已正式启动。这一基地已落地运营。',published_at:'2026-06-02'};
  n.sources[0].quote='试飞基地计划扩建。';n.sources=n.sources.slice(0,1);
  n.assessment.judgment.evidence_ids=['S2'];n.assessment.judgment.premises=[{evidence_id:'S2',role:'operation',subject:'这一基地',statement:'这一基地已落地运营。',quote:s.quote,source:s}];
  assert.equal(c.chainLayoutInfo(n).excerpt,s.quote);assert.equal(c.chainLayoutInfo(n).date,'2026-06-02');
  assert.match(c.chainLayoutDetailHtml(n,0),/原始材料含规划表述/);
 });
 test(side+' PDF page and excerpt scope survive source mapping and are displayed safely',()=>{
  const c=setup(side),n=node();n.sources=[{...source,pdf_page:33,fulltext_scope:'PDF pages 33–34',quote_range:'第2段'}];
  const row=c.chainNodeSources(n)[0],html=c.chainLayoutDetailHtml(n,0);
  assert.equal(row.pdfPage,33);assert.equal(row.quoteRange,'第2段');assert.match(html,/PDF 页码：33/);assert.match(html,/PDF pages 33–34/);assert.match(html,/摘录范围：第2段/);
  n.sources[0].quote_range='<img src=x>';assert.doesNotMatch(c.chainLayoutDetailHtml(n,0),/<img/);
 });
 test(side+' drawer opens on original text and retains distinct raw qualifications',()=>{
  const c=setup(side),n=node('strong');n.negated=true;n.qualifiers=['计划扩建'];
  const html=c.chainLayoutDetailHtml(n,0),sourceAt=html.indexOf('<section class="chain-layout-originals">'),foldAt=html.indexOf('<details');
  assert.ok(sourceAt>=0&&sourceAt<foldAt);assert.ok(html.indexOf(source.quote,sourceAt)<foldAt);assert.ok(html.indexOf('打开原文来源',sourceAt)<foldAt);
  assert.match(html,/原始材料含否定或排除表述/);assert.match(html,/计划扩建/);assert.match(html,/已有现状依据/);
 });
 test(side+' source dates and metadata are escaped without changing source text',()=>{
  const c=setup(side),n=node();n.name='<img onerror=x>';n.sources=[{id:'x',url:source.url,quote:'<script>bad</script>',published_at:'<img src=x onerror=x>'}];
  const before=JSON.stringify(n),html=c.chainLayoutDetailHtml(n,0)+c.chainLayoutNodeHtml(n,0);
  assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);assert.doesNotMatch(html,/<img|<script/);assert.equal(JSON.stringify(n),before);
  const metadata=c.chainLayoutMetaHtml({taxonomy:{label:'<svg>',description:'<img>'},coverage:{meaning:'<script>'},researchStatus:'pending',generatedAt:NaN},'partial',1,0);
  assert.match(metadata,/&lt;svg/);assert.match(metadata,/&lt;img/);assert.doesNotMatch(metadata,/<img|<svg|<script|Invalid Date/);
 });
 test(side+' layout reports coverage research status generation time and taxonomy',()=>{
  const c=setup(side),e={researchStatus:'partial',generatedAt:Date.parse('2026-10-17T08:00:00Z'),taxonomy:{label:'航天',description:'下游含终端产品与运营服务。'},coverage:{status:'partial',meaning:'仅反映本次原文覆盖。'}};
  const html=c.chainExplorerHtml('方向',[{seg:'上游',nodes:[node()]}],null,{},[],'partial',e);
  for(const text of ['部分材料已归类','本轮检索不完整','2026-10-17','当前方向','不是完整产业清单','下游含终端产品与运营服务','仅反映本次原文覆盖'])assert.ok(html.includes(text),text);
  assert.ok(html.indexOf('分类口径（航天）')<html.indexOf('data-chain-panel="layout"'));
 });
 test(side+' incomplete supplementary checks remain visible after successful base research',()=>{
  const c=setup(side),e={researchStatus:'ready',nodeResearch:{status:'partial',errors:[{code:'failed',message:'该组补查未完成。'}],batches:[{status:'ready'},{status:'unavailable'},{legacy_summary:true,status:'partial'}]}};
  const before=JSON.stringify(e),html=c.chainLayoutMetaHtml(e,'partial',2,0);
  for(const text of ['基础检索完成','补充核验未完整','未完成 1 组','错误记录 1 条','该组补查未完成'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/本轮检索完成|补充核验完成/);assert.equal(JSON.stringify(e),before);
 });
 test(side+' supplementary scope errors are escaped and absent arrays do not invent counts',()=>{
  const c=setup(side),html=c.chainLayoutMetaHtml({researchStatus:'ready',nodeResearch:{status:'scope_mismatch',errors:[{message:'<img src=x onerror=x>'}]}},'partial',1,0);
  assert.match(html,/材料范围不一致/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|未完成 [0-9]+ 组/);
  const unknown=c.chainLayoutMetaHtml({researchStatus:'ready',nodeResearch:{status:'pending'}},'partial',1,0);
  assert.match(unknown,/补充核验未完整/);assert.doesNotMatch(unknown,/错误记录 [0-9]+ 条|未完成 [0-9]+ 组/);
  const absent=c.chainLayoutMetaHtml({researchStatus:'ready',nodeResearch:{}},'partial',1,0);
  assert.doesNotMatch(absent,/补充核验|错误记录 [0-9]+ 条|未完成 [0-9]+ 组/);
 });
 test(side+' view choice survives render within one workspace and closes stale drawers',()=>{
  const c=setup(side),e={runId:'r1'},p={id:'p1'},key=c.chainExplorerKey('方向',p,e),view=fakeView(c,key);
  let focused=0,removed=0;const trigger={setAttribute(k,v){this[k]=v;},classList:{remove(){removed++;}},focus(){focused++;}},drawer={hidden:false,_chainReturnFocus:trigger,closest(){return this;}};
  view.root.querySelector=()=>drawer;c.setChainExplorerMode(view.button,'assessment');
  assert.equal(drawer.hidden,true);assert.equal(trigger['aria-expanded'],'false');assert.equal(focused,0);assert.equal(removed,1);
  assert.equal(view.panels[0].hidden,true);assert.equal(view.tabs[1]['aria-pressed'],'true');
  assert.match(c.chainExplorerHtml('方向',[],null,p,[],'empty',e),/data-chain-mode="assessment"/);
  assert.match(c.chainExplorerHtml('方向',[],null,{id:'p2'},[],'empty',e),/data-chain-mode="layout"/);
  assert.match(c.chainExplorerHtml('方向',[],null,p,[],'empty',{runId:'r2'}),/data-chain-mode="layout"/);
  c.setChainExplorerMode(view.button,'layout');assert.equal(view.panels[0].hidden,false);
 });
 test(side+' opening portals the drawer to body and closing restores focus and ownership',()=>{
  const c=setup(side),f=portalFixture(c);
  c.openChainLayoutNode(f.button,0);assert.equal(f.drawer.hidden,false);assert.equal(f.content.innerHTML,'<p>原文</p>');assert.equal(f.button['aria-expanded'],'true');assert.equal(f.close.focused,true);
  assert.equal(f.drawer.parentNode,f.body);assert.equal(f.root.querySelector('.chain-node-drawer'),null);assert.equal(f.root._chainDrawer,f.drawer);
  c.closeChainLayoutNode(f.drawer);assert.equal(f.drawer.hidden,true);assert.equal(f.button['aria-expanded'],'false');assert.equal(f.button.focused,true);
  assert.equal(f.drawer.parentNode,f.root);assert.equal(f.root._chainDrawer,null);assert.equal(c.CHAIN_OPEN_DRAWER,null);assert.equal(f.observer().active,false);
 });
 test(side+' detached or rerendered owners remove orphan portals without focusing old nodes',()=>{
  const c=setup(side),f=portalFixture(c);c.openChainLayoutNode(f.button,0);
  f.root.isConnected=false;f.observer().fire();
  assert.equal(f.drawer.parentNode,null);assert.equal(f.drawer.hidden,true);assert.equal(c.CHAIN_OPEN_DRAWER,null);assert.notEqual(f.button.focused,true);assert.equal(f.observer().active,false);
  const g=portalFixture(c);c.openChainLayoutNode(g.button,0);g.button.isConnected=false;g.observer().fire();
  assert.equal(g.drawer.parentNode,null);assert.notEqual(g.button.focused,true);
 });
 test(side+' view switch closes drawer but pure markup rendering preserves it',()=>{
  const c=setup(side),f=portalFixture(c);c.openChainLayoutNode(f.button,0);
  c.setChainExplorerMode({closest:()=>f.root},'assessment');assert.equal(f.drawer.hidden,true);assert.equal(f.drawer.parentNode,f.root);assert.notEqual(f.button.focused,true);
  c.openChainLayoutNode(f.button,0);c.chainExplorerHtml('新方向',[],null,{},[],'empty',{});
  assert.equal(f.drawer.hidden,false);assert.equal(c.CHAIN_OPEN_DRAWER,f.drawer);
  f.root.isConnected=false;f.observer().fire();assert.equal(f.drawer.parentNode,null);assert.equal(c.CHAIN_OPEN_DRAWER,null);
 });
 test(side+' only one body drawer remains open when another graph node is opened',()=>{
  const c=setup(side),first=portalFixture(c),second=portalFixture(c);
  c.openChainLayoutNode(first.button,0);const firstObserver=first.observer();c.openChainLayoutNode(second.button,0);
  assert.equal(first.drawer.hidden,true);assert.equal(first.drawer.parentNode,first.root);assert.equal(firstObserver.active,false);assert.equal(second.observer().active,true);
  assert.equal(second.drawer.hidden,false);assert.equal(second.drawer.parentNode,second.body);assert.equal(c.CHAIN_OPEN_DRAWER,second.drawer);
  assert.equal(first.button['aria-expanded'],'false');assert.equal(second.button['aria-expanded'],'true');
 });
 test(side+' empty and unnamed entries do not create placeholder companies or nodes',()=>{
  const c=setup(side),html=c.chainExplorerHtml('方向',[{seg:'上游',nodes:[{name:''}]}],null,{},[{name:' '}],'empty',{});
  assert.match(html,/>0<\/strong><span>已整理环节/);assert.equal((html.match(/class="chain-layout-node(?: |")/g)||[]).length,0);
  assert.doesNotMatch(html,/未命名材料项|示例企业|企业 0 家/);assert.match(html,/尚未形成节点/);
 });
}
test('both applications use the same layout and source presentation implementation',()=>{
 const sections=['index/script-02-sections','ops/script-03-sections'].map(p=>fs.readFileSync(path.join(__dirname,'../frontend',p,'12-tail.js'),'utf8'));
 const blocks=sections.map(s=>s.slice(s.indexOf('/* Presentation only: layout and assessment'),s.indexOf('function chainMapHtml(')));
 assert.equal(blocks[0],blocks[1]);
});

test('layout rating accents keep the established colors and neutral fallback',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../frontend/shared/industry-chain.css'),'utf8');
 for(const [level,color] of Object.entries({strong:'#2c7951',mid:'#8f6416',weak:'#b24738'})){
  const block=css.match(new RegExp('\\[data-chain-rating="'+level+'"\\] \\{([^}]+)\\}'));
  assert.ok(block,level);assert.ok(block[1].includes('--chain-rating-ink: '+color),level);
 }
 assert.match(css,/color: var\(--chain-rating-ink, #738293\)/);
 assert.match(css,/border-left: 3px solid var\(--chain-rating-edge, #dfe7ef\)/);
});
