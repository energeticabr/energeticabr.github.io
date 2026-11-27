import os
import sys
import tempfile
import unittest
from contextlib import ExitStack
from datetime import date
from http.cookiejar import Cookie, LWPCookieJar
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, call, patch

from trancid_portal_adapter import LOGOUT_PATH, Form, Portal, PortalError, PortalUncertain, parse_cards


ORIGIN = "http://provider.example:8082"
CARDS = ["06850000084216", "06850000084217"]


class PortalSessionTests(unittest.TestCase):
    def setUp(self):
        resources = ExitStack()
        self.addCleanup(resources.close)
        directory = resources.enter_context(tempfile.TemporaryDirectory())
        self.root = Path(directory)
        self.active_session = None
        self.session_count = 0
        self.logouts = []
        self.fail_logout = False
        self.lose_login_response = False
        locking = SimpleNamespace(flock=Mock(), LOCK_EX=1, LOCK_NB=2)
        collector = SimpleNamespace(
            ORIGIN=ORIGIN, BALANCE_URL=ORIGIN + '/balance', Collector=self.collector,
            parse_login=lambda *_: {'btnLogin': 'OK'},
            document=lambda page: SimpleNamespace(values=Form(page).fields, frames=[]),
        )
        resources.enter_context(patch.dict(sys.modules, {'collector': collector, 'fcntl': locking}))
        resources.enter_context(patch('trancid_portal_adapter.config_values', return_value={
            'TRANCID_DB_PATH': str(self.root / 'monitor.sqlite'),
            'TRANCID_USERNAME': 'test-user', 'TRANCID_PASSWORD': 'test-password',
        }))

    def collector(self):
        jar = LWPCookieJar()
        login = '<input name="txtEmailTitular">'

        def read(url, fields=None):
            if url == ORIGIN + '/':
                self.session_count += 1
                jar.set_cookie(Cookie(
                    0, 'ASP.NET_SessionId', str(self.session_count), None, False,
                    'provider.example', False, False, '/', True, False, None, True, None, None, {},
                ))
                return ORIGIN + '/frmLogin.aspx', login
            session = next(iter(jar)).value
            if url == ORIGIN + LOGOUT_PATH:
                self.logouts.append(session)
                if self.fail_logout:
                    raise TimeoutError()
                if self.active_session == session:
                    self.active_session = None
                return url, ''
            if fields is not None:
                if self.active_session:
                    return url, login + 'Já existe uma conexão em aberto para esse login no site.'
                self.active_session = session
                if self.lose_login_response:
                    raise TimeoutError()
                return ORIGIN + '/authenticated.aspx', ''
            raise AssertionError(f'Unexpected request: {url}')

        return SimpleNamespace(jar=jar, read=read)

    def test_next_operation_recovers_a_session_left_by_a_stopped_worker(self):
        interrupted = Portal()
        interrupted.__enter__()
        # Model process termination: the OS releases the file lock, but __exit__ never runs.
        interrupted.lock.close()
        self.assertEqual(self.active_session, '1')

        with Portal():
            self.assertEqual(self.logouts, ['1'])
            self.assertEqual(self.active_session, '2')

        with Portal():
            self.assertEqual(self.active_session, '3')
        self.assertEqual(self.logouts, ['1', '2', '3'])
        self.assertIsNone(self.active_session)
        self.assertEqual(list(self.root.iterdir()), [self.root / 'collector.lock'])

    def test_failed_logout_preserves_only_the_own_session_for_recovery(self):
        self.fail_logout = True
        with self.assertLogs('trancid_portal_adapter', 'WARNING'), Portal():
            self.assertEqual(self.active_session, '1')
        files = list(self.root.glob('*.cookies'))
        self.assertEqual(len(files), 1)
        if os.name != 'nt':
            self.assertEqual(files[0].stat().st_mode & 0o777, 0o600)

        self.fail_logout = False
        with Portal():
            self.assertEqual(self.active_session, '2')
        self.assertEqual(self.logouts, ['1', '1', '2'])

    def test_lost_login_response_still_closes_our_session(self):
        self.lose_login_response = True
        with self.assertRaisesRegex(PortalError, 'não respondeu'):
            with Portal():
                self.fail('The login response was lost.')
        self.assertEqual(self.logouts, ['1'])
        self.assertIsNone(self.active_session)

    def test_portal_busy_with_an_external_session_never_requests_logout(self):
        self.active_session = 'external'
        for _ in range(2):
            with self.assertRaisesRegex(PortalError, 'Já existe uma sessão'):
                with Portal():
                    self.fail('The portal already has an external session.')
        self.assertEqual(self.logouts, [])
        self.assertEqual(self.active_session, 'external')
        self.assertEqual(list(self.root.iterdir()), [self.root / 'collector.lock'])


