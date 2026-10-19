
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

function pushFunnelTopToGov(projKey, n, onlyName, preview){
  var p=PROJECTS[projKey], fn=preview||(p&&p.funnel);
  if(!fn||fn.evidence_contract!=='saved-excerpts-v1'){toast('旧候选缺少逐条来源，请先重新分析');return;}
  var top=(onlyName?fn.companies.filter(function(c){return c.name===onlyName;}):fn.companies).slice(0,Math.min(n||8,8));
  if(!top.length){toast('当前材料没有可复核企业；这不代表现实中不存在相关企业');return;}
  var anchors=preview?preview.demandAnchors:funnelReviewDemandAnchors(projKey,fn.topic);
  if(!anchors.length){toast('请先完成当前方向报告或确认需求原句，再逐家核对企业');return;}
  pushFunnelTopToGov.review={key:projKey,topic:fn.topic,requestId:fn.reportRequestId,companies:top,anchors:anchors,
    identity:savedEvidenceIdentity(projKey,fn.topic),funnel:JSON.stringify(fn),preview:preview||null};
  var list=top.map(function(c,i){
    var sources=(c.evidence||[]).filter(function(r){return r&&r.id&&r.quote&&Array.isArray(r.urls)&&r.urls.length;});
    var products=sources.map(function(r,j){return '<option value="'+j+'">'+_authEscape(r.quote.slice(0,150))+'</option>';}).join('');
    var demands=anchors.map(function(a,j){return '<option value="'+j+'">'+(a.kind==='report'?'报告':'已确认需求')+' · '+_authEscape(a.quote.slice(0,150))+'</option>';}).join('');
    return '<li style="margin-bottom:18px;border-bottom:1px solid #e2e8f0;padding-bottom:16px"><strong>'+_authEscape(c.name)+'</strong>'+funnelEvidenceLinks(c)+
      '<label style="display:block;margin-top:8px">1. 企业产品或服务原句<select id="funnelProduct-'+i+'" style="display:block;width:100%" onchange="funnelReviewAnchorChange('+i+')"><option value="">请选择并核对原文</option>'+products+'</select></label><p id="funnelProductText-'+i+'" style="white-space:pre-wrap;word-break:break-word"></p>'+
      '<label style="display:block">2. 当前方向的需求原句<select id="funnelDemand-'+i+'" style="display:block;width:100%" onchange="funnelReviewAnchorChange('+i+')"><option value="">请选择对应需求</option>'+demands+'</select></label><p id="funnelDemandText-'+i+'" style="white-space:pre-wrap;word-break:break-word"></p>'+
      '<label>3. 该企业如何对应这项需求（至少12字）<textarea id="funnelReason-'+i+'" style="display:block;width:100%;min-height:70px" placeholder="逐家说明产品、技术条件与需求的对应关系及待核缺口"></textarea></label>'+
      '<label style="display:block;margin-top:8px"><input type="checkbox" id="funnelReview-'+i+'"> 我已对照上述两份原句，愿将该企业作为人工待核线索推送</label></li>';
  }).join('');
  var content='<p>这些企业仅出现在当前工作区材料中，尚未证明符合该需求。请逐家选择产品与需求的原句、写明对应关系并确认。推送后仍为待核线索，投资意向未知。</p><ul style="padding-left:20px">'+list+'</ul><p id="funnelReviewError" role="alert"></p>';
  openModal('逐家核对产品与需求',content,'<button class="ghost-button" onclick="closeModal()">取消</button><button class="primary-button" onclick="confirmFunnelReview('+_authEscape(JSON.stringify(projKey))+','+top.length+')">推送已逐家复核的待核线索</button>');
}
function confirmFunnelReview(projKey,n){
  var p=PROJECTS[projKey], review=pushFunnelTopToGov.review, fn=review&&review.preview||(p&&p.funnel), error=document.getElementById('funnelReviewError');
  function fail(message){if(error)error.textContent=message;}
  if(confirmFunnelReview.pending)return;
  if(!review||review.key!==projKey||!p||p.topic!==review.topic||!fn||review.funnel!==JSON.stringify(fn)||review.identity!==savedEvidenceIdentity(projKey,review.topic)){
    fail('工作区、报告或候选材料已变化，请关闭后重新核对');return;
  }
  var records=[];
  for(var i=0;i<review.companies.length;i++){
    var box=document.getElementById('funnelReview-'+i);if(!box||!box.checked)continue;
    var product=document.getElementById('funnelProduct-'+i), demand=document.getElementById('funnelDemand-'+i), reason=document.getElementById('funnelReason-'+i);
    var sources=(review.companies[i].evidence||[]).filter(function(r){return r&&r.id&&r.quote&&Array.isArray(r.urls)&&r.urls.length;});
    var source=product&&product.value!==''?sources[Number(product.value)]:null;
    var anchor=demand&&demand.value!==''?review.anchors[Number(demand.value)]:null;
    var note=reason&&reason.value.trim()||'';
    if(!source||!anchor||note.length<12||note.length>1200){fail('每家勾选企业都需要两份原句及12至1200字的独立适配理由');return;}
    records.push({name:review.companies[i].name,product:{evidenceId:source.id,quote:source.quote},
      demand:{anchorId:anchor.id,quote:anchor.quote},reason:note,confirmed:true});
  }
  if(!records.length){fail('请逐家核对后勾选需要推送的企业');return;}
  var body={projectKey:projKey,topic:review.topic,reportRequestId:String(review.requestId||''),names:records.map(function(r){return r.name;}),reviews:records};
  if(review.preview){body.source='resource';body.resourceIds=review.companies.filter(function(c){return body.names.indexOf(c.name)>=0;}).map(function(c){return c.resourceId;});}
  confirmFunnelReview.pending=true;
  fetch('/api/funnel-review-push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  .then(function(resp){return resp.json().then(function(data){if(!resp.ok||!data.ok)throw new Error(data.message||'未保存，请重试');return data;});})
  .then(function(data){if(pushFunnelTopToGov.review===review){closeModal();pushFunnelTopToGov.review=null;}toast('已推送 '+data.added.length+' 家人工待核线索；投资意向仍未知'+(data.skipped.length?'，跳过 '+data.skipped.length+' 家重复或已移除企业':''));if(typeof restoreFromServer==='function')restoreFromServer(function(){render();});})
  .catch(function(e){fail(e.message);})
  .then(function(){confirmFunnelReview.pending=false;});
}
function funnelReviewDemandAnchors(key,topic){
  var rs=REPORTSTATE[key]||{},anchors=[];
  ((rs.pendingByTopic||{})[topic]||[]).forEach(function(item,i){
    if(!item||['confirmed','edited'].indexOf(item.status)<0)return;
    var quote=item.status==='edited'?item.editedText:item.text;
    if(typeof quote==='string'&&quote.trim().length>=12&&quote.trim().length<=3500)anchors.push({id:'confirmation:'+i,kind:'confirmation',quote:quote.trim()});
  });
  var phase=(rs.phaseByTopic||{})[topic];if(phase==null&&rs.topic===topic)phase=rs.phase;
  var report=(rs.aiReportByTopic||{})[topic]||(rs.topic===topic?rs.text:'');
  if(phase===2&&typeof report==='string')report.split('\n').forEach(function(line,i){var quote=line.trim();if(quote.length>=12&&quote.length<=3500)anchors.push({id:'report:'+i,kind:'report',quote:quote});});
  return anchors;
}
function funnelReviewAnchorChange(i){
  var review=pushFunnelTopToGov.review;if(!review||!review.companies[i])return;
  var sources=(review.companies[i].evidence||[]).filter(function(r){return r&&r.id&&r.quote&&Array.isArray(r.urls)&&r.urls.length;});
  [['Product',sources],['Demand',review.anchors]].forEach(function(pair){
    var select=document.getElementById('funnel'+pair[0]+'-'+i),out=document.getElementById('funnel'+pair[0]+'Text-'+i);
    var value=select&&select.value!==''?pair[1][Number(select.value)]:null;if(out)out.textContent=value?value.quote:'';
  });
}

function resourceReviewChooseProject(resourceIds){
  if(!Array.isArray(resourceIds)||!resourceIds.length||resourceIds.some(function(id){return !id;})){toast('请先保存有唯一编号的资源企业');return;}
  var ids=resourceIds.map(String),keys=Object.keys(PROJECTS).filter(function(k){return PROJECTS[k]&&PROJECTS[k].topic;});
  resourceReviewChooseProject.selection={ids:ids,keys:keys};
  var options=keys.map(function(k){var p=PROJECTS[k];return '<option value="'+_authEscape(k)+'">'+_authEscape((p.city||'')+' / '+p.topic+' / '+k)+'</option>';}).join('');
  openModal('选择一个确切的需求项目','<p>请选择本次要复核的唯一项目。下一步会核对该工作区实际保存的产品与需求来源，不会直接推送。</p><select id="resourceReviewProject" style="width:100%"><option value="">请选择项目</option>'+options+'</select>',
    '<button class="ghost-button" onclick="closeModal()">取消</button><button class="primary-button" onclick="resourceReviewStartFromSelection()">核对当前材料</button>');
}
function resourceReviewStartFromSelection(){
  var saved=resourceReviewChooseProject.selection,select=document.getElementById('resourceReviewProject'),key=select&&select.value;
  if(!saved||saved.keys.indexOf(key)<0){toast('请明确选择一个需求项目');return;}
  resourceReviewPreview(key,saved.ids);
}
function resourceReviewChooseResources(key){
  if(!PROJECTS[key]){toast('请选择确切项目');return;}
  var rows=(typeof OPS_ENT!=='undefined'?OPS_ENT:[]).filter(function(e){return e&&e.id&&e.name;});
  resourceReviewChooseResources.selection={key:key,ids:rows.map(function(e){return String(e.id);})};
  var list=rows.map(function(e,i){return '<label style="display:block;margin:8px 0"><input id="resourceReviewPick-'+i+'" type="checkbox"> '+_authEscape(e.name)+'</label>';}).join('');
  openModal('选择要逐家复核的资源企业','<p>'+_authEscape((PROJECTS[key].city||'')+' / '+PROJECTS[key].topic)+'。每次最多选择8家，不默认勾选；缺少当前工作区原文的企业不能推送。</p>'+list,
    '<button class="ghost-button" onclick="closeModal()">取消</button><button class="primary-button" onclick="resourceReviewConfirmSelection('+_authEscape(JSON.stringify(key))+')">核对所选材料</button>');
}
function resourceReviewConfirmSelection(key){
  var selection=resourceReviewChooseResources.selection;if(!selection||selection.key!==key){toast('选择已变化，请重新打开');return;}
  var ids=selection.ids.filter(function(id,i){var box=document.getElementById('resourceReviewPick-'+i);return box&&box.checked;});
  if(!ids.length||ids.length>8){toast('请明确勾选1至8家企业');return;}
  resourceReviewPreview(key,ids);
}
function resourceReviewPreview(key,ids){
  var p=PROJECTS[key];if(!p)return;
  var topic=p.topic,identity=savedEvidenceIdentity(key,topic),epoch=typeof _authEpoch==='number'?_authEpoch:0,requestId=String(p.reportRequestId||(REPORTSTATE[key]||{}).reportRequestId||'');
  fetch('/api/funnel-resource-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectKey:key,topic:topic,reportRequestId:requestId,resourceIds:ids})})
  .then(async function(resp){var data=await resp.json();if(!resp.ok)throw new Error(data.message||'来源预览未完成');
    if(!PROJECTS[key]||PROJECTS[key].topic!==topic||savedEvidenceIdentity(key,topic)!==identity||(typeof _authEpoch==='number'?_authEpoch:0)!==epoch)throw new Error('当前项目材料已变化，请重新打开');
    if(data.projectKey!==key||data.topic!==topic||data.reportRequestId!==requestId||data.source!=='resource'||data.evidence_contract!=='saved-excerpts-v1'||!Array.isArray(data.companies)||!Array.isArray(data.demandAnchors))throw new Error('来源预览不完整');
    if(!data.companies.length){openModal('需补充企业产品原文','<p>当前工作区没有所选企业的带来源产品原句，不能推送。请先补充材料后重新复核。</p>','<button onclick="closeModal()">关闭</button>');return;}
    if(data.unavailable&&data.unavailable.length)toast(data.unavailable.length+'家缺少来源已排除，请补充产品原文');
    pushFunnelTopToGov(key,8,null,data);
  }).catch(function(e){toast(e.message||'来源预览未完成');});
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
      signal:c.signal||'', signalSrc:c.source||'待补来源', hasMoveSignal:false,
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
      (fn?'<span style="font-size:11px;padding:2px 7px;background:#f5f3ff;color:#6d28d9;border-radius:10px">材料待筛选 '+fn.companies.length+' 家</span>':'')+
      '<div style="flex:1"></div>'+
      (fn&&fn.companies&&fn.companies.length?'<button onclick="showFunnelPyramid(\''+projKey+'\')" style="padding:4px 10px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:11.5px;color:#1a56db;cursor:pointer;font-weight:600;margin-right:8px">📊 分级图谱</button>':'')+
      (running?'<span style="font-size:11.5px;color:#6d28d9">⏳ 分析中…</span>':'<button onclick="loadAIScanClues(\''+projKey+'\')" style="padding:4px 10px;background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:8px;font-size:11.5px;color:#6d28d9;cursor:pointer;font-weight:600">🔄 重新分析</button>')+
    '</div>';
  var funnelBody;
  if(running && !fn){
    funnelBody='<div style="text-align:center;padding:22px;background:#faf9ff;border-radius:10px;border:1px solid #ede9fe;font-size:12.5px;color:#6d28d9">⏳ AI 正在整理当前工作区材料中的企业，业务适配仍需逐家核对…</div>';
  } else if(!fn){
    funnelBody='<div style="text-align:center;padding:20px;background:#f9fafb;border-radius:10px;border:1px solid #e8edf5">'+
      '<div style="font-size:12.5px;color:#9aa5b5;margin-bottom:8px">尚未生成企业漏斗</div>'+
      '<button onclick="loadAIScanClues(\''+projKey+'\')" style="padding:6px 14px;background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:8px;font-size:12px;color:#6d28d9;cursor:pointer;font-weight:600">🔍 立即 AI 分析</button>'+
    '</div>';
  } else if(!fn.companies.length){
    funnelBody='<div style="padding:18px;background:#f9fafb;border-radius:10px;color:#64748b">当前材料不足以形成有来源的企业候选。请补充当前方向的企业产品与需求材料；这不代表现实中不存在相关企业。</div>';
  } else {
    var pushedTip = fn.pushed
      ? '<span style="font-size:11px;color:#166534;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:3px 9px">✓ 已推送 '+(fn.pushedNames?fn.pushedNames.length:0)+' 家到政府端</span>'
      : '';
    var pushBtn = '<button onclick="pushFunnelTopToGov(\''+projKey+'\',8)" style="padding:7px 14px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:8px;font-size:12.5px;font-weight:650;cursor:pointer">逐家核对产品与需求后推送</button>';
    funnelBody='<div style="margin-bottom:10px;display:flex;align-items:center;gap:10px">'+pushBtn+pushedTip+'</div>'+
      aiClues.slice(0,20).map(function(c,ci){ return scanClueCard(c, projKey, ci); }).join('')+
      (aiClues.length>20?'<div style="text-align:center;font-size:11.5px;color:#9aa5b5;padding:8px">共 '+aiClues.length+' 家，当前展示前 20 家材料企业</div>':'');
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
      '<span style="font-size:11px;color:#9aa5b5;margin-left:2px">· 人工录入与待核线索，沟通条件需逐项确认</span>'+
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
  var sc = (p.clues||[]).find(function(c){return c.id===clueId;});
  if(!sc)return;
  if(!p.funnel||(p.funnel.companies||[]).every(function(c){return c.name!==sc.name;})){
    toast('该旧线索没有当前来源，请重新整理材料后逐家核对');return;
  }
  pushFunnelTopToGov(projKey,1,sc.name);
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
    closeFunnelProgressModal();try{showFunnelDoneModal(projKey,funnel);}catch(e){toast('已整理 '+funnel.companies.length+' 家材料企业，待核对业务适配');}
  }, function(pct){ updateFunnelProgress(pct); });
}

/* ── AI 漏斗分析完成提醒弹窗 ── */
function showFunnelDoneModal(projKey, funnel){
  var p=PROJECTS[projKey]||{};
  var total=funnel.companies.length;
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
      '<span style="flex:0 0 auto;font-size:13px;font-weight:800;color:'+(c.fit_score>=80?'#16a34a':c.fit_score>=60?'#d97706':'#6b7280')+'">'+(c.fit_score==null?'待核':c.fit_score)+'<span style="font-size:10px;font-weight:600">'+(c.fit_score==null?'':'分')+'</span></span>'+
    '</div>';
  }).join('');
  var modal='<div id="funnelDoneModal" style="position:fixed;inset:0;background:rgba(11,24,59,.45);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px)" onclick="if(event.target.id===\'funnelDoneModal\')closeFunnelDoneModal()">'+
    '<div style="background:#fff;border-radius:22px;padding:32px 32px 24px;max-width:500px;width:92%;box-shadow:0 8px 60px rgba(11,24,59,.18);animation:fadeUp .35s ease">'+
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">'+
        '<div style="width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.2)"></div>'+
        '<span style="font-size:12px;font-weight:650;color:#22c55e;letter-spacing:.5px">材料企业已整理</span>'+
      '</div>'+
      '<h2 style="font-size:20px;font-weight:750;color:#0b183b;margin:0 0 4px">\u300c'+esc(funnel.topic||p.topic||'\u8be5\u65b9\u5411')+'\u300d材料企业已整理</h2>'+
      '<p style="font-size:13px;color:#8492a6;margin:0 0 18px">已整理 '+n+' 家材料企业；业务适配需逐条核对，投资意向未知。</p>'+
      '<div style="font-size:12px;font-weight:650;color:#4a5568;margin-bottom:2px">候选预览</div>'+
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
      '<p id="funnelProgPhase" style="font-size:13px;color:#8492a6;margin:0 0 18px">正在核对当前方向的来源材料…</p>'+
      '<div style="height:8px;background:#eef1f6;border-radius:6px;overflow:hidden">'+
        '<div id="funnelProgBar" style="height:100%;width:0%;background:linear-gradient(90deg,#1a56db,#6366f1);border-radius:6px;transition:width .5s ease"></div>'+
      '</div>'+
      '<div style="display:flex;justify-content:space-between;margin-top:8px"><span id="funnelProgPct" style="font-size:12px;color:#4338ca;font-weight:650">等待来源校验</span>'+
        '<span style="font-size:11px;color:#9aa5b5">完成后立即显示，期间可继续查看材料</span></div>'+
    '</div>'+
  '</div>';
  if(!document.getElementById('fadeUpStyle')){var st=document.createElement('style');st.id='fadeUpStyle';st.textContent='@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}@keyframes fspin{to{transform:rotate(360deg)}}.funnelSpin{animation:fspin .8s linear infinite}';document.head.appendChild(st);}
  var oldw=document.getElementById('funnelProgWrap'); if(oldw)oldw.remove();
  var oldd=document.getElementById('funnelDoneWrap'); if(oldd)oldd.remove();
  var wrap=document.createElement('div'); wrap.id='funnelProgWrap'; wrap.innerHTML=modal; document.body.appendChild(wrap);
  _funnelProg.pct=0; _funnelProg.phase=0;
  clearInterval(_funnelProg.timer);
  var started=Date.now();
  _funnelProg.timer=setInterval(function(){
    var text=document.getElementById('funnelProgPct');
    if(text)text.textContent='已等待 '+Math.floor((Date.now()-started)/1000)+' 秒';
  },1000);
}
function updateFunnelProgress(pct){
  var bar=document.getElementById('funnelProgBar'), text=document.getElementById('funnelProgPct');
  if(pct===100){if(bar)bar.style.width='100%';if(text)text.textContent='来源校验完成';}
}

