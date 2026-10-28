import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createRegistrationGallery} from '../src/ui/registration-gallery-view.js';
import {REGISTRATION_GALLERY_MODELS} from '../src/chat/registration-gallery-data.js';
test('DDA reads issue date and displays the bank calendar day on the visible card',async()=>{
 assert.ok(REGISTRATION_GALLERY_MODELS.dda.restReadFields.includes('EMISSAO'));
 const dom=new JSDOM('<body></body>');
 const gallery=createRegistrationGallery({document:dom.window.document,kind:'dda',data:{loadSnapshot:async()=>({rows:[{id:'1',fields:{Title:'Exemplo',EMISSAO:'2026-10-20T00:00:00Z',VENCIMENTO:'2026-12-31',VALOR:10,SITUACAO:'Em aberto'}}]})}});
 try{await gallery.open();const field=dom.window.document.querySelector('[data-field="EMISSAO"]');assert.ok(field);assert.equal(field.querySelector('dt').textContent,'Emissão');assert.equal(field.querySelector('dd').textContent,'20/10/2026');assert.equal(field.closest('details'),null);assert.equal(dom.window.document.querySelectorAll('[data-registration-row]').length,1);}finally{gallery.destroy();dom.window.close();}
});
test('missing or invalid issue dates never reuse Created, due date or last query',async()=>{
 for(const EMISSAO of [null,'','2026-02-30','invalid']){
  const dom=new JSDOM('<body></body>');
  const gallery=createRegistrationGallery({document:dom.window.document,kind:'dda',data:{loadSnapshot:async()=>({rows:[{id:'1',fields:{Title:'Exemplo',EMISSAO,Created:'2026-10-28',VENCIMENTO:'2026-10-30',ULTIMA_CONSULTA:'2026-10-28T15:00:00Z',VALOR:10,SITUACAO:'Em aberto'}}]})}});
  try{await gallery.open();assert.equal(dom.window.document.querySelector('[data-field="EMISSAO"] dd').textContent,'Não informada');}finally{gallery.destroy();dom.window.close();}
 }
});
