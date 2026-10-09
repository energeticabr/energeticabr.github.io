"""G1 gallery / E1 editor, independent of the transport and authentication bridge.

Call only after the bridge's existing allowed-user authorization. The service
does not accept a user, site, list, URL or arbitrary SharePoint field from callers.
All amounts use Decimal until the JSON boundary; civil dates use São Paulo.

Contract additions:
* Every mutation needs confirm=True and expectedModified from detail.item.
* payment: {id, date, requestId, confirm, expectedModified}.
* measurement: {id, fields, requestId, confirm, expectedModified}; fields use
  measurementFields names, including NUMEROCONTRATO (EMPREITEIRO ID).
* Creates require engine.state_store with atomic load/save CAS, as in WorkflowEngine.
* LaunchGalleryError is a ValueError with code, status and safe details. Never
  serialize its chained exception. Incomplete creates must reuse requestId.
* filterOptions and totals cover all matching results before UI pagination.
* Attachment operations check the parent version immediately before their
  endpoint call; SharePoint does not offer a transaction across these resources.

Source: G1 Button9 -> PROVISÃO PGTOS; Form23_1 -> DESCRICAOMEDICOES plus
LANCAMENTOS.CONTRATO; Form7 -> JSON(PenInput.Image, IncludeBinaryData).
No deploy, schema migration, or new list/column is performed by this module.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import mimetypes
import re
import unicodedata
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from html import unescape
from html.parser import HTMLParser
from urllib.parse import quote, unquote
from zoneinfo import ZoneInfo

import requests
from PIL import Image


LAUNCHES = "LANCAMENTOS"
PROVISIONS = "PROVISÃO PGTOS"
MEASUREMENTS = "DESCRICAOMEDICOES"
TZ = ZoneInfo("America/Sao_Paulo")
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
MAX_SIGNATURE_BYTES = 2 * 1024 * 1024

# E1's real DataField identifiers; used only when confirmed by live metadata.
EDIT_FIELDS = {
    "AGRUPAR": "AGRUPAR", "DATA": "field_2", "DATA PGTO PREVISTO": "field_3",
    "DATA PGTO EFETUADO": "field_4", "FILIAL": "Title", "TIPO TRANSAÇÃO": "field_1",
    "APROVACAO": "APROVACAO", "ETAPA": "field_6", "FORNECEDOR": "field_5",
    "PRODUTO": "field_7", "CONTA": "field_14", "QUANTIDADE": "field_8",
    "VALOR UNITÁRIO": "field_9", "FRETE": "field_10", "NOTA": "NOTA",
    "DESCRIÇÃO": "field_16", "OBSERVAÇÕES ENTREGA": "OBSERVA_x00c7__x00d5_ESENTREGA",
    "GERADESEMBOLSO": "GERADESEMBOLSO", "CONTRATO": "CONTRATO",
    "CONCLUÍDO": "field_19", "ADIANTAMENTO": "ADIANTAMENTO",
    "MEDICAOPARCIAL": "MEDICAOPARCIAL", "UN": "UN",
}
MEASUREMENT_FIELDS = {
    "NUMEROCONTRATO": "NUMEROCONTRATO", "DATA FIM": "DATAFIM",
    "QTD": "QTD", "VALORTOTAL": "VALORTOTAL", "ATIVIDADE": "ATIVIDADE",
    "DEMONSTRATIVOETAPA": "DEMONSTRATIVOETAPA", "OBSERVACAO": "OBSERVACAO",
    "AVALIACAO": "AVALIACAO", "PENDENCIAS": "PENDENCIAS", "STATUS": "STATUS",
}
MEASUREMENT_DERIVED = {
    "IDLANCAMENTO": "IDLANCAMENTO", "FILIAL": "FILIAL", "FORNECEDOR": "FORNECEDOR",
    "ETAPA OBRA": "ETAPAOBRA", "TIPODEMEDICAO": "TIPODEMEDICAO", "SALDOCONTRATO": "SALDOCONTRATO",
}
READ_FIELDS = dict(EDIT_FIELDS, **{"ID": "Id", "Criado": "Created", "Modificado": "Modified",
                                     "Anexos": "Attachments", "ASSINATURA": "ASSINATURA",
                                     "DATA RMS": "DATARMS", "IDPGTOAGENDADO": "IDPGTOAGENDADO",
                                     "Criado por": "Author", "Modificado por": "Editor"})
SORT_OPTIONS = {
    "MAIOR ID": ("ID", True), "MAIOR DATA": ("DATA", True),
    "MAIOR DATA PGTO PREVISTO": ("DATA PGTO PREVISTO", True),
    "MAIOR DATA PGTO EFETUADO": ("DATA PGTO EFETUADO", True),
    "CRIADO MAIS RECENTE": ("Criado", True), "CRIADO MAIS ANTIGO": ("Criado", False),
    "MODIFICADO MAIS RECENTE": ("Modificado", True), "MODIFICADO MAIS ANTIGO": ("Modificado", False),
}
FILTER_FIELDS = {"branch": "FILIAL", "supplier": "FORNECEDOR", "status": "CONCLUÍDO",
                 "product": "PRODUTO", "stage": "ETAPA", "contract": "CONTRATO", "id": "ID"}
# Search stays local to the authorized launch dataset, never in an OData query.
# Optional linked IDs are projected only for a nonempty search. Signatures and
# REST/user metadata are deliberately excluded from this explicit allowlist.
SEARCH_DATE_FIELDS = ("DATA", "DATA PGTO PREVISTO", "DATA PGTO EFETUADO", "DATA RMS", "Criado", "Modificado")
SEARCH_NUMBER_FIELDS = ("QUANTIDADE", "VALOR UNITÁRIO", "FRETE")
SEARCH_FIELDS = (
    "ID", "FILIAL", "FORNECEDOR", "PRODUTO", "DESCRIÇÃO", "CONTA", "CONCLUÍDO",
    "APROVACAO", "ETAPA", "TIPO TRANSAÇÃO", "CONTRATO", "MEDICAOPARCIAL",
    "IDPGTOAGENDADO", "IDFOLHA", "NOTA", "UN", "OBSERVAÇÕES ENTREGA", "AGRUPAR",
    "GERADESEMBOLSO", "ADIANTAMENTO", *SEARCH_DATE_FIELDS, *SEARCH_NUMBER_FIELDS,
)
CATALOGS = {
    "FILIAL": ("FILIAIS", "FILIAL"), "FORNECEDOR": ("FORNECEDORES", "CADASTRO"),
    "PRODUTO": ("CADASTROPRODUTO", "PRODUTO"), "ETAPA": ("LANCAMENTOOBRA", "ETAPA"),
    "CONTA": ("CADASTROCONTA", "CONTA"),
    "UN": ("CADASTROUNIDADEMEDIDA", "UNIDADE MEDIDA"),
    "CONCLUÍDO": ("CONCLUIDOLANCAMENTOS", "CONCLUÍDO LANÇAMENTOS"),
    "ATIVIDADE": ("ATIVIDADE EXECUTADA", "ATIVIDADE EXECUTADA"),
}
FIXED_CHOICES = {
    "GERADESEMBOLSO": ["SIM", "NÃO"],
    "ADIANTAMENTO": ["SIM", "NÃO"],
    "TIPO TRANSAÇÃO": ["CUSTO", "DESPESA", "RECEITA"],
    "AGRUPAR": ["EMPENHADO HOJE", "EMPENHADO E LIQUIDADO HOJE", "LIQUIDADO HOJE",
                "LIQUIDADO E PAGO HOJE", "EMPENHADO, LIQUIDADO E PAGO HOJE", "PAGO HOJE"],
}


class LaunchGalleryError(ValueError):
    def __init__(self, code, message, status=400, **details):
        super().__init__(message)
        self.code, self.status, self.details = code, status, details


def _fail(code, message, status=400, **details):
    raise LaunchGalleryError(code, message, status, **details)


def _norm(value):
    return "".join(c for c in unicodedata.normalize("NFKD", str(value)) if not unicodedata.combining(c)).casefold()


def _search_terms(value):
    if (not isinstance(value, str) or len(value) > 512
            or any(unicodedata.category(c) in {"Cc", "Cf", "Cs"} and c not in "\t\r\n" for c in value)):
        _fail("invalid_filter", "search deve ser texto válido com até 512 caracteres.")
    return _norm(value).split()


class _DescriptionText(HTMLParser):
    """Collect visible text only; parsing never executes or fetches HTML content."""
    BLOCKS = {"p", "div", "br", "hr", "li", "ul", "ol", "table", "tr", "td", "th",
              "section", "article", "header", "footer", "blockquote", "pre",
              "h1", "h2", "h3", "h4", "h5", "h6"}

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.parts = []
        self.hidden = None

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"} and not self.hidden:
            self.hidden = tag
            self.parts.append(" ")
        elif not self.hidden and tag in self.BLOCKS:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if self.hidden:
            if tag == self.hidden:
                self.hidden = None
                self.parts.append(" ")
        elif tag in self.BLOCKS:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)

    def handle_entityref(self, name):
        self.handle_data(unescape(f"&{name};"))

    def handle_charref(self, name):
        self.handle_data(unescape(f"&#{name};"))


def _description_text(value):
    parser = _DescriptionText()
    parser.feed(str(value))
    parser.close()
    return "".join(parser.parts)


def _blank(value):
    return value is None or value == ""


def _id(value):
    if isinstance(value, bool) or not re.fullmatch(r"[1-9][0-9]{0,9}", str(value)) or int(value) > 2147483647:
        _fail("invalid_id", "ID inválido: informe um inteiro positivo.")
    return str(value)


def _day(value):
    if not isinstance(value, str):
        _fail("invalid_date", "Data inválida: use AAAA-MM-DD ou DD/MM/AAAA.")
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            return date.fromisoformat(value)
        if re.fullmatch(r"\d{2}/\d{2}/\d{4}", value):
            return datetime.strptime(value, "%d/%m/%Y").date()
    except ValueError:
        pass
    _fail("invalid_date", "Data inválida: use uma data existente em AAAA-MM-DD ou DD/MM/AAAA.")


def _midnight(day):
    return datetime.combine(day, time(), TZ).astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _instant(value):
    try:
        if len(str(value)) == 10:
            return datetime.combine(date.fromisoformat(value), time(), TZ)
        result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return result if result.tzinfo else result.replace(tzinfo=TZ)
    except (TypeError, ValueError):
        _fail("invalid_server_date", "O SharePoint retornou uma data inválida.", 502)


def _number(value, blank_zero=False):
    if _blank(value) and blank_zero:
        return Decimal(0)
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        _fail("invalid_number", "Número ou valor monetário inválido.")
    raw = str(value).strip()
    if raw.startswith("R$"):
        raw = raw[2:].strip()
    if "," in raw:
        if not re.fullmatch(r"[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+),\d+", raw):
            _fail("invalid_number", "Número inválido: use 1234.56 ou 1.234,56.")
        raw = raw.replace(".", "").replace(",", ".")
    elif not re.fullmatch(r"[+-]?\d+(?:\.\d+)?", raw):
        _fail("invalid_number", "Número inválido: use 1234.56 ou 1.234,56.")
    try:
        result = Decimal(raw)
        if not result.is_finite() or abs(result) > Decimal("1e15"):
            raise InvalidOperation
        return result
    except InvalidOperation:
        _fail("invalid_number", "Número fora do intervalo permitido.")


def _money(value):
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _literal(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, bool):
        return str(value).lower()
    return "'" + str(value).replace("'", "''") + "'"


class LaunchGalleryService:
    def __init__(self, engine):
        self.engine = engine
        self.sharepoint = engine.sharepoint
        self._schemas = {}
        self._catalog_cache = {}

    def handle(self, operation: str, payload: dict) -> dict:
        # Per-call caches: shared bridge service instances are safe for concurrent calls.
        call = type(self)(self.engine)
        try:
            return call._handle(operation, payload)
        except LaunchGalleryError:
            raise
        except requests.RequestException as exc:
            response = getattr(exc, "response", None)
            status = getattr(response, "status_code", None)
            if status == 404:
                _fail("not_found", "Item, lista ou arquivo não encontrado.", 404)
            if status in (409, 412):
                _fail("conflict", "Conflito de concorrência; atualize o detalhe e tente novamente.", 409)
            _fail("sharepoint_error", f"Falha na consulta/operação SharePoint (HTTP {status or 'indisponível'}).", 502)

    def _handle(self, operation, payload):
        operations = {"snapshot", "detail", "schema", "update", "delete", "payment", "measurement",
                      "attachment", "attachment_add", "attachment_delete", "signature"}
        if not isinstance(operation, str) or operation not in operations:
            _fail("invalid_operation", "Operação da galeria desconhecida.")
        if not isinstance(payload, dict):
            _fail("invalid_payload", "O payload deve ser um objeto.")
        allowed = {
            "snapshot": {"filters", "sort", "page", "pageSize"}, "detail": {"id"},
            "attachment": {"id", "fileName"}, "schema": {"id", "scope", "fields"},
            "update": {"fields"}, "delete": set(),
            "payment": {"date", "requestId"}, "measurement": {"fields", "requestId"},
            "attachment_add": {"fileName", "content", "mimeType", "requestId"},
            "attachment_delete": {"fileName"}, "signature": {"content", "mimeType", "fileName", "requestId"},
        }[operation]
        mutation = operation not in {"snapshot", "detail", "schema", "attachment"}
        if mutation:
            allowed = allowed | {"id", "confirm", "expectedModified"}
            if payload.get("confirm") is not True:
                _fail("confirmation_required", "Confirme a operação com confirm: true.")
            if not isinstance(payload.get("expectedModified"), str) or not payload["expectedModified"]:
                _fail("version_required", "expectedModified é obrigatório; consulte detail antes de alterar.", 409)
        if set(payload) - allowed:
            _fail("invalid_payload", "O payload contém parâmetros não permitidos.")
        if operation == "snapshot":
            return self._snapshot(payload)
        item_id = _id(payload.get("id"))
        current = self._get(LAUNCHES, item_id, READ_FIELDS)
        if operation == "schema":
            scope = payload.get("scope")
            supplied = payload.get("fields")
            if scope not in {"edit", "measurement"} or not isinstance(supplied, dict):
                _fail("invalid_schema_context", "Informe scope e fields válidos para atualizar as opções.")
            allowed_fields = EDIT_FIELDS if scope == "edit" else MEASUREMENT_FIELDS
            context = current | self._validate(
                LAUNCHES if scope == "edit" else MEASUREMENTS,
                supplied,
                allowed_fields,
                current,
            )
            if scope == "measurement" and supplied.get("NUMEROCONTRATO"):
                contract = self._get(
                    "EMPREITEIRO", _id(supplied["NUMEROCONTRATO"]),
                    ["FILIAL", "FORNECEDOR", "STATUS"],
                )
                if contract.get("STATUS") != "ATIVO":
                    _fail("inactive_contract", "O contrato da medição precisa estar ATIVO.")
                context |= {
                    "FILIAL": contract.get("FILIAL"),
                    "FORNECEDOR": contract.get("FORNECEDOR"),
                }
            return {"fields": self._schema(
                LAUNCHES if scope == "edit" else MEASUREMENTS,
                allowed_fields,
                context,
            )}
        if operation == "detail":
            row = self._row(current)
            return {"item": row, "attachments": [{"fileName": n} for n in self._attachments(item_id)],
                    "editFields": self._schema(LAUNCHES, EDIT_FIELDS, row["fields"]),
                    "measurementFields": self._schema(MEASUREMENTS, MEASUREMENT_FIELDS, row["fields"])}
        if operation in {"payment", "measurement"}:
            return self._create(operation, payload, item_id, current)
        if mutation:
            self._check_version(payload, current)
        if operation == "update":
            values = self._validate(LAUNCHES, payload.get("fields"), EDIT_FIELDS, current)
            self._check_measurement_pair(values, current)
            if set(values) & {"DATA", "DATA PGTO PREVISTO", "DATA PGTO EFETUADO"}:
                combined = current | values
                committed = not _blank(combined.get("DATA"))
                planned = not _blank(combined.get("DATA PGTO PREVISTO"))
                paid = not _blank(combined.get("DATA PGTO EFETUADO"))
                if committed and paid and not planned:
                    status = "PA - PENDENTE ENTREGA"
                elif not committed:
                    status = "PEDIDO EM COTAÇÃO"
                elif not planned and not paid:
                    status = "PEDIDO EMPENHADO"
                elif not paid:
                    status = "PEDIDO EM LIQUIDAÇÃO"
                else:
                    status = "PEDIDO FINALIZADO"
                values["CONCLUÍDO"] = self._value(
                    LAUNCHES,
                    "CONCLUÍDO",
                    status,
                    self._field(LAUNCHES, "CONCLUÍDO"),
                    combined,
                    check_options=False,
                )
            self._write(item_id, values, current)
        elif operation == "delete":
            self.sharepoint._request("POST", self._item_endpoint(LAUNCHES, item_id), headers={
                "IF-MATCH": self._etag(current), "X-HTTP-Method": "DELETE"})
        elif operation == "signature":
            self._signature(item_id, payload, current)
        else:
            return self._attachment(operation, item_id, payload, current)
        return {"ok": True, "id": item_id}

    def _list_endpoint(self, name):
        return self.sharepoint._list_endpoint(name)

    def _item_endpoint(self, name, item_id):
        return f"{self._list_endpoint(name)}/items({_id(item_id)})"

    @staticmethod
    def _values(payload):
        values = payload.get("value", payload.get("d", {}).get("results"))
        if not isinstance(values, list):
            _fail("invalid_response", "Resposta SharePoint inválida; coleção ausente.", 502)
        return values

    def _pages(self, endpoint, params=None):
        seen = set()
        root = self.sharepoint.site_url.rstrip("/") + "/_api/"
        while endpoint:
            if endpoint in seen:
                _fail("invalid_pagination", "Paginação SharePoint repetida.", 502)
            seen.add(endpoint)
            if "://" in endpoint and not endpoint.startswith(root):
                _fail("invalid_pagination", "Paginação SharePoint fora do site autorizado.", 502)
            payload = self.sharepoint._request("GET", endpoint, params=params)
            yield from self._values(payload)
            endpoint = payload.get("@odata.nextLink") or payload.get("odata.nextLink") or payload.get("d", {}).get("__next")
            params = None
            if endpoint and (not isinstance(endpoint, str) or not endpoint.startswith(root)):
                _fail("invalid_pagination", "Paginação SharePoint fora do site autorizado.", 502)

    def _metadata(self, name):
        if name not in self._schemas:
            self._schemas[name] = list(self._pages(f"{self._list_endpoint(name)}/fields", {"$top": "5000"}))
        return self._schemas[name]

    def _field(self, name, label, optional=False):
        aliases = READ_FIELDS if name == LAUNCHES else (MEASUREMENT_FIELDS | MEASUREMENT_DERIVED if name == MEASUREMENTS else {})
        preferred = aliases.get(label, {"ID": "Id", "Modificado": "Modified", "Criado": "Created", "Anexos": "Attachments"}.get(label, label))
        fields = self._metadata(name)
        candidates = [f for f in fields if f.get("InternalName") == preferred]
        if not candidates:
            candidates = [f for f in fields if _norm(f.get("Title", "")) == _norm(label) or _norm(f.get("InternalName", "")) == _norm(label)]
        candidates.sort(key=lambda f: bool(f.get("ReadOnlyField")) or f.get("TypeAsString") == "Computed")
        if candidates:
            return candidates[0]
        if optional:
            return None
        _fail("schema_missing", f"Campo necessário indisponível: {label} ({name}).", 503)

    def _projection(self, name, labels):
        result = {}
        for label in dict.fromkeys(["ID", *labels]):
            field = self._field(name, label, optional=label != "ID")
            if field:
                # The Counter field's metadata uses ID, while REST emits Id.
                internal = "Id" if label == "ID" else field["InternalName"]
                result[label] = internal + "Id" if field.get("TypeAsString") in {"Lookup", "User", "LookupMulti", "UserMulti"} else internal
        return result

    def _rows(self, name, labels, query=None):
        projection = self._projection(name, labels)
        params = {"$select": ",".join(dict.fromkeys(projection.values())), "$top": "5000", "$orderby": "Id asc"}
        if query:
            params["$filter"] = query
        return [{label: row.get(internal) for label, internal in projection.items()}
                for row in self._pages(f"{self._list_endpoint(name)}/items", params)]

    def _get(self, name, item_id, labels):
        projection = self._projection(name, labels)
        raw = self.sharepoint._request("GET", self._item_endpoint(name, item_id),
            params={"$select": ",".join(dict.fromkeys(projection.values()))},
            headers={"Accept": "application/json;odata=verbose"})
        raw = raw.get("d", raw)
        if str(raw.get("Id", raw.get("ID"))) != item_id:
            _fail("not_found", "O item solicitado não foi encontrado.", 404)
        result = {label: raw.get(internal) for label, internal in projection.items()}
        result["_etag"] = raw.get("@odata.etag") or raw.get("odata.etag") or raw.get("__metadata", {}).get("etag")
        return result

    @staticmethod
    def _etag(current):
        etag = current.get("_etag")
        if not isinstance(etag, str) or not etag or etag == "*":
            _fail("version_unavailable", "SharePoint não retornou ETag; alteração bloqueada para evitar perda de dados.", 409)
        return etag

    def _check_version(self, payload, current):
        expected, actual = payload.get("expectedModified"), current.get("Modificado")
        if not expected or not actual or _instant(expected) != _instant(actual):
            _fail("conflict", "O lançamento foi modificado; atualize o detalhe antes de confirmar.", 409)
        self._etag(current)

    @staticmethod
    def _amount(fields, freight=True):
        required = {"QUANTIDADE", "VALOR UNITÁRIO"} | ({"FRETE"} if freight else set())
        if required - fields.keys():
            _fail("schema_missing", "Colunas necessárias para calcular o valor do lançamento estão ausentes.", 503)
        return (_number(fields.get("QUANTIDADE"), True) * _number(fields.get("VALOR UNITÁRIO"), True)
                + (_number(fields.get("FRETE"), True) if freight else Decimal(0)))

    def _row(self, fields):
        # Whitelist excludes REST metadata and arbitrary fields/URLs.
        values = {label: fields[label] for label in READ_FIELDS if label in fields and label != "Anexos"}
        return {"id": _id(fields.get("ID")), "fields": values, "total": _money(self._amount(fields)),
                "hasAttachments": fields.get("Anexos") in (True, 1, "true", "True"),
                "expectedModified": fields.get("Modificado")}

    def _search_text(self, row):
        values = [_description_text(row[label]) if label == "DESCRIÇÃO" else str(row[label]) for label in SEARCH_FIELDS
                  if not _blank(row.get(label)) and isinstance(row[label], (str, int, float, Decimal))]
        for label in SEARCH_DATE_FIELDS:
            if not _blank(row.get(label)):
                try:
                    day = _instant(row[label]).astimezone(TZ).date()
                    values.extend((day.isoformat(), day.strftime("%d/%m/%Y")))
                except LaunchGalleryError:
                    # An optional malformed server date still has its raw text.
                    pass
        numbers = [_number(row[label]) for label in SEARCH_NUMBER_FIELDS if not _blank(row.get(label))]
        numbers.append(self._amount(row).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
        for number in numbers:
            decimal = format(number, "f")
            brazilian = format(number, ",.2f").translate(str.maketrans(",.", ".,"))
            values.extend((decimal, decimal.replace(".", ","), brazilian, f"R$ {brazilian}"))
        return _norm(" ".join(values))

    def _snapshot(self, payload):
        filters = payload.get("filters", {})
        if not isinstance(filters, dict) or set(filters) - (set(FILTER_FIELDS) | {"pendingApproval", "dateStart", "dateEnd", "search"}):
            _fail("invalid_filter", "Filtro desconhecido ou inválido.")
        terms = _search_terms(filters["search"]) if "search" in filters else []
        page, size = payload.get("page", 1), payload.get("pageSize", 25)
        for value in (page, size):
            if isinstance(value, bool) or not isinstance(value, int) or value < 1:
                _fail("invalid_page", "page e pageSize devem ser inteiros positivos.")
        size = min(size, 50)
        sort = payload.get("sort", "MAIOR ID")
        if not isinstance(sort, str) or sort not in SORT_OPTIONS:
            _fail("invalid_sort", "Ordenação desconhecida.")
        normalized, conditions = {}, []
        for key, label in FILTER_FIELDS.items():
            value = filters.get(key)
            if _blank(value):
                continue
            if isinstance(value, bool) or not isinstance(value, (str, int)):
                _fail("invalid_filter", f"Filtro inválido: {key}.")
            value = _id(value) if key == "id" else str(value)
            normalized[label] = value
            field = self._field(LAUNCHES, label)
            numeric = field.get("TypeAsString") in {"Counter", "Number", "Currency", "Lookup"}
            internal = "Id" if key == "id" else field["InternalName"] + ("Id" if field.get("TypeAsString") == "Lookup" else "")
            typed = value
            if numeric:
                number = _number(value)
                typed = int(number) if number == number.to_integral_value() else float(number)
            conditions.append(f"{internal} eq {_literal(typed)}")
        pending = filters.get("pendingApproval", False)
        if not isinstance(pending, bool):
            _fail("invalid_filter", "pendingApproval deve ser booleano.")
        if pending:
            normalized["APROVACAO"] = "PENDENTE DE APROVAÇÃO"
            conditions.append(f"{self._field(LAUNCHES, 'APROVACAO')['InternalName']} eq 'PENDENTE DE APROVAÇÃO'")
        start = _day(filters["dateStart"]) if not _blank(filters.get("dateStart")) else None
        end = _day(filters["dateEnd"]) if not _blank(filters.get("dateEnd")) else None
        if start and end and start > end:
            _fail("invalid_date_range", "A data inicial deve ser anterior ou igual à final.")
        if end == date.max:
            _fail("invalid_date_range", "Data final fora do intervalo permitido.")
        for day, comparison in ((start, "ge"), (end + timedelta(days=1) if end else None, "lt")):
            if day:
                conditions.append(f"{self._field(LAUNCHES, 'DATA')['InternalName']} {comparison} datetime'{_midnight(day)}'")
        rows = self._rows(LAUNCHES, (*READ_FIELDS, *SEARCH_FIELDS) if terms else READ_FIELDS, " and ".join(conditions))
        selected = []
        for row in rows:
            if any(_norm(row.get(k, "")) != _norm(v) for k, v in normalized.items()):
                continue
            if start or end:
                if not row.get("DATA"):
                    continue
                day = _instant(row["DATA"]).astimezone(TZ).date()
                if (start and day < start) or (end and day > end):
                    continue
            if terms:
                text = self._search_text(row)
                if not all(term in text for term in terms):
                    continue
            selected.append(row)
        label, reverse = SORT_OPTIONS[sort]
        self._field(LAUNCHES, label)
        def order(row):
            value = row.get(label)
            return int(row["ID"]) if label == "ID" else (_instant(value).timestamp() if value else float("-inf"))
        selected.sort(key=lambda row: int(row["ID"]), reverse=True)
        selected.sort(key=order, reverse=reverse)
        totals = {key: Decimal(0) for key in ("committed", "liquidated", "pending", "paid", "total")}
        for row in selected:
            amount = self._amount(row)
            category = "paid" if row.get("DATA PGTO EFETUADO") else ("liquidated" if row.get("DATA PGTO PREVISTO") else "committed")
            totals[category] += amount
            totals["total"] += amount
            if category != "paid":
                totals["pending"] += amount
        # Filters select records, not the replacement choices for the next search.
        # Reuse the full read when possible; otherwise read only catalog columns.
        option_rows = self._rows(LAUNCHES, [label for key, label in FILTER_FIELDS.items() if key != "id"]) if conditions else rows
        options = {key: sorted({str(row[label]) for row in option_rows if not _blank(row.get(label))}, key=_norm)
                   for key, label in FILTER_FIELDS.items() if key != "id"}
        return {"rows": [self._row(r) for r in selected[(page-1)*size:page*size]], "count": len(selected),
                "page": page, "pageSize": size, "pages": math.ceil(len(selected)/size),
                "totals": {k: _money(v) for k, v in totals.items()}, "filterOptions": options, "sortOptions": list(SORT_OPTIONS)}

    def _catalog(self, name, columns):
        key = (name, tuple(columns))
        if key not in self._catalog_cache:
            self._catalog_cache[key] = self._rows(name, columns)
        return self._catalog_cache[key]

    def _options(self, name, label, meta, context):
        choices = meta.get("Choices", [])
        if isinstance(choices, dict):
            choices = choices.get("results", [])
        if choices:
            return [{"value": v, "label": str(v)} for v in choices]
        if label in FIXED_CHOICES:
            return [{"value": v, "label": v} for v in FIXED_CHOICES[label]]
        if name == MEASUREMENTS and label == "STATUS":
            return [{"value": v, "label": v} for v in ("ATIVO", "INATIVO")]
        if label in CATALOGS:
            source, column = CATALOGS[label]
            status_field = "SATUS" if label == "PRODUTO" else "STATUS"
            rows = self._catalog(source, [column, status_field, "FILIAL"])
            values = sorted({str(r[column]) for r in rows if not _blank(r.get(column))
                             and (label != "PRODUTO" or r.get(status_field) == "ATIVO")
                             and (label != "ETAPA" or not context.get("FILIAL") or r.get("FILIAL") == context["FILIAL"])}, key=_norm)
            return [{"value": v, "label": v} for v in values]
        if label in {"CONTRATO", "NUMEROCONTRATO", "MEDICAOPARCIAL", "DEMONSTRATIVOETAPA"}:
            source = MEASUREMENTS if label == "MEDICAOPARCIAL" else ("DEMONSTRATIVOETAPA" if label == "DEMONSTRATIVOETAPA" else "EMPREITEIRO")
            rows = self._catalog(source, ["FORNECEDOR", "FILIAL", "STATUS", "NUMEROCONTRATO", "ATIVIDADEEXECUTADA", "IMOVEL"])
            if name == MEASUREMENTS and source == "EMPREITEIRO":
                rows = [r for r in rows if r.get("STATUS") == "ATIVO"]
            if source == "DEMONSTRATIVOETAPA":
                rows = [r for r in rows if r.get("STATUS") == "ATIVIDADE INICIADA" and r.get("FORNECEDOR") == context.get("FORNECEDOR")]
            if source == "DEMONSTRATIVOETAPA":
                return [{"value": str(r["ID"]), "label": (
                    f"{r['ID']} - {r.get('ATIVIDADEEXECUTADA') or r['ID']} "
                    f"({r.get('FORNECEDOR') or ''} - {r.get('IMOVEL') or ''})"
                ).strip()} for r in rows]
            return [{"value": str(r["ID"]), "label": f"{r['ID']} - {r.get('FORNECEDOR') or r['ID']}"} for r in rows]
        if meta.get("TypeAsString") in {"Lookup", "LookupMulti"}:
            # Only actual lookup metadata can choose a list; never use a caller URL.
            guid = str(meta.get("LookupList", "")).strip("{}")
            if not re.fullmatch(r"[0-9a-fA-F-]{36}", guid):
                _fail("schema_missing", f"Lookup sem lista válida: {label}.", 503)
            lookup = self.sharepoint._request("GET", f"web/lists(guid'{guid}')", params={"$select": "Title"})
            source = lookup.get("d", lookup).get("Title")
            column = meta.get("LookupField") or "Title"
            return [{"value": str(r["ID"]), "label": str(r.get(column) or r["ID"])} for r in self._catalog(source, [column])]
        return []

    @staticmethod
    def _writable(meta):
        return not meta.get("ReadOnlyField") and meta.get("TypeAsString") not in {"Computed", "Calculated", "Counter", "Attachments", "User", "UserMulti"}

    def _schema(self, name, allowed, context):
        result = []
        for label in allowed:
            meta = self._field(name, label, optional=True)
            if not meta or not self._writable(meta):
                continue
            options = self._options(name, label, meta, context)
            kind = {"Number": "number", "Currency": "currency", "DateTime": "date", "Boolean": "boolean", "Note": "textarea",
                    "Lookup": "lookup", "LookupMulti": "lookup", "MultiChoice": "multichoice"}.get(meta.get("TypeAsString"), "text")
            if label in {"FRETE", "VALOR UNITÁRIO", "VALORTOTAL", "SALDOCONTRATO"}:
                kind = "currency"
            elif label in {"QUANTIDADE", "QTD"}:
                kind = "number"
            if options and kind not in {"lookup", "multichoice"}:
                kind = "lookup" if label in {"CONTRATO", "NUMEROCONTRATO", "MEDICAOPARCIAL", "DEMONSTRATIVOETAPA"} else "choice"
            result.append({"name": label, "label": label, "type": kind,
                           "required": bool(meta.get("Required")) or label == "NUMEROCONTRATO",
                           "options": options})
        return result

    def _value(self, name, label, value, meta, context, check_options=True):
        if _blank(value):
            if meta.get("Required") or label == "NUMEROCONTRATO":
                _fail("required_field", f"Campo obrigatório: {label}.")
            return None
        kind = meta.get("TypeAsString")
        if check_options:
            options = self._options(name, label, meta, context)
            restricted = bool(options) or label in CATALOGS or label in FIXED_CHOICES or label in {
                "CONTRATO", "NUMEROCONTRATO", "MEDICAOPARCIAL", "DEMONSTRATIVOETAPA"} or kind in {"Choice", "MultiChoice", "Lookup", "LookupMulti"}
            submitted = value if kind in {"LookupMulti", "MultiChoice"} and isinstance(value, list) else [value]
            if restricted and any(isinstance(v, (dict, list, bool)) or str(v) not in {str(o["value"]) for o in options} for v in submitted):
                _fail("invalid_choice", f"Valor não permitido para {label}.")
        if kind in {"Number", "Currency"} or label in {"QTD", "VALORTOTAL", "SALDOCONTRATO", "QUANTIDADE", "FRETE", "VALOR UNITÁRIO"}:
            number = _number(value)
            for key, test in (("MinimumValue", lambda limit: number < limit), ("MaximumValue", lambda limit: number > limit)):
                if meta.get(key) is not None and test(Decimal(str(meta[key]))):
                    _fail("invalid_number", f"Valor fora do limite de {label}.")
            value = float(number)
        elif kind == "DateTime":
            return _midnight(_day(value))
        elif kind == "Boolean":
            if not isinstance(value, bool):
                _fail("invalid_boolean", f"{label} deve ser booleano.")
            return value
        elif kind == "Lookup":
            return int(_id(value))
        elif kind in {"LookupMulti", "MultiChoice"}:
            if not isinstance(value, list):
                _fail("invalid_choice", f"{label} deve ser uma lista.")
            return {"results": [int(_id(v)) for v in value] if kind == "LookupMulti" else value}
        elif kind not in {"Text", "Note", "Choice"}:
            _fail("unsupported_field", f"Tipo de campo não suportado: {label}.")
        if kind in {"Text", "Note", "Choice"}:
            if isinstance(value, (dict, list, bool)) or not isinstance(value, (str, int, float)):
                _fail("invalid_text", f"Texto inválido: {label}.")
            value = str(value)
            if len(value) > int(meta.get("MaxLength") or (63999 if kind == "Note" else 255)):
                _fail("text_too_long", f"Texto excede o limite de {label}.")
        return value

    def _validate(self, name, values, allowed, current):
        if not isinstance(values, dict) or not values:
            _fail("invalid_fields", "Informe fields com ao menos um campo editável.")
        if set(values) - set(allowed):
            _fail("forbidden_field", "fields contém campo não autorizado para edição.")
        context = current | values
        result = {}
        for label, value in values.items():
            meta = self._field(name, label)
            if not self._writable(meta):
                _fail("readonly_field", f"Campo somente leitura: {label}.")
            result[label] = self._value(name, label, value, meta, context)
        return result

    def _check_measurement_pair(self, values, current):
        if not (set(values) & {"CONTRATO", "MEDICAOPARCIAL"}):
            return
        combined = current | values
        if combined.get("MEDICAOPARCIAL"):
            row = self._get(MEASUREMENTS, _id(combined["MEDICAOPARCIAL"]), ["NUMEROCONTRATO"])
            if str(row.get("NUMEROCONTRATO")) != str(combined.get("CONTRATO")):
                _fail("invalid_relationship", "Medição parcial não pertence ao contrato informado.")

    def _body(self, name, fields):
        result = {}
        for label, value in fields.items():
            meta = self._field(name, label)
            if not self._writable(meta):
                _fail("readonly_field", f"Campo somente leitura: {label}.")
            key = meta["InternalName"] + ("Id" if meta.get("TypeAsString") in {"Lookup", "LookupMulti"} else "")
            result[key] = value
        return result

    def _write(self, item_id, values, current):
        body = self._body(LAUNCHES, values)
        self.sharepoint._request("POST", self._item_endpoint(LAUNCHES, item_id), json=body,
            headers={"Content-Type": "application/json;odata=nometadata", "IF-MATCH": self._etag(current), "X-HTTP-Method": "MERGE"})

    def _create_fields(self, operation, payload, item_id, current):
        if operation == "payment":
            planned = _day(payload.get("date")).isoformat()
            headers = ["Índice", "Data", "DATAPREVISTOPGTO", "DATAPGTOEFETUADO", "FILIAL", "FORNECEDOR", "PRODUTO", "VLRPAGO", "MEDIO", "OBS", "STATUS"]
            description = "<table border='1' width='100%'><thead><tr>" + "".join(f"<th style='text-align:center;'>{h}</th>" for h in headers) + "</tr></thead>"
            fields = {"PRODUTO": current.get("PRODUTO"), "STATUS": "PAGAMENTO PREVISTO", "VALOR TOTAL": _money(self._amount(current)),
                      "DATA PREVISTO PGTO": planned, "FORNECEDOR": current.get("FORNECEDOR"), "FILIAL": current.get("FILIAL"),
                      "TIPO": "DESPESA" if current.get("TIPO TRANSAÇÃO") == "CUSTO" else current.get("TIPO TRANSAÇÃO"),
                      "DATA": _instant(current["DATA"]).astimezone(TZ).date().isoformat() if current.get("DATA") else None, "DESCRICAO": description}
            if self._field(PROVISIONS, "IDLANCAMENTOS", optional=True):
                fields["IDLANCAMENTOS"] = item_id
            return PROVISIONS, self._create_body(PROVISIONS, fields), None
        supplied = payload.get("fields")
        if not isinstance(supplied, dict) or not supplied.get("NUMEROCONTRATO"):
            _fail("required_field", "Informe fields.NUMEROCONTRATO para vincular a medição.")
        contract_id = _id(supplied["NUMEROCONTRATO"])
        contract = self._get("EMPREITEIRO", contract_id, ["FILIAL", "FORNECEDOR", "STATUS", "TIPO DE MEDIÇÃO", "ATIVIDADEEXECUTADA", "VALORTOTAL"])
        if contract.get("STATUS") != "ATIVO":
            _fail("inactive_contract", "O contrato da medição precisa estar ATIVO.")
        context = current | {"FILIAL": contract.get("FILIAL"), "FORNECEDOR": contract.get("FORNECEDOR")}
        values = self._validate(MEASUREMENTS, supplied, MEASUREMENT_FIELDS, context)
        # A new form may submit every optional input empty. Keep G1's server
        # defaults for those inputs; required blanks have already been rejected.
        values = {label: value for label, value in values.items() if value is not None}
        defaults = {"IDLANCAMENTO": item_id, "NUMEROCONTRATO": contract_id, "FILIAL": contract.get("FILIAL"),
                    "FORNECEDOR": contract.get("FORNECEDOR"), "ETAPA OBRA": current.get("ETAPA"),
                    "TIPODEMEDICAO": contract.get("TIPO DE MEDIÇÃO"), "QTD": current.get("QUANTIDADE"),
                    "VALORTOTAL": float(self._amount(current, freight=False)), "ATIVIDADE": contract.get("ATIVIDADEEXECUTADA"),
                    "SALDOCONTRATO": contract.get("VALORTOTAL"), "STATUS": "ATIVO"}
        # Values already validated (including dates); avoid parsing ISO instants a second time.
        body = self._create_body(MEASUREMENTS, {k: v for k, v in defaults.items() if k not in values})
        body.update(self._body(MEASUREMENTS, values))
        self._required(MEASUREMENTS, body)
        return MEASUREMENTS, body, contract_id

    def _required(self, name, body):
        for meta in self._metadata(name):
            internal = meta["InternalName"]
            if internal != "Title" and meta.get("Required") and self._writable(meta):
                key = internal + ("Id" if meta.get("TypeAsString") in {"Lookup", "LookupMulti"} else "")
                if key not in body or _blank(body[key]):
                    _fail("required_field", f"Campo obrigatório ausente: {meta.get('Title', internal)}.")

    def _create_body(self, name, fields):
        validated = {label: self._value(name, label, value, self._field(name, label), fields, check_options=False) for label, value in fields.items()}
        return self._body(name, validated)

    def _find_created(self, name, token):
        title = self._field(name, "Title")
        rows = self._rows(name, ["Title"], f"{title['InternalName']} eq {_literal(token)}")
        matches = [row for row in rows if row.get("Title") == token]
        if len(matches) > 1:
            _fail("duplicate_request", "Mais de um registro com a chave da operação; reconciliação necessária.", 409)
        return str(matches[0]["ID"]) if matches else None

    def _create(self, operation, payload, item_id, current):
        request_id = payload.get("requestId")
        if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{8,128}", request_id):
            _fail("request_id_required", "requestId obrigatório: 8–128 caracteres alfanuméricos, ponto, hífen, dois-pontos ou sublinhado.")
        store = getattr(self.engine, "state_store", None)
        if store is None or not callable(getattr(store, "save", None)) or not callable(getattr(store, "load", None)):
            _fail("idempotency_unavailable", "Criação requer state_store persistente com controle de concorrência.", 503)
        try:
            fingerprint = hashlib.sha256(json.dumps({k: v for k, v in payload.items() if k not in {"confirm", "expectedModified"}}, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()
        except (ValueError, TypeError):
            _fail("invalid_payload", "Dados inválidos para a criação.")
        scope = self.sharepoint.site_url + ":" + operation + ":" + request_id
        digest = hashlib.sha256(scope.encode()).hexdigest()
        key, token = f"launch-gallery/{digest}", f"launch-gallery:{operation}:{digest}"
        try:
            record, tag = store.load(key)
        except Exception:
            _fail("idempotency_unavailable", "Não foi possível consultar o controle de idempotência; nenhuma criação iniciada.", 503)
        if record and record.get("fingerprint") != fingerprint:
            _fail("request_id_conflict", "requestId já utilizado com outro conteúdo.", 409)
        if record and record.get("result"):
            return record["result"]
        target = PROVISIONS if operation == "payment" else MEASUREMENTS
        created_id = self._find_created(target, token) if record else None
        if record and not created_id:
            _fail("request_in_progress", "Criação em andamento ou com resultado incerto. Reuse requestId; não envie uma nova chave.", 409)
        if not created_id:
            self._check_version(payload, current)
            target, body, contract_id = self._create_fields(operation, payload, item_id, current)
            title = self._field(target, "Title")
            if not self._writable(title) or title.get("TypeAsString") != "Text":
                _fail("idempotency_unavailable", "A lista precisa de Title gravável para reconciliar requestId.", 503)
            body[title["InternalName"]] = token
            self._required(target, body)
            record = {"fingerprint": fingerprint, "contract": contract_id, "status": "pending"}
            try:
                tag = store.save(key, record, tag)
            except Exception:
                _fail("request_in_progress", "Não foi possível reservar requestId; repita com a mesma chave.", 409)
            try:
                created = self.sharepoint._request("POST", f"{self._list_endpoint(target)}/items", json=body,
                                                  headers={"Content-Type": "application/json;odata=nometadata"})
                created_id = _id(created.get("d", created).get("Id"))
            except (requests.RequestException, LaunchGalleryError):
                created_id = self._find_created(target, token)
                if not created_id:
                    _fail("create_uncertain", "Resultado da criação incerto. Reuse requestId para consultar; não envie uma nova chave.", 409)
        result = {"ok": True, "id": item_id, "provisionId" if operation == "payment" else "measurementId": created_id}
        if operation == "measurement":
            current = self._get(LAUNCHES, item_id, READ_FIELDS)
            if str(current.get("CONTRATO") or "") != record["contract"]:
                try:
                    self._check_version(payload, current)
                    contract_meta = self._field(LAUNCHES, "CONTRATO")
                    value = self._value(LAUNCHES, "CONTRATO", record["contract"], contract_meta, current)
                    self._write(item_id, {"CONTRATO": value}, current)
                except (LaunchGalleryError, requests.RequestException):
                    _fail("measurement_link_pending", f"Medição {created_id} criada; vínculo com lançamento pendente. Atualize detail e repita o mesmo requestId.", 409, measurementId=created_id)
        try:
            store.save(key, record | {"status": "complete", "result": result}, tag)
        except Exception:
            _fail("completion_pending", "Registro criado; confirmação pendente. Reuse o mesmo requestId.", 409,
                  **{k: v for k, v in result.items() if k.endswith("Id")})
        return result

    @staticmethod
    def _filename(value):
        if not isinstance(value, str) or not value or len(value) > 255 or value.strip() != value:
            _fail("invalid_filename", "Nome de arquivo inválido.")
        if value in {".", ".."} or value.endswith(".") or re.search(r'[\\/:*?"<>|\x00-\x1f\x7f]', value) or unquote(value) != value:
            _fail("invalid_filename", "Informe somente o nome do arquivo, sem caminho ou URL.")
        return value

    def _attachments(self, item_id):
        return sorted({self._filename(row.get("FileName")) for row in self._pages(
            f"{self._item_endpoint(LAUNCHES, item_id)}/AttachmentFiles", {"$select": "FileName", "$top": "5000"})}, key=_norm)

    @staticmethod
    def _content(payload, limit):
        content = payload.get("content")
        mime = payload.get("mimeType")
        if not isinstance(content, bytes) or not content or len(content) > limit:
            _fail("invalid_content", f"content deve conter bytes não vazios, até {limit} bytes.")
        if not isinstance(mime, str) or not re.fullmatch(r"[a-zA-Z0-9!#$&^_.+-]+/[a-zA-Z0-9!#$&^_.+-]+", mime):
            _fail("invalid_mime", "mimeType inválido.")
        return content, mime

    def _attachment(self, operation, item_id, payload, current):
        name = self._filename(payload.get("fileName"))
        names = self._attachments(item_id)
        endpoint = f"{self._item_endpoint(LAUNCHES, item_id)}/AttachmentFiles"
        encoded = quote(name.replace("'", "''"), safe="'")
        if operation == "attachment_add":
            if any(n.casefold() == name.casefold() for n in names):
                _fail("attachment_exists", "Já existe um anexo com esse nome; nenhum arquivo foi sobrescrito.", 409)
            content, mime = self._content(payload, MAX_ATTACHMENT_BYTES)
            self.sharepoint._request("POST", f"{endpoint}/add(FileName='{encoded}')", data=content,
                headers={"Content-Type": mime, "IF-MATCH": self._etag(current)})
            return {"ok": True, "id": item_id, "fileName": name}
        if name not in names:
            _fail("attachment_not_found", "O arquivo não pertence aos anexos deste lançamento.", 404)
        endpoint += f"/getByFileName('{encoded}')"
        if operation == "attachment_delete":
            self.sharepoint._request("POST", endpoint, headers={"IF-MATCH": self._etag(current), "X-HTTP-Method": "DELETE"})
            return {"ok": True, "id": item_id, "fileName": name}
        url = f"{self.sharepoint.site_url}/_api/{endpoint}/$value"
        headers = {"Authorization": f"Bearer {self.sharepoint._token()}", "Accept": "application/octet-stream"}
        response = self.sharepoint.session.get(url, headers=headers, timeout=(10, 120), allow_redirects=False)
        if response.status_code == 401:
            headers["Authorization"] = f"Bearer {self.sharepoint._token(refresh=True)}"
            response = self.sharepoint.session.get(url, headers=headers, timeout=(10, 120), allow_redirects=False)
        if 300 <= response.status_code < 400:
            _fail("attachment_redirect", "Download do anexo retornou redirecionamento inesperado.", 502)
        response.raise_for_status()
        return {"content": response.content, "fileName": name,
                "mimeType": mimetypes.guess_type(name)[0] or "application/octet-stream"}

    def _signature(self, item_id, payload, current):
        content, mime = self._content(payload, MAX_SIGNATURE_BYTES)
        if mime != "image/png":
            _fail("invalid_signature", "A assinatura deve ser uma imagem PNG.")
        try:
            with Image.open(io.BytesIO(content)) as image:
                if image.format != "PNG" or image.width * image.height > 16000000:
                    raise ValueError
                image.verify()
        except (OSError, ValueError, Image.DecompressionBombError):
            _fail("invalid_signature", "Assinatura PNG inválida.")
        signature = json.dumps("data:image/png;base64," + base64.b64encode(content).decode("ascii"))
        meta = self._field(LAUNCHES, "ASSINATURA")
        maximum = int(meta.get("MaxLength") or (63999 if meta.get("TypeAsString") == "Note" else 255))
        if len(signature) > maximum:
            _fail("signature_too_large", "A assinatura excede a capacidade do campo ASSINATURA; reduza a imagem.")
        self._write(item_id, {"ASSINATURA": signature}, current)
