

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
  var context=reportExportContext(), rs=context&&context.state;
  if(!context){ toast('暂无报告，请先在产业分析页生成'); return; }
  var area = document.getElementById('reportArea');
  if(!area){
    // 不在产业分析页，跳转过去再显示
    view='report'; render();
    setTimeout(function(){ viewCurrentReport(); }, 200);
    return;
  }

  setReportAreaHtml(area,
    '<div class="industry-report" style="border-radius:14px;border:1.5px solid #bfdbfe;overflow:hidden;margin-bottom:8px">'+
      '<div class="industry-report-head" style="padding:12px 16px;background:#f8faff;border-bottom:1px solid #e8edf5;display:flex;align-items:center;gap:8px">'+
        '<span class="industry-report-title" style="font-size:13px;font-weight:700;color:#1d4ed8">📊 产业分析报告（当前正文）</span>'+
        '<span class="industry-report-topic" style="font-size:11.5px;color:#8492a6">'+context.topic.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>'+
        '<span class="industry-report-score" style="margin-left:auto;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:#f0fdf4;color:#166534">'+topicScoreDisplay(context.topic)+'</span>'+
        '<button onclick="downloadReport(\'full\')" style="padding:4px 10px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:12px;color:#1a56db;cursor:pointer;font-weight:600;margin-left:6px">⬇ 下载</button>'+
      '</div>'+
      '<div class="industry-prose" style="padding:18px 20px;font-size:13px;line-height:1.85;color:#1e293b">'+
        reportMdToHtml(context.text)+
      '</div>'+
      (typeof reportResearchSourcesHtml==='function'?reportResearchSourcesHtml(context.project,context.key):'')+
      '<div class="industry-report-foot" style="padding:10px 16px;background:#f9fafb;border-top:1px solid #f0f4ff;font-size:11px;color:#9aa5b5">'+
        '生成时间：'+new Date(rs.ts).toLocaleDateString('zh-CN')+' · '+
        '数据来源：慧小招实测报告+DeepSeek分析 · '+topicScoreDisplay(context.topic)+
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
      '<button onclick="downloadReport(\'full\')" style="padding:12px 14px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:12px;font-size:13px;color:#1a56db;cursor:pointer;font-weight:600">⬇ 下载研判报告</button>'+
      '<button onclick="downloadReport(\'short\')" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">⬇ 下载快速简报</button>'+
      reportDemandActionButton(P());
  }
}

