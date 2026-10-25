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
  for(const file of ['frontend/shared/kb-materials.js','frontend/shared/sync-feedback.js'])if(!manifest['ops.html'].parts.includes(file))vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
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
    ctx.PROJECTS = {}; ctx.USER_PROFILES = {}; ctx.INVITE_CODES = {}; ctx.REPORT_REQUESTS = [];
  }
  return {ctx, nodes, root, document, storage, calls, intervals, timeouts, modals, input, admin};
}

function seedInvites(h) {
  h.ctx.INVITE_CODES = {
    ALPHA: {city: '同城', projKey: 'workspace-a', createdAt: 100, usedBy: ['member-a'], distributed: false},
    BETA: {city: '同城', projKey: 'workspace-b', createdAt: 200, usedBy: ['member-b', 'member-c'], distributed: true, distributedEmail: 'beta@example.invalid'},
    GAMMA: {city: '另一城', projKey: 'workspace-c', createdAt: 300, usedBy: [], distributed: true, distributedEmail: 'gamma@example.invalid', revoked: true},
  };
}

test('admin navigation groups eight destinations and separates invitations from contacts', async () => {
  const h = await boot(); h.admin();
  assert.deepEqual(Array.from(h.ctx.OPS_NAV, group => group.label), ['工作台', '业务管理', '客户管理', '资源管理']);
  assert.deepEqual(Array.from(h.ctx.OPS_NAV.flatMap(group => group.items), item => item.id),
    ['overview', 'reports', 'demands', 'profile', 'rag', 'invitations', 'users', 'enterprises']);
  const nav = h.ctx.opsTabBar();
  assert.equal((nav.match(/aria-current="page"/g) || []).length, 1);
  assert.match(h.ctx.opsInvitations(), /id="opsInviteResults"/);
  assert.match(h.ctx.opsUsers(), /id="opsUserResults"/);
  assert.doesNotMatch(h.ctx.opsUsers(), /opsInviteResults|生成邀请码|分发状态/);
  let renders = 0; h.ctx.renderOpsV2 = () => {renders++;};
  h.ctx.opsGo('invitations'); assert.equal(h.ctx.opsTab, 'invitations'); assert.equal(renders, 1);
  h.ctx.opsGo('unknown'); assert.equal(h.ctx.opsTab, 'invitations'); assert.equal(renders, 1);
});

test('invitation text/status/distribution filters intersect without collapsing same-city workspaces', async () => {
  const h = await boot(); h.admin(); seedInvites(h);
  assert.deepEqual(inviteCodes(h.ctx.opsInviteResults()), ['GAMMA', 'BETA', 'ALPHA']);
  h.ctx.OPS_UI.invitations.query = '同城';
  let html = h.ctx.opsInviteResults();
  assert.deepEqual(inviteCodes(html), ['BETA', 'ALPHA']);
  assert.match(html, /workspace-a/); assert.match(html, /workspace-b/);
  assert.equal((html.match(/历史邀请码/g) || []).length, 2);
  assert.doesNotMatch(html, /地区主工作区 · workspace-[ab]/);
  h.ctx.OPS_UI.invitations.status = 'active';
  h.ctx.OPS_UI.invitations.distribution = 'pending';
  assert.deepEqual(inviteCodes(h.ctx.opsInviteResults()), ['ALPHA']);
  h.ctx.OPS_UI.invitations.distribution = 'distributed';
  assert.deepEqual(inviteCodes(h.ctx.opsInviteResults()), ['BETA']);
  h.ctx.OPS_UI.invitations.query = 'BETA@EXAMPLE.INVALID';
  assert.deepEqual(inviteCodes(h.ctx.opsInviteResults()), ['BETA']);
  h.ctx.OPS_UI.invitations.query = '';
  h.ctx.OPS_UI.invitations.status = 'revoked';
  assert.deepEqual(inviteCodes(h.ctx.opsInviteResults()), ['GAMMA']);
  h.ctx.OPS_UI.invitations.query = 'no-match';
  assert.match(h.ctx.opsInviteResults(), /显示 0 \/ 3 个邀请码/);
  assert.match(h.ctx.opsInviteResults(), /未找到匹配的邀请码/);
});

