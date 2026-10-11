'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const response = (status, data) => ({status, ok: status >= 200 && status < 300, json: async () => data});
const decode = value => String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const inviteCodes = html => Array.from(html.matchAll(/<code class="ic-code">([^<]+)<\/code>/g), match => decode(match[1]));
const handlers = html => Array.from(html.matchAll(/\bonclick="([^"]*)"/g), match => decode(match[1]));
const flush = async () => {for (let i = 0; i < 30; i++) await Promise.resolve();};

// Load the same assembled scripts as the browser. The fixture supplies browser
// I/O only; the filters, renderers, auth gate and event handlers stay unmodified.
async function boot() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../frontend/manifest.json'), 'utf8'));
  const html = manifest['ops.html'].parts.map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('');
  const nodes = {}, storage = new Map(), calls = [], intervals = [], timeouts = [], modals = [];
  const root = nodes.root = {innerHTML: '', style: {}};
  const bodyClasses = new Set();
  const append = {appendChild() {}, removeChild() {}};
  const body = {...append, classList: {add: value => bodyClasses.add(value), remove: value => bodyClasses.delete(value), contains: value => bodyClasses.has(value)}};
  const document = {
    activeElement: null,
    getElementById: id => nodes[id] || null,
    querySelector: selector => selector[0] === '#' ? nodes[selector.slice(1)] || null : null,
    querySelectorAll: () => [], addEventListener() {}, documentElement: {style: {}}, head: append, body,
    createElement: () => ({style: {}, classList: {add() {}, remove() {}}, appendChild() {}, setAttribute() {}}),
  };
  const ctx = {
    console: {log() {}, warn() {}}, Date, Math, Promise, JSON, AbortController, TextEncoder, TextDecoder, URL, Uint8Array, Blob,
    location: {origin: 'http://localhost', search: '', href: 'http://localhost/ops'}, navigator: {}, performance: {now: () => Date.now()},
    localStorage: {getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    document, setInterval(fn, ms) {intervals.push({fn, ms}); return intervals.length;},
    setTimeout(fn, ms) {timeouts.push({fn, ms}); return timeouts.length;}, clearTimeout() {}, addEventListener() {},
    fetch: async (url, options = {}) => {calls.push({url, options}); return response(401, {ok: false, error: 'not_authenticated', message: '请登录'});},
  };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc=/.test(match[1])) vm.runInContext(match[2], ctx, {filename: 'ops.html'});
  }
  for (let i = 0; i < 40; i++) await Promise.resolve();
  ctx.openModal = (title, body, footer) => modals.push({title, body, footer});
  function input(id, value = '', options = {}) {
    const node = {id, tagName: 'INPUT', type: 'text', value, checked: false, style: {}, selectionStart: value.length, selectionEnd: value.length,
      focus() {document.activeElement = this;}, setSelectionRange(start, end) {this.selectionStart = start; this.selectionEnd = end;}, ...options};
    nodes[id] = node; return node;
  }
  function admin() {
    ctx.AUTH = {user: 'admin', scope: 'admin', projectKeys: [], projKey: null};
    ctx._authState = 'ready'; ctx._opsDataReady = true;
    ctx.PROJECTS = {}; ctx.USER_PROFILES = {}; ctx.INVITE_CODES = {}; ctx.REPORT_REQUESTS = []; ctx.CITY_WORKSPACES = {};
  }
  return {ctx, nodes, root, document, storage, calls, intervals, timeouts, modals, input, admin};
}


function seedCity(h) {
  const entry = {projectKey: 'main', inviteCode: 'CURRENT', ownerUser: 'owner', province: '上海市', createdAt: 1,
    monthlyEnabled: true, nextReportAt: Date.parse('2026-11-01T01:00:00Z')};
  h.ctx.CITY_WORKSPACES = {'闵行区': entry};
  h.ctx.PROJECTS = {main: {city: '闵行区', workspaceId: 'main', kb: []},
    old: {city: '闵行区', kb: []}, report_legacy: {city: '闵行区', kb: [{known: ['old source']}]}};
  h.ctx.INVITE_CODES = {CURRENT: {city: '闵行区', projKey: 'main', usedBy: ['owner', 'member']},
    OLD: {city: '闵行区', projKey: 'old', usedBy: ['old-person'], revoked: true}};
  h.ctx.USER_PROFILES = {owner: {name: '主负责人', projKey: 'main', projectKeys: ['main']},
    member: {name: '同事', projKey: 'main', projectKeys: ['main']},
    outside: {name: '旧成员', projKey: 'old', projectKeys: ['old']}};
  return entry;
}

