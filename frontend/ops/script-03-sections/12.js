/* ===== 主区视图 ===== */
function mainPane(p){
  if(view==='knowledge')return kbPage(p);
  if(view==='settings')return settingsPage(p);
  if(view==='report')return homePage(p);      // 研判需求：出报告的对话工作区
  if(view==='docking')return dockingPage(p);   // 招商对接：独立tab
  if(view==='subwork')return subWorkPage(p);   // 招引项目独立工作页
  return projMgmtPage(p);                       // home = 项目管理（默认）
}
// 项目管理：项目列表切换（AI对话分类式）+ 进入项目工作区
/* ══════════════════════════════════════════════════════════════
   企业线索管理 — projMgmtPage 完整重写
   数据源：PROJECTS[k].clues[]
   每条 clue: {id, name, kind, region, source, status, tone, reason, signal, questions:[]}
   tone: 'slate'待接触 / 'amber'核验中 / 'teal'可安排沟通
   ══════════════════════════════════════════════════════════════ */

/* ── 从研判报告文本派生候选线索 ── */

/* ── 从报告文本提取缺口（供通用城市动态扫描用）── */
function extractGapsForScan(p){
  var gaps=[];
  var rsx=(typeof REPORTSTATE!=='undefined')?(REPORTSTATE[p.id]||REPORTSTATE[cur]):null;
  var text=rsx&&rsx.text||'';
  if(text){
    var lines=text.split('\n'); var inTop5=false;
    for(var i=0;i<lines.length;i++){
      var l=lines[i];
      if(l.indexOf('补链优先级')>=0||l.indexOf('TOP5')>=0||l.indexOf('优先级清单')>=0)inTop5=true;
      if(inTop5&&l.trim().charAt(0)==='|'){
        var cells=l.trim().slice(1,-1).split('|').map(function(c){return c.replace(/[*★]/g,'').trim();});
        if(cells.every(function(c){return /^[\s\-:]+$/.test(c);})||cells[0]==='排名'||cells[0]==='缺口节点')continue;
        var rank=parseInt(cells[0]); if(!isNaN(rank)&&cells[1])gaps.push(cells[1]);
      }
      if(inTop5&&gaps.length>=4)break;
    }
    if(!gaps.length){
      lines.forEach(function(l){
        if(l.indexOf('❌')>=0&&gaps.length<4){
          var c=l.replace(/^[*\-•|#\s]+/,'').replace(/❌|\*\*/g,'').replace('缺失','').trim();
          c=c.split(/[（(，,：:]/)[0].trim();
          if(c.length>=3&&c.length<30)gaps.push(c);
        }
      });
    }
  }
  if(!gaps.length)gaps=['核心零部件配套','关键系统集成','精深加工延链','智能装备升级'];
  return gaps.slice(0,4);
}

/* AI 企业漏斗 — 真实调用 DeepSeek(/api/kb-chat mode=funnel) 按项目分析，不用任何硬编码企业库 */
var _funnelRunning = {};
var KB_API_OPS = '/api/kb-chat';
function _funnelInput(p){
  var rsx=(typeof REPORTSTATE!=='undefined')?(REPORTSTATE[p.id]||REPORTSTATE[cur]):null;
  var text=(rsx&&rsx.text)||'';
  var gaps=[]; try{ gaps=extractGapsForScan(p); }catch(e){}
  return {text:text, gaps:gaps};
}
function runAIFunnel(projKey, done, onProgress){
  var p=PROJECTS[projKey]; if(!p){ done&&done('no project'); return; }
  if(_funnelRunning[projKey]){ return; }
  _funnelRunning[projKey]=true;
  var inp=_funnelInput(p); var topic=p.topic||'';
  var q='招商方向：'+topic+' 城市：'+(p.city||'')+'\n\n产业研判报告：\n'+(inp.text? inp.text.slice(0,4000) : '（暂无完整报告，请基于招商方向与常识分析）')+'\n\n已识别缺口：'+(inp.gaps&&inp.gaps.length?inp.gaps.join('、'):'（见报告）')+'\n\n请针对该招商方向筛选真实存在的适配企业构成企业漏斗，目标40家（至少30家）。每家企业按评分卡分别给出 score_match(0-40)/score_relocate(0-30)/score_strength(0-30) 三项分数；如企业有明确扩张需求或领导与本城市/本省有可考的派系关联（校友/籍贯/商会等），填 expansion/faction 字段，无则留空、严禁编造。严格按 SYSTEM 要求输出 JSON。';
  fetch(KB_API_OPS,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q, city:(p.city||''), chunks:[], stream:true, mode:'funnel'})})
  .then(function(resp){
    if(!resp.ok){ _funnelRunning[projKey]=false; return resp.json().then(function(e){ done&&done('服务繁忙或超时，请重试（'+((e&&e.error)||resp.status)+'）'); }).catch(function(){ done&&done('服务繁忙或超时，请重试'); }); }
    var acc='';
    function _finishFunnel(content){
      _funnelRunning[projKey]=false;
      if(!content){ done&&done('模型未返回内容，请重试'); return; }
      var obj=_parseFunnelJson(content);
      if(!obj||!obj.companies||!obj.companies.length){ done&&done('parse'); return; }
      var _num=function(v,max){var n=(typeof v==='number')?v:parseInt(v)||0; if(n<0)n=0; if(n>max)n=max; return n;};
      var companies=obj.companies.map(function(c,i){
        var sm=_num(c.score_match,40), sr=_num(c.score_relocate,30), ss=_num(c.score_strength,30);
        var total=sm+sr+ss; if(total>100)total=100;
        return {id:_funnelClueId(projKey, c.name, i), name:c.name||'', region:c.region||'', kind:c.kind||'', fit:c.fit||'',
          score_match:sm, score_relocate:sr, score_strength:ss, score_reason:c.score_reason||'',
          fit_score:total,
          signal:c.signal||'', expansion:c.expansion||'', faction:c.faction||'',
          listed:c.listed||'', source:c.source||'公开信息（AI推断，待核验）'};
      }).filter(function(c){return c.name;}).sort(function(a,b){
        if(b.fit_score!==a.fit_score) return b.fit_score-a.fit_score;
        var fa=(a.expansion?1:0)+(a.faction?1:0), fb=(b.expansion?1:0)+(b.faction?1:0);
        return fb-fa;
      });
      PROJECTS[projKey].funnel={ ts:Date.now(), topic:obj.topic||topic, total:(obj.total_scanned||companies.length), companies:companies, pushed:false };
      persist(); done&&done(null, PROJECTS[projKey].funnel);
    }
    if(!resp.body||!resp.body.getReader){ return resp.text().then(function(txt){ txt.split('\n').forEach(function(line){ if(line.indexOf('data:')!==0) return; var d=line.slice(5).trim(); if(d==='[DONE]'||!d) return; try{ var j=JSON.parse(d); var dt=(j.choices&&j.choices[0]&&((j.choices[0].delta&&j.choices[0].delta.content)||(j.choices[0].message&&j.choices[0].message.content)))||''; acc+=dt; }catch(_){}}); _finishFunnel(acc); }); }
    var reader=resp.body.getReader(), decoder=new TextDecoder(), buf='';
    function pump(){
      return reader.read().then(function(d){
        if(d.done){ _finishFunnel(acc); return; }
        buf+=decoder.decode(d.value,{stream:true});
        var lines=buf.split('\n'); buf=lines.pop();
        lines.forEach(function(line){
          if(line.indexOf('data:')!==0) return;
          var dd=line.slice(5).trim();
          if(dd==='[DONE]'||!dd) return;
          try{ var j=JSON.parse(dd); var delta=(j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content)||''; if(delta) acc+=delta; }catch(_){}
        });
        if(onProgress){ var pct=Math.min(90, 5+Math.round(acc.length/15000*85)); try{ onProgress(pct, acc); }catch(_){} }
        return pump();
      });
    }
    return pump();
  }).catch(function(e){ _funnelRunning[projKey]=false; done&&done(e&&e.message||'network'); });
}
function _parseFunnelJson(s){
  if(!s) return null; var t=String(s).trim();
  t=t.replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'');
  try{ return JSON.parse(t); }catch(e){}
  var a=t.indexOf('{'), b=t.lastIndexOf('}');
  if(a>=0&&b>a){ try{ return JSON.parse(t.slice(a,b+1)); }catch(e){} }
  return null;
}
/* 【2026-09-22 修复 P0】clue 身份与墓碑口径必须与政府端 index.html 完全一致。
   旧 id 'f_'+projKey+'_'+下标 跨漏斗复用：上一批删掉的企业留下的墓碑，会在下一批
   把恰好排到同一下标的新企业静默吃掉（实测诺唯赞生物 88 分被吞）。
   现在 id 由企业名派生（跨次重跑稳定），墓碑按企业名匹配，位置型旧 id 墓碑失效。 */
function _clueNameKey(name){
  if(name==null) return '';
  return String(name).replace(/[\uff08(][^\uff09)]*[\uff09)]\s*$/,'').replace(/\s+/g,'').trim();
}
function _isReusableClueId(clueId){
  return /^f_.+_\d+$/.test(String(clueId==null?'':clueId));
}
function _clueTombKey(projKey, clue){
  var nm=(clue&&typeof clue==='object')?clue.name:clue;
  var nk=_clueNameKey(nm);
  if(nk) return String(projKey)+'::@'+nk;
  var id=(clue&&typeof clue==='object')?clue.id:clue;
  return String(projKey)+'::'+String(id);
}
function isClueDeleted(projKey, clue){
  var t=window.DELETED_CLUES||[];
  if(!t.length) return false;
  var isObj=(clue&&typeof clue==='object');
  var nm=isObj?clue.name:null;
  var id=isObj?clue.id:clue;
  if(_clueNameKey(nm) && t.indexOf(_clueTombKey(projKey, clue))>=0) return true;
  if(id!=null && !_isReusableClueId(id) && t.indexOf(String(projKey)+'::'+String(id))>=0) return true;
  return false;
}
function _funnelClueId(projKey, name, idx){
  var nk=_clueNameKey(name);
  if(!nk) return 'f_'+projKey+'_n0_'+idx;
  var h=0;
  for(var i=0;i<nk.length;i++){ h=((h<<5)-h+nk.charCodeAt(i))|0; }
  return 'f_'+projKey+'_n'+(h>>>0).toString(36);
}

function pushFunnelTopToGov(projKey, n){
  var p=PROJECTS[projKey]; if(!p||!p.funnel||!p.funnel.companies.length){ toast('请先运行 AI 漏斗分析'); return; }
  n=n||8; var top=p.funnel.companies.slice(0, n);
  if(!p.clues) p.clues=[];
  var existNames={}; (p.clues||[]).forEach(function(c){ if(c.name) existNames[c.name]=1; });
  // 政府端已手动移除的企业不再推回（否则「删了又回来」）。判定按企业名，
  // 不能按 c.id：位置型 id 跨漏斗复用，会误杀本批的新企业。
  var added=0, skipped=0, skippedNames=[];
  top.forEach(function(c){
    if(existNames[c.name]) return;
    if(isClueDeleted(projKey, c)){ skipped++; skippedNames.push(c.name||'未命名企业'); return; }
    p.clues.push({id:c.id, name:c.name, kind:c.kind, region:c.region, gap:p.funnel.topic||p.topic||'', tone:'slate', status:'gov_push', fit:c.fit, fit_score:c.fit_score, score_match:c.score_match, score_relocate:c.score_relocate, score_strength:c.score_strength, score_reason:c.score_reason, expansion:c.expansion, faction:c.faction, reason:c.fit||('AI 漏斗按「'+(p.funnel.topic||p.topic||'该方向')+'」精筛，适配度 '+(c.fit_score||0)+' 分，建议资源团队核验投资意向。'), signal:c.signal, listed:c.listed, source:c.source, scale:(c.listed?c.listed+' · ':'')+(c.region||''), techRoute:c.fit||'', signalSrc:c.source||'AI推断，待核验', matchPoints:[c.fit].filter(Boolean), questions:['是否有在'+(p.city||'本地')+'布局/投资意向','与本地链主的配套匹配度','落地所需政策与承载条件'], priority:Math.max(1,Math.min(5,Math.round((c.fit_score||0)/20))), localAttr:'B'});
    added++;
  });
  p.funnel.pushed=true; p.funnel.pushedAt=Date.now(); p.funnel.pushedNames=top.map(function(c){return c.name;});
  persist(); render();
  toast('已把 '+added+' 家精准适配企业推送到政府端「待接触企业」'+(skipped?'（跳过 '+skipped+' 家已被政府端移除：'+skippedNames.join('、')+'）':''));
}

function toggleFunnelExpand(k){
  if(!window.__funnelExpand) window.__funnelExpand={};
  window.__funnelExpand[k]=!window.__funnelExpand[k];
  try{ render(); }catch(e){}
}

/* 企业线索来源：读真实 AI 漏斗结果（p.funnel.companies），不再有硬编码 */
function computeScanClues(p){
  if(!p||!p.funnel||!p.funnel.companies) return [];
  return p.funnel.companies.map(function(c){
    return {id:c.id, gap:(p.funnel.topic||p.topic||''), name:c.name, kind:c.kind, region:c.region,
      scale:(c.listed?c.listed+' · ':'')+(c.region||''), techRoute:c.fit||'',
      signal:c.signal||'', signalSrc:c.source||'AI推断，待核验', hasMoveSignal:!!c.signal,
      matchPoints:[c.fit].filter(Boolean),
      questions:['是否有在'+(p.city||'本地')+'布局/投资意向','与本地链主的配套匹配度','落地所需政策与承载条件'],
      priority:Math.max(1,Math.min(5,Math.round((c.fit_score||0)/20))), localAttr:'B', status:'ai_scan',
      fit_score:c.fit_score};
  });
}

/* ── 企业线索两栏布局渲染 ── */
function renderCluesTwoPanel(projKey){
  var p = PROJECTS[projKey]; if(!p) return '';
  var manualClues = (p.clues||[]).filter(function(c){return c.status!=='ai_scan';});
  var aiClues     = (p.clues||[]).filter(function(c){return c.status==='ai_scan';});

  // AI 企业漏斗栏
  var fn = p.funnel;
  var running = _funnelRunning[projKey];
  var funnelHead = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'+
      '<div style="display:flex;align-items:center;gap:6px">'+
        '<span style="width:8px;height:8px;border-radius:50%;background:#6366f1"></span>'+
        '<span style="font-size:12px;font-weight:750;color:#0b183b;letter-spacing:.3px">AI 企业漏斗</span>'+
      '</div>'+
      (fn?'<span style="font-size:11px;padding:2px 7px;background:#f5f3ff;color:#6d28d9;border-radius:10px">扫描'+ (fn.total||fn.companies.length) +'家 · 精筛'+fn.companies.length+'家</span>':'')+
      '<div style="flex:1"></div>'+
      (fn&&fn.companies&&fn.companies.length?'<button onclick="showFunnelPyramid(\''+projKey+'\')" style="padding:4px 10px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:11.5px;color:#1a56db;cursor:pointer;font-weight:600;margin-right:8px">📊 分级图谱</button>':'')+
      (running?'<span style="font-size:11.5px;color:#6d28d9">⏳ 分析中…</span>':'<button onclick="loadAIScanClues(\''+projKey+'\')" style="padding:4px 10px;background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:8px;font-size:11.5px;color:#6d28d9;cursor:pointer;font-weight:600">🔄 重新分析</button>')+
    '</div>';
  var funnelBody;
  if(running && !fn){
    funnelBody='<div style="text-align:center;padding:22px;background:#faf9ff;border-radius:10px;border:1px solid #ede9fe;font-size:12.5px;color:#6d28d9">⏳ AI 正在按该方向缺口分析适配企业，约需 1-2 分钟…</div>';
  } else if(!fn){
    funnelBody='<div style="text-align:center;padding:20px;background:#f9fafb;border-radius:10px;border:1px solid #e8edf5">'+
      '<div style="font-size:12.5px;color:#9aa5b5;margin-bottom:8px">尚未生成企业漏斗</div>'+
      '<button onclick="loadAIScanClues(\''+projKey+'\')" style="padding:6px 14px;background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:8px;font-size:12px;color:#6d28d9;cursor:pointer;font-weight:600">🔍 立即 AI 分析</button>'+
    '</div>';
  } else {
    var pushedTip = fn.pushed
      ? '<span style="font-size:11px;color:#166534;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:3px 9px">✓ 已推送 '+(fn.pushedNames?fn.pushedNames.length:0)+' 家到政府端</span>'
      : '';
    var pushBtn = '<button onclick="pushFunnelTopToGov(\''+projKey+'\',8)" style="padding:7px 14px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:8px;font-size:12.5px;font-weight:650;cursor:pointer">🚀 推送 Top8 精准企业到政府端</button>';
    funnelBody='<div style="margin-bottom:10px;display:flex;align-items:center;gap:10px">'+pushBtn+pushedTip+'</div>'+
      aiClues.slice(0,20).map(function(c,ci){ return scanClueCard(c, projKey, ci); }).join('')+
      (aiClues.length>20?'<div style="text-align:center;font-size:11.5px;color:#9aa5b5;padding:8px">共 '+aiClues.length+' 家，已展示适配度最高的前 20 家</div>':'');
  }
  var aiPanel = '<div>'+funnelHead+funnelBody+'</div>';

  // 手动录入栏
  var manualPanel = '<div style="margin-top:20px">'+
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'+
      '<div style="display:flex;align-items:center;gap:6px">'+
        '<span style="width:8px;height:8px;border-radius:50%;background:#22c55e"></span>'+
        '<span style="font-size:12px;font-weight:750;color:#0b183b;letter-spacing:.3px">慧小招团队推荐</span>'+
      '</div>'+
      '<span style="font-size:11px;padding:2px 7px;background:#f0fdf4;color:#166534;border-radius:10px">'+manualClues.length+'家</span>'+
      '<span style="font-size:11px;color:#9aa5b5;margin-left:2px">· 人工核验，可直接对接</span>'+
      '<div style="flex:1"></div>'+
      '<button onclick="addClueManual(\''+projKey+'\')" style="padding:4px 10px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;font-size:11.5px;color:#166534;cursor:pointer;font-weight:600">+ 录入</button>'+
    '</div>'+
    (manualClues.length
      ? manualClues.map(function(c,ci){ return clueCard(c, projKey, ci); }).join('')
      : '<div style="text-align:center;padding:16px;background:#f9fafb;border-radius:10px;border:1px solid #e8edf5;font-size:12.5px;color:#9aa5b5">暂无团队推荐企业 · 点击「+ 录入」添加</div>'
    )+
  '</div>';

  return aiPanel + manualPanel;
}