test('invitation registry labels escape HTML and invalid code keys never become handlers', async () => {
  const h = await boot(); h.admin();
  h.ctx.INVITE_CODES = {
    SAFE_CODE: {city: '<img src=x onerror=alert(1)>', projKey: 'team-"bad', distributed: true, distributedEmail: '<script>alert(1)</script>', usedBy: []},
    "bad');alert(1);//": {city: 'bad', projKey: 'bad', usedBy: []},
  };
  const html = h.ctx.opsInvitations();
  assert.deepEqual(inviteCodes(html), ['SAFE_CODE']);
  assert.doesNotMatch(html, /<img|<script|bad'\);alert/);
  assert.match(html, /&lt;img/); assert.match(html, /&lt;script/); assert.match(html, /team-&quot;bad/);
  const allowed = ['openInviteCodeModal', 'copyInviteCode', 'openMarkDistributedModal', 'revokeInviteCode'];
  for (const handler of handlers(html)) assert.ok(allowed.some(name => handler.startsWith(name + '(')), handler);
});

test('city labels that match object prototype keys remain ordinary independent groups', async () => {
  const h = await boot(); h.admin();
  h.ctx.INVITE_CODES = {ONE: {city: '__proto__', projKey: 'a', usedBy: []}, TWO: {city: '__proto__', projKey: 'b', usedBy: []},
    THREE: {city: 'constructor', projKey: 'c', usedBy: []}};
  const html = h.ctx.opsInviteResults();
  assert.equal(inviteCodes(html).length, 3);
  assert.equal((html.match(/历史邀请码/g) || []).length, 3);
  h.ctx.USER_PROFILES = {one: {city: '__proto__'}, two: {city: 'constructor'}};
  assert.match(h.ctx.opsUsers(), /value="__proto__"/); assert.match(h.ctx.opsUsers(), /value="constructor"/);
});

test('user search includes contact fields, intersects city and opens escaped membership details', async () => {
  const h = await boot(); h.admin();
  const hostileUser = "a');globalThis.injected=true;//\"";
  h.ctx.USER_PROFILES = {
    [hostileUser]: {name: '<张三>', city: '同城', org: '<单位>', phone: '13800138000', wechat: 'WECHAT-A', dept: '招商一部', title: '主任', ts: 20, projKey: 'workspace-a', projectKeys: ['workspace-a', 'workspace-b']},
    other: {name: '李四', city: '另一城', org: '测试公司', phone: '13900139000', wechat: 'wechat-b', ts: 10, projKey: 'workspace-c'},
  };
  h.ctx.PROJECTS = {'workspace-a': {city: '同城'}, 'workspace-b': {city: '同城'}};
  for (const query of ['招商一部', '1380013', 'wechat-a', '<单位>', hostileUser]) {
    h.ctx.OPS_UI.users.query = query;
    const html = h.ctx.opsUserResults();
    assert.match(html, /显示 1 \/ 2 位注册用户/); assert.match(html, /&lt;张三&gt;/); assert.doesNotMatch(html, /李四|<单位>/);
  }
  h.ctx.OPS_UI.users.city = '另一城'; assert.match(h.ctx.opsUserResults(), /显示 0 \/ 2/);
  h.ctx.OPS_UI.users.query = ''; assert.match(h.ctx.opsUserResults(), /李四/);
  h.ctx.opsViewUser(hostileUser);
  const modal = h.modals.at(-1);
  assert.doesNotMatch(modal.title + modal.body, /<张三>|<单位>/);
  assert.match(modal.body, /workspace-a/); assert.match(modal.body, /workspace-b/);
  h.ctx.OPS_UI.users.city = ''; h.ctx.OPS_UI.users.query = hostileUser;
  const handler = handlers(h.ctx.opsUserResults()).find(value => value.startsWith('opsViewUser('));
  let opened; h.ctx.opsViewUser = value => {opened = value;};
  vm.runInContext(handler, h.ctx);
  assert.equal(opened, hostileUser); assert.equal(h.ctx.injected, undefined);
});

test('report filters preserve matching task actions and account for blocked outbox entries', async () => {
  const h = await boot(); h.admin();
  h.ctx.REPORT_REQUESTS = [
    {id: 'report-running', city: '测试城', province: '湖北', by: 'operator', status: 'running', ts: 100},
    {id: 'report-done', city: '另一城', province: '浙江', by: 'operator', status: 'done', ts: 200, engine: 'full-v1', files: [{name: 'report.docx'}]},
    {id: 'report-failed', city: '测试城', province: '湖北', status: 'failed', ts: 300, failReason: '上游失败'},
  ];
  h.ctx._rrOutbox = {'report-blocked': {blocked: true, request: {id: 'report-blocked', city: '待确认城', status: 'pending', ts: 400}}};
  let html = h.ctx.rrPanel({status: 'done'});
  assert.match(html, /另一城/); assert.doesNotMatch(html, /测试城|待确认城/);
  assert.match(html, /downloadReqFile/); assert.match(html, /pushReportToRag/);
  html = h.ctx.rrPanel({query: 'report-running', status: 'active'});
  assert.match(html, /测试城/); assert.match(html, /cancelReportRequest/); assert.doesNotMatch(html, /另一城|待确认城/);
  assert.doesNotMatch(h.ctx.rrPanel({status: 'active'}), /待确认城/, 'blocked outbox belongs to attention, not active work');
  html = h.ctx.rrPanel({status: 'attention'});
  assert.match(html, /测试城/); assert.match(html, /待确认城/); assert.match(html, /_rrDiscardBlocked/);
  assert.match(h.ctx.rrPanel({query: '不存在'}), /没有符合筛选条件的报告/);
});

test('report values and request identifiers cannot inject markup or inline JavaScript', async () => {
  const h = await boot(); h.admin();
  const hostileId = "request');globalThis.injected=true;//\"";
  h.ctx.REPORT_REQUESTS = [{id: hostileId, city: '<img src=x onerror=alert(1)>', province: '<省>', by: '<operator>', status: 'done', ts: 100, engine: 'full-v1', files: [{}]}];
  const html = h.ctx.rrPanel({});
  assert.doesNotMatch(html, /<img|<operator>|<省>/);
  const values = [];
  h.ctx.downloadReqFile = (...args) => values.push(args);
  h.ctx.pushReportToRag = (...args) => values.push(args);
  for (const handler of handlers(html).filter(value => /^(downloadReqFile|pushReportToRag)\(/.test(value))) vm.runInContext(handler, h.ctx);
  assert.equal(values.length, 4);
  assert.deepEqual(values.filter(args=>typeof args[1]==='string').map(args=>args[1]).sort(), ['full','research','short']);
  assert.ok(values.every(args => args[0] === hostileId)); assert.equal(h.ctx.injected, undefined);
});

test('report progress, specialist sources and expanded waves escape provider-supplied text', async () => {
  const h = await boot(); h.admin();
  const hostileId = "wave');globalThis.injected=true;//\"\nnext";
  const payload = '<img src=x onerror=alert(1)>';
  h.ctx.__rrWaveOpen = {[hostileId]: true};
  const report = {id: hostileId, status: 'running', ts: Date.now(), step: payload, stageName: payload, issues: [payload + '：' + payload],
    waves: [{state: 'running', label: payload, done: 0, total: 1, files: [{n: payload, detail: payload}]}]};
  const html = h.ctx.rrProgress(report);
  assert.doesNotMatch(html, /<img|<script/); assert.match(html, /&lt;img/);
  h.ctx.render = () => {};
  vm.runInContext(handlers(html).find(value => value.includes('__rrWaveOpen')), h.ctx);
  assert.equal(h.ctx.__rrWaveOpen[hostileId], false); assert.equal(h.ctx.injected, undefined);
  const unsafe = h.ctx.rrSrcRow({url: 'javascript:alert(1)', name: payload, type: payload});
  assert.doesNotMatch(unsafe, /href=|<img/);
  const safe = h.ctx.rrSrcRow({url: 'https://example.invalid/?q=" onmouseover="alert(1)', name: payload, type: payload});
  assert.match(safe, /rel="noopener noreferrer"/); assert.doesNotMatch(safe, /<img/);
  assert.match(safe, /href="https:\/\/example.invalid\/\?q=&quot; onmouseover=&quot;alert\(1\)"/);
  h.ctx['__rrSrc_' + hostileId] = true;
  const card = h.ctx.rrSpecialistCard({id: hostileId, state: 'working', name: payload, avatar: payload, action: payload,
    sources: [{url: 'javascript:alert(1)', name: payload, type: payload}]});
  assert.doesNotMatch(card, /<img|href="javascript:/);
  let selected; h.ctx.rrToggleSrc = id => {selected = id;}; h.ctx.event = {stopPropagation() {}};
  vm.runInContext(handlers(card)[0], h.ctx);
  assert.equal(selected, hostileId); assert.equal(h.ctx.injected, undefined);
});

test('RAG workspace selector keeps all same-city roots, material counts and exact identity', async () => {
  const h = await boot(); h.admin();
  const oddKey = 'team-"<B>';
  h.ctx.PROJECTS = {alpha: {city: '同城', kb: [{known: ['one']}]}, [oddKey]: {city: '同城', kb: []}, noKb: {city: '同城'}};
  h.ctx.ragCity = oddKey;
  const html = h.ctx.ragCityOptions();
  assert.equal((html.match(/<option /g) || []).length, 2);
  assert.match(html, /value="alpha"/); assert.match(html, /1 条材料/);
  assert.match(html, /value="team-&quot;&lt;B&gt;" selected/); assert.match(html, /0 条材料/);
  assert.doesNotMatch(html, /noKb|<B>/); assert.equal(h.ctx.ragProjKey(), oddKey);
});

test('overview uses submitted work and current report states without embedding a generation form', async () => {
  const h = await boot(); h.admin(); seedInvites(h);
  h.ctx.USER_PROFILES = {one: {}, two: {}};
  const verification = status => ({verificationRequest: {contract: 'docking-action-v1', id: 'check-' + status, status}});
  h.ctx.PROJECTS = {
    base: {city: '城市'},
    one: {city: '城市', isDemand: true, submissionState: 'submitted', demandTitle: '设备 <核验>', clues: [verification('requested')]},
    two: {city: '城市', isDemand: true, submissionState: 'submitted', intake: {contract: 'docking-action-v1', status: 'processing'}, clues: [verification('needs_info'), verification('completed')]},
    draft: {city: '城市', isDemand: true, submissionState: 'pending', clues: [verification('requested')]},
    failed: {city: '城市', isDemand: true, submissionState: 'failed', clues: [verification('requested')]},
    archived: {city: '城市', isDemand: true, submissionState: 'submitted', archived: true, clues: [verification('requested')]},
  };
  h.ctx.OPS_ENT = [{id: 'enterprise-one'}, {id: 'enterprise-two'}];
  h.ctx.REPORT_REQUESTS = [
    {id: 'one', city: '城市', status: 'running'},
    {id: 'two', city: '城市', status: 'done'},
    {id: 'three', city: '城市', status: 'failed'},
    {id: 'four', city: '城市', status: 'paused'},
    {id: 'five', city: '城市', status: 'pause_requested'},
  ];
  h.ctx.rrPanel = () => {throw new Error('overview must not render full report panel');};
  const before = JSON.stringify(h.ctx.PROJECTS);
  const html = h.ctx.opsOverview();
  assert.deepEqual(Array.from(html.matchAll(/class="ops-ui-stat-value">(\d+)</g), match => Number(match[1])), [1, 2, 2, 2]);
  assert.match(html, /2 项报告需处理/); assert.match(html, /近期报告任务/);
  assert.match(html, /设备 &lt;核验&gt;/); assert.doesNotMatch(html, /设备 <核验>/);
  assert.equal(JSON.stringify(h.ctx.PROJECTS), before, 'rendering must not update submission or verification state');
  assert.doesNotMatch(html, /id="rrProv"|id="rrCity"/);
});

test('overview empty state and all operational destinations remain available in the new shell', async () => {
  const h = await boot(); h.admin();
  h.ctx.OPS_ENT = [];
  const html = h.ctx.opsOverview();
  assert.deepEqual(Array.from(html.matchAll(/class="ops-ui-stat-value">(\d+)</g), match => Number(match[1])), [0, 0, 0, 0]);
  assert.match(html, /当前没有待处理事项/); assert.match(html, /暂无报告任务/);
  assert.doesNotMatch(html, /界面演示|虚构数据|本地预览/);
  const nav = h.ctx.opsTabBar();
  for (const id of ['overview', 'demands', 'enterprises', 'reports', 'profile', 'rag', 'invitations', 'users']) {
    assert.ok(handlers(nav).includes('opsGo(' + JSON.stringify(id) + ')'), id + ' must remain reachable');
  }
});

test('search updates only results and retains the focused input object and caret', async () => {
  const h = await boot(); h.admin(); seedInvites(h);
  h.root.innerHTML = 'stable shell';
  const input = h.input('opsInviteSearch', 'beta'); input.selectionStart = 2; input.selectionEnd = 2; input.focus();
  h.nodes.opsInviteResults = {innerHTML: 'old results'};
  h.ctx.opsFilterChange('invitations', 'query', 'beta');
  assert.equal(h.root.innerHTML, 'stable shell'); assert.equal(h.document.activeElement, input);
  assert.equal(h.nodes.opsInviteSearch, input); assert.equal(input.selectionStart, 2);
  assert.deepEqual(inviteCodes(h.nodes.opsInviteResults.innerHTML), ['BETA']);
});

test('report search refresh restores the unfinished creation fields', async () => {
  const h = await boot(); h.admin();
  const fields = [h.input('rrProv', '未提交省份'), h.input('rrCity', '未提交城市')];
  h.nodes.opsContent = {querySelectorAll: () => fields};
  const search = h.input('opsReportSearch', '查询'); search.selectionStart = 1; search.selectionEnd = 1; search.focus();
  let replaced = false;
  Object.defineProperty(h.nodes, 'opsReportResults', {value: {set innerHTML(html) {
    assert.match(html, /id="rrProv"/); replaced = true;
    h.input('rrProv'); h.input('rrCity');
  }}});
  h.ctx.opsFilterChange('reports', 'query', '查询');
  assert.ok(replaced); assert.equal(h.nodes.rrProv.value, '未提交省份'); assert.equal(h.nodes.rrCity.value, '未提交城市');
  assert.equal(h.document.activeElement, search); assert.equal(search.selectionStart, 1);
});

test('poll rerender preserves text/select/checkbox drafts, focus, caret and current-page scroll', async () => {
  const h = await boot(); h.admin(); h.ctx.opsTab = 'reports'; h.ctx.bind = () => {}; h.ctx.renderOpsV2();
  let fields = [h.input('rrProv', '湖北'), h.input('rrCity', '随州'), h.input('draftChoice', 'standard', {tagName: 'SELECT'}),
    h.input('draftCheck', '', {type: 'checkbox', checked: true}), h.input('secret', 'do not restore', {type: 'password'}), h.input('upload', 'do not restore', {type: 'file'})];
  h.nodes.opsContent = {scrollTop: 280, querySelectorAll: () => fields};
  h.nodes.rrCity.selectionStart = 1; h.nodes.rrCity.selectionEnd = 2; h.nodes.rrCity.focus();
  const previous = h.nodes.rrCity;
  h.ctx.bind = () => {};
  Object.defineProperty(h.root, 'innerHTML', {configurable: true, set(html) {
    assert.match(html, /opsContent/);
    fields = fields.map(field => h.input(field.id, '', {type: field.type, tagName: field.tagName}));
    h.nodes.opsContent = {scrollTop: 0, querySelectorAll: () => fields}; h.document.activeElement = null;
  }});
  h.ctx.renderOpsV2();
  assert.notEqual(h.nodes.rrCity, previous); assert.equal(h.nodes.rrProv.value, '湖北'); assert.equal(h.nodes.rrCity.value, '随州');
  assert.equal(h.nodes.draftChoice.value, 'standard'); assert.equal(h.nodes.draftCheck.checked, true);
  assert.equal(h.nodes.secret.value, ''); assert.equal(h.nodes.upload.value, '');
  assert.equal(h.document.activeElement, h.nodes.rrCity); assert.equal(h.nodes.rrCity.selectionStart, 1); assert.equal(h.nodes.rrCity.selectionEnd, 2);
  assert.equal(h.nodes.opsContent.scrollTop, 280);
  h.ctx.opsTab = 'users'; h.ctx.renderOpsV2(); assert.equal(h.nodes.opsContent.scrollTop, 0);
  assert.equal(h.nodes.rrCity.value, '', 'switching pages must not transplant old form drafts');
});

test('authenticated application entry enables the admin layout body class and logout removes it', async () => {
  const h = await boot();
  assert.equal(h.document.body.classList.contains('ops-mode'), false);
  h.admin(); h.ctx.render();
  assert.equal(h.document.body.classList.contains('ops-mode'), true);
  assert.match(h.root.innerHTML, /ops-v3/);
  h.ctx._authForget(); h.ctx.render();
  assert.equal(h.document.body.classList.contains('ops-mode'), false);
  assert.match(h.root.innerHTML, /管理端登录/);
});

test('RAG poll retains drafts only in their original workspace and resets scroll when switching', async () => {
  for (const page of ['upload', 'query']) {
    const h = await boot(); h.admin(); h.ctx.bind = () => {};
    h.ctx.PROJECTS = {alpha: {city: '同城', kb: [{t: '本区主题', known: []}]}, beta: {city: '同城', kb: [{t: '新区主题', known: []}]}};
    h.ctx.opsTab = 'rag'; h.ctx.OPS_UI.rag.tab = page; h.ctx.ragCity = 'alpha';
    h.ctx.renderOpsV2();
    const id = page === 'upload' ? 'ragUpNature' : 'ragChatIn';
    const initialValue = page === 'upload' ? 'fix' : '只属于甲工作区的问题';
    const defaultValue = page === 'upload' ? 'support' : '';
    let fields = [h.input(id, initialValue, {tagName: page === 'upload' ? 'SELECT' : 'INPUT'})];
    h.nodes.opsContent = {scrollTop: 155, querySelectorAll: () => fields}; fields[0].focus();
    Object.defineProperty(h.root, 'innerHTML', {configurable: true, set(html) {
      assert.match(html, /opsContent/);
      fields = [h.input(id, defaultValue, {tagName: page === 'upload' ? 'SELECT' : 'INPUT'})];
      h.nodes.opsContent = {scrollTop: 0, querySelectorAll: () => fields}; h.document.activeElement = null;
    }});
    h.ctx.renderOpsV2();
    assert.equal(h.nodes[id].value, initialValue, page + ': same-workspace polling retains draft');
    assert.equal(h.document.activeElement, h.nodes[id]); assert.equal(h.nodes.opsContent.scrollTop, 155);
    h.ctx.ragCity = 'beta'; h.ctx.renderOpsV2();
    assert.equal(h.nodes[id].value, defaultValue, page + ': different workspace does not inherit draft');
    assert.equal(h.document.activeElement, null); assert.equal(h.nodes.opsContent.scrollTop, 0);
  }
});

// Browser I/O for the RAG page: replacing root.innerHTML creates fresh form
// elements from the actual rendered markup. Capture/restore, renderOpsV2 and
// the button handlers all remain production code.
function mountRagForm(h) {
  let html = '', fields = [];
  const attr = (source, name) => {
    const match = source.match(new RegExp('\\b' + name + '="([^"]*)"'));
    return match ? decode(match[1]) : '';
  };
  function field(tagName, attrs, value) {
    const id = attr(attrs, 'id'); if (!id) return;
    const node = h.input(id, value, {tagName, type: attr(attrs, 'type') || 'text', disabled: /\bdisabled\b/.test(attrs)});
    let current = value;
    Object.defineProperty(node, 'value', {get: () => current, set(next) {
      current = String(next); node.selectionStart = Math.min(node.selectionStart, current.length); node.selectionEnd = Math.min(node.selectionEnd, current.length);
    }});
    node.setSelectionRange = (start, end) => {node.selectionStart = Math.min(start, current.length); node.selectionEnd = Math.min(end, current.length);};
    fields.push(node);
  }
  Object.defineProperty(h.root, 'innerHTML', {configurable: true, get: () => html, set(value) {
    html = value;
    fields.forEach(node => delete h.nodes[node.id]); fields = []; h.document.activeElement = null;
    for (const match of html.matchAll(/<input\b([^>]*)>/g)) field('INPUT', match[1], attr(match[1], 'value'));
    for (const match of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) field('TEXTAREA', match[1], decode(match[2]));
    h.nodes.opsContent = {scrollTop: 0, querySelectorAll: () => fields};
  }});
  h.ctx.bind = () => {};
  h.ctx.PROJECTS = {alpha: {city: '同城', kb: [{t: '甲资料', known: ['甲工作区材料']}]}, beta: {city: '同城', kb: [{t: '乙资料', known: ['乙工作区材料']}]}};
  h.ctx.opsTab = 'rag'; h.ctx.OPS_UI.rag.tab = 'query'; h.ctx.ragCity = 'alpha';
  h.ctx.renderOpsV2();
  return label => {
    const button = Array.from(html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)).find(match => decode(match[2].replace(/<[^>]*>/g, '')) === label);
    assert.ok(button, 'rendered button: ' + label);
    vm.runInContext(attr(button[1], 'onclick'), h.ctx);
  };
}

test('clearing an empty RAG search clears the visible query through real capture/restore and later renders', async () => {
  const h = await boot(); h.admin(); const click = mountRagForm(h);
  h.ctx.PROJECTS.alpha.kb[0].known = []; h.ctx.renderOpsV2();
  const projects = JSON.stringify(h.ctx.PROJECTS), callCount = h.calls.length;
  h.nodes.ragQ.value = '工业用地价格 氢能补链'; h.nodes.ragQ.focus();
  click('检索测试');
  assert.equal(h.nodes.ragQ.value, '工业用地价格 氢能补链');
  assert.ok(h.root.innerHTML.includes('本次检索未命中材料'), 'empty corpus renders the no-hit state');
  click('清除');
  assert.equal(h.nodes.ragQ.value, '');
  assert.equal(h.ctx.ragQuery, ''); assert.equal(h.ctx.ragHits, null);
  assert.doesNotMatch(h.root.innerHTML, /本次检索未命中材料|>清除<|工业用地价格 氢能补链/);
  h.ctx.ragOverviewOpen = !h.ctx.ragOverviewOpen; h.ctx.renderOpsV2(); h.ctx.renderOpsV2();
  assert.equal(h.nodes.ragQ.value, '', 'overview and poll must not resurrect the cleared draft');
  assert.equal(h.document.activeElement, h.nodes.ragQ); assert.equal(h.nodes.ragQ.selectionStart, 0);
  assert.equal(h.calls.length, callCount, 'local search and clearing do not make requests');
  assert.equal(JSON.stringify(h.ctx.PROJECTS), projects);
});

test('clearing RAG search preserves another unfinished form and its focus, caret and scroll', async () => {
  const h = await boot(); h.admin(); const click = mountRagForm(h);
  h.nodes.ragQ.value = '未命中的关键词'; click('检索测试');
  h.nodes.ragChatIn.value = '尚未发送的补充问题'; h.nodes.ragChatIn.focus(); h.nodes.ragChatIn.setSelectionRange(2, 5);
  h.nodes.opsContent.scrollTop = 420;
  click('清除');
  assert.equal(h.nodes.ragQ.value, ''); assert.equal(h.ctx.ragHits, null);
  assert.equal(h.nodes.ragChatIn.value, '尚未发送的补充问题'); assert.equal(h.document.activeElement, h.nodes.ragChatIn);
  assert.equal(h.nodes.ragChatIn.selectionStart, 2); assert.equal(h.nodes.ragChatIn.selectionEnd, 5);
  assert.equal(h.nodes.opsContent.scrollTop, 420);
});

test('ordinary RAG renders still preserve unsent drafts only within the active workspace', async () => {
  const h = await boot(); h.admin(); mountRagForm(h);
  h.nodes.ragQ.value = '甲工作区尚未检索'; h.nodes.ragQ.focus(); h.nodes.ragQ.setSelectionRange(1, 4);
  h.nodes.ragChatIn.value = '甲工作区尚未发送'; h.nodes.opsContent.scrollTop = 175;
  h.ctx.renderOpsV2();
  assert.equal(h.nodes.ragQ.value, '甲工作区尚未检索'); assert.equal(h.document.activeElement, h.nodes.ragQ);
  assert.equal(h.nodes.ragQ.selectionStart, 1); assert.equal(h.nodes.ragQ.selectionEnd, 4);
  assert.equal(h.nodes.ragChatIn.value, '甲工作区尚未发送'); assert.equal(h.nodes.opsContent.scrollTop, 175);
  h.ctx.ragSelectWorkspace('beta');
  assert.equal(h.nodes.ragQ.value, ''); assert.equal(h.nodes.ragChatIn.value, '');
  assert.equal(h.document.activeElement, null); assert.equal(h.nodes.opsContent.scrollTop, 0);
  h.nodes.ragQ.value = '乙工作区尚未检索'; h.ctx.renderOpsV2();
  assert.equal(h.nodes.ragQ.value, '乙工作区尚未检索');
  assert.equal(h.ctx.ragCity, 'beta'); assert.equal(h.ctx.ragHits, null);
});

test('RAG workspace switching clears completed chat and rejects stale or mismatched commits', async () => {
  const h = await boot(); h.admin(); h.ctx.bind = () => {}; h.ctx.toast = () => {};
  h.ctx.PROJECTS = {alpha: {city: '同城', kb: [{t: '甲资料', known: []}]}, beta: {city: '同城', kb: [{t: '乙资料', known: []}]}};
  h.ctx.opsTab = 'rag'; h.ctx.OPS_UI.rag.tab = 'query'; h.ctx.ragCity = 'alpha'; h.ctx.renderOpsV2();
  const original = {role: 'assistant', content: '只属于甲工作区的已完成结论', workspaceKey: 'alpha'};
  h.ctx.ragChatMsgs = [original]; h.ctx.ragChatPending = original;
  const confirmations = []; h.ctx.ragCommitModal = options => {confirmations.push(options);};
  const writes = []; h.ctx.fetch = (url, options) => {writes.push({url, options}); return Promise.resolve(response(200, {ok: true}));};
  h.ctx.restoreFromServer = () => {};
  h.ctx.ragChatCommit(0, 'beta'); assert.equal(confirmations.length, 0, 'message cannot be re-bound to another workspace');
  h.ctx.ragChatCommit(0, 'alpha'); assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].key, 'alpha');
  confirmations[0].onConfirm('甲资料', 'support'); await flush();
  assert.equal(writes.length, 1); assert.equal(writes[0].url, '/api/kb-upload');
  assert.equal(JSON.parse(writes[0].options.body).projectKey, 'alpha');
  assert.equal(JSON.parse(writes[0].options.body).text, original.content);
  writes.length = 0;
  h.ctx.ragCity = 'beta'; h.ctx.renderOpsV2();
  assert.equal(h.ctx.ragChatMsgs.length, 0); assert.equal(h.ctx.ragChatPending, null);
  assert.doesNotMatch(h.root.innerHTML, /只属于甲工作区/);
  confirmations[0].onConfirm('乙资料', 'support'); await flush();
  assert.equal(writes.length, 0, 'an already-open commit confirmation cannot write after switching workspace');
  h.ctx.ragChatCommit(0, 'beta'); assert.equal(confirmations.length, 1);
});

