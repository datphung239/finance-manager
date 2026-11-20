import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const executablePath=process.env.CHROME_BIN;
assert.ok(executablePath,'Chrome executable required for browser smoke');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:390,height:844},locale:'vi-VN'});
const app={
  user:{email:'qa-local@example.invalid'},
  accounts:[], categories:[], counterparties:[], transactions:[], debts:[],
  bank_inbox:[], balances:[],
  totals:{income_vnd:0,expense_vnd:0,card_charge_vnd:0,card_payment_vnd:0}
};
const errors=[];const external=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',req=>{
  if(/script\.google|googleusercontent|accounts\.google/i.test(req.url()))external.push(req.url());
});
page.route('**/api/**',async route=>{
  const req=route.request();
  const path=new URL(req.url()).pathname;
  let body={};
  try { body=req.postDataJSON()||{}; }catch{}
  let result={ok:true};
  if(path==='/api/bootstrap') result={ok:true,...app};
  else if(path==='/api/accounts' && req.method()==='POST'){
    const account={id:'account-'+(app.accounts.length+1),name:body.name,kind:body.kind,opening_balance_vnd:0};
    app.accounts.push(account);
    app.balances.push({...account,balance_vnd:0});
    result={ok:true,id:account.id};
  }else if(path==='/api/categories' && req.method()==='POST'){
    const item={id:'category-'+(app.categories.length+1),name:body.name,kind:body.kind};
    app.categories.push(item);result={ok:true,id:item.id};
  }else if(path==='/api/bank-inbox/preview' && req.method()==='POST'){
    result={ok:true,candidate:{amount_vnd:1250000,flow:'credit'},requires_confirmation:true};
  }else if(path==='/api/transactions' && req.method()==='POST'){
    const item={...body,id:'tx-'+(app.transactions.length+1),source:'manual'};
    app.transactions.unshift(item);
    if(item.kind==='income')app.totals.income_vnd+=item.amount_vnd;
    if(item.kind==='expense')app.totals.expense_vnd+=item.amount_vnd;
    result={ok:true,id:item.id};
  }else{
    result={ok:false,error:'No mock endpoint for '+path};
  }
  await route.fulfill({status:result.ok?200:404,contentType:'application/json',body:JSON.stringify(result)});
});
try{
  await page.goto('http://127.0.0.1:8788/',{waitUntil:'domcontentloaded'});
  await page.locator('.fm-brand').waitFor({timeout:15000});
  await page.getByText('Dữ liệu mới nhất từ D1').waitFor({timeout:12000});
  assert.equal(await page.locator('.fm-nav button').count(),4);
  await page.locator('#new-account-name').fill('Ngân hàng Smoke Test');
  await page.locator('#new-account-kind').selectOption('bank');
  await page.locator('[data-action="new-account"]').click();
  await page.getByText('Ngân hàng Smoke Test',{exact:true}).waitFor({timeout:12000});
  await page.locator('#new-category-name').fill('Chi thử nghiệm');
  await page.locator('#new-category-kind').selectOption('expense');
  await page.locator('[data-action="new-category"]').click();
  await page.locator('#tx-category').locator('option',{hasText:'Chi thử nghiệm'}).waitFor({timeout:12000});
  await page.locator('#tx-amount').fill('150000');
  await page.locator('#tx-account').selectOption('account-1');
  await page.locator('#tx-category').selectOption('category-1');
  await page.locator('[data-action="save-tx"]').click();
  await page.getByText('150.000 đ',{exact:false}).waitFor({timeout:12000});
  await page.locator('[data-tab="cards"]').click();
  await page.getByText('CHI TIÊU THẺ').waitFor();
  await page.locator('[data-tab="debts"]').click();
  await page.getByText('Công nợ phải thu').first().waitFor();
  await page.locator('[data-tab="bank"]').click();
  await page.locator('#bank-text').fill('TK ghi có Số tiền: 1.250.000 VND');
  await page.locator('[data-action="preview-bank"]').click();
  await page.locator('#bank-preview').getByText('1.250.000 đ',{exact:false}).waitFor({timeout:12000});
  await page.screenshot({path:'next/v2-browser-smoke.png',fullPage:true});
  assert.deepEqual(errors,[],'Uncaught JS errors: '+errors.join('; '));
  assert.deepEqual(external,[],'Legacy Google backend/auth request detected');
  console.log('PASS: Rust/WASM UI, responsive nav, D1 mock read/write, bank preview, no Google auth/Sheets');
}finally{await browser.close();}
