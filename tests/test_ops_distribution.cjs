'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Browser I/O fixture only. All search, identity and distribution behavior is
// loaded from the production manifest, including the final 18.js overrides.
async function boot() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../frontend/manifest.json'), 'utf8'));
  const html = manifest['ops.html'].parts.map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('');
  const nodes = {}, storage = new Map(), modals = [];
  const root = nodes.root = {innerHTML: '', style: {}};
  const bodyClasses = new Set();
  const append = {appendChild() {}, removeChild() {}};
  const document = {
    activeElement: null,
    getElementById: id => nodes[id] || null,
    querySelector: selector => selector[0] === '#' ? nodes[selector.slice(1)] || null : null,
    querySelectorAll: () => [], addEventListener() {}, documentElement: {style: {}}, head: append,
    body: {...append, classList: {add: value => bodyClasses.add(value), remove: value => bodyClasses.delete(value), contains: value => bodyClasses.has(value)}},
    createElement: () => ({style: {}, classList: {add() {}, remove() {}}, appendChild() {}, setAttribute() {}}),
  };
  const ctx = {
    console: {log() {}, warn() {}}, Date, Math, Promise, JSON, AbortController, TextEncoder, TextDecoder, URL, Uint8Array, Blob,
    location: {origin: 'http://localhost', search: '', href: 'http://localhost/ops'}, navigator: {}, performance: {now: () => Date.now()},
    localStorage: {getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    document, setInterval() {}, setTimeout() {}, clearTimeout() {}, addEventListener() {},
    fetch: async () => ({status: 401, ok: false, json: async () => ({ok: false, error: 'not_authenticated', message: '请登录'})}),
  };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc=/.test(match[1])) vm.runInContext(match[2], ctx, {filename: 'ops.html'});
  }
  for (let i = 0; i < 40; i++) await Promise.resolve();
  ctx.AUTH = {user: 'admin', scope: 'admin', projectKeys: [], projKey: null};
  ctx._authState = 'ready'; ctx._opsDataReady = true;
  ctx.PROJECTS = {}; ctx.OPS_ENT = [];
  ctx.openModal = (title, body, footer) => modals.push({title, body, footer});
  ctx.closeModal = () => {};
  ctx.renderOpsV2 = () => {};
  let persists = 0;
  ctx.persist = () => {persists++;};
  const toasts = []; ctx.toast = value => toasts.push(value);
  function input(id, value = '') {return nodes[id] = {id, value, style: {}};}
  return {ctx, nodes, root, document, modals, input, toasts, persists: () => persists};
}

test('RAG text extraction accepts primitive text and never stringifies whole objects', async () => {
  const {ctx} = await boot();
  assert.equal(ctx.ragItemText('原文'), '原文');
  assert.equal(ctx.ragItemText(12), '12');
  assert.equal(ctx.ragItemText(false), 'false');
  assert.equal(ctx.ragItemText({text: '材料正文'}), '材料正文');
  assert.equal(ctx.ragItemText({text: 0}), '0');
  assert.equal(ctx.ragItemText({text: {nested: 'not text'}}), '');
  assert.equal(ctx.ragItemText({other: 'not text'}), '');
  assert.equal(ctx.ragItemText(null), '');
  assert.equal(ctx.ragItemText(undefined), '');
  assert.equal(ctx.ragItemText(['not text']), '');
});

test('RAG structured materials and annotation-only queries work in empty-search and error fallbacks', async () => {
  for (const searchThrows of [false, true]) {
    const h = await boot();
    const material = {text: '原始政策正文', annotations: [{text: '新增补链招商线索', by: '人工'}], src: '原始文件', nature: 'base'};
    h.ctx.PROJECTS = {a: {city: '闵行区', kb: [{t: '产业', known: ['其他字符串', material, null, {text: {invalid: true}}]}]}};
    h.ctx.ragProjKey = () => 'a';
    h.input('ragQ', '新增补链');
    h.ctx.ragDoSearch();
    assert.ok(h.ctx.ragHits.some(hit => hit.item === material), 'the real shared search retains the original structured item');
    let corpus;
    h.ctx.kbSearch = (_query, values) => {corpus = values; if (searchThrows) throw new Error('offline fallback'); return [];};
    assert.doesNotThrow(() => h.ctx.ragDoSearch());
    assert.ok(corpus.every(item => typeof item.text === 'string'));
    assert.ok(corpus.some(item => item.text.includes('原始政策正文') && item.text.includes('新增补链招商线索')));
    assert.ok(h.ctx.ragHits.some(hit => hit.item === material));
    assert.equal(h.ctx.ragQuery, '新增补链');
    h.input('ragQ', '原始政策正文'); h.ctx.ragDoSearch();
    assert.ok(h.ctx.ragHits.some(hit => hit.item === material));
  }
});

test('RAG hit display receives original material metadata and legacy plain-string fallback', async () => {
  const {ctx} = await boot();
  const material = {text: '正文', annotations: [{text: '补充'}], account: '来源账号', src: '材料名', nature: 'base'};
  ctx.ragQuery = '正文';
  ctx.ragHits = [{text: '正文\n补充', item: material, topic: '产业'}, {text: '旧字符串', topic: '政策'}];
  const rendered = []; ctx.ragRenderChunk = value => {rendered.push(value); return '<div>rendered</div>';};
  const html = ctx.ragHitsView();
  assert.equal(rendered[0], material);
  assert.equal(rendered[1], '旧字符串');
  assert.match(html, /召回 <b[^>]*>2<\/b> 条材料/);
});

