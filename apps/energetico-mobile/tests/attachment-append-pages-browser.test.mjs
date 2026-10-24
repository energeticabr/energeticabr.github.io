import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';
import { withAttachmentBrowser } from './helpers/attachment-browser-driver.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));

test('tray + menu fits 320/390 px and desktop; files, photo-to-PDF and scan append without loose attachments or chat replies',{timeout:120000},async t=>{
  if(!browser)return t.skip('Chrome unavailable');
  const server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
  try{
    await server.listen();
    for(const [width,height,base,mode,pages] of [[320,740,'pdf','menu',2],[390,844,'pdf','files',4],[390,844,'image','files',3],[1365,768,'pdf','camera',4]]){
      const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attachment-append-pages.html?base=${base}&mode=${mode}`});
      const dom=new JSDOM(stdout),result=JSON.parse(dom.window.document.documentElement.dataset.layout||'{}');dom.window.close();
      assert.equal(result.error,undefined,JSON.stringify(result));
      assert.equal(result.pages,pages); assert.equal(result.tray,1);
      assert.equal(result.type,'application/pdf');assert.equal(result.replacements,mode==='menu'?0:1);
      assert.equal(result.sentFile,0);assert.equal(result.networkWrites,0);
      assert.equal(result.unchangedQuestion,true);assert.equal(result.unchangedDraft,true);assert.equal(result.noReply,true);
      assert.equal(result.overflow,false);assert.equal(result.menuOverflow,false);
      assert.ok(result.controls.every(control=>control.width>=44&&control.height>=44),JSON.stringify(result.controls));
    }
  }finally{await server.close();}
});

test('real touch opens the file chooser and appends pages only after server confirmation', {timeout:60000}, async t => {
  if(!browser) return t.skip('Chrome unavailable');
  const server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
  try {
    await server.listen();
    await withAttachmentBrowser(browser, {}, async driver => {
      await driver.navigate(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attachment-append-pages.html?manual=1&browser-picker=1&hold-confirmation=1`);
      await driver.wait('window.attachmentAppendFixture');
      await driver.tap('[data-preview-action="append-pages"]');
      await driver.tap('[data-preview-action="append-files"]');
      const picker = await driver.evaluate(`(() => {
        const input = document.querySelector('input[type="file"]');
        return { exists: !!input, originalOpen: document.querySelector('.attachment-preview-dialog').matches(':modal'),
          ...attachmentAppendFixture.snapshot() };
      })()`);
      assert.equal(picker.pickerCalls, 1);
      assert.equal(picker.exists, true);
      assert.equal(driver.events.filter(event => event.method === 'Page.fileChooserOpened').length, 1, JSON.stringify(picker));
      assert.equal(picker.originalOpen, true);
      assert.equal(picker.replacements, 0);
      assert.deepEqual(picker.interactions.filter(event => event.capture).map(event => [event.action, event.trusted]),
        [['append-pages', true], ['append-files', true]]);
      await driver.evaluate('attachmentAppendFixture.selectFiles()');
      await driver.wait('attachmentAppendFixture.snapshot().replacementRequests === 1');
      assert.equal((await driver.evaluate('attachmentAppendFixture.snapshot()')).attachments[0].id, 'a'.repeat(64));
      assert.equal(await driver.evaluate('attachmentAppendFixture.pageCount()'), 2);
      await driver.evaluate('attachmentAppendFixture.confirmReplacement()');
      await driver.wait('attachmentAppendFixture.snapshot().replacements === 1');
      assert.equal(await driver.evaluate('attachmentAppendFixture.pageCount()'), 4);
      const final = await driver.evaluate('attachmentAppendFixture.snapshot()');
      assert.equal(final.attachments.length, 1);
      assert.equal(final.attachments[0].id, 'b'.repeat(64));
      assert.equal(final.pendingFiles, 0);
      assert.equal(final.unchangedQuestion && final.unchangedDraft && final.noReply, true);
      assert.equal(final.sentFile + final.networkWrites, 0);
    });
  } finally { await server.close(); }
});

