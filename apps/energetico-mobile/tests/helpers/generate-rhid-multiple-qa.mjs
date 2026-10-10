import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildRhidMonthlyReport } from '../../src/chat/rhid-monthly-model.js';
import { buildRhidMonthlyPdf } from '../../src/chat/rhid-monthly-pdf.js';

const month = '2026-10';
const suppliers = [
  { id: '1', name: 'FUNCIONÁRIO EXEMPLO PRIMEIRO' },
  { id: '2', name: 'FUNCIONÁRIO EXEMPLO SEGUNDO COM NOME EXTENSO PARA CONFERÊNCIA' },
  { id: '3', name: 'FUNCIONÁRIO EXEMPLO TERCEIRO' },
];
const rows = suppliers.slice(0, 2).flatMap((supplier, person) => Array.from({ length: 31 }, (_, index) => ({
  Id: String(person * 31 + index + 1), ID_PESSOA_RHID: String(person + 101),
  NOME_COLABORADOR: supplier.name, DATA_REFERENCIA: `${month}-${String(index + 1).padStart(2, '0')}`,
  BATIDAS_RHID: person === 1 ? '07:30;12:00;13:00;17:00' : '07:00;12:00;13:00;17:00',
})));
const snapshot = { month, rows, presentDates: [...new Set(rows.map(row => row.DATA_REFERENCIA))] };
const reports = suppliers.map(supplier => buildRhidMonthlyReport({ month, supplier, snapshot }));
const output = resolve(process.argv[2] || '../../artifacts/rhid-multiple-employees');
await mkdir(output, { recursive: true });
const blob = await buildRhidMonthlyPdf(reports);
const path = resolve(output, 'rhid-multiple-employees-unsigned-example.pdf');
await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
process.stdout.write(`${path}\n`);
