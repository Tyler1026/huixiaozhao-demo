'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dir = path.join(__dirname, '..', 'frontend', 'index', 'script-02-sections');
const read = name => fs.readFileSync(path.join(dir, name + '.js'), 'utf8');
function declaration(name, fn) {
  const source = read(name), start = source.indexOf('function ' + fn + '(');
  assert.ok(start >= 0, fn);
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}
const flush = async () => {for (let i = 0; i < 30; i++) await Promise.resolve();};

// Deferred headers and stream deliberately ignore abort, so stale-result tests
// exercise the production identity guards as well as AbortController calls.
function responseFeed() {
  const queue = [];
  let waiter, cancelled = 0;
  function deliver(value) {
    if (waiter) {const take = waiter; waiter = null; take(value);}
    else queue.push(value);
  }
  const reader = {
    read() {return queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => {waiter = resolve;});},
    cancel() {cancelled++; return Promise.resolve();},
  };
  return {
    response: {ok: true, body: {getReader: () => reader, cancel() {cancelled++; return Promise.resolve();}}},
    event(value) {deliver({done: false, value: new TextEncoder().encode('data: ' + JSON.stringify(value) + '\n\n')});},
    complete(options) {
      this.event({choices: [{delta: {content: JSON.stringify(options)}}]});
      this.event({choices: [{delta: {}, finish_reason: 'stop'}]});
      deliver({done: true});
    },
    eof() {deliver({done: true});},
    cancelled: () => cancelled,
  };
}

function harness() {
  const nodes = {}, requests = [], timers = new Map(), toasts = [];
  let sequence = 0, saves = 0;
  class Element {
    constructor(id = '') {this.id = id; this.style = {}; this.disabled = false; this.textContent = ''; this.classList = {toggle() {}};}
    set innerHTML(value) {
      this.html = String(value);
      if (this.id === 'onbModalHost') {
        for (const key of Object.keys(nodes)) if (key !== 'onbModalHost' && /^onb/.test(key)) delete nodes[key];
        for (const match of this.html.matchAll(/id="([^"]+)"/g)) nodes[match[1]] = new Element(match[1]);
      }
    }
    get innerHTML() {return this.html || '';}
    addEventListener() {}
  }
  const c = {
    console, Promise, Date, JSON, Array, String, TextDecoder, AbortController,
    AUTH: {user: 'owner', scope: 'project', projectKeys: ['a', 'b'], projKey: 'a'},
    _authState: 'ready', _authEpoch: 3, cur: 'a', view: 'settings',
    PROJECTS: {a: {city: '随州市'}, b: {city: '武汉市'}, other: {city: '随州市'}},
    _authWorkspaceOf(key) {return c.AUTH.projectKeys.includes(key) ? key : null;},
    setTimeout(fn, ms) {const id = ++sequence; timers.set(id, {fn, ms}); return id;},
    clearTimeout(id) {timers.delete(id);},
    persist() {saves++;}, toast(message) {toasts.push(message);},
    render() {c.onbCancelHiddenRequests();},
    buildKBCorpus() {throw new Error('Onboarding must not read legacy browser corpus');},
    kbSearch() {throw new Error('Onboarding context belongs to the server');},
    fetch(url, options) {
      let resolve;
      const promise = new Promise(done => {resolve = done;});
      requests.push({url, options, body: JSON.parse(options.body), resolve});
      return promise;
    },
    document: {
      body: {classList: {toggle() {}}, appendChild(node) {nodes[node.id] = node;}},
      createElement() {return new Element();},
      getElementById(id) {return nodes[id] || null;},
      addEventListener() {}, removeEventListener() {},
    },
  };
  c.window = c;
  vm.createContext(c);
  const source = read('08');
  vm.runInContext(source.slice(0, source.indexOf('/* 创建项目：')), c);
  vm.runInContext(declaration('12-tail', 'editOnboarding'), c);
  return {
    c, nodes, requests, timers, toasts, saves: () => saves,
    open(existing = null) {c.openOnboarding(existing, answer => {c.PROJECTS[c.cur].onboarding = answer; c.persist();}, c.PROJECTS[c.cur].city, true);},
    timeout() {for (const [id, timer] of [...timers]) {timers.delete(id); timer.fn();}},
  };
}

test('opening settings shows an editable form and performs zero requests', () => {
  const h = harness();
  h.c.editOnboarding();
  assert.equal(h.requests.length, 0);
  assert.match(h.nodes.onbBody.innerHTML, /有标准厂房可直接入驻/);
  assert.match(h.nodes.onbModalHost.innerHTML, /onclick="fetchOnbRecommend\(\)"/);
  assert.match(h.nodes.onbModalHost.innerHTML, /保存偏好/);
  assert.doesNotMatch(h.nodes.onbModalHost.innerHTML, /开始分析/);
  assert.equal(h.nodes.onbSubmitBtn.disabled, false);
  assert.equal(h.timers.size, 0);
  h.c.setOnbCustom('industry', '本次手填方向');
  h.c.submitOnboarding();
  assert.equal(h.saves(), 1);
  assert.equal(h.c.PROJECTS.a.onboarding.__custom.industry, '本次手填方向');
  assert.equal(h.requests.length, 0);
});

