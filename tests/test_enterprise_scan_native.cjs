'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load the complete manifest so tests use the last production definitions,
// including all 17.js and 18.js overrides. Only browser I/O is stubbed.
async function boot() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../frontend/manifest.json'), 'utf8'));
  const html = manifest['ops.html'].parts.map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('');
  const nodes = {}, storage = new Map(), classes = new Set();
  const append = {appendChild() {}, removeChild() {}};
  nodes.root = {innerHTML: '', style: {}};
  const document = {
    activeElement: null, getElementById: id => nodes[id] || null,
    querySelector: selector => selector[0] === '#' ? nodes[selector.slice(1)] || null : null,
    querySelectorAll: () => [], addEventListener() {}, documentElement: {style: {}}, head: append,
    body: {...append, classList: {add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value)}},
    createElement: () => ({style: {}, classList: {add() {}, remove() {}}, appendChild() {}, setAttribute() {}}),
  };
  const ctx = {
    console: {log() {}, warn() {}}, Date, Math, Promise, JSON, AbortController, TextEncoder, TextDecoder, URL, Uint8Array, Blob,
    location: {origin: 'http://localhost', search: '', href: 'http://localhost/ops'}, navigator: {}, performance: {now: () => Date.now()},
    localStorage: {getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    document, setInterval() {}, setTimeout() {}, clearTimeout() {}, addEventListener() {},
    fetch: async () => ({status: 401, ok: false, json: async () => ({ok: false, error: 'not_authenticated'})}),
  };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc=/.test(match[1])) vm.runInContext(match[2], ctx, {filename: 'ops.html'});
  }
  for (let i = 0; i < 40; i++) await Promise.resolve();
  ctx.AUTH = {user: 'admin', scope: 'admin', projectKeys: [], projKey: null};
  ctx._authState = 'ready'; ctx._opsDataReady = true;
  ctx.PROJECTS = {}; ctx.REPORTSTATE = {}; ctx.OPS_ENT = [{id: 'entity-one', name: '电堆企业', gap: '电堆', tags: []}];
  let persists = 0, renders = 0;
  const toasts = [];
  ctx.persist = () => {persists++;}; ctx.renderOpsV2 = () => {renders++;};
  ctx.toast = value => toasts.push(value); ctx.closeModal = () => {};
  return {ctx, nodes, toasts, persists: () => persists, renders: () => renders};
}

function matches(ctx) {return JSON.parse(JSON.stringify(ctx.OPS_ENT[0].matches));}

test('final enterprise scanner accepts native KB text objects and preserves their metadata', async () => {
  const h = await boot();
  const item = {text: '⚠️ 缺失电堆核心配套', src: '本次报告', nature: 'base', annotations: [{text: '人工补充'}]};
  const before = JSON.stringify(item);
  h.ctx.PROJECTS = {native: {city: '闵行区', kb: [{t: '补链方向', known: [item]}], clues: []}};
  assert.doesNotThrow(() => h.ctx.opsEntScanOne(0));
  assert.deepEqual(matches(h.ctx), [{projKey: 'native', city: '闵行区', gap: '缺失电堆核心配套', pushed: false}]);
  assert.equal(h.ctx.OPS_ENT[0].status, 'scanned');
  assert.equal(JSON.stringify(item), before);
  assert.equal(h.persists(), 1); assert.equal(h.renders(), 1);
});

test('legacy KB strings retain the same semantic and literal matching behavior', async () => {
  const {ctx} = await boot();
  ctx.OPS_ENT[0].gap = '定制芯片';
  ctx.PROJECTS = {
    literal: {city: '闵行区', kb: [{known: ['✅ 引进定制芯片设计团队']}]},
    unrelated: {city: '宝山区', kb: [{known: ['引进智能仓储团队']}]},
  };
  ctx.opsEntScanOne(0, true);
  assert.deepEqual(matches(ctx), [{projKey: 'literal', city: '闵行区', gap: '引进定制芯片设计团队', pushed: false}]);
  ctx.OPS_ENT[0].gap = '';
  ctx.OPS_ENT[0].name = '燃料电池企业';
  ctx.PROJECTS = {semantic: {city: '嘉定区', kb: [{known: ['补链氢能产业配套']}]}};
  ctx.opsEntScanOne(0, true);
  assert.equal(matches(ctx)[0].projKey, 'semantic');
});

