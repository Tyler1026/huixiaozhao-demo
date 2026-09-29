/* ===== ONBOARDING v2: 城市 → 可选上传 → 分析动画 → 工作区 ===== */
var _setupFiles=[];  // 可选上传文件（多文件）

function setupPage(){
  return '<div id="onboardingWrap" style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f0f4ff 0%,#fafbff 60%,#f5f0ff 100%)">'+
    '<div style="width:100%;max-width:480px;padding:0 20px">'+
      '<div style="text-align:center;margin-bottom:40px">'+
        '<div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;background:linear-gradient(135deg,#1a56db,#6366f1);border-radius:16px;margin-bottom:16px;box-shadow:0 8px 24px rgba(26,86,219,.25)">'+
          '<span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px">慧</span>'+
        '</div>'+
        '<h1 style="font-size:26px;font-weight:780;color:#0b183b;margin:0 0 8px;letter-spacing:-.5px">慧小招</h1>'+
        '<p style="font-size:14px;color:#8492a6;margin:0;line-height:1.6">AI 招商研判智能体 · 输入城市即可开始</p>'+
      '</div>'+
      '<div style="background:#fff;border-radius:20px;padding:36px 36px 28px;box-shadow:0 2px 40px rgba(11,24,59,.07),0 0 0 1px rgba(11,24,59,.04)">'+
        '<div style="margin-bottom:20px">'+
          '<label style="font-size:12px;font-weight:650;color:#4a5568;display:block;margin-bottom:8px;letter-spacing:.3px">目标城市</label>'+
          '<input id="setupCity" type="text" placeholder="输入城市名称，例如：随州" autocomplete="off" '+
            'style="width:100%;padding:13px 16px;border:1.5px solid #e8edf5;border-radius:12px;font-size:15px;color:#0b183b;outline:none;box-sizing:border-box;transition:border .15s,box-shadow .15s" '+
            'oninput="setupValidate()" '+
            'onfocus="this.style.border=\'1.5px solid #1a56db\';this.style.boxShadow=\'0 0 0 3px rgba(26,86,219,.1)\'" '+
            'onblur="this.style.border=\'1.5px solid #e8edf5\';this.style.boxShadow=\'none\'" '+
            'onkeydown="if(event.key===\'Enter\'){var b=document.getElementById(\'setupBtn\');if(b&&b.style.pointerEvents!==\'none\')createProject();}" />'+
        '</div>'+
        '<div id="uploadZone" style="border:1.5px dashed #d1dce8;border-radius:12px;padding:16px;text-align:center;cursor:pointer;transition:all .15s;margin-bottom:20px" '+
          'onclick="setupPickFile()" '+
          'ondragover="event.preventDefault();this.style.background=\'#f0f4ff\';this.style.borderColor=\'#1a56db\'" '+
          'ondragleave="this.style.background=\'\';this.style.borderColor=\'#d1dce8\'" '+
          'ondrop="setupDropFile(event)">'+
          '<div id="uploadLabel" style="font-size:13px;color:#8492a6;line-height:1.6">'+
            '<span style="font-size:18px;display:block;margin-bottom:4px">📎</span>'+
            '<span style="font-weight:600;color:#4a5568">补充材料（可选）</span><br>'+
            '<span style="font-size:11.5px">政府工作报告、产业链图谱、园区资料 · 拖拽或点击上传</span><br>'+
            '<span style="font-size:11px;color:#b0bac8;margin-top:3px;display:inline-block">若不上传，将基于公开可查询信息完成分析</span>'+
          '</div>'+
        '</div>'+
        '<input id="setupFileInput" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" multiple style="display:none" onchange="setupFileSelected(this)" />'+
        '<button id="setupBtn" onclick="createProject()" '+
          'style="width:100%;padding:14px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:650;cursor:pointer;opacity:.4;pointer-events:none;transition:opacity .15s,transform .1s;letter-spacing:.2px" '+
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
    steps.splice(1,0,{icon:'📎', label:'解析上传材料：'+fileName, dur:1200});
  }
  var idx=0;
  function runStep(){
    if(idx>=steps.length){
      // 填充产业 summary
      var p=cur&&PROJECTS[cur];
      var city2=p?p.city:'该城市';
      var p0=cur&&PROJECTS[cur];
      var isSZ=p0&&p0.city&&p0.city.indexOf('随州')>=0;
      var sectors=[
        {icon:'🏭', name:'主导产业与产业链', desc:isSZ?'专用汽车703亿+安全应急502亿+香菇500亿，三大集群均已识别':'主导产业集群已识别，具体产值待材料确认'},
        {icon:'🏢', name:'园区与承载条件',   desc:isSZ?'随州高新区(国家级)+曾都经开区+专汽/香菇产业园，四大载体已评估':'主要工业园区载体与承接条件已梳理'},
        {icon:'🏗️', name:'链主与存量企业',   desc:isSZ?'程力/新楚风/齐星/江南专汽/品源均已梳理，电堆+机器人+提取三大外采缺口明确':'骨干链主与核心外采依赖已梳理'},
        {icon:'📜', name:'政策与领导关注',   desc:isSZ?'氢能走廊+安全应急示范基地+香菇精深加工三条主线，口径待领导确认':'政策主线已提取，专项资金待确认'},
      ];
      var sumHtml='<div style="background:#fff;border-radius:16px;padding:20px 24px;box-shadow:0 2px 20px rgba(11,24,59,.06),0 0 0 1px rgba(11,24,59,.04)">'+
        '<div style="font-size:12px;font-weight:650;color:#8492a6;letter-spacing:.5px;margin-bottom:14px">分析完成 · '+city2+'城市智库已就位</div>'+
        sectors.map(function(s){
          return '<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #f0f4ff">'+
            '<span style="font-size:18px;width:28px;text-align:center">'+s.icon+'</span>'+
            '<div><div style="font-size:13px;font-weight:650;color:#0b183b">'+s.name+'</div>'+
            '<div style="font-size:11.5px;color:#8492a6;margin-top:1px">'+s.desc+'</div></div>'+
          '</div>';
        }).join('')+
      '</div>';
      if(onDone)setTimeout(onDone,800);
      // 弹出 summary modal，10s 倒计时自动进入
      setTimeout(function(){ showSummaryModal(city2,sectors); },400);
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
      if(tickEl){tickEl.style.opacity='0.4';tickEl.textContent=srcs.length+'个来源已扫描';}
      if(check){check.style.opacity='1';check.style.color='#1a56db';}
      idx++;
      setTimeout(runStep, 180);
    }, s.dur+100);
  }
  setTimeout(runStep, 200);
}

