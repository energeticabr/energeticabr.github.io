export function placeGalleryQuickSearch({ input, toolbar, placeholder, container }) {
  const wrapper = input.parentElement;
  input.type = 'search';
  input.name = 'search';
  input.maxLength = 500;
  input.dataset.galleryQuickSearch = '';
  input.classList.add('gallery-quick-search');
  input.placeholder = placeholder || 'Pesquisar em todos os campos (ID, nome, descrição…)';
  input.setAttribute('aria-label', 'Pesquisar em todos os campos da galeria');
  toolbar.classList.add('gallery-quick-search-toolbar');
  if (container) container.append(input);
  toolbar.prepend(container || input);
  if (wrapper?.matches('label')) wrapper.remove();
  return input;
}
