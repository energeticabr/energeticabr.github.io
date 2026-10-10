import {buildSupplierPayrollOverview,currentPayrollMonth,summarizePayrollPayments,summarizePayrollPaymentsByType,payrollReferencePeriod,payrollTypeAppearance,buildPayrollReportCsv} from '../chat/supplier-payroll-report-model.js';
import {formatOperationsDate} from '../chat/operations-reports-model.js';
import {bindSearchableFilterSelects} from './searchable-filter-selects.js';
import {createGalleryRecordActions} from './gallery-record-actions.js';

const LOGO=new URL('../../../../assets/logo-energetica-oficial.png',import.meta.url).href;
const monthLabel=value=>value?`${value.slice(5)}/${value.slice(0,4)}`:'Todos';
const money=cents=>cents===null||cents===undefined?'Não calculado':(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const cancelled=()=>new DOMException('Consulta cancelada.','AbortError');
const ICONS={sheet:'M6 2h8l4 4v16H6z M14 2v5h4 M9 11h6 M9 15h6 M9 19h4',coins:'M17 5c0 2-3 3-6 3s-6-1-6-3 3-3 6-3 6 1 6 3z M5 5v5c0 2 3 3 6 3s6-1 6-3V5 M5 10v5c0 2 3 3 6 3s6-1 6-3v-5 M5 15v4c0 2 3 3 6 3s6-1 6-3v-4',payment:'M3 5h18v14H3z M3 9h18 M6 14h5'};
function abortable(promise,signal){
 if(signal.aborted)return Promise.reject(cancelled());
 let abort;const cancel=new Promise((_,reject)=>{abort=()=>reject(cancelled());signal.addEventListener('abort',abort,{once:true});});
 return Promise.race([promise,cancel]).finally(()=>signal.removeEventListener('abort',abort));
}

export function createSupplierPayrollReportView({document:doc=globalThis.document,data,now=()=>new Date(),onClose=()=>{},
 loadEditor,saveEditor,loadLaunchEditor,saveLaunchEditor,exportMedia}={}){
 if(!doc?.body||typeof data?.loadSnapshot!=='function'||typeof data?.loadPaymentsForPayrollIds!=='function')throw new TypeError('O relatório de folhas requer documento e sessão SharePoint.');
 const win=doc.defaultView,make=(tag,cls='',text)=>{const n=doc.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const root=make('div','pl-overlay spr-overlay');root.hidden=true;
 const panel=make('section','pl-dialog spr-dialog');panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Folhas de pagamento por fornecedor');
 const warning=make('p','pl-orientation','PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');warning.setAttribute('role','status');
 const report=make('div','pl-report spr-report'),filters=make('div','pl-filters spr-filters'),controls=new Map();
 const toolbarLogo=make('img','spr-toolbar-logo');toolbarLogo.src=LOGO;toolbarLogo.alt='Logo Energética';filters.append(toolbarLogo);
 const refresh=make('button','pl-refresh','⟳');refresh.type='button';refresh.setAttribute('aria-label','Atualizar folhas de pagamento');filters.append(refresh);
 for(const [name,label] of [['month','MÊS DE REFERÊNCIA'],['supplier','FORNECEDOR'],['profession','PROFISSÃO']]){const holder=make('label','pl-filter'),select=make('select');select.name=name;select.setAttribute('aria-label',label);holder.append(make('span','pl-filter-label',label),select);filters.append(holder);controls.set(name,select);}
 const closeButton=make('button','spr-close','Fechar');closeButton.type='button';closeButton.setAttribute('aria-label','Fechar relatório de folhas');filters.append(closeButton);
 const management=make('div','spr-management'),search=make('input','spr-search');search.type='search';search.placeholder='Buscar funcionário…';search.setAttribute('aria-label','Buscar funcionário no relatório');
 const exportAll=make('button','spr-export-all','⇩ Exportar dados');exportAll.type='button';exportAll.disabled=typeof exportMedia!=='function';management.append(search,exportAll);
 const notice=make('p','pl-notice');notice.hidden=true;notice.setAttribute('role','status');
 const content=make('div','pl-table-scroll spr-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Folhas e pagamentos dos fornecedores');
 report.append(filters,management,notice,content);panel.append(warning,report);root.append(panel);doc.body.append(root);
 let snapshot=null,controller=null,revision=0,pickers=null,destroyed=false,returnFocus=null,oldOverflow='',app=null,oldInert=false,entries=[],printing=false,exporting=false,pendingReload=null;
 const changed=()=>load({preserve:true});
 const paymentActions=createGalleryRecordActions({document:doc,host:root,loadEditor,saveEditor,onChanged:changed,actions:['edit']});
 const launchActions=createGalleryRecordActions({document:doc,host:root,loadEditor:loadLaunchEditor,saveEditor:saveLaunchEditor,onChanged:changed,actions:['edit']});
 const rowCache=new Map();
 function icon(name){const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg'),path=doc.createElementNS('http://www.w3.org/2000/svg','path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');path.setAttribute('d',ICONS[name]);svg.append(path);return svg;}
 const portrait=()=>win?.matchMedia?win.matchMedia('(orientation: portrait)').matches:win?.innerHeight>win?.innerWidth;
 const showNotice=text=>{notice.textContent=text;notice.hidden=!text;};
 const selected=()=>Object.fromEntries([...controls].map(([name,node])=>[name,node.value]));
 const invalidateDetails=()=>{for(const entry of entries)entry.controller?.abort();entries=[];};
 const alive=(entry,signal)=>!destroyed&&!root.hidden&&!signal.aborted&&entries.includes(entry);
 function paint(node,type){const appearance=payrollTypeAppearance(type);node.style.setProperty('--spr-type-color',appearance.color);node.style.setProperty('--spr-type-bg',appearance.background);return appearance;}
 function typeClusters(rows){
  const clusters=make('div','spr-type-totals');clusters.setAttribute('aria-label','Somatórios por tipo de pagamento');
  for(const total of summarizePayrollPaymentsByType(rows)){
   const cluster=make('div','spr-type-total');cluster.dataset.type=total.type;const appearance=paint(cluster,total.type);
   cluster.append(make('span','spr-type-icon',appearance.icon),make('strong','spr-type-amount',money(total.totalCents)),make('span','spr-type-label',`TOTAL ${total.type}`));clusters.append(cluster);
  }
  const general=make('div','spr-general-total');general.append(make('strong','',money(summarizePayrollPayments(rows).totalCents)),make('span','',`TOTAL GERAL · ${rows.length} PAGAMENTO(S)`));clusters.append(general);return clusters;
 }
 async function exportGroups(groups){
  if(exporting||printing||!snapshot||root.hidden||destroyed||typeof exportMedia!=='function')return;
  exporting=true;exportAll.disabled=true;showNotice('Preparando exportação completa…');const current=revision;
  try{
   for(const entry of groups)await loadGroup(entry);
   if(root.hidden||destroyed||current!==revision||groups.some(entry=>!entries.includes(entry)))throw cancelled();
   const csv=buildPayrollReportCsv(groups.map(entry=>({...entry.group,rows:entry.rows})));
   await exportMedia(new Blob([csv],{type:'text/csv;charset=utf-8'}),`folhas-pagamentos-${controls.get('month').value||'todas-referencias'}${groups.length===1?'-folhas-'+groups[0].group.ids.join('-').slice(0,60):''}.csv`);
   if(current===revision&&!root.hidden)showNotice('Dados exportados.');
  }catch(error){if(current===revision&&!root.hidden&&error?.name!=='AbortError')showNotice('Não foi possível exportar todos os dados. Atualize e tente novamente.');}
  finally{exporting=false;exportAll.disabled=typeof exportMedia!=='function';}
 }
 function paymentTable(entry,rows){
  const toolbar=make('div','spr-payment-toolbar');toolbar.append(make('h3','','▤ LANÇAMENTOS DE PAGAMENTO'));
  const exportSupplier=make('button','spr-export-supplier','⇩ Exportar');exportSupplier.type='button';exportSupplier.disabled=typeof exportMedia!=='function';exportSupplier.addEventListener('click',()=>void exportGroups([entry]));toolbar.append(exportSupplier);
  const table=make('table','spr-payments'),head=make('thead'),titles=make('tr'),body=make('tbody');
  for(const label of ['ID PAGAMENTO','IDFOLHA','TIPO','DATA DO PAGAMENTO','ID LANÇAMENTO','DESCRIÇÃO','VALOR UNITÁRIO','QTD.','VALOR TOTAL','CONTA/FORMAPGTO','OBSERVAÇÕES','AÇÕES']){const th=make('th','',label);th.scope='col';titles.append(th);}head.append(titles);table.append(head,body);
  for(const row of rows){const tr=make('tr');paint(tr,row.type);
   for(const value of [row.id,row.payrollId,row.type||'—',formatOperationsDate(row.date),row.launchId||'—',row.description||'—',row.unitValue===null||row.unitValue===undefined?'Não calculado':Number(row.unitValue).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),row.quantity===null||row.quantity===undefined?'—':Number(row.quantity).toLocaleString('pt-BR'),money(row.totalCents),row.paymentMethod||'—',row.observations||'—'])tr.append(make('td','',String(value)));
   const actions=make('td','spr-row-actions');
   for(const [kind,service,id,available,label] of [['payment',paymentActions,row.id,typeof loadEditor==='function'&&typeof saveEditor==='function','Editar pagamento'],['launch',launchActions,row.launchId,typeof loadLaunchEditor==='function'&&typeof saveLaunchEditor==='function','Editar lançamento']]){
    if(!id||!available)continue;const wrapper=service.render({id,fields:{}}),button=wrapper.querySelector('button');button.dataset.sprEdit=kind;button.setAttribute('aria-label',`${label} ID ${id}`);button.title=`${label} ID ${id}`;button.textContent=kind==='payment'?'✎':'▤';actions.append(wrapper);
   }
   tr.append(actions);body.append(tr);
  }
  const {totalCents,uncalculated}=summarizePayrollPayments(rows);
  entry.detail.replaceChildren(toolbar,table,typeClusters(rows),make('p','spr-total',totalCents===null?`Total indisponível — ${uncalculated} pagamento(s) sem valor calculado.`:`${rows.length} pagamento(s) · Total: ${money(totalCents)}`));
  if(!rows.length)entry.detail.prepend(make('p','spr-empty','Nenhum pagamento vinculado a estas folhas.'));
 }
 function displayPayments(entry,rows){
  const totals=summarizePayrollPayments(rows);entry.rows=rows;entry.loaded=true;
  entry.totalValue.textContent=money(totals.totalCents);entry.countValue.textContent=String(rows.length);entry.metrics.removeAttribute('aria-busy');
  const rubrics=summarizePayrollPaymentsByType(rows);
  entry.rubrics.replaceChildren();
  for(const rubric of rubrics){const item=make('span','spr-rubric-row');paint(item,rubric.type);item.setAttribute('role','listitem');item.append(make('span','spr-rubric-label',`${rubric.type}: `),make('strong','spr-rubric-value',money(rubric.totalCents)));entry.rubrics.append(item);}
  if(!rubrics.length)entry.rubrics.textContent='Sem pagamentos';
  if(entry.card.open||printing)paymentTable(entry,rows);
 }
 async function loadGroup(entry){
  if(entry.loaded){if(entry.card.open||printing)paymentTable(entry,entry.rows);return;}if(entry.promise)return entry.promise;
  const key=entry.group.ids.join(',');
  if(rowCache.has(key)){displayPayments(entry,rowCache.get(key));return;}
  const active=new AbortController();entry.controller=active;entry.detail.setAttribute('aria-busy','true');entry.detail.replaceChildren(make('p','','Carregando pagamentos vinculados às folhas…'));
  entry.metrics.setAttribute('aria-busy','true');entry.totalValue.textContent='Carregando…';entry.countValue.textContent='—';entry.rubrics.textContent='Carregando…';
  const task=(async()=>{
   try{const rows=await abortable(Promise.resolve().then(()=>data.loadPaymentsForPayrollIds(entry.group.ids,{signal:active.signal})),active.signal);
    if(!alive(entry,active.signal))throw cancelled();rowCache.set(key,rows);displayPayments(entry,rows);
   }catch(error){if(!alive(entry,active.signal))throw cancelled();
    entry.totalValue.textContent='Não disponível';entry.countValue.textContent='—';entry.rubrics.textContent='Não disponível';entry.metrics.removeAttribute('aria-busy');
    const message=make('p','','Não foi possível carregar os pagamentos. Tente novamente.');message.setAttribute('role','alert');
    const retry=make('button','spr-retry','Tentar novamente');retry.type='button';retry.addEventListener('click',()=>void loadGroup(entry).catch(()=>{}));entry.detail.replaceChildren(message,retry);throw error;
   }finally{entry.detail.setAttribute('aria-busy','false');if(entry.controller===active)entry.controller=null;entry.promise=null;}
  })();entry.promise=task;return task;
 }
 function loadSummaries(){
  const current=entries;let index=0;
  for(let worker=0;worker<Math.min(4,current.length);worker++)void(async()=>{
   while(index<current.length){const entry=current[index++];if(!entries.includes(entry)||root.hidden||destroyed)return;try{await loadGroup(entry);}catch{} }
  })();
 }
 function render(){
  invalidateDetails();content.replaceChildren();showNotice('');if(!snapshot)return;
  const result=buildSupplierPayrollOverview(snapshot,selected());
  const term=search.value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  for(const group of result.groups.filter(g=>`${g.supplier} ${g.profession} ${g.ids.join(' ')}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').includes(term))){
   const card=make('details','spr-supplier'),summary=make('summary'),detail=make('div','spr-detail');detail.hidden=true;
   const identity=make('span','spr-identity'),profile=make('span','spr-profile'),sheet=make('span','spr-sheet-block');
   const words=group.supplier.trim().split(/\s+/),initials=words[0].slice(0,1)+(words.length>1?words.at(-1).slice(0,1):'');
   identity.append(make('span','spr-avatar',initials.toLocaleUpperCase('pt-BR')),profile);profile.append(make('strong','spr-name',group.supplier),make('span','spr-profession',group.profession||'Profissão não informada'));
   const sheetIcon=make('span','spr-sheet-icon'),sheetText=make('span','spr-sheet-text');sheetIcon.append(icon('sheet'));sheetText.append(make('strong','spr-ids',`IDFOLHA: ${group.ids.join(', ')}`),make('span','spr-count',`${group.ids.length} folha(s)`));sheet.append(sheetIcon,sheetText);
   const metrics=make('span','spr-metrics'),totalValue=make('strong','spr-metric-value','Carregando…'),countValue=make('strong','spr-metric-value','—');
   for(const [cls,image,value,label]of [['spr-total-paid','coins',totalValue,'TOTAL PAGO'],['spr-payment-count','payment',countValue,'QTD. DE PGTOS']]){const metric=make('span','spr-metric '+cls),text=make('span','spr-metric-text');text.append(value,make('span','spr-metric-label',label));metric.append(icon(image),text);metrics.append(metric);}
   const rubrics=make('span','spr-rubrics','Carregando…');rubrics.setAttribute('role','list');rubrics.setAttribute('aria-label','Total pago por rubrica');metrics.insertBefore(rubrics,metrics.lastElementChild);
   const period=make('span','spr-period');period.append(make('span','spr-period-label','▦ PERÍODO'));
   const months=[...new Set(group.sheets.map(s=>s.month))];
   for(const month of months){const p=payrollReferencePeriod(month);period.append(make('span','',`${p.start} a ${p.end}`));}
   summary.append(identity,sheet,metrics,period);
   const entry={card,detail,group,metrics,totalValue,countValue,rubrics,loaded:false,open:false,promise:null,controller:null,rows:null};entries.push(entry);card.append(summary,detail);content.append(card);
   card.addEventListener('toggle',()=>{
    if(printing||!entries.includes(entry)||entry.open===card.open)return;entry.open=card.open;detail.hidden=!card.open;
    if(!card.open)return;
    const pending=entry.controller?.signal.aborted?entry.promise:Promise.resolve();
    void Promise.resolve(pending).catch(()=>{}).then(()=>{if(card.open&&entries.includes(entry))return loadGroup(entry);}).catch(()=>{});
   });
  }
  if(!result.groups.length)showNotice('Nenhuma folha corresponde aos filtros selecionados.');
  loadSummaries();
 }
 function populate(){
  pickers?.destroy();const overview=buildSupplierPayrollOverview(snapshot),values=selected();
  for(const [name,node] of controls){const options=name==='month'?[...new Set([currentPayrollMonth(now()),...overview.months,values.month].filter(Boolean))].sort().reverse():name==='supplier'?overview.suppliers:overview.professions||[];
   node.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));for(const value of options)node.append(Object.assign(make('option','',name==='month'?monthLabel(value):value),{value}));node.value=values[name];}
  pickers=bindSearchableFilterSelects(filters,{placement:'below',report:true});
 }
 async function load({preserve=false}={}){
  if(root.hidden||destroyed)return;
  const state=pendingReload||{openKeys:preserve?new Set(entries.filter(e=>e.card.open).map(e=>e.group.key)):new Set(),scroll:preserve?content.scrollTop:0};
  if(portrait()) {pendingReload=state;controller?.abort();invalidateDetails();rowCache.clear();snapshot=null;content.replaceChildren();revision++;return;}
  pendingReload=null;const {openKeys,scroll}=state;
  pickers?.close();controller?.abort();invalidateDetails();rowCache.clear();const current=++revision,active=new AbortController();controller=active;snapshot=null;content.replaceChildren();showNotice('Carregando folhas de pagamento do SharePoint…');report.setAttribute('aria-busy','true');refresh.disabled=true;
  try{const result=await abortable(Promise.resolve().then(()=>data.loadSnapshot({signal:active.signal})),active.signal);if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;buildSupplierPayrollOverview(result);snapshot=result;populate();render();for(const entry of entries){if(openKeys.has(entry.group.key)){entry.card.open=true;entry.open=true;entry.detail.hidden=false;void loadGroup(entry).catch(()=>{});}}content.scrollTop=scroll;}
  catch(error){if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;showNotice('Não foi possível carregar as folhas de pagamento. Use Atualizar para tentar novamente.');}
  finally{if(current===revision){report.setAttribute('aria-busy','false');refresh.disabled=false;}}
 }
 function close(){if(root.hidden)return;paymentActions.close();launchActions.close();controller?.abort();revision++;invalidateDetails();rowCache.clear();snapshot=null;pendingReload=null;printing=false;pickers?.close();content.replaceChildren();root.hidden=true;doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;returnFocus?.focus?.();returnFocus=null;onClose();}
 function orientationChanged(){
  if(root.hidden)return;const vertical=portrait();warning.hidden=!vertical;panel.classList.toggle('pl-dialog--portrait',vertical);
  if(vertical){
   pickers?.close();report.hidden=true;
   // A PDF preview can rotate the device. Keep the loaded reference, supplier
   // disclosures and their tables; hiding the report is not a new data session.
   if(!snapshot){controller?.abort();revision++;report.setAttribute('aria-busy','false');refresh.disabled=false;}
   if(printing){revision++;for(const entry of entries)entry.controller?.abort();}
   if(root.contains(doc.activeElement))panel.focus();
  }else if(report.hidden){report.hidden=false;if(!snapshot)void load();}
 }
 closeButton.addEventListener('click',close);refresh.addEventListener('click',()=>void load());root.addEventListener('click',e=>{if(e.target===root)close();});
 search.addEventListener('input',()=>{if(!printing){render();content.scrollTop=0;}});exportAll.addEventListener('click',()=>void exportGroups([...entries]));
 root.addEventListener('keydown',e=>{if(root.hidden)return;if(e.key==='Escape'){e.preventDefault();close();return;}if(e.key!=='Tab')return;const nodes=[...panel.querySelectorAll('button,input,select,summary,[tabindex="0"]')].filter(n=>!n.disabled&&!n.closest('[hidden]')&&n.tabIndex>=0),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){e.preventDefault();first?.focus();}});
 for(const node of controls.values())node.addEventListener('change',()=>{if(printing)return;render();content.scrollTop=0;});win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
 return Object.freeze({element:root,async open(){
  if(destroyed)throw new Error('O relatório de folhas foi encerrado.');if(!root.hidden)return;
  returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;doc.body.style.overflow='hidden';if(app)app.inert=true;
  search.value='';pickers?.destroy();pickers=null;for(const [name,node] of controls){const value=name==='month'?currentPayrollMonth(now()):'';node.replaceChildren(Object.assign(make('option','',name==='month'?monthLabel(value):'Todos'),{value}));node.value=value;node.disabled=false;}
  root.hidden=false;const vertical=portrait();warning.hidden=!vertical;report.hidden=vertical;panel.classList.toggle('pl-dialog--portrait',vertical);panel.focus();if(!vertical)await load();
 },async preparePrint(){
  if(!snapshot||root.hidden||destroyed||exporting||paymentActions.isEditing()||launchActions.isEditing())throw cancelled();pickers?.close();printing=true;refresh.disabled=true;search.disabled=true;for(const node of controls.values())node.disabled=true;
  const states=entries.map(entry=>({entry,open:entry.card.open,inert:entry.card.inert})),current=revision;
  for(const {entry} of states)entry.card.inert=true;
  const restore=()=>{for(const {entry,open,inert} of states){entry.card.open=open;entry.card.inert=inert||false;entry.detail.hidden=!open;}printing=false;refresh.disabled=false;search.disabled=false;for(const node of controls.values())node.disabled=false;};
  try{for(const {entry} of states){entry.card.open=true;entry.detail.hidden=false;await loadGroup(entry);}if(root.hidden||destroyed||current!==revision)throw cancelled();for(const {entry} of states){entry.card.open=true;entry.detail.hidden=false;}return restore;}catch(error){restore();throw error;}
 },close,destroy(){if(destroyed)return;close();destroyed=true;paymentActions.destroy();launchActions.destroy();pickers?.destroy();win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);root.remove();}});
}
