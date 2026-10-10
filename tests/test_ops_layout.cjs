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
  assert.equal((html.match(/同城存在独立工作区，请核对编号/g) || []).length, 2);
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
  assert.equal((html.match(/同城存在独立工作区，请核对编号/g) || []).length, 2);
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
  assert.equal(values.length, 2);
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

test('overview uses live counts and short summaries without embedding a generation form', async () => {
  const h = await boot(); h.admin(); seedInvites(h);
  h.ctx.USER_PROFILES = {one: {}, two: {}};
  h.ctx.PROJECTS = {base: {city: '城市'}, one: {city: '城市', isDemand: true}, two: {city: '城市', isDemand: true}};
  h.ctx.REPORT_REQUESTS = [{id: 'one', city: '城市', status: 'running'}, {id: 'two', city: '城市', status: 'done'}, {id: 'three', city: '城市', status: 'failed'}];
  h.ctx.rrPanel = () => {throw new Error('overview must not render full report panel');};
  const html = h.ctx.opsOverview();
  assert.deepEqual(Array.from(html.matchAll(/class="ops-ui-stat-value">(\d+)</g), match => Number(match[1])), [3, 2, 2, 2]);
  assert.match(html, /1 进行中 · 1 需处理/); assert.match(html, /最近报告任务/); assert.match(html, /最近邀请码/);
  assert.doesNotMatch(html, /id="rrProv"|id="rrCity"/);
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
