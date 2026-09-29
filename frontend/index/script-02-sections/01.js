/* ===== 数据层：多项目（优化点：解决写死随州）===== */
var PROJECTS={};














































































































































var STAGES=[['资料准备','上传与授权材料'],['AI 研判','生成缺口与方向'],['确认需求','双确认'],['资源匹配','资源端核验匹配'],['招商对接','安排正式沟通']];
// 兼容结构化 chunk（对象含 text/origin/nature）与旧字符串：统一取文本
function _kbText(x){
  var t=(x&&typeof x==='object')?(x.text||''):String(x==null?'':x);
  // 删除URL
  t=t.replace(/https?:\/\/[^\s\)）,，。]*/g,'');
  // 删除来源标注
  t=t.replace(/[\(（]?来源[:：]?\s*[^\)）\n]*[\)）]?/g,'');
  t=t.replace(/数据[来源]+[:：][^。；\n]*[。；]?/g,'');
  // 删除日期标注
  t=t.replace(/[\(（]\s*\d{4}[-\/]\d{2}[-\/]\d{2}\s*[\)）]/g,'');
  t=t.replace(/[,，]\s*\d{4}[-\/]\d{2}[-\/]\d{2}/g,'');
  // 删除系统prompt残留
  t=t.replace(/编制单位[:：][^。\n]*/g,'');
  t=t.replace(/数据基准[:：][^。\n]*/g,'');
  t=t.replace(/引用铁律[:：][^。\n]*/g,'');
  t=t.replace(/地价只认[^。\n]*[。]?/g,'');
  t=t.replace(/政策必标[^。\n]*[。]?/g,'');
  t=t.replace(/>\s*[^\n]*/g,'');
  // 删除所有【...】及孤立】
  t=t.replace(/【[^】]*】\s*/g,'');
  t=t.replace(/】/g,'');
  // 删除生成时间/分析对象等元信息
  t=t.replace(/生成时间[:：][^。；\n]*[。；]?/g,'');
  t=t.replace(/分析对象[:：][^。；\n]*[。；]?/g,'');
  t=t.replace(/gov\.cn\s*权威源为主[）\)]?/g,'');
  // 删除.shtml路径碎片
  t=t.replace(/\d*\/t\d+_\d+\.shtml/g,'');
  // 删除表格分隔线(----连续)
  t=t.replace(/-{3,}/g,'');
  // 删除系统编号标签 [XXX-X-NNNN|状态]
  t=t.replace(/\[\w+-\w+-\d+\|[^\]]*\]/g,'');
  // 删除英文大写下划线标识符(如INVESTMENT_INTENT_NOT_EVIDENCED)
  t=t.replace(/[A-Z_]{10,}/g,'');
  // 删除"优先级P0/P1"等系统标记
  t=t.replace(/[，,]?\s*优先级\s*P\d/g,'');
  // 清理多余空格/标点
  t=t.replace(/\s{2,}/g,' ');
  t=t.replace(/[。；，]{2,}/g,'。');
  t=t.trim().replace(/^[。；，\s]+/,'').replace(/[。；，\s]+$/,'');
  // 清理 markdown 粗体标记
  t=t.replace(/\*\*/g,'');
  return t;
}
// 判断一条known是否为无用条目（纯标题/报告头/表格数据/碎片）
function _isJunkKbItem(text){
  if(!text||text.length<6) return true;
  if(/^[\s✅⚠️]*$/.test(text)) return true;
  // 占位文本（空的补充条目模板）
  if(/请在此输入|保存后写入|请输入补充/.test(text)) return true;
  // 纯报告标题（无实质数据，如"XX市招商方向研判报告"）
  if(/^[✅⚠️\s]*.{2,6}(市|区|县).{0,20}(报告|纲要|规划|方案|清单|简介)\s*$/.test(text)) return true;
  // 报告标题+紧跟编制/数据元信息（如"【上海市松江区招商方向研判报告】 编制对象：… 数据时效：…"），属于文档序言不展示。管理端 RAG 不动。
  if(/^[✅⚠️\s]*[【\[][^】\]]{2,120}?(报告|纲要|规划|方案|清单|简介|研判|分析)[^】\]]{0,80}[】\]][\s\S]{0,30}(编制对象|编制说明|数据时效|方向框架|竞争分析范围)/.test(text)) return true;
  // 纯表格行：数字占比>50%且含多个连续数字段
  var digits=text.replace(/[^0-9.]/g,'').length;
  if(digits/text.length>0.45&&(text.match(/\d+\.?\d*/g)||[]).length>=5) return true;
  // .shtml碎片残留
  if(/\.shtml/.test(text)) return true;
  // 纯表头行（如"年份 GDP 增速 人均GDP 数据"）
  if(/^[\s年份GDP增速人均数据亿元万%（）\(\)\s]+$/.test(text)) return true;
  // 过短且无中文实质内容
  if(text.length<15&&!/[\u4e00-\u9fff]{4,}/.test(text)) return true;
  // 纯数据标注（如"数据2025年结构比"）
  if(/^数据\d{4}年/.test(text)) return true;
  // 报告序言/编制元信息：
  //  a) 完整标题：【总览与方法论】/【编制说明】/【编制对象】/【数据时效】/【方向框架】…
  //  b) 服务端 AI 概括会去掉“【…】”前缀，变成“编制对象：…”/“编制说明：…”直开头 → 同样拦下。
  // 属于文档序言而非决策信息，前端不展示；管理端 RAG/服务端数据源不动，检索仍可召回。
  var _introKw='(总览与方法论?|方法论说明|编制说明|编制对象|数据时效|竞争分析范围|方向框架|前言|导言|摘要|目录)';
  if(new RegExp('^[\\s✅⚠️]*[【\\[]\\s*'+_introKw+'\\s*[】\\]]').test(text)) return true;
  if(new RegExp('^[\\s✅⚠️]*'+_introKw+'\\s*[：:]').test(text)) return true;
  // 方法论/读法说明句型：开头方法论主语 + 全段包含“研判/方法论/替换/深化论证/统一方法/框架/编制/说明/纲要/口径”等元词
  // 则视为写作说明而非决策信息（处理“方嘑1/方嘑2/方嘑3”自带数字但无实质数据的写作说明）。
  if(/^[\s✅⚠️]*(本报告|本文|本章|每个方向|每个章节|每个部分|本方案|本清单)/.test(text)
     && /(做完整研判|完整研判|统一方法|遵循统一|方法论|替换|深化论证|细分赛道拆解|拆解|框架|编制|口径|纲要)/.test(text)) return true;
  // 保底：开头方法论主语 + 全段无阿拉伯数字，视为写作说明。
  if(/^[\s✅⚠️]*(本报告|本文|本章|每个方向|每个章节|每个部分|本方案|本清单)/.test(text) && !/\d/.test(text)) return true;
  return false;
}

