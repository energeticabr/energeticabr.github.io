import { createTasksGallery } from '../../src/ui/tasks-gallery-view.js';
import { createOrdersGallery } from '../../src/ui/orders-gallery-view.js';
import { createLaunchGallery } from '../../src/ui/launch-gallery-view.js';
import { createRegistrationGallery } from '../../src/ui/registration-gallery-view.js';
import { createPaymentProgrammingGallery } from '../../src/ui/payment-programming-gallery-view.js';
import { createRecurringExpensesGallery } from '../../src/ui/recurring-expenses-gallery-view.js';
import { createHrPayrollGallery } from '../../src/ui/hr-payroll-gallery-view.js';

export const registrationKinds = ['group', 'family', 'subfamily', 'product', 'documents', 'asset',
  'assetFunction', 'assetProduct', 'assetGroup', 'workDiary', 'quotes', 'contracts', 'contractLines',
  'measurements', 'measurementLines', 'stageDemonstratives', 'constructionStages', 'recurringTasks', 'delegatedTasks'];
export const galleryCases = [
  { name: 'tasks', factory: createTasksGallery, root: '.tg-overlay' },
  { name: 'orders', factory: createOrdersGallery, root: '.og-orders-overlay' },
  { name: 'launch', factory: createLaunchGallery, root: '.lg-overlay' },
  { name: 'payments', factory: createPaymentProgrammingGallery, root: '.pg-overlay' },
  { name: 'recurring', factory: createRecurringExpensesGallery, root: '.re-overlay' },
  ...registrationKinds.map(kind => ({ name: kind, factory: createRegistrationGallery, options: { kind }, root: '.rg-overlay' })),
  ...['IDFOLHA', 'FOLHAPGTO'].map(gallery => ({ name: gallery, factory: createHrPayrollGallery, options: { gallery }, root: '.hr-gallery-overlay' })),
];

// UI fixtures only: no service, network, or record creation is used.
export function galleryOptions(entry, document, { snapshot, ...overrides } = {}) {
  const result = { rows: [], count: 0, page: 1, pages: 1, pageSize: 25, hasMore: false,
    nextCursor: null, fields: [], totals: {}, filterOptions: {}, ...snapshot };
  return { document, ...entry.options,
    data: { loadSnapshot: async () => result },
    request: async () => ({ ...result, gallery: entry.options?.gallery }),
    ...overrides };
}
