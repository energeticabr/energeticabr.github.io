"""National DANFSe v2.0 using the pinned BrazilFiscalReport NT 008 layout.

No URLs, certificate access, temporary XML files or generic XML report. Font
files are runtime assets; the issued PDF embeds their required subsets.
"""
from __future__ import annotations

import os
from pathlib import Path

from brazilfiscalreport.danfse import Danfse, DanfseConfig
from brazilfiscalreport.danfse.danfse import FIN_NFSE, REG_AP_TRIB_SN, ROW_H, SIMPLES_OP
from fiscal_document import child, text


def font_directory():
    candidates = [Path(os.environ['DANFSE_FONT_DIR'])] if os.environ.get('DANFSE_FONT_DIR') else []
    candidates += [Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts', Path(__file__).resolve().parent / 'fonts',
                   Path('/usr/local/share/fonts/danfse')]
    for directory in candidates:
        if all((directory / name).is_file() for name in ('arial.ttf', 'arialbd.ttf', 'micross.ttf')):
            return directory
    raise ValueError('DANFSE_REQUIRED_FONTS_MISSING')


class NationalDanfse(Danfse):
    """The upstream national ruled layout with embedded normative fonts."""
    def _parse_xml(self):
        directory = font_directory()
        self.add_font('DanfseArial', fname=str(directory / 'arial.ttf'))
        self.add_font('DanfseArial', style='B', fname=str(directory / 'arialbd.ttf'))
        self.add_font('DanfseSans', fname=str(directory / 'micross.ttf'))
        self._national_fonts_ready = True
        data = super()._parse_xml()
        invoice = child(self.root, 'infNFSe')
        dps = child(invoice, 'DPS/infDPS')
        provider, emitter = child(dps, 'prest'), child(invoice, 'emit')
        identity = lambda node: text(node, 'CNPJ') or text(node, 'CPF') or text(node, 'NIF')
        # Some valid national XMLs omit provider registration data that exists
        # in emit. Reuse it only when both groups explicitly name the same ID.
        if not identity(provider) or identity(provider) != identity(emitter):
            for source, field in [('xNome', 'name'), ('IM', 'municipal_registration'),
                                  ('fone', 'phone'), ('email', 'email')]:
                if not text(provider, source):
                    data['issuer'][field] = '-'
            if not identity(provider):
                data['issuer']['id'] = '-'
            if child(provider, 'end') is None:
                for field in ('address', 'city', 'ibge_cep'):
                    data['issuer'][field] = '-'
        # NT 009 also permits finNFSe directly inside infDPS.
        purpose = text(dps, 'finNFSe') or text(dps, 'IBSCBS/finNFSe')
        if purpose:
            data['purpose'] = FIN_NFSE.get(purpose, purpose)[:37]
        data['issuer']['simples'] = SIMPLES_OP.get(text(provider, 'regTrib/opSimpNac'), '-')
        data['issuer']['tax_regim'] = REG_AP_TRIB_SN.get(text(provider, 'regTrib/regApTribSN'), '-')
        return data

    def _draw_provider(self):
        self._national_provider_mode = True
        self._national_provider_extra = 0
        try:
            super()._draw_provider()
        finally:
            self._national_provider_mode = False

    def _field(self, col, span, y, label, value, shaded=False):
        if (getattr(self, '_national_provider_mode', False)
                and label in ('Simples Nacional na Data de Competência', 'Regime de Apuração Tributária pelo SN')):
            x, width = self._col(col) + 0.8, span * self.colw - 1.6
            self.set_font(self.default_font, 'B', 6)
            self.set_xy(x, y + 0.5)
            self.cell(w=width, h=2.2, text=label)
            self.set_font(self.default_font, '', 7)
            self.set_xy(x, y + 3.0)
            self.multi_cell(w=width, h=2.6, text=value or '-')
            self._national_provider_extra = max(self._national_provider_extra,
                                               self.get_y() - y + 0.8 - ROW_H)
            return
        super()._field(col, span, y, label, value, shaded)

    def _hline(self, y):
        if getattr(self, '_national_provider_mode', False):
            y += max(self._national_provider_extra, 0)
            self.set_y(y)
        super()._hline(y)

    def set_font(self, family=None, style='', size=0):
        if getattr(self, '_national_fonts_ready', False) and (family or '').lower() == 'helvetica':
            family = 'DanfseArial' if 'B' in style or getattr(self, '_national_watermark', False) else 'DanfseSans'
        return super().set_font(family, style, size)

    def _draw_watermark(self):
        self._national_watermark = True
        try:
            super()._draw_watermark()
        finally:
            self._national_watermark = False


def render_national_danfse(document, situation='AUTORIZADA'):
    config = DanfseConfig(watermark_cancelled=situation == 'CANCELADA',
                          watermark_replaced=situation == 'SUBSTITUIDA')
    return bytes(NationalDanfse(xml=document.xml, config=config).output())
