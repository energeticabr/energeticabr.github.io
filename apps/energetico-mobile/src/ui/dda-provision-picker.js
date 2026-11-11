import { includesSearchText, normalizeSearchText } from '../../../../portal/core/search-text.js';
import {confirmEditChanges,ensureEditReviewStyles} from '../../../../portal/ui/edit-review.js';
import {bindBackdropDismiss} from '../../../../portal/ui/backdrop-dismiss.js';
import {rankDdaProvisionOptions} from '../chat/dda-provision-link.js';

const DDA_COPY = {
 title:'A qual DESCRITIVO PROVISÃO DESEJA VINCULAR?',
 dialogLabel:'Vincular DDA a descritivo provisão',
 sourceLabel:'DDA',
 targetLabel:'Descritivo provisão',
 searchLabel:'Buscar descritivo provisão',
 listLabel:'Descritivos provisão disponíveis',
 loading:'Carregando descritivos sem pagamento efetuado…',
 options:count=>`${count} descritivo(s) sem data de pagamento efetuado. Escolha um para vincular.`,
 empty:'Nenhum descritivo provisão sem data de pagamento efetuado foi encontrado.',
 loadError:'Não foi possível carregar os descritivos. Tente novamente.',
};

export function createDdaProvisionPicker({service, ...options}){
 return createReportLinkPicker({
  ...options, copy:DDA_COPY,
  loadOptions:service && (async (row, signal)=>rankDdaProvisionOptions(await service.loadOptions({signal}),row)),
  saveLink:(row,id,signal,sharedLinkETag)=>service.save({ddaId:row.id,provisionId:id,signal,sharedLinkETag}),
  sharedLinkQuestion:'Tem certeza que deseja atribuir dois DDAS ao mesmo descritivo provisão?',
  currentLink:row=>row.provisionId,
  rowAmount:row=>row.amount,
 });
}

