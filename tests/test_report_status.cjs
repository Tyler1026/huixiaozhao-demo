const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '../frontend/ops/script-03-sections', name), 'utf8');

function harness({requests = [], health = {report_engine: {configured: true}}, healthFailure = false} = {}) {
  const intervals = [], calls = [];
  let renders = 0;
  const context = {
    Date, Math, Promise, window: {}, setTimeout, clearTimeout,
    setInterval: (fn, delay) => intervals.push({fn, delay}),
    localStorage: {getItem: () => null, setItem() {}},
    render: () => renders++, toast() {},
    fetch: async (url, options) => {
      calls.push({url, options});
      if (url === '/health') {
        if (healthFailure) throw new Error('offline');
        return {ok: true, json: async () => health};
      }
      return {ok: true, json: async () => ({REPORT_REQUESTS: requests})};
    },
  };
  vm.createContext(context);
  vm.runInContext(read('03.js') + '\n' + read('05.js'), context);
  context.REPORT_REQUESTS = requests.map(r => ({province: '湖北', city: '随州', by: '管理端', ts: 1, ...r}));
  return {context, calls, poll: () => intervals.find(x => x.delay === 30000).fn(), renders: () => renders};
}

test('independent Word completion stays distinct from confirmed RAG publication', () => {
  const h = harness({requests: [{id: 'report', engine: 'full-v1', status: 'done', chunks: 42, pushed: false, files: [{kind: 'full'}]}]});
  let html = h.context.rrPanel();
  assert.ok(html.includes('Word 已生成，待发布'));
  assert.ok(!html.includes('已入库'));
  assert.ok(!html.includes('RAG已初始化'));
  assert.ok(html.includes("downloadReqFile('report','full')"));
  assert.ok(html.includes("pushReportToRag('report',this)"));
  h.context.REPORT_REQUESTS[0].pushRequested = true;
  html = h.context.rrPanel();
  assert.ok(html.includes('Word已生成·发布中'));
  assert.ok(!html.includes('已入库'));
  h.context.REPORT_REQUESTS[0].pushed = true;
  html = h.context.rrPanel();
  assert.ok(html.includes('智库材料 42 条已入库'));
  assert.ok(html.includes('RAG已发布'));
});

test('unpublished historical Word remains downloadable and needs regeneration even after an old push request', async () => {
  for (const pushRequested of [false, true]) {
    const h = harness({requests: [{id: 'historical', status: 'done', chunks: 7, pushRequested, files: [{kind: 'full'}]}]});
    const html = h.context.rrPanel();
    assert.ok(html.includes('历史 Word 可下载，需重新生成后发布'));
    assert.ok(html.includes("downloadReqFile('historical','full')"));
    assert.ok(!html.includes('RAG已初始化'));
    assert.ok(!html.includes('已入库'));
    assert.ok(!html.includes('推送中'));
    assert.ok(!html.includes("pushReportToRag('historical',this)"));
    await h.poll();
    assert.equal(h.calls.length, 0);
  }
});

test('published historical reports retain their confirmed knowledge status', () => {
  const h = harness({requests: [{id: 'historical', status: 'done', chunks: 7, pushed: true}]});
  const html = h.context.rrPanel();
  assert.ok(html.includes('RAG已初始化'));
  assert.ok(html.includes('智库材料 7 条已入库'));
  assert.ok(!html.includes('需重新生成'));
});

test('configuration failure explains retained work and requires administrator repair', () => {
  const h = harness({requests: [{id: 'failed', engine: 'full-v1', status: 'failed', failureCode: 'configuration', failReason: 'HXZ_MODEL_KEY secret'}]});
  const html = h.context.rrPanel();
  assert.ok(html.includes('配置/认证异常·待管理员处理'));
  assert.ok(html.includes('已完成成果保留，需管理员处理后接续'));
  assert.ok(!html.includes('失败·可重试'));
  assert.ok(!html.includes('HXZ_MODEL_KEY'));
  assert.ok(!html.includes('secret'));
});