function closeFunnelProgressModal(){
  clearInterval(_funnelProg.timer);
  var wrap=document.getElementById('funnelProgWrap'); if(wrap)wrap.remove();
}

/* ── AI 漏斗企业分级金字塔可视化 ── */
function showFunnelPyramid(k){
  var p=PROJECTS[k]||{}; var fn=p.funnel;
  if(fn&&fn.evidence_contract!=='saved-excerpts-v1'){toast('旧材料清单未核对来源，请重新分析');return;}
  if(!fn||!fn.companies||!fn.companies.length){ toast('暂无漏斗数据'); return; }
  if(fn.companies.some(function(c){return c.fit_score==null;})){
    openModal('材料待筛选 · 尚未进行事实评分','<p>没有可追溯的综合评分依据，不将未知值当作零分或分为 S/A/B 级。</p>'+fn.companies.map(function(c){return '<section><strong>'+_authEscape(c.name)+'</strong><p>'+_authEscape(c.fit||'')+'</p>'+funnelEvidenceLinks(c)+'</section>';}).join(''),'<button class="ghost-button" onclick="closeModal()">关闭</button>');
    return;
  }

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
  // Compatibility only: viewing a report never creates synthetic companies.
  // Existing saved clues remain unchanged; new recommendations use review.
  return;
}

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
    var x = Object.assign({},PROJECTS[k],{stage:demandEffectiveStage(k,PROJECTS[k])});
    var sc = stColor(x.stage);
    var expanded = (window.__projOpen === k);

    // Viewing the project list is read-only; AI work starts from an explicit action.
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
          '<select id="stage-target-'+k+'" style="flex:1;min-width:150px;padding:9px 12px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;background:#fff;color:#0b183b;outline:none">'+stageOptions(x,k)+'</select>'+
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
              '<div style="font-size:11.5px;color:#8492a6">'+topicScoreDisplay(p.topic)+' · '+new Date(rs.ts).toLocaleDateString('zh-CN')+'</div>'+
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
                '<div style="font-size:12px;color:#4a5568;line-height:1.6">研判已完成。提交需求后可主动整理材料企业，再逐家核对产品与需求。</div>'+
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
  var current=demandEffectiveStage(projKey,p);
  if(current < st.length){
    advanceStageTo(projKey, current+1, '');
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
  var current=demandEffectiveStage(projKey,p);
  if(target === current){ toast('已在该阶段'); return; }
  var from = current;
  p.stage = target;
  if(!p.stageLog) p.stageLog=[];
  p.stageLog.unshift({ts:Date.now(), from:from, to:target, note:(note||'').trim(), who:'运营端'});
  persist();
  render();
  toast('✓ 已推进到「' + stageNameOf(p,target) + '」阶段');
}