test('late RAG stream from an old workspace neither contaminates new chat nor resets its busy state', async () => {
  const h = await boot(); h.admin(); h.ctx.bind = () => {}; h.ctx.toast = () => {};
  h.ctx.PROJECTS = {alpha: {city: '同城', kb: [{t: '甲资料', known: ['仅甲资料']}]}, beta: {city: '同城', kb: [{t: '乙资料', known: ['仅乙资料']}]}};
  h.ctx.opsTab = 'rag'; h.ctx.OPS_UI.rag.tab = 'query'; h.ctx.ragCity = 'alpha'; h.ctx.renderOpsV2();
  const requests = [], streams = [];
  h.ctx.fetch = (url, options) => {
    assert.equal(url, '/api/kb-chat'); requests.push(JSON.parse(options.body));
    let deliver, reads = 0;
    const pending = new Promise(resolve => {deliver = resolve;});
    const reader = {read() {reads++; return reads === 1 ? pending : Promise.resolve({done: true});}, cancel() {return Promise.resolve();}};
    streams.push({reader, deliver, reads: () => reads});
    return Promise.resolve({ok: true, body: {getReader: () => reader}});
  };
  h.input('ragChatIn', '甲工作区的问题'); h.ctx.ragChatSend('alpha'); await flush();
  assert.equal(streams[0].reads(), 1); const oldMessage = h.ctx.ragChatMsgs[1];
  h.ctx.ragCity = 'beta'; h.ctx.renderOpsV2();
  assert.equal(h.ctx.ragChatMsgs.length, 0); assert.equal(h.ctx.ragChatBusy, false);
  h.input('ragChatIn', '乙工作区的问题'); h.ctx.ragChatSend('beta'); await flush();
  assert.equal(h.ctx.ragChatBusy, true); assert.equal(streams[1].reads(), 1);
  assert.ok(requests[1].history.every(message => !message.content.includes('甲工作区')));
  const frame = text => ({done: false, value: new TextEncoder().encode('data: ' + JSON.stringify({choices: [{delta: {content: text}}]}) + '\n')});
  streams[0].deliver(frame('迟到的甲结论')); await flush();
  assert.equal(oldMessage.content, '');
  assert.ok(h.ctx.ragChatMsgs.every(message => !message.content.includes('甲')));
  assert.equal(h.ctx.ragChatBusy, true, 'old completion cannot unlock the active workspace request');
  streams[1].deliver(frame('乙工作区的结论')); await flush();
  assert.equal(h.ctx.ragChatBusy, false);
  assert.equal(h.ctx.ragChatMsgs.at(-1).content, '乙工作区的结论');
  assert.equal(h.ctx.ragChatMsgs.at(-1).workspaceKey, 'beta');
});

