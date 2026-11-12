import {normalizeDdaReportRows,buildDdaReport,ddaSettlementPending,readSettledDdaIds,canReviewDdaUnlinked} from '../chat/dda-report-model.js';
import {ddaDueTone,ddaTodayKey} from './dda-card.js';
import {bindReportLandscape} from './report-landscape.js';
import {addReportCloseControl} from './report-close-control.js';
import {addDdaReportBarcode} from './dda-report-barcode.js';
import {createDdaProvisionPicker} from './dda-provision-picker.js';
import {PDF_ATTACHMENT_ICON} from './report-pdf-attachment-icon.js';
import {confirmedFinancialTimestamp} from '../chat/financial-update-time.js';
import {createFinancialReportLastUpdate} from './financial-report-last-update.js';
const LOGO=new URL('../../../../assets/logo-energetica-oficial.png',import.meta.url).href;
const money=value=>value==null?'Não disponível':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value));
const date=value=>value?value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4):'Não informado';
const daysSince=(day,today)=>Math.round((Date.parse(`${today}T00:00:00Z`)-Date.parse(`${day}T00:00:00Z`))/86400000);
const ROW_CONTROLS=['data-dda-pdf','data-dda-mirror','data-dda-provision-check','data-dda-provision-pencil','data-dda-settle-provision','data-dda-toggle-barcode','data-dda-copy-barcode','data-dda-unlinked-review'];
function rowControlSelector(element){
 const attribute=ROW_CONTROLS.find(name=>element?.hasAttribute(name));
 return attribute?`[${attribute}="${element.getAttribute(attribute)}"]`:null;
}
export function createDdaReportView({document:doc=globalThis.document,data,openMediaCollection,onStartSettlement,syncMonitor,copyText,onRowsChange=()=>{},onClose=()=>{},now=()=>new Date()}={}){
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
 let bankRunning=Boolean(syncMonitor?.running),startingBank=false,reloadPending=false,pdfRequest=null;
 const lastUpdate=createFinancialReportLastUpdate(doc);
 let settledDdaIds=new Set(),settlementVerified=false,settlementRequest=null,settlementRenderPending=false,settlementOpening=false;
 const expandedBarcodes=new Set();
 let settlementDialog=null,unlinkedDialog=null;
 const provisionPicker=createDdaProvisionPicker({document:doc,host:root,service:data.provisionLink,onClose:resumeDeferredRefresh,resolveReturnFocus:replacementControl,onLinked:receipt=>{
  if(destroyed||root.hidden||!rows)return;
  rows=rows.map(row=>row.id===receipt.ddaId?Object.freeze({...row,provisionId:receipt.provisionId}):row);
  settlementVerified=false;
  settledDdaIds.delete(receipt.ddaId);
  renderKeepingPosition();void recheckSettlement();
  if(receipt.dueAdjustmentNotice)showNotice(receipt.dueAdjustmentNotice);
  onRowsChange(rows,{id:receipt.ddaId,provisionId:receipt.provisionId});
 }});
 const selected=()=>Object.fromEntries(Object.entries(controls).map(([key,node])=>[key,node.value]));
 const option=(label,value)=>Object.assign(make('option','',label),{value});
 function populate(){
  const result=buildDdaReport(rows,{},now());
  for(const [name,values] of [['status',result.statuses],['bank',result.banks]]){
   const current=controls[name].value;controls[name].replaceChildren(option('Todas',''),...[...new Set([...values,current].filter(Boolean))].map(value=>option(value,value)));controls[name].value=current;
  }
 }
 function showNotice(message=''){notice.textContent=message;notice.hidden=!message;}
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
 function nestedViewOpen(){return settlementDialog||unlinkedDialog||provisionPicker.isOpen||pdfRequest;}
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
  const verified=await readSettledDdaIds(rows,data.provisionLink,request.signal,{includeUnpaid:true});
  if(request!==settlementRequest||request.signal.aborted||root.hidden||destroyed)return;
  settlementRequest=null;
  const settled=verified??settledDdaIds;
  if(settlementVerified===Boolean(verified)&&settled.size===settledDdaIds.size&&[...settled].every(id=>settledDdaIds.has(id)))return;
  settlementVerified=Boolean(verified);
  settledDdaIds=settled;settlementRenderPending=true;renderSettlement();
 }
 function canStartSettlement(row){
  return settlementVerified&&row.provisionId&&!settledDdaIds.has(row.id)
   &&Number.isSafeInteger(Number(row.id))&&Number(row.id)>0
   &&typeof onStartSettlement==='function'&&typeof data.loadItem==='function';
 }
 async function readSettlementItem(id,signal){
  signal.throwIfAborted();
  const lookup=new AbortController(),abort=()=>lookup.abort(signal.reason);
  signal.addEventListener('abort',abort,{once:true});
  const interrupted=new Promise((_,reject)=>lookup.signal.addEventListener('abort',()=>reject(lookup.signal.reason),{once:true}));
  const timeout=setTimeout(()=>lookup.abort(),30_000);
  try{return await Promise.race([data.loadItem(id,{signal:lookup.signal}),interrupted]);}
  finally{clearTimeout(timeout);signal.removeEventListener('abort',abort);}
 }
 async function startSettlement(row,trigger,{fromCheck=false,onError=showNotice}={}){
  const available=()=>canStartSettlement(row)&&(fromCheck||ddaSettlementPending(row,settledDdaIds));
  if(root.hidden||destroyed||settlementOpening||!rows?.includes(row)||!available())return false;
  const signal=controller.signal;
  const current=()=>!signal.aborted&&trigger.isConnected&&rows?.includes(row);
  settlementOpening=true;trigger.disabled=true;showNotice();
  try{
   const item=await readSettlementItem(row.id,signal);
   if(!current()||(!fromCheck&&nestedViewOpen()))return false;
   const live=item&&normalizeDdaReportRows({rows:[item]})[0];
   if(live?.id!==row.id||live.provisionId!==row.provisionId||live.due!==row.due||live.key!==row.key||(!fromCheck&&live.status!=='Pago')){
    onError('O DDA ou seu vínculo mudou no SharePoint. Atualize o relatório antes de dar baixa.');
    return false;
   }
   if(!available())return false;
   if(await onStartSettlement(row.provisionId))return true;
   if(current())onError('Não foi possível abrir a baixa da provisão. Confira se há um rascunho ou outra operação em andamento.');
  }catch{
   if(current())onError('Não foi possível conferir o DDA ou abrir a baixa da provisão. Tente novamente.');
  }finally{
   settlementOpening=false;trigger.disabled=!available();
  }
  return false;
 }
 function closeSettlementDialog(){
  if(!settlementDialog)return;
  const {overlay,trigger}=settlementDialog;settlementDialog=null;
  overlay.remove();panel.inert=false;
  (trigger.isConnected&&!trigger.disabled?trigger:replacementControl(trigger)).focus({preventScroll:true});
  resumeDeferredRefresh();
 }
 function closeUnlinkedDialog(){
  if(!unlinkedDialog)return;
  const {overlay,trigger}=unlinkedDialog;unlinkedDialog=null;
  overlay.remove();panel.inert=false;
  replacementControl(trigger).focus({preventScroll:true});
  resumeDeferredRefresh();
 }
 function askUnlinkedReview(row,trigger){
  if(destroyed||root.hidden||root.getAttribute('aria-busy')==='true'||nestedViewOpen()||settlementOpening||!rows?.includes(row))return;
  const reviewed=!row.linkReviewed;
  const question=reviewed?'Deseja tornar a não vinculação regular?':'Deseja reverter a não vinculação?';
  const overlay=make('div','gallery-record-overlay dda-payment-overlay');
  const dialog=make('section','gallery-record-dialog dda-payment-dialog');
  dialog.dataset.ddaUnlinkedDialog='';dialog.tabIndex=-1;
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',question);
  const feedback=make('p','dda-payment-feedback');feedback.setAttribute('role','status');
  const actions=make('div','gallery-record-dialog-buttons'),no=button('Não'),yes=button('Sim');
  yes.className='dda-payment-yes';actions.append(no,yes);
  dialog.append(make('h2','',question),make('p','dda-payment-summary',row.supplier+' · DDA '+row.id),feedback,actions);
  overlay.append(dialog);
  const entry=unlinkedDialog={overlay,trigger};
  no.addEventListener('click',closeUnlinkedDialog);
  yes.addEventListener('click',async()=>{
   if(yes.disabled||unlinkedDialog!==entry)return;
   no.disabled=yes.disabled=true;feedback.setAttribute('role','status');feedback.textContent='Salvando no SharePoint…';dialog.focus();
   try{
    const receipt=await data.unlinkedReview.save({row,reviewed,signal:controller.signal});
    if(unlinkedDialog!==entry)return;
    if(receipt?.id!==row.id||receipt.reviewed!==reviewed)throw new Error('Confirmação inválida.');
    rows=rows.map(item=>item.id===row.id?Object.freeze({...item,linkReviewed:reviewed}):item);
    renderKeepingPosition();closeUnlinkedDialog();onRowsChange(rows,{id:row.id,linkReviewed:reviewed});
   }catch{
    if(unlinkedDialog!==entry)return;
    feedback.setAttribute('role','alert');feedback.textContent='Não foi possível confirmar a alteração. Atualize o relatório e confira a vinculação.';
    no.disabled=yes.disabled=false;no.focus();
   }
  });
  overlay.addEventListener('keydown',event=>{
   if(event.key==='Escape'){
    event.preventDefault();event.stopPropagation();if(!no.disabled)closeUnlinkedDialog();
   }else if(event.key==='Tab'){
    event.preventDefault();event.stopPropagation();
    (no.disabled?dialog:doc.activeElement===no?yes:no).focus();
   }
  });
  panel.inert=true;root.append(overlay);no.focus();
 }
 function askSettlement(row,trigger){
  if(root.hidden||destroyed||root.getAttribute('aria-busy')==='true'||nestedViewOpen()||settlementOpening
   ||!rows?.includes(row)||!canStartSettlement(row))return;
  const overlay=make('div','gallery-record-overlay dda-payment-overlay');
  const dialog=make('section','gallery-record-dialog dda-payment-dialog');dialog.dataset.ddaSettlementDialog='';
  const question='Deseja iniciar a baixa da provisão de pagamento vinculada?';
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',question);dialog.tabIndex=-1;
  const summary=make('p','dda-payment-summary',row.supplier+' · DDA '+row.id+'\nDescritivo de pagamento: ID '+row.provisionId);
  const feedback=make('p','dda-payment-feedback');feedback.setAttribute('role','status');
  const buttons=make('div','gallery-record-dialog-buttons');
  const no=button('Não'),yes=button('Sim');no.dataset.ddaSettlementNo='';yes.dataset.ddaSettlementYes='';yes.className='dda-payment-yes';
  buttons.append(no,yes);dialog.append(make('h2','',question),summary,feedback,buttons);overlay.append(dialog);
  const entry=settlementDialog={overlay,trigger};
  no.addEventListener('click',closeSettlementDialog);
  yes.addEventListener('click',async()=>{
   if(yes.disabled||settlementDialog!==entry)return;
   no.disabled=yes.disabled=true;feedback.setAttribute('role','status');feedback.textContent='Conferindo o vínculo e abrindo a baixa…';dialog.focus();
   const started=await startSettlement(row,trigger,{fromCheck:true,onError:message=>{
    feedback.setAttribute('role','alert');feedback.textContent=message;
   }});
   if(settlementDialog!==entry)return;
   if(started){closeSettlementDialog();return;}
   if(feedback.getAttribute('role')!=='alert'){
    feedback.setAttribute('role','alert');feedback.textContent='Não foi possível iniciar a baixa. Atualize o relatório e tente novamente.';
   }
   no.disabled=false;yes.disabled=!canStartSettlement(row);no.focus();
  });
  overlay.addEventListener('keydown',event=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!no.disabled)closeSettlementDialog();}
   if(event.key==='Tab'){
    event.preventDefault();event.stopPropagation();
    const items=[no,yes].filter(node=>!node.disabled);
    if(items.length<2)(items[0]||dialog).focus();
    else (doc.activeElement===no?yes:no).focus();
   }
  });
  panel.inert=true;root.append(overlay);no.focus();
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
  startingBank=true;syncRefreshButton();showNotice();
  try{const result=await syncMonitor.start();if(result?.startWarning&&!destroyed&&!root.hidden)showNotice(result.startWarning);}
  catch{if(!destroyed&&!root.hidden)showNotice('Não foi possível iniciar a consulta ao Sicoob. Tente novamente.');}
  finally{startingBank=false;syncRefreshButton();}
 }
 function render(){
  if(content.contains(doc.activeElement))panel.focus({preventScroll:true});content.replaceChildren();if(!rows)return;
  const currentDate=now(),today=ddaTodayKey(currentDate),result=buildDdaReport(rows,{...selected(),settledDdaIds},currentDate),pages=Math.max(1,Math.ceil(result.rows.length/50));page=Math.min(page,pages);
  const summary=make('div','ddr-summary');summary.dataset.ddaSummary='';
  for(const [label,value,hint] of [['DDAs encontrados',result.rows.length],['Valor nominal total',money(result.total)],['Vencidos no filtro',result.overdue],['Vencem hoje',result.today],['Qtd DDA vencendo em 7d',result.dueWithin7Days,'De hoje até daqui a 7 dias, inclusive, conforme os filtros.'],['Valor DDA vencendo em 7d',money(result.totalDueWithin7Days),'De hoje até daqui a 7 dias, inclusive, conforme os filtros.'],['Valor DDA vencendo hoje',money(result.totalDueToday),'Vencimento hoje, conforme os filtros.']]){const metric=make('div','ddr-metric');if(hint)metric.title=hint;metric.append(make('span','',label),make('strong','',value));summary.append(metric);}
  summary.append(lastUpdate.element);content.append(summary);
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
   const pendingSettlement=ddaSettlementPending(row,settledDdaIds);
   if(pendingSettlement)(row.paidBySchedule?schedule:cluster).append(make('small','ddr-settlement-pending','Baixa pendente'));
   status.append(schedule,cluster);
   const link=make('td','ddr-link');
   const linkState=row.provisionId?'linked':row.linkReviewed?'regularized':'missing';
   const canReview=!printAll&&canReviewDdaUnlinked(row)&&typeof data.unlinkedReview?.save==='function';
   const linkCluster=make(canReview?'button':'span','ddr-link-cluster',row.provisionId?`ID ${row.provisionId}`:row.linkReviewed?'SEM VINCULAÇÃO':'N/A');
   linkCluster.dataset.linkState=linkState;
   linkCluster.title=row.provisionId?`Descritivo provisão vinculado: ID ${row.provisionId}`:row.linkReviewed?'Ausência de vinculação regularizada':'Nenhum descritivo provisão vinculado';
   if(canReview){
    linkCluster.type='button';linkCluster.dataset.ddaUnlinkedReview=row.id;
    linkCluster.addEventListener('click',()=>askUnlinkedReview(row,linkCluster));
   }
   link.append(linkCluster);
   const pencil=button('Vincular DDA '+row.id+' a descritivo provisão','✎');pencil.className='ddr-provision-pencil';pencil.dataset.ddaProvisionPencil=row.id;
   pencil.dataset.linkState=row.provisionId?'linked':'missing';
   pencil.disabled=printAll||!data.provisionLink||!Number.isSafeInteger(Number(row.id))||Number(row.id)<=0;
   pencil.addEventListener('click',()=>{if(destroyed||root.hidden||root.getAttribute('aria-busy')==='true')return;void provisionPicker.show(row,pencil);});
   link.append(pencil);
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
   const files=make('td'),actions=make('div','ddr-row-actions'),check=button(row.provisionId?'Iniciar baixa da provisão '+row.provisionId+' do DDA '+row.id:'Vincule um descritivo de pagamento ao DDA '+row.id+' para iniciar a baixa','✓');
   check.className='ddr-provision-check';check.dataset.ddaProvisionCheck=row.id;
   check.disabled=printAll||!canStartSettlement(row);
   check.title=settledDdaIds.has(row.id)?'Sem baixa pendente para este boleto':row.provisionId&&!settlementVerified
    ?'A baixa fica disponível após a conferência da provisão no SharePoint.':check.getAttribute('aria-label');
   check.addEventListener('click',()=>askSettlement(row,check));
   const open=button('Abrir espelho do DDA '+row.id,'📎 Espelho');open.dataset.ddaMirror=row.id;open.disabled=typeof data.listAttachments!=='function'||typeof data.downloadAttachment!=='function'||typeof openMediaCollection!=='function';open.addEventListener('click',()=>void openPdfs(row,open));actions.append(check,open);files.append(actions);
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
 async function load(initialSnapshot,position,initialSettledDdaIds){
  if(root.hidden||destroyed)return;
  closeSettlementDialog();closeUnlinkedDialog();provisionPicker.close();pdfRequest=null;controller?.abort();cancelSettlement();
  const current=++revision,active=controller=new AbortController(),filters=filterRevision;
  const isCurrent=()=>!active.signal.aborted&&current===revision&&!root.hidden&&!destroyed;
  rows=null;settledDdaIds=new Set();settlementVerified=false;printAll=false;
  root.setAttribute('aria-busy','true');refresh.disabled=true;showNotice();
  const loading=make('p','','Carregando DDAs do SharePoint…');
  loading.setAttribute('role','status');content.replaceChildren(loading);
  try{
   const snapshot=initialSnapshot??await data.loadSnapshot({refresh:true,signal:active.signal});
   if(!isCurrent())return;
   const nextRows=normalizeDdaReportRows(snapshot);
   let verified=initialSettledDdaIds;
   // The automatic reminder only checks paid DDAs before opening the report.
   if(!verified||nextRows.some(row=>row.provisionId&&row.status!=='Pago')){
    if(nextRows.some(row=>row.provisionId))loading.textContent='Conferindo baixas de provisões no SharePoint…';
    verified=await readSettledDdaIds(nextRows,data.provisionLink,active.signal,{includeUnpaid:true});
   }
   if(!isCurrent())return;
   settledDdaIds=new Set(verified??initialSettledDdaIds);
   settlementVerified=Boolean(verified);
   rows=nextRows;
   for(const row of rows)lastUpdate.update(confirmedFinancialTimestamp(row.checkedAt));
   populate();render();onRowsChange(rows);
   if(position&&filters===filterRevision)restoreReportPosition(position);
  }catch{
   if(!isCurrent())return;
   rows=null;
   const error=make('p','','Não foi possível carregar os DDAs. Tente atualizar.');
   error.setAttribute('role','alert');content.replaceChildren(error);
  }
  finally{if(current===revision){root.setAttribute('aria-busy','false');syncRefreshButton();}}
 }
 function close(){if(root.hidden)return;expandedBarcodes.clear();reloadPending=false;pdfRequest=null;closeSettlementDialog();closeUnlinkedDialog();provisionPicker.close();controller?.abort();cancelSettlement();revision++;rows=null;printAll=false;content.replaceChildren();showNotice();root.hidden=true;doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;const target=returnFocus?.isConnected?returnFocus:doc.querySelector('[data-action="open-dda-report"]')||app;target?.focus?.();returnFocus=null;onClose();}
 const filter=()=>{filterRevision++;printAll=false;page=1;if(rows){render();content.scrollTop=0;}showNotice();};
 controls.status.addEventListener('change',filter);controls.bank.addEventListener('change',filter);controls.search.addEventListener('input',filter);refresh.addEventListener('click',()=>void manualRefresh());
 const unsubscribeBank=syncMonitor?.subscribe(state=>{
  if(destroyed)return;
  const finished=bankRunning&&!state.running;bankRunning=Boolean(state.running);
  lastUpdate.update(state.lastSuccessfulAt);
  if(finished)reloadFromBank();
  syncRefreshButton();
 });
 root.addEventListener('click',event=>{if(event.target===root)close();});
 root.addEventListener('keydown',event=>{if(root.hidden)return;if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key!=='Tab')return;const nodes=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(node=>!node.disabled&&!node.closest('[hidden]')),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){event.preventDefault();first?.focus();}});
 return Object.freeze({element:root,async open({automatic=false,initialSnapshot,initialSettledDdaIds}={}){if(destroyed)throw new Error('Relatório encerrado.');if(!root.hidden)return;returnFocus=doc.activeElement;app=doc.getElementById('app');oldInert=app?.inert||false;oldOverflow=doc.body.style.overflow;doc.body.style.overflow='hidden';if(app)app.inert=true;const initialStatus=automatic?'Não pagos':'Em aberto';controls.status.replaceChildren(option(initialStatus,initialStatus));controls.bank.replaceChildren(option('Todas',''));controls.search.value='';page=1;root.hidden=false;landscape.update();panel.focus();await load(initialSnapshot,undefined,initialSettledDdaIds);},close,
  async preparePrint(){if(root.hidden||destroyed||!rows||unlinkedDialog||root.getAttribute('aria-busy')==='true')throw new Error('Não foi possível imprimir: aguarde a consulta completa dos DDAs.');const current=revision,filters=filterRevision,position=[content.scrollTop,content.scrollLeft],oldPage=page;printAll=true;render();return()=>{if(root.hidden||destroyed||current!==revision||filters!==filterRevision)return;printAll=false;page=oldPage;render();[content.scrollTop,content.scrollLeft]=position;};},
  destroy(){if(destroyed)return;close();destroyed=true;unsubscribeBank?.();landscape.destroy();root.remove();}});
}
