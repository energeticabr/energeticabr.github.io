"""Exact-source, bounded patch. Never loads credentials, user media or state."""
import ast
import hashlib
from pathlib import Path
import sys
import textwrap

BEFORE = {
    "worker/compression.py": "138515fe0004e304f990f1eb90d4623214538c14c26de27767819264b78af517",
    "channel_bridge.py": "41cff91d025485cbe13cf73fbc8228598ce74e9b8510593f1b776e13802642aa",
    "worker/workflow.py": "aac994185f7b6b540f32497ba79a87bb692509eb087db7c7e4598413d2a3aefd",
}

COMPRESS_AT_LEVEL = '''
def _compress_at_level(self, attachments, max_total_bytes, level):
    if level not in self.LEVELS:
        raise ValueError("Nível de compactação inválido")
    if max_total_bytes <= 0:
        raise ValueError("O limite total de anexos deve ser maior que zero")
    cap, reduction = self.LEVELS[level]
    deadline = time.monotonic() + self.max_seconds
    prepared = []
    with tempfile.TemporaryDirectory(prefix="energetica-level-compress-") as temp:
        for index, attachment in enumerate(attachments):
            self._check_deadline(deadline)
            directory = Path(temp) / str(index)
            directory.mkdir()
            source = directory / "source"
            source.write_bytes(self.media_repository.read(attachment))
            actual_size = source.stat().st_size
            if not actual_size:
                raise AttachmentCompressionError("O arquivo está vazio e não pode ser reduzido.")
            # The smaller of the absolute cap and percentage remainder is a goal,
            # not a rejection threshold. Codecs retain their readability floors.
            target = min(cap, actual_size * (100 - reduction) // 100)
            if target < 1:
                candidate, extension, mime = source, None, None
            else:
                candidate, extension, mime = self._compress_one_for_level(
                    source, attachment, target, directory, deadline, level)
            self._check_deadline(deadline)
            candidate_size = candidate.stat().st_size
            if not 0 < candidate_size < actual_size:
                candidate, extension, mime = source, None, None
            prepared.append((attachment, candidate, extension, mime, actual_size, target))
        if sum(candidate.stat().st_size for _, candidate, *_ in prepared) > max_total_bytes:
            raise AttachmentCompressionError("Os anexos compactados excedem o limite total; originais preservados.")
        # Hard upload limits still apply to the whole batch BEFORE replacement.
        # Returning a candidate only prepares a preview; user choice commits it.
        results = []
        for attachment, candidate, extension, mime, actual_size, target in prepared:
            self._check_deadline(deadline)
            content = candidate.read_bytes()
            name = attachment.get("original_name") or attachment.get("sharepoint_name") or "anexo"
            changed = candidate.name != "source"
            new_name = self._safe_stem(name) + extension if extension else name
            if changed:
                result = self.media_repository.replace(attachment, content,
                    sharepoint_name=new_name, mime_type=mime or attachment.get("mime_type"))
            else:
                result = dict(attachment)
            result.update(original_name=new_name,
                source_original_name=attachment.get("source_original_name", name),
                original_size=actual_size, compressed=changed, size=len(content),
                sha256=hashlib.sha256(content).hexdigest(), compression_level=level,
                compression_target_bytes=target,
                compression_minimum_reduction_percent=reduction,
                compression_target_met=len(content) <= target,
                compression_reduction_percent=round((1 - len(content) / actual_size) * 100, 1))
            results.append(result)
        return results
'''


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise RuntimeError("Patch anchor drift; no files written")
    return source.replace(old, new, 1)


def replace_method(source, class_name, method_name, replacement):
    tree = ast.parse(source)
    owner = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == class_name)
    method = next(node for node in owner.body if isinstance(node, ast.FunctionDef) and node.name == method_name)
    lines = source.splitlines(keepends=True)
    lines[method.lineno - 1:method.end_lineno] = [
        textwrap.indent(textwrap.dedent(replacement).strip() + "\n", "    ")]
    return "".join(lines)


