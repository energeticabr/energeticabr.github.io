"""Report and allocate confirmed launch payments to existing payroll sheets."""
from __future__ import annotations

from collections import defaultdict
from contextlib import contextmanager
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import re
import unicodedata

import requests

if __package__:
    from .launch_gallery import LaunchGalleryError, TZ, _instant, _number
else:
    from launch_gallery import LaunchGalleryError, TZ, _instant, _number


APPLICATION_PREFIX = "IDFOLHA-PENDENTE:"
PAYMENT_TYPES = (
    "SALÁRIO", "AJUDA DE CUSTO", "VALE REFEIÇÃO", "PREMIAÇÃO", "VALE TRANSPORTE",
    "13 SALÁRIO", "FÉRIAS E/OU ENCARGOS", "INSS", "FGTS",
)
PAGE_SIZE = 30
MAX_CENTS = 9_007_199_254_740_991
LAUNCH = "LANCAMENTOS"
PAYROLL = "FOLHAPGTO"
PROVISION = "PROVISÃO PGTOS"
SHEET = "IDFOLHA"
LAUNCH_FIELDS = (
    "IDFOLHA", "DATA PGTO EFETUADO", "FORNECEDOR", "PRODUTO", "TIPO TRANSAÇÃO",
    "QUANTIDADE", "VALOR UNITÁRIO", "FRETE", "Modificado", "IDPGTOAGENDADO",
)
PAYROLL_FIELDS = ("Title", "IDLANCAMENTO", "IDFOLHA", "FORNECEDOR", "TIPOPGTO",
                  "VALORUNITARIO", "QTD", "DATA", "IDPROVISAO")
PROVISION_FIELDS = ("IDLANCAMENTOS", "IDFOLHA")
SHEET_FIELDS = ("FORNECEDOR", "MESREFERENCIA", "STATUS")
OPERATIONS = {
    "payroll_pending": {"page"}, "payroll_targets": set(), "payroll_detail": {"id"},
    "payroll_legacy_link": {"fields"},
    "payroll_apply": {"id", "sheetId", "mode", "amountCents", "revision", "requestId", "confirm", "paymentType", "supplier", "reference"},
}


def fail(code, message, status=400):
    raise LaunchGalleryError(code, message, status)


def identifier(value):
    # Older SharePoint postings may appear as numeric or numeric-text fields.
    match = re.fullmatch(r"([1-9][0-9]{0,9})(?:\.0+)?", text(value))
    return match[1] if match and int(match[1]) <= 2147483647 else ""


def input_id(value):
    if not isinstance(value, str) or not identifier(value) or identifier(value) != value:
        fail("invalid_payload", "Informe um ID inteiro e positivo.")
    return value


def text(value):
    return str(value).strip() if isinstance(value, (str, int, float)) and not isinstance(value, bool) else ""


def populated(value):
    if value is None or value is False or isinstance(value, str) and not value.strip():
        return False
    return re.fullmatch(r"0(?:\.0+)?", text(value)) is None


def ids(value):
    return {item for part in re.split(r"[,;\r\n]+", text(value)) if (item := identifier(part))}


def folded(value):
    return "".join(c for c in unicodedata.normalize("NFKD", text(value)) if not unicodedata.combining(c)).casefold()


def digest(value):
    serialized = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(serialized.encode("utf8")).hexdigest()


def is_application_title(value):
    return isinstance(value, str) and value.startswith(APPLICATION_PREFIX)


def matching_title(value):
    return re.fullmatch(r"IDFOLHA-PENDENTE:[a-f0-9]{64}:[a-f0-9]{64}", text(value)) is not None


def read_schema(g, names):
    for name, fields in names:
        for label in fields:
            g._field(name, label)


def check_payroll_schema(g):
    link = g._field(PAYROLL, "IDLANCAMENTO")
    if link.get("TypeAsString") != "Text" or link.get("Indexed") is not True:
        fail("payroll_schema", "O ID de origem na folha deve ser texto indexado.", 503)
    read_schema(g, ((PAYROLL, PAYROLL_FIELDS),))


def require_write_schema(g):
    for label in PAYROLL_FIELDS[:-1]:
        field = g._field(PAYROLL, label)
        expected = "DateTime" if label == "DATA" else "Text"
        if field.get("TypeAsString") != expected or not g._writable(field) or field.get("InternalName") != label:
            fail("payroll_schema", f"Não foi possível identificar a coluna gravável {label} em FOLHAPGTO.", 503)


