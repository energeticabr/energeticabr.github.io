param([ValidateSet('Setup','Publish','Replay')][string]$Mode='Publish',[string]$QueueId,[string]$MessageId,
      [ValidateSet('cemig','petranet')][string]$Provider='cemig',[switch]$CreateReplay)
$ErrorActionPreference='Stop'
$authRoot='C:/Users/Bernardonotini/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/Energetica/DdaMonitor'
. (Join-Path $authRoot 'SharePointFlow.ps1')
Connect-DdaFlow
$stateFile=Join-Path $PSScriptRoot 'operational-state.local.json'
$state=if(Test-Path -LiteralPath $stateFile){Get-Content -Raw -LiteralPath $stateFile|ConvertFrom-Json -AsHashtable}else{@{}}
function Save-State {$state|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $stateFile -Encoding UTF8}
function Set-CloudFlow([string]$key,[string]$displayName,$definition,$connections){
    $body=@{properties=@{displayName=$displayName;definition=$definition;connectionReferences=$connections;flowFailureAlertSubscribed=$false}}
    $created=if($state[$key]){Invoke-DdaFlowApi ('/'+$state[$key]) 'PATCH' $body}else{Invoke-DdaFlowApi '' 'POST' $body}
    $state[$key]=$created.name;Save-State
    @{kind=$key;flowId=$created.name;state=$created.properties.state}|ConvertTo-Json -Compress|Write-Output
}
function Invoke-Cloud([string]$key,$payload){
    $cb=Invoke-DdaFlowApi ('/'+$state[$key]+'/triggers/manual/listCallbackUrl') 'POST' @{}
    if(-not $cb.response.value){throw 'CALLBACK_MISSING'}
    # Temporary maintenance flows use their signed callback in memory only.
    # They are deleted after verification; the production flow has no HTTP ingress.
    $r=Invoke-WebRequest -Uri $cb.response.value -Method POST -ContentType 'application/json' -Body ($payload|ConvertTo-Json -Compress) -TimeoutSec 120
    @{kind=$key;invokeStatus=$r.StatusCode}|ConvertTo-Json -Compress|Write-Output
}
$target=Get-Content -Raw -LiteralPath (Join-Path $authRoot 'sharepoint-target.json')|ConvertFrom-Json
$sp=Invoke-DdaFlowApi ('/'+$target.flowId)
$mail=Invoke-DdaFlowApi '/0971cad6-8449-4ddd-b643-7a94c4e683b8'
$connections=@{
    shared_sharepointonline=$sp.properties.connectionReferences.shared_sharepointonline
    shared_office365=$mail.properties.connectionReferences.shared_office365
}
if($Mode-eq'Setup'){
    if($Provider-ne'cemig'){throw 'Petranet reuses the existing durable invoice queue'}
    $actions=[ordered]@{}
    $actions.Create_queue_list=New-DdaSpAction 'POST' '_api/web/lists' @{Title='CEMIG FATURAS FILA';BaseTemplate=100;AllowContentTypes=$false;OnQuickLaunch=$false;Description='Fila dos PDFs originais Cemig Xavante para a recorrencia 33; processamento OCI.'}
    $previous='Create_queue_list'
    foreach($field in @(@('State','Text'),@('MailId','Note'),@('Result','Note'),@('NextTry','DateTime'),@('EmailReceived','DateTime'))){
        $name=$field[0];$type=$field[1]
        $xml="<Field Type='$type' Name='$name' StaticName='$name' DisplayName='$name' Required='FALSE' RichText='FALSE' />"
        $actions['Field_'+$name]=New-DdaSpAction 'POST' "_api/web/lists/getByTitle('CEMIG FATURAS FILA')/fields/createfieldasxml" @{parameters=@{SchemaXml=$xml}} @{$previous=@('Succeeded')}
        $previous='Field_'+$name
    }
    $body=New-DdaFlowPayload $actions
    $body.properties.definition.triggers.manual.kind='Http'
    $body.properties.definition.triggers.manual.inputs.method='POST'
    Set-CloudFlow 'setup' 'CEMIG XAVANTE - preparar fila de faturas' $body.properties.definition $connections
    Invoke-Cloud 'setup' @{}
} elseif($Mode-eq'Publish'){
    if(-not $QueueId){throw 'QueueId required'}
    $state.queueId=$QueueId;Save-State
    $python='C:/Users/Bernardonotini/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
    $kinds=@('event')
    if($CreateReplay){$kinds+=@('replay')}
    foreach($kind in $kinds){
        $extra=@()
        if($kind-eq'replay'){$extra=@('--replay')}
        $definition=(& $python (Join-Path $PSScriptRoot 'flow_definition.py') $QueueId --provider $Provider @extra)|ConvertFrom-Json -AsHashtable
        $key=if($Provider-eq'cemig'){$kind}else{$kind+'_'+$Provider}
        $name=if($Provider-eq'petranet'){
            if($kind-eq'event'){'PETRANET - buscar faturas diariamente - recorrencia 14'}else{'PETRANET - recuperar fatura do email'}
        }else{
            if($kind-eq'event'){'CEMIG - buscar faturas diariamente - recorrencias 4 e 33'}else{'CEMIG - recuperar fatura do email'}
        }
        Set-CloudFlow $key $name $definition $connections
    }
} else {
    if(-not $MessageId){throw 'MessageId required'}
    $key=if($Provider-eq'cemig'){'replay'}else{'replay_'+$Provider}
    Invoke-Cloud $key @{messageId=$MessageId}
}
