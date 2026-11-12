"""Accept a typed expiry date at the DOCUMENTOS yes/no question."""
import argparse
import json
from pathlib import Path


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise RuntimeError(f'Unexpected source anchor: {before[:100]}')
    return text.replace(before, after, 1)


def patch(relative, data):
    text = data.decode('utf-8')
    if relative == 'worker/workflow_config.json':
        text = replace_once(text,
            'Se responder SIM, a data de validade será solicitada na próxima etapa.',
            'Digite a data de validade no chat ou escolha uma opção abaixo.')
        json.loads(text)
    elif relative == 'worker/workflow.py':
        start = text.index('    def _handle_selection_reply(self, event, state, etag, step) -> dict:\n')
        end = text.index('        # A typed search is never a choice, even when it exactly matches an ID.', start)
        text = text[:end] + '''        if (
            state.get("flow") == "document"
            and step.get("key") == "tem_data_validade"
            and event.get("kind") == "text"
            and not event.get("reply_id")
        ):
            typed_date = str(raw_reply).strip()
            if "/" in typed_date or re.fullmatch(r"\\d{2}", typed_date):
                parsed = parse_user_date(typed_date)
                if parsed is None:
                    self._send_text(
                        state, f"INDIQUE UMA DATA VÁLIDA. Use {USER_DATE_FORMAT_HINT}."
                    )
                    self._send_options(state, step, state["options"])
                    self._save(state, etag)
                    return {"status": "invalid_date", "field": step["key"]}
                date_index = state["step_index"] + 1
                date_step = self._flow_config(state)["steps"][date_index]
                yes = next(option for option in self._selection_options(state, step)
                           if option.get("value") == "SIM")
                self._apply_selected_option(state, step, yes)
                state["step_index"] = date_index
                state["options"] = []
                return self._complete_date_step(
                    state, etag, date_step, parsed, parsed.strftime("%d/%m/%Y")
                )
''' + text[end:]
        compile(text, relative, 'exec')
    else:
        raise RuntimeError(f'Unexpected source: {relative}')
    return text.encode('utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path, help='Candidate source tree')
    args = parser.parse_args()
    files = ('worker/workflow.py', 'worker/workflow_config.json')
    candidates = {name: patch(name, (args.root / name).read_bytes()) for name in files}
    for name, data in candidates.items():
        (args.root / name).write_bytes(data)
