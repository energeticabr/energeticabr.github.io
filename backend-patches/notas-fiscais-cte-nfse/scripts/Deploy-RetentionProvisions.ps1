[CmdletBinding()]
param([ValidateSet('Check','Deploy','Verify')][string]$Mode='Check')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'PowerPlatform-Session.ps1')
Import-Module (Join-Path $PSScriptRoot 'RetentionProvisionDeploy.psm1') -Force
$environment='Default-0c10f511-7ede-4702-a2d9-bedb26937e0e'
$base='https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/'+$environment
$receiver='aad7d18a-a45d-4f55-b7d8-daac9596c18b'
$candidatePath=Join-Path $root 'powerautomate/03-Receber-NFe.definition.json'
$candidate=Get-Content -LiteralPath $candidatePath -Raw|ConvertFrom-Json
$auth=@{Authorization=('Bearer '+(Get-PowerPlatformSessionToken 'https://service.powerapps.com'))}
[IO.Directory]::CreateDirectory((Join-Path $root '.runtime'))|Out-Null
[IO.Directory]::CreateDirectory((Join-Path $root 'evidence'))|Out-Null

function Api($method,$suffix,$body=$null){
 $request=@{Method=$method;Uri=($base+$suffix);Headers=$auth;TimeoutSec=90}
 if($null -ne $body){$request.ContentType='application/json';$request.Body=[Text.Encoding]::UTF8.GetBytes(($body|ConvertTo-Json -Depth 100))}
 Invoke-RestMethod @request
}
function Flow(){Api GET ('/flows/'+$receiver+'?api-version=2016-11-01')}
function Canonical($value){ConvertTo-StableJson $value}
function Get-StableSha256($value){
 $bytes=[Text.Encoding]::UTF8.GetBytes((Canonical $value))
 [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}
$previousRetentionActionSha256='1911bb3eeb1c2f80e659213ae5d97d9d52ded435ccbeffcee7d26aa2732eba42'
function Assert-Candidate {
 if($null -eq $candidate.actions.Documentos.actions.Garantir_provisao_retencao -or
    $candidate.actions.Inicializar_total_retencoes.inputs.variables[0].name -cne 'RetentionParentTotal' -or
    $null -eq $candidate.actions.Documentos.actions.Garantir_provisao_retencao.actions.Atualizar_total_rubrica){throw 'RETENTION_PROVISION_CANDIDATE_INVALID'}
}
function Assert-Live($flow){
 if($flow.properties.state -cne 'Started'){throw 'RETENTION_PROVISION_EXISTING_FLOW_NOT_STARTED'}
 $expected=Canonical $candidate.actions.Documentos.actions.Garantir_provisao_retencao
 $actual=Canonical $flow.properties.definition.actions.Documentos.actions.Garantir_provisao_retencao
 if($actual -cne $expected){
  [IO.File]::WriteAllText((Join-Path $root '.runtime/retention-provision-expected-action.json'),$expected,[Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $root '.runtime/retention-provision-actual-action.json'),$actual,[Text.UTF8Encoding]::new($false))
  throw 'RETENTION_PROVISION_ACTION_MISMATCH'
 }
 if((Canonical $flow.properties.definition.actions.Inicializar_total_retencoes) -cne (Canonical $candidate.actions.Inicializar_total_retencoes)){throw 'RETENTION_PROVISION_ACTION_MISMATCH'}
 if($flow.properties.definition.actions.Documentos.actions.Confirmar_id_criado.runAfter.Garantir_provisao_retencao[0] -cne 'Succeeded'){throw 'RETENTION_PROVISION_ACTION_MISMATCH'}
}
function Assert-NoDrift($flow){
 if($flow.properties.state -cne 'Started'){throw 'RETENTION_PROVISION_EXISTING_FLOW_NOT_STARTED'}
 $live=$flow.properties.definition.actions.Documentos.actions
 if($null -ne $live.Garantir_provisao_retencao){
  $currentActionSha256=Get-StableSha256 $live.Garantir_provisao_retencao
  $candidateActionSha256=Get-StableSha256 $candidate.actions.Documentos.actions.Garantir_provisao_retencao
  if($currentActionSha256 -ceq $candidateActionSha256){Assert-Live $flow; return}
  if($currentActionSha256 -cne $previousRetentionActionSha256){throw 'RETENTION_PROVISION_LIVE_DRIFT'}
  if((Canonical $flow.properties.definition.actions.Inicializar_total_retencoes) -cne (Canonical $candidate.actions.Inicializar_total_retencoes)){throw 'RETENTION_PROVISION_LIVE_DRIFT'}
  if($flow.properties.definition.actions.Documentos.actions.Confirmar_id_criado.runAfter.Garantir_provisao_retencao[0] -cne 'Succeeded'){throw 'RETENTION_PROVISION_LIVE_DRIFT'}
  return
 }
 if($null -eq $live.Anexar_DANFE -or $live.Confirmar_id_criado.runAfter.Anexar_DANFE[0] -cne 'Succeeded'){throw 'RETENTION_PROVISION_LIVE_DRIFT'}
}
function Patch-Receiver($old){
 $payload=@{properties=@{apiId=$old.properties.apiId;displayName=$old.properties.displayName;state='Started';connectionReferences=$old.properties.connectionReferences;definition=$candidate}}
 $updated=Api PATCH ('/flows/'+$receiver+'?api-version=2016-11-01') $payload
 if($updated.properties.state -cne 'Started'){throw 'RETENTION_PROVISION_EXISTING_FLOW_NOT_STARTED'}
}
function Restore-Receiver($old){
 $payload=@{properties=@{apiId=$old.properties.apiId;displayName=$old.properties.displayName;state='Started';connectionReferences=$old.properties.connectionReferences;definition=$old.properties.definition}}
 $restored=Api PATCH ('/flows/'+$receiver+'?api-version=2016-11-01') $payload
 if($restored.properties.state -cne 'Started'){throw 'RETENTION_PROVISION_ROLLBACK_FAILED'}
}
function StartFlow($id,$payload){
 $connector=Api GET '/apis/shared_logicflows?api-version=2016-11-01'
 $runtime=[Uri]$connector.properties.primaryRuntimeUrl
 if($runtime.Scheme -ne 'https' -or $runtime.Host -notlike '*.azure-apihub.net' -or $runtime.AbsolutePath -ne '/apim/logicflows'){throw 'RETENTION_PROVISION_UNTRUSTED_RUNTIME'}
 $hub=Get-PowerPlatformSessionToken 'https://apihub.azure.com'
 $response=Invoke-WebRequest -Method POST -Uri ($runtime.AbsoluteUri.TrimEnd('/')+'/'+$id+'/triggers/manual/run?api-version=2016-11-01') -Headers @{Authorization=('Bearer '+$hub)} -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes(($payload|ConvertTo-Json -Compress -Depth 20))) -TimeoutSec 90
 $run=[string](@($response.Headers['x-ms-workflow-run-id'])[0])
 if($run -notmatch '^[A-Za-z0-9]+$'){throw 'RETENTION_PROVISION_RUN_MISSING'}
 return $run
}
function Wait-Run($run){
 $deadline=[DateTimeOffset]::UtcNow.AddSeconds(90)
 do{
  $status=(Api GET ('/flows/'+$receiver+'/runs/'+$run+'?api-version=2016-11-01')).properties.status
  if($status -cin @('Succeeded','Failed','Cancelled')){return $status}
  Start-Sleep -Seconds 3
 }while([DateTimeOffset]::UtcNow -lt $deadline)
 return 'TimedOut'
}
function Smoke {
 $run=StartFlow $receiver @{source='SEFAZ';companyCnpj='38626750000146';documents=@()}
 if((Wait-Run $run) -cne 'Succeeded'){throw 'RETENTION_PROVISION_SMOKE_FAILED'}
 return $run
}

