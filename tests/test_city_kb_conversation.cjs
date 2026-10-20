'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'../frontend/index/script-02-sections',name+'.js'),'utf8');
const tail=read('14-tail'),auth=read('03'),layout=read('12-tail'),known=read('01');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const plain=html=>html.replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"');
class Element {
 constructor(tag='div'){this.tag=tag;this.value='';this.children=[];this.style={};this.attrs={};this.raw='';this.className='';this.listeners={};this.scrollTop=0;this.clientHeight=100;this.classList={_names:new Set(),toggle(name,force){const on=force===undefined?!this._names.has(name):!!force;if(on)this._names.add(name);else this._names.delete(name);return on;},add(name){this._names.add(name);},remove(name){this._names.delete(name);},contains(name){return this._names.has(name);}};this.scrollHeight=120;}
 set innerHTML(value){this.raw=String(value);this.children.forEach(child=>{child.parentNode=null;});this.children=[];}
 get innerHTML(){return this.raw+this.children.map(c=>c.outerHTML).join('');}
 set textContent(value){this.raw=String(value);this.children.forEach(child=>{child.parentNode=null;});this.children=[];}
 get textContent(){return plain(this.innerHTML);}
 get outerHTML(){return '<'+this.tag+' class="'+this.className+'">'+this.innerHTML+'</'+this.tag+'>';}
 appendChild(child){if(child.parentNode)child.remove();this.children.push(child);child.parentNode=this;return child;}
 insertAdjacentHTML(_where,html){this.raw+=html;}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(c=>c!==this);this.parentNode=null;}
 addEventListener(name,fn){this.listeners[name]=fn;}
 removeEventListener(name,fn){if(this.listeners[name]===fn)delete this.listeners[name];}
 setAttribute(k,v){this.attrs[k]=v;}
 getAttribute(k){return this.attrs[k];}
 focus(){this.focused=true;}
 setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;}
 querySelector(selector){
  if(selector==='.message-bubble'){
   const nested=this.children.find(c=>c.className==='message-bubble');if(nested)return nested;
   const m=this.innerHTML.match(/<div class="message-bubble">([\s\S]*)<\/div>/);return m?{innerHTML:m[1]}:null;
  }return null;
 }
 querySelectorAll(selector){
  if(!selector.includes('button'))return [];
  const patterns=[/<button\b[^>]*>[\s\S]*?<\/button>/g,/<div class="kb-answer-footer">[\s\S]*?<\/div>/g];
  return patterns.flatMap(re=>[...this.raw.matchAll(re)].map(m=>({remove:()=>{this.raw=this.raw.replace(m[0],'');}})));
 }
}
function feed(){
 const queue=[];let waiter,aborted=false;
 function deliver(value){if(waiter){const w=waiter;waiter=null;value.error?w.reject(value.error):w.resolve(value);}else queue.push(value);}
 return {push:data=>deliver({done:false,value:new TextEncoder().encode('data: '+JSON.stringify(data)+'\n\n')}),
  done:()=>{deliver({done:false,value:new TextEncoder().encode('data: [DONE]\n\n')});deliver({done:true});},
  eof:()=>deliver({done:true}),
  response:signal=>{signal?.addEventListener('abort',()=>{aborted=true;const e=new Error('aborted');e.name='AbortError';deliver({error:e});});return {ok:true,body:{getReader:()=>({read(){if(aborted)return Promise.reject(Object.assign(new Error('aborted'),{name:'AbortError'}));if(queue.length){const q=queue.shift();return q.error?Promise.reject(q.error):Promise.resolve(q);}return new Promise((resolve,reject)=>waiter={resolve,reject});},cancel:async()=>{aborted=true;}})}};}};
}
function harness(disk=new Map()){
 const nodes={};for(const id of ['kbConv','kbSourcesList','kbSourcesTitle','composerTa','kbScopeLabel','kbTopicHintBar','kbTopicHintText'])nodes[id]=new Element();
 const api=[],sync=[],feeds=[];let refreshes=0;
 let now=1700000000000,nextTimer=0;const timers=new Map();
 class TestDate extends Date {static now(){return now;}}
 const clock={pending:()=>timers.size,advance(ms){const end=now+ms;let steps=0;while(true){const due=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!due)break;assert.ok(++steps<10000,'virtual timers must make progress');now=due[1].at;timers.delete(due[0]);due[1].fn();}now=end;}};
 const c={console,JSON,Math,Date:TestDate,Promise,URL,AbortController,TextDecoder,TextEncoder,
  setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,at:now+Math.max(0,Number(ms)||0)});return id;},clearTimeout(id){timers.delete(id);},
  AUTH:{user:'ryan',scope:'user',projectKeys:['a','b'],projKey:'a'},_authState:'ready',_authEpoch:1,cur:'a',view:'knowledge',RESET_GEN:'g1',
  PROJECTS:{a:{city:'闵行',topic:'方向甲',kb:[{t:'政策',icon:'📜',known:['已核内容']}]},b:{city:'闵行',topic:'方向乙',kb:[{t:'政策',known:['另一个工作区']}]}},
  KB_CHAT_TOMBS:{},KB_FILE_CHUNKS:{},UPLOAD_TOMBS:{},_authProjectKeys(){return c.AUTH?.projectKeys||[];},_authWorkspaceOf(key){return c.AUTH?.projectKeys.includes(key)?key:null;},
  document:{body:new Element('body'),getElementById:id=>nodes[id]||null,createElement:tag=>new Element(tag),querySelectorAll:()=>[]},
  localStorage:{getItem:key=>disk.get(key)||null,setItem:(k,v)=>disk.set(k,v),removeItem:k=>disk.delete(k)},
  persist(){},aiAvatar:()=>'',curOnbPrefs:()=>({}),toast(){},renderComposer(){},closeKbDetail(){},closeKbHistory(){},render(){},saveAuth(){},_slimUploads:()=>({}),
  kbClosePanels(){c.panelsClosed=(c.panelsClosed||0)+1;},kbWorkspaceRefresh(){refreshes++;},P:()=>c.PROJECTS[c.cur],topicTags:()=>[],buildKBCorpus:()=>[{id:'candidate-only',text:'不得冒充被使用的来源'}],kbSearch:(_q,corpus)=>corpus,
  fetch(url,options){const body=JSON.parse(options.body);if(url==='/api/sync'){sync.push(body);return Promise.resolve({ok:true});}api.push(body);const f=feeds.shift();assert.ok(f,'missing response feed');return Promise.resolve(f.response(options.signal));}
 };
 c.window=c;vm.createContext(c);
 const code=[known.slice(known.indexOf('function kbValueEqual('),known.indexOf('// 判断一条known')),layout.slice(layout.indexOf('function kbDraftQuestion('),layout.indexOf('function kbTogglePanel(')),tail.slice(tail.indexOf('function kbKnownChunk('),tail.indexOf('function buildKBCorpus(')),tail.slice(tail.indexOf('function _kbChatTombKey('),tail.indexOf('function _tombKbChatSession(')),tail.slice(tail.indexOf('var KB_CHAT={};'),tail.indexOf('/* ══ KB_CHAT')),
  tail.slice(tail.indexOf('function _mergeKbChat('),tail.indexOf('/* ══ 多会话')),
  tail.slice(tail.indexOf('var KB_SESSION_IDLE_MS'),tail.indexOf('// 渲染对话区顶部')),
  tail.slice(tail.indexOf('function kbChatPush('),tail.indexOf('// 更新最后一条 AI')),
  tail.slice(tail.indexOf('function kbChatReplay('),tail.indexOf('// 招引方向派生')),
  tail.slice(tail.indexOf('var KB_API ='),tail.indexOf('/* ══ RAG ENGINE END')),
  tail.slice(tail.indexOf('function kbRefreshTopicScope('),tail.indexOf('// 真实文件选择器'))].join('\n');
 vm.runInContext(code,c);c.renderKbSessionBar=()=>{};
 c.KB_CHAT={'workspace:a':{sessions:[{id:'s1',title:'已有会话',ts:1,messages:[]},{id:'s2',title:'会话二',ts:1,messages:[]}],activeId:'s1',selectedAt:1},'workspace:b':{sessions:[{id:'sb',messages:[]}],activeId:'sb',selectedAt:1}};
 return {c,nodes,api,sync,feeds,disk,clock,refreshes:()=>refreshes};
}
function sendAnswer(f,text='已核答案'){f.push({type:'kb_sources',scope:{projectKey:'a'},sources:[{id:'used',cite:'统计公报',text:'官方片段',urls:['https://example.com/source','javascript:alert(1)','https://u:p@bad.example/']} ]});f.push({choices:[{delta:{content:text}}]});f.done();}

