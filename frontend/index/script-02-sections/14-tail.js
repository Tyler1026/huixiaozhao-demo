
function _tombKbItem(pk,kbIdx,text){
  if(!pk) return;
  var fp=_kbItemFp(text); if(!fp) return;
  if(!KB_ITEM_TOMBS[pk]) KB_ITEM_TOMBS[pk]={};
  if(!KB_ITEM_TOMBS[pk][kbIdx]) KB_ITEM_TOMBS[pk][kbIdx]={};
  KB_ITEM_TOMBS[pk][kbIdx][fp]=Date.now();
}
function _isKbItemTombed(pk,kbIdx,text){
  var fp=_kbItemFp(text); if(!fp) return false;
  return !!(KB_ITEM_TOMBS[pk]&&KB_ITEM_TOMBS[pk][kbIdx]&&KB_ITEM_TOMBS[pk][kbIdx][fp]);
}
function _mergeKbItemTombs(src){
  try{ src=src||{};
    Object.keys(src).forEach(function(pk){
      if(!KB_ITEM_TOMBS[pk]) KB_ITEM_TOMBS[pk]={};
      Object.keys(src[pk]||{}).forEach(function(ki){
        if(!KB_ITEM_TOMBS[pk][ki]) KB_ITEM_TOMBS[pk][ki]={};
        Object.keys(src[pk][ki]||{}).forEach(function(fp){
          var a=Number(src[pk][ki][fp])||0, b=Number(KB_ITEM_TOMBS[pk][ki][fp])||0;
          if(a>b) KB_ITEM_TOMBS[pk][ki][fp]=a;
        });
      });
    });
  }catch(_e){}
}
/* 将墓碑应用到即将生效的快照：已删条目不得随同步回流。 */
function _applyKbItemTombs(projMap){
  try{
    Object.keys(KB_ITEM_TOMBS||{}).forEach(function(pk){
      var pr=projMap&&projMap[pk]; if(!pr||!pr.kb) return;
      Object.keys(KB_ITEM_TOMBS[pk]||{}).forEach(function(ki){
        var sec=pr.kb[Number(ki)]; if(!sec||!sec.known) return;
        sec.known=sec.known.filter(function(x){
          return !_isKbItemTombed(pk,ki,(typeof _kbText==='function')?_kbText(x):x);
        });
      });
    });
  }catch(_e){}
}
var KB_CONFIRMS={};  // {projKey:{kbIdx:{itemIdx:{status,text,ts}}}}

function restoreFromServer(callback){
  // 生成/访谈进行中不做全量覆盖同步——否则刚生成的REPORTSTATE/访谈状态被服务端旧数据冲掉，
  // 表现为"报告跑一半自己跳走/进行不下去"。完成后调用方会再触发同步。
  if(window._reportGenerating || (window._interviewState && _interviewState.active)){
    console.log('[sync] skip restoreFromServer: generation/interview in progress');
    if(callback)callback(false); return;
  }
  window._serverSyncLock=true;
  // 保存用户当前操作状态，避免服务器数据覆盖用户刚做的方向切换
  var _userCur = cur;
  var _userTopic = (cur && PROJECTS[cur]) ? PROJECTS[cur].topic : null;
  var _userView = view;
  fetch('/api/sync').then(function(r){return r.json();}).then(function(raw){
    if(!raw){ if(callback)callback(false); return; }
    // 兼容两种存储格式：
    //   扁平格式（persist()写入）: {PROJECTS:{...}, UPLOADS:{...}, ...}
    //   包装格式（历史遗留）:      {huixiaozhao_kb_v1:{PROJECTS:{...},...}, hxz_uploads:{...}}
    var srv = (raw.huixiaozhao_kb_v1 && raw.huixiaozhao_kb_v1.PROJECTS)
              ? raw.huixiaozhao_kb_v1
              : raw;
    if(!srv||!srv.PROJECTS||!Object.keys(srv.PROJECTS).length){
      if(callback)callback(false); return;
    }
    // 服务器直接覆盖本地，不做合并——保证所有人看到同一份数据
    // 但保护本地刚提交的 isDemand 项目：5秒防抖内刷新时服务器尚无这些数据，直接覆盖会丢
    var _localDemandProj={}, _localDemandRS={}, _localDemands=(typeof DEMANDS!=='undefined')?DEMANDS.slice():[];
    Object.keys(PROJECTS).forEach(function(k){ if(PROJECTS[k]&&PROJECTS[k].isDemand) _localDemandProj[k]=PROJECTS[k]; });
    Object.keys(REPORTSTATE||{}).forEach(function(k){ if(_localDemandProj[k]&&REPORTSTATE[k]) _localDemandRS[k]=REPORTSTATE[k]; });
    PROJECTS         = srv.PROJECTS         || {};
    UPLOADS          = _mergeUploads(srv.UPLOADS, UPLOADS);
    _mergeKbItemTombs(srv.KB_ITEM_TOMBS);
    // 【2026-09-18】过滤 srv 本体：部分路径会把 srv 原文回写 localStorage，
    // 只过滤内存会让已删条目随脏数据落盘复活。
    _applyKbItemTombs(srv.PROJECTS);
    _applyKbItemTombs(PROJECTS);
    _mergeTombs(srv.KB_CONFIRM_TOMBS);
    KB_CONFIRMS      = _mergeConfirms(srv.KB_CONFIRMS || {});  // 只进不退，见 _mergeConfirms
    KB_FILE_CHUNKS   = _mergeChunks(srv.KB_FILE_CHUNKS, KB_FILE_CHUNKS);
    KB_UNLOCKED      = srv.KB_UNLOCKED      || {};
    // REPORTSTATE：保护本地更新的报告。择优规则优先按 ts 择新（phase1 draft 短但新→不能被旧完整报告冲掉），
    // ts 相同或缺失时才回退到长的赢避免残缺覆盖完整。
    (function(){
      var _localRs=(cur&&REPORTSTATE&&REPORTSTATE[cur])?REPORTSTATE[cur]:null;
      REPORTSTATE = srv.REPORTSTATE || {};
      if(cur&&_localRs){
        var _inRs=REPORTSTATE[cur];
        var _lt=Number(_localRs&&_localRs.ts)||0, _it=Number(_inRs&&_inRs.ts)||0;
        var _localWins = !_inRs || _lt>_it || (_lt===_it && String(_localRs.text||'').length > String((_inRs||{}).text||'').length);
        if(_localWins) REPORTSTATE[cur]=_localRs;
      }
    })();
    PENDING_CONFIRMS = srv.PENDING_CONFIRMS || {};
    DOCK_LOGS        = srv.DOCK_LOGS        || {};
    if(srv.DEMANDS) window.DEMANDS=srv.DEMANDS;
    // KB_CHAT：按会话择优合并，绝不让服务端旧快照裸覆盖本地刚写入的问答
    // （persist 到服务器有 5 秒防抖，问答后立即刷新时服务端往往还没有这条，
    //  裸覆盖会导致问答记忆变回 0）。合并规则见 _mergeKbChat。
    _mergeKbChatTombs(srv.KB_CHAT_TOMBS);
    _mergeUploadTombs(srv.UPLOAD_TOMBS);
    KB_CHAT = _mergeKbChat(srv.KB_CHAT, KB_CHAT);
    _applyUploadTombs();
    // 企业库：管理端录入的目标企业，供政府端产业链图谱关联展示
    if(srv.OPS_ENT) OPS_ENT = srv.OPS_ENT;
    // 历史报告：服务器有则用服务器，否则保留本地已加载的（避免旧记录被空值冲掉）
    if(srv.REPORT_HISTORY && Object.keys(srv.REPORT_HISTORY).length) REPORT_HISTORY = srv.REPORT_HISTORY;
    // 注册用户资料：合并服务器与本地(不丢本地新注册未同步的)
    if(srv.USER_PROFILES){ Object.keys(srv.USER_PROFILES).forEach(function(uk){ USER_PROFILES[uk]=srv.USER_PROFILES[uk]; }); }
    if(srv.CITY_ACCOUNTS){ CITY_ACCOUNTS = srv.CITY_ACCOUNTS; }
    if(srv.RESET_GEN){ RESET_GEN = srv.RESET_GEN; }  // 记住服务端代际,persist时带回
    // 删除墓碑：合并服务端与本地墓碑，并从恢复的数据中过滤已删项目（防复活）
    (function(){
      var _tomb=(srv.DELETED_PROJECTS||[]).slice();
      (window.DELETED_PROJECTS||[]).forEach(function(t){ if(_tomb.indexOf(t)<0) _tomb.push(t); });
      window.DELETED_PROJECTS=_tomb;
      // 企业线索墓碑：合并服务端与本地，并从刚拉回的 PROJECTS.clues 里剔除已删企业，
      // 否则 _merge_clues 保留的服务端副本会让删掉的企业刷新后复活。
      var _ctomb=(srv.DELETED_CLUES||[]).slice();
      (window.DELETED_CLUES||[]).forEach(function(t){ if(_ctomb.indexOf(t)<0) _ctomb.push(t); });
      window.DELETED_CLUES=_ctomb;
      if(_ctomb.length){
        Object.keys(PROJECTS).forEach(function(_pk){
          var _pp=PROJECTS[_pk]; if(!_pp||!_pp.clues||!_pp.clues.length) return;
          _pp.clues=_pp.clues.filter(function(_c){
            return !(_c && isClueDeleted(_pk, _c));
          });
        });
      }
      _tomb.forEach(function(dk){
        delete PROJECTS[dk]; delete REPORTSTATE[dk]; delete PENDING_CONFIRMS[dk];
        delete UPLOADS[dk]; delete KB_FILE_CHUNKS[dk];
      });
      // 【2026-09-17】墓碑同样过滤 DEMANDS：否则已删项目的需求记录会从服务端被拉回，
      // 在管理端显示成"项目已不存在却仍挂着"的幽灵需求。
      try{
        if(typeof DEMANDS!=='undefined'&&Array.isArray(DEMANDS)&&_tomb.length){
          window.DEMANDS=DEMANDS.filter(function(_d){
            if(!_d) return false;
            var _id=_d.projKey||_d.id||'';
            var _bare=(String(_id).charAt(0)==='d')?String(_id).slice(1):_id;
            return _tomb.indexOf(_id)<0 && _tomb.indexOf(_bare)<0;
          });
        }
      }catch(_td){}
    })();
    // 合并保护本地刚提交但服务端尚未收到的 isDemand 项目（防5秒防抖内刷新丢失）
    Object.keys(_localDemandProj).forEach(function(k){
      if((window.DELETED_PROJECTS||[]).indexOf(k)>=0) return;
      if(!PROJECTS[k]){
        PROJECTS[k]=_localDemandProj[k];
        if(_localDemandRS[k]&&!REPORTSTATE[k]) REPORTSTATE[k]=_localDemandRS[k];
        return;
      }
      // 【2026-09-17 修复】项目已存在时，旧实现直接被服务端整体覆盖，
      // 导致 persist() 5秒防抖内刷新时刚推进的阶段被服务端旧 stage 冲掉，
      // 表现为"点到资源匹配，刷新后退回确认需求"。
      // 阶段只进不退：取本地与服务端的较大值，并同步方向级 stageByTopic。
      var _loc=_localDemandProj[k], _srvP=PROJECTS[k];
      try{
        var _ls=Number(_loc.stage)||0, _ss=Number(_srvP.stage)||0;
        if(_ls>_ss) _srvP.stage=_ls;
        // 方向级进度同样只进不退
        if(_loc.stageByTopic){
          if(!_srvP.stageByTopic) _srvP.stageByTopic={};
          Object.keys(_loc.stageByTopic).forEach(function(_t){
            var _lv=Number(_loc.stageByTopic[_t])||0, _sv=Number(_srvP.stageByTopic[_t])||0;
            if(_lv>_sv) _srvP.stageByTopic[_t]=_lv;
          });
        }
        // 当前方向的 stage 与 stageByTopic 保持一致，避免刷新后被方向桶回灌旧值
        if(_srvP.topic!=null){
          if(!_srvP.stageByTopic) _srvP.stageByTopic={};
          var _cv=Number(_srvP.stageByTopic[_srvP.topic])||0;
          if((Number(_srvP.stage)||0)>_cv) _srvP.stageByTopic[_srvP.topic]=_srvP.stage;
          else if(_cv>(Number(_srvP.stage)||0)) _srvP.stage=_cv;
        }
        // 线索状态：本地更靠前的核验状态不被旧快照冲掉（tone: slate<amber<teal）
        if((_loc.clues||[]).length && (_srvP.clues||[]).length){
          var _rank={slate:1,amber:2,teal:3};
          var _locById={}; _loc.clues.forEach(function(c){ if(c&&c.id!=null) _locById[c.id]=c; });
          _srvP.clues.forEach(function(sc){
            var lc=_locById[sc&&sc.id]; if(!lc) return;
            if((_rank[lc.tone]||0)>(_rank[sc.tone]||0)){ sc.tone=lc.tone; sc.status=lc.status; }
          });
          // 本地独有线索补回
          var _srvIds={}; _srvP.clues.forEach(function(c){ if(c&&c.id!=null) _srvIds[c.id]=1; });
          _loc.clues.forEach(function(lc){ if(lc&&lc.id!=null&&!_srvIds[lc.id]) _srvP.clues.push(lc); });
        }else if((_loc.clues||[]).length && !(_srvP.clues||[]).length){
          _srvP.clues=_loc.clues;
        }
        if((_loc.stageLog||[]).length>(_srvP.stageLog||[]).length) _srvP.stageLog=_loc.stageLog;
      }catch(_se){}
    });
    // 【2026-09-17】历史数据兜底：修复前推进过阶段的需求，DEMANDS 里没有 res/resLabel/clues，
    // 管理端据此渲染就显示不出进度（表现为政府端已到「资源匹配」、管理端仍「待研判」）。
    // 这里按项目实际 stage/线索补齐一次，只补不降，避免用户必须回去重点一遍。
    try{
      if(typeof DEMANDS!=='undefined'&&Array.isArray(DEMANDS)&&typeof syncDemandStage==='function'){
        Object.keys(PROJECTS).forEach(function(_pk){
          var _pp=PROJECTS[_pk]; if(!_pp||!_pp.isDemand) return;
          syncDemandStage(_pk);
        });
      }
    }catch(_bf){}
    // 合并本地 DEMANDS 条目（服务端可能缺少刚提交的）
    // 【2026-09-17】必须同时排除墓碑项：否则上一步刚按墓碑过滤掉的幽灵需求，
    // 会从本地缓存 _localDemands 里被重新 push 回来（实测松江两条幽灵即如此复活）。
    if(_localDemands.length){
      var _srvDIds={}; (DEMANDS||[]).forEach(function(d){ _srvDIds[d.id||d.projKey]=true; });
      var _tomb2=window.DELETED_PROJECTS||[];
      _localDemands.forEach(function(d){
        if(!d) return;
        var _did=d.projKey||d.id||'';
        var _dbare=(String(_did).charAt(0)==='d')?String(_did).slice(1):_did;
        if(_tomb2.indexOf(_did)>=0||_tomb2.indexOf(_dbare)>=0) return;
        if(!_srvDIds[d.id||d.projKey]) DEMANDS.push(d);
      });
    }
    // 【2026-09-17】最终兜底：合并完再按墓碑清一遍，确保任何路径都不会残留幽灵需求
    try{
      var _tomb3=window.DELETED_PROJECTS||[];
      if(typeof DEMANDS!=='undefined'&&Array.isArray(DEMANDS)&&_tomb3.length){
        window.DEMANDS=DEMANDS.filter(function(_d){
          if(!_d) return false;
          var _i=_d.projKey||_d.id||'';
          var _b=(String(_i).charAt(0)==='d')?String(_i).slice(1):_i;
          return _tomb3.indexOf(_i)<0&&_tomb3.indexOf(_b)<0;
        });
      }
    }catch(_fd){}
    // 不盲目用srv.cur（可能指向空项目）：选数据最多的项目
    var _allK=Object.keys(PROJECTS); var _bestK=null,_bestKC=0;
    _allK.forEach(function(k){var c=0;(PROJECTS[k].kb||[]).forEach(function(t){c+=(t.known||[]).length;});if(c>_bestKC){_bestKC=c;_bestK=k;}});
    cur = (_bestK && _bestKC > 0) ? _bestK : (srv.cur || _allK[0] || null);
    view = (_bestKC > 0) ? 'knowledge' : (srv.view || 'setup');
    // 写回 localStorage（统一扁平格式）
    var flat={cur:cur,view:view,PROJECTS:PROJECTS,UPLOADS:UPLOADS,
      KB_CONFIRMS:KB_CONFIRMS,KB_CONFIRM_TOMBS:KB_CONFIRM_TOMBS,KB_FILE_CHUNKS:KB_FILE_CHUNKS,
      KB_UNLOCKED:KB_UNLOCKED,REPORTSTATE:REPORTSTATE,
      PENDING_CONFIRMS:PENDING_CONFIRMS,DOCK_LOGS:DOCK_LOGS,
      DEMANDS:typeof DEMANDS!=='undefined'?DEMANDS:[],
      DELETED_PROJECTS:window.DELETED_PROJECTS||[],
      DELETED_CLUES:window.DELETED_CLUES||[],
      KB_CHAT:KB_CHAT,
      KB_CHAT_TOMBS:KB_CHAT_TOMBS,
      UPLOAD_TOMBS:UPLOAD_TOMBS,OPS_ENT:OPS_ENT,RESET_GEN:RESET_GEN,
      USER_PROFILES:USER_PROFILES,REPORT_HISTORY:typeof REPORT_HISTORY!=='undefined'?REPORT_HISTORY:{},
      syncTs:Date.now()};
    try{localStorage.setItem(LS_KEY,JSON.stringify(flat));}catch(_){}
    try{localStorage.setItem('hxz_uploads',JSON.stringify(_slimUploads()));}catch(_){}
    // 若 Postgres 是旧包装格式，顺手更新成扁平格式
    if(raw.huixiaozhao_kb_v1){
      try{fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(flat)}).catch(function(){});}catch(_){}
    }
    // 恢复用户当前操作状态：服务器数据不覆盖用户刚切换的方向
    if(_userCur && PROJECTS[_userCur]){
      cur = _userCur;
      if(_userTopic) PROJECTS[_userCur].topic = _userTopic;
    }
    if(_userView) view = _userView;
    window._serverSyncLock=false;
    console.log('[sync] restored from server, projects:',Object.keys(PROJECTS).length,', preserved topic:', _userTopic);
    try{ migrateKbChatToCity(); }catch(_){}
    if(callback)callback(true);
  }).catch(function(){ window._serverSyncLock=false; if(callback)callback(false); });
}
function clearPersist(){
  localStorage.removeItem(LS_KEY);
  toast('已清除本地存储');
}

/* 页面隐藏/关闭前兜底同步：绕过 persist 的 5 秒防抖，立即把最新快照推到服务器，
 * 避免问答后立即刷新/关页时服务端还没收到导致重载时被旧快照覆盖。 */
(function(){
  var flush=function(){
    try{
      var body=localStorage.getItem(LS_KEY)||'{}';
      if(navigator.sendBeacon){
        var blob=new Blob([body],{type:'application/json'});
        navigator.sendBeacon('/api/sync', blob);
      } else {
        fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:body,keepalive:true}).catch(function(){});
      }
    }catch(_){}
  };
  window.addEventListener('pagehide', flush);
  window.addEventListener('visibilitychange', function(){ if(document.visibilityState==='hidden') flush(); });
})();

/* 管理端写入时，政府端自动同步内存状态 */
window.addEventListener('storage', function(e){
  if(e.key !== LS_KEY || !e.newValue) return;
  try{
    // 关键修复(乱跳根因)：报告生成中/访谈中收到其他标签页(管理端)的storage事件，
    // 旧逻辑整体覆盖PROJECTS(topic被打回旧方向)并强制render()，导致
    // "正在跑的方向自己跳回别的方向、访谈/生成界面被重刷中断进行不下去"。
    // 生成/访谈进行中：跳过本次同步(数据稍后restoreFromServer会拉齐)，绝不打断用户流程。
    if(window._reportGenerating || (window._interviewState && _interviewState.active) || window._verifyInProgress){
      console.log('[sync] skip storage sync: generation/interview in progress');
      return;
    }
    var data=JSON.parse(e.newValue);
    if(!data.PROJECTS) return;
    // 关键修复(周期性闪烁根因)：多开政府端+管理端时，另一标签每次 persist(哪怕只是 5 秒防抖空转、
    // 仅 syncTs 变化、业务数据未变)都会派发 storage 事件，旧逻辑无条件整体覆盖内存 + render() 全量重绘
    // (#root.innerHTML 重建整页)，表现为"页面没操作也周期性自己闪一下/跳动"。
    // 业务数据指纹比对：只取业务字段(不含 syncTs 等易变时间戳)，指纹与上次相同则本次纯属空转，直接跳过重绘。
    var _fp=JSON.stringify([data.PROJECTS,data.REPORTSTATE,data.DEMANDS,
      data.KB_FILE_CHUNKS,data.KB_CONFIRMS,data.PENDING_CONFIRMS,
      data.DOCK_LOGS,data.KB_UNLOCKED,data.CITY_ACCOUNTS,data.USER_PROFILES]);
    if(window.__lastSyncFp===_fp){ return; }  // 业务数据无变化：跳过整体覆盖与 render()，消除空转闪烁
    window.__lastSyncFp=_fp;
    // 同步关键数据（保留当前 view/cur/topic/stage 等用户操作状态）
    var _keepTopic=(cur&&PROJECTS[cur])?PROJECTS[cur].topic:null;
    var _keepStage=(cur&&PROJECTS[cur])?PROJECTS[cur].stage:null;
    // 关键修复：整体覆盖 PROJECTS 会把本地刚定义、尚未同步出去的 customTopics 冲掉，
    // 表现为"自定义方向自己消失，重新定义才回来"。这里合并保护本地的 customTopics（并集）。
    (function(){
      var incoming=data.PROJECTS||{};
      Object.keys(PROJECTS).forEach(function(k){
        var localP=PROJECTS[k], inP=incoming[k];
        if(localP && inP && localP.customTopics && localP.customTopics.length){
          var merged=(inP.customTopics||[]).slice();
          localP.customTopics.forEach(function(ct){ if(merged.indexOf(ct)<0) merged.push(ct); });
          inP.customTopics=merged;
        }
      });
      // 【2026-09-17 修复】阶段/线索只进不退（全部项目，不只 cur）。
      // 旧代码只在下面保护 cur 项目的 stage，而招商对接推进的是 isDemand 子项目
      // （cur 仍是城市主项目 city62883），于是管理端每次 persist 派发的 storage 事件
      // 都把子项目整体覆盖成管理端内存里的旧 stage=3，表现为"点到资源匹配后自己退回确认需求"。
      var _rank={slate:1,amber:2,teal:3};
      Object.keys(PROJECTS).forEach(function(k){
        var lp=PROJECTS[k], ip=incoming[k];
        if(!lp||!ip) return;
        try{
          if((Number(lp.stage)||0)>(Number(ip.stage)||0)) ip.stage=lp.stage;
          if(lp.stageByTopic){
            if(!ip.stageByTopic) ip.stageByTopic={};
            Object.keys(lp.stageByTopic).forEach(function(t){
              if((Number(lp.stageByTopic[t])||0)>(Number(ip.stageByTopic[t])||0)) ip.stageByTopic[t]=lp.stageByTopic[t];
            });
          }
          // 当前方向的 stage 与方向桶保持一致，避免被方向桶旧值回灌
          if(ip.topic!=null){
            if(!ip.stageByTopic) ip.stageByTopic={};
            var _cv=Number(ip.stageByTopic[ip.topic])||0;
            if((Number(ip.stage)||0)>_cv) ip.stageByTopic[ip.topic]=ip.stage;
            else if(_cv>(Number(ip.stage)||0)) ip.stage=_cv;
          }
          // 线索核验状态只进不退 + 本地独有线索补回
          if((lp.clues||[]).length){
            if(!(ip.clues||[]).length){ ip.clues=lp.clues; }
            else{
              var _lb={}; lp.clues.forEach(function(c){ if(c&&c.id!=null) _lb[c.id]=c; });
              ip.clues.forEach(function(sc){
                var lc=_lb[sc&&sc.id]; if(!lc) return;
                if((_rank[lc.tone]||0)>(_rank[sc.tone]||0)){ sc.tone=lc.tone; sc.status=lc.status; }
              });
              var _ids={}; ip.clues.forEach(function(c){ if(c&&c.id!=null) _ids[c.id]=1; });
              lp.clues.forEach(function(lc){ if(lc&&lc.id!=null&&!_ids[lc.id]) ip.clues.push(lc); });
            }
          }
        }catch(_e){}
      });
      // 【2026-09-18】已删条目不得随快照回流。上方合并保护了
      // customTopics/stage/clues，但 kb.known 一直是裸赋值，造成删除后复活。
      _applyKbItemTombs(incoming);
      PROJECTS=incoming;
    })();
    // 删除墓碑过滤：其他标签页快照可能仍含已删项目
    (window.DELETED_PROJECTS||[]).forEach(function(dk){ delete PROJECTS[dk]; });
    // 恢复用户当前操作状态：管理端快照不覆盖用户正在操作的方向/阶段
    if(cur&&PROJECTS[cur]){
      if(_keepTopic!=null) PROJECTS[cur].topic=_keepTopic;
      if(_keepStage!=null) PROJECTS[cur].stage=_keepStage;
    }
    DEMANDS=data.DEMANDS||[];
    // REPORTSTATE 保护当前项目：管理端旧快照不得冲掉本地刚生成的报告状态。
    // 择优：先按 ts 择新，不然 phase1 draft(短但新) 会被同项目旧完整报告拖回去。
    (function(){
      var _localRs=REPORTSTATE[cur];
      REPORTSTATE=data.REPORTSTATE||{};
      if(cur&&_localRs){
        var _inRs=REPORTSTATE[cur];
        var _lt=Number(_localRs&&_localRs.ts)||0, _it=Number(_inRs&&_inRs.ts)||0;
        var _localWins = !_inRs || _lt>_it || (_lt===_it && String(_localRs.text||'').length > String((_inRs||{}).text||'').length);
        if(_localWins) REPORTSTATE[cur]=_localRs;
      }
      (window.DELETED_PROJECTS||[]).forEach(function(dk){ delete REPORTSTATE[dk]; });
    })();
    KB_FILE_CHUNKS=_mergeChunks(data.KB_FILE_CHUNKS, KB_FILE_CHUNKS);
    // 【2026-09-18 修复】确认只进不退：整体覆盖会把本地刚点、尚未同步出去的确认冲掉
    _mergeKbItemTombs(data.KB_ITEM_TOMBS);
    _applyKbItemTombs(PROJECTS);
    _mergeTombs(data.KB_CONFIRM_TOMBS);
    KB_CONFIRMS=_mergeConfirms(data.KB_CONFIRMS||{});
    PENDING_CONFIRMS=data.PENDING_CONFIRMS||{};
    DOCK_LOGS=data.DOCK_LOGS||{};
    KB_UNLOCKED=data.KB_UNLOCKED||{};
    if(data.CITY_ACCOUNTS) CITY_ACCOUNTS=data.CITY_ACCOUNTS;
    // KB_CHAT：跨标签同步也必须按会话择优合并，绝不让另一个 tab 的旧内存 persist 回来
    // 冲掉本 tab 刚写入的问答。合并规则见 _mergeKbChat。
    _mergeKbChatTombs(data.KB_CHAT_TOMBS);
    _mergeUploadTombs(data.UPLOAD_TOMBS);
    KB_CHAT=_mergeKbChat(data.KB_CHAT, KB_CHAT);
    _applyUploadTombs();
    if(data.USER_PROFILES) USER_PROFILES=data.USER_PROFILES;
    // 重渲染（仅影响当前视图）
    // report 视图下若用户 1.5s 内有过滚动，延迟执行避免打断阅读
    if(view==='report' && Date.now()-_lastUserScrollMs < 1500){
      setTimeout(function(){ if(view==='report') render(); }, 1500);
    } else {
      render();
    }
    console.log('[sync] 已同步管理端数据');
  }catch(ex){ console.warn('[sync] parse error', ex); }
});

var UPLOADS={};
var KB_FILE_CHUNKS={};