/* 阶段推进面板：下拉选项（当前阶段之后的所有阶段） */
function stageOptions(p,projKey){
  var st = projStages(p);
  var cur = projKey?demandEffectiveStage(projKey,p):(p.stage||1);
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
function reportStateFields(){
  return ['aiReportByTopic','phaseByTopic','tsByTopic','researchByTopic','materialDirectoryByTopic','evidenceStatusByTopic','scoreByTopic','userGeneratedTopics','reportByTopic','actionItemsByTopic'];
}


function reportStateStamp(value){return typeof value==='number'&&isFinite(value)&&value>0?value:0;}

function reportTopicStamp(state,topic){return reportStateStamp((state.tsByTopic||{})[topic])||(state.topic===topic?reportStateStamp(state.ts):0);}

function mergeTopicStamps(){
  var out={};Array.from(arguments).forEach(function(map){Object.keys(map||{}).forEach(function(t){out[t]=Math.max(out[t]||0,reportStateStamp(map[t]));});});return out;
}


function topicLifecycle(){
  var rows=Array.from(arguments),deleted=mergeTopicStamps.apply(null,rows.map(function(r){return (r||{}).topicDeletedAt;})),created=mergeTopicStamps.apply(null,rows.map(function(r){return (r||{}).topicCreatedAt;}));
  rows.forEach(function(r){((r||{}).deletedTopics||[]).forEach(function(t){deleted[t]=Math.max(deleted[t]||0,1);});});
  return {deleted:deleted,created:created};
}


function mergeTopicProjectLifecycle(old,incoming){
  old=old||{};incoming=incoming||{};var out=Object.assign({},incoming),life=topicLifecycle(old,incoming);
  out.topicDeletedAt=life.deleted;out.topicCreatedAt=life.created;
  out.deletedTopics=Object.keys(life.deleted).filter(function(t){return life.deleted[t]>=(life.created[t]||0);});
  out.customTopics=Array.from(new Set((old.customTopics||[]).concat(incoming.customTopics||[]))).filter(function(t){return out.deletedTopics.indexOf(t)<0;});
  out.stageByTopic=Object.assign({},old.stageByTopic||{},incoming.stageByTopic||{});
  out.deletedTopics.forEach(function(t){delete out.stageByTopic[t];});
  Object.keys(life.created).forEach(function(t){if(life.created[t]>((old.topicCreatedAt||{})[t]||0))out.stageByTopic[t]=(incoming.stageByTopic||{})[t]||2;});
  Object.keys(life.created).forEach(function(t){if(life.created[t]>((incoming.topicCreatedAt||{})[t]||0))out.stageByTopic[t]=(old.stageByTopic||{})[t]||2;});
  if(out.aiTopics)out.aiTopics=Object.assign({},out.aiTopics,{list:(out.aiTopics.list||[]).filter(function(t){return t&&out.deletedTopics.indexOf(t.label)<0;})});
  if(out.deletedTopics.indexOf(out.topic)>=0){out.topic='';out.stage=2;}
  else if(life.created[out.topic])out.stage=out.stageByTopic[out.topic]||2;
  return out;
}


function mergeTopicReportState(old,incoming,project){
  old=old||{};incoming=incoming||{};project=project||{};
  var fields=reportStateFields(),aux=['pendingByTopic','pendingRevisionByTopic','pendingReportTsByTopic','partialByTopic'];
  var out=Object.assign({},old,incoming),life=topicLifecycle(project,old,incoming),topics={};
  out.topicDeletedAt=life.deleted;out.topicCreatedAt=life.created;
  out.historyDeletedAt=mergeTopicStamps(old.historyDeletedAt,incoming.historyDeletedAt);
  fields.concat(aux).forEach(function(f){Object.keys(old[f]||{}).concat(Object.keys(incoming[f]||{})).forEach(function(t){topics[t]=true;});out[f]={};});
  Object.keys(topics).forEach(function(t){
    var tomb=life.deleted[t]||0,birth=life.created[t]||0;if(tomb&&tomb>=birth)return;
    var candidates=[old,incoming].filter(function(s){return !birth||reportTopicStamp(s,t)>=birth;});if(!candidates.length)return;
    var winner=candidates.reduce(function(a,b){return reportTopicStamp(b,t)>reportTopicStamp(a,t)?b:a;}),version=reportTopicStamp(winner,t);
    fields.forEach(function(f){if(Object.prototype.hasOwnProperty.call(winner[f]||{},t))out[f][t]=winner[f][t];});
    var editors=candidates.filter(function(s){return reportTopicStamp(s,t)===version&&((s.pendingReportTsByTopic||{})[t]===undefined||s.pendingReportTsByTopic[t]===version);});
    if(editors.length){var editor=editors.reduce(function(a,b){return reportStateStamp((b.pendingRevisionByTopic||{})[t])>reportStateStamp((a.pendingRevisionByTopic||{})[t])?b:a;});if(!editors.some(function(s){return reportStateStamp((s.pendingRevisionByTopic||{})[t]);}))editor=editors[editors.length-1];['pendingByTopic','pendingRevisionByTopic','pendingReportTsByTopic'].forEach(function(f){if(Object.prototype.hasOwnProperty.call(editor[f]||{},t))out[f][t]=editor[f][t];});}
    var parts=candidates.map(function(s){return (s.partialByTopic||{})[t];}).filter(function(p){return p&&reportStateStamp(p.ts)>version&&(p.reportTs===undefined||p.reportTs===version);});
    if(parts.length)out.partialByTopic[t]=parts.reduce(function(a,b){return reportStateStamp(b.ts)>reportStateStamp(a.ts)?b:a;});
  });
  var topic=incoming.topic||old.topic||'';if(life.deleted[topic]&&life.deleted[topic]>=(life.created[topic]||0))topic='';out.topic=topic;
  var viewOwner=reportTopicStamp(incoming,topic)>=reportTopicStamp(old,topic)?incoming:old;
  [['text','aiReportByTopic',''],['phase','phaseByTopic',1],['ts','tsByTopic',0],['score','scoreByTopic',null]].forEach(function(row){var fallback=viewOwner.topic===topic?(viewOwner[row[0]]===undefined?(old[row[0]]===undefined?row[2]:old[row[0]]):viewOwner[row[0]]):row[2];out[row[0]]=Object.prototype.hasOwnProperty.call(out[row[1]],topic)?out[row[1]][topic]:(topic?fallback:row[2]);});
  ['chainByTopic','chainEvidenceByTopic','chainStatusByTopic','chainUnclassifiedByTopic','chainErrorByTopic'].forEach(function(f){
    // Incoming server graph data remains authoritative; tombstones only remove.
    if(out[f]){out[f]=Object.assign({},out[f]);Object.keys(out[f]).forEach(function(t){if((life.deleted[t]&&life.deleted[t]>=(life.created[t]||0))||((life.created[t]||0)>reportTopicStamp(out,t)))delete out[f][t];});}
  });
  var currentVersion=Math.max(reportTopicStamp(old,topic),reportTopicStamp(incoming,topic));
  out.finalized=!!out.text&&[old,incoming].some(function(s){return s.topic===topic&&reportTopicStamp(s,topic)===currentVersion&&s.finalized;});return out;
}


function mergeTopicReportStates(old,incoming,projects){
  var out={};Object.keys(Object.assign({},old||{},incoming||{})).forEach(function(k){
    var a=(old||{})[k]||{},b=(incoming||{})[k]||{};
    out[k]=reportStateFields().some(function(f){return a[f]||b[f];})?mergeTopicReportState(a,b,(projects||{})[k]):Object.assign({},a,b);
  });return out;
}


function applyTopicStateIntegrity(){
  Object.keys(PROJECTS||{}).forEach(function(k){PROJECTS[k]=mergeTopicProjectLifecycle(PROJECTS[k],PROJECTS[k]);});
  REPORTSTATE=mergeTopicReportStates(REPORTSTATE,{},PROJECTS);
  REPORT_HISTORY=mergeTopicReportHistory(REPORT_HISTORY,{},REPORTSTATE,PROJECTS);
  Object.keys(REPORTSTATE).forEach(function(k){var state=REPORTSTATE[k],topic=(PROJECTS[k]||{}).topic;if(state.pendingByTopic)PENDING_CONFIRMS[k]=state.pendingByTopic[topic]||[];});
}


function mergeTopicReportHistory(old,incoming,states,projects){
  var out={};Object.keys(Object.assign({},old||{},incoming||{})).forEach(function(k){
    var state=(states||{})[k]||{},life=topicLifecycle(state,(projects||{})[k]),seen={};out[k]=[];
    ((old||{})[k]||[]).concat((incoming||{})[k]||[]).forEach(function(h){
      if(!h)return;var ts=reportStateStamp(h.ts),id=(h.topic||'')+'\u0000'+ts;
      if(seen[id]||(state.historyDeletedAt||{})[id]||ts<=(life.deleted[h.topic]||-1)||ts<(life.created[h.topic]||0))return;
      seen[id]=true;out[k].push(h);
    });out[k].sort(function(a,b){return reportStateStamp(b.ts)-reportStateStamp(a.ts);});out[k]=out[k].slice(0,10);
  });return out;
}


function topicOperationStamp(key,topic){
  var p=PROJECTS[key]||{},s=REPORTSTATE[key]||{};
  return Math.max(Date.now(),reportTopicStamp(s,topic)+1,((s.pendingRevisionByTopic||{})[topic]||0)+1,((p.topicDeletedAt||{})[topic]||0)+1,((p.topicCreatedAt||{})[topic]||0)+1);
}


function touchTopicPending(key,topic){
  var state=REPORTSTATE[key];if(!state)return;
  state.pendingRevisionByTopic=state.pendingRevisionByTopic||{};state.pendingReportTsByTopic=state.pendingReportTsByTopic||{};
  state.pendingRevisionByTopic[topic]=topicOperationStamp(key,topic);state.pendingReportTsByTopic[topic]=reportTopicStamp(state,topic);
}


function clearTopicReportData(key,topic){
  var state=REPORTSTATE[key]||{},p=PROJECTS[key]||{};
  reportStateFields().concat(['pendingByTopic','pendingRevisionByTopic','pendingReportTsByTopic','partialByTopic','chainByTopic','chainEvidenceByTopic','chainStatusByTopic','chainUnclassifiedByTopic','chainErrorByTopic']).forEach(function(f){if(state[f])delete state[f][topic];});
  if(state.topic===topic){state.text='';state.topic='';state.phase=1;state.ts=0;state.score=null;state.finalized=false;}
  if(p.stageByTopic)delete p.stageByTopic[topic];
  if(typeof REPORT_HISTORY!=='undefined'&&REPORT_HISTORY[key])REPORT_HISTORY[key]=REPORT_HISTORY[key].filter(function(h){return h&&h.topic!==topic;});
  if(p.topic===topic&&typeof PENDING_CONFIRMS!=='undefined')PENDING_CONFIRMS[key]=[];
}


function selectTopic(val,isCustom){
  var p=P();if(!p||!val||!val.trim())return;
  var rs=REPORTSTATE[cur],old=p.topic;
  if(rs&&old){rs.pendingByTopic=rs.pendingByTopic||{};rs.pendingByTopic[old]=currentPendingItems(cur);}
  p.topic=val.trim();
  if(isCustom){
    if((p.topicDeletedAt||{})[p.topic]||(p.deletedTopics||[]).indexOf(p.topic)>=0){var born=topicOperationStamp(cur,p.topic);clearTopicReportData(cur,p.topic);p.topicCreatedAt=p.topicCreatedAt||{};p.topicCreatedAt[p.topic]=born;}
    p.deletedTopics=(p.deletedTopics||[]).filter(function(t){return t!==p.topic;});p.customTopics=p.customTopics||[];if(p.customTopics.indexOf(p.topic)<0)p.customTopics.push(p.topic);
  }
  if(rs){rs.text=reportTextForTopic(p.topic)||'';rs.topic=p.topic;PENDING_CONFIRMS[cur]=(rs.pendingByTopic||{})[p.topic]||[];}
  persist();render();
}
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
/* 邀请码库：结构同政府端 06.js 里的说明。管理端(/ops)是唯一可写入新码的入口。 */
var INVITE_CODES = (typeof INVITE_CODES!=='undefined'&&INVITE_CODES) || {};
/* 城市基础包指针表：结构同政府端 03.js 里的说明。管理端在「城市智库RAG」页
   用它判断/管理某城市的权威基础包来自哪个projKey。 */
// Server-owned canonical city workspace registry; keep invitation secrets out of persisted caches.
var CITY_WORKSPACES = {};
var CITY_BASE_PACKAGES = (typeof CITY_BASE_PACKAGES!=='undefined'&&CITY_BASE_PACKAGES) || {};
function getCityBasePackage(city){
  var authorityKey=CITY_BASE_PACKAGES[city];
  var authority=authorityKey&&PROJECTS[authorityKey];
  if(!authority||!Array.isArray(authority.kb)) return null;
  // 【2026-09-29】只处理4个标准主题，权威工作区可能带额外非标准主题（同步政府端03.js修复）
  var STANDARD_TITLES=['主导产业与产业链','园区与承载条件','链主与存量企业','政策、规划与领导关注'];
  return authority.kb.filter(function(topic){
    return STANDARD_TITLES.indexOf(topic.t)>=0;
  }).map(function(topic){
    var baseKnown=(topic.known||[]).filter(function(it){
      return it&&typeof it==='object'&&it.nature==='base';
    });
    return {icon:topic.icon,t:topic.t,sub:topic.sub,tag:topic.tag,known:baseKnown};
  });
}

function saveReportHistory(){try{localStorage.setItem('hxz_rpt_history',JSON.stringify(REPORT_HISTORY));}catch(e){}}
function loadReportHistory(){try{var d=localStorage.getItem('hxz_rpt_history');if(d)REPORT_HISTORY=JSON.parse(d);}catch(e){}}
loadReportHistory();

// Freeze the score's meaning with the report. A missing score is not a request
// to estimate confidence from body length or reuse another topic's score.
function reportHistoryRecord(key, topic, text){
  var rs=REPORTSTATE[key]||{}, scores=rs.scoreByTopic||{};
  var unreviewed=(rs.evidenceStatusByTopic||{})[topic]==='unreviewed';
  var native=nativeReportState(topic,key), score=null;
  if(!unreviewed){
    if(native) score=nativeReportScore(topic,key);
    else if(Object.prototype.hasOwnProperty.call(scores,topic)) score=scores[topic];
    else if(rs.topic===topic) score=rs.score;
  }
  if(typeof score!=='number'||!isFinite(score)||score<0||score>100) score=null;
  return {
    topic:topic, text:text, rep:text,
    ts:(rs.tsByTopic||{})[topic]||(rs.topic===topic?rs.ts:0)||rs.ts||0,
    phase:(rs.phaseByTopic||{})[topic]||(rs.topic===topic?rs.phase:2)||2,
    score:score, evidenceStatus:unreviewed?'unreviewed':null,
    scoreBasis:native?native.scoreBasis:null,
    scoreStatus:native?native.scoreStatus:null,
    sourceReportId:native?native.sourceReportId:null
  };
}

function reportHistoryScoreDisplay(rep,key){
  var rs=REPORTSTATE[key]||{}, topic=rep.topic;
  var text=(rs.aiReportByTopic||{})[topic]||(rs.topic===topic?rs.text:null);
  var ts=(rs.tsByTopic||{})[topic]||(rs.topic===topic?rs.ts:0)||rs.ts||0;
  // The same current snapshot may have been archived before evidence metadata
  // was introduced. Its live explicit status still takes precedence.
  if(text===rep.text && ts===rep.ts){
    if((rs.evidenceStatusByTopic||{})[topic]==='unreviewed') return '内容待核验';
    if(nativeReportState(topic,key)) return topicScoreDisplay(topic,key);
  }
  if(rep.evidenceStatus==='unreviewed') return '内容待核验';
  var score=typeof rep.score==='number'&&isFinite(rep.score)&&rep.score>=0&&rep.score<=100?rep.score:null;
  if(rep.scoreBasis==='核验一致项比例' && rep.sourceReportId){
    if(rep.scoreStatus==='unclassified') return '核验分类待校核';
    if(rep.scoreStatus==='unavailable'||score===null) return '暂无核验结论';
    return '核验一致项比例 '+score+'%';
  }
  return score===null?'内容待核验':score+'%';
}

function archiveCurrentReport(key,topic){
  var rs=REPORTSTATE[key];
  if(!rs) return;
  topic=topic||rs.topic;
  var text=(rs.aiReportByTopic||{})[topic]||(rs.topic===topic?rs.text:'');
  if(!text) return;
  if(!REPORT_HISTORY[key]) REPORT_HISTORY[key]=[];
  var record=reportHistoryRecord(key,topic,text);
  var existing=REPORT_HISTORY[key].findIndex(function(h){return h.topic===record.topic&&h.ts===record.ts;});
  if(existing>=0) REPORT_HISTORY[key][existing]=record;
  else REPORT_HISTORY[key].unshift(record);
  if(REPORT_HISTORY[key].length>10) REPORT_HISTORY[key]=REPORT_HISTORY[key].slice(0,10);
  saveReportHistory();
}

function deleteHistoryReport(key, idx){
  if(!REPORT_HISTORY[key]) return;
  var _h=REPORT_HISTORY[key][idx]; var _label=_h&&_h.topic?('「'+_h.topic+'」'):'该条';
  if(!confirm('确定删除'+_label+'历史报告？删除后无法恢复。')) return;
  var state=REPORTSTATE[key]||(REPORTSTATE[key]={});state.historyDeletedAt=state.historyDeletedAt||{};
  if(_h)state.historyDeletedAt[(_h.topic||'')+'\u0000'+(Number(_h.ts)||0)]=topicOperationStamp(key,_h.topic||'');
  REPORT_HISTORY[key].splice(idx,1);
  saveReportHistory();
  persist();
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
  REPORT_HISTORY=mergeTopicReportHistory(REPORT_HISTORY,{},REPORTSTATE,PROJECTS);
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
    h+='<span style="font-size:11px;color:#64748b;flex-shrink:0;margin-left:4px">'+reportHistoryScoreDisplay(rep,key)+'</span>';
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
          '<input id="ci-finp-'+projKey+'-'+idx+'" type="file" multiple accept=".pdf,.docx,.txt,.md,.csv,.json" style="display:none" onchange="ciFileSelected(this,\''+projKey+'\','+idx+')"/>'+
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
  var done = items.filter(function(x){return x.status==='confirmed'||(x.status==='edited'&&typeof x.editedText==='string'&&x.editedText.trim());}).length;
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
  var topic=(PROJECTS[projKey]||{}).topic||'';
  var gate=fullReportConfirmation(projKey,topic);
  var items=gate.items, total=gate.total, done=gate.done, allDone=gate.ready;
  var prog=document.getElementById('cp-progress-'+projKey);
  if(prog) prog.textContent=done+' / '+total+' 已确认';
  var bar=document.getElementById('cp-bar-'+projKey);
  if(bar) bar.style.width=(total?Math.round(done/total*100):0)+'%';
  var unlock=document.getElementById('cp-unlock-'+projKey);
  if(unlock){
    unlock.style.background=allDone?'#f0fdf4':'#f9fafb';
    unlock.style.borderColor=allDone?'#86efac':'#e8edf5';
    unlock.innerHTML=allDone
      ?'<span style="font-size:13px;font-weight:650;color:#166534">✓ 所有事项已确认，请点击下方蓝色按钮生成完整报告</span>'
      :'<span style="font-size:13px;color:#9aa5b5">还剩 '+(total-done)+' 条待确认</span>';
  }
  // 始终强制重建底部操作栏
  var bottomBar=document.querySelector('.report-bottom-bar');
  if(!bottomBar) return persist();
  // 全部确认后推进到「资源匹配」阶段
  // Confirming research facts does not submit a demand or advance its business stage.
  // 【2026-09-17】删除"未全部确认就把 stage 4 降回 3"的降级：待确认事项是研判阶段的产物，
  // 需求已递交进入资源匹配后，任何一次报告区重渲染都会把阶段拉回「确认需求」。
  // if(_p && !allDone && _p.stage===4){ _p.stage=3; }  // 已废弃：阶段只进不退
  if(allDone){
    bottomBar.innerHTML=
      '<div style="flex:1;font-size:12.5px;color:#166534;background:#f0fdf4;padding:10px 14px;border-radius:10px;border:1px solid #86efac">✓ 所有待确认事项已完成</div>'+
      '<button onclick="triggerReport(2)" style="padding:12px 24px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:650;cursor:pointer;box-shadow:0 4px 16px rgba(26,86,219,.3)">生成完整产业报告 →</button>'+
      '<button onclick="doUpload()" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">📎 补充材料</button>';
  } else {
    bottomBar.innerHTML=
      '<div style="flex:1;font-size:12.5px;color:#92400e;background:#fffbeb;padding:10px 14px;border-radius:10px;border:1px solid #fde68a">请确认上方 '+(total-done)+' 条待确认事项后生成完整产业报告</div>'+
      '<button disabled style="padding:12px 20px;background:#e8edf5;color:#9aa5b5;border:none;border-radius:12px;font-size:13.5px;cursor:not-allowed">完成确认后解锁 →</button>'+
      '<button onclick="doUpload()" style="padding:12px 14px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:12px;font-size:13px;color:#4a5568;cursor:pointer">📎 补充材料</button>';
  }
  persist();
}

/* 确认一条 */
function cfmItem(projKey, idx){
  var items=currentPendingItems(projKey);if(!items[idx])return;
  items[idx].status = 'confirmed';touchTopicPending(projKey,PROJECTS[projKey].topic);
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
  persist(); // 同步确认状态到服务器
  updateConfirmProgress(projKey);
  refreshTopReliability();
}

/* 撤回确认 */
function uncfmItem(projKey, idx){
  var items=currentPendingItems(projKey);if(!items[idx])return;
  items[idx].status = 'pending';touchTopicPending(projKey,PROJECTS[projKey].topic);
  // 重新渲染整个面板
  var panel = document.getElementById('confirmPanel-'+projKey);
  if(panel){
    var tmp = document.createElement('div');
    tmp.innerHTML = renderConfirmPanel(PENDING_CONFIRMS[projKey], projKey);
    panel.replaceWith(tmp.firstChild);
  }
  persist(); // 同步撤回到服务器
  updateConfirmProgress(projKey);
  refreshTopReliability();
}

/* 显示编辑框 */
function ciShowEdit(projKey, idx){
  var edit = document.getElementById('ci-edit-'+projKey+'-'+idx);
  var ta   = document.getElementById('ci-ta-'+projKey+'-'+idx);
  var item = currentPendingItems(projKey)[idx];
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
  var item = currentPendingItems(projKey)[idx];if(!item)return;
  item.editedText = ta.value.trim();
  item.status = 'edited';touchTopicPending(projKey,PROJECTS[projKey].topic);
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
  var epoch=originalUploadEpoch(),topic=(PROJECTS[projKey]||{}).topic,item=currentPendingItems(projKey)[idx];if(!item||cur!==projKey)return;
  var hint=document.getElementById('ci-file-hint-'+projKey+'-'+idx);
  if(hint)hint.textContent='正在保存附件原件…';
  return ingestFiles(files,null).then(function(saved){
    if(!originalUploadSessionCurrent(epoch))return;
    if(!item.files)item.files=[];
    saved.forEach(function(f){item.files.push(f._originalReceipt.upload);});
    touchTopicPending(projKey,topic);
    if(cur===projKey&&hint)hint.textContent='已保存 '+saved.length+' 个附件原件';
    persist();
  });
}


/* 立项卡片 */
function renderActionItems(text,p,r){
  var area=document.getElementById('actionItemsBlock');
  if(area)area.innerHTML=restoreActionItems();
}

/* 立项导入 */
function importToProject(gap,city,topic,btnEl){
  var p=P();if(!p || (city&&city!==p.city) || gap!==p.topic || (topic&&topic!==p.topic)){
    toast('请先为该方向完成独立研判，再提交招商需求');return;
  }
  return submitDemand();
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
  var p=P();if(!p){updateReportBusy();return;}
  var inp=document.getElementById('topicCustomInput');
  var topic=inp&&inp.value.trim()?inp.value.trim():p.topic;
  if(!topic){updateReportBusy();toast('请先选择产业方向');return;}
  var key=cur, gate=fullReportConfirmation(key,topic);
  if(phase===2 && !gate.ready){updateReportBusy();toast(gate.message);return;}
  var area=document.getElementById('reportArea');if(!area){updateReportBusy();return;}
  window._topicReportJobs=window._topicReportJobs||{};
  var jobKey=key+'\u0000'+topic;
  if(window._topicReportJobs[jobKey]){toast('当前方向正在生成，请稍候');return;}
  var epoch=typeof _authEpoch==='undefined'?null:_authEpoch;
  var requestId=p.reportRequestId||'';
  var baseReportTs=reportTopicStamp(REPORTSTATE[key]||{},topic);
  var topicBirth=(p.topicCreatedAt||{})[topic]||0,topicDeath=(p.topicDeletedAt||{})[topic]||0;
  var materialIdentity=reportMaterialIdentity(key,topic),clientFingerprint='';
  var materialDirectory=typeof captureReportMaterialDirectory==='function'?captureReportMaterialDirectory(key,topic):null;
  var controller=new AbortController(),started=Date.now(),text='';
  window._topicReportJobs[jobKey]=controller;window._reportGenerating=true;
  window._topicReportProgress=window._topicReportProgress||{};
  window._topicReportProgress[jobKey]={phase:phase,message:'正在准备当前方向材料…',text:''};
  try{p.topic=topic;persist();}catch(error){delete window._topicReportJobs[jobKey];delete window._topicReportProgress[jobKey];updateReportBusy();toast('本地保存未完成，请重试');return Promise.resolve();}
  var query=phase===1
    ? '请基于'+p.city+'城市智库，针对「'+topic+'」输出简短草稿：三个关键缺口、三个招引方向、三个以⚠️开头的待确认事项和证据边界。事实与推断分开，没有证据写待核，不能写成不存在。'+(window._interviewContext?'\n访谈补充：'+window._interviewContext:'')
    : '请基于'+p.city+'城市智库，针对「'+topic+'」输出五章招商研判：一、产业基础判断；二、产业链缺口分析；三、补链优先级清单；四、目标企业画像；五、待确认事项。数字、政策门槛和有效期必须保留原文完整条件，并给出来源。不得将未检索到改写为不存在，不得将待核或推断改成事实。已确认事项：\n'+gate.items.map(function(x){return x.editedText||x.text;}).join('\n');
  var chunks;
  try{
    var corpus=buildKBCorpus(p.city);chunks=kbSearch(query,corpus,phase===1?8:20);
    setReportAreaHtml(area,'<div class="report-document industry-report industry-prose"><h2>'+(phase===1?'初步研判草稿':'完整产业研判')+'</h2><p id="reportRunStatus">正在读取当前方向材料，检索与来源核对完成后显示研判…</p><div id="reportContent"></div></div>');
    refreshReportRunUi();
  }catch(error){delete window._topicReportJobs[jobKey];delete window._topicReportProgress[jobKey];updateReportBusy();toast('读取本地材料未完成，请重试');return Promise.resolve();}
  function active(){return PROJECTS[key] && (PROJECTS[key].reportRequestId||'')===requestId && ((PROJECTS[key].topicCreatedAt||{})[topic]||0)===topicBirth && ((PROJECTS[key].topicDeletedAt||{})[topic]||0)===topicDeath && (epoch===null || epoch===_authEpoch);}
  function visible(){return active() && cur===key && P() && P().topic===topic;}
  function materialsCurrent(){return reportMaterialIdentity(key,topic)===materialIdentity;}
  function changedError(){var e=new Error('材料或确认事项已更新，本次结果未写入，请按最新材料重新生成');e.sourceChanged=true;return e;}
  function showStatus(message){
    var job=(window._topicReportProgress||{})[jobKey];if(job)job.message=message;
    if(visible())refreshReportRunUi();
  }
  function retainPartial(part,reason){
    if(!active()||reportTopicStamp(REPORTSTATE[key]||{},topic)!==baseReportTs)return;
    var rs=REPORTSTATE[key]||(REPORTSTATE[key]={});
    rs.partialByTopic=rs.partialByTopic||{};
    rs.partialByTopic[topic]={text:part||'',reason:reason,ts:topicOperationStamp(key,topic),reportTs:baseReportTs,phase:phase,status:'incomplete'};
    persist();
  }
  var timeout=setTimeout(function(){controller.abort();},phase===2?240000:180000);
  return reportClientFingerprint(materialIdentity).then(function(value){
    clientFingerprint=value;
    if(!materialsCurrent())throw changedError();
    return syncTopicReportInputs();
  }).then(function(){
    if(!active())throw new Error('登录状态已变更，本次生成已停止');
    if(!materialsCurrent())throw changedError();
    return fetch('/api/kb-chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
    body:JSON.stringify({question:query,chunks:chunks,city:p.city,stream:true,mode:phase===1?'draft':'full',prefs:curOnbPrefs(),purpose:phase===2?'topic_full':'topic_draft',projectKey:key,topic:topic,reportRequestId:requestId||null,confirmations:phase===2?gate.items:[],clientMaterialFingerprint:clientFingerprint})
    });
  }).then(function(response){
    if(!response.ok){
      return response.json().catch(function(){return {};}).then(function(error){throw new Error(typeof error.message==='string'?error.message.slice(0,500):'服务未接受请求（'+response.status+'）');});
    }
    showStatus('正在研究当前方向，检索与来源核对进展将在此显示');
    return readTopicReportStream(response,function(value){
      text=value;var job=(window._topicReportProgress||{})[jobKey];if(job)job.text=value;
      if(visible()){var el=document.getElementById('reportContent');if(el)el.innerHTML=topicReportMarkup(value);}
    },function(event,metadata){
      if(metadata.clientMaterialFingerprint&&metadata.clientMaterialFingerprint!==clientFingerprint){controller.abort();throw changedError();}
      if(event.type==='research.status'&&event.message)showStatus(event.message);
      else if(event.type==='research.evidence')showStatus('已读取 '+metadata.sources.length+' 条来源，继续核对并整理研判');
    });
  }).then(function(result){
    if(!active())return;
    if(!materialsCurrent())throw changedError();
    if(reportTopicStamp(REPORTSTATE[key]||{},topic)!==baseReportTs)throw changedError();
    if(result.metadata&&result.metadata.clientMaterialFingerprint&&result.metadata.clientMaterialFingerprint!==clientFingerprint)throw changedError();
    text=result.text;
    if(phase===2 && !isCompleteTopicReport(text)){var e=new Error('本次正文未包含完整五章，已保留为未完成内容');e.partialText=text;throw e;}
    var rs=REPORTSTATE[key]||(REPORTSTATE[key]={});
    if(typeof archiveCurrentReport==='function')archiveCurrentReport(key,topic);
    var now=topicOperationStamp(key,topic);
    ['aiReportByTopic','phaseByTopic','tsByTopic','scoreByTopic','userGeneratedTopics','pendingByTopic'].forEach(function(field){rs[field]=rs[field]||{};});
    rs.aiReportByTopic[topic]=text;rs.phaseByTopic[topic]=phase;rs.tsByTopic[topic]=now;
    rs.researchByTopic=rs.researchByTopic||{};
    rs.researchByTopic[topic]=Object.assign({},result.metadata||{},{topic:topic,reportText:text,clientMaterialFingerprint:clientFingerprint,generatedAt:now});
    if(materialDirectory){
      materialDirectory.reportText=text;rs.materialDirectoryByTopic=rs.materialDirectoryByTopic||{};
      rs.materialDirectoryByTopic[topic]=materialDirectory;
    }
    rs.userGeneratedTopics[topic]=true;
    if(rs.chainByTopic)delete rs.chainByTopic[topic];
    if(rs.chainEvidenceByTopic)delete rs.chainEvidenceByTopic[topic];
    if(rs.chainStatusByTopic)delete rs.chainStatusByTopic[topic];
    if(rs.chainUnclassifiedByTopic)delete rs.chainUnclassifiedByTopic[topic];
    if(rs.chainErrorByTopic)delete rs.chainErrorByTopic[topic];
    rs.evidenceStatusByTopic=rs.evidenceStatusByTopic||{};rs.evidenceStatusByTopic[topic]='unreviewed';
    rs.scoreByTopic[topic]=null;
    if(rs.partialByTopic)delete rs.partialByTopic[topic];
    if(phase===1){
      var previous=rs.pendingByTopic[topic]||[];
      rs.pendingByTopic[topic]=parsePendingItems(text).map(function(item){return previous.find(function(x){return x.text===item.text;})||item;});
      if(visible())PENDING_CONFIRMS[key]=rs.pendingByTopic[topic];
    }
    touchTopicPending(key,topic);
    if(visible()){rs.text=text;rs.topic=topic;rs.phase=phase;rs.ts=now;rs.score=null;rs.finalized=false;}
    persist();showStatus('正文已生成，正在确认云端保存…');
    return syncTopicReportInputs().then(function(){
      var analysis=(rs.researchByTopic[topic]||{}).analysis||{};
      var label=analysis.status==='evidence_only'?'资料摘要已保存 · 研判依据待补':analysis.status==='supported_analysis'?'研判已生成 · 结论待核验':phase===1?'草稿已保存，请确认当前方向事项':'报告已保存 · 请核对来源和结论';
      showStatus(label+' · '+Math.round((Date.now()-started)/1000)+'秒');if(visible())toast(label);
    },function(error){error.localReportSaved=true;throw error;});
  }).catch(function(error){
    if(error.localReportSaved){showStatus('报告已保存在本机，云端保存未确认；请重试同步。');if(visible())toast('报告已保存在本机，云端保存未确认；请重试同步。');return;}
    if(!error.sourceChanged&&materialsCurrent())retainPartial(error.partialText||text,error.message);
    showStatus(error.sourceChanged?error.message:'本次生成未完成，原正式报告已保留；可重试。');
    if(visible())toast(error.name==='AbortError'?'生成连接超时，未完成内容已保留':error.message);
  }).finally(function(){
    clearTimeout(timeout);delete window._topicReportJobs[jobKey];
    delete window._topicReportProgress[jobKey];
    updateReportBusy();
    if(visible())render();
  });
}


