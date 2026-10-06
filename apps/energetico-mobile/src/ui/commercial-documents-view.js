import {buildCommercialDocuments} from '../chat/commercial-documents-model.js';
import {formatOperationsDate} from '../chat/operations-reports-model.js';
import {bindSearchableFilterSelects} from './searchable-filter-selects.js';

const LOGO=new URL('../../../../assets/logo-energetica-oficial.png',import.meta.url).href;
const FILTERS=[['branch','FILIAL'],['contractId','NUMERO CONTRATO'],['buyer','COMPRADOR'],['property','IMÓVEL'],['saleStatus','STATUS IMÓVEL']];
const IDS=[['fiscalDocument','IDDOCFISCAL'],['fiscalPayment','IDPGTOFISCAL'],['brokerPayment','ID PGTO. CORRETAGEM'],['brokerDocument','ID DOC. CORRETAGEM'],['insurance','🛡️ SEGURO'],['proposal','ID PROPOSTA'],['bankContract','ID CONTRATO CAIXA'],['deed','ID ESCRITURA']];
const CARDS=[['insurance','🛡️ SEGURO'],['proposal','📄 ID PROPOSTA'],['bankContract','🏦 ID CONTRATO CAIXA'],['deed','🖋️ ID ESCRITURA'],['brokerDocument','🤝 ID DOC. CORRETAGEM'],['brokerPayment','💳 ID PGTO. CORRETAGEM'],['fiscalDocument','🧾 ID DOC. FISCAL']];
const key=v=>String(v??'').trim().toUpperCase();
const today=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const amount=v=>{if(v==null||String(v).trim()==='')return 'PENDENTE';const text=String(v).trim();const n=typeof v==='number'?v:Number(text.includes(',')?text.replaceAll('.','').replace(',','.'):text);return Number.isFinite(n)?n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):text;};