test('pending independent reports poll safe health readiness without changing their contract', async () => {
  const h = harness({requests: [{id: 'pending', engine: 'full-v1', status: 'pending'}], health: {report_engine: {configured: false, missing: ['HXZ_MODEL_KEY'], credential: 'secret'}}});
  await h.poll();
  const html = h.context.rrPanel();
  assert.ok(html.includes('报告服务未就绪'));
  assert.ok(html.includes('申请已保存，待管理员完成报告服务配置后自动开始'));
  assert.ok(html.includes("cancelReportRequest('pending',this)"));
  assert.equal(h.context.REPORT_REQUESTS[0].status, 'pending');
  assert.equal(h.calls.filter(c => c.url === '/health').length, 1);
  assert.ok(h.calls.every(c => c.options.headers['X-HXZ-Report-Client'] === 'website'));
  assert.deepEqual(JSON.parse(JSON.stringify(h.context._rrEngineHealth)), {configured: false});
  assert.ok(!html.includes('HXZ_MODEL_KEY'));
  assert.ok(!html.includes('secret'));
  assert.equal(h.renders(), 1);
});

test('ready health removes the not-ready label and unknown health never fabricates a failure', async () => {
  const ready = harness({requests: [{id: 'pending', engine: 'full-v1', status: 'pending'}]});
  ready.context._rrEngineHealth = {configured: false};
  await ready.poll();
  assert.ok(!ready.context.rrPanel().includes('报告服务未就绪'));
  const offline = harness({requests: [{id: 'pending', engine: 'full-v1', status: 'pending'}], healthFailure: true});
  offline.context._rrEngineHealth = {configured: false};
  await offline.poll();
  assert.equal(offline.context._rrEngineHealth, null);
  assert.equal(offline.context.REPORT_REQUESTS[0].status, 'pending');
  assert.ok(!offline.context.rrPanel().includes('报告服务未就绪'));
});

test('a completed report keeps polling until its requested RAG publication is confirmed', async () => {
  const requests = [{id: 'done', engine: 'full-v1', status: 'done', pushRequested: true, pushed: true, chunks: 10}];
  const h = harness({requests});
  h.context.REPORT_REQUESTS[0].pushed = false;
  await h.poll();
  assert.equal(h.context.REPORT_REQUESTS[0].pushed, true);
  assert.ok(h.context.rrPanel().includes('智库材料 10 条已入库'));
  assert.equal(h.calls.filter(c => c.url === '/health').length, 0);
  const callCount = h.calls.length;
  await h.poll();
  assert.equal(h.calls.length, callCount);
});

test('configuration-blocked native report keeps polling and accepts the same server job resume', async () => {
  const requests = [{id: 'resumed', engine: 'full-v1', engineReportId: 'native-job', status: 'running', failureCode: null, city: '随州', province: '湖北'}];
  const h = harness({requests});
  Object.assign(h.context.REPORT_REQUESTS[0], {status: 'failed', failureCode: 'configuration'});
  await h.poll();
  assert.equal(h.calls.filter(c => c.url === '/api/sync?raw=1').length, 1);
  assert.equal(h.context.REPORT_REQUESTS[0].status, 'running');
  assert.equal(h.context.REPORT_REQUESTS[0].failureCode, null);
  assert.ok(!h.context.rrPanel().includes('配置/认证异常'));
  assert.equal(h.renders(), 1);
});

test('only the same native configuration-blocked job may regress failed to running', () => {
  const native = {id: 'job', engine: 'full-v1', engineReportId: 'native-job', city: '随州', province: '湖北', status: 'failed', failureCode: 'configuration'};
  for (const changed of [
    {engine: undefined}, {engine: 'legacy'}, {engineReportId: 'different-job'},
    {city: '武汉'}, {province: '湖南'}, {failureCode: 'configuration'},
  ]) {
    const h = harness({requests: [native]});
    assert.equal(h.context._rrMergeRequests([{...native, status: 'running', failureCode: null, ...changed}]), false);
    assert.equal(h.context.REPORT_REQUESTS[0].status, 'failed');
  }
  for (const local of [{...native, failureCode: 'quality'}, {...native, engine: undefined}]) {
    const h = harness({requests: [local]});
    h.context._rrMergeRequests([{...native, status: 'running', failureCode: null}]);
    assert.equal(h.context.REPORT_REQUESTS[0].status, 'failed');
  }
});

test('cancellation stays terminal when a native configuration resume is read back later', async () => {
  const native = {id: 'cancelled', engine: 'full-v1', engineReportId: 'native-job', city: '随州', province: '湖北', status: 'cancelled', failureCode: 'configuration'};
  const h = harness({requests: [native]});
  assert.equal(h.context._rrMergeRequests([{...native, status: 'running', failureCode: null}]), false);
  assert.equal(h.context.REPORT_REQUESTS[0].status, 'cancelled');
  await h.poll();
  assert.equal(h.calls.length, 0);
});
