import {buildOrderValidationReport} from '../chat/order-validation-report-model.js';
import {formatReportDate,formatReportMoney} from '../chat/contractor-report-model.js';
import {bindSearchableFilterSelects} from './searchable-filter-selects.js';
import Decimal from 'decimal.js';

const LOGO=new URL('../../../../assets/logo-energetica-oficial.png',import.meta.url).href;
const FIELDS=[['id','ID'],['branch','FILIAL'],['supplier','FORNECEDOR'],['product','PRODUTO'],['invoice','NOTA FISCAL'],['status','STATUS']];
const METRICS=[['orderCount','TOTAL DE PEDIDOS'],['total','VALOR TOTAL'],['invoicePending','NF PENDENTE'],['withoutLaunch','SEM LANÇAMENTO'],['valueDivergent','VALOR DIVERGENTE'],['supplierCount','QTD. FORNECEDORES']];
const money=value=>Number.isFinite(value)?formatReportMoney(value):'INCOMPLETO';
const same=(a,b)=>String(a??'').trim().toLocaleLowerCase('pt-BR')===String(b??'').trim().toLocaleLowerCase('pt-BR');

export function createOrderValidationReportView({document:doc=globalThis.document,data}={}){
  if(!doc?.body||typeof data?.loadOrderValidationSnapshot!=='function')throw new TypeError('A validação de notas requer documento e sessão SharePoint.');
  const win=doc.defaultView;
  const make=(tag,className='',text)=>{const n=doc.createElement(tag);n.className=className;if(text!==undefined)n.textContent=text;return n;};
  const root=make('div','pl-overlay ov-overlay');root.hidden=true;
  const panel=make('section','pl-dialog ov-dialog');panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Validação de notas pendentes e pedidos para baixa');
  const warning=make('p','pl-orientation','PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');warning.setAttribute('role','status');
  const report=make('div','pl-report ov-report');report.hidden=true;
  const filters=make('div','pl-filters ov-filters'),controls=new Map();
  for(const [name,label] of FIELDS){const holder=make('label','pl-filter'),select=make('select');select.name=name;select.setAttribute('aria-label',label);holder.append(make('span','pl-filter-label',label),select);filters.append(holder);controls.set(name,select);}
  const refresh=make('button','pl-refresh','⟳');refresh.type='button';refresh.setAttribute('aria-label','Atualizar validação de notas');filters.append(refresh);
  const notice=make('p','pl-notice');notice.hidden=true;notice.setAttribute('role','status');
  const content=make('div','pl-table-scroll ov-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Resumo e validação dos pedidos');
  report.append(filters,notice,content);panel.append(warning,report);root.append(panel);doc.body.append(root);
  let snapshot=null,controller=null,revision=0,pickers=null,destroyed=false,returnFocus=null,oldOverflow='',app=null,oldInert=false;
  const portrait=()=>win?.matchMedia?win.matchMedia('(orientation: portrait)').matches:win?.innerHeight>win?.innerWidth;
  const showNotice=text=>{notice.textContent=text;notice.hidden=!text;};
  const selected=()=>Object.fromEntries([...controls].map(([name,node])=>[name,node.value]));
  const cell=(tr,column,text,className='')=>{const td=make('td',className,String(text??'').trim()||'-');td.dataset.column=column;tr.append(td);return td;};
  function section(title,key){const node=make('section','ov-section');node.dataset.section=key;node.append(make('h2','ov-section-title',title));content.append(node);return node;}
  function table(parent,labels,widths){const table=make('table','ov-table'),cols=make('colgroup');for(const width of widths){const col=make('col');col.style.width=`${width}%`;cols.append(col);}const head=make('thead'),tr=make('tr');for(const label of labels){const th=make('th','',label);th.scope='col';tr.append(th);}head.append(tr);const body=make('tbody');table.append(cols,head,body);parent.append(table);return body;}
  function renderDetail(row){
    const differenceProblem=row.difference==null||!new Decimal(row.difference).toDecimalPlaces(2,Decimal.ROUND_HALF_UP).isZero();
    const detail=section(`DETALHAMENTO DO PEDIDO ${row.id}`,'detail');detail.querySelector('h2').append(make('span','ov-detail-badge',row.apto?'VALIDADO':`${row.issues.length} ALERTA(S)`));
    const body=table(detail,['ID','DATA','FILIAL','FORNECEDOR','TOTAL PEDIDO','TOTAL LANÇ.','DIFERENÇA'],[6,12,17,26,13,13,13]);
    const tr=make('tr');cell(tr,'id',row.id);cell(tr,'created',formatReportDate(row.created));cell(tr,'branch',row.branch,row.branchProblem||row.missingLaunch?'ov-bad':'ov-good');cell(tr,'supplier',row.supplier,row.supplierProblem||row.missingLaunch?'ov-bad':'ov-good');
    cell(tr,'total',row.total==null?(row.invalidTotal?'INCOMPLETO':'-'):money(row.total),row.valueProblem||row.missingLaunch?'ov-bad':'ov-good');cell(tr,'launchTotal',money(row.launchTotal),row.valueProblem||row.missingLaunch?'ov-bad':'ov-good');cell(tr,'difference',money(row.difference),differenceProblem||row.missingLaunch?'ov-bad':'ov-good');body.append(tr);
    const alerts=make('div','ov-alerts');alerts.dataset.section='alerts';alerts.append(make('h3','',row.issues.length?'ALERTAS DO PEDIDO':'✅ Pedido sem alertas.'));
    row.issues.forEach((issue,i)=>{const card=make('div','ov-alert');card.append(make('strong','',`${i+1}. ${issue.title}`),make('p','',issue.detail));alerts.append(card);});detail.append(alerts);
    if(row.launches.length){const linked=make('div','ov-linked');linked.dataset.section='launches';linked.append(make('h3','','LANÇAMENTOS VINCULADOS'));const launches=table(linked,['ID LANÇ.','FILIAL','FORNECEDOR','PRODUTO','TOTAL','DESCRIÇÃO'],[7,15,24,19,12,23]);
      for(const launch of row.launches){const tr=make('tr');const branchOk=!!row.branch&&same(launch.branch,row.branch),supplierOk=!!row.supplier&&same(launch.supplier,row.supplier);cell(tr,'id',launch.id);cell(tr,'branch',launch.branch,branchOk?'ov-good':'ov-bad');cell(tr,'supplier',launch.supplier,supplierOk?'ov-good':'ov-bad');cell(tr,'product',launch.product);cell(tr,'total',money(launch.total));cell(tr,'description',launch.description);launches.append(tr);}detail.append(linked);}
  }
  function render(){
    content.replaceChildren();showNotice('');if(!snapshot)return;
    const result=buildOrderValidationReport(snapshot,selected());
    const logoFrame=make('div','ov-logo'),logo=make('img');logo.src=LOGO;logo.alt='Logo Energética';logoFrame.append(logo,make('h1','','VALIDAÇÃO ÚNICA DE NOTAS PENDENTES / PEDIDOS PARA BAIXA'));content.append(logoFrame);
    if(!result.rows.length){showNotice('Nenhum pedido encontrado para os filtros selecionados.');return;}
    const overview=section('RESUMO GERAL','summary'),cards=make('div','ov-cards');
    METRICS.forEach(([key,label],i)=>{const card=make('div',`ov-card ov-card--${i}`),value=make('strong','',key==='total'?money(result.summary[key]):String(result.summary[key]));value.dataset.metric=key;card.append(make('span','',label),value);cards.append(card);});overview.append(cards);
    if(!controls.get('id').value)overview.append(make('p','ov-hint','🔎 Para ver o detalhamento completo, selecione um pedido específico no filtro de ID.'));
    const orders=section('TABELA PRINCIPAL DE PEDIDOS','orders');orders.querySelector('h2').append(make('span','ov-detail-badge','ORDENADA POR ID — MAIOR PARA MENOR'));
    const body=table(orders,['ID','FILIAL','FORNECEDOR','VALOR','NOTA FISCAL','STATUS','APTO','PENDÊNCIAS'],[5,10,18,9,10,10,7,31]);
    for(const row of result.rows){const tr=make('tr',row.apto?'ov-row-good':'ov-row-bad');tr.dataset.id=row.id;cell(tr,'id',row.id,row.apto?'ov-id-ok':'ov-bad');
      if(row.branchRowSpan){const td=cell(tr,'branch',row.branch,row.branchGroupProblem?'ov-bad':'ov-good');td.rowSpan=row.branchRowSpan;}
      if(row.supplierRowSpan){const td=cell(tr,'supplier',row.supplier,row.supplierGroupProblem?'ov-bad':'ov-good');td.rowSpan=row.supplierRowSpan;}
      cell(tr,'total',row.total==null?(row.invalidTotal?'INCOMPLETO':'-'):money(row.total),row.valueProblem||row.missingLaunch?'ov-bad':'ov-good');cell(tr,'invoice',row.invoice,row.nfPending?'ov-bad':'ov-good');cell(tr,'status',row.status);cell(tr,'apto',row.apto?'SIM':'NÃO',row.apto?'ov-good':'ov-bad');
      const tags=cell(tr,'issues','');tags.replaceChildren();if(row.apto)tags.append(make('span','ov-tag ov-tag--ok','SEM PENDÊNCIA'));else for(const issue of row.issues){const tag=make('span','ov-tag',issue.type);tag.dataset.issue=issue.type;tag.title=issue.detail;tags.append(tag);}body.append(tr);}
    const total=make('tr','ov-total');const heading=cell(total,'label','CONSOLIDADO DA TABELA PRINCIPAL — TOTAL GERAL');heading.colSpan=3;cell(total,'total',money(result.summary.total));const count=cell(total,'count',`${result.summary.orderCount} PEDIDO(S)`);count.colSpan=4;body.append(total);
    if(result.detail)renderDetail(result.detail);
  }
  function populate(){
    pickers?.destroy();pickers=null;
    for(const [name] of FIELDS){const node=controls.get(name),current=node.value;const values=name==='product'?snapshot.launches.map(row=>row.product):snapshot.orders.map(row=>row[name]);
      const unique=[...new Set([...values,current].filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR',{numeric:name==='id'}));
      node.replaceChildren(Object.assign(make('option','',name==='status'?'PENDENTE AUDITORIA':'Todos'),{value:''}));for(const value of unique)node.append(Object.assign(make('option','',String(value)),{value:String(value)}));node.value=current;}
    pickers=bindSearchableFilterSelects(filters,{placement:'below',report:true});
  }
  async function load(){
    if(root.hidden||portrait()||destroyed)return;pickers?.close();controller?.abort();const current=++revision,active=new AbortController();controller=active;snapshot=null;content.replaceChildren();showNotice('Carregando pedidos e lançamentos do SharePoint…');report.setAttribute('aria-busy','true');refresh.disabled=true;
    try{const result=await data.loadOrderValidationSnapshot({signal:active.signal});if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;
      if(!Array.isArray(result?.orders)||!Array.isArray(result?.launches))throw new Error('Dados incompletos para a validação de notas.');snapshot=result;populate();render();
    }catch(error){if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;content.replaceChildren();showNotice('Não foi possível carregar a validação. Use Atualizar para tentar novamente.');}
    finally{if(current===revision){report.setAttribute('aria-busy','false');refresh.disabled=false;}}
  }
  function orientationChanged(){if(root.hidden)return;const vertical=portrait();warning.hidden=!vertical;panel.classList.toggle('pl-dialog--portrait',vertical);if(vertical){pickers?.close();if(report.contains(doc.activeElement))panel.focus();controller?.abort();revision++;snapshot=null;content.replaceChildren();report.hidden=true;}else if(report.hidden){report.hidden=false;void load();}}
  function close(){if(root.hidden)return;controller?.abort();revision++;snapshot=null;pickers?.close();content.replaceChildren();root.hidden=true;doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;returnFocus?.focus?.();returnFocus=null;}
  root.addEventListener('click',event=>{if(event.target===root)close();});
  root.addEventListener('keydown',event=>{if(root.hidden)return;if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key!=='Tab')return;
    const nodes=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(n=>!n.disabled&&!n.closest('[hidden]')&&n.tabIndex>=0),first=nodes[0],last=nodes.at(-1);
    if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){event.preventDefault();first?.focus();}});
  for(const node of controls.values())node.addEventListener('change',()=>{render();content.scrollTop=0;});refresh.addEventListener('click',()=>void load());
  win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
  return Object.freeze({element:root,async open(){if(destroyed)throw new Error('A validação de notas foi encerrada.');if(!root.hidden)return;
    returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;doc.body.style.overflow='hidden';if(app)app.inert=true;
    pickers?.destroy();pickers=null;for(const [name] of FIELDS){const node=controls.get(name),value=name==='status'?'PENDENTE AUDITORIA':'';node.replaceChildren(Object.assign(make('option','',name==='status'?'PENDENTE AUDITORIA':'Todos'),{value:''}));if(value)node.append(Object.assign(make('option','',value),{value}));node.value=value;}
    root.hidden=false;const vertical=portrait();warning.hidden=!vertical;report.hidden=vertical;panel.classList.toggle('pl-dialog--portrait',vertical);panel.focus();if(!vertical)await load();
  },close,destroy(){if(destroyed)return;close();destroyed=true;pickers?.destroy();win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);root.remove();}});
}