/* ── AI 扫描企业卡片（展开/折叠，带优先级标签）── */
function scanClueCard(clue, projKey, idx){
  var isExpanded = (window.__clueOpen === clue.id);
  var priorityColor = clue.priority>=5?'#dc2626':clue.priority>=4?'#d97706':clue.priority>=3?'#2563eb':'#6b7280';
  var priorityBg    = clue.priority>=5?'#fee2e2':clue.priority>=4?'#fef3c7':clue.priority>=3?'#dbeafe':'#f5f7fb';
  var localAttrMap  = {A:{label:'A 必须本地',bg:'#fee2e2',color:'#991b1b'},B:{label:'B 可跨区域',bg:'#dbeafe',color:'#1e3a8a'},C:{label:'C 优先本地',bg:'#d1fae5',color:'#064e3b'}};
  var la = localAttrMap[clue.localAttr]||localAttrMap.B;

  var stars='';
  for(var i=0;i<5;i++) stars+=(i<clue.priority?'★':'☆');

  var expandedDetail = isExpanded
    ? '<div style="padding:12px 16px 14px;border-top:1px solid #e8edf5;background:#fafbff">'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'+
          '<div>'+
            '<div style="font-size:10.5px;font-weight:650;color:#6b7280;letter-spacing:.3px;margin-bottom:4px">规模/背景</div>'+
            '<div style="font-size:12.5px;color:#1f2937">'+clue.scale+'</div>'+
          '</div>'+
          '<div>'+
            '<div style="font-size:10.5px;font-weight:650;color:#6b7280;letter-spacing:.3px;margin-bottom:4px">技术路线</div>'+
            '<div style="font-size:12.5px;color:#1f2937">'+clue.techRoute+'</div>'+
          '</div>'+
        '</div>'+
        '<div style="margin-bottom:10px">'+
          '<div style="font-size:10.5px;font-weight:650;color:#6b7280;letter-spacing:.3px;margin-bottom:4px">扩产/动向信号</div>'+
          '<div style="padding:8px 10px;background:#fffbeb;border-radius:8px;border:1px solid #fde68a">'+
            '<div style="font-size:12.5px;color:#92400e">'+clue.signal+'</div>'+
            '<div style="font-size:11px;color:#b45309;margin-top:3px">来源：'+clue.signalSrc+'</div>'+
          '</div>'+
        '</div>'+
        '<div style="margin-bottom:10px">'+
          '<div style="font-size:10.5px;font-weight:650;color:#6b7280;letter-spacing:.3px;margin-bottom:6px">为什么值得核验</div>'+
          clue.matchPoints.map(function(mp,mi){
            return '<div style="display:flex;gap:6px;padding:4px 0">'+
              '<span style="color:#22c55e;flex-shrink:0">✓</span>'+
              '<span style="font-size:12.5px;color:#374151">'+mp+'</span>'+
            '</div>';
          }).join('')+
        '</div>'+
        '<div style="margin-bottom:12px">'+
          '<div style="font-size:10.5px;font-weight:650;color:#6b7280;letter-spacing:.3px;margin-bottom:5px">核验问题</div>'+
          clue.questions.map(function(q,qi){
            return '<div style="display:flex;gap:6px;padding:5px 0;border-bottom:1px solid #f3f4f6">'+
              '<span style="color:#9aa5b5;flex-shrink:0;font-size:12px">'+(qi+1)+'.</span>'+
              '<span style="font-size:12.5px;color:#374151">'+q+'</span>'+
            '</div>';
          }).join('')+
        '</div>'+
        '<div style="display:flex;gap:8px">'+
          '<button onclick="convertToClue(\''+projKey+'\',\''+clue.id+'\')" '+
            'style="flex:1;padding:8px;background:#fffbeb;border:1.5px solid #fde68a;border-radius:8px;font-size:12.5px;font-weight:600;color:#92400e;cursor:pointer">'+
            '🔍 请资源团队核验</button>'+
          '<button onclick="dismissScanClue(\''+projKey+'\',\''+clue.id+'\')" '+
            'style="padding:8px 12px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:8px;font-size:12.5px;color:#6b7280;cursor:pointer">'+
            '暂不跟进</button>'+
        '</div>'+
        '<div style="margin-top:8px;font-size:11px;color:#9aa5b5">'+
          'ⓘ AI扫描数据截至2026-07，信号来源均可溯源；企业真实投资意向需资源团队人工核验'+
        '</div>'+
      '</div>'
    : '';

  return '<div style="border-radius:12px;border:1.5px solid #e8edf5;overflow:hidden;background:#fff;margin-bottom:8px">'+
    '<button onclick="toggleClue(\''+clue.id+'\')" '+
      'style="width:100%;display:flex;align-items:center;gap:10px;padding:11px 14px;background:'+(isExpanded?'#fafbff':'#fff')+';border:none;cursor:pointer;text-align:left">'+
      '<div style="flex:1;min-width:0">'+
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">'+
          '<span style="font-size:13px;font-weight:700;color:#0b183b">'+clue.name+'</span>'+
          '<span style="padding:1px 6px;background:'+priorityBg+';color:'+priorityColor+';border-radius:4px;font-size:11px;font-weight:700">'+stars+'</span>'+
          '<span style="padding:1px 6px;background:'+la.bg+';color:'+la.color+';border-radius:4px;font-size:10.5px;font-weight:600">'+la.label+'</span>'+
        '</div>'+
        '<div style="font-size:12px;color:#8492a6">'+clue.kind+' · '+clue.region+' · 补「'+clue.gap+'」缺口</div>'+
      '</div>'+
      '<span style="font-size:12px;color:#9aa5b5;flex-shrink:0">'+(isExpanded?'▲':'▼')+'</span>'+
    '</button>'+
    expandedDetail+
  '</div>';
}

/* ── 把 AI 扫描线索转为正式核验线索 ── */
function convertToClue(projKey, clueId){
  var p = PROJECTS[projKey]; if(!p) return;
  if(!p.clues) p.clues=[];
  // 在 ai_scan 池里找
  var sc = (p.clues||[]).find(function(c){return c.id===clueId;});
  if(sc){
    sc.status='amber'; // 核验中
    sc.tone='amber';
    p.stage=Math.max(p.stage,4);
    persist();
    render();
    toast('✓ 已发起资源核验，线索进入核验中状态');
  }
}

/* ── 暂不跟进 ── */
function dismissScanClue(projKey, clueId){
  var p = PROJECTS[projKey]; if(!p) return;
  p.clues=(p.clues||[]).filter(function(c){return c.id!==clueId;});
  persist(); render();
  toast('已移除该扫描线索');
}

/* ── 加载 AI 扫描结果到项目 ── */
function loadAIScanClues(projKey){
  // 触发真实 AI 企业漏斗分析（不再用硬编码假数据）
  var p=PROJECTS[projKey]; if(!p) return;
  if(_funnelRunning[projKey]){ toast('AI 正在分析中，请稍候…'); return; }
  showFunnelProgressModal(projKey);
  runAIFunnel(projKey, function(err, funnel){
    if(err){ closeFunnelProgressModal(); toast('AI 漏斗分析失败：'+err); return; }
    try{ renderOpsV2&&renderOpsV2(); }catch(e){ try{render();}catch(_){}}
    updateFunnelProgress(100);
    setTimeout(function(){ closeFunnelProgressModal(); try{ showFunnelDoneModal(projKey, funnel); }catch(e){ toast('✓ AI 漏斗完成，共精筛 '+funnel.companies.length+' 家适配企业'); } }, 420);
  }, function(pct){ updateFunnelProgress(pct); });
}

/* ── AI 漏斗分析完成提醒弹窗 ── */
function showFunnelDoneModal(projKey, funnel){
  var p=PROJECTS[projKey]||{};
  var total=funnel.total||funnel.companies.length;
  var n=funnel.companies.length;
  var top=funnel.companies.slice(0,3);
  var withSignal=funnel.companies.filter(function(c){return c.expansion||c.signal;}).length;
  var withFaction=funnel.companies.filter(function(c){return c.faction;}).length;
  var esc=function(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};
  var topRows=top.map(function(c,i){
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #f1f3f7">'+
      '<span style="flex:0 0 22px;width:22px;height:22px;background:#eef2ff;color:#4338ca;border-radius:50%;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center">'+(i+1)+'</span>'+
      '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:650;color:#0b183b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(c.name)+'</div>'+
        '<div style="font-size:11px;color:#8492a6">'+esc(c.region||'')+(c.kind?' \u00b7 '+esc(c.kind):'')+'</div></div>'+
      '<span style="flex:0 0 auto;font-size:13px;font-weight:800;color:'+(c.fit_score>=80?'#16a34a':c.fit_score>=60?'#d97706':'#6b7280')+'">'+(c.fit_score||0)+'<span style="font-size:10px;font-weight:600">\u5206</span></span>'+
    '</div>';
  }).join('');
  var modal='<div id="funnelDoneModal" style="position:fixed;inset:0;background:rgba(11,24,59,.45);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px)" onclick="if(event.target.id===\'funnelDoneModal\')closeFunnelDoneModal()">'+
    '<div style="background:#fff;border-radius:22px;padding:32px 32px 24px;max-width:500px;width:92%;box-shadow:0 8px 60px rgba(11,24,59,.18);animation:fadeUp .35s ease">'+
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">'+
        '<div style="width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.2)"></div>'+
        '<span style="font-size:12px;font-weight:650;color:#22c55e;letter-spacing:.5px">AI \u6f0f\u6597\u5206\u6790\u5b8c\u6210</span>'+
      '</div>'+
      '<h2 style="font-size:20px;font-weight:750;color:#0b183b;margin:0 0 4px">\u300c'+esc(funnel.topic||p.topic||'\u8be5\u65b9\u5411')+'\u300d\u9002\u914d\u4f01\u4e1a\u5df2\u66f4\u65b0</h2>'+
      '<p style="font-size:13px;color:#8492a6;margin:0 0 18px">\u5171\u626b\u63cf '+total+' \u5bb6\uff0c\u7cbe\u7b5b\u51fa '+n+' \u5bb6\u9002\u914d\u4f01\u4e1a\uff0c\u5176\u4e2d '+withSignal+' \u5bb6\u6709\u6269\u5f20/\u8fc1\u79fb\u4fe1\u53f7'+(withFaction?'\u3001'+withFaction+' \u5bb6\u6709\u6d3e\u7cfb\u5173\u8054':'')+'</p>'+
      '<div style="font-size:12px;font-weight:650;color:#4a5568;margin-bottom:2px">\u9002\u914d\u5ea6 Top3</div>'+
      topRows+
      '<div style="margin-top:22px;display:flex;gap:10px;align-items:center">'+
        '<button onclick="closeFunnelDoneModal()" style="flex:1;padding:13px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:650;cursor:pointer;letter-spacing:.2px">\u67e5\u770b\u5b8c\u6574\u6f0f\u6597 \u2192</button>'+
      '</div>'+
    '</div>'+
  '</div>';
  if(!document.getElementById('fadeUpStyle')){
    var st=document.createElement('style');st.id='fadeUpStyle';
    st.textContent='@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(st);
  }
  var old=document.getElementById('funnelDoneWrap'); if(old)old.remove();
  var wrap=document.createElement('div'); wrap.id='funnelDoneWrap'; wrap.innerHTML=modal;
  document.body.appendChild(wrap);
}
function closeFunnelDoneModal(){
  var wrap=document.getElementById('funnelDoneWrap'); if(wrap)wrap.remove();
}
/* ── AI 漏斗分析进度弹窗 ── */
var _funnelProg={pct:0,timer:null,phase:0};
function showFunnelProgressModal(projKey){
  var p=PROJECTS[projKey]||{};
  var esc=function(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};
  var modal='<div id="funnelProgModal" style="position:fixed;inset:0;background:rgba(11,24,59,.45);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px)">'+
    '<div style="background:#fff;border-radius:22px;padding:34px 34px 30px;max-width:460px;width:92%;box-shadow:0 8px 60px rgba(11,24,59,.18);animation:fadeUp .35s ease">'+
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">'+
        '<div class="funnelSpin" style="width:20px;height:20px;border:2.5px solid #dbe3f7;border-top-color:#4f46e5;border-radius:50%"></div>'+
        '<span style="font-size:13px;font-weight:700;color:#4338ca;letter-spacing:.3px">AI 企业漏斗分析中</span>'+
      '</div>'+
      '<h2 style="font-size:18px;font-weight:750;color:#0b183b;margin:0 0 4px">「'+esc(p.topic||'该方向')+'」</h2>'+
      '<p id="funnelProgPhase" style="font-size:13px;color:#8492a6;margin:0 0 18px">正在检索全国适配企业…</p>'+
      '<div style="height:8px;background:#eef1f6;border-radius:6px;overflow:hidden">'+
        '<div id="funnelProgBar" style="height:100%;width:0%;background:linear-gradient(90deg,#1a56db,#6366f1);border-radius:6px;transition:width .5s ease"></div>'+
      '</div>'+
      '<div style="display:flex;justify-content:space-between;margin-top:8px"><span id="funnelProgPct" style="font-size:12px;color:#4338ca;font-weight:650">0%</span>'+
        '<span style="font-size:11px;color:#9aa5b5">约需 1-2 分钟，请稍候</span></div>'+
    '</div>'+
  '</div>';
  if(!document.getElementById('fadeUpStyle')){var st=document.createElement('style');st.id='fadeUpStyle';st.textContent='@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}@keyframes fspin{to{transform:rotate(360deg)}}.funnelSpin{animation:fspin .8s linear infinite}';document.head.appendChild(st);}
  var oldw=document.getElementById('funnelProgWrap'); if(oldw)oldw.remove();
  var oldd=document.getElementById('funnelDoneWrap'); if(oldd)oldd.remove();
  var wrap=document.createElement('div'); wrap.id='funnelProgWrap'; wrap.innerHTML=modal; document.body.appendChild(wrap);
  _funnelProg.pct=0; _funnelProg.phase=0;
  var phases=['正在检索全国适配企业…','正在比对产业链缺口与企业能力…','正在为企业打分与排序…','正在生成适配分析与信号标注…'];
  clearInterval(_funnelProg.timer);
  _funnelProg.timer=setInterval(function(){
    if(_funnelProg.pct<88){ _funnelProg.pct+=Math.max(1,Math.round((90-_funnelProg.pct)/22)); updateFunnelProgress(_funnelProg.pct); }
    var ph=document.getElementById('funnelProgPhase');
    if(ph){ var idx=Math.min(phases.length-1, Math.floor(_funnelProg.pct/24)); if(idx!==_funnelProg.phase){ _funnelProg.phase=idx; ph.textContent=phases[idx]; } }
  },900);
}
function updateFunnelProgress(pct){
  if(pct>_funnelProg.pct) _funnelProg.pct=pct;
  var bar=document.getElementById('funnelProgBar'), t=document.getElementById('funnelProgPct');
  if(bar) bar.style.width=_funnelProg.pct+'%';
  if(t) t.textContent=_funnelProg.pct+'%';
}
function closeFunnelProgressModal(){
  clearInterval(_funnelProg.timer);
  var wrap=document.getElementById('funnelProgWrap'); if(wrap)wrap.remove();
}

/* ── AI 漏斗企业分级金字塔可视化 ── */
function showFunnelPyramid(k){
  var p=PROJECTS[k]||{}; var fn=p.funnel;
  if(!fn||!fn.companies||!fn.companies.length){ toast('暂无漏斗数据'); return; }
  var esc=function(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};
  var S=[],A=[],B=[];
  fn.companies.forEach(function(c){ var sc=c.fit_score||0; if(sc>=85)S.push(c); else if(sc>=70)A.push(c); else B.push(c); });
  [S,A,B].forEach(function(arr){ arr.sort(function(a,b){return (b.fit_score||0)-(a.fit_score||0);}); });
  var tiers=[
    {name:'S 级 · 核心适配',hint:'评分 ≥85，优先重点对接',accent:'#c2740a',bar:'linear-gradient(135deg,#fbbf24,#f59e0b)',soft:'#fffdf6',border:'#f6d79b',w:60,list:S},
    {name:'A 级 · 高适配',hint:'评分 70-84，积极跟进',accent:'#2f54d6',bar:'linear-gradient(135deg,#60a5fa,#5b6ef0)',soft:'#f6f9ff',border:'#c8d6fb',w:80,list:A},
    {name:'B 级 · 潜力观察',hint:'评分 <70，储备观察',accent:'#5c6b7a',bar:'linear-gradient(135deg,#a4b0be,#6b7684)',soft:'#f9fafb',border:'#e3e8ef',w:100,list:B}
  ];
  var body=tiers.map(function(t){
    var chips = t.list.length ? t.list.map(function(c){
      return '<span title="'+esc((c.region||'')+(c.region?' · ':'')+(c.name||''))+'" style="display:inline-flex;align-items:center;gap:7px;padding:6px 11px;background:#fff;border:1px solid '+t.border+';border-radius:999px;font-size:12px;line-height:1.15;box-shadow:0 1px 2px rgba(11,24,59,.04)">'+
        '<span style="font-weight:600;color:#0b183b">'+esc(c.name)+'</span>'+
        '<span style="font-weight:800;color:'+t.accent+'">'+(c.fit_score||0)+'</span>'+
      '</span>';
    }).join('') : '<span style="font-size:12px;color:#b0bac8;padding:2px 4px">该级暂无企业</span>';
    return '<div style="width:'+t.w+'%;margin:0 auto 12px;border:1px solid '+t.border+';border-radius:16px;overflow:hidden;background:'+t.soft+';box-shadow:0 3px 14px rgba(11,24,59,.06);transition:width .2s">'+
      '<div style="background:'+t.bar+';color:#fff;padding:9px 16px;display:flex;align-items:center;gap:9px">'+
        '<span style="font-size:13.5px;font-weight:750;letter-spacing:.2px">'+t.name+'</span>'+
        '<span style="font-size:11px;opacity:.92;font-weight:500">'+t.hint+'</span>'+
        '<span style="margin-left:auto;font-size:12.5px;font-weight:800;background:rgba(255,255,255,.22);padding:1px 10px;border-radius:999px">'+t.list.length+' 家</span>'+
      '</div>'+
      '<div style="padding:13px 15px;display:flex;flex-wrap:wrap;gap:8px">'+chips+'</div>'+
    '</div>';
  }).join('');
  var modal='<div id="funnelPyramidModal" style="position:fixed;inset:0;background:rgba(11,24,59,.5);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px);padding:22px" onclick="if(event.target.id===\'funnelPyramidModal\')closeFunnelPyramid()">'+
    '<div style="background:#fff;border-radius:22px;max-width:660px;width:100%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 12px 64px rgba(11,24,59,.28);animation:fadeUp .32s ease;overflow:hidden">'+
      '<div style="padding:22px 26px 16px;border-bottom:1px solid #f1f3f7">'+
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">'+
          '<div><div style="font-size:11.5px;font-weight:700;color:#5b6ef0;letter-spacing:.6px">企业适配分级图谱</div>'+
          '<h2 style="font-size:18px;font-weight:750;color:#0b183b;margin:3px 0 0;line-height:1.35">「'+esc(fn.topic||p.topic||'该方向')+'」</h2></div>'+
          '<button onclick="closeFunnelPyramid()" style="flex:0 0 auto;width:32px;height:32px;border:none;background:#f2f4f8;border-radius:9px;font-size:15px;color:#64748b;cursor:pointer;line-height:1">✕</button>'+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:8px;margin-top:11px;flex-wrap:wrap">'+
          '<span style="font-size:12px;color:#8492a6">共 '+fn.companies.length+' 家 · 按综合评分自动分级</span>'+
          '<span style="font-size:11px;font-weight:700;color:#c2740a;background:#fffbeb;border:1px solid #fbe6c0;border-radius:999px;padding:2px 9px">S '+S.length+'</span>'+
          '<span style="font-size:11px;font-weight:700;color:#2f54d6;background:#f0f5ff;border:1px solid #d3ddfb;border-radius:999px;padding:2px 9px">A '+A.length+'</span>'+
          '<span style="font-size:11px;font-weight:700;color:#5c6b7a;background:#f4f6f9;border:1px solid #e3e8ef;border-radius:999px;padding:2px 9px">B '+B.length+'</span>'+
        '</div>'+
      '</div>'+
      '<div style="padding:22px 24px;overflow:auto;background:linear-gradient(180deg,#fcfdff,#f7f9fc)">'+body+'</div>'+
    '</div>'+
  '</div>';
  if(!document.getElementById('fadeUpStyle')){var st=document.createElement('style');st.id='fadeUpStyle';st.textContent='@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}@keyframes fspin{to{transform:rotate(360deg)}}.funnelSpin{animation:fspin .8s linear infinite}';document.head.appendChild(st);}
  var old=document.getElementById('funnelPyramidWrap'); if(old)old.remove();
  var wrap=document.createElement('div'); wrap.id='funnelPyramidWrap'; wrap.innerHTML=modal; document.body.appendChild(wrap);
}
function closeFunnelPyramid(){
  var wrap=document.getElementById('funnelPyramidWrap'); if(wrap)wrap.remove();
}