/* 【2026-09-18】确认墓碑 {projKey:{kbIdx:{itemIdx:ts}}}。
   没有它，_mergeConfirms 的「只进不退」会把刚删掉的确认又从本地补回去（删除后复活）。 */
var KB_CONFIRM_TOMBS={};
function _tombConfirm(pk,kbIdx,itemIdx){
  if(!pk)return;
  if(!KB_CONFIRM_TOMBS[pk])KB_CONFIRM_TOMBS[pk]={};
  if(!KB_CONFIRM_TOMBS[pk][kbIdx])KB_CONFIRM_TOMBS[pk][kbIdx]={};
  KB_CONFIRM_TOMBS[pk][kbIdx][itemIdx]=Date.now();
}
function _mergeTombs(src){
  try{ src=src||{};
    Object.keys(src).forEach(function(pk){ if(!KB_CONFIRM_TOMBS[pk])KB_CONFIRM_TOMBS[pk]={};
      Object.keys(src[pk]||{}).forEach(function(ki){ if(!KB_CONFIRM_TOMBS[pk][ki])KB_CONFIRM_TOMBS[pk][ki]={};
        Object.keys(src[pk][ki]||{}).forEach(function(ii){
          var a=Number(src[pk][ki][ii])||0, b=Number(KB_CONFIRM_TOMBS[pk][ki][ii])||0;
          if(a>b) KB_CONFIRM_TOMBS[pk][ki][ii]=a;
        });
      });
    });
  }catch(_e){}
}
/* 确认记录「只进不退」合并：以对端/服务端快照为底，把本地独有(或更新)的确认并回来。
   根因：政府端与管理端共用同一 LS_KEY，管理端每次 persist 派发 storage 事件，其快照里
   KB_CONFIRMS 仍是旧的（缺本地新确认），无条件赋值即整体回滚，表现为「待确认点了又自己
   弹回来、进度条不动」。墓碑内的项不补回，尊重删除意图。 */
function _mergeConfirms(incoming){
  incoming=incoming||{};
  try{
    var localC=KB_CONFIRMS||{};
    Object.keys(localC).forEach(function(pk){
      var lSec=localC[pk]||{};
      Object.keys(lSec).forEach(function(ki){
        var lItems=lSec[ki]||{};
        Object.keys(lItems).forEach(function(ii){
          var lv=lItems[ii]; if(!lv) return;
          var tomb=KB_CONFIRM_TOMBS[pk]&&KB_CONFIRM_TOMBS[pk][ki]&&KB_CONFIRM_TOMBS[pk][ki][ii];
          if(tomb&&Number(tomb)>=(Number(lv.ts)||0)) return;  // 删除意图更新：不补回
          if(!incoming[pk]) incoming[pk]={};
          if(!incoming[pk][ki]) incoming[pk][ki]={};
          var iv=incoming[pk][ki][ii];
          if(!iv||(Number(lv.ts)||0)>(Number(iv.ts)||0)) incoming[pk][ki][ii]=lv;
        });
      });
    });
    // 墓碑生效：任一端删掉的确认，同步后都要消失
    Object.keys(KB_CONFIRM_TOMBS||{}).forEach(function(pk){
      Object.keys(KB_CONFIRM_TOMBS[pk]||{}).forEach(function(ki){
        Object.keys(KB_CONFIRM_TOMBS[pk][ki]||{}).forEach(function(ii){
          var tb=Number(KB_CONFIRM_TOMBS[pk][ki][ii])||0;
          var iv=incoming[pk]&&incoming[pk][ki]&&incoming[pk][ki][ii];
          if(iv&&tb>=(Number(iv.ts)||0)) delete incoming[pk][ki][ii];
        });
      });
    });
  }catch(_e){}
  return incoming;
}
// 城市智库对话记录 {projKey:[{role:'user'|'ai', html:'...'}]}——切主题/切模块/刷新都不丢
var KB_CHAT={};
/* ══ KB_CHAT 会话级合并（唯一实现，三条恢复路径共用）══
 * 背景：问答记忆反复「消失」的根因始终是某条路径裸覆盖了 KB_CHAT。
 *   - restore()            读 localStorage（与管理端共用 LS_KEY，管理端固定写 {}）
 *   - restoreFromServer()  读 /api/sync（5 秒防抖窗口内服务端可能还没有最新问答）
 *   - storage 事件         另一个 tab 的旧内存 persist 过来
 * 任何一条走裸覆盖都会清零，所以统一收敛到这里：
 *   规则 = key 取并集；同 id 会话取「消息更多」的一方，条数相同取 ts 更新的一方。
 * 绝不因为某一侧为空就丢弃另一侧 —— 空值永远不赢。
 * incoming=外部来的数据，local=当前内存值（内存是刚写入问答的一侧，必须参与比较）。 */
/* ══ 文件记忆客户端合并（2026-09-21）══
 * 服务端已做只增不减，但客户端三条恢复路径原来是裸覆盖
 *   UPLOADS = srv.UPLOADS || {}   /  KB_FILE_CHUNKS = srv.KB_FILE_CHUNKS || {}
 * persist 到服务器有 5 秒防抖，刚上传/刚删除还没同步上去时，裸覆盖会把本地
 * 这一份整份冲掉（与 KB_CHAT 归零同一病根）。规则与服务端保持一致：
 *   projKey 取并集；同 key 下按 name+ts 去重，文本更全者胜；墓碑命中的剔除。 */
function _mergeUploads(incoming, local){
  var A=(incoming&&typeof incoming==='object')?incoming:{};
  var B=(local&&typeof local==='object')?local:{};
  var out={}, keys={};
  Object.keys(A).forEach(function(k){keys[k]=1;});
  Object.keys(B).forEach(function(k){keys[k]=1;});
  Object.keys(keys).forEach(function(pk){
    var seen={}, merged=[];
    [A[pk], B[pk]].forEach(function(lst){
      if(!Array.isArray(lst)) return;
      lst.forEach(function(it){
        if(!it||typeof it!=='object') return;
        var nm=it.name||'';
        if(UPLOAD_TOMBS[pk+'::'+nm]) return;
        var sig=nm+'::'+(it.ts||0);
        if(sig in seen){
          var ex=merged[seen[sig]];
          if(String(it.text||'').length > String(ex.text||'').length) merged[seen[sig]]=it;
          return;
        }
        seen[sig]=merged.length; merged.push(it);
      });
    });
    out[pk]=merged;
  });
  return out;
}
function _mergeChunks(incoming, local){
  var A=(incoming&&typeof incoming==='object')?incoming:{};
  var B=(local&&typeof local==='object')?local:{};
  var out={}, keys={};
  Object.keys(A).forEach(function(k){keys[k]=1;});
  Object.keys(B).forEach(function(k){keys[k]=1;});
  Object.keys(keys).forEach(function(pk){
    var seen={}, merged=[];
    [A[pk], B[pk]].forEach(function(lst){
      if(!Array.isArray(lst)) return;
      lst.forEach(function(it){
        if(!it||typeof it!=='object') return;
        var src=it.file||it.source||it.cite||'';
        if(src && UPLOAD_TOMBS[pk+'::'+src]) return;
        var cid=it.id||(src+'|'+String(it.text||'').slice(0,40));
        if(seen[cid]) return;
        seen[cid]=1; merged.push(it);
      });
    });
    out[pk]=merged;
  });
  return out;
}
/* ══ 文件记忆删除墓碑（2026-09-21）══
 * 服务端已对 UPLOADS / KB_FILE_CHUNKS 改为只增不减（防止任一端空值把文件记忆清掉），
 * 因此删除必须显式打墓碑，否则删完下次同步又被合并回来。键：'projKey::fileName'。 */
var UPLOAD_TOMBS={};
try{ UPLOAD_TOMBS=JSON.parse(localStorage.getItem('HXZ_UPLOAD_TOMBS')||'{}')||{}; }catch(_){ UPLOAD_TOMBS={}; }
function _tombUploadFile(pk, name){
  if(!pk||!name) return;
  UPLOAD_TOMBS[pk+'::'+name]=Date.now();
  try{ localStorage.setItem('HXZ_UPLOAD_TOMBS', JSON.stringify(UPLOAD_TOMBS)); }catch(_){}
}
function _mergeUploadTombs(incoming){
  if(!incoming || typeof incoming!=='object') return;
  Object.keys(incoming).forEach(function(k){
    var t=Number(incoming[k])||0;
    if(!UPLOAD_TOMBS[k] || t>UPLOAD_TOMBS[k]) UPLOAD_TOMBS[k]=t;
  });
  try{ localStorage.setItem('HXZ_UPLOAD_TOMBS', JSON.stringify(UPLOAD_TOMBS)); }catch(_){}
}
/* 按墓碑过滤文件记忆，restore/同步后统一调用 */
function _applyUploadTombs(){
  try{
    Object.keys(UPLOADS||{}).forEach(function(pk){
      if(!Array.isArray(UPLOADS[pk])) return;
      UPLOADS[pk]=UPLOADS[pk].filter(function(u){ return !(u && UPLOAD_TOMBS[pk+'::'+(u.name||'')]); });
    });
    Object.keys(KB_FILE_CHUNKS||{}).forEach(function(pk){
      if(!Array.isArray(KB_FILE_CHUNKS[pk])) return;
      KB_FILE_CHUNKS[pk]=KB_FILE_CHUNKS[pk].filter(function(c){
        var n=c&&(c.file||c.source||c.cite||''); return !(n && UPLOAD_TOMBS[pk+'::'+n]);
      });
    });
  }catch(_){}
}
/* ══ 问答会话删除墓碑（2026-09-21）══
 * 与「知识条目删除后复活」同构：kbDeleteSession 只改本地，而 KB_CHAT 的合并
 * （客户端 _mergeKbChat 与服务端 _merge_kbchat）都是「key 并集 + 同 id 择优」，只增不减。
 * 没有墓碑时，删掉的会话会在下一次 restoreFromServer 从服务端原样合并回来（删了又回来）。
 * 结构：KB_CHAT_TOMBS = { 'city:xx::sessionId': deletedAtTs }，随 persist 同步到服务端。 */
var KB_CHAT_TOMBS={};
try{ KB_CHAT_TOMBS=JSON.parse(localStorage.getItem('HXZ_KBCHAT_TOMBS')||'{}')||{}; }catch(_){ KB_CHAT_TOMBS={}; }
function _kbChatTombKey(ck, sid){ return ck+'::'+sid; }
function _tombKbChatSession(ck, sid){
  if(!ck||!sid) return;
  KB_CHAT_TOMBS[_kbChatTombKey(ck,sid)]=Date.now();
  try{ localStorage.setItem('HXZ_KBCHAT_TOMBS', JSON.stringify(KB_CHAT_TOMBS)); }catch(_){}
}
function _mergeKbChatTombs(incoming){
  if(!incoming || typeof incoming!=='object') return;
  Object.keys(incoming).forEach(function(k){
    var t=Number(incoming[k])||0;
    if(!KB_CHAT_TOMBS[k] || t>KB_CHAT_TOMBS[k]) KB_CHAT_TOMBS[k]=t;
  });
  try{ localStorage.setItem('HXZ_KBCHAT_TOMBS', JSON.stringify(KB_CHAT_TOMBS)); }catch(_){}
}
function _mergeKbChat(incoming, local){
  var _inc=(incoming && typeof incoming==='object')?incoming:{};
  var _loc=(local && typeof local==='object')?local:{};
  var norm=function(st,k){
    if(Array.isArray(st)) return {sessions:[{id:'s_leg_'+k,title:'',ts:0,messages:st}],activeId:null};
    if(st && st.sessions) return st;
    return {sessions:[],activeId:null};
  };
  var merged={}, allKeys={};
  Object.keys(_inc).forEach(function(k){allKeys[k]=1;});
  Object.keys(_loc).forEach(function(k){allKeys[k]=1;});
  Object.keys(allKeys).forEach(function(k){
    var A=norm(_inc[k],k), B=norm(_loc[k],k);
    var byId={}, order=[];
    var take=function(se){
      if(!se||!se.id) return;
      // 已删除的会话不再从任何来源合并回来（防「删了又回来」）
      if(KB_CHAT_TOMBS[_kbChatTombKey(k,se.id)]) return;
      var ex=byId[se.id];
      if(!ex){ byId[se.id]=se; order.push(se.id); return; }
      var exN=(ex.messages||[]).length, newN=(se.messages||[]).length;
      var exT=Number(ex.ts)||0, newT=Number(se.ts)||0;
      if(newN>exN || (newN===exN && newT>exT)) byId[se.id]=se;
    };
    A.sessions.forEach(take); B.sessions.forEach(take);
    var sessions=order.map(function(id){return byId[id];});
    merged[k]={sessions:sessions, activeId:B.activeId||A.activeId||(sessions.length?sessions[sessions.length-1].id:null)};
  });
  // 一次性清理：2026-09-21 排查本 bug 时用 city:__probe__ 做过服务端合并探针。
  // 服务端 KB_CHAT 合并是「key 并集 + 永不删除」，该孤立键无法通过同步清掉，
  // 故在客户端读入时丢弃（不属于任何真实城市，不影响业务数据）。
  delete merged['city:__probe__'];
  return merged;
}
/* ══ 多会话（session）层 ══
 * 旧结构：KB_CHAT[cur] = [msg,...]（单一扁平消息流，所有历史混在一起）
 * 新结构：KB_CHAT[cur] = { sessions:[{id,title,ts,messages:[msg,...]}], activeId }
 * kbSessionStore() 负责把旧数组就地迁移为新结构（旧记录包成一个"历史对话"会话，不丢数据）。 */
var KB_SESSION_IDLE_MS = 6*60*60*1000; // 闲置超过6小时自动开新会话
/* 问答记忆按【城市】聚合，而非按方向(project key)。
 * 同一城市下的多个招商方向(sz / pmsslgvs0 / proj_msr6nug8 ...)共享同一份问答记忆，
 * 否则切换方向后记忆库问答数会显示为 0（历史问答被隔离在别的方向 key 下）。 */
function kbChatKey(key){
  key = key || cur;
  if(key && PROJECTS[key] && PROJECTS[key].city) return 'city:'+PROJECTS[key].city;
  return key;
}
/* 一次性迁移：把历史上按方向(project key)存的问答会话归并到对应城市 key 下。
 * 在 restore / restoreFromServer 之后调用（此时 PROJECTS 已就位，才能查到城市）。 */
function migrateKbChatToCity(){
  if(!KB_CHAT || typeof KB_CHAT!=='object') return;
  var moved=false;
  Object.keys(KB_CHAT).forEach(function(k){
    if(k.indexOf('city:')===0) return;
    var proj=PROJECTS[k]; var city=proj&&proj.city;
    if(!city) return;
    var ck='city:'+city;
    var src=KB_CHAT[k];
    var srcSt = Array.isArray(src)
      ? {sessions:[{id:'s'+Date.now()+Math.floor(Math.random()*1000),title:kbDeriveTitle(src),ts:(src[0]&&src[0].ts)||Date.now(),messages:src}],activeId:null}
      : (src&&src.sessions?src:{sessions:[],activeId:null});
    if(!KB_CHAT[ck]||!KB_CHAT[ck].sessions) KB_CHAT[ck]={sessions:[],activeId:null};
    var existIds={}; KB_CHAT[ck].sessions.forEach(function(s){existIds[s.id]=true;});
    srcSt.sessions.forEach(function(s){ if(s&&!existIds[s.id]){ KB_CHAT[ck].sessions.push(s); existIds[s.id]=true; } });
    if(!KB_CHAT[ck].activeId && srcSt.activeId) KB_CHAT[ck].activeId=srcSt.activeId;
    delete KB_CHAT[k];
    moved=true;
  });
  Object.keys(KB_CHAT).forEach(function(ck){ if(KB_CHAT[ck]&&KB_CHAT[ck].sessions) KB_CHAT[ck].sessions.sort(function(a,b){return (a.ts||0)-(b.ts||0);}); });
  if(moved){ try{persist();}catch(_){} }
}
function kbSessionStore(key){
  key = kbChatKey(key || cur); if(!key) return null;
  var v = KB_CHAT[key];
  // 迁移：旧数组格式 → 新结构
  if(Array.isArray(v)){
    var msgs = v;
    var sess = { id:'s'+Date.now()+Math.floor(Math.random()*1000), title:kbDeriveTitle(msgs), ts:(msgs[0]&&msgs[0].ts)||Date.now(), messages:msgs };
    KB_CHAT[key] = { sessions:[sess], activeId:sess.id };
    return KB_CHAT[key];
  }
  if(!v || typeof v!=='object'){ KB_CHAT[key] = { sessions:[], activeId:null }; return KB_CHAT[key]; }
  if(!v.sessions) v.sessions=[];
  return v;
}
// 从消息数组推导会话标题：取首条用户提问前20字
function kbDeriveTitle(msgs){
  if(!msgs||!msgs.length) return '新对话';
  for(var i=0;i<msgs.length;i++){
    if(msgs[i].role==='user'){
      var t=(msgs[i].text||'').replace(/<[^>]+>/g,'').trim();
      if(t) return t.length>20?t.slice(0,20)+'…':t;
    }
  }
  return '新对话';
}
// 取当前活动会话对象（无则新建一个）
function kbActiveSession(key){
  key = key || cur; var st=kbSessionStore(key); if(!st) return null;
  var s = st.sessions.filter(function(x){return x.id===st.activeId;})[0];
  if(!s){
    // 闲置自动分段：最近会话超过阈值未活动则开新会话
    var latest = st.sessions[st.sessions.length-1];
    if(latest && (Date.now()-(latest.ts||0) < KB_SESSION_IDLE_MS)){ s=latest; st.activeId=s.id; }
    else { s=kbNewSession(key,true); }
  }
  return s;
}
// 取当前活动会话的消息数组（下游 push/replay/view 统一走它）
function kbActiveMsgs(key){ var s=kbActiveSession(key); return s?s.messages:[]; }
// 新建会话；silent=true 时不重绘（供内部调用）
function kbNewSession(key, silent){
  key = key || cur; var st=kbSessionStore(key); if(!st) return null;
  var s = { id:'s'+Date.now()+Math.floor(Math.random()*1000), title:'新对话', ts:Date.now(), messages:[] };
  st.sessions.push(s); st.activeId=s.id;
  if(!silent){ persist(); var c=document.getElementById('kbConv'); if(c) c.innerHTML=''; try{kbChatReplay();}catch(_){}; try{renderKbSessionBar();}catch(_){} }
  return s;
}
// 切换到指定会话
function kbSwitchSession(id){
  var st=kbSessionStore(); if(!st) return;
  st.activeId=id; persist();
  var c=document.getElementById('kbConv'); if(c) c.innerHTML='';
  try{kbChatReplay();}catch(_){}; try{renderKbSessionBar();}catch(_){}
  try{closeKbHistory();}catch(_){}
}
// 删除指定会话
function kbDeleteSession(id){
  var st=kbSessionStore(); if(!st) return;
  // 先打墓碑：否则下次 restoreFromServer 会把它从服务端合并回来
  try{ _tombKbChatSession(kbChatKey(cur), id); }catch(_){}
  st.sessions=st.sessions.filter(function(x){return x.id!==id;});
  if(st.activeId===id) st.activeId = st.sessions.length?st.sessions[st.sessions.length-1].id:null;
  persist();
  var c=document.getElementById('kbConv'); if(c) c.innerHTML='';
  try{kbChatReplay();}catch(_){}; try{renderKbSessionBar();}catch(_){}
}
// 渲染对话区顶部的会话条：新对话按钮 + 当前会话名 + 历史会话入口
function renderKbSessionBar(){
  var bar=document.getElementById('kbSessionBar'); if(!bar) return;
  var st=kbSessionStore(cur);
  var active = st ? st.sessions.filter(function(x){return x.id===st.activeId;})[0] : null;
  var cnt = st ? st.sessions.filter(function(s){return s.messages&&s.messages.length;}).length : 0;
  var curName = (active&&active.messages&&active.messages.length)?(active.title||'新对话'):'新对话';
  bar.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding:8px 10px;background:linear-gradient(180deg,#fbfdff,#f5f8fd);border:1px solid #e6eef8;border-radius:11px">'+
      // 新对话：主按钮，蓝底
      '<button onclick="kbNewSession()" title="开启一个新的问答会话" style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:#fff;background:linear-gradient(180deg,#0a63c2,#013582);border:0;border-radius:9px;padding:7px 13px;cursor:pointer;box-shadow:0 2px 6px rgba(1,53,130,.18)">'+
        '<span style="font-size:14px;line-height:1">✚</span>新对话</button>'+
      // 当前会话名：带小圆点 + 省略
      '<div style="flex:1;min-width:0;display:flex;align-items:center;gap:7px">'+
        '<span style="flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:#12b886;box-shadow:0 0 0 3px #d7f5ea"></span>'+
        '<span style="font-size:12.5px;color:#334155;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+curName+'</span>'+
      '</div>'+
      // 历史会话：胶囊按钮 + 计数徽标
      '<button onclick="openKbHistory()" title="查看全部历史会话" style="flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:550;color:#0757ad;background:#fff;border:1px solid #cfe0f1;border-radius:9px;padding:7px 12px;cursor:pointer;transition:all .15s" onmouseover="this.style.background=\'#f0f6fe\';this.style.borderColor=\'#a9c8ec\'" onmouseout="this.style.background=\'#fff\';this.style.borderColor=\'#cfe0f1\'">'+
        '<span style="font-size:13px;line-height:1">🕘</span>历史会话'+
        (cnt?('<span style="min-width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px;font-size:11px;font-weight:700;color:#fff;background:#0757ad;border-radius:9px">'+cnt+'</span>'):'')+
      '</button>'+
    '</div>';
}
// 打开历史会话抽屉
function openKbHistory(){
  closeKbHistory();
  var st=kbSessionStore(cur); if(!st) return;
  var sessions=st.sessions.filter(function(s){return s.messages&&s.messages.length;}).slice().reverse();
  var rows = sessions.length ? sessions.map(function(s){
    var isActive=st.activeId===s.id;
    var qn=(s.messages||[]).filter(function(m){return m.role==='user';}).length;
    return '<div style="display:flex;align-items:center;gap:9px;padding:11px 13px;border:1px solid '+(isActive?'#cfe0f1':'#eef2f7')+';border-radius:10px;margin-bottom:8px;background:'+(isActive?'#f5f9fe':'#fff')+'">'+
      '<div onclick="kbSwitchSession(\''+s.id+'\')" style="flex:1;min-width:0;cursor:pointer">'+
        '<div style="font-size:13px;font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(s.title||'新对话')+(isActive?' <span style="font-size:10px;color:#0757ad;font-weight:500">· 当前</span>':'')+'</div>'+
        '<div style="font-size:11px;color:#94a3b8;margin-top:2px">'+fmtTs(s.ts)+' · '+qn+' 个提问</div>'+
      '</div>'+
      '<button onclick="event.stopPropagation();kbDeleteSession(\''+s.id+'\');openKbHistory()" title="删除会话" style="flex:0 0 auto;background:none;border:none;color:#cbd5e1;font-size:15px;cursor:pointer;padding:3px" onmouseover="this.style.color=\'#dc2626\'" onmouseout="this.style.color=\'#cbd5e1\'">\u2715</button>'+
    '</div>';
  }).join('') : '<div style="padding:30px;text-align:center;color:#94a3b8;font-size:13px">还没有历史会话</div>';
  var wrap=document.createElement('div');
  wrap.id='kbHistoryDrawer';
  wrap.style.cssText='position:fixed;inset:0;z-index:120;background:rgba(10,25,51,.28);display:flex;justify-content:flex-end';
  wrap.onclick=function(e){ if(e.target===wrap) closeKbHistory(); };
  wrap.innerHTML='<div style="width:min(400px,92vw);height:100%;background:#fff;box-shadow:-14px 0 40px rgba(11,31,65,.18);display:flex;flex-direction:column">'+
    '<div style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid #eef2f7">'+
      '<strong style="font-size:16px;color:#0b183b">历史会话</strong>'+
      '<button onclick="closeKbHistory()" style="width:32px;height:32px;border:0;border-radius:8px;background:#f4f6f9;cursor:pointer;font-size:15px">\u2715</button>'+
    '</div>'+
    '<div style="padding:14px 16px;border-bottom:1px solid #eef2f7">'+
      '<button onclick="kbNewSession();closeKbHistory()" style="width:100%;display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:13px;font-weight:600;color:#fff;background:#013582;border:0;border-radius:9px;padding:10px;cursor:pointer">'+
        '<span style="font-size:14px;line-height:1">✚</span> 开启新对话</button>'+
    '</div>'+
    '<div style="flex:1;overflow:auto;padding:14px 16px">'+rows+'</div>'+
  '</div>';
  document.body.appendChild(wrap);
}
function closeKbHistory(){ var d=document.getElementById('kbHistoryDrawer'); if(d) d.remove(); }
// 记录一条消息：把 DOM 节点的 outerHTML 存进当前会话的对话数组并持久化
function kbChatPush(role, html){
  if(!cur) return;
  var _s=kbActiveSession(cur); if(!_s) return;
  // 只存 bubble 内容文本，避免 data-URI 头像导致 localStorage 超限
  var text = html;
  try {
    var _tmp=document.createElement('div'); _tmp.innerHTML=html;
    var _bub=_tmp.querySelector('.message-bubble');
    text = _bub ? _bub.innerHTML : (_tmp.textContent||html);
  } catch(e){}
  // 去重：同 role + 相同文本在 3 秒内不重复存
  var last=_s.messages[_s.messages.length-1];
  if(last && last.role===role && last.text===text && Date.now()-last.ts<3000) return;
  _s.messages.push({role:role, text:text, ts:Date.now()});
  // 首条用户提问确定会话标题（原为"新对话"时）
  if(role==='user' && (_s.title==='新对话'||!_s.title)) _s.title=kbDeriveTitle(_s.messages);
  _s.ts=Date.now();
  // 最多保留最近 100 条，防止无限增长
  if(_s.messages.length>100) _s.messages=_s.messages.slice(-100);
  persist();
  // 问答记忆:绕过5秒防抖立即 fetch 同步一次（不用 sendBeacon，因为它对 >64KB payload 会静默 return false;
  // 本项目 localStorage 整体 body 已 2MB，必须走 fetch 才能确保推上去）。
  try{
    var _kbBody=localStorage.getItem(LS_KEY)||'{}';
    fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:_kbBody}).catch(function(){});
  }catch(_){}
  try{updateKbConvCount();}catch(_){}
  try{renderKbSessionBar();}catch(_){}
}
// 更新最后一条 AI 消息内容（流式回复结束后调用）
function kbChatUpdateLast(html){
  if(!cur) return;
  var _s=kbActiveSession(cur); if(!_s||!_s.messages.length) return;
  var text = html;
  try {
    var _tmp=document.createElement('div'); _tmp.innerHTML=html;
    var _bub=_tmp.querySelector('.message-bubble');
    text = _bub ? _bub.innerHTML : (_tmp.textContent||html);
  } catch(e){}
  _s.messages[_s.messages.length-1].text=text;
  _s.messages[_s.messages.length-1].ts=Date.now();
  persist();
}
// AI 动态生成本市建议问题（进入城市智库时调用，替换所有硬编码问题）
var _kbSuggestCache={};
function kbGenSuggestions(){
  var listEl=document.getElementById('kbSuggestList');
  var p=P(); if(!listEl||!p||!p.city) return;
  var city=p.city;
  function fill(qs){
    if(!qs||!qs.length){ listEl.innerHTML='<li style="font-size:12.5px;color:#9aa5b5">· 暂无建议，直接在下方输入你的问题即可</li>'; return; }
    listEl.innerHTML=qs.map(function(q){
      var safe=q.replace(/'/g,"\\'");
      return '<li style="font-size:12.5px;color:#1a56db;cursor:pointer;line-height:1.7" onclick="askKB(\''+safe+'\')">• '+q+'</li>';
    }).join('');
  }
  // 会话内缓存，避免每次渲染都重复调用
  if(_kbSuggestCache[cur]){ fill(_kbSuggestCache[cur]); return; }
  var chunks=(typeof buildKBCorpus==='function')?buildKBCorpus(city):[];
  fetch(KB_API,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question:'请为'+city+'生成4个招商建议问题',chunks:chunks,city:city,stream:false,mode:'suggest'})
  }).then(function(r){return r.ok?r.json():null;}).then(function(j){
    var txt=(j&&j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content)||'';
    var qs=txt.split('\n').map(function(l){return l.replace(/^[\s\d.、)）·•\-]+/,'').trim();}).filter(function(l){return l.length>3;}).slice(0,4);
    if(qs.length){ _kbSuggestCache[cur]=qs; }
    fill(qs);
  }).catch(function(){ fill(null); });
}
// 上传后三个分析按钮的 HTML（供首次追加与 replay 复用，保持样式一致）
function ingestActionsHtml(){
  return '<div id="kbIngestActions" style="margin:10px 0 4px 60px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">'+
    '<span style="font-size:12px;color:#8492a6;margin-right:2px">选择分析方式：</span>'+
    '<button onclick="kbIncrementalAnalysis()" style="padding:7px 14px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:20px;font-size:12.5px;font-weight:600;cursor:pointer">📄 仅分析新材料（推荐）</button>'+
    '<button onclick="kbRAGQueryFull()" style="padding:7px 14px;background:#f5f7fb;color:#334155;border:1.5px solid #e2e8f0;border-radius:20px;font-size:12.5px;cursor:pointer">🔄 结合全库重新分析</button>'+
    '<button data-action="verify" onclick="kbVerifyMaterial()" style="padding:7px 14px;background:#fff7ed;color:#c2410c;border:1.5px solid #fed7aa;border-radius:20px;font-size:12.5px;cursor:pointer">🔍 校验材料可信度</button>'+
  '</div>';
}
// 从持久化标记恢复上传上下文，让三个按钮点击后能拿到本批 chunks
function restoreIngestCtx(m){
  if(!m||!cur) return;
  var arr=KB_FILE_CHUNKS[cur]||[];
  window._lastIngestChunks = m.n ? arr.slice(-m.n) : [];
  window._lastIngestTopicLabel = m.label||'城市智库';
  window._lastIngestKbIdx = (m.kbIdx===undefined||m.kbIdx===null?null:m.kbIdx);
}
// 把已存的历史对话回放进 #kbConv（在 render 重建容器后调用）
function kbChatReplay(){
  if(document.getElementById('kbSuggestList')) kbGenSuggestions();
  try{renderKbSessionBar();}catch(_){}
  var c=document.getElementById('kbConv');
  if(!c||!cur) return;
  var _msgs=kbActiveMsgs(cur);
  if(!_msgs||!_msgs.length) return;
  var frag='';
  var _lastActions=null;
  _msgs.forEach(function(m){
    // 上传后的三个分析按钮：重建并恢复本批上下文（否则 render/刷新/跨标签后按钮会丢）
    if(m.role==='ingest-actions'){ frag+=ingestActionsHtml(); _lastActions=m; return; }
    // 新要点追加面板：用结构化数据重建按钮（否则下方正则会把「+加入/全部追加」按钮删掉）
    if(m.role==='new-facts' && m.facts && m.facts.length){
      frag+='<div class="message"><img src="'+aiAvatar()+'"><div class="message-bubble">'+
        newFactsPanelHtml((m.kbIdx===undefined||m.kbIdx===null)?0:m.kbIdx, m.facts, m.label||'城市智库')+'</div></div>';
      return;
    }
    // 兼容旧格式 {role,html}，新格式 {role,text,ts}
    if(!m.text && m.html){ frag+=m.html; return; }
    var content=m.text||'';
    if(m.role==='user'){
      frag+='<div class="message is-user"><div class="message-bubble"><p>'+content+'</p></div></div>';
    } else {
      // 回放时去除交互按钮（onclick已失效）
      var safeContent=content.replace(/<button[^>]*onclick[^>]*>.*?<\/button>/gi,'').replace(/<div[^>]*id="kbIngestActions"[^>]*>.*?<\/div>/gi,'');
      frag+='<div class="message"><img src="'+aiAvatar()+'"><div class="message-bubble">'+safeContent+'</div></div>';
    }

  });
  c.insertAdjacentHTML('beforeend', frag);
  // 恢复最近一批上传的分析上下文，使重建的按钮点击后仍能拿到 chunks
  if(_lastActions) try{ restoreIngestCtx(_lastActions); }catch(_){}
  c.scrollTop=c.scrollHeight;
}
// 招引方向派生的项目（方案A三层：产业方向→报告→招引方向项目）{产业key:[{name,stage,from}]}
var SUBPROJ={};
function saveSubproj(){try{localStorage.setItem('hxz_subproj',JSON.stringify(SUBPROJ))}catch(e){}}
function loadSubproj(){try{var d=localStorage.getItem('hxz_subproj');if(d)SUBPROJ=JSON.parse(d)}catch(e){}}
function subprojOf(k){return SUBPROJ[k]||[]}
function _slimUploads(){var o={};try{Object.keys(UPLOADS||{}).forEach(function(pk){o[pk]=(UPLOADS[pk]||[]).map(function(u){if(!u||typeof u!=='object')return u;var c={};for(var k in u){if(k==='dataUrl')continue;c[k]=u[k];}return c;});});}catch(_){o=UPLOADS;}return o;}
function saveUploads(){try{localStorage.setItem('hxz_uploads',JSON.stringify(_slimUploads()))}catch(e){}}
function loadUploads(){try{var d=localStorage.getItem('hxz_uploads');if(d)UPLOADS=JSON.parse(d)}catch(e){}}
function addUpload(name){var k=cur;if(!UPLOADS[k])UPLOADS[k]=[];UPLOADS[k].push({name:name,at:new Date().toLocaleString('zh-CN')});saveUploads();}
loadReportState();loadUploads();loadSubproj();try{_dedupeDemands();}catch(_){}
// 迁移：清理 seedDemo 遗留的假上传条目（格式为 {name,at}，无 size/ts）
(function cleanFakeUploads(){
  if(localStorage.getItem('hxz_uploads_cleaned_v1')) return;
  Object.keys(UPLOADS).forEach(function(k){
    UPLOADS[k]=(UPLOADS[k]||[]).filter(function(u){ return !!u.size||!!u.ts||!!u.chunks; });
  });
  saveUploads();
  localStorage.setItem('hxz_uploads_cleaned_v1','1');
})();
// 预置样板：随州氢能一条完整主线（其余方向留白，避免全空也不塞满假数据）
(function seedDemo(){
  if(localStorage.getItem('hxz_seeded_v3'))return;
  REPORTSTATE.sz={ver:2,finalized:true,patches:['楚胜汽车园区可承接电控配套'],edits:{}};
  UPLOADS.sz=[];
  // 派生项目：dir 与 clueName 必须与 PROJECTS.sz.clues 完全一致，右侧栏/工作页才能匹配到候选企业
  SUBPROJ.sz=[
    {name:'商用车燃料电池系统集成商 · 引进项目',dir:'商用车燃料电池系统集成商 · 长三角',clueName:'脱敏企业 A（氢驰动力·代号）',stage:5,from:'氢能专用车产业补链'},
    {name:'燃料电池电堆研发与制造 · 引进项目',dir:'燃料电池电堆研发与制造企业 · 华南',clueName:'脱敏企业 B（势通氢能·代号）',stage:4,from:'氢能专用车产业补链'}
  ];
  // 随州氢能已定稿并派生项目、进入对接 → 阶段应到「招商对接」，否则进度条/招商对接页与事实矛盾
  if(PROJECTS.sz)PROJECTS.sz.stage=5;
  saveReportState();saveUploads();saveSubproj();
  // 不在seed中persist，等restoreFromServer判断服务器是否已有数据
  try{localStorage.setItem('hxz_seeded_v3','1')}catch(e){}
})();
// 历史报告 / 上传材料 弹窗（Ryan要的"第二天在哪看"）
function openHistory(){
  var st=REPORTSTATE[cur];var ups=UPLOADS[cur]||[];
  var repHtml = st ? ('<div class="source-list"><li onclick="closeModal();go(\'report\');setTimeout(showReport,60)" style="cursor:pointer"><i class="i">📄</i>'+P().topic+' 研判报告 · v'+st.ver+(st.finalized?'（已定稿）':'（草稿）')+'<small>点击重新打开</small></li></div>') : '<p class="modal-intro">该项目暂无已生成的报告。</p>';
  var upHtml = ups.length ? ('<ul class="source-list">'+ups.map(function(u){return '<li><i class="i">📎</i>'+u.name+'<small>'+u.at+'</small></li>'}).join('')+'</ul>') : '<p class="modal-intro">暂无上传的材料。</p>';
  openModal('历史报告 / 上传材料',
    '<div style="font-size:12px;font-weight:650;color:#0b183b;margin:2px 0 8px">📄 历史报告</div>'+repHtml+
    '<div style="font-size:12px;font-weight:650;color:#0b183b;margin:16px 0 8px">📎 上传过的材料</div>'+upHtml+
    '<div class="boundary-note" style="margin-top:14px"><i class="i">ℹ</i>报告与材料已本地保存，关闭页面后再次打开仍可查看。</div>',
    '<button class="primary-button" onclick="closeModal()">完成</button>');
}
function convEl(){return $('#conv')||$('#kbConv')}
function addU(t){var c=$('#conv');if(!c)return;var d=document.createElement('div');d.className='message is-user';
  d.innerHTML='<div class="message-bubble"><p>'+t+'</p></div>';c.appendChild(d);sd()}
