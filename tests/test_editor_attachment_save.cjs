'use strict';
// Reuse DOM fixtures only: existing test bodies are never registered or executed.
// The product editor/material functions run with synthetic stores and fetch replies.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const fixtureFile=path.join(__dirname,'test_kb_detail_render.cjs');
const actualRequire=createRequire(fixtureFile);
const fixture={__dirname,path,console,Buffer,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,module:{exports:{}}};
fixture.require=name=>name==='node:test'?()=>{}:actualRequire(name);
vm.runInNewContext(fs.readFileSync(fixtureFile,'utf8')+'\nmodule.exports={actionHarness,kbEditReply,pendingKbEdit};',fixture,{filename:fixtureFile});
const {actionHarness,kbEditReply,pendingKbEdit}=fixture.module.exports;
const KEY='workspace-a',ID='stable-independent-note';
function note(overrides={}){return {id:ID,sectionIndex:0,sectionTitle:'政策',sourceIndex:null,sourceItem:null,baseReportVersion:null,text:'原有独立补充正文。',revision:2,ts:20,account:'reviewer',status:'edited',...overrides};}
function setupNote(){
  const h=actionHarness([]);h.c.KB_EDITS[KEY]={[ID]:note()};
  assert.equal(h.c.editKbItem(0,0,-1),true);assert.equal(h.c.kbEditSession.editId,ID);assert.equal(h.c.kbEditSession.revision,2);
  return h;
}
async function attach(h){
  h.c.ingestFiles=async()=>{
    h.project.kb[0].known.push('📎 编辑器附件.txt 已解析（1 片段）');
    return [{name:'编辑器附件.txt',_originalReceipt:{fileChunks:[{text:'真实附件测试用的合成摘要。'}]}}];
  };
  await h.c.processEditFiles([{name:'编辑器附件.txt'}],0,0);
  assert.equal(h.effective()[0],'📎 编辑器附件.txt 已解析（1 片段）');assert.equal(h.effective()[1]._kbEditId,ID);
}
test('existing independent note saves by stable revision identity after editor attachment adds a raw placeholder before it',async()=>{
  const h=setupNote();await attach(h);const draft=h.textarea().value;
  assert.match(draft,/真实附件测试用的合成摘要/);await h.c.saveKbEdit(0,0);
  assert.equal(h.effects.requests.length,1,'shifted effective index must not reject the unchanged stable note');
  const body=h.effects.requests[0].body;
  assert.equal(body.editId,ID);assert.equal(body.expectedRevision,2);assert.equal(body.sourceIndex,null);assert.equal(body.sourceItem,null);assert.equal(body.baseReportVersion,null);assert.equal(body.text,draft);
  assert.equal(h.c.KB_EDITS[KEY][ID].revision,3);assert.equal(h.c.KB_EDITS[KEY][ID].text,draft);
  assert.deepEqual(h.project.kb[0].known,['📎 编辑器附件.txt 已解析（1 片段）']);assert.equal(h.c.kbEditSession,null);
});
function assertDraftRetained(h,draft){
  assert.ok(h.c.kbEditSession,'rejected save keeps its editing session');assert.equal(h.textarea().value,draft);
  assert.notEqual(h.c.kbEditSession.saving,true);assert.equal(h.effects.persist,0);
}
function setupSource({revised=false}={}){
  const raw={text:'有来源的原始政策正文。',origin:'report',sourceFile:'policy.md'};
  const h=actionHarness([raw]);h.project.baseReportVersion='version-a';
  if(revised)h.c.KB_EDITS[KEY]={[ID]:note({sourceIndex:0,sourceItem:JSON.parse(JSON.stringify(raw)),baseReportVersion:'version-a',text:'原始政策的现有人工修订。'})};
  assert.equal(h.c.editKbItem(0,0,-1),true);return {h,raw};
}
test('multiple added base rows and an earlier independent note do not redirect the save',async()=>{
  const h=setupNote();await attach(h);h.project.kb[0].known.unshift('另一个新增的基础材料标记');
  h.c.KB_EDITS[KEY].earlier=note({id:'earlier',text:'另一条先出现的独立补充',ts:1,revision:1});
  const draft=h.textarea().value;await h.c.saveKbEdit(0,0);
  assert.equal(h.effects.requests.length,1);assert.equal(h.effects.requests[0].body.editId,ID);
  assert.equal(h.c.KB_EDITS[KEY].earlier.text,'另一条先出现的独立补充');assert.equal(h.c.KB_EDITS[KEY][ID].text,draft);
});
test('equal text in another revision ID cannot capture the original note save',async()=>{
  const h=setupNote();await attach(h);h.c.KB_EDITS[KEY].earlier=note({id:'earlier',ts:1});
  await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,1);assert.equal(h.effects.requests[0].body.editId,ID);
  assert.equal(h.c.KB_EDITS[KEY].earlier.revision,2);assert.equal(h.c.KB_EDITS[KEY].earlier.text,'原有独立补充正文。');
});
for(const [name,mutate] of [
  ['revision increment',h=>{h.c.KB_EDITS[KEY][ID].revision=3;}],
  ['same revision with changed text',h=>{h.c.KB_EDITS[KEY][ID].text='另一用户刚保存的正文。';}],
  ['deleted record',h=>{h.c.KB_EDITS[KEY][ID].deleted=true;}],
  ['missing record',h=>{delete h.c.KB_EDITS[KEY][ID];}],
  ['changed section title',h=>{h.c.KB_EDITS[KEY][ID].sectionTitle='新的分区';}],
  ['changed original binding',h=>{Object.assign(h.c.KB_EDITS[KEY][ID],{sourceIndex:0,sourceItem:h.project.kb[0].known[0],baseReportVersion:null});}]
])test('stable identity does not bypass '+name+' conflict after attachment',async()=>{
  const h=setupNote();await attach(h);const draft=h.textarea().value;mutate(h);await h.c.saveKbEdit(0,0);
  assert.equal(h.effects.requests.length,0);assertDraftRetained(h,draft);
});
test('ambiguous duplicate projected IDs fail closed rather than choosing the first match',async()=>{
  const h=setupNote();await attach(h);const draft=h.textarea().value,original=h.c.kbEffectiveKnown;
  h.c.kbEffectiveKnown=(...args)=>{const items=original(...args),item=items.find(row=>row&&row._kbEditId===ID);return items.concat({...item});};
  await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,0);assertDraftRetained(h,draft);
});
test('a now-retained needs-review projection cannot be silently saved as the original active note',async()=>{
  const h=setupNote();await attach(h);const draft=h.textarea().value,original=h.c.kbEffectiveKnown;
  h.c.kbEffectiveKnown=(...args)=>original(...args).map(item=>item&&item._kbEditId===ID?{...item,_kbEditStatus:'needs_review'}:item);
  await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,0);assertDraftRetained(h,draft);
});
for(const [name,mutate] of [
  ['account epoch',h=>{h.c._authEpoch++;h.c.AUTH={user:'other-account'};}],
  ['workspace',h=>{h.c.cur='workspace-b';}],
  ['project instance',h=>{h.c.P=()=>({...h.project});}],
  ['section instance',h=>{h.project.kb[0]={...h.project.kb[0]};}],
  ['known array replacement',h=>{h.project.kb[0].known=h.project.kb[0].known.slice();}]
])test('attachment never bypasses changed '+name+' context',async()=>{
  const h=setupNote();await attach(h);const draft=h.textarea().value;mutate(h);await h.c.saveKbEdit(0,0);
  assert.equal(h.effects.requests.length,0);assertDraftRetained(h,draft);
});
test('unrevised source-bound edit still saves when the attachment only appends a later raw row',async()=>{
  const {h,raw}=setupSource();await attachSource(h);const draft=h.textarea().value;
  await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,1);const body=h.effects.requests[0].body;
  assert.equal(body.editId,null);assert.equal(body.sourceIndex,0);assert.equal(body.baseReportVersion,'version-a');assert.equal(JSON.stringify(body.sourceItem),JSON.stringify(raw));assert.equal(body.text,draft);
  assert.equal(h.project.kb[0].known[0],raw);assert.equal(h.project.kb[0].known.length,2);
});
async function attachSource(h){
  h.c.ingestFiles=async()=>{h.project.kb[0].known.push('📎 参考附件.txt 已解析（1 片段）');return [{name:'参考附件.txt',_originalReceipt:{fileChunks:[{text:'仅供核对的附件摘要。'}]}}];};
  await h.c.processEditFiles([{name:'参考附件.txt'}],0,0);assert.match(h.textarea().value,/仅供核对的附件摘要/);
}
test('an existing source-bound revision keeps its stable ID when unrelated independent notes are inserted',async()=>{
  const {h,raw}=setupSource({revised:true});await attachSource(h);h.c.KB_EDITS[KEY].other=note({id:'other',text:'另条补充',ts:1});
  await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,1);const body=h.effects.requests[0].body;
  assert.equal(body.editId,ID);assert.equal(body.expectedRevision,2);assert.equal(body.sourceIndex,0);assert.equal(JSON.stringify(body.sourceItem),JSON.stringify(raw));
});
test('restored raw source can be revised again using its deleted revision tombstone',async()=>{
  const raw={text:'恢复后的原始正文。',origin:'report'},h=actionHarness([raw]);h.project.baseReportVersion='version-a';
  h.c.KB_EDITS[KEY]={[ID]:note({sourceIndex:0,sourceItem:JSON.parse(JSON.stringify(raw)),baseReportVersion:'version-a',deleted:true})};
  assert.equal(h.c.editKbItem(0,0,-1),true);assert.equal(h.c.kbEditSession.editId,ID);assert.equal(h.c.kbEditSession.raw._kbEditId,undefined);
  await attachSource(h);await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,1);const body=h.effects.requests[0].body;
  assert.equal(body.editId,ID);assert.equal(body.expectedRevision,2);assert.equal(body.sourceIndex,0);assert.equal(JSON.stringify(body.sourceItem),JSON.stringify(raw));
  assert.equal(h.c.KB_EDITS[KEY][ID].revision,3);assert.notEqual(h.c.KB_EDITS[KEY][ID].deleted,true);
});
for(const [name,mutate] of [
  ['original text',h=>{h.project.kb[0].known[0]={...h.project.kb[0].known[0],text:'原材料已被替换'};}],
  ['base report version',h=>{h.project.baseReportVersion='version-b';}],
  ['source position',h=>{h.project.kb[0].known.unshift('新增到原文之前的行');}],
  ['record source value',h=>{h.c.KB_EDITS[KEY][ID].sourceItem={text:'别的原始资料'};}],
  ['record base version',h=>{h.c.KB_EDITS[KEY][ID].baseReportVersion='version-b';}]
])test('source-bound revision rejects changed '+name+' without consuming the draft',async()=>{
  const {h}=setupSource({revised:true});await attachSource(h);const draft=h.textarea().value;mutate(h);await h.c.saveKbEdit(0,0);
  assert.equal(h.effects.requests.length,0);assertDraftRetained(h,draft);
});
test('a raw unrevised item still requires the same source position after attachment',async()=>{
  const {h}=setupSource();await attachSource(h);const draft=h.textarea().value;h.project.kb[0].known.unshift('另一项插到原条目前');
  await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,0);assertDraftRetained(h,draft);
});
test('server conflict after successful local stable-ID lookup preserves the full attachment draft',async()=>{
  const h=setupNote();await attach(h);const draft=h.textarea().value;
  h.c.fetch=async(url,options)=>{h.effects.requests.push({url,body:JSON.parse(options.body)});return {ok:false,status:409,json:async()=>({ok:false,message:'修订已更新，请重新打开资料'})};};
  await h.c.saveKbEdit(0,0);assert.equal(h.effects.requests.length,1);assert.equal(h.c.KB_EDITS[KEY][ID].revision,2);assertDraftRetained(h,draft);
});
test('late success after account epoch change cannot install the saved note in the new session',async()=>{
  const h=setupNote();await attach(h);const server=pendingKbEdit(h),pending=h.c.saveKbEdit(0,0);
  assert.equal(h.effects.requests.length,1);const body=server.body();h.c._authEpoch++;h.c.AUTH={user:'next-account'};h.c.KB_EDITS={};
  server.resolve(kbEditReply(body));await pending;assert.equal(Object.keys(h.c.KB_EDITS).length,0);assert.equal(h.effects.persist,0);
});
