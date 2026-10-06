import { buildSpendingReport9 } from '../chat/spending-reports-model.js';
import { formatReportMoney } from '../chat/contractor-report-model.js';
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';

const LOGO = new URL('../../../../assets/logo-energetica-oficial.png', import.meta.url).href;
const FIELDS = [['year','Ano'],['month','Mês'],['branch','FILIAL'],['stage','ETAPA'],['product','PRODUTO'],['supplier','FORNECEDOR'],['disbursement','DESEMBOLSO']];
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const money = value => Number.isFinite(value) ? formatReportMoney(value) : 'INCOMPLETO';
const number = value => Number.isFinite(value) ? new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value) : 'INCOMPLETO';
const percent = value => `${number(value)}${Number.isFinite(value) ? '%' : ''}`;

export function createManagementReportView({document:doc=globalThis.document,data,now=()=>new Date()}={}) {
  if (!doc?.body || typeof data?.loadSnapshot !== 'function') throw new TypeError('O resumo gerencial requer documento e sessão SharePoint.');
  const win=doc.defaultView;
  const make=(tag,className='',text)=>{const n=doc.createElement(tag);n.className=className;if(text!==undefined)n.textContent=text;return n;};
  const root=make('div','pl-overlay gm-overlay');root.hidden=true;
  const panel=make('section','pl-dialog gm-dialog');panel.tabIndex=-1;
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Resumo gerencial de gastos');
  const warning=make('p','pl-orientation','PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');warning.setAttribute('role','status');
  const report=make('div','pl-report gm-report');report.hidden=true;
  const filters=make('div','pl-filters gm-filters');
  const refresh=make('button','pl-refresh','⟳');refresh.type='button';refresh.setAttribute('aria-label','Atualizar resumo gerencial');
  const controls=new Map();const dates=make('div','pl-dates');dates.append(make('span','pl-filter-label','DATA'));
  const pair=make('div','gm-period-fields');dates.append(pair);filters.append(refresh,dates);
  for (const [name,label] of FIELDS) {
    const holder=make('label',name==='year'||name==='month'?'gm-period-filter':'pl-filter');
    if(name!=='year'&&name!=='month')holder.append(make('span','pl-filter-label',label));
    const select=make('select');select.name=name;select.setAttribute('aria-label',label);
    select.append(Object.assign(make('option','','Todos'),{value:''}));holder.append(select);controls.set(name,select);
    (name==='year'||name==='month'?pair:filters).append(holder);
  }
  const notice=make('p','pl-notice');notice.hidden=true;notice.setAttribute('role','status');
  const content=make('div','pl-table-scroll gm-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Tabelas de gastos por filial');
  report.append(filters,notice,content);panel.append(warning,report);root.append(panel);doc.body.append(root);
  let snapshot=null,controller=null,revision=0,pickers=null,destroyed=false,returnFocus=null,oldOverflow='',app=null,oldInert=false;
  const portrait=()=>win?.matchMedia?win.matchMedia('(orientation: portrait)').matches:win?.innerHeight>win?.innerWidth;
  const showNotice=text=>{notice.textContent=text;notice.hidden=!text;};
  const selected=()=>Object.fromEntries([...controls].map(([name,n])=>[name,n.value]));
  function cell(tr,column,value,span=1,className='') {
    const td=make('td',className,String(value??'').trim()||'—');td.dataset.column=column;td.rowSpan=span;tr.append(td);return td;
  }
  function table(section,title,labels,widths) {
    const table=make('table',`gm-table gm-table--${section}`);table.dataset.section=section;
    const colgroup=make('colgroup');for(const width of widths){const col=make('col');col.style.width=`${width}%`;colgroup.append(col);}table.append(colgroup);
    const head=make('thead'),titleRow=make('tr'),heading=make('th','gm-section-title',title);heading.colSpan=widths.length;titleRow.append(heading);head.append(titleRow);
    if(labels.length){const tr=make('tr');for(const label of labels){const th=make('th','',label);th.scope='col';tr.append(th);}head.append(tr);}
    const body=make('tbody');table.append(head,body);content.append(table);return body;
  }
  function render() {
    content.replaceChildren();showNotice('');if(!snapshot)return;
    const result=buildSpendingReport9(snapshot,selected());
    const logoFrame=make('div','gm-logo'),logo=make('img');logo.src=LOGO;logo.alt='Logo Energética';logoFrame.append(logo);content.append(logoFrame);
    const summary=table('summary','RESUMO GERENCIAL DE GASTOS',[],[46,18,30,6]);
    const metrics=make('tr');cell(metrics,'label','TOTAL DO MÊS/PERÍODO FILTRADO',1,'gm-label');
    cell(metrics,'total',money(result.total),1,'gm-money').dataset.metric='total';
    cell(metrics,'label','QTDE. LANÇAMENTOS',1,'gm-label');cell(metrics,'count',result.count).dataset.metric='count';summary.append(metrics);
    const period=make('tr');cell(period,'label','PERÍODO',1,'gm-label');const periodValue=cell(period,'period',result.period);periodValue.colSpan=3;periodValue.dataset.metric='period';summary.append(period);
    const branches=table('branches','TOTAL GASTO ACUMULADO POR FILIAL',['FILIAL','QTDE. LINHAS','TOTAL GASTO','% DO TOTAL DO MÊS'],[35,20,23,22]);
    for(const branch of result.branches){const tr=make('tr');cell(tr,'branch',branch.name);cell(tr,'count',branch.count);cell(tr,'total',money(branch.total),1,'gm-money');cell(tr,'percentage',percent(branch.percentage));branches.append(tr);}
    for(const [section,title,label,withQuantity,ownPercentage] of [
      ['expense','PERCENTUAL POR TIPO DE DESPESA POR FILIAL','TIPO DE DESPESA',true,true],
      ['products','PRODUTOS COM MAIOR GASTO POR FILIAL','PRODUTO',true,false],
      ['stages','ETAPAS COM MAIOR GASTO POR FILIAL','ETAPA',false,false],
      ['suppliers','PRINCIPAIS FORNECEDORES POR FILIAL','FORNECEDOR',false,false],
      ['accounts','MAIORES GASTOS POR CONTA POR FILIAL','CONTA',false,false],
    ]) {
      const labels=['FILIAL',label,'QTDE. LINHAS',...(withQuantity?['QTD TOTAL']:[]),'TOTAL GASTO',ownPercentage?'% DA FILIAL':'% DO TOTAL DO MÊS'];
      const body=table(section,title,labels,withQuantity?[24,28,12,12,13,11]:[24,34,14,15,13]);
      for(const branch of result.branches) {
        const groups=section==='expense'?branch.expenseTypes:branch[section];
        groups.forEach((group,index)=>{
          const tr=make('tr');if(index===0)cell(tr,'branch',branch.name,groups.length+1,'gm-branch');
          cell(tr,'name',group.name);cell(tr,'count',group.count);if(withQuantity)cell(tr,'quantity',number(group.quantity));
          cell(tr,'total',money(group.total),1,'gm-money');cell(tr,'percentage',percent(group.percentage));body.append(tr);
        });
        const total=make('tr','gm-total');cell(total,'label','TOTAL DA FILIAL');cell(total,'count',branch.count);
        if(withQuantity)cell(total,'quantity',number(branch.quantity));cell(total,'total',money(branch.total),1,'gm-money');
        cell(total,'percentage',percent(ownPercentage?(branch.total===null?null:branch.total===0?0:100):branch.percentage));body.append(total);
      }
    }
    if(result.incompleteCount)showNotice(`${result.incompleteCount} lançamento(s) com valores incompletos. Totais afetados aparecem como INCOMPLETO.`);
    else if(!result.count)showNotice('Nenhum lançamento corresponde aos filtros.');
  }
  function populate() {
    pickers?.destroy();pickers=null;
    for(const [name] of FIELDS) {
      const control=controls.get(name),current=control.value;
      const values=name==='year'?[String(now().getFullYear()),...snapshot.launches.map(row=>row.date?.slice(0,4))]:name==='month'?MONTHS.map((_,i)=>String(i+1)):snapshot.launches.map(row=>row[name]);
      const unique=[...new Set(values.filter(Boolean).map(String))].sort((a,b)=>name==='year'?Number(b)-Number(a):name==='month'?Number(a)-Number(b):a.localeCompare(b,'pt-BR'));
      control.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));
      for(const value of unique)control.append(Object.assign(make('option','',name==='month'?MONTHS[Number(value)-1]:value),{value}));
      control.value=unique.includes(current)?current:'';
    }
    pickers=bindSearchableFilterSelects(filters,{placement:'below',report:true});
  }
  async function load() {
    if(root.hidden||portrait()||destroyed)return;
    pickers?.close();controller?.abort();const current=++revision,active=new AbortController();controller=active;snapshot=null;content.replaceChildren();
    showNotice('Carregando gastos do SharePoint…');report.setAttribute('aria-busy','true');refresh.disabled=true;
    try {
      const result=await data.loadSnapshot({reportNumber:9,signal:active.signal});
      if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;
      if(!Array.isArray(result?.launches)||!Array.isArray(result?.productTypes))throw new Error('O SharePoint retornou dados incompletos para o resumo gerencial.');
      snapshot={...result,launches:result.launches.map(row=>({...row,disbursement:row.disbursement==='true'?'SIM':row.disbursement==='false'?'NÃO':row.disbursement}))};populate();render();
    } catch(error) {
      if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;
      content.replaceChildren();showNotice(`Não foi possível carregar o relatório. Use Atualizar para tentar novamente. ${String(error?.message||'Falha na consulta.').replace(/https?:\/\/\S+/gi,'endereço SharePoint').replace(/Bearer\s+\S+/gi,'[oculto]').slice(0,240)}`);
    } finally {if(current===revision){report.setAttribute('aria-busy','false');refresh.disabled=false;}}
  }
  function orientationChanged() {
    if(root.hidden)return;const vertical=portrait();warning.hidden=!vertical;panel.classList.toggle('pl-dialog--portrait',vertical);
    if(vertical){pickers?.close();if(report.contains(doc.activeElement))panel.focus();controller?.abort();revision++;snapshot=null;content.replaceChildren();report.hidden=true;}
    else if(report.hidden){report.hidden=false;void load();}
  }
  function close() {
    if(root.hidden)return;controller?.abort();revision++;snapshot=null;pickers?.close();content.replaceChildren();root.hidden=true;
    doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;returnFocus?.focus?.();returnFocus=null;
  }
  root.addEventListener('click',event=>{if(event.target===root)close();});
  root.addEventListener('keydown',event=>{
    if(root.hidden)return;if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key!=='Tab')return;
    const nodes=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(n=>!n.disabled&&!n.closest('[hidden]')&&n.tabIndex>=0),first=nodes[0],last=nodes.at(-1);
    if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){event.preventDefault();first?.focus();}
  });
  for(const control of controls.values())control.addEventListener('change',()=>{render();content.scrollTop=0;});
  refresh.addEventListener('click',()=>{void load();});win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
  return Object.freeze({element:root,async open(){
    if(destroyed)throw new Error('O resumo gerencial foi encerrado.');if(!root.hidden)return;
    returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;doc.body.style.overflow='hidden';if(app)app.inert=true;
    pickers?.destroy();pickers=null;const date=now();
    for(const [name] of FIELDS){const control=controls.get(name);control.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));const value=name==='year'?String(date.getFullYear()):name==='month'?String(date.getMonth()+1):'';if(value)control.append(Object.assign(make('option','',value),{value}));control.value=value;}
    root.hidden=false;const vertical=portrait();warning.hidden=!vertical;report.hidden=vertical;panel.classList.toggle('pl-dialog--portrait',vertical);panel.focus();if(!vertical)await load();
  },close,destroy(){if(destroyed)return;close();destroyed=true;pickers?.destroy();win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);root.remove();}});
}