/* 创建项目 + 进入动画 */
function createProject(){
  var city=(document.getElementById('setupCity')||{}).value;
  if(!city||!city.trim())return;
  city=city.trim();
  var fileName=_setupFiles&&_setupFiles.length?_setupFiles.map(function(f){return f.name;}).join('、'):null;

  // 渲染分析动画页
  var wrap=document.getElementById('onboardingWrap')||document.getElementById('root');
  if(wrap)wrap.outerHTML='<div id="root"><div style="min-height:100vh;background:linear-gradient(135deg,#f0f4ff 0%,#fafbff 60%,#f5f0ff 100%)">'+analysisPage(city,fileName)+'</div></div>';

  // 构建项目骨架
  var key='p'+Date.now().toString(36);
  PROJECTS[key]={
    id:key, city:city, org:city+'市招商局', who:'负责人', topic:city+'产业链招引', stage:1,
    kb:[
      {icon:'🏭',t:'主导产业与产业链',sub:'分析中',tag:'公开信息',known:[],calls:['城市公开信息','产业链图谱']},
      {icon:'🏢',t:'园区与承载条件',sub:'分析中',tag:'公开信息',known:[],calls:['园区基础资料','政府官网']},
      {icon:'🏗️',t:'链主与存量企业',sub:'分析中',tag:'公开信息',known:[],calls:['企业名录','工商信息']},
      {icon:'📜',t:'政策、规划与领导关注',sub:'分析中',tag:'公开信息',known:[],calls:['政府工作报告','领导发言']}
    ],
    report:null, clues:[]
  };
  cur=key;
  DEMANDS.push({id:'d'+key,city:city,gov:city+'市招商局·负责人',topic:city+'产业链招引',domain:'待确认',need:'待分析',submit:'刚刚',res:'none',resLabel:'待研判',clues:0,note:'',ai:''});
  persist();

  // 启动动画，动画结束后自动进入（autoEnter=true 时跳过按钮）
  runAnalysisAnim(city, fileName, 0, null);
}

