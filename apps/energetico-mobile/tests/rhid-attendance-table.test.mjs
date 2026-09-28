import test from "node:test";
import assert from "node:assert/strict";

import * as rhid from "../src/chat/rhid-attendance-table.js";

const { buildRhidAttendanceTable } = rhid;

test("relatório omite PIS não localizado sem perder colaboradores identificados", () => {
  const table = buildRhidAttendanceTable([
    { ID_PESSOA_RHID: "1", NOME_COLABORADOR: "ANA SOUZA", BATIDAS_RHID: "07:00; 12:00" },
    { ID_PESSOA_RHID: "004681366650", NOME_COLABORADOR: "PIS NÃO LOCALIZADO", BATIDAS_RHID: "02:55" },
    { ID_PESSOA_RHID: "004681366651", NOME_COLABORADOR: "pis nao localizado", BATIDAS_RHID: "06:59" },
  ]);

  assert.deepEqual(table.rows, [["ANA SOUZA", "07:00", "12:00", "—", "—", "05:00"]]);
});

test("valida a data RHID como uma data real do calendário", () => {
  assert.equal(typeof rhid.isValidRhidReportDate, "function");
  assert.equal(rhid.isValidRhidReportDate("2026-09-25"), true);
  assert.equal(rhid.isValidRhidReportDate("2026-02-31"), false);
  assert.equal(rhid.isValidRhidReportDate("2026-13-01"), false);
  assert.equal(rhid.isValidRhidReportDate("25/09/2026"), false);
});

test("horário de coleta não é apresentado falsamente como atualização do relógio", () => {
  assert.equal(typeof rhid.rhidUpdateLabel, "function");
  const label = rhid.rhidUpdateLabel({ rows: [
    { COLETADO_EM: "2026-09-25T20:11:00Z" },
    { COLETADO_EM: "2026-09-25T20:12:00Z" },
  ] });
  assert.equal(label, "ÚLTIMA COLETA DO RHID ÀS 17:12");
});

test("horário próprio do relógio, quando fornecido, recebe a legenda solicitada", () => {
  assert.equal(typeof rhid.rhidUpdateLabel, "function");
  assert.equal(rhid.rhidUpdateLabel({ clockUpdatedAt: "2026-09-25T20:10:00Z", rows: [] }),
    "DADOS ATUALIZADOS NO RELÓGIO DE PONTO ÀS 17:10");
});

test("relatório informa quando a coleta não tem horário verificável", () => {
  assert.equal(rhid.rhidUpdateLabel({ rows: [] }), "HORÁRIO DA COLETA DO RHID INDISPONÍVEL");
  assert.equal(rhid.rhidUpdateLabel({ rows: [{ COLETADO_EM: "2026-09-25T17:12:00" }] }),
    "HORÁRIO DA COLETA DO RHID INDISPONÍVEL");
});