class BoletoTests(unittest.TestCase):
    def test_opens_exact_existing_order_and_rejects_a_different_boleto(self):
        page = ORIGIN + '/frmSelecaoBoletoCI.aspx'
        listing = history([('900001', 'Enviado', '55,00'), ('900002', 'Finalizado', '55,00')])
        listing = (listing.replace('Nº Pedido', 'Código').replace('Data Pedido', 'Data')
                   .replace('Status Pedido', 'Status').replace('Valor Pedido', 'Valor'))
        selected = listing + """<input type="submit" id="btnPedido" name="btnPedido"
            value="Emitir pagamento de pedido" onclick='WebForm_PostBackOptions("btnPedido", "")'>"""
        result = """<script>window.open('frmPgRelCargaBordo.aspx?TituloMenu=Boleto de Carga&parameters=ABC+123=', '_blank');</script>"""
        raw = b'%PDF-1.7'
        for returned, verified in [('900002', True), ('900001', False)]:
            with self.subTest(returned=returned):
                portal = Portal()
                portal.origin = ORIGIN
                portal._read = Mock(side_effect=[(page, listing), (page, selected), (page, result)])
                portal._pdf_bytes = Mock(return_value=raw)
                with patch('trancid_portal_adapter.extract_pdf_text',
                           return_value=f'(+)    Pedido de Carga: {returned}', create=True):
                    if verified:
                        self.assertEqual(portal.order_boleto('900002'), raw)
                    else:
                        with self.assertRaisesRegex(PortalError, 'outro pedido'):
                            portal.order_boleto('900002')
                self.assertEqual(portal._read.call_args_list[0], call(ORIGIN + '/frmSelecaoBoleto.aspx'))
                self.assertEqual(portal._read.call_args_list[1].args[1]['__EVENTTARGET'], 'gridPedido$_ctl4$_ctl0')
                self.assertEqual(portal._read.call_args_list[2].args[1]['btnPedido'], 'Emitir pagamento de pedido')
                portal._pdf_bytes.assert_called_once_with(
                    ORIGIN + '/frmPgRelCargaBordo.aspx?TituloMenu=Boleto%20de%20Carga&parameters=ABC+123=')


def order_report():
    def line(card="", matrícula="", name="", use="", old="", balance="", amount=""):
        return f"{card:20}{matrícula:16}{name:23}{use:52}{old:20}{balance:21}{amount}"
    return "\n".join([
        "Pedido de Carga                       Página: 1",
        "TITULAR : ENERGETICA CONSTRUCOES             CÓDIGO:",
        "                                             14660",
        "Pedido:   900002",
        "Data: 13/11/2026  Valor: 57,50",
        line("Cartão VT", "Matrícula", "Nome", "Utilização", "** Cartão Antigo", "Estimado", "Valor"),
        line(CARDS[0], "01", "PESSOA DE TESTE", "VT", "06850000084001", "3,00", "57,50"),
        line(name="SILVA", use="Funcionário"),
        line(CARDS[1], "02", "SEM RECARGA", "VT", balance="4,00", amount="0,00"),
        line(name="NO PEDIDO", use="Funcionário"),
        "                       Total: 57,50",
        "                       Cartões do pedido: 2",
        "**Cartão bloqueado e substituído             Total de cartões dos pedidos: 2",
        "                                             Total: 57,50",
    ])


