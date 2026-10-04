
function _tombKbItem(pk,kbIdx,text){
  if(!pk) return;
  var fp=_kbItemFp(text); if(!fp) return;
  if(!KB_ITEM_TOMBS[pk]) KB_ITEM_TOMBS[pk]={};
  if(!KB_ITEM_TOMBS[pk][kbIdx]) KB_ITEM_TOMBS[pk][kbIdx]={};
  KB_ITEM_TOMBS[pk][kbIdx][fp]=Date.now();
}
function _isKbItemTombed(pk,kbIdx,text){
  var fp=_kbItemFp(text); if(!fp) return false;
  return !!(KB_ITEM_TOMBS[pk]&&KB_ITEM_TOMBS[pk][kbIdx]&&KB_ITEM_TOMBS[pk][kbIdx][fp]);
}
function _mergeKbItemTombs(src){
  try{ src=src||{};
    Object.keys(src).forEach(function(pk){
      if(!KB_ITEM_TOMBS[pk]) KB_ITEM_TOMBS[pk]={};
      Object.keys(src[pk]||{}).forEach(function(ki){
        if(!KB_ITEM_TOMBS[pk][ki]) KB_ITEM_TOMBS[pk][ki]={};
        Object.keys(src[pk][ki]||{}).forEach(function(fp){
          var a=Number(src[pk][ki][fp])||0, b=Number(KB_ITEM_TOMBS[pk][ki][fp])||0;
          if(a>b) KB_ITEM_TOMBS[pk][ki][fp]=a;
        });
      });
    });
  }catch(_e){}
}
/* 将墓碑应用到即将生效的快照：已删条目不得随同步回流。 */
function _applyKbItemTombs(projMap){
  try{
    Object.keys(KB_ITEM_TOMBS||{}).forEach(function(pk){
      var pr=projMap&&projMap[pk]; if(!pr||!pr.kb) return;
      Object.keys(KB_ITEM_TOMBS[pk]||{}).forEach(function(ki){
        var sec=pr.kb[Number(ki)]; if(!sec||!sec.known) return;
        sec.known=sec.known.filter(function(x){
          return !_isKbItemTombed(pk,ki,(typeof _kbText==='function')?_kbText(x):x);
        });
      });
    });
  }catch(_e){}
}
var KB_CONFIRMS={};  // {projKey:{kbIdx:{itemIdx:{status,text,ts}}}}

function restore(){
  try{
    var raw=localStorage.getItem(LS_KEY);
    if(!raw) return false;
    var data=JSON.parse(raw);
    if(data.PROJECTS&&Object.keys(data.PROJECTS).length>0){
      PROJECTS=data.PROJECTS;
      cur=data.cur||null;
      view=data.view||'setup';
      UPLOADS=data.UPLOADS||{};
      _mergeKbItemTombs(data.KB_ITEM_TOMBS);
      _applyKbItemTombs(PROJECTS);
      _mergeTombs(data.KB_CONFIRM_TOMBS);
      KB_CONFIRMS=_mergeConfirms(data.KB_CONFIRMS||{});
      KB_FILE_CHUNKS=data.KB_FILE_CHUNKS||{};
      KB_UNLOCKED=data.KB_UNLOCKED||{};
      REPORTSTATE=data.REPORTSTATE||{};
      PENDING_CONFIRMS=data.PENDING_CONFIRMS||{};
      DOCK_LOGS=data.DOCK_LOGS||{};
      OPS_ENT=data.OPS_ENT||[];
      if(data.REPORT_REQUESTS) REPORT_REQUESTS=data.REPORT_REQUESTS;
      if(data.USER_PROFILES) USER_PROFILES=data.USER_PROFILES;
      if(data.CITY_ACCOUNTS) CITY_ACCOUNTS=data.CITY_ACCOUNTS;
      if(data.INVITE_CODES) INVITE_CODES=data.INVITE_CODES;
      if(data.CITY_BASE_PACKAGES) CITY_BASE_PACKAGES=data.CITY_BASE_PACKAGES;
      if(data.RESET_GEN) RESET_GEN=data.RESET_GEN;
      console.log('[restore] loaded', Object.keys(PROJECTS).length,'projects, cur='+cur);
      return true;
    }
  }catch(e){ console.warn('[restore] failed:',e.message); }
  return false;
}

function restoreFromServer(callback){
  var localENT = OPS_ENT && OPS_ENT.length ? OPS_ENT.slice() : [];
  fetch('/api/sync?raw=1',{headers:{'X-HXZ-Report-Client':'website'}}).then(function(r){return r.json();}).then(function(raw){
    if(!raw){ window._opsDataReady=true; if(callback)callback(false); return; }
    var srv = (raw.huixiaozhao_kb_v1 && raw.huixiaozhao_kb_v1.PROJECTS)
              ? raw.huixiaozhao_kb_v1 : raw;
    if(!srv||!srv.PROJECTS||!Object.keys(srv.PROJECTS).length){
      window._opsDataReady=true;
      if(localENT.length && !OPS_ENT.length) OPS_ENT = localENT;
      if(callback)callback(false); return;
    }
    PROJECTS         = srv.PROJECTS         || {};
    UPLOADS          = srv.UPLOADS          || {};
    _mergeKbItemTombs(srv.KB_ITEM_TOMBS);
    // 【2026-09-18】必须过滤 srv.PROJECTS 本体，而不是只过滤内存里的 PROJECTS。
    // 本函数末尾会 `localStorage.setItem(LS_KEY, JSON.stringify(srv))` 回写原始 srv，
    // 只过滤内存的话脏数据仍会落盘，下次 restore 又把已删条目读回来。
    _applyKbItemTombs(srv.PROJECTS);
    _applyKbItemTombs(PROJECTS);
    _mergeTombs(srv.KB_CONFIRM_TOMBS);
    KB_CONFIRMS      = _mergeConfirms(srv.KB_CONFIRMS || {});  // 只进不退
    KB_FILE_CHUNKS   = srv.KB_FILE_CHUNKS   || {};
    KB_UNLOCKED      = srv.KB_UNLOCKED      || {};
    REPORTSTATE      = srv.REPORTSTATE      || {};
    PENDING_CONFIRMS = srv.PENDING_CONFIRMS || {};
    DOCK_LOGS        = srv.DOCK_LOGS        || {};
    if(srv.DEMANDS) DEMANDS = srv.DEMANDS;
    if(srv.REPORT_REQUESTS) REPORT_REQUESTS = srv.REPORT_REQUESTS;
    // Merge: server wins if non-empty; otherwise keep local/hardcoded
    if(srv.OPS_ENT && srv.OPS_ENT.length){
      OPS_ENT = srv.OPS_ENT;
    } else if(localENT.length){
      OPS_ENT = localENT;
    }
    if(srv.USER_PROFILES){ Object.keys(srv.USER_PROFILES).forEach(function(uk){ USER_PROFILES[uk]=srv.USER_PROFILES[uk]; }); }
    if(srv.CITY_ACCOUNTS){ CITY_ACCOUNTS = srv.CITY_ACCOUNTS; }
    if(srv.INVITE_CODES){ Object.keys(srv.INVITE_CODES).forEach(function(ck){ INVITE_CODES[ck]=srv.INVITE_CODES[ck]; }); }
    if(srv.RESET_GEN){ RESET_GEN = srv.RESET_GEN; }  // reset代际:persist时带回,否则被服务端拒绝
    // 政府端移除的企业线索墓碑：读回后既不重复推送，也从拉到的 clues 里剔除
    if(srv.DELETED_CLUES){
      window.DELETED_CLUES = srv.DELETED_CLUES;
      var _ct = srv.DELETED_CLUES;
      if(_ct.length){
        Object.keys(PROJECTS).forEach(function(_pk){
          var _pp=PROJECTS[_pk]; if(!_pp||!_pp.clues||!_pp.clues.length) return;
          _pp.clues=_pp.clues.filter(function(_c){ return !(_c && isClueDeleted(_pk, _c)); });
        });
      }
    }
    cur  = srv.cur  || Object.keys(PROJECTS)[0] || null;
    try{ localStorage.setItem(LS_KEY, JSON.stringify(srv)); }catch(e){}
    window._opsServerHadData=true;
    window._opsDataReady=true;
    // If server had no OPS_ENT but we have local data, push it up now
    if((!srv.OPS_ENT || !srv.OPS_ENT.length) && OPS_ENT.length){
      persist();
    }
    if(callback) callback(true);
  }).catch(function(e){ console.warn('[restoreFromServer]',e); window._opsDataReady=true; if(callback)callback(false); });
}

function clearPersist(){
  localStorage.removeItem(LS_KEY);
  toast('已清除本地存储');
}

var UPLOADS={};
var RESET_GEN=null;  // reset代际标记,从服务端读取后persist带回
var KB_FILE_CHUNKS={};

/* 【2026-09-18】确认墓碑 + 只进不退合并，与政府端 index.html 对称。
   两端共用同一 LS_KEY，任一端整体覆盖 KB_CONFIRMS 都会把对端刚点的确认回滚。 */
