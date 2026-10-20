/* Client docking workspace: a selected demand, its candidates and saved events. */
var DOCKING_VIEW_STATE={epoch:null,search:'',filter:'all',selected:null};
function dockingViewState(){
  var epoch=typeof _authEpoch==='number'?_authEpoch:0;
  if(DOCKING_VIEW_STATE.epoch!==epoch){if(DOCKING_VIEW_STATE.epoch!==null)window.__projOpen=null;DOCKING_VIEW_STATE={epoch:epoch,search:'',filter:'all',selected:null};}
  return DOCKING_VIEW_STATE;
}
function dockingText(value){return escapeChainText(value==null?'':String(value));}
function dockingAction(name,args){return dockingText(name+'('+args.map(function(value){return JSON.stringify(value);}).join(',')+')');}
function dockingDemandKeys(){
  var keys=typeof cityKeys==='function'?cityKeys():Object.keys(PROJECTS||{});
  return keys.filter(function(key){var p=PROJECTS[key];if(!p||p.isDemand!==true)return false;return typeof demandSubmissionState==='function'?demandSubmissionState(key)==='submitted':p.submissionState==='submitted'||(typeof DEMANDS!=='undefined'&&DEMANDS.some(function(d){return d.projKey===key;}));});
}
function dockingClues(key){return typeof visibleClues==='function'?visibleClues(PROJECTS[key],key):[];}
function dockingEvents(key){return typeof dockingLogRecords==='function'?dockingLogRecords(key):[];}
function dockingContactEvents(key){return dockingEvents(key).filter(function(event){return event.kind==='contact_log'||(!event.kind&&event.note);});}
function dockingSummary(key){
  var clues=dockingClues(key),events=dockingEvents(key),contacts=dockingContactEvents(key);
  var requested=clues.filter(function(c){return ['requested','processing','needs_info'].indexOf(dockingClueState(key,c).key)>=0;}).length;
  var pending=clues.filter(function(c){return dockingClueState(key,c).canRequest;}).length;
  var latest=events.reduce(function(ts,e){var value=Number(e.ts)||0;return Math.max(ts,value);},Number(PROJECTS[key].submittedAt)||0);
  return {clues:clues,events:events,contacts:contacts,requested:requested,pending:pending,latest:latest};
}
function dockingDate(value,short){var n=Number(value);if(!n||!isFinite(n))return '时间未记录';var d=new Date(n);if(isNaN(d.getTime()))return '时间未记录';return d.toLocaleString('zh-CN',short?{month:'numeric',day:'numeric'}:{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
function dockingBadge(label,tone){return '<span class="docking-badge" data-tone="'+dockingText(tone||'neutral')+'">'+dockingText(label)+'</span>';}
function dockingDemandStatus(key){return dockingIntakeStatus(PROJECTS[key]);}

function dockingFilteredKeys(keys){
  var ui=dockingViewState(),query=ui.search.trim().toLocaleLowerCase();
  return keys.filter(function(key){
    var p=PROJECTS[key],summary=dockingSummary(key),spec=p.demandSpec||{};
    if(ui.filter==='receiving'&&dockingIntake(PROJECTS[key]).status!=='submitted')return false;
    if(ui.filter==='needs_info'&&dockingIntake(PROJECTS[key]).status!=='needs_info')return false;
    if(ui.filter==='verification'&&!summary.pending&&!summary.requested)return false;
    if(ui.filter==='followed'&&!summary.contacts.length)return false;
    var words=[industryDemandProjectTitle(p),p.sourceAnalysisTopic||p.topic,spec.description,spec.conditions].concat(summary.clues.map(function(c){return c.name;})).join(' ').toLocaleLowerCase();
    return !query||words.indexOf(query)>=0;
  });
}
function dockingSelectedKey(keys){
  var ui=dockingViewState(),selected=ui.selected||window.__projOpen;
  if(keys.indexOf(selected)<0)selected=keys[0]||null;
  ui.selected=selected;return selected;
}
function dockingWorkspacePage(){
  var keys=dockingDemandKeys(),ui=dockingViewState(),filtered=dockingFilteredKeys(keys),key=dockingSelectedKey(filtered);
  var candidates=0,requested=0,contacts=0;
  keys.forEach(function(k){var s=dockingSummary(k);candidates+=s.clues.length;requested+=s.requested;contacts+=s.contacts.length;});
  var metrics=[[keys.length,'招商需求','按具体诉求独立跟进'],[candidates,'候选企业','仅统计已保存线索'],[requested,'待处理核验','已申请且尚未完成'],[contacts,'跟进记录','来自已保存的沟通记录']];
  return '<section id="dockingWorkspace" class="docking-workspace" aria-label="招商对接工作区"><header class="docking-header"><div><span class="docking-kicker">INVESTMENT COOPERATION</span><h1>招商对接</h1><p>让每一条线索，都有下一步。</p></div><div class="docking-header-actions"><button class="docking-button is-primary" onclick="openDirectDemandComposer()">提交招商需求</button><button class="docking-button is-quiet" onclick="go(\'report\')">查看产业分析 <span aria-hidden="true">↗</span></button></div></header><div class="docking-metrics">'+metrics.map(function(m){return '<div class="docking-metric"><small>'+m[1]+'</small><strong>'+m[0]+'</strong><span>'+m[2]+'</span></div>';}).join('')+'</div>'+
    (!keys.length?'<div class="docking-empty"><span class="docking-kicker">START WITH A DEMAND</span><h2>从一条具体的招商需求开始</h2><p>已有明确需求可以直接提交，也可以从产业分析报告中选择一条招引建议形成需求。</p><button class="docking-button is-primary" onclick="openDirectDemandComposer()">提交招商需求</button></div>':
    '<div class="docking-body"><aside class="docking-list-panel" aria-label="招商需求列表"><div class="docking-list-tools"><label for="dockingDemandSearch">查找需求</label><input id="dockingDemandSearch" type="search" autocomplete="off" placeholder="需求名称、企业或关键词" value="'+dockingText(ui.search)+'" oninput="dockingSetSearch(this.value)"><div class="docking-filters" role="group" aria-label="需求筛选">'+[['all','全部'],['receiving','待受理'],['needs_info','待补充']].map(function(f){return '<button type="button" data-filter="'+f[0]+'" class="'+(ui.filter===f[0]?'is-active':'')+'" aria-pressed="'+(ui.filter===f[0])+'" onclick="dockingSetFilter(\''+f[0]+'\')">'+f[1]+'</button>';}).join('')+'</div></div><div id="dockingListResults" class="docking-demand-list">'+dockingDemandListHtml(filtered,key)+'</div></aside><main id="dockingDetailHost" class="docking-detail-panel" data-demand-key="'+dockingText(key||'')+'" aria-label="所选需求详情" tabindex="-1">'+dockingDetailHtml(key)+'</main></div>')+'</section>';
}
function dockingDemandListHtml(keys,selected){
  if(!keys.length)return '<div class="docking-inline-empty"><strong>没有符合条件的需求</strong><p>换一个关键词，或查看全部需求。</p><button class="docking-button is-quiet" onclick="dockingClearFilters()">清除筛选</button></div>';
  return keys.map(function(key){var p=PROJECTS[key],s=dockingSummary(key),status=dockingDemandStatus(key);return '<button type="button" class="docking-demand-row '+(key===selected?'is-active':'')+'" aria-current="'+(key===selected?'true':'false')+'" onclick="'+dockingAction('dockingSelect',[key])+'"><span class="docking-row-title">'+dockingText(industryDemandProjectTitle(p))+'</span><span class="docking-row-meta">'+dockingText(p.city)+' · '+dockingDate(s.latest,true)+'</span>'+dockingBadge(status.label,status.tone)+'<span class="docking-row-summary">'+s.clues.length+' 家候选 <span aria-hidden="true">·</span> '+s.contacts.length+' 条跟进</span></button>';}).join('');
}
function dockingDetailHtml(key){
  if(!key)return '<div class="docking-empty"><h2>选择一条需求</h2><p>这里会显示对应的企业、依据和跟进记录。</p></div>';
  var p=PROJECTS[key],s=dockingSummary(key),status=dockingDemandStatus(key),spec=p.demandSpec||{},priority=p.selectedPriority||{},ui=dockingViewState();
  var sourceTopic=p.sourceAnalysisTopic||p.topic,description=spec.description||'';
  if(!description){var demand=(typeof DEMANDS!=='undefined'?DEMANDS:[]).find(function(d){return d.projKey===key;});description=demand&&demand.need||'';}
  var intro=description?'<p>'+dockingText(description)+'</p>':'<p class="docking-muted">历史需求尚未单独填写具体诉求，可查看原报告核对。</p>';
  var direct=p.demandOrigin==='direct'||spec.source==='user_direct';
  var origin=direct?'<dl><dt>提交方式</dt><dd>机构直接提交</dd><dt>需求性质</dt><dd>提交人说明的招商诉求</dd>'+(p.submittedAt?'<dt>提交时间</dt><dd>'+dockingDate(p.submittedAt)+'</dd>':'')+'</dl>':'<dl><dt>来源分析</dt><dd>'+dockingText(sourceTopic)+'</dd>'+(priority.focus?'<dt>原始建议</dt><dd>'+dockingText(priority.focus)+'</dd>':'')+(p.submittedAt?'<dt>提交时间</dt><dd>'+dockingDate(p.submittedAt)+'</dd>':'')+'</dl>';
  return '<header class="docking-detail-head"><div><span class="docking-kicker">DEMAND WORKSPACE</span><h2>'+dockingText(industryDemandProjectTitle(p))+'</h2><div class="docking-detail-meta">'+dockingBadge(status.label,status.tone)+'<span>'+dockingText(p.city)+' · 独立需求</span></div></div><div class="docking-detail-actions"><button class="docking-button is-primary" onclick="'+dockingAction('openDockingLog',[key])+'">记录跟进</button>'+(direct?'':'<button class="docking-button is-quiet" onclick="'+dockingAction('dockingOpenReport',[key])+'">来源报告</button>')+'</div></header>'+dockingReceivingHtml(key)+'<div class="docking-overview-grid"><section class="docking-block"><h3>具体招引诉求</h3>'+intro+(spec.conditions?'<div class="docking-condition"><strong>补充条件</strong><p>'+dockingText(spec.conditions)+'</p></div>':'')+((spec.contactName||spec.contactMethod)?'<div class="docking-condition"><strong>需求对接人</strong><p>'+dockingText([spec.contactName,spec.contactMethod].filter(Boolean).join(' · '))+'</p></div>':'')+'</section><section class="docking-block"><h3>需求来源</h3>'+origin+(Array.isArray(priority.sources)&&priority.sources.length?'<details><summary>查看建议依据 · '+priority.sources.length+' 条</summary>'+dockingEvidenceHtml(priority.sources)+'</details>':'')+'</section></div><section class="docking-candidates"><div class="docking-section-head"><div><h3>候选企业 <span>'+s.clues.length+'</span></h3><p>查看产品依据与匹配理由，再记录核验和沟通情况。</p></div><button class="docking-button is-quiet" onclick="'+dockingAction('addClueManual',[key])+'">录入企业</button></div>'+(s.clues.length?'<div class="docking-clue-grid">'+s.clues.map(function(c){return dockingClueHtml(key,c);}).join('')+'</div>':'<div class="docking-inline-empty"><strong>尚未收到候选企业</strong><p>资源团队可围绕这条具体诉求核对并推送企业；也可录入已有企业线索。未出现候选不代表不存在相关企业。</p></div>')+'</section><section class="docking-records"><div class="docking-section-head"><div><h3>处理与跟进记录 <span>'+s.events.length+'</span></h3><p>按实际保存时间展示，记录本身不代表外部事实已核实。</p></div></div>'+dockingTimelineHtml(key,s.events)+'</section>';
}
function dockingEvidenceHtml(sources){
  return sources.filter(function(row){return row&&typeof row.quote==='string'&&row.quote.trim();}).map(function(row){
    var href='';try{var url=new URL(row.url);if(['https:','http:'].indexOf(url.protocol)>=0&&!url.username&&!url.password)href=url.href;}catch(_){}
    return '<article class="docking-source"><p>'+dockingText(row.quote)+'</p>'+(href?'<a class="docking-evidence-link" href="'+dockingText(href)+'" target="_blank" rel="noopener noreferrer">'+dockingText(row.title||row.label||'查看原始来源')+' ↗</a>':'<span class="docking-muted">未提供可访问的来源链接</span>')+'</article>';
  }).join('');
}
function dockingClueHtml(key,c){
  var state=dockingClueState(key,c),evidence=Array.isArray(c.evidence)?c.evidence:[],contacts=dockingContactEvents(key).filter(function(e){return e.clueId===c.id;}),hasId=typeof c.id==='string'&&!!c.id;
  var reason=c.reason||c.fit||'',meta=[c.kind,c.region].filter(Boolean).join(' · ');
  var manualSource='';try{var sourceUrl=new URL(c.sourceURL||'');if(sourceUrl.protocol==='https:'||sourceUrl.protocol==='http:')manualSource='<p><a class="docking-evidence-link" target="_blank" rel="noopener noreferrer" href="'+dockingText(sourceUrl.href)+'">手工录入的来源链接 ↗</a><br><small>链接内容尚未独立核实。</small></p>';}catch(_){}
  var evidenceRows=[];evidence.forEach(function(e){if(!e)return;var urls=Array.isArray(e.urls)?e.urls:[e.url];evidenceRows.push({quote:e.quote||'',url:urls[0]||'',title:e.title||e.label||''});});
  return '<article class="docking-clue-card"><header><div><strong>'+dockingText(c.name||'名称未记录')+'</strong><div class="docking-clue-meta">'+dockingText(meta||'业务与地域信息待补充')+'</div></div>'+dockingBadge(state.label,state.tone)+'</header><div class="docking-clue-reason"><small>与本条需求的关联</small><p>'+dockingText(reason||'尚未保存匹配理由，需要补充产品信息与具体需求的对应依据。')+'</p></div><div class="docking-clue-evidence"><details><summary>产品依据与待核问题</summary>'+(evidenceRows.length?dockingEvidenceHtml(evidenceRows):'<p class="docking-muted">暂无已保存的产品原文。请先补充来源再判断适配性。</p>')+manualSource+(Array.isArray(c.questions)&&c.questions.length?'<ul>'+c.questions.map(function(q){return '<li>'+dockingText(q)+'</li>';}).join(''):'')+'<p class="docking-muted">'+dockingText(c.signal?'线索记录（待核）：'+c.signal:'投资意向尚未取得独立核验记录。')+'</p></details></div>'+(c.verificationRequest&&c.verificationRequest.reply?'':'<p class="docking-clue-state">'+dockingText(state.detail)+'</p>')+dockingVerificationFeedbackHtml(c)+'<div class="docking-clue-actions">'+(hasId&&state.canRequest?'<button class="docking-button is-quiet" onclick="'+dockingAction('requestVerify',[key,c.id])+'">申请核验</button>':'')+'<button class="docking-button" onclick="'+dockingAction('openDockingLog',[key,hasId?c.id:null])+'">记录跟进'+(contacts.length?' · '+contacts.length:'')+'</button>'+(hasId?'<button class="docking-button is-quiet" onclick="'+dockingAction('showContactCard',[key,c.id])+'">联系资料</button><button class="docking-button is-quiet" onclick="'+dockingAction('editClue',[key,c.id])+'">'+(dockingIsManualClue(c)?'编辑资料':'企业资料')+'</button>':'')+'</div></article>';
}
function dockingTimelineHtml(key,events){
  if(!events.length)return '<div class="docking-inline-empty"><strong>还没有跟进记录</strong><p>完成电话、拜访或材料沟通后，记录具体情况，便于团队接续跟进。</p></div>';
  var types={call:'电话沟通',visit:'拜访交流',email:'邮件沟通',material:'材料往来',note:'跟进备注'};
  return '<div class="docking-timeline">'+events.map(function(e){var isNew=e.contract==='docking-action-v1',kind=({verification_request:'申请核验',review_demand:'管理端受理反馈',supplement_demand:'客户补充资料',review_verification:'企业核验反馈',advance_stage:'管理端阶段更新'})[e.kind]||types[e.type]||'历史记录';var c=dockingClues(key).find(function(c){return c.id===e.clueId;});return '<article><div class="docking-event-top"><span class="docking-event-kind">'+kind+'</span><time>'+dockingDate(e.ts)+'</time></div>'+((e.clueName||(c&&c.name))?'<strong class="docking-event-company">'+dockingText(e.clueName||c.name)+'</strong>':'')+'<p>'+dockingText(e.note||(e.kind==='verification_request'?'已提交核验申请，等待资源团队处理。':Array.isArray(e.files)&&e.files.length?'已保存附件。':'未填写记录正文。'))+'</p><div class="docking-event-actor">'+dockingText(e.actor||'记录人未保存')+' · '+(isNew?(e.actorRole==='admin'?'管理端 · 已保存反馈':'已保存记录'):'历史记录，来源待复核')+'</div>'+(Array.isArray(e.files)&&e.files.length?'<div class="docking-event-files">'+e.files.map(function(f,i){return '<button class="docking-button is-quiet" onclick="'+dockingAction('dockingDownloadEventFile',[key,e.id||'',Number(e.ts)||0,i])+'">附件 · '+dockingText(f.name||'文件')+'</button>';}).join('')+'</div>':'')+'</article>';}).join('')+'</div>';
}
function dockingSelect(key){if(dockingDemandKeys().indexOf(key)<0)return;var ui=dockingViewState();ui.selected=key;window.__projOpen=key;dockingRefreshPanels();}
function dockingSetSearch(value){dockingViewState().search=String(value||'');dockingRefreshPanels();}
function dockingSetFilter(value){if(['all','receiving','needs_info','verification','followed'].indexOf(value)<0)return;dockingViewState().filter=value;dockingRefreshPanels();}
function dockingClearFilters(){var ui=dockingViewState();ui.search='';ui.filter='all';var search=document.getElementById('dockingDemandSearch');if(search)search.value='';dockingRefreshPanels();}
function dockingRefreshPanels(){
  var keys=dockingFilteredKeys(dockingDemandKeys()),key=dockingSelectedKey(keys),list=document.getElementById('dockingListResults'),detail=document.getElementById('dockingDetailHost');
  if(list)list.innerHTML=dockingDemandListHtml(keys,key);if(detail&&detail.getAttribute('data-demand-key')!==String(key||'')){detail.innerHTML=dockingDetailHtml(key);detail.setAttribute('data-demand-key',key||'');detail.scrollTop=0;}
  Array.prototype.forEach.call(document.querySelectorAll('.docking-filters button'),function(button){var active=button.getAttribute('data-filter')===dockingViewState().filter;button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active));});
}
function dockingOpenReport(key){if(!PROJECTS[key])return;if(PROJECTS[key].demandOrigin==='direct'){toast('这条需求由机构直接提交，没有来源分析报告。');return;}cur=key;view='report';detailData=null;render();}
function dockingDownloadEventFile(key,id,ts,index){
  var event=dockingEvents(key).find(function(e){return id?e.id===id:Number(e.ts)===ts;}),file=event&&event.files&&event.files[index];
  if(!file||typeof file.dataUrl!=='string'||!/^data:(application\/(?:pdf|msword|vnd\.[a-z0-9.+-]+)|text\/(?:plain|csv)|image\/(?:png|jpeg|webp));base64,/i.test(file.dataUrl)){toast('附件当前不可用');return;}
  var link=document.createElement('a');link.href=file.dataUrl;link.download=file.name||'附件';document.body.appendChild(link);link.click();link.remove();
}
function dockingCaptureView(){
  if(view!=='home'&&view!=='docking')return null;
  var root=document.getElementById('dockingWorkspace');if(!root)return null;
  var input=document.getElementById('dockingDemandSearch'),detail=document.getElementById('dockingDetailHost'),list=document.getElementById('dockingListResults');
  return {epoch:dockingViewState().epoch,selected:dockingViewState().selected,detail:detail&&detail.scrollTop||0,list:list&&list.scrollTop||0,searchFocused:document.activeElement===input,start:input&&input.selectionStart,end:input&&input.selectionEnd,open:Array.prototype.map.call(root.querySelectorAll('details'),function(d){return d.open;})};
}
function dockingRestoreView(snapshot){
  if(!snapshot||snapshot.epoch!==dockingViewState().epoch||snapshot.selected!==dockingViewState().selected||view!=='home')return;
  var root=document.getElementById('dockingWorkspace');if(!root)return;
  var detail=document.getElementById('dockingDetailHost'),list=document.getElementById('dockingListResults'),input=document.getElementById('dockingDemandSearch');
  if(detail)detail.scrollTop=snapshot.detail;if(list)list.scrollTop=snapshot.list;
  Array.prototype.forEach.call(root.querySelectorAll('details'),function(d,i){d.open=!!snapshot.open[i];});
  if(snapshot.searchFocused&&input){input.focus({preventScroll:true});if(typeof input.setSelectionRange==='function')input.setSelectionRange(snapshot.start,snapshot.end);}
}

function dockingReceivingHtml(key){
  var p=PROJECTS[key],intake=dockingIntake(p),status=dockingIntakeStatus(p),hasReply=!!intake.reply;
  return '<section class="docking-receiving" data-status="'+dockingText(intake.status)+'"><div class="docking-receiving-top"><div><span class="docking-kicker">SERVICE PROGRESS</span><h3>管理端受理与反馈</h3></div>'+dockingBadge(status.label,status.tone)+'</div>'+
    (hasReply?'<p class="docking-receiving-reply">'+dockingText(intake.reply)+'</p><dl><dt>负责人</dt><dd>'+dockingText(intake.owner||'未指定')+'</dd><dt>下一步</dt><dd>'+dockingText(intake.nextStep||'尚未填写')+'</dd><dt>最近反馈</dt><dd>'+dockingDate(intake.repliedAt||intake.updatedAt)+' · '+dockingText(intake.repliedBy||intake.updatedBy||'管理端')+'</dd></dl>':'<p class="docking-receiving-reply">需求已进入受理队列。管理端受理后，负责人、下一步和处理结果将显示在这里。</p>')+
    '<button class="docking-button '+(intake.status==='needs_info'?'is-primary':'is-quiet')+'" onclick="'+dockingAction('openDockingSupplement',[key])+'">'+(intake.status==='needs_info'?'按反馈补充资料':'补充需求资料')+'</button></section>';
}

function dockingVerificationFeedbackHtml(clue){
  var r=clue.verificationRequest;if(!r||r.contract!=='docking-action-v1'||!r.reply)return '';
  return '<div class="docking-verification-reply"><strong>管理端核验记录</strong><p>'+dockingText(r.reply)+'</p>'+(r.evidence?'<small>记录依据</small><p>'+dockingText(r.evidence)+'</p>':'')+'<small>'+dockingDate(r.updatedAt)+' · '+dockingText(r.updatedBy||'管理端')+'</small><p class="docking-muted">这项反馈仅适用于本条需求，投资意向以企业实际沟通为准。</p></div>';
}