function addA(html){var c=$('#conv');if(!c)return;var d=document.createElement('div');d.className='message';
  d.innerHTML='<img src="'+aiAvatar()+'"><div class="message-bubble">'+html+'</div>';c.appendChild(d);sd();return d}
function addRaw(html){var c=$('#conv');if(!c)return;var d=document.createElement('div');d.style.margin='0 0 20px 60px';d.innerHTML=html;c.appendChild(d);sd();return d}
function sd(){var c=$('#conv');if(c)c.scrollTop=c.scrollHeight}
function setStage(n){var p=P();p.stage=n;if(!p.stageByTopic)p.stageByTopic={};if(p.topic!=null)p.stageByTopic[p.topic]=n;if(cur)syncDemandStage(cur);var f=$('.progress-footer');if(f)f.outerHTML=progressFooter(p);}

function startFlow(mode){
  if(view!=='report'){view='report';render();}
  var p=P();
  var label={direction:'围绕 '+p.topic+' 分析'+p.city+'的上下游缺口与招引环节',
             upload:'[上传] '+p.city+'市2026年政府工作报告.pdf',
             verify:'帮我核验几家目标企业是否值得招引'}[mode];
  // 清空prompt-list
  var pl=$('.prompt-list');if(pl)pl.remove();
  addU(label);
  if(p.stage<2)setStage(2);
  var _kbStr=(p.kb||[]).map(function(k){return k.t}).join('、');
  addA('<p>已开始结合<strong>'+p.city+'城市智库</strong>（覆盖：'+_kbStr+'）、授权材料与最新公开信息研判「'+p.topic+'」。下一步先给出产业链缺口与建议招引方向，再明确仍需补充与核实的事项。</p><p>可继续补充材料，也可直接生成初步报告。</p>');
  setTimeout(function(){ p.report?showReport():addA('<p>正在基于城市智库生成「'+p.topic+'」研判报告，请稍候…</p>'); },600);
}
// 报告：复刻雷总 report-document 结构 + 版本迭代/人工可编辑/定稿
// 工作台常驻：任何时候重绘后，若当前城市有 running 申请，自动拉取并固定渲染工作台（不依赖手动注入）
function showReport(){
  var r=P().report;if(!r){startFlow('direction');return;}
  var st=rs();
  var band='<div class="report-summary-band">'+r.summary.map(function(s){return '<div><span>'+s[0]+'</span><strong>'+s[1]+'</strong></div>'}).join('')+'</div>';
  var secs=r.sections.map(function(s,i){var ev=encodeURIComponent(JSON.stringify(s));
    var badge=s.type==='virt'?'<span class="status-tag amber" style="margin-left:8px">待核实</span>':'<span class="status-tag teal" style="margin-left:8px">实据</span>';
    var chk=s.chk?'<span class="report-evidence" style="color:#a34c09"><i class="i">⚠</i>仍需确认：'+s.chk+'</span>':'';
    var edited=st.edits[i];  // 人工修正过的文字
    var body=edited?('<p style="color:#013582"><i class="i">✎</i> '+edited+' <em style="color:#9aa5b5;font-style:normal;font-size:11px">（人工修正）</em></p>'):('<p>'+s.p+'</p>');
    var editBtn=st.finalized?'':'<button class="link-btn" style="border:0;background:none;color:#0757ad;font-size:11px;cursor:pointer;padding:2px 0" onclick="event.stopPropagation();editSection('+i+')">✎ 修正此条</button>';
    return '<div class="report-section"><span>0'+(i+1)+'</span>'+
      '<div style="flex:1"><h2 style="cursor:pointer" onclick="pickFold(\''+ev+'\',this)">'+s.h+badge+'</h2>'+body+
      '<span class="report-evidence" style="cursor:pointer" onclick="pickFold(\''+ev+'\',this)"><i class="i">🔎</i>依据：'+s.ev+'</span>'+chk+' '+editBtn+'</div></div>';}).join('');
  // 版本头 + 补充优化区
  var verTag='<span class="status-tag" style="background:#eef3fb;color:#013582">v'+st.ver+(st.finalized?' · 已定稿':' · 草稿')+'</span>';
  var patchLog=st.patches.length?('<div style="margin-top:10px;padding:10px 12px;background:#f7f9fc;border-radius:8px;font-size:12px;color:#556"><strong>修订记录：</strong>'+st.patches.map(function(p,i){return '<div style="margin-top:4px">v'+(i+2)+' · 据补充「'+p+'」重新生成</div>'}).join('')+'</div>'):'';
  var optArea=st.finalized?
    '<div class="report-footnote" style="color:#15803d">✅ 报告已定稿并锁定，可进行双确认递交。</div>':
    '<div style="margin-top:14px;padding:13px 15px;background:#f3f7fd;border:1px solid #d8e0ed;border-radius:10px">'+
      '<div style="font-size:13px;font-weight:650;color:#0b183b;margin-bottom:8px">🔄 报告来回优化</div>'+
      '<div style="font-size:11.5px;color:#667590;margin-bottom:8px">补充材料或指出问题，我会<strong>结合你的补充重新生成一份完整报告</strong>（保留历史版本）；也可点每条「✎ 修正此条」直接人工改写。</div>'+
      '<textarea id="patchInput" placeholder="例如：补充——楚胜汽车园区可承接；或：第2条判断有误，电控本地已有供应…" style="width:100%;min-height:52px;border:1px solid #cdd8e8;border-radius:8px;padding:9px 11px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box"></textarea>'+
      '<div style="display:flex;gap:8px;margin-top:9px"><button class="primary-button" style="flex:0 0 auto" onclick="applyPatch()">🔄 结合补充重新生成</button>'+
      '<button class="ghost-button" onclick="finalizeReport()">🔒 报告定稿</button></div>'+
    '</div>';
  var confirmArea=st.finalized?
    ('<div class="detail-actions-stack" style="border:0;padding:16px 0 0">'+
      '<div class="confirm-row" onclick="cadreOK(this)"><input type="checkbox" id="ck1"><span><strong>干部确认</strong><small>确认判断准确、需求成立</small></span></div>'+
      '<div class="confirm-row" onclick="leaderOK(this)"><input type="checkbox" id="ck2" disabled><span><strong>授权确认</strong><small>确认后开放</small></span></div>'+
      '<button class="primary-button" id="submitBtn" disabled onclick="submitNeed()"><i class="i">🚀</i>完成双确认 · 正式递交</button>'+
      '<small>双确认通过后，报告的补链方向将自动建成项目并挂到「招商对接」</small>'+
    '</div>'):
    '<div class="report-footnote" style="color:#a34c09">⚠ 报告定稿后才能进行双确认与递交（避免半成品报告进入流程）。</div>';
  addRaw('<div class="report-document">'+
    '<div class="report-lead" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><span>STRATEGY REPORT '+verTag+'</span><p>'+r.lead+'</p></div>'+
      '<button class="ghost-button" style="flex:0 0 auto;white-space:nowrap" onclick="exportReport()"><i class="i">📤</i>导出报告</button></div>'+
    band+secs+
    '<div class="report-footnote">'+r.footnote+'</div>'+patchLog+optArea+confirmArea+'</div>');
}
// 报告页在研判进行中时轮询专员活动流（每20秒）
var _govPollTimer=null;
function editSection(i){
  var st=rs();var cur=st.edits[i]||P().report.sections[i].p;
  var v=prompt('人工修正第'+(i+1)+'条结论（直接改写，标注为人工修正）：',cur);
  if(v!==null&&v.trim()){st.edits[i]=v.trim();saveReportState();rerenderReport();toast('已人工修正第'+(i+1)+'条');}
}
// 补充意见→AI重出整份（务实：不假装只改某条）
function applyPatch(){
  var ta=$('#patchInput');if(!ta)return;var v=ta.value.trim();if(!v){toast('请先输入补充或修改意见');return;}
  var st=rs();st.patches.push(v);st.ver++;saveReportState();
  toast('已结合补充「'+v.slice(0,12)+'…」重新生成 v'+st.ver);
  rerenderReport();
}
function finalizeReport(){var st=rs();st.finalized=true;saveReportState();toast('报告已定稿并锁定');rerenderReport();}
// 重绘报告：删掉当前报告DOM重新showReport
function rerenderReport(){
  var doc=document.querySelector('.report-document');
  if(doc&&doc.parentElement)doc.parentElement.remove();
  showReport();
}
function pickFold(ev,el){detailData={kind:'fold',d:JSON.parse(decodeURIComponent(ev))};if(!detailOpen)detailOpen=true;
  var dp=$('.detail-pane');if(dp){dp.innerHTML='<button class="collapse-detail" onclick="toggleDetail()"><i class="i">✕</i></button><div class="detail-page">'+detailFold(detailData.d)+'</div>';}else render();}
