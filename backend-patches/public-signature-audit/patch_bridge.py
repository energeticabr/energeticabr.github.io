"""Apply a narrow audited patch; reject changed or already-patched anchors."""
from pathlib import Path
import sys


def patch(source):
    crlf = "\r\n" in source
    source = source.replace("\r\n", "\n")
    changes = [
        ('from signature_evidence import EvidenceConflict, SignatureEvidenceStore',
         'from signature_evidence import EvidenceConflict\nfrom signature_audit import AuditedSignatureEvidenceStore as SignatureEvidenceStore\nfrom signature_public import process_public, process_capture'),
        ('    def do_GET(self):\n        path = urlsplit(self.path).path\n',
         '    def do_GET(self):\n        path = urlsplit(self.path).path\n        if path.startswith("/assinaturas/"):\n            return process_public(self)\n'),
        ('    def _process_signature_evidence(self):\n        origin = self.headers.get("Origin", "")\n',
         '    def _process_signature_evidence(self):\n        query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)\n        if query.get("operation") == ["capture"]:\n            return process_capture(self, portal_origin_allowed)\n        origin = self.headers.get("Origin", "")\n'),
        ('                    document_id=query.get("document_id", [""])[0], signer_name=query.get("signer_name", [""])[0],\n',
         '                    document_id=query.get("document_id", [""])[0], signer_name=query.get("signer_name", [""])[0],\n                    public_verification=query.get("public_verification", [""])[0] == "true",\n'),
    ]
    for before, after in changes:
        if source.count(before) != 1:
            raise RuntimeError("Bridge alterado; âncora ausente ou duplicada")
        source = source.replace(before, after)
    return source.replace("\n", "\r\n") if crlf else source


if __name__ == "__main__":
    original, output = map(Path, sys.argv[1:])
    output.write_bytes(patch(original.read_bytes().decode("utf-8")).encode("utf-8"))
