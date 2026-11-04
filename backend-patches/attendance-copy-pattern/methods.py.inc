    def _attendance_copy_offer(self, state: dict, record: dict) -> None:
        source = record.get("source_values") or {}
        source_id = str(record["value"])
        context = self._attendance_inline_context(state, record)
        if context.get("IDDESCRITIVOETAPA") in (None, "") or context.get("ATIVIDADEEXECUTADA") in (None, ""):
            return
        grouped = {}
        source_key = (str(source.get("FORNECEDOR") or "").strip().casefold(), str(source.get("FILIAL") or "").strip().casefold())
        for item in state.get("attendance_batch_records") or []:
            values = item.get("source_values") or {}
            key = (str(values.get("FORNECEDOR") or "").strip().casefold(), str(values.get("FILIAL") or "").strip().casefold())
            if not key[0] or key == source_key:
                continue
            record_id = str(item["value"])
            if not record_id.isdecimal():
                continue
            group = grouped.setdefault(key, {"id": record_id, "name": str(values.get("FORNECEDOR") or ""), "branch": str(values.get("FILIAL") or ""), "records": []})
            group["records"].append(record_id)
        if grouped:
            state["attendance_copy_offer"] = {"token": secrets.token_hex(12), "source_id": source_id,
                "descriptor": context["IDDESCRITIVOETAPA"], "activity": context["ATIVIDADEEXECUTADA"],
                "targets": list(grouped.values())}

    def _handle_attendance_copy(self, command: str, state: dict, etag: str | None) -> dict:
        offer = state.get("attendance_copy_offer") or {}
        parts = command.split(":")
        if len(parts) < 2 or not offer or parts[1] != offer.get("token"):
            return self._prompt_attendance_batch_confirmation(state, etag)
        if parts[0] == "attendance_copy_skip" and len(parts) == 2:
            state.pop("attendance_copy_offer", None)
            return self._prompt_attendance_batch_confirmation(state, etag)
        ids = parts[2].split(",") if len(parts) == 3 else []
        target_map = {item["id"]: item for item in offer["targets"]}
        if parts[0] != "attendance_copy" or not ids or len(set(ids)) != len(ids) or any(i not in target_map for i in ids):
            return self._prompt_attendance_batch_confirmation(state, etag)
        records = {str(item["value"]): item for item in state.get("attendance_batch_records") or []}
        source = records.get(offer["source_id"])
        context = self._attendance_inline_context(state, source) if source else {}
        if not all(self._same_attendance_value(context.get(field), offer[key]) for field, key in (("IDDESCRITIVOETAPA", "descriptor"), ("ATIVIDADEEXECUTADA", "activity"))):
            state.pop("attendance_copy_offer", None)
            self._send_text(state, "⚠️ O PADRÃO FOI ALTERADO. REFAÇA A SELEÇÃO.")
            return self._prompt_attendance_batch_confirmation(state, etag)
        steps = {step.get("target_field"): step for step in self._attendance_validation_config().get("steps", []) if step.get("edit_only")}
        planned = {}
        try:
            for target_id in ids:
                for record_id in target_map[target_id]["records"]:
                    record = records[record_id]
                    target_context = self._attendance_inline_context(state, record)
                    descriptor = next(item for item in self.sharepoint.get_options(steps["IDDESCRITIVOETAPA"], target_context)
                                      if not item.get("terminal_option") and not item.get("action") and self._same_attendance_value(item.get("value"), offer["descriptor"]))
                    updates = {"IDDESCRITIVOETAPA": descriptor["value"]}
                    for field in ("IMOVEL", "ETAPA"):
                        value = (descriptor.get("source_values") or {}).get(field)
                        if value not in (None, ""):
                            updates[field] = value
                    target_context = {**target_context, **updates}
                    activity = next(item for item in self.sharepoint.get_options(steps["ATIVIDADEEXECUTADA"], target_context)
                                    if not item.get("terminal_option") and not item.get("action") and self._same_attendance_value(item.get("value"), offer["activity"]))
                    updates["ATIVIDADEEXECUTADA"] = activity["value"]
                    stage = (activity.get("source_values") or {}).get("ETAPA")
                    if stage not in (None, ""):
                        updates["ETAPA"] = stage
                    planned[record_id] = updates
        except Exception:
            offer["error"] = "Não foi possível aplicar o padrão a todos os selecionados. Confira os dados e tente novamente."
            self._send_text(state, "⚠️ NÃO FOI POSSÍVEL APLICAR O PADRÃO A TODOS OS SELECIONADOS. CONFIRA OS DADOS E TENTE NOVAMENTE.")
            return self._prompt_attendance_batch_confirmation(state, etag)
        for record_id, updates in planned.items():
            state.setdefault("attendance_batch_row_changes", {}).setdefault(record_id, {}).update(updates)
        state.pop("attendance_copy_offer", None)
        return self._prompt_attendance_batch_confirmation(state, etag)
