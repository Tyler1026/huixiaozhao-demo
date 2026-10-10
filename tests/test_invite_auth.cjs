'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (app, name) => fs.readFileSync(path.join(__dirname, '..', 'frontend', app, app === 'index' ? 'script-02-sections' : 'script-03-sections', name + '.js'), 'utf8');
const idx03 = read('index', '03');
const idx06 = read('index', '06');
const ops17 = read('ops', '17');
const response = (status, data) => ({status, ok: status >= 200 && status < 300, json: async () => data});
const auth = (overrides = {}) => ({user: 'member', scope: 'user', role: 'owner', city: '同名城市', projKey: 'team-a', projectKeys: ['team-a'], ...overrides});
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness(app = 'index') {
  const nodes = {}, storage = new Map(), calls = [], queue = [], timers = new Map(), toasts = [];
  let nextTimer = 1, renders = 0, closed = 0, restored = 0;
  const ctx = {
    console, Promise, Date, Math, JSON, AbortController, Blob,
    PROJECTS: {}, USER_PROFILES: {}, INVITE_CODES: {}, REPORTSTATE: {}, REPORT_REQUESTS: [], KB_CHAT: {},
    KB_CHAT_TOMBS: {}, KB_CONFIRMS: {}, UPLOAD_TOMBS: {}, KB_UNLOCKED: {}, cur: null, view: 'login',
    document: {getElementById: id => nodes[id] || null},
    localStorage: {getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    setTimeout(fn, ms) {const id = nextTimer++; timers.set(id, {fn, ms}); return id;},
    clearTimeout(id) {timers.delete(id);}, setInterval() {return 1;},
    render() {renders++;}, toast(message) {toasts.push(message);},
    closeModal() {closed++;}, openModal() {},
    restoreFromServer(callback) {restored++; ctx.PROJECTS = {'team-a': {city: '同名城市'}, 'team-b': {city: '同名城市'}}; callback(true);},
    fetch(url, options) {calls.push({url, options}); assert.ok(queue.length, 'unexpected fetch: ' + url); const item = queue.shift(); return typeof item === 'function' ? item() : Promise.resolve(item);},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  if (app === 'index') {
    vm.runInContext(idx03.slice(idx03.indexOf('var AUTH=')).replace('\nloadAuth();', ''), ctx);
    vm.runInContext(idx06.slice(0, idx06.indexOf('/* 随州常驻')), ctx);
  } else {
    const preamble = ops17.slice(0, ops17.indexOf('\nrender();\nif(!window._opsAuthPoll)'));
    vm.runInContext(preamble, ctx);
    // Invitation rendering now shares the real workspace UI/filter helpers;
    // load those functions too instead of making the legacy alias self-contained.
    vm.runInContext(ops17.slice(ops17.indexOf('var opsTab ='), ops17.indexOf('/* ══ Tab: 城市智库 RAG')), ctx);
    vm.runInContext(ops17.slice(ops17.indexOf('var ragChatMsgs='), ops17.indexOf('/* 工作区总览与下拉框')), ctx);
    vm.runInContext(ops17.slice(ops17.indexOf('/* == 客户管理：'), ops17.indexOf('/* == Tab2: 企业资源库 == */')), ctx);
  }
  return {ctx, calls, queue, nodes, storage, timers, toasts,
    input(id, value = '') {return nodes[id] = {value, textContent: '', innerHTML: '', style: {}, focus() {}};},
    async timer(ms) {const found = [...timers].find(([, task]) => task.ms === ms); assert.ok(found, 'timer ' + ms); timers.delete(found[0]); found[1].fn(); await flush();},
    renders: () => renders, closed: () => closed, restored: () => restored};
}
function registration(h) {
  const data = {regInviteCode: 'SYNTHETIC_CODE', regUser: 'newuser', regPwd: '  valid password  ', regName: '测试用户', regPhone: '13800000000', regWechat: 'test-wechat', regOrg: '测试单位', regDept: '测试部门', regTitle: '测试职务'};
  for (const [id, value] of Object.entries(data)) h.input(id, value);
  h.input('regErr');
  return data;
}

test('login and registration explain one-time invitation use without public default credentials', () => {
  const h = harness();
  const html = h.ctx.loginPage();
  assert.match(html, /无需重复填写邀请码/);
  assert.match(html, /有邀请码，注册加入团队/);
  assert.doesNotMatch(html, /id="(?:regInviteCode|loginInviteCode)"/);
  assert.doesNotMatch(html, /admin\/admin|123456|演示账号|默认密码/);
  assert.match(h.ctx.registerPage(), /已有账号？返回登录/);
  assert.match(h.ctx.registerPage(), /以后直接用账号和密码登录/);
});

test('login error uses server message and preserves account/password; concurrent clicks send once', async () => {
  const h = harness();
  h.input('loginUser', ' Member '); h.input('loginPwd', 'typed password'); h.input('loginErr');
  let resolve;
  h.queue.push(() => new Promise(r => {resolve = r;}));
  const first = h.ctx.doLogin();
  assert.equal(h.ctx.doLogin(), first);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(JSON.parse(h.calls[0].options.body), {username: 'member', password: 'typed password'});
  assert.equal(h.calls[0].options.credentials, 'same-origin');
  resolve(response(401, {ok: false, error: 'invalid_credentials', message: '账号或密码不正确'}));
  await first;
  assert.equal(h.ctx.AUTH, null);
  assert.equal(h.nodes.loginPwd.value, 'typed password');
  assert.equal(h.nodes.loginErr.textContent, '账号或密码不正确');
  assert.equal(h.toasts.length, 0);
});

test('failed registration neither authenticates nor changes profiles/invites and preserves inputs', async () => {
  for (const failure of [response(409, {ok: false, error: 'username_exists', message: '账号已存在，请登录'}), () => Promise.reject(new Error('网络不可用'))]) {
    const h = harness(); const initial = registration(h);
    h.ctx.USER_PROFILES = {existing: {name: '原用户'}}; h.ctx.INVITE_CODES = {SYNTHETIC_CODE: {usedBy: []}};
    h.queue.push(failure);
    await h.ctx.doRegister();
    assert.equal(h.ctx.AUTH, null);
    assert.equal(h.ctx.USER_PROFILES.existing.name, '原用户');
    assert.equal(h.ctx.INVITE_CODES.SYNTHETIC_CODE.usedBy.length, 0);
    for (const [id, value] of Object.entries(initial)) assert.equal(h.nodes[id].value, value);
    assert.equal(h.toasts.length, 0);
    assert.match(h.nodes.regErr.textContent, /账号已存在|网络不可用/);
  }
});

test('successful registration trusts returned auth, preserves exact password, and never sends registry through sync', async () => {
  const h = harness(); registration(h);
  h.queue.push(response(200, {ok: true, auth: auth({user: 'newuser'}), profile: {name: '测试用户'}}));
  await h.ctx.doRegister();
  assert.equal(h.ctx.AUTH.user, 'newuser');
  assert.equal(h.ctx.AUTH.projKey, 'team-a');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, '/api/auth/register');
  assert.equal(JSON.parse(h.calls[0].options.body).password, '  valid password  ');
  assert.equal(h.storage.has('hxz_auth'), false);
  assert.deepEqual(Object.keys(h.ctx.USER_PROFILES), []);
});

test('invitation validation only calls server and ignores stale responses', async () => {
  const h = harness(); h.input('regInviteCode', 'FIRST_SYNTHETIC'); h.input('regCity'); h.input('regInviteHint');
  let resolve;
  h.queue.push(() => new Promise(r => {resolve = r;}));
  h.ctx.onInviteCodeInput(); await h.timer(300);
  h.nodes.regInviteCode.value = 'SECOND_SYNTHETIC';
  h.ctx.onInviteCodeInput();
  resolve(response(200, {ok: true, city: '旧城市'})); await flush();
  assert.equal(h.nodes.regCity.value, '');
  h.queue.push(response(503, {ok: false, error: 'unavailable', message: '邀请码验证暂时不可用'}));
  await h.timer(300);
  assert.equal(h.nodes.regCity.value, '');
  assert.equal(h.nodes.regInviteHint.textContent, '邀请码验证暂时不可用');
  assert.equal(h.nodes.regInviteCode.value, 'SECOND_SYNTHETIC');
  assert.ok(h.calls.every(call => call.url === '/api/auth/invite/validate'));
  assert.deepEqual(JSON.parse(h.calls[0].options.body), {inviteCode: 'FIRST_SYNTHETIC'});
});

test('session restoration rejects forged local auth and clears all per-account state on 401', async () => {
  const h = harness();
  h.storage.set('hxz_auth', JSON.stringify(auth({scope: 'admin'})));
  h.storage.set('huixiaozhao_kb_v1', JSON.stringify({USER_PROFILES: {x: {pwd: 'secret'}}, PROJECTS: {other: {city: '其他城市'}}}));
  h.ctx.PROJECTS = {other: {}}; h.ctx.KB_CHAT = {'workspace:other': {sessions: [{id: 'old'}]}}; h.ctx.KB_CONFIRMS = {other: {}};
  h.queue.push(response(401, {ok: false, error: 'not_authenticated', message: '请登录'}));
  await h.ctx.loadAuth();
  assert.equal(h.ctx.AUTH, null); assert.equal(h.ctx._authState, 'anonymous');
  assert.deepEqual(Object.keys(h.ctx.PROJECTS), []); assert.deepEqual(Object.keys(h.ctx.KB_CHAT), []);
  assert.deepEqual(Object.keys(h.ctx.KB_CONFIRMS), []); assert.equal(h.storage.has('hxz_auth'), false);
  assert.equal(h.calls[0].url, '/api/auth/session');
});

test('session service outage does not unlock cached workspace, successful cookie restoration does', async () => {
  const h = harness(); h.ctx.AUTH = auth(); h.ctx.PROJECTS = {'team-a': {}};
  h.queue.push(response(503, {ok: false, error: 'unavailable', message: '认证服务暂时不可用'}));
  await h.ctx.loadAuth();
  assert.equal(h.ctx.AUTH, null); assert.equal(h.ctx._authState, 'unavailable');
  assert.deepEqual(Object.keys(h.ctx.PROJECTS), []);
  h.queue.push(response(200, {ok: true, authenticated: true, auth: auth()})); await h.ctx.loadAuth();
  assert.equal(h.ctx.AUTH.user, 'member'); assert.equal(h.ctx._authState, 'ready');
});

test('expired sync logs out before rendering and logout waits for server revocation', async () => {
  const h = harness(); h.ctx._authAccept(auth()); h.ctx.PROJECTS = {'team-a': {}};
  assert.throws(() => h.ctx._authReadSync(response(401, {})), /登录已过期/);
  assert.equal(h.ctx.AUTH, null);
  h.ctx._authAccept(auth());
  h.queue.push(response(503, {ok: false, error: 'unavailable', message: '退出服务暂时不可用'}));
  await h.ctx.logout(); assert.equal(h.ctx.AUTH.user, 'member');
  h.queue.push(response(200, {ok: true})); await h.ctx.logout(); assert.equal(h.ctx.AUTH, null);
  assert.equal(h.calls.at(-1).url, '/api/auth/logout');
});

test('join retains old memberships and refreshes the new active workspace only after confirmation', async () => {
  const h = harness(); h.ctx._authAccept(auth()); h.input('joinInviteCode', 'NEXT_SYNTHETIC'); h.input('joinInviteError');
  h.queue.push(response(200, {ok: true, auth: auth({projectKeys: ['team-a', 'team-b'], projKey: 'team-b'})}));
  await h.ctx.joinWorkspace();
  assert.deepEqual(Array.from(h.ctx.AUTH.projectKeys), ['team-a', 'team-b']);
  assert.equal(h.ctx.AUTH.projKey, 'team-b'); assert.equal(h.ctx.cur, 'team-b');
  assert.equal(h.restored(), 1); assert.equal(h.closed(), 1);
  assert.equal(h.calls[0].url, '/api/auth/join');
  h.input('joinInviteCode', 'BROKEN_SYNTHETIC');
  h.queue.push(response(200, {ok: true, auth: auth({projectKeys: ['team-c'], projKey: 'team-c'})}));
  await h.ctx.joinWorkspace();
  assert.equal(h.ctx.AUTH.projKey, 'team-b'); assert.equal(h.closed(), 1);
  assert.equal(h.nodes.joinInviteCode.value, 'BROKEN_SYNTHETIC');
  assert.match(h.nodes.joinInviteError.textContent, /授权响应不完整/);
});

test('workspace authorization and chat isolation use roots, never matching city labels', () => {
  const h = harness(); h.ctx._authAccept(auth());
  h.ctx.PROJECTS = {'team-a': {city: '同名城市'}, child: {city: '同名城市', workspaceId: 'team-a'}, stranger: {city: '同名城市', workspaceId: 'team-x'}};
  const tail = read('index', '14-tail');
  vm.runInContext(tail.slice(tail.indexOf('function _isAuthorizedChatKey('), tail.indexOf('function kbSessionStore(')), h.ctx);
  assert.deepEqual(Array.from(h.ctx.cityKeys()), ['team-a', 'child']);
  assert.equal(h.ctx.kbChatKey('child'), 'workspace:team-a'); assert.equal(h.ctx.kbChatKey('stranger'), null);
  assert.equal(h.ctx._isAuthorizedChatKey('city:同名城市'), false);
  assert.deepEqual(Object.keys(h.ctx._authFilterProjects(h.ctx.PROJECTS)), ['team-a', 'child']);
  const state = {sessions: [{id: 's1', messages: [{text: 'private'}]}]};
  h.ctx._mergeKbChat = (incoming, local) => ({...local, ...incoming});
  h.ctx.KB_CHAT = {'city:同名城市': state, stranger: state, child: state};
  h.ctx.migrateKbChatToCity();
  assert.deepEqual(Object.keys(h.ctx.KB_CHAT), ['workspace:team-a']);
});

test('sync snapshot strips accounts, credentials and invitation registry in both supported formats', () => {
  for (const app of ['index', 'ops']) {
    const h = harness(app);
    const forbidden = {USER_PROFILES: {x: {pwd: 'secret'}}, CITY_ACCOUNTS: {x: {pwd: 'secret'}}, INVITE_CODES: {SYNTHETIC: {}}, ACCOUNTS: {}, AUTH: {}, auth: {}, pwd: 'secret', password: 'secret', token: 'secret'};
    const safe = h.ctx._safeSyncSnapshot({...forbidden, PROJECTS: {a: {}}, huixiaozhao_kb_v1: {...forbidden, PROJECTS: {a: {}}}});
    for (const key of Object.keys(forbidden)) {assert.equal(safe[key], undefined); assert.equal(safe.huixiaozhao_kb_v1[key], undefined);}
    assert.ok(safe.PROJECTS.a); assert.ok(safe.huixiaozhao_kb_v1.PROJECTS.a);
    const profiles = h.ctx._safeProfiles({a: {name: 'safe', password: 'secret', pwd: 'secret', token: 'secret'}});
    assert.deepEqual(Object.keys(profiles.a), ['name']);
  }
});

test('admin gate requires cookie auth and denies ordinary users before syncing', async () => {
  const h = harness('ops'); h.input('root');
  h.storage.set('hxz_auth', JSON.stringify(auth({scope: 'admin'})));
  h.queue.push(response(401, {ok: false, error: 'not_authenticated', message: '请登录'}));
  await h.ctx.loadAuth();
  assert.match(h.nodes.root.innerHTML, /管理员账号和密码/); assert.equal(h.restored(), 0);
  h.ctx._authAccept(auth()); h.ctx.render();
  assert.match(h.nodes.root.innerHTML, /当前账号无管理权限/); assert.equal(h.restored(), 0);
  assert.doesNotMatch(h.ctx.opsLoginPage(), /admin\/admin|123456|默认密码/);
});

test('admin invitation save failure preserves form and maps; success uses server-created project', async () => {
  const h = harness('ops'); h.ctx._authAccept(auth({scope: 'admin', projectKeys: []}));
  h.input('invCityInput', '测试城市'); h.input('invEmailInput', 'test@example.invalid');
  h.queue.push(response(503, {ok: false, error: 'storage_unavailable', message: '保存失败，请重试'}));
  await h.ctx.doGenerateInviteCode();
  assert.deepEqual(Object.keys(h.ctx.INVITE_CODES), []); assert.deepEqual(Object.keys(h.ctx.PROJECTS), []);
  assert.equal(h.nodes.invCityInput.value, '测试城市'); assert.equal(h.closed(), 0);
  assert.equal(h.toasts.at(-1), '保存失败，请重试');
  h.queue.push(response(200, {ok: true, invite: {code: 'SYNTHETIC_ONLY', city: '测试城市', projKey: 'server-team'}, project: {id: 'server-team', workspaceId: 'server-team', city: '测试城市'}}));
  await h.ctx.doGenerateInviteCode();
  assert.deepEqual(JSON.parse(h.calls.at(-1).options.body), {action: 'create', city: '测试城市', distributedEmail: 'test@example.invalid'});
  assert.equal(h.ctx.INVITE_CODES.SYNTHETIC_ONLY.projKey, 'server-team');
  assert.equal(h.ctx.PROJECTS['server-team'].workspaceId, 'server-team'); assert.equal(h.closed(), 1);
});

test('admin invitation fields render escaped and distribution failure never updates cards', async () => {
  const h = harness('ops'); h.ctx._authAccept(auth({scope: 'admin', projectKeys: []}));
  h.ctx.INVITE_CODES = {SYNTHETIC_ONLY: {city: '<img src=x>', projKey: 'team-"bad', distributed: true, distributedEmail: '<script>x</script>', usedBy: []}};
  const html = h.ctx.inviteCodeSection();
  assert.doesNotMatch(html, /<img src=x>|<script>x<\/script>/); assert.match(html, /&lt;img/); assert.match(html, /&lt;script/);
  h.input('distEmailInput', 'new@example.invalid');
  h.queue.push(response(409, {ok: false, error: 'conflict', message: '邀请码状态已变化'}));
  await h.ctx.doMarkDistributed('SYNTHETIC_ONLY');
  assert.equal(h.ctx.INVITE_CODES.SYNTHETIC_ONLY.distributedEmail, '<script>x</script>');
  assert.equal(h.nodes.distEmailInput.value, 'new@example.invalid'); assert.equal(h.closed(), 0);
});

async function bootPage(name, session, serverState = {PROJECTS: {}}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../frontend/manifest.json'), 'utf8'));
  const html = manifest[name].parts.map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('');
  const root = {innerHTML: '', style: {}}, calls = [], disk = new Map(), timers = [], events = {};
  const append = {appendChild() {}, removeChild() {}};
  const ctx = {console: {log() {}, warn() {}}, Date, Math, Promise, JSON, AbortController, TextEncoder, URL, Uint8Array, Blob,
    location: {origin: 'http://localhost', search: '', href: 'http://localhost/'}, navigator: {}, performance: {now: () => Date.now()},
    localStorage: {getItem: key => disk.get(key) || null, setItem: (key, value) => disk.set(key, value), removeItem: key => disk.delete(key)},
    document: {getElementById: id => id === 'root' ? root : null, querySelector: selector => selector === '#root' ? root : null,
      querySelectorAll: () => [], addEventListener() {}, documentElement: {style: {}}, head: append, body: append,
      createElement: () => ({style: {}, classList: {add() {}, remove() {}}, appendChild() {}, setAttribute() {}})},
    setInterval() {}, setTimeout(fn, ms) {timers.push({fn, ms}); return timers.length;}, clearTimeout() {},
    addEventListener(name, fn) {(events[name] ||= []).push(fn);},
    fetch: async (url, options = {}) => {calls.push({url, options}); return url === '/api/auth/session' ? session : options.method === 'POST' ? response(200, {ok: true}) : response(200, serverState);},
  };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc=/.test(match[1])) vm.runInContext(match[2], ctx, {filename: name});
  }
  for (let i = 0; i < 40; i++) await Promise.resolve();
  return {ctx, root, calls, disk, timers, events};
}

