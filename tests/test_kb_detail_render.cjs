'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,'frontend/index/script-02-sections',name+'.js'),'utf8');
const source={report:read('00'),known:read('01'),detail:read('14-tail')};
function between(text,start,end){
 const from=text.indexOf(start),to=text.indexOf(end,from+start.length);
 assert.ok(from>=0&&to>from,'production function boundaries exist: '+start);
 return text.slice(from,to);
}
const actualFunctions=[
 between(source.report,'function reportMdToHtml(','/* 所有导出从当前方向取正文'),
 between(source.known,'function _kbText(','// === AI精选概括'),
 between(source.known,'function _kbNums(','function _getDisplayKnown('),
 between(source.detail,'function kbEscape(','function kbSelectionCache('),
 between(source.detail,'function kbDetailSourceText(','function kbRefreshTopicScope(')
].join('\n');
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function harness(kb=[]){
 const nodes=new Map(),actions=[],appended=[];
 const body={appendChild(node){appended.push(node);if(node.id)nodes.set(node.id,node);return node;}};
 const c={console,Math,Number,String,Object,Array,JSON,URL,cur:'workspace-a',curKb:null,KB_CONFIRMS:{},
  P:()=>({city:'闵行区',kb}),_getDisplaySub:()=>'',
  confirmKbItem:(...args)=>actions.push(['confirm',...args]),editKbItem:(...args)=>actions.push(['edit',...args]),deleteKbItem:(...args)=>actions.push(['delete',...args]),
  document:{body,head:{appendChild:node=>{if(node.id)nodes.set(node.id,node);}},getElementById:id=>nodes.get(id)||null,createElement(tag){
   return {tagName:tag.toUpperCase(),id:'',textContent:'',html:'',set innerHTML(value){this.html=String(value);},get innerHTML(){return this.html;},get firstChild(){
    const parent=this,match=parent.html.match(/^<div id="([^"]+)"/);
    return {id:match?match[1]:'',innerHTML:parent.html,querySelector(){return null;},querySelectorAll(){return [];},remove(){nodes.delete(this.id);}};
   }};
  }}
 };
 c.window=c;vm.createContext(c);vm.runInContext(actualFunctions,c);
 return {c,actions,nodes,render(index=0){c.kbDetail(index);return appended.at(-1)?.innerHTML||'';}};
}
const render=value=>harness().c.kbDetailTextHtml(value);
const visibleText=html=>html.replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');

test('real detail renderer preserves paragraphs and ordinary line breaks from LF, CRLF and CR',()=>{
 const lines=['第一段含明确条件。','第一段下一行保留。','','第二段独立说明。','','来源：https://www.shmh.gov.cn/document?id=1&v=2'];
 const expected=render(lines.join('\n'));
 for(const ending of ['\r\n','\r'])assert.equal(render(lines.join(ending)),expected);
 assert.match(expected,/<p>第一段含明确条件。<\/p>\n<p>第一段下一行保留。<\/p>/);
 assert.match(expected,/<p>第二段独立说明。<\/p>/);
 assert.match(expected,/来源：<a\b[^>]*href="https:\/\/www\.shmh\.gov\.cn\/document\?id=1&amp;v=2"/);
});

test('real detail renderer keeps Markdown headings, emphasis and unordered lists',()=>{
 const html=render('# 城市基础\n## 适用条件\n- **保留完整条款**\n- 第二条说明\n\n正文继续。');
 assert.match(html,/<h1>城市基础<\/h1>/);assert.match(html,/<h2>适用条件<\/h2>/);
 assert.match(html,/<ul><li><strong>保留完整条款<\/strong><\/li><li>第二条说明<\/li><\/ul>/);
 assert.match(html,/<p>正文继续。<\/p>/);
});

test('ordered lists retain skipped, repeated and restarted source numbers',()=>{
 const html=render('2. 第二条\n5) 第五条\n5、重复第五条\n\n过渡正文\n12. 第十二条');
 assert.match(html,/<ol>\n<li value="2">第二条<\/li>\n<li value="5">第五条<\/li>\n<li value="5">重复第五条<\/li>\n<\/ol>/);
 assert.match(html,/<p>过渡正文<\/p>\n<ol>\n<li value="12">第十二条<\/li>\n<\/ol>/);
 assert.equal((html.match(/<ol>/g)||[]).length,2);
});

