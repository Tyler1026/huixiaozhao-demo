/* ===== 报告生成申请队列（管理端发起 → 独立报告服务 → RAG发布）===== */
var REPORT_REQUESTS=[];
var _rrEngineHealth=null;
/* 旧城市账号表仅保留空变量兼容；账号与工作区由服务端邀请流程维护。 */
var CITY_ACCOUNTS={};
/* Report submissions survive a lost response and a browser restart. Only the
   server-confirmed request enters the report queue; retries reuse its ID. */
var _rrOutboxKey='hxz_report_outbox_v1', _rrOutbox={}, _rrSending={};
try{
  var _rrSaved=JSON.parse(localStorage.getItem(_rrOutboxKey)||'{}');
  if(_rrSaved&&typeof _rrSaved==='object'&&!Array.isArray(_rrSaved)) Object.keys(_rrSaved).forEach(function(id){
    var entry=_rrSaved[id],r=entry&&entry.request;
    if(r&&r.id===id&&/^rr[A-Za-z0-9_-]{1,64}$/.test(id)&&typeof r.city==='string'&&typeof r.province==='string'&&r.status==='pending') _rrOutbox[id]=entry;
  });
}catch(_){}
function _rrSaveOutbox(){
  try{localStorage.setItem(_rrOutboxKey,JSON.stringify(_rrOutbox));return true;}catch(_){return false;}
}
function _rrAdminReady(){return typeof AUTH!=='undefined'&&AUTH&&AUTH.scope==='admin';}
function _rrJson(url,options){
  if(!_rrAdminReady())return Promise.reject(new Error('请先登录管理员账号'));
  return new Promise(function(resolve,reject){
    var controller=typeof AbortController!=='undefined'?new AbortController():null;
    var timer=setTimeout(function(){if(controller)controller.abort();reject(new Error('network-timeout'));},20000);
    options=Object.assign({},options||{});
    options.headers=Object.assign({},options.headers||{}, {'X-HXZ-Report-Client':'website'});
    if(controller) options.signal=controller.signal;
    fetch(url,options).then(function(r){
      if(r.ok===false) throw new Error('http-failure');
      return r.json();
    }).then(function(data){clearTimeout(timer);resolve(data);},function(error){clearTimeout(timer);reject(error);});
  });
}
function _rrServerState(raw){
  return raw&&raw.huixiaozhao_kb_v1&&raw.huixiaozhao_kb_v1.REPORT_REQUESTS?raw.huixiaozhao_kb_v1:raw;
}
function _rrCacheRequests(){
  try{
    var key=typeof LS_KEY!=='undefined'?LS_KEY:'huixiaozhao_kb_v1';
    var cached=JSON.parse(localStorage.getItem(key)||'{}');
    if(typeof _safeSyncSnapshot==='function')cached=_safeSyncSnapshot(cached);
    cached.REPORT_REQUESTS=REPORT_REQUESTS;
    localStorage.setItem(key,JSON.stringify(cached));
  }catch(_){}
}
function _rrMergeRequests(srv){
  var rank={pending:0,running:1,failed:2,done:3,cancelled:4},changed=false;
  (srv||[]).forEach(function(sr){
    if(!sr||!sr.id||!Object.prototype.hasOwnProperty.call(rank,sr.status)) return;
    var loc=REPORT_REQUESTS.find(function(r){return r.id===sr.id;});
    if(!loc){REPORT_REQUESTS.push(sr);changed=true;}
    else{
      // A repaired native job may resume from a retained configuration failure.
      // Keep cancellation terminal and never accept another engine/job's resume.
      var resumed=loc.engine==='full-v1'&&sr.engine===loc.engine&&loc.status==='failed'&&loc.failureCode==='configuration'&&sr.status==='running'&&sr.failureCode!=='configuration'&&
        (!loc.engineReportId||sr.engineReportId===loc.engineReportId)&&sr.city===loc.city&&sr.province===loc.province;
      if(rank[sr.status]<(rank[loc.status]||0)&&!resumed) return;
      var updated=Object.assign({},loc,sr);
      if(JSON.stringify(loc)!==JSON.stringify(updated)){Object.assign(loc,sr);changed=true;}
    }
  });
  if(changed) _rrCacheRequests();
  return changed;
}
function _rrOutboxRows(){
  return Object.keys(_rrOutbox).map(function(id){
    var entry=_rrOutbox[id];
    return Object.assign({},entry.request,{submissionPending:true,submissionBlocked:!!entry.blocked,submissionError:entry.error||''});
  });
}
function _rrFlushOutbox(){
  if(!_rrAdminReady())return Promise.resolve([]);
  var work=[];
  Object.keys(_rrOutbox).forEach(function(id){
    var entry=_rrOutbox[id];
    if(!entry||!entry.request||_rrSending[id]||entry.blocked||entry.nextAt>Date.now()) return;
    _rrSending[id]=true;
    entry.attempts=(entry.attempts||0)+1;
    _rrSaveOutbox();
    var request=entry.request;
    function findReceipt(raw){
      var state=_rrServerState(raw);
      if(!state||typeof state!=='object') throw new Error('invalid-receipt');
      var receipt=(state.REPORT_REQUESTS||[]).find(function(r){return r.id===id;});
      if(receipt&&['pending','running','failed','done','cancelled'].indexOf(receipt.status)<0) throw new Error('invalid-receipt-state');
      if(receipt&&(receipt.city!==request.city||receipt.province!==request.province)){
        var conflict=new Error('任务标识冲突，请刷新后检查申请');conflict.blocked=true;throw conflict;
      }
      return receipt;
    }
    var promise=_rrJson('/api/sync?raw=1').then(function(raw){
      var receipt=findReceipt(raw);
      if(receipt) return receipt;
      var state=_rrServerState(raw);
      if(state.RESET_GEN&&state.RESET_GEN!==entry.generation){
        var stale=new Error('数据已重置，请刷新并重新发起申请');stale.blocked=true;throw stale;
      }
      return _rrJson('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({REPORT_REQUESTS:[request],RESET_GEN:entry.generation,syncTs:Date.now()})}).then(function(resp){
        if(!resp||!resp.ok){
          var failure=new Error(resp&&resp.rejected==='stale-generation'?'数据已重置，请刷新并重新发起申请':'申请尚未保存，将自动重试');
          failure.blocked=!!(resp&&resp.rejected==='stale-generation');throw failure;
        }
        return _rrJson('/api/sync?raw=1').then(function(saved){
          var confirmed=findReceipt(saved);
          if(!confirmed) throw new Error('申请尚未读回，将自动重试');
          return confirmed;
        });
      });
    }).then(function(receipt){
      _rrMergeRequests([receipt]);
      delete _rrOutbox[id];_rrSaveOutbox();
      var label={pending:'排队中',running:'研判进行中',done:'已完成',failed:'生成失败，需检查执行器',cancelled:'已取消'};
      toast('「'+request.city+'」申请已确认保存，当前状态：'+label[receipt.status]);
    }).catch(function(error){
      entry.nextAt=Date.now()+(entry.attempts===1?30000:120000);
      entry.blocked=!!error.blocked;
      entry.error=entry.blocked?error.message:'尚未确认保存，网络恢复后自动重试';
      _rrSaveOutbox();
    }).then(function(){delete _rrSending[id];if(typeof render==='function')render();});
    work.push(promise);
  });
  return Promise.all(work);
}
if(typeof window!=='undefined'&&window.addEventListener) window.addEventListener('online',function(){
  Object.keys(_rrOutbox).forEach(function(id){_rrOutbox[id].nextAt=0;});_rrFlushOutbox();
});
function _rrDiscardBlocked(id){
  if(!_rrOutbox[id]||!_rrOutbox[id].blocked) return;
  delete _rrOutbox[id];_rrSaveOutbox();render();
}
function submitReportRequest(){
  if(!_rrAdminReady()){toast('请先登录管理员账号');return;}
  var city=($('#rrCity')&&$('#rrCity').value||'').trim();
  var prov=($('#rrProv')&&$('#rrProv').value||'').trim();
  if(!city||!prov){toast('请填写省份和城市');return;}
  if(REPORT_REQUESTS.concat(_rrOutboxRows()).some(function(r){return !r.submissionBlocked&&r.city===city&&(r.status==='pending'||r.status==='running');})){
    toast(city+' 已有进行中的申请');return;
  }
  var id='rr'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);
  _rrOutbox[id]={request:{id:id,city:city,province:prov,
    mode:'standard',status:'pending',by:'管理端·周总',ts:Date.now(),doneTs:null,projectKey:null,chunks:0},
    generation:typeof RESET_GEN!=='undefined'?RESET_GEN:null,attempts:0,nextAt:0};
  if(!_rrSaveOutbox()){delete _rrOutbox[id];toast('浏览器无法保留申请，请检查本地存储后重试');return;}
  toast('正在确认「'+city+'」申请；网络中断时会保留申请并自动重试');render();
  return _rrFlushOutbox();
}
/* 管理端「推送到 RAG」按钮：独立云端服务消费发布请求，
   在事务中保存智库材料、研判正文与发布回执。 */
