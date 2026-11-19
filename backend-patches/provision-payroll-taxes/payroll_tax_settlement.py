"""Complete individual employee tax payments after a confirmed provision settlement."""
from contextlib import nullcontext
from datetime import date
from decimal import Decimal, InvalidOperation
import re
import unicodedata

PROVISION = "PROVISÃO PGTOS"
PAYROLL = "FOLHAPGTO"
SOURCE_FIELDS = ("Title", "OBS", "TIPOPGTO", "IDFOLHA", "FORNECEDOR", "DATAPREVISTOPGTO",
                 "DATAPGTOEFETUADO", "IDLANCAMENTOS", "VALORTOTAL", "QTD", "FRETE")
PAYMENT_FIELDS = ("Title", "IDPROVISAO", "IDFOLHA", "FORNECEDOR", "TIPOPGTO", "IDLANCAMENTO", "DATA")


def folded(value):
    return "".join(c for c in unicodedata.normalize("NFKD", str(value or ""))
                   if not unicodedata.combining(c)).strip().casefold()


def identifier(value):
    try:
        number = Decimal(str(value).strip())
        if number.is_finite() and number > 0 and number == number.to_integral_value():
            return int(number)
    except InvalidOperation:
        pass
    raise ValueError("Identificador do vínculo da folha inválido")


def day(value):
    return date.fromisoformat(str(value or "")[:10])


