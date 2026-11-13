import { validateAttachment } from '../../../../portal/data/attachments.js';
import { payrollGalleryDay } from './payroll-gallery-filters.js';
import { weeklyPayslipLines, weeklyPayslipTotal } from './weekly-payslip-lines.js';

const signedTypes = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const mimeFor = name => Object.hasOwn(signedTypes, name.split('.').at(-1)) ? signedTypes[name.split('.').at(-1)] : '';
const asBlob = (bytes, type) => new Blob([bytes], { type });
const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  byte => byte.toString(16).padStart(2, '0')).join('');
const identity = fields => ({ supplier: String(fields.FORNECEDOR ?? ''), branch: String(fields.FILIAL ?? ''), date: payrollGalleryDay(fields.DATA_PAGAMENTO) });
const version = row => String(row?.eTag || row?.['@odata.etag'] || row?.['odata.etag'] || '').trim();
const sameIdentity = (a, b) => a.supplier === b.supplier && a.branch === b.branch && a.date === b.date;
const SIGNED_BATCH_LIMIT = 50 * 1024 * 1024;
const SOURCE_FIELDS = ['FORNECEDOR', 'FILIAL', 'DATA_PAGAMENTO', 'SEMANA_INICIO', 'SEMANA_FIM', 'RUBRICAS', 'TOTAL',
  'TOTAL_JA_PAGO', 'TOTAL_PROVISOES', 'PROVISOES', 'IDFOLHA', 'PRODUTO', 'ETAPA', 'Title', 'OPERACAO', 'HOLERITE_REVISAO'];
const snapshot = fields => JSON.stringify(SOURCE_FIELDS.map(key => fields[key] ?? null));
const safeAttachmentName = name => typeof name === 'string' && name.length > 0 && name.length <= 400
  && !/[\\/\u0000-\u001f]/.test(name) && name !== '.' && name !== '..';

function generatedAttachment(name, stem, kind, extension = '[a-z]+') {
  const prefix = `${stem}-${kind}-`;
  return typeof name === 'string' && name.startsWith(prefix)
    && new RegExp(`^[a-f0-9]{64}\\.${extension}$`).test(name.slice(prefix.length));
}
function signedFileHeader(type, bytes) {
  const data = new Uint8Array(bytes);
  const ascii = new TextDecoder('ascii').decode(data);
  if (type === 'application/pdf') return ascii.startsWith('%PDF-');
  if (type === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (type === 'image/png') return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => data[index] === byte);
  return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
}

export function weeklyPayslipName(fields) {
  const week = String(fields?.SEMANA_INICIO ?? '').slice(0, 10);
  const supplier = String(fields?.IDFORNECEDOR ?? '');
  const key = `${week}-${supplier}`;
  return /^\d{4}-\d{2}-\d{2}-[1-9]\d*$/.test(key) && fields?.CHAVE === key ? `Holerite-${key}.pdf` : '';
}

function revision(fields, name) {
  if (!fields.HOLERITE_REVISAO) return null;
  try {
    const { supplier, branch, date, pdf, lines, total, removed, labels } = JSON.parse(fields.HOLERITE_REVISAO);
    const stem = name.slice(0, -4);
    if (typeof supplier === 'string' && supplier && typeof branch === 'string' && branch && date && payrollGalleryDay(date) === date
      && (pdf === name || generatedAttachment(pdf, stem, 'revisao', 'pdf'))) {
      const attachments = Array.isArray(labels) ? labels.filter(entry => Array.isArray(entry)
        && generatedAttachment(entry[0], stem, 'anexo') && safeAttachmentName(entry[1])) : [];
      return { supplier, branch, date, pdf, lines: Array.isArray(lines) && Number.isFinite(total) ? lines : undefined, total,
        removed: Array.isArray(removed) ? removed.filter(safeAttachmentName) : [], labels: attachments };
    }
  } catch { /* A malformed revision never selects an unverified attachment. */ }
  return null;
}

