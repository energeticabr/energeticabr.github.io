$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/FlowTransport.psm1') -Force
$script:passed=0
function Assert-Fails([scriptblock]$Action,[string]$Name){$failed=$false;try{& $Action}catch{$failed=$true};if(-not $failed){throw "FALHOU: $Name"};$script:passed++;Write-Host "PASS $Name"}
function Assert-True($Value,[string]$Name){if(-not $Value){throw "FALHOU: $Name"};$script:passed++;Write-Host "PASS $Name"}
Assert-Fails {Assert-SefazReceipt ([pscustomobject]@{source='SEFAZ';acknowledgedIds=@('a')}) @('a','b')} 'ack parcial nao libera documentos'
Assert-Fails {Assert-SefazReceipt ([pscustomobject]@{source='SEFAZ';acknowledgedIds=@('a','a')}) @('a')} 'ack duplicado nao libera documentos'
Assert-Fails {Assert-SefazReceipt ([pscustomobject]@{source='OUTRA';acknowledgedIds=@('a')}) @('a')} 'origem deve ser SEFAZ'
Assert-Fails {Assert-SefazReceipt ([pscustomobject]@{source='SEFAZ';acknowledgedIds=@('A')}) @('a')} 'ack exige caixa exata'
Assert-SefazReceipt ([pscustomobject]@{source='SEFAZ';acknowledgedIds=@('b','a')}) @('a','b')
Assert-True $true 'ack exato permite confirmacao'
$xml="<resNFe xmlns='http://www.portalfiscal.inf.br/nfe'><chNFe>31261012345678000123550010000001231000001234</chNFe><CNPJ>12345678000123</CNPJ><xNome>Teste ficticio</xNome><dhEmi>2026-10-20T12:00:00-03:00</dhEmi><vNF>950.00</vNF><cSitNFe>1</cSitNFe></resNFe>"
Import-Module (Join-Path $PSScriptRoot '../src/Sefaz.psm1') -Force
$doc=ConvertFrom-FiscalXml $xml '000000000000001' '38626750000146'
$normalized=@(ConvertTo-ValidatedSefazBatch @($doc))
Assert-True ($normalized.Count -eq 1 -and $normalized[0].fields.VALOR_TOTAL_NOTA -eq 950) 'XML realimentado sem perder valores'
$doc.id='000000000000001-0000000000000000'
Assert-Fails {ConvertTo-ValidatedSefazBatch @($doc)} 'hash e ID divergentes impedem envio'
$invalidNsu=ConvertFrom-FiscalXml $xml '00000000000000x' '38626750000146'
Assert-Fails {ConvertTo-ValidatedSefazBatch @($invalidNsu)} 'NSU nao numerico impedido no transporte'
Write-Host "RESULTADO: $script:passed verificacoes de transporte aprovadas."
