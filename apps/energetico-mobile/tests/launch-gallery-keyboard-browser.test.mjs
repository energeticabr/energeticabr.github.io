import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { withAttachmentBrowser } from './helpers/attachment-browser-driver.mjs';

test('Tab before the search debounce keeps focus inside the masked launch gallery', { timeout: 60_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); t.after(() => server.close());
  for (const width of [390, 1365]) {
    await withAttachmentBrowser(browser, { width, height: 844 }, async ({ navigate, wait, evaluate, command }) => {
      await navigate(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/launch-gallery-keyboard.html`);
      await wait('document.documentElement.dataset.ready === "true"');
      await evaluate('document.querySelector("[data-gallery-quick-search]").focus()');
      await command('Input.insertText', { text: '349' });
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await wait('!document.querySelector(".gallery-loading-screen").hidden');
      const inNavigation = () => evaluate('document.querySelector(".lg-header").contains(document.activeElement)');
      assert.equal(await inNavigation(), true, `${width}px pending filter must retain dialog focus after native Tab`);
      await evaluate('document.dispatchEvent(new Event("qa-release-filter"))');
      await wait('document.querySelector(".gallery-loading-screen").hidden');
      assert.equal(await inNavigation(), true, `${width}px completion must not return focus to the field the user left`);
    });
  }
});
