'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=part=>fs.readFileSync(path.join(root,part),'utf8');
function between(source,start,end){
  const from=source.indexOf(start),to=source.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,'production boundaries: '+start);
  return source.slice(from,to);
}
const known=read('frontend/index/script-02-sections/01.js');
const readiness=read('frontend/index/script-02-sections/09.js');
const tail=read('frontend/index/script-02-sections/12-tail.js');
function project(counts=[27,0,0,0]){
  return {city:'测试城市',topic:'测试方向',kb:['主导产业','空间承载','企业生态','政策配套'].map((t,section)=>({t,known:Array.from({length:counts[section]},(_,i)=>({text:t+'原始材料第'+i+'项，保留完整的统计范围与来源条件。',origin:'report'}))}))};
}
function note(sectionIndex,text,extra={}){
  return {id:'note',sectionIndex,sectionTitle:['主导产业','空间承载','企业生态','政策配套'][sectionIndex],sourceIndex:null,sourceItem:null,baseReportVersion:null,text,revision:1,ts:1,account:'tester',status:'edited',...extra};
}
function harness(p=project()){
  const nodes=new Map([['kbProgressBox',{innerHTML:''}],['kbPageProgress',{innerHTML:''}]]),modals=[],effects=[];
  const c={console,Math,Number,String,Object,Array,JSON,cur:'city-a',PROJECTS:{'city-a':p},KB_EDITS:{},KB_CONFIRMS:{},KB_FILE_CHUNKS:{},KB_UNLOCKED:{},UPLOADS:{'city-a':[]},REPORTSTATE:{},PENDING_CONFIRMS:{},_aiTopicsGenerating:{},
    P(){return c.PROJECTS[c.cur];},document:{getElementById:id=>nodes.get(id)||null},window:null,
    setTimeout(){effects.push('timer');},fetch(){throw new Error('readiness rendering must not fetch');},
    industryAnalysisWorkspaceKey:key=>key,openModal(...args){modals.push(args);},visibleClues:()=>[],
    reportJobForTopic:()=>null,ensureAiTopics(){effects.push('existing topic callback');},generateTopicsFromKb:()=>[],
    reportRunBanner:()=>'',reportBottomBarInner:()=>'',render(){effects.push('render');},
  };
  c.window=c;vm.createContext(c);
  vm.runInContext([
    read('frontend/shared/kb-materials.js'),between(known,'function _kbText(','// === AI精选概括'),
    between(tail,'function hasRealKbData(p){','var _aiTopicsGenerating'),
    between(readiness,'function kbReadiness(){','/* 按研判方向计算置信度'),
    between(readiness,'function isLocked(v){','function unlockView(v){'),
    between(readiness,'function kbPageProgressInner(r){','function sidebar(){'),
    between(read('frontend/index/script-02-sections/10.js'),'function go(v){','function bind(){'),
    between(tail,'function homePage(p){','/* 底部行动栏内容')
  ].join('\n'),c);
  return {c,nodes,modals,effects,p};
}
const visible=html=>html.replace(/<[^>]*>/g,' ').replace(/&middot;/g,'·').replace(/\s+/g,' ').trim();

test('actual sidebar and page refresh show one populated section, not 100 percent coverage',()=>{
  const h=harness();h.c.UPLOADS['city-a']=[{name:'原始材料'}];
  h.c.KB_EDITS['city-a']={note:note(0,'人工补充说明，仍只属于主导产业板块。')};
  const before=JSON.stringify(h.p),r=h.c.kbReadiness();assert.equal(r.score,100);assert.equal(r.rawScore,100);
  h.c.refreshKbProgress();
  for(const id of ['kbProgressBox','kbPageProgress']){
    const text=visible(h.nodes.get(id).innerHTML);
    assert.match(text,/材料量评分\s*100分/);assert.match(text,/有材料板块\s*1\/4/);
    assert.doesNotMatch(text,/100%|覆盖充分|材料覆盖/);
    assert.match(text,/事实仍需逐项核验/);
  }
  assert.equal(JSON.stringify(h.p),before);assert.deepEqual(h.effects,[]);
});

test('populated section count uses effective rows including valid notes, not uploads or other city edits',()=>{
  const h=harness(project([0,0,0,0]));h.c.UPLOADS['city-a']=[{name:'尚未映射到板块的上传'}];
  h.c.KB_EDITS['city-a']={note:note(1,'当前城市的独立补充材料，具有完整说明。'),deleted:note(2,'已删除补充不能构成有材料板块。',{id:'deleted',deleted:true})};
  h.c.KB_EDITS['city-b']={note:note(3,'另一城市的材料不能进入当前城市计数。')};
  h.p.kb[0].known=['请在此输入补充内容','主导产业',''];
  let text=visible(h.c.kbProgressInner());assert.match(text,/有材料板块\s*1\/4/);
  h.c.PROJECTS['city-b']=project([0,0,0,0]);h.c.cur='city-b';h.c.UPLOADS['city-b']=[];
  text=visible(h.c.kbProgressInner());assert.match(text,/有材料板块\s*1\/4/);
  h.c.cur='city-a';h.c.KB_EDITS['city-a'].note.deleted=true;
  assert.match(visible(h.c.kbProgressInner()),/有材料板块\s*0\/4/);
});

