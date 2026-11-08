import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { parseNfeProposalXml } from '../src/chat/nfe-proposal-xml.js';

const dom = new JSDOM();
test.after(() => dom.window.close());

const key = '35261112345678000123550010000000011000000012';
const row = { type:'NF-e', key, date:'2026-11-06' };
const service = readFileSync(new URL('../../../backend-patches/notas-fiscais-cte-nfse/tests/fixtures/nfse-ficticia.xml', import.meta.url), 'utf8');
const serviceRow = { type:'NFS-e', key:'35503081212345678000123000000000123261000000000111', date:'2026-10-20' };

const nfe = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${key}">
  <ide><dhEmi>2026-11-06T23:51:00-03:00</dhEmi></ide>
  <det nItem="1"><prod><cProd>A-1</cProd><xProd>Cabo &amp; conexão</xProd><uCom>M</uCom>
    <qCom>3.2500</qCom><vUnCom>10.1234567890</vUnCom><vProd>32.90</vProd>
    <vFrete>1.00</vFrete><vDesc>2.90</vDesc><indTot>1</indTot></prod></det>
  <det nItem="2"><prod><cProd>B-2</cProd><xProd>Fixador</xProd><uCom>UN</uCom>
    <qCom>2.0000</qCom><vUnCom>15.0000</vUnCom><vProd>30.00</vProd>
    <vSeg>0.50</vSeg><indTot>1</indTot></prod><imposto><IPI><IPITrib><vIPI>1.00</vIPI></IPITrib></IPI></imposto></det>
  <total><ICMSTot><vProd>62.90</vProd><vFrete>1.00</vFrete><vSeg>0.50</vSeg>
    <vDesc>2.90</vDesc><vIPI>1.00</vIPI><vNF>62.50</vNF></ICMSTot></total>
  <cobr><fat><vOrig>65.40</vOrig><vDesc>2.90</vDesc><vLiq>62.50</vLiq></fat>
    <dup><nDup>001</nDup><dVenc>2026-12-06</dVenc><vDup>62.50</vDup></dup></cobr>
