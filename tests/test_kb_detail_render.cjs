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
 const nodes=new Map(),actions=[],appended=[],project={city:'闵行区',kb};
 const body={appendChild(node){appended.push(node);if(node.id)nodes.set(node.id,node);return node;}};
 const c={console,Math,Number,String,Object,Array,JSON,URL,cur:'workspace-a',curKb:null,KB_CONFIRMS:{},
  P:()=>project,_getDisplaySub:()=>'',kbCancelEdit:()=>true,kbEditSession:null,
  confirmKbItem:(...args)=>actions.push(['confirm',...args]),editKbItem:(...args)=>actions.push(['edit',...args]),deleteKbItem:(...args)=>actions.push(['delete',...args]),
  document:{body,head:{appendChild:node=>{if(node.id)nodes.set(node.id,node);}},getElementById:id=>nodes.get(id)||null,createElement(tag){
   return {tagName:tag.toUpperCase(),id:'',textContent:'',html:'',set innerHTML(value){this.html=String(value);},get innerHTML(){return this.html;},get firstChild(){
    const parent=this,match=parent.html.match(/^<div id="([^"]+)"/);
    return {id:match?match[1]:'',innerHTML:parent.html,querySelector(){return null;},querySelectorAll(){return [];},remove(){nodes.delete(this.id);}};
   }};
  }}
 };
 c.window=c;vm.createContext(c);vm.runInContext(actualFunctions,c);
 return {c,actions,nodes,project,render(index=0){c.kbDetail(index);return appended.at(-1)?.innerHTML||'';}};
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
 const dialogTag=html.match(/<div class="kb-detail-dialog"[^>]*>/)?.[0]||'';
 assert.match(dialogTag,/role="dialog"/);assert.match(dialogTag,/aria-modal="true"/);assert.match(dialogTag,/aria-labelledby="kbDetailTitle"/);
 assert.match(html,/class="kb-detail-scroll"/);assert.match(html,/class="kb-detail-richtext"/);
 const askCode=html.match(/class="kb-detail-ask" onclick="([^"]+)"/)?.[1];assert.ok(askCode);
 const asked=[];h.c.askAboutKb=index=>asked.push(index);h.c.closeKbDetail=()=>false;vm.runInContext(askCode,h.c);assert.deepEqual(asked,[]);
 h.c.closeKbDetail=()=>true;vm.runInContext(askCode,h.c);assert.deepEqual(asked,[0]);
 const css=fs.readFileSync(path.join(root,'frontend/index/style-01.css'),'utf8');
 const dialog=css.match(/\.kb-detail-dialog\{([^}]+)\}/)?.[1]||'';
 assert.match(dialog,/width:900px/);assert.match(dialog,/max-width:100%/);assert.match(dialog,/min-width:0/);
 assert.match(css,/\.kb-detail-richtext\{[^}]*overflow-wrap:anywhere/);
 assert.match(css,/\.kb-detail-richtext table\{[^}]*max-width:100%[^}]*overflow-x:auto/);
});