var KB_CONFIRM_TOMBS={};
function _tombConfirm(pk,kbIdx,itemIdx){
  if(!pk)return;
  if(!KB_CONFIRM_TOMBS[pk])KB_CONFIRM_TOMBS[pk]={};
  if(!KB_CONFIRM_TOMBS[pk][kbIdx])KB_CONFIRM_TOMBS[pk][kbIdx]={};
  KB_CONFIRM_TOMBS[pk][kbIdx][itemIdx]=Date.now();
}
function _mergeTombs(src){
  try{ src=src||{};
    Object.keys(src).forEach(function(pk){ if(!KB_CONFIRM_TOMBS[pk])KB_CONFIRM_TOMBS[pk]={};
      Object.keys(src[pk]||{}).forEach(function(ki){ if(!KB_CONFIRM_TOMBS[pk][ki])KB_CONFIRM_TOMBS[pk][ki]={};
        Object.keys(src[pk][ki]||{}).forEach(function(ii){
          var a=Number(src[pk][ki][ii])||0, b=Number(KB_CONFIRM_TOMBS[pk][ki][ii])||0;
          if(a>b) KB_CONFIRM_TOMBS[pk][ki][ii]=a;
        });
      });
    });
  }catch(_e){}
}
function _mergeConfirms(incoming){
  incoming=incoming||{};
  try{
    var localC=KB_CONFIRMS||{};
    Object.keys(localC).forEach(function(pk){
      var lSec=localC[pk]||{};
      Object.keys(lSec).forEach(function(ki){
        var lItems=lSec[ki]||{};
        Object.keys(lItems).forEach(function(ii){
          var lv=lItems[ii]; if(!lv) return;
          var tomb=KB_CONFIRM_TOMBS[pk]&&KB_CONFIRM_TOMBS[pk][ki]&&KB_CONFIRM_TOMBS[pk][ki][ii];
          if(tomb&&Number(tomb)>=(Number(lv.ts)||0)) return;
          if(!incoming[pk]) incoming[pk]={};
          if(!incoming[pk][ki]) incoming[pk][ki]={};
          var iv=incoming[pk][ki][ii];
          if(!iv||(Number(lv.ts)||0)>(Number(iv.ts)||0)) incoming[pk][ki][ii]=lv;
        });
      });
    });
    Object.keys(KB_CONFIRM_TOMBS||{}).forEach(function(pk){
      Object.keys(KB_CONFIRM_TOMBS[pk]||{}).forEach(function(ki){
        Object.keys(KB_CONFIRM_TOMBS[pk][ki]||{}).forEach(function(ii){
          var tb=Number(KB_CONFIRM_TOMBS[pk][ki][ii])||0;
          var iv=incoming[pk]&&incoming[pk][ki]&&incoming[pk][ki][ii];
          if(iv&&tb>=(Number(iv.ts)||0)) delete incoming[pk][ki][ii];
        });
      });
    });
  }catch(_e){}
  return incoming;
}
// 招引方向派生的项目（方案A三层：产业方向→报告→招引方向项目）{产业key:[{name,stage,from}]}
var SUBPROJ={};
function saveSubproj(){try{localStorage.setItem('hxz_subproj',JSON.stringify(SUBPROJ))}catch(e){}}
function loadSubproj(){try{var d=localStorage.getItem('hxz_subproj');if(d)SUBPROJ=JSON.parse(d)}catch(e){}}
function subprojOf(k){return SUBPROJ[k]||[]}
function saveUploads(){try{localStorage.setItem('hxz_uploads',JSON.stringify(UPLOADS))}catch(e){}}
function loadUploads(){try{var d=localStorage.getItem('hxz_uploads');if(d)UPLOADS=JSON.parse(d)}catch(e){}}
function addUpload(name){var k=cur;if(!UPLOADS[k])UPLOADS[k]=[];UPLOADS[k].push({name:name,at:new Date().toLocaleString('zh-CN')});saveUploads();}
loadReportState();loadUploads();loadSubproj();
var TOPIC_REPORTS={
  '\u9999\u83c7\u7cbe\u6df1\u52a0\u5de5\u5347\u7ea7': '## 一、产业基础判断\n\n随州香菇全产业链2024年产值超**500亿元**，区域品牌价值205.8亿，连续3年全国食药用菌第一。全球白花菇约**50%**产自随州，品源「菇的辣克」2024签1亿美元+2025续签3亿美元出口订单。种植端极强但精深加工本地布局极薄，高附加值环节大量外流。\n\n## 二、产业链缺口分析\n\n- ✅ 已有：种植采摘（全球最大白花菇产区）、品牌出口（品源4亿美元订单）、初加工\n- ❌ 缺失：香菇多糖/多肽规模化提取（仅裕国/肽源2家，A=必须本地化）\n- ❌ 缺失：菌种自主研发（国外7925/7917品种垄断，本地零布局）\n- ⚠️ 薄弱：功能性食品OEM（市场空间大，本地无规模企业）\n\n## 三、补链优先级TOP3\n\n| 排名 | 缺口节点 | 属性 | 综合优先级 |\n|---|---|---|---|\n| 1 | 香菇多糖/多肽提取平台 | A=必须本地化 | 第一优先 |\n| 2 | 菌种自主研发基地 | A=必须本地化 | 第二优先 |\n| 3 | 功能性食品OEM | B=可跨区域 | 第三优先 |\n\n## 四、目标企业画像\n\n**香菇多糖/多肽提取（第一优先）**\n- 目标：功能成分提取企业，年处理鲜菇≥5万吨，寻求中部原料产地合作\n- 话术：随州年产香菇约70万吨，落地可将原料采购成本降低40%+，与裕国/肽源形成产能协作。\n\n**菌种研发（第二优先）**\n- 目标：具备食用菌育种能力的科研院所或企业\n- 话术：随州种植规模为全球最大实验场景，育种成果可立即实现万亩级产业化验证。\n\n## 五、待确认事项\n\n⚠️ 随县香菇产业园精深加工区GMP洁净厂房现状，需现场核实\n⚠️ 菌种研发基地用地指标与配套政策，需园区管委会确认',
  '\u6c22\u80fd\u4e13\u7528\u8f66\u8865\u94fe': '## 一、产业基础判断\n\n随州是中国专用汽车之都，2025年专用汽车产值**703亿元**（+12.1%），年产专用车约**16万辆**，全国占比>10%。新楚风49T氢重卡已量产，百公里氢耗7.1kg续航1000km。本地配套率仅**41%**，燃料电池电堆全部外采，成本占整车53%。\n\n## 二、产业链缺口分析\n\n- ✅ 已有：整车改装（97家资质企业）、车身驾驶室（齐星）、车规级晶振（泰晶）\n- ❌ 缺失：燃料电池电堆（占整车成本53%，全部外购，A=必须本地化）\n- ❌ 缺失：高压储氢瓶阀与管路（占整车成本14%，全部外采）\n- ⚠️ 薄弱：底盘/动力总成（依赖十堰，占整车50%成本）\n\n## 三、补链优先级TOP3\n\n| 排名 | 缺口节点 | 属性 | 综合优先级 |\n|---|---|---|---|\n| 1 | 燃料电池电堆 | A=必须本地化 | 第一优先 |\n| 2 | 高压储氢瓶阀管路 | A=必须本地化 | 第二优先 |\n| 3 | 电堆密封件/碳纸 | B=可跨区域 | 第三优先 |\n\n## 四、目标企业画像\n\n**燃料电池电堆（第一优先）**\n- 目标：商用车功率段燃料电池系统集成商，年产能≥3000台\n- 话术：随州新楚风49T氢重卡已量产，年产能16万辆整车基地是进入商用车场景最快验证通道，落地即锁定程力/新楚风稳定采购订单。\n\n## 五、待确认事项\n\n⚠️ 湖北省氢能专项补贴额度与首选承接园区需向领导确认\n⚠️ 程力/新楚风首批电堆采购意向与数量，需走访链主企业核实',
  '\u667a\u6167\u5e94\u6025\u88c5\u5907\u8865\u94fe': '## 一、产业基础判断\n\n随州安全应急产业2023年总产值**502亿元**，其中移动应急装备324亿，是国家安全应急产业示范基地。博利特高空系留无人机消防车、齐星无人机指挥车已量产，金龙篷布全国占比30%。但感知层（机器人/传感器）与通信层（5G模块）本地几乎空白。\n\n## 二、产业链缺口分析\n\n- ✅ 已有：移动应急整车（博利特/齐星/江南）、篷布风机（金龙30%全国市场）\n- ❌ 缺失：应急机器人本体（依赖外采启灵，B=可跨区域）\n- ❌ 缺失：5G/卫星应急通信模块（本地零布局）\n- ⚠️ 薄弱：无人机本体（依赖外采迅北斗，未本地化）\n\n## 三、补链优先级TOP3\n\n| 排名 | 缺口节点 | 属性 | 综合优先级 |\n|---|---|---|---|\n| 1 | 应急机器人本体 | B=可跨区域 | 第一优先 |\n| 2 | 无人机本体 | B=可跨区域 | 第二优先 |\n| 3 | 5G应急通信模块 | B=可跨区域 | 第三优先 |\n\n## 四、目标企业画像\n\n**应急机器人（第一优先）**\n- 目标：消防/救援机器人制造企业，具备防爆/耐高温认证\n- 话术：随州是国家安全应急示范基地，博利特/齐星整车平台就是机器人最好的集成搭载场景。\n\n## 五、待确认事项\n\n⚠️ 国家示范基地配套用地指标与政策，需主管部门确认\n⚠️ 博利特/齐星对机器人本地化配套采购意向，需走访核实',
  '\u4ea7\u4e1a\u8f6c\u79fb\u627f\u63a5': '## 一、产业基础判断\n\n随州地处中部交通枢纽，用工/土地成本较沿海低30-40%，经开区/高新区厂房资源充裕。专用汽车产业链为承接汽车零部件配套提供了天然需求端，香菇产业为食品加工提供了原料优势。当前沿海制造业向中部转移窗口明确，随州承接条件具备。\n\n## 二、适合承接的产业方向\n\n- ✅ 优先：汽车零部件配套（就近供应程力/新楚风/齐星，需求稳定）\n- ✅ 优先：劳动密集型轻工制造（篷布/纺织/包装，人力成本优势显著）\n- ⚠️ 潜力：食品精深加工（香菇/农产品原料丰富，冷链待完善）\n- ⚠️ 培育：电子零部件组装（泰晶晶振生态初步形成）\n\n## 三、承接优先方向TOP3\n\n| 排名 | 方向 | 核心优势 | 综合评级 |\n|---|---|---|---|\n| 1 | 汽车零部件配套 | 专汽产业链需求牵引 | 第一优先 |\n| 2 | 劳动密集型制造 | 用工/土地成本优势 | 第二优先 |\n| 3 | 食品精深加工 | 农业原料资源丰富 | 第三优先 |\n\n## 四、目标企业画像\n\n**汽车零部件（第一优先）**\n- 目标：沿海汽车零部件企业，寻求降本转移，年产值5000万以上\n- 话术：随州16万辆/年专用车产量就是您稳定的本地订单，就近配套可节省15-20%物流成本。\n\n## 五、待确认事项\n\n⚠️ 各园区可承接厂房面积与租金优惠政策，需园区管委会确认\n⚠️ 转移企业税收减免与人才补贴，需招商局确认'
};
function getTopicReport(topic){
  if(!topic) return null;
  var keys=Object.keys(TOPIC_REPORTS);
  for(var i=0;i<keys.length;i++){ if(topic===keys[i]) return TOPIC_REPORTS[keys[i]]; }
// 预置样板：随州氢能一条完整主线（其余方向留白，避免全空也不塞满假数据）
(function seedDemo(){
  if(localStorage.getItem('hxz_seeded_v3'))return;
  REPORTSTATE.sz={ver:2,finalized:true,patches:['楚胜汽车园区可承接电控配套'],edits:{}};
  UPLOADS.sz=[];
  // 派生项目：dir 与 clueName 必须与 PROJECTS.sz.clues 完全一致，右侧栏/工作页才能匹配到候选企业
  SUBPROJ.sz=[
    {name:'商用车燃料电池系统集成商 · 引进项目',dir:'商用车燃料电池系统集成商 · 长三角',clueName:'脱敏企业 A（氢驰动力·代号）',stage:5,from:'氢能专用车补链'},
    {name:'燃料电池电堆研发与制造 · 引进项目',dir:'燃料电池电堆研发与制造企业 · 华南',clueName:'脱敏企业 B（势通氢能·代号）',stage:4,from:'氢能专用车补链'}
  ];
  // 随州氢能已定稿并派生项目、进入对接 → 阶段应到「招商对接」，否则进度条/招商对接页与事实矛盾
  if(PROJECTS.sz)PROJECTS.sz.stage=5;
  saveReportState();saveUploads();saveSubproj();
  try{localStorage.setItem('hxz_seeded_v3','1')}catch(e){}
})();
}
// 历史报告 / 上传材料 弹窗（历史报告入口）
function openHistory(){
  var st=REPORTSTATE[cur];var ups=UPLOADS[cur]||[];
  var repHtml = st ? ('<div class="source-list"><li onclick="closeModal();go(\'report\');setTimeout(showReport,60)" style="cursor:pointer"><i class="i">📄</i>'+P().topic+' 研判报告 · v'+st.ver+(st.finalized?'（已定稿）':'（草稿）')+'<small>点击重新打开</small></li></div>') : '<p class="modal-intro">该项目暂无已生成的报告。</p>';
  var upHtml = ups.length ? ('<ul class="source-list">'+ups.map(function(u){return '<li><i class="i">📎</i>'+u.name+'<small>'+u.at+'</small></li>'}).join('')+'</ul>') : '<p class="modal-intro">暂无上传的材料。</p>';
  openModal('历史报告 / 上传材料',
    '<div style="font-size:12px;font-weight:650;color:#0b183b;margin:2px 0 8px">📄 历史报告</div>'+repHtml+
    '<div style="font-size:12px;font-weight:650;color:#0b183b;margin:16px 0 8px">📎 上传过的材料</div>'+upHtml+
    '<div class="boundary-note" style="margin-top:14px"><i class="i">ℹ</i>报告与材料已本地保存，关闭页面后再次打开仍可查看。</div>',
    '<button class="primary-button" onclick="closeModal()">完成</button>');
}
function convEl(){return $('#conv')||$('#kbConv')}
function addU(t){var c=$('#conv');if(!c)return;var d=document.createElement('div');d.className='message is-user';
  d.innerHTML='<div class="message-bubble"><p>'+t+'</p></div>';c.appendChild(d);sd()}
function addA(html){var c=$('#conv');if(!c)return;var d=document.createElement('div');d.className='message';
  d.innerHTML='<img src="'+aiAvatar()+'"><div class="message-bubble">'+html+'</div>';c.appendChild(d);sd();return d}
function addRaw(html){var c=$('#conv');if(!c)return;var d=document.createElement('div');d.style.margin='0 0 20px 60px';d.innerHTML=html;c.appendChild(d);sd();return d}
function sd(){var c=$('#conv');if(c)c.scrollTop=c.scrollHeight}
function setStage(n){P().stage=n;var f=$('.progress-footer');if(f)f.outerHTML=progressFooter(P());}

