/* ===== ONBOARDING v2: 城市 → 可选上传 → 分析动画 → 工作区 ===== */
var _setupFiles=[];  // 可选上传文件（多文件）

function setupPage(){
  var _locked=(location.search.indexOf('demo')<0 && AUTH && AUTH.city);
  var _cityVal=_locked?AUTH.city:'';
  return '<div id="onboardingWrap" style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f0f4ff 0%,#fafbff 60%,#f5f0ff 100%)">'+
    '<div style="width:100%;max-width:480px;padding:0 20px">'+
      '<div style="text-align:center;margin-bottom:40px">'+
        '<div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;background:linear-gradient(135deg,#1a56db,#6366f1);border-radius:16px;margin-bottom:16px;box-shadow:0 8px 24px rgba(26,86,219,.25)">'+
          '<span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px">慧</span>'+
        '</div>'+
        '<h1 style="font-size:26px;font-weight:780;color:#0b183b;margin:0 0 8px;letter-spacing:-.5px">慧小招</h1>'+
        '<p style="font-size:14px;color:#8492a6;margin:0;line-height:1.6">'+(_locked?('AI 招商研判智能体 · '+_cityVal+' 城市工作区'):'AI 招商研判智能体 · 输入城市即可开始')+'</p>'+
      '</div>'+
      '<div style="background:#fff;border-radius:20px;padding:36px 36px 28px;box-shadow:0 2px 40px rgba(11,24,59,.07),0 0 0 1px rgba(11,24,59,.04)">'+
        '<div style="margin-bottom:20px">'+
          '<label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:8px;letter-spacing:.3px">目标城市'+(_locked?'<span style="font-weight:500;color:#8492a6"> · 账号已绑定，不可更改</span>':'')+'</label>'+
          '<input id="setupCity" type="text" placeholder="输入城市名称，例如：随州" autocomplete="off" '+
            (_locked?('value="'+_cityVal+'" readonly '):'')+
            'style="width:100%;padding:13px 16px;border:1.5px solid #e8edf5;border-radius:12px;font-size:15px;color:#0b183b;outline:none;box-sizing:border-box;transition:border .15s,box-shadow .15s'+(_locked?';background:#f5f7fb;cursor:not-allowed':'')+'" '+
            'oninput="setupValidate()" '+
            'onfocus="this.style.border=\'1.5px solid #1a56db\';this.style.boxShadow=\'0 0 0 3px rgba(26,86,219,.1)\'" '+
            'onblur="this.style.border=\'1.5px solid #e8edf5\';this.style.boxShadow=\'none\'" '+
            'onkeydown="if(event.key===\'Enter\'){var b=document.getElementById(\'setupBtn\');if(b&&b.style.pointerEvents!==\'none\')createProject();}" />'+
        '</div>'+
        '<!-- 补充材料区域已移至城市智库页面 -->'+
        '<input id="setupFileInput" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" multiple style="display:none" onchange="setupFileSelected(this)" />'+
        '<button id="setupBtn" onclick="createProject()" '+
          'style="width:100%;padding:14px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:650;cursor:pointer;opacity:'+(_locked?'1':'.4')+';pointer-events:'+(_locked?'auto':'none')+';transition:opacity .15s,transform .1s;letter-spacing:.2px" '+
          'onmousedown="this.style.transform=\'scale(.98)\'" onmouseup="this.style.transform=\'\'">'+
          '开始分析 →'+
        '</button>'+
      '</div>'+
      '<p style="text-align:center;font-size:11.5px;color:#b0bac8;margin:20px 0 0;line-height:1.7">分析结果仅作研判参考，正式招商需结合政府授权材料确认</p>'+
    '</div>'+
  '</div>';
}

function setupValidate(){
  var city=document.getElementById('setupCity');
  var btn=document.getElementById('setupBtn');
  if(!btn)return;
  var ok=city&&city.value.trim().length>=1;
  btn.style.opacity=ok?'1':'.4';
  btn.style.pointerEvents=ok?'auto':'none';
}

function setupPickFile(){
  var inp=document.getElementById('setupFileInput');
  if(inp)inp.click();
}

function setupFileSelected(inp){
  var files=inp&&inp.files?Array.from(inp.files):[];
  if(!files.length)return;
  _setupFiles=files;
  var lbl=document.getElementById('uploadLabel');
  if(lbl)lbl.innerHTML='<span style="font-size:18px;display:block;margin-bottom:4px">✅</span>'+
    '<span style="color:#1a56db;font-weight:600">已选 '+files.length+' 个文件</span><br>'+
    '<span style="font-size:11.5px;color:#8492a6">'+files.map(function(f){return f.name;}).join('、')+'</span><br>'+
    '<span style="font-size:11px;color:#b0bac8;margin-top:3px;display:inline-block">点击重新选择</span>';
  var zone=document.getElementById('uploadZone');
  if(zone){zone.style.borderColor='#1a56db';zone.style.background='#f0f4ff';}
}

