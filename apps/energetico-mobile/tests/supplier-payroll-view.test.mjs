import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as module from "../src/ui/supplier-payroll-view.js";
const flush = () => new Promise((r) => setTimeout(r, 5));
async function harness() {
  const dom = new JSDOM(
    '<button id="start">Abrir</button><main id="app"></main>',
  );
  const suppliers = [
      { id: "1", label: "EDGAR", branch: "OBRA A", profession: "PEDREIRO" },
    ],
    products = [{ id: "2", label: "PEDREIRO", recommended: true }],
    accounts = [{ id: "3", label: "PIX" }],
    stages = [{ id: "4", label: "FUNDAÇÃO" }];
  const posts = [],
    links = [];
  let closed = 0;
  let releasePost;
  const data = {
    loadSuppliers: async () => suppliers,
    loadProducts: async () => products,
    loadAccounts: async () => accounts,
    loadStages: async () => stages,
    loadSheets: async () => [{ id: "5", label: "10/2026", recommended: true }],
    post: async (d, p) => {
      posts.push(d);
      return {
        ...d,
        lines: d.lines
          .filter((l) => l.unitValue)
          .map((l, i) => ({ ...l, id: String(10 + i) })),
      };
    },
    linkPayroll: async (r, id) => {
      links.push(id);
      return {};
    },
  };
  const view = module.createSupplierPayrollView({
    documentRef: dom.window.document,
    data,
    onClose: () => {
      closed++;
    },
  });
  await view.open();
  const click = async (selector) => {
    dom.window.document.querySelector(selector).click();
    await flush();
  };
  const input = (selector, value) => {
    const element = dom.window.document.querySelector(selector);
    element.value = value;
    element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  };
  return {
    dom,
    view,
    data,
    posts,
    links,
    input,
    click,
    get closed() {
      return closed;
    },
  };
}
async function fill(h) {
  h.input("[name=date]", "2026-10-02");
  await h.click("[data-payroll-next]");
  assert.match(
    h.dom.window.document.body.textContent,
    /DESEJA EFETUAR A FOLHA DE QUAL FORNECEDOR/,
  );
  await h.click('[data-payroll-option="1"]');
  assert.match(h.dom.window.document.body.textContent, /⭐.*PEDREIRO/);
  await h.click('[data-payroll-option="2"]');
  assert.equal(
    h.dom.window.document.querySelectorAll("[data-payroll-rubric]").length,
    7,
  );
  h.input('[name="salary-quantity"]', "2");
  h.input('[name="salary-value"]', "100,50");
  h.input('[name="salary-account"]', "3");
  assert.match(
    h.dom.window.document.querySelector("[data-payroll-total]").textContent,
    /201,00/,
  );
  await h.click("[data-payroll-next]");
  await h.click('[data-payroll-option="4"]');
}
test("fluxo completo gera resumo antes de gravar e pede vínculo ao IDFOLHA só após Postar", async (t) => {
  const h = await harness();
  t.after(() => {
    h.view.destroy();
    h.dom.window.close();
  });
  await fill(h);
  assert.equal(h.posts.length, 0);
  assert.match(h.dom.window.document.body.textContent, /Resumo da folha/);
  await h.click("[data-payroll-post]");
  assert.equal(h.posts.length, 1);
  assert.match(h.dom.window.document.body.textContent, /IDFOLHA/);
  await h.click("[data-payroll-link-yes]");
  await h.click('[data-payroll-option="5"]');
  assert.deepEqual(h.links, ["5"]);
  assert.match(h.dom.window.document.body.textContent, /vinculad/i);
});
test("formulário inválido conserva valores e não inicia gravação", async (t) => {
  const h = await harness();
  t.after(() => {
    h.view.destroy();
    h.dom.window.close();
  });
  h.input("[name=date]", "2026-10-02");
  await h.click("[data-payroll-next]");
  await h.click('[data-payroll-option="1"]');
  await h.click('[data-payroll-option="2"]');
  h.input('[name="salary-value"]', "10");
  await h.click("[data-payroll-next]");
  assert.equal(h.posts.length, 0);
  assert.match(
    h.dom.window.document.querySelector("[role=alert]").textContent,
    /pagamento|conta/i,
  );
  assert.equal(
    h.dom.window.document.querySelector('[name="salary-value"]').value,
    "10",
  );
});
test("envio duplo é bloqueado e erro preserva resumo para retentativa", async (t) => {
  const h = await harness();
  t.after(() => {
    h.view.destroy();
    h.dom.window.close();
  });
  await fill(h);
  let reject;
  h.data.post = async () => {
    h.posts.push({});
    return new Promise((_, r) => {
      reject = r;
    });
  };
  const button = h.dom.window.document.querySelector("[data-payroll-post]");
  button.click();
  button.click();
  await flush();
  assert.equal(h.posts.length, 1);
  reject(new Error("sem rede"));
  await flush();
  assert.match(
    h.dom.window.document.querySelector("[role=alert]").textContent,
    /sem rede/,
  );
  assert.ok(h.dom.window.document.querySelector("[data-payroll-post]"));
});
test("comprovantes ficam associados à rubrica e são descartados ao destruir", async (t) => {
  const h = await harness();
  t.after(() => h.dom.window.close());
  await fill(h);
  await h.click("[data-payroll-back]");
  await h.click("[data-payroll-back]");
  const file = new File(["a"], "salario.pdf", { type: "application/pdf" });
  const input = h.dom.window.document.querySelector('[name="salary-files"]');
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new h.dom.window.Event("change", { bubbles: true }));
  assert.match(h.dom.window.document.body.textContent, /salario.pdf/);
  await h.click("[data-payroll-next]");
  await h.click('[data-payroll-option="4"]');
  await h.click("[data-payroll-post]");
  assert.equal(h.posts[0].lines[0].files[0].name, "salario.pdf");
  h.view.destroy();
  assert.equal(
    h.dom.window.document.querySelector(".supplier-payroll-page"),
    null,
  );
});

test("consulta antiga não altera etapa ao fechar e reabrir página", async (t) => {
  const h = await harness();
  t.after(() => {
    h.view.destroy();
    h.dom.window.close();
  });
  let resolve;
  h.data.loadSuppliers = () =>
    new Promise((r) => {
      resolve = r;
    });
  h.input("[name=date]", "2026-10-02");
  await h.click("[data-payroll-next]");
  h.view.close();
  await h.view.open();
  resolve([{ id: "1", label: "EDGAR", branch: "OBRA A" }]);
  await flush();
  h.data.loadSuppliers = async () => [
    { id: "1", label: "EDGAR", branch: "OBRA A" },
  ];
  await h.click("[data-payroll-next]");
  assert.equal(
    h.dom.window.document.querySelectorAll("[data-payroll-option]").length,
    1,
  );
});
