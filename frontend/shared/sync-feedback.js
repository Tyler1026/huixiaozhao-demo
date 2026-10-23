/* A visible, retryable receipt for generic workspace snapshots. */
var WORKSPACE_SYNC={pending:null,sequence:0};
function workspaceSyncCurrent(record){
  return !!record&&typeof AUTH!=='undefined'&&AUTH&&record.user===AUTH.user&&record.epoch===(typeof _authEpoch==='number'?_authEpoch:0);
}
function workspaceSyncNotice(message,failed){
  if(typeof document==='undefined'||!document.body)return;
  var box=document.getElementById('workspaceSyncStatus');
  if(!message){if(box)box.remove();return;}
  if(!box){box=document.createElement('div');box.id='workspaceSyncStatus';box.setAttribute('role','status');document.body.appendChild(box);}
  box.style.cssText='position:fixed;left:20px;bottom:20px;z-index:10050;max-width:420px;padding:10px 14px;border:1px solid '+(failed?'#f1b6b6':'#cbd5e1')+';border-radius:9px;background:'+(failed?'#fff1f2':'#f8fafc')+';color:#334155;font-size:13px;box-shadow:0 4px 16px #0001';
  box.textContent=message;
  if(failed){var retry=document.createElement('button');retry.type='button';retry.textContent='重试保存';retry.style.cssText='margin-left:10px;padding:3px 8px;cursor:pointer';retry.onclick=function(){workspaceSyncSend(WORKSPACE_SYNC.pending);};box.appendChild(retry);}
}
function workspaceSyncPrepare(data){
  if(typeof AUTH==='undefined'||!AUTH)return null;
  var record={id:++WORKSPACE_SYNC.sequence,user:AUTH.user,epoch:typeof _authEpoch==='number'?_authEpoch:0,body:JSON.stringify(data)};
  WORKSPACE_SYNC.pending=record;workspaceSyncNotice('更改待同步到云端…',false);return record;
}
async function workspaceSyncSend(record){
  record=record||WORKSPACE_SYNC.pending;if(!workspaceSyncCurrent(record))return false;
  if(record.request)return record.request;
  record.request=(async function(){
    var controller=typeof AbortController==='function'?new AbortController():null;
    var timer=controller?setTimeout(function(){controller.abort();},20000):null;
    try{
      var response=await fetch('/api/sync',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:record.body,signal:controller?controller.signal:undefined});
      var result=await response.json();
      if(!response.ok||!result||result.ok!==true||result.rejected)throw new Error(result&&result.message||'保存未完成');
      if(workspaceSyncCurrent(record)&&WORKSPACE_SYNC.pending===record){WORKSPACE_SYNC.pending=null;workspaceSyncNotice('',false);}
      return true;
    }catch(error){
      if(workspaceSyncCurrent(record)&&WORKSPACE_SYNC.pending===record)workspaceSyncNotice('尚未保存到云端，请重试；刷新可能丢失本次更改。',true);
      return false;
    }finally{if(timer!==null)clearTimeout(timer);record.request=null;}
  })();
  return record.request;
}
function workspaceSyncReset(){WORKSPACE_SYNC.pending=null;workspaceSyncNotice('',false);}
