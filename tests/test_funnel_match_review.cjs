'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../frontend/ops/script-03-sections/12-tail.js'),'utf8');
const code=src.slice(src.indexOf('function pushFunnelTopToGov('),src.indexOf('function toggleFunnelExpand('));
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function boot(count=1){
 const product='甲公司生产核电换热器耐蚀管材，需要核查合格供应商资质。来源 https://official.example/a';
 const demand='当前需求是核电换热器耐蚀管材，并须逐项核查产品资质和技术条件。';
 const names=['甲公司','乙公司'];
 const fn={topic:'核电换热配套',reportRequestId:'r1',evidence_contract:'saved-excerpts-v1',companies:names.slice(0,count).map((name,i)=>({name,evidence:[{id:'src'+i,quote:product.replace('甲公司',name),urls:['https://official.example/'+i]}]}))};
 const nodes={},calls=[],toasts=[];let modal='';
 const c={JSON,Number,Array,PROJECTS:{p:{topic:fn.topic,funnel:fn}},REPORTSTATE:{p:{topic:fn.topic,phaseByTopic:{[fn.topic]:2},aiReportByTopic:{[fn.topic]:demand}}},document:{getElementById:id=>nodes[id]},
  _authEscape:v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),funnelEvidenceLinks:()=>'',savedEvidenceIdentity:(key,topic)=>JSON.stringify([c.PROJECTS[key].topic,c.REPORTSTATE[key]]),
  openModal:(title,body)=>{modal=body;},closeModal(){},toast:t=>toasts.push(t),fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true,added:['甲公司'],skipped:[]})};}};
 c.window=c;vm.createContext(c);vm.runInContext(code,c);
 function open(){c.pushFunnelTopToGov('p',8);nodes.funnelReviewError={};for(let i=0;i<count;i++){nodes['funnelReview-'+i]={checked:false};nodes['funnelProduct-'+i]={value:''};nodes['funnelDemand-'+i]={value:''};nodes['funnelReason-'+i]={value:''};nodes['funnelProductText-'+i]={};nodes['funnelDemandText-'+i]={};}}
 function fill(i=0){nodes['funnelReview-'+i].checked=true;nodes['funnelProduct-'+i].value='0';nodes['funnelDemand-'+i].value='0';nodes['funnelReason-'+i].value='逐项对照耐蚀管材与当前技术要求，仍需验证供应商资质';}
 return {c,nodes,calls,toasts,open,fill,modal:()=>modal,product,demand};
}

