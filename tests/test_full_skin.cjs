'use strict';

// Offline contract tests for the presentation adapters. Browser layout and
// real HTTP flows are verified separately; these checks protect the existing
// business handlers and state while the skin changes their presentation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const sources = {
  client: fs.readFileSync(path.join(root, 'frontend/index/full-skin.js'), 'utf8'),
  ops: fs.readFileSync(path.join(root, 'frontend/ops/full-skin.js'), 'utf8'),
};
const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g,
  char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

function harness(kind, options = {}) {
  const calls = [];
  const protectedNames = ['doLogin', 'doRegister', 'logout', 'save', 'syncNow',
    'submitDirectDemand', 'submitIndustryDemand', 'startTopicReport',
    'cancelTopicReport', 'opsLogin', 'opsSaveReceiving', 'opsPublishReport',
    'opsEntManualPushModal', 'opsEntDelete', 'fetch'];
  const sandbox = {
    URLSearchParams, location: {search: options.search || ''},
    document: {
      readyState: 'loading',
      documentElement: {classList: {add() {}}},
      querySelectorAll() { return []; },
      querySelector() { return null; },
      getElementById() { return null; },
      addEventListener(name, callback) { calls.push(['listener', name, callback]); },
      createElement(name) {
        return name === 'template' && kind === 'client' && options.supportsTemplates !== false
          ? {content: {querySelector: () => null, querySelectorAll: () => []}, innerHTML: ''}
          : {};
      },
    },
    localStorage: {setItem() { throw new Error('skin cannot persist business data'); }},
    _authState: 'checking', AUTH: null, view: 'knowledge',
    mainPane() { return '<main>original business content</main>'; },
    loginPage() { return '<main>original login</main>'; },
    registerPage() { return '<main>original registration</main>'; },
    setupPage() { return '<main>original onboarding</main>'; },
    render(...args) { calls.push(['render', this, args]); return 'original-render-result'; },
    openModal(...args) { calls.push(['openModal', this, args]); return 'original-modal-result'; },
    closeModal(...args) { calls.push(['closeModal', this, args]); },
    unreadCount: () => 0, notifList: () => '', kbReadiness: () => ({}),
    kbProgressInner: () => '<span>original readiness</span>', isLocked: () => false,
    regErr(message) { calls.push(['regErr', message]); },
    _authEscape: escape, opsIcon: () => '<svg></svg>',
    opsReceivingPanel(...args) { calls.push(['receiving', this, args]); return 'original-receiving'; },
    opsEntListV2(...args) { calls.push(['enterprises', this, args]); return 'original-enterprises'; },
    opsDemandResults(...args) { calls.push(['demands', this, args]); return 'original-demands'; },
    PROJECTS: {}, OPS_ENT: [], OPS_UI: {demands: {query: 'old', city: 'old', status: 'old'}},
    opsTab: 'overview',
    opsNavItem: id => ({label: id, icon: id}),
    opsHandler: (name, id) => `${name}(${JSON.stringify(id)})`,
    opsIsSubmittedDemand: (_key, project) => project.submitted === true,
    opsIntakeStatus: project => project.intakeStatus,
    opsVerificationRequests: project => project.verifications || [],
    opsReportRows: () => [], opsReportLabel: report => report.status,
    opsDate: () => 'offline date', opsPageHead: () => '',
    opsGo(id) { calls.push(['opsGo', id]); },
  };
  protectedNames.forEach(name => { sandbox[name] = () => { throw new Error(`skin invoked ${name}`); }; });
  const before = Object.fromEntries(protectedNames.map(name => [name, sandbox[name]]));
  Object.assign(sandbox, options.globals || {});
  sandbox.window = sandbox;
  sandbox.render.lastBusinessState = {reportId: 'preserve-me'};
  vm.createContext(sandbox);
  if(kind==='client'){
    const accountSource=fs.readFileSync(path.join(root,'frontend/index/script-02-sections/03.js'),'utf8');
    vm.runInContext(accountSource.slice(accountSource.indexOf('function currentAccountIdentity(){'),accountSource.indexOf('function _authEscape(')),sandbox);
  }
  vm.runInContext(sources[kind], sandbox, {filename: `full-skin-${kind}.js`});
  return {context: sandbox, calls, before, loadAgain() { vm.runInContext(sources[kind], sandbox); }};
}

