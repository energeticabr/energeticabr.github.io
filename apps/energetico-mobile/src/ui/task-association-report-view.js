import {buildTaskAssociationOverview} from '../chat/task-association-report-model.js';
import {provisionDateKey} from '../chat/pending-provision-dates.js';
import {bindSearchableFilterSelects} from './searchable-filter-selects.js';

const LOGO=new URL('../../../../assets/logo-energetica-oficial.png',import.meta.url).href;
const DEFAULT_STATUSES=['ATIVIDADE CRIADA','EM ATENDIMENTO'];
const SELECTS=[['id','ID'],['supplier','FORNECEDOR'],['difficulty','DIFICULDADE'],['priority','PRIORITÁRIA'],['status','STATUS']];
const COLUMNS=[['🆔 ID',7],['📅 DATA CRIAÇÃO',15],['⏰ DATA FATAL',20],['📝 TAREFA',43],['🚨 PRIORIDADE',15]];
const date=value=>value?`${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)}`:'—';

export function createTaskAssociationReportView({document:doc=globalThis.document,data,now=()=>new Date()}={}){
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
 const content=make('div','tar-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Indicadores e atividades por associação');report.append(toolbar,content);panel.append(warning,report);root.append(panel);doc.body.append(root);
 let snapshot=null,controller=null,revision=0,pickers=null,destroyed=false,returnFocus=null,oldOverflow='',app=null,oldInert=false;
 const portrait=()=>win?.matchMedia?win.matchMedia('(orientation: portrait)').matches:win?.innerHeight>win?.innerWidth;
 const selected=()=>({...Object.fromEntries([...controls].filter(([name])=>name!=='status').map(([name,node])=>[name,node.value])),description:description.value,dueDate:native.value,statuses:[...controls.get('status').selectedOptions].map(option=>option.value).filter(Boolean)});
 function render(){
  if(content.contains(doc.activeElement))panel.focus();content.replaceChildren();if(!snapshot)return;
  const result=buildTaskAssociationOverview(snapshot,selected(),provisionDateKey(now()));
  const brand=make('div','tar-brand'),logo=make('img');logo.src=LOGO;logo.alt='Energética Construtora';brand.append(logo);content.append(brand);
  const cards=make('div','tar-cards');for(const [name,label] of [['pending','⏳ ATIVIDADES PENDENTES'],['completed','✅ ATIVIDADES CONCLUÍDAS'],['total','📊 TOTAL DE ATIVIDADES']]){const card=make('div',`tar-card tar-metric-${name}`);card.dataset.metric=name;card.append(make('span','',label),make('strong','',String(result.metrics[name])));cards.append(card);}content.append(cards);
  if(!result.groups.length){content.append(make('p','tar-empty','Nenhuma atividade encontrada para os filtros selecionados.'));return;}
  for(const group of result.groups){
   const article=make('article','tar-group'),aside=make('div','tar-association');aside.style.backgroundColor=group.color;aside.append(make('span','','🏢 ASSOCIAÇÃO'),make('h2','',group.association),make('strong','tar-association-total',`TOTAL: ${group.total}`),make('span','',`PENDENTES: ${group.pending}`));
   const wrap=make('div','tar-table-wrap'),table=make('table','tar-table'),cols=make('colgroup'),head=make('thead'),header=make('tr'),body=make('tbody'),foot=make('tfoot');table.setAttribute('aria-label',`Atividades da associação ${group.association}`);
   for(const [label,width] of COLUMNS){const col=make('col');col.style.width=`${width}%`;cols.append(col);const th=make('th','',label);th.scope='col';header.append(th);}head.append(header);
   for(const row of group.tasks){
    const tr=make('tr');tr.dataset.taskId=String(row.id);tr.style.backgroundColor=row.rowColor;tr.append(make('td','tar-id',String(row.id)));
    const created=make('td','tar-created');created.append(make('strong','',date(row.createdDate)));if(row.createdDays!=null)created.append(make('small','',`HÁ ${row.createdDays} DIAS`));tr.append(created);
    const due=make('td','tar-due');due.append(make('strong','',row.dueDate?date(row.dueDate):'SEM DATA'));if(row.dueDate){const label=make('small','',row.dueLabel);label.style.color=row.dueColor;due.append(label);}else due.style.color=row.dueColor;tr.append(due,make('td','tar-task',row.description||'—'));
    const priority=make('td','tar-priority',row.priority||'—');priority.style.color=row.priorityColor;if(row.completed)priority.append(make('small','tar-completed','✅ CONCLUÍDO'));tr.append(priority);body.append(tr);
   }
   const footerRow=make('tr'),footer=make('td','',`TOTAL DE ATIVIDADES NESTA ASSOCIAÇÃO: ${group.total}`);footer.colSpan=5;footerRow.append(footer);foot.append(footerRow);table.append(cols,head,body,foot);wrap.append(table);article.append(aside,wrap);content.append(article);
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
  if(root.hidden||portrait()||destroyed)return;if(content.contains(doc.activeElement))panel.focus();pickers?.close();controller?.abort();const current=++revision,active=new AbortController();controller=active;snapshot=null;refresh.disabled=true;content.replaceChildren(make('p','tar-notice','Carregando atividades do SharePoint…'));report.setAttribute('aria-busy','true');
  try{const result=await data.loadSnapshot({signal:active.signal});if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;buildTaskAssociationOverview(result,selected(),provisionDateKey(now()));snapshot=result;populate();render();}
  catch(error){if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;snapshot=null;const message=make('p','tar-notice','Não foi possível carregar as atividades por associação.');message.setAttribute('role','status');const retry=button('Tentar novamente','tar-retry','Tentar novamente');retry.addEventListener('click',()=>void load());content.replaceChildren(message,retry);}
  finally{if(current===revision){refresh.disabled=false;report.setAttribute('aria-busy','false');}}
 }
 function orientationChanged(){if(root.hidden)return;const vertical=portrait();warning.hidden=!vertical;panel.classList.toggle('tar-portrait',vertical);if(vertical){pickers?.close();if(panel.contains(doc.activeElement))panel.focus();controller?.abort();revision++;snapshot=null;content.replaceChildren();report.hidden=true;report.setAttribute('aria-busy','false');refresh.disabled=false;}else if(report.hidden){report.hidden=false;void load();}}
 function close(){if(root.hidden)return;controller?.abort();revision++;snapshot=null;pickers?.close();content.replaceChildren();root.hidden=true;doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;const target=returnFocus?.isConnected?returnFocus:doc.querySelector('[data-action="open-task-association-report"]:not(:disabled)')||app;target?.focus?.();returnFocus=null;}
 root.addEventListener('click',event=>{if(event.target===root)close();});root.addEventListener('keydown',event=>{if(root.hidden)return;if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key!=='Tab')return;const nodes=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(node=>!node.disabled&&!node.closest('[hidden]')&&node.tabIndex>=0),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){event.preventDefault();first?.focus();}});
 const filterChanged=()=>{render();content.scrollTop=0;};for(const node of controls.values())node.addEventListener('change',filterChanged);description.addEventListener('input',filterChanged);native.addEventListener('change',()=>{display.value=native.value?date(native.value):'';filterChanged();});clear.addEventListener('click',()=>{native.value='';display.value='';filterChanged();});refresh.addEventListener('click',()=>void load());win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
 return Object.freeze({element:root,async open(){if(destroyed)throw new Error('O relatório foi encerrado.');if(!root.hidden)return;returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;doc.body.style.overflow='hidden';if(app)app.inert=true;description.value='';native.value='';display.value='';populate(true);root.hidden=false;const vertical=portrait();warning.hidden=!vertical;report.hidden=vertical;panel.classList.toggle('tar-portrait',vertical);panel.focus();content.scrollTop=0;if(!vertical)await load();},close,destroy(){if(destroyed)return;close();destroyed=true;pickers?.destroy();win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);root.remove();}});
}
