import { createGalleryMenu } from './gallery-menu.js';

export function createRegistrationGalleryMenu(options = {}) {
  return createGalleryMenu({ ...options, title: 'GALERIA DE CADASTROS', className: 'registration-gallery-menu', choiceAttribute: 'registrationGallery',
    choices: [['group', 'GALERIA GRUPO'], ['family', 'GALERIA FAMÍLIA'], ['subfamily', 'GALERIA SUBFAMÍLIA'], ['product', 'GALERIA PRODUTO']] });
}
