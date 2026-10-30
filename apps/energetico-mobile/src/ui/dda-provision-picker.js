import {rankDdaProvisionOptions} from '../chat/dda-provision-link.js';

export function createDdaProvisionPicker({document:doc,host,service,onLinked,timeoutMs=35000}){
 let current=null;
 const el=(tag,cls='',value)=>{const node=doc.createElement(tag);node.className=cls;if(value!==undefined)node.textContent=String(value);return node;};
 const money=value=>{let text=String(value??'').trim().replace(/R\$|\s/g,'');if(text.includes(','))text=text.replace(/\./g,'').replace(',','.');const number=/^\d+(?:\.\d+)?$/.test(text)?Number(text):NaN;return Number.isFinite(number)?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(number):'Valor não informado';};
 function close(){if(!current)return;const entry=current;current=null;entry.controller.abort();entry.overlay.remove();for(const [node,inert] of entry.background)node.inert=inert;if(entry.trigger?.isConnected&&!host.hidden)entry.trigger.focus({preventScroll:true});else if(host.isConnected&&!host.hidden)host.focus({preventScroll:true});}
 async function show(row,trigger){
  if(current||host.hidden||!service)return;
  const overlay=el('div','gallery-record-overlay dda-provision-overlay'),dialog=el('section','gallery-record-dialog dda-provision-dialog');
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Vincular DDA a descritivo provisão');dialog.tabIndex=-1;
  const title=el('h2','','A qual DESCRITIVO PROVISÃO DESEJA VINCULAR?');
  const header=el('header','gallery-editor-header'),back=el('button','gallery-editor-back','←');
  back.type='button';back.setAttribute('data-gallery-editor-back','');back.setAttribute('aria-label','Voltar à galeria sem salvar');header.append(back,title);
  const summary=el('p','dda-provision-summary',`${row.supplier} · DDA #${row.id} · ${money(row.amount)}`);
  const search=el('input','dda-provision-search');search.type='search';search.placeholder='Buscar fornecedor ou ID';search.setAttribute('aria-label','Buscar descritivo provisão');
  const feedback=el('p','dda-provision-feedback','Carregando descritivos sem pagamento efetuado…');feedback.setAttribute('role','status');
  const list=el('div','dda-provision-options');list.setAttribute('role','radiogroup');list.setAttribute('aria-label','Descritivos provisão disponíveis');
  const actions=el('div','gallery-record-dialog-buttons'),cancel=el('button','gallery-record-dialog-button','Cancelar'),save=el('button','gallery-record-dialog-button dda-provision-save','Vincular');
  cancel.type=save.type='button';save.disabled=true;
  actions.append(cancel,save);dialog.append(header,summary,search,feedback,list,actions);overlay.append(dialog);
  const background=[...host.children].map(node=>[node,node.inert===true]);for(const [node] of background)node.inert=true;
  const entry={overlay,dialog,trigger,background,controller:new AbortController(),options:[],selected:null,busy:false};current=entry;host.append(overlay);dialog.focus();
  const cancelEdit=()=>{if(current===entry&&!entry.busy)close();};cancel.addEventListener('click',cancelEdit);back.addEventListener('click',cancelEdit);
  overlay.addEventListener('keydown',event=>{if(event.key==='Escape'&&!entry.busy){event.preventDefault();event.stopPropagation();close();}if(event.key==='Tab'){const nodes=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')];const index=nodes.indexOf(doc.activeElement);if(nodes.length){event.preventDefault();event.stopPropagation();nodes[(index+(event.shiftKey?-1:1)+nodes.length)%nodes.length].focus();}}});
  function render(){
   if(current!==entry)return;list.replaceChildren();const term=search.value.trim().toLowerCase();const visible=entry.options.filter(item=>!term||`${item.id} ${item.supplier}`.toLowerCase().includes(term));
   for(const item of visible){const label=el('label','dda-provision-option');if(item.recommended)label.append(el('strong','dda-provision-star','★ MAIS PROVÁVEL'));
    const choice=el('input');choice.type='radio';choice.name='dda-provision-choice';choice.value=item.id;choice.checked=entry.selected===item.id;choice.addEventListener('change',()=>{entry.selected=item.id;save.disabled=false;});
    const text=el('span','',`${item.label} · ${money(item.amount)}${item.due?' · Previsto '+String(item.due).slice(0,10).split('-').reverse().join('/'):''}`);
    label.append(choice,text);list.append(label);
   }
   feedback.textContent=entry.options.length?`${visible.length} descritivo(s) sem data de pagamento efetuado. Escolha um para vincular.`:'Nenhum descritivo provisão sem data de pagamento efetuado foi encontrado.';
  }
  search.addEventListener('input',render);
  save.addEventListener('click',async()=>{
   if(current!==entry||entry.busy||!entry.selected)return;entry.busy=true;save.disabled=cancel.disabled=back.disabled=search.disabled=true;feedback.textContent='Gravando vínculo no SharePoint…';
   let timer;try{const receipt=await Promise.race([service.save({ddaId:row.id,provisionId:entry.selected,signal:entry.controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{entry.controller.abort();reject(new Error('timeout'));},timeoutMs);})]);
    if(current!==entry||host.hidden)return;onLinked?.(receipt);feedback.textContent=`Vinculado ao descritivo #${receipt.provisionId}.`;save.remove();cancel.disabled=false;cancel.textContent='Concluir';
   }catch{if(current===entry){feedback.textContent='Não foi possível confirmar o vínculo no SharePoint. Atualize e tente novamente.';feedback.setAttribute('role','alert');cancel.disabled=false;save.disabled=false;search.disabled=false;}}
   finally{clearTimeout(timer);entry.busy=false;back.disabled=false;if(current===entry)cancel.focus();}
  });
  try{const options=await service.loadOptions({signal:entry.controller.signal});if(current!==entry||host.hidden)return;entry.options=rankDdaProvisionOptions(options,row);render();}
  catch{if(current===entry){feedback.textContent='Não foi possível carregar os descritivos. Tente novamente.';feedback.setAttribute('role','alert');}}
 }
 return {show,close,destroy:close,get isOpen(){return current!==null;}};
}