test('both complete page scripts boot with only a session check, no unauthenticated sync', async () => {
  for (const name of ['index.html', 'ops.html']) {
    const h = await bootPage(name, response(401, {ok: false, error: 'not_authenticated', message: '请登录'}));
    assert.equal(h.ctx._authState, 'anonymous');
    assert.deepEqual(h.calls.map(c => c.url), ['/api/auth/session']);
    assert.match(h.root.innerHTML, name === 'ops.html' ? /管理端登录/ : /有邀请码，注册加入团队/);
  }
});

test('real admin restore and persist keep registry only in memory, never in cache or generic writes', async () => {
  const h = await bootPage('ops.html', response(200, {ok: true, authenticated: true, auth: auth({scope: 'admin', projectKeys: []})}), {
    PROJECTS: {}, USER_PROFILES: {member: {name: '测试', pwd: 'legacy-secret'}}, CITY_ACCOUNTS: {old: {pwd: 'legacy-secret'}},
    INVITE_CODES: {SYNTHETIC_ONLY: {code: 'SYNTHETIC_ONLY', city: '测试', usedBy: []}},
  });
  assert.equal(h.ctx._opsDataReady, true);
  assert.equal(h.ctx.INVITE_CODES.SYNTHETIC_ONLY.city, '测试');
  assert.deepEqual(Object.keys(h.ctx.USER_PROFILES.member), ['name']);
  const cached = JSON.parse(h.disk.get('huixiaozhao_kb_v1'));
  for (const key of ['USER_PROFILES', 'CITY_ACCOUNTS', 'INVITE_CODES']) assert.equal(cached[key], undefined);
  h.ctx.persist(); await flush();
  const writes = h.calls.filter(call => call.options.method === 'POST');
  assert.ok(writes.length);
  for (const call of writes) {
    const body = JSON.parse(call.options.body);
    for (const key of ['USER_PROFILES', 'CITY_ACCOUNTS', 'INVITE_CODES']) assert.equal(body[key], undefined);
    assert.doesNotMatch(call.options.body, /legacy-secret|SYNTHETIC_ONLY/);
  }
});

