const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '../frontend/ops/script-03-sections', name), 'utf8');

function harness({response, reject = false} = {}) {
  const calls = [], messages = [];
  const context = {
    setInterval() {}, Date, toast: message => messages.push(message), render() {},
    fetch: async (url, options) => {
      calls.push({url, body: JSON.parse(options.body)});
      if (reject) throw new Error('synthetic network failure');
      return {json: async () => response || {ok: true, id: 'old', city: 'A'}};
    },
  };
  vm.createContext(context);
  vm.runInContext(read('03.js') + '\n' + read('05.js'), context);
  context.REPORT_REQUESTS = [
    {id: 'old', city: 'A', status: 'done', ts: 1, chunks: 1},
    {id: 'new', city: 'A', status: 'done', ts: 2, chunks: 1},
  ];
  return {context, calls, messages};
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('push uses the clicked request ID and changes only that row', async () => {
  const {context, calls} = harness();
  context.pushReportToRag('old', {});
  await settle();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, {requestId: 'old', city: 'A'});
  assert.equal(context.REPORT_REQUESTS[0].pushRequested, true);
  assert.equal(context.REPORT_REQUESTS[1].pushRequested, undefined);
});

test('row buttons identify the report request rather than its city', () => {
  const {context} = harness();
  const html = context.rrPanel();
  assert.ok(html.includes("pushReportToRag('old',this)"));
  assert.ok(html.includes("pushReportToRag('new',this)"));
  assert.ok(!html.includes("pushReportToRag('A',this)"));
});

test('storage failure restores the button without marking the row as queued', async () => {
  const {context, messages} = harness({response: {ok: false, error: '保存失败'}});
  const button = {};
  context.pushReportToRag('old', button);
  await settle();
  assert.equal(button.disabled, false);
  assert.equal(context.REPORT_REQUESTS[0].pushRequested, undefined);
  assert.ok(messages.some(message => message.includes('保存失败')));
});

test('a response for another report is not treated as success', async () => {
  const {context, messages} = harness({response: {ok: true, id: 'new', city: 'A'}});
  const button = {};
  context.pushReportToRag('old', button);
  await settle();
  assert.equal(button.disabled, false);
  assert.ok(context.REPORT_REQUESTS.every(request => !request.pushRequested));
  assert.ok(messages.some(message => message.includes('推送提交失败')));
});

test('network failure permits retry and preserves row state', async () => {
  const {context, messages} = harness({reject: true});
  const button = {};
  context.pushReportToRag('old', button);
  await settle();
  assert.equal(button.disabled, false);
  assert.equal(context.REPORT_REQUESTS[0].pushRequested, undefined);
  assert.ok(messages.some(message => message.includes('网络错误')));
});

test('missing or unfinished local reports do not submit a push', () => {
  const {context, calls} = harness();
  context.REPORT_REQUESTS[0].status = 'running';
  context.pushReportToRag('old', {});
  context.pushReportToRag('missing', {});
  assert.equal(calls.length, 0);
});

test('retrying an already completed push preserves its delivered status', async () => {
  const {context} = harness({response: {ok: true, id: 'old', city: 'A', pushed: true, alreadyRequested: true}});
  context.pushReportToRag('old', {});
  await settle();
  assert.equal(context.REPORT_REQUESTS[0].pushed, true);
});
