"""Exercise the private worker's confirmation method without contacting SharePoint."""
import ast
from pathlib import Path
import sys
from types import SimpleNamespace


def confirmation_method(path):
    source = ast.parse(path.read_bytes(), filename=str(path))
    engine = next(node for node in source.body
                  if isinstance(node, ast.ClassDef) and node.name == "WorkflowEngine")
    method = next(node for node in engine.body
                  if isinstance(node, ast.FunctionDef) and node.name == "_send_confirmation_actions")
    namespace = {
        "document_batch": SimpleNamespace(send_confirmation=lambda *_: False),
        "normalize_text": str.casefold,
    }
    exec(compile(ast.Module(body=[method], type_ignores=[]), str(path), "exec"), namespace)
    return namespace[method.name]


def check(path):
    send_confirmation = confirmation_method(path)
    question = "CONFIRMA A BAIXA DE TODOS OS ITENS PENDENTES SELECIONADOS DO DESCRITIVO 65"
    expected = question + " NO VALOR DE R$ 21.802,14?"
    sent = []
    engine = SimpleNamespace(
        _flow_config=lambda _: {"confirmation_prompt": question + "?"},
        _summary_rows=lambda _: [{"label": "VALOR TOTAL", "value": "R$ 21.802,14"}],
        _is_multiple_launch=lambda _: False,
        _send_actions=lambda state, prompt, actions, **kwargs: sent.append((prompt, actions)),
    )
    state = {"flow": "payment_settlement", "fields": {"ETAPA": "Etapa antiga"}}
    for settings, suffix in (
        ({"submeter_lancamentos": "SIM", "ETAPA": "Fundação & Estrutura"}, "\nEtapa vinculada: Fundação & Estrutura"),
        ({"submeter_lancamentos": "SIM", "ETAPA": "Instalações"}, "\nEtapa vinculada: Instalações"),
        ({"submeter_lancamentos": "NÃO", "ETAPA": "Etapa antiga"}, ""),
        ({"submeter_lancamentos": "SIM", "ETAPA": "  "}, ""),
        (None, ""),
    ):
        state["provision_description"] = {"launch_settings": settings} if settings else {}
        send_confirmation(engine, state)
        prompt, actions = sent.pop()
        assert prompt == expected + suffix, (prompt, expected + suffix)
        assert [a["id"] for a in actions] == ["confirm_yes", "confirm_edit", "confirm_cancel"]


if __name__ == "__main__":
    check(Path(sys.argv[1]))
    print("Confirmação de baixa verificada")
