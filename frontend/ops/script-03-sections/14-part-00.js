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
      INVITE_CODES:INVITE_CODES,
      RESET_GEN:(typeof RESET_GEN!=='undefined'?RESET_GEN:null),
      DELETED_CLUES:window.DELETED_CLUES||[],
      syncTs:Date.now()
    };
    try{ localStorage.setItem(LS_KEY, JSON.stringify(data)); }catch(_){}
    // 同步到服务器（持久化存储）
    // 【2026-09-29】修复：旧 guard 用 OPS_ENT 是否为空来决定"整个请求要不要发"，
    // 导致企业资源库一天没数据（本地演示环境的常态），管理端所有字段（邀请码/注册用户/
    // 城市数据…）永远持久化不了——不是"防止误清空"，而是"锁死了持久化"。
    // 改为只在 OPS_ENT 为空且服务端曾经有数据时，本次请求不带 OPS_ENT 字段（保护那一个
    // 字段不被空值覆盖），其余字段照常发送，不再因为一个字段的状态挡住整份数据。
    var _sendData=data;
    if(OPS_ENT.length===0 && window._opsServerHadData){
      _sendData=Object.assign({}, data);
      delete _sendData.OPS_ENT;
    }
    try{ fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(_sendData)})
      .then(function(r){return r.json();}).then(function(resp){
        if(resp&&resp.rejected==='stale-generation'){
          console.warn('[sync] write rejected by reset barrier, resyncing from server');
          if(typeof restoreFromServer==='function') restoreFromServer(function(){ if(typeof render==='function')try{render();}catch(_){} });
        }
      }).catch(function(){}); }catch(_){}
  }catch(e){ console.warn('[persist] failed:',e.message); }
}

/* 【2026-09-18】知识条目删除墓碑 {projKey:{kbIdx:{指纹:ts}}}。
   根因：storage 监听里 `PROJECTS=incoming` 会把对端旧快照的 kb.known 整体灌回，
   而那份快照里被删的条目还在 —— 表现为「删了又自己回来」。
   既有合并已保护 customTopics/stage/clues，独缺 kb.known。
   用内容指纹而不用 itemIdx 作键：splice 后后续索引整体前移，索引做键必然错位。 */
var KB_ITEM_TOMBS={};