test('poll never restores a selected local file path into a newly created file input', async () => {
  const h = await boot(); h.admin();
  const old = h.input('uploadFile', 'C:\\fakepath\\材料.pdf', {type: 'file'}); old.focus();
  h.nodes.opsContent = {querySelectorAll: () => [old]};
  const snapshot = h.ctx.opsCaptureView();
  const replacement = h.input('uploadFile', '', {type: 'file'});
  Object.defineProperty(replacement, 'value', {get() {return '';}, set(value) {if (value) throw new Error('InvalidStateError: file inputs only accept the empty string');}});
  assert.doesNotThrow(() => h.ctx.opsRestoreView(snapshot));
  assert.equal(replacement.value, '');
});

test('admin render guard still rejects anonymous/member sessions before showing any data', async () => {
  const h = await boot();
  assert.deepEqual(h.calls.map(call => call.url), ['/api/auth/session']);
  h.ctx.renderOpsV2(); assert.match(h.root.innerHTML, /管理端登录/);
  h.ctx.AUTH = {user: 'member', scope: 'user', projectKeys: ['workspace-a']}; h.ctx._authState = 'ready'; h.ctx._opsDataReady = true;
  h.ctx.renderOpsV2(); assert.match(h.root.innerHTML, /当前账号无管理权限/);
  assert.doesNotMatch(h.root.innerHTML, /opsInviteResults|opsUserResults|管理端导航/);
  assert.deepEqual(h.calls.map(call => call.url), ['/api/auth/session']);
});