test('canonical invitation shows server-designated owner, unique members and next monthly time', async () => {
  const h = await boot(); h.admin(); const entry = seedCity(h);
  const html = h.ctx.opsInvitations();
  assert.match(html, /地区主工作区 · main/);
  assert.match(html, /主负责人 · @owner/); assert.match(html, /2 位成员（含主账号）/);
  assert.match(html, /每月 1 日 09:00/); assert.match(html, /2026.11.01 09:00（北京时间）/);
  assert.match(html, /历史邀请码 · old/); assert.match(html, /不参与月度更新/);
  assert.equal(h.ctx.opsWorkspaceKind('old'), '旧工作区');
  entry.ownerUser = null;
  assert.match(h.ctx.opsInviteResults(), /待首位成员注册/);
  assert.doesNotMatch(h.ctx.opsInviteResults(), /主负责人 · @owner/);
});

test('six readable invitation columns retain timestamps, states and exact code actions', async () => {
  const h = await boot(); h.admin(); seedCity(h);
  h.ctx.INVITE_CODES.CURRENT.createdAt = Date.parse('2026-10-01T01:00:00Z');
  const html = h.ctx.opsInviteResults();
  const header = html.match(/<thead>([\s\S]*?)<\/thead>/)[1];
  assert.equal((header.match(/<th\b/g) || []).length, 6);
  assert.match(header, /邀请码 \/ 状态/); assert.match(header, /主账号 \/ 成员/);
  assert.doesNotMatch(header, /生成时间|<th[^>]*>状态<\/th>/);
  const rows = Array.from(html.matchAll(/<tr>([\s\S]*?)<\/tr>/g), match => match[1]).slice(1);
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal((row.match(/<td\b/g) || []).length, 6);
  const current = rows.find(row => row.includes('data-code="CURRENT"'));
  const identity = current.match(/<td class="ops-ui-invite-identity">([\s\S]*?)<\/td>/)[1];
  assert.match(identity, /生效中/); assert.match(identity, /创建于 2026/);
  assert.match(rows.find(row => row.includes('data-code="OLD"')), /已作废/);
  assert.match(current, /class="ops-ui-invite-members"/);
  assert.match(current, /class="ops-ui-invite-monthly"/);
  const actions = [];
  h.ctx.openMarkDistributedModal = code => actions.push(['distribution', code]);
  h.ctx.revokeInviteCode = code => actions.push(['revoke', code]);
  for (const handler of handlers(current).filter(value => /^(openMarkDistributedModal|revokeInviteCode)\(/.test(value))) vm.runInContext(handler, h.ctx);
  assert.deepEqual(actions, [['distribution', 'CURRENT'], ['revoke', 'CURRENT']]);
  const css = fs.readFileSync(path.join(__dirname, '../frontend/ops/style-01.css'), 'utf8');
  assert.match(css, /\.ops-ui-invite-table\{[^}]*table-layout:auto/);
  assert.doesNotMatch(css, /\.ops-ui-invite-table\s+th(?::nth-child\([^)]*\)|:last-child)\s*\{[^}]*width:\s*\d+%/);
  assert.match(css, /\.ops-ui-invite-members\{[^}]*min-width:/);
  assert.match(css, /\.ops-ui-invite-monthly\{[^}]*min-width:/);
});

test('authoritative active membership arrays override removed legacy default roots, including empty arrays', async () => {
  const h = await boot(); h.admin(); seedCity(h);
  // Shape returned by admin scoped_sync_view -> safe_profile after a joins b
  // and its membership at the original projKey becomes active=false.
  h.ctx.USER_PROFILES = h.ctx._safeProfiles({
    joined: {user: 'joined', name: '已加入', projKey: 'old', projectKeys: ['main'], role: 'member', resident: false,
      memberships: {main: {role: 'member'}}},
    removed: {user: 'removed', name: '已移出', projKey: 'main', projectKeys: [], role: 'member', resident: false,
      memberships: {}},
    legacy: {user: 'legacy', name: '旧账号', projKey: 'main', role: 'member', resident: false},
  });
  assert.deepEqual(Array.from(h.ctx.opsWorkspaceMembers('main')), ['joined', 'legacy']);
  assert.deepEqual(Array.from(h.ctx.opsWorkspaceMembers('old')), []);
  const html = h.ctx.opsInviteResults();
  assert.match(html, /2 位成员（含主账号）/);
});

