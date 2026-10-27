const MASCOT_URLS = [
  new URL("../assets/mascot-loading-wave.webp", import.meta.url).href,
  new URL("../assets/mascot-loading-clipboard.webp", import.meta.url).href,
  new URL("../assets/mascot-loading-thumbs-up.webp", import.meta.url).href,
];
const DEFAULT_PROGRESS_LABEL = 'Progresso do carregamento';
const UNKNOWN_PROGRESS_TEXT = 'Progresso não informado';

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function loadingVariant(label) {
  return [...String(label)].reduce((sum, character) => sum + character.codePointAt(0), 0) % 3;
}

function progressValue(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? Math.floor(value) : null;
}

function spinnerMarkup(progress, progressLabel) {
  const spinner = '<span class="app-loading__spinner" aria-hidden="true"></span>';
  const percent = progressValue(progress);
  const valueAttribute = percent === null ? `aria-valuetext="${UNKNOWN_PROGRESS_TEXT}"` : `aria-valuenow="${percent}"`;
  return `<span class="app-loading__progress-row">${spinner}<span class="app-loading__percentage" role="progressbar" aria-label="${escapeHtml(progressLabel)}" aria-valuemin="0" aria-valuemax="100" ${valueAttribute}>${percent === null ? '—' : percent}%</span></span>`;
}

export function loadingIndicatorMarkup(label, { compact = false, progress = 0, progressLabel = DEFAULT_PROGRESS_LABEL } = {}) {
  const variant = loadingVariant(label);
  return `<span class="app-loading${compact ? " app-loading--compact" : ""}" data-loading-variant="${variant}" role="status" aria-live="polite"><img class="app-loading__mascot" src="${MASCOT_URLS[variant]}" alt="" aria-hidden="true" draggable="false">${spinnerMarkup(progress, progressLabel)}<span class="app-loading__text">${escapeHtml(label)}</span></span>`;
}

export function updateLoadingIndicator(root, { label, progress, progressLabel = DEFAULT_PROGRESS_LABEL } = {}) {
  if (label !== undefined) root.querySelector('.app-loading__text').textContent = String(label);
  if (progress === undefined) return;
  const doc = root.ownerDocument;
  let row = root.querySelector('.app-loading__progress-row');
  if (!row) {
    row = doc.createElement('span'); row.className = 'app-loading__progress-row';
    const spinner = root.querySelector('.app-loading__spinner');
    spinner.before(row); row.append(spinner);
    const badge = doc.createElement('span'); badge.className = 'app-loading__percentage';
    badge.setAttribute('role', 'progressbar'); badge.setAttribute('aria-valuemin', '0'); badge.setAttribute('aria-valuemax', '100');
    row.append(badge);
  }
  const badge = row.querySelector('[role="progressbar"]'), percent = progressValue(progress);
  badge.setAttribute('aria-label', progressLabel);
  badge.textContent = percent === null ? '—%' : `${percent}%`;
  if (percent === null) { badge.removeAttribute('aria-valuenow'); badge.setAttribute('aria-valuetext', UNKNOWN_PROGRESS_TEXT); }
  else { badge.setAttribute('aria-valuenow', String(percent)); badge.removeAttribute('aria-valuetext'); }
}

export function createLoadingIndicator(documentRef, label, { compact = false, progress = 0, progressLabel } = {}) {
  const root = documentRef.createElement("span");
  root.className = `app-loading${compact ? " app-loading--compact" : ""}`;
  root.dataset.loadingVariant = String(loadingVariant(label));
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  const mascot = documentRef.createElement("img");
  mascot.className = "app-loading__mascot";
  mascot.src = MASCOT_URLS[loadingVariant(label)];
  mascot.alt = "";
  mascot.draggable = false;
  mascot.setAttribute("aria-hidden", "true");
  const spinner = documentRef.createElement("span");
  spinner.className = "app-loading__spinner";
  spinner.setAttribute("aria-hidden", "true");
  const text = documentRef.createElement("span");
  text.className = "app-loading__text";
  text.textContent = String(label ?? "");
  root.append(mascot, spinner, text);
  updateLoadingIndicator(root, { progress, progressLabel });
  return root;
}
