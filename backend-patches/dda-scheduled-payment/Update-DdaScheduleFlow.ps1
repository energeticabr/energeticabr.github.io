[CmdletBinding()]
param(
 [Parameter(Mandatory)][string]$DdaRuntime,
 [Parameter(Mandatory)][string]$SessionScript,
 [Parameter(Mandatory)][uri]$ConnectorEndpoint,
 [string]$BackupPath,
 [switch]$Apply
)
$ErrorActionPreference='Stop'
. (Join-Path $DdaRuntime 'SharePointFlow.ps1')
. $SessionScript
if($ConnectorEndpoint.Scheme -ne 'https' -or -not $ConnectorEndpoint.Host.EndsWith('.azure-apihub.net') -or $ConnectorEndpoint.AbsolutePath -notmatch '/apim/sharepointonline/.+/httprequest$'){throw 'INVALID_DDA_CONNECTOR'}
$target=Get-Content (Join-Path $DdaRuntime 'sharepoint-target.json') -Raw | ConvertFrom-Json
$flowId=[guid]$target.statusFlowId
$connectorHeaders=@{Authorization='Bearer '+(Get-PowerPlatformSessionToken 'https://apihub.azure.com')}
$base="_api/web/lists(guid'$script:DdaList')"
$field='DDA_CICLO_AGENDAMENTO'
function Invoke-DdaSchema($method,$path,$data=$null){
 $request=@{method=$method;uri=$path;headers=@{Accept='application/json;odata=nometadata'}}
 if($method -eq 'POST'){
  if($path -ne "$base/fields/createfieldasxml" -or $data.parameters.SchemaXml -notmatch ' Name="DDA_CICLO_AGENDAMENTO" '){throw 'UNEXPECTED_SCHEMA_WRITE'}
  $request.headers['Content-Type']='application/json;odata=nometadata'
  $request.body=$data | ConvertTo-Json -Depth 12 -Compress
 }
 $response=Invoke-WebRequest -Method Post -Uri $ConnectorEndpoint -Headers $connectorHeaders -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes(($request|ConvertTo-Json -Depth 15 -Compress))) -TimeoutSec 45
 if($response.Content){$response.Content | ConvertFrom-Json -AsHashtable}
}
$meta=Invoke-DdaSchema GET ($base+'?$select=Id,Title')
if($meta.Title -ne 'DDAS SICOOB' -or [guid]$meta.Id -ne [guid]$script:DdaList){throw 'DDA_LIST_MISMATCH'}
$fieldPath="$base/fields?"+'$select=InternalName,TypeAsString,ReadOnlyField&$filter=InternalName eq '+("'$field'")
$found=@((Invoke-DdaSchema GET $fieldPath).value | Where-Object InternalName -CEQ $field)
if($Apply -and $found.Count -eq 0){
 $null=Invoke-DdaSchema POST "$base/fields/createfieldasxml" @{parameters=@{Options=8;SchemaXml='<Field Type="Text" Name="DDA_CICLO_AGENDAMENTO" StaticName="DDA_CICLO_AGENDAMENTO" DisplayName="Ciclo de agendamento DDA" Required="FALSE" MaxLength="24" Indexed="TRUE" />'}}
 $found=@((Invoke-DdaSchema GET $fieldPath).value | Where-Object InternalName -CEQ $field)
}
if(($Apply -or $found.Count) -and ($found.Count -ne 1 -or $found[0].TypeAsString -ne 'Text' -or $found[0].ReadOnlyField)){throw 'DDA_SCHEDULE_FIELD_MISMATCH'}

