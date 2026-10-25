'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function decl(file,name){const s=read(file),start=s.indexOf('function '+name+'('),end=s.indexOf('\nfunction ',start+1);assert.ok(start>=0,name);return s.slice(start,end<0?s.length:end);}
const ops='frontend/ops/script-03-sections/';
const funnelSource=read(ops+'12-tail.js');
const funnelHelpers=funnelSource.slice(funnelSource.indexOf('function funnelCurrentCompanies('),funnelSource.indexOf('/* ── 企业线索两栏布局渲染'));
function boot(){
 const topic='生物医药产业分析';
 const mk=(focus,key)=>({id:key,isDemand:true,demandContract:'industry-demand-v1',city:'闵行区',org:'招商部门',topic,demandTitle:focus,sourceAnalysisTopic:topic,sourceProjectKey:'workspace',sourcePriorityKey:key,stage:4,submissionState:'submitted',clues:[],selectedPriority:{focus,reason:focus+'的原建议依据',action:focus+'的原建议行动'},demandSpec:{description:'对接'+focus+'生产企业',conditions:'具备'+focus+'产业化能力'}});
 const c={PROJECTS:{a:mk('生物制药滤器','a'),b:mk('色谱填料','b'),workspace:{city:'闵行区',topic,isDemand:false}},OPS_UI:{demands:{query:'',city:''}},REPORTSTATE:{},UPLOADS:{},KB_CONFIRMS:{},DEMANDS:[],OPS_ENT:[],PENDING_CONFIRMS:{},
  _authEscape:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  demandDisplayProject:(_k,p)=>p,projStages:()=>[['资料准备'],['产业分析'],['确认需求'],['资源匹配']],stageNameOf:()=> '资源匹配',stageOptions:()=>'',renderStageLog:()=>'',opsEmpty:(_a,b)=>b,
  URL,fetch:()=>assert.fail('render does not fetch'),persist:()=>assert.fail('render does not write'),console};
 c.window=c;c.__opsProjOpen={a:true,b:true};vm.createContext(c);
 vm.runInContext([decl('frontend/shared/industry-demands.js','industryDemandProjectTitle'),decl(ops+'12-part-00.js','funnelEvidenceLinks'),funnelHelpers,decl(ops+'17.js','opsDemandSpecificationHtml'),decl(ops+'17.js','opsDemandResults'),decl(ops+'17.js','statCell'),decl(ops+'16.js','projKeyByCityTopic')].join('\n'),c);
 return c;
}
async function loadClientReminders(c){
 c.AUTH={user:'recipient',scope:'project',projectKeys:['workspace'],projKey:'workspace'};c._authState='ready';c._authEpoch=1;c.cur='workspace';
 c.PROJECTS.workspace.workspaceId='workspace';c.PROJECTS.a.workspaceId='workspace';c.PROJECTS.b.workspaceId='workspace';
 c._authWorkspaceOf=key=>c.PROJECTS[key]&&c.PROJECTS[key].workspaceId;
 c.document={getElementById:()=>null};c.setTimeout=()=>1;c.clearTimeout=()=>{};
 c.fetch=async url=>{const q=new URL(url,'https://fixture.invalid').searchParams;return {ok:true,status:200,json:async()=>({ok:true,requestId:q.get('requestId'),accountId:'recipient',accountEpoch:'enrollment',projectKey:'workspace',workspaceId:'workspace',version:0,preferences:{statusChanges:true,overdue:true,dailyDigest:true},notifications:[
   {id:'event-a',type:'status',title:'生物制药滤器 · 已进入「资源匹配」',message:'资源匹配',createdAt:100,readAt:null,projectKey:'a',workspaceId:'workspace',sourceId:'source-a'},
   {id:'event-b',type:'status',title:'色谱填料 · 已进入「资源匹配」',message:'资源匹配',createdAt:101,readAt:null,projectKey:'b',workspaceId:'workspace',sourceId:'source-b'},
   {id:'snapshot',type:'daily',title:'每日摘要 · 2 条招商需求',message:'2 条需求的保存快照',createdAt:102,readAt:null,projectKey:'workspace',workspaceId:'workspace',sourceId:'source-day'}
 ]})};};
 vm.runInContext(read('frontend/index/reminders.js'),c);assert.equal(await c.reminderLoad(),true);
}
test('same analysis produces two separately named project cards without changing report topic',()=>{
 const c=boot(),before=JSON.stringify(c.PROJECTS),html=c.opsDemandResults();
 assert.match(html,/2 个项目/);assert.match(html,/font-weight:700">生物制药滤器<\/div>/);assert.match(html,/font-weight:700">色谱填料<\/div>/);
 assert.match(html,/来源分析方向/);assert.match(html,/对应招引建议/);assert.match(html,/对接生物制药滤器生产企业/);assert.match(html,/具备色谱填料产业化能力/);
 assert.equal(JSON.stringify(c.PROJECTS),before);assert.equal(c.PROJECTS.a.topic,'生物医药产业分析');
});
test('search scopes to the specific suggestion, requirement and shared analysis separately',()=>{
 const c=boot();c.OPS_UI.demands.query='滤器产业化';let html=c.opsDemandResults();assert.match(html,/1 个项目/);assert.doesNotMatch(html,/色谱填料/);
 c.OPS_UI.demands.query='生物医药产业分析';html=c.opsDemandResults();assert.match(html,/2 个项目/);
});
test('candidate resource counts stay isolated between two suggestions from the same report',()=>{
 const c=boot();c.OPS_ENT=[{matches:[{projKey:'a',city:'闵行区',pushed:true}]}];c.OPS_UI.demands.query='色谱';let html=c.opsDemandResults();assert.doesNotMatch(html,/已推送待核资源[\s\S]{0,160}>1条/);
 c.OPS_UI.demands.query='滤器';html=c.opsDemandResults();assert.match(html,/已推送待核资源[\s\S]{0,160}>1条/);
});
test('new user-entered titles and requirements are escaped in ops cards and summaries',()=>{
 const c=boot();c.PROJECTS.a.demandTitle='<img src=x onerror=alert(1)>';c.PROJECTS.a.demandSpec.description='<script>alert(2)</script>';const html=c.opsDemandResults();
 assert.doesNotMatch(html,/<img src=x|<script>alert/);assert.match(html,/&lt;img src=x/);assert.match(html,/&lt;script&gt;alert/);
});
test('legacy lookup never chooses the first sibling sharing an analysis or title',()=>{
 const c=boot();assert.equal(c.projKeyByCityTopic('闵行区','生物制药滤器'),'a');c.PROJECTS.b.demandTitle='生物制药滤器';assert.equal(c.projKeyByCityTopic('闵行区','生物制药滤器'),null);
});
test('review notifications and docks preserve the exact child project identity',()=>{
 const c=boot();const d={id:'receipt',projKey:'b',city:'闵行区',topic:'色谱填料',gov:'招商部门·测试',clues:0};c.RESOURCES=[{alias:'测试企业'}];c.DOCK_ITEMS=[{projKey:'a',city:d.city,topic:d.topic,company:'测试企业'}];c.CITY_FUNNEL=[];c.NOTIFS=[];c.matchDemand=()=>d;c.closeModal=()=>{};c.render=()=>{};c.toast=()=>{};
 vm.runInContext(decl(ops+'16.js','doVerify'),c);c.doVerify(0);assert.equal(c.NOTIFS[0].proj,'b');assert.equal(c.DOCK_ITEMS[0].projKey,'b');assert.equal(c.DOCK_ITEMS.length,2);
});
test('new demand details do not present submitter conditions as a resource finding',()=>{
 const c=boot(),d={...c.PROJECTS.a,id:'receipt',topic:'生物制药滤器',gov:'测试',submit:'刚刚',res:'none',resLabel:'待核验',clues:0,note:'用户补充条件'};c.DEMANDS=[d];c.curDemand='receipt';c.RES_COLOR={none:{c:'#888'}};
 for(const file of ['10.js','16.js']){vm.runInContext(decl(ops+file,'opsDetail'),c);const html=c.opsDetail();const block=html.split('<h3>资源端判断</h3>')[1].split('<h3>候选线索</h3>')[0];assert.doesNotMatch(block,/用户补充条件/);assert.match(html,/具备生物制药滤器产业化能力/);}
});

test('source details retain scope and verified HTTPS source text with escaped markup',()=>{
 const c=boot();c.PROJECTS.a.selectedPriority.scope='industry';c.PROJECTS.a.selectedPriority.sources=[{id:'S1',url:'https://example.org/report',title:'原文<标题>',quote:'原文<内容>'},{id:'S2',url:'javascript:alert(1)',quote:'unsafe'}];const html=c.opsDemandSpecificationHtml(c.PROJECTS.a);assert.match(html,/行业共性，非本地缺失/);assert.match(html,/https:\/\/example.org\/report/);assert.match(html,/原文&lt;内容&gt;/);assert.doesNotMatch(html,/javascript:|unsafe/);
});

test('server notification adapter retains each independent demand title and exact target ID',async()=>{
 const c=boot();await loadClientReminders(c);
 const notifications=c.reminderNotifications();assert.equal(notifications.find(n=>n.projectKey==='a').title,'生物制药滤器 · 已进入「资源匹配」');assert.equal(notifications.find(n=>n.projectKey==='b').title,'色谱填料 · 已进入「资源匹配」');assert.match(notifications.find(n=>n.type==='daily').title,/2 条招商需求/);
 c.PROJECTS.a.demandTitle='新标题不应改写旧事件';assert.equal(c.reminderNotifications().find(n=>n.projectKey==='a').title,'生物制药滤器 · 已进入「资源匹配」');
});
test('client demand detail displays the selected requirement while summary counts only demands',()=>{
 const c=boot();c.escapeChainText=c._authEscape;c.demandEffectiveStage=(_k,p)=>p.stage;c.stageDescOf=()=> '资源核验';c.cityKeys=()=>Object.keys(c.PROJECTS);c.STAGES=[['资料'],['分析'],['确认'],['匹配']];c.__projOpen='b';
 vm.runInContext([decl('frontend/shared/industry-demands.js','industryDemandSummaryHtml'),decl('frontend/index/script-02-sections/13.js','detailNeeds'),decl('frontend/index/script-02-sections/13.js','detailDocking')].join('\n'),c);
 let html=c.detailNeeds(c.PROJECTS.b);assert.match(html,/<h2>色谱填料<\/h2>/);assert.match(html,/对接色谱填料生产企业/);assert.match(html,/来自分析：生物医药产业分析/);assert.doesNotMatch(html,/对接生物制药滤器生产企业/);
 c.__projOpen=null;html=c.detailNeeds(c.PROJECTS.workspace);assert.match(html,/2 条招商需求/);assert.doesNotMatch(html,/3 个产业方向|产业分析总数/);
 c.PROJECTS.workspace.stage=5;html=c.detailDocking(c.PROJECTS.workspace);assert.match(html,/资源匹配中：2 个/);assert.match(html,/已进入对接：0 个/);
});
test('opening a demand notification selects and expands only an authorized exact suggestion',async()=>{
 const c=boot();await loadClientReminders(c);let rendered=0;c.render=()=>rendered++;c.toast=()=>{};
 vm.runInContext(decl('frontend/index/script-02-sections/10.js','gotoProjFromNotif'),c);c.gotoProjFromNotif('b');assert.equal(c.cur,'b');assert.equal(c.__projOpen,'b');assert.equal(c.view,'home');assert.equal(rendered,1);assert.equal(c.PROJECTS.b.topic,'生物医药产业分析');
 c.PROJECTS.foreign={workspaceId:'unauthorized'};c.gotoProjFromNotif('foreign');assert.equal(c.cur,'b');assert.equal(rendered,1);
});
