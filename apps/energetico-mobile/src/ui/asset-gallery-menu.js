import { createGalleryMenu } from './gallery-menu.js';

export function createAssetGalleryMenu(options = {}) {
  return createGalleryMenu({ ...options, title: 'IMOBILIZADOS', className: 'asset-gallery-menu', choiceAttribute: 'assetGallery',
    choices: [['asset', 'CADASTROS IMOBILIZADOS'], ['assetLaunches', 'LANÇAMENTOS IMOBILIZADOS']] });
}
