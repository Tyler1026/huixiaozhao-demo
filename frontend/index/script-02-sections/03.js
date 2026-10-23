/* ===== 运营端（周总·全局）：跨城市需求池 ===== */
var DEMANDS=[];
/* 目标企业库（管理端录入，跨端同步供政府端产业链图谱关联展示） */
var OPS_ENT=OPS_ENT||[];

/* 【2026-09-29】城市基础包：{城市名: 权威projKey}，轻量指针表，不冗余存数据。
   权威projKey下 kb[].known[] 里 nature==='base' 的条目才是"基础城市包"内容
   （14-Agent流水线首轮产出），其余 nature（support/interview/fix）是各工作区
   自己的补充材料，永远不共享、不进这份指针指向的引用。
   新工作区不复制这234条到自己的kb里——展示时实时读取本函数，真正共享引用，
   而不是创建时拷贝一份快照（快照会在源头更新后过期）。 */
var CITY_BASE_PACKAGES=CITY_BASE_PACKAGES||{};
function getCityBasePackage(city){
  var authorityKey=CITY_BASE_PACKAGES[city];
  var authority=authorityKey&&PROJECTS[authorityKey];
  if(!authority||!Array.isArray(authority.kb)) return null; // 该城市尚无基础包，调用方应展示真正的空，不是占位假文本
  // 【2026-09-29】权威工作区的 kb 可能带额外的非标准主题（如"数据边界与缺口"
  // "产业分析AI问答"——运营过程中追加的，不是14-Agent首轮固定产出的4个标准
  // 分区）。之前这里对全部主题做 map，导致这些额外主题（即使 known 是空数组）
  // 也混进返回结果，界面上出现"7个主题、3个0条"的问题。改为只处理4个标准主题。
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





var RES_COLOR={matched:{bg:'#e4f5f3',c:'#006d70'},checking:{bg:'#ebf3fd',c:'#013582'},none:{bg:'#fff0de',c:'#a34c09'}};

var role='gov';   // 政府端固定，ops端在 localhost:5051
var cur=null,view='setup',detailOpen=false,detailData=null,curKb=null,curDemand=null,curSub=null;

/* ═══ 全局滚动位置记忆：整页 render() 会用 innerHTML 重建 DOM，导致滚动容器 scrollTop 归零。
   下面这套机制在重渲染前记录各滚动容器位置，重渲染后——仅当仍停留在同一 view+cur（即"原地重渲染"，
   如后台 AI 报告生成完成、跨标签数据同步、确认/撤回等操作触发的 render）——把滚动位置还原，
   避免用户正在往下阅读时莫名弹回顶部；若 view/cur 发生变化（用户主动切模块/切项目）则不还原、正常回到顶部。 ═══ */
var _SCROLL_SELECTORS='.report-scroll,.clues-scroll,.knowledge-scroll,.conversation-scroll,.docking-scroll,.settings-scroll,.detail-scroll';
var _scrollMemory={key:null,tops:null};
var _renderedScrollKey=null, _scrollCaptureSeq=0;
function _viewScrollKey(){
  return String(typeof _authEpoch==='number'?_authEpoch:0)+'::'+view+'::'+cur+(view==='report'?'::'+String(cur&&PROJECTS[cur]&&PROJECTS[cur].topic||''):'');
}
// Scroll events also come from layout clamping and our own restoration. Only
// actual user input cancels a pending restore; a same-millisecond input counts.
var _lastUserScrollMs=0,_scrollInputSeq=0,_scrollCaptureInputSeq=0;
var _scrollCaptureMs=0;
function _markScrollInput(event){
  if(event&&event.isTrusted===false)return;
  _lastUserScrollMs=Date.now();_scrollInputSeq++;
}
['wheel','touchmove','pointerdown'].forEach(function(name){document.addEventListener(name,_markScrollInput,{capture:true,passive:true});});
document.addEventListener('pointermove',function(event){if(event.buttons)_markScrollInput(event);},{capture:true,passive:true});
document.addEventListener('keydown',function(event){
  if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].indexOf(event.key)>=0)_markScrollInput(event);
},true);
function _captureScroll(){
  var tops={},anchors={};
  _scrollCaptureMs=Date.now();
  _scrollCaptureInputSeq=_scrollInputSeq;
  _scrollCaptureSeq++;
  try{
    document.querySelectorAll(_SCROLL_SELECTORS).forEach(function(el,i){
      // 用 class + 序号做键，重建后按同样规则匹配还原
      var cls=(el.className||'').split(/\s+/)[0]||'sc';
      var key=cls+'#'+i;tops[key]=el.scrollTop;
      var root=view==='report'&&document.getElementById('root'),chain=root&&root.querySelector?root.querySelector('.chain-explorer'):null;
      if(chain&&el.contains&&el.contains(chain)&&el.getBoundingClientRect&&chain.getBoundingClientRect){
        var viewport=el.getBoundingClientRect(),rect=chain.getBoundingClientRect();
        if(rect.bottom>viewport.top&&rect.top<viewport.bottom)anchors[key]={node:chain,offset:rect.top-viewport.top};
      }
    });
  }catch(e){}
  // The DOM still belongs to the previous route when a click has already changed view/topic.
  _scrollMemory={key:_renderedScrollKey||_viewScrollKey(),tops:tops,anchors:anchors};
}
function _restoreScroll(prevKey, tops, anchors){
  // 仅当重渲染后仍是同一 view+cur 才还原（否则说明用户切了模块/项目，应停在顶部）
  if(!tops || prevKey!==_viewScrollKey()) return;
  var captureSeq=_scrollCaptureSeq,inputSeq=_scrollCaptureInputSeq;
  anchors=anchors||(_scrollMemory.tops===tops?_scrollMemory.anchors:null)||{};
  // 是否有任何需要还原的非零位置；全为 0 则无需处理（避免无谓循环）
  var _has=false; for(var _k in tops){ if(tops[_k]>0){ _has=true; break; } }
  if(!_has) return;
  var apply=function(){
    // capture之后用户在新DOM上主动滚动了：让用户掌控位置，不强行覆盖
    if(captureSeq!==_scrollCaptureSeq||prevKey!==_viewScrollKey()||_scrollInputSeq!==inputSeq) return;
    try{
      document.querySelectorAll(_SCROLL_SELECTORS).forEach(function(el,i){
        var cls=(el.className||'').split(/\s+/)[0]||'sc';
        var key=cls+'#'+i,v=tops[key],anchor=anchors[key];
        if(anchor&&anchor.node.isConnected!==false&&el.contains&&el.contains(anchor.node)){
          v=el.scrollTop+anchor.node.getBoundingClientRect().top-el.getBoundingClientRect().top-anchor.offset;
        }
        if(v!=null&&v>=0)el.scrollTop=v;
      });
    }catch(e){}
  };
  apply();
  if(window.requestAnimationFrame) requestAnimationFrame(apply);
  // 300ms内用户尚未开始滚动，足以应对异步重排归零；500/800ms已无必要。
  [30,80,160,300].forEach(function(ms){ setTimeout(apply, ms); });
}


