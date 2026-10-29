$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/Sefaz.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../src/Danfe.psm1') -Force
$script:passed=0
function Assert-True($Value,[string]$Name){if(-not $Value){throw "FALHOU: $Name"};$script:passed++;Write-Host "PASS $Name"}
function Assert-Fails([scriptblock]$Action,[string]$Name){$failed=$false;try{& $Action}catch{$failed=$true};Assert-True $failed $Name}
$xml=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fixtures/nfe-danfe-homologacao.xml'))
$doc=ConvertFrom-FiscalXml $xml '000000000000001' '38626750000146'
$pdf=[Text.Encoding]::ASCII.GetBytes("%PDF-1.4`nSYNTHETIC TRANSPORT TEST ONLY`n%%EOF`n")
$sha=[Security.Cryptography.SHA256]::Create()
try{$hash=([BitConverter]::ToString($sha.ComputeHash($pdf))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
$script:response=[pscustomobject]@{key=$doc.key;xmlSha256=$doc.sha256;fileName=('DANFE-'+$doc.key+'-'+$doc.sha256.Substring(0,16)+'.pdf');pdfBase64=[Convert]::ToBase64String($pdf);pdfSha256=$hash}
$valid={param($Config,$Request) $script:response}
$result=Add-SefazDanfe $doc ([pscustomobject]@{}) $valid
Assert-True ($result.danfe.fileName -eq $script:response.fileName) 'PDF vinculado a chave e hash do XML'
Assert-True ($result.danfe.sha256 -eq $hash -and $result.xmlBase64 -eq $doc.xmlBase64) 'PDF validado preserva XML original'
$summary=ConvertFrom-FiscalXml "<resNFe xmlns='http://www.portalfiscal.inf.br/nfe'><chNFe>$($doc.key)</chNFe></resNFe>" '000000000000002' '38626750000146'
$same=Add-SefazDanfe $summary ([pscustomobject]@{}) {throw 'RESUMO_NAO_DEVE_RENDERIZAR'}
Assert-True (-not $same.PSObject.Properties['danfe']) 'Resumo nao gera falso espelho'
$script:response.pdfSha256='0'*64
Assert-Fails {Add-SefazDanfe $doc ([pscustomobject]@{}) $valid} 'Hash PDF divergente impede confirmacao'
$script:response.pdfSha256=$hash
$script:response.key='0'*44
Assert-Fails {Add-SefazDanfe $doc ([pscustomobject]@{}) $valid} 'Chave divergente impede anexo em outra nota'
$script:response.key=$doc.key
$script:response.fileName='../nota.pdf'
Assert-Fails {Add-SefazDanfe $doc ([pscustomobject]@{}) $valid} 'Nome inesperado impede upload'
$script:response.fileName='DANFE-'+$doc.key+'-'+$doc.sha256.Substring(0,16)+'.pdf'
$script:response.pdfBase64=[Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('<html>erro</html>'))
Assert-Fails {Add-SefazDanfe $doc ([pscustomobject]@{}) $valid} 'HTML de erro nao e PDF'
Write-Host "RESULTADO: $script:passed verificacoes DANFE aprovadas."
