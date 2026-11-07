"""Apply only reviewed exact attendance replacements; reject source drift."""
REPLACEMENTS = [
('''        step = self._current_step(state)
        flow = self._flow_config(state)
        if not step:
            document_result''', '''        step = self._current_step(state)
        flow = self._flow_config(state)
        if (state.get("flow") == "attendance_validation" and step
                and step.get("key") == "motivacao_ausencia_presenca"
                and not state.get("edit_step_indices")):
            note = self._attendance_saved_justification(
                state.get("fields", {}).get("ID PRESENÇA"),
                state.get("fields", {}).get("DATA"))
            if note:
                self._apply_selected_option(state, step, {
                    "id": "saved_justification", "title": note, "value": note})
                state["attendance_justification_default"] = {
                    "record_id": str(state["fields"]["ID PRESENÇA"]),
                    "date": str(state["fields"]["DATA"])[:10], "note": note}
                state["step_index"] += 1
                return self._prompt_next_or_summary(state, etag)
        if not step:
            document_result'''),
('''    def _attendance_batch_summary_rows(self, state: dict) -> list[list[dict]]:
''', '''    def _attendance_saved_justification(self, record_id, expected_date) -> str:
        """Read the modal's latest note for this exact record and date."""
        identifier = str(record_id or "").strip()
        expected_day = str(expected_date or "")[:10]
        if not identifier.isdigit() or not expected_day:
            raise RuntimeError("REGISTRO OU DATA DA PRESENÇA INVÁLIDOS")
        current = self.sharepoint.get_item_fields(
            int(identifier), ["DATA", "IRREGULARIDADES"], target_list="DESCRITIVOPRESENCA")
        if str(current.get("DATA") or "")[:10] != expected_day:
            raise RuntimeError("A DATA DA PRESENÇA MUDOU. ATUALIZE A LISTA.")
        return str(current.get("IRREGULARIDADES") or "").strip()

    @staticmethod
    def _attendance_batch_absence_motivation(state: dict, option: dict) -> str:
        return ((state.get("attendance_batch_justifications") or {}).get(str(option["value"]))
                or state.get("attendance_batch_motivation") or "NÃO APONTADO")

    def _attendance_batch_summary_rows(self, state: dict) -> list[list[dict]]:
'''),
('''            if presence == "AUSENTE" and state.get("attendance_batch_motivation"):
                rows[-1].append({"label": "MOTIVAÇÃO", "value": state["attendance_batch_motivation"]})''', '''            if presence == "AUSENTE":
                rows[-1].append({"label": "MOTIVAÇÃO", "value": self._attendance_batch_absence_motivation(state, option)})'''),
('''        if command == "attendance_batch_present":
            state["attendance_batch_presence"] = "PRESENTE"''', '''        if command == "attendance_batch_present":
            state.pop("attendance_batch_justifications", None)
            state["attendance_batch_presence"] = "PRESENTE"'''),
('''        if command == "attendance_batch_holiday":
            state["attendance_batch_presence"] = "AUSENTE"''', '''        if command == "attendance_batch_holiday":
            state.pop("attendance_batch_justifications", None)
            state["attendance_batch_presence"] = "AUSENTE"'''),
('''        if command == "attendance_batch_absent":
            state["attendance_batch_presence"] = "AUSENTE"
            return self._prompt_attendance_batch_motivation(state, etag)''', '''        if command == "attendance_batch_absent":
            state["attendance_batch_presence"] = "AUSENTE"
            state.pop("attendance_batch_motivation", None)
            return self._prompt_attendance_batch_motivation(state, etag)'''),
('''    def _prompt_attendance_batch_motivation(self, state: dict, etag: str | None) -> dict:
        state["stage"] = "attendance_batch_motivation"''', '''    def _prompt_attendance_batch_motivation(self, state: dict, etag: str | None) -> dict:
        records = state.get("attendance_batch_records") or []
        notes = {
            str(option["value"]): self._attendance_saved_justification(
                option["value"], (option.get("source_values") or {}).get("DATA"))
            for option in records
        }
        state["attendance_batch_justifications"] = notes
        missing = [identifier for identifier, note in notes.items() if not note]
        if records and not missing:
            return self._prompt_attendance_batch_confirmation(state, etag)
        prompt = ("🔴 DIGITE A MOTIVAÇÃO DA AUSÊNCIA PARA OS IDs SEM JUSTIFICATIVA: "
                  + ", ".join(missing) + ". OU SELECIONE NÃO APONTADO.")
        state["stage"] = "attendance_batch_motivation"'''),
('''                "prompt": "🔴 DIGITE A MOTIVAÇÃO DA AUSÊNCIA PARA TODOS OS IDs OU SELECIONE NÃO APONTADO.",''', '''                "prompt": prompt,'''),
('''                row_updates = {**updates, **((state.get("attendance_batch_row_changes") or {}).get(str(option["value"])) or {})}
                fields = list(dict.fromkeys''', '''                row_updates = {**updates, **((state.get("attendance_batch_row_changes") or {}).get(str(option["value"])) or {})}
                if presence == "AUSENTE":
                    row_updates["MOTIVACAO"] = self._attendance_batch_absence_motivation(state, option)
                fields = list(dict.fromkeys'''),
('''                fields = list(dict.fromkeys(["PRESENCA", "DATA", "FORNECEDOR", "FILIAL", "IDDESCRITIVOETAPA", "ATIVIDADEEXECUTADA", *row_updates, *ATTENDANCE_CONSISTENCY_FIELDS]))''', '''                fields = list(dict.fromkeys(["PRESENCA", "DATA", "FORNECEDOR", "FILIAL", "IDDESCRITIVOETAPA", "ATIVIDADEEXECUTADA", "IRREGULARIDADES", *row_updates, *ATTENDANCE_CONSISTENCY_FIELDS]))'''),
('''                source_identity = option.get("source_values") or {}
                if state.get("attendance_supplier_defaults_answer"):''', '''                if presence == "AUSENTE" and state.get("attendance_batch_justifications") is not None:
                    current_note = str(current.get("IRREGULARIDADES") or "").strip()
                    if current_note != state["attendance_batch_justifications"].get(str(option["value"]), ""):
                        self._send_text(state, "⚠️ A JUSTIFICATIVA MUDOU. CONFIRA O RESUMO ATUALIZADO ANTES DE SUBMETER.")
                        return self._prompt_attendance_batch_motivation(state, etag)
                source_identity = option.get("source_values") or {}
                if state.get("attendance_supplier_defaults_answer"):'''),
('''        presence = normalize_text(str(selected.get("value", "")))
        if presence == "ausente":''', '''        state.pop("attendance_justification_default", None)
        presence = normalize_text(str(selected.get("value", "")))
        if presence == "ausente":'''),
('''    def _prepare_attendance_selected_record(self, state: dict) -> None:
        """Remove o texto legado e registra a base original da edição."""''', '''    def _prepare_attendance_selected_record(self, state: dict) -> None:
        """Remove o texto legado e registra a base original da edição."""
        state.pop("attendance_justification_default", None)'''),
('''    def _clear_step_value(state: dict, step: dict) -> None:
''', '''    def _clear_step_value(state: dict, step: dict) -> None:
        if step.get("key") == "motivacao_ausencia_presenca":
            state.pop("attendance_justification_default", None)
'''),
('''        """Atualiza e verifica um item escolhido, sem criar uma nova linha."""
        raw_item_id''', '''        """Atualiza e verifica um item escolhido, sem criar uma nova linha."""
        justification_etag = None
        default = state.get("attendance_justification_default")
        if (state.get("flow") == "attendance_validation" and default
                and state.get("fields", {}).get("PRESENCA") == "AUSENTE"
                and state.get("fields", {}).get("MOTIVACAO") == default["note"]):
            current, justification_etag = self.sharepoint.get_item_fields_with_etag(
                int(default["record_id"]), ["DATA", "IRREGULARIDADES"], target_list="DESCRITIVOPRESENCA")
            if str(current.get("DATA") or "")[:10] != default["date"]:
                raise RuntimeError("A DATA DA PRESENÇA MUDOU. ATUALIZE A LISTA.")
            if str(current.get("IRREGULARIDADES") or "").strip() != default["note"]:
                steps = self._flow_config(state)["steps"]
                index = next(i for i, item in enumerate(steps) if item["key"] == "motivacao_ausencia_presenca")
                self._clear_step_value(state, steps[index])
                state.update(stage="selecting_fields", step_index=index, options=[])
                state.pop("edit_step_indices", None)
                self._send_text(state, "⚠️ A JUSTIFICATIVA MUDOU. CONFIRA A MOTIVAÇÃO ATUALIZADA ANTES DE SUBMETER.")
                return self._prompt_next_or_summary(state, etag)
        raw_item_id'''),
('''                self.sharepoint.update_item(
                    item_id,
                    expected_fields,
                    target_list=target_list,
                )
            except Exception as exc:''', '''                if justification_etag is not None:
                    self.sharepoint.update_item_with_etag(
                        item_id, expected_fields, justification_etag, target_list=target_list)
                else:
                    self.sharepoint.update_item(
                        item_id, expected_fields, target_list=target_list)
            except Exception as exc:'''),
]


