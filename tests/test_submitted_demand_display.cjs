'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

function source(side, file) {
  return fs.readFileSync(path.join(root, 'frontend', side,
    side === 'index' ? 'script-02-sections' : 'script-03-sections', file), 'utf8');
}
function declaration(side, file, name) {
  const text = source(side, file), start = text.indexOf('function ' + name + '(');
  assert.ok(start >= 0, side + ':' + name);
  const end = text.indexOf('\nfunction ', start + 1);
  return text.slice(start, end < 0 ? text.length : end);
}
function boot(side) {
  const topic = 'QA-POST-REPORT-20261011核电换热配套';
  const parent = {id: 'parent', city: '闵行区', topic, stage: 2, workspaceId: 'workspace'};
  const demand = {id: 'demand', city: '闵行区', topic, stage: 3, isDemand: true,
    submissionState: 'submitted', workspaceId: 'workspace', stageByTopic: {[topic]: 3},
    clues: [{name: '来源支持企业', tone: 'amber'}]};
  const report = {topic, text: '一、产业基础判断\n现有材料待核验。', phase: 2, ts: 1,
    aiReportByTopic: {[topic]: '一、产业基础判断\n现有材料待核验。'}, phaseByTopic: {[topic]: 2}};
  const elements = {reportArea: {innerHTML: ''}, chainMapBlock: {}, bottom: {innerHTML: ''}};
  const calls = {render: 0, submit: 0, writes: 0, fetch: 0};
  const c = {PROJECTS: {parent, demand}, REPORTSTATE: {parent: structuredClone(report), demand: structuredClone(report)},
    DEMANDS: [{id: 'receipt', projKey: 'demand'}], cur: 'demand', UPLOADS: {}, window: {},
    STAGES: [['资料准备', '上传材料'], ['AI 研判', '生成方向'], ['确认需求', '双确认'], ['资源匹配', '资源端核验匹配'], ['招商对接', '正式沟通']],
    Date, console, view: 'report', setTimeout() {}, nativeReportState() {return null;},
    _projectWorkspaceId: key => c.PROJECTS[key]?.workspaceId,
    _authWorkspaceOf: key => c.PROJECTS[key]?.workspaceId,
    topicHasFullReport: () => true, reportTextForTopic: () => report.text,
    topicScoreDisplay: () => '内容待核验', origReportFiles: () => null,
    P: () => c.PROJECTS[c.cur], render() {calls.render++;}, submitDemand() {calls.submit++;},
    persist() {calls.writes++;}, fetch() {calls.fetch++; throw new Error('No network in display tests');},
    _authEscape: String, cityKeys: () => Object.keys(c.PROJECTS),
    escapeChainText: String, setReportAreaHtml: (el, html) => {el.innerHTML = html;},
    document: {getElementById: key => elements[key] || null, querySelector: () => elements.bottom},
  };
  vm.createContext(c);
  const stageFile = side === 'index' ? '02.js' : '01.js';
  const functions = ['projStages', 'stageNameOf', 'stageDescOf'].map(n => declaration(side, stageFile, n));
  functions.push(...['demandSubmissionState', 'demandEffectiveStage', 'demandDisplayProject',
    'reportDemandActionButton', '_normalizeTopic', '_findExistingDemand', 'demandReportSnapshot',
    'restoreActionItems'].map(n => declaration(side, '12-tail.js', n)));
  functions.push(...['detailNeeds', 'detailReport', 'detailDocking'].map(n => declaration(side, '13.js', n)));
  functions.push(declaration(side, '00.js', 'viewCurrentReport'));
  if (side === 'index') functions.push(declaration(side, '12-tail.js', 'reportBottomBarInner'));
  vm.runInContext(functions.join('\n'), c);
  return {c, parent, demand, report, elements, calls};
}

