Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Sefaz.psm1') -DisableNameChecking

function Get-AuxProperty($Object,[string]$Name,$Default=$null){
    if($null -eq $Object){return $Default}
    if($Object -is [Collections.IDictionary]){if($Object.Contains($Name)){return $Object[$Name]};return $Default}
    $p=$Object.PSObject.Properties[$Name];if($null -ne $p){return $p.Value};return $Default
}
function Read-AuxJson([string]$Path){
    $options=@{};if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){$options.DateKind='String'}
    return ([IO.File]::ReadAllText($Path)|ConvertFrom-Json @options)
}
function ConvertTo-AuxNsu([string]$Value,[string]$Source){
    $number=[long]0
    if($Value -cnotmatch '^\d{1,19}$' -or -not [long]::TryParse($Value,[ref]$number)){throw 'AUX_NSU_INVALID'}
    if($Source -ceq 'CTE' -and $Value.Length -gt 15){throw 'AUX_NSU_INVALID'}
    return $number.ToString([Globalization.CultureInfo]::InvariantCulture).PadLeft(15,'0')
}
function Get-AuxErrorCode($ErrorRecord,[string]$Fallback='AUX_SOURCE_FAILED'){
    $message=[string]$ErrorRecord.Exception.Message
    if($message -cmatch '^AUX_[A-Z_]+$'){return $message}
    return $Fallback
}
function Write-AuxLog([string]$Path,[string]$Source,[string]$Code,[DateTimeOffset]$Now,[int]$Documents=0){
    $folder=Join-Path $Path 'logs';[IO.Directory]::CreateDirectory($folder)|Out-Null
    $entry=[ordered]@{timestamp=$Now.ToString('o');source=$Source;code=$Code;documents=$Documents}|ConvertTo-Json -Compress
    [IO.File]::AppendAllText((Join-Path $folder 'worker.jsonl'),$entry+"`n",(New-Object Text.UTF8Encoding($false)))
}
function Read-AuxState([string]$Path,[string]$Source){
    $state=[ordered]@{version=1;source=$Source;lastNsu='000000000000000';maxNsu=$null;status='NEW';nextAllowedAt=$null;lastCompletedSlot=$null;lastCompletedScheduledSlot=$null;lastCompletedManualSlot=$null;pendingSlot=$null;hasMore=$false;awaitingCompletion=$false}
    $statePath=Join-Path $Path 'state.json'
    if([IO.File]::Exists($statePath)){
        $saved=Read-AuxJson $statePath
        foreach($property in $saved.PSObject.Properties){$state[$property.Name]=$property.Value}
    }
    if($state.version -ne 1 -or $state.source -cne $Source){throw 'AUX_STATE_INVALID'}
    if(-not $state.lastCompletedScheduledSlot -and $state.lastCompletedSlot -cmatch '^\d{4}-\d{2}-\d{2}-\d{2}$'){$state.lastCompletedScheduledSlot=$state.lastCompletedSlot}
    if(-not $state.lastCompletedManualSlot -and $state.lastCompletedSlot -cmatch '^manual:[0-9a-f]{32}$'){$state.lastCompletedManualSlot=$state.lastCompletedSlot}
    $state.lastNsu=ConvertTo-AuxNsu ([string]$state.lastNsu) $Source
    if($null -ne $state.nextAllowedAt){$null=[DateTimeOffset]::Parse([string]$state.nextAllowedAt,[Globalization.CultureInfo]::InvariantCulture)}
    return $state
}
function Get-AuxStoredDocuments([string]$Path){
    foreach($folder in @('archive','outbox','scope-excluded','scope-pending-date')){
        $directory=Join-Path $Path $folder
        if(-not [IO.Directory]::Exists($directory)){continue}
        foreach($file in @(Get-ChildItem -LiteralPath $directory -Filter '*.json' -File)){Write-Output (Read-AuxJson $file.FullName)}
    }
}
function Assert-AuxDocument($Document,[string]$Source){
    $id=[string](Get-AuxProperty $Document 'id');$nsu=ConvertTo-AuxNsu ([string](Get-AuxProperty $Document 'nsu')) $Source
    if($id -cnotmatch '^\d{15,19}-[0-9a-f]{16}$' -or $id.Split('-')[0] -cne $nsu){throw 'AUX_DOCUMENT_ID_INVALID'}
    try{$bytes=[Convert]::FromBase64String([string](Get-AuxProperty $Document 'xmlBase64'))}catch{throw 'AUX_DOCUMENT_INTEGRITY_INVALID'}
    $hash=[Security.Cryptography.SHA256]::Create()
    try{$sha=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
    if($sha -cne [string](Get-AuxProperty $Document 'sha256') -or $id -cne ($nsu+'-'+$sha.Substring(0,16))){throw 'AUX_DOCUMENT_INTEGRITY_INVALID'}
}
function Save-AuxDocument([string]$Path,[string]$Folder,$Document,[string]$Source){
    Assert-AuxDocument $Document $Source
    $id=[string]$Document.id
    $folders=@('archive','outbox','scope-excluded','scope-pending-date','unhandled','unhandled-pending')
    if($Folder -notin $folders){throw 'AUX_FOLDER_INVALID'}
    foreach($oldFolder in $folders){
        $existing=Join-Path (Join-Path $Path $oldFolder) ($id+'.json')
        if(-not [IO.File]::Exists($existing)){continue}
        $old=Read-AuxJson $existing
        if([string]$old.sha256 -cne [string]$Document.sha256 -or [string]$old.xmlBase64 -cne [string]$Document.xmlBase64){throw 'AUX_DOCUMENT_CONFLICT'}
        if($oldFolder -ceq 'archive'){return}
    }
    $destination=Join-Path (Join-Path $Path $Folder) ($id+'.json')
    Write-AtomicJson $destination $Document
    foreach($oldFolder in $folders){
        if($oldFolder -ceq $Folder -or $oldFolder -ceq 'archive'){continue}
        $oldPath=Join-Path (Join-Path $Path $oldFolder) ($id+'.json')
        if([IO.File]::Exists($oldPath)){[IO.File]::Delete($oldPath)}
    }
}
function Set-AuxScope([string]$Path,[object[]]$Incoming,[string]$MinimumIssueDate,[DateTimeOffset]$Now,[scriptblock]$Scope,[string]$Source){
    $stored=@(Get-AuxStoredDocuments $Path);$evidence=@($stored)+@($Incoming)
    $candidates=@{}
    foreach($doc in @($stored)+@($Incoming)){$candidates[[string]$doc.id]=$doc}
    foreach($doc in $candidates.Values){
        if([IO.File]::Exists((Join-Path (Join-Path $Path 'archive') ($doc.id+'.json')))){continue}
        try{$disposition=[string](& $Scope $doc $evidence $MinimumIssueDate $Now)}catch{throw 'AUX_SCOPE_FAILED'}
        $folder=switch -CaseSensitive ($disposition){'READY'{'outbox'};'BEFORE_SCOPE'{'scope-excluded'};'PENDING_DATE'{'scope-pending-date'};'FUTURE_DATE'{'scope-pending-date'};default{throw 'AUX_SCOPE_DISPOSITION_INVALID'}}
        Save-AuxDocument $Path $folder $doc $Source
    }
}
function Get-AuxOutboxBatch([string]$Path){
    $folder=Join-Path $Path 'outbox'
    if(-not [IO.Directory]::Exists($folder)){return}
    $files=@(Get-ChildItem -LiteralPath $folder -Filter '*.json' -File | Sort-Object @{Expression={[long]($_.BaseName.Split('-')[0])}},Name)
    $count=0;$size=256
    foreach($file in $files){
        if($count -ge 10){break}
        $doc=Read-AuxJson $file.FullName
        $length=[Text.Encoding]::UTF8.GetByteCount(($doc|ConvertTo-Json -Depth 35 -Compress))+1
        if($size+$length -gt 1500000){if($count -eq 0){throw 'AUX_DOCUMENT_TOO_LARGE'};break}
        $count++;$size+=$length;Write-Output $doc
    }
}
function Confirm-AuxBatch([string]$Path,[object[]]$Documents,$Receipt){
    $expected=@($Documents|ForEach-Object {[string]$_.id})
    $actual=@((Get-AuxProperty $Receipt 'acknowledgedIds')|Where-Object {$null -ne $_})
    if((Get-AuxProperty $Receipt 'source') -cne 'SEFAZ' -or $actual.Count -ne $expected.Count -or @($actual|Select-Object -Unique).Count -ne $actual.Count){throw 'AUX_ACK_INVALID'}
    foreach($id in $expected){if($actual -cnotcontains $id){throw 'AUX_ACK_INVALID'}}
    [IO.Directory]::CreateDirectory((Join-Path $Path 'archive'))|Out-Null
    foreach($id in $expected){
        if($id -cnotmatch '^\d{15,19}-[0-9a-f]{16}$'){throw 'AUX_DOCUMENT_ID_INVALID'}
        $from=Join-Path (Join-Path $Path 'outbox') ($id+'.json');$to=Join-Path (Join-Path $Path 'archive') ($id+'.json')
        if([IO.File]::Exists($to)){
            if((Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash -cne (Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash){throw 'AUX_DOCUMENT_CONFLICT'}
            [IO.File]::Delete($from)
        }else{[IO.File]::Move($from,$to)}
    }
}
function Save-AuxResponse([string]$Path,$Journal,$State,[string]$Source,$Config,[DateTimeOffset]$Now,[scriptblock]$Parse,[scriptblock]$Scope,[string]$MinimumIssueDate,[scriptblock]$Clock){
    $previous=ConvertTo-AuxNsu ([string](Get-AuxProperty $Journal 'previousNsu')) $Source
    if([long]$previous -gt [long]$State.lastNsu){throw 'AUX_JOURNAL_CURSOR_INVALID'}
    $body=[string](Get-AuxProperty $Journal 'body')
    if([string]::IsNullOrWhiteSpace($body)){throw 'AUX_RESPONSE_EMPTY'}
    $hash=[Security.Cryptography.SHA256]::Create()
    try{$rawSha=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($body)))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
    $requestedAt=[DateTimeOffset]::Parse([string](Get-AuxProperty $Journal 'requestedAt'),[Globalization.CultureInfo]::InvariantCulture)
    $rawName=$requestedAt.UtcDateTime.ToString('yyyyMMddTHHmmssfffffff')+'-'+$previous+'-'+$rawSha.Substring(0,16)+'.json'
    Write-AtomicJson (Join-Path (Join-Path $Path 'raw') $rawName) $Journal
    try{$batch=& $Parse $body ([string]$Config.companyCnpj)}catch{throw 'AUX_PARSE_FAILED'}
    $status=[string](Get-AuxProperty $batch 'status')
    $documents=@((Get-AuxProperty $batch 'documents')|Where-Object {$null -ne $_})
    $unhandled=@((Get-AuxProperty $batch 'unhandledDocuments')|Where-Object {$null -ne $_})
    $accepted=if($Source -ceq 'CTE'){$status -in @('137','138')}else{$status -in @('DOCUMENTOS_LOCALIZADOS','NENHUM_DOCUMENTO_LOCALIZADO')}
    if(-not $accepted){
        if($documents.Count+$unhandled.Count -gt 0){throw 'AUX_REJECTION_WITH_DOCUMENTS'}
        $hint=[string](Get-AuxProperty $batch 'lastNsu')
        if(-not [string]::IsNullOrWhiteSpace($hint)){
            $hint=ConvertTo-AuxNsu $hint $Source
            if([long]$hint -gt [long]$State.lastNsu){$State.serverNsuHint=$hint}
        }
        $rejectedAt=[DateTimeOffset](& $Clock)
        $State.status=$status;$State.hasMore=$false;$State.awaitingCompletion=$false;$State.nextAllowedAt=$rejectedAt.AddMinutes(65).ToString('o')
        Write-AtomicJson (Join-Path $Path 'state.json') $State
        [IO.File]::Delete((Join-Path $Path 'pending-response.json'))
        Write-AuxLog $Path $Source 'REJECTED' $Now
        return [pscustomobject]@{rejected=$true;staged=0;unhandled=0}
    }
    $last=[string](Get-AuxProperty $batch 'lastNsu')
    if([string]::IsNullOrWhiteSpace($last)){
        if($Source -cne 'NFSE' -or $documents.Count+$unhandled.Count -gt 0){throw 'AUX_RESPONSE_CURSOR_MISSING'}
        $last=[string]$State.lastNsu
    }else{$last=ConvertTo-AuxNsu $last $Source}
    if([long]$last -lt [long]$State.lastNsu){throw 'AUX_CURSOR_REGRESSION'}
    $max=[string](Get-AuxProperty $batch 'maxNsu')
    if(-not [string]::IsNullOrWhiteSpace($max)){$max=ConvertTo-AuxNsu $max $Source;if([long]$last -gt [long]$max){throw 'AUX_RESPONSE_CURSOR_INVALID'}}else{$max=$null}
    $all=@(@($documents)+@($unhandled)|Sort-Object @{Expression={[long]$_.nsu}})
    $lastSeen=[long]$previous;$ids=@{}
    foreach($doc in $all){
        Assert-AuxDocument $doc $Source
        if([long]$doc.nsu -le $lastSeen -or [long]$doc.nsu -gt [long]$last -or $ids.ContainsKey([string]$doc.id)){throw 'AUX_DOCUMENT_SEQUENCE_INVALID'}
        $ids[[string]$doc.id]=$true;$lastSeen=[long]$doc.nsu
    }
    if($all.Count -gt 0 -and $lastSeen -ne [long]$last){throw 'AUX_RESPONSE_CURSOR_INVALID'}
    $more=if($Source -ceq 'CTE'){$status -ceq '138' -and $null -ne $max -and [long]$last -lt [long]$max}else{[bool](Get-AuxProperty $batch 'hasMore' ($status -ceq 'DOCUMENTOS_LOCALIZADOS'))}
    if($more -and $all.Count -eq 0){throw 'AUX_RESPONSE_WITHOUT_PROGRESS'}
    foreach($doc in $unhandled){
        $folder=if([bool](Get-AuxProperty $doc 'pendingInterpretation' $true)){'unhandled-pending'}else{'unhandled'}
        Save-AuxDocument $Path $folder $doc $Source
    }
    Set-AuxScope $Path $documents $MinimumIssueDate $Now $Scope $Source
    $State.lastNsu=$last;$State.maxNsu=$max;$State.status=$status;$State.hasMore=$more;$State.awaitingCompletion=(-not $more)
    Write-AtomicJson (Join-Path $Path 'state.json') $State
    [IO.File]::Delete((Join-Path $Path 'pending-response.json'))
    Write-AuxLog $Path $Source 'RESPONSE_STAGED' $Now $all.Count
    return [pscustomobject]@{rejected=$false;staged=$documents.Count;unhandled=$unhandled.Count}
}
function New-AuxResult([string]$Source,[string]$Status,$State,$Stats){
    return [pscustomobject]@{source=$Source;status=$Status;lastNsu=$State.lastNsu;lastCompletedSlot=$State.lastCompletedSlot;lastCompletedScheduledSlot=$State.lastCompletedScheduledSlot;lastCompletedManualSlot=$State.lastCompletedManualSlot;pendingSlot=$State.pendingSlot;requests=$Stats.requests;staged=$Stats.staged;delivered=$Stats.delivered;unhandled=$Stats.unhandled}
}
function Invoke-AuxiliaryFiscalSource {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][ValidateSet('CTE','NFSE')][string]$Source,[Parameter(Mandatory=$true)]$Config,[Parameter(Mandatory=$true)][string]$DataPath,
        [Parameter(Mandatory=$true)][string]$Slot,[scriptblock]$SendBatch,[DateTimeOffset]$Now=[DateTimeOffset]::UtcNow,[ValidateRange(1,200)][int]$MaxBatches=20,[switch]$StageOnly,
        [scriptblock]$Request,[scriptblock]$Parse,[scriptblock]$Scope,$WorkerConfig,[scriptblock]$Clock)
    $Source=$Source.ToUpperInvariant()
    if($null -eq $Clock){
        $clockOrigin=$Now;$elapsed=[Diagnostics.Stopwatch]::StartNew()
        $Clock={return $clockOrigin.Add($elapsed.Elapsed)}.GetNewClosure()
    }
    if($Slot -cmatch '^manual:[a-f0-9]{32}$'){
        # A manual request has its own durable identity; it cannot be satisfied
        # by a completed daily slot, and still shares the source cooldown.
    }else{
        if($Slot -cnotmatch '^\d{4}-\d{2}-\d{2}-\d{2}$'){throw 'AUX_SLOT_INVALID'}
        $null=[DateTime]::ParseExact($Slot,'yyyy-MM-dd-HH',[Globalization.CultureInfo]::InvariantCulture)
    }
    [IO.Directory]::CreateDirectory($DataPath)|Out-Null
    $lock=$null
    try{$lock=[IO.File]::Open((Join-Path $DataPath 'worker.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch [IO.IOException]{return [pscustomobject]@{source=$Source;status='LOCK_BUSY'}}
    $state=$null;$stats=[ordered]@{requests=0;staged=0;delivered=0;unhandled=0}
    try{
        $state=Read-AuxState $DataPath $Source
        $minimum=[string](Get-AuxProperty $Config 'minimumIssueDate' (Get-AuxProperty $WorkerConfig 'minimumIssueDate' '2026-10-01'))
        $null=[DateTime]::ParseExact($minimum,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
        if($null -eq $Scope){$Scope={param($Document,$Evidence,$MinimumIssueDate,$Now)Import-Module (Join-Path $PSScriptRoot 'FiscalDocuments.psm1') -DisableNameChecking;Get-FiscalDocumentScopeDisposition $Document $Evidence $MinimumIssueDate $Now}}
        if($null -eq $Request){
            if($Source -ceq 'CTE'){$Request={param($Config,$LastNsu)Import-Module (Join-Path $PSScriptRoot 'Cte.psm1') -DisableNameChecking;Invoke-CteDistribution $Config $LastNsu}}
            else{$Request={param($Config,$LastNsu)Import-Module (Join-Path $PSScriptRoot 'Nfse.psm1') -DisableNameChecking;Invoke-NfseDistribution $Config $LastNsu}}
        }
        if($null -eq $Parse){
            if($Source -ceq 'CTE'){$Parse={param($Body,$CompanyCnpj)Import-Module (Join-Path $PSScriptRoot 'Cte.psm1') -DisableNameChecking;ConvertFrom-CteDistributionResponse $Body $CompanyCnpj}}
            else{$Parse={param($Body,$CompanyCnpj)Import-Module (Join-Path $PSScriptRoot 'Nfse.psm1') -DisableNameChecking;ConvertFrom-NfseDistributionResponse $Body $CompanyCnpj}}
        }
        if($null -eq $SendBatch){
            if($null -eq $WorkerConfig){$WorkerConfig=Read-AuxJson (Join-Path $PSScriptRoot '../config/worker.json')}
            $notificationRoot=[string](Get-AuxProperty $WorkerConfig 'notificationRoot' (Join-Path $env:LOCALAPPDATA 'Energetica/SefazLive/notifications'))
            $SendBatch={param($Documents)Import-Module (Join-Path $PSScriptRoot 'FlowTransport.psm1') -DisableNameChecking;Send-SefazBatch -Documents $Documents -FlowId $WorkerConfig.flowId -EnvironmentId $WorkerConfig.environmentId -NotificationRoot $notificationRoot}
        }
        $pages=0
        while($true){
            $pending=Join-Path $DataPath 'pending-response.json'
            if([IO.File]::Exists($pending)){
                if([string]::IsNullOrWhiteSpace([string]$state.pendingSlot)){$state.pendingSlot=$Slot;Write-AtomicJson (Join-Path $DataPath 'state.json') $state}
                $outcome=Save-AuxResponse $DataPath (Read-AuxJson $pending) $state $Source $Config $Now $Parse $Scope $minimum $Clock
                $pages++;$stats.staged+=$outcome.staged;$stats.unhandled+=$outcome.unhandled
                if($outcome.rejected){return New-AuxResult $Source 'REJECTED' $state $stats}
            }
            Set-AuxScope $DataPath @() $minimum $Now $Scope $Source
            $outboxFolder=Join-Path $DataPath 'outbox'
            $hasOutbox=[IO.Directory]::Exists($outboxFolder) -and @(Get-ChildItem -LiteralPath $outboxFolder -Filter '*.json' -File).Count -gt 0
            if($StageOnly -and ($hasOutbox -or $pages -gt 0)){return New-AuxResult $Source 'STAGED' $state $stats}
            $outbox=@(Get-AuxOutboxBatch $DataPath)
            while($outbox.Count -gt 0){
                try{$receipt=& $SendBatch $outbox}catch{throw 'AUX_DELIVERY_FAILED'}
                Confirm-AuxBatch $DataPath $outbox $receipt
                $stats.delivered+=$outbox.Count
                Write-AuxLog $DataPath $Source 'DELIVERY_CONFIRMED' $Now $outbox.Count
                $outbox=@(Get-AuxOutboxBatch $DataPath)
            }
            $currentNow=[DateTimeOffset](& $Clock)
            if(-not [string]::IsNullOrWhiteSpace([string]$state.pendingSlot) -and -not $state.hasMore -and $state.awaitingCompletion){
                if($state.pendingSlot.StartsWith('manual:')){$state.lastCompletedManualSlot=$state.pendingSlot}else{$state.lastCompletedScheduledSlot=$state.pendingSlot}
                $state.lastCompletedSlot=$state.pendingSlot;$state.pendingSlot=$null;$state.status='COMPLETED';$state.awaitingCompletion=$false;$state.nextAllowedAt=$currentNow.AddMinutes(65).ToString('o')
                Write-AtomicJson (Join-Path $DataPath 'state.json') $state
                Write-AuxLog $DataPath $Source 'SLOT_COMPLETED' $Now
                return New-AuxResult $Source 'COMPLETED' $state $stats
            }
            if($state.hasMore -and -not [string]::IsNullOrWhiteSpace([string]$state.pendingSlot)){
                $state.nextAllowedAt=$currentNow.ToString('o');Write-AtomicJson (Join-Path $DataPath 'state.json') $state
                if($pages -ge $MaxBatches){return New-AuxResult $Source 'PAGE_LIMIT' $state $stats}
            }elseif(($Slot.StartsWith('manual:') -and $state.lastCompletedManualSlot -ceq $Slot) -or (-not $Slot.StartsWith('manual:') -and $state.lastCompletedScheduledSlot -ceq $Slot)){return New-AuxResult $Source 'ALREADY_COMPLETED' $state $stats}
            if($null -ne $state.nextAllowedAt -and [DateTimeOffset]::Parse([string]$state.nextAllowedAt) -gt $currentNow){return New-AuxResult $Source 'COOLDOWN' $state $stats}
            if([string]::IsNullOrWhiteSpace([string]$state.pendingSlot)){$state.pendingSlot=$Slot}
            # A continuation authorizes only the next reserved attempt. Once it
            # starts, an unknown/network failure must retain the full cooldown.
            $attemptNow=[DateTimeOffset](& $Clock)
            $state.status='REQUEST_RESERVED';$state.hasMore=$false;$state.awaitingCompletion=$false;$state.nextAllowedAt=$attemptNow.AddMinutes(65).ToString('o')
            Write-AtomicJson (Join-Path $DataPath 'state.json') $state
            Write-AuxLog $DataPath $Source 'REQUEST_RESERVED' $Now
            $previous=[string]$state.lastNsu
            $stats.requests++
            try{$body=[string](& $Request $Config $previous)}catch{throw 'AUX_REQUEST_FAILED'}
            $journal=[ordered]@{previousNsu=$previous;requestedAt=$attemptNow.ToString('o');body=$body}
            Write-AtomicJson $pending $journal
        }
    }catch{
        $code=Get-AuxErrorCode $_
        if($null -ne $state){$state.status=$code;Write-AtomicJson (Join-Path $DataPath 'state.json') $state}
        Write-AuxLog $DataPath $Source $code $Now
        throw $code
    }finally{if($null -ne $lock){$lock.Dispose()}}
}
function Invoke-AuxiliaryFiscalScheduledCycle {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)]$Config,[Parameter(Mandatory=$true)]$WorkerConfig,[string]$DataRoot,[DateTimeOffset]$Now=[DateTimeOffset]::UtcNow,[ValidateRange(1,200)][int]$MaxBatches=20,[scriptblock]$SourceInvoker)
    $cycleElapsed=[Diagnostics.Stopwatch]::StartNew()
    if([string]::IsNullOrWhiteSpace($DataRoot)){$DataRoot=Join-Path (Join-Path $env:LOCALAPPDATA 'Energetica/SefazAuxLive') (([string]$Config.companyCnpj)+'-'+([string]$Config.environment))}
    $hours=@(Get-AuxProperty $Config 'scheduleHours' (Get-AuxProperty $WorkerConfig 'scheduleHours' @(9,15,20)))
    if($hours.Count -eq 0 -or @($hours|Where-Object {[string]$_ -cnotmatch '^\d{1,2}$' -or [int]$_ -gt 23}).Count -gt 0){throw 'AUX_SCHEDULE_INVALID'}
    try{$zone=[TimeZoneInfo]::FindSystemTimeZoneById('E. South America Standard Time')}catch{$zone=[TimeZoneInfo]::FindSystemTimeZoneById('America/Sao_Paulo')}
    $brt=[TimeZoneInfo]::ConvertTime($Now,$zone)
    $due=$null
    foreach($day in @($brt.Date.AddDays(-1),$brt.Date)){
        foreach($hour in @($hours|ForEach-Object {[int]$_}|Sort-Object -Unique)){$candidate=$day.AddHours($hour);if($candidate -le $brt.DateTime){$due=$candidate}}
    }
    $slot=$due.ToString('yyyy-MM-dd-HH',[Globalization.CultureInfo]::InvariantCulture)
    if($null -eq $SourceInvoker){$SourceInvoker={param($Source,$Config,$DataPath,$Slot,$WorkerConfig,$Now,$MaxBatches)Invoke-AuxiliaryFiscalSource -Source $Source -Config $Config -DataPath $DataPath -Slot $Slot -WorkerConfig $WorkerConfig -Now $Now -MaxBatches $MaxBatches}}
    $results=New-Object 'Collections.Generic.List[object]'
    foreach($source in @('CTE','NFSE')){
        $path=Join-Path $DataRoot $source
        try{
            $state=Read-AuxState $path $source
            $pending=[IO.File]::Exists((Join-Path $path 'pending-response.json')) -or -not [string]::IsNullOrWhiteSpace([string]$state.pendingSlot)
            foreach($folder in @('outbox','scope-pending-date')){$directory=Join-Path $path $folder;if([IO.Directory]::Exists($directory) -and @(Get-ChildItem -LiteralPath $directory -Filter '*.json' -File).Count -gt 0){$pending=$true}}
            if($state.lastCompletedScheduledSlot -ceq $slot -and -not $pending){$results.Add([pscustomobject]@{source=$source;status='ALREADY_COMPLETED'});continue}
            $sourceNow=$Now.Add($cycleElapsed.Elapsed)
            $result=& $SourceInvoker -Source $source -Config $Config -DataPath $path -Slot $slot -WorkerConfig $WorkerConfig -Now $sourceNow -MaxBatches $MaxBatches
            $results.Add($result)
        }catch{$results.Add([pscustomobject]@{source=$source;status='FAILED';code=(Get-AuxErrorCode $_)})}
    }
    return [pscustomobject]@{slot=$slot;results=@($results.ToArray())}
}
Export-ModuleMember -Function Invoke-AuxiliaryFiscalSource,Invoke-AuxiliaryFiscalScheduledCycle
