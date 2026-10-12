import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {servePowerampFixture,openFixturePage,reportFixtureFailure} from './helpers/poweramp-fixture.js';

const executablePath=[process.env.JARVIS_CHROME,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',chromium.executablePath()].find(p=>p&&existsSync(p));
test('Date Added information opens accessibly, closes with Back, and restores focus',{timeout:30000},async()=>{
  assert.ok(executablePath,'Chromium is required: install it or set JARVIS_CHROME');
  const fixture=await servePowerampFixture();let browser,h;
  try{
    browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});h=await openFixturePage(browser,fixture);
    const {page,library}=h;await library();
    await page.evaluate(()=>{
      PA.SET.listOptions={files:{sort:'added'}};
      for(const track of PA.Views.currentData.items)track.addedSource='r2-upload';
      const opener=document.createElement('button');opener.id='test-list-options-opener';opener.textContent='List options';opener.addEventListener('click',()=>PA.ListZoom.options(document.querySelector('#list-body .zoom-list')));document.body.append(opener);
    });
    const opener=page.locator('#test-list-options-opener');await opener.focus();await page.keyboard.press('Enter');
    const info=page.getByRole('button',{name:'Date Added information'});await info.waitFor();assert.equal(await info.getAttribute('aria-expanded'),'false');
    await info.focus();await page.keyboard.press('Enter');assert.equal(await info.getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('#date-added-info').textContent(),'R2 dates use verified upload time; original library-add dates are unavailable.');
    await page.goBack();await page.waitForFunction(()=>!PA.Sheets.open);
    assert.equal(await opener.evaluate(n=>document.activeElement===n),true,'Back closes the sheet and returns focus to its opener');
    await opener.focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Date Added information'}).waitFor();
    await page.getByRole('button',{name:'Close',exact:true}).focus();await page.keyboard.press('Enter');
    assert.equal(await opener.evaluate(n=>document.activeElement===n),true,'Close returns focus to its opener');
    assert.deepEqual(h.errors,[]);
  }catch(error){if(h)await reportFixtureFailure(h,error,'Date Added information focus regression');throw error;}
  finally{await h?.close();await browser?.close();await fixture.close();}
});
