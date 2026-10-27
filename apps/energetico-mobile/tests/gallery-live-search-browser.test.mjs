import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIsolatedViteServer as createServer } from './helpers/isolated-vite-server.mjs';
import { withAttachmentBrowser } from './helpers/attachment-browser-driver.mjs';

test('native gallery typing continues while current and obsolete searches finish', { timeout: 120_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); t.after(() => server.close());
  for (const [width, colorScheme] of [[320, 'light'], [390, 'light'], [390, 'dark'], [1365, 'light']]) {
    await withAttachmentBrowser(browser, { width, height: 844 }, async ({ navigate, wait, evaluate, command }) => {
      await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] });
      await navigate('http://127.0.0.1:' + server.httpServer.address().port + '/tests/fixtures/gallery-live-search.html');
      await wait('document.documentElement.dataset.ready === "true"');
      // Launches first also proves that the old three-second delay fails this native test.
      for (const name of ['launch', 'tasks', 'orders', 'payments', 'recurring', 'group', 'workDiary', 'IDFOLHA', 'FOLHAPGTO']) {
        const context = name + ' ' + width + 'px ' + colorScheme;
        await evaluate('qa.open(' + JSON.stringify(name) + ')');
        await evaluate('document.querySelector("[data-gallery-quick-search]").focus()');
        const turn = () => evaluate('new Promise(resolve => setTimeout(() => resolve(true), 0))');
        const state = () => evaluate(`(() => {
          const input = document.querySelector('[data-gallery-quick-search]');
          return { ids: qa.ids(), value: input.value, focused: document.activeElement === input,
            selection: [input.selectionStart, input.selectionEnd], disabled: input.disabled,
            blocked: Boolean(input.closest('[inert], [aria-hidden="true"]')) };
        })()`);
        await command('Input.insertText', { text: '9' }); await turn();
        if (await evaluate('qa.remote')) assert.equal(await evaluate('qa.queries.at(-1)'), '9', context + ' starts without a pause');
        await command('Input.insertText', { text: '0' }); await turn();
        if (await evaluate('qa.remote')) assert.equal(await evaluate('qa.queries.at(-1)'), '90', context + ' keeps searching while typing');
        if (name === 'launch') {
          assert.equal(await evaluate('!document.querySelector(".gallery-loading-screen--scoped").hidden'), true);
          assert.match(await evaluate('document.querySelector(".gallery-loading-screen--scoped .app-loading__progress-row").textContent'), /33%/);
          assert.equal(await evaluate(`(() => {
            const loader = document.querySelector('.gallery-loading-screen--scoped').getBoundingClientRect();
            return loader.top >= document.querySelector('[data-gallery-quick-search]').getBoundingClientRect().bottom;
          })()`), true, context + ' loading remains below the search');
          if (process.env.GALLERY_CAPTURE_DIR && width === 390 && colorScheme === 'light') {
            const capture = await command('Page.captureScreenshot', { format: 'png' });
            await writeFile(join(process.env.GALLERY_CAPTURE_DIR, 'preview-live-search-390.png'), Buffer.from(capture.data, 'base64'));
          }
        }
        await evaluate('document.querySelector("[data-gallery-quick-search]").setSelectionRange(1, 1); qa.finishLatest()');
        await turn();
        assert.deepEqual(await state(), { ids: ['901', '902'], value: '90', focused: true, selection: [1, 1],
          disabled: false, blocked: false }, context + ' response preserves the cursor inside the query');
        await evaluate('document.querySelector("[data-gallery-quick-search]").setSelectionRange(2, 2)');
        await command('Input.insertText', { text: '1' }); await turn();
        if (await evaluate('qa.remote')) assert.equal(await evaluate('qa.queries.at(-1)'), '901', context);
        await evaluate('document.querySelector("[data-gallery-quick-search]").setSelectionRange(1, 2); qa.finishLatest()');
        await turn(); await evaluate('qa.finishFirst()'); await turn();
        assert.deepEqual(await state(), { ids: ['901'], value: '901', focused: true, selection: [1, 2],
          disabled: false, blocked: false }, context + ' obsolete reply cannot replace the final query');
        await evaluate('document.querySelector("[data-gallery-quick-search]").select()');
        for (const type of ['keyDown', 'keyUp']) await command('Input.dispatchKeyEvent',
          { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await turn(); await evaluate('qa.finishLatest()'); await turn();
        assert.deepEqual(await state(), { ids: ['901', '902', '991'], value: '', focused: true, selection: [0, 0],
          disabled: false, blocked: false }, context + ' native clearing restores all rows');
      }
    });
  }
});
