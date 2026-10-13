export function attendanceBadgePoll(presentation = "attendance_multi_select") {
  const supplierSync = presentation === "attendance_supplier_sync";
  const prefix = supplierSync
    ? "choice:sincronizar_atividade_fornecedor_presenca:supplier_sync_target:"
    : "pending_attendance_record:";
  const rows = [
    ["2101", "JOSÉ GERALDO DOS SANTOS", "present", "08h45", "RHID em 13/10/2026: presente, 8 horas e 45 minutos.", 525],
    ["2102", "CARLOS EDUARDO DA SILVA", "absent", "AUSENTE", "RHID em 13/10/2026: sem batidas no dia."],
    ["2103", "MARIA APARECIDA DOS SANTOS", "inconsistent", "INCONSISTENTE", "RHID em 13/10/2026: batidas inconsistentes."],
    ["2104", "ANA CLÁUDIA DE OLIVEIRA", "unregistered", "S/ CADASTRO", "Fornecedor sem cadastro no RHID em 13/10/2026."],
    ["2105", "PAULO HENRIQUE DE SOUZA", "loading", "CONSULTANDO RHID", "Consultando as batidas RHID de 13/10/2026."],
    ["2106", "ANTÔNIO PEREIRA DA SILVA", "unavailable", "RHID INDISPONÍVEL", "Consulta RHID de 13/10/2026 indisponível; presença não confirmada."],
  ];
  const options = rows.map(([id, name, status, label, description, minutes]) => ({
    id: `${prefix}${id}`,
    reply: `${prefix}${id}`,
    label: `${id} - ${name}`,
    rhidBadge: { status, label, date: "2026-10-13", description, ...(minutes === undefined ? {} : { minutes }) },
  }));
  const controlBadge = { ...options[0].rhidBadge };
  options.push(
    { id: "pending_attendance_other_date", label: "📅 AVALIAR OUTRA DATA", rhidBadge: controlBadge },
    { id: "attendance_close_demonstrative", label: "🏁 ENCERRAR UM IDDESCRITIVOETAPA", rhidBadge: controlBadge },
    { id: "endstage", label: "✅ FINALIZAR ETAPA", rhidBadge: controlBadge },
  );
  if (supplierSync) options.push({
    id: "choice:sincronizar_atividade_fornecedor_presenca:finish_supplier_sync",
    label: "✅ SUBMETER",
    rhidBadge: controlBadge,
  });
  return {
    id: "attendance-rhid-badges-day",
    role: "assistant",
    type: "poll",
    presentation,
    databaseFilter: true,
    databaseFilterKey: supplierSync ? "sincronizar_atividade_fornecedor_presenca" : "presence",
    question: "PRESENÇAS PENDENTES DE 13/10/2026",
    options,
  };
}

export function attendanceBadgeState(poll, overrides = {}) {
  return {
    sessionStatus: "authenticated",
    account: { name: "Bernardo" },
    draft: "",
    pendingFiles: [],
    messages: [poll],
    activeText: null,
    ...overrides,
  };
}
