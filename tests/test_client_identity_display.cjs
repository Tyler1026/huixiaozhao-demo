'use strict';
// Actual account/session display functions with synthetic identities. No HTTP.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function section(text,start,end){return text.slice(text.indexOf(start),text.indexOf(end,text.indexOf(start)));}
function boot(){
  const nodes={},storage=new Map();
  const c={console,JSON,Object,Array,String,Number,Date,Promise,URLSearchParams,encodeURIComponent,
    location:{search:''},document:{readyState:'loading',documentElement:{classList:{add(){}}},
      getElementById:id=>nodes[id]||null,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},
      createElement:()=>({content:{querySelector:()=>null,querySelectorAll:()=>[]},innerHTML:''})},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    PROJECTS:{},REPORTSTATE:{},REPORT_HISTORY:{},DEMANDS:[],UPLOADS:{},KB_CHAT:{},KB_EDITS:{},cur:null,view:'settings',
    render(){},openModal(){},closeModal(){},mainPane:()=>'',loginPage:()=>'',registerPage:()=>'',setupPage:()=>'',
    onboardingSettingsSection:()=>'',authWorkspaceBlock:()=>'',orgMembersBlock:()=>'',
    unreadCount:()=>0,notifList:()=>'',kbReadiness:()=>({}),kbProgressInner:()=>'',isLocked:()=>false,nowLabel:()=>'',
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,fetch(){throw new Error('Unexpected network');}};
  c.window=c;vm.createContext(c);
  const auth=read('frontend/index/script-02-sections/03.js');
  vm.runInContext(auth.slice(auth.indexOf('var AUTH=')).replace('\nloadAuth();',''),c);
  vm.runInContext(read('frontend/index/reminders.js'),c);
  const tail=read('frontend/index/script-02-sections/12-tail.js');
  vm.runInContext(section(tail,'function settingsPage(p){','/* 招商偏好画像：设置页'),c);
  const detail=read('frontend/index/script-02-sections/13.js');
  vm.runInContext(section(detail,'function detailSettings(p){','/* 组织成员区块'),c);
  const top=read('frontend/index/script-02-sections/09.js');
  vm.runInContext(section(top,'function topbar(p){','\nfunction sidebar('),c);
  c.legacyTopbar=c.topbar;
  vm.runInContext(read('frontend/index/full-skin.js'),c);
  const workspace={id:'a',workspaceId:'a',who:'共享工作区联系人',org:'工作区单位',city:'合成城市',topic:'合成方向'};
  function accept(user,role='member',name='实际成员姓名',active='a'){
    c._authAccept({user,who:name,org:'账号所属单位',role,scope:'project',projKey:active,projectKeys:['a','b']});
    c.PROJECTS={a:{...workspace},b:{...workspace,id:'b',workspaceId:'b',city:'另一城市'}};c.cur=active;
    return c.PROJECTS[active];
  }
  return {c,workspace,accept};
}
function identityHtml(c,p){return [c.settingsPage(p),c.detailSettings(p),c.legacyTopbar(p),c.topbar(p)];}
test('same workspace owner and member show their own session name, login and current membership',()=>{
  const h=boot();
  for(const role of ['owner','member']){
    const p=h.accept('account_'+role,role,'姓名_'+role),html=identityHtml(h.c,p);
    for(const surface of html){assert.ok(surface.includes('姓名_'+role));assert.ok(!surface.includes('共享工作区联系人'));}
    assert.match(html[0],new RegExp('account_'+role));assert.match(html[1],new RegExp('account_'+role));
    assert.match(html[0],new RegExp(role==='owner'?'工作区负责人':'工作区成员'));
    assert.match(html[1],new RegExp(role==='owner'?'工作区负责人':'工作区成员'));
    assert.equal(p.who,'共享工作区联系人');assert.equal(h.c.AUTH.role,role);
  }
});
test('changing workspace contact cannot rename the authenticated account',()=>{
  const h=boot(),p=h.accept('member');p.who='新工作区联系人';p.org='不同工作区单位';
  for(const surface of identityHtml(h.c,p)){assert.match(surface,/实际成员姓名/);assert.doesNotMatch(surface,/新工作区联系人/);}
  assert.match(h.c.settingsPage(p),/账号所属单位/);assert.equal(p.org,'不同工作区单位');
});
test('account and workspace role changes do not retain the previous identity',()=>{
  const h=boot();let p=h.accept('alice','owner','先前用户');identityHtml(h.c,p);
  p=h.accept('bob','member','当前成员');for(const x of identityHtml(h.c,p)){assert.doesNotMatch(x,/先前用户/);assert.match(x,/当前成员/);}
  assert.doesNotMatch(h.c.detailSettings(p),/工作区负责人|组织管理员/);
  p=h.accept('bob','owner','当前成员','b');assert.match(h.c.detailSettings(p),/工作区负责人/);
  assert.equal(p.who,'共享工作区联系人');
});
test('sign-out and checking state cannot display a previous account or contact',()=>{
  const h=boot(),p=h.accept('alice','owner','之前姓名');h.c._authForget();
  for(const x of identityHtml(h.c,p)){assert.doesNotMatch(x,/之前姓名|共享工作区联系人|工作区负责人/);assert.match(x,/未登录/);}
  h.accept('bob','member','正在核验姓名');h.c._authState='checking';
  assert.equal(h.c.currentAccountIdentity().name,'未登录');
});
test('unknown membership and inconsistent current workspace never imply owner authority',()=>{
  const h=boot(),p=h.accept('member','unexpected','成员');
  assert.match(h.c.settingsPage(p),/身份待核验/);assert.doesNotMatch(h.c.detailSettings(p),/工作区负责人|组织管理员/);
  h.c.AUTH.role='owner';h.c.AUTH.projKey='unassigned';
  assert.equal(h.c.currentAccountIdentity().roleLabel,'身份待核验');
});
test('missing optional display name and organization use honest account fallbacks',()=>{
  const h=boot(),p=h.accept('member','member','');h.c.AUTH.who=' ';h.c.AUTH.org='';
  assert.equal(h.c.currentAccountIdentity().name,'member');assert.equal(h.c.currentAccountIdentity().org,'未填写');
  assert.doesNotMatch(h.c.settingsPage(p),/共享工作区联系人/);
});
test('account strings are escaped in every identity surface',()=>{
  const h=boot(),p=h.accept('member<login>','member','<img onerror="x">');h.c.AUTH.org='Org<script>x</script>';
  for(const x of identityHtml(h.c,p)){assert.doesNotMatch(x,/<img onerror="x">|<script>/);assert.match(x,/&lt;img/);}
  assert.match(h.c.settingsPage(p),/member&lt;login&gt;/);assert.match(h.c.detailSettings(p),/Org&lt;script&gt;/);
});
