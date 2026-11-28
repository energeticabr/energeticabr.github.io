from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest

from collect_updates import dda_completion, fiscal_completion, publish
from financial_report_updates import add_report_update


NOW = datetime(2026, 11, 28, tzinfo=timezone.utc)
STAMP = "2026-11-27T22:36:31Z"


class UpdateTests(unittest.TestCase):
    def test_dda_uses_confirmed_collector_receipts_only(self):
        usec = str(int(datetime.fromisoformat(STAMP.replace("Z", "+00:00")).timestamp()) * 10**6)
        receipt = {"status": "succeeded", "origin": "Scheduled", "failed": 0,
                   "created": 1, "updated": 0, "verified": 1}
        entry = {"__REALTIME_TIMESTAMP": usec, "MESSAGE": json.dumps(receipt)}
        self.assertEqual(dda_completion([json.dumps(entry)], NOW).isoformat(), "2026-11-27T22:36:31+00:00")
        for override in ({"status": "failed"}, {"origin": "Retry"}, {"verified": 0}, {"failed": 1}):
            bad = dict(entry, MESSAGE=json.dumps(receipt | override))
            self.assertIsNone(dda_completion([json.dumps(bad)], NOW))
        self.assertIsNone(dda_completion([json.dumps(dict(entry, __REALTIME_TIMESTAMP="9999999999999999"))], NOW))

    def test_fiscal_counts_delivery_and_completion_but_ignores_retries(self):
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            config = root / "company.json"
            config.write_text(json.dumps({"companyCnpj": "11111111111111", "environment": "1"}), encoding="utf-8")
            nfse = root / "SefazAuxLive" / "11111111111111-1" / "NFSE" / "logs"
            nfe = root / "SefazLive" / "11111111111111-1"
            nfse.mkdir(parents=True)
            nfe.mkdir(parents=True)
            invoice = {"version": 2, "coverageVerified": True, "status": "COMPLETED",
                       "completedAt": "2026-11-27T21:12:29Z", "responseStatus": "137"}
            (nfe / "completed-collection.json").write_text(json.dumps(invoice), encoding="utf-8")
            event = {"timestamp": "2026-11-27T22:36:31.1234567+00:00", "source": "NFSE", "code": "DELIVERY_CONFIRMED", "documents": 1}
            later = dict(event, timestamp="2026-11-27T23:01:00Z", code="AUX_DELIVERY_FAILED")
            staged = dict(later, code="RESPONSE_STAGED")
            wrong_source = dict(later, code="SLOT_COMPLETED", source="CTE")
            log = nfse / "worker.jsonl"
            log.write_text("\n".join(map(json.dumps, [event, later, staged, wrong_source])) + "\n{truncated", encoding="utf-8")
            self.assertEqual(fiscal_completion(root, NOW, config).isoformat(), "2026-11-27T22:36:31.123456+00:00")
            log.unlink()
            self.assertEqual(fiscal_completion(root, NOW, config).isoformat(), "2026-11-27T21:12:29+00:00")
            logs = nfe.parent / "logs"
            logs.mkdir()
            nf_event = {"at": "2026-11-27T23:21:29.2000001+00:00", "status": "ACKNOWLEDGED", "documents": 1}
            (logs / "worker-20261127.jsonl").write_text(json.dumps(nf_event), encoding="utf-8")
            self.assertEqual(fiscal_completion(root, NOW, config).isoformat(), "2026-11-27T23:21:29.200000+00:00")

    def test_marker_is_monotonic_and_exposes_only_the_selected_date(self):
        with tempfile.TemporaryDirectory() as work:
            path = Path(work) / "latest.json"
            stamp = datetime.fromisoformat("2026-11-27T22:36:31+00:00")
            publish(path, {"fiscal": stamp, "dda": None}, NOW)
            old = datetime(2026, 11, 26, tzinfo=timezone.utc)
            publish(path, {"fiscal": old, "dda": old}, NOW)
            result = {"status": "processed", "sefazRefresh": {"status": "pending", "requests": []}}
            add_report_update(result, "fiscal", path)
            self.assertEqual(result["sefazRefresh"]["lastReportUpdateUtc"], stamp.isoformat())
            self.assertEqual(set(result["sefazRefresh"]), {"status", "requests", "lastReportUpdateUtc"})
            failed = {"sefazRefresh": {"status": "failed"}}
            add_report_update(failed, "fiscal", path)
            self.assertEqual(failed, {"sefazRefresh": {"status": "failed"}})
            path.unlink()
            add_report_update(result, "fiscal", path)
            self.assertEqual(result["sefazRefresh"]["lastReportUpdateUtc"], stamp.isoformat())


if __name__ == "__main__":
    unittest.main()
