/* ===== 右侧详情栏（复刻雷总"本次分析" + 证据联动）===== */
function detailPane(p){
  var body;
  if(detailData&&detailData.kind==='fold'){body=detailFold(detailData.d);}
  else if(detailData&&detailData.kind==='clue'){body=detailClue(detailData.d);}
  else if(detailData&&detailData.kind==='sub'){body=detailSub(detailData.d);}
  else if(view==='home'){body=detailNeeds(p);}       // 招商对接→需求概览
  else if(view==='docking'){body=detailDocking(p);}   // 招商对接→对接概览
  else if(view==='settings'){body=detailSettings(p);}
  else if(view==='knowledge'){body=detailKbIntro(p);}
  else{body=detailReport(p);}                          // report产业分析→本次研判
  return '<button class="collapse-detail" onclick="toggleDetail()"><i class="i">✕</i></button>'+
    '<div class="detail-page">'+body+'</div>';
}
// 我的需求页 → 右侧：需求汇总统计
function detailNeeds(p){
  // 若有展开的方向：右侧显示该方向上下文；否则显示全局汇总
  var openK = window.__projOpen;
  if(openK && PROJECTS[openK]){
    var x = PROJECTS[openK];
    var clues = x.clues||[];
    var teal  = clues.filter(function(c){return c.tone==='teal';}).length;
    var amber = clues.filter(function(c){return c.tone==='amber';}).length;
    var slate = clues.filter(function(c){return c.tone==='slate';}).length;
    var sname = stageNameOf(x, x.stage);
    var sdesc = stageDescOf(x, x.stage);
    return '<div class="detail-header"><div><span class="eyebrow">DIRECTION</span><h2>'+x.topic+'</h2><p>'+x.city+' · 当前方向进度</p></div></div>'+
      '<div class="detail-scroll">'+
        '<div class="detail-block"><h3>当前阶段</h3>'+
          '<p class="detail-copy" style="font-size:18px;font-weight:700;color:#013582">'+sname+'</p>'+
          '<div style="font-size:12px;color:#8492a6;margin-top:4px">第 '+x.stage+'/'+projStages(x).length+' 步 · '+sdesc+'</div>'+
        '</div>'+
        '<div class="detail-block"><h3>候选线索</h3><ul class="check-list">'+
          '<li><i class="i">•</i>可安排沟通：'+teal+' 家</li>'+
          '<li><i class="i">•</i>核验中：'+amber+' 家</li>'+
          '<li><i class="i">•</i>待接触：'+slate+' 家</li>'+
        '</ul></div>'+
        '<div class="detail-block"><h3>提示</h3><div class="info-callout" style="margin-top:0">右侧随所选方向联动；点击左侧其它方向可切换查看。企业真实联系方式由资源团队线下保管。</div></div>'+
      '</div>';
  }
  // 与左侧招商对接列表(projMgmtPage)用同一过滤口径：只统计已提交的招商需求子项目，
  // 排除父项目/城市产业分析工作区(sz、城市锚点)，否则右侧「研判总数」会比左侧列表多算父项目。
  var ks=cityKeys().filter(function(k){
    var x=PROJECTS[k]; if(!x) return false;
    if(x.isDemand===true) return true;
    return false; // 只认isDemand===true，不再用stage>=3兜底（防止产业分析项目误入招商对接）
  });
  var byStage={};ks.forEach(function(k){var s=PROJECTS[k].stage;byStage[s]=(byStage[s]||0)+1});
  return '<div class="detail-header"><div><span class="eyebrow">OVERVIEW</span><h2>需求概览</h2><p>'+p.who+' 名下产业分析汇总</p></div></div>'+
    '<div class="detail-scroll">'+
      '<div class="detail-block"><h3>产业分析总数</h3><p class="detail-copy" style="font-size:22px;font-weight:700;color:#013582">'+ks.length+' 个产业方向</p></div>'+
      '<div class="detail-block"><h3>阶段分布</h3><ul class="check-list">'+
        (function(){
          // 阶段名按项目取（可能有自定义阶段，序号会超过 STAGES 长度）
          var maxN=STAGES.length; ks.forEach(function(k){var s=PROJECTS[k].stage||1; if(s>maxN)maxN=s;});
          var rows='';
          for(var i=1;i<=maxN;i++){
            var n=byStage[i]||0; if(!n) continue;
            var nm='';
            for(var j=0;j<ks.length;j++){ if((PROJECTS[ks[j]].stage||1)===i){ nm=stageNameOf(PROJECTS[ks[j]],i); break; } }
            if(!nm) nm=(STAGES[i-1]&&STAGES[i-1][0])||('第'+i+'阶段');
            rows+='<li><i class="i">•</i>'+nm+'：'+n+' 个</li>';
          }
          return rows;
        })()+'</ul></div>'+
      '<div class="detail-block"><h3>提示</h3><div class="info-callout" style="margin-top:0">展开任一产业方向后，这里会显示该方向的阶段与线索进度；每条为独立研判线，进度互不干扰。</div></div>'+
    '</div>';
}
// 设置页 → 右侧：账号与权限概览
function detailSettings(p){
  return '<div class="detail-header"><div><span class="eyebrow">ACCOUNT</span><h2>账号概览</h2><p>由系统开通 · 不可自行修改</p></div></div>'+
    '<div class="detail-scroll">'+
      '<div class="detail-block"><h3>身份</h3><ul class="check-list"><li><i class="i">✔</i>'+p.org+'</li><li><i class="i">✔</i>'+p.who+' · 招商干部</li></ul></div>'+
      '<div class="detail-block"><h3>数据权限</h3><div class="info-callout" style="margin-top:0">仅可访问 <b>'+p.city+'</b> 城市智库；跨城市数据由运营端管理。</div></div>'+
      '<div class="detail-block"><h3>安全边界</h3><div class="boundary-note" style="margin-top:0"><i class="i">🔒</i>确认关口、资源核验责任与企业触达边界，不因个人设置而跳过。</div></div>'+
    '</div>';
}
// 城市智库页（未点类目时）→ 右侧：智库范围说明
function detailKbIntro(p){
  return '<div class="detail-header"><div><span class="eyebrow">KNOWLEDGE SCOPE</span><h2>智库范围</h2><p>'+p.city+'城市智库已连接</p></div></div>'+
    '<div class="detail-scroll">'+
      '<div class="detail-block"><h3>可查询范围</h3><ul class="check-list">'+p.kb.map(function(k){return '<li><i class="i">✔</i>'+k.t+'</li>'}).join('')+'</ul></div>'+
      '<div class="detail-block"><h3>如何使用</h3><div class="info-callout" style="margin-top:0">点击左侧任一主题查看已知信息与可调用材料，或在下方输入框直接提问。</div></div>'+
      '<div class="detail-block"><div class="boundary-note" style="margin-top:0"><i class="i">🔒</i>公开信息仅辅助研判；园区承载、企业采购、领导任务仍需政府授权材料确认。</div></div>'+
    '</div>';
}
// 招引方向项目 → 右侧：该项目对接详情
function detailSub(s){
  return '<div class="detail-header"><div><span class="eyebrow">PROJECT</span><h2>'+s.name.split(' · ')[0]+'</h2><p>'+(s.from||'')+' · 招引方向项目</p></div></div>'+
    '<div class="detail-scroll">'+
      '<div class="detail-block"><h3>项目来源</h3><div class="info-callout" style="margin-top:0">由「'+(s.from||'')+'」研判报告的招引方向派生。</div></div>'+
      '<div class="detail-block"><h3>候选线索</h3><ul class="source-list"><li><i class="i">🏢</i>'+(s.clueName||'脱敏候选企业')+'<small>脱敏 · 由资源端核验可达性</small></li></ul></div>'+
      '<div class="detail-block"><h3>对接进度</h3><div class="timeline"><div class="timeline-item done"><div class="timeline-dot"><i class="i">✓</i></div><div><div class="timeline-title"><strong>需求已递交</strong></div></div></div>'+
        '<div class="timeline-item current"><div class="timeline-dot"><i class="i">◔</i></div><div><div class="timeline-title"><strong>资源匹配中</strong></div><p>资源端核验候选企业真实意向。</p></div></div>'+
        '<div class="timeline-item"><div class="timeline-dot"><i class="i">•</i></div><div><div class="timeline-title"><strong>安排招商对接</strong></div></div></div></div></div>'+
      '<div class="detail-block"><div class="boundary-note" style="margin-top:0"><i class="i">🔒</i>脱敏展示，不显示内部人脉路径；系统不自动联系企业。</div></div>'+
    '</div>';
}
// 产业分析页 → 右侧：本次研判（版本/进度/待核实/已传材料）
function detailReport(p){
  var st=REPORTSTATE[cur]; var ups=(UPLOADS[cur]||[]);
  // 按当前方向判断该方向是否已生成报告/是否完整报告（项目级 st.phase/st.ts 是单例，切方向会串）
  var _topicFull = topicHasFullReport(p.topic);
  var _topicText = (typeof reportTextForTopic==='function') ? reportTextForTopic(p.topic) : null;
  var _topicHasReport = _topicFull || !!_topicText || (st&&st.phaseByTopic&&st.phaseByTopic[p.topic]);
  return '<div class="detail-header"><div><span class="eyebrow">CURRENT STUDY</span><h2>本次产业分析</h2><p>'+p.topic+'</p></div></div>'+
    '<div class="detail-scroll">'+
      '<div class="detail-block"><h3>报告状态</h3>'+(_topicHasReport
        ? '<ul class="check-list">'+
            '<li><i class="i">'+(_topicFull?'✅':'✎')+'</i>'+(_topicFull?'完整报告已生成':'初步草稿')+' · 置信度 '+topicScore(p.topic)+'%</li>'+
            '<li><i class="i"></i>产业分析方向：'+p.topic+'</li>'+
            '<li><i class="i"></i>生成时间：'+(st&&st.ts?new Date(st.ts).toLocaleDateString('zh-CN'):'未知')+'</li>'+
          '</ul>'
        : '<div class="info-callout" style="margin-top:0">尚未生成报告。请先在「产业分析」选择方向并点击生成。</div>'      )+'</div>'+
      '<div class="detail-block"><h3>当前阶段</h3>'+
        '<div class="info-callout" style="margin-top:0">'+stageNameOf(p,p.stage)+' · '+stageDescOf(p,p.stage)+'</div>'+
      '</div>'+
      '<div class="detail-block"><h3>已上传材料</h3>'+(ups.length
        ? '<ul class="source-list">'+ups.map(function(u){return '<li><i class="i"></i>'+u.name+'<small style="color:#9aa5b5;margin-left:6px">'+Math.round(u.size/1024)+'KB</small></li>';}).join('')+'</ul>'
        : '<div style="font-size:12.5px;color:#9aa5b5">暂无上传材料</div>'      )+'</div>'+
      (st&&st.phase===2
        ? '<div class="detail-block">'+
      '<div style="display:flex;gap:8px">'+
      '<button onclick="viewCurrentReport()" style="flex:1;padding:9px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:12.5px;color:#1a56db;cursor:pointer;font-weight:600">📋 查看完整报告</button>'+
      '<button onclick="downloadReport(\'full\')" style="padding:9px 14px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;font-size:12.5px;color:#1a56db;cursor:pointer">⬇ 下载</button>'+
      '</div></div>'
        : ''
      )+
      '<div class="detail-block"><div class="boundary-note" style="margin-top:0"><i class="i">ℹ</i>报告为AI辅助草稿，关键判断需人工确认；定稿后正式递交。</div></div>'+
    '</div>';
}
// 招商对接页 → 右侧：对接概览
function detailDocking(p){
  var ks=cityKeys();
  var n4=ks.filter(function(k){return PROJECTS[k].stage>=4}).length;
  var n5=ks.filter(function(k){return PROJECTS[k].stage>=5}).length;
  return '<div class="detail-header"><div><span class="eyebrow">DOCKING</span><h2>对接概览</h2><p>各项目对接进度</p></div></div>'+
    '<div class="detail-scroll">'+
      '<div class="detail-block"><h3>进行中</h3><ul class="check-list"><li><i class="i">🔄</i>资源匹配中：'+n4+' 个</li><li><i class="i">🤝</i>已进入对接：'+n5+' 个</li></ul></div>'+
      '<div class="detail-block"><h3>说明</h3><div class="info-callout" style="margin-top:0">点左侧项目查看对接时间线。进度由资源端回传，系统只做提醒。</div></div>'+
      '<div class="detail-block"><div class="boundary-note" style="margin-top:0"><i class="i">🔒</i>系统不自动联系企业；对接由资源端线下推进。</div></div>'+
    '</div>';
}
// 默认：本次分析（雷总原版右侧）
function detailAnalysis(p){
  var rp=p.report;
  return '<div class="detail-header"><div><span class="eyebrow">CURRENT ANALYSIS</span><h2>本次分析</h2>'+
    '<p>'+p.city+'城市智库已连接</p></div></div>'+
    '<div class="detail-scroll">'+
      '<div class="detail-block"><h3>已掌握</h3>'+
        '<ul class="check-list">'+
        (p.kb||[]).map(function(k){return '<li><i class="i">✔</i>'+k.t+'（'+k.sub+'）</li>';}).join('')+
        '<li><i class="i">✔</i>今日公开信息已更新（'+nowLabel()+'）</li>'+
        ((UPLOADS[cur]&&UPLOADS[cur].length)?'<li><i class="i">✔</i>已上传 '+UPLOADS[cur].length+' 份材料</li>':'')+
        '</ul></div>'+
      '<div class="detail-block"><h3>建议补充</h3>'+
        '<div class="fact-with-icon warning"><i class="i">⚠</i><div><strong>随州市2026年政府工作报告、领导近期产业发言（氢能/应急/香菇升级方向交办口径）</strong>'+
        '<span>补充后可提升判断完整度</span></div></div>'+
        '<button class="text-action" onclick="uploadHint()">立即补充材料 ➜</button></div>'+
      '<div class="detail-block"><h3>报告将包含</h3><ol class="outline-list">'+
        ['产业基础判断','关键链条缺口','建议招引方向','候选企业线索','待核实事项'].map(function(x){return '<li>'+x+'</li>'}).join('')+'</ol></div>'+
      '<div class="info-callout">公开信息只用于辅助研判；园区承载、企业采购和领导任务仍需政府授权材料确认。</div>'+
    '</div>'+
    '<div class="detail-actions-stack" style="gap:7px;padding:12px 22px 16px">'+
      '<button class="primary-button" onclick="'+(rp?"showReport()":"startFlow('direction')")+'"><i class="i">📊</i>'+(rp?'查看并确认报告':'生成招商策略与需求报告')+'</button>'+
      '<small>补充材料可提升完整度，也可先基于现有资料生成</small>'+
    '</div>';
}
// 点报告结论 → 证据
function detailFold(b){
  var vj=b.type==='virt'?'<div class="warning-callout"><strong>虚实判断：待核实</strong><p>方向性表述，缺具体金额/地块/落地主体，需政府授权材料确认。</p></div>':'<div class="info-callout" style="border-color:#acd7ce;color:#155c58;background:#e9f7f6">虚实判断：<strong>实据</strong> · 有具体数据支撑，可作为研判依据。</div>';
  var chk=b.chk?'<div class="detail-block"><h3>仍需确认</h3><div class="fact-with-icon warning"><i class="i">⚠</i><div><strong>'+b.chk+'</strong></div></div></div>':'';
  return '<div class="detail-header"><div><button class="text-action" style="margin:0 0 6px" onclick="backToAnalysis()">‹ 返回本次分析</button><span class="eyebrow">EVIDENCE</span><h2>判断依据</h2><p>点击的报告结论溯源</p></div></div>'+
    '<div class="detail-scroll">'+
      '<div class="detail-block"><h3>当前查看的判断</h3><p class="detail-copy">'+b.h+'</p></div>'+
      '<div class="detail-block"><h3>判断依据</h3><p class="detail-copy">'+b.p+'</p></div>'+
      '<div class="detail-block"><h3>来源（可追溯）</h3><div class="source-chips"><span><i class="i">📄</i>'+b.ev+'</span></div></div>'+
      chk+vj+
    '</div>';
}
// 点脱敏线索 → 核验要点
function detailClue(c){
  return '<div class="detail-header"><div><button class="text-action" style="margin:0 0 6px" onclick="backToAnalysis()">‹ 返回本次分析</button><span class="eyebrow">CANDIDATE CLUE</span><h2>'+c.name+'</h2><p>'+c.dir+'</p></div></div>'+
    '<div class="detail-scroll">'+
      '<div class="detail-block"><h3>为什么值得核验</h3><p class="detail-copy">'+c.why+'</p></div>'+
      '<div class="detail-block"><h3>公开信号与资源边界</h3><p class="detail-copy">'+c.signal+'</p>'+
        '<span class="source-note">来源：'+c.src+'</span></div>'+
      '<div class="detail-block"><h3>待核实问题</h3><ol class="number-list">'+
        c.qs.map(function(q,i){return '<li><span>'+(i+1)+'</span>'+q+'</li>'}).join('')+'</ol></div>'+
      '<div class="boundary-note"><i class="i">🔒</i>仅展示脱敏状态、公开依据和下一步，不展示内部人脉路径。</div>'+
    '</div>';
}
function toggleDetail(){detailOpen=!detailOpen;render()}
// 返回：按当前视图回到对应右栏（报告页→本次研判，项目页→项目详情），而不是永远跳旧的通用分析栏
function backToAnalysis(){detailData=null;var dp=$('.detail-pane');
  var back=view==='report'?detailReport(P()):(view==='subwork'&&subprojOf(cur)[curSub])?detailSub(subprojOf(cur)[curSub]):detailAnalysis(P());
  if(dp){dp.innerHTML='<button class="collapse-detail" onclick="toggleDetail()"><i class="i">✕</i></button><div class="detail-page">'+back+'</div>';}else render();}
