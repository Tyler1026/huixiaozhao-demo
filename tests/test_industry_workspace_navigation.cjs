'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function declaration(source,name){
  const start=source.search(new RegExp('function '+name+'\\('));assert.ok(start>=0,name);
  const rest=source.slice(start+1),next=rest.search(/\nfunction /);
  return source.slice(start,next<0?undefined:start+1+next);
}
function boot(side){
  const folder=path.join(root,'frontend',side,side==='index'?'script-02-sections':'script-03-sections');
  const context={PROJECTS:{workspace:{city:'甲市',workspaceId:'workspace',aiTopics:{list:['甲','乙','丙','丁','戊'].map(label=>({label}))}},demand:{city:'甲市',workspaceId:'workspace',isDemand:true,topic:'专项需求'}},REPORTSTATE:{workspace:{text:'城市报告'},demand:{text:'需求报告'}},AUTH:{scope:'client',projKey:'workspace'},cur:'demand',view:'home',detailData:'old',detailOpen:false,isLocked:()=>false,render(){context.renders++;},renders:0,_authProjectKeys:()=>['workspace']};
  vm.createContext(context);
  vm.runInContext(declaration(fs.readFileSync(path.join(folder,'08.js'),'utf8'),'industryAnalysisWorkspaceKey'),context);
  vm.runInContext(declaration(fs.readFileSync(path.join(folder,side==='index'?'10.js':'11.js'),'utf8'),'go'),context);
  return context;
}
for(const side of ['index','ops']){
  test(side+' main industry navigation restores all saved workspace directions without copying reports',()=>{
    const c=boot(side),before=JSON.stringify([c.PROJECTS,c.REPORTSTATE]);
    c.go('report');assert.equal(c.cur,'workspace');assert.equal(c.view,'report');assert.equal(c.renders,1);
    assert.equal(c.PROJECTS[c.cur].aiTopics.list.length,5);assert.equal(JSON.stringify([c.PROJECTS,c.REPORTSTATE]),before);
  });
  test(side+' other navigation leaves the selected demand and its report intact',()=>{
    const c=boot(side);c.go('home');assert.equal(c.cur,'demand');assert.equal(c.REPORTSTATE.demand.text,'需求报告');
  });
  test(side+' cannot infer a parent from city name or cross an unauthorized workspace',()=>{
    for(const mutate of [c=>delete c.PROJECTS.demand.workspaceId,c=>c.PROJECTS.workspace.city='乙市',c=>c._authProjectKeys=()=>['elsewhere'],c=>c.AUTH=null,c=>c.PROJECTS.workspace.isDemand=true]){
      const c=boot(side);mutate(c);assert.equal(c.industryAnalysisWorkspaceKey('demand'),'demand');
    }
  });
  test(side+' admin uses only the explicitly linked parent and non-demand selection is stable',()=>{
    const c=boot(side);c.AUTH={scope:'admin'};c._authProjectKeys=()=>[];
    assert.equal(c.industryAnalysisWorkspaceKey('demand'),'workspace');assert.equal(c.industryAnalysisWorkspaceKey('workspace'),'workspace');assert.equal(c.industryAnalysisWorkspaceKey('missing'),'missing');
  });
}