function setupDropFile(e){
  e.preventDefault();
  var zone=document.getElementById('uploadZone');
  if(zone){zone.style.background='';zone.style.borderColor='#d1dce8';}
  var files=e.dataTransfer&&e.dataTransfer.files?Array.from(e.dataTransfer.files):[];
  if(!files.length)return;
  _setupFiles=files;
  var lbl=document.getElementById('uploadLabel');
  if(lbl)lbl.innerHTML='<span style="font-size:18px;display:block;margin-bottom:4px">✅</span>'+
    '<span style="color:#1a56db;font-weight:600">已选 '+files.length+' 个文件</span><br>'+
    '<span style="font-size:11.5px;color:#8492a6">'+files.map(function(f){return f.name;}).join('、')+'</span><br>'+
    '<span style="font-size:11px;color:#b0bac8;margin-top:3px;display:inline-block">点击重新选择</span>';
  if(zone){zone.style.borderColor='#1a56db';zone.style.background='#f0f4ff';}
}

/* 分析动画页面 */
function analysisPage(city, fileName){
  var steps=[
    {icon:'🌐', label:'检索'+city+'城市公开信息与产业背景',  dur:2800},
    {icon:'🏭', label:'识别主导产业与上下游链条结构',         dur:3200},
    {icon:'🏢', label:'扫描园区承载条件与链主企业',           dur:2600},
    {icon:'📜', label:'解析政策方向与领导关注重点',           dur:2400},
    {icon:'🔍', label:'测绘产业链缺口与可招引环节',           dur:2800},
    {icon:'✨', label:'生成城市智库与研判框架',               dur:2000},
  ];
  if(fileName){
    steps.splice(1,0,{icon:'📎', label:'解析上传材料：'+fileName, dur:1200});
  }
  var rows=steps.map(function(s,i){
    return '<div id="astep'+i+'" style="display:flex;align-items:flex-start;gap:14px;padding:12px 0;opacity:0;transform:translateY(8px);transition:opacity .4s,transform .4s">'+
      '<div style="width:36px;height:36px;border-radius:50%;background:#f0f4ff;display:flex;align-items:center;justify-content:center;font-size:16px;flex:0 0 auto;margin-top:2px">'+s.icon+'</div>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13.5px;color:#0b183b;font-weight:550">'+s.label+'</div>'+
        '<div id="atick'+i+'" style="font-size:10.5px;color:#b0bac8;margin-top:3px;height:14px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;transition:opacity .2s"> </div>'+
        '<div id="abar'+i+'" style="height:3px;background:#e8edf5;border-radius:2px;margin-top:5px;overflow:hidden">'+
          '<div id="aprog'+i+'" style="height:100%;width:0%;background:linear-gradient(90deg,#1a56db,#6366f1);border-radius:2px;transition:width linear"></div>'+
        '</div>'+
      '</div>'+
      '<div id="acheck'+i+'" style="font-size:16px;opacity:0;transition:opacity .3s;margin-top:2px">✓</div>'+
    '</div>';
  }).join('');

  return '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f0f4ff 0%,#fafbff 60%,#f5f0ff 100%)">'+
    '<div style="width:100%;max-width:480px;padding:0 20px">'+
      '<div style="text-align:center;margin-bottom:36px">'+
        '<div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;background:linear-gradient(135deg,#1a56db,#6366f1);border-radius:16px;margin-bottom:16px;box-shadow:0 8px 24px rgba(26,86,219,.25)">'+
          '<span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px">慧</span>'+
        '</div>'+
        '<h2 style="font-size:20px;font-weight:720;color:#0b183b;margin:0 0 6px">正在分析'+city+'</h2>'+
        '<p style="font-size:13px;color:#8492a6;margin:0">AI 正在构建城市智库与研判框架</p>'+
      '</div>'+
      '<div style="background:#fff;border-radius:20px;padding:28px 32px;box-shadow:0 2px 40px rgba(11,24,59,.07),0 0 0 1px rgba(11,24,59,.04)">'+
        rows+
      '</div>'+
      '<div id="analysisSummary" style="margin-top:20px;opacity:0;transition:opacity .5s"></div>'+
      '<div id="analysisDone" style="text-align:center;margin-top:16px;opacity:0;transition:opacity .5s">'+
        '<button onclick="enterWorkspace()" style="padding:13px 40px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:650;cursor:pointer;box-shadow:0 4px 20px rgba(26,86,219,.3);letter-spacing:.2px">'+
          '进入城市智库 →'+
        '</button>'+
      '</div>'+
    '</div>'+
  '</div>';
}