function startFlow(mode){
  if(view!=='report'){view='report';render();}
  var p=P();
  var label={direction:'围绕 '+p.topic+' 分析'+p.city+'的上下游缺口与招引环节',
             upload:'[上传] '+p.city+'市2026年政府工作报告.pdf',
             verify:'帮我核验几家目标企业是否值得招引'}[mode];
  // 清空prompt-list
  var pl=$('.prompt-list');if(pl)pl.remove();
  addU(label);
  if(p.stage<2)setStage(2);
  var _kbStr=(p.kb||[]).map(function(k){return k.t}).join('、');
  addA('<p>已开始结合<strong>'+p.city+'城市智库</strong>（覆盖：'+_kbStr+'）、授权材料与最新公开信息研判「'+p.topic+'」。下一步先给出产业链缺口与建议招引方向，再明确仍需补充与核实的事项。</p><p>可继续补充材料，也可直接生成初步报告。</p>');
  setTimeout(function(){ p.report?showReport():addA('<p>正在基于城市智库生成「'+p.topic+'」研判报告，请稍候…</p>'); },600);
}
// 报告：复刻雷总 report-document 结构 + 版本迭代/人工可编辑/定稿
function showReport(){
  var r=P().report;if(!r){startFlow('direction');return;}
  var st=rs();
  var band='<div class="report-summary-band">'+r.summary.map(function(s){return '<div><span>'+s[0]+'</span><strong>'+s[1]+'</strong></div>'}).join('')+'</div>';
  var secs=r.sections.map(function(s,i){var ev=encodeURIComponent(JSON.stringify(s));
    var badge=s.type==='virt'?'<span class="status-tag amber" style="margin-left:8px">待核实</span>':'<span class="status-tag teal" style="margin-left:8px">实据</span>';
    var chk=s.chk?'<span class="report-evidence" style="color:#a34c09"><i class="i">⚠</i>仍需确认：'+s.chk+'</span>':'';
    var edited=st.edits[i];  // 人工修正过的文字
    var body=edited?('<p style="color:#013582"><i class="i">✎</i> '+edited+' <em style="color:#9aa5b5;font-style:normal;font-size:11px">（人工修正）</em></p>'):('<p>'+s.p+'</p>');
    var editBtn=st.finalized?'':'<button class="link-btn" style="border:0;background:none;color:#0757ad;font-size:11px;cursor:pointer;padding:2px 0" onclick="event.stopPropagation();editSection('+i+')">✎ 修正此条</button>';
    return '<div class="report-section"><span>0'+(i+1)+'</span>'+
      '<div style="flex:1"><h2 style="cursor:pointer" onclick="pickFold(\''+ev+'\',this)">'+s.h+badge+'</h2>'+body+
      '<span class="report-evidence" style="cursor:pointer" onclick="pickFold(\''+ev+'\',this)"><i class="i">🔎</i>依据：'+s.ev+'</span>'+chk+' '+editBtn+'</div></div>';}).join('');
  // 版本头 + 补充优化区
  var verTag='<span class="status-tag" style="background:#eef3fb;color:#013582">v'+st.ver+(st.finalized?' · 已定稿':' · 草稿')+'</span>';
  var patchLog=st.patches.length?('<div style="margin-top:10px;padding:10px 12px;background:#f7f9fc;border-radius:8px;font-size:12px;color:#556"><strong>修订记录：</strong>'+st.patches.map(function(p,i){return '<div style="margin-top:4px">v'+(i+2)+' · 据补充「'+p+'」重新生成</div>'}).join('')+'</div>'):'';
  var optArea=st.finalized?
    '<div class="report-footnote" style="color:#15803d">✅ 报告已定稿并锁定，可进行双确认递交。</div>':
    '<div style="margin-top:14px;padding:13px 15px;background:#f3f7fd;border:1px solid #d8e0ed;border-radius:10px">'+
      '<div style="font-size:13px;font-weight:650;color:#0b183b;margin-bottom:8px">🔄 报告来回优化</div>'+
      '<div style="font-size:11.5px;color:#667590;margin-bottom:8px">补充材料或指出问题，我会<strong>结合你的补充重新生成一份完整报告</strong>（保留历史版本）；也可点每条「✎ 修正此条」直接人工改写。</div>'+
      '<textarea id="patchInput" placeholder="例如：补充——楚胜汽车园区可承接；或：第2条判断有误，电控本地已有供应…" style="width:100%;min-height:52px;border:1px solid #cdd8e8;border-radius:8px;padding:9px 11px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box"></textarea>'+
      '<div style="display:flex;gap:8px;margin-top:9px"><button class="primary-button" style="flex:0 0 auto" onclick="applyPatch()">🔄 结合补充重新生成</button>'+
      '<button class="ghost-button" onclick="finalizeReport()">🔒 报告定稿</button></div>'+
    '</div>';
  var confirmArea=st.finalized?
    ('<div class="detail-actions-stack" style="border:0;padding:16px 0 0">'+
      '<div class="confirm-row" onclick="cadreOK(this)"><input type="checkbox" id="ck1"><span><strong>干部确认</strong><small>确认判断准确、需求成立</small></span></div>'+
      '<div class="confirm-row" onclick="leaderOK(this)"><input type="checkbox" id="ck2" disabled><span><strong>授权领导确认</strong><small>干部确认后开放</small></span></div>'+
      '<button class="primary-button" id="submitBtn" disabled onclick="submitNeed()"><i class="i">🚀</i>完成双确认 · 正式递交</button>'+
      '<small>双确认通过后，报告的补链方向将自动建成项目并挂到「项目管理」</small>'+
    '</div>'):
    '<div class="report-footnote" style="color:#a34c09">⚠ 报告定稿后才能进行双确认与递交（避免半成品报告进入流程）。</div>';
  addRaw('<div class="report-document">'+
    '<div class="report-lead" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><span>STRATEGY REPORT '+verTag+'</span><p>'+r.lead+'</p></div>'+
      '<button class="ghost-button" style="flex:0 0 auto;white-space:nowrap" onclick="exportReport()"><i class="i">📤</i>导出报告</button></div>'+
    band+secs+
    '<div class="report-footnote">'+r.footnote+'</div>'+patchLog+optArea+confirmArea+'</div>');
}
// 人工修正某条结论（不依赖AI，直接编辑）
function editSection(i){
  var st=rs();var cur=st.edits[i]||P().report.sections[i].p;
  var v=prompt('人工修正第'+(i+1)+'条结论（直接改写，标注为人工修正）：',cur);
  if(v!==null&&v.trim()){st.edits[i]=v.trim();saveReportState();rerenderReport();toast('已人工修正第'+(i+1)+'条');}
}
// 补充意见→AI重出整份（务实：不假装只改某条）
function applyPatch(){
  var ta=$('#patchInput');if(!ta)return;var v=ta.value.trim();if(!v){toast('请先输入补充或修改意见');return;}
  var st=rs();st.patches.push(v);st.ver++;saveReportState();
  toast('已结合补充「'+v.slice(0,12)+'…」重新生成 v'+st.ver);
  rerenderReport();
}
function finalizeReport(){var st=rs();st.finalized=true;saveReportState();toast('报告已定稿并锁定');rerenderReport();}
// 重绘报告：删掉当前报告DOM重新showReport
function rerenderReport(){
  var doc=document.querySelector('.report-document');
  if(doc&&doc.parentElement)doc.parentElement.remove();
  showReport();
}
function pickFold(ev,el){detailData={kind:'fold',d:JSON.parse(decodeURIComponent(ev))};if(!detailOpen)detailOpen=true;
  var dp=$('.detail-pane');if(dp){dp.innerHTML='<button class="collapse-detail" onclick="toggleDetail()"><i class="i">✕</i></button><div class="detail-page">'+detailFold(detailData.d)+'</div>';}else render();}