test('review dialog shows source and demand choices with independent reasons, never a shared blanket approval',()=>{
 const h=boot(2);h.open();assert.match(h.modal(),/funnelReason-0/);assert.match(h.modal(),/funnelReason-1/);assert.doesNotMatch(h.modal(),/funnelReviewNote/);
 assert.equal(h.nodes['funnelReview-0'].checked,false);h.fill();h.c.funnelReviewAnchorChange(0);
 assert.equal(h.nodes.funnelProductText_0,undefined);assert.equal(h.nodes['funnelProductText-0'].textContent,h.product);assert.equal(h.nodes['funnelDemandText-0'].textContent,h.demand);
});
test('missing either anchor or per-company reason prevents any request',()=>{
 for(const field of ['product','demand','reason']){const h=boot();h.open();h.fill();h.nodes[{product:'funnelProduct-0',demand:'funnelDemand-0',reason:'funnelReason-0'}[field]].value='';h.c.confirmFunnelReview('p',1);assert.equal(h.calls.length,0);assert.match(h.nodes.funnelReviewError.textContent,/每家/);}
});
test('successful payload has exact source quote, demand anchor ID and individual human review',async()=>{
 const h=boot();h.open();h.fill();h.c.confirmFunnelReview('p',1);await flush();assert.equal(h.calls.length,1);const b=h.calls[0].body;
 assert.equal('reviewNote' in b,false);assert.deepEqual(b.names,['甲公司']);assert.equal(b.reviews[0].product.evidenceId,'src0');assert.equal(b.reviews[0].product.quote,h.product);assert.equal(b.reviews[0].demand.anchorId,'report:0');assert.equal(b.reviews[0].demand.quote,h.demand);assert.equal(b.reviews[0].confirmed,true);
});
test('second unchecked review stays absent and invalid selected review blocks the whole request',()=>{
 const h=boot(2);h.open();h.fill(0);h.nodes['funnelReview-1'].checked=true;h.c.confirmFunnelReview('p',2);assert.equal(h.calls.length,0);
});
test('equal polling snapshot survives but changed report, topic or candidate closes the review boundary',async()=>{
 const h=boot();h.open();h.fill();h.c.PROJECTS=JSON.parse(JSON.stringify(h.c.PROJECTS));h.c.REPORTSTATE=JSON.parse(JSON.stringify(h.c.REPORTSTATE));h.c.confirmFunnelReview('p',1);await flush();assert.equal(h.calls.length,1);
 for(const change of ['report','topic','candidate']){const q=boot();q.open();q.fill();if(change==='report')q.c.REPORTSTATE.p.aiReportByTopic[q.c.PROJECTS.p.topic]+='变化';if(change==='topic')q.c.PROJECTS.p.topic='另一方向';if(change==='candidate')q.c.PROJECTS.p.funnel.companies[0].evidence[0].quote+='变化';q.c.confirmFunnelReview('p',1);assert.equal(q.calls.length,0);assert.match(q.nodes.funnelReviewError.textContent,/已变化/);}
});
test('no completed or confirmed demand and empty candidate lists cannot open a push form',()=>{
 const h=boot();h.c.REPORTSTATE.p.phaseByTopic[h.c.PROJECTS.p.topic]=1;h.open();assert.equal(h.modal(),'');assert.match(h.toasts[0],/完成当前方向报告/);
 const q=boot(0);q.open();assert.equal(q.modal(),'');assert.match(q.toasts[0],/不代表现实中不存在/);
});
test('confirmed edited demand preserves the edited text and never admits an unconfirmed item',()=>{
 const h=boot();const topic=h.c.PROJECTS.p.topic;h.c.REPORTSTATE.p.phaseByTopic[topic]=1;h.c.REPORTSTATE.p.pendingByTopic={[topic]:[{status:'pending',text:'这个尚未确认的需求原句不可进入人工核对'},{status:'edited',text:'旧需求原句不得使用',editedText:'已确认且修改过的高温耐蚀管材需求原句'}]};
 const a=h.c.funnelReviewDemandAnchors('p',topic);assert.equal(a.length,1);assert.equal(a[0].id,'confirmation:1');assert.equal(a[0].quote,'已确认且修改过的高温耐蚀管材需求原句');
});
function declaration(text,name){const start=text.indexOf('function '+name+'(');const next=text.indexOf('\nfunction ',start+10);return text.slice(start,next<0?text.length:next);}
test('legacy automatic derivation is a no-op in both applications and preserves saved records',()=>{
 for(const page of ['index/script-02-sections','ops/script-03-sections']){
  const text=fs.readFileSync(path.join(__dirname,'../frontend/'+page+'/12-tail.js'),'utf8');
  const c={PROJECTS:{p:{clues:[{id:'old',name:'已保存企业'}]}},REPORTSTATE:{p:{text:'TOP5\n❌缺失关键材料'}}};
  const before=JSON.stringify(c);vm.createContext(c);vm.runInContext(declaration(text,'deriveCluesFromReport'),c);c.deriveCluesFromReport('p');assert.equal(JSON.stringify(c),before);
 }
});
test('viewing project management neither synthesizes companies nor starts AI work',()=>{
 const c={PROJECTS:{p:{id:'p',topic:'核电换热需求',city:'闵行区',stage:1,clues:[]}},REPORTSTATE:{p:{text:'TOP5\n❌缺失关键材料'}},stColor:()=>({bg:'#fff',dot:'#000',fg:'#000'}),stageName:()=> '准备',stageNameOf:()=> '准备',
  deriveCluesFromReport:()=>{throw Error('automatic derivation');},runAIFunnel:()=>{throw Error('automatic AI');},_authEscape:String};
 c.window=c;vm.createContext(c);vm.runInContext(declaration(src,'projMgmtPage'),c);const before=JSON.stringify(c.PROJECTS);const html=c.projMgmtPage(c.PROJECTS.p);assert.ok(html.includes('核电换热需求'));assert.equal(JSON.stringify(c.PROJECTS),before);
});
test('legacy convert action opens only the selected company review and changes no clue status',()=>{
 const h=boot(2);h.c.PROJECTS.p.clues=[{id:'old',name:'乙公司',status:'ai_scan'}];vm.runInContext(declaration(src,'convertToClue'),h.c);const before=JSON.stringify(h.c.PROJECTS.p.clues);h.c.convertToClue('p','old');assert.equal(JSON.stringify(h.c.PROJECTS.p.clues),before);assert.equal(h.c.pushFunnelTopToGov.review.companies.length,1);assert.equal(h.c.pushFunnelTopToGov.review.companies[0].name,'乙公司');assert.equal(h.calls.length,0);
});
test('completed empty material result shows no push button and does not imply absence',()=>{
 const h=boot(0);h.c.PROJECTS.p.clues=[];h.c._funnelRunning={};h.c.__funnelExpand={};vm.runInContext(declaration(src,'renderCluesTwoPanel'),h.c);const html=h.c.renderCluesTwoPanel('p');assert.match(html,/不代表现实中不存在/);assert.doesNotMatch(html,/onclick="pushFunnelTopToGov/);
});
