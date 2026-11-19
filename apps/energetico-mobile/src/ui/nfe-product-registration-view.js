import { bindSearchableFilterSelects } from './searchable-filter-selects.js';

export function showNfeProductRegistration({ document:doc, dialog, service, original, signal, pickerOptions, feedback, onBusy, onFinish }) {
  const el=(tag,className='',text)=>{const node=doc.createElement(tag);node.className=className;if(text!=null)node.textContent=text;return node;};
  const form=el('form','nfe-proposal-form nfe-product-form');
  form.dataset.nfeProductForm='';form.noValidate=true;
  const body=el('div','nfe-proposal-body');
  const fields=el('fieldset','nfe-proposal-fields');fields.disabled=true;
  const controls={},labels={};
  for(const [name,label,select,value] of [
    ['name','Nome do produto',false,original.description],['subfamilyId','Subfamília',true],
    ['unit','Unidade de medida',false,original.unit],['expenseType','Tipo de despesa',true],['disburses','Gera desembolso',true],
  ]) {
    const wrapper=el('label',select?'nfe-proposal-select':'');
    const control=el(select?'select':'input');control.name=name;control.required=true;
    if(!select){control.type='text';control.maxLength=255;control.value=value || '';}
    wrapper.append(el('span','',label),control);fields.append(wrapper);controls[name]=control;labels[name]=label;
  }
  const footer=el('footer','nfe-proposal-footer');
  const cancel=el('button','','Voltar à proposta');cancel.type='button';cancel.dataset.nfeProductCancel='';
  const save=el('button','','SALVAR PRODUTO');save.type='submit';save.disabled=true;
  footer.append(cancel,save);body.append(fields);form.append(body,footer);dialog.append(form);
  let context,pickers,busy=false,finished=false;
  function finish(product) {
    if(finished || busy) return;
    finished=true;pickers?.destroy();signal.removeEventListener('abort',abort);form.remove();onFinish(product);
  }
  const abort=()=>{busy=false;finish();};
  signal.addEventListener('abort',abort,{once:true});
  cancel.addEventListener('click',()=>finish());
  const populate=(control,options)=>{
    const blank=el('option','','Selecione');blank.value='';
    control.replaceChildren(blank,...options.map(option=>{const node=el('option','',option.label||option);node.value=option.id||option;return node;}));
  };
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!context||busy||finished)return;
    const invalid=Object.entries(controls).find(([,control])=>!control.validity.valid);
    if(invalid){
      const [name,control]=invalid;
      feedback(`Preencha o campo ${labels[name]}.`,true);
      (control.hidden?control.closest('.nfe-proposal-select')?.querySelector('.sfs-trigger'):control)?.focus({preventScroll:true});
      return;
    }
    busy=true;fields.disabled=save.disabled=cancel.disabled=true;onBusy(true);feedback('Cadastrando produto…');
    try {
      const product=await service.save(context,Object.fromEntries(Object.entries(controls).map(([name,control])=>[name,control.value])),{signal});
      if(signal.aborted||finished)return;
      busy=false;onBusy(false);finish(product);
    }catch(error){if(!signal.aborted&&!finished)feedback(error?.message||'Não foi possível cadastrar o produto.',true);}
    finally{if(!signal.aborted&&!finished){busy=false;fields.disabled=save.disabled=cancel.disabled=false;onBusy(false);}}
  });
  feedback('Carregando o cadastro de produtos…');
  Promise.resolve().then(()=>service.load({signal})).then(result=>{
    if(signal.aborted||finished)return;
    context=result;
    populate(controls.subfamilyId,result.subfamilies);populate(controls.expenseType,result.expenseTypes);populate(controls.disburses,result.disburses);
    fields.disabled=save.disabled=false;
    pickers=bindSearchableFilterSelects(fields,pickerOptions);
    feedback('Preencha os dados e salve para usar o produto nesta proposta.');
    controls.name.focus({preventScroll:true});
  }).catch(error=>{if(!signal.aborted&&!finished)feedback(error?.message||'Não foi possível carregar o cadastro.',true);});
  return ()=>finish();
}
