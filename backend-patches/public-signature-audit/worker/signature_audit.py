"""Application-sealed evidence. Not an individual certificate or trusted timestamp.

Detailed traces are encrypted at rest. Only explicitly opted-in new records have
an unlisted, bearer-link public receipt. Legacy records keep owner-only access.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import math
import os
import re
import secrets
from urllib.parse import urlsplit

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from pypdf import PdfReader
from PIL import Image
from signature_evidence import SignatureEvidenceStore, EvidenceConflict, EvidenceCorrupt, _text, _utc_now


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def b64(value):
    return base64.b64encode(value).decode("ascii")


def ink_pixels(value):
    try:
        raw = base64.b64decode(value['inkImageBase64'], validate=True)
        if not 0 < len(raw) <= 1024 * 1024 or hashlib.sha256(raw).hexdigest() != value['inkSha256']:
            raise ValueError('Imagem da assinatura divergente')
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in {'PNG', 'JPEG'} or image.width * image.height > 4000000:
                raise ValueError('Imagem da assinatura inválida')
            image.load()
            return pixels_hash(image)
    except Exception as exc:
        raise ValueError('Imagem da assinatura inválida') from exc


def pixels_hash(image):
    pixels = bytearray(image.convert('RGBA').tobytes())
    # RGB under fully transparent pixels has no visible meaning and can be
    # discarded by PDF encoders. Preserve all visible color and alpha bytes.
    for index in range(0, len(pixels), 4):
        if pixels[index + 3] == 0:
            pixels[index:index + 3] = b'\x00\x00\x00'
    return hashlib.sha256(canonical([image.width, image.height]) + pixels).hexdigest()


def validate_trace(value):
    if not isinstance(value, dict) or set(value) != {"version", "mode", "durationMs", "truncated", "strokes", "inkSha256", "inkImageBase64"}:
        raise ValueError("Dados de captura inválidos")
    if value["version"] != 1 or value["mode"] not in {"live", "unavailable"} or not isinstance(value["truncated"], bool):
        raise ValueError("Método de captura inválido")
    def number(number, low, high):
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or not low <= number <= high:
            raise ValueError("Amostra de captura inválida")
    number(value["durationMs"], 0, 600000)
    if not re.fullmatch(r"[0-9a-f]{64}", str(value["inkSha256"])):
        raise ValueError("Hash da assinatura inválido")
    ink_pixels(value)
    strokes = value["strokes"]
    if not isinstance(strokes, list) or len(strokes) > 256:
        raise ValueError("Traçados acima do limite")
    count, last_time, pressure, tilt = 0, 0, False, False
    for stroke in strokes:
        if not isinstance(stroke, dict) or set(stroke) != {"input", "points"} or stroke["input"] not in {"pen", "touch", "mouse"}:
            raise ValueError("Traçado inválido")
        if not isinstance(stroke["points"], list) or not stroke["points"]:
            raise ValueError("Traçado vazio")
        for point in stroke["points"]:
            if not isinstance(point, dict) or not {"x", "y", "t"} <= point.keys() or point.keys() - {"x", "y", "t", "pressure", "tiltX", "tiltY"}:
                raise ValueError("Ponto inválido")
            number(point["x"], 0, 1); number(point["y"], 0, 1)
            number(point["t"], last_time, value["durationMs"])
            last_time = point["t"]
            for key in ("pressure", "tiltX", "tiltY"):
                if key in point:
                    if stroke["input"] != "pen":
                        raise ValueError("Dados da caneta sem entrada de caneta")
                    number(point[key], 0 if key == "pressure" else -90, 1 if key == "pressure" else 90)
                    pressure |= key == "pressure"
                    tilt |= key.startswith("tilt")
            count += 1
            if count > 20000:
                raise ValueError("Amostras acima do limite")
    if (value["mode"] == "live") != bool(count) or (not count and value["durationMs"] != 0):
        raise ValueError("Método incompatível com o traçado")
    return {"mode": value["mode"], "pointCount": count, "strokeCount": len(strokes),
        "durationMs": value["durationMs"], "inputs": sorted({s["input"] for s in strokes}),
        "pressureAvailable": pressure, "tiltAvailable": tilt, "truncated": value["truncated"]}


class AuditedSignatureEvidenceStore(SignatureEvidenceStore):
    def _keys(self, *, create=False):
        self._ensure_root()
        target = self.root / ".audit-keys"
        if target.is_symlink():
            raise EvidenceCorrupt("Chaves de auditoria inválidas")
        if not target.exists() and create:
            self._commit_directory(target, {"keys.json": canonical({"signing": b64(Ed25519PrivateKey.generate().private_bytes_raw()),
                "encryption": b64(AESGCM.generate_key(bit_length=256))})})
        try:
            keys = self._json_file(target / "keys.json")
            signing = Ed25519PrivateKey.from_private_bytes(base64.b64decode(keys["signing"], validate=True))
            encryption = AESGCM(base64.b64decode(keys["encryption"], validate=True))
            return signing, encryption
        except Exception as exc:
            raise EvidenceCorrupt("Chaves de auditoria indisponíveis") from exc

    def _seal(self, value):
        key, _ = self._keys()
        public_key = key.public_key().public_bytes_raw()
        return {"algorithm": "Ed25519", "keyId": hashlib.sha256(public_key).hexdigest(),
            "publicKey": b64(public_key), "signature": b64(key.sign(canonical(value)))}

    def _signed(self, value):
        return {**value, "seal": self._seal(value)}

    def _check_seal(self, value):
        try:
            key, _ = self._keys()
            seal = value["seal"]
            public_key = key.public_key().public_bytes_raw()
            if seal["algorithm"] != "Ed25519" or seal["keyId"] != hashlib.sha256(public_key).hexdigest() or seal["publicKey"] != b64(public_key):
                raise ValueError("Chave incorreta")
            key.public_key().verify(base64.b64decode(seal["signature"], validate=True), canonical({k: v for k, v in value.items() if k != "seal"}))
        except Exception as exc:
            raise EvidenceCorrupt("Selo de auditoria não confirmado") from exc

    def _load(self, record_id, owner_oid):
        path, metadata = super()._load(record_id, owner_oid)
        if metadata.get("auditVersion") == 2 or "publicToken" in metadata or "seal" in metadata:
            if metadata.get("auditVersion") != 2:
                raise EvidenceCorrupt("Versão de auditoria inválida")
            self._check_seal(metadata)
        return path, metadata

    @staticmethod
    def _prepared_public(metadata):
        result = SignatureEvidenceStore._prepared_public(metadata)
        if metadata.get("auditVersion") == 2:
            result["verificationUrl"] = metadata["verificationUrl"]
        return result

    def prepare(self, upload, *, identity, message_id, document_id="", signer_name="", public_verification=False):
        if not public_verification:
            return super().prepare(upload, identity=identity, message_id=message_id, document_id=document_id, signer_name=signer_name)
        owner = _text(identity.get("oid"), limit=200, required=True)
        email = _text(identity.get("email"), limit=320, required=True)
        actor = _text(identity.get("name") or "Operador autenticado", limit=500, required=True)
        message = _text(message_id, limit=256, required=True)
        reference = _text(document_id, limit=1000)
        signer = _text(signer_name, limit=500, required=True)
        content = self._pdf_bytes(upload)
        source_hash = hashlib.sha256(content).hexdigest()
        record_id = hashlib.sha256(self._encode([owner, message])).hexdigest()[:32]
        fingerprint = hashlib.sha256(canonical([source_hash, reference, signer, upload.file_name, "public-v2"])).hexdigest()
        path = self._record_path(record_id)
        if not path.exists():
            self._keys(create=True)
            base = os.environ.get("SIGNATURE_VERIFICATION_BASE_URL", "https://163-176-171-217.sslip.io").rstrip("/")
            url = urlsplit(base)
            if url.scheme != "https" or not url.netloc or url.username or url.password or url.query or url.fragment or url.path:
                raise RuntimeError("Endereço de verificação inválido")
            token = secrets.token_hex(32)
            metadata = self._signed({"id": record_id, "ownerOid": owner, "actorName": actor, "actorEmail": email,
                "signedAt": _utc_now(), "sourceSha256": source_hash, "requestSha256": fingerprint,
                "signerName": signer, "documentReference": reference, "sourceProvenance": "client-upload-snapshot",
                "sourceFileName": upload.file_name, "auditVersion": 2, "publicToken": token,
                "verificationUrl": f"{base}/assinaturas/{record_id}/{token}"})
            self._commit_directory(path, {"original.pdf": content, "prepared.json": self._encode(metadata)})
        _, metadata = self._load(record_id, owner)
        if metadata.get("requestSha256") != fingerprint:
            raise EvidenceConflict("Identificador de pedido já usado para outra evidência")
        return self._prepared_public(metadata)

    def _capture(self, path, metadata):
        target = path / "capture"
        if target.is_symlink():
            raise EvidenceCorrupt("Captura inválida")
        if not target.exists():
            raise EvidenceConflict("Captura ainda não registrada")
        capture = self._json_file(target / "capture.json")
        self._check_seal(capture)
        try:
            if capture["id"] != metadata["id"]:
                raise ValueError("Registro diferente")
            _, encryption = self._keys()
            raw = encryption.decrypt(base64.b64decode(capture["nonce"], validate=True),
                base64.b64decode(capture["ciphertext"], validate=True), (metadata["id"] + ":" + metadata["sourceSha256"]).encode())
            if hashlib.sha256(raw).hexdigest() != capture["traceSha256"] or validate_trace(json.loads(raw)) != capture["summary"]:
                raise ValueError("Captura divergente")
        except Exception as exc:
            raise EvidenceCorrupt("Integridade da captura não confirmada") from exc
        return capture

    def capture(self, value, *, record_id, identity):
        path, metadata = self._load(record_id, str(identity.get("oid") or "").strip())
        if metadata.get("auditVersion") != 2:
            raise EvidenceConflict("Registro antigo sem captura pública")
        summary = validate_trace(value)
        raw = canonical(value)
        digest = hashlib.sha256(raw).hexdigest()
        target = path / "capture"
        if not target.exists():
            if (path / "confirmation").exists():
                raise EvidenceConflict("Documento já confirmado")
            _, encryption = self._keys()
            nonce = os.urandom(12)
            cipher = encryption.encrypt(nonce, raw, (record_id + ":" + metadata["sourceSha256"]).encode())
            stored = self._signed({"id": record_id, "receivedAt": _utc_now(), "summary": summary,
                "traceSha256": digest, "inkSha256": value["inkSha256"], "nonce": b64(nonce), "ciphertext": b64(cipher)})
            self._commit_directory(target, {"capture.json": self._encode(stored)})
        capture = self._capture(path, metadata)
        if capture["traceSha256"] != digest:
            raise EvidenceConflict("A captura registrada não pode ser substituída")
        return {**self._prepared_public(metadata), "captureReceivedAt": capture["receivedAt"], "capture": capture["summary"]}

    @staticmethod
    def _claims(metadata, confirmed, capture):
        return {"version": 2, "id": metadata["id"], "signerName": metadata["signerName"],
            "operatorName": metadata["actorName"], "identityMethod": "Nome do assinante informado; operador autenticado no app",
            "preparedAt": metadata["signedAt"], "captureReceivedAt": capture["receivedAt"], "confirmedAt": confirmed["confirmedAt"],
            "clock": "Horário do servidor; sem carimbo de tempo independente", "sourceSha256": metadata["sourceSha256"],
            "finalSha256": confirmed["finalSha256"], "fileName": confirmed["finalFileName"], "traceSha256": capture["traceSha256"],
            "inkSha256": capture["inkSha256"], "inkBinding": "Pixels da imagem conferidos no PDF final pelo servidor",
            "capture": capture["summary"], "sealType": "Selo da aplicação; não é assinatura ICP-Brasil do fornecedor"}

    def _confirmation(self, path, metadata):
        result = super()._confirmation(path, metadata)
        if metadata.get("auditVersion") == 2:
            capture = self._capture(path, metadata)
            confirmed = self._json_file(path / "confirmation" / "confirmed.json")
            self._check_seal(confirmed)
            if confirmed.get("preparedSha256") != hashlib.sha256(canonical(metadata)).hexdigest() or confirmed.get("captureSha256") != capture["traceSha256"]:
                raise EvidenceCorrupt("Vínculo da auditoria não confirmado")
            receipt = confirmed["receipt"]
            claims = self._claims(metadata, confirmed, capture)
            if receipt.get("payload") != claims:
                raise EvidenceCorrupt("Comprovante divergente")
            self._check_seal({**receipt["payload"], "seal": {k: v for k, v in receipt.items() if k != "payload"}})
            result.update(captureReceivedAt=capture["receivedAt"], capture=capture["summary"], receipt=receipt)
        return result

    def finalize(self, upload, *, record_id, identity):
        path, metadata = self._load(record_id, str(identity.get("oid") or "").strip())
        if metadata.get("auditVersion") != 2:
            return super().finalize(upload, record_id=record_id, identity=identity)
        capture = self._capture(path, metadata)
        content = self._pdf_bytes(upload)
        reader = PdfReader(io.BytesIO(content), strict=True)
        marker = f"Energetico assinatura registro {record_id}"
        if not re.search(r"(?:^|[\s,;])" + re.escape(marker) + r"(?=$|[\s,;])", str((reader.metadata or {}).get("/Keywords") or "")):
            raise ValueError("PDF final sem protocolo")
        links = []
        for page in reader.pages:
            for annotation in (page.get("/Annots") or []):
                action = annotation.get_object().get("/A")
                action = action.get_object() if action is not None else {}
                if hasattr(action, "get"):
                    links.append(str(action.get("/URI") or ""))
        if metadata["verificationUrl"] not in links:
            raise ValueError("PDF final sem botão de verificação deste registro")
        _, encryption = self._keys()
        raw_capture = encryption.decrypt(base64.b64decode(capture['nonce'], validate=True),
            base64.b64decode(capture['ciphertext'], validate=True), (record_id + ':' + metadata['sourceSha256']).encode())
        expected_pixels = ink_pixels(json.loads(raw_capture))
        found_image = False
        for page in reader.pages:
            for image in page.images:
                if image.image.width * image.image.height <= 4000000 and pixels_hash(image.image) == expected_pixels:
                    found_image = True
                    break
            if found_image:
                break
        if not found_image:
            raise ValueError('A imagem da assinatura registrada não está no PDF final')
        digest = hashlib.sha256(content).hexdigest()
        target = path / "confirmation"
        if not target.exists():
            confirmed = {"id": record_id, "confirmedAt": _utc_now(), "finalSha256": digest,
                "finalFileName": upload.file_name, "preparedSha256": hashlib.sha256(canonical(metadata)).hexdigest(),
                "captureSha256": capture["traceSha256"]}
            confirmed["receipt"] = {"payload": self._claims(metadata, confirmed, capture), **self._seal(self._claims(metadata, confirmed, capture))}
            self._commit_directory(target, {"final.pdf": content, "confirmed.json": self._encode(self._signed(confirmed))})
        result = self._confirmation(path, metadata)
        if result["finalSha256"] != digest:
            raise EvidenceConflict("O PDF confirmado não pode ser substituído")
        return result

    def public_receipt(self, record_id, token):
        if not re.fullmatch(r"[0-9a-f]{64}", str(token or "")):
            raise FileNotFoundError("Registro não encontrado")
        path = self._record_path(record_id)
        if not path.exists():
            raise FileNotFoundError("Registro não encontrado")
        metadata = self._json_file(path / "prepared.json")
        if metadata.get("auditVersion") != 2 or not hmac.compare_digest(str(metadata.get("publicToken") or ""), token):
            raise FileNotFoundError("Registro não encontrado")
        path, metadata = self._load(record_id, metadata.get("ownerOid"))
        return self._confirmation(path, metadata)["receipt"]
