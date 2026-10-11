'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'frontend', 'index', 'script-02-sections');
function declaration(file, name) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

// Execute production handlers. Only browser download I/O is replaced; no
// network, credentials, live report or persistent application state is used.
function boot(projects, current = 'minhang', state = {}) {
  const downloads = [], toasts = [], calls = {append: 0, click: 0, remove: 0};
  const context = {
    PROJECTS: projects, cur: current,
    UPLOADS: state.UPLOADS || {}, KB_FILE_CHUNKS: state.KB_FILE_CHUNKS || {},
    UPLOAD_TOMBS: state.UPLOAD_TOMBS || {},
    Date, Blob,
    nowLabel: () => '固定测试日期', toast: value => toasts.push(value),
    URL: {createObjectURL(blob) {downloads.push({blob}); return 'blob:local-test';}},
    document: {
      body: {appendChild() {calls.append++;}, removeChild() {calls.remove++;}},
      createElement(tag) {
        assert.equal(tag, 'a');
        return {click() {calls.click++; downloads.at(-1).filename = this.download;}};
      },
    },
    fetch() {throw new Error('Network is forbidden in summary tests');},
  };
  context.P = () => context.PROJECTS[context.cur];
  vm.createContext(context);
  vm.runInContext([
    declaration('01.js', '_kbText'),
    declaration('14-tail.js', 'summarySourceRecords'),
    declaration('14-tail.js', 'downloadSummary'),
  ].join('\n'), context, {filename: 'actual-summary-download-handlers.js'});
  return {
    context, calls, toasts,
    async download() {
      context.downloadSummary();
      const saved = downloads.at(-1), text = await saved.blob.text();
      const section = text.split('当前项目来源记录：\n')[1].split('\n\n')[0];
      return {...saved, text, sources: section};
    },
  };
}

function project(city = '闵行区', known = []) {
  return {city, topic: city + '产业链招引', kb: [{t: '产业', sub: '资料', known, calls: []}]};
}

test('native report download lists only current request source metadata and preserves the download', async () => {
  const p = project('闵行区', [
    {text: '当前报告原生正文', origin: 'report', nature: 'base', sourceFile: '01_economy.md', cite: '01_economy.md', reportRequestId: 'current-request'},
    {text: '同一来源第二片段', origin: 'report', sourceFile: '01_economy.md', reportRequestId: 'current-request'},
    {text: '已保留旧片段', origin: 'report', sourceFile: '旧报告.md', reportRequestId: 'old-request'},
  ]);
  p.reportRequestId = 'current-request';
  p.reportFiles = [
    {name: '闵行区完整报告.docx', kind: 'full', downloadUrl: '/report-download/local'},
    {name: '闵行区精简报告.docx', kind: 'short'},
    {name: '旧请求报告.docx', reportRequestId: 'old-request'},
  ];
  const h = boot({minhang: p});
  const out = await h.download();
  assert.match(out.sources, /报告文件：闵行区完整报告\.docx/);
  assert.match(out.sources, /报告文件：闵行区精简报告\.docx/);
  assert.match(out.sources, /报告研究材料：01_economy\.md/);
  assert.equal(out.sources.match(/01_economy\.md/g).length, 1);
  assert.doesNotMatch(out.sources, /旧报告|旧请求报告/);
  assert.match(out.text, /当前报告原生正文/);
  assert.equal(out.filename, '闵行区城市智库摘要_闵行区产业链招引.txt');
  assert.deepEqual(h.calls, {append: 1, click: 1, remove: 1});
  assert.equal(h.toasts[0], '已下载：闵行区城市智库摘要');
});

test('current uploads and file chunks supply source names once without collecting another project', async () => {
  const h = boot({minhang: project()}, 'minhang', {
    UPLOADS: {minhang: [{name: '闵行公开材料.pdf', size: 12, ts: 1}, {name: '待解析.txt', ts: 2, pending: true}], other: [{name: '其他城市上传.pdf', ts: 1}]},
    KB_FILE_CHUNKS: {minhang: [{cite: '闵行公开材料.pdf', text: '正文'}, {source: '历史source字段.txt'}, {file: '历史file字段.txt'}], other: [{cite: '其他城市片段.md'}]},
  });
  const out = await h.download();
  assert.equal(out.sources.match(/闵行公开材料\.pdf/g).length, 1);
  assert.match(out.sources, /上传材料：待解析\.txt/);
  assert.match(out.sources, /智库材料：历史source字段\.txt/);
  assert.match(out.sources, /智库材料：历史file字段\.txt/);
  assert.doesNotMatch(out.sources, /其他城市/);
});

test('legacy known strings remain readable but are never parsed into invented file sources', async () => {
  const p = project('合肥', ['旧格式纯文本正文', '📎 仅正文提到的文件.pdf 已解析（2片段）']);
  p.kb[0].calls = ['示例文件.xlsx'];
  const out = await boot({minhang: p}).download();
  assert.match(out.text, /旧格式纯文本正文/);
  assert.match(out.sources, /暂无来源记录。/);
  assert.doesNotMatch(out.sources, /仅正文提到的文件|示例文件/);
});

