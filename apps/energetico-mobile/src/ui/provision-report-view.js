import { buildProvisionReport } from '../chat/provision-report-model.js';
import { formatReportDate, formatReportMoney } from '../chat/contractor-report-model.js';
import { provisionDateKey, provisionDueState } from '../chat/pending-provision-dates.js';
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';

const LOGO = new URL('../../../../assets/logo-energetica-oficial.png', import.meta.url).href;
const FIELDS = [['branch','FILIAL'],['supplier','FORNECEDOR'],['product','PRODUTO'],['paymentStatus','STATUS PAGAMENTOS'],['recurrenceStatus','STATUS']];
const MONTHS = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
const money = value => Number.isFinite(value) ? formatReportMoney(value) : 'INCOMPLETO';
const daysBetween = (start,end) => Math.round((Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86400000);
const upper = value => String(value || '').trim().toLocaleUpperCase('pt-BR');

export function createProvisionReportView({document:doc=globalThis.document,data,now=()=>new Date()}={}) {
  if (!doc?.body || typeof data?.loadProvisionReportSnapshot !== 'function') throw new TypeError('O relatório de provisões requer documento e sessão SharePoint.');
  const win=doc.defaultView;
  const make=(tag,className='',text)=>{const node=doc.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const button=(className,text,label)=>{const node=make('button',className,text);node.type='button';node.setAttribute('aria-label',label);return node;};
  const root=make('div','pl-overlay pr-overlay');root.hidden=true;
  const panel=make('section','pl-dialog pr-dialog');panel.tabIndex=-1;
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Provisões de pagamento e despesas recorrentes');
  const warning=make('p','pl-orientation','PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');warning.setAttribute('role','status');
  const report=make('div','pl-report pr-report');report.hidden=true;
  const filters=make('div','pl-filters pr-filters');
  const refresh=button('pl-refresh','⟳','Atualizar relatório de provisões');filters.append(refresh);
  const controls=new Map();
  for(const [name,label] of FIELDS){const holder=make('label','pl-filter');holder.append(make('span','pl-filter-label',label));
    const select=make('select');select.name=name;select.setAttribute('aria-label',label);select.append(Object.assign(make('option','','Todos'),{value:''}));
    holder.append(select);filters.append(holder);controls.set(name,select);}
  const notice=make('p','pl-notice');notice.hidden=true;notice.setAttribute('role','status');
  const content=make('div','pl-table-scroll pr-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Tabelas de provisões e recorrências');
  report.append(filters,notice,content);panel.append(warning,report);root.append(panel);doc.body.append(root);
  let snapshot=null,controller=null,revision=0,pickers=null,destroyed=false,returnFocus=null,oldOverflow='',app=null,oldInert=false;
  const portrait=()=>win?.matchMedia?win.matchMedia('(orientation: portrait)').matches:win?.innerHeight>win?.innerWidth;
  const showNotice=text=>{notice.textContent=text;notice.hidden=!text;};
  const selected=()=>Object.fromEntries([...controls].map(([name,node])=>[name,node.value]));
  function cell(tr,column,text,className=''){const td=make('td',className,String(text??'').trim()||'—');td.dataset.column=column;tr.append(td);return td;}
  function textLine(parent,text,className=''){const line=make('div',className,text);parent.append(line);return line;}
  function statusLine(parent,text,tone,className='',textClass=''){
    const line=make('div',`pr-status-line ${className}`);line.dataset.statusTone=tone;
    const dot=make('span',`pr-status-dot pr-status-dot--${tone}`);dot.setAttribute('aria-hidden','true');
    line.append(dot,make('span',textClass,text));parent.append(line);return line;
  }
  function datedLine(parent,label,date,className=''){
    const line=make('div',className);line.append(doc.createTextNode(`${label} `),make('span','pr-date pr-nowrap',`(${formatReportDate(date)})`));parent.append(line);
  }
  function table(section,title,labels,widths){
    const scroll=make('div','pr-section-scroll');scroll.dataset.section=section;scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label',title.replace(/^[^\p{L}]+/u,''));
    const table=make('table',`pr-table pr-table--${section}`);table.dataset.section=section;
    const columns=make('colgroup');for(const width of widths){const col=make('col');col.style.width=`${width}%`;columns.append(col);}table.append(columns);
    const head=make('thead'),titleRow=make('tr'),heading=make('th','pr-section-title',title);heading.colSpan=labels.length;titleRow.append(heading);head.append(titleRow);
    const headings=make('tr');for(const label of labels){const th=make('th','',label);th.scope='col';headings.append(th);}head.append(headings);
    const body=make('tbody');table.append(head,body);scroll.append(table);content.append(scroll);return body;
  }
  function footer(body,label,colSpan,value,metric,lastText,lastMetric){
    const tr=make('tr','pr-total'),heading=cell(tr,'label',label);heading.colSpan=colSpan;
    const total=cell(tr,'total',value);total.dataset.metric=metric;
    if(lastText!==undefined){const last=cell(tr,'count',lastText);last.dataset.metric=lastMetric;}body.append(tr);
  }
  function scheduling(td,row,today){
    td.replaceChildren();const schedule=upper(row.schedule);
    if(schedule==='PAGO')statusLine(td,'PAGO','green','pr-green');
    else if(schedule==='PENDENTE')statusLine(td,'PENDENTE','red','pr-red');
    else if(schedule==='PAGAMENTO AGENDADO'||schedule==='AGENDADO'){
      statusLine(td,'AGENDADO','orange','pr-orange');
      if(row.scheduledDate)textLine(td,`(${formatReportDate(row.scheduledDate)})`,'pr-date pr-nowrap pr-orange');
      if(row.executionDate){const days=daysBetween(today,row.executionDate);datedLine(td,'PGTO AGENDADO PARA',row.executionDate,'pr-green');
        const tone=days<2?'red':days<5?'orange':'green';statusLine(td,`- EM ${days} ${days===1?'DIA':'DIAS'}`,tone,`pr-badge pr-badge--${tone}`);}
    } else textLine(td,row.schedule||'-','pr-muted');
  }
  function render(){
    content.replaceChildren();showNotice('');if(!snapshot)return;
    const today=provisionDateKey(now()),result=buildProvisionReport(snapshot,selected(),today);
    const logoFrame=make('div','pr-logo'),logo=make('img');logo.src=LOGO;logo.alt='Logo Energética';logoFrame.append(logo);content.append(logoFrame);
    const body=table('provisions','⚠ DESPESAS RECORRENTES – PROVISÃO DE PAGAMENTOS',['FILIAL','FORNECEDOR','PRODUTO','DATA VENCIMENTO','AGENDAMENTO','VALOR','STATUS'],[10,15,28,11,15,10,11]);
    for(const row of result.rows){const tr=make('tr');tr.dataset.id=row.id;
      cell(tr,'branch',row.branch,'pr-bold');cell(tr,'supplier',row.supplier,'pr-bold');cell(tr,'product',`${row.product}${row.observation?` (${row.observation})`:''}`,'pr-bold');
      const dueCell=cell(tr,'dueDate','','pr-red pr-bold');dueCell.replaceChildren();textLine(dueCell,formatReportDate(row.dueDate),'pr-date pr-nowrap');
      scheduling(cell(tr,'schedule',''),row,today);cell(tr,'total',money(row.total),'pr-bold pr-money');
      const status=cell(tr,'status','');status.replaceChildren();const paid=upper(row.status)==='PAGAMENTO EFETUADO',statusTone=paid?'green':upper(row.status)==='PENDENTE'?'orange':'red';
      if(paid)statusLine(status,row.status,'green','pr-green');else textLine(status,row.status||'—',`pr-${statusTone}`);
      const due=provisionDueState(row.dueDate,today),dueTone=due.kind==='unknown'?'muted':row.dueDate<today?'red':row.dueDate===today?'yellow':'green';
      statusLine(status,due.label,dueTone,`pr-${dueTone}`);body.append(tr);}
    footer(body,'TOTAL DE PROVISÕES COM PAGAMENTO PENDENTE',5,money(result.pendingTotal),'pendingTotal',`${result.pendingCount} pendência(s)`,'pendingCount');
    const hint=make('p','pr-scroll-hint','Deslize para os lados para ver os meses e o total.');hint.dataset.reportScreenOnly='';content.append(hint);
    const annual=table('annual','📊 RELATÓRIO ANUAL – PROVISÃO DE PAGAMENTOS',['FORNECEDOR',...MONTHS,'TOTAL'],[16,...MONTHS.map(()=>6.25),9]);
    for(const group of result.annual){const tr=make('tr');tr.dataset.recurrenceId=group.recurrenceId;
      const supplier=cell(tr,'supplier',`${group.supplier} - ${group.property||'-'} ( ID: ${group.recurrenceId})`,'pr-bold');
      if(group.inactivePending)statusLine(supplier,'INATIVO COM PROVISÃO PENDENTE','orange','pr-badge pr-badge--orange');
      for(const month of group.months){const td=cell(tr,'month','');td.dataset.month=month.month;td.replaceChildren();
        if(group.startDate&&Number(group.startDate.slice(5,7))===month.month){const started=make('div','pr-event pr-badge pr-badge--purple');statusLine(started,'INICIADO:','purple');textLine(started,formatReportDate(group.startDate),'pr-date pr-nowrap');td.append(started);}
        for(const row of month.paid){const event=make('div','pr-event');textLine(event,money(row.total),'pr-money pr-nowrap pr-green pr-bold');statusLine(event,formatReportDate(row.paidDate),'green','','pr-date pr-nowrap');td.append(event);}
        for(const row of month.pending){const event=make('div','pr-event');textLine(event,formatReportDate(row.dueDate),'pr-date pr-nowrap pr-orange pr-bold');const days=daysBetween(today,row.dueDate),tone=days<0?'red':'orange';statusLine(event,days<0?`ATR. ${-days}d`:`EM ${days}d`,tone,`pr-${tone} pr-bold`,'pr-nowrap');td.append(event);}
        if(month.nextDate){const next=make('div','pr-event pr-badge pr-badge--blue');statusLine(next,'PRÓX','blue');textLine(next,formatReportDate(month.nextDate).slice(0,5),'pr-date pr-nowrap');td.append(next);}}
      cell(tr,'total',money(group.paidTotal),'pr-red pr-bold pr-money');annual.append(tr);}
    footer(annual,'TOTAL DE DESPESAS RECORRENTES EXIBIDAS NO RELATÓRIO ANUAL',13,result.annualCount,'annualCount');
    const inactive=table('inactive','🛑 DESPESAS RECORRENTES COM STATUS INATIVO MODIFICADAS NOS ÚLTIMOS 30 DIAS',['ID','FILIAL','FORNECEDOR','PRODUTO','IMÓVEL','STATUS','DATA MODIFICAÇÃO','DIAS MODIFICADO'],[5,13,18,24,13,9,11,7]);
    for(const row of result.inactiveRecent){const tr=make('tr');cell(tr,'id',row.id,'pr-bold');cell(tr,'branch',row.branch,'pr-bold');cell(tr,'supplier',row.supplier,'pr-bold');cell(tr,'product',row.product);cell(tr,'property',row.property);cell(tr,'status',row.status,'pr-red pr-bold');
      const timestamp=new Date(row.modified);const formatted=Number.isFinite(timestamp.getTime())?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(timestamp):formatReportDate(row.modified);
      cell(tr,'modified',formatted,'pr-red pr-bold');const days=daysBetween(provisionDateKey(row.modified),today);cell(tr,'days',`${days} dia(s)`,days<=7?'pr-red pr-bold':'pr-orange pr-bold');inactive.append(tr);}
    if(!result.inactiveRecent.length){const tr=make('tr'),td=cell(tr,'empty','✅ Nenhuma despesa recorrente com status INATIVO foi modificada nos últimos 30 dias.','pr-green pr-empty');td.colSpan=8;inactive.append(tr);}
    footer(inactive,'TOTAL DE DESPESAS RECORRENTES COM STATUS INATIVO',7,result.inactiveCount,'inactiveCount');
    if(result.incompleteCount)showNotice(`${result.incompleteCount} provisão(ões) com valores incompletos. Totais afetados aparecem como INCOMPLETO.`);
    else if(!result.rows.length&&!result.annual.length)showNotice('Nenhuma provisão corresponde aos filtros.');
  }
  function populate(){
    pickers?.destroy();pickers=null;
    for(const [name] of FIELDS){const control=controls.get(name),current=control.value;
      const values=name==='paymentStatus'?snapshot.provisions.map(row=>row.status):name==='recurrenceStatus'?['ATIVO','INATIVO',...snapshot.recurrences.map(row=>row.status)]:[...snapshot.provisions,...snapshot.recurrences].map(row=>row[name]);
      const unique=[...new Set([...values,current].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
      control.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));for(const value of unique)control.append(Object.assign(make('option','',value),{value}));
      control.value=unique.includes(current)?current:'';}
    pickers=bindSearchableFilterSelects(filters,{placement:'below',report:true});
  }
  async function load(){
    if(root.hidden||portrait()||destroyed)return;pickers?.close();controller?.abort();const current=++revision,active=new AbortController();controller=active;snapshot=null;content.replaceChildren();
    showNotice('Carregando provisões do SharePoint…');report.setAttribute('aria-busy','true');refresh.disabled=true;
    try{const result=await data.loadProvisionReportSnapshot({signal:active.signal});
      if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;
      if(!Array.isArray(result?.provisions)||!Array.isArray(result?.recurrences))throw new Error('O SharePoint retornou dados incompletos para o relatório de provisões.');
      snapshot=result;populate();render();
    }catch(error){if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;content.replaceChildren();showNotice(`Não foi possível carregar o relatório. Use Atualizar para tentar novamente. ${String(error?.message||'Falha na consulta.').replace(/https?:\/\/\S+/gi,'endereço SharePoint').replace(/Bearer\s+\S+/gi,'[oculto]').slice(0,240)}`);
    }finally{if(current===revision){report.setAttribute('aria-busy','false');refresh.disabled=false;}}
  }
  function orientationChanged(){
    if(root.hidden)return;const vertical=portrait();warning.hidden=!vertical;panel.classList.toggle('pl-dialog--portrait',vertical);
    if(vertical){pickers?.close();if(report.contains(doc.activeElement))panel.focus();controller?.abort();revision++;snapshot=null;content.replaceChildren();report.hidden=true;}
    else if(report.hidden){report.hidden=false;void load();}
  }
  function close(){if(root.hidden)return;controller?.abort();revision++;snapshot=null;pickers?.close();content.replaceChildren();root.hidden=true;doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;returnFocus?.focus?.();returnFocus=null;}
  root.addEventListener('click',event=>{if(event.target===root)close();});
  root.addEventListener('keydown',event=>{
    if(root.hidden)return;if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key!=='Tab')return;
    const nodes=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(node=>!node.disabled&&!node.closest('[hidden]')&&node.tabIndex>=0),first=nodes[0],last=nodes.at(-1);
    if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){event.preventDefault();first?.focus();}
  });
  for(const control of controls.values())control.addEventListener('change',()=>{render();content.scrollTop=0;});
  refresh.addEventListener('click',()=>{void load();});
  win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
  return Object.freeze({element:root,async open(){
    if(destroyed)throw new Error('O relatório de provisões foi encerrado.');if(!root.hidden)return;
    returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;doc.body.style.overflow='hidden';if(app)app.inert=true;
    pickers?.destroy();pickers=null;for(const [name] of FIELDS){const control=controls.get(name),value=name==='paymentStatus'?'PAGAMENTO PREVISTO':name==='recurrenceStatus'?'ATIVO':'';
      control.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));if(value)control.append(Object.assign(make('option','',value),{value}));control.value=value;}
    root.hidden=false;const vertical=portrait();warning.hidden=!vertical;report.hidden=vertical;panel.classList.toggle('pl-dialog--portrait',vertical);panel.focus();if(!vertical)await load();
  },close,destroy(){if(destroyed)return;close();destroyed=true;pickers?.destroy();win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);root.remove();}});
}
