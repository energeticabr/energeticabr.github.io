"""Exercise the deployed builder's real compression algorithm before/after patch."""
import ast
import io
import os
from pathlib import Path
import unittest
from PIL import Image
from patch_backend import patch_builder

class PhotoBudgetTests(unittest.TestCase):
    def test_large_camera_photo_is_sized_before_expensive_jpeg_encoding(self):
        path = Path(os.environ.get('DIARY_BUILDER_SOURCE', Path(__file__).with_name('photo_builder_before.py')))
        source = path.read_text(encoding='utf-8')
        if 'DIARY_BUILDER_SOURCE' not in os.environ:
            source = patch_builder(source)
        tree = ast.parse(source)
        method = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == '_compress_image_bytes')
        method.decorator_list = []
        namespace = {'Image': Image, 'DiaryEvidenceError': RuntimeError}
        exec(compile(ast.Module(body=[method], type_ignores=[]), str(path), 'exec'), namespace)
        sizes = []
        class Builder:
            _compress_image_bytes = namespace['_compress_image_bytes']
            def _rgb_image(self, content): return Image.new('RGB', (4284, 5712), '#85746a')
            def _encode_jpeg(self, image, quality):
                sizes.append(image.size)
                result = io.BytesIO(); image.save(result, format='JPEG', quality=quality)
                return result.getvalue()
        content = Builder()._compress_image_bytes(b'camera input', 150000)
        self.assertTrue(all(max(size) <= 1600 for size in sizes), sizes)
        self.assertLessEqual(len(content), 150000)
        with Image.open(io.BytesIO(content)) as image:
            self.assertLess(image.width, image.height)
            self.assertGreaterEqual(image.height, 1000)

    def test_guarded_patch_refuses_reapplication(self):
        source = Path(__file__).with_name('photo_builder_before.py').read_text(encoding='utf-8')
        with self.assertRaises(ValueError): patch_builder(patch_builder(source))

if __name__ == '__main__': unittest.main()
