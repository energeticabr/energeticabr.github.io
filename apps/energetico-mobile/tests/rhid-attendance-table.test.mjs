import test from "node:test";
import assert from "node:assert/strict";

import { buildRhidAttendanceTable } from "../src/chat/rhid-attendance-table.js";

test("relatório omite PIS não localizado sem perder colaboradores identificados", () => {
  const table = buildRhidAttendanceTable([
    { ID_PESSOA_RHID: "1", NOME_COLABORADOR: "ANA SOUZA", BATIDAS_RHID: "07:00; 12:00" },
    { ID_PESSOA_RHID: "004681366650", NOME_COLABORADOR: "PIS NÃO LOCALIZADO", BATIDAS_RHID: "02:55" },
    { ID_PESSOA_RHID: "004681366651", NOME_COLABORADOR: "pis nao localizado", BATIDAS_RHID: "06:59" },
  ]);

  assert.deepEqual(table.rows, [["ANA SOUZA", "07:00", "12:00", "—", "—", "05:00"]]);
});
