$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/AuxiliaryFiscal.psm1') -Force -DisableNameChecking
$base=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')
$root=Join-Path $base ('manual-slot-test-'+[guid]::NewGuid().ToString('N'))
$id='a'*32;$slot='manual:'+$id;$now=[DateTimeOffset]::Parse('2026-10-29T21:00:00Z')
$config=@{companyCnpj='12345678000195';environment='2';minimumIssueDate='2026-09-01'}
$script:requests=0
$request={param($c,$n)$script:requests++;return 'synthetic response'}
$parse={param($body,$cnpj) [pscustomobject]@{status='137';lastNsu='0';maxNsu='0';documents=@();unhandledDocuments=@()}}
try{
 $path=Join-Path $root 'CTE'
 $r=Invoke-AuxiliaryFiscalSource -Source CTE -DataPath $path -Config $config -Slot $slot -Now $now -Request $request -Parse $parse -SendBatch {throw 'empty response must not send'}
 if($r.status -cne 'COMPLETED' -or $r.lastCompletedSlot -cne $slot -or $script:requests -ne 1){throw 'MANUAL_SLOT_NOT_COLLECTED'}
 $r=Invoke-AuxiliaryFiscalSource -Source CTE -DataPath $path -Config $config -Slot $slot -Now $now -Request {throw 'must not repeat completed manual request'}
 if($r.status -cne 'ALREADY_COMPLETED'){throw 'MANUAL_SLOT_NOT_IDEMPOTENT'}
 $r=Invoke-AuxiliaryFiscalSource -Source CTE -DataPath $path -Config $config -Slot ('manual:'+('b'*32)) -Now $now -Request {throw 'must respect cooldown'}
 if($r.status -cne 'COOLDOWN'){throw 'MANUAL_SLOT_BYPASSED_COOLDOWN'}
 $r=Invoke-AuxiliaryFiscalSource -Source CTE -DataPath $path -Config $config -Slot '2026-10-29-20' -Now $now -Request {throw 'daily must respect cooldown'}
 if($r.status -cne 'COOLDOWN'){throw 'MANUAL_SLOT_BROKE_DAILY'}
 foreach($bad in @('manual:../bad','manual:'+('A'*32),'manual:'+('c'*33),'2026-99-29-20')){
  $failed=$false;try{Invoke-AuxiliaryFiscalSource -Source CTE -DataPath $path -Config $config -Slot $bad -Request {throw 'must not request'}|Out-Null}catch{$failed=$true}
  if(-not $failed){throw 'INVALID_SLOT_ACCEPTED'}
 }
 Write-Output 'PASS ManualFiscalSlots 8 assertions'
}finally{
 if([IO.Directory]::Exists($root)){$resolved=[IO.Path]::GetFullPath($root);if((Split-Path $resolved -Parent) -cne $base -or (Split-Path $resolved -Leaf) -notlike 'manual-slot-test-*'){throw 'UNSAFE_TEST_CLEANUP'};Remove-Item -LiteralPath $resolved -Recurse -Force}
}
