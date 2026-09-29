import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { createMascotReportButton } from "../src/ui/report-action-button.js";

test("botão reutilizável de relatório tem o mascote, nome acessível e aciona a ação", () => {
  const dom = new JSDOM("<main></main>");
  let activated = 0;
  const button = createMascotReportButton(dom.window.document, {
    label: "Abrir relatório da folha ID 12",
    onActivate: () => { activated += 1; },
  });

  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.type, "button");
  assert.equal(button.getAttribute("aria-label"), "Abrir relatório da folha ID 12");
  assert.equal(button.title, "Abrir relatório da folha ID 12");
  assert.equal(button.querySelector("img").alt, "");
  assert.match(button.querySelector("img").src, /mascote\.png$/);
  button.click();
  assert.equal(activated, 1);

  dom.window.close();
});