test('real submission sends bounded plaintext history once, serializes replies, and uses actual sources',async()=>{
 const h=harness(),c=h.c;
 c.KB_CHAT['workspace:a'].sessions[0].messages=[{role:'user',text:'<p>记住紫藤418</p>'},{role:'ai',text:'<p>已记住</p><button>假追问</button><div class="kb-answer-footer">附加说明</div>'}];
 const first=feed();h.feeds.push(first);assert.equal(c.kbSubmitQuestion('第一问'),true);await flush();
 assert.equal(c.kbSubmitQuestion('重复提交'),false);assert.equal(h.api.length,1);assert.equal(h.api[0].question,'第一问');
 assert.deepEqual(JSON.parse(JSON.stringify(h.api[0].history)),[{role:'user',content:'记住紫藤418'},{role:'assistant',content:'已记住'}]);
 sendAnswer(first,'第一答');await flush();assert.equal(c.kbIsRequestPending(),false);
 const saved=c.KB_CHAT['workspace:a'].sessions[0].messages;assert.equal(saved.length,4);assert.equal(saved[3].plainText,'第一答');assert.doesNotMatch(saved[3].text,/kb-answer-followups|优先补链的核心环节|各园区如何分工承接/);
 assert.deepEqual(Array.from(saved[3].sources[0].urls),['https://example.com/source']);assert.match(h.nodes.kbSourcesList.innerHTML,/统计公报/);assert.doesNotMatch(h.nodes.kbSourcesList.innerHTML,/candidate-only|javascript:|bad.example/);
 const second=feed();h.feeds.push(second);c.kbSubmitQuestion('再问');await flush();assert.equal(h.api[1].history.at(-1).content,'第一答');sendAnswer(second,'第二答');await flush();assert.equal(saved.length,6);
});
test('history is at most eight messages and 8000 characters, never current question or system roles',()=>{
 const h=harness();const messages=Array.from({length:18},(_,i)=>({role:i%2?'ai':'user',plainText:String(i).repeat(2000)}));
 messages.push({role:'ingest-actions',text:'不要发送按钮'},{role:'user',plainText:'这次问题'});
 const history=h.c.kbHistory({messages},'这次问题',true);
 assert.ok(history.length<=8);assert.ok(history.reduce((n,m)=>n+m.content.length,0)<=8000);assert.ok(history.every(m=>m.content.length<=1500));assert.ok(history.every(m=>!m.content.includes('这次问题')&&!m.content.includes('按钮')));
});
for(const change of ['session','project','logout'])test('late stream cannot render or save after '+change,async()=>{
 const h=harness(),c=h.c,f=feed();h.feeds.push(f);c.kbSubmitQuestion('原会话问题');await flush();
 const original=c.KB_CHAT['workspace:a'].sessions[0];
 if(change==='session')c.kbSwitchSession('s2');
 if(change==='project'){c.cur='b';c.kbChatReplay();}
 if(change==='logout'){c.kbResetChatRequests();c.AUTH=null;c._authEpoch++;c._authState='anonymous';h.nodes.kbConv.innerHTML='';}
 sendAnswer(f,'不应该显示的晚到答案');await flush();
 assert.equal(original.messages.filter(m=>m.role==='ai').length,0);assert.doesNotMatch(h.nodes.kbConv.innerHTML,/不应该显示/);assert.doesNotMatch(h.nodes.kbSourcesList.innerHTML,/官方片段/);
});
test('switch back and successful next request is independent of aborted request',async()=>{
 const h=harness(),c=h.c,a=feed();h.feeds.push(a);c.kbSubmitQuestion('中断问题');await flush();c.kbSwitchSession('s2');c.kbSwitchSession('s1');
 const b=feed();h.feeds.push(b);assert.equal(c.kbSubmitQuestion('新问题'),true);await flush();sendAnswer(b,'新的答复');await flush();
 assert.equal(c.KB_CHAT['workspace:a'].sessions[0].messages.at(-1).plainText,'新的答复');
});
test('premature EOF is an error rather than a stored successful answer',async()=>{
 const h=harness(),f=feed();h.feeds.push(f);h.c.kbSubmitQuestion('问题');await flush();f.push({choices:[{delta:{content:'不完整'}}]});f.eof();await flush();
 const last=h.c.KB_CHAT['workspace:a'].sessions[0].messages.at(-1);assert.equal(last.error,true);assert.equal(h.c.kbIsRequestPending(),false);assert.match(h.nodes.kbConv.innerHTML,/未完整返回/);
});
test('source events for a different project fail closed',async()=>{
 const h=harness(),f=feed();h.feeds.push(f);h.c.kbSubmitQuestion('问题');await flush();f.push({type:'kb_sources',scope:{projectKey:'b'},sources:[{text:'不属于这里'}]});f.done();await flush();
 assert.doesNotMatch(h.nodes.kbSourcesList.innerHTML,/不属于这里/);assert.equal(h.c.KB_CHAT['workspace:a'].sessions[0].messages.at(-1).error,true);
});
test('topic action only fills an editable question; send and clear respect session scope',async()=>{
 const h=harness(),c=h.c;c.askAboutKb(0);
 assert.equal(h.api.length,0);assert.equal(c.KB_CHAT['workspace:a'].sessions[0].messages.length,0);assert.match(h.nodes.composerTa.value,/政策/);assert.equal(h.nodes.composerTa.focused,true);assert.equal(c.kbScopeTitle(),'政策');
 const f=feed();h.feeds.push(f);c.kbSubmitQuestion('我的编辑问题');await flush();assert.equal(h.api[0].question,'我的编辑问题');assert.equal(h.api[0].topic,'政策');sendAnswer(f);await flush();
 c.kbSwitchSession('s2');assert.equal(c.kbScopeTitle(),'全库问答');c.kbSwitchSession('s1');assert.equal(c.kbScopeTitle(),'政策');c.clearKbActiveTopic();assert.equal(c.kbScopeTitle(),'全库问答');
});
test('selection survives an immediate fresh page from only authorized same-user cache',()=>{
 const h=harness();h.c.kbSwitchSession('s2');assert.equal(h.sync.at(-1).KB_CHAT['workspace:a'].activeId,'s2');
 const fresh=harness(h.disk);assert.equal(fresh.c.kbSessionStore('a').activeId,'s2');fresh.c.AUTH.user='different';fresh.c.KB_CHAT['workspace:a'].activeId='s1';fresh.c.KB_CHAT['workspace:a'].selectedAt=1;assert.equal(fresh.c.kbSessionStore('a').activeId,'s1');
 assert.equal(fresh.c.kbChatKey('unauthorized'),null);
});
test('client merge keeps newest selection independently from longest transcript and ignores tombstones',()=>{
 const h=harness(),c=h.c;const old={'workspace:a':{sessions:[{id:'s1',messages:[{text:'长记录'}]},{id:'s2',messages:[]}],activeId:'s1',selectedAt:10}};
 const current={'workspace:a':{sessions:[{id:'s2',messages:[]}],activeId:'s2',selectedAt:20}};
 const merged=c._mergeKbChat(old,current);assert.equal(merged['workspace:a'].activeId,'s2');assert.equal(merged['workspace:a'].sessions[0].messages[0].text,'长记录');
 assert.equal(c._mergeKbChat(old,merged)['workspace:a'].activeId,'s2');c.KB_CHAT_TOMBS['workspace:a::s2']=21;assert.equal(c._mergeKbChat(old,merged)['workspace:a'].activeId,'s1');
});
test('source pane replays only selected session sources',async()=>{
 const h=harness(),f=feed();h.feeds.push(f);h.c.kbSubmitQuestion('问题');await flush();sendAnswer(f);await flush();assert.match(h.nodes.kbSourcesList.innerHTML,/统计公报/);
 h.c.kbSwitchSession('s2');assert.doesNotMatch(h.nodes.kbSourcesList.innerHTML,/统计公报/);h.c.kbSwitchSession('s1');assert.match(h.nodes.kbSourcesList.innerHTML,/统计公报/);
});


