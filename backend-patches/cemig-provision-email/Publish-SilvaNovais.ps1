param([ValidateSet('Setup','Publish','Run')][string]$Mode='Publish')
$ErrorActionPreference='Stop'
$authRoot='C:/Users/Bernardonotini/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/Energetica/DdaMonitor'
. (Join-Path $authRoot 'SharePointFlow.ps1');Connect-DdaFlow
$statePath=Join-Path $PSScriptRoot 'silva-operational-state.local.json'
$state=if(Test-Path -LiteralPath $statePath){Get-Content -Raw -LiteralPath $statePath|ConvertFrom-Json -AsHashtable}else{@{}}
function Save-State {$state|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $statePath -Encoding utf8}
$sp=Invoke-DdaFlowApi '/8ab2e1fb-6c82-4846-a0f3-e8e609589b38'
$mail=Invoke-DdaFlowApi '/71acf1aa-81ad-40ce-aca6-dc87ec589f25'
$connections=@{shared_sharepointonline=$sp.properties.connectionReferences.shared_sharepointonline;shared_office365=$mail.properties.connectionReferences.shared_office365}
if($Mode -eq 'Setup'){
 $title='CONTABILIDADE SILVA NOVAIS FILA'
 $base="_api/web/lists/getByTitle('$title')"
 $a=[ordered]@{}
 $a.Existing=New-DdaSpAction GET "_api/web/lists?`$select=Id,Title&`$filter=Title eq '$title'"
 $a.Ensure=@{type='If';expression="@empty(body('Existing')?['value'])";runAfter=@{Existing=@('Succeeded')};actions=@{Create=(New-DdaSpAction POST '_api/web/lists' @{Title=$title;BaseTemplate=100;OnQuickLaunch=$false;Description='Emails Asaas Silva Novais exclusivamente da Energetica; vinculo diario por vencimento.'})};else=@{actions=@{}}}
 $a.Fields=New-DdaSpAction GET ($base+'/fields?$select=InternalName') $null @{Ensure=@('Succeeded')}
 $previous='Fields'
 foreach($field in @(@('State','Text'),@('MailId','Note'),@('Result','Note'),@('EmailReceived','DateTime'))){
  $name=$field[0];$type=$field[1];$filter='Has_'+$name;$ensure='Ensure_'+$name
  $a[$filter]=@{type='Query';inputs=@{from="@body('Fields')?['value']";where="@equals(item()?['InternalName'],'$name')"};runAfter=@{$previous=@('Succeeded')}}
  $xml="<Field Type='$type' Name='$name' StaticName='$name' DisplayName='$name' Required='FALSE' RichText='FALSE' />"
  $a[$ensure]=@{type='If';expression="@empty(body('$filter'))";runAfter=@{$filter=@('Succeeded')};actions=@{('Create_'+$name)=(New-DdaSpAction POST ($base+'/fields/createfieldasxml') @{parameters=@{SchemaXml=$xml}})};else=@{actions=@{}}}
  $previous=$ensure
 }
 $a.Read_list=New-DdaSpAction GET ($base+'?$select=Id,Title') $null @{$previous=@('Succeeded')}
 $a.Response=@{type='Response';kind='Http';inputs=@{statusCode=200;body=@{ready=$true;listId="@body('Read_list')?['Id']"}};runAfter=@{Read_list=@('Succeeded')}}
 $payload=New-DdaFlowPayload $a
 $payload.properties.displayName='TEMPORARIO - preparar fila Silva Novais'
 $payload.properties.connectionReferences=$connections
 $payload.properties.definition.triggers.manual.kind='Http'
 $payload.properties.definition.triggers.manual.inputs.method='POST'
 $payload.properties.definition.triggers.manual.runtimeConfiguration.Remove('concurrency')
 $flow=$null
 try{
  $flow=Invoke-DdaFlowApi '' POST $payload
  $callback=Invoke-DdaFlowApi ('/'+$flow.name+'/triggers/manual/listCallbackUrl') POST @{}
  $receipt=Invoke-RestMethod -Uri $callback.response.value -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 120
  if($receipt -is [string]){$receipt=$receipt|ConvertFrom-Json -AsHashtable}
  if(-not $receipt.ready -or $receipt.listId -notmatch '^[a-f0-9-]{36}$'){throw 'QUEUE_NOT_VERIFIED'}
  $state.queueId=$receipt.listId;Save-State
  @{queueReady=$true;queueId=$state.queueId}|ConvertTo-Json -Compress
 }finally{if($flow){$null=Invoke-DdaFlowApi ('/'+$flow.name) DELETE}}
}elseif($Mode -eq 'Publish'){
 if(-not $state.queueId){throw 'QUEUE_SETUP_REQUIRED'}
 $python='C:/Users/Bernardonotini/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
 $definition=(& $python (Join-Path $PSScriptRoot 'silva_flow_definition.py') $state.queueId)|ConvertFrom-Json -AsHashtable
 if($LASTEXITCODE -ne 0){throw 'FLOW_DEFINITION_FAILED'}
 $payload=@{properties=@{displayName='SILVA NOVAIS - buscar boletos e notas da Energetica diariamente';definition=$definition;connectionReferences=$connections;flowFailureAlertSubscribed=$false}}
 $created=if($state.flowId){Invoke-DdaFlowApi ('/'+$state.flowId) PATCH $payload}else{Invoke-DdaFlowApi '' POST $payload}
 $state.flowId=$created.name;Save-State
 $after=Invoke-DdaFlowApi ('/'+$state.flowId)
 if($after.properties.state -ne 'Started' -or $after.properties.definition.triggers.daily.recurrence.frequency -ne 'Day'){throw 'DAILY_FLOW_READBACK_FAILED'}
 @{flowId=$state.flowId;state=$after.properties.state;dailyBrasilia='06:50';queueId=$state.queueId}|ConvertTo-Json -Compress
}else{
 if(-not $state.flowId){throw 'FLOW_NOT_PUBLISHED'}
 $null=Invoke-DdaFlowApi ('/'+$state.flowId+'/triggers/daily/run') POST @{}
 @{flowId=$state.flowId;requested=$true}|ConvertTo-Json -Compress
}
