/* Existing-demand navigation is based on this session's server receipts, not
 * browser-restored drafts. This does not replace authorization at any API. */
var SUBMITTED_DEMAND_ACCESS=null, SUBMITTED_DEMAND_READ_SERIAL=0;
function submittedDemandAuthIdentity(){
  if(typeof AUTH==='undefined'||!AUTH||AUTH.scope!=='project'||_authState!=='ready'||
      typeof AUTH.user!=='string'||!AUTH.user||typeof AUTH.projKey!=='string'||!AUTH.projKey||
      !Array.isArray(AUTH.projectKeys)||AUTH.projectKeys.indexOf(AUTH.projKey)<0)return null;
  return JSON.stringify([_authEpoch,AUTH.user,AUTH.scope,AUTH.role,AUTH.projKey,
    AUTH.projectKeys.slice().sort(),typeof RESET_GEN==='undefined'?null:RESET_GEN]);
}
function resetSubmittedDemandAccess(){SUBMITTED_DEMAND_ACCESS=null;SUBMITTED_DEMAND_READ_SERIAL++;}
function submittedDemandReadToken(){return {identity:submittedDemandAuthIdentity(),serial:++SUBMITTED_DEMAND_READ_SERIAL};}
function submittedDemandReadCurrent(token){return !!token&&!!token.identity&&token.identity===submittedDemandAuthIdentity()&&token.serial===SUBMITTED_DEMAND_READ_SERIAL;}
function submittedDemandStable(value){
  if(Array.isArray(value))return value.map(submittedDemandStable);
  if(value&&typeof value==='object'){var result={};Object.keys(value).sort().forEach(function(k){result[k]=submittedDemandStable(value[k]);});return result;}
  return value;
}
function submittedDemandProof(key,projects,demands,tombs){
  var root=AUTH.projKey,p=projects&&projects[key],base=projects&&projects[root];
  if(!p||!base||key===root||base.isDemand===true||base.deleted===true||base.archived===true||
      (base.workspaceId!=null&&base.workspaceId!==root)||
      !Array.isArray(demands)||!Array.isArray(tombs)||tombs.indexOf(key)>=0||tombs.indexOf(root)>=0||
      p.id!==key||p.isDemand!==true||p.demandContract!=='industry-demand-v1'||p.submissionState!=='submitted'||
      p.workspaceId!==root||p.parentProjectKey!==root||p.deleted===true||p.archived===true||p.cancelled===true||p.closed===true||p.completed===true||
      typeof p.city!=='string'||!p.city||p.city!==base.city||typeof p.demandTitle!=='string'||!p.demandTitle||
      !Number.isSafeInteger(p.submittedAt)||p.submittedAt<=0||typeof p.submittedBy!=='string'||!p.submittedBy||
      !p.demandSpec||typeof p.demandSpec!=='object'||Array.isArray(p.demandSpec))return null;
  var rows=demands.filter(function(d){return d&&d.projKey===key;});
  if(rows.length!==1)return null;
  var d=rows[0],spec=p.demandSpec;
  if(typeof d.id!=='string'||!d.id||demands.filter(function(row){return row&&row.id===d.id;}).length!==1||
      d.deleted===true||d.archived===true||d.demandContract!==p.demandContract||d.demandOrigin!==p.demandOrigin||
      d.city!==p.city||d.demandTitle!==p.demandTitle||d.topic!==p.demandTitle||
      d.submittedAt!==p.submittedAt||d.submittedBy!==p.submittedBy||spec.title!==p.demandTitle||
      typeof spec.description!=='string'||!spec.description||d.need!==spec.description||d.note!==(spec.conditions||'')||
      JSON.stringify(submittedDemandStable(d.demandSpec))!==JSON.stringify(submittedDemandStable(spec)))return null;
  var lineage;
  if(p.demandOrigin==='direct'){
    if(spec.source!=='user_direct'||p.topic!==p.demandTitle||typeof p.directRequestId!=='string'||!p.directRequestId||
        d.directRequestId!==p.directRequestId||!/^[0-9a-f]{64}$/.test(p.directRequestFingerprint||'')||
        d.directRequestFingerprint!==p.directRequestFingerprint)return null;
    lineage=[p.directRequestId,p.directRequestFingerprint];
  }else if(p.demandOrigin==='report'){
    if(spec.source!=='user_confirmed'||p.sourceProjectKey!==root||d.sourceProjectKey!==root||
        typeof p.sourceAnalysisTopic!=='string'||!p.sourceAnalysisTopic||p.topic!==p.sourceAnalysisTopic||
        d.analysisTopic!==p.sourceAnalysisTopic||typeof p.sourcePriorityKey!=='string'||!p.sourcePriorityKey||
        d.sourcePriorityKey!==p.sourcePriorityKey||typeof p.sourceReportIdentity!=='string'||!p.sourceReportIdentity||
        !/^[0-9a-f]{64}$/.test(p.sourceReportFingerprint||'')||
        JSON.stringify(submittedDemandStable(d.selectedPriority))!==JSON.stringify(submittedDemandStable(p.selectedPriority)))return null;
    lineage=[p.sourceProjectKey,p.sourceAnalysisTopic,p.sourcePriorityKey,p.sourceReportIdentity,p.sourceReportFingerprint,p.selectedPriority];
  }else return null;
  return JSON.stringify(submittedDemandStable([key,root,p.city,p.demandTitle,p.topic,p.submittedAt,p.submittedBy,p.demandOrigin,spec,d.id,lineage]));
}
function acceptSubmittedDemandSnapshot(server,token){
  var identity=submittedDemandAuthIdentity();
  if(!identity||!submittedDemandReadCurrent(token))return false;
  var proofs=Object.create(null),projects=server&&server.PROJECTS,demands=server&&server.DEMANDS;
  if(projects&&typeof projects==='object'&&!Array.isArray(projects)&&Array.isArray(demands)){
    Object.keys(projects).forEach(function(key){var proof=submittedDemandProof(key,projects,demands,server.DELETED_PROJECTS||[]);if(proof)proofs[key]=proof;});
  }
  // A newer authoritative empty/deleted result revokes previous navigation proof.
  SUBMITTED_DEMAND_ACCESS={identity:identity,proofs:proofs};return true;
}
function acceptSubmittedDemandCreated(result,identity){
  if(!identity||identity!==submittedDemandAuthIdentity()||!result||!result.project||!result.demand)return false;
  var projects=Object.assign({},PROJECTS);projects[result.projectKey]=result.project;
  var proof=submittedDemandProof(result.projectKey,projects,[result.demand],typeof DELETED_PROJECTS==='undefined'?[]:DELETED_PROJECTS);
  if(!proof)return false;
  // A creation receipt is newer than any previously started full-state request.
  SUBMITTED_DEMAND_READ_SERIAL++;
  if(!SUBMITTED_DEMAND_ACCESS||SUBMITTED_DEMAND_ACCESS.identity!==identity)SUBMITTED_DEMAND_ACCESS={identity:identity,proofs:Object.create(null)};
  SUBMITTED_DEMAND_ACCESS.proofs[result.projectKey]=proof;return true;
}
function hasServerSubmittedDemand(){
  var identity=submittedDemandAuthIdentity(),access=SUBMITTED_DEMAND_ACCESS;
  if(!identity||!access||access.identity!==identity||typeof cur!=='string'||
      typeof _authWorkspaceOf!=='function'||_authWorkspaceOf(cur)!==AUTH.projKey)return false;
  var tombs=typeof DELETED_PROJECTS==='undefined'?[]:DELETED_PROJECTS;
  return Object.keys(access.proofs).some(function(key){
    var proof=submittedDemandProof(key,PROJECTS,typeof DEMANDS==='undefined'?[]:DEMANDS,tombs);
    if(proof===access.proofs[key])return true;
    delete access.proofs[key];return false;
  });
}