test('real auth reset aborts pending reply and user change clears selection-only cache',async()=>{
 const h=harness(),c=h.c,f=feed();h.feeds.push(f);c.kbSwitchSession('s2');c.kbSubmitQuestion('私有问题');await flush();
 vm.runInContext(auth.slice(auth.indexOf('function _authResetView('),auth.indexOf('function _authJson(')),c);
 c._authAccept({user:'other',projectKeys:['b'],projKey:'b'});
 assert.equal(h.disk.has(c.KB_SELECTION_KEY),false);assert.equal(Object.keys(c._kbRequests).length,0);
 sendAnswer(f,'不得泄漏给另一个账号');await flush();assert.deepEqual(Object.keys(c.KB_CHAT),[]);
 c._authForget();assert.equal(c.AUTH,null);assert.equal(c._authState,'anonymous');
});
test('rerender during the same request attaches its continuing answer to current DOM',async()=>{
 const h=harness(),f=feed();h.feeds.push(f);h.c.kbSubmitQuestion('问题');await flush();
 f.push({choices:[{delta:{content:'第一段'}}]});await flush();
 const old=h.nodes.kbConv;h.nodes.kbConv=new Element();h.c.kbChatReplay();f.push({choices:[{delta:{content:'第二段'}}]});f.done();await flush();
 assert.match(h.nodes.kbConv.innerHTML,/第一段第二段/);assert.equal(h.c.KB_CHAT['workspace:a'].sessions[0].messages.at(-1).plainText,'第一段第二段');
});
test('structured chunks and topic pins retain only their own source metadata',async()=>{
 const h=harness(),c=h.c;
 c.PROJECTS.a.kb[0].known=[{text:'政策原文',sources:[{url:'https://official.example/one'}],urls:['https://official.example/two'],source:'部门',quote:'摘录'}];
 const ck=c.kbKnownChunk(c.PROJECTS.a.kb[0].known[0],'政策',0);assert.equal(ck.text,'政策原文');assert.equal(ck.source,'部门');assert.equal(ck.quote,'摘录');assert.equal(ck.urls[0],'https://official.example/two');
 const plain=c.kbKnownChunk('普通片段','产业',1);assert.equal(plain.sources,undefined);assert.equal(plain.urls,undefined);
 const f=feed();h.feeds.push(f);c.askAboutKb(0);c.kbSubmitQuestion('问政策');await flush();
 const pinned=h.api[0].chunks.find(x=>x.id==='pin:0');assert.equal(pinned.text,'政策原文');assert.deepEqual(pinned.sources,[{url:'https://official.example/one'}]);sendAnswer(f);await flush();
});
test('malformed source members are ignored and source markup stays escaped',()=>{
 const h=harness(),safe=h.c.kbSafeSources([null,false,{cite:'<script>x</script>',text:'<img onerror=x>',urls:['data:text/html,x','https://official.example/path']}]);
 assert.equal(safe.length,1);const html=h.c.kbSourcesHtml(safe);assert.doesNotMatch(html,/<script>|<img |data:text/);assert.match(html,/&lt;script&gt;/);
});

