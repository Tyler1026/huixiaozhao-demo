'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

function declaration(relative, name) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'Missing production function ' + name);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end < 0 ? source.length : end);
}
function boot() {
  const topic = '生物医药上游材料';
  const submitted = (title, description, focus) => ({
    city: '闵行区', topic, sourceProjectKey: 'parent', sourceAnalysisTopic: topic,
    isDemand: true, submissionState: 'submitted', demandContract: 'industry-demand-v1',
    workspaceId: 'minhang', demandTitle: title, sourcePriorityKey: JSON.stringify(['industry', focus]),
    demandSpec: {title, description, conditions: ''}, selectedPriority: {focus, sources: []},
    stage: 4, submittedAt: 1770000000000, clues: [],
  });
  const PROJECTS = {
    parent: {city: '闵行区', topic, stage: 2},
    filters: submitted('生物制药滤器招引', '引入无菌滤膜中试产线', '生物制药滤器'),
    media: submitted('色谱填料招引', '引入高载量纯化材料企业', '色谱填料'),
    pending: {...submitted('待提交草稿', '尚未提交', '草稿'), submissionState: 'pending'},
    failed: {...submitted('失败的需求', '没有成功提交', '失败'), submissionState: 'failed'},
    noReceipt: submitted('没有回执的需求', '未确认', '未确认'),
    notBoolean: {...submitted('伪需求标记', '未提交', '伪需求'), isDemand: 'true'},
    outside: {...submitted('其他工作区的需求', '不得泄漏', '外区'), workspaceId: 'other'},
  };
  PROJECTS.filters.clues = [
    {id: 'filter-a', name: 'Alpha Filter', kind: '耗材', region: '苏州', tone: 'teal', status: '已核验'},
    {id: 'filter-b', name: '乙方滤膜', verificationRequest: {contract: 'docking-action-v1', id: 'vr-1', status: 'requested'}},
    {id: 'scan', name: '扫描占位', status: 'ai_scan'},
    {id: 'anonymous', name: '脱敏企业示例'},
    {id: 'deleted', name: '已删除企业'},
  ];
  PROJECTS.media.clues = [{id: 'media-a', name: '填料制造商', reason: '已有相关产品原文，需继续确认产能'}];
  const DOCK_LOGS = {
    filters: [
      {id: 'log-1', contract: 'docking-action-v1', kind: 'contact_log', type: 'call', clueId: 'filter-a', note: '已电话了解产品，投资计划尚未确认', actor: '测试记录人', ts: 1770000100000},
      {id: 'vr-1', contract: 'docking-action-v1', kind: 'verification_request', clueId: 'filter-b', ts: 1770000200000},
      {type: 'visit', note: '历史拜访记录', ts: 1769000000000},
      null, 'invalid',
    ],
    media: [],
  };
  const calls = {writes: 0, fetches: 0, renders: 0, toasts: []};
  const nodes = Object.create(null);
  const tabs = [];
  let allowedKeys = Object.keys(PROJECTS).filter(key => key !== 'outside');
  const c = {
    PROJECTS, DOCK_LOGS,
    DEMANDS: ['filters', 'media', 'pending', 'failed', 'outside', 'notBoolean'].map(projKey => ({id: projKey + '-receipt', projKey})),
    window: {}, _authEpoch: 1, view: 'home', cur: 'parent', URL, Date, console,
    cityKeys: () => allowedKeys,
    isClueDeleted: (key, clue) => key === 'filters' && clue.id === 'deleted',
    _projKeyOf: p => Object.keys(PROJECTS).find(key => PROJECTS[key] === p),
    document: {activeElement: null, getElementById: id => nodes[id] || null, querySelectorAll: () => tabs},
    persist() {calls.writes++;}, render() {calls.renders++;},
    fetch() {calls.fetches++; throw new Error('Read-only workspace must not request data');},
    toast(message) {calls.toasts.push(message);},
  };
  vm.createContext(c);
  vm.runInContext([
    declaration('frontend/index/script-02-sections/12-tail.js', 'escapeChainText'),
    declaration('frontend/index/script-02-sections/12-tail.js', 'demandSubmissionState'),
    declaration('frontend/index/script-02-sections/11.js', 'visibleClues'),
    fs.readFileSync(path.join(root, 'frontend/shared/industry-demands.js'), 'utf8'),
    fs.readFileSync(path.join(root, 'frontend/shared/docking-actions.js'), 'utf8'),
    fs.readFileSync(path.join(root, 'frontend/index/docking-workspace.js'), 'utf8'),
  ].join('\n'), c);
  const businessState = () => JSON.stringify({projects: c.PROJECTS, demands: c.DEMANDS, logs: c.DOCK_LOGS});
  return {c, calls, nodes, tabs, businessState, setAllowed(keys) {allowedKeys = keys;}};
}
function values(array) {return Array.from(array);}
function metrics(html) {
  return Array.from(html.matchAll(/class="docking-metric"><small>([^<]+)<\/small><strong>(\d+)<\/strong>/g), match => [match[1], Number(match[2])]);
}
function node(initial = {}) {
  const attributes = Object.create(null);
  return Object.assign({innerHTML: '', value: '', scrollTop: 0,
    getAttribute(name) {return attributes[name] ?? null;},
    setAttribute(name, value) {attributes[name] = String(value);},
  }, initial);
}