def load_payroll(g, item_id=None):
    check_payroll_schema(g)
    # The all-record path also covers historical references stored as numeric text, e.g. "42.0".
    if item_id is None:
        return g._rows(PAYROLL, PAYROLL_FIELDS)
    column = g._field(PAYROLL, "IDLANCAMENTO")["InternalName"]
    return g._rows(PAYROLL, PAYROLL_FIELDS, f"{column} eq '{item_id}'")


def linked_provisions(g, payroll_rows):
    read_schema(g, ((PROVISION, PROVISION_FIELDS),))
    posted = {identifier(p.get("IDPROVISAO")) for p in payroll_rows if
              populated(p.get("IDFOLHA")) and not is_application_title(p.get("Title"))}
    linked_ids, origins = set(), set()
    for row in g._rows(PROVISION, PROVISION_FIELDS):
        provision_id = identifier(row.get("ID"))
        if provision_id and (provision_id in posted or populated(row.get("IDFOLHA"))):
            linked_ids.add(provision_id)
            origins.update(ids(row.get("IDLANCAMENTOS")))
    # A launch may retain a direct reference even if the related provision was removed.
    return linked_ids | (posted - {""}), origins


def origin_rows(g, item_id, collection):
    # Exact indexed reads can be fresher than a long traversal. Keep legacy numeric-text variants.
    exact = load_payroll(g, item_id)
    exact_ids = {identifier(row.get("ID")) for row in exact}
    return exact + [row for row in collection if identifier(row.get("ID")) not in exact_ids]


def read_launch(g, item_id):
    read_schema(g, ((LAUNCH, LAUNCH_FIELDS),))
    try:
        return g._get(LAUNCH, item_id, LAUNCH_FIELDS)
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            fail("not_found", "Lançamento não encontrado.", 404)
        raise


def cents(amount):
    # Quantize using half-up, the same convention as the launch gallery.
    value = int((amount * 100).to_integral_value(rounding=ROUND_HALF_UP))
    if abs(value) > MAX_CENTS:
        fail("invalid_amount", "O pagamento excede o limite de valor do relatório.", 409)
    return value


def paid_date(raw):
    return _instant(raw).astimezone(TZ).date().isoformat()


def allocation(raw, origin_id):
    if not matching_title(raw.get("Title")) or identifier(raw.get("IDLANCAMENTO")) != origin_id:
        fail("payroll_allocation_integrity", "Identificação da aplicação de folha inconsistente.", 409)
    row_id, sheet_id, supplier, payment_type = (identifier(raw.get("ID")), identifier(raw.get("IDFOLHA")),
                                                text(raw.get("FORNECEDOR")), text(raw.get("TIPOPGTO")))
    if (not row_id or not sheet_id or not supplier or payment_type not in PAYMENT_TYPES
            or populated(raw.get("IDPROVISAO")) or _number(raw.get("QTD")) != Decimal(1)):
        fail("payroll_allocation_integrity", "Aplicação de folha com campos inconsistentes.", 409)
    amount = _number(raw.get("VALORUNITARIO"))
    amount_cents = cents(amount)
    if amount_cents <= 0 or Decimal(amount_cents) / 100 != amount:
        fail("payroll_allocation_integrity", "Valor da aplicação de folha inconsistente.", 409)
    return {"id": row_id, "sheetId": sheet_id, "supplier": supplier, "amountCents": amount_cents,
            "paymentType": payment_type}


def source_revision(launch, item_id, applications):
    # SharePoint verbose single-item reads return 1 where collections return 1.0.
    numeric_fields = {"QUANTIDADE", "VALOR UNITÁRIO", "FRETE"}
    return digest([[format(_number(launch.get(field), True).normalize(), "f") if field in numeric_fields
                    else text(launch.get(field)) for field in LAUNCH_FIELDS], item_id, applications])


