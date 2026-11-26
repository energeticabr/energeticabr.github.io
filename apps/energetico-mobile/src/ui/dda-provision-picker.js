import { includesSearchText, normalizeSearchText } from '../../../../portal/core/search-text.js';
import {confirmEditChanges,ensureEditReviewStyles} from '../../../../portal/ui/edit-review.js';
import {bindBackdropDismiss} from '../../../../portal/ui/backdrop-dismiss.js';
import {rankDdaProvisionOptions} from '../chat/dda-provision-link.js';
import {rankDdaOrderOptions} from '../chat/sicoob-order-link.js';

const DDA_COPY = {
 title:'A qual DESCRITIVO PROVISÃO DESEJA VINCULAR?',
 dialogLabel:'Vincular DDA a descritivo provisão',
 sourceLabel:'DDA',
 targetLabel:'Descritivo provisão',
 searchLabel:'Buscar descritivo provisão',
 listLabel:'Descritivos provisão disponíveis',
 loading:'Carregando descritivos de provisão…',
 options:count=>`${count} descritivo(s). Escolha um para vincular.`,
 empty:'Nenhum descritivo encontrado para os filtros selecionados.',
 loadError:'Não foi possível carregar os descritivos. Tente novamente.',
};

const DDA_STATUS_FILTER = {
 label:'Status do pagamento',
 choices:[['pending','PAGAMENTO PREVISTO'],['paid','PAGAMENTO EFETUADO']],
 options:(items,row,status)=>rankDdaProvisionOptions(items.filter(item=>(item.paymentStatus??'pending')===status),row),
};

const DDA_ORDER_COPY = {
 ...DDA_COPY,
 title:'A qual PEDIDO DESEJA VINCULAR?',
 dialogLabel:'Vincular DDA a pedido',
 targetLabel:'Pedido',
 searchLabel:'Buscar pedido',
 listLabel:'Pedidos disponíveis',
 loading:'Carregando pedidos…',
 options:(count,_selected,items)=>`${count} pedido(s). Escolha um para vincular.${
  items.some(item=>item.dueLookupIncomplete)?' Vencimentos indisponíveis para comparação.':''}`,
 empty:'Nenhum pedido encontrado para a busca.',
 loadError:'Não foi possível carregar os pedidos. Tente novamente.',
 reviewDetails:true,
};

export function createReportLinkComparison(doc,value,matches,label,reference){
 const chip=doc.createElement('span');
 chip.className='report-link-comparison';
 chip.textContent=value;
 chip.dataset.match=String(matches);
 chip.title=`${label} ${matches?'confere com':'sem correspondência com'} ${reference}`;
 return chip;
}

const displayDate=day=>day?day.split('-').reverse().join('/'):'Sem data prevista';

function appendDdaComparisons(node,amount,totalMatch,{due,dueMatch}){
 const doc=node.ownerDocument;
 node.append(' · ',createReportLinkComparison(doc,amount,totalMatch,'Valor','o valor do DDA'),' · ',
  due?'Previsto ':'',createReportLinkComparison(doc,displayDate(due),
   dueMatch,'Data prevista','o vencimento do DDA'));
}

