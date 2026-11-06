"""Keep completed-submit retries out of area routing."""
from pathlib import Path
import sys


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Source anchor drift: ' + old[:100])
    return text.replace(old, new, 1)


def patch(relative, data):
    if relative != 'worker/workflow.py':
        raise RuntimeError('Unexpected source: ' + relative)
    text = data.decode('utf-8')
    text = replace_once(text,
        '''            and event.get("message_id")
            == state.get("completion_trigger_message_id")
            and state.get("sharepoint", {}).get("item_id")
''',
        '''            and (
                event.get("message_id") == state.get("completion_trigger_message_id")
                or (event.get("kind") == "text" and _control_command(
                    event.get("reply_id") or event.get("text") or ""
                ) in {"sim", "confirm_yes"})
            )
            and state.get("sharepoint", {}).get("item_id")
''')
    duplicate = '''        if state and event.get("message_id") in state.get("processed_message_ids", []):
            return {
                "status": "duplicate",
                "message_id": event["message_id"],
                "batch_id": state.get("batch_id"),
            }

'''
    text = replace_once(text, duplicate, '')
    text = replace_once(text,
        '''        ):
            if state.get("document_signing_completion_notice"):
''',
        '''        ):
            # A second tap has a new ID; remember it before acknowledging it.
            if event.get("message_id") not in state.get("processed_message_ids", []):
                self._mark_processed(state, event["message_id"])
                etag = self._save(state, etag)
            if state.get("document_signing_completion_notice"):
''')
    marker = '        # O menu principal enviado com atraso pertence ao lote já concluído.\n'
    text = replace_once(text, marker,
        '        # Deduplicate before a completed batch can be replaced by a menu.\n'
        + duplicate + marker)
    text = replace_once(text,
        '''            fresh = self._new_state(event, key)
            fresh_etag = self._save(fresh, etag)
            return self._handle_group_choice(event, fresh, fresh_etag)
''',
        '''            fresh = self._new_state(event, key)
            # Retried old answers must remain duplicates after entering an area.
            fresh["processed_message_ids"] = list(state.get("processed_message_ids", []))
            fresh_etag = self._save(fresh, etag)
            return self._handle_group_choice(event, fresh, fresh_etag)
''')
    compile(text, relative, 'exec')
    return text.encode('utf-8')


if __name__ == '__main__':
    root = Path(sys.argv[1])
    path = root / 'worker/workflow.py'
    path.write_bytes(patch('worker/workflow.py', path.read_bytes()))
