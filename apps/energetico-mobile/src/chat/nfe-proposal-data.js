import { validateAttachment } from '../../../../portal/data/attachments.js';
import { buildNfeProposal, nfeProposalKey, validateNfeProposal } from './nfe-proposal-model.js';
import { createNfeProposalPosting } from './nfe-proposal-posting.js';
import { parseNfeProposalXml } from './nfe-proposal-xml.js';

const clean = value => String(value ?? '').trim();
const sortable = (left, right) => left.label.localeCompare(right.label, 'pt-BR', { numeric:true });
const available = value => !['inativo','inativa','bloqueado','bloqueada','cancelado','cancelada'].includes(nfeProposalKey(value));
const iso = day => `${day}T12:00:00Z`;
const FISCAL_NUMBER = /^\d{1,12}$/;

async function fingerprint(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function reviewStamp(draft, catalog, xmlHash) {
  const get = (options, id) => options.find(option => option.id === id);
  const supplier = get(catalog.suppliers, draft.supplierId);
  const branch = get(catalog.branches, draft.branchId);
  const account = get(catalog.accounts, draft.accountId);
  return fingerprint(JSON.stringify([xmlHash, supplier?.label, supplier?.branch, branch?.label, account?.label,
    draft.lines.map(line => {
      const product = get(catalog.products, line.productId), stage = get(catalog.stages, line.stageId);
      return [product?.label, product?.unit, product?.expenseType, product?.disburses, stage?.label, stage?.branch];
    }),
  ]));
}

function options(items, fields, { status = 'STATUS', filter = () => true } = {}) {
  return items.filter(item => available(item.fields[status]) && filter(item.fields)).map(item => ({
    id:String(item.id),
    ...Object.fromEntries(Object.entries(fields).map(([key,name]) => [key, clean(item.fields[name])])),
  })).filter(item => item.label).sort(sortable);
}

export function materializeNfeProposal(row, fiscal, draft, catalog) {
  const result = validateNfeProposal(draft, fiscal, catalog);
  const { supplier, branch, account, date, lines } = result;
  const number = clean(row.number);
  const fiscalLabel = `${row.type}${number ? ` nº ${number}` : ''}`;
  const source = `${fiscalLabel} · Chave ${row.key}`;
  const launchFields = lines.map(line => {
    const { product, stage } = line;
    const fields = {
      Title:branch.label, field_1:'CUSTO', field_2:iso(line.date),
      ...(line.dueDate ? { field_3:iso(line.dueDate) } : {}),
      field_5:supplier.label, field_6:stage.label, field_7:product.label,
      field_8:Number(line.quantity), field_9:Number(line.unitPrice), field_10:line.netAdjustment,
      field_14:account.label,
      field_16:`${fiscalLabel} · Item ${line.number}: ${line.description}`,
      ...(FISCAL_NUMBER.test(number) ? { field_18:Number(number) } : {}),
      field_19:'PEDIDO FINALIZADO', field_20:`APP-NFE-${row.key}-${line.number}`,
      TIPODESPESA:product.expenseType, UN:product.unit,
      ...(product.disburses ? { GERADESEMBOLSO:product.disburses } : {}),
      APROVACAO:'PENDENTE DE APROVAÇÃO',
    };
    return { number:line.number, fields };
  });
  return {
    draft:{ supplierId:supplier.id, branchId:branch.id, accountId:account.id, date,
      ...(draft.reviewStamp ? { reviewStamp:draft.reviewStamp } : {}),
      lines:lines.map(line => ({ number:line.number, productId:line.product.id, stageId:line.stage.id,
        quantity:line.quantity, unitPrice:line.unitPrice, adjustment:line.adjustment, discount:line.discount,
        date:line.date, dueDate:line.dueDate, unitReviewed:line.unitReviewed })) },
    orderFields:{
      Title:`APP-NFE-${row.key}`, FILIAL:branch.label, FORNECEDOR:supplier.label,
      VALORTOTAL:result.total.replace('.', ','), DATAPEDIDO:iso(date), STATUS:'PENDENTE AUDITORIA',
      NOTAFISCAL:'SUBMETIDO', OBS:source, OBSFISCAL:source, ...(number ? { NF:number } : {}),
      FORMAPGTO:account.label,
    },
    launchFields,
  };
}

export function createNfeProposalData({ repository, fiscalData, tokenProvider, siteConfig,
  assertSession = () => {}, DOMParser = globalThis.DOMParser }) {
  const active = signal => { assertSession(); signal?.throwIfAborted(); };
  async function authorizeWrite({ signal } = {}) {
    active(signal);
    if (typeof tokenProvider !== 'function') return;
    for (const scopes of [['Sites.ReadWrite.All'],
      [`https://${siteConfig.personal.host}/AllSites.Write`], [`https://${siteConfig.company.host}/AllSites.Write`]]) {
      if (!await tokenProvider(scopes)) throw new Error('Não foi possível autorizar a gravação no SharePoint.');
      active(signal);
    }
  }

  async function items(names, fields, signal) {
    active(signal);
    const list = await repository.resolveList('personal', names, { signal });
    if (list?.status !== 'resolved' || !list.id) throw new Error(`O cadastro ${names[0]} está indisponível.`);
    const rows = await repository.getItems('personal', list.id,
      `$select=id&$expand=fields($select=${fields.join(',')})&$top=200`, { signal });
    active(signal);
    if (!Array.isArray(rows) || rows.some(row => !/^\d+$/.test(String(row?.id)) || !row.fields)) {
      throw new Error(`A consulta de ${names[0]} está incompleta.`);
    }
    return rows;
  }

  async function loadCatalog(signal, history = false) {
    const [suppliers, branches, products, stages, accounts, usage] = await Promise.all([
      items(['FORNECEDORES'], ['Title','DOCUMENTOFORNECEDOR','FILIAL','FORMAPGTO','STATUS'], signal),
      items(['FILIAIS'], ['Title','STATUS'], signal),
      items(['CADASTROPRODUTO','CADASTRO PRODUTO'], ['field_1','SATUS','TIPO','TIPODESPESA','UNIDADE','GERADESEMBOLSO'], signal),
      items(['LANCAMENTOOBRA','LANCAMENTO OBRA'], ['field_3','FILIAL','STATUS'], signal),
      items(['CADASTROCONTA'], ['Title','STATUS'], signal),
      history ? items(['LANCAMENTOS'], ['Title','field_6','field_7'], signal).catch(() => { active(signal); return null; }) : [],
    ]);
    return {
      suppliers:options(suppliers,{ label:'Title',taxId:'DOCUMENTOFORNECEDOR',branch:'FILIAL',account:'FORMAPGTO' }),
      branches:options(branches,{ label:'Title' }),
      products:options(products,{ label:'field_1',unit:'UNIDADE',expenseType:'TIPODESPESA',disburses:'GERADESEMBOLSO' },
        { status:'SATUS',filter:fields => nfeProposalKey(fields.TIPO) !== 'receita' }),
      stages:options(stages,{ label:'field_3',branch:'FILIAL' }),
      accounts:options(accounts,{ label:'Title' }),
      history:(usage || []).map(({fields}) => ({ product:fields.field_7, stage:fields.field_6, branch:fields.Title })),
      historyUnavailable:usage === null,
    };
  }

  async function loadXml(row, signal) {
    if (!row.xmlUrl || !row.complete) throw new Error('A nota precisa ter o XML completo para gerar a proposta.');
    const file = await fiscalData.downloadDocument(row.xmlUrl, { signal });
    const xml = await file.text();
    active(signal);
    return { fiscal:parseNfeProposalXml(xml, row, DOMParser), xmlHash:await fingerprint(xml) };
  }

  async function downloadPdf(row, { signal } = {}) {
    const attachments = await fiscalData.listAttachments(row.id, { signal, refresh:true });
    if (attachments.filter(file => file.fileName === row.pdfName).length !== 1) {
      throw new Error('O PDF fiscal original não foi encontrado nos anexos da nota.');
    }
    const blob = await fiscalData.downloadAttachment(row.id, row.pdfName, { signal });
    const file = new File([blob], row.pdfName, { type:'application/pdf' });
    const check = validateAttachment(file);
    if (!check.valid) throw new Error(check.message);
    active(signal);
    return file;
  }

  const posting = createNfeProposalPosting({
    repository, assertSession, authorizeWrite, downloadPdf,
    async prepare(row, draft, { signal }) {
      const [{ fiscal, xmlHash }, catalog] = await Promise.all([loadXml(row, signal), loadCatalog(signal)]);
      active(signal);
      if (draft.reviewStamp !== await reviewStamp(draft, catalog, xmlHash)) {
        throw new Error('O XML ou os cadastros desta proposta mudaram. Reabra o relatório para conferir os dados.');
      }
      return materializeNfeProposal(row, fiscal, draft, catalog);
    },
  });

  return Object.freeze({
    async load(row, { signal } = {}) {
      const reserved = await posting.loadReservation(row, { signal });
      await authorizeWrite({ signal });
      const [{ fiscal, xmlHash }, catalog] = await Promise.all([loadXml(row, signal), loadCatalog(signal, !reserved)]);
      active(signal);
      return { fiscal, catalog, xmlHash, draft:reserved || buildNfeProposal(row, fiscal, catalog), reserved:Boolean(reserved) };
    },
    loadReservation:posting.loadReservation,
    async submit(row, draft, { signal, catalog, xmlHash, onProgress } = {}) {
      const reviewed = draft.reviewStamp ? draft : { ...draft, reviewStamp:await reviewStamp(draft, catalog, xmlHash) };
      active(signal);
      return posting.submit(row, reviewed, { signal, onProgress });
    },
  });
}
