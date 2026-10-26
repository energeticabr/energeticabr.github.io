import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createIsolatedViteServer as createServer } from './helpers/isolated-vite-server.mjs';
import { withAttachmentBrowser } from './helpers/attachment-browser-driver.mjs';

test('native Tab retains the selected toolbar control during local recalculation', { timeout: 60_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); t.after(() => server.close());
  for (const width of [390, 1365]) {
    await withAttachmentBrowser(browser, { width, height: 844 }, async ({ navigate, wait, evaluate, command, tap }) => {
      await navigate(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/launch-gallery-keyboard.html`);
      await wait('document.documentElement.dataset.ready === "true"');
      await evaluate('document.querySelector("[data-gallery-quick-search]").focus()');
      await command('Input.insertText', { text: '349' });
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await wait('!document.querySelector(".gallery-loading-screen--scoped").hidden');
      const focusedFilter = () => evaluate('document.activeElement === document.querySelector(".gallery-filter-button")');
      assert.equal(await focusedFilter(), true, `${width}px loader must not steal focus after native Tab`);
      await tap('.gallery-filter-button');
      assert.equal(await evaluate('document.querySelector(".lg-filters").open'), true, 'filters remain usable during loading');
      assert.equal(await evaluate(`(() => {
        const screen = document.querySelector('.gallery-loading-screen--scoped').getBoundingClientRect();
        const panel = document.querySelector('.lg-filters').getBoundingClientRect();
        return screen.top >= panel.bottom - 1;
      })()`), true, 'loader follows the results below the expanded filter panel');
      await evaluate('document.dispatchEvent(new Event("qa-release-filter"))');
      await wait('document.querySelector(".gallery-loading-screen--scoped").hidden');
      assert.equal(await focusedFilter(), true, `${width}px completion must preserve the field the user chose`);

      await navigate(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/launch-gallery-keyboard.html`);
      await wait('document.documentElement.dataset.ready === "true"');
      await evaluate('document.querySelector("[data-gallery-quick-search]").focus()');
      await command('Input.insertText', { text: 'Mauro' });
      for (let step = 0; step < 2; step++) {
        await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      }
      assert.equal(await evaluate('Boolean(document.activeElement.closest(".lg-results"))'), true, 'native Tab reached an old result before the quiet period ends');
      await wait('!document.querySelector(".gallery-loading-screen--scoped").hidden');
      assert.equal(await evaluate('document.activeElement === document.querySelector("[data-gallery-quick-search]")'), true,
        'focus moves from a newly inert result to the available search');
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      assert.equal(await evaluate('document.querySelector(".lg-overlay").contains(document.activeElement)'), true, 'native Tab cannot escape to the underlying application');
      await evaluate('document.dispatchEvent(new Event("qa-release-filter"))');
      await wait('document.querySelector(".gallery-loading-screen--scoped").hidden');

      await navigate(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/launch-gallery-keyboard.html`);
      await wait('document.documentElement.dataset.ready === "true"');
      await evaluate('document.querySelector("[data-gallery-quick-search]").focus()');
      await command('Input.insertText', { text: 'central' });
      await tap('.gallery-filter-button');
      await evaluate(`(() => {
        const combo = document.querySelector('[name="supplier"]').nextElementSibling.querySelector('.sfs-search');
        combo.scrollIntoView({ block: 'center' }); combo.focus();
      })()`);
      await command('Input.insertText', { text: 'Mau' });
      await evaluate('document.activeElement.setSelectionRange(1, 2)');
      await wait('!document.querySelector(".gallery-loading-screen--scoped").hidden');
      const edit = () => evaluate(`(() => {
        const combo = document.querySelector('[name="supplier"]').nextElementSibling.querySelector('.sfs-search');
        return { value: combo.value, selection: [combo.selectionStart, combo.selectionEnd],
          open: combo.getAttribute('aria-expanded'), focused: document.activeElement === combo };
      })()`);
      const expected = { value: 'Mau', selection: [1, 2], open: 'true', focused: true };
      assert.deepEqual(await edit(), expected, 'timer completion preserves a native supplier filter edit');
      await evaluate('document.dispatchEvent(new Event("qa-release-filter"))');
      await wait('document.querySelector(".gallery-loading-screen--scoped").hidden');
      assert.deepEqual(await edit(), expected, 'response option refresh also preserves the native filter edit');
    });
  }
});
