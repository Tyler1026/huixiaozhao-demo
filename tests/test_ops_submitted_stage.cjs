'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dir = path.join(__dirname, '..', 'frontend', 'ops', 'script-03-sections');

function declaration(file, name) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const start = text.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const next = text.indexOf('\nfunction ', start + 1);
  return text.slice(start, next < 0 ? text.length : next);
}

function boot() {
  const demand = {id:'demand', isDemand:true, stage:3, topic:'核电换热配套',
    city:'闵行区', org:'测试单位', submissionState:'submitted',
    stageByTopic:{'核电换热配套':3}, clues:[{name:'线索',status:'ops_rec'}]};
  const calls = {persist:0, render:0, network:0, analysis:0, toast:[]};
  const inputs = {};
  const c = {
    PROJECTS:{demand}, REPORTSTATE:{}, UPLOADS:{}, KB_CONFIRMS:{},
    OPS_ENT:[], DEMANDS:[{id:'receipt',projKey:'demand',topic:demand.topic}],
    OPS_UI:{demands:{city:'',query:''}},
    STAGES:[['资料准备','上传材料'],['AI 研判','生成方向'],['确认需求','双确认'],
      ['资源匹配','资源核验'],['招商对接','安排沟通']],
    window:{__opsProjOpen:{demand:true}}, Date, console,
    document:{getElementById:k=>inputs[k]},
    _authEscape: v => String(v ?? '').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),
    persist(){calls.persist++;},render(){calls.render++;},
    toast(t){calls.toast.push(t);},
    fetch(){calls.network++;throw Error('No network in render test');},
    loadAIScanClues(){calls.analysis++;throw Error('Render must not run AI');},
  };
  vm.createContext(c);
  const parts = [
    ...['projStages','stageNameOf'].map(n=>declaration('01.js',n)),
    ...['demandSubmissionState','demandEffectiveStage','demandDisplayProject',
      'stageOptions','renderStageLog','advanceStage','advanceStageTo',
      'saveStageAdvance'].map(n=>declaration('12-tail.js',n)),
    ...['opsEmpty','statCell','opsDemandResults'].map(n=>declaration('17.js',n)),
  ];
  vm.runInContext(parts.join('\n'),c);
  return {c,demand,calls,inputs};
}

