import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { invoiceConstructionCno } from '../src/chat/sefaz-cno.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';

test('CNO recognizes complete labeled numbers and presentation punctuation across fiscal descriptions', () => {
  for (const [field, value] of [
    ['OBSERVACOES_NOTA', 'CNO 90.025.44060/72 RUA FICTÍCIA 134'],
    ['INFORMACOES_FISCO', 'cno = 900254406072'],
    ['DESCRICAO_SERVICO', 'Cadastro Nacional de Obras: 90 . 025 . 44060 / 72'],
    ['OBSERVACOES_NOTA', 'CNO e endereço 90.025.4406072'],
    ['CNO', '90.025.44060/72'],
  ]) {
    assert.deepEqual(invoiceConstructionCno({[field]:value}), {
      status:'valid', numbers:['90.025.44060/72'], conflicts:[], expected:'90.025.44060/72',
    });
  }
});

test('CNO does not infer a work registration from supplier, access key, order reference or partial number', () => {
  for (const fields of [{}, {Title:'CNO 900254406072'}, {CHAVE_ACESSO:'900254406072'.repeat(3)},
    ...['Pedido 900254406072', 'CNO 1900254406072', 'CNO 9002544060721',
      'CNO 90.025.44060/72.9', 'CNO não informado; pedido 900254406072'].map(OBSERVACOES_NOTA=>({OBSERVACOES_NOTA}))]) {
    assert.deepEqual(invoiceConstructionCno(fields), {
      status:'missing', numbers:[], conflicts:[], expected:'90.025.44060/72',
    });
  }
});

test('wrong CNO overrides a correct CNO and conflicting numbers are listed only once', () => {
  assert.deepEqual(invoiceConstructionCno({
    OBSERVACOES_NOTA:'CNO 900254406972; CNO 90.025.44060/72; CNO 900254406972',
    INFORMACOES_FISCO:'CNO 90.030.04746/68',
  }), {status:'conflict', numbers:['90.025.44060/72','90.025.44069/72','90.030.04746/68'],
    conflicts:['90.025.44069/72','90.030.04746/68'], expected:'90.025.44060/72'});
});

test('a single or plural CNO label covers a contiguous list without including unrelated order numbers', () => {
  for (const text of ['CNO: 90.025.44060/72 e 90.030.04746/68',
    'CNOs: 900254406072, 900300474668; 900254406972',
    'CNO: 900254406072; 900300474668 Pedido 900254406972']) {
    const result=invoiceConstructionCno({OBSERVACOES_NOTA:text});
    assert.equal(result.status,'conflict');
    assert.ok(result.conflicts.includes('90.030.04746/68'));
  }
  assert.deepEqual(invoiceConstructionCno({OBSERVACOES_NOTA:'CNO 900254406072, pedido 900300474668'}).conflicts,[]);
});

test('each SEFAZ card shows its CNO below the supplier and before withholding and all invoice clusters', async t => {
  const dom=new JSDOM('<body/>'), document=dom.window.document;
  const base={Title:'FORNECEDOR FICTÍCIO COM NOME COMPRIDO', MODELO:'55', NUMERO_NOTA:'123',
    STATUS_IMPORTACAO:'XML_COMPLETO', STATUS_RETENCOES:'RETENCAO_INFORMADA_XML',
    DIRECAO:'ENTRADA', SITUACAO:'AUTORIZADA', IRRF_RETIDO:10, VALOR_TOTAL_NOTA:100,
    DANFE_URL:'https://energeticaltda.sharepoint.com/sites/energetica/Documentos/teste.pdf'};
  const rows=[{id:'valid',fields:{...base,OBSERVACOES_NOTA:'CNO 900254406072'}},
    {id:'missing',fields:base}, {id:'conflict',fields:{...base,OBSERVACOES_NOTA:'CNO 900254406972'}}];
  const gallery=createRegistrationGallery({document,kind:'notas_fiscais_sefaz',data:{loadSnapshot:async()=>({rows})}});
  t.after(()=>{gallery.destroy();dom.window.close();}); await gallery.open();
  for (const [id,status] of [['valid','valid'],['missing','missing'],['conflict','conflict']]) {
    const card=document.querySelector(`[data-registration-row="${id}"]`), cluster=card.querySelector('[data-sefaz-cno]');
    assert.ok(cluster, `${id}: CNO cluster visible`);
    assert.equal(cluster.dataset.sefazCno,status);
    assert.ok(card.querySelector('.rg-document-heading').compareDocumentPosition(cluster)&dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(cluster.nextElementSibling,card.querySelector('.rg-sefaz-withholding'));
    assert.equal(cluster.closest('details'),null);
    assert.ok(card.querySelector('.rg-sefaz-pdf-link'), 'existing PDF link preserved');
  }
  assert.match(document.querySelector('[data-sefaz-cno="valid"]').textContent,/90\.025\.44060\/72/);
  assert.match(document.querySelector('[data-sefaz-cno="missing"]').textContent,/CNO não informada/);
  const conflict=document.querySelector('[data-sefaz-cno="conflict"]');
  assert.match(conflict.textContent,/CNO errada/);
  assert.match(conflict.textContent,/90\.025\.44069\/72/);
  assert.match(conflict.textContent,/CNO correto da obra: 90\.025\.44060\/72/);
});