function cadreOK(row){var ck=row.querySelector('input');ck.checked=true;$('#ck2').disabled=false;toast('干部已确认，待授权领导确认')}
function leaderOK(row){var ck=row.querySelector('input');if(ck.disabled){toast('请先完成干部确认');return;}ck.checked=true;$('#submitBtn').disabled=false;toast('双确认完成，可正式递交')}
// 双确认 == 从研判进入项目管理的唯一关口：通过后报告的「补链方向」自动派生为项目
/* 跨端桥接：政府端双确认递交 → upsert 一条管理端需求池记录（黄金演示动线第1→2步） */
function syncDemandFromProject(){
  var p=P();if(!p)return;
  var cl=p.clues||[];
  var domain=(cl[0]&&(cl[0].dir||'').split(' · ')[0])||p.topic.replace('补链','').replace('升级','').replace('智能化','');
  var exist=DEMANDS.find(function(d){return d.city===p.city&&d.topic===p.topic});
  var payload={
    city:p.city, gov:p.org+'·'+p.who, topic:p.topic, domain:domain,
    need:cl.map(function(c){return c.dir.split(' · ')[0]}).join(' / ')||p.topic,
    submit:'刚刚', res:'checking', resLabel:'核验中', clues:cl.length,
    note:'政府端双确认递交，等待资源端核验匹配。', fromGov:true
  };
  if(exist){Object.keys(payload).forEach(function(k){if(k!=='res'&&k!=='resLabel'&&k!=='clues')exist[k]=payload[k];});exist.submit='刚刚';}
  else{payload.id='dg'+Date.now();DEMANDS.unshift(payload);}
  // 更新城市漏斗（提交+确认各+1；若该城市不存在则新建）
  var f=CITY_FUNNEL.find(function(x){return x.city===p.city});
  if(f){f.submit++;f.confirm++;}else{CITY_FUNNEL.push({city:p.city,submit:1,confirm:1,match:0,dock:0,sign:0});}
}
function submitNeed(){
  setStage(3);
  var cl=P().clues||[];var n=cl.length;
  syncDemandFromProject();
  // 【自动派生项目】把报告里每个补链方向变成一个招引项目，挂到当前产业方向下（去重）
  if(!SUBPROJ[cur])SUBPROJ[cur]=[];
  var made=0;
  cl.forEach(function(c){
    if(SUBPROJ[cur].some(function(m){return m.name===c.dir}))return;
    SUBPROJ[cur].push({name:c.dir,dir:c.dir,clueName:c.name,stage:4,from:P().topic});
    made++;
  });
  saveSubproj();
  if(n===0){
    // 无补链方向可派生（高概率一家都没有）——需求仍进入资源池
    addA('<p>✅ 双确认完成，已生成<strong>正式招商需求</strong>并递交资源端。</p>');
    addRaw('<div class="clue-origin"><i class="i">🔗</i>需求已递交<button onclick="scrollToReport()">查看报告</button></div>'+
      '<div style="border:1px dashed #cdd8e8;border-radius:10px;padding:20px;text-align:center;background:#fafbfd">'+
        '<div style="font-size:26px;margin-bottom:6px">📭</div>'+
        '<div style="font-size:13.5px;font-weight:650;color:#0b183b">报告暂无明确补链方向</div>'+
        '<div style="font-size:12px;color:#667590;margin-top:6px;line-height:1.7">需求已进入资源池，资源端将持续核验可触达渠道，有匹配会通知你。</div>'+
        '<div style="margin-top:12px"><span class="status-tag" style="background:#fff0de;color:#a34c09">已纳入长期跟踪</span></div>'+
      '</div>'+
      '<div class="boundary-note"><i class="i">ℹ</i>无匹配也是有效结果——资源端会据此对接外部渠道，或等待新资源进入。</div>');
    setStage(4);
    setTimeout(function(){addRaw(dockPanel());setStage(5);},700);
    return;
  }
  addA('<p>✅ 双确认完成，已生成<strong>正式招商需求</strong>。系统已把报告的 <strong>'+n+' 个补链方向自动建成招引项目</strong>，挂在「项目管理 › '+P().topic+'」下，可分别推进对接——</p>');
  addRaw('<div class="clue-origin"><i class="i">🔗</i>项目由报告补链方向自动派生<button onclick="scrollToReport()">查看报告</button></div>'+
    '<div class="clue-list">'+cl.map(function(c,i){return '<div class="clue-row" onclick="go(\'home\');setTimeout(function(){toggleProjGroup(\''+cur+'\')},60)"><div class="clue-icon"><i class="i">🎯</i></div>'+
      '<div class="clue-main"><strong>'+c.dir.split(' · ')[0]+'</strong><small>候选线索 '+c.name+'</small><em>已建为项目 · 点击到「项目管理」查看</em></div>'+
      '<span class="status-tag" style="background:#ebf3fd;color:#013582">已建项目</span><i class="i">➜</i></div>';}).join('')+'</div>'+
    '<div style="margin-top:10px"><button class="primary-button" onclick="go(\'home\');setTimeout(function(){toggleProjGroup(\''+cur+'\')},60)"><i class="i">📋</i>前往项目管理查看 '+n+' 个项目</button></div>'+
    '<div class="boundary-note"><i class="i">ℹ</i>项目自动生成后即为独立对接线；候选企业由资源端核验可达性，系统不自动联系企业。</div>');
  setStage(4);
  setTimeout(function(){addRaw(dockPanel());setStage(5);},700);
}
function scrollToReport(){var r=document.querySelector('.report-document');if(r){r.scrollIntoView({behavior:'smooth',block:'start'});r.style.outline='2px solid #0757ad';setTimeout(function(){r.style.outline=''},1200);}else{toast('报告在当前对话上方')}}
// 导出报告：生成完整研判报告文件并下载
function exportReport(){
  var p=P();var r=p.report;if(!r){toast('请先生成报告');return;}
  var now=new Date().toLocaleString('zh-CN');var L=[];
  L.push(r.title);
  L.push('导出时间：'+now+'　|　编制：'+p.org+' · '+p.who);
  L.push('数据来源：'+p.city+'城市智库 + 公开信息（更新至 7月20日 06:00）');
  L.push('====================================================\n');
  L.push('【摘要】');L.push(r.lead+'\n');
  L.push('【关键指标】');r.summary.forEach(function(s){L.push('  '+s[0]+'：'+s[1])});L.push('');
  L.push('【研判结论】');
  r.sections.forEach(function(s,i){
    L.push('  '+(i+1)+'、'+s.h+'　['+(s.type==='virt'?'待核实':'实据')+']');
    L.push('     '+s.p);
    L.push('     依据来源：'+s.ev);
    if(s.chk)L.push('     ⚠ 仍需确认：'+s.chk);
    L.push('');
  });
  L.push('----------------------------------------------------');
  L.push('确认状态：需经 干部确认 → 授权领导确认 后方可正式递交');
  L.push('使用边界：'+r.footnote);
  L.push('====================================================');
  L.push('本报告由慧小招根据城市智库与公开信息自动生成，供招商研判参考；正式对接前需政府授权材料确认。');
  var blob=new Blob([L.join('\n')],{type:'text/plain;charset=utf-8'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=r.title+'.txt';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  toast('报告已导出：'+r.title);
}
function pickClue(i){detailData={kind:'clue',d:P().clues[i]};if(!detailOpen)detailOpen=true;
  var dp=$('.detail-pane');if(dp){dp.innerHTML='<button class="collapse-detail" onclick="toggleDetail()"><i class="i">✕</i></button><div class="detail-page">'+detailClue(detailData.d)+'</div>';}else render();
  toast('右侧显示「'+P().clues[i].name+'」核验要点')}
function dockPanel(){
  var _dp=P();var _dpClue=(_dp.clues||[])[0]||{};
  return '<div class="timeline-panel"><h2>📡 递交与对接（资源端处理，此处只读）</h2><div class="timeline">'+
    '<div class="timeline-item done"><div class="timeline-dot"><i class="i">✓</i></div><div><div class="timeline-title"><strong>需求已正式递交</strong><time>今天</time></div><p>已同步「'+_dp.topic+'」招商需求、随州承接区域与报告证据链至资源端。</p></div></div>'+
    '<div class="timeline-item current"><div class="timeline-dot"><i class="i">◔</i></div><div><div class="timeline-title"><strong>资源可达性核验中</strong><time>预计 2 个工作日</time></div><p>资源团队正在核验'+(_dpClue.name||'候选脱敏企业')+'的真实投资意向与决策层触达路径。</p></div></div>'+
    '<div class="timeline-item"><div class="timeline-dot"><i class="i">•</i></div><div><div class="timeline-title"><strong>首次沟通待安排</strong><time>待资源回传</time></div><p>核验可触达后，系统提醒准备随州承接材料（园区/政策/可用时段），安排实地走访+政企座谈。</p></div></div>'+
    '</div></div>'+
    '<div class="task-panel"><h2>轻自动化（只做这些）</h2>'+
      ['状态变化时通知政府端','超时提醒（3个工作日无更新）','根据阶段生成政府待办','每日 09:00 汇总进行中事项'].map(function(x){return '<div class="task-row"><i class="i">🔔</i><span><strong>'+x+'</strong></span></div>'}).join('')+
      '<div class="boundary-note"><i class="i">🔒</i>自动化只负责材料抽取、状态建议、提醒和台账更新建议，<strong>不自动联系企业、不跳过确认关口</strong>。</div>'+
    '</div>';
}
// 城市智库快捷提问（顶部"可以这样问"）→ 填入输入框，由用户点发送
function askKB(q){
  var c=document.getElementById('kbConv');
  if(!c){fillComposer(q);return;}
  var ud=document.createElement('div');
  ud.className='message is-user';
  ud.innerHTML='<div class="message-bubble"><p>'+q+'</p></div>';
  c.appendChild(ud);c.scrollTop=c.scrollHeight;
  kbRAGQuery(q,c);
}
// 把问题填进输入框并聚焦（不自动发送）
function fillComposer(q){
  var ta=$('#composerTa');
  if(ta){ta.value=q;ta.focus();ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,120)+'px';toast('已填入输入框，点发送即可提问');}
}
// 统一的城市智库问答：回复对应主题 + 底部列出调用来源
/* ══ RAG ENGINE START ══ */
/* ══════════════════════════════════════════════════════════════
   KB RAG ENGINE — 纯前端 BM25-style 检索 + 结构化生成
   数据来源：慧小招2026-07实测报告（随州专项）
   ══════════════════════════════════════════════════════════════ */

/* ── 1. 知识语料库 buildKBCorpus(city) ── */
function buildKBCorpus(city){
  var p=P(); var isSZ=city&&city.indexOf('随州')>=0;
  // 每条 chunk: {id, topic, tags:[], text, cite}
  var chunks=[];
  if(p&&p.kb){
    p.kb.forEach(function(k){
      (k.known||[]).forEach(function(t,i){
        chunks.push({id:k.t+':'+i, topic:k.t, tags:topicTags(k.t), text:t, cite:k.t});
      });
    });
  }
  var fc=(cur&&KB_FILE_CHUNKS[cur])||[];
  if(fc.length){ chunks=chunks.concat(fc); console.log('[RAG] +'+fc.length+' file chunks'); }
  // 追加竞争格局数据（随州专项）
  if(isSZ){
    var compChunks=[
      {id:'comp:gdp',   topic:'竞争格局', tags:['GDP','经济','总量','对比'],
       text:'随州2024年GDP 1442.35亿元，全省第12/13位，规上工业增速+9.9%，人均GDP 71981元',cite:'竞争格局分析'},
      {id:'comp:sz',    topic:'竞争格局', tags:['竞争','十堰','对手','商用车'],
       text:'十堰是最直接竞争对手：2023年汽车产业产值960亿，整车12家+零部件3167家，目标2026年破2500亿，主攻新能源商用车+高端应急装备车，正抢应急专用车赛道',cite:'竞争格局分析'},
      {id:'comp:jm',    topic:'竞争格局', tags:['竞争','荆门','锂电','电池'],
       text:'荆门是锂电领域碾压性对手：亿纬动力212GWh占全省50%，长城汽车整车300亿；随州不宜正面竞争锂电赛道',cite:'竞争格局分析'},
      {id:'comp:xg',    topic:'竞争格局', tags:['竞争','孝感','应急','产业园'],
       text:'孝感中能华中应急智能制造低碳产业园42.8亿，省唯一应急装备智造先导区，直接对标随州应急产业',cite:'竞争格局分析'},
      {id:'comp:diff',  topic:'竞争格局', tags:['差异化','机会','氢能','低空','香菇'],
       text:'随州差异化空间：氢能专用车(全国唯一已量产49T氢重卡)、应急软体新材料(金龙篷布全国30%)、低空经济+专汽融合、香菇/银杏农产品加工(全国唯一性)',cite:'竞争格局分析'},
      {id:'sz:ind1',    topic:'主导产业', tags:['专用汽车','产值','规模','整车'],
       text:'专用汽车：2025年专汽应急产业产值703亿元(+12.1%)，年产约16万辆，全国占比>10%，专汽出口+71%全省第一，资质企业97家/零部件企业220家，整体目标2026年破千亿',cite:'产业链缺口测绘报告'},
      {id:'sz:ind2',    topic:'主导产业', tags:['新能源','配套率','缺口','外购'],
       text:'本地配套率仅41%，远低于山东梁山65%和十堰75%+；底盘/动力总成(占整车成本50%)几乎全外购十堰潍柴/法士特/汉德；新能源占比仅3-5%(2024年新能源专车5247辆)',cite:'产业链缺口测绘报告'},
      {id:'sz:h2',      topic:'氢能专用车', tags:['氢能','电堆','储氢','新楚风','补链'],
       text:'氢燃料电池电堆占整车成本53%、储氢瓶占14%，两项核心系统全部外购；新楚风49T氢重卡已量产(百公里氢耗7.1kg/续航1000km)；空压机、氢气循环泵、膜电极、质子交换膜同为本地空白',cite:'产业链缺口测绘报告'},
      {id:'sz:emg',     topic:'安全应急', tags:['应急','消防','无人机','机器人','智慧'],
       text:'应急装备2023年总产值502亿，移动应急装备324亿；江南专汽泡沫消防车/通信指挥车600-1000万/台；博利特高空系留无人机消防车；但应急机器人依赖启灵外采、无人机依赖迅北斗外采，5G通信模块本地零布局',cite:'产业链缺口测绘报告'},
      {id:'sz:mush',    topic:'香菇产业', tags:['香菇','精深加工','品种','提取','品源'],
       text:'香菇2024年全产业链产值超500亿，区域品牌价值205.8亿(连续3年全国食药用菌第一)；品源"菇的辣克"2024签1亿美元+2025续签3亿美元，进沃尔玛/Costco；但菌种长期依赖国外7925/7917老品种，多糖/多肽提取仅裕国/肽源2家布局',cite:'产业链缺口测绘报告'},
      {id:'sz:park1',   topic:'园区', tags:['高新区','国家级','园区','曾都'],
       text:'随州高新区2015年升级国家级，拥有国字号11块，含"移动应急装备国家创新型产业集群"牌子；曾都区为国家安全应急产业示范基地',cite:'产业链缺口测绘报告'},
      {id:'sz:park2',   topic:'园区', tags:['专汽','产业园','香菇','随县','承接'],
       text:'30公里专汽长廊是整车/改装承载主区，已有程力/齐星等入驻；随县香菇产业园已有初加工企业入驻，精深加工GMP洁净厂房条件待核实；区位：汉十高铁至武汉50分钟/至襄阳30分钟',cite:'产业链缺口测绘报告'},
      {id:'sz:pol1',    topic:'政策', tags:['氢能走廊','政策','省级','补贴'],
       text:'湖北省氢能走廊：武汉-十堰-随州-襄阳沿线布局，随州以氢能专用车为主攻，专项支持方向已明确；但专项资金具体额度需向主管部门确认',cite:'政策规划研究'},
      {id:'sz:pol2',    topic:'政策', tags:['应急示范','基地','政策','机器人'],
       text:'曾都区国家安全应急产业示范基地政策支持智慧应急装备落地，对机器人/无人机/5G通信模块有专项引导；孝感应急产业园42.8亿为直接竞争对手，需尽快锁定差异化方向',cite:'政策规划研究'},
      {id:'sz:pol3',    topic:'政策', tags:['香菇','农业','精深加工','政策'],
       text:'随州将香菇精深加工与品牌化列为农业升级重点；但菌种自主研发基地、洁净厂房用地指标、首选承接园区等具体事项须向领导确认',cite:'政策规划研究'},
    ];
    chunks=chunks.concat(compChunks);
  }
  return chunks;
}

/* 关键数据高亮 */
function highlightKeyData(text){
  if(!text) return text;
  return text.replace(/(\d+[\d,.]*)\s*(亿元|亿|万辆|万吨|万m³|万㎡|万顶|万台|GWh|km|kg)/g,'<strong style=\"color:#1a56db;font-weight:700\">$1$2</strong>')
    .replace(/(\d+[\d.]*%)/g,'<strong style=\"color:#1a56db;font-weight:700\">$1</strong>')
    .replace(/(程力|新楚风|齐星|江南专汽|博利特|金龙新材料|品源|裕国药业|肽源|泰晶科技|犇星|昱通)/g,'<strong style=\"color:#6d28d9;font-weight:650\">$1</strong>')
    .replace(/(燃料电池电堆|储氢瓶|质子交换膜|膜电极|应急机器人|无人机本体|菌种自主权|香菇多糖|多肽提取)/g,'<em style=\"background:#fef3c7;color:#92400e;border-radius:3px;padding:0 3px;font-style:normal\">$1</em>')
    .replace(/(全部外购|靠外采|本地空白|国外垄断|待领导确认|待核实)/g,'<span style=\"color:#dc2626;font-weight:600\">$1</span>');
}

function topicTags(t){
  if(t.indexOf('产业')>=0) return ['产业','主导','集群','链条','规模','产值'];
  if(t.indexOf('园区')>=0) return ['园区','承接','厂房','能耗','载体','开发区'];
  if(t.indexOf('链主')>=0||t.indexOf('企业')>=0) return ['企业','链主','配套','采购','缺口','外购'];
  if(t.indexOf('政策')>=0) return ['政策','规划','资金','补贴','领导','交办'];
  return [];
}

/* ── 2. BM25-style 检索 ── */
function kbSearch(query, chunks, topK){
  topK=topK||4;
  // 分词：中文按字/词切割，英文按空格
  function tokenize(s){
    var tokens=[];
    // 提取所有2-4字中文词组 + 数字+单位
    var m; var re=/[\u4e00-\u9fff]{2,4}|[A-Za-z0-9]+[%亿万辆元]/g;
    while((m=re.exec(s))!==null) tokens.push(m[0]);
    // 单字 fallback
    s.replace(/[\u4e00-\u9fff]/g,function(c){tokens.push(c);});
    return tokens;
  }
  var qTokens=tokenize(query);

  // IDF: log(N/df+1), TF: count/len
  var N=chunks.length;
  var df={};
  chunks.forEach(function(c){
    var seen={};
    tokenize(c.text+' '+c.topic+' '+(c.tags||[]).join(' ')).forEach(function(t){
      if(!seen[t]){df[t]=(df[t]||0)+1; seen[t]=1;}
    });
  });

  var scored=chunks.map(function(c){
    var doc=c.text+' '+c.topic+' '+(c.tags||[]).join(' ');
    var docTokens=tokenize(doc);
    var len=Math.max(docTokens.length,1);
    var score=0;
    qTokens.forEach(function(qt){
      var tf=0;
      docTokens.forEach(function(dt){ if(dt===qt||dt.indexOf(qt)>=0||qt.indexOf(dt)>=0) tf++; });
      var idf=Math.log((N+1)/((df[qt]||0)+1));
      // BM25 k1=1.5 b=0.75 avgdl=50
      var bm25=(tf*(1.5+1))/(tf+1.5*(1-0.75+0.75*len/50));
      score+=bm25*idf;
    });
    // boost: tag 精确匹配
    (c.tags||[]).forEach(function(tag){
      if(query.indexOf(tag)>=0) score+=2.5;
    });
    return {chunk:c, score:score};
  });

  scored.sort(function(a,b){return b.score-a.score;});
  return scored.slice(0,topK).filter(function(x){return x.score>0;}).map(function(x){return x.chunk;});
}

/* ── 3. 结构化 Answer 生成 ── */
function generateKBAnswer(query, chunks, city){
  if(!chunks||!chunks.length){
    return {
      html:'<p>暂未找到与「'+query+'」直接相关的已知内容。建议补充政府工作报告或产业链图谱后重新提问，或切换到「研判需求」页生成完整报告。</p>',
      cites:[], followups:[]
    };
  }

  var isSZ=city&&city.indexOf('随州')>=0;
  var q=query;

  // ── intent 识别 ──
  var isGap=/缺口|缺什么|缺哪|补链|外购|外采|空白/.test(q);
  var isPark=/园区|承接|厂房|能耗|载体|开发区|高新区/.test(q);
  var isFirm=/链主|企业|采购|配套|哪些企业|供应商/.test(q);
  var isPol=/政策|资金|补贴|领导|规划|交办|支持/.test(q);
  var isComp=/竞争|对手|差异化|机会|优势|十堰|荆门|孝感/.test(q);
  var isRec=/建议|推荐|优先|应该怎么|怎么做|如何招/.test(q);

  // ── 构建回答段落 ──
  var paragraphs=[];
  var cites=[];

  // 主体：把检索到的 chunks 按 topic 分组
  var byTopic={};
  chunks.forEach(function(c){
    if(!byTopic[c.topic]) byTopic[c.topic]=[];
    byTopic[c.topic].push(c);
    if(cites.indexOf(c.cite)<0) cites.push(c.cite);
  });

  Object.keys(byTopic).forEach(function(topic){
    var items=byTopic[topic];
    var bullets=items.map(function(c){
      var isWarn=c.text.indexOf('⚠️')>=0||c.text.indexOf('待确认')>=0||c.text.indexOf('待领导')>=0;
      return '<li style="'+(isWarn?'color:#92400e':'color:#1a202c')+'">'+
        (isWarn?'<span style="color:#d97706;margin-right:4px">⚠</span>':
                '<span style="color:#22c55e;margin-right:4px">•</span>')+
        c.text.replace('⚠️ ','')+'</li>';
    }).join('');
    paragraphs.push(
      '<div style="margin-bottom:14px">'+
        '<div style="font-size:12px;font-weight:650;color:#6366f1;letter-spacing:.4px;margin-bottom:6px">'+topic.toUpperCase()+'</div>'+
        '<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px">'+bullets+'</ul>'+
      '</div>'
    );
  });

  // ── 结论段 ──
  var conclusion='';
  if(isGap&&isSZ){
    conclusion='<div style="background:#f0f9ff;border-left:3px solid #1a56db;padding:10px 14px;border-radius:0 8px 8px 0;margin-top:12px;font-size:12.5px;color:#1e3a5f;line-height:1.75">'+
      '<strong>补链优先级建议：</strong>①燃料电池电堆（整车成本53%，新楚风/程力有稳定采购需求）→②应急机器人/无人机系统（替代启灵/迅北斗外采依赖）→③香菇多糖/多肽提取（70万吨/年原料红利，就近落地降成本40%+）'+
    '</div>';
  } else if(isPark&&isSZ){
    conclusion='<div style="background:#f0fdf4;border-left:3px solid #22c55e;padding:10px 14px;border-radius:0 8px 8px 0;margin-top:12px;font-size:12.5px;color:#14532d;line-height:1.75">'+
      '<strong>承接建议：</strong>氢能专用车→专汽产业园/随州高新区；智慧应急→曾都经开区（安全应急示范基地）；香菇精深加工→随县香菇产业园（洁净厂房条件需向管委会确认）'+
    '</div>';
  } else if(isComp&&isSZ){
    conclusion='<div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:10px 14px;border-radius:0 8px 8px 0;margin-top:12px;font-size:12.5px;color:#78350f;line-height:1.75">'+
      '<strong>差异化窗口：</strong>锂电/新能源乘用车让给荆门/襄阳；氢能专用车（全国唯一已量产）+低空经济+应急软体新材料+香菇（全国唯一性）是随州真正的护城河。'+
    '</div>';
  } else if(isRec){
    conclusion='<div style="background:#f5f3ff;border-left:3px solid #6366f1;padding:10px 14px;border-radius:0 8px 8px 0;margin-top:12px;font-size:12.5px;color:#3730a3;line-height:1.75">'+
      '<strong>行动建议：</strong>将以上分析转化为正式招商需求，递交资源端核验企业可达性；同时向领导确认专项资金额度与首选承接园区，形成完整对接方案。'+
    '</div>';
  }
  if(conclusion) paragraphs.push(conclusion);

  // ── 追问建议 ──
  var followups=[];
  if(isSZ){
    if(!isGap) followups.push(city+'最值得优先补链的核心缺口是哪些？');
    if(!isPark) followups.push('各园区如何分工承接不同细分方向？');
    if(!isComp) followups.push('随州与十堰/荆门的竞争差异化空间在哪里？');
    if(!isFirm) followups.push('本地链主企业还缺哪些关键上游配套？');
  } else {
    followups=['最值得优先补链的核心缺口是哪些？','各园区如何分工承接不同细分产业？','本地链主企业还缺哪些关键上游配套？'];
  }
  followups=followups.slice(0,3);

  var body=paragraphs.join('');
  var warn='<div style="margin-top:10px;padding:8px 12px;background:#f9fafb;border-radius:8px;font-size:11px;color:#9aa5b5;line-height:1.6">⚠ 以上内容基于公开信息与慧小招2026-07实测数据；园区承载、企业采购规模与领导具体交办仍需政府授权材料确认</div>';

  return {html:body+warn, cites:cites, followups:followups};
}

/* ── 4. 打字机渲染 + 来源引用 + 追问按钮 ── */

/* ── KB RAG: 流式渲染 + 追问按钮 ── */
var KB_API = ((location.origin && location.origin.indexOf('http')===0) ? location.origin : 'http://localhost:5050')+'/api/kb-chat';

function kbAnswerRender(container, query, chunks, city){
  // 1. 思考气泡
  var thinking = document.createElement('div');
  thinking.className = 'message';
  thinking.innerHTML = '<img src="'+aiAvatar()+'">'+
    '<div class="message-bubble" style="display:flex;align-items:center;gap:8px;color:#9aa5b5;font-size:13px">'+
    '<span class="kb-thinking-dot"></span>正在调用 AI 分析…</div>';
  container.appendChild(thinking);
  container.scrollTop = container.scrollHeight;

  // 2. 创建回答气泡（流式填充）
  var ansNode = document.createElement('div');
  ansNode.className = 'message';
  ansNode.style.display = 'none';
  var bodyDiv = document.createElement('div');
  bodyDiv.className = 'kb-stream-body';
  ansNode.innerHTML = '<img src="'+aiAvatar()+'">';
  var bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.appendChild(bodyDiv);
  ansNode.appendChild(bubble);
  container.appendChild(ansNode);

  var accText = '';
  var t0 = Date.now();

  function renderMarkdown(md){
    // 简单 markdown: **bold**, - list, \n段落
    return md
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/⚠️/g,'<span style="color:#d97706">⚠️</span>')
      .replace(/^[-•]\s(.+)$/gm,'<li style="margin:4px 0;padding-left:4px">$1</li>')
      .replace(/(<li[\s\S]*?<\/li>)+/g,'<ul style="margin:6px 0;padding:0 0 0 18px;list-style:disc">$&</ul>')
      .replace(/\n{2,}/g,'</p><p style="margin:8px 0">')
      .replace(/\n/g,'<br>');
  }

  fetch(KB_API, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({question:query, chunks:chunks, city:city, stream:true})
  }).then(function(resp){
    thinking.remove();
    ansNode.style.display = '';

    if(!resp.ok){
      return resp.json().then(function(e){
        bodyDiv.innerHTML = '<span style="color:#ef4444">服务错误：'+(e.error||resp.status)+'</span>';
      });
    }

    var reader = resp.body.getReader();
    var decoder = new TextDecoder();
    var buf = '';

    function pump(){
      reader.read().then(function(d){
        if(d.done){
          // 完成：追加来源 + 追问
          var elapsed = Date.now()-t0;
          var cites = [...new Set(chunks.map(function(c){return c.cite;}).filter(Boolean))];
          var citeTags = cites.map(function(c){
            return '<span style="display:inline-block;padding:2px 8px;background:#f0f4ff;color:#1a56db;border-radius:12px;font-size:11px;margin:2px 3px">📌 '+c+'</span>';
          }).join('');

          // 追问按钮
          var isSZ = city && city.indexOf('随州')>=0;
          var followups = isSZ
            ? ['随州各园区如何分工承接？','随州与十堰/荆门的差异化空间？','链主企业还缺哪些关键配套？']
            : ['最值得优先补链的核心环节？','各园区如何分工承接？','本地链主还缺哪些关键配套？'];
          var followHtml = '<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">'+
            followups.map(function(f){
              return '<button onclick="kbSendQuestion(this,\''+f.replace(/'/g,"\\'")+'\')" '+
                'style="padding:5px 11px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:20px;font-size:12px;color:#0b183b;cursor:pointer;transition:background .1s" '+
                'onmouseover="this.style.background=\'#eef2ff\'" onmouseout="this.style.background=\'#f5f7fb\'">'+f+'</button>';
            }).join('')+
          '</div>';

          var footer = (citeTags?'<div style="margin-top:8px">'+citeTags+'</div>':'')+
            '<div style="font-size:10.5px;color:#b0bac8;margin-top:6px">DeepSeek · 响应 '+elapsed+'ms · 检索 '+chunks.length+' 个数据块</div>'+
            followHtml+
            '<div style="margin-top:8px;padding:8px 10px;background:#f9fafb;border-radius:8px;font-size:11px;color:#9aa5b5;line-height:1.6">⚠ 以上内容基于公开信息与慧小招实测数据，园区承载、企业采购规模及领导具体交办仍需政府授权材料确认</div>';

          bubble.insertAdjacentHTML('beforeend', footer);
          container.scrollTop = container.scrollHeight;
          return;
        }

        buf += decoder.decode(d.value, {stream:true});
        var lines2 = buf.split('\n');
        buf = lines2.pop(); // 保留不完整行

        lines2.forEach(function(line){
          if(!line.startsWith('data:')) return;
          var data = line.slice(5).trim();
          if(data === '[DONE]') return;
          try{
            var j = JSON.parse(data);
            var delta = (j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content)||'';
            if(delta){
              accText += delta;
              bodyDiv.innerHTML = '<p style="margin:0;line-height:1.75">'+renderMarkdown(accText)+'</p>';
              container.scrollTop = container.scrollHeight;
            }
          }catch(e){}
        });
        pump();
      });
    }
    pump();

  }).catch(function(err){
    thinking.remove();
    ansNode.style.display = '';
    bodyDiv.innerHTML = '<span style="color:#ef4444">连接失败：'+err.message+
      '<br><small style="color:#9aa5b5">请确认 kb-server 已在 localhost:5050 运行</small></span>';
  });
}

