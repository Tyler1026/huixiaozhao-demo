'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const moduleCode=fs.readFileSync(path.join(root,'frontend/index/reminders.js'),'utf8');
const tail=fs.readFileSync(path.join(root,'frontend/index/script-02-sections/12-tail.js'),'utf8');
const settingsCode=tail.slice(tail.indexOf('function settingsPage(p){'),tail.indexOf('/* 招商偏好画像'));
const auth=fs.readFileSync(path.join(root,'frontend/index/script-02-sections/03.js'),'utf8');
const identityCode=auth.slice(auth.indexOf('function currentAccountIdentity(){'),auth.indexOf('function _authEscape('));
const notif=fs.readFileSync(path.join(root,'frontend/index/script-02-sections/10.js'),'utf8');
const notifCode=notif.slice(0,notif.indexOf('function toggleSw('));
const clone=x=>JSON.parse(JSON.stringify(x));
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
function boot(){
  const calls=[],toasts=[],modals=[],timers=new Map();let timerId=0,transport=null,version=0;
  let preferences={statusChanges:true,overdue:true,dailyDigest:true};
  let notifications=[{id:'notice-1',type:'status',title:'真实阶段事件',message:'由接收端保存的阶段更新',createdAt:100,readAt:null,projectKey:'child',workspaceId:'parent',sourceId:'event-1'}];
  const dom={root:{innerHTML:''},notifPanel:{style:{display:'none'}}};
  const c={AUTH:{user:'alice',scope:'project',projectKeys:['parent','other'],projKey:'parent'},_authState:'ready',_authEpoch:1,cur:'parent',view:'settings',console,JSON,Date,Math,Number,String,Object,Array,Promise,encodeURIComponent,AbortController,
    PROJECTS:{parent:{workspaceId:'parent',org:'测试单位',who:'验收账号',city:'随州'},child:{workspaceId:'parent',isDemand:true,topic:'测试需求',city:'随州',stage:2},other:{workspaceId:'other'}},
    _authWorkspaceOf:k=>c.PROJECTS[k]&&c.PROJECTS[k].workspaceId,
    _authEscape:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
    document:{getElementById:id=>dom[id]||null},setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    authWorkspaceBlock:()=>'',onboardingSettingsSection:()=>'',toast:m=>toasts.push(m),openModal:(...args)=>modals.push(args),closeModal:()=>{},
    _authForget:()=>{c.AUTH=null;c._authEpoch++;c.reminderResetSession();},
    render:()=>{if(c.settingsPage)dom.root.innerHTML=c.settingsPage(c.PROJECTS[c.cur]||c.PROJECTS.parent);},
    $:selector=>dom[selector.slice(1)],
    fetch:async(url,options)=>{const request={url,options,body:options.body?JSON.parse(options.body):null};calls.push(request);return transport?transport(request):response(request);}
  };
  c.window=c;
  function response(request,overrides={}){
    const query=new URL(request.url,'https://local.invalid').searchParams,body=request.body||{};
    if(request.url==='/api/reminder-preferences'){if(JSON.stringify(preferences)!==JSON.stringify(body.preferences))version++;preferences=clone(body.preferences);}
    if(request.url==='/api/reminders/read')notifications=notifications.map(n=>body.all||(body.ids||[]).includes(n.id)?{...n,readAt:200}:n);
    const data={ok:true,requestId:body.requestId||query.get('requestId'),accountId:'alice',accountEpoch:'server-alice-1',projectKey:body.projectKey||query.get('projectKey'),workspaceId:'parent',version,preferences:clone(preferences),notifications:clone(notifications),...overrides};
    return {ok:true,status:200,json:async()=>data};
  }
  vm.createContext(c);vm.runInContext(identityCode+'\n'+moduleCode+'\n'+settingsCode+'\n'+notifCode,c);
  return {c,calls,toasts,modals,dom,timers,response,setTransport:x=>transport=x,preferences:()=>clone(preferences),setNotifications:x=>notifications=clone(x)};
}
test('real settings page renders server-backed controls and explicit notification scope',async()=>{
  const e=boot();await e.c.reminderLoad();e.c.render();
  assert.match(e.dom.root.innerHTML,/id="reminder-statusChanges"/);
  assert.match(e.dom.root.innerHTML,/onchange="reminderEdit\('statusChanges',this.checked\)"/);
  assert.match(e.dom.root.innerHTML,/onclick="reminderSave\(\)"/);
  assert.match(e.dom.root.innerHTML,/账号全部工作区通用/);assert.match(e.dom.root.innerHTML,/首次启用从次日开始/);
  assert.doesNotMatch(e.dom.root.innerHTML,/toast\('提醒偏好已保存'\)/);
});
test('all false are posted, acknowledged, redrawn and reloaded unchanged',async()=>{
  const e=boot();await e.c.reminderLoad();for(const key of ['statusChanges','overdue','dailyDigest'])e.c.reminderEdit(key,false);
  e.c.render();assert.doesNotMatch(e.dom.root.innerHTML,/<input[^>]+\schecked(?:\s|>)/);
  assert.equal(await e.c.reminderSave(),true);assert.deepEqual(e.preferences(),{statusChanges:false,overdue:false,dailyDigest:false});
  assert.deepEqual(e.toasts,['站内提醒偏好已保存']);assert.equal(e.calls[1].options.credentials,'same-origin');
  assert.deepEqual(Object.keys(e.calls[1].body).sort(),['accountEpoch','preferences','projectKey','requestId','version']);
  e.c.reminderResetSession();await e.c.reminderLoad();e.c.render();assert.doesNotMatch(e.dom.root.innerHTML,/<input[^>]+\schecked(?:\s|>)/);
});
test('draft survives rendering and refresh without replacing server values before save',async()=>{
  const e=boot();await e.c.reminderLoad();e.c.reminderEdit('overdue',false);e.c.render();await e.c.reminderLoad(true);
  assert.equal(e.c.REMINDER_STATE.draft.overdue,false);assert.equal(e.c.REMINDER_STATE.preferences.overdue,true);assert.equal(e.c.REMINDER_STATE.dirty,true);
});
for(const kind of ['network','http','json','body','preferences','identity','request','epoch','version'])test(kind+' save failure keeps draft and never claims success',async()=>{
  const e=boot();await e.c.reminderLoad();e.c.reminderEdit('overdue',false);
  e.setTransport(request=>{
    if(kind==='network')throw new Error('offline');
    if(kind==='http')return {ok:false,status:503,json:async()=>({ok:false,message:'请稍后重试'})};
    if(kind==='json')return {ok:true,status:200,json:async()=>{throw new Error('invalid');}};
    const overrides=kind==='body'?{ok:false}:kind==='preferences'?{preferences:{statusChanges:true,overdue:'false',dailyDigest:true}}:kind==='identity'?{accountId:'bob'}:kind==='request'?{requestId:'wrong'}:kind==='epoch'?{accountEpoch:'wrong'}:kind==='version'?{version:-1}:{};
    return e.response(request,overrides);
  });
  assert.equal(await e.c.reminderSave(),false);assert.equal(e.c.REMINDER_STATE.draft.overdue,false);assert.equal(e.c.REMINDER_STATE.dirty,true);assert.equal(e.toasts.length,0);assert.ok(e.c.REMINDER_STATE.error);
});
for(const change of ['account','epoch','workspace','project'])test(change+' change ignores late save success and error',async()=>{
  for(const bad of [false,true]){
    const e=boot();await e.c.reminderLoad();e.c.reminderEdit('overdue',false);const g=gate();
    e.setTransport(async request=>{await g.promise;if(bad)throw new Error('late error');return e.response(request);});
    const pending=e.c.reminderSave();await Promise.resolve();
    if(change==='account')e.c.AUTH={user:'bob',scope:'project',projectKeys:['parent'],projKey:'parent'};
    if(change==='epoch')e.c._authEpoch++;
    if(change==='workspace')e.c.cur='other';
    if(change==='project')e.c.cur='child';
    e.c.reminderState();const current=e.c.REMINDER_STATE;g.resolve();assert.equal(await pending,false);assert.equal(e.c.REMINDER_STATE,current);assert.equal(current.loaded,false);assert.equal(current.error,'');assert.equal(e.toasts.length,0);
  }
});
test('late 401 does not log a new session out',async()=>{
  const e=boot(),g=gate();e.setTransport(async()=>{await g.promise;return {ok:false,status:401,json:async()=>({ok:false})};});
  const pending=e.c.reminderLoad();await Promise.resolve();e.c.AUTH={user:'bob',scope:'project',projectKeys:['parent'],projKey:'parent'};e.c._authEpoch++;e.c.reminderState();g.resolve();assert.equal(await pending,false);assert.equal(e.c.AUTH.user,'bob');
});
test('slow save has no early success and ignores repeated save click',async()=>{
  const e=boot();await e.c.reminderLoad();const g=gate();e.c.reminderEdit('dailyDigest',false);e.setTransport(async request=>{await g.promise;return e.response(request);});
  const pending=e.c.reminderSave();assert.equal(e.toasts.length,0);assert.equal(e.c.REMINDER_STATE.mutationPending,true);assert.equal(await e.c.reminderSave(),false);g.resolve();assert.equal(await pending,true);assert.equal(e.toasts.length,1);
});
test('old GET cannot overwrite a newer save receipt',async()=>{
  const e=boot();await e.c.reminderLoad();const g=gate();let old;
  e.setTransport(async request=>{if(request.url.startsWith('/api/reminders?')){old=e.response(request);await g.promise;return old;}return e.response(request);});
  const pending=e.c.reminderLoad(true);await Promise.resolve();e.c.reminderEdit('statusChanges',false);await e.c.reminderSave();g.resolve();assert.equal(await pending,false);assert.equal(e.c.REMINDER_STATE.preferences.statusChanges,false);
});
for(const failure of ['http','network','json','timeout'])test('old '+failure+' poll cannot replace a newer save success',async()=>{
  const e=boot();await e.c.reminderLoad();const g=gate();
  e.setTransport(async request=>{
    if(request.url.startsWith('/api/reminders?')){
      await g.promise;
      if(failure==='network')throw new Error('old network error');
      if(failure==='json')return {ok:true,status:200,json:async()=>{throw new Error('old JSON error');}};
      return {ok:false,status:503,json:async()=>({ok:false,message:'old server error'})};
    }
    return e.response(request);
  });
  const pending=e.c.reminderLoad(true);await Promise.resolve();const oldTimeout=Array.from(e.timers.values()).find(timer=>timer.ms===20000);
  e.c.reminderEdit('statusChanges',false);assert.equal(await e.c.reminderSave(),true);
  if(failure==='timeout')oldTimeout.fn();else g.resolve();
  assert.equal(await pending,false);assert.equal(e.c.REMINDER_STATE.error,'');assert.equal(e.c.REMINDER_STATE.preferences.statusChanges,false);assert.equal(e.toasts.length,1);g.resolve();
});
test('checking or non-project auth never loads old credentials',async()=>{
  for(const change of ['checking','admin']){const e=boot();if(change==='checking')e.c._authState='checking';else e.c.AUTH.scope='admin';assert.equal(await e.c.reminderLoad(),false);assert.equal(e.calls.length,0);assert.equal(e.c.reminderContext(),null);}
});
test('notifications render escaped persisted event text and never synthesize from PROJECTS',async()=>{
  const e=boot();await e.c.reminderLoad();assert.equal(e.c.unreadCount(),1);const html=e.c.notifList();assert.match(html,/真实阶段事件/);assert.doesNotMatch(html,/09:00 自动生成/);
  e.c.reminderResetSession();assert.equal(e.c.unreadCount(),0);assert.doesNotMatch(e.c.notifList(),/真实阶段事件/);
});
test('click marks actual event read after acknowledgement and opens persisted detail',async()=>{
  const e=boot();await e.c.reminderLoad();assert.equal(await e.c.openNotif('notice-1'),true);
  assert.equal(e.c.unreadCount(),0);assert.equal(e.calls[1].url,'/api/reminders/read');assert.deepEqual(e.calls[1].body.ids,['notice-1']);assert.match(e.modals[0][1],/由接收端保存的阶段更新/);assert.match(e.modals[0][2],/gotoProjFromNotif/);
});
test('failed read does not mark or open and read-all is current workspace scoped',async()=>{
  const e=boot();await e.c.reminderLoad();e.setTransport(()=>({ok:false,status:503,json:async()=>({ok:false,message:'offline'})}));assert.equal(await e.c.openNotif('notice-1'),false);assert.equal(e.c.unreadCount(),1);assert.equal(e.modals.length,0);
  e.setTransport(null);assert.equal(await e.c.markAllRead({stopPropagation(){}}),true);assert.equal(e.calls.at(-1).body.projectKey,'parent');assert.equal(e.calls.at(-1).body.all,true);assert.equal(e.c.unreadCount(),0);
});
test('wrong workspace notification or unacknowledged read rejected',async()=>{
  const e=boot();e.setNotifications([{id:'bad',type:'status',title:'bad',message:'bad',createdAt:1,readAt:null,projectKey:'other',workspaceId:'other',sourceId:'bad'}]);assert.equal(await e.c.reminderLoad(),false);assert.equal(e.c.unreadCount(),0);
  const f=boot();await f.c.reminderLoad();f.setTransport(request=>f.response({...request,url:'/ignored'}));assert.equal(await f.c.openNotif('notice-1'),false);assert.equal(f.c.unreadCount(),1);
});
test('daily detail displays saved snapshot instead of reconstructing current projects',async()=>{
  const e=boot();e.setNotifications([{id:'daily-1',type:'daily',title:'历史摘要',message:'保存时为 2 条需求',createdAt:100,readAt:null,projectKey:'parent',workspaceId:'parent',sourceId:'day-1'}]);await e.c.reminderLoad();e.c.PROJECTS.child.topic='更新后的不同项目';await e.c.openNotif('daily-1');assert.match(e.modals[0][1],/保存时为 2 条需求/);assert.doesNotMatch(e.modals[0][1],/更新后的不同项目/);
});
test('preference save rejects a skipped version and preserves unsaved edits',async()=>{
  const e=boot();await e.c.reminderLoad();e.c.reminderEdit('overdue',false);e.setTransport(request=>e.response(request,{version:99}));
  assert.equal(await e.c.reminderSave(),false);assert.equal(e.c.REMINDER_STATE.version,0);assert.equal(e.c.REMINDER_STATE.draft.overdue,false);assert.equal(e.toasts.length,0);
});
test('unchanged preference save expects the same acknowledged version',async()=>{
  const e=boot();await e.c.reminderLoad();assert.equal(await e.c.reminderSave(),true);assert.equal(e.c.REMINDER_STATE.version,0);
});
test('mark-read rejects an unexpected preference version without opening detail',async()=>{
  const e=boot();await e.c.reminderLoad();e.setTransport(request=>e.response(request,{version:99}));
  assert.equal(await e.c.openNotif('notice-1'),false);assert.equal(e.c.unreadCount(),1);assert.equal(e.modals.length,0);
});