function cadreOK(row){var ck=row.querySelector('input');ck.checked=true;$('#ck2').disabled=false;toast('干部已确认，待授权确认')}
function leaderOK(row){var ck=row.querySelector('input');if(ck.disabled){toast('请先完成干部确认');return;}ck.checked=true;$('#submitBtn').disabled=false;toast('确认完成，可正式递交')}
// 双确认 == 从研判进入招商对接的唯一关口：通过后报告的「补链方向」自动派生为项目
/* 跨端桥接：政府端双确认递交 → upsert 一条管理端需求池记录（黄金演示动线第1→2步） */
function syncDemandFromProject(){
  var p=P();if(!p)return;
  var cl=p.clues||[];
  var domain=(cl[0]&&String(cl[0].dir||'').split(' · ')[0])||String(p.topic||'').replace('补链','').replace('升级','').replace('智能化','');
  var exist=DEMANDS.find(function(d){return d.city===p.city&&d.topic===p.topic});
  var payload={
    city:p.city, gov:p.org+'·'+p.who, topic:p.topic, domain:domain,
    need:cl.map(function(c){return String((c&&c.dir)||'').split(' · ')[0];}).filter(function(s){return s;}).join(' / ')||p.topic,
    submit:'刚刚', res:'checking', resLabel:'核验中', clues:cl.length,
    note:'政府端双确认递交，等待资源端核验匹配。', fromGov:true
  };
  if(exist){Object.keys(payload).forEach(function(k){if(k!=='res'&&k!=='resLabel'&&k!=='clues')exist[k]=payload[k];});exist.submit='刚刚';}
  else{payload.id='dg'+Date.now();DEMANDS.unshift(payload);}
  // 更新城市漏斗（提交+确认各+1；若该城市不存在则新建）
  var f=CITY_FUNNEL.find(function(x){return x.city===p.city});
  if(f){f.submit++;f.confirm++;}else{CITY_FUNNEL.push({city:p.city,submit:1,confirm:1,match:0,dock:0,sign:0});}
  persist(); // 同步到服务器
}
function submitNeed(){
  setStage(3);
  var cl=P().clues||[];var n=cl.length;
  syncDemandFromProject();
  // 【自动派生项目】把报告里每个补链方向变成一个招引项目，挂到当前产业方向下（去重）
  if(!SUBPROJ[cur])SUBPROJ[cur]=[];
  var made=0;
  cl.forEach(function(c){
    if(SUBPROJ[cur].some(function(m){return m.name===c.dir}))return;
    SUBPROJ[cur].push({name:c.dir,dir:c.dir,clueName:c.name,stage:4,from:P().topic});
    made++;
  });
  saveSubproj();
  if(n===0){
    // 无补链方向可派生（Ryan：高概率一家都没有）——需求仍进入资源池
    addA('<p>✅ 确认完成，已生成<strong>正式招商需求</strong>并递交资源端。</p>');
    addRaw('<div class="clue-origin"><i class="i">🔗</i>需求已递交<button onclick="scrollToReport()">查看报告</button></div>'+
      '<div style="border:1px dashed #cdd8e8;border-radius:10px;padding:20px;text-align:center;background:#fafbfd">'+
        '<div style="font-size:26px;margin-bottom:6px">📭</div>'+
        '<div style="font-size:13.5px;font-weight:650;color:#0b183b">报告暂无明确补链方向</div>'+
        '<div style="font-size:12px;color:#667590;margin-top:6px;line-height:1.7">需求已进入资源池，资源端将持续核验可触达渠道，有匹配会通知你。</div>'+
        '<div style="margin-top:12px"><span class="status-tag" style="background:#fff0de;color:#a34c09">已纳入长期跟踪</span></div>'+
      '</div>'+
      '<div class="boundary-note"><i class="i">ℹ</i>无匹配也是有效结果——资源端会据此对接外部渠道，或等待新资源进入。</div>');
    setStage(4);
    setTimeout(function(){addRaw(dockPanel());setStage(5);},700);
    return;
  }
  addA('<p>✅ 确认完成，已生成<strong>正式招商需求</strong>。系统已把报告的 <strong>'+n+' 个补链方向自动建成招引项目</strong>，挂在「招商对接 › '+P().topic+'」下，可分别推进对接——</p>');
  addRaw('<div class="clue-origin"><i class="i">🔗</i>项目由报告补链方向自动派生<button onclick="scrollToReport()">查看报告</button></div>'+
    '<div class="clue-list">'+cl.map(function(c,i){return '<div class="clue-row" onclick="go(\'home\');setTimeout(function(){toggleProjGroup(\''+cur+'\')},60)"><div class="clue-icon"><i class="i">🎯</i></div>'+
      '<div class="clue-main"><strong>'+c.dir.split(' · ')[0]+'</strong><small>候选线索 '+c.name+'</small><em>已建为项目 · 点击到「招商对接」查看</em></div>'+
      '<span class="status-tag" style="background:#ebf3fd;color:#013582">已建项目</span><i class="i">➜</i></div>';}).join('')+'</div>'+
    '<div style="margin-top:10px"><button class="primary-button" onclick="go(\'home\');setTimeout(function(){toggleProjGroup(\''+cur+'\')},60)"><i class="i">📋</i>前往招商对接查看 '+n+' 个项目</button></div>'+
    '<div class="boundary-note"><i class="i">ℹ</i>项目自动生成后即为独立对接线；候选企业由资源端核验可达性，系统不自动联系企业。</div>');
  setStage(4);
  setTimeout(function(){addRaw(dockPanel());setStage(5);},700);
}
function scrollToReport(){var r=document.querySelector('.report-document');if(r){r.scrollIntoView({behavior:'smooth',block:'start'});r.style.outline='2px solid #0757ad';setTimeout(function(){r.style.outline=''},1200);}else{toast('报告在当前对话上方')}}
// 导出报告：生成完整产业分析报告文件并下载
function exportReport(){
  var p=P();var r=p.report;if(!r){toast('请先生成报告');return;}
  var now=new Date().toLocaleString('zh-CN');var L=[];
  L.push(r.title);
  L.push('导出时间：'+now+'　|　编制：'+p.org+' · '+p.who);
  L.push('数据来源：'+p.city+'城市智库 + 公开信息（更新至 '+nowLabel()+'）');
  L.push('====================================================\n');
  L.push('【摘要】');L.push(r.lead+'\n');
  L.push('【关键指标】');r.summary.forEach(function(s){L.push('  '+s[0]+'：'+s[1])});L.push('');
  L.push('【研判结论】');
  r.sections.forEach(function(s,i){
    L.push('  '+(i+1)+'、'+s.h+'　['+(s.type==='virt'?'待核实':'实据')+']');
    L.push('     '+s.p);
    L.push('     依据来源：'+s.ev);
    if(s.chk)L.push('     ⚠ 仍需确认：'+s.chk);
    L.push('');
  });
  L.push('----------------------------------------------------');
  L.push('确认状态：需经 干部确认 → 授权确认 后方可正式递交');
  L.push('使用边界：'+r.footnote);
  L.push('====================================================');
  L.push('本报告由慧小招根据城市智库与公开信息自动生成，供招商研判参考；正式对接前需政府授权材料确认。');
  var blob=new Blob([L.join('\n')],{type:'text/plain;charset=utf-8'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=r.title+'.txt';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  toast('报告已导出：'+r.title);
}
function pickClue(i){detailData={kind:'clue',d:P().clues[i]};if(!detailOpen)detailOpen=true;
  var dp=$('.detail-pane');if(dp){dp.innerHTML='<button class="collapse-detail" onclick="toggleDetail()"><i class="i">✕</i></button><div class="detail-page">'+detailClue(detailData.d)+'</div>';}else render();
  toast('右侧显示「'+P().clues[i].name+'」核验要点')}
function dockPanel(){
  var _dp=P();var _dpClue=(_dp.clues||[])[0]||{};
  return '<div class="timeline-panel"><h2>📡 递交与对接（资源端处理，此处只读）</h2><div class="timeline">'+
    '<div class="timeline-item done"><div class="timeline-dot"><i class="i">✓</i></div><div><div class="timeline-title"><strong>需求已正式递交</strong><time>今天</time></div><p>已同步「'+_dp.topic+'」招商需求、随州承接区域与报告证据链至资源端。</p></div></div>'+
    '<div class="timeline-item current"><div class="timeline-dot"><i class="i">◔</i></div><div><div class="timeline-title"><strong>资源可达性核验中</strong><time>预计 2 个工作日</time></div><p>资源团队正在核验'+(_dpClue.name||'候选脱敏企业')+'的真实投资意向与决策层触达路径。</p></div></div>'+
    '<div class="timeline-item"><div class="timeline-dot"><i class="i">•</i></div><div><div class="timeline-title"><strong>首次沟通待安排</strong><time>待资源回传</time></div><p>核验可触达后，系统提醒准备随州承接材料（园区/政策/可用时段），安排实地走访+政企座谈。</p></div></div>'+
    '</div></div>'+
    '<div class="task-panel"><h2>轻自动化（只做这些）</h2>'+
      ['状态变化时通知政府端','超时提醒（3个工作日无更新）','根据阶段生成政府待办','每日 09:00 汇总进行中事项'].map(function(x){return '<div class="task-row"><i class="i">🔔</i><span><strong>'+x+'</strong></span></div>'}).join('')+
      '<div class="boundary-note"><i class="i">🔒</i>自动化只负责材料抽取、状态建议、提醒和台账更新建议，<strong>不自动联系企业、不跳过确认关口</strong>。</div>'+
    '</div>';
}
// 城市智库快捷提问（顶部"可以这样问"）→ 填入输入框，由用户点发送
function askKB(q){
  var c=document.getElementById('kbConv');
  if(!c){fillComposer(q);return;}
  var ud=document.createElement('div');
  ud.className='message is-user';
  ud.innerHTML='<div class="message-bubble"><p>'+q+'</p></div>';
  c.appendChild(ud);c.scrollTop=c.scrollHeight;
  kbChatPush('user', ud.outerHTML);
  kbRAGQuery(q,c);
}
// 把问题填进输入框并聚焦（不自动发送）
function fillComposer(q){
  var ta=$('#composerTa');
  if(ta){ta.value=q;ta.focus();ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,120)+'px';toast('已填入输入框，点发送即可提问');}
}
// 统一的城市智库问答：回复对应主题 + 底部列出调用来源
/* ══ RAG ENGINE START ══ */
/* ══════════════════════════════════════════════════════════════
   KB RAG ENGINE — 纯前端 BM25-style 检索 + 结构化生成
   数据来源：慧小招2026-07实测报告（随州专项）
   ══════════════════════════════════════════════════════════════ */

/* ── 1. 知识语料库 buildKBCorpus(city) ── */
function buildKBCorpus(city){
  var p=P(); var isSZ=city&&city.indexOf('随州')>=0;
  // 每条 chunk: {id, topic, tags:[], text, cite}
  var chunks=[];
  if(p&&p.kb){
    p.kb.forEach(function(k){
      (k.known||[]).forEach(function(t,i){
        // 兼容结构化 chunk（对象含 origin/nature/src）与旧字符串
        var txt=t, org='ai', nat='base', src='';
        if(t&&typeof t==='object'){ txt=t.text||''; org=t.origin||'ai'; nat=t.nature||'base'; src=t.src||''; }
        chunks.push({id:k.t+':'+i, topic:k.t, tags:topicTags(k.t), text:txt, cite:k.t,
                     origin:org, nature:nat, src:src});
      });
    });
  }
  // 上传文件 chunk 只在「当前项目城市 === 请求城市」时纳入，杜绝跨城市材料泄漏
  var _curCity = (cur && PROJECTS[cur] && PROJECTS[cur].city) || '';
  var fc=(cur && _curCity===city && KB_FILE_CHUNKS[cur])||[];
  if(fc.length){ chunks=chunks.concat(fc); console.log('[RAG] +'+fc.length+' file chunks'); }
  // 追加竞争格局数据（随州专项）
  if(isSZ){
    var compChunks=[
      {id:'comp:gdp',   topic:'竞争格局', tags:['GDP','经济','总量','对比'],
       text:'随州2024年GDP 1442.35亿元，全省第12/13位，规上工业增速+9.9%，人均GDP 71981元',cite:'竞争格局分析'},
      {id:'comp:sz',    topic:'竞争格局', tags:['竞争','十堰','对手','商用车'],
       text:'十堰是最直接竞争对手：2023年汽车产业产值960亿，整车12家+零部件3167家，目标2026年破2500亿，主攻新能源商用车+高端应急装备车，正抢应急专用车赛道',cite:'竞争格局分析'},
      {id:'comp:jm',    topic:'竞争格局', tags:['竞争','荆门','锂电','电池'],
       text:'荆门是锂电领域碾压性对手：亿纬动力212GWh占全省50%，长城汽车整车300亿；随州不宜正面竞争锂电赛道',cite:'竞争格局分析'},
      {id:'comp:xg',    topic:'竞争格局', tags:['竞争','孝感','应急','产业园'],
       text:'孝感中能华中应急智能制造低碳产业园42.8亿，省唯一应急装备智造先导区，直接对标随州应急产业',cite:'竞争格局分析'},
      {id:'comp:diff',  topic:'竞争格局', tags:['差异化','机会','氢能','低空','香菇'],
       text:'随州差异化空间：氢能专用车(全国唯一已量产49T氢重卡)、应急软体新材料(金龙篷布全国30%)、低空经济+专汽融合、香菇/银杏农产品加工(全国唯一性)',cite:'竞争格局分析'},
      {id:'sz:ind1',    topic:'主导产业', tags:['专用汽车','产值','规模','整车'],
       text:'专用汽车：2025年专汽应急产业产值703亿元(+12.1%)，年产约16万辆，全国占比>10%，专汽出口+71%全省第一，资质企业97家/零部件企业220家，整体目标2026年破千亿',cite:'产业链缺口测绘报告'},
      {id:'sz:ind2',    topic:'主导产业', tags:['新能源','配套率','缺口','外购'],
       text:'本地配套率仅41%，远低于山东梁山65%和十堰75%+；底盘/动力总成(占整车成本50%)几乎全外购十堰潍柴/法士特/汉德；新能源占比仅3-5%(2024年新能源专车5247辆)',cite:'产业链缺口测绘报告'},
      {id:'sz:h2',      topic:'氢能专用车', tags:['氢能','电堆','储氢','新楚风','补链'],
       text:'氢燃料电池电堆占整车成本53%、储氢瓶占14%，两项核心系统全部外购；新楚风49T氢重卡已量产(百公里氢耗7.1kg/续航1000km)；空压机、氢气循环泵、膜电极、质子交换膜同为本地空白',cite:'产业链缺口测绘报告'},
      {id:'sz:emg',     topic:'安全应急', tags:['应急','消防','无人机','机器人','智慧'],
       text:'应急装备2023年总产值502亿，移动应急装备324亿；江南专汽泡沫消防车/通信指挥车600-1000万/台；博利特高空系留无人机消防车；但应急机器人依赖启灵外采、无人机依赖迅北斗外采，5G通信模块本地零布局',cite:'产业链缺口测绘报告'},
      {id:'sz:mush',    topic:'香菇产业', tags:['香菇','精深加工','品种','提取','品源'],
       text:'香菇2024年全产业链产值超500亿，区域品牌价值205.8亿(连续3年全国食药用菌第一)；品源"菇的辣克"2024签1亿美元+2025续签3亿美元，进沃尔玛/Costco；但菌种长期依赖国外7925/7917老品种，多糖/多肽提取仅裕国/肽源2家布局',cite:'产业链缺口测绘报告'},
      {id:'sz:park1',   topic:'园区', tags:['高新区','国家级','园区','曾都'],
       text:'随州高新区2015年升级国家级，拥有国字号11块，含"移动应急装备国家创新型产业集群"牌子；曾都区为国家安全应急产业示范基地',cite:'产业链缺口测绘报告'},
      {id:'sz:park2',   topic:'园区', tags:['专汽','产业园','香菇','随县','承接'],
       text:'30公里专汽长廊是整车/改装承载主区，已有程力/齐星等入驻；随县香菇产业园已有初加工企业入驻，精深加工GMP洁净厂房条件待核实；区位：汉十高铁至武汉50分钟/至襄阳30分钟',cite:'产业链缺口测绘报告'},
      {id:'sz:pol1',    topic:'政策', tags:['氢能走廊','政策','省级','补贴'],
       text:'湖北省氢能走廊：武汉-十堰-随州-襄阳沿线布局，随州以氢能专用车为主攻，专项支持方向已明确；但专项资金具体额度需向主管部门确认',cite:'政策规划研究'},
      {id:'sz:pol2',    topic:'政策', tags:['应急示范','基地','政策','机器人'],
       text:'曾都区国家安全应急产业示范基地政策支持智慧应急装备落地，对机器人/无人机/5G通信模块有专项引导；孝感应急产业园42.8亿为直接竞争对手，需尽快锁定差异化方向',cite:'政策规划研究'},
      {id:'sz:pol3',    topic:'政策', tags:['香菇','农业','精深加工','政策'],
       text:'随州将香菇精深加工与品牌化列为农业升级重点；但菌种自主研发基地、洁净厂房用地指标、首选承接园区等具体事项须向确认',cite:'政策规划研究'},
    ];
    chunks=chunks.concat(compChunks);
  }
  return chunks;
}

/* 关键数据高亮 */
function highlightKeyData(text){
  if(!text) return text;
  return text.replace(/(\d+[\d,.]*)\s*(亿元|亿|万辆|万吨|万m³|万㎡|万顶|万台|GWh|km|kg)/g,'<strong style=\"color:#1a56db;font-weight:700\">$1$2</strong>')
    .replace(/(\d+[\d.]*%)/g,'<strong style=\"color:#1a56db;font-weight:700\">$1</strong>')
    .replace(/(程力|新楚风|齐星|江南专汽|博利特|金龙新材料|品源|裕国药业|肽源|泰晶科技|犇星|昱通)/g,'<strong style=\"color:#6d28d9;font-weight:650\">$1</strong>')
    .replace(/(燃料电池电堆|储氢瓶|质子交换膜|膜电极|应急机器人|无人机本体|菌种自主权|香菇多糖|多肽提取)/g,'<em style=\"background:#fef3c7;color:#92400e;border-radius:3px;padding:0 3px;font-style:normal\">$1</em>')
    .replace(/(全部外购|靠外采|本地空白|国外垄断|待确认|待核实)/g,'<span style=\"color:#dc2626;font-weight:600\">$1</span>');
}

function topicTags(t){
  if(t.indexOf('产业')>=0) return ['产业','主导','集群','链条','规模','产值'];
  if(t.indexOf('园区')>=0) return ['园区','承接','厂房','能耗','载体','开发区'];
  if(t.indexOf('链主')>=0||t.indexOf('企业')>=0) return ['企业','链主','配套','采购','缺口','外购'];
  if(t.indexOf('政策')>=0) return ['政策','规划','资金','补贴','领导','交办'];
  return [];
}

/* ── 2. BM25-style 检索 ── */
function kbSearch(query, chunks, topK){
  topK=topK||4;
  // 分词：中文按字/词切割，英文按空格
  function tokenize(s){
    var tokens=[];
    // 提取所有2-4字中文词组 + 数字+单位
    var m; var re=/[\u4e00-\u9fff]{2,4}|[A-Za-z0-9]+[%亿万辆元]/g;
    while((m=re.exec(s))!==null) tokens.push(m[0]);
    // 单字 fallback
    s.replace(/[\u4e00-\u9fff]/g,function(c){tokens.push(c);});
    return tokens;
  }
  var qTokens=tokenize(query);

  // IDF: log(N/df+1), TF: count/len
  var N=chunks.length;
  var df={};
  chunks.forEach(function(c){
    var seen={};
    tokenize(c.text+' '+c.topic+' '+(c.tags||[]).join(' ')).forEach(function(t){
      if(!seen[t]){df[t]=(df[t]||0)+1; seen[t]=1;}
    });
  });

  var scored=chunks.map(function(c){
    var doc=c.text+' '+c.topic+' '+(c.tags||[]).join(' ');
    var docTokens=tokenize(doc);
    var len=Math.max(docTokens.length,1);
    // 上传/标注材料判定（origin=admin/user 或带 src 文件名）：这类是政府干部主动提供的权威材料，
    // 不应因"一次集中上传产生多条 chunk 使关键词高频"而被 IDF 惩罚压到检索底部（负面清单漏召回根因）。
    var isUpload=(c.origin==='admin'||c.origin==='user'||!!c.src||(c.id&&String(c.id).indexOf('file:')===0));
    var score=0;
    qTokens.forEach(function(qt){
      var tf=0;
      docTokens.forEach(function(dt){ if(dt===qt||dt.indexOf(qt)>=0||qt.indexOf(dt)>=0) tf++; });
      var idf=Math.log((N+1)/((df[qt]||0)+1));
      // 上传材料豁免 IDF 惩罚：命中查询词时 IDF 取下限 1.0，避免集中上传导致高频词权重塌陷。
      if(isUpload) idf=Math.max(idf,1.0);
      // BM25 k1=1.5 b=0.75 avgdl=50
      var bm25=(tf*(1.5+1))/(tf+1.5*(1-0.75+0.75*len/50));
      score+=bm25*idf;
    });
    // boost: tag 精确匹配
    (c.tags||[]).forEach(function(tag){
      if(query.indexOf(tag)>=0) score+=2.5;
    });
    // 上传材料且有实际词命中时给稳定加成，确保权威政策材料稳居候选池（与后端 _is_upload_chunk +2 一致）。
    if(isUpload && score>0) score+=2;
    return {chunk:c, score:score};
  });

  scored.sort(function(a,b){return b.score-a.score;});
  var hit=scored.slice(0,topK).filter(function(x){return x.score>0;}).map(function(x){return x.chunk;});
  // 空召回兜底：宽泛问题(如"XX有哪些主导产业")可能一条都匹配不上BM25正分，
  // 但绝不能给后端传空chunks(否则RAG裸奔、审计候选=0)。退回该corpus前topK条核心语料。
  if(hit.length===0 && chunks.length>0){
    hit=chunks.slice(0,topK);
  }
  return hit;
}

/* ── 3. 结构化 Answer 生成 ── */
function generateKBAnswer(query, chunks, city){
  if(!chunks||!chunks.length){
    return {
      html:'<p>暂未找到与「'+query+'」直接相关的已知内容。建议补充政府工作报告或产业链图谱后重新提问，或切换到「产业分析」页生成完整产业报告。</p>',
      cites:[], followups:[]
    };
  }

  var isSZ=city&&city.indexOf('随州')>=0;
  var q=query;

  // ── intent 识别 ──
  var isGap=/缺口|缺什么|缺哪|补链|外购|外采|空白/.test(q);
  var isPark=/园区|承接|厂房|能耗|载体|开发区|高新区/.test(q);
  var isFirm=/链主|企业|采购|配套|哪些企业|供应商/.test(q);
  var isPol=/政策|资金|补贴|领导|规划|交办|支持/.test(q);
  var isComp=/竞争|对手|差异化|机会|优势|十堰|荆门|孝感/.test(q);
  var isRec=/建议|推荐|优先|应该怎么|怎么做|如何招/.test(q);

  // ── 构建回答段落 ──
  var paragraphs=[];
  var cites=[];

  // 主体：把检索到的 chunks 按 topic 分组
  var byTopic={};
  chunks.forEach(function(c){
    if(!byTopic[c.topic]) byTopic[c.topic]=[];
    byTopic[c.topic].push(c);
    if(cites.indexOf(c.cite)<0) cites.push(c.cite);
  });

  Object.keys(byTopic).forEach(function(topic){
    var items=byTopic[topic];
    var bullets=items.map(function(c){
      var isWarn=c.text.indexOf('⚠️')>=0||c.text.indexOf('待确认')>=0||c.text.indexOf('待领导')>=0;
      return '<li style="'+(isWarn?'color:#92400e':'color:#1a202c')+'">'+
        (isWarn?'<span style="color:#d97706;margin-right:4px">⚠</span>':
                '<span style="color:#22c55e;margin-right:4px">•</span>')+
        c.text.replace('⚠️ ','')+'</li>';
    }).join('');
    paragraphs.push(
      '<div style="margin-bottom:14px">'+
        '<div style="font-size:12px;font-weight:650;color:#6366f1;letter-spacing:.4px;margin-bottom:6px">'+topic.toUpperCase()+'</div>'+
        '<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px">'+bullets+'</ul>'+
      '</div>'
    );
  });

  // ── 结论段 ──
  var conclusion='';
  if(isGap&&isSZ){
    conclusion='<div style="background:#f0f9ff;border-left:3px solid #1a56db;padding:10px 14px;border-radius:0 8px 8px 0;margin-top:12px;font-size:12.5px;color:#1e3a5f;line-height:1.75">'+
      '<strong>补链优先级建议：</strong>①燃料电池电堆（整车成本53%，新楚风/程力有稳定采购需求）→②应急机器人/无人机系统（替代启灵/迅北斗外采依赖）→③香菇多糖/多肽提取（70万吨/年原料红利，就近落地降成本40%+）'+
    '</div>';
  } else if(isPark&&isSZ){
    conclusion='<div style="background:#f0fdf4;border-left:3px solid #22c55e;padding:10px 14px;border-radius:0 8px 8px 0;margin-top:12px;font-size:12.5px;color:#14532d;line-height:1.75">'+
      '<strong>承接建议：</strong>氢能专用车→专汽产业园/随州高新区；智慧应急→曾都经开区（安全应急示范基地）；香菇精深加工→随县香菇产业园（洁净厂房条件需向管委会确认）'+
    '</div>';
  } else if(isComp&&isSZ){
    conclusion='<div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:10px 14px;border-radius:0 8px 8px 0;margin-top:12px;font-size:12.5px;color:#78350f;line-height:1.75">'+
      '<strong>差异化窗口：</strong>锂电/新能源乘用车让给荆门/襄阳；氢能专用车（全国唯一已量产）+低空经济+应急软体新材料+香菇（全国唯一性）是随州真正的护城河。'+
    '</div>';
  } else if(isRec){
    conclusion='<div style="background:#f5f3ff;border-left:3px solid #6366f1;padding:10px 14px;border-radius:0 8px 8px 0;margin-top:12px;font-size:12.5px;color:#3730a3;line-height:1.75">'+
      '<strong>行动建议：</strong>将以上分析转化为正式招商需求，递交资源端核验企业可达性；同时向确认专项资金额度与首选承接园区，形成完整对接方案。'+
    '</div>';
  }
  if(conclusion) paragraphs.push(conclusion);

  // ── 追问建议 ──
  var followups=[];
  if(isSZ){
    if(!isGap) followups.push(city+'补链的核心缺口有哪些？');
    if(!isPark) followups.push('各园区如何分工承接不同细分方向？');
    if(!isComp) followups.push(city+'的主导产业有哪些差异化竞争空间？');
    if(!isFirm) followups.push('本地链主企业还缺哪些关键上游配套？');
  } else {
    followups=['补链的核心缺口有哪些？','各园区如何分工承接不同细分产业？','本地链主企业还缺哪些关键上游配套？'];
  }
  followups=followups.slice(0,3);

  var body=paragraphs.join('');
  var warn='<div style="margin-top:10px;padding:8px 12px;background:#f9fafb;border-radius:8px;font-size:11px;color:#9aa5b5;line-height:1.6">⚠ 以上内容基于公开信息与慧小招2026-07实测数据；园区承载、企业采购规模与领导具体交办仍需政府授权材料确认</div>';

  return {html:body+warn, cites:cites, followups:followups};
}

/* ── 4. 打字机渲染 + 来源引用 + 追问按钮 ── */

/* ── KB RAG: 流式渲染 + 追问按钮 ── */
var KB_API = '/api/kb-chat';  // 同源相对路径：线上走 Railway 后端，本地走 localhost:5050

/* Markdown 轻量渲染（顶层函数：kbAnswerRender/kbVerifyMaterial/kbIncrementalAnalysis 共用；此前为 kbAnswerRender 内部函数，另两处调用会抛 ReferenceError） */
function renderMarkdown(md){
    // 简单 markdown: **bold**, - list, 表格转列表, \n段落
    var lines=md.split('\n'), out=[], tbl=[];
    function flushTbl(){
      if(!tbl.length){return;}
      var rows=tbl.filter(function(r){return !/^[\s\-:|]+$/.test(r);});
      var head=null;
      rows.forEach(function(r,ri){
        var cells=r.replace(/^\||\|$/g,'').split('|').map(function(c){return c.trim();});
        if(ri===0){head=cells;return;}
        var pair=cells.map(function(c,ci){return (head&&head[ci]?head[ci]+'：':'')+c;}).join('，');
        out.push('- '+pair);
      });
      tbl=[];
    }
    lines.forEach(function(ln){
      if(/^\s*\|.*\|\s*$/.test(ln)){ tbl.push(ln); }
      else { flushTbl(); out.push(ln); }
    });
    flushTbl();
    return out.join('\n')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/⚠️/g,'<span style="color:#d97706">⚠️</span>')
      .replace(/^#{1,4}\s*(.+)$/gm,'<strong>$1</strong>')
      .replace(/^[-•]\s(.+)$/gm,'<li style="margin:4px 0;padding-left:4px">$1</li>')
      .replace(/(<li[\s\S]*?<\/li>)+/g,'<ul style="margin:6px 0;padding:0 0 0 18px;list-style:disc">$&</ul>')
      .replace(/\n{2,}/g,'</p><p style="margin:8px 0">')
      .replace(/\n/g,'<br>');
}
function kbAnswerRender(container, query, chunks, city){
  // 1. 思考气泡
  var thinking = document.createElement('div');
  thinking.className = 'message';
  thinking.innerHTML = '<img src="'+aiAvatar()+'">'+
    '<div class="message-bubble" style="display:flex;align-items:center;gap:8px;color:#9aa5b5;font-size:13px">'+
    '<span class="kb-thinking-dot"></span>正在调用 AI 分析…</div>';
  container.appendChild(thinking);
  container.scrollTop = container.scrollHeight;

  // 2. 创建回答气泡（流式填充）
  var ansNode = document.createElement('div');
  ansNode.className = 'message';
  ansNode.style.display = 'none';
  var bodyDiv = document.createElement('div');
  bodyDiv.className = 'kb-stream-body';
  ansNode.innerHTML = '<img src="'+aiAvatar()+'">';
  var bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.appendChild(bodyDiv);
  ansNode.appendChild(bubble);
  container.appendChild(ansNode);

  var accText = '';
  var t0 = Date.now();


  fetch(KB_API, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({question:query, chunks:chunks, city:city, stream:true, mode:'chat', prefs:curOnbPrefs()})
  }).then(function(resp){
    thinking.remove();
    ansNode.style.display = '';

    if(!resp.ok){
      return resp.json().then(function(e){
        bodyDiv.innerHTML = '<span style="color:#ef4444">服务错误：'+(e.error||resp.status)+'</span>';
      });
    }

    var reader = resp.body.getReader();
    var decoder = new TextDecoder();
    var buf = '';

    function pump(){
      reader.read().then(function(d){
        if(d.done){
          // 兜底：流结束但正文为空（reasoning 吃光 token 或后端翻译层未捕获 content 事件）
          if(!accText){
            bodyDiv.innerHTML = '<span style="color:#ef4444">AI 未返回有效回答，请重试<br><small style="color:#9aa5b5">可能原因：推理消耗过多 token，正文内容被截断</small></span>';
            kbChatPush('ai', ansNode.outerHTML);
            return;
          }
          // 完成：追加来源 + 追问
          var elapsed = Date.now()-t0;
          var cites = [...new Set(chunks.map(function(c){return c.cite;}).filter(Boolean))];
          var citeTags = cites.map(function(c){
            return '<span style="display:inline-block;padding:2px 8px;background:#f0f4ff;color:#1a56db;border-radius:12px;font-size:11px;margin:2px 3px">📌 '+c+'</span>';
          }).join('');

          // 追问按钮
          var _cy = city || (P()&&P().city) || '本市';
          var followups = [_cy+'优先补链的核心环节？', _cy+'各园区如何分工承接？', _cy+'本地链主还缺哪些关键配套？'];
          var followHtml = '<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">'+
            followups.map(function(f){
              return '<button onclick="kbSendQuestion(this,\''+f.replace(/'/g,"\\'")+'\')" '+
                'style="padding:5px 11px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:20px;font-size:12px;color:#0b183b;cursor:pointer;transition:background .1s" '+
                'onmouseover="this.style.background=\'#eef2ff\'" onmouseout="this.style.background=\'#f5f7fb\'">'+f+'</button>';
            }).join('')+
          '</div>';

          var footer = (citeTags?'<div style="margin-top:8px">'+citeTags+'</div>':'')+

            followHtml+
            '<div style="margin-top:8px;padding:8px 10px;background:#f9fafb;border-radius:8px;font-size:11px;color:#9aa5b5;line-height:1.6">⚠ 以上内容基于公开信息与慧小招实测数据，园区承载、企业采购规模及领导具体交办仍需政府授权材料确认</div>';

          bubble.insertAdjacentHTML('beforeend', footer);
          container.scrollTop = container.scrollHeight;
          // 存档最终完整的 AI 回复气泡（含来源/追问/免责），刷新或切换后可回放
          kbChatPush('ai', ansNode.outerHTML);
          return;
        }

        buf += decoder.decode(d.value, {stream:true});
        var lines2 = buf.split('\n');
        buf = lines2.pop(); // 保留不完整行

        lines2.forEach(function(line){
          if(!line.startsWith('data:')) return;
          var data = line.slice(5).trim();
          if(data === '[DONE]') return;
          try{
            var j = JSON.parse(data);
            var delta = (j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content)||'';
            if(delta){
              accText += delta;
              bodyDiv.innerHTML = '<p style="margin:0;line-height:1.75">'+renderMarkdown(accText)+'</p>';
              container.scrollTop = container.scrollHeight;
            }
            // 修复"先卡住再涌出"：联网搜索/思考阶段正文未开始时，显示动态进度而非静止卡死
            var rc=(j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.reasoning_content)||'';
            if(rc && !accText){
              var _lbl = rc==='[searching]' ? 'AI 正在联网搜索最新信息' : 'AI 正在深度思考';
              bodyDiv.innerHTML = '<span style="color:#9aa5b5;font-size:12.5px;display:inline-flex;align-items:center;gap:8px">'+
                '<span class="kb-thinking-dot"></span>'+_lbl+'（已 '+Math.round((Date.now()-t0)/1000)+'s）…</span>';
              container.scrollTop = container.scrollHeight;
            }
          }catch(e){}
        });
        pump();
      });
    }
    pump();

  }).catch(function(err){
    thinking.remove();
    ansNode.style.display = '';
    bodyDiv.innerHTML = '<span style="color:#ef4444">连接失败：'+err.message+
      '<br><small style="color:#9aa5b5">AI 服务暂时不可用，请稍后重试</small></span>';
  });
}

function kbSendQuestion(btn, q){
  if(btn){btn.style.opacity='0.5';btn.disabled=true;}
  var c=document.getElementById('kbConv')||document.getElementById('conv');
  if(!c)return;
  var ud=document.createElement('div');
  ud.className='message is-user';
  ud.innerHTML='<div class="message-bubble"><p>'+q+'</p></div>';
  c.appendChild(ud); c.scrollTop=c.scrollHeight;
  kbChatPush('user', ud.outerHTML);
  kbRAGQuery(q, c);
}

function kbRAGQueryWithHint(query, container, kbTopic){
  var p=P(); if(!p) return;
  var corpus=buildKBCorpus(p.city);
  // 检索更多候选（50），保证上传附件/政策材料真实命中不被置顶挤掉或因高频被IDF压出候选池。
  // 20→50：前端BM25截断是两层筛选的第一层，截太狠会把上传材料整批挤出，后端再准也无料可选。
  var chunks=kbSearch(query,corpus,50);
  if(kbTopic&&kbTopic.known){
    var seen=chunks.map(function(c){return c.text;});
    // 该主题下用户上传的附件片段：也一并检索并优先保留（不占用置顶名额，属真实数据）
    var topicUploads=(KB_FILE_CHUNKS[cur]||[]).filter(function(c){
      var tags=c.tags||[];
      return (c.topic===kbTopic.t)||(tags.indexOf(kbTopic.t)>=0);
    });
    topicUploads.forEach(function(uc){ if(seen.indexOf(uc.text)<0){ chunks.unshift(uc); seen.push(uc.text); } });
    // known 条目置顶，但最多 3 条，给检索结果+上传附件留出名额
    var pinned=kbTopic.known.slice(0,3).map(function(t,i){
      return {id:'pin:'+i,topic:kbTopic.t,tags:topicTags(kbTopic.t),text:t,cite:kbTopic.t+'(置顶)'};
    });
    pinned.reverse().forEach(function(pc){if(seen.indexOf(pc.text)<0){chunks.unshift(pc);seen.push(pc.text);}});
    chunks=chunks.slice(0,20);
  }
  kbAnswerRender(container,query,chunks,p.city);
}

function kbRAGQuery(query, container){
  var p=P(); if(!p) return;
  var corpus=buildKBCorpus(p.city);
  // topK 从 5→20→60：候选池过小会把上传政策材料(如负面清单,一次上传即多条chunk)挤出，导致漏召回。
  var chunks=kbSearch(query, corpus, 60);
  kbAnswerRender(container, query, chunks, p.city);
}


/* ══ RAG ENGINE END ══ */

function kbAsk(q,k){
  var c=$('#kbConv');if(!c)return;
  var _uHtml='<div class="message is-user" style="margin-top:14px"><div class="message-bubble"><p>'+q+'</p></div></div>';
  c.insertAdjacentHTML('beforeend',_uHtml);
  kbChatPush('user', _uHtml);
  c.scrollTop=c.scrollHeight;
  var p0=P();
  var bullet0=k.known.map(function(x){return '<li style="margin-bottom:5px">'+_kbText(x)+'</li>';}).join('');
  var intro0='结合'+p0.city+'「'+k.t+'」当前已知情况：<ul style="margin:8px 0 8px 18px;padding:0;line-height:1.7">'+bullet0+'</ul>';
  var tip0=(k.t.indexOf('产业')>-1||k.t.indexOf('主导')>-1)?
    '<p style="margin-top:5px">本地配套率不足与核心系统外购是当前最大补链切入点，建议优先针对这些缺口方向招引。</p>':
    (k.t.indexOf('园区')>-1)?
    '<p style="margin-top:5px">具体厂房面积、能耗指标与用地条件仍以政府授权材料为准，以上为初步研判。</p>':
    (k.t.indexOf('链主')>-1||k.t.indexOf('企业')>-1)?
    '<p style="margin-top:5px">骨干企业采购规模与技术路线需进一步核实；以上为公开信息初步归类。</p>':
    '<p style="margin-top:5px">方向性政策表述已识别，具体交办口径需补充领导最新发言后确认。</p>';
  var ans=intro0+tip0;
  var srcs=k.calls.map(function(s){return '<span>'+s+'</span>'}).join('');
  setTimeout(function(){
    var _aHtml='<div class="message" style="margin-top:14px"><img src="'+aiAvatar()+'"><div class="message-bubble"><p>'+ans+'</p>'+
      '<div class="answer-sources"><em>本次回答调用（可追溯）：</em>'+srcs+'</div>'+
      '<div class="answer-note">⚠ 公开信息仅用于辅助研判；园区承载、企业采购和领导任务仍需政府授权材料确认。</div></div></div>';
    c.insertAdjacentHTML('beforeend',_aHtml);
    kbChatPush('ai', _aHtml);
    c.scrollTop=c.scrollHeight;
  },400);
}

/* ── 确认/修改 known 条目 ── */
function confirmKbItem(kbIdx,itemIdx){
  var p=P();if(!p)return;
  if(!KB_CONFIRMS[cur])KB_CONFIRMS[cur]={};
  if(!KB_CONFIRMS[cur][kbIdx])KB_CONFIRMS[cur][kbIdx]={};
  var k=p.kb[kbIdx];if(!k)return;
  var _rawC=k.known[itemIdx]||''; var orig=_kbText(_rawC);
  var clean=orig.replace('\u26a0\ufe0f ','');
  // 写回 known：去掉 ⚠️，前缀改为 ✅（保留对象格式）
  if(_rawC&&typeof _rawC==='object'){_rawC.text='\u2705 '+clean;k.known[itemIdx]=_rawC;}else{k.known[itemIdx]='\u2705 '+clean;}
  var _nowTs=Date.now();
  KB_CONFIRMS[cur][kbIdx][itemIdx]={status:'confirmed',text:clean,ts:_nowTs};
  // 【2026-09-18】同组重复条目一并确认：显示层已合并，若只确认代表条目，
  // kbReadiness 仍会把被合并的同义条目计入 pendingWarn，进度条永远差几条下不去。
  var _dups=(window.__kbDupMap&&window.__kbDupMap[kbIdx]&&window.__kbDupMap[kbIdx][itemIdx])||[];
  var _dupN=0;
  _dups.forEach(function(di){
    if(di===itemIdx) return;
    var _dr=k.known[di]; if(!_dr) return;
    var _dt=_kbText(_dr).replace('\u26a0\ufe0f ','');
    if(_dr&&typeof _dr==='object'){_dr.text='\u2705 '+_dt;k.known[di]=_dr;}else{k.known[di]='\u2705 '+_dt;}
    KB_CONFIRMS[cur][kbIdx][di]={status:'confirmed',text:_dt,ts:_nowTs,mergedFrom:itemIdx};
    _dupN++;
  });
  persist();
  // 刷新 corpus（确认项从待核实变为已确认）
  if(KB_FILE_CHUNKS[cur]){
    KB_FILE_CHUNKS[cur]=KB_FILE_CHUNKS[cur].filter(function(c){return c.id!=='pin:'+kbIdx+':'+itemIdx;});
  }
  // 重新渲染 modal（保持滚动位置）
  var _sc=document.querySelector('#kbDetailModal [style*="overflow-y:auto"]');
  var _st=_sc?_sc.scrollTop:0;
  kbDetail(kbIdx);
  var _sc2=document.querySelector('#kbDetailModal [style*="overflow-y:auto"]');
  if(_sc2)_sc2.scrollTop=_st;
  refreshKbProgress();
  toast('已确认：'+clean.slice(0,20)+'…'+(_dupN>0?('（含 '+_dupN+' 条重复表述）'):''));
}


/* 编辑框附件上传：读取文本内容填充 textarea */
function editPickFile(kbIdx,itemIdx){
  var inp=document.createElement('input');
  inp.type='file'; inp.multiple=true;
  inp.accept='.txt,.md,.csv,.pdf,.doc,.docx,.xls,.xlsx';
  inp.onchange=function(){
    var files=Array.from(inp.files||[]);
    if(!files.length)return;
    processEditFiles(files,kbIdx,itemIdx);
  };
  inp.click();
}

function editDropFile(e,kbIdx,itemIdx){
  e.preventDefault();
  var files=Array.from(e.dataTransfer&&e.dataTransfer.files||[]);
  if(!files.length)return;
  processEditFiles(files,kbIdx,itemIdx);
}

function processEditFiles(files,kbIdx,itemIdx){
  var hint=document.getElementById('kb-file-hint-'+kbIdx+'-'+itemIdx);
  var ta=document.getElementById('kb-edit-'+kbIdx+'-'+itemIdx);
  // 先触发全局 ingestFiles（更新 corpus）
  ingestFiles(files, kbIdx);
  // 然后读取文本文件内容追加到 textarea
  var textFiles=files.filter(function(f){return /\.(txt|md|csv|json)$/i.test(f.name);});
  var binary=files.filter(function(f){return !/\.(txt|md|csv|json)$/i.test(f.name);});
  // 更新 hint 文本
  if(hint)hint.textContent='✅ 已上传 '+files.length+' 个文件：'+files.map(function(f){return f.name;}).join('、');
  // binary 文件只记录名称到 textarea
  if(binary.length&&ta){
    ta.value+=(ta.value?'\n':'')+'[已上传文件：'+binary.map(function(f){return f.name;}).join('、')+'，内容已加入知识库]';
  }
  if(!textFiles.length)return;
  // 读取纯文本文件，提取摘要追加到 textarea
  var done=0;
  textFiles.forEach(function(f){
    var reader=new FileReader();
    reader.onload=function(e){
      var text=(e.target.result||'').trim();
      // 取前 500 字作为摘要
      var summary=text.slice(0,500).replace(/\n+/g,' ').trim();
      if(ta&&summary){
        ta.value+=(ta.value?'\n':'')+'['+f.name+'] '+summary;
      }
      done++;
      if(done===textFiles.length&&ta){
        ta.focus();
        ta.setSelectionRange(ta.value.length,ta.value.length);
      }
    };
    reader.readAsText(f,'utf-8');
  });
}

function editKbItem(kbIdx,itemIdx){
  // 把对应条目替换为 inline 编辑框
  var cardId='kb-card-'+kbIdx+'-'+itemIdx;
  var card=document.getElementById(cardId);
  if(!card)return;
  var p=P();if(!p)return;
  var k=p.kb[kbIdx];if(!k)return;
  var _raw=k.known[itemIdx]||''; var orig=_kbText(_raw).replace('\u26a0\ufe0f ','').replace('\u2705 ','');
  card.innerHTML=
    '<div style="padding:10px 13px">'+
      '<div style="font-size:11px;color:#6366f1;font-weight:650;margin-bottom:6px">修改内容（确认后写入知识库）</div>'+
      '<textarea id="kb-edit-'+kbIdx+'-'+itemIdx+'" '+
        'style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #6366f1;border-radius:8px;font-size:13px;line-height:1.6;color:#1e293b;resize:vertical;min-height:72px;outline:none" '+
        'onkeydown="if(event.key===\'Enter\'&&event.metaKey)saveKbEdit('+kbIdx+','+itemIdx+')">'+orig+'</textarea>'+
      '<div style="margin:8px 0 0;padding:8px 10px;background:#f8faff;border:1.5px dashed #c7d2fe;border-radius:8px;cursor:pointer;text-align:center;font-size:12px;color:#4f46e5" '+
        'onclick="editPickFile('+kbIdx+','+itemIdx+')" '+
        'ondragover="event.preventDefault();this.style.background=\'#eef2ff\'" '+
        'ondragleave="this.style.background=\'#f8faff\'" '+
        'ondrop="editDropFile(event,'+kbIdx+','+itemIdx+')">'+
        '<span id="kb-file-hint-'+kbIdx+'-'+itemIdx+'">📎 上传附件辅助修改（PDF/Word/TXT · 拖拽或点击）</span>'+
      '</div>'+
      '<div style="display:flex;gap:8px;margin-top:8px">'+
        '<button onclick="saveKbEdit('+kbIdx+','+itemIdx+')" '+
          'style="flex:1;padding:8px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer">'+
          '\u2713 保存修改</button>'+
        '<button onclick="pickLocalFile('+kbIdx+')" '+
          'style="padding:8px 12px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;font-size:12.5px;color:#166534;cursor:pointer;font-weight:600">'+
          '📎 更多文件</button>'+
        '<button onclick="kbDetail('+kbIdx+')" '+
          'style="padding:8px 12px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:8px;font-size:12.5px;color:#4a5568;cursor:pointer">取消</button>'+
      '</div>'+
    '</div>';
  card.style.border='1.5px solid #6366f1';
  card.style.background='#faf5ff';
  var ta=document.getElementById('kb-edit-'+kbIdx+'-'+itemIdx);
  if(ta){ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);}
}

