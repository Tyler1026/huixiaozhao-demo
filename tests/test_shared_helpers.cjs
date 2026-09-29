const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'../frontend/shared');
function helper(name){const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,name+'.js'),'utf8'),ctx);return ctx[name];}
test('knowledge fingerprint has no browser/global-state dependency',()=>{
 const fn=helper('_kbItemFp');assert.equal(fn(null),'');assert.equal(fn(' ✅ 示例　 text '),'示例text');assert.equal(fn('x'.repeat(100)).length,80);
});
test('clue normalization preserves original null and suffix behavior',()=>{
 const fn=helper('_clueNameKey');assert.equal(fn(null),'');assert.equal(fn('企业 A（分公司）'),'企业A');assert.equal(fn('企业 A'),'企业A');
});
test('reusable ids remain narrowly matched',()=>{
 const fn=helper('_isReusableClueId');assert.equal(fn('f_city_12'),true);assert.equal(fn('normal-id'),false);assert.equal(fn(null),false);
});
test('legacy tomb key preserves string coercion',()=>{assert.equal(helper('_clueLegacyTombKey')('p',12),'p::12');});
