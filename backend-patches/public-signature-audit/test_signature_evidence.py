"""Exercise evidence through real HTTP and real PDF bytes; fake external Graph only."""
import hashlib
import io
import json
import os
import stat
import sys
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from unittest.mock import patch

from pypdf import PdfWriter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from channel_bridge import BridgeHandler, PortalUploadStore, PortalMediaStore


def pdf(label="original", record_id="", keyword_prefix=""):
    writer = PdfWriter()
    writer.add_blank_page(width=300, height=400)
    writer.add_metadata({"/Title": label})
    if record_id:
        writer.add_metadata({"/Keywords": keyword_prefix + "Energetico assinatura registro " + record_id})
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


class ExternalAuth:
    allowed_emails = {"actor@example.com", "other@example.com"}

    def authenticate(self, token):
        if token == "Bearer actor":
            return {"oid": "actor-oid", "email": "actor@example.com", "name": "Conta Autenticada"}
        if token == "Bearer other":
            return {"oid": "other-oid", "email": "other@example.com", "name": "Outra Conta"}
        raise PermissionError("Unauthorized")


class ExternalBridge:
    def portal_authorize(self, identity, *, allowed_emails):
        if identity["email"] not in allowed_emails:
            raise PermissionError("Unauthorized")


class SignatureEvidenceHTTPTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.handler = type("EvidenceHandler", (BridgeHandler,), {
            "portal_authenticator": ExternalAuth(), "bridge": ExternalBridge(),
            "portal_origins": {"https://app.example.com"}, "token": "",
            "portal_upload_store": PortalUploadStore(data_root=self.root),
            "portal_media_store": PortalMediaStore(data_root=self.root),
        })
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self.handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.original, self.final = pdf(), pdf("final")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def request(self, operation="prepare", data=None, token="actor", message="request-1", filename="original.pdf", **query):
        url = f"http://127.0.0.1:{self.server.server_port}/portal/signature-evidence?" + urlencode({"operation": operation, **query})
        req = Request(url, data=self.original if data is None else data, method="POST", headers={
            "Origin": "https://app.example.com", "Authorization": "Bearer " + token,
            "Content-Type": "application/pdf", "X-Portal-File-Name": filename,
            "X-Portal-Message-Id": message,
        })
        try:
            response = urlopen(req)
        except HTTPError as exc:
            response = exc
        with response:
            return response.status, json.loads(response.read()), response.headers

    def prepare(self):
        status, result, _ = self.request(signer_name="Nome da assinatura", document_id="client-only-ref")
        self.assertEqual(status, 200, result)
        self.final = pdf("final", result["id"])
        self.changed = pdf("different final", result["id"])
        return result

    def test_server_account_time_hash_and_preserved_snapshots(self):
        before = datetime.now(timezone.utc)
        result = self.prepare()
        self.assertRegex(result["id"], r"^[0-9a-f]{32}$")
        self.assertEqual(result["actorName"], "Conta Autenticada")
        self.assertEqual(result["actorEmail"], "actor@example.com")
        self.assertEqual(result["sourceSha256"], hashlib.sha256(self.original).hexdigest())
        signed_at = datetime.fromisoformat(result["signedAt"].replace("Z", "+00:00"))
        self.assertLessEqual(before, signed_at)
        self.assertLessEqual(signed_at, datetime.now(timezone.utc))
        status, confirmed, _ = self.request("finalize", self.final, record_id=result["id"])
        self.assertEqual(status, 200, confirmed)
        self.assertEqual(confirmed["status"], "confirmed")
        self.assertEqual(confirmed["signedAt"], result["signedAt"])
        self.assertGreaterEqual(datetime.fromisoformat(confirmed["confirmedAt"].replace("Z", "+00:00")), signed_at)
        self.assertEqual(confirmed["finalSha256"], hashlib.sha256(self.final).hexdigest())
        self.assertRegex(confirmed["mediaUrl"], r"^/api/portal-media/[0-9a-f]{32}$")
        self.assertEqual(confirmed["fileName"], "original.pdf")
        req = Request(f"http://127.0.0.1:{self.server.server_port}" + confirmed["mediaUrl"], headers={"Origin": "https://app.example.com", "Authorization": "Bearer actor"})
        with urlopen(req) as response:
            self.assertEqual(response.read(), self.final)
        snapshots = [p.read_bytes() for p in (self.root / "signature-evidence").rglob("*.pdf")]
        self.assertCountEqual(snapshots, [self.original, self.final])
        self.assertFalse(list((self.root / "portal-uploads").glob("*")))
        self.assertNotIn(str(self.root), json.dumps(confirmed))

    def test_prepare_retry_persists_across_store_restart_and_conflicts_fail_closed(self):
        first = self.prepare()
        self.handler.portal_signature_evidence_store = None
        self.assertEqual(self.prepare(), first)
        status, _, _ = self.request(data=self.final, signer_name="Nome da assinatura", document_id="client-only-ref")
        self.assertEqual(status, 409)

    def test_final_is_append_only_and_matching_retry_keeps_confirmation_time(self):
        record = self.prepare()
        status, first, _ = self.request("finalize", self.final, record_id=record["id"])
        self.assertEqual(status, 200, first)
        retry = self.request("finalize", self.final, record_id=record["id"])[1]
        self.assertEqual({k: v for k, v in retry.items() if k != "mediaUrl"}, {k: v for k, v in first.items() if k != "mediaUrl"})
        self.assertEqual(self.request("finalize", self.changed, record_id=record["id"])[0], 409)
        self.assertEqual(self.request("verify", self.final, record_id=record["id"])[1]["matches"], True)
        self.assertEqual(self.request("verify", self.original, record_id=record["id"])[1]["matches"], False)

    def test_owner_binding_unauthenticated_and_traversal_rejected(self):
        record = self.prepare()
        for operation in ("finalize", "verify"):
            self.assertIn(self.request(operation, self.final, token="other", record_id=record["id"])[0], (401, 403))
            self.assertIn(self.request(operation, self.final, record_id="../outside")[0], (400, 422))
        self.assertEqual(self.request(token="invalid")[0], 401)
        self.assertIn(self.request(filename="..%2Fescape.pdf", message="other")[0], (400, 422))

    def test_invalid_pdf_and_missing_idempotency_key_are_rejected(self):
        for content in (b"hello", b"%PDF-1.7\ninvalid\n%%EOF", b"", pdf()[:-30]):
            self.assertIn(self.request(data=content)[0], (400, 422))
        self.assertIn(self.request(message="")[0], (400, 422))
        self.assertFalse(list((self.root / "signature-evidence").rglob("*.pdf")))

    def test_cors_preflight_exposes_existing_upload_headers(self):
        req = Request(f"http://127.0.0.1:{self.server.server_port}/portal/signature-evidence", method="OPTIONS", headers={"Origin": "https://app.example.com"})
        try:
            response = urlopen(req)
        except HTTPError as exc:
            response = exc
        with response:
            self.assertEqual(response.status, 204)
            self.assertIn("X-Portal-Message-Id", response.headers["Access-Control-Allow-Headers"])

    def test_unconfirmed_record_is_not_reported_as_verified(self):
        record = self.prepare()
        self.assertEqual(self.request("verify", self.original, record_id=record["id"])[0], 409)

    def test_preserved_snapshot_tampering_fails_closed(self):
        record = self.prepare()
        status, _, _ = self.request("finalize", self.final, record_id=record["id"])
        self.assertEqual(status, 200)
        snapshots = list((self.root / "signature-evidence").rglob("*.pdf"))
        for snapshot in snapshots:
            original = snapshot.read_bytes()
            snapshot.write_bytes(original + b"tamper")
            self.assertEqual(self.request("verify", self.final, record_id=record["id"])[0], 500)
            snapshot.write_bytes(original)

    def test_metadata_reference_is_not_identity_and_extra_client_claims_are_ignored(self):
        status, record, _ = self.request(signer_name="Assinante informado", document_id="../client-reference", actor_name="Spoof", signedAt="2000-01-01T00:00:00Z")
        self.assertEqual(status, 200, record)
        self.assertEqual(record["actorName"], "Conta Autenticada")
        self.assertNotEqual(record["signedAt"], "2000-01-01T00:00:00Z")
        metadata_files = list((self.root / "signature-evidence").rglob("*.json"))
        metadata = json.loads(metadata_files[0].read_text(encoding="utf-8"))
        self.assertEqual(metadata["signerName"], "Assinante informado")
        self.assertEqual(metadata["documentReference"], "../client-reference")
        self.assertEqual(metadata["sourceProvenance"], "client-upload-snapshot")

    def test_pdf_file_extension_and_encrypted_pdf_rejected(self):
        self.assertIn(self.request(filename="document.txt")[0], (400, 422))
        writer = PdfWriter()
        writer.add_blank_page(width=300, height=400)
        writer.encrypt("secret")
        output = io.BytesIO()
        writer.write(output)
        self.assertIn(self.request(data=output.getvalue())[0], (400, 422))

    def test_prepare_key_is_bound_to_user_and_metadata_cannot_be_replaced(self):
        record = self.prepare()
        self.assertEqual(self.request(signer_name="Other signer", document_id="client-only-ref")[0], 409)
        status, other, _ = self.request(token="other", signer_name="Nome da assinatura", document_id="client-only-ref")
        self.assertEqual(status, 200, other)
        self.assertNotEqual(other["id"], record["id"])

    def test_parallel_finalize_conflicting_pdfs_commit_only_one(self):
        record = self.prepare()
        results = []
        barrier = threading.Barrier(2)

        def finalize(content):
            barrier.wait()
            results.append((content, self.request("finalize", content, record_id=record["id"])[0]))

        threads = [threading.Thread(target=finalize, args=(content,)) for content in (self.changed, self.final)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertCountEqual([status for _, status in results], [200, 409])
        winner = next(content for content, status in results if status == 200)
        self.assertTrue(self.request("verify", winner, record_id=record["id"])[1]["matches"])

    def test_final_pdf_must_contain_its_record_marker(self):
        record = self.prepare()
        self.assertEqual(self.request("finalize", self.original, record_id=record["id"])[0], 422)
        self.assertEqual(self.request("finalize", pdf("wrong", "a" * 32), record_id=record["id"])[0], 422)
        self.assertEqual(self.request("finalize", self.final, record_id=record["id"])[0], 200)

    def test_existing_pdf_keywords_are_preserved_with_protocol_marker(self):
        record = self.prepare()
        final = pdf("final", record["id"], "Contrato Energetica ")
        status, result, _ = self.request("finalize", final, record_id=record["id"])
        self.assertEqual(status, 200, result)

    def test_failed_atomic_commit_leaves_no_partial_record_and_retry_succeeds(self):
        # Catch exposing a prepared directory before all snapshot files are durable.
        # HTTP bytes can reach the client before the handler's finally runs.
        cleaned = threading.Event()
        remove = self.handler.portal_upload_store.remove
        def complete_cleanup(upload):
            remove(upload)
            cleaned.set()
        with patch.object(self.handler.portal_upload_store, 'remove', side_effect=complete_cleanup):
            with patch("signature_evidence.os.rename", side_effect=OSError("disk unavailable")):
                self.assertEqual(self.request()[0], 500)
            self.assertTrue(cleaned.wait(2), 'Upload cleanup did not finish')
        self.assertFalse(list((self.root / "signature-evidence").iterdir()))
        self.assertFalse(list((self.root / "portal-uploads").iterdir()))
        record = self.prepare()
        with patch("signature_evidence.os.rename", side_effect=OSError("disk unavailable")):
            self.assertEqual(self.request("finalize", self.final, record_id=record["id"])[0], 500)
        self.assertCountEqual([p.name for p in (self.root / "signature-evidence" / record["id"]).iterdir()], ["original.pdf", "prepared.json"])
        self.assertEqual(self.request("verify", self.final, record_id=record["id"])[0], 409)
        self.assertEqual(self.request("finalize", self.final, record_id=record["id"])[0], 200)

    def test_download_token_is_bound_to_authenticated_account(self):
        # Catch a public link or owner-free media registration.
        record = self.prepare()
        status, result, _ = self.request("finalize", self.final, record_id=record["id"])
        self.assertEqual(status, 200, result)
        req = Request(f"http://127.0.0.1:{self.server.server_port}" + result["mediaUrl"], headers={"Origin": "https://app.example.com", "Authorization": "Bearer other"})
        with self.assertRaises(HTTPError) as denied:
            urlopen(req)
        self.assertEqual(denied.exception.code, 401)

    @unittest.skipUnless(os.name == "posix", "POSIX permission modes are verified on Linux")
    def test_evidence_directories_and_files_are_private(self):
        # Catch omission of 0700 directories or 0600 snapshot/metadata files.
        record = self.prepare()
        self.assertEqual(self.request("finalize", self.final, record_id=record["id"])[0], 200)
        root = self.root / "signature-evidence"
        self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o700)
        for path in root.rglob("*"):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700 if path.is_dir() else 0o600)


if __name__ == "__main__":
    unittest.main()
