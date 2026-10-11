'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const profile=read('frontend/ops/script-03-sections/17.js');
const source=read('frontend/ops/script-03-sections/12-part-00.js');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function boot(response){
  let calls=0,finishes=0;
  const old={summary:'previous completed profile'};
  const c={JSON,Promise,console,PROJECTS:{a:{id:'a',topic:'当前方向',city:'测试区',reportRequestId:'r1',profile:old}},REPORTSTATE:{},_authEpoch:1,cpBusy:false,cpErr:'',cpRaw:'',cpProjKey:()=> 'a',cpCorpus:()=>[{text:'saved evidence'}],cpOnboarding:()=>null,renderOpsV2(){},cpFinish(){finishes++;},fetch:async()=>{calls++;return response;},readTopicReportStream(){throw Error('non-200 must not enter stream reader');}};
  c.window=c;vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('function savedEvidenceIdentity('),source.indexOf('function runAIFunnel(')),c);
  vm.runInContext(profile.slice(profile.indexOf('function cpGenerate('),profile.indexOf('/* 【2026-09-17】JSON')),c);
  return {c,old,calls:()=>calls,finishes:()=>finishes};
}
test('profile shows safe conflict detail, preserves old profile and does not retry',async()=>{
  const h=boot({ok:false,status:409,json:async()=>({code:'evidence_changed',message:'材料已更新；旧结果已保留，请刷新后重新生成。'})});
  h.c.cpGenerate(1);await flush();
  assert.match(h.c.cpErr,/材料已更新.*旧结果已保留.*重新生成/);
  assert.equal(h.c.PROJECTS.a.profile,h.old);assert.equal(h.c.cpBusy,false);assert.equal(h.calls(),1);assert.equal(h.finishes(),0);
});
test('non-JSON conflicts remain actionable and unknown upstream text stays private',async()=>{
  for(const response of [{ok:false,status:409,json:async()=>{throw Error('html');}},{ok:false,status:502,json:async()=>({code:'provider_secret',message:'SECRET_PROVIDER_PAYLOAD'})}]){
    const h=boot(response);h.c.cpGenerate(1);await flush();
    assert.match(h.c.cpErr,/旧.*已保留/);assert.doesNotMatch(h.c.cpErr,/SECRET/);assert.equal(h.calls(),1);assert.equal(h.finishes(),0);
  }
});
