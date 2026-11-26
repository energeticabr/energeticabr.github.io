import { DDA_PRIORITY_FIELD } from './dda-bank-status.js';
import { registrationDateKey } from './registration-gallery-data.js';

const fields = ['ID', 'CHAVE_DDA', DDA_PRIORITY_FIELD];
const priorityOf = item => registrationDateKey(item.fields[DDA_PRIORITY_FIELD]);

export function createDdaPriority({ repository, siteKey = 'personal', assertSession = () => {} }) {
  const checkSession = signal => { signal?.throwIfAborted(); assertSession(); };

  return async function prioritizeDda({ row, priorityDate, signal } = {}) {
    const { id, key } = row ?? {};
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || !key) {
      throw new Error('O boleto não pôde ser identificado.');
    }
    if (!priorityDate || registrationDateKey(priorityDate) !== priorityDate) {
      throw new Error('Informe uma data de priorização válida.');
    }
    checkSession(signal);
    const list = await repository.resolveList(siteKey, ['DDAS SICOOB'], { signal });
    checkSession(signal);
    if (list?.status !== 'resolved' || !list.id) throw new Error('Lista de DDAs indisponível.');

    function checkIdentity(item) {
      if (String(item?.id) !== id || String(item?.fields?.CHAVE_DDA ?? '').trim() !== key) {
        throw new Error('O DDA mudou no SharePoint. Atualize o relatório antes de tentar novamente.');
      }
    }

    const current = await repository.getItem(siteKey, list.id, id, '', {
      signal, restrictedFields: fields, includeVersion: true,
    });
    checkSession(signal);
    checkIdentity(current);
    const currentDate = priorityOf(current);
    const receipt = { id, priorityDate };
    if (currentDate === priorityDate) return receipt;
    if (currentDate !== (row.priorityDate || '') || !current.eTag || current.eTag === '*') {
      throw new Error('O DDA mudou no SharePoint. Atualize o relatório antes de tentar novamente.');
    }

    const saved = await repository.updateItem(siteKey, list.id, id, {
      [DDA_PRIORITY_FIELD]: `${priorityDate}T12:00:00Z`,
    }, { signal, eTag: current.eTag, readbackFields: fields });
    checkSession(signal);
    checkIdentity(saved);
    if (priorityOf(saved) !== priorityDate) throw new Error('Data de priorização sem confirmação.');
    return receipt;
  };
}
