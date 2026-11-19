/* Bounded material comparison transport; a broken or empty stream is never a passed check. */
function kbVerifyRetryButton(){return '<button type="button" class="kb-answer-retry" onclick="kbVerifyMaterial()">重新校验这批材料</button>';}
function kbVerifyCleanup(ctx){
  if(window._verifyRequestContext===ctx){
    var button=document.querySelector('#kbIngestActions [data-action="verify"]');
    if(button){button.disabled=false;button.textContent='🔍 校验材料可信度';}
  }
  kbFinishRequest(ctx);
}
function kbVerifySetupFailure(ctx,container,error){
  try{
    if(!ctx.cancelled&&kbContextCurrent(ctx)){
      var node=document.createElement('div');node.className='message';
      node.innerHTML='<div class="message-bubble"><p class="kb-answer-error">校验未能开始，上传材料已保留，请重试。</p>'+kbVerifyRetryButton()+'</div>';
      (document.getElementById('kbConv')||container).appendChild(node);
      kbChatPush('ai',node.outerHTML,{context:ctx,error:true,plainText:''});
    }
  }finally{kbVerifyCleanup(ctx);}
}
async function kbVerifyMaterialStream(options){
  var ctx=options.context,container=options.container,ansNode=options.answer,bubble=options.bubble,body=options.body;
  var reader=null,timer=null,abortListener=null,text='',terminal=false,complete=false;
  ctx.materialVerification=true;ctx.query=options.query;ctx.answerNode=ansNode;ctx.answerBody=body;ctx.outputText='';
  function current(){return !ctx.cancelled&&kbContextCurrent(ctx);}
  function requireCurrent(){if(!current()){var error=new Error('已离开原校验会话');error.name='AbortError';throw error;}}
  function attach(){
    requireCurrent();container=document.getElementById('kbConv')||container;
    kbProgressAttach(ctx);if(ansNode.parentNode!==container)container.appendChild(ansNode);
  }
  var deadline=new Promise(function(_resolve,reject){timer=setTimeout(function(){
    var error=new Error('校验等待超时，请重试；原材料已保留。');error.name='VerificationTimeout';reject(error);
    if(ctx.controller)ctx.controller.abort();
  },120000);});
  var aborted=new Promise(function(_resolve,reject){
    if(ctx.controller){abortListener=function(){var error=new Error('校验已停止');error.name='AbortError';reject(error);};ctx.controller.signal.addEventListener('abort',abortListener,{once:true});}
  });
  function wait(promise){return Promise.race([promise,deadline,aborted]);}
  function event(line){
    if(line.indexOf('data:')!==0)return;
    var raw=line.slice(5).trim();if(!raw||raw==='[DONE]')return;
    var value;try{value=JSON.parse(raw);}catch(_){throw new Error('校验响应格式不完整，请重试。');}
    if(value.error)throw new Error('本次校验未完成，请重试；原材料已保留。');
    if(value.type==='kb_sources'){ctx.sources=kbSafeSources(value.sources);ctx.receivedSources=true;kbRenderSources(ctx.sources,ctx);return;}
    var choice=(value.choices||[])[0]||{},delta=choice.delta||{};
    if(choice.finish_reason&&choice.finish_reason!=='stop')throw new Error('校验结果被截断，请重试；未标记为已通过。');
    if(choice.finish_reason==='stop')terminal=true;
    if(delta.content){
      text+=delta.content;ctx.outputText=text;attach();
      kbProgressUpdate(ctx,2,'正在接收核对结果','逐条核对中，完整结束后才汇总；一致不代表真实。');
      body.innerHTML='<p>'+renderMarkdown(text)+'</p>';
    }
  }
  try{
    kbProgressCreate(ctx,container,options.chunks.length);
    kbProgressUpdate(ctx,1,'正在校验上传材料','已保存的上传原文将与本工作区智库比对，可停止本次校验。');
    attach();
    var response=await wait(fetch(KB_API,{method:'POST',credentials:'same-origin',signal:ctx.controller?ctx.controller.signal:undefined,
      headers:{'Content-Type':'application/json'},body:JSON.stringify(options.request)}));
    requireCurrent();
    if(!response.ok)throw new Error(response.status===409?'文件保存状态或上传批次已变化，请刷新后重新校验。':response.status===413?'材料较长，请分批校验；原文件已保留。':'校验服务暂时不可用（'+response.status+'），请重试。');
    if(!response.body||!response.body.getReader)throw new Error('未收到可读取的校验响应，请重试。');
    reader=response.body.getReader();var decoder=new TextDecoder(),buffer='';
    while(true){
      var chunk=await wait(reader.read());requireCurrent();
      if(chunk.done){buffer+=decoder.decode();if(buffer.trim())buffer.split('\n').forEach(event);break;}
      buffer+=decoder.decode(chunk.value,{stream:true});var lines=buffer.split('\n');buffer=lines.pop();lines.forEach(event);
    }
    requireCurrent();
    if(!terminal||!text.trim())throw new Error('校验结果未完整返回，请重试；未标记为已通过。');
    attach();options.finish(text);complete=true;return true;
  }catch(error){
    if(current()){
      attach();
      body.innerHTML=(text?'<p>'+renderMarkdown(text)+'</p>':'')+'<p class="kb-answer-error">'+kbEscape(error.name==='AbortError'?'校验连接已中断，请重试。':error.message||'校验未完成，请重试。')+'</p>'+kbVerifyRetryButton();
      kbChatPush('ai',ansNode.outerHTML,{context:ctx,error:true,plainText:''});
    }
    return false;
  }finally{
    if(timer!==null)clearTimeout(timer);
    if(abortListener&&ctx.controller)ctx.controller.signal.removeEventListener('abort',abortListener);
    if(!complete&&ctx.controller)ctx.controller.abort();
    if(reader&&reader.cancel)try{Promise.resolve(reader.cancel()).catch(function(){});}catch(_){}
    kbVerifyCleanup(ctx);
  }
}
