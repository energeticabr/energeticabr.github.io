import { REGISTRATION_GALLERY_MODELS, registrationDateKey, registrationNumber, registrationRawField } from './registration-gallery-data.js';
import { fiscalDocumentType, buyerWithholding } from './sefaz-withholding.js';
import { invoiceConstructionCno } from './sefaz-cno.js';

const model = REGISTRATION_GALLERY_MODELS.notas_fiscais_sefaz;
const text = value => String(value ?? '').trim();
const url = value => text(typeof value === 'object' ? value?.Url ?? value?.url : value);
const codes = {
  'NF-e': { '1':'Simples Nacional', '2':'Simples Nacional · excesso de sublimite', '3':'Regime normal', '4':'MEI' },
  'NFS-e': { '1':'Não optante pelo Simples Nacional', '2':'MEI', '3':'Simples Nacional · ME/EPP' },
};
export const NFE_SUPPLIER_REGIMES = [...new Set(Object.values(codes).flatMap(Object.values))];
const namespaces = { 'NF-e':'http://www.portalfiscal.inf.br/nfe', 'NFS-e':'http://www.sped.fazenda.gov.br/nfse' };
function attachmentName(value) {
  try {
    const path = new URL(url(value)).pathname;
    const name = decodeURIComponent(path.split('/').at(-1));
    return /^[^/\\]+\.pdf$/i.test(name) ? name : '';
  } catch { return ''; }
}
const nfeKey = /^[0-9]{6}[A-Z0-9]{12}[0-9]{26}$/;
const nfseKey = /^[0-9]{50}$/;

export function projectNfeRows(rows) {
  return rows.flatMap(({ id, fields = {} }) => {
    const type = fiscalDocumentType(fields);
    if (!Object.hasOwn(codes, type)) return [];
    const rawDate = registrationRawField(fields, 'DATA_EMISSAO', model);
    const date = registrationDateKey(rawDate);
    const complete = text(fields.STATUS_IMPORTACAO).toUpperCase() === 'XML_COMPLETO';
    const cancelled = text(fields.SITUACAO).toUpperCase() === 'CANCELADA';
    const retentionCode = text(fields.STATUS_RETENCOES).toUpperCase();
    const withholding = complete ? buyerWithholding(fields) : null;
    const retention = !complete ? 'unknown' : retentionCode === 'RETENCAO_INFORMADA_XML' ? 'yes'
      : retentionCode === 'NAO_INFORMADA_XML' ? 'no' : 'unknown';
    const cno = invoiceConstructionCno(fields);
    const cnoState = cno.status === 'missing' && (!complete || type === 'NFS-e') && !cno.corrected ? 'unknown' : cno.status;
    const key = text(fields.CHAVE_ACESSO);
    const validKey = (type === 'NF-e' ? nfeKey : nfseKey).test(key);
    return [{
      id:String(id), type, date, issuedAt:date ? Date.parse(rawDate.toString().includes('/') ? date : rawDate) : 0,
      supplier:text(fields.Title) || text(fields.FORNECEDOR),
      taxId:text(fields.CNPJ_FORNECEDOR), key, number:text(fields.NUMERO_NOTA),
      total:complete ? registrationNumber(fields.VALOR_TOTAL_NOTA) : null,
      retention, withholding, cno, cnoState, complete, cancelled,
      xmlUrl:complete && validKey ? url(fields.XML_URL) : '',
      pdfName:attachmentName(fields.DANFE_URL),
    }];
  }).sort((a, b) => b.date.localeCompare(a.date) || (b.issuedAt || 0) - (a.issuedAt || 0)
    || b.id.localeCompare(a.id, 'pt-BR', {numeric:true}));
}

function fiscalChild(parent, name, namespace) {
  return [...(parent?.children || [])].find(node => node.localName === name && node.namespaceURI === namespace);
}

// Read the supplemental fiscal fields only after binding the full XML to the row's access key.
export function invoiceXmlFacts(xml, { type, key }, DOMParser) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || !Object.hasOwn(codes, type)) return null;
  const namespace = namespaces[type];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (root?.namespaceURI !== namespace) return null;
  const child = (node, name) => fiscalChild(node, name, namespace);
  const regime = code => Object.hasOwn(codes[type], code) ? codes[type][code] : '';
  if (type === 'NF-e') {
    const invoice = root.localName === 'NFe' ? root : root.localName === 'nfeProc' ? child(root, 'NFe') : null;
    const info = child(invoice, 'infNFe');
    if (info?.getAttribute('Id') !== `NFe${key}` || !nfeKey.test(key)) return null;
    const code = child(child(info, 'emit'), 'CRT')?.textContent.trim();
    return { regime:regime(code) };
  }
  const info = root.localName === 'NFSe' ? child(root, 'infNFSe') : null;
  if (info?.getAttribute('Id') !== `NFS${key}` || !nfseKey.test(key)) return null;
  const dps = child(child(info, 'DPS'), 'infDPS');
  if (!dps) return null;
  const provider = child(dps, 'prest');
  const code = child(child(provider, 'regTrib'), 'opSimpNac')?.textContent.trim();
  const workCode = child(child(child(dps, 'serv'), 'obra'), 'cObra')?.textContent.trim() || '';
  const tax = child(child(dps, 'valores'), 'trib');
  const iss = child(child(tax, 'tribMun'), 'tpRetISSQN')?.textContent.trim();
  const social = child(child(child(tax, 'tribFed'), 'piscofins'), 'tpRetPisCofins')?.textContent.trim();
  // The explicit NFS-e codes also declare retention when the projected amount is absent.
  const declaresRetention = /^[23]$/.test(iss) || /^[13-9]$/.test(social);
  return { regime:regime(code), workCode, declaresRetention };
}
