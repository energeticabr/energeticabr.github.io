import {buildAttendanceSummary} from '../chat/attendance-summary-model.js';
import {formatReportDate,formatReportMoney} from '../chat/contractor-report-model.js';
import {bindSearchableFilterSelects} from './searchable-filter-selects.js';

const FILTERS=[['branch','FILIAL'],['supplierStatus','STATUS FORNECEDOR'],['supplier','FORNECEDOR'],['presence','PRESENÇA']];
const METRICS=[['pending','⚠ PENDENTES'],['present','✅ PRESENTES'],['absent','❌ AUSENTES'],['total','💰 TOTAL VLR DIÁRIO FILTRADO']];
const FINANCIAL=[['pendingApproval','⏳ PENDENTE APROVAÇÃO'],['approvedPayment','🟠 APROVADO PGTO'],['paid','✅ PAGO'],['total','💰 TOTAL']];
const money=value=>Number.isFinite(value)?formatReportMoney(value):'INCOMPLETO';
const dateKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export function createAttendanceSummaryReportView({document:doc=globalThis.document,data,now=()=>new Date()}={}){
 if(!doc?.body||typeof data?.loadSnapshot!=='function')throw new TypeError('O resumo de presenças requer documento e sessão SharePoint.');
 const win=doc.defaultView;
 const make=(tag,cls='',text)=>{const n=doc.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const button=(cls,text)=>Object.assign(make('button',cls,text),{type:'button'});
 const root=make('div','pl-overlay as-overlay');root.hidden=true;
 const panel=make('section','pl-dialog as-dialog');panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Resumo de presenças e ausências');
 const warning=make('p','pl-orientation','PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');warning.setAttribute('role','status');
 const report=make('div','pl-report as-report');report.hidden=true;
 const filters=make('div','pl-filters as-filters'),controls=new Map(),displays=new Map();
 const refresh=button('pl-refresh','⟳');refresh.setAttribute('aria-label','Atualizar resumo de presenças');filters.append(refresh);
 const dates=make('div','pl-dates');dates.append(make('span','pl-filter-label','PERÍODO'));
 const dateFields=make('div','pl-date-fields');dates.append(dateFields);filters.append(dates);
 for(const [name,label] of [['startDate','Data inicial'],['endDate','Data final']]){
  const holder=make('div','pl-date'),native=make('input','pl-date-native'),display=make('input','pl-date-display'),calendar=button('pl-date-calendar','▦');
  native.type='date';native.name=name;native.tabIndex=-1;native.setAttribute('aria-label',`Calendário: ${label}`);
  display.type='text';display.inputMode='numeric';display.maxLength=10;display.dataset.dateDisplay=name;display.setAttribute('aria-label',label);display.placeholder=name==='startDate'?'Desde o início':'Até o fim';
  calendar.setAttribute('aria-label',`Abrir calendário: ${label}`);
  calendar.addEventListener('click',()=>{try{if(native.showPicker)native.showPicker();else native.focus();}catch{native.focus();}});
  display.addEventListener('change',()=>{
   const text=display.value.trim(),match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text),iso=match?`${match[3]}-${match[2]}-${match[1]}`:'';
   const parsed=new Date(`${iso}T12:00:00Z`);
   const valid=!text||(match&&Number(match[3])>=1000&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===iso);
   display.setCustomValidity(valid?'':'Data inválida. Use dd/mm/yyyy.');
   if(valid)native.value=iso;
   render();content.scrollTop=0;
  });
  native.addEventListener('change',()=>{display.value=formatReportDate(native.value);if(!native.value)display.value='';display.setCustomValidity('');render();content.scrollTop=0;});
  holder.append(display,calendar,native);dateFields.append(holder);controls.set(name,native);displays.set(name,display);
 }
 for(const [name,label] of FILTERS){
  const holder=make('label','pl-filter'),select=make('select');select.name=name;select.setAttribute('aria-label',label);holder.append(make('span','pl-filter-label',label),select);filters.append(holder);controls.set(name,select);
 }
 const notice=make('p','pl-notice');notice.hidden=true;notice.setAttribute('role','status');
 const content=make('div','pl-table-scroll as-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Resumo por profissão e detalhamento diário');
 report.append(filters,notice,content);panel.append(warning,report);root.append(panel);doc.body.append(root);
 let snapshot=null,controller=null,revision=0,pickers=null,destroyed=false,returnFocus=null,oldOverflow='',app=null,oldInert=false;
 const portrait=()=>win?.matchMedia?win.matchMedia('(orientation: portrait)').matches:win?.innerHeight>win?.innerWidth;
 const showNotice=text=>{notice.textContent=text;notice.hidden=!text;};
 const selected=()=>Object.fromEntries([...controls].map(([name,node])=>[name,node.value]));
 function financial(values){
  const table=make('table','as-financial'),body=make('tbody');
  for(const [key,label] of FINANCIAL){const row=make('tr',`as-financial--${key}`);row.append(make('td','',label),make('td','',money(values[key])));body.append(row);}
  table.append(body);return table;
 }
 function people(td,rows,empty,paid=false){
  if(!rows.length){td.append(make('span','as-empty',empty));return;}
  for(const row of rows){
   const person=make('div',paid&&row.count>1?'as-person as-duplicate':'as-person');person.append(make('strong','',row.name));
   if(paid&&row.count>1)person.append(make('span','as-count',`${row.count}X`));
   if(paid)for(const badge of row.paymentBadges||[])person.append(make('span',badge==='PENDENTE PGTO'?'as-badge as-badge--pending':'as-badge as-badge--paid',badge));
   td.append(person);
  }
 }
 function render(){
  content.replaceChildren();showNotice('');if(!snapshot)return;
  if([...displays.values()].some(input=>!input.checkValidity())){showNotice('Data inválida. Use dd/mm/yyyy.');return;}
  const values=selected();
  if(values.startDate&&values.endDate&&values.startDate>values.endDate){showNotice('A data inicial não pode ser posterior à data final.');return;}
  const result=buildAttendanceSummary(snapshot,values);
  const heading=make('header','as-heading');heading.append(make('h1','','📊 RESUMO DE PRESENÇAS E AUSÊNCIAS — PERÍODO FILTRADO'),make('p','',`${values.startDate?formatReportDate(values.startDate):'Desde o início'} até ${values.endDate?formatReportDate(values.endDate):'o fim'}`));content.append(heading);
  const metrics=make('div','as-metrics');
  for(const [key,label] of METRICS){const card=make('div',`as-metric as-metric--${key}`),value=make('strong','',key==='total'?money(result.summary[key]):String(result.summary[key]));value.dataset.metric=key;card.append(make('span','',label),value);metrics.append(card);}
  content.append(metrics);
  const professions=make('section','as-professions');professions.append(make('h2','','👷 PROFISSÕES TOTAIS NA SEMANA / PERÍODO FILTRADO'));
  const grid=make('div','as-profession-grid');professions.append(grid);content.append(professions);
  if(!result.professions.length)grid.append(make('p','as-empty','SEM REGISTROS PRESENTES OU PENDENTES NO PERÍODO'));
  for(const profession of result.professions){
   const card=make('article',`as-profession as-tone--${profession.tone}`);
   card.append(make('h3','',`${profession.emoji||''} ${profession.name}`),make('p','as-count-label',`${profession.professionalCount} PROFISSIONAIS • ${profession.recordCount} REGISTROS`));
   for(const provider of profession.providers){
    const person=make('section',`as-provider as-tone--${provider.tone}`),name=make('h4','',provider.name);name.append(make('span','as-count',`${provider.recordCount}X`));
    person.append(name,make('p','as-presence-counts',`✅ ${provider.present} PRESENTE(S) • ⏳ ${provider.pending} PENDENTE(S)`),financial(provider.financial));card.append(person);
   }
   card.append(make('h4','as-profession-total','RESUMO GERAL DA PROFISSÃO'),financial(profession.financial));grid.append(card);
  }
  const table=make('table','as-daily'),cols=make('colgroup');for(const width of [10,12,18,18,18,14,10]){const col=make('col');col.style.width=`${width}%`;cols.append(col);}
  const head=make('thead'),titles=make('tr');for(const label of ['📅 DATA','🏢 FILIAL','⚠ PENDENTES','✅ PRESENTES','❌ AUSENTES','👷 QTD POR PROFISSÃO (somente presentes)','💰 TOTAL DO DIA']){const th=make('th','',label);th.scope='col';titles.append(th);}head.append(titles);
  const body=make('tbody');table.append(cols,head,body);content.append(table);
  for(const day of result.days){
   const dayHeader=make('tr','as-day-heading'),dayCell=make('th','',`📅 ${formatReportDate(day.date)} — ${day.weekday}`);dayCell.colSpan=7;dayCell.scope='rowgroup';dayHeader.append(dayCell);body.append(dayHeader);
   for(const branch of day.branches){
    const tr=make('tr');tr.dataset.date=day.date;
    const date=make('td',day.weekend?'as-weekend':'as-date',`${formatReportDate(day.date)} (${day.weekday})`);tr.append(date,make('td','as-branch',branch.branch));
    for(const [key,empty] of [['pending','SEM PENDENTES'],['present','SEM PRESENTES'],['absent','SEM AUSENTES']]){const td=make('td',`as-category as-category--${key}`);people(td,branch[key],empty,key==='present');tr.append(td);}
    const professions=make('td','as-daily-professions');for(const p of branch.professions)professions.append(make('div','',`${p.emoji||''} ${p.name}: ${p.count}`));if(!branch.professions.length)professions.textContent='SEM PRESENTES';tr.append(professions,make('td','as-day-total',money(branch.total)));body.append(tr);
   }
  }
  if(!result.rows.length)showNotice('Nenhuma presença corresponde aos filtros selecionados.');
 }
 function populate(){
  pickers?.destroy();pickers=null;
  for(const [name] of FILTERS){
   const select=controls.get(name),current=select.value;
   const values=name==='supplierStatus'?['ATIVO','INATIVO',...snapshot.suppliers.map(r=>r.status)]:name==='presence'?['PENDENTE','PRESENTE','AUSENTE']:snapshot.presences.map(r=>r[name]);
   const unique=[...new Set([...values,current].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
   select.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));for(const value of unique)select.append(Object.assign(make('option','',value),{value}));select.value=current;
  }
  pickers=bindSearchableFilterSelects(filters,{placement:'below'});
 }
 async function load(){
  if(root.hidden||portrait()||destroyed)return;
  pickers?.close();controller?.abort();const current=++revision,active=new AbortController();controller=active;snapshot=null;content.replaceChildren();showNotice('Carregando presenças e fornecedores do SharePoint…');report.setAttribute('aria-busy','true');refresh.disabled=true;
  try{
   const result=await data.loadSnapshot({signal:active.signal});
   if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;
   if(!Array.isArray(result?.presences)||!Array.isArray(result?.suppliers))throw new Error('Dados incompletos para o resumo de presenças.');
   snapshot=result;populate();render();
  }catch(error){if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;snapshot=null;content.replaceChildren();showNotice('Não foi possível carregar o resumo de presenças. Use Atualizar para tentar novamente.');}
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
 for(const [name,node] of controls)if(!displays.has(name))node.addEventListener('change',()=>{render();content.scrollTop=0;});
 refresh.addEventListener('click',()=>void load());win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
 return Object.freeze({element:root,async open(){
  if(destroyed)throw new Error('O resumo de presenças foi encerrado.');if(!root.hidden)return;
  returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;doc.body.style.overflow='hidden';if(app)app.inert=true;
  pickers?.destroy();pickers=null;const end=now(),start=new Date(end.getTime());start.setDate(start.getDate()-14);
  for(const [name,node] of controls){
   if(displays.has(name)){node.value=dateKey(name==='startDate'?start:end);displays.get(name).value=formatReportDate(node.value);displays.get(name).setCustomValidity('');}
   else{const value=name==='supplierStatus'?'ATIVO':'';node.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));if(value)node.append(Object.assign(make('option','',value),{value}));node.value=value;}
  }
  root.hidden=false;const vertical=portrait();warning.hidden=!vertical;report.hidden=vertical;panel.classList.toggle('pl-dialog--portrait',vertical);panel.focus();if(!vertical)await load();
 },close,destroy(){if(destroyed)return;close();destroyed=true;pickers?.destroy();win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);root.remove();}});
}
