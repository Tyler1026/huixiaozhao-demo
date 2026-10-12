'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../frontend/index/script-02-sections/12-tail.js'),'utf8');

class Element {
 constructor(tag='div',id=''){
  this.tagName=tag.toUpperCase();this.nodeName=this.tagName;this.id=id;this.children=[];this.parentElement=null;this.parentNode=null;this.listeners={};this.attrs={};this.style={};this.textContent='';this.inert=false;this.scrollTop=0;this.scrollHeight=1800;this.clientHeight=500;this.clientWidth=680;this.offsetWidth=700;this.isContentEditable=false;
  const names=new Set();this.classList={add:(...xs)=>xs.forEach(x=>names.add(x)),remove:(...xs)=>xs.forEach(x=>names.delete(x)),contains:x=>names.has(x),toggle(x,on){on=on===undefined?!names.has(x):!!on;if(on)names.add(x);else names.delete(x);return on;}};
 }
 appendChild(child){this.children.push(child);child.parentElement=child.parentNode=this;return child;}
 contains(child){for(let n=child;n;n=n.parentElement)if(n===this)return true;return false;}
 setAttribute(name,value){this.attrs[name]=String(value);if(name==='contenteditable')this.isContentEditable=value!=='false';}
 getAttribute(name){return this.attrs[name]??null;}
 matches(selector){
  return selector.split(',').some(raw=>{const s=raw.trim();if(s[0]==='#')return this.id===s.slice(1);if(s[0]==='.')return this.classList.contains(s.slice(1));if(s.startsWith('[contenteditable'))return this.isContentEditable||this.attrs.contenteditable==='true'||this.attrs.contenteditable==='';if(s.startsWith('[role='))return this.attrs.role===s.match(/=["']?([^\]"']+)/)?.[1];return this.tagName.toLowerCase()===s;});
 }
 closest(selector){for(let n=this;n;n=n.parentElement)if(n.matches(selector))return n;return null;}
 querySelector(selector){for(const child of this.children){if(child.matches(selector))return child;const nested=child.querySelector(selector);if(nested)return nested;}return null;}
 querySelectorAll(selector){let out=[];for(const child of this.children){if(child.matches(selector))out.push(child);out=out.concat(child.querySelectorAll(selector));}return out;}
 addEventListener(name,fn,options){(this.listeners[name]??=[]).push({fn,options});}
 removeEventListener(name,fn){this.listeners[name]=(this.listeners[name]||[]).filter(x=>x.fn!==fn);}
 getBoundingClientRect(){return {left:0,right:700,top:100,bottom:600,width:700,height:500};}
 setPointerCapture(){} releasePointerCapture(){}
}
function overviewFunctions(){
 const start=source.indexOf('function kbSetOverviewCollapsed('),end=source.indexOf('function kbPage(',start);
 assert.notEqual(start,-1,'overview implementation must exist');assert.ok(end>start);
 // Include adjacent overview helpers, but never duplicate the rest of the page.
 const helper=source.lastIndexOf('/*',start);return source.slice(helper>=0&&source.slice(helper,start).includes('overview')?helper:start,end);
}
function harness(){
 let now=1000;const body=new Element('body'),page=body.appendChild(new Element('section','kbWorkspace'));
 const cards=page.appendChild(new Element('div','kbOverviewCards')),cardButton=cards.appendChild(new Element('button'));
 const toggle=page.appendChild(new Element('button','kbOverviewToggle')),scroll=page.appendChild(new Element('div','kbScroll'));
 const topics=page.appendChild(new Element('aside','kbTopicsPanel')),sources=page.appendChild(new Element('aside','kbSourcesPanel'));
 const input=page.appendChild(new Element('input')),textarea=page.appendChild(new Element('textarea')),editable=page.appendChild(new Element('div'));editable.setAttribute('contenteditable','true');
 const document={body,activeElement:body,getElementById:id=>body.querySelector('#'+id),addEventListener:body.addEventListener.bind(body),removeEventListener:body.removeEventListener.bind(body)};
 const windowTarget=new Element();const DateClock=class extends Date{static now(){return now;}};
 const c={document,Date:DateClock,Math,Number,Array,Object,String,console,setTimeout:fn=>{fn();return 1;},clearTimeout(){},requestAnimationFrame:fn=>{fn();return 1;},getComputedStyle:()=>({overflowY:'auto'}),addEventListener:windowTarget.addEventListener.bind(windowTarget),removeEventListener:windowTarget.removeEventListener.bind(windowTarget)};c.window=c;
 vm.createContext(c);vm.runInContext(overviewFunctions(),c);
 cards.setAttribute('aria-hidden','false');toggle.setAttribute('aria-expanded','true');toggle.textContent='收起板块 ↑';
 function fire(type,extra={},host=page){const e={type,target:scroll,currentTarget:host,isTrusted:true,timeStamp:now,ctrlKey:false,deltaX:0,deltaY:0,deltaMode:0,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};for(const {fn}of [...(host.listeners[type]||[])])fn(e);return e;}
 c.kbBindOverviewScroll(page);
 return {c,page,cards,cardButton,toggle,scroll,topics,sources,input,textarea,editable,document,windowTarget,fire,advance:ms=>{now+=ms;},collapsed:()=>page.classList.contains('kb-overview-collapsed')};
}
function assertState(h,collapsed){assert.equal(h.collapsed(),collapsed);assert.equal(h.cards.inert,collapsed);assert.equal(h.cards.getAttribute('aria-hidden'),String(collapsed));assert.equal(h.toggle.getAttribute('aria-expanded'),String(!collapsed));assert.match(h.toggle.textContent,collapsed?/^展开板块/:/^收起板块/);}

test('overview starts expanded; manual toggle stays available and updates accessibility state',()=>{
 const h=harness();assertState(h,false);assert.equal(h.c.kbSetOverviewCollapsed(h.page,true,true),true);assertState(h,true);assert.equal(h.c.kbSetOverviewCollapsed(h.page,true,true),false);
 h.c.kbToggleOverview();assertState(h,false);h.c.kbToggleOverview();assertState(h,true);
});
test('binding twice does not multiply listeners or reduce the 48px threshold',()=>{
 const h=harness(),before=Object.fromEntries(Object.entries(h.page.listeners).map(([k,v])=>[k,v.length]));h.c.kbBindOverviewScroll(h.page);assert.deepEqual(Object.fromEntries(Object.entries(h.page.listeners).map(([k,v])=>[k,v.length])),before);
 h.fire('wheel',{deltaY:24});assertState(h,false);h.fire('wheel',{deltaY:24});assertState(h,true);
});
test('wheel follows accumulated direction, reverses to expand, and never prevents native scrolling',()=>{
 const h=harness();const first=h.fire('wheel',{deltaY:30});assert.equal(first.prevented,undefined);assertState(h,false);h.fire('wheel',{deltaY:18});assertState(h,true);
 h.fire('wheel',{deltaY:-30});assertState(h,true);h.fire('wheel',{deltaY:-18});assertState(h,false);
});
test('wheel reversals and long input gaps reset the accumulated movement',()=>{
 const h=harness();h.fire('wheel',{deltaY:30});h.fire('wheel',{deltaY:-20});h.fire('wheel',{deltaY:20});assertState(h,false);h.fire('wheel',{deltaY:28});assertState(h,true);
 h.c.kbSetOverviewCollapsed(h.page,false,true);h.advance(300);h.fire('wheel',{deltaY:30});h.advance(241);h.fire('wheel',{deltaY:30});assertState(h,false);h.fire('wheel',{deltaY:18});assertState(h,true);
});
test('pinch wheel, horizontal intent and editable fields cannot change the overview',()=>{
 const h=harness();for(const extra of [{deltaY:100,ctrlKey:true},{deltaY:80,deltaX:100},{deltaY:100,target:h.input},{deltaY:100,target:h.textarea},{deltaY:100,target:h.editable}]){h.fire('wheel',extra);assertState(h,false);}
});
test('nested source and history panel scrolling does not collapse or expand the overview',()=>{
 const h=harness();for(const parent of [h.topics,h.sources]){const nested=parent.appendChild(new Element('div'));h.fire('wheel',{deltaY:100,target:nested});assertState(h,false);h.c.kbSetOverviewCollapsed(h.page,true,true);h.fire('wheel',{deltaY:-100,target:nested});assertState(h,true);h.c.kbSetOverviewCollapsed(h.page,false,true);}
});
test('passive touch swipe collapses upward and expands downward after the threshold',()=>{
 const h=harness();for(const name of ['touchstart','touchmove','touchend']){assert.ok(h.page.listeners[name]?.length,'bind '+name);assert.ok(h.page.listeners[name].every(x=>x.options===true||x.options?.passive===true),name+' must be passive');}
 h.fire('touchmove',{touches:[{clientY:100}]});assertState(h,false);
 h.fire('touchstart',{touches:[{clientY:300}]});h.fire('touchmove',{touches:[{clientY:270}]});assertState(h,false);h.fire('touchmove',{touches:[{clientY:252}]});assertState(h,true);h.fire('touchend',{touches:[]});
 h.fire('touchstart',{touches:[{clientY:200}]});h.fire('touchmove',{touches:[{clientY:248}]});assertState(h,false);h.fire('touchend',{touches:[]});
});
test('touch editing, nested panels and multitouch gestures never change cards',()=>{
 const h=harness();for(const target of [h.input,h.textarea,h.editable,h.sources.appendChild(new Element()),h.topics.appendChild(new Element())]){h.fire('touchstart',{target,touches:[{clientY:300}]});h.fire('touchmove',{target,touches:[{clientY:100}]});h.fire('touchend',{target,touches:[]});assertState(h,false);}
 h.fire('touchstart',{touches:[{clientY:300},{clientY:330}]});h.fire('touchmove',{touches:[{clientY:100},{clientY:130}]});assertState(h,false);
});
test('keyboard navigation controls overview only from a noninteractive region',()=>{
 const h=harness();for(const key of ['PageDown','End']){h.fire('keydown',{key,target:h.scroll});assertState(h,true);h.fire('keydown',{key:'Home',target:h.scroll});assertState(h,false);}
 h.fire('keydown',{key:'ArrowDown',target:h.scroll});assertState(h,false);h.fire('keydown',{key:'ArrowDown',target:h.scroll});assertState(h,true);
 h.fire('keydown',{key:'ArrowUp',target:h.scroll});assertState(h,true);h.fire('keydown',{key:'ArrowUp',target:h.scroll});assertState(h,false);
 for(const key of ['PageUp','Home']){h.c.kbSetOverviewCollapsed(h.page,true,true);h.fire('keydown',{key,target:h.scroll});assertState(h,false);}
 for(const tag of ['button','a','select','input','textarea']){h.c.kbSetOverviewCollapsed(h.page,false,true);h.fire('keydown',{key:'PageDown',target:h.page.appendChild(new Element(tag))});assertState(h,false);}
 h.fire('keydown',{key:'PageDown',target:h.editable});assertState(h,false);
 for(const modifier of ['ctrlKey','altKey','metaKey']){h.fire('keydown',{key:'PageDown',[modifier]:true,target:h.scroll});assertState(h,false);}
});
test('focus inside a card blocks automatic hiding, while explicit manual toggle is allowed',()=>{
 const h=harness();h.document.activeElement=h.cardButton;assert.equal(h.c.kbSetOverviewCollapsed(h.page,true),false);h.fire('wheel',{deltaY:100});assertState(h,false);
 h.c.kbToggleOverview();assertState(h,true);h.c.kbToggleOverview();assertState(h,false);
 h.document.activeElement=h.scroll;h.advance(300);h.fire('wheel',{deltaY:48});assertState(h,true);
});
test('programmatic scroll or layout changes alone never hide the overview',()=>{
 const h=harness();h.scroll.scrollTop=800;h.fire('scroll',{target:h.scroll});assertState(h,false);h.page.clientHeight=300;h.scroll.scrollTop=1200;h.fire('scroll',{target:h.scroll});assertState(h,false);
 h.c.kbSetOverviewCollapsed(h.page,true,true);h.scroll.scrollTop=0;h.fire('scroll',{target:h.scroll});assertState(h,true);
});

test('native scrollbar drag responds only to primary pointer on the scrollbar edge',()=>{
 const h=harness();
 for(const extra of [{target:h.scroll,button:0,clientX:400},{target:h.scroll,button:2,clientX:699},{target:h.input,button:0,clientX:699}]){h.fire('pointerdown',extra);h.scroll.scrollTop+=60;h.fire('scroll');assertState(h,false);}
 h.fire('pointerdown',{target:h.scroll,button:0,clientX:699});h.scroll.scrollTop+=47;h.fire('scroll');assertState(h,false);h.scroll.scrollTop+=1;h.fire('scroll');assertState(h,true);
 assert.equal(h.document.body.listeners.pointerup.length,1);assert.equal(h.document.body.listeners.pointercancel.length,1);
 h.fire('pointerup',{},h.document.body);assert.equal(h.document.body.listeners.pointerup.length,0);assert.equal(h.document.body.listeners.pointercancel.length,0);
 h.advance(500);h.scroll.scrollTop=0;h.fire('scroll');assertState(h,true);
});
test('layout scroll during collapse animation resets drag anchor without reversing intent',()=>{
 const h=harness();h.fire('pointerdown',{target:h.scroll,button:0,clientX:699});h.scroll.scrollTop=48;h.fire('scroll');assertState(h,true);
 h.scroll.scrollTop=500;h.fire('scroll');assertState(h,true);h.advance(321);h.scroll.scrollTop=452;h.fire('scroll');assertState(h,false);
 h.fire('pointercancel',{},h.document.body);assert.equal(h.document.body.listeners.pointerup.length,0);assert.equal(h.document.body.listeners.pointercancel.length,0);
 h.advance(500);h.scroll.scrollTop=700;h.fire('scroll');assertState(h,false);
});
test('page native scrollbar works without observing unrelated nested scrolls',()=>{
 const h=harness();h.fire('pointerdown',{target:h.page,button:0,clientX:699});h.scroll.scrollTop=200;h.fire('scroll',{target:h.scroll});assertState(h,false);
 h.page.scrollTop=48;h.fire('scroll',{target:h.page});assertState(h,true);h.fire('pointerup',{},h.document.body);
});
test('touch horizontal intent and multi-touch interruption cannot reuse vertical movement',()=>{
 const h=harness();h.fire('touchstart',{touches:[{clientX:200,clientY:300}]});h.fire('touchmove',{touches:[{clientX:100,clientY:280}]});assertState(h,false);
 h.fire('touchmove',{touches:[{clientX:100,clientY:260},{clientX:130,clientY:260}]});h.fire('touchmove',{touches:[{clientX:100,clientY:100}]});assertState(h,false);
 h.fire('touchcancel',{touches:[]});h.fire('touchmove',{touches:[{clientX:100,clientY:0}]});assertState(h,false);
});
test('Space collapses and Shift+Space expands from the reading area',()=>{
 const h=harness();h.fire('keydown',{key:' ',target:h.scroll});assertState(h,true);
 h.fire('keydown',{key:' ',shiftKey:true,target:h.scroll});assertState(h,false);
 h.document.activeElement=h.cardButton;h.fire('keydown',{key:' ',target:h.scroll});assertState(h,false);
 h.document.activeElement=h.scroll;h.fire('keydown',{key:' ',target:h.page});assertState(h,true);
});
test('Space in inputs, editable areas or buttons keeps native interaction without toggling cards',()=>{
 const h=harness();const button=h.page.appendChild(new Element('button'));
 for(const target of [h.input,h.textarea,h.editable,button]){
  const plain=h.fire('keydown',{key:' ',target});assertState(h,false);assert.equal(plain.prevented,undefined);
  h.c.kbSetOverviewCollapsed(h.page,true,true);
  const shifted=h.fire('keydown',{key:' ',shiftKey:true,target});assertState(h,true);assert.equal(shifted.prevented,undefined);
  h.c.kbSetOverviewCollapsed(h.page,false,true);
 }
});