test('monthly status ignores manual or foreign-root reports and distinguishes generation from publication', async () => {
  const h = await boot(); h.admin(); const entry = seedCity(h);
  h.ctx.REPORT_REQUESTS = [
    {id: 'manual', city: '闵行区', projectKey: 'main', status: 'done', pushed: true, ts: 10000},
    {id: 'wrong-root', city: '闵行区', projectKey: 'old', status: 'done', pushed: true, autoPublish: true, scheduledMonth: '2026-12'},
    {id: 'monthly', city: '闵行区', projectKey: 'main', status: 'running', autoPublish: true, scheduledMonth: '2026-10'},
  ];
  assert.equal(h.ctx.opsMonthlyInfo('闵行区').label, '2026-10 · 生成中');
  const row = h.ctx.REPORT_REQUESTS[2]; row.status = 'done';
  assert.equal(h.ctx.opsMonthlyInfo('闵行区').label, '2026-10 · 待发布');
  row.pushed = true; assert.equal(h.ctx.opsMonthlyInfo('闵行区').label, '2026-10 · 已更新');
  row.publicationSkipped = 'newer-report-already-published'; row.pushed = false;
  assert.equal(h.ctx.opsMonthlyInfo('闵行区').label, '2026-10 · 已有更新版本');
  entry.monthlyEnabled = false; assert.equal(h.ctx.opsMonthlyInfo('闵行区').next, '—');
  assert.match(h.ctx.opsMonthlyInfo('闵行区').label, /^已停用/);
});

test('empty canonical registry produces useful empty states without fabricating city ownership', async () => {
  const h = await boot(); h.admin();
  assert.match(h.ctx.opsInvitations(), /还没有地区工作区/);
  assert.match(h.ctx.opsReports(), /暂无月度更新地区/);
  assert.match(h.ctx.opsRag(), /暂无已初始化的城市智库/);
  assert.deepEqual(Object.keys(h.ctx.PROJECTS), []);
  h.ctx.CITY_WORKSPACES = Object.create({fake: {projectKey: 'fake'}});
  assert.equal(h.ctx.opsCityWorkspace('fake'), null);
  Object.defineProperty(h.ctx.CITY_WORKSPACES, '__proto__', {value: {projectKey: 'main', inviteCode: 'CURRENT'}, enumerable: true});
  assert.equal(h.ctx.opsCityWorkspace('__proto__').projectKey, 'main');
});

test('province is required and successful/reused saves trust the exact server workspace without creating duplicates', async () => {
  const h = await boot(); h.admin(); h.ctx.toast = () => {};
  h.input('invCityInput', '闵行区'); h.input('invProvinceInput', ''); h.input('invEmailInput', '');
  let requests = [];
  h.ctx.fetch = async (url, options) => {
    requests.push({url, body: JSON.parse(options.body)});
    return response(200, {ok: true, reused: requests.length > 1, invite: {code: 'CURRENT', city: '闵行区', projKey: 'main'},
      project: {id: 'main', city: '闵行区', workspaceId: 'main', kb: []},
      cityWorkspace: {projectKey: 'main', inviteCode: 'CURRENT', ownerUser: null, monthlyEnabled: true, nextReportAt: 123}});
  };
  const before = h.calls.length;
  await h.ctx.doGenerateInviteCode(); assert.equal(requests.length, 0); assert.equal(h.calls.length, before);
  h.nodes.invProvinceInput.value = '上海市';
  await h.ctx.doGenerateInviteCode(); await h.ctx.doGenerateInviteCode();
  assert.deepEqual(requests[0].body, {action: 'create', province: '上海市', city: '闵行区', distributedEmail: ''});
  assert.equal(requests[0].url, '/api/admin/invites');
  assert.deepEqual(Object.keys(h.ctx.PROJECTS), ['main']); assert.deepEqual(Object.keys(h.ctx.INVITE_CODES), ['CURRENT']);
  assert.equal(h.ctx.CITY_WORKSPACES['闵行区'].projectKey, 'main');
});