</infNFe></NFe></nfeProc>`;

function parse(xml = nfe, invoice = row) {
  return parseNfeProposalXml(xml, invoice, dom.window.DOMParser);
}

test('preserves original commercial quantity and price, product discount and declared charges on their respective lines', () => {
  assert.deepEqual(parse(), {
    issueDate:'2026-11-06', dueDate:'2026-12-06', total:'62.5', lines:[
      { number:'1', code:'A-1', description:'Cabo & conexão', unit:'M', quantity:'3.25', unitPrice:'10.123456789', discount:'2.9', adjustment:'1' },
      { number:'2', code:'B-2', description:'Fixador', unit:'UN', quantity:'2', unitPrice:'15', discount:'0', adjustment:'1.5' },
    ],
  });
});

test('allocates only the residual invoice discount and a separate documented billing discount, including the odd cent', () => {
  const xml = nfe.replace('<vDesc>2.90</vDesc><vIPI>', '<vDesc>5.91</vDesc><vIPI>')
    .replace('<vNF>62.50</vNF>', '<vNF>59.49</vNF>')
    .replace('<vOrig>65.40</vOrig><vDesc>2.90</vDesc><vLiq>62.50</vLiq>', '<vOrig>59.49</vOrig><vDesc>2.00</vDesc><vLiq>57.49</vLiq>')
    .replace('<vDup>62.50</vDup>', '<vDup>57.49</vDup>');
  const proposal = parse(xml);
  assert.equal(proposal.total, '57.49');
  assert.deepEqual(proposal.lines.map(line => line.discount), ['5.4', '2.51']);
});

test('counts only the additional amount when the billing discount includes the fiscal discount', () => {
  const xml = nfe.replace('<vOrig>65.40</vOrig><vDesc>2.90</vDesc><vLiq>62.50</vLiq>',
    '<vOrig>65.40</vOrig><vDesc>4.90</vDesc><vLiq>60.50</vLiq>').replace('<vDup>62.50</vDup>', '<vDup>60.50</vDup>');
  const proposal = parse(xml);
  assert.equal(proposal.total, '60.5');
  assert.deepEqual(proposal.lines.map(line => line.discount), ['3.89', '1.01']);
});

test('carries a documented one-cent product rounding difference in the adjustment without changing the price', () => {
  const proposal = parse(nfe.replace('<vProd>32.90</vProd>', '<vProd>32.91</vProd>')
    .replace('<vProd>62.90</vProd>', '<vProd>62.91</vProd>')
    .replaceAll('62.50', '62.51').replace('65.40', '65.41'));
  assert.equal(proposal.lines[0].unitPrice, '10.123456789');
  assert.equal(proposal.lines[0].adjustment, '1.01');
  assert.equal(proposal.total, '62.51');
});

test('leaves the due date blank when the XML has distinct installment due dates', () => {
  const xml = nfe.replace('<vDup>62.50</vDup></dup>', '<vDup>31.25</vDup></dup><dup><nDup>002</nDup><dVenc>2027-01-06</dVenc><vDup>31.25</vDup></dup>');
  assert.equal(parse(xml).dueDate, '');
  assert.equal(parse(xml.replace('2027-01-06', '2026-12-06')).dueDate, '2026-12-06');
});

test('keeps an item excluded from the fiscal subtotal without adding its gross amount to the proposal', () => {
  const xml = nfe.replace('<vSeg>0.50</vSeg><indTot>1</indTot>', '<vSeg>0.50</vSeg><indTot>0</indTot>')
    .replace('<vProd>62.90</vProd>', '<vProd>32.90</vProd>')
    .replaceAll('62.50', '32.50').replace('65.40', '35.40');
  const proposal = parse(xml);
  assert.equal(proposal.total, '32.5');
  assert.deepEqual(proposal.lines.map(({ quantity, unitPrice, adjustment }) => [quantity, unitPrice, adjustment]), [
    ['3.25','10.123456789','1'], ['2','15','-28.5'],
  ]);
});

test('deducts declared ICMS relief only when included in the fiscal total and rejects invalid values', () => {
  const xml = nfe.replace('<imposto><IPI>', '<imposto><ICMS><ICMS40><vICMSDeson>0.30</vICMSDeson></ICMS40></ICMS><IPI>')
    .replace('<vIPI>1.00</vIPI><vNF>', '<vIPI>1.00</vIPI><vICMSDeson>0.30</vICMSDeson><vNF>');
  assert.equal(parse(xml).lines[1].adjustment, '1.5');
  const deducted = xml.replaceAll('62.50', '62.20').replace('65.40', '65.10');
  assert.equal(parse(deducted).lines[1].adjustment, '1.2');
  assert.throws(() => parse(deducted.replace('0.30</vICMSDeson></ICMS40>', 'Infinity</vICMSDeson></ICMS40>')), /vICMSDeson.*inválido/i);
  assert.throws(() => parse(deducted.replace('</ICMS40>', '<indDeduzDeson>0</indDeduzDeson></ICMS40>')), /total.*NF-e/i);
});

test('represents the national NFS-e service with only the unconditional discount and its actual issue date', () => {
  const xml = service.replace('<cServ>', '<cServ><cTribNac>070202</cTribNac>')
    .replace('<dhEmi>2026-10-20', '<dhEmi>2026-10-19');
  assert.deepEqual(parse(xml, serviceRow), {
    issueDate:'2026-10-20', dueDate:'', total:'980', lines:[
      { number:'1', code:'070202', description:'Servico <b>literal</b>', unit:'', quantity:'1', unitPrice:'1000', discount:'20', adjustment:'0' },
    ],
  });
});

test('rejects invoice totals or item gross values that cannot be explained by the fiscal fields', () => {
  assert.throws(() => parse(nfe.replace('<vNF>62.50</vNF>', '<vNF>62.60</vNF>')), /total.*NF-e/i);
  assert.throws(() => parse(nfe.replace('<vProd>62.90</vProd>', '<vProd>62.00</vProd>')), /valor.*produtos/i);
  assert.throws(() => parse(nfe.replace('<vProd>32.90</vProd>', '<vProd>32.80</vProd>')), /quantidade.*unitário.*item 1/i);
  assert.throws(() => parse(nfe.replace('<vDesc>2.90</vDesc><vIPI>', '<vDesc>1.90</vDesc><vIPI>')), /desconto.*itens/i);
  assert.throws(() => parse(nfe.replace('<vOrig>65.40</vOrig>', '<vOrig>64.40</vOrig>')), /fatura/i);
});

test('requires a matching fiscal XML with unambiguous lines and emission', () => {
  assert.throws(() => parse(nfe, { ...row, key:'9'.repeat(44) }), /chave/i);
  assert.throws(() => parse(nfe, serviceRow), /tipo/i);
  assert.throws(() => parse(`<!DOCTYPE nfeProc>${nfe}`), /XML.*inválido/i);
  assert.throws(() => parse(nfe.replace('</infNFe>', '')), /XML.*inválido/i);
  assert.throws(() => parse(nfe.replace('nItem="2"', 'nItem="1"')), /item.*repetido/i);
  assert.throws(() => parse(nfe.replace('<xProd>Fixador</xProd>', '<xProd/>')), /xProd.*item 2/i);
  assert.throws(() => parse(nfe.replace('<qCom>2.0000</qCom>', '<qCom>2.0000</qCom><qCom>3.0000</qCom>')), /qCom.*ambíguo/i);
  assert.throws(() => parse(nfe, { ...row, date:'2026-11-07' }), /emissão/i);
});
