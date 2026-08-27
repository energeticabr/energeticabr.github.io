import assert from "node:assert/strict";
import test from "node:test";
import { buildVisibleItemExport, downloadItemExport } from "../portal/exports/item-export.js";

const entity = Object.freeze({ id: "clientes", moduleId: "comercial", title: "Clientes", capabilities: { view: true } });
const columns = Object.freeze([
  { name: "Title", label: "Nome", hidden: false },
  { name: "OBSERVACAO", label: "Observação", hidden: false },
  { name: "SEGREDO", label: "Segredo", hidden: true },
]);
const access = Object.freeze({ permissions: { comercial: { view: true } } });
const can = (current, moduleId, action) => current?.permissions?.[moduleId]?.[action] === true;

test("exportacao inclui somente campos visiveis e referencias autorizadas de anexos", () => {
  const artifact = buildVisibleItemExport({
    entity,
    item: { id: "42", createdDateTime: "2026-08-20T10:00:00Z", fields: { Title: "JOÃO D'ÁGUA", OBSERVACAO: "Primeira linha\nSegunda linha; com separador", SEGREDO: "NÃO EXPORTAR" } },
    columns,
    attachments: [{ name: "CONTRATO.pdf", serverRelativeUrl: "/sites/segredo/CONTRATO.pdf" }],
    access,
    can,
  });

  assert.equal(artifact.filename, "clientes-42.csv");
  assert.equal(artifact.mimeType, "text/csv;charset=utf-8");
  assert.ok(artifact.content.startsWith("\uFEFF"));
  assert.match(artifact.content, /Nome;"JOÃO D'ÁGUA"/);
  assert.match(artifact.content, /Observação;"Primeira linha\nSegunda linha; com separador"/);
  assert.match(artifact.content, /Anexo 1;"CONTRATO\.pdf"/);
  assert.doesNotMatch(artifact.content, /NÃO EXPORTAR|Segredo|serverRelativeUrl|\/sites\//);
});

test("exportacao falha fechada sem permissao de leitura", () => {
  assert.throws(() => buildVisibleItemExport({
    entity,
    item: { id: "42", fields: { Title: "ANA" } },
    columns,
    access: { permissions: { comercial: { view: false } } },
    can,
  }), /permissão/i);
});

test("download usa URL temporaria, nome seguro e revoga imediatamente", () => {
  const clicked = [];
  const revoked = [];
  const artifact = { filename: "clientes-42.csv", mimeType: "text/csv;charset=utf-8", content: "\uFEFFCampo;Valor\r\n" };
  downloadItemExport(artifact, {
    urlApi: { createObjectURL: () => "blob:exportacao", revokeObjectURL: url => revoked.push(url) },
    documentRef: { createElement: () => ({ click() { clicked.push({ href: this.href, download: this.download }); }, remove() {} }), body: { append() {} } },
  });

  assert.deepEqual(clicked, [{ href: "blob:exportacao", download: "clientes-42.csv" }]);
  assert.deepEqual(revoked, ["blob:exportacao"]);
});

test("exportacao neutraliza formulas de planilha sem perder o texto informado", () => {
  const artifact = buildVisibleItemExport({
    entity,
    item: { id: "42", fields: { Title: "=HYPERLINK(\"https://exemplo.invalid\")", OBSERVACAO: "+1+1" } },
    columns,
    access,
    can,
  });

  assert.match(artifact.content, /Nome;"'=HYPERLINK\(""https:\/\/exemplo\.invalid""\)"/);
  assert.match(artifact.content, /Observação;"'\+1\+1"/);
  assert.doesNotMatch(artifact.content, /Nome;"=HYPERLINK/);
});
