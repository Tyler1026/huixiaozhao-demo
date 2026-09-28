/**
 * tests/test_demand_submit.cjs — submitDemand() 保存确认回归测试
 *
 * 背景（缺陷）:
 *   submitDemand() 在 POST /api/sync 返回之前就 toast('✓ 招引需求已提交…')，
 *   而同步 fetch 的 .catch(function(){}) 吞掉一切错误 => HTTP 4xx/5xx、{ok:false}、
 *   网络失败（offline / DNS / CORS）全部静默，用户看到“已提交”但服务端从未落库，
 *   刷新即丢失、管理端永远看不到。这正是「刷新后消失 / 管理端不同步」的根因。
 *
 * 方法:
 *   不 mock 整个文件，而是用 Node 内置 vm 从真实 index.html 里提取
 *   submitDemand() 函数源码（以及它依赖的最小辅助函数 _findExistingDemand /
 *   _normalizeTopic），在受控沙箱里以真实 DOM 存根（#toast / #toastMsg）执行，
 *   再用可编程的 fetch 存根驱动 pending / HTTP 失败 / ok:false / 网络失败 / ok:true
 *   五条路径，断言用户可见提示与数据语义。
 *
 * 运行: node --test tests/test_demand_submit.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_HTML = path.join(__dirname, '..', 'index.html');

// ─────────────────────────────────────────────────────────────────────────────
// 1. 从真实 index.html 提取函数源码（提取失败 => 测试自身报错，绝不静默通过）
// ─────────────────────────────────────────────────────────────────────────────
const html = fs.readFileSync(INDEX_HTML, 'utf8');

/** 从 startMarker 处起做花括号配平扫描，返回完整函数声明文本。 */
function extractFunction(src, startMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `未在 index.html 中找到 ${startMarker}`);
  let i = src.indexOf('{', start + startMarker.length - 1);
  assert.ok(i >= 0, `${startMarker} 未找到函数体`);
  let depth = 0;
  let inS = null; // 当前字符串定界符
  let inLineComment = false;
  let inBlockComment = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    const n = src[j + 1];
    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && n === '/') { inBlockComment = false; j++; }
      continue;
    }
    if (inS) {
      if (c === '\\') { j++; continue; }
      if (c === inS) inS = null;
      continue;
    }
    if (c === '/' && n === '/') { inLineComment = true; j++; continue; }
    if (c === '/' && n === '*') { inBlockComment = true; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  throw new Error(`${startMarker} 花括号未配平`);
}

const SRC_SUBMIT_DEMAND = extractFunction(html, 'function submitDemand()');
const SRC_FIND_EXISTING = extractFunction(html, 'function _findExistingDemand(');
const SRC_NORMALIZE_TOPIC = extractFunction(html, 'function _normalizeTopic(');
// submitDemand 依赖的取当前项目函数（真实源码，避免测试自造产品逻辑）
const SRC_P = extractFunction(html, 'function P()');

