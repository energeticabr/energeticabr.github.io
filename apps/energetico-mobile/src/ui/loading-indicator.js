const MASCOT_URLS = [
  new URL("../assets/mascot-loading-wave.webp", import.meta.url).href,
  new URL("../assets/mascot-loading-clipboard.webp", import.meta.url).href,
  new URL("../assets/mascot-loading-thumbs-up.webp", import.meta.url).href,
];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function loadingVariant(label) {
  return [...String(label)].reduce((sum, character) => sum + character.codePointAt(0), 0) % 3;
}

export function loadingIndicatorMarkup(label, { compact = false } = {}) {
  const variant = loadingVariant(label);
  return `<span class="app-loading${compact ? " app-loading--compact" : ""}" data-loading-variant="${variant}" role="status" aria-live="polite"><img class="app-loading__mascot" src="${MASCOT_URLS[variant]}" alt="" aria-hidden="true" draggable="false"><span class="app-loading__spinner" aria-hidden="true"></span><span class="app-loading__text">${escapeHtml(label)}</span></span>`;
}

export function createLoadingIndicator(documentRef, label, { compact = false } = {}) {
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
  return root;
}