def history(orders, page=1, count=1):
    rows = "".join(
        f"""<tr><td><a href="javascript:__doPostBack('gridPedido$_ctl{i}$_ctl0','')">x</a></td>
        <td>{code}</td><td>13/11/2026</td><td>{status}</td><td>{value}</td><td>BOLETO</td></tr>"""
        for i, (code, status, value) in enumerate(orders, 3)
    )
    return f"""<div>TITULAR: ENERGETICA CODIGO: 14660</div>
    <table id="gridPedido"><tr><td>Selecionar</td><td>Nº Pedido</td><td>Data Pedido</td>
    <td>Status Pedido</td><td>Valor Pedido</td><td>Forma de Pagamento</td></tr>{rows}</table>
    Página <input name="_ctl8:txtRegistroIni" value="{page}"> de {count}
    <input type="image" name="_ctl8:btnProximo">
    <input id="btnAlterar" type="button" onclick='WebForm_PostBackOptions("btnAlterar", "")'>"""


def start_form():
    return """TITULAR: ENERGETICA CODIGO: 14660
    <select name="ddlFormaPagamento"><option value="1">Boleto</option><option value="14">PIX</option></select>
    <input name="txtNumDias" value="0"><input name="txtValorCargaCartao" value="0">
    <input type="radio" name="rblCopiarPedido" value="N" checked>
    <input id="btnInsPedido" type="button" onclick="__doPostBack('btnInsPedido','')">"""


def draft(amounts, total, code="900002"):
    rows = "".join(
        f"""<tr><td>{card}</td><td><table><tr><td>nested</td></tr></table></td>
        <td><input name="gridPedidos:_ctl{i}:txtTotalCarga" value="{amount}">
        <input name="gridPedidos:_ctl{i}:txtTotalCargaOrig" value="{amount}"></td></tr>"""
        for i, (card, amount) in enumerate(zip(CARDS, amounts), 2)
    )
    return f"""TITULAR: ENERGETICA CODIGO: 14660
    Nº solicitação pedido de carga: {code} Valor Total do Pedido(R$): {total}
    Data do Pedido: 13/11/2026 Total de cartões no pedido: 2 Forma de Pagamento: BOLETO
    <table id="gridPedidos"><tr><td>Cartão</td></tr>{rows}</table>
    <input id="btnGravar" type="button" onclick='WebForm_PostBackOptions("btnGravar", "")'>
    <input id="btnEnvioTransfacil" type="button" onclick='WebForm_PostBackOptions("btnEnvioTransfacil", "")'>"""


