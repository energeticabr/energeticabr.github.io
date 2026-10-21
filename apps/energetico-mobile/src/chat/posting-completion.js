// Read-only projection of the worker's confirmed-write notice. This does not
// submit data or prove a write; unrecognized/partial notices keep their text.
function incompletePostingNotice(line, attachmentCompletion = false) {
  const normalized = line.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const clauses = normalized.split(/;\s*|[.!?](?:\s+|$)|,\s+|\s+(?:e|mas|porem)\s+/i);
  let subject = '';
  for (const clause of clauses) {
    const notice = clause.replace(/^[^\p{L}\d]+/u, '')
      .replace(/^(?:AVISO|ATENCAO)\s*:\s*/i, '').replace(/^[^\p{L}\d]+/u, '');
    if (attachmentCompletion) {
      // A named file is metadata, not a posting status. Later clauses (after
      // a comma, semicolon, etc.) still undergo the conservative status check.
      if (/^(?:(?:O|OS|A|AS|UM|UMA|UNS|UMAS)\s+)?(?:ANEXOS?|ARQUIVOS?|COMPROVANTES?|DOCUMENTOS?)\s*:\s*.+\.[a-z\d]{1,10}$/i.test(notice)) continue;
      if (/\b(?:NAO|PENDENTES?|INCOMPLET[OA]S?|PARCIAL(?:MENTE)?)\b|\b(?:APENAS|SO(?:MENTE)?)\s+PARTE\b/i.test(notice)) return true;
      continue;
    }
    if (/^(?:ANEXOS?|ARQUIVOS?|COMPROVANTES?|DOCUMENTOS?)\b/i.test(notice)) {
      subject = 'attachment';
      continue;
    }
    if (/\b(?:PROVISAO|PROVISOES|DESCRITIVOS?(?: DE)? PROVISAO|DESCRITIVOPROVISAO|PEDIDOS?|LANCAMENTOS?|REGISTROS?|BAIXA|PAGAMENTO)\b/i.test(notice)) subject = 'record';
    // A supplementary attachment clause must not exempt a later financial
    // clause. Retain the subject for continuations such as ", não confirmado".
    if (/CONFIRMACAO (?:PARCIAL|INCOMPLETA)/i.test(notice)
      || (subject === 'record' && /NAO (?:CONFIRMAD[OA]S?|BAIXAD[OA]S?)|\b(?:PENDENTES?|INCOMPLET[OA]S?|PARCIAL)\b/i.test(notice))) return true;
  }
  return false;
}