export function createReportLinkPicker({document:doc,host,copy,loadOptions,saveLink,currentLink,rowAmount,onLinked,onClose,resolveReturnFocus,sharedLinkQuestion,selectCurrent=false,timeoutMs=35000}){
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
  const linkedId=String(currentLink(row)||'');
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
  const summary=el('p','dda-provision-summary',`${row.supplier} · ${copy.sourceLabel} #${row.id} · ${money(rowAmount(row))}${selectCurrent&&linkedId?` · Pedido atual ID ${linkedId}`:''}`);
  const search=el('input','dda-provision-search');search.type='search';search.placeholder='Buscar fornecedor ou ID';search.setAttribute('aria-label',copy.searchLabel);
  const feedback=el('p','dda-provision-feedback',copy.loading);feedback.setAttribute('role','status');
  const list=el('div','dda-provision-options');list.setAttribute('role','radiogroup');list.setAttribute('aria-label',copy.listLabel);
  const actions=el('div','gallery-record-dialog-buttons'),cancel=el('button','gallery-record-dialog-button','Cancelar'),save=el('button','gallery-record-dialog-button dda-provision-save','SUBMETER');
  cancel.type=save.type='button';save.disabled=true;
  actions.append(cancel,save);dialog.append(header,summary,search,feedback,list,actions);overlay.append(dialog);
  const background=[...host.children].map(node=>[node,node.inert===true]);for(const [node] of background)node.inert=true;
  const entry={overlay,dialog,trigger,background,controller:new AbortController(),options:[],selected:selectCurrent&&linkedId||null,busy:false,reviewing:false};current=entry;host.append(overlay);dialog.focus();
  const cancelEdit=()=>{if(current===entry&&!entry.busy)close();};cancel.addEventListener('click',cancelEdit);back.addEventListener('click',cancelEdit);
  bindBackdropDismiss(overlay,()=>{if(!entry.reviewing)cancelEdit();});
  overlay.addEventListener('keydown',event=>{if(event.key==='Escape'&&!entry.busy){event.preventDefault();event.stopPropagation();close();}if(event.key==='Tab'){const nodes=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')];const index=nodes.indexOf(doc.activeElement);if(nodes.length){event.preventDefault();event.stopPropagation();nodes[(index+(event.shiftKey?-1:1)+nodes.length)%nodes.length].focus();}}});
  const optionText=item=>`${item.displayLabel || item.label || `#${item.id} · ${item.supplier}`} · ${money(item.amount)}`;
  function render(){
   if(current!==entry)return;list.replaceChildren();const term=normalizeSearchText(search.value);const visible=entry.options.filter(item=>includesSearchText(normalizeSearchText(`${item.id} ${item.supplier} ${item.label||''}`),term));
   for(const item of visible){const label=el('label','dda-provision-option');if(item.recommended)label.append(el('strong','dda-provision-star',copy.recommendation || '★ MAIS PROVÁVEL'));
    const choice=el('input');choice.type='radio';choice.name='dda-provision-choice';choice.value=item.id;choice.checked=entry.selected===item.id;choice.addEventListener('change',()=>{entry.selected=item.id;save.disabled=selectCurrent&&item.id===linkedId;for(const option of list.children)option.toggleAttribute('data-edit-changed',option===label&&item.id!==linkedId);});
    const text=el('span','',`${optionText(item)}${item.due?' · Previsto '+String(item.due).slice(0,10).split('-').reverse().join('/'):''}`);
    label.toggleAttribute('data-edit-changed',choice.checked&&item.id!==linkedId);
    label.append(choice,text);
    if(item.matchedProvision){const line=item.matchedProvision;label.append(el('span','dda-provision-line-match',`Provisão #${line.id} · ${money(line.amount)}${line.due?' · Previsto '+String(line.due).slice(0,10).split('-').reverse().join('/'):''} · mesmo valor deste DDA`));}
    if(item.matchReason==='supplier')label.append(el('span','dda-provision-name-match','Nome do fornecedor semelhante ao DDA'));
    if(item.matchDetail)label.append(el('span','dda-provision-name-match',item.matchDetail));
    list.append(label);
   }
   feedback.textContent=entry.options.length?copy.options(visible.length):copy.empty;
  }
  search.addEventListener('input',render);
  save.addEventListener('click',async()=>{
   if(current!==entry||entry.busy||entry.reviewing||!entry.selected)return;
   const selected=entry.selected;
   const choice=entry.options.find(item=>item.id===selected);
   if(!choice)return;
   entry.reviewing=true;
   const after=copy.reviewDetails ? optionText(choice) : `ID ${selected}`;
   const accepted=await confirmEditChanges({form:dialog,signal:entry.controller.signal,dismissOnBackdrop:true,title:'Confirme as alterações',changes:selected===linkedId?[]:[{label:copy.targetLabel,before:linkedId?`ID ${linkedId}`:'—',after}]});
   entry.reviewing=false;
   if(!accepted||current!==entry||host.hidden)return;
   entry.busy=true;save.disabled=cancel.disabled=back.disabled=search.disabled=true;feedback.setAttribute('role','status');feedback.textContent='Gravando vínculo no SharePoint…';
   if(propose)propose.disabled=true;
   const radios=[...list.querySelectorAll('input')];
   for(const radio of radios)radio.disabled=true;
   async function writeSelection(sharedLinkETag){
    entry.controller.signal.throwIfAborted();
    const write=new AbortController();
    const cancelWrite=()=>write.abort();
    entry.controller.signal.addEventListener('abort',cancelWrite,{once:true});
    let timer;
    try{
     const deadline=new Promise((_,reject)=>{
      timer=setTimeout(()=>{write.abort();reject(new Error('timeout'));},timeoutMs);
     });
     return await Promise.race([saveLink(row,selected,write.signal,sharedLinkETag),deadline]);
    }finally{
     clearTimeout(timer);
     entry.controller.signal.removeEventListener('abort',cancelWrite);
    }
   }
   try{
    let receipt=await writeSelection();
    if(current!==entry||host.hidden)return;
    if(receipt?.requiresSharedConfirmation&&sharedLinkQuestion){
     const confirmed=await confirmEditChanges({
      form:dialog,signal:entry.controller.signal,dismissOnBackdrop:true,title:sharedLinkQuestion,cancelLabel:'Não',confirmLabel:'Sim',
     });
     if(current!==entry||host.hidden)return;
     if(!confirmed){
      render();
      return;
     }
     receipt=await writeSelection(receipt.eTag);
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
     save.disabled=cancel.disabled=back.disabled=search.disabled=false;
     if(propose)propose.disabled=false;
     for(const radio of list.querySelectorAll('input'))radio.disabled=false;
     save.focus();
    }
   }
  });
  try{const options=await loadOptions(row,entry.controller.signal);if(current!==entry||host.hidden)return;entry.options=options;render();}
  catch{if(current===entry){feedback.textContent=copy.loadError;feedback.setAttribute('role','alert');}}
 }
 return {show,close,destroy:close,get isOpen(){return current!==null;}};
}