# Append these exact replacements to REPLACEMENTS in patch_backend.py.
# Only automatic saved-note defaults use per-record motivation. Explicit manual
# and holiday motivation retains the existing fanout semantics.
SUPPLIER_SYNC_REPLACEMENTS = [
('''        if presence == "AUSENTE":
            updates.update(MOTIVACAO=state["fields"].get("MOTIVACAO") or "NÃO APONTADO", VLORDIARIO="0", IDPGTO="AUSENTE")
        return updates

    def _attendance_confirmation_detail_table''', '''        if presence == "AUSENTE":
            motivation = state["fields"].get("MOTIVACAO") or "NÃO APONTADO"
            default = state.get("attendance_justification_default")
            if default:
                notes = default.setdefault("supplier_notes", {})
                identifier = str(record["item_id"])
                if identifier not in notes:
                    notes[identifier] = self._attendance_saved_justification(
                        record["item_id"], record["source_values"].get("DATA"))
                motivation = notes[identifier] or "NÃO APONTADO"
            updates.update(MOTIVACAO=motivation, VLORDIARIO="0", IDPGTO="AUSENTE")
        return updates

    def _attendance_confirmation_detail_table'''),
('''                fields = list(dict.fromkeys([*flow["writable_fields"], *ATTENDANCE_CONSISTENCY_FIELDS]))
                current, item_etag = self.sharepoint.get_item_fields_with_etag(''', '''                fields = list(dict.fromkeys([*flow["writable_fields"], *ATTENDANCE_CONSISTENCY_FIELDS]))
                default = state.get("attendance_justification_default")
                if default and presence == "AUSENTE":
                    fields = list(dict.fromkeys([*fields, "IRREGULARIDADES"]))
                current, item_etag = self.sharepoint.get_item_fields_with_etag('''),
('''                for field in fields:
                    if field == "DATA":
                        continue
                    if not self._same_attendance_value(current.get(field), source.get(field)):
                        raise RuntimeError(f"O CAMPO {field} DO ID {item_id} FOI ALTERADO")
                review = self._attendance_consistency_record({**current, **updates}, item_id=item_id)''', '''                for field in fields:
                    if field == "DATA":
                        continue
                    if field == "IRREGULARIDADES" and default and presence == "AUSENTE":
                        expected_note = default["supplier_notes"][str(item_id)]
                        if str(current.get(field) or "").strip() != expected_note:
                            default.pop("supplier_notes", None)
                            raise RuntimeError(f"A JUSTIFICATIVA DO ID {item_id} MUDOU. CONFIRA O RESUMO ATUALIZADO")
                        continue
                    if not self._same_attendance_value(current.get(field), source.get(field)):
                        raise RuntimeError(f"O CAMPO {field} DO ID {item_id} FOI ALTERADO")
                review = self._attendance_consistency_record({**current, **updates}, item_id=item_id)'''),
]

