// Finances must never reach a production API from the public demo.
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const code=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
assert.match(code,/const DEMO_MODE = true;/);
assert.match(code,/if \(DEMO_MODE\) return Promise\.resolve\(demoSendRequest\(action, payload\)\);/);
assert.doesNotMatch(html,/src="https:\/\/accounts\.google\.com\/gsi\/client"/);
assert.match(html,/DEMO KHÔNG ĐĂNG NHẬP/);
let called=0;
const context={
  window:{fmPerformance:{},addEventListener(){}},localStorage:{getItem(){called++;return null;},setItem(){called++;},removeItem(){called++;}},
  document:{addEventListener(){},currentScript:{src:'https://demo.invalid/app.js'}},
  location:{href:'https://demo.invalid/'},URL,TextDecoder,TextEncoder,
  Date,Math,Number,String,Map,Set,Promise,Array,JSON,console,setTimeout,clearTimeout,
};
vm.createContext(context);
vm.runInContext(code,context);
assert.equal(vm.runInContext('DEMO_MODE',context),true);
assert.equal(vm.runInContext("storageGet('google_id_token')",context),null);
vm.runInContext("storageSet('secret','nothing')",context);
assert.equal(called,0);
async function run(){
  const initial=await vm.runInContext("sendRequest('getInitialData')",context);
  assert.equal(initial.cards.length,2);
  const before=await vm.runInContext("sendRequest('getRecentTransactions',{type:'cash_spending'})",context);
  assert.equal(before.length,3);
  const created=await vm.runInContext("sendRequest('mutateTransaction',{operation:'save',type:'cash_spending',formObject:{amount:'100000',category:'CP-Mẫu'}})",context);
  assert.equal(created.transactions.length,4);
  const after=await vm.runInContext("sendRequest('getRecentTransactions',{type:'cash_spending'})",context);
  assert.equal(after.length,4);
  console.log('PASS: offline demo skips Google SDK, localStorage and real financial API');
}
run().catch(e=>{console.error(e);process.exitCode=1});