function displayedSelect(html) {
  return html.match(/<select id="stage-target-demand"[\s\S]*?<\/select>/)?.[0];
}
function firstBadge(html) {
  return html.match(/border-radius:20px;font-size:11px;font-weight:650">([^<]*)/)[1];
}

test('actual ops v2 card, progress, city badge and options share submitted effective stage',()=>{
  const {c,calls} = boot(), before=JSON.stringify(c.PROJECTS);
  const html = c.opsDemandResults(); // Executes the actual nested opsProjCard.
  assert.equal(firstBadge(html),'资源匹配');
  assert.match(html,/font-size:12px;font-weight:650;display:inline-block">资源匹配/);
  assert.match(html,/font-weight:700;color:#1a56db[^>]*>资源匹配/);
  assert.match(html,/✓ 确认需求/);
  assert.match(displayedSelect(html),/value="5">推进到「招商对接」/);
  assert.doesNotMatch(displayedSelect(html),/value="4"/);
  assert.equal(JSON.stringify(c.PROJECTS),before);
  assert.deepEqual(calls,{persist:0,render:0,network:0,analysis:0,toast:[]});
});

for (const state of ['pending','failed','not_submitted']) {
  test('actual card preserves '+state+' stage instead of inferring submitted',()=>{
    const {c,demand}=boot(); demand.submissionState=state;
    if(state==='not_submitted') c.DEMANDS=[];
    const html=c.opsDemandResults();
    assert.equal(firstBadge(html),'确认需求');
    assert.match(displayedSelect(html),/value="4">推进到「资源匹配」/);
    assert.equal(demand.stage,3);
  });
}

test('other direction receipt does not promote a project without its own receipt',()=>{
  const {c}=boot();c.DEMANDS=[{projKey:'other',topic:'不同方向'}];
  assert.equal(firstBadge(c.opsDemandResults()),'确认需求');
});

test('city badge uses maximum effective progress across its actual child demands',()=>{
  const {c}=boot();
  c.PROJECTS.waiting={id:'waiting',isDemand:true,stage:3,city:'闵行区',topic:'另一方向',submissionState:'pending'};
  c.PROJECTS.parent={id:'parent',stage:6,customStages:['父报告阶段'],city:'闵行区',topic:'工作区'};
  const html=c.opsDemandResults();
  assert.equal(firstBadge(html),'资源匹配');
  assert.match(html,/2 个项目/);
  assert.doesNotMatch(html,/父报告阶段/);
});

test('later and custom stage labels remain visible in card, city badge and options',()=>{
  const {c,demand}=boot();demand.stage=6;demand.customStages=['首场会议','实地考察'];
  const before=JSON.stringify(c.PROJECTS),html=c.opsDemandResults();
  assert.equal(firstBadge(html),'首场会议');
  assert.match(displayedSelect(html),/value="7">推进到「实地考察」/);
  assert.doesNotMatch(displayedSelect(html),/value="4"|value="5"|value="6"/);
  assert.equal(JSON.stringify(c.PROJECTS),before);
});

test('default advance moves submitted raw stage 3 to stage 5 and records effective origin',()=>{
  const {c,demand,calls}=boot(),original=demand;
  c.advanceStage('demand');
  assert.equal(c.PROJECTS.demand,original);
  assert.equal(demand.stage,5);
  assert.equal(demand.stageLog[0].from,4);assert.equal(demand.stageLog[0].to,5);
  assert.equal(calls.persist,1);assert.equal(calls.render,1);
  assert.equal(calls.network+calls.analysis,0);
});

test('explicit actual form selection writes original object only after user action',()=>{
  const {c,demand,calls,inputs}=boot();
  const html=c.opsDemandResults();assert.match(displayedSelect(html),/value="5"/);
  inputs['stage-target-demand']={value:'5'};inputs['stage-note-demand']={value:'  首次对接已安排  '};
  c.saveStageAdvance('demand');
  assert.equal(demand.stage,5);assert.equal(demand.stageLog[0].note,'首次对接已安排');
  assert.equal(demand.stageLog[0].from,4);assert.equal(calls.persist,1);
});

test('effective current stage and invalid advance are no-op writes',()=>{
  const {c,demand,calls}=boot(),before=JSON.stringify(demand);
  c.advanceStageTo('demand',4,'already current');
  c.advanceStageTo('demand',99,'invalid');
  assert.equal(JSON.stringify(demand),before);
  assert.equal(calls.persist+calls.render,0);
  assert.deepEqual(calls.toast,['已在该阶段','无效的阶段']);
});

test('pending default and custom default follow their own stage chain',()=>{
  const {c,demand,calls}=boot();demand.submissionState='pending';
  c.advanceStage('demand');assert.equal(demand.stage,4);assert.equal(demand.stageLog[0].from,3);
  demand.submissionState='submitted';demand.stage=6;demand.customStages=['首场会议','实地考察'];
  c.advanceStage('demand');assert.equal(demand.stage,7);assert.equal(demand.stageLog[0].from,6);
  c.advanceStage('demand');assert.equal(demand.stage,7);assert.equal(calls.persist,2);
});

test('city/search filters continue isolating the rendered demands',()=>{
  const {c}=boot();c.PROJECTS.foreign={isDemand:true,stage:5,city:'宝山区',topic:'另一产业'};
  c.DEMANDS.push({projKey:'foreign'});c.OPS_UI.demands.city='闵行区';
  let html=c.opsDemandResults();assert.match(html,/1 个项目/);assert.equal(firstBadge(html),'资源匹配');
  assert.doesNotMatch(html,/宝山区/);c.OPS_UI.demands.query='不存在';
  html=c.opsDemandResults();assert.match(html,/暂无符合条件/);
});
