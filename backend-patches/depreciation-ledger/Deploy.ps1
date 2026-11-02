[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Prepare','Probe','Publish','Verify')][string]$Mode,
    [Parameter(Mandatory)][string]$EvidenceRoot,
    [string]$SessionScript='C:\Users\Bernardonotini\Documents\Codex\2026-10-29\quero-que-desenvolva-para-mim-em\scripts\PowerPlatform-Session.ps1'
)
$ErrorActionPreference='Stop'
. $SessionScript
$null=New-Item -ItemType Directory -Path $EvidenceRoot -Force
$production='1d482b08-3fe4-468f-9db9-3de1866c104e'
$history='f0f13292-f28c-4c09-8060-4d4af4664730'
$assetList='a9bdb746-d54b-40c4-bf6b-3c49e9b1cd6e'
$environment='200b8072-cebe-e4d7-b154-640eab964ee5'
$base='https://southamerica.api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/'+$environment
$site='https://energeticaltda-my.sharepoint.com/personal/bernardonotini_energeticabr_com'
$apiHeaders=@{Authorization='Bearer '+(Get-PowerPlatformSessionToken 'https://service.powerapps.com')}
$hubHeaders=@{Authorization='Bearer '+(Get-PowerPlatformSessionToken 'https://apihub.azure.com')}
$spEndpoint='https://200b8072-cebe-e4d7-b154-640eab964ee5.08.common.brazil.azure-apihub.net/apim/sharepointonline/e8453cf8f87449249f35c514af2acecb/datasets/'+[uri]::EscapeDataString([uri]::EscapeDataString($site))+'/httprequest'
$statePath=Join-Path $EvidenceRoot 'deployment-state.json'
$state=if(Test-Path -LiteralPath $statePath){Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json -AsHashtable}else{@{}}
function Save($Value,$Name){[IO.File]::WriteAllText((Join-Path $EvidenceRoot $Name),(ConvertTo-Json -InputObject $Value -Depth 100),[Text.UTF8Encoding]::new($false))}
function Read($Name){Get-Content -LiteralPath (Join-Path $EvidenceRoot $Name) -Raw|ConvertFrom-Json -AsHashtable}
function Remember{$null=Save $state 'deployment-state.json'}
function DefinitionHash{
    $definitionBytes=[IO.File]::ReadAllBytes((Join-Path $EvidenceRoot 'definition-after.json'))
    $columnBytes=[IO.File]::ReadAllBytes((Join-Path $EvidenceRoot 'column-map.json'))
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([byte[]]($definitionBytes+$columnBytes)))
}
function FlowApi($Method,$Path,$Body=$null){
    if($Method -notin @('GET','POST','PATCH','DELETE')){throw 'Unexpected Flow API method'}
    if($Method -eq 'PATCH' -and ($Mode -ne 'Publish' -or $Path -cne ('/flows/'+$production+'?api-version=2016-11-01'))){throw 'Only production definition may be patched in Publish mode'}
    if($Method -eq 'POST' -and ($Mode -ne 'Probe' -or $Path -cne '/flows?api-version=2016-11-01')){throw 'Only read-only probe flow may be created'}
    if($Method -eq 'DELETE' -and (-not $state.probeFlowId -or $state.probeFlowId -eq $production -or $Path -cne ('/flows/'+$state.probeFlowId+'?api-version=2016-11-01'))){throw 'Only this deployment read-only probe may be removed'}
    $args=@{Method=$Method;Uri=$base+$Path;Headers=$apiHeaders;TimeoutSec=60}
    if($null -ne $Body){$args.ContentType='application/json';$args.Body=[Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Body -Depth 100 -Compress))}
    $r=Invoke-WebRequest @args
    if([string]::IsNullOrWhiteSpace($r.Content)){return @{}}
    ConvertFrom-Json -InputObject $r.Content -AsHashtable
}
function Invoke-DepSp($Method,$Path,$Body=$null,$Extra=@{}){
    if(-not $Path.StartsWith('_api/web/')){throw 'Unexpected SharePoint path'}
    if($Method -ne 'GET' -and ($Mode -ne 'Prepare' -or -not $Path.StartsWith("_api/web/lists(guid'$history')/"))){throw 'Only destination schema may be changed in Prepare mode'}
    $h=@{Accept='application/json;odata=nometadata'};foreach($k in $Extra.Keys){$h[$k]=$Extra[$k]}
    $payload=@{method=$Method;uri=$Path;headers=$h}
    if($null -ne $Body){$h['Content-Type']='application/json;odata=nometadata';$payload.body=ConvertTo-Json -InputObject $Body -Depth 40 -Compress}
    $r=Invoke-WebRequest -Method Post -Uri $spEndpoint -Headers $hubHeaders -ContentType application/json -Body ([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $payload -Depth 45 -Compress))) -TimeoutSec 60
    if([string]::IsNullOrWhiteSpace($r.Content)){return @{}}
    ConvertFrom-Json -InputObject $r.Content -AsHashtable
}
function GetSchema{Invoke-DepSp GET ("_api/web/lists(guid'$history')/fields?"+'$select=Id,InternalName,StaticName,EntityPropertyName,Title,TypeAsString,Required,Indexed&$filter=Hidden%20eq%20false')}
function JsonEqual($Left,$Right){
    $a=[System.Text.Json.Nodes.JsonNode]::Parse((ConvertTo-Json -InputObject $Left -Depth 100 -Compress))
    $b=[System.Text.Json.Nodes.JsonNode]::Parse((ConvertTo-Json -InputObject $Right -Depth 100 -Compress))
    [System.Text.Json.Nodes.JsonNode]::DeepEquals($a,$b)
}
$before=Read 'flow-before.json'
if($before.name -cne $production -or $before.properties.state -cne 'Started'){throw 'Production backup identity/state mismatch'}
if($Mode -eq 'Prepare'){
    $live=FlowApi GET ('/flows/'+$production+'?api-version=2016-11-01')
    if(-not (JsonEqual $live.properties.definition $before.properties.definition)){throw 'Production flow changed after backup'}
    $schema=GetSchema
    $found=@($schema.value|Where-Object {$_.StaticName -eq 'IDLANCAMENTO' -or $_.InternalName -eq 'IDLANCAMENTO'})
    if($found.Count -eq 0){
        $null=Invoke-DepSp POST ("_api/web/lists(guid'$history')/fields/createfieldasxml") @{parameters=@{SchemaXml='<Field Type="Number" Name="IDLANCAMENTO" StaticName="IDLANCAMENTO" DisplayName="IDLANCAMENTO" Decimals="0" Min="1" Indexed="TRUE" Required="FALSE" />';Options=0}}
        $schema=GetSchema;$found=@($schema.value|Where-Object {$_.StaticName -eq 'IDLANCAMENTO'})
    }
    if($found.Count -ne 1 -or $found[0].TypeAsString -cne 'Number' -or $found[0].Required){throw 'Financial-link column schema mismatch'}
    $null=Invoke-DepSp POST ("_api/web/lists(guid'$history')/fields(guid'$($found[0].Id)')") @{Title='ID LANÇAMENTO'} @{'X-HTTP-Method'='MERGE';'IF-MATCH'='*'}
    $view=Invoke-DepSp GET ("_api/web/lists(guid'$history')/DefaultView/ViewFields")
    if($view.Items -notcontains $found[0].InternalName){$null=Invoke-DepSp POST ("_api/web/lists(guid'$history')/DefaultView/ViewFields/addviewfield('$($found[0].InternalName)')")}
    $schema=GetSchema;Save $schema 'history-schema-after.json'
    $static=@{asset='IDIMOBILIZADO';launch='IDLANCAMENTO';name='Title';branch='FILIAL';percent='PERCENTUALDEPRECIACAO';date='DATADEPRECIACAO';amount='VALORDEPRECIACAO';residual='VALORRESIDUAL'}
    $map=[ordered]@{}
    foreach($key in ($static.Keys|Sort-Object)){$f=@($schema.value|Where-Object {$_.StaticName -eq $static[$key]});if($f.Count -ne 1){throw 'Destination field not uniquely resolved'};$map[$key]=$f[0].EntityPropertyName}
    Save $map 'column-map.json'
    & node (Join-Path $PSScriptRoot 'build-flow.mjs') --source (Join-Path $EvidenceRoot 'flow-before.json') --columns (Join-Path $EvidenceRoot 'column-map.json') --output (Join-Path $EvidenceRoot 'definition-after.json')
    if($LASTEXITCODE -ne 0){throw 'Definition builder failed'}
    $hash=DefinitionHash
    if($state.preparedHash -cne $hash){
        if($state.probeFlowId -and -not $state.probeRemoved){throw 'Remove the previous owned probe before preparing a different definition'}
        foreach($key in @('probeFlowId','probeRunId','probeVerified','probeRemoved','probeHash')){$null=$state.Remove($key)}
    }
    $state.preparedHash=$hash;$state.prepared=$true;Remember
    Write-Output 'PREPARED: column and definition verified; production flow not changed'
    exit
}
if(-not $state.prepared){throw 'Prepare has not completed'}
$next=Read 'definition-after.json'
$hash=DefinitionHash
if($state.preparedHash -cne $hash){throw 'Definition or column map changed after Prepare'}
if($Mode -eq 'Probe'){
    if($state.probeVerified -and $state.probeRemoved -and $state.probeHash -ceq $hash){Write-Output 'PROBE_ALREADY_VERIFIED: exact definition and column map';exit}
    & node (Join-Path $PSScriptRoot 'probe-cli.mjs') (Join-Path $EvidenceRoot 'definition-after.json') (Join-Path $EvidenceRoot 'probe-definition.json')
    if($LASTEXITCODE -ne 0){throw 'Read-only probe validation failed'}
    if(-not $state.probeFlowId){
        $probe=FlowApi POST '/flows?api-version=2016-11-01' @{properties=@{apiId=$before.properties.apiId;displayName='CODEX - Verificar depreciação (sem escritas)';state='Started';connectionReferences=@{};definition=(Read 'probe-definition.json')}}
        if($probe.name -notmatch '^[0-9a-f-]{36}$' -or $probe.name -eq $production){throw 'Probe identity not confirmed'}
        $state.probeFlowId=$probe.name;Remember
    }
    if(-not $state.probeRunId){
        $connector=FlowApi GET '/apis/shared_logicflows?api-version=2016-11-01'
        $runtime=[uri]$connector.properties.primaryRuntimeUrl
        if($runtime.Scheme -ne 'https' -or $runtime.Host -notlike '*.azure-apihub.net' -or $runtime.AbsolutePath -ne '/apim/logicflows'){throw 'Unexpected manual trigger runtime'}
        $reply=Invoke-WebRequest -Method Post -Uri ($runtime.AbsoluteUri.TrimEnd('/')+'/'+$state.probeFlowId+'/triggers/manual/run?api-version=2016-11-01') -Headers $hubHeaders -ContentType application/json -Body '{}' -TimeoutSec 60
        $state.probeRunId=[string](@($reply.Headers['x-ms-workflow-run-id'])[0]);if($state.probeRunId -notmatch '^[A-Za-z0-9]+$'){throw 'Probe run ID missing'};Remember
    }
    $runPath='/flows/'+$state.probeFlowId+'/runs/'+$state.probeRunId
    $deadline=[datetimeoffset]::UtcNow.AddMinutes(2)
    do{$run=FlowApi GET ($runPath+'?api-version=2016-11-01');if($run.properties.status -in @('Succeeded','Failed','Cancelled','TimedOut')){break};if([datetimeoffset]::UtcNow -gt $deadline){throw 'Probe still running'};Start-Sleep -Seconds 3}while($true)
    Save $run 'probe-run.json'
    if($run.properties.status -cne 'Succeeded'){throw ('Probe '+$run.properties.status)}
    $action=FlowApi GET ($runPath+'/actions/Receipt?api-version=2016-11-01')
    $out=Invoke-WebRequest -Uri $action.properties.outputsLink.uri -TimeoutSec 60
    $receipt=ConvertFrom-Json -InputObject $out.Content -AsHashtable
    Save $receipt 'probe-receipt.json'
    & node (Join-Path $PSScriptRoot 'verify-probe.mjs') (Join-Path $EvidenceRoot 'probe-receipt.json') (Join-Path $EvidenceRoot 'column-map.json')
    if($LASTEXITCODE -ne 0){throw 'Runtime receipt verification failed'}
    $state.probeVerified=$true;$state.probeHash=$hash;Remember
    $null=FlowApi DELETE ('/flows/'+$state.probeFlowId+'?api-version=2016-11-01')
    $state.probeRemoved=$true;Remember
    Write-Output 'PROBE_VERIFIED: actual WDL runtime, three fictitious cases, zero external writes; temporary flow removed'
    exit
}
if($Mode -eq 'Publish'){
    if(-not $state.probeVerified -or $state.probeHash -cne $hash){throw 'Runtime validation of this exact definition and column map required before publishing'}
    $live=FlowApi GET ('/flows/'+$production+'?api-version=2016-11-01')
    if(JsonEqual $live.properties.definition $next){Write-Output 'ALREADY_PUBLISHED';exit}
    if($live.properties.state -cne 'Started' -or -not (JsonEqual $live.properties.definition $before.properties.definition)){throw 'Concurrent production change detected'}
    $runs=FlowApi GET ('/flows/'+$production+'/runs?api-version=2016-11-01&$top=5')
    if(@($runs.value|Where-Object {$_.properties.status -in @('Running','Waiting')}).Count){throw 'Production run in progress; defer patch'}
    $null=FlowApi PATCH ('/flows/'+$production+'?api-version=2016-11-01') @{properties=@{apiId=$before.properties.apiId;displayName=$before.properties.displayName;state='Started';connectionReferences=$before.properties.connectionReferences;definition=$next}}
    $state.publishedAt=[datetimeoffset]::UtcNow.ToString('o');Remember
}
$current=FlowApi GET ('/flows/'+$production+'?api-version=2016-11-01')
if($current.properties.state -cne 'Started' -or -not (JsonEqual $current.properties.definition $next)){throw 'Published flow readback mismatch'}
if(-not (JsonEqual $current.properties.connectionReferences $before.properties.connectionReferences)){throw 'Connection references changed'}
Save $current 'flow-live-verified.json'
$schema=GetSchema;$link=@($schema.value|Where-Object {$_.StaticName -eq 'IDLANCAMENTO'})
if($link.Count -ne 1 -or $link[0].Title -cne 'ID LANÇAMENTO' -or $link[0].TypeAsString -cne 'Number'){throw 'Live link column mismatch'}
$assetNow=Invoke-DepSp GET ("_api/web/lists(guid'$assetList')/items?"+'$select=Id,ITEM,DEPRECIAR,DATADEPRECIA_x00c7__x00c3_O,VALORRESIDUAL,OData__x0025_DEPRECIACAO,HTML,Modified&$top=100')
$assetBefore=Read 'assets-before.json'
if(-not (JsonEqual $assetNow.value $assetBefore.value)){throw 'Asset rows changed during deployment; review before claiming preservation'}
$historyNow=Invoke-DepSp GET ("_api/web/lists(guid'$history')/items?"+'$top=5000')
$historyBefore=Read 'history-before.json'
if($historyNow.value.Count -ne $historyBefore.value.Count){throw 'History count changed during deployment'}
foreach($row in $historyBefore.value){$match=@($historyNow.value|Where-Object {$_.Id -eq $row.Id});if($match.Count -ne 1){throw 'Legacy row missing'};foreach($key in $row.Keys){if(-not (JsonEqual $row[$key] $match[0][$key])){throw ('Legacy row changed: '+$row.Id+'/'+$key)}}}
$proof=[ordered]@{status='LIVE_VERIFIED';flowId=$production;verifiedAt=[datetimeoffset]::UtcNow.ToString('o');enabled=$true;scheduleUnchanged=(JsonEqual $current.properties.definition.triggers $before.properties.definition.triggers);financialCreationUnchanged=(JsonEqual $current.properties.definition.actions.Apply_to_each.actions.Create_item $before.properties.definition.actions.Apply_to_each.actions.Create_item);assetRowsUnchanged=$assetNow.value.Count;historicalRowsUnchanged=$historyNow.value.Count;htmlWrites=$false;historyList=$history;financialLinkColumn=$link[0].EntityPropertyName;runtimeProbeVerified=$state.probeVerified;productionManuallyTriggered=$false}
Save $proof 'live-verification.json';$proof|ConvertTo-Json -Depth 6