export function createCommercialDocumentsReportView({document:doc=globalThis.document,data,now=()=>new Date()}={}){
 if(!doc?.body||typeof data?.loadSnapshot!=='function')throw new TypeError('O relatório requer documento e sessão SharePoint.');
 const win=doc.defaultView;
 const make=(tag,cls='',text)=>{const n=doc.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const tone=(node,value)=>{node.dataset.tone=({red:'danger',green:'success',amber:'warning'})[value]||value;return node;};
 const root=make('div','pl-overlay cd-overlay');root.hidden=true;
 const panel=make('section','pl-dialog cd-dialog');panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Pendências documentais dos imóveis');
 const warning=make('p','pl-orientation','PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');warning.setAttribute('role','status');
 const report=make('div','pl-report cd-report');report.hidden=true;
 const filters=make('div','pl-filters cd-filters'),controls=new Map();
 const refresh=make('button','pl-refresh','⟳');refresh.type='button';refresh.setAttribute('aria-label','Atualizar pendências comerciais');filters.append(refresh);
 for(const [name,label] of FILTERS){const holder=make('label','pl-filter'),select=make('select');select.name=name;select.setAttribute('aria-label',label);holder.append(make('span','pl-filter-label',label),select);filters.append(holder);controls.set(name,select);}
 const notice=make('p','pl-notice');notice.hidden=true;notice.setAttribute('role','status');
 const content=make('div','pl-table-scroll cd-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Indicadores e detalhamento das pendências comerciais');
 report.append(filters,notice,content);panel.append(warning,report);root.append(panel);doc.body.append(root);
 let snapshot=null,controller=null,revision=0,pickers=null,destroyed=false,returnFocus=null,oldOverflow='',app=null,oldInert=false;
 const portrait=()=>win?.matchMedia?win.matchMedia('(orientation: portrait)').matches:win?.innerHeight>win?.innerWidth;
 const showNotice=text=>{notice.textContent=text;notice.hidden=!text;};
 const selected=()=>Object.fromEntries([...controls].map(([name,node])=>[name,node.value]));
 function table(cls,titles){const n=make('table',cls),head=make('thead'),tr=make('tr'),body=make('tbody');for(const label of titles){const th=make('th','',label);th.scope='col';tr.append(th);}head.append(tr);n.append(head,body);return {table:n,body};}
 function statusCell(value,success,summary=true){const k=key(value);const dispensed=summary&&k==='DISPENSADO';const valid=k===success;let label=dispensed?'⚠️ DISPENSADO':valid?`✅ ${success}`:k==='INATIVO'?'❌ INATIVO':['NÃO VENDIDO','NAO VENDIDO'].includes(k)?'❌ NÃO VENDIDO':'❌ PENDENTE';return tone(make('td','cd-status',label),dispensed?'warning':valid?'success':'danger');}
 function idCell(row,name,detail=false){
  const state=row.ids[name],cell=make('td','cd-id'),value=state.value;
  const detailPlain=detail&&name!=='fiscalPayment';
  const cellTone=detailPlain?(value?'neutral':'danger'):state.tone;
  tone(cell,cellTone);if(!detailPlain&&key(value)==='DISPENSADO')cell.dataset.dispensed='true';
  const label=detailPlain?(value||'PENDENTE'):detail?state.label:`${cell.dataset.tone==='success'?'✅':cell.dataset.tone==='warning'?'⚠️':'❌'} ${state.label}`;
  cell.append(make('strong','',label));
  if(value&&(detailPlain||key(value)!=='DISPENSADO')){
   if(name==='fiscalPayment'&&!state.date){if(detail)cell.append(make('small','','PAGAMENTO NÃO EFETUADO'));}
   else {const date=make('small','cd-date',state.date?`📅 ${formatOperationsDate(state.date)}`:'📅 SEM DATA');if(name==='brokerPayment'&&!state.date)tone(date,'warning');cell.append(date);}
  }
  return cell;
 }
 function summary(result){
  content.append(make('p','cd-instruction','🔎 SELECIONE UM NÚMERO DE CONTRATO, COMPRADOR OU IMÓVEL PARA DETALHAR POR IMÓVEL'),make('h2','cd-heading','🆔 PENDÊNCIAS POR CAMPO DE ID'));
  const all=result.branches.flatMap(b=>b.rows),cards=make('div','cd-cards');
  for(const [field,label] of [...CARDS,['total','📏 TOTAL (MEDIDAS)']]){const value=field==='total'?all.reduce((sum,row)=>sum+row.pendingMeasures,0):all.filter(row=>!row[field]).length;const card=tone(make('div','cd-card'),value?'danger':'success');card.dataset.metric=field;card.append(make('span','',label),make('strong','',String(value)));cards.append(card);}
  content.append(cards);
  for(const branch of result.branches){
   const section=make('section','cd-branch-section');section.append(make('h3','cd-branch-heading',`🏢 FILIAL: ${branch.name}`));
   const titles=['🏠 IMÓVEL','❌ PENDÊNCIAS','👮 SITUAÇÃO FISCAL','IDDOCFISCAL','IDPGTOFISCAL','📌 COMERCIAL',...IDS.slice(2).map(([,label])=>label),'🟢 STATUS'];
   const {table:n,body}=table('cd-properties',titles);
   // All thirteen columns fit the landscape viewport; long IDs and labels wrap inside their cell.
   const cols=make('colgroup');for(const width of [7,6,9,7,7,9,8,8,6,8,9,8,8]){const col=make('col');col.style.width=`${width}%`;cols.append(col);}n.prepend(cols);
   const columnNames=['property','pendingMeasures','fiscal','fiscalDocument','fiscalPayment','saleStatus','brokerPayment','brokerDocument','insurance','proposal','bankContract','deed','visualStatus'];
   [...n.querySelectorAll('thead th')].forEach((th,i)=>{const name=columnNames[i];if(IDS.some(([id])=>id===name)&&branch.rows.every(row=>row[name]))tone(th,'success');});
   for(const row of branch.rows){const tr=make('tr');tr.append(make('td','cd-property',row.property),tone(make('td','cd-count',String(row.pendingMeasures)),row.pendingMeasures?'danger':'success'),tone(make('td','cd-status',key(row.fiscal)==='DECLARADO'?'✅ DECLARADO':'❌ NÃO DECLARADO'),key(row.fiscal)==='DECLARADO'?'success':'danger'),idCell(row,'fiscalDocument'),idCell(row,'fiscalPayment'),statusCell(row.saleStatus,'VENDIDO'),...IDS.slice(2).map(([name])=>idCell(row,name)),statusCell(row.visualStatus,'ATIVO'));body.append(tr);}
   const foot=make('tfoot'),tr=make('tr');
   for(const name of columnNames){let text='';let totalTone='neutral';if(name==='property')text='TOTAL DA FILIAL';else if(name==='pendingMeasures'){const count=branch.rows.reduce((sum,row)=>sum+row.pendingMeasures,0);text=count?String(count):'✅ SEM PEND.';totalTone=count?'danger':'success';}else if(IDS.some(([id])=>id===name)){const count=branch.rows.filter(row=>!row[name]).length;text=`${count} ❌ PEND.`;totalTone=count?'danger':'success';}else if(name==='fiscal'){const count=branch.rows.filter(row=>key(row.fiscal)==='DECLARADO').length;text=`${count} ✅ DECL.\n${branch.rows.length-count} ❌ NÃO DECL.`;}else if(name==='saleStatus')text=`${branch.rows.filter(row=>key(row.saleStatus)==='VENDIDO').length} ✅ VENDIDO(S)\n${branch.rows.filter(row=>['NÃO VENDIDO','NAO VENDIDO'].includes(key(row.saleStatus))).length} ❌ NÃO VENDIDO(S)`;else if(name==='visualStatus')text=`${branch.rows.filter(row=>key(row.visualStatus)==='ATIVO').length} ATIVO(S)\n${branch.rows.filter(row=>key(row.visualStatus)==='INATIVO').length} INATIVO(S)`;tr.append(tone(make('td','',text),totalTone));}
   foot.append(tr);n.append(foot);section.append(n);content.append(section);
  }
 }
 function fieldCell(value,cls='',money=false){const cell=make('td',cls,money?amount(value):value||'PENDENTE');if(value==null||String(value).trim()==='')tone(cell,'danger');return cell;}
 function pair(body,label,value,label2,value2){const tr=make('tr');tr.append(make('th','',label),value,make('th','',label2),value2);body.append(tr);}
 function sectionRow(body,label,cls=''){const tr=make('tr',`cd-detail-section ${cls}`),cell=make('th','',label);cell.colSpan=4;tr.append(cell);body.append(tr);}
 function wide(body,label,value){const tr=make('tr'),cell=fieldCell(value);cell.colSpan=3;tr.append(make('th','',label),cell);body.append(tr);}
 function detail(result){
  for(const row of result.branches.flatMap(b=>b.rows)){
   const section=make('section','cd-property-detail');section.append(make('h3','cd-branch-heading',`🏢 FILIAL: ${row.branch}   |   🏠 IMÓVEL: ${row.property}`));
   const count=tone(make('div','cd-detail-count'),row.pendingMeasures?'danger':'success');count.append(make('span','','❌ TOTAL DE PENDÊNCIAS'),make('strong','',String(row.pendingMeasures)));section.append(count);
   const n=make('table','cd-detail-fields'),body=make('tbody');n.append(body);
   pair(body,'📌 Status Comercial',statusCell(row.saleStatus,'VENDIDO',false),'🟢 Status',statusCell(row.visualStatus,'ATIVO',false));
   sectionRow(body,'🧾 INFORMAÇÕES FISCAIS','cd-fiscal-heading');
   pair(body,'Fiscal',tone(make('td','',key(row.fiscal)==='DECLARADO'?'DECLARADO':'NÃO DECLARADO'),key(row.fiscal)==='DECLARADO'?'success':'danger'),'ID Pgto. Fiscal',idCell(row,'fiscalPayment',true));
   pair(body,'ID Documento Fiscal',idCell(row,'fiscalDocument',true),'Valor Fiscal',fieldCell(row.fiscalValue,'cd-money-danger',true));wide(body,'Observação Fiscal',row.fiscalObservation);
   sectionRow(body,'🤝 INFORMAÇÕES DE CORRETAGEM','cd-broker-heading');pair(body,'Corretagem',fieldCell(row.brokerage),'Corretor',fieldCell(row.broker));pair(body,'ID Documento Corretagem',idCell(row,'brokerDocument',true),'Valor Corretagem',fieldCell(row.brokerValue,'cd-money-blue',true));wide(body,'Descritivo Corretagem',row.brokerDescription);
   sectionRow(body,'📂 DOCUMENTOS DO IMÓVEL','cd-document-heading');pair(body,'ID Escritura',idCell(row,'deed',true),'ID Contrato Caixa',idCell(row,'bankContract',true));section.append(n);
   if(!row.contracts.length)section.append(make('p','cd-empty','NENHUM CONTRATO ENCONTRADO PARA ESTE IMÓVEL'));
   for(const contract of row.contracts){
    const card=make('section','cd-contract');card.append(make('h4','cd-contract-heading','📄 INFORMAÇÕES DO CONTRATO'));
    const info=make('table','cd-detail-fields'),details=make('tbody');info.append(details);
    pair(details,'Nº Contrato',fieldCell(contract.id),'Comprador',fieldCell(contract.buyer));pair(details,'Data Cadastro Contrato',fieldCell(contract.saleDate?formatOperationsDate(contract.saleDate):''),'Status Contrato',tone(fieldCell(contract.status),['ATIVO','VENDIDO'].includes(key(contract.status))?'success':'danger'));pair(details,'Corretor Contrato',fieldCell(contract.broker),'Valor Total Contrato',fieldCell(contract.total,'cd-money-danger',true));card.append(info,make('h4','cd-payment-heading','💳 DETALHAMENTO PGTOS'));
    const {table:payments,body:rows}=table('cd-payments',['ID','Data Prevista','Data Efetiva','Descrição','Valor','Status']);
    if(!contract.payments.length){const tr=make('tr'),cell=tone(make('td','','NENHUM PAGAMENTO CADASTRADO'),'danger');cell.colSpan=6;tr.append(cell);rows.append(tr);}
    for(const payment of contract.payments){const tr=make('tr');tr.dataset.tone=payment.paidDate?'success':payment.dueDate&&payment.dueDate<today(now())?'danger':'neutral';const id=fieldCell(payment.id);if(payment.createdDate)id.append(make('small','cd-date',`📅 ${formatOperationsDate(payment.createdDate)}`));tr.append(id,fieldCell(payment.dueDate?formatOperationsDate(payment.dueDate):''),fieldCell(payment.paidDate?formatOperationsDate(payment.paidDate):''),fieldCell(payment.description),fieldCell(payment.amount,'cd-money-danger',true),tone(fieldCell(payment.status),!payment.status?'danger':payment.paidDate?'success':'warning'));rows.append(tr);}
    card.append(payments);section.append(card);
   }
   content.append(section);
  }
 }
 function render(){
  content.replaceChildren();showNotice('');if(!snapshot)return;
  const result=buildCommercialDocuments(snapshot,selected(),today(now()));
  const brand=make('div','cd-brand'),logo=make('img');logo.src=LOGO;logo.alt='Logo Energética';brand.append(logo);content.append(brand);
  if(!result.branches.length){content.append(make('p','cd-empty','NENHUM IMÓVEL ENCONTRADO PARA OS FILTROS SELECIONADOS'));return;}
  if(result.detail)detail(result);else summary(result);
 }
 function populate(){
  pickers?.destroy();pickers=null;const options=buildCommercialDocuments(snapshot,{},today(now())).filterOptions;
  for(const [name] of FILTERS){const select=controls.get(name),current=select.value,unique=[...new Set([...(options[name]||[]),current].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));select.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));for(const value of unique)select.append(Object.assign(make('option','',value),{value}));select.value=current;}
  pickers=bindSearchableFilterSelects(filters,{placement:'below'});
 }
 async function load(){
  if(root.hidden||portrait()||destroyed)return;pickers?.close();controller?.abort();const current=++revision,active=new AbortController();controller=active;snapshot=null;content.replaceChildren();showNotice('Carregando pendências comerciais do SharePoint…');report.setAttribute('aria-busy','true');refresh.disabled=true;
  try{const result=await data.loadSnapshot({signal:active.signal});if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;buildCommercialDocuments(result,{},today(now()));snapshot=result;populate();render();}
  catch(error){if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;snapshot=null;content.replaceChildren();showNotice('Não foi possível carregar as pendências comerciais. Use Atualizar para tentar novamente.');}
  finally{if(current===revision){report.setAttribute('aria-busy','false');refresh.disabled=false;}}
 }
 function orientationChanged(){if(root.hidden)return;const vertical=portrait();warning.hidden=!vertical;panel.classList.toggle('pl-dialog--portrait',vertical);if(vertical){pickers?.close();if(report.contains(doc.activeElement))panel.focus();controller?.abort();revision++;snapshot=null;content.replaceChildren();report.hidden=true;}else if(report.hidden){report.hidden=false;void load();}}
 function close(){if(root.hidden)return;controller?.abort();revision++;snapshot=null;pickers?.close();content.replaceChildren();root.hidden=true;doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;returnFocus?.focus?.();returnFocus=null;}
 root.addEventListener('click',e=>{if(e.target===root)close();});
 root.addEventListener('keydown',e=>{if(root.hidden)return;if(e.key==='Escape'){e.preventDefault();close();return;}if(e.key!=='Tab')return;const nodes=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(n=>!n.disabled&&!n.closest('[hidden]')&&n.tabIndex>=0),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){e.preventDefault();first?.focus();}});
 for(const node of controls.values())node.addEventListener('change',()=>{render();content.scrollTop=0;});refresh.addEventListener('click',()=>void load());win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
 return Object.freeze({element:root,async open(){
  if(destroyed)throw new Error('O relatório foi encerrado.');if(!root.hidden)return;returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;doc.body.style.overflow='hidden';if(app)app.inert=true;pickers?.destroy();pickers=null;for(const node of controls.values()){node.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));node.value='';}root.hidden=false;const vertical=portrait();warning.hidden=!vertical;report.hidden=vertical;panel.classList.toggle('pl-dialog--portrait',vertical);panel.focus();if(!vertical)await load();
 },close,destroy(){if(destroyed)return;close();destroyed=true;pickers?.destroy();win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);root.remove();}});
}
