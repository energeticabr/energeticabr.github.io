[CmdletBinding()]
param(
 [Parameter(Mandatory)][ValidateSet('Schema','Publish','Repair','Verify')][string]$Mode,
 [Parameter(Mandatory)][string]$EvidenceRoot,
 [string]$SessionScript='C:/Users/Bernardonotini/Documents/Codex/2026-10-29/quero-que-desenvolva-para-mim-em/scripts/PowerPlatform-Session.ps1'
)
$ErrorActionPreference='Stop'
. $SessionScript
$EvidenceRoot=(Resolve-Path -LiteralPath $EvidenceRoot).Path
$production='1d482b08-3fe4-468f-9db9-3de1866c104e'
$orders='dfffa843-823f-4da3-939b-aaafb5297893'
$financial='40d7ef08-594a-4835-85d7-036eb1a098e0'
$history='f0f13292-f28c-4c09-8060-4d4af4664730'
$site='https://energeticaltda-my.sharepoint.com/personal/bernardonotini_energeticabr_com'
$base='https://southamerica.api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/200b8072-cebe-e4d7-b154-640eab964ee5'
$api=@{Authorization='Bearer '+(Get-PowerPlatformSessionToken 'https://service.powerapps.com')}
$hub=@{Authorization='Bearer '+(Get-PowerPlatformSessionToken 'https://apihub.azure.com')}
$endpoint='https://200b8072-cebe-e4d7-b154-640eab964ee5.08.common.brazil.azure-apihub.net/apim/sharepointonline/e8453cf8f87449249f35c514af2acecb/datasets/'+[uri]::EscapeDataString([uri]::EscapeDataString($site))+'/httprequest'
function Save($value,$name){[IO.File]::WriteAllText((Join-Path $EvidenceRoot $name),($value|ConvertTo-Json -Depth 100),[Text.UTF8Encoding]::new($false))}
function Read($name){Get-Content -LiteralPath (Join-Path $EvidenceRoot $name) -Raw|ConvertFrom-Json -AsHashtable}
function Equal($left,$right){[System.Text.Json.Nodes.JsonNode]::DeepEquals([System.Text.Json.Nodes.JsonNode]::Parse(($left|ConvertTo-Json -Depth 100 -Compress)),[System.Text.Json.Nodes.JsonNode]::Parse(($right|ConvertTo-Json -Depth 100 -Compress)))}
function Equal-Definition($left,$right){
 # Power Automate adds evaluatedRecurrence on save. Accept only an exact copy
 # of recurrence; preserve strict comparison for every authored property.
 $copies=@()
 foreach($source in @($left,$right)){
  $copy=$source|ConvertTo-Json -Depth 100|ConvertFrom-Json -AsHashtable
  foreach($trigger in $copy.triggers.Values){
   if($trigger.ContainsKey('evaluatedRecurrence')){
    if(-not (Equal $trigger.evaluatedRecurrence $trigger.recurrence)){return $false}
    $null=$trigger.Remove('evaluatedRecurrence')
   }
  }
  $copies+=,$copy
 }
 return Equal $copies[0] $copies[1]
}
function Invoke-MonthlyFlow($method,$path,$body=$null){
 if($method -ne 'GET' -and ($Mode -ne 'Publish' -or $method -ne 'PATCH' -or $path -cne ('/flows/'+$production+'?api-version=2016-11-01'))){throw 'Flow mutation outside publication scope'}
 $p=@{Method=$method;Uri=$base+$path;Headers=$api}
 if($null -ne $body){$p.ContentType='application/json';$p.Body=[Text.Encoding]::UTF8.GetBytes(($body|ConvertTo-Json -Depth 100 -Compress))}
 $r=Invoke-WebRequest @p
 if($r.Content){return ConvertFrom-Json -InputObject $r.Content -AsHashtable}
 return @{}
}
function Invoke-MonthlySp($method,$path,$body=$null,$extra=@{}){
 if(-not $path.StartsWith('_api/web/')){throw 'Outside SharePoint web'}
 if($method -ne 'GET'){
  $schema=$Mode -eq 'Schema' -and $method -eq 'POST' -and ($path -in @("_api/web/lists(guid'$orders')/fields/createfieldasxml","_api/web/lists(guid'$financial')/fields/createfieldasxml")) -and $body.parameters.SchemaXml -ceq '<Field Type="Text" Name="DEPRECIACAOCHAVE" StaticName="DEPRECIACAOCHAVE" DisplayName="DEPRECIACAOCHAVE" Indexed="TRUE" EnforceUniqueValues="TRUE" Required="FALSE" MaxLength="64" />'
  $repair=$Mode -eq 'Repair' -and $method -eq 'POST' -and $path -match ("^_api/web/lists\(guid'"+$orders+"'\)/items\([0-9]+\)(/recycle\(\))?$")
  if(-not $schema -and -not $repair){throw 'SharePoint mutation outside explicit scope'}
 }
 $h=@{Accept='application/json;odata=nometadata'};foreach($key in $extra.Keys){$h[$key]=$extra[$key]}
 $payload=@{method=$method;uri=$path;headers=$h}
 if($null -ne $body){$h['Content-Type']='application/json;odata=nometadata';$payload.body=$body|ConvertTo-Json -Depth 50 -Compress}
 $r=Invoke-WebRequest -Method Post -Uri $endpoint -Headers $hub -ContentType application/json -Body ([Text.Encoding]::UTF8.GetBytes(($payload|ConvertTo-Json -Depth 60 -Compress)))
 if($r.Content){return ConvertFrom-Json -InputObject $r.Content -AsHashtable}
 return @{}
}
function All($path){
 $rows=[Collections.Generic.List[object]]::new()
 do{
  $r=Invoke-MonthlySp GET $path
  if(-not $r.ContainsKey('value')){throw 'Incomplete list page'}
  foreach($v in $r.value){$rows.Add($v)}
  $next=$r.'odata.nextLink';if(-not $next){$next=$r.'@odata.nextLink'}
  if($next){if(-not $next.StartsWith($site+'/')){throw 'Unexpected pagination host'};$path=$next.Substring($site.Length+1)}
 }while($next)
 return ,$rows.ToArray()
}
function Get-Order($id){
 $r=Invoke-MonthlySp GET ("_api/web/lists(guid'$orders')/items($id)") $null @{Accept='application/json;odata=verbose'}
 if(-not $r.d.__metadata.etag){throw 'Concrete order ETag missing'}
 return $r.d
}
function Assert-Keys{
 foreach($list in @($orders,$financial)){
  $fields=Invoke-MonthlySp GET ("_api/web/lists(guid'$list')/fields?"+'$select=InternalName,EntityPropertyName,TypeAsString,Indexed,EnforceUniqueValues&$filter=InternalName eq ''DEPRECIACAOCHAVE''')
  $field=@($fields.value)
  if($field.Count -ne 1 -or $field[0].TypeAsString -cne 'Text' -or -not $field[0].Indexed -or -not $field[0].EnforceUniqueValues){throw 'Unique monthly key schema mismatch'}
 }
}
$before=Read 'flow-before.json'
if($before.name -cne $production){throw 'Wrong production identity'}
if($Mode -eq 'Schema'){
 foreach($list in @($orders,$financial)){
  $fields=Invoke-MonthlySp GET ("_api/web/lists(guid'$list')/fields?"+'$select=InternalName&$filter=InternalName eq ''DEPRECIACAOCHAVE''')
  if(-not $fields.value.Count){
   $null=Invoke-MonthlySp POST ("_api/web/lists(guid'$list')/fields/createfieldasxml") @{parameters=@{SchemaXml='<Field Type="Text" Name="DEPRECIACAOCHAVE" StaticName="DEPRECIACAOCHAVE" DisplayName="DEPRECIACAOCHAVE" Indexed="TRUE" EnforceUniqueValues="TRUE" Required="FALSE" MaxLength="64" />';Options=0}}
  }
 }
 Assert-Keys
 Write-Output 'UNIQUE_MONTHLY_KEYS_VERIFIED'
 exit
}
$next=Read 'definition-after.json'
if($Mode -eq 'Publish'){
 Assert-Keys
 $hash=(Get-FileHash -LiteralPath (Join-Path $EvidenceRoot 'definition-after.json') -Algorithm SHA256).Hash
 foreach($proof in @('probe-proof.json','probe-proof-empty.json','probe-proof-completed.json')){if((Read $proof).definitionHash -cne $hash){throw 'Actual WDL proof does not match exact definition'}}
 $live=Invoke-MonthlyFlow GET ('/flows/'+$production+'?api-version=2016-11-01')
 if(-not (Equal-Definition $live.properties.definition $next)){
  if($live.properties.state -ne 'Started' -or -not (Equal-Definition $live.properties.definition $before.properties.definition) -or -not (Equal $live.properties.connectionReferences $before.properties.connectionReferences) -or $live.properties.apiId -cne $before.properties.apiId -or $live.properties.displayName -cne $before.properties.displayName){throw 'Concurrent flow or connection change'}
  $runs=Invoke-MonthlyFlow GET ('/flows/'+$production+'/runs?api-version=2016-11-01&$top=50')
  if(@($runs.value|Where-Object {$_.properties.status -in @('Running','Waiting')}).Count){throw 'Production execution in progress'}
  $null=Invoke-MonthlyFlow PATCH ('/flows/'+$production+'?api-version=2016-11-01') @{properties=@{apiId=$before.properties.apiId;displayName=$before.properties.displayName;state='Started';connectionReferences=$before.properties.connectionReferences;definition=$next}}
 }
}
$current=Invoke-MonthlyFlow GET ('/flows/'+$production+'?api-version=2016-11-01')
Assert-Keys
if($current.properties.state -ne 'Started' -or -not (Equal-Definition $current.properties.definition $next)){throw 'Published definition readback mismatch'}
if(-not (Equal $current.properties.connectionReferences $before.properties.connectionReferences)){throw 'Connection references changed'}
Save $current 'flow-live-verified.json'
if($Mode -eq 'Publish'){Write-Output 'MONTHLY_PRODUCTION_FLOW_PUBLISHED_AND_READ_BACK';exit}
if($Mode -eq 'Repair'){
 $orderRows=All ("_api/web/lists(guid'$orders')/items?"+'$top=5000')
 $launchRows=All ("_api/web/lists(guid'$financial')/items?"+'$top=5000')
 $historyRows=All ("_api/web/lists(guid'$history')/items?"+'$top=5000')
 Save $orderRows 'repair-orders-before.json';Save $launchRows 'repair-launches-before.json';Save $historyRows 'repair-history-before.json'
 & node (Join-Path $PSScriptRoot 'monthly.mjs') repair (Join-Path $EvidenceRoot 'repair-orders-before.json') (Join-Path $EvidenceRoot 'repair-launches-before.json') (Join-Path $EvidenceRoot 'repair-history-before.json') (Join-Path $EvidenceRoot 'repair-plan.json')
 if($LASTEXITCODE -ne 0){throw 'Repair planning failed'}
 $plan=Read 'repair-plan.json'
 $receipts=[Collections.Generic.List[object]]::new()
 foreach($update in $plan.updates){
  $row=Get-Order $update.id
  $original=@($orderRows|Where-Object Id -eq $update.id)[0]
  if($row.FORMAPGTO -cne 'DEPRECIAÇÃO E AMORTIZAÇÃO' -or $row.Modified -cne $original.Modified){throw 'Concurrent order change'}
  $linked=All ("_api/web/lists(guid'$financial')/items?"+'$top=5000&$filter=AGRUPAR eq '+[uri]::EscapeDataString("'$($update.id)'"))
  $expected=@($launchRows|Where-Object {[string]$_.AGRUPAR -eq [string]$update.id})
  if(-not (Equal $linked $expected)){throw 'Linked financial entries changed'}
  $null=Invoke-MonthlySp POST ("_api/web/lists(guid'$orders')/items($($update.id))") $update.body @{'X-HTTP-Method'='MERGE';'IF-MATCH'=$row.__metadata.etag}
  $readback=Get-Order $update.id
  foreach($key in $update.body.Keys){if($readback[$key] -cne $update.body[$key]){throw 'Repaired order mismatch'}}
  $receipts.Add(@{id=$update.id;body=$update.body;linked=$update.linked})
  Save $receipts.ToArray() 'repair-receipts.json'
 }
 foreach($id in $plan.recycle){
  $row=Get-Order $id
  $links=All ("_api/web/lists(guid'$financial')/items?"+'$top=5000&$filter=AGRUPAR eq '+[uri]::EscapeDataString("'$id'"))
  $historical=All ("_api/web/lists(guid'$history')/items?"+'$top=5000&$filter=IDPEDIDO eq '+$id)
  if($row.FORMAPGTO -cne 'DEPRECIAÇÃO E AMORTIZAÇÃO' -or $links.Count -or $historical.Count){throw 'Order is no longer empty'}
  if($row.Attachments){throw 'Preserve attachments before recycling'}
  $null=Invoke-MonthlySp POST ("_api/web/lists(guid'$orders')/items($id)/recycle()") $null @{'IF-MATCH'=$row.__metadata.etag}
  $receipts.Add(@{recycled=$id});Save $receipts.ToArray() 'repair-receipts.json'
 }
 Write-Output "REPAIRED_ORDERS=$($plan.updates.Count) RECYCLED_EMPTY_ORDERS=$($plan.recycle.Count)"
}
# Verify the original operational records are preserved, and all totals are now exact.
$maps=@{assets='a9bdb746-d54b-40c4-bf6b-3c49e9b1cd6e';history=$history;launches=$financial;orders=$orders}
foreach($key in $maps.Keys){
 $rows=All ("_api/web/lists(guid'$($maps[$key])')/items?"+'$top=5000&$orderby=Id')
 Save $rows "$key-after.json"
 if($key -eq 'orders'){continue}
 $old=Read "$key-before.json"
 if($rows.Count -ne $old.Count){throw ('Unexpected operational row count: '+$key)}
 foreach($r in $old){
  $actual=@($rows|Where-Object Id -eq $r.Id)
  if($actual.Count -ne 1){throw 'Operational record missing'}
  foreach($field in $r.Keys){if(-not (Equal $r[$field] $actual[0][$field])){throw ('Unexpected operational change: '+$key+'/'+$r.Id+'/'+$field)}}
 }
}
& node (Join-Path $PSScriptRoot 'monthly.mjs') repair (Join-Path $EvidenceRoot 'orders-after.json') (Join-Path $EvidenceRoot 'launches-after.json') (Join-Path $EvidenceRoot 'history-after.json') (Join-Path $EvidenceRoot 'repair-remaining.json')
if($LASTEXITCODE -ne 0){throw 'Final repair planner failed'}
$remaining=Read 'repair-remaining.json'
if($remaining.updates.Count -or $remaining.recycle.Count){throw 'Depreciation repair is incomplete'}
$proof=@{status='LIVE_MONTHLY_DEPRECIATION_VERIFIED';enabled=$true;trigger=$current.properties.definition.triggers;assetsPreserved=(Read 'assets-after.json').Count;financialPreserved=(Read 'launches-after.json').Count;historyPreserved=(Read 'history-after.json').Count;repairIdempotent=$true;productionManuallyTriggered=$false;platforms=@('Android','iOS','Windows');scope='Shared cloud backend; no native binary changes';verifiedAt=[datetimeoffset]::UtcNow.ToString('o')}
Save $proof 'final-verification.json'
$proof|ConvertTo-Json -Depth 15
