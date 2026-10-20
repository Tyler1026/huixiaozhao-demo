/* Card presentation is semantic and independent of its position in the data. */
function kbTopicPresentation(title){
  var name=String(title==null?'':title).replace(/\s+/g,'');
  var exact={
    '主导产业与产业链':{icon:'industry-chain',art:'research',theme:'industry'},
    '园区与承载条件':{icon:'city',art:'city',theme:'park'},
    '链主与存量企业':{icon:'enterprise',art:'collaboration',theme:'enterprise'},
    '政策、规划与领导关注':{icon:'document',art:'policy',theme:'policy'}
  };
  if(Object.prototype.hasOwnProperty.call(exact,name))return exact[name];
  var rules=[
    [/政策|规划|领导|法规|制度|扶持/,'document','policy','policy'],
    [/科技|创新|研发|科创|专利/,'technology','research','technology'],
    [/人才|团队|人力|就业/,'team','collaboration','talent'],
    [/金融|资金|基金|融资|资本/,'funding','collaboration','finance'],
    [/营商|公共服务|政务|配套服务/,'public-service','city','services'],
    [/区位|交通|物流|通达|港口/,'transportation','city','location'],
    [/园区|承载|载体|厂房|土地|空间/,'industrial-park','city','park'],
    [/链主|存量|企业|公司|名录/,'enterprise','collaboration','enterprise'],
    [/产业|工业|集群/,'industry-chain','research','industry']
  ];
  for(var i=0;i<rules.length;i++)if(rules[i][0].test(name))return {icon:rules[i][1],art:rules[i][2],theme:rules[i][3]};
  return {icon:'knowledge-library',art:'research',theme:'general'};
}
function kbTopicArtwork(title){
  var images=typeof HXZ_BRAND_IMAGES==='object'&&HXZ_BRAND_IMAGES||{};
  return images[kbTopicPresentation(title).art]||images.research||'';
}
function kbTopicColumns(count){
  count=Number(count);
  if(!isFinite(count)||count<=0)return 1;
  count=Math.max(1,Math.floor(count));
  return Math.max(1,Math.min(4,Math.ceil(count/Math.ceil(count/4))));
}