test('late join response after logout never re-authenticates or changes the active workspace', async () => {
  const h = harness(); h.ctx._authAccept(auth()); h.input('joinInviteCode', 'LATE_SYNTHETIC'); h.input('joinInviteError');
  let resolve; h.queue.push(() => new Promise(r => {resolve = r;}));
  const pending = h.ctx.joinWorkspace(); h.ctx._authForget();
  resolve(response(200, {ok: true, auth: auth({projectKeys: ['team-a', 'team-b'], projKey: 'team-b'})}));
  await pending;
  assert.equal(h.ctx.AUTH, null); assert.equal(h.restored(), 0); assert.equal(h.closed(), 0);
});

test('settings main column exposes joining/switching and escapes authenticated profile labels', async () => {
  const h = await bootPage('index.html', response(401, {ok: false, error: 'not_authenticated', message: '请登录'}));
  h.ctx._authAccept(auth({projectKeys: ['team-a', 'team-b']}));
  h.ctx.PROJECTS = {'team-a': {city: '<City A>'}, 'team-b': {city: '<City A>'}};
  const html = h.ctx.settingsPage({org: '"><script>org</script>', who: '<user>', city: '<City A>'});
  assert.match(html, /通过邀请码加入工作区/); assert.match(html, /切换工作区/);
  assert.match(html, /team-a/); assert.match(html, /team-b/);
  assert.doesNotMatch(html, /<script>org|<user>|<City A>/);
  assert.match(html, /&lt;City A&gt;/);
});