// === AI精选概括：从/api/kb-summary获取概括后的展示数据（不修改原始数据）===
var _kbSummaryData=null; // {city, kb:[{t,sub,tag,known:[]}]}
function loadKbSummary(){
  fetch('/api/kb-summary').then(function(r){return r.json();}).then(function(res){
    if(res.ok){
      _kbSummaryData=res;
      console.log('[kb-summary] loaded:', res.city, res.kb.length, 'sections');
      render(); // 重新渲染使用概括数据
    }
  }).catch(function(e){console.warn('[kb-summary] failed:',e);});
}
// 页面加载后延迟获取概括数据
setTimeout(loadKbSummary, 2000);

// 获取某个板块的展示用 known。
// 显示规则（用户 2026-09-18 定）：用户补充(全部) + 待确认⚠️(全部) + 精选6条(其余里挑)。
// 待确认与用户补充是「额外附加」，不占精选 6 条名额，所以返回条数可以超过 6。
// 数据层 p.kb[].known 始终全量，这里只做渲染筛选。
var _KB_PICK_N=6;
/* 【2026-09-18】待确认条目显示层去重。
   背景：AI 从同一批政策片段重复提取，松江政策板块 6 条待确认实际只有 2 个问题
   （4 条都在问同一个「固投补贴口径冲突」，2 条在问「委托生产/CDMO 适用性」）。
   铁律：只在显示层合并，绠不裁剪 kb.known —— 数据层保持全量。 */
/* 指纹策略：政策/数据类待确认的本质是「同一组数字的口径疑问」，
   所以用「数字+单位」集合做主判据，主题词做辅助。
   实测：3-gram 对同义改写太敏感（松江 11/17 仅 0.46），
   数字指纹下 11/15/17 为 1.00、8/14 为 1.00，9 正确保留为独立问题。 */
