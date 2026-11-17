/* Publication is a view of a saved report. Never write this text back to the
   research record: its original text binds evidence snapshots and hashes. */
function reportPublicationPhase(context){
  context=context||{};
  if(context.phase!=null)return Number(context.phase)||0;
  var state=context.state||{},topic=context.topic||'';
  if(Object.prototype.hasOwnProperty.call(state.phaseByTopic||{},topic))return Number(state.phaseByTopic[topic])||0;
  return state.topic===topic?Number(state.phase)||0:0;
}

function reportPublicationForContext(context){
  context=context||{};
  var record=((context.state||{}).researchByTopic||{})[context.topic];
  var sources=record&&record.topic===context.topic&&record.reportText===context.text?record.sources:[];
  return reportPublicationText(context.text,{phase:reportPublicationPhase(context),sources:sources});
}

function reportCompositionForContext(context){
  context=context||{};
  if(context.composition&&typeof context.composition==='object')return context.composition;
  var record=(((context.state||{}).researchByTopic)||{})[context.topic];
  return record&&record.topic===context.topic&&record.reportText===context.text?(record.analysis||{}).composition||null:null;
}

function reportPublicationLabel(context,fallback){
  var composition=reportCompositionForContext(context);
  if(composition&&composition.status==='limited')return '阶段性研判';
  if(composition&&composition.status==='reviewed')return '产业研判报告';
  var state=(context||{}).state||{},topic=(context||{}).topic;
  if(((state.userGeneratedTopics)||{})[topic]===true||((state.researchByTopic)||{})[topic])return '产业研判报告';
  if(state.sourceReportId)return fallback||'产业研判报告';
  return reportPublicationPhase(context)>=2?'产业研判报告':fallback||'产业研判报告';
}

function reportCompositionNotes(composition){
  if(!composition||typeof composition!=='object')return [];
  var chapters={foundation:'产业基础',industry:'产业基础',basis:'产业基础',gaps:'产业链分析',chain:'产业链分析',priorities:'优先级',priority:'优先级',companies:'企业画像',enterprises:'企业画像',implementation:'实施建议',actions:'实施建议',report:'报告整体',overall:'报告整体',1:'产业基础',2:'产业链分析',3:'优先级',4:'企业画像',5:'实施建议'};
  var codes={insufficient_material:'材料不足',insufficient_evidence:'材料不足',insufficient_sources:'材料不足',review_failed:'审稿未通过',review_rejected:'审稿未通过',composition_failed:'成文未完成',generation_failed:'成文未完成',incomplete:'成文未完成',unsupported_claim:'部分判断缺少来源支持',citation_missing:'部分判断缺少引用',citation_invalid:'部分引用需补充核对',local_basis_missing:'本地产业基础的原始材料不足',reviewed_analysis_missing:'供需关系的研判依据不足',grounded_company_profile_missing:'企业画像缺少产品依据',original_evidence_missing:'原始材料不足',required_source_context_exceeds_bound:'材料规模超出本轮可完成的研究范围',chapter_quality_not_approved:'本章审稿未通过',composition_unavailable:'成文与审稿未完成',research_incomplete:'本轮研究尚未完整完成'};
  var diagnostics=composition.diagnostics,rows=Array.isArray(diagnostics)?diagnostics:diagnostics&&typeof diagnostics==='object'?(Array.isArray(diagnostics.issues)?diagnostics.issues:Object.keys(diagnostics).map(function(key){return typeof diagnostics[key]==='object'?diagnostics[key]:{code:key,reason:typeof diagnostics[key]==='string'?diagnostics[key]:''};})):[];
  var out=[];
  rows.slice(0,12).forEach(function(row){
    if(typeof row==='string')row={reason:row};
    if(!row||typeof row!=='object')return;
    var chapter=chapters[row.chapter]||chapters[row.section]||'报告整体',description=codes[row.code]||'';
    var reason=typeof row.reason==='string'?row.reason.trim():typeof row.message==='string'?row.message.trim():'';
    // A technical identifier is not useful client-facing review feedback.
    if(reason&&(!/[\u3400-\u9fff]/.test(reason)||/[a-z][a-z0-9]*_[a-z0-9_]+|[{}]|JSON|schema|traceback/i.test(reason)))reason='';
    if(reason)description=reason.slice(0,180);
    if(description)out.push(chapter+'：'+description);
  });
  return out;
}

