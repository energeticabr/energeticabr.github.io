import json
import tempfile
import unittest
from pathlib import Path
from dda_sync import Queue, handle_portal

OWNER = {"oid": "owner-oid", "email": "owner@example.test"}
OTHER = {"oid": "other-oid", "email": "other@example.test"}

class QueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.now = 1000
        self.queue = Queue(Path(self.tmp.name), clock=lambda: self.now)
        (Path(self.tmp.name) / "access.json").write_text(json.dumps({"emails": [OWNER["email"]]}))
    def tearDown(self):
        self.tmp.cleanup()
    def test_requires_identity_and_explicit_permission(self):
        for who in ({}, OTHER, {"email": OWNER["email"]}):
            with self.assertRaises(PermissionError):
                self.queue.start(who)
    def test_offline_does_not_enqueue(self):
        self.assertEqual(self.queue.start(OWNER)["status"], "unavailable")
        self.assertIsNone(self.queue.worker("claim").get("job"))
    def test_single_flight_fresh_query_and_verified_result(self):
        self.queue.worker("heartbeat")
        first = self.queue.start(OWNER)
        self.assertEqual(first["status"], "queued")
        self.assertEqual(self.queue.start(OWNER)["requestId"], first["requestId"])
        claimed = self.queue.worker("claim")["job"]
        self.assertEqual(claimed["requestId"], first["requestId"])
        self.assertIsNone(self.queue.worker("claim").get("job"))
        with self.assertRaises(ValueError):
            self.queue.worker("complete", {"requestId": "a"*32, "status": "succeeded"})
        self.queue.worker("complete", {**first, "status": "succeeded", "created": 2, "verified": 16, "updated": 14})
        status = self.queue.status(OWNER, first["requestId"])
        self.assertEqual((status["status"], status["created"]), ("succeeded", 2))
        self.assertNotIn("owner", status)
        self.assertNotEqual(self.queue.start(OWNER)["requestId"], first["requestId"])
    def test_status_is_owner_scoped_even_for_allowed_second_user(self):
        (Path(self.tmp.name)/"access.json").write_text(json.dumps({"emails": [OWNER["email"], OTHER["email"]]}))
        self.queue.worker("heartbeat")
        first = self.queue.start(OWNER)
        with self.assertRaises(PermissionError):
            self.queue.status(OTHER, first["requestId"])
        self.assertEqual(self.queue.start(OTHER)["status"], "busy")
    def test_stale_worker_and_job_expire_without_success(self):
        self.queue.worker("heartbeat")
        job = self.queue.start(OWNER)
        self.queue.worker("claim")
        self.now += 181
        self.assertEqual(self.queue.status(OWNER, job["requestId"])["status"], "failed")
        self.assertEqual(self.queue.start(OWNER)["status"], "unavailable")
    def test_partial_failure_never_succeeds_and_no_arbitrary_data_leaks(self):
        self.queue.worker("heartbeat")
        job = self.queue.start(OWNER)
        self.queue.worker("claim")
        self.queue.worker("complete", {**job, "status": "partial", "secret": "do not retain"})
        self.assertEqual(self.queue.status(OWNER, job["requestId"])["status"], "failed")
        self.assertNotIn("do not retain", (Path(self.tmp.name)/"state.json").read_text())
    def test_rejects_ambiguous_or_extra_portal_input(self):
        for body in ({"action":"dda_refresh","account":"other"}, {"action":"dda_refresh_status","requestId":"bad"}):
            with self.assertRaises(ValueError):
                handle_portal(OWNER, body, queue=self.queue)

    def test_created_ids_are_validated_and_exposed_only_to_owner(self):
        self.queue.worker("heartbeat")
        job = self.queue.start(OWNER)
        self.queue.worker("claim")
        for ids in ([1, 1], [True, 2], [0, 2], ["1", 2], [1], [1, 2147483648], "1,2"):
            with self.assertRaises(ValueError):
                self.queue.worker("complete", {**job, "status": "succeeded", "created": 2, "createdItemIds": ids})
            self.assertEqual(self.queue.status(OWNER, job["requestId"])["status"], "running")
        self.queue.worker("complete", {**job, "status": "succeeded", "created": 2, "createdItemIds": [42, 43], "supplier": "DO NOT RETAIN"})
        result = self.queue.status(OWNER, job["requestId"])
        self.assertEqual(result["createdItemIds"], [42, 43])
        self.assertNotIn("DO NOT RETAIN", (Path(self.tmp.name) / "state.json").read_text())

if __name__ == "__main__":
    unittest.main()
