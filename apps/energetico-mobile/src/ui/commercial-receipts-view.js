import {buildCommercialReceipts} from '../chat/commercial-receipts-model.js';
import {formatOperationsDate} from '../chat/operations-reports-model.js';
import {bindSearchableFilterSelects} from './searchable-filter-selects.js';

const LOGO=new URL('../../../../assets/logo-energetica-oficial.png',import.meta.url).href;
const FILTERS=[['branch','FILIAL'],['contractId','NUMERO CONTRATO'],['buyer','COMPRADOR'],['property','IMÓVEL'],['contractStatus','STATUS IMÓVEL']];
const key=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
const money=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'—';
const localDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const percentageTone=v=>v>=100?'success':v>=20?'warning':'danger';
const documentTone=v=>['PENDENTE','NAO INFORMADO','NAO DECLARADO','','—'].includes(key(v))?'danger':['DISPENSADO','DISPENSADA'].includes(key(v))?'warning':key(v)==='DECLARADO'?'success':'neutral';

export function createCommercialReceiptsReportView({document:doc=globalThis.document,data,now=()=>new Date()}={}){
 if(!doc?.body||typeof data?.loadSnapshot!=='function')throw new TypeError('O relatório comercial requer documento e sessão SharePoint.');
 const win=doc.defaultView;
 const make=(tag,cls='',text)=>{const n=doc.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const root=make('div','pl-overlay cr-overlay');root.hidden=true;
 const panel=make('section','pl-dialog cr-dialog');panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Contratos e pagamentos de imóveis');
 const warning=make('p','pl-orientation','PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');warning.setAttribute('role','status');
 const report=make('div','pl-report cr-report');report.hidden=true;
 const filters=make('div','pl-filters cr-filters'),controls=new Map();
 const print=make('button','pl-refresh cr-print','⎙');print.type='button';print.setAttribute('aria-label','Imprimir relatório comercial');filters.append(print);
 const refresh=make('button','pl-refresh','⟳');refresh.type='button';refresh.setAttribute('aria-label','Atualizar contratos e pagamentos');filters.append(refresh);
 for(const [name,label] of FILTERS){const holder=make('label','pl-filter'),select=make('select');select.name=name;select.setAttribute('aria-label',label);holder.append(make('span','pl-filter-label',label),select);filters.append(holder);controls.set(name,select);}
 const notice=make('p','pl-notice');notice.hidden=true;notice.setAttribute('role','status');
 const content=make('div','pl-table-scroll cr-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Indicadores e pagamentos comerciais');
 report.append(filters,notice,content);panel.append(warning,report);root.append(panel);doc.body.append(root);
 let snapshot=null,controller=null,revision=0,pickers=null,destroyed=false,returnFocus=null,oldOverflow='',app=null,oldInert=false;
 const portrait=()=>win?.matchMedia?win.matchMedia('(orientation: portrait)').matches:win?.innerHeight>win?.innerWidth;
 const showNotice=text=>{notice.textContent=text;notice.hidden=!text;};
 const selected=()=>Object.fromEntries([...controls].map(([name,node])=>[name,node.value]));
 function badge(value){const n=make('span','cr-percentage',`${Math.round(value)}% PAGO`);n.dataset.tone=percentageTone(value);return n;}
 function cell(tr,text,cls='',tone=''){const n=make('td',cls,text);if(tone)n.dataset.tone=tone;tr.append(n);return n;}
 function table(cls,headers,widths){const t=make('table',cls),cols=make('colgroup');for(const width of widths){const c=make('col');c.style.width=`${width}%`;cols.append(c);}const h=make('thead'),r=make('tr');for(const label of headers){const th=make('th','',label);th.scope='col';r.append(th);}h.append(r);const body=make('tbody');t.append(cols,h,body);return {table:t,body};}
 function indicators(parent,values,specific=false){
  const grid=make('div','cr-indicators');
  for(const [label,name,tone] of [['🔴 VALOR TOTAL','total','danger'],['🟢 VALOR PAGO','paid','success'],['🟠 VALOR PENDENTE','pending','warning']]){const card=make('div','cr-card');card.dataset.tone=tone;card.append(make('h3','',label),make('strong','',money(values[name])));grid.append(card);}
  const status=make('div','cr-card');status.dataset.tone='neutral';status.append(make('h3','',specific?'📌 STATUS DO IMÓVEL':'📌 STATUS DOS IMÓVEIS'));
  if(specific){const v=key(values.visualStatus);status.dataset.tone=v==='ATIVO'?'success':v==='INATIVO'?'danger':'neutral';status.append(make('strong','',v||'NÃO INFORMADO'));}
  else{const active=make('strong','cr-active',`🟢 ATIVOS: ${values.active}`),inactive=make('strong','cr-inactive',`🔴 INATIVOS: ${values.inactive}`);status.append(active,inactive);}
  grid.append(status);parent.append(grid);
 }
 function propertyTables(result){
  content.append(make('h2','cr-section','🏠 RESUMO POR IMÓVEL'));
  for(const branch of result.branches){
   const {table:t,body}=table('cr-properties',['🏢 Filial','🏠 Imóvel','🟢 Pago','🟣 CONTRATOS ANTERIORES','🔵 Pago Corretor','🟠 Pendente','🟢 Total','📌 Status','🧾 NF Corretor','👮 Fiscal'],[7,23,9,10,11,9,9,8,7,7]);
   branch.properties.forEach((p,index)=>{
    const tr=make('tr');tr.dataset.tone=key(p.saleStatus)==='VENDIDO'?'success':key(p.saleStatus)==='NAO VENDIDO'?'danger':'neutral';
    if(index===0){const b=cell(tr,branch.name,'cr-branch','info');b.rowSpan=branch.properties.length;b.append(make('br'),badge(branch.paidPercentage));}
    const property=cell(tr,`${p.property} ( ${p.buyer||'—'} )`,'cr-property');property.append(make('br'),badge(p.paidPercentage));
    cell(tr,money(p.paid),'cr-money','success');cell(tr,money(p.formerContracts),'cr-money','former');
    const broker=cell(tr,p.brokerPaid>0?money(p.brokerPaid):p.brokerPending?'PENDENTE':p.hasBrokerPayment?money(p.brokerPaid):key(p.brokerage)==='PAGO EMPRESA'?'':'NÃO INDICADO','cr-broker','info');
    const annotation=make('strong','cr-brokerage',`(CORRETAGEM: ${p.brokerage&& !['0','0,00'].includes(p.brokerage)?p.brokerage:'NÃO INDICADO'})`);annotation.dataset.tone=key(p.brokerage)==='PAGO EMPRESA'?'success':key(p.brokerage)==='PAGO CLIENTE'?'info':key(p.brokerage)==='PENDENTE'?'warning':'neutral';broker.append(make('br'),annotation);
    cell(tr,money(p.pending),'cr-money','warning');cell(tr,money(p.total),'cr-money cr-total','success');
    cell(tr,p.saleStatus||'SEM STATUS','',key(p.saleStatus)==='VENDIDO'?'success':key(p.saleStatus)==='NAO VENDIDO'?'danger':'neutral');
    const invoice=key(p.invoice);cell(tr,!invoice||invoice==='—'?'NÃO INFORMADO':invoice==='DISPENSADA'?'DISPENSADO':p.invoice,'cr-document',documentTone(p.invoice));
    cell(tr,p.fiscal||'—','cr-document',documentTone(p.fiscal));body.append(tr);
   });
   const total=make('tr','cr-branch-total');cell(total,'Σ TOTAL');cell(total,`${branch.properties.length} IMÓVEIS`);
   for(const [field,tone] of [['paid','success'],['formerContracts','former'],['brokerPaid','info'],['pending','warning'],['total','success']])cell(total,money(branch[field]),'cr-money',tone);
   cell(total,`✅ ${branch.properties.filter(p=>key(p.saleStatus)==='VENDIDO').length} / ❌ ${branch.properties.filter(p=>key(p.saleStatus)==='NAO VENDIDO').length}`);
   cell(total,`${branch.properties.filter(p=>!['','—','PENDENTE','NAO INFORMADO','DISPENSADO','DISPENSADA'].includes(key(p.invoice))).length} NF/RECIBO`);
   cell(total,`✅ ${branch.properties.filter(p=>key(p.fiscal)==='DECLARADO').length} / ❌ ${branch.properties.filter(p=>key(p.fiscal)==='NAO DECLARADO').length}`);body.append(total);content.append(t);
  }
 }
 function paymentTone(p,today){return p.paidDate?key(p.directBroker)==='SIM'?'info':'success':p.dueDate&&p.dueDate<today?'danger':p.dueDate===today?'warning':'neutral';}
 function pendingTable(result,today){
  content.append(make('h2','cr-heading','📅 PAGAMENTOS PREVISTOS (PENDENTES)'));
  const {table:t,body}=table('cr-pending',['🏢 Filial','🆔 Contrato','🙎 Nome','📅 Data Prevista','📄 Descrição','💰 Valor','📌 Status'],[13,7,18,12,27,11,12]);
  for(const p of result.pendingPayments){const tr=make('tr');tr.dataset.tone=paymentTone(p,today);cell(tr,p.branch||'—');cell(tr,p.contractId||'N/A');cell(tr,p.buyer||'N/A');cell(tr,formatOperationsDate(p.dueDate));cell(tr,p.description||'—');cell(tr,money(p.amount),'cr-money','danger');cell(tr,!p.dueDate?'SEM DATA':p.dueDate<today?'ATRASADO':'A VENCER','',!p.dueDate?'neutral':p.dueDate<today?'danger':'warning');body.append(tr);}
  const foot=make('tfoot'),tr=make('tr');cell(tr,'TOTAL PENDENTE:').colSpan=5;cell(tr,money(result.pendingTotal),'cr-money','danger').colSpan=2;foot.append(tr);t.append(foot);content.append(t);
 }
 function contracts(result,today){
  if(!result.detail)return;
  for(const c of result.contracts){
   const box=make('section','cr-contract');box.append(make('h2','cr-contract-title',`🏢 FILIAL: ${c.branch||'—'} | 🆔 CONTRATO: ${c.id} | 🏠 IMÓVEL: ${c.property||'—'} | 🙎 COMPRADOR: ${c.buyer||'—'}`));
   indicators(box,c.indicators,true);
   box.append(make('h3','cr-heading','🧾 RESUMO DO CONTRATO'));
   const summary=make('table','cr-contract-summary'),summaryBody=make('tbody');
   for(const fields of [[['🏢 Filial',c.branch],['🏠 Imóvel',c.property]],[['📅 Data Venda',formatOperationsDate(c.saleDate)],['🤝 Corretor',c.broker]],[['💵 Total do Contrato',money(c.total)]]]){const tr=make('tr');for(const [label,value] of fields){tr.append(make('th','',label));const n=cell(tr,value||'—');if(fields.length===1){n.colSpan=3;n.dataset.tone='danger';}}summaryBody.append(tr);}summary.append(summaryBody);box.append(summary,make('h3','cr-heading','💳 Pagamentos do contrato'));
   const {table:t,body}=table('cr-payments',['🆔 ID','📅 Data Pgto Prev.','✅ Data Pgto Efet.','📄 Descrição','💰 Valor Total','💳 Forma Pgto','🏦 Conta','📌 Status'],[5,12,12,23,12,10,15,11]);
   for(const p of c.payments){const tr=make('tr');tr.dataset.tone=paymentTone(p,today);cell(tr,p.id);cell(tr,p.dueDate?formatOperationsDate(p.dueDate):'S/ PREV','',p.dueDate?'':'danger');cell(tr,p.paidDate?formatOperationsDate(p.paidDate):'PENDENTE PGTO','',p.paidDate?'':'danger');cell(tr,p.description||'—');cell(tr,money(p.amount),'cr-money','danger');cell(tr,p.paymentMethod||'—');const account=cell(tr,p.account||'—');if(key(p.directBroker)==='SIM'){const annotation=make('strong','',' (PAGO DIRETO AO CORRETOR)');annotation.dataset.tone='info';account.append(annotation);}cell(tr,p.status||'—','',key(p.status)==='PAGAMENTO EFETUADO'?'success':'warning');body.append(tr);}
   const foot=make('tfoot');for(const [label,field,tone] of [['🟢 VALOR PAGO','paid','success'],['🔵 VALOR PAGO DIRETO AO CORRETOR','brokerPaid','info'],['🟠 VALOR PENDENTE','pending','warning'],['🔴 TOTAL GERAL','total','danger']]){const tr=make('tr');tr.dataset.tone=tone;cell(tr,label).colSpan=4;cell(tr,money(c.totals[field]),'cr-money',tone).colSpan=4;foot.append(tr);}t.append(foot);box.append(t);content.append(box);
  }
 }
 function render(){
  content.replaceChildren();showNotice('');if(!snapshot)return;
  const today=localDate(now()),result=buildCommercialReceipts(snapshot,selected(),today);
  const brand=make('div','cr-brand'),logo=make('img');logo.src=LOGO;logo.alt='Logo Energética';brand.append(logo);content.append(brand,make('h2','cr-heading','📊 INDICADORES DO RESULTADO'));
  indicators(content,result.indicators,result.detail);
  if(!result.detail)content.append(make('p','cr-instruction','🔎 SELECIONE UM NÚMERO DE CONTRATO, COMPRADOR OU IMÓVEL PARA DETALHAR UM CONTRATO EM ESPECÍFICO'));
  propertyTables(result);pendingTable(result,today);contracts(result,today);
 }
 function populate(){
  pickers?.destroy();pickers=null;
  const options=buildCommercialReceipts(snapshot,{},localDate(now())).filterOptions;
  for(const [name] of FILTERS){const select=controls.get(name),current=select.value;
   const values=[...new Set([...options[name],current].filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR',{numeric:true}));select.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));for(const value of values)select.append(Object.assign(make('option','',String(value)),{value:String(value)}));select.value=current;}
  pickers=bindSearchableFilterSelects(filters,{placement:'below'});
 }
 async function load(){
  if(root.hidden||portrait()||destroyed)return;pickers?.close();controller?.abort();const current=++revision,active=new AbortController();controller=active;snapshot=null;content.replaceChildren();showNotice('Carregando contratos e pagamentos do SharePoint…');report.setAttribute('aria-busy','true');refresh.disabled=true;
  try{const result=await data.loadSnapshot({signal:active.signal});if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;buildCommercialReceipts(result,{},localDate(now()));snapshot=result;populate();render();}
  catch(error){if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;snapshot=null;content.replaceChildren();showNotice('Não foi possível carregar os contratos e pagamentos. Use Atualizar para tentar novamente.');}
  finally{if(current===revision){report.setAttribute('aria-busy','false');refresh.disabled=false;}}
 }
 function orientationChanged(){if(root.hidden)return;const vertical=portrait();warning.hidden=!vertical;panel.classList.toggle('pl-dialog--portrait',vertical);if(vertical){pickers?.close();if(report.contains(doc.activeElement))panel.focus();controller?.abort();revision++;snapshot=null;content.replaceChildren();report.hidden=true;}else if(report.hidden){report.hidden=false;void load();}}
 function close(){if(root.hidden)return;controller?.abort();revision++;snapshot=null;pickers?.close();content.replaceChildren();root.hidden=true;doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;returnFocus?.focus?.();returnFocus=null;}
 root.addEventListener('click',e=>{if(e.target===root)close();});
 root.addEventListener('keydown',e=>{if(root.hidden)return;if(e.key==='Escape'){e.preventDefault();close();return;}if(e.key!=='Tab')return;const nodes=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(n=>!n.disabled&&!n.closest('[hidden]')&&n.tabIndex>=0),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){e.preventDefault();first?.focus();}});
 for(const node of controls.values())node.addEventListener('change',()=>{render();content.scrollTop=0;});refresh.addEventListener('click',()=>void load());print.addEventListener('click',()=>{if(snapshot)win?.print?.();});win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
 return Object.freeze({element:root,async open(){if(destroyed)throw new Error('O relatório comercial foi encerrado.');if(!root.hidden)return;returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;doc.body.style.overflow='hidden';if(app)app.inert=true;pickers?.destroy();pickers=null;for(const node of controls.values()){node.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));node.value='';}root.hidden=false;const vertical=portrait();warning.hidden=!vertical;report.hidden=vertical;panel.classList.toggle('pl-dialog--portrait',vertical);panel.focus();if(!vertical)await load();},close,destroy(){if(destroyed)return;close();destroyed=true;pickers?.destroy();win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);root.remove();}});
}
