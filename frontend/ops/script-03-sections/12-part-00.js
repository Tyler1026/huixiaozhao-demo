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
  var rsx=(typeof REPORTSTATE!=='undefined')?REPORTSTATE[p.id]:null;
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
  var rsx=(typeof REPORTSTATE!=='undefined')?REPORTSTATE[p.id]:null;
  var text=(rsx&&rsx.text)||'';
  var gaps=[]; try{ gaps=extractGapsForScan(p); }catch(e){}
  return {text:text, gaps:gaps};
}
function opsDemandContextRequestId(key,project,report){
  var p=project||PROJECTS[key]||{},rs=report||(typeof REPORTSTATE!=='undefined'&&REPORTSTATE[key])||{};
  if(p.demandOrigin==='direct')return /^[0-9a-f]{64}$/.test(String(p.directRequestFingerprint||''))?'demand:'+p.directRequestFingerprint:'';
  return String(p.reportRequestId||rs.reportRequestId||'');
}
function savedEvidenceIdentity(key, topic, snapshot){
  var projects=snapshot?snapshot.PROJECTS||{}:PROJECTS,states=snapshot?snapshot.REPORTSTATE||{}:(typeof REPORTSTATE!=='undefined'?REPORTSTATE:{});
  var p=projects[key];if(!p)return null;
  var rs=states[key]||{},root=p.workspaceId||key,keys=root===key?[key]:[root,key];
  var input=snapshot||{KB_EDITS:typeof KB_EDITS!=='undefined'?KB_EDITS:{},KB_CONFIRMS:typeof KB_CONFIRMS!=='undefined'?KB_CONFIRMS:{},KB_CONFIRM_TOMBS:typeof KB_CONFIRM_TOMBS!=='undefined'?KB_CONFIRM_TOMBS:{},KB_ITEM_TOMBS:typeof KB_ITEM_TOMBS!=='undefined'?KB_ITEM_TOMBS:{},UPLOADS:typeof UPLOADS!=='undefined'?UPLOADS:{},KB_FILE_CHUNKS:typeof KB_FILE_CHUNKS!=='undefined'?KB_FILE_CHUNKS:{},UPLOAD_TOMBS:typeof UPLOAD_TOMBS!=='undefined'?UPLOAD_TOMBS:{}};
  function stable(v){
    if(Array.isArray(v))return v.map(stable);
    if(v&&typeof v==='object'){var out={};Object.keys(v).sort().forEach(function(k){if(v[k]!==undefined)out[k]=stable(v[k]);});return out;}
    return v;
  }
  var state={};
  [['kbEdits','KB_EDITS'],['kbConfirms','KB_CONFIRMS'],['kbConfirmTombs','KB_CONFIRM_TOMBS'],['kbItemTombs','KB_ITEM_TOMBS']].forEach(function(pair){state[pair[0]]=keys.map(function(k){return (input[pair[1]]||{})[k]||{};});});
  state.fileChunks=keys.map(function(k){return (input.KB_FILE_CHUNKS||{})[k]||[];});
  state.uploads=keys.map(function(k){return ((input.UPLOADS||{})[k]||[]).map(function(upload){if(!upload||typeof upload!=='object')return upload;var copy=Object.assign({},upload);delete copy.dataUrl;return copy;});});
  state.uploadTombs={};Object.keys(input.UPLOAD_TOMBS||{}).forEach(function(k){if(keys.some(function(key){return k.indexOf(key+'::')===0;}))state.uploadTombs[k]=input.UPLOAD_TOMBS[k];});
  return JSON.stringify(stable({schema:'saved-evidence-v2',workspace:root,city:p.city||'',topic:topic,requestId:opsDemandContextRequestId(key,p,rs),keys:keys,
    kb:keys.map(function(k){return (projects[k]||{}).kb||[];}),onboarding:keys.map(function(k){return (projects[k]||{}).onboarding||{};}),
    baseReportVersion:keys.map(function(k){var v=(projects[k]||{}).baseReportVersion;return v===undefined?null:v;}),
    report:(rs.aiReportByTopic||{})[topic]||(rs.topic===topic?rs.text:'')||'',state:state}));
}

