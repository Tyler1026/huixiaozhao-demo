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
function pushReportToRag(city,btn){
  if(btn){btn.disabled=true;btn.textContent='⏳ 推送中…';}
  fetch('/api/report-push-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({city:city})})
    .then(function(r){return r.json();})
    .then(function(res){
      if(res&&res.ok){
        var loc=REPORT_REQUESTS.find(function(r){return r.city===city&&r.status==='done';});
        if(loc){loc.pushRequested=true;loc.pushed=false;}
        toast('已提交「'+city+'」推送任务，RAG 与城市账号将自动连接');
        render();
      }else{
        if(btn){btn.disabled=false;btn.textContent='🚀 推送到 RAG';}
        toast('推送提交失败：'+(res&&res.error||'该城市无已完成报告'));
      }
    }).catch(function(e){
      if(btn){btn.disabled=false;btn.textContent='🚀 推送到 RAG';}
      toast('网络错误，推送提交失败');
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
    var rank={pending:0,running:1,failed:2,done:3};var changed=false;
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
         '<span class="ops-badge">排队中</span>';
}