export function postingCompletion(message) {
  if (message?.role === 'user' || (message?.type && message.type !== 'text')
    || message?.presence_confirmation || message?.presenceConfirmation
    || message?.payment_audit_table || message?.paymentAuditTable
    || message?.detail_table || message?.detailTable || message?.presenceDateSummary) return null;
  const lines = String(message?.text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const plain = lines.map(line => line.replaceAll('*', ''));
  if (/\bNÃO\b/i.test(plain[0] || '')) return null;
  if (plain.some(line => /❌|\b(?:erros?|falhas?)\b|NÃO (?:FOI|FORAM|GRAVAD|CADASTRAD|REGISTRAD|BAIXAD)/i.test(line))) return null;
  const attendanceBatch = plain.length === 3 && plain[0].match(/^✅\s+(\d+ (?:CADASTROS ALTERADOS|PRESENÇAS ATUALIZADAS) COM SUCESSO)\.$/i);
  if (attendanceBatch && /^(?:🆔\s*)?REGISTROS CONFIRMADOS:$/i.test(plain[1])
    && /^•\s*PRESENÇAS:\s*IDS? [1-9]\d*(?:,\s*[1-9]\d*)*$/i.test(plain[2])) {
    return Object.freeze({ title: attendanceBatch[1], kind: 'attendance-batch', records: Object.freeze([]), notes: Object.freeze([]) });
  }
  const heading = plain[0]?.match(/^(?:✅\s*)?(?:🟢\s*)?([\p{L}\d][\p{L}\d /()&.,-]* (?:GRAVAD[OA]S?|CRIAD[OA]S?|CADASTRAD[OA]S?|REGISTRAD[OA]S?|ATUALIZAD[OA]S?|VINCULAD[OA]S?|ELIMINAD[OA]S?|ADICIONAD[OA]S?|PREENCHID[OA]S?|BAIXADO)) NA BASE DE DADOS ([\p{L}\d][\p{L}\d /()&.,_-]*) ÀS ((?:[01]\d|2[0-3]):[0-5]\d)\.?\s*(?:🕒)?$/iu);
  if (!heading || !/^(?:🆔\s*)?REGISTROS CONFIRMADOS:$/i.test(plain[1] || '')) return null;
  const descriptionSettlement = /^PAGAMENTO AGENDADO BAIXADO$/i.test(heading[1]) && /^DESCRITIVOPROVIS[AÃ]O$/i.test(heading[2]);
  const settlement = descriptionSettlement || (/^PAGAMENTO AGENDADO BAIXADO$/i.test(heading[1]) && /^PROVIS[AÃ]O PGTOS$/i.test(heading[2]));
  const orderAttachments = /^ANEXOS DO PEDIDO ADICIONADOS$/i.test(heading[1]) && /^NOTASPENDENTES$/i.test(heading[2]);
  const provisionAttachments = /^ANEXOS DA PROVIS[AÃ]O ADICIONADOS$/i.test(heading[1]) && /^PROVIS[AÃ]O PGTOS$/i.test(heading[2]);
  const attachmentCompletion = orderAttachments || provisionAttachments;
  const diary = /^DIÁRIO DE OBRA PREENCHIDO$/i.test(heading[1]) && /^DIÁRIO DE OBRAS$/i.test(heading[2]);
  if (/ PREENCHID[OA]S?$/i.test(heading[1]) && !diary) return null;
  if (/ BAIXADO$/i.test(heading[1]) && !settlement) return null;
  if (/ ADICIONAD[OA]S?$/i.test(heading[1]) && !attachmentCompletion) return null;
  const records = [];
  const notes = [];
  let identifiers = 0;
  for (let i = 2; i < plain.length; i++) {
    const line = plain[i];
    if ((settlement || attachmentCompletion) && incompletePostingNotice(line, attachmentCompletion)) return null;
    if (/^(?:•\s*)?(?:⚠|🚨|❗|❕|AVISO\b|ATENÇÃO\b|ATENCAO\b)/i.test(line)) {
      if (attachmentCompletion) return null; // Keep uncertain attachment results in full, without a green success claim.
      notes.push(lines[i]);
      continue;
    }
    const identifier = line.match(/^•\s*([^:<>]+):\s*(IDS? [1-9]\d*(?:,\s*[1-9]\d*)*)$/i);
    const amount = line.match(/^💰\s*([^:<>]+):\s*(R\$\s*(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2})$/i);
    if (identifier) {
      identifiers++;
      const label = identifier[1].trim();
      const icon = /^PEDIDOS?$/i.test(label) ? 'order' : 'launch';
      if (descriptionSettlement || attachmentCompletion) {
        const singular = /^DESCRITIVOS? DE PROVIS[AÃ]O$/i.test(label) ? 'DESCRITIVO DE PROVISÃO'
          : /^PROVIS(?:[AÃ]O|[OÕ]ES) DE PAGAMENTO$/i.test(label) ? 'PROVISÃO DE PAGAMENTO'
            : /^PEDIDOS?$/i.test(label) ? 'PEDIDO'
              : /^LAN[ÇC]AMENTOS?$/i.test(label) ? 'LANÇAMENTO' : label;
        for (const id of identifier[2].replace(/^IDS? /i, '').split(/,\s*/)) {
          records.push(Object.freeze({ label: singular, value: `ID ${id}`, icon }));
        }
      } else {
        records.push(Object.freeze({ label, value: identifier[2], icon }));
      }
    } else if (amount) {
      records.push(Object.freeze({ label: amount[1].trim(), value: amount[2], icon: 'total' }));
    } else if (/^•[^:]*:\s*IDS?\b|^💰[^:]*:\s*R\$/i.test(line)
      || ((settlement || attachmentCompletion) && /^•\s*(?:DESCRITIVOS? DE PROVIS[AÃ]O|PROVIS(?:[AÃ]O|[OÕ]ES) DE PAGAMENTO|PEDIDOS?|LAN[ÇC]AMENTOS?)\s*:/i.test(line))) {
      return null; // Do not hide a malformed identifier/amount in notes.
    } else {
      notes.push(lines[i]);
    }
  }
  if (!identifiers) return null;
  const requiredSettlementRecords = descriptionSettlement
    ? [/^DESCRITIVO DE PROVIS[AÃ]O$/i, /^PROVIS[AÃ]O DE PAGAMENTO$/i]
    : [/^PROVIS[AÃ]O DE PAGAMENTO$/i, /^PEDIDO$/i, /^LAN[ÇC]AMENTO$/i];
  if (settlement && !requiredSettlementRecords
    .every(label => records.some(record => record.icon !== 'total' && label.test(record.label)))) return null;
  if (orderAttachments && !records.some(record => record.icon === 'order' && /^PEDIDO$/i.test(record.label))) return null;
  if (provisionAttachments && !records.some(record => /^PROVIS[AÃ]O DE PAGAMENTO$/i.test(record.label))) return null;
  if (diary && (records.some(record => !/^DIÁRIO DE OBRAS$/i.test(record.label))
    || !records.some(record => /^DIÁRIO DE OBRAS$/i.test(record.label)))) return null;
  return Object.freeze({ title: heading[1], database: heading[2], time: heading[3], records: Object.freeze(records), notes: Object.freeze(notes), ...(settlement ? { kind: 'provision-settlement' } : orderAttachments ? { kind: 'order-attachments' } : provisionAttachments ? { kind: 'provision-attachments' } : diary ? { kind: 'diary' } : {}) });
}