/* 点击「进入工作区」按钮时调用 */

/* 根据城市名生成城市智库四大主题的核心结论（公开信息初判） */
function generateKbConclusions(city){
  // 随州专项真实数据（源自慧小招2026-07报告）
  // 通用城市走通用骨架；随州走完整真实数据
  var isSuizhou=(city.indexOf('随州')>=0);
  if(isSuizhou){
    return {
      industry:{
        sub:'专用汽车·安全应急·香菇三大主导产业集群',
        tag:'慧小招实测 · 2026-07',
        known:[
          '专用汽车：2025年产值703亿元(+12.1%)，年产16万辆，全国占比>10%，出口+71%全省第一，资质企业97家/零部件企业220家',
          '安全应急：2023年总产值502亿，其中移动应急装备(专用车)324亿；篷布产量占全国30%，风机0.9万台/年',
          '香菇：2024年全产业链产值超500亿，区域品牌价值205.8亿(连续3年全国食药用菌第一)，年产约70万吨(全球白花菇约50%)',
          '链主企业：程力(整车)、新楚风(氢能整车·49T氢重卡已量产)、齐星(整车/无人机指挥车)、江南专汽(消防车)、品源("菇的辣克"4亿美元出口订单)',
          '核心缺口：氢燃料电池电堆(占整车成本53%全部外购)、储氢瓶(14%)、应急机器人/无人机本体(依赖外采)、香菇多糖提取(仅2家)、菌种自主权(国外垄断)',
          '⚠️ 2026年各产业链方向优先招引顺序、重点突破的细分环节，请领导确认'
        ]
      },
      park:{
        sub:'随州高新区(国家级)·曾都经开区·专汽产业园·随县香菇产业园',
        tag:'慧小招实测 · 2026-07',
        known:[
          '随州高新区：2015年升级国家级，拥有"移动应急装备国家创新型产业集群"等国字号11块',
          '曾都区：国家安全应急产业示范基地，移动应急装备整机与改装主要承载区',
          '专汽产业园：30公里专汽长廊核心区，已有程力/齐星等整车及改装企业入驻',
          '随县香菇产业园：已有初加工入驻，精深加工(生物提取/GMP洁净)厂房条件需进一步核实',
          '区位优势：汉十高铁随州南站至武汉50分钟/至襄阳30分钟；"汉孝随襄十"万亿汽车走廊节点',
          '⚠️ 首选承接园区与地块、可用厂房面积及能耗配额，请领导确认'
        ]
      },
      firm:{
        sub:'97家资质整车/改装企业 + 220家零部件企业；外采依赖显著',
        tag:'慧小招实测 · 2026-07',
        known:[
          '整车/改装链主：程力(×成都壹为新能源底盘/×杭州时代电动3万台)、新楚风(49T氢重卡·百公里氢耗7.1kg·续航1000km)、齐星(含无人机指挥车)',
          '已有本地配套：车身驾驶室(齐星)、车规级晶振(泰晶AEC-Q200)、电解液/六氟磷酸锂(犇星)、铜箔(昱通)、负极材料(斯诺/犇星多孔硅)',
          '严重外采依赖：底盘/动力总成(十堰潍柴/法士特/汉德·占整车成本50%)、氢电堆(53%)、储氢瓶(14%)、应急机器人(启灵)、无人机(迅北斗)',
          '香菇链主：品源(辣酱出口·2024签1亿美元+2025签3亿美元)、裕国药业(多糖提取)、肽源(多肽提取)；精深加工仅2家布局',
          '本地配套率仅41%(梁山65%/十堰75%+)，补链招引窗口期明确且需求方牵引力强',
          '⚠️ 拟优先对接的企业名单与采购规模数据，请领导提供或确认'
        ]
      },
      policy:{
        sub:'氢能走廊+应急示范基地+香菇精深加工升级三条政策主线',
        tag:'慧小招实测 · 待领导确认口径',
        known:[
          '湖北省氢能走廊：武汉-十堰-随州-襄阳沿线布局，随州以氢能专用车为主攻方向，专项支持方向已明确',
          '国家安全应急产业示范基地(曾都区)：支持智慧应急装备落地，对机器人/无人机/5G通信模块有专项引导',
          '香菇产业升级：随州将精深加工与品牌化列为农业升级重点，菌种自主研发与生物医药方向已有政策导向',
          '竞争压力：十堰(高端应急车)+孝感(中能应急产业园42.8亿)双面夹击应急赛道；荆门碾压锂电；差异化空间在氢能专用车/低空经济/香菇',
          '⚠️ 专项资金额度、首选承接地块与领导最新交办须向主管部门确认'
        ]
      }
    };
  }
  // 通用骨架（非随州城市）：公开统计信息，不提“AI”（同步政府端 08.js 的措辞）
  return {
    industry:{
      sub:city+'主导产业集群与链条结构（公开信息整理）',
      tag:'公开信息 · 待补充',
      known:[
        city+'工业基础以传统制造业为核心，正向高端制造/新能源/数字经济方向升级',
        '主导产业贡献当地规上工业主要产值，需查阅统计年鉴获取具体数字',
        '上游核心零部件与关键材料本地配套率偏低，外采依赖是主要补链切入点',
        '新兴方向(智能装备/绿色化工/现代农业加工)处于增长期，招引窗口较好',
        '⚠️ 具体产业名称、产值与缺口明细需结合政府工作报告与产业链图谱确认'
      ]
    },
    park:{
      sub:city+'主要工业园区承载条件（公开信息整理）',
      tag:'公开信息 · 待核实',
      known:[
        city+'已建立国家级或省级经济开发区/高新区，具备基础工业承载能力',
        '主要园区已配备标准化厂房、市政配套与交通基础设施',
        '部分园区设有专项政策（租金减免/设备补贴/人才落户），具体口径需确认',
        '精密制造/生物提取等高要求方向需确认洁净厂房与能耗配额是否满足',
        '⚠️ 可用地块、厂房面积与园区联系方式需向招商局确认'
      ]
    },
    firm:{
      sub:city+'链主企业与供应链缺口（公开信息整理）',
      tag:'公开信息 · 待补充',
      known:[
        city+'本地存在若干规上工业龙头（整车/总装/终端品牌），是配套采购主要需求方',
        '链主在核心零部件、系统集成、检测认证等环节存在明显外采依赖',
        '外地采购占总成本比例估算30-60%，本地配套率提升空间大',
        '部分链主已表达本地化配套诉求，是招引上游企业的直接牵引力',
        '⚠️ 具体企业名单、采购规模与技术路线需通过企业走访或授权材料确认'
      ]
    },
    policy:{
      sub:city+'政策方向与领导关注重点（公开信息整理）',
      tag:'公开信息 · 待领导确认',
      known:[
        city+'近年政府工作报告将制造业升级与招商引资列为重点，产业政策支持力度较强',
        '符合主导方向的落地企业通常可获土地优惠/税收减免/人才补贴等配套政策',
        '重点招引方向与领导最新交办口径是核心决策依据，需干部上传确认',
        '营商环境改善（审批提速/一事一议）是近年招商重点配套',
        '⚠️ 专项资金额度、首选承接园区与具体交办须向领导及主管部门确认'
      ]
    }
  };
}

