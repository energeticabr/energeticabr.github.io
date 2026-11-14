"""Authenticated Trancid corporate portal operations using its normal WebForms controls."""

import io
import json
import logging
import os
import re
import shlex
import sys
import unicodedata
from datetime import datetime, timedelta, timezone
from html import escape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit


LOGGER = logging.getLogger(__name__)
MONITOR_ROOT = Path("/opt/energetica-whatsapp/trancid-monitor")
CONFIG_FILE = Path("/etc/energetica-trancid.env")
HISTORY_PATH = "/frmSelPedidoExistente.aspx"
HISTORY_PAGE = "/frmSelPedidoExistenteCI.aspx"
CREATE_PAGE = "/frmSelGrupoNovoPedido.aspx"
DRAFT_PAGE = "/frmPedidoCargaIndividual.aspx"
LOGOUT_PATH = "/frmLogout.aspx?encerra=true&popup=true"
BRT = timezone(timedelta(hours=-3))
MONEY = r"(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}"
CARD = r"\d{14}"
ORDER_CODE = r"\d{4,12}"
DATE = r"\d{2}/\d{2}/\d{4}"
SENT_STATUSES = {"ENVIADO", "FINALIZADO"}
MAX_HISTORY_PAGES = 100


class PortalError(RuntimeError):
    """The portal operation failed without creating or sending a recharge."""


class PortalUncertain(PortalError):
    """A draft or final order may exist. Preserve the ID and reconcile before retrying."""

    def __init__(self, message, order_code=None):
        super().__init__(message)
        self.order_code = order_code


def normalize(value):
    return "".join(
        char for char in unicodedata.normalize("NFD", value.upper())
        if unicodedata.category(char) != "Mn"
    )


def cents(value):
    if not re.fullmatch(MONEY, value):
        raise PortalError("Valor retornado pela Trancid em formato desconhecido.")
    return int(value.replace(".", "").replace(",", ""))


def format_amount(value):
    whole, fractional = divmod(value, 100)
    return f"{whole},{fractional:02d}"


class Row:
    def __init__(self):
        self.cells = []
        self.inputs = {}
        self.links = []
        self.in_cell = False

    def values(self):
        return [" ".join(cell) for cell in self.cells]


class Form(HTMLParser):
    """Read visible text, successful inputs and direct rows in the known tables."""

    def __init__(self, html):
        super().__init__()
        self.fields = {}
        self.inputs = {}
        self.buttons = {}
        self.tables = {}
        self.words = []
        self._select = None
        self._tables = []
        self._skip = 0
        self.feed(html)

    @property
    def text(self):
        return " ".join(self.words)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        table, row = self._tables[-1] if self._tables else (None, None)
        if tag in ("script", "style"):
            self._skip += 1
        elif tag == "table":
            table = [] if attrs.get("id") in ("gridPedido", "gridPedidos") else None
            self._tables.append((table, None))
            if table is not None:
                self.tables[attrs["id"]] = table
        elif tag == "tr" and table is not None:
            row = Row()
            table.append(row)
            self._tables[-1] = (table, row)
        elif tag in ("td", "th") and row is not None:
            row.cells.append([])
            row.in_cell = True
        elif tag == "a" and row is not None:
            row.links.append(attrs.get("href", ""))
        elif tag == "select":
            self._select = attrs.get("name") if "disabled" not in attrs else None
        elif tag == "option" and self._select and "disabled" not in attrs:
            if "selected" in attrs or self._select not in self.fields:
                self.fields[self._select] = attrs.get("value", "")
        elif tag in ("input", "button"):
            if attrs.get("id"):
                self.buttons[attrs["id"]] = attrs
            if tag == "input" and attrs.get("name"):
                self._input(attrs, row)

    def _input(self, attrs, row):
        name = attrs["name"]
        self.inputs[name] = attrs
        if row is not None:
            row.inputs[name] = attrs
        input_type = attrs.get("type", "text").lower()
        if "disabled" not in attrs and (
            input_type in ("hidden", "text", "password")
            or input_type in ("radio", "checkbox") and "checked" in attrs
        ):
            self.fields[name] = attrs.get("value", "on" if input_type == "checkbox" else "")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._skip = max(0, self._skip - 1)
        elif tag == "select":
            self._select = None
        elif tag == "table" and self._tables:
            self._tables.pop()
        elif tag in ("tr", "td", "th") and self._tables:
            table, row = self._tables[-1]
            if row is not None:
                row.in_cell = False
                if tag == "tr":
                    self._tables[-1] = (table, None)

    def handle_data(self, data):
        words = " ".join(data.split())
        if not words or self._skip:
            return
        self.words.append(words)
        if self._tables:
            _, row = self._tables[-1]
            if row is not None and row.in_cell:
                row.cells[-1].append(words)