test('real global render aborts a request during rapid project change and return',async()=>{
 const h=harness(),c=h.c,f=feed();h.feeds.push(f);c.kbSubmitQuestion('原项目问题');await flush();
 vm.runInContext(read('05'),c);c._verifyInProgress=true;c.cur='b';c.render();c.cur='a';c.render();
 sendAnswer(f,'快速返回也不应保存');await flush();assert.equal(c.KB_CHAT['workspace:a'].sessions[0].messages.length,1);assert.equal(c.kbIsRequestPending(),false);
});
test('empty chat and legacy answer show different evidence guidance; source controls survive replay',()=>{
 const h=harness(),c=h.c;c.kbChatReplay();assert.match(h.nodes.kbSourcesList.innerHTML,/发送问题后/);
 c.KB_CHAT['workspace:a'].sessions[0].messages=[{role:'ai',text:'以前的回答'}];c.kbChatReplay();assert.match(h.nodes.kbSourcesList.innerHTML,/历史回答未保留来源/);
 c.KB_CHAT['workspace:a'].sessions[0].messages=[{id:'answer1',role:'ai',text:'回答',sources:[{id:'s',text:'引用',urls:[]}]}];c.kbChatReplay();assert.match(h.nodes.kbConv.innerHTML,/kbOpenAnswerSources/);
});
for(const name of ['kbVerifyMaterial','kbIncrementalAnalysis'])test('legacy '+name+' drops a late answer after switching session',async()=>{
 const h=harness(),c=h.c,f=feed();h.feeds.push(f);
 c.document.querySelector=()=>null;c._kbText=x=>typeof x==='string'?x:x.text;c._lastIngestChunks=[{text:'GDP 100亿元'}];c._lastIngestTopicLabel='政策';c._lastIngestKbIdx=0;
 const end=name==='kbVerifyMaterial'?'/* ── 校验发现矛盾后':'/* 新要点追加面板';
 vm.runInContext(tail.slice(tail.indexOf('function '+name+'(){'),tail.indexOf(end,tail.indexOf('function '+name+'(){'))),c);
 c[name]();await flush();assert.equal(c.kbIsRequestPending(),true);assert.equal(h.api.length,1);assert.equal(h.api[0].projectKey,'a');
 c.kbSwitchSession('s2');sendAnswer(f,'旧材料不得进入新会话');await flush();
 assert.equal(c.KB_CHAT['workspace:a'].sessions[0].messages.filter(m=>m.role==='ai').length,0);assert.equal(c.KB_CHAT['workspace:a'].sessions[1].messages.length,0);assert.equal(c.kbIsRequestPending(),false);
});

