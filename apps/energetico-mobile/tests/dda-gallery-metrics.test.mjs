import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildDdaGalleryMetrics } from '../src/chat/dda-gallery-metrics.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';

const now = new Date('2026-10-28T14:00:00Z');
const row = (id, due, amount, status = 'Em aberto', extra = {}) => ({id:String(id), fields:{Title:'Exemplo',VENCIMENTO:due,VALOR:amount,SITUACAO:status,...extra}});
test('sums all confirmed pending items with exact cents and Sunday-Friday inclusive', () => {
 const rows = [row(1,'2026-10-24',1),row(2,'2026-10-25',0.1),row(3,'2026-10-28',0.2),row(4,'2026-10-30',10,'Agendado'),row(5,'2026-10-31',100),row(6,'2026-10-28',1000,'Pago'),row(7,'2026-10-28',1000,'Baixado'),row(8,'2026-10-28',1000,'Não confirmado')];
 const result = buildDdaGalleryMetrics({rows}, now);
 assert.equal(result.total,'111.30'); assert.equal(result.today,'0.20'); assert.equal(result.week,'10.30');
 assert.equal(result.weekStart,'2026-10-25'); assert.equal(result.weekEnd,'2026-10-30');
 assert.equal(result.unknownCount,1);
});
test('week follows Brasilia date on Sunday, Saturday and year transitions', () => {
 for (const [date,start,end] of [['2026-11-01T02:00:00Z','2026-10-25','2026-10-30'],['2026-11-01T03:00:00Z','2026-11-01','2026-11-06'],['2027-01-01T12:00:00Z','2026-12-27','2027-01-01']]) {
  const result = buildDdaGalleryMetrics({rows:[]},new Date(date));
  assert.equal(result.weekStart,start); assert.equal(result.weekEnd,end);
 }
});
test('uses bank payment value, including zero, and never invents missing totals', () => {
 assert.equal(buildDdaGalleryMetrics({rows:[row(1,'2026-10-28',100,'Em aberto',{VALOR_PAGAMENTO:105.37}),row(2,'2026-10-28',100,'Em aberto',{VALOR_PAGAMENTO:0})]},now).total,'105.37');
 const result=buildDdaGalleryMetrics({rows:[row(1,'2026-10-28',null)]},now);
 assert.equal(result.total,null); assert.equal(result.today,null); assert.equal(result.week,null);
 assert.throws(()=>buildDdaGalleryMetrics({rows:[],complete:false},now));
 assert.throws(()=>buildDdaGalleryMetrics({rows:[],hasMore:true},now));
});
test('last communication uses newest recorded bank timestamp, never current time', () => {
 const result=buildDdaGalleryMetrics({rows:[row(1,'2026-10-28',1,'Em aberto',{ULTIMA_CONSULTA:'2026-10-27T20:00:00Z'}),row(2,'2026-10-28',1,'Pago',{ULTIMA_CONSULTA:'2026-10-28T10:05:00Z'}),row(3,'2026-10-28',1,'Em aberto',{ULTIMA_CONSULTA:'invalid'})]},now);
 assert.equal(result.lastCommunication,'2026-10-28T10:05:00.000Z');
 assert.equal(buildDdaGalleryMetrics({rows:[]},now).lastCommunication,null);
});
test('missing due dates leave period totals unknown but retain the total pending', () => {
 const result=buildDdaGalleryMetrics({rows:[row(1,'',20)]},now);
 assert.equal(result.total,'20.00'); assert.equal(result.today,null); assert.equal(result.week,null);
});
test('gallery metrics precede list, survive search, update after refresh and do not report zero after load failure', async () => {
 const dom=new JSDOM('<!doctype html><body></body>'); const doc=dom.window.document;
 let rows=[row(1,'2026-10-28',123.45)],fail=false;
 const gallery=createRegistrationGallery({document:doc,kind:'dda',refreshBank:async()=>({status:'succeeded',created:0}),data:{loadSnapshot:async()=>{if(fail)throw new Error('offline');return {rows};}}});
 try {
  await gallery.open();
  const metrics=doc.querySelector('.rg-dda-metrics');
  assert.equal(metrics.querySelectorAll('.rg-dda-summary-tile').length,4);
  assert.ok(metrics.compareDocumentPosition(doc.querySelector('.rg-list')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.match(metrics.querySelector('[data-dda-metric="total"]').textContent,/123,45/);
  const search=doc.querySelector('input[type="search"]'); search.value='absent'; search.dispatchEvent(new dom.window.Event('input'));
  await new Promise(resolve=>setTimeout(resolve,350));
  assert.match(metrics.querySelector('[data-dda-metric="total"]').textContent,/123,45/);
  rows=[row(1,'2026-10-28',200)]; doc.querySelector('[data-action="registration-refresh"]').click();
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.match(metrics.querySelector('[data-dda-metric="total"]').textContent,/200,00/);
  doc.querySelector('[data-dda-sync-result] button').click();
  fail=true; doc.querySelector('[data-action="registration-refresh"]').click();
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.match(metrics.querySelector('[data-dda-metric="total"]').textContent,/200,00/);
  assert.match(metrics.textContent,/Falha ao atualizar: valores da última base disponível/);
  doc.querySelector('[data-dda-sync-result] button').click();
  doc.querySelector('[data-action="registration-close"]').click(); fail=true; await gallery.open();
  assert.doesNotMatch(metrics.querySelector('[data-dda-metric="total"]').textContent,/R\$/);
 } finally {gallery.destroy(); dom.window.close();}
});
