'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..','frontend','index','script-02-sections');
function declaration(file,name){
  const source=fs.readFileSync(path.join(root,file),'utf8'),start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,name);const end=source.indexOf('\nfunction ',start+1);return source.slice(start,end<0?source.length:end);
}
const funcs=[['00.js','reportExportContext'],['00.js','buildReportBrief'],['00.js','reportExportSourceRecords'],['00.js','reportMdToHtml'],['00.js','printReportDocument'],['00.js','downloadReportPDF'],['00.js','downloadReportTxt'],['01.js','_getDisplaySub'],['01.js','_getDisplayTag'],['08.js','showDownloadReport'],['08.js','kbSectionSummary'],['08.js','topicHasFullReport'],['09.js','topicScoreLabel'],['09.js','topicScoreDisplay'],['05.js','syncDetailPane'],['13.js','toggleDetail']];
function boot(extra={}){
  const printed=[],toasts=[],documents=[],timers=[];
  const state={topic:'方向A',text:'2. 区域基本盘：测试地区2025年生产总值4268.99亿元，年份与口径待核实。\n57. 政策工具：研发奖励最高50万元。\n58. 该意见适用条件：企业成立不满五年且有自主知识产权，按研发投入10%，资格待核实。\n59. 该意见有效期未完整披露，须核对原文。\n89. 待核实事项汇总：企业本地投资意向未知，不得据产品匹配推断投资。\n90. 时效性与来源限制总说明：旧政策可能已过时，未经官方原文核实不得直接使用。',ts:1,score:0};
  const project={city:'闵行区',topic:'方向A',reportRequestId:'r-current',kb:[]};
  const c={PROJECTS:{p:project},REPORTSTATE:{p:state},REPORT_HISTORY:{},UPLOADS:{},cur:'p',Date,Blob,Promise,console,window:{},view:'report',role:'gov',detailOpen:true,
    nativeReportState:()=>({}),nativeReportScore:()=>null,topicScore:()=>0,
    toast:msg=>toasts.push(msg),setTimeout(fn,ms){timers.push({fn,ms});},
    URL:{createObjectURL:()=>'',revokeObjectURL(){}},
    document:{getElementById:()=>null,body:{appendChild(el){documents.push(el);}},createElement(tag){
      if(tag==='iframe'){
        const doc={readyState:'loading',open(){},write(html){printed.push(html);},close(){}};
        return {style:{},contentWindow:{document:doc,focus(){},print(){c.printCalls++;},requestAnimationFrame(fn){fn();}}};
      }
      return {style:{},setAttribute(){},click(){},remove(){}};
    }},printCalls:0,...extra};
  c.P=()=>c.PROJECTS[c.cur];vm.createContext(c);vm.runInContext(funcs.map(f=>declaration(...f)).join('\n'),c);
  return {c,project,state,printed,toasts,documents,timers};
}
test('numbered compact report creates substantive brief and keeps eligibility, uncertainty and original numbering',()=>{
  const {c,state}=boot();const brief=c.buildReportBrief(state.text);
  assert.match(brief,/4268\.99亿元/);assert.match(brief,/最高50万元/);assert.match(brief,/成立不满五年且有自主知识产权/);
  assert.match(brief,/按研发投入10%/);assert.match(brief,/该意见有效期未完整披露/);assert.match(brief,/投资意向未知/);
  assert.match(brief,/未经官方原文核实不得直接使用/);assert.match(brief,/原文第 1 段/);
  assert.equal(state.text.includes('## 城市概况'),false,'extraction must not mutate the saved original');
});
test('paragraph and Markdown headings work without Chinese chapter numerals',()=>{
  const {c}=boot();const brief=c.buildReportBrief('## 城市概况\n地区生产总值100亿元（2025年，待核）。\n\n## 政策\n资助最高20万元。申请条件：成立3年内。\n\n## 来源限制\n本报告引用未经原文核实不得用于最终决定。');
  assert.match(brief,/100亿元/);assert.match(brief,/成立3年内/);assert.match(brief,/未经原文核实/);
  assert.doesNotMatch(brief,/完整分析请见完整版报告/);
});
test('unknown category remains unknown; extracts never invent its own recommendation',()=>{
  const {c}=boot();const brief=c.buildReportBrief('研究团队尚未完成首轮访谈。');
  assert.match(brief,/现有正文未单列本项/);assert.match(brief,/不能据此认定不存在/);assert.match(brief,/研究团队尚未完成首轮访谈/);
  assert.doesNotMatch(brief,/优先招引|一事一议|具备落地意向/);
});
test('exports bind to selected topic and refuse leftover previous-topic text',()=>{
  const {c,project,state,toasts,printed}=boot();project.topic='未生成方向';state.topic='旧方向';
  assert.equal(c.reportExportContext(),null);c.downloadReportPDF('short');assert.match(toasts.at(-1),/当前方向暂无报告/);assert.equal(printed.length,0);
});
test('source list preserves current raw references and excludes a different report request',()=>{
  const {c,project}=boot();project.kb=[{known:[{origin:'report',reportRequestId:'r-current',text:'真实正文',sourceFile:'current.md'},
    {origin:'report',reportRequestId:'r-old',text:'旧正文',sourceFile:'old.md'}]}];
  c.UPLOADS.p=[{name:'ready.pdf'},{name:'pending.pdf',pending:true}];
  const context=c.reportExportContext();context.text+='\n来源：https://example.gov.cn/policy?id=1';
  const out=c.reportExportSourceRecords(context);assert.deepEqual(Array.from(out,x=>x.value),['current.md','ready.pdf','https://example.gov.cn/policy?id=1']);
});
test('PDF contains extract and safe district title, retains actual evidence state, and waits for iframe readiness',async()=>{
  const {c,project,printed,documents,toasts,timers}=boot();project.city='闵行区';c.downloadReportPDF('short');
  assert.equal(printed.length,1);assert.match(printed[0],/闵行区 · 快速简报/);assert.doesNotMatch(printed[0],/闵行区市/);
  assert.match(printed[0],/4268\.99/);assert.match(printed[0],/成立不满五年/);assert.equal(c.printCalls,0);
  assert.equal(timers.some(x=>x.ms===400),false);assert.doesNotMatch(toasts.join(' '),/已下载|已生成报告/);
  documents[0].onload();await Promise.resolve();await Promise.resolve();assert.equal(c.printCalls,1);
  assert.match(toasts.at(-1),/是否保存由您确认/);
});
test('unreviewed status supersedes estimated score but native true zero remains numeric',()=>{
  const {c,state}=boot();c.nativeReportState=()=>({score:0});c.nativeReportScore=()=>0;
  assert.equal(c.topicScoreDisplay('方向A'),'核验一致项比例 0%');
  state.evidenceStatusByTopic={'方向A':'unreviewed'};assert.equal(c.topicScoreDisplay('方向A'),'内容待核验');
  assert.equal(c.topicScoreLabel('方向A'),'内容待核验');
});
test('an explicit draft phase cannot be promoted by a long cache or older complete history',()=>{
  const {c,state}=boot();state.phaseByTopic={'方向A':1};state.aiReportByTopic={'方向A':'旧'.repeat(1200)};
  c.REPORT_HISTORY.p=[{topic:'方向A',phase:2,text:'旧完整版'}];assert.equal(c.topicHasFullReport('方向A'),false);
  state.phaseByTopic['方向A']=2;assert.equal(c.topicHasFullReport('方向A'),true);
});
test('knowledge summary uses real material counts and substantive excerpt, preserves uncertainty and raw source',()=>{
  const {c}=boot();const section={sub:'待补充材料',tag:'公开信息',known:[
    {text:'本报告为行业调研工作的序言说明，不包含事实结论。',sourceFile:'economy.md'},
    {text:'区域基本盘：2025年GDP100亿元，同比增长5%，数据待核。来源：https://gov.example/data',sourceFile:'economy.md'},
    {text:'政策对象：成立三年内企业；条件待确认。',sourceFile:'policy.md'},
    {text:'请在此输入补充内容（保存后写入知识库）'}]};
  const before=JSON.stringify(section),out=c.kbSectionSummary(section);
  assert.equal(out.count,3);assert.equal(out.sourceCount,3);assert.equal(out.pendingCount,2);
  assert.match(out.excerpt,/GDP100亿元/);assert.match(out.excerpt,/数据待核/);assert.match(out.excerpt,/https:\/\/gov.example/);
  assert.equal(out.excerptPending,true);assert.match(out.displaySub,/已收录 3 条材料/);assert.equal(out.displayTag,'含待核内容');
  assert.equal(JSON.stringify(section),before);assert.doesNotMatch(out.displayTag,/已就绪|已核验/);
});
test('detail close updates only the sibling slot even when report and verification rendering are protected',()=>{
  const {c}=boot();const removed=[],added=[];const main={textContent:'流式正文必须保留'},pane={remove(){removed.push('pane');}};
  const workspace={querySelector(sel){return sel==='.detail-pane'?pane:null;},appendChild(el){added.push(el);}};
  c.document.getElementById=id=>id==='root'?{querySelector:()=>workspace}:null;
  c.render=()=>{throw Error('Must not recreate protected main DOM');};c.window._reportGenerating=true;c.window._verifyInProgress=true;
  c.toggleDetail();assert.equal(c.detailOpen,false);assert.deepEqual(removed,['pane']);assert.equal(added[0].textContent,'展开详情');
  assert.equal(main.textContent,'流式正文必须保留');
});