/* Reuse a graph only while its source data and authenticated route are unchanged.
   View mode and expanded details belong to the reader, not to the data version. */
function _chainRenderDataKey(){
  var state=typeof REPORTSTATE!=='undefined'&&REPORTSTATE[cur],topic=cur&&PROJECTS[cur]&&PROJECTS[cur].topic;
  if(!state||!topic||!Array.isArray((state.chainByTopic||{})[topic]))return null;
  try{return JSON.stringify([(state.chainByTopic||{})[topic],(state.chainUnclassifiedByTopic||{})[topic],(state.chainStatusByTopic||{})[topic],(state.chainEvidenceByTopic||{})[topic]]);}catch(error){return null;}
}
function _captureChainExplorer(){
  if(view!=='report'||_renderedScrollKey!==_viewScrollKey())return null;
  var root=document.getElementById('root'),chain=root&&root.querySelector?root.querySelector('.chain-explorer'):null;
  return chain&&chain._renderDataKey?{element:chain,dataKey:chain._renderDataKey,key:_viewScrollKey(),epoch:_authEpoch}:null;
}
function _restoreChainExplorer(saved){
  var root=document.getElementById('root'),chain=root&&root.querySelector?root.querySelector('.chain-explorer'):null;
  if(!chain){
    if(typeof CHAIN_OPEN_DRAWER!=='undefined'&&CHAIN_OPEN_DRAWER&&typeof closeChainLayoutNode==='function')closeChainLayoutNode(CHAIN_OPEN_DRAWER,false);
    return;
  }
  var dataKey=_chainRenderDataKey();
  if(saved&&dataKey&&saved.key===_viewScrollKey()&&saved.epoch===_authEpoch&&saved.dataKey===dataKey){
    chain.replaceWith(saved.element);
  }else{
    chain._renderDataKey=dataKey;
    // Close a portal whose source graph was replaced, even before its observer runs.
    if(typeof CHAIN_OPEN_DRAWER!=='undefined'&&CHAIN_OPEN_DRAWER&&typeof closeChainLayoutNode==='function')closeChainLayoutNode(CHAIN_OPEN_DRAWER,false);
  }
}

