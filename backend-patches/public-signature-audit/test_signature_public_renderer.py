"""Consume the real public receipt HTML without the live bridge dependencies."""
import copy
import importlib.util
import sys
import types
import unittest
from html.parser import HTMLParser
from pathlib import Path
from unittest.mock import patch


def load_renderer():
    def import_only(*args, **kwargs):
        raise AssertionError("Renderer tests must not call audit or storage dependencies")

    audit = types.ModuleType("signature_audit")
    audit.AuditedSignatureEvidenceStore = import_only
    audit.canonical = import_only
    evidence = types.ModuleType("signature_evidence")
    evidence.EvidenceConflict = type("EvidenceConflict", (Exception,), {})
    source = Path(__file__).parent / "worker" / "signature_public.py"
    spec = importlib.util.spec_from_file_location("_public_receipt_renderer", source)
    module = importlib.util.module_from_spec(spec)
    # These stubs only satisfy imports; public_page and its HTML remain real.
    with patch.dict(sys.modules, {"signature_audit": audit, "signature_evidence": evidence}):
        spec.loader.exec_module(module)
    return module.public_page


public_page = load_renderer()
PUBLIC_PATH = "/assinaturas/0123456789abcdef0123456789abcdef/" + "f" * 64
CAPTURE_PRIVACY_NOTE = (
    "Posições e tempos relativos foram enviados pelo aplicativo. "
    "Movimentos detalhados ficam cifrados e não são divulgados nesta página."
)


class Element:
    def __init__(self, tag, attrs=()):
        self.tag = tag
        self.attrs = dict(attrs)
        self.children = []

    def text(self):
        return "".join(child.text() if isinstance(child, Element) else child for child in self.children)

    def find_all(self, tag=None):
        result = []
        for child in self.children:
            if isinstance(child, Element):
                if tag is None or child.tag == tag:
                    result.append(child)
                result.extend(child.find_all(tag))
        return result


