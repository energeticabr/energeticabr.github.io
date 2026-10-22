"""Exercise real codecs against synthetic bytes; no user media or posting."""
import hashlib
import io
import os
from pathlib import Path
import random
import sys
import unittest

sys.path.insert(0, os.environ["COMPRESSION_BACKEND_SOURCE"])
from compression import AttachmentCompressor, AttachmentCompressionError
from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


class Repository:
    def __init__(self, content):
        self.content = content
        self.replacements = []

    def read(self, attachment):
        return self.content

    def replace(self, attachment, content, **kwargs):
        self.replacements.append(content)
        return {**attachment, **kwargs, "object_name": "candidate"}


def item(name="photo.jpg", **extra):
    return {"object_name": "original", "original_name": name,
            "sharepoint_name": name, "size": 999_999_999, **extra}


def photo_bytes():
    image = Image.frombytes("RGB", (1800, 1200), random.Random(44).randbytes(1800 * 1200 * 3))
    output = io.BytesIO()
    image.save(output, "JPEG", quality=95)
    return output.getvalue()


class BestEffortTests(unittest.TestCase):
    def test_unreachable_image_goal_returns_smallest_useful_candidate(self):
        content = photo_bytes()
        repo = Repository(content)
        result = AttachmentCompressor(repo).compress([item()], 60_000_000, level="very_high")[0]
        self.assertLess(result["size"], len(content))
        self.assertGreater(result["size"], result["compression_target_bytes"])
        self.assertFalse(result["compression_target_met"])
        self.assertEqual(result["original_size"], len(content))
        self.assertEqual(result["compression_target_bytes"], len(content) // 10)
        self.assertEqual(result["compression_reduction_percent"], round((1 - result["size"] / len(content)) * 100, 1))
        with Image.open(io.BytesIO(repo.replacements[0])) as reduced:
            self.assertEqual(reduced.size, (1600, 1066))
        # A literal final useful-resolution/quality encoding is the independently
        # chosen lower bound, rather than calling the production search helper.
        expected = io.BytesIO()
        with Image.open(io.BytesIO(content)) as original:
            original.resize((1600, 1066), Image.Resampling.LANCZOS).save(
                expected, "JPEG", quality=65, optimize=True, progressive=True)
        self.assertEqual(repo.replacements[0], expected.getvalue())
        self.assertEqual(result["sha256"], hashlib.sha256(repo.replacements[0]).hexdigest())

    def test_pdf_goal_miss_still_preserves_text_link_and_geometry(self):
        source = io.BytesIO()
        document = canvas.Canvas(source, pagesize=(600, 800))
        document.drawImage(ImageReader(io.BytesIO(photo_bytes())), 0, 0, width=500, height=400)
        document.drawString(30, 500, "Searchable invoice 12345")
        document.linkURL("https://example.org/invoice/123", (20, 480, 400, 520))
        document.save()
        repo = Repository(source.getvalue())
        result = AttachmentCompressor(repo).compress([item("invoice.pdf")], 60_000_000, level="very_high")[0]
        self.assertFalse(result["compression_target_met"])
        self.assertLess(result["size"], len(repo.content))
        original, candidate = (PdfReader(io.BytesIO(data), strict=True) for data in (repo.content, repo.replacements[0]))
        self.assertEqual(len(candidate.pages), 1)
        self.assertEqual(candidate.pages[0].extract_text(), original.pages[0].extract_text())
        self.assertEqual(candidate.pages[0].mediabox, original.pages[0].mediabox)
        self.assertEqual(str(candidate.pages[0]["/Annots"][0].get_object()["/A"]["/URI"]), "https://example.org/invoice/123")
        self.assertEqual(candidate.pages[0].images[0].image.size, (1800, 1200))

    def test_reachable_goal_reports_actual_bytes_not_stale_metadata(self):
        repo = Repository(b"compressible text\n" * 1000)
        result = AttachmentCompressor(repo).compress([item("text.txt")], 60_000_000, level="high")[0]
        self.assertLessEqual(result["size"], len(repo.content) // 5)
        self.assertTrue(result["compression_target_met"])
        self.assertEqual(result["original_size"], 18_000)

    def test_absolute_cap_is_the_more_restrictive_goal_for_large_file(self):
        repo = Repository(b"x" * 10_000_001)
        result = AttachmentCompressor(repo).compress([item("file.txt")], 60_000_000, level="high")[0]
        self.assertEqual(result["compression_target_bytes"], 1_000_000)
        self.assertLess(result["size"], 1_000_000)
        self.assertTrue(result["compression_target_met"])

    def test_reachable_image_goal_keeps_first_sufficient_quality(self):
        content = photo_bytes()
        repo = Repository(content)
        result = AttachmentCompressor(repo).compress([item()], 60_000_000, level="low")[0]
        self.assertTrue(result["compression_target_met"])
        expected = io.BytesIO()
        with Image.open(io.BytesIO(content)) as original:
            original.save(expected, "JPEG", quality=82, optimize=True, progressive=True)
        self.assertEqual(repo.replacements[0], expected.getvalue(), "no needless quality loss after the restrictive target is reached")

    def test_multi_file_hard_limit_checks_reduced_and_unchanged_files_before_writes(self):
        class BatchRepository(Repository):
            def read(self, attachment):
                return b"x" * 10_000 if attachment["object_name"] == "text" else random.Random(2).randbytes(1000)
        repo = BatchRepository(None)
        attachments = [item("text.txt", object_name="text"), item("random.bin", object_name="random")]
        with self.assertRaisesRegex(AttachmentCompressionError, "limite total"):
            AttachmentCompressor(repo).compress(attachments, 1050, level="high")
        self.assertEqual(repo.replacements, [])

    def test_incompressible_input_keeps_exact_original_without_repository_replacement(self):
        repo = Repository(random.Random(2).randbytes(10_000))
        result = AttachmentCompressor(repo).compress([item("random.bin")], 60_000_000, level="very_high")[0]
        self.assertEqual(result["object_name"], "original")
        self.assertFalse(result["compressed"])
        self.assertFalse(result["compression_target_met"])
        self.assertEqual(result["size"], 10_000)
        self.assertEqual(repo.replacements, [])
        self.assertEqual(result["sha256"], hashlib.sha256(repo.content).hexdigest())

    def test_tiny_original_is_informational_not_a_compression_failure(self):
        repo = Repository(b"X")
        result = AttachmentCompressor(repo).compress([item("tiny.txt")], 60_000_000, level="high")[0]
        self.assertFalse(result["compressed"])
        self.assertFalse(result["compression_target_met"])
        self.assertEqual(result["size"], 1)
        self.assertEqual(repo.replacements, [])

    def test_empty_file_remains_an_error(self):
        repo = Repository(b"")
        with self.assertRaisesRegex(AttachmentCompressionError, "vazio"):
            AttachmentCompressor(repo).compress([item()], 60_000_000, level="high")
        self.assertEqual(repo.replacements, [])

    def test_hard_total_limit_still_blocks_before_any_replacement(self):
        repo = Repository(photo_bytes())
        with self.assertRaisesRegex(AttachmentCompressionError, "limite total"):
            AttachmentCompressor(repo).compress([item()], 10, level="very_high")
        self.assertEqual(repo.replacements, [])

    def test_signed_pdf_remains_untouched(self):
        writer, output = PdfWriter(), io.BytesIO()
        writer.add_blank_page(600, 800)
        writer.add_metadata({"/Keywords": "Energetico assinatura registro abc123"})
        writer.write(output)
        repo = Repository(output.getvalue())
        with self.assertRaisesRegex(AttachmentCompressionError, "assinatura|evidência"):
            AttachmentCompressor(repo).compress([item("signed.pdf")], 60_000_000, level="high")
        self.assertEqual(repo.replacements, [])

    def test_invalid_level_remains_an_error(self):
        repo = Repository(b"original")
        with self.assertRaises(ValueError):
            AttachmentCompressor(repo).compress([item()], 60_000_000, level="unknown")
        self.assertEqual(repo.replacements, [])

    def test_legacy_no_level_path_is_unchanged(self):
        repo = Repository(b"original")
        result = AttachmentCompressor(repo).compress([item()], 60_000_000)[0]
        self.assertEqual(result["object_name"], "original")
        self.assertEqual(result["size"], 8)
        self.assertEqual(repo.replacements, [])


if __name__ == "__main__":
    unittest.main()
