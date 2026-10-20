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

function reportPublicationText(value,options){
  var original=typeof value==='string'?value:String(value==null?'':value);
  options=options||{};
  if(!(Number(options.phase)>=2))return original;
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
