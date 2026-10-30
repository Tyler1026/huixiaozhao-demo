'use strict';
// Called by the HTTP integration test with its actual government /api/sync view.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const data=JSON.parse(fs.readFileSync(0,'utf8'));
function declaration(path,name){const s=fs.readFileSync(path,'utf8'),i=s.indexOf('function '+name+'(');assert.ok(i>=0);const end=s.indexOf('\nfunction ',i+10);return s.slice(i,end<0?s.length:end);}
const c={PROJECTS:data.state.PROJECTS,DEMANDS:data.state.DEMANDS,DOCK_LOGS:data.state.DOCK_LOGS||{},
  URL,Date,console,window:{},_authEpoch:1,cityKeys:()=>Object.keys(data.state.PROJECTS),
  isClueDeleted:()=>false,_projKeyOf:p=>Object.keys(c.PROJECTS).find(k=>c.PROJECTS[k]===p)};
c.window=c;vm.createContext(c);
vm.runInContext([
  declaration('frontend/index/script-02-sections/12-tail.js','escapeChainText'),
  declaration('frontend/index/script-02-sections/12-tail.js','demandSubmissionState'),
  declaration('frontend/index/script-02-sections/11.js','visibleClues'),
  fs.readFileSync('frontend/shared/industry-demands.js','utf8'),
  fs.readFileSync('frontend/shared/docking-actions.js','utf8'),
  fs.readFileSync('frontend/index/docking-workspace.js','utf8')
].join('\n'),c);
assert.ok(c.dockingDemandKeys().includes(data.key),'government demand list includes the exact submitted child');
const clues=c.dockingClues(data.key);assert.equal(clues.length,1);assert.equal(clues[0].name,data.name);
const html=c.dockingClueHtml(data.key,clues[0]);
assert.ok(html.includes(data.name));assert.ok(html.includes('已核对产品适配'));
assert.ok(html.includes('申请核验'));assert.ok(html.includes('投资意向未知'));
assert.equal(c.dockingClues(data.sibling).length,0);
console.log(JSON.stringify({visible:clues.length,rendered:true,requestVerification:true}));