def synchronize(engine, provision_id, launch_id=None):
    """Return False for ordinary provisions; tax failures keep settlement recovery pending."""
    sp = engine.sharepoint
    source = sp.get_item_fields(provision_id, SOURCE_FIELDS, target_list=PROVISION)
    title = str(source.get("Title") or "").strip()
    automated = re.fullmatch(r"ENCARGOS:(\d{4}-\d{2}):(FGTS|INSS):[1-9]\d*", title)
    note = folded(source.get("OBS"))
    rubric = automated.group(2) if automated else str(source.get("TIPOPGTO") or "").strip().upper()
    if rubric not in {"FGTS", "INSS"}:
        match = re.match(r"^(fgts|inss)(?:\s|[-:])", note)
        rubric = match.group(1).upper() if match else None
    if rubric is None or rubric not in {"FGTS", "INSS"}:
        return False
    # A generic tax bill without an employee payslip is outside this flow.
    if not source.get("IDFOLHA") and not automated:
        return False
    sheet_id = identifier(source.get("IDFOLHA"))
    supplier = str(source.get("FORNECEDOR") or "").strip()
    if not supplier:
        raise ValueError("Funcionário do encargo ausente")
    due, paid = day(source.get("DATAPREVISTOPGTO")), day(source.get("DATAPGTOEFETUADO"))
    competence = (due.year - 1, 12) if due.month == 1 else (due.year, due.month - 1)
    explicit = automated.group(1) if automated else None
    noted = re.search(r"competencia\s+(\d{4}-\d{2})", note)
    for reference in (explicit, noted.group(1) if noted else None):
        if reference and engine._launch_payroll_month_key(reference) != competence:
            raise ValueError("Competência do encargo diverge do mês anterior ao vencimento")
    sheet = sp.get_item_fields(sheet_id, ("FORNECEDOR", "MESREFERENCIA"), target_list="IDFOLHA")
    choices = engine._launch_payroll_sheets_for_supplier(supplier, month_key=competence)
    if (folded(sheet.get("FORNECEDOR")) != folded(supplier)
            or engine._launch_payroll_month_key(sheet.get("MESREFERENCIA")) != competence
            or len(choices) != 1 or identifier(choices[0]["id"]) != sheet_id):
        raise ValueError("Confira a folha única do funcionário na competência do encargo")

    linked_launch = str(source.get("IDLANCAMENTOS") or "").strip()
    if launch_id:
        launch_id = identifier(launch_id)
        launch = sp.get_item_fields(launch_id, ("FORNECEDOR", "IDPGTOAGENDADO", "DATA PGTO EFETUADO"),
                                    target_list="LANCAMENTOS")
        if (identifier(linked_launch) != launch_id or identifier(launch.get("IDPGTOAGENDADO")) != provision_id
                or folded(launch.get("FORNECEDOR")) != folded(supplier)
                or day(launch.get("DATA PGTO EFETUADO")) != paid):
            raise ValueError("Lançamento pago e provisão do funcionário não conferem")
    elif linked_launch:
        # Never silently drop a financial origin absent from the confirmed receipt.
        raise ValueError("Retome a baixa para conferir o lançamento da provisão")

    token = f"APP-folha-provisao-{provision_id}"
    options = sp.get_options({"key": "settlement_payroll_tax_provision", "source": {
        "type": "sharepoint_list", "list": PAYROLL, "id_field": "Id", "label_field": "IDFOLHA",
        "fields": list(PAYMENT_FIELDS), "top": 2,
        "filters": [{"field": "IDPROVISAO", "kind": "number", "equals": provision_id}]}}, {})
    if len(options) > 1:
        raise ValueError("Mais de um pagamento da folha para a mesma provisão")
    if options:
        stored_token = (options[0].get("source_values") or {}).get("Title")
        if stored_token == f"WA-provision-payroll-{provision_id}":
            token = stored_token

    def validate(row):
        if (row.get("Title") != token or identifier(row.get("IDPROVISAO")) != provision_id
                or identifier(row.get("IDFOLHA")) != sheet_id
                or folded(row.get("FORNECEDOR")) != folded(supplier)
                or folded(row.get("TIPOPGTO")) != folded(rubric)):
            raise ValueError("O vínculo da provisão na folha mudou")
        stored = str(row.get("IDLANCAMENTO") or "").strip()
        if stored and (not launch_id or identifier(stored) != launch_id):
            raise ValueError("O pagamento da folha já possui outro lançamento")

    payroll_id = identifier(options[0]["id"]) if options else None
    if options:
        validate(options[0].get("source_values") or {})
    expected = {"DATA": paid.isoformat() + "T12:00:00Z"}
    if launch_id:
        expected["IDLANCAMENTO"] = str(launch_id)
    guard = engine._settlement_payroll_origin_guard(launch_id, token, payroll_id) if launch_id else nullcontext()
    with guard as saved_id:
        if saved_id:
            if payroll_id and saved_id != payroll_id:
                raise ValueError("Lançamento já vinculado a outra linha da folha")
            payroll_id = saved_id
        if payroll_id:
            current, version = sp.get_item_fields_with_etag(payroll_id, PAYMENT_FIELDS, PAYROLL)
            validate(current)
            changes = {key: value for key, value in expected.items()
                       if (day(current.get(key)) != paid if key == "DATA" and current.get(key)
                           else str(current.get(key) or "").strip() != value)}
            if changes:
                sp.update_item_with_etag(payroll_id, changes, version, PAYROLL)
            confirmed, _ = sp.get_item_fields_with_etag(payroll_id, PAYMENT_FIELDS, PAYROLL)
            validate(confirmed)
            if day(confirmed.get("DATA")) != paid or (launch_id and identifier(confirmed.get("IDLANCAMENTO")) != launch_id):
                raise ValueError("Pagamento da folha ainda não confirmado")
        else:
            amount = Decimal(str(source.get("VALORTOTAL"))) * Decimal(str(source.get("QTD")))
            amount += Decimal(str(source.get("FRETE") or "0"))
            if not amount.is_finite() or amount < 0:
                raise ValueError("Valor do encargo inválido")
            body = {"FORNECEDOR": supplier, "TIPOPGTO": rubric, "IDFOLHA": str(sheet_id),
                    "IDPROVISAO": provision_id, "QTD": "1", "VALORUNITARIO": format(amount.quantize(Decimal("0.01")), ".2f"),
                    **expected}
            payroll_id = sp.ensure_item(token, body, target_list=PAYROLL, idempotency_field="Title", merge_existing=False)
            verified = sp.verify_item(payroll_id, {"Title": token, **body}, [], target_list=PAYROLL)
            if not (verified is True or isinstance(verified, dict)
                    and verified.get("fields") is True and verified.get("attachments") is True):
                raise ValueError("Inclusão do pagamento da folha ainda não confirmada")
    return True
