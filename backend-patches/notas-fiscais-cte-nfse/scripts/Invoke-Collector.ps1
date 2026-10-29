[CmdletBinding()]
param(
    [ValidateSet('Collect','Acknowledge','Inspect')][string]$Command='Inspect',
    [string]$PayloadBase64='e30=',
    [string]$ConfigPath=(Join-Path $PSScriptRoot '../config/energetica.json'),
    [string]$DataRoot=(Join-Path $env:LOCALAPPDATA 'Energetica/Sefaz')
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/Sefaz.psm1') -Force -DisableNameChecking
$cfg=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$minimumIssueDate=if($cfg.PSObject.Properties['minimumIssueDate']){[string]$cfg.minimumIssueDate}else{''}
if($cfg.companyCnpj -notmatch '^[A-Z0-9]{12}\d{2}$' -or $cfg.environment -notin @('1','2')){throw 'CNPJ/ambiente invalidos.'}
$dataPath=Join-Path $DataRoot ($cfg.companyCnpj+'-'+$cfg.environment)
$inputPayload=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64))|ConvertFrom-Json
if($Command -eq 'Inspect'){
    $cert=Get-CompanyCertificate $cfg
    [ordered]@{status='CERTIFICADO_LOCALIZADO';companyCnpj=$cfg.companyCnpj;certificateSubject=$cert.Subject;certificateValidUntil=$cert.NotAfter.ToString('o');hasPrivateKey=$cert.HasPrivateKey;privateKeyExported=$false;dataPath=$dataPath;initialNsuConfigured=($null -ne $cfg.initialNsu)} | ConvertTo-Json -Compress
    exit 0
}
[IO.Directory]::CreateDirectory($dataPath)|Out-Null
$lockPath=Join-Path $dataPath 'collector.lock'
try{$lock=New-Object IO.FileStream($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch{throw 'Outra coleta esta em execucao. Aguarde.'}
try{
    if($Command -eq 'Acknowledge'){
        if(-not $inputPayload.PSObject.Properties['ids']){throw 'Acknowledge exige ids[].'}
        Confirm-Documents $dataPath @($inputPayload.ids)
        [ordered]@{status='ACKNOWLEDGED';ids=@($inputPayload.ids)}|ConvertTo-Json -Depth 5 -Compress
        exit 0
    }
    # Original invoice XML captured by the coordinated gap collector supplies
    # emission evidence for later events received by normal distribution.
    $scopeEvidence=@()
    $gapStaged=Join-Path (Split-Path $DataRoot -Parent) 'SefazGapRecovery/staged'
    if(Test-Path -LiteralPath $gapStaged){
        $jsonOptions=@{};if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){$jsonOptions.DateKind='String'}
        $scopeEvidence=@(Get-ChildItem -LiteralPath $gapStaged -File -Filter '*.json'|ForEach-Object{Get-Content -LiteralPath $_.FullName -Raw|ConvertFrom-Json @jsonOptions})
    }
    $scope=Set-SefazOutboxScope $dataPath $scopeEvidence $minimumIssueDate ([DateTimeOffset]::UtcNow)
    $pending=@(Get-PendingDocuments $dataPath $cfg.maxBatchDocuments $cfg.maxOutputBytes)
    $statePath=Join-Path $dataPath 'state.json'
    $state=$null
    if(Test-Path -LiteralPath $statePath){
        $jsonOptions=@{}
        if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){$jsonOptions.DateKind='String'}
        $state=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json @jsonOptions
    }
    $status='REPLAY_OUTBOX'
    if($pending.Count -eq 0){
        $now=[DateTimeOffset]::UtcNow
        if($null -ne $state -and [DateTimeOffset]::Parse($state.nextAllowedAt) -gt $now){$status='COOLDOWN'}else{
            $last=$cfg.initialNsu
            if($null -ne $state){$last=$state.lastNsu}
            if([string]::IsNullOrWhiteSpace($last)){throw 'Configure initialNsu antes da primeira coleta direta na SEFAZ. Depois disso, preservar o cursor salvo em state.json.'}
            if([string]$last -notmatch '^\d{15}$'){throw 'initialNsu deve conter exatamente 15 digitos.'}
            $hint=$null
            if($null -ne $state -and $state.status -eq '656'){
                if($state.PSObject.Properties['serverNsuHint']){$hint=[string]$state.serverNsuHint}
                elseif($last -eq '000000000000000' -and $cfg.PSObject.Properties['initialResumeNsu']){$hint=[string]$cfg.initialResumeNsu}
            }
            if(-not [string]::IsNullOrWhiteSpace($hint)){
                $plan=Get-SefazCursorPlan ([string]$last) $hint
                if($null -ne $plan.historyGapFrom){
                    $gapPath=Join-Path (Join-Path $dataPath 'history-gaps') ($plan.historyGapFrom+'-'+$plan.historyGapThrough+'.json')
                    if(-not [IO.File]::Exists($gapPath)){
                        Write-AtomicJson $gapPath ([ordered]@{status='HISTORICAL_RECOVERY_REQUIRED';source='SEFAZ';fromExclusive=$plan.historyGapFrom;throughInclusive=$plan.historyGapThrough;recordedAt=$now.ToString('o');documentsImportedFromThisRange=$false})
                    }
                    $last=$plan.requestNsu
                }
            }
            # Grava cooldown ANTES de fazer rede: inclusive timeout deixa uma tentativa registrada.
            Write-AtomicJson $statePath ([ordered]@{lastNsu=$last;nextAllowedAt=$now.AddMinutes([Math]::Max(65,$cfg.cooldownMinutes)).ToString('o');status='CONSULTA_INICIADA'})
            $response=Invoke-SefazDistribution $cfg $last
            $state=Save-DistributionBatch $response $dataPath $cfg.companyCnpj $last $now $cfg.cooldownMinutes
            $status=$state.status
            $scope=Set-SefazOutboxScope $dataPath $scopeEvidence $minimumIssueDate ([DateTimeOffset]::UtcNow)
            $pending=@(Get-PendingDocuments $dataPath $cfg.maxBatchDocuments $cfg.maxOutputBytes)
        }
    }
    [ordered]@{status=$status;documents=@($pending);state=$state;scope=$scope}|ConvertTo-Json -Depth 35 -Compress
}finally{$lock.Dispose()}