/* 运行分析动画 */
function runAnalysisAnim(city, fileName, stepsCount, onDone){
  // 数据来源 ticker 内容（每步）
  var SOURCES=[
    ['百度百科','政府官网','统计年鉴','国家企查查','巨潮资讯','中国工业信息网'],
    ['A股上市公司公告','省级产业规划','工商注册信息','行业协会年报','高新区官网','规上企业名录'],
    ['全国产业园区数据库','土地出让公告','园区官网','招商引资政策','厂房租赁信息','能耗公告'],
    ['政府工作报告全文','五年规划纲要','专项产业规划','领导讲话公开报道','政策文件数据库'],
    ['产业链图谱数据库','进出口贸易数据','企业采购公告','供应链分析模型','外资进入记录'],
    ['城市智库知识图谱','招商案例库','专家评审系统','研判模型输出'],
  ];
  var steps=[
    {icon:'🌐', label:'检索'+city+'城市公开信息与产业背景',  dur:4800, si:0},
    {icon:'🏭', label:'识别主导产业与上下游链条结构',         dur:5500, si:1},
    {icon:'🏢', label:'扫描园区承载条件与链主企业',           dur:4800, si:2},
    {icon:'📜', label:'解析政策方向与领导关注重点',           dur:4500, si:3},
    {icon:'🔍', label:'测绘产业链缺口与可招引环节',           dur:5200, si:4},
    {icon:'✨', label:'生成城市智库与研判框架',               dur:4600, si:5},
  ];
  if(fileName){
    // upload:true 标记上传材料步骤——它没有 SOURCES 数据源，结束文案应显示"已解析入库"而非"0个来源已扫描"
    var _upCount=(_setupFiles&&_setupFiles.length)||1;
    steps.splice(1,0,{icon:'📎', label:'解析上传材料：'+fileName, dur:1200, upload:true, upCount:_upCount});
  }
  var idx=0;
  function runStep(){
    if(idx>=steps.length){
      // 填充产业 summary
      var p=cur&&PROJECTS[cur];
      var city2=p?p.city:'该城市';
      var p0=cur&&PROJECTS[cur];
      // 已移除随州硬编码假结论：无论哪个城市，onboarding 阶段尚无上传材料，
      // 不虚构任何研判结论，一律显示"待上传材料"占位。
      var _hasUp=!!(_setupFiles&&_setupFiles.length);
      var _ph=_hasUp?'已结合上传材料完成初步归纳，详见城市智库':'待上传材料后由 AI 结合真实数据生成';
      var sectors=[
        {icon:'🏭', name:'主导产业与产业链', desc:_ph},
        {icon:'🏢', name:'园区与承载条件',   desc:_ph},
        {icon:'🏗️', name:'链主与存量企业',   desc:_ph},
        {icon:'📜', name:'政策与领导关注',   desc:_ph},
      ];
      var sumHtml='<div style="background:#fff;border-radius:16px;padding:20px 24px;box-shadow:0 2px 20px rgba(11,24,59,.06),0 0 0 1px rgba(11,24,59,.04)">'+
        '<div style="font-size:12px;font-weight:650;color:#8492a6;letter-spacing:.5px;margin-bottom:14px">分析完成 · '+city2+'城市智库已就位</div>'+
        sectors.map(function(s){
          return '<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #f0f4ff">'+
            '<span style="font-size:18px;width:28px;text-align:center">'+s.icon+'</span>'+
            '<div><div style="font-size:13px;font-weight:650;color:#0b183b">'+s.name+'</div>'+
            '<div style="font-size:11.5px;color:#8492a6;margin-top:1px">'+s.desc+'</div></div>'+
          '</div>';
        }).filter(function(h){return h!=='';}).join('')+
      '</div>';
      // 关键修复：先直接渲染工作区（保证绝不白屏），再把 summary 弹窗作为浮层叠加
      try{ enterWorkspace(); }catch(e){ console.error('[enterWorkspace]',e); }
      if(onDone)setTimeout(onDone,800);
      // summary modal 作为浮层叠加在已渲染的工作区之上
      setTimeout(function(){ try{ showSummaryModal(city2,sectors); }catch(e){ console.error('[summaryModal]',e); } },400);
      return;
    }
    var s=steps[idx];
    var el=document.getElementById('astep'+idx);
    var prog=document.getElementById('aprog'+idx);
    var check=document.getElementById('acheck'+idx);
    if(el){el.style.opacity='1';el.style.transform='translateY(0)';}
    // ticker: 快速闪回数据来源
    var tickEl=document.getElementById('atick'+idx);
    var srcs=SOURCES[s.si]||[];
    var ti=0;
    var tickTimer=null;
    if(tickEl&&srcs.length){
      tickTimer=setInterval(function(){
        tickEl.style.opacity='0';
        setTimeout(function(){
          tickEl.textContent='数据源：'+srcs[ti%srcs.length];
          tickEl.style.opacity='1';
          ti++;
        },150);
      },600);
    }
    if(prog){
      prog.style.transition='width '+s.dur+'ms linear';
      setTimeout(function(){prog.style.width='100%';},50);
    }
    setTimeout(function(){
      if(tickTimer)clearInterval(tickTimer);
      if(tickEl){tickEl.style.opacity='0.4';tickEl.textContent=s.upload?('已解析 '+(s.upCount||1)+' 份材料并入库'):(srcs.length+'个来源已扫描');}
      if(check){check.style.opacity='1';check.style.color='#1a56db';}
      idx++;
      setTimeout(runStep, 180);
    }, s.dur+100);
  }
  setTimeout(runStep, 200);
}