test('opening answer evidence always ensures visibility instead of toggling it off',()=>{
 const h=harness(),c=h.c;let opens=0,toggles=0;
 c.KB_CHAT['workspace:a'].sessions[0].messages=[{id:'a1',role:'ai',text:'答复',sources:[{text:'原文',urls:[]}]}];
 c.kbShowSourcesPanel=()=>{opens++;};c.kbTogglePanel=()=>{toggles++;};c.kbOpenAnswerSources('a1');c.kbOpenAnswerSources('a1');
 assert.equal(opens,2);assert.equal(toggles,0);assert.match(h.nodes.kbSourcesList.innerHTML,/原文/);
 const classes=new Set(['kb-sources-open']);h.nodes.kbWorkspace={classList:{add:n=>classes.add(n),remove:n=>classes.delete(n)}};delete c.kbShowSourcesPanel;
 c.kbOpenAnswerSources('a1');c.kbOpenAnswerSources('a1');assert.equal(classes.has('kb-sources-open'),true);assert.equal(toggles,0);
 classes.add('kb-sources-hidden');c.matchMedia=()=>({matches:true});c.kbOpenAnswerSources('a1');assert.equal(classes.has('kb-sources-hidden'),false);
});

test('topic drafting preserves existing writing, closes the mobile panel and focuses composer',()=>{
 const h=harness(),c=h.c;h.nodes.composerTa.value='先分析融资约束';c.askAboutKb(0);
 assert.match(h.nodes.composerTa.value,/^先分析融资约束\n/);assert.match(h.nodes.composerTa.value,/政策/);
 assert.equal(c.panelsClosed,1);assert.equal(h.nodes.composerTa.focused,true);assert.equal(h.nodes.composerTa.selectionEnd,h.nodes.composerTa.value.length);assert.equal(h.api.length,0);
});

