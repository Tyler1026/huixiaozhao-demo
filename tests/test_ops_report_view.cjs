const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
function source(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function declaration(code, name) {
  const start = code.search(new RegExp('(?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, name);
  const end = code.slice(start + 1).search(/\n(?:async )?function /);
  return code.slice(start, end < 0 ? undefined : start + 1 + end);
}
function render(report) {
  let layer;
  const c = {
    PROJECTS: { p: { city: '闵行区', topic: '当前方向' } },
    REPORTSTATE: { p: report }, URL,
    topicScoreDisplay() { return '内容待核验'; },
    reportResearchSourcesHtml() { return '<aside>当前方向来源</aside>'; },
    toast() { throw new Error('unexpected empty report'); },
    document: {createElement() {return {style:{}, setAttribute() {}, remove() {}};}, body: {appendChild(value) {layer = value;}}},
  };
  vm.createContext(c);
  const helpers = source('frontend/ops/script-03-sections/12-tail.js');
  vm.runInContext(declaration(helpers, 'escapeChainText') + '\n' + declaration(helpers, 'topicReportMarkup') + '\n' +
    declaration(source('frontend/ops/script-03-sections/00.js'), 'reportMdToHtml') + '\n' +
    declaration(source('frontend/ops/script-03-sections/17.js'), 'opsViewCityReport'), c);
  c.opsViewCityReport('p');
  return layer.innerHTML;
}
test('ops report renders the selected topic, Markdown citations and unknown confidence safely', () => {
  const html = render({topic:'别的方向', text:'wrong report', score:null, ts:100,
    aiReportByTopic:{'当前方向':'# 当前产业报告\n\n> 有出处的原文\n\n[来源 S1](https://example.org/original)\n\n**判断**'},
    tsByTopic:{'当前方向':200}});
  assert.ok(html.includes('<h1>当前产业报告</h1>'));
  assert.ok(html.includes('<blockquote>'));
  assert.match(html, /href="https:\/\/example\.org\/original"/);
  assert.ok(html.includes('内容待核验'));
  assert.ok(!html.includes('null%'));
  assert.ok(!html.includes('wrong report'));
  assert.ok(!html.includes('[来源 S1]('));
});
test('ops report does not turn untrusted markup or unsafe citations into executable HTML', () => {
  const html = render({topic:'当前方向', text:'# 报告\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1))', score:null});
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!/href="javascript:/i.test(html));
});

test('both report status readers require a saved full-report phase, regardless of text length', () => {
  for (const file of ['frontend/index/script-02-sections/08.js','frontend/ops/script-03-sections/14-tail.js']) {
    const c={cur:'p',REPORTSTATE:{p:{topic:'another',phase:2,text:'another report',aiReportByTopic:{current:'draft '.repeat(300)}}},REPORT_HISTORY:{}};
    vm.createContext(c);vm.runInContext(declaration(source(file),'topicHasFullReport'),c);
    assert.equal(c.topicHasFullReport('current'),false);
    c.REPORTSTATE.p.phaseByTopic={current:1};assert.equal(c.topicHasFullReport('current'),false);
    c.REPORTSTATE.p.phaseByTopic.current=2;assert.equal(c.topicHasFullReport('current'),true);
    c.REPORTSTATE.p.phaseByTopic.current=1;c.REPORT_HISTORY.p=[{topic:'current',phase:2,text:'old full report'}];
    assert.equal(c.topicHasFullReport('current'),false,'new draft overrides previous full phase');
  }
});

test('admin refresh failure exposes retry instead of leaving the next tab in a loading state', () => {
  let rendered=0, loaded=0;
  const c={AUTH:{scope:'admin'},window:{_opsDataReady:true},render(){rendered++;},renderOpsV2(){loaded++;},restoreFromServer(callback){c.window._opsDataReady=false;callback(false);}};
  c.render._opsRestored=true;vm.createContext(c);
  vm.runInContext(declaration(source('frontend/ops/script-03-sections/17.js'),'opsRefreshData').split('\nrender();')[0],c);
  c.opsRefreshData();assert.equal(rendered,1);assert.equal(c.render._opsRestored,false);assert.equal(c.render._opsLoadError,'unavailable');assert.equal(loaded,0);
});
