const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../frontend/ops/script-03-sections/03.js'), 'utf8');
function harness({confirm=true, reject=false}={}) {
  const calls=[], messages=[];
  const context={AUTH:{user:'test-admin',scope:'admin'},setInterval(){}, confirm:()=>confirm, Date, RESET_GEN:'generation-test', toast:m=>messages.push(m), render(){}, fetch:async(url, options)=>{
    const body=JSON.parse(options.body); calls.push({url,body});
    return {json:async()=>reject||body.RESET_GEN!=='generation-test'?{ok:false,rejected:'stale-generation'}:{ok:true}};
  }};
  vm.createContext(context);vm.runInContext(source,context);
  context.REPORT_REQUESTS=[{id:'rr-test',city:'闵行区',status:'running'}];
  return {context,calls,messages};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('real cancellation includes generation so server can accept it',async()=>{
  const {context,calls,messages}=harness();context.cancelReportRequest('rr-test',{});await settle();
  assert.equal(calls.length,1);assert.equal(calls[0].body.RESET_GEN,'generation-test');
  assert.equal(calls[0].body.REPORT_REQUESTS[0].status,'cancelled');
  assert.equal(context.REPORT_REQUESTS[0].status,'cancelled');assert.ok(messages.includes('已取消该申请'));
});
test('server rejection restores original request status',async()=>{
  const {context,messages}=harness({reject:true});context.cancelReportRequest('rr-test',{});await settle();
  assert.equal(context.REPORT_REQUESTS[0].status,'running');assert.ok(messages.some(m=>m.includes('stale-generation')));
});
test('declining confirmation never sends a cancellation',async()=>{
  const {context,calls}=harness({confirm:false});context.cancelReportRequest('rr-test',{});await settle();
  assert.equal(calls.length,0);assert.equal(context.REPORT_REQUESTS[0].status,'running');
});
