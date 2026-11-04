    @staticmethod
    def _attendance_supplier_presence_changed_fields(state: dict) -> dict:
        """Keep the descriptor, activity and derived stage together for every target."""
        original = state.get("attendance_original_fields", {})
        fields = state.get("fields", {})
        changed = {}
        for field in ("IDDESCRITIVOETAPA", "ATIVIDADEEXECUTADA", "ETAPA"):
            if normalize_text(str(original.get(field) or "")) != normalize_text(str(fields.get(field) or "")):
                changed[field] = copy.deepcopy(fields.get(field))
        if any(field in changed for field in ("IDDESCRITIVOETAPA", "ATIVIDADEEXECUTADA")):
            for field in ("IDDESCRITIVOETAPA", "ATIVIDADEEXECUTADA", "ETAPA"):
                if fields.get(field) in (None, ""):
                    raise RuntimeError("DESCRITIVO, ATIVIDADE E ETAPA DEVEM ESTAR PREENCHIDOS PARA ATRIBUIÇÃO")
                changed[field] = copy.deepcopy(fields[field])
            if fields.get("IMOVEL") not in (None, ""):
                changed["IMOVEL"] = copy.deepcopy(fields["IMOVEL"])
        return changed
