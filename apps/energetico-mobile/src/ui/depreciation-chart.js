import { registrationDateKey, registrationNumber, registrationFieldKey } from '../chat/registration-gallery-data.js';
import { createDepreciationBranchChart } from './depreciation-branch-chart.js';

const currency = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const dateText = value => value.split('-').reverse().join('/');

// Each plotted value is taken from an actual record; the purchase is shown only
// when both its date and amount are known and precede the recorded history.
export function depreciationPoints(result) {
  const rows = result.history.map(row => ({
    date: registrationDateKey(row.fields['DATA DE DEPRECIAÇÃO']),
    value: registrationNumber(row.fields['VALOR RESIDUAL']),
    depreciated: registrationNumber(row.fields['VALOR DEPRECIAÇÃO']),
    id: String(row.id), label: 'Depreciação',
  })).filter(point => point.date && point.value != null)
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.id) - Number(b.id));
  if (!rows.length) return rows;
  const fields = new Map(result.asset.details.map(field => [registrationFieldKey(field.label), field.value]));
  const date = registrationDateKey(fields.get(registrationFieldKey('Data compra')));
  const value = registrationNumber(fields.get(registrationFieldKey('Valor compra')));
  if (date && value != null && date <= rows[0].date) rows.unshift({ date, value, label: 'Compra' });
  return rows;
}