function submitDemand(){
  var p=P(); if(!p) return;
  var topic=p.topic;
  var snapshot=demandReportSnapshot(cur,topic);
  if(!snapshot){toast('请先完成当前方向的研判报告');return;}
  // 关键修复：招商需求必须针对「当前研判方向」创建一个独立的 isDemand 子项目，
  // 而不是把父项目工作区(cur, 如 sz)本身推进 stage/派生线索——那会让父项目连同它
  // 随方向变化的 topic 一起混入招商对接，且各方向线索全堆到父项目上。
  // 幂等：同一城市同一方向已提交过则不重复建。
  var dupKey=_findExistingDemand(p.city, topic);
  // 同一需求重复点击只重试同步，不能重复创建，也不能假定已入库。
  var key=dupKey||('proj_'+Date.now().toString(36));
  window._demandSyncPending=window._demandSyncPending||{};
  if(window._demandSyncPending[key]){toast('正在提交，请稍候'); return;}
  if(!dupKey){
  PROJECTS[key]={
    id:key, workspaceId:_projectWorkspaceId(cur), city:p.city, org:p.org, who:p.who,
    topic:topic, stage:3, isDemand:true, submissionState:'pending',
    kb: JSON.parse(JSON.stringify(p.kb||[])),
    report:null, clues:[],
    stageLog:[{ts:Date.now(), from:2, to:3, note:'招商需求已正式递交', who:'政府端'}]
  };
  // 把当前方向的报告复制给子项目，供招商对接/线索派生使用
  REPORTSTATE[key]=snapshot;
  if(nativeReportState(topic)) PROJECTS[key].reportRequestId=p.reportRequestId;

  DEMANDS.push({
    id:'d'+Date.now().toString(36),
    projKey:key,
    city:p.city, gov:p.org+'·'+p.who,
    topic:topic, domain:topic.replace('补链','').replace('升级',''),
    need:'基于研判报告（'+(nativeReportState(topic)?topicScoreDisplay(topic):'内容待核验')+'），见报告全文',
    submit:'刚刚', res:'none', resLabel:'待研判', clues:0,
    note:snapshot.text.slice(0,120)+'…', ai:''
  });
  // 待接触企业只由管理端 AI 漏斗精选推送，政府端不再自动派生「脱敏企业」假线索
  // deriveCluesFromReport(key);
  }
  persist();
  window._demandSyncPending[key]=true;
  toast('正在提交，请稍候');
  return Promise.resolve().then(function(){
    var payload=JSON.parse(localStorage.getItem(LS_KEY)||'{}');
    if(!payload.PROJECTS || !payload.PROJECTS[key]) throw new Error('本地保存失败');
    return fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(typeof _safeSyncSnapshot==='function'?_safeSyncSnapshot(payload):payload)});
  }).then(function(response){
    if(!response.ok) throw new Error('HTTP '+response.status);
    return response.json();
  }).then(function(result){
    if(!result || result.ok!==true) throw new Error((result&&(result.error||result.rejected))||'服务端未确认保存');
    PROJECTS[key].submissionState='submitted';
    persist();
    toast('招引需求已提交，待管理端核验与推荐企业');
  }).catch(function(error){
    if(PROJECTS[key])PROJECTS[key].submissionState='failed';
    persist();
    console.warn('[demand] sync failed:',error.message);
    toast('提交未确认：'+error.message+'；请重试（不会重复创建需求）');
  }).then(function(){delete window._demandSyncPending[key];});
}

// REPORTSTATE: 存储已生成的报告

// reportHtml: 如果已有报告，直接渲染
function reportHtml(p){
  var rs=REPORTSTATE[cur]; if(!rs) return '';
  var r=kbReadiness();

  return '<div style="border-radius:14px;border:1.5px solid #e8edf5;overflow:hidden;margin-bottom:8px">'+
    '<div style="padding:12px 16px;background:#f8faff;border-bottom:1px solid #e8edf5;display:flex;align-items:center;gap:8px">'+
      '<span style="font-size:12px;font-weight:650;color:#1a56db">📋 研判报告</span>'+
      '<span style="font-size:11.5px;color:#4a5568">'+escapeChainText(p.topic)+'</span>'+
      '<span style="margin-left:auto;font-size:11px;color:'+(rs.score>=80?'#22c55e':'#f59e0b')+'">'+topicScoreDisplay(p.topic)+'</span>'+
      '<button onclick="downloadReport(\'full\')" style="padding:4px 10px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:12px;color:#1a56db;cursor:pointer;font-weight:600;margin-left:6px">⬇ 下载</button>'+
    '</div>'+
    '<div style="padding:16px 18px;font-size:13px;color:#1e293b;line-height:1.8">'+
      reportMdToHtml(reportTextForTopic(p.topic)||'')+
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
          '<span title="仅表示材料覆盖与流程准备情况，不代表事实正确率。补充原始材料，并逐条核实待确认事项。" style="font-size:11px;color:#9aa5b5;cursor:help;text-decoration:underline dotted;margin-left:4px">ⓘ 如何提升</span>'+
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
      '<div style="font-size:11.5px;color:#8492a6;line-height:1.4">'+escapeChainText(t.desc)+'</div>'+
      (t.desc?'<span style="font-size:9px;color:#9aa6b5;margin-top:4px">原始方向摘要 · 待核</span>':'')+
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
      reportDemandActionButton(p)+
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
          '<span title="此进度只表示流程准备情况；确认操作和上传数量不能证明事实正确。" '+
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


function fullReportConfirmation(key, topic){
  var rs=REPORTSTATE[key]||{}, byTopic=rs.pendingByTopic||{};
  var items=Object.prototype.hasOwnProperty.call(byTopic,topic)?byTopic[topic]:[];
  if(Array.isArray(items) && !items.length && rs.topic===topic && (!rs.pendingByTopic || !Object.keys(byTopic).length)) items=PENDING_CONFIRMS[key]||[];
  if(!Array.isArray(items)) items=[];
  var valid=items.filter(function(x){return x && typeof x.text==='string' && x.text.trim();});
  var done=valid.filter(function(x){return x.status==='confirmed'||(x.status==='edited'&&typeof x.editedText==='string'&&x.editedText.trim());}).length;
  var draft=rs.phaseByTopic && rs.phaseByTopic[topic]===1;
  return {ready:!!draft && valid.length>0 && valid.length===items.length && done===valid.length,
    total:valid.length,done:done,items:valid,
    message:!draft?'请先生成并确认当前方向的草稿':!valid.length?'草稿缺少待确认事项，请重新生成草稿或补充材料':'请先确认当前方向剩余 '+(valid.length-done)+' 条事项'};
}


function topicReportMarkup(text){
  return typeof reportMdToHtml==='function'?reportMdToHtml(text):String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}


function reportMaterialIdentity(key,topic){
  var p=PROJECTS[key];if(!p)return null;
  var rs=REPORTSTATE[key]||{},root=p.workspaceId||key,keys=root===key?[key]:[root,key];
  function stable(v){
    if(Array.isArray(v))return v.map(stable);
    if(v&&typeof v==='object'){var out={};Object.keys(v).sort().forEach(function(k){if(v[k]!==undefined)out[k]=stable(v[k]);});return out;}
    return v;
  }
  var materials=keys.map(function(k){return {key:k,kb:(PROJECTS[k]||{}).kb||[],
    edits:typeof KB_EDITS!=='undefined'?KB_EDITS[k]||{}:{},
    chunks:typeof KB_FILE_CHUNKS!=='undefined'?KB_FILE_CHUNKS[k]||[]:[],
    uploads:typeof UPLOADS!=='undefined'?UPLOADS[k]||[]:[]};});
  return JSON.stringify(stable({workspace:root,city:p.city||'',topic:topic,requestId:p.reportRequestId||'',
    materials:materials,onboarding:p.onboarding||{},confirmations:(rs.pendingByTopic||{})[topic]||[],
    previousReport:(rs.aiReportByTopic||{})[topic]||(rs.topic===topic?rs.text:'')||''}));
}

async function reportClientFingerprint(identity){
  var provider=typeof crypto!=='undefined'?crypto:(typeof window!=='undefined'?window.crypto:null);
  if(!provider||!provider.subtle)throw new Error('当前浏览器无法校验材料版本，请使用安全连接后重试');
  var bytes=await provider.subtle.digest('SHA-256',new TextEncoder().encode(identity));
  return Array.from(new Uint8Array(bytes)).map(function(b){return ('0'+b.toString(16)).slice(-2);}).join('');
}

function reportJobForTopic(key,topic){
  return (window._topicReportProgress||{})[key+'\u0000'+topic]||null;
}

function reportRunBanner(p){
  var job=p&&reportJobForTopic(cur,p.topic);
  if(!job)return '';
  return '<div id="industryRunBanner" class="industry-run-banner" role="status" aria-live="polite">'+
    '<span class="industry-run-spinner" aria-hidden="true"></span><div><strong>'+(job.phase===2?'完整报告生成中':'初步草稿生成中')+'</strong>'+
    '<span id="industryRunMessage">'+escapeChainText(job.message||'正在准备当前方向材料…')+'</span></div></div>';
}

function refreshReportRunUi(){
  var p=P();if(!p)return;
  var job=reportJobForTopic(cur,p.topic),message=job&&job.message||'';
  ['reportRunStatus','industryRunMessage','industryBottomRunMessage','industryDetailRunMessage'].forEach(function(id){
    var el=document.getElementById(id);if(el&&job)el.textContent=message;
  });
  if(!document.querySelector)return;
  var host=document.getElementById('industryRunHost');if(host)host.innerHTML=reportRunBanner(p);
  var bar=document.querySelector('.report-bottom-bar');
  if(bar&&typeof reportBottomBarInner==='function')bar.innerHTML=reportBottomBarInner(p);
  var detail=document.querySelector('.detail-page');
  if(detail&&typeof detailReport==='function')detail.innerHTML=detailReport(p);
}

function reportSourceDate(value,withTime){
  var text=typeof value==='string'?value.trim():'';
  if(!text)return '未知';
  var parts=text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?)?$/);
  if(!parts)return text;
  var date=new Date(text),calendar=new Date(0);
  calendar.setUTCFullYear(Number(parts[1]),Number(parts[2])-1,Number(parts[3]));
  calendar.setUTCHours(0,0,0,0);
  if(!Number.isFinite(date.getTime())||calendar.getUTCFullYear()!==Number(parts[1])||calendar.getUTCMonth()!==Number(parts[2])-1||calendar.getUTCDate()!==Number(parts[3]))return text;
  if(!withTime)return parts[1]+'-'+parts[2]+'-'+parts[3];
  function pad(n){return String(n).padStart(2,'0');}
  return String(date.getFullYear()).padStart(4,'0')+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+' '+pad(date.getHours())+':'+pad(date.getMinutes());
}

function reportResearchSourcesHtml(p,key){
  key=key||cur;if(!p)return '';
  var rs=REPORTSTATE[key]||{},record=(rs.researchByTopic||{})[p.topic];
  var text=(rs.aiReportByTopic||{})[p.topic]||(rs.topic===p.topic?rs.text:'');
  if(!record||record.topic!==p.topic||record.reportText!==text||!Array.isArray(record.sources)||!record.sources.length)return '';
  var rows=record.sources.map(function(source,index){
    var url=reportSafeSourceUrl(source.url),label=escapeChainText(source.label||'S'+(index+1));
    var support={cross_checked:'交叉支持',single_source:'单源待复核'}[source.support_status]||'未核实';
    return '<li><div class="industry-source-heading"><span>'+label+'</span>'+
      (source.archived===true?'<div style="font-size:10px;color:#8294a5">公开原文库命中 · 非本次联网抓取'+(source.fulltext_scope?' · PDF摘录范围：'+escapeChainText(source.fulltext_scope):'')+'</div>':'')+
    (url?'<a href="'+escapeChainText(url)+'" target="_blank" rel="noopener noreferrer">'+escapeChainText(source.title||url)+'</a>':'<strong>'+escapeChainText(source.title||'来源未提供链接')+'</strong>')+'</div>'+
      '<div class="industry-source-date">'+(source.published_at?'发布：'+escapeChainText(reportSourceDate(source.published_at,false))+' · ':'')+
      (source.retrieved_at?'检索：'+escapeChainText(reportSourceDate(source.retrieved_at,true))+' · ':'')+support+'</div>'+
      (source.quote?'<blockquote>'+escapeChainText(source.quote)+'</blockquote>':'')+'</li>';
  }).join('');
  return '<details class="industry-sources"><summary>本次报告来源 <span>'+record.sources.length+' 条</span></summary>'+
    '<p>以下为本次生成保存的来源与摘录；来源可追溯不等于事实已核验。检索时间为本地时间。</p><ol>'+rows+'</ol></details>';
}

function reportSafeSourceUrl(value){
  if(typeof value!=='string'||/[\s<>"'\\]/.test(value))return '';
  try{var u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:'';}catch(e){return '';}
}

function reportStreamMetadataEvent(metadata,event){
  if(event.fingerprint)metadata.fingerprint=String(event.fingerprint).slice(0,256);
  if(event.clientMaterialFingerprint)metadata.clientMaterialFingerprint=String(event.clientMaterialFingerprint).slice(0,256);
  if(event.runId)metadata.runId=String(event.runId).slice(0,256);
  ['researchStatus','verificationStatus'].forEach(function(k){if(typeof event[k]==='string')metadata[k]=event[k].slice(0,100);});
  if(event.type==='research.status'&&typeof event.message==='string')metadata.message=event.message.slice(0,1000);
  if(event.type==='research.evidence'&&Array.isArray(event.sources)){
    metadata.sources=event.sources.slice(0,100).filter(function(x){return x&&typeof x==='object';}).map(function(x){
      var row={};['id','label','url','title','published_at','retrieved_at','quote','status','support_status','source_status','verification_status','source_type','source_id','origin_id','publisher_id','archive_retrieved_at','fulltext_scope','fulltext_sha256','website_attestation'].forEach(function(k){if(typeof x[k]==='string')row[k]=x[k].slice(0,k==='quote'?16000:4096);});
      if(typeof x.archived==='boolean')row.archived=x.archived;
      if(typeof x.pdf_page==='string'||typeof x.pdf_page==='number')row.pdf_page=x.pdf_page;
      if(x.website_attestation&&typeof x.website_attestation==='object'&&!Array.isArray(x.website_attestation)){
        var attestation={};['domain','website_host','evidence_id','source_id','url','website_text'].forEach(function(k){if(typeof x.website_attestation[k]==='string')attestation[k]=x.website_attestation[k].slice(0,4096);});
        if(Object.keys(attestation).length)row.website_attestation=attestation;
      }
      return row;
    });
  }
  if(event.type==='research.complete'){
    if(typeof event.status==='string')metadata.status=event.status.slice(0,100);
    if(event.checks&&typeof event.checks==='object')metadata.checks=event.checks;
    ['errors','queries','issues'].forEach(function(k){if(Array.isArray(event[k]))metadata[k]=event[k];});
    ['analysis','publicResearch'].forEach(function(k){if(event[k]&&typeof event[k]==='object')metadata[k]=JSON.parse(JSON.stringify(event[k]));});
  }
}

function viewPartialReport(){
  var p=P(), rs=REPORTSTATE[cur]||{};
  var part=p && rs.partialByTopic && rs.partialByTopic[p.topic];
  if(!part){toast('暂无未完成内容');return;}
  openModal('未完成内容 · 不作为正式报告', '<p>本次生成未完成，原正式报告已保留。</p><div>'+topicReportMarkup(part.text||'')+'</div>', '<button class="primary-button" onclick="closeModal()">关闭</button>');
}


async function readTopicReportStream(response, onText, onEvent){
  var text='', finish='', failure='', buffer='', ended=false,metadata={sources:[]};
  function line(raw){
    if(raw.indexOf('data:')!==0)return;
    var data=raw.slice(5).trim();
    if(!data)return;
    if(data==='[DONE]'){ended=true;return;}
    var event;try{event=JSON.parse(data);}catch(e){failure='响应格式不完整';return;}
    if(event.error){failure=event.error&&typeof event.error.message==='string'?event.error.message.slice(0,500):'生成服务未完成本次请求';return;}
    if(/^research\.(status|evidence|complete)$/.test(event.type||'')){
      reportStreamMetadataEvent(metadata,event);
      if(typeof onEvent==='function')onEvent(event,metadata);
    }
    if(/^chain\.(result|status)$/.test(event.type||'')&&typeof onEvent==='function')onEvent(event);
    var choice=(event.choices||[])[0]||{};
    var delta=(choice.delta||{}).content;
    if(typeof delta!=='string')delta=(choice.message||{}).content;
    if(typeof delta==='string' && delta){text+=delta;if(typeof onText==='function')onText(text);}
    if(choice.finish_reason){finish=choice.finish_reason;if(finish!=='stop')failure='生成提前结束（'+finish+'）';}
    if(event.type==='response.completed')finish='stop';
    if(event.type==='response.failed'||event.type==='response.incomplete')failure='生成未完成';
  }
  if(response.body && response.body.getReader){
    var reader=response.body.getReader(), decoder=new TextDecoder();
    try{
      while(true){var part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});var lines=buffer.split(/\r?\n/);buffer=lines.pop();lines.forEach(line);}
      buffer+=decoder.decode();if(buffer.trim())line(buffer);
    }catch(e){e.partialText=text;throw e;}
  }else{
    var raw=await response.text();
    if(raw.trim().charAt(0)==='{')line('data: '+raw);else raw.split(/\r?\n/).forEach(line);
  }
  if(failure || finish!=='stop' || !text.trim()){
    var error=new Error(failure||(!text.trim()?'服务未返回正文':'连接结束，但服务没有确认生成完成'));
    error.partialText=text;throw error;
  }
  return {text:text,finishReason:finish,transportEnded:ended,metadata:metadata};
}

async function syncTopicReportInputs(capturedSnapshot){
  if(window._syncTimer){clearTimeout(window._syncTimer);window._syncTimer=null;}
  var raw=capturedSnapshot===undefined?JSON.parse(localStorage.getItem(LS_KEY)||'{}'):capturedSnapshot;
  var snapshot=typeof _safeSyncSnapshot==='function'?_safeSyncSnapshot(raw):raw;
  var response=await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)});
  if(!response.ok)throw new Error(response.status===403?'报告基础版本已更新，请刷新后重试保存':'当前方向和确认事项尚未保存，请重试');
  var result=await response.json();
  if(!result || result.ok!==true)throw new Error('当前方向和确认事项保存未确认，请刷新后重试');
}


function isCompleteTopicReport(text){
  var pattern=/(?:^|\n)\s*#{0,3}\s*([一二三四五])[、.．][^\n]*\n/g, matches=[], match;
  while((match=pattern.exec(text))!==null)matches.push({chapter:match[1],start:match.index,end:pattern.lastIndex});
  if(matches.length!==5 || matches.map(function(m){return m.chapter;}).join('')!=='一二三四五')return false;
  return matches.every(function(m,i){return /[a-z0-9\u3400-\u9fff]/i.test(text.slice(m.end,i+1<matches.length?matches[i+1].start:text.length));});
}


function updateReportBusy(){
  window._reportGenerating=!!((window._topicReportJobs||{})[cur+'\u0000'+((P()||{}).topic||'')]);
}


function currentPendingItems(key){
  var p=PROJECTS[key],rs=REPORTSTATE[key];if(!p||!rs)return [];
  var topic=p.topic,byTopic=rs.pendingByTopic||(rs.pendingByTopic={});
  var items=byTopic[topic];
  if(!Array.isArray(items)){
    items=rs.topic===topic&&!Object.keys(byTopic).length&&Array.isArray(PENDING_CONFIRMS[key])?PENDING_CONFIRMS[key]:[];
    byTopic[topic]=items;
  }
  PENDING_CONFIRMS[key]=items;
  return items;
}


