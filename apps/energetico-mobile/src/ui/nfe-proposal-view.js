import Decimal from 'decimal.js';
import { bindBackdropDismiss } from '../../../../portal/ui/backdrop-dismiss.js';
import {
  nfeProposalAmounts, nfeProposalStages, nfeProposalUnit, updateNfeProposalBranch,
  updateNfeProposalProduct, updateNfeProposalSupplier, validateNfeProposal,
} from '../chat/nfe-proposal-model.js';
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';
import { createProposalAttachmentTray } from './nfe-proposal-attachment-tray.js';

const money = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' });
const unitMoney = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL', maximumFractionDigits:10 });
const displayDate = date => date ? date.split('-').reverse().join('/') : 'Não informado';
const labelOf = (options, id, empty) => options.find(option => option.id === id)?.label || (id ? `ID ${id}` : empty);

export function createNfeProposalView({ document:doc, host, service, onPosted, onClose, attachments, provision = false }) {
  const heading = provision ? 'Proposta de provisão' : 'Relatório proposto de lançamentos';
  const submitLabel = provision ? 'CRIAR DESCRITIVO E PROVISÕES' : 'SUBMETER PEDIDO E LANÇAMENTOS';
  let current;
  const retained = new Map();
  const el = (tag, className = '', text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const button = (label, handler, className = '') => {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  };

  function close() {
    if (!current) return;
    const { controller, overlay, background, trigger } = current;
    current = undefined;
    Promise.resolve(attachments?.deactivate?.()).catch(()=>{});
    controller.abort();
    overlay.remove();
    for (const [node, inert] of background) node.inert = inert;
    if (!host.hidden && trigger?.isConnected) trigger.focus({ preventScroll:true });
    onClose?.();
  }

  async function show(row, trigger) {
    if (host.hidden || current) return;
    const overlay = el('div', 'nfe-proposal-overlay');
    overlay.toggleAttribute('data-iphone', doc.defaultView.navigator.userAgent.includes('iPhone'));
    const pickerOptions = { report:true, reportFrame:overlay };
    const dialog = el('section', 'nfe-proposal-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', heading);
    dialog.tabIndex = -1;
    const header = el('header', 'nfe-proposal-header');
    const title = el('h2', '', heading.toUpperCase());
    const cancel = () => { if (current === entry && !entry.busy) close(); };
    const closeControl = button('Voltar', cancel);
    header.append(title, closeControl);
    const form = el('form', 'nfe-proposal-form');
    form.noValidate = true;
    const status = el('p', 'nfe-proposal-status', 'Consultando o XML da nota e os cadastros…');
    status.setAttribute('role', 'status');
    const body = el('div', 'nfe-proposal-body');
    const footer = el('footer', 'nfe-proposal-footer');
    const total = el('strong');
    total.dataset.nfeProposalTotal = '';
    const submit = el('button', 'nfe-proposal-submit', submitLabel);
    submit.type = 'submit';
    submit.dataset.nfeProposalSubmit = '';
    submit.disabled = true;
    footer.append(total, submit);
    form.append(body, footer);
    dialog.append(header, status, form);
    overlay.append(dialog);
    const background = [...host.children].map(node => [node, node.inert === true]);
    for (const [node] of background) node.inert = true;
    const key = String(row.key || row.id);
    if (!retained.has(key)) retained.set(key, { files:[],imports:new Set(),pendingSave:Promise.resolve() });
    const session = retained.get(key), files = session.files;
    const entry = { key, overlay, background, trigger, files, session, imports:session.imports, controller:new AbortController(), manualStages:new Set(), busy:false, reserved:false };
    const signal = entry.controller.signal;
    const pickers = new Map();
    function destroyPickers() {
      for (const picker of pickers.values()) picker.destroy();
      pickers.clear();
    }
    signal.addEventListener('abort', destroyPickers, { once:true });
    current = entry;
    host.append(overlay);
    dialog.focus({ preventScroll:true });
    bindBackdropDismiss(overlay, cancel);

    const isCurrent = () => current === entry && !signal.aborted;
    const feedback = (text, error = false) => {
      status.textContent = text;
      status.setAttribute('role', error ? 'alert' : 'status');
    };
    const tray = !provision ? createProposalAttachmentTray({
      document:doc, files, attachments, signal, changed:()=>{
        if(current?.session === session) current.refresh?.();
        const snapshot=[...files];
        session.pendingSave = session.pendingSave.catch(()=>{}).then(()=>attachments?.save?.(row,snapshot));
        session.pendingSave.catch(error=>{ if(isCurrent())feedback(error.message,true); });
        return session.pendingSave;
      }, isBusy:()=>entry.busy,
    }) : null;
    entry.tray = tray;
    entry.refresh = lock;
    entry.receive = incoming => tray?.append(incoming);
    function lock() {
      closeControl.disabled = entry.busy;
      submit.disabled = entry.busy || !entry.draft && !entry.attachmentOnly || Boolean(tray?.picking);
      submit.textContent = entry.attachmentOnly ? 'ENVIAR ANEXOS AO PEDIDO' : entry.reserved ? 'RETOMAR ENVIO' : submitLabel;
      for (const fields of body.querySelectorAll('fieldset')) fields.disabled = entry.busy || entry.reserved;
      tray?.render();
    }

    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        cancel();
      }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button,select,input,summary')].filter(node =>
        !node.matches(':disabled,[tabindex="-1"]') && !node.closest('[hidden]') &&
        (!node.closest('details:not([open])') || node.tagName === 'SUMMARY'));
      if (!controls.length) return;
      const index = controls.indexOf(doc.activeElement);
      if (index === -1 || (event.shiftKey ? index === 0 : index === controls.length - 1)) {
        event.preventDefault();
        (event.shiftKey ? controls.at(-1) : controls[0]).focus();
      }
      event.stopPropagation();
    });

    function populate(select, options, selected, placeholder) {
      const blank = el('option', '', placeholder);
      blank.value = '';
      select.replaceChildren(blank, ...options.map(option => {
        const node = el('option', '', option.label);
        node.value = option.id;
        return node;
      }));
      if (selected && !options.some(option => option.id === selected)) {
        const previous = el('option', '', `ID ${selected} · registro da proposta`);
        previous.value = selected;
        select.append(previous);
      }
      select.value = selected || '';
    }

    function field(container, label, name, type, onChange) {
      const wrapper = el('label', type === 'select' ? 'nfe-proposal-select' : '');
      const control = el(type === 'select' ? 'select' : 'input');
      control.name = name;
      if (type !== 'select') {
        control.type = type === 'decimal' ? 'text' : type;
        if (type === 'decimal') control.inputMode = 'decimal';
      }
      wrapper.append(el('span', '', label), control);
      container.append(wrapper);
      control.addEventListener(type === 'decimal' ? 'input' : 'change', () => {
        if (entry.busy || entry.reserved) return;
        onChange(control.value);
        feedback('');
        refreshTotals();
      });
      return control;
    }

    let summaries = [], stageControls = [];
    function refreshTotals() {
      let sum = new Decimal(0), incomplete = false;
      const stages = nfeProposalStages(entry.catalog, entry.draft.branchId);
      entry.draft.lines.forEach((line, index) => {
        const product = labelOf(entry.catalog.products, line.productId, 'Produto a confirmar');
        const stage = labelOf(stages, line.stageId, 'Etapa a confirmar');
        let value = 'Valor a conferir';
        let unitPrice = line.unitPrice || 'A conferir';
        try {
          const amounts = nfeProposalAmounts(line);
          sum = sum.plus(amounts.total);
          value = money.format(amounts.total.toNumber());
          unitPrice = unitMoney.format(amounts.unitPrice.toNumber());
        } catch { incomplete = true; }
        const { fiscal } = entry;
        const invoiceUnit = fiscal.lines[index].unit;
        const catalogUnit = entry.catalog.products.find(option => option.id === line.productId)?.unit;
        const { clusters, dates } = summaries[index];
        clusters.product.textContent = product;
        clusters.stage.textContent = stage;
        clusters.quantity.textContent = `${line.quantity} ${nfeProposalUnit(entry.legacyUnits ? '' : invoiceUnit, catalogUnit)}`.trim();
        clusters.unitPrice.textContent = unitPrice;
        clusters.total.textContent = value;
        dates.textContent = [
          `Data ${displayDate(line.date)}`, line.dueDate && `Vencimento ${displayDate(line.dueDate)}`,
        ].filter(Boolean).join(' · ');
      });
      const delta = sum.minus(entry.fiscal.total);
      total.textContent = incomplete ? 'Revise os valores dos itens.' : `Total proposto ${money.format(sum.toNumber())}${delta.isZero() ? '' :
        ` · Diferença da nota ${money.format(delta.toNumber())}`}`;
    }

    function updateStages() {
      const stages = nfeProposalStages(entry.catalog, entry.draft.branchId);
      stageControls.forEach((control, index) => {
        if (control) populate(control, stages, entry.draft.lines[index].stageId, 'Selecione a etapa');
      });
    }

    function render() {
      const { draft, fiscal, catalog } = entry;
      destroyPickers();
      body.replaceChildren();
      summaries = [];
      stageControls = [];
      const baseLabel = provision ? 'Valor base da provisão' : 'Valor da nota';
      const reference = el('p', 'nfe-proposal-reference', `${row.type} · nº ${row.number || row.id} · Emitida em ${displayDate(fiscal.issueDate)} · ${baseLabel} ${money.format(Number(fiscal.total))}`);
      const attachment = el('p', 'nfe-proposal-attachment', `Todos os anexos da nota, inclusive DDA, serão enviados ao ${provision ? 'descritivo' : 'pedido'}. PDF fiscal · ${row.pdfName}`);
      const headerFields = el('fieldset', 'nfe-proposal-fields nfe-proposal-header-fields');
      body.append(reference, attachment, headerFields);
      if (!fiscal.dueDate) body.append(el('p', 'nfe-proposal-hint', provision
        ? 'O XML não informa o vencimento. Informe a data de cada item.'
        : 'O XML não informa um vencimento único. Confira a data de cada item.'));
      if (catalog.historyUnavailable) body.append(el('p', 'nfe-proposal-hint', 'Histórico de uso indisponível. Selecione as etapas pelo cadastro da filial.'));
      const supplier = field(headerFields, 'Fornecedor', 'supplierId', 'select', value => {
        entry.manualStages.clear();
        entry.draft = updateNfeProposalSupplier(entry.draft, value, catalog);
        branch.value = entry.draft.branchId;
        account.value = entry.draft.accountId;
        pickers.get(headerFields)?.sync();
        updateStages();
      });
      const branch = field(headerFields, 'Filial', 'branchId', 'select', value => {
        entry.manualStages.clear();
        entry.draft = updateNfeProposalBranch(entry.draft, value, catalog);
        updateStages();
      });
      if (!provision) {
        const dates = el('div', 'nfe-proposal-dates');
        headerFields.append(dates);
        const orderDate = field(dates, 'Data do pedido', 'date', 'date', value => { entry.draft.date = value; });
        orderDate.value = draft.date;
        const paymentDate = field(dates, 'Data pgto efetuado', 'paymentDate', 'date', value => { entry.draft.paymentDate = value; });
        paymentDate.required = true;
        paymentDate.value = draft.paymentDate || '';
      }
      const account = field(headerFields, 'Conta / forma de pagamento', 'accountId', 'select', value => { entry.draft.accountId = value; });
      populate(supplier, catalog.suppliers, draft.supplierId, 'Selecione o fornecedor');
      populate(branch, catalog.branches, draft.branchId, 'Selecione a filial');
      populate(account, catalog.accounts, draft.accountId, provision ? 'Sem conta (opcional)' : 'Selecione a conta');
      pickers.set(headerFields, bindSearchableFilterSelects(headerFields, pickerOptions));
      const list = el('div', 'nfe-proposal-lines');
      body.append(list);
      fiscal.lines.forEach((original, index) => {
        const details = el('details', 'nfe-proposal-line');
        const summary = el('summary');
        const meta = el('span', 'nfe-proposal-line-summary');
        const clusters = {};
        for (const [name, label] of [['product','Produto'], ['stage','Etapa'], ['quantity','Quantidade'], ['unitPrice','Valor unitário'], ['total','Total']]) {
          const cluster = el('span', `nfe-proposal-cluster nfe-proposal-cluster--${name}`);
          const value = el('span', 'nfe-proposal-cluster-value');
          value.dataset.proposalSummary = name;
          cluster.append(el('span', 'nfe-proposal-cluster-label', label), value);
          meta.append(cluster);
          clusters[name] = value;
        }
        const dates = el('span', 'nfe-proposal-line-dates');
        summaries[index] = { clusters, dates };
        summary.append(el('strong', '', `Item ${original.number} · ${original.description}`), meta, dates);
        const editor = el('div', 'nfe-proposal-line-editor');
        details.append(summary, editor);
        list.append(details);
        details.addEventListener('toggle', () => {
          if (!isCurrent() || !body.contains(editor)) return;
          if (!details.open) {
            pickers.get(editor)?.destroy();
            pickers.delete(editor);
            editor.replaceChildren();
            stageControls[index] = null;
            return;
          }
          if (editor.hasChildNodes()) return;
          const line = entry.draft.lines[index];
          const fields = el('fieldset', 'nfe-proposal-fields');
          editor.append(el('p', 'nfe-proposal-hint',
            `XML · ${original.quantity} ${original.unit || ''} × ${original.unitPrice} · ${entry.legacyUnits
              ? 'Este envio já iniciado mantém a unidade reservada anteriormente.' : original.unit?.trim()
              ? 'A unidade da nota fiscal será usada automaticamente.'
              : 'Sem unidade na nota fiscal. Será usada a unidade do cadastro.'}`), fields);
          const product = field(fields, 'Produto', 'productId', 'select', value => {
            entry.manualStages.delete(String(line.number));
            entry.draft = updateNfeProposalProduct(entry.draft, line.number, value, catalog);
            updateStages();
          });
          populate(product, catalog.products, line.productId, 'Selecione o produto');
          stageControls[index] = field(fields, 'Etapa', 'stageId', 'select', value => {
            entry.draft.lines[index].stageId = value;
            entry.manualStages.add(String(line.number));
          });
          updateStages();
          for (const [label, name, type] of [
            ['Quantidade','quantity','decimal'], ['Valor unitário','unitPrice','decimal'], ['Desconto','discount','decimal'],
            ['Acréscimos / ajustes','adjustment','decimal'], [provision ? 'Data da provisão' : 'Data do lançamento','date','date'], ['Vencimento','dueDate','date'],
          ]) {
            const control = field(fields, label, name, type, value => { entry.draft.lines[index][name] = value; });
            control.value = line[name] || '';
          }
          lock();
          pickers.set(editor, bindSearchableFilterSelects(fields, pickerOptions));
        });
      });
      if (tray) body.append(tray.element);
      refreshTotals();
      lock();
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!isCurrent() || entry.busy || !entry.draft && !entry.attachmentOnly) return;
      if (!entry.reserved && !entry.attachmentOnly && !entry.postedReceipt) {
        try { validateNfeProposal(entry.draft, entry.fiscal, entry.catalog, { provision }); }
        catch (error) { feedback(error.message, true); return; }
      }
      entry.busy = true;
      lock();
      feedback(provision ? 'Gravando descritivo, provisões e todos os anexos no SharePoint…' : 'Gravando pedido, lançamentos e todos os anexos no SharePoint…');
      try {
        let receipt, sentFiles;
        do {
          await Promise.all(entry.imports);
          await session.pendingSave;
          sentFiles = [...files];
          if (entry.attachmentOnly || entry.postedReceipt) {
            receipt = await service.appendAttachments(row, sentFiles, { signal });
          } else receipt = await service.submit(row, entry.draft, {
          signal, catalog:entry.catalog, xmlHash:entry.xmlHash, baseline:entry.baseline,
          additionalAttachments:sentFiles,
          manualStages:new Set(entry.manualStages),
          onProgress({ completedLines, totalLines }) {
            if (isCurrent()) feedback(`${provision ? 'Provisões conferidas' : 'Lançamentos conferidos'} ${completedLines} de ${totalLines}.`);
          },
          });
          entry.postedReceipt = receipt;
          await Promise.all(entry.imports);
          for (const file of sentFiles) if (file.sourceId) await attachments?.discard?.(file.sourceId);
          await Promise.all(entry.imports);
          await session.pendingSave;
        } while (isCurrent() && (files.length !== sentFiles.length || files.some((file,index)=>file !== sentFiles[index])));
        if (!isCurrent()) return;
        // Stop accepting new readers only once every captured read was drained.
        entry.delivered = true;
        await attachments?.save?.(row,[]);
        retained.delete(key);
        close();
        onPosted(receipt);
      } catch (error) {
        if (!isCurrent()) return;
        entry.delivered = false;
        if (!entry.postedReceipt && !entry.attachmentOnly && typeof service.loadReservation === 'function') {
          try {
            const reserved = await service.loadReservation(row, { signal });
            if (!isCurrent()) return;
            if (reserved) { entry.draft = reserved; entry.reserved = true; render(); }
          } catch {
            if (!isCurrent()) return;
            // A lost response may have reserved the note. Keep the exact draft.
            entry.reserved = true;
          }
        }
        feedback(error?.message || 'Não foi possível confirmar o envio. Tente novamente.', true);
      } finally {
        if (isCurrent()) { entry.busy = false; lock(); }
      }
    });

    try {
      entry.ready = (async()=>{
        if (provision) return;
        await attachments?.activate?.(row);
        const persisted = await attachments?.load?.(row) || [];
        for (const file of persisted) if (!files.some(item=>item === file || file.sourceId && item.sourceId === file.sourceId
          || file.proposalAttachmentId && item.proposalAttachmentId === file.proposalAttachmentId)) files.push(file);
        if (current?.session === session) current.tray?.render();
      })();
      await entry.ready;
      if (!isCurrent()) return;
      if (!provision && row.orderId) {
        entry.attachmentOnly = true;
        body.append(tray.element);
        feedback(`Envie os anexos pendentes ao pedido #${row.orderId}.`);
        submit.textContent = 'ENVIAR ANEXOS AO PEDIDO';
        lock();
        return;
      }
      const proposal = await service.load(row, { signal });
      if (!isCurrent()) return;
      Object.assign(entry, proposal);
      feedback(entry.reserved ? 'Há um envio pendente para esta nota. Retome para concluir a gravação.' :
        provision ? 'Revise o descritivo e abra cada item para conferir a provisão e o vencimento.' :
          'Revise o pedido e abra cada item para editar a proposta.');
      render();
    } catch (error) {
      if (isCurrent()) feedback(error?.message || 'Não foi possível montar a proposta fiscal.', true);
    }
  }

  return Object.freeze({ show, close,
    captureAttachmentReceiver:() => {
      if (provision || !current || current.delivered) return null;
      const entry = current;
      let finish;
      const pending = new Promise(resolve=>{finish=resolve;});
      entry.imports.add(pending);
      const cancel = () => { entry.imports.delete(pending); finish(); };
      const receive = async incoming => { try { await entry.ready; return await entry.receive(incoming); } finally { cancel(); } };
      receive.cancel = cancel;
      receive.invoiceKey = entry.key;
      return receive;
    },
    get isOpen() { return Boolean(current); } });
}
