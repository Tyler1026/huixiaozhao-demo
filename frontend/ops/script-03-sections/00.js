


/* ══════════════════════════════════════════════════════════════
   报告查看 & 下载 & 招商对接页面重建
   ══════════════════════════════════════════════════════════════ */

/* ── 查看报告：把 REPORTSTATE[cur].text 渲染到 reportArea ── */
function viewCurrentReport(){
  var rs = REPORTSTATE[cur];
  if(!rs || !rs.text){ toast('暂无报告，请先在研判需求页生成'); return; }
  var area = document.getElementById('reportArea');
  if(!area){
    // 不在研判需求页，跳转过去再显示
    view='report'; render();
    setTimeout(function(){ viewCurrentReport(); }, 200);
    return;
  }
  // renderMd 是 triggerReport 内的局部函数，这里内联一个简化版
  function md(t){
    return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>')
      .replace(/⚠️/g,'<span style="color:#d97706;font-weight:600">⚠️</span>')
      .replace(/✅/g,'<span style="color:#16a34a">✅</span>')
      .replace(/❌/g,'<span style="color:#dc2626">❌</span>')
      .replace(/★+/g,function(m){return '<span style="color:#f59e0b">'+m+'</span>';})
      .replace(/^#{0,3}\s*([一二三四五六七八九十]+)[、]\s*(.+)$/gm,
        '<div style="display:flex;align-items:center;gap:10px;margin:20px 0 8px;padding-bottom:7px;border-bottom:2px solid #1a56db">'+
        '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;background:#1a56db;color:#fff;border-radius:50%;font-size:12px;font-weight:700">$1</span>'+
        '<span style="font-size:14px;font-weight:750;color:#0b183b">$2</span></div>')
      .replace(/^\|(.+)\|$/gm,function(m,inner){
        var cells=inner.split('|').map(function(c){return c.trim();});
        if(cells.every(function(c){return /^[\s\-:]+$/.test(c);})) return '';
        return '<tr>'+cells.map(function(c,ci){
          return ci===0
            ? '<th style="padding:8px 12px;background:#f0f4ff;border:1px solid #dbeafe;font-weight:700;color:#1e3a8a;text-align:left">'+c+'</th>'
            : '<td style="padding:8px 12px;border:1px solid #e8edf5;color:#1e293b">'+c+'</td>';
        }).join('')+'</tr>';
      })
      .replace(/(<tr>[\s\S]+?<\/tr>)+/g,'<table style="width:100%;border-collapse:collapse;margin:10px 0;font-size:12.5px">$&</table>')
      .replace(/^[-•]\s(.+)$/gm,'<li style="margin:4px 0;color:#1e293b">$1</li>')
      .replace(/\n{2,}/g,'</p><p style="margin:6px 0;line-height:1.85;color:#1e293b">')
      .replace(/\n/g,'<br>');
  }

  area.innerHTML=
    '<div style="border-radius:14px;border:1.5px solid #bfdbfe;overflow:hidden;margin-bottom:8px">'+
      '<div style="padding:12px 16px;background:#f8faff;border-bottom:1px solid #e8edf5;display:flex;align-items:center;gap:8px">'+
        '<span style="font-size:13px;font-weight:700;color:#1d4ed8">📊 研判报告（完整版）</span>'+
        '<span style="font-size:11.5px;color:#8492a6">'+rs.topic+'</span>'+
        '<span style="margin-left:auto;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:#f0fdf4;color:#166534">'+topicScoreDisplay(rs.topic)+'</span>'+
        (origReportFiles()?'<button onclick="downloadOrigReport(\'full\')" style="padding:4px 10px;background:#eef2ff;border:1.5px solid #c7d2fe;border-radius:8px;font-size:12px;color:#4338ca;cursor:pointer;font-weight:600;margin-left:6px">⬇ 研判主报告（Word）</button>':'')+
        '<button onclick="downloadReport(\'full\')" style="padding:4px 10px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:12px;color:#1a56db;cursor:pointer;font-weight:600;margin-left:6px">⬇ 研判摘要</button>'+
      '</div>'+
      '<div style="padding:18px 20px;font-size:13px;line-height:1.85;color:#1e293b">'+
        '<p style="margin:0">'+md(rs.text)+'</p>'+
      '</div>'+
      '<div style="padding:10px 16px;background:#f9fafb;border-top:1px solid #f0f4ff;font-size:11px;color:#9aa5b5">'+
        '生成时间：'+new Date(rs.ts).toLocaleDateString('zh-CN')+' · '+
        (rs.sourceReportId?'数据来源：报告所列原始来源 · 核验一致项比例 ':'数据来源：慧小招实测报告+DeepSeek分析 · 置信度')+(rs.score==null?'待核验':rs.score+'%')+
      '</div>'+
    '</div>';

  // 产业链图谱：viewCurrentReport 调用时同步追加
  if(!document.getElementById('chainMapBlock')){
    var _cmEl2=document.createElement('div');
    _cmEl2.id='chainMapBlock';
    _cmEl2.innerHTML=chainMapHtml(PROJECTS[cur]);
    area.appendChild(_cmEl2);
  }

  // 更新底部操作栏
  var bar = document.querySelector('.report-bottom-bar');
  if(bar){
    bar.innerHTML=
      '<button onclick="triggerReport(1)" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">🔄 重新生成</button>'+
      (origReportFiles()
        ? '<button onclick="downloadOrigReport(\'full\')" style="padding:12px 14px;background:#eef2ff;border:1.5px solid #c7d2fe;border-radius:12px;font-size:13px;color:#4338ca;cursor:pointer;font-weight:600">⬇ 研判主报告（Word）</button>'+
          '<button onclick="downloadOrigReport(\'short\')" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">⬇ 快速简报（Word）</button>'+
          '<button onclick="downloadOrigReport(\'research\')" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">完整研究附件（ZIP）</button>'
        : '<button onclick="downloadReport(\'full\')" style="padding:12px 14px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:12px;font-size:13px;color:#1a56db;cursor:pointer;font-weight:600">⬇ 下载研判摘要</button>')+
      '<button onclick="submitDemand()" style="flex:1;padding:12px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:650;cursor:pointer">✓ 确认方向，提交招引需求</button>';
  }
}