export function createDdaProvisionPicker({service, ...options}){
 const expectedLink=row=>row.linkSnapshot??{provisionId:row.provisionId||'',orderId:row.orderId||''};
 const orderEnabled=typeof service?.loadOrderOptions==='function'&&typeof service?.saveOrder==='function';
 return createReportLinkPicker({
  ...options, copy:DDA_COPY,
  loadOptions:service && ((_row,signal)=>service.loadOptions({signal})),
  optionFilter:DDA_STATUS_FILTER,
  saveLink:(row,id,signal,sharedLinkETag)=>service.save({ddaId:row.id,provisionId:id,signal,sharedLinkETag,
   ...(orderEnabled&&{expectedLink:expectedLink(row)})}),
  sharedLinkQuestion:'Tem certeza que deseja atribuir dois DDAS ao mesmo descritivo provisão?',
  currentLink:row=>row.provisionId&&row.orderId?'':row.provisionId||row.orderId,
  alternateSource:orderEnabled?{
   primary:['provision','DESCRITIVO PROVISÃO'],
   choice:['order','PEDIDO'],
   isCurrent:row=>Boolean(row.orderId&&!row.provisionId),
   copy:DDA_ORDER_COPY,
   loadOptions:async (row,signal)=>rankDdaOrderOptions(await service.loadOrderOptions({signal,amount:row.amount,due:row.due}),row),
   saveLink:(row,id,signal)=>service.saveOrder({ddaId:row.id,orderId:id,expectedLink:expectedLink(row),signal}),
   renderOptionLabel(node,item,amount){
    node.className='report-link-option-text';
    node.textContent=item.label||`#${item.id} · ${item.supplier}`;
    node.append(' · ',createReportLinkComparison(node.ownerDocument,amount,item.totalMatch,'Valor','o valor do DDA'));
    if(item.closestDue)node.append(` · Vencimento ${displayDate(item.closestDue)}`);
    if(item.date)node.append(` · Data do pedido ${displayDate(item.date)}`);
   },
  }:null,
  rowAmount:row=>row.amount,
  afterLink:service?.prepareDueAdjustment&& (async (receipt,{form,signal,run,feedback,choices})=>{
   if(choices[0].paymentStatus==='paid')return receipt;
   try{
    feedback.textContent='Conferindo a data prevista de pagamento…';
    const plan=await run(signal=>service.prepareDueAdjustment(receipt,{signal}));
    if(!plan||signal.aborted)return receipt;
    const due=displayDate(plan.due);
    const change=await confirmEditChanges({form,signal,
     title:`Deseja ajustar a data prevista de pagamento para o vencimento do DDA (${due})?`,
     cancelLabel:'Não',confirmLabel:'Sim',changes:[
      {label:`Provisão #${plan.childId}`,before:displayDate(plan.childDue),after:due},
      {label:`Descritivo #${plan.provisionId}`,before:displayDate(plan.parentDue),after:due},
     ],
    });
    if(!change||signal.aborted)return receipt;
    feedback.textContent='Atualizando as duas datas previstas no SharePoint…';
    await service.adjustDue(plan,{signal});
    return {...receipt,dueAdjustmentNotice:`Datas previstas da provisão e do descritivo atualizadas para ${due}.`};
   }catch{
    return {...receipt,dueAdjustmentNotice:'Vínculo salvo. Não foi possível confirmar o ajuste das datas previstas. Confira os registros antes de tentar novamente.'};
   }
  }),
  renderOptionLabel(node,item,amount){
   node.className='report-link-option-text';
   node.textContent=item.label || `#${item.id} · ${item.supplier}`;
   appendDdaComparisons(node,amount,item.totalMatch,item);
  },
 });
}

