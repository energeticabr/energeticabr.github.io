$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/FiscalDocuments.psm1') -Force -DisableNameChecking
$passed=0
function Equal($a,$b,$label){if($a -cne $b){throw "$label : expected [$b], got [$a]"};$script:passed++}
function Throws($action,$pattern,$label){$caught=$false;try{&$action|Out-Null}catch{if($_.Exception.Message -notmatch $pattern){throw};$caught=$true};Equal $caught $true $label}
$now=[DateTimeOffset]::Parse('2026-10-29T20:00:00Z')
foreach($case in @(@('cte-ficticio.xml','CT-e','SEFAZ_CTE','DACTE'),@('nfse-ficticia.xml','NFS-e','ADN_NFSE','DANFSe'),@('nfe-danfe-homologacao.xml','NF-e','SEFAZ_NFE','DANFE'))){
 $text=[IO.File]::ReadAllText((Join-Path $PSScriptRoot ('fixtures/'+$case[0])))
 $doc=ConvertFrom-UnifiedFiscalXml $text '000000000000001' '38626750000146'
 Equal $doc.fields.TIPO_FISCAL $case[1] 'document type'
 Equal $doc.fields.ORIGEM_FISCAL $case[2] 'government source'
 Equal (Get-FiscalPdfPrefix $doc) $case[3] 'own document PDF prefix'
 Equal (Get-FiscalDocumentScopeDisposition $doc @() '2026-10-01' $now) 'READY' 'current month in original time zone'
 Equal (Get-FiscalDocumentScopeDisposition $doc @() '2026-11-01' $now) 'BEFORE_SCOPE' 'old invoice excluded without cursor reset'
 $validated=Assert-FiscalDocumentIntegrity $doc
 Equal $validated.key $doc.key 'reparsed identity'
 $doc.sha256='0'*64
 Throws {Assert-FiscalDocumentIntegrity $doc} 'INTEGRITY' 'forged hash rejected'
}
$service=ConvertFrom-UnifiedFiscalXml ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fixtures/nfse-ficticia.xml'))) '9223372036854775807' '38626750000146'
Equal $service.nsu '9223372036854775807' 'ADN NSU19 is never truncated'
Equal $service.key.Length 50 'service key50 retained'
Equal (Get-FiscalDocumentScopeDisposition $service @() '2026-10-01' ([DateTimeOffset]::Parse('2026-10-01T00:00:00Z'))) 'FUTURE_DATE' 'future issue date held'
Throws {ConvertFrom-UnifiedFiscalXml '<!DOCTYPE a [<!ENTITY e SYSTEM "file:///c:/x">]><NFSe>&e;</NFSe>' '1' '38626750000146'} 'XML|DTD|DOCTYPE' 'external entities forbidden'
Import-Module (Join-Path $PSScriptRoot '../src/FlowTransport.psm1') -Force -DisableNameChecking
$validatedBatch=@(ConvertTo-ValidatedSefazBatch @($service))
Equal $validatedBatch.Count 1 'transport accepts national key50/NSU19'
Equal $validatedBatch[0].fields.VALOR_TOTAL_NOTA ([decimal]1000) 'transport uses literal XML amount'
$service.fields.VALOR_TOTAL_NOTA=1
Equal (@(ConvertTo-ValidatedSefazBatch @($service)))[0].fields.VALOR_TOTAL_NOTA ([decimal]1000) 'supplied fields cannot override XML'
Write-Output ('PASS unified fiscal assertions: '+$passed)
