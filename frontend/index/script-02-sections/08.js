/* ===== ONBOARDING 招商偏好问卷（首次进入收集，日后可在设置页修改）===== */
// 每题给出合理选项；multi=可多选。答案存 PROJECTS[key].onboarding
// opts 仅作 AI 推荐失败时的通用兜底，故精简；AI 命中时以 AI 选项为主，兜底项去重后不再冗余堆叠
var ONBOARD_Q=[
  {k:'park', icon:'🏢', q:'您重点招商的产业园区是', hint:'可填园区名称，或选择类型', multi:true, allowText:true,
   opts:['国家级经开区/高新区','暂无固定园区，全域招商']},
  {k:'capacity', icon:'🏗️', q:'产业园区的承载能力为', hint:'厂房与用地供给情况', multi:true,
   opts:['有标准厂房可直接入驻','有净地可新建厂房','承载能力有限/待扩容']},
  {k:'scale', icon:'📊', q:'理想的招商企业规模为', hint:'目标企业体量', multi:true,
   opts:['行业龙头/链主企业','规上企业（年营收2000万+）','不限规模，看产业匹配度']},
  {k:'industry', icon:'🏭', q:'优先招引的产业方向为', hint:'', multi:true, allowText:true,
   opts:['先进制造/装备','现代农业/食品加工']},
  {k:'invest', icon:'💰', q:'期望的企业投资强度为', hint:'单个项目固定资产投资', multi:true,
   opts:['1亿元以上重大项目','1000万以下均可','以就业/税收为主，不设门槛']},
];
var _onbSel={};      // 当前作答缓存 {k:[选项...]}
var _onbAfter=null;  // 完成后的回调（首次=进入分析动画；设置页=仅保存）
var _onbOpts={};     // 本次问卷各题实际选项：AI 结合城市生成，回退到 ONBOARD_Q 静态
var _onbCity='';     // 本次问卷针对的城市（动态，不硬编码）
var _onbCanClose=false; // 本次问卷是否允许关闭：设置页修改=true(不论是否已填写过)；首次建项目=false(必须作答才能建项目)

// 取当前城市：优先账号绑定，其次当前项目，最后传入参数
function _resolveOnbCity(explicit){
  if(explicit) return explicit;
  if(typeof AUTH!=='undefined' && AUTH && AUTH.city) return AUTH.city;
  if(typeof cur!=='undefined' && cur && typeof PROJECTS!=='undefined' && PROJECTS[cur] && PROJECTS[cur].city) return PROJECTS[cur].city;
  return '';
}
// 重置各题选项为静态兜底
function _resetOnbOpts(){ _onbOpts={}; ONBOARD_Q.forEach(function(it){ _onbOpts[it.k]=it.opts.slice(); }); }