test('demand list shows submitted projects only and rendering never starts AI work', async () => {
  const h = await boot(); h.admin();
  h.ctx.PROJECTS = {base: {city: '同城', topic: '城市基础', kb: []}, child: {city: '同城', topic: '新能源', org: '招商局', isDemand: true, stage: 1, kb: [], clues: []},
    other: {city: '另一城', topic: '半导体', org: '高新区', isDemand: true, stage: 1, kb: [], clues: []}};
  h.ctx.DEMANDS = [{projKey:'child'}, {projKey:'other'}];
  h.ctx.runAIFunnel = () => {throw new Error('render may not start AI work');};
  let html = h.ctx.opsDemandResults(); assert.match(html, /2 个城市 · 2 个项目/); assert.doesNotMatch(html, /城市基础/);
  h.ctx.OPS_UI.demands.query = '新能源'; html = h.ctx.opsDemandResults(); assert.match(html, /新能源/); assert.doesNotMatch(html, /半导体/);
  h.ctx.OPS_UI.demands.city = '另一城'; assert.match(h.ctx.opsDemandResults(), /暂无符合条件的招商项目/);
});

test('demand cards preserve exact project action targets and escape expanded factual text', async () => {
  const h = await boot(); h.admin();
  const key = "project');globalThis.injected=true;//\"", payload = '<img src=x onerror=alert(1)>';
  h.ctx.PROJECTS = {[key]: {city: payload, topic: payload, org: payload, isDemand: true, stage: 1, kb: [], clues: [],
    funnel: {total: 1, companies: [{name: payload, listed: payload, region: payload, kind: payload, fit: payload, signal: payload, expansion: payload, faction: payload, fit_score: 80}]}}};
  h.ctx.__opsProjOpen = {[key]: true};
  h.ctx.DEMANDS = [{projKey: key, topic: payload, domain: payload, need: payload}];
  const html = h.ctx.opsDemandResults();
  assert.doesNotMatch(html, /<img|<script/); assert.match(html, /&lt;img/);
  let target; h.ctx.toggleOpsProj = value => {target = value;};
  vm.runInContext(handlers(html).find(value => value.startsWith('toggleOpsProj(')), h.ctx);
  assert.equal(target, key); assert.equal(h.ctx.injected, undefined);
});