function pushReportToRag(reqId,btn){
  if(!_rrAdminReady()){toast('请先登录管理员账号');return;}
  var request=REPORT_REQUESTS.find(function(r){return r.id===reqId;});
  if(!request||request.status!=='done'){toast('该报告申请尚未完成，请刷新页面后重试');return;}
  var city=request.city;
  if(btn){btn.disabled=true;btn.textContent='⏳ 推送中…';}
  fetch('/api/report-push-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:reqId,city:city})})
    .then(function(r){return r.json();})
    .then(function(res){
      if(res&&res.ok&&res.id===reqId&&res.city===city){
        var loc=REPORT_REQUESTS.find(function(r){return r.id===res.id;});
        if(loc){loc.pushRequested=true;loc.pushed=!!res.pushed;}
        toast(res.pushed?'「'+city+'」报告已推送':'已提交「'+city+'」推送请求');
        render();
      }else{
        if(btn){btn.disabled=false;btn.textContent='🚀 推送到 RAG';}
        toast('推送提交失败：'+(res&&res.error||'任务不匹配，请刷新页面后重试'));
      }
    }).catch(function(e){
      if(btn){btn.disabled=false;btn.textContent='🚀 推送到 RAG';}
      toast('网络错误，推送提交失败');
    });
}
/* 取消卡死申请：pending/running 状态下用户主动放弃这条申请，不再等待调度
   消费或流水线继续跑。写 cancelled 状态到服务端；_rr_rank 保证这个决定
   不会被稍后到达的旧调度回写（比如仍在跑的 orchestrator/claim）覆盖回去。 */
function cancelReportRequest(id,btn){
  if(!_rrAdminReady()){toast('请先登录管理员账号');return;}
  if(!confirm('确认取消这条申请？取消后不可恢复，需要重新发起。'))return;
  var loc=REPORT_REQUESTS.find(function(r){return r.id===id;});
  if(!loc)return;
  var prevStatus=loc.status;
  if(btn){btn.disabled=true;btn.textContent='取消中…';}
  loc.status='cancelled';loc.cancelTs=Date.now();
  fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({REPORT_REQUESTS:REPORT_REQUESTS,RESET_GEN:(typeof RESET_GEN!=='undefined'?RESET_GEN:null),syncTs:Date.now()})})
    .then(function(r){return r.json();})
    .then(function(res){
      if(res&&res.ok){toast('已取消该申请');render();}
      else{
        loc.status=prevStatus;/* 回滚本地乐观更新到取消前的真实状态 */
        if(btn){btn.disabled=false;btn.textContent='✕ 取消';}
        toast('取消失败：'+(res&&res.rejected||'请重试'));render();
      }
    }).catch(function(){
      loc.status=prevStatus;
      if(btn){btn.disabled=false;btn.textContent='✕ 取消';}
      toast('网络错误，取消失败');render();
    });
}
/* Refresh checkpoints even while status stays running. A polling error never
   changes a report's server status or discards a pending submission. */
