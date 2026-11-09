import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { invoiceConstructionCno } from '../src/chat/sefaz-cno.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';
import { createRegistrationGalleryData, REGISTRATION_GALLERY_MODELS } from '../src/chat/registration-gallery-data.js';

// Fictitious metadata represents the server projection after PDF attachment verification.
const key = '1'.repeat(44);
function correction(sequence = 1, text = 'Corrigir CNO para 90.025.44060/72') {
  const seq = String(sequence).padStart(2, '0');
  return {eventId:`ID110110${key}${seq}`, eventType:'110110', cStat:'135', sequence,
    protocol:'123456789012345', issuedAt:'2026-11-06T10:00:00-03:00', correction:text,
    xmlSha256:'a'.repeat(64), pdfSha256:'b'.repeat(64), fileName:`CCe-${key}-110110-${seq}.pdf`};
}
function correctedFields(events = [correction()], original = 'CNO 900254406972') {
  return {CHAVE_ACESSO:key, OBSERVACOES_NOTA:original,
    CARTAS_CORRECAO_JSON:JSON.stringify({version:1, key, events})};
}

test('a linked authorized CC-e corrects a wrong or missing original CNO, including an old number quoted in the correction', () => {
  for (const original of ['', 'CNO 900254406972']) {
    const result = invoiceConstructionCno(correctedFields([correction(1, 'Onde consta CNO 90.025.44069/72, leia-se CNO 90.025.44060/72.')], original));
    assert.equal(result.status, 'valid');
    assert.deepEqual(result.numbers, ['90.025.44060/72']);
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.corrected, true);
    assert.equal(result.correctionSequence, 1);
    assert.equal(result.correctionEventId, `ID110110${key}01`);
  }
});

test('highest applicable CC-e sequence supersedes earlier CNO and original while later unrelated corrections do not', () => {
  const events = [correction(3, 'Alteração do endereço fictício da entrega.'), correction(), correction(2, 'CNO 900300474668')];
  const result = invoiceConstructionCno(correctedFields(events, 'CNO 900254406072'));
  assert.equal(result.status, 'conflict');
  assert.deepEqual(result.conflicts, ['90.030.04746/68']);
  assert.equal(result.correctionSequence, 2);
  assert.equal(result.corrected, true);
  const earlier = invoiceConstructionCno(correctedFields([events[0], events[1]]));
  assert.equal(earlier.status, 'valid');
  assert.equal(earlier.correctionSequence, 1);
});

test('CC-e applies an explicit leia-se replacement even when it does not repeat the CNO label', () => {
  const result = invoiceConstructionCno(correctedFields([correction(20, 'Onde consta CNO 90.025.44069/72, leia-se 90.025.44060/72.')]));
  assert.equal(result.status, 'valid');
  assert.equal(result.correctionSequence, 20);
  assert.deepEqual(result.numbers, ['90.025.44060/72']);
});

test('a later CNO-specific removal suppresses the older correction and original CNO', () => {
  const result = invoiceConstructionCno(correctedFields([correction(), correction(2, 'O CNO deve ser removido desta nota.')], 'CNO 900254406072'));
  assert.equal(result.status, 'missing');
  assert.deepEqual(result.numbers, []);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.correctionSequence, 2);
});

test('CNO-specific correction recognizes an unlabeled correct replacement after considerar o correto', () => {
  const result = invoiceConstructionCno(correctedFields([correction(2, 'Onde consta CNO 90.025.44060/73, considerar o correto 90.025.44060/72')]));
  assert.equal(result.status, 'valid');
  assert.deepEqual(result.numbers, ['90.025.44060/72']);
  assert.equal(result.correctionSequence, 2);
});

test('an unrelated order number in a CNO correction cannot validate the work', () => {
  const result = invoiceConstructionCno(correctedFields([correction(2, 'Corrigir CNO para 90.025.44060/73. Pedido 900254406072.')]));
  assert.equal(result.status, 'conflict');
  assert.deepEqual(result.numbers, ['90.025.44060/73']);
});

test('explicit replacement overrides the quoted original even when the original had the correct work CNO', () => {
  for (const replacement of ['leia-se CNO 90.025.44069/72.', 'leia-se 90.025.44069/72.', 'considerar o correto 90.025.44069/72.']) {
    const result = invoiceConstructionCno(correctedFields([correction(2, `Onde consta CNO 90.025.44060/72, ${replacement}`)]));
    assert.equal(result.status, 'conflict');
    assert.deepEqual(result.numbers, ['90.025.44069/72']);
    assert.deepEqual(result.conflicts, ['90.025.44069/72']);
  }
});

test('an explicitly removed quoted CNO never validates the work and a supplied replacement takes effect', () => {
  for (const [text, status, numbers] of [
    ['CNO 90.025.44060/72 deve ser removido desta nota.', 'missing', []],
    ['Substituir CNO 90.025.44060/72 por 90.025.44060/73.', 'conflict', ['90.025.44060/73']],
    ['Remover CNO 90.025.44060/72 e informar CNO 90.025.44060/73.', 'conflict', ['90.025.44060/73']],
  ]) {
    const result = invoiceConstructionCno(correctedFields([correction(2, text)]));
    assert.equal(result.status, status, text);
    assert.deepEqual(result.numbers, numbers, text);
  }
});