function actionHarness(known){
 const h=harness([{t:'政策',icon:'📜',known}]),c=h.c,scroll={scrollTop:123,getBoundingClientRect:()=>({top:100})},effects={persist:0,corpus:0,progress:0,toasts:[],selectors:[]};
 const confirms=[],answers=[],created=[],decode=s=>s.replace(/&(?:lt|gt|amp|quot|#39);/g,x=>({'&lt;':'<','&gt;':'>','&amp;':'&','&quot;':'"','&#39;':"'"}[x]));
 function element(tag='div'){
  const attrs={},names=new Set(),node={tagName:tag.toUpperCase(),style:{},children:[],parentNode:null,_html:'',value:'',hidden:false,disabled:false,
   setAttribute(name,value){attrs[name]=String(value);if(name==='id')this.id=String(value);if(name==='class')this.className=String(value);},getAttribute:name=>attrs[name]??null,hasAttribute:name=>Object.hasOwn(attrs,name),removeAttribute:name=>{delete attrs[name];},
   classList:{add:name=>names.add(name),remove:name=>names.delete(name),contains:name=>names.has(name)},
   focus(){this.focused=true;c.document.activeElement=this;},click(){this.clicked=true;},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},getClientRects(){return this.hidden?[]:[{top:0}];},getBoundingClientRect:()=>({top:120}),
   appendChild(child){child.parentNode=this;this.children.push(child);if(child.id)h.nodes.set(child.id,child);return child;},
   remove(){for(const child of this.children)child.remove();if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(x=>x!==this);if(h.nodes.get(this.id)===this)h.nodes.delete(this.id);this.parentNode=null;},
   querySelectorAll(){return this.children.flatMap(x=>[x,...x.querySelectorAll()]).filter(x=>['BUTTON','TEXTAREA','INPUT','SUMMARY'].includes(x.tagName));},
   querySelector(selector){return this.children.find(x=>selector.startsWith('.')?(x.className||'').split(/\s+/).includes(selector.slice(1)):selector.startsWith('#')?x.id===selector.slice(1):x.tagName.toLowerCase()===selector)||this.children.map(x=>x.querySelector(selector)).find(Boolean)||null;},
   set innerHTML(html){this._html=String(html);this.children=[];
    for(const match of this._html.matchAll(/<(textarea|button|div|span|input|h3)\b([^>]*)>/g)){
     if(!/\bid="/.test(match[2])&&match[1]!=='button')continue;
     const child=element(match[1]);
     for(const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))child.setAttribute(attr[1],decode(attr[2]||''));
     child.hidden=/\bhidden\b/.test(match[2]);
     if(match[1]==='textarea'){const after=this._html.slice(match.index+match[0].length),end=after.indexOf('</textarea>');child.value=decode(after.slice(0,end)).replace(/\r\n?/g,'\n');}
     this.appendChild(child);
    }
   },get innerHTML(){return this._html;},
   get firstChild(){const match=this._html.match(/^<div id="([^"]+)"/);return {id:match?match[1]:'',innerHTML:this._html,querySelector(){return null;},querySelectorAll(){return [];},remove(){h.nodes.delete(this.id);}};}
  };return node;
 }
 let dialog,readers;
 function installReader(){dialog=element();dialog.className='kb-detail-dialog';readers=[element('header'),element('main'),element('footer')];readers[1].setAttribute('inert','');readers.forEach(n=>dialog.appendChild(n));
  h.nodes.set('kbDetailModal',{querySelector:selector=>selector==='.kb-detail-dialog'?dialog:selector==='.kb-detail-scroll'?scroll:null,querySelectorAll:()=>[],remove(){h.nodes.delete('kbDetailModal');}});
 }
 const listeners={};Object.assign(c,{AUTH:{user:'reviewer'},_authEpoch:1,KB_FILE_CHUNKS:{'workspace-a':[{id:'pin:0:0'},{id:'unrelated'}]},
  addEventListener(name,handler){listeners[name]=handler;},
  originalUploadEpoch:()=>c._authEpoch,originalUploadSessionCurrent:epoch=>epoch===c._authEpoch,
  confirm(message){confirms.push(message);return answers.length?answers.shift():true;},
  persist(){effects.persist++;},buildKBCorpus(){effects.corpus++;},refreshKbProgress(){effects.progress++;},toast(message){effects.toasts.push(message);}});
 c.document.querySelector=selector=>{effects.selectors.push(selector);return selector==='#kbDetailModal .kb-detail-scroll'?scroll:null;};
 c.document.createElement=tag=>{const node=element(tag);created.push(node);return node;};
 vm.runInContext(between(source.detail,'function confirmKbItem(','/* 编辑框附件上传'),c);
 vm.runInContext(between(source.detail,'/* 编辑框附件上传','var kbEditSession=null;'),c);
 vm.runInContext(between(source.detail,'var kbEditSession=null;','/* 删除某条 known 条目'),c);
 const renderDetail=c.kbDetail;c.kbDetail=function(index){renderDetail(index);if(!c.kbEditSession)installReader();};installReader();
 return Object.assign(h,{effects,scroll,confirms,answers,created,listeners,dialog:()=>dialog,readers:()=>readers,textarea:()=>h.nodes.get('kb-edit-'+c.kbEditSession?.kbIdx+'-'+c.kbEditSession?.itemIdx),panel:()=>h.nodes.get('kbEditorPanel')});
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
 const item={text:raw,origin:'report'},h=actionHarness([item]),before=JSON.stringify(item);
 h.c.editKbItem(0,0);const ta=h.nodes.get('kb-edit-0-0');
 assert.equal(ta.value,raw.slice('✅ '.length));assert.equal(ta.focused,true);assert.equal(ta.selectionEnd,0);
 assert.match(h.panel().innerHTML,/来源：原部门/);assert.match(h.panel().innerHTML,/https:\/\/official\.example\/edit\?a=1&amp;b=2/);
 assert.equal(JSON.stringify(item),before);assert.equal(h.effects.persist,0);
});

test('opening and saving without editing does not write or change source metadata or confirmation',()=>{
 const raw='⚠️ ## 保留原始条款\n\n第一段申请条件。\n\n1. 第二段核验要求。\n来源：原部门\nhttps://official.example/save?a=1&b=2';
 const metadata=freeze({url:'https://official.example/save?a=1&b=2'}),item={text:raw,origin:'report',nature:'policy',sources:[metadata]},h=actionHarness([item]);
 const before=JSON.stringify(item);h.c.editKbItem(0,0);h.c.saveKbEdit(0,0);
 assert.equal(JSON.stringify(item),before);assert.equal(item.sources[0],metadata);assert.deepEqual(h.c.KB_CONFIRMS,{});
 assert.equal(h.effects.persist,0);assert.equal(h.effects.corpus,0);assert.equal(h.c.kbEditSession,null);assert.equal(h.panel(),undefined);
 assert.equal(h.scroll.scrollTop,123);
});

