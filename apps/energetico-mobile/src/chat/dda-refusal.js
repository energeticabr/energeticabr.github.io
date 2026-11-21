import { DDA_REFUSED_FIELD } from './dda-bank-status.js';

const fields = ['ID', 'CHAVE_DDA', DDA_REFUSED_FIELD];

export function createDdaRefusal({ repository, siteKey = 'personal', assertSession = () => {} }) {
  const checkSession = signal => { signal?.throwIfAborted(); assertSession(); };

  return async function rejectDda({ row, signal } = {}) {
    const { id, key } = row ?? {};
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || !key) {
      throw new Error('O boleto não pôde ser identificado.');
    }
    checkSession(signal);
    const list = await repository.resolveList(siteKey, ['DDAS SICOOB'], { signal });
    checkSession(signal);
    if (list?.status !== 'resolved' || !list.id) throw new Error('Lista de DDAs indisponível.');
    const checkIdentity = item => {
      if (String(item?.id) !== id || String(item?.fields?.CHAVE_DDA ?? '').trim() !== key) {
        throw new Error('O DDA mudou no SharePoint. Atualize o relatório antes de tentar novamente.');
      }
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await repository.getItem(siteKey, list.id, id, '', {
        signal, restrictedFields: fields, includeVersion: true,
      });
      checkSession(signal);
      checkIdentity(current);
      if (current.fields[DDA_REFUSED_FIELD] === true) return { id };
      if (!current.eTag || current.eTag === '*') throw new Error('Versão do boleto indisponível.');

      try {
        const saved = await repository.updateItem(siteKey, list.id, id, { [DDA_REFUSED_FIELD]: true }, {
          signal, eTag: current.eTag, readbackFields: fields,
        });
        checkSession(signal);
        checkIdentity(saved);
        if (saved.fields[DDA_REFUSED_FIELD] !== true) throw new Error('Recusa sem confirmação.');
        return { id };
      } catch (error) {
        if (attempt || (Number(error?.status) !== 412 && error?.code !== 'concurrent_change')) throw error;
      }
    }
  };
}