Assert-Candidate
$current=Flow
if($Mode -ceq 'Check'){
 Assert-NoDrift $current
 [pscustomobject]@{status='RETENTION_PROVISION_READY';flow=$receiver;alreadyLive=($null -ne $current.properties.definition.actions.Documentos.actions.Garantir_provisao_retencao)}|ConvertTo-Json -Compress
 exit 0
}
if($Mode -ceq 'Verify'){
 Assert-Live $current
 $run=Smoke
 [pscustomobject]@{status='RETENTION_PROVISIONS_LIVE_VERIFIED';flow=$receiver;smokeRun=$run;checkedAt=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json -Compress
 exit 0
}
Assert-NoDrift $current
$stamp=[DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$backup=Join-Path $root ('.runtime/retention-provisions-before-'+$stamp+'.json')
[IO.File]::WriteAllText($backup,(Canonical $current),[Text.UTF8Encoding]::new($false))
$patched=$false
try{
 Patch-Receiver $current
 $patched=$true
 Assert-Live (Flow)
 $run=Smoke
 $proof=[ordered]@{status='RETENTION_PROVISIONS_LIVE_VERIFIED';flow=$receiver;smokeRun=$run;checkedAt=[DateTimeOffset]::UtcNow.ToString('o');backup=[IO.Path]::GetFileName($backup)}
 [IO.File]::WriteAllText((Join-Path $root 'evidence/retention-provisions-live.json'),($proof|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 $proof|ConvertTo-Json -Compress
}catch{
 if($patched){Restore-Receiver $current}
 throw
}