def parse_cards(html):
    text = Form(html).text
    if not re.search(r"\bENERGETICA\b", normalize(text)):
        raise PortalError("O cadastro ativo não confirmou a titularidade da Energética.")
    count = re.search(r"Total de Cartões:\s*(\d+)", text)
    if not count:
        raise PortalError("Total de cartões ausente no cadastro ativo da Trancid.")
    pattern = rf"\b({CARD})\s+(.+?)\s+\d+\s+Ativo\s+-?{MONEY}\b"
    cards = [
        {"id": card, "name": name, "cardLast4": card[-4:]}
        for card, name in re.findall(pattern, text)
    ]
    if len(cards) != int(count[1]) or len({card["id"] for card in cards}) != len(cards):
        raise PortalError("Cadastro ativo da Trancid retornou cartões incompletos ou duplicados.")
    return cards


def require_tenant(form):
    if not re.search(r"\bTITULAR\s*:\s*ENERGETICA\s+CODIGO\s*:\s*14660\b", normalize(form.text)):
        raise PortalError("A sessão da Trancid não confirmou a titularidade da Energética.")


def portal_date(value):
    try:
        return datetime.strptime(value, "%d/%m/%Y").date().isoformat()
    except ValueError as error:
        raise PortalError("A Trancid retornou uma data inválida.") from error


def history_rows(form):
    require_tenant(form)
    grid = form.tables.get("gridPedido")
    if not grid:
        if re.search(r"NENHUM (?:REGISTRO|PEDIDO)(?: DE CARGA)? (?:FOI )?ENCONTRADO",
                     normalize(form.text)):
            return []
        raise PortalError("Grade de pedidos da Trancid não localizada.")
    header = [normalize(value) for value in grid[0].values()]
    if len(header) != 6 or header[1:] != [
        "Nº PEDIDO", "DATA PEDIDO", "STATUS PEDIDO", "VALOR PEDIDO", "FORMA DE PAGAMENTO",
    ]:
        raise PortalError("A Trancid alterou as colunas do histórico de pedidos.")
    orders = []
    for row in grid[1:]:
        values = row.values()
        if len(values) != 6 or not re.fullmatch(ORDER_CODE, values[1]) or not values[3] or not values[5]:
            raise PortalError("A Trancid retornou uma linha de histórico incompleta.")
        _, code, created, status, amount, payment = values
        orders.append(({
            "orderCode": code,
            "requestDate": portal_date(created),
            "status": status,
            "creditCents": cents(amount),
            "paymentMethod": normalize(payment),
        }, row))
    if len({order["orderCode"] for order, _ in orders}) != len(orders):
        raise PortalError("A Trancid retornou pedidos duplicados na mesma página.")
    return orders


def history_pager(form):
    fields = [(name, value) for name, value in form.fields.items() if name.endswith(":txtRegistroIni")]
    if not fields:
        return 1, 1, None
    total = re.search(r"\bPAGINA\s+DE\s+(\d+)\b", normalize(form.text))
    if len(fields) != 1 or not total or not fields[0][1].isdigit():
        raise PortalError("A paginação do histórico da Trancid mudou.")
    name, value = fields[0]
    page, count = int(value), int(total[1])
    button = name.rsplit(":", 1)[0] + ":btnProximo"
    attrs = form.inputs.get(button, {})
    if not 1 <= page <= count or (page < count and (
        attrs.get("type") != "image" or "disabled" in attrs
    )):
        raise PortalError("A Trancid retornou uma página de pedidos inconsistente.")
    return page, count, button


def event_fields(form, target):
    return {**form.fields, "__EVENTTARGET": target, "__EVENTARGUMENT": ""}


def verify_button(form, identifier, script):
    attrs = form.buttons.get(identifier, {})
    if "disabled" in attrs or script not in attrs.get("onclick", ""):
        raise PortalError("A ação esperada no formulário da Trancid não está disponível.")


def draft_number(form):
    match = re.search(rf"Nº SOLICITACAO PEDIDO DE CARGA:\s*({ORDER_CODE})\b", normalize(form.text))
    return match[1] if match else None


