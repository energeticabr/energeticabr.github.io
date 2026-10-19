const PATHS = {
  supplier: 'M3 10v11h18V10M2 10l2-7h16l2 7M2 10c0 4 5 4 5 0 0 4 5 4 5 0 0 4 5 4 5 0 0 4 5 4 5 0M8 21v-7h8v7',
  order: 'M5 2h14v20H5zM8 7h8M8 11h8M8 15h5',
  calendar: 'M3 5h18v17H3zM7 2v6M17 2v6M3 10h18M7 14h1M12 14h1M17 14h1M7 18h1M12 18h1',
  price: 'M3 12 13 2h9v9L12 21 3 12ZM17 6h.01',
  quantity: 'm12 2 10 5v10l-10 5-10-5V7l10-5ZM2 7l10 5 10-5M12 12v10',
  freight: 'M2 4h13v13H2zM15 9h4l3 5v3h-7M8 17h8M8 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM22 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  calculator: 'M5 2h14v20H5zM8 5h8v4H8zM8 13h1M14 13h2M8 17h1M14 17h2',
  payment: 'M2 4h20v16H2zM2 9h20M6 15h5M16 15h2',
  money: 'M3 6c0-4 12-4 12 0s-12 4-12 0ZM3 6v10c0 4 12 4 12 0V6M3 11c0 4 12 4 12 0M15 10c9-2 10 4 3 5M15 15c9-2 10 4 3 5',
  currency: 'M12 2v20M17 6H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H6',
  branch: 'M4 22V2h13v20M1 22h21M17 12h4v10M7 6h1M12 6h1M7 10h1M12 10h1M7 14h1M12 14h1M8 22v-4h5v4',
  property: 'm3 11 9-9 9 9v11H3V11Z',
  clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 5v7h6',
};

export function launchGalleryIcon(doc, name) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) {
    svg.setAttribute(key, value);
  }
  svg.classList.add('lg-card-icon');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}