class PortalTest(unittest.TestCase):
    def setUp(self):
        self.portal = Portal()
        self.portal.origin = ORIGIN
        self.portal.today = lambda: date(2026, 11, 13)
        self.portal.directory = Mock(return_value=[{"id": card} for card in CARDS])
        self.portal.collector = Mock()
        self.read = self.portal.collector.read

    def test_order_detail_opens_exact_read_only_report_and_masks_card(self):
        form_url = ORIGIN + "/frmConsultaPedidoCarga.aspx"
        report_url = ORIGIN + "/frmRelPedidoCargaBordoCI.aspx?codpedido=900002"
        form = """TITULAR: ENERGETICA CODIGO: 14660
          <input name="txtPedido" id="txtPedido" type="text"/>
          <input id="btnGerarRel" type="button" onclick='WebForm_PostBackOptions("btnGerarRel", "")'>"""
        self.read.side_effect = [(form_url, form), (form_url,
            """<script>window.open('frmRelPedidoCargaBordoCI.aspx?codpedido=900002', '_blank');</script>"""),
            (report_url, """<script>{"ExportUrlBase":"/Reserved.ReportViewerWebControl.axd?Format="}</script>""")]
        self.portal._pdf_text = Mock(return_value=order_report())
        self.assertEqual(self.portal.order_details("900002"), [
            {"name": "PESSOA DE TESTE SILVA", "cardLast4": "4216", "amountCents": 5750},
        ])
        self.assertEqual(self.read.call_args_list[1].args[1]["txtPedido"], "900002")
        self.assertEqual(self.read.call_args_list[1].args[1]["__EVENTTARGET"], "btnGerarRel")

    def test_report_rejects_wrong_order_tenant_and_incomplete_credits(self):
        from trancid_portal_adapter import parse_order_report

        for before, after in [("900002", "900003"), ("14660", "14661"),
                              ("Total de cartões dos pedidos: 2", "Total de cartões dos pedidos: 3"),
                              ("Valor: 57,50", "Valor: 58,50")]:
            with self.subTest(before=before), self.assertRaises(PortalError):
                parse_order_report(order_report().replace(before, after), "900002")

    def test_parse_active_card_directory_rejects_incomplete_count(self):
        report = f"""<div>Titular ENERGÉTICA Data: 13/11/2026 Hora: 16:00:00
        {CARDS[0]} NOME DA PESSOA 01 Ativo 15,10 Total de Cartões: 1</div>"""
        self.assertEqual(parse_cards(report), [{"id": CARDS[0], "name": "NOME DA PESSOA", "cardLast4": "4216"}])
        with self.assertRaises(PortalError):
            parse_cards(report.replace("Cartões: 1", "Cartões: 2"))

    def test_postback_ignores_unchecked_and_disabled_controls(self):
        form = Form("""<input type="checkbox" name="missing" value="on">
        <input name="disabled" value="a" disabled><input name="enabled" value="b">
        <select name="pay"><option value="1">Boleto</option><option value="14" selected>PIX</option></select>""")
        self.assertEqual(form.fields, {"enabled": "b", "pay": "14"})

    def test_history_uses_confirmed_pagination_and_reports_only_credit(self):
        url = ORIGIN + "/frmSelPedidoExistenteCI.aspx"
        self.read.side_effect = [(url, history([("900003", "Enviado", "50,00")], 1, 2)),
                                 (url, history([("900002", "Finalizado", "220,00")], 2, 2))]
        self.assertEqual(self.portal.history(2), {"page": 2, "hasMore": False, "orders": [
            {"orderCode": "900002", "status": "Finalizado", "requestDate": "2026-11-13",
             "paymentMethod": "BOLETO", "creditCents": 22000}]})
        self.assertIn("_ctl8:btnProximo.x", self.read.call_args.args[1])

    def test_submit_subset_saves_exact_amounts_and_sends_once(self):
        initial_url = ORIGIN + "/frmSelGrupoNovoPedido.aspx"
        history_url = ORIGIN + "/frmSelPedidoExistenteCI.aspx"
        draft_url = ORIGIN + "/frmPedidoCargaIndividual.aspx"
        self.read.side_effect = [
            (history_url, history([("900001", "Finalizado", "20,00")])),
            (initial_url, start_form()),
            (draft_url, draft(["0,00", "0,00"], "0,00")),
            (draft_url, draft(["50,00", "0,00"], "50,00")),
            (history_url, history([("900002", "Em andamento", "50,00")])),
            (history_url, history([("900002", "Em andamento", "50,00")])),
            (draft_url, draft(["50,00", "0,00"], "50,00")),
            TimeoutError(),
            (history_url, history([("900002", "Enviado", "50,00")])),
        ]
        order = self.portal.submit([{"id": CARDS[0], "amountCents": 5000}], "boleto")
        posts = [call.args[1] for call in self.read.call_args_list if len(call.args) == 2]
        self.assertEqual([post["__EVENTTARGET"] for post in posts], [
            "btnInsPedido", "btnGravar", "gridPedido$_ctl3$_ctl0", "btnAlterar", "btnEnvioTransfacil"])
        self.assertEqual(posts[1]["gridPedidos:_ctl2:txtTotalCarga"], "50,00")
        self.assertEqual(posts[1]["gridPedidos:_ctl3:txtTotalCarga"], "0,00")
        self.assertEqual(order["orderCode"], "900002")
        self.assertEqual(order["status"], "Enviado")

    def test_mixed_amounts_are_saved_and_verified_before_dispatch(self):
        initial_url = ORIGIN + "/frmSelGrupoNovoPedido.aspx"
        history_url = ORIGIN + "/frmSelPedidoExistenteCI.aspx"
        draft_url = ORIGIN + "/frmPedidoCargaIndividual.aspx"
        persisted = draft(["55,00", "57,50"], "112,50")
        self.read.side_effect = [
            (history_url, history([("900001", "Finalizado", "20,00")])),
            (initial_url, start_form()),
            (draft_url, draft(["0,00", "0,00"], "0,00")),
            (draft_url, persisted),
            (history_url, history([("900002", "Em andamento", "112,50")])),
            (history_url, history([("900002", "Em andamento", "112,50")])),
            (draft_url, persisted),
            (draft_url, persisted),
            (history_url, history([("900002", "Enviado", "112,50")])),
        ]
        order = self.portal.submit([{"id": CARDS[1], "amountCents": 5750},
                                    {"id": CARDS[0], "amountCents": 5500}], "boleto")
        posts = [call.args[1] for call in self.read.call_args_list if len(call.args) == 2]
        self.assertEqual(posts[1]["gridPedidos:_ctl2:txtTotalCarga"], "55,00")
        self.assertEqual(posts[1]["gridPedidos:_ctl3:txtTotalCarga"], "57,50")
        self.assertEqual(sum(p["__EVENTTARGET"] == "btnEnvioTransfacil" for p in posts), 1)
        self.assertEqual(order["creditCents"], 11250)

    def test_uniform_full_roster_uses_initial_amount_and_sends_once(self):
        initial_url = ORIGIN + "/frmSelGrupoNovoPedido.aspx"
        history_url = ORIGIN + "/frmSelPedidoExistenteCI.aspx"
        draft_url = ORIGIN + "/frmPedidoCargaIndividual.aspx"
        self.read.side_effect = [
            (history_url, history([("900001", "Finalizado", "20,00")])),
            (initial_url, start_form()),
            (draft_url, draft(["55,00", "55,00"], "110,00")),
            (draft_url, ""),
            (history_url, history([("900002", "Enviado", "110,00")])),
        ]
        order = self.portal.submit([{"id": card, "amountCents": 5500} for card in CARDS], "boleto")
        posts = [call.args[1] for call in self.read.call_args_list if len(call.args) == 2]
        self.assertEqual([post["__EVENTTARGET"] for post in posts], ["btnInsPedido", "btnEnvioTransfacil"])
        self.assertEqual(posts[0]["txtValorCargaCartao"], "55,00")
        self.assertEqual(order["creditCents"], 11000)

    def test_draft_id_is_persisted_before_the_adapter_edits_or_sends(self):
        initial_url = ORIGIN + "/frmSelGrupoNovoPedido.aspx"
        history_url = ORIGIN + "/frmSelPedidoExistenteCI.aspx"
        draft_url = ORIGIN + "/frmPedidoCargaIndividual.aspx"
        self.read.side_effect = [
            (history_url, history([("900001", "Finalizado", "20,00")])),
            (initial_url, start_form()),
            (draft_url, draft(["0,00", "0,00"], "0,00")),
        ]
        store_draft = Mock(side_effect=OSError)
        with self.assertRaises(PortalUncertain) as captured:
            self.portal.submit([{"id": CARDS[0], "amountCents": 5000}], "boleto", on_draft=store_draft)
        store_draft.assert_called_once_with("900002")
        self.assertEqual(captured.exception.order_code, "900002")
        self.assertEqual(self.read.call_count, 3)

    def test_changed_amount_remains_uncertain_with_draft_id_and_is_never_sent(self):
        initial_url = ORIGIN + "/frmSelGrupoNovoPedido.aspx"
        history_url = ORIGIN + "/frmSelPedidoExistenteCI.aspx"
        draft_url = ORIGIN + "/frmPedidoCargaIndividual.aspx"
        self.read.side_effect = [
            (history_url, history([("900001", "Finalizado", "20,00")])),
            (initial_url, start_form()),
            (draft_url, draft(["0,00", "0,00"], "0,00")),
            (draft_url, draft(["50,00", "0,00"], "50,00")),
            (history_url, history([("900002", "Em andamento", "55,00")])),
            (history_url, history([("900002", "Em andamento", "55,00")])),
            (draft_url, draft(["50,00", "5,00"], "55,00")),
        ]
        with self.assertRaises(PortalUncertain) as captured:
            self.portal.submit([{"id": CARDS[0], "amountCents": 5000}], "boleto")
        self.assertEqual(captured.exception.order_code, "900002")
        self.assertEqual(self.read.call_count, 7)

    def test_disabled_pix_is_definite_before_portal_reads_or_writes(self):
        with self.assertRaises(PortalError) as captured:
            self.portal.submit([{"id": CARDS[0], "amountCents": 5000}], "pix")
        self.assertNotIsInstance(captured.exception, PortalUncertain)
        self.read.assert_not_called()