function openOnboarding(existing, afterFn, city, canClose){
  _onbSel={}; _onbAfter=afterFn||null;
  // 【2026-09-17】关闭权限与"是否已填写过"解耦：旧代码用 !!existing 兼作关闭条件，
  // 导致设置页首次「去填写」进来没有 ✕、无法退出。显式传入 canClose 决定。
  _onbCanClose=!!canClose;
  _onbCity=_resolveOnbCity(city);
  _resetOnbOpts();
  // 预填已有答案（设置页修改场景）
  ONBOARD_Q.forEach(function(item){
    var v=existing&&existing[item.k];
    _onbSel[item.k]=v?(Array.isArray(v)?v.slice():[v]):[];
  });
  var host=document.getElementById('onbModalHost')||(function(){var d=document.createElement('div');d.id='onbModalHost';document.body.appendChild(d);return d;})();
  host.innerHTML=onboardingModalHtml(!!existing);
  // 先拉 AI 结合城市生成的推荐选项，生成后再显示整个问卷；失败/超时回退静态
  // 允许关闭时：绑定 ESC，并支持点击遮罩空白处关闭（与站内其它弹窗一致）
  if(_onbCanClose){
    try{ document.removeEventListener('keydown', _onbEscHandler); }catch(_){}
    document.addEventListener('keydown', _onbEscHandler);
    try{
      var _lay=document.getElementById('onbLayer');
      if(_lay) _lay.addEventListener('mousedown', function(ev){ if(ev.target===_lay) closeOnboarding(); });
    }catch(_){}
  }
  fetchOnbRecommend(_onbCity);
}
// 向后端请求"结合城市实情"的推荐选项（mode=onboard_options，走 flash+联网）
function fetchOnbRecommend(city){
  var body=document.getElementById('onbBody');
  var submitBtn=document.getElementById('onbSubmitBtn');
  if(!city){ renderOnbBody(); return; }   // 无城市：直接用静态选项
  if(body) body.innerHTML=onbLoadingHtml(city);
  if(submitBtn){ submitBtn.disabled=true; submitBtn.style.opacity='.5'; }
  var corpus=[];
  try{ if(typeof buildKBCorpus==='function'){ corpus=kbSearch(city+' 产业 园区 企业规模 投资', buildKBCorpus(city), 8)||[]; } }catch(e){}
  var done=false;
  function finish(txt){ if(done)return; done=true; clearTimeout(to); if(txt)applyOnbRecommend(txt); renderOnbBody(); enableOnbSubmit(); }
  var to=setTimeout(function(){ finish(''); }, 90000); // 90s 兜底
  // 流式：首字节尽早到达，避免网关/浏览器长请求超时；累积完整 SSE 文本后再解析 JSON
  fetch('/api/kb-chat',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question:'为'+city+'生成招商偏好问卷推荐选项', chunks:corpus, city:city, mode:'onboard_options', stream:true})})
    .then(function(resp){
      if(!resp.ok||!resp.body){ throw new Error('HTTP '+resp.status); }
      var reader=resp.body.getReader(), dec=new TextDecoder(), buf='', acc='';
      function pump(){
        return reader.read().then(function(r){
          if(r.done){ finish(acc); return; }
          buf+=dec.decode(r.value,{stream:true});
          var lines=buf.split('\n'); buf=lines.pop();
          lines.forEach(function(line){
            line=line.trim(); if(line.indexOf('data:')!==0)return;
            var d=line.slice(5).trim(); if(!d||d==='[DONE]')return;
            try{ var j=JSON.parse(d); var delta=((j.choices||[{}])[0].delta||{}).content||''; if(delta)acc+=delta; }catch(e){}
          });
          return pump();
        });
      }
      return pump();
    })
    .catch(function(e){ finish(''); });
}
function enableOnbSubmit(){ var b=document.getElementById('onbSubmitBtn'); if(b){ b.disabled=false; b.style.opacity='1'; } }
// 解析 AI 返回的 JSON，把推荐选项并入 _onbOpts（推荐项置顶；静态兜底项去重保留在后）
function applyOnbRecommend(txt){
  if(!txt) return;
  var jsonStr=txt.replace(/```json/gi,'').replace(/```/g,'').trim();
  var m=jsonStr.match(/\{[\s\S]*\}/); if(m)jsonStr=m[0];
  var obj=null; try{ obj=JSON.parse(jsonStr); }catch(e){ return; }
  ONBOARD_Q.forEach(function(it){
    var rec=obj[it.k];
    if(Array.isArray(rec) && rec.length){
      var clean=rec.map(function(x){return String(x).trim();}).filter(Boolean).slice(0,6);
      // AI 命中时以推荐项为主，仅补 1 个"兜底/无门槛"通用项（取静态列表最后一项），不再堆叠全部静态项
      var merged=clean.slice();
      var optOut=it.opts[it.opts.length-1];
      if(optOut && merged.indexOf(optOut)<0) merged.push(optOut);
      _onbOpts[it.k]=merged;
      _onbRecSet[it.k]=clean;   // 记录哪些是 AI 推荐，渲染时打⭐
    }
  });
}
var _onbRecSet={};  // {k:[被AI推荐的选项...]}
function onbLoadingHtml(city){
  return '<div style="text-align:center;padding:46px 20px">'+
    '<div class="gov-spin" style="width:26px;height:26px;border-width:3px;margin:0 auto 16px"></div>'+
    '<div style="font-size:14px;font-weight:650;color:#0b183b;margin-bottom:6px">正在结合「'+city+'」实情生成推荐选项…</div>'+
    '<div style="font-size:12px;color:#8492a6;line-height:1.6">AI 正在读取该市城市智库与公开信息，<br>为您预填贴合本地的园区与产业方向</div></div>';
}
function onboardingModalHtml(isEdit){
  return '<div class="modal-layer" id="onbLayer" style="z-index:200">'+
    '<div class="modal" style="width:min(600px,100%)">'+
      '<header><div><span class="eyebrow">ONBOARDING</span><h2 style="margin:2px 0 0">'+(isEdit?'修改招商偏好':'先了解您的招商偏好')+'</h2></div>'+
        (_onbCanClose?'<button onclick="closeOnboarding()" aria-label="关闭" title="关闭（不保存）">✕</button>':'')+'</header>'+
      '<div class="modal-body" id="onbBody"></div>'+
      '<footer><small style="margin-right:auto;color:#8492a6;font-size:11px;padding-left:2px">这些偏好会指导 AI 的招商研判，稍后可在「设置」中随时修改</small>'+
        '<button class="primary-button" id="onbSubmitBtn" onclick="submitOnboarding()" style="min-width:130px">'+(isEdit?'保存修改':'开始分析 →')+'</button></footer>'+
    '</div></div>';
}
function renderOnbBody(){
  var el=document.getElementById('onbBody'); if(!el)return;
  el.innerHTML=ONBOARD_Q.map(function(item,qi){
    var sel=_onbSel[item.k]||[];
    var opts=(_onbOpts[item.k]&&_onbOpts[item.k].length)?_onbOpts[item.k]:item.opts;
    var recSet=_onbRecSet[item.k]||[];
    var chips=opts.map(function(o){
      var on=sel.indexOf(o)>=0;
      var rec=recSet.indexOf(o)>=0;
      return '<button type="button" onclick="toggleOnb('+qi+',\''+o.replace(/'/g,"\\'")+'\')" '+
        'style="text-align:left;padding:9px 13px;border:1.5px solid '+(on?'#1a56db':(rec?'#f0d99a':'#e3ebf6'))+';border-radius:9px;'+
        'background:'+(on?'#eef3ff':(rec?'#fffdf5':'#fff'))+';color:'+(on?'#1a3fae':'#40506a')+';font-size:13px;font-weight:'+(on?'650':'500')+';cursor:pointer;transition:all .12s">'+
        (on?'✓ ':(rec?'<span title="AI 结合本地推荐" style="color:#e0a516">★ </span>':''))+o+'</button>';
    }).join('');
    var custom=item.allowText?('<input id="onbTxt'+qi+'" placeholder="或补充说明…" value="'+(_onbCustom(item.k)||'')+'" '+
      'oninput="setOnbCustom(\''+item.k+'\',this.value)" '+
      'style="margin-top:8px;width:100%;padding:8px 11px;border:1px solid #e3ebf6;border-radius:8px;font-size:12.5px;box-sizing:border-box;outline:none">'):'';
    return '<div style="margin-bottom:'+(qi===ONBOARD_Q.length-1?'4':'22')+'px">'+
      '<div style="font-size:14px;font-weight:680;color:#0b183b;margin-bottom:3px">'+item.icon+' '+(qi+1)+'. '+item.q+
        (item.multi?'<span style="font-size:11px;font-weight:500;color:#8492a6"> · 可多选</span>':'')+'</div>'+
      '<div style="font-size:11.5px;color:#9aa5b5;margin-bottom:9px">'+item.hint+'</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+chips+'</div>'+custom+'</div>';
  }).join('');
}
// 自定义文本单独存 _onbSel[k+'__txt']
function _onbCustom(k){ return _onbSel[k+'__txt']||''; }
function setOnbCustom(k,v){ _onbSel[k+'__txt']=v; }
function toggleOnb(qi,opt){
  var item=ONBOARD_Q[qi]; var arr=_onbSel[item.k]||[];
  var i=arr.indexOf(opt);
  if(item.multi){ if(i>=0)arr.splice(i,1); else arr.push(opt); }
  else { arr=(i>=0)?[]:[opt]; }  // 单选：再点取消
  _onbSel[item.k]=arr; renderOnbBody();
}
function collectOnboarding(){
  var out={ts:Date.now()}; var custom={};
  ONBOARD_Q.forEach(function(item){
    var arr=(_onbSel[item.k]||[]).slice();
    var txt=(_onbSel[item.k+'__txt']||'').trim();
    if(txt){ arr.push(txt); custom[item.k]=txt; }   // 记录自定义文本（用于后续分析最高优先级强调）
    out[item.k]=item.multi?arr:(arr.join('，'));
  });
  out.__custom=custom;   // 用户自定义输入单独留存
  return out;
}
function closeOnboarding(){
  // 不允许关闭的场景（首次建项目必须作答）直接忽略，防止 ESC/遮罩绕过
  if(!_onbCanClose) return;
  var h=document.getElementById('onbModalHost'); if(h)h.innerHTML='';
  try{ document.removeEventListener('keydown', _onbEscHandler); }catch(_){}
}
// ESC 关闭（仅在允许关闭时生效）
function _onbEscHandler(e){
  if(e && (e.key==='Escape'||e.keyCode===27)){ closeOnboarding(); }
}
function submitOnboarding(){
  var ans=collectOnboarding();
  var after=_onbAfter;
  _onbCanClose=true; closeOnboarding();   // 提交是正常出口，不受关闭守卫限制
  if(typeof after==='function') after(ans);
}
// 招商偏好答案 → 可读文本（设置页展示 + 注入研判上下文）
function onboardingToText(ob){
  if(!ob)return '';
  return ONBOARD_Q.map(function(item){
    var v=ob[item.k]; if(!v||(Array.isArray(v)&&!v.length))return null;
    return '· '+item.q+'：'+(Array.isArray(v)?v.join('、'):v);
  }).filter(Boolean).join('\n');
}
// 招商偏好 → 传给后端的 prefs：options=全部偏好文本；custom=用户自定义输入(最高优先级)
function onboardingPrefs(ob){
  if(!ob)return null;
  var options=onboardingToText(ob);
  var cus=[];
  var cmap=ob.__custom||{};
  ONBOARD_Q.forEach(function(item){
    var t=cmap[item.k];
    if(t) cus.push('· '+item.q+'：'+t);
  });
  if(!options && !cus.length) return null;
  return {options:options, custom:cus.join('\n')};
}
// 取当前项目的 prefs（供各分析调用统一使用）
function curOnbPrefs(){
  try{ var p=(typeof P==='function')?P():PROJECTS[cur]; return p?onboardingPrefs(p.onboarding):null; }catch(e){ return null; }
}

/* 创建项目：先做招商偏好问卷 → 再进入分析动画 */
function createProject(){
  var _locked=(location.search.indexOf('demo')<0 && AUTH && AUTH.city);
  var city=_locked?AUTH.city:((document.getElementById('setupCity')||{}).value);
  if(!city||!city.trim())return;
  city=city.trim();
  // 首次进入：先弹招商偏好问卷（AI 结合该城市生成推荐选项），作答后再建项目+跑动画
  openOnboarding(null, function(ans){
    _startProjectAnalysis(city, ans);
  }, city);
}
/* 问卷完成后：构建项目骨架（含 onboarding 偏好）→ 进入分析动画 */
function _startProjectAnalysis(city, onboardingAns){
  var fileName=_setupFiles&&_setupFiles.length?_setupFiles.map(function(f){return f.name;}).join('、'):null;

  // 渲染分析动画页
  var wrap=document.getElementById('onboardingWrap')||document.getElementById('root');
  if(wrap)wrap.outerHTML='<div id="root"><div style="min-height:100vh;background:linear-gradient(135deg,#f0f4ff 0%,#fafbff 60%,#f5f0ff 100%)">'+analysisPage(city,fileName)+'</div></div>';

  // 构建项目骨架
  var key='p'+Date.now().toString(36);
  PROJECTS[key]={
    id:key, workspaceId:_projectWorkspaceId(cur), city:city, org:city+'市招商局', who:'负责人', topic:city+'产业链招引', stage:1,
    kb:[
      {icon:'🏭',t:'主导产业与产业链',sub:'分析中',tag:'公开信息',known:[],calls:['城市公开信息','产业链图谱']},
      {icon:'🏢',t:'园区与承载条件',sub:'分析中',tag:'公开信息',known:[],calls:['园区基础资料','政府官网']},
      {icon:'🏗️',t:'链主与存量企业',sub:'分析中',tag:'公开信息',known:[],calls:['企业名录','工商信息']},
      {icon:'📜',t:'政策、规划与领导关注',sub:'分析中',tag:'公开信息',known:[],calls:['政府工作报告','领导发言']}
    ],
    onboarding: onboardingAns||null,   // 招商偏好画像（首次问卷收集，设置页可改）
    report:null, clues:[]
  };
  cur=key;
  DEMANDS.push({id:'d'+key,city:city,gov:city+'市招商局·负责人',topic:city+'产业链招引',domain:'待确认',need:'待分析',submit:'刚刚',res:'none',resLabel:'待研判',clues:0,note:'',ai:''});
  persist();

  // 真正摄取 onboarding 阶段上传的文件（读取内容→切片→入库），修复"0个来源已扫描"
  if(_setupFiles&&_setupFiles.length){ ingestSetupFiles(_setupFiles, key); }

  // 启动动画，动画结束后自动进入（autoEnter=true 时跳过按钮）
  runAnalysisAnim(city, fileName, 0, null);
}

/* onboarding 阶段上传文件的真实摄取：读取内容→切片→写入 KB_FILE_CHUNKS/UPLOADS */
function ingestSetupFiles(files, projKey){
  var p=PROJECTS[projKey]; if(!p) return;
  if(!KB_FILE_CHUNKS[projKey]) KB_FILE_CHUNKS[projKey]=[];
  if(!UPLOADS[projKey]) UPLOADS[projKey]=[];
  files.forEach(function(file){
    var isDocx=/\.docx?$/i.test(file.name);
    var isPdf=/\.pdf$/i.test(file.name);
    var canRead=/\.(txt|md|csv|json)$/i.test(file.name);
    if(isPdf){
      // 建库阶段同样真解析 PDF（走服务端），此前与智库入口一样只登记文件名
      var _ep={name:file.name,size:file.size,ts:Date.now(),chunks:0,kbIdx:null,pending:true};
      UPLOADS[projKey].push(_ep);persist();
      extractDocTextViaServer(file).then(function(txt){
        txt=(txt||'').trim();
        if(txt.length<30){
          _ep.pending=false; _ep.parseFailed='未提取到有效文字（可能是扫描件）';
        } else {
          var cks=textToChunks(txt,file.name,p,null);
          KB_FILE_CHUNKS[projKey]=KB_FILE_CHUNKS[projKey].concat(cks);
          _ep.chunks=cks.length; _ep.pending=false;
        }
        persist();
        if(typeof render==='function')try{render();}catch(_){}
      }).catch(function(err){
        _ep.pending=false; _ep.parseFailed=(err&&err.message)||'PDF 解析失败'; persist();
        if(typeof render==='function')try{render();}catch(_){}
      });
    } else if(isDocx && typeof mammoth!=='undefined'){
      var _e2={name:file.name,size:file.size,ts:Date.now(),chunks:0,kbIdx:null,pending:true};
      UPLOADS[projKey].push(_e2);persist();
      var _r2=new FileReader();
      _r2.onload=function(ev){
        mammoth.extractRawText({arrayBuffer:ev.target.result}).then(function(res){
          var cks=textToChunks(res.value||'',file.name,p,null);
          KB_FILE_CHUNKS[projKey]=KB_FILE_CHUNKS[projKey].concat(cks);
          _e2.chunks=cks.length;_e2.pending=false;persist();
          if(typeof render==='function')try{render();}catch(_){}
        }).catch(function(){_e2.pending=false;persist();});
      };
      _r2.readAsArrayBuffer(file);
    } else if(canRead){
      // 先同步登记 pending 条目：FileReader 异步，若等 onload 才入库，动画结束渲染侧栏时 UPLOADS 还是空 → 显示"0份材料"
      var entry={name:file.name, size:file.size, ts:Date.now(), chunks:0, kbIdx:null, pending:true};
      UPLOADS[projKey].push(entry);
      persist();
      var reader=new FileReader();
      reader.onload=function(e){
        var chunks=textToChunks(e.target.result||'', file.name, p, null);
        KB_FILE_CHUNKS[projKey]=KB_FILE_CHUNKS[projKey].concat(chunks);
        // 回填已登记的 pending 条目，避免重复计数
        entry.chunks=chunks.length; entry.pending=false;
        persist();
        if(typeof render==='function') try{ render(); }catch(_){}
        console.log('[setup-ingest] '+file.name+' → '+chunks.length+' chunks');
      };
      reader.readAsText(file,'utf-8');
    } else {
      // 【2026-09-21】不再写入「用户已上传文件…」伪片段：chunks 记 0 并标注原因，
      //   界面显示「未解析」而不是假装有 1 个片段。
      UPLOADS[projKey].push({name:file.name, size:file.size, ts:Date.now(), chunks:0, kbIdx:null,
        parseFailed:'暂不支持该格式的正文解析（当前支持 pdf / docx / txt / md / csv / json）'});
      persist();
    }
  });
}

/* 点击「进入工作区」按钮时调用 */

/* 根据城市名生成城市智库四大主题的核心结论（公开信息初判） */
var TOPIC_REPORTS={}; /* 移除硬编码预设报告：所有报告由AI实时生成 */
/* 预埋报告（兜底）：仅当无 AI 生成报告时使用 */
function getEmbeddedReport(topic){ return null; } /* 不再有预埋报告兜底 */
/* 报告文本获取：AI 生成为主（aiReportByTopic 缓存），预埋兜底。
   这样默认/预埋方向也走真实 RAG+AI 生成的报告，AI 尚未就绪时先用预埋文本占位，
   后台 ensureAiReport 生成完成后自动替换。 */
function getTopicReport(topic){
  if(!topic) return null;
  if(cur && REPORTSTATE[cur] && REPORTSTATE[cur].aiReportByTopic){
    var _ai=REPORTSTATE[cur].aiReportByTopic[topic];
    if(_ai && _ai.length) return _ai;
  }
  return getEmbeddedReport(topic);
}

/* 取某方向的最佳报告文本：AI/预埋 → 当前已生成报告(topic匹配) → 历史报告(topic匹配)。
   均无则返回 null（表示该方向尚未生成过任何报告，报告区应显示空状态而非沿用旧方向报告）。*/
function reportTextForTopic(topic){
  if(!topic) return null;
  var _t=getTopicReport(topic);
  if(_t && _t.length) return _t;
  /* 移除全局 text fallback：rs.text 是单例，切方向后会残留旧方向报告导致串显 */
  if(cur && typeof REPORT_HISTORY!=='undefined' && REPORT_HISTORY[cur]){
    var _h=REPORT_HISTORY[cur].filter(function(h){return h && h.topic===topic && h.text;});
    if(_h.length) return _h[0].text;
  }
  return null;
}

/* 判断“当前方向”是否已生成过完整报告（用于底部按钮文案：产业智能分析 vs 重新产业分析）。
   注意：REPORTSTATE[cur].phase 是项目级的，切到新方向不会重置，不能拿它判断当前方向。
   这里改为按 topic 判断——只有该方向的历史报告存在完整报告(phase===2)，或当前 REPORTSTATE
   正指向该方向且为完整报告，才算“已分析过”。*/
function topicHasFullReport(topic){
  if(!topic || !cur) return false;
  var _rs=REPORTSTATE[cur];
  // 方向级 phase 是权威判据（项目级 phase 是单例，切方向会污染）
  if(_rs && _rs.phaseByTopic && _rs.phaseByTopic[topic]===2) return true;
  // 兼容旧数据：无 phaseByTopic 记录时，回退到历史报告里该方向的完整报告
  if(typeof REPORT_HISTORY!=='undefined' && REPORT_HISTORY[cur]){
    if(REPORT_HISTORY[cur].some(function(h){return h && h.topic===topic && h.phase===2 && h.text;})) return true;
  }
  // 兼容旧数据兜底：该方向有 AI 报告缓存文本（修复前生成的方向 phaseByTopic 为空），视为已生成完整报告
  if(_rs && _rs.aiReportByTopic && typeof _rs.aiReportByTopic[topic]==='string' && _rs.aiReportByTopic[topic].length>800) return true;
  return false;
}

/* 后台从 RAG 库生成该方向的 AI 报告（非阻塞，静默）。
   完成后写入 REPORTSTATE[cur].aiReportByTopic[topic] 并刷新报告区。
   路演稳定性：AI 未就绪/失败时页面继续用预埋文本，用户无感知。 */
var _aiReportGenerating = {};
function ensureAiReport(topic, city){
  // 禁止后台静默生成报告：报告只能由用户手动点击「产业智能分析」/「生成完整报告」触发
  return;
  var key=cur+'::'+topic;
  if(_aiReportGenerating[key]) return;
  // 已有 AI 报告则不重复生成
  if(REPORTSTATE[cur].aiReportByTopic && REPORTSTATE[cur].aiReportByTopic[topic]) return;
  // 关键修复：只为「已有报告基础」的方向做后台刷新（预埋报告 / 用户已显式生成过）。
  // 自定义新方向没有任何基础时，绝不自动生成——报告只能由用户点击「产业智能分析」按需生成，
  // 彻底杜绝"刷新后凭空冒出一份报告"。
  var _hasBasis = !!getEmbeddedReport(topic)
    || (REPORTSTATE[cur].userGeneratedTopics && REPORTSTATE[cur].userGeneratedTopics[topic]);
  if(!_hasBasis) return;
  city = city || (P()&&P().city) || '随州';
  var corpus, chunks;
  try {
    corpus=buildKBCorpus(city);
    var q=(topic)+' 产业基础 产业链缺口 补链优先级 目标企业 待确认事项';
    chunks=kbSearch(q, corpus, 8);
  } catch(e){ return; }
  // 无任何 RAG 片段则不生成（避免空跑；保留预埋兜底）
  if(!chunks || !chunks.length) return;
  _aiReportGenerating[key]=true;
  var fullQuery='请基于'+city+'城市智库数据，针对「'+topic+'」方向，输出完整招商研判报告，严格按五章结构：\n一、产业基础判断（具体数字，来自知识片段）\n二、产业链缺口分析（逐环节标注✅已有/⚠️薄弱/❌缺失，标注本地化属性A必须本地化/B可跨区域/C优先本地化）\n三、补链优先级清单TOP5（表格格式：缺口节点|本地化属性|经济拉动★|招引可行性★|综合优先级）\n四、目标企业画像（每个TOP缺口：目标企业类型+规模+开口话术模板）\n五、待确认事项（⚠️标注每条需确认的专项资金/园区地块/政策口径）';
  // 改流式：mode=full 生成需 60~90s，非流式会被 Railway 网关(~60s)判超时→502。
  // 走 SSE 立即吐首字节喂活网关计时器，永不超时；累积 accText 后按原逻辑落地。
  fetch('/api/kb-chat',{
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question:fullQuery, chunks:chunks, city:city, mode:'full', stream:true, prefs:curOnbPrefs()})
  }).then(function(resp){
    if(!resp.ok || !resp.body) throw new Error('HTTP '+resp.status);
    var reader=resp.body.getReader(), decoder=new TextDecoder(), buf='', accText='';
    function done(){
      var txt=accText;
      if(!txt || txt.length<80) return;  // 生成失败/过短：保留预埋兜底
      if(!REPORTSTATE[cur].aiReportByTopic) REPORTSTATE[cur].aiReportByTopic={};
      REPORTSTATE[cur].aiReportByTopic[topic]=txt;
      // 当前正显示该方向：同步替换正文
      var _p=P();
      if(_p && _p.topic===topic){
        REPORTSTATE[cur].text=txt;
        REPORTSTATE[cur].topic=topic;
      }
      persist();
      /* 不再从ensureAiReport触发render()，避免打断用户操作导致方向跳转 */
    }
    function pump(){
      return reader.read().then(function(d){
        if(d.done){ done(); return; }
        buf+=decoder.decode(d.value,{stream:true});
        var lines2=buf.split('\n'); buf=lines2.pop();
        lines2.forEach(function(line){
          if(!line.startsWith('data:')) return;
          var d2=line.slice(5).trim(); if(d2==='[DONE]') return;
          try{
            var j=JSON.parse(d2);
            var delta=j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content||'';
            if(delta) accText+=delta;
          }catch(e){}
        });
        return pump();
      });
    }
    return pump();
  }).catch(function(e){
    console.warn('ensureAiReport failed:', e && e.message);
  }).finally(function(){
    _aiReportGenerating[key]=false; window._reportGenerating=false;
  });
}
var SZ_REPORT_TEXT=''; /* 移除硬编码报告文本 */
function generateKbConclusions(city){
  // 【2026-09-29】彻底删除demo假文本（此前恢复的"随州6条硬编码"和"通用骨架占位文本"
  // 都是编出来的，不是真实数据，用户明确否决"绝不接受任何demo假数据"）。
  // 改为从 CITY_BASE_PACKAGES 全局指针表动态读取真实城市包内容（14-Agent流水线
  // 首轮产出，nature==='base' 的条目，见 getCityBasePackage() 定义于 03.js）。
  // 该城市没有基础包时，返回真正的空 known:[]，不再用任何占位假文本填充——
  // 界面应该展示真正的"未开始"状态，让干部知道需要管理员先发起报告生成，
  // 而不是被一段看起来像结论的假文字误导。
  var base=getCityBasePackage(city); // null 或 [{icon,t,sub,tag,known}, ...] 4个标准主题
  var byTitle={};
  if(base){ base.forEach(function(topic){ byTitle[topic.t]=topic; }); }
  function pick(title){
    var t=byTitle[title];
    return {sub:t?t.sub:'', tag:t?t.tag:'', known:t?t.known:[]};
  }
  return {
    industry: pick('主导产业与产业链'),
    park: pick('园区与承载条件'),
    firm: pick('链主与存量企业'),
    policy: pick('政策、规划与领导关注')
  };
}