for (const side of ['index', 'ops']) {
  test(side + ': submitted raw stage 3 displays stage 4 without mutating stored stages', () => {
    const {c, demand, calls} = boot(side), before = JSON.stringify(c.PROJECTS);
    const displayed = c.demandDisplayProject('demand', demand);
    assert.equal(displayed.stage, 4);
    assert.notEqual(displayed, demand);
    assert.match(c.detailReport(demand), /资源匹配 · 资源端核验匹配/);
    assert.match(c.detailDocking(demand), /资源匹配中：1 个/);
    if (side === 'index') {
      c.window.__projOpen = 'demand';
      assert.match(c.detailNeeds(demand), /第 4\/5 步/);
      assert.doesNotMatch(c.detailNeeds(demand), /第 3\/5 步/);
    }
    assert.equal(JSON.stringify(c.PROJECTS), before);
    assert.equal(calls.writes + calls.fetch, 0);
  });

  test(side + ': parent report resolves the exact workspace demand without changing research stage', () => {
    const {c, parent} = boot(side); c.cur = 'parent';
    const before = JSON.stringify(c.PROJECTS);
    assert.match(c.detailReport(parent), /资源匹配 · 资源端核验匹配/);
    assert.match(c.reportDemandActionButton(parent), /查看已递交需求/);
    assert.equal(JSON.stringify(c.PROJECTS), before);
    c.PROJECTS.demand.workspaceId = 'different-workspace';
    assert.equal(c.demandDisplayProject('parent', parent).stage, 2);
    assert.doesNotMatch(c.reportDemandActionButton(parent), /查看已递交需求/);
    c.PROJECTS.demand.workspaceId = 'workspace'; c.PROJECTS.demand.topic = '另一个方向';
    assert.equal(c.demandDisplayProject('parent', parent).stage, 2);
  });

  test(side + ': pending and failed receipts do not advance stage and keep distinct actions', () => {
    const {c, demand} = boot(side);
    for (const [state, label] of [['pending', '需求正在保存'], ['failed', '重试提交当前方向需求']]) {
      demand.submissionState = state;
      assert.equal(c.demandDisplayProject('demand', demand).stage, 3);
      const html = c.reportDemandActionButton(demand);
      assert.match(html, new RegExp(label));
      assert.equal(html.includes(' disabled'), state === 'pending');
      assert.doesNotMatch(html, /查看已递交需求/);
    }
    demand.submissionState = 'submitted'; c.DEMANDS = [];
    assert.equal(c.demandDisplayProject('demand', demand).stage, 3);
  });

  test(side + ': viewing a submitted report retains exports and never offers resubmission', () => {
    const {c, demand, elements, calls} = boot(side), before = JSON.stringify(c.PROJECTS);
    c.viewCurrentReport();
    assert.match(elements.bottom.innerHTML, /查看已递交需求/);
    assert.doesNotMatch(elements.bottom.innerHTML, /submitDemand\(\)/);
    assert.match(elements.bottom.innerHTML, /downloadReport/);
    if (side === 'index') assert.match(elements.bottom.innerHTML, /快速简报/);
    const action = elements.bottom.innerHTML.match(/onclick="([^"]+)"[^>]*>查看已递交需求/)[1];
    vm.runInContext(action, c);
    assert.equal(c.view, 'home'); assert.equal(calls.render, 1);
    assert.equal(calls.submit + calls.writes + calls.fetch, 0);
    assert.equal(JSON.stringify(c.PROJECTS), before);
    assert.equal(demand.stage, 3);
  });

  test(side + ': existing custom later stages are preserved and render with their own labels', () => {
    const {c, parent, demand} = boot(side); demand.stage = 6; demand.customStages = ['第一次会议'];
    c.cur = 'parent';
    assert.equal(c.demandDisplayProject('parent', parent).stage, 6);
    assert.match(c.detailReport(parent), /第一次会议 · 自定义阶段/);
    assert.equal(parent.stage, 2); assert.equal(demand.stage, 6);
  });

  test(side + ': incomplete or different-topic report cannot render a submit action', () => {
    const {c, demand} = boot(side);
    c.REPORTSTATE.demand.phaseByTopic[demand.topic] = 1;
    assert.equal(c.reportDemandActionButton(demand), '');
    c.REPORTSTATE.demand.phaseByTopic = {}; c.REPORTSTATE.demand.topic = '旧方向';
    assert.equal(c.reportDemandActionButton(demand), '');
  });

  test(side + ': action cards and report footer share pending/submitted behavior', () => {
    const {c, demand} = boot(side);
    for (const state of ['pending', 'failed', 'submitted']) {
      demand.submissionState = state;
      const button = c.reportDemandActionButton(demand);
      assert.ok(c.restoreActionItems().includes(button));
      if (side === 'index') assert.ok(c.reportBottomBarInner(demand).includes(button));
    }
  });
}
