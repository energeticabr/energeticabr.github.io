import Decimal from 'decimal.js';
import { nfeAttachmentNames } from './nfe-proposal-attachments.js';
import { provisionTextTotal } from '../../../../portal/forms/provision-parent-workflow.js';
import { buildNfeProposal, nfeProposalAmounts, nfeProposalKey, validateNfeProposal } from './nfe-proposal-model.js';
import {
  createNfeProposalPosting, decodeNfeStoredRecord, NFE_LEARNING_FIELD, NFE_LEARNING_SCOPE,
} from './nfe-proposal-posting.js';
import { createNfeLearningExample, createNfeLearningModel, nfeLearningIssuerHash } from './nfe-proposal-learning.js';
import { nfeOrderId, NFE_ORDER_FIELD, NFE_PROVISION_DESCRIPTION_FIELD } from './nfe-order-link.js';
import { parseNfeProposalXml } from './nfe-proposal-xml.js';

const clean = value => String(value ?? '').trim();
const sortable = (left, right) => left.label.localeCompare(right.label, 'pt-BR', { numeric:true });
const available = value => !['inativo','inativa','bloqueado','bloqueada','cancelado','cancelada'].includes(nfeProposalKey(value));
const iso = day => `${day}T12:00:00Z`;
const FISCAL_NUMBER = /^\d{1,12}$/;
const ProvisionDecimal = Decimal.clone({ precision:60 });
const legacyUnitDraft = draft => draft.lines?.length > 0 && draft.lines.every(line =>
  typeof line.unitReviewed === 'boolean' && !Object.hasOwn(line, 'unit'));

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

function normalizedDraft(draft, { supplier, branch, account, date, paymentDate, lines }, { legacyUnits = false } = {}) {
  return {
    supplierId:supplier.id, branchId:branch.id, accountId:account?.id ?? '', date,
    ...(paymentDate ? { paymentDate } : {}),
    ...(draft.reviewStamp ? { reviewStamp:draft.reviewStamp } : {}),
    lines:lines.map(line => ({ number:line.number, productId:line.product.id, stageId:line.stage.id,
      quantity:line.quantity, unitPrice:line.unitPrice, adjustment:line.adjustment, discount:line.discount,
      date:line.date, dueDate:line.dueDate,
      ...(legacyUnits ? { unitReviewed:line.unitReviewed } : { unit:line.unit }) })),
  };
}

export function materializeNfeProposal(row, fiscal, draft, catalog, options = {}) {
  const result = validateNfeProposal(draft, fiscal, catalog, options);
  const { supplier, branch, account, date, lines } = result;
  const number = clean(row.number);
  const fiscalLabel = `${row.type}${number ? ` nº ${number}` : ''}`;
  const source = `${fiscalLabel} · Chave ${row.key}`;
  const launchFields = lines.map(line => {
    const { product, stage } = line;
    const fields = {
      Title:branch.label, field_1:'CUSTO', field_2:iso(line.date),
      ...(line.dueDate ? { field_3:iso(line.dueDate) } : {}),
      ...(result.paymentDate ? { field_4:iso(result.paymentDate) } : {}),
      field_5:supplier.label, field_6:stage.label, field_7:product.label,
      field_8:Number(line.quantity), field_9:Number(line.unitPrice), field_10:line.netAdjustment,
      field_14:account.label,
      field_16:`${fiscalLabel} · Item ${line.number}: ${line.description}`,
      ...(FISCAL_NUMBER.test(number) ? { field_18:Number(number) } : {}),
      field_19:'PEDIDO FINALIZADO', field_20:`APP-NFE-${row.key}-${line.number}`,
      TIPODESPESA:product.expenseType, UN:line.unit,
      ...(product.disburses ? { GERADESEMBOLSO:product.disburses } : {}),
      APROVACAO:'PENDENTE DE APROVAÇÃO',
    };
    return { number:line.number, fields };
  });
  return {
    draft:normalizedDraft(draft, result, options),
    orderFields:{
      Title:`APP-NFE-${row.key}`, FILIAL:branch.label, FORNECEDOR:supplier.label,
      VALORTOTAL:result.total.replace('.', ','), DATAPEDIDO:iso(date), STATUS:'PENDENTE AUDITORIA',
      NOTAFISCAL:'SUBMETIDO', OBS:source, OBSFISCAL:source, ...(number ? { NF:number } : {}),
      FORMAPGTO:account.label,
    },
    launchFields,
  };
}

