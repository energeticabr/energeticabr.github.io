import { PROVISION_FISCAL_DRAFT_STATUS } from '../../../../portal/forms/provision-parent-due.js';
import { NFE_ORDER_FIELD, NFE_PROVISION_DESCRIPTION_FIELD, nfeOrderId } from './nfe-order-link.js';
import { fiscalDocumentType } from './sefaz-withholding.js';
import { nfeAttachmentNames, nfeAttachmentFingerprint } from './nfe-proposal-attachments.js';

const RESERVATION = 'NFEPROPOSTA';
export const NFE_LEARNING_FIELD = 'NFEAPRENDIZADO';
export const NFE_LEARNING_SCOPE = 'NFEAPRENDIZCHAVE';
const LEARNING_FIELDS = [NFE_LEARNING_FIELD, NFE_LEARNING_SCOPE];
const ORDER_ORIGIN = 'NFEORIGEM';
const LINE_ORIGIN = 'NFELINHA';
const ORDER_FISCAL_STATUS = 'NOTAFISCAL';
const ORDER_PENDING = 'PENDENTE';
const ORDER_SUBMITTED = 'SUBMETIDO';
const INVOICE_FIELDS = [NFE_ORDER_FIELD, NFE_PROVISION_DESCRIPTION_FIELD, RESERVATION, 'CHAVE_ACESSO', 'TIPO_FISCAL', 'MODELO',
  'DIRECAO', 'PAPEL_EMPRESA', 'STATUS_IMPORTACAO', 'SITUACAO', 'STATUS_DANFE', 'DANFE_URL', 'XML_URL', 'NUMERO_NOTA'];
const KEY_PATTERN = { 'NF-e':/^[0-9]{6}[A-Z0-9]{12}[0-9]{26}$/, 'NFS-e':/^\d{50}$/ };
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RESERVATION_LIMIT = 63000;
const RESERVATION_EXPANDED_LIMIT = 4 * 1024 * 1024;
const GZIP_PREFIX = 'gzip:';
const READBACK_BATCH_SIZE = 6;
const reservedFields = new Set([RESERVATION, ORDER_ORIGIN, LINE_ORIGIN, 'AGRUPAR', 'DESCRITIVOPROVISAO', 'IDPEDIDO', 'ID']);
const civilDateFields = new Set(['DATAPEDIDO', 'field_2', 'field_3', 'DATA', 'DATAPREVISTOPGTO']);
const civilDate = /^\d{4}-\d{2}-\d{2}(?:$|T)/;
const blank = value => value == null || value === '';
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const code = value => String(value ?? '').trim().toUpperCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
// Older apps only read IDPEDIDO and NFEPROPOSTA; keep the latter occupied
// after a provision is linked so those versions cannot post an order too.
const provisionLinkMarker = id => JSON.stringify({ version:2, provisionDescriptionId:id });

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  throw new TypeError('A proposta contém um valor inválido.');
}

function fileName(value) {
  const name = String(value ?? '');
  return name.length <= 255 && /^[^/\\\u0000-\u001f]+\.pdf$/i.test(name) ? name : '';
}

function fiscalPdfName(value) {
  try {
    const url = new URL(value?.Url ?? value?.url ?? value);
    return url.protocol === 'https:' ? fileName(decodeURIComponent(url.pathname.split('/').at(-1))) : '';
  } catch { return ''; }
}

