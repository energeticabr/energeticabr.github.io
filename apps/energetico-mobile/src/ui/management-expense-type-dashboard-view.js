import {formatReportMoney} from '../chat/contractor-report-model.js';

let sequence=0;
const money=value=>Number.isFinite(value)?formatReportMoney(value):'INCOMPLETO';
const compactValue=value=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
const shortMonth=period=>{
  const [year,month]=period.split('-');
  return `${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][Number(month)-1]}/${year.slice(-2)}`;
};
const valueLabelOffsets = [0, -19, 19, -38, 38, -57, 57, -76, 76];

export function createManagementExpenseTypeDashboardView({root,onClose=()=>{}}) {
  const doc=root.ownerDocument;
  const make=(tag,className='',text)=>{const node=doc.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const backdrop=make('div','gm-expense-dashboard-backdrop');backdrop.hidden=true;
  const dialog=make('section','gm-expense-dashboard');dialog.tabIndex=-1;
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  const header=make('header','gm-expense-dashboard-header'),heading=make('div'),title=make('h2'),subtitle=make('p');
  title.id=`gm-expense-dashboard-title-${++sequence}`;dialog.setAttribute('aria-labelledby',title.id);
  const actions=make('div','gm-expense-dashboard-actions');
  const yearFilter=make('label','gm-expense-dashboard-year','Ano');
  const yearSelect=make('select');yearSelect.name='analysis-year';
  yearFilter.append(yearSelect);
  const closeButton=make('button','gm-expense-dashboard-close','Fechar');closeButton.type='button';
  actions.append(yearFilter,closeButton);heading.append(title,subtitle);header.append(heading,actions);
  const scroll=make('div','gm-expense-dashboard-scroll');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Gráficos e rankings de gastos');
  dialog.append(header,scroll);backdrop.append(dialog);root.append(backdrop);
  let trigger=null,background=[],destroyed=false,trendObserver,buildYear;
  const hiddenSeries=new Set();

  function close({restoreFocus=true}={}) {
    if(backdrop.hidden)return;
    trendObserver?.disconnect();trendObserver=undefined;
    hiddenSeries.clear();
    backdrop.hidden=true;scroll.replaceChildren();title.textContent='';subtitle.textContent='';
    for(const [node,inert] of background)node.inert=inert;
    background=[];
    if(restoreFocus&&trigger?.isConnected)trigger.focus({preventScroll:true});
    trigger=null;buildYear=null;onClose();
  }
  function renderTrend(data) {
    const section=make('section','gm-expense-dashboard-card gm-expense-dashboard-trend-card');
    const heading=make('div','gm-expense-dashboard-card-heading');
    const monthDetail=make('div','gm-expense-dashboard-month-detail');monthDetail.hidden=true;monthDetail.setAttribute('role','status');monthDetail.setAttribute('aria-live','polite');
    heading.append(make('h3','',`Gastos em ${data.year}`),monthDetail,make('span','','R$'));
    section.append(heading);
    function makeSvg(tag, attributes = {}, text) {
      const element = doc.createElementNS('http://www.w3.org/2000/svg', tag);
      setAttributes(element, attributes);
      if (text !== undefined) element.textContent = text;
      return element;
    }
    function setAttributes(element, attributes) {
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
    }
    const svg = makeSvg('svg', {
      class: 'gm-expense-dashboard-trend', role: 'img',
      'aria-label': `Evolução mensal de gastos pagos, previstos e totais em ${data.year}`,
    });
    const values = data.months.flatMap(month => [month.paid, month.forecast, month.total]).filter(Number.isFinite);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const grid = Array.from({ length: 4 }, (_, index) => {
      const value = min + (max - min) * index / 3;
      const line = makeSvg('line', { class: 'gm-dashboard-grid' });
      const label = makeSvg('text', { class: 'gm-dashboard-scale-label', 'text-anchor': 'end' }, compactValue(value));
      svg.append(line, label);
      return { line, label };
    });
    const series=[['total','Total','var(--gm-chart-total)'],['paid','Pago','var(--gm-chart-paid)'],['forecast','Previsto','var(--gm-chart-forecast)']];
    function showMonth(index) {
      const month=data.months[index];if(!month)return;
      if(monthDetail.dataset.monthIndex===String(index)){monthDetail.hidden=false;return;}
      monthDetail.replaceChildren();monthDetail.dataset.month=month.period;monthDetail.dataset.monthIndex=String(index);
      monthDetail.append(make('strong','gm-expense-dashboard-month-title',shortMonth(month.period)));
      for(const [field,label] of series){
        const value=make('span',`gm-expense-dashboard-month-value is-${field}`);
        value.append(make('span','',label),make('strong','',money(month[field])));monthDetail.append(value);
      }
      monthDetail.hidden=false;
    }
    const plots = series.map(([field, label, color]) => {
      const group = makeSvg('g', { class: `gm-expense-dashboard-series is-${field}`, 'data-series': field });
      const path = makeSvg('path', { class: 'gm-dashboard-line', fill: 'none', stroke: color });
      group.append(path);
      const points = data.months.map((month, index) => {
        const value = month[field];
        const period = shortMonth(month.period);
        const amount = money(value);
        const circle = makeSvg('circle', {
          r: 4, fill: color, tabindex: 0, 'data-month-index': index, 'aria-label': `${label} em ${period}: ${amount}`,
        });
        circle.append(makeSvg('title', {}, `${label} · ${period}: ${amount}`));
        circle.addEventListener('focus', () => showMonth(index));
        circle.addEventListener('click', () => showMonth(index));
        group.append(circle);
        const valueLabel = Number.isFinite(value) ? makeSvg('text', {
          class: 'gm-dashboard-value-label', 'text-anchor': 'middle', 'aria-hidden': 'true',
        }, compactValue(value)) : null;
        return { value, circle, label: valueLabel };
      });
      for (const point of points) if (point.label) group.append(point.label);
      svg.append(group);
      return { field, group, path, points };
    });
    const [totalPlot, paidPlot] = plots;
    const monthLabels = data.months.map(month => {
      const label = makeSvg('text', { class: 'gm-dashboard-month-label', 'text-anchor': 'middle' }, shortMonth(month.period));
      svg.append(label);
      return label;
    });
    let startX, monthStep;
    function layout() {
      const width = svg.clientWidth || 900;
      const height = svg.clientHeight || 220;
      const top = 29;
      const textWidth = label => label.getComputedTextLength?.() || label.textContent.length * 7;
      for (const tick of grid) tick.width ??= textWidth(tick.label);
      const scaleRight = Math.max(...grid.map(tick => tick.width)) + 4;
      const valueLabels = plots.flatMap(plot => plot.points.filter(point => point.label));
      for (const point of valueLabels) point.width ??= textWidth(point.label);
      for (const { field, group } of plots) group.toggleAttribute('hidden', hiddenSeries.has(field));
      const monthLabelWidth = Math.max(0, ...monthLabels.map(textWidth));
      const edge = Math.ceil(Math.max(monthLabelWidth, ...valueLabels.map(point => point.width)) / 2) + 4;
      startX = Math.max(scaleRight + 11, edge);
      const endX = width - edge;
      monthStep = (endX - startX) / Math.max(1, monthLabels.length - 1);
      const xAt = index => startX + monthStep * index;
      const staggerMonths = monthStep < monthLabelWidth + 3;
      const bottom = height - (staggerMonths ? 56 : 40);
      const yAt = value => bottom - ((value - min) / (max - min || 1)) * (bottom - top);

      const occupied = grid.map(({ label, line, width: labelWidth }, index) => {
        const y = bottom - (bottom - top) * index / (grid.length - 1);
        setAttributes(line, { x1: scaleRight + 5, x2: width - 4, y1: y, y2: y });
        setAttributes(label, { x: scaleRight, y: y + 4 });
        return { x: scaleRight - labelWidth / 2, y: y + 4, width: labelWidth };
      });
      monthLabels.forEach((label, index) => {
        const y = height - 5 - (staggerMonths && index % 2 === 0 ? 16 : 0);
        setAttributes(label, { x: xAt(index), y });
      });

      const mergeEqualLabels = !totalPlot.group.hasAttribute('hidden') && !paidPlot.group.hasAttribute('hidden');
      for (const plot of plots) {
        const { group, path, points } = plot;
        const positions = points.map((point, index) => ({ x: xAt(index), y: yAt(point.value ?? 0) }));
        const commands = positions.map(({ x, y }, index) => {
          if (index === 0) return `M ${x} ${y}`;
          const previous = positions[index - 1];
          const mid = (previous.x + x) / 2;
          return `C ${mid} ${previous.y}, ${mid} ${y}, ${x} ${y}`;
        });
        path.setAttribute('d', commands.join(' '));
        points.forEach((point, index) => {
          const { x, y } = positions[index];
          setAttributes(point.circle, { cx: x, cy: y });
          if (!point.label || group.hasAttribute('hidden')) return;
          let labelPoint = point;
          if (mergeEqualLabels && (plot === totalPlot || plot === paidPlot) &&
              totalPlot.points[index].value === paidPlot.points[index].value) {
            // Position the shared label in the Total pass so it keeps that month's priority.
            if (plot === paidPlot) return;
            point.label.setAttribute('hidden', '');
            labelPoint = paidPlot.points[index];
          }
          const { label, width: labelWidth } = labelPoint;
          label.classList.toggle('is-shared', labelPoint !== point);
          const labelY = valueLabelOffsets.map(offset => y - 10 + offset).find(candidate =>
            candidate >= 16 && candidate <= bottom + 16 && !occupied.some(other =>
              Math.abs(other.x - x) < (other.width + labelWidth) / 2 + 4 && Math.abs(other.y - candidate) < 19));
          label.toggleAttribute('hidden', labelY === undefined);
          if (labelY === undefined) return;
          setAttributes(label, { x, y: labelY });
          occupied.push({ x, y: labelY, width: labelWidth });
        });
      }
    }
    svg.addEventListener('pointermove',event=>{
      const matrix = svg.getScreenCTM?.();
      const chartX = matrix
        ? new doc.defaultView.DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()).x
        : event.clientX - svg.getBoundingClientRect().left;
      showMonth(Math.max(0, Math.min(data.months.length - 1, Math.round((chartX - startX) / monthStep))));
    });
    svg.addEventListener('pointerleave',event=>{if(event.pointerType!=='touch')monthDetail.hidden=true;});
    svg.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();
      const current=Number(monthDetail.dataset.monthIndex||0),next=Math.max(0,Math.min(data.months.length-1,current+(event.key==='ArrowRight'?1:-1)));
      showMonth(next);
    });
    const legend=make('div','gm-expense-dashboard-legend');
    for(const [field,label] of series){
      const button=make('button',`gm-dashboard-legend-item is-${field}`,label);button.type='button';button.dataset.series=field;
      button.setAttribute('aria-pressed',String(!hiddenSeries.has(field)));
      button.addEventListener('click',()=>{
        const hide=!hiddenSeries.has(field);
        if(hide)hiddenSeries.add(field);
        else hiddenSeries.delete(field);
        button.setAttribute('aria-pressed',String(!hide));
        layout();
      });legend.append(button);
    }
    section.append(svg, legend);
    return { section, svg, layout };
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
    trendObserver?.disconnect();trendObserver=undefined;
    title.textContent=data.name??data.expenseType;subtitle.textContent=data.branch;
    const subject={supplier:'do fornecedor',stage:'da etapa',account:'da conta'}[data.field]??'do tipo de despesa';
    dialog.setAttribute('aria-label',`Análise ${subject}`);
    closeButton.setAttribute('aria-label',`Fechar análise ${subject}`);
    const metrics=make('section','gm-expense-dashboard-metrics');
    const sumMonths=field=>data.months.every(item=>Number.isFinite(item[field]))
      ? data.months.reduce((sum,item)=>sum+item[field],0) : null;
    for(const [label,value,kind] of [['Total no período',data.total,'total'],['Pago',sumMonths('paid'),'paid'],['Previsto',sumMonths('forecast'),'forecast']]){
      const card=make('div',`gm-expense-dashboard-metric is-${kind}`);card.append(make('span','',label),make('strong','',money(value)));metrics.append(card);
    }
    const rankings=make('div','gm-expense-dashboard-rankings');
    rankings.append(renderRanking('Principais produtos',data.products,'is-products'));
    if(data.suppliers)rankings.append(renderRanking('Principais fornecedores',data.suppliers,'is-suppliers'));
    if(data.stages)rankings.append(renderRanking('Principais etapas',data.stages,'is-stages'));
    if(rankings.childElementCount===2)rankings.classList.add('gm-expense-dashboard-rankings--two-columns');
    const trend = renderTrend(data);
    scroll.replaceChildren(metrics, trend.section, rankings);
    scroll.scrollTop=0;
    trend.layout();
    const ResizeObserver = doc.defaultView.ResizeObserver;
    if (ResizeObserver) {
      trendObserver = new ResizeObserver(trend.layout);
      trendObserver.observe(trend.svg);
    }
  }
  yearSelect.addEventListener('change',()=>{
    const option=yearSelect.selectedOptions[0];
    if(buildYear&&option&&!option.disabled)render(buildYear(Number(option.value)));
  });
  closeButton.addEventListener('click',()=>close());
  backdrop.addEventListener('click',event=>{if(event.target===backdrop)close();event.stopPropagation();});
  backdrop.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
    if(event.key!=='Tab')return;event.stopPropagation();
    const firstControl=yearSelect.disabled?closeButton:yearSelect;
    const lastControl=scroll.querySelector('.gm-expense-dashboard-legend button:last-child')||scroll;
    if(event.shiftKey&&(doc.activeElement===firstControl||doc.activeElement===dialog)){event.preventDefault();lastControl.focus();}
    else if(!event.shiftKey&&(doc.activeElement===lastControl||doc.activeElement===dialog)){event.preventDefault();firstControl.focus();}
  });
  return Object.freeze({
    get isOpen(){return !backdrop.hidden;},
    open(loadYear,source){
      if(destroyed)return;close({restoreFocus:false});trigger=source||doc.activeElement;
      buildYear=loadYear;
      const data=buildYear();
      yearSelect.replaceChildren(...data.years.map(year=>make('option','',String(year))));
      if(!data.years.includes(data.year)){
        const current=make('option','',String(data.year));current.disabled=true;current.hidden=true;
        yearSelect.prepend(current);
      }
      yearSelect.disabled=!data.years.length;
      yearSelect.value=String(data.year);
      background=[...root.children].filter(node=>node!==backdrop).map(node=>[node,Boolean(node.inert)]);
      for(const [node] of background)node.inert=true;
      backdrop.hidden=false;render(data);closeButton.focus({preventScroll:true});
    },
    close,
    destroy(){if(destroyed)return;close({restoreFocus:false});destroyed=true;backdrop.remove();},
  });
}