function kbSendQuestion(btn, q){
  if(btn){btn.style.opacity='0.5';btn.disabled=true;}
  var c=document.getElementById('kbConv')||document.getElementById('conv');
  if(!c)return;
  var ud=document.createElement('div');
  ud.className='message is-user';
  ud.innerHTML='<div class="message-bubble"><p>'+q+'</p></div>';
  c.appendChild(ud); c.scrollTop=c.scrollHeight;
  kbRAGQuery(q, c);
}

function kbRAGQueryWithHint(query, container, kbTopic){
  var p=P(); if(!p) return;
  var corpus=buildKBCorpus(p.city);
  var chunks=kbSearch(query,corpus,4);
  if(kbTopic&&kbTopic.known){
    var pinned=kbTopic.known.map(function(t,i){
      return {id:'pin:'+i,topic:kbTopic.t,tags:topicTags(kbTopic.t),text:t,cite:kbTopic.t+'(置顶)'};
    });
    var seen=chunks.map(function(c){return c.text;});
    pinned.forEach(function(pc){if(seen.indexOf(pc.text)<0)chunks.unshift(pc);});
    chunks=chunks.slice(0,7);
  }
  kbAnswerRender(container,query,chunks,p.city);
}

function kbRAGQuery(query, container){
  var p=P(); if(!p) return;
  var corpus=buildKBCorpus(p.city);
  var chunks=kbSearch(query, corpus, 5);
  kbAnswerRender(container, query, chunks, p.city);
}


/* ══ RAG ENGINE END ══ */

function kbAsk(q,k){
  var c=$('#kbConv');if(!c)return;
  c.insertAdjacentHTML('beforeend','<div class="message is-user" style="margin-top:14px"><div class="message-bubble"><p>'+q+'</p></div></div>');
  c.scrollTop=c.scrollHeight;
  var p0=P();
  var bullet0=k.known.map(function(x){return '<li style="margin-bottom:5px">'+x+'</li>';}).join('');
  var intro0='结合'+p0.city+'「'+k.t+'」当前已知情况：<ul style="margin:8px 0 8px 18px;padding:0;line-height:1.7">'+bullet0+'</ul>';
  var tip0=(k.t.indexOf('产业')>-1||k.t.indexOf('主导')>-1)?
    '<p style="margin-top:5px">本地配套率不足与核心系统外购是当前最大补链切入点，建议优先针对这些缺口方向招引。</p>':
    (k.t.indexOf('园区')>-1)?
    '<p style="margin-top:5px">具体厂房面积、能耗指标与用地条件仍以政府授权材料为准，以上为初步研判。</p>':
    (k.t.indexOf('链主')>-1||k.t.indexOf('企业')>-1)?
    '<p style="margin-top:5px">骨干企业采购规模与技术路线需进一步核实；以上为公开信息初步归类。</p>':
    '<p style="margin-top:5px">方向性政策表述已识别，具体交办口径需补充领导最新发言后确认。</p>';
  var ans=intro0+tip0;
  var srcs=k.calls.map(function(s){return '<span>'+s+'</span>'}).join('');
  setTimeout(function(){
    c.insertAdjacentHTML('beforeend','<div class="message" style="margin-top:14px"><img src="'+aiAvatar()+'"><div class="message-bubble"><p>'+ans+'</p>'+
      '<div class="answer-sources"><em>本次回答调用（可追溯）：</em>'+srcs+'</div>'+
      '<div class="answer-note">⚠ 公开信息仅用于辅助研判；园区承载、企业采购和领导任务仍需政府授权材料确认。</div></div></div>');
    c.scrollTop=c.scrollHeight;
  },400);
}

/* ── 领导确认/修改 known 条目 ── */
function confirmKbItem(kbIdx,itemIdx){
  var p=P();if(!p)return;
  if(!KB_CONFIRMS[cur])KB_CONFIRMS[cur]={};
  if(!KB_CONFIRMS[cur][kbIdx])KB_CONFIRMS[cur][kbIdx]={};
  var k=p.kb[kbIdx];if(!k)return;
  var orig=k.known[itemIdx]||'';
  var clean=orig.replace('\u26a0\ufe0f ','');
  // 写回 known：去掉 ⚠️，前缀改为 ✅
  k.known[itemIdx]='\u2705 '+clean;
  KB_CONFIRMS[cur][kbIdx][itemIdx]={status:'confirmed',text:clean,ts:Date.now()};
  persist();
  // 刷新 corpus（确认项从待核实变为已确认）
  if(KB_FILE_CHUNKS[cur]){
    KB_FILE_CHUNKS[cur]=KB_FILE_CHUNKS[cur].filter(function(c){return c.id!=='pin:'+kbIdx+':'+itemIdx;});
  }
  // 重新渲染 modal
  kbDetail(kbIdx);
  toast('已确认：'+clean.slice(0,20)+'…');
}


/* 编辑框附件上传：读取文本内容填充 textarea */
function editPickFile(kbIdx,itemIdx){
  var inp=document.createElement('input');
  inp.type='file'; inp.multiple=true;
  inp.accept='.txt,.md,.csv,.pdf,.doc,.docx,.xls,.xlsx';
  inp.onchange=function(){
    var files=Array.from(inp.files||[]);
    if(!files.length)return;
    processEditFiles(files,kbIdx,itemIdx);
  };
  inp.click();
}

function editDropFile(e,kbIdx,itemIdx){
  e.preventDefault();
  var files=Array.from(e.dataTransfer&&e.dataTransfer.files||[]);
  if(!files.length)return;
  processEditFiles(files,kbIdx,itemIdx);
}

