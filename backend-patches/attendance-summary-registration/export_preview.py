"""Export actual backend messages using fictitious in-memory records."""
import copy
import json
from pathlib import Path
import sys
from test_registration import SummaryRegistrationTests

case = SummaryRegistrationTests()
case.setUp()
try:
    summary = copy.deepcopy(case.c.messenger.sent[-1])
    case.c.reply(reply_id='attendance_batch_register')
    menu = copy.deepcopy(case.c.messenger.sent[-1])
    Path(sys.argv[1]).write_text(json.dumps({'summary': summary, 'menu': menu}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
finally:
    case.doCleanups()
