import assert from "node:assert/strict";
import test from "node:test";
import { buildAuditSummary, todayDateKey } from "../portal/audit/audit-model.js";
import { auditPanelMarkup } from "../portal/audit/audit-panel.js";

const DATE = "2026-08-26";

function record(id, source, created, modified, creator, editor) {
  return {
    id,
    sourceId: source,
    sourceTitle: source.toUpperCase(),
    createdDateTime: created,
    lastModifiedDateTime: modified,
    createdBy: { user: { displayName: creator, email: `${creator.toLowerCase()}@energeticabr.com` } },
    lastModifiedBy: { user: { displayName: editor, email: `${editor.toLowerCase()}@energeticabr.com` } },
  };
}

test("a data padrão da auditoria usa o dia local e não UTC", () => {
  assert.equal(todayDateKey(new Date("2026-08-27T01:30:00Z"), "America/Sao_Paulo"), DATE);
});
test("auditoria separa criações de edições e discrimina por base e usuário", () => {
  const records = [
    record("1", "lancamentos", `${DATE}T10:00:00Z`, `${DATE}T10:00:00Z`, "ANA", "ANA"),
    record("2", "lancamentos", "2026-08-20T10:00:00Z", `${DATE}T12:00:00Z`, "BRUNO", "CARLA"),
    record("3", "documentos", `${DATE}T13:00:00Z`, `${DATE}T14:00:00Z`, "ANA", "CARLA"),
    record("4", "documentos", "2026-08-20T10:00:00Z", "2026-08-20T11:00:00Z", "ANA", "ANA"),
  ];

  const summary = buildAuditSummary(records, { date: DATE, timeZone: "UTC" });

  assert.equal(summary.created, 2);
  assert.equal(summary.edited, 2);
  assert.deepEqual(summary.bySource.map(row => [row.id, row.created, row.edited]), [
    ["documentos", 1, 1],
    ["lancamentos", 1, 1],
  ]);
  assert.deepEqual(summary.byUser.map(row => [row.label, row.created, row.edited]), [
    ["ANA", 2, 0],
    ["CARLA", 0, 2],
  ]);
});

test("painel de auditoria inicia hoje e oferece agrupamentos acessíveis", () => {
  const html = auditPanelMarkup({
    date: DATE,
    created: 2,
    edited: 1,
    bySource: [{ id: "documentos", label: "DOCUMENTOS", created: 1, edited: 1 }],
    byUser: [{ id: "ana", label: "ANA", created: 2, edited: 0 }],
  });

  assert.match(html, /type="date"/);
  assert.match(html, new RegExp(`value="${DATE}"`));
  assert.match(html, /2[\s\S]*Criados/);
  assert.match(html, /1[\s\S]*Editados/);
  assert.match(html, /Por base/);
  assert.match(html, /Por usuário/);
});
