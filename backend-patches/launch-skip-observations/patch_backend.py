"""Add the standard blank action to the launch observation text step."""
import json


def patch(relative, source):
    if relative != "worker/workflow_config.json":
        raise ValueError(f"Unexpected source: {relative}")

    anchor = '''          "key": "observacao_lancamento",
          "kind": "text",
          "target_field": "DESCRIÇÃO",
          "prompt": "DIGITE A OBSERVAÇÃO:",
          "when": {'''.encode("utf-8")
    replacement = anchor.replace(
        b'          "when": {',
        '''          "blank_option": {
            "id": "launch_observation_skip",
            "title": "Continuar sem observações",
            "reply": "launch_observation_skip"
          },
          "when": {'''.encode("utf-8"),
    )
    if source.count(anchor) != 1:
        raise ValueError("Expected one unmodified launch observation text step")
    candidate = source.replace(anchor, replacement, 1)
    json.loads(candidate)
    return candidate
