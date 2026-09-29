/* ===== 主区视图 ===== */
function mainPane(p){
  if(view==='knowledge')return kbPage(p);
  if(view==='settings')return settingsPage(p);
  if(view==='report')return homePage(p);      // 产业分析：出报告的对话工作区
  if(view==='docking'){view='home';}          // docking 兼容重定向：对接内容已并入「招商对接」页
  if(view==='subwork')return subWorkPage(p);   // 招引项目独立工作页
  return projMgmtPage(p);                       // home = 招商对接（默认）
}
// 招商对接：项目列表切换（AI对话分类式）+ 进入项目工作区
/* ══════════════════════════════════════════════════════════════
   企业线索管理 — projMgmtPage 完整重写
   数据源：PROJECTS[k].clues[]
   每条 clue: {id, name, kind, region, source, status, tone, reason, signal, questions:[]}
   tone: 'slate'待接触 / 'amber'核验中 / 'teal'可安排沟通
   ══════════════════════════════════════════════════════════════ */

/* ── 从研判报告文本派生候选线索 ── */

/* ── 企业线索两栏布局渲染 ── */
/* 政府端「待接触企业」统一口径：只显示管理端 AI 漏斗推送(gov_push)或人工录入的真实线索；
   过滤掉历史遗留的自动派生假数据（脱敏企业占位）与演示用扫描企业(ai_scan）。
   所有计数与列表渲染都必须走这个函数，避免头部数字与实际列表不一致。 */
function visibleClues(p, projKey){
  if(!p||!p.clues) return [];
  var _pk = projKey || _projKeyOf(p);
  return p.clues.filter(function(c){
    if(!c) return false;
    if(c.status==='ai_scan') return false;
    if(typeof c.name==='string' && c.name.indexOf('脱敏企业')===0) return false;
    if(_pk && isClueDeleted(_pk, c)) return false;
    return true;
  });
}