function reportKeepReviewed(context,incoming){
  var current=reportCompositionForContext(context),next=((incoming||{}).analysis||{}).composition;
  var archived=Array.isArray((context||{}).history)&&context.history.some(function(record){return record&&record.topic===context.topic&&record.composition&&record.composition.status==='reviewed';});
  return !!(((current&&current.status==='reviewed')||archived)&&next&&next.status==='limited');
}

function stripReportWebFooter(text){
  // Keep this vocabulary aligned with backend/source_article.py. Standalone
  // headings like “政务公开” count as menu text only alongside other controls.
  var control=/^(?:简体(?:中文)?|繁体(?:中文)?|English|日本語|한국어|搜本[站網网]|搜站群|站内搜索|搜索本站|(?:进入|开启|退出)(?:关怀|无障碍|长辈|适老)(?:模式|版)?|无障碍(?:阅读|浏览)|扫一扫(?:在手机|用手机)?打开当前页|手机扫一扫打开当前页|分享到[：:]?|网站导航[：:]?|网站地图|网站无障碍|打印本页|关闭窗口|返回顶部|政府网站找错|网站纠错|政务邮箱登录|(?:当前|您所在)(?:所在)?位置[：:]?|(?:访问量|浏览量)\s*[：:]\s*[\d,]*|(?:政务服务|一网通办)(?:公众号|小程序)|网站标识码[：:]\s*\d+|[\u3400-\u9fff]?ICP备\d+号(?:-\d+)?)$/i;
  var menu=/^(?:首页|新闻中心|政务公开|政府信息公开|办事服务|政务服务|政民互动|互动交流|改革动态|新手指南|进度查询|办事预约|意见反馈|帮助中心|掌上办|个人中心|登录|注册|网站首页|门户首页|机构概况|走进[\u3400-\u9fff]{2,10}|[\u3400-\u9fff]{2,10}(?:概况|概览|要闻)|新闻动态|区镇快讯|数据开放|老年服务|无障碍|关怀版|适老版|长者版|智能问答|智能客服|政务邮箱|了解详情|用户空间|在线客服|相关办事链接|办事平台|中国政府网|国务院部门网站|[\u3400-\u9fff（）()]{1,28}(?:政府网站|政务网站|设区市网站|辖市[（(]区[）)]网站|人民政府))$/;
  var breadcrumb=/^(?:(?:当前|您所在)(?:所在)?位置\s*[：:]\s*)?(?:首页|网站首页|门户首页)(?:\s*[>›»→/／]\s*[\w\u3400-\u9fff（）() \u3000]{0,36}){1,8}$/;
  var related=/^相关(?:文件|附件)[：:]?$/;
  var citation=/\s*(\[(?:来源\s*)?S?\d+\]\(https?:\/\/[^\s)]+\).*)$/i;
  var rows=text.split(/\r\n?|\n/),run=[],labels=new Set(),hasControl=false,removed=false;
  function label(line){
    return line.trim().replace(/^(?:>\s*)+|^[-*]\s+/,'').replace(/^\*+|\*+$/g,'')
      .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g,'$1')
      .replace(/&(?:amp;)?(?:gt|#62|#x3e);/gi,'>').replace(/&(?:amp;)?(?:nbsp|#160|#xa0);/gi,' ').trim();
  }
  function isControl(item){
    return control.test(item)||breadcrumb.test(item.replace(/^#{1,6}\s+/,''));
  }
  function flush(nextTitle){
    if(hasControl||labels.size>1){
      while(run.length&&run[run.length-1].related)run.pop();
      var before=run[0].index-1;
      while(before>=0&&!rows[before].trim())before--;
      var title=before>=0&&rows[before].trim().match(/^(.{8,180}?)\s+[-–—｜|]\s+[\u3400-\u9fff]{2,24}(?:人民政府|政府门户网站|政务服务网)$/);
      if(hasControl&&title&&title[1]===nextTitle.replace(/^#{1,6}\s+/,''))rows[before]='';
      run.forEach(function(entry){rows[entry.index]=entry.reference;});
      removed=true;
    }
    run=[];labels.clear();hasControl=false;
  }
  rows.forEach(function(line,i){
    var ref=line.match(citation),item=label(ref?line.slice(0,ref.index):line);
    if(!item&&!ref)return;
    var options=isControl(item)||menu.test(item)?[item]:item.split(/\s*[|｜·/／>›»→]\s*|\s+/).filter(Boolean);
    if((options.length&&options.every(function(value){return isControl(value)||menu.test(value);}))||related.test(item)){
      run.push({index:i,reference:ref?ref[1]:'',related:related.test(item)});
      options.forEach(function(value){
        if(isControl(value))hasControl=true;
        if(isControl(value)||menu.test(value))labels.add(value);
      });
    }else{
      flush(item);
    }
  });
  flush('');
  return removed?rows.join('\n').replace(/\n{3,}/g,'\n\n').trim():text;
}

// Editorial revision of the saved Suzhou draft. Match the legacy chapter and
// its source, so a later generation with the same title takes precedence.
function reviseSavedSuzhouCopperChapter(text){
  if(!/^# 苏州(?:市)? · 半导体电子化学品补链 · 产业研判稿(?:\r?\n|$)/.test(text))return text;
  var heading=/^## 二、产业链关系与机会分析[ \t]*$/m,next=/^## 三、招引研判方向[ \t]*$/m;
  var source='https://www.sipac.gov.cn/xzspj/ywtbggdt/202507/9c7fbfc5238e42e19906f1d4324f55bd.shtml';
  var annual='https://static.cninfo.com.cn/finalpage/2026-08-26/1225505856.PDF';
  var kunshan='https://www.ks.gov.cn/kss/qzkx/202605/3b246b88df5b4f1da524f7433085dabf.shtml';
  var rows=text.replace(/\r\n?/g,'\n'),start=rows.search(heading),end=rows.search(next);
  if(start<0||end<=start)return text;
  var previous=rows.slice(start,end);
  if(!previous.includes(source)||!previous.includes('比较判断')||!previous.includes('先进半导体基材'))return text;
  var revised=[
    '## 二、产业链关系与机会分析',
    '**阶段判断**　苏州的铜互连电镀液核查已找到具体供应线索。艾森股份在 2026 年半年报披露，28nm 大马士革铜互连用镀铜添加剂已在主流晶圆客户进入小批量量产。昆山市千灯镇政府也报道了该品类已获主流晶圆厂订单。[来源 S98]('+annual+')[来源 S99]('+kunshan+')',
    '现有公开材料能确认添加剂的进展。整套铜电镀液还要核实配套基液是否一并供应、添加剂和基液各自在哪个厂区生产，以及苏州本地哪条晶圆产线已使用或通过认证。公司处于昆山与具体产品在昆山生产是两项需要分别核实的事实。',
    '**首访艾森股份的晶圆材料产品和技术负责人**　这家公司有针对该工艺的具体产品和客户阶段披露，能直接核实配方供应范围、实际生产厂区，以及由送样、验证转入小批量的口径。请其提供可公开的产品、厂区和客户认证信息，或协助对接经客户同意的工艺负责人。',
    '**再向苏州相关晶圆产线的工艺工程与采购负责人交叉核实**　先确认当地哪条线使用大马士革铜互连，再问在用规格、现供来源、第二供应商导入意愿和验证窗口。生益科技的基材项目及国创中心基地可协助找应用线索。把它们列为候选访谈对象之前，先确认是否涉及同一工艺与材料。',
    '若应用端明确有规格、第二供应商需求和验证窗口，再筛选可供样的企业。若已有满足要求的稳定供应，则把后续走访聚焦于仍未覆盖的规格、认证或供货环节。'
  ].join('\n\n');
  var result=rows.slice(0,start)+revised+'\n\n'+rows.slice(end);
  var background='https://www.sic.gov.cn/sic/608/611/0805/20240805093707646931105_pc.html';
  var backgroundRef=/^\[\d+\] [^\n]*\[原文\]\(https:\/\/www\.sic\.gov\.cn\/sic\/608\/611\/0805\/20240805093707646931105_pc\.html\)[ \t]*\n?/m;
  var withoutBackgroundRef=result.replace(backgroundRef,'');
  if(!withoutBackgroundRef.includes(background))result=withoutBackgroundRef;
  return result.trimEnd()+'\n[98] 艾森股份 2026 年半年度报告，2026-08-26。[原文]('+annual+')\n'+
    '[99] 昆山市千灯镇人民政府关于艾森股份产品进展的报道，2026-05-18。[原文]('+kunshan+')';
}

// Older stage drafts repeated the research excerpts in chapter two. Reuse
// their reviewed comparisons and their matching reasons/actions from III/V.
function condenseSavedChainChapter(text){
  if(!/^# [^\n]+ · 产业研判稿[ \t]*$/m.test(text))return text;
  var lines=text.replace(/\r\n?/g,'\n').split('\n');
  var chain=lines.indexOf('## 二、产业链关系与机会分析');
  var priorities=lines.indexOf('## 三、招引研判方向');
  var companies=lines.indexOf('## 四、目标企业画像');
  var actions=lines.indexOf('## 五、实施建议');
  if(chain<0||priorities<=chain||companies<=priorities||actions<=companies)return text;
  var reasons=new Map(),steps=new Map(),comparisons=new Map(),focus='';
  var citation=/\[(?:来源\s*)?S?\d+\]\(https?:\/\//i;
  lines.slice(chain+1,priorities).forEach(function(line){
    var title=line.match(/^### (.+)$/);
    if(title)focus=title[1];
    var match=line.match(/^\*\*比较判断：\*\*\s+(.+)$/);
    if(focus&&match&&citation.test(match[1]))comparisons.set(focus,match[1]);
  });
  focus='';
  lines.slice(priorities+1,companies).forEach(function(line){
    var title=line.match(/^### \d+\. (.+)$/);
    if(title)focus=title[1];
    if(focus&&citation.test(line))reasons.set(focus,line);
  });
  var bibliography=lines.indexOf('## 参考文献',actions);
  lines.slice(actions+1,bibliography<0?lines.length:bibliography).forEach(function(line){
    var match=line.match(/^\d+\. \*\*(.+?)：\*\*\s+(.+)$/);
    if(match&&citation.test(match[2]))steps.set(match[1],match[2]);
  });
  if(!comparisons.size||comparisons.size!==steps.size||
     !Array.from(comparisons.keys()).every(function(name){return reasons.has(name)&&steps.has(name);}))return text;
  var revised=[lines[chain],''];
  comparisons.forEach(function(comparison,name){
    revised.push('### '+name,'','**查到哪一步**　'+comparison,'',
                 '**为什么核查**　'+reasons.get(name),'',
                 '**先找谁、核实什么**　'+steps.get(name),'');
  });
  return lines.slice(0,chain).concat(revised,lines.slice(priorities)).join('\n');
}

function reportPublicationText(value,options){
  var original=stripReportWebFooter(typeof value==='string'?value:String(value==null?'':value));
  options=options||{};
  if(!(Number(options.phase)>=2))return original;
  original=condenseSavedChainChapter(reviseSavedSuzhouCopperChapter(original));
  var metadata=Object.create(null),labels=Object.create(null),references=Object.create(null);
  function safeUrl(value){
    var url=typeof value==='string'?value.trim():'';
    return /^https?:\/\/[^\s<>"'\\]+$/i.test(url)&&!/@/.test(url.split('/').slice(0,3).join('/'))?url:'';
  }
  function canonical(url){return url.split('#')[0];}
  function plain(value){
    // Titles are text, not another Markdown/link channel supplied by metadata.
    return typeof value==='string'?value.replace(/[\r\n]+/g,' ').replace(/[\[\]<>\\]/g,function(ch){return {'[':'［',']':'］','<':'＜','>':'＞','\\':'＼'}[ch];}).trim():'';
  }
  (Array.isArray(options.sources)?options.sources:[]).forEach(function(source){
    if(!source||typeof source!=='object')return;
    var url=safeUrl(source.url);if(!url)return;
    var key=canonical(url);
    if(!metadata[key])metadata[key]={title:plain(source.title),date:plain(source.published_at)};
    [source.label,source.id].forEach(function(label){if(typeof label==='string'&&label.trim())labels[label.trim().replace(/^来源\s*/,'')]=url;});
  });
  function heading(line){
    var match=line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/),level=match?match[1].length:2;
    var title=match?match[2]:line.trim();
    if(!match&&!/^(?:[一二三四五六七八九十]+[、．.]|\d+[、．.])\s*\S/.test(title)&&!/^\*{0,2}(?:待确认事项|本轮确认输入|证据与核验边界|参考文献|参考资料|引用文献)\*{0,2}[：:]?$/.test(title))return null;
    title=title.replace(/^\*\*(.*?)\*\*$/,'$1').replace(/^(?:[一二三四五六七八九十]+|\d+)[、．.]\s*/,'').replace(/[：:]\s*$/,'').trim();
    return {level:level,title:title};
  }
  var rows=original.replace(/\r\n?/g,'\n').split('\n'),body=[],skipLevel=0,mode='',boundary=[];
  var existingUrls=[],unresolvedReferences=[];
  function flushBoundary(){
    var kept=boundary.map(function(line){
      return line.replace(/已将可引用原文与链接保留在报告中[。；;]?/g,'')
        .replace(/单源事实仍待独立复核[。；;]?/g,'')
        .replace(/交叉比对只覆盖核验记录[^。；;\n]*[。；;]?/g,'')
        .replace(/以下为本次生成保存的来源与摘录[。；;]?/g,'').trim();
    }).filter(Boolean);
    if(kept.length)body.push('\n## 适用条件与限制\n',kept.join('\n'));
    boundary=[];
  }
  rows.forEach(function(line){
    var h=heading(line);
    if(h&&skipLevel&&h.level<=skipLevel){if(mode==='boundary')flushBoundary();skipLevel=0;mode='';}
    if(h&&skipLevel&&mode==='process'&&h.title==='证据与核验边界'){mode='boundary';return;}
    if(h&&!skipLevel&&/^(?:待确认事项|本轮确认输入|证据与核验边界)$/.test(h.title)){skipLevel=h.level;mode=h.title==='证据与核验边界'?'boundary':'process';return;}
    if(h&&!skipLevel&&/^(?:参考文献|参考资料|引用文献)$/.test(h.title)){skipLevel=h.level;mode='references';return;}
    if(skipLevel){
      if(mode==='boundary')boundary.push(line);
      if(mode==='references'){
        var ref=line.match(/^\s*(?:[-*]\s*)?\[(?:来源\s*)?(S?\d+)\]\s*(.*)$/i);
        if(ref){
          var links=Array.from(ref[2].matchAll(/\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g));
          var link=links[links.length-1],bare=ref[2].match(/https?:\/\/[^\s<>()]+/),url=safeUrl(link?link[2]:bare?bare[0].replace(/[。．.；;,]+$/,''):'');
          if(url){
            labels[ref[1]]=url;
            var description=ref[2].slice(0,link?link.index:bare.index);
            if(link&&link[1]!=='原文'&&link[1]!==url)description+=link[1]+ref[2].slice(link.index+link[0].length);
            references[canonical(url)]=plain(description).replace(/[。．.]\s*$/,'');
            existingUrls.push(url);
          }else if(line.trim())unresolvedReferences.push(line);
        }else if(line.trim())unresolvedReferences.push(line);
      }
      return;
    }
    body.push(line);
  });
  if(mode==='boundary')flushBoundary();
  var text=body.join('\n');
  // A stand-alone bookkeeping paragraph contributes no report claim. Remove
  // that exact template together with its links, not ordinary citation rows.
  text=text.replace(/^[ \t]*(?:[-*][ \t]+)?沿用前文(?:的)?原始证据\s*((?:\[(?:来源\s*)?S?\d+\]\(https?:\/\/[^\s)]+\)\s*)+)[；;，,。]?\s*同一材料不重复计作(?:新的)?独立来源[。；;]?[ \t]*$/gm,'');
  // Remove only the known bookkeeping sentence, retaining its attached citation.
  text=text.replace(/沿用前文(?:的)?原始证据\s*((?:\[(?:来源\s*)?S?\d+\]\(https?:\/\/[^\s)]+\)\s*)+)[；;，,。]?\s*同一材料不重复计作(?:新的)?独立来源[。；;]?/g,'$1');
  text=text.replace(/(?:^|\n)[ \t]*(?:[-*]\s*)?同一材料不重复计作(?:新的)?独立来源[。；;]?[ \t]*(?=\n|$)/g,'\n');
  var numbered=Object.create(null),ordered=[];
  function cite(url){
    var key=canonical(url);
    if(!numbered[key]){numbered[key]=ordered.length+1;ordered.push(url);}
    return '['+numbered[key]+']('+url+')';
  }
  text=text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\[(S\d+|\d+)\](?!\()/gi,function(all,label,link,bare){
    if(link){
      var url=safeUrl(link);
      if(!/^(?:来源\s*)?S?\d+$/i.test(label.trim())&&!(url&&Object.prototype.hasOwnProperty.call(references,canonical(url))))return all;
      return url?cite(url):all;
    }
    return labels[bare]?cite(labels[bare]):all;
  });
  text=text.replace(/\n{3,}/g,'\n\n').trim();
  existingUrls.forEach(cite);
  if(!ordered.length&&!unresolvedReferences.length)return text;
  var bibliography=ordered.map(function(url,index){
    var key=canonical(url),source=metadata[key]||{},description=references[key]||'';
    if(!description){description=source.title;if(description&&source.date)description+='，'+source.date;}
    return '['+(index+1)+'] '+(description?description+'。 [原文]('+url+')':'['+url+']('+url+')');
  });
  return text+'\n\n## 参考文献\n\n'+bibliography.concat(unresolvedReferences).join('\n\n');
}