test('enterprise cards escape imported attributes without losing indexed actions', async () => {
  const h = await boot(); h.admin();
  const payload = '<img src=x onerror=alert(1)>';
  h.ctx.OPS_ENT = [{name: payload, kind: payload, region: payload, revenue: payload, gap: payload, signal: payload, contact: payload,
    note: payload, faction: [{type: payload, label: payload, person: payload}], tags: [payload], matches: [{city: payload, gap: payload}], status: 'scanned'}];
  const html = h.ctx.opsEntListV2(h.ctx.OPS_ENT);
  assert.doesNotMatch(html, /<img|<script/); assert.match(html, /&lt;img/);
  let target; h.ctx.opsEntManualEdit = index => {target = index;};
  vm.runInContext(handlers(html).find(value => value.startsWith('opsEntManualEdit(')), h.ctx);
  assert.equal(target, 0);
});

function seedFunnelDemand(h, funnel, key = 'minhang-demand') {
  h.ctx.PROJECTS = {
    'minhang-root': {city: '闵行区', topic: '城市产业方向', kb: []},
    [key]: {city: '闵行区', topic: '当前具体招引需求', workspaceId: 'minhang-root', isDemand: true, stage: 4, kb: [], clues: [], funnel},
  };
  h.ctx.DEMANDS = [{projKey: key}];
  h.ctx.__opsProjOpen = {[key]: true};
  h.ctx.runAIFunnel = () => {throw new Error('render may not start AI work');};
  return key;
}

test('legacy funnel keeps all 50 names in a collapsed evidence list without scores or push controls', async () => {
  const h = await boot(); h.admin();
  const companies = Array.from({length: 50}, (_, i) => ({name: '历史企业' + (i + 1), fit_score: 99, expansion: '已确认投资扩张', fit: '已确认完全适配', listed: '历史上市信息'}));
  const key = seedFunnelDemand(h, {topic: '旧产业范围', total: 46, companies});
  const before = JSON.stringify(h.ctx.PROJECTS);
  const html = h.ctx.opsDemandResults();
  assert.match(html, /历史待补证 50 家/); assert.doesNotMatch(html, /材料待筛选 50 家/);
  assert.match(html, /<details class="funnel-legacy-candidates"[^>]*>/); assert.doesNotMatch(html, /<details class="funnel-legacy-candidates"[^>]*\bopen\b/);
  for (const company of companies) assert.ok(html.includes('<li>' + company.name + '</li>'));
  assert.match(html, /原方向：旧产业范围/); assert.match(html, /不作为本次推荐，需补充企业全称、产品原文及对应网页链接后重新筛选/);
  assert.doesNotMatch(html, /已确认投资扩张|已确认完全适配|历史上市信息|showFunnelPyramid|pushFunnelTopToGov/);
  assert.match(html, /按材料筛选企业/); assert.match(html, /opsOpenFunnelMaterials/);
  const legacy = h.ctx.renderCluesTwoPanel(key);
  assert.match(legacy, /历史待补证 50 家/); assert.match(legacy, /<li>历史企业50<\/li>/);
  assert.doesNotMatch(legacy, /showFunnelPyramid|pushFunnelTopToGov|已确认投资扩张/);
  assert.equal(JSON.stringify(h.ctx.PROJECTS), before);
});

test('a completed empty funnel retains historic evidence work without suggesting the companies disappeared', async () => {
  const h = await boot(); h.admin();
  seedFunnelDemand(h, {topic: '当前具体招引需求', evidence_contract: 'saved-excerpts-v1', companies: [], legacyTopic: '旧产业范围', legacyCandidates: [{name: '历史企业'}]});
  const html = h.ctx.opsDemandResults();
  assert.match(html, /材料待筛选 0 家/); assert.match(html, /不代表现实中不存在相关企业/);
  assert.match(html, /历史企业线索（来源待补） · 1 家/); assert.match(html, /原方向：旧产业范围/);
  assert.match(html, /<li>历史企业<\/li>/); assert.doesNotMatch(html, /pushFunnelTopToGov/);
});

test('current verified candidates stay in the normal review flow and are removed from the historic list', async () => {
  const h = await boot(); h.admin();
  const key = seedFunnelDemand(h, {topic: '当前具体招引需求', evidence_contract: 'saved-excerpts-v1', total: 99,
    companies: [{name: '杭州大立过滤设备股份有限公司', fit: '产品材料待核', evidence: [{urls: ['https://example.invalid/product']}]}],
    legacyCandidates: [{name: ' 杭州 大立过滤设备股份有限公司 '}, {name: '待补企业'}, {name: '待补企业'}], legacyTopic: '原方向'});
  const html = h.ctx.opsDemandResults(), historic = html.match(/<details class="funnel-legacy-candidates"[\s\S]*?<\/details>/)[0];
  assert.match(html, /材料待筛选 1 家/); assert.match(html, /杭州大立过滤设备股份有限公司/);
  assert.match(html, /pushFunnelTopToGov/); assert.match(html, /showFunnelPyramid/);
  assert.match(historic, /历史企业线索（来源待补） · 1 家/); assert.match(historic, /<li>待补企业<\/li>/); assert.doesNotMatch(historic, /大立/);
  h.ctx.PROJECTS[key].clues = [{name: '过时扫描结果', status: 'ai_scan', fit_score: 99}];
  const legacy = h.ctx.renderCluesTwoPanel(key);
  assert.match(legacy, /杭州大立过滤设备股份有限公司/); assert.doesNotMatch(legacy, /过时扫描结果/);
});

test('historic names and topics are escaped and action handlers retain the exact project key', async () => {
  const h = await boot(); h.admin();
  const key = "demand');globalThis.injected=true;//\"", payload = '<img src=x onerror=alert(1)>';
  seedFunnelDemand(h, {topic: payload, companies: [{name: payload}]}, key);
  const html = h.ctx.opsDemandResults(); assert.doesNotMatch(html, /<img|<script/); assert.match(html, /&lt;img/);
  let selected; h.ctx.opsOpenFunnelMaterials = value => {selected = value;};
  vm.runInContext(handlers(html).find(value => value.startsWith('opsOpenFunnelMaterials(')), h.ctx);
  assert.equal(selected, key); assert.equal(h.ctx.injected, undefined);
});

test('material action uses the selected project workspace and preserves demand identity and topic', async () => {
  const h = await boot(); h.admin(); const key = seedFunnelDemand(h, {companies: []});
  h.ctx.PROJECTS.other = {city: '闵行区', topic: '另一个工作区', kb: [{known: ['别处材料']}]};
  h.ctx.cur = key; h.ctx.ragCity = 'other'; h.ctx.ragTopic = 3; h.ctx.OPS_UI.rag.tab = 'query';
  h.ctx.opsTab = 'demands'; let renders = 0; h.ctx.renderOpsV2 = () => {renders++;};
  const before = JSON.stringify(h.ctx.PROJECTS);
  h.ctx.opsOpenFunnelMaterials(key);
  assert.equal(h.ctx.opsTab, 'rag'); assert.equal(h.ctx.ragCity, 'minhang-root'); assert.equal(h.ctx.ragProjKey(), 'minhang-root');
  assert.equal(h.ctx.OPS_UI.rag.tab, 'upload'); assert.equal(h.ctx.ragTopic, 0); assert.equal(h.ctx.cur, key);
  assert.equal(JSON.stringify(h.ctx.PROJECTS), before); assert.equal(renders, 1);
});