test('ordered blocks close before headings, unordered lists and source paragraphs',()=>{
 const html=render('1. 第一步\n2. 第二步\n## 核验条件\n- 无序补充\n来源：原部门\n8. 后续事项');
 assert.match(html,/<\/ol>\n<h2>核验条件<\/h2>/);
 assert.match(html,/<ul><li>无序补充<\/li><\/ul>\n<p>来源：原部门<\/p>/);
 assert.match(html,/<li value="8">后续事项<\/li>/);
});

test('Markdown tables retain headers, cells and escaped source content',()=>{
 const html=render('| 条款 | 内容 |\n| --- | :---: |\n| 年限 | 三年且需年审 |\n| 来源 | https://official.example/p?a=1&b=2 |');
 assert.match(html,/<table><thead><tr><th>条款<\/th><th>内容<\/th><\/tr><\/thead><tbody>/);
 assert.match(html,/<tr><td>年限<\/td><td>三年且需年审<\/td><\/tr>/);
 assert.match(html,/https:\/\/official\.example\/p\?a=1&amp;b=2/);
 assert.doesNotMatch(html,/<td>---|<th>---/);assert.match(html,/<\/tbody><\/table>/);
});

test('a long paragraph stays intact and decimal values are never ordered-list items',()=>{
 const paragraph='适用主体需在本区依法经营，资金仅支持合规用途，'.repeat(180)+'句末条件不能丢失。';
 const html=render(paragraph+'\n3.5% 为比例\n1.25 亿元为金额\n2026.10.12 是日期\n8.未带空格的原文字段');
 assert.equal((html.match(/<p>/g)||[]).length,5);assert.doesNotMatch(html,/<ol>|<li\b/);
 assert.ok(visibleText(html).includes(paragraph));assert.match(html,/3\.5%/);assert.match(html,/1\.25/);assert.match(html,/2026\.10\.12/);
});

test('raw HTML, closing tags and event handlers remain escaped text',()=>{
 const attack='</div></section><script>globalThis.pwned=true</script>\n<img src=x onerror="globalThis.pwned=true">\n1. <svg/onload=alert(1)>\n| 来源 | <iframe src="javascript:alert(1)"> |';
 const h=harness(),html=h.c.kbDetailTextHtml(attack);
 assert.doesNotMatch(html,/<\/?(?:script|img|svg|iframe|section|div)\b/i);
 assert.match(html,/&lt;\/div&gt;&lt;\/section&gt;&lt;script&gt;/);
 assert.match(html,/<li value="1">&lt;svg\/onload=alert\(1\)&gt;<\/li>/);
 assert.ok(visibleText(html).includes('<img src=x onerror="globalThis.pwned=true">'));
 assert.equal(h.c.pwned,undefined);
});

test('string and structured text inputs render identically without changing source objects',()=>{
 const text='✅ ## 政策条款\n\n1. 申请条件完整保留\n来源：https://official.example/policy';
 const object=freeze({text,origin:'report',source:'发文部门',sources:[{url:'https://official.example/policy'}],ts:12});
 const before=JSON.stringify(object);assert.equal(render(object),render(text));assert.equal(JSON.stringify(object),before);
 assert.match(render(object),/<h2>政策条款<\/h2>/);assert.match(render(object),/来源：<a\b[^>]*href="https:\/\/official\.example\/policy"/);
});

test('empty and absent text values produce no placeholder or object serialization',()=>{
 for(const value of [null,undefined,'',{}, {text:null},{text:''}])assert.equal(render(value),'');
 assert.doesNotMatch(render({text:'有效原文'}),/\[object Object\]/);
});

test('status prefix removal leaves status symbols within actual body unchanged',()=>{
 const html=render('⚠️ ## 待核事项\n本句包含 ⚠️ 正文标记与 ✅ 完成标记。');
 assert.match(html,/<h2>待核事项<\/h2>/);assert.match(html,/本句包含/);assert.match(visibleText(html),/⚠️ 正文标记与 ✅ 完成标记/);
});