def draft_fields(form, order_code, expected, today):
    require_tenant(form)
    text = normalize(form.text)
    amount = re.search(rf"VALOR TOTAL DO PEDIDO\(R\$\):\s*({MONEY})\b", text)
    count = re.search(r"TOTAL DE CARTOES NO PEDIDO:\s*(\d+)\b", text)
    created = re.search(rf"DATA DO PEDIDO:\s*({DATE})\b", text)
    grid = form.tables.get("gridPedidos")
    if (draft_number(form) != order_code or not amount or not count or not created or not grid
            or not re.search(r"\bFORMA DE PAGAMENTO:\s*BOLETO\b", text)
            or portal_date(created[1]) != today or cents(amount[1]) != sum(expected.values())):
        raise PortalError("A prévia da Trancid diverge do código, da data, do boleto ou do valor de créditos.")
    cards = {}
    for row in grid[1:]:
        values = row.values()
        names = [name for name in row.inputs if re.fullmatch(r"gridPedidos:_ctl\d+:txtTotalCarga", name)]
        if not values or not re.fullmatch(CARD, values[0]) or len(names) != 1 or names[0] not in form.fields:
            raise PortalError("A prévia da Trancid não vinculou um valor editável a cada cartão.")
        card, name = values[0], names[0]
        if card in cards or card not in expected or cents(form.fields[name]) != expected[card]:
            raise PortalError("A prévia da Trancid contém cartão ou valor de recarga divergente.")
        cards[card] = name
    if cards.keys() != expected.keys() or int(count[1]) != len(expected):
        raise PortalError("A prévia da Trancid não contém exatamente o cadastro ativo esperado.")
    return cards


def config_values():
    keys = {"TRANCID_USERNAME", "TRANCID_PASSWORD", "TRANCID_DB_PATH"}
    config = {key: os.environ[key] for key in keys if os.environ.get(key)}
    if keys - config.keys():
        for line in CONFIG_FILE.read_text(encoding="utf-8-sig").splitlines():
            name, separator, value = line.strip().partition("=")
            if separator and name.strip() in keys - config.keys():
                config[name.strip()] = shlex.split(value)[0] if value[:1] in ('"', "'") else value
    if not all(config.get(key) for key in keys):
        raise PortalError("A configuração protegida da Trancid está incompleta.")
    return config