test('member removal uses its authorized API and preserves members if server rejects', async () => {
  const h = harness(); vm.runInContext(read('index', '13'), h.ctx);
  h.ctx._authAccept(auth()); h.ctx.confirm = () => true;
  h.ctx.USER_PROFILES = {peer: {name: '<Peer>', projectKeys: ['team-a'], role: 'member'}, stranger: {name: 'Other', projectKeys: ['team-b']}};
  const html = h.ctx.orgMembersBlock(); assert.match(html, /&lt;Peer&gt;/); assert.doesNotMatch(html, /Other/);
  h.queue.push(response(403, {ok: false, error: 'forbidden', message: '没有移除成员权限'}));
  await h.ctx.removeOrgMember('peer');
  assert.ok(h.ctx.USER_PROFILES.peer);
  assert.equal(h.calls[0].url, '/api/auth/members');
  assert.deepEqual(JSON.parse(h.calls[0].options.body), {action: 'remove', user: 'peer', projKey: 'team-a'});
  assert.equal(h.restored(), 0);
});

function workspaceFixture(h, admin = false) {
  h.ctx._authAccept(auth(admin ? {scope: 'admin', projectKeys: [], projKey: null} : {}));
  h.ctx.PROJECTS = {'team-a': {id: 'team-a', workspaceId: 'team-a', city: '同名城市', org: '单位', who: '用户', topic: '原方向', kb: [], clues: [], stage: 2},
    'team-b': {id: 'team-b', workspaceId: 'team-b', city: '同名城市', org: '其他单位', who: '其他用户', topic: '原方向', kb: [], clues: [], stage: 2}};
  h.ctx.cur = 'team-a'; h.ctx.view = 'knowledge'; h.ctx.toast = () => {};
  h.ctx.render._routed = true; h.ctx.render._serverSynced = true;
}

