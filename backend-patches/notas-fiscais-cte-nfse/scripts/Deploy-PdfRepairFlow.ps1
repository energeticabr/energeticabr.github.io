[CmdletBinding()]
param([ValidateSet('Create','Run','Check')][string]$Mode='Check',[string]$InputPath)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'PowerPlatform-Session.ps1')
Import-Module (Join-Path $root 'src/FlowTransport.psm1') -DisableNameChecking
$envId='Default-0c10f511-7ede-4702-a2d9-bedb26937e0e'
$base='https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/'+$envId
$auth=@{Authorization=('Bearer '+(Get-PowerPlatformSessionToken 'https://service.powerapps.com'))}
$statePath=Join-Path $root '.runtime/pdf-repair-deploy.json'
$state=if(Test-Path $statePath){Get-Content $statePath -Raw|ConvertFrom-Json}else{[pscustomobject]@{runs=@();confirmed=0}}
function SaveState{[IO.File]::WriteAllText($statePath,($state|ConvertTo-Json -Depth 15),[Text.UTF8Encoding]::new($false))}
function Api($Method,$Suffix,$Body=$null){
 $p=@{Method=$Method;Uri=($base+$Suffix);Headers=$auth;TimeoutSec=90}
 if($null -ne $Body){$p.ContentType='application/json';$p.Body=[Text.Encoding]::UTF8.GetBytes(($Body|ConvertTo-Json -Depth 100 -Compress))}
 Invoke-RestMethod @p
}
function SendPayload($Payload){
 $connector=Api GET '/apis/shared_logicflows?api-version=2016-11-01'
 $uri=[Uri]$connector.properties.primaryRuntimeUrl
 if($uri.Scheme -ne 'https' -or $uri.Host -notlike '*.azure-apihub.net' -or $uri.AbsolutePath -ne '/apim/logicflows'){throw 'PDF_REPAIR_RUNTIME_UNTRUSTED'}
 $hub=Get-PowerPlatformSessionToken 'https://apihub.azure.com'
 $r=Invoke-WebRequest -Method POST -Uri ($uri.AbsoluteUri.TrimEnd('/')+'/'+$state.flowId+'/triggers/manual/run?api-version=2016-11-01') -Headers @{Authorization=('Bearer '+$hub)} -ContentType application/json -Body ([Text.Encoding]::UTF8.GetBytes(($Payload|ConvertTo-Json -Depth 35 -Compress))) -TimeoutSec 90
 $run=[string](@($r.Headers['x-ms-workflow-run-id'])[0]);if($run -cnotmatch '^[A-Za-z0-9]+$'){throw 'PDF_REPAIR_RUN_MISSING'}
 $state.runs=@($state.runs)+@($run);SaveState
 $runBase=$base+'/flows/'+$state.flowId+'/runs/'+$run
 $deadline=[DateTimeOffset]::UtcNow.AddMinutes(6)
 do{
  $s=(Invoke-RestMethod -Uri ($runBase+'?api-version=2016-11-01') -Headers $auth -TimeoutSec 60).properties.status
  if($s -eq 'Succeeded'){break};if($s -in @('Failed','Cancelled','TimedOut','Aborted','Suspended')){throw ('PDF_REPAIR_RUN_'+$s.ToUpperInvariant())}
  if([DateTimeOffset]::UtcNow -ge $deadline){throw 'PDF_REPAIR_WAIT_TIMEOUT'};Start-Sleep -Seconds 2
 }while($true)
 $action=& (Get-Module FlowTransport) {param($Base,$Headers)Get-SefazReceiptAction -RunBase $Base -Headers $Headers} $runBase $auth
 $link=[Uri]$action.properties.outputsLink.uri;if($link.Scheme -ne 'https'){throw 'PDF_REPAIR_ACK_LOCATION_INVALID'}
 $receipt=Invoke-RestMethod -Uri $link.AbsoluteUri -TimeoutSec 60
 if($receipt.source -cne 'FISCAL_PDF_LAYOUT_REPAIR' -or @($receipt.documents).Count -ne @($Payload.documents).Count){throw 'PDF_REPAIR_ACK_INVALID'}
 foreach($d in @($Payload.documents)){
  if(@($receipt.documents|Where-Object {$_.key -ceq $d.key -and $_.pdfSha256 -ceq $d.danfe.sha256}).Count -ne 1){throw 'PDF_REPAIR_ACK_INCOMPLETE'}
 }
 $state.confirmed=[int]$state.confirmed+@($Payload.documents).Count;SaveState
 [pscustomobject]@{run=$run;confirmed=@($Payload.documents).Count}
}
if($Mode -eq 'Create'){
 $old=Api GET '/flows/aad7d18a-a45d-4f55-b7d8-daac9596c18b?api-version=2016-11-01'
 $props=@{apiId=$old.properties.apiId;displayName='ENERGETICA - Corrigir layout dos espelhos NFS-e PDF';state='Started';connectionReferences=$old.properties.connectionReferences;definition=(Get-Content (Join-Path $root 'powerautomate/07-Corrigir-Espelhos-PDF.definition.json') -Raw|ConvertFrom-Json)}
 if($state.PSObject.Properties['flowId']){$flow=Api PATCH ('/flows/'+$state.flowId+'?api-version=2016-11-01') @{properties=$props}}
 else{$flow=Api POST '/flows?api-version=2016-11-01' @{properties=$props};$state|Add-Member -NotePropertyName flowId -NotePropertyValue $flow.name;SaveState}
 if($flow.properties.state -ne 'Started'){throw 'PDF_REPAIR_NOT_STARTED'}
 $smoke=SendPayload @{source='FISCAL_PDF_LAYOUT_REPAIR';companyCnpj='38626750000146';documents=@()}
 [pscustomobject]@{status='PDF_REPAIR_FLOW_EMPTY_ACK_VERIFIED';run=$smoke.run}|ConvertTo-Json -Compress
}elseif($Mode -eq 'Run'){
 if(-not $InputPath){throw 'PDF_REPAIR_INPUT_REQUIRED'}
 $payload=Get-Content -LiteralPath $InputPath -Raw|ConvertFrom-Json
 foreach($d in @($payload.documents)){
  $bytes=[Convert]::FromBase64String($d.danfe.pdfBase64)
  $hash=[Security.Cryptography.SHA256]::Create();try{$digest=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
  if($digest -cne $d.danfe.sha256 -or [Text.Encoding]::ASCII.GetString($bytes,0,5) -cne '%PDF-'){throw 'PDF_REPAIR_PDF_INVALID'}
 }
 for($offset=0;$offset -lt @($payload.documents).Count;$offset+=3){
  $batch=@($payload.documents|Select-Object -Skip $offset -First 3)
  $ack=SendPayload @{source='FISCAL_PDF_LAYOUT_REPAIR';companyCnpj='38626750000146';documents=$batch}
  [pscustomobject]@{status='PDF_REPAIR_BATCH_CONFIRMED';documents=$ack.confirmed;run=$ack.run}|ConvertTo-Json -Compress
 }
}else{
 [pscustomobject]@{flowConfigured=[bool]$state.PSObject.Properties['flowId'];runs=@($state.runs).Count;confirmed=$state.confirmed}|ConvertTo-Json -Compress
}
