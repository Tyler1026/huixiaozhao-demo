/* ===== 对话流交互 ===== */
// localStorage 持久化：报告版本状态 + 上传材料历史（关掉页面第二天还在）
function saveReportState(){try{localStorage.setItem('hxz_reportstate',JSON.stringify(REPORTSTATE))}catch(e){}}
/* 清扫 REPORTSTATE 陈旧数据：
   1) chainByTopic 里的 'loading' 字符串（上次会话未完成的图谱生成任务，不会跨会话续跑）
   2) 孤儿 topic：chainByTopic / aiReportByTopic / phaseByTopic 等里存在，但 userGeneratedTopics 里已删除的方向。
   3) phaseByTopic 有值但 scoreByTopic 缺失的补默认分（保守估计，避免历史卡片显示 0%）。
   在 loadReportState 与 switchProj 入口都会跑，覆盖所有项目而不仅当前项目。 */
function _sanitizeReportState(){
  try{
    Object.keys(REPORTSTATE||{}).forEach(function(_k){
      var _r=REPORTSTATE[_k]; if(!_r) return;
      // 1) 清 loading 字符串
      if(_r.chainByTopic){
        Object.keys(_r.chainByTopic).forEach(function(_t){
          if(_r.chainByTopic[_t]==='loading') _r.chainByTopic[_t]=null;
        });
      }
      // 2) 清孤儿方向数据（仅在有 userGeneratedTopics 时启用，否则可能是老数据不敢乱删）
      var _valid=_r.userGeneratedTopics;
      if(_valid && Object.keys(_valid).length){
        ['chainByTopic','aiReportByTopic','phaseByTopic','pendingByTopic','actionItemsByTopic','scoreByTopic','tsByTopic','reportByTopic'].forEach(function(_field){
          if(!_r[_field]) return;
          Object.keys(_r[_field]).forEach(function(_t){
            if(!_valid[_t]) delete _r[_field][_t];
          });
        });
      }
      // 3) phase 有分数缺失的补一个默认值（避免历史卡片 0%）
      if(_r.phaseByTopic && !_r.scoreByTopic) _r.scoreByTopic={};
      if(_r.phaseByTopic && _r.scoreByTopic){
        Object.keys(_r.phaseByTopic).forEach(function(_t){
          if(_r.phaseByTopic[_t]>=2 && _r.scoreByTopic[_t]==null) _r.scoreByTopic[_t]=60;
        });
      }
    });
  }catch(_e){}
}
function loadReportState(){try{var d=localStorage.getItem('hxz_reportstate');if(d){REPORTSTATE=JSON.parse(d);_sanitizeReportState();}}catch(e){}}
/* 内存态：正在生成的图谱任务标记（防重入 + chainMapHtml 判定 loading 是否真在跑） */
var _chainGenInFlight={};

/* ── localStorage 持久化 ── */
var LS_KEY='huixiaozhao_kb_v1';
var RESET_GEN=null;  // reset 代际标记：从服务端读到后原样带回，服务端据此拒绝旧会话写入
// 版本标记：数据结构有变时递增。
// 【2026-09-17 修复】旧实现在版本号不一致时无条件 removeItem(LS_KEY)，
// 会连同 PROJECTS / KB_CONFIRMS / UPLOADS / KB_FILE_CHUNKS 一起删掉（都存在 LS_KEY 内），
// 而 hxz_reportstate / hxz_rpt_history 是独立 key 不受影响，
// 于是表现为"报告还在、城市智库卡片全空、项目壳丢失"，随后被 autoProvisionCity 建成空壳。
// 换浏览器 / 换设备 / 清过站点数据 / 部署了新版本号，都会触发。
// 现改为：只有本地确实没有任何有价值数据时才清理；否则原地升级版本号，保留数据。
var _DATA_VER='20260917a';
if(localStorage.getItem('hxz_data_ver')!==_DATA_VER){
  var _verKeep=false;
  try{
    var _vsnap=JSON.parse(localStorage.getItem(LS_KEY)||'{}');
    var _vp=(_vsnap&&_vsnap.PROJECTS)||{};
    // 有价值 = 任一项目带智库结论 / 报告 / 线索
    _verKeep=Object.keys(_vp).some(function(k){
      var v=_vp[k]||{}; var kn=0;
      (v.kb||[]).forEach(function(c){ kn+=((c&&c.known)||[]).length; });
      return kn>0 || (v.report&&(v.report.text||v.report.md)) || ((v.clues||[]).length>0);
    });
    // 报告状态里有正文，同样说明这份数据不能丢
    if(!_verKeep){
      var _vrs=JSON.parse(localStorage.getItem('hxz_reportstate')||'{}');
      _verKeep=Object.keys(_vrs).some(function(k){
        var r=_vrs[k]||{};
        return (r.text&&r.text.length>200) || Object.keys(r.aiReportByTopic||{}).length>0;
      });
    }
  }catch(_ve){ _verKeep=true; /* 解析异常时宁可保留，不做破坏性清理 */ }
  if(_verKeep){
    localStorage.setItem('hxz_data_ver',_DATA_VER);
    console.log('[ver] bumped to '+_DATA_VER+', existing data PRESERVED');
  }else{
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem('hxz_uploads');
    localStorage.setItem('hxz_data_ver',_DATA_VER);
    console.log('[ver] cleared empty localStorage, ver='+_DATA_VER);
  }
}


