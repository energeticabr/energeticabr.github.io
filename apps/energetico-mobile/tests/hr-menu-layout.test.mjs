import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { createChatView } from '../src/ui/chat-view.js';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => path && existsSync(path));
const option = (id, label) => ({ id, reply: id, label });
const menu = {
  id: 'hr', role: 'assistant', type: 'poll',
  question: '👥 RECURSOS HUMANOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?',
  options: [
    option('action_create_supplier_attendance', '➕ CRIAR PRESENÇA DE FORNECEDOR'),
    option('action_register_hr_activity', '🛠️ CADASTRAR ATIVIDADE'),
    option('action_hr_registrations', '🗂️ EFETUAR CADASTROS'),
    option('action_validate_attendance', '👷 VALIDAR PRESENÇAS APONTADAS'),
    option('action_link_attendance_payment', '🔗 VINCULAR PGTO PRESENÇA'),
    option('action_hr_reports', '📊 OBTER DADOS'),
    option('action_contract', '📄 CONTRATO'),
  ],
};

test('HR hides retired actions and keeps the remaining shortcuts usable', () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root), events = [];
  view.on('select-reply', event => events.push(event.replyId));
  const state = { sessionStatus: 'authenticated', account: { name: 'Teste' }, draft: '', pendingFiles: [],
    messages: [{ ...menu, options: [...menu.options, option('action_hr_gallery_presencas', '📋 GALERIA DE PRESENÇAS')] }] };
  try {
    view.render(state);
    const rows = [...root.querySelectorAll('.chat-hr-menu-row')];
    assert.deepEqual(rows.map(row => [...row.querySelectorAll('[data-reply-id]')].map(button => button.dataset.replyId)), [
      ['action_create_supplier_attendance', 'action_hr_gallery_idfolha'],
      ['action_register_hr_activity', 'action_hr_gallery_folhapgto'],
      ['action_hr_registrations', 'action_hr_gallery_presencas'],
      ['action_validate_attendance', 'action_hr_gallery_funcionarios'],
      ['action_contract'], ['action_rhid_attendance_report'],
    ]);
    for (const button of root.querySelectorAll('.chat-hr-menu-row button')) button.click();
    assert.deepEqual(events, [
      'action_create_supplier_attendance', 'action_hr_gallery_idfolha',
      'action_register_hr_activity', 'action_hr_gallery_folhapgto',
      'action_hr_registrations', 'action_hr_gallery_presencas',
      'action_validate_attendance', 'action_hr_gallery_funcionarios', 'action_contract',
    ]);
    assert.ok(root.querySelector('[data-rhid-attendance-report-dialog]'), 'report keeps its calendar popup');
    view.render({ ...state, activeText: 'sending' });
    assert.ok([...root.querySelectorAll('.chat-hr-menu-row button')].every(button => button.disabled));
  } finally { view.destroy(); dom.window.close(); }
});

test('short legacy HR menus retain all four gallery shortcuts', () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app'), view = createChatView(root);
  try {
    view.render({ sessionStatus: 'authenticated', account: { name: 'Teste' }, draft: '', pendingFiles: [],
      messages: [{ ...menu, options: [menu.options[0], menu.options[3]] }] });
    assert.deepEqual([...root.querySelectorAll('.chat-hr-menu-row [data-gallery-button]')].map(button => button.dataset.replyId),
      ['action_hr_gallery_idfolha', 'action_hr_gallery_folhapgto', 'action_hr_gallery_presencas', 'action_hr_gallery_funcionarios']);
  } finally { view.destroy(); dom.window.close(); }
});

test('legacy duplicate presence options render one gallery with its current name', () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app'), view = createChatView(root);
  try {
    view.render({ sessionStatus: 'authenticated', account: { name: 'Teste' }, draft: '', pendingFiles: [],
      messages: [{ ...menu, options: [...menu.options,
        option('action_hr_gallery_presencas', 'GALERIA DE PRESENÇAS'),
        option('action_hr_gallery_validar_presencas', 'GALERIA VALIDAR PRESENÇAS')] }] });
    const gallery = root.querySelectorAll('[data-reply-id="action_hr_gallery_presencas"]');
    assert.equal(gallery.length, 1);
    assert.match(gallery[0].textContent, /GALERIA DESCRITIVO PRESENÇA/);
    assert.equal(root.querySelector('[data-reply-id="action_hr_gallery_validar_presencas"]'), null);
  } finally { view.destroy(); dom.window.close(); }
});

test('HR actions and galleries share aligned equal-height rows on phones, tablets and Windows', { timeout: 120_000 }, async t => {
  if (!browser) return t.skip('Chrome unavailable');
  const cacheDir = await mkdtemp(join(tmpdir(), 'energetico-hr-menu-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true, maxRetries: 5 }));
  const server = await createServer({ root: appRoot, cacheDir,
    optimizeDeps: { noDiscovery: true, include: ['decimal.js', 'pdf-lib', 'pako', '@capacitor/core'] },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(appRoot, '../..'), cacheDir] } }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [1365, 768]]) {
      const { stdout } = await runBrowserLayout(browser, { width, height,
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/hr-menu-layout.html` });
      const dom = new JSDOM(stdout), result = JSON.parse(dom.window.document.documentElement.dataset.layout);
      dom.window.close();
      assert.equal(result.rows.length, 6);
      assert.equal(result.overflow, false, `${width}: no horizontal overflow`);
      for (const [button, reference] of [[result.holerites, result.swileGallery],
        [result.trancid, result.swile], [result.trancidGallery, result.swileGallery]]) {
        assert.ok(Math.abs(button.x - reference.x) <= 1, `${width}: ${JSON.stringify(button)}`);
        assert.ok(Math.abs(button.width - reference.width) <= 1, `${width}: ${JSON.stringify(button)}`);
      }
      for (const [index, row] of result.rows.entries()) {
        const diagnostic = `${width} row ${index}: ${JSON.stringify(row)}`;
        assert.ok(row.buttonsFit, diagnostic);
        assert.ok(Math.abs(row.primary.y - row.row.y) <= 1, diagnostic);
        assert.ok(Math.abs(row.primary.height - row.row.height) <= 1, diagnostic);
        assert.ok(Math.abs(row.row.height - result.rows[0].row.height) <= 1, diagnostic);
        assert.ok(Math.abs(row.primary.x - result.swile.x) <= 1, diagnostic);
        assert.ok(Math.abs(row.primary.width - result.swile.width) <= 1, diagnostic);
        if (row.gallery) {
          assert.ok(Math.abs(row.gallery.x - result.swileGallery.x) <= 1, diagnostic);
          assert.ok(Math.abs(row.gallery.width - result.swileGallery.width) <= 1, diagnostic);
          assert.ok(Math.abs(row.primary.y - row.gallery.y) <= 1, diagnostic);
          assert.ok(Math.abs(row.primary.height - row.gallery.height) <= 1, diagnostic);
          assert.ok(row.gallery.x >= row.primary.x + row.primary.width + 7, diagnostic);
        }
      }
      t.diagnostic(`${width}px: ${result.rows.length} aligned rows, height ${result.rows[0].row.height}px`);
    }
  } finally { await server.close(); }
});
