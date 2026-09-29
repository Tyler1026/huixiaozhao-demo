/* ===== 对话流交互 ===== */
// localStorage 持久化：报告版本状态 + 上传材料历史（关掉页面第二天还在）
function saveReportState(){try{localStorage.setItem('hxz_reportstate',JSON.stringify(REPORTSTATE))}catch(e){}}
function loadReportState(){try{var d=localStorage.getItem('hxz_reportstate');if(d)REPORTSTATE=JSON.parse(d)}catch(e){}}

/* ── localStorage 持久化 ── */
var LS_KEY='huixiaozhao_kb_v1';

function persist(){
  if(!window._opsDataReady){return;} // block persist until server data loaded
  try{
    var data={
      cur:cur, view:view,
      PROJECTS:PROJECTS,
      UPLOADS:UPLOADS,
      KB_CONFIRMS:KB_CONFIRMS,
      KB_CONFIRM_TOMBS:KB_CONFIRM_TOMBS,
      KB_ITEM_TOMBS:KB_ITEM_TOMBS,
      KB_FILE_CHUNKS:KB_FILE_CHUNKS,
      KB_UNLOCKED:KB_UNLOCKED,
      REPORTSTATE:REPORTSTATE,
      PENDING_CONFIRMS:PENDING_CONFIRMS,
      DOCK_LOGS:DOCK_LOGS,
      OPS_ENT:OPS_ENT,
      DEMANDS:DEMANDS,
      REPORT_REQUESTS:REPORT_REQUESTS,
      // 【2026-09-21 修复】管理端从不读写问答记忆，但原来写的是
      //   KB_CHAT: typeof KB_CHAT!=='undefined' ? KB_CHAT : {}
      // 而 ops.html 里 KB_CHAT 根本没有定义，于是每次 persist 都往共用的
      // LS_KEY 里写一个空对象；政府端刷新走 restore() 时就被冲成空（问答记忆归零）。
      // 管理端不该成为该字段的写入方：原样读回已存值带上，自己绝不产生空值。
      KB_CHAT:(function(){
        if(typeof KB_CHAT!=='undefined' && KB_CHAT && Object.keys(KB_CHAT).length) return KB_CHAT;
        try{ var _p=JSON.parse(localStorage.getItem(LS_KEY)||'{}'); if(_p && _p.KB_CHAT) return _p.KB_CHAT; }catch(_){}
        return {};
      })(),
      USER_PROFILES:USER_PROFILES,
      CITY_ACCOUNTS:CITY_ACCOUNTS,
      RESET_GEN:(typeof RESET_GEN!=='undefined'?RESET_GEN:null),
      DELETED_CLUES:window.DELETED_CLUES||[],
      syncTs:Date.now()
    };
    try{ localStorage.setItem(LS_KEY, JSON.stringify(data)); }catch(_){}
    // 同步到服务器（持久化存储）
    // Guard: don't overwrite server if OPS_ENT is empty (likely not yet loaded)
    if(OPS_ENT.length>0 || !window._opsServerHadData){ try{ fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
      .then(function(r){return r.json();}).then(function(resp){
        if(resp&&resp.rejected==='stale-generation'){
          console.warn('[sync] write rejected by reset barrier, resyncing from server');
          if(typeof restoreFromServer==='function') restoreFromServer(function(){ if(typeof render==='function')try{render();}catch(_){} });
        }
      }).catch(function(){}); }catch(_){} }
  }catch(e){ console.warn('[persist] failed:',e.message); }
}

/* 【2026-09-18】知识条目删除墓碑 {projKey:{kbIdx:{指纹:ts}}}。
   根因：storage 监听里 `PROJECTS=incoming` 会把对端旧快照的 kb.known 整体灌回，
   而那份快照里被删的条目还在 —— 表现为「删了又自己回来」。
   既有合并已保护 customTopics/stage/clues，独缺 kb.known。
   用内容指纹而不用 itemIdx 作键：splice 后后续索引整体前移，索引做键必然错位。 */
var KB_ITEM_TOMBS={};
