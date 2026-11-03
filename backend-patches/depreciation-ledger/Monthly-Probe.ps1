param([Parameter(Mandatory)][string]$EvidenceRoot,[switch]$Empty,[switch]$Completed,[string]$SessionScript='C:/Users/Bernardonotini/Documents/Codex/2026-10-29/quero-que-desenvolva-para-mim-em/scripts/PowerPlatform-Session.ps1')
$ErrorActionPreference='Stop'
. $SessionScript
$EvidenceRoot=(Resolve-Path -LiteralPath $EvidenceRoot).Path
$base='https://southamerica.api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/200b8072-cebe-e4d7-b154-640eab964ee5'
$headers=@{Authorization='Bearer '+(Get-PowerPlatformSessionToken 'https://service.powerapps.com')}
$hub=@{Authorization='Bearer '+(Get-PowerPlatformSessionToken 'https://apihub.azure.com')}
function Invoke-ProbeApi($method,$path,$body=$null){
 $p=@{Method=$method;Uri=$base+$path;Headers=$headers}
 if($null -ne $body){$p.ContentType='application/json';$p.Body=[Text.Encoding]::UTF8.GetBytes(($body|ConvertTo-Json -Depth 100 -Compress))}
 $r=Invoke-WebRequest @p
 if($r.Content){return ConvertFrom-Json -InputObject $r.Content -AsHashtable}
}
$kind=if($Empty){'empty'}elseif($Completed){'completed'}else{'build'}
$suffix=if($Empty){'-empty'}elseif($Completed){'-completed'}else{''}
& node (Join-Path $PSScriptRoot 'monthly-probe.mjs') $kind (Join-Path $EvidenceRoot 'definition-after.json') (Join-Path $EvidenceRoot "monthly-probe$suffix.json")
if($LASTEXITCODE -ne 0){throw 'Unsafe probe'}
$definition=Get-Content (Join-Path $EvidenceRoot "monthly-probe$suffix.json") -Raw|ConvertFrom-Json -AsHashtable
$flow=Invoke-ProbeApi POST '/flows?api-version=2016-11-01' @{properties=@{apiId='/providers/Microsoft.PowerApps/apis/shared_logicflows';displayName='CODEX - Teste mensal depreciação sem escritas';state='Started';connectionReferences=@{};definition=$definition}}
$id=$flow.name
if($id -notmatch '^[0-9a-f-]{36}$' -or $id -eq '1d482b08-3fe4-468f-9db9-3de1866c104e'){throw 'Invalid owned probe identity'}
try{
 $api=Invoke-ProbeApi GET '/apis/shared_logicflows?api-version=2016-11-01'
 $runtime=[uri]$api.properties.primaryRuntimeUrl
 if($runtime.Scheme -ne 'https' -or $runtime.Host -notlike '*.azure-apihub.net'){throw 'Unexpected runtime'}
 $r=Invoke-WebRequest -Method Post -Uri ($runtime.AbsoluteUri.TrimEnd('/')+'/'+$id+'/triggers/manual/run?api-version=2016-11-01') -Headers $hub -ContentType application/json -Body '{}'
 $run=[string](@($r.Headers['x-ms-workflow-run-id'])[0])
 $deadline=[datetimeoffset]::UtcNow.AddSeconds(50)
 do{
  $status=Invoke-ProbeApi GET ("/flows/$id/runs/"+$run+'?api-version=2016-11-01')
  if($status.properties.status -in @('Succeeded','Failed','Cancelled','TimedOut')){break}
  if([datetimeoffset]::UtcNow -gt $deadline){throw 'Probe pending'}
  Start-Sleep -Seconds 2
 }while($true)
 if($status.properties.status -ne 'Succeeded'){
  $actions=Invoke-ProbeApi GET ("/flows/$id/runs/$run"+'/actions?api-version=2016-11-01')
  $actions.value|Where-Object {$_.properties.status -eq 'Failed'}|ForEach-Object {@{name=$_.name;error=$_.properties.error}|ConvertTo-Json -Depth 20}
  throw ('Probe '+$status.properties.status)
 }
 $action=Invoke-ProbeApi GET ("/flows/$id/runs/$run"+'/actions/Receipt?api-version=2016-11-01')
 $receipt=Invoke-WebRequest -Uri $action.properties.outputsLink.uri
 [IO.File]::WriteAllText((Join-Path $EvidenceRoot "monthly-receipt$suffix.json"),$receipt.Content)
 $verify=if($Empty){'verify-empty'}elseif($Completed){'verify-completed'}else{'verify'}
 & node (Join-Path $PSScriptRoot 'monthly-probe.mjs') $verify (Join-Path $EvidenceRoot "monthly-receipt$suffix.json")
 if($LASTEXITCODE -ne 0){throw 'Receipt verification failed'}
 @{status='ACTUAL_WDL_VERIFIED';id=$id;run=$run;externalWrites=0;empty=[bool]$Empty;definitionHash=(Get-FileHash (Join-Path $EvidenceRoot 'definition-after.json') -Algorithm SHA256).Hash}|ConvertTo-Json|Set-Content (Join-Path $EvidenceRoot "probe-proof$suffix.json")
}finally{
 $null=Invoke-ProbeApi DELETE ("/flows/"+$id+'?api-version=2016-11-01')
 Write-Output 'OWNED_PROBE_REMOVED'
}

