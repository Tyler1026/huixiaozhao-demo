'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
function declaration(source,name){
  const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);
  const end=source.indexOf('\nfunction ',start+1);
  return source.slice(start,end<0?undefined:end);
}
function displayHarness(){
  const queued=[],listeners={};let writes=0,closed=0,now=1000;
  const c={Date:{now:()=>now},PROJECTS:{p:{id:'p',topic:'甲方向'}},REPORTSTATE:{p:{topic:'甲方向',chainByTopic:{'甲方向':[{seg:'上游',nodes:[{name:'有来源的节点'}]}]},chainStatusByTopic:{'甲方向':'ready'},chainEvidenceByTopic:{'甲方向':{runId:'r1'}}}},REPORT_HISTORY:{},cur:'p',view:'report',role:'gov',detailOpen:false,
    AUTH:{projKey:'p'},_authState:'ready',_authEpoch:1,window:null,console,
    setTimeout:fn=>queued.push(fn),requestAnimationFrame:fn=>queued.push(fn),
    getTopicReport:()=>'',ensureAiReport(){},parseActionItems:()=>[],P:()=>c.PROJECTS[c.cur],_authWorkspaceOf:k=>k,bind(){},topbar:()=>'<header>头部</header>',sidebar:()=>'',progressFooter:()=>'',
    mainPane:()=>'<section class="industry-page">图谱'+c.suffix+'</section>',suffix:'',closeChainLayoutNode(){closed++;c.CHAIN_OPEN_DRAWER=null;},CHAIN_OPEN_DRAWER:null};
  c.window=c;c.window.requestAnimationFrame=c.requestAnimationFrame;
  const root={chain:null,scroll:null,_html:'',querySelector(selector){return selector==='.chain-explorer'?this.chain:null;},
    get innerHTML(){return this._html;},set innerHTML(value){
      writes++;this._html=value;this.scroll={className:'conversation-scroll industry-scroll',scrollTop:0};
      this.chain={outerHTML:'<section class="chain-explorer" data-mode="'+(c.mode||'layout')+'">real-evidence</section>',replaceWith(other){root.chain=other;},expanded:false};
    }};
  c.document={body:{classList:{toggle(){}}},getElementById:id=>id==='root'?root:null,querySelectorAll:()=>root.scroll?[root.scroll]:[],addEventListener:(event,fn)=>{listeners[event]=fn;}};
  c.$=selector=>selector==='#root'?root:null;
  const scroll=read('frontend/index/script-02-sections/03.js');
  vm.createContext(c);vm.runInContext(scroll.slice(scroll.indexOf('var _SCROLL_SELECTORS='),scroll.indexOf('/* AUTH:')),c);
  vm.runInContext(declaration(read('frontend/index/script-02-sections/05.js'),'render').split('/* 顶栏角色切换按钮')[0],c);
  c.render._routed=true;c.render._serverSynced=true;
  return {c,root,queued,listeners,get writes(){return writes;},get closed(){return closed;},tick:()=>now++,flush(){while(queued.length)queued.shift()();}};
}
test('identical background renders keep the active industry DOM, scroll and drawer',()=>{
  const h=displayHarness(),{c,root}=h;c.render();
  const graph=root.chain;graph.expanded=true;root.scroll.scrollTop=840;c.CHAIN_OPEN_DRAWER={open:true};
  c.render();c.render();
  assert.equal(h.writes,1);assert.equal(root.chain,graph);assert.equal(root.scroll.scrollTop,840);assert.equal(root.chain.expanded,true);assert.ok(c.CHAIN_OPEN_DRAWER);
});
test('a changed page preserves an unchanged evidence graph and restores the current reading position',()=>{
  const h=displayHarness(),{c,root}=h;c.render();const graph=root.chain;
  graph.expanded=true;root.scroll.scrollTop=975;c.CHAIN_OPEN_DRAWER={open:true};c.suffix='后台新状态';c.render();h.flush();
  assert.equal(h.writes,2);assert.equal(root.chain,graph);assert.equal(graph.expanded,true);assert.equal(root.scroll.scrollTop,975);assert.ok(c.CHAIN_OPEN_DRAWER);
});
test('polling after selecting assessment keeps the selected mode, expanded evidence and drawer',()=>{
  const h=displayHarness(),{c,root}=h;c.render();const graph=root.chain;
  c.mode='assessment';graph.mode='assessment';graph.expanded=true;c.CHAIN_OPEN_DRAWER={open:true};root.scroll.scrollTop=1200;
  c.suffix='轮询更新完成状态';c.render();h.flush();
  assert.equal(root.chain,graph);assert.equal(root.chain.mode,'assessment');assert.equal(root.chain.expanded,true);assert.ok(c.CHAIN_OPEN_DRAWER);assert.equal(root.scroll.scrollTop,1200);
});
test('a locally selected topic initializes its new graph before the first background render',()=>{
  const h=displayHarness(),{c,root}=h;c.render();
  const state=c.REPORTSTATE.p;state.chainByTopic['乙方向']=[{seg:'中游',nodes:[{name:'乙方向来源节点'}]}];state.chainEvidenceByTopic['乙方向']={runId:'r2'};state.chainStatusByTopic['乙方向']='ready';
  const nodes={reportHistoryArea:{},reportArea:{appendChild(node){nodes[node.id]=node;if(node.id==='chainMapBlock')root.chain={outerHTML:'<section class="chain-explorer">乙</section>',replaceWith(other){root.chain=other;}};}}};
  const originalGet=c.document.getElementById;
  c.document.getElementById=id=>nodes[id]||originalGet(id);
  c.document.querySelector=()=>null;c.document.createElement=()=>({});
  Object.assign(c,{PENDING_CONFIRMS:{},currentPendingItems:()=>[],parsePendingItems:()=>[],persist(){},updateReportBusy(){},reportJobForTopic:()=>null,reportTextForTopic:()=> '乙方向保存的报告',
    setReportAreaHtml(){root.chain=null;},reportHtml:()=>'<article>报告</article>',chainMapHtml:()=>'<section>图谱</section>',restoreActionItems:()=>'',restoreConfirmPanel:()=>'',renderHistoryReports(){}});
  vm.runInContext(declaration(read('frontend/index/script-02-sections/12-tail.js'),'selectTopic'),c);
  c.selectTopic('乙方向');const selected=root.chain;
  assert.ok(selected._renderDataKey,'partial rendering initializes the graph version even without a topic-card grid');
  selected.mode='assessment';selected.expanded=true;c.mode='assessment';c.CHAIN_OPEN_DRAWER={open:true};root.scroll.scrollTop=850;
  c.suffix='下一次同步';c.render();h.flush();
  assert.equal(root.chain,selected);assert.equal(root.chain.expanded,true);assert.ok(c.CHAIN_OPEN_DRAWER);assert.equal(root.scroll.scrollTop,850);
});
test('generation completion initializes the graph inserted by its local status renderer',async()=>{
  const {setup,fn}=require('./chain_v2_fixture.cjs'),e=setup('index'),c=e.c;let graph=null,status=null;
  const root={querySelector:()=>graph},block={querySelector(selector){return selector==='.chain-explorer'?graph:selector==='.chain-generation-status'?status:null;},insertAdjacentHTML(){status={querySelector:()=>({})};},
    set innerHTML(html){status=html.includes('chain-generation-status')?{querySelector:()=>({})}:null;graph=html.includes('class="chain-explorer"')?{replaceWith(other){graph=other;}}:null;}};
  c.document.getElementById=id=>id==='root'?root:id==='chainMapBlock'?block:null;
  c.chainExplorerHtml=()=>'<section class="chain-explorer"></section>';
  const helpers=read('frontend/index/script-02-sections/03.js');
  c.document.addEventListener=()=>{};c.document.querySelectorAll=()=>[];
  vm.runInContext(helpers.slice(helpers.indexOf('var _SCROLL_SELECTORS='),helpers.indexOf('/* AUTH:')),c);
  c._renderedScrollKey=c._viewScrollKey();
  assert.equal(await c.requestChainGeneration(),true);assert.ok(graph);assert.equal(graph._renderDataKey,c._chainRenderDataKey());assert.equal(c._captureChainExplorer().element,graph);
});
test('changed node data replaces the graph even if its run identifier is unchanged',()=>{
  const h=displayHarness(),{c,root}=h;c.render();const graph=root.chain;
  c.REPORTSTATE.p.chainByTopic['甲方向'][0].nodes.push({name:'补充来源后的节点'});c.CHAIN_OPEN_DRAWER={open:true};c.render();
  assert.notEqual(root.chain,graph);assert.equal(h.closed,1);
});
test('a changed graph or authentication context cannot reuse the previous graph DOM',()=>{
  const h=displayHarness(),{c,root}=h;c.render();let previous=root.chain;
  c.REPORTSTATE.p.chainEvidenceByTopic['甲方向'].runId='r2';c.suffix='新图谱';c.CHAIN_OPEN_DRAWER={open:true};c.render();
  assert.notEqual(root.chain,previous);assert.equal(h.closed,1);
  previous=root.chain;c._authEpoch++;c.CHAIN_OPEN_DRAWER={open:true};c.render();
  assert.notEqual(root.chain,previous);assert.equal(h.closed,2);
});
test('old scroll retries cannot pull a newer render back to an earlier reading position',()=>{
  const h=displayHarness(),{c,root}=h;c.render();root.scroll.scrollTop=300;c.suffix='一';c.render();
  root.scroll.scrollTop=1100;c.suffix='二';c.render();h.flush();assert.equal(root.scroll.scrollTop,1100);
});
test('programmatic layout scrolling does not cancel restoration',()=>{
  const h=displayHarness(),{c,root}=h;c.render();root.scroll.scrollTop=9996;c.suffix='同步状态';c.render();
  root.scroll.scrollTop=1183;h.tick();if(h.listeners.scroll)h.listeners.scroll({isTrusted:true});h.flush();
  assert.equal(root.scroll.scrollTop,9996);
});
test('real user scrolling cancels scheduled restoration even within the capture millisecond',()=>{
  for(const event of ['wheel','touchmove','pointerdown']){
    const h=displayHarness(),{c,root}=h;c.render();root.scroll.scrollTop=900;c.suffix='同步状态';c.render();
    h.listeners[event]({isTrusted:true});root.scroll.scrollTop=1100;h.flush();assert.equal(root.scroll.scrollTop,1100,event);
  }
});
test('a native scrollbar drag continuing after capture keeps control of scrolling',()=>{
  const h=displayHarness(),{c,root}=h;c.render();h.listeners.pointerdown({isTrusted:true});root.scroll.scrollTop=900;c.suffix='同步状态';c.render();
  h.listeners.pointermove({isTrusted:true,buttons:1});root.scroll.scrollTop=1400;h.flush();assert.equal(root.scroll.scrollTop,1400);
});
test('a retained visible graph anchors reading when content above it changes height',()=>{
  const h=displayHarness(),{c,root}=h;c.render();let graphTop=5000;
  root.scroll.scrollTop=6000;root.scroll.contains=node=>node===root.chain;root.scroll.getBoundingClientRect=()=>({top:50,bottom:650});
  root.chain.getBoundingClientRect=()=>({top:50+graphTop-root.scroll.scrollTop,bottom:50+graphTop+12000-root.scroll.scrollTop});
  c._captureScroll();const saved=c._scrollMemory;graphTop=5240;root.scroll.scrollTop=0;
  c._restoreScroll(saved.key,saved.tops);h.flush();
  assert.equal(root.scroll.scrollTop,6240);assert.equal(root.chain.getBoundingClientRect().top,-950);
});
test('report blocks keep their real height instead of using offscreen height estimates',()=>{
  const css=read('frontend/index/style-01.css');
  for(const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
    if(rule[1].includes('#reportArea'))assert.doesNotMatch(rule[2],/content-visibility\s*:\s*auto|contain-intrinsic-size/);
  }
  assert.match(css,/\.clues-scroll \.clue-row[^{}]*\{[^{}]*content-visibility:auto/);
});
test('a direction or module change starts at the top instead of inheriting old reading position',()=>{
  const h=displayHarness(),{c,root}=h;c.render();const oldGraph=root.chain;root.scroll.scrollTop=900;
  c.PROJECTS.p.topic='乙方向';c.render();h.flush();assert.equal(root.scroll.scrollTop,0);assert.notEqual(root.chain,oldGraph);
  root.scroll.scrollTop=700;c.view='home';c.render();h.flush();assert.equal(root.scroll.scrollTop,0);
});
function syncHarness(app='index'){
  let resolve,request;const timers=new Map();let timerId=0;
  const c={AbortController,setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},AUTH:{user:'owner',scope:app==='ops'?'admin':'user'},_authState:'ready',_authEpoch:1,_serverRestoreSeq:0,window:null,console:{log(){},warn(){}},
    cur:'p',view:'report',PROJECTS:{p:{topic:'甲方向'},q:{topic:'乙方向'}},REPORTSTATE:{},REPORT_HISTORY:{},PENDING_CONFIRMS:{},UPLOADS:{},KB_FILE_CHUNKS:{},KB_CONFIRMS:{},KB_CHAT:{},KB_CHAT_TOMBS:{},UPLOAD_TOMBS:{},KB_CONFIRM_TOMBS:{},DEMANDS:[],OPS_ENT:[],RESET_GEN:'r',CITY_BASE_PACKAGES:{},USER_PROFILES:{},INVITE_CODES:{},LS_KEY:'test',
    fetch(){request=new Promise(r=>resolve=r);return request;},_authReadSync:r=>r.json(),_authFilterProjects:x=>x,_acceptServerGeneration:()=>false,
    mergeTopicProjectLifecycle:(_local,x)=>x,mergeTopicReportStates:(_local,x)=>x||{},mergeTopicReportHistory:(_a,x)=>x||{},_mergeUploads:x=>x||{},_mergeChunks:x=>x||{},_mergeConfirms:x=>x||{},_mergeKbChat:x=>x||{},_safeProfiles:x=>x||{},_safeSyncSnapshot:x=>x,_slimUploads:()=>({}),
    _mergeKbItemTombs(){},_applyKbItemTombs(){},_mergeTombs(){},_mergeKbChatTombs(){},_mergeUploadTombs(){},_applyUploadTombs(){},applyTopicStateIntegrity(){},migrateKbChatToCity(){},
    localStorage:{setItem(k,value){if(k==='test')c.cached=JSON.parse(value);}},};
  c.window=c;vm.createContext(c);
  const file=app==='index'?'frontend/index/script-02-sections/14-tail.js':'frontend/ops/script-03-sections/14-tail.js';
  vm.runInContext(declaration(read(file),'restoreFromServer').split('function clearPersist')[0],c);
  return {c,timers,respond:(data)=>resolve({json:async()=>data||({PROJECTS:{p:{topic:'甲方向'},q:{topic:'乙方向'}},cur:'p',view:'knowledge',RESET_GEN:'r'})})};
}
test('a pending client sync preserves a direction and module selected after the request started',async()=>{
  const h=syncHarness(),{c}=h,pending=c.restoreFromServer();c.PROJECTS.p.topic='丙方向';c.view='home';h.respond();await pending;
  assert.equal(c.PROJECTS.p.topic,'丙方向');assert.equal(c.view,'home');assert.equal(c.cached.PROJECTS.p.topic,'丙方向');assert.equal(c.cached.view,'home');
});
test('a pending client sync preserves a different project selected during the request',async()=>{
  const h=syncHarness(),{c}=h,pending=c.restoreFromServer();c.cur='q';c.PROJECTS.q.topic='丁方向';h.respond();await pending;
  assert.equal(c.cur,'q');assert.equal(c.PROJECTS.q.topic,'丁方向');assert.equal(c.cached.cur,'q');
});
test('server-deleted projects and directions are not revived to preserve the view',async()=>{
  const h=syncHarness(),{c}=h;c.PROJECTS.p.topic='旧方向';const pending=c.restoreFromServer();
  c._authFilterProjects=x=>({q:x.q});h.respond();await pending;assert.equal(c.cur,'q');assert.equal(c.PROJECTS.p,undefined);
  const d=syncHarness(),next=d.c.restoreFromServer();d.respond({PROJECTS:{p:{topic:'新方向',deletedTopics:['甲方向']},q:{topic:'乙方向'}},RESET_GEN:'r'});await next;
  assert.equal(d.c.PROJECTS.p.topic,'新方向');
});
test('a pending admin sync keeps the project selected after polling started',async()=>{
  const h=syncHarness('ops'),{c}=h,pending=c.restoreFromServer();await Promise.resolve();c.cur='q';h.respond();await pending;assert.equal(c.cur,'q');assert.equal(h.timers.size,0);
});
