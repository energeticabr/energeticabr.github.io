import { parseCargosMoney } from '../chat/cargos-model.js';
import { reportLayoutViewport } from './report-landscape.js';

/** Report edits use the same versioned contexts and attachment transport as the HR gallery. */
export function openTaxGuideReportEditor({ document:doc, host, background, row, mode, data, pickAttachments, onChanged, onClose }) {
  const make=(tag,cls='',text)=>{const node=doc.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const active=new AbortController(),{signal}=active;
  const overlay=make('div','tgr-editor-overlay'),dialog=make('section','tgr-editor');
  overlay.dataset.reportScreenOnly='';
  dialog.tabIndex=-1;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  const title=mode==='amount'?'Informar valor da guia':'Anexar guia';dialog.setAttribute('aria-label',title);
  const status=make('p','tgr-editor-status');status.setAttribute('role','status');
  const cancel=make('button','tgr-button','Cancelar');cancel.type='button';
  const controls=make('div','tgr-editor-controls');
  let context=null,busy=false,pendingFiles=null;
  const win=doc.defaultView,viewport=win.visualViewport;
  function position(){
    const visible=reportLayoutViewport(host,host);
    overlay.dataset.compactHeight=String(visible.height<320);
    Object.assign(overlay.style,{inset:'auto',top:`${visible.top}px`,left:`${visible.left}px`,width:`${visible.width}px`,height:`${visible.height}px`});
  }
  function close(){if(signal.aborted)return;active.abort();win.removeEventListener('resize',position);viewport?.removeEventListener('resize',position);viewport?.removeEventListener('scroll',position);overlay.remove();background.removeAttribute('inert');onClose?.();}
  function setBusy(value){busy=value;for(const node of controls.querySelectorAll('button,input'))node.disabled=value;dialog.setAttribute('aria-busy',String(value));}
  function errorMessage(error){return error?.message||'Não foi possível salvar a guia. Tente novamente.';}
  async function changed(){if(signal.aborted)return;close();await onChanged?.();}
  const currentContext=async()=>{
    context ||= await data.loadEditor(String(row.id),{signal,includeAttachments:mode!=='amount'});
    signal.throwIfAborted();
    return context;
  };
  dialog.append(make('h3','',title),make('p','tgr-editor-summary',`${row.fields?.TIPO||''} · ${row.fields?.FILIAL||''} · ${String(row.fields?.COMPETENCIA||'').slice(0,10).split('-').reverse().join('/')}`),controls,status,cancel);
  overlay.append(dialog);host.append(overlay);background.setAttribute('inert','');dialog.focus({preventScroll:true});
  win.addEventListener('resize',position);viewport?.addEventListener('resize',position);viewport?.addEventListener('scroll',position);position();
  cancel.addEventListener('click',close);
  overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
  dialog.addEventListener('keydown',event=>{
    if(event.defaultPrevented)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
    if(event.key!=='Tab')return;
    const nodes=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(node=>!node.closest('[hidden]'));
    const first=nodes[0],last=nodes.at(-1);
    if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===dialog)){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&(doc.activeElement===last||doc.activeElement===dialog)){event.preventDefault();first?.focus();}
  });
  if(mode==='amount'){
    const label=make('label','','Valor da guia (R$)'),input=make('input'),save=make('button','tgr-button','Salvar valor'),retry=make('button','tgr-button','Tentar consulta novamente');
    input.name='guideAmount';input.type='text';input.inputMode='decimal';input.autocomplete='off';input.placeholder='0,00';
    label.append(input);save.type='button';save.dataset.guideSave='';retry.type='button';retry.dataset.guideLoadRetry='';retry.hidden=true;controls.append(label,save,retry);
    async function saveAmount(){
      if(busy||signal.aborted)return;
      const value=parseCargosMoney(input.value);
      if(value===null){status.textContent='Informe um valor válido, como 1.234,56 ou 0,00.';input.focus();return;}
      setBusy(true);status.textContent='Salvando valor…';
      try{await data.saveEditor(context,{VALOR:value},{signal});if(!signal.aborted)await changed();}
      catch(error){if(!signal.aborted)status.textContent=errorMessage(error);}
      finally{if(!signal.aborted)setBusy(false);}
    }
    save.addEventListener('click',()=>void saveAmount());
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void saveAmount();}});
    async function readAmount(){
      setBusy(true);retry.hidden=true;status.textContent='Consultando valor atual…';
      try{
        const latest=await currentContext();
        if(latest.item?.fields?.VALOR!=null&&String(latest.item.fields.VALOR).trim()!==''){await changed();return;}
        setBusy(false);status.textContent='';input.focus({preventScroll:true});
      }catch(error){if(!signal.aborted){status.textContent=errorMessage(error);retry.hidden=false;retry.disabled=false;}}
    }
    retry.addEventListener('click',()=>void readAmount());void readAmount();
  }else{
    const sources=make('div','tgr-editor-sources'),retry=make('button','tgr-button','Tentar envio novamente');
    retry.type='button';retry.dataset.guideRetry='';retry.hidden=true;
    controls.append(sources,retry);
    async function upload(){
      const latest=await currentContext();
      if(latest.attachments?.existingFiles?.length){await changed();return;}
      status.textContent='Enviando guia…';
      await data.saveEditor(latest,{}, {attachments:{uploads:pendingFiles,deletions:[]},signal});
      if(!signal.aborted)await changed();
    }
    async function pick(source){
      if(busy||signal.aborted)return;
      setBusy(true);status.textContent='';retry.hidden=true;
      try{
        if(source){pendingFiles=await pickAttachments(source,{signal});signal.throwIfAborted();}
        if(pendingFiles?.length)await upload();
      }catch(error){if(!signal.aborted){status.textContent=errorMessage(error);retry.hidden=!pendingFiles?.length;}}
      finally{if(!signal.aborted)setBusy(false);}
    }
    for(const [source,text] of [['camera','Tirar foto'],['scan','Escanear'],['files','Anexar arquivo'],['photos','Anexar foto']]){
      const button=make('button','tgr-button',text);button.type='button';button.dataset.source=source;
      button.addEventListener('click',()=>void pick(source));sources.append(button);
    }
    retry.addEventListener('click',()=>void pick(null));
  }
  return {close};
}
