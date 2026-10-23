'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const materials=read('frontend/shared/kb-materials.js'),sync=read('frontend/shared/sync-feedback.js');
const tail=read('frontend/index/script-02-sections/14-tail.js'),ops=read('frontend/ops/script-03-sections/17.js'),layout=read('frontend/index/script-02-sections/12-tail.js');
function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
function context(extra={}){
  const nodes={},posts=[],toasts=[];
  function element(){return {style:{},children:[],textContent:'',setAttribute(){},appendChild(item){this.children.push(item);if(item.id)nodes[item.id]=item;},remove(){if(this.id)delete nodes[this.id];}};}
  const c={console,JSON,Object,Array,Number,String,Math,Date,Promise,AbortController,TextDecoder,setTimeout,clearTimeout,
    AUTH:{user:'tester',scope:'user'},_authEpoch:1,_authState:'ready',cur:'a',RESET_GEN:'g1',
    PROJECTS:{a:{city:'测试区',kb:[{t:'园区',known:[{text:'产值10亿元',nature:'base'}]}]}},KB_EDITS:{},KB_FILE_CHUNKS:{},UPLOAD_TOMBS:{},KB_CONFIRMS:{},
    document:{body:element(),getElementById:id=>nodes[id]||null,createElement:element},
    P:()=>c.PROJECTS[c.cur],toast:x=>toasts.push(x),topicTags:()=>[],refreshKbProgress(){},render(){},renderOpsV2(){},closeModal(){},
    fetch:async(url,options)=>{posts.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true})};},...extra};
  c.window=c;vm.createContext(c);vm.runInContext(materials+'\n'+sync,c);return {c,nodes,posts,toasts};
}
function edit(c){const raw=c.PROJECTS.a.kb[0].known[0];c.KB_EDITS.a={e1:{id:'e1',sectionIndex:0,sectionTitle:'园区',sourceIndex:0,sourceItem:raw,baseReportVersion:null,text:'产值28亿元，白鹭842',status:'edited',revision:1,ts:1,account:'tester'}};}
function receipt(body,id='saved'){return {id,sectionIndex:body.sectionIndex,sectionTitle:body.sectionTitle,sourceIndex:body.sourceIndex,sourceItem:body.sourceItem,baseReportVersion:body.baseReportVersion,text:body.text||'deleted text',status:'edited',revision:body.expectedRevision+1,ts:2,account:'tester',...(body.action==='delete'?{deleted:true}:{})};}

