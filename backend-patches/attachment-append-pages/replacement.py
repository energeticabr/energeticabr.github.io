"""Owner-scoped, compare-and-swap replacement of one unsubmitted tray PDF.

Embedded in channel_bridge.py by patch_backend.py; no workflow event is emitted.
The old media is retained for normal expiry/recovery, never deleted here.
"""


def portal_replace_attachment(bridge, identity, upload, media_store, *, attachment_id,
                              expected_sha256, request_id, allowed_emails):
    import copy
    import hashlib
    import hmac
    import os
    from pathlib import Path
    import re
    import stat
    from pypdf import PdfReader

    old_id = str(attachment_id or '').lower()
    expected = str(expected_sha256 or '').lower()
    attempt = str(request_id or '').lower()
    if (not re.fullmatch(r'[0-9a-f]{64}', old_id)
            or not re.fullmatch(r'[0-9a-f]{64}', expected)
            or not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', attempt)):
        raise ValueError('Identificador ou hash da substituição inválido')
    name = str(upload.file_name)
    if (Path(name).name != name or '/' in name or '\\' in name or not name.lower().endswith('.pdf')
            or not 5 <= len(name) <= 180 or any(ord(c) < 32 for c in name)
            or upload.mime_type != 'application/pdf'):
        raise ValueError('O resultado deve ser um PDF com nome válido')

    def file_hash(path):
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            while chunk := stream.read(256 * 1024):
                digest.update(chunk)
        return digest.hexdigest()

    def pdf_pages(path):
        try:
            with path.open('rb') as source:
                if source.read(5) != b'%PDF-':
                    raise ValueError('PDF inválido')
                source.seek(0)
                reader = PdfReader(source)
                if reader.is_encrypted:
                    raise ValueError('PDF protegido: o original foi mantido')
                count = len(reader.pages)
                if not 1 <= count <= 200:
                    raise ValueError('O PDF deve ter entre 1 e 200 páginas')
                fields = reader.get_fields() or {}
                if any(field.get('/FT') == '/Sig' and field.get('/V') for field in fields.values()):
                    raise ValueError('PDF assinado digitalmente: o original foi mantido')
                return count
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError('Não foi possível validar o PDF; o original foi mantido') from exc

    def response(saved):
        attachments = bridge.portal_attachment_snapshot(identity, media_store, allowed_emails=allowed_emails)
        current = next((item for item in attachments if item['id'] == saved['replacementId']), None)
        if not current:
            raise ValueError('O anexo foi alterado após esta tentativa; atualize a bandeja')
        return {'status': 'processed', 'messages': [], 'operation': 'attachment_replaced', 'requestId': attempt,
                'previousAttachmentId': old_id, 'replacement': current, 'attachments': attachments}

    def commit():
        with bridge.lock:
            key, state = bridge._portal_state(identity)
            bridge.portal_owners.authorize(key, identity, state_exists=bool(state), bind=bool(state),
                                           allowed_emails=allowed_emails)
            if not state:
                raise ValueError('O fluxo não possui este anexo')
            state, etag = bridge.engine.state_store.load(key)
            state = copy.deepcopy(state)
            forbidden = {'completed', 'expired', 'cancelled', 'committing', 'notifying', 'summarizing',
                         'compressing_attachments', 'sending_document_attachments', 'cash_receipt_recovery'}
            if (not state or state.get('stage') in forbidden
                    or bridge.engine._provision_attachments_locked(state)):
                raise ValueError('Os anexos estão bloqueados ou o fluxo já foi concluído')
            if (state.get('portal_attachment_compression') or state.get('pending_attachment_compression')
                    or state.get('attachment_compression_queue')
                    or any(state.get(field) for field in ('document_signing_document_attachment',
                        'document_signing_signature_attachment', 'document_signing_epi_signed_attachment'))):
                raise ValueError('Conclua a edição/assinatura pendente antes de acrescentar páginas')

            size = upload.path.stat().st_size
            if not 0 < size <= 60_000_000:
                raise ValueError('O PDF deve ter no máximo 60 MB e não pode estar vazio')
            content_hash = file_hash(upload.path)
            receipts = state.get('portal_attachment_replacements') or {}
            receipt = receipts.get(attempt)

            if receipt:
                if any(receipt.get(field) != value for field, value in (
                        ('previousId', old_id), ('originalSha256', expected),
                        ('contentSha256', content_hash), ('fileName', name))):
                    raise ValueError('O identificador desta tentativa já foi usado com outro conteúdo')
                return receipt

            candidates = [(index, item) for index, item in enumerate(state.get('attachments') or [])
                          if isinstance(item, dict) and item.get('object_name')
                          and hmac.compare_digest(bridge._portal_attachment_id(identity, state, item), old_id)]
            if len(candidates) != 1:
                raise ValueError('O anexo não está mais disponível neste fluxo')
            index, original = candidates[0]
            if original.get('read_only') or original.get('existing_attachment'):
                raise ValueError('Este anexo é somente leitura; o original foi mantido')
            root = Path(bridge.engine.media_repository.directory).resolve()
            folder = root / key[:12]
            source = root / str(original['object_name'])
            if (folder.resolve() != folder or source.resolve() != source.absolute()
                    or not source.resolve().is_relative_to(folder) or not source.is_file()
                    or source.stat().st_nlink != 1):
                raise ValueError('Anexo original indisponível ou caminho inválido')
            if not hmac.compare_digest(file_hash(source), expected):
                raise ValueError('O anexo foi alterado; atualize a bandeja antes de acrescentar páginas')
            previous_pages = pdf_pages(source) if str(original.get('mime_type')).lower() == 'application/pdf' else 1
            if pdf_pages(upload.path) <= previous_pages:
                raise ValueError('O novo PDF deve preservar as páginas atuais e incluir novas páginas')

            target = folder / ('append-' + attempt + '.pdf')
            # A deterministic, exclusive path permits retries after an uncertain save.
            if target.exists() or target.is_symlink():
                if (target.resolve() != target or not stat.S_ISREG(target.stat().st_mode)
                        or target.stat().st_nlink != 1 or file_hash(target) != content_hash):
                    raise ValueError('Conteúdo divergente para esta tentativa de substituição')
            else:
                flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
                with os.fdopen(os.open(target, flags, 0o600), 'wb') as destination, upload.path.open('rb') as content:
                    while chunk := content.read(256 * 1024):
                        destination.write(chunk)
                    destination.flush()
                    os.fsync(destination.fileno())
                if file_hash(target) != content_hash:
                    raise ValueError('O PDF não foi confirmado no armazenamento; o original foi mantido')
            updated = dict(original, message_id='append:' + attempt, object_name=target.relative_to(root).as_posix(),
                           original_name=name, sharepoint_name=Path(str(original.get('sharepoint_name') or name)).stem[:176] + '.pdf',
                           mime_type='application/pdf', size=size, sha256=content_hash)
            state['attachments'][index] = updated
            receipts[attempt] = {'previousId': old_id, 'originalSha256': expected, 'contentSha256': content_hash,
                                 'fileName': name, 'replacementId': bridge._portal_attachment_id(identity, state, updated)}
            state['portal_attachment_replacements'] = dict(list(receipts.items())[-32:])
            # Save with the original ETag. A failure may be uncertain, so retain both files.
            bridge.engine.state_store.save(key, state, etag)
            return receipts[attempt]

    saved = commit()
    return response(saved)
