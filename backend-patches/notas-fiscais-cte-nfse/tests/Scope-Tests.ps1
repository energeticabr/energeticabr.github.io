$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/Sefaz.psm1') -Force -DisableNameChecking
$checks=0
function Equal($Actual,$Expected,[string]$Name){if($Actual -cne $Expected){throw ('ASSERT_'+$Name)};$script:checks++}
$now=[DateTimeOffset]::Parse('2026-10-29T12:00:00Z')
function Doc([string]$Date,[string]$Nsu='000000000001000'){
 $text=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fixtures/nfe-danfe-homologacao.xml')).Replace('2026-10-20T12:00:00-03:00',$Date)
 ConvertFrom-FiscalXml $text $Nsu '38626750000146'
}
$old=Doc '2026-09-30T23:30:00-03:00';$current=Doc '2026-10-01T00:00:00-03:00' '000000000001001'
Equal (Get-SefazDocumentScopeDisposition $old @() '2026-10-01' $now) 'BEFORE_SCOPE' 'original_date_excludes_september_even_october_utc'
Equal (Get-SefazDocumentScopeDisposition $current @() '2026-10-01' $now) 'READY' 'october_boundary_included'
Equal (Get-SefazDocumentScopeDisposition (Doc '2026-11-01T00:00:00-03:00') @() '2026-10-01' $now) 'FUTURE_DATE' 'future_invoice_waits'
Equal (Get-SefazDocumentScopeDisposition (Doc '2026-11-01T00:00:00-03:00') @() '2026-10-01' ($now.AddDays(5))) 'READY' 'fixed_cutoff_keeps_future_monitoring'
$event=[pscustomobject]@{kind='procEventoNFe';key=$current.key;fields=[ordered]@{}}
Equal (Get-SefazDocumentScopeDisposition $event @() '2026-10-01' $now) 'PENDING_DATE' 'event_without_invoice_date_waits'
Equal (Get-SefazDocumentScopeDisposition $event @($current) '2026-10-01' $now) 'READY' 'event_uses_actual_october_invoice'
Equal (Get-SefazDocumentScopeDisposition $event @($old) '2026-10-01' $now) 'BEFORE_SCOPE' 'old_invoice_event_excluded'
$roundtrip=$old|ConvertTo-Json -Depth 30|ConvertFrom-Json
Equal (Get-SefazDocumentScopeDisposition $roundtrip @() '2026-10-01' $now) 'BEFORE_SCOPE' 'json_date_coercion_does_not_change_original_xml_day'
$root=Join-Path ([IO.Path]::GetTempPath()) ('sefaz-scope-test-'+[guid]::NewGuid().ToString('N'))
try{
 Write-AtomicJson (Join-Path $root ('outbox/'+$old.id+'.json')) $old
 Write-AtomicJson (Join-Path $root ('outbox/'+$current.id+'.json')) $current
 $before=(Get-FileHash -LiteralPath (Join-Path $root ('outbox/'+$old.id+'.json'))).Hash
 $result=Set-SefazOutboxScope $root @() '2026-10-01' $now
 Equal $result.excluded 1 'old_replay_removed_from_delivery_queue'
 Equal @(Get-PendingDocuments $root 10 1500000).Count 1 'only_current_month_remains_eligible'
 Equal (Get-FileHash -LiteralPath (Join-Path $root ('scope-excluded/'+$old.id+'.json'))).Hash $before 'excluded_document_bytes_preserved'
 Equal (Set-SefazOutboxScope $root @() '2026-10-01' $now).excluded 0 'replay_does_not_repeat_exclusion'
 Equal @(Get-ChildItem -LiteralPath (Join-Path $root 'scope-excluded') -File).Count 1 'exclusion_kept_for_audit'
 [ordered]@{status='PASS';checks=$checks;fiscalCalls=0;flowCalls=0}|ConvertTo-Json -Compress
}finally{
 $resolved=[IO.Path]::GetFullPath($root);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
 if(-not $resolved.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'sefaz-scope-test-*'){throw 'SCOPE_TEST_CLEANUP_PATH'}
 if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}
}
