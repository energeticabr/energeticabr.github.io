    def _attendance_batch_supplier_changes(self, state: dict) -> list[dict]:
        changed = []
        for option in state.get("attendance_batch_records") or []:
            original = option.get("source_values") or {}
            final = self._attendance_inline_context(state, option)
            updates = {}
            for presence_field, supplier_field in (("IDDESCRITIVOETAPA", "DESCRITIVOETAPA ATUAL"),
                                                   ("ATIVIDADEEXECUTADA", "ATIVIDADE EXERCIDA")):
                value = final.get(presence_field)
                if not self._same_attendance_value(original.get(presence_field), value):
                    if value in (None, ""):
                        raise RuntimeError("SELECIONE OS VALORES COMPLETOS ANTES DE SUBMETER")
                    updates[supplier_field] = copy.deepcopy(value)
            if updates:
                # The supplier's activity and description are one consistent pair.
                for presence_field, supplier_field in (("IDDESCRITIVOETAPA", "DESCRITIVOETAPA ATUAL"),
                                                       ("ATIVIDADEEXECUTADA", "ATIVIDADE EXERCIDA")):
                    value = final.get(presence_field)
                    if value in (None, ""):
                        raise RuntimeError("ATIVIDADE E DESCRITIVO DEVEM ESTAR PREENCHIDOS PARA ATUALIZAR O PADRÃO")
                    updates[supplier_field] = copy.deepcopy(value)
                changed.append({"supplier": str(original.get("FORNECEDOR") or "").strip(),
                                "branch": str(original.get("FILIAL") or "").strip(), "updates": updates})
        return changed

    def _prompt_attendance_supplier_defaults(self, state: dict, etag: str | None) -> dict:
        state["attendance_supplier_defaults_question"] = True
        changes = self._attendance_batch_supplier_changes(state)
        detail = "\n".join(f"{item['supplier']} — DESCRITIVO {item['updates']['DESCRITIVOETAPA ATUAL']} — ATIVIDADE {item['updates']['ATIVIDADE EXERCIDA']}" for item in changes)
        self._send_actions(state, "VOCÊ QUER ALTERAR O PADRÃO DE ATIVIDADE E DESCRITIVO ETAPA NO CADASTRO DESTES FORNECEDORES?\n" + detail,
                           [{"id": "attendance_supplier_defaults_yes", "title": "SIM, ALTERAR PADRÃO"},
                            {"id": "attendance_supplier_defaults_no", "title": "NÃO, APENAS SUBMETER"},
                            {"id": "attendance_supplier_defaults_back", "title": "VOLTAR AO RESUMO"}], allow_back=False)
        etag = self._save(state, etag)
        return {"status": "awaiting_attendance_supplier_defaults", "batch_id": state["batch_id"], "etag": etag}

    def _attendance_batch_supplier_plan(self, state: dict, changes: list[dict]) -> list[dict]:
        lookup = self._attendance_validation_config().get("supplier_activity_sync_lookup_step")
        if not lookup:
            raise RuntimeError("CONSULTA DE FORNECEDORES INDISPONÍVEL")
        entries = {}
        for change in changes:
            supplier = change["supplier"]
            if not supplier:
                raise RuntimeError("FORNECEDOR DA PRESENÇA NÃO INFORMADO")
            lookup_state = copy.deepcopy(state)
            lookup_state.setdefault("fields", {})["FORNECEDOR"] = supplier
            lookup_state.setdefault("display_values", {})["FORNECEDOR"] = supplier
            options = self.sharepoint.get_options(lookup, self._context(lookup_state))
            matches = [item for item in options if normalize_text(str((item.get("source_values") or {}).get("CADASTRO") or "")) == normalize_text(supplier)]
            if not change["branch"]:
                raise RuntimeError(f"FILIAL NÃO INFORMADA PARA O FORNECEDOR {supplier}")
            matches = [item for item in matches if normalize_text(str((item.get("source_values") or {}).get("FILIAL") or "")) == normalize_text(change["branch"])]
            if len(matches) != 1:
                raise RuntimeError(f"NÃO FOI POSSÍVEL IDENTIFICAR COM SEGURANÇA O FORNECEDOR {supplier}")
            source = matches[0].get("source_values") or {}
            supplier_id = int(str(source.get("Id") or matches[0].get("value") or "0"))
            if supplier_id <= 0:
                raise RuntimeError(f"ID INVÁLIDO DO FORNECEDOR {supplier}")
            entry = entries.setdefault(supplier_id, {"item_id": supplier_id, "supplier": supplier, "branch": change["branch"], "updates": {}})
            if normalize_text(entry["branch"]) != normalize_text(change["branch"]):
                raise RuntimeError(f"FILIAIS DIVERGENTES PARA O FORNECEDOR {supplier}")
            for field, value in change["updates"].items():
                if field in entry["updates"] and not self._same_attendance_value(entry["updates"][field], value):
                    raise RuntimeError(f"HÁ VALORES DIFERENTES PARA O MESMO FORNECEDOR {supplier}")
                entry["updates"][field] = value
        for entry in entries.values():
            fields = ["CADASTRO", "FILIAL", *entry["updates"]]
            current, version = self.sharepoint.get_item_fields_with_etag(entry["item_id"], fields, target_list="FORNECEDORES")
            if normalize_text(str(current.get("CADASTRO") or "")) != normalize_text(entry["supplier"]):
                raise RuntimeError("O CADASTRO DO FORNECEDOR FOI ALTERADO")
            if normalize_text(str(current.get("FILIAL") or "")) != normalize_text(entry["branch"]):
                raise RuntimeError("A FILIAL DO FORNECEDOR FOI ALTERADA")
            entry["original"] = current
            entry["etag"] = version
        return list(entries.values())

    def _commit_attendance_batch_supplier_defaults(self, journal: dict) -> None:
        for entry in journal.get("supplier_defaults", []):
            current, version = self.sharepoint.get_item_fields_with_etag(entry["item_id"], list(entry["original"]), target_list="FORNECEDORES")
            for field in ("CADASTRO", "FILIAL"):
                if not self._same_attendance_value(current.get(field), entry["original"].get(field)):
                    raise AttendanceBatchConflict(f"O CADASTRO DO FORNECEDOR {entry['supplier']} FOI ALTERADO")
            if all(self._same_attendance_value(current.get(field), value) for field, value in entry["updates"].items()):
                continue
            if any(not self._same_attendance_value(current.get(field), value) for field, value in entry["original"].items()):
                raise AttendanceBatchConflict(f"O CADASTRO DO FORNECEDOR {entry['supplier']} FOI ALTERADO")
            self.sharepoint.update_item_with_etag(entry["item_id"], entry["updates"], version, target_list="FORNECEDORES")
            verified = self.sharepoint.get_item_fields(entry["item_id"], list(entry["updates"]), target_list="FORNECEDORES")
            if not all(self._same_attendance_value(verified.get(field), value) for field, value in entry["updates"].items()):
                raise RuntimeError(f"NÃO FOI CONFIRMADO O CADASTRO DO FORNECEDOR {entry['supplier']}")
