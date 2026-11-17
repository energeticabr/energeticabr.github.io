import { createGalleryMenu } from './gallery-menu.js';

export const REGISTRATION_GALLERY_CHOICES = [
  ['group', 'GALERIA GRUPO'],
  ['family', 'GALERIA FAMÍLIA'],
  ['subfamily', 'GALERIA SUBFAMÍLIA'],
  ['product', 'GALERIA PRODUTO'],
  ['supplier', 'GALERIA FORNECEDOR'],
  ['account', 'GALERIA CONTA'],
  ['materialType', 'GALERIA TIPO DE MATERIAL'],
  ['unitOfMeasure', 'GALERIA UNIDADE DE MEDIDA'],
];

export function createRegistrationGalleryMenu(options = {}) {
  return createGalleryMenu({ ...options, title: 'GALERIA DE CADASTROS', className: 'registration-gallery-menu', choiceAttribute: 'registrationGallery',
    choices: REGISTRATION_GALLERY_CHOICES });
}
