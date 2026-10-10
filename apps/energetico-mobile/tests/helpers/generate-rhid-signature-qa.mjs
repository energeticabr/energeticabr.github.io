import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {buildRhidMonthlyReport} from '../../src/chat/rhid-monthly-model.js';
import {buildRhidMonthlyPdf} from '../../src/chat/rhid-monthly-pdf.js';
import {buildRhidAttendanceTable} from '../../src/chat/rhid-attendance-table.js';
import {buildRhidAttendancePdf} from '../../src/chat/rhid-attendance-pdf.js';
const output=resolve(process.argv[2]||'../../output/pdf');await mkdir(output,{recursive:true});
const name='FUNCIONÁRIO EXEMPLO COM NOME EXTENSO PARA CONFERÊNCIA DE ASSINATURA';
const rows=Array.from({length:31},(_,i)=>({Id:String(i+1),ID_PESSOA_RHID:'101',NOME_COLABORADOR:name,DATA_REFERENCIA:`2026-10-${String(i+1).padStart(2,'0')}`,BATIDAS_RHID:i===7?'07:00;12:00;13:00':'07:00;12:00;13:00;17:00'}));
const report=buildRhidMonthlyReport({month:'2026-10',supplier:{id:'7',name},snapshot:{month:'2026-10',rows,presentDates:rows.map(r=>r.DATA_REFERENCIA)}});
const month=await buildRhidMonthlyPdf(report);const daily=await buildRhidAttendancePdf({...buildRhidAttendanceTable([rows[0],{...rows[7],ID_PESSOA_RHID:'102',NOME_COLABORADOR:'SEGUNDO FUNCIONÁRIO EXEMPLO'}]),reportDate:'2026-10-01'},{dateLabel:'01/10/2026'});
for(const [name,blob] of [['rhid-mensal-exemplo.pdf',month],['rhid-diario-exemplo.pdf',daily]]){const path=resolve(output,name);await writeFile(path,new Uint8Array(await blob.arrayBuffer()));process.stdout.write(path+'\n');}