function demandReportSnapshot(key,topic){
  var rs=REPORTSTATE[key]||{}, native=nativeReportState(topic,key);
  var exactPhase=(rs.phaseByTopic||{})[topic];
  var full=native || exactPhase===2 || (exactPhase==null && rs.topic===topic && rs.phase===2);
  var text=(rs.aiReportByTopic||{})[topic] || (rs.topic===topic?rs.text:'');
  if(!full || typeof text!=='string' || !text.trim())return null;
  var copy={text:text,topic:topic,phase:2,ts:(rs.tsByTopic||{})[topic]||rs.ts||Date.now(),
    aiReportByTopic:{},phaseByTopic:{},tsByTopic:{},scoreByTopic:{},evidenceStatusByTopic:{}};
  copy.aiReportByTopic[topic]=text;copy.phaseByTopic[topic]=2;copy.tsByTopic[topic]=copy.ts;
  var directory=typeof reportMaterialDirectoryForContext==='function'?reportMaterialDirectoryForContext({key:key,project:PROJECTS[key],state:rs,topic:topic,text:text}):null;
  if(directory){copy.materialDirectoryByTopic={};copy.materialDirectoryByTopic[topic]=JSON.parse(JSON.stringify(directory));}
  copy.scoreByTopic[topic]=(rs.scoreByTopic||{})[topic];
  copy.evidenceStatusByTopic[topic]=(rs.evidenceStatusByTopic||{})[topic] || (native?'native':'unreviewed');
  if(native){['sourceReportId','scoreBasis','scoreStatus','score','sourceEngineReportId','sourceGeneration'].forEach(function(f){if(rs[f]!=null)copy[f]=rs[f];});}
  else{copy.score=null;copy.scoreByTopic[topic]=null;}
  return copy;
}


function demandSubmissionState(key){
  var p=PROJECTS[key];if(!p||!p.isDemand)return 'not_submitted';
  if(window._demandSyncPending&&window._demandSyncPending[key])return 'pending';
  if(p.submissionState==='pending'||p.submissionState==='failed')return p.submissionState;
  var rows=typeof DEMANDS!=='undefined'?DEMANDS:[];
  return rows.some(function(d){return d&&d.projKey===key;})?'submitted':'not_submitted';
}


function demandEffectiveStage(key,p){
  return demandSubmissionState(key)==='submitted'?Math.max(Number(p.stage)||1,4):(Number(p.stage)||1);
}

// Read-only presentation of submitted demands; never rewrites business stages.
function demandDisplayProject(key,p){
  if(!p)return p;
  var demandKey=p.isDemand===true?key:_findExistingDemand(p.city,p.topic);
  var demand=demandKey&&PROJECTS[demandKey];
  return demand?Object.assign({},demand,{stage:demandEffectiveStage(demandKey,demand)}):p;
}

function reportDemandActionButton(p){
  if(!p||!demandReportSnapshot(cur,p.topic))return '';
  var key=p.isDemand===true?cur:_findExistingDemand(p.city,p.topic);
  var state=key?demandSubmissionState(key):'not_submitted';
  var label=state==='submitted'?'查看已递交需求':state==='pending'?'需求正在保存':state==='failed'?'重试提交当前方向需求':'提交当前方向招商需求';
  var action=state==='submitted'?"view='home';render()":"submitDemand()";
  return '<button onclick="'+action+'"'+(state==='pending'?' disabled':'')+' style="padding:12px 16px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;font-size:13px;color:#166534;cursor:pointer;font-weight:600">'+label+'</button>';
}


function _normalizeTopic(t){
  if(!t) return '';
  return String(t).replace(/\s+/g,'')
    .replace(/(补链|升级|招引|引入|引育|培育|招商|Tier1|新能源|方向|产业)/g,'')
    .toLowerCase();
}


function _findExistingDemand(city, topic){
  if(!city || !topic) return null;
  var _nt=_normalizeTopic(topic);
  var workspace=typeof _projectWorkspaceId==='function'?_projectWorkspaceId(cur):null;
  function sameWorkspace(key){return !workspace||(typeof _authWorkspaceOf==='function'&&_authWorkspaceOf(key)===workspace);}
  // 精确匹配优先
  var exactKey=Object.keys(PROJECTS).find(function(k){
    var x=PROJECTS[k]; return x&&x.isDemand&&sameWorkspace(k)&&x.city===city&&x.topic===topic;
  });
  if(exactKey) return exactKey;
  // 规范化匹配（宽松）
  return Object.keys(PROJECTS).find(function(k){
    var x=PROJECTS[k]; return x&&x.isDemand&&sameWorkspace(k)&&x.city===city&&_normalizeTopic(x.topic)===_nt;
  }) || null;
}


function restoreActionItems(){
  var p=P();if(!p || !demandReportSnapshot(cur,p.topic))return '';
  var demandKey=p.isDemand===true?cur:_findExistingDemand(p.city,p.topic);
  var submitted=demandKey&&demandSubmissionState(demandKey)==='submitted';
  var message=submitted?'需求已递交，资源端正在开展当前方向的企业核验与推荐。':'完整研判已生成。提交后，管理端将基于当前方向核验并推荐企业。';
  return '<section style="margin-top:16px;padding:16px;border:1px solid #dbeafe;border-radius:12px;background:#f8faff"><strong>'+escapeChainText(p.topic)+'</strong><p>'+message+'报告和线索中的待核结论不代表投资意向已确认。</p>'+reportDemandActionButton(p)+'</section>';
}


function escapeChainText(value){return String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');}


function nativeReportState(topic, projKey){
  var pk=projKey||cur, p=PROJECTS[pk], st=REPORTSTATE[pk];
  if(!p||!st||!st.sourceReportId||st.sourceReportId!==p.reportRequestId
      ||(st.userGeneratedTopics&&st.userGeneratedTopics[topic])
      ||(st.evidenceStatusByTopic&&st.evidenceStatusByTopic[topic]==='unreviewed')
      ||(st.phaseByTopic&&st.phaseByTopic[topic]===1)
      ||topic!==p.topic||topic!==st.topic||st.scoreBasis!=='核验一致项比例') return null;
  return st;
}


function nativeReportScore(topic, projKey){
  var st=nativeReportState(topic,projKey);
  return st&&typeof st.score==='number'&&isFinite(st.score)&&st.score>=0&&st.score<=100 ? st.score : null;
}


function topicScoreLabel(topic, projKey){
  var st=REPORTSTATE[projKey||cur];
  if(st&&st.evidenceStatusByTopic&&st.evidenceStatusByTopic[topic]==='unreviewed')return '内容待核验';
  return nativeReportScore(topic,projKey)!==null ? '核验一致项比例' : '置信度';
}


function topicScoreDisplay(topic,key){
  var analysis=(((REPORTSTATE[key||cur]||{}).researchByTopic||{})[topic]||{}).analysis;
  if(analysis&&analysis.status==='evidence_only')return '资料摘要 · 研判依据待补';
  if(analysis&&analysis.status==='supported_analysis')return '研判已生成 · 结论待核验';
  var rs=REPORTSTATE[key||cur]||{},st=nativeReportState(topic,key),score=nativeReportScore(topic,key);
  if((rs.evidenceStatusByTopic||{})[topic]==='unreviewed')return '内容待核验';
  if(st&&st.scoreStatus==='unclassified')return '核验分类待校核';
  if(st&&(st.scoreStatus==='unavailable'||score===null))return '暂无核验结论';
  return score!==null?'核验一致项比例 '+score+'%':'内容待核验';
}

function refreshTopReliability(){persist();}
function setReportAreaHtml(area,html){if(area)area.innerHTML=html;}


function _correctChainLevel(node){
  return ['strong','mid','weak','unknown'].indexOf(node.level)>=0?node.level:'unknown';
}
/* 将 AI 返回的 chain 规范化为泳道格式 [{seg,nodes:[{name,level,note,local_leaders,benchmark}]}]。
   兼容两种结构：① 泳道数组 [{seg,nodes}] ② 扁平对象 {segments:[{name,level,...}]}。 */


function _normalizeChain(parsed){
  var segMap={'上游':[], '中游':[], '下游':[]};
  function pushNode(seg, nd){
    if(!nd||!nd.name) return;
    var node={
      name: nd.name,
      level: (nd.level==='strong'||nd.level==='mid'||nd.level==='weak')?nd.level:'unknown',
      sources: Array.isArray(nd.sources)?nd.sources:(nd.sourceRecords||[]).reduce(function(a,r){return a.concat((r.urls||[]).map(function(url){return {url:url,quote:r.quote};}));},[]),
      evidence_ids: Array.isArray(nd.evidence_ids)?nd.evidence_ids:[],
      note: nd.note||nd.level_basis||nd.basis||'',
      local_leaders: (nd.local_leaders||nd.locals||[]).map(function(e){return typeof e==='string'?e:(e&&(e.name||e.company))||'';}).filter(Boolean),
      benchmark: (nd.benchmark||nd.benchmarks||[]).map(function(e){return typeof e==='string'?e:(e&&(e.name||e.company))||'';}).filter(Boolean)
    };
    node.level=_correctChainLevel(node);
    var s=(seg||'').indexOf('上')>=0?'上游':(seg||'').indexOf('下')>=0?'下游':(seg||'').indexOf('中')>=0?'中游':null;
    if(!s){ // 扁平结构无分组：按顺序均分到上/中/下游
      s='中游';
    }
    segMap[s].push(node);
  }
  if(Array.isArray(parsed) && parsed.length && parsed[0] && parsed[0].nodes){
    // 泳道结构
    parsed.forEach(function(sg){ (sg.nodes||[]).forEach(function(nd){ pushNode(sg.seg, nd); }); });
  } else {
    // 扁平结构：{segments:[...]} 或 [{name,level,...}]
    var flat = (parsed&&parsed.segments)?parsed.segments:(Array.isArray(parsed)?parsed:[]);
    var n=flat.length;
    flat.forEach(function(nd,i){
      var seg = nd.seg || (i< Math.ceil(n/3)?'上游':i< Math.ceil(n*2/3)?'中游':'下游');
      pushNode(seg, nd);
    });
  }
  var out=[];
  ['上游','中游','下游'].forEach(function(s){ if(segMap[s].length) out.push({seg:s, nodes:segMap[s]}); });
  return out;
}
/* 鲁棒提取器：不依赖整体JSON合法（AI常输出破损JSON）。
   核心：环节名带"上游/中游/下游："前缀，据此切块，块内正则提取 level/note/企业。
   企业对象里的 "name" 不会被误当环节（因其无上/中/下游前缀）。 */


function currentEvidenceChain(topic,key){
  key=key||cur;if(typeof _chainGenInFlight!=='undefined'&&_chainGenInFlight[key+'|'+topic])return null;
  var rs=REPORTSTATE[key];if(!rs)return null;
  var meta=(rs.chainEvidenceByTopic||{})[topic],chain=(rs.chainByTopic||{})[topic],status=(rs.chainStatusByTopic||{})[topic];
  return ['ready','partial','empty'].indexOf(status)>=0&&chainEvidenceMatches(meta,key,topic)&&Array.isArray(chain)?chain:null;
}

function chainSnapshotIdentity(value){
  if(Array.isArray(value))return '['+value.map(chainSnapshotIdentity).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(function(k){return JSON.stringify(k)+':'+chainSnapshotIdentity(value[k]);}).join(',')+'}';
  return JSON.stringify(value);
}

function chainSourceIdentity(value){
  if(typeof value!=='string')return null;
  try{var parsed=JSON.parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?chainSnapshotIdentity(parsed):null;}catch(error){return null;}
}

function chainEvidenceMatches(meta,key,topic){
  var p=PROJECTS[key],rs=REPORTSTATE[key];
  if(!p||!rs||!meta||meta.contract!=='source-bound-chain-v2'||meta.scope!=='current-topic-v2'||meta.topic!==topic)return false;
  var text=(rs.aiReportByTopic||{})[topic]||(rs.topic===topic?rs.text:'');
  return meta.requestId===(p.reportRequestId||rs.reportRequestId||'')&&meta.reportText===text&&typeof meta.inputFingerprint==='string'&&!!meta.inputFingerprint&&
    chainSourceIdentity(meta.sourceIdentity)!==null&&chainSourceIdentity(meta.sourceIdentity)===chainSourceIdentity(savedEvidenceIdentity(key,topic));
}

function chainInputSnapshot(key){
  var project=PROJECTS[key],root=project.workspaceId||key,keys=root===key?[key]:[root,key];
  var snapshot={PROJECTS:{},REPORTSTATE:{},syncTs:Date.now()};
  keys.forEach(function(k){if(PROJECTS[k])snapshot.PROJECTS[k]=PROJECTS[k];if(REPORTSTATE[k])snapshot.REPORTSTATE[k]=REPORTSTATE[k];});
  var input={KB_CONFIRMS:typeof KB_CONFIRMS!=='undefined'?KB_CONFIRMS:{},KB_CONFIRM_TOMBS:typeof KB_CONFIRM_TOMBS!=='undefined'?KB_CONFIRM_TOMBS:{},KB_ITEM_TOMBS:typeof KB_ITEM_TOMBS!=='undefined'?KB_ITEM_TOMBS:{},UPLOADS:typeof UPLOADS!=='undefined'?UPLOADS:{},KB_FILE_CHUNKS:typeof KB_FILE_CHUNKS!=='undefined'?KB_FILE_CHUNKS:{},UPLOAD_TOMBS:typeof UPLOAD_TOMBS!=='undefined'?UPLOAD_TOMBS:{}};
  Object.keys(input).forEach(function(field){snapshot[field]={};keys.forEach(function(k){if(input[field][k]!==undefined)snapshot[field][k]=input[field][k];});});
  Object.keys(input.UPLOAD_TOMBS).forEach(function(k){if(keys.some(function(key){return k.indexOf(key+'::')===0;}))snapshot.UPLOAD_TOMBS[k]=input.UPLOAD_TOMBS[k];});
  if(typeof RESET_GEN!=='undefined')snapshot.RESET_GEN=RESET_GEN;
  if(typeof AUTH!=='undefined'&&AUTH&&AUTH.user)snapshot.clientUser=AUTH.user;
  snapshot=JSON.parse(JSON.stringify(snapshot));
  Object.keys(snapshot.REPORTSTATE).forEach(function(k){Object.keys(snapshot.REPORTSTATE[k]).forEach(function(field){if(/^chain/.test(field)||field==='pendingChainSaves')delete snapshot.REPORTSTATE[k][field];});});
  Object.keys(snapshot.PROJECTS).forEach(function(k){delete snapshot.PROJECTS[k].segmentLevels;});
  Object.keys(snapshot.UPLOADS).forEach(function(k){snapshot.UPLOADS[k].forEach(function(upload){if(upload&&typeof upload==='object')delete upload.dataUrl;});});
  return snapshot;
}

function generateChainFromReport(topic, reportText, city, force){
  if(!topic||!cur||!REPORTSTATE[cur])return Promise.resolve(false);
  var key=cur,rs=REPORTSTATE[key],project=PROJECTS[key],requestId=project.reportRequestId||rs.reportRequestId||'',epoch=typeof _authEpoch==='undefined'?null:_authEpoch;
  var sourceIdentity=savedEvidenceIdentity(key,topic),inflight=key+'|'+topic;
  if(_chainGenInFlight[inflight])return Promise.resolve(false);
  if(!force&&currentEvidenceChain(topic,key))return Promise.resolve(true);
  var exact=(rs.aiReportByTopic||{})[topic]||(rs.topic===topic?rs.text:'');
  if(!exact||exact.trim().length<100){rs.chainErrorByTopic=rs.chainErrorByTopic||{};rs.chainErrorByTopic[topic]='当前报告正文不足 100 字，请先完善当前方向报告后再生成图谱。';if(typeof toast==='function')toast(rs.chainErrorByTopic[topic]);return Promise.resolve(false);}
  var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},480000);
  _chainGenInFlight[inflight]={message:'正在确认当前材料已保存…'};
  function active(){return PROJECTS[key]&&savedEvidenceIdentity(key,topic)===sourceIdentity&&(PROJECTS[key].reportRequestId||REPORTSTATE[key].reportRequestId||'')===requestId&&(epoch===null||epoch===_authEpoch);}
  function show(){if(cur===key&&P()&&P().topic===topic&&view==='report')render();}
  var snapshot;
  try{snapshot=chainInputSnapshot(key);}catch(error){snapshot=null;}
  show();
  return (snapshot?syncTopicReportInputs(snapshot):Promise.reject(new Error('当前材料尚未保存，请刷新后重试。'))).then(function(){
    if(!active())throw new Error('材料或报告已更新，请重新生成图谱。');
    _chainGenInFlight[inflight].message='正在检索并整理公开原文…';show();
    return fetch(KB_API,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:controller.signal,
      body:JSON.stringify({question:'依据当前方向已保存的报告和材料生成有来源的产业链图谱；未分类项单列，禁止推断不存在的连接。',chunks:[],city:city||project.city,stream:true,mode:'chain',purpose:'chain_map',projectKey:key,topic:topic,reportRequestId:requestId||null})});
  }).then(async function(response){
    if(!response.ok){var errorBody=await response.json().catch(function(){return {};});var messages={evidence_changed:'材料已更新，请刷新后重新生成图谱。',report_changed:'报告版本已更新，请刷新后重新生成图谱。',topic_mismatch:'当前方向已更新，请刷新后重新生成图谱。',evidence_missing:'当前方向缺少可核查材料，请补充后重试。'};throw new Error(messages[errorBody.error||errorBody.code]||'图谱服务未接受请求（'+response.status+'），请稍后重试。');}
    var resultEvent=null;
    await readTopicReportStream(response,function(){},function(event){
      if(event.type==='chain.result')resultEvent=event;
      if((event.type==='chain.status'||event.type==='research.status')&&typeof event.message==='string'&&active()){_chainGenInFlight[inflight].message=event.message;show();}
    });
    if(!active())return false;
    if(!resultEvent||resultEvent.saved!==true||!Array.isArray(resultEvent.chain)||!Array.isArray(resultEvent.unclassified)||['ready','partial','empty'].indexOf(resultEvent.status)<0||!resultEvent.chain.every(function(segment){return segment&&['上游','中游','下游'].indexOf(segment.seg)>=0&&Array.isArray(segment.nodes);})||!chainEvidenceMatches(resultEvent.evidence,key,topic))throw new Error('图谱结果的材料版本未确认，请刷新后重新生成。');
    rs=REPORTSTATE[key];
    var copy=JSON.parse(JSON.stringify(resultEvent));
    rs.chainByTopic=rs.chainByTopic||{};rs.chainByTopic[topic]=copy.chain;
    rs.chainUnclassifiedByTopic=rs.chainUnclassifiedByTopic||{};rs.chainUnclassifiedByTopic[topic]=copy.unclassified;
    rs.chainEvidenceByTopic=rs.chainEvidenceByTopic||{};rs.chainEvidenceByTopic[topic]=copy.evidence;
    rs.chainStatusByTopic=rs.chainStatusByTopic||{};rs.chainStatusByTopic[topic]=copy.status;
    if(rs.chainErrorByTopic)delete rs.chainErrorByTopic[topic];
    if(rs.pendingChainSaves)delete rs.pendingChainSaves[topic];
    if(rs.chainSaveErrorByTopic)delete rs.chainSaveErrorByTopic[topic];
    try{persist();}catch(ignore){}return true;
  }).catch(function(error){
    if(!active())return false;
    rs=REPORTSTATE[key];rs.chainErrorByTopic=rs.chainErrorByTopic||{};
    rs.chainErrorByTopic[topic]=error&&error.name==='AbortError'?'图谱生成超时，已有结果已保留，请稍后重试。':error&&error.message||'图谱未完成，已有结果已保留，请稍后重试。';
    if(!chainEvidenceMatches((rs.chainEvidenceByTopic||{})[topic],key,topic)){rs.chainStatusByTopic=rs.chainStatusByTopic||{};rs.chainStatusByTopic[topic]='failed';}
    try{persist();}catch(ignore){}return false;
  }).finally(function(){clearTimeout(timer);delete _chainGenInFlight[inflight];if(epoch===null||epoch===_authEpoch)show();});
}