function saveKbEdit(kbIdx,itemIdx){
  var ta=document.getElementById('kb-edit-'+kbIdx+'-'+itemIdx);
  if(!ta)return;
  var newText=ta.value.trim();
  if(!newText){toast('内容不能为空');return;}
  var p=P();if(!p)return;
  var k=p.kb[kbIdx];if(!k)return;
  // 写回 known，添加 ✅ 已确认标记（保留对象格式）
  var _oldItem=k.known[itemIdx]; if(_oldItem&&typeof _oldItem==='object'){_oldItem.text='\u2705 '+newText;_oldItem.origin='user';_oldItem.nature=_oldItem.nature||'fix';_oldItem.ts=Date.now();k.known[itemIdx]=_oldItem;}else{k.known[itemIdx]={text:'\u2705 '+newText,origin:'user',nature:'fix',ts:Date.now()};}
  if(!KB_CONFIRMS[cur])KB_CONFIRMS[cur]={};
  if(!KB_CONFIRMS[cur][kbIdx])KB_CONFIRMS[cur][kbIdx]={};
  KB_CONFIRMS[cur][kbIdx][itemIdx]={status:'edited',text:newText,ts:Date.now()};
  persist();
  buildKBCorpus(p.city);
  var _sc=document.querySelector('#kbDetailModal [style*="overflow-y:auto"]');
  var _st=_sc?_sc.scrollTop:0;
  kbDetail(kbIdx);
  var _sc2=document.querySelector('#kbDetailModal [style*="overflow-y:auto"]');
  if(_sc2)_sc2.scrollTop=_st;
  refreshKbProgress();
  toast('\u2705 已更新并写入知识库');
}

function addKbItem(kbIdx){
  // 领导手动新增一条 known 条目
  var p=P();if(!p)return;
  var k=p.kb[kbIdx];if(!k)return;
  var itemIdx=k.known.length;
  var newEntry='\u26a0\ufe0f （新补充结论）';
  k.known.push(newEntry);
  // 直接在弹窗底部插入编辑框（不依赖kbDetail重新渲染，避免被_isJunkKbItem过滤）
  var listContainer=document.getElementById('kbDetailList-'+kbIdx);
  if(listContainer){
    var cardHtml='<div id="kb-card-'+kbIdx+'-'+itemIdx+'" style="margin-bottom:4px;padding:10px 13px">'+
      '<div style="font-size:11px;color:#6366f1;font-weight:650;margin-bottom:6px">补充结论（确认后写入知识库）</div>'+
      '<textarea id="kb-edit-'+kbIdx+'-'+itemIdx+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #6366f1;border-radius:8px;font-size:13px;line-height:1.6;color:#1e293b;resize:vertical;min-height:72px;outline:none" placeholder="输入补充内容…"></textarea>'+
      '<div style="display:flex;gap:8px;margin-top:8px">'+
        '<button onclick="saveKbEdit('+kbIdx+','+itemIdx+')" style="flex:1;padding:8px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer">保存</button>'+
        '<button onclick="k=P().kb['+kbIdx+'];k.known.splice('+itemIdx+',1);kbDetail('+kbIdx+')" style="padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:12.5px;color:#dc2626;cursor:pointer">取消</button>'+
      '</div>'+
    '</div>';
    listContainer.insertAdjacentHTML('beforeend', cardHtml);
    // 滚动到底部
    var modal=listContainer.closest('[style*="overflow"]')||listContainer.parentNode;
    if(modal) modal.scrollTop=modal.scrollHeight;
    // 聚焦输入框
    var ta=document.getElementById('kb-edit-'+kbIdx+'-'+itemIdx);
    if(ta) ta.focus();
  } else {
    // fallback: 用kbDetail重新渲染
    kbDetail(kbIdx);
    setTimeout(function(){editKbItem(kbIdx,k.known.length-1);},100);
  }
}

/* 删除某条 known 条目（待确认/已确认均可）。同步删除其确认记录，并把后续条目的
   确认记录索引整体前移一位（KB_CONFIRMS 以 itemIdx 为键，删除后必须重排，否则错位）。 */
function deleteKbItem(kbIdx,itemIdx){
  var p=P();if(!p||!p.kb)return;
  var k=p.kb[kbIdx];if(!k||!k.known||itemIdx>=k.known.length)return;
  if(!confirm('确定删除这条内容吗？删除后不可恢复。')) return;
  // 【2026-09-18】先打墓碑再删：不打的话管理端 persist 派发的 storage 事件
  // 会把旧快照的 kb.known 整体灌回，表现为「删了又自己回来」。
  // 必须在 splice 之前取文本，否则拿不到被删内容。
  _tombKbItem(cur, kbIdx, _kbText(k.known[itemIdx]));
  // 删除 known 条目
  k.known.splice(itemIdx,1);
  // 重排该 kbIdx 下的确认记录：删除 itemIdx，itemIdx 之后的键 -1
  if(KB_CONFIRMS[cur]&&KB_CONFIRMS[cur][kbIdx]){
    var oldMap=KB_CONFIRMS[cur][kbIdx];
    var newMap={};
    Object.keys(oldMap).forEach(function(key){
      var ki=parseInt(key,10);
      if(ki===itemIdx) return;            // 被删除的条目
      newMap[ki>itemIdx?ki-1:ki]=oldMap[key];
    });
    KB_CONFIRMS[cur][kbIdx]=newMap;
  }
  persist();
  // 同步清理该条在 corpus 里的钉选片段（与 confirmKbItem 一致的清理方式）
  if(KB_FILE_CHUNKS[cur]){
    KB_FILE_CHUNKS[cur]=KB_FILE_CHUNKS[cur].filter(function(c){return c.id!=='pin:'+kbIdx+':'+itemIdx;});
  }
  // 重新渲染 modal（保持滚动位置）
  var _sc=document.querySelector('#kbDetailModal [style*="overflow-y:auto"]');
  var _st=_sc?_sc.scrollTop:0;
  kbDetail(kbIdx);
  var _sc2=document.querySelector('#kbDetailModal [style*="overflow-y:auto"]');
  if(_sc2)_sc2.scrollTop=_st;
  if(typeof refreshKbProgress==='function') refreshKbProgress();
  toast('已删除该条内容');
}

function kbDetail(i){
  var k=P().kb[i]; if(!k) return;
  curKb=i;

  // 已知条目列表。显示规则（用户 2026-09-18 定）：
  //   用户补充(全部) + 待确认⚠️(全部) + 精选6条(其余里挑)
  // 待确认与用户补充是「额外附加」，不占精选 6 条的名额；数据层 known 始终全量。
  var _rawKnown=k.known||[];
  var _userPairs=[], _warnPairs=[], _donePairs=[], _normalPairs=[]; // [{text, origIdx}]
  for(var _di=0;_di<_rawKnown.length;_di++){
    var _draw=_rawKnown[_di];
    var _dt=_kbText(_draw);
    var _isUser=(_draw && typeof _draw==='object' && _draw.origin==='user');
    // 【2026-09-18 修复】用户主动补充/修改的条目不走垃圾过滤。
    // 根因：_isJunkKbItem 首行 `text.length<6 → junk`，干部补一条「测试」(含✅只 4 字)
    // 会被当垃圾丢掉，导致政府端卡片看不到、管理端却有（管理端不过滤）。
    // 垃圾过滤是为了拦 AI/RAG 抽取的碎片，不应用于人工录入的内容。
    if(!_isUser && _isJunkKbItem(_dt)) continue;
    if(_isUser && !String(_dt||'').replace(/[\s\u2705\u26a0\ufe0f]/g,'')) continue;  // 仅跳真空内容
    var _pair={text:_dt, origIdx:_di};
    if(_isUser) _userPairs.push(_pair);                       // 干部自己增改的，永远全显示
    else if(_dt.indexOf('\u26a0\ufe0f')>=0) _warnPairs.push(_pair);  // 待确认，永远全显示
    else if(_dt.indexOf('\u2705')===0) _donePairs.push(_pair);
    else _normalPairs.push(_pair);
  }
  // 用户补充最新在前
  _userPairs.sort(function(a,b){
    var ta=(_rawKnown[a.origIdx]&&_rawKnown[a.origIdx].ts)||a.origIdx;
    var tb=(_rawKnown[b.origIdx]&&_rawKnown[b.origIdx].ts)||b.origIdx;
    return tb-ta;
  });
  // 精选 6 条 = 已核验(✅) 优先，再补普通条目
  var _KB_PICK=6;
  var _picked=_donePairs.slice(0,_KB_PICK);
  if(_picked.length<_KB_PICK) _picked=_picked.concat(_normalPairs.slice(0,_KB_PICK-_picked.length));
  // 【2026-09-18】待确认显示层去重：同一问题被重复提取多条时合并为 1 条，
  // 同组 origIdx 记入 dupIdx，确认代表条目时一并确认（kb.known 数据层不动）。
  var _warnGroups=_dedupeWarnPairs(_warnPairs);
  window.__kbDupMap=window.__kbDupMap||{};
  window.__kbDupMap[i]={};
  _warnGroups.forEach(function(g){ window.__kbDupMap[i][g.origIdx]=g.dupIdx||[]; });
  var _displayPairs=_userPairs.concat(_warnGroups).concat(_picked);
  var _pickedRest=(_donePairs.length+_normalPairs.length)-_picked.length;
  var _moreCount=_pickedRest>0?_pickedRest:0;
  var displayKnown=_displayPairs.map(function(p2){return p2.text;});
  var knownHtml=(displayKnown&&displayKnown.length)
    ? '<div style="display:flex;flex-direction:column;gap:8px">'+
        displayKnown.map(function(x,xi){
          // 【2026-09-18 修复】用户条目已在分桶时放行，此处不能再把它渲染成空串。
          var _rawAtIdx=_displayPairs[xi]?_rawKnown[_displayPairs[xi].origIdx]:null;
          var _isUserRow=(_rawAtIdx && typeof _rawAtIdx==='object' && _rawAtIdx.origin==='user');
          if(!_isUserRow && _isJunkKbItem(x)) return '';
          var warn=x.indexOf('⚠️')>=0;
          var isFile=x.indexOf('📎')===0;
          var clean=x.replace('⚠️ ','');
          var badges=[];
          // 统一抽取卡片正文里的量化数字（金额/产能/面积/重量/长度/百分比/企业台数等），
          // 避免旧正则只认 8 个单位导致卡片底部有时空白。2026-09-01 扩展包括：
          //   金额：亿元/亿美元/亿/万元/万美元/万
          //   产能：万辆/万吨/万台/万件/万套/万只/万头/万人
          //   能量：GWh/MWh/kWh/MW/kW/Wh
          //   重量/体积：吨/kg/公斤/克/m³/m²/㎡/万m³/万㎡
          //   面积/长度：公顷/亩/公里/km
          //   百分比：%/百分点
          //   计数：家/户/款/台/座/项/条/人/个/张/批/次
          var _seenBadge={};
          clean.replace(/(\d+(?:[,\.]\d+)*)\s*(亿元|亿美元|亿|万元|万美元|万辆|万吨|万台|万件|万套|万只|万头|万人|万m³|万㎡|万|kwh|kWh|GWh|MWh|MW|kW|Wh|吨|kg|公斤|克|公顷|公里|km|m³|m²|㎡|亩|百分点|%|家|户|款|台|座|项|条|人|个|张|批|次)/g,function(m){
            var _key=m.replace(/\s+/g,'');
            if(!_seenBadge[_key] && badges.length<10){ _seenBadge[_key]=1; badges.push(_key); }
            return m;
          });
          var badgeHtml=badges.length
            ?'<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:7px">'+
               badges.map(function(b){
                 return '<span style="padding:2px 8px;background:#dbeafe;color:#1e40af;border-radius:6px;font-size:11.5px;font-weight:700;letter-spacing:.3px">'+b+'</span>';
               }).join('')+'</div>':'';
          var accent=warn?'#f59e0b':isFile?'#22c55e':xi===0?'#6366f1':'#94a3b8';
          var bg=warn?'#fffbeb':isFile?'#f0fdf4':'#f8faff';
          var bd=warn?'#fde68a':isFile?'#bbf7d0':'#e8edf5';
          var icon=warn?'⚠':isFile?'📎':xi===0?'★':'•';
          var txtColor=warn?'#78350f':isFile?'#14532d':'#1e293b';
          // 检查是否已确认
          var _oi=(_displayPairs[xi]?_displayPairs[xi].origIdx:xi);
          var confirmed=KB_CONFIRMS[cur]&&KB_CONFIRMS[cur][i]&&KB_CONFIRMS[cur][i][_oi];
          var isConfirmed=!!confirmed;
          // 已确认条目：绿色样式
          if(isConfirmed){
            bg='#f0fdf4';bd='#86efac';accent='#22c55e';icon='\u2705';txtColor='#14532d';
          }
          // ⚠️ 条目的操作按钮
          var actionBtns='';
          if(warn&&!isConfirmed){
            // 【2026-09-18】去重提示：该条代表了几条同义表述，确认一次全清。
            // 不标明的话，干部以为还剩很多条没点，或以为点完了却没点完。
            var _dupN2=((window.__kbDupMap&&window.__kbDupMap[i]&&window.__kbDupMap[i][_oi])||[]).length;
            var _dupTag=_dupN2>0
              ?'<div style="margin-top:6px;font-size:11px;color:#92400e;background:#fef3c7;border:1px dashed #fcd34d;border-radius:6px;padding:3px 7px;display:inline-block">已合并 '+(_dupN2+1)+' 条同义表述，确认一次即全部清除</div>'
              :'';
            actionBtns=_dupTag+'<div style="display:flex;gap:6px;margin-top:8px">'+
              '<button onclick="confirmKbItem('+i+','+(_displayPairs[xi]?_displayPairs[xi].origIdx:xi)+')" '+
                'style="flex:1;padding:6px 0;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;font-size:12px;color:#166534;cursor:pointer;font-weight:600" '+
                'onmouseover="this.style.background=\'#dcfce7\'" onmouseout="this.style.background=\'#f0fdf4\'">'+
                '\u2713 确认'+(_dupN2>0?('（'+(_dupN2+1)+' 条）'):'')+
              '</button>'+
              '<button onclick="editKbItem('+i+','+(_displayPairs[xi]?_displayPairs[xi].origIdx:xi)+')" '+
                'style="flex:1;padding:6px 0;background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:8px;font-size:12px;color:#6d28d9;cursor:pointer;font-weight:600" '+
                'onmouseover="this.style.background=\'#ede9fe\'" onmouseout="this.style.background=\'#f5f3ff\'">'+
                '\u270e 修改内容'+
              '</button>'+
              '<button onclick="deleteKbItem('+i+','+(_displayPairs[xi]?_displayPairs[xi].origIdx:xi)+')" title="删除该条待确认事项" '+
                'style="padding:6px 10px;background:#fef2f2;border:1.5px solid #fecaca;border-radius:8px;font-size:12px;color:#dc2626;cursor:pointer;font-weight:600" '+
                'onmouseover="this.style.background=\'#fee2e2\'" onmouseout="this.style.background=\'#fef2f2\'">'+
                '\u2715 删除'+
              '</button>'+
            '</div>';
          } else if(isConfirmed){
            actionBtns='<div style="margin-top:6px;font-size:11px;color:#22c55e;display:flex;align-items:center;gap:4px">'+
              '<span>\u2713 已确认</span>'+
              '<button onclick="editKbItem('+i+','+_oi+')" style="background:none;border:none;color:#94a3b8;font-size:11px;cursor:pointer;margin-left:6px">修改</button>'+
              '<button onclick="deleteKbItem('+i+','+(_displayPairs[xi]?_displayPairs[xi].origIdx:xi)+')" style="background:none;border:none;color:#cbd5e1;font-size:11px;cursor:pointer;margin-left:2px">删除</button>'+
            '</div>';
          } else {
            actionBtns='<div style="display:flex;gap:6px;margin-top:8px">'+
              '<button onclick="editKbItem('+i+','+(_displayPairs[xi]?_displayPairs[xi].origIdx:xi)+')" '+
                'style="flex:1;padding:6px 0;background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:8px;font-size:12px;color:#6d28d9;cursor:pointer;font-weight:600" '+
                'onmouseover="this.style.background=\'#ede9fe\'" onmouseout="this.style.background=\'#f5f3ff\'">'+
                '\u270e 修改内容'+
              '</button>'+
              '<button onclick="deleteKbItem('+i+','+(_displayPairs[xi]?_displayPairs[xi].origIdx:xi)+')" title="删除该条" '+
                'style="padding:6px 10px;background:#fef2f2;border:1.5px solid #fecaca;border-radius:8px;font-size:12px;color:#dc2626;cursor:pointer;font-weight:600" '+
                'onmouseover="this.style.background=\'#fee2e2\'" onmouseout="this.style.background=\'#fef2f2\'">'+
                '\u2715 删除'+
              '</button>'+
            '</div>';
          }
          return '<div id="kb-card-'+i+'-'+_oi+'" style="border-radius:12px;background:'+bg+';border:1.5px solid '+bd+';overflow:visible;transition:border-color .15s">'+
            '<div style="display:flex">'+
              '<div style="width:4px;background:'+accent+';flex-shrink:0"></div>'+
              '<div style="padding:10px 13px;flex:1">'+
                '<div style="display:flex;gap:8px;align-items:flex-start">'+
                  '<span style="font-size:12px;flex-shrink:0;margin-top:2px;color:'+accent+'">'+icon+'</span>'+
                  '<div style="flex:1">'+
                    '<span style="font-size:13px;color:'+txtColor+';line-height:1.7;word-break:break-all;overflow-wrap:break-word">'+highlightKeyData(clean)+'</span>'+
                    badgeHtml+
                    actionBtns+
                  '</div>'+
                '</div>'+
              '</div>'+
            '</div>'+
          '</div>';
        }).join('')+
      '</div>'
    : '<div style="color:#9aa5b5;font-size:13px;padding:12px 0">暂无已知内容，点击下方按钮基于此主题提问。</div>';
  if(_moreCount>0){
    knownHtml+='<div style="text-align:center;padding:8px;font-size:12px;color:#8492a6;background:#f8faff;border-radius:8px;margin-top:6px">还有 '+_moreCount+' 条基础数据未展示（仅显示待确认项+精选摘要）</div>';
  }

  // 数据来源标签
  var callsHtml=(k.calls&&k.calls.length)
    ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">'+
        k.calls.map(function(c){
          return '<span style="padding:3px 10px;background:#f0f4ff;color:#1a56db;border-radius:12px;font-size:11.5px">'+c+'</span>';
        }).join('')+'</div>'
    : '';

  var modalHtml=
    '<div id="kbDetailModal" onclick="if(event.target.id===\'kbDetailModal\')closeKbDetail()" '+
      'style="position:fixed;inset:0;background:rgba(11,24,59,.4);z-index:8888;display:flex;align-items:flex-start;justify-content:flex-end;padding:16px;backdrop-filter:blur(2px)">'+
      '<div style="background:#fff;border-radius:18px;width:420px;max-width:95vw;max-height:calc(100vh - 32px);overflow:hidden;display:flex;flex-direction:column;box-shadow:0 8px 48px rgba(11,24,59,.16);animation:slideIn .22s ease">'+

        // 顶栏
        '<div style="padding:20px 22px 16px;border-bottom:1px solid #f0f4ff;flex:0 0 auto">'+
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">'+
            '<span style="font-size:11px;font-weight:650;color:#6366f1;letter-spacing:.5px">KNOWLEDGE SCOPE</span>'+
            '<button onclick="closeKbDetail()" style="background:none;border:none;font-size:18px;color:#9aa5b5;cursor:pointer;padding:2px 6px;border-radius:6px" onmouseover="this.style.background=\'#f5f7fb\'" onmouseout="this.style.background=\'none\'">✕</button>'+
          '</div>'+
          '<h2 style="font-size:17px;font-weight:750;color:#0b183b;margin:0 0 4px">'+k.icon+' '+k.t+'</h2>'+
          '<p style="font-size:12.5px;color:#8492a6;margin:0">'+(_getDisplaySub(i)||k.sub)+'</p>'+
        '</div>'+

        // 内容区（可滚动）
        '<div style="flex:1;overflow-y:auto;padding:18px 22px">'+

          '<div id="kbDetailList-'+i+'" style="margin-bottom:18px">'+
            '<h3 style="font-size:12px;font-weight:650;color:#4a5568;letter-spacing:.3px;margin:0 0 10px">当前已知'+
              '<span style="font-weight:400;color:#b0bac8;margin-left:6px">⚠ 标注项需政府确认</span>'+
            '</h3>'+
            knownHtml+
          '</div>'+

          (callsHtml?
          '<div style="margin-bottom:16px">'+
            '<h3 style="font-size:12px;font-weight:650;color:#4a5568;letter-spacing:.3px;margin:0 0 8px">本次回答可调用来源</h3>'+
            callsHtml+
          '</div>':'')+

          '<div style="padding:10px 12px;background:#f8faff;border-radius:10px;font-size:11.5px;color:#9aa5b5;line-height:1.6">'+
            '公开信息仅用于辅助研判；园区承载、企业采购和领导任务仍需政府授权材料确认。'+
          '</div>'+
        '</div>'+

        // 确认进度条
        (function(){
          var warns=k.known.filter(function(x){return _kbText(x).indexOf('\u26a0\ufe0f')>=0;});
          var total=warns.length;
          var done=(KB_CONFIRMS[cur]&&KB_CONFIRMS[cur][i])?Object.keys(KB_CONFIRMS[cur][i]).length:0;
          if(!total)return '';
          return '<div style="padding:0 22px 12px">'+
            '<div style="display:flex;justify-content:space-between;font-size:11px;color:#9aa5b5;margin-bottom:5px">'+
              '<span>确认进度</span><span>'+done+' / '+total+'</span>'+
            '</div>'+
            '<div style="height:5px;background:#f0f4ff;border-radius:3px;overflow:hidden">'+
              '<div style="height:100%;width:'+(total?Math.round(done/total*100):0)+'%;background:linear-gradient(90deg,#22c55e,#16a34a);border-radius:3px;transition:width .4s"></div>'+
            '</div></div>';
        })()+
        '<div style="padding:14px 22px 18px;border-top:1px solid #f0f4ff;flex:0 0 auto;display:flex;flex-wrap:wrap;gap:8px">'+
          '<button onclick="closeKbDetail();askAboutKb('+i+')" style="flex:1;min-width:120px;padding:11px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:10px;font-size:13.5px;font-weight:600;cursor:pointer">'+
            '基于此主题提问 →'+
          '</button>'+
          '<button onclick="addKbItem('+i+')" style="padding:11px 13px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;font-size:13px;color:#166534;cursor:pointer;font-weight:600">'+
            '+ 补充结论'+
          '</button>'+
          '<button onclick="pickLocalFile('+i+')" style="padding:11px 13px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:10px;font-size:13px;color:#4a5568;cursor:pointer">'+
            '📎 上传材料'+
          '</button>'+
        '</div>'+
      '</div>'+
    '</div>';

  // 注入 slideIn keyframe（只注一次）
  if(!document.getElementById('kbDetailStyle')){
    var st=document.createElement('style');st.id='kbDetailStyle';
    st.textContent='@keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}';
    document.head.appendChild(st);
  }

  closeKbDetail(); // 清掉旧的
  var wrap=document.createElement('div');
  wrap.innerHTML=modalHtml;
  document.body.appendChild(wrap.firstChild);
}

