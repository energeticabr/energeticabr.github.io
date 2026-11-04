"""Apply the reviewed insertion once, preserving independent source roots."""
NEEDLE = '            self._description_load_child(state, 0, announce=False)\n            return\n'
REPLACEMENT = "            self._description_load_child(state, 0, announce=False)\n            if len(all_children) == 1:\n                price = children[0].get('VALOR TOTAL')\n                missing_price = _text(price).upper() in {'', 'PENDENTE', 'VALOR PENDENTE'}\n                try:\n                    missing_price = missing_price or _number(price, 'VALOR TOTAL') == 0\n                except ValueError:\n                    pass\n                if missing_price:\n                    # Reuse one-field editing so validation, draft persistence\n                    # and the return to the overview follow the normal route.\n                    group.update(editing_phase='field', editing_index=0, editing_common=False)\n                    steps = self._flow_config(state)['steps']\n                    target = next(i for i, step in enumerate(steps)\n                                  if step['key'] == 'validar_valor_total_baixa')\n                    state['edit_step_indices'] = [target]\n                    state['step_index'] = target\n                    state['confirm_or_replace_number_modes']['validar_valor_total_baixa'] = 'enter_value'\n            return\n"
ATTACHMENT_NEEDLE = "        flow['attachments_after_fields'] = bool(launch_phase or group.get('prepared'))\n"
ATTACHMENT_REPLACEMENT = "        flow['attachments_after_fields'] = bool(launch_phase or group.get('prepared')\n            or (group.get('review_version') == 1 and group.get('review_phase') == 'overview'\n                and state.get('edit_step_indices')))\n"

def change(data):
    text = data.decode('utf-8')
    if text.count(NEEDLE) != 1:
        raise RuntimeError('Expected source anchor exactly once')
    if text.count(ATTACHMENT_NEEDLE) != 1:
        raise RuntimeError('Expected attachment anchor exactly once')
    return text.replace(NEEDLE, REPLACEMENT).replace(ATTACHMENT_NEEDLE, ATTACHMENT_REPLACEMENT).encode('utf-8')
