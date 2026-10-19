const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'frontend/index/script-02-sections/12-tail.js'), 'utf8');
function declaration(name, input = source) {
  const start = input.search(new RegExp('(?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, name);
  const tail = input.slice(start + 1).search(/\n(?:async )?function /);
  return input.slice(start, tail < 0 ? undefined : start + 1 + tail);
}
const fullText = ['一、产业基础判断\n有来源的事实。', '二、产业链缺口分析\n缺口待核。', '三、补链优先级清单\n待核。', '四、目标企业画像\n投资意向未知。', '五、待确认事项\n需补充条件。'].join('\n');
function response(text, finish = 'stop', split = false) {
  const wire = 'data: ' + JSON.stringify({choices: [{delta: {content: text}}]}) + '\r\n\r\n' +
    (finish ? 'data: ' + JSON.stringify({choices: [{delta: {}, finish_reason: finish}]}) + '\n\n' : '') + 'data: [DONE]';
  const fragments = split ? Array.from(wire) : [wire];
  return {ok: true, status: 200, body: {getReader() {let i = 0; return {async read() {
    return i < fragments.length ? {value: new TextEncoder().encode(fragments[i++]), done: false} : {done: true};
  }};}}};
}
function environment(reply = response(fullText), implementation = source) {
  const events = {fetch: [], toasts: [], persist: 0, render: 0};
  const elements = {reportArea: {}, reportContent: {}, reportRunStatus: {}};
  const context = {
    PROJECTS: {p: {city: '闵行区', topic: '核电配套', reportRequestId: 'request-1'}},
    REPORTSTATE: {p: {text: 'old report', topic: 'other', sourceReportId: 'request-1', phaseByTopic: {'核电配套': 1},
      pendingByTopic: {'核电配套': [{text: '确认产业方向', status: 'confirmed'}]}, aiReportByTopic: {other: 'old report'}}},
    PENDING_CONFIRMS: {}, DEMANDS: [], cur: 'p', _authEpoch: 1, window: {},
    document: {getElementById: id => elements[id] || null},
    P() {return context.PROJECTS[context.cur];},
    persist() {events.persist++;}, toast(t) {events.toasts.push(t);}, render() {events.render++;},
    buildKBCorpus() {return [];}, kbSearch() {return [];}, curOnbPrefs() {return {};},
    parsePendingItems() {return [{text: '确认产业方向', status: 'pending'}];},
    setReportAreaHtml(el, html) {el.innerHTML = html;},
    fetch(url, init) {if(url==='/api/sync')return Promise.resolve({ok:true,json:async()=>({ok:true})});events.fetch.push({url, body: JSON.parse(init.body)}); return typeof reply === 'function' ? reply() : Promise.resolve(reply);},
    localStorage: {getItem() {return '{}';}}, LS_KEY:'offline',
    TextDecoder, TextEncoder, URL, crypto: require('node:crypto').webcrypto, AbortController, setTimeout() {return 1;}, clearTimeout() {}, Date, console,
    nativeReportState() {return null;},
  };
  vm.createContext(context);
  const shared=fs.readFileSync(path.join(root,'frontend/index/script-02-sections/12-part-00.js'),'utf8');
  vm.runInContext(declaration('savedEvidenceIdentity',shared),context);
  const added=['reportMaterialIdentity','reportClientFingerprint','reportJobForTopic','reportRunBanner','refreshReportRunUi','reportStreamMetadataEvent','reportStateStamp','reportTopicStamp','topicOperationStamp','touchTopicPending'];
  vm.runInContext(['fullReportConfirmation', 'topicReportMarkup', ...added, 'escapeChainText', 'readTopicReportStream', 'syncTopicReportInputs', 'isCompleteTopicReport', 'updateReportBusy', 'triggerReport',
    'demandReportSnapshot', 'demandSubmissionState', 'demandEffectiveStage'].map(n => declaration(n,added.includes(n)&&!implementation.includes('function '+n+'(')?source:implementation)).join('\n') + '\n' + ['_correctChainLevel', '_normalizeChain'].map(n => declaration(n)).join('\n'), context);
  return {c: context, events, elements};
}

async function untilRequestStarted(check){
  // Native WebCrypto completion depends on worker scheduling, not event-loop ticks.
  const deadline=performance.now()+5000;
  while(!check()&&performance.now()<deadline)await delay(10);
  assert.ok(check(),'fingerprinting should complete before testing an in-flight response');
}

test('unconfirmed, empty and wrong-topic confirmations cannot start a full report or set a busy flag', () => {
  for (const pending of [[], [{text: '待确认', status: 'pending'}], null, [{text: '', status: 'confirmed'}]]) {
    const {c, events} = environment();
    c.REPORTSTATE.p.pendingByTopic['核电配套'] = pending;
    c.PENDING_CONFIRMS.p = [{text: 'other', status: 'confirmed'}];
    c.triggerReport(2);
    assert.equal(events.fetch.length, 0); assert.equal(events.persist, 0);
    assert.equal(c.window._reportGenerating, false);
  }
});

test('fragmented SSE and final frame without newline preserve all text and require explicit stop', async () => {
  const {c} = environment();
  assert.equal((await c.readTopicReportStream(response(fullText, 'stop', true), () => {})).text, fullText);
  for (const finish of ['length', null, 'content_filter']) {
    await assert.rejects(c.readTopicReportStream(response('partial', finish, true), () => {}), e => e.partialText === 'partial');
  }
});

test('successful full generation sends exact identity, preserves native receipt and stores no invented confidence', async () => {
  const {c, events} = environment();
  await c.triggerReport(2);
  assert.equal(events.fetch.length, 1);
  assert.equal(events.fetch[0].body.projectKey, 'p');
  assert.equal(events.fetch[0].body.topic, '核电配套');
  assert.equal(events.fetch[0].body.reportRequestId, 'request-1');
  assert.equal(events.fetch[0].body.purpose, 'topic_full');
  assert.equal(c.REPORTSTATE.p.sourceReportId, 'request-1');
  assert.equal(c.REPORTSTATE.p.aiReportByTopic.other, 'old report');
  assert.equal(c.REPORTSTATE.p.aiReportByTopic['核电配套'], fullText);
  assert.equal(c.REPORTSTATE.p.scoreByTopic['核电配套'], null);
  assert.equal(c.REPORTSTATE.p.evidenceStatusByTopic['核电配套'], 'unreviewed');
  assert.equal(c.window._reportGenerating, false);
});

test('completion waits for acknowledged cloud save after streaming finishes', async () => {
  const {c,events}=environment();const transport=c.fetch;let syncs=0,release;
  c.fetch=(url,init)=>url==='/api/sync'&&++syncs===2?new Promise(r=>{release=r;}):transport(url,init);
  const pending=c.triggerReport(2);await untilRequestStarted(()=>!!release);
  assert.equal(c.REPORTSTATE.p.aiReportByTopic['核电配套'],fullText);
  assert.equal(events.toasts.length,0);
  release({ok:true,json:async()=>({ok:true})});await pending;
  assert.match(events.toasts.at(-1),/已保存/);
});

test('failed final cloud save keeps local report and does not announce confirmed completion', async () => {
  const {c,events}=environment();const transport=c.fetch;let syncs=0;
  c.fetch=(url,init)=>url==='/api/sync'&&++syncs===2?Promise.resolve({ok:false,status:503}):transport(url,init);
  await c.triggerReport(2);
  assert.equal(c.REPORTSTATE.p.aiReportByTopic['核电配套'],fullText);
  assert.match(events.toasts.at(-1),/本机.*云端保存未确认/);
  assert.equal(c.REPORTSTATE.p.partialByTopic&&c.REPORTSTATE.p.partialByTopic['核电配套'],undefined);
});

test('admin generation also waits for the final save and preserves local content on save failure', async () => {
  const implementation=fs.readFileSync(path.join(root,'frontend/ops/script-03-sections/12-tail.js'),'utf8');
  for(const failed of [false,true]){
    const {c,events}=environment(response(fullText),implementation),transport=c.fetch;let syncs=0,release;
    c.fetch=(url,init)=>url==='/api/sync'&&++syncs===2?new Promise(r=>{release=r;}):transport(url,init);
    const pending=c.triggerReport(2);await untilRequestStarted(()=>!!release);assert.equal(events.toasts.length,0);
    release(failed?{ok:false,status:503}:{ok:true,json:async()=>({ok:true})});await pending;
    assert.equal(c.REPORTSTATE.p.aiReportByTopic['核电配套'],fullText);assert.match(events.toasts.at(-1),failed?/云端保存未确认/:/已保存/);
  }
});

test('length, transport EOF, or incomplete five chapters never overwrite a completed report', async () => {
  for (const reply of [response(fullText, 'length'), response(fullText, null), response('一、仅有一章')]) {
    const {c} = environment(reply);
    c.REPORTSTATE.p.aiReportByTopic['核电配套'] = 'previous formal report';
    await c.triggerReport(2);
    assert.equal(c.REPORTSTATE.p.aiReportByTopic['核电配套'], 'previous formal report');
    assert.equal(c.REPORTSTATE.p.phaseByTopic['核电配套'], 1);
    assert.equal(c.REPORTSTATE.p.partialByTopic['核电配套'].status, 'incomplete');
    assert.equal(c.window._reportGenerating, false);
  }
});

test('switching topic while streaming never replaces the current topic view or other-topic report', async () => {
  let finish;
  const {c} = environment(() => new Promise(resolve => {finish = resolve;}));
  const work = c.triggerReport(2);
  await untilRequestStarted(()=>typeof finish==='function');
  c.PROJECTS.p.topic = '其他方向'; c.REPORTSTATE.p.text = 'other report';
  finish(response(fullText)); await work;
  assert.equal(c.REPORTSTATE.p.text, 'other report');
  assert.equal(c.REPORTSTATE.p.aiReportByTopic['核电配套'], fullText);
});

test('logout epoch prevents an old response from writing to new session storage', async () => {
  let finish;
  const {c, events} = environment(() => new Promise(resolve => {finish = resolve;}));
  const work = c.triggerReport(2), persisted = events.persist;
  await untilRequestStarted(()=>typeof finish==='function');
  c._authEpoch++; finish(response(fullText)); await work;
  assert.equal(events.persist, persisted);
  assert.equal(c.REPORTSTATE.p.aiReportByTopic['核电配套'], undefined);
});

test('repeat click shares one current-topic job and failure releases the lock for retry', async () => {
  let finish;
  const {c, events} = environment(() => new Promise(resolve => {finish = resolve;}));
  const work = c.triggerReport(2); c.triggerReport(2);
  await untilRequestStarted(()=>typeof finish==='function');
  assert.equal(events.fetch.length, 1);
  finish(response('partial', 'length')); await work;
  const retry = c.triggerReport(2); await untilRequestStarted(()=>events.fetch.length===2); assert.equal(events.fetch.length, 2);
  finish(response(fullText)); await retry;
  assert.deepEqual(Object.keys(c.window._topicReportJobs), []);
});

test('retry waits for delayed native fingerprint completion before resolving its response', async () => {
  let finish, fingerprints=0;
  const {c, events} = environment(() => new Promise(resolve => {finish = resolve;}));
  const digest=c.crypto.subtle.digest.bind(c.crypto.subtle);
  c.crypto={subtle:{async digest(...args){
    if(++fingerprints===2)await delay(80);
    return digest(...args);
  }}};
  const first=c.triggerReport(2);
  await untilRequestStarted(()=>events.fetch.length===1);
  finish(response('partial', 'length'));await first;
  const retry=c.triggerReport(2);
  await untilRequestStarted(()=>events.fetch.length===2);
  assert.equal(events.fetch.length,2);
  finish(response(fullText));await retry;
  assert.equal(c.REPORTSTATE.p.aiReportByTopic['核电配套'],fullText);
  assert.deepEqual(Object.keys(c.window._topicReportJobs),[]);
});

test('demand report snapshot rejects draft and binds only the exact completed direction', () => {
  const {c} = environment();
  assert.equal(c.demandReportSnapshot('p', '核电配套'), null);
  c.REPORTSTATE.p.phaseByTopic['核电配套'] = 2;
  c.REPORTSTATE.p.aiReportByTopic['核电配套'] = fullText;
  const snapshot = c.demandReportSnapshot('p', '核电配套');
  assert.equal(snapshot.text, fullText);
  assert.equal(snapshot.aiReportByTopic.other, undefined);
  assert.equal(snapshot.sourceReportId, undefined);
  assert.equal(snapshot.evidenceStatusByTopic['核电配套'], 'unreviewed');
});

test('only acknowledged submissions display the submitted stage; pending and failed keep their real state', () => {
  const {c} = environment();
  c.PROJECTS.d = {isDemand: true, stage: 3}; c.DEMANDS.push({projKey: 'd'});
  assert.equal(c.demandEffectiveStage('d', c.PROJECTS.d), 4);
  for (const status of ['pending', 'failed']) {
    c.PROJECTS.d.submissionState = status;
    assert.equal(c.demandSubmissionState('d'), status);
    assert.equal(c.demandEffectiveStage('d', c.PROJECTS.d), 3);
  }
});

test('unknown graph evidence stays unknown even when prose mentions a leader or an unverified gap', () => {
  const {c} = environment();
  assert.equal(c._correctChainLevel({level: 'unknown', note: '可能有龙头，是否缺失待核'}), 'unknown');
  const graph = c._normalizeChain([{seg: '上游', nodes: [{name: '配套', level: 'unknown', note: '待核', evidence_ids: ['s1'], sources: [{url: 'https://example.org/a'}]}]}]);
  assert.equal(graph[0].nodes[0].level, 'unknown'); assert.equal(graph[0].nodes[0].sources.length, 1);
});

test('five duplicate titles and headings with no body are incomplete', () => {
  const {c} = environment();
  assert.equal(c.isCompleteTopicReport(('一、产业基础\n有正文\n').repeat(5)), false);
  assert.equal(c.isCompleteTopicReport('一、基础\n二、缺口\n三、优先级\n四、画像\n五、待核\n'), false);
  assert.equal(c.isCompleteTopicReport(fullText), true);
});

test('local material errors release the job, and a blocked second action cannot clear an active job', async () => {
  const {c, events} = environment();
  c.buildKBCorpus = () => {throw new Error('invalid material');};
  await c.triggerReport(2);
  assert.equal(events.fetch.length, 0);assert.equal(c.window._reportGenerating, false);
  assert.deepEqual(Object.keys(c.window._topicReportJobs), []);
  c.window._topicReportJobs['p\u0000核电配套'] = {};
  c.REPORTSTATE.p.pendingByTopic['核电配套'][0].status = 'pending';
  c.triggerReport(2);
  assert.equal(c.window._reportGenerating, true);
});

test('native identity cannot promote a newly generated unreviewed draft to a full report', () => {
  const {c} = environment();
  const helpers = fs.readFileSync(path.join(root, 'frontend/index/script-02-sections/09.js'), 'utf8');
  vm.runInContext(declaration('nativeReportState', helpers), c);
  Object.assign(c.REPORTSTATE.p, {topic:'核电配套', text:'新草稿', scoreBasis:'核验一致项比例', userGeneratedTopics:{'核电配套':true}});
  assert.equal(c.nativeReportState('核电配套'), null);
  assert.equal(c.demandReportSnapshot('p', '核电配套'), null);
});

test('graph cache requires exact report and request provenance, and never rewrites the report text', () => {
  const {c} = environment();
  vm.runInContext(['currentEvidenceChain', 'chainEvidenceMatches', 'chainSourceIdentity', 'chainSnapshotIdentity', 'alignChainToReport'].map(n=>declaration(n)).join('\n'), c);
  const rs = c.REPORTSTATE.p;
  rs.aiReportByTopic['核电配套'] = fullText;
  rs.chainByTopic = {'核电配套':[{seg:'上游',nodes:[]}]};
  assert.equal(c.currentEvidenceChain('核电配套'), null);
  rs.chainEvidenceByTopic = {'核电配套':{contract:'source-bound-chain-v2',scope:'current-topic-v2',topic:'核电配套',requestId:'request-1',reportText:fullText,inputFingerprint:'server-fingerprint',sourceIdentity:c.savedEvidenceIdentity('p','核电配套')}};
  rs.chainStatusByTopic={'核电配套':'empty'};
  assert.equal(c.currentEvidenceChain('核电配套').length, 1);
  rs.aiReportByTopic['核电配套'] += '新版';
  assert.equal(c.currentEvidenceChain('核电配套'), null);
  assert.equal(c.alignChainToReport(fullText), fullText);
});

test('JSON-restored confirmation, withdrawal and edits update the canonical topic bucket', () => {
  const {c, elements} = environment();
  vm.runInContext(['currentPendingItems', 'cfmItem', 'uncfmItem', 'ciSave'].map(n=>declaration(n)).join('\n'), c);
  c.updateConfirmProgress=()=>{};c.refreshTopReliability=()=>{};
  c.REPORTSTATE.p.pendingByTopic['核电配套'][0].status='pending';
  c.PENDING_CONFIRMS.p=JSON.parse(JSON.stringify(c.REPORTSTATE.p.pendingByTopic['核电配套']));
  c.cfmItem('p',0);
  assert.equal(c.fullReportConfirmation('p','核电配套').ready,true);
  c.PENDING_CONFIRMS.p=JSON.parse(JSON.stringify(c.PENDING_CONFIRMS.p));
  c.uncfmItem('p',0);
  assert.equal(c.fullReportConfirmation('p','核电配套').ready,false);
  elements['ci-ta-p-0']={value:'修改后的完整条件'};
  c.ciSave('p',0);
  assert.equal(c.REPORTSTATE.p.pendingByTopic['核电配套'][0].editedText,'修改后的完整条件');
  assert.equal(c.fullReportConfirmation('p','核电配套').ready,true);
});

test('legacy gap cards cannot submit an unresearched direction or manufacture a full report', async () => {
  const {c, events} = environment();
  vm.runInContext(declaration('importToProject'),c);
  c.submitDemand=()=>{throw new Error('must not submit');};
  c.importToProject('别的产业缺口','闵行区','核电配套');
  assert.equal(Object.keys(c.PROJECTS).length,1);
  assert.equal(events.toasts.length,1);
});

test('stale checkpoints do not falsely claim an executor outage, and known retries are explicit', () => {
  const ops = fs.readFileSync(path.join(root, 'frontend/ops/script-03-sections/05.js'), 'utf8');
  const c = {}; vm.createContext(c); vm.runInContext(declaration('rrRunState', ops), c);
  const now = 1000000;
  assert.match(c.rrRunState({progressTs: now - 600000}, now).text, /状态待确认/);
  assert.match(c.rrRunState({engineStatus: 'retry_wait', failureCode: 'quality'}, now).text, /内容校验未通过.*重试/);
  assert.match(c.rrRunState({engineStatus: 'queued'}, now).text, /尚未开始/);
});

for (const [surface, file] of [['user','frontend/index/script-02-sections/12-tail.js'],['admin','frontend/ops/script-03-sections/12-tail.js']]) {
  test(surface + ' generation requires saved nonempty edited confirmations and preserves partial failures', async () => {
    const implementation=fs.readFileSync(path.join(root,file),'utf8');
    const {c,events}=environment(response(fullText,'length'),implementation);
    c.REPORTSTATE.p.pendingByTopic['核电配套']=[{text:'原条件',status:'edited',editedText:''}];
    await c.triggerReport(2);assert.equal(events.fetch.length,0);
    c.REPORTSTATE.p.pendingByTopic['核电配套'][0].editedText='确认条件';
    await c.triggerReport(2);assert.equal(events.fetch.length,1);
    assert.equal(c.REPORTSTATE.p.phaseByTopic['核电配套'],1);
    assert.equal(c.REPORTSTATE.p.partialByTopic['核电配套'].status,'incomplete');
    assert.equal(c.window._reportGenerating,false);
  });
}

test('request replacement while streaming rejects writes to the new report', async () => {
  let finish;const {c}=environment(()=>new Promise(resolve=>{finish=resolve;}));
  const work=c.triggerReport(2);await untilRequestStarted(()=>typeof finish==='function');
  c.PROJECTS.p.reportRequestId='request-2';finish(response(fullText));await work;
  assert.equal(c.REPORTSTATE.p.aiReportByTopic['核电配套'],undefined);
});

test('graph failure stays retryable and no embedded demo facts render',()=>{
 const {c}=environment();Object.assign(c,{_chainGenInFlight:{},reportTextForTopic:()=>fullText.repeat(2)});
 vm.runInContext(['currentEvidenceChain','chainMapHtml','escapeChainText'].map(n=>declaration(n)).join('\n'),c);
 c.REPORTSTATE.p.chainStatusByTopic={'核电配套':'failed'};
 const html=c.chainMapHtml(c.PROJECTS.p);assert.match(html,/重试生成图谱/);assert.doesNotMatch(html,/香菇|随州|本地优势|外省企业/);
});

test('admin graph and report selection use exact current evidence without legacy examples',()=>{
 const {c}=environment();const ops=fs.readFileSync(path.join(root,'frontend/ops/script-03-sections/12-tail.js'),'utf8');
 const helpers=fs.readFileSync(path.join(root,'frontend/ops/script-03-sections/14-tail.js'),'utf8');
 Object.assign(c,{_chainGenInFlight:{}});
 vm.runInContext(['currentEvidenceChain','chainMapHtml','escapeChainText'].map(n=>declaration(n,ops)).join('\n')+'\n'+['getTopicReport','reportTextForTopic'].map(n=>declaration(n,helpers)).join('\n'),c);
 c.REPORTSTATE.p.topic='other';c.REPORTSTATE.p.text='unrelated body';
 assert.equal(c.reportTextForTopic('核电配套'),null);
 c.REPORTSTATE.p.aiReportByTopic['核电配套']=fullText.repeat(2);
 assert.equal(c.reportTextForTopic('核电配套'),fullText.repeat(2));
 assert.match(c.chainMapHtml(c.PROJECTS.p),/生成产业链图谱/);
 assert.doesNotMatch(c.chainMapHtml(c.PROJECTS.p),/随州|香菇/);
});

test('admin task and report views expose research attachments at the bound download route',()=>{
 const task=fs.readFileSync(path.join(root,'frontend/ops/script-03-sections/05.js'),'utf8');
 const view=fs.readFileSync(path.join(root,'frontend/ops/script-03-sections/00.js'),'utf8');
 assert.match(task,/downloadReqFile.*research/);assert.match(view,/downloadOrigReport.*research/);
 assert.match(declaration('downloadReqFile',view),/\/api\/report-file\?requestId=/);
});

test('research events preserve source metadata and expose status without treating it as report text',async()=>{
  const {c}=environment(),seen=[];
  const events=[{type:'research.status',message:'正在交叉核对来源'},
    {type:'research.evidence',fingerprint:'server-source-v1',clientMaterialFingerprint:'client-v1',sources:[{id:'tr-long-id',label:'S1',url:'https://official.example/a',title:'原始资料',quote:'保留条件的原句',published_at:'2026-01-01',retrieved_at:'2026-10-16',support_status:'single_source'}]},
    {type:'research.complete',runId:'run-1',researchStatus:'completed',verificationStatus:'single_source',errors:[],queries:['原始资料查询'],checks:{sources:1}},
    {choices:[{delta:{content:fullText}}]},{choices:[{delta:{},finish_reason:'stop'}]}];
  const r=await c.readTopicReportStream({text:async()=>events.map(e=>'data: '+JSON.stringify(e)).join('\n\n')+'\n\ndata: [DONE]'},null,e=>seen.push(e.type));
  assert.equal(r.text,fullText);assert.equal(r.metadata.sources[0].id,'tr-long-id');assert.equal(r.metadata.sources[0].label,'S1');assert.equal(r.metadata.sources[0].support_status,'single_source');assert.equal(r.metadata.fingerprint,'server-source-v1');
  assert.equal(r.metadata.runId,'run-1');assert.deepEqual(seen,['research.status','research.evidence','research.complete']);
  assert.equal(r.metadata.researchStatus,'completed');assert.equal(r.metadata.verificationStatus,'single_source');
  assert.deepEqual(Array.from(r.metadata.queries),['原始资料查询']);assert.equal(r.metadata.errors.length,0);
});

test('material revisions during research cannot replace a completed report or its source metadata',async()=>{
  let finish;const {c,events}=environment(()=>new Promise(resolve=>{finish=resolve;}));
  c.KB_EDITS={p:{e1:{text:'原材料'}}};c.REPORTSTATE.p.aiReportByTopic['核电配套']='保留的完整报告';
  c.REPORTSTATE.p.researchByTopic={'核电配套':{fingerprint:'old'}};
  const work=c.triggerReport(2);await untilRequestStarted(()=>typeof finish==='function');
  assert.match(events.fetch[0].body.clientMaterialFingerprint,/^[a-f0-9]{64}$/);
  c.KB_EDITS.p.e1.text='已经修改的材料';finish(response(fullText));await work;
  assert.equal(c.REPORTSTATE.p.aiReportByTopic['核电配套'],'保留的完整报告');
  assert.equal(c.REPORTSTATE.p.researchByTopic['核电配套'].fingerprint,'old');
  assert.equal(c.REPORTSTATE.p.partialByTopic,undefined);
  assert.match(events.toasts.at(-1),/材料或确认事项已更新/);
});

test('new source metadata is isolated to the completed topic and mismatched echo is rejected',async()=>{
  const {c}=environment(()=>Promise.resolve({ok:true,text:async()=>[
    'data: '+JSON.stringify({type:'research.evidence',fingerprint:'server-fp',sources:[{id:'S1',url:'https://official.example/a',quote:'原句'}]}),
    'data: '+JSON.stringify({choices:[{delta:{content:fullText},finish_reason:'stop'}]}),'data: [DONE]'].join('\n\n')}));
  c.REPORTSTATE.p.researchByTopic={other:{fingerprint:'unchanged'}};await c.triggerReport(2);
  assert.equal(c.REPORTSTATE.p.researchByTopic['核电配套'].fingerprint,'server-fp');
  assert.equal(c.REPORTSTATE.p.researchByTopic.other.fingerprint,'unchanged');
  assert.equal(c.REPORTSTATE.p.researchByTopic['核电配套'].reportText,fullText);
  const bad=environment(()=>Promise.resolve({ok:true,text:async()=>[
    'data: '+JSON.stringify({type:'research.evidence',clientMaterialFingerprint:'wrong'}),
    'data: '+JSON.stringify({choices:[{delta:{content:fullText},finish_reason:'stop'}]})].join('\n\n')}));
  await bad.c.triggerReport(2);assert.equal(bad.c.REPORTSTATE.p.aiReportByTopic['核电配套'],undefined);
});

test('busy view replaces stale failure and generation actions with status and a disabled button',()=>{
  const {c}=environment();c.window._topicReportProgress={'p\u0000核电配套':{phase:2,message:'正在检索来源'}};
  c.REPORTSTATE.p.partialByTopic={'核电配套':{text:'上次未完成'}};
  vm.runInContext(declaration('reportBottomBarInner'),c);
  const html=c.reportBottomBarInner(c.PROJECTS.p);
  assert.match(html,/正在检索来源/);assert.match(html,/disabled aria-busy="true"/);
  assert.doesNotMatch(html,/上次生成未完成|onclick="triggerReport|待确认事项已完成/);
  assert.match(c.reportRunBanner(c.PROJECTS.p),/完整报告生成中/);
});

test('sources panel binds to the exact report and escapes untrusted fields and credential URLs',()=>{
  const {c}=environment();c.REPORTSTATE.p.aiReportByTopic['核电配套']=fullText;
  c.REPORTSTATE.p.researchByTopic={'核电配套':{topic:'核电配套',reportText:fullText,sources:[{id:'S1',title:'<script>x</script>',url:'https://user:pass@example.com/a',quote:'<img src=x onerror=x>'},{id:'S2',url:'https://official.example/a',title:'原始资料'}]}};
  vm.runInContext(['reportSafeSourceUrl','reportSourceDate','reportResearchSourcesHtml'].map(n=>declaration(n)).join('\n'),c);
  const html=c.reportResearchSourcesHtml(c.PROJECTS.p);
  assert.match(html,/href="https:\/\/official.example\/a"/);assert.doesNotMatch(html,/<script>|<img|user:pass/);
  assert.match(html,/&lt;script&gt;/);c.REPORTSTATE.p.researchByTopic['核电配套'].reportText='old';
  assert.equal(c.reportResearchSourcesHtml(c.PROJECTS.p),'');
});

test('source panel uses short labels and per-source support without certifying the whole report',()=>{
  const {c}=environment();c.REPORTSTATE.p.aiReportByTopic['核电配套']=fullText;
  c.REPORTSTATE.p.researchByTopic={'核电配套':{topic:'核电配套',reportText:fullText,sources:[
    {id:'tr-long-a',label:'S1',title:'来源一',support_status:'cross_checked'},
    {id:'tr-long-b',label:'S2',title:'来源二',support_status:'single_source'},
    {id:'tr-long-c',label:'S3',title:'来源三',support_status:'unverified'}]}};
  vm.runInContext(['reportSafeSourceUrl','reportSourceDate','reportResearchSourcesHtml'].map(n=>declaration(n)).join('\n'),c);
  const html=c.reportResearchSourcesHtml(c.PROJECTS.p);
  assert.match(html,/>S1<\/span>/);assert.match(html,/交叉支持/);assert.match(html,/单源待复核/);assert.match(html,/未核实/);
  assert.doesNotMatch(html,/tr-long-|整篇已核验/);assert.match(html,/不等于事实已核验/);
});

test('source dates preserve publication days, localize retrieval minutes, and keep invalid values safe',()=>{
  const {c}=environment();
  vm.runInContext(['reportSafeSourceUrl','reportSourceDate','reportResearchSourcesHtml'].map(n=>declaration(n)).join('\n'),c);
  assert.equal(c.reportSourceDate('2026-09-09T00:00:00.000Z',false),'2026-09-09');
  assert.equal(c.reportSourceDate('2026-09-09T00:00:00+14:00',false),'2026-09-09');
  const timestamp='2026-10-16T06:24:43.303057+00:00',local=new Date(timestamp);
  const pad=n=>String(n).padStart(2,'0');
  const expected=local.getFullYear()+'-'+pad(local.getMonth()+1)+'-'+pad(local.getDate())+' '+pad(local.getHours())+':'+pad(local.getMinutes());
  assert.equal(c.reportSourceDate(timestamp,true),expected);
  for(const invalid of ['2026-02-30','2026-13-01','2026','尚未公开','<img src=x onerror=x>'])assert.equal(c.reportSourceDate(invalid,true),invalid);
  assert.equal(c.reportSourceDate('  ',true),'未知');assert.equal(c.reportSourceDate(null,false),'未知');
  c.REPORTSTATE.p.aiReportByTopic['核电配套']=fullText;
  c.REPORTSTATE.p.researchByTopic={'核电配套':{topic:'核电配套',reportText:fullText,sources:[
    {label:'S1',published_at:'2026-09-09T00:00:00.000Z',retrieved_at:timestamp},
    {label:'S2',published_at:'<img src=x onerror=x>',retrieved_at:'  '}]}};
  const html=c.reportResearchSourcesHtml(c.PROJECTS.p);
  assert.ok(html.includes('发布：2026-09-09 · 检索：'+expected));
  assert.match(html,/检索时间为本地时间/);assert.match(html,/检索：未知/);
  assert.match(html,/发布：&lt;img src=x onerror=x&gt;/);assert.doesNotMatch(html,/<img|T00:00|\.303057/);
});
