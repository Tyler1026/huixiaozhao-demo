/* ===== 主区视图 ===== */
function mainPane(p){
  if(view==='knowledge')return kbPage(p);
  if(view==='settings')return settingsPage(p);
  if(view==='report')return homePage(p);      // 研判需求：出报告的对话工作区
  if(view==='docking')return dockingPage(p);   // 招商对接：独立tab
  if(view==='subwork')return subWorkPage(p);   // 招引项目独立工作页
  return projMgmtPage(p);                       // home = 项目管理（默认）
}
// 项目管理：项目列表切换（AI对话分类式）+ 进入项目工作区
/* ══════════════════════════════════════════════════════════════
   企业线索管理 — projMgmtPage 完整重写
   数据源：PROJECTS[k].clues[]
   每条 clue: {id, name, kind, region, source, status, tone, reason, signal, questions:[]}
   tone: 'slate'待接触 / 'amber'核验中 / 'teal'可安排沟通
   ══════════════════════════════════════════════════════════════ */

/* ── 从研判报告文本派生候选线索 ── */

/* ── 从报告文本提取缺口（供通用城市动态扫描用）── */
function extractGapsForScan(p){
  var gaps=[];
  var rsx=(typeof REPORTSTATE!=='undefined')?(REPORTSTATE[p.id]||REPORTSTATE[cur]):null;
  var text=rsx&&rsx.text||'';
  if(text){
    var lines=text.split('\n'); var inTop5=false;
    for(var i=0;i<lines.length;i++){
      var l=lines[i];
      if(l.indexOf('补链优先级')>=0||l.indexOf('TOP5')>=0||l.indexOf('优先级清单')>=0)inTop5=true;
      if(inTop5&&l.trim().charAt(0)==='|'){
        var cells=l.trim().slice(1,-1).split('|').map(function(c){return c.replace(/[*★]/g,'').trim();});
        if(cells.every(function(c){return /^[\s\-:]+$/.test(c);})||cells[0]==='排名'||cells[0]==='缺口节点')continue;
        var rank=parseInt(cells[0]); if(!isNaN(rank)&&cells[1])gaps.push(cells[1]);
      }
      if(inTop5&&gaps.length>=4)break;
    }
    if(!gaps.length){
      lines.forEach(function(l){
        if(l.indexOf('❌')>=0&&gaps.length<4){
          var c=l.replace(/^[*\-•|#\s]+/,'').replace(/❌|\*\*/g,'').replace('缺失','').trim();
          c=c.split(/[（(，,：:]/)[0].trim();
          if(c.length>=3&&c.length<30)gaps.push(c);
        }
      });
    }
  }
  if(!gaps.length)gaps=['核心零部件配套','关键系统集成','精深加工延链','智能装备升级'];
  return gaps.slice(0,4);
}

/* AI 企业漏斗 — 真实调用 DeepSeek(/api/kb-chat mode=funnel) 按项目分析，不用任何硬编码企业库 */
var _funnelRunning = {};
var KB_API_OPS = '/api/kb-chat';
function _funnelInput(p){
  var rsx=(typeof REPORTSTATE!=='undefined')?(REPORTSTATE[p.id]||REPORTSTATE[cur]):null;
  var text=(rsx&&rsx.text)||'';
  var gaps=[]; try{ gaps=extractGapsForScan(p); }catch(e){}
  return {text:text, gaps:gaps};
}
function runAIFunnel(projKey, done, onProgress){
  var p=PROJECTS[projKey]; if(!p){ done&&done('no project'); return; }
  if(_funnelRunning[projKey]){ return; }
  _funnelRunning[projKey]=true;
  var inp=_funnelInput(p); var topic=p.topic||'';
  var q='招商方向：'+topic+' 城市：'+(p.city||'')+'\n\n产业研判报告：\n'+(inp.text? inp.text.slice(0,4000) : '（暂无完整报告，请基于招商方向与常识分析）')+'\n\n已识别缺口：'+(inp.gaps&&inp.gaps.length?inp.gaps.join('、'):'（见报告）')+'\n\n请针对该招商方向筛选真实存在的适配企业构成企业漏斗，目标40家（至少30家）。每家企业按评分卡分别给出 score_match(0-40)/score_relocate(0-30)/score_strength(0-30) 三项分数；如企业有明确扩张需求或领导与本城市/本省有可考的派系关联（校友/籍贯/商会等），填 expansion/faction 字段，无则留空、严禁编造。严格按 SYSTEM 要求输出 JSON。';
  fetch(KB_API_OPS,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q, city:(p.city||''), chunks:[], stream:true, mode:'funnel'})})
  .then(function(resp){
    if(!resp.ok){ _funnelRunning[projKey]=false; return resp.json().then(function(e){ done&&done('服务繁忙或超时，请重试（'+((e&&e.error)||resp.status)+'）'); }).catch(function(){ done&&done('服务繁忙或超时，请重试'); }); }
    var acc='';
    function _finishFunnel(content){
      _funnelRunning[projKey]=false;
      if(!content){ done&&done('模型未返回内容，请重试'); return; }
      var obj=_parseFunnelJson(content);
      if(!obj||!obj.companies||!obj.companies.length){ done&&done('parse'); return; }
      var _num=function(v,max){var n=(typeof v==='number')?v:parseInt(v)||0; if(n<0)n=0; if(n>max)n=max; return n;};
      var companies=obj.companies.map(function(c,i){
        var sm=_num(c.score_match,40), sr=_num(c.score_relocate,30), ss=_num(c.score_strength,30);
        var total=sm+sr+ss; if(total>100)total=100;
        return {id:_funnelClueId(projKey, c.name, i), name:c.name||'', region:c.region||'', kind:c.kind||'', fit:c.fit||'',
          score_match:sm, score_relocate:sr, score_strength:ss, score_reason:c.score_reason||'',
          fit_score:total,
          signal:c.signal||'', expansion:c.expansion||'', faction:c.faction||'',
          listed:c.listed||'', source:c.source||'公开信息（AI推断，待核验）'};
      }).filter(function(c){return c.name;}).sort(function(a,b){
        if(b.fit_score!==a.fit_score) return b.fit_score-a.fit_score;
        var fa=(a.expansion?1:0)+(a.faction?1:0), fb=(b.expansion?1:0)+(b.faction?1:0);
        return fb-fa;
      });
      PROJECTS[projKey].funnel={ ts:Date.now(), topic:obj.topic||topic, total:(obj.total_scanned||companies.length), companies:companies, pushed:false };
      persist(); done&&done(null, PROJECTS[projKey].funnel);
    }
    if(!resp.body||!resp.body.getReader){ return resp.text().then(function(txt){ txt.split('\n').forEach(function(line){ if(line.indexOf('data:')!==0) return; var d=line.slice(5).trim(); if(d==='[DONE]'||!d) return; try{ var j=JSON.parse(d); var dt=(j.choices&&j.choices[0]&&((j.choices[0].delta&&j.choices[0].delta.content)||(j.choices[0].message&&j.choices[0].message.content)))||''; acc+=dt; }catch(_){}}); _finishFunnel(acc); }); }
    var reader=resp.body.getReader(), decoder=new TextDecoder(), buf='';
    function pump(){
      return reader.read().then(function(d){
        if(d.done){ _finishFunnel(acc); return; }
        buf+=decoder.decode(d.value,{stream:true});
        var lines=buf.split('\n'); buf=lines.pop();
        lines.forEach(function(line){
          if(line.indexOf('data:')!==0) return;
          var dd=line.slice(5).trim();
          if(dd==='[DONE]'||!dd) return;
          try{ var j=JSON.parse(dd); var delta=(j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content)||''; if(delta) acc+=delta; }catch(_){}
        });
        if(onProgress){ var pct=Math.min(90, 5+Math.round(acc.length/15000*85)); try{ onProgress(pct, acc); }catch(_){} }
        return pump();
      });
    }
    return pump();
  }).catch(function(e){ _funnelRunning[projKey]=false; done&&done(e&&e.message||'network'); });
}
function _parseFunnelJson(s){
  if(!s) return null; var t=String(s).trim();
  t=t.replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'');
  try{ return JSON.parse(t); }catch(e){}
  var a=t.indexOf('{'), b=t.lastIndexOf('}');
  if(a>=0&&b>a){ try{ return JSON.parse(t.slice(a,b+1)); }catch(e){} }
  return null;
}
/* 【2026-09-22 修复 P0】clue 身份与墓碑口径必须与政府端 index.html 完全一致。
   旧 id 'f_'+projKey+'_'+下标 跨漏斗复用：上一批删掉的企业留下的墓碑，会在下一批
   把恰好排到同一下标的新企业静默吃掉（实测诺唯赞生物 88 分被吞）。
   现在 id 由企业名派生（跨次重跑稳定），墓碑按企业名匹配，位置型旧 id 墓碑失效。 */
