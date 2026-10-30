$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/ManualFiscalSync.psm1') -Force -DisableNameChecking
$module=Get-Module ManualFiscalSync
$script:checks=0
function Eq($a,$b,$label){if($a -cne $b){throw "$label expected [$b] got [$a]"};$script:checks++}
function Make-Save($Entry,$Store){return {$Store.json=$Entry|ConvertTo-Json -Depth 12 -Compress}.GetNewClosure()}
$command=& $module {Get-Command Invoke-ManualFiscalDelivery -ErrorAction SilentlyContinue}
Eq ($null -ne $command) $true 'delivery boundary must durably track an unconfirmed creation attempt'
$document=[pscustomobject]@{id='fictitious-document'}
$entry=@{deliveredIds=@();createdItemIds=@()}
$store=[pscustomobject]@{json='';beforeReply='';created=0}
$save=Make-Save $entry $store
$lost={param($Batch)
 $snapshot=$store.json|ConvertFrom-Json -AsHashtable
 Eq ($snapshot.pendingDeliveryIds -join ',') $document.id 'pending IDs persisted before a possible side effect'
 $store.beforeReply=$store.json;$store.created++
 throw 'SYNTHETIC_FLOW_RESPONSE_LOST_AFTER_CREATION'
}.GetNewClosure()
try{& $command $entry @($document) $lost $save|Out-Null;throw 'expected lost response'}catch{if($_.Exception.Message -ne 'SYNTHETIC_FLOW_RESPONSE_LOST_AFTER_CREATION'){throw}}
Eq $entry.creationEvidenceUnknown $true 'lost response marks creation evidence unknown'
Eq $entry.Contains('createdItemIds') $false 'unknown creation cannot retain a previous empty list'
# Simulate process death before the catch could persist its uncertainty marker.
$restarted=$store.beforeReply|ConvertFrom-Json -AsHashtable
$retrySave=Make-Save $restarted $store
$existing={param($Batch) return [pscustomobject]@{acknowledgedIds=@($document.id);createdItemIds=@()}}.GetNewClosure()
$null=& $command $restarted @($document) $existing $retrySave
Eq $store.created 1 'retry does not create another fiscal row'
Eq $restarted.creationEvidenceUnknown $true 'durable pre-send marker survives restart'
Eq $restarted.Contains('createdItemIds') $false 'update-only retry never claims zero earlier creations'
Eq $restarted.Contains('pendingDeliveryIds') $false 'confirmed delivery clears only the pending marker'
Eq ($restarted.deliveredIds -join ',') $document.id 'confirmed document acknowledgement is retained'
$known=@{deliveredIds=@();createdItemIds=@(99)};$knownStore=[pscustomobject]@{json=''}
$knownSave=Make-Save $known $knownStore
try{& $command $known @($document) {throw 'SYNTHETIC_FAILURE'} $knownSave|Out-Null}catch{if($_.Exception.Message -ne 'SYNTHETIC_FAILURE'){throw}}
Eq ($known.createdItemIds -join ',') '99' 'unknown later attempt preserves positive confirmed IDs'
$clean=@{deliveredIds=@();createdItemIds=@()};$cleanStore=[pscustomobject]@{json=''}
$null=& $command $clean @($document) $existing (Make-Save $clean $cleanStore)
Eq $clean.Contains('createdItemIds') $true 'successful first delivery can confirm an empty list'
Eq @($clean.createdItemIds).Count 0 'explicit first-delivery no-creations remains empty'
Eq $clean.Contains('creationEvidenceUnknown') $false 'normal confirmed reply is not classified as unknown'
Write-Output "PASS CreatedItemUncertainty $script:checks assertions; network requests 0"
