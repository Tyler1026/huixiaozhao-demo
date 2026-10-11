'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
function read(app, file) {
  return fs.readFileSync(path.join(root, 'frontend', app,
    app === 'index' ? 'script-02-sections' : 'script-03-sections', file), 'utf8');
}
function declaration(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const match = source.slice(start).match(/^function [\s\S]*?^}/m);
  assert.ok(match, name + ' body');
  return match[0];
}
function harness(app) {
  const topic = 'QA核电换热配套', body = '# 实际方向报告\n' + '来源及待核结论。'.repeat(30);
  const area = {innerHTML: ''};
  const state = {topic, text: body, ts: 1700000000000, phase: 2, score: 45,
    sourceReportId: 'native-request', scoreBasis: '核验一致项比例', scoreStatus: 'unclassified',
    aiReportByTopic: {[topic]: body}, phaseByTopic: {[topic]: 2},
    tsByTopic: {[topic]: 1700000000000}, scoreByTopic: {[topic]: null},
    userGeneratedTopics: {[topic]: true}, evidenceStatusByTopic: {[topic]: 'unreviewed'}};
  const storage = {};
  const c = {REPORTSTATE: {p: state}, REPORT_HISTORY: {}, PROJECTS: {p: {topic, reportRequestId: 'native-request'}},
    cur: 'p', _histShowAll: false,
    document: {getElementById: id => id === 'reportHistoryArea' ? area : null},
    localStorage: {setItem: (k, v) => {storage[k] = v;}},
    // Any new fallback to this legacy estimator fails the regression immediately.
    kbReadiness: () => {throw new Error('history must not estimate an unknown score');}};
  c.P = () => c.PROJECTS.p;
  vm.createContext(c);
  const history = read(app, '12-tail.js');
  const native = read(app, app === 'index' ? '09.js' : '12-tail.js');
  const names = ['nativeReportState', 'nativeReportScore', 'topicScoreLabel', 'topicScoreDisplay'];
  if (app === 'index') names.push('topicScore');
  let code = names.map(name => declaration(native, name)).join('\n');
  code += '\n' + ['saveReportHistory', 'reportHistoryRecord', 'reportHistoryScoreDisplay',
    'archiveCurrentReport', 'renderHistoryReports'].map(name => declaration(history, name)).join('\n');
  if (app === 'index') code += '\n' + declaration(history, 'getReportHistoryForProject');
  vm.runInContext(code, c);
  return {c, state, area, storage, topic, body};
}
function nativeState(h, score, status) {
  delete h.state.evidenceStatusByTopic[h.topic];
  delete h.state.userGeneratedTopics[h.topic];
  h.state.score = score;
  h.state.scoreByTopic[h.topic] = score;
  h.state.scoreStatus = status;
}
function render(h, app) {
  if (app === 'ops') h.c.archiveCurrentReport('p');
  h.c.renderHistoryReports('p');
  return h.area.innerHTML;
}