function requestChainGeneration(){
  var p=P();if(!p||!REPORTSTATE[cur])return Promise.resolve(false);
  return generateChainFromReport(p.topic,null,p.city,true);
}

function chainSafeSourceUrl(value){
  if(typeof value!=='string'||/[\s<>"'\\]/.test(value))return '';
  try{var parsed=new URL(value);return /^(https?:)$/.test(parsed.protocol)&&!parsed.username&&!parsed.password?parsed.href:'';}catch(error){return '';}
}

function chainNodeSources(node){
  var all=[];
  ['sources','sourceRecords','evidence'].forEach(function(field){if(Array.isArray(node[field]))all=all.concat(node[field]);});
  var seen={},rows=[];
  all.forEach(function(source){if(!source||typeof source!=='object')return;var urls=Array.isArray(source.urls)?source.urls:[source.url||source.source_url];urls=urls.map(chainSafeSourceUrl).filter(Boolean);
    var quote=typeof source.quote==='string'?source.quote:'',id=source.id||'',sig=JSON.stringify([id,urls,quote]);if(seen[sig])return;seen[sig]=true;
    rows.push({id:id,urls:urls,quote:quote,title:source.title||source.cite||'',date:source.published_at||source.date||'',retrieved:source.retrieved_at||'',archived:source.archived===true,fulltextScope:source.fulltext_scope||'',pdfPage:source.pdf_page||'',quoteRange:source.quote_range||source.excerpt_range||''});});
  return rows;
}

function chainNodeSourcesHtml(node){
  var rows=chainNodeSources(node),nature=node.negated===true?'否定或排除表述 · 待核':node.status==='planned'?'规划 / 计划 · 待核':node.status==='reported'?'材料披露 · 待核':'待核';
  return '<details class="industry-chain-sources" style="width:100%;margin-top:10px;text-align:left;font-size:11px;line-height:1.7"><summary>'+(rows.length?'查看原文与来源（'+rows.length+'）':'材料属性与待补来源')+'</summary><div class="industry-chain-source-scroll" style="max-height:320px;overflow:auto;overscroll-behavior:contain;margin-top:6px"><p style="font-size:10px;color:#8a9aa8">原始材料属性：'+nature+'</p>'+rows.map(function(row){
    return '<div style="padding:10px 0;border-top:1px solid #e2e8f0;overflow-wrap:anywhere">'+(row.title?'<strong>'+escapeChainText(row.title)+'</strong>':'')+
      (row.quote?'<blockquote style="margin:6px 0;padding-left:8px;border-left:2px solid #cbd5e1;white-space:pre-wrap">'+escapeChainText(row.quote)+'</blockquote>':'')+
      row.urls.map(function(url,index){return '<a href="'+escapeChainText(url)+'" target="_blank" rel="noopener noreferrer" style="margin-right:10px">打开来源 '+(index+1)+'</a>';}).join('')+'</div>';
  }).join('')+(!rows.length?'<p>来源待补充，当前表述尚未核实。</p>':'')+'</div></details>';
}

function actualWeaknessView(value){
  var j=value&&value.judgment;if(!value||value.contract!=='chain-assessment-v1'||!j||j.contract!=='chain-judgment-v3')return null;
  var styles={strong:{label:'已有支撑',color:'#2c7951',bg:'#eaf7ef',border:'#8aba9e',card:'#f4faf6'},mid:{label:'存在短板',color:'#8f6416',bg:'#fff4cf',border:'#d8bc69',card:'#fffcef'},weak:{label:'明显薄弱',color:'#b24738',bg:'#fdebe5',border:'#db8d7e',card:'#fff6f3'},unknown:{label:'尚不能评价',color:'#738293',bg:'#f5f7fa',border:'#cbd4de',card:'#fff'}};
  var valid=Object.prototype.hasOwnProperty.call(styles,j.level),level=valid?j.level:'unknown',s=styles[level];
  var scopes={local:'本地实际条件',local_enterprise:'关联企业风险',industry_shared:'行业共性约束'},dimensions={supply:'实际供给',dependency:'关键依赖',maturity:'工程成熟度',coordination:'配套协同'};
  var ids=Array.isArray(j.evidence_ids)?j.evidence_ids:[],facts={weak:'明显薄弱',attention:'存在短板',supported:'已有支撑',unknown:'证据不足'};
  return {available:true,judgment:valid,actual:true,reasoning:true,level:level,label:s.label,color:s.color,bg:s.bg,border:s.border,card:s.card,reason:j.reason||'',basis:j.dimension||'',basisLabel:[dimensions[j.dimension],scopes[j.scope]].filter(Boolean).join(' · '),evidenceCount:ids.filter(function(id,i){return ids.indexOf(id)===i;}).length,confidence:({high:'较高',medium:'中等',low:'较低'}[j.confidence]||''),method:'实际评价',action:j.action||'',comparison:j.comparison||'',factLabel:facts[value.level]||'尚未评价',evidence:({multiple_sources:'多源材料',single_source:'单源材料',insufficient:'待补证'}[value.evidence_strength]||'待补证')};
}

function chainAssessmentView(value){
  var actual=actualWeaknessView(value);if(actual)return actual;
  var styles={strong:{label:'已有基础',color:'#2c7951',bg:'#eaf7ef',border:'#8aba9e',card:'#f4faf6'},mid:{label:'重点培育',color:'#8f6416',bg:'#fff4cf',border:'#d8bc69',card:'#fffcef'},weak:{label:'优先补链',color:'#b24738',bg:'#fdebe5',border:'#db8d7e',card:'#fff6f3'},unknown:{label:'待研判',color:'#738293',bg:'#f5f7fa',border:'#cbd4de',card:'#fff'}};
  var factLabels={weak:'明显薄弱',attention:'存在短板',supported:'已有支撑',unknown:'证据不足'},materials={multiple_sources:'多源材料',single_source:'单源材料',insufficient:'待补证'};
  var container=value&&value.contract==='chain-assessment-v1',facts=container&&value.state==='ready';
  var judgment=container&&value.judgment&&['chain-judgment-v1','chain-judgment-v2'].indexOf(value.judgment.contract)>=0?value.judgment:null;
  var legacy={weak:'weak',attention:'weak',supported:'strong',unknown:'unknown'};
  var level=judgment?(Object.prototype.hasOwnProperty.call(styles,judgment.level)?judgment.level:'unknown'):(facts&&Object.prototype.hasOwnProperty.call(legacy,value.level)?legacy[value.level]:'unknown');
  var bases={existing_basis:'本地基础',enterprise_presence:'企业业务布局',local_constraint:'本地约束',capacity_mismatch:'供需不匹配',dependency_exposure:'依赖风险',policy_bottleneck:'政策识别的补链重点',policy_priority:'政策培育',industry_challenge:'行业挑战',insufficient:'依据待补充',aggregate:'综合研判',local_gap:'本地短板',local_capability:'本地基础',local_plan:'规划培育',industry_risk:'行业风险',insufficient:'依据待补充'};
  var style=styles[level],ids=judgment&&Array.isArray(judgment.evidence_ids)?judgment.evidence_ids.slice():[];
  if(!ids.length&&facts){(Array.isArray(value.findings)?value.findings:[]).forEach(function(row){if(row&&typeof row.evidence_id==='string')ids.push(row.evidence_id);});}
  var unique=ids.filter(function(id,index){return typeof id==='string'&&id&&ids.indexOf(id)===index;});
  return {available:!!judgment||!!facts,judgment:!!judgment&&Object.prototype.hasOwnProperty.call(styles,judgment.level),level:level,label:style.label,color:style.color,bg:style.bg,border:style.border,card:style.card,
    reason:judgment&&typeof judgment.reason==='string'?judgment.reason:facts&&typeof value.summary==='string'?value.summary:'',basis:judgment&&(judgment.rule||judgment.basis)||'',basisLabel:judgment&&(judgment.rule||judgment.basis)?(bases[judgment.rule||judgment.basis]||judgment.rule||judgment.basis):'',evidenceCount:unique.length,
    reasoning:!!judgment&&judgment.contract==='chain-judgment-v2',confidence:judgment&&({high:'较高',medium:'中等',low:'较低'}[judgment.confidence]||''),method:judgment&&judgment.method==='inference'?'分析推论':'直接依据',action:judgment&&typeof judgment.action==='string'?judgment.action:'',factLabel:facts&&Object.prototype.hasOwnProperty.call(factLabels,value.level)?factLabels[value.level]:'尚未评价',evidence:facts&&Object.prototype.hasOwnProperty.call(materials,value.evidence_strength)?materials[value.evidence_strength]:'待补证'};
}

function chainAssessmentBadge(value){
  var v=chainAssessmentView(value);
  return '<span class="chain-judgment-badge" style="display:inline-block;padding:4px 9px;border-radius:6px;background:'+v.bg+';color:'+v.color+';font-size:11px;font-weight:700;white-space:nowrap">'+v.label+'</span>'+
    (v.confidence?'<span class="chain-confidence" style="font-size:10px;color:#7e8d9b;margin-left:6px">'+v.method+' · '+v.confidence+'把握</span>':'')+
    (v.evidenceCount?'<span class="chain-source-count" style="font-size:10px;color:#8795a2;margin-left:7px;white-space:nowrap">依据 '+v.evidenceCount+' 条</span>':'');
}

function chainAssessmentDate(value,withTime){
  var text=typeof value==='string'?value.trim():'';if(!text)return '';
  var match=text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?)?$/);
  var date=new Date(text),check=new Date(0);if(!match||!Number.isFinite(date.getTime()))return text;
  check.setUTCFullYear(Number(match[1]),Number(match[2])-1,Number(match[3]));check.setUTCHours(0,0,0,0);
  if(check.getUTCFullYear()!==Number(match[1])||check.getUTCMonth()!==Number(match[2])-1||check.getUTCDate()!==Number(match[3]))return text;
  if(!withTime)return match[1]+'-'+match[2]+'-'+match[3];
  function pad(n){return String(n).padStart(2,'0');}
  return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+' '+pad(date.getHours())+':'+pad(date.getMinutes());
}

function chainAssessmentFindings(value){
  if(!value||value.contract!=='chain-assessment-v1'||value.state!=='ready')return [];
  var rows=Array.isArray(value.findings)?value.findings.slice():[];
  (Array.isArray(value.dimensions)?value.dimensions:[]).forEach(function(d){if(d&&Array.isArray(d.findings))rows=rows.concat(d.findings);});
  var seen={};return rows.filter(function(finding){if(!finding||typeof finding!=='object')return false;var id=JSON.stringify([finding.id||'',finding.target_id||'',finding.dimension||'',finding.kind||'',finding.evidence_id||'',finding.quote||'']);if(seen[id])return false;seen[id]=true;return true;});
}

function chainAssessmentFindingHtml(finding){
  var dims={supply:'本地供给',dependency:'外部依赖',capacity:'研发与产能',coordination:'产业协同'},source=finding.source&&typeof finding.source==='object'?finding.source:{};
  var scope=finding.scope==='local'?'本地':finding.scope==='industry'?'行业背景':'范围待核',scopeLabel=typeof finding.scope_label==='string'&&finding.scope_label?' · '+finding.scope_label:'';
  var quote=typeof finding.quote==='string'?finding.quote:typeof source.quote==='string'?source.quote:'';
  var url=chainSafeSourceUrl(source.url),published=chainAssessmentDate(source.published_at||source.date,false),retrieved=chainAssessmentDate(source.retrieved_at,true);
  return '<article class="chain-assessment-finding" style="padding:11px 0;border-top:1px solid #e1e8ef;overflow-wrap:anywhere"><div style="font-size:10px;color:#7b8e9f">范围：'+scope+escapeChainText(scopeLabel)+(dims[finding.dimension]?' · '+dims[finding.dimension]:'')+'</div>'+
    (quote?'<blockquote style="margin:6px 0;padding:8px 10px;border-left:2px solid #bccddd;background:#f8fafc;white-space:pre-wrap;color:#50677d">'+escapeChainText(quote)+'</blockquote>':'<p>尚缺可展示的原句。</p>')+
    (source.title?'<div style="font-size:11px;color:#657d92">'+escapeChainText(source.title)+'</div>':'')+
    '<div style="font-size:10px;color:#8294a5;margin-top:3px">发布：'+escapeChainText(published||'日期未知')+(retrieved?' · '+(source.archived===true?'原文归档：':'检索：')+escapeChainText(retrieved)+'（本地）':'')+'</div>'+
    (source.archived===true?'<div style="font-size:10px;color:#8294a5">公开原文库命中 · 非本次联网抓取'+(source.fulltext_scope?' · PDF摘录范围：'+escapeChainText(source.fulltext_scope):'')+'</div>':'')+
    (url?'<a href="'+escapeChainText(url)+'" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:5px;font-size:11px">打开原文来源</a>':'<span style="font-size:10px;color:#8294a5">来源链接待补充</span>')+'</article>';
}

function chainAssessmentDetails(value,node){
  if(!value||value.contract!=='chain-assessment-v1')return '';
  var view=chainAssessmentView(value),findings=chainAssessmentFindings(value),groups=[{key:'local_gap',label:'本地短板依据',rows:[]},{key:'local_capability',label:'本地支撑依据',rows:[]},{key:'plan',label:'规划补强 · 尚未落地',rows:[]},{key:'industry',label:'行业背景 · 不代表本地情况',rows:[]},{key:'context',label:'其他材料与范围待核',rows:[]}];
  findings.forEach(function(finding){var key=finding.kind==='plan'?'plan':finding.scope==='industry'?'industry':finding.scope==='local'&&finding.kind==='gap'?'local_gap':finding.scope==='local'&&finding.kind==='capability'?'local_capability':'context';groups.find(function(group){return group.key===key;}).rows.push(finding);});
  var summary=typeof value.summary==='string'?value.summary:'',checks=(Array.isArray(value.next_checks)?value.next_checks:[]).filter(function(text){return typeof text==='string'&&text.trim();});
  var analysis=value.judgment&&['chain-judgment-v2','chain-judgment-v3'].indexOf(value.judgment.contract)>=0?value.judgment:null;
  var premises=analysis&&Array.isArray(analysis.premises)?analysis.premises:[],limitations=analysis&&Array.isArray(analysis.limitations)?analysis.limitations:[];
  var comparisonHtml=view.actual&&view.comparison?'<p><strong>比较基准：</strong>'+escapeChainText(view.comparison)+'</p>':'';
  var counterHtml=analysis&&Array.isArray(analysis.counter_evidence)&&analysis.counter_evidence.length?'<strong>已核对的相反证据</strong>'+analysis.counter_evidence.map(chainAssessmentFindingHtml).join(''):'';
  var missingHtml=analysis&&Array.isArray(analysis.missing)&&analysis.missing.length?'<p><strong>仍缺：</strong>'+analysis.missing.map(escapeChainText).join('；')+'</p>':'';
  var analysisHtml=analysis?comparisonHtml+counterHtml+missingHtml+'<section class="chain-analysis-premises"><strong>判断依据链</strong>'+premises.map(function(p){var labels={operation:'实际生产/运营',dependency:'实际依赖',maturity:'当前工程阶段',constraint:'实际约束',benchmark:'比较基准',industry_fact:'行业事实',local_basis:'本地基础',local_presence:'企业所在地',local_affiliation:'本地企业关联',local_site:'设施所在地',enterprise_capability:'企业产品业务',local_demand:'本地需求',industry_requirement:'产业要求',policy_target:'政策目标',constraint:'约束条件'};return '<p style="margin:8px 0 0"><b>'+escapeChainText(labels[p.role]||p.role||'依据')+'</b> · '+escapeChainText(p.subject||'')+'</p>'+chainAssessmentFindingHtml(p);}).join('')+(view.action?'<p><strong>补链建议：</strong>'+escapeChainText(view.action)+'</p>':'')+(limitations.length?'<strong>判断边界</strong><ul>'+limitations.map(function(x){return '<li>'+escapeChainText(x)+'</li>';}).join('')+'</ul>':'')+'</section>':'';
  var sources=node?chainNodeSources(node):[],nature=node?(node.negated===true?'否定或排除表述':node.status==='planned'?'规划 / 计划':node.status==='reported'?'材料披露':'材料属性待核'):'';
  return '<details class="chain-assessment-details" style="margin-top:9px;font-size:11px;color:#5b7389;line-height:1.75"><summary style="cursor:pointer;font-weight:600">研判依据'+(findings.length?'（'+findings.length+'条）':'')+'</summary><div style="max-height:320px;overflow:auto;overscroll-behavior:contain;margin-top:7px">'+
    (view.reason?'<p style="margin:0 0 8px"><strong>研判建议：</strong>'+escapeChainText(view.reason)+'</p>':'')+
    analysisHtml+
    (view.basis?'<p style="margin:0 0 8px">依据类型：'+escapeChainText(view.basisLabel)+'</p>':'')+
    '<div style="font-size:10px;color:#8a9aa7;margin-bottom:6px">以引用材料对应时间为准，不代表实时认证。</div><div class="chain-fact-assessment" style="'+(view.actual?'display:none;':'')+'padding:7px 9px;border-radius:6px;background:#f4f7fa;font-size:10px">事实层评价：'+view.factLabel+' · '+view.evidence+(nature?' · '+nature:'')+'</div>'+
    (summary&&summary!==view.reason?'<p style="margin:8px 0">'+escapeChainText(summary)+'</p>':'')+
    groups.filter(function(group){return group.rows.length;}).map(function(group){return '<section class="chain-finding-group '+group.key+'"><strong style="display:block;margin-top:10px;color:#425d76">'+group.label+'</strong>'+group.rows.map(chainAssessmentFindingHtml).join('')+'</section>';}).join('')+
    (sources.length?'<section style="margin-top:10px"><strong>节点原文与来源</strong>'+sources.map(function(row){var published=chainAssessmentDate(row.date,false),retrieved=chainAssessmentDate(row.retrieved,true);return '<div style="padding:9px 0;border-top:1px solid #e3e9ee;overflow-wrap:anywhere">'+(row.title?'<strong>'+escapeChainText(row.title)+'</strong>':'')+(row.quote?'<blockquote style="margin:6px 0;padding-left:8px;border-left:2px solid #c6d2dd;white-space:pre-wrap">'+escapeChainText(row.quote)+'</blockquote>':'')+'<div style="font-size:10px;color:#8697a7">发布：'+escapeChainText(published||'日期未知')+(retrieved?' · '+(row.archived?'原文归档：':'检索：')+escapeChainText(retrieved)+'（本地）':'')+'</div>'+row.urls.map(function(url){return '<a href="'+escapeChainText(url)+'" target="_blank" rel="noopener noreferrer">打开原文来源</a>';}).join(' · ')+'</div>';}).join('')+'</section>':'')+
    (!findings.length&&!sources.length?'<p>暂无可展示的研判原句，请结合原文来源继续核对。</p>':'')+
    (checks.length?'<strong>后续核查与补证</strong><ul style="padding-left:18px;margin:5px 0">'+checks.map(function(text){return '<li>'+escapeChainText(text)+'</li>';}).join('')+'</ul>':'')+'</div></details>';
}

