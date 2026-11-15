import { bindReportLandscape } from './report-landscape.js';
import { addReportCloseControl } from './report-close-control.js';
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
 const landscape = bindReportLandscape(root);
 const canFinalize=typeof data.loadLatestAssignmentDate==='function'&&typeof data.finalizeActivity==='function';
 const canFinalizeStage=typeof data.finalizeStage==='function';
 const finishOverlay=make('div','sp-finish-overlay');finishOverlay.hidden=true;
 finishOverlay.setAttribute('role','dialog');finishOverlay.setAttribute('aria-modal','true');
 finishOverlay.setAttribute('aria-label','Finalizar atividade');
 const finishForm=make('form','sp-finish-form');finishForm.tabIndex=-1;
 const finishHeading=make('h2','','Finalizar atividade'),finishSubject=make('p','sp-finish-activity');
 const finishDate=make('input');finishDate.type='date';finishDate.required=true;finishDate.disabled=true;
 const finishLabel=make('label','','Data fim');finishLabel.append(finishDate);
 const finishNotice=make('p','sp-finish-notice');finishNotice.setAttribute('role','status');finishNotice.hidden=true;
 const finishCancel=make('button','','CANCELAR');finishCancel.type='button';
 const finishSubmit=make('button','sp-finish-button','SUBMETER');finishSubmit.type='submit';
 const finishActions=make('div','sp-finish-actions');finishActions.append(finishCancel,finishSubmit);
 finishForm.append(finishHeading,finishSubject,finishLabel,finishNotice,finishActions);
 finishOverlay.append(finishForm);root.append(finishOverlay);
 let finishing=null;
  addReportCloseControl({root, toolbar:filters, onClose:close});
 const showNotice=text=>{notice.textContent=text;notice.hidden=!text;};
 const selected=()=>Object.fromEntries([...controls].map(([name,node])=>[name,node.value]));
 function finishMessage(text){
  finishNotice.textContent=text;finishNotice.hidden=!text;
 }
 function closeFinish(restoreFocus=true){
  if(!finishing)return;
  const {controller,trigger}=finishing;
  finishing=null;controller.abort();finishDate.disabled=true;finishOverlay.hidden=true;panel.inert=false;
  if(restoreFocus)trigger.focus();
 }
 async function openFinish(row,trigger,{stage=false,suggestion='',draftDate=''}={}){
  if(finishing)return;
  const active={row,trigger,stage,controller:new AbortController(),saving:false};
  finishing=active;pickers?.close();panel.inert=true;finishOverlay.hidden=false;
  const title=stage?'Finalizar etapa':'Finalizar atividade';
  finishHeading.textContent=title;finishOverlay.setAttribute('aria-label',title);
  finishSubject.textContent=stage?`${row.stage} · ${row.branch}`:row.activity;
  const loading=!stage&&!draftDate;
  finishDate.value=draftDate||suggestion;finishDate.disabled=loading;finishSubmit.disabled=loading;finishCancel.disabled=false;
  finishMessage(loading?'Buscando a última data de atribuição…':stage&&!finishDate.value?'Informe a data fim da etapa.':'');
  finishForm.focus();
  if(!loading)return;
  try{
   const date=await data.loadLatestAssignmentDate(row.id,{signal:active.controller.signal});
   if(finishing!==active)return;
   finishDate.value=date;
   finishMessage(date?'':'Nenhuma atribuição com data foi encontrada. Informe a data fim.');
  }catch{
   if(finishing!==active)return;
   finishMessage('Não foi possível consultar as atribuições. Informe a data fim.');
  }
  finishDate.disabled=false;finishSubmit.disabled=false;
 }
 finishCancel.addEventListener('click',()=>closeFinish());
 finishForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const active=finishing;
  if(!active||active.saving||finishDate.disabled||!finishForm.reportValidity())return;
  const date=finishDate.value;
  active.saving=true;finishDate.disabled=true;finishSubmit.disabled=true;finishCancel.disabled=true;
  finishMessage(active.stage?'Finalizando etapa…':'Finalizando atividade…');finishForm.focus();
  let saved;
  try{
   const signal=active.controller.signal;
   saved=active.stage
    ?await data.finalizeStage(active.row.id,date,{expectedStage:active.row,signal})
    :await data.finalizeActivity(active.row.id,date,{expectedActivity:active.row,signal});
  }catch(error){
   if(finishing!==active)return;
   active.saving=false;finishDate.disabled=false;finishSubmit.disabled=false;finishCancel.disabled=false;
   const subject=active.stage?'etapa':'atividade';
   if(error?.code==='stage_progress_incomplete')finishMessage('Ainda há descritivos pendentes ou a etapa ficou sem vínculos. Atualize o relatório.');
   else if(error?.status===412||error?.code==='stage_progress_changed')finishMessage(`A ${subject} mudou no SharePoint. Atualize o relatório para conferir.`);
   else finishMessage('Não foi possível confirmar a finalização. Confira a data e tente novamente.');
   finishSubmit.focus();
   return;
  }
  if(finishing!==active)return;
  closeFinish(false);
  const collection=active.stage?'launches':'activities';
  snapshot={...snapshot,[collection]:snapshot[collection].map(row=>String(row.id)===saved.id?saved:row)};
  populate();render();showNotice(active.stage?'Etapa finalizada.':'Atividade finalizada.');content.focus({preventScroll:true});
 });
 finishOverlay.addEventListener('keydown',event=>{
  if(!finishing)return;
  if(event.key==='Escape'){
   event.preventDefault();event.stopPropagation();
   if(!finishing.saving)closeFinish();
  }
  if(event.key!=='Tab')return;
  event.stopPropagation();
  const nodes=[finishDate,finishCancel,finishSubmit].filter(node=>!node.disabled);
  const index=nodes.indexOf(doc.activeElement);
  if(index===-1||event.shiftKey&&index===0||!event.shiftKey&&index===nodes.length-1){
   event.preventDefault();(event.shiftKey?nodes.at(-1):nodes[0])?.focus();
  }
 });
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
   if(canFinalizeStage){
    const finish=make('button','sp-finish-button sp-stage-finish','FINALIZAR');finish.type='button';
    finish.setAttribute('aria-label',`Finalizar etapa ${stage.stage}`);
    finish.disabled=!stage.completion.ready||!stage.launch?.branch||!stage.launch?.stage||key(stage.status)!=='INICIADO';
    finish.addEventListener('click',()=>void openFinish(stage.launch,finish,{stage:true,suggestion:stage.completion.latestDate}));
    summary.append(finish);
   }
   const details=make('div','sp-details'),table=make('table','sp-activities'),cols=make('colgroup');
   for(const width of [5,20,15,18,12,12,8,10]){const col=make('col');col.style.width=`${width}%`;cols.append(col);}
   const head=make('thead'),titles=make('tr');for(const label of HEADERS){const th=make('th','',label);th.scope='col';titles.append(th);}head.append(titles);
   const body=make('tbody');table.append(cols,head,body);
   stage.rows.forEach((row,index)=>{
    const rowTone=tone(row.status),tr=make('tr');tr.dataset.tone=rowTone;
    for(const [cls,value] of [['number',index+1],['activity',row.activity||'—'],['property',row.property||'—'],['supplier',row.supplier||'—'],['start',formatOperationsDate(row.executionDate)]])tr.append(make('td',`sp-${cls}`,String(value)));
    const end=make('td','sp-end');
    if(row.plannedDate||!canFinalize||key(row.status)!=='ATIVIDADE INICIADA')end.textContent=formatOperationsDate(row.plannedDate);
    if(canFinalize&&key(row.status)==='ATIVIDADE INICIADA'){
     const finish=make('button','sp-finish-button','FINALIZAR');finish.type='button';
     finish.setAttribute('aria-label',`Finalizar ${row.activity||'atividade'}`);
     finish.addEventListener('click',()=>void openFinish(row,finish));end.append(finish);
    }
    tr.append(end);
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
  pickers=bindSearchableFilterSelects(filters,{placement:'below',report:true});
 }
 async function load(refreshSnapshot=false){
  if(root.hidden||destroyed)return;
  pickers?.close();controller?.abort();const current=++revision,active=new AbortController();controller=active;snapshot=null;content.replaceChildren();showNotice('Carregando etapas e atividades do SharePoint…');report.setAttribute('aria-busy','true');refresh.disabled=true;
  try{
   const result=await data.loadSnapshot({signal:active.signal,refresh:refreshSnapshot});
   if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;
   buildStageProgress(result,{},localDate(now()));snapshot=result;populate();render();
  }catch(error){if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;snapshot=null;content.replaceChildren();showNotice('Não foi possível carregar as etapas e atividades. Use Atualizar para tentar novamente.');}
  finally{if(current===revision){report.setAttribute('aria-busy','false');refresh.disabled=false;}}
 }
 function orientationChanged() { landscape.update(); }
 function close(){if(root.hidden)return;closeFinish(false);controller?.abort();revision++;snapshot=null;pickers?.close();content.replaceChildren();root.hidden=true;doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;returnFocus?.focus?.();returnFocus=null;}
 root.addEventListener('click',e=>{if(e.target===root)close();});
 root.addEventListener('keydown',e=>{
  if(root.hidden||finishing)return;if(e.key==='Escape'){e.preventDefault();close();return;}if(e.key!=='Tab')return;
  const nodes=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(n=>!n.disabled&&!n.closest('[hidden]')&&n.tabIndex>=0),first=nodes[0],last=nodes.at(-1);
  if(e.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){e.preventDefault();first?.focus();}
 });
 for(const node of controls.values())node.addEventListener('change',()=>{render();content.scrollTop=0;});
 refresh.addEventListener('click',()=>void load(true));win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
 return Object.freeze({element:root,async open({finishDraft}={}){
  if(destroyed)throw new Error('O relatório de etapas foi encerrado.');if(!root.hidden)return;
  returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;doc.body.style.overflow='hidden';if(app)app.inert=true;
  pickers?.destroy();pickers=null;
  for(const [name,node] of controls){const value=name==='launchStatus'?'INICIADO':name==='status'?'ATIVIDADE INICIADA':'';node.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));if(value)node.append(Object.assign(make('option','',value),{value}));node.value=value;}
  root.hidden=false;landscape.update();warning.hidden=true;report.hidden=false;panel.classList.toggle('pl-dialog--portrait',false);panel.focus();await load();
  if(!snapshot||!finishDraft)return;
  if(finishDraft.kind==='stage'&&canFinalizeStage){
   const launch=snapshot.launches.find(row=>String(row.id)===finishDraft.id);
   const group=buildStageProgress(snapshot).stages.find(stage=>stage.launches.some(row=>row.id===finishDraft.id));
   if(launch&&group?.completion.ready&&key(launch.status)==='INICIADO'){
    await openFinish(launch,content,{stage:true,draftDate:finishDraft.date});
   }else showNotice('A etapa mudou. Confira a situação dos descritivos vinculados.');
  }else if(canFinalize&&finishDraft.kind!=='stage'){
   const row=snapshot.activities.find(row=>String(row.id)===finishDraft.id&&key(row.status)==='ATIVIDADE INICIADA');
   if(row)await openFinish(row,content,{draftDate:finishDraft.date});
  }
 },close,destroy(){if(destroyed)return;close();destroyed=true;pickers?.destroy();win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);landscape.destroy();root.remove();}});
}
