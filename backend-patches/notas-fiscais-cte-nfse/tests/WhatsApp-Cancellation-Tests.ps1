$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/FiscalDocuments.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../src/SefazWhatsApp.psm1') -Force -DisableNameChecking
$script:passed=0
function Equal($Actual,$Expected,[string]$Name){if($Actual -cne $Expected){throw ($Name+': expected ['+$Expected+'], got ['+$Actual+']')};$script:passed++}
$full=ConvertFrom-UnifiedFiscalXml ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fixtures/cte-ficticio.xml'))) '000000000000001' '38626750000146'
$key=$full.key
$eventXml=@"
<procEventoCTe xmlns="http://www.portalfiscal.inf.br/cte"><eventoCTe><infEvento><chCTe>$key</chCTe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><dhEvento>2026-10-29T12:00:00-03:00</dhEvento></infEvento></eventoCTe><retEventoCTe><infEvento><cStat>135</cStat><chCTe>$key</chCTe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><nProt>123456789</nProt></infEvento></retEventoCTe></procEventoCTe>
"@
$cancel=ConvertFrom-UnifiedFiscalXml $eventXml '000000000000002' '38626750000146'
$full|Add-Member danfe ([pscustomobject]@{fileName=('DACTE-'+$key+'-'+$full.sha256.Substring(0,16)+'.pdf');pdfBase64='SYNTHETIC';sha256=('a'*64)})
function Receipt($Documents){[pscustomobject]@{source='SEFAZ';acknowledgedIds=@($Documents|ForEach-Object {$_.id})}}
function NotificationPath([string]$Root){Join-Path $Root ($key+'.json')}
function QueueRecord([string]$Root){Get-Content -LiteralPath (NotificationPath $Root) -Raw|ConvertFrom-Json}
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('fiscal-cancellation-test-'+[guid]::NewGuid().ToString('N'))
try{
 $sameBatch=Join-Path $testRoot 'same-batch'
 Save-SefazWhatsAppNotification @($full,$cancel) (Receipt @($full,$cancel)) $sameBatch
 Equal (Test-Path -LiteralPath (NotificationPath $sameBatch)) $false 'confirmed full and cancellation must not stage an authorized notification'
 Save-SefazWhatsAppNotification @($full) (Receipt @($full)) $sameBatch
 Equal (Test-Path -LiteralPath (NotificationPath $sameBatch)) $false 'later full replay remains blocked'

 $eventFirst=Join-Path $testRoot 'event-first'
 Save-SefazWhatsAppNotification @($cancel) (Receipt @($cancel)) $eventFirst
 Save-SefazWhatsAppNotification @($full) (Receipt @($full)) $eventFirst
 Equal (Test-Path -LiteralPath (NotificationPath $eventFirst)) $false 'event without full persists a blocking marker'

 $pending=Join-Path $testRoot 'pending'
 Save-SefazWhatsAppNotification @($full) (Receipt @($full)) $pending
 Save-SefazWhatsAppNotification @($cancel) (Receipt @($cancel)) $pending
 Equal (QueueRecord $pending).state 'suppressed' 'pending local notification is suppressed by confirmed cancellation'
 $script:staged=0
 $remote={param($Config,$Request)if($Request.mode -eq 'stage'){$script:staged++;return [pscustomobject]@{status='staged';key=$key}};return [pscustomobject]@{status='reconciled'}}
 $null=Invoke-SefazWhatsAppDrain ([pscustomobject]@{whatsappEnabled=$true}) $pending $remote
 Equal $script:staged 0 'suppressed pending notification never crosses remote stage'

 # A pending file restored from an older backup must still consult the marker.
 $legacy=QueueRecord $pending;$legacy.state='pending';$legacy|ConvertTo-Json -Depth 35|Set-Content -LiteralPath (NotificationPath $pending)
 $null=Invoke-SefazWhatsAppDrain ([pscustomobject]@{whatsappEnabled=$true}) $pending $remote
 Equal $script:staged 0 'drain rechecks durable marker before staging legacy pending files'
 Equal (QueueRecord $pending).state 'suppressed' 'legacy pending file records conservative suppression'

 $alreadyRemote=Join-Path $testRoot 'remote'
 Save-SefazWhatsAppNotification @($full) (Receipt @($full)) $alreadyRemote
 $sent=QueueRecord $alreadyRemote;$sent.state='remote_staged';$sent|ConvertTo-Json -Depth 35|Set-Content -LiteralPath (NotificationPath $alreadyRemote)
 Save-SefazWhatsAppNotification @($cancel) (Receipt @($cancel)) $alreadyRemote
 Equal (QueueRecord $alreadyRemote).state 'remote_staged' 'already remote state never pretends recall or suppression'
 $sent=QueueRecord $alreadyRemote;$sent.state='sent';$sent|ConvertTo-Json -Depth 35|Set-Content -LiteralPath (NotificationPath $alreadyRemote)
 Save-SefazWhatsAppNotification @($cancel) (Receipt @($cancel)) $alreadyRemote
 Equal (QueueRecord $alreadyRemote).state 'sent' 'confirmed sent history never claims a recall'

 $nfse=ConvertFrom-UnifiedFiscalXml ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fixtures/nfse-ficticia.xml'))) '9223372036854775806' '38626750000146'
 $nfse|Add-Member danfe ([pscustomobject]@{fileName=('DANFSe-'+$nfse.key+'-'+$nfse.sha256.Substring(0,16)+'.pdf');pdfBase64='SYNTHETIC';sha256=('b'*64)})
 $substituted=[pscustomobject]@{id='9223372036854775807-0123456789abcdef';key=$nfse.key;kind='evento';fields=[ordered]@{SITUACAO='SUBSTITUIDA'}}
 $serviceRoot=Join-Path $testRoot 'substituted-service'
 Save-SefazWhatsAppNotification @($substituted) (Receipt @($substituted)) $serviceRoot
 Save-SefazWhatsAppNotification @($nfse) (Receipt @($nfse)) $serviceRoot
 Equal (Test-Path -LiteralPath (Join-Path $serviceRoot ($nfse.key+'.json'))) $false 'substituted national key50 blocks subsequent XML with NSU19'

 $unconfirmed=Join-Path $testRoot 'bad-receipt'
 $caught=$false;try{Save-SefazWhatsAppNotification @($cancel) ([pscustomobject]@{source='SEFAZ';acknowledgedIds=@()}) $unconfirmed}catch{$caught=$true}
 Equal $caught $true 'unconfirmed cancellation cannot establish a marker'
 Save-SefazWhatsAppNotification @($full) (Receipt @($full)) $unconfirmed
 Equal (QueueRecord $unconfirmed).state 'pending' 'failed cancellation receipt cannot suppress a valid full notification'
}finally{
 $resolved=[IO.Path]::GetFullPath($testRoot);$tempBase=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
 if(-not $resolved.StartsWith($tempBase,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'fiscal-cancellation-test-*'){throw 'TEST_TEMP_INVALID'}
 if(Test-Path -LiteralPath $resolved){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
Write-Output ('PASS cancellation notification assertions: '+$script:passed+'; real messages:0')