test('selected topic uses the active class styled by the workspace and clears it',()=>{
 const h=harness(),c=h.c,classes=new Set(),card=new Element();card.attrs['data-kb-topic']='0';card.classList={toggle:(name,on)=>on?classes.add(name):classes.delete(name)};
 c.document.querySelectorAll=()=>[card];c.setKbActiveTopic(0,c.PROJECTS.a.kb[0]);assert.equal(classes.has('active'),true);assert.equal(card.attrs['aria-pressed'],'true');
 c.clearKbActiveTopic();assert.equal(classes.has('active'),false);assert.equal(card.attrs['aria-pressed'],'false');
});

test('new send and stream use the scroll viewport, pause on upward reading, and resume at bottom',async()=>{
 const h=harness(),c=h.c,f=feed();h.nodes.kbScroll=new Element();const viewport=h.nodes.kbScroll;viewport.scrollHeight=1200;viewport.scrollTop=0;viewport.clientHeight=300;
 h.feeds.push(f);c.kbSubmitQuestion('长会话继续');await flush();assert.equal(viewport.scrollTop,1200);assert.equal(h.nodes.kbConv.scrollTop,0);
 f.push({choices:[{delta:{content:'第一段'}}]});await flush();assert.equal(viewport.scrollTop,1200);
 viewport.scrollTop=150;viewport.listeners.scroll();f.push({choices:[{delta:{content:'第二段'}}]});await flush();assert.equal(viewport.scrollTop,150);
 viewport.scrollTop=900;viewport.listeners.scroll();f.push({choices:[{delta:{content:'第三段'}}]});await flush();assert.equal(viewport.scrollTop,1200);
 f.done();await flush();assert.equal(viewport.listeners.scroll,undefined);
});
test('switching a saved session scrolls its actual viewport to the current conversation',()=>{
 const h=harness();h.nodes.kbScroll=new Element();h.nodes.kbScroll.scrollHeight=1500;h.nodes.kbScroll.scrollTop=0;
 h.c.KB_CHAT['workspace:a'].sessions[1].messages=[{role:'user',text:'长的旧记录'}];h.c.kbSwitchSession('s2');assert.equal(h.nodes.kbScroll.scrollTop,1500);
});

test('reset scope in an empty selected session retains its session and editable draft',()=>{
 const h=harness(),c=h.c,input=h.nodes.composerTa;
 c.setKbActiveTopic(0,c.PROJECTS.a.kb[0]);input.value='尚未发送的政策问题';input.focus();input.setSelectionRange(3,6);
 const active=c.KB_CHAT['workspace:a'].activeId,selection=c.KB_CHAT['workspace:a'].selectedAt,count=c.KB_CHAT['workspace:a'].sessions.length;
 c.clearKbActiveTopic();
 assert.equal(c.kbScopeTitle(),'全库问答');assert.equal(h.nodes.kbScopeLabel.textContent,'全库问答');assert.equal(c.KB_CHAT['workspace:a'].activeId,active);assert.equal(c.KB_CHAT['workspace:a'].selectedAt,selection);assert.equal(c.KB_CHAT['workspace:a'].sessions.length,count);
 assert.equal(input.value,'尚未发送的政策问题');assert.equal(input.selectionStart,3);assert.equal(input.selectionEnd,6);assert.equal(input.focused,true);assert.equal(h.api.length,0);
});

const pendingRequest=h=>Object.values(h.c._kbRequests)[0];
const transcript=h=>h.c.KB_CHAT['workspace:a'].sessions[0].messages;

test('progress is visible before response headers and elapsed time never invents a completed stage',async()=>{
 const h=harness(),f=feed(),response=f.response;let release;
 f.response=signal=>new Promise(resolve=>{release=()=>resolve(response(signal));});
 h.feeds.push(f);h.c.kbSubmitQuestion('等待服务的问题');
 const ctx=pendingRequest(h),progress=ctx.progress;
 assert.ok(progress);assert.equal(progress.node.parentNode,h.nodes.kbConv);assert.equal(progress.phase,1);
 assert.match(progress.title.textContent,/连接|等待/);assert.equal(h.clock.pending(),1);
 h.clock.advance(32000);
 assert.match(progress.time.textContent,/32 秒/);assert.match(progress.note.textContent,/较长|等待|停止/);
 assert.equal(progress.phase,1);assert.equal(progress.steps[2].className,'');assert.equal(transcript(h).length,1);
 release();await flush();sendAnswer(f);await flush();assert.equal(h.clock.pending(),0);assert.equal(ctx.progress,null);
});

