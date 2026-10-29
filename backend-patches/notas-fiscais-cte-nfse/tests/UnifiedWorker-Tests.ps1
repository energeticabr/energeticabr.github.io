$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/Invoke-SefazWorker.ps1')
$tempBase=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')
$fixture=Join-Path $tempBase ('fiscal-unified-worker-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixture)|Out-Null
try{
 $key=Join-Path $fixture 'fixture-key';[IO.File]::WriteAllText($key,'FAKE TEST ONLY')
 $cfg=Join-Path $fixture 'worker.json'
 @{sshKeyPath=$key;flowId='aad7d18a-a45d-4f55-b7d8-daac9596c18b';environmentId='Default-12345678-1234-1234-1234-123456789012';auxiliaryFiscalEnabled=$true;whatsappEnabled=$false}|ConvertTo-Json|Set-Content $cfg
 $collector=Join-Path $fixture 'collector.json'
 @{companyCnpj='38626750000146';environment='1';minimumIssueDate='2026-10-01';scheduleHours=@(9,15,20);scheduleTimeZone='E. South America Standard Time'}|ConvertTo-Json|Set-Content $collector
 $data=Join-Path $fixture 'SefazLive';$company=Join-Path $data '38626750000146-1';[IO.Directory]::CreateDirectory($company)|Out-Null
 $stateFile=Join-Path $company 'state.json'
 @{lastNsu='000000000001388';maxNsu='000000000001388';status='137';nextAllowedAt=[DateTimeOffset]::UtcNow.AddMinutes(65).ToString('o')}|ConvertTo-Json|Set-Content $stateFile
 $before=(Get-FileHash $stateFile).Hash;$script:aux=0
 $result=Invoke-SefazWorker -WorkerConfigPath $cfg -CollectorConfigPath $collector -DataRoot $data -CollectorAction {throw 'NF-e must not be queried'} -QueueAction {throw 'NF-e queue must not be claimed'} -NotificationDrain {param($c,$r) [pscustomobject]@{status='disabled'}} -AuxiliaryAction {param($c,$w,$r,$n) $script:aux++;if($r -notlike '*SefazAuxLive*38626750000146-1'){throw 'WRONG AUX ROOT'};[pscustomobject]@{status='COMPLETED'}}
 if($result.status -ne 'WAIT' -or $script:aux -ne 1){throw 'Aux sources must run before independent NF-e cooldown'}
 if((Get-FileHash $stateFile).Hash -cne $before){throw 'NF-e cursor changed'}
 $result=Invoke-SefazWorker -WorkerConfigPath $cfg -CollectorConfigPath $collector -DataRoot $data -NotificationDrain {param($c,$r) [pscustomobject]@{status='disabled'}} -AuxiliaryAction {throw 'Aux source unavailable'}
 if($result.status -ne 'WAIT'){throw 'Auxiliary failure must not break NF-e worker'}
 Write-Output 'PASS unified worker: independent cooldown, source failure and preserved NF-e cursor'
}finally{
 $resolved=[IO.Path]::GetFullPath($fixture)
 if((Split-Path $resolved -Parent) -ne $tempBase -or (Split-Path $resolved -Leaf) -notlike 'fiscal-unified-worker-*'){throw 'Unsafe test cleanup path'}
 Remove-Item -LiteralPath $resolved -Recurse -Force
}
