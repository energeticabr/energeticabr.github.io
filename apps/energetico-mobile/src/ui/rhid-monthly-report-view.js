import {buildRhidMonthlyReport,isRhidReportMonth} from '../chat/rhid-monthly-model.js';
import {bindSearchableFilterSelects} from './searchable-filter-selects.js';

const MONTHS=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
export function createRhidMonthlyReportView({document:doc=globalThis.document,data,now=()=>new Date(),onClose=()=>{},onReport=async()=>{}}={}){
 if(!doc?.body||typeof data?.loadSuppliers!=='function'||typeof data?.loadMonth!=='function')throw new TypeError('O relatório mensal requer uma sessão RHID e SharePoint.');
 const make=(tag,cls='',text)=>{const node=doc.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const button=(cls,text)=>Object.assign(make('button',cls,text),{type:'button'});
 const root=make('div','rhid-monthly-overlay');root.hidden=true;
 const panel=make('section','rhid-monthly-dialog');panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Relatório mensal de presenças RHID');
 const header=make('header','rhid-monthly-header'),closeButton=button('rhid-monthly-close','×');closeButton.setAttribute('aria-label','Fechar relatório mensal');
 header.append(make('h2','','Relatório mensal de presenças RHID'),closeButton);
 const form=make('form','rhid-monthly-form'),supplierLabel=make('label','rhid-monthly-supplier'),supplier=make('select');supplier.name='supplier';supplier.required=true;supplier.setAttribute('aria-label','Fornecedor');
 supplierLabel.append(make('span','','Fornecedor'),supplier);
 const period=make('div','rhid-monthly-period'),monthLabel=make('label'),month=make('select');month.name='month';month.required=true;month.setAttribute('aria-label','Mês de referência');
 MONTHS.forEach((name,index)=>month.append(Object.assign(make('option','',name),{value:String(index+1).padStart(2,'0')})));monthLabel.append(make('span','','Mês de referência'),month);
 const yearLabel=make('label'),year=make('input');year.type='number';year.name='year';year.min='1000';year.max='9999';year.step='1';year.required=true;year.inputMode='numeric';year.setAttribute('aria-label','Ano de referência');yearLabel.append(make('span','','Ano'),year);period.append(monthLabel,yearLabel);
 const actions=make('div','rhid-monthly-actions'),cancel=button('rhid-monthly-cancel','Cancelar'),submit=button('rhid-monthly-generate','Gerar relatório');submit.type='submit';actions.append(cancel,submit);
 const retry=button('rhid-monthly-refresh','Atualizar fornecedores'),notice=make('p','rhid-monthly-notice');notice.setAttribute('role','status');notice.hidden=true;
 const result=make('div','rhid-monthly-result');result.dataset.monthlyResult='true';result.hidden=true;
 form.append(supplierLabel,period,retry,actions);panel.append(header,form,notice,result);root.append(panel);doc.body.append(root);
 let destroyed=false,revision=0,controller=null,picker=null,options=[],busy=false,returnFocus=null,app=null,oldInert=false,oldOverflow='';
 function suspend(){if(destroyed||root.hidden)return;picker?.close();root.style.visibility='hidden';root.inert=true;if(app)app.inert=oldInert;}
 function resume(){if(destroyed||root.hidden)return;root.style.visibility='';root.inert=false;if(app)app.inert=true;}
 function status(text,error=false){notice.textContent=text;notice.hidden=!text;notice.setAttribute('role',error?'alert':'status');}
 function setBusy(value){busy=value;for(const control of [supplier,month,year,retry,submit])control.disabled=value;picker?.sync();submit.disabled=value||!options.length;panel.setAttribute('aria-busy',String(value));}
 function clearResult(){result.hidden=true;result.replaceChildren();}
 function begin(){controller?.abort();controller=new AbortController();const current=++revision;return {signal:controller.signal,current};}
 const currentRequest=request=>!destroyed&&!root.hidden&&!request.signal.aborted&&request.current===revision;
 function populate(rows){
  if(!Array.isArray(rows)||rows.some(row=>!row?.id||!row.name))throw new TypeError('Lista de fornecedores incompleta.');
  options=rows;supplier.replaceChildren(Object.assign(make('option','','Selecione o fornecedor'),{value:''}));
  for(const row of rows)supplier.append(Object.assign(make('option','',row.name),{value:String(row.id)}));picker?.destroy();picker=bindSearchableFilterSelects(supplierLabel,{report:true});picker.sync();
 }
 async function loadSuppliers(){
  const request=begin();clearResult();options=[];setBusy(true);status('Carregando fornecedores ativos e empreiteiros…');
  try{const rows=await data.loadSuppliers({signal:request.signal});if(!currentRequest(request))return;populate(rows);status(rows.length?'':'Nenhum fornecedor com EMPREITEIRO = SIM e STATUS = ATIVO.');}
  catch(error){if(currentRequest(request)){populate([]);status(error?.message||'Não foi possível carregar os fornecedores. Tente atualizar.',true);}}
  finally{if(currentRequest(request))setBusy(false);}
 }
 function showReport(report){
  clearResult();result.hidden=false;
  result.append(make('h3','',report.supplier.name),make('p','',`Referência: ${report.month.slice(5)}/${report.month.slice(0,4)}`),make('p','rhid-monthly-total',`Total de horas apuradas: ${report.total} · ${report.recordedDays} dia(s) com batidas`));
  if(!report.recordedDays)result.append(make('p','','Nenhuma presença RHID registrada para este fornecedor no período. Dias sem registro não significam falta.'));
  if(report.incompleteDays)result.append(make('p','rhid-monthly-warning',`${report.incompleteDays} dia(s) com apuração incompleta. Esses dias não foram somados ao total.`));
  result.append(make('p','rhid-monthly-legend','* Horário ajustado por administrador. “Sem registro” não significa falta.'));
  const scroll=make('div','rhid-monthly-table-scroll');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Presenças diárias do mês; deslize para ver todas as colunas');
  const table=make('table'),caption=make('caption','','Presenças diárias — horários efetivos'),head=make('thead'),headRow=make('tr'),body=make('tbody');
  for(const title of ['Data','Entrada 1','Saída 1','Entrada 2','Saída 2','Total','Apuração']){const cell=make('th','',title);cell.scope='col';headRow.append(cell);}head.append(headRow);
  for(const day of report.days){
   const row=make('tr',day.recorded&&!day.total?'rhid-monthly-row--incomplete':'');
   const values=[`${day.date.slice(8)}/${day.date.slice(5,7)}`, ...day.slots,day.total??'—',!day.recorded?'Sem registro':!day.total?'Incompleta':day.adjusted?'Ajustado *':'RHID'];
   for(const value of values)row.append(make('td','',value));body.append(row);
   if(day.issues.length){const detail=make('tr','rhid-monthly-issues'),cell=make('td','',day.issues.join('; '));cell.colSpan=7;detail.append(cell);body.append(detail);}
  }
  table.append(caption,head,body);scroll.append(table);result.append(scroll);
 }
 async function generate(event){
  event.preventDefault();if(busy||root.hidden)return;
  const selected=options.find(row=>String(row.id)===supplier.value),selectedMonth=`${year.value}-${month.value}`;
  if(!selected||!isRhidReportMonth(selectedMonth)){status('Selecione o fornecedor, mês e ano válidos.',true);return;}
  const request=begin();clearResult();setBusy(true);status('Consultando presenças do mês…');
  try{
   const eligible=await data.loadSuppliers({signal:request.signal});if(!currentRequest(request))return;
   const confirmed=eligible.find(row=>String(row.id)===String(selected.id)&&row.name===selected.name);
   if(!confirmed){populate(eligible);throw new Error('O fornecedor não está mais ativo e empreiteiro. Selecione outro fornecedor.');}
   const snapshot=await data.loadMonth(selectedMonth,{signal:request.signal});if(!currentRequest(request))return;
   const report=buildRhidMonthlyReport({month:selectedMonth,supplier:confirmed,snapshot});
   showReport(report);picker?.close();status('Preparando PDF do relatório mensal…');
   await onReport(report,{signal:request.signal,resolveReturnFocus:()=>!destroyed&&!root.hidden?closeButton:null});if(!currentRequest(request))return;
   status('Relatório mensal gerado em PDF.');
  }catch(error){if(currentRequest(request))status(error?.message||'Não foi possível gerar o relatório mensal. Tente novamente.',true);}
  finally{if(currentRequest(request))setBusy(false);}
 }
 function close(){
  if(root.hidden)return;controller?.abort();revision++;picker?.close();clearResult();status('');root.hidden=true;root.style.visibility='';root.inert=false;doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;onClose();
  const target=returnFocus?.isConnected?returnFocus:app?.querySelector('[data-action="open-rhid-monthly-report"]');target?.focus?.({preventScroll:true});returnFocus=null;
 }
 closeButton.addEventListener('click',close);cancel.addEventListener('click',close);retry.addEventListener('click',()=>void loadSuppliers());form.addEventListener('submit',generate);
 form.addEventListener('change',()=>{if(!busy){clearResult();status('');}});
 root.addEventListener('click',event=>{if(event.target===root)close();});
 root.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();if(root.querySelector('.sfs-popup:not([hidden])')){picker.close();return;}close();return;}
  if(event.key!=='Tab')return;
  const nodes=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(n=>!n.disabled&&!n.closest('[hidden]')&&n.tabIndex>=0);
  const first=nodes[0],last=nodes.at(-1);
  if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){event.preventDefault();first?.focus();}
 });
 return Object.freeze({element:root,async open({month:initialMonth}={}){
  if(destroyed)throw new Error('Relatório encerrado.');if(!root.hidden)return;
  const local=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(now()),reference=isRhidReportMonth(initialMonth)?initialMonth:local;
  month.value=reference.slice(5);year.value=reference.slice(0,4);returnFocus=doc.activeElement;app=doc.getElementById('app');oldInert=Boolean(app?.inert);oldOverflow=doc.body.style.overflow;
  doc.body.style.overflow='hidden';if(app)app.inert=true;root.hidden=false;panel.focus();await loadSuppliers();
 },close,suspend,resume,destroy(){if(destroyed)return;close();destroyed=true;controller?.abort();picker?.destroy();root.remove();}});
}
