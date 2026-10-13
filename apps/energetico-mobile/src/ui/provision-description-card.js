const ICONS=Object.freeze({
 branch:['M4 21V3h12v18','M16 9h4v12','M2 21h20','M8 7h4M8 11h4M8 15h4'],
 money:['M3 6c0-4 12-4 12 0s-12 4-12 0Z','M3 6v9c0 4 12 4 12 0V6','M3 10c0 4 12 4 12 0','M15 11c8-2 9 4 3 5','M15 16c8-2 9 4 3 5'],
 calendar:['M4 5h16v16H4z','M8 2v6M16 2v6M4 10h16','M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01'],
 person:['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z','M4 22v-2a8 8 0 0 1 16 0v2Z'],
 edit:['m4 16-1 5 5-1L21 7l-4-4L4 16Z','m14 6 4 4'],
 notes:['M4 3h12l4 4v14H4z','M16 3v5h4M8 12h8M8 16h8'],
 document:['M5 2h9l5 5v15H5z','M14 2v6h5M8 13h8M8 17h8'],
 close:['m6 6 12 12M6 18 18 6'],
 clock:['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z','M12 6v6l4 2'],
 search:['M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z','m16 16 6 6'],
 filter:['M2 3h20l-8 9v8l-4 2V12L2 3Z'],
 status:['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z','m7 12 3 3 7-7'],
 refresh:['M20 9a8 8 0 0 0-14-4L3 8','M3 3v5h5','M4 15a8 8 0 0 0 14 4l3-3','M21 21v-5h-5'],
});

export function provisionDescriptionIcon(doc,name){
 const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');
 for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))svg.setAttribute(key,value);
 svg.classList.add('rg-provision-icon');svg.dataset.icon=name;
 for(const d of ICONS[name]){const path=doc.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.append(path);}
 return svg;
}

/** Presentation only. All source values remain escaped text and all fields are retained. */
export function renderProvisionDescriptionCard({document:doc,container,rowId,title,value}){
 const el=(tag,className,text)=>{const node=doc.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;};
 const heading=el('div','rg-provision-heading');
 heading.append(el('strong','rg-row-title',title),el('span','rg-document-id',`ID ${rowId}`));container.append(heading);
 const pair=(parent,field,label,icon,tone='',fallback='—')=>{const row=el('div',`rg-provision-detail${tone?` rg-provision-detail--${tone}`:''}`);row.dataset.field=field;row.append(provisionDescriptionIcon(doc,icon),el('dt','',label),el('dd','',String(value(field)||fallback)));parent.append(row);};
 const core=el('dl','rg-provision-core');
 pair(core,'STATUS','Status','status','status');
 pair(core,'FILIAL','Filial','branch');pair(core,'VALORTOTAL','Valor total','money','total');
 pair(core,'DATAPGTOEFETUADO','Data pgto efetuado','calendar','paid');pair(core,'DATA PREVISTO PGTO','Data previsto pgto','calendar','due');container.append(core);
 const extra=el('dl','rg-provision-extra');
 for(const [field,label,icon] of [['FORMAPGTO','Forma de pagamento','money'],['PGTOAGENDADO','Pgto agendado','calendar'],['DATAPGTOAGENDADO','Data pgto agendado','calendar'],['DATAEXECUCAOAGENDAMENTO','Data execução agendamento','calendar'],['OBS','Observação','notes']])if(value(field))pair(extra,field,label,icon,field==='OBS'?'notes':'');
 if(extra.children.length)container.append(extra);
 const audit=el('dl','rg-provision-audit');
 pair(audit,'Criado por','Criado por','person','','Usuário não identificado');pair(audit,'Criado','Criado','calendar');
 pair(audit,'Modificado por','Modificado por','edit','','Usuário não identificado');pair(audit,'Modificado','Modificado','calendar');container.append(audit);
}