export function createReportLinkPicker({document:doc,host,copy,loadOptions,optionFilter,saveLink,currentLink,rowAmount,amountInCents,renderOptionLabel,afterLink,onLinked,onClose,resolveReturnFocus,sharedLinkQuestion,alternateSource,selectCurrent=false,multiple=false,timeoutMs=35000}){
 let current=null;ensureEditReviewStyles(doc);
 const el=(tag,cls='',value)=>{const node=doc.createElement(tag);node.className=cls;if(value!==undefined)node.textContent=String(value);return node;};
 const money=value=>{let text=String(value??'').trim().replace(/R\$|\s/g,'');if(text.includes(','))text=text.replace(/\./g,'').replace(',','.');const number=/^-?\d+(?:\.\d+)?$/.test(text)?Number(text):NaN;return Number.isFinite(number)?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(number):'Valor não informado';};
 function close(){
  if(!current)return;
  const entry=current;current=null;entry.controller.abort();entry.overlay.remove();
  for(const [node,inert] of entry.background)node.inert=inert;
  const target=entry.trigger?.isConnected?entry.trigger:resolveReturnFocus?.(entry.trigger)||host;
  if(target.isConnected&&!host.hidden)target.focus({preventScroll:true});
  onClose?.();
 }
 async function show(row,trigger,{onPropose}={}){
  if(current||host.hidden||!loadOptions)return;
  const linked=currentLink(row);
  const linkedIds=multiple?linked:linked?[String(linked)]:[];
  const linkedId=linkedIds[0];
  const primarySource={copy,loadOptions,optionFilter,saveLink,renderOptionLabel,afterLink,sharedLinkQuestion};
  const originalSource=alternateSource?.isCurrent(row)?alternateSource:primarySource;
  let activeSource=originalSource;
  const overlay=el('div','gallery-record-overlay dda-provision-overlay'),dialog=el('section','gallery-record-dialog dda-provision-dialog');
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',copy.dialogLabel);dialog.tabIndex=-1;
  const title=el('h2','',copy.title);
  const header=el('header','gallery-editor-header'),back=el('button','gallery-editor-back','←');
  back.type='button';back.setAttribute('data-gallery-editor-back','');back.setAttribute('aria-label','Voltar à galeria sem salvar');header.append(back,title);
  let propose;
  if(onPropose&&!linkedId){
   propose=el('button','nfe-propose-launch','PROPOR LANÇAMENTO');
   propose.type='button';propose.dataset.nfeProposeLaunch='';
   propose.addEventListener('click',()=>onPropose(row,propose));
   header.classList.add('nfe-picker-header');header.append(propose);
  }
  const referenceAmount=rowAmount(row);
  const summary=el('p','dda-provision-summary',`${row.supplier} · ${copy.sourceLabel} #${row.id} · ${money(referenceAmount)}${selectCurrent&&!multiple&&linkedId?` · Pedido atual ID ${linkedId}`:''}`);
  const search=el('input','dda-provision-search');search.type='search';search.placeholder='Buscar fornecedor ou ID';search.setAttribute('aria-label',copy.searchLabel);
  let filters=search,status,source;
  if(optionFilter||alternateSource){
   filters=el('div','dda-provision-filters');
   filters.append(search);
   if(alternateSource){
    filters.classList.add('dda-provision-filters--source');
    source=el('select','dda-provision-source');
    source.setAttribute('aria-label','Tipo de vínculo');
    for(const [value,label] of [alternateSource.primary,alternateSource.choice]){
     const option=el('option','',label);option.value=value;source.append(option);
    }
    source.value=(originalSource===alternateSource?alternateSource.choice:alternateSource.primary)[0];
    filters.append(source);
   }
   if(optionFilter){
    status=el('select','dda-provision-status');status.setAttribute('aria-label',optionFilter.label);
    for(const [value,label] of optionFilter.choices){
     const option=el('option','',label);option.value=value;status.append(option);
    }
    filters.append(status);
   }
  }
  const feedback=el('p','dda-provision-feedback',copy.loading);feedback.setAttribute('role','status');
  const list=el('div','dda-provision-options');list.setAttribute('role',multiple?'group':'radiogroup');list.setAttribute('aria-label',copy.listLabel);
  const actions=el('div','gallery-record-dialog-buttons'),cancel=el('button','gallery-record-dialog-button','Cancelar'),save=el('button','gallery-record-dialog-button dda-provision-save','SUBMETER');
  cancel.type=save.type='button';save.disabled=true;
  const total=amountInCents&&el('output','dda-provision-selection-total','Total selecionado —');
  const referenceCents=amountInCents?.(referenceAmount);
  if(total)actions.append(total);
  actions.append(cancel,save);dialog.append(header,summary,filters,feedback,list,actions);overlay.append(dialog);
  const background=[...host.children].map(node=>[node,node.inert===true]);for(const [node] of background)node.inert=true;
  const entry={overlay,dialog,trigger,background,controller:new AbortController(),options:[],selected:new Set(selectCurrent?linkedIds:[]),busy:false,reviewing:false};current=entry;host.append(overlay);dialog.focus();
  const cancelEdit=()=>{if(current===entry&&!entry.busy)close();};cancel.addEventListener('click',cancelEdit);back.addEventListener('click',cancelEdit);
  bindBackdropDismiss(overlay,()=>{if(!entry.reviewing)cancelEdit();});
  overlay.addEventListener('keydown',event=>{if(event.key==='Escape'&&!entry.busy){event.preventDefault();event.stopPropagation();close();}if(event.key==='Tab'){const nodes=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];const index=nodes.indexOf(doc.activeElement);if(nodes.length){event.preventDefault();event.stopPropagation();nodes[(index+(event.shiftKey?-1:1)+nodes.length)%nodes.length].focus();}}});
  function optionLabel(item){
   const text=el('span'),amount=money(item.amount);
   if(activeSource.renderOptionLabel)activeSource.renderOptionLabel(text,item,amount);
   else text.textContent=`${item.label || `#${item.id} · ${item.supplier}`} · ${amount}`;
   return text;
  }
  const selectionChanged=()=>activeSource!==originalSource||entry.selected.size!==linkedIds.length||linkedIds.some(id=>!entry.selected.has(id));
  const canSave=()=>entry.selected.size>0&&(!selectCurrent||selectionChanged());
  function updateFeedback(){
   const count=list.childElementCount;
   feedback.setAttribute('role','status');
   const activeCopy=activeSource.copy;
   feedback.textContent=(activeSource.optionFilter?count:entry.options.length)
    ?activeCopy.options(count,entry.selected.size,entry.options):activeCopy.empty;
  }
  function updateSelection(){
   let matches=false;
   if(total){
    let sum=0;
    let knownCount=0;
    for(const item of entry.options){
     if(!entry.selected.has(item.id))continue;
     const cents=amountInCents(item.amount);
     if(cents===null)continue;
     sum+=cents;
     knownCount++;
    }
    const complete=knownCount===entry.selected.size;
    const validSum=Number.isSafeInteger(sum);
    matches=entry.selected.size>0&&complete&&validSum&&sum===referenceCents;
    const amount=validSum?`${money(sum/100)}${complete?'':' (parcial)'}`:'indisponível';
    const text=`Total selecionado ${amount}`;
    if(total.textContent!==text)total.textContent=text;
   }
   for(const option of list.children){
    const input=option.querySelector('input');
    option.toggleAttribute('data-selection-amount-match',input.checked&&matches);
    option.toggleAttribute('data-edit-changed',input.checked&&!matches&&(activeSource!==originalSource||!linkedIds.includes(input.value)));
   }
  }
  function render(){
   if(current!==entry)return;list.replaceChildren();const term=normalizeSearchText(search.value);const visible=entry.options.filter(item=>includesSearchText(normalizeSearchText(`${item.id} ${item.supplier} ${item.label||''}`),term));
   for(const item of visible){const label=el('label','dda-provision-option');if(item.recommended)label.append(el('strong','dda-provision-star',activeSource.copy.recommendation || '★ MAIS PROVÁVEL'));
    const choice=el('input');choice.type=multiple?'checkbox':'radio';choice.name='dda-provision-choice';choice.value=item.id;choice.checked=entry.selected.has(item.id);
    choice.addEventListener('change',()=>{
     if(!multiple)entry.selected.clear();
     if(choice.checked)entry.selected.add(item.id);
     else entry.selected.delete(item.id);
     save.disabled=!canSave();
     updateSelection();
     if(multiple)updateFeedback();
    });
    const text=optionLabel(item);
    if(!activeSource.renderOptionLabel&&item.due)text.append(` · Previsto ${String(item.due).slice(0,10).split('-').reverse().join('/')}`);
    label.append(choice,text);
    if(item.matchedProvision){
     const line=item.matchedProvision,match=el('span','dda-provision-line-match',`Provisão #${line.id}`);
     appendDdaComparisons(match,money(line.amount),true,line);
     match.append(' · mesmo valor deste DDA');
     label.append(match);
    }
    if(item.matchReason==='supplier')label.append(el('span','dda-provision-name-match','Nome do fornecedor semelhante ao DDA'));
    if(item.matchDetail)label.append(el('span','dda-provision-name-match',item.matchDetail));
    list.append(label);
   }
   updateSelection();
   updateFeedback();
  }
  search.addEventListener('input',render);
  let allOptions=[];
  function applyFilters(){
   entry.options=activeSource.optionFilter?activeSource.optionFilter.options(allOptions,row,status.value):allOptions;
   render();
  }
  status?.addEventListener('change',()=>{
   if(entry.busy||entry.reviewing)return;
   entry.selected.clear();
   save.disabled=true;
   applyFilters();
  });
  source?.addEventListener('change',()=>{
   if(entry.busy||entry.reviewing)return;
   const next=source.value===alternateSource.choice[0]?alternateSource:primarySource;
   if(next===activeSource)return;
   activeSource=next;
   entry.selected.clear();
   save.disabled=true;
   void loadSource();
  });
  save.addEventListener('click',async()=>{
   if(current!==entry||entry.busy||entry.reviewing||!canSave())return;
   const selected=[...entry.selected];
   const choices=selected.map(id=>entry.options.find(item=>item.id===id));
   if(choices.some(choice=>!choice))return;
   entry.reviewing=true;
   const formatIds=ids=>ids.map(id=>`ID ${id}`).join(', ');
   const activeCopy=activeSource.copy;
   const after=activeCopy.reviewDetails ? choices.map(choice=>optionLabel(choice).textContent).join('\n') : formatIds(selected);
   const before=linkedIds.length&&activeSource!==originalSource
    ?`${originalSource.copy.targetLabel} · ${formatIds(linkedIds)}`:formatIds(linkedIds)||'—';
   const changes=selectionChanged()?[{label:activeCopy.targetLabel,before,after}]:[];
   const accepted=await confirmEditChanges({form:dialog,signal:entry.controller.signal,dismissOnBackdrop:true,title:'Confirme as alterações',changes});
   entry.reviewing=false;
   if(!accepted||current!==entry||host.hidden)return;
   entry.busy=true;save.disabled=cancel.disabled=back.disabled=search.disabled=true;feedback.setAttribute('role','status');feedback.textContent='Gravando vínculo no SharePoint…';
   if(status)status.disabled=true;
   if(source)source.disabled=true;
   if(propose)propose.disabled=true;
   for(const choice of list.querySelectorAll('input'))choice.disabled=true;
   async function run(operation){
    entry.controller.signal.throwIfAborted();
    const write=new AbortController();
    const cancelWrite=()=>write.abort();
    entry.controller.signal.addEventListener('abort',cancelWrite,{once:true});
    let timer;
    try{
     const deadline=new Promise((_,reject)=>{
      timer=setTimeout(()=>{write.abort();reject(new Error('timeout'));},timeoutMs);
     });
     return await Promise.race([operation(write.signal),deadline]);
    }finally{
     clearTimeout(timer);
     entry.controller.signal.removeEventListener('abort',cancelWrite);
    }
   }
   const writeSelection=sharedLinkETag=>run(signal=>activeSource.saveLink(row,multiple?selected:selected[0],signal,sharedLinkETag));
   try{
    let receipt=await writeSelection();
    if(current!==entry||host.hidden)return;
    if(receipt?.requiresSharedConfirmation&&activeSource.sharedLinkQuestion){
     const confirmed=await confirmEditChanges({
      form:dialog,signal:entry.controller.signal,dismissOnBackdrop:true,title:activeSource.sharedLinkQuestion,cancelLabel:'Não',confirmLabel:'Sim',
     });
     if(current!==entry||host.hidden)return;
     if(!confirmed){
      render();
      return;
     }
     receipt=await writeSelection(receipt.eTag);
     if(current!==entry||host.hidden)return;
    }
    if(activeSource.afterLink){
     receipt=await activeSource.afterLink(receipt,{form:dialog,signal:entry.controller.signal,run,feedback,choices});
     if(current!==entry||host.hidden)return;
    }
    onLinked?.(receipt);
    close();
   }catch{
    if(current===entry){
     feedback.textContent='Não foi possível confirmar o vínculo no SharePoint. Atualize e tente novamente.';
     feedback.setAttribute('role','alert');
    }
   }finally{
    entry.busy=false;
    if(current===entry){
     save.disabled=!canSave();
     cancel.disabled=back.disabled=search.disabled=false;
     if(status)status.disabled=status.hidden;
     if(source)source.disabled=false;
     if(propose)propose.disabled=false;
     for(const choice of list.querySelectorAll('input'))choice.disabled=false;
     save.focus();
    }
   }
  });
  let loadGeneration=0;
  async function loadSource(){
   const generation=++loadGeneration;
   const activeCopy=activeSource.copy;
   const isCurrent=()=>current===entry&&!host.hidden&&generation===loadGeneration;
   title.textContent=activeCopy.title;
   dialog.setAttribute('aria-label',activeCopy.dialogLabel);
   search.setAttribute('aria-label',activeCopy.searchLabel);
   list.setAttribute('aria-label',activeCopy.listLabel);
   if(status){
    status.hidden=!activeSource.optionFilter;
    status.disabled=search.disabled=true;
   }
   entry.options=[];
   list.replaceChildren();
   feedback.textContent=activeCopy.loading;
   feedback.setAttribute('role','status');
   try{
    const items=await activeSource.loadOptions(row,entry.controller.signal);
    if(!isCurrent())return;
    allOptions=items;
    if(status){search.disabled=false;status.disabled=status.hidden;}
    applyFilters();
   }catch{
    if(isCurrent()){
     feedback.textContent=activeCopy.loadError;
     feedback.setAttribute('role','alert');
    }
   }
  }
  await loadSource();
 }
 return {show,close,destroy:close,get isOpen(){return current!==null;}};
}
