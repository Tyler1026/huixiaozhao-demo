/* Read-only upload projection. Never append extracted text to editable known rows. */
var KB_UPLOADED_READER_CONTEXT=null;
function kbUploadEscape(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function kbUploadedReadingContext(key){
  if(typeof AUTH==='undefined'||!AUTH||AUTH.scope!=='project'||typeof _authState==='undefined'||_authState!=='ready'||typeof AUTH.user!=='string'||!AUTH.user)return null;
  if(typeof cur!=='string'||!cur||typeof PROJECTS==='undefined'||!PROJECTS[key]||typeof _authWorkspaceOf!=='function')return null;
  var workspace=_authWorkspaceOf(key);
  if(!workspace||workspace!==AUTH.projKey||_authWorkspaceOf(cur)!==workspace||!Array.isArray(AUTH.projectKeys)||AUTH.projectKeys.indexOf(workspace)<0)return null;
  return {key:key,viewKey:cur,workspace:workspace,user:AUTH.user,epoch:typeof _authEpoch==='number'?_authEpoch:0};
}
function kbUploadedMaterialGroups(key,topicIndex){
  if(!kbUploadedReadingContext(key))return [];
  var project=PROJECTS[key],topics=Array.isArray(project.kb)?project.kb:[];
  if(topicIndex!==null&&(!Number.isInteger(topicIndex)||!topics[topicIndex]))return [];
  var receipts=typeof UPLOADS!=='undefined'&&Array.isArray(UPLOADS[key])?UPLOADS[key]:[];
  var files=typeof KB_FILE_CHUNKS!=='undefined'&&Array.isArray(KB_FILE_CHUNKS[key])?KB_FILE_CHUNKS[key]:[];
  var tombs=typeof UPLOAD_TOMBS!=='undefined'&&UPLOAD_TOMBS||{},counts=Object.create(null);
  receipts.forEach(function(row){if(row&&typeof row.originalId==='string')counts[row.originalId]=(counts[row.originalId]||0)+1;});
  return receipts.filter(function(row){
    return row&&/^[a-f0-9]{32}$/.test(row.originalId||'')&&counts[row.originalId]===1&&
      typeof row.name==='string'&&row.name&&!row.deleted&&!tombs[key+'::'+row.name]&&
      (!row.projectKey||row.projectKey===key)&&(topicIndex===null||row.kbIdx===topicIndex);
  }).map(function(row){
    var expected=Number.isInteger(row.chunks)&&row.chunks>=0?row.chunks:null;
    var blocked=row.pending?'解析中':row.parseFailed?'解析失败，暂无可阅读正文':'';
    var originalUnavailable=row.chunkRepair&&['original_not_found','original_integrity_failed'].indexOf(row.chunkRepair.code)>=0;
    var seen=Object.create(null),ambiguous=false,invalid=false,items=[];
    files.forEach(function(chunk){
      if(!chunk||chunk.originalId!==row.originalId)return;
      if(chunk.deleted||chunk.pending||chunk.parseFailed||typeof chunk.text!=='string'||!chunk.text.trim())return;
      if(chunk.projectKey&&chunk.projectKey!==key){invalid=true;return;}
      var match=String(chunk.id||'').match(new RegExp('^upload:'+row.originalId+':(0|[1-9][0-9]*)$'));
      if(!match||!Number.isSafeInteger(Number(match[1]))){invalid=true;return;}
      var index=Number(match[1]);
      if(seen[index]){ambiguous=true;seen[index].duplicate=true;return;}
      var item={index:index,text:chunk.text,duplicate:false};seen[index]=item;items.push(item);
    });
    items=blocked?[]:items.filter(function(item){return !item.duplicate;}).sort(function(a,b){return a.index-b.index;});
    var complete=!blocked&&!invalid&&!ambiguous&&expected!==null&&expected>0&&items.length===expected&&items.every(function(item,index){return item.index===index;});
    var status=(originalUnavailable?'原件待检查；':'')+(blocked||(complete?'已保存全部 '+expected+' 个片段':items.length?'已保存 '+items.length+' / '+(expected===null?'总数未知':expected)+' 个片段，尚不完整':'暂无可阅读片段'));
    return {originalId:row.originalId,name:row.name,kbIdx:row.kbIdx,expected:expected,items:items,complete:complete,status:status,originalUnavailable:!!originalUnavailable,
      originalSha256:/^[a-f0-9]{64}$/.test(row.originalSha256||'')?row.originalSha256:'',record:row};
  });
}
function kbUploadedPlaceholder(value,groups){
  if(typeof value!=='string')return false;
  return groups.some(function(group){return group.expected!==null&&value==='📎 '+group.name+' 已解析（'+group.expected+' 片段）';});
}
function kbUploadedMaterialReadButton(key,originalId){
  var context=kbUploadedReadingContext(key);if(!context)return '';
  var group=kbUploadedMaterialGroups(key,null).find(function(item){return item.originalId===originalId;});
  if(!group)return '<span>原件关联不可用</span>';
  if(!group.items.length)return '<span>'+kbUploadEscape(group.status)+'</span>';
  var args=[key,originalId,context.epoch,context.user,context.viewKey].map(function(value){return JSON.stringify(value);}).join(',');
  return '<button type="button" class="kb-detail-secondary" onclick="kbOpenUploadedMaterial('+kbUploadEscape(args)+')">'+(group.complete&&!group.originalUnavailable?'阅读全文':'查看已保存片段')+'（'+group.items.length+' 片段）</button>';
}
function kbUploadedMaterialSection(key,topicIndex){
  var groups=kbUploadedMaterialGroups(key,topicIndex);if(!groups.length)return '';
  var total=groups.reduce(function(n,group){return n+group.items.length;},0);
  return '<section class="kb-uploaded-materials" aria-label="上传材料正文" style="margin:14px 0;padding:14px;border:1px solid #dbe4f0;border-radius:10px">'+
    '<h3>上传材料正文</h3><p>'+groups.length+' 个文件 · '+total+' 个已保存片段 · '+groups.length+' 项原件来源</p><p>上传和解析不代表事实已核验。正文独立保存，不作为可编辑的知识条目。</p>'+
    groups.map(function(group){var url=uploadOriginalUrl(key,group.record);return '<article data-original-id="'+group.originalId+'" style="padding:12px 0;border-top:1px solid #e2e8f0"><strong>'+kbUploadEscape(group.name)+'</strong><p>'+kbUploadEscape(group.status)+' · 上传原件，内容待核</p>'+kbUploadedMaterialReadButton(key,group.originalId)+(url?' <a href="'+kbUploadEscape(url)+'" download>下载原件</a>':'')+'</article>';}).join('')+'</section>';
}
function kbCloseUploadedMaterialReader(){
  KB_UPLOADED_READER_CONTEXT=null;
  var node=document.getElementById('kbUploadedMaterialReader');if(node)node.remove();
}
function kbUploadedMaterialStamp(group){
  return JSON.stringify([group.name,group.expected,group.status,group.originalSha256,group.items.map(function(item){return [item.index,item.text];})]);
}
function kbCancelStaleUploadedMaterialReader(){
  var saved=KB_UPLOADED_READER_CONTEXT;if(!saved)return;
  var context=kbUploadedReadingContext(saved.key);
  var group=context&&kbUploadedMaterialGroups(saved.key,null).find(function(item){return item.originalId===saved.originalId;});
  if(!context||context.epoch!==saved.epoch||context.user!==saved.user||context.viewKey!==saved.viewKey||!group||!group.items.length||kbUploadedMaterialStamp(group)!==saved.groupStamp)kbCloseUploadedMaterialReader();
}
function kbOpenUploadedMaterial(key,originalId,epoch,user,viewKey){
  var context=kbUploadedReadingContext(key);
  if(!context||context.epoch!==epoch||context.user!==user||context.viewKey!==viewKey)return false;
  var group=kbUploadedMaterialGroups(key,null).find(function(item){return item.originalId===originalId;});
  if(!group||!group.items.length)return false;
  kbCloseUploadedMaterialReader();
  context.originalId=originalId;context.groupStamp=kbUploadedMaterialStamp(group);KB_UPLOADED_READER_CONTEXT=context;
  var layer=document.createElement('div');layer.id='kbUploadedMaterialReader';layer.className='modal-layer';layer.style.zIndex='8890';
  layer.onclick=function(event){if(event.target===layer)kbCloseUploadedMaterialReader();};
  var url=uploadOriginalUrl(key,group.record);
  layer.innerHTML='<div class="modal" role="dialog" aria-modal="true" aria-labelledby="kbUploadedReaderTitle"><header><h2 id="kbUploadedReaderTitle">'+kbUploadEscape(group.name)+'</h2><button type="button" aria-label="关闭原文阅读" onclick="kbCloseUploadedMaterialReader()">✕</button></header><div class="modal-body" style="max-height:70vh;overflow:auto">'+
    '<p>'+kbUploadEscape(group.status)+' · 1 个文件 · 1 项上传原件来源</p><p>只读解析正文 · 下载原件可核对原始排版。上传和解析不代表事实已核验。</p>'+
    (group.originalSha256?'<p style="overflow-wrap:anywhere">记录的原件 SHA256：'+kbUploadEscape(group.originalSha256)+'</p>':'')+
    group.items.map(function(item){return '<section data-upload-chunk="'+item.index+'"><h3>片段 '+(item.index+1)+'</h3><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit">'+kbUploadEscape(item.text)+'</pre></section>';}).join('')+
    '</div><footer>'+(url?'<a href="'+kbUploadEscape(url)+'" download>下载原件</a>':'')+' <button type="button" onclick="kbCloseUploadedMaterialReader()">关闭</button></footer></div>';
  document.body.appendChild(layer);
  var close=layer.querySelector&&layer.querySelector('button');if(close)close.focus();
  return true;
}
