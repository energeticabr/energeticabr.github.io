    def _prompt_attendance_supplier_defaults(self, state: dict, etag: str | None) -> dict:
        state["attendance_supplier_defaults_question"] = True
        changes = self._attendance_batch_supplier_changes(state)
        if "attendance_supplier_defaults_preview" not in state:
            try:
                state["attendance_supplier_defaults_preview"] = self._attendance_batch_supplier_plan(state, changes)
            except Exception:
                state["attendance_supplier_defaults_preview"] = None
        preview = state.get("attendance_supplier_defaults_preview")
        rows = []
        if preview:
            for item in preview:
                original, updates = item["original"], item["updates"]
                rows.append({"supplier": item["supplier"], "branch": item["branch"],
                             "descriptor": {"before": original.get("DESCRITIVOETAPA ATUAL"), "after": updates.get("DESCRITIVOETAPA ATUAL")},
                             "activity": {"before": original.get("ATIVIDADE EXERCIDA"), "after": updates.get("ATIVIDADE EXERCIDA")}})
        else:
            grouped = {}
            for item in changes:
                key = (item["supplier"], item["branch"])
                row = grouped.setdefault(key, {"supplier": item["supplier"], "branch": item["branch"],
                    "descriptor": {"before": "NÃO DISPONÍVEL", "after": []},
                    "activity": {"before": "NÃO DISPONÍVEL", "after": []}})
                for key_name, field in (("descriptor", "DESCRITIVOETAPA ATUAL"), ("activity", "ATIVIDADE EXERCIDA")):
                    value = str(item["updates"][field])
                    if value not in row[key_name]["after"]:
                        row[key_name]["after"].append(value)
            rows = list(grouped.values())
            for row in rows:
                for key_name in ("descriptor", "activity"):
                    row[key_name]["after"] = " / ".join(row[key_name]["after"])
        def display(value):
            return str(value) if value not in (None, "") else "EM BRANCO"
        detail = "\n".join(f"{row['supplier']} ({display(row['branch'])}) — DESCRITIVO: {display(row['descriptor']['before'])} → {display(row['descriptor']['after'])} — ATIVIDADE: {display(row['activity']['before'])} → {display(row['activity']['after'])}" for row in rows)
        heading = "VOCÊ QUER ALTERAR O PADRÃO DE ATIVIDADE E DESCRITIVO ETAPA NO CADASTRO DESTES FORNECEDORES?"
        warning = "" if preview else "\nNÃO FOI POSSÍVEL CONFERIR OS PADRÕES. RECONSULTE OU SUBMETA SEM ALTERAR OS CADASTROS."
        state["_outbound_detail_table"] = {"kind": "presence", "variant": "supplier_defaults_comparison", "available": bool(preview), "rows": rows}
        actions = ([{"id": "attendance_supplier_defaults_yes", "title": "SIM, ALTERAR PADRÃO"}] if preview else [
            {"id": "attendance_supplier_defaults_retry", "title": "RECONSULTAR PADRÕES"}])
        actions += [{"id": "attendance_supplier_defaults_no", "title": "NÃO, APENAS SUBMETER"},
                    {"id": "attendance_supplier_defaults_back", "title": "VOLTAR AO RESUMO"}]
        try:
            self._send_actions(state, heading + warning + "\n" + detail, actions, allow_back=False)
        finally:
            state.pop("_outbound_detail_table", None)
        etag = self._save(state, etag)
        return {"status": "awaiting_attendance_supplier_defaults", "batch_id": state["batch_id"], "etag": etag}