test('both skins leave authentication, persistence, reports and submission handlers authoritative', () => {
  for (const kind of ['client', 'ops']) {
    const {context, before} = harness(kind);
    if (kind === 'client') assert.equal(typeof context.hxzClientSkin, 'object', 'exercise the installed adapter, not its unsupported-DOM exit');
    for (const [name, original] of Object.entries(before)) assert.equal(context[name], original, `${kind}: ${name}`);
  }
});

test('a client environment without template content retains the original application', () => {
  const {context, calls} = harness('client', {supportsTemplates: false});
  assert.equal(context.hxzClientSkin, undefined);
  assert.equal(context.render('unchanged'), 'original-render-result');
  assert.equal(context.openModal('unchanged'), 'original-modal-result');
  assert.deepEqual(calls.filter(call => call[0] === 'render').map(call => call[2]), [['unchanged']]);
  assert.deepEqual(calls.filter(call => call[0] === 'openModal').map(call => call[2]), [['unchanged']]);
});

test('client decoration delegates render and modal calls without dropping arguments, return values or cache', () => {
  const {context, calls} = harness('client');
  const receiver = {callSite: 'existing application'};
  assert.equal(context.render.call(receiver, 'report', 42), 'original-render-result');
  assert.equal(context.render.lastBusinessState.reportId, 'preserve-me');
  assert.equal(context.openModal.call(receiver, 'title', '<p>trusted business body</p>'), 'original-modal-result');
  const render = calls.find(call => call[0] === 'render');
  assert.equal(render[1], receiver);
  assert.deepEqual(render[2], ['report', 42]);
  const modal = calls.find(call => call[0] === 'openModal');
  assert.equal(modal[1], receiver);
  assert.deepEqual(modal[2], ['title', '<p>trusted business body</p>']);
});

test('client skin can be loaded twice without nesting presentation wrappers', () => {
  const {context, loadAgain} = harness('client');
  const before = [context.render, context.openModal, context.hxzClientSkin];
  loadAgain();
  assert.deepEqual([context.render, context.openModal, context.hxzClientSkin], before);
});

test('public authentication links wait for session resolution and apply only once', () => {
  const {context} = harness('client', {search: '?screen=register'});
  context.render();
  assert.equal(context.view, 'knowledge', 'a pending session cannot be rerouted');
  context._authState = 'anonymous';
  context.render();
  assert.equal(context.view, 'register');
  context.view = 'login';
  context.render();
  assert.equal(context.view, 'login', 'registration back button must remain effective');
});

test('authentication query parameters cannot replace a confirmed session or select arbitrary views', () => {
  for (const [search, auth] of [['?screen=register', {user: 'signed-in'}], ['?screen=settings', null]]) {
    const {context} = harness('client', {search});
    context._authState = 'ready'; context.AUTH = auth;
    context.render();
    assert.equal(context.view, 'knowledge');
  }
});

test('client topbar escapes account and city data and preserves real navigation handlers', () => {
  const {context} = harness('client');
  context.AUTH={user:'account',who:'<signed-in>',org:'Account org',scope:'project',role:'member',projKey:'a',projectKeys:['a']};context._authState='ready';
  const html = context.topbar({org: '<img onerror=bad()>', city: 'City<script>bad()</script>', topic: 'R&D', who: '<admin>'});
  assert.ok(!html.includes('<script>') && !html.includes('<img onerror'));
  assert.ok(html.includes('&lt;signed-in&gt;') && !html.includes('&lt;admin&gt;') && html.includes('R&amp;D'));
  assert.ok(html.includes('onclick="logout()"') && html.includes("go('settings')"));
  assert.ok(html.includes('href="/"') && html.includes('href="/ops"'));
});