test('existing selections and custom values survive manual editing and save once', () => {
  const h = harness();
  h.c.PROJECTS.a.onboarding = {park: ['已有园区'], industry: ['已有方向', '手填内容'], __custom: {industry: '手填内容'}};
  h.c.editOnboarding();
  assert.match(h.nodes.onbBody.innerHTML, /已有园区/);
  assert.match(h.nodes.onbBody.innerHTML, /value="手填内容"/);
  h.c.submitOnboarding();
  assert.deepEqual(Array.from(h.c.PROJECTS.a.onboarding.industry), ['已有方向', '手填内容']);
  assert.equal(h.c.PROJECTS.a.onboarding.__custom.industry, '手填内容');
  assert.equal(h.saves(), 1);
  assert.equal(h.requests.length, 0);
});

test('only explicit request uses the authorized key, sends no client corpus, and prevents duplicates', async () => {
  const h = harness(); h.open();
  h.c.toggleOnb(3, '已有选择'); h.c.setOnbCustom('park', '自填园区');
  const pending = h.c.fetchOnbRecommend();
  h.c.fetchOnbRecommend();
  assert.equal(h.requests.length, 1);
  const request = h.requests[0];
  assert.equal(request.body.projectKey, 'a'); assert.equal(request.body.city, '随州市');
  assert.equal(request.body.mode, 'onboard_options');
  assert.equal(Object.hasOwn(request.body, 'chunks'), false);
  assert.equal(Object.hasOwn(request.body, 'history'), false);
  assert.equal(h.nodes.onbRecommendBtn.disabled, true);
  assert.equal(h.nodes.onbSubmitBtn.disabled, false);
  const feed = responseFeed(); request.resolve(feed.response); await flush();
  feed.complete({industry: ['推荐方向']}); await pending;
  assert.match(h.nodes.onbBody.innerHTML, /推荐方向/);
  assert.match(h.nodes.onbBody.innerHTML, /已有选择/);
  assert.match(h.nodes.onbBody.innerHTML, /value="自填园区"/);
  h.c.fetchOnbRecommend(); assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 0); assert.equal(h.saves(), 0);
});

test('closing before response headers cancels and cannot revive a reopened form', async () => {
  const h = harness(); h.open(); const old = h.c.fetchOnbRecommend();
  h.c.closeOnboarding();
  assert.equal(h.requests[0].options.signal.aborted, true); assert.equal(h.timers.size, 0);
  assert.equal(h.nodes.onbBody, undefined); assert.equal(h.saves(), 0);
  h.open(); const feed = responseFeed(); h.requests[0].resolve(feed.response);
  feed.complete({industry: ['旧请求内容']}); await old;
  assert.equal(feed.cancelled(), 1);
  assert.doesNotMatch(h.nodes.onbBody.innerHTML, /旧请求内容/);
  assert.equal(h.nodes.onbRecommendBtn.disabled, false);
});

test('late chunks from a closed request cannot replace a new request in the same city', async () => {
  const h = harness(); h.open(); const old = h.c.fetchOnbRecommend();
  const oldFeed = responseFeed(); h.requests[0].resolve(oldFeed.response); await flush();
  h.c.closeOnboarding(); h.open(); const latest = h.c.fetchOnbRecommend();
  const currentFeed = responseFeed(); h.requests[1].resolve(currentFeed.response); await flush();
  oldFeed.complete({industry: ['过期同城选项']}); await old;
  assert.equal(oldFeed.cancelled(), 1);
  assert.equal(h.nodes.onbRecommendBtn.disabled, true);
  currentFeed.complete({industry: ['当前选项']}); await latest;
  assert.match(h.nodes.onbBody.innerHTML, /当前选项/);
  assert.doesNotMatch(h.nodes.onbBody.innerHTML, /过期同城选项/);
});

test('production render cancels immediately after city or same-city workspace switch', async () => {
  for (const next of ['b', 'other']) {
    const h = harness(); h.open(); const pending = h.c.fetchOnbRecommend();
    h.c.PROJECTS.other.city = '随州市';
    h.c.cur = next; h.c._verifyInProgress = true;
    vm.runInContext(declaration('05', 'render'), h.c); h.c.render();
    assert.equal(h.requests[0].options.signal.aborted, true);
    assert.equal(h.nodes.onbBody, undefined); assert.equal(h.timers.size, 0);
    const feed = responseFeed(); h.requests[0].resolve(feed.response); feed.complete({park: ['旧城市园区']}); await pending;
    assert.equal(h.saves(), 0); assert.equal(h.c.PROJECTS[next].onboarding, undefined);
  }
});

