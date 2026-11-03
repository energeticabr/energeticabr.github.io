# Production compression methods captured before the recovery fix, 2026-11-03.
import io
from PIL import Image, ImageOps
class DiaryEvidenceError(RuntimeError): pass
class ConstructionDiaryEvidenceBuilder:
    @staticmethod
    def _rgb_image(content: bytes) -> Image.Image:
        try:
            opened = Image.open(io.BytesIO(content))
            opened.load()
            image = ImageOps.exif_transpose(opened)
            if image.mode in {"RGBA", "LA"} or (
                image.mode == "P" and "transparency" in image.info
            ):
                rgba = image.convert("RGBA")
                background = Image.new("RGB", rgba.size, "white")
                background.paste(rgba, mask=rgba.getchannel("A"))
                image = background
            else:
                image = image.convert("RGB")
            opened.close()
            return image
        except Exception as exc:
            raise DiaryEvidenceError("A foto recebida não pôde ser lida") from exc

    @staticmethod
    def _encode_jpeg(image: Image.Image, quality: int) -> bytes:
        output = io.BytesIO()
        image.save(
            output,
            format="JPEG",
            quality=quality,
            optimize=True,
            progressive=True,
        )
        return output.getvalue()

    def _compress_image_bytes(self, content: bytes, target_bytes: int) -> bytes:
        image = self._rgb_image(content)
        original_width, original_height = image.size
        best = b""
        attempts = (
            (1.00, 82),
            (0.90, 76),
            (0.80, 70),
            (0.70, 64),
            (0.60, 58),
            (0.50, 50),
            (0.42, 44),
            (0.34, 38),
            (0.27, 32),
            (0.21, 27),
            (0.16, 23),
            (0.12, 19),
            (0.09, 16),
            (0.06, 13),
        )
        try:
            for scale, quality in attempts:
                width = max(80, int(original_width * scale))
                height = max(80, int(original_height * scale))
                width = min(width, original_width)
                height = min(height, original_height)
                rendered = (
                    image
                    if (width, height) == image.size
                    else image.resize((width, height), Image.Resampling.LANCZOS)
                )
                encoded = self._encode_jpeg(rendered, quality)
                if not best or len(encoded) < len(best):
                    best = encoded
                if len(encoded) <= target_bytes:
                    return encoded
        finally:
            image.close()
        if best and len(best) <= target_bytes:
            return best
        raise DiaryEvidenceError(
            f"Não foi possível reduzir a foto para até {target_bytes // 1000} KB"
        )

