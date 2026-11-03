import Decimal from 'decimal.js';
import { registrationNumber } from '../chat/registration-gallery-data.js';

const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));

function branchText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(branchText).filter(Boolean).join(', ');
  if (typeof value === 'object') return branchText(value.LookupValue ?? value.Value ?? value.value ?? value.DisplayName ?? value.displayName ?? value.Title ?? value.title);
  return String(value).trim().replace(/\s+/g, ' ');
}

export function depreciationByBranch(history) {
  const groups = new Map();
  for (const row of history) {
    const value = registrationNumber(row?.fields?.['VALOR DEPRECIAÇÃO']);
    if (value == null) throw new Error('Valor de depreciação inválido no histórico.');
    const name = branchText(row?.fields?.FILIAL), key = name ? 'name:' + name.toLocaleUpperCase('pt-BR') : 'missing:';
    if (!groups.has(key)) groups.set(key, { name: name || 'Filial não informada', amount: new Decimal(0), missing: !name });
    groups.get(key).amount = groups.get(key).amount.plus(value);
  }
  const entries = [...groups.values()].sort((a, b) => Number(a.missing) - Number(b.missing) || a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
  const total = entries.reduce((sum, group) => sum.plus(group.amount), new Decimal(0));
  return { entries, total };
}

export function createDepreciationBranchChart({ document: doc, history }) {
  const el = (tag, className = '', label) => {
    const node = doc.createElement(tag); node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  };
  const section = el('section', 'depreciation-branches'); section.dataset.depreciationBranches = '';
  section.append(el('h3', '', 'Depreciação por filial'));
  section.append(el('p', 'depreciation-branches-intro', 'Valores depreciados em todo o histórico deste imobilizado.'));
  if (!history.length) {
    section.append(el('p', 'depreciation-branches-empty', 'Nenhuma depreciação registrada para apresentar por filial.'));
    return section;
  }
  let entries, total;
  try { ({ entries, total } = depreciationByBranch(history)); }
  catch { section.append(el('p', 'depreciation-branches-empty', 'Não foi possível calcular os valores por filial.')); return section; }
  const items = [...entries, { name: 'Total', amount: total, total: true }];
  const amounts = items.map(item => item.amount.toNumber());
  const maximum = Math.max(0, ...amounts), minimum = Math.min(0, ...amounts);
  const upper = maximum === minimum ? 1 : maximum, lower = minimum;
  const span = upper - lower, zero = upper / span * 100;
  section.append(el('p', 'depreciation-branches-axis-title', 'Valor depreciado (R$)'));
  const layout = el('div', 'depreciation-branches-layout');
  const axis = el('div', 'depreciation-branches-axis'); axis.setAttribute('aria-hidden', 'true');
  const top = el('span', '', money(upper)); top.style.top = '0%'; axis.append(top);
  if (zero > 0) { const base = el('span', '', money(0)); base.style.top = zero + '%'; axis.append(base); }
  if (lower < 0) { const bottom = el('span', '', money(lower)); bottom.style.top = '100%'; axis.append(bottom); }
  const scroller = el('div', 'depreciation-branches-scroll'); scroller.tabIndex = 0;
  scroller.setAttribute('role', 'region'); scroller.setAttribute('aria-label', 'Barras de depreciação por filial; role para ver todas as filiais');
  const columns = el('div', 'depreciation-branches-columns'); columns.setAttribute('role', 'list');
  for (const item of items) {
    const value = item.amount.toNumber();
    const column = el('div', 'depreciation-branch-bar' + (item.total ? ' depreciation-branch-bar--total' : ''));
    column.dataset.branchBar = ''; column.dataset.branch = item.name; column.dataset.amount = item.amount.toString();
    column.setAttribute('role', 'listitem');
    column.append(el('div', 'depreciation-branch-value', money(item.amount)));
    const track = el('div', 'depreciation-branch-track'); track.setAttribute('aria-hidden', 'true');
    const line = el('span', 'depreciation-branch-zero'); line.style.top = zero + '%'; track.append(line);
    const bar = el('span', 'depreciation-branch-fill');
    if (value < 0) bar.dataset.barNegative = '';
    bar.style.top = (value >= 0 ? (upper - value) / span * 100 : zero) + '%';
    bar.style.height = Math.abs(value) / span * 100 + '%';
    track.append(bar); column.append(track, el('div', 'depreciation-branch-name', item.name));
    columns.append(column);
  }
  scroller.append(columns); layout.append(axis, scroller); section.append(layout);
  section.append(el('p', 'depreciation-branches-x', 'Filial'));
  if (items.length > 2) section.append(el('p', 'depreciation-branches-hint', 'Deslize para o lado para ver todas as barras.'));
  return section;
}
