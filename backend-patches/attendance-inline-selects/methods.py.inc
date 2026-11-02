    def _attendance_inline_context(self, state: dict, option: dict) -> dict:
        return {
            **(option.get("source_values") or {}),
            **(state.get("attendance_batch_changes") or {}),
            **((state.get("attendance_batch_row_changes") or {}).get(str(option["value"])) or {}),
        }

    def _attendance_inline_editors(self, state: dict, rows: list[list[dict]]) -> None:
        """Create a fresh, persisted whitelist; catalog reads never modify attendance."""
        revision = secrets.token_hex(12)
        commands = {}
        errors = []
        cache = {}
        steps = {
            step.get("target_field"): step
            for step in self._attendance_validation_config().get("steps", [])
            if step.get("edit_only")
        }
        labels = {"IDDESCRITIVOETAPA": "IDDESCRITIVO", "ATIVIDADEEXECUTADA": "ATIVIDADEEXECUTADA"}
        for option, row in zip(state.get("attendance_batch_records", []), rows):
            record_id = str(option["value"])
            context = self._attendance_inline_context(state, option)
            for field, label in labels.items():
                cell = next(cell for cell in row if cell["label"] == label)
                step = steps.get(field)
                try:
                    if not step:
                        raise RuntimeError("Campo sem seletor configurado")
                    # For list sources the adapter reads context only through value_from.
                    # Unknown/conditional sources use the entire context, avoiding unsafe reuse.
                    source = step.get("source") or {}
                    if source.get("type") == "sharepoint_list" and not source.get("recommended"):
                        dependencies = {f["value_from"] for f in source.get("filters", []) if f.get("value_from")}
                        catalog_context = {key: context.get(key) for key in sorted(dependencies)}
                    else:
                        catalog_context = context
                    key = json.dumps([step, catalog_context], sort_keys=True, default=str)
                    if key not in cache:
                        try:
                            cache[key] = [copy.deepcopy(item) for item in self.sharepoint.get_options(step, context)
                                          if not item.get("terminal_option") and not item.get("action")
                                          and item.get("value") not in {None, ""}]
                        except Exception as exc:
                            cache[key] = exc
                    if isinstance(cache[key], Exception):
                        raise cache[key]
                    catalog = cache[key]
                except Exception:
                    errors.append(f"{record_id}:{field}")
                    continue
                current = context.get(field)
                current_reply = ""
                choices = []
                seen = set()
                for item in catalog:
                    value = item.get("value")
                    identity = str(value)
                    if identity in seen:
                        continue
                    seen.add(identity)
                    reply = f"attendance_inline:{revision}:{record_id}:{field}:{len(choices)}"
                    commands[reply] = {"record_id": record_id, "field": field, "option": copy.deepcopy(item)}
                    choices.append({"value": reply, "label": str(item.get("title") or value)})
                    if self._same_attendance_value(value, current):
                        current_reply = reply
                # Missing/inactive current values remain visible, but cannot be introduced elsewhere.
                if current not in {None, ""} and not current_reply:
                    reply = f"attendance_inline:{revision}:{record_id}:{field}:current"
                    commands[reply] = {"record_id": record_id, "field": field, "noop": True}
                    choices.insert(0, {"value": reply, "label": str(cell["value"])})
                    current_reply = reply
                cell["editor"] = {"value": current_reply, "options": choices}
        state["attendance_inline_commands"] = commands
        state["attendance_inline_catalog_errors"] = errors

    def _handle_attendance_inline(self, command: str, state: dict, etag: str | None) -> dict:
        selected = (state.get("attendance_inline_commands") or {}).get(command)
        if not selected:
            self._send_text(state, "⚠️ ESTA SELEÇÃO EXPIROU. USE A TABELA ATUALIZADA.")
            return self._prompt_attendance_batch_confirmation(state, etag)
        record = next((item for item in state.get("attendance_batch_records", [])
                       if str(item["value"]) == selected["record_id"]), None)
        if record is None or selected.get("noop"):
            return self._prompt_attendance_batch_confirmation(state, etag)
        field = selected["field"]
        value = selected["option"]["value"]
        context = self._attendance_inline_context(state, record)
        if self._same_attendance_value(context.get(field), value):
            return self._prompt_attendance_batch_confirmation(state, etag)
        changes = state.setdefault("attendance_batch_row_changes", {}).setdefault(selected["record_id"], {})
        changes[field] = value
        source = selected["option"].get("source_values") or {}
        if field == "IDDESCRITIVOETAPA":
            for copied in ("IMOVEL", "ETAPA"):
                if source.get(copied) not in {None, ""}:
                    changes[copied] = source[copied]
            changes["ATIVIDADEEXECUTADA"] = ""
        elif field == "ATIVIDADEEXECUTADA" and source.get("ETAPA") not in {None, ""}:
            changes["ETAPA"] = source["ETAPA"]
        return self._prompt_attendance_batch_confirmation(state, etag)


