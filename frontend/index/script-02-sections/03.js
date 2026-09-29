/* ===== 运营端（周总·全局）：跨城市需求池 ===== */
var DEMANDS=[];
/* 目标企业库（管理端录入，跨端同步供政府端产业链图谱关联展示） */
var OPS_ENT=OPS_ENT||[];





var RES_COLOR={matched:{bg:'#e4f5f3',c:'#006d70'},checking:{bg:'#ebf3fd',c:'#013582'},none:{bg:'#fff0de',c:'#a34c09'}};

var role='gov';   // 政府端固定，ops端在 localhost:5051
var cur=null,view='setup',detailOpen=false,detailData=null,curKb=null,curDemand=null,curSub=null;

/* ═══ 全局滚动位置记忆：整页 render() 会用 innerHTML 重建 DOM，导致滚动容器 scrollTop 归零。
   下面这套机制在重渲染前记录各滚动容器位置，重渲染后——仅当仍停留在同一 view+cur（即"原地重渲染"，
   如后台 AI 报告生成完成、跨标签数据同步、确认/撤回等操作触发的 render）——把滚动位置还原，
   避免用户正在往下阅读时莫名弹回顶部；若 view/cur 发生变化（用户主动切模块/切项目）则不还原、正常回到顶部。 ═══ */
var _SCROLL_SELECTORS='.report-scroll,.clues-scroll,.knowledge-scroll,.conversation-scroll,.docking-scroll,.settings-scroll,.detail-scroll';
var _scrollMemory={key:null,tops:null};
// 用户真实滚动时间戳；_captureMs 记录本次 capture 时刻
// restore 的 apply 只跳过 capture 之后产生的新滚动（说明用户在新DOM上主动操作了）
var _lastUserScrollMs=0;
var _scrollCaptureMs=0;
document.addEventListener('scroll',function(){_lastUserScrollMs=Date.now();},true);
function _captureScroll(){
  var tops={};
  _scrollCaptureMs=Date.now();
  try{
    document.querySelectorAll(_SCROLL_SELECTORS).forEach(function(el,i){
      // 用 class + 序号做键，重建后按同样规则匹配还原
      var cls=(el.className||'').split(/\s+/)[0]||'sc';
      tops[cls+'#'+i]=el.scrollTop;
    });
  }catch(e){}
  _scrollMemory={key:view+'::'+cur, tops:tops};
}
function _restoreScroll(prevKey, tops){
  // 仅当重渲染后仍是同一 view+cur 才还原（否则说明用户切了模块/项目，应停在顶部）
  if(!tops || prevKey!==(view+'::'+cur)) return;
  // 是否有任何需要还原的非零位置；全为 0 则无需处理（避免无谓循环）
  var _has=false; for(var _k in tops){ if(tops[_k]>0){ _has=true; break; } }
  if(!_has) return;
  var apply=function(){
    // capture之后用户在新DOM上主动滚动了：让用户掌控位置，不强行覆盖
    if(_lastUserScrollMs > _scrollCaptureMs) return;
    try{
      document.querySelectorAll(_SCROLL_SELECTORS).forEach(function(el,i){
        var cls=(el.className||'').split(/\s+/)[0]||'sc';
        var v=tops[cls+'#'+i];
        if(v!=null && v>0) el.scrollTop=v;
      });
    }catch(e){}
  };
  apply();
  if(window.requestAnimationFrame) requestAnimationFrame(apply);
  // 300ms内用户尚未开始滚动，足以应对异步重排归零；500/800ms已无必要。
  [30,80,160,300].forEach(function(ms){ setTimeout(apply, ms); });
}

/* AUTH: 当前登录态 {user,city,projKey,resident,who,org}；null=未登录 */
var AUTH=null;
var ACCOUNTS={
  'suizhou': {pwd:'suizhou', city:'随州', projKey:'sz', resident:true,  who:'张主任', org:'随州市招商局'},
  'admin':   {pwd:'admin',   city:null,  projKey:null, resident:false, who:'招商干部', org:'招商局'}
};
var USER_PROFILES={};  // 注册用户资料库，按账号存 {name,phone,wechat,org,dept,title,city,pwd,ts}，跨端同步供管理端查看
var CITY_ACCOUNTS={};  // 城市账号连接表（推送到RAG时自动建立）{slug:{city,who,org,pwd,resident,projKey}}
function saveAuth(){ try{ AUTH?localStorage.setItem('hxz_auth',JSON.stringify(AUTH)):localStorage.removeItem('hxz_auth'); }catch(e){} }
function loadAuth(){ try{ var d=localStorage.getItem('hxz_auth'); if(d)AUTH=JSON.parse(d); }catch(e){ AUTH=null; } }
function logout(){ AUTH=null; saveAuth(); cur=null; view='setup'; render._restored=false; render._routed=false; render(); }
loadAuth();
// 报告版本迭代状态（每项目一份）：{ver, finalized, patches:[补充意见], edits:{结论index:新文字}}
var REPORTSTATE={};
function rs(){var k=cur;if(!REPORTSTATE[k])REPORTSTATE[k]={ver:1,finalized:false,patches:[],edits:{}};return REPORTSTATE[k];}
function P(){return cur&&PROJECTS[cur]||{}}
/* 政府端账号按城市独立：返回当前登录城市（cur所在城市）的项目key列表 */
function cityKeys(){
  var mc=(cur&&PROJECTS[cur]&&PROJECTS[cur].city)?PROJECTS[cur].city:null;
  return Object.keys(PROJECTS).filter(function(k){return !mc||(PROJECTS[k]&&PROJECTS[k].city===mc);});
}