test('common explicit replacement clauses cannot leave a quoted original CNO green', () => {
  for (const text of [
    'Substituir o CNO 90.025.44060/72 pelo CNO 90.025.44060/73.',
    'CNO 90.025.44060/72 está incorreto; o correto é 90.025.44060/73.',
  ]) {
    const result = invoiceConstructionCno(correctedFields([correction(2, text)]));
    assert.equal(result.status, 'conflict', text);
    assert.deepEqual(result.numbers, ['90.025.44060/73']);
  }
});

test('distinct final CNOs remain conflicting even when one is the expected work registration', () => {
  for (const text of [
    'CNOs: 90.025.44060/72 e 90.025.44060/73.',
    'Onde consta CNO 90.025.44069/72, leia-se CNO 90.025.44060/72. Onde consta CNO 90.025.44069/72, leia-se CNO 90.025.44060/73.',
  ]) {
    const result = invoiceConstructionCno(correctedFields([correction(2, text)]));
    assert.equal(result.status, 'conflict', text);
    assert.deepEqual(result.numbers, ['90.025.44060/72', '90.025.44060/73']);
    assert.deepEqual(result.conflicts, ['90.025.44060/73']);
  }
});

test('an explicit CORRECAO DE CNO destination overrides quoted source data without favoring the expected work', () => {
  for (const [destination, status] of [['90.025.44060/72', 'valid'], ['90.025.44060/73', 'conflict']]) {
    const result = invoiceConstructionCno(correctedFields([correction(2,
      `CNO=90.030.04746/68, ENDERECO=RUA FICTÍCIA. CNO=90.025.44060/72, CORRECAO DE CNO ${destination}`)]));
    assert.equal(result.status, status);
    assert.deepEqual(result.numbers, [destination]);
  }
});

test('a replacement after the same CNO mention overrides its CORRECAO DE prefix', () => {
  const result = invoiceConstructionCno(correctedFields([correction(2, 'CORRECAO DE CNO 90.025.44060/73, leia-se 90.025.44060/72')]));
  assert.equal(result.status, 'valid');
  assert.deepEqual(result.numbers, ['90.025.44060/72']);
});

test('CC-e identity supports alphanumeric issuer positions and rejects letters outside the issuer', () => {
  const fieldsForKey = eventKey => ({CHAVE_ACESSO:eventKey,OBSERVACOES_NOTA:'CNO 900254406972',
    CARTAS_CORRECAO_JSON:JSON.stringify({version:1,key:eventKey,events:[{...correction(),
      eventId:`ID110110${eventKey}01`,fileName:`CCe-${eventKey}-110110-01.pdf`}]}),
  });
  const validKey = '123456'+'AB12CD34EF56'+'1'.repeat(26);
  assert.equal(invoiceConstructionCno(fieldsForKey(validKey)).status, 'valid');
  for (const invalidKey of ['A23456'+'AB12CD34EF56'+'1'.repeat(26), '123456'+'AB12CD34EF56'+'A'+'1'.repeat(25)]) {
    const result = invoiceConstructionCno(fieldsForKey(invalidKey));
    assert.equal(result.status, 'conflict');
    assert.equal(result.corrected, undefined);
  }
});

test('invalid or unrelated CC-e metadata preserves the original analysis and cannot turn a wrong CNO green', () => {
  const base = correctedFields();
  const original = {status:'conflict', numbers:['90.025.44069/72'], conflicts:['90.025.44069/72'], expected:'90.025.44060/72'};
  const invalidEvents = [
    {eventType:'110111'}, {cStat:'136'}, {cStat:135}, {protocol:'123'}, {protocol:123456789012345},
    {eventId:`ID110110${'2'.repeat(44)}01`}, {eventId:`ID110110${key}02`},
    {sequence:0}, {sequence:21}, {sequence:'1'}, {sequence:1.5}, {correction:null},
    {issuedAt:'not-a-date'}, {issuedAt:'2026-11-06T10:00:00'}, {xmlSha256:'x'.repeat(64)},
    {pdfSha256:''}, {fileName:'unrelated.pdf'}, {correction:'Endereço fictício de entrega.'},
  ];
  const invalidFields = [
    ...invalidEvents.map(change => correctedFields([{...correction(), ...change}])),
    {...base, CHAVE_ACESSO:'2'.repeat(44)}, {...base, CHAVE_ACESSO:key+'1'},
    ...['invalid', 'null', '[]', JSON.stringify({version:2,key,events:[correction()]}),
      JSON.stringify({version:1,key:'2'.repeat(44),events:[correction()]}),
      JSON.stringify({version:1,key,events:{}})].map(CARTAS_CORRECAO_JSON=>({...base,CARTAS_CORRECAO_JSON})),
  ];
  for (const fields of invalidFields) assert.deepEqual(invoiceConstructionCno(fields), original);
  assert.deepEqual(invoiceConstructionCno(correctedFields([correction(2, 'Pedido 900254406072')], '')), {
    status:'missing',numbers:[],conflicts:[],expected:'90.025.44060/72',
  });
});

