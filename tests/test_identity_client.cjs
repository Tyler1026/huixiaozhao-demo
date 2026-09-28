const test = require('node:test');
const assert = require('node:assert/strict');
const {createClient} = require('../identity/client.cjs');
test('login retains CSRF only in memory and sync carries version', async () => {
  const calls=[];
  const replies=[{csrf:'test-csrf'},{PROJECTS:{},_version:2},{ok:true,_version:3},{ok:true}];
  const client=createClient(async (url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>replies.shift()};});
  await client.login('alice','synthetic-password');
  await client.load();
  await client.save({PROJECTS:{p:{city:'same'}}});
  assert.equal(calls[2].options.headers['X-CSRF-Token'],'test-csrf');
  assert.equal(JSON.parse(calls[2].options.body)._version,2);
  assert.equal(calls[2].options.credentials,'same-origin');
  await client.logout();
  await assert.rejects(client.save({}),/login required/);
});
test('failed save is not treated as success or retried silently', async () => {
  let count=0;
  const c=createClient(async()=>{count++;return count===1?{ok:true,json:async()=>({csrf:'x'})}:{ok:false,status:409,json:async()=>({error:'version conflict'})};});
  await c.login('a','synthetic');
  await assert.rejects(c.save({PROJECTS:{}}),/version conflict/);
  assert.equal(count,2);
});
test('fresh client restores session without password and receives csrf', async()=>{
  const calls=[];
  const c=createClient(async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>path==='/auth/session'?{csrf:'restored',principal:{org_id:'a'}}:{ok:true,_version:1}};});
  assert.equal((await c.resume()).org_id,'a');
  await c.save({PROJECTS:{}});
  assert.equal(calls[1].options.headers['X-CSRF-Token'],'restored');
});
test('project knowledge edits use explicit displayed version and scoped route', async()=>{
 const calls=[];const c=createClient(async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>path==='/auth/login'?{csrf:'x'}:{ok:true,version:5,kb:[]}};});
 await c.login('a','synthetic');await c.knowledge('p');await c.saveKnowledge('p',[],4);
 assert.equal(calls[2].path,'/api/projects/p/knowledge');assert.equal(JSON.parse(calls[2].options.body).version,4);
 await assert.rejects(c.report('../x'),/invalid project/);
});
test('401 clears session state', async()=>{
  let n=0;const c=createClient(async()=>++n===1?{ok:true,json:async()=>({csrf:'x'})}:{ok:false,status:401,json:async()=>({error:'unauthorized'})});
  await c.login('a','synthetic');await assert.rejects(c.load(),/unauthorized/);
  await assert.rejects(c.save({}),/login required/);
});
