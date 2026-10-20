'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),topic='核电换热设备',report='当前方向的报告保留完整材料、来源和待核说明。'.repeat(12);
const clone=value=>JSON.parse(JSON.stringify(value));
function fn(source,name){const start=source.search(new RegExp('(?:async )?function '+name+'\\('));assert.ok(start>=0,name);const next=source.slice(start+1).search(/\n(?:async )?function /);return source.slice(start,next<0?undefined:start+1+next);}
function gate(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function setup(app){
 const folder=app==='index'?'script-02-sections':'script-03-sections',source=fs.readFileSync(path.join(root,'frontend',app,folder,'12-tail.js'),'utf8');
 const events={posts:[],requests:[],models:0,renders:0,toasts:[]},storage={};
 let server={},syncGate=null,modelGate=null,syncFailure=null,modelFailure=null,transform=x=>x,streamOptions={},storageWorks=true;
 const c={PROJECTS:{p:{id:'p',city:'闵行区',topic,reportRequestId:'r1',kb:[{t:'基础',known:['原始材料']}]}},REPORTSTATE:{p:{topic,text:report,aiReportByTopic:{[topic]:report}}},KB_EDITS:{},KB_CONFIRMS:{},KB_CONFIRM_TOMBS:{},KB_ITEM_TOMBS:{},UPLOADS:{},UPLOAD_TOMBS:{},KB_FILE_CHUNKS:{},cur:'p',view:'report',_authEpoch:1,_chainGenInFlight:{},window:{},LS_KEY:'state',KB_API:'/api/kb-chat',Date,JSON,Number,String,URL,AbortController,TextEncoder,TextDecoder,console,
  P:()=>c.PROJECTS[c.cur],localStorage:{getItem:k=>storage[k]||null},setTimeout:()=>1,clearTimeout(){},document:{getElementById:()=>null},render(){events.renders++;},toast:t=>events.toasts.push(t),reportTextForTopic:t=>(c.REPORTSTATE.p.aiReportByTopic||{})[t]||null};
 const fields=['PROJECTS','REPORTSTATE','KB_EDITS','KB_CONFIRMS','KB_CONFIRM_TOMBS','KB_ITEM_TOMBS','UPLOADS','UPLOAD_TOMBS','KB_FILE_CHUNKS'];
 const snapshot=()=>Object.fromEntries(fields.map(k=>[k,clone(c[k])]));
 c.persist=()=>{if(!storageWorks)throw Error('quota');storage.state=JSON.stringify(snapshot());};
 function resultFor(state){const p=state.PROJECTS.p,rs=state.REPORTSTATE.p;return {type:'chain.result',saved:true,chain:[{seg:'上游',nodes:[{name:'核级换热器',level:'unknown',status:'reported',verification_status:'unverified',sources:[{id:'S1',url:'https://official.example/material',quote:'核级换热器的原始材料说明。'}]}]},{seg:'中游',nodes:[]},{seg:'下游',nodes:[]}],unclassified:[],status:'partial',evidence:{contract:'source-bound-chain-v2',scope:'current-topic-v2',topic,requestId:p.reportRequestId,reportText:rs.aiReportByTopic[topic],sourceIdentity:c.savedEvidenceIdentity('p',topic,state),inputFingerprint:'server-input-fingerprint',generatedAt:1760000000000,taxonomy:{id:'generic-v1',label:'通用产业口径',description:'公开分类依据，不表示本地已有能力。'}}};}
 c.fetch=async(url,init)=>{
  if(url==='/api/sync'){
   if(!init||init.method!=='POST')throw Error('unexpected client readback');
   events.posts.push(clone(JSON.parse(init.body)));server=snapshot();
   if(syncGate)await syncGate.promise;if(syncFailure)throw syncFailure;
   return {ok:true,json:async()=>({ok:true})};
  }
  assert.equal(url,'/api/kb-chat');events.models++;events.requests.push(clone(JSON.parse(init.body)));
  let event=transform(resultFor(server));if(modelGate)await modelGate.promise;
  if(modelFailure)return {ok:false,status:modelFailure.status,json:async()=>modelFailure.body};
  if(event){server.REPORTSTATE.p.chainByTopic={[topic]:clone(event.chain)};server.REPORTSTATE.p.chainUnclassifiedByTopic={[topic]:clone(event.unclassified)};server.REPORTSTATE.p.chainEvidenceByTopic={[topic]:clone(event.evidence)};server.REPORTSTATE.p.chainStatusByTopic={[topic]:event.status};}
  const wire=['data: '+JSON.stringify({type:'chain.status',message:'正在核对来源…'})];
  if(event&&!streamOptions.omitResult)wire.push('data: '+JSON.stringify(event));
  wire.push('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(event?event.chain:[])}}]}));
  if(streamOptions.error)wire.push('data: '+JSON.stringify({error:{message:streamOptions.error}}));
  if(streamOptions.finish!==null)wire.push('data: '+JSON.stringify({choices:[{delta:{},finish_reason:streamOptions.finish||'stop'}]}));
  wire.push('data: [DONE]');return {ok:true,text:async()=>wire.join('\n\n')};
 };
 vm.createContext(c);
 const auth=fs.readFileSync(path.join(root,'frontend',app,folder,app==='index'?'03.js':'17.js'),'utf8');vm.runInContext(fn(auth,'_safeSyncSnapshot'),c);
 const shared=fs.readFileSync(path.join(root,'frontend',app,folder,'12-part-00.js'),'utf8');
 if(app==='ops')vm.runInContext(fn(shared,'opsDemandContextRequestId'),c);
 vm.runInContext(fn(shared,'savedEvidenceIdentity'),c);
 for(const name of ['_correctChainLevel','chainSnapshotIdentity','chainSourceIdentity','chainEvidenceMatches','currentEvidenceChain','chainInputSnapshot','readTopicReportStream','syncTopicReportInputs','generateChainFromReport','requestChainGeneration','escapeChainText','chainSafeSourceUrl','chainNodeSources','chainNodeEvidenceState','chainNodeEvidenceHtml','chainNodeSourcesHtml','actualWeaknessView','chainAssessmentView','chainAssessmentBadge','chainAssessmentDate','chainAssessmentFindings','chainAssessmentFindingHtml','chainAssessmentDetails','chainAssessmentPanel','chainNeedsAssessment','chainNodeCardHtml','_renderRichChain','chainGenerationStatusHtml','chainMapHtml'])vm.runInContext(fn(source,name),c);
 return {c,events,storage,snapshot,server:()=>clone(server),setSyncGate:v=>syncGate=v,setModelGate:v=>modelGate=v,setSyncFailure:v=>syncFailure=v,setModelFailure:v=>modelFailure=v,setTransform:v=>transform=v,setStream:v=>streamOptions=v,setStorage:v=>storageWorks=v};
}
async function modelStarted(e){for(let i=0;i<50&&!e.events.models;i++)await new Promise(setImmediate);assert.equal(e.events.models,1);}
function cache(e){const {c}=e;const evidence={contract:'source-bound-chain-v2',scope:'current-topic-v2',topic,requestId:'r1',reportText:report,sourceIdentity:c.savedEvidenceIdentity('p',topic),inputFingerprint:'previous-server-fingerprint',generatedAt:1};c.REPORTSTATE.p.chainByTopic={[topic]:[{seg:'中游',nodes:[{name:'已有图谱',level:'unknown'}]}]};c.REPORTSTATE.p.chainEvidenceByTopic={[topic]:evidence};c.REPORTSTATE.p.chainStatusByTopic={[topic]:'ready'};return clone(c.REPORTSTATE.p.chainByTopic);}
module.exports={setup,gate,modelStarted,cache,clone,topic,report,fn};
