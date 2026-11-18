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
 const c=boot();assert.match(c.cpProfileObject('配套与成本','',[]),/配套与成本.*不代表当地没有/);
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

test('generic stored overview is replaced by reviewed implications and first verification action',()=>{
 const c=boot(),prof={profile_contract:'city-profile-v2',summary:'已按六个维度整理当前工作区材料；披露内容尚需核对原始来源。',analysis:[{kind:'strength',implication:'研发载体适合作为访谈起点。',action:'先找园区核实空间。'},{kind:'constraint',implication:'具体供地条件仍待核。'}]};
 const summary=c.cpProfileDisplaySummary(prof);assert.match(summary,/研发载体/);assert.match(summary,/供地条件/);assert.match(summary,/先找园区/);assert.doesNotMatch(summary,/已按六个维度/);
 prof.summary='已有经过复核的完整总览';assert.equal(c.cpProfileDisplaySummary(prof),prof.summary);
});

function profileVisibleText(html){
 let depth=0,result='';
 for(const token of html.match(/<[^>]*>|[^<]+/g)||[]){
  if(/^<details\b/i.test(token)){depth++;continue;}
  if(/^<\/details/i.test(token)){depth--;continue;}
  if(!depth&&token[0]!=='<')result+=token+' ';
 }
 return result;
}
test('dashboard keeps graphs before detailed research and exposes real material counts without strength scores',()=>{
 const c=boot(),prof={profile_contract:'city-profile-v2',summary:'城市条件及约束仍需核实。',objective:{economy:[{label:'GDP',value:'本市2025年地区生产总值110亿元。'}],park:[{label:'厂房',value:'园区披露厂房信息，实际可用面积仍需核实。'}]},charts:{gdp_trend:[{year:'2024',value:100},{year:'2025',value:110}],structure:{year:'2025',primary:1,secondary:49,tertiary:50}},metrics:[],analysis:[],preference:{},gaps:[]};
 const before=JSON.stringify(prof),html=c.cpProfileBody(prof);
 assert(html.indexOf('GDP走势')<html.indexOf('招商研判与下一步'));
 assert.match(html,/三次产业结构2025/);assert.match(html,/画像材料分布/);assert.match(html,/2\/6 类有材料/);assert.match(html,/非城市实力评分/);
 assert.equal(JSON.stringify(prof),before);
 assert.equal(c.cpChartsSection({charts:{}}),'legacy');
});
test('long reviewed analysis and source caveats stay available but do not fill the default dashboard',()=>{
 const c=boot(),implication='研发载体可作为项目选址的访谈起点。'+('此处为分析与限定条件。'.repeat(70))+'仅规划待核，不能视为已经量产。',
 action='先联系园区核实厂房与准入条件。'+('具体项目还需核对细节。'.repeat(50));
 const html=c.cpProfileInsights({profile_contract:'city-profile-v2',analysis:[{kind:'strength',focus:'研发载体',implication,action,evidence:[{quote:'原始材料仍需核查主体与年份。'}]}]});
 assert(html.includes(implication));assert(html.includes(action));assert.match(html,/仅规划待核，不能视为已经量产/);
 assert(profileVisibleText(html).length<300);assert.doesNotMatch(html,/<details[^>]*\bopen\b/);
 assert.match(html,/完整分析与依据/);
});
test('fact cards show two concise entries while keeping remaining originals in closed disclosure',()=>{
 const c=boot(),rows=Array.from({length:8},(_,i)=>({label:'企业'+i,value:'苏州企业'+i+'披露研发载体。'+('保留适用范围与原始限定。'.repeat(30))}));
 const html=c.cpProfileObject('企业与项目','',rows);
 assert.match(html,/8 条材料/);assert.match(html,/其余 6 条材料/);
 assert(profileVisibleText(html).length<300);assert(html.includes(rows[7].value));
 assert.equal(c.cpObjBlock(),'');
});
test('overview retains its complete text and presents condition, constraint and verification separately',()=>{
 const c=boot(),summary='用户已确认的完整总览，仍需核对适用条件。',html=c.cpProfileOverview({profile_contract:'city-profile-v2',summary,analysis:[{kind:'strength',implication:'已有本地产业基础，但项目落地待核。',action:'先联系园区核实。'},{kind:'constraint',implication:'可供土地仍需确认。'}]});
 assert.match(html,/城市底盘/);assert.match(html,/主要约束/);assert.match(html,/优先核查/);assert(html.includes(summary));
 assert.doesNotMatch(profileVisibleText(html),/用户已确认的完整总览/);
});