setInterval(function(){
  if(!_rrAdminReady())return;
  _rrFlushOutbox();
  if(!REPORT_REQUESTS.length) return;
  var active=REPORT_REQUESTS.some(function(r){return r.status==='pending'||r.status==='running'||(r.engine==='full-v1'&&((r.status==='done'&&r.pushRequested&&!r.pushed)||(r.status==='failed'&&r.failureCode==='configuration')));});
  if(!active) return;
  var changed=false;
  var sync=_rrJson('/api/sync?raw=1').then(function(raw){
    var state=_rrServerState(raw),srv=state&&state.REPORT_REQUESTS;
    if(!srv||!srv.length) return;
    changed=_rrMergeRequests(srv)||changed;
  }).catch(function(){});
  var health=Promise.resolve();
  if(REPORT_REQUESTS.some(function(r){return r.engine==='full-v1'&&r.status==='pending';})){
    health=_rrJson('/health').then(function(raw){
      var engine=raw&&raw.report_engine;
      // Cache only readiness, never provider credentials or configuration names.
      var ready=engine&&typeof engine.configured==='boolean'?{configured:engine.configured}:null;
      if(JSON.stringify(_rrEngineHealth)!==JSON.stringify(ready)){_rrEngineHealth=ready;changed=true;}
    }).catch(function(){if(_rrEngineHealth!==null){_rrEngineHealth=null;changed=true;}});
  }
  return Promise.all([sync,health]).then(function(){if(changed)render();});
},30000);
function rrStatusBadge(s,r){
  if(r&&r.engine==='full-v1'){
    if(s==='done') return '<span class="ops-badge '+(r.pushed?'green':'blue')+'">'+(r.pushed?'已完成·RAG已发布':r.pushRequested?'Word已生成·发布中':'Word已生成·待发布')+'</span>';
    if(s==='failed'&&r.failureCode==='configuration') return '<span class="ops-badge orange">配置/认证异常·待管理员处理</span>';
    if(s==='pending'&&_rrEngineHealth&&_rrEngineHealth.configured===false) return '<span class="ops-badge orange">报告服务未就绪</span>';
  }
  if(s==='done'&&r&&!r.pushed) return '<span class="ops-badge orange">历史Word·需重新生成后发布</span>';
  return s==='done'?'<span class="ops-badge green">已完成·RAG已初始化</span>':
         s==='running'?'<span class="ops-badge blue"><span class="rr-spin"></span>AI 研判进行中</span>':
         s==='failed'?'<span class="ops-badge orange">失败·可重试</span>':
         s==='cancelled'?'<span class="ops-badge" style="background:#f1f2f4;color:#6b7280">已取消</span>':
         '<span class="ops-badge">排队中</span>';
}
