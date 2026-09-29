

/* ══════════════════════════════════════════════════════════════
   报告查看 & 下载 & 招商对接页面重建
   ══════════════════════════════════════════════════════════════ */

/* ── 查看报告：把 REPORTSTATE[cur].text 渲染到 reportArea ── */

/* 设置 reportArea 内容时保留历史区 */
function setReportAreaHtml(area, html){
  var hist=document.getElementById('reportHistoryArea');
  var histHtml=hist?hist.outerHTML:'<div id="reportHistoryArea"></div>';
  area.innerHTML=histHtml+html;
  setTimeout(function(){ renderHistoryReports(cur); }, 0);
}

function viewCurrentReport(){
  var rs = REPORTSTATE[cur];
  if(!rs || !rs.text){ toast('暂无报告，请先在产业分析页生成'); return; }
  var area = document.getElementById('reportArea');
  if(!area){
    // 不在产业分析页，跳转过去再显示
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

  setReportAreaHtml(area,
    '<div style="border-radius:14px;border:1.5px solid #bfdbfe;overflow:hidden;margin-bottom:8px">'+
      '<div style="padding:12px 16px;background:#f8faff;border-bottom:1px solid #e8edf5;display:flex;align-items:center;gap:8px">'+
        '<span style="font-size:13px;font-weight:700;color:#1d4ed8">📊 产业分析报告（完整版）</span>'+
        '<span style="font-size:11.5px;color:#8492a6">'+rs.topic+'</span>'+
        '<span style="margin-left:auto;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:#f0fdf4;color:#166534">置信度 '+topicScore(rs.topic)+'%</span>'+
        '<button onclick="downloadReport(\'full\')" style="padding:4px 10px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:12px;color:#1a56db;cursor:pointer;font-weight:600;margin-left:6px">⬇ 下载</button>'+
      '</div>'+
      '<div style="padding:18px 20px;font-size:13px;line-height:1.85;color:#1e293b">'+
        '<p style="margin:0">'+md(rs.text)+'</p>'+
      '</div>'+
      '<div style="padding:10px 16px;background:#f9fafb;border-top:1px solid #f0f4ff;font-size:11px;color:#9aa5b5">'+
        '生成时间：'+new Date(rs.ts).toLocaleDateString('zh-CN')+' · '+
        '数据来源：慧小招实测报告+DeepSeek分析 · 置信度'+topicScore(rs.topic)+'%'+
      '</div>'+
    '</div>');

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
      '<button onclick="startAiInterview()" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">🔄 重新生成</button>'+
      '<button onclick="downloadReport(\'full\')" style="padding:12px 14px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:12px;font-size:13px;color:#1a56db;cursor:pointer;font-weight:600">⬇ 下载完整版</button>'+
      '<button onclick="downloadReport(\'short\')" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">⬇ 下载精简版</button>'+
      '<button onclick="submitDemand()" style="flex:1;padding:12px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:650;cursor:pointer">✓ 批量提交招商需求</button>';
  }
}

/* ── 下载报告 ── */
/* 报告 Markdown → 专业排版 HTML（自包含，供 PDF 打印用） */
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