test('client keeps the three primary modules in story order and their original navigation handlers', () => {
  let directDemands = 0;
  const {context, calls} = harness('client', {globals: {
    cur: 'city-workspace', industryAnalysisWorkspaceKey: key => key,
    openDirectDemandComposer() { directDemands++; },
  }});
  const navigationSource = fs.readFileSync(path.join(root, 'frontend/index/script-02-sections/10.js'), 'utf8');
  vm.runInContext(navigationSource.slice(navigationSource.indexOf('function go(v)'), navigationSource.indexOf('\nfunction bind(')), context);
  const html = context.sidebar();
  const primary = html.match(/<div class="client-nav-group"><p>招商工作流程<\/p>([\s\S]*?)<\/div>/);
  assert.ok(primary, 'all three modules belong to the same primary group');
  const buttons = Array.from(primary[1].matchAll(/<button\b[^>]*onclick="([^"]+)"[^>]*>[\s\S]*?<strong>([^<]+)<\/strong>[\s\S]*?<\/button>/g));
  assert.deepEqual(buttons.map(button => button[2]), ['城市智库', 'AI 匹配研判', '需求与建联']);
  assert.deepEqual(buttons.map(button => button[1]), ["go('knowledge')", "go('report')", "go('home')"]);
  assert.equal(html.includes('招商资料库'), false);
  assert.ok(html.indexOf('openDirectDemandComposer()') > html.indexOf('</nav>'), 'direct submission remains a secondary shortcut after the primary navigation');
  for (const [index, view] of ['knowledge', 'report', 'home'].entries()) {
    vm.runInContext(buttons[index][1], context);
    assert.equal(context.view, view);
    assert.match(context.sidebar(), new RegExp('aria-current="page" onclick="go\\(\'' + view + '\'\\)"'));
  }
  assert.equal(calls.filter(call => call[0] === 'render').length, 3);
  vm.runInContext('openDirectDemandComposer()', context);
  assert.equal(directDemands, 1);
  assert.equal(context.view, 'home');
});

test('story navigation still respects the existing knowledge readiness gate', () => {
  const {context, calls} = harness('client', {globals: {
    cur: 'city-workspace', industryAnalysisWorkspaceKey: key => key,
    isLocked: view => view === 'report' || view === 'home',
    kbReadiness: () => ({score: 40, confirmed: 1, total: 2, files: 1, color: '#2D5BE3'}),
  }});
  const navigationSource = fs.readFileSync(path.join(root, 'frontend/index/script-02-sections/10.js'), 'utf8');
  vm.runInContext(navigationSource.slice(navigationSource.indexOf('function go(v)'), navigationSource.indexOf('\nfunction bind(')), context);
  context.go('report');
  assert.equal(context.view, 'knowledge');
  let modal = calls.filter(call => call[0] === 'openModal').at(-1);
  assert.match(modal[2][0], /AI 匹配研判/);
  assert.match(modal[2][1], /城市智库/);
  assert.match(modal[2][2], /unlockView\('report'\)/, 'existing explicit unlock remains available');
  context.go('home');
  assert.equal(context.view, 'knowledge');
  modal = calls.filter(call => call[0] === 'openModal').at(-1);
  assert.match(modal[2][0], /需求与建联/);
  assert.equal(calls.filter(call => call[0] === 'render').length, 0);
});

