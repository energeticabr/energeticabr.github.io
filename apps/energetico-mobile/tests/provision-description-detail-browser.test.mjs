import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';
import { withAttachmentBrowser } from './helpers/attachment-browser-driver.mjs';

test('cluster e detalhe completo cabem no celular e PC, com cartões alternados e fechamento sempre visível', { timeout: 180000 }, async t => {
  const browser = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } }, logLevel: 'silent' });
  await server.listen();
  try {
    for (const [width, height] of [[320, 740], [390, 844], [1365, 900]]) {
      for (const detail of [false, true]) {
        const result = await runBrowserLayout(browser, { width, height,
          url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/provision-description-detail.html${detail ? '?detail=1' : ''}` });
        const dom = new JSDOM(result.stdout);
        const layout = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
        assert.equal(layout.cluster, true);
        assert.equal(layout.overflow, false, `${width}px, detail=${detail}`);
        assert.equal(layout.count, detail ? 3 : 0);
        assert.equal(layout.wrongGroup, false);
        if (detail) {
          assert.match(layout.total.replace(/\s/g, ''), /R\$125,00/);
          assert.deepEqual(layout.colors, ['rgb(255, 255, 255)', 'rgb(220, 238, 249)']);
          assert.equal(layout.stickyClose, true);
        }
      }
    }
  } finally { await server.close(); }
});

test('cartões compactos respondem a toque e teclado, mantêm um painel e fecham devolvendo o foco', { timeout: 120000 }, async t => {
  const browser = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } }, logLevel: 'silent' });
  const toggle = '[data-action="toggle-provision-detail"]';
  try {
    await server.listen();
    for (const width of [320, 390, 1365]) await withAttachmentBrowser(browser, { width, height: 844 }, async driver => {
      await driver.navigate(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/provision-description-detail.html?detail=1&accordion=1`);
      await driver.wait('document.documentElement.dataset.layout');
      const snapshot = () => driver.evaluate(`(()=>{const dialog=document.querySelector('[data-provision-description-detail]'),buttons=[...dialog.querySelectorAll('${toggle}')];return {expanded:buttons.filter(button=>button.getAttribute('aria-expanded')==='true').map(button=>button.closest('[data-provision-id]').dataset.provisionId),visiblePanels:[...dialog.querySelectorAll('[data-provision-panel]')].filter(panel=>!panel.hidden).length,overflow:dialog.scrollWidth>dialog.clientWidth+1,minTarget:Math.min(...buttons.map(button=>button.getBoundingClientRect().height)),collapsedHeights:buttons.filter(button=>button.getAttribute('aria-expanded')==='false').map(button=>button.getBoundingClientRect().height)};})()`);
      const initial = await snapshot();
      assert.deepEqual(initial.expanded, ['350']); assert.equal(initial.visiblePanels, 1);
      assert.equal(initial.overflow, false); assert.ok(initial.minTarget >= 44);
      assert.ok(initial.collapsedHeights.every(height => height <= 120), JSON.stringify({ width, initial }));
      if (process.env.PROVISION_DETAIL_SCREENSHOT_DIR) {
        const shot = await driver.command('Page.captureScreenshot', { format: 'png' });
        writeFileSync(resolve(process.env.PROVISION_DETAIL_SCREENSHOT_DIR, `provision-accordion-${width}.png`), Buffer.from(shot.data, 'base64'));
      }
      const second = '[data-provision-id="351"] ' + toggle;
      await driver.evaluate(`document.querySelector('${second}').scrollIntoView({block:'center'})`);
      await driver.tap(second);
      assert.deepEqual((await snapshot()).expanded, ['351']);
      await driver.tap(second); assert.equal((await snapshot()).visiblePanels, 0);
      await driver.evaluate('document.querySelector(\'[data-action="close-description"]\').focus()');
      await driver.evaluate(`window.provisionKeyEvents=[];for(const type of ['keydown','keyup','click'])document.addEventListener(type,event=>window.provisionKeyEvents.push({type,key:event.key,action:event.target.dataset.action,expanded:event.target.getAttribute('aria-expanded')}),true)`);
      const key = async (key, code, value) => {
        const text = key === 'Enter' ? '\r' : key === ' ' ? ' ' : '';
        for (const type of ['keyDown', 'keyUp']) await driver.command('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: value, nativeVirtualKeyCode: value,
          ...(type === 'keyDown' && text ? { text, unmodifiedText: text } : {}) });
      };
      await key('Tab', 'Tab', 9);
      assert.equal(await driver.evaluate('document.activeElement.closest("[data-provision-id]")?.dataset.provisionId'), '350');
      await key('Enter', 'Enter', 13); assert.deepEqual((await snapshot()).expanded, ['350'], JSON.stringify(await driver.evaluate('window.provisionKeyEvents')));
      await key('Tab', 'Tab', 9); await key(' ', 'Space', 32);
      assert.deepEqual((await snapshot()).expanded, ['351']);
      await key('Escape', 'Escape', 27);
      assert.equal(await driver.evaluate('Boolean(document.querySelector("[data-provision-description-detail]"))'), false);
      assert.equal(await driver.evaluate('document.activeElement.dataset.action'), 'description-provisions');
    });
  } finally { await server.close(); }
});

test('observação longa não esconde o próximo cartão atrás do cabeçalho ao abrir', { timeout: 45000 }, async t => {
  const browser = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } }, logLevel: 'silent' });
  try {
    await server.listen();
    await withAttachmentBrowser(browser, { width: 320, height: 740 }, async driver => {
      await driver.navigate(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/provision-description-detail.html?detail=1&accordion=1&long=1`);
      await driver.wait('document.documentElement.dataset.layout');
      const selector = '[data-provision-id="351"] [data-action="toggle-provision-detail"]';
      await driver.evaluate(`document.querySelector('${selector}').scrollIntoView({block:'center'})`);
      await driver.tap(selector);
      const layout = await driver.evaluate(`(()=>{const dialog=document.querySelector('[data-provision-description-detail]'),button=document.querySelector('${selector}'),rect=button.getBoundingClientRect(),heading=dialog.querySelector('header').getBoundingClientRect(),bounds=dialog.getBoundingClientRect(),panel=document.getElementById(button.getAttribute('aria-controls'));return{top:rect.top,bottom:rect.bottom,headingBottom:heading.bottom,dialogBottom:bounds.bottom,expanded:button.getAttribute('aria-expanded'),hidden:panel.hidden};})()`);
      assert.equal(layout.expanded, 'true'); assert.equal(layout.hidden, false);
      assert.ok(layout.top >= layout.headingBottom && layout.bottom <= layout.dialogBottom, JSON.stringify(layout));
    });
  } finally { await server.close(); }
});
