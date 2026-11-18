import { buildGanttCostDetail } from '../chat/stage-gantt-cost-model.js';
import { formatReportMoney } from '../chat/contractor-report-model.js';

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const money = value => Number.isFinite(value) ? formatReportMoney(value) : 'INCOMPLETO';
const percent = value => Number.isFinite(value) ? `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)}%` : 'INCOMPLETO';

export function renderGanttCostDetail({ container, snapshot, selection }) {
  const doc = container.ownerDocument;
  const make = (tag, className = '', text = '') => {
    const node = doc.createElement(tag); node.className = className; node.textContent = text; return node;
  };
  let detail = buildGanttCostDetail(snapshot, selection);
  container.replaceChildren();
  if (!detail.years.length) {
    container.append(make('p', '', 'Nenhum custo registrado para esta etapa.')); return;
  }
  const filters = make('div', 'gantt-cost-filters'), controls = {};
  for (const [name, label] of [['year', 'Ano'], ['month', 'Mês']]) {
    const holder = make('label', '', label), select = make('select');
    select.name = name; select.setAttribute('aria-label', label);
    holder.append(select); filters.append(holder); controls[name] = select;
    select.addEventListener('change', () => {
      detail = buildGanttCostDetail(snapshot, selection, { year: controls.year.value, month: controls.month.value });
      render();
    });
  }
  const results = make('div', 'gantt-cost-results'); results.setAttribute('aria-live', 'polite');
  container.append(filters, results);
  function options(select, values, selected, label) {
    select.replaceChildren(...values.map(value => {
      const option = make('option', '', label(value)); option.value = value; return option;
    }));
    select.value = selected;
  }
  function amounts(row, values, summary = false) {
    for (const field of ['paid', 'forecast', 'percentage', 'total']) {
      const cell = make('td', `gantt-cost-${field}`, field === 'percentage' ? percent(values[field]) : money(values[field]));
      if (summary && field !== 'percentage') cell.dataset.costTotal = field;
      row.append(cell);
    }
  }
  function render() {
    options(controls.year, detail.years, detail.year, value => value);
    options(controls.month, ['', ...detail.months], detail.month, value => value ? MONTHS[Number(value) - 1] : 'Todos os meses com custo');
    results.replaceChildren(make('p', 'gantt-detail-total', detail.report.period));
    const explanation = make('p', 'gantt-cost-explanation', 'Pago pela data do pagamento; previsto pela data prevista de pagamento.');
    results.append(explanation);
    if (detail.report.incompleteCount) results.append(make('p', 'gantt-cost-warning', 'Há valores incompletos. Os totais afetados estão indicados como INCOMPLETO.'));
    const scroller = make('div', 'gantt-cost-scroll'); scroller.tabIndex = 0;
    scroller.setAttribute('role', 'region'); scroller.setAttribute('aria-label', 'Custos por tipo de despesa e produto');
    const table = make('table', 'gantt-cost-table'), head = make('thead'), titles = make('tr');
    const caption = make('caption', '', 'Custo por tipo de despesa'); table.append(caption);
    for (const label of ['Tipo de despesa / produto', 'Pago', 'Previsto', '% da etapa', 'Total geral']) {
      const th = make('th', '', label); th.scope = 'col'; titles.append(th);
    }
    head.append(titles); const body = make('tbody'); table.append(head, body);
    for (const branch of detail.report.expenseBranches) for (const group of branch.expenseTypes) {
      const row = make('tr'), cell = make('th'), toggle = make('button', 'gantt-cost-toggle', '+');
      cell.scope = 'row'; toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', `Detalhar produtos: ${group.name}`);
      let rows = [];
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        if (expanded) { rows.forEach(node => node.remove()); rows = []; }
        else {
          rows = group.products.map(product => {
            const child = make('tr', 'gantt-cost-product'), label = make('th', '', product.name); label.scope = 'row';
            child.append(label); amounts(child, product); return child;
          });
          row.after(...rows);
        }
        toggle.textContent = expanded ? '+' : '−'; toggle.setAttribute('aria-expanded', String(!expanded));
        toggle.setAttribute('aria-label', `${expanded ? 'Detalhar' : 'Recolher'} produtos: ${group.name}`);
      });
      cell.append(toggle, make('span', '', group.name)); row.append(cell); amounts(row, group); body.append(row);
    }
    const total = make('tr', 'gantt-cost-total'), label = make('th', '', 'TOTAL DA ETAPA'); label.scope = 'row';
    total.append(label); amounts(total, { ...detail.report.summary, percentage: 100 }, true); body.append(total);
    scroller.append(table); results.append(scroller);
  }
  render();
}
