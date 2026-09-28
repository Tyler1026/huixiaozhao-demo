/* Restricted integration view. No legacy cache, default account or automatic project creation. */
'use strict';
var client = HxzIdentity.createClient(window.fetch.bind(window));
var tenantState = null;
var pending = false;
function eyeSvg() { return '显示'; }
function togglePwd(id) { var e=document.getElementById(id); e.type=e.type==='password'?'text':'password'; }
function text(tag, value, parent) { var e=document.createElement(tag); e.textContent=value; parent.appendChild(e); return e; }
function loginError(message) { var e=document.getElementById('loginErr'); if(e){e.textContent=message;e.style.display='block';} }
function showLogin(message) { document.getElementById('root').innerHTML=loginPage(); if(message)loginError(message); }
async function doLogin() {
  if(pending)return;
  pending=true;
  try {
    await client.login(document.getElementById('loginUser').value, document.getElementById('loginPwd').value);
    await loadWorkspace();
  } catch(e) { showLogin('登录或数据加载失败：'+e.message); }
  finally { pending=false; }
}
async function loadWorkspace() {
  var principal=await client.resume();
  if(principal.role==='platform_admin') {
    var root=document.getElementById('root'); root.replaceChildren();
    text('h1','平台管理员',root);text('p','管理功能尚未接入此测试入口，未开放客户数据。',root);logoutButton(root);return;
  }
  tenantState=await client.load();
  var root=document.getElementById('root');root.replaceChildren();
  root.style.cssText='max-width:900px;margin:40px auto;padding:20px;font-family:sans-serif';
  text('h1','城市工作区 · 隔离联调',root);
  text('p','测试入口仅验证登录、资料读取与保存；报告生成、文件上传和招商业务尚未接入。',root);
  text('p','组织：'+principal.org_id,root);logoutButton(root);
  var keys=Object.keys(tenantState.PROJECTS);
  if(!keys.length){text('h2','资料准备中',root);text('p','尚无已分配项目。请联系平台管理员，不会自动创建空城市。',root);return;}
  keys.forEach(function(key){
    var project=tenantState.PROJECTS[key], section=document.createElement('section');root.appendChild(section);
    text('h2',project.city||'未命名城市',section);
    var kbButton=text('button','读取知识库',section), reportButton=text('button','查看已存报告',section);
    var details=document.createElement('div');section.appendChild(details);
    kbButton.onclick=async function(){
      if(pending)return;pending=true;details.replaceChildren();
      try{
        var result=await client.knowledge(key);
        result.kb.forEach(function(group){text('h3',group.topic,details);(group.known||[]).forEach(function(item){text('p',item,details);});});
        if(!result.kb.length)text('p','暂无知识条目',details);
      }catch(e){text('p','读取失败：'+e.message,details);}finally{pending=false;}
    };
    reportButton.onclick=async function(){
      if(pending)return;pending=true;details.replaceChildren();
      try{var result=await client.report(key);text('pre',result.report.text||'报告没有正文',details);}
      catch(e){text('p','读取失败：'+e.message,details);}finally{pending=false;}
    };
    var label=text('label','组织内部备注',section), input=document.createElement('textarea');
    input.value=project.internalNote||'';input.rows=3;label.appendChild(input);
    var button=text('button','保存备注',section), status=text('p','',section);
    button.onclick=async function(){
      if(pending)return;pending=true;button.disabled=true;status.textContent='保存中…';
      var copy=JSON.parse(JSON.stringify(tenantState));copy.PROJECTS[key].internalNote=input.value;
      try {await client.save(copy);tenantState=copy;status.textContent='已保存';}
      catch(e){status.textContent='保存未确认：'+e.message+'。输入保留在当前页面，刷新前请妥善保留。';}
      finally{pending=false;button.disabled=false;}
    };
  });
}
function logoutButton(root) {
  var b=text('button','退出登录',root);
  b.onclick=async function(){if(pending)return;pending=true;try{await client.logout();tenantState=null;showLogin();}catch(e){text('p','退出失败：'+e.message,root);}finally{pending=false;}};
}
(async function(){try{await loadWorkspace();}catch(e){showLogin(e.message==='unauthorized'?'':'会话恢复失败：'+e.message);}})();