test('textarea closing tags and scripts remain escaped and round-trip as literal text',()=>{
 const raw='原文保留</textarea><script>globalThis.pwned=true</script>\n<img src=x onerror="alert(1)">\n字面实体 &lt; 与 &amp; 不可二次解码。';
 const known=[{text:raw,origin:'report'}],h=actionHarness(known);
 h.c.editKbItem(0,0);
 const panel=h.panel();assert.equal((panel.innerHTML.match(/<\/textarea>/g)||[]).length,1);assert.equal((panel.innerHTML.match(/<textarea\b/g)||[]).length,1);
 assert.doesNotMatch(panel.innerHTML,/<script\b|<img\b/);assert.match(panel.innerHTML,/&lt;\/textarea&gt;&lt;script&gt;/);
 assert.equal(h.nodes.get('kb-edit-0-0').value,raw);h.textarea().value+='\n补充核查条件。';h.c.saveKbEdit(0,0);assert.equal(known[0].text,'✅ '+raw+'\n补充核查条件。');assert.equal(h.c.pwned,undefined);
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

test('document sections retain one original fact per body while managing actions stay collapsed',()=>{
 const known=[{text:'## 项目投入\n项目总投资100亿元，具体条件仍需核实。',origin:'report'},
  {text:'⚠️ ## 核验事项\n申报适用范围需要确认。',origin:'report'}];
 const html=harness([{t:'资料',known}]).render();
 const sections=[...html.matchAll(/<section\b[^>]*class="kb-detail-article"[^>]*>([\s\S]*?)<\/section>/g)].map(m=>m[1]);
 assert.equal(sections.length,2);assert.equal((html.match(/100亿元/g)||[]).length,1);assert.doesNotMatch(html,/★|background:#dbeafe/);
 for(const section of sections){
  const details=section.match(/<details\b([^>]*)>([\s\S]*?)<\/details>/);assert.ok(details);assert.doesNotMatch(details[1],/\bopen(?:\s|=|$)/);
  assert.match(details[2],/<summary>更多操作<\/summary>/);assert.match(details[2],/deleteKbItem\(0,\d+\)/);
  assert.doesNotMatch(section.replace(details[0],''),/deleteKbItem/);
  const header=section.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)?.[1]||'';
  assert.match(header,/class="kb-detail-edit" onclick="editKbItem\(0,\d+\)"/);
 }
 const pending=sections.find(section=>section.includes('confirmKbItem'));
 assert.ok(pending);assert.match(pending.replace(/<details\b[^>]*>[\s\S]*?<\/details>/,''),/confirmKbItem\(0,1\)/);
 assert.equal((html.match(/class="kb-detail-richtext"/g)||[]).length,known.length);
 assert.equal((visibleText(html).match(/项目总投资100亿元，具体条件仍需核实。/g)||[]).length,1);
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

test('four topic themes and fallback change only the dialog theme without mutating source content',()=>{
 const raw='## 原始资料\n全部正文与条件保持不变。',kb=freeze(Array.from({length:6},(_,i)=>({t:'主题'+i,known:[{text:raw,origin:'report'}]}))),h=harness(kb),before=JSON.stringify(kb);
 const expected=['indigo','teal','violet','amber','indigo','indigo'];
 expected.forEach((theme,index)=>{
  const html=h.render(index),tag=html.match(/<div class="kb-detail-dialog"[^>]*>/)?.[0]||'';
  assert.match(tag,new RegExp('data-kb-theme="'+theme+'"'));
  assert.equal((html.match(/id="kb-card-/g)||[]).length,1);assert.match(html,new RegExp('id="kb-card-'+index+'-0"'));
  assert.match(html,/<h2>原始资料<\/h2>/);assert.equal((html.match(/全部正文与条件保持不变。/g)||[]).length,1);
 });
 assert.equal(JSON.stringify(kb),before);
});

test('mosaic is four empty hidden decorative pieces and does not introduce controls or text',()=>{
 const html=harness([{t:'政策',known:['正文包含真实政策条件。']}]).render();
 const mosaic=html.match(/<div class="kb-detail-mosaic"([^>]*)>([\s\S]*?)<\/div>/);
 assert.ok(mosaic);assert.match(mosaic[1],/aria-hidden="true"/);assert.equal((mosaic[2].match(/<span><\/span>/g)||[]).length,4);
 assert.equal(visibleText(mosaic[2]).trim(),'');assert.doesNotMatch(mosaic[0],/tabindex|onclick|<button|<a\b|role=/);
});

test('section and source labels style existing metadata without duplicating their numbers',()=>{
 const html=harness([{t:'资料',known:[{text:'## 条款资料\n金额为157亿元，条件待核实。',sourceFile:'04_policy_trends.md',origin:'report'}]}]).render();
 assert.equal((html.match(/class="kb-detail-section-label"/g)||[]).length,1);
 assert.match(html,/<span class="kb-detail-section-label">资料 01<\/span>/);
 assert.equal((html.match(/class="kb-detail-source-label"/g)||[]).length,1);
 assert.match(html,/<span class="kb-detail-source-label" title="04_policy_trends\.md">政策与规划<\/span>/);
 assert.equal((html.match(/资料 01/g)||[]).length,1);assert.equal((html.match(/157亿元/g)||[]).length,1);
});

test('caution accents preserve each original phrase along with citation and year notes',()=>{
 const original='待核实、待核验、待确认、待校核。来源[1][7]（统计年份2025，待核实）';
 const html=render(original),marks=[...html.matchAll(/<span class="kb-detail-caution">([^<]+)<\/span>/g)].map(m=>m[1]);
 assert.deepEqual(marks,['待核实','待核验','待确认','待校核','待核实']);assert.equal(visibleText(html),original);
 assert.match(html,/<span class="kb-detail-citation">来源\[1\]\[7\]<\/span>/);
 assert.match(html,/<span class="kb-detail-note">（统计年份2025，/);
});

test('caution decoration skips attributes and protected URL targets while keeping rich-text emphasis',()=>{
 const c=harness().c,input='<p title="待核实" data-note="待确认">待核验</p>',decorated=c.kbDetailDecorateHtml(input);
 assert.match(decorated,/<p title="待核实" data-note="待确认">/);
 assert.equal((decorated.match(/class="kb-detail-caution"/g)||[]).length,1);
 assert.match(decorated,/<span class="kb-detail-caution">待核验<\/span>/);
 const url='https://example.com/待确认?kind=待核实&from=1',html=render('**待校核** '+url);
 assert.match(html,/<strong><span class="kb-detail-caution">待校核<\/span><\/strong>/);
 assert.equal((html.match(/class="kb-detail-caution"/g)||[]).length,1);
 assert.ok(html.includes('href="'+url.replace(/&/g,'&amp;')+'"'));assert.ok(html.includes('title="'+url.replace(/&/g,'&amp;')+'"'));
});

function cssRuleParents(css,selector){
 css=css.replace(/\/\*[\s\S]*?\*\//g,'');const matches=[];let stack=[],start=0,quote=null;
 for(let i=0;i<css.length;i++){
  const c=css[i];if(quote){if(c==='\\')i++;else if(c===quote)quote=null;continue;}if(c==='"'||c==="'"){quote=c;continue;}
  if(c==='{'){
   const name=css.slice(start,i).trim();if(name===selector)matches.push(stack.slice());stack.push(name);start=i+1;
  }else if(c==='}'){stack.pop();start=i+1;}
 }
 return matches;
}
test('all topic palettes and the decorative mosaic apply at desktop as well as mobile widths',()=>{
 const css=fs.readFileSync(path.join(root,'frontend/index/style-01.css'),'utf8');
 for(const selector of ['.kb-detail-dialog[data-kb-theme="teal"]','.kb-detail-dialog[data-kb-theme="violet"]','.kb-detail-dialog[data-kb-theme="amber"]','.kb-detail-mosaic']){
  assert.ok(cssRuleParents(css,selector).some(parents=>!parents.some(p=>/^@media\b/.test(p))),selector+' needs a viewport-independent rule');
 }
 assert.match(css,/\.kb-detail-mosaic\{[^}]*pointer-events:none/);
});

test('editor overlays the reader, preserves all reader nodes and restores original inert state on cancel',()=>{
 const known=[{text:'## 政策原文\n完整条件。',origin:'report'}],h=actionHarness(known),readers=h.readers().slice(),dialog=h.dialog(),before=JSON.stringify(known);
 readers[0]._html='reader stays unchanged';assert.equal(h.c.editKbItem(0,0),true);
 assert.equal(h.panel().parentNode,dialog);assert.equal(dialog.classList.contains('is-editing'),true);
 assert.ok(readers.every(node=>node.hasAttribute('inert')));assert.equal(readers[0].innerHTML,'reader stays unchanged');
 assert.equal(h.panel().getAttribute('role'),'region');assert.equal(h.panel().getAttribute('data-mode'),'edit');
 assert.equal(h.c.kbCancelEdit(),true);assert.equal(h.panel(),undefined);assert.equal(h.c.kbEditSession,null);
 assert.equal(dialog.classList.contains('is-editing'),false);assert.deepEqual(readers.map(node=>node.hasAttribute('inert')),[false,true,false]);
 assert.equal(JSON.stringify(known),before);assert.equal(h.effects.persist,0);assert.equal(h.confirms.length,0);
});

test('editor dirty status and character count are updated without changing stored knowledge',()=>{
 const known=['原始正文'],h=actionHarness(known);h.c.editKbItem(0,0);
 const initial=JSON.stringify(known);h.textarea().value='甲🌱\n乙';h.c.kbEditorChanged();
 assert.equal(h.nodes.get('kbEditorCount').textContent,'4 字符');assert.equal(h.nodes.get('kbEditorStatus').textContent,'有未保存修改');
 assert.equal(JSON.stringify(known),initial);assert.equal(h.effects.persist,0);
 h.textarea().value=' \n';h.c.kbEditorChanged();assert.equal(h.nodes.get('kbEditorSave').disabled,true);
 h.textarea().value='原始正文';h.c.kbEditorChanged();assert.equal(h.nodes.get('kbEditorStatus').textContent,'尚未修改');
});

test('editor preview uses the safe real formatter while keeping the editable draft and knowledge intact',()=>{
 const known=['原始正文'],h=actionHarness(known);h.c.editKbItem(0,0);
 const text='## 预览条款\n\n1. 条件待核实\n来源 https://example.com/100km?q=%E4%B8%AD&from=1\n</div><script>alert(1)</script>';
 h.textarea().value=text;h.c.kbSetEditorMode('preview');
 const preview=h.nodes.get('kbEditorPreview');assert.equal(preview.hidden,false);assert.equal(h.nodes.get('kbEditorInput').hidden,true);
 assert.match(preview.innerHTML,/<h2>预览条款<\/h2>/);assert.match(preview.innerHTML,/href="https:\/\/example.com\/100km\?q=%E4%B8%AD&amp;from=1"/);
 assert.doesNotMatch(preview.innerHTML,/<script\b/);assert.equal(h.textarea().value,text);assert.deepEqual(known,['原始正文']);
 assert.equal(h.nodes.get('kbEditorTabPreview').getAttribute('aria-selected'),'true');h.c.kbSetEditorMode('edit');
 assert.equal(preview.hidden,true);assert.equal(h.nodes.get('kbEditorInput').hidden,false);assert.equal(h.nodes.get('kbEditorTabEdit').getAttribute('aria-selected'),'true');assert.equal(h.effects.persist,0);
});

test('custom discard prompt preserves the exact editor and keeping it restores editable draft focus',()=>{
 const known=['原始正文'],h=actionHarness(known);h.c.editKbItem(0,0);const session=h.c.kbEditSession,panel=h.panel();h.textarea().value='未保存修改';
 h.c.kbSetEditorMode('preview');assert.equal(h.c.kbCancelEdit(),false);const prompt=h.nodes.get('kbEditorDiscard');
 assert.ok(prompt);assert.equal(prompt.parentNode,panel);assert.equal(prompt.getAttribute('role'),'alertdialog');assert.equal(prompt.getAttribute('aria-modal'),'true');
 assert.equal(prompt.getAttribute('aria-labelledby'),'kbEditorDiscardTitle');assert.ok(h.nodes.has('kbEditorDiscardTitle'));
 const controls=prompt.querySelectorAll('button');assert.equal(controls.length,2);assert.equal(controls[0].getAttribute('onclick'),'kbDiscardEdit()');assert.equal(controls[1].getAttribute('onclick'),'kbKeepEditing()');
 assert.equal(h.c.document.activeElement,controls[1]);assert.equal(h.c.kbEditSession,session);assert.equal(h.panel(),panel);assert.equal(h.textarea().value,'未保存修改');
 h.c.kbKeepEditing();assert.equal(h.nodes.has('kbEditorDiscard'),false);assert.equal(h.c.kbEditSession,session);assert.equal(h.panel(),panel);
 assert.equal(panel.getAttribute('data-mode'),'edit');assert.equal(h.c.document.activeElement,h.textarea());assert.equal(h.textarea().value,'未保存修改');
 assert.equal(h.confirms.length,0);assert.deepEqual(known,['原始正文']);assert.equal(h.effects.persist,0);
});

test('discard executes the pending intent once without writing or confirming the abandoned draft',()=>{
 const known=[{text:'原始正文',origin:'report',sources:[{url:'https://official.example/source'}]}],h=actionHarness(known),before=JSON.stringify(known);let callbacks=0;
 h.c.editKbItem(0,0);h.textarea().value='放弃的草稿';assert.equal(h.c.kbCancelEdit(false,()=>{callbacks++;}),false);
 h.c.kbKeepEditing();assert.equal(callbacks,0);assert.equal(h.c.kbEditSession.afterDiscard,null);
 assert.equal(h.c.kbCancelEdit(false,()=>{callbacks++;}),false);h.c.kbDiscardEdit();
 assert.equal(callbacks,1);assert.equal(h.c.kbEditSession,null);assert.equal(h.panel(),undefined);assert.equal(h.nodes.has('kbEditorDiscard'),false);
 h.c.kbDiscardEdit();assert.equal(callbacks,1);assert.equal(JSON.stringify(known),before);assert.deepEqual(h.c.KB_CONFIRMS,{});assert.equal(h.confirms.length,0);assert.equal(h.effects.persist,0);
});

test('opening another record respects dirty cancellation and never changes original record identity',()=>{
 const known=['第一条原文','第二条原文'],h=actionHarness(known);h.c.editKbItem(0,0);h.textarea().value='第一条草稿';const session=h.c.kbEditSession;
 assert.equal(h.c.editKbItem(0,1),false);assert.equal(h.c.kbEditSession,session);assert.equal(h.textarea().value,'第一条草稿');
 h.c.kbKeepEditing();assert.equal(h.c.kbEditSession,session);assert.equal(h.textarea().value,'第一条草稿');
 assert.equal(h.c.editKbItem(0,1),false);h.c.kbDiscardEdit();assert.equal(h.textarea().value,'第二条原文');assert.equal(h.c.kbEditSession.itemIdx,1);assert.deepEqual(known,['第一条原文','第二条原文']);assert.equal(h.effects.persist,0);assert.equal(h.confirms.length,0);
});

test('new entry starts as an empty local draft and cancellation leaves no placeholder or confirmation',()=>{
 const known=['已有正文'],h=actionHarness(known),before=JSON.stringify(known);assert.equal(h.c.addKbItem(0),true);
 assert.equal(h.textarea().value,'');assert.equal(h.c.kbEditSession.isNew,true);assert.equal(h.nodes.get('kbEditorSave').disabled,true);
 assert.equal(JSON.stringify(known),before);h.c.saveKbEdit(0,1);assert.equal(JSON.stringify(known),before);assert.equal(h.effects.persist,0);
 h.c.kbCancelEdit(true);assert.equal(JSON.stringify(known),before);assert.deepEqual(h.c.KB_CONFIRMS,{});
});

test('saving a new draft appends only once at the current end and records the actual index',()=>{
 const known=['已有正文'],h=actionHarness(known);h.c.addKbItem(0);h.textarea().value='## 新资料\n完整新条款\n来源：https://official.example/new';
 known.push('独立新增的另一条');h.c.saveKbEdit(0,1);
 assert.equal(known.length,3);assert.equal(known[0],'已有正文');assert.equal(known[1],'独立新增的另一条');assert.match(known[2].text,/^✅ ## 新资料\n/);
 assert.equal(known[2].origin,'user');assert.equal(known[2].account,'reviewer');assert.equal(h.c.KB_CONFIRMS['workspace-a'][0][2].status,'edited');
 h.c.saveKbEdit(0,1);assert.equal(known.length,3);assert.equal(h.effects.persist,1);assert.equal(h.effects.corpus,1);
});

test('saving a changed record preserves source metadata and updates only its original slot',()=>{
 const sourceMeta=freeze({url:'https://official.example/source'}),item={text:'⚠️ 原始条款\n来源：https://official.example/source',origin:'report',nature:'policy',sources:[sourceMeta]},known=['不相关第一条',item,'不相关末条'],h=actionHarness(known);
 h.c.editKbItem(0,1);h.textarea().value+='\n补充适用条件。';h.c.kbEditorChanged();h.c.saveKbEdit(0,1);
 assert.equal(known[1],item);assert.equal(item.sources[0],sourceMeta);assert.equal(item.nature,'policy');assert.equal(item.origin,'user');assert.equal(item.account,'reviewer');
 assert.equal(item.text,'✅ 原始条款\n来源：https://official.example/source\n补充适用条件。');assert.equal(known[0],'不相关第一条');assert.equal(known[2],'不相关末条');
 assert.equal(h.c.KB_CONFIRMS['workspace-a'][0][1].text,item.text.slice(2));assert.equal(h.effects.persist,1);assert.equal(h.scroll.scrollTop,123);
});

for(const change of ['workspace','project','topic','known-array','item-reference','item-content','index-shift','auth-epoch'])test('saving refuses stale editor after '+change,()=>{
 const item={text:'原始正文',origin:'report'},known=[item,{text:'相邻条目'}],h=actionHarness(known);h.c.editKbItem(0,0);h.textarea().value='本地尚未保存的修改';
 if(change==='workspace')h.c.cur='other';
 if(change==='project')h.c.P=()=>({city:'别处',kb:h.project.kb});
 if(change==='topic')h.project.kb[0]={...h.project.kb[0]};
 if(change==='known-array')h.project.kb[0].known=known.slice();
 if(change==='item-reference')known[0]={...item};
 if(change==='item-content')item.text='外部已经更新';
 if(change==='index-shift')known.shift();
 if(change==='auth-epoch')h.c._authEpoch++;
 const before=JSON.stringify(h.project),session=h.c.kbEditSession;h.c.saveKbEdit(0,0);
 assert.equal(JSON.stringify(h.project),before);assert.equal(h.effects.persist,0);assert.deepEqual(h.c.KB_CONFIRMS,{});
 assert.equal(h.c.kbEditSession,session);assert.equal(h.textarea().value,'本地尚未保存的修改');assert.ok(h.effects.toasts.length>0);
});

test('save with wrong target arguments cannot alter either record or close the current draft',()=>{
 const known=['第一条','第二条'],h=actionHarness(known);h.c.editKbItem(0,0);h.textarea().value='修改第一条';const session=h.c.kbEditSession;
 h.c.saveKbEdit(0,1);h.c.saveKbEdit(1,0);assert.deepEqual(known,['第一条','第二条']);assert.equal(h.c.kbEditSession,session);assert.equal(h.effects.persist,0);
});

test('detail close respects dirty editor cancellation rather than discarding draft',()=>{
 const known=['原始正文'],h=actionHarness(known);h.c.editKbItem(0,0);h.textarea().value='草稿';const modal=h.nodes.get('kbDetailModal');
 assert.equal(h.c.closeKbDetail(),false);assert.equal(h.nodes.get('kbDetailModal'),modal);assert.equal(h.textarea().value,'草稿');
 h.c.kbKeepEditing();assert.equal(h.nodes.get('kbDetailModal'),modal);assert.equal(h.c.closeKbDetail(),false);h.c.kbDiscardEdit();
 assert.equal(h.c.kbEditSession,null);assert.equal(h.nodes.has('kbDetailModal'),false);assert.deepEqual(known,['原始正文']);assert.equal(h.confirms.length,0);assert.equal(h.effects.persist,0);
});

test('late attachment parsing cannot write into a cancelled and reopened editor',async()=>{
 const known=['原文'],h=actionHarness(known);h.c.editKbItem(0,0);const oldTextarea=h.textarea();let finish;
 h.c.ingestFiles=()=>new Promise(resolve=>{finish=resolve;});const waiting=h.c.processEditFiles([{name:'证明.txt'}],0,0);
 h.c.kbCancelEdit(true);h.c.editKbItem(0,0);const current=h.textarea();
 finish([{name:'证明.txt',_originalReceipt:{fileChunks:[{text:'晚到附件内容'}]}}]);await waiting;
 assert.equal(current.value,'原文');assert.equal(oldTextarea.value,'原文');assert.deepEqual(known,['原文']);assert.equal(h.effects.persist,0);
});

test('successful same-session attachment updates draft and character status without saving knowledge',async()=>{
 const known=['原文'],h=actionHarness(known);h.c.editKbItem(0,0);
 h.c.ingestFiles=async()=>[{name:'证明.txt',_originalReceipt:{fileChunks:[{text:'完整附件摘要'}]}}];
 await h.c.processEditFiles([{name:'证明.txt'}],0,0);
 assert.equal(h.textarea().value,'原文\n[证明.txt] 完整附件摘要');assert.equal(h.nodes.get('kbEditorStatus').textContent,'有未保存修改');
 assert.equal(h.nodes.get('kbEditorCount').textContent,Array.from(h.textarea().value).length+' 字符');assert.deepEqual(known,['原文']);assert.equal(h.effects.persist,0);
});

function keyEvent(key,extra={}){return {key,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};}
test('editor keyboard save respects composition and ordinary Enter while explicit shortcuts save',()=>{
 const known=['原文'],h=actionHarness(known);h.c.editKbItem(0,0);h.textarea().value='修改正文';
 for(const event of [keyEvent('Enter'),keyEvent('Enter',{ctrlKey:true,isComposing:true}),keyEvent('Enter',{metaKey:true,keyCode:229})]){h.c.kbEditKey(event);assert.equal(event.prevented,undefined);assert.equal(h.effects.persist,0);}
 const save=keyEvent('Enter',{ctrlKey:true});h.c.kbEditKey(save);assert.equal(save.prevented,true);assert.equal(h.effects.persist,1);assert.equal(known[0].text,'✅ 修改正文');assert.equal(h.c.kbEditSession,null);
 const other=actionHarness(['原文']);other.c.editKbItem(0,0);other.textarea().value='另一段';other.c.kbEditKey(keyEvent('Enter',{metaKey:true}));assert.equal(other.effects.persist,1);
});

test('Escape opens a page prompt then keeps the draft when dismissing that prompt and never saves',()=>{
 const h=actionHarness(['原文']);h.c.editKbItem(0,0);h.textarea().value='草稿';const session=h.c.kbEditSession;
 const event=keyEvent('Escape');h.c.kbEditKey(event);assert.equal(event.prevented,true);assert.equal(event.stopped,true);assert.equal(h.c.kbEditSession,session);assert.equal(h.effects.persist,0);assert.ok(h.nodes.has('kbEditorDiscard'));
 h.c.kbEditKey(keyEvent('Escape'));assert.equal(h.c.kbEditSession,session);assert.equal(h.nodes.has('kbEditorDiscard'),false);assert.equal(h.textarea().value,'草稿');assert.equal(h.c.document.activeElement,h.textarea());assert.equal(h.effects.persist,0);assert.equal(h.confirms.length,0);
});

test('Tab and Shift+Tab wrap only at the editor focus boundaries',()=>{
 const h=actionHarness(['原文']);h.c.editKbItem(0,0);const controls=h.panel().querySelectorAll('button,textarea,input,[tabindex]').filter(n=>!n.disabled&&n.getClientRects().length);
 assert.ok(controls.length>2);const first=controls[0],last=controls.at(-1);last.focus();const tab=keyEvent('Tab');h.c.kbEditKey(tab);assert.equal(tab.prevented,true);assert.equal(h.c.document.activeElement,first);
 const reverse=keyEvent('Tab',{shiftKey:true});h.c.kbEditKey(reverse);assert.equal(reverse.prevented,true);assert.equal(h.c.document.activeElement,last);
 controls[1].focus();const middle=keyEvent('Tab');h.c.kbEditKey(middle);assert.equal(middle.prevented,undefined);assert.equal(h.c.document.activeElement,controls[1]);
});

test('discard prompt confines Tab and Shift+Tab to its own actions instead of editor controls',()=>{
 const h=actionHarness(['原文']);h.c.editKbItem(0,0);h.textarea().value='草稿';h.c.kbCancelEdit();
 const prompt=h.nodes.get('kbEditorDiscard'),controls=prompt.querySelectorAll('button');assert.equal(controls.length,2);
 controls[1].focus();const forward=keyEvent('Tab');h.c.kbEditKey(forward);assert.equal(forward.prevented,true);assert.equal(h.c.document.activeElement,controls[0]);
 const backward=keyEvent('Tab',{shiftKey:true});h.c.kbEditKey(backward);assert.equal(backward.prevented,true);assert.equal(h.c.document.activeElement,controls[1]);
 assert.notEqual(h.c.document.activeElement,h.textarea());assert.equal(h.effects.persist,0);
});

test('discard prompt blocks direct and keyboard saving until editing is explicitly resumed',()=>{
 const known=['原文'],h=actionHarness(known);h.c.editKbItem(0,0);h.textarea().value='尚未确认的草稿';h.c.kbCancelEdit();const session=h.c.kbEditSession;
 h.c.saveKbEdit(0,0);for(const key of ['ctrlKey','metaKey']){const event=keyEvent('Enter',{[key]:true});h.c.kbEditKey(event);assert.equal(event.prevented,true);}
 assert.equal(h.c.kbEditSession,session);assert.ok(h.nodes.has('kbEditorDiscard'));assert.deepEqual(known,['原文']);assert.equal(h.effects.persist,0);assert.deepEqual(h.c.KB_CONFIRMS,{});
 h.c.kbKeepEditing();h.c.kbEditKey(keyEvent('Enter',{ctrlKey:true}));assert.equal(h.effects.persist,1);assert.equal(known[0].text,'✅ 尚未确认的草稿');assert.equal(h.c.kbEditSession,null);
});

test('changing details waits for discard and then follows the requested topic without saving a draft',()=>{
 const h=actionHarness(['政策原文']);h.project.kb.push({t:'园区',known:['园区原文']});h.c.editKbItem(0,0);h.textarea().value='政策草稿';const session=h.c.kbEditSession;
 h.c.kbDetail(1);assert.equal(h.c.kbEditSession,session);assert.equal(h.c.curKb,null);assert.ok(h.nodes.has('kbEditorDiscard'));
 h.c.kbKeepEditing();assert.equal(h.c.kbEditSession,session);assert.equal(h.textarea().value,'政策草稿');
 h.c.kbDetail(1);h.c.kbDiscardEdit();assert.equal(h.c.kbEditSession,null);assert.equal(h.c.curKb,1);assert.equal(h.effects.persist,0);assert.deepEqual(h.project.kb[0].known,['政策原文']);
});

test('new-entry intent waits for discard and creates no placeholder before or after opening',()=>{
 const known=['政策原文'],h=actionHarness(known);h.c.editKbItem(0,0);h.textarea().value='原条目草稿';assert.equal(h.c.addKbItem(0),false);
 assert.deepEqual(known,['政策原文']);assert.ok(h.nodes.has('kbEditorDiscard'));h.c.kbDiscardEdit();
 assert.equal(h.c.kbEditSession.isNew,true);assert.equal(h.c.kbEditSession.itemIdx,1);assert.equal(h.textarea().value,'');assert.deepEqual(known,['政策原文']);assert.equal(h.effects.persist,0);
});

test('beforeunload warns only for a changed current draft and is registered on the window',()=>{
 const h=actionHarness(['原文']);assert.equal(h.listeners.beforeunload,h.c.kbEditBeforeUnload);
 const outside=keyEvent('');h.listeners.beforeunload(outside);assert.equal(outside.prevented,undefined);
 h.c.editKbItem(0,0);const unchanged=keyEvent('');h.listeners.beforeunload(unchanged);assert.equal(unchanged.prevented,undefined);
 h.textarea().value='未保存的修改';const changed=keyEvent('');h.listeners.beforeunload(changed);assert.equal(changed.prevented,true);assert.equal(changed.returnValue,'');assert.equal(h.effects.persist,0);
 h.c.kbCancelEdit(true);const closed=keyEvent('');h.listeners.beforeunload(closed);assert.equal(closed.prevented,undefined);
});

test('file picker result opened by an old editor does not start ingestion after reopen',async()=>{
 const h=actionHarness(['原文']);h.c.editKbItem(0,0);let calls=0;h.c.ingestFiles=async()=>{calls++;return [];};
 h.c.editPickFile(0,0);const oldPicker=h.created.at(-1);assert.equal(oldPicker.clicked,true);oldPicker.files=[{name:'旧文件.txt'}];
 h.c.kbCancelEdit(true);h.c.editKbItem(0,0);oldPicker.onchange();await Promise.resolve();assert.equal(calls,0);assert.equal(h.textarea().value,'原文');
 h.c.editPickFile(0,0);const current=h.created.at(-1);current.files=[{name:'新文件.txt'}];current.onchange();await Promise.resolve();assert.equal(calls,1);
});

function changeEditorContext(h,change){
 if(change==='workspace')h.c.cur='workspace-b';
 else if(change==='auth-epoch')h.c._authEpoch++;
 else if(change==='same-key-project')h.c.P=()=>({city:h.project.city,kb:h.project.kb});
 else if(change==='topic-reference')h.project.kb[0]={...h.project.kb[0]};
 else throw Error('unknown change '+change);
}
for(const change of ['workspace','auth-epoch','same-key-project','topic-reference']){
 test('file picker and direct upload refuse stale '+change+' before any ingestion',async()=>{
  const known=['原文'],h=actionHarness(known);h.c.editKbItem(0,0);let calls=0;h.c.ingestFiles=async()=>{calls++;return [];};const created=h.created.length;
  changeEditorContext(h,change);h.c.editPickFile(0,0);assert.equal(h.created.length,created);
  await h.c.processEditFiles([{name:'应忽略.txt'}],0,0);assert.equal(calls,0);assert.equal(h.textarea().value,'原文');assert.deepEqual(known,['原文']);assert.equal(h.effects.persist,0);
 });
 test('an already open picker refuses stale '+change+' when its selection arrives',async()=>{
  const known=['原文'],h=actionHarness(known);h.c.editKbItem(0,0);let calls=0;h.c.ingestFiles=async()=>{calls++;return [];};
  h.c.editPickFile(0,0);const picker=h.created.at(-1);assert.equal(picker.clicked,true);picker.files=[{name:'旧选择.txt'}];
  changeEditorContext(h,change);picker.onchange();await Promise.resolve();assert.equal(calls,0);assert.equal(h.textarea().value,'原文');assert.deepEqual(known,['原文']);assert.equal(h.effects.persist,0);
 });
 test('an in-flight upload cannot append its result after stale '+change,async()=>{
  const known=['原文'],h=actionHarness(known);h.c.editKbItem(0,0);const ta=h.textarea(),status=h.nodes.get('kbEditorStatus');let finish,calls=0;
  h.c.ingestFiles=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};const pending=h.c.processEditFiles([{name:'晚到.txt'}],0,0);assert.equal(calls,1);
  changeEditorContext(h,change);finish([{name:'晚到.txt',_originalReceipt:{fileChunks:[{text:'不能串入的内容'}]}}]);await pending;
  assert.equal(ta.value,'原文');assert.equal(status.textContent,'尚未修改');assert.deepEqual(known,['原文']);assert.equal(h.effects.persist,0);
 });
}

test('saved result returns to its original item id even after its user status changes display order',()=>{
 const known=['第一条原文',{text:'第二条原文',origin:'report'}],h=actionHarness(known),lookups=[];
 const get=h.c.document.getElementById;h.c.document.getElementById=id=>{lookups.push(id);return get(id);};
 h.nodes.set('kb-card-0-0',{getBoundingClientRect:()=>({top:20})});h.nodes.set('kb-card-0-1',{getBoundingClientRect:()=>({top:330})});
 h.c.editKbItem(0,1);h.textarea().value='第二条修改后置顶';h.c.saveKbEdit(0,1);
 assert.equal(h.effects.persist,1);assert.equal(known[1].origin,'user');assert.ok(lookups.includes('kb-card-0-1'));assert.equal(h.scroll.scrollTop,333);
 assert.equal(known[0],'第一条原文');assert.equal(h.effects.toasts.at(-1),'修改已在当前页面生效');
});
