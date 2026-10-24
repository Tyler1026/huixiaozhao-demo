/* Server-owned account preferences and workspace notifications. */
function _fmtTimeAgo(ts){
  if(!ts)return '';
  var diff=(Date.now()-ts)/1000;
  if(diff<60)return '刚刚';
  if(diff<3600)return Math.floor(diff/60)+'分钟前';
  if(diff<86400)return Math.floor(diff/3600)+'小时前';
  return new Date(ts).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' 北京时间';
}
function reminderTypeLabel(type){return {status:'状态变化',verification:'核验进展',overdue:'超时提醒',daily:'每日摘要'}[type]||'站内提醒';}
function unreadCount(){return reminderNotifications().filter(function(n){return n.readAt===null;}).length;}
function notifList(){
  var state=reminderState(),items=reminderNotifications();
  var status=state&&state.error?'<p role="alert" style="padding:12px 16px">'+_authEscape(state.error)+' <button onclick="reminderReload()">重试</button></p>':
    !state||!state.loaded?'<p role="status" style="padding:12px 16px">正在加载站内提醒…</p>':
    !items.length?'<p style="padding:12px 16px">当前工作区暂无站内提醒</p>':'';
  return '<div data-reminder-panel-token="'+reminderPanelToken(state)+'" style="padding:11px 15px;border-bottom:1px solid #eef1f5;font-size:13px;font-weight:650;display:flex;justify-content:space-between;align-items:center">站内提醒 <button type="button" id="reminderMarkAllRead" style="border:0;background:none;color:#0757ad;font-size:11px;cursor:pointer" onclick="markAllRead(event)"'+(!state||!state.loaded||state.mutationPending?' disabled':'')+'>全部已读</button></div>'+status+
    items.map(function(n){return '<button type="button" id="reminderNotice-'+_authEscape(n.id)+'" onclick="openNotif('+_authEscape(JSON.stringify(n.id))+')" style="width:100%;text-align:left;background:none;border:0;padding:13px 16px;border-bottom:1px solid #f2f5f9;cursor:pointer;display:block;'+(n.readAt!==null?'opacity:.65':'')+'">'+
      '<span style="font-size:13px;font-weight:600;color:#0b183b;display:block;word-break:break-word;line-height:1.45">'+_authEscape(n.title)+(n.readAt===null?' · 未读':'')+'</span>'+
      '<span style="font-size:11.5px;color:#667590;display:block;line-height:1.55;word-break:break-word">'+_authEscape(n.message)+'</span>'+
      '<span style="font-size:10.5px;color:#8490a5;display:block;margin-top:5px">'+reminderTypeLabel(n.type)+' · '+_authEscape(_fmtTimeAgo(n.createdAt))+'</span></button>';}).join('');
}
function toggleNotif(e){
  e.stopPropagation();var panel=$('#notifPanel');
  if(panel){var opening=panel.style.display==='none';panel.style.display=opening?'block':'none';if(opening)reminderLoad(true);}
}
function markAllRead(e){if(e)e.stopPropagation();return reminderMarkRead([],true);}
function openNotif(id){
  var state=reminderState(),context=state&&state.context.key;
  var notification=reminderNotifications().find(function(n){return n.id===id;});
  if(!notification)return Promise.resolve(false);
  return reminderMarkRead([id],false).then(function(ok){
    if(!ok||!reminderCurrent(state)||state.context.key!==context)return false;
    var panel=$('#notifPanel');if(panel)panel.style.display='none';
    var project=PROJECTS[notification.projectKey];
    var canOpen=notification.type!=='daily'&&project&&typeof _authWorkspaceOf==='function'&&_authWorkspaceOf(notification.projectKey)===state.context.workspaceId;
    var body='<h3>'+_authEscape(notification.title)+'</h3><p style="white-space:pre-wrap;overflow-wrap:anywhere">'+_authEscape(notification.message)+'</p>'+
      '<p>'+reminderTypeLabel(notification.type)+' · '+_authEscape(_fmtTimeAgo(notification.createdAt))+'</p>';
    if(notification.type==='daily')body+='<p>这是服务器当时保存的摘要快照；当前项目进度可能已经更新。</p>';
    else if(!canOpen)body+='<p>相关需求当前不可访问，通知保留事件发生时的记录。</p>';
    var foot='<button class="secondary-button" onclick="closeModal()">知道了</button>'+
      (canOpen?'<button class="primary-button" onclick="closeModal();gotoProjFromNotif('+_authEscape(JSON.stringify(notification.projectKey))+')">前往该需求 ➜</button>':'');
    openModal('站内提醒详情',body,foot);return true;
  });
}
function gotoProjFromNotif(pk){
  var state=reminderState();
  if(!state||!PROJECTS[pk]||_authWorkspaceOf(pk)!==state.context.workspaceId)return;
  cur=pk;view='home';detailData=null;window.__projOpen=pk;render();
}
function toggleSw(e){e.stopPropagation();var m=$('#swMenu');m.style.display=m.style.display==='none'?'block':'none'}
function switchProj(k){cur=k;view='report';detailData=null;try{_sanitizeReportState();}catch(_){}render();toast('已进入「'+(typeof industryDemandProjectTitle==='function'?industryDemandProjectTitle(PROJECTS[k]):PROJECTS[k].topic)+'」'+(PROJECTS[k].isDemand?'需求':'研判工作区'))}
function newProj(){var m=$('#swMenu');if(m)m.style.display='none';newProjModal()}
function go(v){
  if(v==='report')cur=industryAnalysisWorkspaceKey(cur);
  if(isLocked(v)){
    var r=kbReadiness();
    var vnames={report:'AI 匹配研判',home:'需求与建联',docking:'需求与建联'};
    var vn=vnames[v]||v;
    var tips=[];
    if(r.confirmed<r.total) tips.push('\u786e\u8ba4\u5269\u4f59 '+(r.total-r.confirmed)+' \u6761\u5f85\u786e\u8ba4\u7ed3\u8bba');
    if(r.files<2) tips.push('\u5728\u57ce\u5e02\u667a\u5e93\u4e0a\u4f20\u81f3\u5c11 2 \u4efd\u653f\u5e9c\u6750\u6599');
    if(r.files<1) tips.push('\u4e0a\u4f20\u9886\u5bfc\u6700\u65b0\u4ea7\u4e1a\u53d1\u8a00\u7a3f');
    var tipsHtml=tips.slice(0,3).map(function(t){
      return '<li style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #f0f4ff">'+
        '<span style="color:#f59e0b;flex:0 0 auto">\u2192</span>'+
        '<span style="font-size:13px;color:#1e293b">'+t+'</span></li>';
    }).join('');
    var body=
      '<div style="margin-bottom:14px">'+
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'+
          '<div style="flex:1;background:#f0f4ff;border-radius:6px;height:8px;overflow:hidden">'+
            '<div style="height:100%;width:'+r.score+'%;background:'+r.color+';border-radius:6px;transition:width .3s"></div>'+
          '</div>'+
          '<span style="font-size:13px;font-weight:700;color:'+r.color+'">'+r.score+'%</span>'+
        '</div>'+
        '<p style="font-size:13px;color:#4a5568;margin:0 0 12px;line-height:1.7">'+
          '&#128274; <strong>'+vn+'</strong>\u9700\u8981\u57ce\u5e02\u667a\u5e93\u5b8c\u6210\u5ea6\u8fbe\u5230 <strong>80%</strong>\u540e\u81ea\u52a8\u89e3\u9501\u3002\u5f53\u524d <strong style="color:'+r.color+'">'+r.score+'%</strong>\u3002</p>'+
        '<p style="font-size:12px;color:#6366f1;margin:0 0 10px">\u{1f4a1} \u4e0a\u4f20\u8d8a\u591a\u6750\u6599\u3001\u9886\u5bfc\u786e\u8ba4\u8d8a\u591a\u7ed3\u8bba\uff0c\u7814\u5224\u6570\u636e\u53ef\u9760\u6027\u8d8a\u9ad8\u3002</p>'+
        (tipsHtml?'<div style="margin-bottom:10px">'+
          '<div style="font-size:11.5px;font-weight:650;color:#6366f1;margin-bottom:6px">\u5feb\u901f\u63d0\u5347\u5b8c\u6210\u5ea6\uff1a</div>'+
          '<ul style="margin:0;padding:0;list-style:none">'+tipsHtml+'</ul></div>':'');
    var foot=
      '<button class="secondary-button" onclick="closeModal()">\u7ee7\u7eed\u5b8c\u5584\u57ce\u5e02\u667a\u5e93</button>'+
      '<button onclick="unlockView(\''+v+'\')" '+
        'style="padding:10px 18px;background:#f5f7fb;color:#64748b;border:1.5px solid #e8edf5;border-radius:10px;font-size:13px;cursor:pointer">'+
        '\u5f3a\u5236\u89e3\u9501\uff08\u6570\u636e\u53ef\u9760\u6027\u8f83\u4f4e\uff09</button>';
    openModal('&#128274; '+vn+' \u5c1a\u672a\u89e3\u9501', body, foot);
    return;
  }
  view=v;detailData=null;detailOpen=true;render();
}
function bind(){
  if(!bind._kbKeyboard){
    bind._kbKeyboard=true;
    document.addEventListener('keydown',function(e){
      var page=document.getElementById('kbWorkspace');if(!page)return;
      var panel=page.classList.contains('kb-topics-open')?document.getElementById('kbTopicsPanel'):(page.classList.contains('kb-sources-open')?document.getElementById('kbSourcesPanel'):null);
      if(!panel)return;
      if(e.key==='Escape'){e.preventDefault();kbClosePanels();return;}
      if(e.key!=='Tab')return;
      var items=Array.prototype.slice.call(panel.querySelectorAll('button,a[href],textarea,input,summary,[tabindex="0"]')).filter(function(el){return !el.disabled&&el.getClientRects().length;});
      if(!items.length)return;
      var first=items[0],last=items[items.length-1];
      if(e.shiftKey&&(document.activeElement===first||!panel.contains(document.activeElement))){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&(document.activeElement===last||!panel.contains(document.activeElement))){e.preventDefault();first.focus();}
    });
  }
  document.addEventListener('click',function(e){
    var m=$('#swMenu');if(m&&m.style.display==='block'){var o=$('#orgName');if(o&&!o.contains(e.target)&&!m.contains(e.target))m.style.display='none'}
    var np=$('#notifPanel');if(np&&np.style.display==='block'&&!np.contains(e.target)&&!(e.target.closest&&e.target.closest('[onclick^=toggleNotif]'))){np.style.display='none'}
  });
  var ta=$('#composerTa');if(ta){ta.addEventListener('keydown',function(e){if(e.key==='Escape'&&view==='knowledge'){kbClosePanels();return;}if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();sendMsg()}})}
}
