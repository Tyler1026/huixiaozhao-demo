'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function harness(app){
  const folder=app==='index'?'script-02-sections':'script-03-sections';
  const source=fs.readFileSync(path.join(__dirname,'../frontend',app,folder,'00.js'),'utf8');
  function fn(name){const at=source.indexOf('function '+name+'(');assert.ok(at>=0,name);return source.slice(at).match(/^function [\s\S]*?^}/m)[0];}
  const c={};vm.createContext(c);vm.runInContext(['buildReportBrief','reportMdToHtml','downloadReportPDF'].map(fn).join('\n'),c);
  return c;
}
function group(brief,name){return brief.match(new RegExp('(?:^|\\n)## '+name+'\\n([\\s\\S]*?)(?=\\n## (?!#)|$)'))?.[1]||'';}
const body=`# OFFLINE EXPORT REGRESSION - NOT REAL RESEARCH
## 一、产业基础判断
### 1.1 甲区产业总体定位
城市唯一概况：2025年公开数据100亿元，实际口径待核实。
### 1.2 与目标相关的技术突破点
技术唯一结论：经济与政策关键词不改变本节的产业分类。
## 二、产业链缺口分析
> 缺口前置声明：未检索到不等于不存在，以下均须核查。
### 2.1 链条环节状态
| 环节 | 状态 | 条件 |
|---|---|---|
| 零部件 | 待核实 | 不得根据相邻产业断定有产能 |
## 三、补链优先级清单（TOP 5）
> 所有星级均为定性判断，不得用于推算经济拉动。
| 项 | 经济拉动 | 建议 |
|---|---|---|
| A | 未知 | 待核查 |
## 四、目标企业画像
> 企业总前置声明：投资意向未知，不列具体候选公司。
### 4.1 目标企业类型（按TOP缺口）
**缺口1：关键部件**

- 目标企业类型：具备相应资质的企业，已有绿色工厂认定是政策条件。
- 规模特征：未知，不得推断。
### 4.2 企业推荐严格标准的执行说明
企业标准唯一说明：没有扩产证据，不得推荐。

政策工具：这里只是企业章节中的资格条件，不得重分类。
### 4.3 可参照的政策工具（非企业画像）
政策唯一段落：支持符合条件的绿色工厂，额度待核实。

适用条件唯一段落：名单认定未知，不得断言本地公司符合。
## 五、待确认事项
### 5.1 基础数据
行动唯一清单：核对企业名录与公开原文。
### 5.2 政策工具适配性
行动中的政策核查：核对认定名单，不把它当作有效政策事实。
## 附：本报告的证据边界声明
全局边界唯一说明：所有未核实结论都不得用于确定性招商承诺。`;
for(const app of ['index','ops']){
  test(app+' brief classifies whole sections by headings, never body keywords or TOP5 numbers',()=>{
    const c=harness(app),before=body,brief=c.buildReportBrief(body);
    assert.equal(body,before);
    const city=group(brief,'城市概况'),industry=group(brief,'产业判断与承载'),enterprise=group(brief,'企业线索'),policy=group(brief,'政策工具与适用条件'),action=group(brief,'行动与待核事项');
    assert.match(city,/城市唯一概况/);assert.doesNotMatch(city,/经济拉动|TOP 5|技术唯一/);
    assert.match(industry,/技术唯一结论/);assert.match(industry,/零部件 \| 待核实/);assert.match(industry,/缺口前置声明/);
    assert.match(enterprise,/企业总前置声明/);assert.match(enterprise,/缺口1：关键部件/);assert.match(enterprise,/已有绿色工厂认定是政策条件/);assert.match(enterprise,/规模特征：未知/);assert.match(enterprise,/企业标准唯一说明/);
    assert.match(enterprise,/这里只是企业章节中的资格条件/);assert.doesNotMatch(policy,/企业标准唯一|目标企业类型|这里只是企业章节/);assert.match(policy,/政策唯一段落/);assert.match(policy,/适用条件唯一段落/);
    assert.match(action,/所有星级均为定性判断/);assert.match(action,/经济拉动/);assert.match(action,/行动唯一清单/);
    assert.match(brief,/全局边界唯一说明/);
  });
  test(app+' exact flat labels preserve full neighboring qualification without classifying from numeric claims',()=>{
    const c=harness(app),brief=c.buildReportBrief('2. 区域基本盘：经济数据1亿元，待核实。\n57. 政策工具：奖励最高50万元。\n58. 该意见适用条件：成立不满五年。\n59. 该意见有效期：未知。\n89. 待核实事项汇总：核对企业名录。');
    assert.match(group(brief,'城市概况'),/经济数据1亿元/);assert.doesNotMatch(group(brief,'城市概况'),/50万元/);
    assert.match(group(brief,'政策工具与适用条件'),/奖励最高50万元/);assert.match(group(brief,'政策工具与适用条件'),/成立不满五年/);assert.match(group(brief,'政策工具与适用条件'),/该意见有效期：未知/);
  });

  test(app+' same-level qualification headings stay with their preceding section beyond excerpt limits',()=>{
    const c=harness(app),brief=c.buildReportBrief('## 政策工具\n奖励最高50万元。\n## 适用条件\n企业成立三年内。\n## 申请条件\n须在区内实际经营。\n## 资格要求\n须有自主知识产权。\n## 有效期\n2027年12月到期，须复核。\n## 企业线索\n不提供确定性投资意向。\n## 限制条件\n尚未核验扩产证据。');
    const policy=group(brief,'政策工具与适用条件'),enterprise=group(brief,'企业线索');
    assert.match(policy,/最高50万元/);assert.match(policy,/成立三年内/);assert.match(policy,/区内实际经营/);assert.match(policy,/自主知识产权/);assert.match(policy,/2027年12月到期/);
    assert.match(enterprise,/尚未核验扩产证据/);assert.doesNotMatch(policy,/尚未核验扩产证据/);
  });
  test(app+' chapter-wide restrictions survive an unselected last subsection and policy aliases are explicit headings',()=>{
    const c=harness(app),brief=c.buildReportBrief('## 城市概况\n地区GDP100亿元。\n## 产业政策\n政策前言。\n### 工具一\n支持20万元。\n### 工具二\n支持30万元。\n### 工具三\n支持40万元。\n## 限制\n上述三个工具均已过期，不能直接引用。');
    const policy=group(brief,'政策工具与适用条件');
    assert.match(policy,/支持20万元/);assert.match(policy,/上述三个工具均已过期/);
    assert.doesNotMatch(group(brief,'城市概况'),/支持20万元|已过期/);
    const child=c.buildReportBrief('## 政策工具\n政策前言。\n### 工具一\n支持20万元。\n### 工具二\n支持30万元。\n### 工具三\n支持40万元。\n### 有效期\n上述全部政策均已过期，不得直接引用。');
    assert.match(group(child,'政策工具与适用条件'),/上述全部政策均已过期/);assert.match(group(child,'政策工具与适用条件'),/工具三/);
  });
  test(app+' Markdown print renders quotations and separators, and keeps bold subsection labels with their body',()=>{
    const c=harness(app),html=c.reportMdToHtml('> **前置声明**：资料未知，不可推断。\n\n---\n\n**缺口5：测试与配套**\n\n- 目标企业类型：仍需核查。\n\n1 < 2，A > B。');
    assert.match(html,/<blockquote><p><strong>前置声明<\/strong>：资料未知，不可推断。<\/p><\/blockquote>/);
    assert.match(html,/<hr>/);assert.doesNotMatch(html,/<p>---<\/p>|<p>&gt; /);
    assert.match(html,/<h4 class="keep-next">缺口5：测试与配套<\/h4>\n<ul>/);
    assert.match(html,/1 &lt; 2，A &gt; B/);
  });
  test(app+' print retains all source records in compact columns without marking whole sections unbreakable',()=>{
    const c=harness(app),sources=Array.from({length:17},(_,i)=>({kind:'研究材料',value:'source-'+i+'.md'}));
    let html;
    Object.assign(c,{reportExportContext:()=>({project:{},state:{ts:1,evidenceStatusByTopic:{t:'unreviewed'}},city:'甲区',topic:'t',text:body}),topicScoreDisplay:()=> '内容待核验',nativeReportState:()=>null,reportExportSourceRecords:()=>sources,printReportDocument:value=>{html=value;}});
    c.downloadReportPDF('full');
    assert.match(html,/\.source-list ul\{column-count:2/);assert.match(html,/\.source-list li\{[^}]*break-inside:avoid/);
    assert.doesNotMatch(html,/<main[^>]*style="[^"]*break-inside:avoid/);
    for(const s of sources)assert.ok(html.includes(s.value));
    assert.match(html,/\.keep-next\{break-after:avoid/);
  });
}
