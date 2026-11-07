import {copyDdaText} from './dda-card.js';
let sequence=0;

export function addDdaReportBarcode({document:doc,row,line,actions,expanded,copyText=text=>copyDdaText(doc,text),isCurrent=()=>true}){
 const make=(tag,cls,text)=>{const node=doc.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const toggle=make('button','ddr-barcode-toggle');toggle.type='button';toggle.dataset.ddaToggleBarcode=row.id;
 const id=`dda-report-barcode-${++sequence}`;let detail=null;
 function update(){
  const open=expanded.has(row.id);toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',`${open?'Ocultar':'Mostrar'} linha digitável do DDA ${row.id}`);toggle.textContent=open?'▾':'▸';
  detail?.remove();detail=null;
  if(!open){toggle.removeAttribute('aria-controls');return;}
  toggle.setAttribute('aria-controls',id);
  detail=make('tr','ddr-barcode-detail');detail.dataset.ddaBarcodePanel=row.id;detail.id=id;
  const cell=make('td'),panel=make('div','ddr-barcode-cluster'),text=make('div','ddr-barcode-text');cell.colSpan=9;
  const paymentLine=row.paymentLine;
  text.append(make('strong','','Linha digitável para pagamento'),make('code','',paymentLine||'Linha digitável não disponível.'));
  const copy=make('button','ddr-barcode-copy','⧉ Copiar linha digitável');copy.type='button';copy.dataset.ddaCopyBarcode=row.id;copy.disabled=!paymentLine;copy.setAttribute('aria-label','Copiar linha digitável do DDA '+row.id);
  const feedback=make('span','ddr-barcode-feedback');feedback.setAttribute('role','status');
  copy.addEventListener('click',async()=>{
   if(copy.disabled||!isCurrent()||!copy.isConnected)return;copy.disabled=true;feedback.textContent='';
   try{await copyText(paymentLine);if(isCurrent()&&copy.isConnected)feedback.textContent='Linha digitável copiada.';}
   catch{if(isCurrent()&&copy.isConnected)feedback.textContent='Não foi possível copiar. Tente novamente.';}
   finally{if(copy.isConnected)copy.disabled=!paymentLine;}
  });
  panel.append(text,copy,feedback);cell.append(panel);detail.append(cell);line.after(detail);
 }
 toggle.addEventListener('click',()=>{if(!isCurrent()||!line.isConnected)return;if(expanded.has(row.id))expanded.delete(row.id);else expanded.add(row.id);update();});
 actions.append(toggle);update();
}
