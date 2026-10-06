import {buildDocumentControlOverview} from '../chat/document-control-report-model.js';
import {provisionDateKey} from '../chat/pending-provision-dates.js';
import {bindSearchableFilterSelects} from './searchable-filter-selects.js';

const LOGO=new URL('../../../../assets/logo-energetica-oficial.png',import.meta.url).href;
const FILTERS=[['branch','FILIAL'],['homologation','TIPO HOMOLOGAÇÃO'],['person','PESSOA RELACIONADA'],['documentType','TIPO DOCUMENTO'],['stage','ETAPA'],['property','IMÓVEL'],['status','STATUS']];
const ORDERS=[['id-desc','🔢 MAIOR ID','id','desc'],['id-asc','🔢 MENOR ID','id','asc'],['expirationDate-asc','📅 VENCIMENTO MAIS PRÓXIMO','expirationDate','asc'],['submittedDate-desc','📥 SUBMETIDO MAIS RECENTE','submittedDate','desc'],['submittedDate-asc','📥 SUBMETIDO MAIS ANTIGO','submittedDate','asc'],['issuedDate-desc','📅 EMITIDO MAIS RECENTE','issuedDate','desc'],['issuedDate-asc','📅 EMITIDO MAIS ANTIGO','issuedDate','asc']];
const COLUMNS=[['ID',4],['DATA SUBMETIDO',8],['DATA EMITIDO',8],['DATA VENCIMENTO',8],['FILIAL',10],['HOMOLOGAÇÃO',10],['TIPO DOCUMENTO',13],['PESSOA RELACIONADA',16],['ETAPA',8],['IMÓVEL',7],['STATUS',8]];
const date=value=>value?`${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)}`:'—';
const upper=value=>String(value||'').trim().toUpperCase();
function homologation(value){const text=upper(value);return text.includes('FILIAL')?['filial','🏢']:text.includes('CONTRATO')?['contract','📑']:text.includes('MÃO DE OBRA')||text.includes('MAO DE OBRA')?['labor','👷']:text.includes('COMERCIAL')?['commercial','🤝']:['other','📌'];}
const relative=(days,verb)=>days==null?'':days===0?`${verb} hoje`:days>0?`${verb} há ${days} d`:`${verb} em ${Math.abs(days)} d`;