test('progress follows real source, search and content events without exposing model reasoning',async()=>{
 const h=harness(),f=feed();h.feeds.push(f);h.c.kbSubmitQuestion('依据是什么');await flush();
 const ctx=pendingRequest(h),progress=ctx.progress;
 f.push({type:'kb_sources',scope:{projectKey:'a'},sources:[{id:'one',text:'材料甲'},{id:'two',text:'材料乙'}]});await flush();
 assert.match(progress.note.textContent,/2\s*条/);assert.equal(progress.phase,1);
 f.push({choices:[{delta:{reasoning_content:'[searching]'}}]});await flush();
 assert.match(progress.title.textContent,/检索公开资料/);assert.equal(progress.phase,1);
 const privateReasoning='PRIVATE_REASONING_SHOULD_NEVER_BE_VISIBLE';
 f.push({choices:[{delta:{reasoning_content:privateReasoning}}]});await flush();
 assert.doesNotMatch(h.nodes.kbConv.innerHTML,new RegExp(privateReasoning));
 f.push({choices:[{delta:{content:'实际回答第一句'}}]});await flush();
 assert.equal(progress.phase,2);assert.equal(ctx.outputText,'实际回答第一句');assert.match(h.nodes.kbConv.innerHTML,/实际回答第一句/);
 assert.equal(progress.steps[2].getAttribute('aria-current'),'step');
 h.clock.advance(1000);assert.match(progress.time.textContent,/已用时/);
 f.done();await flush();assert.equal(h.clock.pending(),0);
 assert.doesNotMatch(JSON.stringify(transcript(h)),new RegExp(privateReasoning+'|kb-request-progress|已等待'));
 assert.equal(transcript(h).at(-1).plainText,'实际回答第一句');
});

test('zero source result does not claim successful web search without a search event',async()=>{
 const h=harness(),f=feed();h.feeds.push(f);h.c.kbSubmitQuestion('缺少材料');await flush();
 const ctx=pendingRequest(h);f.push({type:'kb_sources',scope:{projectKey:'a'},sources:[]});await flush();
 assert.match(ctx.progress.note.textContent,/未命中|未检索|未匹配|未返回|没有/);
 assert.doesNotMatch(ctx.progress.title.textContent+ctx.progress.note.textContent,/已完成联网|联网检索完成|已查阅\s*0\s*条/);
 h.clock.advance(60000);assert.equal(ctx.progress.phase,1);
 f.push({choices:[{delta:{content:'需要更多材料'}}]});f.done();await flush();assert.equal(h.clock.pending(),0);
});

test('successful answer removes progress and its timer from the UI and saved conversation',async()=>{
 const h=harness(),f=feed();h.feeds.push(f);h.c.kbSubmitQuestion('完成的问题');await flush();
 const ctx=pendingRequest(h),node=ctx.progress.node;sendAnswer(f,'完整答复');await flush();
 assert.equal(h.c.kbIsRequestPending(),false);assert.equal(ctx.progress,null);assert.equal(node.parentNode,null);assert.equal(h.clock.pending(),0);
 assert.doesNotMatch(h.nodes.kbConv.innerHTML,/kb-progress-message|停止生成/);
 assert.equal(transcript(h).at(-1).plainText,'完整答复');assert.doesNotMatch(JSON.stringify(transcript(h)),/kb-request-progress|已等待/);
});

for(const ending of ['server error','premature EOF'])test('progress is cleaned up after '+ending+' and the answer remains retryable',async()=>{
 const h=harness(),f=feed();h.feeds.push(f);h.c.kbSubmitQuestion('需要重试的问题');await flush();
 const ctx=pendingRequest(h),node=ctx.progress.node;
 if(ending==='server error')f.push({error:{message:'RAW_PROVIDER_SECRET'}});else{f.push({choices:[{delta:{content:'不完整的正文'}}]});f.eof();}
 await flush();assert.equal(h.c.kbIsRequestPending(),false);assert.equal(h.clock.pending(),0);assert.equal(ctx.progress,null);assert.equal(node.parentNode,null);
 const last=transcript(h).at(-1);assert.equal(last.error,true);assert.equal(last.plainText,'');assert.match(last.text,/重新提问/);assert.doesNotMatch(last.text,/RAW_PROVIDER_SECRET/);
 assert.doesNotMatch(h.nodes.kbConv.innerHTML,/kb-progress-message/);
});

for(const change of ['session','project','logout'])test('progress timer and node are removed immediately after '+change,async()=>{
 const h=harness(),f=feed();h.feeds.push(f);h.c.kbSubmitQuestion('旧请求');await flush();
 const ctx=pendingRequest(h),node=ctx.progress.node;
 if(change==='session')h.c.kbSwitchSession('s2');
 if(change==='project'){h.c.cur='b';h.c.kbChatReplay();}
 if(change==='logout'){h.c.kbResetChatRequests();h.c.AUTH=null;h.c._authEpoch++;h.c._authState='anonymous';h.nodes.kbConv.innerHTML='';}
 assert.equal(h.clock.pending(),0);assert.equal(ctx.progress,null);assert.equal(node.parentNode,null);assert.equal(ctx.controller.signal.aborted,true);
 h.clock.advance(60000);sendAnswer(f,'晚到内容');await flush();assert.doesNotMatch(h.nodes.kbConv.innerHTML,/晚到内容|kb-progress-message/);
});

