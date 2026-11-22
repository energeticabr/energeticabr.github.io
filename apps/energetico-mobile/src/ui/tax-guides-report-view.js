import { bindReportLandscape } from './report-landscape.js';
import { addReportCloseControl } from './report-close-control.js';
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';
import { PDF_ATTACHMENT_ICON } from './report-pdf-attachment-icon.js';
import { openTaxGuideReportEditor } from './tax-guides-report-editor.js';

const FIELDS = [['VENCIMENTO','Data vencimento'],['COMPETENCIA','Data competência'],['FILIAL','Filial'],['VALOR','Valor'],['TIPO','Tipo'],['STATUS','Status']];
const FILTERS = [['COMPETENCIA','Competência'],['FILIAL','Filial'],['TIPO','Tipo'],['STATUS','Status']];
const dateKey = value => /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(String(value || '')) ? String(value).slice(0,10) : '';
const dateLabel = value => { const key=dateKey(value); return key ? `${key.slice(8)}/${key.slice(5,7)}/${key.slice(0,4)}` : 'A informar'; };
const amountLabel = value => {
  if (value == null || String(value).trim()==='') return 'A informar';
  const number=Number(value);
  return Number.isFinite(number) ? number.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : 'A informar';
};

export function createTaxGuidesReportView({document:doc=globalThis.document,data,openMediaCollection,pickAttachments}={}) {
  if (!doc?.body || typeof data?.loadSnapshot!=='function') throw new TypeError('O relatório requer documento e dados das guias.');
  const make=(tag,cls='',text)=>{const node=doc.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const root=make('div','tgr-backdrop');root.hidden=true;root.dataset.taxGuidesReport='';
  const panel=make('section','tgr-panel');panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Relatório INSS e FGTS');
  const header=make('header','tgr-header'),title=make('h2','','INSS E FGTS'),refresh=make('button','tgr-button','↻');
  refresh.type='button';refresh.setAttribute('aria-label','Atualizar relatório INSS e FGTS');header.append(title,refresh);
  const filterBar=make('div','tgr-filters'),controls=new Map();
  for(const [field,label] of FILTERS){const holder=make('label','tgr-filter'),select=make('select');select.name=field;select.setAttribute('aria-label',label);holder.append(make('span','',label),select);filterBar.append(holder);controls.set(field,select);}
  const feedback=make('p','tgr-feedback');feedback.setAttribute('role','status');
  const scroll=make('div','tgr-scroll');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Guias INSS e FGTS');
  const table=make('table','tgr-table'),head=make('thead'),heading=make('tr'),body=make('tbody');
  for(const label of [...FIELDS.map(([,label])=>label),'Guia']){const th=make('th','',label);th.scope='col';heading.append(th);}
  head.append(heading);table.append(head,body);scroll.append(table);panel.append(header,filterBar,feedback,scroll);root.append(panel);doc.body.append(root);
  const closeButton=addReportCloseControl({root,toolbar:header,onClose:close});
  const landscape=bindReportLandscape(root),filters=bindSearchableFilterSelects(filterBar);
  let rows=[],loaded=false,revision=0,controller=null,attachmentController=null,context=null,destroyed=false,editor=null;
  function edit(row,mode,trigger){
    if(editor||root.hidden)return;
    editor=openTaxGuideReportEditor({document:doc,host:root,background:panel,row,mode,data,pickAttachments,
      async onChanged(){await load();if(!root.hidden){
        const updated=body.querySelector(`[data-guide-id="${row.id}"]`);
        (updated?.querySelector(`[data-guide-action="${mode}"]`)||updated?.querySelector('button')||panel).focus({preventScroll:true});
      }},
      onClose(){editor=null;if(!root.hidden)trigger?.focus({preventScroll:true});}});
  }
  function action(row,mode,text){
    const button=make('button','tgr-cell-action',text);button.type='button';button.dataset.guideAction=mode;
    button.setAttribute('aria-label',`${mode==='amount'?'Informar valor da':'Anexar'} guia ${row.fields?.TIPO||''}, competência ${dateLabel(row.fields?.COMPETENCIA)}`);
    button.addEventListener('click',()=>edit(row,mode,button));return button;
  }
  function syncFilters(){
    for(const [field,select] of controls){
      const previous=select.value,values=[...new Set(rows.map(row=>String(row.fields?.[field]??'')).filter(Boolean))].sort((a,b)=>field==='COMPETENCIA'?b.localeCompare(a):a.localeCompare(b,'pt-BR'));
      select.replaceChildren(Object.assign(make('option','','Todos'),{value:''}));
      for(const value of values)select.append(Object.assign(make('option','',field==='COMPETENCIA'?dateLabel(value):value),{value}));
      select.value=values.includes(previous)?previous:'';
    }
    filters.sync();
  }
  function render(){
    body.replaceChildren();
    const visible=rows.filter(row=>[...controls].every(([field,select])=>!select.value||String(row.fields?.[field]??'')===select.value));
    for(const row of visible){
      const tr=make('tr');tr.dataset.guideId=String(row.id);
      tr.dataset.guideStatus=String(row.fields?.STATUS??'').trim().toUpperCase();
      for(const [field] of FIELDS){const value=row.fields?.[field],cell=make('td','',field==='VALOR'?amountLabel(value):field==='COMPETENCIA'||field==='VENCIMENTO'?dateLabel(value):String(value??'A informar'));
        if(field==='VALOR'&&amountLabel(value)==='A informar'&&typeof data.saveEditor==='function'){cell.setAttribute('aria-label','A informar');cell.replaceChildren(action(row,'amount','A informar'));}
        tr.append(cell);}
      const cell=make('td'),hasAttachments=row.hasAttachments??row.fields?.Attachments;
      const canAttach=typeof data.saveEditor==='function'&&typeof pickAttachments==='function';
      if(hasAttachments===false){
        cell.setAttribute('aria-label','Guia pendente');
        if(canAttach)cell.append(action(row,'attach','Guia pendente'));else cell.textContent='Guia pendente';
      }else{
        const actions=make('div','tgr-attachment-actions'),button=make('button','tgr-attachment');
        button.type='button';button.setAttribute('aria-label',`Abrir guia ${row.fields?.TIPO||''}, competência ${dateLabel(row.fields?.COMPETENCIA)}`);
        button.innerHTML=PDF_ATTACHMENT_ICON;button.append(make('span','','PDF'));button.addEventListener('click',()=>void preview(row,button));
        actions.append(button);
        if(canAttach){
          const add=action(row,'attach','+');add.className='tgr-button tgr-attachment-add';add.title=add.getAttribute('aria-label');
          actions.append(add);
        }
        cell.append(actions);
      }
      tr.append(cell);body.append(tr);
    }
    feedback.textContent=visible.length?`${visible.length} guia(s)`:'Nenhuma guia encontrada para os filtros selecionados.';
  }
  async function preview(row,trigger){
    attachmentController?.abort();const current=new AbortController();attachmentController=current;trigger.disabled=true;
    try{
      if(typeof openMediaCollection!=='function')throw new Error('Visualizador indisponível.');
      const files=await data.listAttachments(String(row.id),{refresh:true,signal:current.signal});
      if(destroyed||root.hidden||current.signal.aborted)return;
      const items=files.map(file=>({fileName:String(file.fileName||file.name||''),source:options=>data.downloadAttachment(String(row.id),String(file.fileName||file.name||''),options)})).filter(file=>file.fileName);
      if(!items.length){feedback.textContent='Nenhuma guia anexada a este registro.';return;}
      await openMediaCollection(items,{signal:current.signal,returnLabel:'Voltar ao relatório INSS e FGTS',resolveReturnFocus:()=>trigger});
    }catch(error){if(!current.signal.aborted&&!root.hidden)feedback.textContent='Não foi possível abrir os anexos da guia. Tente novamente.';}
    finally{if(attachmentController===current)attachmentController=null;trigger.disabled=false;}
  }
  async function load(){
    editor?.close();
    controller?.abort();const active=new AbortController(),current=++revision;controller=active;loaded=false;rows=[];root.setAttribute('aria-busy','true');refresh.disabled=true;body.replaceChildren();feedback.textContent='Consultando guias INSS e FGTS…';
    try{
      const snapshot=await data.loadSnapshot({refresh:true,signal:active.signal});
      if(destroyed||root.hidden||active.signal.aborted||current!==revision)return;
      rows=[...(snapshot.rows||[])].sort((a,b)=>dateKey(b.fields?.COMPETENCIA).localeCompare(dateKey(a.fields?.COMPETENCIA))||String(a.fields?.TIPO||'').localeCompare(String(b.fields?.TIPO||'')));
      loaded=true;syncFilters();render();
    }catch(error){if(!active.signal.aborted&&current===revision&&!root.hidden)feedback.textContent='Não foi possível consultar as guias. Toque em atualizar para tentar novamente.';}
    finally{if(current===revision){root.setAttribute('aria-busy','false');refresh.disabled=false;}}
  }
  function close(){
    if(root.hidden)return;
    revision++;controller?.abort();attachmentController?.abort();editor?.close();filters.close();root.hidden=true;root.setAttribute('aria-busy','false');landscape.update();
    if(context){const previous=context;context=null;if(previous.app&&!previous.inert)previous.app.removeAttribute('inert');doc.body.style.overflow=previous.overflow;(previous.focus?.isConnected?previous.focus:doc.querySelector('[data-action="open-tax-guides-report"]'))?.focus({preventScroll:true});}
  }
  root.addEventListener('click',event=>{if(event.target===root)close();});
  panel.addEventListener('keydown',event=>{
    if(event.defaultPrevented)return;
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key!=='Tab')return;
    const focusable=[...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(node=>!node.closest('[hidden],[inert]'));
    const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first?.focus();}
  });
  filterBar.addEventListener('change',()=>{if(loaded&&!root.hidden)render();});refresh.addEventListener('click',()=>void load());
  return {element:root,async open(){if(destroyed)return false;if(root.hidden){const app=doc.getElementById('app');context={app,inert:app?.hasAttribute('inert'),overflow:doc.body.style.overflow,focus:doc.activeElement};app?.setAttribute('inert','');doc.body.style.overflow='hidden';}root.hidden=false;landscape.update();closeButton.focus({preventScroll:true});await load();return !destroyed&&!root.hidden;},close,destroy(){if(destroyed)return;close();destroyed=true;filters.destroy();landscape.destroy();root.remove();}};
}