/* ── 查找当前项目的原始报告文件（流水线产出的 docx，推送RAG时上传到云端）── */
function origReportFiles(){
  var p=P();if(!p || !p.reportRequestId)return null;
  var request=(REPORT_REQUESTS||[]).find(function(r){return r.id===p.reportRequestId && r.status==='done' && r.city===p.city;});
  return request&&request.files&&request.files.length?request.files:null;
}
/* ── 需求池行内下载：按申请 id 定位城市 → 拉云端原始 docx ── */
function downloadReqFile(reqId, kind){
  var r=(typeof REPORT_REQUESTS!=='undefined'?REPORT_REQUESTS:[]).filter(function(x){return x.id===reqId;})[0];
  if(!r || r.status!=='done' || !r.files || !r.files.length){ toast('暂无已完成的原始报告文件'); return; }
  kind=kind||'full';
  var meta=r.files.filter(function(m){return m.kind===kind;})[0];
  if(!meta && kind!=='research'){toast('当前报告没有该文件');return;}
  meta=meta||{name:r.city+'_完整研究附件.zip'};
  var url='/api/report-file?requestId='+encodeURIComponent(reqId)+'&city='+encodeURIComponent(r.city)+'&kind='+encodeURIComponent(kind);
  var a=document.createElement('a'); a.href=url; a.download=meta.name||(r.city+'_报告.docx');
  document.body.appendChild(a); a.click();
  setTimeout(function(){a.remove();},300);
  toast('✓ 正在下载原始报告：'+(meta.name||(r.city+'_报告.docx')));
}
/* ── 下载原始报告：直接从云端拉流水线产出的原始 docx ── */
function downloadOrigReport(kind){
  var p=P();if(!p||!p.reportRequestId){toast('当前项目没有绑定报告');return;}
  return downloadReqFile(p.reportRequestId,kind||'full');
}
/* ── 下载报告 ── */
function downloadReport(mode){return downloadReportPDF(mode);}