test('RAG create entry uses the invitation service and does not write local synthetic workspaces', async () => {
  const h = await boot(); h.admin(); h.ctx.opsTab = 'rag'; h.ctx.toast = () => {};
  h.ctx.ragAddCityModal();
  const modal = h.modals.at(-1);
  assert.match(modal.body, /invProvinceInput/); assert.match(modal.body, /首位为主账号/);
  h.input('invProvinceInput', '上海市'); h.input('invCityInput', '闵行区'); h.input('invEmailInput', '');
  let requests = 0;
  h.ctx.fetch = async (url) => {
    requests++; assert.equal(url, '/api/admin/invites');
    return response(200, {ok: true, invite: {code: 'MAIN', city: '闵行区', projKey: 'main'}, project: {id: 'main', city: '闵行区', kb: []},
      cityWorkspace: {projectKey: 'main', inviteCode: 'MAIN', ownerUser: null}});
  };
  await h.ctx.ragDoAddCity();
  assert.equal(requests, 1); assert.deepEqual(Object.keys(h.ctx.PROJECTS), ['main']); assert.equal(h.ctx.ragCity, 'main');
});

test('RAG selector keeps historic sources but labels and prioritizes only the registered primary workspace', async () => {
  const h = await boot(); h.admin(); seedCity(h); h.ctx.ragCity = null;
  assert.equal(h.ctx.ragProjKey(), 'main');
  h.ctx.ragCity = 'deleted-old-workspace'; assert.equal(h.ctx.ragProjKey(), 'main');
  const html = h.ctx.ragCityOptions();
  assert.match(html, /地区主工作区 · main/); assert.match(html, /历史报告基础库 · report_legacy/); assert.match(html, /旧工作区 · old/);
  h.ctx.ragOverviewOpen = true;
  const overview = h.ctx.ragWorkspaceOverview('main');
  assert.doesNotMatch(overview, /独立主账号|互不共享数据|邀请码 CURRENT/);
  assert.match(overview, /工作区与报告来源/);
  assert.equal((overview.match(/<strong>地区主工作区<\/strong>/g) || []).length, 1);
});

test('published reports use workspace labels and keep report identifiers out of recipient account labels', async () => {
  const h = await boot(); h.admin(); seedCity(h);
  h.ctx.REPORT_REQUESTS = [{id: 'new', city: '闵行区', projectKey: 'main', account: 'main', status: 'done', pushed: true,
    autoPublish: true, scheduledMonth: '2026-10', ts: 1},
    {id: 'old', city: '闵行区', account: 'report_legacy', status: 'done', pushed: true, ts: 2}];
  const html = h.ctx.rrPanel();
  assert.match(html, /已发布至地区主工作区/); assert.match(html, /已发布 · 历史报告基础库/);
  assert.match(html, /2026-10 月度更新/); assert.doesNotMatch(html, /账号 main|账号 report_legacy/);
  h.ctx.REPORT_REQUESTS = [{id: 'superseded', city: '闵行区', projectKey: 'main', engine: 'full-v1', status: 'done',
    publicationSkipped: 'newer-report-already-published', ts: 3}];
  const superseded = h.ctx.rrPanel();
  assert.match(superseded, /已有更新版本/); assert.doesNotMatch(superseded, /pushReportToRag\(/);
});

test('canonical owner labels are escaped and registry secrets are removed from both cache shapes and logout memory', async () => {
  const h = await boot(); h.admin(); const entry = seedCity(h);
  entry.ownerUser = '<img src=x onerror=alert(1)>'; entry.province = '<script>bad</script>';
  let html = h.ctx.opsInviteResults(); assert.doesNotMatch(html, /<img|<script>/); assert.match(html, /&lt;img/);
  const snapshot = h.ctx._safeSyncSnapshot({CITY_WORKSPACES: h.ctx.CITY_WORKSPACES,
    huixiaozhao_kb_v1: {CITY_WORKSPACES: h.ctx.CITY_WORKSPACES}, PROJECTS: {}});
  assert.equal(snapshot.CITY_WORKSPACES, undefined); assert.equal(snapshot.huixiaozhao_kb_v1.CITY_WORKSPACES, undefined);
  h.ctx._authResetView(); assert.deepEqual(Object.keys(h.ctx.CITY_WORKSPACES), []);
});
