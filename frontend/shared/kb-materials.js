/* Shared source-bound material projection. Both workspaces use this exact view. */
function materialValueEqual(a,b){
  if(a===b)return true;
  if(a===null||b===null||typeof a!==typeof b||typeof a!=='object')return false;
  if(Array.isArray(a)!==Array.isArray(b))return false;
  var ak=Object.keys(a).sort(),bk=Object.keys(b).sort();
  if(ak.length!==bk.length)return false;
  if(Array.isArray(a)&&a.length!==b.length)return false;
  for(var i=0;i<ak.length;i++)if(ak[i]!==bk[i]||!materialValueEqual(a[ak[i]],b[bk[i]]))return false;
  return true;
}
function materialEditRecords(key){
  var map=typeof KB_EDITS!=='undefined'&&KB_EDITS&&KB_EDITS[key];
  if(!map||typeof map!=='object'||Array.isArray(map))return [];
  function index(value){return Number.isInteger(value)&&value>=0;}
  return Object.keys(map).map(function(id){return map[id];}).filter(function(record){
    if(!record||typeof record!=='object'||Array.isArray(record)||typeof record.id!=='string'||!record.id||
        !Object.prototype.hasOwnProperty.call(map,record.id)||map[record.id]!==record||
        !index(record.sectionIndex)||typeof record.sectionTitle!=='string'||!record.sectionTitle.trim()||
        typeof record.text!=='string'||!record.text.trim()||Array.from(record.text).length>200000||
        !index(record.revision)||record.revision===0||typeof record.ts!=='number'||!isFinite(record.ts)||record.ts<0||
        typeof record.account!=='string'||record.status!=='edited'||
        (Object.prototype.hasOwnProperty.call(record,'deleted')&&typeof record.deleted!=='boolean')||
        !['sourceIndex','sourceItem','baseReportVersion'].every(function(field){return Object.prototype.hasOwnProperty.call(record,field);}))return false;
    if(record.sourceIndex===null)return record.sourceItem===null&&record.baseReportVersion===null;
    return index(record.sourceIndex)&&(typeof record.sourceItem==='string'||
      record.sourceItem!==null&&typeof record.sourceItem==='object'&&!Array.isArray(record.sourceItem));
  }).sort(function(a,b){return a.ts-b.ts||(a.id<b.id?-1:a.id>b.id?1:0);});
}
function materialEditRecord(key,item){
  var id=item&&typeof item==='object'&&item._kbEditId;
  if(typeof id!=='string')return null;
  var records=materialEditRecords(key);
  for(var i=0;i<records.length;i++)if(records[i].id===id&&!records[i].deleted)return records[i];
  return null;
}
function materialSourceEdit(project,sectionIndex,sourceIndex,key){
  var section=project&&Array.isArray(project.kb)&&project.kb[sectionIndex];
  if(!section||!Number.isInteger(sectionIndex)||!Number.isInteger(sourceIndex)||
      !Array.isArray(section.known)||sourceIndex<0||sourceIndex>=section.known.length)return null;
  var version=project.baseReportVersion===undefined?null:project.baseReportVersion,matches=[];
  materialEditRecords(key===undefined?(typeof cur==='undefined'?'':cur):key).forEach(function(record){
    if(record.sectionIndex===sectionIndex&&record.sectionTitle===section.t&&record.sourceIndex===sourceIndex&&
        materialValueEqual(record.sourceItem,section.known[sourceIndex])&&materialValueEqual(record.baseReportVersion,version))matches.push(record);
  });
  var live=matches.filter(function(record){return !record.deleted;});
  // Ambiguous duplicated source revisions must fail closed in both the UI and AI projection.
  if(live.length>1)return null;
  return live.length===1?live[0]:matches.length?matches[matches.length-1]:null;
}
function materialSourceCurrent(record,project,section,index){
  if(!section||record.sectionTitle!==section.t)return false;
  if(record.sourceIndex===null)return project.kb.filter(function(item){return item&&item.t===record.sectionTitle;}).length===1;
  return record.sectionIndex===index&&Array.isArray(section.known)&&record.sourceIndex<section.known.length&&materialValueEqual(record.sourceItem,section.known[record.sourceIndex])&&materialValueEqual(record.baseReportVersion,project.baseReportVersion===undefined?null:project.baseReportVersion);
}
function materialProjectedEdit(record,original,needsReview,reason){
  var item=original&&typeof original==='object'&&!Array.isArray(original)?Object.assign({},original):{};
  var source=record.sourceItem,sourceText=typeof source==='string'?source:source&&source.text||'';
  item.text=record.text.replace(/^\s*\u2705\s*/,'');item.origin='user';item.nature='fix';item._kbUserEdited=true;
  item._kbEditId=record.id;item._kbRevision=record.revision;item.ts=record.ts;item.account=record.account;
  item._kbEditStatus=needsReview?'needs_review':'active';item.verificationStatus='user_stated';
  if(record.sourceIndex!==null){
    item.correction={editId:record.id,revision:record.revision,status:item._kbEditStatus,sourceText:typeof sourceText==='string'?sourceText:'',sourceVersion:record.baseReportVersion,sectionTitle:record.sectionTitle,sourceIndex:record.sourceIndex};
    if(reason)item.correction.reason=reason;
  }
  return item;
}
function materialRetainedCorrections(project,key){
  if(!project)return [];
  return materialEditRecords(key).filter(function(record){
    return !record.deleted&&record.sourceIndex!==null&&!materialSourceCurrent(record,project,(project.kb||[])[record.sectionIndex],record.sectionIndex);
  }).map(function(record){
    var reason=materialValueEqual(record.baseReportVersion,project.baseReportVersion===undefined?null:project.baseReportVersion)?'source_changed':'base_version_changed';
    return materialProjectedEdit(record,record.sourceItem,true,reason);
  });
}
function materialEffectiveKnown(project,sectionIndex,key){
  var section=project&&Array.isArray(project.kb)&&project.kb[sectionIndex];
  if(!section||!Number.isInteger(sectionIndex)||!Array.isArray(section.known))return [];
  key=key===undefined?(typeof cur==='undefined'?'':cur):key;
  var result=section.known.map(function(raw,index){
    var record=materialSourceEdit(project,sectionIndex,index,key);
    return record&&!record.deleted?materialProjectedEdit(record,raw,false):raw;
  });
  var uniqueTitle=project.kb.filter(function(candidate){return candidate&&candidate.t===section.t;}).length===1;
  if(uniqueTitle)materialEditRecords(key).forEach(function(record){
    if(!record.deleted&&record.sourceIndex===null&&record.sourceItem===null&&record.baseReportVersion===null&&record.sectionTitle===section.t)result.push(materialProjectedEdit(record,null,false));
  });
  materialRetainedCorrections(project,key).forEach(function(item){
    var matching=project.kb.findIndex(function(candidate){return candidate&&candidate.t===item.correction.sectionTitle;});
    var target=matching>=0?matching:project.kb.findIndex(function(candidate){return candidate&&Array.isArray(candidate.known);});
    if(target===sectionIndex)result.push(item);
  });
  return result;
}
function materialKnownChunk(item,topic,index){
  var structured=item&&typeof item==='object'?item:null;
  var value=structured?structured.text:item;
  var text=typeof value==='string'?value:typeof value==='number'||typeof value==='boolean'?String(value):'';
  var chunk={id:topic+':'+index,topic:topic,tags:typeof topicTags==='function'?topicTags(topic):[],text:text,cite:topic,
    origin:structured?(structured.origin||'ai'):'ai',nature:structured?(structured.nature||'base'):'base'};
  ['src','source','sourceFile','sources','url','urls','quote','account','ts','originalId','originalSha256','materialId','_kbEditId','_kbRevision','_kbEditStatus','correction','relatedSource','verificationStatus'].forEach(function(field){if(structured&&structured[field]!==undefined)chunk[field]=structured[field];});
  if(structured&&structured.correction&&typeof structured.correction.sourceText==='string')chunk.tags=chunk.tags.concat([structured.correction.sourceText]);
  chunk.item=item;
  return chunk;
}
function knowledgeMaterialCorpus(key,project){
  if(!key||!project||!Array.isArray(project.kb))return [];
  var chunks=[];
  project.kb.forEach(function(section,index){
    if(!section)return;
    materialEffectiveKnown(project,index,key).forEach(function(item,i){
      var chunk=materialKnownChunk(item,section.t||'',i);if(chunk.text.trim())chunks.push(chunk);
      (item&&Array.isArray(item.annotations)?item.annotations:[]).forEach(function(annotation,ai){
        var value=Object.assign({},annotation),context={sourceText:typeof item.text==='string'?item.text:'',sourceVersion:project.baseReportVersion||null,sectionTitle:section.t||''};
        if(value.nature==='fix'){value.correction=Object.assign({status:'needs_review',reason:'legacy_annotation'},context);value._kbEditStatus='needs_review';}
        else value.relatedSource=context;
        var extra=materialKnownChunk(value,section.t||'',i+':annotation:'+ai);extra._materialAnnotation=true;if(extra.text.trim())chunks.push(extra);
      });
    });
  });
  materialRetainedCorrections(project,key).forEach(function(item){if(!chunks.some(function(chunk){return chunk._kbEditId===item._kbEditId;}))chunks.push(materialKnownChunk(item,item.correction.sectionTitle,'retained:'+item._kbEditId));});
  var files=typeof KB_FILE_CHUNKS!=='undefined'&&KB_FILE_CHUNKS&&KB_FILE_CHUNKS[key];
  var tombs=typeof UPLOAD_TOMBS!=='undefined'&&UPLOAD_TOMBS||{};
  var receipts=typeof UPLOADS!=='undefined'&&UPLOADS&&UPLOADS[key];
  (Array.isArray(files)?files:[]).forEach(function(file){
    if(!file||typeof file.text!=='string'||!file.text.trim()||file.deleted||file.pending||file.parseFailed)return;
    var tomb=tombs[key+'::'+(file.cite||file.filename||'')];if(tomb&&(!file.ts||file.ts<=tomb))return;
    var receipt=file.originalId&&Array.isArray(receipts)?receipts.find(function(row){return row.originalId===file.originalId&&!row.deleted&&!row.pending&&!row.parseFailed&&!tombs[key+'::'+row.name];}):null;
    if(file.originalId&&typeof UPLOADS!=='undefined'&&!receipt)return;
    var item=Object.assign({},file);if(!item.topic)item.topic='上传材料';if(!item.cite)item.cite=file.filename||'上传材料';
    if(receipt){item.sourceFile=receipt.name;item.cite=receipt.name;item.account=item.account||receipt.account;item.ts=item.ts||receipt.ts;}
    item.origin=item.origin||'user';item.nature=item.nature||'support';item._independentMaterial=true;chunks.push(item);
  });
  function source(item){return item.src||item.source||item.cite||'';}
  function sameRecord(a,b){return a.text.trim()===b.text.trim()&&((a.originalId&&a.originalId===b.originalId)||(a.materialId&&a.materialId===b.materialId)||(source(a)&&source(a)===source(b)));}
  return chunks.filter(function(chunk){
    if(chunk._kbEditId||chunk._independentMaterial)return true;
    return !chunks.some(function(other){return other._independentMaterial&&((chunk.originalId&&chunk.originalId===other.originalId)||(chunk.materialId&&chunk.materialId===other.materialId)||(chunk._materialAnnotation&&sameRecord(chunk,other)));});
  }).map(function(chunk){delete chunk._materialAnnotation;delete chunk._independentMaterial;return chunk;});
}