test('workspace shows only submitted demand children with receipts in the active workspace', () => {
  const {c, businessState, calls} = boot();
  const before = businessState();
  assert.deepEqual(values(c.dockingDemandKeys()), ['filters', 'media']);
  const html = c.dockingWorkspacePage();
  assert.match(html, /生物制药滤器招引/);
  assert.match(html, /色谱填料招引/);
  for (const hidden of ['待提交草稿', '失败的需求', '没有回执的需求', '伪需求标记', '其他工作区的需求']) assert.ok(!html.includes(hidden), hidden);
  assert.equal((html.match(/class="docking-demand-row /g) || []).length, 2);
  assert.equal(businessState(), before);
  assert.equal(calls.writes + calls.fetches, 0);
});

test('two concrete demands from the same report remain independently selectable', () => {
  const {c, nodes} = boot();
  nodes.dockingListResults = node();
  nodes.dockingDetailHost = node();
  c.dockingWorkspacePage();
  c.dockingSelect('media');
  assert.equal(c.dockingViewState().selected, 'media');
  assert.match(nodes.dockingDetailHost.innerHTML, /<h2>色谱填料招引<\/h2>/);
  assert.match(nodes.dockingDetailHost.innerHTML, /引入高载量纯化材料企业/);
  assert.doesNotMatch(nodes.dockingDetailHost.innerHTML, /引入无菌滤膜中试产线/);
  c.dockingSelect('parent');
  assert.equal(c.dockingViewState().selected, 'media');
  c.dockingSelect('pending');
  assert.equal(c.dockingViewState().selected, 'media');
});

test('metrics count saved visible clues, genuine request receipts and saved logs only', () => {
  const {c} = boot();
  assert.deepEqual(metrics(c.dockingWorkspacePage()), [['招商需求', 2], ['候选企业', 3], ['待处理核验', 1], ['跟进记录', 2]]);
  const summary = c.dockingSummary('filters');
  assert.equal(summary.clues.length, 2);
  assert.equal(summary.events.length, 3);
  assert.equal(summary.contacts.length, 2);
  assert.equal(summary.requested, 1);
  assert.equal(summary.pending, 1);
  assert.equal(summary.latest, 1770000200000);
  assert.deepEqual(values(c.dockingEvents('filters')).map(event => event.ts), [1770000200000, 1770000100000, 1769000000000]);
  c.dockingViewState().search = '填料';
  assert.deepEqual(metrics(c.dockingWorkspacePage()), [['招商需求', 2], ['候选企业', 3], ['待处理核验', 1], ['跟进记录', 2]]);
});

test('search matches the concrete requirement, conditions and visible enterprise names', () => {
  const {c} = boot();
  const search = value => {c.dockingViewState().search = value; return values(c.dockingFilteredKeys(c.dockingDemandKeys()));};
  assert.deepEqual(search('  ALPHA FILTER  '), ['filters']);
  assert.deepEqual(search('中试产线'), ['filters']);
  assert.deepEqual(search('高载量'), ['media']);
  c.PROJECTS.media.demandSpec.conditions = '具备洁净车间';
  assert.deepEqual(search('洁净车间'), ['media']);
  assert.deepEqual(search('扫描占位'), []);
  assert.deepEqual(search('不存在的需求'), []);
  assert.match(c.dockingWorkspacePage(), /没有符合条件的需求/);
  c.dockingClearFilters();
  assert.deepEqual(search(''), ['filters', 'media']);
});

test('filters use actual request and follow-up records rather than project stage', () => {
  const {c} = boot();
  c.dockingSetFilter('verification');
  assert.deepEqual(values(c.dockingFilteredKeys(c.dockingDemandKeys())), ['filters', 'media']);
  c.dockingSetFilter('followed');
  assert.deepEqual(values(c.dockingFilteredKeys(c.dockingDemandKeys())), ['filters']);
  c.dockingSetFilter('unsupported');
  assert.equal(c.dockingViewState().filter, 'followed');
  c.dockingSetFilter('all');
  assert.equal(c.dockingViewState().filter, 'all');
});

test('missing evidence and historical green states do not create scores or verification conclusions', () => {
  const {c} = boot();
  const clue = c.PROJECTS.filters.clues[0];
  c.DOCK_LOGS.filters = [];
  const html = c.dockingClueHtml('filters', clue);
  assert.match(html, /历史状态待复核/);
  assert.match(html, /暂无已保存的产品原文/);
  assert.match(html, /尚未保存匹配理由/);
  assert.match(html, /投资意向尚未取得独立核验记录/);
  assert.doesNotMatch(html, /匹配度|[0-9]+%|data-tone="(?:green|teal)"/);
  assert.doesNotMatch(html, />核验通过<|>已核验<|>可安排<|>可沟通</);
  assert.equal(clue.status, '已核验');
  assert.equal(clue.tone, 'teal');
  const details = c.dockingDetailHtml('media');
  assert.match(details, /还没有跟进记录/);
  assert.doesNotMatch(details, /查看建议依据/);
});

test('all stored text is escaped and sources only link to HTTP(S) without credentials', () => {
  const {c} = boot();
  const attack = '<img src=x onerror="alert(1)"> & \'quoted\'';
  Object.assign(c.PROJECTS.media, {demandTitle: attack, city: attack, sourceAnalysisTopic: attack});
  c.PROJECTS.media.demandSpec.description = attack;
  c.PROJECTS.media.demandSpec.conditions = attack;
  c.PROJECTS.media.selectedPriority = {focus: attack, sources: [{quote: attack, url: 'javascript:alert(1)', title: attack}]};
  c.PROJECTS.media.clues[0] = {id: 'x\" onclick=\"alert(1)', name: attack, kind: attack, region: attack, reason: attack, signal: attack, questions: [attack], evidence: [{quote: attack, url: 'data:text/html,evil'}]};
  c.DOCK_LOGS.media = [{kind: 'contact_log', contract: 'docking-action-v1', id: 'log-x', type: 'note', note: attack, actor: attack, ts: 1770000200000, files: [{name: attack}]}];
  const html = c.dockingWorkspacePage() + c.dockingDetailHtml('media');
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &#39;quoted&#39;/);
  assert.doesNotMatch(html, /href="(?:javascript:|data:)/);
  const evidence = c.dockingEvidenceHtml([
    {quote: '允许来源', url: 'https://example.org/evidence?a=1&b=2', title: '产品 & 原文'},
    {quote: '非安全协议', url: 'javascript:alert(1)'},
    {quote: '带认证信息', url: 'https://name:password@example.org/private'},
    {quote: '文件链接', url: 'file:///tmp/private'},
    {quote: '', url: 'https://example.org/empty'},
  ]);
  assert.match(evidence, /href="https:\/\/example.org\/evidence\?a=1&amp;b=2"/);
  assert.match(evidence, /rel="noopener noreferrer"/);
  assert.equal((evidence.match(/<a /g) || []).length, 1);
  assert.doesNotMatch(evidence, /password|javascript:|file:\/\/|example.org\/empty/);
});

test('background render preserves scroll, focus and open evidence without altering business data', () => {
  const {c, nodes, businessState, calls} = boot();
  const details = [{open: true}, {open: false}];
  nodes.dockingWorkspace = {querySelectorAll: () => details};
  nodes.dockingDemandSearch = node({value: 'Alpha', selectionStart: 2, selectionEnd: 4,
    focus() {c.document.activeElement = this;}, setSelectionRange(start, end) {this.selectionStart = start; this.selectionEnd = end;}});
  nodes.dockingDetailHost = node({scrollTop: 510});
  nodes.dockingListResults = node({scrollTop: 61});
  c.document.activeElement = nodes.dockingDemandSearch;
  c.dockingWorkspacePage();
  const before = businessState(), snapshot = c.dockingCaptureView();
  c.dockingWorkspacePage();
  nodes.dockingDetailHost.scrollTop = 0;
  nodes.dockingListResults.scrollTop = 0;
  details[0].open = false;
  c.document.activeElement = null;
  c.dockingRestoreView(snapshot);
  assert.equal(nodes.dockingDetailHost.scrollTop, 510);
  assert.equal(nodes.dockingListResults.scrollTop, 61);
  assert.equal(details[0].open, true);
  assert.equal(details[1].open, false);
  assert.equal(c.document.activeElement, nodes.dockingDemandSearch);
  assert.equal(nodes.dockingDemandSearch.selectionStart, 2);
  assert.equal(nodes.dockingDemandSearch.selectionEnd, 4);
  assert.equal(businessState(), before);
  assert.equal(calls.fetches + calls.writes, 0);
});

test('authentication epoch resets selection filters and blocks a previous account snapshot', () => {
  const {c, nodes, setAllowed} = boot();
  nodes.dockingDetailHost = node({scrollTop: 80});
  nodes.dockingListResults = node({scrollTop: 20});
  nodes.dockingWorkspace = {querySelectorAll: () => []};
  c.dockingSelect('media');
  c.dockingViewState().search = 'Alpha';
  c.dockingViewState().filter = 'followed';
  const snapshot = c.dockingCaptureView();
  c._authEpoch++;
  setAllowed(['outside']);
  const reset = c.dockingViewState();
  assert.equal(reset.selected, null);
  assert.equal(reset.search, '');
  assert.equal(reset.filter, 'all');
  assert.equal(c.dockingSelectedKey(c.dockingDemandKeys()), 'outside');
  nodes.dockingDetailHost.scrollTop = 0;
  c.dockingRestoreView(snapshot);
  assert.equal(nodes.dockingDetailHost.scrollTop, 0);
  assert.equal(c.dockingViewState().selected, 'outside');
  assert.doesNotMatch(c.dockingWorkspacePage(), /生物制药滤器招引|色谱填料招引/);
});

test('a workspace without submitted demands presents a factual empty state with zero metrics', () => {
  const {c, setAllowed, calls, businessState} = boot();
  setAllowed(['parent', 'pending', 'failed', 'noReceipt']);
  const before = businessState(), html = c.dockingWorkspacePage();
  assert.deepEqual(metrics(html), [['招商需求', 0], ['候选企业', 0], ['待处理核验', 0], ['跟进记录', 0]]);
  assert.match(html, /从一条具体的招商需求开始/);
  assert.match(html, /提交招商需求/);
  assert.match(html, /查看产业分析/);
  assert.doesNotMatch(html, /docking-demand-row|Alpha Filter|生物制药滤器招引/);
  assert.equal(businessState(), before);
  assert.equal(calls.writes + calls.fetches, 0);
});

test('attachment-only notes do not impersonate verification requests and old company names remain frozen', () => {
  const {c}=boot();
  const html=c.dockingTimelineHtml('a', [{id:'f',contract:'docking-action-v1',kind:'contact_log',type:'material',note:'',files:[{name:'材料.txt'}],clueName:'提交当时的企业名称',clueId:'one',ts:1000,actor:'记录人'}]);
  assert.match(html,/已保存附件/);
  assert.doesNotMatch(html,/已提交核验申请/);
  assert.match(html,/提交当时的企业名称/);
});
test('each identified candidate exposes read-only contact materials without claiming verified reachability', () => {
  const {c}=boot();
  const html=c.dockingClueHtml('a',{id:'c',name:'企业',tone:'slate',questions:[],evidence:[]});
  assert.match(html,/联系资料/);
  assert.match(html,/showContactCard/);
  assert.doesNotMatch(html,/核验通过|1 个工作日|已通知/);
});

test('known direct demand shows real receiving feedback without a fabricated report link',()=>{
  const {c}=boot();const p=c.PROJECTS.media;
  p.demandOrigin='direct';p.demandSpec.source='user_direct';delete p.selectedPriority;delete p.sourceAnalysisTopic;
  p.intake={contract:'docking-action-v1',status:'needs_info',version:1,owner:'受理人甲',nextStep:'补充产品规格后复核',reply:'请明确过滤精度与目标应用',repliedAt:1770000300000,repliedBy:'管理员甲',updatedAt:1770000400000,updatedBy:'客户乙'};
  const html=c.dockingDetailHtml('media');
  assert.match(html,/待补充资料/);assert.match(html,/受理人甲/);assert.match(html,/补充产品规格后复核/);assert.match(html,/请明确过滤精度与目标应用/);assert.match(html,/管理员甲/);assert.doesNotMatch(html,/客户乙/);
  assert.match(html,/机构直接提交/);assert.doesNotMatch(html,/>来源报告<|来源分析|原始建议/);assert.match(html,/openDockingSupplement/);
});
test('verification feedback and independently reviewed product match are not mislabeled as legacy status',()=>{
  const {c}=boot();const clue=c.PROJECTS.media.clues[0];
  clue.tone='amber';clue.review={scope:'human_match_review_pending',product:{quote:'有据产品'},demand:{quote:'明确需求'}};
  assert.equal(c.dockingClueState('media',clue).key,'matched');assert.match(c.dockingClueHtml('media',clue),/已核对产品适配/);
  clue.verificationRequest={contract:'docking-action-v1',id:'r',status:'completed',version:1,outcome:'not_suitable',reply:'本次要求的精度范围不匹配',evidence:'核对了已保存产品规格',updatedAt:1770000300000,updatedBy:'管理员'};
  const html=c.dockingClueHtml('media',clue);assert.match(html,/本次需求不适配/);assert.match(html,/本次要求的精度范围不匹配/);assert.match(html,/核对了已保存产品规格/);assert.doesNotMatch(html,/历史状态待复核|onclick="requestVerify/);
});
