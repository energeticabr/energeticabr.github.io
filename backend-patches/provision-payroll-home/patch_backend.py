"""Route Home before the optional payroll reply handlers in a frozen group."""


def change(relative, before):
    if relative != "worker/provision_description_settlement.py":
        raise ValueError(f"Unexpected deployment target {relative}")
    source = before.decode("utf-8")
    anchor = """            return handlers[state['stage']](event, state, etag)
        if not (group.get('journal') or {}).get('intent') or state.get('stage') == 'completed':
"""
    replacement = """            reply = event.get('reply_id') or event.get('text')
            if command != 'portal_confirm_main_menu' and not self._is_navigation_main_menu(reply):
                return handlers[state['stage']](event, state, etag)
            journal = group.get('journal') or {}
            receipt = state['sharepoint']
            parent = journal.get('parent') or {}
            children = journal.get('children') or {}
            selected_ids = {str(item_id) for item_id in receipt.get('selected_ids', [])}
            receipt_ids = {str(row['item_id']) for row in receipt['line_items']}
            confirmed_names = set(parent.get('attachment_names') or [])
            if (journal.get('intent') and not journal.get('in_flight')
                    and _verified(parent.get('verified')) and parent.get('item_id') == receipt.get('item_id')
                    and selected_ids == receipt_ids == set(children)
                    and all(_verified(row.get('verified')) for row in children.values())
                    and all(attachment in (journal.get('attachments') or [])
                            and attachment.get('sharepoint_name') in confirmed_names
                            for attachment in self._all_state_attachments(state))):
                # The optional links can be skipped. The receipt and files
                # have already been verified in SharePoint.
                return self._finish_portal_draft_exit(event, state, etag, state['key'], save=False)
        if not (group.get('journal') or {}).get('intent') or state.get('stage') == 'completed':
"""
    if source.count(anchor) != 1:
        raise RuntimeError("Unexpected grouped settlement navigation source")
    return source.replace(anchor, replacement).encode("utf-8")