function chainAssessmentPanel(value,nodes,unclassifiedCount){
  var view=chainAssessmentView(value),counts={strong:0,mid:0,weak:0,unknown:0};nodes.forEach(function(node){counts[chainAssessmentView(node.assessment).level]++;});
  var dimensions=[{key:'supply',label:'本地供给'},{key:'dependency',label:'外部依赖'},{key:'capacity',label:'研发与产能'},{key:'coordination',label:'产业协同'}],received=value&&Array.isArray(value.dimensions)?value.dimensions:[];
  var distribution=(view.actual?[['weak','明显薄弱'],['mid','存在短板'],['strong','已有支撑'],['unknown','尚不能评价']]:[['weak','优先补链'],['mid','重点培育'],['strong','已有基础'],['unknown','待研判']]).map(function(item){return '<span class="chain-priority-count is-'+item[0]+'" style="display:inline-flex;gap:5px;align-items:center;font-size:11px;white-space:nowrap">'+item[1]+' <b style="font-size:13px">'+counts[item[0]]+'</b></span>';}).join('');
  var criteria='<details class="chain-assessment-criteria" style="flex:1 1 220px;min-width:0;margin-top:8px;font-size:11px;color:#687f92;line-height:1.75"><summary style="cursor:pointer;font-weight:600">三色研判口径</summary><div style="margin-top:7px;max-height:320px;overflow:auto"><ul style="padding-left:17px;margin:0"><li><strong>优先补链（红）</strong>：优先处理的补链方向，需结合依据核实约束与对接条件。</li><li><strong>重点培育（黄）</strong>：规划培育或行业风险的关注建议，不代表已确认现实缺口或中等能力。</li><li><strong>已有基础（绿）</strong>：已有能力或支撑线索，建议巩固拓展，不代表完整成熟或无风险。</li><li><strong>待研判（灰）</strong>：尚未形成有效研判，不等于薄弱，不强行归入三色。</li></ul><p style="margin:8px 0 0">三色为研判建议，非百分制，不按来源数量评分；规划与行业背景不计作已确认的本地短板。事实评价与证据质量见研判依据。</p></div></details>';
  var four='<details class="chain-factual-dimensions" style="flex:1 1 220px;min-width:0;margin-top:8px;font-size:11px;color:#687f92;line-height:1.75"><summary style="cursor:pointer;font-weight:600">四维事实评价</summary><div class="chain-assessment-dimensions" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:8px;margin-top:8px">'+dimensions.map(function(expected){var d=received.find(function(item){return item&&item.key===expected.key;}),v=d&&value&&value.contract==='chain-assessment-v1'&&value.state==='ready'?chainAssessmentView({contract:'chain-assessment-v1',state:'ready',level:d.level,evidence_strength:d.evidence_strength}):chainAssessmentView(null),label=d&&typeof d.label==='string'?d.label:expected.label;return '<div class="chain-assessment-dimension" data-dimension="'+expected.key+'" style="background:#fff;padding:9px;border:1px solid #e3eaf0;border-radius:7px"><div style="font-size:10px;color:#7a8e9f">'+escapeChainText(label)+'</div><div style="font-size:11px;margin-top:5px">'+v.factLabel+'</div><small style="color:#8a9ba9">'+v.evidence+'</small></div>';}).join('')+'</div></details>';
  if(view.actual)criteria='<details class="chain-assessment-criteria" style="margin-top:8px;font-size:11px;color:#687f92;line-height:1.75"><summary>实际薄弱程度口径</summary><p>绿色：已有真实生产、交付或在用支撑。黄色：存在已披露的具体短板或验证限制。红色：关键依赖或交付能力受到明显制约。灰色：尚不足以比较实际能力。</p><p>评价须给出具体依据和比较基准；政策支持、企业注册地址和未检索到供应商均不用于单独判色。行业共性与关联企业风险单独标注，不当作全区统一水平。</p></details>';
  var details=chainAssessmentDetails(value);
  return '<section class="chain-assessment-panel chain-priority-panel" style="margin:0 16px 14px;padding:13px 16px;border:1px solid #dfe8ef;border-radius:10px;background:#f8fbfd"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><strong style="font-size:14px;color:#294b63">'+(view.actual?'实际薄弱程度':'补链研判')+' <small style="font-size:10px;color:#8799a8;font-weight:400">'+(view.actual?'按实际能力与约束评价':'建议优先级')+'</small></strong><div>'+(view.actual&&value.judgment.status==='summary'?'逐环节评价':chainAssessmentBadge(value))+'</div></div>'+
    (view.reason?'<p class="chain-priority-reason" style="font-size:12px;line-height:1.75;color:#506d84;margin:8px 0 9px">'+escapeChainText(view.reason)+'</p>':'')+
    '<div class="chain-assessment-distribution" style="display:flex;flex-wrap:wrap;gap:8px 17px;margin-top:8px">'+distribution+'<span style="font-size:10px;color:#93a1ad">本次 '+nodes.length+' 个材料节点'+(unclassifiedCount?'（含待归类 '+unclassifiedCount+' 项）':'')+'</span></div>'+
    '<div style="font-size:10px;color:#8a9aa7;margin-top:7px">'+(view.actual?'政策提及不参与主颜色。评价范围、比较基准、原文与相反证据见各节点详情。':'黄色表示规划培育或行业风险关注，不代表已确认本地缺口。引用材料对应时间及证据质量见详情。')+'</div>'+
    ((!view.judgment||nodes.some(function(node){return !chainAssessmentView(node.assessment).judgment;}))?'<p style="font-size:10px;color:#7b8e9e;margin:8px 0 0">部分节点仍需补充深入研判。 <button class="chain-assessment-update" onclick="requestChainGeneration()" style="font-size:10px;padding:3px 7px;border:1px solid #d2dee7;border-radius:5px;color:#607f96;background:#fff">更新研判</button></p>':'')+
    '<div class="chain-assessment-explain" style="display:flex;flex-wrap:wrap;gap:0 17px;align-items:flex-start">'+(details?'<div style="flex:1 1 220px;min-width:0">'+details+'</div>':'')+criteria+(view.actual?'':four)+'</div></section>';
}

function chainNeedsAssessment(nodes,value){
  return !chainAssessmentView(value).judgment||nodes.some(function(node){return !chainAssessmentView(node.assessment).judgment;});
}

function chainNodeCardHtml(node){
  var view=chainAssessmentView(node.assessment),policyContext=view.actual&&node.assessment.judgment.policy_context&&node.assessment.judgment.policy_context.length,basisTags={local_gap:'本地短板',local_capability:'本地基础',local_plan:'规划培育',industry_risk:'行业风险'};
  var nature=view.reasoning?view.basisLabel:view.judgment&&Object.prototype.hasOwnProperty.call(basisTags,view.basis)?basisTags[view.basis]:'';
  var classification=node.classification&&typeof node.classification==='object'?node.classification:{},reason=classification.why||classification.reason;
  var exceptionReason=reason&&!/按通用.*口径分类/.test(reason)?reason:'';
  return '<div class="industry-chain-node judgment-'+view.level+'" style="align-self:start;min-width:0;background:'+view.card+';border:1px solid '+view.border+';border-top:3px solid '+view.border+';border-radius:9px;padding:13px 12px;text-align:left;overflow-wrap:anywhere">'+
    '<div class="chain-node-name" style="font-size:13px;font-weight:700;line-height:1.6;color:#304e68">'+escapeChainText(node.name||'未命名材料项')+'</div>'+
    '<div class="chain-assessment-tags" style="margin-top:7px;display:flex;flex-wrap:wrap;gap:5px">'+chainAssessmentBadge(node.assessment)+'</div>'+
    (view.reason?'<p class="chain-node-judgment-reason" title="'+escapeChainText(view.reason)+'" style="font-size:11px;color:#5c7589;line-height:1.7;margin:8px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">'+escapeChainText(view.reason)+'</p>':'')+
    (view.action?'<p class="chain-node-action" style="font-size:10px;color:#60798b;line-height:1.7;margin:6px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden"><b>建议：</b>'+escapeChainText(view.action)+'</p>':'')+
    (policyContext?'<div style="font-size:10px;color:#7c8b9b;margin-top:6px">另有政策规划材料 · 不参与判色</div>':'')+
    (nature?'<div class="chain-material-status" style="font-size:10px;color:#8d9ca9;margin-top:7px">'+nature+'</div>':'')+
    (exceptionReason?'<div style="font-size:10px;color:#8799a8;margin-top:7px">分组说明：'+escapeChainText(exceptionReason)+'</div>':'')+
    chainAssessmentDetails(node.assessment,node)+chainNodeSourcesHtml(node)+'</div>';
}

function _renderRichChain(topic, segments, recs, p, unclassified, status, evidence){
  unclassified=Array.isArray(unclassified)?unclassified:[];evidence=evidence||{};
  var nodes=[];segments.forEach(function(segment){nodes=nodes.concat(segment.nodes||[]);});nodes=nodes.concat(unclassified);
  var taxonomy=evidence.taxonomy&&typeof evidence.taxonomy==='object'?evidence.taxonomy:{};
  var h='<section class="industry-chain" style="margin-top:16px;border:1px solid #dfe7ee;border-radius:12px;overflow:hidden;background:#fff">'+
    '<div class="industry-chain-head" style="padding:16px 18px;display:flex;gap:12px;flex-wrap:wrap;border-bottom:1px solid #e2e8f0"><div><div style="font-weight:700;color:#325675">'+escapeChainText(topic)+' 产业链图谱</div>'+
    '<div style="font-size:11px;color:#64748b;margin-top:5px">'+escapeChainText(taxonomy.label||'产业环节资料分组')+'；并列展示，不代表已证实的供应或工序连接。</div></div></div>';
  if(!nodes.length)status='empty';
  else if(unclassified.length||segments.some(function(segment){return !(segment.nodes||[]).length;})||(evidence.coverage&&evidence.coverage.status==='partial'))status='partial';
  var notice=status==='empty'?'当前材料不足以形成有来源的环节图谱。请补充材料后重试；不能据此判断现实中不存在相关产业。':status==='partial'?'本次仅能整理部分环节，其余材料仍待补充或分类。':'';
  h+='<details class="industry-chain-notice" style="padding:8px 18px;margin:0;color:#8798a6;font-size:10px;line-height:1.8"><summary style="cursor:pointer">图谱范围与分类口径</summary><p style="margin:5px 0">本次资料中的代表环节，非完整行业清单。内容未独立核实；规划不代表已落地，分类不代表本地能力。'+(notice?'<br>'+notice:'')+(taxonomy.description?'<br>分类口径：'+escapeChainText(taxonomy.description):'')+'</p></details>';
  h+=chainAssessmentPanel(evidence.assessment,nodes,unclassified.length);
  var actual=chainAssessmentView(evidence.assessment).actual;
  if(actual){
    segments=segments.map(function(segment){return Object.assign({},segment,{nodes:(segment.nodes||[]).slice().sort(function(a,b){var ranks={weak:0,mid:1,strong:2,unknown:3};return ranks[chainAssessmentView(a.assessment).level]-ranks[chainAssessmentView(b.assessment).level];})});});
    if(nodes.some(function(node){return chainAssessmentView(node.assessment).level==='unknown';}))h+='<p style="margin:0 18px 10px;font-size:11px;color:#60798b">已归类的待核节点保留在对应泳道，以灰色显示；尚不能评价不等于薄弱，也不能据此推断现实缺失。</p>';
  }
  h+='<div class="industry-chain-body" style="padding:16px;display:flex;flex-direction:column;gap:14px;background:#f8fafc">';
  ['上游','中游','下游'].forEach(function(name){var segment=segments.find(function(item){return item.seg===name;})||{nodes:[]};
    h+='<div class="industry-chain-row" style="display:flex;gap:12px;align-items:stretch"><div class="industry-chain-label" style="align-self:flex-start;min-height:76px;width:44px;flex-shrink:0;padding:10px 3px;border:1px solid #dfe7ee;border-radius:7px;display:flex;align-items:center;justify-content:center"><span style="writing-mode:vertical-rl;font-size:12px;opacity:1;letter-spacing:3px">'+name+'</span></div><div class="industry-chain-nodes" style="flex:1;min-width:0;display:grid;align-items:start;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">'+
      ((segment.nodes||[]).length?segment.nodes.map(chainNodeCardHtml).join(''):'<div style="padding:18px;border:1px dashed #cbd5e1;border-radius:8px;font-size:12px;color:#64748b">资料待补：当前材料不足以说明该分组的环节，不能据此判断不存在。</div>')+'</div></div>';
  });
  if(unclassified.length)h+='<section class="industry-chain-unclassified" style="padding:14px;border:1px dashed #cbd5e1;border-radius:8px"><strong style="font-size:13px">尚未分类的材料项</strong><p style="font-size:12px;color:#64748b">现有材料不足以确定其产业环节，保留原文供核对。</p><div style="display:grid;align-items:start;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">'+unclassified.map(chainNodeCardHtml).join('')+'</div></section>';
  return h+'</div></section>';
}

