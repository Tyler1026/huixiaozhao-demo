'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function source(app) {
  return fs.readFileSync(path.join(__dirname, '../frontend', app,
    app === 'ops' ? 'script-03-sections' : 'script-02-sections', '14-tail.js'), 'utf8');
}
function fn(text, name) {
  const at = text.indexOf('function ' + name + '(');
  assert.ok(at >= 0);
  return text.slice(at).match(/^function [\s\S]*?^}/m)[0];
}
function context() {
  const disk = new Map([['hxz_reportstate', 'old']]);
  const ctx = {RESET_GEN: 'old', cur: 'old-project', console, AUTH: {scope: 'admin', user: 'admin'},
    _authEpoch: 4, view: 'ops', localStorage: {removeItem: k => disk.delete(k),setItem:(k,v)=>disk.set(k,v)},
    _authReadSync: r => r.json(), _safeSyncSnapshot: x => x, _safeProfiles: x => x || {},
    _mergeKbItemTombs() {}, _applyKbItemTombs() {}, _mergeTombs() {}, _mergeConfirms: x => x,
    render() {}, persist() {throw new Error('empty snapshot must never reupload local data');}};
  for (const key of ['PROJECTS','UPLOADS','KB_CONFIRMS','KB_CONFIRM_TOMBS','KB_ITEM_TOMBS','KB_FILE_CHUNKS',
    'KB_UNLOCKED','REPORTSTATE','REPORT_HISTORY','PENDING_CONFIRMS','DOCK_LOGS','KB_CHAT','KB_CHAT_TOMBS',
    'UPLOAD_TOMBS','CITY_BASE_PACKAGES','CITY_WORKSPACES']) ctx[key] = {old: {text: 'old private data'}};
  for (const key of ['OPS_ENT','DEMANDS','REPORT_REQUESTS','DELETED_PROJECTS','DELETED_CLUES']) ctx[key] = ['old'];
  ctx.window = ctx; vm.createContext(ctx); return {ctx,disk};
}
for (const app of ['ops','index']) test(app + ' clears cached business data across reset generations only', () => {
  const {ctx,disk}=context(); vm.runInContext(fn(source(app), '_acceptServerGeneration'),ctx);
  assert.equal(ctx._acceptServerGeneration({RESET_GEN:'old'}),false);
  assert.equal(ctx.OPS_ENT.length,1);
  assert.equal(ctx._acceptServerGeneration({RESET_GEN:'new'}),true);
  for (const key of ['PROJECTS','REPORTSTATE','REPORT_HISTORY','KB_CHAT','CITY_BASE_PACKAGES','CITY_WORKSPACES']) assert.equal(Object.keys(ctx[key]).length,0,key);
  for (const key of ['OPS_ENT','DEMANDS','REPORT_REQUESTS','DELETED_PROJECTS','DELETED_CLUES']) assert.equal(ctx[key].length,0,key);
  assert.equal(ctx.cur,null); assert.equal(ctx.RESET_GEN,'new'); assert.equal(disk.has('hxz_reportstate'),false);
  assert.equal(ctx.AUTH.user,'admin');
});
test('ops accepts authoritative empty server state without restoring or uploading local enterprise data', async () => {
  const {ctx}=context(); const text=source('ops');
  const clean={PROJECTS:{},OPS_ENT:[],DEMANDS:[],REPORT_REQUESTS:[],RESET_GEN:'new',CITY_WORKSPACES:{},CITY_BASE_PACKAGES:{}};
  ctx.fetch=async()=>({json:async()=>clean});
  vm.runInContext(fn(text,'_acceptServerGeneration')+'\n'+fn(text,'restoreFromServer'),ctx);
  let loaded=false; await ctx.restoreFromServer(ok=>{loaded=ok;});
  assert.equal(loaded,true); assert.equal(ctx._opsDataReady,true);
  assert.equal(ctx.OPS_ENT.length,0);assert.equal(Object.keys(ctx.PROJECTS).length,0);
  assert.equal(ctx.DEMANDS.length,0);assert.equal(ctx.REPORT_REQUESTS.length,0);
  assert.equal(Object.keys(ctx.CITY_BASE_PACKAGES).length,0);assert.equal(ctx.cur,null);
});

test('switching user directions does not prune the published city base report slot', () => {
  const raw=fs.readFileSync(path.join(__dirname,'../frontend/index/script-02-sections/14-part-00.js'),'utf8');
  const {ctx}=context();
  ctx.PROJECTS={city:{baseReportVersion:{requestId:'rr1'},baseReportTopic:'闵行区产业链招引'}};
  ctx.REPORTSTATE={city:{userGeneratedTopics:{'生物医药':true},aiReportByTopic:{'闵行区产业链招引':'base','生物医药':'custom','已删除方向':'old'},phaseByTopic:{'闵行区产业链招引':2,'生物医药':2},tsByTopic:{'闵行区产业链招引':10}}};
  vm.runInContext(fn(raw,'_sanitizeReportState'),ctx);ctx._sanitizeReportState();
  assert.equal(ctx.REPORTSTATE.city.aiReportByTopic['闵行区产业链招引'],'base');
  assert.equal(ctx.REPORTSTATE.city.aiReportByTopic['生物医药'],'custom');
  assert.equal(ctx.REPORTSTATE.city.aiReportByTopic['已删除方向'],undefined);
  assert.equal(ctx.REPORTSTATE.city.tsByTopic['闵行区产业链招引'],10);
});
