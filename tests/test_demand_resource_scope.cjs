'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../frontend/ops/script-03-sections/17.js'), 'utf8');
const renderer = source.slice(source.indexOf('function opsDemandResults(){'), source.indexOf('\nfunction toggleFunnelBlock('));
const statRenderer = source.slice(source.indexOf('function statCell('), source.indexOf('\nfunction statCellClickable('));
const demandSource = fs.readFileSync(path.join(__dirname, '../frontend/ops/script-03-sections/12-tail.js'), 'utf8');
const demandHelpers = ['demandSubmissionState', 'demandEffectiveStage', 'demandDisplayProject'].map(name => {
  const start = demandSource.indexOf('function ' + name + '(');
  const end = demandSource.indexOf('\nfunction ', start + 1);
  return demandSource.slice(start, end < 0 ? demandSource.length : end);
}).join('\n');

function render(enterprises, key = 'proj_mv3i83ap') {
  const projects = {
    proj_mv3i83ap: {city: '闵行区', topic: '新核电配套需求', isDemand: true, stage: 1, clues: []},
    proj_mv3filxi: {city: '闵行区', topic: '原产业链需求', isDemand: true, stage: 1, clues: []},
  };
  const before = JSON.stringify({projects, enterprises});
  const ctx = {
    PROJECTS: projects, OPS_ENT: enterprises, OPS_UI: {demands: {city: '', query: projects[key].topic}},
    REPORTSTATE: {}, UPLOADS: {}, KB_CONFIRMS: {}, DEMANDS: [], PENDING_CONFIRMS: {},
    projStages: () => [['资料准备']], stageNameOf: () => '资料准备',
    stageOptions: () => '', renderStageLog: () => '', opsEmpty: () => 'EMPTY',
    _authEscape: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    __opsProjOpen: {[key]: true},
    fetch: () => {throw new Error('Rendering must not make API calls');},
    runAIFunnel: () => {throw new Error('Rendering must not start AI work');},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(demandHelpers + '\n' + statRenderer + '\n' + renderer, ctx);
  const stats = [];
  const actualStatCell = ctx.statCell;
  ctx.statCell = (label, value, color) => {stats.push({label, value, color}); return actualStatCell(label, value, color);};
  const html = ctx.opsDemandResults();
  assert.equal(JSON.stringify({projects, enterprises}), before, 'display must not rewrite projects or resource matches');
  return {html, stats};
}

const count = (result, label) => result.stats.find(stat => stat.label === label)?.value;

test('same-city resource pushed to a different project does not count for the new demand', () => {
  const result = render([{id: 'ent_e45c3905-a8ee-47e6-b53a-1a9eb8c54456', matches: [
    {city: '闵行区', gap: '闵行区产业链招引', projKey: 'proj_mv3filxi', pushed: true},
  ]}]);
  assert.equal(count(result, '已推送待核资源'), '0条');
  assert.equal(count(result, '候选待核'), '0条');
});

test('exact-project pushed resources remain pending verification even when intent is unknown', () => {
  const result = render([{id: 'pushed', intent: 'unknown', matches: [
    {city: '闵行区', projKey: 'proj_mv3i83ap', pushed: true},
  ]}]);
  assert.equal(count(result, '已推送待核资源'), '1条');
  assert.equal(count(result, '候选待核'), '0条');
  assert.match(result.html, /推送只代表信息送达，业务适配与真实投资意向仍需逐项核实/);
  assert.doesNotMatch(result.html, /可对接企业|确定资源|已确认意向/);
});

test('candidate and pushed counts use exact project matches and count each resource only once', () => {
  const result = render([
    {id: 'pushed', matches: [
      {city: '闵行区', projKey: 'proj_mv3i83ap', pushed: false},
      {city: '闵行区', projKey: 'proj_mv3i83ap', pushed: true},
      {city: '闵行区', projKey: 'proj_mv3i83ap', pushed: true},
    ]},
    {id: 'candidate', matches: [
      {city: '闵行区', projKey: 'proj_mv3i83ap', pushed: false},
      {city: '闵行区', projKey: 'proj_mv3filxi', pushed: true},
    ]},
    {id: 'wrong-city', matches: [{city: '松江区', projKey: 'proj_mv3i83ap', pushed: true}]},
    {id: 'legacy-no-project', matches: [{city: '闵行区', pushed: true}]},
  ]);
  assert.equal(count(result, '已推送待核资源'), '1条');
  assert.equal(count(result, '候选待核'), '1条');
});

test('the original project keeps its exact resource count and a known project ID can stand alone', () => {
  const enterprises = [{id: 'old', matches: [{city: '闵行区', projKey: 'proj_mv3filxi', pushed: true}]},
    {id: 'old-no-city', matches: [{projKey: 'proj_mv3filxi', pushed: false}]}];
  const original = render(enterprises, 'proj_mv3filxi');
  assert.equal(count(original, '已推送待核资源'), '1条');
  assert.equal(count(original, '候选待核'), '1条');
  const newer = render(enterprises);
  assert.equal(count(newer, '已推送待核资源'), '0条');
  assert.equal(count(newer, '候选待核'), '0条');
});
