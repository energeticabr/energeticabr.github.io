$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/Invoke-SefazWorker.ps1')
$script:passed=0
function Assert-WorkerEqual($Actual,$Expected,[string]$Name){
    if($Actual -ne $Expected){throw ('FAIL '+$Name)}
    $script:passed++;Write-Host ('PASS '+$Name)
}
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('sefaz-worker-tests-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot)|Out-Null
try{
    $key=Join-Path $testRoot 'fixture-key';[IO.File]::WriteAllText($key,'LOCAL FIXTURE; NOT A KEY')
    $workerConfig=Join-Path $testRoot 'worker.json'
    @{sshKeyPath=$key;sshHost='opc@163.176.171.217';remoteBridge='/opt/energetica-whatsapp/integrations/notas-fiscais-sefaz/sefaz_bridge.py';remotePython='/opt/energetica-whatsapp/.venv/bin/python';flowId='aad7d18a-a45d-4f55-b7d8-daac9596c18b';environmentId='Default-12345678-1234-1234-1234-123456789012'}|ConvertTo-Json|Set-Content -LiteralPath $workerConfig -Encoding UTF8
    $collectorConfig=Join-Path $testRoot 'collector.json'
    @{companyCnpj='38626750000146';environment='1'}|ConvertTo-Json|Set-Content -LiteralPath $collectorConfig -Encoding UTF8
    $script:id='000000000000001-0123456789abcdef'
    $script:document=[pscustomobject]@{id=$script:id}
    function New-Scenario([string]$Name){
        $script:data=Join-Path $testRoot $Name
        $script:company=Join-Path $script:data '38626750000146-1'
        [IO.Directory]::CreateDirectory($script:company)|Out-Null
        $script:queueCalls=New-Object Collections.Generic.List[string]
        $script:collectCalls=New-Object Collections.Generic.List[string]
        $script:sendCount=0
    }
    function Set-State([string]$Status,[string]$Last='000000000000001',[string]$Max='000000000000001'){
        $s=[ordered]@{status=$Status;lastNsu=$Last;maxNsu=$Max;nextAllowedAt=[DateTimeOffset]::UtcNow.AddMinutes(65).ToString('o')}
        $s|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $script:company 'state.json') -Encoding UTF8
        return [pscustomobject]$s
    }
    $queue={param($Action,$Id,$NextAt,$ErrorCode)
        $script:queueCalls.Add($Action)
        if($Action -eq 'queue-next'){return [pscustomobject]@{job=[pscustomobject]@{id=1;startDate='2026-07-29T00:00:00Z'}}}
        if($Action -eq 'queue-complete'){return [pscustomobject]@{completed=$true;id=1}}
        if($Action -eq 'queue-defer'){return [pscustomobject]@{deferred=$true;id=1}}
        return [pscustomobject]@{renewed=$true;job=[pscustomobject]@{id=1}}
    }
    $send={param($Documents,$FlowId,$EnvironmentId)
        $script:sendCount++;return [pscustomobject]@{source='SEFAZ';acknowledgedIds=@($Documents|ForEach-Object{$_.id})}
    }
    $runnerArgs=@{WorkerConfigPath=$workerConfig;CollectorConfigPath=$collectorConfig;QueueAction=$queue;SendBatch=$send}

    New-Scenario 'filtered-page-continues'
    $script:pages=0
    $collector={param($Command,$Ids)
        $script:pages++
        $s=[ordered]@{status='138';lastNsu=$(if($script:pages -eq 1){'000000000000001'}else{'000000000000002'});maxNsu='000000000000002';nextAllowedAt=[DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o')}
        $s|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $script:company 'state.json') -Encoding UTF8
        return [pscustomobject]@{status='138';documents=@();state=[pscustomobject]$s}
    }
    $result=Invoke-SefazWorker @runnerArgs -DataRoot $script:data -CollectorAction $collector
    Assert-WorkerEqual $result.status 'COMPLETED' 'entire excluded page does not stop later source pages'
    Assert-WorkerEqual $script:pages 2 'filtered pages advance through source maximum'
    Assert-WorkerEqual $script:sendCount 0 'excluded pages never invoke fiscal transport'

    New-Scenario 'wait'
    Set-State '137'|Out-Null
    $result=Invoke-SefazWorker @runnerArgs -DataRoot $script:data -CollectorAction {throw 'Collector must not run'}
    Assert-WorkerEqual $result.status 'WAIT' 'cooldown returns WAIT'
    Assert-WorkerEqual $script:queueCalls.Count 0 'cooldown checked before queue claim'
    $script:notificationDrains=0
    $result=Invoke-SefazWorker @runnerArgs -DataRoot $script:data -CollectorAction {throw 'Collector must not run'} -NotificationDrain {param($Config,$Root);$script:notificationDrains++;throw 'OFFLINE_PRIVATE_ERROR'}
    Assert-WorkerEqual $result.status 'WAIT' 'WhatsApp outage preserves fiscal cooldown'
    Assert-WorkerEqual $script:notificationDrains 1 'WhatsApp drains independently even while fiscal source is waiting'
    Assert-WorkerEqual $script:queueCalls.Count 0 'WhatsApp outage does not claim fiscal job or call SEFAZ'

    New-Scenario 'shared-gap-cooldown'
    $sharedPath=Join-Path $script:data 'global-cooldown.json'
    @{version=1;nextAllowedAt=[DateTimeOffset]::UtcNow.AddMinutes(65).ToString('o');reason='SEFAZ_656';updatedAt=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath $sharedPath -Encoding UTF8
    $script:notificationDrains=0
    $result=Invoke-SefazWorker @runnerArgs -DataRoot $script:data -SharedCooldownPath $sharedPath -CollectorAction {throw 'must not consult during shared fiscal hold'} -NotificationDrain {param($Config,$Root);$script:notificationDrains++}
    Assert-WorkerEqual $result.status 'WAIT' 'gap rejection cooldown also blocks normal distribution'
    Assert-WorkerEqual $script:queueCalls.Count 0 'shared hold checked before claiming fiscal job'
    Assert-WorkerEqual $script:notificationDrains 1 'notification delivery continues during shared hold'

    New-Scenario 'shared-gap-invalid'
    $sharedPath=Join-Path $script:data 'global-cooldown.json'
    [IO.File]::WriteAllText($sharedPath,'{"version":1,"nextAllowedAt":"invalid","reason":"SEFAZ_656"}')
    $result=Invoke-SefazWorker @runnerArgs -DataRoot $script:data -SharedCooldownPath $sharedPath -CollectorAction {throw 'must not query after malformed governor'}
    Assert-WorkerEqual $result.status 'ERROR' 'malformed shared governor blocks fiscal execution'
    Assert-WorkerEqual $script:queueCalls.Count 0 'malformed governor never claims source work'

    New-Scenario 'point-budget-only'
    $sharedPath=Join-Path $script:data 'global-cooldown.json'
    @{version=1;nextAllowedAt=[DateTimeOffset]::UtcNow.AddMinutes(65).ToString('o');reason='POINT_RATE_LIMIT';updatedAt=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath $sharedPath -Encoding UTF8
    $argsPoint=$runnerArgs.Clone();$argsPoint.QueueAction={param($Action,$Id,$NextAt,$ErrorCode);$script:queueCalls.Add($Action);return [pscustomobject]@{job=$null}}
    $result=Invoke-SefazWorker @argsPoint -DataRoot $script:data -SharedCooldownPath $sharedPath -CollectorAction {throw 'empty job must not query'}
    Assert-WorkerEqual $result.status 'IDLE' 'point request quota does not block normal distribution schedule'
    Assert-WorkerEqual $script:queueCalls.Count 1 'normal queue remains available while only point quota is exhausted'

    New-Scenario 'stale-shared-cache'
    $sharedPath=Join-Path $script:data 'global-cooldown.json'
    @{version=1;nextAllowedAt=[DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o');reason='NONE';updatedAt=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath $sharedPath -Encoding UTF8
    @{version=1;attempts=@(@{status='REQUEST_RESERVED';holdUntil=[DateTimeOffset]::UtcNow.AddMinutes(65).ToString('o')})}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $script:data 'point-ledger.json') -Encoding UTF8
    $result=Invoke-SefazWorker @runnerArgs -DataRoot $script:data -SharedCooldownPath $sharedPath -CollectorAction {throw 'crash between ledger and cache must not release fiscal calls'}
    Assert-WorkerEqual $result.status 'WAIT' 'authoritative reservation blocks source even with stale cooldown cache'
    Assert-WorkerEqual $script:queueCalls.Count 0 'crash reservation checked before fiscal queue claim'

    New-Scenario 'invalid-shared-ledger'
    $sharedPath=Join-Path $script:data 'global-cooldown.json'
    @{version=1;nextAllowedAt=[DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o');reason='NONE';updatedAt=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath $sharedPath -Encoding UTF8
    [IO.File]::WriteAllText((Join-Path $script:data 'point-ledger.json'),'{"version":1,"attempts":[{"status":"656","holdUntil":"invalid"}]}')
    $result=Invoke-SefazWorker @runnerArgs -DataRoot $script:data -SharedCooldownPath $sharedPath -CollectorAction {throw 'invalid point ledger must block query'}
    Assert-WorkerEqual $result.status 'ERROR' 'malformed authoritative point ledger blocks fiscal execution'
    Assert-WorkerEqual $script:queueCalls.Count 0 'malformed ledger never claims source work'

    New-Scenario 'required-governor-missing'
    $enabled=Get-Content -LiteralPath $workerConfig -Raw|ConvertFrom-Json
    $enabled|Add-Member -NotePropertyName gapRecoveryEnabled -NotePropertyValue $true
    $enabledPath=Join-Path $testRoot 'worker-gap-enabled.json';$enabled|ConvertTo-Json|Set-Content -LiteralPath $enabledPath -Encoding UTF8
    $argsRequired=$runnerArgs.Clone();$argsRequired.WorkerConfigPath=$enabledPath
    $result=Invoke-SefazWorker @argsRequired -DataRoot $script:data -SharedCooldownPath (Join-Path $script:data 'missing-cooldown.json') -CollectorAction {throw 'configured governor must exist'}
    Assert-WorkerEqual $result.status 'ERROR' 'enabled gap recovery requires both durable governor files'
    Assert-WorkerEqual $script:queueCalls.Count 0 'missing governor never claims source work'

    New-Scenario 'replay'
    Set-State '138'|Out-Null
    [IO.Directory]::CreateDirectory((Join-Path $script:company 'outbox'))|Out-Null
    $pending=Join-Path (Join-Path $script:company 'outbox') ($script:id+'.json')
    $script:document|ConvertTo-Json|Set-Content -LiteralPath $pending -Encoding UTF8
    $collector={param($Command,$Ids)
        $script:collectCalls.Add($Command)
        if($Command -eq 'Acknowledge'){
            Remove-Item -LiteralPath (Join-Path (Join-Path $script:company 'outbox') ($script:id+'.json'))
            return [pscustomobject]@{status='ACKNOWLEDGED';ids=@($Ids)}
        }
        return [pscustomobject]@{status='REPLAY_OUTBOX';documents=@($script:document);state=(Get-Content -LiteralPath (Join-Path $script:company 'state.json') -Raw|ConvertFrom-Json)}
    }
    $result=Invoke-SefazWorker @runnerArgs -DataRoot $script:data -CollectorAction $collector
    Assert-WorkerEqual $result.status 'COMPLETED' 'replay drains and finishes exhausted distribution'
    Assert-WorkerEqual $script:sendCount 1 'one batch sent'
    Assert-WorkerEqual (@($script:collectCalls|Where-Object{$_ -eq 'Acknowledge'}).Count) 1 'local ack only after receipt'
    Assert-WorkerEqual (@($script:queueCalls|Where-Object{$_ -eq 'queue-renew'}).Count -ge 2) $true 'lease renewed around delivery'

    New-Scenario 'receipt-mismatch'
    $badSend={param($Documents,$FlowId,$EnvironmentId);return [pscustomobject]@{acknowledgedIds=@('000000000000002-0123456789abcdef')}}
    $collector={param($Command,$Ids)
        $script:collectCalls.Add($Command)
        return [pscustomobject]@{status='138';documents=@($script:document);state=$null}
    }
    $argsBad=$runnerArgs.Clone();$argsBad.SendBatch=$badSend
    $result=Invoke-SefazWorker @argsBad -DataRoot $script:data -CollectorAction $collector
    Assert-WorkerEqual $result.status 'DEFERRED' 'receipt mismatch defers job'
    Assert-WorkerEqual (@($script:collectCalls|Where-Object{$_ -eq 'Acknowledge'}).Count) 0 'mismatched receipt never acknowledges outbox'
    Assert-WorkerEqual (@($script:queueCalls|Where-Object{$_ -eq 'queue-complete'}).Count) 0 'mismatched receipt never completes job'

    New-Scenario '656'
    $collector={param($Command,$Ids);$s=Set-State '656';return [pscustomobject]@{status='656';documents=@();state=$s}}
    $result=Invoke-SefazWorker @runnerArgs -DataRoot $script:data -CollectorAction $collector
    Assert-WorkerEqual $result.status 'DEFERRED' '656 defers until durable cooldown'
    Assert-WorkerEqual $script:sendCount 0 '656 does not send documents'

    New-Scenario '137'
    $collector={param($Command,$Ids);$s=Set-State '137';return [pscustomobject]@{status='137';documents=@();state=$s}}
    $result=Invoke-SefazWorker @runnerArgs -DataRoot $script:data -CollectorAction $collector
    Assert-WorkerEqual $result.status 'COMPLETED' '137 completes source job'

    New-Scenario 'bounded'
    $collector={param($Command,$Ids)
        if($Command -eq 'Acknowledge'){return [pscustomobject]@{status='ACKNOWLEDGED';ids=@($Ids)}}
        $state=@{status='138';lastNsu='000000000000001';maxNsu='000000000000002';nextAllowedAt=[DateTimeOffset]::UtcNow.AddMinutes(-1).ToString('o')}
        $state|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $script:company 'state.json') -Encoding UTF8
        return [pscustomobject]@{status='138';documents=@($script:document);state=[pscustomobject]$state}
    }
    $result=Invoke-SefazWorker @runnerArgs -DataRoot $script:data -CollectorAction $collector -MaxBatches 2
    Assert-WorkerEqual $result.status 'DEFERRED' 'batch limit defers remaining distribution'
    Assert-WorkerEqual $script:sendCount 2 'batch limit bounds sends'
    Assert-WorkerEqual (@($script:queueCalls|Where-Object{$_ -eq 'queue-complete'}).Count) 0 'partial source never completes job'

    New-Scenario 'empty-queue'
    $argsEmpty=$runnerArgs.Clone();$argsEmpty.QueueAction={param($Action,$Id,$NextAt,$ErrorCode);return [pscustomobject]@{job=$null}}
    $result=Invoke-SefazWorker @argsEmpty -DataRoot $script:data -CollectorAction {throw 'must not collect without job'}
    Assert-WorkerEqual $result.status 'IDLE' 'empty queue does not consult SEFAZ'

    New-Scenario 'uncertain'
    $result=Invoke-SefazWorker @runnerArgs -DataRoot $script:data -CollectorAction {throw 'SECRET_XML_URL_MUST_NOT_APPEAR'}
    Assert-WorkerEqual $result.status 'DEFERRED' 'collector uncertainty defers without completion'
    $logs=Get-Content -LiteralPath (Join-Path (Join-Path $script:data 'logs') ('worker-'+[DateTime]::UtcNow.ToString('yyyyMMdd')+'.jsonl')) -Raw
    Assert-WorkerEqual ($logs -match 'SECRET|XML|URL') $false 'logs contain only fixed statuses and counters'

    New-Scenario 'locked'
    $lock=New-Object IO.FileStream((Join-Path $script:data 'worker.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try{
        $result=Invoke-SefazWorker @runnerArgs -DataRoot $script:data -CollectorAction {throw 'must not run'}
        Assert-WorkerEqual $result.status 'BUSY' 'local worker lock prevents concurrent runs'
    }finally{$lock.Dispose()}
    Assert-WorkerEqual (ConvertTo-SefazNativeArguments @('a b','c"d','C:\ending\')) '"a b" "c\"d" "C:\ending\\"' 'native argument quoting preserves spaces quotes and backslash'
    $two=@($script:id,'000000000000002-fedcba9876543210')
    Assert-WorkerEqual (Test-SefazWorkerReceipt ([pscustomobject]@{acknowledgedIds=@($two[1],$two[0])}) $two) $true 'exact receipt permits reordered IDs'
    Assert-WorkerEqual (Test-SefazWorkerReceipt ([pscustomobject]@{acknowledgedIds=@($two[0],$two[0])}) $two) $false 'duplicate receipt cannot acknowledge batch'
    Assert-WorkerEqual (Test-SefazWorkerReceipt ([pscustomobject]@{acknowledgedIds=@($two)+@('000000000000003-aaaaaaaaaaaaaaaa')}) $two) $false 'extra receipt ID is rejected'
    $child=Join-Path $PSHOME 'pwsh.exe';if(-not (Test-Path -LiteralPath $child)){$child=Join-Path $PSHOME 'powershell.exe'}
    $childCode='[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);@{status="UTF8";text=([char]0x00E7).ToString()}|ConvertTo-Json -Compress'
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childCode))
    $decoded=Invoke-SefazNativeJsonProcess $child @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',$encoded) 20 4096
    Assert-WorkerEqual $decoded.text ([char]0x00E7).ToString() 'child process JSON preserves UTF8'
    $stub=Join-Path $testRoot 'stub-collector.ps1'
    [IO.File]::WriteAllText($stub,'param([string]$Command,[string]$ConfigPath,[string]$DataRoot,[string]$PayloadBase64);@{command=$Command;config=$ConfigPath;root=$DataRoot;payload=$PayloadBase64}|ConvertTo-Json -Compress')
    $encoded=Get-SefazCollectorEncodedCommand $stub 'Acknowledge' @($script:id) "test with ' quote" 'root with spaces'
    $decoded=Invoke-SefazNativeJsonProcess $child @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',$encoded) 20 4096
    Assert-WorkerEqual $decoded.command 'Acknowledge' 'child collector receives named command correctly'
    Assert-WorkerEqual $decoded.config "test with ' quote" 'child parameters preserve literal quote'
    $ackIds=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($decoded.payload))|ConvertFrom-Json
    Assert-WorkerEqual $ackIds.ids[0] $script:id 'child receives exact IDs without shell interpolation'

    # Exercise the actual default GetNewClosure -> queue command -> native
    # argument builder path. Only the final native process boundary is stubbed.
    New-Scenario 'default-queue-defer'
    $originalNative=(Get-Command Invoke-SefazNativeJsonProcess).ScriptBlock
    $script:capturedRemote=New-Object Collections.Generic.List[string]
    $script:failDefer=$false
    try{
        function Invoke-SefazNativeJsonProcess {
            param($Executable,$Arguments,$TimeoutSeconds,$MaxOutputChars)
            $remote=[string]$Arguments[-1]
            $script:capturedRemote.Add($remote)
            if($remote -match 'queue-next$'){return [pscustomobject]@{job=[pscustomobject]@{id=1}}}
            if($remote -match 'queue-renew --id 1$'){return [pscustomobject]@{renewed=$true;job=[pscustomobject]@{id=1}}}
            if($remote -match 'queue-defer --id 1 --next-at \S+ --error WORKER_'){
                if($script:failDefer){
                    $exception=New-Object InvalidOperationException('SECRET_HTTP_URL_OR_XML_MUST_NOT_BE_LOGGED')
                    $exception.Data['ProcessExitCode']=7
                    throw $exception
                }
                return [pscustomobject]@{deferred=$true;id=1}
            }
            throw 'LOCAL_STUB_UNEXPECTED_ARGUMENTS'
        }
        $realQueueArgs=$runnerArgs.Clone();$realQueueArgs.Remove('QueueAction')
        $collector={param($Command,$Ids)
            $state=@{status='656';lastNsu='000000000000000';nextAllowedAt=[DateTimeOffset]::UtcNow.AddMinutes(65).ToString('o')}
            $state|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $script:company 'state.json') -Encoding UTF8
            return [pscustomobject]@{status='656';documents=@();state=[pscustomobject]$state}
        }
        $result=Invoke-SefazWorker @realQueueArgs -DataRoot $script:data -CollectorAction $collector
        Assert-WorkerEqual $result.status 'DEFERRED' 'actual default queue closure handles positional cooldown timestamp'
        Assert-WorkerEqual $script:capturedRemote.Count 3 'default queue invokes claim renew and defer exactly once'
        Assert-WorkerEqual ($script:capturedRemote[2] -match 'queue-defer --id 1 --next-at \d{4}-\d{2}-\d{2}T\S+ --error WORKER_COOLDOWN$') $true 'captured SSH command has exact positional defer arguments'
        New-Scenario 'default-queue-diagnostic'
        $script:failDefer=$true
        $result=Invoke-SefazWorker @realQueueArgs -DataRoot $script:data -CollectorAction $collector
        Assert-WorkerEqual $result.status 'ERROR' 'unconfirmed remote defer is never reported as successful'
        $logPath=Join-Path (Join-Path $script:data 'logs') ('worker-'+[DateTime]::UtcNow.ToString('yyyyMMdd')+'.jsonl')
        $records=@(Get-Content -LiteralPath $logPath|ForEach-Object{$_|ConvertFrom-Json})
        Assert-WorkerEqual (@($records|Where-Object{$_.stage -eq 'QUEUE_DEFER_COOLDOWN'}).Count) 1 'diagnostic identifies first failing defer stage'
        Assert-WorkerEqual (@($records|Where-Object{$_.stage -eq 'QUEUE_DEFER_RETRY'}).Count) 1 'diagnostic identifies fallback defer failure'
        Assert-WorkerEqual $records[0].exceptionType 'System.InvalidOperationException' 'diagnostic records safe exception type'
        Assert-WorkerEqual ($records[0].lineNumber -gt 0) $true 'diagnostic records source line number'
        Assert-WorkerEqual $records[0].processExitCode 7 'diagnostic records numeric process exit code'
        Assert-WorkerEqual ((Get-Content -LiteralPath $logPath -Raw) -match 'SECRET|HTTP|URL|XML|2026-10-29T05:45') $false 'diagnostic excludes exception message URLs payloads and request parameters'
    }finally{
        Set-Item -LiteralPath Function:Invoke-SefazNativeJsonProcess -Value $originalNative
    }
    $childCode='[Console]::Error.WriteLine("SECRET_PRIVATE_OUTPUT");exit 7'
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childCode))
    $caught=$null
    try{$null=Invoke-SefazNativeJsonProcess $child @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',$encoded) 20 4096}catch{$caught=$_}
    Assert-WorkerEqual $caught.Exception.Data['ProcessExitCode'] 7 'native failure retains numeric exit status only'
    Assert-WorkerEqual ($caught.Exception.Message -match 'SECRET') $false 'native stderr is never included in exception'
    Assert-WorkerEqual (ConvertTo-SefazQueueTimestamp '2026-10-29T05:45:43.9196448+00:00') '2026-10-29T05:45:43.919644Z' 'queue timestamp has Python3.9-compatible microsecond precision'
    Write-Host ('Passed '+$script:passed+' worker assertions; no network or fiscal collection.')
}finally{
    $resolved=[IO.Path]::GetFullPath($testRoot)
    $tempBase=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if($resolved.StartsWith($tempBase,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'sefaz-worker-tests-*'){
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