test('new government direction inherits the root and actual rendering keeps cur on the child', async () => {
  const h = await bootPage('index.html', response(401, {ok: false, message: '请登录'})); workspaceFixture(h);
  h.ctx.doCreateProj();
  const child = h.ctx.cur;
  assert.notEqual(child, 'team-a');
  assert.equal(h.ctx.PROJECTS[child].workspaceId, 'team-a');
  assert.equal(h.ctx._authWorkspaceOf(child), 'team-a');
  h.ctx.render(); assert.equal(h.ctx.cur, child);
  assert.ok(h.ctx.cityKeys().includes(child));
  h.ctx.AUTH.projectKeys.push('team-b'); h.ctx.cur = child;
  assert.equal(h.ctx._projectWorkspaceId(child), 'team-a');
});

test('both government demand creation paths bind to their parent workspace and never dedupe across same-city teams', async () => {
  for (const action of ['import', 'submit']) {
    const h = await bootPage('index.html', response(401, {ok: false, message: '请登录'})); workspaceFixture(h);
    h.ctx.AUTH.projectKeys.push('team-b');
    h.ctx.PROJECTS.foreign = {id: 'foreign', workspaceId: 'team-b', city: '同名城市', topic: '原方向', isDemand: true};
    h.ctx.REPORTSTATE['team-a'] = {text: '已完成的研判报告', topic: '原方向'};
    if (action === 'import') h.ctx.importToProject('原方向', '同名城市', '原方向');
    else await h.ctx.submitDemand();
    const children = Object.entries(h.ctx.PROJECTS).filter(([key, p]) => key !== 'foreign' && p.isDemand);
    assert.equal(children.length, 1, action + ' creates one child in this workspace');
    const [key, child] = children[0]; assert.equal(child.workspaceId, 'team-a');
    assert.equal(h.ctx._findExistingDemand('同名城市', '原方向'), key);
    h.ctx.cur = key; h.ctx.view = 'home'; h.ctx.render();
    assert.equal(h.ctx.cur, key, action + ' child survives route validation');
    h.ctx._dedupeDemands(); assert.ok(h.ctx.PROJECTS.foreign, 'same city peer workspace stays intact');
  }
});