function processEditFiles(files,kbIdx,itemIdx){
  var hint=document.getElementById('kb-file-hint-'+kbIdx+'-'+itemIdx);
  var ta=document.getElementById('kb-edit-'+kbIdx+'-'+itemIdx);
  // 先触发全局 ingestFiles（更新 corpus）
  ingestFiles(files, kbIdx);
  // 然后读取文本文件内容追加到 textarea
  var textFiles=files.filter(function(f){return /\.(txt|md|csv|json)$/i.test(f.name);});
  var binary=files.filter(function(f){return !/\.(txt|md|csv|json)$/i.test(f.name);});
  // 更新 hint 文本
  if(hint)hint.textContent='✅ 已上传 '+files.length+' 个文件：'+files.map(function(f){return f.name;}).join('、');
  // binary 文件只记录名称到 textarea
  if(binary.length&&ta){
    ta.value+=(ta.value?'\n':'')+'[已上传文件：'+binary.map(function(f){return f.name;}).join('、')+'，内容已加入知识库]';
  }
  if(!textFiles.length)return;
  // 读取纯文本文件，提取摘要追加到 textarea
  var done=0;
  textFiles.forEach(function(f){
    var reader=new FileReader();
    reader.onload=function(e){
      var text=(e.target.result||'').trim();
      // 取前 500 字作为摘要
      var summary=text.slice(0,500).replace(/\n+/g,' ').trim();
      if(ta&&summary){
        ta.value+=(ta.value?'\n':'')+'['+f.name+'] '+summary;
      }
      done++;
      if(done===textFiles.length&&ta){
        ta.focus();
        ta.setSelectionRange(ta.value.length,ta.value.length);
      }
    };
    reader.readAsText(f,'utf-8');
  });
}

function editKbItem(kbIdx,itemIdx){
  // 把对应条目替换为 inline 编辑框
  var cardId='kb-card-'+kbIdx+'-'+itemIdx;
  var card=document.getElementById(cardId);
  if(!card)return;
  var p=P();if(!p)return;
  var k=p.kb[kbIdx];if(!k)return;
  var orig=(k.known[itemIdx]||'').replace('\u26a0\ufe0f ','').replace('\u2705 ','');
  if(_isKbPlaceholder(orig)) orig='';   // 占位符不回填进输入框，避免被原样保存成条目
  card.innerHTML=
    '<div style="padding:10px 13px">'+
      '<div style="font-size:11px;color:#6366f1;font-weight:650;margin-bottom:6px">修改内容（领导确认后写入知识库）</div>'+
      '<textarea id="kb-edit-'+kbIdx+'-'+itemIdx+'" '+
        'style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #6366f1;border-radius:8px;font-size:13px;line-height:1.6;color:#1e293b;resize:vertical;min-height:72px;outline:none" '+
        'onkeydown="if(event.key===\'Enter\'&&event.metaKey)saveKbEdit('+kbIdx+','+itemIdx+')">'+orig+'</textarea>'+
      '<div style="margin:8px 0 0;padding:8px 10px;background:#f8faff;border:1.5px dashed #c7d2fe;border-radius:8px;cursor:pointer;text-align:center;font-size:12px;color:#4f46e5" '+
        'onclick="editPickFile('+kbIdx+','+itemIdx+')" '+
        'ondragover="event.preventDefault();this.style.background=\'#eef2ff\'" '+
        'ondragleave="this.style.background=\'#f8faff\'" '+
        'ondrop="editDropFile(event,'+kbIdx+','+itemIdx+')">'+
        '<span id="kb-file-hint-'+kbIdx+'-'+itemIdx+'">📎 上传附件辅助修改（PDF/Word/TXT · 拖拽或点击）</span>'+
      '</div>'+
      '<div style="display:flex;gap:8px;margin-top:8px">'+
        '<button onclick="saveKbEdit('+kbIdx+','+itemIdx+')" '+
          'style="flex:1;padding:8px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer">'+
          '\u2713 保存修改</button>'+
        '<button onclick="pickLocalFile('+kbIdx+')" '+
          'style="padding:8px 12px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;font-size:12.5px;color:#166534;cursor:pointer;font-weight:600">'+
          '📎 更多文件</button>'+
        '<button onclick="cancelKbEdit('+kbIdx+','+itemIdx+')" '+
          'style="padding:8px 12px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:8px;font-size:12.5px;color:#4a5568;cursor:pointer">取消</button>'+
      '</div>'+
    '</div>';
  card.style.border='1.5px solid #6366f1';
  card.style.background='#faf5ff';
  var ta=document.getElementById('kb-edit-'+kbIdx+'-'+itemIdx);
  if(ta){ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);}
}

function saveKbEdit(kbIdx,itemIdx){
  var ta=document.getElementById('kb-edit-'+kbIdx+'-'+itemIdx);
  if(!ta)return;
  var newText=ta.value.trim();
  if(!newText){toast('内容不能为空');return;}
  var p=P();if(!p)return;
  var k=p.kb[kbIdx];if(!k)return;
  // 写回 known，添加 ✅ 已确认标记
  k.known[itemIdx]='\u2705 '+newText;
  if(!KB_CONFIRMS[cur])KB_CONFIRMS[cur]={};
  if(!KB_CONFIRMS[cur][kbIdx])KB_CONFIRMS[cur][kbIdx]={};
  KB_CONFIRMS[cur][kbIdx][itemIdx]={status:'edited',text:newText,ts:Date.now()};
  persist();
  buildKBCorpus(p.city);
  kbDetail(kbIdx);
  toast('\u2705 已更新并写入知识库');
}

/* 【2026-09-23 修复】占位条目残留：原来 addKbItem 先把占位符 push 进 kb.known
   再弹编辑框，用户点「取消」或关掉弹窗后，占位符就永久留在数据里。
   政府端 13 处显示路径都用 _isJunkKbItem 过滤掉它，干部看不见；
   但 kbReadiness 计分会把它算进待确认分母且永远无法确认——
   实测随州 4 个项目各残留 6 条，确认率被从 100% 压到 60%、就绪分 100→92。
   计分侧已在 index.html 同步过滤；这里堵住产生源：取消编辑时清掉空占位。 */
var KB_ITEM_PLACEHOLDER='\u26a0\ufe0f 请在此输入补充内容（保存后写入知识库）';
function _isKbPlaceholder(t){
  return /请在此输入|保存后写入|请输入补充/.test(String(t||''));
}
/* 取消新增：仅当该条目仍是未填写的占位符时才移除，绝不碰已有真实内容 */
function cancelKbEdit(kbIdx,itemIdx){
  var p=P(), k=p&&p.kb&&p.kb[kbIdx];
  if(k && k.known && itemIdx>=0 && itemIdx<k.known.length && _isKbPlaceholder(k.known[itemIdx])){
    k.known.splice(itemIdx,1);
    persist();
  }
  kbDetail(kbIdx);
}
function addKbItem(kbIdx){
  // 领导手动新增一条 known 条目
  var p=P();if(!p)return;
  var k=p.kb[kbIdx];if(!k)return;
  k.known.push(KB_ITEM_PLACEHOLDER);
  kbDetail(kbIdx);
  // 自动触发最后一条的编辑
  setTimeout(function(){editKbItem(kbIdx,k.known.length-1);},50);
}

function kbDetail(i){
  var k=P().kb[i]; if(!k) return;
  curKb=i;

  // 已知条目列表
  var knownHtml=(k.known&&k.known.length)
    ? '<div style="display:flex;flex-direction:column;gap:8px">'+
        k.known.map(function(x,xi){
          var warn=x.indexOf('⚠️')>=0;
          var isFile=x.indexOf('📎')===0;
          var clean=x.replace('⚠️ ','');
          var badges=[];
          clean.replace(/(\d+[\d,.]*)(亿元|亿|万辆|万吨|万m³|万㎡|GWh|%)/g,function(m){badges.push(m);return m;});
          var badgeHtml=badges.length
            ?'<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:7px">'+
               badges.map(function(b){
                 return '<span style="padding:2px 8px;background:#dbeafe;color:#1e40af;border-radius:6px;font-size:11.5px;font-weight:700;letter-spacing:.3px">'+b+'</span>';
               }).join('')+'</div>':'';
          var accent=warn?'#f59e0b':isFile?'#22c55e':xi===0?'#6366f1':'#94a3b8';
          var bg=warn?'#fffbeb':isFile?'#f0fdf4':'#f8faff';
          var bd=warn?'#fde68a':isFile?'#bbf7d0':'#e8edf5';
          var icon=warn?'⚠':isFile?'📎':xi===0?'★':'•';
          var txtColor=warn?'#78350f':isFile?'#14532d':'#1e293b';
          // 检查是否已确认
          var confirmed=KB_CONFIRMS[cur]&&KB_CONFIRMS[cur][i]&&KB_CONFIRMS[cur][i][xi];
          var isConfirmed=!!confirmed;
          // 已确认条目：绿色样式
          if(isConfirmed){
            bg='#f0fdf4';bd='#86efac';accent='#22c55e';icon='\u2705';txtColor='#14532d';
          }
          // ⚠️ 条目的操作按钮
          var actionBtns='';
          if(warn&&!isConfirmed){
            actionBtns='<div style="display:flex;gap:6px;margin-top:8px">'+
              '<button onclick="confirmKbItem('+i+','+xi+')" '+
                'style="flex:1;padding:6px 0;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;font-size:12px;color:#166534;cursor:pointer;font-weight:600" '+
                'onmouseover="this.style.background=\'#dcfce7\'" onmouseout="this.style.background=\'#f0fdf4\'">'+
                '\u2713 领导确认'+
              '</button>'+
              '<button onclick="editKbItem('+i+','+xi+')" '+
                'style="flex:1;padding:6px 0;background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:8px;font-size:12px;color:#6d28d9;cursor:pointer;font-weight:600" '+
                'onmouseover="this.style.background=\'#ede9fe\'" onmouseout="this.style.background=\'#f5f3ff\'">'+
                '\u270e 修改内容'+
              '</button>'+
            '</div>';
          } else if(isConfirmed){
            actionBtns='<div style="margin-top:6px;font-size:11px;color:#22c55e;display:flex;align-items:center;gap:4px">'+
              '<span>\u2713 已由领导确认</span>'+
              '<button onclick="editKbItem('+i+','+xi+')" style="background:none;border:none;color:#94a3b8;font-size:11px;cursor:pointer;margin-left:6px">修改</button>'+
            '</div>';
          }
          return '<div id="kb-card-'+i+'-'+xi+'" style="border-radius:12px;background:'+bg+';border:1.5px solid '+bd+';overflow:hidden;transition:border-color .15s">'+
            '<div style="display:flex">'+
              '<div style="width:4px;background:'+accent+';flex-shrink:0"></div>'+
              '<div style="padding:10px 13px;flex:1">'+
                '<div style="display:flex;gap:8px;align-items:flex-start">'+
                  '<span style="font-size:12px;flex-shrink:0;margin-top:2px;color:'+accent+'">'+icon+'</span>'+
                  '<div style="flex:1">'+
                    '<span style="font-size:13px;color:'+txtColor+';line-height:1.7">'+highlightKeyData(clean)+'</span>'+
                    badgeHtml+
                    actionBtns+
                  '</div>'+
                '</div>'+
              '</div>'+
            '</div>'+
          '</div>';
        }).join('')+
      '</div>'
    : '<div style="color:#9aa5b5;font-size:13px;padding:12px 0">暂无已知内容，点击下方按钮基于此主题提问。</div>';

  // 数据来源标签
  var callsHtml=(k.calls&&k.calls.length)
    ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">'+
        k.calls.map(function(c){
          return '<span style="padding:3px 10px;background:#f0f4ff;color:#1a56db;border-radius:12px;font-size:11.5px">'+c+'</span>';
        }).join('')+'</div>'
    : '';

  var modalHtml=
    '<div id="kbDetailModal" onclick="if(event.target.id===\'kbDetailModal\')closeKbDetail()" '+
      'style="position:fixed;inset:0;background:rgba(11,24,59,.4);z-index:8888;display:flex;align-items:flex-start;justify-content:flex-end;padding:16px;backdrop-filter:blur(2px)">'+
      '<div style="background:#fff;border-radius:18px;width:420px;max-width:95vw;max-height:calc(100vh - 32px);overflow:hidden;display:flex;flex-direction:column;box-shadow:0 8px 48px rgba(11,24,59,.16);animation:slideIn .22s ease">'+

        // 顶栏
        '<div style="padding:20px 22px 16px;border-bottom:1px solid #f0f4ff;flex:0 0 auto">'+
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">'+
            '<span style="font-size:11px;font-weight:650;color:#6366f1;letter-spacing:.5px">KNOWLEDGE SCOPE</span>'+
            '<button onclick="closeKbDetail()" style="background:none;border:none;font-size:18px;color:#9aa5b5;cursor:pointer;padding:2px 6px;border-radius:6px" onmouseover="this.style.background=\'#f5f7fb\'" onmouseout="this.style.background=\'none\'">✕</button>'+
          '</div>'+
          '<h2 style="font-size:17px;font-weight:750;color:#0b183b;margin:0 0 4px">'+k.icon+' '+k.t+'</h2>'+
          '<p style="font-size:12.5px;color:#8492a6;margin:0">'+k.sub+'</p>'+
        '</div>'+

        // 内容区（可滚动）
        '<div style="flex:1;overflow-y:auto;padding:18px 22px">'+

          '<div style="margin-bottom:18px">'+
            '<h3 style="font-size:12px;font-weight:650;color:#4a5568;letter-spacing:.3px;margin:0 0 10px">当前已知'+
              '<span style="font-weight:400;color:#b0bac8;margin-left:6px">⚠ 标注项需政府确认</span>'+
            '</h3>'+
            knownHtml+
          '</div>'+

          (callsHtml?
          '<div style="margin-bottom:16px">'+
            '<h3 style="font-size:12px;font-weight:650;color:#4a5568;letter-spacing:.3px;margin:0 0 8px">本次回答可调用来源</h3>'+
            callsHtml+
          '</div>':'')+

          '<div style="padding:10px 12px;background:#f8faff;border-radius:10px;font-size:11.5px;color:#9aa5b5;line-height:1.6">'+
            '公开信息仅用于辅助研判；园区承载、企业采购和领导任务仍需政府授权材料确认。'+
          '</div>'+
        '</div>'+

        // 确认进度条
        +(function(){
          var warns=k.known.filter(function(x){return x.indexOf('\u26a0\ufe0f')>=0;});
          var total=warns.length;
          var done=(KB_CONFIRMS[cur]&&KB_CONFIRMS[cur][i])?Object.keys(KB_CONFIRMS[cur][i]).length:0;
          if(!total)return '';
          return '<div style="padding:0 22px 12px">'+
            '<div style="display:flex;justify-content:space-between;font-size:11px;color:#9aa5b5;margin-bottom:5px">'+
              '<span>领导确认进度</span><span>'+done+' / '+total+'</span>'+
            '</div>'+
            '<div style="height:5px;background:#f0f4ff;border-radius:3px;overflow:hidden">'+
              '<div style="height:100%;width:'+(total?Math.round(done/total*100):0)+'%;background:linear-gradient(90deg,#22c55e,#16a34a);border-radius:3px;transition:width .4s"></div>'+
            '</div></div>';
        })()+
        '<div style="padding:14px 22px 18px;border-top:1px solid #f0f4ff;flex:0 0 auto;display:flex;flex-wrap:wrap;gap:8px">'+
          '<button onclick="closeKbDetail();askAboutKb('+i+')" style="flex:1;min-width:120px;padding:11px;background:linear-gradient(135deg,#1a56db,#6366f1);color:#fff;border:none;border-radius:10px;font-size:13.5px;font-weight:600;cursor:pointer">'+
            '基于此主题提问 →'+
          '</button>'+
          '<button onclick="addKbItem('+i+')" style="padding:11px 13px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;font-size:13px;color:#166534;cursor:pointer;font-weight:600">'+
            '+ 补充结论'+
          '</button>'+
          '<button onclick="pickLocalFile('+i+')" style="padding:11px 13px;background:#f5f7fb;border:1.5px solid #e8edf5;border-radius:10px;font-size:13px;color:#4a5568;cursor:pointer">'+
            '📎 上传材料'+
          '</button>'+
        '</div>'+
      '</div>'+
    '</div>';
    '</div>';

  // 注入 slideIn keyframe（只注一次）
  if(!document.getElementById('kbDetailStyle')){
    var st=document.createElement('style');st.id='kbDetailStyle';
    st.textContent='@keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}';
    document.head.appendChild(st);
  }

  closeKbDetail(); // 清掉旧的
  var wrap=document.createElement('div');
  wrap.innerHTML=modalHtml;
  document.body.appendChild(wrap.firstChild);
}

