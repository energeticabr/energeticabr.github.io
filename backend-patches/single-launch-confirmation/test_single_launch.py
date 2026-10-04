"""Exercise single confirmation through the real, authenticated portal in a sandbox."""
import copy
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(os.environ["SINGLE_LAUNCH_SOURCE"]).resolve()
sys.path[:0] = [str(ROOT), str(ROOT / "worker"), str(ROOT / "tests")]
if os.environ.get("SINGLE_LAUNCH_TESTS"):
    sys.path.insert(0, os.environ["SINGLE_LAUNCH_TESTS"])
import test_portal_launch_preview as portal


class SingleLaunchTests(portal.PortalLaunchPreviewTests):
    def single(self, quantity="2", price="10,50", freight="5"):
        state = self.seed_state()
        state.update(flow="launch", stage="awaiting_confirmation", batch_id="single-test",
                     answers={"tipo_lancamento": "LANÇAMENTO ÚNICO"},
                     fields={"PRODUTO": "CIMENTO", "UN": "SC", "QUANTIDADE": quantity,
                             "VALOR UNITÁRIO": price, "FRETE": freight}, display_values={})
        self.save(state)
        return state

    def test_single_confirmation_projects_four_amounts_without_writes(self):
        state = self.single()
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob("*") if p.is_file()}
        with patch.object(self.bridge.engine, "handle", side_effect=AssertionError("no submission")):
            active = self.preview()
        self.assertIn("launches", active)
        line = active["launches"]["lines"][0]
        self.assertEqual([line[key] for key in ("unitPrice", "quantity", "freight", "total")],
                         ["10.5", "2", "5", "26"])
        self.assertEqual(active["launches"]["count"], 1)
        self.assertNotIn("editReply", line)
        self.assertNotIn("deleteReply", line)
        self.assertEqual({p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob("*") if p.is_file()}, before)
        total = next(row["value"] for row in active["rows"] if row["label"] == "VALOR TOTAL DO PEDIDO")
        self.assertEqual(total, "R$ 26,00")
        if os.environ.get("SINGLE_LAUNCH_FIXTURE"):
            Path(os.environ["SINGLE_LAUNCH_FIXTURE"]).write_text(json.dumps(active, ensure_ascii=False), encoding="utf-8")

    def test_single_money_total_matches_confirmation_rounding_without_rounding_unit_price(self):
        for quantity, price, freight, unit, expected in (
            ("3", "175,3333333", "12,50", "175.3333333", "538.5"),
            ("1", "1,005", "0", "1.005", "1.01"),
            ("1,5", "10,125", "0,005", "10.125", "15.19"),
            ("1", "0", "0", "0", "0"),
        ):
            with self.subTest(expected=expected):
                self.single(quantity, price, freight)
                active = self.preview()
                self.assertIn("launches", active)
                line = active["launches"]["lines"][0]
                self.assertEqual(line["unitPrice"], unit)
                self.assertEqual(line["total"], expected)
                self.assertEqual(active["launches"]["total"], expected)
                summary = next(row["value"] for row in active["rows"] if row["label"] == "VALOR TOTAL DO PEDIDO")
                self.assertEqual(line["totalDisplay"], summary)

    def test_single_preview_rejects_stale_captured_multiple_lines(self):
        state = self.single()
        state["launch_lines"] = [self.line("OLD", "9", "100", "0")]
        self.save(state)
        self.assertNotIn("launches", self.preview())

    def test_single_confirmation_rejects_multiple_line_commands_even_with_valid_revision(self):
        from launch_line_controls import action_revision, handle_launch_line_action
        state = self.single()
        before = copy.deepcopy(state)
        for kind in ("edit", "delete"):
            with self.subTest(kind=kind), patch.object(self.bridge.engine, "_mark_processed", side_effect=AssertionError("command passed mutation guard")):
                result = handle_launch_line_action(self.bridge.engine, {
                    "message_id": "forged-" + kind,
                    "reply_id": "launch_line:" + kind + ":" + action_revision(state) + ":1",
                }, state, None)
                self.assertEqual(result["status"], "obsolete_launch_line")
                self.assertEqual(state, before)

    def test_single_preview_is_absent_outside_confirmation_and_for_invalid_amounts(self):
        state = self.single()
        for stage in ("selecting_fields", "awaiting_edit_value", "summarizing", "completed", "cancelled", "expired"):
            with self.subTest(stage=stage):
                state["stage"] = stage
                self.save(state)
                self.assertNotIn("launches", self.preview() or {})
        state["stage"] = "awaiting_confirmation"
        for field in ("QUANTIDADE", "VALOR UNITÁRIO", "FRETE"):
            invalid = copy.deepcopy(state)
            invalid["fields"][field] = "INVALID"
            self.save(invalid)
            self.assertNotIn("launches", self.preview())


if __name__ == "__main__":
    unittest.main()
