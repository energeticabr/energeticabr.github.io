import {formatReportMoney} from '../chat/contractor-report-model.js';
import {bindSvgChartOption, restoreChartOption} from './management-chart-filter.js';

let sequence=0;
const quantityFormat=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:6});
const unitFormat=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:6});
const date=value=>/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value||'')?value.split('-').reverse().join('/'):'—';
const amount=value=>Number.isFinite(value)?formatReportMoney(value):'INCOMPLETO';
const quantity=value=>Number.isFinite(value)?quantityFormat.format(value):'INCOMPLETO';
const unit=value=>Number.isFinite(value)?unitFormat.format(value):'INCOMPLETO';

export {date as formatDetailDate, quantity as formatDetailQuantity, unit as formatDetailUnit};

const svgNamespace='http://www.w3.org/2000/svg';
function svgNode(doc,name,attributes={}) {
  const node=doc.createElementNS(svgNamespace,name);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));
  return node;
}
const chartMoney=value=>Number.isFinite(value)?formatReportMoney(value):'INCOMPLETO';
const chartQuantity=value=>Number.isFinite(value)?quantityFormat.format(value):'INCOMPLETO';
function chartScale(values) {
  const finite=values.filter(Number.isFinite);
  let min=Math.min(0,...finite),max=Math.max(0,...finite);
  if(min===max)max=min+1;
  return {min,max,position:value=>(value-min)/(max-min)};
}
function addChartHeading(doc,container,title,subtitle) {
  const heading=doc.createElement('h3');heading.textContent=title;container.append(heading);
  if(subtitle){const note=doc.createElement('p');note.className='gm-product-chart-period';note.textContent=subtitle;container.append(note);}
}
function chartTitle(doc,svg,title,description) {
  const titleNode=svgNode(doc,'title');titleNode.textContent=title;
  const descriptionNode=svgNode(doc,'desc');descriptionNode.textContent=description;
  svg.append(titleNode,descriptionNode);
}
function chartOption(doc,svg,source,value,label,hitArea,interaction) {
  const option=svgNode(doc,'g');
  svg.append(option);
  if(!interaction)return option;
  const key=`${source}:${value}`;
  bindSvgChartOption(option,{
    key,label,selected:interaction.filter?.source===source&&interaction.filter.value===value,
    activate:()=>interaction.select(source,value,key),
  });
  option.append(svgNode(doc,'rect',{...hitArea,class:'gm-product-chart-hit','aria-hidden':'true'}));
  return option;
}

