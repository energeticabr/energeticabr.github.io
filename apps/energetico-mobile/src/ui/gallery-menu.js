import { applyScreenNavigation } from './screen-navigation.js';

export function createGalleryMenu({ document: doc = globalThis.document, title, choices, className, choiceAttribute, onSelect, onHome } = {}) {
  const element = (tag, className, text) => {
    const node = doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const root = element('section', `rg-overlay ${className}`);
  root.hidden = true; root.tabIndex = -1;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', title);
  const header = element('header', 'rg-header');
  const back = element('button', 'rg-button', 'Voltar');
  const home = onHome ? element('button', 'rg-button', 'Início') : null;
  const heading = element('h1', 'rg-title', title);
  applyScreenNavigation({ header, back, home, title: heading });
  const content = element('div', `${className}__content`);
  content.append(element('p', `${className}__question`, 'O que você deseja acessar?'));
  const status = element('p', `${className}__status`); status.setAttribute('role', 'status');
  let destroyed = false, selecting = false, revision = 0, returnFocus = null;
  const buttons = choices.map(([kind, label]) => {
    const button = element('button', `${className}__choice`, label);
    button.type = 'button'; button.dataset[choiceAttribute] = kind;
    button.addEventListener('click', async () => {
      if (destroyed || root.hidden || selecting) return;
      const current = revision; selecting = true; status.textContent = '';
      buttons.forEach(control => { control.disabled = true; });
      try {
        const result = await onSelect?.(kind);
        if (destroyed || current !== revision) return;
        if (result !== false) close();
        else status.textContent = 'Não foi possível abrir a galeria. Tente novamente.';
      } catch {
        if (!destroyed && current === revision) status.textContent = 'Não foi possível abrir a galeria. Tente novamente.';
      } finally {
        if (!destroyed && current === revision) { selecting = false; buttons.forEach(control => { control.disabled = false; }); }
      }
    });
    content.append(button); return button;
  });
  content.append(status); root.append(header, content); doc.body.append(root);
  function close() {
    if (root.hidden) return;
    root.hidden = true; revision++;
    if (returnFocus?.isConnected) returnFocus.focus(); returnFocus = null;
  }
  back.addEventListener('click', close);
  home?.addEventListener('click', () => { close(); void onHome(); });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); return; }
    if (event.key !== 'Tab' || root.hidden) return;
    const controls = [...root.querySelectorAll('button:not(:disabled)')];
    const current = controls.indexOf(doc.activeElement);
    event.preventDefault();
    controls[(current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
  });
  return {
    open({ error = '' } = {}) {
      if (destroyed) return false;
      if (!root.hidden) return true;
      returnFocus = doc.activeElement; selecting = false; revision++; status.textContent = error;
      buttons.forEach(control => { control.disabled = false; }); root.hidden = false; root.focus(); return true;
    },
    close,
    destroy() { close(); destroyed = true; revision++; root.remove(); },
  };
}