function closeKbDetail(){
  var m=document.getElementById('kbDetailModal');
  if(m)m.remove();
}

function setKbActiveTopic(idx,k,conv){
  var rows=document.querySelectorAll('.topic-row');
  rows.forEach(function(r,ri){
    r.style.boxShadow=ri===idx?'0 0 0 2.5px #1a56db,0 4px 18px rgba(26,86,219,.15)':'';
    r.style.borderColor=ri===idx?'#1a56db':'';
    r.style.background=ri===idx?'#f0f4ff':'';
  });
  var old=document.getElementById('kbTopicBadge');if(old)old.remove();
  var CM={'主导产业与产业链':{bg:'#eff6ff',br:'#bfdbfe',tx:'#1d4ed8',dt:'#3b82f6'},
    '园区与承载条件':{bg:'#f0fdf4',br:'#bbf7d0',tx:'#166534',dt:'#22c55e'},
    '链主与存量企业':{bg:'#fdf4ff',br:'#e9d5ff',tx:'#6b21a8',dt:'#a855f7'},
    '政策、规划与领导关注':{bg:'#fffbeb',br:'#fde68a',tx:'#92400e',dt:'#f59e0b'}};
  var c=CM[k.t]||{bg:'#f5f7fb',br:'#e8edf5',tx:'#4a5568',dt:'#9aa5b5'};
  var badge=document.createElement('div');badge.id='kbTopicBadge';
  badge.style.cssText='margin:0 0 12px;padding:10px 14px;background:'+c.bg+';border:1.5px solid '+c.br+';border-radius:12px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10';
  badge.innerHTML='<span style="width:8px;height:8px;border-radius:50%;background:'+c.dt+';flex:0 0 auto"></span>'
    +'<div style="flex:1"><div style="font-size:11px;font-weight:650;color:'+c.tx+';letter-spacing:.4px">当前提问主题</div>'
    +'<div style="font-size:13px;font-weight:700;color:'+c.tx+'">'+k.icon+' '+k.t+'</div></div>'
    +'<button onclick="clearKbActiveTopic()" style="background:none;border:none;color:'+c.tx+';opacity:.5;cursor:pointer;font-size:15px;padding:2px 6px">✕</button>';
  if(conv){conv.insertBefore(badge,conv.children[1]||null);}
  setTimeout(renderComposer,0);
}
function clearKbActiveTopic(){
  document.querySelectorAll('.topic-row').forEach(function(r){
    r.style.boxShadow='';r.style.borderColor='';r.style.background='';
  });
  var b=document.getElementById('kbTopicBadge');if(b)b.remove();
  renderComposer();
}

// 「基于这个主题提问」→ 在城市智库对话区直接问答（回复对应 + 底部调用来源）
function askAboutKb(i){
  var k=P().kb[i]; if(!k) return;
  var qMap={
    '主导产业与产业链':P().city+'主导产业链上补链的核心缺口有哪些？结合配套率和链主外采情况分析。',
    '园区与承载条件':P().city+'各园区如何分工承接不同细分产业？厂房、能耗与用地条件是否满足？',
    '链主与存量企业':P().city+'本地链主企业的外采依赖集中在哪些核心环节？招引上游配套的优先级如何？',
    '政策、规划与领导关注':P().city+'在「'+P().topic+'」方向，政策支持最强、待干部确认的关键事项有哪些？'
  };
  var q=qMap[k.t]||('请结合「'+k.t+'」主题数据，分析'+P().city+'的现状与优先推进的招引方向。');
  closeKbDetail();
  if(view!=='knowledge'){view='knowledge';render();}
  var c=document.getElementById('kbConv');
  if(!c){setTimeout(function(){askAboutKb(i);},100);return;}
  var ud=document.createElement('div');ud.className='message is-user';
  ud.innerHTML='<div class="message-bubble"><p>'+q+'</p></div>';
  c.appendChild(ud);c.scrollTop=c.scrollHeight;
  kbChatPush('user', ud.outerHTML);
  setKbActiveTopic(i,k,c);
  kbRAGQueryWithHint(q,c,k);
}
// 真实文件选择器：弹系统文件夹
function pickLocalFile(kbTopicIdx){
  var inp=document.createElement('input');
  inp.type='file';inp.multiple=true;
  inp.accept='.txt,.md,.csv,.pdf,.doc,.docx,.xls,.xlsx';
  inp.onchange=function(){
    var files=Array.from(inp.files||[]);
    if(!files.length)return;
    closeKbDetail();
    ingestFiles(files,kbTopicIdx);
  };
  inp.click();
}

/* ── 文件摄取：读取 → 切 chunk → 存 KB_FILE_CHUNKS → 更新 kb.known ── */
function ingestFiles(files, kbTopicIdx){
  var p=P(); if(!p) return;
  var total=files.length, done=0, allChunks=[];

  // 先登记上传条目（pending），避免解析异步进行时侧栏/进度读到「0 份」
  // 【2026-09-21】重新上传同名文件时必须清掉它的删除墓碑，否则服务端合并会把
  // 新上传的这份当成「已删除」直接剔除（墓碑键是 projKey::fileName，不含 ts）。
  files.forEach(function(f){
    if(!f||!f.name) return;
    try{ delete UPLOAD_TOMBS[cur+'::'+f.name]; }catch(_){}
  });
  try{ localStorage.setItem('HXZ_UPLOAD_TOMBS', JSON.stringify(UPLOAD_TOMBS)); }catch(_){}
  if(!UPLOADS[cur]) UPLOADS[cur]=[];
  files.forEach(function(f){
    UPLOADS[cur].push({name:f.name, size:f.size, ts:Date.now(), chunks:0, kbIdx:kbTopicIdx, pending:true});
  });
  try{ refreshKbProgress(); }catch(e){}
  try{ persist(); }catch(e){}

  var c=document.getElementById('kbConv');
  if(c){
    var nd=document.createElement('div'); nd.className='message is-user';
    nd.innerHTML='<div class="message-bubble"><p>📎 已上传 '+total+' 个文件：'+
      files.map(function(f){return f.name;}).join('、')+'</p></div>';
    c.appendChild(nd); c.scrollTop=c.scrollHeight;
    // 持久化上传气泡：否则任一 render()（含跨标签 storage 事件）会经 kbChatReplay 把它冲掉
    try{ kbChatPush('user', nd.outerHTML); }catch(_){}
  }

  // 记录哪些文件真的解析出了正文：finalizeIngest 据此给出真实提示而非一律报成功
  var _parseFailed=[];
  files.forEach(function(file){
    var isDocx=/\.docx?$/i.test(file.name);
    var isPdf=/\.pdf$/i.test(file.name);
    var canRead=/\.(txt|md|csv|json)$/i.test(file.name);
    if(isPdf){
      // PDF：交服务端 pdfplumber 解析。扫描件/无文字层由服务端返回明确原因，
      // 记入 _parseFailed 后如实告知，绝不伪造片段。
      var _finP=function(){ done++; if(done===total) finalizeIngest(allChunks,files,kbTopicIdx,p,_parseFailed); };
      extractDocTextViaServer(file).then(function(txt){
        txt=(txt||'').trim();
        if(txt.length<30){
          _parseFailed.push({name:file.name, reason:'未提取到有效文字（可能是扫描件/图片型 PDF）'});
        } else {
          allChunks=allChunks.concat(textToChunks(txt, file.name, p, kbTopicIdx));
        }
        _finP();
      }).catch(function(err){
        _parseFailed.push({name:file.name, reason:(err&&err.message)||'PDF 解析失败'});
        _finP();
      });
    } else if(isDocx && typeof mammoth!=='undefined'){
      // docx：用 mammoth 提取纯文本
      var reader=new FileReader();
      reader.onload=function(e){
        mammoth.extractRawText({arrayBuffer:e.target.result}).then(function(result){
          var chunks=textToChunks(result.value||'', file.name, p, kbTopicIdx);
          allChunks=allChunks.concat(chunks);
          done++; if(done===total) finalizeIngest(allChunks,files,kbTopicIdx,p,_parseFailed);
        }).catch(function(){ done++; if(done===total) finalizeIngest(allChunks,files,kbTopicIdx,p,_parseFailed); });
      };
      reader.onerror=function(){ done++; if(done===total) finalizeIngest(allChunks,files,kbTopicIdx,p,_parseFailed); };
      reader.readAsArrayBuffer(file);
    } else if(canRead){
      var reader=new FileReader();
      reader.onload=function(e){
        var chunks=textToChunks(e.target.result||'', file.name, p, kbTopicIdx);
        allChunks=allChunks.concat(chunks);
        done++; if(done===total) finalizeIngest(allChunks,files,kbTopicIdx,p,_parseFailed);
      };
      reader.onerror=function(){ done++; if(done===total) finalizeIngest(allChunks,files,kbTopicIdx,p,_parseFailed); };
      reader.readAsText(file,'utf-8');
    } else {
      // 【2026-09-21】原来这里塞一条「用户已上传文件「X」(N KB)」伪片段，于是无解析器的
      //   格式看起来"摄取成功"、正文实际从未入库，伪片段还会污染 RAG 检索。改为如实告知。
      _parseFailed.push({name:file.name,
        reason:'暂不支持该格式的正文解析（当前支持 pdf / docx / txt / md / csv / json）'});
      done++; if(done===total) finalizeIngest(allChunks,files,kbTopicIdx,p,_parseFailed);
    }
  });
}

/* 文本切 chunk — 按段落，每块约150字 */
function textToChunks(text, fname, p, kbTopicIdx){
  var topic=kbTopicIdx!=null&&p&&p.kb[kbTopicIdx] ? p.kb[kbTopicIdx].t : '上传材料';
  text=text.replace(/\r\n/g,'\n').trim();
  var paras=text.split(/\n{2,}/), chunks=[], buf='', ci=0;
  paras.forEach(function(para){
    para=para.trim(); if(!para) return;
    buf+=(buf?' ':'')+para;
    if(buf.length>=120){
      chunks.push({id:'file:'+fname+':'+ci, topic:topic,
        tags:topicTags(topic).concat([fname.replace(/\.[^.]+$/,''),'上传']),
        text:buf.slice(0,300), cite:fname});
      buf=''; ci++;
    }
  });
  if(buf.trim()) chunks.push({id:'file:'+fname+':'+ci, topic:topic,
    tags:topicTags(topic).concat(['上传']), text:buf.slice(0,300), cite:fname});
  return chunks.slice(0,30);
}

/* 摄取完成 — 存 KB_FILE_CHUNKS，更新 kb.known，触发 RAG 摘要 */
function finalizeIngest(chunks, files, kbTopicIdx, p, parseFailed){
  parseFailed = parseFailed || [];
  var _failNames = parseFailed.map(function(x){return x.name;});
  var _okFiles = files.filter(function(f){ return _failNames.indexOf(f.name)<0; });
  if(!cur) return;
  if(!KB_FILE_CHUNKS[cur]) KB_FILE_CHUNKS[cur]=[];
  KB_FILE_CHUNKS[cur]=KB_FILE_CHUNKS[cur].concat(chunks);

  if(!UPLOADS[cur]) UPLOADS[cur]=[];
  files.forEach(function(f){
    var n=chunks.filter(function(c){return c.cite===f.name;}).length;
    // 优先更新 ingestFiles 入口登记的 pending 条目，避免重复计数
    var existing=null;
    for(var i=UPLOADS[cur].length-1;i>=0;i--){
      if(UPLOADS[cur][i].pending && UPLOADS[cur][i].name===f.name){ existing=UPLOADS[cur][i]; break; }
    }
    var rec;
    if(existing){ existing.chunks=n; existing.kbIdx=kbTopicIdx; delete existing.pending; rec=existing; }
    else { rec={name:f.name, size:f.size, ts:Date.now(), chunks:n, kbIdx:kbTopicIdx}; UPLOADS[cur].push(rec); }
    // 关键修复：保存原始文件为 dataUrl，否则管理端下载提示「该文件无原始数据」。
    // 之前 index.html(政府端)上传入库根本没存 dataUrl —— 材料从源头就没有原始数据。
    if(f && (typeof Blob!=='undefined') && (f instanceof Blob) && !rec.dataUrl){
      (function(record, file){
        try{
          var fr=new FileReader();
          fr.onload=function(ev){ record.dataUrl=ev.target.result; persist(); };
          fr.onerror=function(){ persist(); };
          fr.readAsDataURL(file);
        }catch(e){}
      })(rec, f);
    }
  });

  if(kbTopicIdx!=null && p.kb && p.kb[kbTopicIdx]){
    var k=p.kb[kbTopicIdx];
    // 【2026-09-21】只为真正解析出正文的文件写入「已解析」条目：
    //   解析失败的文件此前也会被写成「已解析（0 片段）」，等于在智库里留下假记录。
    _okFiles.forEach(function(f){
      var entry='📎 '+f.name+' 已解析（'+chunks.filter(function(c){return c.cite===f.name;}).length+' 片段）';
      if(k.known.indexOf(entry)<0) k.known.push(entry);
    });
    k.tag='已补充材料';
    persist();
    // 更新卡片标签
    var rows=document.querySelectorAll('.topic-row');
    if(rows[kbTopicIdx]){
      var em=rows[kbTopicIdx].querySelector('em');
      if(em){em.textContent='已补充材料';em.style.color='#006d70';em.style.background='#e4f5f3';}
    }
  }

  refreshKbProgress();
  var c=document.getElementById('kbConv'); if(!c) return;
  var totalChunks=KB_FILE_CHUNKS[cur].length;
  var topicLabel=kbTopicIdx!=null&&p.kb&&p.kb[kbTopicIdx] ? p.kb[kbTopicIdx].t : '城市智库';
  var nd=document.createElement('div'); nd.className='message';
  // 【2026-09-21】此前无论是否真的解析出内容，一律提示「✅ 已摄取 N 个文件」。
  //   PDF 走降级分支时正文从未入库，干部却以为材料已进知识库 —— 静默失败。
  //   现在按真实结果分三种情况，失败必须显式告知并给出原因。
  var _okCount=_okFiles.length, _failCount=parseFailed.length;
  var _chipOk=_okFiles.map(function(f){
      var n=chunks.filter(function(c){return c.cite===f.name;}).length;
      return '<span style="padding:3px 10px;background:#f0fdf4;color:#166534;border-radius:12px;font-size:11.5px;border:1px solid #bbf7d0">'+f.name+' · '+n+' 片段</span>';
    }).join('');
  var _chipFail=parseFailed.map(function(x){
      return '<span style="padding:3px 10px;background:#fef2f2;color:#b91c1c;border-radius:12px;font-size:11.5px;border:1px solid #fecaca">'+x.name+' · 未解析</span>';
    }).join('');
  var _head;
  if(_okCount>0 && _failCount===0){
    _head='<p>✅ 已摄取 <strong>'+_okCount+' 个文件</strong>，提取 <strong>'+chunks.length+' 个知识片段</strong>，追加至「'+topicLabel+'」。</p>';
  } else if(_okCount>0 && _failCount>0){
    _head='<p>⚠️ 部分成功：<strong>'+_okCount+' 个文件</strong>已解析（'+chunks.length+' 个片段），'
        + '<strong>'+_failCount+' 个未能解析</strong>，其内容<strong>未进入知识库</strong>。</p>';
  } else {
    _head='<p>❌ <strong>'+_failCount+' 个文件均未能解析</strong>，内容<strong>没有进入知识库</strong>，提问时不会被检索到。</p>';
  }
  var _reasons = _failCount? ('<div style="margin-top:8px;padding:8px 10px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:11.5px;color:#92400e;line-height:1.7">'
      + parseFailed.map(function(x){ return '· <strong>'+x.name+'</strong>：'+x.reason; }).join('<br>')
      + '<br>建议：扫描件可先用 OCR 转成可复制文字的 PDF，或直接粘贴关键段落到对话框。</div>') : '';
  nd.innerHTML='<img src="'+aiAvatar()+'"><div class="message-bubble">'+
    _head+
    '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">'+_chipOk+_chipFail+'</div>'+
    _reasons+
    '<p style="margin-top:8px;font-size:12px;color:#8492a6">知识库现有 '+totalChunks+' 个片段，提问时自动检索最相关内容。</p>'+
    '</div>';
  c.appendChild(nd); c.scrollTop=c.scrollHeight;
  // 持久化摄取结果气泡：否则任一 render()（含跨标签 storage 事件）会经 kbChatReplay 把它冲掉
  try{ kbChatPush('ai', nd.outerHTML); }catch(_){}

  if(chunks.length>0){
    // 临存本次上传 chunks，供按钮回调使用（原有结论完全不动）
    window._lastIngestChunks=chunks;
    window._lastIngestTopicLabel=topicLabel;
    window._lastIngestKbIdx=kbTopicIdx;
    // 持久化一条“待分析”标记，使三个按钮在 render/刷新/跨标签后可由 kbChatReplay 重建
    try{
      var _si=kbActiveSession(cur); if(_si){
      _si.messages.push({role:'ingest-actions', n:chunks.length, label:topicLabel, kbIdx:(kbTopicIdx===undefined?null:kbTopicIdx), ts:Date.now()});
      if(_si.messages.length>100) _si.messages=_si.messages.slice(-100);
      persist(); }
    }catch(_){}
    setTimeout(function(){
      var wrap=document.createElement('div');
      wrap.innerHTML=ingestActionsHtml();
      var ad=wrap.firstChild;
      c.appendChild(ad);
      c.scrollTop=c.scrollHeight;
      // 上传完成后确保整个问答区也滚到底
      setTimeout(function(){ var kc=document.getElementById('kbConv'); if(kc) kc.scrollTop=kc.scrollHeight; var ks=document.querySelector('.knowledge-scroll'); if(ks) ks.scrollTop=ks.scrollHeight; },100);
    },800);
  }
}



/* 【2026-09-23 修复 T2】材料校验结论自相矛盾——收口为「一次解析、单一裁决」。

   原实现对同一段 AI 输出做了三次独立解析，三层各说一套：
   1) 正文直接渲染 AI 原文，图标是模型给的（模型常把 ✅ 错用到"智库无此数据"行）；
   2) 抬头计数在前端重新分类，且语义优先于图标；
   3) 逐条确认面板只扫 '❌' 开头的行。
   于是「✅ 眼科粘弹剂市占率：文件写 60%，智库记录 51% → 不一致」这一行：
   正文显示"一致 ✅"、抬头计入"矛盾"、面板一条都捞不到（点了只弹"未能定位"）。
   同一条事实三种结论，干部无法判断哪个数字可信。

   现在统一走 parseVerifyDetail()：每行只裁决一次，产出唯一 bucket；
   正文按裁决结果重写行首图标，抬头计数与确认面板都复用同一份 rows。
   另修：明细行识别不再只认图标行——模型改用 "- xxx：文件写…" 纯文字列表时，
   旧逻辑整段统计为 0，抬头会显示"新增 0 条，一致 0 条"而正文明明列了一堆。
   无法判定的明细行一律归入「待确认」，绝不默认算作"一致"（假一致比漏报更危险）。 */
var _VERIFY_ICON={conflict:'\u274c', newadd:'\u26a0\ufe0f', consistent:'\u2705'};
function _stripVerifyLead(t){
  // 去掉行首的图标、列表符、序号，留下正文，便于提取指标名
  return String(t||'')
    .replace(/^[\s>*_]+/,'')
    .replace(/^(?:[\u274c\u2705\u26a0\ufe0f]+|[-\u2022\u30fb]|\d+[.\uff0e\u3001)])\s*/,'')
    .replace(/^[\u274c\u2705\u26a0\ufe0f\s]+/,'')
    .trim();
}
function parseVerifyDetail(accText){
  var out={rows:[], conflict:0, newadd:0, consistent:0};
  var lines=String(accText||'').split('\n');
  lines.forEach(function(ln, li){
    var t=ln.trim();
    if(!t) return;
    if(/^结论[：:]/.test(t)) return;                       // 首行结论不算明细
    var iconConflict=/^\s*(?:\u274c)/.test(t);
    var iconNewAdd=/^\s*(?:\u26a0)/.test(t);
    var iconOk=/^\s*(?:\u2705)/.test(t);
    var body=_stripVerifyLead(t);
    // 明细行判定：带图标，或「含冒号 + 提到文件/智库」——后者兼容纯文字列表
    var looksDetail=(iconConflict||iconNewAdd||iconOk) ||
                    (/[：:]/.test(body) && /(文件|智库)/.test(body));
    if(!looksDetail) return;
    var saysNewAdd=/新增数据|智库无此数据|智库无此|智库未记录|智库未收录|文件未直接写|文件无此数据|无对应记录|无法核验/.test(t);
    var saysConflict=/→\s*不一致|→\s*数据不符|数值不同|数据不符|明显偏差|差异较大|与[^，,]{0,12}矛盾|不一致/.test(t);
    var saysConsistent=/记录一致|数值一致|完全一致|→\s*一致|与智库一致/.test(t);
    var saysPending=/待确认|待核实|需核实|需人工|存疑|口径待|年份待|尚未核实/.test(t);
    var b;
    if(saysConflict) b='conflict';
    else if(saysNewAdd) b='newadd';
    else if(saysConsistent && !saysPending) b='consistent';
    else if(saysPending) b='newadd';
    else if(iconConflict) b='conflict';
    else if(iconNewAdd) b='newadd';
    else if(iconOk) b='consistent';
    else b='newadd';        // 兜底：判不出来就是要核实，绝不算"一致"
    // 供确认面板用：指标名 / 文件值 / 智库值
    var nm=(/^([^：:]+)[：:]/.exec(body)||[])[1];
    var vm=/[：:]\s*文件[写说记载]*\s*([^，,→]+)[，,→].*?智库[记录已有]*\s*([^，,→\n]+)/.exec(t);
    out.rows.push({
      lineIdx:li, raw:t, body:body, bucket:b,
      name:(nm?nm.trim():''),
      fileVal:(vm?vm[1].replace(/\*\*/g,'').trim():''),
      kbVal:(vm?vm[2].replace(/\*\*/g,'').trim():'')
    });
    out[b]++;
  });
  return out;
}
/* 按裁决结果重写正文：行首图标归正 + 首行结论从明细实时汇总（不再用 AI 自报的数字） */
function rewriteVerifyText(accText, parsed){
  var lines=String(accText||'').split('\n');
  var byIdx={};
  parsed.rows.forEach(function(r){ byIdx[r.lineIdx]=r; });
  var outLines=lines.map(function(ln, li){
    var r=byIdx[li];
    if(!r) return ln;
    var indent=(/^(\s*)/.exec(ln)||['',''])[1];
    return indent+_VERIFY_ICON[r.bucket]+' '+r.body;
  });
  var head='结论：'+(parsed.conflict>0?('发现矛盾 '+parsed.conflict+' 处'):'未发现矛盾')
          +'（矛盾 '+parsed.conflict+' 条 / 待确认 '+parsed.newadd+' 条 / 一致 '+parsed.consistent
          +' 条，共核验 '+parsed.rows.length+' 条）';
  var hi=-1;
  for(var i=0;i<outLines.length;i++){ if(/^\s*结论[：:]/.test(outLines[i])){ hi=i; break; } }
  if(hi>=0) outLines[hi]=head; else outLines.unshift(head, '');
  return outLines.join('\n');
}

