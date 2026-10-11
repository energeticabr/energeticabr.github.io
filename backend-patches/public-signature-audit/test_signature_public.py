"""Catch public access leaks, forged receipts and trace/document replacement."""
import base64
import hashlib
import json
import io
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from test_signature_evidence import SignatureEvidenceHTTPTests, pdf


class PublicSignatureTests(SignatureEvidenceHTTPTests):
    def ink(self):
        from PIL import Image, ImageDraw
        image = Image.new('RGBA', (180, 70), (255, 255, 255, 0))
        ImageDraw.Draw(image).line([(10, 60), (45, 8), (75, 45), (160, 15)], fill=(12, 30, 65, 255), width=3)
        output = io.BytesIO(); image.save(output, format='PNG')
        return output.getvalue()

    def public_prepare(self, with_image=True):
        status, record, _ = self.request(public_verification="true", signer_name="Nome <informado>", message="public-1")
        self.assertEqual(status, 200, record)
        self.assertIn("verificationUrl", record)
        self.final = pdf("final", record["id"])
        # A real link is required for public signatures, not just a metadata marker.
        from pypdf import PdfReader, PdfWriter
        from pypdf.annotations import Link
        import io
        writer = PdfWriter(clone_from=io.BytesIO(self.final))
        if with_image:
            from reportlab.pdfgen import canvas
            from reportlab.lib.utils import ImageReader
            overlay = io.BytesIO(); drawing = canvas.Canvas(overlay, pagesize=(300, 400))
            drawing.drawImage(ImageReader(io.BytesIO(self.ink())), 30, 80, width=180, height=70, mask='auto'); drawing.save()
            writer.pages[0].merge_page(PdfReader(io.BytesIO(overlay.getvalue())).pages[0])
        writer.add_annotation(0, Link(rect=(10, 10, 180, 35), url=record["verificationUrl"]))
        output = io.BytesIO()
        writer.write(output)
        self.final = output.getvalue()
        return record

    def capture(self, record, capture=None):
        data = capture or {"version": 1, "mode": "live", "durationMs": 120,
            "truncated": False, "strokes": [{"input": "pen", "points": [
                {"x": 0.1, "y": 0.2, "t": 0, "pressure": 0.3},
                {"x": 0.3, "y": 0.4, "t": 120, "pressure": 0.8}]}],
            "inkSha256": hashlib.sha256(self.ink()).hexdigest(), "inkImageBase64": base64.b64encode(self.ink()).decode()}
        if 'inkImageBase64' not in data:
            data = {**data, 'inkImageBase64': base64.b64encode(self.ink()).decode(), 'inkSha256': hashlib.sha256(self.ink()).hexdigest()}
        req = Request(f"http://127.0.0.1:{self.server.server_port}/portal/signature-evidence?operation=capture&record_id={record['id']}",
            data=json.dumps(data).encode(), method="POST", headers={"Origin": "https://app.example.com",
                "Authorization": "Bearer actor", "Content-Type": "application/json"})
        try:
            response = urlopen(req)
        except HTTPError as exc:
            response = exc
        with response:
            return response.status, json.loads(response.read())

    def public_get(self, record, suffix="", path=None):
        path = path or urlsplit(record["verificationUrl"]).path + suffix
        try:
            response = urlopen(f"http://127.0.0.1:{self.server.server_port}{path}")
        except HTTPError as exc:
            response = exc
        with response:
            return response.status, response.read(), response.headers

    def test_public_receipt_requires_confirmation_and_no_login(self):
        record = self.public_prepare()
        self.assertEqual(self.public_get(record)[0], 409)
        self.assertEqual(self.capture(record)[0], 200)
        status, final, _ = self.request("finalize", self.final, record_id=record["id"])
        self.assertEqual(status, 200, final)
        status, page, headers = self.public_get(record)
        self.assertEqual(status, 200)
        self.assertIn(b"Nome &lt;informado&gt;", page)
        self.assertIn(hashlib.sha256(self.final).hexdigest().encode(), page)
        self.assertIn("no-store", headers["Cache-Control"])
        self.assertIn("default-src 'none'", headers["Content-Security-Policy"])
        status, raw, _ = self.public_get(record, "/registro")
        receipt = json.loads(raw)
        self.assertEqual(status, 200)
        self.assertEqual(receipt["payload"]["finalSha256"], hashlib.sha256(self.final).hexdigest())
        self.assertEqual(receipt["payload"]["capture"]["pointCount"], 2)
        self.assertTrue(receipt["payload"]["capture"]["pressureAvailable"])
        public = json.dumps(receipt)
        for private in ("actor@example.com", "actor-oid", '"points"', '"ciphertext"'):
            self.assertNotIn(private, public)
        canonical = json.dumps(receipt["payload"], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        key = Ed25519PublicKey.from_public_bytes(base64.b64decode(receipt["publicKey"]))
        key.verify(base64.b64decode(receipt["signature"]), canonical)

    def test_public_operator_without_name_does_not_fall_back_to_email(self):
        with patch.object(self.handler.portal_authenticator, 'authenticate', return_value={'oid': 'actor-oid', 'email': 'actor@example.com'}):
            record = self.public_prepare()
            self.assertEqual(self.capture(record)[0], 200)
            self.assertEqual(self.request('finalize', self.final, record_id=record['id'])[0], 200)
        for suffix in ('', '/registro'):
            status, public, _ = self.public_get(record, suffix)
            self.assertEqual(status, 200)
            self.assertNotIn(b'actor@example.com', public)
            self.assertIn(b'Operador autenticado', public)

    def test_final_requires_the_registered_signature_image_not_just_a_link(self):
        record = self.public_prepare(with_image=False)
        self.assertEqual(self.capture(record)[0], 200)
        self.assertEqual(self.request('finalize', self.final, record_id=record['id'])[0], 422)

    def test_image_hash_must_match_uploaded_image_bytes(self):
        record = self.public_prepare()
        data = {'version': 1, 'mode': 'unavailable', 'durationMs': 0, 'truncated': False, 'strokes': [],
            'inkSha256': '0' * 64, 'inkImageBase64': base64.b64encode(self.ink()).decode()}
        self.assertEqual(self.capture(record, data)[0], 422)

    def test_concurrent_capture_and_finalization_keep_one_immutable_receipt(self):
        from concurrent.futures import ThreadPoolExecutor
        record = self.public_prepare()
        with ThreadPoolExecutor(max_workers=2) as pool:
            captures = list(pool.map(lambda _: self.capture(record), range(2)))
        self.assertEqual(captures[0], captures[1])
        self.assertEqual(captures[0][0], 200)
        with ThreadPoolExecutor(max_workers=2) as pool:
            finals = list(pool.map(lambda _: self.request('finalize', self.final, record_id=record['id']), range(2)))
        self.assertEqual([item[0] for item in finals], [200, 200])
        self.assertEqual(finals[0][1]['confirmedAt'], finals[1][1]['confirmedAt'])
        self.assertEqual(finals[0][1]['receipt'], finals[1][1]['receipt'])

    def test_public_secret_and_legacy_private_records_are_not_discoverable(self):
        private = self.prepare()
        self.assertNotIn("verificationUrl", private)
        record = self.public_prepare()
        path = urlsplit(record["verificationUrl"]).path
        self.assertEqual(self.public_get(record, path=path[:-1] + ("a" if path[-1] != "a" else "b"))[0], 404)
        self.assertEqual(self.public_get(record, path="/assinaturas")[0], 404)

    def test_capture_is_encrypted_append_only_and_required_before_final(self):
        record = self.public_prepare()
        self.assertEqual(self.request("finalize", self.final, record_id=record["id"])[0], 409)
        first = self.capture(record)
        self.assertEqual(first[0], 200, first)
        self.assertEqual(self.capture(record), first)
        changed = {"version": 1, "mode": "unavailable", "durationMs": 0, "strokes": [], "truncated": False, "inkSha256": "b" * 64}
        self.assertEqual(self.capture(record, changed)[0], 409)
        disk = (self.root / "signature-evidence" / record["id"] / "capture" / "capture.json").read_text()
        self.assertNotIn('"points"', disk)
        self.assertEqual(self.request("finalize", self.final, record_id=record["id"])[0], 200)

    def test_public_lookup_fails_closed_on_metadata_or_capture_tampering(self):
        record = self.public_prepare()
        self.assertEqual(self.capture(record)[0], 200)
        self.assertEqual(self.request("finalize", self.final, record_id=record["id"])[0], 200)
        base = self.root / "signature-evidence" / record["id"]
        for file in (base / "prepared.json", base / "capture" / "capture.json", base / "confirmation" / "confirmed.json"):
            original = file.read_bytes()
            changed = json.loads(original)
            changed["tampered"] = True
            file.write_text(json.dumps(changed))
            self.assertEqual(self.public_get(record)[0], 500)
            file.write_bytes(original)

    def test_invalid_capture_does_not_create_evidence(self):
        record = self.public_prepare()
        bad = {"version": 1, "mode": "live", "durationMs": 1, "strokes": [{"input": "pen", "points": [{"x": 2, "y": 0, "t": 0}]}], "inkSha256": "a" * 64, "truncated": False}
        self.assertEqual(self.capture(record, bad)[0], 422)
        self.assertFalse((self.root / "signature-evidence" / record["id"] / "capture").exists())

    def test_public_pdf_must_link_to_its_own_record(self):
        record = self.public_prepare()
        self.assertEqual(self.capture(record)[0], 200)
        self.assertEqual(self.request("finalize", pdf("missing link", record["id"]), record_id=record["id"])[0], 422)
