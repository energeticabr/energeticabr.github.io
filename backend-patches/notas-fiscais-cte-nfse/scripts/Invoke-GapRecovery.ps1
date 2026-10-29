[CmdletBinding()]
param(
    [ValidateSet('Inspect','Initialize','Extend','Collect','Deliver')][string]$Command='Inspect',
    [string]$ConfigPath=(Join-Path $PSScriptRoot '../config/energetica.json'),
    [string]$WorkerConfigPath=(Join-Path $PSScriptRoot '../config/worker.json'),
    [string]$DataRoot=(Join-Path $env:LOCALAPPDATA 'Energetica/SefazGapRecovery'),
    [string]$LiveDataRoot=(Join-Path $env:LOCALAPPDATA 'Energetica/SefazLive'),
    [string[]]$ArchivePaths=@((Join-Path $env:LOCALAPPDATA 'Energetica/SefazKeyRecovery/archive'),(Join-Path $env:LOCALAPPDATA 'Energetica/SefazKeyRecoveryBatch2/archive')),
    [string]$PriorSourcesPath,
    [string]$ExtensionProofPath,
    [string]$ExtensionProofSha256,
    [ValidateRange(1,18)][int]$MaxPointRequests=18,
    [switch]$GlobalCoordinationReady
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$locks=[Collections.Generic.List[IDisposable]]::new();$stage='CONFIG';$requests=0;$acknowledged=0;$attempt=$null;$result=$null;$exitCode=0
$normalLocks=[Collections.Generic.List[IDisposable]]::new();$normalPaths=@();$liveHash=$null
$pointPath=Join-Path $DataRoot 'point-ledger.json';$queuePath=Join-Path $DataRoot 'queue.json';$statePath=$null;$live=$null
function Lock-GapNormal {
    try{
        foreach($path in $script:normalPaths){$script:normalLocks.Add([IO.FileStream]::new($path,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None))}
        $script:liveHash=(Get-FileHash -LiteralPath $script:statePath -Algorithm SHA256).Hash
        $script:live=Read-GapJson $script:statePath
    }catch{foreach($handle in $script:normalLocks){$handle.Dispose()};$script:normalLocks.Clear();throw 'GAP_BUSY'}
}
function Unlock-GapNormal {
    try{if($script:normalLocks.Count -and (Get-FileHash -LiteralPath $script:statePath -Algorithm SHA256).Hash -cne $script:liveHash){throw 'GAP_LIVE_STATE_CHANGED'}}
    finally{foreach($handle in $script:normalLocks){$handle.Dispose()};$script:normalLocks.Clear()}
}
try{
    # FlowTransport's existing imports happen before loading our parsing module.
    if($Command -in @('Collect','Deliver')){Import-Module (Join-Path $PSScriptRoot '../src/FlowTransport.psm1') -DisableNameChecking}
    Import-Module (Join-Path $PSScriptRoot '../src/Sefaz.psm1') -DisableNameChecking
    Import-Module (Join-Path $PSScriptRoot '../src/GapRecovery.psm1') -DisableNameChecking
    $cfg=Read-GapJson $ConfigPath
    $minimumIssueDate=if($cfg.PSObject.Properties['minimumIssueDate']){[string]$cfg.minimumIssueDate}else{''}
    if($cfg.companyCnpj -cne '38626750000146' -or [string]$cfg.environment -cne '1'){throw 'GAP_CONFIG_INVALID'}
    if($Command -ceq 'Collect' -and -not $GlobalCoordinationReady){throw 'GAP_COORDINATION_NOT_READY'}
    $root=[IO.Path]::GetFullPath($DataRoot).TrimEnd('\','/');$liveRoot=[IO.Path]::GetFullPath($LiveDataRoot).TrimEnd('\','/')
    if($root.Equals($liveRoot,[StringComparison]::OrdinalIgnoreCase) -or $root.StartsWith($liveRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or $liveRoot.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'GAP_ROOTS_OVERLAP'}
    if([string]::IsNullOrWhiteSpace($PriorSourcesPath)){
        $sources=@(
            [pscustomobject]@{path=(Join-Path $env:LOCALAPPDATA 'Energetica/SefazKeyRecovery/recovery-ledger.json');sha256='83F023899025A7D711996324D3640C30640BEA167D8E127BE7E5998BDD9E45A9'},
            [pscustomobject]@{path=(Join-Path $env:LOCALAPPDATA 'Energetica/SefazKeyRecoveryBatch2/recovery-ledger.json');sha256='CC2F340513AACAD02AC1EBEDFDBB80F388DDB49A281298ECF9A751AE89A3C000'}
        )
    }else{$sources=@((Read-GapJson $PriorSourcesPath).sources)}
    if($sources.Count -ne 2){throw 'GAP_TWO_PRIOR_SOURCES_REQUIRED'}
    foreach($source in $sources){
        $priorRoot=[IO.Path]::GetFullPath((Split-Path $source.path -Parent)).TrimEnd('\','/')
        if($root.Equals($priorRoot,[StringComparison]::OrdinalIgnoreCase) -or $root.StartsWith($priorRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or $priorRoot.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'GAP_PRIOR_ROOT_OVERLAP'}
        $locks.Add([IO.FileStream]::new($source.path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read))
    }
    $stage='LIVE_LOCKS';$companyPath=Join-Path $LiveDataRoot ($cfg.companyCnpj+'-1');$statePath=Join-Path $companyPath 'state.json'
    # Normal worker and collector locks are first, in the normal worker's order.
    # This also makes Inspect/Initialize a consistent native snapshot.
    $normalPaths=@((Join-Path $LiveDataRoot 'worker.lock'),(Join-Path $companyPath 'collector.lock'));Lock-GapNormal
    $now=[DateTimeOffset]::UtcNow;$seed=New-GapPointLedger $sources $now
    $paths=@($ArchivePaths)
    foreach($optional in @((Join-Path $companyPath 'archive'),(Join-Path $DataRoot 'archive'))){if([IO.Directory]::Exists($optional)){$paths+=@($optional)}}
    $known=@(Get-GapArchivedDocuments $paths $cfg.companyCnpj)
    $shared=Read-GapSharedCooldown $DataRoot
    if($Command -ceq 'Inspect'){
        $plan=if([IO.File]::Exists($queuePath)){Read-GapJson $queuePath}else{New-GapRecoveryPlan $known $cfg.companyCnpj $now}
        $null=Assert-GapQueueScope $plan
        $ledger=if([IO.File]::Exists($pointPath)){Read-GapJson $pointPath}else{$seed}
        $governor=Get-GapGovernorNextAllowed $ledger $live $now
        $result=[ordered]@{status='INSPECT';persisted=([IO.File]::Exists($queuePath));scope=$plan.scope;targets=@($plan.targets).Count;pending=@($plan.targets|Where-Object{$_.status -ceq 'PENDING'}).Count;governor=$governor;whole90DaysRecovered=$false;fiscalCalls=0}
    }else{
        $stage='GAP_LOCKS';[IO.Directory]::CreateDirectory($DataRoot)|Out-Null
        foreach($name in @('worker.lock','collector.lock')){
            try{$locks.Add([IO.FileStream]::new((Join-Path $DataRoot $name),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None))}catch{throw 'GAP_BUSY'}
        }
        if($Command -ceq 'Extend'){
            $stage='EXTEND_FINITE_SUFFIX'
            $result=Extend-GapRecoveryQueue $DataRoot $LiveDataRoot $ConfigPath $ExtensionProofPath $ExtensionProofSha256 $now
        }else{
        $null=Initialize-GapRecoveryFiles $DataRoot $seed $known $cfg.companyCnpj $now
        $ledger=Read-GapJson $pointPath;$governor=Get-GapGovernorNextAllowed $ledger $live $now
        # A future non-budget cache hold with no matching authority is uncertain,
        # never silently reset by Initialize after an interrupted state update.
        if($null -ne $shared -and $shared.reason -cne 'POINT_RATE_LIMIT' -and [DateTimeOffset]::Parse([string]$shared.nextAllowedAt) -gt [DateTimeOffset]::Parse([string]$governor.nextAllowedAt)){
            $holdReason=if($shared.reason -in @('SEFAZ_656','REQUEST_RESERVED','REQUEST_UNCERTAIN','LIVE_DISTRIBUTION_COOLDOWN','UNVERIFIED_PRIOR_HOLD')){$shared.reason}else{'REQUEST_UNCERTAIN'}
            $ledger.holds=@($ledger.holds)+@([pscustomobject]@{reason=$holdReason;until=$shared.nextAllowedAt})
            Write-AtomicJson $pointPath $ledger;$governor=Get-GapGovernorNextAllowed $ledger $live $now
        }
        Write-GapSharedCooldown $DataRoot $governor $now
        if($Command -ceq 'Initialize'){
            $result=[ordered]@{status='INITIALIZED';targets=@((Read-GapJson $queuePath).targets).Count;governor=$governor;fiscalCalls=0;whole90DaysRecovered=$false}
        }else{
            $worker=Read-GapJson $WorkerConfigPath
            $send={param($documents) Send-SefazBatch -Documents $documents -FlowId $worker.flowId -EnvironmentId $worker.environmentId -NotificationRoot (Join-Path $LiveDataRoot 'notifications')}.GetNewClosure()
            # Normal distribution has priority while PDFs/Flow run. Its receiver
            # serializes runs and enforces unique CHAVE_ACESSO. Gap locks remain.
            Unlock-GapNormal
            $stage='REPLAY_OUTBOX';$null=Publish-GapOutbox $DataRoot $known ([DateTimeOffset]::UtcNow) $minimumIssueDate
            $delivery=Send-GapOutbox -DataRoot $DataRoot -SendBatch $send -Evidence $known -MinimumIssueDate $minimumIssueDate;$acknowledged+=$delivery.acknowledged
            if($Command -ceq 'Collect'){
                $stage='SCHEDULE_GUARD';$nearSchedule=Test-GapScheduleWindow ([DateTimeOffset]::UtcNow)
                if(-not $nearSchedule){
                    $stage='REACQUIRE_FISCAL_LOCKS';Lock-GapNormal
                    while($requests -lt $MaxPointRequests){
                        $stage='GOVERNOR';$now=[DateTimeOffset]::UtcNow
                        if(Test-GapScheduleWindow $now){break}
                        # Fresh actual distNSU state before EVERY point request, under both normal locks.
                        $live=Read-GapJson $statePath;$ledger=Read-GapJson $pointPath;$governor=Get-GapGovernorNextAllowed $ledger $live $now
                        Write-GapSharedCooldown $DataRoot $governor $now
                        if(-not $governor.allowed -or $governor.available -le 0){break}
                        $null=Reset-GapRetryableTargets $DataRoot $pointPath $now
                        $queue=Read-GapJson $queuePath;$pending=@(Get-GapPendingTargets $queue)
                        if(-not $pending.Count){break}
                        $target=[string]$pending[0].nsu
                        $stage='RESERVE';$attempt=Reserve-GapRequest $DataRoot $pointPath $target $live $now
                        $requests++;$stage='SEFAZ_POST';$response=Invoke-GapConsNsu $cfg $target $DataRoot
                        $stage='PRESERVE_RESPONSE';$saved=Save-GapResponse $DataRoot $pointPath $attempt.id $target $response $cfg.companyCnpj ([DateTimeOffset]::UtcNow) $live
                        $attempt=$null;if($saved.status -ceq '656'){break}
                    }
                    Unlock-GapNormal
                }
            }
            $stage='PUBLISH_STAGED';$null=Publish-GapOutbox $DataRoot $known ([DateTimeOffset]::UtcNow) $minimumIssueDate
            $stage='DELIVER_STAGED';$delivery=Send-GapOutbox -DataRoot $DataRoot -SendBatch $send -Evidence $known -MinimumIssueDate $minimumIssueDate;$acknowledged+=$delivery.acknowledged
            $queue=Read-GapJson $queuePath;$governor=Get-GapGovernorNextAllowed (Read-GapJson $pointPath) (Read-GapJson $statePath) ([DateTimeOffset]::UtcNow)
            Write-GapSharedCooldown $DataRoot $governor ([DateTimeOffset]::UtcNow)
            $result=[ordered]@{status='PROCESSED';command=$Command;requests=$requests;acknowledged=$acknowledged;pending=@($queue.targets|Where-Object{$_.status -ceq 'PENDING'}).Count;empty=@($queue.targets|Where-Object{$_.status -ceq 'EMPTY'}).Count;recovered=@($queue.targets|Where-Object{$_.status -ceq 'RECOVERED'}).Count;governor=$governor;whole90DaysRecovered=$false}
        }
        }
    }
    if($normalLocks.Count){Unlock-GapNormal}
}catch{
    $failedStage=$stage;$code='GAP_FAILURE';if($_.Exception.Message -cmatch '^GAP_[A-Z_]+$'){$code=$_.Exception.Message}
    if($null -ne $attempt -and $null -ne $live){
        try{
            $queue=Read-GapJson $queuePath;$target=@($queue.targets|Where-Object{$_.attemptId -ceq $attempt.id})[0];$target.status='UNCERTAIN';Write-AtomicJson $queuePath $queue
            $null=Complete-GapAttempt $DataRoot $pointPath $attempt.id 'REQUEST_UNCERTAIN' $live ([DateTimeOffset]::UtcNow)
        }catch{}
    }
    $result=[ordered]@{status=if($code -ceq 'GAP_BUSY'){'BUSY'}else{'ERROR'};code=$code;stage=$failedStage;requests=$requests;acknowledged=$acknowledged;whole90DaysRecovered=$false};$exitCode=if($code -ceq 'GAP_BUSY'){0}else{1}
}finally{foreach($handle in $normalLocks){$handle.Dispose()};foreach($handle in $locks){$handle.Dispose()}}
$result|ConvertTo-Json -Depth 12 -Compress
exit $exitCode