test('real touch opens photo/scan above the preview and cancellation restores the original', {timeout:60000}, async t => {
  if(!browser) return t.skip('Chrome unavailable');
  const server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
  try {
    await server.listen();
    await withAttachmentBrowser(browser, {}, async driver => {
      await driver.navigate(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attachment-append-pages.html?manual=1&browser-picker=1`);
      await driver.wait('window.attachmentAppendFixture');
      await driver.tap('[data-preview-action="append-pages"]');
      await driver.tap('[data-preview-action="append-camera"]');
      await driver.tap('[data-camera-mode="cancel"]');
      await driver.wait('!document.querySelector(".attachment-preview-append").disabled');
      const cancelled = await driver.evaluate('attachmentAppendFixture.snapshot()');
      assert.equal(cancelled.cameraCalls + cancelled.replacements, 0);
      assert.equal(cancelled.attachments[0].id, 'a'.repeat(64));
      assert.equal(await driver.evaluate('document.querySelector(".attachment-preview-dialog").matches(":modal")'), true);
      await driver.tap('[data-preview-action="append-pages"]');
      await driver.tap('[data-preview-action="append-camera"]');
      await driver.tap('[data-camera-mode="photo"]');
      assert.equal(driver.events.filter(event => event.method === 'Page.fileChooserOpened').length, 1);
      await driver.evaluate('document.querySelector("input[type=file]").dispatchEvent(new Event("cancel"))');
      await driver.wait('!document.querySelector(".attachment-preview-append").disabled');
      assert.equal((await driver.evaluate('attachmentAppendFixture.snapshot()')).replacements, 0);
      await driver.tap('[data-preview-action="append-pages"]');
      await driver.tap('[data-preview-action="append-camera"]');
      await driver.tap('[data-camera-mode="scan"]');
      await driver.wait('attachmentAppendFixture.snapshot().replacements === 1');
      assert.equal(await driver.evaluate('attachmentAppendFixture.pageCount()'), 4);
    });
  } finally { await server.close(); }
});

test('WebKit iPhone touch reaches both append actions and opens the browser picker', {timeout:60000}, async t => {
  const modulePath = process.env.ENERGETICO_PLAYWRIGHT_MODULE;
  if(!modulePath) return t.skip('Set ENERGETICO_PLAYWRIGHT_MODULE to an installed playwright-core module for WebKit');
  const { webkit, devices } = await import(modulePath);
  const server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
  let engine;
  try {
    await server.listen();
    engine = await webkit.launch({headless:true});
    const context = await engine.newContext({...devices['iPhone 13']});
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attachment-append-pages.html?manual=1&browser-picker=1`);
    await page.waitForFunction(() => window.attachmentAppendFixture);
    await page.locator('[data-preview-action="append-pages"]').tap();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('[data-preview-action="append-files"]').tap();
    await chooser;
    await page.evaluate(() => document.querySelector('input[type=file]').dispatchEvent(new Event('cancel')));
    await page.locator('[data-preview-action="append-pages"]').tap();
    await page.locator('[data-preview-action="append-camera"]').tap();
    await page.locator('[data-camera-mode="cancel"]').tap();
    await page.waitForFunction(() => !document.querySelector('.attachment-preview-append').disabled);
    await page.evaluate(() => attachmentAppendFixture.changeFlow());
    await page.locator('[data-preview-action="append-pages"]').tap();
    await page.locator('[data-preview-action="append-files"]').tap();
    await page.waitForFunction(() => /abra.*novamente/i.test(document.querySelector('.attachment-preview-status').textContent));
    assert.equal(await page.locator('[data-preview-action="append-pages"]').isVisible(), false);
    const result = await page.evaluate(() => attachmentAppendFixture.snapshot());
    assert.equal(result.pickerCalls, 1);
    assert.equal(result.replacements + result.cameraCalls, 0);
    assert.equal(result.attachments[0].id, 'a'.repeat(64));
    assert.equal(result.unchangedQuestion && result.unchangedDraft && result.noReply, true);
  } finally { await engine?.close(); await server.close(); }
});

test('a context change while the tray preview is open must not silently swallow either append choice', {timeout:60000}, async t => {
  if(!browser) return t.skip('Chrome unavailable');
  const server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
  try {
    await server.listen();
    await withAttachmentBrowser(browser, {}, async driver => {
      for (const mode of ['files', 'camera']) {
        await driver.navigate(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attachment-append-pages.html?manual=1`);
        await driver.wait('window.attachmentAppendFixture');
        await driver.evaluate('attachmentAppendFixture.changeFlow()');
        await driver.tap('[data-preview-action="append-pages"]');
        await driver.tap(`[data-preview-action="append-${mode}"]`);
        assert.match(await driver.evaluate('document.querySelector(".attachment-preview-status").textContent'), /abra.*novamente|reabra/i);
        assert.equal(await driver.evaluate('document.querySelector(".attachment-preview-append").hidden'), true);
        const result = await driver.evaluate('attachmentAppendFixture.snapshot()');
        assert.equal(result.pickerCalls + result.cameraCalls + result.replacementRequests, 0);
        assert.equal(result.attachments[0].id, 'a'.repeat(64));
        assert.equal(await driver.evaluate('document.querySelector(".attachment-preview-dialog").open'), true);
        await driver.tap('.attachment-preview-close');
        if (!await driver.evaluate('document.querySelector(".chat-attachments").open')) {
          await driver.tap('.chat-attachments > summary');
        }
        await driver.tap('[data-action="open-file"]');
        await driver.wait('!document.querySelector(".attachment-preview-append").hidden');
        await driver.tap('[data-preview-action="append-pages"]');
        await driver.tap(`[data-preview-action="append-${mode}"]`);
        if (mode === 'camera') await driver.tap('[data-camera-mode="scan"]');
        await driver.wait('attachmentAppendFixture.snapshot().replacements === 1');
        assert.equal(await driver.evaluate('attachmentAppendFixture.pageCount()'), 4);
      }
    });
  } finally { await server.close(); }
});