/* Presentation only: layout and assessment share the same immutable evidence. */
var CHAIN_EXPLORER_UI=Object.create(null);
var CHAIN_OPEN_DRAWER=null;
function chainLayoutText(value){return typeof value==='string'?value.trim():'';}
function chainLayoutContains(text,part){return !!chainLayoutText(part)&&chainLayoutText(text).replace(/\s+/g,'').includes(chainLayoutText(part).replace(/\s+/g,''));}
function chainLayoutReviewedPremises(node){
  var view=chainAssessmentView(node.assessment),j=node.assessment&&node.assessment.judgment;
  if(!view.actual||!j||j.status!=='assessed'||view.level==='unknown')return [];
  return (Array.isArray(j.premises)?j.premises:[]).filter(function(p){
    if(!p||!p.source||!chainLayoutText(p.evidence_id)||p.source.id!==p.evidence_id||!Array.isArray(j.evidence_ids)||j.evidence_ids.indexOf(p.evidence_id)<0)return false;
    var rows=chainNodeSources({sources:[p.source]});
    return rows.length&&rows[0].urls.length&&chainLayoutText(rows[0].quote)&&chainLayoutText(p.statement)&&chainLayoutContains(rows[0].quote,p.statement)&&(!p.quote||chainLayoutContains(rows[0].quote,p.quote));
  });
}
function chainLayoutInfo(node){
  var original=chainNodeSources(node),premises=chainLayoutReviewedPremises(node),view=chainAssessmentView(node.assessment),j=node.assessment&&node.assessment.judgment;
  var assessed=!!(view.actual&&j&&j.status==='assessed'&&view.level!=='unknown'),rows=original.slice();
  premises.forEach(function(p){rows=rows.concat(chainNodeSources({sources:[p.source]}));});
  var seen=Object.create(null);
  rows=rows.filter(function(row){var key=JSON.stringify([row.id,row.urls,row.quote]);if(!row.urls.length||!chainLayoutText(row.quote)||seen[key])return false;seen[key]=true;return true;});
  var roles=['operation','maturity','dependency','constraint','industry_fact','enterprise_capability','benchmark'];
  var facts=premises.filter(function(p){return roles.indexOf(p.role)>=0&&chainLayoutContains(p.statement,node.name);}).slice().sort(function(a,b){return roles.indexOf(a.role)-roles.indexOf(b.role);});
  var companies=[],companySeen=Object.create(null);
  (assessed&&Array.isArray(j.enterprise_links)?j.enterprise_links:[]).forEach(function(link){
    if(!link||!chainLayoutText(link.company_subject)||companySeen[link.company_subject])return;
    var identityUrl=chainSafeSourceUrl(link.identity_url),businessUrl=chainSafeSourceUrl(link.business_url);if(!identityUrl||!businessUrl)return;
    var identity=premises.find(function(p){return p.evidence_id===link.presence_evidence_id&&['local_presence','local_affiliation'].indexOf(p.role)>=0&&p.subject===link.company_subject&&chainLayoutContains(p.source.quote,link.company_subject)&&chainSafeSourceUrl(p.source.url)===identityUrl;});
    var business=facts.find(function(p){return p.evidence_id===link.capability_evidence_id&&chainSafeSourceUrl(p.source.url)===businessUrl;});
    if(!identity||!business)return;
    companySeen[link.company_subject]=true;companies.push(link.company_subject);
  });
  var material=premises.filter(function(p){return roles.indexOf(p.role)>=0&&chainLayoutContains(p.source.quote,node.name);}).slice().sort(function(a,b){return roles.indexOf(a.role)-roles.indexOf(b.role);});
  var statement=(Array.isArray(node.facts)?node.facts:[]).find(function(f){return f&&f.kind==='source_statement'&&f.scope==='source_statement_only'&&chainLayoutContains(f.statement,node.name)&&rows.some(function(row){return row.id===f.evidence_id&&chainLayoutContains(row.quote,f.statement);});});
  var chosen=facts[0]||material[0],source=chosen?chainNodeSources({sources:[chosen.source]})[0]:statement?rows.find(function(row){return row.id===statement.evidence_id&&chainLayoutContains(row.quote,statement.statement);}):rows[0];
  var excerpt=chosen?(chainLayoutContains(chosen.statement,node.name)?chosen.statement:chosen.source.quote):statement?statement.statement:source?source.quote:'';
  var label=assessed?'已有现状依据':node.negated?'含否定表述':node.status==='planned'?'含规划线索':rows.length?'已收录材料':'来源尚不完整';
  var scope=assessed?({local:'本地环节 / 应用',local_enterprise:'关联企业业务 · 不代表本地产能',industry_shared:'行业共同约束 · 非本地独有'}[j.scope]||'适用范围见依据'):'材料范围待核';
  var rawLabel=node.negated?'原始材料含否定或排除表述':node.status==='planned'?'原始材料含规划表述':node.status==='reported'?'原始材料为披露记录':'原始材料属性待核';
  return {assessed:assessed,label:label,scope:scope,count:rows.length,rows:rows,original:original,companies:companies,excerpt:excerpt,date:source?chainAssessmentDate(source.date,false):'',rawLabel:rawLabel};
}
function chainExplorerKey(topic,p,evidence){
  return JSON.stringify([p&&p.id||typeof cur==='string'&&cur||'',topic,evidence.runId||evidence.generatedAt||'']);
}
function setChainExplorerMode(button,mode){
  if(mode!=='layout'&&mode!=='assessment')return;
  var root=button.closest('.chain-explorer');if(!root)return;
  var drawer=root._chainDrawer||root.querySelector('.chain-node-drawer');if(drawer&&!drawer.hidden)closeChainLayoutNode(drawer,false);
  var key=root.getAttribute('data-chain-key');if(key)CHAIN_EXPLORER_UI[key]=mode;
  root.setAttribute('data-chain-mode',mode);
  root.querySelectorAll('[data-chain-panel]').forEach(function(panel){panel.hidden=panel.getAttribute('data-chain-panel')!==mode;});
  root.querySelectorAll('[data-chain-mode-button]').forEach(function(tab){var active=tab.getAttribute('data-chain-mode-button')===mode;tab.classList.toggle('is-active',active);tab.setAttribute('aria-pressed',active?'true':'false');});
}
function openChainLayoutNode(button,index){
  var root=button.closest('.chain-explorer');if(!root||!/^\d+$/.test(String(index))||typeof document==='undefined'||!document.body)return;
  var template=root.querySelector('template[data-chain-detail="'+index+'"]'),drawer=root._chainDrawer||root.querySelector('.chain-node-drawer');
  if(!template||!drawer)return;
  if(CHAIN_OPEN_DRAWER)closeChainLayoutNode(CHAIN_OPEN_DRAWER,false);
  var content=drawer.querySelector('.chain-node-drawer-content');content.innerHTML=template.innerHTML;content.scrollTop=0;
  drawer._chainRoot=root;drawer._chainReturnFocus=button;root._chainDrawer=drawer;CHAIN_OPEN_DRAWER=drawer;
  // A body-level portal keeps fixed positioning outside transformed report containers.
  document.body.appendChild(drawer);drawer.hidden=false;
  button.setAttribute('aria-expanded','true');button.classList.add('is-selected');
  if(typeof MutationObserver!=='undefined'){
    drawer._chainObserver=new MutationObserver(function(){
      if(root.isConnected===false||button.isConnected===false)closeChainLayoutNode(drawer,false);
    });
    drawer._chainObserver.observe(document.body,{childList:true,subtree:true});
  }
  drawer.querySelector('button').focus();
}
function closeChainLayoutNode(button,restoreFocus){
  var drawer=button&&button.closest('.chain-node-drawer');if(!drawer)return;
  if(drawer._chainObserver){drawer._chainObserver.disconnect();drawer._chainObserver=null;}
  drawer.hidden=true;var trigger=drawer._chainReturnFocus,root=drawer._chainRoot;
  drawer._chainReturnFocus=null;drawer._chainRoot=null;
  if(CHAIN_OPEN_DRAWER===drawer)CHAIN_OPEN_DRAWER=null;
  if(root&&root._chainDrawer===drawer)root._chainDrawer=null;
  if(root){
    if(root.isConnected!==false&&trigger&&trigger.isConnected!==false)root.appendChild(drawer);
    else drawer.remove();
  }
  if(trigger){trigger.setAttribute('aria-expanded','false');trigger.classList.remove('is-selected');if(restoreFocus!==false&&trigger.isConnected!==false)trigger.focus();}
}
function chainLayoutExcerpt(text,name){
  if(typeof text!=='string'||!chainLayoutText(name))return '';
  var start=text.indexOf(name),end=start+name.length;
  if(start<0){
    // Only typography equivalence: retain source spelling and its original offsets.
    function fold(value){
      var out='',offset=0,starts=[],ends=[];
      for(var point of value){
        var normalized=point.normalize('NFKC').toLowerCase();
        for(var i=0;i<normalized.length;i++)if(!/\s/.test(normalized[i])){out+=normalized[i];starts.push(offset);ends.push(offset+point.length);}
        offset+=point.length;
      }
      return {text:out,starts:starts,ends:ends};
    }
    var source=fold(text),target=fold(name).text,index=target?source.text.indexOf(target):-1;
    if(index<0)return '';
    start=source.starts[index];end=source.ends[index+target.length-1];
  }
  var left=Math.max(0,start-16),right=Math.min(text.length,Math.max(left+96,end+28));
  return (left?'…':'')+text.slice(left,right)+(right<text.length?'…':'');
}
function chainLayoutNodeHtml(node,index){
  if(!chainLayoutText(node.name))return '';
  var info=chainLayoutInfo(node),excerpt=chainLayoutExcerpt(info.excerpt,node.name);
  return '<button type="button" class="chain-layout-node'+(info.assessed?'':' is-sparse')+'" onclick="openChainLayoutNode(this,'+index+')" aria-haspopup="dialog" aria-expanded="false" aria-label="查看'+escapeChainText(node.name)+'的依据">'+
    '<span class="chain-layout-node-name">'+escapeChainText(node.name)+'</span>'+
    (info.companies.length?'<span class="chain-layout-entity">关联企业：'+info.companies.map(escapeChainText).join('、')+'</span>':'')+
    (excerpt?'<span class="chain-layout-node-summary"><span class="chain-layout-quote-label">'+(excerpt===info.excerpt?'原文':'原文节选')+'</span>'+escapeChainText(excerpt)+'</span>':'')+
    '<span class="chain-layout-fact-meta"><span>'+escapeChainText(info.scope)+'</span>'+(info.date?'<span>资料日期 '+escapeChainText(info.date)+'</span>':'')+'</span>'+
    '<span class="chain-layout-node-foot"><span class="chain-layout-status">'+info.label+'</span><span class="chain-layout-evidence">'+(info.count?'原文片段 '+info.count+' 条':'查看材料状态')+' <span aria-hidden="true">↗</span></span></span></button>';
}
function chainLayoutSourceHtml(row){
  var published=chainAssessmentDate(row.date,false),retrieved=chainAssessmentDate(row.retrieved,true);
  var location=[];if(row.pdfPage)location.push('PDF 页码：'+row.pdfPage);if(row.quoteRange)location.push('摘录范围：'+row.quoteRange);
  if(row.fulltextScope)location.push('归档范围：'+(row.fulltextScope==='entire_html_visible_text'?'网页可见正文':row.fulltextScope));
  return '<article class="chain-layout-source">'+(row.title?'<h4>'+escapeChainText(row.title)+'</h4>':'')+
    '<blockquote>'+escapeChainText(row.quote)+'</blockquote><p class="chain-layout-source-meta">'+(published?'发布：'+escapeChainText(published):'发布日期未提供')+(retrieved?' · '+(row.archived?'归档：':'检索：')+escapeChainText(retrieved):'')+'</p>'+
    (location.length?'<p class="chain-layout-source-meta">'+location.map(escapeChainText).join(' · ')+'</p>':'')+
    row.urls.map(function(url){return '<a href="'+escapeChainText(url)+'" target="_blank" rel="noopener noreferrer">打开原文来源</a>';}).join(' · ')+'</article>';
}
function chainLayoutDetailHtml(node,index){
  var info=chainLayoutInfo(node),j=node.assessment&&node.assessment.judgment,missing=j&&Array.isArray(j.missing)?j.missing:[];
  var description=info.assessed?'已有资料支持此处列出的有限判断，适用地域和时间以原文为准。':'材料收录状态不代表已落地；尚不能据此判断该环节强弱或现实中不存在。';
  var incomplete=info.original.filter(function(row){return !row.urls.length||!chainLayoutText(row.quote);});
  return '<template data-chain-detail="'+index+'"><div class="chain-detail-eyebrow">环节与依据</div><h3>'+escapeChainText(node.name)+'</h3>'+
    (info.companies.length?'<p class="chain-layout-entity">关联企业：'+info.companies.map(escapeChainText).join('、')+'</p>':'')+
    '<div class="chain-detail-status">'+info.label+' · '+escapeChainText(info.scope)+'</div><p>'+description+'</p><p class="chain-layout-source-meta">'+info.rawLabel+(Array.isArray(node.qualifiers)&&node.qualifiers.length?'；原文限定：'+node.qualifiers.map(escapeChainText).join('、'):'')+'</p>'+
    '<section class="chain-layout-originals"><h4>原文与来源</h4>'+(info.rows.length?info.rows.map(chainLayoutSourceHtml).join(''):'<p>尚无同时包含有效链接和原句的来源，不能据此判断产业缺失。</p>')+'</section>'+
    (incomplete.length?'<details class="chain-layout-incomplete"><summary>来源不完整的材料片段（'+incomplete.length+'）</summary>'+incomplete.map(function(row){return '<p>'+escapeChainText(row.quote||'此记录未提供原句。')+'</p>';}).join('')+'</details>':'')+
    (missing.length?'<h4>还需补充</h4><ul>'+missing.map(function(s){return '<li>'+escapeChainText(s)+'</li>';}).join('')+'</ul>':'')+
    chainAssessmentDetails(node.assessment,node)+'</template>';
}
function chainLayoutMetaHtml(evidence,status,count,unclassifiedCount){
  var coverage=evidence.coverage&&typeof evidence.coverage==='object'?evidence.coverage:{},taxonomy=evidence.taxonomy&&typeof evidence.taxonomy==='object'?evidence.taxonomy:{};
  var partial=status==='partial'||coverage.status==='partial'||unclassifiedCount>0;
  var label=!count?'尚未形成节点':partial?'部分材料已归类':'已整理本次材料';
  var record=evidence.nodeResearch&&typeof evidence.nodeResearch==='object'?evidence.nodeResearch:null;
  var supplement=record&&(chainLayoutText(record.status)||(Array.isArray(record.batches)&&record.batches.length)||(Array.isArray(record.errors)&&record.errors.length))?record:null;
  var errors=supplement&&Array.isArray(supplement.errors)?supplement.errors:[];
  var batches=supplement&&Array.isArray(supplement.batches)?supplement.batches:[];
  var unfinished=batches.filter(function(batch){return batch&&!batch.legacy_summary&&typeof batch.status==='string'&&batch.status!=='ready';}).length;
  var incomplete=supplement&&(supplement.status!=='ready'||errors.length||unfinished);
  var research={ready:supplement?'基础检索完成':'本轮检索完成',pending:'本轮检索不完整',partial:'本轮检索不完整',failed:'本轮检索未完成',unavailable:'本轮检索未完成'}[evidence.researchStatus]||'检索状态未记录';
  var supplementLabel=supplement?(incomplete?'补充核验未完整':'补充核验完成'):'';
  if(supplement&&supplement.status==='scope_mismatch')supplementLabel+='（材料范围不一致）';
  var errorMessages=errors.map(function(error){return typeof error==='string'?error:error&&typeof error.message==='string'?error.message:error&&typeof error.code==='string'?error.code:'';}).filter(Boolean);
  var time=typeof evidence.generatedAt==='number'?new Date(evidence.generatedAt):null;
  var date=time&&Number.isFinite(time.getTime())?chainAssessmentDate(time.toISOString(),true):'';
  return '<div class="chain-layout-context"><div class="chain-layout-context-row"><strong>'+label+'</strong><span>'+research+'</span>'+(supplementLabel?'<span>'+supplementLabel+'</span>':'')+(unfinished?'<span>未完成 '+unfinished+' 组</span>':'')+(errors.length?'<span>错误记录 '+errors.length+' 条</span>':'')+(date?'<span>图谱生成：'+escapeChainText(date)+'</span>':'')+'</div>'+
    '<p>范围：当前方向、本次取得的材料；不是完整产业清单，不能据此推断现实缺失。</p>'+
    (chainLayoutText(taxonomy.description)?'<p>分类口径'+(chainLayoutText(taxonomy.label)?'（'+escapeChainText(taxonomy.label)+'）':'')+'：'+escapeChainText(taxonomy.description)+'</p>':'')+
    (chainLayoutText(coverage.meaning)?'<p>'+escapeChainText(coverage.meaning)+'</p>':'')+(errorMessages.length?'<details class="chain-layout-research-errors"><summary>查看补充核验记录</summary><ul>'+errorMessages.map(function(message){return '<li>'+escapeChainText(message)+'</li>';}).join('')+'</ul></details>':'')+'</div>';
}
function chainExplorerHtml(topic,segments,recs,p,unclassified,status,evidence){
  if(CHAIN_OPEN_DRAWER)closeChainLayoutNode(CHAIN_OPEN_DRAWER,false);
  evidence=evidence||{};unclassified=(Array.isArray(unclassified)?unclassified:[]).filter(function(n){return n&&chainLayoutText(n.name);});
  segments=(Array.isArray(segments)?segments:[]).map(function(s){return {seg:s.seg,nodes:(Array.isArray(s.nodes)?s.nodes:[]).filter(function(n){return n&&chainLayoutText(n.name);})};});
  var nodes=[];segments.forEach(function(s){nodes=nodes.concat(s.nodes);});nodes=nodes.concat(unclassified);
  var withOriginal=nodes.filter(function(n){return chainLayoutInfo(n).count>0;}).length,assessed=nodes.filter(function(n){return chainLayoutInfo(n).assessed;}).length;
  var key=chainExplorerKey(topic,p,evidence),mode=CHAIN_EXPLORER_UI[key]==='assessment'?'assessment':'layout',index=0,templates=[];
  function card(n){var id=index++;templates.push(chainLayoutDetailHtml(n,id));return chainLayoutNodeHtml(n,id);}
  var lanes=['上游','中游','下游'].map(function(name,i){var group=segments.find(function(s){return s.seg===name;})||{nodes:[]};
    return '<section class="industry-chain-row"><div class="chain-lane-heading"><span class="chain-lane-index">0'+(i+1)+'</span><h3>'+name+'</h3><span class="chain-lane-total">'+group.nodes.length+' 个环节</span></div><div class="industry-chain-nodes">'+(group.nodes.length?group.nodes.map(card).join(''):'<div class="chain-layout-empty">本次材料未形成该组节点；不代表实际不存在。</div>')+'</div></section>';
  }).join('');
  var other=unclassified.length?'<details class="chain-layout-other"><summary>待归类材料 <span>'+unclassified.length+' 项</span></summary><p>暂不放入上中下游；原文及分类依据保留供核对。</p><div class="industry-chain-nodes">'+unclassified.map(card).join('')+'</div></details>':'';
  var metric=function(value,label){return '<div class="chain-overview-metric"><strong>'+value+'</strong><span>'+label+'</span></div>';};
  return '<section class="chain-explorer" data-chain-key="'+escapeChainText(key)+'" data-chain-mode="'+mode+'" aria-label="产业链布局与评价">'+
    '<div class="chain-explorer-toolbar"><div class="chain-explorer-title"><span>INDUSTRY LANDSCAPE</span><h2>'+escapeChainText(topic)+'<small>产业链图谱</small></h2><p>查看有出处的环节记录，评价与原文分开展示。</p></div><div class="chain-view-switch" aria-label="图谱视图"><button type="button" class="'+(mode==='layout'?'is-active':'')+'" data-chain-mode-button="layout" aria-pressed="'+(mode==='layout')+'" onclick="setChainExplorerMode(this,\'layout\')">产业布局</button><button type="button" class="'+(mode==='assessment'?'is-active':'')+'" data-chain-mode-button="assessment" aria-pressed="'+(mode==='assessment')+'" onclick="setChainExplorerMode(this,\'assessment\')">薄弱评价</button></div></div>'+
    '<div class="chain-overview-metrics">'+metric(nodes.length,'已整理环节 / 线索')+metric(withOriginal,'有原文的节点')+metric(assessed,'具备评价依据')+metric(unclassified.length,'产业位置待确认')+'</div>'+
    chainLayoutMetaHtml(evidence,status,nodes.length,unclassified.length)+
    '<div class="chain-explorer-layout" data-chain-panel="layout"'+(mode==='layout'?'':' hidden')+'><div class="chain-layout-caption"><span>按产业环节组织材料</span><span>并列展示，不表示已证实的供货关系</span></div><div class="industry-chain-body">'+lanes+'</div>'+other+'</div>'+
    '<div class="chain-explorer-assessment" data-chain-panel="assessment"'+(mode==='assessment'?'':' hidden')+'>'+_renderRichChain(topic,segments,recs,p,unclassified,status,evidence)+'</div>'+
    templates.join('')+'<aside class="chain-node-drawer" role="dialog" aria-label="环节详情与原文依据" hidden onkeydown="if(event.key===\'Escape\')closeChainLayoutNode(this)"><div class="chain-node-drawer-header"><span>资料与判断分开展示</span><button type="button" class="chain-node-drawer-close" aria-label="关闭环节详情" onclick="closeChainLayoutNode(this)">×</button></div><div class="chain-node-drawer-content"></div></aside></section>';
}

function chainMapHtml(p){
  if(!p)return '';
  var topic=p.topic||'',rs=REPORTSTATE[cur]||{},job=_chainGenInFlight[(cur||'')+'|'+topic];
  if(job)return '<div role="status" aria-live="polite" style="margin-top:16px;padding:20px;border:1px dashed #cbd5e1;border-radius:12px;color:#64748b">'+escapeChainText(job.message||'正在生成产业链图谱…')+'<button disabled aria-busy="true" style="margin-left:12px">生成中…</button></div>';
  var chain=currentEvidenceChain(topic,cur),error=(rs.chainErrorByTopic||{})[topic];
  var errorHtml=error?'<p role="alert" style="color:#92400e;font-size:12px">'+escapeChainText(error)+'</p>':'';
  if(Array.isArray(chain)){var metadata=(rs.chainEvidenceByTopic||{})[topic]||{},allNodes=[];chain.forEach(function(segment){allNodes=allNodes.concat(segment.nodes||[]);});allNodes=allNodes.concat((rs.chainUnclassifiedByTopic||{})[topic]||[]);return errorHtml+(typeof chainExplorerHtml==='function'?chainExplorerHtml:_renderRichChain)(topic,chain,null,p,(rs.chainUnclassifiedByTopic||{})[topic],(rs.chainStatusByTopic||{})[topic],metadata)+'<div style="text-align:right;padding:10px 0"><button onclick="requestChainGeneration()">'+(chainNeedsAssessment(allNodes,metadata.assessment)?'更新图谱并评价':['empty','partial'].indexOf((rs.chainStatusByTopic||{})[topic])>=0?'补充材料后重新生成':'重新生成图谱')+'</button></div>'; }
  var text=typeof reportTextForTopic==='function'?reportTextForTopic(topic):'',short=!text||text.trim().length<100;
  var legacy=!!((rs.chainByTopic||{})[topic]||(rs.chainEvidenceByTopic||{})[topic]),failed=(rs.chainStatusByTopic||{})[topic]==='failed';
  return '<div style="margin-top:16px;padding:20px;border:1px dashed #cbd5e1;border-radius:12px;background:#f8fafc;color:#64748b;font-size:12px;line-height:1.8">'+errorHtml+
    '<strong>'+escapeChainText(topic)+'</strong> · '+(legacy?'材料或图谱版本已变化，请重新生成。':'尚未生成基于当前材料的图谱。')+
    '<p>依据本次公开原文检索及保存材料背景整理；计划与材料披露均不代表已经落地，没有证据的连接不会绘制。</p>'+
    (short?'<p>当前报告正文不足 100 字，请先完善当前方向报告。</p>':'<button onclick="requestChainGeneration()">'+(legacy?'重新生成图谱':error||failed?'重试生成图谱':'生成产业链图谱')+'</button>')+'</div>';
}

function deleteCustomTopic(label){
  var p=P();if(!p||!label||!confirm('确定删除自定义方向「'+label+'」？该方向下的报告与历史将一并清除。'))return;
  var stamp=topicOperationStamp(cur,label);p.topicDeletedAt=p.topicDeletedAt||{};p.topicDeletedAt[label]=stamp;
  p.deletedTopics=p.deletedTopics||[];if(p.deletedTopics.indexOf(label)<0)p.deletedTopics.push(label);
  p.customTopics=(p.customTopics||[]).filter(function(t){return t!==label;});
  if(p.aiTopics)p.aiTopics.list=(p.aiTopics.list||[]).filter(function(t){return t.label!==label;});
  var state=REPORTSTATE[cur]||(REPORTSTATE[cur]={});state.topicDeletedAt=state.topicDeletedAt||{};state.topicDeletedAt[label]=stamp;
  clearTopicReportData(cur,label);if(p.topic===label){p.topic='';p.stage=2;}
  saveReportHistory();persist();render();
}
