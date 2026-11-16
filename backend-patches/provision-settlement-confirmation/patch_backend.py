"""Show the grouped settlement's selected launch stage below its total."""


def change(relative, before):
    if relative != "worker/workflow.py":
        raise ValueError(f"Unexpected deployment target {relative}")
    anchor = b"""                if total:
                    prompt = f"{prompt.rstrip('?')} NO VALOR DE {total}?"
        if state.get("flow") == "attendance_validation":
"""
    extra = br"""                launch_settings = (state.get("provision_description") or {}).get("launch_settings") or {}
                if launch_settings.get("submeter_lancamentos") == "SIM":
                    stage = " ".join(str(launch_settings.get("ETAPA") or "").split())
                    if stage:
                        prompt += f"\nEtapa vinculada: {stage}"
"""
    newline = b"\r\n" if anchor.replace(b"\n", b"\r\n") in before else b"\n"
    anchor = anchor.replace(b"\n", newline)
    extra = extra.replace(b"\n", newline)
    if before.count(anchor) != 1:
        raise RuntimeError("Unexpected payment confirmation source")
    split = anchor.index(b'        if state.get("flow")')
    return before.replace(anchor, anchor[:split] + extra + anchor[split:])
