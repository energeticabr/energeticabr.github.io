import {normalizeDdaReportRows,buildDdaReport,ddaSettlementPending,ddaWasScheduledAt,readDdaSettledProvisionIds} from '../chat/dda-report-model.js';
import {ddaDueTone,ddaTodayKey} from './dda-card.js';
import {bindReportLandscape} from './report-landscape.js';
import {addReportCloseControl} from './report-close-control.js';
import {createDdaPaymentConfirmation} from './dda-payment-confirmation.js';
import {addDdaReportBarcode} from './dda-report-barcode.js';
import {createDdaProvisionPicker} from './dda-provision-picker.js';
import {PDF_ATTACHMENT_ICON} from './report-pdf-attachment-icon.js';
const LOGO=new URL('../../../../assets/logo-energetica-oficial.png',import.meta.url).href;
const money=value=>value==null?'Não disponível':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value));
const date=value=>value?value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4):'Não informado';
const daysSince=(day,today)=>Math.round((Date.parse(`${today}T00:00:00Z`)-Date.parse(`${day}T00:00:00Z`))/86400000);
const ROW_CONTROLS=['data-dda-pdf','data-dda-mirror','data-dda-confirm-payment','data-dda-provision-pencil','data-dda-settle-provision','data-dda-toggle-barcode','data-dda-copy-barcode'];
function rowControlSelector(element){
 const attribute=ROW_CONTROLS.find(name=>element?.hasAttribute(name));
 return attribute?`[${attribute}="${element.getAttribute(attribute)}"]`:null;
}
export function createDdaReportView({document:doc=globalThis.document,data,openMediaCollection,confirmPayment,onStartLaunch,onStartSettlement,syncMonitor,copyText,onClose=()=>{},now=()=>new Date()}={}){
 if(!doc?.body||typeof data?.loadSnapshot!=='function')throw new TypeError('O relatório requer a sessão SharePoint.');
 const make=(tag,cls='',value)=>{const node=doc.createElement(tag);node.className=cls;if(value!==undefined)node.textContent=String(value);return node;};
 const button=(label,text=label)=>{const node=make('button','',text);node.type='button';node.setAttribute('aria-label',label);return node;};
 const root=make('div','pl-overlay ddr-overlay');root.hidden=true;root.tabIndex=-1;root.setAttribute('aria-busy','false');
 const panel=make('section','pl-dialog ddr-dialog');panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Relatório DDA');
 const report=make('div','pl-report ddr-report'),toolbar=make('div','pl-filters ddr-toolbar');
 const header=make('header','ddr-header-row'),logo=make('img','ddr-header-logo'),title=make('h2','ddr-header-title','RELATÓRIO DDA'),filters=make('div','ddr-filter-row');
 logo.src=LOGO;logo.alt='Energética Construtora';
 const refresh=button('Atualizar DDAs','⟳');refresh.className='pl-refresh';header.append(logo,refresh,title);toolbar.append(header,filters);
 const controls={};
 for(const [name,label,tag] of [['status','Situação','select'],['bank','Banco','select'],['search','Pesquisar fornecedor, documento ou ID','input']]){
  const holder=make('label','ddr-filter'),control=make(tag);control.name=name;control.setAttribute('aria-label',label);if(tag==='input'){control.type='search';control.placeholder='Fornecedor, documento ou ID';}
  holder.append(make('span','',label),control);filters.append(holder);controls[name]=control;
 }
 const content=make('div','pl-table-scroll ddr-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','DDAs da empresa');
 const notice=make('p','ddr-notice');notice.setAttribute('role','status');notice.hidden=true;
 report.append(toolbar,notice,content);panel.append(report);root.append(panel);doc.body.append(root);
 const landscape=bindReportLandscape(root);addReportCloseControl({root,toolbar,onClose:close});
 let rows=null,controller=null,revision=0,filterRevision=0,page=1,printAll=false,destroyed=false,returnFocus=null,app=null,oldInert=false,oldOverflow='';
 let bankRunning=Boolean(syncMonitor?.running),bankNotice='',startingBank=false,reloadPending=false,pdfRequest=null;
 let settledProvisionIds=new Set(),settlementVerified=false,settlementRequest=null,settlementRenderPending=false,settlementOpening=false;
 const expandedBarcodes=new Set();
 const paymentConfirmation=createDdaPaymentConfirmation({document:doc,host:root,confirmPayment,onStartLaunch,onLaunchStarted:()=>close(),onClose:resumeDeferredRefresh,resolveReturnFocus:replacementControl,onConfirmed:receipt=>{
  if(destroyed||root.hidden||!rows)return;
  const confirmed=rows.find(row=>row.id===String(receipt.itemId)&&row.key===receipt.key);
  if(!confirmed)return;
  const paidBySchedule=receipt.paidBySchedule??(confirmed.paidBySchedule||ddaWasScheduledAt(confirmed,receipt.confirmedAt));
  rows=rows.map(row=>row===confirmed?Object.freeze({...row,status:'Pago',paidManually:true,paidBySchedule,confirmedAt:receipt.confirmedAt}):row);
  if(confirmed.provisionId)settlementVerified=false;
  settledProvisionIds.delete(confirmed.provisionId);
  populate();renderKeepingPosition();
  if(confirmed.provisionId)void recheckSettlement();
 }});
 const provisionPicker=createDdaProvisionPicker({document:doc,host:root,service:data.provisionLink,onClose:resumeDeferredRefresh,resolveReturnFocus:replacementControl,onLinked:receipt=>{
  if(destroyed||root.hidden||!rows)return;
  rows=rows.map(row=>row.id===receipt.ddaId?Object.freeze({...row,provisionId:receipt.provisionId}):row);
  settlementVerified=false;
  settledProvisionIds.delete(receipt.provisionId);
  renderKeepingPosition();void recheckSettlement();
 }});
 const selected=()=>Object.fromEntries(Object.entries(controls).map(([key,node])=>[key,node.value]));
 const option=(label,value)=>Object.assign(make('option','',label),{value});
 function populate(){
  const result=buildDdaReport(rows,{},now());
  for(const [name,values] of [['status',result.statuses],['bank',result.banks]]){
   const current=controls[name].value;controls[name].replaceChildren(option('Todas',''),...[...new Set([...values,current].filter(Boolean))].map(value=>option(value,value)));controls[name].value=current;
  }
 }
 function showNotice(message=''){const text=message||bankNotice;notice.textContent=text;notice.hidden=!text;}
 function syncRefreshButton(){refresh.disabled=startingBank||bankRunning||root.getAttribute('aria-busy')==='true';}
 function replacementControl(trigger){
  const selector=rowControlSelector(trigger),replacement=selector&&content.querySelector(selector);
  return replacement&&!replacement.disabled?replacement:panel;
 }
 function reportPosition(){return [content.scrollTop,content.scrollLeft,doc.activeElement];}
 function restoreReportPosition([top,left,focused]){
  content.scrollTop=top;content.scrollLeft=left;
  if(rowControlSelector(focused)&&[doc.body,panel].includes(doc.activeElement))replacementControl(focused).focus({preventScroll:true});
 }
 function renderKeepingPosition(){const position=reportPosition();render();restoreReportPosition(position);}
 function nestedViewOpen(){return paymentConfirmation.isOpen||provisionPicker.isOpen||pdfRequest;}
 function renderSettlement(){
  if(!settlementRenderPending||nestedViewOpen())return;
  settlementRenderPending=false;renderKeepingPosition();
 }
 function resumeDeferredRefresh(){
  if(reloadPending||settlementRenderPending)queueMicrotask(()=>{
   if(destroyed||root.hidden)return;
   if(reloadPending)void reloadFromBank();else renderSettlement();
  });
 }
 function cancelSettlement(){settlementRequest?.abort();settlementRequest=null;settlementRenderPending=false;}
 async function recheckSettlement(){
  settlementRequest?.abort();
  const request=settlementRequest=new AbortController();
  const verified=await readDdaSettledProvisionIds(rows,data.provisionLink,request.signal);
  if(request!==settlementRequest||request.signal.aborted||root.hidden||destroyed)return;
  settlementRequest=null;
  const settled=verified??new Set();
  if(settlementVerified===Boolean(verified)&&settled.size===settledProvisionIds.size&&[...settled].every(id=>settledProvisionIds.has(id)))return;
  settlementVerified=Boolean(verified);
  settledProvisionIds=settled;settlementRenderPending=true;renderSettlement();
 }
 async function startSettlement(row,trigger){
  if(root.hidden||destroyed||settlementOpening||!settlementVerified||!rows?.includes(row)||!ddaSettlementPending(row,settledProvisionIds))return;
  const signal=controller.signal;
  const current=()=>!signal.aborted&&trigger.isConnected&&rows?.includes(row);
  settlementOpening=true;trigger.disabled=true;showNotice();
  try{
   const item=await data.loadItem(row.id,{signal});
   if(!current()||nestedViewOpen())return;
   const live=item&&normalizeDdaReportRows({rows:[item]})[0];
   if(live?.id!==row.id||live.status!=='Pago'||live.provisionId!==row.provisionId||live.key!==row.key){
    showNotice('O DDA ou seu vínculo mudou no SharePoint. Atualize o relatório antes de dar baixa.');
    return;
   }
   if(!settlementVerified||!ddaSettlementPending(row,settledProvisionIds))return;
   if(await onStartSettlement(row.provisionId))return;
   if(current())showNotice('Não foi possível abrir a baixa da provisão. Confira se há um rascunho ou outra operação em andamento.');
  }catch{
   if(current())showNotice('Não foi possível conferir o DDA ou abrir a baixa da provisão. Tente novamente.');
  }finally{
   settlementOpening=false;trigger.disabled=!settlementVerified;
  }
 }
 async function reloadFromBank(){
  if(destroyed||root.hidden){reloadPending=false;return;}
  if(nestedViewOpen()){reloadPending=true;return;}
  reloadPending=false;
  await load(undefined,reportPosition());
 }
 async function manualRefresh(){
  if(destroyed||root.hidden||refresh.disabled)return;
  if(!syncMonitor)return reloadFromBank();
  startingBank=true;syncRefreshButton();showNotice('Iniciando consulta ao Sicoob…');
  try{await syncMonitor.start();}
  catch{if(!destroyed&&!root.hidden)showNotice('Não foi possível iniciar a consulta ao Sicoob. Tente novamente.');}
  finally{startingBank=false;syncRefreshButton();}
 }
 function render(){
  if(content.contains(doc.activeElement))panel.focus({preventScroll:true});content.replaceChildren();if(!rows)return;
  const currentDate=now(),today=ddaTodayKey(currentDate),result=buildDdaReport(rows,{...selected(),settledProvisionIds},currentDate),pages=Math.max(1,Math.ceil(result.rows.length/50));page=Math.min(page,pages);
  const summary=make('div','ddr-summary');summary.dataset.ddaSummary='';
  for(const [label,value,hint] of [['DDAs encontrados',result.rows.length],['Valor nominal total',money(result.total)],['Vencidos no filtro',result.overdue],['Vencem hoje',result.today],['Qtd DDA vencendo em 7d',result.dueWithin7Days,'De hoje até daqui a 7 dias, inclusive, conforme os filtros.'],['Valor DDA vencendo em 7d',money(result.totalDueWithin7Days),'De hoje até daqui a 7 dias, inclusive, conforme os filtros.'],['Valor DDA vencendo hoje',money(result.totalDueToday),'Vencimento hoje, conforme os filtros.']]){const metric=make('div','ddr-metric');if(hint)metric.title=hint;metric.append(make('span','',label),make('strong','',value));summary.append(metric);}content.append(summary);
  content.append(make('p','ddr-source','Situação bancária ou pagamento confirmado pelo usuário. Ordenação pelo vencimento mais próximo.'));
  if(result.visibleOutsideStatus)content.append(make('p','ddr-source',`${result.visibleOutsideStatus} DDA(s) pagos com baixa pendente ficam fora dos totais da situação selecionada.`));
  if(result.missingAmounts)content.append(make('p','ddr-warning',`${result.missingAmounts} DDA(s) sem valor nominal válido. Total indisponível.`));
  if(!result.rows.length){content.append(make('p','ddr-empty','Nenhum DDA encontrado para os filtros selecionados.'));return;}
  const table=make('table','ddr-table');table.setAttribute('aria-label','DDAs da empresa');const head=make('thead'),tr=make('tr'),body=make('tbody');
  for(const label of ['ID','VENCIMENTO','FORNECEDOR','BANCO / BOLETO','DATA EMISSÃO','VALOR NOMINAL','SITUAÇÃO','VINCULAÇÃO','AÇÕES']){const th=make('th','',label);th.scope='col';if(label==='AÇÕES')th.dataset.reportScreenOnly='';tr.append(th);}head.append(tr);table.append(head,body);
  for(const row of printAll?result.rows:result.rows.slice((page-1)*50,page*50)){
   const line=make('tr');line.dataset.ddaId=row.id;
   line.toggleAttribute('data-dda-paid',row.status==='Pago');
   const due=make('td','ddr-due');due.dataset.dueTone=ddaDueTone(row.due,currentDate);
   due.append(make('span','ddr-due-date',date(row.due)));
   if(row.due)due.append(make('span','ddr-due-days',`${daysSince(today,row.due)} d`));
   const supplier=make('td','ddr-supplier'),status=make('td','ddr-status');status.dataset.status=row.status;
   supplier.append(make('span','ddr-supplier-name',row.supplier));
   const history=make('div','ddr-supplier-count');history.dataset.ddaSupplierCount='';
   if(row.supplierDdaCount!=null){
    history.append(make('strong','',`${row.supplierDdaCount} ${row.supplierDdaCount===1?'DDA registrado':'DDAs registrados'}`),make('span','','no SharePoint'));
    history.title='Total histórico do mesmo CNPJ na lista DDAS SICOOB, incluindo todos os status e datas, antes dos filtros.';
   }else{
    history.dataset.countState='unknown';history.append(make('span','','CNPJ indisponível'));
    history.title='Contagem indisponível: o registro não possui um CNPJ utilizável. O nome do fornecedor não é usado para adivinhar vínculos.';
   }
   supplier.append(history);
   const overdue=row.status==='Vencido'||(row.status==='Em aberto'&&row.due&&row.due<today);
   const cluster=make('div','ddr-status-cluster');cluster.dataset.statusTone=row.status==='Pago'?'paid':overdue?'overdue':row.status==='Em aberto'?'open':'neutral';
   cluster.append(make('strong','',overdue?'Vencido':row.status));cluster.title=row.paidManually?'Pagamento confirmado pelo usuário':row.paidBySchedule?'Pagamento por agendamento':'Situação na última consulta bancária: '+row.status;
   if(row.paidManually)cluster.append(make('small','','Confirmado pelo usuário'));
   const statusDate=row.paidManually?row.confirmedAt:row.checkedAt;
   if(statusDate){const checked=new Date(statusDate);if(Number.isFinite(checked.getTime()))cluster.append(make('small','',new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(checked)));}
   const schedule=make('div','ddr-schedule-cluster');
   schedule.dataset.scheduleState=row.paidBySchedule?'paid':row.schedule.state;
   schedule.title=row.paidBySchedule?'Pagamento por agendamento':'Agendamento na última consulta ao Sicoob';
   schedule.append(make('strong','',row.paidBySchedule?'PAGO POR AGENDAMENTO':row.schedule.label));
   const pendingSettlement=ddaSettlementPending(row,settledProvisionIds);
   if(pendingSettlement)(row.paidBySchedule?schedule:cluster).append(make('small','ddr-settlement-pending','Baixa pendente'));
   status.append(schedule,cluster);
   const link=make('td','ddr-link');const linkCluster=make('span','ddr-link-cluster',row.provisionId?`ID ${row.provisionId}`:'N/A');linkCluster.dataset.linkState=row.provisionId?'linked':'missing';
   linkCluster.title=row.provisionId?`Descritivo provisão vinculado: ID ${row.provisionId}`:'Nenhum descritivo provisão vinculado';link.append(linkCluster);
   if((schedule.dataset.scheduleState==='scheduled'||pendingSettlement)&&!row.provisionId){
    line.classList.add('ddr-scheduled-unlinked');
    link.append(make('span','ddr-link-warning','ATENÇÃO'));
   }
   const bankDocument=make('td','ddr-bank-document'),bankCluster=make('div','ddr-bank-cluster'),documentCluster=make('div','ddr-document-cluster');
   bankCluster.dataset.ddaBankCluster='';documentCluster.dataset.ddaDocumentCluster='';
   bankCluster.append(make('small','','Banco emissor'),make('strong','',row.bank||'—'));
   documentCluster.append(make('small','','Nº boleto'),make('strong','',row.document||'—'));
   bankDocument.append(bankCluster,documentCluster);
   const issued=make('td','ddr-issued-date');
   if(row.issued)issued.append(make('strong','',date(row.issued)),make('small','ddr-issued-days',`${daysSince(row.issued,today)} d`));
   else issued.append(make('span','','Não informada'));
   const files=make('td'),actions=make('div','ddr-row-actions'),check=button((row.status==='Pago'?'Pagamento já confirmado do DDA ':'Confirmar pagamento do DDA ')+row.id,'✓');
   const pencil=button('Vincular DDA '+row.id+' a descritivo provisão','✎');pencil.className='ddr-provision-pencil';pencil.dataset.ddaProvisionPencil=row.id;
   pencil.disabled=!data.provisionLink||!Number.isSafeInteger(Number(row.id))||Number(row.id)<=0;
   pencil.addEventListener('click',()=>{if(destroyed||root.hidden||root.getAttribute('aria-busy')==='true')return;void provisionPicker.show(row,pencil);});
   check.className='ddr-confirm-payment';check.dataset.ddaConfirmPayment=row.id;check.title=check.getAttribute('aria-label');
   check.disabled=row.status==='Pago'||!Number.isSafeInteger(Number(row.id))||Number(row.id)<=0||!/^[a-f0-9]{64}$/.test(row.key)||typeof confirmPayment!=='function';
   check.addEventListener('click',()=>{if(destroyed||root.hidden||root.getAttribute('aria-busy')==='true')return;paymentConfirmation.show({itemId:row.id,key:row.key,supplier:row.supplier,amount:money(row.amount),due:date(row.due)},check);});
   const open=button('Abrir espelho do DDA '+row.id,'📎 Espelho');open.dataset.ddaMirror=row.id;open.disabled=typeof data.listAttachments!=='function'||typeof data.downloadAttachment!=='function'||typeof openMediaCollection!=='function';open.addEventListener('click',()=>void openPdfs(row,open));actions.append(pencil,check,open);files.append(actions);
   if(!printAll&&pendingSettlement&&row.provisionId&&typeof onStartSettlement==='function'&&typeof data.loadItem==='function'){
    const settle=button(`Dar baixa na provisão ${row.provisionId} do DDA ${row.id}`,'Dar baixa');
    settle.className='ddr-settle-provision';settle.dataset.ddaSettleProvision=row.id;
    settle.disabled=!settlementVerified;
    if(settle.disabled)settle.title='A baixa fica disponível após a conferência da provisão no SharePoint.';
    settle.addEventListener('click',()=>void startSettlement(row,settle));actions.append(settle);
   }
    files.dataset.reportScreenOnly='';
    const id=make('td','ddr-id'),identity=make('div','ddr-row-identity');
    identity.append(make('span','ddr-id-cluster',row.id));id.append(identity);
   if(!printAll){
    const pdf=button('Abrir PDFs do DDA '+row.id,'');pdf.dataset.ddaPdf=row.id;pdf.className='ddr-open-pdf';pdf.title=pdf.getAttribute('aria-label');pdf.disabled=open.disabled;
    pdf.innerHTML=PDF_ATTACHMENT_ICON;
    pdf.addEventListener('click',()=>void openPdfs(row,pdf));
     identity.append(pdf);
    }
   line.dataset.stripe=String(body.querySelectorAll('[data-dda-id]').length%2);
   line.append(id,due,supplier,bankDocument,issued,make('td','ddr-money',money(row.amount)),status,link,files);body.append(line);
   if(!printAll)addDdaReportBarcode({document:doc,row,line,actions,expanded:expandedBarcodes,copyText,isCurrent:()=>!destroyed&&!root.hidden&&root.getAttribute('aria-busy')!=='true'});
  }
  content.append(table);
  if (!printAll) {
   const pager = make('nav', 'ddr-pager');
   pager.setAttribute('aria-label', 'Páginas do relatório');
   const previous = button('Página anterior', '‹ Anterior');
   const next = button('Próxima página', 'Próxima ›');
   previous.disabled = page === 1;
   next.disabled = page === pages;
   next.dataset.pageNext = '';
   function changePage(targetPage) {
    page = targetPage;
    render();
    content.scrollTop = 0;
   }
   previous.addEventListener('click', () => { if (!previous.disabled) changePage(page - 1); });
   next.addEventListener('click', () => { if (!next.disabled) changePage(page + 1); });
   pager.append(previous, make('span', '', `Página ${page} de ${pages} • ${result.rows.length} DDA(s)`), next);
   content.append(pager);
  }
 }
 async function openPdfs(row,trigger){
  if(root.hidden||destroyed||!rows||pdfRequest||root.getAttribute('aria-busy')==='true')return;
  const request=pdfRequest={},signal=controller.signal;
  trigger.disabled=true;showNotice();
  const currentView=()=>pdfRequest===request&&!signal.aborted&&trigger.isConnected;
  const finish=()=>{if(pdfRequest===request){pdfRequest=null;resumeDeferredRefresh();}};
  let previewStarted=false;
  try{
   const attachments=await data.listAttachments(row.id,{signal});if(!currentView())return;
   if(!Array.isArray(attachments))throw new Error('INVALID_ATTACHMENTS');
   const files=attachments.filter(item=>typeof item?.fileName==='string'&&/\.pdf$/i.test(item.fileName));
   if(!files.length){showNotice('Este DDA ainda não possui PDF anexado.');return;}
   trigger.disabled=false;
   await openMediaCollection(files.map(({fileName})=>({fileName,source:options=>{
    signal.throwIfAborted();return data.downloadAttachment(row.id,fileName,{...options,signal:options?.signal??signal});
   }})),{layout:'dda-report-pdf',signal,onClose:finish,resolveReturnFocus:()=>trigger.isConnected?trigger:panel});
   previewStarted=true;
  }catch{if(currentView())showNotice('Não foi possível abrir os PDFs. Tente novamente.');}
  finally{if(trigger.isConnected&&!signal.aborted)trigger.disabled=false;if(!previewStarted)finish();}
 }
 async function load(initialSnapshot,position,initialSettledProvisionIds){
  if(root.hidden||destroyed)return;paymentConfirmation.close();provisionPicker.close();pdfRequest=null;controller?.abort();cancelSettlement();const current=++revision,active=controller=new AbortController(),filters=filterRevision;rows=null;settledProvisionIds=new Set();settlementVerified=false;printAll=false;root.setAttribute('aria-busy','true');refresh.disabled=true;showNotice();content.replaceChildren(make('p','','Carregando DDAs do SharePoint…'));
  try{const snapshot=initialSnapshot??await data.loadSnapshot({refresh:true,signal:active.signal});if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;rows=normalizeDdaReportRows(snapshot);if(initialSettledProvisionIds){settledProvisionIds=new Set(initialSettledProvisionIds);settlementVerified=true;}populate();render();if(position&&filters===filterRevision)restoreReportPosition(position);}
  catch{if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;rows=null;const error=make('p','','Não foi possível carregar os DDAs. Tente atualizar.');error.setAttribute('role','alert');content.replaceChildren(error);}
  finally{if(current===revision){root.setAttribute('aria-busy','false');syncRefreshButton();}}
  if(rows&&current===revision&&!initialSettledProvisionIds)await recheckSettlement();
 }
 function close(){if(root.hidden)return;expandedBarcodes.clear();reloadPending=false;pdfRequest=null;paymentConfirmation.close();provisionPicker.close();controller?.abort();cancelSettlement();revision++;rows=null;printAll=false;content.replaceChildren();showNotice();root.hidden=true;doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;const target=returnFocus?.isConnected?returnFocus:doc.querySelector('[data-action="open-dda-report"]')||app;target?.focus?.();returnFocus=null;onClose();}
 const filter=()=>{filterRevision++;printAll=false;page=1;render();content.scrollTop=0;showNotice();};
 controls.status.addEventListener('change',filter);controls.bank.addEventListener('change',filter);controls.search.addEventListener('input',filter);refresh.addEventListener('click',()=>void manualRefresh());
 const unsubscribeBank=syncMonitor?.subscribe(state=>{
  if(destroyed)return;
  const finished=bankRunning&&!state.running;bankRunning=Boolean(state.running);bankNotice=state.notice||'';
  if(!root.hidden)showNotice();
  if(finished)reloadFromBank();
  syncRefreshButton();
 });
 root.addEventListener('click',event=>{if(event.target===root)close();});
 root.addEventListener('keydown',event=>{if(root.hidden)return;if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key!=='Tab')return;const nodes=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(node=>!node.disabled&&!node.closest('[hidden]')),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){event.preventDefault();first?.focus();}});
 return Object.freeze({element:root,async open({automatic=false,initialSnapshot,initialSettledProvisionIds}={}){if(destroyed)throw new Error('Relatório encerrado.');if(!root.hidden)return;returnFocus=doc.activeElement;app=doc.getElementById('app');oldInert=app?.inert||false;oldOverflow=doc.body.style.overflow;doc.body.style.overflow='hidden';if(app)app.inert=true;const initialStatus=automatic?'Não pagos':'Em aberto';controls.status.replaceChildren(option(initialStatus,initialStatus));controls.bank.replaceChildren(option('Todas',''));controls.search.value='';page=1;root.hidden=false;landscape.update();panel.focus();await load(initialSnapshot,undefined,initialSettledProvisionIds);},close,
  async preparePrint(){if(root.hidden||destroyed||!rows||root.getAttribute('aria-busy')==='true')throw new Error('Não foi possível imprimir: aguarde a consulta completa dos DDAs.');const current=revision,filters=filterRevision,position=[content.scrollTop,content.scrollLeft],oldPage=page;printAll=true;render();return()=>{if(root.hidden||destroyed||current!==revision||filters!==filterRevision)return;printAll=false;page=oldPage;render();[content.scrollTop,content.scrollLeft]=position;};},
  destroy(){if(destroyed)return;close();paymentConfirmation.destroy();destroyed=true;unsubscribeBank?.();landscape.destroy();root.remove();}});
}