def summarize(g, launch, rows, historical):
    item_id = identifier(launch.get("ID"))
    if not item_id:
        fail("payroll_allocation_integrity", "A origem não possui um ID de lançamento válido.", 502)
    provision_ids, provision_origins = historical
    if not launch.get("DATA PGTO EFETUADO") or folded(launch.get("TIPO TRANSAÇÃO")) == "receita":
        return None
    older_link = (populated(launch.get("IDFOLHA")) or item_id in provision_origins
                  or bool(ids(launch.get("IDPGTOAGENDADO")) & provision_ids)
                  or any(populated(row.get("IDFOLHA")) and not is_application_title(row.get("Title")) for row in rows))
    if older_link and not any(is_application_title(row.get("Title")) for row in rows):
        return None
    total = cents(g._amount(launch))
    if total <= 0:
        return None
    applications = []
    seen_titles = set()
    for row in rows:
        if is_application_title(row.get("Title")):
            if row["Title"] in seen_titles:
                fail("payroll_allocation_integrity", "Foram encontradas aplicações repetidas para o mesmo pagamento.", 409)
            seen_titles.add(row["Title"])
            applications.append(allocation(row, item_id))
    applications.sort(key=lambda a: int(a["id"]))
    remaining = total - sum(a["amountCents"] for a in applications)
    if remaining < 0:
        fail("payroll_allocation_integrity", "As aplicações existentes ultrapassam o total do pagamento.", 409)
    return {
        "id": item_id, "supplier": text(launch.get("FORNECEDOR")), "product": text(launch.get("PRODUTO")),
        "paidAt": paid_date(launch["DATA PGTO EFETUADO"]), "totalCents": total, "remainingCents": remaining,
        "allocations": applications,
        "revision": source_revision(launch, item_id, applications),
        **({"applicationPending": True} if older_link else {}),
    }


def history(g):
    rows = load_payroll(g)
    by_origin = defaultdict(list)
    for row in rows:
        origin = identifier(row.get("IDLANCAMENTO"))
        if origin:
            by_origin[origin].append(row)
    return by_origin, linked_provisions(g, rows)


def store_key(g, item_id):
    # Isolate journal files from the chatbot's conversation state enumeration.
    return "payroll-pending/" + digest([g.sharepoint.site_url, item_id])


def load_reservation(g, item_id):
    store = getattr(g.engine, "state_store", None)
    try:
        record, tag = store.load(store_key(g, item_id))
    except Exception:
        fail("payroll_journal_unavailable", "O controle de aplicações não está disponível. Tente novamente.", 503)
    return store, record, tag


def confirmed_tokens(record):
    return set(record.get("confirmed", ())) if record else set()


def missing_confirmed(record, rows):
    return bool(confirmed_tokens(record) - {row.get("Title") for row in rows})


def finish_reservation(store, key, tag, before, token=None, status="settled"):
    tokens = confirmed_tokens(before)
    if token:
        tokens.add(token)
    return save_reservation(store, key, {"status": status, "confirmed": sorted(tokens)}, tag)


def has_unresolved_application(g, item_id):
    _, record, _ = load_reservation(g, item_id)
    if not isinstance(record, dict):
        return False
    if record.get("status") == "pending":
        return True
    return bool(confirmed_tokens(record) and missing_confirmed(record, load_payroll(g, item_id)))


@contextmanager
def origin_write_lock(g, item_id):
    from fcntl import LOCK_EX, LOCK_NB, flock

    store = getattr(g.engine, "state_store", None)
    directory = getattr(store, "directory", None)
    if directory is None:
        fail("payroll_journal_unavailable", "O controle de aplicações não está disponível. Tente novamente.", 503)
    lock_path = (Path(directory) / store_key(g, item_id)).with_suffix(".lock")
    try:
        lock_path.parent.mkdir(mode=0o700, exist_ok=True)
        lock = lock_path.open("a")
    except OSError:
        fail("payroll_journal_unavailable", "Não foi possível reservar o pagamento.", 503)
    with lock:
        try:
            flock(lock.fileno(), LOCK_EX | LOCK_NB)
        except BlockingIOError:
            fail("conflict", "Outro vínculo de folha está sendo gravado para esse pagamento. Atualize antes de continuar.", 409)
        except OSError:
            fail("payroll_journal_unavailable", "Não foi possível reservar o pagamento.", 503)
        yield


