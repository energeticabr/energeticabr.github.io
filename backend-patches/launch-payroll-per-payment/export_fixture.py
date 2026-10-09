"""Export actual channel responses from a synthetic end-to-end workflow, never live data."""
import json
from pathlib import Path
import sys
from test_per_payment import PerPaymentTests

case = PerPaymentTests("test_same_supplier_two_independent_sheets_are_persisted_on_the_correct_payments")
try:
    case.setUp()
    case.start()
    first = case.payloads[-1]["messages"]
    case.choose(31)
    second = case.payloads[-1]["messages"]
    case.assert_current_prompt(902, "R$ 33,00")
    assert [entry.get("IDFOLHA") for entry in case.pending()["selected_entries"]] == [31, None]
    case.choose(32)
    case.send("launch_payroll_type_salary")
    case.send("launch_payroll_type_allowance")
    assert [(row["IDLANCAMENTO"], row["IDFOLHA"]) for row in case.rows()] == [(901, 31), (902, 32)]
    Path(sys.argv[1]).write_text(json.dumps({"first": first, "second": second, "saved_rows": case.rows()},
                                          ensure_ascii=False, indent=2), encoding="utf-8")
finally:
    case.doCleanups()
