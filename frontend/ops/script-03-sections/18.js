/* Resource delivery uses the same source and demand review as the AI list. */
function opsEntManualPushModal(idx){
  var e=OPS_ENT[idx];if(!e||!e.id){toast('请先保存有编号的企业');return;}
  resourceReviewChooseProject([String(e.id)]);
}
function opsEntManualPushCityChange(){}
function opsEntDoManualPush(){resourceReviewStartFromSelection();}