def assert_legacy_origin_available(g, item_id):
    item_id = input_id(str(item_id))
    if has_unresolved_application(g, item_id) or any(is_application_title(row.get("Title"))
                                                     for row in load_payroll(g, item_id)):
        fail("payroll_allocation_locked", "O lançamento tem aplicações no relatório IDFOLHA. Continue pelo relatório de pendências.", 409)


def reservation_title(record):
    return record["token"] if record.get("kind") == "legacy" else record["body"]["Title"]


def definitive_http_rejection(exc):
    response = getattr(exc, "response", None)
    return response is not None and response.status_code in {400, 401, 403, 404, 422}


@contextmanager
def legacy_origin_write(g, item_id, token):
    item_id = input_id(str(item_id))
    with origin_write_lock(g, item_id):
        rows = load_payroll(g, item_id)
        if any(is_application_title(row.get("Title")) for row in rows):
            fail("payroll_allocation_locked", "O lançamento tem aplicações no relatório IDFOLHA. Continue pelo relatório de pendências.", 409)
        key = store_key(g, item_id)
        store, record, tag = load_reservation(g, item_id)
        if missing_confirmed(record, rows):
            fail("payroll_legacy_uncertain", "O pagamento de folha anterior ainda está sendo conferido.", 409)
        if record and record.get("status") == "pending":
            if record.get("kind") != "legacy":
                fail("payroll_allocation_locked", "O lançamento tem aplicações no relatório IDFOLHA. Continue pelo relatório de pendências.", 409)
            saved = find_application(rows, reservation_title(record))
            if not saved or not populated(saved.get("IDFOLHA")):
                fail("payroll_legacy_uncertain", "O pagamento de folha anterior ainda está sendo conferido. Tente retomar a operação original.", 409)
            tag = finish_reservation(store, key, tag, record, saved["Title"])
            record = {"status": "settled", "confirmed": sorted(confirmed_tokens(record) | {saved["Title"]})}
        existing = find_application(rows, token)
        if existing:
            existing_id = identifier(existing.get("ID"))
            if not existing_id:
                fail("payroll_allocation_integrity", "O pagamento existente não tem um ID válido.", 409)
            yield int(existing_id)
            return
        tag = save_reservation(store, key, {"status": "pending", "kind": "legacy", "token": token,
                                             "confirmed": sorted(confirmed_tokens(record))}, tag)
        try:
            yield
        except Exception as exc:
            if definitive_http_rejection(exc):
                finish_reservation(store, key, tag, record, status="rejected")
            raise
        finish_reservation(store, key, tag, record, token)


def save_reservation(store, key, record, tag):
    try:
        return store.save(key, record, tag)
    except Exception:
        fail("payroll_apply_uncertain", "Não foi possível confirmar a aplicação. Tente confirmar novamente com a mesma operação.", 409)


def find_application(rows, token):
    found = [r for r in rows if r.get("Title") == token]
    if len(found) > 1:
        fail("payroll_allocation_integrity", "Mais de uma aplicação para a mesma confirmação.", 409)
    return found[0] if found else None


def validate_saved(row, expected):
    decoded = allocation(row, expected["IDLANCAMENTO"])
    if (row["Title"] != expected["Title"] or decoded["sheetId"] != expected["IDFOLHA"]
            or decoded["supplier"] != expected["FORNECEDOR"] or decoded["paymentType"] != expected["TIPOPGTO"]
            or decoded["amountCents"] != cents(_number(expected["VALORUNITARIO"]))
            or paid_date(row.get("DATA")) != paid_date(expected["DATA"])):
        fail("payroll_allocation_integrity", "Os dados gravados na folha não correspondem à aplicação confirmada.", 409)


def mark_pending(g, item, rows):
    if item and item["remainingCents"]:
        _, record, _ = load_reservation(g, item["id"])
        if record:
            token = reservation_title(record) if record.get("status") == "pending" else None
            if missing_confirmed(record, rows) or token and not find_application(rows, token):
                item["applicationPending"] = True
    return item


