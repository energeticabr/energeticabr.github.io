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
  const posts = [];
  let closed = 0, home = 0;
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
  };
  const view = module.createSupplierPayrollView({
    documentRef: dom.window.document,
    data,
    onClose: () => {
      closed++;
    },
    onHome: () => { home++; },
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
    input,
    click,
    get closed() {
      return closed;
    },
    get home() { return home; },
  };
}
async function fillToSheet(h) {
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
async function fill(h) {
  await fillToSheet(h);
  await h.click('[data-payroll-option="5"]');
}
test("IDFOLHA é escolhido antes do resumo e enviado na postagem obrigatória", async (t) => {
  const h = await harness();
  t.after(() => {
    h.view.destroy();
    h.dom.window.close();
  });
  await fillToSheet(h);
  const doc = h.dom.window.document;
  assert.match(doc.body.textContent, /Qual IDFOLHA de EDGAR/);
  assert.equal(doc.querySelector("[data-payroll-post]"), null);
  assert.equal(h.posts.length, 0);
  await h.click('[data-payroll-option="5"]');
  assert.match(doc.body.textContent, /Resumo da folha/);
  assert.match(doc.body.textContent, /IDFOLHA: 5.*10\/2026/);
  await h.click("[data-payroll-post]");
  assert.equal(h.posts[0].sheet.id, "5");
  assert.match(doc.body.textContent, /postada e vinculada/);
  assert.match(doc.body.textContent, /IDFOLHA: 5/);
  assert.equal(doc.querySelector("[data-payroll-link-no]"), null);
});

test("cabeçalho da folha mantém seta e casinha em todas as etapas e volta sem perder rubricas", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  const doc = h.dom.window.document;
  const navigation = () => {
    const header = doc.querySelector('.supplier-payroll-header');
    assert.ok(header.querySelector('[data-payroll-header-back] svg'), 'seta de retornar no cabeçalho');
    assert.ok(header.querySelector('[data-payroll-home] svg'), 'casinha do menu principal no cabeçalho');
    assert.equal(header.firstElementChild.dataset.payrollHeaderBack, '');
    assert.equal(header.lastElementChild.dataset.payrollHome, '');
  };
  navigation();
  await fill(h);
  navigation();
  const questions = [/Qual IDFOLHA/, /Indique a etapa/, /Informe os valores/, /Qual produto/, /QUAL FORNECEDOR/, /Qual é a data/];
  for (const question of questions) {
    await h.click('[data-payroll-header-back]');
    navigation();
    assert.match(doc.querySelector('.supplier-payroll-question').textContent, question);
    if (/Informe os valores/.test(question.source)) assert.equal(doc.querySelector('[name=salary-value]').value, '100,50');
  }
  await h.click('[data-payroll-header-back]');
  assert.equal(doc.querySelector('.supplier-payroll-page').hidden, true);
  assert.equal(h.closed, 1);
  assert.equal(h.home, 0);
  assert.equal(h.posts.length, 0);
});

test("casinha sai diretamente para o menu e descarta a folha não postada", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await fill(h);
  await h.click('[data-payroll-home]');
  assert.equal(h.dom.window.document.querySelector('.supplier-payroll-page').hidden, true);
  assert.equal(h.closed, 1);
  assert.equal(h.home, 1);
  assert.equal(h.posts.length, 0);
  await h.view.open();
  assert.equal(h.dom.window.document.querySelector('[name=date]').value, '');
  assert.match(h.dom.window.document.querySelector('.supplier-payroll-question').textContent, /Qual é a data/);
});

test("seta cancela consulta pendente sem deixar resposta antiga avançar a folha", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await fill(h);
  for (let i = 0; i < 3; i++) await h.click('[data-payroll-back]');
  let resolveStages;
  h.data.loadStages = () => new Promise(resolve => { resolveStages = resolve; });
  await h.click('[data-payroll-next]');
  await h.click('[data-payroll-header-back]');
  assert.match(h.dom.window.document.querySelector('.supplier-payroll-question').textContent, /Qual produto/);
  resolveStages([{ id: '4', label: 'FUNDAÇÃO' }]);
  await flush();
  assert.match(h.dom.window.document.querySelector('.supplier-payroll-question').textContent, /Qual produto/);
  assert.equal(h.posts.length, 0);
});