/* ── Summary Modal: 分析完成弹窗，10s 倒计时 ── */
var _summaryTimer=null;

/* ── 下载分析报告 Modal ── */
function showDownloadReport(){
  var p=P();
  if(!p||!p.city){toast('请先完成城市分析');return;}
  var city=p.city;
  var c=generateKbConclusions(city);

  // 完整版内容（基于 generateKbConclusions 真实数据）
  var fullLines=[
    city+'城市智库 · 招商研判报告（完整版）',
    '生成时间：'+new Date().toLocaleDateString('zh-CN')+'  |  数据来源：公开信息整理',
    '════════════════════════════════',
    '',
    '一、主导产业与产业链',
    c.industry.known.map(function(x){return (x.indexOf('⚠️')>=0?'  ⚠ ':'  • ')+x.replace('⚠️ ','');}).join('\n'),
    '',
    '二、园区与承载条件',
    c.park.known.map(function(x){return (x.indexOf('⚠️')>=0?'  ⚠ ':'  • ')+x.replace('⚠️ ','');}).join('\n'),
    '',
    '三、链主与存量企业',
    c.firm.known.map(function(x){return (x.indexOf('⚠️')>=0?'  ⚠ ':'  • ')+x.replace('⚠️ ','');}).join('\n'),
    '',
    '四、政策方向与领导关注',
    c.policy.known.map(function(x){return (x.indexOf('⚠️')>=0?'  ⚠ ':'  • ')+x.replace('⚠️ ','');}).join('\n'),
    '',
    '════════════════════════════════',
    '研判建议：',
    '  1. 优先补链方向：链主外采依赖最集中的核心零部件/系统集成环节',
    '  2. 推荐承接园区：'+city+'国家级/省级开发区（具体园区需向招商局确认）',
    '  3. 招引目标画像：具备落地意向、产品与缺口直接匹配的细分领域龙头',
    '  4. 待确认事项：专项资金额度、首选地块、领导最新交办口径',
    '',
    '⚠ 本报告基于公开信息整理，正式招商决策需结合政府授权材料与领导确认。',
  ].join('\n');

  // 精简版内容
  var shortLines=[
    city+'招商研判报告 · 精简版',
    '生成时间：'+new Date().toLocaleDateString('zh-CN'),
    '────────────────────',
    '',
    '【产业基础】'+c.industry.known[0],
    '【园区承载】'+c.park.known[0],
    '【链主缺口】'+c.firm.known[2],
    '【政策方向】'+c.policy.known[0],
    '',
    '【核心建议】优先招引链主外采依赖最重的关键环节企业，结合园区政策争取一事一议。',
    '',
    '⚠ 以上为公开信息整理，需干部结合实际材料确认。',
  ].join('\n');

  function dlFile(content, filename){
    var blob=new Blob([content],{type:'text/plain;charset=utf-8'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');a.href=url;a.download=filename;
    document.body.appendChild(a);a.click();
    setTimeout(function(){URL.revokeObjectURL(url);a.remove();},300);
  }

  var modal='<div id="dlReportModal" style="position:fixed;inset:0;background:rgba(11,24,59,.45);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px)" onclick="if(event.target.id===\'dlReportModal\')this.remove()">'+
    '<div style="background:#fff;border-radius:22px;padding:36px;max-width:480px;width:92%;box-shadow:0 8px 60px rgba(11,24,59,.18);animation:fadeUp .3s ease">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">'+
        '<div>'+
          '<div style="font-size:12px;font-weight:650;color:#8492a6;letter-spacing:.5px;margin-bottom:4px">分析报告下载</div>'+
          '<h2 style="font-size:18px;font-weight:750;color:#0b183b;margin:0">'+city+' 城市智库报告</h2>'+
        '</div>'+
        '<button onclick="document.getElementById(\'dlReportModal\').remove()" style="background:none;border:none;font-size:18px;color:#9aa5b5;cursor:pointer;padding:4px">✕</button>'+
      '</div>'+
      '<div style="display:flex;flex-direction:column;gap:12px">'+
        '<div style="border:1.5px solid #e8edf5;border-radius:14px;padding:18px 20px">'+
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'+
            '<span style="font-size:20px">📄</span>'+
            '<div><div style="font-size:13.5px;font-weight:650;color:#0b183b">完整版报告</div>'+
            '<div style="font-size:11.5px;color:#8492a6;margin-top:1px">四大主题全部内容 · 含核心研判建议</div></div>'+
          '</div>'+
          '<button onclick="(function(){var c=generateKbConclusions(\''+city+'\');var lines=[\''+city+'城市智库 · 招商研判报告（完整版）\',\'生成时间：\'+new Date().toLocaleDateString(\'zh-CN\')+\'  |  数据来源：公开信息整理\',\'════════════════════════\',\'\',\'一、主导产业与产业链\'].concat(c.industry.known.map(function(x){return (x.indexOf(\'⚠️\')>=0?\'  ⚠ \':\'  • \')+x.replace(\'⚠️ \',\'\');})).concat([\'\',\'二、园区与承载条件\']).concat(c.park.known.map(function(x){return (x.indexOf(\'⚠️\')>=0?\'  ⚠ \':\'  • \')+x.replace(\'⚠️ \',\'\');})).concat([\'\',\'三、链主与存量企业\']).concat(c.firm.known.map(function(x){return (x.indexOf(\'⚠️\')>=0?\'  ⚠ \':\'  • \')+x.replace(\'⚠️ \',\'\');})).concat([\'\',\'四、政策方向与领导关注\']).concat(c.policy.known.map(function(x){return (x.indexOf(\'⚠️\')>=0?\'  ⚠ \':\'  • \')+x.replace(\'⚠️ \',\'\');})).concat([\'\',\'════════════════════════\',\'研判建议：\',\'  1. 优先补链：链主外采依赖最集中的核心零部件/系统集成环节\',\'  2. 承接园区：\'+\''+city+'\'+\'国家级/省级开发区（具体地块需确认）\',\'  3. 招引画像：产品与缺口直接匹配的细分领域龙头，有落地意向\',\'  4. 待确认：专项资金、首选地块、领导最新交办\',\'\',\'⚠ 本报告基于公开信息整理，正式决策需结合授权材料确认。\']);var blob=new Blob([lines.join(\'\\n\')],{type:\'text/plain;charset=utf-8\'});var u=URL.createObjectURL(blob);var a=document.createElement(\'a\');a.href=u;a.download=\''+city+'_招商研判报告_完整版.txt\';document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(u);a.remove();},300);})()" style="width:100%;padding:10px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:10px;font-size:13.5px;font-weight:600;cursor:pointer">下载完整版 (.txt)</button>'+
        '</div>'+
        '<div style="border:1.5px solid #e8edf5;border-radius:14px;padding:18px 20px">'+
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'+
            '<span style="font-size:20px">📋</span>'+
            '<div><div style="font-size:13.5px;font-weight:650;color:#0b183b">精简版报告</div>'+
            '<div style="font-size:11.5px;color:#8492a6;margin-top:1px">一句话摘要 · 适合快速分享</div></div>'+
          '</div>'+
          '<button onclick="(function(){var c=generateKbConclusions(\''+city+'\');var lines=[\''+city+' 招商研判 · 精简版\',\'生成时间：\'+new Date().toLocaleDateString(\'zh-CN\'),\'────────────────────\',\'\',\'【产业基础】\'+c.industry.known[0],\'【园区承载】\'+c.park.known[0],\'【链主缺口】\'+c.firm.known[2],\'【政策方向】\'+c.policy.known[0],\'\',\'【核心建议】优先招引链主外采依赖最重的关键环节企业，结合园区政策争取一事一议。\',\'\',\'⚠ 以上为公开信息整理，需干部结合实际材料确认。\'];var blob=new Blob([lines.join(\'\\n\')],{type:\'text/plain;charset=utf-8\'});var u=URL.createObjectURL(blob);var a=document.createElement(\'a\');a.href=u;a.download=\''+city+'_招商研判报告_精简版.txt\';document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(u);a.remove();},300);})()" style="width:100%;padding:10px;background:#f5f7fb;color:#0b183b;border:1.5px solid #e8edf5;border-radius:10px;font-size:13.5px;font-weight:600;cursor:pointer">下载精简版 (.txt)</button>'+
        '</div>'+
      '</div>'+
      '<p style="font-size:11px;color:#b0bac8;margin:16px 0 0;text-align:center;line-height:1.7">报告内容为公开信息整理的初步研判，正式招商决策需结合政府授权材料与领导确认</p>'+
    '</div>'+
  '</div>';

  var wrap=document.createElement('div');
  wrap.innerHTML=modal;
  document.body.appendChild(wrap.firstChild);
}

function showSummaryModal(city2,sectors){
  // 生成kb一句话摘要
  var p=cur&&PROJECTS[cur];
  var _isSZ2=p&&p.city&&p.city.indexOf('随州')>=0;
  var insights=_isSZ2?[
    '专用汽车703亿+安全应急502亿+香菇500亿三大集群，本地配套率仅41%，氢电堆53%/底盘50%全靠外购',
    '随州高新区(国家级)·曾都经开区·专汽/香菇产业园四大载体，汉十高铁至武汉50分钟',
    '程力/新楚风/齐星/江南专汽/品源均有明确外采诉求；电堆·机器人·香菇提取三大缺口可直接对接',
    '氢能走廊+安全应急示范基地+香菇精深加工三条政策主线，专项资金口径待领导确认',
  ]:[
    p&&p.city?p.city+'工业基础可承接，上游核心零部件本地配套率偏低，存在明显补链空间':'主导产业集群已识别，链条缺口待明确',
    '主要工业园区载体已梳理，厂房与能耗条件可满足主流制造业落地需求',
    '本地链主存在外采依赖，上游供应商招引有直接采购牵引力',
    '政策方向已提取，专项资金口径与首选承接园区待干部上传领导最新发言确认',
  ];
  var rows=(sectors||[]).map(function(s,i){
    return '<div style="display:flex;gap:14px;padding:14px 0;border-bottom:1px solid #f0f4ff;align-items:flex-start">'+
      '<span style="font-size:20px;flex:0 0 28px;text-align:center;margin-top:2px">'+s.icon+'</span>'+
      '<div style="flex:1">'+
        '<div style="font-size:13px;font-weight:650;color:#0b183b;margin-bottom:3px">'+s.name+'</div>'+
        '<div style="font-size:12px;color:#4a5568;line-height:1.65">'+insights[i]+'</div>'+
      '</div>'+
      '<span style="font-size:11px;color:#22c55e;background:#f0fdf4;padding:2px 8px;border-radius:20px;flex:0 0 auto;margin-top:2px;white-space:nowrap">已就位</span>'+
    '</div>';
  }).join('');

  var modal='<div id="summaryModal" style="position:fixed;inset:0;background:rgba(11,24,59,.45);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px)">'+
    '<div style="background:#fff;border-radius:22px;padding:36px 36px 28px;max-width:520px;width:92%;box-shadow:0 8px 60px rgba(11,24,59,.18);animation:fadeUp .35s ease">'+
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">'+
        '<div style="width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.2)"></div>'+
        '<span style="font-size:12px;font-weight:650;color:#22c55e;letter-spacing:.5px">分析完成</span>'+
      '</div>'+
      '<h2 style="font-size:20px;font-weight:750;color:#0b183b;margin:0 0 4px">'+city2+' 城市智库已就位</h2>'+
      '<p style="font-size:13px;color:#8492a6;margin:0 0 20px">以下为公开信息整理的初步研判结论，⚠️ 标注项需结合政府材料确认</p>'+
      rows+
      '<div style="margin-top:22px;display:flex;gap:10px;align-items:center">'+
        '<button onclick="enterWorkspaceFromModal()" style="flex:1;padding:13px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:650;cursor:pointer;letter-spacing:.2px">进入城市智库 →</button>'+
        '<div id="summaryCountdown" style="font-size:12px;color:#9aa5b5;white-space:nowrap">10s 后自动进入</div>'+
      '</div>'+
    '</div>'+
  '</div>';

  // 注入动画 keyframe（只注一次）
  if(!document.getElementById('fadeUpStyle')){
    var st=document.createElement('style');st.id='fadeUpStyle';
    st.textContent='@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(st);
  }
  var wrap=document.createElement('div');
  wrap.id='summaryModalWrap';
  wrap.innerHTML=modal;
  document.body.appendChild(wrap);

  // 10s 倒计时
  var remaining=10;
  _summaryTimer=setInterval(function(){
    remaining--;
    var cd=document.getElementById('summaryCountdown');
    if(cd)cd.textContent=remaining+'s 后自动进入';
    if(remaining<=0){
      clearInterval(_summaryTimer);
      enterWorkspaceFromModal();
    }
  },1000);
}
function enterWorkspaceFromModal(){
  if(_summaryTimer)clearInterval(_summaryTimer);
  var wrap=document.getElementById('summaryModalWrap');
  if(wrap)wrap.remove();
  enterWorkspace();
}

function enterWorkspace(){
  if(!cur||!PROJECTS[cur])return;
  // 填充城市智库核心结论
  var p=PROJECTS[cur];
  var c=generateKbConclusions(p.city);
  var mapping=[c.industry,c.park,c.firm,c.policy];
  p.kb.forEach(function(k,i){
    if(mapping[i]&&(!k.known||!k.known.length)){
      k.known=mapping[i].known;
      k.sub=mapping[i].sub;
      k.tag=mapping[i].tag;
    }
  });
  p.topic=p.city+'主导产业补链招引';
  persist();
  view='knowledge';
  detailOpen=false;
  render();
  // 延迟写入 AI 首条消息
  setTimeout(function(){
    if(!cur||!PROJECTS[cur])return;
    var city=PROJECTS[cur].city;
    var hasFile=!!(_setupFiles&&_setupFiles.length);
    addA('<p>'+city+'城市智库已就位'+(hasFile?'，已结合你上传的材料':'，基于公开信息')+
      '完成初步分析。</p>'+
      '<p style="margin-top:6px">左侧四大主题均可点击展开，你也可以直接提问：</p>'+
      '<ul style="margin:6px 0 0 18px;line-height:2;font-size:13px;color:#33415a">'+
        '<li>「<strong>'+city+'最值得补链的核心环节是哪些？</strong>」</li>'+
        '<li>「<strong>本地链主企业还缺哪些关键配套？</strong>」</li>'+
        '<li>「<strong>园区如何分工承接不同细分方向？</strong>」</li>'+
      '</ul>'+
      '<p style="margin-top:8px;font-size:12px;color:#9aa5b5">上传政府工作报告或产业材料可进一步提升判断精度。</p>');
  }, 350);
}


function roleSwitch(){
  // 角色切换暂时隐藏——先专注做好政府端（运营端代码保留，后续再启用）
  return '';
}
function setRole(r){role=r;view='home';render();toast(r==='ops'?'已切换到运营端（周总·全局）':'已切换到政府端（随州·张主任）')}
