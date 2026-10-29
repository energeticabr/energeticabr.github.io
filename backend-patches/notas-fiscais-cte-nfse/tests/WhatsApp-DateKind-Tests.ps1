$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/FiscalDocuments.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../src/SefazWhatsApp.psm1') -Force -DisableNameChecking
$script:passed=0
function Equal($Actual,$Expected,[string]$Name){if($Actual -cne $Expected){throw ($Name+': expected ['+$Expected+'], got ['+$Actual+']')};$script:passed++}
function Read-LiteralJson([string]$Path){
 $parameters=@{};if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){$parameters.DateKind='String'}
 Get-Content -LiteralPath $Path -Raw|ConvertFrom-Json @parameters
}
$doc=ConvertFrom-UnifiedFiscalXml ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fixtures/cte-ficticio.xml'))) '000000000000001' '38626750000146'
$doc|Add-Member danfe ([pscustomobject]@{fileName=('DACTE-'+$doc.key+'-'+$doc.sha256.Substring(0,16)+'.pdf');pdfBase64='SYNTHETIC';sha256=('a'*64)})
$receipt=[pscustomobject]@{source='SEFAZ';acknowledgedIds=@($doc.id)}
$config=[pscustomobject]@{whatsappEnabled=$true}
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('fiscal-datekind-test-'+[guid]::NewGuid().ToString('N'))
$oldCulture=[Threading.Thread]::CurrentThread.CurrentCulture
$oldUiCulture=[Threading.Thread]::CurrentThread.CurrentUICulture
try{
 [Threading.Thread]::CurrentThread.CurrentCulture=[Globalization.CultureInfo]::GetCultureInfo('pt-BR')
 [Threading.Thread]::CurrentThread.CurrentUICulture=[Globalization.CultureInfo]::GetCultureInfo('pt-BR')
 foreach($day in @('29','31')){
  $root=Join-Path $testRoot ('future-'+$day)
  Save-SefazWhatsAppNotification @($doc) $receipt $root
  $path=Join-Path $root ($doc.key+'.json')
  $item=Read-LiteralJson $path
  $item.attempts=19;$item.code='WHATSAPP_RETRY';$item.nextRetryAt='2099-10-'+$day+'T16:10:00.0000000+00:00'
  $item|ConvertTo-Json -Depth 35|Set-Content -LiteralPath $path -Encoding UTF8
  $before=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  $counts=[pscustomobject]@{stage=0;drain=0}
  $remote={param($Config,$Request)if($Request.mode -eq 'stage'){$counts.stage++;return [pscustomobject]@{status='staged';key=$Request.document.key}};$counts.drain++;return [pscustomobject]@{status='reconciled'}}.GetNewClosure()
  foreach($iteration in @(1,2)){
   $result=Invoke-SefazWhatsAppDrain $config $root $remote
   $after=Read-LiteralJson $path
   Equal $result.status 'reconciled' ('future retry does not fail under pt-BR day '+$day)
   Equal $counts.stage 0 'future notification never reaches stage'
   Equal $counts.drain $iteration 'global drain is still allowed'
   Equal $after.attempts 19 'future retry never increments attempts'
   Equal $after.nextRetryAt ('2099-10-'+$day+'T16:10:00.0000000+00:00') 'future timestamp stays literal ISO text'
   Equal $after.state 'pending' 'future pending state remains pending'
   Equal (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash $before 'future guard never rewrites the notification'
  }
 }
 $pastRoot=Join-Path $testRoot 'past-31'
 Save-SefazWhatsAppNotification @($doc) $receipt $pastRoot
 $pastPath=Join-Path $pastRoot ($doc.key+'.json');$past=Read-LiteralJson $pastPath
 $past.attempts=19;$past.nextRetryAt='2000-10-31T16:10:00.0000000+00:00';$past|ConvertTo-Json -Depth 35|Set-Content -LiteralPath $pastPath -Encoding UTF8
 $counts=[pscustomobject]@{stage=0;drain=0}
 $remote={param($Config,$Request)if($Request.mode -eq 'stage'){$counts.stage++;return [pscustomobject]@{status='staged';key=$Request.document.key}};$counts.drain++;return [pscustomobject]@{status='reconciled'}}.GetNewClosure()
 $result=Invoke-SefazWhatsAppDrain $config $pastRoot $remote;$past=Read-LiteralJson $pastPath
 Equal $result.status 'reconciled' 'expired retry can drain under pt-BR'
 Equal $counts.stage 1 'expired retry stages exactly once'
 Equal $past.state 'remote_staged' 'expired retry records remote acceptance'
 Equal $past.attempts 19 'successful stage does not increment failure attempts'
 Equal $past.nextRetryAt $null 'successful stage clears retry timestamp'
}finally{
 [Threading.Thread]::CurrentThread.CurrentCulture=$oldCulture
 [Threading.Thread]::CurrentThread.CurrentUICulture=$oldUiCulture
 $resolved=[IO.Path]::GetFullPath($testRoot);$tempBase=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
 if(-not $resolved.StartsWith($tempBase,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'fiscal-datekind-test-*'){throw 'TEST_TEMP_INVALID'}
 if(Test-Path -LiteralPath $resolved){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
Write-Output ('PASS notification date-kind assertions: '+$script:passed+'; real messages:0')
