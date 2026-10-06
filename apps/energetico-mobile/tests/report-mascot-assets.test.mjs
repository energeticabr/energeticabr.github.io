import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import { renderChatMarkup } from '../src/ui/chat-view.js';

// Exercise the actual HOME images, not a separate list that can drift from UI.
const dom = new JSDOM(renderChatMarkup({
  sessionStatus: 'authenticated', account: { name: 'Teste' }, pendingFiles: [],
  messages: [{ id: 'home', role: 'assistant', type: 'poll',
    question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [
      { id: 'group_pending', reply: 'group_pending', label: 'PENDÊNCIAS' },
      { id: 'group_supplies', reply: 'group_supplies', label: 'SUPRIMENTOS' },
    ] }],
}));
const buttons = [...dom.window.document.querySelectorAll('.chat-message--external-provisions > button, .chat-message--external-cargos > button')];
assert.equal(buttons.length, 16, 'all HOME mascots are exercised');

for (const button of buttons) {
  test(`${button.dataset.action}: sharp mascot cutout leaves every outer edge transparent`, async () => {
    const path = fileURLToPath(button.querySelector('img').src);
    const source = sharp(path);
    const metadata = await source.metadata();
    assert.ok(metadata.width >= 256 && metadata.height >= 256,
      `${button.dataset.action}: enough source pixels for high-density phone displays`);
    assert.ok(metadata.hasAlpha, 'the button supplies the solid background, not a screenshot matte');
    const { data, info } = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = (x, y) => data[(y * info.width + x) * info.channels + info.channels - 1];
    for (let x = 0; x < info.width; x++) {
      assert.equal(alpha(x, 0), 0, `top edge at ${x}`);
      assert.equal(alpha(x, info.height - 1), 0, `bottom edge at ${x}`);
    }
    for (let y = 0; y < info.height; y++) {
      assert.equal(alpha(0, y), 0, `left edge at ${y}`);
      assert.equal(alpha(info.width - 1, y), 0, `right edge at ${y}`);
    }
    let opaque = 0, left = info.width, top = info.height, right = 0, bottom = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (alpha(x, y) > 200) {
      opaque++; left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    assert.ok(opaque > info.width * info.height * .1, 'retain visible mascot/props, not an empty image');
    assert.ok(opaque < info.width * info.height * .9, 'no opaque rectangular inner background');
    assert.ok([[left+1,top+1],[right-1,top+1],[left+1,bottom-1],[right-1,bottom-1]]
      .some(([x,y]) => alpha(x,y) < 200), 'a transparent outer border must not hide an opaque inner screenshot rectangle');
  });
}
