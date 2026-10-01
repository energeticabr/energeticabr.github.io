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

  assert.deepEqual(table.rows, [["ANA SOUZA", "07:00", "12:00", "—", "—", "05:00 (parcial)"]]);
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

test("omite inativos sem batidas e preserva inativos com batidas históricas", () => {
  const table = buildRhidAttendanceTable([
    { ID_PESSOA_RHID: "3", NOME_COLABORADOR: "ARTHUR", STATUS_RHID: "INATIVO", BATIDAS_RHID: "" },
    { ID_PESSOA_RHID: "8", NOME_COLABORADOR: "SERVENTE 1", STATUS_RHID: "SEM BATIDAS", BATIDAS_RHID: "" },
    { ID_PESSOA_RHID: "8", NOME_COLABORADOR: "SERVENTE 1", STATUS_RHID: " inativo ", BATIDAS_RHID: null },
    { ID_PESSOA_RHID: "4", NOME_COLABORADOR: "EX-FUNCIONÁRIO", STATUS_RHID: "INATIVO", BATIDAS_RHID: "2026-09-25 07:01; 2026-09-25 12:05" },
    { ID_PESSOA_RHID: "6", NOME_COLABORADOR: "EX-FUNCIONÁRIO COM DUPLICATA", STATUS_RHID: "INATIVO", BATIDAS_RHID: "" },
    { ID_PESSOA_RHID: "6", NOME_COLABORADOR: "EX-FUNCIONÁRIO COM DUPLICATA", STATUS_RHID: "MARCAÇÃO RECEBIDA", BATIDAS_RHID: "2026-09-25 06:58" },
    { ID_PESSOA_RHID: "5", NOME_COLABORADOR: "ATIVO SEM BATIDA", STATUS_RHID: "SEM BATIDAS", BATIDAS_RHID: "" },
  ]);

  assert.deepEqual(table.rows.map(row => row[0]), [
    "EX-FUNCIONÁRIO", "EX-FUNCIONÁRIO COM DUPLICATA", "ATIVO SEM BATIDA",
  ]);
  assert.deepEqual(table.rows[0].slice(1, 3), ["07:01", "12:05"]);
  assert.equal(table.rows[1][1], "06:58");
  assert.equal(rhid.isRhidAttendanceRowWithoutPunches(table.rows[2]), true);
});

test("não confunde pessoas com mesmo nome e IDs RHID diferentes", () => {
  const table = buildRhidAttendanceTable([
    { ID_PESSOA_RHID: "10", NOME_COLABORADOR: "JOSE SILVA", STATUS_RHID: "INATIVO", BATIDAS_RHID: "" },
    { ID_PESSOA_RHID: "11", NOME_COLABORADOR: "JOSE SILVA", STATUS_RHID: "SEM BATIDAS", BATIDAS_RHID: "" },
  ]);
  assert.deepEqual(table.rows.map(row => row[0]), ["JOSE SILVA"]);
});

