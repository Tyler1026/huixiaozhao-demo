/* ===== 空白引导页（用户首次进入 / 无项目时） ===== */
/* Main navigation returns to the explicitly linked city workspace, while a
 * directly opened demand retains its own report and evidence. */
function industryAnalysisWorkspaceKey(projectKey){
  var project=PROJECTS[projectKey];
  if(!project||project.isDemand!==true)return projectKey;
  var key=project.workspaceId,parent=key&&PROJECTS[key];
  if(!key||key===projectKey||!parent||parent.isDemand===true||parent.city!==project.city)return projectKey;
  if(typeof AUTH==='undefined'||!AUTH)return projectKey;
  if(AUTH.scope!=='admin'){
    var keys=typeof _authProjectKeys==='function'?_authProjectKeys():[AUTH.projKey];
    if(keys.indexOf(key)<0)return projectKey;
  }
  return key;
}

function opsTopbarEmpty(){
  return '<div class="top-bar"><div class="top-brand"><div class="brand-icon">慧</div><span style="font-weight:700;font-size:15px;color:#0b183b">慧小招</span></div>'+
    '<div style="flex:1"></div><span style="font-size:12px;color:#9aa5b5">运营端</span></div>';
}

