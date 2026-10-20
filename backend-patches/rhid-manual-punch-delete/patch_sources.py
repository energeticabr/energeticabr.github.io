"""Exact, reviewed edits to the three existing RHID consumers; refuse drift."""

def replace_once(source, before, after):
    if source.count(before) != 1:
        raise ValueError('Missing or ambiguous RHID patch anchor: ' + before[:100])
    return source.replace(before, after, 1)


def patch_sources(sources):
    result = dict(sources)
    name = 'rhid_attendance_adjustments.py'
    result[name] = replace_once(result[name], 'from uuid import uuid4\n',
        'from uuid import uuid4\nfrom rhid_manual_punch_removal import latest_active_rows\n')
    result[name] = replace_once(result[name],
        'for row in sorted(rows, key=lambda item: int(item.get("Id") or 0)):', 'for row in latest_active_rows(rows):')
    result[name] = replace_once(result[name],
        'return {str(row.get("DATA_REFERENCIA")) for row in rows\n',
        'return {str(row.get("DATA_REFERENCIA")) for row in latest_active_rows(rows)\n')
    name = 'rhid_calendar_snapshot.py'
    result[name] = replace_once(result[name], 'import re\n', 'import re\nfrom rhid_manual_punch_removal import latest_active_rows\n')
    result[name] = replace_once(result[name],
        'for revision in sorted(revisions, key=lambda row: int(row.get("Id") or 0)):',
        'for revision in latest_active_rows(revisions):')
    name = 'channel_bridge.py'
    result[name] = replace_once(result[name],
        'from rhid_badge_source import get_rhid_badge_report, attendance_rhid_option_context\n',
        'from rhid_badge_source import get_rhid_badge_report, attendance_rhid_option_context\nfrom rhid_manual_punch_removal import delete_for_bridge\n')
    result[name] = replace_once(result[name], '                elif action == "rhid_refresh":\n',
        '''                elif action == "rhid_attendance_adjust_delete":
                    result = delete_for_bridge(
                        self.bridge, identity, body.get("date"), body.get("personKey"),
                        body.get("slot"), body.get("revisionId"),
                        allowed_emails=self.portal_authenticator.allowed_emails,
                    )
                elif action == "rhid_refresh":
''')
    return result
