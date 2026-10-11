// Shared vector artwork for the PDF card and its movable preview.
export const signatureCardIcons = Object.freeze({
  person: 'M12 2 A4 4 0 1 0 12 10 A4 4 0 1 0 12 2 M3 22 L3 18 C3 11 21 11 21 18 L21 22 Z',
  calendar: 'M3 5 L21 5 L21 22 L3 22 Z M3 10 L21 10 M7 2 L7 7 M17 2 L17 7 M7 14 L9 14 M15 14 L17 14 M7 18 L9 18 M15 18 L17 18',
  document: 'M5 2 L14 2 L20 8 L20 22 L5 22 Z M14 2 L14 8 L20 8 M8 12 L17 12 M8 16 L17 16',
  shield: 'M12 2 L21 6 L20 14 Q18 20 12 23 Q6 20 4 14 L3 6 Z M7 12 L11 16 L17 9',
});

export function appendSignatureCardIcon(documentRef, row, kind) {
  const svg = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-signature-icon', kind);
  const path = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', signatureCardIcons[kind]);
  path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8'); path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round'); svg.append(path); row.prepend(svg);
}