// 真实源码自检：确认我们测的确实是待修复的旧行为（旧代码里成功提示是无条件的）
assert.ok(/toast\(/.test(SRC_SUBMIT_DEMAND), 'submitDemand 应包含 toast 调用');
assert.ok(
  /api\/sync/.test(SRC_SUBMIT_DEMAND),
  'submitDemand 应包含 /api/sync 同步调用'
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. 受控沙箱：真实函数 + DOM 存根 + 可编程 fetch 存根
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {{ ok?: boolean, status?: number, body?: any, rejectNetwork?: boolean }} opts
 *        fetch 行为描述。omit => fetch 立即成功返回 {ok:true, body:{ok:true}}
 */
function makeEnv(opts = {}) {
  const state = {
    PROJECTS: {},
    REPORTSTATE: {},
    DEMANDS: [],
    cur: 'proj_parent',
    persisted: 0,
    toasts: [],
    consoleLogs: [],
    consoleWarns: [],
    fetchCalls: [],
    /** 已完成（settled）的 fetch URL 数 */
    settled: 0,
  };

  // 父项目（研判对象）。注意 submitDemand 只读取 p.topic / p.city / p.org /
  // p.who / p.kb，不修改父项目本身。
  state.PROJECTS['proj_parent'] = {
    id: 'proj_parent',
    city: '随州',
    org: '随州市招商局',
    who: '张科长',
    topic: '香菇精深加工补链',
    stage: 2,
    kb: [{ id: 'k1', title: '随州香菇产业底数' }],
  };
  // 当前方向的研判报告（submitDemand 依赖 rs 存在）
  state.REPORTSTATE['proj_parent'] = {
    topic: '香菇精深加工补链',
    phase: 2,
    text: '随州香菇精深加工环节薄弱，缺少多糖提取与出口品牌……',
    scoreByTopic: { '香菇精深加工补链': 78 },
  };

  const dom = {};
  function makeEl(id) {
    dom[id] = {
      id,
      textContent: '',
      innerHTML: '',
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); },
        remove(c) { this._s.delete(c); },
        contains(c) { return this._s.has(c); },
      },
    };
    return dom[id];
  }
  makeEl('toast');
  makeEl('toastMsg');

  // fetch 存根：记录调用，返回可控 promise
  let resolveFetch = null;
  const fetchStub = function (url, init) {
    state.fetchCalls.push({ url, init, ts: Date.now() });
    if (opts.rejectNetwork) {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    if (opts.manual) {
      return new Promise(function (res) { resolveFetch = res; });
    }
    return Promise.resolve({
      ok: opts.ok !== undefined ? opts.ok : true,
      status: opts.status !== undefined ? opts.status : 200,
      json: function () {
        return Promise.resolve(opts.body !== undefined ? opts.body : { ok: true });
      },
    });
  };

  const sandbox = {
    PROJECTS: state.PROJECTS,
    REPORTSTATE: state.REPORTSTATE,
    DEMANDS: state.DEMANDS,
    cur: state.cur,
    window: {},
    document: {
      getElementById(id) { return dom[id] || null; },
    },
    $: function (sel) {
      const id = String(sel).replace(/^#/, '');
      return dom[id] || null;
    },
    LS_KEY: 'huixiaozhao_kb_v1',
    localStorage: {
      _m: {},
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null; },
      setItem(k, v) { this._m[k] = String(v); },
    },
    fetch: fetchStub,
    setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
    clearTimeout: clearTimeout,
    Date: Date,
    JSON: JSON,
    Math: Math,
    console: {
      log: function () { state.consoleLogs.push(Array.prototype.join.call(arguments, ' ')); },
      warn: function () { state.consoleWarns.push(Array.prototype.join.call(arguments, ' ')); },
      error: function () { state.consoleWarns.push(Array.prototype.join.call(arguments, ' ')); },
      info: function () {},
    },
    // 测试替身：只记录调用，不改变 data 语义
    persist: function () {
      state.persisted++;
      sandbox.localStorage.setItem(sandbox.LS_KEY, JSON.stringify({
        PROJECTS: state.PROJECTS, REPORTSTATE: state.REPORTSTATE, DEMANDS: state.DEMANDS
      }));
    },
    toast: function (t) { state.toasts.push(String(t)); dom.toastMsg.textContent = String(t); },
    topicScore: function () { return 78; },
    render: function () {},
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(
    SRC_NORMALIZE_TOPIC + '\n' + SRC_FIND_EXISTING + '\n' + SRC_P + '\n' + SRC_SUBMIT_DEMAND + '\n',
    sandbox,
    { filename: 'index.html<extracted>' }
  );

  return {
    state,
    dom,
    sandbox,
    /** 调用真实 submitDemand() */
    submit() { return vm.runInContext('submitDemand()', sandbox); },
    /** 测试替身手动触发持久化（与被测函数内部调用解耦） */
    persist() { vm.runInContext('persist()', sandbox); },
    /** 让 pending 的 fetch 落地 */
    settle(response) {
      assert.ok(resolveFetch, '没有 pending 的 fetch 可落地');
      resolveFetch(response);
    },
    fireToastTimeout() { /* 由真实 setTimeout 驱动，无需手动 */ },
    // 便捷访问
    successToasts() {
      return state.toasts.filter(function (t) { return /已提交|已递交|提交成功|✓/.test(t); });
    },
    failureToasts() {
      return state.toasts.filter(function (t) { return /失败|未同步|未成功|重试|错误/.test(t); });
    },
    demandSnapshots() { return JSON.parse(JSON.stringify(state.DEMANDS)); },
  };
}

/** 等待微任务队列排空（fetch promise 链路 settle）。 */
async function flush(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
  await new Promise(function (r) { setImmediate(r); });
  for (let i = 0; i < times; i++) await Promise.resolve();
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 测试用例
// ─────────────────────────────────────────────────────────────────────────────

test('R1 [红→绿] pending 阶段不得提示成功：服务端确认前不能出现“已提交”', async () => {
  const env = makeEnv({ manual: true });
  env.submit();
  // 服务端尚未返回
  assert.strictEqual(
    env.successToasts().length,
    0,
    `服务端确认前不应出现成功提示，实际: ${JSON.stringify(env.state.toasts)}`
  );
  // 等待请求启动，但不返回服务端响应。
  await flush();
  assert.strictEqual(env.state.fetchCalls.length, 1);
  assert.strictEqual(env.successToasts().length, 0);
  // 落地一个成功响应，避免悬挂 promise
  env.settle({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  await flush();
});

test('R2 HTTP 5xx：失败必须可见（非静默），且不得提示成功', async () => {
  const env = makeEnv({ ok: false, status: 500, body: { ok: false, error: 'boom' } });
  env.submit();
  await flush();
  assert.strictEqual(
    env.successToasts().length,
    0,
    `HTTP 500 时不应提示成功，实际: ${JSON.stringify(env.state.toasts)}`
  );
  assert.ok(
    env.failureToasts().length >= 1,
    `HTTP 500 必须给出可见失败提示，实际: ${JSON.stringify(env.state.toasts)}`
  );
});

test('R3 HTTP 200 但 {ok:false}：按失败处理，可见且不提示成功', async () => {
  const env = makeEnv({ ok: true, status: 200, body: { ok: false, rejected: 'empty-payload' } });
  env.submit();
  await flush();
  assert.strictEqual(
    env.successToasts().length,
    0,
    `{ok:false} 不应提示成功，实际: ${JSON.stringify(env.state.toasts)}`
  );
  assert.ok(
    env.failureToasts().length >= 1,
    `{ok:false} 必须给出可见失败提示，实际: ${JSON.stringify(env.state.toasts)}`
  );
});

test('R4 网络失败（fetch reject）：必须可见，且不得提示成功', async () => {
  const env = makeEnv({ rejectNetwork: true });
  env.submit();
  await flush();
  assert.strictEqual(
    env.successToasts().length,
    0,
    `网络失败不应提示成功，实际: ${JSON.stringify(env.state.toasts)}`
  );
  assert.ok(
    env.failureToasts().length >= 1,
    `网络失败必须给出可见失败提示，实际: ${JSON.stringify(env.state.toasts)}`
  );
});

test('R5 {ok:true}：确认后才提示成功', async () => {
  const env = makeEnv({ ok: true, status: 200, body: { ok: true } });
  env.submit();
  await flush();
  assert.ok(
    env.successToasts().length >= 1,
    `服务端 ok:true 后应提示成功，实际: ${JSON.stringify(env.state.toasts)}`
  );
  assert.strictEqual(
    env.failureToasts().length,
    0,
    `成功路径不应出现失败提示，实际: ${JSON.stringify(env.state.toasts)}`
  );
});

test('D1 重复点击（第二击）：数据语义不变——不新建 isDemand 项目、不追加 DEMANDS', async () => {
  const env = makeEnv({ ok: true, status: 200, body: { ok: true } });
  env.submit();
  await flush();

  const projCountAfterFirst = Object.keys(env.state.PROJECTS).length;
  const demandCountAfterFirst = env.state.DEMANDS.length;
  const firstDemand = JSON.parse(JSON.stringify(env.state.DEMANDS[0] || null));
  const firstKeys = Object.keys(env.state.PROJECTS).slice();

  // 第二次点击（同城同方向）→ 幂等分支
  env.submit();
  await flush();

  assert.strictEqual(
    Object.keys(env.state.PROJECTS).length,
    projCountAfterFirst,
    '重复点击不应新建项目'
  );
  assert.strictEqual(
    env.state.DEMANDS.length,
    demandCountAfterFirst,
    '重复点击不应重复追加 DEMANDS'
  );
  assert.deepStrictEqual(
    Object.keys(env.state.PROJECTS).slice(),
    firstKeys,
    '重复点击不应改变项目 key 集合'
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(env.state.DEMANDS[0])),
    firstDemand,
    '已有 DEMANDS 记录语义必须保持不变'
  );
  // 幂等分支应给用户解释（现有行为：提示已存在）
  assert.ok(
    env.state.toasts.some(function (t) { return /已提交|已存在|撤回/.test(t); }),
    `重复点击应给出明确提示，实际: ${JSON.stringify(env.state.toasts)}`
  );
});

test('D2 首次提交的数据语义：isDemand 项目字段、DEMANDS 记录、persist 调用均保持', async () => {
  const env = makeEnv({ ok: true, status: 200, body: { ok: true } });
  env.submit();
  await flush();

  const newKeys = Object.keys(env.state.PROJECTS).filter(function (k) {
    return k !== 'proj_parent';
  });
  assert.strictEqual(newKeys.length, 1, '首次提交应恰好新建 1 个 isDemand 项目');
  const child = env.state.PROJECTS[newKeys[0]];
  assert.strictEqual(child.isDemand, true);
  assert.strictEqual(child.stage, 3);
  assert.strictEqual(child.city, '随州');
  assert.strictEqual(child.topic, '香菇精深加工补链');
  assert.ok(Array.isArray(child.stageLog) && child.stageLog.length === 1,
    'stageLog 语义：应记录一次 stage 2→3 递交日志');
  assert.strictEqual(child.stageLog[0].from, 2);
  assert.strictEqual(child.stageLog[0].to, 3);

  assert.strictEqual(env.state.DEMANDS.length, 1, '首次提交应恰好追加 1 条 DEMANDS');
  const d = env.state.DEMANDS[0];
  assert.strictEqual(d.projKey, newKeys[0]);
  assert.strictEqual(d.city, '随州');
  assert.strictEqual(d.topic, '香菇精深加工补链');
  assert.strictEqual(d.res, 'none');

  // 子项目报告复制语义保留
  const rs = env.state.REPORTSTATE[newKeys[0]];
  assert.ok(rs, '应复制 REPORTSTATE 给子项目');
  assert.strictEqual(rs.topic, '香菇精深加工补链');
  assert.strictEqual(rs.phase, 2);

  assert.ok(env.state.persisted >= 1, '必须调用 persist()（保留已有持久化流程）');
  assert.strictEqual(env.state.fetchCalls.length, 1, '应发起 1 次 /api/sync 同步');
  assert.strictEqual(env.state.fetchCalls[0].url, '/api/sync');
  assert.strictEqual(env.state.fetchCalls[0].init.method, 'POST');
});

test('D3 同步失败时仍保留本地数据 + persist（离线可撤回，不破坏已有语义）', async () => {
  const env = makeEnv({ rejectNetwork: true });
  env.submit();
  await flush();
  assert.strictEqual(env.state.persisted >= 1, true, '同步失败也要本地持久化');
  assert.strictEqual(env.state.DEMANDS.length, 1, '本地需求记录必须保留');
  const childKey = Object.keys(env.state.PROJECTS).filter(function (k) {
    return k !== 'proj_parent';
  });
  assert.strictEqual(childKey.length, 1, '本地 isDemand 项目必须保留');
});

test('D4 失败后重试复用需求，成功后释放请求锁', async () => {
  const opts = { rejectNetwork: true };
  const env = makeEnv(opts);
  await env.submit();
  opts.rejectNetwork = false;
  await env.submit();
  assert.strictEqual(env.state.fetchCalls.length, 2);
  assert.strictEqual(env.state.DEMANDS.length, 1);
  assert.strictEqual(env.successToasts().length, 1);
  assert.strictEqual(Object.keys(env.sandbox.window._demandSyncPending).length, 0);
});

test('D5 旧代际请求被拒绝时不能显示成功', async () => {
  const env = makeEnv({ body: { ok: false, rejected: 'stale-generation' } });
  await env.submit();
  assert.strictEqual(env.successToasts().length, 0);
  assert.ok(env.failureToasts().length > 0);
  assert.strictEqual(Object.keys(env.sandbox.window._demandSyncPending).length, 0);
});
