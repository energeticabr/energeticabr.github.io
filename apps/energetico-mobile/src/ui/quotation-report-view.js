import {buildQuotationOverview} from '../chat/quotation-report-model.js';

const upper=value=>String(value??'').trim().toUpperCase();
const statusKey=value=>upper(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const date=value=>value?`${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)}`:'-';
const money=value=>value==null?'-':value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

export function createQuotationReportView({document:doc=globalThis.document,data}={}){
 if(!doc?.body||typeof data?.loadSnapshot!=='function')throw new TypeError('O relatório requer documento e sessão SharePoint.');
 const win=doc.defaultView,make=(tag,cls='',text)=>{const n=doc.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const root=make('div','qr-overlay');root.hidden=true;
 const panel=make('section','qr-dialog');panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Cotações e orçamentos');
 const warning=make('p','qr-orientation','PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');warning.setAttribute('role','status');
 const content=make('div','qr-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Cotações e orçamentos vinculados');
 const toolbar=make('header','qr-toolbar'),refresh=make('button','qr-refresh','⟳');refresh.type='button';refresh.setAttribute('aria-label','Atualizar cotações e orçamentos');refresh.addEventListener('click',()=>void load());toolbar.append(refresh);
 panel.append(toolbar,warning,content);root.append(panel);doc.body.append(root);
 let controller=null,revision=0,destroyed=false,returnFocus=null,oldOverflow='',app=null,oldInert=false;
 const portrait=()=>win?.matchMedia?win.matchMedia('(orientation: portrait)').matches:win?.innerHeight>win?.innerWidth;
 function badge(value,quote=false){
  const key=statusKey(value);let tone='qr-neutral';
  if(quote){if(key==='ATIVA'||key==='ATIVO')tone='qr-received';}
  else if(key==='PENDENTE SOLICITACAO')tone='qr-pending';else if(key==='AGUARDANDO ORCAMENTO')tone='qr-awaiting';else if(key==='ORCAMENTO RECEBIDO')tone='qr-received';
  return make('span',`qr-badge ${tone}`,upper(value)||'-');
 }
 function render(snapshot){
  const result=buildQuotationOverview(snapshot);content.replaceChildren();
  const title=make('header','qr-title');title.append(make('h2','','COTAÇÕES E ORÇAMENTOS'),make('p','','Acompanhamento geral das cotações e dos orçamentos vinculados'));content.append(title);
  const cards=make('div','qr-cards');
  for(const [key,label] of [['active','COTAÇÕES ATIVAS'],['inactive','COTAÇÕES INATIVAS'],['total','TOTAL DE COTAÇÕES'],['pending','PENDENTE SOLICITAÇÃO']]){const card=make('div',`qr-card qr-${key}`);card.dataset.metric=key;card.append(make('span','',label),make('strong','',String(result.metrics[key])));cards.append(card);}content.append(cards);
  for(const quote of result.quotes){
   const block=make('article','qr-quote'),header=make('header','qr-quote-header');header.append(make('h3','',`COTAÇÃO Nº ${quote.id}`),make('span','qr-count',`${quote.budgetCount} orçamento(s)`));block.append(header);
   const facts=make('div','qr-facts');facts.append(make('h4','','DADOS DA COTAÇÃO'));const table=make('table','qr-fact-table'),cols=make('colgroup');for(const width of [10,12,10,23,10,35]){const col=make('col');col.style.width=`${width}%`;cols.append(col);}table.append(cols);
   const body=make('tbody'),first=make('tr');for(const [label,value] of [['ID',quote.id],['FILIAL',quote.branch],['ETAPA',quote.stage]]){const key=make('th','',label);key.scope='row';const cell=make('td');cell.append(label==='ID'?make('span','qr-id',value):make('span','',value||'-'));first.append(key,cell);}
   const second=make('tr'),supplierLabel=make('th','','QTD. FORNECEDORES');supplierLabel.scope='row';const suppliers=make('td');suppliers.colSpan=3;suppliers.append(make('span','qr-supplier-count',String(quote.supplierCount)),make('span','',' fornecedor(es) com orçamento vinculado'));const statusLabel=make('th','','STATUS');statusLabel.scope='row';const status=make('td');const qb=badge(quote.status,true);qb.dataset.quoteStatus='';status.append(qb);second.append(supplierLabel,suppliers,statusLabel,status);
   const third=make('tr'),descriptionLabel=make('th','','DESCRIÇÃO');descriptionLabel.scope='row';const description=make('td','qr-description',quote.description||'-');description.colSpan=5;third.append(descriptionLabel,description);body.append(first,second,third);table.append(body);facts.append(table);block.append(facts);
   const bar=make('h4','qr-budget-heading','ORÇAMENTOS VINCULADOS ');bar.append(make('span','qr-budget-count',String(quote.budgetCount)));block.append(bar);
   const budgets=make('table','qr-budgets'),columns=make('colgroup'),head=make('thead'),headRow=make('tr'),rows=make('tbody');
   for(const width of [6,8,10,10,16,11,12,14,13]){const col=make('col');col.style.width=`${width}%`;columns.append(col);}for(const label of ['ID','ID COTAÇÃO','FILIAL','ETAPA','FORNECEDOR','DATA FINALIZADO','VALOR TOTAL','STATUS','OBS']){const th=make('th','',label);th.scope='col';headRow.append(th);}head.append(headRow);budgets.append(columns,head,rows);
   for(const group of quote.groups)group.budgets.forEach((budget,index)=>{
    const tr=make('tr');tr.append(make('td','qr-budget-id',budget.id));if(index===0)for(const value of [group.quotationId,group.branch,group.stage]){const td=make('td','qr-group',value||'-');td.rowSpan=group.budgets.length;tr.append(td);}
    tr.append(make('td','qr-supplier',budget.supplier||'-'),make('td','qr-date',date(budget.finalizedDate)),make('td','qr-money',money(budget.total)));const state=make('td');state.append(badge(budget.status));tr.append(state,make('td','qr-observation',budget.observation||'-'));rows.append(tr);
   });
   if(!quote.budgetCount){const tr=make('tr'),cell=make('td','qr-empty','Nenhum orçamento vinculado.');cell.colSpan=9;tr.append(cell);rows.append(tr);}block.append(budgets);content.append(block);
  }
  if(!result.quotes.length)content.append(make('p','qr-empty','Nenhuma cotação encontrada.'));
 }
 async function load(){
  if(root.hidden||portrait()||destroyed)return;controller?.abort();const current=++revision,active=new AbortController();controller=active;content.replaceChildren(make('p','qr-notice','Carregando cotações e orçamentos do SharePoint…'));content.setAttribute('aria-busy','true');refresh.disabled=true;
  try{const result=await data.loadSnapshot({signal:active.signal});if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;render(result);}
  catch(error){if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;const message=make('p','qr-notice','Não foi possível carregar as cotações e os orçamentos.');message.setAttribute('role','status');const retry=make('button','qr-retry','Tentar novamente');retry.type='button';retry.addEventListener('click',()=>void load());content.replaceChildren(message,retry);}
  finally{if(current===revision){content.setAttribute('aria-busy','false');refresh.disabled=false;}}
 }
 function orientationChanged(){if(root.hidden)return;const vertical=portrait();warning.hidden=!vertical;panel.classList.toggle('qr-portrait',vertical);if(vertical){if(content.contains(doc.activeElement))panel.focus();controller?.abort();revision++;content.replaceChildren();content.hidden=true;}else if(content.hidden){content.hidden=false;void load();}}
 function close(){if(root.hidden)return;controller?.abort();revision++;content.replaceChildren();root.hidden=true;doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;returnFocus?.focus?.();returnFocus=null;}
 root.addEventListener('click',event=>{if(event.target===root)close();});root.addEventListener('keydown',event=>{
  if(root.hidden)return;if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key!=='Tab')return;const nodes=[...panel.querySelectorAll('button,[tabindex="0"]')].filter(n=>!n.disabled&&!n.closest('[hidden]')),first=nodes[0],last=nodes.at(-1);
  if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){event.preventDefault();first?.focus();}
 });win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
 return Object.freeze({element:root,async open(){if(destroyed)throw new Error('O relatório foi encerrado.');if(!root.hidden)return;returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;doc.body.style.overflow='hidden';if(app)app.inert=true;root.hidden=false;const vertical=portrait();warning.hidden=!vertical;content.hidden=vertical;panel.classList.toggle('qr-portrait',vertical);panel.focus();content.scrollTop=0;if(!vertical)await load();},close,destroy(){if(destroyed)return;close();destroyed=true;win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);root.remove();}});
}