/* 问答区折叠/展开 */
var _kbConvCollapsed=false;
function toggleKbConv(){
  var conv=document.getElementById('kbConv');
  var arrow=document.getElementById('kbConvArrow');
  if(!conv) return;
  _kbConvCollapsed=!_kbConvCollapsed;
  if(_kbConvCollapsed){
    conv.style.display='none';
    if(arrow) arrow.textContent='▼ 展开';
  } else {
    conv.style.display='';
    if(arrow) arrow.textContent='▲ 折叠';
    conv.scrollTop=conv.scrollHeight;
  }
  updateKbConvCount();
}
function updateKbConvCount(){
  var cnt=document.getElementById('kbConvCount');
  if(!cnt) return;
  var msgs=document.querySelectorAll('#kbConv .message');
  var n=msgs.length;
  cnt.textContent=n>0 ? n+'条，点击'+(_kbConvCollapsed?'展开':'折叠') : '尚无对话';
}

function persist(){
  // 兜底：把当前项目的 stage 同步到方向级 stageByTopic，保证方向进度独立且不丢失
  try{ var _cp=cur&&PROJECTS[cur]; if(_cp&&_cp.topic!=null&&_cp.stage!=null){ if(!_cp.stageByTopic)_cp.stageByTopic={}; _cp.stageByTopic[_cp.topic]=_cp.stage; } }catch(e){}
  try{
    // 写盘前剥掉 UPLOADS.dataUrl(文件 base64) —— dataUrl 只在上传时解析 chunks 用，之后无其它消费点；
    // 保留在 localStorage/服务端会把单个文件花上 MB级空间，几份材料就直接把 localStorage 推到 5MB 上限旭使new setItem 静默失败 -> 新问答存不进去 -> 刷新归零。
    var _UPLOADS_slim={};
    try{
      Object.keys(UPLOADS||{}).forEach(function(pk){
        _UPLOADS_slim[pk]=(UPLOADS[pk]||[]).map(function(u){
          if(!u||typeof u!=='object')return u;
          var c={}; for(var k in u){ if(k==='dataUrl')continue; c[k]=u[k]; }
          return c;
        });
      });
    }catch(_){ _UPLOADS_slim=UPLOADS; }
    var data={
      cur:cur, view:view,
      PROJECTS:PROJECTS,
      UPLOADS:_UPLOADS_slim,
      KB_CONFIRMS:KB_CONFIRMS,
      KB_CONFIRM_TOMBS:KB_CONFIRM_TOMBS,
      KB_ITEM_TOMBS:KB_ITEM_TOMBS,
      KB_FILE_CHUNKS:KB_FILE_CHUNKS,
      KB_UNLOCKED:KB_UNLOCKED,
      REPORTSTATE:REPORTSTATE,
      PENDING_CONFIRMS:PENDING_CONFIRMS,
      DOCK_LOGS:DOCK_LOGS,
      DEMANDS:typeof DEMANDS!=='undefined'?DEMANDS:[],
      KB_CHAT:KB_CHAT,
      KB_CHAT_TOMBS:KB_CHAT_TOMBS,
      UPLOAD_TOMBS:UPLOAD_TOMBS,
      REPORT_HISTORY:REPORT_HISTORY,
      USER_PROFILES:(Object.keys(USER_PROFILES||{}).length?USER_PROFILES:undefined),
      OPS_ENT:typeof OPS_ENT!=='undefined'?OPS_ENT:[],
      DELETED_PROJECTS:window.DELETED_PROJECTS||[],
      DELETED_CLUES:window.DELETED_CLUES||[],
      RESET_GEN:RESET_GEN,
      syncTs:Date.now()
    };
    // 同时写入 localStorage（保证同账号任何设备刷新都读到最新快照）
    try{ localStorage.setItem(LS_KEY, JSON.stringify(data)); }catch(_){}
    try{ localStorage.setItem('hxz_uploads', JSON.stringify(_slimUploads())); }catch(_){}
    // 同步到服务器（静默，不影响主流程）
    // 防抖sync：最多5秒同步一次，避免堆积请求占满连接池影响AI问答
    if(window._serverSyncLock) return;
    if(!window._syncTimer){ window._syncTimer=setTimeout(function(){ window._syncTimer=null;
      if(window._serverSyncLock) return;
      try{var _sd=JSON.parse(localStorage.getItem('huixiaozhao_kb_v1')||'{}');
      fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:localStorage.getItem('huixiaozhao_kb_v1')||'{}'})
        .then(function(r){return r.json();}).then(function(resp){
          if(resp&&resp.rejected==='stale-generation'){
            // 本会话数据早于服务端reset：重新拉服务端数据自愈(取得新gen+干净数据)
            console.warn('[sync] write rejected by reset barrier, resyncing from server');
            if(typeof restoreFromServer==='function') restoreFromServer(function(){ if(typeof render==='function')try{render();}catch(_){} });
          }
        }).catch(function(){});}catch(_){}
    },5000); }
  }catch(e){ console.warn('[persist] failed:',e.message); }
}