test('admin derived direction retains the selected workspace and new city root owns itself', async () => {
  const h = await bootPage('ops.html', response(401, {ok: false, message: '请登录'})); workspaceFixture(h, true);
  h.ctx.render = () => {}; h.ctx.renderOpsV2 = () => {}; h.ctx.persist = () => {};
  h.ctx.doCreateProj(); assert.equal(h.ctx.PROJECTS[h.ctx.cur].workspaceId, 'team-a');
  const grandchild = h.ctx.cur; h.ctx.doCreateProj(); assert.equal(h.ctx.PROJECTS[h.ctx.cur].workspaceId, 'team-a');
  assert.equal(h.ctx._projectWorkspaceId(grandchild), 'team-a');
  assert.equal(h.ctx._projectWorkspaceId('team-b'), 'team-b', 'admin does not fall back to null active auth key');
  const input = {value: '新城市'}; h.ctx.document.getElementById = id => id === 'setupCity' ? input : null;
  h.ctx.analysisPage = () => ''; h.ctx.runAnalysisAnim = () => {};
  h.ctx.createProject(); assert.equal(h.ctx.PROJECTS[h.ctx.cur].workspaceId, h.ctx.cur);
});

test('reset clears the actual report-history and tombstone keys on both pages', async () => {
  for (const name of ['index.html', 'ops.html']) {
    const h = await bootPage(name, response(401, {ok: false, message: '请登录'}));
    for (const key of ['hxz_rpt_history', 'HXZ_UPLOAD_TOMBS', 'HXZ_KBCHAT_TOMBS']) h.disk.set(key, 'private-old-data');
    h.ctx._authForget();
    for (const key of ['hxz_rpt_history', 'HXZ_UPLOAD_TOMBS', 'HXZ_KBCHAT_TOMBS']) assert.equal(h.disk.has(key), false, name + ': ' + key);
  }
});
