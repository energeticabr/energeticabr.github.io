import {formatReportMoney} from '../chat/contractor-report-model.js';

let sequence=0;
const money=value=>Number.isFinite(value)?formatReportMoney(value):'INCOMPLETO';
const compactMoney=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',notation:'compact',maximumFractionDigits:1}).format(value);
const shortMonth=period=>{
  const [year,month]=period.split('-');
  return `${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][Number(month)-1]}/${year.slice(-2)}`;
};

export function createManagementExpenseTypeDashboardView({root,onClose=()=>{}}) {
  const doc=root.ownerDocument;
  const make=(tag,className='',text)=>{const node=doc.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const backdrop=make('div','gm-expense-dashboard-backdrop');backdrop.hidden=true;
  const dialog=make('section','gm-expense-dashboard');dialog.tabIndex=-1;
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Análise do tipo de despesa');
  const header=make('header','gm-expense-dashboard-header'),heading=make('div'),title=make('h2'),subtitle=make('p');
  title.id=`gm-expense-dashboard-title-${++sequence}`;dialog.setAttribute('aria-labelledby',title.id);
  const closeButton=make('button','gm-expense-dashboard-close','Fechar');closeButton.type='button';closeButton.setAttribute('aria-label','Fechar análise do tipo de despesa');
  heading.append(title,subtitle);header.append(heading,closeButton);
  const scroll=make('div','gm-expense-dashboard-scroll');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Gráficos e rankings de gastos');
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
  function renderTrend(data) {
    const section=make('section','gm-expense-dashboard-card gm-expense-dashboard-trend-card');
    const heading=make('div','gm-expense-dashboard-card-heading');heading.append(make('h3','','Gastos nos últimos 12 meses'),make('span','','R$'));section.append(heading);
    const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('gm-expense-dashboard-trend');
    svg.setAttribute('viewBox','0 0 900 280');svg.setAttribute('role','img');svg.setAttribute('aria-label','Evolução mensal de gastos pagos, previstos e totais nos últimos 12 meses');
    const max=Math.max(0,...data.months.flatMap(month=>[month.paid,month.forecast,month.total]).filter(Number.isFinite));
    const scale=max||1, xAt=index=>96+index*(750/11), yAt=value=>214-(value/scale)*165;
    for(let grid=0;grid<4;grid++){
      const y=214-grid*55,line=doc.createElementNS(svg.namespaceURI,'line');line.setAttribute('x1','91');line.setAttribute('x2','865');line.setAttribute('y1',String(y));line.setAttribute('y2',String(y));line.classList.add('gm-dashboard-grid');svg.append(line);
      const scaleLabel=doc.createElementNS(svg.namespaceURI,'text');scaleLabel.setAttribute('x','85');scaleLabel.setAttribute('y',String(y-4));scaleLabel.setAttribute('text-anchor','end');scaleLabel.textContent=compactMoney(max*grid/3);scaleLabel.classList.add('gm-dashboard-scale-label');svg.append(scaleLabel);
    }
    const series=[['total','Total','var(--gm-chart-total)'],['paid','Pago','var(--gm-chart-paid)'],['forecast','Previsto','var(--gm-chart-forecast)']];
    for(const [field,label,color] of series){
      const group=doc.createElementNS(svg.namespaceURI,'g');group.classList.add('gm-expense-dashboard-series',`is-${field}`);group.dataset.series=field;
      const points=data.months.map((month,index)=>({x:xAt(index),y:yAt(month[field]??0),month,value:month[field]}));
      const path=doc.createElementNS(svg.namespaceURI,'path');
      const commands=points.map((point,index)=>{
        if(index===0)return `M ${point.x} ${point.y}`;
        const previous=points[index-1],mid=(previous.x+point.x)/2;
        return `C ${mid} ${previous.y}, ${mid} ${point.y}, ${point.x} ${point.y}`;
      }).join(' ');
      path.setAttribute('d',commands);path.setAttribute('fill','none');path.setAttribute('stroke',color);path.classList.add('gm-dashboard-line');group.append(path);
      for(const point of points){
        const circle=doc.createElementNS(svg.namespaceURI,'circle');circle.setAttribute('cx',String(point.x));circle.setAttribute('cy',String(point.y));circle.setAttribute('r','4');circle.setAttribute('fill',color);circle.setAttribute('tabindex','0');
        circle.setAttribute('aria-label',`${label} em ${shortMonth(point.month.period)}: ${money(point.value)}`);
        const tooltip=doc.createElementNS(svg.namespaceURI,'title');tooltip.textContent=`${label} · ${shortMonth(point.month.period)}: ${money(point.value)}`;circle.append(tooltip);group.append(circle);
      }
      svg.append(group);
    }
    for(const [index,month] of data.months.entries()){
      const label=doc.createElementNS(svg.namespaceURI,'text');label.setAttribute('x',String(xAt(index)));label.setAttribute('y','246');label.setAttribute('text-anchor','middle');label.textContent=shortMonth(month.period);label.classList.add('gm-dashboard-month-label');svg.append(label);
    }
    const legend=make('div','gm-expense-dashboard-legend');
    for(const [field,label] of series){
      const button=make('button',`gm-dashboard-legend-item is-${field}`,label);button.type='button';button.dataset.series=field;button.setAttribute('aria-pressed','true');
      button.addEventListener('click',()=>{
        const visible=button.getAttribute('aria-pressed')==='true';button.setAttribute('aria-pressed',String(!visible));
        const line=svg.querySelector(`[data-series="${field}"]`);line.hidden=visible;
      });legend.append(button);
    }
    section.append(svg,legend);return section;
  }
  function renderRanking(titleText,items,sectionClass){
    const section=make('section',`gm-expense-dashboard-card gm-expense-dashboard-ranking ${sectionClass}`);section.append(make('h3','',titleText));
    const max=Math.max(0,...items.map(item=>item.total||0));
    if(!items.length){section.append(make('p','gm-expense-dashboard-empty','Sem gastos no período.'));return section;}
    for(const [index,item] of items.entries()){
      const row=make('div','gm-dashboard-rank-row');row.setAttribute('aria-label',`${item.name}: ${money(item.total)}, ${Number.isFinite(item.percentage)?item.percentage.toLocaleString('pt-BR',{maximumFractionDigits:1}):'incompleto'} por cento`);
      const rank=make('span','gm-dashboard-rank-number',String(index+1).padStart(2,'0'));
      const label=make('span','gm-dashboard-rank-name',item.name);
      const track=make('span','gm-dashboard-rank-track'),bar=make('span','gm-dashboard-rank-bar');bar.style.width=`${max>0&&Number.isFinite(item.total)?Math.max(0,item.total/max*100):0}%`;bar.title=`${money(item.total)} · ${Number.isFinite(item.percentage)?item.percentage.toLocaleString('pt-BR',{maximumFractionDigits:2}):'INCOMPLETO'}%`;
      const value=make('strong','gm-dashboard-rank-value',money(item.total));
      const share=make('span','gm-dashboard-rank-share',Number.isFinite(item.percentage)?`${item.percentage.toLocaleString('pt-BR',{maximumFractionDigits:1})}%`:'INCOMPLETO');track.append(bar);row.append(rank,label,track,value,share);section.append(row);
    }
    return section;
  }
  function render(data){
    title.textContent=data.expenseType;subtitle.textContent=data.branch;
    const metrics=make('section','gm-expense-dashboard-metrics');
    for(const [label,value,kind] of [['Total no período',data.total,'total'],['Pago',data.months.reduce((sum,item)=>sum+(item.paid||0),0),'paid'],['Previsto',data.months.reduce((sum,item)=>sum+(item.forecast||0),0),'forecast']]){
      const card=make('div',`gm-expense-dashboard-metric is-${kind}`);card.append(make('span','',label),make('strong','',money(value)));metrics.append(card);
    }
    const rankings=make('div','gm-expense-dashboard-rankings');
    rankings.append(renderRanking('Principais produtos',data.products,'is-products'),renderRanking('Principais fornecedores',data.suppliers,'is-suppliers'),renderRanking('Principais etapas',data.stages,'is-stages'));
    scroll.replaceChildren(metrics,renderTrend(data),rankings);
  }
  closeButton.addEventListener('click',()=>close());
  backdrop.addEventListener('click',event=>{if(event.target===backdrop)close();event.stopPropagation();});
  backdrop.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
    if(event.key!=='Tab')return;event.stopPropagation();
    if(event.shiftKey&&(doc.activeElement===closeButton||doc.activeElement===dialog)){event.preventDefault();scroll.focus();}
    else if(!event.shiftKey&&(doc.activeElement===scroll||doc.activeElement===dialog)){event.preventDefault();closeButton.focus();}
  });
  return Object.freeze({
    get isOpen(){return !backdrop.hidden;},
    open(data,source){
      if(destroyed)return;close({restoreFocus:false});trigger=source||doc.activeElement;render(data);
      background=[...root.children].filter(node=>node!==backdrop).map(node=>[node,Boolean(node.inert)]);
      for(const [node] of background)node.inert=true;
      backdrop.hidden=false;scroll.scrollTop=0;closeButton.focus({preventScroll:true});
    },
    close,
    destroy(){if(destroyed)return;close({restoreFocus:false});destroyed=true;backdrop.remove();},
  });
}
