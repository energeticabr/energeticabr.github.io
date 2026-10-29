"""Actual synthetic channel messages for visual QA, no production records."""
import json,sys
from pathlib import Path
from test_settlement_payroll import SettlementPayrollTests

case=SettlementPayrollTests('test_no_finishes_without_creating_payroll_or_reasking')
try:
    case.setUp()
    case.settlement()
    first=case.messenger.drain()
    case.send('launch_payroll_yes')
    second=case.payloads[-1]['messages']
    Path(sys.argv[1]).write_bytes(json.dumps({'first':first,'second':second},ensure_ascii=False).encode('utf-8'))
finally:
    case.doCleanups()
