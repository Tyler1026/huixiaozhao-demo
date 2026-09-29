/* ===== 通用弹窗（复用雷总 .modal 类）===== */
function openModal(title,bodyHtml,footHtml){
  var l=document.createElement('div');l.className='modal-layer';l.id='modalLayer';
  l.onclick=function(e){if(e.target===l)closeModal()};
  l.innerHTML='<div class="modal"><header><h2>'+title+'</h2><button onclick="closeModal()"><i class="i">✕</i></button></header>'+
    '<div class="modal-body">'+bodyHtml+'</div>'+(footHtml?('<footer>'+footHtml+'</footer>'):'')+'</div>';
  document.body.appendChild(l);
}
function closeModal(){
  window._verifyInProgress=false;var l=$('#modalLayer');if(l)l.remove();var cm=$('#conflictModal');if(cm)cm.remove();}
var NAV=[['knowledge','📚','城市智库','完善材料·产业/园区/企业/政策'],['report','📝','产业分析','产业分析·可来回优化'],['home','🤝','招商对接','项目列表·对接进度'],['settings','⚙️','设置','账号与提醒']];

function render(){
  // 跳过重渲染：用户正在查看校验结果或冲突面板时不重建DOM
  if(window._verifyInProgress || document.getElementById('conflictModal')) return;
  // 报告生成中且当前在report view时不重建DOM（保护流式输出的reportContent）
  // 切到其他view不阻塞；revealReport完成后会主动调render()
  if(window._reportGenerating && view==='report') return;
  // ── 登录门禁：未登录 → 登录页 ──
  if(location.search.indexOf('demo')<0 && !AUTH){
    var _r=document.getElementById('root');
    if(_r){ _r.innerHTML=(view==='register')?registerPage():loginPage(); }
    return;
  }
  // ── 登录后按账号权威定城市（只执行一次，之后允许自由切换）──
  if(AUTH && !render._routed){
    render._routed=true;
    if(!render._restored){ render._restored=true; try{restore();}catch(e){} }
    // 必须先从服务器拉取数据，阻止本地seed覆盖
    if(!render._serverSynced){
      render._serverSynced=true;
      // 显示加载状态
      var _r=document.getElementById('root');
      if(_r) _r.innerHTML='<div style="height:100vh;display:flex;align-items:center;justify-content:center;font-size:15px;color:#667590">正在同步数据…</div>';
      restoreFromServer(function(ok){
        if(ok){
          // 服务器有数据，直接使用
          if(AUTH.resident){
            // 常驻=随州账号：强制落到随州项目，忽略服务器残留的其他城市 cur（如上海）
            var _isSz=function(k){return PROJECTS[k]&&PROJECTS[k].city&&PROJECTS[k].city.indexOf('随州')>=0;};
            // 常驻账号始终落到数据最全的 sz 主项目(避免落到空白随州派生项目导致'信息丢失'错觉)
            // 常驻账号：选数据最多的随州项目（避免落到空白项目）
            var _szKeys=Object.keys(PROJECTS).filter(_isSz);
            if(_szKeys.length){
              _szKeys.sort(function(a,b){
                var ka=PROJECTS[a].kb||[], kb2=PROJECTS[b].kb||[];
                var ca=0,cb=0; ka.forEach(function(t){ca+=(t.known||[]).length;}); kb2.forEach(function(t){cb+=(t.known||[]).length;});
                return cb-ca; // 数据多的排前面
              });
              cur=_szKeys[0];
            } else { cur=null; }
            // 随州数据被清空(无任何随州项目)时，走空白 onboarding，让常驻账号也从零重跑，不自动重建预置数据
            if(!cur){ view='setup'; }
            else { view=view||'knowledge'; /* 不再默认解锁随州：产业分析/招商对接保持上锁，待智库达标或手动解锁 */ }
          } else {
            // 非常驻账号：优先落到账号绑定的 projKey（推送RAG时写入，权威口径，避免账号city与项目city措辞不一致导致串城/建空项目）
            var _ac=AUTH.city||'';
            if(AUTH.projKey && PROJECTS[AUTH.projKey]){
              cur=AUTH.projKey; view='knowledge';
            } else if(AUTH.projKey && reviveProjectShell(AUTH.projKey,_ac)){
              // 【2026-09-17】绑定的项目壳丢了但报告数据还在 -> 自愈重建，绝不建空壳覆盖
              cur=AUTH.projKey; view='knowledge'; persist();
            } else {
              // 无绑定项目时才按城市匹配；城市匹配同时兼容"账号city含项目city或项目city含账号city"（如账号=上海市、项目=松江区）
              var _mine=Object.keys(PROJECTS).filter(function(k){
                var pc=PROJECTS[k]&&PROJECTS[k].city||'';
                return pc && _ac && (pc===_ac || pc.indexOf(_ac)>=0 || _ac.indexOf(pc)>=0);
              });
              if(_mine.length){ if(!cur || _mine.indexOf(cur)<0){ cur=_mine[0]; } view='knowledge'; }
              else if(_ac){ cur=autoProvisionCity(_ac); view='knowledge'; /* 新城市不预解锁：产业分析/招商对接保持上锁，待智库完成度达80%或手动强制解锁 */ persist(); }
              else { cur=null; view='setup'; }
            }
          }
        } else {
          // 服务器无数据，本地初始化
          if(AUTH.resident){ cur=null; view='setup'; /* 随州清空后不再自动重建预置，走空白 onboarding 从零重跑 */ }
          else { if(AUTH.projKey&&PROJECTS[AUTH.projKey]){cur=AUTH.projKey;view='knowledge';}else if(AUTH.projKey&&reviveProjectShell(AUTH.projKey,AUTH.city)){cur=AUTH.projKey;view='knowledge';persist();}else{cur=null;view='setup';} }
        }
        render();
      });
      return; // 等待服务器响应，不继续渲染
    }
  }

  // 尝试从 localStorage 恢复（非 ?demo 模式）
  if(location.search.indexOf('demo')<0&&!render._restored){
    render._restored=true;
    var _hasLocal = restore();
    // 防止 cur 指向空项目：如果当前项目无 kb 数据但有其他有数据的项目，切过去
    if(cur && PROJECTS[cur]){
      var _curKbCount=(PROJECTS[cur].kb||[]).reduce(function(s,t){return s+(t.known||[]).length;},0);
      if(_curKbCount===0){
        var _allKeys=Object.keys(PROJECTS);
        var _best=null,_bestC=0;
        _allKeys.forEach(function(k){var c=0;(PROJECTS[k].kb||[]).forEach(function(t){c+=(t.known||[]).length;});if(c>_bestC){_bestC=c;_best=k;}});
        if(_best&&_bestC>0) cur=_best;
      }
    }
    // 无论本地是否有数据，都从服务器拉取最新状态（保证多端同步）
    if(!render._serverSynced){
      render._serverSynced=true;
      restoreFromServer(function(ok){
        if(ok){
          // 服务器数据覆盖本地后，确保cur指向数据最多的随州项目（防落空项目）
          var _szK2=Object.keys(PROJECTS).filter(function(k){return PROJECTS[k]&&PROJECTS[k].city&&PROJECTS[k].city.indexOf('随州')>=0;});
          if(_szK2.length){
            _szK2.sort(function(a,b){var ca=0,cb=0;(PROJECTS[a].kb||[]).forEach(function(t){ca+=(t.known||[]).length;});(PROJECTS[b].kb||[]).forEach(function(t){cb+=(t.known||[]).length;});return cb-ca;});
            if(!cur||!PROJECTS[cur]||(PROJECTS[cur].kb||[]).reduce(function(s,t){return s+(t.known||[]).length;},0)===0) cur=_szK2[0];
          }
          render();
        }
      });
    }
    if(_hasLocal){ render(); return; }
  }
  // ?demo 模式：先尝试从 localStorage 恢复已有数据（管理端可能已写入）
  if(location.search.indexOf('demo')>=0&&!cur){
    // 如果 localStorage 已有项目数据，直接 restore 而不新建 demo
    if(!render._restored){
      render._restored=true;
      var _raw=localStorage.getItem(LS_KEY);
      if(_raw){
        try{
          var _data=JSON.parse(_raw);
          if(_data.PROJECTS&&Object.keys(_data.PROJECTS).length>0){
            restore();
            /* 不再默认解锁：与正式流程一致，产业分析/招商对接默认上锁 */
            return render();
          }
        }catch(e){}
      }
    }
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
      text:'',
      topic:'',
      ts: Date.now(),
      score: 0,
      phase: 1
    };
    _dk_proj.stage=1;  // 推进到「确认需求」阶段
  }}
  }
  // ── 城市隔离护栏（每次渲染都生效）──────────────────────────────
  // 全局 /api/sync 是单块存储，服务端返回的顶层 cur/view 恒为主账号(随州)的值。
  // 非随州账号绝不信任该 cur：强制把 cur 钉回本账号城市的项目，杜绝串到随州。
  if(AUTH && !AUTH.resident && (AUTH.city||AUTH.projKey) && role!=='ops'){
    var _gc=AUTH.city||'';
    // 城市匹配兼容"账号city与项目city措辞不一致"（如账号=上海市、项目=松江区）
    var _cityMatch=function(k){
      var pc=PROJECTS[k]&&PROJECTS[k].city||'';
      return pc && _gc && (pc===_gc || pc.indexOf(_gc)>=0 || _gc.indexOf(pc)>=0);
    };
    var _mineKeys=Object.keys(PROJECTS).filter(_cityMatch);
    // 账号绑定的 projKey 优先视为合法；否则按（兼容）城市匹配判断 cur 是否属于本账号
    var _boundOk=AUTH.projKey && cur===AUTH.projKey && PROJECTS[cur];
    var _curOk=_boundOk || (cur&&PROJECTS[cur]&&_cityMatch(cur));
    if(!_curOk){
      if(AUTH.projKey && PROJECTS[AUTH.projKey]){ cur=AUTH.projKey; }
      else if(AUTH.projKey && reviveProjectShell(AUTH.projKey,_gc)){ cur=AUTH.projKey; }
      else if(_mineKeys.length){ cur=_mineKeys[0]; }
      else if(_gc){ cur=autoProvisionCity(_gc); }
      // 串城时 view 也可能停在随州的 report；本项目无报告则回落到智库，避免展示随州报告空壳
      if(view==='report' && !(cur&&REPORTSTATE[cur]&&REPORTSTATE[cur].text)) view='knowledge';
      persist();
    }
  }
  if(view==='setup'||!cur||!PROJECTS[cur]){var _root=$('#root');if(_root){_root.innerHTML='<div style="height:100vh;background:#f5f7fb">'+setupPage()+'</div>';bind();} return;}
  if(role==='ops')return renderOps();
  var p=P();
  // 修复方向/报告错位：报告正文必须跟随当前方向 topic。刷新后缓存里 REPORTSTATE[cur].topic(旧方向)
  // 与 PROJECTS[cur].topic(当前方向) 可能不一致，导致标题显示当前方向、正文却是旧方向的报告。
  if(cur && REPORTSTATE[cur] && p.topic && REPORTSTATE[cur].topic!==p.topic){
    var _syncTxt=getTopicReport(p.topic);
    REPORTSTATE[cur].topic=p.topic;
    if(_syncTxt){
      REPORTSTATE[cur].text=_syncTxt;
    }else{
      // 当前方向无预埋报告(如自定义/新能源配套)：清空旧报告正文，避免标题(当前)与正文(旧方向)错位
      REPORTSTATE[cur].text='';
    }
    // 后台从 RAG 库生成该方向的真实 AI 报告（预埋文本先占位，AI 就绪后替换）
    ensureAiReport(p.topic, p.city);
    // 同根因连带修复：可立项招引方向卡片(actionItemsByTopic)历史脏缓存可能存了旧方向的招引方向，
    // 导致切换方向后仍显示旧方向的 TOP3(如香菇方向却显示燃料电池电堆)。此处按当前方向实时重解析覆盖。
    var _items=parseActionItems(_syncTxt||REPORTSTATE[cur].text||'');
    if(_items.length){
      if(!REPORTSTATE[cur].actionItemsByTopic) REPORTSTATE[cur].actionItemsByTopic={};
      REPORTSTATE[cur].actionItemsByTopic[p.topic]=_items;
    }
  }
  // 重建 DOM 前：记录当前滚动位置（供"原地重渲染"后还原，避免阅读时弹回顶部）
  // 注意：必须用"本次重建前"刚捕获的位置来还原（_captureScroll 会写入 _scrollMemory），
  // 而不是上一轮的旧值，否则跨标签同步/异步 render 会把滚动错误还原到过时位置或顶部。
  _captureScroll();
  var _prevScrollKey=_scrollMemory.key, _prevScrollTops=_scrollMemory.tops;
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
  if(cur && REPORT_HISTORY[cur]) { var _rha=document.getElementById('reportHistoryArea'); if(_rha) renderHistoryReports(cur); }
  // 城市智库对话：render 重建了 #kbConv，把已存的历史对话回放回去（切主题/切模块/刷新都不丢）
  if(view==='knowledge'){ setTimeout(kbChatReplay, 50); }
  // 重建 DOM 后：若仍停留在同一 view+cur（原地重渲染），还原滚动位置，避免阅读时弹回顶部
  _restoreScroll(_prevScrollKey, _prevScrollTops);
  // 兜底：kbChatReplay 可能在 800ms+ 后 reset scrollTop；仅知识库视图需要长延时再恢复。
  // 报告视图不注册长延时，防止用户刚开始下拉就被强制拉回顶部（"拖住"感根因）。
  if(view==='knowledge'){
    var _fk=_prevScrollKey,_ft=_prevScrollTops;
    [1200,2000].forEach(function(ms){setTimeout(function(){_restoreScroll(_fk,_ft);},ms);});
  }
}
/* 顶栏角色切换按钮（政府端 ⇄ 运营端）*/

