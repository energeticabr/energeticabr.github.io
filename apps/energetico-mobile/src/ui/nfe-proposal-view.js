import Decimal from 'decimal.js';
import {
  nfeProposalAmounts, nfeProposalStages, nfeProposalUnitMismatch, updateNfeProposalBranch,
  updateNfeProposalProduct, updateNfeProposalSupplier, validateNfeProposal,
} from '../chat/nfe-proposal-model.js';

const money = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' });
const displayDate = date => date ? date.split('-').reverse().join('/') : 'Não informado';
const labelOf = (options, id, empty) => options.find(option => option.id === id)?.label || (id ? `ID ${id}` : empty);

export function createNfeProposalView({ document:doc, host, service, onPosted }) {
  let current;
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
    controller.abort();
    overlay.remove();
    for (const [node, inert] of background) node.inert = inert;
    if (!host.hidden && trigger?.isConnected) trigger.focus({ preventScroll:true });
  }

  async function show(row, trigger) {
    if (host.hidden || current) return;
    const overlay = el('div', 'nfe-proposal-overlay');
    const dialog = el('section', 'nfe-proposal-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Relatório proposto de lançamentos');
    dialog.tabIndex = -1;
    const header = el('header', 'nfe-proposal-header');
    const title = el('h2', '', 'RELATÓRIO PROPOSTO DE LANÇAMENTOS');
    const closeControl = button('Voltar', () => { if (!entry.busy) close(); });
    header.append(title, closeControl);
    const form = el('form', 'nfe-proposal-form');
    form.noValidate = true;
    const status = el('p', 'nfe-proposal-status', 'Consultando o XML da nota e os cadastros…');
    status.setAttribute('role', 'status');
    const body = el('div', 'nfe-proposal-body');
    const footer = el('footer', 'nfe-proposal-footer');
    const total = el('strong');
    total.dataset.nfeProposalTotal = '';
    const submit = el('button', 'nfe-proposal-submit', 'SUBMETER PEDIDO E LANÇAMENTOS');
    submit.type = 'submit';
    submit.dataset.nfeProposalSubmit = '';
    submit.disabled = true;
    footer.append(total, submit);
    form.append(body, footer);
    dialog.append(header, status, form);
    overlay.append(dialog);
    const background = [...host.children].map(node => [node, node.inert === true]);
    for (const [node] of background) node.inert = true;
    const entry = { overlay, background, trigger, controller:new AbortController(), manualStages:new Set(), busy:false, reserved:false };
    const signal = entry.controller.signal;
    current = entry;
    host.append(overlay);
    dialog.focus({ preventScroll:true });

    const isCurrent = () => current === entry && !signal.aborted;
    const feedback = (text, error = false) => {
      status.textContent = text;
      status.setAttribute('role', error ? 'alert' : 'status');
    };
    function lock() {
      closeControl.disabled = entry.busy;
      submit.disabled = entry.busy || !entry.draft;
      submit.textContent = entry.reserved ? 'RETOMAR ENVIO' : 'SUBMETER PEDIDO E LANÇAMENTOS';
      for (const fields of body.querySelectorAll('fieldset')) fields.disabled = entry.busy || entry.reserved;
    }

    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!entry.busy) close();
      }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button,select,input,summary')].filter(node =>
        !node.matches(':disabled') && (!node.closest('details:not([open])') || node.tagName === 'SUMMARY'));
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
      const wrapper = el('label');
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
        try {
          const amounts = nfeProposalAmounts(line);
          sum = sum.plus(amounts.total);
          value = money.format(amounts.total.toNumber());
        } catch { incomplete = true; }
        const { fiscal } = entry;
        const invoiceUnit = fiscal.lines[index].unit;
        const catalogUnit = entry.catalog.products.find(option => option.id === line.productId)?.unit;
        summaries[index].textContent = [
          product, stage, `${line.quantity} ${catalogUnit || invoiceUnit || ''} × ${line.unitPrice}`.trim(), value,
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
      body.replaceChildren();
      summaries = [];
      stageControls = [];
      const reference = el('p', 'nfe-proposal-reference', `${row.type} · nº ${row.number || row.id} · Emitida em ${displayDate(fiscal.issueDate)} · Valor da nota ${money.format(Number(fiscal.total))}`);
      const attachment = el('p', 'nfe-proposal-attachment', `PDF fiscal a anexar ao pedido · ${row.pdfName}`);
      const headerFields = el('fieldset', 'nfe-proposal-fields');
      body.append(reference, attachment, headerFields);
      if (!fiscal.dueDate) body.append(el('p', 'nfe-proposal-hint', 'O XML não informa um vencimento único. Confira a data de cada item.'));
      if (catalog.historyUnavailable) body.append(el('p', 'nfe-proposal-hint', 'Histórico de uso indisponível. Selecione as etapas pelo cadastro da filial.'));
      const supplier = field(headerFields, 'Fornecedor', 'supplierId', 'select', value => {
        entry.manualStages.clear();
        entry.draft = updateNfeProposalSupplier(entry.draft, value, catalog);
        branch.value = entry.draft.branchId;
        account.value = entry.draft.accountId;
        updateStages();
      });
      const branch = field(headerFields, 'Filial', 'branchId', 'select', value => {
        entry.manualStages.clear();
        entry.draft = updateNfeProposalBranch(entry.draft, value, catalog);
        updateStages();
      });
      const orderDate = field(headerFields, 'Data do pedido', 'date', 'date', value => { entry.draft.date = value; });
      const account = field(headerFields, 'Conta / forma de pagamento', 'accountId', 'select', value => { entry.draft.accountId = value; });
      populate(supplier, catalog.suppliers, draft.supplierId, 'Selecione o fornecedor');
      populate(branch, catalog.branches, draft.branchId, 'Selecione a filial');
      populate(account, catalog.accounts, draft.accountId, 'Selecione a conta');
      orderDate.value = draft.date;
      const list = el('div', 'nfe-proposal-lines');
      body.append(list);
      fiscal.lines.forEach((original, index) => {
        const details = el('details', 'nfe-proposal-line');
        const summary = el('summary');
        summaries[index] = el('small');
        summary.append(el('strong', '', `Item ${original.number} · ${original.description}`), summaries[index]);
        const editor = el('div', 'nfe-proposal-line-editor');
        details.append(summary, editor);
        list.append(details);
        details.addEventListener('toggle', () => {
          if (!details.open) { editor.replaceChildren(); stageControls[index] = null; return; }
          if (editor.hasChildNodes()) return;
          const line = entry.draft.lines[index];
          const fields = el('fieldset', 'nfe-proposal-fields');
          editor.append(el('p', 'nfe-proposal-hint',
            `XML · ${original.quantity} ${original.unit || ''} × ${original.unitPrice} · Confira a unidade do cadastro ao revisar a quantidade.`), fields);
          const unitCheck = el('label', 'nfe-proposal-unit-check');
          const unitReviewed = el('input');
          unitReviewed.type = 'checkbox';
          const unitHint = el('span');
          unitCheck.append(unitReviewed, unitHint);
          const syncUnit = () => {
            const saved = entry.draft.lines[index];
            const catalogUnit = catalog.products.find(option => option.id === saved.productId)?.unit;
            unitCheck.hidden = !nfeProposalUnitMismatch(original.unit, catalogUnit);
            unitReviewed.checked = saved.unitReviewed === true;
            unitHint.textContent = `Conferi a quantidade. A nota usa ${original.unit} e o cadastro usa ${catalogUnit}.`;
          };
          unitReviewed.addEventListener('change', () => {
            if (!entry.reserved && !entry.busy) entry.draft.lines[index].unitReviewed = unitReviewed.checked;
          });
          const product = field(fields, 'Produto', 'productId', 'select', value => {
            entry.manualStages.delete(String(line.number));
            entry.draft = updateNfeProposalProduct(entry.draft, line.number, value, catalog);
            updateStages();
            syncUnit();
          });
          populate(product, catalog.products, line.productId, 'Selecione o produto');
          stageControls[index] = field(fields, 'Etapa', 'stageId', 'select', value => {
            entry.draft.lines[index].stageId = value;
            entry.manualStages.add(String(line.number));
          });
          updateStages();
          for (const [label, name, type] of [
            ['Quantidade','quantity','decimal'], ['Valor unitário','unitPrice','decimal'], ['Desconto','discount','decimal'],
            ['Acréscimos / ajustes','adjustment','decimal'], ['Data do lançamento','date','date'], ['Vencimento','dueDate','date'],
          ]) {
            const control = field(fields, label, name, type, value => { entry.draft.lines[index][name] = value; });
            control.value = line[name] || '';
          }
          fields.append(unitCheck);
          syncUnit();
          lock();
        });
      });
      refreshTotals();
      lock();
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!isCurrent() || entry.busy || !entry.draft) return;
      if (!entry.reserved) {
        try { validateNfeProposal(entry.draft, entry.fiscal, entry.catalog); }
        catch (error) { feedback(error.message, true); return; }
      }
      entry.busy = true;
      lock();
      feedback('Gravando pedido, lançamentos e PDF no SharePoint…');
      try {
        const receipt = await service.submit(row, entry.draft, {
          signal, catalog:entry.catalog, xmlHash:entry.xmlHash, baseline:entry.baseline,
          manualStages:new Set(entry.manualStages),
          onProgress({ completedLines, totalLines }) {
            if (isCurrent()) feedback(`Lançamentos conferidos ${completedLines} de ${totalLines}.`);
          },
        });
        if (!isCurrent()) return;
        close();
        onPosted(receipt);
      } catch (error) {
        if (!isCurrent()) return;
        if (typeof service.loadReservation === 'function') {
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
      const proposal = await service.load(row, { signal });
      if (!isCurrent()) return;
      Object.assign(entry, proposal);
      feedback(entry.reserved ? 'Há um envio pendente para esta nota. Retome para concluir a gravação.' :
        'Revise o pedido e abra cada item para editar a proposta.');
      render();
    } catch (error) {
      if (isCurrent()) feedback(error?.message || 'Não foi possível montar a proposta fiscal.', true);
    }
  }

  return Object.freeze({ show, close, get isOpen() { return Boolean(current); } });
}
