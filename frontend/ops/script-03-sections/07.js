/* ===== 通用弹窗（复用雷总 .modal 类）===== */
function openModal(title,bodyHtml,footHtml){
  var l=document.createElement('div');l.className='modal-layer';l.id='modalLayer';
  l.onclick=function(e){if(e.target===l)closeModal()};
  l.innerHTML='<div class="modal"><header><h2>'+title+'</h2><button onclick="closeModal()"><i class="i">✕</i></button></header>'+
    '<div class="modal-body">'+bodyHtml+'</div>'+(footHtml?('<footer>'+footHtml+'</footer>'):'')+'</div>';
  document.body.appendChild(l);
}
function closeModal(){var ls=document.querySelectorAll('.modal-layer');if(ls.length)ls[ls.length-1].remove();}
var NAV=[['knowledge','📚','城市智库','完善材料·产业/园区/企业/政策'],['report','📝','研判需求','出报告·可来回优化'],['home','📋','项目管理','报告派生项目·对接需求'],['docking','🤝','招商对接','资源匹配与对接进度'],['settings','⚙️','设置','账号与提醒']];

function render(){
  // 管理端：先从服务器拉数据，确保持久化同步
  if(role==='ops'){
    if(!render._opsRestored){
      render._opsRestored=true;
      restore();  // 先用本地缓存快速渲染
      // 从服务器拉取最新数据
      restoreFromServer(function(ok){ if(ok) renderOpsV2(); });
      // 周期性自动刷新：政府端新注册/新建城市后，管理端无需手动刷新即可同步出现
      if(!render._opsPollTimer){
        render._opsPollTimer=setInterval(function(){
          var _before=Object.keys(PROJECTS).length;
          restoreFromServer(function(ok){
            if(ok && Object.keys(PROJECTS).length!==_before){ renderOpsV2(); }
          });
        }, 15000);
      }
    }
    renderOpsV2();
    return;
  }
  // 尝试从 localStorage 恢复（非 ?demo 模式）
  if(location.search.indexOf('demo')<0&&!cur&&!render._restored){
    render._restored=true;
    if(restore()){return render();}
  }
  // ?demo 模式：直接注入随州演示数据，跳过 onboarding（测试用）
  if(location.search.indexOf('demo')>=0&&!cur){
    var _dk='demo_'+Date.now().toString(36);
    var _dc=generateKbConclusions('随州');
    var _dk_proj=PROJECTS[_dk]={id:_dk,city:'随州',org:'随州市招商局',who:'张主任',topic:'随州主导产业补链招引',stage:1,
      kb:[
        {icon:'🏭',t:'主导产业与产业链',sub:_dc.industry.sub,tag:_dc.industry.tag,known:_dc.industry.known,calls:['产业链缺口测绘报告']},
        {icon:'🏢',t:'园区与承载条件',sub:_dc.park.sub,tag:_dc.park.tag,known:_dc.park.known,calls:['产业链缺口测绘报告']},
        {icon:'🏗️',t:'链主与存量企业',sub:_dc.firm.sub,tag:_dc.firm.tag,known:_dc.firm.known,calls:['产业链缺口测绘报告']},
        {icon:'📜',t:'政策、规划与领导关注',sub:_dc.policy.sub,tag:_dc.policy.tag,known:_dc.policy.known,calls:['政策规划研究']}
      ],report:null,clues:[]};
    cur=_dk; view='knowledge'; detailOpen=false;
  // 给 demo 项目注入示例报告状态，以便测试线索派生
  if(!REPORTSTATE[_dk]){
    REPORTSTATE[_dk]={
      text:'## 一、产业基础判断\n\n随州是中国专用汽车之都。2025年专用汽车与应急产业总产值**703亿元**（+12.1%），年产专用车约**16万辆**，全国占比>10%，专汽出口+71%全省第一。安全应急产业2023年总产值502亿，其中移动应急装备324亿。香菇全产业链2024年产值超500亿，区域品牌价值205.8亿，连续3年全国食药用菌第一。\n\n本地配套率仅**41%**，远低于山东梁山65%和十堰75%+。链主企业：程力（整车）、新楚风（氢能整车，49T氢重卡已量产，百公里氢耗7.1kg续航1000km）、齐星（整车/无人机指挥车）、江南专汽（泡沫消防车600-1000万/台）、品源（"菇的辣克"2024签1亿美元+2025续签3亿美元）。\n\n## 二、产业链缺口分析\n\n### 氢能专用车方向\n- ✅ 已有：整车/改装（程力/新楚风/齐星）、车身驾驶室（齐星）、车规级晶振（泰晶AEC-Q200）、电解液（犇星）\n- ❌ 缺失：燃料电池电堆（占整车成本53%，A=必须本地化，全部外购）\n- ❌ 缺失：高压储氢瓶阀与管路（占整车成本14%，A=必须本地化）\n- ⚠️ 薄弱：底盘/动力总成（占整车成本50%，外购十堰潍柴/法士特/汉德，C=优先本地化）\n\n### 智慧应急装备方向\n- ✅ 已有：整机平台（博利特高空系留无人机消防车、齐星6架无人机指挥车）、软体材料（金龙篷布全国30%）\n- ❌ 缺失：应急机器人本体（依赖启灵外采，B=可跨区域）\n- ❌ 缺失：5G/卫星应急通信模块（本地零布局，B=可跨区域）\n\n### 香菇精深加工方向\n- ✅ 已有：初加工出口（品源辣酱，年产70万吨）、多糖提取（裕国药业）、多肽提取（肽源）\n- ❌ 缺失：香菇多糖/多肽规模化提取平台（仅2家布局，A=必须本地化）\n- ❌ 缺失：菌种自主研发（国外7925/7917品种垄断，A=必须本地化）\n\n## 三、补链优先级清单TOP5\n\n| 排名 | 缺口节点 | 本地化属性 | 经济拉动★ | 招引可行性★ | 综合优先级 |\n|---|---|---|---|---|---|\n| 1 | 燃料电池电堆 | A=必须本地化 | ★★★★★ | ★★★★ | 第一优先 |\n| 2 | 高压储氢瓶阀与管路 | A=必须本地化 | ★★★★ | ★★★★ | 第二优先 |\n| 3 | 应急机器人本体 | B=可跨区域 | ★★★★ | ★★★ | 第三优先 |\n| 4 | 香菇多糖/多肽提取 | A=必须本地化 | ★★★★ | ★★★★ | 第四优先 |\n| 5 | 菌种自主研发基地 | A=必须本地化 | ★★★ | ★★★ | 第五优先 |\n\n## 四、目标企业画像\n\n**燃料电池电堆（第一优先）**\n- 目标类型：商用车功率段燃料电池系统集成商或电堆制造企业，年产能≥3000台，掌握金属双极板或膜电极核心工艺\n- 开口话术：「随州新楚风49T氢重卡已量产，年产能16万辆整车基地就是您进入商用车场景最快的验证通道，落地即锁定程力/新楚风的稳定采购订单。」\n\n**高压储氢瓶阀（第二优先）**\n- 目标类型：35MPa/70MPa高压储氢瓶阀、管路及集成模块制造企业\n- 开口话术：「随州16万辆/年专用车产量是稳定的储氢系统需求方，与电堆企业同步落地可降低整体物流成本。」\n\n**香菇多糖/多肽提取（第四优先）**\n- 目标类型：香菇多糖/多肽功能成分提取与功能性食品企业，寻求中部原料产地合作\n- 开口话术：「随州年产香菇约70万吨，全球白花菇约50%，就近落地可将原料采购成本降低40%+，与裕国/肽源形成产能协作。」\n\n## 五、待确认事项\n\n⚠️ 湖北省氢能专项补贴额度与首选承接园区（高新区/曾都经开区/专汽产业园）需向领导确认\n⚠️ 程力/新楚风的首批电堆采购意向与数量，需走访链主企业核实\n⚠️ 菌种自主研发基地的用地指标与洁净厂房条件，需园区管委会确认\n⚠️ 随县香菇产业园精深加工区的GMP洁净厂房现状，需现场核实',
      topic:'随州主导产业补链招引',
      ts: Date.now(),
      score: 75,
      phase: 2
    };
    _dk_proj.stage=3;  // 推进到「确认需求」阶段
  }
  }
  if(view==='setup'||!cur||!PROJECTS[cur]){var _root=$('#root');if(_root){_root.innerHTML='<div style="height:100vh;background:#f5f7fb">'+setupPage()+'</div>';bind();} return;}
  if(role==='ops')return renderOps();
  var p=P();
  $('#root').innerHTML=
   '<div class="app-shell">'+
    topbar(p)+
    '<div class="app-content">'+sidebar()+
      '<div class="pane-divider"><span class="divider-grip"><i class="i">⋮</i></span></div>'+
      '<div class="content-column"><div class="workspace">'+
        '<div class="main-pane">'+mainPane(p)+'</div>'+
        (detailOpen&&view!=='knowledge'?('<div class="detail-pane">'+detailPane(p)+'</div>')
                   :(view==='knowledge'?'':('<button class="reopen-detail" onclick="toggleDetail()"><i class="i"></i>展开详情</button>')))+
      '</div></div>'+
    '</div>'+
    progressFooter(p)+
   '</div>';
  bind();
}
/* 顶栏角色切换按钮（政府端 ⇄ 运营端）*/