/* ── 材料可信度校验：交叉比对新材料与现有智库结论，标出疑点 ── */
function kbVerifyMaterial(){
  var newChunks=window._lastIngestChunks||(KB_FILE_CHUNKS[cur]||[]); // fallback到已上传的文件chunks
  var topicLabel=window._lastIngestTopicLabel||'城市智库';
  var kbIdx=window._lastIngestKbIdx;
  var p=P(); if(!p) return; if(!newChunks.length){ toast('请先上传材料后再校验'); return; }

  // 只把校验按钮变为加载态，其他两个按钮保留
  window._verifyInProgress=true;
  var verifyBtn=document.querySelector('#kbIngestActions [data-action="verify"]'); if(verifyBtn){verifyBtn.disabled=true;verifyBtn.textContent='🔍 校验中…';}

  var c=document.getElementById('kbConv'); if(!c) return;

  // 用户问句气泡
  var q='请校验这批新上传材料的可信度：有无错误信息、与已有结论矛盾处、或可疑数据？';
  var qd=document.createElement('div'); qd.className='message is-user';
  qd.innerHTML='<div class="message-bubble"><p>'+q+'</p></div>';
  c.appendChild(qd); c.scrollTop=c.scrollHeight;
  var _ks=document.querySelector('.knowledge-scroll'); if(_ks) _ks.scrollTop=_ks.scrollHeight;
  kbChatPush('user', qd.outerHTML);

  // 把新文件原文和智库结论都直接嵌入 question，让模型两份原文逐字对比
  // 新文件原文
  var newText=newChunks.map(function(ck){return ck.text;}).join('\n');

    // 智能匹配：从全部智库条目中找与新文件内容最相关的条目对比
  var _allKnown=[];
  if(p.kb){
    p.kb.forEach(function(t){
      (t.known||[]).forEach(function(x){
        var _xt=_kbText(x); if(_xt.indexOf('\ud83d\udcce')!==0)
          _allKnown.push(_xt.replace(/^[\u2705\u26a0\ufe0f\s]+/,''));
      });
    });
  }
  /* 【2026-09-23 修复 T2-3】校验基准覆盖面：原来死板地 slice(0,12)，
     松江真实智库 68 条 → 只带 18% 进 prompt。后果是智库里明明有的数据
     （实测「昊海生科…2021年细分市场份额分别达51%/45%/29%」）没被带上，
     AI 只能回答"智库无此数据"，把已有数据误报成 ⚠️ 新增——
     于是「一致 / 新增」两类本身就不可信，比单纯漏报更误导干部。
     另一个坑：原 `if(topicKnown.length<3) topicKnown=_allKnown.slice(0,10)`
     会塞 10 条与新文件毫不相干的条目，等于拿错基准去核验。

     现在改为三段式：
     1) 定向检索：把新文件里的数字/百分比逐个抽出来，凡智库条目含同一数字的
        一律优先入选——数值核验靠的就是这些条目，绝不能被名额挤掉；
     2) 关键词召回：按命中关键词个数排序，多的优先；
     3) 字符预算：按总长度上限（约 12000 字）动态放宽条数，不再固定 12 条；
        无相关条目时宁可留空（prompt 里明确告知"智库暂无可比对结论"），
        也不塞无关条目冒充基准。 */
  // 1) 新文件中的数字/百分比/金额（核验的真正对象）
  var _fileNums=(newText.match(/\d+(?:\.\d+)?\s*(?:%|万|亿|千|百分点)?/g)||[])
    .map(function(s){ return s.replace(/\s+/g,''); })
    .filter(function(s){ return /\d/.test(s) && s.replace(/[^\d]/g,'').length>=2; });  // 单个数字噪声太大
  _fileNums=_fileNums.filter(function(w,i,a){ return a.indexOf(w)===i; }).slice(0,40);
  // 2) 关键词（中文按 2-6 字切片，兼容无空格分隔的中文正文）
  var _kwRaw=newText.replace(/[\d\.%+\-()\uff08\uff09\uff1a:\uff0c\u3002\u3001/\n\r\t]+/g,' ').split(/\s+/);
  var _fileKeywords=[];
  _kwRaw.forEach(function(seg){
    if(!seg) return;
    if(seg.length<=6){ if(seg.length>=2) _fileKeywords.push(seg); return; }
    for(var i=0;i+2<=seg.length && i<40;i+=2){ _fileKeywords.push(seg.substr(i,4)); }
  });
  _fileKeywords=_fileKeywords.filter(function(w,i,a){ return w.length>=2 && a.indexOf(w)===i; }).slice(0,60);
  /* 打分：含相同数字权重最高，其次关键词命中数。
     数字匹配必须避免子串误命中——裸「120」会命中「1200亿」「120万」，
     食堂采购清单那种无关文件就会被误判成"与智库相关"。
     因此只认两类：带单位的数字（51%、1850亿）原样匹配；
     裸数字必须与智库里一个完整的「数字+单位」token 相等（见 _numHitsIn）。 */
  function _numHitsIn(item, n){
    if(/[%万亿千]|百分点/.test(n)) return item.indexOf(n)>=0?1:0;  // 带单位足够独特，原样匹配
    /* 裸数字（2024、1850）必须对应智库里一个「完整的数」才算命中，否则：
       食堂清单的 80 会命中「球管寿命突破 80 万秒次」、120 会命中 1200。
       不能只看紧邻字符——真实文本有「80 万秒次」这种中间带空格的写法，
       所以把条目里的「数字+单位」整体切成 token，要求 token 完全相等。 */
    var toks=item.match(/\d+(?:\.\d+)?\s*(?:%|万|亿|千|百分点|[A-Za-z]+)?/g)||[];
    for(var i=0;i<toks.length;i++){
      // 带字母单位的（80kW、300mm）不是同一个量，裸数字不得与之相等
      if(/[A-Za-z]/.test(toks[i])) continue;
      if(toks[i].replace(/\s+/g,'')===n) return 1;
    }
    return 0;
  }
  var _scored=_allKnown.map(function(item, _i){
    /* 强命中：带单位的数字相同（51%、1850亿）——这种巧合概率极低，足以证明同一指标。
       弱命中：裸数字相同（80、2024）——「80斤白菜」和「80kW以上」会撞，
       所以裸数字必须另有关键词支撑才算相关，单靠它不足以把条目拉进基准。 */
    var strongHit=0, weakHit=0;
    _fileNums.forEach(function(n){
      if(_numHitsIn(item,n)<=0) return;
      if(/[%万亿千]|百分点/.test(n)) strongHit++; else weakHit++;
    });
    var kwHit=0;
    _fileKeywords.forEach(function(kw){ if(item.indexOf(kw)>=0) kwHit++; });
    var numHit=strongHit+weakHit;
    // 相关性门槛：有强命中 → 直接入选；否则需关键词命中 >=2（裸数字或单个泛词不够）
    var relevant=(strongHit>0) || (kwHit>=2);
    return {item:item, ord:_i,
            score:(relevant?(strongHit*1000+weakHit*50+kwHit):0),
            numHit:numHit, strongHit:strongHit, kwHit:kwHit};
  }).filter(function(s){ return s.score>0; });
  _scored.sort(function(a,b){ return (b.score-a.score)||(a.ord-b.ord); });
  /* 3) 字符预算：按总长度动态放宽条数，不再固定 12 条。
     注意这里不设"至少保 N 条"下限——无相关条目时必须真留空，
     塞无关条目当基准会让 AI 拿错参照物做判定（原 slice(0,10) 兜底就是这个错）。 */
  var _KB_BUDGET=12000, _used=0;
  var topicKnown=[];
  _scored.forEach(function(s){
    if(_used+s.item.length>_KB_BUDGET) return;
    topicKnown.push(s.item); _used+=s.item.length;
  });
  var _numHitCount=_scored.filter(function(s){ return s.strongHit>0; }).length;
  var knownHint=topicKnown.length ? '（智库已有结论：'+topicKnown.join('；')+'）' : '';



  var prompt=
    '【新上传文件原文】\n'+newText+'\n\n'
    +'【智库已有结论（正确基准）】\n'
    +(topicKnown.length
        ? (topicKnown.join('\n')
           +'\n（以上为智库 '+_allKnown.length+' 条结论中与本文件相关的 '+topicKnown.length+' 条）')
        : '（智库暂无与本文件相关的结论，本次无法做数值比对：请把文件中的数据点全部标记为 ⚠️ 新增数据，不要凭空判定"一致"）')
    +'\n\n'
    +'任务：逐条核验新上传文件中每一个数据点。\n\n'
    +'核验方法：文件中的每个数字/百分比/数量，都去智库已有结论里找同一指标。\n'
    +'- 数值一致 → 标记 ✅\n'
    +'- 数值不同 → 标记 ❌ 并写明双方数值\n'
    +'- 智库无此数据无法核验 → 标记 ⚠️ 新增数据\n\n'
    +'输出格式（严格遵守，不要多余文字）：\n'
    +'第一行：「结论：发现矛盾N处」或「结论：未发现矛盾」\n'
    +'然后逐条列出文件中的每个数据点：\n'
    +'❌ [指标名]：文件写 [XX]，智库记录 [YY] → 不一致\n'
    +'✅ [指标名]：文件写 [XX]，智库记录一致\n'
    +'⚠️ [指标名]：文件写 [XX]，智库无此数据\n\n'
    +'重要：\n'
    +'- 必须逐个数据点列出，不可跳过任何数字\n'
    +'- 年份不同的同一指标视为矛盾（数据可能已更新）\n'
    +'- 绝对不可只输出一句笼统总结';

  // 思考气泡
  var thinking=document.createElement('div');
  thinking.className='message';
  thinking.innerHTML='<img src="'+aiAvatar()+'"><div class="message-bubble"><span style="color:#9aa5b5;font-size:12px">🔍 正在校验材料可信度…</span></div>';
  c.appendChild(thinking); c.scrollTop=c.scrollHeight;

  var ansNode=document.createElement('div');
  ansNode.className='message';
  var bubble=document.createElement('div');
  bubble.className='message-bubble';
  var bodyDiv=document.createElement('div');
  bubble.appendChild(bodyDiv);
  var imgEl=document.createElement('img');
  imgEl.src=aiAvatar();
  ansNode.appendChild(imgEl);
  ansNode.appendChild(bubble);

  var accText=''; window._liveAccText=null;
  var t0=Date.now();

  // 涉 AI 必过 RAG：校验也要吃进该城市智库语料（否则无从比对）
  var _vChunks=[]; try{ _vChunks=kbSearch(prompt, buildKBCorpus(p.city), 6)||[]; }catch(e){ _vChunks=[]; }
  fetch(KB_API,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question:prompt, chunks:_vChunks, city:p.city, stream:true, mode:'verify', prefs:curOnbPrefs()})
  }).then(function(resp){
    thinking.remove();
    bodyDiv.innerHTML='<span style="color:#9aa5b5;font-size:12px"><span class="gov-spin" style="margin-right:6px"></span>AI 正在逐条核验数据点…</span>';
    c.appendChild(ansNode); c.scrollTop=c.scrollHeight;
    if(!resp.ok){ bodyDiv.innerHTML='<span style="color:#ef4444">服务错误：'+resp.status+'</span>'; return; }
    var reader=resp.body.getReader(), dec=new TextDecoder(), buf='', _firstChunk=true;
    function pump(){
      reader.read().then(function(d){
        if(d.done){
          var elapsed=Date.now()-t0;
          // 判定优先级：先看 AI 首行的结构化结论标记，最可靠；关键词兜底只作为补充。
          // 关键修复：旧逻辑把"文件说A，智库记录B，不一致"这类真实矛盾误判为 allClear（因命中"未发现"字样），
          // 导致假数据漏报。现改为：只要出现矛盾结论/不一致标志，一律判为高危，绝不 allClear。
          // 确保正文内容一定渲染到bodyDiv（不管后续判定结果如何）
          // ── 一次解析、单一裁决：正文/抬头/确认面板共用这一份结果（T2 修复）──
          var _parsed=parseVerifyDetail(accText);
          var _cntConflict=_parsed.conflict, _cntNewAdd=_parsed.newadd, _cntConsistent=_parsed.consistent;
          // 正文按裁决结果重写：行首图标归正 + 首行结论从明细实时汇总
          var _shownText=_parsed.rows.length?rewriteVerifyText(accText,_parsed):accText;
          if(_shownText.trim()){
            try{ bodyDiv.innerHTML='<p style="margin:0;line-height:1.75">'+renderMarkdown(_shownText)+'</p>'; }
            catch(e_r){ bodyDiv.innerHTML='<p style="margin:0;line-height:1.75;white-space:pre-wrap">'+_shownText.replace(/</g,'&lt;')+'</p>'; }
          }
          // 确认面板复用同一份 rows，不再自己重新扫 ❌（否则抬头报矛盾、面板捞不到）
          window._lastVerifyRows=_parsed.rows;

          // badge 与正文同源：矛盾数 > 0 才算高危
          var hasHighRisk=(_cntConflict>0);
          var allClear=!hasHighRisk && _cntNewAdd===0;
          var badgeText=hasHighRisk
            ?'⚠ 发现 '+_cntConflict+' 处矛盾，建议人工核实'
            :(_cntNewAdd>0
                ?'✓ 未发现矛盾，'+_cntNewAdd+' 条待确认'
                :'✓ 未发现明显错误');
          bubble.insertAdjacentHTML('beforeend',
            '<div style="margin-top:12px;padding:8px 12px;background:'+
            (hasHighRisk?'#fff1f2':(allClear?'#f0fdf4':'#fffbeb'))+
            ';border-radius:8px;border:1px solid '+
            (hasHighRisk?'#fecaca':(allClear?'#bbf7d0':'#fde68a'))+
            ';font-size:12px;font-weight:650;color:'+
            (hasHighRisk?'#dc2626':(allClear?'#059669':'#d97706'))+
            '">'+badgeText+
            '<span style="font-weight:400;color:#94a3b8;margin-left:8px">· 校验耗时 '+elapsed+'ms · 核验 '+_parsed.rows.length+' 个数据点 · 对比 '+topicKnown.length+'/'+_allKnown.length+' 条现有结论'+(_numHitCount?('（含 '+_numHitCount+' 条数值直接命中）'):'')+'</span>'+
            (hasHighRisk?'<button onclick="kbConfirmOverwrite()" style="margin-left:12px;padding:4px 12px;background:#dc2626;color:#fff;border:none;border-radius:6px;font-size:11.5px;font-weight:600;cursor:pointer">人工核实</button>':(allClear?'':'<button onclick="kbConfirmOverwrite()" style="margin-left:12px;padding:4px 12px;background:#d97706;color:#fff;border:none;border-radius:6px;font-size:11.5px;font-weight:600;cursor:pointer">逐条确认</button>'))+
            '</div>');
                    // 发现矛盾或模糊信息：弹出逐条确认面板让用户核实
          if(hasHighRisk || !allClear){
            // 存重写后的文本：面板兜底解析时才与正文、抬头同一份内容（行号也对得上）
            window._lastVerifyText=_shownText;
            window._lastVerifyKbIdx=(kbIdx!=null?kbIdx:0);
            setTimeout(function(){ kbConfirmOverwrite(); }, 300);
          }
          // 兜底：bodyDiv 为空但有内容时直接渲染纯文本（同样用重写后的文本）
          if(_shownText && !bodyDiv.innerHTML.trim()){
            bodyDiv.innerHTML='<p style="margin:0;line-height:1.75;white-space:pre-wrap">'+_shownText.replace(/</g,'&lt;')+'</p>';
          }
          // 校验完成：把按钮改为「已校验」
          window._verifyInProgress=false;
          if(verifyBtn){verifyBtn.disabled=false;verifyBtn.textContent='🔍 校验材料可信度';verifyBtn.style.background='#fff7ed';verifyBtn.style.color='#c2410c';verifyBtn.style.border='1.5px solid #fed7aa';}

          kbChatPush('ai', ansNode.outerHTML);
          return;
        }
        buf+=dec.decode(d.value,{stream:true});
        var ls=buf.split('\n'); buf=ls.pop();
        ls.forEach(function(line){
          if(!line.startsWith('data:'))return;
          var data=line.slice(5).trim(); if(data==='[DONE]')return;
          try{var j=JSON.parse(data);var dl=(j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content)||'';
            if(dl){accText+=dl;
              try{bodyDiv.innerHTML='<p style="margin:0;line-height:1.75">'+renderMarkdown(accText)+'</p>';}
              catch(e2){bodyDiv.innerHTML='<p style="margin:0;line-height:1.75;white-space:pre-wrap">'+accText.replace(/</g,'&lt;')+'</p>';}
              c.scrollTop=c.scrollHeight;}}catch(e){}
          /* reasoning_content 阶段也显示进度 */
          try{var j2=JSON.parse(data);var rc=(j2.choices&&j2.choices[0]&&j2.choices[0].delta&&j2.choices[0].delta.reasoning_content)||'';
            if(rc && !accText){ bodyDiv.innerHTML='<span style="color:#9aa5b5;font-size:12px"><span class="gov-spin" style="margin-right:6px"></span>AI 深度推理中（已思考 '+Math.round((Date.now()-t0)/1000)+'s）…</span>'; c.scrollTop=c.scrollHeight; }}catch(e3){}
        });
        pump();
      });
    }
    pump();
  }).catch(function(err){
    thinking.remove(); c.appendChild(ansNode);
    bodyDiv.innerHTML='<span style="color:#ef4444">连接失败：'+err.message+'</span>';
  });
}

/* ── 校验发现矛盾后：解析冲突项并弹出「是否覆盖原有数据」确认面板 ── */
function kbConfirmOverwrite(){
  var txt=window._lastVerifyText||'';
  var kbIdx=(window._lastVerifyKbIdx!=null?window._lastVerifyKbIdx:0);
  var p=P(); if(!p||!p.kb||!p.kb[kbIdx]){ toast('未找到对应智库主题'); return; }
  var k=p.kb[kbIdx];

  /* 【2026-09-23 修复 T2】复用 kbVerifyMaterial 的统一裁决结果。
     旧实现在这里重新扫一遍「'❌' 开头的行」，与抬头计数是两套口径：
     模型把图标写成 ✅ 但正文写「→ 不一致」时，抬头已计为矛盾，这里却一条都捞不到，
     干部点「人工核实」只弹一句"未能自动定位到冲突条目"。
     现在直接吃 window._lastVerifyRows 里 bucket==='conflict' 的行。 */
  var conflicts=[];
  var _rows=window._lastVerifyRows;
  if(!_rows || !_rows.length){
    // 兜底：没有解析结果时（如旧会话回放）就地解析一次，口径仍与校验一致
    try{ _rows=(parseVerifyDetail(txt)||{}).rows||[]; }catch(_e){ _rows=[]; }
  }
  _rows.filter(function(r){ return r && r.bucket==='conflict'; }).forEach(function(r){
    var line=r.raw;
    var fileVal=r.fileVal, kbVal=r.kbVal;
    if(!fileVal||!kbVal){
      // 该行没写成「文件写X，智库记录Y」的标准句式：仍要让干部看到，值留空由人工填
      var _vm=/[：:]\s*文件[写说记载]*\s*([^，,→]+)/.exec(line);
      fileVal=fileVal||(_vm?_vm[1].replace(/\*\*/g,'').trim():'');
      kbVal=kbVal||'（智库值未解析出，请人工核对）';
    }
    if(!fileVal) return;
    var indicatorName=r.name||'数据项';
    // 在智库known里用指标关键词模糊匹配
    var idx=-1;
    var keywords=indicatorName.replace(/[\s\d%+\-().（）]+/g,'');
    (k.known||[]).forEach(function(existing,ei){
      var ec=typeof existing==='string'?existing:(existing.text||'');
      if(idx<0 && keywords.length>=2 && ec.indexOf(keywords)>=0) idx=ei;
    });
    // 如果关键词匹配失败，尝试用kbVal中的数字匹配
    if(idx<0){
      var numM=kbVal.match(/[\d.]+/);
      if(numM){
        (k.known||[]).forEach(function(existing,ei){
          var ec=typeof existing==='string'?existing:(existing.text||'');
          if(idx<0 && ec.indexOf(numM[0])>=0) idx=ei;
        });
      }
    }
    var oldClean, newClean;
    if(idx>=0){
      var _fullText=(typeof k.known[idx]==='string'?k.known[idx]:(k.known[idx].text||'')).replace(/^[\u2705\u26a0\ufe0f\s]+/,'');
      // 只截取包含冲突数值的那一句（按句号/分号切分，找到含kbVal数字的句子）
      var _numInKb=(kbVal.match(/[\d.]+/)||[''])[0];
      var _sentences=_fullText.split(/[。；;]/);
      var _relevantSentence=_sentences.find(function(s){ return _numInKb && s.indexOf(_numInKb)>=0; })||'';
      oldClean=_relevantSentence.trim() || _fullText.substring(0,80);
      newClean=indicatorName+'：'+fileVal+'（原记录：'+kbVal+'）';
    } else {
      oldClean=indicatorName+'：智库记录 '+kbVal;
      newClean=indicatorName+'：新材料写 '+fileVal;
    }
    conflicts.push({idx:idx, old:oldClean, new:newClean});
  });

  if(!conflicts.length){
    // 抬头有矛盾数却捞不到条目时，把真实原因说清楚，而不是一句笼统提示
    var _cn=(_rows||[]).filter(function(r){return r&&r.bucket==='conflict';}).length;
    toast(_cn?('校验判定 '+_cn+' 处矛盾，但未能解析出对应数值，请在主题卡内手动核实')
             :'本次校验未发现矛盾条目，无需覆盖');
    return;
  }
  window._pendingConflicts={kbIdx:kbIdx, conflicts:conflicts};
  showConflictPanel(kbIdx, conflicts);
}

/* ── 增量分析：只对本次上传的新材料生成补充结论，原有结论完全不变 ── */
function kbIncrementalAnalysis(){
  var newChunks=window._lastIngestChunks||(KB_FILE_CHUNKS[cur]||[]); // fallback到已上传的文件chunks
  var topicLabel=window._lastIngestTopicLabel||'城市智库';
  var kbIdx=window._lastIngestKbIdx;
  var p=P(); if(!p) return; if(!newChunks.length){ toast('请先上传材料后再分析'); return; }

  var incrBtn=document.querySelector('#kbIngestActions button:first-child'); if(incrBtn){incrBtn.disabled=true;incrBtn.textContent='📄 分析中…';}


  var c=document.getElementById('kbConv'); if(!c) return;

  var q='仅基于刚上传的新材料，找出「'+topicLabel+'」方向的新发现（不重复、不改动已有结论）';
  var qd=document.createElement('div'); qd.className='message is-user';
  qd.innerHTML='<div class="message-bubble"><p>'+q+'</p></div>';
  c.appendChild(qd); c.scrollTop=c.scrollHeight;
  var _ks=document.querySelector('.knowledge-scroll'); if(_ks) _ks.scrollTop=_ks.scrollHeight;
  kbChatPush('user', qd.outerHTML);

  // 构建现有结论摘要，告知 AI 避免重复
  // question 只放简短指令，现有结论摘要用于提示 AI，新材料走 chunks
  var existingTitles=[];
  if(kbIdx!=null && p.kb && p.kb[kbIdx]){
    (p.kb[kbIdx].known||[]).forEach(function(x){
      var _xt2=_kbText(x); if(_xt2.indexOf('📎')!==0) existingTitles.push(x.replace(/^[\u2705\u26a0\ufe0f\s]+/,'').substring(0,40));
    });
  }
  var existingHint=existingTitles.length ? '（已有结论摘要：'+existingTitles.slice(0,6).join('；')+'）' : '';

  var prompt='请基于提供的新材料，对比'+p.city+'「'+topicLabel+'」智库中已有结论'+existingHint+'，找出真正的新增信息或补充要点。'
    +'要求：①如果新材料与现有数据一致，直接说"与现有数据一致，无需更新"；②只输出真正新增的、现有智库中没有的信息；③不要使用"不一致"标签来描述实际一致的数据；④每条新发现独立成行，关键数据加粗；⑤若存在真正矛盾（数据不同），明确标注【矛盾】并列出新旧数据对比；⑥不编造材料中未提及的数据。';

  var thinking=document.createElement('div');
  thinking.className='message';
  thinking.innerHTML='<img src="'+aiAvatar()+'"><div class="message-bubble"><span style="color:#9aa5b5;font-size:12px">正在分析新材料…</span></div>';
  c.appendChild(thinking); c.scrollTop=c.scrollHeight;

  var ansNode=document.createElement('div');
  ansNode.className='message';
  var bubble=document.createElement('div');
  bubble.className='message-bubble';
  var bodyDiv=document.createElement('div');
  bubble.appendChild(bodyDiv);
  var imgEl=document.createElement('img');
  imgEl.src=aiAvatar();
  ansNode.appendChild(imgEl);
  ansNode.appendChild(bubble);

  var accText='';
  var t0=Date.now();

  fetch(KB_API,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question:prompt, chunks:newChunks.slice(0,6), city:p.city, stream:true, mode:'chat', prefs:curOnbPrefs()})
  }).then(function(resp){
    thinking.remove();
    c.appendChild(ansNode); c.scrollTop=c.scrollHeight;
    if(!resp.ok){ bodyDiv.innerHTML='<span style="color:#ef4444">服务错误：'+resp.status+'</span>'; return; }
    var reader=resp.body.getReader(), dec=new TextDecoder(), buf='';
    function pump(){
      reader.read().then(function(d){
        if(d.done){
          var elapsed=Date.now()-t0;
          // AI 判定与现有数据一致/无新增：不展示“新要点”面板，避免把结论句本身误当新要点
          var _noNew=/与现有数据一致|无需更新|未发现新增|没有新增|无新增|未发现新的|无新的信息|均已(收录|覆盖|包含)/.test(accText);
          // 提取纯文本行作为候选新要点，并过滤掉状态/结论类句子
          var newFacts=_noNew?[]:accText.split('\n').map(function(l){return l.trim();}).filter(function(l){
            if(l.length<=8 || /^[\*\-\s]*$/.test(l)) return false;
            // 过滤 AI 的状态描述句（非真正的新增信息）
            if(/与现有数据一致|无需更新|未发现新增|没有新增|无新增|未发现新的|无新的信息|以下是|新发现如下|新增(信息|要点)如下|经对比|综上/.test(l)) return false;
            return true;
          });
          if(newFacts.length>0){
            window._lastNewFacts=newFacts;
            bubble.insertAdjacentHTML('beforeend', newFactsPanelHtml(kbIdx, newFacts, topicLabel));
            // 结构化存储，回放时可重建按钮（否则 kbChatReplay 会把按钮正则删掉）
            var _sn=kbActiveSession(cur); if(_sn){
            _sn.messages.push({role:'new-facts', kbIdx:(kbIdx===undefined?null:kbIdx), facts:newFacts, label:topicLabel, ts:Date.now()});
            if(_sn.messages.length>100) _sn.messages=_sn.messages.slice(-100);
            persist(); }
          } else {
            // 无新增：明确提示，不展示追加面板
            bubble.insertAdjacentHTML('beforeend',
              '<div style="margin-top:12px;padding:10px 14px;background:#f0fdf4;border-radius:10px;border:1px solid #bbf7d0;font-size:12.5px;color:#059669;font-weight:600">✓ 该材料未发现需要补充的新信息，智库结论无需更新</div>');
          }
          bubble.insertAdjacentHTML('beforeend','<div style="font-size:10.5px;color:#b0bac8;margin-top:6px">仅基于新材料 · '+elapsed+'ms · '+newChunks.length+' 个片段</div>');
          var _ib=document.querySelector('#kbIngestActions button:first-child');
          if(_ib){_ib.disabled=false;_ib.textContent='✅ 已分析';_ib.style.background='#f0fdf4';_ib.style.color='#059669';_ib.style.border='1.5px solid #86efac';_ib.onclick=null;}
          kbChatPush('ai', ansNode.outerHTML);
          return;
        }
        buf+=dec.decode(d.value,{stream:true});
        var ls=buf.split('\n'); buf=ls.pop();
        ls.forEach(function(line){
          if(!line.startsWith('data:'))return;
          var data=line.slice(5).trim(); if(data==='[DONE]')return;
          try{var j=JSON.parse(data);var dl=(j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content)||'';
            if(dl){accText+=dl;bodyDiv.innerHTML='<p style="margin:0;line-height:1.75">'+renderMarkdown(accText)+'</p>';c.scrollTop=c.scrollHeight;}}catch(e){}
        });
        pump();
      });
    }
    pump();
  }).catch(function(err){
    thinking.remove(); c.appendChild(ansNode);
    bodyDiv.innerHTML='<span style="color:#ef4444">连接失败：'+err.message+'</span>';
  });
}