async function knowledgeDraftHarness(){
  const source=fs.readFileSync(path.join(root,'frontend/index/script-02-sections/05.js'),'utf8');
  const start=source.indexOf('function render(){'),end=source.indexOf('\nfunction ',start+1);
  const composer=tail.slice(tail.indexOf('function kbComposer(){'),tail.indexOf('\nfunction renderComposer()'));
  let input={value:'',selectionStart:0,selectionEnd:0},replacements=0,reply=null;
  const rootNode={set innerHTML(markup){replacements++;input={value:'',selectionStart:0,selectionEnd:0};this.markup=markup;},get innerHTML(){return this.markup;}};
  const c={console,AUTH:{user:'alice',scope:'project',projectKeys:['p','q'],projKey:'p'},_authState:'ready',_authEpoch:1,cur:'p',view:'knowledge',role:'gov',PROJECTS:{p:{city:'A'},q:{city:'B'}},REPORTSTATE:{},REPORT_HISTORY:{},detailOpen:false,
    document:{body:{classList:{toggle(){}}},getElementById:id=>id==='root'?rootNode:id==='composerTa'?input:null,get activeElement(){return input;}},
    _authWorkspaceOf:key=>key,P:()=>c.PROJECTS[c.cur],$:s=>s==='#root'?rootNode:null,topbar:()=>'',sidebar:()=>'',mainPane:()=>c.kbComposer(),progressFooter:()=>'',
    _viewScrollKey:()=> 'knowledge::'+c.cur,_captureChainExplorer:()=>null,_restoreChainExplorer(){},_captureScroll(){},_scrollMemory:{key:'knowledge::p',tops:{}},_restoreScroll(){},_renderedScrollKey:'knowledge::p',bind(){},kbChatReplay(){},kbScopeTitle:()=>'',kbIsRequestPending:()=>false,_authEscape:x=>String(x),setTimeout:()=>1,clearTimeout(){},JSON,Date,Math,Number,String,Object,Array,Promise,encodeURIComponent,AbortController,
    fetch:async(url)=>{if(reply)return reply(url);return {ok:true,status:200,json:async()=>({ok:true,requestId:new URL(url,'https://invalid.test').searchParams.get('requestId'),accountId:'alice',accountEpoch:'a1',projectKey:c.cur,workspaceId:c.cur,version:0,preferences:{statusChanges:true,overdue:true,dailyDigest:true},notifications:[]})};}};
  c.window=c;vm.createContext(c);vm.runInContext(composer+'\n'+source.slice(start,end<0?undefined:end)+'\n'+moduleCode,c);c.render._routed=true;c.render._serverSynced=true;c.render();
  for(let i=0;i<16;i++)await Promise.resolve();
  return {c,get input(){return input;},get replacements(){return replacements;},setReply(fn){reply=fn;}};
}
for(const kind of ['unchanged','changed','error'])test('actual knowledge render/composer retains unsent node, value and selection after '+kind+' reminder poll',async()=>{
  const h=await knowledgeDraftHarness();await h.c.reminderLoad(true);const node=h.input;node.value='尚未提交的实际问题';node.selectionStart=2;node.selectionEnd=7;const before=h.replacements;
  if(kind==='error')h.setReply(async()=>({ok:false,status:503,json:async()=>({ok:false,message:'Reminder offline'})}));
  if(kind==='changed')h.setReply(async url=>({ok:true,status:200,json:async()=>({ok:true,requestId:new URL(url,'https://invalid.test').searchParams.get('requestId'),accountId:'alice',accountEpoch:'a1',projectKey:'p',workspaceId:'p',version:0,preferences:{statusChanges:true,overdue:true,dailyDigest:true},notifications:[{id:'new-event',type:'status',title:'New event',message:'New state',createdAt:1,readAt:null,projectKey:'p',workspaceId:'p',sourceId:'new-source'}]})}));
  assert.equal(await h.c.reminderLoad(true),kind!=='error');assert.equal(h.input,node);assert.equal(h.input.value,'尚未提交的实际问题');assert.equal(h.input.selectionStart,2);assert.equal(h.input.selectionEnd,7);assert.equal(h.c.document.activeElement,node);assert.equal(h.replacements,before);
});
for(const change of ['account','workspace'])test('late poll cannot restore old knowledge draft or mutate new '+change+' page',async()=>{
  const h=await knowledgeDraftHarness();await h.c.reminderLoad(true);h.input.value='previous account draft';const g=gate();h.setReply(async()=>{await g.promise;return {ok:false,status:503,json:async()=>({ok:false,message:'old failure'})};});const pending=h.c.reminderLoad(true);await Promise.resolve();
  if(change==='account'){h.c.AUTH.user='bob';h.c._authEpoch++;}else{h.c.cur='q';h.c.AUTH.projKey='q';h.c._authEpoch++;}
  h.c.render();const current=h.input;assert.equal(current.value,'');current.value='new isolated page draft';const replacements=h.replacements;g.resolve();assert.equal(await pending,false);assert.equal(h.input,current);assert.equal(current.value,'new isolated page draft');assert.equal(h.replacements,replacements);
});