function closeKbDetail(){
  var m=document.getElementById('kbDetailModal');
  if(m)m.remove();
}

function setKbActiveTopic(idx,k,conv){
  var rows=document.querySelectorAll('.topic-row');
  rows.forEach(function(r,ri){
    r.style.boxShadow=ri===idx?'0 0 0 2.5px #1a56db,0 4px 18px rgba(26,86,219,.15)':'';
    r.style.borderColor=ri===idx?'#1a56db':'';
    r.style.background=ri===idx?'#f0f4ff':'';
  });
  var old=document.getElementById('kbTopicBadge');if(old)old.remove();
  var CM={'主导产业与产业链':{bg:'#eff6ff',br:'#bfdbfe',tx:'#1d4ed8',dt:'#3b82f6'},
    '园区与承载条件':{bg:'#f0fdf4',br:'#bbf7d0',tx:'#166534',dt:'#22c55e'},
    '链主与存量企业':{bg:'#fdf4ff',br:'#e9d5ff',tx:'#6b21a8',dt:'#a855f7'},
    '政策、规划与领导关注':{bg:'#fffbeb',br:'#fde68a',tx:'#92400e',dt:'#f59e0b'}};
  var c=CM[k.t]||{bg:'#f5f7fb',br:'#e8edf5',tx:'#4a5568',dt:'#9aa5b5'};
  var badge=document.createElement('div');badge.id='kbTopicBadge';
  badge.style.cssText='margin:0 0 12px;padding:10px 14px;background:'+c.bg+';border:1.5px solid '+c.br+';border-radius:12px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10';
  badge.innerHTML='<span style="width:8px;height:8px;border-radius:50%;background:'+c.dt+';flex:0 0 auto"></span>'
    +'<div style="flex:1"><div style="font-size:11px;font-weight:650;color:'+c.tx+';letter-spacing:.4px">当前提问主题</div>'
    +'<div style="font-size:13px;font-weight:700;color:'+c.tx+'">'+k.icon+' '+k.t+'</div></div>'
    +'<button onclick="clearKbActiveTopic()" style="background:none;border:none;color:'+c.tx+';opacity:.5;cursor:pointer;font-size:15px;padding:2px 6px">✕</button>';
  if(conv){conv.insertBefore(badge,conv.children[1]||null);}
  setTimeout(renderComposer,0);
}
function clearKbActiveTopic(){
  document.querySelectorAll('.topic-row').forEach(function(r){
    r.style.boxShadow='';r.style.borderColor='';r.style.background='';
  });
  var b=document.getElementById('kbTopicBadge');if(b)b.remove();
  renderComposer();
}

// 「基于这个主题提问」→ 在城市智库对话区直接问答（回复对应 + 底部调用来源）
function askAboutKb(i){
  var k=P().kb[i]; if(!k) return;
  var qMap={
    '主导产业与产业链':P().city+'主导产业链上最值得优先补链的核心缺口是哪些？结合配套率和链主外采情况分析。',
    '园区与承载条件':P().city+'各园区如何分工承接不同细分产业？厂房、能耗与用地条件是否满足？',
    '链主与存量企业':P().city+'本地链主企业的外采依赖集中在哪些核心环节？招引上游配套的优先级如何？',
    '政策、规划与领导关注':P().city+'在「'+P().topic+'」方向，政策支持最强、待干部确认的关键事项有哪些？'
  };
  var q=qMap[k.t]||('请结合「'+k.t+'」主题数据，分析'+P().city+'的现状与最值得优先推进的招引方向。');
  closeKbDetail();
  if(view!=='knowledge'){view='knowledge';render();}
  var c=document.getElementById('kbConv');
  if(!c){setTimeout(function(){askAboutKb(i);},100);return;}
  var ud=document.createElement('div');ud.className='message is-user';
  ud.innerHTML='<div class="message-bubble"><p>'+q+'</p></div>';
  c.appendChild(ud);c.scrollTop=c.scrollHeight;
  setKbActiveTopic(i,k,c);
  kbRAGQueryWithHint(q,c,k);
}
// 真实文件选择器：弹系统文件夹
function pickLocalFile(kbTopicIdx){
  var inp=document.createElement('input');
  inp.type='file';inp.multiple=true;
  inp.accept='.txt,.md,.csv,.pdf,.doc,.docx,.xls,.xlsx';
  inp.onchange=function(){
    var files=Array.from(inp.files||[]);
    if(!files.length)return;
    closeKbDetail();
    ingestFiles(files,kbTopicIdx);
  };
  inp.click();
}

/* ── 文件摄取：读取 → 切 chunk → 存 KB_FILE_CHUNKS → 更新 kb.known ── */
function ingestFiles(files, kbTopicIdx){
  var p=P(); if(!p) return;
  var total=files.length, done=0, allChunks=[];

  var c=document.getElementById('kbConv');
  if(c){
    var nd=document.createElement('div'); nd.className='message is-user';
    nd.innerHTML='<div class="message-bubble"><p>📎 已上传 '+total+' 个文件：'+
      files.map(function(f){return f.name;}).join('、')+'</p></div>';
    c.appendChild(nd); c.scrollTop=c.scrollHeight;
  }

  files.forEach(function(file){
    var canRead=/\.(txt|md|csv|json)$/i.test(file.name);
    var isPDF=/\.pdf$/i.test(file.name);
    if(canRead){
      var reader=new FileReader();
      reader.onload=function(e){
        var chunks=textToChunks(e.target.result||'', file.name, p, kbTopicIdx);
        allChunks=allChunks.concat(chunks);
        done++; if(done===total) finalizeIngest(allChunks,files,kbTopicIdx,p);
      };
      reader.onerror=function(){ done++; if(done===total) finalizeIngest(allChunks,files,kbTopicIdx,p); };
      reader.readAsText(file,'utf-8');
    } else if(isPDF && typeof pdfjsLib!=='undefined'){
      var reader2=new FileReader();
      reader2.onload=function(e){
        var typedArr=new Uint8Array(e.target.result);
        pdfjsLib.getDocument({data:typedArr}).promise.then(function(pdf){
          var pages=[]; var numPages=pdf.numPages;
          var pDone=0;
          for(var pi=1;pi<=numPages;pi++){
            (function(pageNum){
              pdf.getPage(pageNum).then(function(page){
                page.getTextContent().then(function(tc){
                  pages[pageNum-1]=tc.items.map(function(it){return it.str;}).join(' ');
                  pDone++;
                  if(pDone===numPages){
                    var fullText=pages.join('\n\n');
                    var chunks=textToChunks(fullText, file.name, p, kbTopicIdx);
                    allChunks=allChunks.concat(chunks);
                    done++; if(done===total) finalizeIngest(allChunks,files,kbTopicIdx,p);
                  }
                });
              });
            })(pi);
          }
        }).catch(function(){
          allChunks.push({id:'file:'+file.name+':0',topic:kbTopicIdx!=null&&p.kb[kbTopicIdx]?p.kb[kbTopicIdx].t:'上传材料',tags:['上传','材料'],text:'用户已上传文件「'+file.name+'」('+Math.round(file.size/1024)+'KB)，PDF解析失败，该文件包含与'+p.city+'招商研判相关的材料。',cite:file.name});
          done++; if(done===total) finalizeIngest(allChunks,files,kbTopicIdx,p);
        });
      };
      reader2.onerror=function(){ done++; if(done===total) finalizeIngest(allChunks,files,kbTopicIdx,p); };
      reader2.readAsArrayBuffer(file);
    } else {
      allChunks.push({
        id:'file:'+file.name+':0',
        topic: kbTopicIdx!=null&&p.kb[kbTopicIdx] ? p.kb[kbTopicIdx].t : '上传材料',
        tags:['上传','材料'],
        text:'用户已上传文件「'+file.name+'」('+Math.round(file.size/1024)+'KB)，该文件包含与'+p.city+'招商研判相关的材料。',
        cite:file.name
      });
      done++; if(done===total) finalizeIngest(allChunks,files,kbTopicIdx,p);
    }
  });
}

/* 文本切 chunk — 按段落，每块约150字 */
function textToChunks(text, fname, p, kbTopicIdx){
  var topic=kbTopicIdx!=null&&p&&p.kb[kbTopicIdx] ? p.kb[kbTopicIdx].t : '上传材料';
  text=text.replace(/\r\n/g,'\n').trim();
  var paras=text.split(/\n{2,}/), chunks=[], buf='', ci=0;
  paras.forEach(function(para){
    para=para.trim(); if(!para) return;
    buf+=(buf?' ':'')+para;
    if(buf.length>=120){
      chunks.push({id:'file:'+fname+':'+ci, topic:topic,
        tags:topicTags(topic).concat([fname.replace(/\.[^.]+$/,''),'上传']),
        text:buf.slice(0,300), cite:fname});
      buf=''; ci++;
    }
  });
  if(buf.trim()) chunks.push({id:'file:'+fname+':'+ci, topic:topic,
    tags:topicTags(topic).concat(['上传']), text:buf.slice(0,300), cite:fname});
  return chunks.slice(0,30);
}

