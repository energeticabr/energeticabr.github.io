import test from "node:test";
import assert from "node:assert/strict";

import * as rhid from "../src/chat/rhid-attendance-table.js";

const { buildRhidAttendanceTable, isRhidAttendanceDayFinalized, isRhidAttendanceRowDiscrepant, shiftRhidReportDate } = rhid;

test("navegação do relatório RHID avança e retorna um dia inclusive nas viradas do calendário", () => {
  assert.equal(shiftRhidReportDate("2026-10-01", -1), "2026-09-30");
  assert.equal(shiftRhidReportDate("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftRhidReportDate("2026-02-31", 1), "");
  assert.equal(shiftRhidReportDate("2026-09-25", 2), "");
});

test("relatório omite PIS não localizado sem perder colaboradores identificados", () => {
  const table = buildRhidAttendanceTable([
    { ID_PESSOA_RHID: "1", NOME_COLABORADOR: "ANA SOUZA", BATIDAS_RHID: "07:00; 12:00" },
    { ID_PESSOA_RHID: "004681366650", NOME_COLABORADOR: "PIS NÃO LOCALIZADO", BATIDAS_RHID: "02:55" },
    { ID_PESSOA_RHID: "004681366651", NOME_COLABORADOR: "pis nao localizado", BATIDAS_RHID: "06:59" },
  ]);

  assert.deepEqual(table.rows, [["ANA SOUZA", "07:00", "12:00", "—", "—", "05:00"]]);
});

test("inclui cadastrados sem batidas ao final e omite cadastro NÃO APAGAR", () => {
  const table = buildRhidAttendanceTable([
    { ID_PESSOA_RHID: "3", NOME_COLABORADOR: "ZÉ COM BATIDA", BATIDAS_RHID: "07:00" },
    { ID_PESSOA_RHID: "2", NOME_COLABORADOR: "BRUNO SEM BATIDA", BATIDAS_RHID: "" },
    { ID_PESSOA_RHID: "1", NOME_COLABORADOR: "ANA SEM BATIDA", BATIDAS_RHID: null },
    { ID_PESSOA_RHID: "4", NOME_COLABORADOR: "Cadastro - Não Apagar", BATIDAS_RHID: "" },
    { ID_PESSOA_RHID: "2", NOME_COLABORADOR: "BRUNO SEM BATIDA", BATIDAS_RHID: "" },
  ]);
  assert.deepEqual(table.rows.map(row => row[0]), ["ZÉ COM BATIDA", "ANA SEM BATIDA", "BRUNO SEM BATIDA"]);
  assert.deepEqual(table.rows[1].slice(1), ["—", "—", "—", "—", "— (parcial)"]);
  assert.equal(rhid.isRhidAttendanceRowWithoutPunches(table.rows[0]), false);
  assert.equal(rhid.isRhidAttendanceRowWithoutPunches(table.rows[1]), true);
});

test("omite cadastro inativo mesmo quando ele possui batidas", () => {
  const table = buildRhidAttendanceTable([
    { ID_PESSOA_RHID: "1", NOME_COLABORADOR: "ARTHUR MARCOS", BATIDAS_RHID: "07:00", STATUS_RHID: "INATIVO" },
    { ID_PESSOA_RHID: "2", NOME_COLABORADOR: "SERVENTE 1", BATIDAS_RHID: "", STATUS_RHID: "INATIVO" },
    { ID_PESSOA_RHID: "3", NOME_COLABORADOR: "ATIVO", BATIDAS_RHID: "07:01", STATUS_RHID: "MARCAÇÃO RECEBIDA" },
  ]);
  assert.deepEqual(table.rows.map(row => row[0]), ["ATIVO"]);
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

test("considera o dia atual encerrado às 17:15 de Brasília e dias anteriores encerrados", () => {
  assert.equal(isRhidAttendanceDayFinalized("2026-09-25", new Date("2026-09-25T20:14:59Z")), false);
  assert.equal(isRhidAttendanceDayFinalized("2026-09-25", new Date("2026-09-25T20:15:00Z")), true);
  assert.equal(isRhidAttendanceDayFinalized("2026-09-25", new Date("2026-09-26T12:00:00Z")), true);
  assert.equal(isRhidAttendanceDayFinalized("2026-09-26", new Date("2026-09-25T20:15:00Z")), false);
  assert.equal(isRhidAttendanceDayFinalized("2026-02-31", new Date("2026-09-26T12:00:00Z")), false);
});

test("marca discrepância por batidas incompletas ou carga semanal abaixo do mínimo", () => {
  const afterClose = new Date("2026-09-26T12:00:00Z");
  const row = (...punches) => ["PESSOA", ...punches, "08:45"];

  assert.equal(isRhidAttendanceRowDiscrepant(row("07:00", "12:00", "13:00", "16:44"), "2026-09-24", afterClose), true);
  assert.equal(isRhidAttendanceRowDiscrepant(row("07:00", "12:00", "13:00", "16:45"), "2026-09-24", afterClose), false);
  assert.equal(isRhidAttendanceRowDiscrepant(row("07:00", "12:00", "13:00", "15:44"), "2026-09-25", afterClose), true);
  assert.equal(isRhidAttendanceRowDiscrepant(row("07:00", "12:00", "13:00", "15:45"), "2026-09-25", afterClose), false);
  assert.equal(isRhidAttendanceRowDiscrepant(row("07:00", "16:00", "—", "—"), "2026-09-25", afterClose), true);
  assert.equal(isRhidAttendanceRowDiscrepant(row("07:00", "12:00", "13:00", "15:45", "16:00", "17:00"), "2026-09-25", afterClose), false);
  assert.equal(isRhidAttendanceRowDiscrepant(row("07:00", "12:00", "13:00", "15:45", "16:00", "—"), "2026-09-25", afterClose), true);
  assert.equal(isRhidAttendanceRowDiscrepant(row("07:00", "12:00", "13:00", "25:99"), "2026-09-25", afterClose), true);
  assert.equal(isRhidAttendanceRowDiscrepant(row("07:00", "12:00", "—", "—"), "2026-09-25", new Date("2026-09-25T20:14:59Z")), false);
  assert.equal(isRhidAttendanceRowDiscrepant(row("07:00", "12:00", "—", "—"), "2026-09-26", afterClose), false);
});