test('empty, malformed and non-text native entries are skipped without invented matches', async () => {
  const {ctx} = await boot();
  ctx.PROJECTS = {empty: {city: '闵行区', kb: [
    null, {}, {known: null}, {known: '缺失电堆核心配套'}, {known: {text: '缺失电堆核心配套'}},
    {known: [null, undefined, {}, [], 0, false, {text: null}, {text: {nested: '缺失电堆核心配套'}},
      {text: '', annotations: [{text: '缺失电堆核心配套'}]}, {other: '缺失电堆核心配套'}]},
  ]}};
  assert.doesNotThrow(() => ctx.opsEntScanOne(0, true));
  assert.deepEqual(matches(ctx), []);
  assert.equal(ctx.OPS_ENT[0].status, 'manual');
});

test('native text retains existing gap keywords, length guards and six-result cap', async () => {
  const {ctx} = await boot();
  ctx.PROJECTS = {rejected: {city: '闵行区', kb: [{known: [
    {text: '电堆企业经营情况良好'}, {text: '缺电堆'}, {text: '缺失电堆' + '配套'.repeat(40)},
  ]}]}};
  ctx.opsEntScanOne(0, true);
  assert.deepEqual(matches(ctx), []);
  for (let i = 0; i < 8; i++) ctx.PROJECTS['target' + i] = {city: '地区' + i, kb: [{known: [{text: '缺失电堆核心配套'}]}]};
  ctx.opsEntScanOne(0, true);
  assert.equal(matches(ctx).length, 6);
  assert.deepEqual(matches(ctx).map(item => item.projKey), ['target0', 'target1', 'target2', 'target3', 'target4', 'target5']);
});

test('native and legacy duplicates preserve current city-plus-gap deduplication', async () => {
  const {ctx} = await boot();
  ctx.PROJECTS = {
    first: {city: '闵行区', kb: [{known: [{text: '⚠️ 缺失电堆核心配套'}, '缺失电堆核心配套']}]},
    sameCity: {city: '闵行区', kb: [{known: ['缺失电堆核心配套']}]},
    otherCity: {city: '嘉定区', kb: [{known: [{text: '缺失电堆核心配套'}]}]},
    unrelated: {city: '徐汇区', kb: [{known: [{text: '补链医疗器械产业配套'}]}]},
  };
  ctx.REPORTSTATE.first = {text: '⚠️ 缺失电堆核心配套'};
  ctx.opsEntScanOne(0, true);
  assert.deepEqual(matches(ctx).map(item => item.projKey), ['first', 'otherCity']);
  assert.ok(matches(ctx).every(item => item.pushed === false));
});

test('scan results push only to their exact targets and repeated push does not duplicate clues', async () => {
  const h = await boot(), {ctx} = h;
  ctx.PROJECTS = {
    native: {city: '闵行区', kb: [{known: [{text: '缺失电堆核心配套'}]}], clues: []},
    legacy: {city: '嘉定区', kb: [{known: ['补链氢能配套企业']}], clues: []},
    unrelated: {city: '松江区', kb: [{known: [{text: '补链医疗器械产业配套'}]}], clues: []},
  };
  ctx.opsEntScanOne(0, true);
  assert.equal(h.persists(), 0); assert.equal(h.renders(), 0);
  assert.deepEqual(matches(ctx).map(item => item.projKey), ['native', 'legacy']);
  ctx.opsEntDoPush(0, [0]); ctx.opsEntDoPush(0, [0]);
  assert.equal(ctx.PROJECTS.native.clues.length, 1);
  assert.equal(ctx.PROJECTS.legacy.clues.length, 0);
  assert.equal(ctx.PROJECTS.unrelated.clues.length, 0);
  ctx.opsEntDoPush(0, [1]); ctx.opsEntDoPush(0, [0, 1]);
  assert.equal(ctx.PROJECTS.native.clues.length, 1); assert.equal(ctx.PROJECTS.legacy.clues.length, 1);
  assert.equal(ctx.PROJECTS.native.clues[0].id, 'entity-one_to_native');
  assert.equal(ctx.PROJECTS.legacy.clues[0].id, 'entity-one_to_legacy');
});