/* ── 下载报告 ── */
/* 报告 Markdown → 专业排版 HTML（自包含，供 PDF 打印用） */
function reportMdToHtml(md){
  if(!md) return '';
  md=md.replace(/\r\n?/g,'\n').replace(/\n{3,}/g,'\n\n');
  var lines=md.split('\n'), out=[], i=0, inTable=false, tbuf=[], qbuf=[];
  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function inline(s){
    var links=[];
    s=s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,function(all,label,url){
      if(/[<>"'\\]/.test(url)||/@/.test(url.split('/').slice(0,3).join('/')))return all;
      var token='\u0000HXLINK'+links.length+'\u0000';
      links.push('<a href="'+esc(url).replace(/"/g,'&quot;')+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>');return token;
    });
    s=esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    // 关键数据高亮
    s=s.replace(/(\d[\d,.]*\s*(?:亿元|亿|万辆|万吨|万㎡|万台|GWh|km|kg|%))/g,'<span class="num">$1</span>');
    s=s.replace(/✅/g,'<span class="ok">✅</span>').replace(/❌/g,'<span class="no">❌</span>').replace(/⚠️/g,'<span class="warn">⚠️</span>');
    return s.replace(/\u0000HXLINK(\d+)\u0000/g,function(all,i){return links[Number(i)]||all;});
  }
  // PDF extraction keeps visual line wraps. Render one continuous quote while
  // preserving explicit blank paragraphs and Markdown hard line breaks.
  function quoteParagraph(rows){
    var chunks=[],text='';
    function flushText(){if(text){chunks.push(inline(text));text='';}}
    rows.forEach(function(raw){
      var slashes=(raw.match(/\\+$/)||[''])[0].length;
      var hardSpaces=/ {2,}$/.test(raw),hard=hardSpaces||slashes%2===1;
      var part=(hard&&!hardSpaces?raw.slice(0,-1):raw).trim();
      if(text&&part){
        var edge=text.slice(-1)+part.charAt(0);
        var cjk=/[\u2e80-\u9fff\uf900-\ufaff]/.test(edge);
        text+=(cjk||/[-\u2010]$/.test(text)?'':' ')+part;
      }else text+=part;
      if(hard){flushText();chunks.push('<br>');}
    });
    flushText();
    return '<p>'+chunks.join('')+'</p>';
  }
  function flushQuote(){
    if(!qbuf.length)return;
    var paragraphs=[],rows=[];
    function flushRows(){if(rows.length){paragraphs.push(quoteParagraph(rows));rows=[];}}
    qbuf.forEach(function(line){if(line.trim())rows.push(line);else flushRows();});
    flushRows();qbuf=[];
    if(paragraphs.length)out.push('<blockquote>'+paragraphs.join('')+'</blockquote>');
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
    var ln=lines[i],quote=ln.match(/^\s*>\s?(.*)$/);
    if(quote){if(inTable)flushTable();qbuf.push(quote[1]);continue;}
    flushQuote();
    if(/^\s*\|.*\|\s*$/.test(ln)){ inTable=true; tbuf.push(ln); continue; }
    else if(inTable){ flushTable(); }
    if(/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(ln)){out.push('<hr>');continue;}
    var label=ln.trim().match(/^\*\*((?:缺口[0-9一二三四五六七八九十]+[：:、]|原文第\s*\d+(?:\s*至\s*\d+)?\s*段)[^*]*)\*\*$/);
    if(label){out.push('<h4 class="keep-next">'+inline(label[1])+'</h4>');continue;}
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
  flushQuote();
  if(inTable) flushTable();
  return out.join('\n');
}

/* 所有导出从当前方向取正文；当前方向为空时禁止沿用上一方向。 */
function reportExportContext(){
  var p=P(), rs=REPORTSTATE[cur];
  if(!p||!rs) return null;
  var topic=p.topic||rs.topic||'';
  if(rs.sourceReportId&&p.reportRequestId&&rs.sourceReportId!==p.reportRequestId&&rs.topic===topic)return null;
  var text=typeof reportTextForTopic==='function' ? reportTextForTopic(topic) : (rs.topic===topic?rs.text:'');
  if(!text&&rs.topic===topic) text=rs.text;
  if(typeof text!=='string'||!text.trim()) return null;
  return {key:cur,project:p,state:rs,topic:topic,text:text,city:String(p.city||''),ts:rs.ts};
}

/* Only excerpts are selected: no model, no paraphrasing, no implied verification.
   Each excerpt is an entire original paragraph (including its conditions), with
   neighbouring qualification paragraphs and every report-wide limitation kept. */
function buildReportBrief(text){
  var rows=String(text||'').replace(/\r\n?/g,'\n').split('\n');
  var sections=[], stack=[], current=null, pending=[], ordinal=0;
  function category(title){
    var name=String(title||'').replace(/^\s*(?:[一二三四五六七八九十]+[、．.]|\d+(?:\.\d+)*[.、．)]?)\s*/,'').replace(/^附[：:]\s*/,'').trim();
    if(/^(?:本报告的)?证据边界声明|^来源限制|^时效性(?:与来源限制|提示)|^原文的整体限制/.test(name))return 'limits';
    if(/^(?:城市概况|区域基本盘|经济概况|经济运行|人口|财政)|产业总体定位$/.test(name))return 'city';
    if(/^(?:政策工具适配性|补链优先级清单|待确认事项|待核实事项汇总|核查事项|优先级最高核查项|行动与待核事项|季度.*行动|全年行动)/.test(name))return 'action';
    if(/^(?:可参照的)?政策(?:工具|意见|$)|^(?:区级|本地|国家层面)政策工具|^(?:产业政策|招商政策|支持政策|政策支持)/.test(name))return 'policy';
    if(/^(?:目标企业|企业线索|企业推荐|本市存量企业服务重点|本地企业|方向对接假设|对接假设)/.test(name))return 'enterprise';
    if(/^(?:产业基础|产业链缺口|产业判断|核心缺口|补链方向|补链抓手|制造端断点|空间组织|空间布局|园区承载)/.test(name))return 'industry';
    return null;
  }
  function qualificationHeading(title){
    var name=String(title||'').replace(/^\s*\d+(?:\.\d+)*[.、．)]?\s*/,'');
    return /^(?:适用条件|适用范围|不适用范围|申报条件|申请条件|资格条件|资格要求|限制条件|限制|补充条件|有效期|实施期限|注意事项)(?:[：:\s（(]|$)/.test(name);
  }
  function flush(){
    var value=pending.join('\n').trim();pending=[];
    if(value&&!/^[-_*]{3,}$/.test(value)){current.paragraphs.push({text:value,number:++ordinal});}
  }
  function open(title,level){
    if(current)flush();
    while(stack.length&&stack[stack.length-1].level>=level)stack.pop();
    current={title:title,level:level,parents:stack.slice(),paragraphs:[],index:sections.length};
    sections.push(current);stack.push(current);
  }
  var structured=rows.some(function(line){
    var md=line.match(/^\s*(#{1,6})\s+(.+)$/);
    return !!(md&&(md[1].length>1||category(md[2])))||/^\s*[一二三四五六七八九十]+[、．]/.test(line)||/^\s*\d+\.\d+(?:\.\d+)*\s+/.test(line);
  });
  open('',0);
  rows.forEach(function(line){
    if(!line.trim()){flush();return;}
    var markdown=line.match(/^\s*(#{1,6})\s+(.+)$/);
    var chapter=line.match(/^\s*([一二三四五六七八九十]+[、．])\s*(.+)$/);
    var subheading=line.match(/^\s*(\d+\.\d+(?:\.\d+)*)\s+([^。！？]{1,100})$/);
    if(markdown){
      // Bind qualification headings to the preceding section at their
      // own level. Chapter-wide restrictions must not disappear with an
      // unselected final subsection.
      var target=current, level=markdown[1].length;
      for(var q=stack.length-1;q>=0;q--){if(stack[q].level<=level){target=stack[q];break;}}
      var kind=category(target.title);
      if(!kind){for(var q=target.parents.length-1;q>=0;q--){kind=category(target.parents[q].title);if(kind)break;}}
      if(kind&&kind!=='limits'&&qualificationHeading(markdown[2])){
        flush();current=target;target.hasQualification=true;
        while(stack.length&&stack[stack.length-1]!==target)stack.pop();
        pending.push('#### '+markdown[2].trim());return;
      }
      open(markdown[2].trim(),markdown[1].length);return;
    }
    if(chapter){open(chapter[1]+chapter[2],2);return;}
    if(subheading){open(subheading[1]+' '+subheading[2],3);return;}
    // Older flat reports put an explicit section label before a colon. Only
    // that label determines its section; numbers and body keywords never do.
    var labelled=line.match(/^\s*(?:\d+[.、．)]\s*)?([^：:\n]{2,40})[：:]/);
    if(!structured&&labelled&&category(labelled[1])){open(labelled[1],2);pending.push(line);return;}
    if(/^\s*\|/.test(line)){
      if(pending.length&&!/^\s*\|/.test(pending[0]))flush();
      pending.push(line);return;
    }
    if(pending.length&&/^\s*\|/.test(pending[0]))flush();
    pending.push(line);
  });flush();
  sections.forEach(function(section){
    var lineage=section.parents.concat([section]);section.group=null;
    for(var i=lineage.length-1;i>=0;i--){var kind=category(lineage[i].title);if(kind){section.group=kind;break;}}
    if(!section.group&&qualificationHeading(section.title))section.group='limits';
  });
  var groups=[{key:'city',title:'城市概况',limit:2},{key:'industry',title:'产业判断与承载',limit:2},
    {key:'enterprise',title:'企业线索',limit:2},{key:'policy',title:'政策工具与适用条件',limit:2},
    {key:'action',title:'行动与待核事项',limit:2}];
  var used={}, chunks=['> 快速简报仅摘录现有正文，不新增事实。原文的待核、推断与政策条件继续适用；未列出的内容请查阅研判报告及原始研究文件。'];
  function addSection(section){
    var available=section.paragraphs.filter(function(row){return !used[row.number];});
    if(!available.length)return;
    if(section.title)chunks.push('### '+section.title);
    var first=available[0].number,last=available[available.length-1].number;
    chunks.push('**原文第 '+first+(first===last?'':' 至 '+last)+' 段**\n'+available.map(function(row){used[row.number]=true;return row.text;}).join('\n\n'));
  }
  groups.forEach(function(group){
    chunks.push('## '+group.title);
    var candidates=sections.filter(function(section){return section.group===group.key&&section.paragraphs.length;});
    var leaves=candidates.filter(function(section){return !candidates.some(function(other){return other.parents.indexOf(section)>=0;});});
    var chosen=[], roots={};
    // Cover separate original chapters before taking another subsection of
    // the same chapter. Every chosen subsection remains whole, including its
    // neighbouring conditions, uncertainty, tables and list items.
    leaves.forEach(function(section){
      var root=section.parents.filter(function(parent){return category(parent.title);})[0]||section;
      if(chosen.length<group.limit&&!roots[root.index]){chosen.push(section);roots[root.index]=true;}
    });
    leaves.forEach(function(section){if(chosen.length<group.limit&&chosen.indexOf(section)<0)chosen.push(section);});
    // An explicit qualification may govern earlier options as well (for
    // example 'all above policies'). Never drop its owning section for the
    // brevity limit; retain the subject and the complete qualification.
    leaves.forEach(function(section){if(section.hasQualification&&chosen.indexOf(section)<0)chosen.push(section);});
    chosen.sort(function(a,b){return a.index-b.index;});
    if(!chosen.length){chunks.push('现有正文未单列本项；请查看研判报告原文，不能据此认定不存在。');return;}
    chosen.forEach(function(section){
      section.parents.forEach(function(parent){if(parent.group===group.key||!parent.group)addSection(parent);});
      addSection(section);
    });
  });
  var limits=sections.filter(function(section){return section.group==='limits'&&section.paragraphs.length;});
  if(limits.length){chunks.push('## 原文的整体限制');limits.forEach(addSection);}
  // Keep explicit report-wide limitations even when a flat source did not
  // give them a separate heading. They are never used to classify a section.
  var remaining=[];
  sections.forEach(function(section){section.paragraphs.forEach(function(row){
    if(!used[row.number]&&/时效性与来源限制|来源限制总说明|本报告.*(?:仅供|不构成)|未经.*核实.*不得|数据缺失.*不得编造/.test(row.text))remaining.push(row);
  });});
  if(remaining.length){if(!limits.length)chunks.push('## 原文的整体限制');remaining.forEach(function(row){used[row.number]=true;chunks.push('**原文第 '+row.number+' 段**\n'+row.text);});}
  if(!Object.keys(used).length&&ordinal){chunks.push('## 正文摘录');sections.forEach(addSection);}
  return chunks.join('\n\n');
}

/* Material directories are frozen with a topic's text. They are not a map
   from generated claims to citations, and never read another project's live KB. */
function captureReportMaterialDirectory(key,topic){
  var p=PROJECTS[key];if(!p)return null;
  var records=[],seen=Object.create(null);
  function add(kind,value){
    if(typeof value!=='string'||!value.trim())return;
    value=value.trim();var id=kind+'\0'+value;if(seen[id])return;seen[id]=true;
    records.push({kind:kind,value:value});
  }
  (p.kb||[]).forEach(function(section){(section.known||[]).forEach(function(item){
    if(item&&typeof item==='object')add('保存材料',item.sourceFile||item.cite||item.src);
  });});
  ((typeof UPLOADS!=='undefined'&&UPLOADS[key])||[]).forEach(function(item){
    if(item&&!item.pending&&!item.parseFailed)add('上传材料',item.name);
  });
  return {contract:'saved-material-directory-v1',projectKey:key,workspaceId:p.workspaceId||key,
    topic:topic,createdAt:Date.now(),records:records};
}

function reportMaterialDirectoryForContext(context){
  var p=context.project||{},key=context.key||cur,rs=context.state||{};
  var snapshot=(rs.materialDirectoryByTopic||{})[context.topic];
  if(!snapshot||snapshot.contract!=='saved-material-directory-v1'||snapshot.topic!==context.topic||
      snapshot.reportText!==context.text||!Array.isArray(snapshot.records))return null;
  var root=p.workspaceId||key;
  if(snapshot.workspaceId!==root||(snapshot.projectKey!==key&&snapshot.projectKey!==root))return null;
  return snapshot;
}

function reportExportSourceHeading(context){
  var key=context.key||cur;
  if(typeof nativeReportState==='function'&&nativeReportState(context.topic,key))return '来源索引';
  if(typeof reportMaterialDirectoryForContext==='function'&&reportMaterialDirectoryForContext(context))return '生成时材料快照（非逐句引用）';
  if(context.project&&context.project.isDemand===true)return '该需求当前保存的材料目录（非逐句引用）';
  if((((context.state||{}).userGeneratedTopics||{})[context.topic])===true)return '当前工作区保存的材料目录（非逐句引用）';
  return '正文链接（未核验）';
}

function reportExportSourceRecords(context){
  var records=[], seen=Object.create(null), key=context.key||cur;
  function add(kind,value){
    if(typeof value!=='string'||!value.trim()) return;
    var id=kind+'\0'+value.trim();if(seen[id]) return;seen[id]=true;
    records.push({kind:kind,value:value.trim()});
  }
  var p=context.project, native=typeof nativeReportState==='function'&&nativeReportState(context.topic,key);
  if(native){
    var requestId=p.reportRequestId;
    (p.kb||[]).forEach(function(section){(section.known||[]).forEach(function(item){
      if(!item||typeof item!=='object')return;
      if(item.origin==='report'&&(!requestId||item.reportRequestId!==requestId))return;
      add('研究材料',item.sourceFile||item.cite||item.src);
    });});
    ((typeof UPLOADS!=='undefined'&&UPLOADS[key])||[]).forEach(function(item){if(item&&!item.pending&&!item.parseFailed)add('上传材料',item.name);});
  }else{
    var snapshot=typeof reportMaterialDirectoryForContext==='function'?reportMaterialDirectoryForContext(context):null;
    // Legacy custom text can expose only its own current directory, not an
    // inferred generation snapshot or another project's material directory.
    var custom=p.isDemand===true||(((context.state||{}).userGeneratedTopics||{})[context.topic])===true;
    if(!snapshot&&!((context.state||{}).materialDirectoryByTopic||{})[context.topic]&&custom&&typeof captureReportMaterialDirectory==='function')snapshot=captureReportMaterialDirectory(key,context.topic);
    (snapshot&&snapshot.records||[]).forEach(function(item){
      if(item&&typeof item==='object'&&(item.kind==='保存材料'||item.kind==='上传材料'))add(item.kind,item.value);
    });
  }
  (context.text.match(/https?:\/\/[^\s<>()（）\[\]，。；]+/g)||[]).forEach(function(url){add(native?'正文引用':'正文链接（未核验）',url);});
  return records;
}

/* Prepare a same-origin printable document, then wait for its load/fonts.
   The success message refers to print readiness, never a file already saved. */
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

/* 当前正文 PDF 与原始研究 Word 是不同文件，不再用“完整版”混称。 */
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
  var sourceHeading=typeof reportExportSourceHeading==='function'?reportExportSourceHeading(context):'来源索引';
  var body=mode==='short'?buildReportBrief(context.text):context.text;
  var html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>'+esc(city+' · '+kind)+'</title><style>'+
    '@page{size:A4;margin:16mm 17mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    'body{font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;color:#1e293b;line-height:1.75;font-size:11px;margin:0;overflow-wrap:anywhere}'+
    '.cover{padding:0 0 14px;border-bottom:2px solid #1a56db;margin-bottom:18px;break-inside:avoid}.brand{font-size:12px;font-weight:700;color:#1a56db;margin-bottom:12px}'+
    'h1{font-size:24px;line-height:1.4;margin:0 0 7px;color:#0b183b}.subtitle{font-size:13px;margin-bottom:10px}.meta{font-size:10px;color:#667590}'+
    'h2,h3,h4{color:#0b183b;break-after:avoid;page-break-after:avoid;line-height:1.4}h2{font-size:15px;border-bottom:1px solid #dbeafe;margin:20px 0 10px;padding-bottom:6px}h3,h4{font-size:12px}'+
    'blockquote{margin:8px 0;padding:2px 10px;border-left:3px solid #cbd5e1;color:#334155}blockquote p{margin:3px 0}hr{border:0;border-top:1px solid #dbeafe;margin:14px 0}.keep-next{break-after:avoid;page-break-after:avoid}p{margin:7px 0;orphans:3;widows:3}ul{padding-left:20px}li{margin:4px 0}table{width:100%;border-collapse:collapse;font-size:10px;margin:10px 0}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #d8e0ed;padding:6px;text-align:left;overflow-wrap:anywhere}th{background:#edf4ff}'+
    '.num{color:#1a56db;font-weight:600}.source-list{font-size:9px;line-height:1.4;color:#475569;margin-top:6px;break-inside:auto;page-break-inside:auto}.source-list h2{font-size:11px;margin:6px 0 3px;padding-bottom:3px}.source-items{margin:0;orphans:1;widows:1}.source-item{overflow-wrap:anywhere}a{color:#174b91;text-decoration:underline}'+
    '.report-end{break-inside:auto;page-break-inside:auto;margin-top:6px;padding-top:4px;border-top:1px solid #d8e0ed;color:#667590;font-size:9px}.report-end p{margin:0;orphans:1;widows:1}'+
    '</style></head><body><header class="cover"><div class="brand">慧小招 · 招商研判</div><h1>'+esc(city)+' · '+kind+'</h1><div class="subtitle">'+esc(topic)+'</div><div class="meta">生成时间：'+esc(date)+' · '+statusHtml+'</div><p class="meta">'+(mode==='short'?'现有正文摘录，保留原文条件与不确定性。':'当前方向已保存正文；原始研究文件请从报告文件入口下载。')+'</p></header>'+
    '<main>'+reportMdToHtml(body)+'</main>'+
    (sources.length?'<section class="source-list"><h2>'+esc(sourceHeading)+'</h2><p class="source-items">'+sources.map(function(source){return '<span class="source-item">'+esc(source.kind)+'：'+(/^https?:\/\//.test(source.value)?'<a href="'+esc(source.value)+'">'+esc(source.value)+'</a>':esc(source.value))+'</span>';}).join('； ')+'</p></section>':'<p class="source-list">未保存独立来源索引，请逐项核对正文中的来源说明。</p>')+
    '<footer class="report-end"><p>本报告为 AI 辅助研判；待核、推断、政策有效期和适用条件仍需逐项确认。 · 慧小招 · '+esc(city)+' · '+esc(date)+'</p></footer></body></html>';
  printReportDocument(html);
}

function downloadReport(mode){return downloadReportPDF(mode);}

function downloadReportTxt(mode){
  var context=reportExportContext();if(!context){toast('当前方向暂无报告');return;}
  var kind=mode==='short'?'快速简报':'研判报告';
  var text=mode==='short'?buildReportBrief(context.text):context.text;
  var content=[context.city+' · '+context.topic+' · '+kind,
    '生成时间：'+(context.ts?new Date(context.ts).toLocaleDateString('zh-CN'):'未记录'),
    (!nativeReportState(context.topic)&&!(context.state.evidenceStatusByTopic&&context.state.evidenceStatusByTopic[context.topic]==='unreviewed')&&typeof context.state.score==='number')?'置信度：'+context.state.score+'%':(typeof topicScoreDisplay==='function'?topicScoreDisplay(context.topic):'内容待核验'),'',text,'',
    (typeof reportExportSourceHeading==='function'?reportExportSourceHeading(context):'来源索引')+'：'].concat(reportExportSourceRecords(context).map(function(source){return source.kind+'：'+source.value;})).concat([
    '', '本文件来自当前方向已保存正文，待核结论与政策条件继续适用。原始研究文件请从报告文件入口下载。']).join('\n');
  var filename=context.city+'_'+context.topic+'_'+kind+'.txt';
  var blob=new Blob([content],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob);
  var a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(url);a.remove();},300);
  toast('已下载：'+filename);
}
