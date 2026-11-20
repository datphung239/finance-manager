import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const browserPath = process.env.CHROME_BIN;
assert.ok(browserPath, 'Chrome binary is required');
const browser=await chromium.launch({headless:true,executablePath:browserPath,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:390,height:844},locale:'vi-VN'});
const warnings=[];
const financeCalls=[];
page.on('pageerror',e=>warnings.push(e.message));
page.on('request',req=>{if(/script\.google\.com|accounts\.google\.com|script\.googleusercontent\.com/.test(req.url()))financeCalls.push(req.url());});
try{
  await page.goto('http://127.0.0.1:8788/',{waitUntil:'domcontentloaded'});
  await page.locator('#app-container').waitFor({state:'visible',timeout:15000});
  assert.equal(await page.locator('#auth-section').isVisible(),false,'Google Sign-In must stay hidden');
  assert.equal(await page.locator('#demoBadge').isVisible(),true,'demo disclaimer must be visible');
  const content=await page.locator('#rustBenchResult').textContent();
  assert.match(content,/Chưa đo/);
  await page.locator('#rustBenchCount').selectOption('1000');
  await page.locator('#runRustBench').click();
  await page.waitForFunction(()=>{
    const text=document.querySelector('#rustBenchResult')?.textContent||'';
    return text.includes('Đối chiếu:')||text.includes('Không thể đo Rust/WASM');
  },null,{timeout:45000});
  const result=(await page.locator('#rustBenchResult').textContent()).trim();
  assert.ok(result.includes('Đối chiếu:'),'Rust benchmark failed: '+result);
  assert.ok(result.includes('Rust/WASM'),'missing wasm timing: '+result);
  assert.equal(financeCalls.length,0,'public demo called a Google financial backend: '+financeCalls.join(','));
  assert.deepEqual(warnings,[],'JS uncaught errors: '+warnings.join('\n'));
  await page.screenshot({path:'demo-smoke.png',fullPage:true});
  console.log('PASS Chromium mobile: demo opened without auth; Rust/WASM benchmark executed; parity confirmed.');
  console.log('Benchmark output:',result);
}finally{await browser.close();}