class ReceiptDOM(HTMLParser):
    VOID_ELEMENTS = {"area", "base", "br", "col", "embed", "hr", "img", "input",
                     "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Element("document")
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        element = Element(tag, attrs)
        self.stack[-1].children.append(element)
        if tag not in self.VOID_ELEMENTS:
            self.stack.append(element)

    def handle_endtag(self, tag):
        if self.stack[-1].tag != tag:
            raise AssertionError(f"Unexpected closing tag: {tag}")
        self.stack.pop()

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def render(receipt, path=PUBLIC_PATH):
    page = public_page(receipt, path, "test-nonce")
    dom = ReceiptDOM()
    dom.feed(page)
    dom.close()
    return page, dom.root


def section_named(dom, heading):
    return next(section for section in dom.find_all("section")
                if section.find_all("h2")[0].text() == heading)


class PublicReceiptRendererTests(unittest.TestCase):
    def setUp(self):
        self.receipt = {
            "algorithm": "Ed25519", "keyId": "e" * 64,
            "publicKey": "public-key-fixture", "signature": "signature-fixture",
            "payload": {
                "version": 2, "id": "0123456789abcdef0123456789abcdef",
                "signerName": "Nome do fornecedor", "fileName": "contrato.pdf",
                "operatorName": "Operador autenticado",
                "identityMethod": "Nome do assinante informado; operador autenticado no app",
                "preparedAt": "2026-10-12T12:34:50Z",
                "captureReceivedAt": "2026-10-12T12:34:55Z",
                "confirmedAt": "2026-10-12T12:34:56Z",
                "clock": "Horário do servidor; sem carimbo de tempo independente",
                "sourceSha256": "a" * 64, "finalSha256": "b" * 64,
                "traceSha256": "c" * 64, "inkSha256": "d" * 64,
                "inkBinding": "Pixels da imagem conferidos no PDF final pelo servidor",
                "sealType": "Selo da aplicação; não é assinatura ICP-Brasil do fornecedor",
                "capture": {
                    "mode": "live", "strokeCount": 2, "pointCount": 4,
                    "durationMs": 1200, "inputs": ["pen", "touch"],
                    "pressureAvailable": True, "tiltAvailable": False, "truncated": False,
                },
            },
        }

    def test_download_is_last_content_in_integrity_section(self):
        _, dom = render(self.receipt)
        integrity = section_named(dom, "Integridade e comprovante")
        downloads = integrity.find_all("a")
        self.assertEqual(len(downloads), 1)
        download = downloads[0]
        self.assertEqual(download.text(), "Baixar comprovante assinado")
        self.assertEqual(integrity.find_all()[-1].tag, "a",
                         "The signed receipt download must be the final integrity element")
        self.assertIs(integrity.find_all()[-1], download)
        content = [child for child in integrity.children
                   if isinstance(child, Element) or child.strip()]
        self.assertIsInstance(content[-1], Element)
        self.assertEqual(content[-1].tag, "p")
        self.assertEqual([child for child in content[-1].children
                          if isinstance(child, Element) or child.strip()], [download])
        self.assertTrue(integrity.text().strip().endswith("Baixar comprovante assinado"))

    def test_download_hashes_and_audit_payload_are_preserved(self):
        before = copy.deepcopy(self.receipt)
        _, dom = render(self.receipt)
        self.assertEqual(self.receipt, before)
        integrity = section_named(dom, "Integridade e comprovante")
        download = integrity.find_all("a")[0]
        self.assertEqual(download.attrs, {
            "class": "button", "href": PUBLIC_PATH + "/registro",
            "download": "comprovante-assinatura.json",
        })
        values = {term.text(): value.text() for term, value in
                  zip(integrity.find_all("dt"), integrity.find_all("dd"))}
        self.assertEqual(values, {
            "SHA-256 do PDF original": "a" * 64,
            "SHA-256 do PDF final": "b" * 64,
            "SHA-256 dos dados de captura": "c" * 64,
            "SHA-256 da imagem da assinatura": "d" * 64,
            "Imagem da assinatura no PDF": "Pixels da imagem conferidos no PDF final pelo servidor",
            "Selo do comprovante": "Ed25519 · selo da aplicação Energética",
            "Identificador da chave pública": "e" * 64,
        })

    def test_escaping_and_capture_privacy_note_are_preserved(self):
        self.receipt["payload"].update({
            "signerName": 'Nome <script>perigo</script> & "Filho"',
            "fileName": 'Contrato <img src=x> & "final".pdf',
            "operatorName": "Operador <b>equipe</b>",
            "identityMethod": "Nome <declarado>",
        })
        path = PUBLIC_PATH + '?note="><script>path</script>&x=1'
        page, dom = render(self.receipt, path)
        self.assertIn("Nome &lt;script&gt;perigo&lt;/script&gt; &amp; &quot;Filho&quot;", page)
        self.assertIn("Contrato &lt;img src=x&gt; &amp; &quot;final&quot;.pdf", page)
        self.assertIn("Operador &lt;b&gt;equipe&lt;/b&gt;", page)
        self.assertIn("Nome &lt;declarado&gt;", page)
        for tag in ("script", "img", "b", "declarado"):
            self.assertEqual(dom.find_all(tag), [])
        signer = dom.find_all("section")[0].find_all("h2")[0]
        self.assertEqual(signer.text(), 'Nome <script>perigo</script> & "Filho"')
        download = section_named(dom, "Integridade e comprovante").find_all("a")[0]
        self.assertEqual(download.attrs, {
            "class": "button", "href": path + "/registro",
            "download": "comprovante-assinatura.json",
        })
        capture = section_named(dom, "Dados da captura")
        self.assertEqual([note.text() for note in capture.find_all("p")], [CAPTURE_PRIVACY_NOTE])
        self.assertEqual(capture.find_all("p")[0].attrs, {"class": "note"})


if __name__ == "__main__":
    unittest.main()