function materialValidateEditReceipt(record,body){
  return record&&typeof record==='object'&&typeof record.id==='string'&&record.id&&
    Number.isInteger(record.revision)&&record.revision>body.expectedRevision&&
    record.status==='edited'&&typeof record.account==='string'&&typeof record.ts==='number'&&isFinite(record.ts)&&
    (body.sourceIndex===null||record.sectionIndex===body.sectionIndex)&&record.sectionTitle===body.sectionTitle&&record.sourceIndex===body.sourceIndex&&
    materialValueEqual(record.sourceItem,body.sourceItem)&&materialValueEqual(record.baseReportVersion,body.baseReportVersion)&&
    (body.editId===null||record.id===body.editId)&&
    (body.action==='delete'?record.deleted===true:record.text===body.text&&record.deleted!==true);
}
async function materialRequestEdit(body){
  var controller=typeof AbortController==='function'?new AbortController():null;
  var timer=controller?setTimeout(function(){controller.abort();},20000):null;
  try{
    var response=await fetch('/api/kb-edit',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller?controller.signal:undefined});
    var result=await response.json();
    if(!response.ok||!result||!result.ok)throw new Error(result&&result.message||'保存未完成，请重试。');
    if(!materialValidateEditReceipt(result.record,body))throw new Error('保存回执不完整，请刷新确认后重试。');
    return result.record;
  }catch(error){if(error&&error.name==='AbortError')throw new Error('保存响应超时，草稿已保留；请刷新确认云端结果后重试。');if(error&&error.name==='TypeError')throw new Error('连接中断，草稿已保留，请稍后重试。');throw error;}
  finally{if(timer!==null)clearTimeout(timer);}
}
function materialEditBody(key,sectionIndex,effectiveIndex,text){
  var project=PROJECTS[key],section=project&&project.kb&&project.kb[sectionIndex];
  if(!section||!Array.isArray(section.known))throw new Error('资料分区已变化，请刷新后重试。');
  var item=effectiveIndex===null?null:materialEffectiveKnown(project,sectionIndex,key)[effectiveIndex];
  var previous=item&&materialEditRecord(key,item);
  if(item&&item._kbEditStatus==='needs_review')throw new Error('原材料已更新，请选择当前原文重新核对后保存为新的纠正。');
  if(effectiveIndex!==null&&item===undefined)throw new Error('原资料已变化，请重新打开。');
  return {projectKey:key,sectionIndex:sectionIndex,sectionTitle:section.t,
    sourceIndex:previous?previous.sourceIndex:effectiveIndex,
    sourceItem:previous?previous.sourceItem:effectiveIndex===null?null:section.known[effectiveIndex],
    baseReportVersion:previous?previous.baseReportVersion:effectiveIndex===null?null:project.baseReportVersion===undefined?null:project.baseReportVersion,
    editId:previous?previous.id:null,expectedRevision:previous?previous.revision:0,
    text:text,resetGen:typeof RESET_GEN==='undefined'?null:RESET_GEN};
}
function materialApplyReceipt(key,record,epoch){
  if(epoch!==(typeof _authEpoch==='number'?_authEpoch:0))return false;
  if(typeof KB_EDITS==='undefined')return false;
  if(!KB_EDITS[key])KB_EDITS[key]={};KB_EDITS[key][record.id]=record;
  if(typeof window!=='undefined'){window._serverRestoreSeq=(window._serverRestoreSeq||0)+1;window._serverSyncLock=false;}
  return true;
}
async function materialSaveText(key,sectionIndex,effectiveIndex,text){
  text=String(text||'').trim();if(!text)throw new Error('内容不能为空');
  var project=PROJECTS[key],epoch=typeof _authEpoch==='number'?_authEpoch:0;
  var body=materialEditBody(key,sectionIndex,effectiveIndex,text);
  if(effectiveIndex===null){
    var duplicate=materialEffectiveKnown(project,sectionIndex,key).find(function(item){return item&&item._kbEditId&&item.text===text;});
    if(duplicate)return materialEditRecord(key,duplicate);
  }
  var record=await materialRequestEdit(body);
  if(!materialApplyReceipt(key,record,epoch))throw new Error('登录状态已变化，保存结果未载入。');
  return record;
}
async function materialDeleteRevision(key,record){
  var epoch=typeof _authEpoch==='number'?_authEpoch:0;
  var sectionIndex=record.sectionIndex,project=PROJECTS[key];
  if(record.sourceIndex===null&&project&&Array.isArray(project.kb)){
    var indices=[];project.kb.forEach(function(section,index){if(section.t===record.sectionTitle)indices.push(index);});
    if(indices.length===1)sectionIndex=indices[0];
  }
  var body={projectKey:key,sectionIndex:sectionIndex,sectionTitle:record.sectionTitle,sourceIndex:record.sourceIndex,sourceItem:record.sourceItem,
    baseReportVersion:record.baseReportVersion,editId:record.id,expectedRevision:record.revision,action:'delete',resetGen:typeof RESET_GEN==='undefined'?null:RESET_GEN};
  var result=await materialRequestEdit(body);
  if(!materialApplyReceipt(key,result,epoch))throw new Error('登录状态已变化，保存结果未载入。');
  return result;
}
function materialEscape(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
var MATERIAL_DRAFT=null;
function materialResetSession(){
  MATERIAL_DRAFT=null;
  if(typeof kbEditSession!=='undefined')kbEditSession=null;
  if(typeof window!=='undefined'){window._pendingConflicts=null;window._opsKbEditContext=null;}
  if(typeof document==='undefined')return;
  ['kbEditorPanel','kbEditorDiscard','kbDetailModal','kbHistoryDrawer','conflictModal','ragCommitModal'].forEach(function(id){var node=document.getElementById(id);if(node&&typeof node.remove==='function')node.remove();});
  if(typeof document.querySelectorAll==='function')Array.from(document.querySelectorAll('.modal-layer')).forEach(function(node){if(typeof node.remove==='function')node.remove();});
}
function openLongTermMaterial(key,text){
  var project=PROJECTS[key];if(!project||!Array.isArray(project.kb)||!project.kb.length){toast('请先建立资料分区');return;}
  MATERIAL_DRAFT={key:key,epoch:typeof _authEpoch==='number'?_authEpoch:0,busy:false};
  openModal('保存为长期材料 · '+project.city,
    '<p>以下内容来自你的输入。保存后可在新会话中检索，内容仍需核验。请选择追加资料，或明确纠正其中一条。</p>'+
    '<label for="materialSection">资料分区</label><select id="materialSection" onchange="materialRefreshTargets()">'+project.kb.map(function(section,index){return '<option value="'+index+'">'+materialEscape(section.t)+'</option>';}).join('')+'</select>'+
    '<label for="materialTarget">保存方式</label><select id="materialTarget"></select>'+
    '<label for="materialText">确认保存的原文</label><textarea id="materialText" rows="8" style="width:100%;box-sizing:border-box">'+materialEscape(text)+'</textarea><p id="materialSaveError" role="alert"></p>',
    '<button class="secondary-button" onclick="closeModal()">取消</button><button id="materialSaveButton" class="primary-button" onclick="saveLongTermMaterial()">确认保存到云端</button>');
  materialRefreshTargets();
}
function materialRefreshTargets(){
  var draft=MATERIAL_DRAFT,sectionNode=document.getElementById('materialSection'),target=document.getElementById('materialTarget');if(!draft||!sectionNode||!target)return;
  var index=Number(sectionNode.value),project=PROJECTS[draft.key];
  draft.sectionIndex=index;draft.items=materialEffectiveKnown(project,index,draft.key);
  target.innerHTML='<option value="-1">追加为独立补充材料</option>'+draft.items.map(function(item,i){var text=item&&typeof item==='object'?item.text:item;return '<option value="'+i+'"'+(item&&item._kbEditStatus==='needs_review'?' disabled':'')+'>'+(item&&item._kbEditStatus==='needs_review'?'旧修订（请另选当前原文）：':'纠正：')+materialEscape(String(text||'').slice(0,90))+'</option>';}).join('');
}
async function saveLongTermMaterial(){
  var draft=MATERIAL_DRAFT;if(!draft||draft.busy)return;
  var errorNode=document.getElementById('materialSaveError'),button=document.getElementById('materialSaveButton');
  try{
    if(draft.epoch!==(typeof _authEpoch==='number'?_authEpoch:0))throw new Error('登录状态已变化，请重新打开保存。');
    var target=Number(document.getElementById('materialTarget').value),text=document.getElementById('materialText').value;
    var current=materialEffectiveKnown(PROJECTS[draft.key],draft.sectionIndex,draft.key);
    if(target>=0&&!materialValueEqual(current[target],draft.items[target]))throw new Error('该资料已更新，请重新打开后再纠正。');
    draft.busy=true;if(button)button.disabled=true;
    await materialSaveText(draft.key,draft.sectionIndex,target<0?null:target,text);
    if(draft.epoch!==(typeof _authEpoch==='number'?_authEpoch:0)||MATERIAL_DRAFT!==draft)return;
    closeModal();MATERIAL_DRAFT=null;
    if(typeof AUTH!=='undefined'&&AUTH&&AUTH.scope==='admin'&&typeof renderOpsV2==='function')renderOpsV2();else if(typeof render==='function')render();
    toast('已保存到云端，新会话可检索这条材料；内容仍需核验。');
  }catch(error){if(errorNode)errorNode.textContent=error.message||'尚未保存，请重试';}
  finally{draft.busy=false;if(button)button.disabled=false;}
}