test('brief retains a whole table and does not carry the next enterprise without its qualification',()=>{
  const {c}=boot();
  const text='## 政策工具\n| 支持 | 条件 |\n|---|---|\n| 50万元 | 成立三年内且待核实 |\n\n48. 方向对接假设一：甲公司有产品，投资意向待核实。\n49. 甲公司核查事项：未发现本地项目，不得推断。\n50. 方向对接假设二：乙公司有产品，投资意向待核实。\n51. 乙公司核查事项：没有证据。';
  const brief=c.buildReportBrief(text);
  assert.match(brief,/\| 支持 \| 条件 \|\n\|---\|---\|\n\| 50万元 \| 成立三年内且待核实 \|/);
  assert.match(brief,/甲公司核查事项/);
  if(brief.includes('乙公司有产品'))assert.match(brief,/乙公司核查事项/);
});
test('download menu offers request-bound research ZIP without changing saved file metadata',()=>{
  const {c,project,state,documents}=boot();state.sourceReportId=project.reportRequestId;
  project.reportFiles=[{name:'原始完整报告.docx',kind:'full',downloadUrl:'/api/report-file?kind=full',reportRequestId:project.reportRequestId},
    {name:'其他请求.docx',kind:'full',downloadUrl:'/api/report-file?kind=full',reportRequestId:'wrong'}];
  const before=JSON.stringify(project.reportFiles);c.showDownloadReport();const html=documents.at(-1).innerHTML;
  assert.match(html,/完整研究附件（ZIP）/);assert.match(html,/requestId=r-current&amp;kind=research/);assert.match(html,/href="\/api\/report-file\?city=/);
  assert.match(html,/原始完整报告.docx/);assert.doesNotMatch(html,/其他请求.docx/);
  assert.equal(JSON.stringify(project.reportFiles),before);
});
test('PDF escapes user-controlled city and source names instead of executing markup',()=>{
  const {c,project,printed}=boot();project.city='<img src=x onerror=alert(1)>';
  project.kb=[{known:[{text:'原文',sourceFile:'<script>unsafe</script>'}]}];c.downloadReportPDF('full');
  assert.match(printed[0],/&lt;img/);assert.doesNotMatch(printed[0],/<img/);assert.doesNotMatch(printed[0],/<script>/);
});
test('reopening details also leaves the main report DOM untouched',()=>{
  const {c}=boot();c.detailOpen=false;
  const added=[],workspace={querySelector:()=>null,appendChild:el=>added.push(el)};
  c.document.getElementById=id=>id==='root'?{querySelector:()=>workspace}:null;
  c.detailPane=()=>'<p>current detail only</p>';c.render=()=>{throw Error('Must not rerender report');};
  c.toggleDetail();assert.equal(c.detailOpen,true);assert.equal(added[0].className,'detail-pane');assert.match(added[0].innerHTML,/current detail only/);
});

test('knowledge card and detail ignore stale generated summary tags and use this section only',()=>{
  const {c,project}=boot();project.kb=[{sub:'待补充材料',tag:'100%已验证',known:[{text:'今年企业产值100亿元，统计口径待核实。',sourceFile:'current.md'}]}];
  c._kbSummaryData={kb:[{sub:'另一个地区',tag:'已核验'}]};
  assert.equal(c._getDisplaySub(0),'已收录 1 条材料 · 1 项来源记录');assert.equal(c._getDisplayTag(0),'含待核内容');
  project.kb[0].known=[];assert.equal(c._getDisplaySub(0),'暂无材料');assert.equal(c._getDisplayTag(0),'待补充材料');
});
test('native export refuses a report whose published request no longer matches',()=>{
  const {c,state,printed}=boot();state.sourceReportId='stale-request';c.downloadReportPDF('full');assert.equal(printed.length,0);
});
