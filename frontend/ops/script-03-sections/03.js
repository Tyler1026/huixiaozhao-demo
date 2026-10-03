/* ===== 报告生成申请队列（管理端发起 → Agent流水线消费 → RAG回填）===== */
var REPORT_REQUESTS=[];
/* 城市账号连接表：{slug:{city,who,org,pwd,resident,projKey}} —— 推送到RAG时自动建立 */
var CITY_ACCOUNTS={};
function submitReportRequest(){
  var city=($('#rrCity')&&$('#rrCity').value||'').trim();
  var prov=($('#rrProv')&&$('#rrProv').value||'').trim();
  if(!city||!prov){toast('请填写省份和城市');return;}
  if(REPORT_REQUESTS.some(function(r){return r.city===city&&(r.status==='pending'||r.status==='running');})){
    toast(city+' 已有进行中的申请');return;
  }
  REPORT_REQUESTS.push({id:'rr'+Date.now().toString(36),city:city,province:prov,
    mode:'deep',status:'pending',by:'管理端·周总',ts:Date.now(),doneTs:null,projectKey:null,chunks:0});
  persist();toast('已发起「'+city+'」报告生成申请，AI 流水线约 40 分钟完成');render();
}
/* 管理端「推送到 RAG」按钮：给已完成申请打 pushRequested 标记，本地轮询器消费后完成
   RAG 推送 + 城市账号连接（登录名/密码自动建立并绑定该项目）。 */
function pushReportToRag(reqId,btn){
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
/* 轮询服务器刷新申请状态（每30秒，仅状态前进时更新，避免打断输入） */
setInterval(function(){
  if(!REPORT_REQUESTS.length) return;
  var active=REPORT_REQUESTS.some(function(r){return r.status==='pending'||r.status==='running';});
  if(!active) return;
  fetch('/api/sync?raw=1').then(function(r){return r.json();}).then(function(raw){
    var srv=(raw&&raw.huixiaozhao_kb_v1&&raw.huixiaozhao_kb_v1.REPORT_REQUESTS)?raw.huixiaozhao_kb_v1.REPORT_REQUESTS:(raw&&raw.REPORT_REQUESTS);
    if(!srv||!srv.length) return;
    var rank={pending:0,running:1,failed:2,done:3,cancelled:4};var changed=false;
    srv.forEach(function(sr){
      var loc=REPORT_REQUESTS.find(function(r){return r.id===sr.id;});
      if(!loc){REPORT_REQUESTS.push(sr);changed=true;}
      else if((rank[sr.status]||0)>(rank[loc.status]||0)){Object.assign(loc,sr);changed=true;}
    });
    if(changed){render();}
  }).catch(function(){});
},30000);
function rrStatusBadge(s){
  return s==='done'?'<span class="ops-badge green">已完成·RAG已初始化</span>':
         s==='running'?'<span class="ops-badge blue"><span class="rr-spin"></span>AI 研判进行中</span>':
         s==='failed'?'<span class="ops-badge orange">失败·可重试</span>':
         s==='cancelled'?'<span class="ops-badge" style="background:#f1f2f4;color:#6b7280">已取消</span>':
         '<span class="ops-badge">排队中</span>';
}
