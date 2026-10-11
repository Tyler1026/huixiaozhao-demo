'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../frontend/ops/script-03-sections/17.js'),'utf8');
const code=source.slice(source.indexOf('function enterpriseDraftText('),source.indexOf('\nfunction opsEntSave(){'));
const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
const info={entityName:'甲企业',evidence_contract:'enterprise-draft-v1',evidence_status:'unverified',kind:'火箭研发',revenue:'10亿元',signal:'已签约',tags:[],faction:[],sources:[{url:'https://official.example/company',title:'企业资料'}],field_status:{kind:'draft_unverified',revenue:'draft_unverified'}};
function stream(obj,stop=true){return 'data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(obj)},finish_reason:stop?'stop':null}]})+'\n\ndata: [DONE]\n\n';}
function boot(){
  const nodes={},toasts=[],modals=[],checks=[];
  const c={console,JSON,Math,Date,Promise,URL,_authEpoch:1,OPS_ENT:[{id:'a',name:'甲企业',kind:'原行业',hasMoveSignal:false},{id:'b',name:'乙企业',kind:'乙行业'}],
    document:{getElementById:id=>nodes[id]||null,querySelectorAll:()=>checks,querySelector:s=>nodes[s]||null},
    persist(){},closeModal(){},renderOpsV2(){},toast:x=>toasts.push(x),openModal:(...args)=>modals.push(args),_authEscape:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
    fetch:async()=>({text:async()=>stream(info)})};
  c.window=c;vm.createContext(c);vm.runInContext(code,c);
  return {c,nodes,toasts,modals,checks};
}
test('enterprise completion survives equal polling snapshots and array reorder by stable ID',async()=>{
  const h=boot();let release;h.c.fetch=()=>new Promise(r=>release=r);
  h.c.opsEntAiFillExisting(0);h.c.OPS_ENT=JSON.parse(JSON.stringify(h.c.OPS_ENT)).reverse();
  release({text:async()=>stream(info)});await flush();
  assert.equal(h.c._aiFillPending.target.id,'a');assert.equal(h.c._aiFillPending.idx,undefined);
  assert.match(h.modals[0][0],/甲企业/);assert.match(h.modals[0][1],/https:\/\/official.example\/company/);
  assert.doesNotMatch(h.modals[0][1],/type="checkbox"[^>]* checked/);
});
test('enterprise completion rejects changed entity, deleted identity or a new auth session',async()=>{
  for(const change of ['version','deleted','epoch','rename']){
    const h=boot();let release;h.c.fetch=()=>new Promise(r=>release=r);h.c.opsEntAiFillExisting(0);
    if(change==='version')h.c.OPS_ENT[0].revenue='user edit';
    if(change==='deleted')h.c.OPS_ENT.shift();
    if(change==='epoch')h.c._authEpoch++;
    if(change==='rename')h.c.OPS_ENT[0].name='另一企业';
    release({text:async()=>stream(info)});await flush();
    assert.equal(h.c._aiFillPending,undefined);assert.equal(h.modals.length,0);assert.match(h.toasts.join(' '),/已变化/);
  }
});
test('selected AI fields stay pending with sources and can never set an investment signal',async()=>{
  const h=boot();h.c.opsEntAiFillExisting(0);await flush();h.c.OPS_ENT.reverse();
  h.checks.push({checked:true,dataset:{field:'kind'}},{checked:true,dataset:{field:'signal'}});
  h.nodes['#modalLayer input[data-fieldval="kind"]']={value:'火箭研发'};
  h.nodes['#modalLayer input[data-fieldval="signal"]']={value:'已签约'};
  h.c.applyAiFill();const a=h.c.OPS_ENT.find(e=>e.id==='a'),b=h.c.OPS_ENT.find(e=>e.id==='b');
  assert.equal(a.kind,'火箭研发');assert.equal(b.kind,'乙行业');assert.equal(a.signal,undefined);assert.equal(a.hasMoveSignal,false);
  assert.equal(a.aiEvidence.kind.status,'pending');assert.equal(a.aiEvidence.kind.sources[0].url,'https://official.example/company');
  assert.equal(a.aiEvidenceStatus,'pending');
});
test('confirmation rejects edits made after the draft was shown',async()=>{
  const h=boot();h.c.opsEntAiFillExisting(0);await flush();h.c.OPS_ENT[0].kind='人工修改';
  h.checks.push({checked:true,dataset:{field:'kind'}});h.c.applyAiFill();
  assert.equal(h.c.OPS_ENT[0].kind,'人工修改');assert.match(h.toasts.join(' '),/已变化/);
});
test('new enterprise form never receives stale entity output or model investment intent',async()=>{
  for(const stale of [true,false]){
    const h=boot();for(const field of ['name','kind','region','revenue','employees','gap','tags','faction','signal','note','ai-btn','ai-status'])h.nodes['oe-'+field]={value:field==='name'?'甲企业':'',style:{}};
    let release;h.c.fetch=()=>new Promise(r=>release=r);h.c._enterpriseAddToken=1;h.c.opsEntAiFill();
    if(stale)h.nodes['oe-name'].value='乙企业';
    release({text:async()=>stream(info)});await flush();
    assert.equal(h.nodes['oe-kind'].value,stale?'':'火箭研发');assert.equal(h.nodes['oe-signal'].value,'');
    if(!stale){assert.match(h.nodes['oe-ai-status'].innerHTML,/待核验/);h.c.opsEntSaveV2();const a=h.c.OPS_ENT.at(-1);assert.equal(a.aiEvidenceStatus,'pending');assert.equal(a.aiSources[0].url,'https://official.example/company');assert.equal(a.hasMoveSignal,false);}
  }
});
test('enterprise parser rejects missing contract or truncated response and unsafe sources',()=>{
  const h=boot();assert.throws(()=>h.c.enterpriseDraftInfo(stream({kind:'未经核验'}),'甲企业'),/来源/);
  assert.throws(()=>h.c.enterpriseDraftInfo(stream(info,false),'甲企业'),/未完成/);
  const out=h.c.enterpriseDraftInfo(stream({...info,sources:[{url:'javascript:alert(1)'},{url:'https://u:p@bad.example'}]}),'甲企业');
  assert.equal(out.sources.length,0);assert.equal(out.signal,'');assert.equal(out.hasMoveSignal,false);
  const html=h.c.enterpriseDraftSourcesHTML({sources:[{url:'javascript:alert(1)'},{url:'https://u:p@bad.example'},info.sources[0],info.sources[0]]});
  assert.doesNotMatch(html,/javascript|bad\.example/);assert.equal((html.match(/<a /g)||[]).length,1);
});
