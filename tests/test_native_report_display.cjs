const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, 'frontend/index/script-02-sections', file), 'utf8');

// These declarations have no following top-level effects. Run the actual
// browser functions while keeping network/timers and customer storage absent.
function declaration(file, name) {
  const source = read(file), start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}
function publication() {
  const code = `import json
from test_website_report_engine import WebsiteEngineTests
t=WebsiteEngineTests(); t.setUp()
try:
 t.store.payloads['09_compact_report.md']=('OFFLINE NATIVE DISPLAY FIXTURE - NOT REAL RESEARCH. '*4).strip().encode()
 t.completed(); s=t.read(); s['REPORT_REQUESTS'][0]['pushRequested']=True; t.write(s)
 t.queue.mirror(); print(json.dumps(t.read()))
finally: t.doCleanups()
`;
  return JSON.parse(execFileSync(process.env.PYTHON || 'python3', ['-c', code], {
    cwd: root, env: {...process.env, PYTHONPATH: [root, path.join(root, 'tests'), process.env.PYTHONPATH || ''].join(path.delimiter)},
    encoding: 'utf8',
  }));
}
function harness(state) {
  const key = 'report_rrfixture', elements = {reportArea: {innerHTML: ''}, chainMapBlock: {}, reportHistoryArea: {innerHTML: ''}};
  const exports = {pdf: [], text: []}, local = {};
  const context = {...state, cur: key, REPORT_HISTORY: {}, UPLOADS: {}, PENDING_CONFIRMS: {},
    kbReadiness: () => ({score: 60}), chainPriorityMarkdown: () => '',
    stageNameOf: () => '资料准备', stageDescOf: () => '上传与授权材料',
    setTimeout() {}, _histShowAll: false, window: {}, DEMANDS: [], LS_KEY: 'offline', console,
    _findExistingDemand: () => null, toast() {},
    stColor: () => ({bg: '#fff', c: '#333'}), projStages: () => [['准备'], ['分析'], ['确认'], ['匹配'], ['对接']],
    visibleClues: p => p.clues, renderCluesTwoPanel: () => '', dockProgressInline: () => '', isMainProject: () => false,
    Blob: class {constructor(parts) {exports.text.push(parts.join(''));}},
    URL: {createObjectURL: () => 'blob:offline', revokeObjectURL() {}},
    localStorage: {getItem: key => local[key]},
    fetch: async () => ({ok: true, json: async () => ({ok: true})}),
    document: {getElementById: id => elements[id] || null, querySelector: () => null,
      body: {appendChild() {}}, createElement: name => name === 'iframe'
        ? {style: {}, contentWindow: {document: {open() {}, write: html => exports.pdf.push(html), close() {}}}}
        : {click() {}, remove() {}}},
  };
  context.P = () => context.PROJECTS[context.cur];
  context.persist = () => {local.offline = JSON.stringify({PROJECTS: context.PROJECTS, REPORTSTATE: context.REPORTSTATE, DEMANDS: context.DEMANDS});};
  vm.createContext(context);
  vm.runInContext([
    ['08.js', 'getEmbeddedReport'], ['08.js', 'getTopicReport'], ['08.js', 'reportTextForTopic'], ['08.js', 'topicHasFullReport'],
    ['09.js', '_normTopic'], ['09.js', '_frozenScoreIn'], ['09.js', 'nativeReportState'], ['09.js', 'nativeReportScore'], ['09.js', 'topicScoreLabel'],
    ['09.js', 'topicScoreDisplay'], ['09.js', 'topicScore'], ['09.js', 'hashTopic'],
    ['12-tail.js', 'alignChainToReport'], ['12-tail.js', 'reportHtml'], ['12-tail.js', 'reportBottomBarInner'],
    ['00.js', 'setReportAreaHtml'], ['00.js', 'viewCurrentReport'], ['13.js', 'detailReport'],
    ['00.js', 'reportMdToHtml'], ['00.js', 'downloadReportPDF'], ['00.js', 'downloadReportTxt'],
    ['12-tail.js', 'getReportHistoryForProject'], ['12-tail.js', 'renderHistoryReports'],
    ['12-tail.js', 'projMgmtPage'], ['12-tail.js', 'submitDemand'],
  ].map(([file, name]) => declaration(file, name)).join('\n'), context);
  return {context, elements, exports, project: state.PROJECTS[key], report: state.REPORTSTATE[key]};
}

