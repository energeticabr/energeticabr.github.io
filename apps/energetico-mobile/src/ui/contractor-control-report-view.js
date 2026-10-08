import {contractorReport, documentCell, formatReportDate, formatReportMoney} from '../chat/contractor-report-model.js';
import {bindSearchableFilterSelects} from './searchable-filter-selects.js';

const LOGO = new URL('../../../../assets/logo-energetica-oficial.png', import.meta.url).href;
const FILTERS = [['id','NÚMERO CONTRATO'], ['branch','FILIAL'], ['supplier','FORNECEDOR'],
  ['stage','ETAPA'], ['activity','ATIVIDADE'], ['status','STATUS']];
const COLUMNS = [['id','ID'], ['startDate','DATA INÍCIO'], ['endDate','DATA FIM'], ['branch','FILIAL'],
  ['supplier','FORNECEDOR'], ['measurementType','TIPO MEDIÇÃO'], ['activity','ATIVIDADE EXECUTADA'],
  ['contractDocumentId','ID CONTRATO'], ['estimateDocumentId','ID ESTIMATIVA'],
  ['globalEstimatedValue','VALOR GLOBAL ESTIMADO'], ['totalValue','VALOR TOTAL'], ['totalMeasurements','TOTAL MEDIÇÕES'], ['status','STATUS']];
const WIDTHS = [4,7,7,6,12,8,12,6,6,9,8,8,7];
const PAGE_SIZE = 25;
const text = value => String(value ?? '').trim() || 'PENDENTE';
const statusTone = (value, payment=false) => {
  const status = text(value).toUpperCase();
  return (payment?['PAGO','APROVADO']:['ATIVO']).includes(status) ? 'success'
    : !payment && status === 'INATIVO' ? 'danger' : status === 'PENDENTE' ? 'pending' : 'neutral';
};
const cancelled = () => new DOMException('Consulta cancelada.', 'AbortError');
// Settle our lifecycle even if a data provider ignores AbortSignal.
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(cancelled());
  let abort;
  const cancellation = new Promise((_,reject) => {abort=()=>reject(cancelled());signal.addEventListener('abort',abort,{once:true});});
  return Promise.race([promise,cancellation]).finally(()=>signal.removeEventListener('abort',abort));
}