test('authentication reset cancels a pending request and closes the form', async () => {
  const h = harness(); h.open(); const pending = h.c.fetchOnbRecommend();
  h.c.saveAuth = () => {}; h.c.localStorage = {removeItem() {}};
  vm.runInContext(declaration('03', '_authResetView'), h.c); h.c._authResetView();
  assert.equal(h.requests[0].options.signal.aborted, true);
  assert.equal(h.nodes.onbBody, undefined); assert.equal(h.timers.size, 0);
  const feed = responseFeed(); h.requests[0].resolve(feed.response); await pending;
});

test('timeout cancels the stream while leaving manual answers usable and retry explicit', async () => {
  const h = harness(); h.open(); h.c.setOnbCustom('industry', '保留的手填内容');
  const pending = h.c.fetchOnbRecommend(), feed = responseFeed();
  h.requests[0].resolve(feed.response); await flush(); h.timeout();
  assert.equal(h.requests[0].options.signal.aborted, true); assert.equal(feed.cancelled(), 1);
  assert.equal(h.nodes.onbSubmitBtn.disabled, false); assert.equal(h.nodes.onbRecommendBtn.disabled, false);
  feed.complete({industry: ['超时内容']}); await pending;
  assert.doesNotMatch(h.nodes.onbBody.innerHTML, /超时内容/);
  h.c.submitOnboarding(); assert.equal(h.saves(), 1);
  assert.equal(h.c.PROJECTS.a.onboarding.__custom.industry, '保留的手填内容');
});

test('saving while a recommendation is pending aborts it and persists only manual answers', async () => {
  const h = harness(); h.c.editOnboarding(); h.c.setOnbCustom('industry', '手填优先');
  const pending = h.c.fetchOnbRecommend(), feed = responseFeed();
  h.requests[0].resolve(feed.response); await flush(); h.c.submitOnboarding();
  assert.equal(h.requests[0].options.signal.aborted, true); assert.equal(h.saves(), 1);
  feed.complete({industry: ['迟到的推荐']}); await pending;
  assert.deepEqual(Array.from(h.c.PROJECTS.a.onboarding.industry), ['手填优先']);
  assert.equal(h.saves(), 1);
});

test('unauthorized workspace and missing workspace cannot issue recommendations', async () => {
  const h = harness(); h.c.cur = 'other'; h.open(); await h.c.fetchOnbRecommend();
  assert.equal(h.requests.length, 0); assert.equal(h.nodes.onbRecommendBtn.disabled, true);
  h.c.cur = null; h.c.openOnboarding(null, () => {}, '新城市', true); await h.c.fetchOnbRecommend();
  assert.equal(h.requests.length, 0); assert.equal(h.nodes.onbSubmitBtn.disabled, false);
});

test('incomplete and failed streams retain the form and allow only explicit retries', async () => {
  for (const fail of [true, false]) {
    const h = harness(); h.open(); const pending = h.c.fetchOnbRecommend(), feed = responseFeed();
    h.requests[0].resolve(feed.response); await flush();
    if (fail) feed.event({error: {message: 'PROVIDER_PRIVATE_ERROR'}});
    else {feed.event({choices: [{delta: {content: '{"industry":["不完整内容"]}'}}]}); feed.eof();}
    await pending;
    assert.equal(h.requests[0].options.signal.aborted, true);
    assert.equal(feed.cancelled(), 1);
    assert.doesNotMatch(h.nodes.onbBody.innerHTML, /不完整内容|PROVIDER_PRIVATE_ERROR/);
    assert.equal(h.requests.length, 1); assert.equal(h.timers.size, 0);
    assert.equal(h.nodes.onbRecommendBtn.disabled, false); assert.equal(h.nodes.onbSubmitBtn.disabled, false);
  }
});

test('recommendation and custom labels are escaped before rendering', async () => {
  const h = harness(); h.open(); h.c.setOnbCustom('park', '" onfocus="unsafe');
  const pending = h.c.fetchOnbRecommend(), feed = responseFeed(); h.requests[0].resolve(feed.response); await flush();
  feed.complete({industry: ['<img src=x onerror=unsafe>']}); await pending;
  assert.doesNotMatch(h.nodes.onbBody.innerHTML, /<img|value="" onfocus/);
  assert.match(h.nodes.onbBody.innerHTML, /&lt;img/);
});

test('download empty-state guidance matches city knowledge or industry view', () => {
  const h = harness(); h.c.reportExportContext = () => null;
  vm.runInContext(declaration('08', 'showDownloadReport'), h.c);
  h.c.view = 'knowledge'; h.c.showDownloadReport(); assert.match(h.toasts.at(-1), /城市智库暂无已发布的城市报告/);
  h.c.view = 'report'; h.c.showDownloadReport(); assert.match(h.toasts.at(-1), /当前方向暂无报告/);
});
