/* ===== 数据层：多项目（优化点：解决写死随州）===== */
var PROJECTS={};














































































































































var STAGES=[['资料准备','上传与授权材料'],['AI 研判','生成缺口与方向'],['确认需求','干部与领导双确认'],['资源匹配','资源端核验匹配'],['招商对接','安排正式沟通']];

/* 项目级阶段链：标准5阶段 + 该项目自定义追加阶段（客户反馈第4章第3条：后续阶段不写死） */
function projStages(p){
  var base=STAGES.map(function(s){return s.slice();});
  if(p && p.customStages && p.customStages.length){
    for(var i=0;i<p.customStages.length;i++) base.push([p.customStages[i],'自定义阶段']);
  }
  return base;
}
function stageNameOf(p,n){
  var st=projStages(p);
  return (n>=1 && st[n-1]) ? st[n-1][0] : '完成';
}
function stageDescOf(p,n){
  var st=projStages(p);
  return (n>=1 && st[n-1]) ? st[n-1][1] : '';
}

/* 项目阶段链：标准5阶段 + 该项目自定义追加阶段（后续不写死） */
function projStages(p){
  var base=STAGES.map(function(s){return s.slice();});
  if(p && p.customStages && p.customStages.length){
    for(var i=0;i<p.customStages.length;i++) base.push([p.customStages[i],'自定义阶段']);
  }
  return base;
}
function stageNameOf(p,n){
  var st=projStages(p);
  return (n>=1 && st[n-1]) ? st[n-1][0] : '完成';
}

