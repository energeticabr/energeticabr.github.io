$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot '../src/Sefaz.psm1') -Force -DisableNameChecking
$module=Join-Path $PSScriptRoot '../src/GapRecovery.psm1'
if(Test-Path -LiteralPath $module){Import-Module $module -Force -DisableNameChecking}else{function New-GapRecoveryPlan {return $null}}
$script:checks=0
function Equal($Actual,$Expected,[string]$Name){if($Actual -cne $Expected){throw ('ASSERT_'+$Name)};$script:checks++}
function Throws([scriptblock]$Action,[string]$Pattern,[string]$Name){$caught=$false;try{& $Action|Out-Null}catch{if($_.Exception.Message -notmatch $Pattern){throw};$caught=$true};Equal $caught $true $Name}
$now=[DateTimeOffset]::Parse('2026-10-29T10:45:00Z')
$company='38626750000146'
function Xml([string]$Nsu,[string]$Issuer='12345678000195',[string]$Recipient=$company,[string]$Date='2026-10-20T12:00:00-03:00'){
    $key='312610'+$Issuer+'55001'+([long]$Nsu).ToString('000000000')+'1'+'00000001'
    $dv=11-((0..42|ForEach-Object{[int]::Parse($key.Substring(42-$_,1))*(($_%8)+2)}|Measure-Object -Sum).Sum%11)
    if($dv -ge 10){$dv=0};$key+=[string]$dv
    return '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe'+$key+'"><ide><mod>55</mod><nNF>'+[long]$Nsu+'</nNF><serie>1</serie><dhEmi>'+$Date+'</dhEmi></ide><emit><CNPJ>'+$Issuer+'</CNPJ><xNome>OFFLINE TEST</xNome></emit><dest><CNPJ>'+$Recipient+'</CNPJ></dest><total><ICMSTot><vNF>123.45</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><cStat>100</cStat><chNFe>'+$key+'</chNFe><nProt>123456789012345</nProt></infProt></protNFe></nfeProc>'
}
function Soap([string]$Text,[string]$Nsu='000000000001252'){
    $memory=[IO.MemoryStream]::new();$gzip=[IO.Compression.GZipStream]::new($memory,[IO.Compression.CompressionMode]::Compress,$true)
    $bytes=[Text.Encoding]::UTF8.GetBytes($Text);$gzip.Write($bytes,0,$bytes.Length);$gzip.Dispose();$b64=[Convert]::ToBase64String($memory.ToArray());$memory.Dispose()
    return '<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe"><cStat>138</cStat><loteDistDFeInt><docZip NSU="'+$Nsu+'">'+$b64+'</docZip></loteDistDFeInt></retDistDFeInt>'
}
$anchors=@(1251,1253,1273,1306,1329,1339)
$known=@($anchors|ForEach-Object{ConvertFrom-FiscalXml (Xml ([string]$_)) $_.ToString('000000000000000') $company})
$plan=New-GapRecoveryPlan -KnownDocuments $known -CompanyCnpj $company -Now $now
Equal ($null -ne $plan) $true 'gap_plan_exists'
Equal @($plan.targets).Count 83 'only_83_missing_internal_nsus'
Equal $plan.targets[0].nsu '000000000001252' 'first_missing'
Equal $plan.targets[-1].nsu '000000000001338' 'last_missing'
Equal @($plan.targets|Where-Object{[long]$_.nsu -in $anchors}).Count 0 'six_archives_excluded'
Equal @($plan.targets|Where-Object{[long]$_.nsu -lt 1251 -or [long]$_.nsu -gt 1339}).Count 0 'no_prefix_scan'
Throws {New-GapRecoveryPlan -KnownDocuments @($known|Select-Object -First 5) -CompanyCnpj $company -Now $now} 'GAP_ANCHOR' 'missing_anchor_blocks'
$root=Join-Path ([IO.Path]::GetTempPath()) ('sefaz-gap-test-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root)|Out-Null
try{
    $prior=Join-Path $root 'prior.json'
    $seed=[ordered]@{status='COMPLETED';acknowledged=3;nextAllowedAt=$now.AddMinutes(53).ToString('o');attempts=@(1..3|ForEach-Object{@{index=$_;startedAt=$now.AddMinutes(-12).AddSeconds($_).ToString('o');status='138';documentIds=@('id'+$_)}})}
    Write-AtomicJson $prior $seed
    $pin=[pscustomobject]@{path=$prior;sha256=(Get-FileHash -LiteralPath $prior).Hash}
    $ledger=New-GapPointLedger -PriorSources @($pin) -Now $now
    Equal @($ledger.attempts).Count 3 'seed_all_three_recent_point_attempts'
    Equal $ledger.events[0].type 'POLICY_CHANGE_RECALCULATED' 'policy_change_durable_evidence'
    $live=[pscustomobject]@{lastNsu='000000000001387';status='137';nextAllowedAt=$now.AddHours(-1).ToString('o')}
    $governor=Get-GapGovernorNextAllowed -PointLedger $ledger -LiveState $live -Now $now
    Equal $governor.available 15 '18_limit_includes_three_seed_attempts'
    Equal $governor.allowed $true 'proved_138_artificial_hold_recalculated'
    $priorHash=(Get-FileHash -LiteralPath $prior).Hash
    Equal $priorHash $pin.sha256 'prior_ledger_unchanged'
    Throws {New-GapPointLedger -PriorSources @([pscustomobject]@{path=$prior;sha256=('A'*64)}) -Now $now} 'GAP_SEED_HASH' 'seed_hash_pin'
    $unsafe=Read-GapJson $prior;$unsafe.acknowledged=2;Write-AtomicJson $prior $unsafe
    $unsafePin=[pscustomobject]@{path=$prior;sha256=(Get-FileHash -LiteralPath $prior).Hash}
    $held=New-GapPointLedger -PriorSources @($unsafePin) -Now $now
    Equal (Get-GapGovernorNextAllowed $held $live $now).allowed $false 'unproved_old_hold_never_ignored'
    1..15|ForEach-Object{$ledger.attempts+=@([pscustomobject]@{id=[guid]::NewGuid().ToString('N');queryType='consNSU';target=$_.ToString('000000000000000');startedAt=$now.ToString('o');status='138';holdUntil=$now.ToString('o')})}
    $full=Get-GapGovernorNextAllowed $ledger $live $now
    Equal $full.available 0 'eighteen_shared_points_exhaust_budget'
    Equal $full.reason 'POINT_RATE_LIMIT' 'point_limit_reason'
    Equal (Get-GapGovernorNextAllowed $ledger $live ($now.AddMinutes(49))).available 3 'sliding_window_releases_seed_slots'
    $live.nextAllowedAt=$now.AddMinutes(65).ToString('o')
    Equal (Get-GapGovernorNextAllowed $ledger $live $now).reason 'LIVE_DISTRIBUTION_COOLDOWN' 'actual_dist_137_hold_wins'
    $live.nextAllowedAt=$now.AddHours(-1).ToString('o')
    $target='000000000001252';$body=Xml $target
    $parsed=ConvertFrom-GapResponse (Soap $body $target) $target $company $now
    Equal $parsed.document.fields.CNPJ_FORNECEDOR '12345678000195' 'other_provider_accepted'
    Equal $parsed.document.fields.VALOR_TOTAL_NOTA ([decimal]123.45) 'real_total_preserved'
    Throws {ConvertFrom-GapResponse (Soap $body '000000000001254') $target $company $now} 'GAP_RESPONSE_NSU' 'exact_target_nsu'
    Throws {ConvertFrom-GapResponse (Soap (Xml $target '12345678000195' '11111111000191') $target) $target $company $now} 'GAP_COMPANY_ROLE' 'unrelated_company_full_xml_rejected'
    Throws {ConvertFrom-GapResponse '<!DOCTYPE a [<!ENTITY e SYSTEM "file:///C:/Windows/win.ini">]><a>&e;</a>' $target $company $now} 'DTD|DOCTYPE' 'safe_xml'
    foreach($status in @('137','656')){Equal (ConvertFrom-GapResponse ('<retDistDFeInt><cStat>'+$status+'</cStat></retDistDFeInt>') $target $company $now).status $status ('status_'+$status)}
    Throws {ConvertFrom-GapResponse '<retDistDFeInt><cStat>999</cStat></retDistDFeInt>' $target $company $now} 'GAP_STATUS_UNKNOWN' 'unknown_halts'
    $key=$parsed.document.key
    $summary='<resNFe xmlns="http://www.portalfiscal.inf.br/nfe"><chNFe>'+$key+'</chNFe><CNPJ>12345678000195</CNPJ><xNome>OFFLINE SUMMARY</xNome><dhEmi>2026-10-20T12:00:00-03:00</dhEmi><vNF>123.45</vNF><cSitNFe>1</cSitNFe></resNFe>'
    $summaryDoc=(ConvertFrom-GapResponse (Soap $summary $target) $target $company $now).document
    Equal $summaryDoc.kind 'resNFe' 'summary_is_preserved'
    Equal $summaryDoc.fields.Contains('VALOR_LIQUIDO') $false 'summary_no_fake_liquid_total'
    Equal $summaryDoc.fields.Contains('DESCONTOS') $false 'summary_no_fake_zero_discounts'
    $event='<resEvento xmlns="http://www.portalfiscal.inf.br/nfe"><chNFe>'+$key+'</chNFe><tpEvento>110111</tpEvento><dhEvento>2026-10-21T12:00:00-03:00</dhEvento><nProt>12345</nProt></resEvento>'
    $eventDoc=(ConvertFrom-GapResponse (Soap $event $target) $target $company $now).document
    Equal $eventDoc.kind 'resEvento' 'event_is_preserved'
    Equal (Get-GapDocumentDisposition $eventDoc @() $now) 'PENDING_DATE' 'event_date_not_inferred'
    Equal (Get-GapDocumentDisposition $eventDoc @($summaryDoc) $now) 'READY' 'event_uses_real_invoice_emission'
    $old=(ConvertFrom-GapResponse (Soap (Xml $target '12345678000195' $company '2026-07-01T12:00:00-03:00') $target) $target $company $now).document
    Equal (Get-GapDocumentDisposition $old @() $now) 'OUTSIDE_90_DAYS' 'old_invoice_kept_out_of_import'
    $eventData=Join-Path $root 'event-data'
    Write-AtomicJson (Join-Path $eventData ('staged/'+$eventDoc.id+'.json')) $eventDoc
    $null=Publish-GapOutbox -DataRoot $eventData -KnownDocuments @() -Now $now
    Equal @(Get-PendingDocuments $eventData 10 1500000).Count 0 'persisted_event_waits_for_invoice_date'
    Write-AtomicJson (Join-Path $eventData ('staged/'+$summaryDoc.id+'.json')) $summaryDoc
    $null=Publish-GapOutbox -DataRoot $eventData -KnownDocuments @() -Now $now
    Equal @(Get-PendingDocuments $eventData 10 1500000).Count 2 'persisted_summary_releases_event_without_fabrication'
    $data=Join-Path $root 'data';Write-AtomicJson (Join-Path $data 'queue.json') $plan
    $pointPath=Join-Path $data 'point-ledger.json'
    $emptyLedger=[ordered]@{version=1;attempts=@();holds=@();events=@()};Write-AtomicJson $pointPath $emptyLedger
    $beforeCursor=$live.lastNsu
    $reserved=Reserve-GapRequest -DataRoot $data -PointLedgerPath $pointPath -TargetNsu $target -LiveState $live -Now $now
    Equal (Read-GapJson $pointPath).attempts[0].status 'REQUEST_RESERVED' 'durable_reservation_before_network'
    Equal (Read-GapJson (Join-Path $data 'global-cooldown.json')).reason 'REQUEST_RESERVED' 'shared_hold_before_network'
    Equal (Get-GapGovernorNextAllowed (Read-GapJson $pointPath) $live $now).allowed $false 'reserved_unknown_holds65'
    $null=Save-GapResponse -DataRoot $data -PointLedgerPath $pointPath -AttemptId $reserved.id -TargetNsu $target -Soap (Soap $body $target) -CompanyCnpj $company -Now $now -LiveState $live
    Equal @((Read-GapJson (Join-Path $data 'queue.json')).targets|Where-Object{$_.nsu -eq $target})[0].status 'RECOVERED' 'accepted_target_recorded'
    Throws {Reserve-GapRequest -DataRoot $data -PointLedgerPath $pointPath -TargetNsu $target -LiveState $live -Now $now} 'GAP_TARGET_ALREADY_ATTEMPTED' 'accepted_attempt_not_repeated'
    $null=Publish-GapOutbox -DataRoot $data -KnownDocuments $known -Now $now
    Equal @(Get-PendingDocuments $data 10 16000000).Count 1 'recovered_xml_staged_to_outbox'
    $failedSend={param($documents) [pscustomobject]@{source='SEFAZ';acknowledgedIds=@('wrong-id');runId='TESTFAIL'}}
    Throws {Send-GapOutbox -DataRoot $data -SendBatch $failedSend} 'GAP_RECEIPT' 'receipt_failure_never_acks'
    Equal @(Get-PendingDocuments $data 10 16000000).Count 1 'failed_receipt_outbox_retained'
    $pointHash=(Get-FileHash -LiteralPath $pointPath).Hash
    $send={param($documents) [pscustomobject]@{source='SEFAZ';acknowledgedIds=@($documents|ForEach-Object{$_.id});runId='TESTOK'}}
    Equal (Send-GapOutbox -DataRoot $data -SendBatch $send).acknowledged 1 'transport_replay_succeeds'
    Equal @(Get-PendingDocuments $data 10 16000000).Count 0 'ack_archives_outbox'
    Equal (Get-FileHash -LiteralPath $pointPath).Hash $pointHash 'transport_replay_no_fiscal_attempt'
    Equal $live.lastNsu $beforeCursor 'live_cursor_unchanged'
    $second='000000000001254'
    $res=Reserve-GapRequest $data $pointPath $second $live $now
    $null=Save-GapResponse $data $pointPath $res.id $second '<retDistDFeInt><cStat>137</cStat></retDistDFeInt>' $company $now $live
    $saved=Read-GapJson (Join-Path $data 'queue.json')
    Equal @($saved.targets|Where-Object{$_.nsu -eq $second})[0].status 'EMPTY' 'point137_only_target_empty'
    Equal @($saved.targets|Where-Object{$_.status -eq 'PENDING'}).Count 81 'point137_does_not_exhaust_queue'
    Equal @(Get-ChildItem -LiteralPath (Join-Path $data 'raw') -Filter '*.xml').Count 2 'all_responses_preserved'
    $third='000000000001255';$res=Reserve-GapRequest $data $pointPath $third $live $now
    $null=Save-GapResponse $data $pointPath $res.id $third '<retDistDFeInt><cStat>656</cStat></retDistDFeInt>' $company $now $live
    Equal (Read-GapJson (Join-Path $data 'global-cooldown.json')).reason 'SEFAZ_656' '656_global_hold'
    Equal (Get-GapGovernorNextAllowed (Read-GapJson $pointPath) $live $now).allowed $false '656_stops_further_queries'
    Equal (Reset-GapRetryableTargets $data $pointPath $now) 0 '656_cannot_retry_immediately'
    $later=$now.AddMinutes(66)
    Equal (Reset-GapRetryableTargets $data $pointPath $later) 1 '656_retry_after_65_minutes'
    Equal @((Read-GapJson $pointPath).events|Where-Object{$_.type -ceq 'RETRY_AFTER_656'}).Count 1 '656_retry_audited'
    $retry=Reserve-GapRequest $data $pointPath $third $live $later
    Equal ($retry.id -cne $res.id) $true '656_retry_has_new_reservation'
    Equal @((Read-GapJson $pointPath).attempts|Where-Object{$_.target -ceq $third}).Count 2 '656_both_attempts_counted'
    $repairData=Join-Path $root 'repair-data';Write-AtomicJson (Join-Path $repairData 'point-ledger.json') $held
    $repairHash=(Get-FileHash -LiteralPath (Join-Path $repairData 'point-ledger.json')).Hash
    Equal (Initialize-GapRecoveryFiles $repairData $held $known $company $now).queueRepaired $true 'safe_init_queue_repair_without_fiscal_attempts'
    Equal (Get-FileHash -LiteralPath (Join-Path $repairData 'point-ledger.json')).Hash $repairHash 'init_repair_preserves_point_ledger'
    $badRepair=Join-Path $root 'bad-repair';$used=Read-GapJson $pointPath;$used.events=@($held.events);Write-AtomicJson (Join-Path $badRepair 'point-ledger.json') $used
    Throws {Initialize-GapRecoveryFiles $badRepair $held $known $company $now} 'GAP_INITIALIZATION_INCOMPLETE' 'init_never_reconstructs_after_fiscal_attempt'
    Write-AtomicJson (Join-Path $repairData 'global-cooldown.json') @{version=2;reason='NONE';nextAllowedAt='2026-10-29T10:45:00.000000Z';updatedAt='2026-10-29T10:45:00.000000Z'}
    Throws {Read-GapSharedCooldown $repairData} 'GAP_SHARED_INVALID' 'malformed_global_state_fails_closed'
    Equal (Test-GapScheduleWindow ([DateTimeOffset]::Parse('2026-10-29T11:55:00Z'))) $true 'schedule_guard_five_minutes_before'
    Equal (Test-GapScheduleWindow ([DateTimeOffset]::Parse('2026-10-29T12:05:00Z'))) $true 'schedule_guard_five_minutes_after'
    Equal (Test-GapScheduleWindow ([DateTimeOffset]::Parse('2026-10-29T12:06:00Z'))) $false 'schedule_guard_releases_after_window'
    $changedLive=[pscustomobject]@{lastNsu='000000000001388';status='137';nextAllowedAt=$later.AddMinutes(66).ToString('o')}
    Equal (Get-GapGovernorNextAllowed (Read-GapJson $pointPath) $changedLive $later).reason 'LIVE_DISTRIBUTION_COOLDOWN' 'normal_state_change_after_transport_revalidated'
    Equal ($null -ne (Get-Command Extend-GapRecoveryQueue -ErrorAction SilentlyContinue)) $true 'explicit_suffix_migration_exists'
    $extensionRoot=Join-Path $root 'extension';$extData=Join-Path $extensionRoot 'SefazGapRecovery';$extLive=Join-Path $extensionRoot 'SefazLive'
    $extStores=@('SefazLive','SefazKeyRecovery','SefazKeyRecoveryBatch2','SefazGapRecovery'|ForEach-Object{Join-Path $extensionRoot $_})
    foreach($store in $extStores){[IO.Directory]::CreateDirectory($store)|Out-Null}
    $extConfig=Join-Path $extensionRoot 'config.json';Write-AtomicJson $extConfig @{companyCnpj=$company;environment='1'}
    $extQueue=New-GapRecoveryPlan $known $company $now;$extQueue.targets[0].status='RECOVERED';$extQueue.targets[0].attemptId='KEEP_ATTEMPT';$extQueue.targets[0].documentId='KEEP_DOCUMENT'
    $extQueuePath=Join-Path $extData 'queue.json';Write-AtomicJson $extQueuePath $extQueue
    $extLedgerPath=Join-Path $extData 'point-ledger.json';$extLedger=[pscustomobject]@{version=1;attempts=@();holds=@();events=@($held.events)};Write-AtomicJson $extLedgerPath $extLedger
    $extState=Join-Path $extLive '38626750000146-1/state.json';Write-AtomicJson $extState @{status='137';lastNsu='000000000001387';maxNsu='000000000001387';nextAllowedAt=$now.AddHours(-1).ToString('o')}
    $rawPath=Join-Path $extLive '38626750000146-1/raw/boundary.xml';[IO.Directory]::CreateDirectory((Split-Path $rawPath -Parent))|Out-Null
    [IO.File]::WriteAllText($rawPath,'<retDistDFeInt><tpAmb>1</tpAmb><cStat>137</cStat><ultNSU>000000000001387</ultNSU><maxNSU>000000000001387</maxNSU></retDistDFeInt>')
    foreach($doc in $known){Write-AtomicJson (Join-Path $extStores[1] ('archive/'+$doc.id+'.json')) $doc}
    $proof=[pscustomobject]@{status='VERIFIED';capturedAt=$now.ToString('o');fiscalCalls=0;companyCnpj=$company;environment='1';config=@{path=$extConfig;sha256=(Get-FileHash -LiteralPath $extConfig).Hash};boundary=@{path=$rawPath;sha256=(Get-FileHash -LiteralPath $rawPath).Hash;status='137';environment='1';lastNsu='000000000001387';maxNsu='000000000001387';companyContext=$company};stores=$extStores;inventory=@(Get-GapFiscalInventory $extStores);presentNsus=@($known|ForEach-Object{$_.nsu}|Sort-Object);attemptedNsus=@();fromInclusive='000000000001340';throughInclusive='000000000001387';excludedNsus=@();targets=@(1340..1387|ForEach-Object{$_.ToString('000000000000000')});queue=@{path=$extQueuePath;sha256=(Get-FileHash -LiteralPath $extQueuePath).Hash};pointLedger=@{path=$extLedgerPath;sha256=(Get-FileHash -LiteralPath $extLedgerPath).Hash};whole90DaysRecovered=$false}
    $proofPath=Join-Path $extensionRoot 'proof.json';Write-AtomicJson $proofPath $proof;$proofHash=(Get-FileHash -LiteralPath $proofPath).Hash
    Throws {Extend-GapRecoveryQueue $extData $extLive $extConfig $proofPath ('A'*64) $now} 'GAP_EXTENSION_PIN_MISMATCH' 'migration_proof_hash_required'
    $late=Join-Path $extLive '38626750000146-1/raw/late.xml';[IO.File]::WriteAllText($late,'<late/>')
    Throws {Extend-GapRecoveryQueue $extData $extLive $extConfig $proofPath $proofHash $now} 'GAP_EXTENSION_INVENTORY_CHANGED' 'late_fiscal_file_blocks_extension'
    [IO.File]::Delete($late)
    [IO.Directory]::CreateDirectory((Join-Path $extensionRoot 'Sefaz'))|Out-Null
    Throws {Extend-GapRecoveryQueue $extData $extLive $extConfig $proofPath $proofHash $now} 'GAP_EXTENSION_STORES_CHANGED' 'new_old_store_blocks_extension'
    [IO.Directory]::Delete((Join-Path $extensionRoot 'Sefaz'))
    $outsideRaw=Join-Path $extLive '38626750000146-1/rawOTHER/boundary.xml';[IO.Directory]::CreateDirectory((Split-Path $outsideRaw -Parent))|Out-Null;[IO.File]::WriteAllBytes($outsideRaw,[IO.File]::ReadAllBytes($rawPath))
    $badProof=Read-GapJson $proofPath;$badProof.boundary.path=$outsideRaw;$badProofPath=Join-Path $extensionRoot 'out-of-context-proof.json';Write-AtomicJson $badProofPath $badProof
    Throws {Extend-GapRecoveryQueue $extData $extLive $extConfig $badProofPath (Get-FileHash -LiteralPath $badProofPath).Hash $now} 'GAP_EXTENSION_BOUNDARY_CONTEXT' 'boundary_must_be_inside_exact_company_raw_directory'
    $badProof=Read-GapJson $proofPath;$badProof.excludedNsus=@('000000000001345');$badProof.targets=@($badProof.targets|Where-Object{$_ -cne '000000000001345'});Write-AtomicJson $badProofPath $badProof
    Throws {Extend-GapRecoveryQueue $extData $extLive $extConfig $badProofPath (Get-FileHash -LiteralPath $badProofPath).Hash $now} 'GAP_EXTENSION_PARTITION_INVALID' 'suffix_exclusions_require_actual_inventory_evidence'
    $ledgerBefore=(Get-FileHash -LiteralPath $extLedgerPath).Hash
    $migration=Extend-GapRecoveryQueue $extData $extLive $extConfig $proofPath $proofHash $now
    Equal $migration.targets 131 'finite_suffix_adds_48_targets'
    Equal (Get-FileHash -LiteralPath $extLedgerPath).Hash $ledgerBefore 'migration_never_changes_point_governor'
    $v2=Read-GapJson $extQueuePath
    Equal $v2.targets[0].attemptId 'KEEP_ATTEMPT' 'migration_preserves_prior_attempt_id'
    Equal $v2.targets[0].documentId 'KEEP_DOCUMENT' 'migration_preserves_prior_document_id'
    Equal $v2.targets[0].status 'RECOVERED' 'migration_preserves_prior_status'
    Equal (Get-FileHash -LiteralPath $v2.migration.snapshotPath).Hash $proof.queue.sha256 'migration_snapshot_is_byte_exact'
    Equal (Assert-GapQueueScope $v2) $true 'v2_scope_validated_from_pinned_evidence'
    Equal (Extend-GapRecoveryQueue $extData $extLive $extConfig $proofPath $proofHash $now).status 'ALREADY_EXTENDED' 'migration_idempotent_without_rechecking_mutable_inventory'
    $newTarget='000000000001340';$future=$now.AddMinutes(66)
    $reservation=Reserve-GapRequest $extData $extLedgerPath $newTarget $live $future
    $null=Save-GapResponse $extData $extLedgerPath $reservation.id $newTarget (Soap (Xml $newTarget) $newTarget) $company $future $live
    Equal (Assert-GapQueueScope (Read-GapJson $extQueuePath)) $true 'v2_statuses_legitimately_evolve'
    Equal (Initialize-GapRecoveryFiles $extData $extLedger $known $company $future).initialized $false 'v2_initialize_preserves_new_attempt_history'
    $v2=Read-GapJson $extQueuePath;$v2.targets[1].status='RECOVERED';$v2.targets[1].attemptId='NEXT_LEGITIMATE';$v2.targets[1].documentId='NEXT_XML'
    Equal (Assert-GapQueueScope $v2) $true 'original_prefix_status_can_advance_after_migration'
    $v2.targets[-1].nsu='000000000001388'
    Throws {Assert-GapQueueScope $v2} 'GAP_QUEUE_SCOPE_CHANGED' 'suffix_never_exceeds_verified_boundary'
    $septDoc=ConvertFrom-FiscalXml (Xml $target '12345678000195' $company '2026-09-30T23:30:00-03:00') $target $company
    $octDoc=ConvertFrom-FiscalXml (Xml $target '12345678000195' $company '2026-10-01T00:01:00-03:00') $target $company
    Equal (Get-GapDocumentDisposition $septDoc @() $now '2026-10-01') 'BEFORE_SCOPE' 'scope_compares_original_fiscal_calendar_date_not_utc_day'
    Equal (Get-GapDocumentDisposition $octDoc @() $now '2026-10-01') 'READY' 'scope_includes_october_first'
    $scopeTokens=$null;$scopeErrors=$null
    $launcherAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../scripts/Invoke-GapRecovery.ps1'),[ref]$scopeTokens,[ref]$scopeErrors)
    $scopeAssignment=$launcherAst.Find({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left -is [Management.Automation.Language.VariableExpressionAst] -and $node.Left.VariablePath.UserPath -ceq 'minimumIssueDate'},$true)
    $cfg=[pscustomobject]@{companyCnpj=$company;environment='1';minimumIssueDate='2026-10-01'}
    $configuredScope=& ([scriptblock]::Create($scopeAssignment.Right.Extent.Text))
    Equal $configuredScope '2026-10-01' 'launcher_reads_shared_real_configuration_minimumIssueDate'
    Equal (Get-GapDocumentDisposition $eventDoc @() $now '2026-10-01') 'PENDING_DATE' 'scoped_unknown_event_never_imports'
    $scopeData=Join-Path $root 'scope-data';$oldPath=Join-Path $scopeData ('outbox/'+$septDoc.id+'.json');Write-AtomicJson $oldPath $septDoc
    $oldHash=(Get-FileHash -LiteralPath $oldPath).Hash
    $neverSend={param($docs) throw 'TEST_OLD_DOC_MUST_NEVER_REACH_TRANSPORT'}
    Equal (Send-GapOutbox -DataRoot $scopeData -SendBatch $neverSend -MinimumIssueDate '2026-10-01' -Now $now).acknowledged 0 'preexisting_old_outbox_blocked_before_flow'
    $excludedPath=Join-Path $scopeData ('scope-excluded/'+$septDoc.id+'.json')
    Equal (Get-FileHash -LiteralPath $excludedPath).Hash $oldHash 'scope_exclusion_preserves_bytes_without_ack'
    Equal ([IO.Directory]::Exists((Join-Path $scopeData 'archive'))) $false 'excluded_document_has_no_ack_archive'
    $scopeBatches=[Collections.Generic.List[object]]::new()
    $scopeSend={param($docs) [void]$scopeBatches.Add(@($docs|ForEach-Object{$_.id}));[pscustomobject]@{source='SEFAZ';acknowledgedIds=@($docs|ForEach-Object{$_.id});runId=('SCOPE'+$scopeBatches.Count)}}.GetNewClosure()
    Write-AtomicJson (Join-Path $scopeData ('outbox/'+$octDoc.id+'.json')) $octDoc
    Equal (Send-GapOutbox -DataRoot $scopeData -SendBatch $scopeSend -MinimumIssueDate '2026-10-01' -Now $now).acknowledged 1 'october_document_delivered_after_older_document_excluded'
    Copy-Item -LiteralPath $excludedPath -Destination $oldPath
    Equal (Send-GapOutbox -DataRoot $scopeData -SendBatch $scopeSend -MinimumIssueDate '2026-10-01' -Now $now).acknowledged 0 'old_outbox_retry_cannot_import'
    Equal $scopeBatches.Count 1 'old_retry_does_not_call_transport'
    $eventScope=Join-Path $root 'scope-event';$eventPath=Join-Path $eventScope ('outbox/'+$eventDoc.id+'.json');Write-AtomicJson $eventPath $eventDoc
    $eventHash=(Get-FileHash -LiteralPath $eventPath).Hash
    Equal (Send-GapOutbox -DataRoot $eventScope -SendBatch $neverSend -MinimumIssueDate '2026-10-01' -Now $now).acknowledged 0 'unknown_event_deferred_before_transport'
    Equal (Get-FileHash -LiteralPath (Join-Path $eventScope ('scope-pending-date/'+$eventDoc.id+'.json'))).Hash $eventHash 'pending_date_preserves_original_bytes'
    Equal (Send-GapOutbox -DataRoot $eventScope -SendBatch $scopeSend -Evidence @($octDoc) -MinimumIssueDate '2026-10-01' -Now $now).acknowledged 1 'event_released_only_after_actual_october_date_evidence'
    $currentQueue=Read-GapJson $extQueuePath;$descending=@(Get-GapPendingTargets $currentQueue)
    Equal $descending[0].nsu '000000000001387' 'newest_nsu_has_priority'
    Equal $descending.Count @($currentQueue.targets|Where-Object{$_.status -ceq 'PENDING'}).Count 'priority_does_not_infer_or_discard_unknown_invoice_dates'
    $twentyRoot=Join-Path $root 'twenty-eligible'
    foreach($n in 2001..2020){$nsu=$n.ToString('000000000000000');$doc=ConvertFrom-FiscalXml (Xml $nsu) $nsu $company;Write-AtomicJson (Join-Path $twentyRoot ('outbox/'+$doc.id+'.json')) $doc}
    $twentyBatches=[Collections.Generic.List[object]]::new()
    $twentySend={param($docs) [void]$twentyBatches.Add(@($docs|ForEach-Object{$_.id}));[pscustomobject]@{source='SEFAZ';acknowledgedIds=@($docs|ForEach-Object{$_.id});runId=('TWENTY'+$twentyBatches.Count)}}.GetNewClosure()
    $twenty=Send-GapOutbox -DataRoot $twentyRoot -SendBatch $twentySend -MinimumIssueDate '2026-10-01' -Now $now
    Equal $twenty.acknowledged 20 'all_twenty_eligible_documents_acknowledged'
    Equal $twentyBatches.Count 2 'twenty_documents_use_two_batches'
    Equal @($twentyBatches[0]).Count 10 'first_batch_ten'
    Equal @($twentyBatches[1]).Count 10 'second_batch_ten'
    Equal @($twentyBatches|ForEach-Object{$_}|Select-Object -Unique).Count 20 'each_document_delivered_once'
    Equal (Send-GapOutbox -DataRoot $twentyRoot -SendBatch $twentySend -MinimumIssueDate '2026-10-01' -Now $now).acknowledged 0 'successful_twenty_document_replay_does_not_resend'
    Equal $twentyBatches.Count 2 'replay_has_no_extra_transport_calls'
    [ordered]@{status='PASS';checks=$script:checks;fiscalCalls=0;flowCalls=0}|ConvertTo-Json -Compress
}finally{
    $resolved=[IO.Path]::GetFullPath($root);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
    if(-not $resolved.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'sefaz-gap-test-*'){throw 'GAP_TEST_CLEANUP_PATH'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
