/* ===== 通用弹窗（复用雷总 .modal 类）===== */
function openModal(title,bodyHtml,footHtml){
  var l=document.createElement('div');l.className='modal-layer';l.id='modalLayer';
  l.onclick=function(e){if(e.target===l)closeModal()};
  l.innerHTML='<div class="modal"><header><h2>'+title+'</h2><button onclick="closeModal()"><i class="i">✕</i></button></header>'+
    '<div class="modal-body">'+bodyHtml+'</div>'+(footHtml?('<footer>'+footHtml+'</footer>'):'')+'</div>';
  document.body.appendChild(l);
}
function closeModal(){
  window._verifyInProgress=false;var l=$('#modalLayer');if(l)l.remove();var cm=$('#conflictModal');if(cm)cm.remove();}
var NAV=[['knowledge','📚','城市智库','完善材料·产业/园区/企业/政策'],['report','📝','产业分析','产业分析·可来回优化'],['home','🤝','招商对接','项目列表·对接进度'],['settings','⚙️','设置','账号与提醒']];

function render(){
  // 跳过重渲染：用户正在查看校验结果或冲突面板时不重建DOM
  if(AUTH&&_authState==='ready'&&(window._verifyInProgress || document.getElementById('conflictModal'))) return;
  // 报告生成中且当前在report view时不重建DOM（保护流式输出的reportContent）
  // 切到其他view不阻塞；revealReport完成后会主动调render()
  if(AUTH&&_authState==='ready'&&window._reportGenerating && view==='report') return;
  // Only a server-confirmed cookie session authorizes workspace rendering.
  var authRoot=document.getElementById('root');
  if(_authState==='unknown'||_authState==='checking'){
    if(authRoot)authRoot.innerHTML='<div style="padding:60px;text-align:center;color:#667590">正在验证登录状态…</div>';
    return;
  }
  if(_authState==='unavailable'){
    if(authRoot)authRoot.innerHTML='<div style="padding:60px;text-align:center;color:#667590">'+_authEscape(_authError||'登录服务暂时不可用')+'<p><button onclick="loadAuth()">重试登录状态验证</button></p></div>';
    return;
  }
  if(!AUTH){if(authRoot)authRoot.innerHTML=view==='register'?registerPage():loginPage();return;}
  if(!render._routed){
    render._routed=true;render._restored=true;render._serverSynced=false;
    if(authRoot)authRoot.innerHTML='<div style="padding:60px;text-align:center;color:#667590">正在加载工作区…</div>';
    restoreFromServer(function(ok){
      if(!AUTH){render();return;}
      render._serverSynced=!!ok;cur=AUTH.projKey||null;view='knowledge';render();
    });
    return;
  }
  var workspace=cur&&_authWorkspaceOf(cur);
  if(workspace&&workspace!==AUTH.projKey){switchAuthWorkspace(workspace);return;}
  if(!workspace)cur=AUTH.projKey||null;
  if(!cur||!PROJECTS[cur]){
    if(authRoot)authRoot.innerHTML='<div style="padding:60px;text-align:center;color:#667590">'+(render._serverSynced?'当前账号尚无可用工作区，请通过邀请码加入团队或联系管理员。':'工作区暂未加载，请重试。')+'<p><button onclick="openJoinWorkspace()">通过邀请码加入工作区</button> <button onclick="render._routed=false;render()">重新加载</button> <button onclick="logout()">退出登录</button></p></div>';
    return;
  }
  if(view==='setup'||!cur||!PROJECTS[cur]){var _root=$('#root');if(_root){_root.innerHTML='<div style="height:100vh;background:#f5f7fb">'+setupPage()+'</div>';bind();} return;}
  if(role==='ops')return renderOps();
  var p=P();
  // 修复方向/报告错位：报告正文必须跟随当前方向 topic。刷新后缓存里 REPORTSTATE[cur].topic(旧方向)
  // 与 PROJECTS[cur].topic(当前方向) 可能不一致，导致标题显示当前方向、正文却是旧方向的报告。
  if(cur && REPORTSTATE[cur] && p.topic && REPORTSTATE[cur].topic!==p.topic){
    var _syncTxt=getTopicReport(p.topic);
    REPORTSTATE[cur].topic=p.topic;
    if(_syncTxt){
      REPORTSTATE[cur].text=_syncTxt;
    }else{
      // 当前方向无预埋报告(如自定义/新能源配套)：清空旧报告正文，避免标题(当前)与正文(旧方向)错位
      REPORTSTATE[cur].text='';
    }
    // 后台从 RAG 库生成该方向的真实 AI 报告（预埋文本先占位，AI 就绪后替换）
    ensureAiReport(p.topic, p.city);
    // 同根因连带修复：可立项招引方向卡片(actionItemsByTopic)历史脏缓存可能存了旧方向的招引方向，
    // 导致切换方向后仍显示旧方向的 TOP3(如香菇方向却显示燃料电池电堆)。此处按当前方向实时重解析覆盖。
    var _items=parseActionItems(_syncTxt||REPORTSTATE[cur].text||'');
    if(_items.length){
      if(!REPORTSTATE[cur].actionItemsByTopic) REPORTSTATE[cur].actionItemsByTopic={};
      REPORTSTATE[cur].actionItemsByTopic[p.topic]=_items;
    }
  }
  // 重建 DOM 前：记录当前滚动位置（供"原地重渲染"后还原，避免阅读时弹回顶部）
  // 注意：必须用"本次重建前"刚捕获的位置来还原（_captureScroll 会写入 _scrollMemory），
  // 而不是上一轮的旧值，否则跨标签同步/异步 render 会把滚动错误还原到过时位置或顶部。
  _captureScroll();
  var _prevScrollKey=_scrollMemory.key, _prevScrollTops=_scrollMemory.tops;
  $('#root').innerHTML=
   '<div class="app-shell">'+
    topbar(p)+
    '<div class="app-content">'+sidebar()+
      '<div class="pane-divider"><span class="divider-grip"><i class="i">⋮</i></span></div>'+
      '<div class="content-column"><div class="workspace">'+
        '<div class="main-pane">'+mainPane(p)+'</div>'+
        (detailOpen&&view!=='knowledge'?('<div class="detail-pane">'+detailPane(p)+'</div>')
                   :(view==='knowledge'?'':('<button class="reopen-detail" onclick="toggleDetail()"><i class="i"></i>展开详情</button>')))+
      '</div></div>'+
    '</div>'+
    progressFooter(p)+
   '</div>';
  bind();
  if(cur && REPORT_HISTORY[cur]) { var _rha=document.getElementById('reportHistoryArea'); if(_rha) renderHistoryReports(cur); }
  // 城市智库对话：render 重建了 #kbConv，把已存的历史对话回放回去（切主题/切模块/刷新都不丢）
  if(view==='knowledge'){ setTimeout(kbChatReplay, 50); }
  // 重建 DOM 后：若仍停留在同一 view+cur（原地重渲染），还原滚动位置，避免阅读时弹回顶部
  _restoreScroll(_prevScrollKey, _prevScrollTops);
  // 兜底：kbChatReplay 可能在 800ms+ 后 reset scrollTop；仅知识库视图需要长延时再恢复。
  // 报告视图不注册长延时，防止用户刚开始下拉就被强制拉回顶部（"拖住"感根因）。
  if(view==='knowledge'){
    var _fk=_prevScrollKey,_ft=_prevScrollTops;
    [1200,2000].forEach(function(ms){setTimeout(function(){_restoreScroll(_fk,_ft);},ms);});
  }
}
/* 顶栏角色切换按钮（政府端 ⇄ 运营端）*/