test('enterprise identity is stable and generated IDs remain unique across same-tick saves', async () => {
  const h = await boot();
  class FixedDate extends Date {static now() {return 1234567890000;}}
  h.ctx.Date = FixedDate;
  let sequence = 0; h.ctx.Math = Object.create(Math);
  h.ctx.Math.random = () => (++sequence < 3 ? 0.25 : sequence / 1000);
  const existing = {id: 'kept-enterprise', name: '已录入企业'};
  h.ctx.OPS_ENT = [existing];
  assert.equal(h.ctx.opsEntEnsureId(existing), 'kept-enterprise');
  h.input('oe-name', '企业甲'); h.ctx.opsEntSaveV2();
  h.input('oe-name', '企业乙'); h.ctx.opsEntSaveV2();
  const ids = h.ctx.OPS_ENT.map(item => item.id);
  assert.ok(ids.every(id => typeof id === 'string' && id.length));
  assert.equal(new Set(ids).size, 3);
  assert.equal(h.ctx.opsEntEnsureId(h.ctx.OPS_ENT[1]), ids[1]);
  assert.equal(h.persists(), 2);
});

test('legacy empty and stringified missing IDs are repaired only for the selected enterprise', async () => {
  const {ctx} = await boot();
  ctx.OPS_ENT = [{name: 'untouched'}, {id: 'undefined', name: 'selected'}, {id: 'null', name: 'next'}, {id: '', name: 'empty'}];
  const originalUntouched = JSON.stringify(ctx.OPS_ENT[0]);
  for (const index of [1, 2, 3]) {
    const id = ctx.opsEntEnsureId(ctx.OPS_ENT[index]);
    assert.ok(id && id !== 'undefined' && id !== 'null');
    assert.equal(ctx.opsEntEnsureId(ctx.OPS_ENT[index]), id);
  }
  assert.equal(new Set(ctx.OPS_ENT.slice(1).map(item => item.id)).size, 3);
  assert.equal(JSON.stringify(ctx.OPS_ENT[0]), originalUntouched);
});

test('editing a legacy enterprise repairs its ID without rewriting other enterprise records', async () => {
  const h = await boot();
  h.ctx.OPS_ENT = [{name: 'selected', kind: 'old'}, {name: 'untouched'}];
  h.ctx._manualEditIdx = 0; h.input('me-kind', '新行业');
  h.ctx.applyManualEdit();
  assert.ok(h.ctx.OPS_ENT[0].id); assert.equal(h.ctx.OPS_ENT[0].kind, '新行业');
  assert.equal(h.ctx.OPS_ENT[1].id, undefined); assert.equal(h.persists(), 1);
});

test('manual distribution repairs legacy ID after target validation and writes the exact same-city workspace', async () => {
  const h = await boot();
  h.ctx.OPS_ENT = [{name: '旧企业甲', kind: '半导体', signal: '扩产'}, {name: '旧企业乙'}];
  h.ctx.PROJECTS = {a: {city: '闵行区', topic: '方向甲', clues: []}, b: {city: '闵行区', topic: '方向乙', clues: []}};
  h.ctx.opsEntManualPushModal(0);
  assert.equal(h.ctx.OPS_ENT[0].id, undefined, 'opening modal does not migrate the record');
  h.input('mpTopic', 'missing'); h.ctx.opsEntDoManualPush();
  assert.equal(h.ctx.OPS_ENT[0].id, undefined, 'invalid target does not migrate the record');
  h.input('mpTopic', 'b'); h.ctx.opsEntDoManualPush();
  const selected = h.ctx.OPS_ENT[0], clue = h.ctx.PROJECTS.b.clues[0];
  assert.ok(selected.id); assert.ok(clue.id.includes(selected.id));
  assert.ok(!clue.id.includes('undefined')); assert.equal(h.ctx.OPS_ENT[1].id, undefined);
  assert.equal(h.ctx.PROJECTS.a.clues.length, 0); assert.equal(h.ctx.PROJECTS.b.clues.length, 1);
  assert.equal(selected.matches[0].projKey, 'b'); assert.equal(selected.matches[0].pushed, true);
  const before = h.persists(); h.ctx.opsEntDoManualPush();
  assert.equal(h.ctx.PROJECTS.b.clues.length, 1); assert.equal(h.persists(), before);
});

test('two previously ID-less enterprises create distinct clues and each deduplicates independently', async () => {
  const h = await boot();
  h.ctx.PROJECTS = {target: {city: '闵行区', topic: '半导体', clues: []}};
  h.ctx.OPS_ENT = [{name: '企业甲'}, {name: '企业乙'}]; h.input('mpTopic', 'target');
  for (const index of [0, 1, 0, 1]) {h.ctx.__manualPushEnt = index; h.ctx.opsEntDoManualPush();}
  assert.equal(h.ctx.PROJECTS.target.clues.length, 2);
  assert.equal(new Set(h.ctx.PROJECTS.target.clues.map(item => item.id)).size, 2);
  assert.deepEqual(Array.from(h.ctx.PROJECTS.target.clues, item => item.name), ['企业甲（脱敏）', '企业乙（脱敏）']);
  assert.ok(h.ctx.PROJECTS.target.clues.every(item => !item.id.includes('undefined')));
  assert.equal(h.persists(), 2);
});