test('shared corpus uses source-bound edits, uploads and annotations without importing another workspace',()=>{
  const {c}=context();edit(c);c.PROJECTS.a.kb[0].known[0].annotations=[{text:'补充注释依据'}];
  c.KB_EDITS.a.e1.sourceItem=c.PROJECTS.a.kb[0].known[0];
  c.KB_FILE_CHUNKS={a:[{id:'file-a',text:'文件依据842',cite:'a.txt'}],b:[{text:'不得跨工作区'}]};
  const corpus=c.knowledgeMaterialCorpus('a',c.PROJECTS.a),texts=corpus.map(x=>x.text);
  assert.ok(texts.includes('产值28亿元，白鹭842'));assert.ok(texts.includes('文件依据842'));assert.ok(texts.includes('补充注释依据'));
  assert.ok(!texts.includes('产值10亿元'));assert.ok(!texts.includes('不得跨工作区'));
  c.UPLOAD_TOMBS['a::a.txt']=10;assert.ok(!c.knowledgeMaterialCorpus('a',c.PROJECTS.a).some(x=>x.id==='file-a'));
});
test('an indexed upload and its legacy annotation are only supplied once',()=>{
  const {c}=context();c.PROJECTS.a.kb[0].known[0].annotations=[{text:'上传原文842',originalId:'original-a',src:'a.txt'}];
  c.KB_FILE_CHUNKS.a=[{text:'上传原文842',originalId:'original-a',cite:'a.txt'}];
  assert.equal(c.knowledgeMaterialCorpus('a',c.PROJECTS.a).filter(item=>item.text==='上传原文842').length,1);
});
test('resegmented uploads replace duplicate legacy annotations without losing the tail',()=>{
  const {c}=context();c.PROJECTS.a.kb[0].known[0].annotations=[{text:'文件开头和最后的纠正',originalId:'original-a',src:'a.txt'}];
  c.KB_FILE_CHUNKS.a=[{text:'文件开头',originalId:'original-a',cite:'a.txt'},{text:'最后的纠正',originalId:'original-a',cite:'a.txt'}];
  const corpus=c.knowledgeMaterialCorpus('a',c.PROJECTS.a);
  assert.equal(corpus.filter(x=>x.originalId==='original-a').length,2);
  assert.ok(corpus.some(x=>x.text==='最后的纠正'));
});
test('admin material browser shows stored corrections and uploaded chunks with accurate totals',()=>{
  const h=context(),c=h.c;edit(c);c.KB_FILE_CHUNKS.a=[{text:'附件材料951',originalId:'file1',cite:'source.txt',account:'uploader'}];
  Object.assign(c,{getCityBasePackage:()=>null,ragEsc:c.materialEscape,ragRenderChunk:item=>'<article>'+item.text+'</article>',ragProjKey:()=> 'a',opsWorkspaceKind:()=> '地区主工作区',_authEscape:c.materialEscape});
  vm.runInContext(between(ops,'function ragBaseVsSupportLayout(','/* 结构化渲染一条智库材料')+'\n'+between(ops,'function ragCityOptions(','function opsRagSelectTab('),c);
  const html=c.ragBaseVsSupportLayout(c.PROJECTS.a,'a');
  assert.match(html,/白鹭842/);assert.match(html,/附件材料951/);assert.match(html,/uploader/);assert.doesNotMatch(html,/还没有账号补充过材料/);
  assert.match(c.ragCityOptions(),/2 条材料/);
});
test('admin search and chat consume the corrected corpus and send the exact workspace key',async()=>{
  const h=context(),c=h.c;edit(c);c.KB_FILE_CHUNKS.a=[{text:'文件命中842',cite:'file.txt'}];
  Object.assign(c,{ragProjKey:()=> 'a',ragChatWorkspace:'a',ragChatEpoch:0,ragChatMsgs:[],ragChatBusy:false,ragEnsureChatWorkspace(){},ragChatScrollBottom(){},kbSearch:(_q,corpus)=>corpus});
  h.nodes.ragQ={value:'842'};h.nodes.ragChatIn={value:'园区产值是多少'};
  vm.runInContext(between(ops,'function ragDoSearch(','function ragHitsView(')+'\n'+between(ops,'function ragChatSend(','function ragChatCommit('),c);
  c.ragDoSearch();assert.equal(c.ragHits[0].text,'产值28亿元，白鹭842');
  c.fetch=async(url,options)=>{h.posts.push({url,body:JSON.parse(options.body)});return {ok:true,body:{getReader:()=>({read:async()=>({done:true})})}};};await c.ragChatSend('a');
  const request=h.posts[0].body;assert.equal(request.projectKey,'a');assert.ok(request.chunks.some(x=>x.text.includes('白鹭842')));assert.ok(request.chunks.some(x=>x.text==='文件命中842'));assert.ok(!request.chunks.some(x=>x.text==='产值10亿元'));
});
test('generic persist sends live state despite quota errors; failed cloud save stays visibly retryable',async()=>{
  const timers=[],h=context({setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}}),c=h.c;
  const data={PROJECTS:{a:{kb:[{known:['新事实842']}]}}};
  Object.assign(c,{LS_KEY:'huixiaozhao_kb_v1',view:'knowledge',UPLOADS:{},KB_CONFIRM_TOMBS:{},KB_ITEM_TOMBS:{},KB_UNLOCKED:{},REPORTSTATE:{},PENDING_CONFIRMS:{},DOCK_LOGS:{},KB_CHAT:{},KB_CHAT_TOMBS:{},REPORT_HISTORY:{},CITY_BASE_PACKAGES:{},_safeSyncSnapshot:x=>x,_slimUploads:()=>({}),
    localStorage:{setItem(){throw Error('quota');},getItem:()=>JSON.stringify({PROJECTS:{old:true}})}});
  c.PROJECTS=data.PROJECTS;
  vm.runInContext(between(read('frontend/index/script-02-sections/14-part-00.js'),'function persist(){','function restore(){'),c);
  c.fetch=async(url,options)=>{h.posts.push(JSON.parse(options.body));return {ok:false,json:async()=>({ok:false,message:'未保存'})};};
  c.persist();await c.workspaceSyncSend();assert.deepEqual(h.posts[0].PROJECTS,data.PROJECTS);assert.ok(c.WORKSPACE_SYNC.pending);
  assert.match(h.nodes.workspaceSyncStatus.textContent,/尚未保存到云端/);assert.equal(h.nodes.workspaceSyncStatus.children.at(-1).textContent,'重试保存');
  c.fetch=async()=>({ok:true,json:async()=>({ok:true})});assert.equal(await c.workspaceSyncSend(),true);assert.equal(c.WORKSPACE_SYNC.pending,null);
});
test('material edit changes no original and installs nothing until a valid durable receipt',async()=>{
  const h=context(),c=h.c;let resolve;
  c.fetch=async(url,options)=>{h.posts.push(JSON.parse(options.body));return new Promise(r=>resolve=r);};
  const request=c.materialSaveText('a',0,0,'产值28亿元，白鹭842');assert.equal(c.PROJECTS.a.kb[0].known[0].text,'产值10亿元');assert.deepEqual(Object.keys(c.KB_EDITS),[]);
  const body=h.posts[0];resolve({ok:true,json:async()=>({ok:true,record:receipt(body)})});await request;
  assert.equal(c.PROJECTS.a.kb[0].known[0].text,'产值10亿元');assert.equal(c.materialEffectiveKnown(c.PROJECTS.a,0,'a')[0].text,'产值28亿元，白鹭842');
  c.fetch=async()=>({ok:false,json:async()=>({ok:false,message:'存储失败'})});await assert.rejects(c.materialSaveText('a',0,null,'不能假成功'),/存储失败/);assert.equal(Object.keys(c.KB_EDITS.a).length,1);
});
test('late material response after account change never loads the previous account text',async()=>{
  const h=context(),c=h.c;let resolve;c.fetch=async(url,options)=>new Promise(r=>resolve=()=>r({ok:true,json:async()=>({ok:true,record:receipt(JSON.parse(options.body))})}));
  const request=c.materialSaveText('a',0,null,'private previous account');c._authEpoch++;resolve();await assert.rejects(request,/登录状态已变化/);assert.deepEqual(Object.keys(c.KB_EDITS),[]);
});
test('bulk accepting an unmatched conflict creates a durable note without writing array[-1]',async()=>{
  const h=context(),c=h.c;c._pendingConflicts={key:'a',epoch:1,kbIdx:0,conflicts:[{idx:-1,old:'未定位原文',new:'产值28亿元，白鹭842'}]};c.originalUploadEpoch=()=>c._authEpoch;
  c.fetch=async(url,options)=>{const body=JSON.parse(options.body);h.posts.push(body);return {ok:true,json:async()=>({ok:true,record:receipt(body)})};};
  vm.runInContext(between(tail,'async function kbSaveConflict(','/* 结合全库重新分析'),c);await c.resolveAllConflicts('new');
  assert.equal(h.posts[0].sourceIndex,null);assert.equal(c.PROJECTS.a.kb[0].known[-1],undefined);assert.equal(c.materialEffectiveKnown(c.PROJECTS.a,0,'a').length,2);assert.match(h.toasts.at(-1),/全部保存到云端/);
});
test('memory counts and lists current KB_EDITS once instead of only legacy confirmations',()=>{
  const h=context(),c=h.c;edit(c);c.KB_CONFIRMS.a={0:{0:{text:'old confirmation',status:'confirmed'}}};c.UPLOADS={};c.cityKeys=()=>['a'];c.kbSessionStore=()=>({sessions:[]});c._authEscape=c.materialEscape;c.fmtTs=()=> 'now';
  vm.runInContext(between(layout,'function memTextRows(','function memBankBadge(')+'\n'+between(layout,'function memTextView(','async function memRemoveRevision('),c);
  assert.equal(c.memBankStats().textN,1);const html=c.memTextView();assert.match(html,/白鹭842/);assert.match(html,/已修改 · 待核验/);assert.match(html,/恢复原文/);assert.doesNotMatch(html,/old confirmation/);
});
test('explicit long-term save uses the user message text, never an assistant answer',()=>{
  const h=context(),c=h.c;let saved;c.kbSessionStore=()=>({sessions:[{messages:[{id:'u1',role:'user',plainText:'用户纠正842'},{id:'a1',role:'ai',plainText:'AI概括应忽略'}]}]});c.kbPlainMessage=m=>m.plainText;c.openLongTermMaterial=(key,text)=>saved={key,text};c.kbEscape=c.materialEscape;
  vm.runInContext(between(tail,'function kbLongTermButton(','function kbChatReplay('),c);c.kbSaveUserMessage('u1');assert.deepEqual(saved,{key:'a',text:'用户纠正842'});c.kbSaveUserMessage('a1');assert.deepEqual(saved,{key:'a',text:'用户纠正842'});assert.match(c.kbLongTermButton({id:'u1',role:'user'}),/保存为长期材料/);
});
test('a replaced source retains the correction as needs_review without overriding the newer original',()=>{
  const h=context(),c=h.c;edit(c);c.PROJECTS.a.baseReportVersion={version:2};c.PROJECTS.a.kb[0].known=[{text:'新报告产值99亿元',nature:'base'}];
  const effective=c.materialEffectiveKnown(c.PROJECTS.a,0,'a');assert.equal(effective[0].text,'新报告产值99亿元');assert.equal(effective.length,2);
  assert.equal(effective[1].text,'产值28亿元，白鹭842');assert.equal(effective[1]._kbEditStatus,'needs_review');assert.equal(effective[1].correction.sourceText,'产值10亿元');
  const corpus=c.knowledgeMaterialCorpus('a',c.PROJECTS.a),correction=corpus.find(x=>x._kbEditId==='e1');assert.equal(correction.correction.status,'needs_review');assert.ok(correction.tags.includes('产值10亿元'));
  assert.throws(()=>c.materialEditBody('a',0,1,'不能直接覆盖新原文'),/选择当前原文/);
  Object.assign(c,{UPLOADS:{},cityKeys:()=>['a'],kbSessionStore:()=>({sessions:[]}),_authEscape:c.materialEscape,fmtTs:()=> 'now'});
  vm.runInContext(between(layout,'function memTextRows(','function memBankBadge(')+'\n'+between(layout,'function memTextView(','async function memRemoveRevision('),c);
  assert.equal(c.memBankStats().textN,1);assert.match(c.memTextView(),/旧修订 · 待复核/);assert.match(c.memTextView(),/删除旧修订/);
});
test('corrections stay discoverable even if their old section was removed entirely',()=>{
  const {c}=context();edit(c);c.PROJECTS.a.kb=[];
  const corpus=c.knowledgeMaterialCorpus('a',c.PROJECTS.a);assert.equal(corpus.length,1);assert.equal(corpus[0].correction.status,'needs_review');assert.equal(corpus[0].text,'产值28亿元，白鹭842');
});
test('reset clears old-account material drafts and body overlays',()=>{
  const h=context(),c=h.c;let removed=0;c.MATERIAL_DRAFT={key:'a',text:'old private text'};c.kbEditSession={source:'private'};
  for(const id of ['kbDetailModal','kbEditorPanel','ragCommitModal'])h.nodes[id]={remove(){delete h.nodes[id];removed++;}};
  c.document.querySelectorAll=()=>[{remove(){removed++;}}];c.materialResetSession();assert.equal(c.MATERIAL_DRAFT,null);assert.equal(c.kbEditSession,null);assert.equal(removed,4);
});
test('file memory distinguishes retained-original parse failures from missing originals with static reasons',()=>{
  const {c}=context();Object.assign(c,{UPLOADS:{a:[{name:'source.txt',size:20,ts:1,chunks:10,chunkRepair:{status:'failed',code:'extraction_failed',message:'secret provider error'}}]},cityKeys:()=>['a'],_authEscape:c.materialEscape,fmtTs:()=> 'now',uploadOriginalUrl:()=>'/api/upload-file'});
  vm.runInContext(between(layout,'function memFileView(','function memChatView('),c);
  let html=c.memFileView();assert.match(html,/原件保留，片段补全失败/);assert.match(html,/原件未能提取可检索正文/);assert.doesNotMatch(html,/secret provider error/);
  c.UPLOADS.a[0].chunkRepair.code='original_not_found';html=c.memFileView();assert.match(html,/片段补全失败，原件待检查/);assert.doesNotMatch(html,/原件保留，片段补全失败/);
});
test('a delayed file-picker completion cannot upload into a newly selected account or workspace',()=>{
  const h=context(),c=h.c,timers=[];let input,uploads=0;
  Object.assign(c,{view:'knowledge',originalUploadEpoch:()=>c._authEpoch,originalUploadSessionCurrent:epoch=>epoch===c._authEpoch,ingestFiles:()=>uploads++,setTimeout:fn=>timers.push(fn)});
  c.document.createElement=()=>input={click(){}};
  vm.runInContext(between(tail,'function doUpload(){','function uploadParsed('),c);
  c.doUpload();input.files=[{name:'a.txt'}];c.cur='b';input.onchange();assert.equal(timers.length,0);
  c.cur='a';c.doUpload();input.files=[{name:'b.txt'}];input.onchange();assert.equal(timers.length,1);c._authEpoch++;timers[0]();assert.equal(uploads,0);
});