export function materializeNfeProvision(row, fiscal, draft, catalog, options = {}) {
  const result = validateNfeProposal(draft, fiscal, catalog, { ...options, provision:true });
  const { supplier, branch, account, lines, total } = result;
  const fiscalLabel = `${row.type} nº ${row.number || row.id}`;
  const source = `${fiscalLabel} · Chave ${row.key}`;
  const title = `APP-NFE-${row.key}`;
  const common = { FILIAL:branch.label, FORNECEDOR:supplier.label, FORMAPGTO:account?.label ?? null, STATUS:'PAGAMENTO PREVISTO' };
  const provisionFields = lines.map(line => {
    const net = new ProvisionDecimal(nfeProposalAmounts(line).total.toFixed(2));
    const quantity = new ProvisionDecimal(line.quantity);
    const originalPrice = new ProvisionDecimal(line.unitPrice);
    // The provision recalculates total from QTD × VALORTOTAL + FRETE.
    // When a discount lowers the unit price, retain the exact residual so the descritivo still reconciles.
    const price = ProvisionDecimal.min(originalPrice, net.div(quantity).toDecimalPlaces(12, ProvisionDecimal.ROUND_DOWN));
    const remainder = net.minus(price.times(quantity));
    return { number:line.number, fields:{
      ...common, Title:`${title}-${line.number}`, PRODUTO:line.product.label, ETAPA:line.stage.label,
      DATA:iso(line.date), DATAPREVISTOPGTO:iso(line.dueDate), PGTOAGENDADO:'PENDENTE',
      QTD:provisionTextTotal(line.quantity), VALORTOTAL:provisionTextTotal(price.toFixed()), FRETE:provisionTextTotal(remainder.toFixed()),
      OBS:(options.legacyUnits
        ? `${fiscalLabel} · Item ${line.number}: ${line.description}`
        : `${fiscalLabel} · Item ${line.number} · ${line.quantity} ${line.unit}: ${line.description}`).slice(0,255),
    } };
  });
  const firstDueDate = lines.map(line => line.dueDate).sort()[0];
  return {
    draft:normalizedDraft(draft, result, options),
    parentFields:{ ...common, Title:title, OBS:source, VALORTOTAL:provisionTextTotal(total), DATAPREVISTOPGTO:iso(firstDueDate) },
    provisionFields,
  };
}