/* 新要点追加面板 HTML（供首次渲染与 kbChatReplay 回放复用，保持按钮一致且可点击） */
function newFactsPanelHtml(kbIdx, newFacts, topicLabel){
  var factsListHtml=newFacts.map(function(f,fi){
    f=f.replace(/\*\*/g,'');
    return '<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid #e0eaff">'+
      '<span style="flex-shrink:0;width:20px;height:20px;background:#dbeafe;color:#1d4ed8;border-radius:50%;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:2px">'+(fi+1)+'</span>'+
      '<span style="flex:1;font-size:12.5px;color:#1e293b;line-height:1.6">'+f.replace(/</g,'&lt;')+'</span>'+
      '<button onclick="kbAppendSingleFact('+kbIdx+','+fi+',this)" data-kbidx="'+kbIdx+'" '+
        'data-factidx="'+fi+'" data-fact="'+encodeURIComponent(f)+'" '+
        'style="flex-shrink:0;padding:3px 10px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:6px;font-size:11.5px;cursor:pointer;white-space:nowrap;margin-top:1px">'+'\u271a 加入</button>'+
    '</div>';
  }).join('');
  return '<div style="margin-top:12px;padding:12px 14px;background:#f0f7ff;border-radius:10px;border:1px solid #bfdbfe">'+
    '<div style="font-size:12px;color:#1d4ed8;font-weight:700;margin-bottom:8px">📥 发现 '+newFacts.length+' 条新要点，可选择追加到智库待确认：</div>'+
    '<div style="margin-bottom:10px" id="factsListDiv">'+factsListHtml+'</div>'+
    '<div style="display:flex;align-items:center;gap:10px;margin-top:6px">'+
    '<button onclick="window._lastNewFacts='+JSON.stringify(newFacts).replace(/"/g,'&quot;')+';kbAppendNewFacts('+kbIdx+',window._lastNewFacts,this)" data-kbidx="'+kbIdx+'" '+
      'style="padding:7px 16px;background:#1d4ed8;color:#fff;border:none;border-radius:8px;font-size:12.5px;cursor:pointer;font-weight:600">'+'\u271a 全部追加到「'+topicLabel+'」</button>'+
    '<span style="font-size:11px;color:#64748b">标记为⚠️待确认，原有内容不变</span>'+
    '</div>'+
    '</div>';
}

/* 单独追加一条新要点到智库 */
function kbAppendSingleFact(kbIdx, factIdx, btnEl){
  // 从按钮属性读 kbIdx，null/NaN 时兜底为 0
  var _kid = kbIdx;
  if((_kid==null||_kid!==_kid) && btnEl){
    var attr = btnEl.getAttribute('data-kbidx');
    _kid = (attr!=null && attr!=='null') ? parseInt(attr) : 0;
  }
  if(_kid==null||_kid!==_kid||_kid<0) _kid=0;
  // 从 data-fact 读文本
  var f='';
  if(btnEl && btnEl.getAttribute('data-fact')) f=decodeURIComponent(btnEl.getAttribute('data-fact'));
  if(!f && window._lastNewFacts) f=(window._lastNewFacts[factIdx]||'');
  if(!f){ toast('要点文本丢失，请重新分析'); return; }
  var p=P(); if(!p||!p.kb||!p.kb[_kid]) _kid=0;
  if(!p||!p.kb||!p.kb[_kid]) return;
  var k=p.kb[_kid];
  var clean=f.replace(/^[\u2022\-\*\d\.\)\s]+/,'').replace(/\*\*/g,'').trim();
  var entry='\u26a0\ufe0f '+clean;
  if(k.known.indexOf(entry)<0){ k.known.push(entry); persist(); refreshKbProgress(); }
  var btn=btnEl||document.querySelector('[data-factidx="'+factIdx+'"]');
  var btn=btnEl||document.querySelector('[data-factidx="'+factIdx+'"]');
  if(btn){
    btn.disabled=false;
    btn.textContent='\u21a9 \u64a4\u56de';
    btn.style.background='#fef2f2';
    btn.style.color='#dc2626';
    btn.style.border='1px solid #fecaca';
    btn.setAttribute('data-entry', encodeURIComponent(entry));
    btn.setAttribute('data-undo-kid', _kid);
    btn.onclick=function(){ kbUndoSingleFact(this); };
  }
  var rows=document.querySelectorAll('.topic-row');
  if(rows[_kid]){rows[_kid].scrollIntoView({behavior:'smooth',block:'center'});setTimeout(function(){rows[_kid].style.outline='2px solid #6366f1';setTimeout(function(){rows[_kid].style.outline='';},1500);},300);}
  toast('\u2705 \u5df2\u52a0\u5165\u300c'+k.t+'\u300d\uff08\u26a0\ufe0f\u5f85\u9886\u5bfc\u786e\u8ba4\uff09');
}

/* 把新发现追加到智库 known[]，标记 ⚠️ 待确认，原有条目完全不动 */
/* 撤回单条已加入的要点 */
function kbUndoSingleFact(btnEl){
  var entry = btnEl ? decodeURIComponent(btnEl.getAttribute('data-entry')||'') : '';
  var _kid  = btnEl ? parseInt(btnEl.getAttribute('data-undo-kid')||'0') : 0;
  if(!entry) return;
  var p=P(); if(!p||!p.kb||!p.kb[_kid]) return;
  var k=p.kb[_kid];
  var idx=k.known.indexOf(entry);
  if(idx>=0){ k.known.splice(idx,1); persist(); refreshKbProgress(); }
  // 恢复按钮为「+ 加入」
  if(btnEl){
    btnEl.textContent='\u271a \u52a0\u5165';
    btnEl.style.background='#eff6ff';
    btnEl.style.color='#1d4ed8';
    btnEl.style.border='1px solid #bfdbfe';
    // 恢复原来的 onclick
    var factIdx = btnEl.getAttribute('data-factidx');
    var kbidx   = btnEl.getAttribute('data-kbidx');
    btnEl.onclick = null;
    btnEl.setAttribute('onclick','kbAppendSingleFact('+kbidx+','+factIdx+',this)');
  }
  toast('\u21a9 \u5df2\u64a4\u56de\uff0c\u8981\u70b9\u5df2\u4ece\u300c'+k.t+'\u300d\u79fb\u9664');
}

function kbAppendNewFacts(kbIdx, facts, btnEl){
  var _kid = kbIdx;
  if((_kid==null||_kid!==_kid) && btnEl){
    var attr = btnEl.getAttribute('data-kbidx');
    _kid = (attr!=null && attr!=='null') ? parseInt(attr) : 0;
  }
  if(_kid==null||_kid!==_kid||_kid<0) _kid=0;
  var p=P(); if(!p||!p.kb||!p.kb[_kid]) _kid=0;
  if(!p||!p.kb||!p.kb[_kid]) return;
  var k=p.kb[_kid];

  // 检测新旧数据冲突：如果新条目与现有条目涉及同一主题但数据不同，标记为冲突
  var conflicts=[], noConflicts=[];
  (facts||[]).forEach(function(f){
    var clean=f.replace(/^[\u2022\-\*\d\.\)\s]+/,'').replace(/\*\*/g,'').trim();
    if(!clean) return;
    // 提取关键词（前10个字）与现有known比较
    var keywords=clean.substring(0,15);
    var conflictWith=null;
    (k.known||[]).forEach(function(existing,ei){
      var existClean=existing.replace(/^[\u2705\u26a0\ufe0f\s]+/,'');
      // 如果新旧条目前15字有重叠关键词，视为潜在冲突
      if(existClean.substring(0,15)===keywords || 
         (keywords.length>8 && existClean.indexOf(keywords.substring(0,8))>=0)){
        conflictWith={idx:ei, old:existClean, new:clean};
      }
    });
    if(conflictWith) conflicts.push(conflictWith);
    else noConflicts.push(clean);
  });

  // 无冲突的直接追加（标记⚠️待确认）
  var added=0;
  noConflicts.forEach(function(clean){
    var entry='\u26a0\ufe0f '+clean;
    if(k.known.indexOf(entry)<0){ k.known.push(entry); added++; }
  });

  // 有冲突的弹出确认面板
  if(conflicts.length>0){
    window._pendingConflicts={kbIdx:_kid, conflicts:conflicts};
    showConflictPanel(_kid, conflicts);
  }

  persist(); refreshKbProgress();
  if(added>0 && conflicts.length===0){
    var boxes=document.querySelectorAll('[onclick^="kbAppendNewFacts"]');
    boxes.forEach(function(b){var box=b.closest('div[style*="background:#f0f7ff"]');if(box)box.innerHTML='<span style="font-size:12px;color:#059669">\u2705 已追加 '+added+' 条到「'+k.t+'」，可在主题卡确认</span>';});
    toast('\u2705 已追加 '+added+' 条到「'+k.t+'」\uff08\u26a0\ufe0f待确认\uff09');
  } else if(conflicts.length>0){
    toast('发现 '+conflicts.length+' 条数据冲突，请确认采用哪一项');
  }
  var rows=document.querySelectorAll('.topic-row');
  if(rows[_kid]){rows[_kid].scrollIntoView({behavior:'smooth',block:'center'});}
}

/* 冲突确认面板：并列展示新旧数据 */
function showConflictPanel(kbIdx, conflicts){
  closeModal();
  var html='<div style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center" onclick="if(event.target===this)closeModal()">'+
    '<div style="background:#fff;border-radius:16px;width:640px;max-height:80vh;overflow-y:auto;padding:24px;box-shadow:0 12px 40px rgba(0,0,0,.15)">'+
      '<div style="font-size:16px;font-weight:750;color:#0b183b;margin-bottom:4px">数据冲突确认</div>'+
      '<div style="font-size:12.5px;color:#8492a6;margin-bottom:16px">新上传材料中发现与现有数据不一致的内容，请逐条确认采用哪一项：</div>'+
      conflicts.map(function(c,ci){
        // 高亮差异：在完整文本中把不同的数值加粗标红/标绿
        function highlightDiff(text, otherText){
          // 提取两边所有数字+单位
          var nums=text.match(/[\d,.]+[亿万%元辆吨GWh千米平方公里个家条]+|\+[\d.]+%/g)||[];
          var otherNums=otherText.match(/[\d,.]+[亿万%元辆吨GWh千米平方公里个家条]+|\+[\d.]+%/g)||[];
          var result=text;
          nums.forEach(function(n){
            if(otherNums.indexOf(n)<0){
              result=result.replace(n,'<b style="background:#fef08a;padding:1px 3px;border-radius:3px">'+n+'</b>');
            }
          });
          return result;
        }
        var oldHighlighted=highlightDiff(c.old, c.new);
        var newHighlighted=highlightDiff(c.new, c.old);
        return '<div style="border:1.5px solid #e8edf5;border-radius:12px;padding:16px;margin-bottom:12px" id="conflict-card-'+ci+'">'+
          '<div style="display:flex;align-items:center;margin-bottom:10px">'+
            '<div style="font-size:12px;font-weight:650;color:#475569">冲突 '+(ci+1)+'</div>'+
            '<div id="conflict-status-'+ci+'" style="margin-left:auto;font-size:11px;font-weight:600;color:#cbd5e1">未确认</div>'+
          '</div>'+
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
            '<div style="padding:12px;background:#fff5f5;border:1.5px solid #fecaca;border-radius:8px" id="conflict-old-'+ci+'">'+
              '<div style="font-size:11px;font-weight:600;color:#ef4444;margin-bottom:6px">智库现有数据</div>'+
              '<div style="font-size:13px;color:#1e293b;line-height:1.7;margin-bottom:10px">'+oldHighlighted+'</div>'+
              '<button onclick="resolveConflict('+kbIdx+','+ci+',\'old\')" style="width:100%;padding:8px;background:#fff;border:1.5px solid #fca5a5;border-radius:7px;font-size:12px;font-weight:600;color:#ef4444;cursor:pointer">保留旧数据</button>'+
            '</div>'+
            '<div style="padding:12px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px" id="conflict-new-'+ci+'">'+
              '<div style="font-size:11px;font-weight:600;color:#166534;margin-bottom:6px">新材料数据</div>'+
              '<div style="font-size:13px;color:#1e293b;line-height:1.7;margin-bottom:10px">'+newHighlighted+'</div>'+
              '<button onclick="resolveConflict('+kbIdx+','+ci+',\'new\')" style="width:100%;padding:8px;background:#16a34a;border:none;border-radius:7px;font-size:12px;font-weight:600;color:#fff;cursor:pointer">采用新数据</button>'+
            '</div>'+
          '</div>'+
        '</div>';
      }).join('')+
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">'+
        '<button onclick="resolveAllConflicts(\'old\')" style="padding:8px 16px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:8px;font-size:12.5px;color:#4a5568;cursor:pointer">全部保留旧数据</button>'+
        '<button onclick="resolveAllConflicts(\'new\')" style="padding:8px 16px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:8px;font-size:12.5px;cursor:pointer;font-weight:600">全部采用新数据</button>'+
      '</div>'+
    '</div></div>';
  var d=document.createElement('div');d.id='conflictModal';d.innerHTML=html;
  document.body.appendChild(d);
}

/* 单条冲突确认 */
function resolveConflict(kbIdx, conflictIdx, choice){
  var pc=window._pendingConflicts; if(!pc) return;
  var c=pc.conflicts[conflictIdx]; if(!c) return;
  var p=P(); if(!p||!p.kb||!p.kb[kbIdx]) return;
  var k=p.kb[kbIdx];

  if(choice==='new'){
    if(c.idx>=0){
      // 替换已定位的旧数据
      k.known[c.idx]='\u2705 '+c.new;
    } else {
      // 未精确定位时，追加为新条目
      k.known.push('\u2705 '+c.new);
    }
  }
  // choice==='old' 保持不变

  // 标记已处理
  c.resolved=choice;
  var oldEl=document.getElementById('conflict-old-'+conflictIdx);
  var newEl=document.getElementById('conflict-new-'+conflictIdx);
  var statusEl=document.getElementById('conflict-status-'+conflictIdx);
  if(choice==='new'){
    if(newEl) newEl.style.border='3px solid #22c55e';
    if(oldEl) oldEl.style.opacity='0.4';
    if(statusEl){ statusEl.textContent='✓ 已采用新材料数据'; statusEl.style.color='#16a34a'; }
  } else {
    if(oldEl) oldEl.style.border='3px solid #3b82f6';
    if(newEl) newEl.style.opacity='0.4';
    if(statusEl){ statusEl.textContent='✓ 已保留现有数据'; statusEl.style.color='#3b82f6'; }
  }

  // 检查是否全部已处理
  var allDone=pc.conflicts.every(function(x){return x.resolved;});
  if(allDone){
    persist(); refreshKbProgress();
    setTimeout(function(){ closeModal(); toast('\u2705 数据冲突已全部确认'); render(); },600);
  } else {
    persist();
  }
}

/* 批量确认所有冲突 */
function resolveAllConflicts(choice){
  var pc=window._pendingConflicts; if(!pc) return;
  var p=P(); if(!p||!p.kb||!p.kb[pc.kbIdx]) return;
  var k=p.kb[pc.kbIdx];
  pc.conflicts.forEach(function(c){
    if(choice==='new') k.known[c.idx]='\u2705 '+c.new;
    c.resolved=choice;
  });
  persist(); refreshKbProgress();
  closeModal(); toast('\u2705 数据冲突已全部确认（'+(choice==='new'?'采用新数据':'保留旧数据')+')');
  render();
}


/* 结合全库重新分析（原有行为） */
function kbRAGQueryFull(){
  var topicLabel=window._lastIngestTopicLabel||'城市智库';
  var kbIdx=window._lastIngestKbIdx;
  var p=P(); if(!p) return;
  var fullBtn=document.querySelector('#kbIngestActions button:nth-child(3)'); if(fullBtn){fullBtn.disabled=true;fullBtn.textContent='🔄 分析中…';}
  var c=document.getElementById('kbConv'); if(!c) return;

  // 全量获取该主题下所有已上传文件的 chunks，不走 RAG 筛选，避免第二份文件被摆掉
  var allUploadChunks=(KB_FILE_CHUNKS[cur]||[]).filter(function(ck){
    if(kbIdx==null) return true; // 未指定主题时取全部
    var k=p.kb&&p.kb[kbIdx];
    return !k || ck.topic===k.t || (ck.tags&&ck.tags.indexOf(k.t)>=0);
  });
  // 和主题 known 结论一起作为上下文
  var kHint=kbIdx!=null&&p.kb ? p.kb[kbIdx] : null;
  var knownChunks=kHint ? (kHint.known||[]).slice(0,4).map(function(t,i){
    return {id:'known:'+i,topic:kHint.t,tags:[],text:_kbText(t).replace(/^[\u2705\u26a0\ufe0f\s]+/,''),cite:kHint.t+'（已有结论）'};
  }) : [];
  var chunks=knownChunks.concat(allUploadChunks).slice(0,12);

  var autoQ='根据已上传的全部材料，'+p.city+'在「'+topicLabel+'」方向有哪些关键发现？请综合分析。';
  var qd=document.createElement('div'); qd.className='message is-user';
  qd.innerHTML='<div class="message-bubble"><p>'+autoQ+'</p></div>';
  c.appendChild(qd); c.scrollTop=c.scrollHeight;
  var _ks=document.querySelector('.knowledge-scroll'); if(_ks) _ks.scrollTop=_ks.scrollHeight;
  kbChatPush('user', qd.outerHTML);
  kbAnswerRender(c, autoQ, chunks, p.city);
}
function kbFileParsed(fname){
  var c=$('#kbConv');if(!c)return;
  var _uHtml='<div class="message is-user" style="margin-top:14px"><div class="message-bubble"><p>[已上传本地材料] '+fname+'</p></div></div>';
  c.insertAdjacentHTML('beforeend',_uHtml);
  kbChatPush('user', _uHtml);
  setTimeout(function(){
    var _aHtml='<div class="message" style="margin-top:14px"><img src="'+aiAvatar()+'"><div class="message-bubble"><p>已解析 <b>'+fname+'</b> 并并入本地材料库。识别到与当前主题相关的要点，已更新到右侧「本次回答可调用」清单，可据此继续提问。</p><div class="answer-sources"><span>调用：'+fname+'</span></div></div></div>';
    c.insertAdjacentHTML('beforeend',_aHtml);
    kbChatPush('ai', _aHtml);
    c.scrollTop=c.scrollHeight;
  },400);
  toast('已解析并加入本地材料库');
}
function sendMsg(){var ta=$('#composerTa');if(!ta)return;var v=ta.value.trim();if(!v)return;
  // 城市智库页：留在本页作答（回复进 kbConv）
  if(view==='knowledge'){doSend(v);ta.value='';ta.style.height='auto';return;}
  // 项目工作区：留在本页，基于项目上下文作答（回复进 #conv）
  if(view==='subwork'){doSend(v);ta.value='';ta.style.height='auto';return;}
  // 其他非首页：切回当前研判再作答
  if(view!=='home'){view='home';render();setTimeout(function(){var t=$('#composerTa');if(t)t.value=v;doSend(v)},60);return;}
  doSend(v);ta.value='';}
function doSend(v){
  // 城市智库页：走 RAG 检索引擎
  if(view==='knowledge'){
    var _kbC=document.getElementById('kbConv');
    if(!_kbC)return;
    var _ud=document.createElement('div');
    _ud.className='message is-user';
    _ud.innerHTML='<div class="message-bubble"><p>'+v+'</p></div>';
    _kbC.appendChild(_ud);_kbC.scrollTop=_kbC.scrollHeight;
    kbChatPush('user', _ud.outerHTML);
    kbRAGQuery(v,_kbC);return;
  }
  // 项目工作区：结合项目上下文自由问答，命中快捷意图则走 subReply
  if(view==='subwork'){
    addU(v);var pl2=$('.prompt-list');if(pl2)pl2.remove();
    var subs=subprojOf(cur);var s=subs[curSub];
    if(/方案|对接|起草|洽谈/.test(v)){setTimeout(function(){subReply('draft',s,P())},450);return;}
    if(/核验|核实|问题|尽调/.test(v)){setTimeout(function(){subReply('verify',s,P())},450);return;}
    if(/汇报|上报|领导|进展|总结/.test(v)){setTimeout(function(){subReply('report',s,P())},450);return;}
    if(/补充|拓展|还有|环节|上下游/.test(v)){setTimeout(function(){subReply('expand',s,P())},450);return;}
    setTimeout(function(){addA('<p>我已结合「'+(s?s.dir.split(' · ')[0]:'该项目')+'」的报告结论与候选线索理解你的需求。可让我起草对接方案、列核验清单、写领导汇报或补充招引环节——生成的是草稿，需你确认，系统不会自动联系企业。</p>')},450);
    return;
  }
  addU(v);var pl=$('.prompt-list');if(pl)pl.remove();
  var _p=P();var _kb=_p.kb||[];
  var _kbPark=_kb[1]||{};var _kbFirm=_kb[2]||{};var _kbPol=_kb[3]||{};var _kbInd=_kb[0]||{};
  var _clues=_p.clues||[];
  var reply;
  if(/园区|开发区|承接|厂房|能耗|载体/.test(v)){
    var _parkKnown=(_kbPark.known||[]).slice(0,2).join('；');
    reply='关于园区承载（'+_p.city+'）：'+(_parkKnown||'已整理主要载体，可按细分领域匹配承接区域')+      '。具体厂房面积、能耗指标与用地条件以政府授权材料为准。';
  }else if(/企业|链主|名单|采购|配套/.test(v)){
    var _firmKnown=(_kbFirm.known||[]).slice(0,2).join('；');
    reply='关于本地企业（'+_p.city+'）：'+(_firmKnown||'骨干企业已按产品方向归类，公开资料作初步依据')+      '。采购规模与技术路线仍需核实。';
  }else if(/政策|规划|领导|报告|交办/.test(v)){
    var _polKnown=(_kbPol.known||[]).slice(0,2).join('；');
    reply='关于政策与规划（'+_p.city+'）：'+(_polKnown||'已识别重点方向')+      '。领导最新产业发言尚未上传，建议补充后确认交办口径。';
  }else if(/缺口|补链|缺什么|缺哪/.test(v)){
    var _indKnown=(_kbInd.known||[]).slice(0,2).join('；');
    reply='关于'+_p.topic+'的链条缺口：'+(_indKnown||'核心系统外购比例高，本地配套率偏低')+      '。可直接生成完整产业报告查看具体分析。';
  }else if(/线索|候选|企业/.test(v)&&_clues.length){
    reply='当前研判方向「'+_p.topic+'」已识别 '+_clues.length+' 条候选线索：'+      _clues.slice(0,2).map(function(c){return c.name+'（'+c.dir+'）'}).join('、')+      '。可在「招商对接」模块查看核验要点，或在当前页生成完整产业报告。';
  }else{
    reply='我已结合'+_p.city+'城市智库（'+_p.topic+'方向）与最新公开信息研判。可以继续补充材料，也可以直接生成初步报告——报告将涵盖产业基础判断、链条缺口、建议招引方向与候选线索。';
  }
  setTimeout(function(){addA('<p>'+reply+'</p>')},400);}
function uploadHint(){
  var mats=[
    ['📄','政府工作报告','年度产业方向、重点任务与投资承诺（最能体现虚实）'],
    ['🎤','领导经济发言稿','领导近期关注的产业与交办事项'],
    ['📊','产业 / 园区报告','产业链现状、园区载体与承接条件'],
    ['🏢','园区资料','厂房、能耗、用地等承载条件明细'],
    ['📇','目标企业名单','已接触或拟核验的企业清单']
  ];
  var body='<p class="modal-intro">上传后我会结合城市智库与公开信息研判；材料仅用于本次分析，园区承载、企业采购和领导任务仍需政府授权材料确认。</p>'+
    '<p style="font-size:12.5px;font-weight:700;color:#4a5568;margin:12px 0 8px">推荐上传以下材料：</p>'+'<ul class="material-guide">'+mats.map(function(m){return '<li><i class="i">'+m[0]+'</i><span><strong>'+m[1]+'</strong><small>'+m[2]+'</small></span></li>'}).join('')+'</ul>';
  var foot='<button class="secondary-button" onclick="closeModal()">取消</button><button class="primary-button" onclick="doUpload()">选择文件上传</button>';
  openModal('上传城市与产业材料',body,foot);
}
// 真实动作：弹系统文件夹选择文件，选完后在对话里出现「已上传文件 + 解析结果」
function doUpload(){
  closeModal();
  var inp=document.createElement('input');
  inp.type='file';inp.multiple=true;
  inp.accept='.pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.csv';
  inp.onchange=function(){
    var files=Array.from(inp.files||[]);
    if(!files.length)return;
    if(view!=='knowledge'){view='knowledge';render();}
    setTimeout(function(){ingestFiles(files,null);},100);
  };
  inp.click();
}
function uploadParsed(fname){
  if(view!=='home'){view='home';render();}
  setTimeout(function(){
    addU('[已上传] '+fname);
    var pl=$('.prompt-list');if(pl)pl.remove();
    var _up=P();var _upKb=_up.kb||[];var _upInd=_upKb[0]||{};var _upPol=_upKb[3]||{};
    var _real1=(_upInd.known||[])[0]||(_up.topic+'被列为主导产业，含具体产值与项目表述');
    var _virt1=(_upPol.known||[])[1]||'方向性政策表述，缺具体金额/地块/落地主体，需向领导确认';
    addA('<p>已收到 <b>'+fname+'</b>，完成解析。从材料中提取到与「'+_up.topic+'」研判相关的要点：</p>'+
      '<div class="report" style="margin-top:6px"><div class="rbody">'+
        '<div class="fold open"><div class="head"><span class="num">1</span><span class="concl">识别到重点产业表述 3 处</span><span class="badge real">实据</span></div>'+
          '<div class="detail">'+_real1+'，含具体数据，可作为研判依据。<div class="src">来源：'+fname+' · 第 8 页</div></div></div>'+
        '<div class="fold open"><div class="head"><span class="num">2</span><span class="concl">政策方向表述待核实落地细则</span><span class="badge virt">待核实</span></div>'+
          '<div class="detail">'+_virt1+'。<div class="src">来源：'+fname+' · 第 12 页</div></div></div>'+
      '</div></div>'+
      '<p style="margin-top:8px">材料已并入本次研判，可继续补充，或直接生成完整产业报告。</p>');
    if(P().stage<2)setStage(2);
    toast('材料已解析并加入本次研判');
  },200);
}
// 直接下载：生成一份详细的城市智库摘要文件并触发浏览器下载
function downloadSummary(){
  var p=P();var kb=p.kb;var now=new Date().toLocaleString('zh-CN');
  var L=[];
  L.push('慧小招 · '+p.city+'城市智库摘要');
  L.push('导出时间：'+now+'　|　数据更新至：'+nowLabel()+'');
  L.push('当前研判方向：'+p.topic);
  L.push('====================================================\n');
  kb.forEach(function(k,i){
    L.push((i+1)+'、'+k.t+'　（'+k.sub+'）');
    L.push('  当前已知：');
    k.known.forEach(function(x){L.push('    · '+_kbText(x))});
    L.push('  可调用材料（可追溯）：'+k.calls.join('、'));
    L.push('');
  });
  L.push('----------------------------------------------------');
  L.push('可下载的原始材料清单：');
  ['重点园区清单.xlsx（随州高新区/曾都经开区/专汽产业园/随县香菇产业园载体明细）',
   '随州三大产业链图谱.pdf（氢能专用车/智慧应急/香菇深加工缺口分析）',
   '今日公开信息摘要（更新至 '+nowLabel()+'，含新楚风/程力/博利特/品源最新动态）',
   '2026年随州市政府工作报告（完整版）',
   '随州市领导近期产业发言（含氢能走廊/应急示范基地/香菇升级方向公开报道整理）'].forEach(function(x){L.push('  - '+x)});
  L.push('');
  L.push('====================================================');
  L.push('使用边界：公开信息仅用于辅助研判；园区承载、企业采购和领导任务仍需政府授权材料确认。');
  L.push('本文件由慧小招根据城市智库与公开信息自动汇总，仅供研判参考。');
  var blob=new Blob([L.join('\n')],{type:'text/plain;charset=utf-8'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=p.city+'城市智库摘要_'+p.topic+'.txt';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  toast('已下载：'+p.city+'城市智库摘要');
}
function newProjModal(){
  var body='<p class="modal-intro">围绕本市（'+P().city+'）新增一个产业方向的研判，将生成一条独立研判线（进度、报告、证据互不干扰）。</p>'+
    '<div class="form-stack">'+
    '<label>产业方向 / 关注环节<input placeholder="例如：新能源电池回收、智能网联零部件…"></label>'+
    '<label>当下任务（可选）<textarea placeholder="例如：领导交办、近期考察、拟对接的目标企业…"></textarea></label></div>';
  var foot='<button class="secondary-button" onclick="closeModal()">取消</button><button class="primary-button" onclick="doCreateProj()">创建研判</button>';
  openModal('新建产业研判',body,foot);
}
// 真实动作：新增一条研判项目并切换过去
function doCreateProj(){
  var inp=document.querySelector('#modalLayer input');
  var dir=(inp&&inp.value.trim())||'新产业方向';
  var id='p'+Date.now();
  PROJECTS[id]={id:id,city:P().city,org:P().org,who:P().who,topic:dir+'补链',stage:1,
    kb:P().kb,report:null,clues:[]};
  closeModal();cur=id;view='home';detailData=null;render();
  toast('已创建研判：'+dir+'补链');
}