def pending_page(g, page):
    read_schema(g, ((LAUNCH, LAUNCH_FIELDS),))
    by_origin, historical = history(g)
    items = []
    for launch in g._rows(LAUNCH, LAUNCH_FIELDS):
        rows = by_origin.get(identifier(launch.get("ID")), ())
        item = summarize(g, launch, rows, historical)
        if item and item["remainingCents"]:
            items.append(item)
    items.sort(key=lambda item: (item["paidAt"], int(item["id"])), reverse=True)
    size = len(items)
    page = min(page, max(1, (size + PAGE_SIZE - 1) // PAGE_SIZE))
    visible = items[(page - 1) * PAGE_SIZE:page * PAGE_SIZE]
    for item in visible:
        mark_pending(g, item, by_origin.get(item["id"], ()))
    return {"items": visible, "total": size, "page": page, "pageSize": PAGE_SIZE}


def sheet_values(g, sheet):
    supplier = text(sheet.get("FORNECEDOR"))
    if not supplier or folded(sheet.get("STATUS")) not in {"", "ativo"}:
        return None
    reference = g._payroll_month(sheet.get("MESREFERENCIA"))
    if not reference:
        return None
    year, month = reference
    return supplier, f"{month:02d}/{year}", (year, month)


def targets(g):
    read_schema(g, ((SHEET, SHEET_FIELDS),))
    groups = defaultdict(list)
    for sheet in g._rows(SHEET, SHEET_FIELDS):
        result = sheet_values(g, sheet)
        item_id = identifier(sheet.get("ID"))
        if result and item_id:
            supplier, reference, order = result
            groups[supplier].append((order, int(item_id), {"id": item_id, "reference": reference}))
    return {
        "items": [{"supplier": supplier, "sheets": [entry[2] for entry in sorted(group, reverse=True)]}
                  for supplier, group in sorted(groups.items(), key=lambda pair: (folded(pair[0]), pair[0]))],
        "paymentTypes": list(PAYMENT_TYPES),
    }


def detail(g, item_id):
    by_origin, historical = history(g)
    rows = origin_rows(g, item_id, by_origin.get(item_id, ()))
    return {"item": mark_pending(g, summarize(g, read_launch(g, item_id), rows, historical), rows)}


def uncertain():
    fail("payroll_apply_uncertain", "Uma aplicação ainda está sendo conferida. Repita a confirmação original ou atualize antes de continuar.", 409)


def apply(g, item_id, payload):
    if payload.get("confirm") is not True:
        fail("confirmation_required", "Confirme a aplicação na folha.")
    sheet_id = input_id(payload.get("sheetId"))
    mode, requested, payment_type, request_id, revision, supplier, reference = (
        payload.get(key) for key in ("mode", "amountCents", "paymentType", "requestId", "revision", "supplier", "reference")
    )
    if (mode not in ("partial", "total") or payment_type not in PAYMENT_TYPES
            or not isinstance(request_id, str) or not re.fullmatch(r"[a-zA-Z0-9_.:-]{8,128}", request_id)
            or not isinstance(revision, str) or not re.fullmatch(r"[a-f0-9]{64}", revision)
            or not isinstance(supplier, str) or not supplier.strip() or len(supplier) > 255
            or not isinstance(reference, str) or not re.fullmatch(r"(0[1-9]|1[0-2])/[0-9]{4}", reference)):
        fail("invalid_payload", "Informe uma aplicação com rubrica, revisão e identificação válidas.")
    if ((mode == "partial" and (type(requested) is not int or not 0 < requested <= MAX_CENTS))
            or (mode == "total" and requested is not None)):
        fail("invalid_amount", "Informe um valor positivo em centavos para a aplicação parcial.")
    key_prefix = APPLICATION_PREFIX + digest([item_id, request_id]) + ":"
    token = key_prefix + digest([sheet_id, mode, requested, payment_type, revision, supplier, reference])
    key = store_key(g, item_id)
    store, pending, tag = load_reservation(g, item_id)
    by_origin, historical = history(g)
    rows = origin_rows(g, item_id, by_origin.get(item_id, ()))
    if missing_confirmed(pending, rows):
        uncertain()
    original = read_launch(g, item_id)
    item = summarize(g, original, rows, historical)
    for row in rows:
        if text(row.get("Title")).startswith(key_prefix) and row["Title"] != token:
            fail("request_id_conflict", "Essa confirmação já foi usada com outros dados.", 409)
    if pending and pending.get("status") == "pending":
        title = reservation_title(pending)
        if title.startswith(key_prefix) and title != token:
            fail("request_id_conflict", "Essa confirmação já foi usada com outros dados.", 409)
        row = find_application(rows, title)
        if not row or not populated(row.get("IDFOLHA")):
            uncertain()
        if pending.get("kind") != "legacy":
            validate_saved(row, pending["body"])
        tag = finish_reservation(store, key, tag, pending, title)
        pending = {"status": "settled", "confirmed": sorted(confirmed_tokens(pending) | {title})}
    if find_application(rows, token):
        return {"item": item}
    if not item or not item["remainingCents"]:
        fail("payroll_not_pending", "O pagamento não está mais pendente de IDFOLHA.", 409)
    if item.get("applicationPending"):
        fail("payroll_existing_link_conflict", "Há um vínculo anterior e aplicações no mesmo pagamento. Revise os vínculos da folha antes de continuar.", 409)
    if revision != item["revision"]:
        fail("conflict", "O pagamento ou o saldo mudou. Atualize a linha antes de confirmar.", 409)
    amount = item["remainingCents"] if mode == "total" else requested
    if amount > item["remainingCents"]:
        fail("invalid_amount", "O valor informado ultrapassa o saldo do pagamento.", 422)
    read_schema(g, ((SHEET, SHEET_FIELDS),))
    try:
        sheet = g._get(SHEET, sheet_id, SHEET_FIELDS)
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            fail("payroll_sheet_unavailable", "A folha selecionada não está mais disponível.", 409)
        raise
    destination = sheet_values(g, sheet)
    if not destination or destination[:2] != (supplier, reference):
        fail("payroll_sheet_unavailable", "O fornecedor ou a competência do IDFOLHA mudou. Atualize a seleção.", 409)
    require_write_schema(g)
    body = {"Title": token, "IDLANCAMENTO": item_id, "IDFOLHA": sheet_id, "FORNECEDOR": destination[0],
            "TIPOPGTO": payment_type, "VALORUNITARIO": format(Decimal(amount) / 100, ".2f"), "QTD": "1",
            "DATA": item["paidAt"] + "T12:00:00Z"}
    g._required(PAYROLL, body)
    tag = save_reservation(store, key, {"status": "pending", "body": body,
                                       "confirmed": sorted(confirmed_tokens(pending))}, tag)
    try:
        g.sharepoint._request("POST", f"{g._list_endpoint(PAYROLL)}/items", json=body,
                              headers={"Content-Type": "application/json;odata=nometadata"})
    except (requests.RequestException, ValueError) as exc:
        if definitive_http_rejection(exc):
            finish_reservation(store, key, tag, pending, status="rejected")
            fail("payroll_write_rejected", "O SharePoint rejeitou a aplicação. Confira os dados e tente novamente.", 422)
        # Result can be delayed after a timeout or a gateway failure. Reconcile without POSTing again.
    try:
        fresh_rows = load_payroll(g, item_id)
    except requests.RequestException:
        uncertain()
    saved = find_application(fresh_rows, token)
    if not saved:
        uncertain()
    validate_saved(saved, body)
    # Include legacy links in alternate numeric-text formats already observed by the full lookup.
    exact_ids = {identifier(row.get("ID")) for row in fresh_rows}
    fresh_rows += [row for row in rows if identifier(row.get("ID")) not in exact_ids and
                   (text(row.get("IDLANCAMENTO")) != item_id or is_application_title(row.get("Title")))]
    final = summarize(g, read_launch(g, item_id), fresh_rows, historical)
    finish_reservation(store, key, tag, pending, token)
    return {"item": final}


def link_legacy(g, fields):
    # Existing manual gallery action: derive and verify all SharePoint values on the server.
    labels = set(PAYROLL_FIELDS) - {"IDPROVISAO"}
    if not isinstance(fields, dict) or set(fields) != labels:
        fail("invalid_payload", "Informe os campos do vínculo de pagamento.")
    item_id, sheet_id = (input_id(text(fields[field])) for field in ("IDLANCAMENTO", "IDFOLHA"))
    token, payment_type, supplier = (fields[field] for field in ("Title", "TIPOPGTO", "FORNECEDOR"))
    ordinary = isinstance(token, str) and re.fullmatch(r"APP-folha-vinculo-[A-Za-z0-9-]{1,80}", token)
    tax = isinstance(payment_type, str) and payment_type in {"INSS", "FGTS"}
    if (not isinstance(supplier, str) or not supplier.strip() or len(supplier) > 255
            or payment_type not in PAYMENT_TYPES
            or not (ordinary and not tax or tax and token == f"APP-folha-encargo-lancamento-{item_id}-{payment_type}")):
        fail("invalid_payload", "O fornecedor, a rubrica ou a operação de folha não são válidos.")
    if not isinstance(fields["DATA"], str) or not re.match(r"^\d{4}-\d{2}-\d{2}(?:T|$)", fields["DATA"]):
        fail("invalid_payload", "Informe a data de origem do lançamento.")
    date = fields["DATA"][:10]
    require_write_schema(g)
    with legacy_origin_write(g, item_id, token) as existing:
        # A local validation error aborts before POST. Translate it into a known rejection.
        try:
            launch_fields = ("FORNECEDOR", "DATA", "QUANTIDADE", "VALOR UNITÁRIO")
            read_schema(g, ((LAUNCH, launch_fields), (SHEET, SHEET_FIELDS)))
            launch = g._get(LAUNCH, item_id, launch_fields)
            sheet = g._get(SHEET, sheet_id, SHEET_FIELDS)
            destination = sheet_values(g, sheet)
            quantity, unit = _number(launch.get("QUANTIDADE")), _number(launch.get("VALOR UNITÁRIO"))
            if (not destination or folded(destination[0]) != folded(supplier)
                    or folded(launch.get("FORNECEDOR")) != folded(supplier)
                    or paid_date(launch.get("DATA")) != date or quantity != _number(fields["QTD"])
                    or unit != _number(fields["VALORUNITARIO"])):
                fail("conflict", "Confira a folha, o fornecedor e os valores do lançamento antes de continuar.", 409)
            body = {"Title": token, "IDLANCAMENTO": item_id, "IDFOLHA": sheet_id, "FORNECEDOR": supplier,
                    "TIPOPGTO": payment_type, "VALORUNITARIO": text(fields["VALORUNITARIO"]), "QTD": text(fields["QTD"]),
                    "DATA": date + "T12:00:00Z"}
            g._required(PAYROLL, body)
        except Exception:
            # No write has been sent. This tag belongs to the current writer while the lock is held.
            store, record, tag = load_reservation(g, item_id)
            if record and record.get("status") == "pending" and reservation_title(record) == token:
                finish_reservation(store, store_key(g, item_id), tag, record, status="rejected")
            raise
        if not existing:
            try:
                g.sharepoint._request("POST", f"{g._list_endpoint(PAYROLL)}/items", json=body,
                                      headers={"Content-Type": "application/json;odata=nometadata"})
            except (requests.RequestException, ValueError) as exc:
                if definitive_http_rejection(exc):
                    raise
            found = find_application(load_payroll(g, item_id), token)
            if not found:
                uncertain()
        else:
            found = find_application(load_payroll(g, item_id), token)
        if (not found or not identifier(found.get("ID"))
                or any(text(found.get(field)) != text(body[field]) for field in
                       ("IDLANCAMENTO", "IDFOLHA", "FORNECEDOR", "TIPOPGTO"))
                or _number(found.get("QTD")) != quantity or _number(found.get("VALORUNITARIO")) != unit
                or paid_date(found.get("DATA")) != date):
            fail("payroll_allocation_integrity", "Não foi possível conferir os dados do vínculo de folha gravado.", 409)
        return {"id": identifier(found["ID"])}


def handle(gallery, operation, payload):
    if operation not in OPERATIONS or not isinstance(payload, dict) or set(payload) - OPERATIONS[operation]:
        fail("invalid_payload", "Operação ou parâmetros inválidos para pagamentos pendentes.")
    if operation == "payroll_pending":
        page = payload.get("page", 1)
        if type(page) is not int or not 1 <= page <= 2147483647:
            fail("invalid_payload", "Informe uma página válida.")
        return pending_page(gallery, page)
    if operation == "payroll_targets":
        return targets(gallery)
    if operation == "payroll_legacy_link":
        return link_legacy(gallery, payload.get("fields"))
    item_id = input_id(payload.get("id"))
    if operation == "payroll_detail":
        return detail(gallery, item_id)
    with origin_write_lock(gallery, item_id):
        return apply(gallery, item_id, payload)