test('registration steps retain field values and prevent advancing with incomplete current fields', () => {
  const {context, calls} = harness('client');
  const input = value => ({value, focus() { this.focused = true; }});
  const fields = [[input('code'), input('city')], [input('user'), input('')], [input('person')]];
  const sections = fields.map((values, i) => ({dataset: {registerStep: String(i)}, hidden: i !== 0, querySelectorAll: () => values}));
  const tabs = fields.map((_values, i) => ({dataset: {registerTab: String(i)}, setAttribute() {}, removeAttribute() {}}));
  const actions = Object.fromEntries(['Previous', 'Next', 'Submit'].map(name => [`clientRegister${name}`, {hidden: false}]));
  context.document.querySelector = selector => {
    const match = selector.match(/data-register-step="(\d)"/);
    return match ? (selector.endsWith('input:not(:disabled)') ? fields[Number(match[1])][0] : sections[Number(match[1])]) : null;
  };
  context.document.querySelectorAll = selector => selector === '[data-register-step]' ? sections : selector === '[data-register-tab]' ? tabs : [];
  context.document.getElementById = id => actions[id];
  context.hxzClientSkin.registerStep(2);
  assert.equal(context.hxzClientSkin.currentRegisterStep(), 1, 'cannot skip forward over account step');
  context.hxzClientSkin.registerStep(2);
  assert.equal(context.hxzClientSkin.currentRegisterStep(), 1);
  assert.equal(fields[1][1].focused, true);
  assert.equal(calls.at(-1)[1], '请先填写当前步骤的信息。');
  fields[1][1].value = 'existing-password-value';
  context.hxzClientSkin.registerStep(2);
  assert.equal(context.hxzClientSkin.currentRegisterStep(), 2);
  assert.equal(actions.clientRegisterSubmit.hidden, false);
  context.hxzClientSkin.registerStep(0);
  assert.equal(context.hxzClientSkin.currentRegisterStep(), 0);
  assert.deepEqual(fields[1].map(field => field.value), ['user', 'existing-password-value']);
});

test('operations adapters retain original renderer output when DOM parsing is unavailable', () => {
  const {context, calls} = harness('ops');
  const receiver = {existing: true};
  for (const [name, marker] of [['opsReceivingPanel', 'receiving'], ['opsEntListV2', 'enterprises'], ['opsDemandResults', 'demands']]) {
    assert.equal(context[name].call(receiver, 'selection', 8), `original-${marker}`);
    const call = calls.find(item => item[0] === marker);
    assert.equal(call[1], receiver);
    assert.deepEqual(call[2], ['selection', 8]);
  }
});

test('operations overview uses current submitted projects, verification status and actual report rows', () => {
  const {context} = harness('ops');
  context.PROJECTS = {
    visible: {submitted: true, intakeStatus: 'submitted', demandTitle: '<script>bad()</script>', city: '测试城', verifications: [{verificationRequest: {status: 'pending'}}]},
    internal: {submitted: false, intakeStatus: 'submitted', demandTitle: 'SHOULD_NOT_APPEAR'},
  };
  context.opsReportRows = () => [{city: '测试城', id: 'report-from-live-store', status: 'paused', ts: 1}];
  context.OPS_ENT = [{id: 'real-store-1'}, {id: 'real-store-2'}];
  const html = context.opsOverview();
  assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'));
  assert.ok(!html.includes('<script>') && !html.includes('SHOULD_NOT_APPEAR'));
  assert.ok(html.includes('report-from-live-store') && html.includes('报告已暂停'));
  assert.ok(html.includes('>2<small>家</small>'));
});

test('operations overview opens only submitted demands and resets only presentation filters', () => {
  const {context, calls} = harness('ops');
  const submitted = {submitted: true, city: '测试城', demandTitle: 'Keep exact business title'};
  context.PROJECTS = {valid: submitted, internal: {submitted: false, city: 'Other'}};
  context.hxzOpsOpenDemand('missing');
  context.hxzOpsOpenDemand('internal');
  assert.equal(calls.filter(call => call[0] === 'opsGo').length, 0);
  context.hxzOpsOpenDemand('valid');
  assert.equal(context.__opsProjOpen.valid, true);
  assert.equal(context.__opsCityOpen['测试城'], true);
  assert.deepEqual(context.OPS_UI.demands, {query: '', city: '', status: 'all'});
  assert.equal(context.PROJECTS.valid, submitted);
  assert.equal(submitted.demandTitle, 'Keep exact business title');
  assert.deepEqual(calls.at(-1), ['opsGo', 'demands']);
});
