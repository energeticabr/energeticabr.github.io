Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Sefaz.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'Danfe.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'SefazWhatsApp.psm1')
Import-Module (Join-Path $PSScriptRoot 'FiscalDocuments.psm1') -DisableNameChecking
. (Join-Path $PSScriptRoot '../scripts/PowerPlatform-Session.ps1')
function Assert-SefazReceipt($Receipt,[string[]]$ExpectedIds){
    if($null -eq $Receipt -or $Receipt.source -ne 'SEFAZ'){throw 'FLOW_RECEIPT_SOURCE_INVALID'}
    $actual=@($Receipt.acknowledgedIds)
    if($actual.Count -ne $ExpectedIds.Count -or @($actual|Select-Object -Unique).Count -ne $actual.Count){throw 'FLOW_RECEIPT_IDS_INVALID'}
    foreach($id in $ExpectedIds){if($actual -cnotcontains $id){throw 'FLOW_RECEIPT_INCOMPLETE'}}
    if($Receipt.PSObject.Properties['createdItemIds']){
        if($Receipt.createdItemIds -isnot [array]){throw 'FLOW_RECEIPT_CREATED_IDS_INVALID'}
        foreach($id in $Receipt.createdItemIds){
            if(($id -isnot [int] -and $id -isnot [long]) -or $id -le 0 -or $id -gt 9007199254740991){throw 'FLOW_RECEIPT_CREATED_IDS_INVALID'}
        }
    }
}
function ConvertTo-ValidatedSefazBatch([object[]]$Documents){
    if($Documents.Count -gt 10){throw 'FLOW_BATCH_TOO_LARGE'}
    $ids=@{}
    foreach($document in $Documents){
        if([string]$document.nsu -notmatch '^\d{15,19}$'){throw 'FLOW_DOCUMENT_NSU_INVALID'}
        $normalized=Assert-FiscalDocumentIntegrity $document
        if($normalized.id -cne $document.id -or $normalized.sha256 -cne $document.sha256 -or $normalized.key -cne $document.key -or $normalized.fileName -cne $document.fileName -or $normalized.kind -cne $document.kind){throw 'FLOW_DOCUMENT_INTEGRITY_INVALID'}
        if($ids.ContainsKey($normalized.id)){throw 'FLOW_DOCUMENT_DUPLICATE'}
        $ids[$normalized.id]=$true
        Write-Output $normalized
    }
}
function Complete-SefazFlowDelivery([object[]]$Documents,$Receipt,[string]$RunId,$NotifierConfig,[string]$NotificationRoot){
    $expected=@($Documents|ForEach-Object {$_.id})
    Assert-SefazReceipt $Receipt $expected
    if($null -ne $NotifierConfig -and $NotifierConfig.PSObject.Properties['whatsappEnabled'] -and $NotifierConfig.whatsappEnabled -eq $true){
        # Only local durable persistence belongs to the fiscal ACK path. SSH and
        # WhatsApp are drained independently, including during SEFAZ cooldown.
        Save-SefazWhatsAppNotification $Documents $Receipt $NotificationRoot
    }
    $result=[ordered]@{source='SEFAZ';acknowledgedIds=@($Receipt.acknowledgedIds);runId=$RunId}
    if($Receipt.PSObject.Properties['createdItemIds']){$result.createdItemIds=@($Receipt.createdItemIds|Select-Object -Unique)}
    return [pscustomobject]$result
}
function Test-SefazReceiptActionMissing($Failure){
    $status=$null
    $exception=$Failure.Exception
    $responseProperty=$exception.PSObject.Properties['Response']
    if($null -ne $responseProperty -and $null -ne $responseProperty.Value){
        $statusProperty=$responseProperty.Value.PSObject.Properties['StatusCode']
        if($null -ne $statusProperty){$status=[int]$statusProperty.Value}
    }
    if($null -eq $status){
        $statusProperty=$exception.PSObject.Properties['StatusCode']
        if($null -ne $statusProperty -and $null -ne $statusProperty.Value){$status=[int]$statusProperty.Value}
    }
    if($status -notin @(404,500)){return $false}
    $code=$null
    $message=$null
    if($null -ne $Failure.ErrorDetails -and -not [string]::IsNullOrWhiteSpace($Failure.ErrorDetails.Message)){
        try{
            $detail=$Failure.ErrorDetails.Message|ConvertFrom-Json -ErrorAction Stop
            if($detail.PSObject.Properties['error'] -and $null -ne $detail.error -and $detail.error.PSObject.Properties['code']){
                $code=[string]$detail.error.code
                if($detail.error.PSObject.Properties['message']){$message=[string]$detail.error.message}
            }
            elseif($detail.PSObject.Properties['code']){$code=[string]$detail.code}
        }catch{# An unstructured HTTP404 can still be eventual action visibility.
        }
    }
    if($code -ceq 'AzureResourceManagerRequestFailed'){
        # Flow can wrap the ARM404 as an outer500. Parse the actual nested JSON;
        # mentioning the code in arbitrary text must never authorize a retry.
        $prefix='Request to Azure Resource Manager failed with error: '
        if($null -eq $message -or -not $message.StartsWith($prefix,[StringComparison]::Ordinal)){return $false}
        $payload=$message.Substring($prefix.Length).Trim()
        if($payload.EndsWith("'.")){$payload=$payload.Substring(0,$payload.Length-1)}
        if($payload.Length -gt 1 -and $payload[0] -eq [char]39 -and $payload[$payload.Length-1] -eq [char]39){$payload=$payload.Substring(1,$payload.Length-2)}
        try{
            $nested=$payload|ConvertFrom-Json -ErrorAction Stop
            return $null -ne $nested -and $nested.PSObject.Properties['error'] -and $null -ne $nested.error -and $nested.error.PSObject.Properties['code'] -and [string]$nested.error.code -ceq 'WorkflowRunActionNotFound'
        }catch{return $false}
    }
    # Other structured404s (for example a missing workflow) are not this race.
    return $status -eq 404 -and ([string]::IsNullOrWhiteSpace($code) -or $code -ceq 'WorkflowRunActionNotFound')
}
function Get-SefazReceiptAction {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][string]$RunBase,[Parameter(Mandatory=$true)][Collections.IDictionary]$Headers,
        [ValidateRange(1,60)][int]$WaitSeconds=30,[ValidateRange(0.1,10)][double]$RetryDelaySeconds=3,
        [scriptblock]$Read,[scriptblock]$Delay,[scriptblock]$Now)
    if($null -eq $Read){$Read={param($Uri,$RequestHeaders,$TimeoutSec)Invoke-RestMethod -Uri $Uri -Headers $RequestHeaders -TimeoutSec $TimeoutSec}}
    if($null -eq $Delay){$Delay={param($Seconds)Start-Sleep -Milliseconds ([int][Math]::Ceiling($Seconds*1000))}}
    if($null -eq $Now){$Now={[DateTimeOffset]::UtcNow}}
    $deadline=([DateTimeOffset](& $Now)).AddSeconds($WaitSeconds)
    $uri=$RunBase.TrimEnd('/')+'/actions/Recibo?api-version=2016-11-01'
    do{
        $remaining=($deadline-([DateTimeOffset](& $Now))).TotalSeconds
        if($remaining -le 0){throw 'FLOW_RECEIPT_ACTION_WAIT_TIMEOUT'}
        # Each GET also fits the remaining budget; no trigger is part of this helper.
        $timeout=[int][Math]::Max(1,[Math]::Min(5,[Math]::Ceiling($remaining)))
        try{return (& $Read $uri $Headers $timeout)}catch{if(-not (Test-SefazReceiptActionMissing $_)){throw}}
        $remaining=($deadline-([DateTimeOffset](& $Now))).TotalSeconds
        if($remaining -le 0){throw 'FLOW_RECEIPT_ACTION_WAIT_TIMEOUT'}
        $null=& $Delay ([Math]::Min($RetryDelaySeconds,$remaining))
    }while($true)
}
function Send-SefazBatch {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][AllowEmptyCollection()][object[]]$Documents,[Parameter(Mandatory=$true)][string]$FlowId,[Parameter(Mandatory=$true)][string]$EnvironmentId,
        [string]$NotificationRoot=(Join-Path $env:LOCALAPPDATA 'Energetica/SefazLive/notifications'))
    if($FlowId -notmatch '^[0-9a-f-]{36}$' -or $EnvironmentId -notmatch '^[A-Za-z0-9-]+$'){throw 'FLOW_IDENTIFIER_INVALID'}
    $normalized=@(ConvertTo-ValidatedSefazBatch $Documents)
    $rendererConfig=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../config/worker.json') -Raw|ConvertFrom-Json
    if($rendererConfig.PSObject.Properties['minimumIssueDate']){
        foreach($doc in @($normalized|Where-Object {$_.kind -in @('nfeProc','resNFe','cteProc','cteOSProc','cteSimpProc','NFSe')})){
            if((Get-FiscalDocumentScopeDisposition $doc @() ([string]$rendererConfig.minimumIssueDate) ([DateTimeOffset]::UtcNow)) -ne 'READY'){throw 'FLOW_DOCUMENT_OUTSIDE_SCOPE'}
        }
    }
    if(@($normalized|Where-Object {$_.kind -in @('nfeProc','cteProc','cteOSProc','cteSimpProc','NFSe')}).Count -gt 0){
        $normalized=@($normalized|ForEach-Object {Add-SefazDanfe $_ $rendererConfig})
    }
    $expected=@($normalized|ForEach-Object{$_.id})
    $token=Get-PowerPlatformSessionToken -Resource 'https://service.powerapps.com'
    $base='https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/'+$EnvironmentId
    $auth=@{Authorization=('Bearer '+$token)}
    $connector=Invoke-RestMethod -Uri ($base+'/apis/shared_logicflows?api-version=2016-11-01') -Headers $auth -TimeoutSec 60
    $runtime=[Uri]$connector.properties.primaryRuntimeUrl
    if($runtime.Scheme -ne 'https' -or $runtime.Host -notlike '*.azure-apihub.net' -or $runtime.AbsolutePath -ne '/apim/logicflows'){throw 'FLOW_RUNTIME_UNTRUSTED'}
    $hub=Get-PowerPlatformSessionToken -Resource 'https://apihub.azure.com'
    $payload=[ordered]@{source='SEFAZ';companyCnpj='38626750000146';documents=@($normalized)}|ConvertTo-Json -Depth 35 -Compress
    $reply=Invoke-WebRequest -Uri ($runtime.AbsoluteUri.TrimEnd('/')+'/'+$FlowId+'/triggers/manual/run?api-version=2016-11-01') -Method Post -Headers @{Authorization=('Bearer '+$hub)} -ContentType application/json -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 90 -UseBasicParsing
    if([int]$reply.StatusCode -notin @(200,202)){throw 'FLOW_TRIGGER_NOT_ACCEPTED'}
    $runId=[string](@($reply.Headers['x-ms-workflow-run-id'])[0])
    if($runId -notmatch '^[A-Za-z0-9]+$'){throw 'FLOW_RUN_ID_MISSING'}
    $runBase=$base+'/flows/'+$FlowId+'/runs/'+$runId
    $deadline=[DateTimeOffset]::UtcNow.AddMinutes(5)
    do{
        $run=Invoke-RestMethod -Uri ($runBase+'?api-version=2016-11-01') -Headers $auth -TimeoutSec 60
        $status=$run.properties.status
        if($status -eq 'Succeeded'){break}
        if($status -in @('Failed','Cancelled','TimedOut','Aborted','Suspended')){throw ('FLOW_RUN_'+$status.ToUpperInvariant())}
        if([DateTimeOffset]::UtcNow -ge $deadline){throw 'FLOW_RUN_WAIT_TIMEOUT'}
        Start-Sleep -Seconds 3
    }while($true)
    $action=Get-SefazReceiptAction -RunBase $runBase -Headers $auth
    $link=[Uri]$action.properties.outputsLink.uri
    if($link.Scheme -ne 'https'){throw 'FLOW_RECEIPT_LOCATION_INVALID'}
    # Link de conteudo devolvido pela API autenticada; nenhum bearer e encaminhado.
    $receipt=Invoke-RestMethod -Uri $link.AbsoluteUri -TimeoutSec 60
    return Complete-SefazFlowDelivery $normalized $receipt $runId $rendererConfig $NotificationRoot
}
Export-ModuleMember -Function Send-SefazBatch,Assert-SefazReceipt,ConvertTo-ValidatedSefazBatch,Complete-SefazFlowDelivery,Get-SefazReceiptAction
