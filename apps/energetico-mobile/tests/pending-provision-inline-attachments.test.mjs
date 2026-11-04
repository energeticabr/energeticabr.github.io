import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView } from '../src/ui/chat-view.js';

const state = () => ({ sessionStatus: 'authenticated', account: {name:'Teste'}, messages: [], draft:'', pendingFiles: [],
  pendingProvisions: {due:true,rows:[{id:'306'}]},
  pendingProvisionAttachments: {306:{status:'empty',items:[]}} });

test('failed file displays its escaped error reason and keeps submit enabled for retry', () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app'), view = createChatView(root);
  view.render({ ...state(), pendingProvisionExpandedPaymentId: '306', pendingProvisionUploads: {
    306: { items: [{ id: 'photo', fileName: 'foto.png', status: 'error', error: 'Formato inválido <script>blocked</script>' }] },
  } });
  assert.match(root.querySelector('.chat-pending-provision__upload-queue').textContent, /Formato inválido <script>blocked<\/script>/);
  assert.equal(root.querySelector('.chat-pending-provision__upload-queue script'), null);
  assert.equal(root.querySelector('[data-action="send-pending-provision-attachments"]').disabled, false);
  view.destroy(); dom.window.close();
});

test('abrir anexos e atualizar fila preserva a rolagem do relatório', () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app'), view = createChatView(root);
  const initial = state();
  view.render(initial);
  root.querySelector('.chat-pending-provisions__list').scrollTop=750;
  view.render({...initial,pendingProvisionExpandedPaymentId:'306'});
  assert.equal(root.querySelector('.chat-pending-provisions__list').scrollTop,750);
  view.render({...initial,pendingProvisionExpandedPaymentId:'306',pendingProvisionUploadsRevision:1,
    pendingProvisionUploads:{306:{items:[{id:'a',fileName:'novo.pdf',status:'ready'}]}}});
  assert.equal(root.querySelector('.chat-pending-provisions__list').scrollTop,750);
  view.destroy(); dom.window.close();
});

for (const source of ['photos','files','scan']) test('bandeja oferece ' + source + ' e direciona seleção ao descritivo', () => {
  const dom=new JSDOM('<main id="app"></main>');
  const root=dom.window.document.querySelector('#app'),view=createChatView(root),commands=[];
  view.on('pick-pending-provision-attachments', command=>commands.push(command));
  view.render({...state(),pendingProvisionExpandedPaymentId:'306'});
  assert.equal(root.querySelector('[data-action="send-pending-provision-attachments"]'),null);
  assert.equal(root.querySelector('[data-action="cancel-pending-provision-uploads"]'),null);
  root.querySelector('[data-action="choose-pending-provision-attachment-source"]').click();
  assert.equal(root.querySelectorAll('[data-attachment-source-dialog] [data-action="pick-pending-provision-attachments"]').length,3);
  root.querySelector('[data-action="pick-pending-provision-attachments"][data-value="'+source+'"]').click();
  assert.equal(commands.length,1);assert.equal(commands[0].paymentId,'306');assert.equal(commands[0].value,source);
  assert.equal(root.querySelector('[data-attachment-source-dialog]'),null);
  assert.ok(root.querySelector('.chat-pending-provision__upload-tray'));
  view.destroy();dom.window.close();
});
