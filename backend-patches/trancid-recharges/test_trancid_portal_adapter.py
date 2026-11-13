import unittest
from datetime import date
from unittest.mock import Mock

from trancid_portal_adapter import Form, Portal, PortalError, PortalUncertain, parse_cards


ORIGIN = "http://provider.example:8082"
CARDS = ["06850000084216", "06850000084217"]


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