for (const app of ['index', 'ops']) {
  test(app + ' history keeps explicit unreviewed/null despite a stale native score', () => {
    const h = harness(app);
    const html = render(h, app);
    assert.ok(html.includes('内容待核验'));
    assert.ok(!html.includes('45%'));
    assert.ok(!html.includes('72%'));
    h.state.scoreByTopic[h.topic] = 60; // cached pre-fix sanitizer value
    assert.ok(render(h, app).includes('内容待核验'));
    assert.ok(!h.area.innerHTML.includes('60%'));
  });

  test(app + ' explicit null is not replaced by the project score or a computed score', () => {
    const h = harness(app);
    delete h.state.evidenceStatusByTopic[h.topic];
    delete h.state.sourceReportId;
    const record = h.c.reportHistoryRecord('p', h.topic, h.body);
    assert.equal(record.score, null);
    assert.equal(h.c.reportHistoryScoreDisplay(record, 'p'), '内容待核验');
    delete h.state.scoreByTopic[h.topic];
    h.state.score = undefined;
    assert.equal(h.c.reportHistoryRecord('p', h.topic, h.body).score, null);
  });

  test(app + ' saved legacy 81 and true zero remain visible without recalculation', () => {
    for (const score of [81, 0]) {
      const h = harness(app);
      delete h.state.evidenceStatusByTopic[h.topic];
      delete h.state.sourceReportId;
      h.state.scoreByTopic[h.topic] = score;
      assert.equal(h.c.reportHistoryRecord('p', h.topic, h.body).score, score);
      assert.ok(render(h, app).includes('>' + score + '%</span>'));
    }
  });

  test(app + ' native zero and unknown classification survive archival and reload', () => {
    for (const [score, status, expected] of [
      [0, 'classified', '核验一致项比例 0%'],
      [0, 'unclassified', '核验分类待校核'],
      [null, 'unavailable', '暂无核验结论'],
    ]) {
      const h = harness(app);
      nativeState(h, score, status);
      h.c.archiveCurrentReport('p');
      assert.equal(h.c.reportHistoryScoreDisplay(h.c.REPORT_HISTORY.p[0], 'p'), expected);
      const saved = JSON.parse(h.storage.hxz_rpt_history);
      // A different current direction must not change the archived score meaning.
      h.c.REPORTSTATE.p = {topic: '另一个方向'};
      h.c.REPORT_HISTORY = saved;
      assert.equal(h.c.reportHistoryScoreDisplay(saved.p[0], 'p'), expected);
    }
  });

  test(app + ' archive persists exact topic metadata and repairs an older same-snapshot badge', () => {
    const h = harness(app);
    h.c.REPORT_HISTORY.p = [{topic: h.topic, text: h.body, ts: h.state.ts, score: 72, phase: 2}];
    // Existing archives without the new fields must respect the current exact snapshot.
    assert.equal(h.c.reportHistoryScoreDisplay(h.c.REPORT_HISTORY.p[0], 'p'), '内容待核验');
    h.c.archiveCurrentReport('p');
    assert.equal(h.c.REPORT_HISTORY.p.length, 1);
    const saved = JSON.parse(h.storage.hxz_rpt_history).p[0];
    assert.equal(saved.score, null);
    assert.equal(saved.evidenceStatus, 'unreviewed');
    assert.equal(saved.text, h.body);
    h.c.REPORTSTATE.p = {topic: '另一个方向', score: 90};
    assert.equal(h.c.reportHistoryScoreDisplay(saved, 'p'), '内容待核验');
    // Unrelated older versions retain their own legitimate score.
    assert.equal(h.c.reportHistoryScoreDisplay({topic: h.topic, text: 'older version', ts: 1, score: 81}, 'p'), '81%');
  });
}

test('refresh sanitizer retains unknown and unreviewed scores without manufacturing 60%', () => {
  const c = {PROJECTS: {}, REPORTSTATE: {p: {
    phaseByTopic: {new: 2, unknown: 2, missing: 2, legacy: 2, zero: 2, nativeUnknown: 2},
    scoreByTopic: {new: null, unknown: null, legacy: 81, zero: 0, nativeUnknown: null},
    evidenceStatusByTopic: {new: 'unreviewed'},
  }}};
  vm.createContext(c);
  vm.runInContext(declaration(read('index', '14-part-00.js'), '_sanitizeReportState'), c);
  c._sanitizeReportState();
  const scores = c.REPORTSTATE.p.scoreByTopic;
  assert.equal(scores.new, null);
  assert.equal(scores.unknown, null);
  assert.equal(scores.nativeUnknown, null);
  assert.equal(Object.hasOwn(scores, 'missing'), false);
  assert.equal(scores.legacy, 81);
  assert.equal(scores.zero, 0);
  scores.new = 60;
  c._sanitizeReportState();
  assert.equal(scores.new, null);
});
