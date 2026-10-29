import {normalizeDdaReportRows,buildDdaReport} from '../chat/dda-report-model.js';
import {ddaDueTone,ddaTodayKey} from './dda-card.js';
import {bindReportLandscape} from './report-landscape.js';
import {addReportCloseControl} from './report-close-control.js';
import {createDdaPaymentConfirmation} from './dda-payment-confirmation.js';
import {addDdaReportBarcode} from './dda-report-barcode.js';
import {createDdaProvisionPicker} from './dda-provision-picker.js';
const LOGO=new URL('../../../../assets/logo-energetica-oficial.png',import.meta.url).href;
const money=value=>value==null?'Não disponível':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value));
const date=value=>value?value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4):'Não informado';
export function createDdaReportView({document:doc=globalThis.document,data,openMediaCollection,confirmPayment,syncMonitor,copyText,onClose=()=>{},now=()=>new Date()}={}){
 if(!doc?.body||typeof data?.loadSnapshot!=='function')throw new TypeError('O relatório requer a sessão SharePoint.');
 const make=(tag,cls='',value)=>{const node=doc.createElement(tag);node.className=cls;if(value!==undefined)node.textContent=String(value);return node;};
 const button=(label,text=label)=>{const node=make('button','',text);node.type='button';node.setAttribute('aria-label',label);return node;};
 const root=make('div','pl-overlay ddr-overlay');root.hidden=true;root.tabIndex=-1;root.setAttribute('aria-busy','false');
 const panel=make('section','pl-dialog ddr-dialog');panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Relatório DDA');
 const report=make('div','pl-report ddr-report'),toolbar=make('div','pl-filters ddr-toolbar');
 const refresh=button('Atualizar DDAs','⟳');refresh.className='pl-refresh';toolbar.append(refresh);
 const controls={};
 for(const [name,label,tag] of [['status','Situação','select'],['bank','Banco','select'],['search','Pesquisar fornecedor, documento ou ID','input']]){
  const holder=make('label','ddr-filter'),control=make(tag);control.name=name;control.setAttribute('aria-label',label);if(tag==='input'){control.type='search';control.placeholder='Fornecedor, documento ou ID';}
  holder.append(make('span','',label),control);toolbar.append(holder);controls[name]=control;
 }
 const content=make('div','pl-table-scroll ddr-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','DDAs da empresa');
 const notice=make('p','ddr-notice');notice.setAttribute('role','status');notice.hidden=true;
 report.append(toolbar,notice,content);panel.append(report);root.append(panel);doc.body.append(root);
 const landscape=bindReportLandscape(root);addReportCloseControl({root,toolbar,onClose:close});
 let rows=null,controller=null,revision=0,filterRevision=0,page=1,printAll=false,destroyed=false,returnFocus=null,app=null,oldInert=false,oldOverflow='';
 let bankRunning=Boolean(syncMonitor?.running),bankNotice='',startingBank=false,reloadAfterPayment=false;
 const expandedBarcodes=new Set();
 const paymentConfirmation=createDdaPaymentConfirmation({document:doc,host:root,confirmPayment,onClose:()=>{if(reloadAfterPayment)queueMicrotask(reloadFromBank);},onConfirmed:receipt=>{
  if(destroyed||root.hidden||!rows)return;
  const position=[content.scrollTop,content.scrollLeft];
  rows=rows.map(row=>row.id===String(receipt.itemId)&&row.key===receipt.key
   ?Object.freeze({...row,status:'Pago',paidManually:true,confirmedAt:receipt.confirmedAt}):row);
  populate();render();[content.scrollTop,content.scrollLeft]=position;
 }});
 const provisionPicker=createDdaProvisionPicker({document:doc,host:root,service:data.provisionLink,onLinked:receipt=>{
  if(destroyed||root.hidden||!rows)return;const position=[content.scrollTop,content.scrollLeft];
  rows=rows.map(row=>row.id===receipt.ddaId?Object.freeze({...row,provisionId:receipt.provisionId}):row);
  render();[content.scrollTop,content.scrollLeft]=position;
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
 function reloadFromBank(){
  if(destroyed||root.hidden){reloadAfterPayment=false;return;}
  if(paymentConfirmation.isOpen){reloadAfterPayment=true;return;}
  reloadAfterPayment=false;void load();
 }
 async function manualRefresh(){
  if(destroyed||root.hidden||refresh.disabled)return;
  if(!syncMonitor)return load();
  startingBank=true;syncRefreshButton();showNotice('Iniciando consulta ao Sicoob…');
  try{await syncMonitor.start();}
  catch{if(!destroyed&&!root.hidden)showNotice('Não foi possível iniciar a consulta ao Sicoob. Tente novamente.');}
  finally{startingBank=false;syncRefreshButton();}
 }
 function render(){
  if(content.contains(doc.activeElement))panel.focus({preventScroll:true});content.replaceChildren();if(!rows)return;
  const result=buildDdaReport(rows,selected(),now()),pages=Math.max(1,Math.ceil(result.rows.length/50));page=Math.min(page,pages);
  const heading=make('header','ddr-heading'),logo=make('img');logo.src=LOGO;logo.alt='Energética Construtora';heading.append(logo,make('h2','','RELATÓRIO DDA'));content.append(heading);
  const summary=make('div','ddr-summary');summary.dataset.ddaSummary='';
  for(const [label,value] of [['DDAs encontrados',result.rows.length],['Valor nominal total',money(result.total)],['Vencidos no filtro',result.overdue],['Vencem hoje',result.today]]){const metric=make('div','ddr-metric');metric.append(make('span','',label),make('strong','',value));summary.append(metric);}content.append(summary);
  content.append(make('p','ddr-source','Situação bancária ou pagamento confirmado pelo usuário. Ordenação pelo vencimento mais próximo.'));
  if(result.missingAmounts)content.append(make('p','ddr-warning',`${result.missingAmounts} DDA(s) sem valor nominal válido. Total indisponível.`));
  if(!result.rows.length){content.append(make('p','ddr-empty','Nenhum DDA encontrado para os filtros selecionados.'));return;}
  const table=make('table','ddr-table');table.setAttribute('aria-label','DDAs da empresa');const head=make('thead'),tr=make('tr'),body=make('tbody');
  for(const label of ['ID','VENCIMENTO','FORNECEDOR','DOCUMENTO','BANCO','VALOR NOMINAL','SITUAÇÃO','VINCULAÇÃO','AÇÕES']){const th=make('th','',label);th.scope='col';tr.append(th);}head.append(tr);table.append(head,body);
  for(const row of printAll?result.rows:result.rows.slice((page-1)*50,page*50)){
   const line=make('tr');line.dataset.ddaId=row.id;const due=make('td','ddr-due',date(row.due));due.dataset.dueTone=ddaDueTone(row.due,now());
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
   const overdue=row.status==='Vencido'||(row.status==='Em aberto'&&row.due&&row.due<ddaTodayKey(now()));
   const cluster=make('div','ddr-status-cluster');cluster.dataset.statusTone=row.status==='Pago'?'paid':overdue?'overdue':row.status==='Em aberto'?'open':'neutral';
   cluster.append(make('strong','',overdue?'Vencido':row.status));cluster.title=row.paidManually?'Pagamento confirmado pelo usuário':'Situação na última consulta bancária: '+row.status;
   if(row.paidManually)cluster.append(make('small','','Confirmado pelo usuário'));
   const statusDate=row.paidManually?row.confirmedAt:row.checkedAt;
   if(statusDate){const checked=new Date(statusDate);if(Number.isFinite(checked.getTime()))cluster.append(make('small','',new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(checked)));}
   status.append(cluster);
   const link=make('td','ddr-link');const linkCluster=make('span','ddr-link-cluster',row.provisionId?`ID ${row.provisionId}`:'N/A');linkCluster.dataset.linkState=row.provisionId?'linked':'missing';
   linkCluster.title=row.provisionId?`Descritivo provisão vinculado: ID ${row.provisionId}`:'Nenhum descritivo provisão vinculado';link.append(linkCluster);
   const files=make('td'),actions=make('div','ddr-row-actions'),check=button((row.status==='Pago'?'Pagamento já confirmado do DDA ':'Confirmar pagamento do DDA ')+row.id,'✓');
   const pencil=button('Vincular DDA '+row.id+' a descritivo provisão','✎');pencil.className='ddr-provision-pencil';pencil.dataset.ddaProvisionPencil=row.id;
   pencil.disabled=!data.provisionLink||!Number.isSafeInteger(Number(row.id))||Number(row.id)<=0;
   pencil.addEventListener('click',()=>{if(destroyed||root.hidden||root.getAttribute('aria-busy')==='true')return;void provisionPicker.show(row,pencil);});
   check.className='ddr-confirm-payment';check.dataset.ddaConfirmPayment=row.id;check.title=check.getAttribute('aria-label');
   check.disabled=row.status==='Pago'||!Number.isSafeInteger(Number(row.id))||Number(row.id)<=0||!/^[a-f0-9]{64}$/.test(row.key)||typeof confirmPayment!=='function';
   check.addEventListener('click',()=>{if(destroyed||root.hidden||root.getAttribute('aria-busy')==='true')return;paymentConfirmation.show({itemId:row.id,key:row.key,supplier:row.supplier,amount:money(row.amount),due:date(row.due)},check);});
   const open=button('Abrir espelho do DDA '+row.id,'📎 Espelho');open.dataset.ddaMirror=row.id;open.disabled=typeof data.listAttachments!=='function'||typeof data.downloadAttachment!=='function'||typeof openMediaCollection!=='function';open.addEventListener('click',()=>void openMirror(row,open));actions.append(pencil,check,open);files.append(actions);
   line.dataset.stripe=String(body.querySelectorAll('[data-dda-id]').length%2);
   line.append(make('td','ddr-id',row.id),due,supplier,make('td','',row.document||'—'),make('td','',row.bank||'—'),make('td','ddr-money',money(row.amount)),status,link,files);body.append(line);
   if(!printAll)addDdaReportBarcode({document:doc,row,line,actions,expanded:expandedBarcodes,copyText,isCurrent:()=>!destroyed&&!root.hidden&&root.getAttribute('aria-busy')!=='true'});
  }
  content.append(table);
  if(!printAll){const pager=make('nav','ddr-pager');pager.setAttribute('aria-label','Páginas do relatório');const previous=button('Página anterior','‹ Anterior'),next=button('Próxima página','Próxima ›');previous.disabled=page===1;next.disabled=page===pages;next.dataset.pageNext='';previous.addEventListener('click',()=>{page--;render();});next.addEventListener('click',()=>{page++;render();});pager.append(previous,make('span','',`Página ${page} de ${pages} • ${result.rows.length} DDA(s)`),next);content.append(pager);}
 }
 async function openMirror(row,button){
  const current=revision,active=controller;if(root.hidden||destroyed||!rows||root.getAttribute('aria-busy')==='true')return;button.disabled=true;showNotice();
  const currentView=()=>!destroyed&&!root.hidden&&current===revision&&button.isConnected&&!active?.signal.aborted;
  try{
   const attachments=await data.listAttachments(row.id,{signal:active?.signal});if(!currentView())return;
   if(!Array.isArray(attachments))throw new Error('INVALID_ATTACHMENTS');
   const files=attachments.filter(item=>typeof item?.fileName==='string'&&/\.pdf$/i.test(item.fileName));
   if(!files.length){showNotice('Este DDA ainda não possui espelho PDF anexado.');return;}
   await openMediaCollection(files.map(item=>({fileName:item.fileName,source:options=>{if(destroyed||root.hidden||current!==revision)throw new Error('A consulta do DDA foi encerrada.');return data.downloadAttachment(row.id,item.fileName,options);}})));
  }catch{if(currentView())showNotice('Não foi possível abrir o espelho. Tente novamente.');}
  finally{if(currentView())button.disabled=false;}
 }
 async function load(initialSnapshot){
  if(root.hidden||destroyed)return;paymentConfirmation.close();provisionPicker.close();controller?.abort();const current=++revision,active=controller=new AbortController();rows=null;printAll=false;root.setAttribute('aria-busy','true');refresh.disabled=true;showNotice();content.replaceChildren(make('p','','Carregando DDAs do SharePoint…'));
  try{const snapshot=initialSnapshot??await data.loadSnapshot({refresh:true,signal:active.signal});if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;rows=normalizeDdaReportRows(snapshot);populate();render();}
  catch{if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;rows=null;const error=make('p','','Não foi possível carregar os DDAs. Tente atualizar.');error.setAttribute('role','alert');content.replaceChildren(error);}
  finally{if(current===revision){root.setAttribute('aria-busy','false');syncRefreshButton();}}
 }
 function close(){if(root.hidden)return;expandedBarcodes.clear();reloadAfterPayment=false;paymentConfirmation.close();provisionPicker.close();controller?.abort();revision++;rows=null;printAll=false;content.replaceChildren();showNotice();root.hidden=true;doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;const target=returnFocus?.isConnected?returnFocus:doc.querySelector('[data-action="open-dda-report"]')||app;target?.focus?.();returnFocus=null;onClose();}
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
 return Object.freeze({element:root,async open({automatic=false,initialSnapshot}={}){if(destroyed)throw new Error('Relatório encerrado.');if(!root.hidden)return;returnFocus=doc.activeElement;app=doc.getElementById('app');oldInert=app?.inert||false;oldOverflow=doc.body.style.overflow;doc.body.style.overflow='hidden';if(app)app.inert=true;const initialStatus=automatic?'Não pagos':'Em aberto';controls.status.replaceChildren(option(initialStatus,initialStatus));controls.bank.replaceChildren(option('Todas',''));controls.search.value='';page=1;root.hidden=false;landscape.update();panel.focus();await load(initialSnapshot);},close,
  async preparePrint(){if(root.hidden||destroyed||!rows||root.getAttribute('aria-busy')==='true')throw new Error('Não foi possível imprimir: aguarde a consulta completa dos DDAs.');const current=revision,filters=filterRevision,position=[content.scrollTop,content.scrollLeft],oldPage=page;printAll=true;render();return()=>{if(root.hidden||destroyed||current!==revision||filters!==filterRevision)return;printAll=false;page=oldPage;render();[content.scrollTop,content.scrollLeft]=position;};},
  destroy(){if(destroyed)return;close();paymentConfirmation.destroy();destroyed=true;unsubscribeBank?.();landscape.destroy();root.remove();}});
}