test('empty and fully populated projects preserve existing score and do not assert fact correctness',()=>{
  for(const [counts,expected,score] of [[[0,0,0,0],0,0],[[5,5,5,5],4,100]]){
    const h=harness(project(counts)),r=h.c.kbReadiness();assert.equal(r.score,score);
    assert.match(visible(h.c.kbPageProgressInner(r)),new RegExp('有材料板块\\s*'+expected+'/4'));
    assert.match(visible(h.c.kbPageProgressInner(r)),/事实仍需逐项核验/);
  }
});

test('pending confirmations, raw score gate and override remain unchanged by presentation',()=>{
  const h=harness();h.c.UPLOADS['city-a']=[{name:'原件'}, {name:'另一原件'}];
  h.p.kb[0].known[0].text='⚠️ 本条数据的适用范围仍需要实际核验。';
  const r=h.c.kbReadiness(),before=JSON.stringify(r);assert.equal(r.score,79);assert.equal(r.rawScore,100);assert.equal(r.pendingWarn,1);
  assert.equal(h.c.isLocked('report'),false);
  const text=visible(h.c.kbPageProgressInner(r));assert.match(text,/1 条待确认/);assert.match(text,/有材料板块\s*1\/4/);assert.doesNotMatch(text,/差 1|% 自动解锁/);
  assert.equal(JSON.stringify(h.c.kbReadiness()),before);
  h.c.PROJECTS['city-a']=project([0,0,0,0]);h.c.UPLOADS['city-a']=[];assert.equal(h.c.isLocked('report'),true);
  h.c.KB_UNLOCKED['city-a']={report:true};assert.equal(h.c.isLocked('report'),false);
});

test('actual locked navigation uses score points and section count while retaining its explicit override',()=>{
  const h=harness(project([2,0,0,0]));assert.equal(h.c.isLocked('report'),true);
  h.c.go('report');assert.equal(h.modals.length,1);const [title,body,foot]=h.modals[0];
  assert.match(title,/AI 匹配研判/);assert.match(visible(body),/材料量评分/);assert.match(visible(body),/80分/);assert.match(visible(body),/有材料板块\s*1\/4/);
  assert.doesNotMatch(visible(body),/80%|完成度|可靠性越高/);assert.match(foot,/unlockView\('report'\)/);
  assert.match(visible(foot),/手动解锁（仍需核验事实）/);assert.doesNotMatch(visible(foot),/可靠性较低/);
  assert.equal(h.effects.length,0);assert.equal(h.c.KB_UNLOCKED['city-a'],undefined);
});

test('actual analysis page separates city material score from fact quality and does not change generation callbacks',()=>{
  const h=harness();h.c.UPLOADS['city-a']=[{name:'原件'}];
  const html=h.c.homePage(h.p),banner=html.match(/<div class="industry-readiness"[\s\S]*?<\/div>\s*<div id="industryRunHost">/)[0];
  assert.match(visible(banner),/材料量评分\s*100分/);assert.match(visible(banner),/有材料板块\s*1\/4/);assert.doesNotMatch(visible(banner),/100%|覆盖充分/);
  assert.deepEqual(h.effects,['existing topic callback','timer']);
});

test('legacy navigation subtitle agrees with the shared progress renderer for any city',()=>{
  const h=harness();h.c.UPLOADS['city-a']=[{name:'原件'}];
  h.c.NAV=[['knowledge','','城市智库',''],['report','','AI 匹配研判','']];h.c.view='knowledge';
  vm.runInContext(between(readiness,'function sidebar(){','function progressFooter('),h.c);
  const html=h.c.sidebar(),text=visible(html);
  assert.match(text,/材料量评分 100分 · 有材料板块 1\/4/);assert.doesNotMatch(text,/100%|覆盖充分/);
  h.c.cur='city-b';h.c.PROJECTS['city-b']=project([2,2,2,2]);h.c.UPLOADS['city-b']=[];
  const next=visible(h.c.sidebar());assert.match(next,/材料量评分 52分 · 有材料板块 4\/4/);assert.doesNotMatch(next,/有材料板块 1\/4/);
});
