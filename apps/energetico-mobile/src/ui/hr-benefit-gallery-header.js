import { applyScreenNavigation } from './screen-navigation.js';
import { attachGalleryRefreshButton } from './gallery-refresh.js';

export function createHrBenefitGalleryHeader({ root, title, onBack, onHome, onRefresh, refreshLabel }) {
  const document = root.ownerDocument;
  const header = document.createElement('header');
  header.className = 'hr-gallery-header';
  title.classList.add('hr-gallery-title');

  const back = document.createElement('button');
  back.className = 'hr-gallery-button';
  back.setAttribute('aria-label', 'Voltar ao RH');
  back.addEventListener('click', onBack);
  const home = onHome ? document.createElement('button') : null;
  if (home) {
    home.className = 'hr-gallery-button';
    home.addEventListener('click', onHome);
  }
  applyScreenNavigation({ header, back, home, title });

  const refresh = attachGalleryRefreshButton({ document, root, header, onRefresh });
  if (refreshLabel) {
    refresh.button.setAttribute('aria-label', refreshLabel);
    refresh.button.title = refreshLabel;
  }
  return { header, dispose: refresh.destroy };
}