test('missing material workspace presents a precise checklist and never falls back to another workspace', async () => {
  const h = await boot(); h.admin(); const key = seedFunnelDemand(h, {companies: []});
  delete h.ctx.PROJECTS['minhang-root']; h.ctx.PROJECTS.other = {city: '闵行区', topic: '另一个工作区', kb: []};
  h.ctx.opsTab = 'demands'; h.ctx.ragCity = 'other'; let renders = 0; h.ctx.renderOpsV2 = () => {renders++;};
  h.ctx.opsOpenFunnelMaterials(key);
  assert.equal(h.ctx.opsTab, 'demands'); assert.equal(h.ctx.ragCity, 'other'); assert.equal(renders, 0);
  assert.match(h.modals.at(-1).body, /材料工作区尚不可用/); assert.match(h.modals.at(-1).body, /minhang-root/);
  assert.match(h.modals.at(-1).body, /企业全称、产品原文及对应网页链接（可上传含这些内容的文件）/);
});

function assessedCompany(name, scores) {
  const labels = ['match', 'relocate', 'strength'], max = [40, 30, 30], assessments = {};
  labels.forEach((label, index) => {
    assessments[label] = scores[index] == null ? null : {score: scores[index], max: max[index], reason: name + '的' + label + '评分理由',
      evidence: [{id: label + '-source', quote: name + '的' + label + '原文依据', urls: ['https://example.invalid/' + label]}],
      ...(label === 'match' ? {demand: {id: 'demand:description', kind: 'user_demand', quote: '客户确认的过滤设备招引需求'}} : {})};
  });
  return {name, assessment_contract: 'evidence-assessment-v1', assessments, fit_score: 100,
    score_match: 40, score_relocate: 30, score_strength: 30,
    evidence: [{id: 'product', quote: name + '产品资料原文', urls: ['https://example.invalid/product']}]};
}

function scoredFunnel(companies) {
  return {topic: '当前具体招引需求', evidence_contract: 'saved-excerpts-v1', scoring_contract: 'evidence-assessment-v1', total_scanned: 999, companies};
}

test('complete evidence assessments restore the three weighted dimensions and source explanations', async () => {
  const h = await boot(); h.admin(); const company = assessedCompany('完整评分企业', [36, 25, 27]);
  const key = seedFunnelDemand(h, scoredFunnel([company]));
  const score = h.ctx.funnelAssessment(company);
  assert.equal(score.total, 88); assert.equal(score.tier, 'S');
  const html = h.ctx.opsDemandResults();
  assert.match(html, /S 级 · 88 分/); assert.match(html, /业务匹配 36 \/ 40/);
  assert.match(html, /可招引性（布局\/拓展线索） 25 \/ 30/); assert.match(html, /企业实力 27 \/ 30/);
  assert.match(html, /AI研判分，不代表已核实事实或投资承诺/); assert.match(html, /查看三维评分依据/);
  assert.match(html, /完整评分企业的match评分理由/); assert.match(html, /完整评分企业的match原文依据/);
  assert.match(html, /https:\/\/example.invalid\/strength/); assert.match(html, /demand:description/);
  assert.match(html, /客户确认的过滤设备招引需求/); assert.doesNotMatch(html, /999 家/);
  assert.match(h.ctx.renderCluesTwoPanel(key), /S 级 · 88 分/);
});

test('partial and unknown assessments keep missing values separate and never normalize to 100', async () => {
  const h = await boot(); h.admin();
  const partial = assessedCompany('部分评分企业', [35, null, 24]), unknown = assessedCompany('未知评分企业', [null, null, null]);
  seedFunnelDemand(h, scoredFunnel([partial, unknown]));
  const result = h.ctx.funnelAssessment(partial);
  assert.equal(result.total, null); assert.equal(result.tier, 'pending'); assert.equal(result.assessedScore, 59); assert.equal(result.assessedMax, 70); assert.equal(result.upper, 89);
  const html = h.ctx.opsDemandResults();
  assert.match(html, /已评 59 \/ 70 分；总分待补/); assert.match(html, /总分范围 59–89 \/ 100/);
  assert.match(html, /可招引性（布局\/拓展线索） 待补 \/ 30/); assert.match(html, /三项评分待补/);
  assert.match(html, /完整评分 0 家 → S 0 \/ A 0 \/ B 0；待补评分 2 家/);
  assert.doesNotMatch(html, /S 级 · 100 分|综合 59 \/ 100 分|综合 0 \/ 100 分/);
});

test('ranked companies use valid total scores, put pending last, and filtering only changes the view', async () => {
  const h = await boot(); h.admin();
  const companies = [assessedCompany('待补企业', [39, null, 29]), assessedCompany('B级企业', [20, 15, 20]), assessedCompany('S级企业', [36, 25, 27]), assessedCompany('A级企业', [30, 20, 25])];
  const key = seedFunnelDemand(h, scoredFunnel(companies)), before = JSON.stringify(h.ctx.PROJECTS);
  const html = h.ctx.opsDemandResults();
  assert.ok(html.indexOf('>S级企业</strong>') < html.indexOf('>A级企业</strong>'));
  assert.ok(html.indexOf('>A级企业</strong>') < html.indexOf('>B级企业</strong>'));
  assert.ok(html.indexOf('>B级企业</strong>') < html.indexOf('>待补企业</strong>'));
  assert.match(html, /有来源候选 4 家 → 完整评分 3 家 → S 1 \/ A 1 \/ B 1；待补评分 1 家/);
  let renders = 0; h.ctx.renderOpsV2 = () => {renders++;};
  const handler = handlers(html).find(value => value.startsWith('setFunnelTierFilter(') && value.endsWith(',"A")'));
  assert.ok(handler); vm.runInContext(handler, h.ctx);
  let filtered = h.ctx.opsDemandResults();
  assert.match(filtered, /data-funnel-tier="A"/); assert.doesNotMatch(filtered, /data-funnel-tier="S"|data-funnel-tier="B"|data-funnel-tier="pending"/);
  assert.match(filtered, /共 4 家 · 当前筛选 1 家 · 显示 1 家/);
  h.ctx.setFunnelTierFilter(key, 'pending'); filtered = h.ctx.opsDemandResults();
  assert.match(filtered, /data-funnel-tier="pending"/); assert.doesNotMatch(filtered, /data-funnel-tier="[SAB]"/);
  assert.equal(renders, 2); assert.equal(JSON.stringify(h.ctx.PROJECTS), before);
});

test('a missing assessment never suppresses the whole pyramid and each tier retains its evidence', async () => {
  const h = await boot(); h.admin(); const key = seedFunnelDemand(h, scoredFunnel([
    assessedCompany('S级企业', [36, 25, 27]), assessedCompany('A级企业', [30, 20, 25]), assessedCompany('B级企业', [20, 15, 20]), assessedCompany('待补企业', [35, null, null]),
  ]));
  h.ctx.showFunnelPyramid(key); const modal = h.modals.at(-1);
  assert.match(modal.title, /企业评分与分层/); assert.match(modal.body, /S 级 · 核心适配 · 1 家/);
  assert.match(modal.body, /A 级 · 高适配 · 1 家/); assert.match(modal.body, /B 级 · 潜力观察 · 1 家/);
  assert.match(modal.body, /待补评分 · 1 家/); assert.match(modal.body, /width:60%/); assert.match(modal.body, /width:80%/);
  assert.match(modal.body, /查看三维评分依据/); assert.match(modal.body, /有来源候选 4 家/);
  assert.doesNotMatch(modal.body, /尚未进行事实评分|综合 0 \/ 100/);
});

