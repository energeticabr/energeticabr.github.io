import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from nfe_gap_alert import observations, publish


class GapAlerts(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.company = Path(temporary.name)
        self.now = datetime(2026, 11, 14, 14, tzinfo=timezone.utc)

    def put(self, folder, name, value):
        path = self.company / folder / f"{name}.json"
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps(value))

    def gap(self, start, end, age, status="HISTORICAL_RECOVERY_REQUIRED"):
        bounds = f"{start:015d}-{end:015d}"
        self.put("history-gaps", bounds, {
            "status": status, "source": "SEFAZ", "fromExclusive": f"{start:015d}",
            "throughInclusive": f"{end:015d}",
            "recordedAt": (self.now - age).isoformat(),
        })
        return f"NFE-LACUNA-{bounds}"

    def test_threshold_bootstrap_and_recovered(self):
        old = self.gap(1439, 1441, timedelta(hours=12, seconds=1))
        self.gap(1410, 1420, timedelta(hours=12))
        self.gap(0, 1387, timedelta(hours=35))
        done = self.gap(1448, 1450, timedelta(hours=14), "RECOVERED")
        views = observations(self.company, "000000000001387", self.now)
        self.assertEqual({row["Title"]: row["STATUS"] for row in views},
                         {old: "Pending", done: "Completed"})

    def test_cofer_recovered_is_not_reported_as_open(self):
        self.gap(1439, 1441, timedelta(hours=20))
        name = "000000000001441-" + "a" * 32 + ".xml"
        raw = self.company / "history-gap-raw" / name
        raw.parent.mkdir()
        raw.write_bytes(b"<fixture/>")
        self.put("history-gap-receipts", "000000000001441", {
            "status": "138", "nsu": "000000000001441",
            "documentId": "000000000001441-4d377c26abad27d8",
            "rawFile": name, "sha256": sha256(raw.read_bytes()).hexdigest(),
        })
        self.put("archive", "000000000001441-4d377c26abad27d8", {})
        row, = observations(self.company, "", self.now)
        self.assertIn("NSU 1440", row["DETALHES"])
        self.assertNotIn("1441", row["DETALHES"])

    def test_publish_closes_open_record_and_preserves_sent_record(self):
        closed = self.gap(1, 2, timedelta(hours=24), "RECOVERED")
        sent = self.gap(2, 3, timedelta(hours=24))
        self.gap(3, 4, timedelta(hours=24), "RECOVERED")
        rows = observations(self.company, "", self.now)
        class Repository:
            endpoint = "monitor"
            writes = []
            def req(self, method, endpoint, **kwargs):
                return {"value": [
                    {"Id": 1, "Title": closed, "STATUS": "Pending"},
                    {"Id": 2, "Title": sent, "STATUS": "Pending", "ALERTA_ENVIADO_EM": "sent"},
                ]}
            def upsert(self, observation, now):
                self.writes.append(observation)
        repository = Repository()
        publish(repository, rows, self.now)
        self.assertEqual([(row["Title"], row["STATUS"]) for row in repository.writes],
                         [(closed, "Completed")])


if __name__ == "__main__":
    unittest.main()