/* AUTH: 当前登录态 {user,city,projKey,resident,who,org,role}；null=未登录
   role: 'owner'(组织创建者，可查看/移除本组织成员) | 'member'(普通成员)。
   注意：无论 owner 还是 member，政府端都不能生成邀请码——生成入口只在管理端(/ops)，
   见 canGenerateInviteCode()，此函数在政府端恒定返回 false。 */
var AUTH=null, _authState='unknown', _authError='', _authPending=null, _authEpoch=0;
var USER_PROFILES={};  // 服务端返回的脱敏成员资料，仅用于当前授权工作区展示
var CITY_ACCOUNTS={};  // 不再从浏览器账号库验证密码
/* 政府端不接收邀请码库，验证与使用记录都由服务端处理。 */
var INVITE_CODES={};
/* 政府端任何角色都不能生成邀请码：生成入口收在管理端(/ops)，这里恒定返回 false。
   之所以做成函数而不是直接删掉相关UI，是为了让"是否可生成"这条规则有唯一判断点，
   防止未来有人在别处加个按钮时忘了这条限制。 */
function canGenerateInviteCode(auth){ return false; }
/* 组织成员管理权限：owner 可查看/移除同 projKey 下的其他账号，member 不可。 */
function isOrgOwner(auth){ return !!(auth && auth.role==='owner'); }
function _authEscape(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function _safeProfiles(profiles){
  var result={}, fields=['name','phone','wechat','org','dept','title','city','ts','role','projKey','projectKeys','user','resident'];
  Object.keys(profiles||{}).forEach(function(user){var p=profiles[user];if(!p||typeof p!=='object')return;var item={};fields.forEach(function(k){if(p[k]!==undefined)item[k]=p[k];});result[user]=item;});
  return result;
}
function _safeSyncSnapshot(raw){
  var data=Object.assign({},raw||{});
  ['KB_EDITS','USER_PROFILES','CITY_ACCOUNTS','INVITE_CODES','CITY_WORKSPACES','ACCOUNTS','AUTH','auth','password','pwd','token'].forEach(function(k){delete data[k];});
  if(data.REPORTSTATE){data.REPORTSTATE=Object.assign({},data.REPORTSTATE);Object.keys(data.REPORTSTATE).forEach(function(key){var state=Object.assign({},data.REPORTSTATE[key]);Object.keys(state).forEach(function(field){if(/^chain/.test(field)||field==='pendingChainSaves')delete state[field];});data.REPORTSTATE[key]=state;});}
  if(data.PROJECTS){data.PROJECTS=Object.assign({},data.PROJECTS);Object.keys(data.PROJECTS).forEach(function(key){data.PROJECTS[key]=Object.assign({},data.PROJECTS[key]);delete data.PROJECTS[key].segmentLevels;});}
  if(data.huixiaozhao_kb_v1)data.huixiaozhao_kb_v1=_safeSyncSnapshot(data.huixiaozhao_kb_v1);
  return data;
}
function saveAuth(){try{localStorage.removeItem('hxz_auth');}catch(_){} }
function _purgeAuthCache(){
  saveAuth();
  try{var raw=localStorage.getItem('huixiaozhao_kb_v1');if(raw)localStorage.setItem('huixiaozhao_kb_v1',JSON.stringify(_safeSyncSnapshot(JSON.parse(raw))));}catch(_){}
}
function _authResetView(){
  if(typeof materialResetSession==='function')materialResetSession();
  if(typeof workspaceSyncReset==='function')workspaceSyncReset();
  if(typeof kbResetChatRequests==='function')kbResetChatRequests();
  PROJECTS={};USER_PROFILES={};CITY_ACCOUNTS={};INVITE_CODES={};
  ['KB_EDITS','REPORTSTATE','REPORT_HISTORY','UPLOADS','KB_FILE_CHUNKS','KB_CHAT','KB_CONFIRMS','KB_CONFIRM_TOMBS','KB_ITEM_TOMBS','KB_UNLOCKED','PENDING_CONFIRMS','DOCK_LOGS','SUBPROJ','UPLOAD_TOMBS','KB_CHAT_TOMBS','CITY_BASE_PACKAGES'].forEach(function(k){if(typeof window[k]!=='undefined')window[k]={};});
  ['DEMANDS','REPORT_REQUESTS','OPS_ENT'].forEach(function(k){if(typeof window[k]!=='undefined')window[k]=[];});
  if(window._syncTimer){clearTimeout(window._syncTimer);window._syncTimer=null;}
  window._serverSyncLock=false;window._verifyInProgress=false;window._reportGenerating=false;
  window.DELETED_PROJECTS=[];window.DELETED_CLUES=[];window.__lastSyncFp=null;
  cur=null;view='login';
  if(typeof render==='function'){render._restored=false;render._routed=false;render._serverSynced=false;}
  try{['huixiaozhao_kb_v1','hxz_uploads','hxz_reportstate','hxz_report_history','hxz_rpt_history','hxz_auth','HXZ_UPLOAD_TOMBS','HXZ_KBCHAT_TOMBS','hxz_subproj'].forEach(function(k){localStorage.removeItem(k);});}catch(_){}
}
function _authAccept(auth){
  if(!auth||typeof auth.user!=='string'||!Array.isArray(auth.projectKeys))throw new Error('登录响应不完整，请重试');
  var keys=auth.projectKeys.filter(function(k){return typeof k==='string';});
  if(auth.projKey&&keys.indexOf(auth.projKey)<0&&auth.scope!=='admin')throw new Error('工作区授权不一致，请重试');
  try{var selection=JSON.parse(localStorage.getItem('hxz_kb_selection_v1')||'{}');if(selection.user&&selection.user!==auth.user)localStorage.removeItem('hxz_kb_selection_v1');}catch(_){localStorage.removeItem('hxz_kb_selection_v1');}
  _authEpoch++;_authResetView();
  AUTH={user:auth.user,city:auth.city||'',projKey:auth.projKey||null,projectKeys:keys,role:auth.role||'member',scope:auth.scope||'user',who:auth.who||auth.user,org:auth.org||'',resident:!!auth.resident};
  _authState='ready';_authError='';cur=AUTH.projKey;view='knowledge';saveAuth();
  return AUTH;
}
function _authForget(){_authEpoch++;AUTH=null;_authState='anonymous';_authResetView();try{localStorage.removeItem('hxz_kb_selection_v1');}catch(_){}}
function _authJson(path,body){
  var controller=typeof AbortController!=='undefined'?new AbortController():null;
  var timer;
  var options={credentials:'same-origin',headers:{'Accept':'application/json'}};
  if(body!==undefined){options.method='POST';options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  if(controller)options.signal=controller.signal;
  var request=fetch(path,options).then(function(response){
    return response.json().catch(function(){throw new Error('服务响应异常，请重试');}).then(function(data){
      if(response.ok===false||!data||data.ok!==true){
        var error=new Error(data&&data.message||'服务暂时不可用，请稍后重试');error.status=response.status;error.code=data&&data.error;
        if(response.status===401&&path!=='/api/auth/login'&&path!=='/api/auth/register'&&path!=='/api/auth/session'){_authForget();if(typeof render==='function')render();}
        throw error;
      }
      return data;
    });
  });
  var deadline=new Promise(function(_,reject){timer=setTimeout(function(){if(controller)controller.abort();reject(new Error('请求超时，请重试'));},20000);});
  return Promise.race([request,deadline]).then(function(data){clearTimeout(timer);return data;},function(error){clearTimeout(timer);throw error;});
}
function loadAuth(){
  if(_authPending)return _authPending;
  _purgeAuthCache();_authState='checking';
  _authPending=_authJson('/api/auth/session').then(function(data){
    if(data.authenticated!==true)throw Object.assign(new Error('请登录'),{status:401});
    _authAccept(data.auth);
  }).catch(function(error){
    if(error.status===401){_authForget();}else{AUTH=null;_authResetView();_authState='unavailable';_authError=error.message;}
  }).then(function(){_authPending=null;if(typeof render==='function')render();});
  return _authPending;
}
function logout(){
  if(logout._pending)return logout._pending;
  logout._pending=_authJson('/api/auth/logout',{}).then(function(){_authForget();render();}).catch(function(error){toast(error.message||'退出失败，请重试');}).then(function(){logout._pending=null;});
  return logout._pending;
}
function _authProjectKeys(){return AUTH&&Array.isArray(AUTH.projectKeys)?AUTH.projectKeys:[];}
function _authWorkspaceOf(key){
  var keys=_authProjectKeys(),p=PROJECTS[key];
  if(keys.indexOf(key)>=0)return key;
  return p&&keys.indexOf(p.workspaceId)>=0?p.workspaceId:null;
}
function _authFilterProjects(projects){
  var filtered={},keys=_authProjectKeys();
  Object.keys(projects||{}).forEach(function(k){var p=projects[k];if(p&&(keys.indexOf(k)>=0||keys.indexOf(p.workspaceId)>=0))filtered[k]=p;});
  return filtered;
}
/* A new direction inherits its selected parent's workspace, including in the admin UI. */
function _projectWorkspaceId(parentKey){
  parentKey=parentKey||cur;
  var parent=PROJECTS[parentKey];
  if(AUTH&&AUTH.scope==='admin')return parent&&parent.workspaceId||parentKey||AUTH.projKey||null;
  var authorized=typeof _authWorkspaceOf==='function'?_authWorkspaceOf(parentKey):null;
  return authorized||AUTH&&AUTH.projKey||null;
}
function _authReadSync(response){
  if(response.status===401){_authForget();render();throw new Error('登录已过期，请重新登录');}
  if(response.ok===false)throw new Error('工作区暂时不可用');
  return response.json();
}
function _authWorkspaceChanged(auth){_authAccept(auth);var epoch=_authEpoch;return new Promise(function(resolve){restoreFromServer(function(ok){if(epoch!==_authEpoch){resolve(false);return;}render._routed=true;render._restored=true;render._serverSynced=!!ok;cur=AUTH&&AUTH.projKey;view='knowledge';render();resolve(ok);});});}
function switchAuthWorkspace(key){
  if(!AUTH||_authProjectKeys().indexOf(key)<0){toast('没有该工作区权限');return Promise.resolve(false);}
  if(switchAuthWorkspace._pending)return switchAuthWorkspace._pending;
  var switchEpoch=_authEpoch;
  switchAuthWorkspace._pending=_authJson('/api/auth/workspace',{projKey:key}).then(function(data){if(switchEpoch!==_authEpoch)throw new Error('会话已变化，请重新登录');return _authWorkspaceChanged(data.auth);}).catch(function(error){toast(error.message);return false;}).then(function(ok){switchAuthWorkspace._pending=null;return ok;});
  return switchAuthWorkspace._pending;
}
loadAuth();
// 报告版本迭代状态（每项目一份）：{ver, finalized, patches:[补充意见], edits:{结论index:新文字}}
var REPORTSTATE={};
function rs(){var k=cur;if(!REPORTSTATE[k])REPORTSTATE[k]={ver:1,finalized:false,patches:[],edits:{}};return REPORTSTATE[k];}
function P(){return cur&&PROJECTS[cur]||{}}
/* 政府端账号按城市独立：返回当前登录城市（cur所在城市）的项目key列表 */
function cityKeys(){
  return Object.keys(PROJECTS).filter(function(k){return AUTH&&_authWorkspaceOf(k)===AUTH.projKey;});
}