function _kbNums(t){
  var s=String(t||'').replace(/[\s\u3000,\uff0c]/g,'');
  var out={};
  var re=/([0-9]+(?:\.[0-9]+)?)\s*(%|\u4ebf\u5143|\u4ebf|\u4e07\u5143|\u4e07|\u5e73\u65b9\u7c73|\u5e73\u65b9\u516c\u91cc)/g, m;
  while((m=re.exec(s))!==null){ out[m[1]+m[2].replace('\u5143','')]=1; }
  return out;
}
var _KB_TOPIC_KEYS=['\u56fa\u6295','\u56fa\u5b9a\u8d44\u4ea7\u6295\u8d44','\u59d4\u6258\u751f\u4ea7','CDMO','CMO','\u4ea7\u4e1a\u7528\u623f','\u4e13\u9879\u8d44\u91d1',
  '\u7528\u5730','\u80fd\u8017','\u4eba\u624d','\u7814\u53d1\u8d39\u7528','\u8d34\u606f','\u4e0a\u5e02','\u5e76\u8d2d','\u8d28\u7c92','\u75c5\u6bd2\u8f7d\u4f53','IVD','CGT','\u623f\u79df','\u7a0e\u6536'];
function _kbTopicWords(t){
  var s=String(t||''), out={};
  _KB_TOPIC_KEYS.forEach(function(k){ if(s.indexOf(k)>=0) out[k]=1; });
  return out;
}
function _kbJac(a,b){
  var ka=Object.keys(a), kb=Object.keys(b);
  if(!ka.length||!kb.length) return 0;
  var inter=0; ka.forEach(function(k){ if(b[k]) inter++; });
  var uni=ka.length+kb.length-inter;
  return uni>0?inter/uni:0;
}
function _kbSimilar(a,b){
  var numSim=_kbJac(_kbNums(a),_kbNums(b));
  if(numSim<=0) return 0;   // 没有共同数字就不可能是同一个口径问题
  var topSim=_kbJac(_kbTopicWords(a),_kbTopicWords(b));
  return numSim*0.7+topSim*0.3;
}
var _KB_DUP_THRESHOLD=0.6;
function _dedupeWarnPairs(pairs){
  var groups=[];
  (pairs||[]).forEach(function(p){
    for(var g=0;g<groups.length;g++){
      if(_kbSimilar(groups[g].text, p.text)>=_KB_DUP_THRESHOLD){
        groups[g].dupIdx.push(p.origIdx);
        if(String(p.text||'').length>String(groups[g].text||'').length){
          groups[g].dupIdx.push(groups[g].origIdx);
          groups[g].origIdx=p.origIdx; groups[g].text=p.text;
          groups[g].dupIdx=groups[g].dupIdx.filter(function(x){return x!==p.origIdx;});
        }
        return;
      }
    }
    groups.push({origIdx:p.origIdx, text:p.text, dupIdx:[]});
  });
  return groups;
}
function _getDisplayKnown(kbIdx){
  var p=P(); if(!p||!p.kb||!p.kb[kbIdx]) return [];
  var raw=p.kb[kbIdx].known||[];
  // 1. 用户补充/修改（origin=user）——全部显示，最新在前
  var userAdded=[];
  // 2. 待确认（⚠️）——全部显示，干部需要知道哪些事实还没核实
  var warnItems=[];
  // 3. 其余：已核验(✅) 与普通条目，用于凑精选 6 条
  var confirmed=[], normal=[];
  raw.forEach(function(x,idx){
    var t=_kbText(x);
    var _isU=(typeof x==='object' && x.origin==='user');
    // 【2026-09-18 修复】用户人工录入的条目不走垃圾过滤。
    // _isJunkKbItem 首行 `length<6 → junk`，干部补「测试」(含✅仅 4 字) 会被丢掉，
    // 造成「政府端看不到、管理端却有」(ops.html 不做过滤)。过滤只该拦 AI/RAG 碎片。
    if(_isU){
      if(String(t||'').replace(/[\s\u2705\u26a0\ufe0f]/g,'')) userAdded.push({t:t, ts:(x&&x.ts)||idx});
      return;
    }
    if(_isJunkKbItem(t)) return;
    if(t.indexOf('\u26a0\ufe0f')>=0){ warnItems.push(t); return; }
    if(t.indexOf('\u2705')===0){ confirmed.push(t); return; }
    normal.push(t);
  });
  userAdded.sort(function(a,b){return b.ts-a.ts;});
  var userItems=userAdded.map(function(o){return o.t;});

  // 精选 6 条：优先 AI 概括（更凝练），不足则用已核验 + 普通条目补齐
  var picked=[];
  var aiItems=[];
  if(_kbSummaryData && _kbSummaryData.kb && _kbSummaryData.kb[kbIdx]){
    aiItems=(_kbSummaryData.kb[kbIdx].known||[]).filter(function(x){return !_isJunkKbItem(x);});
  }
  function _push(t){
    if(picked.length>=_KB_PICK_N) return;
    if(!t || picked.indexOf(t)>=0) return;
    if(userItems.indexOf(t)>=0 || warnItems.indexOf(t)>=0) return;  // 已在附加段，不重复
    picked.push(t);
  }
  aiItems.forEach(_push);
  confirmed.forEach(_push);
  normal.forEach(_push);

  // 附加段在前（用户补充 → 待确认），精选段在后
  return userItems.concat(warnItems).concat(picked);
}
// 获取用户手动补充/修改的条目（origin==='user'），最新在前 —— 卡片专门展示这些
function _getUserAddedKnown(kbIdx){
  var p=P(); if(!p||!p.kb||!p.kb[kbIdx]) return [];
  var raw=p.kb[kbIdx].known||[];
  var arr=[];
  raw.forEach(function(x,idx){
    if(typeof x!=='object' || x.origin!=='user' || !(x.nature==='fix'||x.nature==='confirm')) return;
    var t=_kbText(x);
    // 【2026-09-18 修复】本函数就是专取用户条目的，再跑垃圾过滤等于白取；
    // 短文本（如「测试」）会被 length<6 规则丢掉。仅排除真空内容。
    if(!String(t||'').replace(/[\s\u2705\u26a0\ufe0f]/g,'')) return;
    arr.push({t:t, ts:(x&&x.ts)||idx});
  });
  arr.sort(function(a,b){return b.ts-a.ts;});
  return arr.map(function(o){return o.t;});
}
// 只取「精选段」（不含用户补充与待确认）——供卡片摘要行使用，
// 避免摘要显示成「⚠️ …待核实」或与卡片下方的「补充」区重复。
function _getPickedKnown(kbIdx){
  var p=P(); if(!p||!p.kb||!p.kb[kbIdx]) return [];
  var raw=p.kb[kbIdx].known||[];
  var confirmed=[], normal=[];
  raw.forEach(function(x){
    var t=_kbText(x);
    if(_isJunkKbItem(t)) return;
    if(typeof x==='object' && x.origin==='user') return;
    if(t.indexOf('\u26a0\ufe0f')>=0) return;
    if(t.indexOf('\u2705')===0) confirmed.push(t); else normal.push(t);
  });
  var picked=[], aiItems=[];
  if(_kbSummaryData && _kbSummaryData.kb && _kbSummaryData.kb[kbIdx]){
    aiItems=(_kbSummaryData.kb[kbIdx].known||[]).filter(function(x){return !_isJunkKbItem(x);});
  }
  [aiItems, confirmed, normal].forEach(function(arr){
    arr.forEach(function(t){
      if(picked.length<_KB_PICK_N && t && picked.indexOf(t)<0) picked.push(t);
    });
  });
  return picked;
}
// 待确认（⚠️）条目，卡片用它显示计数
function _getWarnKnown(kbIdx){
  var p=P(); if(!p||!p.kb||!p.kb[kbIdx]) return [];
  return (p.kb[kbIdx].known||[]).map(_kbText).filter(function(t){
    return t && !_isJunkKbItem(t) && t.indexOf('\u26a0\ufe0f')>=0;
  });
}
function _getDisplaySub(kbIdx){
  if(_kbSummaryData && _kbSummaryData.kb && _kbSummaryData.kb[kbIdx]){
    var s=_kbSummaryData.kb[kbIdx].sub;
    if(s) return s;
  }
  var p=P(); if(!p||!p.kb||!p.kb[kbIdx]) return '';
  var sub=p.kb[kbIdx].sub||'';
  // 如果是“AI流水线产出”类无意义文字，替换为板块概述
  if(sub.indexOf('AI流水线')>=0||sub.indexOf('流水线产出')>=0||!sub){
    var city=p.city||'';
    var topic=p.kb[kbIdx].t||'';
    var map={'主导产业与产业链':city+'主导产业集群与核心缺口','园区与承载条件':city+'主要园区与承载能力','链主与存量企业':city+'链主企业与配套格局','政策、规划与领导关注':city+'政策方向与竞争态势'};
    sub=map[topic]||(city+'产业数据');
  }
  return sub;
}
function _getDisplayTag(kbIdx){
  if(_kbSummaryData && _kbSummaryData.kb && _kbSummaryData.kb[kbIdx]){
    return _kbSummaryData.kb[kbIdx].tag||'';
  }
  var p=P(); if(!p||!p.kb||!p.kb[kbIdx]) return '';
  return p.kb[kbIdx].tag||'';
}
function _kbMeta(x){ return (x&&typeof x==='object')?x:{text:String(x==null?'':x),origin:'ai',nature:'base'}; }