export function weeklyPayslipDisplay(fields, name) {
  const saved = name && revision(fields, name);
  return saved ? { FORNECEDOR: saved.supplier, FILIAL: saved.branch, DATA_PAGAMENTO: saved.date,
    ...(saved.lines ? { TOTAL: saved.total } : {}) } : {};
}

export function createWeeklyPayslipRecord({ repository, siteKey, resolveList, assertSession, loadLogo, onSaved }) {
  const contexts = new WeakMap();
  const check = signal => { assertSession(); signal?.throwIfAborted(); };

  async function read(row, signal, list) {
    check(signal);
    const id = String(row?.id || '');
    if (!/^[1-9]\d{0,14}$/.test(id)) throw new RangeError('Holerite inválido.');
    list ||= await resolveList('HOLERITE');
    check(signal);
    const current = await repository.getItem(siteKey, list.id, id, '$expand=fields', { signal, includeVersion: true });
    check(signal);
    if (String(current?.id || '') !== id || current.fields?.SITUACAO !== 'FECHADO')
      throw new Error('Este holerite ainda não está fechado.');
    const name = weeklyPayslipName(current.fields);
    if (!name || name !== row.pdfFileName) throw new Error('O PDF do holerite não foi identificado. Atualize a galeria.');
    return { list, id, current, name, stem: name.slice(0, -4) };
  }

  async function listFiles(target, signal) {
    check(signal);
    const files = await repository.listAttachments(siteKey, target.list.id, target.id);
    check(signal);
    if (!Array.isArray(files)) throw new Error('Não foi possível consultar os anexos do holerite.');
    return files.map(file => ({ ...file, name: file.name ?? file.fileName }));
  }

  async function fileBlob(target, name, type, options = {}) {
    check(options.signal);
    const value = await repository.downloadAttachment(siteKey, target.list.id, target.id, name, options);
    check(options.signal);
    if (!(value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)))
      throw new Error('O arquivo não foi retornado pelo SharePoint.');
    return asBlob(value, type);
  }

  async function downloadPayslip(row, options = {}) {
    const target = await read(row, options.signal);
    const saved = revision(target.current.fields, target.name);
    if (options.expectedDate && (saved?.date || payrollGalleryDay(target.current.fields.DATA_PAGAMENTO)) !== options.expectedDate)
      throw new Error('A data deste holerite mudou. Atualize a galeria.');
    const files = await listFiles(target, options.signal);
    const name = saved?.pdf || target.name;
    if (files.filter(file => file.name === name).length !== 1)
      throw new Error('O PDF do holerite não foi encontrado nos anexos deste registro.');
    const pdf = await fileBlob(target, name, 'application/pdf', { signal: options.signal, onProgress: options.onProgress });
    if (await pdf.slice(0, 5).text() !== '%PDF-') throw new Error('O arquivo do holerite não é um PDF válido.');
    check(options.signal);
    return pdf;
  }

  function editableFiles(target, files) {
    const saved = revision(target.current.fields, target.name);
    const removed = new Set(saved?.removed);
    const labels = new Map(saved?.labels);
    return files.filter(({ name }) => safeAttachmentName(name) && name !== target.name && name !== saved?.pdf
      && !generatedAttachment(name, target.stem, 'revisao', 'pdf')
      && (!generatedAttachment(name, target.stem, 'anexo') || labels.has(name)))
      .map(({ name, size, uploadedAt }) => ({ name, label: labels.get(name) || name, size, uploadedAt, removed: removed.has(name),
        signed: generatedAttachment(name, target.stem, 'assinado') && !!mimeFor(name) }));
  }

  const visibleFiles = (target, files) => editableFiles(target, files).filter(file => !file.removed);

  function signedFiles(target, files) {
    return visibleFiles(target, files).filter(file => file.signed)
      .map(({ name, size, uploadedAt }) => ({ name, size, uploadedAt }));
  }

  async function listSignedPayslips(row, { signal } = {}) {
    const target = await read(row, signal);
    return signedFiles(target, await listFiles(target, signal));
  }

  async function downloadSignedPayslip(row, attachment, options = {}) {
    const target = await read(row, options.signal);
    const matches = signedFiles(target, await listFiles(target, options.signal)).filter(file => file.name === attachment?.name);
    if (matches.length !== 1) throw new Error('A via assinada não foi encontrada neste holerite.');
    const name = matches[0].name;
    const blob = await fileBlob(target, name, mimeFor(name), options);
    const expected = name.slice(`${target.stem}-assinado-`.length).split('.')[0];
    if (await sha256(await blob.arrayBuffer()) !== expected) throw new Error('Não foi possível verificar o conteúdo da via assinada.');
    check(options.signal);
    return blob;
  }

  async function downloadPayslipAttachment(row, attachment, options = {}) {
    const target = await read(row, options.signal);
    const matches = visibleFiles(target, await listFiles(target, options.signal)).filter(file => file.name === attachment?.name);
    if (matches.length !== 1) throw new Error('O anexo não foi encontrado neste holerite.');
    const { name } = matches[0];
    const blob = await fileBlob(target, name, mimeFor(name.toLowerCase()) || 'application/octet-stream', options);
    for (const kind of ['assinado', 'anexo']) {
      if (!generatedAttachment(name, target.stem, kind)) continue;
      const expected = name.slice(`${target.stem}-${kind}-`.length).split('.')[0];
      if (await sha256(await blob.arrayBuffer()) !== expected) throw new Error('Não foi possível verificar o conteúdo do anexo.');
    }
    check(options.signal);
    return blob;
  }

  async function confirmFile(target, file, name, signal, present) {
    if (present) return;
    check(signal);
    let failure;
    try { await repository.uploadAttachment(siteKey, target.list.id, target.id, file, name, { signal }); }
    catch (error) { failure = error; }
    const files = await listFiles(target, signal);
    if (files.filter(entry => entry.name === name).length !== 1)
      throw failure || new Error('O SharePoint ainda não confirmou o arquivo. Tente enviar novamente.');
  }

  async function prepareAttachments(files, signal) {
    if (!Array.isArray(files) || files.length > 20) throw new Error('Selecione até 20 arquivos por envio.');
    const prepared = files.map(file => {
      const valid = validateAttachment(file);
      const extension = String(file?.name || '').split('.').at(-1).toLowerCase().replace(/^(jpeg|jfif)$/, 'jpg');
      if (!valid.valid) throw new Error(valid.message);
      if (!Object.hasOwn(signedTypes, extension)) throw new Error('Envie a via assinada como PDF ou imagem.');
      return { file, label: valid.name, extension, type: signedTypes[extension] };
    });
    if (files.reduce((sum, file) => sum + file.size, 0) > SIGNED_BATCH_LIMIT)
      throw new Error('Selecione até 50 MB por envio.');
    for (const { file, type } of prepared) {
      check(signal);
      if (typeof file.slice !== 'function' || !signedFileHeader(type, await file.slice(0, 12).arrayBuffer()))
        throw new Error(`O arquivo ${file.name} não é um PDF ou uma imagem válida.`);
    }
    return prepared;
  }

  async function stageAttachments(target, prepared, kind, files, signal, removed = new Set()) {
    const names = new Set(files.map(entry => entry.name));
    const staged = [];
    for (const { file, label, extension, type } of prepared) {
      check(signal);
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength !== file.size) throw new Error('Não foi possível ler a via assinada. Selecione o arquivo novamente.');
      const hash = await sha256(bytes);
      check(signal);
      const name = `${target.stem}-${kind}-${hash}.${extension}`;
      if (removed.has(name)) throw new Error('Uma via idêntica foi retirada deste holerite. Adicione-a novamente pelo editor.');
      await confirmFile(target, asBlob(bytes, type), name, signal, names.has(name));
      names.add(name);
      staged.push([name, label]);
    }
    return staged;
  }

  async function uploadSignedPayslips(row, files, { signal } = {}) {
    const target = await read(row, signal);
    const prepared = await prepareAttachments(files, signal);
    if (!prepared.length) throw new Error('Selecione pelo menos um arquivo da via assinada.');
    const present = await listFiles(target, signal);
    const removed = new Set(revision(target.current.fields, target.name)?.removed);
    await stageAttachments(target, prepared, 'assinado', present, signal, removed);
    return signedFiles(target, await listFiles(target, signal));
  }

  async function loadPayslipEditor(row, { signal } = {}) {
    const target = await read(row, signal);
    const eTag = version(target.current);
    if (!eTag || eTag === '*') throw new Error('Não foi possível confirmar a versão deste holerite. Atualize a galeria.');
    const fields = target.current.fields;
    const saved = revision(fields, target.name);
    const values = saved || identity(fields);
    const lines = weeklyPayslipLines(saved?.lines ?? JSON.parse(fields.RUBRICAS || '[]'));
    const available = editableFiles(target, await listFiles(target, signal));
    const attachments = available.filter(file => !file.removed);
    const removedAttachments = available.filter(file => file.removed);
    const context = Object.freeze({ supplier: values.supplier, branch: values.branch, date: values.date,
      lines, total: weeklyPayslipTotal(lines), attachments, removedAttachments });
    contexts.set(context, { id: target.id, name: target.name, fields: snapshot(fields),
      attachments: new Set(attachments.map(file => file.name)), removedAttachments: new Set(removedAttachments.map(file => file.name)) });
    return context;
  }

  async function savePayslipEditor(row, context, draft, { signal } = {}) {
    const target = await read(row, signal);
    const source = contexts.get(context);
    if (!source || source.id !== target.id || source.name !== target.name) throw new Error('Reabra a edição deste holerite.');
    if (!draft || Object.keys(draft).some(key => !['supplier', 'branch', 'date', 'lines', 'uploads', 'removed', 'restored'].includes(key)))
      throw new Error('A edição contém campos que não pertencem ao holerite.');
    const values = { supplier: String(draft.supplier || '').trim(), branch: String(draft.branch || '').trim(), date: draft.date };
    if ([values.supplier, values.branch].some(value => !value || value.length > 255 || /[\u0000-\u001f]/.test(value)))
      throw new Error('Informe o nome do funcionário e a filial, com até 255 caracteres cada.');
    const { fields } = target.current;
    const week = { start: payrollGalleryDay(fields.SEMANA_INICIO), end: payrollGalleryDay(fields.SEMANA_FIM) };
    if (!values.date || payrollGalleryDay(values.date) !== values.date || !week.start || !week.end
      || values.date < week.start || values.date > week.end)
      throw new Error('A data da folha deve estar dentro da semana deste holerite.');
    if (snapshot(fields) !== source.fields) {
      const pending = source.pending;
      if (pending && fields.HOLERITE_REVISAO === pending.payload && sameIdentity(values, pending.values)
        && JSON.stringify(draft.lines) === pending.lines && JSON.stringify(draft.removed ?? []) === pending.removed
        && JSON.stringify(draft.restored ?? []) === pending.restored
        && (draft.uploads ?? []).length === pending.uploads.length
        && pending.uploads.every((file, index) => file === draft.uploads[index])) { onSaved(); return values; }
      throw new Error('Este holerite foi alterado. Reabra a edição para conferir os dados.');
    }
    const saved = revision(fields, target.name);
    const currentValues = saved || identity(fields);
    const currentLines = weeklyPayslipLines(saved?.lines ?? JSON.parse(fields.RUBRICAS || '[]'));
    const lines = draft.lines === undefined ? currentLines : weeklyPayslipLines(draft.lines);
    const total = weeklyPayslipTotal(lines);
    const removed = draft.removed ?? [];
    const restored = draft.restored ?? [];
    if (!Array.isArray(removed) || removed.some(name => !source.attachments.has(name))
      || !Array.isArray(restored) || restored.some(name => !source.removedAttachments.has(name)))
      throw new Error('Escolha apenas anexos que pertencem a este holerite.');
    const uploads = await prepareAttachments(draft.uploads ?? [], signal);
    const linesChanged = JSON.stringify(lines) !== JSON.stringify(currentLines);
    const updatePdf = !sameIdentity(currentValues, values) || linesChanged;
    if (!updatePdf && !removed.length && !restored.length && !uploads.length) { onSaved(); return values; }

    // Keep the signed and original attachments. The display revision points to a
    // new PDF only after the conditional write succeeds.
    const files = await listFiles(target, signal);
    if (restored.some(name => !files.some(file => file.name === name)))
      throw new Error('Um anexo selecionado para restaurar não está mais disponível.');
    let pdf = saved?.pdf || target.name;
    if (updatePdf) {
      const hash = await sha256(new TextEncoder().encode(JSON.stringify([values, week, lines, total])));
      pdf = `${target.stem}-revisao-${hash}.pdf`;
      if (!files.some(file => file.name === pdf)) {
        const { buildSupplierHoleritePdf } = await import('./supplier-holerite-pdf.js');
        const bytes = await buildSupplierHoleritePdf({ supplier: { label: values.supplier, branch: values.branch },
          date: values.date, week, lines, total }, { logoBytes: await loadLogo({ signal }) });
        await confirmFile(target, asBlob(bytes, 'application/pdf'), pdf, signal, false);
      }
    }
    const hidden = new Set([...(saved?.removed || []), ...removed]);
    for (const name of restored) hidden.delete(name);
    const labels = new Map(saved?.labels);
    for (const [name, label] of await stageAttachments(target, uploads, 'anexo', files, signal)) {
      labels.set(name, label);
      hidden.delete(name);
    }
    const payload = JSON.stringify({ ...values, pdf, lines, total, removed: [...hidden], labels: [...labels] });
    if (payload.length > 60_000) throw new Error('O holerite atingiu o limite de dados de revisão.');
    // An attachment upload can advance the item ETag. Adopt that ETag only when
    // the latest record still has the same payroll fields as the one just read.
    const fresh = await read(row, signal, target.list);
    const confirmedFiles = await listFiles(target, signal);
    if (confirmedFiles.filter(file => file.name === pdf).length !== 1)
      throw new Error('O PDF do holerite não está disponível para concluir a edição.');
    const available = new Set(confirmedFiles.map(file => file.name));
    if (restored.some(name => !available.has(name)) || [...labels.keys()].some(name => !hidden.has(name) && !available.has(name)))
      throw new Error('Um anexo da revisão não está mais disponível.');
    if (fresh.current.fields.HOLERITE_REVISAO === payload) { onSaved(); return values; }
    if (snapshot(fresh.current.fields) !== source.fields)
      throw new Error('Este holerite foi alterado. Reabra a edição para conferir os dados.');
    const eTag = version(fresh.current);
    if (!eTag || eTag === '*') throw new Error('Não foi possível confirmar a versão deste holerite.');
    let failure;
    source.pending = { payload, values, lines: JSON.stringify(draft.lines), removed: JSON.stringify(removed),
      restored: JSON.stringify(restored), uploads: draft.uploads ?? [] };
    try {
      check(signal);
      await repository.updateItem(siteKey, target.list.id, target.id, { HOLERITE_REVISAO: payload }, { eTag, signal });
    } catch (error) { failure = error; }
    const confirmed = await read(row, signal, target.list);
    if (confirmed.current.fields.HOLERITE_REVISAO !== payload) throw failure || new Error('A edição do holerite não foi confirmada.');
    source.pending = undefined;
    onSaved();
    return values;
  }

  return { downloadPayslip, listSignedPayslips, downloadSignedPayslip, downloadPayslipAttachment, uploadSignedPayslips, loadPayslipEditor, savePayslipEditor };
}
