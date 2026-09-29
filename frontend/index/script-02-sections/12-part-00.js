/* ===== 企业线索删除墓碑 =====
   服务端 _merge_clues 会保留「服务端独有」的线索（防旧快照冲掉已核验状态），
   所以单纯从 p.clues 里 splice 掉，下一次 GET 就会被合并复活（删了又回来），
   与项目删除同一个坑。这里用 'projKey::clueId' 墓碑，persist 带给服务端做永久移除。 */
function _projKeyOf(p){
  if(!p) return null;
  try{
    var ks=Object.keys(PROJECTS);
    for(var i=0;i<ks.length;i++){ if(PROJECTS[ks[i]]===p) return ks[i]; }
  }catch(_){}
  return null;
}
/* 【2026-09-22 修复 P0】墓碑必须按「企业身份（名称）」匹配，不能按 clue.id。
   根因：AI 漏斗 id 曾是 'f_'+projKey+'_'+下标（ops.html runAIFunnel），下标随每次
   重跑的模型返回顺序重新分配，同一个 id 跨两次漏斗指向完全不同的企业。
   实测事故：上一批删 CT 企业留下墓碑 f_<pk>_0，下一批漏斗的 f_<pk>_0 是诺唯赞生物
   （88 分 Top8 第 2），推送时被当成「已删除」静默跳过，界面看不出少了一家。
   所以：新墓碑写 'projKey::@<规范化企业名>'；位置型 id 的旧墓碑一律失效，
   否则同一个 bug 原样复发（既挡推送，也会在政府端把新企业渲染掉）。
   手工录入 id 是 clue_manual_<时间戳>，唯一且不复用，legacy 键继续兼容。 */
