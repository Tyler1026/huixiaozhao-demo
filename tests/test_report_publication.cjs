'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const shared=fs.readFileSync(path.join(root,'frontend/shared/report-publication.js'),'utf8');
const url='https://issuer.example/report.pdf';
const other='https://gov.example/policy';
const raw=`## 一、产业基础判断
企业已披露产品，但本地产能仍待核实。[来源 S4](${url})

沿用前文原始证据 [来源 S4](${url})；同一材料不重复计作新的独立来源。

## 二、产业链缺口分析
未检索到不等于不存在。判断来源的适用条件仍须保留。[来源 S5](${other})

## 三、补链优先级清单
仅在真实供需关系得到支持时推进。

## 四、目标企业画像
投资意向未知，不能将产品匹配写成落地承诺。

## 五、待确认事项
- 请围绕重要耗材核实已有供应主体。
### 本轮确认输入
下列内容不是外部已证实事实。
### 证据与核验边界
这里是生成过程附记。

## 附录：政策适用条件
该政策仅适用于有效期内且符合资质条件的主体。`;
const sources=[{label:'S4',url,title:'企业年度报告',published_at:'2026-04-29'},
  {label:'S5',url:other,title:'产业政策',published_at:'2026-03-01'}];
function pure(){const c={};vm.createContext(c);vm.runInContext(shared,c);return c;}
function declaration(source,name){const at=source.indexOf('function '+name+'(');assert.ok(at>=0,name);const end=source.indexOf('\nfunction ',at+1);return source.slice(at,end<0?source.length:end);}
function browser(app){
  const folder=app==='index'?'script-02-sections':'script-03-sections';
  const base=path.join(root,'frontend',app,folder);
  const zero=fs.readFileSync(path.join(base,'00.js'),'utf8'),tail=fs.readFileSync(path.join(base,'12-tail.js'),'utf8');
  const state={topic:'方向',text:raw,phase:2,phaseByTopic:{方向:2},aiReportByTopic:{方向:raw},researchByTopic:{方向:{topic:'方向',reportText:raw,sources}},ts:1};
  const project={topic:'方向',city:'测试区',kb:[]};const printed=[],downloaded=[],elements={reportArea:{innerHTML:''},reportHistoryArea:{innerHTML:''},chainMapBlock:{}};
  const c={PROJECTS:{p:project},REPORTSTATE:{p:state},REPORT_HISTORY:{p:[{topic:'方向',text:raw,phase:2,ts:1}]},UPLOADS:{},cur:'p',window:{},Date,console,mergeTopicReportHistory:history=>history,
    P:()=>project,kbReadiness:()=>({}),topicScoreDisplay:()=>'',topicScore:()=>0,topicHasFullReport:()=>true,escapeChainText:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    nativeReportState:()=>null,reportTextForTopic:()=>raw,chainMapHtml:()=>'',toast(){},setTimeout(){},origReportFiles:()=>null,
    reportDemandActionButton:()=>'',getReportHistoryForProject:()=>[{topic:'方向',text:raw,phase:2,ts:1}],reportHistoryScoreDisplay:()=>'',_histShowAll:false,
    document:{getElementById:id=>elements[id]||null,querySelector:()=>null,body:{appendChild(){}},createElement:()=>({click(){},remove(){}})},
    Blob:class{constructor(parts){downloaded.push(parts.join(''));}},URL:{createObjectURL:()=>'',revokeObjectURL(){}},
  };
  vm.createContext(c);vm.runInContext(shared,c);
  vm.runInContext(['reportMdToHtml','reportExportContext','buildReportBrief','reportExportSourceRecords','downloadReportPDF','downloadReportTxt','viewCurrentReport'].map(name=>declaration(zero,name)).join('\n'),c);
  vm.runInContext(['reportHtml','topicReportMarkup','renderHistoryReports'].map(name=>declaration(tail,name)).join('\n'),c);
  if(app==='index')vm.runInContext(declaration(zero,'setReportAreaHtml'),c);
  c.printReportDocument=html=>printed.push(html);
  return {c,state,project,elements,printed,downloaded,zero,tail};
}
function assertPublication(text){
  assert.doesNotMatch(text,/待确认事项|本轮确认输入|证据与核验边界|沿用前文原始证据|同一材料不重复/);
  assert.match(text,/本地产能仍待核实/);assert.match(text,/未检索到不等于不存在/);
  assert.match(text,/投资意向未知/);assert.match(text,/仅适用于有效期内/);
  assert.equal((text.match(/(?:## |<h2>)参考文献/g)||[]).length,1);
}
test('final publication removes only named process sections and preserves real conditions and uncertainty',()=>{
  const c=pure(),out=c.reportPublicationText(raw,{phase:2,sources});assertPublication(out);
  assert.match(out,/\[1\]\(https:\/\/issuer.example\/report.pdf\)/);
  assert.match(out,/\[2\]\(https:\/\/gov.example\/policy\)/);
  assert.match(out,/\[1\] 企业年度报告，2026-04-29/);
  assert.match(out,/\[2\] 产业政策，2026-03-01/);
  assert.equal((out.match(/\[1\]\(https:\/\/issuer.example\/report.pdf\)/g)||[]).length,1,'the standalone bookkeeping paragraph must not leave an orphan citation');
});
test('only standalone bookkeeping paragraphs lose their links; inline claims and ordinary citation rows retain them',()=>{
  const c=pure(),text='## 一、结论\n正文事实[来源 S1]('+url+')。\n\n沿用前文原始证据 [来源 S1]('+url+')；同一材料不重复计作新的独立来源。\n\n沿用前文原始证据\n[来源 S1]('+url+')；\n同一材料不重复计作新的独立来源。\n\n[来源 S1]('+url+')\n\n补充判断，沿用前文原始证据 [来源 S1]('+url+')；同一材料不重复计作新的独立来源。仍需核对具体条件。';
  const out=c.reportPublicationText(text,{phase:2});
  assert.doesNotMatch(out,/沿用前文|同一材料/);
  assert.equal((out.match(/\[1\]\(https:\/\/issuer.example\/report.pdf\)/g)||[]).length,3);
  assert.match(out,/补充判断，\[1\]\(https:\/\/issuer.example\/report.pdf\).*仍需核对具体条件/);
  assert.match(out,/\n\n\[1\]\(https:\/\/issuer.example\/report.pdf\)\n\n/,'ordinary citation-only paragraphs remain untouched');
  assert.equal(c.reportPublicationText(out,{phase:2}),out);
});
test('draft, missing phase and phase zero preserve the complete original byte-for-byte',()=>{
  const c=pure(),text=raw.replace(/\n/g,'\r\n');
  for(const phase of [undefined,0,1])assert.equal(c.reportPublicationText(text,{phase,sources}),text);
});
test('published text is idempotent, repeated source URLs share one reference, and absent metadata is not invented',()=>{
  const c=pure();const text='## 一、结论\n判断[来源 S9]('+url+')，另处[来源 S2]('+url+')。';
  const out=c.reportPublicationText(text,{phase:2});
  assert.equal((out.match(/\[1\]\(/g)||[]).length,2);assert.equal((out.match(/\[1\] \[/g)||[]).length,1);
  assert.doesNotMatch(out,/企业年度报告|2026|未知作者|未核验/);
  assert.equal(c.reportPublicationText(out,{phase:2}),out);
});
test('existing numbered references and bare S labels resolve from actual URLs and stay stable',()=>{
  const c=pure();const text='## 一、结论\n判断[8]，其他[S4]。\n\n## 参考文献\n\n[8] 原始政策。 [原文]('+other+')';
  const out=c.reportPublicationText(text,{phase:2,sources});
  assert.match(out,/判断\[1\]\(https:\/\/gov.example\/policy\)/);assert.match(out,/其他\[2\]\(https:\/\/issuer.example\/report.pdf\)/);
  assert.equal(c.reportPublicationText(out,{phase:2,sources}),out);
});
test('different PDF page fragments retain one source number and the first actual URL',()=>{
  const c=pure(),first=url+'#page=3',second=url+'#page=9';
  const text='## 一、结论\n事实[来源 S1]('+first+')，另处[来源 S2]('+second+')。';
  const out=c.reportPublicationText(text,{phase:2,sources:[{url:second,title:'完整年度报告'}]});
  assert.equal((out.match(/\[1\]\(https:\/\/issuer.example\/report.pdf#page=/g)||[]).length,2);
  assert.match(out,/\[1\]\(https:\/\/issuer.example\/report.pdf#page=3\)/);
  assert.match(out,/\[1\]\(https:\/\/issuer.example\/report.pdf#page=9\)/);
  assert.doesNotMatch(out,/\[2\]/);assert.match(out,/完整年度报告/);
  assert.equal(c.reportPublicationText(out,{phase:2}),out);
});
test('backend bibliography keeps publisher, title and date and remains idempotent with PDF fragments',()=>{
  const c=pure(),first=url+'#page=2',second=url+'#page=9';
  const text='## 一、产业基础判断\n产品事实[1]('+first+')。\n\n## 五、实施建议\n方案[1]('+second+')。\n\n## 参考文献\n\n[1] static.cninfo.com.cn．报告标题．2026-04-29．[原文]('+first+')';
  const options={phase:2,sources:[{label:'1',url:second,title:'报告标题',published_at:'2026-04-29'}]};
  const out=c.reportPublicationText(text,options);
  assert.match(out,/static.cninfo.com.cn．报告标题．2026-04-29/);
  assert.match(out,/\[1\]\(https:\/\/issuer.example\/report.pdf#page=2\)/);
  assert.match(out,/\[1\]\(https:\/\/issuer.example\/report.pdf#page=9\)/);
  assert.doesNotMatch(out,/\[2\]/);
  assert.equal(c.reportPublicationText(out,options),out);
});
test('legacy bare-URL references, named source links and unparsed bibliography lines remain available',()=>{
  const c=pure(),text='## 一、结论\n判断[1]，按[年度公报]('+other+')补充。\n\n## 参考文献\n\n[1] 统计局. 年度公报. '+url+'\n[2] 政府办. [年度公报]('+other+')\n[3] 纸本参考，页码22。';
  const out=c.reportPublicationText(text,{phase:2});
  assert.match(out,/判断\[1\]\(https:\/\/issuer.example\/report.pdf\)/);
  assert.match(out,/按\[2\]\(https:\/\/gov.example\/policy\)/);
  assert.match(out,/统计局. 年度公报/);assert.match(out,/政府办/);assert.match(out,/纸本参考，页码22/);
  assert.match(out,/政府办. 年度公报/);
  assert.equal(c.reportPublicationText(out,{phase:2}),out);
});
test('nested evidence notes within the old confirmation chapter retain substantive conditions',()=>{
  const c=pure(),text='## 五、待确认事项\n应移除的确认表。\n### 本轮确认输入\n应移除的表单。\n### 证据与核验边界\n已将可引用原文与链接保留在报告中。\n单源金额范围仅限A业务，B业务不适用。';
  const out=c.reportPublicationText(text,{phase:2});assert.match(out,/单源金额范围仅限A业务，B业务不适用/);
  assert.doesNotMatch(out,/待确认事项|本轮确认输入|应移除|已将可引用/);
});
test('substantive limitations in the evidence appendix survive under a reader-facing heading',()=>{
  const c=pure(),text='## 一、结论\n判断。\n\n## 证据与核验边界\n已将可引用原文与链接保留在报告中。该政策仅限于2027年内有效。\n本地产能未能确认，不据此推断不存在。\n单源事实仍待独立复核；交叉比对只覆盖核验记录。';
  const out=c.reportPublicationText(text,{phase:2});
  assert.doesNotMatch(out,/证据与核验边界|已将可引用|单源事实|交叉比对/);
  assert.match(out,/适用条件与限制/);assert.match(out,/该政策仅限于2027年内有效/);assert.match(out,/本地产能未能确认/);
  assert.equal(c.reportPublicationText(out,{phase:2}),out);
});
test('ordinary prose, unrelated headings and unsafe links are not mistaken for process or fabricated citations',()=>{
  const c=pure(),text='## 事实来源与适用条件\n企业将本轮确认输入作为内部名称，正文含待确认事项四字。\n[来源 S1](javascript:alert(1)) [来源 S2](https://name:password@example.test/a) [官网]('+url+')';
  const out=c.reportPublicationText(text,{phase:2});assert.equal(out,text);
});
test('plain and bold process headings are removed without swallowing later same-level chapters',()=>{
  const c=pure(),out=c.reportPublicationText('一、结论\n条件未知。\n\n**本轮确认输入**\n应移除。\n\n二、实施建议\n保留建议。',{phase:2});
  assert.doesNotMatch(out,/本轮确认输入|应移除/);assert.match(out,/保留建议/);assert.match(out,/条件未知/);
});
test('context transformation never changes raw state and refuses metadata from another report version',()=>{
  const c=pure(),state={topic:'方向',phase:2,researchByTopic:{方向:{topic:'方向',reportText:'另一版本',sources}}};
  const context={text:raw,topic:'方向',state},before=JSON.stringify(context),out=c.reportPublicationForContext(context);
  assertPublication(out);assert.doesNotMatch(out,/企业年度报告/);assert.equal(JSON.stringify(context),before);
  assert.equal(c.reportPublicationForContext({...context,phase:1}),raw);
  state.phaseByTopic={方向:1};assert.equal(c.reportPublicationForContext(context),raw);
});
test('review notes translate known diagnostics without exposing technical payloads and cap at twelve',()=>{
  const c=pure(),notes=c.reportCompositionNotes({diagnostics:[
    {chapter:'basis',code:'local_basis_missing'},
    {chapter:'chain',code:'chapter_quality_not_approved',reason:'paragraph_claim_ids 字段不匹配'},
    {chapter:'companies',code:'grounded_company_profile_missing',reason:'企业产品与目标环节的对应关系仍缺少依据'},
    ...Array.from({length:20},()=>({chapter:'report',code:'composition_unavailable',claims:{secret:'no'}}))
  ]});
  assert.equal(notes.length,12);assert.equal(notes[0],'产业基础：本地产业基础的原始材料不足');
  assert.equal(notes[1],'产业链分析：本章审稿未通过');assert.match(notes[2],/企业画像：企业产品/);
  assert.doesNotMatch(notes.join('\n'),/paragraph_claim_ids|secret|claims|composition_unavailable/);
});
for(const app of ['index','ops']){
  test(app+' limited and reviewed compositions expose their actual publication quality',()=>{
    const {c,state,project,elements,printed}=browser(app);
    state.researchByTopic['方向'].analysis={composition:{status:'limited',diagnostics:['需要补充证据']}};
    assert.match(c.reportHtml(project),/阶段性研判/);c.viewCurrentReport();assert.match(elements.reportArea.innerHTML,/阶段性研判/);
    c.downloadReportPDF('full');assert.match(printed[0],/阶段性研判/);
    state.researchByTopic['方向'].analysis.composition.status='reviewed';assert.match(c.reportHtml(project),/产业研判报告/);
    assert.equal(c.reportPublicationLabel({state:{sourceReportId:'native'},topic:'方向',text:raw},'完整研究报告'),'完整研究报告');
    assert.equal(c.reportPublicationLabel({state:{topic:'方向',phase:2},topic:'方向',text:raw},'完整研究报告'),'产业研判报告');
  });
  test(app+' current report, history, stream, PDF and TXT share publication without changing stored source',()=>{
    const {c,state,project,elements,printed,downloaded}=browser(app),before=JSON.stringify(state);
    assertPublication(c.reportHtml(project));c.viewCurrentReport();assertPublication(elements.reportArea.innerHTML);
    c.renderHistoryReports('p');assertPublication(elements.reportHistoryArea.innerHTML);
    assertPublication(c.topicReportMarkup(raw,2,sources));assert.match(c.topicReportMarkup(raw,1),/待确认事项/);
    c.downloadReportPDF('full');assertPublication(printed[0]);assert.match(printed[0],/企业年度报告/);
    assert.doesNotMatch(printed[0],/未保存独立来源索引|正文链接（未核验）/);
    c.downloadReportTxt('full');assertPublication(downloaded[0]);assert.match(downloaded[0],/企业年度报告/);
    c.downloadReportPDF('short');assert.match(printed[1],/参考文献/);assert.match(printed[1],/企业年度报告/);
    c.downloadReportTxt('short');assert.match(downloaded[1],/参考文献/);assert.match(downloaded[1],/企业年度报告/);
    assert.equal(JSON.stringify(state),before);
  });
  test(app+' numeric citations display bracketed links and escape untrusted metadata',()=>{
    const {c}=browser(app),out=c.reportMdToHtml(c.reportPublicationText('事实[来源 S4]('+url+')',{phase:2,sources:[{label:'S4',url,title:'<script>unsafe</script>'}]}));
    assert.match(out,/<sup class="report-citation"><a [^>]+>\[1\]<\/a><\/sup>/);
    assert.match(out,/＜script＞unsafe＜\/script＞/);assert.doesNotMatch(out,/<script>/);
    const injected=c.reportMdToHtml(c.reportPublicationText('事实[来源 S4]('+url+')',{phase:2,sources:[{label:'S4',url,title:'[伪链接](https://evil.example)'}]}));
    assert.doesNotMatch(injected,/href="https:\/\/evil.example/);assert.match(injected,/［伪链接］/);
  });
  test(app+' active full report prompt asks for implementation advice and keeps input out of report chapters',()=>{
    const {tail}=browser(app),fn=declaration(tail,'triggerReport');
    assert.match(fn,/五、实施建议/);assert.match(fn,/正文仅包含正式研判与实施建议/);
    assert.doesNotMatch(fn,/: '请基于[^\n]+五、待确认事项/);
  });
}
