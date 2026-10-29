[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('Provision','Prepare','UpdateHelper','Read','Backfill','Verify')][string]$Mode)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'PowerPlatform-Session.ps1')
$environment='Default-0c10f511-7ede-4702-a2d9-bedb26937e0e'
$base='https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/'+$environment
$auth=@{Authorization=('Bearer '+(Get-PowerPlatformSessionToken 'https://service.powerapps.com'))}
$statePath=Join-Path $root '.runtime/retencoes-deploy-state.json'
$names=@('PIS_RETIDO','COFINS_RETIDA','CSLL_RETIDA','IRRF_RETIDO','INSS_RETIDO','ISS_RETIDO')
function ReadJson($path){ConvertFrom-Json ([IO.File]::ReadAllText($path))}
function SaveJson($value,$path){[IO.File]::WriteAllText($path,($value|ConvertTo-Json -Depth 100),[Text.UTF8Encoding]::new($false))}
$state=if(Test-Path -LiteralPath $statePath){ReadJson $statePath}else{[pscustomobject]@{}}
function Remember($name,$value){$state|Add-Member -Force -NotePropertyName $name -NotePropertyValue $value;SaveJson $state $statePath}
function Api($method,$path,$body=$null){
 $p=@{Method=$method;Uri=($base+$path);Headers=$auth;TimeoutSec=90}
 if($null -ne $body){$p.ContentType='application/json';$p.Body=[Text.Encoding]::UTF8.GetBytes(($body|ConvertTo-Json -Depth 100))}
 Invoke-RestMethod @p
}
function PatchFlow($id,$definition){
 $old=Api GET ('/flows/'+$id+'?api-version=2016-11-01')
 if($old.properties.state -ne 'Started'){throw 'RETENTION_EXISTING_FLOW_NOT_STARTED'}
 $p=@{properties=@{apiId=$old.properties.apiId;displayName=$old.properties.displayName;state='Started';connectionReferences=$old.properties.connectionReferences;definition=(ReadJson (Join-Path $root $definition))}}
 $new=Api PATCH ('/flows/'+$id+'?api-version=2016-11-01') $p
 if($new.properties.state -ne 'Started'){throw 'RETENTION_PATCH_NOT_STARTED'}
 return $old
}
function StartFlow($id,$payload){
 $connector=Api GET '/apis/shared_logicflows?api-version=2016-11-01'
 $runtime=[Uri]$connector.properties.primaryRuntimeUrl
 if($runtime.Scheme -ne 'https' -or $runtime.Host -notlike '*.azure-apihub.net' -or $runtime.AbsolutePath -ne '/apim/logicflows'){throw 'RETENTION_UNTRUSTED_RUNTIME'}
 $hub=Get-PowerPlatformSessionToken 'https://apihub.azure.com'
 $reply=Invoke-WebRequest -Method POST -Uri ($runtime.AbsoluteUri.TrimEnd('/')+'/'+$id+'/triggers/manual/run?api-version=2016-11-01') -Headers @{Authorization=('Bearer '+$hub)} -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes(($payload|ConvertTo-Json -Depth 20 -Compress))) -TimeoutSec 90
 $run=[string](@($reply.Headers['x-ms-workflow-run-id'])[0])
 if($run -notmatch '^[A-Za-z0-9]+$'){throw 'RETENTION_RUN_ID_MISSING'}
 return $run
}
function RequireRun($id,$run){
 $r=Api GET ('/flows/'+$id+'/runs/'+$run+'?api-version=2016-11-01')
 if($r.properties.status -ne 'Succeeded'){throw ('RETENTION_RUN_'+$r.properties.status)}
}
function ActionBody($id,$run,$action){
 $a=Api GET ('/flows/'+$id+'/runs/'+$run+'/actions/'+$action+'?api-version=2016-11-01')
 $out=Invoke-RestMethod -Uri $a.properties.outputsLink.uri -TimeoutSec 90
 # SharePoint verbose responses can include both Id and ID. Keep their casing.
 if($out -is [string]){$out=ConvertFrom-Json $out -AsHashtable}
 return $out.body
}
if($Mode -eq 'Provision'){
 $null=PatchFlow 'bd5ecf5d-2290-4547-be9f-5568b3bfb27c' 'powerautomate/01-Provisionar-SharePoint.definition.json'
 Remember 'provisionRun' (StartFlow 'bd5ecf5d-2290-4547-be9f-5568b3bfb27c' @{})
 Write-Output 'RETENTION_PROVISION_STARTED'
}elseif($Mode -eq 'Prepare'){
 RequireRun 'bd5ecf5d-2290-4547-be9f-5568b3bfb27c' $state.provisionRun
 $columns=ActionBody 'bd5ecf5d-2290-4547-be9f-5568b3bfb27c' $state.provisionRun 'Verificar_campos'
 foreach($name in @('STATUS_RETENCOES')+$names){
  $col=@($columns.value|Where-Object InternalName -eq $name)
  $expected=if($name -eq 'STATUS_RETENCOES'){'Text'}else{'Currency'}
  if($col.Count -ne 1 -or $col[0].TypeAsString -ne $expected){throw 'RETENTION_COLUMN_NOT_VERIFIED'}
 }
 $old=PatchFlow 'aad7d18a-a45d-4f55-b7d8-daac9596c18b' 'powerautomate/03-Receber-NFe.definition.json'
 Remember 'receiverPatched' $true
 if(-not $state.PSObject.Properties['updateFlow']){
  $created=Api POST '/flows?api-version=2016-11-01' @{properties=@{apiId=$old.properties.apiId;displayName='SEFAZ - Atualizar retencoes de XML arquivado';state='Started';connectionReferences=$old.properties.connectionReferences;definition=(ReadJson (Join-Path $root 'powerautomate/06-Atualizar-Retencoes.definition.json'))}}
  if($created.name -notmatch '^[0-9a-f-]{36}$'){throw 'RETENTION_FLOW_CREATION_NOT_CONFIRMED'}
  Remember 'updateFlow' $created.name
 }
 Remember 'readRun' (StartFlow $state.updateFlow @{source='SEFAZ_XML_ARCHIVE';updates=@()})
 Write-Output 'RETENTION_COLUMNS_RECEIVER_AND_READ_STARTED'
}elseif($Mode -eq 'UpdateHelper'){
 $null=PatchFlow $state.updateFlow 'powerautomate/06-Atualizar-Retencoes.definition.json'
 Remember 'readRun' (StartFlow $state.updateFlow @{source='SEFAZ_XML_ARCHIVE';updates=@()})
 Write-Output 'RETENTION_HELPER_UPDATED_AND_READ_STARTED'
}elseif($Mode -eq 'Read'){
 RequireRun $state.updateFlow $state.readRun
 $body=ActionBody $state.updateFlow $state.readRun 'Revisao'
 if($null -eq $body.d.results){throw 'RETENTION_READ_BODY_MISSING'}
 $safeRows=@($body.d.results|ForEach-Object{
  $row=[ordered]@{CHAVE_ACESSO=$_.CHAVE_ACESSO}
  foreach($name in @('STATUS_RETENCOES')+$names){$row[$name]=$_.$name}
  [pscustomobject]$row
 })
 SaveJson $safeRows (Join-Path $root '.runtime/retencoes-before.json')
 Write-Output ('RETENTION_READ_VERIFIED rows='+@($body.d.results).Count)
}elseif($Mode -eq 'Backfill'){
 Import-Module (Join-Path $root 'src/Sefaz.psm1') -Force -DisableNameChecking
 $index=@{}
 function AddDocument($text,$nsu){
  $d=ConvertFrom-FiscalXml $text $nsu '38626750000146'
  if($d.kind -ne 'nfeProc'){return}
  $fields=[ordered]@{STATUS_RETENCOES=$d.fields.STATUS_RETENCOES}
  foreach($name in $names){$fields[$name]=if($d.fields.Contains($name)){$d.fields[$name]}else{$null}}
  if($index.ContainsKey($d.key) -and (ConvertTo-Json $index[$d.key].fields -Compress) -cne (ConvertTo-Json $fields -Compress)){throw 'RETENTION_CONFLICTING_ARCHIVED_XML'}
  $index[$d.key]=[pscustomobject]@{key=$d.key;fields=$fields}
 }
 foreach($folder in @('Energetica/SefazLive/38626750000146-1/archive','Energetica/SefazGapRecovery/archive','Energetica/SefazGapRecovery/staged','Energetica/SefazKeyRecoveryBatch2/archive')){
  foreach($file in @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA $folder) -Filter '*.json' -File)){
   $d=ReadJson $file.FullName
   if($d.kind -eq 'nfeProc' -and $d.xmlBase64){AddDocument ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($d.xmlBase64))) ([string]$d.nsu)}
  }
 }
 foreach($file in @(@('Energetica/SefazKeyRecovery/xml','Energetica/SefazKeyRecoveryBatch2/xml')|ForEach-Object{Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA $_) -Filter '*.xml' -File})){
  if($file.Name -notmatch '^[A-Z0-9]{44}-(\d{15})-'){throw 'RETENTION_XML_FILENAME'}
  AddDocument ([IO.File]::ReadAllText($file.FullName)) $Matches[1]
 }
 $rows=@(ReadJson (Join-Path $root '.runtime/retencoes-before.json'))
 $updates=@($rows|ForEach-Object{if($index.ContainsKey($_.CHAVE_ACESSO)){$index[$_.CHAVE_ACESSO]}})
 if($updates.Count -eq 0){throw 'RETENTION_NO_ARCHIVED_XML_MATCH'}
 SaveJson $updates (Join-Path $root '.runtime/retencoes-updates.json')
 Remember 'backfillRun' (StartFlow $state.updateFlow @{source='SEFAZ_XML_ARCHIVE';updates=$updates})
 Remember 'backfillCount' $updates.Count
 Write-Output ('RETENTION_BACKFILL_STARTED rows='+$updates.Count)
}else{
 RequireRun $state.updateFlow $state.backfillRun
 $body=ActionBody $state.updateFlow $state.backfillRun 'Revisao'
 $rows=@($body.d.results)
 $before=@(ReadJson (Join-Path $root '.runtime/retencoes-before.json'))
 $updates=@(ReadJson (Join-Path $root '.runtime/retencoes-updates.json'))
 if($rows.Count -ne $before.Count){throw 'RETENTION_ROW_COUNT_CHANGED'}
 $checks=0
 foreach($u in $updates){
  $found=@($rows|Where-Object CHAVE_ACESSO -ceq $u.key)
  if($found.Count -ne 1){throw 'RETENTION_TARGET_NOT_UNIQUE'}
  foreach($name in @('STATUS_RETENCOES')+$names){
   $expected=$u.fields.$name;$actual=$found[0].$name
   if($name -eq 'STATUS_RETENCOES'){if($actual -cne $expected){throw 'RETENTION_STATUS_MISMATCH'}}
   elseif($null -eq $expected){if($null -ne $actual){throw 'RETENTION_ABSENCE_MISMATCH'}}
   elseif([decimal]$actual -ne [decimal]$expected){throw 'RETENTION_AMOUNT_MISMATCH'}
   $checks++
  }
 }
 $proof=[ordered]@{status='RETENTION_METADATA_LIVE_VERIFIED';checkedAt=[DateTimeOffset]::UtcNow.ToString('o');rows=$rows.Count;xmlsAnalyzed=$updates.Count;withholdingInXml=@($updates|Where-Object {$_.fields.STATUS_RETENCOES -eq 'RETENCAO_INFORMADA_XML'}).Count;checks=$checks;fields=@('STATUS_RETENCOES')+$names;provisionRun=$state.provisionRun;receiverPatched=$state.receiverPatched;updateFlow=$state.updateFlow;backfillRun=$state.backfillRun;sefazCalls=0;whatsappCalls=0}
 SaveJson $proof (Join-Path $root 'evidence/retencoes-live.json')
 Write-Output ($proof|ConvertTo-Json -Depth 8 -Compress)
}
