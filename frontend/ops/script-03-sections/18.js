/* ===== 定向推送：手动选城市 + 选该城市下的产业方向，推到政府端「慧小招团队推荐」区 ===== */
function opsEntManualPushModal(idx){
  var e=OPS_ENT[idx]; if(!e){ toast('企业不存在'); return; }
  var keys=Object.keys(PROJECTS);
  if(!keys.length){ toast('暂无可推送的城市产业方向，请先在城市研判中创建产业方向'); return; }
  var byCity={};
  keys.forEach(function(k){
    var p=PROJECTS[k]; if(!p||!p.city) return;
    (byCity[p.city]=byCity[p.city]||[]).push({key:k, topic:p.topic||'（未命名方向）'});
  });
  var cities=Object.keys(byCity);
  window.__manualPushEnt=idx;
  window.__manualPushByCity=byCity;
  var cityOpts=cities.map(function(c){return '<option value="'+c+'">'+c+'</option>';}).join('');
  var firstTopics=byCity[cities[0]].map(function(t){return '<option value="'+t.key+'">'+t.topic+'</option>';}).join('');
  var body=
    '<p style="font-size:13px;color:#4a5568;margin:0 0 14px">将「'+e.name+'」定向推送到你指定的城市与产业方向，政府端「慧小招团队推荐」区会立即出现该企业（脱敏名）。</p>'+
    '<label style="display:block;font-size:12px;font-weight:650;color:#4a5568;margin-bottom:6px">选择城市</label>'+
    '<select id="mpCity" onchange="opsEntManualPushCityChange()" style="width:100%;min-height:42px;padding:9px 11px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;margin-bottom:14px;background:#fff;cursor:pointer">'+cityOpts+'</select>'+
    '<label style="display:block;font-size:12px;font-weight:650;color:#4a5568;margin-bottom:6px">选择产业方向</label>'+
    '<select id="mpTopic" style="width:100%;min-height:42px;padding:9px 11px;border:1.5px solid #e8edf5;border-radius:8px;font-size:13px;margin-bottom:14px;background:#fff;cursor:pointer">'+firstTopics+'</select>'+
    '<div style="padding:10px 12px;background:#fffbeb;border-radius:8px;border:1px solid #fde68a;font-size:12px;color:#92400e">推送后政府端可见：脱敏名称、扩张信号、匹配理由，不可见企业真实联系方式。</div>';
  openModal('🎯 定向推送「'+e.name.substring(0,20)+'」', body,
    '<button class="secondary-button" onclick="closeModal()">取消</button>'+
    '<button class="primary-button" onclick="opsEntDoManualPush()">确认推送</button>');
}

function opsEntManualPushCityChange(){
  var sel=document.getElementById('mpCity'); if(!sel) return;
  var byCity=window.__manualPushByCity||{};
  var list=byCity[sel.value]||[];
  var tSel=document.getElementById('mpTopic'); if(!tSel) return;
  tSel.innerHTML=list.map(function(t){return '<option value="'+t.key+'">'+t.topic+'</option>';}).join('');
}

function opsEntDoManualPush(){
  var idx=window.__manualPushEnt;
  var e=OPS_ENT[idx]; if(!e){ toast('企业不存在'); return; }
  var tSel=document.getElementById('mpTopic');
  var projKey=tSel&&tSel.value;
  var p=projKey&&PROJECTS[projKey];
  if(!p){ toast('请选择产业方向'); return; }
  if(!p.clues) p.clues=[];
  var clueId=e.id+'_manual_'+projKey;
  if(p.clues.find(function(c){return c.id===clueId;})){ toast('该企业已推送到此产业方向，无需重复推送'); return; }
  p.clues.push({
    id: clueId,
    name: e.name+'（脱敏）',
    kind: e.kind, gap: (p.topic||'').slice(0,30),
    region: e.region||'',
    signal: e.signal,
    signalSrc: '慧小招管理端定向推送',
    reason: '管理端定向推荐：该企业适配「'+p.city+' · '+(p.topic||'')+'」，建议资源团队核验投资意向',
    questions:['企业落地意向与时间表','与本地链主的配套合作方案','落地规模与政策诉求'],
    tone:'amber', status:'ops_rec',
    priority:4, localAttr:'A', hasMoveSignal:e.hasMoveSignal,
    addedBy:'ops_manual'
  });
  if(!e.matches) e.matches=[];
  var mExist=e.matches.find(function(m){return m.projKey===projKey;});
  if(mExist){ mExist.pushed=true; }
  else { e.matches.push({city:p.city, gap:(p.topic||'').slice(0,20), projKey:projKey, pushed:true}); }
  if(e.status!=='pushed') e.status='pushed';
  persist();
  closeModal();
  renderOpsV2();
  toast('✓ 已定向推送「'+e.name+'」到「'+p.city+' · '+(p.topic||'')+'」');
}
