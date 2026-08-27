import assert from "node:assert/strict";
import test from "node:test";
import { buildItemTimeline, itemTimelineMarkup } from "../portal/history/item-history.js";

const columns = Object.freeze([
  { name: "Title", label: "Nome", hidden: false },
  { name: "STATUS", label: "Status", hidden: false },
  { name: "OBSERVACAO", label: "Observação", hidden: false },
  { name: "SEGREDO", label: "Segredo interno", hidden: true },
]);

test("linha do tempo distingue criacao, edicao e anexos sem revelar campos ocultos", () => {
  const events = buildItemTimeline({
    item: {
      id: "42",
      createdDateTime: "2026-08-20T10:00:00Z",
      createdBy: { user: { displayName: "Ana Souza" } },
      lastModifiedDateTime: "2026-08-21T11:30:00Z",
      lastModifiedBy: { user: { displayName: "Bruno Lima" } },
      fields: { Title: "CLIENTE ÁGUA", STATUS: "APROVADO", OBSERVACAO: "Texto corrido\ncom segunda linha.", SEGREDO: "NOVO" },
    },
    versions: [
      {
        id: "1.0",
        lastModifiedDateTime: "2026-08-20T10:00:00Z",
        lastModifiedBy: { user: { displayName: "Ana Souza" } },
        fields: { Title: "CLIENTE ÁGUA", STATUS: "PENDENTE", OBSERVACAO: "Texto inicial", SEGREDO: "ANTIGO" },
      },
      {
        id: "2.0",
        lastModifiedDateTime: "2026-08-21T11:30:00Z",
        lastModifiedBy: { user: { displayName: "Bruno Lima" } },
        fields: { Title: "CLIENTE ÁGUA", STATUS: "APROVADO", OBSERVACAO: "Texto corrido\ncom segunda linha.", SEGREDO: "NOVO" },
      },
    ],
    attachments: [
      { name: "CONTRATO.pdf", uploadedAt: "2026-08-21T12:00:00Z", author: "Carla Mendes" },
    ],
    relatedRecords: [
      { type: "attachment-removed", fileName: "RASCUNHO.png", at: "2026-08-22T09:00:00Z", actor: "Daniel Reis" },
    ],
    columns,
  });

  assert.deepEqual(events.map(event => event.type), ["attachment-removed", "attachment-added", "edited", "created"]);
  const edit = events.find(event => event.type === "edited");
  assert.deepEqual(edit.changes.map(change => change.label), ["Status", "Observação"]);
  assert.equal(edit.changes[0].before, "PENDENTE");
  assert.equal(edit.changes[0].after, "APROVADO");
  assert.equal(events.some(event => JSON.stringify(event).includes("SEGREDO")), false);
  assert.equal(events.some(event => JSON.stringify(event).includes("Segredo interno")), false);
});

test("historico renderiza ator, data, campos alterados, antes e depois com texto preservado", () => {
  const events = buildItemTimeline({
    item: {
      createdDateTime: "2026-08-20T10:00:00Z",
      createdBy: { user: { displayName: "Ana Souza" } },
      lastModifiedDateTime: "2026-08-21T11:30:00Z",
      lastModifiedBy: { user: { displayName: "Bruno Lima" } },
      fields: { OBSERVACAO: "Depois & aprovado" },
    },
    versions: [
      { lastModifiedDateTime: "2026-08-20T10:00:00Z", fields: { OBSERVACAO: "Antes <rascunho>" } },
      { lastModifiedDateTime: "2026-08-21T11:30:00Z", lastModifiedBy: { user: { displayName: "Bruno Lima" } }, fields: { OBSERVACAO: "Depois & aprovado" } },
    ],
    columns,
  });
  const markup = itemTimelineMarkup({ availability: "available", events });

  assert.match(markup, /Edição/);
  assert.match(markup, /Bruno Lima/);
  assert.match(markup, /Observação/);
  assert.match(markup, /Antes/);
  assert.match(markup, /Depois/);
  assert.match(markup, /Antes &lt;rascunho&gt;/);
  assert.match(markup, /Depois &amp; aprovado/);
  assert.doesNotMatch(markup, /<rascunho>/);
});

test("edicao sem instantaneos informa que as diferencas nao estao disponiveis", () => {
  const events = buildItemTimeline({
    item: {
      createdDateTime: "2026-08-20T10:00:00Z",
      lastModifiedDateTime: "2026-08-21T11:30:00Z",
      lastModifiedBy: { user: { displayName: "Bruno Lima" } },
      fields: { Title: "ANA" },
    },
    columns,
  });
  const edit = events.find(event => event.type === "edited");
  assert.ok(edit);
  assert.deepEqual(edit.changes, []);
  assert.match(itemTimelineMarkup({ events }), /Campos alterados não disponíveis/);
});

test("uma unica versao modificada ainda registra a edicao sem inventar diferencas", () => {
  const events = buildItemTimeline({
    item: {
      createdDateTime: "2026-08-20T10:00:00Z",
      lastModifiedDateTime: "2026-08-21T11:30:00Z",
      fields: { Title: "ANA" },
    },
    versions: [{ lastModifiedDateTime: "2026-08-21T11:30:00Z", fields: { Title: "ANA" } }],
    columns,
  });

  assert.ok(events.find(event => event.type === "edited"));
});
