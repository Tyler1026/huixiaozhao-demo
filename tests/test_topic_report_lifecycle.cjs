const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
    TextDecoder, AbortController, setTimeout() {return 1;}, clearTimeout() {}, Date, console,
    nativeReportState() {return null;},
  };
  vm.createContext(context);
  const shared=fs.readFileSync(path.join(root,'frontend/index/script-02-sections/12-part-00.js'),'utf8');
  vm.runInContext(declaration('savedEvidenceIdentity',shared),context);
  vm.runInContext(['fullReportConfirmation', 'topicReportMarkup', 'readTopicReportStream', 'syncTopicReportInputs', 'isCompleteTopicReport', 'updateReportBusy', 'triggerReport',
    'demandReportSnapshot', 'demandSubmissionState', 'demandEffectiveStage'].map(n => declaration(n, implementation)).join('\n') + '\n' + ['_correctChainLevel', '_normalizeChain'].map(n => declaration(n)).join('\n'), context);
  return {c: context, events, elements};
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
  await new Promise(setImmediate);
  c.PROJECTS.p.topic = '其他方向'; c.REPORTSTATE.p.text = 'other report';
  finish(response(fullText)); await work;
  assert.equal(c.REPORTSTATE.p.text, 'other report');
  assert.equal(c.REPORTSTATE.p.aiReportByTopic['核电配套'], fullText);
});

test('logout epoch prevents an old response from writing to new session storage', async () => {
  let finish;
  const {c, events} = environment(() => new Promise(resolve => {finish = resolve;}));
  const work = c.triggerReport(2), persisted = events.persist;
  await new Promise(setImmediate);
  c._authEpoch++; finish(response(fullText)); await work;
  assert.equal(events.persist, persisted);
  assert.equal(c.REPORTSTATE.p.aiReportByTopic['核电配套'], undefined);
});

test('repeat click shares one current-topic job and failure releases the lock for retry', async () => {
  let finish;
  const {c, events} = environment(() => new Promise(resolve => {finish = resolve;}));
  const work = c.triggerReport(2); c.triggerReport(2);
  await new Promise(setImmediate);
  assert.equal(events.fetch.length, 1);
  finish(response('partial', 'length')); await work;
  const retry = c.triggerReport(2); await new Promise(setImmediate); assert.equal(events.fetch.length, 2);
  finish(response(fullText)); await retry;
  assert.deepEqual(Object.keys(c.window._topicReportJobs), []);
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
  vm.runInContext(['currentEvidenceChain', 'alignChainToReport'].map(n=>declaration(n)).join('\n'), c);
  const rs = c.REPORTSTATE.p;
  rs.aiReportByTopic['核电配套'] = fullText;
  rs.chainByTopic = {'核电配套':[{seg:'上游',nodes:[]}]};
  assert.equal(c.currentEvidenceChain('核电配套'), null);
  rs.chainEvidenceByTopic = {'核电配套':{contract:'saved-excerpts-v1',scope:'current-topic-v1',requestId:'request-1',reportText:fullText,sourceIdentity:c.savedEvidenceIdentity('p','核电配套')}};
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
  const work=c.triggerReport(2);await new Promise(setImmediate);
  c.PROJECTS.p.reportRequestId='request-2';finish(response(fullText));await work;
  assert.equal(c.REPORTSTATE.p.aiReportByTopic['核电配套'],undefined);
});

test('graph failure stays retryable and no embedded demo facts render',()=>{
 const {c}=environment();Object.assign(c,{_chainGenInFlight:{},reportTextForTopic:()=>fullText});
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
 c.REPORTSTATE.p.aiReportByTopic['核电配套']=fullText;
 assert.equal(c.reportTextForTopic('核电配套'),fullText);
 assert.match(c.chainMapHtml(c.PROJECTS.p),/生成产业链图谱/);
 assert.doesNotMatch(c.chainMapHtml(c.PROJECTS.p),/随州|香菇/);
});

test('admin task and report views expose research attachments at the bound download route',()=>{
 const task=fs.readFileSync(path.join(root,'frontend/ops/script-03-sections/05.js'),'utf8');
 const view=fs.readFileSync(path.join(root,'frontend/ops/script-03-sections/00.js'),'utf8');
 assert.match(task,/downloadReqFile.*research/);assert.match(view,/downloadOrigReport.*research/);
 assert.match(declaration('downloadReqFile',view),/\/api\/report-file\?requestId=/);
});
