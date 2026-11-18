import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { withAttachmentBrowser } from './helpers/attachment-browser-driver.mjs';

const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => path && existsSync(path));

test('attachment browser navigates a focused page after another tab takes foreground', { skip: !browser, timeout: 40_000 }, async () => {
  await withAttachmentBrowser(browser, {}, async ({ command, navigate, evaluate }) => {
    await command('Target.createTarget', { url: 'about:blank' });
    await navigate('data:text/html,<title>Foreground fixture</title><main>Ready</main>');
    assert.equal(await evaluate('document.hasFocus()'), true, 'fixture rendering must not remain backgrounded');
    assert.equal(await evaluate('new Promise(resolve => requestAnimationFrame(() => resolve(document.title)))'), 'Foreground fixture');
  });
});

test('attachment browser waits for a cold local resource beyond twenty seconds', { skip: !browser, timeout: 40_000 }, async t => {
  let pending;
  const server = createServer((request, response) => {
    if (request.url === '/slow.js') {
      response.setHeader('Content-Type', 'text/javascript');
      pending = setTimeout(() => response.end('window.slowResourceLoaded = true;'), 21_000);
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end('<title>Cold fixture</title><script src="/slow.js"></script>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    clearTimeout(pending);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  await withAttachmentBrowser(browser, {}, async ({ navigate, evaluate }) => {
    await navigate(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(await evaluate('window.slowResourceLoaded'), true);
    assert.equal(await evaluate('document.readyState'), 'complete');
  });
});

test('attachment browser reports navigation failures instead of accepting an error page', { skip: !browser, timeout: 40_000 }, async () => {
  await withAttachmentBrowser(browser, {}, async ({ navigate }) => {
    await assert.rejects(navigate('http://127.0.0.1:1/'), /ERR_UNSAFE_PORT/);
  });
});