class Portal:
    """One portal session serialized with the existing balance collector."""

    def __init__(self):
        self.collector = None
        self.origin = None
        self.balance_url = None
        self.lock = None
        self.authenticated = False
        self.today = lambda: datetime.now(BRT).date()

    def __enter__(self):
        try:
            import fcntl

            config = config_values()
            self.lock = (Path(config["TRANCID_DB_PATH"]).parent / "collector.lock").open("a")
            try:
                fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise PortalError("A Trancid está em uso pelo coletor de saldo. Tente novamente em instantes.") from error
            if str(MONITOR_ROOT) not in sys.path:
                sys.path.insert(0, str(MONITOR_ROOT))
            from collector import BALANCE_URL, ORIGIN, Collector, document, parse_login

            self.origin, self.balance_url = ORIGIN, BALANCE_URL
            self.collector = Collector()
            # Keep the scheduled collector's persisted session untouched.
            self.collector.jar.clear()
            _, page = self._read(self.origin + "/")
            url, page = self._read(
                self.origin + "/frmLogin.aspx",
                parse_login(page, config["TRANCID_USERNAME"], config["TRANCID_PASSWORD"]),
            )
            if urlsplit(url).path.lower().endswith("/frmlogin.aspx") or "txtEmailTitular" in document(page).values:
                if "JA EXISTE UMA CONEXAO" in normalize(Form(page).text):
                    raise PortalError("Já existe uma sessão aberta na Trancid. Aguarde o encerramento.")
                raise PortalError("A Trancid recusou a sessão corporativa.")
            self.authenticated = True
            for frame in document(page).frames:
                if "logout" not in frame.lower():
                    self._read(urljoin(url, frame))
            return self
        except PortalError:
            self.__exit__(None, None, None)
            raise
        except Exception as error:
            self.__exit__(None, None, None)
            raise PortalError("Não foi possível abrir a sessão corporativa da Trancid.") from error

    def __exit__(self, *_):
        try:
            if self.authenticated:
                self._read(self.origin + LOGOUT_PATH)
        except Exception:
            LOGGER.warning("O portal Trancid não confirmou o encerramento da sessão.")
        finally:
            self.authenticated = False
            if self.lock is not None:
                self.lock.close()
                self.lock = None

    def _same_origin(self, url):
        parsed, origin = urlsplit(url), urlsplit(self.origin)
        return (parsed.scheme, parsed.netloc) == (origin.scheme, origin.netloc)

    def _read(self, url, fields=None):
        if not self._same_origin(url):
            raise PortalError("Destino externo recusado na integração da Trancid.")
        try:
            final_url, html = self.collector.read(url, fields) if fields is not None else self.collector.read(url)
        except Exception as error:
            raise PortalError("A Trancid não respondeu à solicitação.") from error
        if not self._same_origin(final_url):
            raise PortalError("A Trancid redirecionou para um destino externo.")
        return final_url, html

    def _pdf_text(self, url):
        if not self._same_origin(url):
            raise PortalError("Exportação da Trancid fora da origem autorizada.")
        try:
            from pypdf import PdfReader

            with self.collector.opener.open(url, timeout=30) as response:
                if not self._same_origin(response.url):
                    raise PortalError("Destino da exportação da Trancid divergente.")
                raw = response.read(5_000_001)
            if len(raw) > 5_000_000 or not raw.startswith(b"%PDF-"):
                raise PortalError("A exportação da Trancid não retornou um PDF válido.")
            return " ".join(
                page.extract_text(extraction_mode="layout") or ""
                for page in PdfReader(io.BytesIO(raw)).pages
            )
        except PortalError:
            raise
        except Exception as error:
            raise PortalError("Não foi possível ler o cadastro ativo da Trancid.") from error

    def directory(self):
        url, html = self._read(self.balance_url)
        if re.search(rf"\b{CARD}\b", Form(html).text):
            return parse_cards(html)
        export = re.search(r'"ExportUrlBase"\s*:\s*("(?:\\.|[^"\\])*")', html)
        if not export:
            raise PortalError("A exportação oficial do cadastro de cartões não foi localizada.")
        text = self._pdf_text(urljoin(url, json.loads(export[1]) + "PDF"))
        return parse_cards("<div>" + escape(text) + "</div>")

    def _history_pages(self, *, require_complete=False):
        url, html = self._read(self.origin + HISTORY_PATH)
        previously_seen = set()
        for requested in range(1, MAX_HISTORY_PAGES + 1):
            if urlsplit(url).path not in (HISTORY_PATH, HISTORY_PAGE):
                raise PortalError("A Trancid não abriu o histórico de pedidos autenticado.")
            form = Form(html)
            orders = history_rows(form)
            codes = {order["orderCode"] for order, _ in orders}
            if previously_seen & codes:
                raise PortalError("A Trancid repetiu pedidos entre páginas do histórico.")
            previously_seen.update(codes)
            page, count, next_button = history_pager(form)
            if page != requested:
                raise PortalError("A Trancid não confirmou o avanço do histórico de pedidos.")
            if require_complete and count > MAX_HISTORY_PAGES:
                raise PortalError("O histórico da Trancid excedeu o limite da consulta completa.")
            has_more = page < min(count, MAX_HISTORY_PAGES)
            yield url, form, orders, page, has_more
            if not has_more:
                return
            fields = event_fields(form, "")
            fields.update({next_button + ".x": "8", next_button + ".y": "8"})
            url, html = self._read(url, fields)

    def history(self, page=1):
        if type(page) is not int or not 1 <= page <= MAX_HISTORY_PAGES:
            raise PortalError("Página de histórico inválida.")
        for _, _, orders, current, has_more in self._history_pages():
            if current == page:
                return {"orders": [order for order, _ in orders], "hasMore": has_more, "page": page}
        return {"orders": [], "hasMore": False, "page": page}

    def all_history(self):
        return [order for _, _, orders, _, _ in self._history_pages(require_complete=True) for order, _ in orders]

    def _order_row(self, order_code):
        for url, form, orders, _, _ in self._history_pages():
            for order, row in orders:
                if order["orderCode"] == order_code:
                    return url, form, order, row
        raise PortalError("O pedido ainda não apareceu no histórico da Trancid.")

    def order(self, order_code):
        """Find an exact order without changing any recharge."""
        if not isinstance(order_code, str) or not re.fullmatch(ORDER_CODE, order_code):
            raise PortalError("Código de pedido da Trancid inválido.")
        return self._order_row(order_code)[2]

    def _reopen_draft(self, order_code, today):
        url, form, order, row = self._order_row(order_code)
        if (order["requestDate"] != today or normalize(order["status"]) != "EM ANDAMENTO"
                or order["paymentMethod"] != "BOLETO"):
            raise PortalError("O histórico não confirmou o rascunho de boleto em andamento.")
        targets = [match[1] for link in row.links if (
            match := re.fullmatch(r"javascript:__doPostBack\('(gridPedido\$_ctl\d+\$_ctl\d+)',''\)", link)
        )]
        if len(targets) != 1:
            raise PortalError("A ação de seleção do rascunho não foi identificada no histórico.")
        url, html = self._read(url, event_fields(form, targets[0]))
        form = Form(html)
        require_tenant(form)
        verify_button(form, "btnAlterar", 'WebForm_PostBackOptions("btnAlterar"')
        return self._read(url, event_fields(form, "btnAlterar"))

    def submit(self, items, payment_method, *, on_draft=None):
        if not isinstance(payment_method, str) or payment_method.upper() != "BOLETO":
            raise PortalError("A Trancid está habilitada para pedidos por boleto.")
        if not isinstance(items, list) or not items:
            raise PortalError("Selecione pelo menos um cartão para recarregar.")
        selected = {}
        for item in items:
            card = item.get("id") if isinstance(item, dict) else None
            amount = item.get("amountCents") if isinstance(item, dict) else None
            if (not isinstance(card, str) or not re.fullmatch(CARD, card)
                    or card in selected or type(amount) is not int or not 0 < amount <= 999_999_999):
                raise PortalError("Há um cartão ou valor de recarga inválido no pedido.")
            selected[card] = amount
        active = {card["id"]: 0 for card in self.directory()}
        if not selected.keys() <= active.keys():
            raise PortalError("Um dos cartões selecionados deixou de constar no cadastro ativo.")
        expected = {**active, **selected}
        uniform_all = selected.keys() == active.keys() and len(set(selected.values())) == 1
        starting_amounts = expected if uniform_all else active
        today = self.today().isoformat()
        existing = {order["orderCode"] for order in self.history()["orders"]}
        url, html = self._read(self.origin + CREATE_PAGE)
        form = Form(html)
        require_tenant(form)
        verify_button(form, "btnInsPedido", "__doPostBack('btnInsPedido','')")
        if (urlsplit(url).path != CREATE_PAGE or form.fields.get("ddlFormaPagamento") != "1"
                or form.fields.get("rblCopiarPedido") != "N"
                or form.fields.get("txtNumDias") != "0" or form.fields.get("txtValorCargaCartao") != "0"):
            raise PortalError("O formulário de novo boleto da Trancid diverge do esperado.")

        order_code = None
        try:
            fields = event_fields(form, "btnInsPedido")
            if uniform_all:
                fields["txtValorCargaCartao"] = format_amount(next(iter(selected.values())))
            url, html = self._read(url, fields)
            form = Form(html)
            order_code = draft_number(form)
            if not order_code or order_code in existing or urlsplit(url).path != DRAFT_PAGE:
                order_code = None
                raise PortalError("A Trancid não confirmou um novo rascunho.")
            inputs = draft_fields(form, order_code, starting_amounts, today)
            if on_draft is not None:
                on_draft(order_code)
            if not uniform_all:
                verify_button(form, "btnGravar", 'WebForm_PostBackOptions("btnGravar"')
                fields = event_fields(form, "btnGravar")
                fields.update({name: format_amount(expected[card]) for card, name in inputs.items()})
                self._read(url, fields)
                # Confirm the saved amounts through a new selection of the exact order.
                url, html = self._reopen_draft(order_code, today)
                if urlsplit(url).path != DRAFT_PAGE:
                    raise PortalError("A Trancid não retornou a prévia do rascunho gravado.")
                form = Form(html)
                draft_fields(form, order_code, expected, today)
            verify_button(form, "btnEnvioTransfacil", 'WebForm_PostBackOptions("btnEnvioTransfacil"')
            try:
                self._read(url, event_fields(form, "btnEnvioTransfacil"))
            except PortalError:
                # A failed response may follow a successful dispatch. Only read back.
                pass
            _, _, order, _ = self._order_row(order_code)
            if (normalize(order["status"]) not in SENT_STATUSES or order["requestDate"] != today
                    or order["paymentMethod"] != "BOLETO" or order["creditCents"] != sum(expected.values())):
                raise PortalError("O histórico da Trancid não confirmou o envio com o valor esperado.")
            return order
        except Exception as error:
            if not isinstance(error, PortalError):
                error = PortalError("A Trancid não confirmou o resultado do pedido.")
            raise PortalUncertain(str(error), order_code) from error
