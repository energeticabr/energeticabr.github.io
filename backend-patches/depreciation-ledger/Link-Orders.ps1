[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Prepare','Backfill','Verify')][string]$Mode,
    [Parameter(Mandatory)][string]$EvidenceRoot,
    [string]$SessionScript='C:\Users\Bernardonotini\Documents\Codex\2026-10-29\quero-que-desenvolva-para-mim-em\scripts\PowerPlatform-Session.ps1'
)
$ErrorActionPreference='Stop'
. $SessionScript
$null=New-Item -ItemType Directory -Path $EvidenceRoot -Force
$flowId='1d482b08-3fe4-468f-9db9-3de1866c104e'
$history='f0f13292-f28c-4c09-8060-4d4af4664730'
$financial='40d7ef08-594a-4835-85d7-036eb1a098e0'
$orders='dfffa843-823f-4da3-939b-aaafb5297893'
$assets='a9bdb746-d54b-40c4-bf6b-3c49e9b1cd6e'
$api='https://southamerica.api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/200b8072-cebe-e4d7-b154-640eab964ee5'
$site='https://energeticaltda-my.sharepoint.com/personal/bernardonotini_energeticabr_com'
$endpoint='https://200b8072-cebe-e4d7-b154-640eab964ee5.08.common.brazil.azure-apihub.net/apim/sharepointonline/e8453cf8f87449249f35c514af2acecb/datasets/'+[uri]::EscapeDataString([uri]::EscapeDataString($site))+'/httprequest'
$hub=@{Authorization='Bearer '+(Get-PowerPlatformSessionToken 'https://apihub.azure.com')}
$auth=@{Authorization='Bearer '+(Get-PowerPlatformSessionToken 'https://service.powerapps.com')}
function Save($value,$name){[IO.File]::WriteAllText((Join-Path $EvidenceRoot $name),(ConvertTo-Json -InputObject $value -Depth 100),[Text.UTF8Encoding]::new($false))}
function Read($name){Get-Content -LiteralPath (Join-Path $EvidenceRoot $name) -Raw|ConvertFrom-Json -AsHashtable}
function Equal($a,$b){[System.Text.Json.Nodes.JsonNode]::DeepEquals([System.Text.Json.Nodes.JsonNode]::Parse((ConvertTo-Json -InputObject $a -Depth 100 -Compress)),[System.Text.Json.Nodes.JsonNode]::Parse((ConvertTo-Json -InputObject $b -Depth 100 -Compress)))}
function LiveFlow{Invoke-RestMethod -Uri ($api+'/flows/'+$flowId+'?api-version=2016-11-01') -Headers $auth|ConvertTo-Json -Depth 100|ConvertFrom-Json -AsHashtable}
$statePath=Join-Path $EvidenceRoot 'deployment-state.json'
$state=if(Test-Path -LiteralPath $statePath){Read 'deployment-state.json'}else{@{}}
$writePlan=$null
function Invoke-OrderSp($method,$path,$body=$null,$extra=@{}){
    if(-not $path.StartsWith('_api/web/')){throw 'Unexpected SharePoint path'}
    if($method -ne 'GET'){
        if($method -ne 'POST'){throw 'Only scoped POST/MERGE supported'}
        $prefix="_api/web/lists(guid'$history')/"
        if($Mode -eq 'Prepare'){
            if(-not $path.StartsWith($prefix) -or $path.Substring($prefix.Length) -notmatch '^(fields/createfieldasxml|fields\(guid''[0-9a-f-]+''\)|DefaultView/ViewFields/addviewfield\(''IDPEDIDO''\))$'){throw 'Only the new history schema may be changed'}
            if($path -like '*createfieldasxml' -and $body.parameters.SchemaXml -notlike '*Name="IDPEDIDO"*'){throw 'Unexpected field creation'}
            if($path -match '/fields\(guid' -and (@($body.Keys).Count -ne 2 -or $body.Title -cne 'NÚMERO DO PEDIDO' -or -not $body.ContainsKey('Description'))){throw 'Unexpected column metadata'}
        }elseif($Mode -eq 'Backfill'){
            if($path -notmatch ("^"+[regex]::Escape($prefix)+'items\(([1-9]\d*)\)$')){throw 'Only allowlisted history rows may be changed'}
            $target=[int]$Matches[1]
            $allowed=@($writePlan.writes|Where-Object {$_.historyId -eq $target -and $_.orderId -eq $body.IDPEDIDO})
            if(-not $allowed.Count -or @($body.Keys).Count -ne 1 -or -not $body.ContainsKey('IDPEDIDO') -or $extra['X-HTTP-Method'] -ne 'MERGE' -or -not $extra['IF-MATCH'] -or $extra['IF-MATCH'] -eq '*'){throw 'Only IDPEDIDO with a concrete ETag may be written'}
        }else{throw 'Verify is read only'}
    }
    $headers=@{Accept='application/json;odata=nometadata'};foreach($key in $extra.Keys){$headers[$key]=$extra[$key]}
    $payload=@{method=$method;uri=$path;headers=$headers}
    if($null -ne $body){$headers['Content-Type']='application/json;odata=nometadata';$payload.body=ConvertTo-Json -InputObject $body -Depth 30 -Compress}
    $r=Invoke-WebRequest -Method Post -Uri $endpoint -Headers $hub -ContentType application/json -Body ([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $payload -Depth 35 -Compress))) -TimeoutSec 60
    if([string]::IsNullOrWhiteSpace($r.Content)){return @{}}
    ConvertFrom-Json -InputObject $r.Content -AsHashtable
}
function Schema{Invoke-OrderSp GET ("_api/web/lists(guid'$history')/fields?"+'$select=Id,InternalName,StaticName,EntityPropertyName,Title,TypeAsString,Required,Indexed&$filter=Hidden%20eq%20false')}
function HistoryRows{Invoke-OrderSp GET ("_api/web/lists(guid'$history')/items?"+'$top=5000')}
function AssetRows{Invoke-OrderSp GET ("_api/web/lists(guid'$assets')/items?"+'$select=Id,ITEM,DEPRECIAR,DATADEPRECIA_x00c7__x00c3_O,VALORRESIDUAL,OData__x0025_DEPRECIACAO,HTML,Modified&$top=100')}
function Item($list,$id){
    if($list -notin @($history,$financial,$orders) -or [string]$id -notmatch '^[1-9]\d{0,14}$'){throw 'Unexpected item identity'}
    $r=Invoke-OrderSp GET ("_api/web/lists(guid'$list')/items($id)") $null @{Accept='application/json;odata=verbose'}
    if([int]$r.d.ID -ne [int]$id -or -not $r.d.__metadata.etag){throw 'Item identity/ETag not confirmed'}
    $r.d
}
function Hash{
    $bytes=[byte[]]([IO.File]::ReadAllBytes((Join-Path $EvidenceRoot 'definition-after.json'))+[IO.File]::ReadAllBytes((Join-Path $EvidenceRoot 'column-map.json')))
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes))
}
if($Mode -eq 'Prepare'){
    $live=LiveFlow
    if($live.name -cne $flowId -or $live.properties.state -cne 'Started'){throw 'Wrong production flow/state'}
    if(Test-Path -LiteralPath (Join-Path $EvidenceRoot 'flow-before.json')){
        $before=Read 'flow-before.json';if(-not (Equal $before.properties.definition $live.properties.definition)){throw 'Concurrent flow change'}
    }else{Save $live 'flow-before.json';$before=$live}
    if(-not (Test-Path -LiteralPath (Join-Path $EvidenceRoot 'history-before.json'))){
        $rows=HistoryRows;$source=AssetRows
        if($rows.'odata.nextLink' -or $rows.'@odata.nextLink' -or $source.'odata.nextLink' -or $source.'@odata.nextLink'){throw 'Incomplete backup pagination'}
        Save $rows 'history-before.json';Save $source 'assets-before.json';Save (Schema) 'history-schema-before.json'
    }
    $schema=Schema;$field=@($schema.value|Where-Object {$_.StaticName -eq 'IDPEDIDO'})
    if(-not $field.Count){
        $null=Invoke-OrderSp POST ("_api/web/lists(guid'$history')/fields/createfieldasxml") @{parameters=@{SchemaXml='<Field Type="Number" Name="IDPEDIDO" StaticName="IDPEDIDO" DisplayName="IDPEDIDO" Decimals="0" Min="1" Indexed="TRUE" Required="FALSE" />';Options=0}}
        $schema=Schema;$field=@($schema.value|Where-Object {$_.StaticName -eq 'IDPEDIDO'})
    }
    if($field.Count -ne 1 -or $field[0].TypeAsString -ne 'Number' -or $field[0].Required -or $field[0].EntityPropertyName -cne 'IDPEDIDO'){throw 'Order column schema mismatch'}
    $null=Invoke-OrderSp POST ("_api/web/lists(guid'$history')/fields(guid'$($field[0].Id)')") @{Title='NÚMERO DO PEDIDO';Description='ID do pedido em NOTASPENDENTES vinculado ao lançamento financeiro pelo campo AGRUPAR.'} @{'X-HTTP-Method'='MERGE';'IF-MATCH'='*'}
    $view=Invoke-OrderSp GET ("_api/web/lists(guid'$history')/DefaultView/ViewFields")
    if($view.Items -notcontains 'IDPEDIDO'){$null=Invoke-OrderSp POST ("_api/web/lists(guid'$history')/DefaultView/ViewFields/addviewfield('IDPEDIDO')")}
    $schema=Schema;Save $schema 'history-schema-after.json'
    $names=@{asset='IDIMOBILIZADO';launch='IDLANCAMENTO';order='IDPEDIDO';name='Title';branch='FILIAL';percent='PERCENTUALDEPRECIACAO';date='DATADEPRECIACAO';amount='VALORDEPRECIACAO';residual='VALORRESIDUAL'};$map=[ordered]@{}
    foreach($key in ($names.Keys|Sort-Object)){$match=@($schema.value|Where-Object {$_.StaticName -eq $names[$key]});if($match.Count -ne 1){throw 'Column map ambiguous'};$map[$key]=$match[0].EntityPropertyName};Save $map 'column-map.json'
    & node (Join-Path $PSScriptRoot 'build-order-link.mjs') flow (Join-Path $EvidenceRoot 'flow-before.json') (Join-Path $EvidenceRoot 'definition-after.json');if($LASTEXITCODE){throw 'Flow transformer failed'}
    $hash=Hash
    if($state.preparedHash -cne $hash){if($state.probeFlowId -and -not $state.probeRemoved){throw 'Remove previous owned probe first'};foreach($key in @('probeFlowId','probeRunId','probeVerified','probeRemoved','probeHash')){$null=$state.Remove($key)}}
    $state.prepared=$true;$state.preparedHash=$hash;Save $state 'deployment-state.json'
    $rows=Read 'history-before.json';$launches=@();$requests=@();$seen=@{}
    foreach($id in @($rows.value|Where-Object {$_.IDLANCAMENTO}|ForEach-Object {[int]$_.IDLANCAMENTO}|Sort-Object -Unique)){
        $entry=Item $financial $id;$launches+=,$entry
        if(-not [string]::IsNullOrWhiteSpace([string]$entry.AGRUPAR)){
            $order=[string]$entry.AGRUPAR;if($order -notmatch '^[1-9]\d{0,14}$'){throw 'Invalid linked order ID'}
            if(-not $seen.ContainsKey($order)){$requests+=,(Item $orders $order);$seen[$order]=$true}
        }
    }
    Save $launches 'launches-before.json';Save $requests 'orders-before.json'
    & node (Join-Path $PSScriptRoot 'build-order-link.mjs') plan (Join-Path $EvidenceRoot 'history-before.json') (Join-Path $EvidenceRoot 'launches-before.json') (Join-Path $EvidenceRoot 'orders-before.json') (Join-Path $EvidenceRoot 'backfill-plan.json');if($LASTEXITCODE){throw 'Backfill planning failed'}
    Write-Output 'PREPARED_ORDER_COLUMN_AND_EXACT_DEFINITION';Read 'backfill-plan.json'|ConvertTo-Json -Depth 6;exit
}
if(-not $state.prepared -or $state.preparedHash -cne (Hash)){throw 'Unprepared or changed definition'}
$live=LiveFlow;$next=Read 'definition-after.json';$before=Read 'flow-before.json'
if($live.properties.state -cne 'Started' -or -not (Equal $live.properties.definition $next) -or -not $state.probeVerified -or $state.probeHash -cne (Hash)){throw 'Published exact definition/probe not confirmed'}
$writePlan=Read 'backfill-plan.json'
if($Mode -eq 'Backfill'){
    $receipts=@()
    foreach($entry in $writePlan.writes){
        $row=Item $history $entry.historyId;$launch=Item $financial $entry.launchId;$order=Item $orders $entry.orderId
        if([int]$row.IDLANCAMENTO -ne $entry.launchId -or ([string]$launch.AGRUPAR).Trim() -cne [string]$entry.orderId){throw 'Link changed since planning'}
        if($row.IDPEDIDO){if([int]$row.IDPEDIDO -eq $entry.orderId){continue};throw 'Conflicting existing order'}
        $null=Invoke-OrderSp POST ("_api/web/lists(guid'$history')/items($($entry.historyId))") @{IDPEDIDO=[int]$entry.orderId} @{'X-HTTP-Method'='MERGE';'IF-MATCH'=$row.__metadata.etag}
        $after=Item $history $entry.historyId;if([int]$after.IDPEDIDO -ne $entry.orderId){throw 'Order write readback mismatch'}
        $receipts+=,@{historyId=$entry.historyId;launchId=$entry.launchId;orderId=$entry.orderId;beforeETag=$row.__metadata.etag;afterETag=$after.__metadata.etag;at=[datetimeoffset]::UtcNow.ToString('o')};Save $receipts 'backfill-receipts.json'
    }
}
$now=HistoryRows;$old=Read 'history-before.json'
if($now.value.Count -ne $old.value.Count -or $now.'odata.nextLink' -or $now.'@odata.nextLink'){throw 'History changed or incomplete during deployment'}
Save $now 'history-after.json'
& node (Join-Path $PSScriptRoot 'build-order-link.mjs') verify (Join-Path $EvidenceRoot 'history-before.json') (Join-Path $EvidenceRoot 'history-after.json') (Join-Path $EvidenceRoot 'backfill-plan.json');if($LASTEXITCODE){throw 'Order field preservation failed'}
$allowedSystem=@('Modified','EditorId','OData__UIVersionString','odata.etag','@odata.etag')
foreach($row in $old.value){
    $current=@($now.value|Where-Object {$_.Id -eq $row.Id});if($current.Count -ne 1){throw 'Historical row disappeared'}
    $planned=@($writePlan.writes|Where-Object {$_.historyId -eq $row.Id})
    foreach($key in $row.Keys){if($key -eq 'IDPEDIDO' -or $planned.Count -and $key -in $allowedSystem){continue};if(-not (Equal $row[$key] $current[0][$key])){throw ('Unexpected history change: '+$row.Id+'/'+$key)}}
    if($planned.Count -and [int]$current[0].IDPEDIDO -ne $planned[0].orderId){throw 'Planned order missing'}
}
$assetNow=AssetRows;if(-not (Equal $assetNow.value (Read 'assets-before.json').value)){throw 'Asset rows changed during deployment'}
$field=@((Schema).value|Where-Object {$_.StaticName -eq 'IDPEDIDO'});if($field.Count -ne 1 -or $field[0].Title -cne 'NÚMERO DO PEDIDO'){throw 'Order column readback mismatch'}
$proof=@{status='ORDER_LINK_LIVE_VERIFIED';flowId=$flowId;orderColumn='IDPEDIDO';columnTitle=$field[0].Title;historyCount=$now.value.Count;linkedOrders=@($now.value|Where-Object {$_.IDPEDIDO}).Count;legacyWithoutLaunch=$writePlan.withoutLaunch;assetsPreserved=$assetNow.value.Count;financialCreationUnchanged=(Equal $live.properties.definition.actions.Apply_to_each.actions.Create_item $before.properties.definition.actions.Apply_to_each.actions.Create_item);scheduleUnchanged=(Equal $live.properties.definition.triggers $before.properties.definition.triggers);productionManuallyTriggered=$false;verifiedAt=[datetimeoffset]::UtcNow.ToString('o')}
Save $now 'history-after.json';Save $proof 'order-link-verification.json';$proof|ConvertTo-Json -Depth 6
