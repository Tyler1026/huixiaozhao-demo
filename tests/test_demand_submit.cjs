'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fn}=require('./chain_v2_fixture.cjs');
const root=path.join(__dirname,'..');
for(const side of ['index','ops']){
 const dir=path.join(root,'frontend',side,side==='index'?'script-02-sections':'script-03-sections');
 const tail=fs.readFileSync(path.join(dir,'12-tail.js'),'utf8'),last=fs.readFileSync(path.join(dir,'14-tail.js'),'utf8');
 test(side+' every legacy demand entry requires selecting a reviewed suggestion before submission',()=>{
  const calls=[];const c={chooseIndustryDemand(){calls.push('choose');return false;},fetch(){assert.fail('entry cannot submit a whole topic');},persist(){assert.fail('entry cannot create local-only demand');}};vm.createContext(c);
  for(const [source,name] of [[tail,'submitDemand'],[tail,'importToProject'],[last,'submitNeed'],[last,'syncDemandFromProject']]){
   vm.runInContext(fn(source,name),c);assert.equal(c[name](),false,name);
  }
  assert.equal(calls.length,4);
 });
 test(side+' legacy lookup retains meaningful words and never collapses independent suggestions',()=>{
  const c={cur:'parent',PROJECTS:{parent:{city:'闵行区',topic:'新能源'},legacy:{city:'闵行区',topic:'新能源设备补链',isDemand:true},other:{city:'闵行区',topic:'设备',isDemand:true},a:{city:'闵行区',topic:'共同分析方向',isDemand:true,demandContract:'industry-demand-v1'},b:{city:'闵行区',topic:'共同分析方向',isDemand:true,demandContract:'industry-demand-v1'}},_projectWorkspaceId:()=> 'workspace',_authWorkspaceOf:()=> 'workspace'};
  vm.createContext(c);vm.runInContext(fn(tail,'_normalizeTopic')+'\n'+fn(tail,'_findExistingDemand'),c);
  assert.equal(c._normalizeTopic(' 新能源设备补链 '),'新能源设备补链');
  assert.equal(c._findExistingDemand('闵行区','新能源设备补链'),'legacy');assert.equal(c._findExistingDemand('闵行区','设备'),'other');
  assert.equal(c._findExistingDemand('闵行区','新能源设备'),null);assert.equal(c._findExistingDemand('闵行区','共同分析方向'),null);
  c._authWorkspaceOf=()=> 'foreign';assert.equal(c._findExistingDemand('闵行区','新能源设备补链'),null);
 });
 if(side==='index')test('loading historical demands never deletes records using a title heuristic',()=>{
  const c={PROJECTS:{a:{isDemand:true,city:'闵行区',topic:'设备'},b:{isDemand:true,city:'闵行区',topic:'设备'}},DEMANDS:[{projKey:'a'},{projKey:'b'}],REPORTSTATE:{a:{text:'甲'},b:{text:'乙'}}};const before=JSON.stringify(c);vm.createContext(c);vm.runInContext(fn(tail,'_dedupeDemands'),c);assert.equal(c._dedupeDemands(),0);assert.equal(JSON.stringify(c),before);
 });
}