/* 摄取完成 — 存 KB_FILE_CHUNKS，更新 kb.known，触发 RAG 摘要 */
function finalizeIngest(chunks, files, kbTopicIdx, p){
  if(!cur) return;
  if(!KB_FILE_CHUNKS[cur]) KB_FILE_CHUNKS[cur]=[];
  KB_FILE_CHUNKS[cur]=KB_FILE_CHUNKS[cur].concat(chunks);

  if(!UPLOADS[cur]) UPLOADS[cur]=[];
  files.forEach(function(f){
    var rec={name:f.name, size:f.size, ts:Date.now(),
      chunks:chunks.filter(function(c){return c.cite===f.name;}).length,
      kbIdx:kbTopicIdx};
    UPLOADS[cur].push(rec);
    // 关键修复：dataUrl 靠 FileReader 异步补写，之前 rec 先入库若在补写前 persist/刷新，
    // 同步到服务器的记录就没有 dataUrl → 管理端下载提示「该文件无原始数据」。
    // 改为读完(或失败)后都再 persist 一次，保证原始数据落库。
    (function(record, file){
      var fr=new FileReader();
      fr.onload=function(ev){ record.dataUrl=ev.target.result; persist(); };
      fr.onerror=function(){ persist(); };
      fr.readAsDataURL(file);
    })(rec, f);
  });

  if(kbTopicIdx!=null && p.kb && p.kb[kbTopicIdx]){
    var k=p.kb[kbTopicIdx];
    files.forEach(function(f){
      var entry='📎 '+f.name+' 已解析（'+chunks.filter(function(c){return c.cite===f.name;}).length+' 片段）';
      if(k.known.indexOf(entry)<0) k.known.push(entry);
    });
    k.tag='已补充材料';
    persist();
    // 更新卡片标签
    var rows=document.querySelectorAll('.topic-row');
    if(rows[kbTopicIdx]){
      var em=rows[kbTopicIdx].querySelector('em');
      if(em){em.textContent='已补充材料';em.style.color='#006d70';em.style.background='#e4f5f3';}
    }
  }

  var c=document.getElementById('kbConv'); if(!c) return;
  var totalChunks=KB_FILE_CHUNKS[cur].length;
  var topicLabel=kbTopicIdx!=null&&p.kb&&p.kb[kbTopicIdx] ? p.kb[kbTopicIdx].t : '城市智库';
  var nd=document.createElement('div'); nd.className='message';
  nd.innerHTML='<img src="'+aiAvatar()+'"><div class="message-bubble">'+
    '<p>✅ 已摄取 <strong>'+files.length+' 个文件</strong>，提取 <strong>'+chunks.length+' 个知识片段</strong>，追加至「'+topicLabel+'」。</p>'+
    '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">'+
    files.map(function(f){
      var n=chunks.filter(function(c){return c.cite===f.name;}).length;
      return '<span style="padding:3px 10px;background:#f0fdf4;color:#166534;border-radius:12px;font-size:11.5px;border:1px solid #bbf7d0">'+f.name+' · '+n+' 片段</span>';
    }).join('')+
    '</div><p style="margin-top:8px;font-size:12px;color:#8492a6">知识库现有 '+totalChunks+' 个片段，提问时自动检索最相关内容。</p>'+
    '</div>';
  c.appendChild(nd); c.scrollTop=c.scrollHeight;

  if(chunks.length>0){
    setTimeout(function(){
      var autoQ='根据刚才上传的材料，'+p.city+'在「'+topicLabel+'」方向有哪些关键发现？请补充分析。';
      var qd=document.createElement('div'); qd.className='message is-user';
      qd.innerHTML='<div class="message-bubble"><p>'+autoQ+'</p></div>';
      c.appendChild(qd); c.scrollTop=c.scrollHeight;
      var kHint=kbTopicIdx!=null&&p.kb ? p.kb[kbTopicIdx] : null;
      kbRAGQueryWithHint(autoQ, c, kHint);
    },800);
  }
}

function kbFileParsed(fname){
  var c=$('#kbConv');if(!c)return;
  c.insertAdjacentHTML('beforeend','<div class="message is-user" style="margin-top:14px"><div class="message-bubble"><p>[已上传本地材料] '+fname+'</p></div></div>');
  setTimeout(function(){
    c.insertAdjacentHTML('beforeend','<div class="message" style="margin-top:14px"><img src="'+aiAvatar()+'"><div class="message-bubble"><p>已解析 <b>'+fname+'</b> 并并入本地材料库。识别到与当前主题相关的要点，已更新到右侧「本次回答可调用」清单，可据此继续提问。</p><div class="answer-sources"><span>调用：'+fname+'</span></div></div></div>');
    c.scrollTop=c.scrollHeight;
  },400);
  toast('已解析并加入本地材料库');
}
function sendMsg(){var ta=$('#composerTa');if(!ta)return;var v=ta.value.trim();if(!v)return;
  // 城市智库页：留在本页作答（回复进 kbConv）
  if(view==='knowledge'){doSend(v);ta.value='';ta.style.height='auto';return;}
  // 项目工作区：留在本页，基于项目上下文作答（回复进 #conv）
  if(view==='subwork'){doSend(v);ta.value='';ta.style.height='auto';return;}
  // 其他非首页：切回当前研判再作答
  if(view!=='home'){view='home';render();setTimeout(function(){var t=$('#composerTa');if(t)t.value=v;doSend(v)},60);return;}
  doSend(v);ta.value='';}
function doSend(v){
  // 城市智库页：走 RAG 检索引擎
  if(view==='knowledge'){
    var _kbC=document.getElementById('kbConv');
    if(!_kbC)return;
    var _ud=document.createElement('div');
    _ud.className='message is-user';
    _ud.innerHTML='<div class="message-bubble"><p>'+v+'</p></div>';
    _kbC.appendChild(_ud);_kbC.scrollTop=_kbC.scrollHeight;
    kbRAGQuery(v,_kbC);return;
  }
  // 项目工作区：结合项目上下文自由问答，命中快捷意图则走 subReply
  if(view==='subwork'){
    addU(v);var pl2=$('.prompt-list');if(pl2)pl2.remove();
    var subs=subprojOf(cur);var s=subs[curSub];
    if(/方案|对接|起草|洽谈/.test(v)){setTimeout(function(){subReply('draft',s,P())},450);return;}
    if(/核验|核实|问题|尽调/.test(v)){setTimeout(function(){subReply('verify',s,P())},450);return;}
    if(/汇报|上报|领导|进展|总结/.test(v)){setTimeout(function(){subReply('report',s,P())},450);return;}
    if(/补充|拓展|还有|环节|上下游/.test(v)){setTimeout(function(){subReply('expand',s,P())},450);return;}
    setTimeout(function(){addA('<p>我已结合「'+(s?s.dir.split(' · ')[0]:'该项目')+'」的报告结论与候选线索理解你的需求。可让我起草对接方案、列核验清单、写领导汇报或补充招引环节——生成的是草稿，需你确认，系统不会自动联系企业。</p>')},450);
    return;
  }
  addU(v);var pl=$('.prompt-list');if(pl)pl.remove();
  var _p=P();var _kb=_p.kb||[];
  var _kbPark=_kb[1]||{};var _kbFirm=_kb[2]||{};var _kbPol=_kb[3]||{};var _kbInd=_kb[0]||{};
  var _clues=_p.clues||[];
  var reply;
  if(/园区|开发区|承接|厂房|能耗|载体/.test(v)){
    var _parkKnown=(_kbPark.known||[]).slice(0,2).join('；');
    reply='关于园区承载（'+_p.city+'）：'+(_parkKnown||'已整理主要载体，可按细分领域匹配承接区域')+      '。具体厂房面积、能耗指标与用地条件以政府授权材料为准。';
  }else if(/企业|链主|名单|采购|配套/.test(v)){
    var _firmKnown=(_kbFirm.known||[]).slice(0,2).join('；');
    reply='关于本地企业（'+_p.city+'）：'+(_firmKnown||'骨干企业已按产品方向归类，公开资料作初步依据')+      '。采购规模与技术路线仍需核实。';
  }else if(/政策|规划|领导|报告|交办/.test(v)){
    var _polKnown=(_kbPol.known||[]).slice(0,2).join('；');
    reply='关于政策与规划（'+_p.city+'）：'+(_polKnown||'已识别重点方向')+      '。领导最新产业发言尚未上传，建议补充后确认交办口径。';
  }else if(/缺口|补链|缺什么|缺哪/.test(v)){
    var _indKnown=(_kbInd.known||[]).slice(0,2).join('；');
    reply='关于'+_p.topic+'的链条缺口：'+(_indKnown||'核心系统外购比例高，本地配套率偏低')+      '。可直接生成完整报告查看具体分析。';
  }else if(/线索|候选|企业/.test(v)&&_clues.length){
    reply='当前研判方向「'+_p.topic+'」已识别 '+_clues.length+' 条候选线索：'+      _clues.slice(0,2).map(function(c){return c.name+'（'+c.dir+'）'}).join('、')+      '。可在「招商对接」模块查看核验要点，或在当前页生成完整报告。';
  }else{
    reply='我已结合'+_p.city+'城市智库（'+_p.topic+'方向）与最新公开信息研判。可以继续补充材料，也可以直接生成初步报告——报告将涵盖产业基础判断、链条缺口、建议招引方向与候选线索。';
  }
  setTimeout(function(){addA('<p>'+reply+'</p>')},400);}
function uploadHint(){
  var mats=[
    ['📄','政府工作报告','年度产业方向、重点任务与投资承诺（最能体现虚实）'],
    ['🎤','领导经济发言稿','领导近期关注的产业与交办事项'],
    ['📊','产业 / 园区报告','产业链现状、园区载体与承接条件'],
    ['🏢','园区资料','厂房、能耗、用地等承载条件明细'],
    ['📇','目标企业名单','已接触或拟核验的企业清单']
  ];
  var body='<p class="modal-intro">上传后我会结合城市智库与公开信息研判；材料仅用于本次分析，园区承载、企业采购和领导任务仍需政府授权材料确认。</p>'+
    '<ul class="material-guide">'+mats.map(function(m){return '<li><i class="i">'+m[0]+'</i><span><strong>'+m[1]+'</strong><small>'+m[2]+'</small></span></li>'}).join('')+'</ul>';
  var foot='<button class="secondary-button" onclick="closeModal()">取消</button><button class="primary-button" onclick="doUpload()">选择文件上传</button>';
  openModal('上传城市与产业材料',body,foot);
}
// 真实动作：弹系统文件夹选择文件，选完后在对话里出现「已上传文件 + 解析结果」
function doUpload(){
  closeModal();
  var inp=document.createElement('input');
  inp.type='file';inp.multiple=true;
  inp.accept='.pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.csv';
  inp.onchange=function(){
    var files=Array.from(inp.files||[]);
    if(!files.length)return;
    if(view!=='knowledge'){view='knowledge';render();}
    setTimeout(function(){ingestFiles(files,null);},100);
  };
  inp.click();
}
function uploadParsed(fname){
  if(view!=='home'){view='home';render();}
  setTimeout(function(){
    addU('[已上传] '+fname);
    var pl=$('.prompt-list');if(pl)pl.remove();
    var _up=P();var _upKb=_up.kb||[];var _upInd=_upKb[0]||{};var _upPol=_upKb[3]||{};
    var _real1=(_upInd.known||[])[0]||(_up.topic+'被列为主导产业，含具体产值与项目表述');
    var _virt1=(_upPol.known||[])[1]||'方向性政策表述，缺具体金额/地块/落地主体，需向领导确认';
    addA('<p>已收到 <b>'+fname+'</b>，完成解析。从材料中提取到与「'+_up.topic+'」研判相关的要点：</p>'+
      '<div class="report" style="margin-top:6px"><div class="rbody">'+
        '<div class="fold open"><div class="head"><span class="num">1</span><span class="concl">识别到重点产业表述 3 处</span><span class="badge real">实据</span></div>'+
          '<div class="detail">'+_real1+'，含具体数据，可作为研判依据。<div class="src">来源：'+fname+' · 第 8 页</div></div></div>'+
        '<div class="fold open"><div class="head"><span class="num">2</span><span class="concl">政策方向表述待核实落地细则</span><span class="badge virt">待核实</span></div>'+
          '<div class="detail">'+_virt1+'。<div class="src">来源：'+fname+' · 第 12 页</div></div></div>'+
      '</div></div>'+
      '<p style="margin-top:8px">材料已并入本次研判，可继续补充，或直接生成完整报告。</p>');
    if(P().stage<2)setStage(2);
    toast('材料已解析并加入本次研判');
  },200);
}
// 直接下载：生成一份详细的城市智库摘要文件并触发浏览器下载
function downloadSummary(){
  var p=P();var kb=p.kb;var now=new Date().toLocaleString('zh-CN');
  var L=[];
  L.push('慧小招 · '+p.city+'城市智库摘要');
  L.push('导出时间：'+now+'　|　数据更新至：7月20日 06:00');
  L.push('当前研判方向：'+p.topic);
  L.push('====================================================\n');
  kb.forEach(function(k,i){
    L.push((i+1)+'、'+k.t+'　（'+k.sub+'）');
    L.push('  当前已知：');
    k.known.forEach(function(x){L.push('    · '+x)});
    L.push('  可调用材料（可追溯）：'+k.calls.join('、'));
    L.push('');
  });
  L.push('----------------------------------------------------');
  L.push('可下载的原始材料清单：');
  ['重点园区清单.xlsx（随州高新区/曾都经开区/专汽产业园/随县香菇产业园载体明细）',
   '随州三大产业链图谱.pdf（氢能专用车/智慧应急/香菇深加工缺口分析）',
   '今日公开信息摘要（更新至 7月20日 06:00，含新楚风/程力/博利特/品源最新动态）',
   '2026年随州市政府工作报告（完整版）',
   '随州市领导近期产业发言（含氢能走廊/应急示范基地/香菇升级方向公开报道整理）'].forEach(function(x){L.push('  - '+x)});
  L.push('');
  L.push('====================================================');
  L.push('使用边界：公开信息仅用于辅助研判；园区承载、企业采购和领导任务仍需政府授权材料确认。');
  L.push('本文件由慧小招根据城市智库与公开信息自动汇总，仅供研判参考。');
  var blob=new Blob([L.join('\n')],{type:'text/plain;charset=utf-8'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=p.city+'城市智库摘要_'+p.topic+'.txt';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  toast('已下载：'+p.city+'城市智库摘要');
}
function newProjModal(){
  var body='<p class="modal-intro">围绕本市（'+P().city+'）新增一个产业方向的研判，将生成一条独立研判线（进度、报告、证据互不干扰）。</p>'+
    '<div class="form-stack">'+
    '<label>产业方向 / 关注环节<input placeholder="例如：新能源电池回收、智能网联零部件…"></label>'+
    '<label>当下任务（可选）<textarea placeholder="例如：领导交办、近期考察、拟对接的目标企业…"></textarea></label></div>';
  var foot='<button class="secondary-button" onclick="closeModal()">取消</button><button class="primary-button" onclick="doCreateProj()">创建研判</button>';
  openModal('新建产业研判',body,foot);
}
// 真实动作：新增一条研判项目并切换过去
function doCreateProj(){
  var inp=document.querySelector('#modalLayer input');
  var dir=(inp&&inp.value.trim())||'新产业方向';
  var id='p'+Date.now();
  PROJECTS[id]={id:id,city:P().city,org:P().org,who:P().who,topic:dir+'补链',stage:1,
    kb:P().kb,report:null,clues:[]};
  closeModal();cur=id;view='home';detailData=null;render();
  toast('已创建研判：'+dir+'补链');
}
