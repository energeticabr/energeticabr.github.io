import {buildPendingSupplierPaymentsReport} from '../chat/pending-supplier-payments-report-model.js';
import {bindSearchableFilterSelects} from './searchable-filter-selects.js';

const LOGO = new URL('../../../../assets/logo-energetica-oficial.png', import.meta.url).href;
const FILTERS = [['startDate','DATA INICIAL'], ['endDate','DATA FINAL'], ['branch','FILIAL'],
  ['supplierStatus','STATUS DO FORNECEDOR'], ['supplier','FORNECEDOR'], ['presence','PRESENÇA']];
const money = value => typeof value === 'number' && Number.isFinite(value)
  ? value.toLocaleString('pt-BR', {style:'currency', currency:'BRL'}) : 'VALOR INCOMPLETO';
const localDate = value => `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
const dateLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
  ? `${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)} (${new Intl.DateTimeFormat('pt-BR', {weekday:'long', timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`))})`
  : 'DATA PGTO NÃO INFORMADA';
const cancelled = () => new DOMException('Consulta cancelada.', 'AbortError');
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(cancelled());
  let abort;
  const cancellation = new Promise((_,reject) => {abort=()=>reject(cancelled()); signal.addEventListener('abort',abort,{once:true});});
  return Promise.race([promise,cancellation]).finally(()=>signal.removeEventListener('abort',abort));
}

export function createPendingSupplierPaymentsReportView({document:doc=globalThis.document, data, onClose=()=>{}, now=()=>new Date()} = {}) {
  if (!doc?.body || typeof data?.loadSnapshot !== 'function' || typeof onClose !== 'function' || typeof now !== 'function') {
    throw new TypeError('O relatório requer documento e sessão SharePoint.');
  }
  const win=doc.defaultView;
  const make=(tag, className='', text) => {
    const node=doc.createElement(tag); node.className=className;
    if (text !== undefined) node.textContent=String(text);
    return node;
  };
  const button=(className,label,text) => {
    const node=make('button',className,text); node.type='button'; node.setAttribute('aria-label',label); return node;
  };
  const root=make('div','pl-overlay psp-overlay'); root.hidden=true; root.setAttribute('aria-busy','false');
  const panel=make('section','pl-dialog psp-dialog'); panel.tabIndex=-1;
  panel.setAttribute('role','dialog'); panel.setAttribute('aria-modal','true'); panel.setAttribute('aria-label','Pagamentos pendentes por fornecedor');
  const warning=make('p','pl-orientation psp-orientation','PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.'); warning.setAttribute('role','status');
  const report=make('div','pl-report psp-report'), filters=make('div','pl-filters psp-filters'), controls=new Map();
  const refresh=button('pl-refresh','Atualizar pagamentos pendentes','⟳'); filters.append(refresh);
  for (const [name,label] of FILTERS) {
    const holder=make('label','pl-filter psp-filter'), control=make(name.endsWith('Date')?'input':'select','psp-filter-input');
    control.name=name; control.setAttribute('aria-label',label);
    if (control.tagName==='INPUT') control.type='date';
    holder.append(make('span','pl-filter-label',label),control); filters.append(holder); controls.set(name,control);
  }
  const notice=make('p','pl-notice psp-notice'); notice.hidden=true; notice.setAttribute('role','status');
  const content=make('div','pl-table-scroll psp-content'); content.tabIndex=0;
  content.setAttribute('role','region'); content.setAttribute('aria-label','Pagamentos pendentes e detalhamento geral');
  const dismiss=button('psp-close','Fechar relatório','×');
  report.append(filters,notice,content); panel.append(warning,report,dismiss); root.append(panel); doc.body.append(root);
  let snapshot=null, controller=null, revision=0, destroyed=false, pickers=null;
  let returnFocus=null, oldOverflow='', app=null, oldInert=false;
  const portrait=()=>win?.matchMedia ? win.matchMedia('(orientation: portrait)').matches : win?.innerHeight>win?.innerWidth;
  const selected=()=>Object.fromEntries([...controls].map(([name,node])=>[name,node.value]));
  function clearContent() {
    if (content.contains(doc.activeElement)) panel.focus({preventScroll:true});
    content.replaceChildren();
  }
  function showNotice(text='', alert=false) {
    notice.textContent=text; notice.hidden=!text; notice.setAttribute('role',alert?'alert':'status');
  }
  function setBusy(busy) {root.setAttribute('aria-busy',String(busy)); refresh.disabled=busy && !portrait();}
  function cancel() {controller?.abort(); controller=null; revision++;}
  function financialBadges(parent, row, pending=false) {
    const badges=make('div','psp-badges');
    for (const [className,label,value] of [
      ['psp-approved','APROVADO',row.approvedValue],
      ['psp-validation','PENDENTE VALIDAÇÃO',pending?row.pendingValidationValue:row.validationValue],
      ['psp-total','TOTAL',pending?row.pendingTotalValue:row.totalValue],
    ]) badges.append(make('div',`psp-badge ${className}`,`${label}: ${money(value)}`));
    parent.append(badges);
  }
  function presenceLine(row, pending=false) {
    const state=String(row.presence||'').trim().toUpperCase(), status=String(row.status||'').trim().toUpperCase();
    const entry=make('div','psp-entry'); entry.dataset.presence=state;
    entry.append(make('strong','psp-date',`📅 ${dateLabel(row.date)}`),
      make('span','psp-activity',` — ${row.activity || 'SEM ATIVIDADE'} ${row.property || ''}`));
    if (pending) {
      entry.append(make('span','psp-hours',Number.isFinite(row.workedHours)
        ? ` (${row.workedHours.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}h)` : ' HORAS DESCONHECIDAS'));
      entry.append(make('span','psp-daily',state==='AUSENTE'?'AUSENTE'
        : row.isMeasurement?'CONFORME MEDIÇÃO':money(row.dailyValue)));
      entry.append(make('span','psp-presence',state==='PENDENTE'?'PENDENTE VALIDAÇÃO':state || 'PRESENÇA NÃO INFORMADA'));
      if (row.hasDiscrepancy) entry.append(make('strong','psp-discrepancy','⚠ CONFERIR JORNADA/VALOR *'));
    } else {
      entry.append(make('span','psp-presence',state==='PENDENTE'?'PENDENTE VALIDAÇÃO'
        : state==='AUSENTE'?'AUSENTE':row.isMeasurement?'CONFORME MEDIÇÃO':money(row.dailyValue)));
    }
    if (row.paymentId) entry.append(make('strong','psp-payment-id',` — IDPGTO: ${row.paymentId}`));
    else if (state==='PRESENTE') entry.append(make('strong','psp-payment-state',status==='PAGO'
      ? ' — PAGO (IDPGTO: não indicado)' : ' — PENDENTE PGTO'));
    if (row.motivation) entry.append(make('span','psp-motivation',` MOTIVAÇÃO: ${row.motivation}`));
    if (row.observation) entry.append(make('span','psp-observation',` OBS: ${row.observation}`));
    return entry;
  }
  function paymentLine(row, linked=false) {
    const line=make('div',`psp-payment${linked?' psp-linked-payment':''}`);
    const advance=row.advance===true || String(row.advance||'').toUpperCase()==='SIM';
    if (advance) line.classList.add('psp-advance');
    line.append(make('strong','psp-payment-id',`${linked?'🔗':'💰'} IDPGTO: ${row.id}`),
      make('span','',` — ${dateLabel(row.date)} (${money(row.total)})`));
    if (linked) line.append(make('strong','psp-payer',` — PAGO EM NOME DE: ${row.supplier}`));
    if (advance) line.append(make('strong','psp-advance-label',' — ADIANTAMENTO'));
    return line;
  }
  function tableShell(className,title,columns,widths) {
    const table=make('table',`psp-table ${className}`), cols=make('colgroup'), head=make('thead');
    table.setAttribute('aria-label',title);
    const titleRow=make('tr'), heading=make('th','psp-table-title',title); heading.colSpan=columns.length; titleRow.append(heading);
    const labels=make('tr');
    for (const [index,label] of columns.entries()) {
      const col=make('col'); col.style.width=`${widths[index]}%`; cols.append(col);
      const th=make('th','',label); th.scope='col'; labels.append(th);
    }
    const body=make('tbody'); head.append(titleRow,labels); table.append(cols,head,body); return {table,body};
  }
  function render() {
    clearContent(); showNotice();
    if (!snapshot) return;
    const values=selected(), start=controls.get('startDate'), end=controls.get('endDate');
    start.setCustomValidity(''); end.setCustomValidity('');
    if (values.startDate && values.endDate && values.startDate>values.endDate) {
      start.setCustomValidity('A data inicial não pode ser posterior à data final.');
      showNotice('A data inicial não pode ser posterior à data final.',true); return;
    }
    if (!start.checkValidity() || !end.checkValidity()) {showNotice('Data inválida. Confira o período do detalhamento.',true); return;}
    let result;
    try {result=buildPendingSupplierPaymentsReport(snapshot,values,localDate(now()));}
    catch {showNotice('Não foi possível calcular o relatório completo. Use Atualizar para tentar novamente.',true); return;}
    const brand=make('div','psp-brand'), logo=make('img'); logo.src=LOGO; logo.alt='Logo Energética Construtora'; brand.append(logo);
    const note=make('p','psp-filter-note','Os filtros de data e presença aplicam-se apenas ao detalhamento geral. As pendências incluem todo o histórico não pago e as ausências dos últimos 14 dias.');
    const warnings=make('div','psp-warnings'); warnings.setAttribute('role','status');
    for (const text of result.warnings || []) warnings.append(make('p','',text));
    warnings.hidden=!warnings.childElementCount;
    const pending=tableShell('psp-pending','📊 PAGAMENTOS PENDENTES',
      ['🏢 FILIAL','👷 FORNECEDOR','🔢 DIÁRIAS','📅 DATAS','💰 PENDENTE'],[10,15,7,45,23]);
    for (const row of result.pending) {
      const tr=make('tr'), dates=make('td','psp-timeline'), financial=make('td','psp-financial');
      for (const item of row.timelineRows) dates.append(presenceLine(item,true));
      financialBadges(financial,row,true);
      tr.append(make('td','psp-branch',row.branch || '—'),make('td','psp-supplier',row.name),
        make('td','psp-count',row.pendingCount),dates,financial); pending.body.append(tr);
    }
    if (!result.pending.length) {const tr=make('tr'), cell=make('td','psp-empty',result.unresolvedUnpaidCount
      ? 'Existem registros sem cadastro correspondente. Confira os avisos antes de concluir as pendências.'
      : 'Nenhum pagamento pendente para os fornecedores selecionados.'); cell.colSpan=5; tr.append(cell); pending.body.append(tr);}
    const foot=make('tfoot'), totalRow=make('tr'), label=make('td','psp-footer-label','TOTAL GERAL PENDENTE (APROVADO):'); label.colSpan=4;
    totalRow.append(label,make('td','psp-footer-total',money(result.approvedTotal))); foot.append(totalRow); pending.table.append(foot);
    const details=tableShell('psp-details','📊 DETALHAMENTO GERAL',
      ['👷 FORNECEDOR','🔢 QTD PRESENÇA','📌 DATAS PRESENÇA','💵 DATAS PAGAMENTOS'],[15,9,40,36]);
    for (const row of result.details) {
      const tr=make('tr'), dates=make('td','psp-presences'), payments=make('td','psp-payments');
      for (const item of row.presenceRows) dates.append(presenceLine(item));
      for (const payment of row.payments) payments.append(paymentLine(payment));
      if (row.linkedElsewhere.length) {
        payments.append(make('strong','psp-linked-label','🔗 PAGAMENTO DA DIÁRIA FEITO EM OUTRO NOME'));
        for (const payment of row.linkedElsewhere) payments.append(paymentLine(payment,true));
      }
      financialBadges(payments,row);
      tr.append(make('td','psp-supplier',row.name),make('td','psp-count',row.occurrences),dates,payments); details.body.append(tr);
    }
    if (!result.details.length) {const tr=make('tr'), cell=make('td','psp-empty','Nenhuma presença corresponde ao período e aos filtros selecionados.'); cell.colSpan=4; tr.append(cell); details.body.append(tr);}
    content.append(brand,note,warnings,pending.table,details.table);
  }
  function populate() {
    pickers?.destroy(); pickers=null;
    const values=selected(), suppliers=snapshot.suppliers.filter(row=>row.contractor===true || String(row.contractor).toUpperCase()==='SIM');
    for (const [name,node] of controls) {
      if (node.tagName!=='SELECT') continue;
      const source=name==='presence'?snapshot.presences.map(row=>row.presence)
        : suppliers.map(row=>name==='branch'?row.branch:name==='supplierStatus'?row.status:row.name);
      const options=[...new Set([...source,values[name],...(name==='supplierStatus'?['ATIVO']:[])].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
      node.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));
      for (const value of options) node.append(Object.assign(make('option','',value),{value}));
      node.value=values[name];
    }
    pickers=bindSearchableFilterSelects(filters,{report:true,placement:'below'});
  }
  async function load() {
    if (root.hidden || portrait() || destroyed) return;
    pickers?.close(); cancel(); const current=revision, active=new AbortController(); controller=active;
    snapshot=null; clearContent(); showNotice('Carregando pagamentos do SharePoint…'); setBusy(true);
    const stale=()=>active.signal.aborted || current!==revision || root.hidden || destroyed;
    try {
      const loaded=await abortable(Promise.resolve().then(()=>{
        if (active.signal.aborted) throw cancelled();
        return data.loadSnapshot({signal:active.signal});
      }),active.signal);
      if (stale()) return;
      if (loaded?.complete!==true) throw new Error('Snapshot incompleto.');
      buildPendingSupplierPaymentsReport(loaded,{},localDate(now()));
      snapshot=loaded; populate(); render();
    } catch {
      if (stale()) return;
      snapshot=null; clearContent(); showNotice('Não foi possível carregar os pagamentos completos. Use Atualizar para tentar novamente.',true);
    } finally {if (!stale()) {controller=null; setBusy(false);}}
  }
  function orientationChanged() {
    if (root.hidden || destroyed) return;
    const vertical=portrait(), wasHidden=report.hidden;
    warning.hidden=!vertical; panel.classList.toggle('pl-dialog--portrait',vertical);
    if (vertical) {
      pickers?.close(); if (report.contains(doc.activeElement)) panel.focus({preventScroll:true});
      cancel(); report.hidden=true; setBusy(true);
      if (!snapshot) {clearContent(); showNotice();}
    } else if (wasHidden) {report.hidden=false; if (snapshot) setBusy(false); else void load();}
  }
  function close() {
    if (root.hidden) return;
    cancel(); pickers?.close(); snapshot=null; root.hidden=true; setBusy(false); clearContent(); showNotice();
    doc.body.style.overflow=oldOverflow; if (app) app.inert=oldInert;
    const target=returnFocus?.isConnected?returnFocus:doc.querySelector('[data-action="open-pending-supplier-payments-report"]:not(:disabled)') || app;
    returnFocus=null; target?.focus?.({preventScroll:true}); onClose();
  }
  refresh.addEventListener('click',()=>void load()); dismiss.addEventListener('click',close);
  root.addEventListener('click',event=>{if(event.target===root) close();});
  root.addEventListener('keydown',event=>{
    if (root.hidden || event.defaultPrevented) return;
    if (event.key==='Escape') {event.preventDefault(); close(); return;}
    if (event.key!=='Tab') return;
    const nodes=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(node=>!node.disabled&&!node.closest('[hidden]')&&node.tabIndex>=0);
    const first=nodes[0], last=nodes.at(-1);
    if (event.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)) {event.preventDefault(); last?.focus();}
    else if (!event.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)) {event.preventDefault(); first?.focus();}
  });
  for (const control of controls.values()) {
    const update=()=>{if(!root.hidden && snapshot) {render(); content.scrollTop=0;}};
    control.addEventListener('change',update);
    if (control.tagName==='INPUT') control.addEventListener('input',update);
  }
  win?.addEventListener('resize',orientationChanged); win?.addEventListener('orientationchange',orientationChanged);
  return Object.freeze({element:root, async open() {
    if (destroyed) throw new Error('O relatório foi encerrado.');
    if (!root.hidden) return;
    returnFocus=doc.activeElement; oldOverflow=doc.body.style.overflow; app=doc.getElementById('app'); oldInert=app?.inert || false;
    doc.body.style.overflow='hidden'; if(app) app.inert=true;
    pickers?.destroy(); pickers=null; const today=localDate(now());
    for (const [name,node] of controls) {
      const value=name==='startDate'?`${today.slice(0,7)}-01`:name==='endDate'?today:name==='supplierStatus'?'ATIVO':'';
      if (node.tagName==='INPUT') node.setCustomValidity('');
      else node.replaceChildren(Object.assign(make('option','',value || 'Todos'),{value}));
      node.value=value;
    }
    root.hidden=false; const vertical=portrait(); warning.hidden=!vertical; report.hidden=vertical;
    panel.classList.toggle('pl-dialog--portrait',vertical); setBusy(vertical); panel.focus(); content.scrollTop=0;
    if (!vertical) await load();
  }, close, destroy() {
    if (destroyed) return;
    close(); destroyed=true; pickers?.destroy(); pickers=null;
    win?.removeEventListener('resize',orientationChanged); win?.removeEventListener('orientationchange',orientationChanged); root.remove();
  }});
}
