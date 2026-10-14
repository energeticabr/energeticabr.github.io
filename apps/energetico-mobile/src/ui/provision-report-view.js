import { bindReportLandscape } from './report-landscape.js';
import { addReportCloseControl } from './report-close-control.js';
import { buildProvisionReport, groupProvisionReportRows } from '../chat/provision-report-model.js';
import { formatReportDate, formatReportMoney } from '../chat/contractor-report-model.js';
import { provisionDateKey, provisionDueState } from '../chat/pending-provision-dates.js';
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';

const LOGO = new URL('../../../../assets/logo-energetica-oficial.png', import.meta.url).href;
const FIELDS = [['branch','FILIAL'],['supplier','FORNECEDOR'],['product','PRODUTO'],['paymentStatus','STATUS PAGAMENTOS'],['recurrenceStatus','STATUS']];
const MONTHS = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
const money = value => Number.isFinite(value) ? formatReportMoney(value) : 'INCOMPLETO';
const daysBetween = (start,end) => Math.round((Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86400000);
const upper = value => String(value || '').trim().toLocaleUpperCase('pt-BR');
let instanceSequence=0;

export function createProvisionReportView({document:doc=globalThis.document,data,now=()=>new Date()}={}) {
  if (!doc?.body || typeof data?.loadProvisionReportSnapshot !== 'function') throw new TypeError('O relatório de provisões requer documento e sessão SharePoint.');
  const win=doc.defaultView;
  const instance=++instanceSequence;
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
  const landscape = bindReportLandscape(root);
  addReportCloseControl({root, toolbar:filters, onClose:close});
  const showNotice=text=>{notice.textContent=text;notice.hidden=!text;};
  const selected=()=>Object.fromEntries([...controls].map(([name,node])=>[name,node.value]));
  function cell(tr,column,text,className=''){const td=make('td',className,String(text??'').trim()||'—');td.dataset.column=column;tr.append(td);return td;}
  function textLine(parent,text,className=''){const line=make('div',className,text);parent.append(line);return line;}
  function statusLine(parent,text,tone,className='',textClass='',showDot=true){
    const line=make('div',`pr-status-line ${className}`);line.dataset.statusTone=tone;
    if(showDot){const dot=make('span',`pr-status-dot pr-status-dot--${tone}`);dot.setAttribute('aria-hidden','true');line.append(dot);}
    line.append(make('span',textClass,text));parent.append(line);return line;
  }
  function datedLine(parent,label,date,className=''){
    const line=make('div',className);line.append(doc.createTextNode(`${label} `),make('span','pr-date pr-nowrap',`(${formatReportDate(date)})`));parent.append(line);
  }
  function fitAnnualTokens(){
    const annual=content.querySelector('.pr-table--annual');
    // clientWidth is the logical, unrotated cell width on the phone canvas.
    if(!annual?.clientWidth)return;
    const context=doc.createElement('canvas').getContext('2d');if(!context)return;
    for(const node of annual.querySelectorAll('.pr-nowrap,.pr-money')){
      node.style.removeProperty('font-size');
      const td=node.closest('td'),style=win.getComputedStyle(node),cellStyle=win.getComputedStyle(td);
      const available=td.clientWidth-parseFloat(cellStyle.paddingLeft)-parseFloat(cellStyle.paddingRight)-1;
      context.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const width=context.measureText(node.textContent).width;
      if(width>available&&available>0)node.style.fontSize=`${parseFloat(style.fontSize)*available/width}px`;
    }
  }
  function table(section,title,labels,widths){
    const scroll=make('div','pr-section-scroll');scroll.dataset.section=section;scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label',title.replace(/^[^\p{L}]+/u,''));
    if(section==='annual'){
      const toolbar=make('div','pr-annual-zoom-toolbar');toolbar.dataset.reportScreenOnly='';
      const less=button('','A−','Reduzir tabela anual'),more=button('','A+','Ampliar tabela anual');
      const fit=button('','Ajustar à tela','Ajustar tabela anual à tela');
      const level=make('output');level.setAttribute('aria-label','Ampliação da tabela anual');level.setAttribute('aria-live','polite');
      const hint=make('span','pr-annual-zoom-hint','Arraste para consultar a tabela ampliada.');
      let zoom=1;
      const update=()=>{
        scroll.style.setProperty('--pr-annual-zoom',String(zoom));level.textContent=`${zoom*100}%`;
        less.disabled=zoom===1;more.disabled=zoom===5;hint.hidden=zoom===1;
        if(zoom===1)scroll.scrollLeft=0;
        fitAnnualTokens();
      };
      less.addEventListener('click',()=>{zoom=Math.max(1,zoom-.5);update();});
      more.addEventListener('click',()=>{zoom=Math.min(5,zoom+.5);update();});
      fit.addEventListener('click',()=>{zoom=1;update();});
      toolbar.append(make('span','','Leitura da tabela anual'),less,level,more,fit,hint);scroll.append(toolbar);update();
    }
    const table=make('table',`pr-table pr-table--${section}`);table.dataset.section=section;
    table.setAttribute('role','table');
    const columns=make('colgroup');for(const width of widths){const col=make('col');col.style.width=`${width}%`;columns.append(col);}table.append(columns);
    const head=make('thead'),titleRow=make('tr'),heading=make('th','pr-section-title',title);heading.colSpan=labels.length;titleRow.append(heading);head.append(titleRow);
    const headings=make('tr');for(const label of labels){const th=make('th','',label);th.scope='col';headings.append(th);}head.append(headings);
    for(const row of head.rows){row.setAttribute('role','row');for(const th of row.cells)th.setAttribute('role','columnheader');}
    const body=make('tbody');table.append(head,body);scroll.append(table);content.append(scroll);return body;
  }
  function footer(body,label,colSpan,value,metric,lastText,lastMetric){
    const tr=make('tr','pr-total'),heading=cell(tr,'label',label);heading.colSpan=colSpan;
    const total=cell(tr,'total',value);total.dataset.metric=metric;
    if(lastText!==undefined){const last=cell(tr,'count',lastText);last.dataset.metric=lastMetric;}body.append(tr);
    // Keep the same semantic columns for screen readers and PDF capture.
    labelRows(body,body.rows);
  }
  function labelRows(body,rows){
    const labels=[...body.parentElement.tHead.rows[1].cells].map(th=>th.textContent);
    for(const row of rows){row.setAttribute('role','row');let column=0;
      for(const td of row.cells){td.setAttribute('role','cell');td.dataset.label=labels[column];column+=td.colSpan;}}
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
  function provisionRow(row,today){
    const tr=make('tr');if(row.children)tr.dataset.descriptionId=row.id;else tr.dataset.id=row.id;
    cell(tr,'branch',row.branch,'pr-bold');cell(tr,'supplier',row.supplier,'pr-bold');
    const productText=item=>`${item.product}${item.observation?` (${item.observation})`:''}`;
    const product=cell(tr,'product',productText(row),'pr-bold');
    if(row.children){product.replaceChildren();for(const item of row.children)textLine(product,productText(item));}
    const dueCell=cell(tr,'dueDate','','pr-red pr-bold');dueCell.replaceChildren();textLine(dueCell,formatReportDate(row.dueDate),'pr-date pr-nowrap');
    scheduling(cell(tr,'schedule',''),row,today);cell(tr,'total',money(row.total),'pr-bold pr-money');
    const status=cell(tr,'status','');status.replaceChildren();const paid=upper(row.status)==='PAGAMENTO EFETUADO',statusTone=paid?'green':upper(row.status)==='PENDENTE'?'orange':'red';
    if(paid)statusLine(status,row.status,'green','pr-green');else textLine(status,row.status||'—',`pr-${statusTone}`);
    const due=provisionDueState(row.dueDate,today),dueTone=due.kind==='unknown'?'muted':row.dueDate<today?'red':row.dueDate===today?'yellow':'green';
    statusLine(status,due.label,dueTone,`pr-${dueTone}`);return tr;
  }
  function render(){
    content.replaceChildren();showNotice('');if(!snapshot)return;
    const today=provisionDateKey(now()),result=buildProvisionReport(snapshot,selected(),today);
    const logoFrame=make('div','pr-logo'),logo=make('img');logo.src=LOGO;logo.alt='Logo Energética';logoFrame.append(logo);content.append(logoFrame);
    const body=table('provisions','⚠ DESPESAS RECORRENTES – PROVISÃO DE PAGAMENTOS',['FILIAL','FORNECEDOR','PRODUTO','DATA VENCIMENTO','AGENDAMENTO','VALOR','STATUS'],[10,16,23,10,14,14,13]);
    for(const row of groupProvisionReportRows(result.rows,snapshot.descriptions)){
      const tr=provisionRow(row,today);body.append(tr);if(!row.children)continue;
      tr.classList.add('pr-description-group');
      const branch=tr.querySelector('[data-column=branch]'),toggle=button('pr-group-toggle','↓',`Expandir itens do descritivo ${row.id}`);
      const branchContent=make('div','pr-group-branch-content');branchContent.append(make('span','',row.branch||'—'),toggle);
      branch.classList.add('pr-group-branch');branch.replaceChildren(branchContent);
      const children=row.children.map((item,index)=>{
        const child=provisionRow(item,today);child.classList.add('pr-description-child');child.id=`pr-description-${instance}-${revision}-${row.id}-${index}`;
        for(const name of ['branch','supplier','dueDate','schedule','status']){
          const parentText=name==='branch'?branch.querySelector('span').textContent:tr.querySelector(`[data-column="${name}"]`).textContent;
          const detail=child.querySelector(`[data-column="${name}"]`);
          if(detail.textContent.replace(/\s+/g,' ').trim()!==parentText.replace(/\s+/g,' ').trim())continue;
          const spoken=[...detail.children].map(node=>node.textContent.trim()).filter(Boolean).join(' · ')||detail.textContent.trim();
          detail.setAttribute('aria-label',`Igual à linha principal: ${spoken}`);
          detail.replaceChildren();detail.classList.add('pr-duplicate-cell');detail.dataset.reportEmptyCell='';
        }
        return child;
      });
      for(const child of children){child.hidden=true;body.append(child);}
      labelRows(body,children);toggle.setAttribute('aria-controls',children.map(child=>child.id).join(' '));toggle.setAttribute('aria-expanded','false');
      toggle.dataset.reportScreenOnly='';
      branch.addEventListener('click',event=>{if(!event.target.closest('button'))toggle.click();});
      toggle.addEventListener('click',()=>{
        const expanded=toggle.getAttribute('aria-expanded')!=='true';
        toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-label',`${expanded?'Recolher':'Expandir'} itens do descritivo ${row.id}`);toggle.textContent=expanded?'↑':'↓';
        for(const child of children)child.hidden=!expanded;
      });
    }
    footer(body,'TOTAL DE PROVISÕES COM PAGAMENTO PENDENTE',5,money(result.pendingTotal),'pendingTotal',`${result.pendingCount} pendência(s)`,'pendingCount');
    const annual=table('annual','📊 RELATÓRIO ANUAL – PROVISÃO DE PAGAMENTOS',['FORNECEDOR',...MONTHS,'TOTAL'],[16,...MONTHS.map(()=>6.25),9]);
    for(const group of result.annual){const tr=make('tr');tr.dataset.recurrenceId=group.recurrenceId;
      const supplier=cell(tr,'supplier',`${group.supplier} - ${group.property||'-'} ( ID: ${group.recurrenceId})`,'pr-bold');
      if(group.inactivePending)statusLine(supplier,'INATIVO COM PROVISÃO PENDENTE','orange','pr-badge pr-badge--orange','',false);
      for(const month of group.months){const td=cell(tr,'month','');td.dataset.month=month.month;td.replaceChildren();
        if(group.startDate&&Number(group.startDate.slice(5,7))===month.month){const started=make('div','pr-event pr-badge pr-badge--purple');statusLine(started,'INICIADO:','purple','','pr-nowrap',false);textLine(started,formatReportDate(group.startDate),'pr-date pr-nowrap');td.append(started);}
        for(const row of month.paid){const event=make('div','pr-event');textLine(event,money(row.total),'pr-money pr-nowrap pr-green pr-bold');statusLine(event,formatReportDate(row.paidDate),'green','','pr-date pr-nowrap',false);td.append(event);}
        for(const row of month.pending){const event=make('div','pr-event');textLine(event,formatReportDate(row.dueDate),'pr-date pr-nowrap pr-orange pr-bold');const days=daysBetween(today,row.dueDate),tone=days<0?'red':'orange';statusLine(event,days<0?`ATR. ${-days}d`:`EM ${days}d`,tone,`pr-${tone} pr-bold`,'pr-nowrap',false);td.append(event);}
        if(month.nextDate){const next=make('div','pr-event pr-badge pr-badge--blue');statusLine(next,'PRÓX','blue','','pr-nowrap',false);textLine(next,formatReportDate(month.nextDate).slice(0,5),'pr-date pr-nowrap');td.append(next);}}
      cell(tr,'total',money(group.paidTotal),'pr-red pr-bold pr-money');annual.append(tr);}
    footer(annual,'TOTAL DE DESPESAS RECORRENTES EXIBIDAS NO RELATÓRIO ANUAL',13,result.annualCount,'annualCount');
    const inactive=table('inactive','🛑 DESPESAS RECORRENTES COM STATUS INATIVO MODIFICADAS NOS ÚLTIMOS 30 DIAS',['ID','FILIAL','FORNECEDOR','PRODUTO','IMÓVEL','STATUS','DATA MODIFICAÇÃO','DIAS MODIFICADO'],[5,13,18,24,13,9,11,7]);
    for(const row of result.inactiveRecent){const tr=make('tr');cell(tr,'id',row.id,'pr-bold');cell(tr,'branch',row.branch,'pr-bold');cell(tr,'supplier',row.supplier,'pr-bold');cell(tr,'product',row.product);cell(tr,'property',row.property);cell(tr,'status',row.status,'pr-red pr-bold');
      const timestamp=new Date(row.modified);const formatted=Number.isFinite(timestamp.getTime())?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(timestamp):formatReportDate(row.modified);
      cell(tr,'modified',formatted,'pr-red pr-bold');const days=daysBetween(provisionDateKey(row.modified),today);cell(tr,'days',`${days} dia(s)`,days<=7?'pr-red pr-bold':'pr-orange pr-bold');inactive.append(tr);}
    if(!result.inactiveRecent.length){const tr=make('tr'),td=cell(tr,'empty','✅ Nenhuma despesa recorrente com status INATIVO foi modificada nos últimos 30 dias.','pr-green pr-empty');td.colSpan=8;inactive.append(tr);}
    footer(inactive,'TOTAL DE DESPESAS RECORRENTES COM STATUS INATIVO',7,result.inactiveCount,'inactiveCount');
    fitAnnualTokens();
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
    if(root.hidden||destroyed)return;pickers?.close();controller?.abort();const current=++revision,active=new AbortController();controller=active;snapshot=null;content.replaceChildren();
    showNotice('Carregando provisões do SharePoint…');report.setAttribute('aria-busy','true');refresh.disabled=true;
    try{const result=await data.loadProvisionReportSnapshot({signal:active.signal});
      if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;
      if(!Array.isArray(result?.provisions)||!Array.isArray(result?.recurrences))throw new Error('O SharePoint retornou dados incompletos para o relatório de provisões.');
      snapshot=result;populate();render();
    }catch(error){if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;content.replaceChildren();showNotice(`Não foi possível carregar o relatório. Use Atualizar para tentar novamente. ${String(error?.message||'Falha na consulta.').replace(/https?:\/\/\S+/gi,'endereço SharePoint').replace(/Bearer\s+\S+/gi,'[oculto]').slice(0,240)}`);
    }finally{if(current===revision){report.setAttribute('aria-busy','false');refresh.disabled=false;}}
  }
  function orientationChanged() { landscape.update();if(win?.requestAnimationFrame)win.requestAnimationFrame(fitAnnualTokens);else fitAnnualTokens(); }
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
    root.hidden=false;landscape.update();warning.hidden=true;report.hidden=false;panel.classList.toggle('pl-dialog--portrait',false);panel.focus();await load();
  },close,destroy(){if(destroyed)return;close();destroyed=true;pickers?.destroy();win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);landscape.destroy();root.remove();}});
}