test('same-session replay keeps the live progress card and partial answer attached exactly once',async()=>{
 const h=harness(),f=feed();h.feeds.push(f);h.c.kbSubmitQuestion('重绘的问题');await flush();
 const ctx=pendingRequest(h),progressNode=ctx.progress.node;
 h.nodes.kbConv=new Element();h.c.kbChatReplay();assert.equal(progressNode.parentNode,h.nodes.kbConv);
 assert.equal(h.nodes.kbConv.children.filter(n=>n===progressNode).length,1);
 f.push({choices:[{delta:{content:'尚未完成的正文'}}]});await flush();
 h.nodes.kbConv=new Element();h.c.kbChatReplay();assert.equal(progressNode.parentNode,h.nodes.kbConv);assert.equal(ctx.answerNode.parentNode,h.nodes.kbConv);
 assert.match(h.nodes.kbConv.innerHTML,/尚未完成的正文/);assert.equal(h.clock.pending(),1);
 h.c.kbChatReplay();assert.equal(h.nodes.kbConv.children.filter(n=>n===progressNode).length,1);
 f.done();await flush();assert.equal(h.clock.pending(),0);assert.equal(transcript(h).at(-1).plainText,'尚未完成的正文');
});

for(const partial of [false,true])test('stopping '+(partial?'a partial answer':'before any content')+' records an incomplete result and allows retry',async()=>{
 const h=harness(),f=feed();h.feeds.push(f);h.c.kbSubmitQuestion('原问题 <原文>');await flush();
 const ctx=pendingRequest(h);if(partial){f.push({choices:[{delta:{content:'已收到的一部分'}}]});await flush();}
 h.c.kbStopAnswer(ctx.requestId);
 assert.equal(h.c.kbIsRequestPending(),false);assert.equal(h.clock.pending(),0);assert.equal(ctx.controller.signal.aborted,true);assert.equal(ctx.progress,null);
 assert.match(h.nodes.kbConv.innerHTML,/已停止生成/);assert.match(h.nodes.kbConv.innerHTML,/重新提问/);
 if(partial)assert.match(h.nodes.kbConv.innerHTML,/已收到的一部分|未完成/);
 const stopped=transcript(h).at(-1);assert.equal(stopped.error,true);assert.equal(stopped.plainText,'');assert.equal(transcript(h).length,2);
 await flush();assert.equal(transcript(h).length,2);
 const next=feed();h.feeds.push(next);const retry=new Element('button');retry.setAttribute('data-kb-query','原问题 <原文>');
 assert.equal(h.c.kbRetryQuestion(retry),true);await flush();assert.equal(h.api.at(-1).question,'原问题 <原文>');
 assert.ok(h.api.at(-1).history.every(m=>!m.content.includes('已停止生成')&&!m.content.includes('已收到的一部分')));
 h.c.kbStopAnswer(ctx.requestId);assert.equal(h.c.kbIsRequestPending(),true);assert.equal(h.clock.pending(),1);
 sendAnswer(next,'重试完成');await flush();assert.equal(h.clock.pending(),0);assert.equal(transcript(h).at(-1).plainText,'重试完成');
});

test('elapsed-time updates do not scroll away from earlier conversation the user is reading',async()=>{
 const h=harness(),f=feed();h.nodes.kbScroll=new Element();h.nodes.kbScroll.scrollHeight=2000;h.nodes.kbScroll.clientHeight=400;
 h.feeds.push(f);h.c.kbSubmitQuestion('长等待');await flush();
 h.nodes.kbScroll.scrollTop=200;h.nodes.kbScroll.listeners.scroll();h.clock.advance(35000);
 assert.equal(h.nodes.kbScroll.scrollTop,200);assert.equal(pendingRequest(h).followScroll,false);
 f.push({choices:[{delta:{reasoning_content:'[searching]'}}]});await flush();assert.equal(h.nodes.kbScroll.scrollTop,200);
 sendAnswer(f);await flush();assert.equal(h.clock.pending(),0);
});

test('stop before response headers cleans up immediately and late connection cannot revive it',async()=>{
 const h=harness(),f=feed(),response=f.response;let release;
 f.response=signal=>new Promise(resolve=>{release=()=>resolve(response(signal));});
 h.feeds.push(f);h.c.kbSubmitQuestion('连接期间停止');const ctx=pendingRequest(h);
 h.c.kbStopAnswer(ctx.requestId);
 assert.equal(ctx.controller.signal.aborted,true);assert.equal(h.clock.pending(),0);assert.equal(h.c.kbIsRequestPending(),false);
 assert.equal(transcript(h).length,2);assert.equal(transcript(h).at(-1).error,true);
 release();await flush();sendAnswer(f,'旧连接迟到的答案');await flush();
 assert.equal(transcript(h).length,2);assert.doesNotMatch(h.nodes.kbConv.innerHTML,/旧连接迟到的答案|kb-progress-message/);
});
