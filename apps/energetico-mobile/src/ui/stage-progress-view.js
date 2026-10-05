import {buildStageProgress} from '../chat/stage-progress-model.js';
import {calendarDays,formatOperationsDate} from '../chat/operations-reports-model.js';
import {bindSearchableFilterSelects} from './searchable-filter-selects.js';

const LOGO=new URL('../../../../assets/logo-energetica-oficial.png',import.meta.url).href;
const FILTERS=[['branch','FILIAL'],['supplier','COLABORADOR'],['stage','ETAPA'],['launchStatus','STATUS ETAPA'],['activity','ATIVIDADE EXECUTADA'],['status','STATUS DEMONSTRATIVO']];
const HEADERS=['#️⃣','⚒️ Atividade','🏠 Imóvel','👷 Responsável','📅 Início','📆 Fim','⏳ Dias','📌 Status'];
const key=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
const tone=status=>['FINALIZADO','ATIVIDADE FINALIZADA'].includes(key(status))?'success':['INICIADO','ATIVIDADE INICIADA'].includes(key(status))?'info':key(status)==='NAO INICIADO'?'danger':'neutral';
const localDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export function createStageProgressReportView({document:doc=globalThis.document,data,now=()=>new Date()}={}){
 if(!doc?.body||typeof data?.loadSnapshot!=='function')throw new TypeError('O relatório de etapas requer documento e sessão SharePoint.');
 const win=doc.defaultView;
 const make=(tag,cls='',text)=>{const n=doc.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const root=make('div','pl-overlay sp-overlay');root.hidden=true;
 const panel=make('section','pl-dialog sp-dialog');panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Etapas e atividades da obra');
 const warning=make('p','pl-orientation','PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');warning.setAttribute('role','status');
 const report=make('div','pl-report sp-report');report.hidden=true;
 const filters=make('div','pl-filters sp-filters'),controls=new Map();
 const refresh=make('button','pl-refresh','⟳');refresh.type='button';refresh.setAttribute('aria-label','Atualizar etapas e atividades');filters.append(refresh);
 for(const [name,label] of FILTERS){const holder=make('label','pl-filter'),select=make('select');select.name=name;select.setAttribute('aria-label',label);holder.append(make('span','pl-filter-label',label),select);filters.append(holder);controls.set(name,select);}
 const notice=make('p','pl-notice');notice.hidden=true;notice.setAttribute('role','status');
 const content=make('div','pl-table-scroll sp-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Detalhamento das etapas e atividades');
 report.append(filters,notice,content);panel.append(warning,report);root.append(panel);doc.body.append(root);
 let snapshot=null,controller=null,revision=0,pickers=null,destroyed=false,returnFocus=null,oldOverflow='',app=null,oldInert=false;
 const portrait=()=>win?.matchMedia?win.matchMedia('(orientation: portrait)').matches:win?.innerHeight>win?.innerWidth;
 const showNotice=text=>{notice.textContent=text;notice.hidden=!text;};
 const selected=()=>Object.fromEntries([...controls].map(([name,node])=>[name,node.value]));
 function duration(days,state){const badge=make('span',`sp-duration sp-duration--${state}`,days===null?'—':`${days} dias`);return badge;}
 function render(){
  content.replaceChildren();showNotice('');if(!snapshot)return;
  const today=localDate(now()),result=buildStageProgress(snapshot,selected(),today);
  const brand=make('div','sp-brand'),logo=make('img');logo.src=LOGO;logo.alt='Logo Energética';brand.append(logo);content.append(brand);
  const results=make('div','sp-results');content.append(results);
  for(const stage of result.stages){
   const card=make('section','sp-stage'),state=tone(stage.status);card.dataset.tone=state;
   const summary=make('div','sp-stage-summary'),heading=make('h2','',`📋 ${stage.stage} (`);
   const percent=make('strong','sp-percent',stage.percent===null?'PERCENTUAL INDISPONÍVEL':`${Number(stage.percent.toFixed(2)).toLocaleString('pt-BR')}%`);
   percent.dataset.tone=stage.percent===null?'neutral':stage.percent<30?'danger':stage.percent<60?'warning':stage.percent<100?'info':'success';heading.append(percent,doc.createTextNode(')'));
   const dates=make('div','sp-stage-dates','📅 ');
   if(stage.startDate){dates.append(make('strong','sp-start',formatOperationsDate(stage.startDate)),make('strong','sp-arrow',' ➜ '),make('strong',stage.endDate?'sp-end':'',stage.endDate?formatOperationsDate(stage.endDate):'HOJE'));}else dates.append(doc.createTextNode('—'));
   const days=make('div','sp-stage-days','⏳ ');days.append(duration(stage.days,state));
   summary.append(heading,make('p','sp-branch',stage.branch||'—'),dates,days);
   const details=make('div','sp-details'),table=make('table','sp-activities'),cols=make('colgroup');
   for(const width of [5,20,15,18,12,12,8,10]){const col=make('col');col.style.width=`${width}%`;cols.append(col);}
   const head=make('thead'),titles=make('tr');for(const label of HEADERS){const th=make('th','',label);th.scope='col';titles.append(th);}head.append(titles);
   const body=make('tbody');table.append(cols,head,body);
   stage.rows.forEach((row,index)=>{
    const rowTone=tone(row.status),tr=make('tr');tr.dataset.tone=rowTone;
    for(const [cls,value] of [['number',index+1],['activity',row.activity||'—'],['property',row.property||'—'],['supplier',row.supplier||'—'],['start',formatOperationsDate(row.executionDate)],['end',formatOperationsDate(row.plannedDate)]])tr.append(make('td',`sp-${cls}`,String(value)));
    const elapsed=calendarDays(row.executionDate,key(row.status)==='ATIVIDADE FINALIZADA'?row.plannedDate:today),day=make('td');day.append(duration(elapsed,rowTone==='success'?'success':rowTone==='info'?'info':'danger'));tr.append(day);
    const status=make('td','sp-status',rowTone==='success'?'✅':rowTone==='info'?'🔄':'❌');status.setAttribute('aria-label',row.status||'Status não informado');status.title=row.status||'Status não informado';tr.append(status);body.append(tr);
   });
   details.append(table,make('p','sp-total',`Total de registros nesta etapa: ${stage.rows.length}`));card.append(summary,details);results.append(card);
  }
  if(!result.stages.length)showNotice('Nenhuma etapa ou atividade corresponde aos filtros selecionados.');
 }
 function populate(){
  pickers?.destroy();pickers=null;
  for(const [name] of FILTERS){
   const select=controls.get(name),current=select.value;
   const source=name==='launchStatus'?snapshot.launches:['branch','stage'].includes(name)?[...snapshot.activities,...snapshot.launches]:snapshot.activities;
   const field=name==='launchStatus'?'status':name;
   const unique=[...new Set([...source.map(r=>r[field]),current].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
   select.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));for(const value of unique)select.append(Object.assign(make('option','',value),{value}));select.value=current;
  }
  pickers=bindSearchableFilterSelects(filters,{placement:'below'});
 }
 async function load(){
  if(root.hidden||portrait()||destroyed)return;
  pickers?.close();controller?.abort();const current=++revision,active=new AbortController();controller=active;snapshot=null;content.replaceChildren();showNotice('Carregando etapas e atividades do SharePoint…');report.setAttribute('aria-busy','true');refresh.disabled=true;
  try{
   const result=await data.loadSnapshot({signal:active.signal});
   if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;
   buildStageProgress(result,{},localDate(now()));snapshot=result;populate();render();
  }catch(error){if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;snapshot=null;content.replaceChildren();showNotice('Não foi possível carregar as etapas e atividades. Use Atualizar para tentar novamente.');}
  finally{if(current===revision){report.setAttribute('aria-busy','false');refresh.disabled=false;}}
 }
 function orientationChanged(){
  if(root.hidden)return;const vertical=portrait();warning.hidden=!vertical;panel.classList.toggle('pl-dialog--portrait',vertical);
  if(vertical){pickers?.close();if(report.contains(doc.activeElement))panel.focus();controller?.abort();revision++;snapshot=null;content.replaceChildren();report.hidden=true;}
  else if(report.hidden){report.hidden=false;void load();}
 }
 function close(){if(root.hidden)return;controller?.abort();revision++;snapshot=null;pickers?.close();content.replaceChildren();root.hidden=true;doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;returnFocus?.focus?.();returnFocus=null;}
 root.addEventListener('click',e=>{if(e.target===root)close();});
 root.addEventListener('keydown',e=>{
  if(root.hidden)return;if(e.key==='Escape'){e.preventDefault();close();return;}if(e.key!=='Tab')return;
  const nodes=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(n=>!n.disabled&&!n.closest('[hidden]')&&n.tabIndex>=0),first=nodes[0],last=nodes.at(-1);
  if(e.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){e.preventDefault();first?.focus();}
 });
 for(const node of controls.values())node.addEventListener('change',()=>{render();content.scrollTop=0;});
 refresh.addEventListener('click',()=>void load());win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
 return Object.freeze({element:root,async open(){
  if(destroyed)throw new Error('O relatório de etapas foi encerrado.');if(!root.hidden)return;
  returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;doc.body.style.overflow='hidden';if(app)app.inert=true;
  pickers?.destroy();pickers=null;
  for(const [name,node] of controls){const value=name==='launchStatus'?'INICIADO':name==='status'?'ATIVIDADE INICIADA':'';node.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));if(value)node.append(Object.assign(make('option','',value),{value}));node.value=value;}
  root.hidden=false;const vertical=portrait();warning.hidden=!vertical;report.hidden=vertical;panel.classList.toggle('pl-dialog--portrait',vertical);panel.focus();if(!vertical)await load();
 },close,destroy(){if(destroyed)return;close();destroyed=true;pickers?.destroy();win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);root.remove();}});
}