function runAIFunnel(projKey, done, onProgress){
  var p=PROJECTS[projKey]; if(!p){ done&&done('no project'); return; }
  if(_funnelRunning[projKey])return;
  var run={},epoch=typeof _authEpoch==='number'?_authEpoch:0,requestId=opsDemandContextRequestId(projKey)||null,topic=p.topic||'';
  var sourceIdentity=savedEvidenceIdentity(projKey,topic);
  _funnelRunning[projKey]=run;
  function current(){return PROJECTS[projKey]&&(PROJECTS[projKey].topic||'')===topic&&savedEvidenceIdentity(projKey,topic)===sourceIdentity&&(typeof _authEpoch==='number'?_authEpoch:0)===epoch;}
  function release(){if(run.timeout&&typeof clearTimeout==='function')clearTimeout(run.timeout);if(_funnelRunning[projKey]===run)delete _funnelRunning[projKey];}
  var controller=typeof AbortController==='function'?new AbortController():null;
  if(controller&&typeof setTimeout==='function')run.timeout=setTimeout(function(){run.timedOut=true;controller.abort();},480000);
  var q='针对当前方向 '+topic+'，读取当前城市资料和具体需求，联网召回全国企业，目标40–50家并按AI匹配研判分排名。每家必须给出 evidence_ids。只列材料中存在的企业，不为凑数量补入常识名单。业务匹配是待核推断；没有直接投资意向证据时 score_relocate=null。';
  fetch(KB_API_OPS,{method:'POST',cache:'no-store',signal:controller?controller.signal:undefined,headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q,projectKey:projKey,topic:topic,reportRequestId:requestId,stream:true,mode:'funnel'})})
  .then(async function(resp){
    if(!resp.ok){
      var failure=await resp.json().catch(function(){return {};});
      var reasons={evidence_changed:'材料已更新',topic_changed:'当前方向已切换',topic_mismatch:'当前方向已切换',report_changed:'报告版本已更新',evidence_missing:'当前方向缺少可核查材料'};
      throw new Error(reasons[failure.error]?reasons[failure.error]+'，原候选清单已保留；请刷新后重新分析。':'分析暂未完成（'+resp.status+'），原候选清单已保留；请稍后重试。');
    }
    var result=await readTopicReportStream(resp,function(acc){if(onProgress&&current())onProgress(90,acc);},function(event){
      if(event.type!=='funnel_progress'||!PROJECTS[projKey]||(PROJECTS[projKey].topic||'')!==topic||(typeof _authEpoch==='number'?_authEpoch:0)!==epoch)return;
      var status=Object.assign({},event);
      if(!current())status.message='任务仍在执行，但需求或材料已变化；完成后请按新版本重新分析。';
      var el=document.getElementById('funnelProgPhase');if(el)el.textContent=status.message||'正在检索与排名';
      var pct={materials:5,planning:12,saving:97}[status.stage]||20;
      var fraction=status.total>0?Math.min(1,Math.max(0,(status.completed||0)/status.total)):0;
      if(status.stage==='search')pct=20+45*fraction;
      if(status.stage==='analysis')pct=65+30*fraction;
      if(onProgress)onProgress(pct,status);
    });
    if(!current())throw new Error('工作区、方向或报告版本已变化；旧响应未写入');
    var obj=_parseFunnelJson(result.text);
    if(!obj||!Array.isArray(obj.companies))throw new Error('返回结果不完整，原候选清单已保留');
    if(obj.evidence_contract!=='saved-excerpts-v1'||obj.projectKey!==projKey||obj.topic!==topic||(obj.reportRequestId||null)!==requestId)throw new Error('来源校验未通过，原候选清单已保留');
    var seen={};
    var companies=obj.companies.filter(function(c){
      var name=String(c.name||'').replace(/\s/g,'');
      if(!name||seen[name]||!Array.isArray(c.evidence)||!c.evidence.length)return false;
      seen[name]=true;return true;
    }).map(function(c,i){return Object.assign({},c,{id:c.id||_funnelClueId(projKey,c.name,i)});});
    if(obj.companies.length&&!companies.length)throw new Error('没有通过来源校验的候选，请补充材料');
    PROJECTS[projKey].funnel=Object.assign({},obj,{ts:Date.now(),total:companies.length,companies:companies,pushed:false});
    persist();release();done&&done(null,PROJECTS[projKey].funnel);
  }).catch(function(e){release();done&&done(run.timedOut?'本次连接等待超过8分钟，已停止等待并保留旧清单；请刷新后核对结果，再决定是否重试。':e&&e.message||'network');});
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

/* Source links are protocol-checked even for legacy browser cache data. */
function funnelEvidenceLinks(company){
  var urls=[], refs=Array.isArray(company.evidence)?company.evidence:[];
  refs.forEach(function(ref){(Array.isArray(ref.urls)?ref.urls:[]).forEach(function(url){
    try{var parsed=new URL(url);if((parsed.protocol==='https:'||parsed.protocol==='http:')&&!parsed.username&&urls.indexOf(parsed.href)<0)urls.push(parsed.href);}catch(_){}
  });});
  return '<div style="font-size:11px;word-break:break-all;margin-top:5px">'+(urls.length?urls.map(function(url,i){return '<a href="'+_authEscape(url)+'" target="_blank" rel="noopener noreferrer">来源 '+(i+1)+'</a>';}).join(' · '):'来源待补充')+'</div>';
}