function fiscalXmlUrl(value) {
  try {
    const url = new URL(String(value?.Url ?? value?.url ?? value ?? '').trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

const fiscalNumber = value => String(value ?? '').trim();

async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
}

function payloadFields(fields, extraFields) {
  if (!record(fields) || !Object.keys(fields).length || Object.keys(fields).length + extraFields > 32
    || Object.keys(fields).some(name => !FIELD_NAME.test(name) || reservedFields.has(name.toUpperCase()))) {
    throw new Error('Os campos do lançamento fiscal estão inválidos.');
  }
  return fields;
}

function normalizePayload(payload, headerKey, linesKey) {
  const lines = payload?.[linesKey];
  if (!record(payload?.draft) || !Array.isArray(lines) || !lines.length) {
    throw new Error('A proposta fiscal não contém itens válidos.');
  }
  const seen = new Set();
  const lineFields = lines.map(({ number, fields }) => {
    const fiscalLine = nfeOrderId(number);
    if (!fiscalLine || seen.has(fiscalLine)) throw new Error('A linha fiscal está inválida ou repetida.');
    seen.add(fiscalLine);
    return { number:fiscalLine, fields:payloadFields(fields, 2) };
  });
  return JSON.parse(canonicalJson({ draft:payload.draft, [headerKey]:payloadFields(payload[headerKey], 1), [linesKey]:lineFields }));
}

async function encodeReservation(value) {
  const json = canonicalJson(value);
  if (json.length <= RESERVATION_LIMIT) return json;
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength <= RESERVATION_EXPANDED_LIMIT) {
    const { default:pako } = await import('pako');
    const buffer = pako.gzip(bytes);
    if (GZIP_PREFIX.length + 4 * Math.ceil(buffer.length / 3) <= RESERVATION_LIMIT) {
      let binary = '';
      for (let offset = 0; offset < buffer.length; offset += 8192) {
        binary += String.fromCharCode(...buffer.subarray(offset, offset + 8192));
      }
      return GZIP_PREFIX + btoa(binary);
    }
  }
  throw new Error('A proposta excede o tamanho aceito pela reserva fiscal.');
}

export async function decodeNfeStoredRecord(value) {
  if (typeof value !== 'string' || value.length > RESERVATION_LIMIT) throw new Error();
  if (!value.startsWith(GZIP_PREFIX)) return value;
  const bytes = Uint8Array.from(atob(value.slice(GZIP_PREFIX.length)), character => character.charCodeAt(0));
  const { default:pako } = await import('pako');
  const inflater = new pako.Inflate({ chunkSize:32768 });
  const decoder = new TextDecoder('utf-8', { fatal:true });
  let length = 0, json = '';
  inflater.onData = chunk => {
    length += chunk.byteLength;
    if (length > RESERVATION_EXPANDED_LIMIT) throw new Error();
    json += decoder.decode(chunk, { stream:true });
  };
  if (!inflater.push(bytes, true) || inflater.err) throw new Error();
  return json + decoder.decode();
}

async function readReservation(value, { id, key, pdfName, xmlUrl, number }) {
  if (blank(value)) return null;
  try {
    const stored = JSON.parse(await decodeNfeStoredRecord(value));
    if (!record(stored?.draft) || stored.version !== 1 || stored.provision !== undefined && stored.provision !== true
      || stored.invoiceId !== id || stored.key !== key || stored.pdfName !== pdfName
      || stored.xmlUrl !== xmlUrl || stored.number !== number
      || !SHA256.test(stored.pdfHash) || !SHA256.test(stored.inputHash) || !SHA256.test(stored.planHash)) throw new Error();
    return stored;
  } catch { throw new Error('A reserva da proposta fiscal está inválida. Atualize o relatório.'); }
}

function sameField(name, actual, expected) {
  if (expected === null) return blank(actual);
  if (typeof expected === 'number') return (typeof actual === 'number' || typeof actual === 'string' && actual.trim() !== '')
    && Number(actual) === expected;
  if (civilDateFields.has(name) && typeof actual === 'string' && typeof expected === 'string'
    && civilDate.test(actual) && civilDate.test(expected)) return actual.slice(0,10) === expected.slice(0,10);
  if (Array.isArray(expected)) return Array.isArray(actual) && canonicalJson(actual) === canonicalJson(expected);
  return actual === expected;
}

export function createNfeProposalPosting({ repository, assertSession = () => {}, authorizeWrite, prepare, downloadAttachments, resolveLearningScope, provision = false }) {
  const [linkField, otherLinkField, parentName, childName, childLink, headerKey, linesKey] = provision
    ? [NFE_PROVISION_DESCRIPTION_FIELD, NFE_ORDER_FIELD, 'DESCRITIVOPROVISAO', 'PROVISÃO PGTOS', 'DESCRITIVOPROVISAO', 'parentFields', 'provisionFields']
    : [NFE_ORDER_FIELD, NFE_PROVISION_DESCRIPTION_FIELD, 'NOTASPENDENTES', 'LANCAMENTOS', 'AGRUPAR', 'orderFields', 'launchFields'];
  const target = provision ? 'descritivo de provisão' : 'pedido';
  const parentDraft = provision
    ? { STATUS:PROVISION_FISCAL_DRAFT_STATUS, FORNECEDOR:null, VALORTOTAL:null, DATAPREVISTOPGTO:null }
    : { [ORDER_FISCAL_STATUS]:ORDER_PENDING };
  const childDraft = provision ? { STATUS:PROVISION_FISCAL_DRAFT_STATUS, PGTOAGENDADO:null } : null;

  function active(signal) {
    assertSession();
    signal?.throwIfAborted();
  }

  async function resolve(site, name, signal) {
    const list = await repository.resolveList(site, [name], { signal });
    active(signal);
    if (list?.status !== 'resolved' || !list.id) throw new Error(`A lista ${name} está indisponível.`);
    return list.id;
  }

  function identify(row) {
    const id = nfeOrderId(row?.id), key = String(row?.key ?? ''), pdfName = fileName(row?.pdfName);
    if (!id || !Object.hasOwn(KEY_PATTERN, row?.type) || !KEY_PATTERN[row.type].test(key) || !pdfName) {
      throw new Error('A nota fiscal e seu PDF não foram identificados.');
    }
    const xmlUrl = fiscalXmlUrl(row.xmlUrl);
    if (!xmlUrl) throw new Error('O XML da nota fiscal não foi identificado.');
    return { id, key, pdfName, type:row.type, xmlUrl, number:fiscalNumber(row.number) };
  }

  async function inspectFiscal(item, invoice) {
    const fields = item?.fields, eTag = item?.eTag || item?.['@odata.etag'];
    if (nfeOrderId(item?.id) !== invoice.id || !record(fields) || !eTag || eTag === '*'
      || fields.CHAVE_ACESSO !== invoice.key || fiscalDocumentType(fields) !== invoice.type) {
      throw new Error('A identidade ou a versão da nota fiscal não foi confirmada.');
    }
    if (fiscalXmlUrl(fields.XML_URL) !== invoice.xmlUrl || fiscalNumber(fields.NUMERO_NOTA) !== invoice.number) {
      throw new Error('O XML ou o número da nota fiscal mudou. Atualize o relatório.');
    }
    const direction = code(fields.DIRECAO), role = code(fields.PAPEL_EMPRESA);
    if (code(fields.STATUS_IMPORTACAO) !== 'XML_COMPLETO' || code(fields.SITUACAO) !== 'AUTORIZADA'
      || direction !== 'ENTRADA' || invoice.type === 'NFS-e' && role !== 'TOMADOR') {
      throw new Error('A nota fiscal não está apta para gerar uma despesa.');
    }
    if (code(fields.STATUS_DANFE) !== 'DISPONIVEL' || fiscalPdfName(fields.DANFE_URL) !== invoice.pdfName) {
      throw new Error('O PDF fiscal mudou ou está indisponível. Atualize o relatório.');
    }
    if (!blank(fields[otherLinkField])) {
      throw new Error(provision ? 'A nota fiscal já está vinculada a um pedido.' : 'A nota fiscal já está vinculada a uma provisão.');
    }
    const linked = nfeOrderId(fields[linkField]);
    if (!linked && !blank(fields[linkField])) throw new Error('O vínculo atual da nota fiscal está inválido.');
    const rawReservation = fields[RESERVATION];
    const reservation = provision && linked && rawReservation === provisionLinkMarker(linked)
      ? null : await readReservation(rawReservation, invoice);
    if (reservation && Boolean(reservation.provision) !== provision) {
      throw new Error(provision ? 'Use Propor lançamentos para retomar o envio reservado.' : 'Use Propor provisão para retomar o envio reservado.');
    }
    return { eTag, linked, fields, rawReservation, reservation };
  }

  async function readFiscal(list, invoice, signal, extraFields = []) {
    active(signal);
    const item = await repository.getItem('company', list, invoice.id, undefined,
      { signal, restrictedFields:[...INVOICE_FIELDS, ...extraFields], includeVersion:true });
    const current = await inspectFiscal(item, invoice);
    active(signal);
    return current;
  }

  async function writeFiscal(list, invoice, current, fields, signal, extraFields = []) {
    active(signal);
    try {
      await repository.updateItem('company', list, invoice.id, fields,
        { eTag:current.eTag, signal, readbackFields:[...INVOICE_FIELDS, ...extraFields], includeVersion:true });
    } catch (error) {
      // A 412 and a response lost after a successful MERGE both require a fresh read.
      const latest = await readFiscal(list, invoice, signal, extraFields);
      if (latest.eTag === current.eTag) throw error;
      return latest;
    }
    return readFiscal(list, invoice, signal, extraFields);
  }

  function learningDigest(planHash, scope, data) {
    return sha256(new TextEncoder().encode(canonicalJson([planHash, scope, data])));
  }

  async function confirmedLearning(stored, row) {
    const { learning, planHash } = stored;
    if (!SHA256.test(learning?.scope) || !SHA256.test(learning.digest) || typeof learning.data !== 'string'
      || !learning.data || learning.data.length > RESERVATION_LIMIT
      || learning.scope !== await resolveLearningScope?.(row)
      || learning.digest !== await learningDigest(planHash, learning.scope, learning.data)) return null;
    return { [NFE_LEARNING_FIELD]:learning.data, [NFE_LEARNING_SCOPE]:learning.scope };
  }

  function learningColumnsUnavailable(error) {
    return [400,403,404].includes(error?.status)
      && LEARNING_FIELDS.some(field => String(error?.message).toUpperCase().includes(field));
  }

  async function finishLink(list, invoice, reserved, parentId, promote, learning, signal) {
    const link = { [linkField]:Number(parentId), [RESERVATION]:provision ? provisionLinkMarker(parentId) : null };
    async function confirm(extra = [], fields = link) {
      let current = await readFiscal(list, invoice, signal, extra);
      if (!current.linked && current.rawReservation === reserved) {
        await promote();
        current = await writeFiscal(list, invoice, current, fields, signal, extra);
      }
      if (current.linked !== parentId || current.reservation || current.rawReservation !== link[RESERVATION] && provision
        || extra.some(field => !blank(current.fields[field]))
          && extra.some(field => current.fields[field] !== fields[field])) {
        throw new Error(`O vínculo do ${target} não foi confirmado na nota fiscal. Atualize o relatório e retome.`);
      }
    }
    if (learning) {
      try { return await confirm(LEARNING_FIELDS, { ...link, ...learning }); }
      catch (error) { if (!learningColumnsUnavailable(error)) throw error; }
    }
    return confirm();
  }

  async function findFinancial(list, column, token, signal) {
    active(signal);
    const query = `$select=id&$expand=fields($select=${column})&$filter=fields/${column} eq '${token}'&$top=2`;
    const rows = await repository.getItems('personal', list, query, { signal });
    active(signal);
    if (!Array.isArray(rows) || rows.length > 1 || rows.some(row => !nfeOrderId(row?.id) || row?.fields?.[column] !== token)) {
      throw new Error('A origem fiscal dos registros financeiros não foi confirmada.');
    }
    return nfeOrderId(rows[0]?.id);
  }

  async function confirmUniqueColumn(list, column, signal) {
    const columns = await repository.getColumns('personal', list, { includeHidden:true, signal });
    active(signal);
    const matches = Array.isArray(columns) ? columns.filter(item => item.name === column) : [];
    const field = matches[0];
    if (matches.length !== 1 || !field.text || field.text.allowMultipleLines === true || field.readOnly !== false
      || field.required !== false || field.indexed !== true || field.enforceUniqueValues !== true) {
      throw new Error(`O SharePoint não confirmou a coluna de origem fiscal ${column}.`);
    }
  }

  async function readFinancial(list, id, expected, { pending, signal }) {
    active(signal);
    const saved = await repository.getItem('personal', list, id, undefined, { signal, restrictedFields:Object.keys(expected) });
    active(signal);
    const matches = fields => Object.entries(fields).every(([name, value]) => sameField(name, saved.fields[name], value));
    if (nfeOrderId(saved?.id) !== id || !record(saved?.fields)
      || !matches(expected) && !(pending && matches({ ...expected, ...pending }))) {
      throw new Error('Os dados do registro financeiro divergem da proposta fiscal reservada.');
    }
    return saved;
  }

  async function financialItem(list, column, token, fields, { readOnly, pending, expectedId, signal }) {
    let id = await findFinancial(list, column, token, signal);
    const expected = { ...fields, [column]:token };
    if (!id && !readOnly) {
      active(signal);
      const creation = { ...expected, ...pending };
      try {
        id = nfeOrderId((await repository.createItem('personal', list, creation, { signal }))?.id);
      } catch (error) {
        id = await findFinancial(list, column, token, signal);
        if (!id) throw error;
      }
      if (!id) id = await findFinancial(list, column, token, signal);
    }
    if (!id || expectedId && id !== expectedId) throw new Error(`A nota já está vinculada a outro ${target} ou o registro financeiro não foi encontrado.`);
    await readFinancial(list, id, expected, { pending:readOnly ? null : pending, signal });
    return id;
  }

  async function promoteFinancial(list, id, expected, pending, signal) {
    const current = await readFinancial(list, id, expected, { pending, signal });
    const fields = Object.fromEntries(Object.keys(pending).map(name => [name, expected[name]]));
    if (Object.entries(fields).every(([name, value]) => sameField(name, current.fields[name], value))) return;
    const eTag = current.eTag || current['@odata.etag'];
    if (!eTag || eTag === '*') throw new Error('A versão do registro para envio fiscal não foi confirmada.');
    active(signal);
    try {
      await repository.updateItem('personal', list, id, fields, { eTag, signal, readbackFields:Object.keys(expected) });
    } catch (error) {
      const latest = await readFinancial(list, id, expected, { pending, signal });
      if (!Object.entries(fields).every(([name, value]) => sameField(name, latest.fields[name], value))) throw error;
      return;
    }
    await readFinancial(list, id, expected, { signal });
  }

  async function ensureAttachment(list, id, { name, file, hash }, verifyOnly, signal) {
    async function confirm() {
      active(signal);
      const attachments = await repository.listAttachments('personal', list, id, { signal, requireCollection:true, namesOnly:true });
      active(signal);
      if (!Array.isArray(attachments)) throw new Error(`A consulta de anexos do ${target} está incompleta.`);
      const matches = attachments.filter(file => file.name?.toLowerCase() === name.toLowerCase());
      if (!matches.length) return false;
      if (matches.length !== 1 || matches[0].name !== name) throw new Error(`O nome do anexo ${name} já está em uso no ${target}.`);
      const saved = await repository.downloadAttachment('personal', list, id, name, { signal });
      if (await nfeAttachmentFingerprint(saved, name) !== hash) throw new Error(`O ${/\.pdf$/i.test(name) ? 'PDF' : 'anexo'} ${name} do ${target} diverge do original da nota.`);
      active(signal);
      return true;
    }
    if (await confirm()) return;
    if (verifyOnly) throw new Error(`O anexo ${name} vinculado ao ${target} está indisponível.`);
    active(signal);
    try { await repository.uploadAttachment('personal', list, id, file, name, { signal }); }
    catch (error) {
      if (await confirm()) return;
      throw error;
    }
    if (!await confirm()) throw new Error(`O SharePoint não confirmou o anexo ${name} no ${target}.`);
  }

  async function sourceAttachments(source, signal) {
    const files = await downloadAttachments(source, { signal });
    active(signal);
    const names = nfeAttachmentNames(Array.isArray(files) ? files.map(file => file?.name) : null, source.pdfName);
    const result = [];
    for (const name of names) {
      const file = files.find(file => file.name === name);
      result.push({ name, file, hash:await nfeAttachmentFingerprint(file, name) });
      active(signal);
    }
    return result;
  }

  async function confirmSourceAttachments(source, attachments, signal) {
    const latest = await sourceAttachments(source, signal);
    const manifest = files => JSON.stringify(files.map(({ name, hash }) => [name, hash]));
    if (manifest(latest) !== manifest(attachments)) throw new Error('Os anexos da nota mudaram. Tente novamente para incluir todos.');
  }

  async function loadReservation(row, { signal } = {}) {
    active(signal);
    const invoice = identify(row);
    const list = await resolve('company', 'NOTAS_FISCAIS_SEFAZ', signal);
    const current = await readFiscal(list, invoice, signal);
    return current.reservation?.draft ?? null;
  }

  async function submit(row, draft, { signal, onProgress, baseline, manualStages } = {}) {
    active(signal);
    const invoice = identify(row);
    const source = { ...row, ...invoice };
    const input = canonicalJson(draft);
    await authorizeWrite({ signal });
    active(signal);
    const [fiscalList, parentList, childList] = await Promise.all([
      resolve('company', 'NOTAS_FISCAIS_SEFAZ', signal),
      resolve('personal', parentName, signal),
      resolve('personal', childName, signal),
    ]);
    const [fiscal] = await Promise.all([
      readFiscal(fiscalList, invoice, signal),
      confirmUniqueColumn(parentList, ORDER_ORIGIN, signal),
      confirmUniqueColumn(childList, LINE_ORIGIN, signal),
    ]);
    let current = fiscal;
    if (current.linked && current.linked !== await findFinancial(parentList, ORDER_ORIGIN, invoice.key, signal)) {
      throw new Error(`A nota fiscal já está vinculada a outro ${target}.`);
    }
    const encoder = new TextEncoder();
    const inputHash = await sha256(encoder.encode(input));
    const attachments = await sourceAttachments(source, signal);
    const pdfHash = attachments.find(file => file.name === invoice.pdfName).hash;
    active(signal);

    const candidate = await prepare(source, JSON.parse(input), {
      signal, baseline:current.reservation || current.linked ? null : baseline, manualStages,
    });
    const prepared = normalizePayload(candidate, headerKey, linesKey);
    const parentFields = prepared[headerKey], lineFields = prepared[linesKey];
    if (!provision && parentFields[ORDER_FISCAL_STATUS] !== ORDER_SUBMITTED) {
      throw new Error('A proposta não confirmou a situação fiscal final do pedido.');
    }
    const planHash = await sha256(encoder.encode(canonicalJson(prepared)));
    if (!current.linked && !current.reservation) {
      const reservation = { version:1, invoiceId:invoice.id, key:invoice.key, pdfName:invoice.pdfName,
        xmlUrl:invoice.xmlUrl, number:invoice.number, inputHash, pdfHash, planHash, draft:prepared.draft,
        ...(provision ? { provision:true } : {}) };
      let next;
      if (SHA256.test(candidate.learning?.scope) && record(candidate.learning?.example)) {
        try {
          const data = await encodeReservation({ ...candidate.learning.example, at:Date.now() });
          const scope = candidate.learning.scope;
          const digest = await learningDigest(planHash, scope, data);
          next = await encodeReservation({ ...reservation, learning:{ scope, data, digest } });
        } catch { /* A training example exceeding SharePoint limits cannot prevent financial submission. */ }
      }
      next ??= await encodeReservation(reservation);
      current = await writeFiscal(fiscalList, invoice, current, { [RESERVATION]:next }, signal);
    }
    const stored = current.reservation;
    const storedDraft = stored ? canonicalJson(stored.draft) : '';
    if (stored && stored.inputHash !== inputHash && storedDraft !== input) {
      throw new Error('A nota já tem uma proposta reservada. Reabra a proposta para retomar.');
    }
    if (stored && stored.pdfHash !== pdfHash) throw new Error('O PDF fiscal diverge do original da proposta reservada.');
    if (stored && (stored.planHash !== planHash || storedDraft !== canonicalJson(prepared.draft))) {
      throw new Error('A proposta reservada diverge dos dados validados do XML ou do cadastro.');
    }
    if (!current.linked && !stored || current.linked && stored) throw new Error('O estado da reserva fiscal não foi confirmado.');

    const readOnly = Boolean(current.linked);
    const parentId = await financialItem(parentList, ORDER_ORIGIN, invoice.key, parentFields,
      { readOnly, pending:parentDraft, expectedId:current.linked, signal });
    for (const attachment of attachments) await ensureAttachment(parentList, parentId, attachment, false, signal);
    const confirmed = [];
    for (const line of lineFields) {
      const token = `${invoice.key}-${line.number}`;
      const fields = { ...line.fields, [childLink]:parentId };
      const id = await financialItem(childList, LINE_ORIGIN, token, fields, { readOnly, pending:childDraft, signal });
      confirmed.push({ id, fields:{ ...fields, [LINE_ORIGIN]:token } });
      if (typeof onProgress === 'function') {
        try {
          Promise.resolve(onProgress({ completedLines:confirmed.length, totalLines:lineFields.length })).catch(() => {});
        } catch { /* A progress observer cannot affect posting. */ }
      }
    }
    for (const attachment of attachments) await ensureAttachment(parentList, parentId, attachment, true, signal);
    if (readOnly) await confirmSourceAttachments(source, attachments, signal);
    if (!readOnly) {
      const reserved = current.rawReservation;
      for (let start = 0; start < confirmed.length; start += READBACK_BATCH_SIZE) {
        await Promise.all(confirmed.slice(start, start + READBACK_BATCH_SIZE).map(({ id, fields }) =>
          readFinancial(childList, id, fields, { pending:childDraft, signal })));
      }
      const learning = await confirmedLearning(stored, source);
      await finishLink(fiscalList, invoice, reserved, parentId, async () => {
        // finishLink holds the version used by its conditional link. Recheck
        // the manifest after destination reads without adopting a newer eTag.
        await confirmSourceAttachments(source, attachments, signal);
        if (provision) {
          for (const { id, fields } of confirmed) await promoteFinancial(childList, id, fields, childDraft, signal);
        }
        await promoteFinancial(parentList, parentId, { ...parentFields, [ORDER_ORIGIN]:invoice.key }, parentDraft, signal);
      }, learning, signal);
    }
    active(signal);
    const ids = confirmed.map(item => item.id);
    return provision ? { invoiceId:invoice.id, provisionDescriptionId:parentId, provisionIds:ids }
      : { invoiceId:invoice.id, orderId:parentId, launchIds:ids };
  }

  return Object.freeze({ loadReservation, submit });
}
