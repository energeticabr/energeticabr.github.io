import {buildSacPathologies} from '../chat/sac-pathologies-model.js';
import {formatOperationsDate} from '../chat/operations-reports-model.js';
import {bindSearchableFilterSelects} from './searchable-filter-selects.js';

const LOGO=new URL('../../../../assets/logo-energetica-oficial.png',import.meta.url).href;
const FILTERS=[['id','ID'],['branch','FILIAL'],['property','IMÓVEL'],['client','CLIENTE'],['type','TIPO PATOLOGIA'],['status','STATUS']];
const day=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const upper=value=>String(value??'').trim().toUpperCase();

export function createSacPathologiesReportView({document:doc=globalThis.document,data,now=()=>new Date()}={}){
 if(!doc?.body||typeof data?.loadSnapshot!=='function')throw new TypeError('O relatório requer documento e sessão SharePoint.');
 const win=doc.defaultView;
 const make=(tag,cls='',text)=>{const node=doc.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const root=make('div','pl-overlay sap-overlay');root.hidden=true;
 const panel=make('section','pl-dialog sap-dialog');panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Acompanhamento de patologias');
 const warning=make('p','pl-orientation','PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');warning.setAttribute('role','status');
 const report=make('div','pl-report sap-report');report.hidden=true;
 const filters=make('div','pl-filters sap-filters'),controls=new Map();
 const refresh=make('button','pl-refresh','⟳');refresh.type='button';refresh.setAttribute('aria-label','Atualizar patologias');filters.append(refresh);
 for(const [name,label] of FILTERS){const holder=make('label','pl-filter'),select=make('select');select.name=name;select.setAttribute('aria-label',label);holder.append(make('span','pl-filter-label',label),select);filters.append(holder);controls.set(name,select);}
 const notice=make('p','pl-notice');notice.hidden=true;notice.setAttribute('role','status');
 const content=make('div','pl-table-scroll sap-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Indicadores e registros de patologias');
 report.append(filters,notice,content);panel.append(warning,report);root.append(panel);doc.body.append(root);
 let snapshot=null,controller=null,revision=0,pickers=null,destroyed=false,returnFocus=null,oldOverflow='',app=null,oldInert=false;
 const portrait=()=>win?.matchMedia?win.matchMedia('(orientation: portrait)').matches:win?.innerHeight>win?.innerWidth;
 const showNotice=text=>{notice.textContent=text;notice.hidden=!text;};
 const selected=()=>Object.fromEntries([...controls].map(([name,node])=>[name,node.value]));
 function render(){
  content.replaceChildren();showNotice('');if(!snapshot)return;
  const result=buildSacPathologies(snapshot,selected(),day(now()));
  const brand=make('div','sap-brand'),logo=make('img');logo.src=LOGO;logo.alt='Logo Energética';brand.append(logo);content.append(brand);
  const title=make('header','sap-title');title.append(make('h2','','ACOMPANHAMENTO DE PATOLOGIAS'),make('p','','Dados em tempo real da base SACPATOLOGIAS'));content.append(title);
  const cards=make('div','sap-cards');
  for(const [name,label,cls] of [['total','TOTAL','sap-total'],['active','ATIVAS','sap-active'],['inactive','INATIVAS','sap-inactive'],['costTotal','CUSTO ACUMULADO','sap-cost']]){
   const card=make('div',`sap-card ${cls}`);card.dataset.metric=name;const value=name==='costTotal'?result[name].toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):String(result[name]);card.append(make('span','',label),make('strong','',value));cards.append(card);
  }
  content.append(cards);
  const frame=make('div','sap-table-frame'),table=make('table','sap-table'),cols=make('colgroup'),head=make('thead'),header=make('tr'),body=make('tbody');
  for(const width of [5,10,11,16,16,25,8,9]){const col=make('col');col.style.width=`${width}%`;cols.append(col);}
  for(const label of ['ID','INÍCIO','FIM','FILIAL (IMÓVEL)','CLIENTE','DESCRIÇÃO','TEMPO','STATUS']){const th=make('th','',label);th.scope='col';header.append(th);}head.append(header);table.append(cols,head,body);frame.append(table);content.append(frame);
  for(const row of result.rows){
   const tr=make('tr'),id=make('td','sap-id',row.id),start=make('td','sap-start',row.startDate?formatOperationsDate(row.startDate):'-'),end=make('td','sap-end');
   end.append(row.endDate?make('span','sap-end-date',formatOperationsDate(row.endDate)):make('span','sap-progress','EM ANDAMENTO'));
   const branch=make('td','sap-branch',`${row.branch||'-'} (${row.property||'-'})`),client=make('td','sap-client',row.client||'-'),description=make('td','sap-description');
   description.append(make('span','sap-type',upper(row.type)||'SEM TIPO'),make('div','sap-description-text',row.description||'-'));
   const elapsed=make('td','sap-elapsed',row.elapsedDays==null?'-':`${row.elapsedDays} dias`),status=make('td','sap-status'),badge=make('span',upper(row.status)==='ATIVO'?'sap-status-active':'sap-status-other',upper(row.status)||'SEM STATUS');status.append(badge);
   tr.append(id,start,end,branch,client,description,elapsed,status);body.append(tr);
  }
  if(!result.total){const tr=make('tr'),cell=make('td','sap-empty','Nenhum registro encontrado.');cell.colSpan=8;tr.append(cell);body.append(tr);}
 }
 function populate(){
  pickers?.destroy();pickers=null;const options=buildSacPathologies(snapshot,{},day(now())).filterOptions;
  for(const [name] of FILTERS){
   const select=controls.get(name),current=select.value,values=[...new Set([...(options[name]||[]),current].filter(Boolean))];
   // Preserve the model's numeric ID order; the explicit current/default remains available even on an empty list.
   select.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));for(const value of values)select.append(Object.assign(make('option','',value),{value}));select.value=current;
  }
  pickers=bindSearchableFilterSelects(filters,{placement:'below',report:true});
 }
 async function load(){
  if(root.hidden||portrait()||destroyed)return;pickers?.close();controller?.abort();const current=++revision,active=new AbortController();controller=active;snapshot=null;content.replaceChildren();showNotice('Carregando patologias do SharePoint…');report.setAttribute('aria-busy','true');refresh.disabled=true;
  try{const result=await data.loadSnapshot({signal:active.signal});if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;buildSacPathologies(result,{},day(now()));snapshot=result;populate();render();}
  catch(error){if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;snapshot=null;content.replaceChildren();showNotice('Não foi possível carregar as patologias. Use Atualizar para tentar novamente.');}
  finally{if(current===revision){report.setAttribute('aria-busy','false');refresh.disabled=false;}}
 }
 function orientationChanged(){if(root.hidden)return;const vertical=portrait();warning.hidden=!vertical;panel.classList.toggle('pl-dialog--portrait',vertical);if(vertical){pickers?.close();if(report.contains(doc.activeElement))panel.focus();controller?.abort();revision++;snapshot=null;content.replaceChildren();report.hidden=true;}else if(report.hidden){report.hidden=false;void load();}}
 function close(){if(root.hidden)return;controller?.abort();revision++;snapshot=null;pickers?.close();content.replaceChildren();root.hidden=true;doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;returnFocus?.focus?.();returnFocus=null;}
 root.addEventListener('click',event=>{if(event.target===root)close();});
 root.addEventListener('keydown',event=>{
  if(root.hidden)return;if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key!=='Tab')return;
  const nodes=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(node=>!node.disabled&&!node.closest('[hidden]')&&node.tabIndex>=0),first=nodes[0],last=nodes.at(-1);
  if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){event.preventDefault();first?.focus();}
 });
 for(const node of controls.values())node.addEventListener('change',()=>{render();content.scrollTop=0;});refresh.addEventListener('click',()=>void load());win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
 return Object.freeze({element:root,async open(){
  if(destroyed)throw new Error('O relatório foi encerrado.');if(!root.hidden)return;returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;doc.body.style.overflow='hidden';if(app)app.inert=true;pickers?.destroy();pickers=null;
  for(const [name,node] of controls){node.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));if(name==='status')node.append(Object.assign(make('option','','ATIVO'),{value:'ATIVO'}));node.value=name==='status'?'ATIVO':'';}
  root.hidden=false;const vertical=portrait();warning.hidden=!vertical;report.hidden=vertical;panel.classList.toggle('pl-dialog--portrait',vertical);panel.focus();if(!vertical)await load();
 },close,destroy(){if(destroyed)return;close();destroyed=true;pickers?.destroy();win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);root.remove();}});
}