function deriveCluesFromReport(projKey){
  var rs = REPORTSTATE[projKey];
  var p  = PROJECTS[projKey];
  if(!rs || !rs.text || !p) return;
  if(p.clues && p.clues.length > 0) return; // 已有线索不重复派生

  var text = rs.text;
  var lines = text.split('\n');
  var items = [];

  // 从 TOP5 / ❌缺失 行提取缺口
  var gaps = [];
  var inTop5 = false;
  for(var i=0; i<lines.length; i++){
    var l = lines[i];
    if(l.indexOf('补链优先级')>=0 || l.indexOf('TOP5')>=0 || l.indexOf('优先级清单')>=0) inTop5=true;
    if(inTop5 && l.trim().charAt(0)==='|'){
      var cells = l.trim().slice(1,-1).split('|').map(function(c){return c.replace(/[*★]/g,'').trim();});
      var isSep = cells.every(function(c){return /^[\s\-:]+$/.test(c);});
      if(isSep || cells[0]==='排名' || cells[0]==='缺口节点') continue;
      var rank = parseInt(cells[0]);
      if(!isNaN(rank) && rank>=1 && rank<=3 && cells[1]) gaps.push(cells[1]);
    }
    if(inTop5 && gaps.length>=3) break;
  }
  // 降级：找 ❌ 行
  if(!gaps.length){
    lines.forEach(function(l){
      if(l.indexOf('❌')>=0 && gaps.length<3){
        var c = l.replace(/^[*\-•|#\s]+/,'').replace(/❌|\*\*/g,'').trim();
        if(c.length>4 && c.length<50) gaps.push(c);
      }
    });
  }

  // 每个缺口生成一条脱敏候选线索
  var regionMap = ['长三角','华南','华东','华中'];
  var kindSuffix = ['系统集成商','制造企业','配套企业'];
  gaps.slice(0,3).forEach(function(gap, idx){
    items.push({
      id: 'clue_' + projKey + '_' + idx,
      name: '脱敏企业 ' + String.fromCharCode(65+idx) + '（' + gap.slice(0,8) + '·代号）',
      kind: gap + kindSuffix[idx%3],
      region: regionMap[idx%4],
      source: '慧小招研判报告（' + new Date().toLocaleDateString('zh-CN') + '）',
      status: '待资源核验',
      tone: 'slate',
      reason: '直接补「' + gap + '」缺口，与' + p.city + '本地链主形成配套需求。',
      signal: '基于报告缺口判断，具体企业投资意向与决策层触达可能性需资源团队核验。',
      questions: [
        '企业是否有异地布局或产能扩张计划',
        '与' + p.city + '本地链主的配套合作可行性',
        '落地规模与首批场景要求'
      ]
    });
  });

  if(!p.clues) p.clues = [];
  p.clues = p.clues.concat(items);
  persist();
}

/* ── 线索卡片渲染 ── */
function clueCard(clue, projKey, idx){
  var toneMap = {
    slate: {bg:'#f5f7fb', border:'#e8edf5', dot:'#9aa5b5', label:'待接触'},
    amber: {bg:'#fffbeb', border:'#fde68a', dot:'#f59e0b', label:'核验中'},
    teal:  {bg:'#f0fdf4', border:'#86efac', dot:'#22c55e', label:'可安排沟通'}
  };
  var t = toneMap[clue.tone] || toneMap.slate;
  var isExpanded = (window.__clueOpen === clue.id);

  var questionsHtml = clue.questions.length
    ? '<div style="margin-top:10px"><div style="font-size:11px;font-weight:650;color:#6b7280;letter-spacing:.3px;margin-bottom:5px">核验问题</div>'+
      clue.questions.map(function(q,qi){
        return '<div style="display:flex;gap:6px;padding:5px 0;border-bottom:1px solid #f3f4f6">'+
          '<span style="color:#9aa5b5;flex-shrink:0;font-size:12px">'+(qi+1)+'.</span>'+
          '<span style="font-size:12.5px;color:#374151">'+q+'</span>'+
        '</div>';
      }).join('')+'</div>'
    : '';

  var expandedDetail = isExpanded
    ? '<div style="padding:12px 16px 14px;border-top:1px solid '+t.border+';background:'+t.bg+'">'+
        '<div style="margin-bottom:8px">'+
          '<div style="font-size:11px;font-weight:650;color:#6b7280;letter-spacing:.3px;margin-bottom:4px">为什么值得核验</div>'+
          '<div style="font-size:13px;color:#1f2937;line-height:1.65">'+clue.reason+'</div>'+
        '</div>'+
        '<div style="margin-bottom:8px">'+
          '<div style="font-size:11px;font-weight:650;color:#6b7280;letter-spacing:.3px;margin-bottom:4px">公开信号与资源边界</div>'+
          '<div style="font-size:12.5px;color:#4b5563;line-height:1.6">'+clue.signal+'</div>'+
        '</div>'+
        questionsHtml+
        '<div style="display:flex;gap:8px;margin-top:12px">'+
          (clue.tone==='slate'
            ? '<button onclick="requestVerify(\''+projKey+'\',\''+clue.id+'\')" '+
                'style="flex:1;padding:8px;background:#fffbeb;border:1.5px solid #fde68a;border-radius:8px;font-size:12.5px;font-weight:600;color:#92400e;cursor:pointer">'+
                '🔍 请资源团队核验</button>'
            : clue.tone==='amber'
            ? '<button disabled style="flex:1;padding:8px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:8px;font-size:12.5px;color:#9aa5b5;cursor:not-allowed">'+
                '⏳ 核验进行中</button>'
            : '<button onclick="arrangeDocking(\''+projKey+'\',\''+clue.id+'\')" '+
                'style="flex:1;padding:8px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;font-size:12.5px;font-weight:600;color:#166534;cursor:pointer">'+
                '✓ 安排首次沟通</button>'
          )+
          '<button onclick="editClue(\''+projKey+'\',\''+clue.id+'\')" '+
            'style="padding:8px 12px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:8px;font-size:12px;color:#4a5568;cursor:pointer">'+
            '✎ 编辑</button>'+
        '</div>'+
      '</div>'
    : '';

  return '<div style="border-radius:12px;border:1.5px solid '+t.border+';overflow:hidden;background:#fff;margin-bottom:8px">'+
    '<button onclick="toggleClue(\''+clue.id+'\')" '+
      'style="width:100%;display:flex;align-items:center;gap:12px;padding:12px 16px;background:'+(isExpanded?t.bg:'#fff')+';border:none;cursor:pointer;text-align:left">'+
      '<span style="width:8px;height:8px;border-radius:50%;background:'+t.dot+';flex-shrink:0;box-shadow:0 0 0 2px '+t.border+'"></span>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13.5px;font-weight:700;color:#0b183b;margin-bottom:2px">'+clue.name+'</div>'+
        '<div style="font-size:12px;color:#8492a6">'+clue.kind+' · '+clue.region+'</div>'+
      '</div>'+
      '<span style="padding:3px 10px;background:'+t.bg+';color:'+t.dot+';border:1px solid '+t.border+';border-radius:20px;font-size:11.5px;font-weight:600;flex-shrink:0;white-space:nowrap">'+t.label+'</span>'+
      '<span style="font-size:12px;color:#9aa5b5;margin-left:2px">'+(isExpanded?'▲':'▼')+'</span>'+
    '</button>'+
    expandedDetail+
  '</div>';
}

/* ── 操作函数 ── */
function toggleClue(id){
  window.__clueOpen = (window.__clueOpen===id) ? null : id;
  render();
}

function requestVerify(projKey, clueId){
  var p = PROJECTS[projKey]; if(!p) return;
  var c = (p.clues||[]).find(function(x){return x.id===clueId;});
  if(!c) return;
  c.tone = 'amber';
  c.status = '资源核验中';
  persist();
  // 推进 stage 到 4（资源匹配）
  p.stage = Math.max(p.stage, 4);
  persist();
  render();
  toast('✓ 已发起资源核验，等待团队回传');
}

function arrangeDocking(projKey, clueId){
  var p = PROJECTS[projKey]; if(!p) return;
  var c = (p.clues||[]).find(function(x){return x.id===clueId;});
  if(!c) return;
  c.tone = 'teal';
  c.status = '可安排首次沟通';
  p.stage = Math.max(p.stage, 5);
  persist();
  render();
  toast('✓ 已标记为可安排沟通，进入招商对接阶段');
}

function editClue(projKey, clueId){
  var p = PROJECTS[projKey]; if(!p) return;
  var c = (p.clues||[]).find(function(x){return x.id===clueId;});
  if(!c) return;

  var layer = document.createElement('div');
  layer.id = 'clueEditLayer';
  layer.onclick = function(e){ if(e.target===layer) layer.remove(); };
  layer.style.cssText = 'position:fixed;inset:0;background:rgba(11,24,59,.4);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;backdrop-filter:blur(4px)';

  layer.innerHTML =
    '<div style="background:#fff;border-radius:20px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;box-shadow:0 24px 80px rgba(11,24,59,.18)">'+
      '<div style="padding:20px 24px;border-bottom:1px solid #f0f4ff;display:flex;align-items:center;justify-content:space-between">'+
        '<div style="font-size:15px;font-weight:750;color:#0b183b">编辑企业线索</div>'+
        '<button onclick="document.getElementById(\'clueEditLayer\').remove()" style="background:none;border:none;font-size:18px;color:#9aa5b5;cursor:pointer">✕</button>'+
      '</div>'+
      '<div style="padding:20px 24px">'+
        '<div style="margin-bottom:14px">'+
          '<label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:6px">企业名称（脱敏代号）</label>'+
          '<input id="cedit-name" value="'+c.name.replace(/"/g,'&quot;')+'" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none" onfocus="this.style.border=\'1.5px solid #6366f1\'" onblur="this.style.border=\'1.5px solid #e8edf5\'"/>'+
        '</div>'+
        '<div style="margin-bottom:14px">'+
          '<label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:6px">企业方向</label>'+
          '<input id="cedit-kind" value="'+c.kind.replace(/"/g,'&quot;')+'" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none" onfocus="this.style.border=\'1.5px solid #6366f1\'" onblur="this.style.border=\'1.5px solid #e8edf5\'"/>'+
        '</div>'+
        '<div style="margin-bottom:14px">'+
          '<label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:6px">区域</label>'+
          '<input id="cedit-region" value="'+c.region+'" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none" onfocus="this.style.border=\'1.5px solid #6366f1\'" onblur="this.style.border=\'1.5px solid #e8edf5\'"/>'+
        '</div>'+
        '<div style="margin-bottom:14px">'+
          '<label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:6px">为什么值得核验</label>'+
          '<textarea id="cedit-reason" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none;resize:vertical;min-height:72px;line-height:1.6" onfocus="this.style.border=\'1.5px solid #6366f1\'" onblur="this.style.border=\'1.5px solid #e8edf5\'">'+c.reason+'</textarea>'+
        '</div>'+
        '<div style="margin-bottom:20px">'+
          '<label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:6px">核验状态</label>'+
          '<div style="display:flex;gap:8px">'+
            ['slate:待接触','amber:核验中','teal:可安排沟通'].map(function(s){
              var parts=s.split(':'), val=parts[0], label=parts[1];
              var isActive=c.tone===val;
              return '<button onclick="this.parentNode.querySelectorAll(\'.tone-btn\').forEach(function(b){b.style.background=\'#f5f7fb\';b.style.fontWeight=\'400\'});this.style.background=\'#eff6ff\';this.style.fontWeight=\'700\';window.__clueEditTone=\''+val+'\'" '+
                'class="tone-btn" '+
                'style="flex:1;padding:7px 0;border:1.5px solid #e8edf5;border-radius:8px;font-size:12px;cursor:pointer;background:'+(isActive?'#eff6ff':'#f5f7fb')+';font-weight:'+(isActive?'700':'400')+';color:#0b183b">'+label+'</button>';
            }).join('')+
          '</div>'+
        '</div>'+
        '<button onclick="saveClueEdit(\''+projKey+'\',\''+clueId+'\')" '+
          'style="width:100%;padding:12px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:10px;font-size:13.5px;font-weight:650;cursor:pointer">'+
          '保存修改</button>'+
      '</div>'+
    '</div>';

  window.__clueEditTone = c.tone;
  document.body.appendChild(layer);
}

function saveClueEdit(projKey, clueId){
  var p = PROJECTS[projKey]; if(!p) return;
  var c = (p.clues||[]).find(function(x){return x.id===clueId;});
  if(!c) return;
  var name   = document.getElementById('cedit-name');
  var kind   = document.getElementById('cedit-kind');
  var region = document.getElementById('cedit-region');
  var reason = document.getElementById('cedit-reason');
  if(name)   c.name   = name.value.trim() || c.name;
  if(kind)   c.kind   = kind.value.trim() || c.kind;
  if(region) c.region = region.value.trim() || c.region;
  if(reason) c.reason = reason.value.trim() || c.reason;
  c.tone = window.__clueEditTone || c.tone;
  var toneStatusMap = {slate:'待接触',amber:'资源核验中',teal:'可安排首次沟通'};
  c.status = toneStatusMap[c.tone] || c.status;
  persist();
  document.getElementById('clueEditLayer').remove();
  render();
  toast('✓ 线索已更新');
}

function addClueManual(projKey){
  var p = PROJECTS[projKey]; if(!p) return;
  if(!p.clues) p.clues = [];
  var newClue = {
    id: 'clue_manual_'+Date.now().toString(36),
    name: '待填写企业名称',
    kind: '待填写企业方向',
    region: '待填写区域',
    source: '招商干部录入',
    status: '待资源核验',
    tone: 'slate',
    reason: '待填写核验理由',
    signal: '来源：招商干部录入，需人工核验',
    questions: ['核验企业主营方向','确认与本次招商需求的结合点','判断资源可达性与沟通窗口']
  };
  p.clues.push(newClue);
  persist();
  render();
  // 自动打开编辑弹窗
  setTimeout(function(){ editClue(projKey, newClue.id); }, 100);
}

/* ══════════════════════════════════════════════════════════════
   projMgmtPage 完整重写
   ══════════════════════════════════════════════════════════════ */
function projMgmtPage(p){
  var projKeys = Object.keys(PROJECTS);
  if(!projKeys.length){
    return '<div class="page">'+
      '<div class="page-header"><div><span class="eyebrow">PROJECTS</span><h1>项目管理</h1>'+
      '<p>研判报告确认后，立项导入的方向会出现在这里。</p></div></div>'+
      '<div class="knowledge-scroll"><div style="text-align:center;padding:60px 20px">'+
        '<div style="font-size:36px;margin-bottom:12px">📂</div>'+
        '<div style="font-size:15px;font-weight:700;color:#0b183b;margin-bottom:8px">暂无立项</div>'+
        '<div style="font-size:13px;color:#8492a6;line-height:1.7;margin-bottom:20px">'+
          '在「研判需求」生成完整报告后，<br>点击「🏁 可立项招引方向」中的「立项导入 →」按钮建立项目'+
        '</div>'+
        '<button onclick="go(\'report\')" style="padding:10px 24px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:10px;font-size:13.5px;font-weight:650;cursor:pointer">前往研判需求 →</button>'+
      '</div></div></div>';
  }

  var groups = projKeys.map(function(k){
    var x = PROJECTS[k];
    var sc = stColor(x.stage);
    var expanded = (window.__projOpen === k);

    // 自动派生线索（如有报告）
    deriveCluesFromReport(k);
    // 自动触发真实 AI 企业漏斗分析（每个项目首次进入时，静默后台跑；不再用硬编码假数据）
    if(!window.__funnelAuto) window.__funnelAuto={};
    if(!window.__funnelAuto[k]){
      window.__funnelAuto[k]=true;
      var _pf=PROJECTS[k];
      if(_pf && !_pf.funnel && (_pf.topic||'').trim()){
        runAIFunnel(k, function(err){ if(!err){ try{ renderOpsV2&&renderOpsV2(); }catch(e){ try{render();}catch(_){}} } });
      }
    }

    var clues = x.clues || [];
    var teal  = clues.filter(function(c){return c.tone==='teal';}).length;
    var amber = clues.filter(function(c){return c.tone==='amber';}).length;
    var slate = clues.filter(function(c){return c.tone==='slate';}).length;

    // 线索摘要标签
    var cluesSummary = clues.length
      ? (teal?'<span style="padding:2px 8px;background:#f0fdf4;color:#166534;border-radius:12px;font-size:11px;margin-left:4px">'+teal+'条可沟通</span>':'')
        +(amber?'<span style="padding:2px 8px;background:#fffbeb;color:#92400e;border-radius:12px;font-size:11px;margin-left:4px">'+amber+'条核验中</span>':'')
        +(slate?'<span style="padding:2px 8px;background:#f5f7fb;color:#6b7280;border-radius:12px;font-size:11px;margin-left:4px">'+slate+'条待接触</span>':'')
      : '<span style="font-size:11px;color:#9aa5b5;margin-left:4px">待生成线索</span>';

    // 展开内容
    var expandedContent = '';
    if(expanded){
      // 进度条（标准5阶段 + 该项目自定义追加阶段）
      var _projStages = projStages(x);
      var stageBar = '<div style="margin-bottom:16px">'+
        '<div style="font-size:11px;font-weight:650;color:#4a5568;letter-spacing:.3px;margin-bottom:6px">阶段进度</div>'+
        '<div style="display:flex;gap:0;border-radius:8px;overflow:hidden;border:1px solid #e8edf5">'+
        _projStages.map(function(s,si){
          var n=si+1;
          var isDone = n < x.stage;
          var isCur  = n === x.stage;
          var bg = isDone?'#1a56db':isCur?'#eff6ff':'#f9fafb';
          var color = isDone?'#fff':isCur?'#1a56db':'#9aa5b5';
          var fw = isCur?'700':'400';
          return '<div style="flex:1;padding:8px 4px;text-align:center;background:'+bg+';border-right:1px solid #e8edf5">'+
            '<div style="font-size:10.5px;font-weight:'+fw+';color:'+color+';line-height:1.3">'+
              (isDone?'✓ ':'')+(isCur?'⬤ ':'')+s[0]+
            '</div>'+
          '</div>';
        }).join('')+
        '</div></div>';

      // 阶段推进面板：回复说明 + 选下一阶段 + 新增自定义阶段 + 留痕列表
      var stagePanel = '<div style="margin-bottom:16px;padding:14px 16px;background:#fafbff;border:1px solid #e0e7ff;border-radius:12px">'+
        '<div style="font-size:12px;font-weight:700;color:#1a56db;margin-bottom:10px">🔄 阶段推进与回复</div>'+
        '<textarea id="stage-note-'+k+'" placeholder="填写回复说明（如：材料已初审通过，建议约下周三第一次会议）…" '+
          'style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;resize:vertical;min-height:56px;outline:none;line-height:1.6"></textarea>'+
        '<div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">'+
          '<select id="stage-target-'+k+'" style="flex:1;min-width:150px;padding:9px 12px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;background:#fff;color:#0b183b;outline:none">'+stageOptions(x)+'</select>'+
          '<button onclick="saveStageAdvance(\''+k+'\')" style="padding:9px 16px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:650;cursor:pointer;white-space:nowrap">保存并推进</button>'+
          '<button onclick="addCustomStage(\''+k+'\')" style="padding:9px 14px;background:#fff;border:1.5px solid #c4b5fd;border-radius:8px;font-size:13px;color:#6d28d9;cursor:pointer;font-weight:600;white-space:nowrap">＋ 新增阶段</button>'+
        '</div>'+
        renderStageLog(x)+
      '</div>';

      // 历史报告
      var reportHist = '';
      var rs = REPORTSTATE[k];
      if(rs){
        reportHist = '<div style="margin-bottom:14px;padding:10px 14px;background:#f8faff;border-radius:10px;border:1px solid #e8edf5">'+
          '<div style="display:flex;align-items:center;gap:8px">'+
            '<span style="font-size:14px">📋</span>'+
            '<div style="flex:1">'+
              '<div style="font-size:13px;font-weight:650;color:#0b183b">研判报告</div>'+
              '<div style="font-size:11.5px;color:#8492a6">置信度 '+rs.score+'% · '+new Date(rs.ts).toLocaleDateString('zh-CN')+'</div>'+
            '</div>'+
            '<button onclick="gotoStudy(\''+k+'\')" style="padding:5px 12px;background:#fff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:12px;color:#1a56db;cursor:pointer">查看报告</button>'+
          '</div>'+
        '</div>';
      }

      // stage=2 引导：前往研判需求生成本方向报告
      var stageGuide = '';
      if(x.stage===2){
        // stage=2：报告已从父项目继承，直接引导确认方向
        stageGuide=
          '<div style="margin-bottom:16px;padding:14px 16px;background:linear-gradient(135deg,#eff6ff,#f0f9ff);border:1.5px solid #bfdbfe;border-radius:12px">'+
            '<div style="display:flex;align-items:center;gap:10px">'+
              '<span style="font-size:24px">🎯</span>'+
              '<div style="flex:1">'+
                '<div style="font-size:13.5px;font-weight:700;color:#1d4ed8;margin-bottom:3px">下一步：确认「'+x.topic+'」研判方向</div>'+
                '<div style="font-size:12px;color:#4a5568;line-height:1.6">研判报告已从母项目继承，可直接确认方向并提交招引需求。</div>'+
              '</div>'+
              '<button onclick="(function(){cur=\''+k+'\';view=\'report\';render();})()" '+
                'style="padding:9px 18px;background:#1a56db;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:650;cursor:pointer;white-space:nowrap;flex-shrink:0">'+
                '查看并确认 →</button>'+
            '</div>'+
          '</div>';
      } else if(x.stage===3){
        stageGuide=
          '<div style="margin-bottom:16px;padding:14px 16px;background:linear-gradient(135deg,#f0fdf4,#f0f9ff);border:1.5px solid #86efac;border-radius:12px">'+
            '<div style="display:flex;align-items:center;gap:10px">'+
              '<span style="font-size:24px">📤</span>'+
              '<div style="flex:1">'+
                '<div style="font-size:13.5px;font-weight:700;color:#166534;margin-bottom:3px">下一步：正式提交招引需求</div>'+
                '<div style="font-size:12px;color:#4a5568;line-height:1.6">研判已完成。提交后候选企业线索自动派生，可发起资源核验。</div>'+
              '</div>'+
              '<button onclick="cur=\''+k+'\';submitDemand()" '+
                'style="padding:9px 18px;background:#22c55e;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:650;cursor:pointer;white-space:nowrap;flex-shrink:0">'+
                '提交招引需求 →</button>'+
            '</div>'+
          '</div>';
      }
      // 线索列表
      var cluesList = renderCluesTwoPanel(k)+
        // 递交按钮
        (x.stage>=3 && x.stage<4
          ? '<button onclick="advanceStage(\''+k+'\')" style="width:100%;margin-top:12px;padding:11px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:10px;font-size:13.5px;font-weight:650;cursor:pointer">📤 正式递交需求，进入资源匹配</button>'
          : ''
        );

      expandedContent = '<div style="padding:0 16px 16px">'+
        stageBar+
        stagePanel+
        stageGuide+
        reportHist+
        cluesList+
      '</div>';
    }

    return '<div style="margin-bottom:12px;border-radius:14px;border:1.5px solid '+(expanded?'#bfdbfe':'#e8edf5')+';overflow:hidden;background:#fff">'+
      '<button onclick="toggleProjGroup(\''+k+'\')" '+
        'style="width:100%;display:flex;align-items:center;gap:12px;padding:14px 18px;background:'+(expanded?'#f8faff':'#fff')+';border:none;cursor:pointer;text-align:left">'+
        '<span style="font-size:22px;flex-shrink:0">🎯</span>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">'+
            '<strong style="font-size:14px;color:#0b183b">'+x.topic+'</strong>'+
            cluesSummary+
          '</div>'+
          '<div style="font-size:12px;color:#8492a6;margin-top:3px">'+x.city+' · '+stageNameOf(x,x.stage)+' · '+clues.length+'条线索</div>'+
        '</div>'+
        '<span style="padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:600;background:'+sc.bg+';color:'+sc.c+'">'+stageNameOf(x,x.stage)+'</span>'+
        '<span style="font-size:13px;color:#9aa5b5;margin-left:4px">'+(expanded?'▲':'▼')+'</span>'+
      '</button>'+
      expandedContent+
    '</div>';
  }).join('');

  return '<div class="page">'+
    '<div class="page-header"><div>'+
      '<span class="eyebrow">PROJECTS</span><h1>项目管理 · 企业线索</h1>'+
      '<p>展开产业方向查看候选企业线索、研判报告与阶段进度；发起资源核验或安排首次沟通。</p>'+
    '</div></div>'+
    '<div class="knowledge-scroll">'+
      '<div style="width:100%">'+groups+'</div>'+
      '<div style="margin-top:10px;padding:10px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e8edf5;font-size:12px;color:#8492a6">'+
        'ⓘ 企业线索仅展示脱敏代号、公开依据和核验问题；具体资源可达性由资源团队人工核验，系统不自动联系企业。'+
      '</div>'+
    '</div></div>';
}

/* 推进阶段（向后兼容：默认推进到下一阶段） */
function advanceStage(projKey){
  var p = PROJECTS[projKey]; if(!p) return;
  var st=projStages(p);
  if(p.stage < st.length){
    advanceStageTo(projKey, p.stage+1, '');
  }
}

/* 推进到指定阶段 + 填回复说明 + 操作留痕 */
function advanceStageTo(projKey, target, note){
  var p = PROJECTS[projKey]; if(!p) return;
  target = parseInt(target);
  var st = projStages(p);
  if(!target || target<1 || target>st.length){
    toast('无效的阶段'); return;
  }
  if(target === p.stage){ toast('已在该阶段'); return; }
  var from = p.stage;
  p.stage = target;
  if(!p.stageLog) p.stageLog=[];
  p.stageLog.unshift({ts:Date.now(), from:from, to:target, note:(note||'').trim(), who:'运营端'});
  persist();
  render();
  toast('✓ 已推进到「' + stageNameOf(p,target) + '」阶段');
}

/* 阶段推进面板：下拉选项（当前阶段之后的所有阶段） */
function stageOptions(p){
  var st = projStages(p);
  var cur = p.stage || 1;
  var html = '';
  for(var n=cur+1; n<=st.length; n++){
    html += '<option value="'+n+'">推进到「'+st[n-1][0]+'」</option>';
  }
  if(!html) html = '<option value="" disabled>已是最后阶段</option>';
  return html;
}

/* 阶段留痕列表 */
function renderStageLog(p){
  var log = (p && p.stageLog) || [];
  if(!log.length) return '<div style="font-size:11.5px;color:#9aa5b5;margin-top:10px">暂无阶段推进记录</div>';
  return '<div style="margin-top:12px;border-top:1px dashed #e0e7ff;padding-top:10px">'+
    log.slice(0,6).map(function(l){
      return '<div style="display:flex;gap:8px;padding:6px 0;font-size:12px;color:#4a5568">'+
        '<span style="color:#1a56db;flex-shrink:0">▸</span>'+
        '<div style="min-width:0"><span style="font-weight:650">'+stageNameOf(p,l.to)+'</span>'+
        (l.note?'<span style="color:#8492a6"> — '+l.note+'</span>':'')+
        '<div style="font-size:11px;color:#9aa5b5;margin-top:1px">'+new Date(l.ts).toLocaleString('zh-CN')+(l.who?' · '+l.who:'')+'</div></div>'+
      '</div>';
    }).join('')+
  '</div>';
}

/* 读取阶段推进面板表单并提交 */
function saveStageAdvance(projKey){
  var targetEl = document.getElementById('stage-target-'+projKey);
  var noteEl = document.getElementById('stage-note-'+projKey);
  if(!targetEl) return;
  advanceStageTo(projKey, targetEl.value, noteEl ? noteEl.value : '');
}

/* 新增后续自定义阶段 */
function addCustomStage(projKey){
  var p = PROJECTS[projKey]; if(!p) return;
  openModal('新增后续阶段',
    '<p class="modal-intro">输入要追加的阶段名称（如「第二次会议」「实地考察」「签约落地」），追加到当前流程末尾，后续不写死。</p>'+
    '<input id="customStageName" placeholder="阶段名称…" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;outline:none">',
    '<button class="secondary-button" onclick="closeModal()">取消</button>'+
    '<button class="primary-button" onclick="confirmAddCustomStage(\''+projKey+'\')">添加</button>');
}
function confirmAddCustomStage(projKey){
  var p = PROJECTS[projKey]; if(!p) return;
  var name = ((document.getElementById('customStageName')||{}).value||'').trim();
  if(!name){ toast('请输入阶段名称'); return; }
  if(!p.customStages) p.customStages=[];
  p.customStages.push(name);
  persist();
  closeModal();
  render();
  toast('✓ 已新增阶段「'+name+'」');
}

function toggleProjGroup(k){
  window.__projOpen=(window.__projOpen===k)?null:k;
  render();
}
// 招引项目独立工作页 = 该方向的"对话作战室"（雷总三栏：中=持续对话，右=证据卡片）
function subWorkPage(p){
  var subs=subprojOf(cur);var s=subs[curSub];
  if(!s){view='home';return projMgmtPage(p);}
  var dir=P();var st=REPORTSTATE[cur];
  var stg=s.stage||4;var sc=stColor(stg);
  var stageName=STAGES[Math.min(stg,STAGES.length)-1][0];
  // 顶部上下文条：项目本质信息 + 已双确认（一屏交代"这是什么项目/推进到哪"）
  var ctx='<div class="context-bar" style="margin:0 22px">'+
    '<div class="context-icon"><i class="i">🎯</i></div>'+
    '<div style="flex:1;min-width:0"><strong>'+s.dir+'</strong>'+
      '<span>来源：'+s.from+' 报告 v'+(st?st.ver:1)+(st&&st.finalized?'（已定稿）':'')+' · 候选：'+(s.clueName||'暂无')+' · 双确认已完成</span></div>'+
    '<span class="status-tag" style="color:'+sc.c+';background:'+sc.bg+'">'+stageName+'</span></div>';
  return '<div class="page">'+
    '<div style="display:flex;align-items:center;gap:10px;padding:12px 22px 6px">'+
      '<button class="ghost-button" onclick="go(\'home\')"><i class="i">‹</i>返回项目管理</button><div style="flex:1"></div>'+
      '<button class="ghost-button" onclick="exportSub()"><i class="i">📤</i>导出项目材料</button></div>'+
    ctx+
    '<div class="conversation-scroll" id="conv">'+
      '<div class="message"><img src="'+aiAvatar()+'"><div class="message-bubble">'+
        '<p>这是「<strong>'+s.dir.split(' · ')[0]+'</strong>」招引项目的工作区。它由'+s.from+'研判报告的补链方向经双确认后自动生成，候选线索为 <strong>'+(s.clueName||'暂无')+'</strong>。</p>'+
        '<p>我可以基于这个项目的上下文，帮你把下一步的<strong>材料</strong>准备出来——起草对接方案、列核验清单、写领导汇报、或补充该方向其它可招引环节。生成的都是草稿，需你确认，系统不会自动联系企业。</p></div></div>'+
      '<div class="prompt-list">'+
        promptRow('📝','起草企业对接方案','面向候选企业的初步对接思路与本地承接优势',"subQuick('draft')")+
        promptRow('🔍','生成核验问题清单','对接前需向企业核实的关键问题（供资源端参考）',"subQuick('verify')")+
        promptRow('📤','写给领导的进展汇报','把该项目当前状态汇总成一段可上报的进展',"subQuick('report')")+
        promptRow('➕','补充该方向其它招引环节','围绕本方向，研判还可以补哪些上下游环节',"subQuick('expand')")+
      '</div>'+
    '</div>'+composer()+'</div>';
}
// 项目工作区快捷指令：基于项目上下文，AI生成对应材料草稿（人工可编辑，不自动联系企业）
function subQuick(kind){
  var subs=subprojOf(cur);var s=subs[curSub];if(!s)return;
  var pl=$('.prompt-list');if(pl)pl.remove();
  var dirName=s.dir.split(' · ')[0];
  var p=P();
  var ask={
    draft:'帮我起草一份面向「'+dirName+'」候选企业的初步对接方案',
    verify:'对接前，我需要向「'+dirName+'」候选企业核实哪些关键问题？',
    report:'把「'+dirName+'」这个项目的当前进展汇总成一段给领导的汇报',
    expand:'围绕「'+dirName+'」这个方向，还可以补充研判哪些上下游环节？'
  }[kind]||('关于「'+dirName+'」项目，请给出建议');
  addU(ask);
  setTimeout(function(){ subReply(kind,s,p); },500);
}
function subReply(kind,s,p){
  var dirName=s.dir.split(' · ')[0];
  var body,tag,fileHint;
  var _kbInd2=p.kb&&p.kb[0]||{};var _kbPark2=p.kb&&p.kb[1]||{};
  var _kbFirm2=p.kb&&p.kb[2]||{};var _kbPol2=p.kb&&p.kb[3]||{};
  var _ind2Txt=(_kbInd2.known||[]).slice(0,2).join('；')||p.city+'产业基础扎实，具体配套率见产业链图谱';
  var _park2Txt=(_kbPark2.known||[]).slice(0,1).join('')||p.city+'高新区/经开区具备承接载体';
  var _pol2Txt=(_kbPol2.known||[]).slice(0,1).join('')||'本地产业扶持政策方向明确，专项资金额度待领导确认';
  if(kind==='draft'){
    tag='对接方案（草稿 · 待确认）';fileHint='对接方案';
    body='<p>已结合<strong>'+s.from+'</strong>报告结论与'+p.city+'本地承接条件，起草「'+dirName+'」初步对接方案草稿——</p>'+
      '<div class="report" style="margin-top:6px"><div class="rbody" style="padding:12px 14px;font-size:12.5px;line-height:1.9;color:#33415a">'+
        '<b>一、'+p.city+'承接优势</b><br>'+_ind2Txt+'。'+_park2Txt+'，可与候选企业形成上下游/场景协同配套。<br>'+
        '<b>二、对企业的核心价值点</b><br>本地整车/改装产量大（配套采购需求稳定）；'+(_kbFirm2.known||[]).slice(0,1).join('')||'骨干链主提供稳定订单'+'；示范场景开放可加速企业渗透市场。<br>'+
        '<b>三、拟对接方式</b><br>由资源端核验「'+s.clueName+'」真实意向后，安排实地走访'+p.city+'承接园区 + 政企座谈；我方准备承接材料与可用时段。<br>'+
        '<b>四、待补充确认</b><br>'+_pol2Txt+'；首选承接园区地块需向领导确认后填入本方案。'+
      '</div></div>';
  }else if(kind==='verify'){
    tag='核验清单（供资源端参考）';fileHint='核验清单';
    var qs=(P().clues||[]).filter(function(c){return c.name===s.clueName})[0];
    var list=(qs&&qs.qs)?qs.qs:['未来三年产能与异地布局计划','对落地城市的应用场景与政策诉求','与本地存量企业的配套/联合开发可能性'];
    body='<p>对接「'+dirName+'」候选企业前，建议资源端重点核实以下问题（系统不直接联系企业）——</p>'+
      '<div class="report" style="margin-top:6px"><div class="rbody" style="padding:12px 14px"><ol class="number-list">'+
      list.map(function(q,i){return '<li><span>'+(i+1)+'</span>'+q+'</li>'}).join('')+'</ol></div></div>';
  }else if(kind==='report'){
    tag='进展汇报（草稿）';fileHint='进展汇报';
    var _rptKb=p.kb&&p.kb[0]||{};var _rptInd=(_rptKb.known||[])[0]||p.city+'产业基础扎实';
    body='<p>已把「'+dirName+'」项目当前状态汇总为一段可上报进展——</p>'+
      '<div class="report" style="margin-top:6px"><div class="rbody" style="padding:12px 14px;font-size:12.5px;line-height:1.9;color:#33415a">'+
      '关于随州「'+s.from+'」方向的「'+dirName+'」招引项目：'+
      '产业基础：'+_rptInd+'。'+
      '当前进展：已完成研判报告并经干部+授权领导双确认，形成正式招商需求并递交资源端。候选线索：'+(s.clueName||'待资源端补充')+'，资源端正核验企业真实意向与决策层触达，预计 2 个工作日反馈。'+
      '下一步：资源核验通过后安排实地走访随州承接园区，并准备政策/园区/配套等承接材料。</div></div>';
  }else{
    tag='方向拓展建议';fileHint='拓展建议';
    // 从当前项目 kb[0] 的 known 推导上下游
    var _kbExpand=p.kb&&p.kb[0]||{};
    var _expandItems=[];
    (_kbExpand.known||[]).forEach(function(kn){
      if(/外购|缺口|空白|全靠/.test(kn)){
        // 找到缺口关键词，截取主语作为建议方向
        var short=kn.replace('本地仍属空白','').replace('几乎全部外购','').replace('全部外购','').replace('缺乏本地供给','').trim();
        if(short.length>4&&short.length<40)_expandItems.push(short+'（补链候选）');
      }
    });
    if(!_expandItems.length){
      _expandItems=['上游关键部件 / 材料本地配套','面向新场景的系统集成能力','检测认证 / 中试等生产性服务环节'];
    }
    body='<p>围绕「'+dirName+'」，从产业链上下游看，以下环节尚可深入研判——</p>'+
      '<div class="report" style="margin-top:6px"><div class="rbody" style="padding:12px 14px"><ul class="check-list">'+
      _expandItems.map(function(x){return '<li><i class="i">•</i>'+x+'</li>'}).join('')+
      '</ul></div></div><p style="margin-top:6px;font-size:12px;color:#667590">如需研判某个环节，可到「研判需求」新增产业方向。</p>';
  }
  var d=addA(body+'<div class="answer-note" style="margin-top:8px">⚠ 以上为 AI 生成草稿，关键判断需人工确认；系统不自动联系企业、不跳过确认关口。</div>');
  // 生成结果附操作条：导出该材料
  if(d){var bar=document.createElement('div');bar.style.cssText='margin:8px 0 0 60px';
    bar.innerHTML='<button class="ghost-button" style="font-size:11.5px;padding:5px 10px" onclick="exportSub()"><i class="i">📤</i>连同项目材料一起导出</button>'+
      '<span style="font-size:11px;color:#9aa5b5;margin-left:8px">'+tag+'</span>';
    var c=$('#conv');if(c)c.appendChild(bar);sd();}
}
// 导出项目卡
function exportSub(){
  var subs=subprojOf(cur);var s=subs[curSub];if(!s){toast('项目不存在');return;}
  var p=P();var now=new Date().toLocaleString('zh-CN');var L=[];
  L.push('招引项目卡 · '+s.name.split(' · ')[0]);
  L.push('导出时间：'+now+'　|　编制：'+p.org+' · '+p.who);
  L.push('====================================================\n');
  L.push('招引方向：'+s.dir);
  L.push('来源产业方向：'+s.from);
  L.push('候选企业（脱敏）：'+(s.clueName||'暂无'));
  L.push('确认状态：干部确认 + 授权领导确认 已完成，已正式递交');
  L.push('当前阶段：'+stageNameOf(s, s.stage||4));
  L.push('');
  L.push('----------------------------------------------------');
  L.push('对接进度：需求已递交 → 资源匹配中 → 安排招商对接（待资源回传）');
  L.push('使用边界：脱敏展示，不显示内部人脉路径；对接由资源端线下推进，系统不自动联系企业。');
  var blob=new Blob([L.join('\n')],{type:'text/plain;charset=utf-8'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='招引项目_'+s.name.split(' · ')[0]+'.txt';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  toast('已导出项目卡：'+s.name.split(' · ')[0]);
}
// 招商对接：独立tab，展示所有项目的对接进度
/* ══════════════════════════════════════════════════════════════
   招商对接页面重建
   ══════════════════════════════════════════════════════════════ */

/* 对接记录存储 {projKey: [{ts, note, type}]} */
var DOCK_LOGS = DOCK_LOGS || {};
var OPS_ENT = OPS_ENT || [];  // 管理端企业库（无硬编码，全部来自用户录入）

function dockingPage(p){
  var projKeys=Object.keys(PROJECTS).filter(function(k){return PROJECTS[k].stage>=3;});

  if(!projKeys.length){
    return '<div class="page">'+
      '<div class="page-header"><div><span class="eyebrow">DOCKING</span><h1>招商对接</h1>'+
      '<p>招引需求提交后，资源核验与对接进度会出现在这里。</p></div></div>'+
      '<div class="knowledge-scroll"><div style="text-align:center;padding:60px 20px">'+
        '<div style="font-size:36px;margin-bottom:12px">🤝</div>'+
        '<div style="font-size:15px;font-weight:700;color:#0b183b;margin-bottom:8px">尚未提交招引需求</div>'+
        '<div style="font-size:13px;color:#8492a6;line-height:1.7;margin-bottom:20px">'+
          '在「项目管理」中提交招引需求后，<br>候选线索的资源核验与对接进度会出现在这里'+
        '</div>'+
        '<button onclick="go(\'home\')" style="padding:10px 24px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:10px;font-size:13.5px;font-weight:650;cursor:pointer">前往项目管理 →</button>'+
      '</div></div></div>';
  }

  if(!window.__dockPick || !PROJECTS[window.__dockPick]) window.__dockPick=projKeys[0];
  var pk=window.__dockPick;
  var px=PROJECTS[pk];
  var clues=px.clues||[];
  var logs=DOCK_LOGS[pk]||[];

  // ── 左侧项目列表 ──
  var projectList=projKeys.map(function(k){
    var x=PROJECTS[k];
    var sc=stColor(x.stage);
    var xClues=x.clues||[];
    var teal=xClues.filter(function(c){return c.tone==='teal';}).length;
    var amber=xClues.filter(function(c){return c.tone==='amber';}).length;
    var isOn=(k===pk);
    return '<button onclick="pickDock(\''+k+'\')" style="width:100%;text-align:left;padding:12px 14px;border:1.5px solid '+(isOn?'#1a56db':'#e8edf5')+';border-radius:12px;background:'+(isOn?'#f0f4ff':'#fff')+';cursor:pointer;margin-bottom:8px">'+
      '<div style="display:flex;align-items:center;gap:10px">'+
        '<span style="font-size:18px;flex-shrink:0">🎯</span>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:13px;font-weight:700;color:#0b183b;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+x.topic+'</div>'+
          '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
            (teal?'<span style="padding:1px 7px;background:#f0fdf4;color:#166534;border-radius:10px;font-size:11px">'+teal+'条可沟通</span>':'')+
            (amber?'<span style="padding:1px 7px;background:#fffbeb;color:#92400e;border-radius:10px;font-size:11px">'+amber+'条核验中</span>':'')+
            (!teal&&!amber?'<span style="padding:1px 7px;background:#f5f7fb;color:#6b7280;border-radius:10px;font-size:11px">'+xClues.length+'条待接触</span>':'')+
          '</div>'+
        '</div>'+
        '<span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;background:'+sc.bg+';color:'+sc.c+';flex-shrink:0">'+stageNameOf(x,x.stage)+'</span>'+
      '</div>'+
    '</button>';
  }).join('');

  // ── 右侧：时间线 + 候选线索状态 + 对接记录 ──

  // 递交时间线
  var submitTime=logs.length?new Date(logs[0].ts).toLocaleString('zh-CN'):new Date().toLocaleString('zh-CN');
  var timeline=
    '<div style="margin-bottom:20px">'+
      '<div style="font-size:12px;font-weight:650;color:#4a5568;letter-spacing:.3px;margin-bottom:12px">递交时间线</div>'+
      '<div style="display:flex;flex-direction:column;gap:0">'+
        // 节点1：需求已递交
        '<div style="display:flex;gap:12px">'+
          '<div style="display:flex;flex-direction:column;align-items:center">'+
            '<div style="width:28px;height:28px;border-radius:50%;background:#1a56db;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;flex-shrink:0">✓</div>'+
            '<div style="width:2px;flex:1;background:#e8edf5;margin:4px 0"></div>'+
          '</div>'+
          '<div style="padding:2px 0 16px">'+
            '<div style="font-size:13px;font-weight:650;color:#0b183b">需求已递交</div>'+
            '<div style="font-size:12px;color:#8492a6;margin-top:2px">已同步招商需求、承接区域与报告证据链</div>'+
          '</div>'+
        '</div>'+
        // 节点2：资源核验
        (px.stage>=4?
          '<div style="display:flex;gap:12px">'+
            '<div style="display:flex;flex-direction:column;align-items:center">'+
              '<div style="width:28px;height:28px;border-radius:50%;background:'+(px.stage>=5?'#22c55e':'#f59e0b')+';display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;flex-shrink:0">'+(px.stage>=5?'✓':'◔')+'</div>'+
              '<div style="width:2px;flex:1;background:#e8edf5;margin:4px 0"></div>'+
            '</div>'+
            '<div style="padding:2px 0 16px">'+
              '<div style="font-size:13px;font-weight:650;color:#0b183b">资源可达性核验中</div>'+
              '<div style="font-size:12px;color:#8492a6;margin-top:2px">资源团队正在核验企业真实意向与决策层触达路径</div>'+
            '</div>'+
          '</div>'
        :'<div style="display:flex;gap:12px">'+
            '<div style="display:flex;flex-direction:column;align-items:center">'+
              '<div style="width:28px;height:28px;border-radius:50%;background:#f0f4ff;border:2px solid #e8edf5;display:flex;align-items:center;justify-content:center;color:#9aa5b5;font-size:12px;flex-shrink:0">2</div>'+
              '<div style="width:2px;flex:1;background:#e8edf5;margin:4px 0"></div>'+
            '</div>'+
            '<div style="padding:2px 0 16px">'+
              '<div style="font-size:13px;font-weight:650;color:#9aa5b5">资源可达性核验</div>'+
              '<div style="font-size:12px;color:#b0bac8;margin-top:2px">待候选线索核验启动</div>'+
            '</div>'+
          '</div>')+
        // 节点3：首次沟通
        (px.stage>=5?
          '<div style="display:flex;gap:12px">'+
            '<div style="display:flex;flex-direction:column;align-items:center">'+
              '<div style="width:28px;height:28px;border-radius:50%;background:#22c55e;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;flex-shrink:0">✓</div>'+
            '</div>'+
            '<div style="padding:2px 0">'+
              '<div style="font-size:13px;font-weight:650;color:#0b183b">可安排首次沟通</div>'+
              '<div style="font-size:12px;color:#8492a6;margin-top:2px">核验通过，请准备承接材料与可用时段</div>'+
            '</div>'+
          '</div>'
        :'<div style="display:flex;gap:12px">'+
            '<div style="width:28px;height:28px;border-radius:50%;background:#f0f4ff;border:2px solid #e8edf5;display:flex;align-items:center;justify-content:center;color:#9aa5b5;font-size:12px;flex-shrink:0">3</div>'+
            '<div style="padding:2px 0">'+
              '<div style="font-size:13px;font-weight:650;color:#9aa5b5">首次沟通</div>'+
              '<div style="font-size:12px;color:#b0bac8;margin-top:2px">核验通过后安排</div>'+
            '</div>'+
          '</div>')+
      '</div>'+
    '</div>';

  // 候选企业状态
  var clueStatus=clues.length
    ? '<div style="margin-bottom:20px">'+
        '<div style="font-size:12px;font-weight:650;color:#4a5568;letter-spacing:.3px;margin-bottom:10px">候选企业线索</div>'+
        clues.map(function(c){
          var toneMap={slate:{bg:'#f5f7fb',dot:'#9aa5b5',label:'待接触'},amber:{bg:'#fffbeb',dot:'#f59e0b',label:'核验中'},teal:{bg:'#f0fdf4',dot:'#22c55e',label:'可安排沟通'}};
          var t=toneMap[c.tone]||toneMap.slate;
          return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:'+t.bg+';border-radius:10px;margin-bottom:6px">'+
            '<span style="width:8px;height:8px;border-radius:50%;background:'+t.dot+';flex-shrink:0"></span>'+
            '<div style="flex:1;min-width:0">'+
              '<div style="font-size:13px;font-weight:650;color:#0b183b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+c.name+'</div>'+
              '<div style="font-size:11.5px;color:#8492a6">'+c.kind+'</div>'+
            '</div>'+
            '<span style="padding:2px 8px;background:'+t.bg+';color:'+t.dot+';border:1px solid;border-radius:20px;font-size:11px;font-weight:600;flex-shrink:0">'+t.label+'</span>'+
          '</div>';
        }).join('')+
      '</div>'
    : '<div style="margin-bottom:20px;padding:14px;background:#f9fafb;border-radius:10px;font-size:13px;color:#9aa5b5;text-align:center">'+
        '尚无候选线索 · 在「项目管理」中发起资源核验后出现'+
      '</div>';

  // 对接记录
  var dockLogs=
    '<div>'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'+
        '<span style="font-size:12px;font-weight:650;color:#4a5568;letter-spacing:.3px">对接记录</span>'+
        '<span style="font-size:11px;color:#9aa5b5">'+logs.length+'条</span>'+
      '</div>'+
      (logs.length
        ? logs.map(function(l){
            var typeIcon={visit:'🤝',call:'📞',email:'📧',material:'📎'}[l.type]||'📝';
            return '<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #f0f4ff">'+
              '<span style="font-size:16px;flex-shrink:0">'+typeIcon+'</span>'+
              '<div style="flex:1">'+
                '<div style="font-size:12.5px;color:#1e293b;line-height:1.6">'+l.note+'</div>'+
                '<div style="font-size:11px;color:#9aa5b5;margin-top:3px">'+new Date(l.ts).toLocaleString('zh-CN')+'</div>'+
              '</div>'+
            '</div>';
          }).join('')
        : '<div style="font-size:12.5px;color:#9aa5b5;padding:8px 0">暂无对接记录</div>'
      )+
      // 录入区
      '<div style="margin-top:12px">'+
        '<div style="display:flex;gap:6px;margin-bottom:8px">'+
          ['visit:🤝拜访','call:📞电话','email:📧邮件','material:📎材料'].map(function(s){
            var parts=s.split(':'), val=parts[0], label=parts[1];
            return '<button onclick="setDockType(\''+pk+'\',\''+val+'\')" id="dtype-'+pk+'-'+val+'" '+
              'style="padding:5px 10px;border:1.5px solid #e8edf5;border-radius:8px;font-size:12px;cursor:pointer;background:#f5f7fb;color:#4a5568">'+label+'</button>';
          }).join('')+
        '</div>'+
        '<textarea id="dock-note-'+pk+'" placeholder="记录本次沟通内容、关键信息或待跟进事项…" '+
          'style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;resize:vertical;min-height:72px;outline:none;line-height:1.6" '+
          'onfocus="this.style.border=\'1.5px solid #6366f1\'" onblur="this.style.border=\'1.5px solid #e8edf5\'"></textarea>'+
        '<button onclick="saveDockLog(\''+pk+'\')" '+
          'style="width:100%;margin-top:8px;padding:9px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:650;cursor:pointer">'+
          '保存对接记录</button>'+
      '</div>'+
    '</div>';

  // 下一步政府待办
  var nextStep='';
  if(px.stage===3){
    nextStep='<div style="padding:12px 14px;background:#fffbeb;border:1.5px solid #fde68a;border-radius:12px;margin-bottom:16px">'+
      '<div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:6px">⏳ 等待资源核验启动</div>'+
      '<div style="font-size:12px;color:#4a5568;line-height:1.7">候选线索已录入，等待资源团队判断可触达路径。可在「项目管理」中点「请资源团队核验」推进。</div>'+
    '</div>';
  } else if(px.stage===4){
    nextStep='<div style="padding:12px 14px;background:#fff7ed;border:1.5px solid #fed7aa;border-radius:12px;margin-bottom:16px">'+
      '<div style="font-size:12px;font-weight:700;color:#c2410c;margin-bottom:6px">🔍 资源核验进行中（预计2个工作日）</div>'+
      '<div style="font-size:12px;color:#4a5568;line-height:1.7">政府侧待办：准备<strong>园区承接条件说明</strong>（可用厂房/能耗指标）和<strong>可用时段</strong>，核验通过后即可安排首次沟通。</div>'+
    '</div>';
  } else if(px.stage>=5){
    nextStep='<div style="padding:12px 14px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;margin-bottom:16px">'+
      '<div style="font-size:12px;font-weight:700;color:#166534;margin-bottom:6px">✓ 可安排首次沟通</div>'+
      '<div style="font-size:12px;color:#4a5568;line-height:1.7">政府侧待办：确认<strong>接待时段</strong>、准备<strong>承接方案</strong>（园区/政策/配套）。在下方填写对接记录跟踪进展。</div>'+
    '</div>';
  }

  // 查看/下载报告
  var reportActions=REPORTSTATE[pk]
    ? '<div style="display:flex;gap:8px;margin-bottom:16px">'+
        '<button onclick="cur=\''+pk+'\';viewCurrentReport()" style="flex:1;padding:9px;background:#f8faff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:12.5px;color:#1a56db;cursor:pointer;font-weight:600">📋 查看研判报告</button>'+
        '<button onclick="cur=\''+pk+'\';downloadReport(\'full\')" style="padding:9px 14px;background:#f8faff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:12.5px;color:#1a56db;cursor:pointer">⬇ 下载</button>'+
      '</div>'
    : '';

  return '<div class="page">'+
    '<div class="page-header"><div><span class="eyebrow">DOCKING</span><h1>招商对接</h1>'+
    '<p>已递交需求的核验进度与对接记录。候选企业信息均为脱敏展示，资源细节由资源团队掌握。</p></div></div>'+
    '<div style="display:grid;grid-template-columns:280px 1fr;gap:16px;height:calc(100vh - 130px);padding:0 22px 16px;overflow:hidden">'+
      // 左列
      '<div style="overflow-y:auto;padding-right:8px">'+
        '<div style="font-size:11px;font-weight:650;color:#9aa5b5;letter-spacing:.5px;margin-bottom:10px;padding-top:2px">已提交项目</div>'+
        projectList+
      '</div>'+
      // 右列
      '<div style="overflow-y:auto;padding-left:8px;border-left:1px solid #f0f4ff">'+
        nextStep+
        reportActions+
        timeline+
        clueStatus+
        dockLogs+
        '<div style="margin-top:14px;padding:10px 12px;background:#f9fafb;border-radius:8px;font-size:11.5px;color:#9aa5b5;line-height:1.6">'+
          'ⓘ 政府端展示边界：仅展示脱敏状态与下一步；企业真实名称、联系方式由资源团队保管。系统不会自动联系企业。'+
        '</div>'+
      '</div>'+
    '</div></div>';
}

/* ── 对接记录辅助函数 ── */
var __dockType = {};
function setDockType(projKey, type){
  __dockType[projKey] = type;
  // 更新按钮样式
  ['visit','call','email','material'].forEach(function(t){
    var btn=document.getElementById('dtype-'+projKey+'-'+t);
    if(!btn) return;
    btn.style.background = t===type ? '#eff6ff' : '#f5f7fb';
    btn.style.borderColor = t===type ? '#bfdbfe' : '#e8edf5';
    btn.style.color = t===type ? '#1a56db' : '#4a5568';
  });
}

function saveDockLog(projKey){
  var ta=document.getElementById('dock-note-'+projKey);
  if(!ta||!ta.value.trim()){toast('请填写对接记录内容');return;}
  if(!DOCK_LOGS[projKey]) DOCK_LOGS[projKey]=[];
  DOCK_LOGS[projKey].unshift({
    ts: Date.now(),
    note: ta.value.trim(),
    type: __dockType[projKey]||'visit'
  });
  persist();
  ta.value='';
  render();
  toast('✓ 对接记录已保存');
}
function ctxBar(icon,strong,span){
  return '<div class="context-bar"><div class="context-icon"><i class="i">'+icon+'</i></div>'+
    '<div><strong>'+strong+'</strong><span>'+span+'</span></div>'+
    '<span class="context-fresh"><i class="i">🕒</i>今日 06:00 已更新</span></div>';
}
function composer(){
  var sub=view==='subwork';
  var isKb=view==='knowledge';
  var activeTopic=null;
  if(isKb){var b=document.getElementById('kbTopicBadge');
    if(b){var tel=b.querySelectorAll('div>div');tel.forEach(function(d){if(d.style&&d.fontSize==='13px')activeTopic=d.textContent.trim();});
      if(!activeTopic){var els=b.querySelectorAll('div');els.forEach(function(d){if(d.textContent&&d.textContent.length>4&&d.textContent.length<20)activeTopic=d.textContent.trim();});}
    }
  }
  var pillColors={'主导产业与产业链':'background:#eff6ff;color:#1d4ed8;border:1.5px solid #bfdbfe',
    '园区与承载条件':'background:#f0fdf4;color:#166534;border:1.5px solid #bbf7d0',
    '链主与存量企业':'background:#fdf4ff;color:#6b21a8;border:1.5px solid #e9d5ff',
    '政策、规划与领导关注':'background:#fffbeb;color:#92400e;border:1.5px solid #fde68a'};
  var topicPill='';
  if(isKb&&activeTopic){
    var ps=pillColors[activeTopic]||'background:#f5f7fb;color:#4a5568;border:1.5px solid #e8edf5';
    topicPill='<div style="display:flex;align-items:center;gap:6px;padding:6px 14px 2px">'+
      '<span style="font-size:11px;color:#9aa5b5">正在询问：</span>'+
      '<span style="padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600;'+ps+'">'+activeTopic+'</span>'+
      '<button onclick="clearKbActiveTopic()" style="background:none;border:none;color:#b0bac8;font-size:13px;cursor:pointer;padding:0 3px" title="取消">✕</button>'+
    '</div>';
  }
  var ph=isKb&&activeTopic?'针对「'+activeTopic+'」提问，我会优先检索该主题数据…':
      isKb?'直接输入问题，例如：'+P().city+'最值得补链的核心缺口是哪些？':
      sub?'针对本项目：让我起草对接方案、列核验清单、写领导汇报，或补充招引环节…':
      '可直接描述产业方向、细分环节、目标企业或领导交办任务，我会结合城市智库与最新公开信息研判…';
  return '<div class="composer-wrap">'+topicPill+'<div class="composer">'+
    '<div class="composer-tools">'+
      '<button onclick="uploadHint()"><i class="i"></i>上传材料</button>'+
      (isKb&&activeTopic?'<button onclick="clearKbActiveTopic()"><i class="i">⌂</i>全局问答</button>':'')+
      '<button onclick="go(\'knowledge\')"><i class="i"></i>'+P().city+'城市智库</button></div>'+
    '<textarea id="composerTa" placeholder="'+ph+'"></textarea>'+
    '<button class="send-button" onclick="sendMsg()"><i class="i">➤</i></button></div>'+
    '<div class="composer-helper"><span>支持上传：政府工作报告 / 领导发言稿 / 产业报告 / 园区资料 / 企业名单</span>'+
    '<button onclick="uploadHint()">查看建议材料清单</button></div></div>';
}

function renderComposer(){
  var wrap=document.querySelector('.composer-wrap');
  if(!wrap)return;
  var tmp=document.createElement('div');
  tmp.innerHTML=composer();
  wrap.replaceWith(tmp.firstChild);
  bind();
}

/* topic helpers */
function editTopic(){
  var d=document.getElementById('topicDisplay');
  var e=document.getElementById('topicEdit');
  var inp=document.getElementById('topicInput');
  if(d)d.style.display='none';
  if(e)e.style.display='block';
  if(inp){inp.focus();inp.select();}
}
function saveTopic(){
  var inp=document.getElementById('topicInput');
  var t=inp&&inp.value.trim();
  if(!t)return;
  var p=P();if(!p)return;
  p.topic=t; persist();
  var txt=document.getElementById('topicText');
  if(txt)txt.textContent=t;
  cancelTopicEdit();
  toast('\u2713 \u7814\u5224\u65b9\u5411\u5df2\u66f4\u65b0\u4e3a\u300c'+t+'\u300d');
}
function cancelTopicEdit(){
  var d=document.getElementById('topicDisplay');
  var e=document.getElementById('topicEdit');
  if(d)d.style.display='flex';
  if(e)e.style.display='none';
}

/* ── 研判需求页辅助函数 ── */

// 选择研判方向（卡片点击 or 自定义输入）
function selectTopic(val, isCustom){
  var p=P(); if(!p||!val||!val.trim()) return;
  var newTopic=val.trim();
  // If project already has report or submitted demand, create a new project for the new direction
  if(p.topic!==newTopic && (REPORTSTATE[cur] || DEMANDS.find(function(d){return d.projKey===cur;}))){
    var id='p'+Date.now().toString(36);
    PROJECTS[id]={id:id,city:p.city,org:p.org,who:p.who,topic:newTopic,stage:1,
      kb:JSON.parse(JSON.stringify(p.kb)),report:null,clues:[]};
    // Reset kb confirmations for new project
    cur=id; persist(); render();
    toast('已为「'+newTopic+'」创建独立研判，原方向数据不变');
    return;
  }
  p.topic=newTopic;
  persist();
  var badge=document.getElementById('currentTopicBadge');
  if(badge) badge.textContent=p.topic;
  if(!isCustom){
    var inp=document.getElementById('topicCustomInput');
    if(inp) inp.value='';
  }
  // 同步刷新报告区（切换方向时换报告文本+图谱）
  var _ra=document.getElementById('reportArea');
  if(_ra){
    var _rs=REPORTSTATE[cur];
    if(_rs&&(_rs.finalized||_rs.phase===2)){
      var _nt=getTopicReport(p.topic);
      if(_nt){ _rs.text=_nt; }
      _rs.topic=p.topic;
      _ra.innerHTML=reportHtml(p);
      var _cmEl=document.getElementById('chainMapBlock');
      if(_cmEl){ _cmEl.innerHTML=chainMapHtml(p); }
      else{
        var _cm2=document.createElement('div');
        _cm2.id='chainMapBlock';
        _cm2.innerHTML=chainMapHtml(p);
        _ra.appendChild(_cm2);
      }
    }
  }
  // 同步刷新右侧面板（报告状态·研判方向）
  var _dp=document.querySelector('.detail-pane');
  if(_dp){
    _dp.innerHTML='<button class="collapse-detail" onclick="toggleDetail()"><i class="i">✕</i></button>'+
      '<div class="detail-page">'+detailReport(p)+'</div>';
  }
  // 重渲染卡片高亮
  var cardGrid=document.getElementById('topicCardGrid');
  if(!cardGrid) return;
  var topics=generateTopicsFromKb(p);
  cardGrid.innerHTML=topics.map(function(t){
    var act=p.topic===t.label;
    return '<button onclick="selectTopic(this.getAttribute(\'data-v\'))" data-v="'+t.label+'" style="'+
      'display:flex;flex-direction:column;align-items:flex-start;padding:14px 16px;'+
      'background:'+(act?'linear-gradient(135deg,#eff6ff,#f0f9ff)':'#fff')+';'+
      'border:2px solid '+(act?'#1a56db':'#e8edf5')+';'+
      'border-radius:14px;cursor:pointer;text-align:left;flex:1;min-width:0">'+
      '<span style="font-size:20px;margin-bottom:6px">'+t.icon+'</span>'+
      '<span style="font-size:13px;font-weight:700;color:#0b183b;display:block;margin-bottom:4px">'+t.label+'</span>'+
      '<span style="font-size:11.5px;color:#8492a6;line-height:1.4">'+t.desc+'</span>'+
      (act?'<div style="margin-top:8px;width:8px;height:8px;border-radius:50%;background:#1a56db"></div>':'')+
    '</button>';
  }).join('');
}

// 触发生成报告
/* ══════════════════════════════════════════════════════════════
   研判需求 — 待确认事项结构化面板
   流程：进入页面自动触发草稿 → 解析⚠️ → 渲染确认面板 → 全部确认后解锁完整报告
   ══════════════════════════════════════════════════════════════ */

// 待确认事项状态 {projKey: [{text, status:'pending'|'confirmed'|'edited', editedText, files:[]}]}
var PENDING_CONFIRMS = PENDING_CONFIRMS || {};

/* 解析草稿文本，提取⚠️条目 */
function parsePendingItems(text){
  var items = [];
  var lines = text.split('\n');
  lines.forEach(function(line){
    var clean = line.replace(/^[\s\-•*]+/, '').trim();
    if(!clean) return;
    // 含⚠️的行
    if(clean.indexOf('⚠️') >= 0 || clean.indexOf('⚠') >= 0){
      var t = clean.replace('⚠️','').replace('⚠','').replace(/^[\s:：]+/,'').trim();
      if(t.length > 5) items.push({text: t, status:'pending', editedText:'', files:[]});
    }
  });
  return items;
}


/* ══ 报告历史记录 ══ */
var REPORT_HISTORY = REPORT_HISTORY || {};
var USER_PROFILES = (typeof USER_PROFILES!=='undefined'&&USER_PROFILES) || {};  // 政府端注册用户资料，跨端同步查看

function saveReportHistory(){try{localStorage.setItem('hxz_rpt_history',JSON.stringify(REPORT_HISTORY));}catch(e){}}
function loadReportHistory(){try{var d=localStorage.getItem('hxz_rpt_history');if(d)REPORT_HISTORY=JSON.parse(d);}catch(e){}}
loadReportHistory();

function archiveCurrentReport(key){
  var rs=REPORTSTATE[key];
  if(!rs||!rs.text) return;
  if(!REPORT_HISTORY[key]) REPORT_HISTORY[key]=[];
  // 避免重复归档（同 ts）
  var exists=REPORT_HISTORY[key].some(function(h){return h.ts===rs.ts;});
  if(!exists){
    REPORT_HISTORY[key].unshift({text:rs.text,topic:rs.topic,ts:rs.ts,score:rs.score,phase:rs.phase});
    if(REPORT_HISTORY[key].length>10) REPORT_HISTORY[key]=REPORT_HISTORY[key].slice(0,10);
    saveReportHistory();
  }
}

function deleteHistoryReport(key, idx){
  if(!REPORT_HISTORY[key]) return;
  REPORT_HISTORY[key].splice(idx,1);
  saveReportHistory();
  renderHistoryReports(key);
}

function toggleHistoryReport(key, idx){
  var body=document.getElementById('hrpt-body-'+key+'-'+idx);
  var ico=document.getElementById('hrpt-ico-'+key+'-'+idx);
  if(!body) return;
  var open=body.style.display!=='none';
  body.style.display=open?'none':'block';
  if(ico) ico.textContent=open?'▶':'▼';
}

function renderHistoryReports(key){
  var container=document.getElementById('reportHistoryArea');
  if(!container) return;
  var list=REPORT_HISTORY[key]||[];
  if(!list.length){container.innerHTML='';return;}
  var h='<div style="margin-bottom:12px">';
  h+='<div style="font-size:11.5px;font-weight:700;color:#64748b;letter-spacing:.3px;margin-bottom:6px;display:flex;align-items:center;gap:6px">';
  h+='<span style="display:inline-block;width:3px;height:12px;background:#94a3b8;border-radius:2px"></span>';
  h+='历史报告（'+list.length+' 份）</div>';
  list.forEach(function(rep,i){
    var dt=rep.ts?new Date(rep.ts).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'未知时间';
    var phaseLabel=rep.phase===2?'完整报告':'初步草稿';
    var phaseColor=rep.phase===2?'#1d4ed8':'#92400e';
    var phaseBg=rep.phase===2?'#dbeafe':'#fef3c7';
    h+='<div style="border-radius:12px;border:1.5px solid #e2e8f0;overflow:hidden;margin-bottom:6px;background:#fff">';
    // 折叠头
    h+='<div style="padding:10px 14px;background:#f8faff;display:flex;align-items:center;gap:8px;cursor:pointer" onclick="toggleHistoryReport(\''+key+'\','+i+')">';
    h+='<span id="hrpt-ico-'+key+'-'+i+'" style="font-size:10px;color:#94a3b8;flex-shrink:0">▶</span>';
    h+='<span style="font-size:11px;padding:1px 7px;border-radius:10px;background:'+phaseBg+';color:'+phaseColor+';font-weight:700">'+phaseLabel+'</span>';
    h+='<span style="font-size:12px;font-weight:600;color:#374151;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+rep.topic+'</span>';
    h+='<span style="font-size:11px;color:#94a3b8;flex-shrink:0">'+dt+'</span>';
    if(rep.score!=null) h+='<span style="font-size:11px;color:#64748b;flex-shrink:0;margin-left:4px">'+rep.score+'%</span>';
    h+='<button onclick="event.stopPropagation();deleteHistoryReport(\''+key+'\','+i+')" style="flex-shrink:0;margin-left:6px;padding:2px 8px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;font-size:11px;color:#ef4444;cursor:pointer;font-weight:600">删除</button>';
    h+='</div>';
    // 折叠体（默认收起）
    h+='<div id="hrpt-body-'+key+'-'+i+'" style="display:none;padding:14px 16px;font-size:12.5px;color:#1e293b;line-height:1.8;border-top:1px solid #f0f4ff;max-height:400px;overflow-y:auto">';
    // 简单 markdown 渲染
    var txt=rep.text||'';
    txt=txt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    txt=txt.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
    txt=txt.replace(/^#{1,3}\s(.+)$/gm,'<div style="font-weight:700;color:#0b183b;margin:8px 0 3px">$1</div>');
    txt=txt.replace(/^[-•]\s(.+)$/gm,'<div style="padding-left:12px;margin:2px 0">· $1</div>');
    txt=txt.replace(/\n\n/g,'<br>');
    h+=txt;
    h+='</div>';
    h+='</div>';
  });
  h+='</div>';
  container.innerHTML=h;
}

/* 渲染待确认面板（插在草稿下方） */
function renderConfirmPanel(items, projKey){
  if(!items || !items.length) return '';

  var rows = items.map(function(item, idx){
    var isDone = item.status === 'confirmed' || item.status === 'edited';
    var displayText = item.editedText || item.text;
    var filesBadge = item.files && item.files.length
      ? '<span style="margin-left:6px;padding:1px 7px;background:#f0fdf4;color:#166534;border-radius:10px;font-size:10.5px;border:1px solid #86efac">'+item.files.length+' 个附件</span>'
      : '';

    if(isDone){
      return '<div id="ci-'+projKey+'-'+idx+'" style="display:flex;gap:10px;align-items:flex-start;padding:12px 14px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px">'+
        '<span style="color:#22c55e;font-size:16px;flex-shrink:0;margin-top:1px">✓</span>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:13px;color:#14532d;line-height:1.65">'+displayText+filesBadge+'</div>'+
          (item.status==='edited'?'<div style="font-size:11px;color:#22c55e;margin-top:3px">已修改并确认</div>':'<div style="font-size:11px;color:#22c55e;margin-top:3px">已确认</div>')+
        '</div>'+
        '<button onclick="uncfmItem(\''+projKey+'\','+idx+')" style="padding:3px 8px;background:none;border:1px solid #86efac;border-radius:6px;font-size:11px;color:#22c55e;cursor:pointer;flex-shrink:0">撤回</button>'+
      '</div>';
    }

    return '<div id="ci-'+projKey+'-'+idx+'" style="border-radius:12px;background:#fffbeb;border:1.5px solid #fed7aa;overflow:hidden;transition:box-shadow .2s" onmouseenter="this.style.boxShadow=\'0 2px 8px rgba(245,158,11,0.15)\'" onmouseleave="this.style.boxShadow=\'none\'">'+
      '<div style="padding:13px 15px">'+
        '<div style="display:flex;gap:10px;align-items:flex-start">'+
          '<span style="flex-shrink:0;width:22px;height:22px;background:#fef3c7;border:1.5px solid #fcd34d;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;margin-top:1px">⚠️</span>'+
          '<div id="ci-text-'+projKey+'-'+idx+'" style="flex:1;font-size:13px;color:#78350f;line-height:1.7;font-weight:500">'+displayText+'</div>'+
        '</div>'+
        // 编辑框（默认隐藏）
        '<div id="ci-edit-'+projKey+'-'+idx+'" style="display:none;margin-top:10px">'+
          '<textarea id="ci-ta-'+projKey+'-'+idx+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #6366f1;border-radius:8px;font-size:13px;color:#1e293b;resize:vertical;min-height:64px;outline:none;line-height:1.6">'+displayText+'</textarea>'+
          // 附件上传
          '<div id="ci-drop-'+projKey+'-'+idx+'" '+
            'onclick="ciPickFile(\''+projKey+'\','+idx+')" '+
            'ondragover="event.preventDefault();this.style.background=\'#eef2ff\'" '+
            'ondragleave="this.style.background=\'#f8faff\'" '+
            'ondrop="ciDropFile(event,\''+projKey+'\','+idx+')" '+
            'style="margin-top:8px;padding:10px;border:1.5px dashed #c7d2fe;border-radius:8px;text-align:center;cursor:pointer;background:#f8faff;font-size:12px;color:#6366f1">'+
            '<span id="ci-file-hint-'+projKey+'-'+idx+'">📎 上传附件（可选，拖拽或点击）</span>'+
          '</div>'+
          '<input id="ci-finp-'+projKey+'-'+idx+'" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.csv" style="display:none" onchange="ciFileSelected(this,\''+projKey+'\','+idx+')"/>'+
          '<div style="display:flex;gap:8px;margin-top:8px">'+
            '<button onclick="ciSave(\''+projKey+'\','+idx+')" style="flex:1;padding:7px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer">✓ 保存修改</button>'+
            '<button onclick="ciCancelEdit(\''+projKey+'\','+idx+')" style="padding:7px 12px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:8px;font-size:12.5px;color:#4a5568;cursor:pointer">取消</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
      // 操作栏
      '<div style="padding:10px 15px;background:linear-gradient(135deg,#fefce8,#fef9c3);border-top:1px solid #fde68a;display:flex;gap:8px">'+
        '<button onclick="cfmItem(\''+projKey+'\','+idx+')" style="flex:1;padding:8px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1.5px solid #86efac;border-radius:10px;font-size:12.5px;font-weight:700;color:#166534;cursor:pointer;transition:all .15s" onmouseenter="this.style.background=\'#dcfce7\'" onmouseleave="this.style.background=\'linear-gradient(135deg,#f0fdf4,#dcfce7)\'">✓ 领导确认</button>'+
        '<button onclick="ciShowEdit(\''+projKey+'\','+idx+')" style="flex:1;padding:8px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:1.5px solid #c4b5fd;border-radius:10px;font-size:12.5px;font-weight:600;color:#6d28d9;cursor:pointer" onmouseenter="this.style.background=\'#ede9fe\'" onmouseleave="this.style.background=\'linear-gradient(135deg,#f5f3ff,#ede9fe)\'">✎ 修改内容</button>'+
      '</div>'+
    '</div>';
  }).join('');

  var total = items.length;
  var done = items.filter(function(x){return x.status==='confirmed'||x.status==='edited';}).length;
  var allDone = done === total;

  return '<div id="confirmPanel-'+projKey+'" style="margin-top:20px;border-radius:16px;border:1.5px solid #fde68a;overflow:hidden;box-shadow:0 2px 10px rgba(245,158,11,0.1)">'+
    '<div style="padding:13px 18px;background:linear-gradient(135deg,#fffbeb,#fef9c3);border-bottom:1px solid #fde68a;display:flex;align-items:center;gap:10px">'+
      '<span style="font-size:18px">📋</span>'+
      '<div style="flex:1">'+
        '<div style="font-size:13px;font-weight:800;color:#92400e;letter-spacing:.2px">待领导确认事项</div>'+
        '<div style="font-size:11px;color:#b45309;margin-top:1px">全部确认后方可生成完整五章报告</div>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:8px">'+
        '<span id="cp-progress-'+projKey+'" style="font-size:12px;font-weight:700;color:'+(allDone?'#166534':'#92400e')+'">'+done+' / '+total+'</span>'+
        '<div style="width:80px;height:6px;background:#fef3c7;border-radius:3px;overflow:hidden">'+
          '<div id="cp-bar-'+projKey+'" style="height:100%;width:'+(total?Math.round(done/total*100):0)+'%;background:linear-gradient(90deg,#f59e0b,#22c55e);border-radius:3px;transition:width .5s"></div>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div style="padding:12px 16px;display:flex;flex-direction:column;gap:8px;background:#fff" id="cp-items-'+projKey+'">'+rows+'</div>'+
    '<div id="cp-unlock-'+projKey+'" style="padding:12px 18px;background:'+(allDone?'linear-gradient(135deg,#f0fdf4,#dcfce7)':'#f9fafb')+';border-top:1px solid '+(allDone?'#86efac':'#f0f4ff')+';display:flex;align-items:center;justify-content:center;gap:8px">'+
      (allDone
        ? '<span style="font-size:13px;font-weight:700;color:#166534">✅ 所有事项已确认，立即生成完整报告</span>'
        : '<span style="font-size:12.5px;color:#9aa5b5">还有 <strong style="color:#f59e0b">'+(total-done)+'</strong> 条事项待确认</span>'
      )+
    '</div>'+
  '</div>';
}

/* 更新进度条和解锁状态 */
function updateConfirmProgress(projKey){
  var items=PENDING_CONFIRMS[projKey]||[];
  var total=items.length;
  var done=items.filter(function(x){return x.status==='confirmed'||x.status==='edited';}).length;
  var allDone=done===total&&total>0;
  var prog=document.getElementById('cp-progress-'+projKey);
  if(prog) prog.textContent=done+' / '+total+' 已确认';
  var bar=document.getElementById('cp-bar-'+projKey);
  if(bar) bar.style.width=(total?Math.round(done/total*100):0)+'%';
  var unlock=document.getElementById('cp-unlock-'+projKey);
  if(unlock){
    unlock.style.background=allDone?'#f0fdf4':'#f9fafb';
    unlock.style.borderColor=allDone?'#86efac':'#e8edf5';
    unlock.innerHTML=allDone
      ?'<span style="font-size:13px;font-weight:650;color:#166534">✓ 所有事项已确认，可生成完整报告</span>'
      :'<span style="font-size:13px;color:#9aa5b5">还剩 '+(total-done)+' 条待确认</span>';
  }
  // 始终强制重建底部操作栏
  var bottomBar=document.querySelector('.report-bottom-bar');
  if(!bottomBar) return persist();
  if(allDone){
    bottomBar.innerHTML=
      '<div style="flex:1;font-size:12.5px;color:#166534;background:#f0fdf4;padding:10px 14px;border-radius:10px;border:1px solid #86efac">✓ 所有待确认事项已完成</div>'+
      '<button onclick="triggerReport(2)" style="padding:12px 24px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:650;cursor:pointer;box-shadow:0 4px 16px rgba(26,86,219,.3)">生成完整报告 →</button>'+
      '<button onclick="doUpload()" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">📎 补充材料</button>';
  } else {
    bottomBar.innerHTML=
      '<div style="flex:1;font-size:12.5px;color:#92400e;background:#fffbeb;padding:10px 14px;border-radius:10px;border:1px solid #fde68a">请确认上方 '+(total-done)+' 条待确认事项后生成完整报告</div>'+
      '<button disabled style="padding:12px 20px;background:#e8edf5;color:#9aa5b5;border:none;border-radius:12px;font-size:13.5px;cursor:not-allowed">完成确认后解锁 →</button>'+
      '<button onclick="doUpload()" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">📎 补充材料</button>';
  }
  persist();
}

/* 确认一条 */
function cfmItem(projKey, idx){
  if(!PENDING_CONFIRMS[projKey]) return;
  PENDING_CONFIRMS[projKey][idx].status = 'confirmed';
  var card = document.getElementById('ci-'+projKey+'-'+idx);
  if(card){
    var item = PENDING_CONFIRMS[projKey][idx];
    var displayText = item.editedText || item.text;
    var filesBadge = item.files&&item.files.length?'<span style="margin-left:6px;padding:1px 7px;background:#f0fdf4;color:#166534;border-radius:10px;font-size:10.5px;border:1px solid #86efac">'+item.files.length+' 个附件</span>':'';
    card.style.cssText='display:flex;gap:10px;align-items:flex-start;padding:12px 14px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px';
    card.innerHTML=
      '<span style="color:#22c55e;font-size:16px;flex-shrink:0;margin-top:1px">✓</span>'+
      '<div style="flex:1;min-width:0"><div style="font-size:13px;color:#14532d;line-height:1.65">'+displayText+filesBadge+'</div>'+
      '<div style="font-size:11px;color:#22c55e;margin-top:3px">已确认</div></div>'+
      '<button onclick="uncfmItem(\''+projKey+'\','+idx+')" style="padding:3px 8px;background:none;border:1px solid #86efac;border-radius:6px;font-size:11px;color:#22c55e;cursor:pointer;flex-shrink:0">撤回</button>';
  }
  updateConfirmProgress(projKey);
}

/* 撤回确认 */
function uncfmItem(projKey, idx){
  if(!PENDING_CONFIRMS[projKey]) return;
  PENDING_CONFIRMS[projKey][idx].status = 'pending';
  // 重新渲染整个面板
  var panel = document.getElementById('confirmPanel-'+projKey);
  if(panel){
    var tmp = document.createElement('div');
    tmp.innerHTML = renderConfirmPanel(PENDING_CONFIRMS[projKey], projKey);
    panel.replaceWith(tmp.firstChild);
  }
  updateConfirmProgress(projKey);
}

/* 显示编辑框 */
function ciShowEdit(projKey, idx){
  var edit = document.getElementById('ci-edit-'+projKey+'-'+idx);
  var ta   = document.getElementById('ci-ta-'+projKey+'-'+idx);
  var item = PENDING_CONFIRMS[projKey] && PENDING_CONFIRMS[projKey][idx];
  if(edit){ edit.style.display='block'; }
  if(ta && item){ ta.value = item.editedText || item.text; ta.focus(); ta.select(); }
}

/* 取消编辑 */
function ciCancelEdit(projKey, idx){
  var edit = document.getElementById('ci-edit-'+projKey+'-'+idx);
  if(edit) edit.style.display='none';
}

/* 保存修改 */
function ciSave(projKey, idx){
  var ta = document.getElementById('ci-ta-'+projKey+'-'+idx);
  if(!ta||!ta.value.trim()) return;
  var item = PENDING_CONFIRMS[projKey][idx];
  item.editedText = ta.value.trim();
  item.status = 'edited';
  var card = document.getElementById('ci-'+projKey+'-'+idx);
  if(card){
    var displayText = item.editedText;
    var filesBadge = item.files&&item.files.length?'<span style="margin-left:6px;padding:1px 7px;background:#f0fdf4;color:#166534;border-radius:10px;font-size:10.5px;border:1px solid #86efac">'+item.files.length+' 个附件</span>':'';
    card.style.cssText='display:flex;gap:10px;align-items:flex-start;padding:12px 14px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px';
    card.innerHTML=
      '<span style="color:#22c55e;font-size:16px;flex-shrink:0;margin-top:1px">✓</span>'+
      '<div style="flex:1;min-width:0"><div style="font-size:13px;color:#14532d;line-height:1.65">'+displayText+filesBadge+'</div>'+
      '<div style="font-size:11px;color:#22c55e;margin-top:3px">已修改并确认</div></div>'+
      '<button onclick="uncfmItem(\''+projKey+'\','+idx+')" style="padding:3px 8px;background:none;border:1px solid #86efac;border-radius:6px;font-size:11px;color:#22c55e;cursor:pointer;flex-shrink:0">撤回</button>';
  }
  updateConfirmProgress(projKey);
  toast('✓ 修改已保存');
}

/* 附件相关 */
function ciPickFile(projKey, idx){
  var inp = document.getElementById('ci-finp-'+projKey+'-'+idx);
  if(inp) inp.click();
}
function ciDropFile(e, projKey, idx){
  e.preventDefault();
  var files = Array.from(e.dataTransfer&&e.dataTransfer.files||[]);
  if(files.length) ciAttachFiles(files, projKey, idx);
}
function ciFileSelected(inp, projKey, idx){
  var files = Array.from(inp&&inp.files||[]);
  if(files.length) ciAttachFiles(files, projKey, idx);
}
function ciAttachFiles(files, projKey, idx){
  var item = PENDING_CONFIRMS[projKey] && PENDING_CONFIRMS[projKey][idx];
  if(!item) return;
  if(!item.files) item.files = [];
  files.forEach(function(f){ item.files.push({name:f.name, size:f.size, ts:Date.now()}); });
  ingestFiles(files, null);  // 加入城市智库 corpus
  var hint = document.getElementById('ci-file-hint-'+projKey+'-'+idx);
  if(hint) hint.innerHTML = '✅ 已上传 '+item.files.length+' 个附件：'+item.files.map(function(f){return f.name;}).join('、');
  persist();
  toast('📎 已上传 '+files.length+' 个附件并加入知识库');
}


/* 立项卡片 */
function renderActionItems(text, p, r){
  if(!text||!p) return;
  var area=document.getElementById('reportArea');
  if(!area) return;

  var items=[];
  var tlines=text.split('\n');
  var inTop5=false;
  for(var i=0;i<tlines.length;i++){
    var l=tlines[i];
    if(l.indexOf('补链优先级')>=0||l.indexOf('TOP5')>=0||l.indexOf('优先级清单')>=0) inTop5=true;
    if(inTop5&&l.trim().charAt(0)==='|'){
      var cells=l.trim().slice(1,-1).split('|').map(function(c){return c.replace(/[*★<>]/g,'').trim();});
      if(cells.length>=2){
        var isSep=cells.every(function(c){return /^[\s\-:]+$/.test(c);});
        if(isSep||cells[0]==='排名'||cells[0]==='缺口节点'||cells[0]==='缺口') continue;
        var rank=parseInt(cells[0]);
        if(!isNaN(rank)&&rank>=1&&rank<=3&&cells[1]){
          items.push({rank:rank,gap:cells[1],attr:cells[2]||'',score:cells[cells.length-1]||''});
        }
      }
    }
    if(inTop5&&items.length>=3) break;
  }

  if(!items.length){
    tlines.forEach(function(l){
      if((l.indexOf('❌')>=0||l.indexOf('缺失')>=0||l.indexOf('全部外购')>=0)&&items.length<3){
        var clean=l.replace(/^[*\-•|#\s]+/,'').replace(/❌|\*\*/g,'').trim();
        if(clean.length>4&&clean.length<60) items.push({rank:items.length+1,gap:clean,attr:'',score:''});
      }
    });
  }
  if(!items.length) return;

  var colors=['#1a56db','#6366f1','#0891b2'];
  var icons=['🥇','🥈','🥉'];

  var cards=items.map(function(it,idx){
    var color=colors[idx%3];
    var safeGap=it.gap.replace(/"/g,'&quot;');
    var safeCity=p.city.replace(/"/g,'&quot;');
    var safeTopic=p.topic.replace(/"/g,'&quot;');
    return '<div style="border-radius:14px;border:2px solid '+color+';overflow:hidden;background:#fff;margin-bottom:2px">'+
      '<div style="padding:12px 16px;background:'+color+';display:flex;align-items:center;gap:8px">'+
        '<span style="font-size:18px">'+icons[idx]+'</span>'+
        '<span style="font-size:13px;font-weight:700;color:#fff;flex:1">'+it.gap+'</span>'+
        (it.attr?'<span style="padding:2px 8px;background:rgba(255,255,255,.2);color:#fff;border-radius:20px;font-size:11px">'+it.attr+'</span>':'')+
      '</div>'+
      '<div style="padding:12px 16px;display:flex;align-items:center;gap:10px">'+
        '<div style="flex:1;font-size:12px;color:#4a5568;line-height:1.6">'+
          '<strong>'+p.city+'</strong> · '+p.topic+'<br>'+
          '置信度 '+r.score+'% · 来源：慧小招实测报告'+
        '</div>'+
        '<button data-gap="'+safeGap+'" data-city="'+safeCity+'" data-topic="'+safeTopic+'"'+
          ' onclick="importToProject(this.getAttribute(\'data-gap\'),this.getAttribute(\'data-city\'),this.getAttribute(\'data-topic\'))"'+
          ' style="padding:8px 16px;background:'+color+';color:#fff;border:none;border-radius:10px;font-size:12.5px;font-weight:650;cursor:pointer;white-space:nowrap;flex-shrink:0">'+
          '立项导入 →'+
        '</button>'+
      '</div>'+
    '</div>';
  }).join('');

  var wrapper=document.createElement('div');
  wrapper.innerHTML=
    '<div style="margin-top:20px;padding:16px;background:#f8faff;border-radius:14px;border:1.5px solid #e8edf5">'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">'+
        '<span style="font-size:13px;font-weight:750;color:#0b183b;letter-spacing:.2px">🏁 可立项招引方向</span>'+
        '<span style="font-size:11px;color:#9aa5b5">· 点击「立项导入」自动生成招商项目，进入项目管理</span>'+
      '</div>'+
      '<div>'+cards+'</div>'+
    '</div>';
  area.appendChild(wrapper);
}

/* 立项导入 */
function importToProject(gap, city, topic){
  var key='proj_'+Date.now().toString(36);
  var p=P();
  PROJECTS[key]={
    id:key, city:city||p.city, org:(city||p.city)+'市招商局', who:p?p.who:'负责人',
    topic:gap, stage:3,  // 立项即跳过研判，直接到「确认需求」
    kb: p ? JSON.parse(JSON.stringify(p.kb)) : [],
    report: REPORTSTATE[cur] ? {
      title:(city||p.city)+'·'+gap+'招商研判报告',
      lead:gap+'方向招引，基于慧小招实测报告',
      sections:[{h:'研判依据',p:(REPORTSTATE[cur].text||'').substring(0,300)+'…',type:'real',ev:'慧小招研判报告',chk:''}],
      summary:[['数据来源','慧小招实测'],['置信度',(REPORTSTATE[cur].score||0)+'%'],['生成时间',new Date().toLocaleDateString('zh-CN')]]
    } : null,
    clues:[]
  };
  // 把父项目的报告复制给新项目（让研判需求页可以直接使用）
  if(cur && REPORTSTATE[cur] && !REPORTSTATE[key]){
    REPORTSTATE[key]=JSON.parse(JSON.stringify(REPORTSTATE[cur]));
    REPORTSTATE[key].topic=gap;   // 更新 topic 为新方向
    REPORTSTATE[key].phase=2;     // 保留完整报告（研判已完成）
  }
  // 不切换 cur — 保留当前研判页所有状态
  persist();
  // 弹出确认浮层，让用户主动跳转
  showImportConfirm(key, gap);
}

function showImportConfirm(projKey, gap){
  var old=document.getElementById('importConfirmLayer');
  if(old) old.remove();

  // 注入 fadeUp keyframe（只注一次）
  if(!document.getElementById('fadeUpStyle')){
    var st=document.createElement('style');st.id='fadeUpStyle';
    st.textContent='@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(st);
  }

  var layer=document.createElement('div');
  layer.id='importConfirmLayer';
  // 点遮罩关闭
  layer.onclick=function(e){ if(e.target===layer) layer.remove(); };
  layer.style.cssText='position:fixed;inset:0;background:rgba(11,24,59,.4);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);padding:20px;box-sizing:border-box';

  var safeGap=gap.replace(/</g,'&lt;').replace(/>/g,'&gt;');

  layer.innerHTML=
    '<div style="background:#fff;border-radius:24px;width:100%;max-width:440px;overflow:hidden;box-shadow:0 24px 80px rgba(11,24,59,.18);animation:fadeUp .3s ease">'+

      // ── 顶部彩条 ──
      '<div style="background:linear-gradient(135deg,#1a56db,#6366f1);padding:28px 28px 24px;position:relative">'+
        '<button onclick="document.getElementById(\'importConfirmLayer\').remove()" '+
          'style="position:absolute;top:14px;right:14px;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.2);border:none;color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1" '+
          'onmouseover="this.style.background=\'rgba(255,255,255,.35)\'" onmouseout="this.style.background=\'rgba(255,255,255,.2)\'">✕</button>'+
        '<div style="font-size:32px;margin-bottom:10px">🏁</div>'+
        '<div style="font-size:18px;font-weight:750;color:#fff;margin-bottom:4px">立项成功</div>'+
        '<div style="font-size:13px;color:rgba(255,255,255,.75)">已自动生成招商项目</div>'+
      '</div>'+

      // ── 内容区 ──
      '<div style="padding:24px 28px">'+
        '<div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;background:#f8faff;border-radius:12px;border:1.5px solid #dbeafe;margin-bottom:18px">'+
          '<span style="font-size:20px;flex-shrink:0;margin-top:2px">📋</span>'+
          '<div>'+
            '<div style="font-size:13.5px;font-weight:700;color:#0b183b;margin-bottom:3px">'+safeGap+'</div>'+
            '<div style="font-size:12px;color:#8492a6;line-height:1.6">城市智库数据已同步 · 处于「确认需求」阶段</div>'+
          '</div>'+
        '</div>'+
        '<p style="font-size:13px;color:#4a5568;margin:0 0 20px;line-height:1.7">'+
          '你可以继续完善当前研判报告，或前往项目管理查看新项目。'+
        '</p>'+

        // ── 按钮 ──
        '<div style="display:flex;flex-direction:column;gap:8px">'+
          '<button onclick="(function(){document.getElementById(\'importConfirmLayer\').remove();cur=\''+projKey+'\';view=\'home\';render();})()" '+
            'style="width:100%;padding:13px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:650;cursor:pointer;letter-spacing:.2px" '+
            'onmouseover="this.style.opacity=\'0.92\'" onmouseout="this.style.opacity=\'1\'">'+
            '前往项目管理 →'+
          '</button>'+
          '<button onclick="document.getElementById(\'importConfirmLayer\').remove()" '+
            'style="width:100%;padding:12px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13.5px;color:#4a5568;cursor:pointer" '+
            'onmouseover="this.style.background=\'#eef2ff\'" onmouseout="this.style.background=\'#f5f7fb\'">'+
            '继续当前研判'+
          '</button>'+
        '</div>'+
      '</div>'+
    '</div>';

  document.body.appendChild(layer);
}


function triggerReport(phase){
  phase=phase||1;
  var p=P(); if(!p) return;
  var inp=document.getElementById('topicCustomInput');
  if(inp&&inp.value.trim()) p.topic=inp.value.trim();
  persist();
  var area=document.getElementById('reportArea');
  if(!area) return;
  var r=kbReadiness();
  var corpus=buildKBCorpus(p.city);
  var query=phase===1
    ? '请基于'+p.city+'城市智库数据，针对「'+p.topic+'」方向，快速输出：①最关键的3个产业链缺口（每条附具体数据）②建议的3个招引方向（标注方向类型：补链/承接转移/精深加工/协同枢纽）③需要领导确认的待确认事项（用⚠️标注）④数据可靠性评估（哪些有数据支撑，哪些需补充）'
    : '请基于'+p.city+'城市智库数据，针对「'+p.topic+'」方向，输出完整招商研判报告，严格按五章结构：\n一、产业基础判断（具体数字，来自知识片段）\n二、产业链缺口分析（逐环节标注✅已有/⚠️薄弱/❌缺失，标注本地化属性A必须本地化/B可跨区域/C优先本地化）\n三、补链优先级清单TOP5（表格格式：缺口节点|本地化属性|经济拉动★|招引可行性★|综合优先级）\n四、目标企业画像（每个TOP缺口：目标企业类型+规模+开口话术模板）\n五、待确认事项（⚠️标注每条需领导确认的专项资金/园区地块/政策口径）';
  var chunks=kbSearch(query,corpus,phase===1?5:8);
  var t0=Date.now(); var accText='';
  if(!document.getElementById('spinStyle')){
    var s=document.createElement('style');s.id='spinStyle';
    s.textContent='@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  }
  area.innerHTML=
    '<div style="border-radius:14px;border:1.5px solid '+(phase===1?'#fde68a':'#bfdbfe')+';overflow:hidden;margin-bottom:8px">'+
      '<div style="padding:12px 16px;background:'+(phase===1?'#fffbeb':'#f8faff')+';border-bottom:1px solid '+(phase===1?'#fde68a':'#e8edf5')+';display:flex;align-items:center;gap:8px">'+
        '<span style="font-size:13px;font-weight:700;color:'+(phase===1?'#92400e':'#1d4ed8')+'">'+(phase===1?'📋 初步研判草稿':'📊 完整研判报告')+'</span>'+
        '<span style="font-size:11.5px;color:#8492a6">'+p.topic+'</span>'+
        '<span style="margin-left:auto;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:'+(r.score>=80?'#f0fdf4':'#fffbeb')+';color:'+(r.score>=80?'#166534':'#92400e')+'">置信度 '+r.score+'%</span>'+
        '<div id="reportSpinner" style="width:16px;height:16px;border:2px solid #e8edf5;border-top-color:#1a56db;border-radius:50%;animation:spin 1s linear infinite;flex-shrink:0;margin-left:4px"></div>'+
      '</div>'+
      '<div id="reportContent" style="padding:18px 20px;font-size:13px;color:#1e293b;line-height:1.85;min-height:100px">'+
        '<span style="color:#9aa5b5">'+(phase===1?'初步研判中…（约10秒）':'完整报告生成中…（约30秒）')+'</span>'+
      '</div>'+
      '<div id="reportFooter" style="display:none;padding:10px 16px;background:#f9fafb;border-top:1px solid #f0f4ff;font-size:11px;color:#9aa5b5"></div>'+
    '</div>';
  var content=document.getElementById('reportContent');
  function renderMd(md){
    md=md.replace(/\n{3,}/g,'\n\n');
    md=md.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    md=md.replace(/\*\*([^*\n]+)\*\*/g,'<strong style="color:#0b183b">$1</strong>');
    md=md.replace(/`([^`]+)`/g,'<code style="background:#f0f4ff;color:#1a56db;padding:1px 5px;border-radius:4px;font-size:11.5px">$1</code>');
    md=md.replace(/⚠️/g,'<span style="color:#d97706;font-weight:600">⚠️</span>');
    md=md.replace(/✅/g,'<span style="color:#16a34a">✅</span>');
    md=md.replace(/❌/g,'<span style="color:#dc2626">❌</span>');
    md=md.replace(/★+/g,function(m){return '<span style="color:#f59e0b;letter-spacing:1px">'+m+'</span>';});
    md=md.replace(/A[=]必须本地化/g,'<span style="padding:1px 6px;background:#fee2e2;color:#991b1b;border-radius:4px;font-size:11px;font-weight:600">A 必须本地化</span>');
    md=md.replace(/B[=]可跨区域/g,'<span style="padding:1px 6px;background:#dbeafe;color:#1e3a8a;border-radius:4px;font-size:11px;font-weight:600">B 可跨区域</span>');
    md=md.replace(/C[=]优先本地化/g,'<span style="padding:1px 6px;background:#d1fae5;color:#064e3b;border-radius:4px;font-size:11px;font-weight:600">C 优先本地化</span>');
    // 章节标题：## 一、格式 和 纯 一、格式，统一渲染，防止双重
    md=md.replace(/^#{0,3}\s*([一二三四五六七八九十]+)[、]\s*(.+)$/gm,function(m,num,title){
      return '<div style="display:flex;align-items:center;gap:10px;margin:20px 0 8px;padding-bottom:7px;border-bottom:2px solid #1a56db">'+
        '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;background:#1a56db;color:#fff;border-radius:50%;font-size:12px;font-weight:700;flex-shrink:0">'+num+'</span>'+
        '<span style="font-size:14px;font-weight:750;color:#0b183b">'+title+'</span>'+
      '</div>';
    });
    md=md.replace(/^###\s(.+)$/gm,'<div style="font-size:13px;font-weight:700;color:#4a5568;margin:10px 0 4px;padding-left:10px;border-left:3px solid #6366f1">$1</div>');
    md=md.replace(/^##\s(.+)$/gm,'<div style="font-size:13.5px;font-weight:750;color:#0b183b;margin:12px 0 6px;padding:5px 12px;background:#f8faff;border-radius:8px;border-left:4px solid #1a56db">$1</div>');
    md=md.replace(/^#\s(.+)$/gm,'<div style="font-size:15px;font-weight:800;color:#0b183b;margin:14px 0 8px">$1</div>');
    // 表格逐行解析（正确跳过分隔行）
    var outLines=[]; var inTbl=false;
    var mdLines=md.split('\n');
    for(var li=0;li<mdLines.length;li++){
      var line=mdLines[li];
      var tr=line.trim();
      if(tr.charAt(0)==='|'&&tr.charAt(tr.length-1)==='|'){
        var isSep=tr.slice(1,-1).split('|').every(function(c){return /^[\s\-:]+$/.test(c);});
        if(isSep) continue;
        var cells=tr.slice(1,-1).split('|').map(function(c){return c.trim();});
        if(!inTbl){
          inTbl=true;
          outLines.push('<div style="overflow-x:auto;margin:10px 0"><table style="width:100%;border-collapse:collapse;font-size:12.5px">');
          outLines.push('<thead><tr>'+cells.map(function(c){
            return '<th style="padding:8px 12px;background:#f0f4ff;border:1px solid #dbeafe;font-weight:700;color:#1e3a8a;text-align:left;white-space:nowrap">'+c+'</th>';
          }).join('')+'</tr></thead><tbody>');
        } else {
          outLines.push('<tr>'+cells.map(function(c,ci){
            return '<td style="padding:8px 12px;border:1px solid #e8edf5;color:#1e293b;vertical-align:top;background:'+(ci===0?'#fafbff':'#fff')+'">'+c+'</td>';
          }).join('')+'</tr>');
        }
      } else {
        if(inTbl){outLines.push('</tbody></table></div>');inTbl=false;}
        outLines.push(line);
      }
    }
    if(inTbl)outLines.push('</tbody></table></div>');
    md=outLines.join('\n');
    // 列表
    md=md.replace(/^[-•]\s(.+)$/gm,'<li style="margin:4px 0;color:#1e293b">$1</li>');
    md=md.replace(/^\d+\.\s(.+)$/gm,'<li style="margin:4px 0;color:#1e293b">$1</li>');
    // 段落：空行分隔，block 元素不再包裹
    var parts=md.split('\n\n');
    md=parts.map(function(chunk){
      var c=chunk.trim();
      if(!c) return '';
      if(/^<(div|table|ul|ol|li|thead|tbody|tr)/.test(c)) return c;
      return '<p style="margin:5px 0;line-height:1.85;color:#1e293b">'+c.replace(/\n/g,'<br>')+'</p>';
    }).filter(Boolean).join('\n');
    return md;
  }
  fetch(((location.origin && location.origin.indexOf('http')===0) ? location.origin : 'http://localhost:5050')+'/api/kb-chat',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question:query,chunks:chunks,city:p.city,stream:true,mode:phase===1?'draft':'full'})
  }).then(function(resp){
    if(!resp.ok){
      if(content) content.innerHTML='<span style="color:#ef4444">服务错误：'+resp.status+'<br><small>请确认 kb-server 已在 localhost:5050 运行</small></span>';
      return;
    }
    var reader=resp.body.getReader(); var decoder=new TextDecoder(); var buf='';
    function pump(){
      reader.read().then(function(d){
        if(d.done){
          var elapsed=Date.now()-t0;
          REPORTSTATE[cur]={text:accText,topic:p.topic,ts:Date.now(),score:r.score,phase:phase};
          persist();
          var sp=document.getElementById('reportSpinner');if(sp)sp.style.display='none';
          var footer=document.getElementById('reportFooter');
          if(footer){
            var cites=[...new Set(chunks.map(function(c){return c.cite;}).filter(Boolean))];
            footer.innerHTML='数据来源：'+cites.map(function(c){
              return '<span style="padding:1px 6px;background:#f0f4ff;color:#1a56db;border-radius:4px;font-size:10.5px">'+c+'</span>';
            }).join(' ')+' · DeepSeek · '+elapsed+'ms · 置信度 '+r.score+'%';
            footer.style.display='block';
          }
          var bottomBar=document.querySelector('.report-bottom-bar');
          if(bottomBar){
            if(phase===1){
              // 解析⚠️ → 渲染确认面板
              var pendingItems=parsePendingItems(accText);
              if(pendingItems.length>0){
                if(!PENDING_CONFIRMS[cur]) PENDING_CONFIRMS[cur]=[];
                // 保留已有确认状态，追加新条目
                var existTexts=PENDING_CONFIRMS[cur].map(function(x){return x.text;});
                pendingItems.forEach(function(it){
                  if(existTexts.indexOf(it.text)<0) PENDING_CONFIRMS[cur].push(it);
                });
                persist();
                // 把确认面板插到报告区下方
                var reportArea=document.getElementById('reportArea');
                var panelHtml=renderConfirmPanel(PENDING_CONFIRMS[cur],cur);
                var panelDiv=document.createElement('div');
                panelDiv.innerHTML=panelHtml;
                if(reportArea) reportArea.appendChild(panelDiv.firstChild);
              }
              // 底部：根据是否有待确认项决定按钮状态
              var hasPending=PENDING_CONFIRMS[cur]&&PENDING_CONFIRMS[cur].length>0;
              var allDone=hasPending&&PENDING_CONFIRMS[cur].every(function(x){return x.status==='confirmed'||x.status==='edited';});
              bottomBar.innerHTML=
                '<div style="flex:1;font-size:12.5px;color:#92400e;background:#fffbeb;padding:10px 14px;border-radius:10px;border:1px solid #fde68a;line-height:1.6">'+
                  (hasPending&&!allDone?'请确认上方待确认事项后，才可生成完整报告':'以上为初步研判草稿，确认方向后生成完整五章报告')+
                '</div>'+
                '<button onclick="triggerReport(2)" '+(allDone||!hasPending?'':'disabled style="opacity:.4;cursor:not-allowed;"')+' style="padding:12px 20px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:13.5px;font-weight:650;cursor:pointer;white-space:nowrap">' +(allDone||!hasPending?'生成完整报告 →':'待确认后生成 →')+'</button>'+
                '<button onclick="doUpload()" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">📎 补充材料</button>';
            } else {
              bottomBar.innerHTML=
                '<button onclick="triggerReport(1)" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">🔄 重新生成</button>'+
                '<button onclick="doUpload()" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">📎 补充材料</button>'+
                '<button onclick="submitDemand()" style="flex:1;padding:12px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:650;cursor:pointer">✓ 确认方向，提交招引需求</button>';
              // 产业链图谱：完整报告生成后动态追加，避免须重新进入页面才能看到
              var _raEl=document.getElementById('reportArea');
              if(_raEl && !document.getElementById('chainMapBlock')){
                var _cmEl=document.createElement('div');
                _cmEl.id='chainMapBlock';
                _cmEl.innerHTML=chainMapHtml(p);
                _raEl.appendChild(_cmEl);
              }
            setTimeout(function(){renderActionItems(accText,p,r);},300);
            }
          }
          return;
        }
        buf+=decoder.decode(d.value,{stream:true});
        var lines2=buf.split('\n'); buf=lines2.pop();
        lines2.forEach(function(line){
          if(!line.startsWith('data:')) return;
          var d2=line.slice(5).trim(); if(d2==='[DONE]') return;
          try{
            var j=JSON.parse(d2);
            var delta=j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content||'';
            if(delta){ accText+=delta; if(content) content.innerHTML='<p style="margin:0">'+renderMd(accText)+'</p>'; }
          }catch(e){}
        });
        pump();
      });
    }
    pump();
  }).catch(function(err){
    if(content) content.innerHTML='<span style="color:#ef4444">连接失败：'+err.message+'<br><small>请确认 kb-server 已在 localhost:5050 运行</small></span>';
  });
}

// 提交招引需求到管理端需求池
function submitDemand(){
  var p=P(); if(!p) return;
  var rs=REPORTSTATE[cur];
  if(!rs){toast('请先生成研判报告'); return;}
  // 检查是否已提交
  var existing=DEMANDS.find(function(d){return d.projKey===cur;});
  if(existing){toast('该方向已提交需求池'); return;}
  DEMANDS.push({
    id:'d'+Date.now().toString(36),
    projKey:cur,
    city:p.city, gov:p.org+'·'+p.who,
    topic:p.topic, domain:p.topic.replace('补链','').replace('升级',''),
    need:'基于研判报告（置信度'+rs.score+'%），见报告全文',
    submit:'刚刚', res:'none', resLabel:'待研判', clues:0,
    note:rs.text?rs.text.slice(0,120)+'…':'', ai:''
  });
  p.stage=Math.max(p.stage,3);
  // 立即派生线索（如果有报告）
  deriveCluesFromReport(cur);
  persist();
  toast('✓ 招引需求已提交，候选线索已自动派生');
}

// REPORTSTATE: 存储已生成的报告

// reportHtml: 如果已有报告，直接渲染
function reportHtml(p){
  var rs=REPORTSTATE[cur]; if(!rs) return '';
  var r=kbReadiness();
  function renderMd(md){
    md=md.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    md=md.replace(/\*\*([^*\n]+)\*\*/g,'<strong style="color:#0b183b">$1</strong>');
    md=md.replace(/⚠️/g,'<span style="color:#d97706;font-weight:600">⚠️</span>');
    md=md.replace(/✅/g,'<span style="color:#16a34a">✅</span>');
    md=md.replace(/❌/g,'<span style="color:#dc2626">❌</span>');
    md=md.replace(/★+/g,function(m){return '<span style="color:#f59e0b">'+m+'</span>';});
    md=md.replace(/^#{0,3}\s*([一二三四五六七八九十]+)[、]\s*(.+)$/gm,
      '<div style="display:flex;align-items:center;gap:10px;margin:18px 0 8px;padding-bottom:6px;border-bottom:2px solid #1a56db">'+
        '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;background:#1a56db;color:#fff;border-radius:50%;font-size:12px;font-weight:700">$1</span>'+
        '<span style="font-size:14px;font-weight:750;color:#0b183b">$2</span></div>');
    md=md.replace(/^###\s(.+)$/gm,'<div style="font-size:13px;font-weight:700;color:#4a5568;margin:10px 0 4px;padding-left:10px;border-left:3px solid #6366f1">$1</div>');
    md=md.replace(/^##\s(.+)$/gm,'<div style="font-size:13.5px;font-weight:750;color:#0b183b;margin:12px 0 6px;padding:5px 12px;background:#f8faff;border-radius:8px;border-left:4px solid #1a56db">$1</div>');
    // 表格
    var outLines=[]; var inTbl=false;
    md.split('\n').forEach(function(line){
      var tr=line.trim();
      if(tr.charAt(0)==='|'&&tr.charAt(tr.length-1)==='|'){
        if(tr.slice(1,-1).split('|').every(function(c){return /^[\s\-:]+$/.test(c);})) return;
        var cells=tr.slice(1,-1).split('|').map(function(c){return c.trim();});
        if(!inTbl){inTbl=true;outLines.push('<div style="overflow-x:auto;margin:10px 0"><table style="width:100%;border-collapse:collapse;font-size:12.5px">');
          outLines.push('<thead><tr>'+cells.map(function(c){return '<th style="padding:7px 10px;background:#f0f4ff;border:1px solid #dbeafe;font-weight:700;color:#1e3a8a;text-align:left">'+c+'</th>';}).join('')+'</tr></thead><tbody>');}
        else outLines.push('<tr>'+cells.map(function(c,ci){return '<td style="padding:7px 10px;border:1px solid #e8edf5;color:#1e293b;background:'+(ci===0?'#fafbff':'#fff')+'">'+c+'</td>';}).join('')+'</tr>');
      } else {if(inTbl){outLines.push('</tbody></table></div>');inTbl=false;} outLines.push(line);}
    });
    if(inTbl)outLines.push('</tbody></table></div>');
    md=outLines.join('\n');
    md=md.replace(/^[-•]\s(.+)$/gm,'<li style="margin:4px 0;color:#1e293b">$1</li>');
    var parts=md.split('\n\n');
    md=parts.map(function(chunk){var c=chunk.trim();if(!c)return '';if(/^<(div|table|ul)/.test(c))return c;return '<p style="margin:5px 0;line-height:1.85;color:#1e293b">'+c.replace(/\n/g,'<br>')+'</p>';}).filter(Boolean).join('\n');
    return md;
  }
  return '<div style="border-radius:14px;border:1.5px solid #e8edf5;overflow:hidden;margin-bottom:8px">'+
    '<div style="padding:12px 16px;background:#f8faff;border-bottom:1px solid #e8edf5;display:flex;align-items:center;gap:8px">'+
      '<span style="font-size:12px;font-weight:650;color:#1a56db">📋 研判报告</span>'+
      '<span style="font-size:11.5px;color:#4a5568">'+p.topic+'</span>'+
      '<span style="margin-left:auto;font-size:11px;color:'+(rs.score>=80?'#22c55e':'#f59e0b')+'">置信度 '+rs.score+'%</span>'+
      '<button onclick="downloadReport(\'full\')" style="padding:4px 10px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:12px;color:#1a56db;cursor:pointer;font-weight:600;margin-left:6px">⬇ 下载</button>'+
    '</div>'+
    '<div style="padding:16px 18px;font-size:13px;color:#1e293b;line-height:1.8">'+
      '<p style="margin:0">'+renderMd(rs.text||'')+'</p>'+
    '</div>'+
  '</div>';
}

function generateTopicsFromKb(p){
  if(!p||!p.kb) return [];
  var allKnown=[];
  p.kb.forEach(function(k){ (k.known||[]).forEach(function(x){ allKnown.push(x); }); });
  var patterns=[
    {re:/氢能|电堆|储氢|燃料电池/, type:'补链', icon:'⚡', label:'氢能专用车补链',
     descFn:function(t){var m=t.match(/(\d+%)/);return m?'电堆'+m[0]+'外购，新楚风已量产':'氢能核心零部件本地空白';}},
    {re:/应急机器人|无人机|5G通信|智慧应急/, type:'补链', icon:'🚨', label:'智慧应急装备补链',
     descFn:function(t){return t.indexOf('启灵')>=0?'机器人靠启灵外采，无人机靠迅北斗':'感知层核心系统依赖外采';}},
    {re:/香菇|菌种|多糖|精深加工/, type:'精深加工', icon:'🍄', label:'香菇精深加工升级',
     descFn:function(t){return (t.indexOf('2家')>=0||t.indexOf('仅')>=0)?'功能成分提取仅2家布局':'香菇向高附加值延伸';}},
    {re:/底盘|动力总成|新能源配套/, type:'补链', icon:'🔧', label:'新能源专用车零部件配套',
     descFn:function(t){var m=t.match(/(\d+%)/);return m?'底盘动力总成占成本'+m[0]+'外购':'核心零部件本地空白';}},
    {re:/产业转移|承接|沿海/, type:'承接转移', icon:'🏭', label:'产业转移承接',
     descFn:function(){return '承接沿海制造业转移，利用区位成本优势';}},
  ];
  var topics=[]; var matched={};
  allKnown.forEach(function(text){
    patterns.forEach(function(pat){
      if(!matched[pat.label]&&pat.re.test(text)){
        matched[pat.label]=true;
        topics.push({label:pat.label,icon:pat.icon,type:pat.type,desc:pat.descFn(text)});
      }
    });
  });
  if(!topics.length) topics=[
    {label:p.city+'主导产业补链',icon:'🏭',type:'补链',desc:'基于城市智库产业链缺口分析'},
    {label:p.city+'产业转移承接',icon:'🔄',type:'承接转移',desc:'承接沿海转移，利用区位成本优势'},
    {label:p.city+'特色产业升级',icon:'⬆️',type:'精深加工',desc:'现有产业向高附加值延伸'},
  ];
  return topics.slice(0,4);
}


function homePage(p){
  var r=kbReadiness();

  // ── 可靠性横幅 ──
  var reliabilityBanner=
    '<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;background:'+(r.score>=80?'#f0fdf4':'#fffbeb')+';border-bottom:1px solid '+(r.score>=80?'#86efac':'#fde68a')+'">'+
      '<div style="flex:1;min-width:0">'+
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'+
          '<span style="font-size:12px;font-weight:650;color:'+(r.score>=80?'#166534':'#92400e')+'">从城市智库继承数据</span>'+
          '<span style="font-size:11px;color:'+(r.score>=80?'#22c55e':'#f59e0b')+';font-weight:700">'+r.score+'%</span>'+
          '<span style="font-size:11px;color:'+(r.score>=80?'#22c55e':'#f59e0b')+'">'+r.label+'</span>'+
          '<span title="置信度计算：确认⚠️事项×60% + 上传材料×10%（上限40%）。确认全部4条→+60，上传2份材料→+20，合计80%自动解锁" style="font-size:11px;color:#9aa5b5;cursor:help;text-decoration:underline dotted;margin-left:4px">ⓘ 如何提升</span>'+
        '</div>'+
        '<div style="height:4px;background:'+(r.score>=80?'#dcfce7':'#fef3c7')+';border-radius:2px;overflow:hidden">'+
          '<div style="height:100%;width:'+r.score+'%;background:'+(r.score>=80?'#22c55e':'#f59e0b')+';border-radius:2px;transition:width .4s"></div>'+
        '</div>'+
      '</div>'+
      (r.score<80
        ? '<button onclick="go(\'knowledge\')" style="flex-shrink:0;padding:6px 12px;background:#fff;border:1.5px solid #fde68a;border-radius:8px;font-size:12px;color:#92400e;cursor:pointer;font-weight:600">补充城市智库 →</button>'
        : '<span style="flex-shrink:0;font-size:12px;color:#22c55e">✓ 可直接生成研判</span>'
      )+
    '</div>';

  // ── 推荐方向卡片 ──
  var recommendedTopics=generateTopicsFromKb(p);

  var topicCards=recommendedTopics.map(function(t){
    var isActive=p.topic===t.label;
    return '<button onclick="selectTopic(\''+t.label+'\')" style="'+
      'display:flex;flex-direction:column;align-items:flex-start;padding:14px 16px;'+
      'background:'+(isActive?'linear-gradient(135deg,#eff6ff,#f0f9ff)':'#fff')+';'+
      'border:2px solid '+(isActive?'#1a56db':'#e8edf5')+';'+
      'border-radius:14px;cursor:pointer;text-align:left;transition:all .15s;flex:1;min-width:0">'+
      '<div style="font-size:20px;margin-bottom:6px">'+t.icon+'</div>'+
      '<div style="font-size:13px;font-weight:700;color:#0b183b;margin-bottom:4px">'+t.label+'</div>'+
      '<div style="font-size:11.5px;color:#8492a6;line-height:1.4">'+t.desc+'</div>'+
      (isActive?'<div style="margin-top:8px;width:8px;height:8px;border-radius:50%;background:#1a56db"></div>':'')+
    '</button>';
  }).join('');

  var topicSelector=
    '<div style="padding:0 0 20px">'+
      '<div style="font-size:12px;font-weight:650;color:#4a5568;margin-bottom:10px;letter-spacing:.3px">选择研判方向</div>'+
      '<div id="topicCardGrid" style="display:flex;gap:10px;margin-bottom:12px">'+topicCards+'</div>'+
      '<div style="display:flex;align-items:center;gap:8px">'+
        '<div style="flex:1;position:relative">'+
          '<input id="topicCustomInput" placeholder="或输入自定义方向…" value="'+(recommendedTopics.some(function(t){return t.label===p.topic;})?'':p.topic)+'" '+
            'style="width:100%;box-sizing:border-box;padding:10px 14px;border:1.5px solid #e8edf5;border-radius:10px;font-size:13px;color:#0b183b;outline:none;transition:border .15s" '+
            'onfocus="this.style.border=\'1.5px solid #6366f1\'" '+
            'onblur="this.style.border=\'1.5px solid #e8edf5\'" '+
            'oninput="selectTopic(this.value,true)" '+
            'onkeydown="if(event.key===\'Enter\')triggerReport()" />'+
        '</div>'+
        '<div id="currentTopicBadge" style="flex-shrink:0;padding:6px 12px;background:#f0f4ff;border-radius:8px;font-size:12px;color:#1a56db;font-weight:600;white-space:nowrap">'+
          p.topic+
        '</div>'+
      '</div>'+
    '</div>';

  // ── 报告区 ──
  // 进入研判需求页时清除旧报告状态，强制重新分析
  if(REPORTSTATE[cur]&&REPORTSTATE[cur].phase===1){
    // 保留 Phase 2 完整报告，但草稿不缓存展示
  }
  var reportArea=
    '<div id="reportArea">'+
      (REPORTSTATE[cur]&&REPORTSTATE[cur].phase===2
        ? reportHtml(p)
        : '<div style="text-align:center;padding:48px 20px">'+
            '<div style="font-size:40px;margin-bottom:12px">📋</div>'+
            '<div style="font-size:15px;font-weight:700;color:#0b183b;margin-bottom:8px">'+
              '选择上方研判方向，点击「🔍 开始初步研判」'+
            '</div>'+
            '<div style="font-size:12.5px;color:#8492a6;line-height:1.8">'+
              '① AI 先出初步草稿（约10秒）② 逐条确认待确认事项 ③ 生成完整五章报告'+
            '</div>'+
          '</div>'
      )+
    '</div>';
  // 自动触发 Phase 1（若非完整报告）




  return '<div class="page">'+
    reliabilityBanner+
    '<div class="conversation-scroll" style="padding:16px 22px 0">'+
      topicSelector+
      reportArea+
    '</div>'+
    // 底部行动栏（替代 composer）
    '<div class="report-bottom-bar" style="border-top:1px solid #f0f4ff;background:#fff;padding:12px 22px;display:flex;gap:10px;align-items:center">'+
      (REPORTSTATE[cur]&&REPORTSTATE[cur].phase===2
        ? ('<button onclick="viewCurrentReport()" '+
            'style="flex:1;padding:13px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:650;cursor:pointer;letter-spacing:.2px">📊 查看完整报告</button>'+
           '<button onclick="downloadReport(\'full\')" style="padding:13px 16px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:12px;font-size:13px;color:#1a56db;cursor:pointer;font-weight:600">⬇ 下载</button>'+
           '<button onclick="triggerReport(1)" style="padding:13px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:12.5px;color:#4a5568;cursor:pointer">🔄 重新研判</button>')
        : ('<button id="generateBtn" onclick="triggerReport(1)" '+
            'style="flex:1;padding:13px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:650;cursor:pointer;letter-spacing:.2px">'+
            '🔍 开始初步研判'+
      '</button>'))+
      '<button onclick="doUpload()" style="padding:13px 16px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">📎 补充材料</button>'+
      (REPORTSTATE[cur]
        ? '<button onclick="submitDemand()" style="padding:13px 16px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;font-size:13px;color:#166534;cursor:pointer;font-weight:600">提交招引需求 →</button>'
        : ''
      )+
    '</div>'+
  '</div>';
}


function promptRow(icon,strong,small,fn){
  return '<button class="prompt-row" onclick="'+fn+'"><i class="i">'+icon+'</i><span><strong>'+strong+'</strong><small>'+small+'</small></span><i class="i">➜</i></button>';
}
function aiAvatar(){return 'data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46"><rect width="46" height="46" rx="23" fill="#ebf3fd"/><text x="23" y="30" font-size="18" fill="#0757ad" text-anchor="middle" font-family="sans-serif">慧</text></svg>')}
function kbPage(p){
  return '<div class="page">'+
    (function(){
      var r=kbReadiness();
      return '<div class="page-header"><div>'+
        '<span class="eyebrow">CITY INTELLIGENCE</span><h1>城市智库 · 招商问答</h1>'+
        '<p>点击主题卡展开详细结论，或直接在下方对话框提问。</p>'+
        '<div style="display:flex;align-items:center;gap:10px;margin-top:8px">'+
          '<div style="flex:1;background:#f0f4ff;border-radius:4px;height:6px;overflow:hidden">'+
            '<div style="height:100%;width:'+r.score+'%;background:'+r.color+';border-radius:4px;transition:width .4s"></div>'+
          '</div>'+
          '<span style="font-size:12px;font-weight:700;color:'+r.color+'">'+r.score+'%</span>'+
          '<span style="font-size:11px;color:'+r.color+'">'+r.label+'</span>'+
          '<span title="计算方式：确认⚠️事项×60% + 上传材料×10%（上限40%）" '+
            'style="font-size:11px;color:#9aa5b5;cursor:help;margin-left:2px">ⓘ</span>'+
        '</div>'+
        (r.score<80?'<p style="font-size:11.5px;color:#f59e0b;margin:5px 0 0">'+          '⚡ 上传越多材料、领导确认越多结论，研判数据可靠性越高（差 '+(80-r.score)+'% 自动解锁后续步骤）</p>':'')+
        '</div>'+
        '<div style="display:flex;gap:8px">'+
        '<button class="ghost-button" onclick="showDownloadReport()"><i class="i"></i>下载分析报告</button>'+
        '</div></div>';
    })()+

    '<div class="knowledge-scroll"><div class="topic-grid">'+
      p.kb.map(function(k,i){
        var tagColor=k.known&&k.known.length?
          (k.tag.indexOf('待')>=0?'color:#c08a2a;background:#fff8e6':'color:#006d70;background:#e4f5f3'):
          'color:#9aa5b5;background:#f5f7fb';
        var dot=k.known&&k.known.length?'<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#22c55e;margin-right:5px;vertical-align:middle"></span>':'';
        var firstKnown=k.known&&k.known.length?k.known.filter(function(x){return x.indexOf('⚠️')<0;})[0]:'';
        return '<button class="topic-row" onclick="kbDetail('+i+')">'+
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'+
            '<span style="font-size:20px">'+k.icon+'</span>'+
            '<strong style="font-size:13px;color:#0b183b">'+k.t+'</strong>'+
            '<em style="'+tagColor+';margin-left:auto;flex-shrink:0">'+dot+k.tag+'</em>'+
          '</div>'+
          '<small style="display:block;font-size:11.5px;color:#8492a6;margin-bottom:6px;line-height:1.4">'+k.sub+'</small>'+
          (firstKnown?'<div style="font-size:12px;color:#33415a;line-height:1.65;border-top:1px solid #f0f4ff;padding-top:8px;margin-top:auto">'+highlightKeyData(firstKnown)+'</div>':'')+
        '</button>';
      }).join('')+
    '</div>'+
    '<div class="suggestion-strip">可以这样问：'+
    '<button onclick="askKB(\''+P().city+'最值得补链的核心环节是哪些？\')">最值得补链的核心环节</button>'+
    '<button onclick="askKB(\''+P().city+'各园区如何分工承接不同细分产业？\')">园区分工承接方案</button>'+
    '<button onclick="askKB(\'本地链主企业还缺哪些关键上游配套？\')">链主缺口分析</button>'+
    '</div>'+
    '<div id="kbConv" style="padding:0 0 8px">'+
      '<div class="message" style="margin-top:0"><img src="'+aiAvatar()+'">'+
      '<div class="message-bubble"><p>'+p.city+'城市智库已就位，你可以直接提问——例如：</p>'+
      '<ul style="margin:6px 0 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px">'+
      '<li style="font-size:12.5px;color:#4a5568">• '+p.city+'最值得补链的核心缺口是哪些？</li>'+
      '<li style="font-size:12.5px;color:#4a5568">• 本地链主企业还缺哪些关键上游配套？</li>'+
      '<li style="font-size:12.5px;color:#4a5568">• 各园区如何分工承接不同细分产业？</li>'+
      '<li style="font-size:12.5px;color:#4a5568">• 随州与十堰/荆门的竞争差异化空间在哪里？</li>'+
      '</ul></div></div>'+
    '</div></div>'+composer()+'</div>';
}
function settingsPage(p){
  return '<div class="page">'+
    '<div class="page-header"><div><span class="eyebrow">PERSONALIZATION</span><h1>个人与提醒设置</h1>'+
    '<p>调整个性化范围，但不改变确认关口与资源核验责任。</p></div></div>'+
    '<div class="settings-scroll">'+
    '<div class="settings-section"><h2>账号身份（由系统开通，不可修改）</h2>'+
      '<div class="form-grid">'+
      '<label>所属单位<input value="'+p.org+'" disabled></label>'+
      '<label>姓名 / 角色<input value="'+p.who+' / 招商干部" disabled></label>'+
      '<label>所属地区<input value="'+p.city+'" disabled></label>'+
      '<label>数据权限<input value="仅限 '+p.city+' 城市智库" disabled></label></div>'+
      '<div class="boundary-note" style="margin-top:14px"><i class="i">🔒</i>账号的地区与身份在开通时绑定，用户不可自行更改；如需变更请联系系统管理员。</div></div>'+
    '<div class="settings-section"><h2>提醒偏好（可自行调整）</h2>'+
      '<div class="toggle-row"><span><strong>状态变化通知</strong><small>需求进度更新时提醒我</small></span><input type="checkbox" checked></div>'+
      '<div class="toggle-row"><span><strong>超时提醒</strong><small>3 个工作日无更新时提醒</small></span><input type="checkbox" checked></div>'+
      '<div class="toggle-row"><span><strong>每日摘要</strong><small>每天 09:00 汇总进行中事项</small></span><input type="checkbox" checked></div>'+
      '<button class="primary-button settings-save" onclick="toast(\'提醒偏好已保存\')">保存偏好</button></div>'+
    '<div class="settings-section"><h2>系统会据此调整</h2><ul class="plain-list">'+
      ['首页任务提示','报告中的产业关注顺序','进度提醒频率'].map(function(x){return '<li>'+x+'</li>'}).join('')+'</ul>'+
      '<div class="boundary-note"><i class="i">🔒</i>干部与领导确认关口、资源核验责任和企业触达边界，不会因个人设置而跳过。</div></div>'+
    '</div></div>';
}
