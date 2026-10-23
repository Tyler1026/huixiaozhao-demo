const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '../frontend/ops/script-03-sections', name), 'utf8');

function row(status = 'paused', version = 3) {
  return {id: 'rrpolicy', city: '离线市', province: '离线省', ts: 1, engine: 'full-v1', engineReportId: 'job', status,
    executionPolicy: {policy_version: 'standard-live-v1', version, state: status,
      pause_reason: 'quality_repeated', usage: {attempts_total: 2, retries: 1, work_seconds: 70}}};
}
function harness(rows = [row()]) {
  const intervals = [], calls = [], toasts = [], inputs = {'#rrCity': {value: '离线市'}, '#rrProv': {value: '离线省'}};
  const c = {AUTH: {user: 'fixture-admin', scope: 'admin'}, Date, Math, Promise, window: {}, setTimeout, clearTimeout,
    setInterval: (fn, delay) => intervals.push({fn, delay}),
    localStorage: {getItem: () => null, setItem() {}}, render() {}, toast: value => toasts.push(value),
    $: key => inputs[key], fetch: async (url, options) => {calls.push({url, options}); return {ok: true, json: async () => ({REPORT_REQUESTS: rows})};}};
  vm.createContext(c); vm.runInContext(read('03.js') + '\n' + read('05.js'), c);
  c.REPORT_REQUESTS = JSON.parse(JSON.stringify(rows));
  return {c, calls, toasts, poll: () => intervals.find(x => x.delay === 30000).fn()};
}

test('paused and pause requested remain static and do not promise automatic retry or money cap', () => {
  for (const status of ['paused', 'pause_requested']) {
    const {c} = harness([row(status)]);
    const html = c.rrPanel();
    assert.match(html, status === 'paused' ? /已暂停·等待管理员继续/ : /正在暂停·当前步骤收尾/);
    assert.match(html, /累计启动 2 次，自动重试 1 次/);
    assert.match(html, /费用需另行核对/);
    assert.doesNotMatch(c.rrProgress(row(status)), /ops-live-dot|animation|自动重试中/);
    assert.match(html, /cancelReportRequest/);
    assert.doesNotMatch(html, /downloadReqFile|pushReportToRag/);
  }
});
test('stale policy snapshots cannot restart held work; newer explicit continue can', () => {
  for (const status of ['paused', 'pause_requested']) {
    const {c} = harness([row(status)]);
    for (const changed of [row('running', 2), row('running', 3), {...row('running', 4), engineReportId: 'wrong'}]) {
      assert.equal(c._rrMergeRequests([changed]), false);
      assert.equal(c.REPORT_REQUESTS[0].status, status);
    }
    assert.equal(c._rrMergeRequests([row('running', 4)]), true);
    assert.equal(c.REPORT_REQUESTS[0].status, 'running');
  }
});
test('terminal completion and cancellation cannot regress to held or running states', () => {
  for (const status of ['done', 'cancelled']) {
    const {c} = harness([row(status)]);
    for (const next of ['running', 'paused', 'pause_requested']) {
      c._rrMergeRequests([row(next, 99)]); assert.equal(c.REPORT_REQUESTS[0].status, status);
    }
  }
});
test('polling paused work only reads state and duplicate same city submission does not POST', async () => {
  const {c, calls, toasts, poll} = harness();
  c.submitReportRequest();
  assert.match(toasts[0], /已有进行中的申请/);
  await poll();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/sync?raw=1');
  assert.notEqual(calls[0].options.method, 'POST');
});
test('unsafe audit text and numeric poison are never rendered as policy detail', () => {
  const value = row();
  Object.assign(value.executionPolicy, {pause_reason: '<script>secret</script>', reason: 'secret', actor: 'secret'});
  value.executionPolicy.usage = {attempts_total: Infinity, retries: true, work_seconds: -1};
  const {c} = harness([value]);
  assert.doesNotMatch(c.rrPanel(), /secret|Infinity|NaN|累计启动|累计工作/);
});
test('attention filter includes paused but active filter does not', () => {
  const {c} = harness();
  assert.match(c.rrPanel({status: 'attention'}), /rrpolicy/);
  assert.doesNotMatch(c.rrPanel({status: 'active'}), /rrpolicy/);
});
