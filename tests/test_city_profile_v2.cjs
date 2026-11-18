'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function boot(){
 const c={JSON,Math,String,Array,PROJECTS:{a:{topic:'产业甲',onboarding:{}}},savedEvidenceIdentity:()=> 'source-1',
 cpProjKey:()=> 'a',cpEsc:s=>String(s==null?'':s).replace(/[<>&"]/g,ch=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch])),
 cpSourceText:s=>c.cpEsc(s),cpObjBlock:()=>'',cpChartsSection:()=> 'legacy',_cpReadableCharts:()=> 'legacy',
 cpChartBox:(title,inner,cite)=>title+inner+(cite||''),cpChartStructure:s=>'三次产业结构'+s.year,
 cpChartGdp:()=> 'GDP走势',funnelEvidenceLinks:e=>c.cpEsc((e.evidence||[]).map(r=>r.quote||'').join(' / '))};
 vm.createContext(c);vm.runInContext(read('frontend/ops/city-profile-v2.js'),c);return c;
}
test('profile revision changes for questionnaire edits even when material count stays constant',()=>{
 const c=boot(),first=c.cpProfileRevision('a');c.PROJECTS.a.onboarding={industry:['高端装备']};assert.notEqual(c.cpProfileRevision('a'),first);
 const next=c.cpProfileRevision('a');c.savedEvidenceIdentity=()=> 'changed source, same count';assert.notEqual(c.cpProfileRevision('a'),next);
});
test('reviewed insight shows implications, concrete next step and evidence without HTML injection',()=>{
 const c=boot();const html=c.cpProfileInsights({profile_contract:'city-profile-v2',analysis:[{kind:'strength',focus:'研发载体',implication:'<img src=x onerror=bad()>可作为选址起点',action:'先联系园区运营部门核实载体',evidence:[{quote:'披露原句仍待核'}]}]});
 assert.match(html,/下一步/);assert.match(html,/先联系园区/);assert.match(html,/披露原句/);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
});
test('empty facets remain visible and public policy never becomes a stated preference',()=>{
 const c=boot();assert.match(c.cpObjBlock('配套与成本','',[]),/配套与成本.*不代表当地没有/);
 const html=c.cpProfilePolicies({profile_contract:'city-profile-v2',policyDirections:[{label:'政策',value:'支持研发，补贴条件待核'}]});
 assert.match(html,/不替代/);assert.match(html,/支持研发/);
});
test('v2 charts only use server-bound numeric tuples, never regex-scan raw prose',()=>{
 const c=boot();c.PROJECTS.a.kb=[{known:[{text:'2025年外地生产总值9999亿元'}]}];
 let html=c.cpChartsSection({profile_contract:'city-profile-v2',summary:'地区生产总值9999亿元',charts:{},metrics:[]});
 assert.doesNotMatch(html,/9999/);assert.match(html,/GDP走势尚缺/);
 html=c.cpChartsSection({profile_contract:'city-profile-v2',charts:{},metrics:[{city:'苏州',year:'2025',value:110,unit:'亿元',evidence:[{quote:'2025年苏州市地区生产总值110亿元。'}]}]});
 assert.match(html,/2025年/);assert.match(html,/110/);assert.match(html,/查看数据原文/);
});
test('successful profile receipt does not re-post a complete browser snapshot',()=>{
 const src=read('frontend/ops/script-03-sections/17.js'),start=src.indexOf('function cpFinish('),end=src.indexOf('/* ── 渲染',start);
 assert.doesNotMatch(src.slice(start,end),/persist\(/);
});
