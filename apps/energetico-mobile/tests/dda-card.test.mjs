import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ddaDueTone, renderDdaCard, updateDdaDueTones, copyDdaText } from '../src/ui/dda-card.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';
const now=new Date('2026-10-28T01:30:00Z'); // Still October 27 in Brasília.
test('DDA due fills use Brasilia calendar dates and the requested other-date green',()=>{
 assert.equal(ddaDueTone('2026-10-27',now),'today');
 assert.equal(ddaDueTone('28/10/2026',now),'tomorrow');
 assert.equal(ddaDueTone('2026-10-29T12:00:00Z',now),'other');
 assert.equal(ddaDueTone('2026-10-26',now),'other');
 assert.equal(ddaDueTone('',now),'unknown');
 assert.equal(ddaDueTone('2026-02-31',now),'unknown');
 assert.equal(ddaDueTone('2027-01-01',new Date('2027-01-01T01:00:00Z')),'tomorrow');
});
test('DDA card retains fields, copies exact leading-zero codes and updates day without losing details',async()=>{
 const dom=new JSDOM('<body><main></main></body>');const doc=dom.window.document,main=doc.querySelector('main'),copied=[];
 const fields={VENCIMENTO:'28/10/2026',VALOR:'R$ 40,00',SITUACAO:'Pago (liquidado)',DOCUMENTO:'DOC-1',CNPJ_FORNECEDOR:'11111111000191',BANCO:'Banco fictício',NOSSO_NUMERO:'000123',CODIGO_BARRAS:'0'+'1'.repeat(43),LINHA_DIGITAVEL:'0'+'2'.repeat(46),PAGADOR:'Empresa fictícia',BLOQUEADO:'Não',VALOR_PAGAMENTO:'R$ 40,00',CNPJ_PAGADOR:'22222222000191',ULTIMA_CONSULTA:'27/10/2026, 21:00',MENSAGEM:'<img onerror=alert(1)>'};
 renderDdaCard({document:doc,container:main,rowId:'7',title:'Fornecedor fictício',value:k=>fields[k]||'',raw:k=>fields[k],now,copyText:async text=>copied.push(text)});
 assert.equal(main.querySelector('[data-field="VENCIMENTO"]').dataset.dueTone,'tomorrow');
 assert.equal(main.querySelector('[data-field="SITUACAO"]').textContent.includes('Pago (liquidado)'),true);
 for(const field of Object.keys(fields))assert.ok(main.querySelector('[data-field="'+field+'"]'),field);
 main.querySelector('[data-copy-field="CODIGO_BARRAS"]').click();
 await new Promise(r=>setImmediate(r));
 main.querySelector('[data-copy-field="LINHA_DIGITAVEL"]').click();
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(copied,[fields.CODIGO_BARRAS,fields.LINHA_DIGITAVEL]);
 const details=main.querySelector('details');details.open=true;
 updateDdaDueTones(main,new Date('2026-10-28T12:00:00Z'));
 assert.equal(main.querySelector('[data-field="VENCIMENTO"]').dataset.dueTone,'today');
 assert.equal(details.open,true);assert.equal(main.querySelector('img'),null);
 dom.window.close();
});
test('copy rejection gives accurate feedback instead of claiming success',async()=>{
 const dom=new JSDOM('<body><main></main></body>');const main=dom.window.document.querySelector('main');
 renderDdaCard({document:dom.window.document,container:main,rowId:'1',title:'Teste',value:k=>k==='CODIGO_BARRAS'?'1'.repeat(44):'',copyText:async()=>{throw Error('denied')}});
 main.querySelector('[data-copy-field="CODIGO_BARRAS"]').click();await new Promise(r=>setImmediate(r));
 assert.match(main.textContent,/Não foi possível copiar/);dom.window.close();
});
test('DDA sorts the complete snapshot before pagination and keeps missing dates last',async()=>{
 const dom=new JSDOM('<body></body>');const rows=Array.from({length:22},(_,i)=>({id:String(i+1),fields:{Title:'Fornecedor fictício',VENCIMENTO:'2026-11-'+String(22-i).padStart(2,'0')}}));
 rows.unshift({id:'missing',fields:{Title:'Sem data'}});
 const gallery=createRegistrationGallery({document:dom.window.document,kind:'dda',data:{loadSnapshot:async()=>({rows})}});
 await gallery.open();assert.equal(dom.window.document.querySelector('[data-registration-row]').dataset.registrationRow,'22');
 assert.equal(dom.window.document.querySelectorAll('[data-registration-row]').length,20);
 gallery.destroy();dom.window.close();
});
test('clipboard fallback preserves leading zeros, restores focus, and fails truthfully',async()=>{
 const dom=new JSDOM('<body><dialog open><button>Copiar</button></dialog></body>'),doc=dom.window.document;
 const button=doc.querySelector('button');button.focus();
 Object.defineProperty(dom.window.navigator,'clipboard',{value:{writeText:async()=>{throw Error('unsupported')}}});
 let captured='';doc.execCommand=command=>{assert.equal(command,'copy');assert.equal(doc.querySelector('textarea').parentElement,doc.querySelector('dialog'));captured=doc.querySelector('textarea').value;return true;};
 await copyDdaText(doc,'000123');assert.equal(captured,'000123');assert.equal(doc.activeElement,button);assert.equal(doc.querySelector('textarea'),null);
 doc.execCommand=()=>false;await assert.rejects(copyDdaText(doc,'000123'),/COPY_UNAVAILABLE/);
 assert.equal(doc.querySelector('textarea'),null);dom.window.close();
});
test('DDA date clock is cleaned on close and destroy, with one timer on reopen',async()=>{
 const dom=new JSDOM('<body></body>');const timers=new Map();let next=0;
 dom.window.setInterval=fn=>{timers.set(++next,fn);return next;};dom.window.clearInterval=id=>timers.delete(id);
 const gallery=createRegistrationGallery({document:dom.window.document,kind:'dda',data:{loadSnapshot:async()=>({rows:[]})}});
 await gallery.open();assert.equal(timers.size,1);
 dom.window.document.querySelector('[aria-label="Voltar"]').click();assert.equal(timers.size,0);
 await gallery.open();assert.equal(timers.size,1);gallery.destroy();assert.equal(timers.size,0);dom.window.close();
});
