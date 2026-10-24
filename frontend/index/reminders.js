/* Account preferences and workspace notifications come only from authenticated receipts. */
var REMINDER_STATE=null, REMINDER_REQUEST_SEQ=0, REMINDER_POLL=null, REMINDER_PANEL_SEQ=0;
var REMINDER_FIELDS=['statusChanges','overdue','dailyDigest'];
function reminderContext(){
  if(typeof AUTH==='undefined'||!AUTH||AUTH.scope!=='project'||typeof _authState==='undefined'||_authState!=='ready'||typeof AUTH.user!=='string'||!AUTH.user||typeof cur!=='string'||!cur)return null;
  var workspace=typeof _authWorkspaceOf==='function'?_authWorkspaceOf(cur):null;
  if(!workspace||!Array.isArray(AUTH.projectKeys)||AUTH.projectKeys.indexOf(workspace)<0)return null;
  return {accountId:AUTH.user,projectKey:cur,workspaceId:workspace,epoch:_authEpoch,
    key:JSON.stringify([_authEpoch,AUTH.user,cur,workspace])};
}
function reminderResetSession(){
  REMINDER_STATE=null;
  if(REMINDER_POLL){clearTimeout(REMINDER_POLL);REMINDER_POLL=null;}
}
function reminderState(){
  var context=reminderContext();
  if(!context){reminderResetSession();return null;}
  if(!REMINDER_STATE||REMINDER_STATE.context.key!==context.key){
    reminderResetSession();
    REMINDER_STATE={context:context,loaded:false,loading:false,mutationPending:false,latestRequest:0,
      accountEpoch:null,version:null,preferences:null,draft:null,dirty:false,error:'',notifications:[]};
  }
  return REMINDER_STATE;
}
function reminderCurrent(state){var context=reminderContext();return !!(context&&REMINDER_STATE===state&&context.key===state.context.key);}
function reminderCopyPreferences(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==3)return null;
  var copy={};
  for(var i=0;i<REMINDER_FIELDS.length;i++){var key=REMINDER_FIELDS[i];if(typeof value[key]!=='boolean')return null;copy[key]=value[key];}
  return copy;
}
function reminderSamePreferences(a,b){return !!(a&&b&&REMINDER_FIELDS.every(function(key){return a[key]===b[key];}));}
function reminderReceipt(data,state,requestId){
  var context=state.context,preferences=reminderCopyPreferences(data&&data.preferences);
  if(!data||data.ok!==true||data.requestId!==requestId||data.accountId!==context.accountId||
    data.projectKey!==context.projectKey||data.workspaceId!==context.workspaceId||
    typeof data.accountEpoch!=='string'||!data.accountEpoch||!Number.isSafeInteger(data.version)||data.version<0||
    !preferences||!Array.isArray(data.notifications))throw new Error('提醒服务回执不完整，请重试');
  if(state.accountEpoch!==null&&state.accountEpoch!==data.accountEpoch)throw new Error('提醒订阅已变化，请重新加载后再保存');
  if(state.version!==null&&data.version<state.version)throw new Error('提醒服务返回旧版本，请重新加载');
  var ids={};
  data.notifications.forEach(function(item){
    if(!item||typeof item.id!=='string'||!item.id||ids[item.id]||
      ['status','verification','overdue','daily'].indexOf(item.type)<0||
      typeof item.title!=='string'||typeof item.message!=='string'||
      !Number.isFinite(item.createdAt)||item.createdAt<0||
      !(item.readAt===null||(Number.isFinite(item.readAt)&&item.readAt>=0))||
      item.workspaceId!==context.workspaceId||typeof item.projectKey!=='string'||!item.projectKey||
      typeof item.sourceId!=='string')throw new Error('提醒列表回执不完整，请重试');
    ids[item.id]=true;
  });
  return {accountEpoch:data.accountEpoch,version:data.version,preferences:preferences,
    notifications:data.notifications.map(function(item){return Object.assign({},item);})};
}
function reminderRender(state){
  if(!reminderCurrent(state))return;
  // A reminder response must never rebuild a composer, page, or input node.
  var badge=document.getElementById('reminderUnreadBadge'),count=state.loaded?state.notifications.filter(function(n){return n.readAt===null;}).length:0;
  if(badge){badge.textContent=String(count);badge.hidden=count===0;}
  var panel=document.getElementById('notifPanel');
  if(panel&&typeof notifList==='function'){
    var token=reminderPanelToken(state),header=panel.querySelector&&panel.querySelector('[data-reminder-panel-token]');
    if(!header||header.getAttribute('data-reminder-panel-token')!==token){
      var active=document.activeElement,focusId=active&&panel.contains(active)?active.id:null,scrollTop=panel.scrollTop;
      panel.innerHTML=notifList();
      if(focusId){var target=document.getElementById(focusId);if(target&&panel.contains(target)&&!target.disabled&&typeof target.focus==='function')target.focus({preventScroll:true});}
      panel.scrollTop=scrollTop;
    }
  }
  var section=document.getElementById('reminderPreferences');
  if(section){
    var loaded=state.loaded,draft=state.draft||state.preferences||{},disabled=!loaded||state.mutationPending;
    REMINDER_FIELDS.forEach(function(key){var input=document.getElementById('reminder-'+key);if(input){if(input.checked!==(draft[key]===true))input.checked=draft[key]===true;if(input.disabled!==disabled)input.disabled=disabled;}});
    var status=document.getElementById('reminderPreferencesStatus'),message=reminderStatusText(state);
    if(status&&status.textContent!==message)status.textContent=message;
    var save=document.getElementById('reminderPreferencesSave'),reload=document.getElementById('reminderPreferencesReload');
    if(save){save.disabled=disabled;save.textContent=state.mutationPending?'正在保存…':'保存偏好';}
    if(reload)reload.disabled=state.loading||state.mutationPending;
  }
}
function reminderPanelToken(state){
  if(!state)return 'none';
  var signature=JSON.stringify([state.loaded,state.error,state.mutationPending,state.notifications.map(function(n){return [n.id,n.type,n.title,n.message,n.createdAt,n.readAt,typeof _fmtTimeAgo==='function'?_fmtTimeAgo(n.createdAt):''];})]);
  if(signature!==state.panelSignature){state.panelSignature=signature;state.panelToken=String(++REMINDER_PANEL_SEQ);}
  return state.panelToken;
}
function reminderStatusText(state){
  return state&&state.error?state.error:!state||!state.loaded?'正在加载服务器保存的偏好…':state.mutationPending?'正在保存…':state.dirty?'有尚未保存的修改':'已加载服务器保存的偏好';
}
function reminderSchedule(state){
  if(REMINDER_POLL){clearTimeout(REMINDER_POLL);REMINDER_POLL=null;}
  if(!reminderCurrent(state))return;
  REMINDER_POLL=setTimeout(function(){REMINDER_POLL=null;if(reminderCurrent(state))reminderLoad(true);},60000);
}
function reminderRequest(path,body,state){
  var sequence=++REMINDER_REQUEST_SEQ,requestId='reminder-'+Date.now().toString(36)+'-'+sequence.toString(36);
  state.latestRequest=sequence;
  var options={credentials:'same-origin',headers:{Accept:'application/json'}},controller=typeof AbortController!=='undefined'?new AbortController():null,timer;
  if(body){body=Object.assign({},body,{projectKey:state.context.projectKey,requestId:requestId});options.method='POST';options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  else path+='?projectKey='+encodeURIComponent(state.context.projectKey)+'&requestId='+encodeURIComponent(requestId);
  if(controller)options.signal=controller.signal;
  var network=Promise.resolve().then(function(){return fetch(path,options);}).then(function(response){
    return response.json().catch(function(){throw new Error('提醒服务响应异常，请重试');}).then(function(data){
      if(response.ok!==true||!data||data.ok!==true){
        var error=new Error(data&&data.message||'提醒服务暂时不可用，请重试');error.status=response.status;
        if(response.status===401&&reminderCurrent(state)&&state.latestRequest===sequence&&typeof _authForget==='function'){_authForget();if(typeof render==='function')render();}
        throw error;
      }
      if(!reminderCurrent(state)||state.latestRequest!==sequence)return null;
      return reminderReceipt(data,state,requestId);
    });
  });
  var timeout=new Promise(function(_,reject){timer=setTimeout(function(){if(controller)controller.abort();reject(new Error('提醒请求超时，请重试'));},20000);});
  return Promise.race([network,timeout]).then(function(receipt){clearTimeout(timer);return receipt;},function(error){
    clearTimeout(timer);
    if(!reminderCurrent(state)||state.latestRequest!==sequence)return null;
    throw error;
  });
}
function reminderApply(state,receipt){
  state.accountEpoch=receipt.accountEpoch;state.version=receipt.version;state.preferences=receipt.preferences;
  state.notifications=receipt.notifications;state.loaded=true;state.error='';
  if(!state.dirty)state.draft=Object.assign({},receipt.preferences);
}
function reminderLoad(force){
  var state=reminderState();if(!state)return Promise.resolve(false);
  if(state.loading||state.mutationPending||(!force&&state.loaded))return Promise.resolve(false);
  state.loading=true;state.error='';
  return reminderRequest('/api/reminders',null,state).then(function(receipt){
    if(!receipt)return false;reminderApply(state,receipt);return true;
  }).catch(function(error){if(reminderCurrent(state)){state.error=error.status===409?'提醒订阅或版本已变化，请重新加载后再保存':(error.message||'提醒加载失败，请重试');}return false;
  }).then(function(ok){if(reminderCurrent(state)){state.loading=false;reminderRender(state);reminderSchedule(state);}return ok;});
}
function reminderEnsureLoaded(){var state=reminderState();if(state&&!state.loaded&&!state.loading&&!state.error)reminderLoad(false);}
function reminderReload(){
  var state=reminderState();if(!state||state.loading||state.mutationPending)return Promise.resolve(false);
  // A fresh enrollment receipt may follow a server-side session/epoch change.
  state.accountEpoch=null;state.version=null;
  return reminderLoad(true);
}
function reminderEdit(key,checked){
  var state=reminderState();if(!state||!state.loaded||state.mutationPending||REMINDER_FIELDS.indexOf(key)<0||typeof checked!=='boolean')return;
  state.draft=Object.assign({},state.draft||state.preferences);state.draft[key]=checked;
  state.dirty=!reminderSamePreferences(state.draft,state.preferences);state.error='';
  reminderRender(state);
}
function reminderSave(){
  var state=reminderState();if(!state||!state.loaded||state.mutationPending)return Promise.resolve(false);
  var preferences=reminderCopyPreferences(state.draft);if(!preferences)return Promise.resolve(false);
  var sentVersion=state.version,expectedVersion=sentVersion+(reminderSamePreferences(preferences,state.preferences)?0:1);
  state.mutationPending=true;state.error='';reminderRender(state);
  return reminderRequest('/api/reminder-preferences',{accountEpoch:state.accountEpoch,version:sentVersion,preferences:preferences},state).then(function(receipt){
    if(!receipt)return false;
    if(receipt.version!==expectedVersion||!reminderSamePreferences(preferences,receipt.preferences))throw new Error('保存回执与所选偏好或版本不一致，请重新加载确认');
    state.dirty=false;reminderApply(state,receipt);if(typeof toast==='function')toast('站内提醒偏好已保存');return true;
  }).catch(function(error){if(reminderCurrent(state))state.error=error.status===409?'偏好版本已变化，请重新加载后再保存':(error.message||'保存失败，请重试');return false;
  }).then(function(ok){if(reminderCurrent(state)){state.mutationPending=false;reminderRender(state);reminderSchedule(state);}return ok;});
}
function reminderMarkRead(ids,all){
  var state=reminderState();if(!state||!state.loaded||state.mutationPending)return Promise.resolve(false);
  var requested=all?state.notifications.map(function(n){return n.id;}):(ids||[]).slice();
  if(!requested.length)return Promise.resolve(true);
  if(requested.some(function(id){return !state.notifications.some(function(n){return n.id===id;});}))return Promise.resolve(false);
  state.mutationPending=true;state.error='';
  var sentVersion=state.version,body={accountEpoch:state.accountEpoch,version:sentVersion};if(all)body.all=true;else body.ids=requested;
  return reminderRequest('/api/reminders/read',body,state).then(function(receipt){
    if(!receipt)return false;
    if(receipt.version!==sentVersion||!reminderSamePreferences(state.preferences,receipt.preferences))throw new Error('提醒偏好或版本已变化，请重新加载');
    if(requested.some(function(id){return !receipt.notifications.some(function(n){return n.id===id&&n.readAt!==null;});}))throw new Error('已读回执未确认，请重试');
    reminderApply(state,receipt);return true;
  }).catch(function(error){if(reminderCurrent(state))state.error=error.status===409?'提醒版本已变化，请重新加载后再试':(error.message||'已读状态保存失败，请重试');return false;
  }).then(function(ok){if(reminderCurrent(state)){state.mutationPending=false;reminderRender(state);reminderSchedule(state);}return ok;});
}
function reminderNotifications(){var state=reminderState();return state&&state.loaded?state.notifications:[];}
function reminderPreferencesSection(){
  var state=reminderState(),loaded=!!(state&&state.loaded),draft=loaded?(state.draft||state.preferences):{},disabled=!loaded||state.mutationPending;
  var rows=[['statusChanges','状态变化通知','需求阶段或核验结果有新进展时显示站内提醒'],['overdue','超时提醒','从启用跟踪或最近有效进展中较晚者起，3 个工作日无更新时显示站内提醒；仅按周一至周五计算，暂不处理法定节假日及调休'],['dailyDigest','每日摘要','服务器在北京时间 09:00 后保存当日一份站内摘要；首次启用从次日开始']];
  return '<div class="settings-section" id="reminderPreferences"><h2>站内提醒偏好<span class="settings-editable-badge">账号全部工作区通用</span></h2>'+
    '<p>首次启用后记录新事件，不追溯启用前的历史通知。提醒在本站铃铛中查看。</p>'+rows.map(function(row){return '<label class="toggle-row"><span><strong>'+row[1]+'</strong><small>'+row[2]+'</small></span><input id="reminder-'+row[0]+'" type="checkbox" aria-label="'+row[1]+'"'+(draft[row[0]]===true?' checked':'')+(disabled?' disabled':'')+' onchange="reminderEdit(\''+row[0]+'\',this.checked)"></label>';}).join('')+
    '<p id="reminderPreferencesStatus" role="status" aria-live="polite">'+_authEscape(reminderStatusText(state))+'</p>'+
    '<button type="button" id="reminderPreferencesSave" class="primary-button settings-save" onclick="reminderSave()"'+(disabled?' disabled':'')+'>'+(state&&state.mutationPending?'正在保存…':'保存偏好')+'</button> '+
    '<button type="button" id="reminderPreferencesReload" class="secondary-button" onclick="reminderReload()"'+(state&&(state.loading||state.mutationPending)?' disabled':'')+'>重新加载</button></div>';
}
