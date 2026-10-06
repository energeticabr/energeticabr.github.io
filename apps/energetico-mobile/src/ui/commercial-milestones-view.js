import {buildCommercialMilestones} from '../chat/commercial-milestones-model.js';
import {formatOperationsDate} from '../chat/operations-reports-model.js';
import {bindSearchableFilterSelects} from './searchable-filter-selects.js';

const LOGO=new URL('../../../../assets/logo-energetica-oficial.png',import.meta.url).href;
const FILTERS=[['branch','FILIAL'],['contractId','NUMERO CONTRATO'],['buyer','COMPRADOR'],['property','IMÓVEL'],['visualStatus','STATUS IMÓVEL']];
const key=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
const statusTone=v=>key(v)==='ATIVIDADE FINALIZADA'?'success':key(v)==='ATIVIDADE INICIADA'?'warning':'neutral';
const dueTone=days=>days===null?'neutral':days<0?'danger':days===0?'warning':'success';
const today=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export function createCommercialMilestonesReportView({document:doc=globalThis.document,data,now=()=>new Date()}={}){
 if(!doc?.body||typeof data?.loadSnapshot!=='function')throw new TypeError('O relatório comercial requer documento e sessão SharePoint.');
 const win=doc.defaultView;
 const make=(tag,cls='',text)=>{const node=doc.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const root=make('div','pl-overlay cm-overlay');root.hidden=true;
 const panel=make('section','pl-dialog cm-dialog');panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Andamento comercial dos imóveis');
 const warning=make('p','pl-orientation','PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');warning.setAttribute('role','status');
 const report=make('div','pl-report cm-report');report.hidden=true;
 const filters=make('div','pl-filters cm-filters'),controls=new Map();
 const refresh=make('button','pl-refresh','⟳');refresh.type='button';refresh.setAttribute('aria-label','Atualizar andamentos comerciais');filters.append(refresh);
 for(const [name,label] of FILTERS){const holder=make('label','pl-filter'),select=make('select');select.name=name;select.setAttribute('aria-label',label);holder.append(make('span','pl-filter-label',label),select);filters.append(holder);controls.set(name,select);}
 const notice=make('p','pl-notice');notice.hidden=true;notice.setAttribute('role','status');
 const content=make('div','pl-table-scroll cm-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Últimos andamentos e histórico dos marcos comerciais');
 report.append(filters,notice,content);panel.append(warning,report);root.append(panel);doc.body.append(root);
 let snapshot=null,controller=null,revision=0,pickers=null,destroyed=false,returnFocus=null,oldOverflow='',app=null,oldInert=false;
 const portrait=()=>win?.matchMedia?win.matchMedia('(orientation: portrait)').matches:win?.innerHeight>win?.innerWidth;
 const showNotice=text=>{notice.textContent=text;notice.hidden=!text;};
 const selected=()=>Object.fromEntries([...controls].map(([name,node])=>[name,node.value]));
 function spanLength(rows,index,fields){const current=rows[index];let count=1;for(let i=index+1;i<rows.length&&fields.every(field=>rows[i][field]===current[field]);i++)count++;return count;}
 function startsGroup(rows,index,fields){return index===0||fields.some(field=>rows[index-1][field]!==rows[index][field]);}
 function dateCell(row,fatal=false){
  const cell=make('td',fatal?'cm-due':'cm-start'),value=fatal?row.dueDate:row.startDate;
  if(!value){cell.append(make('span','cm-missing',fatal?'-':'NÃO INDICADO'));return cell;}
  cell.append(make('strong','',formatOperationsDate(value)));
  const days=fatal?row.daysToDue:row.daysInProgress;
  if(days!==null){const label=fatal?(days<0?`VENCIDA HÁ ${Math.abs(days)} DIA(S)`:days===0?'VENCE HOJE':`${days} DIA(S) PARA A FATAL`):`${days} DIA(S) DE ANDAMENTO`;const note=make('div','cm-days',label);if(fatal)note.dataset.tone=dueTone(days);cell.append(note);}
  return cell;
 }
 function render(){
  content.replaceChildren();showNotice('');if(!snapshot)return;
  const result=buildCommercialMilestones(snapshot,selected(),today(now()));
  const brand=make('div','cm-brand'),logo=make('img');logo.src=LOGO;logo.alt='Logo Energética';brand.append(logo);content.append(brand);
  content.append(make('p','cm-instruction','🔎 FILTRE CONTRATO, COMPRADOR OU IMÓVEL PARA DETALHAR TODO O CONTRATO E VISUALIZAR TODOS OS TIPOMARCO'));
  if(!result.branches.length){content.append(make('p','cm-empty','NENHUM REGISTRO ENCONTRADO.'));return;}
  content.append(make('h2','cm-heading',result.detail?'DETALHAMENTO DOS CONTRATOS':'ÚLTIMO ANDAMENTO POR IMÓVEL'));
  content.append(make('p','cm-subtitle',result.detail?'HISTÓRICO COMPLETO DE TIPOMARCO':'UM REGISTRO POR IMÓVEL — CONSIDERANDO A DATA DE INÍCIO MAIS RECENTE, INDEPENDENTEMENTE DO CONTRATO OU COMPRADOR'));
  for(const branch of result.branches){
   const section=make('section','cm-branch-section');section.append(make('h3','cm-branch-heading',`🏢 FILIAL ${branch.name}`));
   const table=make('table','cm-milestones'),cols=make('colgroup');
   for(const width of [10,6,16,7,25,10,10,6,10]){const col=make('col');col.style.width=`${width}%`;cols.append(col);}
   const head=make('thead'),titles=make('tr');for(const label of ['FILIAL','IMÓVEL','COMPRADOR','ID CONTRATO',result.detail?'TIPO MARCO':'ÚLTIMO TIPO MARCO','DESCRIÇÃO','INÍCIO','DATA FATAL','STATUS']){const th=make('th','',label);th.scope='col';titles.append(th);}head.append(titles);
   const body=make('tbody');table.append(cols,head,body);
   branch.rows.forEach((row,index)=>{
    const tr=make('tr');tr.dataset.tone=(!result.detail||row.isLatest)&&row.daysToDue!==null&&row.daysToDue<=0?dueTone(row.daysToDue):'neutral';
    if(index===0){const cell=make('td','cm-branch',`🏢 ${branch.name}`);cell.rowSpan=branch.rows.length;tr.append(cell);}
    for(const [cls,field,fields] of [['property','propertyLabel',['propertyLabel']],['buyer','buyerLabel',['propertyLabel','buyerLabel']],['contract','contractLabel',['propertyLabel','buyerLabel','contractLabel']]]){
     if(!result.detail||startsGroup(branch.rows,index,fields)){const cell=make('td',`cm-${cls}`,row[field]);cell.rowSpan=result.detail?spanLength(branch.rows,index,fields):1;if((field==='buyerLabel'&&row[field]==='N/A')||(field==='contractLabel'&&!row.contractId))cell.dataset.tone='danger';tr.append(cell);}
    }
    tr.append(make('td','cm-type',row.type||''),make('td','cm-description',row.description||''),dateCell(row),dateCell(row,true));
    const status=make('td','cm-status',row.status||'');status.dataset.tone=statusTone(row.status);tr.append(status);body.append(tr);
   });
   const foot=make('tfoot'),total=make('tr'),cell=make('td','',`${result.detail?'TOTAL DE ANDAMENTOS':'TOTAL DE IMÓVEIS'} NA FILIAL: ${branch.rows.length}`);cell.colSpan=9;total.append(cell);foot.append(total);table.append(foot);section.append(table);content.append(section);
  }
 }
 function populate(){
  pickers?.destroy();pickers=null;
  const options=buildCommercialMilestones(snapshot,{},today(now())).filterOptions;
  for(const [name] of FILTERS){const select=controls.get(name),current=select.value;const unique=[...new Set([...(options[name]||[]),current].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));select.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));for(const value of unique)select.append(Object.assign(make('option','',value),{value}));select.value=current;}
  pickers=bindSearchableFilterSelects(filters,{placement:'below'});
 }
 async function load(){
  if(root.hidden||portrait()||destroyed)return;
  pickers?.close();controller?.abort();const current=++revision,active=new AbortController();controller=active;snapshot=null;content.replaceChildren();showNotice('Carregando andamentos comerciais do SharePoint…');report.setAttribute('aria-busy','true');refresh.disabled=true;
  try{const result=await data.loadSnapshot({signal:active.signal});if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;buildCommercialMilestones(result,{},today(now()));snapshot=result;populate();render();}
  catch(error){if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;snapshot=null;content.replaceChildren();showNotice('Não foi possível carregar os andamentos comerciais. Use Atualizar para tentar novamente.');}
  finally{if(current===revision){report.setAttribute('aria-busy','false');refresh.disabled=false;}}
 }
 function orientationChanged(){
  if(root.hidden)return;const vertical=portrait();warning.hidden=!vertical;panel.classList.toggle('pl-dialog--portrait',vertical);
  if(vertical){pickers?.close();if(report.contains(doc.activeElement))panel.focus();controller?.abort();revision++;snapshot=null;content.replaceChildren();report.hidden=true;}
  else if(report.hidden){report.hidden=false;void load();}
 }
 function close(){if(root.hidden)return;controller?.abort();revision++;snapshot=null;pickers?.close();content.replaceChildren();root.hidden=true;doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;returnFocus?.focus?.();returnFocus=null;}
 root.addEventListener('click',e=>{if(e.target===root)close();});
 root.addEventListener('keydown',e=>{if(root.hidden)return;if(e.key==='Escape'){e.preventDefault();close();return;}if(e.key!=='Tab')return;const nodes=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(n=>!n.disabled&&!n.closest('[hidden]')&&n.tabIndex>=0),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){e.preventDefault();first?.focus();}});
 for(const node of controls.values())node.addEventListener('change',()=>{render();content.scrollTop=0;});refresh.addEventListener('click',()=>void load());win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
 return Object.freeze({element:root,async open(){
  if(destroyed)throw new Error('O relatório comercial foi encerrado.');if(!root.hidden)return;returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;doc.body.style.overflow='hidden';if(app)app.inert=true;pickers?.destroy();pickers=null;
  for(const [name,node] of controls){const value=name==='visualStatus'?'ATIVO':'';node.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));if(value)node.append(Object.assign(make('option','',value),{value}));node.value=value;}
  root.hidden=false;const vertical=portrait();warning.hidden=!vertical;report.hidden=vertical;panel.classList.toggle('pl-dialog--portrait',vertical);panel.focus();if(!vertical)await load();
 },close,destroy(){if(destroyed)return;close();destroyed=true;pickers?.destroy();win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);root.remove();}});
}
