const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '../frontend/ops/script-03-sections', name), 'utf8');
function harness({disk = new Map(), server = {REPORT_REQUESTS: []}, fail = null} = {}) {
  const calls = [], messages = [], intervals = [], timers = new Map(); let timerID = 0;
  const context = {
    Date, Math, Promise, window: {addEventListener() {}}, LS_KEY: 'huixiaozhao_kb_v1',
    localStorage: {getItem: key => disk.get(key) || null, setItem: (key, value) => disk.set(key, value)},
    $: id => ({value: id === '#rrCity' ? 'city' : 'province'}),
    setInterval: fn => intervals.push(fn), setTimeout: fn => {timers.set(++timerID, fn); return timerID;},
    clearTimeout: id => timers.delete(id), toast: value => messages.push(value), render() {},
    fetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({url, body, headers: options.headers});
      if (fail) {const result = fail({url, body, server, calls}); if (result) return result;}
      if (body) {
        for (const r of body.REPORT_REQUESTS) if (!server.REPORT_REQUESTS.some(x => x.id === r.id)) server.REPORT_REQUESTS.push(r);
        return {ok: true, json: async () => ({ok: true})};
      }
      return {ok: true, json: async () => JSON.parse(JSON.stringify(server))};
    },
  };
  vm.createContext(context); vm.runInContext(read('03.js') + '\n' + read('05.js'), context);
  return {context, disk, server, calls, messages, intervals, timers};
}
test('success is shown only after the exact request ID is saved and read back', async () => {
  const h = harness(); const pending = h.context.submitReportRequest();
  assert.equal(h.context.REPORT_REQUESTS.length, 0);
  assert.ok(!h.messages.some(m => m.includes('已确认保存')));
  await pending;
  assert.equal(h.context.REPORT_REQUESTS.length, 1);
  const posted = h.calls.find(c => c.body).body;
  assert.equal(posted.REPORT_REQUESTS[0].id, h.context.REPORT_REQUESTS[0].id);
  assert.deepEqual(Object.keys(posted).sort(), ['REPORT_REQUESTS', 'RESET_GEN', 'syncTs']);
  assert.equal(Object.keys(h.context._rrOutbox).length, 0);
  assert.ok(h.messages.some(m => m.includes('已确认保存')));
  assert.ok(!h.messages.some(m => m.includes('40 分钟')));
  assert.ok(h.calls.every(c => c.headers['X-HXZ-Report-Client'] === 'website'));
  assert.equal(h.calls.find(c => c.body).headers['Content-Type'], 'application/json');
});
test('offline submission survives a reload and recovers with the same ID', async () => {
  const disk = new Map(); const h = harness({disk, fail: () => {throw new Error('offline');}});
  await h.context.submitReportRequest(); const id = Object.keys(h.context._rrOutbox)[0];
  assert.equal(h.context.REPORT_REQUESTS.length, 0);
  assert.ok(h.context.rrPanel().includes('等待保存确认'));
  const recovered = harness({disk}); recovered.context._rrOutbox[id].nextAt = 0;
  await recovered.context._rrFlushOutbox();
  assert.equal(recovered.server.REPORT_REQUESTS[0].id, id);
  assert.equal(recovered.server.REPORT_REQUESTS.length, 1);
});
test('lost POST response does not duplicate a committed request on retry', async () => {
  let lost = true; const h = harness({fail: ({body, server}) => {
    if (body && lost) {lost = false; server.REPORT_REQUESTS.push(body.REPORT_REQUESTS[0]); throw new Error('lost response');}
  }});
  await h.context.submitReportRequest(); const id = Object.keys(h.context._rrOutbox)[0];
  h.context._rrOutbox[id].nextAt = 0; await h.context._rrFlushOutbox();
  assert.equal(h.server.REPORT_REQUESTS.length, 1);
  assert.equal(h.calls.filter(c => c.body).length, 1);
  assert.equal(h.context.REPORT_REQUESTS[0].id, id);
});
test('storage rejection retains the submission without claiming success', async () => {
  const h = harness({fail: ({body}) => body && {ok: true, json: async () => ({ok: false})}});
  await h.context.submitReportRequest();
  assert.equal(h.context.REPORT_REQUESTS.length, 0);
  assert.equal(Object.keys(h.context._rrOutbox).length, 1);
  assert.ok(!h.messages.some(m => m.includes('已确认保存')));
});
test('acknowledgement without matching read-back remains resumable', async () => {
  const h = harness({fail: ({body}) => body && {ok: true, json: async () => ({ok: true})}});
  await h.context.submitReportRequest();
  assert.equal(h.context.REPORT_REQUESTS.length, 0);
  assert.equal(Object.keys(h.context._rrOutbox).length, 1);
});
test('reset generation prevents automatic resurrection after a reset', async () => {
  const h = harness({server: {REPORT_REQUESTS: [], RESET_GEN: 'new-generation'}});
  await h.context.submitReportRequest(); const id = Object.keys(h.context._rrOutbox)[0];
  assert.equal(h.context._rrOutbox[id].blocked, true);
  assert.equal(h.calls.filter(c => c.body).length, 0);
  assert.ok(h.context.rrPanel().includes('移除未提交项'));
  h.context._rrDiscardBlocked(id); assert.equal(Object.keys(h.context._rrOutbox).length, 0);
});
test('repeated submit while offline keeps one request per city', async () => {
  const h = harness({fail: () => {throw new Error('offline');}});
  await h.context.submitReportRequest(); await h.context.submitReportRequest();
  assert.equal(Object.keys(h.context._rrOutbox).length, 1);
});
test('same-status refresh updates progress and delivery without regressing cancellation', () => {
  const h = harness();
  h.context.REPORT_REQUESTS = [{id: 'running', status: 'running', progress: 8}, {id: 'cancelled', status: 'cancelled'}];
  assert.equal(h.context._rrMergeRequests([{id: 'running', status: 'running', progress: 9}, {id: 'cancelled', status: 'running'}]), true);
  assert.equal(h.context.REPORT_REQUESTS[0].progress, 9);
  assert.equal(h.context.REPORT_REQUESTS[1].status, 'cancelled');
  h.context._rrMergeRequests([{id: 'running', status: 'done', pushed: false}]);
  h.context._rrMergeRequests([{id: 'running', status: 'done', pushed: true}]);
  assert.equal(h.context.REPORT_REQUESTS[0].pushed, true);
});
test('HTTP failure is not treated as a successful receipt', async () => {
  const h = harness({fail: () => ({ok: false, json: async () => ({REPORT_REQUESTS: []})})});
  await h.context.submitReportRequest();
  assert.equal(h.calls.filter(c => c.body).length, 0);
  assert.equal(Object.keys(h.context._rrOutbox).length, 1);
});
test('hung network wait is bounded and retains the submission', async () => {
  const h = harness(); h.context.fetch = () => new Promise(() => {});
  const pending = h.context.submitReportRequest();
  for (const callback of h.timers.values()) callback(); await pending;
  assert.equal(Object.keys(h.context._rrOutbox).length, 1);
  assert.equal(Object.keys(h.context._rrSending).length, 0);
});
test('unavailable browser storage refuses to claim durable submission', async () => {
  const h = harness(); h.context.localStorage.setItem = () => {throw new Error('quota');};
  await h.context.submitReportRequest();
  assert.equal(h.calls.length, 0); assert.equal(Object.keys(h.context._rrOutbox).length, 0);
});
test('download uses selected request ID and refuses unfinished reports', () => {
  const h = harness(); const links = [];
  h.context.document = {createElement: () => {const a = {click() {}, remove() {}}; links.push(a); return a;}, body: {appendChild() {}}};
  const src = read('00.js'), start = src.indexOf('function downloadReqFile('), end = src.indexOf('/* ── 下载原始报告', start);
  vm.runInContext(src.slice(start, end), h.context);
  h.context.REPORT_REQUESTS = [{id: 'old', city: 'same city', status: 'done', files: [{kind: 'full', name: 'old.docx'}]}];
  h.context.downloadReqFile('old', 'full'); assert.ok(links[0].href.includes('requestId=old&city=same%20city'));
  h.context.REPORT_REQUESTS[0].status = 'running'; h.context.downloadReqFile('old', 'full'); assert.equal(links.length, 1);
});