function reportMdToHtml(md){
  if(!md) return '';
  md=md.replace(/\r\n/g,'\n').replace(/\n{3,}/g,'\n\n');
  var lines=md.split('\n'), out=[], i=0, inTable=false, tbuf=[];
  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function inline(s){
    s=esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    // 关键数据高亮
    s=s.replace(/(\d[\d,.]*\s*(?:亿元|亿|万辆|万吨|万㎡|万台|GWh|km|kg|%))/g,'<span class="num">$1</span>');
    s=s.replace(/✅/g,'<span class="ok">✅</span>').replace(/❌/g,'<span class="no">❌</span>').replace(/⚠️/g,'<span class="warn">⚠️</span>');
    return s;
  }
  function flushTable(){
    if(!tbuf.length){inTable=false;return;}
    var rows=tbuf.filter(function(r){return !/^[\s\-:|]+$/.test(r);});
    var html='<table><thead>';
    rows.forEach(function(r,ri){
      var cells=r.replace(/^\||\|$/g,'').split('|').map(function(c){return c.trim();});
      // 跳过分隔行
      if(cells.every(function(c){return /^[\s\-:]*$/.test(c);})) return;
      var tag=ri===0?'th':'td';
      html+=(ri===0?'':'')+'<tr>'+cells.map(function(c){return '<'+tag+'>'+inline(c)+'</'+tag+'>';}).join('')+'</tr>';
      if(ri===0)html+='</thead><tbody>';
    });
    html+='</tbody></table>';
    out.push(html); tbuf=[]; inTable=false;
  }
  for(;i<lines.length;i++){
    var ln=lines[i];
    if(/^\s*\|.*\|\s*$/.test(ln)){ inTable=true; tbuf.push(ln); continue; }
    else if(inTable){ flushTable(); }
    var mh=ln.match(/^(#{1,4})\s+(.*)$/);
    if(mh){ var lv=mh[1].length; out.push('<h'+lv+'>'+inline(mh[2])+'</h'+lv+'>'); continue; }
    var mch=ln.match(/^\s*[一二三四五六七八九十]+、/);
    if(mch){ out.push('<h2>'+inline(ln.trim())+'</h2>'); continue; }
    var mli=ln.match(/^\s*[-•]\s+(.*)$/);
    if(mli){
      if(out.length&&out[out.length-1].slice(-5)==='</ul>'){ out[out.length-1]=out[out.length-1].slice(0,-5)+'<li>'+inline(mli[1])+'</li></ul>'; }
      else out.push('<ul><li>'+inline(mli[1])+'</li></ul>');
      continue;
    }
    if(ln.trim()==='') continue;
    out.push('<p>'+inline(ln.trim())+'</p>');
  }
  if(inTable) flushTable();
  return out.join('\n');
}


function reportExportContext(){
  var p=P(), rs=REPORTSTATE[cur];
  if(!p||!rs) return null;
  var topic=p.topic||rs.topic||'';
  if(rs.sourceReportId&&p.reportRequestId&&rs.sourceReportId!==p.reportRequestId&&rs.topic===topic)return null;
  var text=typeof reportTextForTopic==='function' ? reportTextForTopic(topic) : (rs.topic===topic?rs.text:'');
  if(!text&&rs.topic===topic) text=rs.text;
  if(typeof text!=='string'||!text.trim()) return null;
  return {project:p,state:rs,topic:topic,text:text,city:String(p.city||''),ts:rs.ts};
}


function buildReportBrief(text){
  var rows=String(text||'').replace(/\r\n?/g,'\n').split('\n');
  var paragraphs=[], pending='', heading='';
  function flush(){if(pending.trim()){paragraphs.push({text:pending.trim(),heading:heading});pending='';}}
  rows.forEach(function(line){
    if(!line.trim()){flush();return;}
    if(/^\s*#{1,6}\s+/.test(line)){flush();heading=line.replace(/^\s*#+\s*/,'');return;}
    if(/^\s*\|/.test(line)){if(pending&&!/^\s*\|/.test(pending))flush();pending+=(pending?'\n':'')+line;return;}
    if(/^\s*\|/.test(pending))flush();
    if(/^\s*(?:\d+[.、．)]|[一二三四五六七八九十]+[、．]|[-*•]\s)/.test(line)){
      flush();pending=line;flush();
    }else pending+=(pending?'\n':'')+line;
  });flush();
  var groups=[
    {title:'城市概况',preferred:[/区域基本盘|经济概况|地区生产总值/,/结构特征|产业结构|人口/],re:/经济|财政|人口/,limit:2},
    {title:'产业判断与承载',preferred:[/产业方向.*依据/,/空间组织|空间布局/,/补链.*方向|补链抓手|制造端断点/],re:/产业基础|核心缺口|补链|承载/,limit:3},
    {title:'企业线索',preferred:[/本市存量企业服务重点|本地企业/,/对接假设[一二三四五六七八九十0-9]|目标企业[一二三四五六七八九十0-9]/],re:/有限公司|集团|企业名称|目标企业/,limit:2},
    {title:'政策工具与适用条件',preferred:[/区级政策工具|本地政策工具/,/国家层面政策工具/],re:/政策工具|政策意见|资助|补贴/,limit:2},
    {title:'行动与待核事项',preferred:[/优先级最高核查项|待核实事项汇总|待确认事项/,/季度.*行动|全年行动|行动[：:]/],re:/核查事项|行动计划/,limit:2}
  ];
  var used={}, chunks=['> 快速简报仅摘录现有正文，不新增事实。原文的待核、推断与政策条件继续适用；未列出的内容请查阅研判报告及原始研究文件。'];
  function qualify(row){return /条件|门槛|适用|上述|该(?:意见|政策|企业|公司|项目|通知)|核查事项|口径风险|待核实|待核验|未披露|有效期/.test(row.text);}
  function add(index){
    if(used[index]||!paragraphs[index]) return;
    used[index]=true;
    chunks.push('**原文第 '+(index+1)+' 段**\n'+paragraphs[index].text);
  }
  groups.forEach(function(group){
    chunks.push('## '+group.title);
    var found=[];
    function choose(expression){
      for(var index=0;index<paragraphs.length&&found.length<group.limit;index++){
        var row=paragraphs[index];
        if(!used[index]&&found.indexOf(index)<0&&expression.test(row.heading+' '+row.text)&&row.text.replace(/[|\s:-]/g,'').length>15){found.push(index);return;}
      }
    }
    group.preferred.forEach(choose);
    while(found.length<group.limit){var before=found.length;choose(group.re);if(found.length===before)break;}
    found.sort(function(a,b){return a-b;});
    if(!found.length){chunks.push('现有正文未单列本项；请查看研判报告原文，不能据此认定不存在。');return;}
    found.forEach(function(index){
      add(index);
      // Keep adjacent clauses so a headline amount cannot outlive its eligibility.
      for(var offset=1;offset<=4;offset++){
        var next=paragraphs[index+offset];
        var nextText=next&&next.text.replace(/^\s*\d+[.、．)]\s*/,'');
        var newSubject=nextText&&/^(?:区级政策工具|国家层面政策工具|本市存量企业服务重点|优先级最高核查项|20\d{2}年.*行动|空间组织)|方向对接假设/.test(nextText);
        if(next&&!newSubject&&qualify(next)) add(index+offset); else break;
      }
    });
  });
  var limits=[];
  paragraphs.forEach(function(row,index){if(/时效性与来源限制|来源限制总说明|本报告.*(?:仅供|不构成)|未经.*核实.*不得|数据缺失.*不得编造/.test(row.text)&&!used[index]) limits.push(index);});
  if(limits.length){chunks.push('## 原文的整体限制');limits.forEach(add);}
  // Short unstructured reports are more useful intact than as empty sections.
  if(!Object.keys(used).length&&paragraphs.length){chunks.push('## 正文摘录');paragraphs.slice(0,6).forEach(function(_,index){add(index);});}
  return chunks.join('\n\n');
}


function reportExportSourceRecords(context){
  var records=[], seen={};
  function add(kind,value){
    if(typeof value!=='string'||!value.trim()) return;
    var key=kind+'\0'+value.trim();if(seen[key]) return;seen[key]=true;
    records.push({kind:kind,value:value.trim()});
  }
  var p=context.project, requestId=p.reportRequestId;
  (p.kb||[]).forEach(function(section){(section.known||[]).forEach(function(item){
    if(!item||typeof item!=='object')return;
    if(item.origin==='report'&&(!requestId||item.reportRequestId!==requestId))return;
    add('研究材料',item.sourceFile||item.cite||item.src);
  });});
  (UPLOADS[cur]||[]).forEach(function(item){if(item&&!item.pending&&!item.parseFailed)add('上传材料',item.name);});
  (context.text.match(/https?:\/\/[^\s<>()（）\[\]，。；]+/g)||[]).forEach(function(url){add('正文引用',url);});
  return records;
}


function printReportDocument(html){
  var old=document.getElementById('pdfPrintFrame'); if(old)old.remove();
  var frame=document.createElement('iframe');frame.id='pdfPrintFrame';
  frame.title='报告打印预览';
  frame.style.cssText='position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(frame);
  var started=false;
  function printReady(){
    if(started)return;started=true;
    var win=frame.contentWindow, doc=win.document;
    var fonts=doc.fonts&&doc.fonts.ready?doc.fonts.ready:Promise.resolve();
    Promise.resolve(fonts).then(function(){
      var paint=win.requestAnimationFrame||function(fn){setTimeout(fn,0);};
      paint.call(win,function(){paint.call(win,function(){
        try{win.focus();win.print();toast('打印预览已就绪，请选择“另存为 PDF”；是否保存由您确认。');}
        catch(error){toast('打印预览未能打开，请重试或使用浏览器打印。');}
      });});
    }).catch(function(){toast('报告字体尚未就绪，请重试打印。');});
  }
  frame.onload=printReady;
  var doc=frame.contentWindow.document;doc.open();doc.write(html);doc.close();
  if(doc.readyState==='complete') printReady();
  toast('正在准备报告打印预览…');
}


function downloadReportPDF(mode){
  var context=reportExportContext();
  if(!context){toast('当前方向暂无报告，请先完成产业分析');return;}
  function esc(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  var rs=context.state, city=context.city, topic=context.topic;
  var kind=mode==='short'?'快速简报':'研判报告';
  var date=rs.ts?new Date(rs.ts).toLocaleDateString('zh-CN'):'未记录';
  var status=typeof topicScoreDisplay==='function'?topicScoreDisplay(topic):'内容待核验';
  var isLegacy=!nativeReportState(topic)&&!(rs.evidenceStatusByTopic&&rs.evidenceStatusByTopic[topic]==='unreviewed');
  var statusHtml=isLegacy&&typeof rs.score==='number'&&isFinite(rs.score)?'研判置信度<b>'+rs.score+'%</b>':esc(status);
  var sources=reportExportSourceRecords(context);
  var body=mode==='short'?buildReportBrief(context.text):context.text;
  var html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>'+esc(city+' · '+kind)+'</title><style>'+
    '@page{size:A4;margin:16mm 17mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    'body{font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;color:#1e293b;line-height:1.75;font-size:11px;margin:0;overflow-wrap:anywhere}'+
    '.cover{padding:0 0 14px;border-bottom:2px solid #1a56db;margin-bottom:18px;break-inside:avoid}.brand{font-size:12px;font-weight:700;color:#1a56db;margin-bottom:12px}'+
    'h1{font-size:24px;line-height:1.4;margin:0 0 7px;color:#0b183b}.subtitle{font-size:13px;margin-bottom:10px}.meta{font-size:10px;color:#667590}'+
    'h2,h3,h4{color:#0b183b;break-after:avoid;page-break-after:avoid;line-height:1.4}h2{font-size:15px;border-bottom:1px solid #dbeafe;margin:20px 0 10px;padding-bottom:6px}h3,h4{font-size:12px}'+
    'p{margin:7px 0;orphans:3;widows:3}ul{padding-left:20px}li{margin:4px 0}table{width:100%;border-collapse:collapse;font-size:10px;margin:10px 0}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #d8e0ed;padding:6px;text-align:left;overflow-wrap:anywhere}th{background:#edf4ff}'+
    '.num{color:#1a56db;font-weight:600}.source-list{font-size:9px;color:#475569}.source-list li{overflow-wrap:anywhere}a{color:#174b91;text-decoration:underline}'+
    '.report-end{break-inside:avoid;page-break-inside:avoid;margin-top:16px;padding-top:10px;border-top:1px solid #d8e0ed;color:#667590;font-size:9px}.report-end p{margin:4px 0}'+
    '</style></head><body><header class="cover"><div class="brand">慧小招 · 招商研判</div><h1>'+esc(city)+' · '+kind+'</h1><div class="subtitle">'+esc(topic)+'</div><div class="meta">生成时间：'+esc(date)+' · '+statusHtml+'</div><p class="meta">'+(mode==='short'?'现有正文摘录，保留原文条件与不确定性。':'当前方向已保存正文；原始研究文件请从报告文件入口下载。')+'</p></header>'+
    '<main>'+reportMdToHtml(body)+'</main>'+
    (sources.length?'<section class="source-list"><h2>来源索引</h2><ul>'+sources.map(function(source){return '<li>'+esc(source.kind)+'：'+(/^https?:\/\//.test(source.value)?'<a href="'+esc(source.value)+'">'+esc(source.value)+'</a>':esc(source.value))+'</li>';}).join('')+'</ul></section>':'<p class="source-list">未保存独立来源索引，请逐项核对正文中的来源说明。</p>')+
    '<footer class="report-end"><p>本报告为 AI 辅助研判；待核、推断、政策有效期和适用条件仍需逐项确认。</p><p>慧小招 · '+esc(city)+' · '+esc(date)+'</p></footer></body></html>';
  printReportDocument(html);
}


function downloadReportTxt(mode){
  var context=reportExportContext();if(!context){toast('当前方向暂无报告');return;}
  var kind=mode==='short'?'快速简报':'研判报告';
  var text=mode==='short'?buildReportBrief(context.text):context.text;
  var content=[context.city+' · '+context.topic+' · '+kind,
    '生成时间：'+(context.ts?new Date(context.ts).toLocaleDateString('zh-CN'):'未记录'),
    (!nativeReportState(context.topic)&&!(context.state.evidenceStatusByTopic&&context.state.evidenceStatusByTopic[context.topic]==='unreviewed')&&typeof context.state.score==='number')?'置信度：'+context.state.score+'%':(typeof topicScoreDisplay==='function'?topicScoreDisplay(context.topic):'内容待核验'),'',text,'',
    '来源索引：'].concat(reportExportSourceRecords(context).map(function(source){return source.kind+'：'+source.value;})).concat([
    '', '本文件来自当前方向已保存正文，待核结论与政策条件继续适用。原始研究文件请从报告文件入口下载。']).join('\n');
  var filename=context.city+'_'+context.topic+'_'+kind+'.txt';
  var blob=new Blob([content],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob);
  var a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(url);a.remove();},300);
  toast('已下载：'+filename);
}
