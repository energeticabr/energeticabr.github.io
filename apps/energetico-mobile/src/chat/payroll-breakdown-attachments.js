import { validateAttachment } from '../../../../portal/data/attachments.js';
import { payrollKey } from './supplier-payroll.js';
import { payrollProvisionId } from './payroll-provision-source.js';

const SITE = 'personal';
const scalar = value => String(value?.LookupValue ?? value?.Value ?? value?.value ?? value ?? '').trim();
const identity = value => { const text = scalar(value); if (!/^[1-9]\d{0,14}$/.test(text)) throw new Error('O vínculo financeiro não possui um ID válido.'); return text; };
const names = { provision: ['PROVISÃO PGTOS','PROVISAO PGTOS','PROVISAO PAGAMENTOS'], payroll: ['FOLHAPGTO'], launch: ['LANCAMENTOS'], order: ['NOTASPENDENTES'], sheet: ['IDFOLHA'] };
const fileKey = name => name.normalize('NFC').toLocaleLowerCase('pt-BR');
const digest = async bytes => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');

/** Never creates financial records: destinations are resolved afresh from this payment. */
export function createPayrollBreakdownAttachments({ repository, assertSession = () => {} } = {}) {
  let busy = false;
  async function call(method, ...args) {
    assertSession();
    if (typeof repository?.[method] !== 'function') throw new Error('O acesso aos anexos não está disponível.');
    const result = await repository[method](...args); assertSession(); return result;
  }
  async function selected(files) {
    assertSession();
    if (!Array.isArray(files)) throw new Error('Selecione os arquivos desta linha.');
    const found = new Set(), result = [];
    for (const file of files) {
      const valid = validateAttachment(file);
      if (!valid.valid) throw new Error(valid.message);
      if (found.has(fileKey(valid.name))) throw new Error('Há arquivos com o mesmo nome nesta linha.');
      found.add(fileKey(valid.name));
      const bytes = await file.arrayBuffer(); assertSession();
      if (bytes.byteLength !== file.size) throw new Error('O tamanho do arquivo mudou. Selecione-o novamente.');
      const sha256 = await digest(bytes); assertSession();
      result.push({ manifest: { name: valid.name, size: file.size, sha256 },
        file: { name: valid.name, size: bytes.byteLength, type: file.type, arrayBuffer: async () => bytes.slice(0) } });
    }
    return result.sort((a,b)=>a.manifest.name.localeCompare(b.manifest.name));
  }
  async function prepareFiles(files) { return (await selected(files)).map(entry=>entry.manifest); }
  async function resolve({ supplier, sheetId, paymentId }) {
    sheetId = identity(sheetId); paymentId = identity(paymentId);
    if (!scalar(supplier?.label) || !scalar(supplier?.branch)) throw new Error('Confira o fornecedor e a filial desta folha.');
    const descriptions = new Map(), evidence = [];
    async function read(kind, itemId) {
      itemId = identity(itemId);
      let desc = descriptions.get(kind);
      if (!desc) {
        const list = await call('resolveList',SITE,names[kind]);
        if (!list?.id || list.status && list.status !== 'resolved') throw new Error(`A lista ${names[kind][0]} não está disponível.`);
        desc = { listId: list.id, columns: await call('getColumns',SITE,list.id) }; descriptions.set(kind,desc);
      }
      const row = await call('getItem',SITE,desc.listId,itemId,'$expand=fields');
      if (String(row?.id) !== itemId) throw new Error(`O vínculo ${names[kind][0]} ${itemId} não foi confirmado.`);
      const canonical = {};
      function value(label, optional = false) {
        const matches = desc.columns.filter(c=>!c.computed && [c.name,c.displayName].some(n=>payrollKey(n)===payrollKey(label)));
        const exact = matches.filter(c=>payrollKey(c.name)===payrollKey(label)), found = exact.length ? exact : matches;
        if (!found.length && optional) return '';
        if (found.length !== 1) throw new Error(`O vínculo ${label} de ${names[kind][0]} não é único.`);
        return canonical[label] = scalar(row.fields?.[found[0].name]);
      }
      const target = { kind, listId: desc.listId, id: itemId, value };
      evidence.push({ kind, listId: desc.listId, id: itemId, fields: canonical }); return target;
    }
    function owned(target, branch = true) {
      if (payrollKey(target.value('FORNECEDOR')) !== payrollKey(supplier.label)) throw new Error('O fornecedor do vínculo mudou.');
      if (branch && payrollKey(target.value('FILIAL')) !== payrollKey(supplier.branch)) throw new Error('A filial do vínculo mudou.');
    }
    const sheet = await read('sheet',sheetId); owned(sheet,false);
    const payment = await read('payroll',paymentId); owned(payment,false);
    if (payment.value('IDFOLHA') !== sheetId) throw new Error('O vínculo da folha mudou.');
    const type = payment.value('TIPOPGTO'), title = payment.value('Title');
    const explicit = payment.value('IDPROVISAO',true), launchId = payment.value('IDLANCAMENTO',true);
    let provisionId = payrollProvisionId({ Title: title, IDPROVISAO: explicit });
    if (!provisionId && explicit) throw new Error('O vínculo da provisão é inconsistente.');
    const launches = [], orders = [], targets = [];
    if (!provisionId) {
      const launch = await read('launch',launchId); owned(launch); launches.push(launch);
      provisionId = launch.value('IDPGTOAGENDADO',true);
    }
    let provision, paid = true;
    if (provisionId) {
      provision = await read('provision',provisionId); owned(provision);
      const sourceSheet = provision.value('IDFOLHA',true), sourceType = provision.value('TIPOPGTO',true);
      if (sourceSheet && sourceSheet !== sheetId || sourceType && payrollKey(sourceType) !== payrollKey(type)) throw new Error('O vínculo da folha ou rubrica da provisão mudou.');
      if (title.startsWith('APP-folha-provisao-') && sourceSheet !== sheetId) throw new Error('O vínculo da folha da provisão mudou.');
      paid = !!provision.value('DATAPGTOEFETUADO'); targets.push(provision);
      const linked = provision.value('IDLANCAMENTOS',true);
      if (linked && !/^[1-9]\d*(?:\s*[,;\r\n]\s*[1-9]\d*)*$/.test(linked)) throw new Error('O vínculo dos lançamentos é inválido.');
      const ids = [...new Set(linked.split(/[,;\r\n]/).map(v=>v.trim()).filter(Boolean))];
      if (launchId && !ids.includes(launchId)) throw new Error('O vínculo do lançamento da folha mudou.');
      if (launches.length && !ids.includes(launches[0].id)) throw new Error('O vínculo reverso da provisão mudou.');
      for (const launchId of ids) if (!launches.some(row=>row.id===launchId)) launches.push(await read('launch',launchId));
      if (paid && !launches.length) throw new Error('O pagamento não possui lançamento vinculado. Confira a baixa antes de enviar anexos.');
    }
    for (const launch of launches) {
      owned(launch);
      if (provision && launch.value('IDPGTOAGENDADO') !== provision.id) throw new Error('O vínculo reverso do lançamento mudou.');
      const orderId = identity(launch.value('AGRUPAR'));
      if (provision && identity(provision.value('IDPEDIDO')) !== orderId) throw new Error('O pedido vinculado à provisão mudou.');
      if (!orders.some(row=>row.id===orderId)) { const order = await read('order',orderId); owned(order); orders.push(order); }
    }
    targets.push(...launches,...orders);
    if (new Set([...descriptions.values()].map(d=>d.listId)).size !== descriptions.size) throw new Error('As listas dos vínculos financeiros estão conflitantes.');
    return { targets, signature: JSON.stringify(evidence), status: !provision ? 'missing-provision' : !paid ? 'pending-settlement' : 'complete' };
  }
  async function submit({supplier,sheetId,paymentId,files,progress = {},onProgress = () => {}}) {
    if (busy) throw new Error('Os anexos desta linha já estão sendo enviados.');
    busy = true;
    try {
      assertSession(); repository.clearCache?.();
      const entries = await selected(files), manifest = entries.map(entry=>entry.manifest);
      if (progress.manifest?.length && !entries.length) throw new Error('Selecione novamente os arquivos desta linha para retomar o envio.');
      if (!entries.length) throw new Error('Selecione pelo menos um arquivo desta linha.');
      if (progress.manifest && JSON.stringify(progress.manifest) !== JSON.stringify(manifest)) throw new Error('Selecione novamente os mesmos arquivos, com o mesmo conteúdo, para retomar.');
      const input = {supplier,sheetId,paymentId}, resolved = await resolve(input);
      if (progress.targets && progress.targets !== resolved.signature) throw new Error('O vínculo dos anexos mudou durante o envio. Confira os registros.');
      async function active() {
        repository.clearCache?.();
        if ((await resolve(input)).signature !== resolved.signature) throw new Error('O vínculo dos anexos mudou durante o envio.');
      }
      async function exists(target, entry) {
        const files = await call('listAttachments',SITE,target.listId,target.id);
        if (!Array.isArray(files) || files.some(f=>!scalar(f.name))) throw new Error('Não foi possível conferir os anexos do destino.');
        const matches = files.filter(f=>fileKey(f.name)===fileKey(entry.manifest.name));
        if (matches.length > 1) throw new Error('Há nomes de anexos ambíguos no destino.');
        for (const existing of matches.length ? matches : files) {
          const bytes = await call('downloadAttachment',SITE,target.listId,target.id,existing.name);
          const hash = await digest(bytes); assertSession();
          if (hash === entry.manifest.sha256 && bytes.byteLength === entry.manifest.size) return true;
          if (matches.length) throw new Error(`O arquivo ${entry.manifest.name} já existe com conteúdo diferente. Renomeie o novo arquivo; nada será sobrescrito.`);
        }
        // Settlement may have prefixed the source name. Content, not name alone, identifies a delivered receipt.
        return false;
      }
      // Check every destination before the first upload; a collision must not create a partial delivery.
      for (const target of resolved.targets) for (const entry of entries) await exists(target,entry);
      progress.manifest = manifest; progress.targets = resolved.signature; onProgress();
      for (const target of resolved.targets) for (const entry of entries) {
        await active();
        if (!await exists(target,entry)) {
          try { await call('uploadAttachment',SITE,target.listId,target.id,entry.file,entry.manifest.name); }
          catch (cause) { assertSession(); if (!await exists(target,entry)) throw cause; }
          if (!await exists(target,entry)) throw new Error('O envio do anexo ainda não foi confirmado. Retome esta linha.');
        }
        onProgress();
      }
      await active();
      return { status: resolved.status, targets: resolved.targets.map(({kind,id})=>({kind,id})), manifest };
    } finally { busy = false; }
  }
  return Object.freeze({ prepareFiles, submit });
}