test('native publish round-trip reaches actual topic/body/status and all three ratio labels', () => {
  const {context: c, elements, project: p, report: r} = harness(publication());
  assert.equal(c.reportTextForTopic(p.topic), r.text);
  assert.equal(c.topicHasFullReport(p.topic), true);
  assert.equal(c.topicScore(p.topic), 100);
  assert.ok(c.reportHtml(p).includes(r.text));
  assert.ok(c.reportHtml(p).includes('核验一致项比例 100%'));
  assert.ok(c.detailReport(p).includes('核验一致项比例 100%'));
  assert.ok(c.reportBottomBarInner(p).includes('查看完整报告'));
  c.viewCurrentReport();
  assert.ok(elements.reportArea.innerHTML.includes(r.text));
  assert.ok(elements.reportArea.innerHTML.includes('核验一致项比例 100%'));
  assert.equal(p.clues.length, 0);
});

test('native 0 remains 0; unrelated directions and legacy confidence use existing fallback', () => {
  const {context: c, project: p, report: r} = harness(publication());
  r.score = 0;
  assert.equal(c.topicScore(p.topic), 0);
  assert.equal(c.topicScoreLabel(p.topic), '核验一致项比例');
  assert.ok(c.reportHtml(p).includes('核验一致项比例 0%'));
  const other = '未生成的新方向';
  assert.equal(c.reportTextForTopic(other), null);
  assert.equal(c.topicHasFullReport(other), false);
  assert.equal(c.nativeReportScore(other), null);
  assert.equal(c.topicScoreLabel(other), '置信度');
  assert.ok(c.topicScore(other) >= 42);
  r.score = null;
  assert.equal(c.nativeReportScore(p.topic), null);
  assert.equal(c.topicScoreLabel(p.topic), '置信度');
  r.score = 73; r.sourceReportId = 'another-request';
  assert.equal(c.nativeReportScore(p.topic), null);
  delete r.sourceReportId; r.scoreByTopic = {[p.topic]: 81};
  assert.equal(c.topicScore(p.topic), 81);
  assert.equal(c.topicScoreLabel(p.topic), '置信度');
});

test('free-form verdict classification displays pending review, never a numeric confidence', () => {
  const {context: c, project: p, report: r, elements} = harness(publication());
  r.score = 0; r.scoreStatus = 'unclassified';
  assert.equal(c.topicScoreDisplay(p.topic), '核验分类待校核');
  assert.ok(c.reportHtml(p).includes('核验分类待校核'));
  assert.ok(!c.reportHtml(p).includes('核验一致项比例 0%'));
  assert.ok(c.detailReport(p).includes('核验分类待校核'));
  c.viewCurrentReport();
  assert.ok(elements.reportArea.innerHTML.includes('核验分类待校核'));
  assert.ok(!elements.reportArea.innerHTML.includes('置信度 0%'));
  r.score = null; r.scoreStatus = 'unavailable';
  assert.equal(c.topicScoreDisplay(p.topic), '暂无核验结论');
});

test('native history, project card and PDF/TXT exports agree for 100, true 0 and unclassified', () => {
  for (const [score, status, label] of [[100, 'classified', '核验一致项比例 100%'], [0, 'classified', '核验一致项比例 0%'], [0, 'unclassified', '核验分类待校核']]) {
    const {context: c, elements, project: p, report: r, exports: out} = harness(publication());
    r.score = score; r.scoreStatus = status;
    c.renderHistoryReports(c.cur);
    assert.ok(elements.reportHistoryArea.innerHTML.includes(label));
    p.isDemand = true; p.stage = 3; c.window.__projOpen = c.cur;
    assert.ok(c.projMgmtPage(p).includes(label));
    c.downloadReportPDF('full');
    assert.ok(out.pdf.at(-1).includes(label));
    assert.ok(!out.pdf.at(-1).includes('研判置信度'));
    c.downloadReportTxt('full'); c.downloadReportTxt('short');
    assert.ok(out.text.every(text => text.includes(label)));
    assert.ok(out.text.every(text => !text.includes('置信度：')));
  }
  const {context: c, report: r, exports: out} = harness(publication());
  delete r.sourceReportId; r.score = 81;
  c.downloadReportPDF('full'); c.downloadReportTxt('full');
  assert.ok(out.pdf.at(-1).includes('研判置信度<b>81%</b>'));
  assert.ok(out.text.at(-1).includes('置信度：81%'));
});

test('native demand carries the exact publication identity and pending classification to its project card', async () => {
  const {context: c, project: p, report: r} = harness(publication());
  r.score = 0; r.scoreStatus = 'unclassified';
  await c.submitDemand();
  const demand = c.DEMANDS[0], child = c.PROJECTS[demand.projKey];
  assert.equal(child.reportRequestId, p.reportRequestId);
  assert.equal(child.clues.length, 0);
  assert.ok(demand.need.includes('核验分类待校核'));
  assert.ok(!demand.need.includes('置信度'));
  assert.equal(c.topicScoreDisplay(child.topic, demand.projKey), '核验分类待校核');
  c.window.__projOpen = demand.projKey;
  assert.ok(c.projMgmtPage(p).includes('核验分类待校核'));
});
