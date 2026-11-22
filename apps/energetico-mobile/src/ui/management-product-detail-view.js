import {formatReportMoney} from '../chat/contractor-report-model.js';

let sequence=0;
const date=value=>/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value||'')?value.split('-').reverse().join('/'):'—';
const amount=value=>Number.isFinite(value)?formatReportMoney(value):'INCOMPLETO';
const quantity=value=>Number.isFinite(value)?new Intl.NumberFormat('pt-BR',{maximumFractionDigits:6}).format(value):'INCOMPLETO';
const unit=value=>Number.isFinite(value)?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:6}).format(value):'INCOMPLETO';

export function createManagementProductDetailView({root,onClose=()=>{}}) {
  const doc=root.ownerDocument;
  const make=(tag,className='',text)=>{const node=doc.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const backdrop=make('div','gm-product-backdrop');backdrop.hidden=true;
  const dialog=make('section','gm-product-dialog');dialog.tabIndex=-1;
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  dialog.setAttribute('aria-label','Detalhamento do produto');
  const header=make('header','gm-product-header'),heading=make('div'),title=make('h2'),subtitle=make('p');
  title.id=`gm-product-title-${++sequence}`;dialog.setAttribute('aria-labelledby',title.id);
  const closeButton=make('button','gm-product-close','Fechar');closeButton.type='button';
  closeButton.setAttribute('aria-label','Fechar detalhamento do produto');
  heading.append(title,subtitle);header.append(heading,closeButton);
  const scroll=make('div','gm-product-scroll');scroll.tabIndex=0;
  scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Registros do produto');
  dialog.append(header,scroll);backdrop.append(dialog);root.append(backdrop);
  let trigger=null,background=[],destroyed=false;
  function close({restoreFocus=true}={}) {
    if(backdrop.hidden)return;
    backdrop.hidden=true;scroll.replaceChildren();title.textContent='';subtitle.textContent='';
    for(const [node,inert] of background)node.inert=inert;
    background=[];
    if(restoreFocus&&trigger?.isConnected)trigger.focus({preventScroll:true});
    trigger=null;onClose();
  }
  closeButton.addEventListener('click',()=>close());
  backdrop.addEventListener('click',event=>{if(event.target===backdrop)close();event.stopPropagation();});
  backdrop.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
    if(event.key!=='Tab')return;
    event.stopPropagation();
    if(event.shiftKey&&(doc.activeElement===closeButton||doc.activeElement===dialog)){event.preventDefault();scroll.focus();}
    else if(!event.shiftKey&&(doc.activeElement===scroll||doc.activeElement===dialog)){event.preventDefault();closeButton.focus();}
  });
  return Object.freeze({
    get isOpen(){return !backdrop.hidden;},
    open(detail,source) {
      if(destroyed)return;
      close({restoreFocus:false});
      trigger=source||doc.activeElement;
      title.textContent=detail.product;subtitle.textContent=detail.branch;
      const table=make('table','gm-product-table'),columns=make('colgroup');
      for(const width of [14,19,27,10,15,15]){const col=make('col');col.style.width=`${width}%`;columns.append(col);}
      const head=make('thead'),labels=make('tr');
      for(const text of ['DATA','DATAPGTOEFETUADO','FORNECEDOR','QTD','VALOR UNITÁRIO','TOTAL']){
        const th=make('th','',text);th.scope='col';labels.append(th);
      }
      head.append(labels);table.append(columns,head);
      let hasFreight=false;
      for(const section of detail.sections) {
        const body=make('tbody'),period=make('tr','gm-product-period');
        const label=make('th','',`${section.previous?'MÊS ANTERIOR':'PERÍODO ANALISADO'} — ${section.period}`);
        label.colSpan=6;label.scope='rowgroup';period.append(label);body.append(period);
        if(!section.rows.length){const row=make('tr'),empty=make('td','','Nenhum registro para este produto no período analisado.');empty.colSpan=6;row.append(empty);body.append(row);}
        for(const entry of section.rows) {
          const row=make('tr');row.dataset.entryId=entry.id??'';row.dataset.source=entry.source;
          for(const [name,text] of [['date',date(entry.date)],['paymentDate',date(entry.paymentDate)],
            ['supplier',entry.supplier||'—'],['quantity',quantity(entry.quantity)],['unit',unit(entry.unit)],['total',amount(entry.total)]]){
            const cell=make('td','',text);cell.dataset.column=name;row.append(cell);
          }
          if(entry.source==='forecast')row.cells[0].append(make('small','gm-product-source',`PREVISTO${entry.dueDate?' · '+date(entry.dueDate):''}`));
          if(entry.freight){hasFreight=true;row.cells[5].title=`Total inclui frete de ${amount(entry.freight)}.`;}
          body.append(row);
        }
        if(section.subtotal) {
          const {quantity:totalQuantity,total}=section.subtotal;
          const row=make('tr','gm-product-subtotal');
          const label=make('th','','TOTAL DO MÊS');
          label.colSpan=3;label.scope='row';
          const quantityCell=make('td','',quantity(totalQuantity));
          quantityCell.dataset.column='quantity';
          const totalCell=make('td','',amount(total));
          totalCell.dataset.column='total';
          row.append(label,quantityCell,make('td'),totalCell);
          body.append(row);
        }
        table.append(body);
      }
      scroll.replaceChildren(table);
      if(hasFreight)scroll.append(make('p','gm-product-freight','Os totais incluem o frete informado no registro.'));
      background=[...root.children].filter(node=>node!==backdrop).map(node=>[node,Boolean(node.inert)]);
      for(const [node] of background)node.inert=true;
      backdrop.hidden=false;scroll.scrollTop=0;closeButton.focus({preventScroll:true});
    },
    close,
    destroy(){if(destroyed)return;close({restoreFocus:false});destroyed=true;backdrop.remove();},
  });
}
