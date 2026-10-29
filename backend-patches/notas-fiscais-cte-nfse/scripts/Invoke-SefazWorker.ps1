[CmdletBinding()]
param(
    [string]$WorkerConfigPath=(Join-Path $PSScriptRoot '../config/worker.json'),
    [string]$CollectorConfigPath=(Join-Path $PSScriptRoot '../config/energetica.json'),
    [string]$DataRoot=(Join-Path $env:LOCALAPPDATA 'Energetica/Sefaz'),
    [ValidateRange(1,200)][int]$MaxBatches=200,
    [ValidateRange(1,120)][int]$MaxMinutes=120
)

function ConvertFrom-SefazWorkerJson([string]$Text){
    # PowerShell 7.5 otherwise converts ISO values to DateTime, whose implicit
    # string conversion can conflict with the Portuguese parsing culture.
    if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){
        return ($Text|ConvertFrom-Json -DateKind String -ErrorAction Stop)
    }
    return ($Text|ConvertFrom-Json -ErrorAction Stop)
}

function ConvertTo-SefazNativeArguments([string[]]$Values){
    $quoted=foreach($value in $Values){
        $builder=New-Object Text.StringBuilder
        [void]$builder.Append('"');$slashes=0
        foreach($character in $value.ToCharArray()){
            if($character -eq '\'){$slashes++;continue}
            if($character -eq '"'){
                [void]$builder.Append(('\' * (2*$slashes+1)));[void]$builder.Append('"')
            }else{
                if($slashes){[void]$builder.Append(('\' * $slashes))}
                [void]$builder.Append($character)
            }
            $slashes=0
        }
        if($slashes){[void]$builder.Append(('\' * (2*$slashes)))}
        [void]$builder.Append('"');$builder.ToString()
    }
    return ($quoted -join ' ')
}

function Invoke-SefazNativeJsonProcess([string]$Executable,[string[]]$Arguments,[int]$TimeoutSeconds=180,[int]$MaxOutputChars=32000000){
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=$Executable
    $info.Arguments=ConvertTo-SefazNativeArguments $Arguments
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true
    $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $info.StandardOutputEncoding=New-Object Text.UTF8Encoding($false)
    $info.StandardErrorEncoding=New-Object Text.UTF8Encoding($false)
    $process=New-Object Diagnostics.Process
    $process.StartInfo=$info
    try{
        if(-not $process.Start()){throw 'WORKER_PROCESS_START'}
        $outputTask=$process.StandardOutput.ReadToEndAsync()
        $errorTask=$process.StandardError.ReadToEndAsync()
        if(-not $process.WaitForExit($TimeoutSeconds*1000)){
            try{$process.Kill()}catch{}
            throw 'WORKER_PROCESS_TIMEOUT'
        }
        $stdout=$outputTask.GetAwaiter().GetResult()
        $null=$errorTask.GetAwaiter().GetResult()
        if($process.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($stdout) -or $stdout.Length -gt $MaxOutputChars){
            $failure=New-Object InvalidOperationException('WORKER_PROCESS_FAILED')
            $failure.Data['ProcessExitCode']=[int]$process.ExitCode
            throw $failure
        }
        try{return (ConvertFrom-SefazWorkerJson $stdout)}catch{throw 'WORKER_PROCESS_JSON'}
    }finally{$process.Dispose()}
}

function ConvertTo-SefazQueueTimestamp([string]$NextAt){
    # Python3.9 rejects .NET round-trip timestamps containing seven fractional
    # digits. The queue protocol uses UTC and microsecond precision (six).
    return [DateTimeOffset]::Parse($NextAt).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'",[Globalization.CultureInfo]::InvariantCulture)
}

function Invoke-SefazQueueCommand($Config,[string]$Action,[int]$Id=0,[string]$NextAt,[string]$ErrorCode){
    if($Action -notin @('queue-next','queue-renew','queue-complete','queue-defer')){throw 'WORKER_QUEUE_ACTION'}
    # ssh.exe necessarily uses the server's command interpreter. Every remote
    # word is either fixed, an integer, an ISO timestamp or a restricted path.
    if($Config.remotePython -notmatch '^/[A-Za-z0-9_./-]+$' -or $Config.remoteBridge -notmatch '^/[A-Za-z0-9_./-]+$') {throw 'WORKER_REMOTE_PATH'}
    if($Config.sshHost -notmatch '^[A-Za-z_][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9.-]*$'){throw 'WORKER_SSH_HOST'}
    $remote='sudo -n '+$Config.remotePython+' '+$Config.remoteBridge+' '+$Action
    if($Action -ne 'queue-next'){
        if($Id -le 0){throw 'WORKER_QUEUE_ID'}
        $remote+=' --id '+$Id.ToString([Globalization.CultureInfo]::InvariantCulture)
    }
    if($Action -eq 'queue-defer'){
        if($ErrorCode -notin @('WORKER_RETRY','WORKER_COOLDOWN','WORKER_LIMIT','WORKER_STATE')){throw 'WORKER_ERROR_CODE'}
        $at=ConvertTo-SefazQueueTimestamp $NextAt
        if($at -notmatch '^[0-9T:+.Z-]+$'){throw 'WORKER_NEXT_AT'}
        $remote+=' --next-at '+$at+' --error '+$ErrorCode
    }
    $ssh=(Get-Command ssh.exe -ErrorAction Stop).Source
    return Invoke-SefazNativeJsonProcess $ssh @('-T','-o','BatchMode=yes','-o','ConnectTimeout=20','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2','-i',[string]$Config.sshKeyPath,[string]$Config.sshHost,$remote) 90 65536
}

function Get-SefazCollectorEncodedCommand([string]$Collector,[string]$Command,[string[]]$Ids,[string]$ConfigPath,[string]$DataPath){
    if($Command -notin @('Collect','Acknowledge')){throw 'WORKER_COLLECTOR_ACTION'}
    $collectorArguments=@('-Command',$Command,'-ConfigPath',$ConfigPath,'-DataRoot',$DataPath)
    if($Command -eq 'Acknowledge'){
        $payload=@{ids=@($Ids)}|ConvertTo-Json -Compress
        $collectorArguments+=@('-PayloadBase64',[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload)))
    }
    # Windows PowerShell 5.1 otherwise writes redirected Unicode using the
    # console code page. All values are single-quoted literals, never code.
    $parts=for($i=0;$i -lt $collectorArguments.Count;$i+=2){
        $collectorArguments[$i]+" '"+([string]$collectorArguments[$i+1]).Replace("'","''")+"'"
    }
    $invocation="[Console]::OutputEncoding=New-Object Text.UTF8Encoding(`$false);`$OutputEncoding=[Console]::OutputEncoding; & '"+$Collector.Replace("'","''")+"' "+($parts -join ' ')
    return [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($invocation))
}

function Invoke-SefazLocalCollector([string]$Command,[string[]]$Ids,[string]$ConfigPath,[string]$DataPath){
    $exe=Join-Path $PSHOME 'pwsh.exe'
    if(-not (Test-Path -LiteralPath $exe)){$exe=Join-Path $PSHOME 'powershell.exe'}
    $collector=Join-Path $PSScriptRoot 'Invoke-Collector.ps1'
    $encoded=Get-SefazCollectorEncodedCommand $collector $Command $Ids $ConfigPath $DataPath
    $arguments=@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-EncodedCommand',$encoded)
    return Invoke-SefazNativeJsonProcess $exe $arguments 180 32000000
}

function Write-SefazWorkerLog([string]$Root,[string]$Status,[int]$Batches,[int]$Documents,[string]$Code='',
    [string]$Stage='',[string]$ExceptionType='',[int]$LineNumber=0,$ProcessExitCode=$null){
    try{
        $folder=Join-Path $Root 'logs';[IO.Directory]::CreateDirectory($folder)|Out-Null
        $record=[ordered]@{at=[DateTimeOffset]::UtcNow.ToString('o');status=$Status;batches=$Batches;documents=$Documents;code=$Code}
        if($Stage -cmatch '^[A-Z_]{1,64}$'){$record.stage=$Stage}
        if($ExceptionType -cmatch '^[A-Za-z0-9_.+`]{1,160}$'){$record.exceptionType=$ExceptionType}
        if($LineNumber -gt 0){$record.lineNumber=$LineNumber}
        if($null -ne $ProcessExitCode){$record.processExitCode=[int]$ProcessExitCode}
        $line=($record|ConvertTo-Json -Compress)+[Environment]::NewLine
        [IO.File]::AppendAllText((Join-Path $folder ('worker-'+[DateTime]::UtcNow.ToString('yyyyMMdd')+'.jsonl')),$line,(New-Object Text.UTF8Encoding($false)))
    }catch{}
}

function Get-SefazWorkerState([string]$CompanyPath){
    $path=Join-Path $CompanyPath 'state.json'
    if(-not [IO.File]::Exists($path)){return $null}
    try{
        $state=ConvertFrom-SefazWorkerJson (Get-Content -LiteralPath $path -Raw)
        if(-not $state.PSObject.Properties['nextAllowedAt'] -or -not $state.PSObject.Properties['status']){throw 'invalid'}
        $null=[DateTimeOffset]::Parse([string]$state.nextAllowedAt)
        return $state
    }catch{throw 'WORKER_STATE_INVALID'}
}

function Get-SefazSharedCooldown([string]$Path){
    if([string]::IsNullOrWhiteSpace($Path) -or -not [IO.File]::Exists($Path)){return $null}
    try{
        $record=ConvertFrom-SefazWorkerJson (Get-Content -LiteralPath $Path -Raw)
        if($null -eq $record -or -not $record.PSObject.Properties['version'] -or $record.version -ne 1 -or
           -not $record.PSObject.Properties['reason'] -or [string]$record.reason -cnotmatch '^[A-Z][A-Z0-9_]{0,63}$' -or
           -not $record.PSObject.Properties['nextAllowedAt'] -or -not $record.PSObject.Properties['updatedAt']){throw 'invalid'}
        $next=[DateTimeOffset]::Parse([string]$record.nextAllowedAt,[Globalization.CultureInfo]::InvariantCulture)
        $null=[DateTimeOffset]::Parse([string]$record.updatedAt,[Globalization.CultureInfo]::InvariantCulture)
        $reason=[string]$record.reason
        $ledgerPath=Join-Path (Split-Path $Path -Parent) 'point-ledger.json'
        if([IO.File]::Exists($ledgerPath)){
            $ledger=ConvertFrom-SefazWorkerJson (Get-Content -LiteralPath $ledgerPath -Raw)
            if($null -eq $ledger -or -not $ledger.PSObject.Properties['version'] -or $ledger.version -ne 1 -or -not $ledger.PSObject.Properties['attempts']){throw 'invalid'}
            $held=$null;$holdReason=''
            foreach($attempt in @($ledger.attempts)){
                if($null -eq $attempt -or -not $attempt.PSObject.Properties['status'] -or [string]$attempt.status -cnotmatch '^([0-9]{3}|REQUEST_RESERVED|REQUEST_UNCERTAIN)$' -or -not $attempt.PSObject.Properties['holdUntil']){throw 'invalid'}
                $until=[DateTimeOffset]::Parse([string]$attempt.holdUntil,[Globalization.CultureInfo]::InvariantCulture)
                if($attempt.status -cnotin @('137','138') -and $until -gt [DateTimeOffset]::UtcNow -and ($null -eq $held -or $until -gt $held)){
                    $held=$until;$holdReason=if($attempt.status -ceq '656'){'SEFAZ_656'}elseif($attempt.status -ceq 'REQUEST_RESERVED'){'REQUEST_RESERVED'}else{'REQUEST_UNCERTAIN'}
                }
            }
            # The reservation ledger is authoritative if a process dies between
            # its durable write and refreshing the shared cooldown cache.
            if($null -ne $held -and ($reason -ceq 'POINT_RATE_LIMIT' -or $held -gt $next)){$next=$held;$reason=$holdReason}
        }
        return [pscustomobject]@{reason=$reason;nextAllowedAt=$next}
    }catch{throw 'WORKER_SHARED_COOLDOWN_INVALID'}
}

function Test-SefazWorkerOutbox([string]$CompanyPath){
    $folder=Join-Path $CompanyPath 'outbox'
    if(-not [IO.Directory]::Exists($folder)){return $false}
    return (@(Get-ChildItem -LiteralPath $folder -Filter '*.json' -File -ErrorAction Stop).Count -gt 0)
}

function Test-SefazWorkerReceipt($Receipt,[string[]]$ExpectedIds,[string]$Property='acknowledgedIds'){
    if($null -eq $Receipt -or -not $Receipt.PSObject.Properties[$Property]){return $false}
    if($Receipt.PSObject.Properties['source'] -and $Receipt.source -ne 'SEFAZ'){return $false}
    $received=@($Receipt.$Property)
    if($received.Count -ne $ExpectedIds.Count -or $received.Count -eq 0){return $false}
    $seen=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach($id in $received){
        if($id -isnot [string] -or $id -cnotmatch '^\d{15}-[0-9a-f]{16}$' -or -not $seen.Add($id)){return $false}
    }
    foreach($id in $ExpectedIds){if(-not $seen.Contains($id)){return $false}}
    return $true
}

function Get-SefazWorkerNextAttempt($State,[int]$Minutes=65){
    $next=[DateTimeOffset]::UtcNow.AddMinutes($Minutes)
    if($null -ne $State -and $State.PSObject.Properties['nextAllowedAt']){
        try{$held=[DateTimeOffset]::Parse([string]$State.nextAllowedAt);if($held -gt $next){$next=$held}}catch{}
    }
    return $next.ToUniversalTime().ToString('o')
}

function Invoke-SefazWorker {
    [CmdletBinding()]
    param(
        [string]$WorkerConfigPath=(Join-Path $PSScriptRoot '../config/worker.json'),
        [string]$CollectorConfigPath=(Join-Path $PSScriptRoot '../config/energetica.json'),
        [string]$DataRoot=(Join-Path $env:LOCALAPPDATA 'Energetica/Sefaz'),
        [ValidateRange(1,200)][int]$MaxBatches=200,
        [ValidateRange(1,120)][int]$MaxMinutes=120,
        [scriptblock]$QueueAction,[scriptblock]$CollectorAction,[scriptblock]$SendBatch,[scriptblock]$NotificationDrain,[scriptblock]$AuxiliaryAction,
        [string]$SharedCooldownPath=''
    )
    $ErrorActionPreference='Stop'
    $lock=$null;$jobId=0;$batches=0;$documents=0;$state=$null;$companyPath=$null;$stage='INITIALIZE'
    [IO.Directory]::CreateDirectory($DataRoot)|Out-Null
    try{
        try{$lock=New-Object IO.FileStream((Join-Path $DataRoot 'worker.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch{return [pscustomobject]@{status='BUSY';batches=0;documents=0}}
        $stage='CONFIG'
        $cfg=ConvertFrom-SefazWorkerJson (Get-Content -LiteralPath $WorkerConfigPath -Raw)
        $collectorCfg=ConvertFrom-SefazWorkerJson (Get-Content -LiteralPath $CollectorConfigPath -Raw)
        if($collectorCfg.companyCnpj -notmatch '^[A-Z0-9]{12}\d{2}$' -or $collectorCfg.environment -notin @('1','2')){throw 'WORKER_CONFIG'}
        $guidPattern='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
        if([string]$cfg.flowId -notmatch ('^'+$guidPattern+'$') -or [string]$cfg.environmentId -notmatch ('^Default-'+$guidPattern+'$')){throw 'WORKER_CONFIG'}
        if(-not [IO.File]::Exists([string]$cfg.sshKeyPath)){throw 'WORKER_CONFIG'}
        $companyPath=Join-Path $DataRoot ($collectorCfg.companyCnpj+'-'+$collectorCfg.environment)
        # Progress delivery even with no fiscal job or during SEFAZ cooldown.
        if($null -eq $NotificationDrain){
            Import-Module (Join-Path $PSScriptRoot '../src/SefazWhatsApp.psm1')
            $NotificationDrain={param($Config,$Root) Invoke-SefazWhatsAppDrain $Config $Root}
        }
        try{
            $notificationResult=& $NotificationDrain $cfg (Join-Path $DataRoot 'notifications')
            if($null -ne $notificationResult -and $notificationResult.status -eq 'retry'){Write-SefazWorkerLog $DataRoot 'WHATSAPP_RETRY' 0 0 'WHATSAPP_RETRY'}
        }catch{Write-SefazWorkerLog $DataRoot 'WHATSAPP_RETRY' 0 0 'WHATSAPP_RETRY'}
        # CT-e/ADN have independent cursors and service limits. Their due slots
        # must not be held by the NF-e point-query/distribution cooldown.
        if($cfg.PSObject.Properties['auxiliaryFiscalEnabled'] -and $cfg.auxiliaryFiscalEnabled -eq $true){
            try{
                if($null -eq $AuxiliaryAction){
                    Import-Module (Join-Path $PSScriptRoot '../src/AuxiliaryFiscal.psm1') -DisableNameChecking
                    $AuxiliaryAction={param($Collector,$Worker,$Root,$Now) Invoke-AuxiliaryFiscalScheduledCycle -Config $Collector -WorkerConfig $Worker -DataRoot $Root -Now $Now}
                }
                $auxiliaryRoot=Join-Path (Split-Path $DataRoot -Parent) ('SefazAuxLive/'+$collectorCfg.companyCnpj+'-'+$collectorCfg.environment)
                $null=& $AuxiliaryAction $collectorCfg $cfg $auxiliaryRoot ([DateTimeOffset]::UtcNow)
                Write-SefazWorkerLog $DataRoot 'AUXILIARY_CYCLE' 0 0
            }catch{Write-SefazWorkerLog $DataRoot 'AUXILIARY_RETRY' 0 0 'WORKER_RETRY'}
        }
        $stage='SHARED_COOLDOWN_PREFLIGHT'
        if([string]::IsNullOrWhiteSpace($SharedCooldownPath)){$SharedCooldownPath=Join-Path (Split-Path $DataRoot -Parent) 'SefazGapRecovery/global-cooldown.json'}
        if($cfg.PSObject.Properties['gapRecoveryEnabled'] -and $cfg.gapRecoveryEnabled -eq $true -and
           (-not [IO.File]::Exists($SharedCooldownPath) -or -not [IO.File]::Exists((Join-Path (Split-Path $SharedCooldownPath -Parent) 'point-ledger.json')))){throw 'WORKER_SHARED_COOLDOWN_MISSING'}
        $shared=Get-SefazSharedCooldown $SharedCooldownPath
        # Point-query quota is independent of distNSU. Rejections and uncertain
        # in-flight requests hold every fiscal caller, including this worker.
        if($null -ne $shared -and $shared.reason -cne 'POINT_RATE_LIMIT' -and $shared.nextAllowedAt -gt [DateTimeOffset]::UtcNow){
            Write-SefazWorkerLog $DataRoot 'WAIT' 0 0 'WORKER_COOLDOWN'
            return [pscustomobject]@{status='WAIT';batches=0;documents=0;nextAllowedAt=$shared.nextAllowedAt.ToString('o')}
        }
        $stage='STATE_PREFLIGHT'
        $state=Get-SefazWorkerState $companyPath
        if(-not (Test-SefazWorkerOutbox $companyPath) -and $null -ne $state -and [DateTimeOffset]::Parse([string]$state.nextAllowedAt) -gt [DateTimeOffset]::UtcNow){
            Write-SefazWorkerLog $DataRoot 'WAIT' 0 0
            return [pscustomobject]@{status='WAIT';batches=0;documents=0;nextAllowedAt=$state.nextAllowedAt}
        }
        if($null -eq $QueueAction){$QueueAction={param($Action,$Id,$NextAt,$ErrorCode) Invoke-SefazQueueCommand $cfg $Action $Id $NextAt $ErrorCode}.GetNewClosure()}
        if($null -eq $CollectorAction){$CollectorAction={param($Command,$Ids) Invoke-SefazLocalCollector $Command $Ids $CollectorConfigPath $DataRoot}.GetNewClosure()}
        if($null -eq $SendBatch){
            Import-Module (Join-Path $PSScriptRoot '../src/FlowTransport.psm1') -Force -DisableNameChecking
            $notificationRoot=Join-Path $DataRoot 'notifications'
            $SendBatch={param($Documents,$FlowId,$EnvironmentId) Send-SefazBatch -Documents $Documents -FlowId $FlowId -EnvironmentId $EnvironmentId -NotificationRoot $notificationRoot}.GetNewClosure()
        }
        $stage='QUEUE_CLAIM'
        $claim=& $QueueAction 'queue-next' 0 $null $null
        if($null -eq $claim -or -not $claim.PSObject.Properties['job']){throw 'WORKER_QUEUE_RESPONSE'}
        if($null -eq $claim.job){Write-SefazWorkerLog $DataRoot 'IDLE' 0 0;return [pscustomobject]@{status='IDLE';batches=0;documents=0}}
        $jobId=[int]$claim.job.id;if($jobId -le 0){throw 'WORKER_QUEUE_RESPONSE'}
        $deadline=[DateTimeOffset]::UtcNow.AddMinutes($MaxMinutes)
        while($batches -lt $MaxBatches -and [DateTimeOffset]::UtcNow -lt $deadline){
            $stage='QUEUE_RENEW_BEFORE_COLLECT'
            $renew=& $QueueAction 'queue-renew' $jobId $null $null
            if($null -eq $renew -or $renew.renewed -ne $true){throw 'WORKER_LEASE'}
            $stage='COLLECT'
            $result=& $CollectorAction 'Collect' @()
            if($null -eq $result -or -not $result.PSObject.Properties['documents'] -or -not $result.PSObject.Properties['state']){throw 'WORKER_COLLECTOR_RESPONSE'}
            $batch=@($result.documents)
            $state=$result.state
            $batches++
            if($batch.Count -gt 0){
                $ids=@($batch|ForEach-Object{[string]$_.id})
                if(-not (Test-SefazWorkerReceipt ([pscustomobject]@{acknowledgedIds=$ids}) $ids)){throw 'WORKER_DOCUMENT_IDS'}
                $stage='SEND_BATCH'
                $receipt=& $SendBatch $batch ([string]$cfg.flowId) ([string]$cfg.environmentId)
                if(-not (Test-SefazWorkerReceipt $receipt $ids)){throw 'WORKER_RECEIPT'}
                $stage='QUEUE_RENEW_BEFORE_ACK'
                $renew=& $QueueAction 'queue-renew' $jobId $null $null
                if($null -eq $renew -or $renew.renewed -ne $true){throw 'WORKER_LEASE'}
                $stage='LOCAL_ACK'
                $ack=& $CollectorAction 'Acknowledge' $ids
                if($null -eq $ack -or $ack.status -ne 'ACKNOWLEDGED' -or -not (Test-SefazWorkerReceipt $ack $ids 'ids')){throw 'WORKER_LOCAL_ACK'}
                $documents+=$batch.Count
                Write-SefazWorkerLog $DataRoot 'ACKNOWLEDGED' $batches $documents
            }
            # A durable file is authoritative after a child invocation. The
            # returned state is retained only for mocked collectors in tests.
            $stage='STATE_AFTER_COLLECT'
            $saved=Get-SefazWorkerState $companyPath
            if($null -ne $saved){$state=$saved}
            $hasPending=Test-SefazWorkerOutbox $companyPath
            if($hasPending){continue}
            $status=if($null -ne $state){[string]$state.status}else{[string]$result.status}
            $final=$status -eq '137'
            if($status -eq '138' -and $null -ne $state -and $state.PSObject.Properties['lastNsu'] -and $state.PSObject.Properties['maxNsu']){
                $final=([string]$state.lastNsu -cmatch '^\d{15}$' -and [string]$state.maxNsu -cmatch '^\d{15}$' -and [string]$state.lastNsu -ceq [string]$state.maxNsu)
            }
            if($final){
                $stage='QUEUE_COMPLETE'
                $done=& $QueueAction 'queue-complete' $jobId $null $null
                if($null -eq $done -or $done.completed -ne $true -or [int]$done.id -ne $jobId){throw 'WORKER_COMPLETE'}
                Write-SefazWorkerLog $DataRoot 'COMPLETED' $batches $documents
                return [pscustomobject]@{status='COMPLETED';batches=$batches;documents=$documents}
            }
            if($status -eq '656'){
                $stage='NEXT_ATTEMPT_COOLDOWN'
                $next=Get-SefazWorkerNextAttempt $state 1
                $stage='QUEUE_DEFER_COOLDOWN'
                $defer=& $QueueAction 'queue-defer' $jobId $next 'WORKER_COOLDOWN'
                if($null -eq $defer -or $defer.deferred -ne $true){throw 'WORKER_DEFER'}
                Write-SefazWorkerLog $DataRoot 'DEFERRED' $batches $documents 'WORKER_COOLDOWN'
                return [pscustomobject]@{status='DEFERRED';batches=$batches;documents=$documents;nextAllowedAt=$next}
            }
            if($null -eq $state -or $status -ne '138'){throw 'WORKER_STATE'}
            if([DateTimeOffset]::Parse([string]$state.nextAllowedAt) -gt [DateTimeOffset]::UtcNow){throw 'WORKER_STATE'}
        }
        $stage='NEXT_ATTEMPT_LIMIT'
        $next=Get-SefazWorkerNextAttempt $state 5
        $stage='QUEUE_DEFER_LIMIT'
        $defer=& $QueueAction 'queue-defer' $jobId $next 'WORKER_LIMIT'
        if($null -eq $defer -or $defer.deferred -ne $true){throw 'WORKER_DEFER'}
        Write-SefazWorkerLog $DataRoot 'DEFERRED' $batches $documents 'WORKER_LIMIT'
        return [pscustomobject]@{status='DEFERRED';batches=$batches;documents=$documents;nextAllowedAt=$next}
    }catch{
        # Never log exception bodies, command lines, URLs, certificates or XML.
        $failure=$_;$failedStage=$stage
        $status='ERROR';$next=Get-SefazWorkerNextAttempt $state 65
        if($jobId -gt 0 -and $null -ne $QueueAction){
            try{
                $defer=& $QueueAction 'queue-defer' $jobId $next 'WORKER_RETRY'
                if($null -ne $defer -and $defer.deferred -eq $true){$status='DEFERRED'}
            }catch{
                $fallback=$_
                Write-SefazWorkerLog $DataRoot 'ERROR' $batches $documents 'WORKER_RETRY' 'QUEUE_DEFER_RETRY' $fallback.Exception.GetType().FullName $fallback.InvocationInfo.ScriptLineNumber $fallback.Exception.Data['ProcessExitCode']
            }
        }
        Write-SefazWorkerLog $DataRoot $status $batches $documents 'WORKER_RETRY' $failedStage $failure.Exception.GetType().FullName $failure.InvocationInfo.ScriptLineNumber $failure.Exception.Data['ProcessExitCode']
        return [pscustomobject]@{status=$status;batches=$batches;documents=$documents;nextAllowedAt=$next}
    }finally{if($null -ne $lock){$lock.Dispose()}}
}

if($MyInvocation.InvocationName -ne '.'){
    $result=Invoke-SefazWorker -WorkerConfigPath $WorkerConfigPath -CollectorConfigPath $CollectorConfigPath -DataRoot $DataRoot -MaxBatches $MaxBatches -MaxMinutes $MaxMinutes
    $result|ConvertTo-Json -Compress
    if($result.status -eq 'ERROR'){exit 1}
}