export function createContractorControlReportView({document:doc=globalThis.document, data, onHome=()=>{}, onClose=()=>{}}={}) {
  if (!doc?.body || typeof data?.loadOverview !== 'function' || typeof data?.loadDetails !== 'function'
    || typeof onHome !== 'function' || typeof onClose !== 'function') throw new TypeError('O relatório requer documento e fonte de dados.');
  const win = doc.defaultView;
  const make = (tag, className='', value) => {
    const node=doc.createElement(tag);node.className=className;
    if (value !== undefined) node.textContent=String(value);
    return node;
  };
  const button = (className, label, value=label) => {
    const node=make('button',className,value);node.type='button';node.setAttribute('aria-label',label);return node;
  };
  const root=make('div','pl-overlay ccr-overlay');root.hidden=true;root.setAttribute('aria-busy','false');
  const panel=make('section','pl-dialog ccr-dialog');panel.tabIndex=-1;
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Controle de empreiteiros');
  const orientation=make('p','pl-orientation ccr-orientation','PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');orientation.setAttribute('role','status');
  const back=button('ccr-back','Voltar ao menu inicial','←'),dismiss=button('ccr-close','Fechar relatório','×');
  const report=make('div','pl-report ccr-report'),filters=make('div','pl-filters ccr-filters'),controls=new Map();
  const refresh=button('pl-refresh ccr-refresh','Atualizar controle de empreiteiros','⟳');filters.append(refresh);
  for (const [name,label] of FILTERS) {
    const holder=make('label','pl-filter ccr-filter'),control=make('select','ccr-filter-input');
    control.name=name;control.setAttribute('aria-label',label);
    holder.append(make('span','pl-filter-label ccr-filter-label',label),control);filters.append(holder);controls.set(name,control);
  }
  const notice=make('div','pl-notice ccr-notice');notice.hidden=true;
  const content=make('div','pl-table-scroll ccr-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Controle de empreiteiros e detalhes vinculados');
  const brand=make('div','ccr-brand'),logo=make('img');logo.src=LOGO;logo.alt='Logo Energética Construtora';brand.append(logo);
  const title=make('h1','ccr-title','CONTROLE DE EMPREITEIROS'),metrics=make('dl','ccr-metrics'),metricValues=new Map();
  for (const [name,label] of [['active','QTD ATIVOS'],['inactive','QTD INATIVOS'],['contracts','QTD TOTAL CONTRATOS'],['activeGlobalValue','VALOR TOTAL GLOBAL ATIVOS']]) {
    const card=make('div',`ccr-metric ccr-metric--${name}`),value=make('dd','','—');value.dataset.metric=name;
    card.append(make('dt','',label),value);metrics.append(card);metricValues.set(name,value);
  }
  const note=make('p','ccr-note','Ao selecionar o ID da linha de EMPREITEIRO (NÚMERO CONTRATO), será apresentado o detalhamento. IDCONTRATO é o ID do documento.');
  const warnings=make('div','ccr-warnings');warnings.hidden=true;warnings.setAttribute('role','status');
  const main=tableShell('ccr-main-table','Controle de empreiteiros',COLUMNS,WIDTHS),mainScroll=make('div','ccr-table-scroll');
  mainScroll.tabIndex=0;mainScroll.setAttribute('role','region');mainScroll.setAttribute('aria-label','13 colunas do controle de empreiteiros');mainScroll.append(main.table);
  const pager=make('nav','ccr-pager');pager.setAttribute('aria-label','Páginas do relatório');
  const previous=button('ccr-previous','Página anterior','Anterior'),next=button('ccr-next','Próxima página','Próxima'),pageLabel=make('span','ccr-page-label');pager.append(previous,pageLabel,next);
  const detail=make('section','ccr-detail');detail.hidden=true;detail.setAttribute('aria-label','Detalhamento do contrato selecionado');
  content.append(brand,title,metrics,note,warnings,mainScroll,pager,detail);report.append(filters,notice,content);panel.append(orientation,report,back,dismiss);root.append(panel);doc.body.append(root);
  let snapshot=null,page=1,pickers=null,destroyed=false,overviewController=null,detailController=null,reloadPositions=null;
  let overviewRevision=0,detailRevision=0,stateRevision=0,detailState='idle',detailId='',detailSnapshot=null,detailPromise=null,printRestore=null;
  let returnFocus=null,oldOverflow='',app=null,oldInert=false;
  const portrait=()=>win?.matchMedia ? win.matchMedia('(orientation: portrait)').matches : win?.innerHeight>win?.innerWidth;
  const selected=()=>Object.fromEntries([...controls].map(([name,node])=>[name,node.value]));
  const result=()=>contractorReport(snapshot?.rows || [],selected());
  const eligibleId=()=>{const id=controls.get('id').value;return snapshot && id && result().rows.some(row=>String(row.id)===id) ? id : '';};
  function tableShell(className,label,columns,widths) {
    const table=make('table',`ccr-table ${className}`),cols=make('colgroup'),head=make('thead'),labels=make('tr'),body=make('tbody');table.setAttribute('aria-label',label);
    for (const [index,[,label]] of columns.entries()) {
      if (widths) {const col=make('col');col.style.width=`${widths[index]}%`;cols.append(col);}
      const th=make('th','',label);th.scope='col';labels.append(th);
    }
    head.append(labels);table.append(cols,head,body);return {table,body};
  }
  function appendCell(tr,name,value,tone='neutral') {
    const cell=make('td','',text(value));cell.dataset.column=name;cell.dataset.tone=cell.textContent==='PENDENTE'?'pending':tone;tr.append(cell);return cell;
  }
  function focusBeforeClear(node) {if (node.contains(doc.activeElement)) panel.focus({preventScroll:true});}
  function replaceBody(body) {focusBeforeClear(body);body.replaceChildren();}
  function updateBusy() {root.setAttribute('aria-busy',String(!root.hidden && (portrait() || Boolean(overviewController) || detailState==='loading')));detail.setAttribute('aria-busy',String(detailState==='loading'));}
  function showNotice(message='',retry=false) {
    notice.replaceChildren();notice.hidden=!message;notice.setAttribute('role',retry?'alert':'status');
    if (!message) return;
    notice.append(make('p','',message));
    if (retry) {const node=button('ccr-retry','Tentar novamente');node.addEventListener('click',()=>void loadOverview());notice.append(node);}
  }
  function scrollPositions() {return [content,mainScroll].map(node=>({node,top:node.scrollTop,left:node.scrollLeft}));}
  function restoreScroll(positions) {for (const {node,top,left} of positions) {node.scrollTop=top;node.scrollLeft=left;}}
  function invalidatePrint() {printRestore?.();stateRevision++;}
  function cancelOverview() {overviewController?.abort();overviewController=null;overviewRevision++;}
  function cancelDetails() {detailController?.abort();detailController=null;detailRevision++;detailPromise=null;}
  function clearDetails() {
    cancelDetails();detailState='idle';detailId='';detailSnapshot=null;focusBeforeClear(detail);detail.replaceChildren();detail.hidden=true;updateBusy();
  }
  function renderMain(all=false) {
    replaceBody(main.body);const view=snapshot?result():null;
    for (const [name,node] of metricValues) node.textContent=view ? name==='activeGlobalValue'?formatReportMoney(view.metrics[name]):String(view.metrics[name]) : '—';
    const pages=Math.max(1,Math.ceil((view?.rows.length || 0)/PAGE_SIZE));if (view) page=Math.min(page,pages);
    previous.disabled=all||!view||page<=1;next.disabled=all||!view||page>=pages;pager.hidden=all;
    pageLabel.textContent=view?`Página ${page} de ${pages} · ${view.rows.length} registro(s)`:'Dados não carregados';
    if (!view) return;
    for (const row of all?view.rows:view.rows.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE)) {
      const tr=make('tr');tr.dataset.rowId=String(row.id);
      for (const [name] of COLUMNS) {
        let value=row[name],tone='neutral';
        if (['contractDocumentId','estimateDocumentId'].includes(name)) {
          const statuses=snapshot.documentStatuses,status=Object.hasOwn(statuses,value)?statuses[value]:undefined;
          ({text:value,tone}=documentCell(value,status));
        } else if (['globalEstimatedValue','totalValue','totalMeasurements'].includes(name)) value=formatReportMoney(value);
        else if (['startDate','endDate'].includes(name)) value=formatReportDate(value);
        else if (name==='status') tone=statusTone(value);
        const td=appendCell(tr,name,value,tone);
        if (name==='id' && String(row.id??'').trim()) {
          const select=button('ccr-select-row',`Detalhar contrato ID ${row.id}`,String(row.id));select.dataset.action='select-contractor';
          select.addEventListener('click',()=>{controls.get('id').value=String(row.id);pickers?.sync();filtersChanged();});td.replaceChildren(select);
          // PDF capture omits buttons; retain the source ID as ordinary text.
          td.append(make('span','ccr-print-id',String(row.id)));
        }
      }
      main.body.append(tr);
    }
    if (!view.rows.length) {const tr=make('tr'),td=make('td','ccr-empty','Nenhum empreiteiro corresponde aos filtros selecionados.');td.colSpan=COLUMNS.length;tr.append(td);main.body.append(tr);}
  }
  function populateFilters() {
    pickers?.destroy();pickers=null;const values=selected();
    for (const [name,node] of controls) {
      const options=[...new Set([...snapshot.rows.map(row=>row[name]),values[name],...(name==='status'?['ATIVO']:[])]
        .filter(value=>String(value??'').trim()).map(String))].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:name==='id'}));
      node.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));
      for (const value of options) node.append(Object.assign(make('option','',value),{value}));node.value=values[name];
    }
    pickers=bindSearchableFilterSelects(filters,{report:true,placement:'below'});
  }
  function renderDetailTable(className,title,columns,rows,values,empty) {
    const section=make('section','ccr-detail-section');section.append(make('h2','ccr-detail-title',title));
    const table=tableShell(className,title,columns);
    for (const row of [...rows].sort((a,b)=>Number(b.id)-Number(a.id))) {
      const tr=make('tr');for (const [index,[value,tone]] of values(row).entries()) appendCell(tr,columns[index][0],value,tone);table.body.append(tr);
    }
    if (!rows.length) {const tr=make('tr'),td=make('td','ccr-empty',empty);td.colSpan=columns.length;tr.append(td);table.body.append(tr);}
    section.append(table.table);return section;
  }
  function renderDetails() {
    focusBeforeClear(detail);detail.replaceChildren();detail.hidden=false;
    detail.append(make('h2','ccr-selected-title',`CONTRATO ID ${detailId}`));
    if (detailState==='loading') {const node=make('p','ccr-detail-notice','Carregando lançamentos e medições…');node.setAttribute('role','status');detail.append(node);return;}
    if (detailState==='error') {
      const error=make('p','ccr-detail-error','Não foi possível carregar os lançamentos e medições completos. Tente novamente.');error.setAttribute('role','alert');
      const retry=button('ccr-detail-retry','Tentar novamente');retry.addEventListener('click',()=>{invalidatePrint();void loadDetails(eligibleId());});detail.append(error,retry);return;
    }
    if (!detailSnapshot) return;
    const linked=rows=>rows.filter(row=>String(row.contract??'').trim()===detailId);
    detail.append(renderDetailTable('ccr-launches',`LANÇAMENTOS VINCULADOS AO CONTRATO ID ${detailId}`,
      [['id','ID LANÇAMENTO'],['date','DATA'],['supplier','FORNECEDOR'],['contract','CONTRATO'],['total','VALOR TOTAL'],['paymentStatus','STATUS']],
      linked(detailSnapshot.launches),row=>[[row.id],[formatReportDate(row.date)],[row.supplier],[row.contract],[formatReportMoney(row.total)],[row.paymentStatus,row.paymentTone??statusTone(row.paymentStatus,true)]],
      'Nenhum lançamento vinculado ao contrato.'),renderDetailTable('ccr-measurements',`MEDIÇÕES VINCULADAS AO CONTRATO ID ${detailId}`,
      [['id','ID MEDIÇÃO'],['supplier','FORNECEDOR'],['contract','Nº CONTRATO'],['status','STATUS']],
      linked(detailSnapshot.measurements),row=>[[row.id],[row.supplier],[row.contract],[row.status,row.statusTone??statusTone(row.status)]],'Nenhuma medição vinculada ao contrato.'));
  }
  function loadDetails(id) {
    clearDetails();if (!id || root.hidden || portrait() || destroyed || id!==eligibleId()) return Promise.resolve();
    const active=new AbortController(),current=detailRevision;detailController=active;detailId=id;detailState='loading';renderDetails();updateBusy();
    const stale=()=>active.signal.aborted||current!==detailRevision||root.hidden||portrait()||destroyed||id!==eligibleId();
    const pending=(async()=>{
      try {
        const loaded=await abortable(Promise.resolve().then(()=>{if (active.signal.aborted) throw cancelled();return data.loadDetails(id,{signal:active.signal});}),active.signal);
        if (stale()) return;
        if (!Array.isArray(loaded?.launches) || !Array.isArray(loaded?.measurements)) throw new Error('Detalhamento incompleto.');
        detailSnapshot=loaded;detailState='ready';renderDetails();
      } catch {if (!stale()) {detailSnapshot=null;detailState='error';renderDetails();}}
      finally {if (!stale()) {detailController=null;updateBusy();}}
    })();detailPromise=pending;return pending;
  }
  async function loadOverview() {
    if (root.hidden || portrait() || destroyed) return;
    invalidatePrint();pickers?.close();const positions=reloadPositions??scrollPositions(),savedPage=page;reloadPositions=positions;
    cancelOverview();clearDetails();const active=new AbortController(),current=overviewRevision;overviewController=active;
    snapshot=null;warnings.replaceChildren();warnings.hidden=true;renderMain();showNotice('Carregando controle de empreiteiros…');updateBusy();
    const stale=()=>active.signal.aborted||current!==overviewRevision||root.hidden||portrait()||destroyed;
    try {
      const loaded=await abortable(Promise.resolve().then(()=>{if (active.signal.aborted) throw cancelled();return data.loadOverview({signal:active.signal});}),active.signal);
      if (stale()) return;
      if (!Array.isArray(loaded?.rows) || !loaded.documentStatuses || typeof loaded.documentStatuses!=='object' || !Array.isArray(loaded.warnings)) throw new Error('Relatório incompleto.');
      snapshot=loaded;page=savedPage;populateFilters();showNotice();
      for (const warning of loaded.warnings) warnings.append(make('p','',warning));warnings.hidden=!loaded.warnings.length;
      renderMain();restoreScroll(positions);reloadPositions=null;void loadDetails(eligibleId());
    } catch {if (!stale()) {snapshot=null;renderMain();showNotice('Não foi possível carregar o controle de empreiteiros completo. Use Atualizar para tentar novamente.',true);}}
    finally {if (!stale()) {overviewController=null;updateBusy();}}
  }
  function filtersChanged() {
    if (root.hidden || destroyed) return;
    invalidatePrint();page=1;reloadPositions=null;clearDetails();content.scrollTop=0;
    if (overviewController) {cancelOverview();if (!portrait()) void loadOverview();}
    else if (snapshot) {renderMain();void loadDetails(eligibleId());}
  }
  function orientationChanged() {
    if (root.hidden || destroyed) return;
    const vertical=portrait(),wasHidden=report.hidden;orientation.hidden=!vertical;panel.classList.toggle('pl-dialog--portrait',vertical);
    if (vertical) {
      invalidatePrint();pickers?.close();if (report.contains(doc.activeElement)) panel.focus({preventScroll:true});
      cancelOverview();if (detailState==='loading') clearDetails();report.hidden=true;updateBusy();
    } else if (wasHidden) {
      report.hidden=false;if (!snapshot) void loadOverview();else {if (eligibleId() && detailState==='idle') void loadDetails(eligibleId());updateBusy();}
    }
  }
  function close() {
    if (root.hidden) return;
    invalidatePrint();cancelOverview();clearDetails();pickers?.close();root.hidden=true;snapshot=null;page=1;reloadPositions=null;
    renderMain();showNotice();warnings.replaceChildren();warnings.hidden=true;updateBusy();
    doc.body.style.overflow=oldOverflow;if (app) app.inert=oldInert;
    const target=returnFocus?.isConnected?returnFocus:doc.querySelector('[data-action="open-contractor-control-report"]:not(:disabled)')||app;
    returnFocus=null;target?.focus?.({preventScroll:true});onClose();
  }
  function containFocus(event) {
    if (root.hidden || destroyed || root.contains(event.target)) return;
    if (event.target.closest?.('dialog[open],[role="dialog"][aria-modal="true"]')) return;
    panel.focus({preventScroll:true});
  }
  async function preparePrint() {
    printRestore?.();
    const current=stateRevision,id=eligibleId();
    const ready=()=>!root.hidden&&!portrait()&&!destroyed&&snapshot&&!overviewController&&current===stateRevision;
    if (!ready()) throw new Error('O relatório ainda não está pronto para impressão.');
    if (id && detailState==='loading') await detailPromise;
    if (!ready() || (id && (id!==eligibleId() || detailId!==id || detailState!=='ready'))) throw new Error('O detalhamento ainda não está pronto para impressão.');
    const savedPage=page,positions=scrollPositions(),focus=doc.activeElement;let restored=false;
    pickers?.close();renderMain(true);
    const restore=()=>{
      if (restored) return;restored=true;if (printRestore===restore) printRestore=null;
      if (current!==stateRevision || root.hidden || destroyed) return;
      page=savedPage;renderMain();restoreScroll(positions);
      if (focus?.isConnected && !focus.closest('[hidden]') && root.contains(focus)) focus.focus({preventScroll:true});
    };
    printRestore=restore;return restore;
  }
  for (const control of controls.values()) control.addEventListener('change',filtersChanged);
  previous.addEventListener('click',()=>{if (snapshot && page>1) {invalidatePrint();page--;renderMain();content.scrollTop=0;}});
  next.addEventListener('click',()=>{if (snapshot && page<Math.ceil(result().rows.length/PAGE_SIZE)) {invalidatePrint();page++;renderMain();content.scrollTop=0;}});
  refresh.addEventListener('click',()=>void loadOverview());dismiss.addEventListener('click',close);back.addEventListener('click',()=>{close();onHome();});
  root.addEventListener('click',event=>{if (event.target===root) close();});
  root.addEventListener('keydown',event=>{
    if (root.hidden || event.defaultPrevented) return;
    if (event.key==='Escape') {event.preventDefault();close();return;}
    if (event.key!=='Tab') return;
    const nodes=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(node=>!node.disabled&&!node.closest('[hidden]')&&node.tabIndex>=0),first=nodes[0],last=nodes.at(-1);
    if (event.shiftKey && (doc.activeElement===first || doc.activeElement===panel)) {event.preventDefault();last?.focus({preventScroll:true});}
    else if (!event.shiftKey && (doc.activeElement===last || doc.activeElement===panel)) {event.preventDefault();first?.focus({preventScroll:true});}
  });
  doc.addEventListener('focusin',containFocus);win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
  return Object.freeze({element:root,async open() {
    if (destroyed) throw new Error('O relatório foi encerrado.');if (!root.hidden) return;
    returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;
    doc.body.style.overflow='hidden';if (app) app.inert=true;
    pickers?.destroy();pickers=null;page=1;stateRevision++;
    for (const [name,node] of controls) {
      const value=name==='status'?'ATIVO':'';node.replaceChildren(Object.assign(make('option','',value||'Todos'),{value}));node.value=value;
    }
    root.hidden=false;const vertical=portrait();orientation.hidden=!vertical;report.hidden=vertical;panel.classList.toggle('pl-dialog--portrait',vertical);
    updateBusy();panel.focus({preventScroll:true});content.scrollTop=0;content.scrollLeft=0;mainScroll.scrollLeft=0;if (!vertical) await loadOverview();
  },close,preparePrint,destroy() {
    if (destroyed) return;close();destroyed=true;cancelOverview();clearDetails();pickers?.destroy();pickers=null;
    doc.removeEventListener('focusin',containFocus);win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);root.remove();
  }});
}