function appendMonthlyValueChart(doc,parent,analytics,interaction) {
  const section=doc.createElement('section');section.className='gm-product-chart';section.dataset.chart='monthly-purchases';
  addChartHeading(doc,section,'Valor mensal das compras',`${analytics.startPeriod} a ${analytics.endPeriod}`);
  const months=analytics.purchaseMonths||analytics.months,scale=chartScale(months.map(month=>month.total));
  const svg=svgNode(doc,'svg',{class:'gm-product-chart-svg',viewBox:'0 0 760 260',role:interaction?'group':'img',
    'aria-label':`Valor mensal das compras em reais, de ${analytics.startPeriod} a ${analytics.endPeriod}`});
  chartTitle(doc,svg,'Valor mensal das compras',months.map(month=>`${month.period}: ${chartMoney(month.total)}.`).join(' '));
  const left=96,right=748,top=18,bottom=207,plotHeight=bottom-top;
  for(let tick=0;tick<=4;tick++){
    const value=scale.min+(scale.max-scale.min)*tick/4,y=bottom-plotHeight*tick/4;
    svg.append(svgNode(doc,'line',{class:'gm-product-chart-grid',x1:left,x2:right,y1:y,y2:y}));
    const label=svgNode(doc,'text',{class:'gm-product-chart-axis',x:left-8,y:y+4,'text-anchor':'end'});
    label.textContent=chartMoney(value);svg.append(label);
  }
  const xFor=index=>left+(right-left)*index/Math.max(1,months.length-1);
  const yFor=value=>bottom-plotHeight*scale.position(value);
  const commands=[];let previous=null;
  months.forEach((month,index)=>{
    const value=month.total,x=xFor(index);
    if(!Number.isFinite(value)){previous=null;return;}
    const y=yFor(value);
    if(previous&&previous.index===index-1){const middle=(previous.x+x)/2;commands.push(`C ${middle} ${previous.y} ${middle} ${y} ${x} ${y}`);}
    else commands.push(`M ${x} ${y}`);
    previous={index,x,y};
  });
  svg.append(svgNode(doc,'path',{class:'gm-product-chart-line',d:commands.join(' '),'data-series':''}));
  const slot=(right-left)/Math.max(1,months.length-1);
  months.forEach((month,index)=>{
    const x=xFor(index),label=svgNode(doc,'text',{class:'gm-product-chart-month',x,y:231,'text-anchor':'middle'});
    const description=`${month.period}: ${chartMoney(month.total)}`;
    const hitX=x-slot/2;
    const option=chartOption(doc,svg,section.dataset.chart,month.key,description,
      {x:hitX,y:top,width:Math.min(slot,760-hitX),height:219},interaction);
    label.textContent=month.label;option.append(label);
    if(Number.isFinite(month.total)){
      const point=svgNode(doc,'circle',{class:'gm-product-chart-point',cx:x,cy:yFor(month.total),r:4,'data-month-point':month.key});
      const pointTitle=svgNode(doc,'title');pointTitle.textContent=description;point.append(pointTitle);option.append(point);
    }
  });
  section.append(svg);parent.append(section);
}
function appendSupplierChart(doc,parent,analytics,interaction) {
  const section=doc.createElement('section');section.className='gm-product-chart';section.dataset.chart='suppliers';
  addChartHeading(doc,section,'Valor comprado por fornecedor',`${analytics.startPeriod} a ${analytics.endPeriod}`);
  if(!analytics.suppliers.length){const empty=doc.createElement('p');empty.className='gm-product-chart-empty';empty.textContent='Nenhuma compra registrada neste período.';section.append(empty);parent.append(section);return;}
  const width=900,rowHeight=38,height=Math.max(72,analytics.suppliers.length*rowHeight+22);
  const svg=svgNode(doc,'svg',{class:'gm-product-chart-svg gm-product-supplier-svg',viewBox:`0 0 ${width} ${height}`,
    role:interaction?'group':'img','aria-label':`Valor comprado por fornecedor, de ${analytics.startPeriod} a ${analytics.endPeriod}`});
  chartTitle(doc,svg,'Valor comprado por fornecedor',analytics.suppliers.map(row=>`${row.name}: ${chartMoney(row.total)}.`).join(' '));
  const values=analytics.suppliers.map(row=>row.total),scale=chartScale(values),xStart=326,plotWidth=396,valueX=892;
  const zeroX=xStart+plotWidth*scale.position(0);
  svg.append(svgNode(doc,'line',{class:'gm-product-chart-zero',x1:zeroX,x2:zeroX,y1:8,y2:height-5}));
  analytics.suppliers.forEach((supplier,index)=>{
    const y=18+index*rowHeight,rowY=y+10;
    const description=`${supplier.name}: ${chartMoney(supplier.total)}`;
    const option=chartOption(doc,svg,section.dataset.chart,supplier.name,description,
      {x:0,y:y-7,width,height:rowHeight},interaction);
    const label=svgNode(doc,'text',{class:'gm-product-chart-label',x:310,y:rowY+4,'text-anchor':'end',
      textLength:296,lengthAdjust:'spacingAndGlyphs'});
    label.textContent=supplier.name;const labelTitle=svgNode(doc,'title');labelTitle.textContent=supplier.name;label.append(labelTitle);option.append(label);
    const bar=svgNode(doc,'rect',{class:`gm-product-chart-bar${Number.isFinite(supplier.total)?'':' gm-product-chart-bar--incomplete'}`,
      x:Number.isFinite(supplier.total)?Math.min(zeroX,xStart+plotWidth*scale.position(supplier.total)):zeroX,
      y,width:Number.isFinite(supplier.total)?Math.max(1,Math.abs(plotWidth*scale.position(supplier.total)-plotWidth*scale.position(0))):1,
      height:18,rx:3,'data-supplier-bar':supplier.name});
    const barTitle=svgNode(doc,'title');barTitle.textContent=description;bar.append(barTitle);option.append(bar);
    const amount=svgNode(doc,'text',{class:'gm-product-chart-value',x:valueX,y:rowY+4,'text-anchor':'end'});
    amount.textContent=chartMoney(supplier.total);option.append(amount);
  });
  section.append(svg);parent.append(section);
}
function appendMonthlyQuantityChart(doc,parent,analytics,interaction) {
  const section=doc.createElement('section');section.className='gm-product-chart';section.dataset.chart='monthly-quantity';
  addChartHeading(doc,section,'Quantidade adquirida por mês',`${analytics.startPeriod} a ${analytics.endPeriod}`);
  const months=analytics.quantityMonths||analytics.months,scale=chartScale(months.map(month=>month.quantity));
  const svg=svgNode(doc,'svg',{class:'gm-product-chart-svg',viewBox:'0 0 760 260',role:interaction?'group':'img',
    'aria-label':`Quantidade adquirida por mês, de ${analytics.startPeriod} a ${analytics.endPeriod}`});
  chartTitle(doc,svg,'Quantidade adquirida por mês',months.map(month=>`${month.period}: ${chartQuantity(month.quantity)}.`).join(' '));
  const left=96,right=748,top=18,bottom=207,plotHeight=bottom-top;
  for(let tick=0;tick<=4;tick++){
    const value=scale.min+(scale.max-scale.min)*tick/4,y=bottom-plotHeight*tick/4;
    svg.append(svgNode(doc,'line',{class:'gm-product-chart-grid',x1:left,x2:right,y1:y,y2:y}));
    const label=svgNode(doc,'text',{class:'gm-product-chart-axis',x:left-8,y:y+4,'text-anchor':'end'});
    label.textContent=chartQuantity(value);svg.append(label);
  }
  const zeroY=bottom-plotHeight*scale.position(0),slot=(right-left)/months.length,barWidth=slot*.56;
  months.forEach((month,index)=>{
    const x=left+slot*index+slot/2,label=svgNode(doc,'text',{class:'gm-product-chart-month',x,y:231,'text-anchor':'middle'});
    const description=`${month.period}: ${chartQuantity(month.quantity)}`;
    const option=chartOption(doc,svg,section.dataset.chart,month.key,description,
      {x:x-slot/2,y:top,width:slot,height:219},interaction);
    label.textContent=month.label;option.append(label);
    const value=month.quantity,known=Number.isFinite(value),valueY=known?bottom-plotHeight*scale.position(value):zeroY;
    const bar=svgNode(doc,'rect',{class:`gm-product-chart-bar gm-product-chart-column${known?'':' gm-product-chart-bar--incomplete'}`,
      x:x-barWidth/2,y:known?Math.min(zeroY,valueY):zeroY,width:barWidth,
      height:known?Math.max(1,Math.abs(zeroY-valueY)):1,rx:2,'data-month-bar':month.key});
    const barTitle=svgNode(doc,'title');barTitle.textContent=description;bar.append(barTitle);option.append(bar);
  });
  section.append(svg);parent.append(section);
}
function renderProductAnalytics(doc,analytics,interaction) {
  const section=doc.createElement('section');section.className='gm-product-analytics';
  const heading=doc.createElement('h3');heading.className='gm-product-analytics-title';heading.textContent='ANÁLISE DE COMPRAS · ÚLTIMOS 12 MESES';section.append(heading);
  appendMonthlyValueChart(doc,section,analytics,interaction);
  appendSupplierChart(doc,section,analytics,interaction);
  appendMonthlyQuantityChart(doc,section,analytics,interaction);
  return section;
}

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
    const lastControl=[...scroll.querySelectorAll('[data-chart-option]')].at(-1)||scroll;
    if(event.shiftKey&&(doc.activeElement===closeButton||doc.activeElement===dialog)){event.preventDefault();lastControl.focus();}
    else if(!event.shiftKey&&(doc.activeElement===lastControl||doc.activeElement===dialog)){event.preventDefault();closeButton.focus();}
  });
  return Object.freeze({
    get isOpen(){return !backdrop.hidden;},
    open(detail,source,loadAnalytics) {
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
      if(detail.analytics){
        let charts;
        const interaction=loadAnalytics?{
          filter:undefined,
          select(chart,value,key){
            const {filter}=interaction;
            interaction.filter=filter?.source===chart&&filter.value===value?undefined:{source:chart,value};
            const previousTop=scroll.scrollTop;
            const next=renderProductAnalytics(doc,loadAnalytics(interaction.filter),interaction);
            charts.replaceWith(next);charts=next;
            scroll.scrollTop=previousTop;
            restoreChartOption(scroll,key);
          },
        }:undefined;
        charts=renderProductAnalytics(doc,detail.analytics,interaction);
        scroll.append(charts);
      }
      background=[...root.children].filter(node=>node!==backdrop).map(node=>[node,Boolean(node.inert)]);
      for(const [node] of background)node.inert=true;
      backdrop.hidden=false;scroll.scrollTop=0;closeButton.focus({preventScroll:true});
    },
    close,
    destroy(){if(destroyed)return;close({restoreFocus:false});destroyed=true;backdrop.remove();},
  });
}
