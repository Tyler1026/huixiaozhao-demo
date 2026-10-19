'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const {fn}=require('./chain_v2_fixture.cjs');
const contextSource=read('frontend/ops/script-03-sections/12-part-00.js');
const tail=read('frontend/ops/script-03-sections/12-tail.js');
const titleSource=read('frontend/shared/industry-demands.js');
const titleStart=titleSource.indexOf('function industryDemandProjectTitle(');
const titleHelper=titleSource.slice(titleStart,titleSource.indexOf('\nfunction ',titleStart+1));
const helper=tail.slice(tail.indexOf('function pushFunnelTopToGov('),tail.indexOf('function toggleFunnelExpand('));
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function boot(){
 const nodes={},calls=[],messages=[];let modal='';
 const c={JSON,Number,Array,String,PROJECTS:{p:{topic:'核电换热',isDemand:true,city:'闵行区',reportRequestId:'r1',clues:[]}},REPORTSTATE:{p:{}},OPS_ENT:[{id:'e0',name:'未匹配甲',matches:[]},{id:'e1',name:'产品乙',matches:[]},{id:'e2',name:'产品丙',matches:[]}],
 document:{getElementById:id=>nodes[id]},_authEscape:String,toast:v=>messages.push(v),openModal:(title,html)=>modal=html,closeModal(){},funnelEvidenceLinks:()=>'',savedEvidenceIdentity:key=>JSON.stringify([c.PROJECTS[key].topic,c.PROJECTS[key].reportRequestId,c.REPORTSTATE[key]]),
 fetch:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return {ok:true,json:async()=>({projectKey:'p',topic:'核电换热',reportRequestId:'r1',source:'resource',evidence_contract:'saved-excerpts-v1',companies:[],demandAnchors:[]})};}};
 c.window=c;vm.createContext(c);vm.runInContext(fn(contextSource,'opsDemandContextRequestId')+'\n'+titleHelper+'\n'+helper,c);
 const functions=read('frontend/ops/script-03-sections/17.js').split('\n').filter(l=>/^function (opsEntPushModal|opsEntDoPush|opsPushEntToCity|opsDoPushToCity)\(/.test(l)).join('\n');vm.runInContext(functions,c);vm.runInContext(read('frontend/ops/script-03-sections/18.js'),c);
 return {c,nodes,calls,messages,modal:()=>modal};
}
test('all duplicated resource push entry points open one exact project selection without writing',()=>{
 for(const trigger of ['opsEntPushModal','opsEntDoPush','opsEntManualPushModal']){
  const h=boot(),before=JSON.stringify([h.c.PROJECTS,h.c.OPS_ENT]);h.c[trigger](1,[]);assert.equal(h.calls.length,0);assert.equal(JSON.stringify([h.c.PROJECTS,h.c.OPS_ENT]),before);assert.match(h.modal(),/请选择项目/);assert.deepEqual(Array.from(h.c.resourceReviewChooseProject.selection.ids),['e1']);
 }
});
test('resource preview is the first request and never silently picks a project',async()=>{
 const h=boot();h.c.opsEntManualPushModal(1);h.c.opsEntDoManualPush();assert.equal(h.calls.length,0);h.nodes.resourceReviewProject={value:'p'};h.c.opsEntDoManualPush();await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'/api/funnel-resource-preview');assert.deepEqual(h.calls[0].body.resourceIds,['e1']);assert.equal(h.calls[0].body.projectKey,'p');assert.match(h.modal(),/不能推送/);assert.equal(h.c.PROJECTS.p.clues.length,0);
});
test('city resource selection uses captured IDs and requires actual checked nodes',async()=>{
 const h=boot();h.c.opsPushEntToCity('p');h.c.opsDoPushToCity('p',3);assert.equal(h.calls.length,0);
 h.nodes['resourceReviewPick-1']={checked:true};h.c.OPS_ENT.reverse();h.c.opsDoPushToCity('p',3);await flush();assert.deepEqual(h.calls[0].body.resourceIds,['e1']);assert.equal(h.calls[0].url,'/api/funnel-resource-preview');
});
test('missing product evidence never creates a push form or any resource/clue mutation',async()=>{
 const h=boot(),before=JSON.stringify([h.c.PROJECTS,h.c.OPS_ENT]);h.c.resourceReviewPreview('p',['e1']);await flush();assert.match(h.modal(),/缺少|没有/);assert.equal(JSON.stringify([h.c.PROJECTS,h.c.OPS_ENT]),before);assert.equal(h.calls.length,1);
});
test('resource preview cannot install a stale workspace response',async()=>{
 const h=boot();let release;h.c.fetch=()=>new Promise(r=>release=r);h.c.resourceReviewPreview('p',['e1']);h.c.PROJECTS.p.reportRequestId='r2';release({ok:true,json:async()=>({})});await flush();assert.match(h.messages.at(-1),/已变化/);assert.equal(h.modal(),'');
});
test('source-backed preview uses same dual-anchor form and sends only source IDs plus review',async()=>{
 const h=boot();const quote='产品乙生产核电换热器用耐蚀管材，产品适用条件需要核对。来源 https://official.example/product';const demand='当前核电项目需要耐蚀换热管材，必须核对技术等级。';
 const preview={projectKey:'p',topic:'核电换热',reportRequestId:'r1',source:'resource',evidence_contract:'saved-excerpts-v1',resourceIds:['e1'],companies:[{name:'产品乙',resourceId:'e1',evidence:[{id:'src1',quote,urls:['https://official.example/product']}]}],demandAnchors:[{id:'report:0',kind:'report',quote:demand}]};
 h.c.fetch=async(url,opts)=>{h.calls.push({url,body:JSON.parse(opts.body)});return {ok:true,json:async()=>url.includes('preview')?preview:{ok:true,added:['产品乙'],skipped:[]}};};h.c.resourceReviewPreview('p',['e1']);await flush();
 h.nodes.funnelReviewError={};h.nodes['funnelReview-0']={checked:true};h.nodes['funnelProduct-0']={value:'0'};h.nodes['funnelDemand-0']={value:'0'};h.nodes['funnelReason-0']={value:'逐项核对耐蚀管材与核电需求的技术范围，仍需验证资质'};
 h.c.confirmFunnelReview('p',1);await flush();const sent=h.calls[1].body;assert.equal(sent.source,'resource');assert.deepEqual(sent.resourceIds,['e1']);assert.equal(sent.reportRequestId,'r1');assert.equal(sent.reviews[0].product.quote,quote);assert.equal(sent.reviews[0].demand.quote,demand);assert.equal('companies' in sent,false);
});

test('resource target chooser lists only submitted demand children and displays their specific titles',()=>{
 const h=boot();h.c.PROJECTS.p.demandContract='industry-demand-v1';h.c.PROJECTS.p.demandTitle='耐蚀换热管材';h.c.PROJECTS.workspace={topic:'宽泛城市产业分析',city:'闵行区',isDemand:false};h.c.opsEntManualPushModal(1);
 assert.deepEqual(Array.from(h.c.resourceReviewChooseProject.selection.keys),['p']);assert.match(h.modal(),/耐蚀换热管材/);assert.doesNotMatch(h.modal(),/宽泛城市产业分析/);
});
