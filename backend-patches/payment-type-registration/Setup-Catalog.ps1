[CmdletBinding()]
param([Parameter(Mandatory)][string]$EvidenceRoot)
$ErrorActionPreference='Stop'
. 'C:/Users/Bernardonotini/Documents/Codex/2026-10-29/quero-que-desenvolva-para-mim-em/scripts/PowerPlatform-Session.ps1'
$site='https://energeticaltda-my.sharepoint.com/personal/bernardonotini_energeticabr_com'
$target='CADASTROTIPOPAGAMENTO'
$prefix="_api/web/lists/GetByTitle('$target')"
$headers=@{Authorization='Bearer '+(Get-PowerPlatformSessionToken 'https://apihub.azure.com')}
$endpoint='https://200b8072-cebe-e4d7-b154-640eab964ee5.08.common.brazil.azure-apihub.net/apim/sharepointonline/e8453cf8f87449249f35c514af2acecb/datasets/'+[uri]::EscapeDataString([uri]::EscapeDataString($site))+'/httprequest'
function Invoke-PaymentCatalog($Method,$Path,$Body=$null){
 if($Method -notin @('GET','POST')){throw 'Unexpected method'}
 if($Method -eq 'POST'){
  $create=$Path -ceq '_api/web/lists' -and $Body.Title -ceq $target -and $Body.BaseTemplate -eq 100
  $field=$Path -ceq ($prefix+'/fields/createfieldasxml') -and $Body.parameters.SchemaXml -match 'Name="(TIPOPGTO|CHAVE)"'
  $view=$Path -in @(($prefix+"/DefaultView/ViewFields/addviewfield('TIPOPGTO')"),($prefix+"/DefaultView/ViewFields/addviewfield('CHAVE')"))
  if(-not ($create -or $field -or $view)){throw 'Only dedicated catalog schema is writable'}
 }
 $h=@{Accept='application/json;odata=nometadata'}
 $payload=@{method=$Method;uri=$Path;headers=$h}
 if($null -ne $Body){$h['Content-Type']='application/json;odata=nometadata';$payload.body=ConvertTo-Json -InputObject $Body -Depth 10 -Compress}
 $r=Invoke-WebRequest -Method Post -Uri $endpoint -Headers $headers -ContentType application/json -Body ([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $payload -Depth 15 -Compress))) -TimeoutSec 60
 if([string]::IsNullOrWhiteSpace($r.Content)){return @{}}
 ConvertFrom-Json -InputObject $r.Content -AsHashtable
}
$lists=Invoke-PaymentCatalog GET ('_api/web/lists?'+"`$select=Id,Title,BaseTemplate&`$filter=Title eq '$target'")
$created=$false
if(@($lists.value).Count -eq 0){
 $null=Invoke-PaymentCatalog POST '_api/web/lists' @{Title=$target;Description='Tipos de pagamento da folha cadastrados no aplicativo Energético';BaseTemplate=100;EnableAttachments=$false;EnableVersioning=$true}
 $created=$true
}
$meta=Invoke-PaymentCatalog GET ($prefix+'?'+ '$select=Id,Title,BaseTemplate')
if($meta.Title -cne $target -or $meta.BaseTemplate -ne 100){throw 'Catalog mismatch'}
$fields=Invoke-PaymentCatalog GET ($prefix+'/fields?'+ '$select=InternalName,TypeAsString,Required,Indexed,EnforceUniqueValues')
foreach($name in @('TIPOPGTO','CHAVE')){
 if(-not @($fields.value | Where-Object InternalName -CEQ $name).Count){
  $unique=if($name -eq 'CHAVE'){' Indexed="TRUE" EnforceUniqueValues="TRUE"'}else{''}
  $xml='<Field Type="Text" Name="'+$name+'" StaticName="'+$name+'" DisplayName="'+$name+'" Required="TRUE" MaxLength="255"'+$unique+' />'
  $null=Invoke-PaymentCatalog POST ($prefix+'/fields/createfieldasxml') @{parameters=@{SchemaXml=$xml;Options=0}}
 }
}
$after=Invoke-PaymentCatalog GET ($prefix+'/fields?'+ '$select=InternalName,TypeAsString,Required,Indexed,EnforceUniqueValues')
foreach($name in @('TIPOPGTO','CHAVE')){
 $field=@($after.value | Where-Object InternalName -CEQ $name)
 if($field.Count -ne 1 -or $field[0].TypeAsString -cne 'Text' -or -not $field[0].Required){throw 'Field mismatch'}
 if($name -eq 'CHAVE' -and (-not $field[0].Indexed -or -not $field[0].EnforceUniqueValues)){throw 'Unique key mismatch'}
}
$views=Invoke-PaymentCatalog GET ($prefix+'/DefaultView/ViewFields')
$visible=@($views.Items)
foreach($name in @('TIPOPGTO','CHAVE')){
 if($name -notin $visible){$null=Invoke-PaymentCatalog POST ($prefix+"/DefaultView/ViewFields/addviewfield('$name')")}
}
$result=@{created=$created;list_id=$meta.Id;list=$target;site=$site;unique_key=$true;fields=@($after.value|Where-Object InternalName -in @('TIPOPGTO','CHAVE'))}
$null=New-Item -ItemType Directory -Force $EvidenceRoot
$result|ConvertTo-Json -Depth 10|Set-Content (Join-Path $EvidenceRoot 'catalog-schema.json') -Encoding utf8
$result|ConvertTo-Json -Depth 10
