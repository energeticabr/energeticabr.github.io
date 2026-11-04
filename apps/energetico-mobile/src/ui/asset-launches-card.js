const ICONS = {
  branch: ['M3 21V5l7-3 7 3v16M17 10h4v11M1 21h22', 'M7 7h.01M12 7h.01M7 11h.01M12 11h.01M7 15h.01M12 15h.01M9 21v-3h3v3'],
  percent: ['M5 20 19 4', 'M8 6a2 2 0 1 0-4 0 2 2 0 0 0 4 0M20 18a2 2 0 1 0-4 0 2 2 0 0 0 4 0'],
  calendar: ['M4 5h16v16H4z', 'M8 2v6M16 2v6M4 10h16'],
  coins: ['M3 6c0-4 12-4 12 0S3 10 3 6Z', 'M3 6v11c0 4 12 4 12 0V6M3 11c0 4 12 4 12 0M3 15c0 4 12 4 12 0', 'M15 8c8-2 8 5 1 5M16 17c7 0 7-5 7-7v7c0 2-3 3-7 3'],
  chart: ['M2 21h20M5 21v-7h3v7M11 21V9h3v12M17 21V3h3v18'],
  tag: ['m3 12 9-9h9v9l-9 9-9-9Z', 'M16 7h.01'],
  search: ['M16 10a6 6 0 1 0-12 0 6 6 0 0 0 12 0Z', 'm15 15 6 6'],
  filter: ['M2 3h20l-8 9v9l-4-2v-7L2 3Z'],
  home: ['m2 11 10-9 10 9M5 9v13h5v-8h4v8h5V9'],
};

export function assetLaunchesIcon(doc, name) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, value);
  svg.classList.add('rg-launch-icon');
  for (const d of ICONS[name]) {
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}

/** Values retain the gallery's date, currency and percentage formatting. */
export function renderAssetLaunchesCard({ document: doc, container, rowId, title, value }) {
  const el = (tag, className, text) => {
    const node = doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const heading = el('div', 'rg-document-heading rg-launch-heading');
  heading.append(el('strong', 'rg-row-title', title), el('span', 'rg-document-id', `ID ${rowId}`));
  container.append(heading);
  const pair = (parent, field, label, symbol) => {
    const node = el('div', 'rg-detail rg-launch-detail'); node.dataset.field = field;
    if (symbol) node.append(assetLaunchesIcon(doc, symbol));
    node.append(el('dt', '', label), el('dd', '', value(field) || '—'));
    parent.append(node);
  };
  const identity = el('dl', 'rg-launch-identity');
  pair(identity, 'FILIAL', 'Filial', 'branch');
  pair(identity, '% DEPRECIAÇÃO', '% Depreciação', 'percent');
  const amounts = el('dl', 'rg-launch-amounts');
  pair(amounts, 'DATA DE DEPRECIAÇÃO', 'Data de depreciação', 'calendar');
  pair(amounts, 'VALOR DEPRECIAÇÃO', 'Valor depreciação', 'coins');
  pair(amounts, 'VALOR RESIDUAL', 'Valor residual', 'chart');
  const reference = el('dl', 'rg-launch-reference');
  pair(reference, 'ID IMOBILIZADO', 'ID Imobilizado:', 'tag');
  container.append(identity, amounts, reference);
  const links = el('dl', 'rg-launch-links');
  for (const field of ['ID LANÇAMENTO', 'NÚMERO DO PEDIDO']) if (value(field)) pair(links, field, field);
  if (links.children.length) container.append(links);
}