test("seta e casinha não interrompem uma gravação de folha já em andamento", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await fill(h);
  const complete = h.data.post;
  let finish;
  h.data.post = async (draft, progress) => { await new Promise(resolve => { finish = resolve; }); return complete(draft, progress); };
  await h.click('[data-payroll-post]');
  const doc = h.dom.window.document;
  assert.equal(doc.querySelector('[data-payroll-header-back]').disabled, true);
  assert.equal(doc.querySelector('[data-payroll-home]').disabled, true);
  await h.click('[data-payroll-header-back]');
  await h.click('[data-payroll-home]');
  assert.equal(h.closed, 0);
  assert.equal(h.home, 0);
  finish();
  await flush();
  assert.match(doc.querySelector('.supplier-payroll-question').textContent, /Folha postada/);
  assert.equal(doc.querySelector('[data-payroll-home]').disabled, false);
  await h.click('[data-payroll-home]');
  assert.equal(h.home, 1);
});
test("sem IDFOLHA cadastrado não há como postar ou concluir sem vínculo", async (t) => {
  const h = await harness();
  t.after(() => {
    h.view.destroy();
    h.dom.window.close();
  });
  h.data.loadSheets = async () => [];
  await fillToSheet(h);
  const doc = h.dom.window.document;
  assert.match(doc.body.textContent, /IDFOLHA.*obrigatório/i);
  assert.equal(doc.querySelector("[data-payroll-post]"), null);
  assert.ok(
    ![...doc.querySelectorAll("button")].some(
      (b) => b.textContent === "Concluir",
    ),
  );
  assert.equal(h.posts.length, 0);
  await h.click("[data-payroll-back]");
  assert.match(doc.body.textContent, /Indique a etapa/);
});
test("falha ao buscar IDFOLHA preserva etapa e permite repetir consulta", async (t) => {
  const h = await harness();
  t.after(() => {
    h.view.destroy();
    h.dom.window.close();
  });
  h.data.loadSheets = async () => {
    throw new Error("sem rede para IDFOLHA");
  };
  await fillToSheet(h);
  const doc = h.dom.window.document;
  assert.match(doc.querySelector("[role=alert]").textContent, /sem rede/);
  assert.match(doc.body.textContent, /Indique a etapa/);
  assert.equal(h.posts.length, 0);
  h.data.loadSheets = async () => [{ id: "5", label: "10/2026" }];
  await h.click('[data-payroll-option="4"]');
  await h.click('[data-payroll-option="5"]');
  assert.match(doc.body.textContent, /Resumo da folha/);
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
  await h.click("[data-payroll-back]");
  const file = new File(["a"], "salario.pdf", { type: "application/pdf" });
  const input = h.dom.window.document.querySelector('[name="salary-files"]');
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new h.dom.window.Event("change", { bubbles: true }));
  assert.match(h.dom.window.document.body.textContent, /salario.pdf/);
  await h.click("[data-payroll-next]");
  await h.click('[data-payroll-option="4"]');
  await h.click('[data-payroll-option="5"]');
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

test("erro no vínculo conserva o IDFOLHA e exige retomada antes da conclusão", async (t) => {
  const h = await harness();
  t.after(() => {
    h.view.destroy();
    h.dom.window.close();
  });
  await fill(h);
  const complete = h.data.post;
  h.data.post = async (draft, progress) => {
    progress.fingerprint = "postagem iniciada";
    throw new Error("não foi possível confirmar o vínculo ao IDFOLHA");
  };
  await h.click("[data-payroll-post]");
  const doc = h.dom.window.document;
  assert.match(doc.body.textContent, /Resumo da folha/);
  assert.match(doc.body.textContent, /IDFOLHA: 5/);
  assert.match(doc.querySelector("[data-payroll-post]").textContent, /Retomar/);
  assert.equal(doc.querySelector("[data-payroll-back]"), null);
  assert.ok(
    ![...doc.querySelectorAll("button")].some(
      (b) => b.textContent === "Concluir",
    ),
  );
  h.data.post = complete;
  await h.click("[data-payroll-post]");
  assert.equal(h.posts[0].sheet.id, "5");
  assert.match(doc.body.textContent, /postada e vinculada/);
});
