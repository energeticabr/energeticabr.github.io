const LOGO = new URL('../../../../assets/logo-energetica-oficial.png', import.meta.url).href;
export const REPORT_PDF_TITLES = Object.freeze({
 'open-pending-provisions':'Provisões de pagamento pendentes',
 'open-provision-report':'Provisões de pagamento e despesas recorrentes',
 'open-payment-ledger':'Relatório de pagamentos', 'open-management-report':'Resumo gerencial de gastos',
 'open-order-validation-report':'Validação de notas pendentes e pedidos para baixa',
 'open-cargos-table':'Tabela de cargos', 'open-attendance-summary':'Resumo de presenças e ausências',
 'open-supplier-payroll-report':'Folhas de pagamento por fornecedor',
 'open-pending-supplier-payments-report':'Pagamentos pendentes por fornecedor',
 'open-supplier-workforce-report':'Fornecedores por filial, imóvel e profissão',
 'open-contractor-control-report':'Controle de empreiteiros',
 'open-pending-work-diaries-report':'Diários de obras pendentes',
 'open-stage-progress':'Etapas e atividades da obra', 'open-commercial-receipts':'Contratos e pagamentos',
 'open-commercial-milestones':'Andamento comercial dos imóveis',
 'open-commercial-documents':'Pendências documentais dos imóveis', 'open-sac-pathologies':'Acompanhamento de patologias',
 'open-quotation-report':'Cotações e orçamentos', 'open-depreciation-report':'Depreciação do imobilizado',
 'open-document-control-report':'Controle de documentos', 'open-task-association-report':'Atividades por associação',
 'open-delegated-deadline-report':'Tarefas delegadas por data fatal',
});
const PRINTER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8V3h12v5M6 17H3V9h18v8h-3M6 14h12v7H6z"/><path d="M6 11h.01"/></svg>';
const REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3v6h-6M20.485 9A9 9 0 1 0 21 12"/></svg>';
export function pendingReportPrintMarkup(){
 return `<button type="button" class="report-print-button report-print-pending" data-action="print-pending-provisions" aria-label="Abrir PDF das provisões pendentes" title="Abrir PDF do relatório">${PRINTER}</button>`;
}
const OMIT = 'button,input,select,textarea,nav,script,style,link,img,svg,[hidden],[aria-hidden="true"],.report-pdf-status,.sfs-popup,.sfs-control,.cargos-hint,[class*="-filters"],[class*="-toolbar"],[class*="-orientation"]';
const BLOCK_TAGS = 'div,p,section,article,header,footer,ul,ol,li,dl,dt,dd,h1,h2,h3,h4,h5,h6,table';
function color(value){
 const match=/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value||'');
 return match&&Number(match[4]??1)>0 ? match.slice(1,4).map(n=>Math.max(0,Math.min(1,Number(n)/255))) : null;
}
function styleOf(node){return node.ownerDocument.defaultView?.getComputedStyle(node);}
function textColor(node){for(let n=node;n;n=n.parentElement){const parsed=color(styleOf(n)?.color);if(parsed)return parsed;}return [0,0,0];}
function background(node,stop){for(let n=node;n&&n!==stop;n=n.parentElement){const parsed=color(styleOf(n)?.backgroundColor);if(parsed)return parsed;}return null;}
function hidden(node){return Boolean(node.closest('[hidden]'))||styleOf(node)?.display==='none'||styleOf(node)?.visibility==='hidden';}
function loadError(root){return [...root.querySelectorAll('[role="status"],[role="alert"],[class*="-notice"]')].some(node=>!node.classList.contains('report-pdf-status')&&!hidden(node)&&/^(?:Não foi possível|Falha na consulta|Data inválida|A data inicial não pode)/i.test(node.textContent.trim()));}
function runsOf(node){
 const runs=[];
 function visit(n){
  if(n.nodeType===3){const text=n.textContent.replace(/\s+/g,' ');if(!text.trim())return;const parent=n.parentElement,weight=styleOf(parent)?.fontWeight;
   runs.push({text,bold:Number(weight)>=600||weight==='bold'||Boolean(parent.closest('strong,b,th,h1,h2,h3,h4,h5,h6')),color:textColor(parent)});return;}
  if(n.nodeType!==1||n.matches(OMIT)||hidden(n))return;
  if(n.tagName==='BR'){runs.push({text:'\n',bold:false,color:textColor(n)});return;}
  for(const child of n.childNodes)visit(child);
  if(n!==node&&runs.length)runs.at(-1).text+=' ';
 }
 visit(node);
 const plain=runs.map(run=>run.text).join('').trim();
 // Several status cells contain only an emoji; their accessible name holds the actual status.
 if(!/[\p{L}\p{N}]/u.test(plain)&&(node.getAttribute('aria-label')||node.title))return [{text:node.getAttribute('aria-label')||node.title,bold:false,color:textColor(node)}];
 const normalized=runs.filter(run=>run.text.trim());
 if(normalized.length){normalized[0].text=normalized[0].text.trimStart();normalized.at(-1).text=normalized.at(-1).text.trimEnd();}
 return normalized;
}
function tableBlock(table,root){
 const rows=[],spans=[];let columns=0;
 for(const row of [...table.rows].filter(row=>row.closest('table')===table&&!hidden(row))){
  const cells=[];let column=0;
  function carried(){while(spans[column]?.remaining>0){const span=spans[column];cells.push({...span.cell,column});span.remaining--;column+=span.cell.colSpan;}}
  for(const cell of row.cells){carried();const colSpan=Math.max(1,cell.colSpan||1);
   const entry={column,colSpan,runs:runsOf(cell),background:background(cell,root),align:styleOf(cell)?.textAlign||'left'};cells.push(entry);
   if(cell.rowSpan>1)spans[column]={remaining:cell.rowSpan-1,cell:entry};column+=colSpan;
  }
  carried();columns=Math.max(columns,column);rows.push({header:row.parentElement.tagName==='THEAD',cells});
 }
 const colWidths=[...table.querySelectorAll(':scope > colgroup > col')].map(col=>parseFloat(col.style.width));
 const widths=colWidths.length===columns&&colWidths.every(n=>n>0)?colWidths:Array.from({length:columns},(_,index)=>{
  const header=rows.find(row=>row.header)?.cells.find(cell=>cell.column===index),rect=header?table.rows[0]?.cells[index]?.getBoundingClientRect():null;
  return rect?.width||Math.max(6,Math.min(35,...rows.map(row=>row.cells.find(cell=>cell.column===index)?.runs.map(run=>run.text).join('').length||6)));
 });
 return {type:'table',widths,rows};
}
function readBlocks(root){
 const blocks=[];
 function visit(node){
  if(node.nodeType!==1||node.matches(OMIT)||hidden(node))return;
  if(node.tagName==='TABLE'){blocks.push(tableBlock(node,root));return;}
  if(!node.querySelector(BLOCK_TAGS)||/^H[1-6]$/.test(node.tagName)||['P','DT','DD','LI'].includes(node.tagName)&&!node.querySelector('table')){
   const runs=runsOf(node);if(runs.length)blocks.push({type:'text',runs,background:background(node,root),heading:/^H[1-6]$/.test(node.tagName)});return;
  }
  for(const child of node.childNodes){
   if(child.nodeType===1)visit(child);
   else if(child.nodeType===3&&child.textContent.trim())blocks.push({type:'text',runs:[{text:child.textContent.trim(),bold:false,color:textColor(node)}],background:background(node,root),heading:false});
  }
 }
 visit(root);return blocks;
}
function readFilters(root){
 return [...root.querySelectorAll('select[name],input[name]')].filter(input=>!input.parentElement.closest('[hidden]')).map(input=>{
  const display=input.name.endsWith('Date')?root.querySelector(`[data-date-display="${input.name}"]`):null;
  const label=input.getAttribute('aria-label')?.replace(/^Calendário: /,'')||input.parentElement.querySelector('.sfs-trigger')?.getAttribute('aria-label')||input.parentElement.querySelector('.sfs-search')?.getAttribute('aria-label')||input.closest('label')?.querySelector('span')?.textContent||input.closest('label')?.firstChild?.textContent||input.name;
  let value=input.tagName==='SELECT'?[...input.selectedOptions].map(option=>option.label).join(', '):input.value;
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))value=`${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)}`;
  return {label:String(label).trim(),value:String(value||display?.placeholder||'Todos').trim()};
 });
}
/** Read only already-loaded, filtered content. Pagers are synchronous; restore the exact page and scroll before returning. */
export function captureFilteredReport(root,{title}={}){
 if(!root?.isConnected||root.hidden||root.closest('[hidden]')||root.matches('[aria-busy="true"]')||root.querySelector('[aria-busy="true"]'))throw new Error('Aguarde o carregamento do relatório.');
 if(loadError(root))throw new Error('Não foi possível carregar o relatório. Use Atualizar e tente novamente.');
 if([...root.querySelectorAll('input')].some(input=>!input.checkValidity()))throw new Error('Confira as datas dos filtros antes de gerar o PDF.');
 const scrolls=[root,...root.querySelectorAll('*')].filter(node=>node.scrollTop||node.scrollLeft).map(node=>[node,node.scrollTop,node.scrollLeft]);
 const pager=root.querySelector('nav[class*="-pager"]'),previous=pager?.querySelector('button:first-child'),next=pager?.querySelector('button:last-child');
 const pages=[];let originalPage=0,currentPage=0;
 function move(button){const before=pager.textContent;button.click();if(pager.textContent===before)throw new Error('Não foi possível reunir todas as páginas do relatório.');}
 try{
  if(previous&&next){while(!previous.disabled){if(originalPage>=10000)throw new Error('Paginação inválida.');move(previous);originalPage++;}currentPage=0;}
  do{pages.push({blocks:readBlocks(root)});if(!next||next.disabled)break;if(currentPage>=10000)throw new Error('Paginação inválida.');move(next);currentPage++;}while(true);
  return {title:title||root.getAttribute('aria-label')||'Relatório Energético',filters:readFilters(root),pages};
 }finally{
  if(previous&&next){while(currentPage>originalPage){move(previous);currentPage--;}while(currentPage<originalPage){move(next);currentPage++;}}
  for(const [node,top,left]of scrolls){node.scrollTop=top;node.scrollLeft=left;}
 }
}
async function defaultBuild(snapshot,options){const {buildFilteredReportPdf}=await import('../chat/filtered-report-pdf.js');return buildFilteredReportPdf(snapshot,options);}
async function defaultLogo(){const response=await fetch(LOGO);if(!response.ok)throw new Error('Não foi possível carregar a logo do relatório.');return new Uint8Array(await response.arrayBuffer());}
export function preserveReportPdfReturn(root,{resolveRoot=()=>root}={}){
 const positions=[root,...root.querySelectorAll('*')].filter(node=>node.scrollTop||node.scrollLeft).map(node=>({selector:node===root?null:node.classList.length?'.'+[...node.classList].join('.'):undefined,top:node.scrollTop,left:node.scrollLeft}));
 return ()=>{const current=resolveRoot();if(!current?.isConnected||current.closest('[hidden]'))return;for(const position of positions){const node=position.selector===null?current:position.selector?current.querySelector(position.selector):null;if(node){node.scrollTop=position.top;node.scrollLeft=position.left;}}current.querySelector('[data-action="print-pending-provisions"],[data-action="print-report-pdf"]')?.focus({preventScroll:true});};
}
export function openFilteredReportPdf(root,{action,previewMedia,buildPdf=defaultBuild,loadLogo=defaultLogo,snapshot:captured,onClose,resolveReturnFocus}={}){
 if(typeof previewMedia!=='function')throw new Error('O visualizador de PDF não está disponível.');
 const title=REPORT_PDF_TITLES[action]||'Relatório Energético',snapshot=captured||captureFilteredReport(root,{title});
 const name=title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w -]/g,'').replace(/\s+/g,'-')+'.pdf';
 const pending=Promise.resolve().then(loadLogo).then(logoBytes=>buildPdf(snapshot,{logoBytes}));
 return previewMedia(pending,name,{returnLabel:'Voltar ao relatório',onClose,resolveReturnFocus});
}
export function decorateReportPrint(panel,{action,previewMedia,closePreview,buildPdf,loadLogo}={}){
 const root=panel?.element;if(!root?.ownerDocument||!REPORT_PDF_TITLES[action])return panel;
 const doc=root.ownerDocument,button=doc.createElement('button');button.type='button';button.className='report-print-button';button.dataset.action='print-report-pdf';button.innerHTML=PRINTER;button.setAttribute('aria-label','Abrir PDF do relatório');button.title='Abrir PDF com os filtros atuais';
 let host=root.querySelector('.pl-filters,.dr-toolbar,.qr-toolbar,.dcr-toolbar,.tar-filters,.tar-toolbar,.tdr-toolbar,.pwdr-toolbar,.ccr-toolbar,.cargos-header');
 if(!host&&root.querySelector('.qr-dialog')){host=doc.createElement('header');host.className='qr-toolbar';root.querySelector('.qr-dialog').prepend(host);}
 host||=root.querySelector('[role="dialog"]')||root;
 // The shared PDF action supersedes the old browser-print shortcut.
 host.querySelector('.cr-print')?.remove();
 const refresh=host.querySelector('button[aria-label^="Atualizar"]'),pair=doc.createElement('div');pair.className='report-print-actions';
 if(refresh){refresh.innerHTML=REFRESH;refresh.replaceWith(pair);pair.append(button,refresh);}else{pair.append(button);host.prepend(pair);}
 const status=doc.createElement('p');status.className='report-pdf-status';status.hidden=true;status.setAttribute('role','alert');host.after(status);
 let destroyed=false,busy=false,ownedPreview=null;
 const closeOwned=()=>{if(ownedPreview){ownedPreview=null;closePreview?.();}};
 const update=()=>{if(root.hidden)closeOwned();const disabled=busy||root.hidden||Boolean(root.querySelector('[aria-busy="true"]'))||root.getAttribute('aria-busy')==='true'||loadError(root);if(button.disabled!==disabled)button.disabled=disabled;};
 const observer=new doc.defaultView.MutationObserver(update);observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','aria-busy']});update();
 async function print(event){
  event.preventDefault();event.stopPropagation();if(destroyed||busy||root.hidden||!root.isConnected)return;
  let snapshot,restore;
  busy=true;update();status.hidden=true;
  try{restore=await panel.preparePrint?.();if(destroyed||root.hidden)return;snapshot=captureFilteredReport(root,{title:REPORT_PDF_TITLES[action]});}
  catch(error){if(!destroyed&&!root.hidden){status.textContent='Não foi possível gerar o PDF. Tente novamente.';status.hidden=false;}return;}
  finally{restore?.();busy=false;update();}
  button.focus({preventScroll:true});
  busy=true;update();status.hidden=true;
  const owner=Symbol('report preview');ownedPreview=owner;
  try{await openFilteredReportPdf(root,{action,previewMedia,buildPdf,loadLogo,snapshot,onClose:()=>{if(ownedPreview===owner)ownedPreview=null;}});}
  catch{if(!destroyed&&!root.hidden){status.textContent='Não foi possível gerar o PDF. Tente novamente.';status.hidden=false;}}
  finally{busy=false;update();}
 }
 button.addEventListener('click',print);
 return Object.freeze({...panel,close(){closeOwned();panel.close?.();update();},destroy(){if(destroyed)return;destroyed=true;observer.disconnect();button.removeEventListener('click',print);closeOwned();pair.remove();status.remove();panel.destroy?.();}});
}
