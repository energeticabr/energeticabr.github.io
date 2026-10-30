$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/FlowTransport.psm1') -Force
Import-Module (Join-Path $PSScriptRoot '../src/ManualFiscalSync.psm1') -Force -DisableNameChecking
$script:checks=0
function Eq($a,$b,$label){if($a -cne $b){throw "$label expected [$b] got [$a]"};$script:checks++}
function Fails($action,$label){$caught=$false;try{& $action|Out-Null}catch{$caught=$true};Eq $caught $true $label}
$doc=[pscustomobject]@{id='synthetic-document'}
$legacy=Complete-SefazFlowDelivery @($doc) ([pscustomobject]@{source='SEFAZ';acknowledgedIds=@($doc.id)}) 'TEST' $null ''
Eq ($null -ne $legacy.PSObject.Properties['createdItemIds']) $false 'legacy is unknown, never manufactured empty'
$receipt=[pscustomobject]@{source='SEFAZ';acknowledgedIds=@($doc.id);createdItemIds=@(42,7,42)}
$complete=Complete-SefazFlowDelivery @($doc) $receipt 'TEST' $null ''
Eq ($complete.createdItemIds -join ',') '42,7' 'transport preserves true IDs and deduplicates'
foreach($invalid in @(@(0),@(-1),@($true),@('42'),@(1.5),@(9007199254740992))){
 $bad=[pscustomobject]@{source='SEFAZ';acknowledgedIds=@($doc.id);createdItemIds=$invalid}
 Fails {Assert-SefazReceipt $bad @($doc.id)} 'reject invalid item ID type/range'
}
$module=Get-Module ManualFiscalSync
$entry=@{deliveredIds=@();result=$null}
$saved=[pscustomobject]@{count=0}
$save={$saved.count++}.GetNewClosure()
& $module {param($Entry,$Doc,$Receipt,$Save) Confirm-ManualFiscalDelivery $Entry @($Doc) $Receipt $Save} $entry $doc $complete $save
Eq ($entry.createdItemIds -join ',') '42,7' 'native sender records row IDs separately from document IDs'
Eq ($entry.deliveredIds -join ',') $doc.id 'document ACK remains unchanged'
Eq $saved.count 1 'creation evidence saved before return'
& $module {param($Entry,$Doc,$Save) Confirm-ManualFiscalDelivery $Entry @($Doc) ([pscustomobject]@{acknowledgedIds=@($Doc.id);createdItemIds=@(7,99)}) $Save} $entry $doc $save
Eq ($entry.createdItemIds -join ',') '42,7,99' 'partial batch and retry union'
$unknown=@{deliveredIds=@('legacy-document');result=$null}
& $module {param($Entry,$Doc,$Save) Confirm-ManualFiscalDelivery $Entry @($Doc) ([pscustomobject]@{acknowledgedIds=@($Doc.id);createdItemIds=@()}) $Save} $unknown $doc $save
Eq $unknown.Contains('createdItemIds') $false 'new empty receipt cannot reclassify legacy documents as no creations'
$none=@{deliveredIds=@();result=$null}
& $module {param($Entry,$Doc,$Save) Confirm-ManualFiscalDelivery $Entry @($Doc) ([pscustomobject]@{acknowledgedIds=@($Doc.id);createdItemIds=@()}) $Save} $none $doc $save
Eq $none.Contains('createdItemIds') $true 'explicit no creations preserved'
Eq @($none.createdItemIds).Count 0 'confirmed none is an empty array'
& $module {param($Entry,$Doc,$Save) Confirm-ManualFiscalDelivery $Entry @($Doc) ([pscustomobject]@{acknowledgedIds=@($Doc.id)}) $Save} $none $doc $save
Eq $none.Contains('createdItemIds') $false 'later legacy receipt makes prior empty evidence unknown'
Fails {& $module {param($Entry,$Doc,$Save) Confirm-ManualFiscalDelivery $Entry @($Doc) ([pscustomobject]@{acknowledgedIds=@('wrong');createdItemIds=@(999)}) $Save} $entry $doc $save} 'no creation evidence without exact document ACK'
Eq ($entry.createdItemIds -join ',') '42,7,99' 'invalid ACK cannot pollute durable IDs'
$base=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')
$root=Join-Path $base ('created-receipt-test-'+[guid]::NewGuid().ToString('N'))
$script:runs=0;$script:reports=[Collections.Generic.List[object]]::new();$script:failReply=$true
$id='a'*32;$token='b'*64
$queue={param($action,$payload)
 switch($action){
  'heartbeat'{return @{ok=$true}}
  'claim'{return @{job=@{requestId=$id;leaseToken=$token;sources=@{NFE=@{status='queued'};CTE=@{status='queued'};NFSE=@{status='queued'}}}}}
  'renew'{return @{ok=$true}}
  'progress'{if($payload.result.status -eq 'succeeded' -and $script:failReply){$script:failReply=$false;throw 'SYNTHETIC_LOST_REPLY'};$script:reports.Add($payload);return @{ok=$true}}
  'complete'{return @{ok=$true;job=@{requestId=$id}}}
  default{throw 'unexpected operation'}
 }
}
$run={param($source,$requestId,$record,$save,$renew)
 $script:runs++;$record.sources[$source].createdItemIds=@(42,7,42)
 return @{status='succeeded';documents=12}
}
try{
 Fails {Invoke-ManualFiscalSync -DataRoot $root -Queue $queue -RunSource $run} 'simulated lost progress reply'
 $null=Invoke-ManualFiscalSync -DataRoot $root -Queue $queue -RunSource $run
 Eq $script:runs 3 'durable completion replay never recollects completed source'
 foreach($source in @('NFE','CTE','NFSE')){
  $r=@($script:reports|Where-Object {$_.source -eq $source -and $_.result.status -eq 'succeeded'})[-1].result
  Eq ($r.createdItemIds -join ',') '42,7' "$source IDs propagated from durable sender entry"
  Eq $r.documents 12 'processed count is independent'
 }
 $id='c'*32;$script:reports.Clear();$script:failReply=$false
 $null=Invoke-ManualFiscalSync -DataRoot $root -Queue $queue -RunSource {param($source,$requestId,$record,$save,$renew) return @{status='succeeded';documents=0}}
 foreach($source in @('NFE','CTE','NFSE')){
  $r=@($script:reports|Where-Object {$_.source -eq $source -and $_.result.status -eq 'succeeded'})[-1].result
  Eq $r.Contains('createdItemIds') $true "$source fresh zero-delivery query confirms no additions"
  Eq @($r.createdItemIds).Count 0 "$source fresh zero-delivery receipt is empty"
 }
 Write-Output "PASS CreatedItemReceipt $script:checks assertions; network requests 0"
}finally{
 $resolved=[IO.Path]::GetFullPath($root)
 if((Split-Path $resolved -Parent) -cne $base -or (Split-Path $resolved -Leaf) -notlike 'created-receipt-test-*'){throw 'UNSAFE_TEST_CLEANUP'}
 if(Test-Path -LiteralPath $resolved){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
