'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,gate,modelStarted}=require('./chain_v2_fixture.cjs');
test('update button immediately acknowledges click and restores after server commit',async()=>{
  const e=setup('index'),g=gate(),attrs={};e.setModelGate(g);
  const button={textContent:'更新图谱并评价',disabled:false,setAttribute:(k,v)=>attrs[k]=v,removeAttribute:k=>delete attrs[k]};
  const work=e.c.requestChainGeneration(button);
  assert.equal(button.disabled,true);assert.match(button.textContent,/正在更新/);assert.equal(attrs['aria-busy'],'true');
  await modelStarted(e);
  assert.equal(await e.c.requestChainGeneration(),false);
  assert.equal(e.events.models,1);
  g.resolve();assert.equal(await work,true);
  assert.equal(button.disabled,false);assert.equal(button.textContent,'更新图谱并评价');assert.equal(attrs['aria-busy'],undefined);
});
test('failed update releases button for retry',async()=>{
  const e=setup('index');e.setSyncFailure(true);
  const button={textContent:'更新图谱并评价',setAttribute(){},removeAttribute(){}};
  assert.equal(await e.c.requestChainGeneration(button),false);
  assert.equal(button.disabled,false);assert.equal(button.textContent,'更新图谱并评价');
});
