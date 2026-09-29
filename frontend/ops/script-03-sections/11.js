/* ===== 通知：铃铛 + 面板 + 点击落回对应研判 ===== */
var NOTIFS=[
  {id:'n1',type:'状态变化',icon:'🔵',proj:'sq',title:'智慧应急装备 · 资源端已反馈',desc:'资源团队核验：长三角应急无人机集成商（脱敏企业E·天目无人机）已具备可对接窗口，建议准备承接材料。',time:'10分钟前',read:false},
  {id:'n2',type:'超时提醒',icon:'🟠',proj:'py',title:'香菇深加工 · 已3个工作日无更新',desc:'该研判自双确认后暂无进展，建议跟进资源端对功能成分提取企业的核验进度。',time:'今天 09:12',read:false},
  {id:'n3',type:'每日摘要',icon:'📋',proj:null,title:'每日摘要 · 3个研判进行中',desc:'氢能专用车补链待你确认报告（电堆缺口53%已有候选）；智慧应急装备资源匹配中；香菇深加工待跟进。',time:'今天 09:00',read:false}
];
function unreadCount(){return NOTIFS.filter(function(n){return !n.read}).length}
function notifList(){
  return '<div style="padding:11px 15px;border-bottom:1px solid #eef1f5;font-size:13px;font-weight:650;display:flex;justify-content:space-between;align-items:center">通知 <button style="border:0;background:none;color:#0757ad;font-size:11px;cursor:pointer" onclick="markAllRead(event)">全部已读</button></div>'+
    NOTIFS.map(function(n){
      return '<div onclick="openNotif(\''+n.id+'\')" style="padding:11px 15px;border-bottom:1px solid #f2f5f9;cursor:pointer;display:flex;gap:9px;'+(n.read?'opacity:.55':'')+'" onmouseover="this.style.background=\'#f7f9fc\'" onmouseout="this.style.background=\'\'">'+
        '<span style="font-size:13px;flex:0 0 auto">'+n.icon+'</span>'+
        '<span style="flex:1;min-width:0"><span style="font-size:13px;font-weight:600;color:#0b183b;display:block">'+n.title+(n.read?'':' <b style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#c85b09;vertical-align:middle;margin-left:2px"></b>')+'</span>'+
        '<span style="font-size:11.5px;color:#667590;line-height:1.5;display:block;margin-top:3px">'+n.desc+'</span>'+
        '<span style="font-size:10px;color:#a8b2c2;display:block;margin-top:4px">'+n.type+' · '+n.time+'</span></span>'+
      '</div>';
    }).join('');
}
function toggleNotif(e){e.stopPropagation();var m=$('#notifPanel');if(m)m.style.display=m.style.display==='none'?'block':'none'}
function markAllRead(e){e.stopPropagation();NOTIFS.forEach(function(n){n.read=true});render()}
function openNotif(id){
  var n=NOTIFS.find(function(x){return x.id===id});if(!n)return;n.read=true;
  var np=$('#notifPanel');if(np)np.style.display='none';
  render();
  // 每日摘要 = 全局概览（不属于单个项目），点开列出各研判状态
  if(!n.proj){
    var rows=Object.keys(PROJECTS).map(function(k){var x=PROJECTS[k];var sc=stColor(x.stage);
      return '<div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid #f2f5f9;cursor:pointer" onclick="closeModal();gotoProjFromNotif(\''+k+'\')">'+
        '<span style="font-size:16px">📍</span>'+
        '<span style="flex:1;min-width:0"><strong style="font-size:13.5px;color:#0b183b;display:block">'+x.topic+'</strong>'+
        '<small style="font-size:11px;color:#667590">'+x.city+' · '+stageDescOf(x,x.stage)+'</small></span>'+
        '<span class="status-tag" style="color:'+sc.c+';background:'+sc.bg+'">'+stageNameOf(x,x.stage)+'</span></div>';
    }).join('');
    var body='<p class="modal-intro">今天 09:00 · '+P().who+' 名下 '+Object.keys(PROJECTS).length+' 个研判进展如下，点任意一条进入。</p>'+rows+
      '<div class="boundary-note" style="margin-top:14px"><i class="i">📋</i>每日摘要为全局汇总，不属于单个研判；系统每天 09:00 自动生成。</div>';
    openModal('每日摘要 · 今日各研判概览',body,'<button class="primary-button" onclick="closeModal()">知道了</button>');
    return;
  }
  // 事件通知（状态变化/超时）= 前往对应研判
  var pj=PROJECTS[n.proj];
  var body='<div style="display:flex;align-items:flex-start;gap:11px;margin-bottom:14px">'+
      '<span style="font-size:20px">'+n.icon+'</span>'+
      '<div><div style="font-size:15px;font-weight:650;color:#0b183b">'+n.title+'</div>'+
      '<div style="font-size:11px;color:#8490a5;margin-top:3px">'+n.type+' · '+n.time+'</div></div></div>'+
    '<div class="info-callout" style="margin-top:0">'+n.desc+'</div>'+
    '<div class="kv" style="margin-top:14px"><span class="kk" style="width:70px;color:#8490a5">相关研判</span><span class="vv">'+pj.city+' · '+pj.topic+'</span></div>'+
    '<div class="kv"><span class="kk" style="width:70px;color:#8490a5">当前阶段</span><span class="vv">'+stageNameOf(pj,pj.stage)+'</span></div>';
  var foot='<button class="secondary-button" onclick="closeModal()">知道了</button>'+
    '<button class="primary-button" onclick="closeModal();gotoProjFromNotif(\''+n.proj+'\')">前往该研判 ➜</button>';
  openModal('通知详情',body,foot);
}
function gotoProjFromNotif(pk){cur=pk;view='home';detailData=null;render();toast('已定位到「'+PROJECTS[pk].topic+'」研判')}
function toggleSw(e){e.stopPropagation();var m=$('#swMenu');m.style.display=m.style.display==='none'?'block':'none'}
function switchProj(k){cur=k;view='report';detailData=null;render();toast('已进入「'+PROJECTS[k].topic+'」研判工作区')}
function newProj(){var m=$('#swMenu');if(m)m.style.display='none';newProjModal()}
function go(v){
  if(isLocked(v)){
    var r=kbReadiness();
    var vnames={report:'\u7814\u5224\u9700\u6c42',home:'\u9879\u76ee\u7ba1\u7406',docking:'\u653f\u4f01\u5bf9\u63a5'};
    var vn=vnames[v]||v;
    var tips=[];
    if(r.confirmed<r.total) tips.push('\u786e\u8ba4\u5269\u4f59 '+(r.total-r.confirmed)+' \u6761\u5f85\u786e\u8ba4\u7ed3\u8bba');
    if(r.files<2) tips.push('\u5728\u57ce\u5e02\u667a\u5e93\u4e0a\u4f20\u81f3\u5c11 2 \u4efd\u653f\u5e9c\u6750\u6599');
    if(r.files<1) tips.push('\u4e0a\u4f20\u9886\u5bfc\u6700\u65b0\u4ea7\u4e1a\u53d1\u8a00\u7a3f');
    var tipsHtml=tips.slice(0,3).map(function(t){
      return '<li style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #f0f4ff">'+
        '<span style="color:#f59e0b;flex:0 0 auto">\u2192</span>'+
        '<span style="font-size:13px;color:#1e293b">'+t+'</span></li>';
    }).join('');
    var body=
      '<div style="margin-bottom:14px">'+
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'+
          '<div style="flex:1;background:#f0f4ff;border-radius:6px;height:8px;overflow:hidden">'+
            '<div style="height:100%;width:'+r.score+'%;background:'+r.color+';border-radius:6px;transition:width .3s"></div>'+
          '</div>'+
          '<span style="font-size:13px;font-weight:700;color:'+r.color+'">'+r.score+'%</span>'+
        '</div>'+
        '<p style="font-size:13px;color:#4a5568;margin:0 0 12px;line-height:1.7">'+
          '&#128274; <strong>'+vn+'</strong>\u9700\u8981\u57ce\u5e02\u667a\u5e93\u5b8c\u6210\u5ea6\u8fbe\u5230 <strong>80%</strong>\u540e\u81ea\u52a8\u89e3\u9501\u3002\u5f53\u524d <strong style="color:'+r.color+'">'+r.score+'%</strong>\u3002</p>'+
        '<p style="font-size:12px;color:#6366f1;margin:0 0 10px">\u{1f4a1} \u4e0a\u4f20\u8d8a\u591a\u6750\u6599\u3001\u9886\u5bfc\u786e\u8ba4\u8d8a\u591a\u7ed3\u8bba\uff0c\u7814\u5224\u6570\u636e\u53ef\u9760\u6027\u8d8a\u9ad8\u3002</p>'+
        (tipsHtml?'<div style="margin-bottom:10px">'+
          '<div style="font-size:11.5px;font-weight:650;color:#6366f1;margin-bottom:6px">\u5feb\u901f\u63d0\u5347\u5b8c\u6210\u5ea6\uff1a</div>'+
          '<ul style="margin:0;padding:0;list-style:none">'+tipsHtml+'</ul></div>':'');
    var foot=
      '<button class="secondary-button" onclick="closeModal()">\u7ee7\u7eed\u5b8c\u5584\u57ce\u5e02\u667a\u5e93</button>'+
      '<button onclick="unlockView(\''+v+'\')" '+
        'style="padding:10px 18px;background:#f5f7fb;color:#64748b;border:1.5px solid #e8edf5;border-radius:10px;font-size:13px;cursor:pointer">'+
        '\u5f3a\u5236\u89e3\u9501\uff08\u6570\u636e\u53ef\u9760\u6027\u8f83\u4f4e\uff09</button>';
    openModal('&#128274; '+vn+' \u5c1a\u672a\u89e3\u9501', body, foot);
    return;
  }
  view=v;detailData=null;detailOpen=true;render();
}
function bind(){
  document.addEventListener('click',function(e){
    var m=$('#swMenu');if(m&&m.style.display==='block'){var o=$('#orgName');if(o&&!o.contains(e.target)&&!m.contains(e.target))m.style.display='none'}
    var np=$('#notifPanel');if(np&&np.style.display==='block'&&!np.contains(e.target)&&!(e.target.closest&&e.target.closest('[onclick^=toggleNotif]'))){np.style.display='none'}
  });
  var ta=$('#composerTa');if(ta){ta.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg()}})}
}
