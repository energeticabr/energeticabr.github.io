    def _prompt_attendance_summary_registration(self, state, etag):
        state["attendance_summary_registration_menu"] = True
        state["options"] = [
            {"id": "attendance_batch_register_descriptor", "title": "🏷️ DESCRITIVO ETAPA"},
            {"id": "attendance_batch_register_activity", "title": "⚙️ ATIVIDADE EXECUTADA"},
            {"id": "attendance_batch_register_back", "title": "↩️ VOLTAR AO RESUMO"},
        ]
        self._send_actions(state, "➕ O QUE DESEJA CADASTRAR?", state["options"])
        etag = self._save(state, etag)
        return {"status": "awaiting_attendance_summary_registration", "batch_id": state["batch_id"], "etag": etag}

    def _handle_attendance_summary_registration(self, command, state, etag):
        if not state.get("attendance_summary_registration_menu"):
            if command == "attendance_batch_register":
                return self._prompt_attendance_summary_registration(state, etag)
            return None
        selected = resolve_option(command, state.get("options", []), state["stage"])
        command = str(selected["id"]) if selected else command
        if command == "attendance_batch_register_back":
            state.pop("attendance_summary_registration_menu", None)
            return self._prompt_attendance_batch_confirmation(state, etag)
        kinds = {
            "attendance_batch_register_descriptor": ("construction_stage_demonstrative_create", "filial_demonstrativo_etapa", "DESCRITIVO DE ETAPA"),
            "attendance_batch_register_activity": ("hr_activity_registration", "filial_atividade_rh", "ATIVIDADE EXECUTADA"),
        }
        if command not in kinds:
            return self._prompt_attendance_summary_registration(state, etag)
        if state.get("flow") != "attendance_validation" or not state.get("attendance_batch_records") or state.get("attendance_batch_commit"):
            raise RuntimeError("O resumo de presenças não está disponível para cadastro")
        flow, filial_step, heading = kinds[command]
        branches = {str((record.get("source_values") or {}).get("FILIAL") or "").strip()
                    for record in state["attendance_batch_records"]}
        filial = next(iter(branches)) if len(branches) == 1 else None
        state.pop("attendance_summary_registration_menu", None)
        return self._start_embedded_launch_registration(
            state, etag, flow=flow, return_type="attendance_summary_registration",
            heading=f"➕ *CADASTRO DE {heading}*",
            initial_step_values={filial_step: filial} if filial else None,
        )

    def _resume_attendance_summary_registration(self, state, etag, item_id):
        embedded = state.get("embedded_return") or {}
        parent = copy.deepcopy(embedded.get("state") or {})
        if (embedded.get("type") != "attendance_summary_registration"
                or parent.get("flow") != "attendance_validation"
                or parent.get("stage") != "attendance_batch_confirmation"
                or not parent.get("attendance_batch_records")):
            raise RuntimeError("Retorno do resumo de presenças não encontrado")
        processed = list(state.get("processed_message_ids", []))
        state.clear()
        state.update(parent)
        state["processed_message_ids"] = processed
        result = self._prompt_attendance_batch_confirmation(state, etag)
        return {**result, "embedded_attendance_summary_registered": True, "registered_item_id": item_id}
