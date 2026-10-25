"""Report contracts using fictional, hand-checked manifests only."""
from copy import deepcopy
from html.parser import HTMLParser
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from pypdf import PdfReader


spec = importlib.util.spec_from_file_location(
    'monthly_tax_reports', Path(__file__).with_name('reports.py'))
reports = None
if Path(spec.origin).exists():
    reports = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reports)


def synthetic_plan():
    """Amounts are literals, independent of the calculation/report code."""
    return dict(
        version=1, competence='2026-09', createdDate='2026-10-01',
        dueDate='2026-10-20', rulesVersion='FICTICIO-2026-v1',
        rules=dict(
            version='FICTICIO-2026-v1', confirmed=True, base='SALARIO',
            validFrom='2026-01', validThrough='2026-12', divisor=30,
            fgtsBps=800, employeeRounding='truncate', employerRounding='truncate',
            employeeBrackets=[dict(limitCents=200000, rateBps=750),
                              dict(limitCents=400000, rateBps=900)],
            employerComponents=[
                dict(code='TEST-PATRONAL', label='Componente empresa fictícia', rateBps=2000),
                dict(code='TEST-RAT', label='Componente risco fictício', rateBps=300)]),
        rows=[
            dict(supplierId=101, name='PESSOA FICTÍCIA ALFA', branch='FILIAL SINTÉTICA A',
                 profession='PROFISSÃO DE ORIGEM ALFA', cargo='CARGO RH DIFERENTE ALFA',
                 admission='2026-09-23', sheetId=501, salaryCents=300000,
                 days=8, divisor=30, baseCents=80000,
                 components={'EMPREGADO': 6000, 'TEST-PATRONAL': 16000, 'TEST-RAT': 2400},
                 inssCents=24400, fgtsCents=6400),
            dict(supplierId=102, name='PESSOA FICTÍCIA BETA', branch='FILIAL SINTÉTICA B',
                 profession='PROFISSÃO DE ORIGEM BETA', cargo='CARGO RH DIFERENTE BETA',
                 admission='2026-09-23', sheetId=502, salaryCents=493300,
                 days=8, divisor=30, baseCents=131547,
                 components={'EMPREGADO': 9866, 'TEST-PATRONAL': 26309, 'TEST-RAT': 3946},
                 inssCents=40121, fgtsCents=10523)],
        totals={'INSS': 64521, 'FGTS': 16923})


def calendar_allocation_plan():
    """Two fictional workers; two employer components receive a residue cent."""
    plan = synthetic_plan()
    plan.update(competence='2026-10', createdDate='2026-11-01', dueDate='2026-11-20')
    plan['rules']['divisor'] = 'calendar'
    plan['rules']['employerComponents'][1]['label'] = 'GILRAT fictício'
    plan['rules']['employerComponents'].append(
        dict(code='FICT-TERCEIROS', label='Terceiros fictícios', rateBps=580))
    plan['rows'][0].update(
        admission='2026-10-23', days=9, divisor=31, baseCents=87097,
        components={'EMPREGADO': 6532, 'TEST-PATRONAL': 17419,
                    'TEST-RAT': 2613, 'FICT-TERCEIROS': 5052},
        inssCents=31616, fgtsCents=6967)
    plan['rows'][1].update(
        branch='FILIAL SINTÉTICA A', admission='2026-10-23', days=9, divisor=31,
        baseCents=143216, components={'EMPREGADO': 10741, 'TEST-PATRONAL': 28643,
                                    'TEST-RAT': 4296, 'FICT-TERCEIROS': 8306},
        inssCents=51986, fgtsCents=11457)
    plan['totals'] = {'INSS': 83602, 'FGTS': 18424}
    return plan


def multipage_plan():
    plan = calendar_allocation_plan()
    pair = plan['rows']
    plan['rows'] = []
    for number in range(1, 27):
        person = deepcopy(pair[(number - 1) % 2])
        person.update(
            supplierId=1000 + number, sheetId=2000 + number,
            branch=f'FILIAL FICTÍCIA {(number + 1) // 2:02d}',
            name=(f'PESSOA SINTÉTICA {number:02d} COM NOME EXTENSO PARA '
                  'VERIFICAÇÃO DE QUEBRA E LEGIBILIDADE'),
            profession=('PROFISSÃO PRESERVADA DA ORIGEM: SERVIÇOS DE CONSTRUÇÃO, '
                        'MANUTENÇÃO E ACOMPANHAMENTO TÉCNICO EM OBRAS '
                        f'COM DESCRIÇÃO EXTENSA FIM-PROF-{number:02d}'),
            cargo=f'CARGO RH FICTÍCIO {number:02d}')
        plan['rows'].append(person)
    plan['totals'] = {'INSS': 1086826, 'FGTS': 239512}
    return plan