test("consolida o mesmo ID RHID mesmo com variação de espaços no nome", () => {
  const table = buildRhidAttendanceTable([
    { ID_PESSOA_RHID: "8", NOME_COLABORADOR: "SERVENTE 1", STATUS_RHID: "INATIVO", BATIDAS_RHID: "" },
    { ID_PESSOA_RHID: "8", NOME_COLABORADOR: "SERVENTE  1", STATUS_RHID: "SEM BATIDAS", BATIDAS_RHID: "" },
  ]);
  assert.deepEqual(table.rows, []);
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

test("associa IDs pendentes ao colaborador sem misturar registros de outra pessoa", () => {
  const table = buildRhidAttendanceTable([
    { ID_PESSOA_RHID: "9", NOME_COLABORADOR: "ANA", BATIDAS_RHID: "07:00", pendingPresenceIds: ["21", "22"] },
    { ID_PESSOA_RHID: "9", NOME_COLABORADOR: "ANA", BATIDAS_RHID: "12:00", pendingPresenceIds: ["21"] },
    { ID_PESSOA_RHID: "10", NOME_COLABORADOR: "BIA", BATIDAS_RHID: "", pendingPresenceIds: [] },
  ]);
  assert.deepEqual(table.people[0].pendingPresenceIds, ["21", "22"]);
  assert.deepEqual(table.people[1].pendingPresenceIds, []);
});

test("classifica as batidas nas quatro faixas sem confundir a fronteira de 12:30", () => {
  assert.equal(rhid.classifyRhidPunch("05:00"), "entry1");
  assert.equal(rhid.classifyRhidPunch("08:00"), "entry1");
  assert.equal(rhid.classifyRhidPunch("11:00"), "exit1");
  assert.equal(rhid.classifyRhidPunch("12:29"), "exit1");
  assert.equal(rhid.classifyRhidPunch("12:30"), "entry2");
  assert.equal(rhid.classifyRhidPunch("13:30"), "entry2");
  assert.equal(rhid.classifyRhidPunch("15:30"), "exit2");
  assert.equal(rhid.classifyRhidPunch("22:00"), "exit2");
  assert.equal(rhid.classifyRhidPunch("10:59"), null);
  assert.equal(rhid.classifyRhidPunch("14:30"), null);
});

test("não desloca a última saída para o horário de almoço quando falta uma batida", () => {
  const table = buildRhidAttendanceTable([{
    Id: 71, ID_PESSOA_RHID: "r-71", NOME_COLABORADOR: "ANA",
    BATIDAS_RHID: "06:57; 11:58; 17:03",
  }]);
  assert.deepEqual(table.rows[0], ["ANA", "06:57", "11:58", "—", "17:03", "05:01 (parcial)"]);
  assert.equal(table.people[0].personKey, "rhid:r-71");
  assert.deepEqual(table.people[0].rawPunches, ["06:57", "11:58", "17:03"]);
});

test("marca batidas fora das faixas e duplicadas sem ocultar o dado bruto", () => {
  const table = buildRhidAttendanceTable([{
    Id: 72, ID_PESSOA_RHID: "r-72", NOME_COLABORADOR: "BIA",
    BATIDAS_RHID: "06:58; 07:04; 12:01; 13:00; 14:00; 16:55",
  }]);
  assert.deepEqual(table.rows[0].slice(1, 5), ["—", "12:01", "13:00", "16:55"]);
  assert.deepEqual(table.people[0].slots.entry1.rhidCandidates, ["06:58", "07:04"]);
  assert.deepEqual(table.people[0].issues, ["Batidas duplicadas em Entrada 1: 06:58, 07:04", "Batida fora das faixas: 14:00"]);
});

test("duas batidas na mesma faixa com menos de cinco minutos usam a segunda sem incongruência", () => {
  const table = buildRhidAttendanceTable([{
    Id: 73, ID_PESSOA_RHID: "r-73", NOME_COLABORADOR: "ANA",
    BATIDAS_RHID: "06:58; 07:02; 11:57; 12:00; 12:58; 13:01; 16:06; 16:08",
  }]);
  assert.deepEqual(table.rows[0], ["ANA", "07:02", "12:00", "13:01", "16:08", "08:05"]);
  assert.deepEqual(table.people[0].slots.exit2.rhidCandidates, ["16:06", "16:08"]);
  assert.equal(table.people[0].slots.exit2.rhid, "16:08");
  assert.deepEqual(table.people[0].rawPunches, ["06:58", "07:02", "11:57", "12:00", "12:58", "13:01", "16:06", "16:08"]);
  assert.deepEqual(table.people[0].issues, []);
});

test("cinco minutos exatos ou três candidatas ainda exigem revisão", () => {
  const table = buildRhidAttendanceTable([
    { Id: 74, NOME_COLABORADOR: "ANA", BATIDAS_RHID: "07:00; 07:05; 12:00; 13:00; 17:00" },
    { Id: 75, NOME_COLABORADOR: "BIA", BATIDAS_RHID: "07:00; 12:00; 13:00; 16:06; 16:08; 16:09" },
  ]);
  assert.equal(table.people[0].slots.entry1.rhid, null);
  assert.match(table.people[0].issues.join(" "), /Batidas duplicadas em Entrada 1/);
  assert.equal(table.people[1].slots.exit2.rhid, null);
  assert.match(table.people[1].issues.join(" "), /Batidas duplicadas em Saída 2/);
});

test("não une homônimos sem ID RHID e preserva batida repetida ou inválida como incongruência", () => {
  const table = buildRhidAttendanceTable([
    { Id: 1, NOME_COLABORADOR: "ANA", BATIDAS_RHID: "07:00; 07:00; 12:00; 13:00; 17:00; 24:99" },
    { Id: 2, NOME_COLABORADOR: "ANA", BATIDAS_RHID: "07:01; 12:01; 13:01; 17:01" },
  ]);
  assert.equal(table.people.length, 2);
  assert.deepEqual(table.people.map(person => person.personKey), ["id:1", "id:2"]);
  assert.match(table.people[0].issues.join(" "), /duplicadas/i);
  assert.match(table.people[0].issues.join(" "), /24:99/);
});

test("ajuste que inverte a sequência do almoço permanece inconsistente", () => {
  const table = buildRhidAttendanceTable([{ Id: 1, NOME_COLABORADOR: "ANA", BATIDAS_RHID: "07:00; 12:00; 13:00; 17:00",
    ADMIN_AJUSTES: { entry2: { time: "11:00", reason: "erro" } } }]);
  assert.match(table.people[0].issues.join(" "), /ordem/i);
  assert.match(table.rows[0][5], /parcial/i);
});

test("ajustes mudam o total efetivo mas preservam o RHID e a auditoria", () => {
  const table = buildRhidAttendanceTable([{
    Id: 73, ID_PESSOA_RHID: "r-73", NOME_COLABORADOR: "EDGAR",
    BATIDAS_RHID: "07:01; 11:59; 13:00; 17:03",
    ADMIN_AJUSTES: {
      exit2: { time: "17:00", reason: "Correção conferida", actorName: "Bernardo", adjustedAt: "2026-10-01T03:00:00Z" },
    },
  }]);
  assert.deepEqual(table.rows[0], ["EDGAR", "07:01", "11:59", "13:00", "17:00", "08:58"]);
  assert.equal(table.people[0].slots.exit2.rhid, "17:03");
  assert.equal(table.people[0].slots.exit2.source, "corrected");
  assert.equal(table.people[0].slots.exit2.adjustment.reason, "Correção conferida");
});
