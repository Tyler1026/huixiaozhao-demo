'use strict';
// Actual read-only renderers with synthetic in-memory stores. No HTTP, DB or model calls.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const source={known:read('frontend/index/script-02-sections/01.js'),auth:read('frontend/index/script-02-sections/03.js'),detail:read('frontend/index/script-02-sections/14-tail.js'),memory:read('frontend/index/script-02-sections/12-tail.js')};
function between(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,'actual source boundaries: '+start);return text.slice(a,b);}
const actual=[read('frontend/shared/kb-materials.js'),read('frontend/index/kb-presentation.js'),
  between(source.auth,'function _authProjectKeys()','function _authFilterProjects('),
  between(source.detail,'function uploadOriginalUrl(','function originalUploadEpoch('),
  read('frontend/index/uploaded-materials.js'),
  between(read('frontend/index/script-02-sections/00.js'),'function reportMdToHtml(','/* 所有导出从当前方向取正文'),
  between(source.known,'function _kbText(','// === AI精选概括'),
  between(source.known,'function _kbNums(','function _getDisplayKnown('),
  between(source.known,'function _getDisplaySub(','function _kbMeta('),
  between(source.detail,'function kbEscape(','function kbSelectionCache('),
  between(source.detail,'function kbDetailSourceText(','function kbRefreshTopicScope('),
  between(source.memory,'function memFileView()','function memChatView(')
].join('\n');
const A='a'.repeat(32),B='b'.repeat(32),C='c'.repeat(32);
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function harness(){
  const nodes=new Map(),appended=[],effects=[];
  function element(tag){return {tagName:tag.toUpperCase(),id:'',html:'',parentNode:null,style:{},
    set innerHTML(value){this.html=String(value);},get innerHTML(){return this.html;},
    get firstChild(){const match=this.html.match(/^<div id="([^"]+)"/),child=element('div');child.id=match?match[1]:'';child.innerHTML=this.html;return child;},
    querySelector(){return null;},querySelectorAll(){return [];},
    remove(){nodes.delete(this.id);if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}};}
  const body={children:[],appendChild(node){this.children.push(node);node.parentNode=this;nodes.set(node.id,node);appended.push(node);return node;}};
  const c={console,Math,Number,String,Object,Array,JSON,URL,AbortController,encodeURIComponent,setTimeout,clearTimeout,
    AUTH:{user:'member-a',scope:'project',projKey:'w',projectKeys:['w']},_authState:'ready',_authEpoch:4,cur:'w',curKb:null,
    PROJECTS:{w:{workspaceId:'w',city:'合成城市',kb:[{t:'政策',known:[],calls:[]},{t:'园区',known:[],calls:[]}]},
      sub:{workspaceId:'w',city:'合成城市',kb:[{t:'政策',known:[],calls:[]}]},
      other:{workspaceId:'other',city:'另一城市',kb:[{t:'政策',known:[],calls:[]}] }},
    UPLOADS:{w:[],sub:[],other:[]},KB_FILE_CHUNKS:{w:[],sub:[],other:[]},UPLOAD_TOMBS:{},KB_EDITS:{},KB_CONFIRMS:{},RESET_GEN:'synthetic',
    P(){return c.PROJECTS[c.cur];},kbCancelEdit:()=>true,kbEditSession:null,
    confirmKbItem:(...args)=>effects.push(['confirm',...args]),editKbItem:(...args)=>effects.push(['edit',...args]),deleteKbItem:(...args)=>effects.push(['delete',...args]),
    document:{body,head:{appendChild(node){nodes.set(node.id,node);}},getElementById:id=>nodes.get(id)||null,createElement:element},
    fetch(){throw new Error('Network forbidden in read-only renderer test');},persist(){throw new Error('Persist forbidden in read-only renderer test');},
    fmtTs:()=>'',cityKeys:()=>['w','sub'],memEmpty:text=>text};
  c.window=c;vm.createContext(c);vm.runInContext(actual,c);c._authEscape=c.kbEscape;
  function add(id=A,{key='w',name='合成材料.docx',topic=0,count=27,indices,receipt={},chunk={}}={}){
    const row={name,originalId:id,projectKey:key,kbIdx:topic,chunks:count,originalSha256:'d'.repeat(64),size:1024,...receipt};
    c.UPLOADS[key].push(row);
    (indices||Array.from({length:count},(_,i)=>i)).forEach(i=>c.KB_FILE_CHUNKS[key].push({id:'upload:'+id+':'+i,originalId:id,projectKey:key,text:'正文片段 '+i+'\n第 '+i+' 项末尾保留。',...chunk}));
    return row;
  }
  function open(id=A,key='w'){return c.kbOpenUploadedMaterial(key,id,c._authEpoch,c.AUTH&&c.AUTH.user,c.cur);}
  return {c,nodes,appended,effects,add,open,reader:()=>nodes.get('kbUploadedMaterialReader'),detail(index=0){c.kbDetail(index);return nodes.get('kbDetailModal').innerHTML;}};
}
test('27 chunks are numerically ordered and the actual reader renders the final full chunk',()=>{
  const h=harness();h.add(A,{indices:[...Array(27).keys()].reverse()});const group=h.c.kbUploadedMaterialGroups('w',0)[0];
  assert.equal(group.complete,true);assert.deepEqual(Array.from(group.items,x=>x.index),[...Array(27).keys()]);
  assert.equal(h.open(),true);const html=h.reader().innerHTML;
  assert.equal((html.match(/data-upload-chunk=/g)||[]).length,27);assert.match(html,/正文片段 26\n第 26 项末尾保留。/);
  assert.ok(html.indexOf('正文片段 2\n')<html.indexOf('正文片段 10\n'));assert.match(html,/已保存全部 27 个片段/);
});
test('the actual reader layers above the existing topic detail using the real CSS z-index values',()=>{
  const css=read('frontend/index/style-01.css');
  function declaredZIndex(selector){
    let value;
    for(const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
      if(!rule[1].split(',').map(s=>s.trim()).includes(selector))continue;
      const declaration=rule[2].match(/(?:^|;)\s*z-index\s*:\s*(-?\d+)\s*(?:;|$)/);
      if(declaration)value=Number(declaration[1]);
    }
    assert.equal(typeof value,'number','actual CSS declares '+selector+' stacking level');return value;
  }
  const detailZ=declaredZIndex('.kb-detail-overlay'),defaultModalZ=declaredZIndex('.modal-layer');
  const h=harness();h.add(A,{count:1});h.detail();assert.equal(h.open(),true);
  const inlineZ=h.reader().style.zIndex;
  const readerZ=inlineZ===undefined||inlineZ===''?defaultModalZ:Number(inlineZ);
  assert.ok(Number.isFinite(readerZ)&&readerZ>detailZ,'reader z-index '+readerZ+' must exceed topic detail '+detailZ+' (default modal '+defaultModalZ+')');
});
test('same filename with two durable IDs remains two files and each reader has the exact original download',()=>{
  const h=harness();h.add(A,{count:1,name:'同名.docx'});h.add(B,{count:1,name:'同名.docx',chunk:{text:'第二份独立正文'}});
  assert.equal(h.c.kbUploadedMaterialGroups('w',0).length,2);
  h.open(A);assert.match(h.reader().innerHTML,new RegExp('uploadId='+A));assert.doesNotMatch(h.reader().innerHTML,/第二份独立正文/);
  h.open(B);assert.match(h.reader().innerHTML,new RegExp('uploadId='+B));assert.match(h.reader().innerHTML,/第二份独立正文/);
  assert.equal(h.c.document.body.children.filter(n=>n.id==='kbUploadedMaterialReader').length,1);
});
test('topic selection uses the receipt topic and never imports another topic or detached chunk',()=>{
  const h=harness();h.add(A,{topic:0,count:1});h.add(B,{topic:1,count:1});h.c.KB_FILE_CHUNKS.w.push({id:'upload:'+C+':0',originalId:C,text:'无回执孤立正文'});
  assert.deepEqual(Array.from(h.c.kbUploadedMaterialGroups('w',0),g=>g.originalId),[A]);
  assert.deepEqual(Array.from(h.c.kbUploadedMaterialGroups('w',1),g=>g.originalId),[B]);
  for(const index of [-1,2,0.5,'0',undefined])assert.equal(h.c.kbUploadedMaterialGroups('w',index).length,0);
  assert.equal(h.c.kbUploadedMaterialGroups('w',null).length,2);
});
test('a receipt claiming a foreign project and a chunk claiming a foreign project cannot supply complete body',()=>{
  const h=harness();h.add(A,{count:1,receipt:{projectKey:'other'}});h.add(B,{count:1,chunk:{projectKey:'other'}});
  const groups=h.c.kbUploadedMaterialGroups('w',0);assert.equal(groups.length,1);assert.equal(groups[0].originalId,B);
  assert.equal(groups[0].items.length,0);assert.equal(groups[0].complete,false);assert.equal(h.open(B),false);
});
test('current workspace authorization rejects foreign workspace even when its data is cached',()=>{
  const h=harness();h.add(A,{key:'other',count:1});
  assert.equal(h.c.kbUploadedMaterialGroups('other',null).length,0);assert.equal(h.c.kbUploadedMaterialSection('other',0),'');assert.equal(h.open(A,'other'),false);
  h.c.AUTH.projectKeys.push('other');assert.equal(h.open(A,'other'),false);
});
test('memory may read a sibling project in the same authorized workspace and binds the current view',()=>{
  const h=harness();h.add(A,{key:'sub',count:1});assert.equal(h.open(A,'sub'),true);assert.equal(h.c.KB_UPLOADED_READER_CONTEXT.viewKey,'w');
  assert.match(h.c.memFileView(),/kbOpenUploadedMaterial/);assert.match(h.reader().innerHTML,/projectKey=sub/);
});
test('anonymous, checking, nonproject, and inconsistent authorization states expose no read control',()=>{
  for(const mutate of [c=>c.AUTH=null,c=>c._authState='checking',c=>c.AUTH.scope='admin',c=>c.AUTH.scope='user',c=>c.AUTH.user='',c=>c.AUTH.projectKeys=[],c=>c.AUTH.projKey='other',c=>c.cur='missing']){
    const h=harness();h.add(A,{count:1});mutate(h.c);assert.equal(h.c.kbUploadedMaterialGroups('w',0).length,0);assert.equal(h.c.kbUploadedMaterialReadButton('w',A),'');assert.equal(h.open(),false);
  }
});
test('duplicate receipt IDs are ambiguous even if names or statuses differ',()=>{
  const h=harness();const row=h.add(A,{count:1});h.c.UPLOADS.w.push({...row,name:'另一文件.docx',deleted:true});
  assert.equal(h.c.kbUploadedMaterialGroups('w',0).length,0);assert.equal(h.open(),false);assert.match(h.c.kbUploadedMaterialReadButton('w',A),/原件关联不可用/);
});
test('unknown and malformed durable IDs cannot be read',()=>{
  const h=harness();h.add(A,{count:1});h.c.UPLOADS.w.push({name:'坏id',originalId:'not-durable',kbIdx:0,chunks:1});
  assert.equal(h.c.kbUploadedMaterialGroups('w',0).length,1);assert.equal(h.open(B),false);assert.equal(h.open('not-durable'),false);
});
test('deleted receipt and name tombstone suppress the reading association',()=>{
  for(const mutate of [(h,row)=>row.deleted=true,(h,row)=>h.c.UPLOAD_TOMBS['w::'+row.name]=123]){
    const h=harness(),row=h.add(A,{count:1});mutate(h,row);assert.equal(h.c.kbUploadedMaterialGroups('w',0).length,0);assert.equal(h.open(),false);
  }
});
test('pending and failed receipts retain explicit status but expose no saved body or read button',()=>{
  for(const [flag,status] of [['pending','解析中'],['parseFailed','解析失败']]){
    const h=harness();h.add(A,{count:1,receipt:{[flag]:true}});const group=h.c.kbUploadedMaterialGroups('w',0)[0];
    assert.equal(group.items.length,0);assert.equal(group.complete,false);assert.match(group.status,new RegExp(status));assert.equal(h.open(),false);
    assert.doesNotMatch(h.c.kbUploadedMaterialSection('w',0),/kbOpenUploadedMaterial/);
  }
});
test('deleted, pending, failed and whitespace-only chunks cannot count as complete body',()=>{
  for(const chunk of [{deleted:true},{pending:true},{parseFailed:true},{text:' \n\t'}]){
    const h=harness();h.add(A,{count:1,chunk});const g=h.c.kbUploadedMaterialGroups('w',0)[0];
    assert.equal(g.items.length,0);assert.equal(g.complete,false);assert.match(g.status,/暂无可阅读片段/);
  }
});
test('a missing middle chunk produces explicitly partial reading and never a full-text label',()=>{
  const h=harness();h.add(A,{count:3,indices:[0,2]});const group=h.c.kbUploadedMaterialGroups('w',0)[0];
  assert.equal(group.complete,false);assert.match(group.status,/2 \/ 3.*尚不完整/);assert.match(h.c.kbUploadedMaterialReadButton('w',A),/查看已保存片段/);
  assert.doesNotMatch(h.c.kbUploadedMaterialReadButton('w',A),/阅读全文/);assert.equal(h.open(),true);assert.match(h.reader().innerHTML,/尚不完整/);
});
test('unknown expected count stays partial, while zero extracted chunks is honestly empty',()=>{
  const h=harness();h.add(A,{count:1,receipt:{chunks:null}});h.add(B,{count:0});
  const [unknown,empty]=h.c.kbUploadedMaterialGroups('w',0);assert.equal(unknown.complete,false);assert.match(unknown.status,/总数未知/);
  assert.equal(empty.complete,false);assert.match(empty.status,/暂无可阅读片段/);assert.equal(h.open(B),false);
});
test('duplicate chunk positions are omitted instead of choosing one arbitrary body',()=>{
  const h=harness();h.add(A,{count:3});h.c.KB_FILE_CHUNKS.w.push({id:'upload:'+A+':1',originalId:A,text:'冲突片段内容'});
  const group=h.c.kbUploadedMaterialGroups('w',0)[0];assert.equal(group.complete,false);assert.deepEqual(Array.from(group.items,x=>x.index),[0,2]);
  assert.equal(h.open(),true);assert.doesNotMatch(h.reader().innerHTML,/冲突片段内容|正文片段 1\n/);
});
test('foreign, leading-zero, negative and unsafe chunk indexes cannot certify complete reading',()=>{
  for(const id of ['upload:'+B+':0','upload:'+A+':01','upload:'+A+':-1','upload:'+A+':9007199254740992','unknown']){
    const h=harness();h.add(A,{count:1});h.c.KB_FILE_CHUNKS.w.push({id,originalId:A,text:'错误索引正文'});
    const group=h.c.kbUploadedMaterialGroups('w',0)[0];assert.equal(group.complete,false);assert.equal(group.items.length,1);assert.doesNotMatch(h.c.kbUploadedMaterialSection('w',0),/阅读全文/);
  }
});
test('extra saved chunk indexes remain visible with incomplete status rather than being silently truncated',()=>{
  const h=harness();h.add(A,{count:1,indices:[0,1]});const g=h.c.kbUploadedMaterialGroups('w',0)[0];
  assert.equal(g.complete,false);assert.equal(g.items.length,2);assert.match(g.status,/2 \/ 1.*尚不完整/);h.open();assert.match(h.reader().innerHTML,/正文片段 1\n/);
});
test('known missing or integrity-failed originals retain saved body with explicit original warning and partial-reading label',()=>{
  for(const code of ['original_not_found','original_integrity_failed']){
    const h=harness();h.add(A,{count:1,receipt:{chunkRepair:{code,status:'failed'}}});
    const group=h.c.kbUploadedMaterialGroups('w',0)[0];assert.equal(group.items.length,1);assert.equal(group.originalUnavailable,true);
    assert.match(group.status,/原件待检查/);assert.match(h.c.kbUploadedMaterialReadButton('w',A),/查看已保存片段/);
    assert.doesNotMatch(h.c.kbUploadedMaterialReadButton('w',A),/阅读全文/);assert.equal(h.open(),true);assert.match(h.reader().innerHTML,/原件待检查/);
    assert.match(h.reader().innerHTML,/记录的原件 SHA256：/);assert.doesNotMatch(h.reader().innerHTML,/已验证原件|原件验证通过/);
  }
});
test('a newly learned original integrity failure invalidates an already open reader',()=>{
  const h=harness(),row=h.add(A,{count:1});h.open();row.chunkRepair={status:'failed',code:'original_integrity_failed'};
  h.c.kbCancelStaleUploadedMaterialReader();assert.equal(h.reader(),undefined);assert.equal(h.c.KB_UPLOADED_READER_CONTEXT,null);
  assert.equal(h.open(),true);assert.match(h.reader().innerHTML,/原件待检查/);
});
test('names, body and SHA display are escaped and no raw active HTML enters the reader',()=>{
  const h=harness();h.add(A,{count:1,name:'</h2><img src=x onerror="pwn()">.docx',chunk:{text:'<script>pwn()</script>\n</pre><svg onload="pwn()"> & "quoted"'}});
  assert.equal(h.open(),true);const html=h.reader().innerHTML;assert.doesNotMatch(html,/<script|<img|<svg|onload="pwn\(\)"/);
  assert.match(html,/&lt;script&gt;pwn\(\)&lt;\/script&gt;/);assert.match(html,/&amp; &quot;quoted&quot;/);assert.match(html,/原件 SHA256：d{64}/);
});
test('read button safely captures quote-bearing user and project strings as exact arguments',()=>{
  const h=harness(),key='w\"<&',user='u\";pwn();//<&';h.c.PROJECTS[key]=h.c.PROJECTS.w;h.c.UPLOADS[key]=[];h.c.KB_FILE_CHUNKS[key]=[];
  h.c.cur=key;h.c.AUTH={scope:'project',user,projKey:key,projectKeys:[key]};h.add(A,{key,count:1});
  const html=h.c.kbUploadedMaterialReadButton(key,A);assert.doesNotMatch(html,/<&|";pwn/);
  const attribute=html.match(/onclick="([^"]+)"/)[1];const decoded=attribute.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  vm.runInContext(decoded,h.c);assert.equal(h.c.KB_UPLOADED_READER_CONTEXT.key,key);assert.equal(h.c.KB_UPLOADED_READER_CONTEXT.user,user);assert.equal(h.c.pwn,undefined);
});
test('stale captured epoch, account and view refuse to open a reader',()=>{
  for(const [epoch,user,view] of [[3,'member-a','w'],[4,'old-account','w'],[4,'member-a','sub']]){
    const h=harness();h.add(A,{count:1});assert.equal(h.c.kbOpenUploadedMaterial('w',A,epoch,user,view),false);assert.equal(h.reader(),undefined);
  }
});
test('live receipt revalidation refuses a previously rendered button after deletion or parse failure',()=>{
  for(const mutate of [(h,row)=>h.c.UPLOADS.w=[],(h,row)=>row.deleted=true,(h,row)=>row.parseFailed=true]){
    const h=harness(),row=h.add(A,{count:1});assert.match(h.c.kbUploadedMaterialReadButton('w',A),/kbOpenUploadedMaterial/);mutate(h,row);assert.equal(h.open(),false);assert.equal(h.reader(),undefined);
  }
});
test('existing reader closes on account, epoch, active view, workspace or body association change',()=>{
  for(const mutate of [h=>h.c.AUTH.user='next-account',h=>h.c._authEpoch++,h=>h.c.cur='sub',h=>h.c.AUTH.projKey='other',h=>h.c.UPLOADS.w=[],h=>h.c.UPLOAD_TOMBS['w::合成材料.docx']=1,h=>h.c.KB_FILE_CHUNKS.w[0].text='正文已变化',h=>h.c.UPLOADS.w[0].parseFailed=true]){
    const h=harness();h.add(A,{count:1});h.open();mutate(h);h.c.kbCancelStaleUploadedMaterialReader();assert.equal(h.reader(),undefined);assert.equal(h.c.KB_UPLOADED_READER_CONTEXT,null);
  }
});
test('unchanged live reader survives validation; close and backdrop release all reader state',()=>{
  const h=harness();h.add(A,{count:1});h.open();const reader=h.reader();h.c.kbCancelStaleUploadedMaterialReader();assert.equal(h.reader(),reader);
  reader.onclick({target:{}});assert.equal(h.reader(),reader);reader.onclick({target:reader});assert.equal(h.reader(),undefined);assert.equal(h.c.KB_UPLOADED_READER_CONTEXT,null);
  h.open();h.c.kbCloseUploadedMaterialReader();h.c.kbCloseUploadedMaterialReader();assert.equal(h.reader(),undefined);
});
test('actual topic detail replaces only exact upload placeholders with an independent read-only file section',()=>{
  const h=harness();h.add(A);h.c.PROJECTS.w.kb[0].known=['📎 合成材料.docx 已解析（27 片段）'];
  const html=h.detail();assert.match(html,/上传材料正文/);assert.match(html,/1 个文件 · 27 个已保存片段 · 1 项原件来源/);assert.match(html,/kbOpenUploadedMaterial/);
  assert.doesNotMatch(html,/来源未标注|class="kb-detail-edit"|confirmKbItem\(|deleteKbItem\(/);
  assert.equal(h.open(),true);assert.match(h.reader().innerHTML,/正文片段 26\n/);
});
test('placeholder filtering preserves editable original indexes and does not hide genuine structured or similar knowledge',()=>{
  const h=harness();h.add(A,{count:1});const known=h.c.PROJECTS.w.kb[0].known;
  known.push('📎 合成材料.docx 已解析（1 片段）',{text:'用户人工补充的适用条件完整保留。',origin:'user'},'📎 另一材料.docx 已解析（1 片段）');
  const html=h.detail();assert.match(html,/editKbItem\(0,1,-1\)/);assert.match(html,/deleteKbItem\(0,1\)/);assert.match(html,/另一材料.docx 已解析/);
  assert.equal(h.c.kbUploadedPlaceholder({text:known[0]},h.c.kbUploadedMaterialGroups('w',0)),false);
});
test('all read operations preserve stores, source known entries, confirmations, revisions and RAG projection byte for byte',()=>{
  const h=harness();h.add(A);h.c.PROJECTS.w.kb[0].known=['📎 合成材料.docx 已解析（27 片段）',{text:'人工补充不改变。',origin:'user'}];
  const snapshot=()=>JSON.stringify([h.c.PROJECTS,h.c.UPLOADS,h.c.KB_FILE_CHUNKS,h.c.UPLOAD_TOMBS,h.c.KB_EDITS,h.c.KB_CONFIRMS]);
  const before=snapshot(),rag=JSON.stringify(h.c.kbEffectiveKnown(h.c.PROJECTS.w,0,'w'));
  [h.c.PROJECTS,h.c.UPLOADS,h.c.KB_FILE_CHUNKS,h.c.UPLOAD_TOMBS,h.c.KB_EDITS,h.c.KB_CONFIRMS].forEach(freeze);
  h.c.kbUploadedMaterialGroups('w',0);h.c.kbUploadedMaterialSection('w',0);h.c._getDisplaySub(0);h.c._getDisplayTag(0);h.c.memFileView();h.detail();h.open();h.c.kbCancelStaleUploadedMaterialReader();h.c.kbCloseUploadedMaterialReader();
  assert.equal(snapshot(),before);assert.equal(JSON.stringify(h.c.kbEffectiveKnown(h.c.PROJECTS.w,0,'w')),rag);assert.deepEqual(h.effects,[]);
});