test('old scalar scores and malformed dimensions cannot become a new S/A/B assessment', async () => {
  const h = await boot(); h.admin();
  const old = assessedCompany('旧标量企业', [40, 30, 30]); delete old.assessment_contract;
  const malformed = assessedCompany('不完整依据企业', [40, 30, 30]); malformed.assessments.match.demand = null; malformed.assessments.relocate.max = 40; malformed.assessments.strength.evidence = [];
  const key = seedFunnelDemand(h, scoredFunnel([old, malformed]));
  for (const company of [old, malformed]) {assert.equal(h.ctx.funnelAssessment(company).total, null); assert.equal(h.ctx.funnelAssessment(company).tier, 'pending');}
  const html = h.ctx.opsDemandResults(); assert.match(html, /完整评分 0 家/); assert.doesNotMatch(html, /S 级 · 100 分/);
  h.ctx.showFunnelPyramid(key); assert.match(h.modals.at(-1).body, /待补评分 · 2 家/);
  const zero = assessedCompany('有效零分', [0, 0, 0]); assert.equal(h.ctx.funnelAssessment(zero).total, 0); assert.equal(h.ctx.funnelAssessment(zero).tier, 'B');
});

test('assessment text, evidence, names and pyramid titles are escaped without enabling unsafe links', async () => {
  const h = await boot(); h.admin(); const payload = '<img src=x onerror=alert(1)>';
  const company = assessedCompany(payload, [36, 25, 27]);
  company.assessments.match.reason = payload; company.assessments.match.demand.quote = payload;
  company.assessments.match.evidence[0].quote = payload; company.assessments.match.evidence[0].urls.push('javascript:alert(1)');
  const key = seedFunnelDemand(h, {...scoredFunnel([company]), topic: payload});
  const html = h.ctx.opsDemandResults(); assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img|href="javascript:/);
  h.ctx.showFunnelPyramid(key); assert.match(h.modals.at(-1).title, /&lt;img/); assert.doesNotMatch(h.modals.at(-1).body, /<img|href="javascript:/);
});

test('high scores open the unchanged individual source and demand review without making a push request', async () => {
  const h = await boot(); h.admin(); const high = assessedCompany('高分企业', [40, 30, 30]), low = assessedCompany('低分企业', [10, 10, 10]);
  const key = seedFunnelDemand(h, scoredFunnel([low, high]));
  Object.assign(h.ctx.PROJECTS[key], {demandContract: 'industry-demand-v1', demandSpec: {description: '具备过滤设备产品原文与技术规格的招引需求'}});
  const requests = h.calls.length; h.ctx.pushFunnelTopToGov(key, 8);
  assert.equal(h.ctx.pushFunnelTopToGov.review.companies[0].name, '高分企业');
  assert.match(h.modals.at(-1).body, /企业产品或服务原句/); assert.match(h.modals.at(-1).body, /当前方向的需求原句/);
  assert.match(h.modals.at(-1).body, /funnelReason-0/); assert.doesNotMatch(h.modals.at(-1).body, /checked/);
  assert.equal(h.calls.length, requests); assert.equal(h.ctx.PROJECTS[key].clues.length, 0);
});

test('score thresholds keep 85 in S, 70 in A and lower valid totals in B', async () => {
  const h = await boot(); h.admin();
  for (const [values, total, tier] of [[[35, 25, 25], 85, 'S'], [[34, 25, 25], 84, 'A'], [[30, 20, 20], 70, 'A'], [[29, 20, 20], 69, 'B']]) {
    const result = h.ctx.funnelAssessment(assessedCompany('临界企业', values));
    assert.equal(result.total, total); assert.equal(result.tier, tier);
  }
});

test('expanding and switching tiers keeps counts correct without reordering stored candidates', async () => {
  const h = await boot(); h.admin();
  const companies = Array.from({length: 10}, (_, index) => assessedCompany('企业' + index, [30, 20, index]));
  const key = seedFunnelDemand(h, scoredFunnel(companies)), before = JSON.stringify(h.ctx.PROJECTS);
  assert.match(h.ctx.opsDemandResults(), /当前筛选 10 家 · 显示 8 家/);
  h.ctx.__funnelExpand = {[key]: true}; assert.match(h.ctx.opsDemandResults(), /当前筛选 10 家 · 显示 10 家/);
  h.ctx.renderOpsV2 = () => {}; h.ctx.setFunnelTierFilter(key, 'S');
  const html = h.ctx.opsDemandResults(); assert.match(html, /当前筛选 0 家 · 显示 0 家/); assert.match(html, /当前分级没有企业/);
  assert.equal(h.ctx.__funnelExpand[key], false); assert.equal(JSON.stringify(h.ctx.PROJECTS), before);
});

test('stale S assessment moves to pending, exposes the reason and keeps historical scores out of current ranking', async () => {
  const h = await boot(); h.admin();
  const stale = {...assessedCompany('原S级企业', [40, 30, 30]), assessment_stale: true, assessment_stale_reason: '产品原文与需求已更新 <script>alert(1)</script>'};
  const fresh = assessedCompany('有效A级企业', [30, 20, 25]);
  const key = seedFunnelDemand(h, {...scoredFunnel([stale, fresh]), ts: Date.parse('2026-10-25T04:00:00Z')});
  const before = JSON.stringify(h.ctx.PROJECTS), score = h.ctx.funnelAssessment(stale);
  assert.equal(score.total, null); assert.equal(score.tier, 'pending'); assert.equal(score.assessedMax, 0);
  assert.equal(h.ctx.funnelAssessment(fresh).total, 75); assert.equal(h.ctx.funnelTierCounts(h.ctx.PROJECTS[key].funnel).S, 0);
  const html = h.ctx.opsDemandResults();
  assert.ok(html.indexOf('>有效A级企业</strong>') < html.indexOf('>原S级企业</strong>'));
  assert.match(html, /上次评分已过期，材料或需求已更新，请重新评分/);
  assert.match(html, /产品原文与需求已更新 &lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /查看已过期的历史评分与依据（不参与当前分级）/);
  assert.match(html, /<details><summary[^>]*>查看已过期/); assert.doesNotMatch(html, /<details open[^>]*>.*查看已过期/);
  assert.match(html, /完整评分 1 家 → S 0 \/ A 1 \/ B 0；待补评分 1 家/);
  assert.match(html, /逐家复核此企业/); assert.match(html, /上次评估时间/); assert.match(html, /12:00/); assert.match(html, /基于当时资料快照/);
  h.ctx.showFunnelPyramid(key); assert.match(h.modals.at(-1).body, /S 级 · 核心适配 · 0 家/); assert.match(h.modals.at(-1).body, /评分已过期 · 待补评分/);
  assert.equal(JSON.stringify(h.ctx.PROJECTS), before);
});

test('snapshot time only appears for a valid saved timestamp and does not change a current assessment', async () => {
  const h = await boot(); h.admin(); const company = assessedCompany('当前S级企业', [40, 25, 25]);
  const key = seedFunnelDemand(h, {...scoredFunnel([company]), ts: 0});
  assert.equal(h.ctx.funnelAssessment(company).tier, 'S'); assert.doesNotMatch(h.ctx.opsDemandResults(), /上次评估时间/);
  for (const invalid of [NaN, -1, Infinity, 'invalid', 1e30]) {
    h.ctx.PROJECTS[key].funnel.ts = invalid; assert.doesNotMatch(h.ctx.opsDemandResults(), /上次评估时间/);
  }
  h.ctx.PROJECTS[key].funnel.ts = Date.parse('2026-10-25T04:00:00Z');
  assert.match(h.ctx.renderCluesTwoPanel(key), /上次评估时间/);
  assert.match(h.ctx.opsDemandResults(), /S 级 · 90 分/); assert.doesNotMatch(h.ctx.opsDemandResults(), /上次评分已过期/);
});