REPLACEMENTS += SUPPLIER_SYNC_REPLACEMENTS


def patch(relative, source):
    if relative != 'worker/workflow.py':
        raise RuntimeError('Unexpected source: ' + relative)
    text = source.decode('utf-8')
    for old, new in REPLACEMENTS:
        if text.count(old) != 1:
            raise RuntimeError('Expected one source anchor: ' + old[:90])
        text = text.replace(old, new, 1)
    # Existing batch lifecycle cleanup applies to the additional per-record snapshot.
    old = '"attendance_batch_origin", "attendance_batch_motivation", "attendance_batch_finalized_ids"'
    if text.count(old) != 2:
        raise RuntimeError('Unexpected attendance batch cleanup scope')
    text = text.replace(old, '"attendance_batch_origin", "attendance_batch_motivation", "attendance_batch_justifications", "attendance_batch_finalized_ids"')
    old = 'for key in ("attendance_batch_row_changes", "attendance_inline_commands", "attendance_inline_catalog_errors"):'
    if text.count(old) != 1:
        raise RuntimeError('Unexpected batch initialization scope')
    text = text.replace(old, 'for key in ("attendance_batch_row_changes", "attendance_inline_commands", "attendance_inline_catalog_errors", "attendance_batch_justifications", "attendance_batch_motivation"):')
    compile(text, relative, 'exec')
    return text.encode('utf-8')
