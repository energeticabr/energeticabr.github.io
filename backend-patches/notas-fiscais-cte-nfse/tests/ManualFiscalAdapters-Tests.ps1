$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/ManualFiscalSync.psm1') -Force -DisableNameChecking
$base=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')
$root=Join-Path $base ('manual-adapter-test-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root)|Out-Null
$id='d'*32;$slot='manual:'+$id;$company='12345678000195-2'
try{
 $workerPath=Join-Path $root 'worker.json';$configPath=Join-Path $root 'config.json';$key=Join-Path $root 'fixture-key'
 'FAKE TEST ONLY'|Set-Content $key
 @{sshKeyPath=$key;flowId='12345678-1234-1234-1234-123456789012';environmentId='Default-12345678-1234-1234-1234-123456789012';auxiliaryFiscalEnabled=$true;gapRecoveryEnabled=$false}|ConvertTo-Json|Set-Content $workerPath
 @{companyCnpj='12345678000195';environment='2';minimumIssueDate='2026-09-01'}|ConvertTo-Json|Set-Content $configPath
 $record=@{sources=@{NFE=@{deliveredIds=@();result=$null};CTE=@{deliveredIds=@();result=$null};NFSE=@{deliveredIds=@();result=$null}}}
 $options=@{RequestId=$id;Record=$record;Save={};Renew={};WorkerConfigPath=$workerPath;CollectorConfigPath=$configPath;FiscalBase=$root}
 $nfePath=Join-Path $root ('SefazLive/'+$company);[IO.Directory]::CreateDirectory($nfePath)|Out-Null
 $nfeState=Join-Path $nfePath 'state.json'
 @{status='137';nextAllowedAt=[DateTimeOffset]::UtcNow.AddMinutes(65).ToString('o');lastNsu='000000000000001';maxNsu='000000000000001'}|ConvertTo-Json|Set-Content $nfeState
 $before=(Get-FileHash $nfeState).Hash
 $r=Invoke-ManualFiscalSource -Source NFE @options
 if($r.status -cne 'waiting' -or $r.code -cne 'COOLDOWN' -or (Get-FileHash $nfeState).Hash -cne $before){throw ('NFE_COOLDOWN_OR_STATE_NOT_PRESERVED '+($r|ConvertTo-Json -Compress))}
 $doneState=@{status='137';nextAllowedAt=[DateTimeOffset]::UtcNow.AddMinutes(-1).ToString('o');lastNsu='000000000000001';maxNsu='000000000000001'}
 $doneState|ConvertTo-Json|Set-Content $nfeState
 $script:collected=0
 $collect={param($command,$ids)$script:collected++;return [pscustomobject]@{status='137';documents=@();state=[pscustomobject]$doneState}}
 $r=Invoke-ManualFiscalSource -Source NFE @options -NfeCollectorAction $collect
 if($r.status -cne 'succeeded' -or $script:collected -ne 1 -or $record.sources.NFE.result.status -cne 'succeeded'){throw 'REAL_NFE_WORKER_DID_NOT_COLLECT_AND_COMPLETE'}
 $record.sources.NFE=@{deliveredIds=@();result=$null}
 $replay={param($command,$ids)return [pscustomobject]@{status='REPLAY_OUTBOX';documents=@();state=[pscustomobject]$doneState}}
 $r=Invoke-ManualFiscalSource -Source NFE @options -NfeCollectorAction $replay
 if($r.status -cne 'waiting' -or $record.sources.NFE.result.status -ceq 'succeeded'){throw 'OLD_NFE_OUTBOX_FAKED_FRESH_SEARCH'}
 $pending=Join-Path $nfePath 'scope-pending-date';[IO.Directory]::CreateDirectory($pending)|Out-Null
 '{}'|Set-Content (Join-Path $pending 'synthetic-pending.json')
 $record.sources.NFE=@{deliveredIds=@();result=$null}
 $r=Invoke-ManualFiscalSource -Source NFE @options -NfeCollectorAction $collect
 if($r.status -cne 'failed' -or $r.code -cne 'INCOMPLETE'){throw 'PENDING_NFE_DOCUMENT_FAKED_DELIVERY_SUCCESS'}
 foreach($source in @('CTE','NFSE')){
  $path=Join-Path $root ('SefazAuxLive/'+$company+'/'+$source);[IO.Directory]::CreateDirectory($path)|Out-Null
  $state=@{version=1;source=$source;lastNsu='000000000000001';maxNsu='000000000000001';status='COMPLETED';lastCompletedSlot=$slot;pendingSlot=$null;hasMore=$false;awaitingCompletion=$false;nextAllowedAt=[DateTimeOffset]::UtcNow.AddMinutes(65).ToString('o')}
  $state|ConvertTo-Json|Set-Content (Join-Path $path 'state.json')
  $r=Invoke-ManualFiscalSource -Source $source @options
  if($r.status -cne 'succeeded'){throw 'PERSISTED_MANUAL_COMPLETION_NOT_RECOVERED'}
  $state.lastCompletedSlot='2026-10-29-15';$state.pendingSlot='2026-10-29-20';$state.awaitingCompletion=$true
  $state|ConvertTo-Json|Set-Content (Join-Path $path 'state.json')
  $r=Invoke-ManualFiscalSource -Source $source @options
  if($r.status -cne 'waiting' -or $r.code -cne 'COOLDOWN'){throw 'OLDER_DAILY_COMPLETION_FAKED_MANUAL_SUCCESS'}
 }
 Write-Output 'PASS ManualFiscalAdapters 8 assertions; government requests 0'
}finally{
 $resolved=[IO.Path]::GetFullPath($root)
 if((Split-Path $resolved -Parent) -cne $base -or (Split-Path $resolved -Leaf) -notlike 'manual-adapter-test-*'){throw 'UNSAFE_TEST_CLEANUP'}
 Remove-Item -LiteralPath $resolved -Recurse -Force
}
