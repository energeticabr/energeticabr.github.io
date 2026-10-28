import { ddaPaidManually } from '../chat/dda-payment-confirmation.js';
const ICONS = {
 check:['M5 12l4 4L19 6'],
 calendar:['M4 5h16v16H4z','M8 2v6M16 2v6M4 10h16'],
 money:['M12 2v20','M17 5H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H6'],
 status:['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z','M12 7v6M12 17h.01'],
 document:['M5 2h9l5 5v15H5z','M14 2v6h5M8 13h8M8 17h8'],
 person:['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z','M4 22v-2a8 8 0 0 1 16 0v2'],
 bank:['m2 8 10-6 10 6H2Z','M5 11v8M10 11v8M14 11v8M19 11v8M2 22h20'],
 list:['M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13'],
 barcode:['M3 3v18M6 3v18M10 3v18M12 3v18M17 3v18M21 3v18'],
 line:['M3 3h18v13H3zM12 16v5M7 21h10'],
 lock:['M6 10h12v12H6z','M8 10V6a4 4 0 0 1 8 0v4'],
 copy:['M9 8h12v14H9z','M15 8V2H3v14h6'],
 clock:['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z','M12 6v6l4 2'],
};
function icon(doc,name){
 const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');
 for(const [k,v] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))svg.setAttribute(k,v);
 svg.classList.add('rg-dda-icon');
 for(const d of ICONS[name]){const p=doc.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',d);svg.append(p);}
 return svg;
}
function dayKey(value){
 const text=String(value??'');let key='';
 if(/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(text))key=text.slice(0,10);
 else {const m=text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(m)key=m[3]+'-'+m[2]+'-'+m[1];}
 const date=new Date(key+'T12:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===key?key:'';
}
export function ddaTodayKey(now=new Date()){
 const parts=new Intl.DateTimeFormat('en',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=type=>parts.find(p=>p.type===type).value;
 return part('year')+'-'+part('month')+'-'+part('day');
}
export function ddaDueTone(value,now=new Date()){
 const due=dayKey(value);if(!due)return 'unknown';
 const today=ddaTodayKey(now);
 if(due===today)return 'today';
 const tomorrow=new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 return due===tomorrow?'tomorrow':'other';
}
export function updateDdaDueTones(root,now=new Date()){
 for(const cell of root.querySelectorAll('[data-dda-due]')){
  const tone=ddaDueTone(cell.dataset.ddaDue,now);
  cell.dataset.dueTone=tone;
  const hint=tone==='today'?'Hoje':tone==='tomorrow'?'Amanhã':'';
  const label=cell.querySelector('.rg-dda-due-hint');
  if(label){label.textContent=hint;label.hidden=!hint;}
  cell.setAttribute('aria-label','Vencimento '+(cell.dataset.ddaDue||'não informado')+(hint?' — '+hint:''));
 }
}
export async function copyDdaText(doc,text){
 try{if(doc.defaultView?.navigator?.clipboard?.writeText){await doc.defaultView.navigator.clipboard.writeText(text);return;}}catch{}
 const focused=doc.activeElement,area=doc.createElement('textarea');
 area.value=text;area.readOnly=true;area.style.cssText='position:fixed;opacity:0;left:0;top:0;width:1px;height:1px';
 (focused?.closest?.('dialog[open]') || doc.querySelector('dialog[open]') || doc.body).append(area);
 try{area.focus();area.select();area.setSelectionRange(0,text.length);if(!doc.execCommand?.('copy'))throw new Error('COPY_UNAVAILABLE');}
 finally{area.remove();if(focused?.isConnected)focused.focus?.();}
}
/** Compact presentation only: never changes bank status or financial values. */
export function renderDdaCard({document:doc,container,rowId,title,value,raw=value,now=new Date(),copyText=text=>copyDdaText(doc,text),onConfirmPayment}){
 const el=(tag,cls,text)=>{const e=doc.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 const heading=el('div','rg-dda-heading');heading.append(el('strong','rg-row-title',title),el('span','rg-dda-id','ID '+rowId));container.append(heading);
 if(onConfirmPayment){
  const paid=ddaPaidManually(raw('PGTO_CONFIRMADO'))||/^(pago|liquidado)(\b|$)/i.test(String(value('SITUACAO')));
  const button=el('button','rg-dda-confirm-payment');button.type='button';button.dataset.ddaConfirmPayment=String(rowId);
  button.disabled=paid;button.setAttribute('aria-label',paid?'Pagamento já confirmado do DDA '+rowId:'Confirmar pagamento do DDA '+rowId);
  button.title=paid?'Pagamento confirmado':'Confirmar pagamento';button.append(icon(doc,'check'));heading.append(button);
  button.addEventListener('click',()=>onConfirmPayment(button));
 }
 const pair=(parent,field,label,symbol,cls='')=>{
  const cell=el('div','rg-dda-field '+cls);cell.dataset.field=field;
  cell.append(icon(doc,symbol),el('dt','',label),el('dd','',value(field)||'—'));parent.append(cell);return cell;
 };
 const core=el('dl','rg-dda-core');
 const due=pair(core,'VENCIMENTO','Vencimento','calendar','rg-dda-metric rg-dda-due');
 due.dataset.ddaDue=String(raw('VENCIMENTO')??'');due.append(el('span','rg-dda-due-hint'));
 pair(core,'VALOR','Valor nominal','money','rg-dda-metric rg-dda-amount');
 const status=pair(core,'SITUACAO','Situação','status','rg-dda-metric rg-dda-status');
 const normalized=String(value('SITUACAO')).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 status.dataset.statusTone=/^(pago|liquidado)/.test(normalized)?'paid':/^agendado/.test(normalized)?'scheduled':/^em aberto/.test(normalized)?'open':'neutral';
 container.append(core);
 if(ddaPaidManually(raw('PGTO_CONFIRMADO'))){
  const audit=el('p','rg-dda-payment-audit','Confirmado pelo usuário');
  const date=String(raw('PGTO_CONFIRMADO_EM')||'');const by=String(raw('PGTO_CONFIRMADO_POR')||'');
  if(date&&Number.isFinite(Date.parse(date)))audit.append(el('span','',new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(date))));
  if(by)audit.append(el('span','',by));container.append(audit);
 }
 const body=el('dl','rg-dda-body');
 pair(body,'DOCUMENTO','Documento','document');pair(body,'CNPJ_FORNECEDOR','CPF/CNPJ fornecedor','person');
 pair(body,'BANCO','Banco','bank');pair(body,'NOSSO_NUMERO','Nosso número','list');
 const issued=pair(body,'EMISSAO','Emissão','calendar','rg-dda-issued');
 const issuedKey=dayKey(raw('EMISSAO'));
 issued.querySelector('dd').textContent=issuedKey?issuedKey.slice(8,10)+'/'+issuedKey.slice(5,7)+'/'+issuedKey.slice(0,4):'Não informada';
 container.append(body);
 const codes=el('dl','rg-dda-codes');
 const notice=el('p','rg-dda-copy-notice');notice.setAttribute('role','status');
 for(const [field,label,symbol] of [['CODIGO_BARRAS','Código de barras','barcode'],['LINHA_DIGITAVEL','Linha digitável','line']]){
  const cell=pair(codes,field,label,symbol,'rg-dda-code');
  const code=String(raw(field)??'');const button=el('button','rg-dda-copy');button.type='button';button.dataset.copyField=field;
  button.setAttribute('aria-label','Copiar '+label.toLowerCase()+' do DDA '+rowId);button.title='Copiar '+label.toLowerCase();button.disabled=!code;
  button.append(icon(doc,'copy'));
  button.addEventListener('click',async()=>{
   button.disabled=true;
   try{await copyText(code);notice.textContent=label+' copiado.';}
   catch{notice.textContent='Não foi possível copiar. Selecione o código e copie manualmente.';}
   finally{button.disabled=!code;}
  });cell.append(button);
 }
 container.append(codes,notice);
 const footer=el('dl','rg-dda-footer');pair(footer,'PAGADOR','Pagador','person');pair(footer,'BLOQUEADO','Pagamento bloqueado','lock');container.append(footer);
 const extra=el('details','rg-dda-extra');extra.append(el('summary','','Mais detalhes'));
 const detail=el('dl','rg-dda-body');
 pair(detail,'VALOR_PAGAMENTO','Valor para pagamento','money');pair(detail,'CNPJ_PAGADOR','CPF/CNPJ pagador','person');
 pair(detail,'ULTIMA_CONSULTA','Última consulta','clock');
 if(value('MENSAGEM'))pair(detail,'MENSAGEM','Mensagem do banco','document');
 extra.append(detail);container.append(extra);updateDdaDueTones(container,now);
}