test('kbDetail uses original structured text rather than the filtered display string',()=>{
 const entry=freeze({text:'## 条件详情\n\n申请人在本区实质经营。\n来源：闵行区政府（2026-10-12）\nhttps://www.shmh.gov.cn/policy?a=1&b=2\n> 原文限定：仅在有效期内申请。',origin:'report'});
 const kb=freeze([{t:'政策',icon:'📜',sub:'原始材料',known:[entry],calls:['部门原文']}]),h=harness(kb),before=JSON.stringify(kb);
 assert.doesNotMatch(h.c._kbText(entry),/https:|来源：|原文限定/);
 const html=h.render();assert.match(html,/<h2>条件详情<\/h2>/);assert.match(html,/来源：闵行区政府（2026-10-12）/);
 assert.match(html,/https:\/\/www\.shmh\.gov\.cn\/policy\?a=1&amp;b=2/);
 assert.match(html,/<blockquote><p>原文限定：仅在有效期内申请。<\/p><\/blockquote>/);
 assert.equal(JSON.stringify(kb),before);assert.equal(h.c.curKb,0);
});

test('kbDetail retains filtering, user-first sorting and original indexes for every action',()=>{
 const known=[
  {text:'概览',origin:'report'},
  {text:'普通条款：原始序号一，完整内容保留。',origin:'report'},
  {text:'⚠️ 研发补贴 10% 的条件待核。',origin:'report'},
  {text:'人工补充较早事项。',origin:'user',ts:10},
  {text:'✅ 已核验政策条件保留。',origin:'report'},
  {text:'人工补充最新事项。',origin:'user',ts:20}
 ];
 const kb=freeze([{t:'占位',known:[]},{t:'政策',icon:'📜',known}]),h=harness(kb),before=JSON.stringify(kb);
 h.c.KB_CONFIRMS={'workspace-a':{1:{4:{status:'confirmed'}}}};
 const html=h.render(1),ids=[...html.matchAll(/id="kb-card-1-(\d+)"/g)].map(m=>Number(m[1]));
 assert.deepEqual(ids,[5,3,2,4,1]);assert.doesNotMatch(html,/id="kb-card-1-0"/);assert.equal(JSON.stringify(kb),before);
 for(const index of ids){assert.match(html,new RegExp('editKbItem\\(1,'+index+'\\)'));assert.match(html,new RegExp('deleteKbItem\\(1,'+index+'\\)'));}
 assert.match(html,/confirmKbItem\(1,2\)/);assert.doesNotMatch(html,/confirmKbItem\(1,[01345]\)/);
 for(const code of ['confirmKbItem(1,2)','editKbItem(1,5)','deleteKbItem(1,1)']){
  assert.ok(html.includes('onclick="'+code+'"'));vm.runInContext(code,h.c);
 }
 assert.deepEqual(h.actions,[['confirm',1,2],['edit',1,5],['delete',1,1]]);
});

test('duplicate warnings preserve representative source indexes and data layer',()=>{
 const known=freeze(['⚠️ 研发补贴 10% 的条件需确认。','⚠️ 研发补贴 10% 的条件需确认，包含适用主体和有效期限。']);
 const h=harness([{t:'政策',known}]),before=JSON.stringify(known),html=h.render();
 assert.match(html,/id="kb-card-0-1"/);assert.doesNotMatch(html,/id="kb-card-0-0"/);
 assert.match(html,/confirmKbItem\(0,1\)/);assert.deepEqual(Array.from(h.c.__kbDupMap[0][1]),[0]);assert.equal(JSON.stringify(known),before);
});

test('detail markup exposes its dialog and responsive content hooks',()=>{
 const h=harness([{t:'政策',icon:'📜',known:['完整正文包含适用条件与来源说明。']}]),html=h.render();
 assert.match(html,/class="kb-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="kbDetailTitle"/);
 assert.match(html,/class="kb-detail-scroll"/);assert.match(html,/class="kb-detail-richtext"/);
 assert.match(html,/onclick="closeKbDetail\(\);askAboutKb\(0\)"/);
 const css=fs.readFileSync(path.join(root,'frontend/index/style-01.css'),'utf8');
 const dialog=css.match(/\.kb-detail-dialog\{([^}]+)\}/)?.[1]||'';
 assert.match(dialog,/width:900px/);assert.match(dialog,/max-width:100%/);assert.match(dialog,/min-width:0/);
 assert.match(css,/\.kb-detail-richtext\{[^}]*overflow-wrap:anywhere/);
 assert.match(css,/\.kb-detail-richtext table\{[^}]*max-width:100%[^}]*overflow-x:auto/);
});

