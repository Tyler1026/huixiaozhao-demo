'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const wrapped=fs.readFileSync(path.join(__dirname,'fixtures/report_pdf_soft_wrap.md'),'utf8');
function renderer(side){
 const folder=side==='index'?'script-02-sections':'script-03-sections';
 const source=fs.readFileSync(path.join(__dirname,'../frontend',side,folder,'00.js'),'utf8');
 const code=source.slice(source.indexOf('function reportMdToHtml(')).match(/^function [\s\S]*?^}/m)[0];
 const context={};vm.createContext(context);vm.runInContext(code,context);return {render:context.reportMdToHtml,code};
}
for(const side of ['index','ops']){
 const {render}=renderer(side);
 test(side+' archived PDF soft wraps render as one readable quote with the source outside',()=>{
  const original=wrapped,html=render(wrapped);
  assert.equal((html.match(/<blockquote>/g)||[]).length,1);
  assert.equal((html.match(/<p>/g)||[]).length,2);
  assert.match(html,/年中国生物制药/);assert.match(html,/技术壁垒相对高/);assert.match(html,/生物药研发与生产过程中/);
  assert.match(html,/36\.8%/);assert.match(html,/29\.6%/);assert.match(html,/Cytiva、Thermo Fisher、Merck/);
  assert.match(html,/<\/blockquote>\n<p><a href="https:\/\/static\.cninfo\.com\.cn\/finalpage\/2026-06-10\/1225360022\.PDF"/);
  assert.match(html,/单一来源，待独立复核/);assert.equal(wrapped,original);
 });
 test(side+' explicit quote paragraphs and separate source boundaries stay separate',()=>{
  const html=render('> 第一段。\n>\n> 第二段条件。\n\n来源甲。\n\n> 另一来源的引文。\n## 后续章节\n- 核验事项\n| 项目 | 状态 |\n|---|---|\n| 甲 | 待核 |');
  assert.match(html,/<blockquote><p>第一段。<\/p><p>第二段条件。<\/p><\/blockquote>/);
  assert.equal((html.match(/<blockquote>/g)||[]).length,2);assert.match(html,/<h2>后续章节<\/h2>/);assert.match(html,/<ul><li>核验事项<\/li><\/ul>/);assert.match(html,/<table><thead>/);
 });
 test(side+' Latin words retain a boundary while Chinese soft wraps reconnect',()=>{
  const html=render('> Thermo\n> Fisher 与 Merck等外资\n> 厂商，以及国\n> 内厂商。');
  assert.match(html,/Thermo Fisher 与 Merck等外资厂商，以及国内厂商。/);
 });
 test(side+' intentional hard breaks remain inside one quote and source markup is escaped',()=>{
  const html=render('> 第一行  \n> 第二行\\\n> 第三行 <script>alert(1)</script>\n> [无效链接](javascript:alert(1))');
  assert.equal((html.match(/<blockquote>/g)||[]).length,1);assert.equal((html.match(/<br>/g)||[]).length,2);
  assert.match(html,/第一行<br>第二行<br>第三行 &lt;script&gt;alert\(1\)&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>|href="javascript:/);
 });
 test(side+' CRLF and CR line endings retain the same paragraph structure',()=>{
  const input='> 第一行\n> 第二行\n>\n> 第三行\n来源。';
  assert.equal(render(input.replace(/\n/g,'\r\n')),render(input));assert.equal(render(input.replace(/\n/g,'\r')),render(input));
 });
}
test('client and admin use the same report quote renderer',()=>assert.equal(renderer('index').code,renderer('ops').code));