test('non-report structured material uses its saved source metadata', async () => {
  const p = project('武汉', [
    {text: '人工核对正文', origin: 'user', src: '人工上传说明.txt'},
    {text: '旧式来源正文', origin: 'admin', cite: '原始公开页面'},
    {text: '没有元数据但保留正文', origin: 'user'},
  ]);
  const out = await boot({minhang: p}).download();
  assert.match(out.sources, /智库材料：人工上传说明\.txt/);
  assert.match(out.sources, /智库材料：原始公开页面/);
  assert.match(out.text, /没有元数据但保留正文/);
  assert.doesNotMatch(out.sources, /没有元数据但保留正文/);
});

test('empty provenance explicitly reports no source records without cross-city hardcoded names', async () => {
  for (const city of ['闵行区', '合肥', '武汉']) {
    const out = await boot({minhang: project(city)}).download();
    assert.match(out.sources, /暂无来源记录。/);
    assert.doesNotMatch(out.text, /随州|随县|曾都|新楚风|程力|博利特|品源/);
    assert.ok(out.text.startsWith('慧小招 · ' + city + '城市智库摘要'));
  }
});

test('switching projects scopes provenance to the selected city and report identity', async () => {
  const projects = {minhang: project(), suizhou: project('随州')};
  projects.minhang.reportRequestId = 'minhang-request';
  projects.suizhou.reportRequestId = 'suizhou-request';
  projects.minhang.reportFiles = [{name: '闵行区报告.docx'}];
  projects.suizhou.reportFiles = [{name: '随州报告.docx'}];
  const h = boot(projects, 'minhang', {UPLOADS: {minhang: [{name: '闵行上传.txt', ts: 1}], suizhou: [{name: '随州上传.txt', ts: 1}]}});
  const first = await h.download();
  assert.match(first.sources, /闵行上传|闵行区报告/);
  assert.doesNotMatch(first.sources, /随州/);
  h.context.cur = 'suizhou';
  const second = await h.download();
  assert.match(second.sources, /随州上传|随州报告/);
  assert.doesNotMatch(second.sources, /闵行/);
});

test('deleted, malformed and seed-only source records are not revived or stringified', async () => {
  const p = project('闵行区', [
    {text: '已删除来源正文', src: '已删除.txt'},
    {text: '错误形状的来源', src: {name: '不应猜测.txt'}},
    {text: '缺少请求绑定的原生片段', origin: 'report', sourceFile: '无绑定.md'},
  ]);
  p.reportFiles = [{name: '无绑定报告.docx'}];
  const h = boot({minhang: p}, 'minhang', {
    UPLOADS: {minhang: [{name: '已删除.txt', ts: 1}, {name: '历史演示上传.pdf', at: '旧演示日期'}, {name: {bad: true}, ts: 1}, null]},
    KB_FILE_CHUNKS: {minhang: [{cite: '已删除.txt'}, {cite: {bad: true}}, null]},
    UPLOAD_TOMBS: {'minhang::已删除.txt': 100},
  });
  const out = await h.download();
  assert.match(out.sources, /暂无来源记录。/);
  assert.doesNotMatch(out.sources, /已删除|历史演示|无绑定|不应猜测|\[object Object\]/);
});

test('deleted filenames retain raw whitespace identity and honor normalized legacy tombstones', async () => {
  for (const tombName of [value => value, value => value.trim(), value => value.trim().replace(/\s+/g, ' ')]) {
    const names = ['  已删除  上传.txt  ', '  已删除  片段.txt  ', '  已删除  智库.txt  '];
    const p = project('闵行区', [{text: '真实正文', src: names[2]}]);
    const tombs = {};
    names.forEach(name => {tombs['minhang::' + tombName(name)] = 1;});
    const h = boot({minhang: p}, 'minhang', {
      UPLOADS: {minhang: [{name: names[0], ts: 1}]},
      KB_FILE_CHUNKS: {minhang: [{cite: names[1], text: '片段正文'}]},
      UPLOAD_TOMBS: tombs,
    });
    const out = await h.download();
    assert.match(out.sources, /暂无来源记录。/);
    assert.doesNotMatch(out.sources, /已删除/);
  }
});

test('different real whitespace filenames stay distinct while exact upload and chunk duplicates deduplicate', async () => {
  const names = ['项目  清单.pdf', '项目 清单.pdf', ' 项目 清单.pdf '];
  const h = boot({minhang: project()}, 'minhang', {
    UPLOADS: {minhang: names.map(name => ({name, ts: 1}))},
    KB_FILE_CHUNKS: {minhang: names.map(cite => ({cite, text: '同一原始文件的片段'}))},
  });
  const out = await h.download();
  const rows = out.sources.split('\n').filter(row => row.startsWith('  - '));
  assert.deepEqual(rows, names.map(name => '  - 上传材料：' + name));
  assert.equal(rows.length, 3);
});
