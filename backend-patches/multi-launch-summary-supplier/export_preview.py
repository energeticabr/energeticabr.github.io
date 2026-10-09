"""Generate real confirmation PNGs from synthetic item snapshots, offline only."""
import json
import os
from pathlib import Path
import sys

from test_summary_supplier import SummarySupplierTests
from summary_cards import SummaryCardBuilder

case = SummarySupplierTests("test_same_product_keeps_each_supplier_next_to_its_item")
case.setUp()
output = Path(sys.argv[1]).resolve()
case.engine.summary_builder = SummaryCardBuilder(output)
case.current["launch_lines"] = [case.line("FORNECEDOR TESTE A", "2", "10"),
                                case.line("FORNECEDOR TESTE B", "3", "20"),
                                case.line("FORNECEDOR TESTE C", "1", "15")]
card = case.engine._send_summary_card(case.current)
print(json.dumps({key: card[key] for key in ("path", "filename", "width", "height", "rows")}, ensure_ascii=False))
