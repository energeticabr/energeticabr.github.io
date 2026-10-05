import { createLoadingIndicator } from './loading-indicator.js';
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';
import { payrollFieldKey } from '../chat/payroll-editor-policy.js';

export function createPayrollPaymentComposer({document:doc,host,loadOptions,save,onSaved,onClose}={}) {
  let current=null,sequence=0;
  const el=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  function close(force=false) {
    if(!current||current.busy&&!force)return;
    const state=current;current=null;state.abort.abort();state.picker?.destroy();state.overlay.remove();
    if(state.trigger?.isConnected)state.trigger.focus();onClose?.();
  }
  async function open(trigger) {
    if(current)return;
    const overlay=el('div','gallery-record-overlay gallery-record-overlay--screen');
    const screen=el('section','gallery-record-dialog gallery-record-screen payroll-payment-screen');
    screen.dataset.payrollPaymentScreen='';screen.setAttribute('role','region');screen.setAttribute('aria-label','Acrescentar pagamento');screen.tabIndex=-1;
    const header=el('header','payroll-payment-header'),heading=el('h2','gallery-record-dialog-title','Acrescentar pagamento'),cancel=el('button','hr-gallery-button payroll-payment-cancel','CANCELAR');
    cancel.type='button';cancel.dataset.paymentCancel='';header.append(heading);
    const actions=el('div','dynamic-form-actions payroll-payment-actions'),submit=el('button','hr-gallery-button payroll-payment-submit','SUBMETER');
    submit.type='submit';submit.disabled=true;actions.append(cancel,submit);
    const body=el('div'),error=el('p','gallery-record-dialog-error');error.setAttribute('role','alert');error.hidden=true;
    body.append(createLoadingIndicator(doc,'Carregando lançamentos e folhas…'));screen.append(header,error,body,actions);overlay.append(screen);host.append(overlay);
    const state={overlay,screen,trigger,abort:new AbortController(),busy:false,operationId:doc.defaultView.crypto.randomUUID(),saved:null};current=state;
    cancel.addEventListener('click',()=>close());overlay.addEventListener('click',event=>event.stopPropagation());
    overlay.addEventListener('keydown',event=>{
      event.stopPropagation();if(event.defaultPrevented)return;
      if(event.key==='Escape'){event.preventDefault();close();}
      if(event.key==='Tab') {
        const controls=[...screen.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]')].filter(node=>!node.closest('[hidden]'));
        const first=controls[0],last=controls.at(-1);
        if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===screen)){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&(doc.activeElement===last||doc.activeElement===screen)){event.preventDefault();first?.focus();}
      }
    });
    screen.focus();
    const active=()=>current===state;
    const fail=err=>{if(active()){error.textContent=err?.message||'Não foi possível cadastrar o pagamento.';error.hidden=false;}};
    try {
      const options=await loadOptions({signal:state.abort.signal});if(!active())return;
      body.replaceChildren();
      const form=el('form','dynamic-form'),grid=el('div','dynamic-form-grid');
      form.id=`payroll-payment-${state.operationId}`;submit.setAttribute('form',form.id);
      const select=(name,label,placeholder)=>{const field=el('label','dynamic-field',label),control=el('select');control.name=name;control.required=true;control.setAttribute('aria-label',label);control.append(new doc.defaultView.Option(placeholder,''));field.append(control);grid.append(field);return control;};
      const launch=select('IDLANCAMENTO','Lançamento (IDLANCAMENTO)','Selecione o lançamento');
      for(const row of options.launches) launch.append(new doc.defaultView.Option(`${row.id} — ${row.supplier}${row.description?` — ${row.description}`:''}`,row.id));
      const summary=el('table','payroll-payment-summary');summary.setAttribute('aria-label','Dados do fornecedor e do lançamento');summary.hidden=true;
      const rows=el('tbody'),values=[];
      for(const label of ['Fornecedor','Valor unitário','Qtd','Data']) {const row=el('tr'),key=el('th','',label),value=el('td');key.scope='row';row.append(key,value);rows.append(row);values.push(value);}
      summary.append(rows);const [supplier,unitValue,quantity,date]=values;supplier.dataset.paymentSupplier='';summary.dataset.paymentValues='';
      const type=select('TIPOPGTO','Tipo de pagamento','Selecione o tipo');for(const value of options.paymentTypes)type.append(new doc.defaultView.Option(value,value));
      const sheet=select('IDFOLHA','Folha (IDFOLHA)','Selecione a folha');sheet.disabled=true;
      form.append(grid,summary);body.append(form);
      function update() {
        const selected=options.launches.find(row=>row.id===launch.value);
        sheet.replaceChildren(new doc.defaultView.Option('Selecione a folha',''));sheet.disabled=!selected;
        for(const row of selected?options.sheets.filter(row=>payrollFieldKey(row.supplier)===payrollFieldKey(selected.supplier)):[])sheet.append(new doc.defaultView.Option(`${row.id} — ${row.label}`,row.id));
        summary.hidden=!selected;supplier.textContent=selected?.supplier||'';
        const unit=typeof selected?.unitValue==='string'&&selected.unitValue.includes(',')?selected.unitValue.replace(/\./g,'').replace(',','.'):selected?.unitValue;
        unitValue.textContent=selected&&Number.isFinite(Number(unit))?Number(unit).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'—';
        quantity.textContent=selected?.quantity??'—';date.textContent=selected?.date?.split('-').reverse().join('/')||'—';
        submit.disabled=!selected||sheet.options.length===1;
        if(selected&&sheet.options.length===1)fail(new Error('Este fornecedor não possui folha cadastrada do mês anterior, atual ou próximo.'));
        else error.hidden=true;
        state.picker?.sync();
      }
      launch.addEventListener('change',update);update();state.picker=bindSearchableFilterSelects(form);
      form.addEventListener('submit',async event=>{
        event.preventDefault();if(!active()||state.busy)return;
        if(!state.saved&&(!launch.value||!sheet.value||!type.value)){fail(new Error('Selecione o lançamento, o tipo de pagamento e a folha.'));return;}
        state.busy=true;error.hidden=true;screen.setAttribute('aria-busy','true');
        const controls=[...screen.querySelectorAll('button,input,select')],disabled=controls.map(c=>c.disabled);controls.forEach(c=>{c.disabled=true;});state.picker?.close();
        try {
          state.saved ||= await save({launchId:launch.value,sheetId:sheet.value,paymentType:type.value},{operationId:state.operationId});
          if(!active())return;
          await onSaved?.(state.saved);if(active())close(true);
        } catch(err) {fail(err);if(state.saved)submit.textContent='Atualizar galeria';}
        finally {if(active()){state.busy=false;screen.setAttribute('aria-busy','false');controls.forEach((c,i)=>{c.disabled=disabled[i];});if(state.saved){launch.disabled=true;sheet.disabled=true;type.disabled=true;}state.picker?.sync();}}
      });
      if(!options.launches.length)fail(new Error('Nenhum lançamento de fornecedor empreiteiro SIM e ATIVO foi encontrado.'));
    } catch(err) {if(active()){body.replaceChildren();fail(err);const retry=el('button','hr-gallery-button','Tentar novamente');retry.type='button';body.append(retry);retry.addEventListener('click',()=>{close();void open(trigger);});}}
  }
  return Object.freeze({open,close:()=>close(true),isOpen:()=>Boolean(current)});
}