export function createDocumentControlReportView({document:doc=globalThis.document,data,now=()=>new Date()}={}){
 if(!doc?.body||typeof data?.loadSnapshot!=='function'||typeof now!=='function')throw new TypeError('O relatório requer documento e sessão SharePoint.');
 const win=doc.defaultView,make=(tag,cls='',text)=>{const node=doc.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const root=make('div','dcr-overlay');root.hidden=true;
 const panel=make('section','dcr-dialog');panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Controle de documentos');
 const warning=make('p','dcr-orientation','PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');warning.setAttribute('role','status');
 const report=make('div','dcr-report'),toolbar=make('div','dcr-toolbar'),refresh=make('button','dcr-refresh','⟳');refresh.type='button';refresh.setAttribute('aria-label','Atualizar controle de documentos');toolbar.append(refresh);
 const controls=new Map();
 for(const [name,label] of FILTERS){const field=make('label','dcr-filter'),select=make('select');select.name=name;select.setAttribute('aria-label',label);field.append(make('span','dcr-filter-label',label),select);toolbar.append(field);controls.set(name,select);}
 const sortField=make('label','dcr-sort'),sort=make('select');sort.name='order';sort.setAttribute('aria-label','Ordenação de documentos');sortField.append(make('span','dcr-filter-label','⇵ ORDENAR'),sort);toolbar.append(sortField);
 for(const [value,label] of ORDERS)sort.append(Object.assign(make('option','',label),{value}));
 const content=make('div','dcr-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Indicadores e documentos');
 report.append(toolbar,content);panel.append(warning,report);root.append(panel);doc.body.append(root);
 let snapshot=null,controller=null,revision=0,pickers=null,destroyed=false,returnFocus=null,oldOverflow='',app=null,oldInert=false;
 const portrait=()=>win?.matchMedia?win.matchMedia('(orientation: portrait)').matches:win?.innerHeight>win?.innerWidth;
 const selected=()=>{const order=ORDERS.find(entry=>entry[0]===sort.value)||ORDERS[0];return {...Object.fromEntries([...controls].map(([name,node])=>[name,node.value])),order:order[2],direction:order[3]};};
 function render(){
  if(content.contains(doc.activeElement))panel.focus();content.replaceChildren();if(!snapshot)return;
  const result=buildDocumentControlOverview(snapshot,selected(),provisionDateKey(now()));
  const brand=make('div','dcr-brand'),logo=make('img');logo.src=LOGO;logo.alt='Energética Construtora';brand.append(logo);content.append(brand);
  const heading=make('header','dcr-heading');heading.append(make('h2','','📁 CONTROLE DE DOCUMENTOS'),make('p','',`Ordenação: ${sort.selectedOptions[0]?.textContent||'🔢 MAIOR ID'}`));content.append(heading);
  const cards=make('div','dcr-cards');for(const [name,label] of [['submitted','✅ DOCUMENTOS SUBMETIDOS'],['pending','⌛ DOCUMENTOS PENDENTES'],['total','📊 DOCUMENTOS TOTAIS'],['expired','🚨 DOCUMENTOS VENCIDOS'],['expiring15','⚠️ A VENCER EM 15 DIAS']]){const card=make('div',`dcr-card dcr-metric-${name}`);card.dataset.metric=name;card.append(make('span','',label),make('strong','',String(result.metrics[name])));cards.append(card);}content.append(cards);
  if(!result.documents.length){content.append(make('p','dcr-empty','Nenhum documento encontrado para os filtros selecionados.'));return;}
  const table=make('table','dcr-table'),cols=make('colgroup'),head=make('thead'),header=make('tr'),body=make('tbody');table.setAttribute('aria-label','Controle de documentos');
  for(const [label,width] of COLUMNS){const col=make('col');col.style.width=`${width}%`;cols.append(col);const th=make('th','',label);th.scope='col';header.append(th);}head.append(header);table.append(cols,head,body);
  for(const row of result.documents){
   const expired=row.daysToExpiry!=null&&row.daysToExpiry<0,tr=make('tr',expired?'dcr-expired':Number(row.id)%2?'dcr-odd':'dcr-even');tr.dataset.documentId=String(row.id);
   tr.append(make('td','dcr-id',String(row.id)));
   for(const [field,days,verb] of [['submittedDate',row.submittedDays,'criado'],['issuedDate',row.issuedDays,'emitido']]){const cell=make('td',`dcr-${field}`);cell.append(make('strong','',date(row[field])));if(row[field])cell.append(make('small','',relative(days,verb)));tr.append(cell);}
   const expiry=make('td',`dcr-expiration ${expired?'dcr-date-expired':row.daysToExpiry!=null&&row.daysToExpiry<=15?'dcr-date-soon':''}`);expiry.append(make('strong','',date(row.expirationDate)));if(row.daysToExpiry!=null)expiry.append(make('small','',row.daysToExpiry<0?`vencido há ${Math.abs(row.daysToExpiry)} d`:row.daysToExpiry===0?'vence hoje':`vence em ${row.daysToExpiry} d`));tr.append(expiry,make('td','dcr-left',row.branch||'—'));
   const [tone,icon]=homologation(row.homologation),hom=make('td');hom.append(make('span',`dcr-badge dcr-homologation-${tone}`,`${icon} ${row.homologation||'—'}`));tr.append(hom,make('td','dcr-type dcr-left',row.documentType||'—'),make('td','dcr-left',row.person||'—'),make('td','dcr-left',row.stage||'—'),make('td','dcr-left',row.property||'—'));
   const status=make('td'),statusTone={SUBMETIDO:'submitted',PENDENTE:'pending',APROVADO:'approved'}[upper(row.status)]||'other';status.append(make('span',`dcr-badge dcr-status-${statusTone}`,row.status||'—'));tr.append(status);body.append(tr);
  }
  content.append(table,make('p','dcr-footer',`📄 TOTAL: ${result.metrics.total} DOCUMENTO(S)`));
 }
 function populate(){
  pickers?.destroy();pickers=null;const options=buildDocumentControlOverview(snapshot,{},provisionDateKey(now())).filterOptions;
  for(const [name,node] of controls){const current=node.value,values=[...new Set([...(options[name]||[]),current].filter(Boolean))];node.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));for(const value of values)node.append(Object.assign(make('option','',value),{value}));node.value=current;}
  pickers=bindSearchableFilterSelects(toolbar,{placement:'below'});
 }
 async function load(){
  if(root.hidden||portrait()||destroyed)return;if(content.contains(doc.activeElement))panel.focus();pickers?.close();controller?.abort();const current=++revision,active=new AbortController();controller=active;snapshot=null;refresh.disabled=true;content.replaceChildren(make('p','dcr-notice','Carregando documentos do SharePoint…'));report.setAttribute('aria-busy','true');
  try{const result=await data.loadSnapshot({signal:active.signal});if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;buildDocumentControlOverview(result,{},provisionDateKey(now()));snapshot=result;populate();render();}
  catch(error){if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;snapshot=null;const message=make('p','dcr-notice','Não foi possível carregar o controle de documentos.');message.setAttribute('role','status');const retry=make('button','dcr-retry','Tentar novamente');retry.type='button';retry.addEventListener('click',()=>void load());content.replaceChildren(message,retry);}
  finally{if(current===revision){refresh.disabled=false;report.setAttribute('aria-busy','false');}}
 }
 function orientationChanged(){if(root.hidden)return;const vertical=portrait();warning.hidden=!vertical;panel.classList.toggle('dcr-portrait',vertical);if(vertical){pickers?.close();if(panel.contains(doc.activeElement))panel.focus();controller?.abort();revision++;snapshot=null;content.replaceChildren();report.hidden=true;report.setAttribute('aria-busy','false');refresh.disabled=false;}else if(report.hidden){report.hidden=false;void load();}}
 function close(){if(root.hidden)return;controller?.abort();revision++;snapshot=null;pickers?.close();content.replaceChildren();root.hidden=true;doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;const target=returnFocus?.isConnected?returnFocus:doc.querySelector('[data-action="open-document-control-report"]:not(:disabled)')||app;target?.focus?.();returnFocus=null;}
 root.addEventListener('click',event=>{if(event.target===root)close();});root.addEventListener('keydown',event=>{
  if(root.hidden)return;if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key!=='Tab')return;
  const nodes=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(node=>!node.disabled&&!node.closest('[hidden]')&&node.tabIndex>=0),first=nodes[0],last=nodes.at(-1);
  if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){event.preventDefault();first?.focus();}
 });
 for(const node of controls.values())node.addEventListener('change',()=>{render();content.scrollTop=0;});sort.addEventListener('change',()=>{render();content.scrollTop=0;});refresh.addEventListener('click',()=>void load());win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
 return Object.freeze({element:root,async open(){
  if(destroyed)throw new Error('O relatório foi encerrado.');if(!root.hidden)return;returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;doc.body.style.overflow='hidden';if(app)app.inert=true;pickers?.destroy();pickers=null;
  for(const node of controls.values())node.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));sort.value='id-desc';root.hidden=false;const vertical=portrait();warning.hidden=!vertical;report.hidden=vertical;panel.classList.toggle('dcr-portrait',vertical);panel.focus();content.scrollTop=0;if(!vertical)await load();
 },close,destroy(){if(destroyed)return;close();destroyed=true;pickers?.destroy();win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);root.remove();}});
}