function restore(){
  try{
    var raw=localStorage.getItem(LS_KEY);
    if(!raw) return false;
    var data=JSON.parse(raw);
    if(data.PROJECTS&&Object.keys(data.PROJECTS).length){
      PROJECTS=data.PROJECTS;
      cur=data.cur||null;
      view=data.view||'setup';
      UPLOADS=_mergeUploads(data.UPLOADS, UPLOADS);
      KB_CONFIRMS=data.KB_CONFIRMS||{};
      KB_CONFIRM_TOMBS=data.KB_CONFIRM_TOMBS||{};
      KB_FILE_CHUNKS=_mergeChunks(data.KB_FILE_CHUNKS, KB_FILE_CHUNKS);
      KB_UNLOCKED=data.KB_UNLOCKED||{};
      REPORTSTATE=data.REPORTSTATE||{};
      PENDING_CONFIRMS=data.PENDING_CONFIRMS||{};
      DOCK_LOGS=data.DOCK_LOGS||{};
      // 【2026-09-21 修复】问答记忆消失根因：这里原本是裸覆盖 KB_CHAT=data.KB_CHAT||{}。
      // 政府端与管理端共用同一个 LS_KEY，而 ops.html 里 KB_CHAT 从未定义，它 persist 时
      // 固定写 KB_CHAT:{}（ops.html:4582）。于是「管理端做任意操作 → 政府端刷新走 restore()」
      // 就把问答记忆整份冲成空。restoreFromServer(8674) 与 storage 事件(9007) 两条路径
      // 早已按会话择优合并，唯独本地恢复这条漏了 —— 补齐，统一走 _mergeKbChat。
      _mergeKbChatTombs(data.KB_CHAT_TOMBS);
      _mergeUploadTombs(data.UPLOAD_TOMBS);
      KB_CHAT=_mergeKbChat(data.KB_CHAT, KB_CHAT);
      _applyUploadTombs();
      if(data.REPORT_HISTORY) REPORT_HISTORY=data.REPORT_HISTORY;
      if(data.USER_PROFILES) USER_PROFILES=data.USER_PROFILES;
      if(data.OPS_ENT) OPS_ENT=data.OPS_ENT;
      if(data.RESET_GEN) RESET_GEN=data.RESET_GEN;
      if(data.DEMANDS) DEMANDS=data.DEMANDS;
      if(data.DELETED_PROJECTS) window.DELETED_PROJECTS=data.DELETED_PROJECTS;
      if(data.DELETED_CLUES) window.DELETED_CLUES=data.DELETED_CLUES;
      console.log('[restore] loaded', Object.keys(PROJECTS).length,'projects, cur='+cur);
      try{ migrateKbChatToCity(); }catch(_){}
      return true;
    }
  }catch(e){ console.warn('[restore] failed:',e.message); }
  return false;
}

// 从服务器拉取数据并覆盖本地（登录后调用）
/* 【2026-09-18】知识条目删除墓碑 {projKey:{kbIdx:{指纹:ts}}}。
   根因：storage 监听里 `PROJECTS=incoming` 会把对端旧快照的 kb.known 整体灌回，
   而那份快照里被删的条目还在 —— 表现为「删了又自己回来」。
   既有合并已保护 customTopics/stage/clues，独缺 kb.known。
   用内容指纹而不用 itemIdx 作键：splice 后后续索引整体前移，索引做键必然错位。 */
var KB_ITEM_TOMBS={};
