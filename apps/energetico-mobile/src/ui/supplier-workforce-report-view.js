import {buildSupplierWorkforceReport, defaultSupplierWorkforceFilters} from '../chat/supplier-workforce-report-model.js';
import {bindSearchableFilterSelects} from './searchable-filter-selects.js';

const LOGO=new URL('../../../../assets/logo-energetica-oficial.png',import.meta.url).href;
const FILTERS=[['startDate','DATA INICIAL'],['endDate','DATA FINAL'],['branch','FILIAL'],['property','IMÓVEL'],
  ['supplier','FORNECEDOR'],['supplierStatus','STATUS DO FORNECEDOR'],['stage','ETAPA']];
const COLUMNS=['FORNECEDOR','PROFISSÃO','FORMA PGTO','VLR DIÁRIO','FREQUÊNCIA','DESCRITIVO / ATIVIDADE','MEDIÇÃO'];
const WIDTHS=[18,14,13,13,15,20,7];
const PALETTES={
  PEDREIRO:['#e0e7ff','#3730a3','#6366f1'], 'SERVENTE DE PEDREIRO':['#f5d0fe','#86198f','#d946ef'],
  SERVENTE:['#fef3c7','#92400e','#d97706'], PINTOR:['#ede9fe','#4c1d95','#6d28d9'],
  ELETRICISTA:['#cffafe','#155e75','#0891b2'], ENCANADOR:['#dbeafe','#1e3a8a','#2563eb'],
  GESSEIRO:['#e0f2fe','#075985','#0284c7'], MARCENEIRO:['#fed7aa','#7c2d12','#ea580c'],
  SERRALHEIRO:['#ddd6fe','#5b21b6','#7c3aed'],
};
const key=value=>String(value??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const money=value=>Number.isFinite(value)?value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'VALOR INCOMPLETO';
const localDate=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const dateLabel=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?`${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)}`:'SEM REGISTRO';
const cancelled=()=>new DOMException('Consulta cancelada.','AbortError');
function abortable(promise,signal) {
  if(signal.aborted)return Promise.reject(cancelled());
  let abort;
  const cancellation=new Promise((_,reject)=>{abort=()=>reject(cancelled());signal.addEventListener('abort',abort,{once:true});});
  return Promise.race([promise,cancellation]).finally(()=>signal.removeEventListener('abort',abort));
}

export function createSupplierWorkforceReportView({document:doc=globalThis.document,data,onClose=()=>{},now=()=>new Date()}={}) {
  if(!doc?.body||typeof data?.loadSnapshot!=='function'||typeof onClose!=='function'||typeof now!=='function') {
    throw new TypeError('O relatório requer documento e sessão SharePoint.');
  }
  const win=doc.defaultView;
  const make=(tag,className='',text)=>{const node=doc.createElement(tag);node.className=className;if(text!==undefined)node.textContent=String(text);return node;};
  const button=(className,label,text)=>{const node=make('button',className,text);node.type='button';node.setAttribute('aria-label',label);return node;};
  const root=make('div','pl-overlay swr-overlay');root.hidden=true;root.setAttribute('aria-busy','false');root.setAttribute('aria-label','Fornecedores e frequência');
  const panel=make('section','pl-dialog swr-dialog');panel.tabIndex=-1;
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Fornecedores e frequência');
  const orientation=make('p','pl-orientation swr-orientation','PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');orientation.setAttribute('role','status');
  const report=make('div','pl-report swr-report'),filters=make('div','pl-filters swr-filters'),controls=new Map();
  const refresh=button('pl-refresh','Atualizar fornecedores e frequência','⟳');filters.append(refresh);
  for(const [name,label] of FILTERS) {
    const holder=make('label','pl-filter swr-filter'),control=make(name.endsWith('Date')?'input':'select','swr-filter-input');
    control.name=name;control.setAttribute('aria-label',label);if(control.tagName==='INPUT')control.type='date';
    holder.append(make('span','pl-filter-label',label),control);filters.append(holder);controls.set(name,control);
  }
  const notice=make('p','pl-notice swr-notice');notice.hidden=true;notice.setAttribute('role','status');
  const content=make('div','pl-table-scroll swr-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Fornecedores por filial imóvel e profissão');
  const dismiss=button('swr-close','Fechar relatório','×');
  report.append(filters,notice,content);panel.append(orientation,report,dismiss);root.append(panel);doc.body.append(root);
  let snapshot=null,controller=null,revision=0,destroyed=false,pickers=null;
  let returnFocus=null,oldOverflow='',app=null,oldInert=false;
  const portrait=()=>win?.matchMedia?win.matchMedia('(orientation: portrait)').matches:win?.innerHeight>win?.innerWidth;
  const selected=()=>Object.fromEntries([...controls].map(([name,node])=>[name,node.value]));
  function clearContent(){if(content.contains(doc.activeElement))panel.focus({preventScroll:true});content.replaceChildren();}
  function showNotice(text='',alert=false){notice.textContent=text;notice.hidden=!text;notice.setAttribute('role',alert?'alert':'status');}
  // Refresh remains available while busy so a new request can replace a stalled generation.
  function setBusy(busy){root.setAttribute('aria-busy',String(busy));}
  function cancel(){controller?.abort();controller=null;revision++;}
  function palette(node,profession){const [fill,text,border]=PALETTES[key(profession)]||['#fefce8','#854d0e','#ca8a04'];
    node.style.setProperty('--swr-prof-fill',fill);node.style.setProperty('--swr-prof-text',text);node.style.setProperty('--swr-prof-border',border);}
  function summary(values,profession) {
    const holder=make('div','swr-summary');
    for(const [className,text] of [
      ['swr-count',`👷 ${values.count} ${profession||'FORNECEDORES'}`],
      ['swr-daily',`🔴 ${values.dailyCount} DIÁRIA`],['swr-measured',`🟢 ${values.measurementCount} MEDIÇÃO`],
      ['swr-global',`🔵 ${values.globalCount} VALOR GLOBAL`],['swr-daily-total',`💰 ${money(values.dailyTotal)} / DIA`],
    ])holder.append(make('span',`swr-badge ${className}`,text));
    return holder;
  }
  function frequency(row) {
    const cell=make('td','swr-frequency'),box=make('div','swr-frequency-box'),first=make('div','swr-first-date');
    const inactive=key(row.status)==='INATIVO',days=Number.isFinite(row.activeDays)?` (${row.activeDays} dias)`:'';
    const date=row.firstDate?inactive?`${dateLabel(row.firstDate)} → ${row.lastPresentDate?dateLabel(row.lastPresentDate):'SEM PRESENÇA'}${days}`:`${dateLabel(row.firstDate)}${days}`:'SEM REGISTRO';
    first.append(make('span','swr-detail-label',inactive?'📍 Período ativo':'📍 Primeira data'),make('strong','',date));box.append(first);
    for(const [className,label,value] of [['swr-frequency-30','📅 30 dias',row.frequency30],['swr-frequency-history','📊 Histórico completo',row.frequencyHistory]]) {
      const section=make('div','swr-frequency-section');section.append(make('span','swr-detail-label',label));
      const valid=value&&[value.present,value.total,value.percent].every(Number.isFinite);
      section.append(make('strong',className,valid?`${value.present} / ${value.total} — ${value.percent.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})}%`:'FREQUÊNCIA INCOMPLETA'));box.append(section);
    }
    cell.append(box);return cell;
  }
  function supplierRow(row) {
    const tr=make('tr'),supplier=make('td','swr-supplier'),status=make('span',`swr-badge ${key(row.status)==='ATIVO'?'swr-active':'swr-inactive'}`,row.status||'STATUS NÃO INFORMADO');
    supplier.append(make('strong','swr-supplier-name',row.name),status);
    const profession=make('td');profession.append(make('span','swr-badge swr-profession-badge',row.profession||'SEM PROFISSÃO'));
    const method=key(row.paymentMethod),payment=make('td','swr-payment-method');
    payment.append(make('span',`swr-badge ${method==='DIARIA'?'swr-daily':method==='MEDICAO'?'swr-measured':method==='VALOR GLOBAL'?'swr-global':'swr-unspecified'}`,row.paymentMethod||'⚠️ PREENCHER'));
    const daily=make('td','swr-daily-value'),blank=row.dailyValueBlank===true;
    const byMeasurement=blank&&(method==='MEDICAO'||method==='VALOR GLOBAL');
    daily.append(make('span',`swr-badge ${byMeasurement?'swr-unspecified':!Number.isFinite(row.dailyValue)?'swr-missing':'swr-active'}`,
      byMeasurement?'CONFORME MEDIÇÃO':blank?'⚠️ PREENCHER':money(row.dailyValue)));
    const description=make('td','swr-description'),box=make('div','swr-description-box');
    for(const [label,value] of [['📌 ETAPA ATUAL',row.stage],['🛠️ ATIVIDADE EXECUTADA',row.activity]]) {
      const section=make('div','swr-description-section');section.append(make('span','swr-detail-label',label),make('strong',String(value??'').trim()?'':'swr-missing-text',String(value??'').trim()?value:'⚠️ PREENCHER'));box.append(section);
    }
    description.append(box);
    const measurement=make('td',`swr-measurement ${method==='DIARIA'?'swr-measurement-ok':String(row.measurement??'').trim()?'swr-measurement-text':'swr-measurement-missing'}`,
      method==='DIARIA'?'✅':String(row.measurement??'').trim()?row.measurement:'⚠️');
    if(method==='DIARIA')measurement.setAttribute('aria-label','Diária — medição dispensada');
    else if(!String(row.measurement??'').trim())measurement.setAttribute('aria-label','Medição não informada');
    tr.append(supplier,profession,payment,daily,frequency(row),description,measurement);return tr;
  }
  function professionSection(group) {
    const section=make('section','swr-profession');palette(section,group.profession);
    const heading=make('h4','swr-profession-heading');heading.append(make('span','swr-profession-title',`🧰 ${group.profession||'SEM PROFISSÃO'} — ${group.summary.count} fornecedor(es)`));
    const table=make('table','swr-table');table.setAttribute('aria-label',`Fornecedores — ${group.profession||'SEM PROFISSÃO'}`);
    const cols=make('colgroup'),head=make('thead'),labels=make('tr'),body=make('tbody');
    for(const [index,label] of COLUMNS.entries()){const col=make('col');col.style.width=`${WIDTHS[index]}%`;cols.append(col);const th=make('th','',label);th.scope='col';labels.append(th);}
    head.append(labels);for(const row of group.suppliers)body.append(supplierRow(row));table.append(cols,head,body);
    section.append(heading,summary(group.summary,group.profession||'SEM PROFISSÃO'),table);return section;
  }
  function render() {
    clearContent();showNotice();if(!snapshot)return;
    const values=selected(),start=controls.get('startDate'),end=controls.get('endDate');start.setCustomValidity('');end.setCustomValidity('');
    if(values.startDate&&values.endDate&&values.startDate>values.endDate){start.setCustomValidity('A data inicial não pode ser posterior à data final.');showNotice('A data inicial não pode ser posterior à data final.',true);return;}
    if(!start.checkValidity()||!end.checkValidity()){showNotice('Data inválida. Confira o período do relatório.',true);return;}
    let result;try{result=buildSupplierWorkforceReport(snapshot,values,localDate(now()));}
    catch{showNotice('Não foi possível calcular o relatório completo. Use Atualizar para tentar novamente.',true);return;}
    const brand=make('div','swr-brand'),logo=make('img');logo.src=LOGO;logo.alt='Logo Energética Construtora';brand.append(logo);
    const warnings=make('div','swr-warnings');warnings.setAttribute('role','status');for(const warning of result.warnings||[])warnings.append(make('p','',warning));warnings.hidden=!warnings.childElementCount;
    const fragment=doc.createDocumentFragment();fragment.append(brand,warnings);
    for(const group of result.branches) {
      const branch=make('section','swr-branch');branch.append(make('h2','swr-branch-heading',`🏢 FILIAL: ${group.branch||'NÃO INFORMADA'}`));
      for(const propertyGroup of group.properties) {
        const property=make('section','swr-property');property.append(make('h3','swr-property-heading',`🏠 IMÓVEL: ${propertyGroup.property||'NÃO INFORMADO'}`),summary(propertyGroup.summary));
        for(const profession of propertyGroup.professions)property.append(professionSection(profession));branch.append(property);
      }
      fragment.append(branch);
    }
    if(!result.branches.length)fragment.append(make('p','swr-empty','Nenhum fornecedor corresponde ao período e aos filtros selecionados.'));
    content.append(fragment);
  }
  function populate() {
    pickers?.destroy();pickers=null;const values=selected();
    const suppliers=snapshot.suppliers.filter(row=>row.contractor===true||key(row.contractor)==='SIM');
    for(const [name,node] of controls) {
      if(node.tagName!=='SELECT')continue;
      const source=name==='stage'?[...suppliers.map(row=>row.stage),...snapshot.presences.map(row=>row.stage)]
        :name==='property'?[...suppliers.map(row=>row.property),...snapshot.presences.map(row=>row.property)]
        :suppliers.map(row=>name==='supplier'?row.name:name==='supplierStatus'?row.status:row[name]);
      const options=[...new Set([...source,values[name],...(name==='supplierStatus'?['ATIVO']:[])].filter(value=>String(value??'').trim()).map(String))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
      node.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));
      for(const value of options)node.append(Object.assign(make('option','',value),{value}));node.value=values[name];
    }
    pickers=bindSearchableFilterSelects(filters,{report:true,placement:'below'});
  }
  async function load() {
    if(root.hidden||portrait()||destroyed)return;
    pickers?.close();cancel();const current=revision,active=new AbortController();controller=active;
    snapshot=null;clearContent();showNotice('Carregando fornecedores e presenças do SharePoint…');setBusy(true);
    const stale=()=>active.signal.aborted||current!==revision||root.hidden||destroyed;
    try {
      const loaded=await abortable(Promise.resolve().then(()=>{if(active.signal.aborted)throw cancelled();return data.loadSnapshot({signal:active.signal});}),active.signal);
      if(stale())return;
      if(loaded?.complete!==true||!Array.isArray(loaded.suppliers)||!Array.isArray(loaded.presences))throw new Error('Snapshot incompleto.');
      buildSupplierWorkforceReport(loaded,{},localDate(now()));snapshot=loaded;populate();render();
    }catch{if(stale())return;snapshot=null;clearContent();showNotice('Não foi possível carregar o relatório completo. Use Atualizar para tentar novamente.',true);}
    finally{if(!stale()){controller=null;setBusy(false);}}
  }
  function orientationChanged() {
    if(root.hidden||destroyed)return;const vertical=portrait(),wasHidden=report.hidden;
    orientation.hidden=!vertical;panel.classList.toggle('pl-dialog--portrait',vertical);
    if(vertical){pickers?.close();if(report.contains(doc.activeElement))panel.focus({preventScroll:true});cancel();report.hidden=true;setBusy(true);if(!snapshot){clearContent();showNotice();}}
    else if(wasHidden){report.hidden=false;if(snapshot)setBusy(false);else void load();}
  }
  function close() {
    if(root.hidden)return;cancel();pickers?.close();snapshot=null;root.hidden=true;setBusy(false);clearContent();showNotice();
    doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;
    const target=returnFocus?.isConnected?returnFocus:doc.querySelector('[data-action="open-supplier-workforce-report"]:not(:disabled)')||app;
    returnFocus=null;target?.focus?.({preventScroll:true});onClose();
  }
  function containFocus(event) {
    if(root.hidden||destroyed||root.contains(event.target))return;
    // A PDF preview owns its own modal focus while the report remains mounted below it.
    if(event.target.closest?.('dialog[open],[role="dialog"][aria-modal="true"]'))return;
    panel.focus({preventScroll:true});
  }
  refresh.addEventListener('click',()=>void load());dismiss.addEventListener('click',close);
  root.addEventListener('click',event=>{if(event.target===root)close();});
  root.addEventListener('keydown',event=>{
    if(root.hidden||event.defaultPrevented)return;
    if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key!=='Tab')return;
    const nodes=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(node=>!node.disabled&&!node.closest('[hidden]')&&node.tabIndex>=0),first=nodes[0],last=nodes.at(-1);
    if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){event.preventDefault();first?.focus();}
  });
  for(const control of controls.values()) {
    const update=()=>{if(!root.hidden&&snapshot){render();content.scrollTop=0;}};control.addEventListener('change',update);if(control.tagName==='INPUT')control.addEventListener('input',update);
  }
  doc.addEventListener('focusin',containFocus);win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
  return Object.freeze({element:root,async open() {
    if(destroyed)throw new Error('O relatório foi encerrado.');if(!root.hidden)return;
    returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;
    doc.body.style.overflow='hidden';if(app)app.inert=true;pickers?.destroy();pickers=null;
    const defaults=defaultSupplierWorkforceFilters(localDate(now()));
    for(const [name,node] of controls){const value=defaults[name]??'';if(node.tagName==='INPUT')node.setCustomValidity('');else node.replaceChildren(Object.assign(make('option','',value||'Todos'),{value}));node.value=value;}
    root.hidden=false;const vertical=portrait();orientation.hidden=!vertical;report.hidden=vertical;panel.classList.toggle('pl-dialog--portrait',vertical);
    setBusy(vertical);panel.focus({preventScroll:true});content.scrollTop=0;if(!vertical)await load();
  },close,destroy(){
    if(destroyed)return;close();destroyed=true;cancel();pickers?.destroy();pickers=null;
    doc.removeEventListener('focusin',containFocus);win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);root.remove();
  }});
}
