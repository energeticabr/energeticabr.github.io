import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createCamerasView } from "../src/ui/cameras-view.js";

const flush = () => new Promise(resolve => setImmediate(resolve));

test("a câmera selecionada abre sob demanda e a navegação encerra o vídeo", async t => {
  const dom = new JSDOM("<button>Menu</button>");
  t.after(() => dom.window.close());
  const { document, HTMLMediaElement, HTMLDialogElement } = dom.window;
  HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
  HTMLMediaElement.prototype.canPlayType = () => "maybe";
  HTMLMediaElement.prototype.play = async () => {};
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
  document.querySelector("button").focus();
  const view = createCamerasView(document);
  const starts = [];
  view.open({
    list: async () => [{ id: "site-1", label: "Obra • canal 1" }, { id: "site-2", label: "Obra • canal 2" }],
    start: async (id, options) => {
      starts.push({ id, signal: options.signal });
      return "https://video.example/index.m3u8";
    },
  });
  await flush();
  assert.equal(starts.length, 0);
  const select = document.querySelector("select");
  assert.equal(select.options.length, 2);
  select.value = "site-2";
  document.querySelector("[data-camera-play]").click();
  await flush();
  assert.equal(starts[0].id, "site-2");
  assert.equal(document.querySelector("video").hidden, false);
  document.querySelector("[data-camera-back]").click();
  assert.equal(starts[0].signal.aborted, true);
  assert.equal(document.querySelector("dialog"), null);
  assert.equal(document.activeElement.textContent, "Menu");
});