/* 生成专业排版报告并触发打印为 PDF */
function downloadReportPDF(mode){
  var rs=REPORTSTATE[cur]; var p=P();
  if(!rs||!rs.text){
    // 无产业分析报告时，下载城市智库概览文本
    if(p&&p.kb&&p.kb.length){
      var _kb=p.kb; var _city=p.city||'';
      var _titles=['主导产业与产业链','园区与承载条件','链主与存量企业','政策规划与领导关注'];
      var _lines=[_city+'城市智库概览','生成时间：'+new Date().toLocaleDateString('zh-CN'),''];
      _kb.forEach(function(sect,si){
        _lines.push((['一','二','三','四'][si]||'')+'、'+(sect.t||_titles[si]||''));
        (sect.known||[]).forEach(function(x){
          var t=_kbText(x); if(t&&!_isJunkKbItem(t)) _lines.push('  • '+t.replace('⚠️ ','').slice(0,200));
        });
        _lines.push('');
      });
      var _blob=new Blob([_lines.join('\n')],{type:'text/plain;charset=utf-8'});
      var _url=URL.createObjectURL(_blob);
      var _a=document.createElement('a');_a.href=_url;_a.download=_city+'城市智库概览.txt';
      document.body.appendChild(_a);_a.click();
      setTimeout(function(){URL.revokeObjectURL(_url);_a.remove();},300);
      toast('✓ 已下载城市智库概览（产业分析报告需先点击「产业智能分析」生成）');
      return;
    }
    toast('暂无报告，请先完成产业分析'); return;
  }
  var city=p?p.city:''; var topic=rs.topic||'';
  var date=new Date(rs.ts).toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'});
  var score=rs.score||'—';
  // 上传材料来源清单（证明基于真实数据）
  var srcs=(UPLOADS[cur]||[]).map(function(u){return u.name;});
  var bodyMd=rs.text;
  if(mode==='short'){
    var secs=[];
    rs.text.split('\n').forEach(function(l){ if(/^#{1,3}\s*[一二三四五六七八九十]+、/.test(l)||/^\s*[一二三四五六七八九十]+、/.test(l)) secs.push(l.replace(/^#+\s*/,'').trim()); });
    bodyMd='## 报告摘要\n\n'+secs.map(function(s,i){return '- '+s;}).join('\n')+'\n\n> 完整分析请见完整版报告。';
  }
  var bodyHtml=reportMdToHtml(bodyMd);
  var srcHtml=srcs.length?('<div class="src-box"><div class="src-title">数据来源 · 已授权材料</div><ul>'+srcs.map(function(s){return '<li>📎 '+s.replace(/</g,'&lt;')+'</li>';}).join('')+'</ul></div>'):'';
  var html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>'+city+'招商研判报告</title><style>'+
    '@page{size:A4;margin:20mm 18mm 18mm;}'+
    '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    'body{font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;color:#1a2332;line-height:1.85;font-size:13px;margin:0;padding:0}'+
    '.cover{padding:60px 0 40px;border-bottom:3px solid #1a56db;margin-bottom:32px}'+
    '.cover .brand{display:flex;align-items:center;gap:12px;margin-bottom:40px}'+
    '.cover .logo{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800}'+
    '.cover .bname{font-size:16px;font-weight:700;color:#0b183b}.cover .bsub{font-size:11px;color:#8492a6}'+
    '.cover h1{font-size:30px;font-weight:800;color:#0b183b;margin:0 0 10px;letter-spacing:-.5px}'+
    '.cover .subtitle{font-size:15px;color:#4a5568;margin-bottom:32px}'+
    '.cover .meta{display:flex;gap:32px;flex-wrap:wrap;font-size:12px;color:#667590}'+
    '.cover .meta b{display:block;color:#0b183b;font-size:15px;font-weight:700;margin-top:3px}'+
    '.src-box{background:#f0f6ff;border:1px solid #cfe0f5;border-radius:10px;padding:14px 18px;margin:0 0 28px}'+
    '.src-title{font-size:12px;font-weight:700;color:#1a56db;margin-bottom:8px}'+
    '.src-box ul{margin:0;padding-left:2px;list-style:none}.src-box li{font-size:12px;color:#334155;padding:2px 0}'+
    'h1,h2,h3,h4{color:#0b183b;line-height:1.4;page-break-after:avoid}'+
    'h2{font-size:19px;font-weight:750;margin:30px 0 12px;padding:8px 0 8px 14px;border-left:4px solid #1a56db;background:linear-gradient(90deg,#f0f6ff,transparent)}'+
    'h3{font-size:15px;font-weight:700;margin:20px 0 8px;color:#1a3a6b}'+
    'h4{font-size:13.5px;font-weight:700;margin:14px 0 6px}'+
    'p{margin:8px 0}ul{margin:8px 0;padding-left:22px}li{margin:4px 0}'+
    'strong{color:#0b2a5b;font-weight:700}'+
    '.num{color:#1a56db;font-weight:700}.ok{color:#16a34a}.no{color:#dc2626}.warn{color:#d97706}'+
    'table{width:100%;border-collapse:collapse;margin:14px 0;font-size:12px;page-break-inside:avoid}'+
    'th{background:#1a56db;color:#fff;font-weight:700;padding:9px 11px;text-align:left;border:1px solid #1a56db}'+
    'td{padding:8px 11px;border:1px solid #d8e0ed;color:#334155}'+
    'tbody tr:nth-child(even){background:#f6f9fe}'+
    '.footer{margin-top:40px;padding-top:16px;border-top:1px solid #d8e0ed;font-size:11px;color:#8492a6;line-height:1.7}'+
    '.footer .warn-note{color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:12px}'+
    '@media print{.noprint{display:none}}'+
    '.noprint{position:fixed;top:16px;right:16px;background:#1a56db;color:#fff;border:none;padding:12px 22px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 6px 20px rgba(26,86,219,.35)}'+
    '</style></head><body>'+
    '<button class="noprint" onclick="window.print()">⬇ 保存为 PDF</button>'+
    '<div class="cover">'+
      '<div class="brand"><div class="logo">慧</div><div><div class="bname">慧小招 · AI 招商智能体</div><div class="bsub">HUIXIAOZHAO INVESTMENT INTELLIGENCE</div></div></div>'+
      '<h1>'+city+'市招商研判报告</h1>'+
      '<div class="subtitle">'+topic+(mode==='short'?' · 精简版':' · 完整版')+'</div>'+
      '<div class="meta"><span>生成日期<b>'+date+'</b></span><span>研判置信度<b>'+score+'%</b></span><span>分析引擎<b>DeepSeek + 慧小招智库</b></span></div>'+
    '</div>'+
    srcHtml+
    '<div class="report-body">'+bodyHtml+'</div>'+
    '<div class="footer"><div class="warn-note">⚠ 本报告为 AI 辅助研判成果，基于公开信息与授权材料生成。正式招商决策须结合政府授权材料与确认。</div>'+
      '慧小招 AI 招商智能体 · '+city+'市招商局 · 生成于 '+date+'</div>'+
    '';
  // 用隐藏 iframe 打印，绕开浏览器弹窗拦截（window.open 常被拦）
  var old=document.getElementById('pdfPrintFrame'); if(old) old.remove();
  var ifr=document.createElement('iframe');
  ifr.id='pdfPrintFrame';
  ifr.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(ifr);
  var doc=ifr.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  setTimeout(function(){
    try{ ifr.contentWindow.focus(); ifr.contentWindow.print(); }
    catch(e){
      // iframe 打印失败则回退到新窗口
      var w=window.open('','_blank');
      if(w){ w.document.write(html); w.document.close(); setTimeout(function(){try{w.focus();w.print();}catch(_){}},400); }
      else toast('请允许弹窗以生成 PDF');
    }
  },400);
  toast('✓ 已生成报告，在打印对话框中选择"另存为 PDF"');
}

function downloadReport(mode){
  // 默认改为专业 PDF 打印
  return downloadReportPDF(mode);
}

function downloadReportTxt(mode){
  var rs=REPORTSTATE[cur]; var p=P();
  if(!rs||!rs.text){ toast('暂无报告'); return; }
  var city=p?p.city:'';
  var topic=rs.topic||'';
  var date=new Date(rs.ts).toLocaleDateString('zh-CN');

  var content, filename;
  if(mode==='full'){
    content=[
      city+' · '+topic+' 招商研判报告（完整版）',
      '生成时间：'+date+'  |  置信度：'+rs.score+'%',
      '数据来源：慧小招实测报告 + DeepSeek AI分析',
      '════════════════════════════════',
      '',
      rs.text,
      '',
      '════════════════════════════════',
      '⚠ 本报告为AI辅助研判，正式招商决策需结合政府授权材料与确认。',
    ].join('\n');
    filename=city+'_'+topic+'_研判报告_完整版.txt';
  } else {
    // 精简版：提取每章第一句
    var sections=[];
    rs.text.split('\n').forEach(function(l){
      var m=l.match(/^[一二三四五六七八九十]+[、]/);
      if(m) sections.push(l.replace(/^#+ */,'').trim());
    });
    content=[
      city+' · '+topic+' 招商研判报告（精简版）',
      '生成时间：'+date+'  |  置信度：'+rs.score+'%',
      '────────────────────',
      '',
    ].concat(sections.map(function(s,i){return '['+(i+1)+'] '+s;})).concat([
      '',
      '详细内容请查看完整版报告。',
      '⚠ 以上为AI初判，需干部结合实际材料确认。',
    ]).join('\n');
    filename=city+'_'+topic+'_研判报告_精简版.txt';
  }

  var blob=new Blob([content],{type:'text/plain;charset=utf-8'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a'); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click();
  setTimeout(function(){URL.revokeObjectURL(url);a.remove();},300);
  toast('✓ 报告已下载：'+filename);
}



