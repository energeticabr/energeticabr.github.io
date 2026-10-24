import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView } from '../src/ui/chat-view.js';

for (const { label, id, disabled, aria, want } of [
  { label: 'opens the same attachment once', id: 'original', disabled: false, want: ['original'] },
  { label: 'never opens a different attachment', id: 'different', disabled: false, want: [] },
  { label: 'does not bypass a newly disabled attachment', id: 'original', disabled: true, want: [] },
  { label: 'does not bypass aria-disabled on the attachment', id: 'original', aria: 'button', want: [] },
  { label: 'does not bypass aria-disabled on its ancestor', id: 'original', aria: 'ancestor', want: [] },
]) test(`thumbnail refresh during a tap ${label}`, t => {
  const dom = new JSDOM('<main id="app"></main>'), root = dom.window.document.querySelector('#app');
  const view = createChatView(root), opened = [];
  t.after(() => { view.destroy(); dom.window.close(); });
  view.on('open-file', command => opened.push(command.fileId));
  const state = { sessionStatus: 'authenticated', account: { name: 'Teste' }, draft: '', messages: [],
    pendingFiles: [], activeText: null, error: null,
    attachments: [{ id: 'original', fileName: 'original.pdf', mimeType: 'application/pdf', size: 123 }] };
  view.render(state);
  root.querySelector('.chat-attachments').open = true;
  const old = root.querySelector('[data-action="open-file"]');
  const pointer = (type, target) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({ pointerId: 17, pointerType: 'touch', isPrimary: true, clientX: 20, clientY: 20 })) {
      Object.defineProperty(event, key, { value });
    }
    target.dispatchEvent(event);
  };
  pointer('pointerdown', old);
  view.render({ ...state, attachments: [{ ...state.attachments[0], id, previewUrl: 'blob:test-thumbnail' }] });
  assert.equal(old.isConnected, false, 'thumbnail rendering really replaces the pressed DOM node');
  const current = root.querySelector('[data-action="open-file"]');
  current.disabled = disabled;
  if (aria) (aria === 'button' ? current : current.parentElement).setAttribute('aria-disabled', 'true');
  pointer('pointerup', current);
  assert.deepEqual(opened, want);
  current.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 20, clientY: 20 }));
  assert.deepEqual(opened, want, 'the later native click cannot duplicate or redirect that tap');
});

for (const transition of ['account-change', 'sign-out-and-back']) test(`an attachment tap cannot survive ${transition}`, t => {
  const dom = new JSDOM('<main id="app"></main>'), root = dom.window.document.querySelector('#app');
  const view = createChatView(root), opened = [];
  t.after(() => { view.destroy(); dom.window.close(); });
  view.on('open-file', command => opened.push(command.fileId));
  const state = { sessionStatus: 'authenticated', account: { homeAccountId: 'account-A', name: 'Teste A' },
    draft: '', messages: [], pendingFiles: [], activeText: null, error: null,
    attachments: [{ id: 'original', fileName: 'original.pdf', mimeType: 'application/pdf', size: 123 }] };
  const pointer = (type, target) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({ pointerId: 17, pointerType: 'touch', isPrimary: true, clientX: 20, clientY: 20 })) {
      Object.defineProperty(event, key, { value });
    }
    target.dispatchEvent(event);
  };
  view.render(state);
  root.querySelector('.chat-attachments').open = true;
  pointer('pointerdown', root.querySelector('[data-action="open-file"]'));
  if (transition === 'account-change') view.render({ ...state, account: { homeAccountId: 'account-B', name: 'Teste B' } });
  else { view.render({ ...state, sessionStatus: 'signed_out', account: null }); view.render(state); }
  const current = root.querySelector('[data-action="open-file"]');
  pointer('pointerup', current);
  current.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 20, clientY: 20 }));
  assert.deepEqual(opened, [], 'neither the release nor its native click may enter another session');
  pointer('pointerdown', current); pointer('pointerup', current);
  assert.deepEqual(opened, ['original'], 'a new deliberate tap works in the current session');
});