def patch(relative, data):
    if hashlib.sha256(data).hexdigest() != BEFORE[relative]:
        raise RuntimeError(relative + ": baseline hash mismatch; no files written")
    source = data.decode("utf-8")
    if relative == "worker/compression.py":
        source = replace_method(source, "AttachmentCompressor", "_compress_at_level", COMPRESS_AT_LEVEL)
    elif relative == "channel_bridge.py":
        source = replace_once(source,
            "Escolha o nível. O teto e a redução mínima devem ser atingidos juntos. Confira a legibilidade na prévia.",
            "Escolha o nível. Buscaremos a meta mais restritiva entre tamanho e redução; se não for possível, a melhor redução preservando resolução útil. Confira a legibilidade na prévia.")
        for old, new in (("10 MB / redução mínima 25%", "metas: 10 MB / 25%"),
                         ("5 MB / redução mínima 50%", "metas: 5 MB / 50%"),
                         ("1 MB / redução mínima 80%", "metas: 1 MB / 80%"),
                         ("500 KB / redução mínima 90%", "metas: 500 KB / 90%")):
            source = replace_once(source, old, new)
        source = replace_once(source,
            '            if compressed.get("object_name") == original.get("object_name"):\n'
            '                raise ValueError("Não foi possível reduzir este arquivo")',
            '            if compressed.get("object_name") == original.get("object_name"):\n'
            '                state["attachments"][index] = compressed\n'
            '                state.pop("portal_attachment_compression", None)\n'
            '                _, etag = self.engine.state_store.load(key)\n'
            '                self.engine.state_store.save(key, state, etag)\n'
            '                return {"status": "processed", "operation": "attachment_compression_unchanged",\n'
            '                        "messages": [{"type": "text", "text": "📎 Não foi possível reduzir mais este arquivo preservando resolução útil. O original foi mantido."}]}')
        source = replace_once(source,
            '            state["portal_attachment_compression"] = {\n'
            '                "phase": "preview", "level": level,',
            '            compressed_size = compressed_path.stat().st_size\n'
            '            target = int(compressed.get("compression_target_bytes") or 0)\n'
            '            goal_met = compressed_size <= target if target else True\n'
            '            reduction_percent = round((1 - compressed_size / original_size) * 100, 1)\n'
            '            comparison_preview["goal"] = {"targetBytes": target, "actualBytes": compressed_size,\n'
            '                                          "met": goal_met, "reductionPercent": reduction_percent, "level": level}\n'
            '            goal_message = "Meta atingida." if goal_met else (\n'
            '                "A meta não foi atingida; esta é a melhor redução possível preservando resolução útil.")\n'
            '            question = (f"Meta mais restritiva: {target} bytes. Resultado: {compressed_size} bytes "\n'
            '                        f"({reduction_percent:.1f}% de redução). {goal_message} "\n'
            '                        "Confira a legibilidade. Qual versão deseja usar?")\n'
            '            state["portal_attachment_compression"] = {\n'
            '                "phase": "preview", "level": level,')
        source = replace_once(source,
            '"question": "A prévia comprimida foi gerada. Confira a legibilidade. Qual versão deseja usar?",',
            '"question": question,')
    else:
        source = replace_once(source,
            "ESCOLHA O NÍVEL. O TETO E A REDUÇÃO MÍNIMA DEVEM SER ATINGIDOS JUNTOS. CONFIRA A LEGIBILIDADE NA PRÉVIA.",
            "ESCOLHA O NÍVEL. BUSCAREMOS A META MAIS RESTRITIVA; SE NÃO FOR POSSÍVEL, A MELHOR REDUÇÃO PRESERVANDO RESOLUÇÃO ÚTIL. CONFIRA A LEGIBILIDADE NA PRÉVIA.")
        for old, new in (("10 MB / ≥25%", "metas: 10 MB / 25%"),
                         ("5 MB / ≥50%", "metas: 5 MB / 50%"),
                         ("1 MB / ≥80%", "metas: 1 MB / 80%"),
                         ("500 KB / ≥90%", "metas: 500 KB / 90%")):
            source = replace_once(source, old, new)
    output = source.encode("utf-8")
    compile(output, relative, "exec")
    return output


def prepare(root):
    return {relative: patch(relative, (root / relative).read_bytes()) for relative in BEFORE}


if __name__ == "__main__":
    root, destination = (Path(value).resolve() for value in sys.argv[1:])
    sources = prepare(root)
    for relative, data in sources.items():
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        print(hashlib.sha256(data).hexdigest(), relative)
