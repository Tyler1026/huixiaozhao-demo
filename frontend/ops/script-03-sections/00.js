


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
        '<span style="margin-left:auto;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:#f0fdf4;color:#166534">置信度 '+rs.score+'%</span>'+
        (origReportFiles()?'<button onclick="downloadOrigReport(\'full\')" style="padding:4px 10px;background:#eef2ff;border:1.5px solid #c7d2fe;border-radius:8px;font-size:12px;color:#4338ca;cursor:pointer;font-weight:600;margin-left:6px">⬇ 原始报告(docx)</button>':'')+
        '<button onclick="downloadReport(\'full\')" style="padding:4px 10px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:12px;color:#1a56db;cursor:pointer;font-weight:600;margin-left:6px">⬇ 研判摘要</button>'+
      '</div>'+
      '<div style="padding:18px 20px;font-size:13px;line-height:1.85;color:#1e293b">'+
        '<p style="margin:0">'+md(rs.text)+'</p>'+
      '</div>'+
      '<div style="padding:10px 16px;background:#f9fafb;border-top:1px solid #f0f4ff;font-size:11px;color:#9aa5b5">'+
        '生成时间：'+new Date(rs.ts).toLocaleDateString('zh-CN')+' · '+
        '数据来源：慧小招实测报告+DeepSeek分析 · 置信度'+rs.score+'%'+
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
        ? '<button onclick="downloadOrigReport(\'full\')" style="padding:12px 14px;background:#eef2ff;border:1.5px solid #c7d2fe;border-radius:12px;font-size:13px;color:#4338ca;cursor:pointer;font-weight:600">⬇ 原始报告(docx)</button>'+
          '<button onclick="downloadOrigReport(\'short\')" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">⬇ 精简版(docx)</button>'
        : '<button onclick="downloadReport(\'full\')" style="padding:12px 14px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:12px;font-size:13px;color:#1a56db;cursor:pointer;font-weight:600">⬇ 下载研判摘要</button>')+
      '<button onclick="submitDemand()" style="flex:1;padding:12px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:650;cursor:pointer">✓ 确认方向，提交招引需求</button>';
  }
}

/* ── 查找当前项目的原始报告文件（流水线产出的 docx，推送RAG时上传到云端）── */
function origReportFiles(){
  var p=P(); if(!p) return null;
  if(p.reportFiles && p.reportFiles.length) return p.reportFiles;
  // 回退：从申请队列里找该城市 done 且带 files 的最近一条
  var done=(typeof REPORT_REQUESTS!=='undefined'?REPORT_REQUESTS:[])
    .filter(function(r){return r.city===p.city && r.files && r.files.length;});
  return done.length ? done[done.length-1].files : null;
}
/* ── 需求池行内下载：按申请 id 定位城市 → 拉云端原始 docx ── */
function downloadReqFile(reqId, kind){
  var r=(typeof REPORT_REQUESTS!=='undefined'?REPORT_REQUESTS:[]).filter(function(x){return x.id===reqId;})[0];
  if(!r || !r.files || !r.files.length){ toast('暂无原始报告文件'); return; }
  kind=kind||'full';
  var meta=r.files.filter(function(m){return m.kind===kind;})[0] || r.files[0];
  var url='/api/report-file?city='+encodeURIComponent(r.city)+'&kind='+encodeURIComponent(kind);
  var a=document.createElement('a'); a.href=url; a.download=meta.name||(r.city+'_报告.docx');
  document.body.appendChild(a); a.click();
  setTimeout(function(){a.remove();},300);
  toast('✓ 正在下载原始报告：'+(meta.name||(r.city+'_报告.docx')));
}
/* ── 下载原始报告：直接从云端拉流水线产出的原始 docx ── */
function downloadOrigReport(kind){
  var p=P(); if(!p){ toast('未选择项目'); return; }
  kind=kind||'full';
  var files=origReportFiles();
  var meta=files && (files.filter(function(m){return m.kind===kind;})[0] || files[0]);
  if(!meta){ toast('暂无原始报告文件，请先在需求池「推送到 RAG」'); return; }
  var url='/api/report-file?city='+encodeURIComponent(p.city)+'&kind='+encodeURIComponent(kind);
  var a=document.createElement('a'); a.href=url; a.download=meta.name||(p.city+'_报告.docx');
  document.body.appendChild(a); a.click();
  setTimeout(function(){a.remove();},300);
  toast('✓ 正在下载原始报告：'+(meta.name||(p.city+'_报告.docx')));
}
/* ── 下载报告 ── */
function downloadReport(mode){
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
      '⚠ 本报告为AI辅助研判，正式招商决策需结合政府授权材料与领导确认。',
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