export function createDepreciationChart({ document: doc, result, onClose }) {
  let resizeObserver = null, frame = null, resizeHandler = null;
  const el = (tag, className = '', content) => {
    const node = doc.createElement(tag); node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };
  const overlay = el('div', 'depreciation-chart-overlay');
  const dialog = el('section', 'depreciation-chart-dialog'); dialog.dataset.depreciationChart = '';
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Histórico de depreciação: valor ao longo do tempo');
  const header = el('header', 'depreciation-chart-header');
  const title = el('h2', '', 'Evolução do valor residual');
  const close = el('button', 'depreciation-chart-close', 'Fechar'); close.type = 'button';
  close.addEventListener('click', onClose); header.append(title, close); dialog.append(header);
  const body = el('div', 'depreciation-chart-body');
  const points = depreciationPoints(result);
  if (!points.length) {
    body.append(el('p', 'depreciation-chart-empty', 'Nenhuma depreciação registrada para este imobilizado.'));
    body.append(createDepreciationBranchChart({ document: doc, history: result.history }));
  } else {
    body.append(el('p', 'depreciation-chart-intro', 'Valor residual ao longo do tempo, conforme os registros de depreciação.'));
    const ns = 'http://www.w3.org/2000/svg';
    const svgEl = (tag, attrs = {}) => {
      const node = doc.createElementNS(ns, tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
      return node;
    };
    const svg = svgEl('svg', { viewBox: '0 0 600 220', preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Gráfico de valor residual por data. Os valores exatos estão na lista abaixo.' });
    const width = 580, height = 180, left = 10, top = 20;
    const times = points.map(p => Date.parse(p.date + 'T00:00:00Z'));
    const first = Math.min(...times), last = Math.max(...times);
    const min = Math.min(0, ...points.map(p => p.value)), max = Math.max(0, ...points.map(p => p.value));
    const x = time => left + (last === first ? width / 2 : (time - first) / (last - first) * width);
    const y = value => top + (max === min ? height / 2 : (max - value) / (max - min) * height);
    for (let i = 0; i <= 4; i++) {
      const yPos = top + height * i / 4;
      svg.append(svgEl('line', { x1: left, y1: yPos, x2: left + width, y2: yPos, class: 'depreciation-chart-grid' }));
    }
    svg.append(svgEl('polyline', { points: points.map((p, i) => x(times[i]) + ',' + y(p.value)).join(' '), class: 'depreciation-chart-line' }));
    const selected = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
    const connectors = selected.map(() => {
      const line = svgEl('line', { class: 'depreciation-chart-leader' }); svg.append(line); return line;
    });
    points.forEach((point, i) => {
      const circle = svgEl('circle', { cx: x(times[i]), cy: y(point.value), r: 4, class: 'depreciation-chart-dot' });
      const tooltip = svgEl('title'); tooltip.textContent = dateText(point.date) + ': ' + currency(point.value); circle.append(tooltip); svg.append(circle);
    });
    body.append(el('p', 'depreciation-chart-axis-title', 'Valor residual (R$)'));
    const plot = el('div', 'depreciation-chart-plot');
    const scale = el('div', 'depreciation-chart-scale');
    scale.append(el('span', '', currency(max)), el('span', '', currency(min)));
    const area = el('div', 'depreciation-chart-plot-area');
    area.append(svg);
    const labels = selected.map(index => {
      const point = points[index], label = el('span', 'depreciation-chart-point-label', currency(point.value));
      label.dataset.chartLabel = ''; label.dataset.date = point.date; label.dataset.value = String(point.value);
      label.setAttribute('aria-hidden', 'true'); area.append(label); return label;
    });
    const layoutLabels = () => {
      const areaWidth = area.clientWidth, areaHeight = area.clientHeight;
      if (!areaWidth || !areaHeight) return;
      const occupied = [];
      // Place the last point first, so it always gets the clearest position.
      const order = selected.length === 3 ? [2, 0, 1] : selected.map((_, i) => i).reverse();
      for (const i of order) {
        const label = labels[i], point = points[selected[i]], pointX = x(times[selected[i]]) / 600 * areaWidth;
        const pointY = y(point.value) / 220 * areaHeight;
        const w = label.offsetWidth, h = label.offsetHeight;
        const left = Math.max(0, Math.min(areaWidth - w, pointX - w / 2));
        const candidates = [pointY - h - 6, pointY + 6];
        for (let top = 0; top <= areaHeight - h; top += 8) candidates.push(top);
        candidates.sort((a, b) => Math.abs(a - (pointY - h - 6)) - Math.abs(b - (pointY - h - 6)));
        const safe = candidates.map(top => Math.max(0, Math.min(areaHeight - h, top)));
        const top = safe.find(top => occupied.every(box => left + w + 3 <= box.left || box.left + box.width + 3 <= left || top + h + 3 <= box.top || box.top + box.height + 3 <= top)) ?? safe[0];
        label.style.left = `${left}px`; label.style.top = `${top}px`; label.dataset.positioned = 'true';
        occupied.push({ left, top, width: w, height: h });
        const line = connectors[i];
        line.setAttribute('x1', x(times[selected[i]])); line.setAttribute('y1', y(point.value));
        line.setAttribute('x2', (left + w / 2) / areaWidth * 600); line.setAttribute('y2', (top + h / 2) / areaHeight * 220);
      }
    };
    const view = doc.defaultView;
    resizeHandler = layoutLabels; view?.addEventListener('resize', resizeHandler);
    if (typeof view?.ResizeObserver === 'function') { resizeObserver = new view.ResizeObserver(layoutLabels); resizeObserver.observe(area); }
    if (typeof view?.requestAnimationFrame === 'function') frame = view.requestAnimationFrame(layoutLabels);
    plot.append(scale, area); body.append(plot);
    const dates = el('div', 'depreciation-chart-dates');
    dates.append(el('span', '', dateText(points[0].date)));
    if (first !== last) dates.append(el('span', '', dateText(points.at(-1).date)));
    body.append(dates, el('p', 'depreciation-chart-time', 'Tempo'));
    body.append(createDepreciationBranchChart({ document: doc, history: result.history }));
    body.append(el('h3', '', 'Valores registrados'));
    const list = el('ol', 'depreciation-chart-list');
    for (const point of points) {
      const amounts = point.label === 'Compra' ? currency(point.value)
        : 'Depreciado: ' + (point.depreciated == null ? '—' : currency(point.depreciated)) + ' · Residual: ' + currency(point.value);
      const item = el('li', '', dateText(point.date) + ' · ' + point.label + ' · ' + amounts);
      item.dataset.chartPoint = ''; item.dataset.date = point.date; item.dataset.value = String(point.value);
      list.append(item);
    }
    body.append(list);
  }
  dialog.append(body); overlay.append(dialog);
  overlay.addEventListener('click', event => { event.stopPropagation(); if (event.target === overlay) onClose(); });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    else if (event.key === 'Tab') {
      event.stopPropagation();
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), [tabindex="0"]')];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (doc.activeElement === last || !dialog.contains(doc.activeElement))) { event.preventDefault(); first?.focus(); }
    }
  });
  return { overlay, closeButton: close, destroy() { resizeObserver?.disconnect(); if (frame != null) doc.defaultView?.cancelAnimationFrame?.(frame); if (resizeHandler) doc.defaultView?.removeEventListener('resize', resizeHandler); } };
}