export function createNfeProposalData({ repository, fiscalData, tokenProvider, siteConfig,
  accountKey, userEmail, assertSession = () => {}, DOMParser = globalThis.DOMParser, provision = false }) {
  const active = signal => { assertSession(); signal?.throwIfAborted(); };
  const learner = clean(accountKey || userEmail).toLowerCase();

  async function learningIdentity(row) {
    if (!learner) return null;
    const issuer = await nfeLearningIssuerHash(row);
    if (!issuer) return null;
    return { invoice:{ ...row, learningIssuerHash:issuer }, scope:await fingerprint(JSON.stringify([learner, issuer])) };
  }

  async function loadExamples(row, signal) {
    const identity = await learningIdentity(row);
    active(signal);
    if (!identity) return null;
    const { invoice, scope } = identity;
    const examples = [];
    try {
      const list = await repository.resolveList('company', ['NOTAS_FISCAIS_SEFAZ'], { signal });
      if (list?.status !== 'resolved' || !list.id) return { invoice, examples };
      const select = [NFE_ORDER_FIELD, NFE_PROVISION_DESCRIPTION_FIELD, NFE_LEARNING_FIELD, NFE_LEARNING_SCOPE].join(',');
      const items = await repository.getItems('company', list.id,
        `$select=${select}&$filter=${NFE_LEARNING_SCOPE} eq '${scope}'&$top=200`, { signal });
      active(signal);
      if (!Array.isArray(items)) return { invoice, examples };
      for (const item of items) {
        const fields = item?.fields;
        const linked = nfeOrderId(fields?.[NFE_ORDER_FIELD]) || nfeOrderId(fields?.[NFE_PROVISION_DESCRIPTION_FIELD]);
        if (!linked || String(item.id) === String(row.id) || fields[NFE_LEARNING_SCOPE] !== scope) continue;
        try {
          const example = JSON.parse(await decodeNfeStoredRecord(fields[NFE_LEARNING_FIELD]));
          if (example?.version === 1 && example.issuer === invoice.learningIssuerHash && Number.isFinite(example.at)) examples.push(example);
        } catch { /* Ignore malformed examples and retain the verified history. */ }
      }
      active(signal);
      examples.sort((left, right) => right.at - left.at);
    } catch {
      active(signal);
    }
    return { invoice, examples };
  }
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
      history:[...(usage || [])].sort((left, right) => Number(right.id) - Number(left.id))
        .map(({fields}) => ({ product:fields.field_7, stage:fields.field_6, branch:fields.Title })),
      historyUnavailable:usage === null,
    };
  }

  async function loadXml(row, signal) {
    if (!row.xmlUrl || !row.complete) throw new Error('A nota precisa ter o XML completo para gerar a proposta.');
    const file = await fiscalData.downloadDocument(row.xmlUrl, { signal });
    const xml = await file.text();
    active(signal);
    return { fiscal:parseNfeProposalXml(xml, row, DOMParser, { provision }), xmlHash:await fingerprint(xml) };
  }

  async function downloadAttachments(row, { signal } = {}) {
    const attachments = await fiscalData.listAttachments(row.id, { signal, refresh:true });
    const names = nfeAttachmentNames(Array.isArray(attachments) ? attachments.map(file => file?.fileName) : null, row.pdfName);
    const files = [];
    for (const name of names) {
      active(signal);
      const blob = await fiscalData.downloadAttachment(row.id, name, { signal });
      if (typeof blob?.arrayBuffer !== 'function') throw new Error(`O anexo ${name} não pôde ser lido.`);
      files.push(new File([blob], name, { type:/\.pdf$/i.test(name) ? 'application/pdf' : blob.type }));
    }
    const latest = await fiscalData.listAttachments(row.id, { signal, refresh:true });
    const confirmed = nfeAttachmentNames(Array.isArray(latest) ? latest.map(file => file?.fileName) : null, row.pdfName);
    if (JSON.stringify(names) !== JSON.stringify(confirmed)) throw new Error('Os anexos da nota mudaram. Tente novamente para incluir todos.');
    active(signal);
    return files;
  }

  const posting = createNfeProposalPosting({
    repository, assertSession, authorizeWrite, downloadAttachments, provision,
    resolveLearningScope:async row => (await learningIdentity(row))?.scope,
    async prepare(row, draft, { signal, baseline, manualStages, reserved }) {
      const [{ fiscal, xmlHash }, catalog] = await Promise.all([loadXml(row, signal), loadCatalog(signal)]);
      active(signal);
      if (draft.reviewStamp !== await reviewStamp(draft, catalog, xmlHash)) {
        throw new Error('O XML ou os cadastros desta proposta mudaram. Reabra o relatório para conferir os dados.');
      }
      // Regenerate old frozen plans exactly; their hashes also protect partially posted records.
      const legacyUnits = reserved && legacyUnitDraft(draft);
      const legacyPaymentDate = reserved && !Object.hasOwn(draft, 'paymentDate');
      const proposal = (provision ? materializeNfeProvision : materializeNfeProposal)(row, fiscal, draft, catalog, { legacyUnits, legacyPaymentDate });
      if (baseline) {
        const identity = await learningIdentity(row);
        const example = identity && createNfeLearningExample(identity.invoice, fiscal, baseline, proposal.draft, manualStages);
        if (example) proposal.learning = { scope:identity.scope, example };
      }
      return proposal;
    },
  });

  return Object.freeze({
    async load(row, { signal } = {}) {
      const reserved = await posting.loadReservation(row, { signal });
      await authorizeWrite({ signal });
      const [{ fiscal, xmlHash }, catalog, learning] = await Promise.all([
        loadXml(row, signal), loadCatalog(signal, !reserved), reserved ? null : loadExamples(row, signal),
      ]);
      active(signal);
      if (learning?.examples.length) {
        const model = createNfeLearningModel(learning.examples, learning.invoice, fiscal, catalog);
        const lines = new Map(fiscal.lines.map(line => [line.number, line]));
        catalog.learning = { ...model,
          stage:(number, branchId, productId, supplierId) => model.stage(lines.get(number), branchId, productId, supplierId),
        };
      }
      const draft = reserved || buildNfeProposal(row, fiscal, catalog);
      const baseline = learning ? { ...draft, lines:draft.lines.map(line => ({ ...line })) } : null;
      return { fiscal, catalog, xmlHash, draft, baseline, reserved:Boolean(reserved),
        legacyUnits:Boolean(reserved) && legacyUnitDraft(draft) };
    },
    loadReservation:posting.loadReservation,
    async submit(row, draft, { signal, catalog, xmlHash, onProgress, baseline, manualStages } = {}) {
      const reviewed = draft.reviewStamp ? draft : { ...draft, reviewStamp:await reviewStamp(draft, catalog, xmlHash) };
      active(signal);
      return posting.submit(row, reviewed, { signal, onProgress, baseline, manualStages });
    },
  });
}
