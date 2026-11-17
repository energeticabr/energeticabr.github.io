import { createGalleryMenu } from './gallery-menu.js';

export function createAssetGalleryMenu(options = {}) {
  return createGalleryMenu({ ...options, title: 'IMOBILIZADOS', className: 'asset-gallery-menu', choiceAttribute: 'assetGallery',
    question: 'O que você deseja acessar?',
    choices: [['asset', 'CADASTROS IMOBILIZADOS'], ['assetLaunches', 'LANÇAMENTOS IMOBILIZADOS']] });
}