test('CC-e projection is read and normalized as hidden fiscal data', async () => {
  const model = REGISTRATION_GALLERY_MODELS.notas_fiscais_sefaz;
  assert.ok(!model.fields.includes('CARTAS_CORRECAO_JSON'));
  const fields = correctedFields();
  const data = createRegistrationGalleryData({kind:'notas_fiscais_sefaz',
    siteConfig:{company:{host:'tenant.sharepoint.com',path:'/sites/company'}},tokenProvider:async()=> 'fictitious-token',
    fetchImpl:async url=>{
      let value;
      if (String(url).includes('/fields?')) value = [];
      else if (String(url).includes('/items?')) {
        assert.ok(new URL(String(url)).searchParams.get('$select').split(',').includes('CARTAS_CORRECAO_JSON'));
        value = [{Id:42,...fields}];
      } else if (String(url).includes('/_api/web/lists?')) value = [{Id:'11111111-2222-3333-4444-555555555555',Title:'NOTAS_FISCAIS_SEFAZ',BaseTemplate:100,Hidden:false}];
      else throw new Error(`Unexpected fixture request ${url}`);
      return new Response(JSON.stringify({value}),{status:200,headers:{'Content-Type':'application/json'}});
    }});
  const snapshot = await data.loadSnapshot();
  assert.equal(snapshot.rows[0].fields.CARTAS_CORRECAO_JSON, fields.CARTAS_CORRECAO_JSON);
  assert.equal(invoiceConstructionCno(snapshot.rows[0].fields).status, 'valid');
});

test('corrected invoice renders the exact green correction marker while a wrong correction remains a conflict', async t => {
  const dom = new JSDOM('<body/>'), document = dom.window.document;
  const rows = [{id:'corrected',fields:{Title:'FORNECEDOR FICTÍCIO',MODELO:'55',...correctedFields()}},
    {id:'wrong',fields:{Title:'FORNECEDOR FICTÍCIO',MODELO:'55',...correctedFields([correction(2,'CNO 900300474668')], 'CNO 900254406072')}}];
  const gallery = createRegistrationGallery({document,kind:'notas_fiscais_sefaz',data:{loadSnapshot:async()=>({rows})}});
  t.after(()=>{gallery.destroy();dom.window.close();}); await gallery.open();
  const corrected = document.querySelector('[data-registration-row="corrected"] [data-sefaz-cno]');
  assert.equal(corrected.dataset.sefazCno, 'valid');
  assert.equal(corrected.textContent, 'CNO: 90.025.44060/72 - NOTA DE CORREÇÃO');
  assert.equal(corrected.dataset.sefazCnoCorrected, 'true');
  const wrong = document.querySelector('[data-registration-row="wrong"] [data-sefaz-cno]');
  assert.equal(wrong.dataset.sefazCno, 'conflict');
  assert.match(wrong.textContent, /CNO errada/);
  assert.doesNotMatch(wrong.textContent, /NOTA DE CORREÇÃO/);
  assert.equal(document.querySelector('[data-field="CARTAS_CORRECAO_JSON"]'), null);
});

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

test('CNO does not infer a work registration from supplier, access key or order reference', () => {
  for (const fields of [{}, {Title:'CNO 900254406072'}, {CHAVE_ACESSO:'900254406072'.repeat(3)},
    ...['Pedido 900254406072', 'CNO não informado; pedido 900254406072'].map(OBSERVACOES_NOTA=>({OBSERVACOES_NOTA}))]) {
    assert.deepEqual(invoiceConstructionCno(fields), {
      status:'missing', numbers:[], conflicts:[], expected:'90.025.44060/72',
    });
  }
});

test('labeled incomplete or overlong CNO is invalid and keeps the reported number', () => {
  for (const raw of ['90.025.4406/72', '1900254406072', '9002544060721', '90.025.44060/72.9']) {
    const result = invoiceConstructionCno({OBSERVACOES_NOTA:`CNO: ${raw} RUA FICTÍCIA 134`});
    assert.equal(result.status, 'invalid');
    assert.deepEqual(result.invalidNumbers, [raw]);
  }
  assert.equal(invoiceConstructionCno({CNO:'90.025.4406/72'}).status, 'invalid');
  assert.equal(invoiceConstructionCno({OBSERVACOES_NOTA:'CNOs: 90.025.44060/72 e 90.025.4406/72'}).status, 'invalid');
  assert.equal(invoiceConstructionCno({OBSERVACOES_NOTA:'CNO 90.025.44060/72, 134 metros'}).status, 'valid');
});

test('registered correction can replace an incomplete number and cannot validate an incomplete replacement', () => {
  const incomplete = '90.025.4406/72';
  const complete = '90.025.44060/72';
  for (const [original, replacement, status] of [[incomplete, complete, 'valid'], [complete, incomplete, 'invalid']]) {
    const event = correction(1, `Onde consta CNO ${original}, leia-se ${replacement}.`);
    assert.equal(invoiceConstructionCno(correctedFields([event], `CNO ${original}`)).status, status);
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