Connect-DdaFlow
$route='/'+$flowId.ToString()
$live=Invoke-DdaFlowApi $route
if($live.properties.state -ne 'Started' -or $live.properties.displayName -ne 'DDAS SICOOB - consulta e atualizacao de status'){throw 'DDA_STATUS_FLOW_MISMATCH'}
$definition=$live.properties.definition | ConvertTo-Json -Depth 100 | ConvertFrom-Json -AsHashtable -Depth 100
$operation=$definition.actions.Operacao
$identity=$operation.else.actions.Conferir_identidade
$valid=$operation.else.actions.Validar
$status=$valid.actions.Atualizar_status
$writes=@($status.actions.Gravar_emissao,$status.else.actions.Preservar_emissao)
$list=$operation.actions.Listar
$readback=$valid.actions.Conferir_status
if($null -in @($identity,$valid,$list,$readback) -or $writes.Count -ne 2 -or $null -in $writes){throw 'DDA_FLOW_STRUCTURE_CHANGED'}
$identityParams=$identity.inputs.parameters
$prior="body('Conferir_identidade')?['d']"
$checked="triggerBody()?['checkedAt']"
$incoming="triggerBody()?['status']"
$current="${prior}?['DDA_CICLO_AGENDAMENTO']"
$active="or(equals($current,'AGENDADO'),equals(${prior}?['STATUS_DDA'],'Agendado'))"
$lifecycle="@{if(or(equals($current,'PAGO_AGENDADO'),and($active,equals($incoming,'Pago'))),'PAGO_AGENDADO',if(or(equals($incoming,'Agendado'),and($active,equals($incoming,'Não confirmado'))),'AGENDADO',''))}"
$version="@${prior}?['__metadata']?['etag']"
$guard="@and(equals(${prior}?['CHAVE_DDA'],triggerBody()?['key']),equals(${prior}?['CODIGO_BARRAS'],triggerBody()?['barcode']),equals(${prior}?['CNPJ_PAGADOR'],triggerBody()?['payer']),not(empty(${prior}?['__metadata']?['etag'])),greaterOrEquals(ticks($checked),ticks(coalesce(${prior}?['STATUS_CONSULTADO_EM'],'1900-01-01T00:00:00Z'))))"
function Add-DdaSelect($parameters,$names){
 $old=[string]$parameters.'parameters/uri'
 $match=[regex]::Match($old,'(?<=\$select=)[^&]+')
 if(-not $match.Success){throw 'DDA_FLOW_SELECT_MISSING'}
 $columns=@($match.Value.Split(',')+@($names) | Select-Object -Unique)
 $parameters.'parameters/uri'=$old.Substring(0,$match.Index)+($columns -join ',')+$old.Substring($match.Index+$match.Length)
}
Add-DdaSelect $identityParams @('STATUS_DDA','STATUS_CONSULTADO_EM',$field)
$identityParams.'parameters/headers'.Accept='application/json;odata=verbose'
$valid.expression=$guard
foreach($write in $writes){
 $parameters=$write.inputs.parameters
 $body=$parameters.'parameters/body' | ConvertFrom-Json -AsHashtable
 if(-not $body.Contains('STATUS_DDA') -or -not $body.Contains('SITUACAO')){throw 'DDA_FLOW_MERGE_CONTRACT_CHANGED'}
 $body[$field]=$lifecycle
 $parameters.'parameters/body'=$body | ConvertTo-Json -Depth 20 -Compress
 $parameters.'parameters/headers'['IF-MATCH']=$version
}
Add-DdaSelect $list.inputs.parameters @($field)
Add-DdaSelect $readback.inputs.parameters @($field)

if($Apply){
 if(-not $BackupPath -or (Test-Path -LiteralPath $BackupPath)){throw 'DDA_FLOW_BACKUP_PATH_REQUIRED'}
 $backup=@{properties=@{displayName=$live.properties.displayName;definition=$live.properties.definition;connectionReferences=$live.properties.connectionReferences;flowFailureAlertSubscribed=[bool]$live.properties.flowFailureAlertSubscribed}}
 $backup | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $BackupPath -Encoding utf8
 $fresh=Invoke-DdaFlowApi $route
 if($fresh.properties.lastModifiedTime -ne $live.properties.lastModifiedTime -or (($fresh.properties.definition|ConvertTo-Json -Depth 100 -Compress) -cne ($live.properties.definition|ConvertTo-Json -Depth 100 -Compress))){throw 'DDA_STATUS_FLOW_CHANGED_DURING_PREPARATION'}
 $payload=@{properties=@{displayName=$live.properties.displayName;definition=$definition;connectionReferences=$live.properties.connectionReferences;flowFailureAlertSubscribed=[bool]$live.properties.flowFailureAlertSubscribed}}
 try{
  $null=Invoke-DdaFlowApi $route PATCH $payload
  $published=Invoke-DdaFlowApi $route
  $p=$published.properties.definition.actions.Operacao.else.actions.Validar.actions.Atualizar_status
  foreach($write in @($p.actions.Gravar_emissao,$p.else.actions.Preservar_emissao)){
   $body=$write.inputs.parameters.'parameters/body' | ConvertFrom-Json -AsHashtable
   if($body[$field] -cne $lifecycle -or $write.inputs.parameters.'parameters/headers'.'IF-MATCH' -cne $version){throw 'DDA_STATUS_FLOW_READBACK_MISMATCH'}
  }
  if($published.properties.state -ne 'Started'){throw 'DDA_STATUS_FLOW_NOT_STARTED'}
 }catch{
  $null=Invoke-DdaFlowApi $route PATCH $backup
  throw
 }
}
[pscustomobject]@{schemaPresent=($found.Count -eq 1); applied=[bool]$Apply; writePaths=$writes.Count; usesVerifiedVersion=$true} | ConvertTo-Json -Compress
