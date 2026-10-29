"""Synthetic XML examples; no retrieved fiscal or personal documents."""
import base64
import hashlib

COMPANY = '38626750000146'
CTE_KEY = '31261012345678000123570010000001231000001234'
NFSE_KEY = '35503081212345678000123000000000123261000000000111'


def cte_xml(kind='cteProc', environment='1'):
    model = '67' if kind == 'cteOSProc' else '57'
    key = CTE_KEY[:20] + model + CTE_KEY[22:]
    element = {'cteProc': 'CTe', 'cteOSProc': 'CTeOS', 'cteSimpProc': 'CTeSimp'}[kind]
    toma = f'<toma><toma>0</toma><CNPJ>{COMPANY}</CNPJ><xNome>Tomador ficticio</xNome></toma>' if kind != 'cteProc' else ''
    ide_toma = '<toma3><toma>0</toma></toma3>' if kind == 'cteProc' else ''
    values = ('<total><vTPrest>1000.00</vTPrest><vTPrestLiq>900.00</vTPrestLiq><vTRec>975.00</vTRec></total>'
              '<det nItem="1"><xMunIni>Betim</xMunIni><xMunFim>Sao Paulo</xMunFim><vPrest>600.00</vPrest><vRec>590.00</vRec></det>'
              '<det nItem="2"><xMunIni>Betim</xMunIni><xMunFim>Campinas</xMunFim><vPrest>400.00</vPrest><vRec>385.00</vRec></det>'
              if kind == 'cteSimpProc' else '<vPrest><vTPrest>1000.00</vTPrest><vRec>980.00</vRec><Comp><xNome>FRETE PESO</xNome><vComp>1000.00</vComp></Comp></vPrest>')
    return (f'<{kind} xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><{element}><infCte Id="CTe{key}" versao="4.00">'
            f'<ide><cUF>31</cUF><CFOP>5353</CFOP><mod>{model}</mod><serie>1</serie><nCT>123</nCT><dhEmi>2026-10-01T23:45:59-03:00</dhEmi>'
            f'<tpImp>1</tpImp><tpAmb>{environment}</tpAmb><tpCTe>0</tpCTe><tpServ>0</tpServ><modal>01</modal><natOp>TRANSPORTE FICTICIO</natOp>'
            f'<UFIni>MG</UFIni><UFFim>SP</UFFim><xMunIni>Betim</xMunIni><xMunFim>Sao Paulo</xMunFim>{ide_toma}</ide>'
            '<emit><CNPJ>12345678000123</CNPJ><IE>123456789</IE><xNome>Transportadora Ficticia</xNome>'
            '<enderEmit><xLgr>Rua de Teste</xLgr><nro>123</nro><xBairro>Centro</xBairro><CEP>30000000</CEP><xMun>Betim</xMun><UF>MG</UF></enderEmit></emit>'
            f'<rem><CNPJ>{COMPANY}</CNPJ><xNome>Tomador ficticio</xNome><enderReme><xMun>Betim</xMun><UF>MG</UF></enderReme></rem>'
            '<dest><CNPJ>44444444000144</CNPJ><xNome>Destinatario ficticio</xNome><enderDest><xMun>Sao Paulo</xMun><UF>SP</UF></enderDest></dest>'
            f'{toma}{values}<compl><xObs>Servico de transporte ficticio. Nenhum documento real.</xObs></compl>'
            '<imp><ICMS><ICMS00><CST>00</CST><vBC>1000.00</vBC><pICMS>12.00</pICMS><vICMS>120.00</vICMS></ICMS00></ICMS></imp>'
            '<infCTeNorm><infCarga><vCarga>1000.00</vCarga><proPred>CARGA FICTICIA</proPred><infQ><cUnid>01</cUnid><tpMed>PESO BRUTO</tpMed><qCarga>10.00</qCarga></infQ></infCarga>'
            '<infDoc/><infModal versaoModal="4.00"><rodo><RNTRC>12345678</RNTRC></rodo></infModal></infCTeNorm>'
            f'</infCte></{element}><protCTe><infProt><tpAmb>{environment}</tpAmb><chCTe>{key}</chCTe><cStat>100</cStat>'
            '<dhRecbto>2026-10-01T23:46:01-03:00</dhRecbto><nProt>131260000000123</nProt></infProt></protCTe>'
            f'</{kind}>').encode()


def nfse_xml(environment='1'):
    return (f'<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS{NFSE_KEY}">'
            '<nNFSe>123</nNFSe><cStat>100</cStat><dhProc>2026-10-01T23:45:59-03:00</dhProc><nDFSe>567</nDFSe>'
            '<emit><CNPJ>12345678000123</CNPJ><xNome>Prestador fiscal ficticio</xNome></emit>'
            '<valores><vBC>970.00</vBC><vISSQN>48.50</vISSQN><vLiq>921.50</vLiq></valores>'
            '<DPS><infDPS><tpAmb>'+environment+'</tpAmb><dhEmi>2026-10-01T23:44:00-03:00</dhEmi><serie>1</serie><nDPS>432</nDPS>'
            '<prest><CNPJ>12345678000123</CNPJ><xNome>Prestador Ficticio</xNome></prest>'
            f'<toma><CNPJ>{COMPANY}</CNPJ><xNome>Tomador ficticio</xNome></toma><interm><CNPJ>99999999000199</CNPJ></interm>'
            '<serv><cServ><xDescServ>Manutencao de equipamento ficticio. Texto literal &lt;b&gt;sem HTML&lt;/b&gt;.</xDescServ></cServ>'
            '<infoCompl><xInfComp>Contrato de teste. Documento exclusivamente sintetico.</xInfComp></infoCompl></serv>'
            '<valores><vServPrest><vServ>1000.00</vServ></vServPrest><vDescCondIncond><vDescCond>10.00</vDescCond><vDescIncond>20.00</vDescIncond></vDescCondIncond>'
            '<trib><tribMun><tpRetISSQN>2</tpRetISSQN></tribMun></trib></valores></infDPS></DPS></infNFSe></NFSe>').encode()


def render_envelope(raw, key):
    return {'key': key, 'companyCnpj': COMPANY, 'xmlBase64': base64.b64encode(raw).decode(),
            'xmlSha256': hashlib.sha256(raw).hexdigest()}


def notification_envelope(raw, key, kind, prefix, nsu='000000000000001'):
    digest = hashlib.sha256(raw).hexdigest()
    doc_id = nsu + '-' + digest[:16]
    pdf = b'%PDF-1.4\nSYNTHETIC UNIT TEST ONLY\n%%EOF\n'
    return {'source': 'SEFAZ', 'receipt': {'source': 'SEFAZ', 'acknowledgedIds': [doc_id]},
            'document': {'key': key, 'kind': kind, 'id': doc_id, 'sha256': digest,
                         'xmlBase64': base64.b64encode(raw).decode(),
                         'danfe': {'fileName': f'{prefix}-{key}-{digest[:16]}.pdf',
                                   'pdfBase64': base64.b64encode(pdf).decode(), 'sha256': hashlib.sha256(pdf).hexdigest()}}}
