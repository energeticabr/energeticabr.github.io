import {SEFAZ_SOURCES,sefazSourceSummary,isSefazTerminal} from '../chat/sefaz-sync-receipt.js';

/** No backdrop/Escape dismissal: only Entendi records acknowledgement. */
export function createSefazSyncReceipt({document:doc,onAcknowledge=async()=>false}) {
  let current=null;
  const el=(tag,cls,text)=>{const node=doc.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  function focus(event) { if(current&&!doc.querySelector('[data-dda-sync-result]')&&!current.overlay.contains(event.target))current.button.focus({preventScroll:true}); }
  function close() {
    const previous=current;current=null;if(!previous)return;
    doc.removeEventListener('focusin',focus,true);previous.observer?.disconnect();
    if(previous.native&&previous.overlay.open)previous.overlay.close();previous.overlay.remove();
    if(previous.trigger?.isConnected)previous.trigger.focus({preventScroll:true});
  }
  function show(result) {
    if(!isSefazTerminal(result?.status)||!doc.body?.isConnected)return false;
    close();
    const title=result.status==='succeeded'?'Consulta fiscal concluída':result.status==='partial'?'Consulta fiscal parcialmente concluída':'Consulta fiscal não concluída';
    const overlay=el('dialog','sefaz-sync-overlay'),dialog=el('section','sefaz-sync-dialog');
    const native=typeof overlay.showModal==='function';
    overlay.setAttribute('aria-label',title);overlay.setAttribute('aria-modal','true');overlay.setAttribute('role','dialog');dialog.dataset.sefazSyncResult=result.status;
    dialog.append(el('h2','',title),el('p','',result.status==='succeeded'?'NF-e, CT-e e NFS-e nacional consultadas. Entregas ao SharePoint confirmadas.':'Confira o resultado de cada fonte. Os dados da galeria podem estar incompletos.'));
    const list=el('ul','sefaz-sync-sources');
    for(const [key,label] of Object.entries(SEFAZ_SOURCES)){
      const row=el('li','');row.append(el('strong','',label),el('span','',sefazSourceSummary(result.sources[key])));list.append(row);
    }
    dialog.append(list,el('p','sefaz-sync-footnote','Os totais indicam documentos processados nesta consulta e podem incluir documentos já existentes.'));
    const feedback=el('p','sefaz-sync-error');feedback.hidden=true;feedback.setAttribute('role','alert');
    const button=el('button','sefaz-sync-ack','Entendi');button.type='button';
    button.addEventListener('click',async()=>{
      button.disabled=true;
      try { if(await onAcknowledge()!==false){if(current?.dialog===dialog)close();}
        else{feedback.hidden=false;feedback.textContent='Não foi possível salvar o reconhecimento neste aparelho. Tente novamente.';}
      }catch{feedback.hidden=false;feedback.textContent='Não foi possível salvar o reconhecimento. Tente novamente.';}
      finally{button.disabled=false;}
    });
    overlay.addEventListener('cancel',event=>event.preventDefault());
    overlay.addEventListener('click',event=>event.stopPropagation());
    overlay.addEventListener('keydown',event=>{
      if(event.key==='Escape'||event.key==='Tab'){event.preventDefault();event.stopPropagation();if(event.key==='Tab')button.focus();}
    });
    const trigger=doc.activeElement;
    dialog.append(feedback,button);overlay.append(dialog);doc.body.append(overlay);
    // Gallery overlays can mark every body child inert after this dialog opens.
    const observer=doc.defaultView?.MutationObserver?new doc.defaultView.MutationObserver(()=>{if(overlay.inert)overlay.inert=false;}):null;
    observer?.observe(overlay,{attributes:true,attributeFilter:['inert']});
    current={overlay,dialog,button,trigger,native,observer};
    if(native)overlay.showModal();else overlay.setAttribute('open','');
    doc.addEventListener('focusin',focus,true);button.focus({preventScroll:true});return true;
  }
  return {show,close,destroy:close};
}