class VisibleHTML(HTMLParser):
    def __init__(self, markup):
        super().__init__(convert_charrefs=True)
        self.parts, self.tags, self.attributes = [], [], []
        self.feed(markup)

    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        self.attributes.extend(attrs)

    def handle_data(self, data):
        self.parts.append(data)

    @property
    def text(self):
        return ' '.join(' '.join(self.parts).split())


def pdf_text(path):
    return ' '.join(' '.join(page.extract_text() for page in PdfReader(path).pages).split())


class MonthlyTaxReportTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(reports, 'The HTML/PDF reporting sidecar is not implemented')

    def assert_projection_notice(self, text):
        self.assertRegex(text.lower(), r'valores previstos.*n[ãa]o pagos')
        self.assertIn('SALARIO', text)
        self.assertRegex(text.lower(), r'pr[êe]mio.*alimenta[çc][ãa]o.*transporte.*exclu')
        self.assertNotIn('PAGAMENTO EFETUADO', text.upper())

    def test_html_preserves_origin_and_exact_selected_tax_amounts(self):
        for tax, amounts in [('INSS', ['R$ 244,00', 'R$ 401,21', 'R$ 645,21']),
                             ('FGTS', ['R$ 64,00', 'R$ 105,23', 'R$ 169,23'])]:
            with self.subTest(tax=tax):
                markup = reports.calculation_html(synthetic_plan(), tax)
                document = VisibleHTML(markup)
                self.assertTrue(markup.lower().startswith('<!doctype html>'))
                self.assertTrue({'html', 'head', 'title', 'style', 'body'}.issubset(document.tags))
                self.assertFalse({'script', 'link', 'iframe', 'img'} & set(document.tags))
                for value in [tax, '2026-09', '2026-10-01', '2026-10-20', 'FICTICIO-2026-v1',
                              'PESSOA FICTÍCIA ALFA', 'PESSOA FICTÍCIA BETA',
                              'PROFISSÃO DE ORIGEM ALFA', 'CARGO RH DIFERENTE ALFA',
                              'FILIAL SINTÉTICA A', '101', '501', '2026-09-23',
                              'R$ 3.000,00', 'R$ 4.933,00', '8 / 30', 'R$ 800,00',
                              'R$ 1.315,47', *amounts]:
                    self.assertIn(value, document.text)
                self.assert_projection_notice(document.text)
                if tax == 'INSS':
                    for value in ['EMPREGADO', 'TEST-PATRONAL', 'Componente empresa fictícia',
                                  'R$ 60,00', 'R$ 160,00', 'R$ 24,00', 'R$ 98,66',
                                  'R$ 263,09', 'R$ 39,46']:
                        self.assertIn(value, document.text)
                else:
                    self.assertNotIn('TEST-PATRONAL', document.text)
                    self.assertNotIn('R$ 244,00', document.text)

    def test_html_escapes_untrusted_identity_metadata_and_component_labels(self):
        plan = synthetic_plan()
        payload = '<script>alert("ficção")</script><img src=x onerror="boom"> & \'teste\''
        for field in ['name', 'profession', 'cargo', 'branch', 'admission']:
            plan['rows'][0][field] = f'{field}: {payload}'
        for field in ['competence', 'createdDate', 'dueDate', 'rulesVersion', 'version']:
            plan[field] = f'{field}: {payload}'
        plan['rules']['employerComponents'][0]['label'] = payload
        document = VisibleHTML(reports.calculation_html(plan, 'INSS'))
        self.assertFalse({'script', 'img', 'iframe'} & set(document.tags))
        self.assertFalse(any(name.startswith('on') for name, _ in document.attributes))
        for field in ['name', 'profession', 'cargo', 'branch', 'admission',
                      'competence', 'createdDate', 'dueDate', 'rulesVersion', 'version']:
            self.assertIn(f'{field}: {payload}', document.text)
        self.assertIn(payload, document.text)

    def test_pdf_is_readable_and_contains_the_frozen_amounts_for_each_tax(self):
        with TemporaryDirectory(prefix='monthly-tax-reports-') as directory:
            for tax, amounts in [('INSS', ['R$ 244,00', 'R$ 401,21', 'R$ 645,21']),
                                 ('FGTS', ['R$ 64,00', 'R$ 105,23', 'R$ 169,23'])]:
                with self.subTest(tax=tax):
                    path = Path(directory) / f'{tax}.pdf'
                    result = reports.render_calculation_pdf(synthetic_plan(), tax, path)
                    self.assertIsInstance(result, Path)
                    self.assertEqual(result, path)
                    self.assertTrue(path.read_bytes().startswith(b'%PDF-'))
                    text = pdf_text(path)
                    for value in [tax, '2026-09', '2026-10-01', '2026-10-20', 'FICTICIO-2026-v1',
                                  'PESSOA FICTÍCIA ALFA', 'PESSOA FICTÍCIA BETA',
                                  'PROFISSÃO DE ORIGEM ALFA', 'CARGO RH DIFERENTE ALFA',
                                  'FILIAL SINTÉTICA A', '101', '501', '2026-09-23',
                                  'R$ 3.000,00', 'R$ 4.933,00', '8 / 30', 'R$ 800,00',
                                  'R$ 1.315,47', *amounts]:
                        self.assertIn(value, text)
                    self.assert_projection_notice(text)
                    if tax == 'INSS':
                        for value in ['EMPREGADO', 'TEST-PATRONAL', 'Componente empresa fictícia',
                                      'R$ 60,00', 'R$ 160,00', 'R$ 24,00', 'R$ 98,66',
                                      'R$ 263,09', 'R$ 39,46']:
                            self.assertIn(value, text)
                    else:
                        self.assertNotIn('TEST-PATRONAL', text)
                        self.assertNotIn('R$ 244,00', text)

    def test_pdf_repeats_context_on_every_page_and_keeps_26_long_people_complete(self):
        with TemporaryDirectory(prefix='monthly-tax-reports-') as directory:
            path = Path(directory) / 'long.pdf'
            reports.render_calculation_pdf(multipage_plan(), 'INSS', path)
            pages = PdfReader(path).pages
            self.assertGreater(len(pages), 1)
            text = pdf_text(path)
            for number in range(1, 27):
                self.assertEqual(text.count(f'PESSOA SINTÉTICA {number:02d}'), 1)
                self.assertEqual(text.count(f'FIM-PROF-{number:02d}'), 1)
                self.assertIn(f'CARGO RH FICTÍCIO {number:02d}', text)
            self.assertIn('R$ 10.868,26', text)
            for number, page in enumerate(pages, 1):
                context = ' '.join(page.extract_text().split())
                self.assertEqual(context.count('Pessoa / origem'), 1)
                for person in range(1, 27):
                    if f'PESSOA SINTÉTICA {person:02d}' in context:
                        self.assertIn(f'FIM-PROF-{person:02d}', context)
                        self.assertIn(f'CARGO RH FICTÍCIO {person:02d}', context)
                for value in ['INSS', '2026-10', '2026-11-20', 'FICTICIO-2026-v1',
                              'Pessoa / origem', 'Salário e base', f'Página {number}']:
                    self.assertIn(value, context)

    def test_calendar_allocation_keeps_awarded_cents_and_explains_the_origin(self):
        plan = calendar_allocation_plan()
        with TemporaryDirectory(prefix='monthly-tax-reports-') as directory:
            markup = reports.calculation_html(plan, 'INSS')
            path = Path(directory) / 'calendar.pdf'
            reports.render_calculation_pdf(plan, 'INSS', path)
            for text in [VisibleHTML(markup).text, pdf_text(path)]:
                for value in ['9 / 31', 'R$ 870,97', 'R$ 1.432,16', 'R$ 26,13',
                              'R$ 50,52', 'R$ 316,16', 'R$ 519,86', 'R$ 836,02',
                              'Terceiros fictícios']:
                    self.assertIn(value, text)
                for explanation in ['filial', 'código de receita', 'resíduo',
                                    'resto fracionário', 'arredondados a centavos']:
                    self.assertIn(explanation, text.lower())

    def test_pdf_can_continue_a_single_profession_longer_than_one_page(self):
        plan = synthetic_plan()
        plan['rows'] = plan['rows'][:1]
        plan['totals'] = {'INSS': 24400, 'FGTS': 6400}
        plan['rows'][0]['profession'] = ('ATIVIDADE-FICTÍCIA ' * 400) + 'FIM-PROFISSÃO-EXTREMA'
        with TemporaryDirectory(prefix='monthly-tax-reports-') as directory:
            path = Path(directory) / 'oversized.pdf'
            try:
                reports.render_calculation_pdf(plan, 'INSS', path)
            except Exception as error:
                self.fail(f'A long source profession must flow onto another page: {error}')
            reader = PdfReader(path)
            self.assertGreater(len(reader.pages), 1)
            text = pdf_text(path)
            self.assertEqual(text.count('ATIVIDADE-FICTÍCIA'), 400)
            self.assertIn('FIM-PROFISSÃO-EXTREMA', text)
            self.assertIn('R$ 244,00', text)
            for page in reader.pages:
                self.assertEqual(page.extract_text().count('Pessoa / origem'), 1)

    def test_unknown_tax_fails_before_creating_or_replacing_a_file(self):
        with TemporaryDirectory(prefix='monthly-tax-reports-') as directory:
            path = Path(directory) / 'invalid.pdf'
            for tax in ['IRRF', 'inss', '', None]:
                with self.subTest(tax=tax):
                    with self.assertRaises(ValueError):
                        reports.calculation_html(synthetic_plan(), tax)
                    with self.assertRaises(ValueError):
                        reports.render_calculation_pdf(synthetic_plan(), tax, path)
                    self.assertFalse(path.exists())

    def test_inconsistent_selected_tax_total_is_rejected(self):
        with TemporaryDirectory(prefix='monthly-tax-reports-') as directory:
            for tax in ['INSS', 'FGTS']:
                plan = synthetic_plan()
                plan['totals'][tax] += 1
                with self.subTest(tax=tax):
                    with self.assertRaises(ValueError):
                        reports.calculation_html(plan, tax)
                    path = Path(directory) / f'{tax}.pdf'
                    with self.assertRaises(ValueError):
                        reports.render_calculation_pdf(plan, tax, path)
                    self.assertFalse(path.exists())

    def test_fractional_negative_boolean_cents_and_inss_component_mismatch_are_rejected(self):
        cases = [('salaryCents', 300000.0), ('baseCents', True), ('baseCents', -1),
                 ('inssCents', '24400'), ('fgtsCents', 6400.5),
                 ('components', {'EMPREGADO': 24400.0}),
                 ('components', {'EMPREGADO': 24401})]
        with TemporaryDirectory(prefix='monthly-tax-reports-') as directory:
            for field, value in cases:
                plan = synthetic_plan()
                plan['rows'][0][field] = value
                with self.subTest(field=field, value=value):
                    with self.assertRaises(ValueError):
                        reports.calculation_html(plan, 'INSS')
                    with self.assertRaises(ValueError):
                        reports.render_calculation_pdf(plan, 'INSS', Path(directory) / 'invalid.pdf')

    def test_rendering_preserves_manifest_and_never_invents_rules_or_benefit_amounts(self):
        plan = synthetic_plan()
        plan['rules'] = {}
        plan['rows'][0].update(prizeCents=99999999, foodCents=88888888, transportCents=77777777)
        plan['rows'][0]['components'] = {'CONFIG-FICTICIA-SEM-REGIME': 24400}
        original = deepcopy(plan)
        with TemporaryDirectory(prefix='monthly-tax-reports-') as directory:
            for tax, expected in [('INSS', 'R$ 645,21'), ('FGTS', 'R$ 169,23')]:
                html = VisibleHTML(reports.calculation_html(plan, tax)).text
                path = Path(directory) / f'{tax}.pdf'
                reports.render_calculation_pdf(plan, tax, path)
                for text in [html, pdf_text(path)]:
                    self.assertIn(expected, text)
                    self.assertNotIn('R$ 999.999,99', text)
                    self.assertNotIn('R$ 888.888,88', text)
                    self.assertNotIn('R$ 777.777,77', text)
                    if tax == 'INSS':
                        self.assertIn('CONFIG-FICTICIA-SEM-REGIME', text)
        self.assertEqual(plan, original)

    def test_empty_manifest_produces_an_explicit_zero_projection(self):
        plan = synthetic_plan()
        plan.update(rows=[], totals={'INSS': 0, 'FGTS': 0})
        with TemporaryDirectory(prefix='monthly-tax-reports-') as directory:
            for tax in ['INSS', 'FGTS']:
                text = VisibleHTML(reports.calculation_html(plan, tax)).text
                path = Path(directory) / f'{tax}.pdf'
                reports.render_calculation_pdf(plan, tax, path)
                for output in [text, pdf_text(path)]:
                    self.assertIn('R$ 0,00', output)
                    self.assertRegex(output.lower(), r'nenhum[a]? (pessoa|fornecedor|registro)')
                    self.assert_projection_notice(output)


if __name__ == '__main__':
    unittest.main()
