import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createDdaSyncReceipt } from '../src/ui/dda-sync-receipt.js';
import { createSefazSyncReceipt } from '../src/ui/sefaz-sync-receipt.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const variants = [
  { name: 'DDA local', source: 'dda', global: false },
  { name: 'DDA global', source: 'dda', global: true },
  { name: 'Sicoob', source: 'sicoob', global: true },
  { name: 'NF-e', fiscal: true },
];
for (const { name, fiscal, source, global } of variants) {
  for (const status of ['succeeded', 'failed', 'partial']) {
    test(`${name} ${status} stays open until Entendi`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const dom = new JSDOM('<body><main><button>Galeria</button></main></body>');
      const doc = dom.window.document;
      const trigger = doc.querySelector('main button');
      trigger.focus();
      let acknowledgements = 0;
      const onAcknowledge = async () => { acknowledgements++; return true; };
      const popup = fiscal
        ? createSefazSyncReceipt({ document: doc, onAcknowledge })
        : createDdaSyncReceipt({ document: doc, host: global ? doc.body : doc.querySelector('main'),
          source, global, requireAcknowledgement: global, format: () => 'Fictício', onAcknowledge });
      t.after(() => { popup.destroy(); dom.window.close(); });
      const result = { status, created: 1, createdItemIds: [42],
        sources: Object.fromEntries(['NFE', 'CTE', 'NFSE'].map(key => [key, { status: 'succeeded', documents: 1 }])) };
      assert.ok(popup.show(result, [], trigger));
      const overlay = doc.querySelector('.dda-sync-overlay, .sefaz-sync-overlay');
      const button = overlay.querySelector('button');
      assert.equal(button.textContent, 'Entendi');
      t.mock.timers.tick(60_000);
      await settle();
      assert.ok(overlay.isConnected, 'waiting does not dismiss the popup');
      assert.equal(acknowledgements, 0);

      overlay.click();
      button.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      overlay.dispatchEvent(new dom.window.Event('cancel', { cancelable: true }));
      assert.ok(overlay.isConnected, 'backdrop and Escape do not dismiss the popup');
      assert.equal(acknowledgements, 0);

      button.click();
      await settle();
      assert.equal(overlay.isConnected, false);
      assert.equal(acknowledgements, global || fiscal ? 1 : 0);
      assert.equal(doc.activeElement, trigger);
    });
  }
}
