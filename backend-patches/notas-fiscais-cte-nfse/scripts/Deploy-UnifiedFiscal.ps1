[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('Provision','Status','Prepare','Verify')][string]$Mode)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'PowerPlatform-Session.ps1')
$environment='Default-0c10f511-7ede-4702-a2d9-bedb26937e0e'
$base='https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/'+$environment
$auth=@{Authorization=('Bearer '+(Get-PowerPlatformSessionToken 'https://service.powerapps.com'))}
$path=Join-Path $root '.runtime/unified-deploy-state.json'
$state=if(Test-Path $path){Get-Content $path -Raw|ConvertFrom-Json}else{[pscustomobject]@{}}
function Remember($name,$value){$state|Add-Member -NotePropertyName $name -NotePropertyValue $value -Force;[IO.File]::WriteAllText($path,($state|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))}
function Api($method,$suffix,$body=$null){
 $p=@{Method=$method;Uri=($base+$suffix);Headers=$auth;TimeoutSec=90}
 if($null -ne $body){$p.ContentType='application/json';$p.Body=[Text.Encoding]::UTF8.GetBytes(($body|ConvertTo-Json -Depth 100))}
 Invoke-RestMethod @p
}
function PatchFlow($id,$file){
 $old=Api GET ('/flows/'+$id+'?api-version=2016-11-01')
 if($old.properties.state -ne 'Started'){throw 'UNIFIED_EXISTING_FLOW_NOT_STARTED'}
 $backup=Join-Path $root ('.runtime/unified-before-'+$id+'.json')
 if(-not(Test-Path $backup)){[IO.File]::WriteAllText($backup,($old.properties.definition|ConvertTo-Json -Depth 100),[Text.UTF8Encoding]::new($false))}
 $definition=Get-Content (Join-Path $root $file) -Raw|ConvertFrom-Json
 $p=@{properties=@{apiId=$old.properties.apiId;displayName=$old.properties.displayName;state='Started';connectionReferences=$old.properties.connectionReferences;definition=$definition}}
 $new=Api PATCH ('/flows/'+$id+'?api-version=2016-11-01') $p
 if($new.properties.state -ne 'Started'){throw 'UNIFIED_PATCH_NOT_STARTED'}
}
function StartFlow($id,$payload){
 $connector=Api GET '/apis/shared_logicflows?api-version=2016-11-01'
 $runtime=[Uri]$connector.properties.primaryRuntimeUrl
 if($runtime.Scheme -ne 'https' -or $runtime.Host -notlike '*.azure-apihub.net' -or $runtime.AbsolutePath -ne '/apim/logicflows'){throw 'UNIFIED_UNTRUSTED_RUNTIME'}
 $hub=Get-PowerPlatformSessionToken 'https://apihub.azure.com'
 $r=Invoke-WebRequest -Method POST -Uri ($runtime.AbsoluteUri.TrimEnd('/')+'/'+$id+'/triggers/manual/run?api-version=2016-11-01') -Headers @{Authorization=('Bearer '+$hub)} -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes(($payload|ConvertTo-Json -Compress -Depth 20))) -TimeoutSec 90
 $run=[string](@($r.Headers['x-ms-workflow-run-id'])[0]);if($run -notmatch '^[A-Za-z0-9]+$'){throw 'UNIFIED_RUN_MISSING'};return $run
}
function RunStatus($id,$run){(Api GET ('/flows/'+$id+'/runs/'+$run+'?api-version=2016-11-01')).properties.status}
function ActionBody($id,$run,$action){
 $a=Api GET ('/flows/'+$id+'/runs/'+$run+'/actions/'+$action+'?api-version=2016-11-01')
 if($a.properties.status -ne 'Succeeded'){throw 'UNIFIED_ACTION_NOT_SUCCEEDED'}
 $out=Invoke-RestMethod -Uri $a.properties.outputsLink.uri -TimeoutSec 90
 if($out -is [string]){$out=ConvertFrom-Json $out -AsHashtable};return $out.body
}
$provision='bd5ecf5d-2290-4547-be9f-5568b3bfb27c';$receiver='aad7d18a-a45d-4f55-b7d8-daac9596c18b'
if($Mode -eq 'Provision'){
 PatchFlow $provision 'powerautomate/01-Provisionar-SharePoint.definition.json'
 Remember provisionRun (StartFlow $provision @{})
 'UNIFIED_PROVISION_STARTED'
}elseif($Mode -eq 'Status'){
 [pscustomobject]@{provision=RunStatus $provision $state.provisionRun}|ConvertTo-Json -Compress
}elseif($Mode -eq 'Prepare'){
 if((RunStatus $provision $state.provisionRun) -ne 'Succeeded'){throw 'UNIFIED_PROVISION_NOT_SUCCEEDED'}
 $key=ActionBody $provision $state.provisionRun 'Verificar_chave_unica'
 if($key.MaxLength -ne 64 -or $key.Indexed -ne $true -or $key.EnforceUniqueValues -ne $true -or $key.Required -ne $true){throw 'UNIFIED_KEY_CONSTRAINTS_NOT_VERIFIED'}
 $columns=ActionBody $provision $state.provisionRun 'Verificar_campos'
 foreach($name in @('TIPO_FISCAL','ORIGEM_FISCAL','TOMADOR','CNPJ_TOMADOR','PAPEL_EMPRESA','MUNICIPIO_PRESTACAO','CODIGO_SERVICO','DATA_EMISSAO_DPS','SERIE_DPS','FONTE_FISCAL','NUMERO_DPS','ORIGEM_DATA_EMISSAO','REMETENTE','CNPJ_REMETENTE','EXPEDIDOR','CNPJ_EXPEDIDOR','RECEBEDOR','CNPJ_RECEBEDOR','PROTOCOLO_EVENTO','SEQUENCIA_EVENTO','STATUS_EVENTO')){
  if(@($columns.value|Where-Object {$_.InternalName -eq $name -and $_.TypeAsString -eq 'Text'}).Count -ne 1){throw ('UNIFIED_TEXT_COLUMN_MISSING_'+$name)}
 }
 foreach($name in @('ISS','VALOR_SERVICOS','DESCONTO_CONDICIONADO','DESCONTO_INCONDICIONADO','VALOR_LIQUIDO_FATURA')){if(@($columns.value|Where-Object {$_.InternalName -eq $name -and $_.TypeAsString -eq 'Currency'}).Count -ne 1){throw 'UNIFIED_CURRENCY_COLUMN_MISSING'}}
 if(@($columns.value|Where-Object {$_.InternalName -eq 'DESCRICAO_SERVICO' -and $_.TypeAsString -eq 'Note'}).Count -ne 1){throw 'UNIFIED_SERVICE_DESCRIPTION_MISSING'}
 PatchFlow $receiver 'powerautomate/03-Receber-NFe.definition.json'
 Remember receiverPatched $true
 Remember columnsVerified $true
 Import-Module (Join-Path $root 'src/FlowTransport.psm1') -Force -DisableNameChecking
 $smoke=Send-SefazBatch -Documents @() -FlowId $receiver -EnvironmentId $environment
 Remember smokeRun $smoke.runId
 'UNIFIED_COLUMNS_RECEIVER_EMPTY_BATCH_VERIFIED'
}else{
 if(-not $state.receiverPatched -or -not $state.columnsVerified -or (RunStatus $receiver $state.smokeRun) -ne 'Succeeded'){throw 'UNIFIED_NOT_VERIFIED'}
 $proof=[ordered]@{status='UNIFIED_RECEIVER_LIVE_VERIFIED';checkedAt=[DateTimeOffset]::UtcNow.ToString('o');keyMaxLength=64;keyUnique=$true;columnsVerified=$true;emptyBatchRun=$state.smokeRun;provisionRun=$state.provisionRun}
 [IO.File]::WriteAllText((Join-Path $root 'evidence/unified-live-flows.json'),($proof|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 $proof|ConvertTo-Json -Compress
}
