"""Mechanical, guarded patch for the existing authenticated report action."""
from pathlib import Path
import sys

REPLACEMENTS = (
    ('from rhid_attendance_adjustments import SharePointRhidAttendanceAdjustmentStore, validate_adjustment_against_rhid\n',
     'from rhid_attendance_adjustments import SharePointRhidAttendanceAdjustmentStore, validate_adjustment_against_rhid\n'
     'from rhid_badge_source import get_rhid_badge_report\n'),
    ('    def portal_rhid_attendance_report(\n'
     '        self, identity: dict, selected_date, *, allowed_emails: set[str],\n',
     '    def portal_rhid_attendance_report(\n'
     '        self, identity: dict, selected_date, *, allowed_emails: set[str], include_registration: bool = False,\n'),
    ('        source_rows = self.engine.sharepoint.get_rhid_attendance_report(on_date)\n'
     '        pending_rows = self.engine.sharepoint.get_pending_attendance(on_date)\n',
     '        # The optional badge query is read-only and uses the complete RHID\n'
     '        # directory/AFD; existing reports retain their SharePoint source.\n'
     '        badge_report = get_rhid_badge_report(on_date.isoformat()) if include_registration else None\n'
     '        source_rows = badge_report["rows"] if badge_report else self.engine.sharepoint.get_rhid_attendance_report(on_date)\n'
     '        pending_rows = self.engine.sharepoint.get_pending_attendance(on_date)\n'),
    ('            "attendanceReport": {"date": on_date.isoformat(), "rows": rows},\n',
     '            "attendanceReport": {"date": on_date.isoformat(), "rows": rows,\n'
     '                **({"registration": badge_report["registration"]} if badge_report else {})},\n'),
    ('                elif action == "rhid_attendance_report":\n'
     '                    result = self.bridge.portal_rhid_attendance_report(\n'
     '                        identity,\n'
     '                        body.get("date"),\n'
     '                        allowed_emails=self.portal_authenticator.allowed_emails,\n',
     '                elif action == "rhid_attendance_report":\n'
     '                    result = self.bridge.portal_rhid_attendance_report(\n'
     '                        identity,\n'
     '                        body.get("date"),\n'
     '                        allowed_emails=self.portal_authenticator.allowed_emails,\n'
     '                        include_registration=body.get("includeRegistration") is True,\n'),
)

def patch_bridge(source):
    for old, new in REPLACEMENTS:
        if source.count(old) != 1: raise ValueError('Backend source changed; refusing ambiguous patch.')
        source = source.replace(old, new, 1)
    compile(source, 'channel_bridge.py', 'exec')
    return source

if __name__ == '__main__':
    source_path, target_path = map(Path, sys.argv[1:3])
    target_path.write_text(patch_bridge(source_path.read_text(encoding='utf-8')), encoding='utf-8')
