import { DDA_UNLINKED_REVIEW_FIELD } from './dda-bank-status.js';
import { DDA_PROVISION_FIELD } from './dda-provision-link.js';
import { canReviewDdaUnlinked, normalizeDdaReportRows } from './dda-report-model.js';

const fields = ['ID', 'CHAVE_DDA', 'VENCIMENTO', 'SITUACAO', 'PGTO_CONFIRMADO', 'PGTO_CONFIRMADO_EM',
  'PGTO_CONFIRMADO_POR', 'DDA_CICLO_AGENDAMENTO', 'STATUS_DDA', 'STATUS_CONSULTADO_EM', 'ULTIMA_CONSULTA',
  DDA_PROVISION_FIELD, DDA_UNLINKED_REVIEW_FIELD];

export function createDdaUnlinkedReview({ repository, siteKey = 'personal', assertSession = () => {} }) {
  const checkSession = signal => { signal?.throwIfAborted(); assertSession(); };
  async function save({ row, reviewed, signal } = {}) {
    if (!row || !/^[1-9]\d*$/.test(row.id) || !Number.isSafeInteger(Number(row.id)) ||
        !canReviewDdaUnlinked(row) || typeof reviewed !== 'boolean' || reviewed === row.linkReviewed) {
      throw new Error('A vinculação deste DDA não pode ser regularizada.');
    }
    checkSession(signal);
    const list = await repository.resolveList(siteKey, ['DDAS SICOOB'], { signal });
    checkSession(signal);
    if (list?.status !== 'resolved' || !list.id) throw new Error('Lista de DDAs indisponível.');
    const item = await repository.getItem(siteKey, list.id, row.id, '', {
      signal, restrictedFields: fields, includeVersion: true,
    });
    checkSession(signal);
    const current = normalizeDdaReportRows({ rows: [item] })[0];
    const rawReview = item.fields[DDA_UNLINKED_REVIEW_FIELD];
    if (current.id !== row.id || current.key !== row.key || current.due !== row.due ||
        !canReviewDdaUnlinked(current) || current.linkReviewed !== row.linkReviewed ||
        (rawReview != null && typeof rawReview !== 'boolean') || !item.eTag || item.eTag === '*') {
      throw new Error('O DDA mudou no SharePoint. Atualize o relatório antes de tentar novamente.');
    }
    const saved = await repository.updateItem(siteKey, list.id, row.id, { [DDA_UNLINKED_REVIEW_FIELD]: reviewed },
      { eTag: item.eTag, signal, readbackFields: fields });
    checkSession(signal);
    if (String(saved?.id) !== row.id || String(saved?.fields?.CHAVE_DDA ?? '').trim() !== row.key ||
        saved?.fields?.[DDA_UNLINKED_REVIEW_FIELD] !== reviewed) {
      throw new Error('Não foi possível confirmar a alteração. Atualize o relatório e confira a vinculação.');
    }
    return { id: row.id, reviewed };
  }
  return Object.freeze({ save });
}