/* ── Summary Modal: 分析完成弹窗，10s 倒计时 ── */
var _summaryTimer=null;

/* ── 下载分析报告 Modal ── */
function showDownloadReport(){
  var p=P();
  if(!p||!p.city){toast('请先完成城市分析');return;}
  var city=p.city;
  // 直接从项目kb数据生成报告（不依赖generateKbConclusions）
  var kb=p.kb||[];
  var sections=['主导产业与产业链','园区与承载条件','链主与存量企业','政策、规划与领导关注'];
  var sectionData=sections.map(function(title,si){
    var sect=kb[si];
    if(!sect) return {title:title,items:[]};
    return {title:title, items:(sect.known||[]).map(function(x){return _kbText(x);}).filter(function(x){return x&&!_isJunkKbItem(x);})};
  });
  if(sectionData.every(function(s){return s.items.length===0;})){toast('城市智库暂无数据，请先上传材料');return;}

  // 完整版内容
  var fullLines=[
    city+'城市智库 · 招商研判报告（完整版）',
    '生成时间：'+new Date().toLocaleDateString('zh-CN')+'  |  数据来源：城市智库RAG知识库',
    '════════════════════════════════',
    ''
  ];
  sectionData.forEach(function(s,idx){
    fullLines.push((['一','二','三','四'][idx]||'')+'、'+s.title);
    if(s.items.length){
      s.items.slice(0,15).forEach(function(x){
        fullLines.push((x.indexOf('⚠️')>=0?'  ⚠ ':'  • ')+x.replace('⚠️ ',''));
      });
      if(s.items.length>15) fullLines.push('  … 共'+s.items.length+'条');
    } else {
      fullLines.push('  （暂无数据）');
    }
    fullLines.push('');
  });
  fullLines.push('════════════════════════════════');
  fullLines.push('研判建议：');
  fullLines.push('  1. 优先补链方向：链主外采依赖最集中的核心零部件/系统集成环节');
  fullLines.push('  2. 推荐承接园区：'+city+'国家级/省级开发区（具体园区需向招商局确认）');
  fullLines.push('  3. 招引目标画像：具备落地意向、产品与缺口直接匹配的细分领域龙头');
  fullLines.push('');
  fullLines.push('⚠ 本报告基于公开信息整理，正式招商决策需结合政府授权材料与确认。');
  var fullText=fullLines.join('\n');

  // 精简版内容
  var shortItems=sectionData.map(function(s){return '【'+s.title+'】'+(s.items[0]||'暂无数据');});
  var shortLines=[
    city+'招商研判报告 · 精简版',
    '生成时间：'+new Date().toLocaleDateString('zh-CN'),
    '────────────────────',
    ''
  ].concat(shortItems).concat([
    '',
    '【核心建议】优先招引链主外采依赖最重的关键环节企业，结合园区政策争取一事一议。',
    '',
    '⚠ 以上为公开信息整理，需干部结合实际材料确认。',
  ]).join('\n');

  function dlFile(content, filename){
    var blob=new Blob([content],{type:'text/plain;charset=utf-8'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');a.href=url;a.download=filename;
    document.body.appendChild(a);a.click();
    setTimeout(function(){URL.revokeObjectURL(url);a.remove();},300);
  }

  var modal='<div id="dlReportModal" style="position:fixed;inset:0;background:rgba(11,24,59,.45);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px)" onclick="if(event.target.id===\'dlReportModal\')this.remove()">'+
    '<div style="background:#fff;border-radius:22px;padding:36px;max-width:480px;width:92%;box-shadow:0 8px 60px rgba(11,24,59,.18);animation:fadeUp .3s ease">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">'+
        '<div>'+
          '<div style="font-size:12px;font-weight:650;color:#8492a6;letter-spacing:.5px;margin-bottom:4px">分析报告下载</div>'+
          '<h2 style="font-size:18px;font-weight:750;color:#0b183b;margin:0">'+city+' 城市智库报告</h2>'+
        '</div>'+
        '<button onclick="document.getElementById(\'dlReportModal\').remove()" style="background:none;border:none;font-size:18px;color:#9aa5b5;cursor:pointer;padding:4px">✕</button>'+
      '</div>'+
      '<div style="display:flex;flex-direction:column;gap:12px">'+
        '<div style="border:1.5px solid #e8edf5;border-radius:14px;padding:18px 20px">'+
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'+
            '<span style="font-size:20px">📄</span>'+
            '<div><div style="font-size:13.5px;font-weight:650;color:#0b183b">完整版报告</div>'+
            '<div style="font-size:11.5px;color:#8492a6;margin-top:1px">四大主题全部内容 · 含核心研判建议</div></div>'+
          '</div>'+
          '<button onclick="downloadReportPDF(\'full\')" style="width:100%;padding:10px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:10px;font-size:13.5px;font-weight:600;cursor:pointer">⬇ 下载完整版 PDF</button>'+
        '</div>'+
        '<div style="border:1.5px solid #e8edf5;border-radius:14px;padding:18px 20px">'+
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'+
            '<span style="font-size:20px">📋</span>'+
            '<div><div style="font-size:13.5px;font-weight:650;color:#0b183b">精简版报告</div>'+
            '<div style="font-size:11.5px;color:#8492a6;margin-top:1px">一句话摘要 · 适合快速分享</div></div>'+
          '</div>'+
          '<button onclick="downloadReportPDF(\'short\')" style="width:100%;padding:10px;background:#f5f7fb;color:#0b183b;border:1.5px solid #e8edf5;border-radius:10px;font-size:13.5px;font-weight:600;cursor:pointer">⬇ 下载精简版 PDF</button>'+
        '</div>'+
      '</div>'+
      '<p style="font-size:11px;color:#b0bac8;margin:16px 0 0;text-align:center;line-height:1.7">报告内容为公开信息整理的初步研判，正式招商决策需结合政府授权材料与确认</p>'+
    '</div>'+
  '</div>';

  var wrap=document.createElement('div');
  wrap.innerHTML=modal;
  document.body.appendChild(wrap.firstChild);
}

function showSummaryModal(city2,sectors){
  // 生成kb一句话摘要
  var p=cur&&PROJECTS[cur];
  // 已移除随州硬编码假结论与通用捏造文案：无上传材料时不虚构研判结论。
  var _hasUp2=k.known&&k.known.length>0;
  var _phRow=_hasUp2?'已结合上传材料完成初步归纳，进入城市智库查看':'暂无数据，请上传政府材料后由 AI 生成';
  var insights=[_phRow,_phRow,_phRow,_phRow];
  var rows=(sectors||[]).map(function(s,i){
    return '<div style="display:flex;gap:14px;padding:14px 0;border-bottom:1px solid #f0f4ff;align-items:flex-start">'+
      '<span style="font-size:20px;flex:0 0 28px;text-align:center;margin-top:2px">'+s.icon+'</span>'+
      '<div style="flex:1">'+
        '<div style="font-size:13px;font-weight:650;color:#0b183b;margin-bottom:3px">'+s.name+'</div>'+
        '<div style="font-size:12px;color:#4a5568;line-height:1.65">'+insights[i]+'</div>'+
      '</div>'+
      '<span style="font-size:11px;color:'+(_hasUp2?'#22c55e':'#9aa5b5')+';background:'+(_hasUp2?'#f0fdf4':'#f1f5f9')+';padding:2px 8px;border-radius:20px;flex:0 0 auto;margin-top:2px;white-space:nowrap">'+(_hasUp2?'已就位':'待补充')+'</span>'+
    '</div>';
  }).join('');

  var modal='<div id="summaryModal" style="position:fixed;inset:0;background:rgba(11,24,59,.45);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px)">'+
    '<div style="background:#fff;border-radius:22px;padding:36px 36px 28px;max-width:520px;width:92%;box-shadow:0 8px 60px rgba(11,24,59,.18);animation:fadeUp .35s ease">'+
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">'+
        '<div style="width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.2)"></div>'+
        '<span style="font-size:12px;font-weight:650;color:#22c55e;letter-spacing:.5px">分析完成</span>'+
      '</div>'+
      '<h2 style="font-size:20px;font-weight:750;color:#0b183b;margin:0 0 4px">'+city2+' 城市智库已就位</h2>'+
      '<p style="font-size:13px;color:#8492a6;margin:0 0 20px">'+(_hasUp2?'以下为 AI 结合你上传材料的初步研判结论，⚠️ 标注项需结合政府材料确认':'城市智库已创建，暂无数据。请在城市智库上传政府工作报告/产业报告等材料，由 AI 生成研判结论。')+'</p>'+
      rows+
      '<div style="margin-top:22px;display:flex;gap:10px;align-items:center">'+
        '<button onclick="enterWorkspaceFromModal()" style="flex:1;padding:13px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:650;cursor:pointer;letter-spacing:.2px">进入城市智库 →</button>'+
        '<div id="summaryCountdown" style="font-size:12px;color:#9aa5b5;white-space:nowrap">10s 后自动进入</div>'+
      '</div>'+
    '</div>'+
  '</div>';

  // 注入动画 keyframe（只注一次）
  if(!document.getElementById('fadeUpStyle')){
    var st=document.createElement('style');st.id='fadeUpStyle';
    st.textContent='@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(st);
  }
  var wrap=document.createElement('div');
  wrap.id='summaryModalWrap';
  wrap.innerHTML=modal;
  document.body.appendChild(wrap);

  // 10s 倒计时
  var remaining=10;
  _summaryTimer=setInterval(function(){
    remaining--;
    var cd=document.getElementById('summaryCountdown');
    if(cd)cd.textContent=remaining+'s 后自动进入';
    if(remaining<=0){
      clearInterval(_summaryTimer);
      enterWorkspaceFromModal();
    }
  },1000);
}
function enterWorkspaceFromModal(){
  if(_summaryTimer)clearInterval(_summaryTimer);
  var wrap=document.getElementById('summaryModalWrap');
  if(wrap)wrap.remove();
  enterWorkspace();
}

function enterWorkspace(){
  if(!cur||!PROJECTS[cur])return;
  // 填充城市智库核心结论
  var p=PROJECTS[cur];
  // 【2026-09-29】防御：p.kb 若不是 4 个板块的骨架（比如管理端邀请码流程曾经把它
  // 建成空数组 []），下面的 forEach 会静默什么都不做，表现为"账号进了工作区但顶部
  // 城市智库板块完全空白"。不管 kb 缺失的原因是什么，这里统一兜底重建标准骨架，
  // 再走正常填充逻辑，不依赖上游每一条创建路径都记得写对结构。
  if(!Array.isArray(p.kb)||p.kb.length<4){
    p.kb=[
      {icon:'🏭',t:'主导产业与产业链',sub:'分析中',tag:'公开信息',known:[],calls:['城市公开信息','产业链图谱']},
      {icon:'🏢',t:'园区与承载条件',sub:'分析中',tag:'公开信息',known:[],calls:['园区基础资料','政府官网']},
      {icon:'🏗️',t:'链主与存量企业',sub:'分析中',tag:'公开信息',known:[],calls:['企业名录','工商信息']},
      {icon:'📜',t:'政策、规划与领导关注',sub:'分析中',tag:'公开信息',known:[],calls:['政府工作报告','领导发言']}
    ];
  }
  var c=generateKbConclusions(p.city);
  var mapping=[c.industry,c.park,c.firm,c.policy];
  p.kb.forEach(function(k,i){
    if(mapping[i]&&(!k.known||!k.known.length)){
      k.known=mapping[i].known;
      k.sub=mapping[i].sub;
      k.tag=mapping[i].tag;
    }
  });
  p.topic=p.city+'主导产业补链招引';
  persist();
  view='knowledge';
  detailOpen=false;
  render();
  // 延迟写入 AI 首条消息
  setTimeout(function(){
    if(!cur||!PROJECTS[cur])return;
    var city=PROJECTS[cur].city;
    var hasFile=!!(_setupFiles&&_setupFiles.length);
    addA('<p>'+city+'城市智库已就位'+(hasFile?'，已结合你上传的材料':'，基于公开信息')+
      '完成初步分析。</p>'+
      '<p style="margin-top:6px">左侧四大主题均可点击展开，你也可以直接提问：</p>'+
      '<ul style="margin:6px 0 0 18px;line-height:2;font-size:13px;color:#33415a">'+
        '<li>「<strong>'+city+'补链的核心缺口有哪些？</strong>」</li>'+
        '<li>「<strong>本地链主企业还缺哪些关键配套？</strong>」</li>'+
        '<li>「<strong>园区如何分工承接不同细分方向？</strong>」</li>'+
      '</ul>'+
      '<p style="margin-top:8px;font-size:12px;color:#9aa5b5">上传政府工作报告或产业材料可进一步提升判断精度。</p>');
  }, 350);
}


function roleSwitchLegacy(){
  // 角色切换暂时隐藏——先专注做好政府端（运营端代码保留，后续再启用）
  return '';
}
function setRole(r){role=r;view='home';render();toast(r==='ops'?'已切换到运营端（周总·全局）':'已切换到政府端（随州·张主任）')}