function actionHarness(known){
 const h=harness([{t:'政策',icon:'📜',known}]),c=h.c,scroll={scrollTop:123},effects={persist:0,corpus:0,progress:0,toasts:[],selectors:[]};
 Object.assign(c,{AUTH:{user:'reviewer'},KB_FILE_CHUNKS:{'workspace-a':[{id:'pin:0:0'},{id:'unrelated'}]},
  persist(){effects.persist++;},buildKBCorpus(){effects.corpus++;},refreshKbProgress(){effects.progress++;},toast(message){effects.toasts.push(message);}});
 c.document.querySelector=selector=>{effects.selectors.push(selector);return selector==='#kbDetailModal .kb-detail-scroll'?scroll:null;};
 vm.runInContext(between(source.detail,'function confirmKbItem(','/* 编辑框附件上传'),c);
 vm.runInContext(between(source.detail,'function editKbItem(','function addKbItem('),c);
 h.card=index=>{
  const card={style:{},_html:'',set innerHTML(value){
   this._html=String(value);
   const match=this._html.match(/<textarea\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/);
   if(match){
    // HTML textarea parsing decodes entities once and normalizes newlines.
    const entities={'&lt;':'<','&gt;':'>','&amp;':'&','&quot;':'"','&#39;':"'"};
    const ta={value:match[2].replace(/\r\n?/g,'\n').replace(/&(?:lt|gt|amp|quot|#39);/g,x=>entities[x]),focus(){this.focused=true;},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;}};
    h.nodes.set(match[1],ta);
   }
  },get innerHTML(){return this._html;}};
  h.nodes.set('kb-card-0-'+index,card);return card;
 };
 return Object.assign(h,{effects,scroll});
}

test('confirming a structured record preserves its complete raw source and metadata',()=>{
 const raw='⚠️ ## 原始条款\r\n\r\n1. 实质经营且符合行业条件。\r\n来源：闵行区政府\r\nhttps://official.example/policy?x=1&y=2\r\n> 仅在有效期内申请。';
 const metadata=freeze({url:'https://official.example/policy?x=1&y=2',quote:'原文证据'});
 const item={text:raw,origin:'report',nature:'policy',sources:[metadata],account:'original'},h=actionHarness([item]);
 h.c.confirmKbItem(0,0);
 const clean=raw.slice('⚠️ '.length);
 assert.equal(item.text,'✅ '+clean);assert.equal(h.c.KB_CONFIRMS['workspace-a'][0][0].text,clean);
 assert.equal(item.origin,'report');assert.equal(item.nature,'policy');assert.equal(item.account,'original');assert.equal(item.sources[0],metadata);
 assert.equal(h.effects.persist,1);assert.equal(h.effects.progress,1);assert.equal(h.scroll.scrollTop,123);
 assert.ok(h.effects.selectors.every(x=>x==='#kbDetailModal .kb-detail-scroll'));
 assert.deepEqual(h.c.KB_FILE_CHUNKS['workspace-a'],[{id:'unrelated'}]);
 assert.match(h.render(),/<blockquote><p>仅在有效期内申请。<\/p><\/blockquote>/);
});

test('confirming grouped duplicates preserves each record own paragraphs and original source',()=>{
 const first='⚠️ 条款条件\n\n第一项完整来源。\n来源：https://official.example/first';
 const second='⚠️ 条款条件的另一原文\r\n\r\n第二项限定条件。\r\n来源：https://official.example/second';
 const metadata={url:'https://official.example/second'},item={text:second,origin:'import',source:metadata},known=[first,item],h=actionHarness(known);
 h.c.__kbDupMap={0:{0:[1]}};h.c.confirmKbItem(0,0);
 assert.equal(known[0],'✅ '+first.slice('⚠️ '.length));assert.equal(item.text,'✅ '+second.slice('⚠️ '.length));assert.equal(item.source,metadata);
 assert.equal(h.c.KB_CONFIRMS['workspace-a'][0][1].text,second.slice('⚠️ '.length));assert.equal(h.c.KB_CONFIRMS['workspace-a'][0][1].mergedFrom,0);
 assert.doesNotMatch(item.text,/example\/first/);assert.equal(h.effects.persist,1);
});

test('opening edit uses the original paragraphs and source rather than the cleaned display text',()=>{
 const raw='✅ ## 原始政策\n\n第一段规定。\n第二段限制。\n来源：原部门（2026-10-12）\nhttps://official.example/edit?a=1&b=2';
 const item={text:raw,origin:'report'},h=actionHarness([item]),card=h.card(0),before=JSON.stringify(item);
 h.c.editKbItem(0,0);const ta=h.nodes.get('kb-edit-0-0');
 assert.equal(ta.value,raw.slice('✅ '.length));assert.equal(ta.focused,true);assert.equal(ta.selectionEnd,ta.value.length);
 assert.match(card.innerHTML,/来源：原部门/);assert.match(card.innerHTML,/https:\/\/official\.example\/edit\?a=1&amp;b=2/);
 assert.equal(JSON.stringify(item),before);assert.equal(h.effects.persist,0);
});

test('opening and saving without editing preserves source text and structured metadata',()=>{
 const raw='⚠️ ## 保留原始条款\n\n第一段申请条件。\n\n1. 第二段核验要求。\n来源：原部门\nhttps://official.example/save?a=1&b=2';
 const metadata=freeze({url:'https://official.example/save?a=1&b=2'}),item={text:raw,origin:'report',nature:'policy',sources:[metadata]},h=actionHarness([item]);
 h.card(0);h.c.editKbItem(0,0);h.c.saveKbEdit(0,0);
 assert.equal(item.text,'✅ '+raw.slice('⚠️ '.length));assert.equal(item.sources[0],metadata);assert.equal(item.nature,'policy');
 assert.equal(item.origin,'user');assert.equal(item.account,'reviewer');assert.equal(typeof item.ts,'number');
 assert.equal(h.c.KB_CONFIRMS['workspace-a'][0][0].text,raw.slice('⚠️ '.length));assert.equal(h.effects.persist,1);assert.equal(h.effects.corpus,1);
 assert.equal(h.scroll.scrollTop,123);assert.ok(h.effects.selectors.every(x=>x==='#kbDetailModal .kb-detail-scroll'));
});

test('textarea closing tags and scripts remain escaped and round-trip as literal text',()=>{
 const raw='原文保留</textarea><script>globalThis.pwned=true</script>\n<img src=x onerror="alert(1)">\n字面实体 &lt; 与 &amp; 不可二次解码。';
 const known=[{text:raw,origin:'report'}],h=actionHarness(known),card=h.card(0);
 h.c.editKbItem(0,0);
 assert.equal((card.innerHTML.match(/<\/textarea>/g)||[]).length,1);assert.equal((card.innerHTML.match(/<textarea\b/g)||[]).length,1);
 assert.doesNotMatch(card.innerHTML,/<script\b|<img\b/);assert.match(card.innerHTML,/&lt;\/textarea&gt;&lt;script&gt;/);
 assert.equal(h.nodes.get('kb-edit-0-0').value,raw);h.c.saveKbEdit(0,0);assert.equal(known[0].text,'✅ '+raw);assert.equal(h.c.pwned,undefined);
});

test('document index metadata uses real first-line headings or quoted original section titles',()=>{
 const h=harness(),item=freeze({text:'⚠️ ## 2. 产业承载条件\r\n\r\n正文与来源保留。',sourceFile:'research/01c_transport_land.md',origin:'report'}),before=JSON.stringify(item);
 const meta=h.c.kbDetailMeta(item,4);
 assert.equal(meta.title,'2. 产业承载条件');assert.equal(meta.source,'交通与空间');assert.equal(meta.file,'research/01c_transport_land.md');assert.equal(meta.number,'05');assert.equal(JSON.stringify(item),before);
 for(const quote of ['本子章节“政策适用条件”说明','本子章节「政策适用条件」说明','本子章节"政策适用条件"说明'])assert.equal(h.c.kbDetailMeta(quote,0).title,'政策适用条件');
});

test('index title fallback keeps mapped file names, original short text and explicit unknowns',()=>{
 const c=harness().c;
 assert.equal(c.kbDetailMeta({text:'这是较长的原始正文，含完整适用条件但没有任何独立标题，需要完整保留。',src:'C:\\reports\\04_policy_trends.md'},0).title,'政策与规划');
 assert.equal(c.kbDetailMeta('3. 简短原文标题',0).title,'简短原文标题');
 assert.equal(c.kbDetailMeta('无独立标题而且这段正文长度明显超过二十八个字，所以不能编造概括作为目录标题。',0).title,'知识片段');
 assert.equal(c.kbDetailMeta({text:'',origin:'user'},0).source,'用户补充');
 assert.equal(c.kbDetailMeta(null,0).source,'来源未标注');assert.equal(c.kbDetailMeta(null,0).title,'知识片段');
});

test('duplicate index titles retain distinct original targets after sorting and filtering',()=>{
 const known=freeze([{text:'无效',origin:'report'},{text:'## 相同标题\n第一条正文具有独立条件。',origin:'report'},
  {text:'## 相同标题\n第二条人工补充正文。',origin:'user',ts:100}]);
 const h=harness([{t:'政策',known}]),before=JSON.stringify(known),html=h.render();
 const sections=[...html.matchAll(/<section id="([^"]+)"[^>]*data-kb-section="(\d+)"/g)].map(m=>[m[1],Number(m[2])]);
 assert.deepEqual(sections,[['kb-card-0-2',2],['kb-card-0-1',1]]);
 for(const index of [2,1]){
  const matches=[...html.matchAll(new RegExp('<button[^>]*data-target="kb-card-0-'+index+'"[^>]*onclick="kbJumpToDetail\\(0,'+index+'\\)"[^>]*>','g'))];
  assert.equal(matches.length,2,'desktop and mobile directory each point to the original record');
 }
 assert.doesNotMatch(html,/data-target="kb-card-0-0"/);assert.equal(JSON.stringify(known),before);
});

test('directory labels and source metadata are escaped without executing original markup',()=>{
 const known=[{text:'## <img src=x onerror="alert(1)">\n正文安全保留。',sourceFile:'<script>alert(2)</script>',origin:'user'}];
 const html=harness([{t:'资料',known}]).render();
 assert.doesNotMatch(html,/<img\b|<script\b/);assert.match(html,/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
 assert.match(html,/&lt;script&gt;alert\(2\)&lt;\/script&gt;/);assert.equal((html.match(/data-target="kb-card-0-0"/g)||[]).length,2);
});

test('only real safe source URLs become links and retain their complete targets',()=>{
 const html=render('来源[1][3]\n网址 https://www.shmh.gov.cn/policy?a=1&b=2。\n补充 https://example.org/doc#part-2\nftp://example.org/no\njavascript:alert(1)\nhttps://name:secret@example.org/private');
 assert.match(html,/<span class="kb-detail-citation">来源\[1\]\[3\]<\/span>/);
 const links=[...html.matchAll(/<a class="kb-detail-source-link" href="([^"]+)"[^>]*>/g)].map(m=>m[1]);
 assert.deepEqual(links,['https://www.shmh.gov.cn/policy?a=1&amp;b=2','https://example.org/doc#part-2']);
 assert.equal((html.match(/target="_blank" rel="noopener noreferrer"/g)||[]).length,2);
 assert.match(html,/>www\.shmh\.gov\.cn ↗<\/a>/);assert.match(html,/https:\/\/name:secret@example\.org\/private/);
 assert.doesNotMatch(render('来源[7] 但原文没有可追溯网址。'),/<a\b/);
});

test('post-render note decoration leaves URL text and rendered attributes alone without unsafe HTML',()=>{
 const c=harness().c,input='<p data-title="https://do-not-link.example/a">https://official.example/&lt;img</p>',html=c.kbDetailDecorateHtml(input);
 assert.equal(html,input);assert.doesNotMatch(html,/<a\b/);
 assert.doesNotMatch(html,/<img\b|onerror=|<script\b/);
 const dangerous=render('原文 <img src="https://attacker.example/x" onerror="alert(1)">');
 assert.doesNotMatch(dangerous,/<img\b/);assert.match(dangerous,/&lt;img/);
});

function navigationHarness(){
 const h=harness(),calls=[],rect={top:100},sc={scrollTop:80,clientHeight:300,scrollHeight:1000,getBoundingClientRect:()=>rect,scrollTo:options=>calls.push(options)};
 const positions=[90,140,300],sections=positions.map((top,index)=>({id:'kb-card-2-'+index,getBoundingClientRect:()=>({top:positions[index]})}));
 const buttons=sections.flatMap(section=>[0,1].map(()=>({attrs:{'data-target':section.id},getAttribute(name){return this.attrs[name]??null;},setAttribute(name,value){this.attrs[name]=String(value);},removeAttribute(name){delete this.attrs[name];}})));
 const queries=[],modal={querySelector(selector){queries.push(selector);return selector==='.kb-detail-scroll'?sc:sections.find(s=>'#'+s.id===selector)||null;},querySelectorAll(selector){return selector==='[data-kb-section]'?sections:selector==='.kb-detail-index-link'?buttons:[];}};
 h.nodes.set('kbDetailModal',modal);h.c.matchMedia=()=>({matches:false});
 return Object.assign(h,{calls,sc,rect,positions,sections,buttons,queries});
}

test('directory jump scrolls the modal viewport using relative geometry and motion preference',()=>{
 const h=navigationHarness();h.c.kbJumpToDetail(2,2);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].top,260);assert.equal(h.calls[0].behavior,'smooth');
 h.c.matchMedia=()=>({matches:true});h.positions[0]=-100;h.c.kbJumpToDetail(2,0);
 assert.equal(h.calls.at(-1).top,0);assert.equal(h.calls.at(-1).behavior,'auto');
});

test('directory navigation refuses invalid indexes or targets outside the current modal',()=>{
 const h=navigationHarness();
 h.nodes.set('kb-card-2-99',{scrollIntoView(){throw Error('must not reach another document node');}});
 for(const args of [['2',0],[2,'0'],[2.5,0],[2,NaN],[Infinity,0],[2,'0\");alert(1)'],[2,99]])h.c.kbJumpToDetail(...args);
 assert.equal(h.calls.length,0);assert.ok(h.queries.every(q=>q==='.kb-detail-scroll'||q==='#kb-card-2-99'));
 h.nodes.delete('kbDetailModal');h.c.kbJumpToDetail(2,0);assert.equal(h.calls.length,0);
});

test('scroll position updates both directories aria-current within the active modal only',()=>{
 const h=navigationHarness(),outside={attrs:{'aria-current':'outside'}};h.nodes.set('outside-directory',outside);
 h.c.kbUpdateDetailIndex();
 assert.deepEqual(h.buttons.map(b=>b.attrs['aria-current']),[undefined,undefined,'location','location',undefined,undefined]);
 h.positions[0]=-200;h.positions[1]=-100;h.positions[2]=150;h.c.kbUpdateDetailIndex();
 assert.deepEqual(h.buttons.map(b=>b.attrs['aria-current']),[undefined,undefined,undefined,undefined,'location','location']);
 assert.equal(outside.attrs['aria-current'],'outside');assert.equal(h.calls.length,0);
});

test('document sections remove decorative cards and duplicate figures while managing actions stay collapsed',()=>{
 const known=[{text:'## 项目投入\n项目总投资100亿元，具体条件仍需核实。',origin:'report'},
  {text:'⚠️ ## 核验事项\n申报适用范围需要确认。',origin:'report'}];
 const html=harness([{t:'资料',known}]).render();
 const sections=[...html.matchAll(/<section\b[^>]*class="kb-detail-article"[^>]*>([\s\S]*?)<\/section>/g)].map(m=>m[1]);
 assert.equal(sections.length,2);assert.equal((html.match(/100亿元/g)||[]).length,1);assert.doesNotMatch(html,/★|background:#dbeafe/);
 for(const section of sections){
  const details=section.match(/<details\b([^>]*)>([\s\S]*?)<\/details>/);assert.ok(details);assert.doesNotMatch(details[1],/\bopen(?:\s|=|$)/);
  assert.match(details[2],/<summary>修改或删除<\/summary>/);assert.match(details[2],/editKbItem\(0,\d+\)/);assert.match(details[2],/deleteKbItem\(0,\d+\)/);
  assert.doesNotMatch(section.replace(details[0],''),/editKbItem|deleteKbItem/);
 }
 const pending=sections.find(section=>section.includes('confirmKbItem'));
 assert.ok(pending);assert.match(pending.replace(/<details\b[^>]*>[\s\S]*?<\/details>/,''),/confirmKbItem\(0,1\)/);
 const css=fs.readFileSync(path.join(root,'frontend/index/style-01.css'),'utf8'),article=css.match(/\.kb-detail-article\{([^}]+)\}/)?.[1]||'';
 assert.doesNotMatch(article,/background|box-shadow|border-radius/);
});

test('numeric distance inside a real URL remains an exact unsplit href',()=>{
 const url='https://example.com/100km/report',html=render('来源 '+url+'\n运输距离为100km。');
 const links=[...html.matchAll(/<a class="kb-detail-source-link" href="([^"]+)"[^>]*>/g)].map(m=>m[1]);
 assert.deepEqual(links,[url]);assert.equal((html.match(/class="num"/g)||[]).length,1,'only ordinary distance text is highlighted');
 assert.match(html,/<span class="num">100km<\/span>/);assert.doesNotMatch(links[0],/<|>|&lt;|&gt;/);
});

test('percent-encoded Chinese query and ampersand survive URL rendering exactly',()=>{
 const url='https://example.com/search?q=%E4%B8%AD%E6%96%87&from=1',html=render('来源 '+url);
 const anchor=html.match(/<a class="kb-detail-source-link" href="([^"]+)"[^>]*title="([^"]+)"/);
 assert.ok(anchor);assert.equal(anchor[1],url.replace(/&/g,'&amp;'));assert.equal(anchor[2],anchor[1]);
 assert.doesNotMatch(html,/class="num"/);assert.equal((html.match(/<a\b/g)||[]).length,1);
});

test('each repeated original URL is restored in its original paragraph or table position',()=>{
 const url='https://example.com/100km/report?q=%E4%B8%AD&from=1';
 const html=render('第一处 '+url+'\n第二处 '+url+'\n| 来源 | '+url+' |');
 const links=[...html.matchAll(/<a class="kb-detail-source-link" href="([^"]+)"[^>]*>/g)].map(m=>m[1]);
 assert.deepEqual(links,Array(3).fill(url.replace(/&/g,'&amp;')));
 assert.match(html,/第一处 <a\b/);assert.match(html,/第二处 <a\b/);assert.match(html,/<t[dh]><a\b/);
 assert.doesNotMatch(html,/HXZDETAILSOURCE/);
});

test('input resembling internal URL placeholders remains literal without replacing text or hrefs',()=>{
 const tokens=['HXZDETAILSOURCE0END','HXZDETAILSOURCEX0END','HXZDETAILSOURCEXX1END'];
 const url='https://example.com/HXZDETAILSOURCE0END/100km?q=%E4%B8%AD&from=1';
 const input=tokens.join('\n')+'\n来源 '+url,html=render(input);
 for(const token of tokens)assert.match(html,new RegExp('<p>'+token+'<\\/p>'));
 const links=[...html.matchAll(/<a class="kb-detail-source-link" href="([^"]+)"[^>]*>/g)].map(m=>m[1]);
 assert.deepEqual(links,[url.replace(/&/g,'&amp;')]);assert.equal((html.match(/<a\b/g)||[]).length,1);
});

test('bottom of the real scroll range selects the final section even before its top reaches the threshold',()=>{
 const h=navigationHarness();h.positions.splice(0,3,50,130,500);h.sc.scrollTop=697;
 h.c.kbUpdateDetailIndex();assert.deepEqual(h.buttons.map(b=>b.attrs['aria-current']),[undefined,undefined,'location','location',undefined,undefined]);
 h.sc.scrollTop=699;h.c.kbUpdateDetailIndex();
 assert.deepEqual(h.buttons.map(b=>b.attrs['aria-current']),[undefined,undefined,undefined,undefined,'location','location']);
 h.sc.scrollTop=670;h.c.kbUpdateDetailIndex();
 assert.deepEqual(h.buttons.map(b=>b.attrs['aria-current']),[undefined,undefined,'location','location',undefined,undefined]);assert.equal(h.calls.length,0);
});
