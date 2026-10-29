param([string]$ModulePath = (Join-Path $PSScriptRoot '../src/Sefaz.psm1'))
$ErrorActionPreference='Stop'
Import-Module $ModulePath -Force
$script:passed=0
function Assert-Equal($Actual,$Expected,$Name) {
    if ($Actual -ne $Expected) { throw "$Name : esperado [$Expected], recebido [$Actual]" }
    $script:passed++; Write-Host "PASS $Name"
}
function Assert-Throws([scriptblock]$Action,[string]$Pattern,[string]$Name) {
    $caught=$false
    try { & $Action } catch { if($_.Exception.Message -notmatch $Pattern){throw};$caught=$true }
    Assert-Equal $caught $true $Name
}
$key='31261012345678000123550010000001231000001234'
$full=@"
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe$key"><ide><mod>55</mod><nNF>123</nNF><serie>1</serie><dhEmi>2026-10-20T12:00:00-03:00</dhEmi><natOp>VENDA</natOp><tpNF>1</tpNF></ide><emit><CNPJ>12345678000123</CNPJ><xNome>Fornecedor &amp; Companhia</xNome><enderEmit><UF>MG</UF></enderEmit></emit><dest><CNPJ>38626750000146</CNPJ><xNome>Energetica</xNome></dest><total><ICMSTot><vProd>1000.00</vProd><vDesc>100.00</vDesc><vFrete>50.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vIPI>0.00</vIPI><vICMS>90.00</vICMS><vPIS>10.00</vPIS><vCOFINS>40.00</vCOFINS><vNF>950.00</vNF></ICMSTot></total><cobr><fat><vOrig>950.00</vOrig><vDesc>20.00</vDesc><vLiq>930.00</vLiq></fat></cobr><infAdic><infCpl>Observacao</infCpl></infAdic></infNFe></NFe><protNFe><infProt><cStat>100</cStat><chNFe>$key</chNFe><nProt>12345</nProt></infProt></protNFe></nfeProc>
"@
$summary="<resNFe xmlns='http://www.portalfiscal.inf.br/nfe'><chNFe>$key</chNFe><CNPJ>12ABC678000123</CNPJ><xNome>Fornecedor</xNome><dhEmi>2026-10-20T12:00:00-03:00</dhEmi><vNF>950.00</vNF><cSitNFe>1</cSitNFe></resNFe>"
$f=ConvertFrom-FiscalXml $full '000000000000001' '38626750000146'
$additional="<infAdic><infAdFisco>Informacao ao fisco &amp; teste</infAdFisco><infCpl>Pedido 456`nEntregar &lt;b&gt;sem interpretar HTML&lt;/b&gt;.</infCpl><obsCont xCampo='OBRA'><xTexto>Obra ficticia A</xTexto></obsCont><obsCont xCampo='CONTATO'><xTexto>Setor de suprimentos</xTexto></obsCont><obsFisco xCampo='BASE'><xTexto>Observacao fiscal ficticia</xTexto></obsFisco></infAdic>"
$withNotes=ConvertFrom-FiscalXml ($full -replace '(?s)<infAdic>.*?</infAdic>',$additional) '000000000000001' '38626750000146'
Assert-Equal $withNotes.fields.OBSERVACOES_NOTA "Pedido 456`nEntregar <b>sem interpretar HTML</b>.`nOBRA: Obra ficticia A`nCONTATO: Setor de suprimentos" 'observacoes preservam linhas e texto do contribuinte sem interpretar HTML'
Assert-Equal $withNotes.fields.INFORMACOES_FISCO "Informacao ao fisco & teste`nBASE: Observacao fiscal ficticia" 'informacoes do fisco ficam separadas das observacoes'
$noNotes=ConvertFrom-FiscalXml ($full -replace '(?s)<infAdic>.*?</infAdic>','') '000000000000001' '38626750000146'
Assert-Equal $noNotes.fields.Contains('OBSERVACOES_NOTA') $false 'XML sem observacoes nao inventa conteudo'
Assert-Equal $f.fields.OBSERVACOES_NOTA 'Observacao' 'informacao complementar simples preservada'
Assert-Equal $f.fields.DATA_EMISSAO_ORIGINAL $f.fields.DATA_EMISSAO 'emissao original preserva fuso do XML para exibicao fiscal'
Assert-Equal $f.fields.VALOR_TOTAL_NOTA ([decimal]950) 'vNF sem descontar vDesc duas vezes'
Assert-Equal $f.fields.DESCONTOS ([decimal]100) 'desconto da nota separado da fatura'
Assert-Equal $f.fields.VALOR_LIQUIDO ([decimal]930) 'liquido da fatura'
Assert-Equal $f.fields.DESCONTO_FATURA ([decimal]20) 'desconto da fatura preservado'
Assert-Equal $f.fields.Title 'Fornecedor & Companhia' 'XML entidade escapada'
Assert-Equal $f.fields.DIRECAO 'ENTRADA' 'destinatario identifica entrada'
$withoutBilling=$full -replace '<cobr>.*?</cobr>',''
$fallback=ConvertFrom-FiscalXml $withoutBilling '000000000000001' '38626750000146'
Assert-Equal $fallback.fields.VALOR_LIQUIDO ([decimal]950) 'fallback liquido nao desconta de novo'
Assert-Equal $fallback.fields.ORIGEM_LIQUIDO 'vNF (sem fatura no XML)' 'origem do fallback explicita'
$s=ConvertFrom-FiscalXml $summary '000000000000002' '38626750000146'
Assert-Equal $s.fields.DATA_EMISSAO_ORIGINAL $s.fields.DATA_EMISSAO 'resumo preserva emissao original sem conversao de fuso'
Assert-Equal $s.fields.Contains('DESCONTOS') $false 'resumo nao inventa desconto zero'
Assert-Equal $s.fields.Contains('VALOR_LIQUIDO') $false 'resumo nao inventa liquido'
Assert-Equal $s.fields.CNPJ_FORNECEDOR '12ABC678000123' 'CNPJ alfanumerico permanece texto'
Assert-Equal $s.fields.STATUS_IMPORTACAO 'RESUMO_AGUARDANDO_XML' 'resumo nao representa XML completo'
$merged=Merge-FiscalFields $f.fields $s.fields
$preservedNotes=Merge-FiscalFields $withNotes.fields $s.fields
Assert-Equal $s.fields.Contains('OBSERVACOES_NOTA') $false 'resumo sem XML completo mantem observacoes pendentes'
Assert-Equal $preservedNotes.OBSERVACOES_NOTA $withNotes.fields.OBSERVACOES_NOTA 'resumo nao apaga observacoes do XML completo'
Assert-Equal $merged.DESCONTOS ([decimal]100) 'resumo nao apaga valores completos'
Assert-Equal $merged.STATUS_IMPORTACAO 'XML_COMPLETO' 'resumo nao regride status completo'
$event="<procEventoNFe xmlns='http://www.portalfiscal.inf.br/nfe'><evento><infEvento><chNFe>$key</chNFe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><dhEvento>2026-10-20T13:00:00-03:00</dhEvento></infEvento></evento><retEvento><infEvento><cStat>135</cStat><nProt>999</nProt></infEvento></retEvento></procEventoNFe>"
$e=ConvertFrom-FiscalXml $event '000000000000003' '38626750000146'
$cancel=Merge-FiscalFields $f.fields $e.fields
Assert-Equal $cancel.SITUACAO 'CANCELADA' 'cancelamento aceito'
Assert-Equal $cancel.DESCONTOS ([decimal]100) 'evento nao apaga valores'
$replayed=Merge-FiscalFields $cancel $f.fields
Assert-Equal $replayed.SITUACAO 'CANCELADA' 'replay de nota nao reativa cancelada'
$rejected=ConvertFrom-FiscalXml ($event -replace '<cStat>135</cStat>','<cStat>573</cStat>') '000000000000004' '38626750000146'
Assert-Equal $rejected.fields.Contains('SITUACAO') $false 'evento rejeitado nao cancela nota'
$resEvent="<resEvento xmlns='http://www.portalfiscal.inf.br/nfe'><chNFe>$key</chNFe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><nProt>12345</nProt><dhEvento>2026-10-20T13:00:00-03:00</dhEvento></resEvento>"
$ce=ConvertFrom-FiscalXml $resEvent '000000000000005' '38626750000146'
Assert-Equal $ce.fields.SITUACAO 'CANCELADA' 'resumo de cancelamento registrado com protocolo'
$noProtocol=ConvertFrom-FiscalXml ($resEvent -replace '<nProt>12345</nProt>','') '000000000000006' '38626750000146'
Assert-Equal $noProtocol.fields.Contains('SITUACAO') $false 'resumo sem protocolo nao inventa cancelamento'
$alphaKey='31261012ABC678000123550010000001231000001234'
$alpha=ConvertFrom-FiscalXml ($summary.Replace($key,$alphaKey)) '000000000000007' '38626750000146'
Assert-Equal $alpha.key '31261012ABC678000123550010000001231000001234' 'chave alfanumerica aceita conforme NT 2026.004'
Assert-Throws {ConvertFrom-FiscalXml '<!DOCTYPE a [<!ENTITY e SYSTEM "file:///c:/windows/win.ini">]><resNFe>&e;</resNFe>' '1' '38626750000146'} 'DTD|DOCTYPE' 'bloqueio DTD e XXE'
Assert-Throws {ConvertFrom-FiscalXml '<nota/>' '1' '38626750000146'} 'suportado' 'schema desconhecido nao descartado silenciosamente'
$bytes=[Text.Encoding]::UTF8.GetBytes($summary)
$ms=New-Object IO.MemoryStream
$gz=New-Object IO.Compression.GZipStream($ms,[IO.Compression.CompressionMode]::Compress,$true)
$gz.Write($bytes,0,$bytes.Length);$gz.Dispose()
$b64=[Convert]::ToBase64String($ms.ToArray());$ms.Dispose()
Assert-Equal (Expand-DocZip $b64) $summary 'docZip gzip+base64'
Assert-Throws {Expand-DocZip '!!!'} 'Base-64|base64|Base64' 'base64 invalido nao avanca estado'
$now=[DateTimeOffset]::Parse('2026-10-29T12:00:00Z')
$decision=Get-DistributionDecision '138' '000000000000007' '000000000000009' $now 65
Assert-Equal $decision.nextNsu '000000000000007' 'cursor vem do retorno'
Assert-Equal $decision.shouldContinue $true 'fila pode continuar apos ack'
$decision=Get-DistributionDecision '656' '000000000000007' '000000000000009' $now 65
Assert-Equal $decision.shouldContinue $false '656 interrompe consultas'
Assert-Equal $decision.nextAllowedAt '2026-10-29T13:05:00.0000000+00:00' '656 exige cooldown duravel'
$decision=Get-DistributionDecision '137' '000000000000007' '000000000000007' $now 65
Assert-Equal $decision.shouldContinue $false '137 interrompe consultas'
Assert-Throws {Get-DistributionDecision '138' 'abc' '000000000000009' $now 65} 'NSU' 'NSU invalido bloqueia cursor'
Assert-Throws {Get-DistributionDecision '999' '000000000000007' '000000000000009' $now 65} 'SEFAZ' 'erro desconhecido nao avanca'
$resume=Get-SefazCursorPlan '000000000000000' '000000000001387'
Assert-Equal $resume.requestNsu '000000000001387' 'retomada usa cursor exigido pela SEFAZ'
Assert-Equal $resume.historyGapFrom '000000000000000' 'retomada preserva lacuna historica explicitamente'
Assert-Equal (Get-SefazCursorPlan '000000000001400' '000000000001387').requestNsu '000000000001400' 'hint remoto nunca regride cursor'
Assert-Throws {Get-SefazCursorPlan '000000000000000' 'abc'} 'NSU' 'hint remoto invalido nao aceito'
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('sefaz-test-'+[guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    $soap="<soap:Envelope xmlns:soap='http://www.w3.org/2003/05/soap-envelope'><soap:Body><retDistDFeInt xmlns='http://www.portalfiscal.inf.br/nfe'><tpAmb>2</tpAmb><cStat>138</cStat><xMotivo>Documentos localizados</xMotivo><ultNSU>000000000000001</ultNSU><maxNSU>000000000000001</maxNSU><loteDistDFeInt><docZip NSU='000000000000001' schema='resNFe_v1.01.xsd'>$b64</docZip></loteDistDFeInt></retDistDFeInt></soap:Body></soap:Envelope>"
    Save-DistributionBatch $soap $testRoot '38626750000146' '000000000000000' $now 65 | Out-Null
    $pending=@(Get-PendingDocuments $testRoot 10 1500000)
    Assert-Equal $pending.Count 1 'caixa de saida persiste antes de cursor'
    $state=Get-Content (Join-Path $testRoot 'state.json') -Raw | ConvertFrom-Json
    Assert-Equal $state.lastNsu '000000000000001' 'cursor persistido com lote seguro'
    Save-DistributionBatch $soap $testRoot '38626750000146' '000000000000000' $now 65 | Out-Null
    Assert-Equal @(Get-PendingDocuments $testRoot 10 1500000).Count 1 'replay local nao duplica pacote'
    Assert-Throws {Confirm-Documents $testRoot @('..\state')} 'ID' 'ack impede caminho fora da caixa'
    Confirm-Documents $testRoot @($pending[0].id)
    Assert-Equal @(Get-PendingDocuments $testRoot 10 1500000).Count 0 'ack retira somente pacote confirmado'
    Assert-Equal @(Get-ChildItem (Join-Path $testRoot 'archive') -Filter '*.json').Count 1 'ack mantem arquivo recuperavel'
    $bad=$soap.Replace($b64,'!!!').Replace('000000000000001','000000000000002')
    Assert-Throws {Save-DistributionBatch $bad $testRoot '38626750000146' '000000000000001' $now 65} 'Base-64|base64|Base64' 'erro parsing preserva cursor'
    $state=Get-Content (Join-Path $testRoot 'state.json') -Raw | ConvertFrom-Json
    Assert-Equal $state.lastNsu '000000000000001' 'falha parsing nunca pula NSU'
    Assert-Equal $state.nextAllowedAt '2026-10-29T13:05:00.0000000+00:00' 'falha parsing respeita intervalo'
    $sequence="<retDistDFeInt xmlns='http://www.portalfiscal.inf.br/nfe'><cStat>656</cStat><xMotivo>Deve ser utilizado o ultNSU nas solicitacoes subsequentes</xMotivo><ultNSU>000000000001387</ultNSU><maxNSU>000000000000000</maxNSU></retDistDFeInt>"
    $hint=Save-DistributionBatch $sequence $testRoot '38626750000146' '000000000000001' $now 65
    Assert-Equal $hint.serverNsuHint '000000000001387' '656 de sequencia preserva hint oficial'
    Assert-Equal $hint.lastNsu '000000000000001' '656 nao finge que documentos anteriores foram importados'
} finally {
    # Diretório temporário exato criado neste teste; nenhuma pasta do usuário é removida.
    if(Test-Path -LiteralPath $testRoot){
        $resolved=[IO.Path]::GetFullPath($testRoot)
        $tempBase=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
        if(-not $resolved.StartsWith($tempBase,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'sefaz-test-*'){throw 'Pasta temporaria fora do alvo permitido.'}
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
Write-Host "RESULTADO: $script:passed verificacoes aprovadas."
