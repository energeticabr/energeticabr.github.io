import { bindReportLandscape } from './report-landscape.js';
import { addReportCloseControl } from './report-close-control.js';
import {buildTaskAssociationOverview,isCompletedTaskStatus} from '../chat/task-association-report-model.js';
import {provisionDateKey} from '../chat/pending-provision-dates.js';
import {bindSearchableFilterSelects} from './searchable-filter-selects.js';
import { createGalleryAttachmentCounts } from './gallery-attachment-counts.js';
import { PDF_ATTACHMENT_ICON } from './report-pdf-attachment-icon.js';

const LOGO=new URL('../../../../assets/logo-energetica-oficial.png',import.meta.url).href;
const DEFAULT_STATUSES=['ATIVIDADE CRIADA','EM ATENDIMENTO'];
const SELECTS=[['id','ID'],['supplier','FORNECEDOR'],['difficulty','DIFICULDADE'],['priority','PRIORITÁRIA'],['status','STATUS']];
const COLUMNS=[['🆔 ID',7],['📅 DATA CRIAÇÃO',14],['⏰ DATA FATAL',15],['📝 TAREFA',34],['🚨 PRIORIDADE',14],['STATUS',16]];
const date=value=>value?`${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)}`:'—';

export function createTaskAssociationReportView({document:doc=globalThis.document,data,openMediaCollection,now=()=>new Date()}={}){
 if(!doc?.body||typeof data?.loadSnapshot!=='function'||typeof now!=='function')throw new TypeError('O relatório requer documento e sessão SharePoint.');
 const win=doc.defaultView,make=(tag,cls='',text)=>{const node=doc.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const button=(label,cls,text)=>{const node=make('button',cls,text);node.type='button';node.setAttribute('aria-label',label);return node;};
 const root=make('div','tar-overlay');root.hidden=true;
 const panel=make('section','tar-dialog');panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Atividades por associação');
 const warning=make('p','tar-orientation','PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');warning.setAttribute('role','status');
 const report=make('div','tar-report'),toolbar=make('div','tar-toolbar'),refresh=button('Atualizar atividades por associação','tar-refresh','⟳');toolbar.append(refresh);
 const descriptionField=make('label','tar-filter tar-description'),description=make('input');description.type='search';description.name='description';description.setAttribute('aria-label','DESCRIÇÃO');descriptionField.append(make('span','tar-filter-label','DESCRIÇÃO'),description);toolbar.append(descriptionField);
 const controls=new Map();
 for(const [name,label] of SELECTS){const field=make('label','tar-filter'),select=make('select');select.name=name;select.multiple=name==='status';select.setAttribute('aria-label',label);field.append(make('span','tar-filter-label',label),select);toolbar.append(field);controls.set(name,select);}
 const dateField=make('div','tar-filter tar-date-filter'),holder=make('div','tar-date'),native=make('input','tar-date-native'),display=make('input','tar-date-display'),calendar=button('Selecionar data fatal','tar-calendar','▦'),clear=button('Limpar data fatal','tar-date-clear','×');
 native.type='date';native.name='dueDate';native.tabIndex=-1;native.setAttribute('aria-label','Data fatal no calendário');display.type='text';display.readOnly=true;display.placeholder='dd/mm/yyyy';display.setAttribute('aria-label','DATA FATAL');
 const showCalendar=()=>{try{if(native.showPicker)native.showPicker();else{native.focus();native.click();}}catch{native.focus();native.click();}};
 calendar.addEventListener('click',showCalendar);display.addEventListener('click',showCalendar);display.addEventListener('keydown',event=>{if(['Enter',' ','ArrowDown'].includes(event.key)){event.preventDefault();showCalendar();}});
 holder.append(native,display,calendar,clear);dateField.append(make('span','tar-filter-label','DATA FATAL'),holder);toolbar.append(dateField);
 const notice=make('p','tar-save-notice');notice.hidden=true;notice.setAttribute('role','status');notice.dataset.reportScreenOnly='';
 const content=make('div','tar-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Indicadores e atividades por associação');report.append(toolbar,notice,content);panel.append(warning,report);root.append(panel);doc.body.append(root);
 let snapshot=null,controller=null,revision=0,pickers=null,destroyed=false,returnFocus=null,oldOverflow='',app=null,oldInert=false;
 const canOpenPdfs=typeof data.listPdfAttachments==='function'&&typeof openMediaCollection==='function';
 const pdfSlots=new Map(),interactivePdfReads=new Set(),pdfPermissionFailures=new Map();
 let pdfObserver;
 const pdfAttachments=createGalleryAttachmentCounts({
  async loadAttachments(row,{signal}){
   try{
    const files=await data.listPdfAttachments(snapshot.attachmentListId,row.id,{
     signal,interactive:interactivePdfReads.delete(row.id),
    });
    if(!signal.aborted)pdfPermissionFailures.delete(row.id);
    return files;
   }catch(error){
    if(!signal.aborted&&error?.code==='AUTH_REQUIRED')pdfPermissionFailures.set(row.id,row);
    throw error;
   }
  },
  onChange:updatePdfControl,
 });
 const landscape = bindReportLandscape(root);
 addReportCloseControl({root, toolbar:toolbar, onClose:close});

 const finishPopup=make('div','tar-finish-overlay');finishPopup.hidden=true;finishPopup.dataset.reportScreenOnly='';
 finishPopup.setAttribute('role','dialog');finishPopup.setAttribute('aria-modal','true');finishPopup.setAttribute('aria-label','Finalizar atividade');
 const finishForm=make('form','tar-finish-form');finishForm.tabIndex=-1;
 const finishSubject=make('p','tar-finish-subject');
 const finishDate=make('input');finishDate.type='date';finishDate.required=true;finishDate.disabled=true;
 const finishLabel=make('label','','Data de conclusão');finishLabel.append(finishDate);
 const finishNotice=make('p','tar-finish-notice');finishNotice.setAttribute('role','status');finishNotice.hidden=true;
 const finishCancel=button('Cancelar finalização','tar-finish-cancel','CANCELAR');
 const finishSubmit=make('button','tar-finish-button','CONFIRMAR');finishSubmit.type='submit';
 const finishActions=make('div','tar-finish-actions');finishActions.append(finishCancel,finishSubmit);
 finishForm.append(make('h2','','Deseja finalizar esta atividade?'),finishSubject,finishLabel,finishNotice,finishActions);
 finishPopup.append(finishForm);root.append(finishPopup);
 let finishing=null;

 function finishMessage(text){finishNotice.textContent=text;finishNotice.hidden=!text;}
 function resetPdfSlots(){
  pdfObserver?.disconnect();pdfObserver=null;pdfSlots.clear();
 }
 function clearPdfAttachments(){
  resetPdfSlots();interactivePdfReads.clear();pdfPermissionFailures.clear();pdfAttachments.reset();
 }
 function updatePdfControl(row){
  const cell=pdfSlots.get(row.id)?.cell;
  if(!cell?.isConnected)return;
  const files=pdfAttachments.attachmentsFor(row);
  const previous=cell.querySelector('button');
  let control;
  if(files?.length){
   control=button(`Abrir PDFs da atividade ${row.id}`,'tar-pdf-attachment');
   control.innerHTML=PDF_ATTACHMENT_ICON;
   control.addEventListener('click',async()=>{
    const {signal}=controller;
    control.disabled=true;
    try{
     await openMediaCollection(files,{
      signal,returnLabel:'Voltar ao relatório',
      onClose:()=>{control.disabled=false;},
      resolveReturnFocus:()=>!root.hidden?(pdfSlots.get(row.id)?.cell.querySelector('button')||panel):null,
     });
    }catch{
     if(!signal.aborted){notice.textContent=`Não foi possível abrir os PDFs da atividade ${row.id}.`;notice.hidden=false;}
    }finally{control.disabled=false;}
   });
  }else if(pdfAttachments.hasError(row)){
   control=button(`Consultar novamente os anexos da atividade ${row.id}`,'tar-pdf-attachment','↻');
   control.addEventListener('click',()=>{
    control.disabled=true;
    interactivePdfReads.add(row.id);
    void pdfAttachments.load(row,{force:true,priority:true}).then(items=>{
     if(!items)return;
     for(const missing of pdfPermissionFailures.values())void pdfAttachments.load(missing,{force:true}).catch(()=>{});
    }).catch(()=>{});
   });
  }
  const hadFocus=previous&&doc.activeElement===previous;
  previous?.remove();
  if(control){control.title=control.getAttribute('aria-label');cell.append(control);}
  if(hadFocus)(control||panel).focus();
 }
 function watchPdfCell(cell,row){
  if(!canOpenPdfs||!snapshot.attachmentListId||row.hasAttachments===false)return;
  pdfSlots.set(row.id,{cell,row});
  updatePdfControl(row);
  if(pdfAttachments.attachmentsFor(row)||pdfAttachments.hasError(row))return;
  if(!win?.IntersectionObserver){void pdfAttachments.load(row).catch(()=>{});return;}
  pdfObserver??=new win.IntersectionObserver((entries,observer)=>{
   for(const entry of entries){
    if(!entry.isIntersecting)continue;
    observer.unobserve(entry.target);
    const slot=pdfSlots.get(Number(entry.target.parentElement.dataset.taskId));
    if(slot?.cell===entry.target)void pdfAttachments.load(slot.row).catch(()=>{});
   }
  },{root:content,rootMargin:'120px'});
  pdfObserver.observe(cell);
 }
 function openFinish(row,trigger,draftDate){
  if(finishing||root.hidden)return;
  finishing={row,trigger,controller:new AbortController(),saving:false};
  pickers?.close();panel.inert=true;finishPopup.hidden=false;
  finishSubject.textContent=`#${row.id} · ${row.description||'Atividade sem descrição'}`;
  finishDate.value=draftDate||provisionDateKey(now());finishDate.disabled=false;finishCancel.disabled=false;finishSubmit.disabled=false;
  finishMessage('');finishForm.focus();
 }
 function closeFinish(restoreFocus=true){
  if(!finishing)return;
  const {controller,trigger}=finishing;
  finishing=null;controller.abort();finishDate.disabled=true;finishPopup.hidden=true;panel.inert=false;
  if(restoreFocus)trigger.focus();
 }
 finishCancel.addEventListener('click',()=>{if(!finishing?.saving)closeFinish();});
 finishForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const active=finishing;
  if(!active||active.saving||!finishForm.reportValidity())return;
  const completionDate=finishDate.value;
  active.saving=true;finishDate.disabled=true;finishCancel.disabled=true;finishSubmit.disabled=true;
  finishMessage('Finalizando atividade…');finishForm.focus();
  let saved;
  try{
   saved=await data.finalizeTask(active.row.id,completionDate,{expectedTask:active.row,signal:active.controller.signal});
  }catch(error){
   if(finishing!==active)return;
   active.saving=false;finishDate.disabled=false;finishCancel.disabled=false;finishSubmit.disabled=false;
   if(error?.code==='task_association_already_completed')finishMessage('Esta atividade já foi concluída no SharePoint. Cancele e atualize o relatório para conferir.');
   else if(error?.status===412||error?.code==='task_association_changed')finishMessage('A atividade mudou no SharePoint. Cancele e atualize o relatório para conferir.');
   else finishMessage('Não foi possível confirmar a finalização. Tente novamente.');
   finishSubmit.focus();return;
  }
  if(finishing!==active)return;
  closeFinish(false);
  snapshot={...snapshot,tasks:snapshot.tasks.map(row=>Number(row.id)===saved.id?{...row,...saved}:row)};
  populate();render();notice.textContent=`Atividade #${saved.id} concluída.`;notice.hidden=false;content.focus({preventScroll:true});
 });
 const selected=()=>({...Object.fromEntries([...controls].filter(([name])=>name!=='status').map(([name,node])=>[name,node.value])),description:description.value,dueDate:native.value,statuses:[...controls.get('status').selectedOptions].map(option=>option.value).filter(Boolean)});
 function render(){
  if(content.contains(doc.activeElement))panel.focus();resetPdfSlots();content.replaceChildren();if(!snapshot)return;
  const result=buildTaskAssociationOverview(snapshot,selected(),provisionDateKey(now()));
  const brand=make('div','tar-brand'),logo=make('img');logo.src=LOGO;logo.alt='Energética Construtora';brand.append(logo);content.append(brand);
  const cards=make('div','tar-cards');for(const [name,label] of [['pending','⏳ ATIVIDADES PENDENTES'],['completed','✅ ATIVIDADES CONCLUÍDAS'],['total','📊 TOTAL DE ATIVIDADES']]){const card=make('div',`tar-card tar-metric-${name}`);card.dataset.metric=name;card.append(make('span','',label),make('strong','',String(result.metrics[name])));cards.append(card);}content.append(cards);
  if(!result.groups.length){content.append(make('p','tar-empty','Nenhuma atividade encontrada para os filtros selecionados.'));return;}
  for(const group of result.groups){
   const article=make('article','tar-group'),aside=make('div','tar-association');aside.style.backgroundColor=group.color;aside.append(make('span','','🏢 ASSOCIAÇÃO'),make('h2','',group.association),make('strong','tar-association-total',`TOTAL: ${group.total}`),make('span','',`PENDENTES: ${group.pending}`));
   const wrap=make('div','tar-table-wrap'),table=make('table','tar-table'),cols=make('colgroup'),head=make('thead'),header=make('tr'),body=make('tbody'),foot=make('tfoot');table.setAttribute('aria-label',`Atividades da associação ${group.association}`);
   const idCells=[];
   for(const [label,width] of COLUMNS){const col=make('col');col.style.width=`${width}%`;cols.append(col);const th=make('th','',label);th.scope='col';header.append(th);}head.append(header);
   for(const row of group.tasks){
    const tr=make('tr');tr.dataset.taskId=String(row.id);tr.style.backgroundColor=row.rowColor;
    const idCell=make('td','tar-id');idCell.append(make('span','',String(row.id)));tr.append(idCell);
    const created=make('td','tar-created');created.append(make('strong','',date(row.createdDate)));if(row.createdDays!=null)created.append(make('small','',`HÁ ${row.createdDays} DIAS`));tr.append(created);
    const due=make('td','tar-due');due.append(make('strong','',row.dueDate?date(row.dueDate):'SEM DATA'));if(row.dueDate){const label=make('small','',row.dueLabel);label.style.color=row.dueColor;due.append(label);}else due.style.color=row.dueColor;tr.append(due,make('td','tar-task',row.description||'—'));
    const priority=make('td','tar-priority',row.priority||'—');priority.style.color=row.priorityColor;
    const status=make('td','tar-status');status.append(make('strong',row.completed?'tar-completed':'',row.completed?`✅ ${row.status}`:row.status||'—'));
    if(!row.completed&&typeof data.finalizeTask==='function'){
     const finish=button(`Finalizar atividade ${row.id}`,'tar-finish-button','FINALIZAR');
     finish.addEventListener('click',()=>openFinish(row,finish));status.append(finish);
    }
    tr.append(priority,status);body.append(tr);
    idCells.push([idCell,row]);
   }
   const footerRow=make('tr'),footer=make('td','',`TOTAL DE ATIVIDADES NESTA ASSOCIAÇÃO: ${group.total}`);footer.colSpan=COLUMNS.length;footerRow.append(footer);foot.append(footerRow);table.append(cols,head,body,foot);wrap.append(table);article.append(aside,wrap);content.append(article);
   for(const [cell,row] of idCells)watchPdfCell(cell,row);
  }
 }
 function populate(reset=false){
  const focusedSelect=[...controls.values()].find(node=>node.nextElementSibling?.contains(doc.activeElement));if(focusedSelect)panel.focus();
  pickers?.destroy();pickers=null;const options=buildTaskAssociationOverview(snapshot||{tasks:[]},{statuses:[]},provisionDateKey(now())).filterOptions;
  for(const [name,node] of controls){const current=reset?(name==='status'?DEFAULT_STATUSES:[]):[...node.selectedOptions].map(option=>option.value).filter(Boolean),values=[...new Set([...(options[name]||[]),...(name==='status'?[...DEFAULT_STATUSES,'CONCLUÍDO']:[]),...current])];node.replaceChildren(Object.assign(make('option','','Todos'),{value:'',selected:!current.length}));for(const value of values)node.append(Object.assign(make('option','',value),{value,selected:current.includes(value)}));}
  pickers=bindSearchableFilterSelects(toolbar,{placement:'below',report:true});
  if(focusedSelect&&!root.hidden){focusedSelect.nextElementSibling?.querySelector('.sfs-trigger')?.focus();pickers.close();}
 }
 async function load(){
  if(root.hidden||destroyed||finishing)return;if(content.contains(doc.activeElement))panel.focus();pickers?.close();controller?.abort();clearPdfAttachments();const current=++revision,active=new AbortController();controller=active;snapshot=null;refresh.disabled=true;notice.hidden=true;content.replaceChildren(make('p','tar-notice','Carregando atividades do SharePoint…'));report.setAttribute('aria-busy','true');
  try{const result=await data.loadSnapshot({signal:active.signal});if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;buildTaskAssociationOverview(result,selected(),provisionDateKey(now()));snapshot=result;populate();render();}
  catch(error){if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;snapshot=null;const message=make('p','tar-notice','Não foi possível carregar as atividades por associação.');message.setAttribute('role','status');const retry=button('Tentar novamente','tar-retry','Tentar novamente');retry.addEventListener('click',()=>void load());content.replaceChildren(message,retry);}
  finally{if(current===revision){refresh.disabled=false;report.setAttribute('aria-busy','false');}}
 }
 function orientationChanged() { landscape.update(); }
 function close(){if(root.hidden)return;closeFinish(false);root.hidden=true;controller?.abort();clearPdfAttachments();revision++;snapshot=null;pickers?.close();content.replaceChildren();doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;const target=returnFocus?.isConnected?returnFocus:doc.querySelector('[data-action="open-task-association-report"]:not(:disabled)')||app;target?.focus?.();returnFocus=null;}
 root.addEventListener('click',event=>{if(event.target===root&&!finishing)close();});
 root.addEventListener('keydown',event=>{
  if(root.hidden)return;
  if(event.key==='Escape'){event.preventDefault();if(!finishing)close();else if(!finishing.saving)closeFinish();return;}
  if(event.key!=='Tab')return;
  const scope=finishing?finishForm:panel;
  const nodes=[...scope.querySelectorAll('button,input,select,[tabindex="0"]')].filter(node=>!node.disabled&&!node.closest('[hidden]')&&node.tabIndex>=0);
  const index=nodes.indexOf(doc.activeElement);
  if(index===-1||event.shiftKey&&index===0||!event.shiftKey&&index===nodes.length-1){event.preventDefault();(event.shiftKey?nodes.at(-1):nodes[0])?.focus();}
 });
 const filterChanged=()=>{render();content.scrollTop=0;};for(const node of controls.values())node.addEventListener('change',filterChanged);description.addEventListener('input',filterChanged);native.addEventListener('change',()=>{display.value=native.value?date(native.value):'';filterChanged();});clear.addEventListener('click',()=>{native.value='';display.value='';filterChanged();});refresh.addEventListener('click',()=>void load());win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
 async function open({finishDraft}={}){
  if(destroyed)throw new Error('O relatório foi encerrado.');if(!root.hidden)return;
  returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;
  doc.body.style.overflow='hidden';if(app)app.inert=true;
  description.value='';native.value='';display.value='';populate(true);root.hidden=false;landscape.update();warning.hidden=true;report.hidden=false;
  panel.classList.toggle('tar-portrait',false);panel.focus();content.scrollTop=0;
  const opening=load(),openedRevision=revision;
  await opening;
  if(!finishDraft||!snapshot||revision!==openedRevision||typeof data.finalizeTask!=='function')return;
  const row=snapshot.tasks.find(task=>Number(task.id)===finishDraft.id);
  if(!row||isCompletedTaskStatus(row.status))return;
  const trigger=content.querySelector(`[data-task-id="${finishDraft.id}"] .tar-finish-button`)||content;
  openFinish(row,trigger,finishDraft.date);
 }
 return Object.freeze({element:root,open,close,destroy(){if(destroyed)return;close();destroyed=true;pickers?.destroy();win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);landscape.destroy();root.remove();}});
}
