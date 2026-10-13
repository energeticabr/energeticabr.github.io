"""CAS deployment patch for a bridge which already has the RHID badge query."""

REPLACEMENTS = (
    ('from rhid_badge_source import get_rhid_badge_report\n',
     'from rhid_badge_source import get_rhid_badge_report, attendance_rhid_option_context\n'),
    ('                    # Mantém metadados de apresentação para o portal sem\n',
     '                    **attendance_rhid_option_context(step, item, state.get("options")),\n'
     '                    # Mantém metadados de apresentação para o portal sem\n'),
)

def patch_bridge(source):
    old_call = '                    **attendance_rhid_option_context(step, item),\n'
    new_call = '                    **attendance_rhid_option_context(step, item, state.get("options")),\n'
    # Upgrade the already deployed context serializer without touching the
    # workflow, credentials, or existing RHID report implementation.
    if source.count(old_call) == 1 and source.count(REPLACEMENTS[0][1]) == 1:
        if source.count(new_call):
            raise ValueError('Bridge source changed; refusing duplicate presence context.')
        source = source.replace(old_call, new_call, 1)
        compile(source, 'channel_bridge.py', 'exec')
        return source
    for old, new in REPLACEMENTS:
        if source.count(old) != 1:
            raise ValueError('Bridge source changed; refusing ambiguous presence-context patch.')
        source = source.replace(old, new, 1)
    compile(source, 'channel_bridge.py', 'exec')
    return source
