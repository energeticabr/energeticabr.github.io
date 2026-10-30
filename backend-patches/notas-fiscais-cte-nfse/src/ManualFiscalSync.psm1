function Write-ManualFiscalJson([string]$Path,$Value){
 [IO.Directory]::CreateDirectory((Split-Path $Path -Parent))|Out-Null
 $temp=$Path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
 try{
  $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 30 -Compress))
  $f=[IO.File]::Open($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$f.Write($bytes,0,$bytes.Length);$f.Flush($true)}finally{$f.Dispose()}
  [IO.File]::Move($temp,$Path,$true)
 }finally{if([IO.File]::Exists($temp)){[IO.File]::Delete($temp)}}
}
function ConvertTo-ManualFiscalCreatedIds($Ids){
 if($Ids -isnot [array]){throw 'MANUAL_CREATED_IDS_INVALID'}
 foreach($id in $Ids){if(($id -isnot [int] -and $id -isnot [long]) -or $id -le 0 -or $id -gt 9007199254740991){throw 'MANUAL_CREATED_IDS_INVALID'}}
 return ,@($Ids|Select-Object -Unique)
}
function Set-ManualFiscalCreationUnknown($Entry){
 $Entry.creationEvidenceUnknown=$true
 if($Entry.Contains('createdItemIds') -and @($Entry.createdItemIds).Count -eq 0){$Entry.Remove('createdItemIds')}
}
function Merge-ManualFiscalCreatedIds($Entry,$Result){
 if($Result.Contains('createdItemIds')){$Result.createdItemIds=ConvertTo-ManualFiscalCreatedIds $Result.createdItemIds}
 if($Entry.creationEvidenceUnknown){
  Set-ManualFiscalCreationUnknown $Entry
  if($Result.Contains('createdItemIds') -and @($Result.createdItemIds).Count -eq 0){$Result.Remove('createdItemIds')}
 }
 if($Entry.Contains('createdItemIds')){
  $additional=@();if($Result.Contains('createdItemIds')){$additional=$Result.createdItemIds}
  $Result.createdItemIds=ConvertTo-ManualFiscalCreatedIds @(@($Entry.createdItemIds)+$additional)
 }
 if($Result.Contains('createdItemIds')){$Entry.createdItemIds=$Result.createdItemIds}
 return $Result
}
function Confirm-ManualFiscalDelivery($Entry,$Documents,$Receipt,[scriptblock]$Save){
 $ids=@($Documents|ForEach-Object{[string]$_.id});$ackIds=@($Receipt.acknowledgedIds)
 if($ackIds.Count -ne $ids.Count -or @($ackIds|Sort-Object -Unique).Count -ne $ids.Count -or @($ids|Where-Object {$_ -cnotin $ackIds}).Count -gt 0){throw 'MANUAL_DELIVERY_ACK'}
 if(@($Entry.deliveredIds).Count -gt 0 -and -not $Entry.Contains('createdItemIds')){$Entry.creationEvidenceUnknown=$true}
 if($Receipt.PSObject.Properties['createdItemIds']){
  $created=ConvertTo-ManualFiscalCreatedIds $Receipt.createdItemIds
  if($created.Count -gt 0 -or $Entry.Contains('createdItemIds') -or -not $Entry.creationEvidenceUnknown){
   $existing=@();if($Entry.Contains('createdItemIds')){$existing=$Entry.createdItemIds}
   $Entry.createdItemIds=ConvertTo-ManualFiscalCreatedIds @($existing+@($created))
  }
 }else{
  Set-ManualFiscalCreationUnknown $Entry
 }
 $Entry.deliveredIds=@(@($Entry.deliveredIds)+$ids|Sort-Object -Unique)
 $Entry.Remove('pendingDeliveryIds')
 & $Save
}
function Invoke-ManualFiscalDelivery($Entry,$Documents,[scriptblock]$Deliver,[scriptblock]$Save){
 # A persisted marker also covers process death before a lost reply can be caught.
 if($Entry.Contains('pendingDeliveryIds') -and @($Entry.pendingDeliveryIds).Count -gt 0){Set-ManualFiscalCreationUnknown $Entry}
 $Entry.pendingDeliveryIds=@($Documents|ForEach-Object{[string]$_.id})
 $null=& $Save
 try{
  $receipt=& $Deliver $Documents
  $null=Confirm-ManualFiscalDelivery $Entry $Documents $receipt $Save
  return $receipt
 }catch{
  Set-ManualFiscalCreationUnknown $Entry
  $null=& $Save
  throw
 }
}
function Assert-ManualFiscalResult($Result){
 if($Result -isnot [Collections.IDictionary] -or $Result.status -cnotin @('succeeded','waiting','failed')){throw 'MANUAL_RESULT_INVALID'}
 if($Result.Contains('documents') -and ($Result.documents -isnot [int] -and $Result.documents -isnot [long] -or $Result.documents -lt 0 -or $Result.documents -gt 1000000)){throw 'MANUAL_RESULT_INVALID'}
 if($Result.Contains('code') -and $Result.code -cnotin @('COOLDOWN','WORKER_UNAVAILABLE','SYNC_FAILED','DELIVERY_PENDING','BUSY','INCOMPLETE')){throw 'MANUAL_RESULT_INVALID'}
 if($Result.Contains('nextAllowedAt')){
  if($Result.status -cne 'waiting'){throw 'MANUAL_RESULT_INVALID'}
  if([string]$Result.nextAllowedAt -cnotmatch '^\d{4}-\d\d-\d\dT'){throw 'MANUAL_RESULT_INVALID'}
  $null=[DateTimeOffset]::Parse([string]$Result.nextAllowedAt,[Globalization.CultureInfo]::InvariantCulture)
 }
 if($Result.status -ceq 'succeeded' -and $Result.Contains('code')){throw 'MANUAL_RESULT_INVALID'}
 if($Result.Contains('createdItemIds')){$null=ConvertTo-ManualFiscalCreatedIds $Result.createdItemIds}
 foreach($key in $Result.Keys){if($key -cnotin @('status','documents','code','nextAllowedAt','createdItemIds')){throw 'MANUAL_RESULT_INVALID'}}
}
function Invoke-ManualFiscalQueue {
 param($Config,[ValidateSet('heartbeat','claim','renew','progress','complete')][string]$Operation,$Payload)
 if([string]$Config.sshHost -cnotmatch '^[A-Za-z_][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9.-]*$' -or -not [IO.File]::Exists([string]$Config.sshKeyPath)){throw 'MANUAL_SSH_CONFIG'}
 $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=(Get-Command ssh.exe -ErrorAction Stop).Source
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 $info.StandardOutputEncoding=[Text.UTF8Encoding]::new($false);$info.StandardInputEncoding=[Text.UTF8Encoding]::new($false)
 foreach($arg in @('-T','-o','BatchMode=yes','-o','ConnectTimeout=20','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2','-i',[string]$Config.sshKeyPath,[string]$Config.sshHost,('sudo -n -u energetica-whatsapp /opt/energetica-whatsapp/.venv/bin/python /opt/energetica-whatsapp/sefaz_sync.py '+$Operation))){$info.ArgumentList.Add($arg)}
 $p=[Diagnostics.Process]::new();$p.StartInfo=$info
 try{
  if(-not $p.Start()){throw 'MANUAL_QUEUE_START'}
  $stdout=$p.StandardOutput.ReadToEndAsync();$stderr=$p.StandardError.ReadToEndAsync()
  if($null -ne $Payload){$json=$Payload|ConvertTo-Json -Depth 12 -Compress;if([Text.Encoding]::UTF8.GetByteCount($json) -gt 65536){throw 'MANUAL_QUEUE_PAYLOAD'};$p.StandardInput.Write($json)}
  $p.StandardInput.Close()
  if(-not $p.WaitForExit(90000)){try{$p.Kill($true)}catch{};throw 'MANUAL_QUEUE_TIMEOUT'}
  $out=$stdout.GetAwaiter().GetResult();$null=$stderr.GetAwaiter().GetResult()
  if($p.ExitCode -ne 0 -or $out.Length -gt 262144){throw 'MANUAL_QUEUE_FAILED'}
  return ($out|ConvertFrom-Json -AsHashtable -DateKind String -ErrorAction Stop)
 }finally{if(-not $p.HasExited){try{$p.Kill($true)}catch{}};$p.Dispose()}
}
function Invoke-ManualFiscalSync {
 param([Parameter(Mandatory)][string]$DataRoot,[Parameter(Mandatory)][scriptblock]$Queue,[Parameter(Mandatory)][scriptblock]$RunSource)
 [IO.Directory]::CreateDirectory($DataRoot)|Out-Null
 try{$lock=[IO.File]::Open((Join-Path $DataRoot 'worker.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch [IO.IOException]{return @{status='BUSY'}}
 try{
  $heartbeat=& $Queue 'heartbeat' $null;if($heartbeat.ok -ne $true){throw 'MANUAL_HEARTBEAT_FAILED'}
  $claim=& $Queue 'claim' $null;if(-not $claim.Contains('job')){throw 'MANUAL_CLAIM_INVALID'}
  $job=$claim.job;if($null -eq $job){return @{status='IDLE'}}
  $id=[string]$job.requestId;$token=[string]$job.leaseToken
  if($id -cnotmatch '^[a-f0-9]{32}$' -or $token -cnotmatch '^[a-f0-9]{64}$'){throw 'MANUAL_CLAIM_INVALID'}
  foreach($source in @('CTE','NFSE','NFE')){if($job.sources[$source].status -cnotin @('queued','running','waiting','succeeded','failed')){throw 'MANUAL_CLAIM_INVALID'}}
  $path=Join-Path $DataRoot ($id+'.json')
  $record=if([IO.File]::Exists($path)){Get-Content -LiteralPath $path -Raw|ConvertFrom-Json -AsHashtable -DateKind String}else{@{version=1;requestId=$id;sources=@{}}}
  if($record.version -ne 1 -or $record.requestId -cne $id){throw 'MANUAL_RECORD_INVALID'}
  foreach($s in @('CTE','NFSE','NFE')){
   if(-not $record.sources.Contains($s)){
    $entry=@{deliveredIds=@();result=$null}
    if($job.sources[$s].Contains('createdItemIds')){$entry.createdItemIds=ConvertTo-ManualFiscalCreatedIds $job.sources[$s].createdItemIds}
    elseif($job.sources[$s].status -ceq 'queued'){$entry.createdItemIds=@()}
    $record.sources[$s]=$entry
   }
  }
  $writer=Get-Command Write-ManualFiscalJson
  $save={& $writer $path $record}.GetNewClosure()
  $renew={$r=& $Queue 'renew' @{requestId=$id;leaseToken=$token};if($r.ok -ne $true){throw 'MANUAL_LEASE_LOST'}}.GetNewClosure()
  foreach($source in @('CTE','NFSE','NFE')){
   if($job.sources[$source].status -cin @('succeeded','failed')){continue}
   $entry=$record.sources[$source];$result=$entry.result
   if($null -eq $result -or $result.status -cnotin @('succeeded','failed')){
    # A source-level cooldown never blocks attempting the other two sources.
    $held=$job.sources[$source].nextAllowedAt
    if($held -and [DateTimeOffset]::Parse([string]$held) -gt [DateTimeOffset]::UtcNow){continue}
    & $renew
    $running=Merge-ManualFiscalCreatedIds $entry @{status='running';documents=@($entry.deliveredIds).Count}
    $ack=& $Queue 'progress' @{requestId=$id;leaseToken=$token;source=$source;result=$running}
    if($ack.ok -ne $true){throw 'MANUAL_PROGRESS_FAILED'}
    try{
     $result=& $RunSource $source $id $record $save $renew;Assert-ManualFiscalResult $result
     if($result.Contains('nextAllowedAt')){$result.nextAllowedAt=[DateTimeOffset]::Parse([string]$result.nextAllowedAt).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'",[Globalization.CultureInfo]::InvariantCulture)}
    }
    catch{
     # Never expose response bodies or invalidate an already durable success.
     $result=if($entry.result -and $entry.result.status -ceq 'succeeded'){$entry.result}else{@{status='waiting';code='SYNC_FAILED';nextAllowedAt=[DateTimeOffset]::UtcNow.AddMinutes(2).ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'",[Globalization.CultureInfo]::InvariantCulture);documents=@($entry.deliveredIds).Count}}
    }
    $result=Merge-ManualFiscalCreatedIds $entry $result
    $entry.result=$result;& $save
   }
   $result=Merge-ManualFiscalCreatedIds $entry $result
   Assert-ManualFiscalResult $result
   $ack=& $Queue 'progress' @{requestId=$id;leaseToken=$token;source=$source;result=$result}
   if($ack.ok -ne $true){throw 'MANUAL_PROGRESS_FAILED'}
  }
  $done=& $Queue 'complete' @{requestId=$id;leaseToken=$token}
  if($done.ok -ne $true -or $done.job.requestId -cne $id){throw 'MANUAL_COMPLETE_FAILED'}
  return $done.job
 }finally{$lock.Dispose()}
}
function Invoke-ManualFiscalSource {
 param([ValidateSet('NFE','CTE','NFSE')][string]$Source,[string]$RequestId,$Record,[scriptblock]$Save,[scriptblock]$Renew,
  [string]$WorkerConfigPath,[string]$CollectorConfigPath,[string]$FiscalBase,[scriptblock]$NfeCollectorAction)
 $worker=Get-Content -LiteralPath $WorkerConfigPath -Raw|ConvertFrom-Json -DateKind String
 $config=Get-Content -LiteralPath $CollectorConfigPath -Raw|ConvertFrom-Json -DateKind String
 $company=$config.companyCnpj+'-'+$config.environment;$slot='manual:'+$RequestId
 $entry=$Record.sources[$Source];$notificationRoot=Join-Path $FiscalBase 'SefazLive/notifications';$sourceRoot=$PSScriptRoot
 $invokeDelivery=Get-Command Invoke-ManualFiscalDelivery
 $sender={param($Documents,$FlowId,$EnvironmentId)
  & $Renew
  Import-Module (Join-Path $sourceRoot 'FlowTransport.psm1') -DisableNameChecking
  $sendCommand=Get-Command Send-SefazBatch
  $deliver={param($Batch) & $sendCommand -Documents $Batch -FlowId $worker.flowId -EnvironmentId $worker.environmentId -NotificationRoot $notificationRoot}.GetNewClosure()
  $receipt=& $invokeDelivery $entry $Documents $deliver $Save
  & $Renew
  return $receipt
 }.GetNewClosure()
 if($Source -ceq 'NFE'){
  # An isolated module preserves the existing worker's private helper scope
  # and prevents script-level defaults from overwriting the caller's paths.
  $nfeModule=New-Module -Name ManualFiscalNfeWorker -ArgumentList (Join-Path $PSScriptRoot '../scripts/Invoke-SefazWorker.ps1') -ScriptBlock {
   param($path)
   . $path
   Export-ModuleMember -Function Invoke-SefazWorker,Invoke-SefazLocalCollector
  }
  $workerCommand=$nfeModule.ExportedCommands['Invoke-SefazWorker']
  $collectorCommand=if($null -ne $NfeCollectorAction){$NfeCollectorAction}else{$nfeModule.ExportedCommands['Invoke-SefazLocalCollector']}
  $collect={param($Command,$Ids)
   if($null -ne $NfeCollectorAction){$response=& $collectorCommand $Command $Ids}
   else{$response=& $collectorCommand -Command $Command -Ids $Ids -ConfigPath $CollectorConfigPath -DataPath (Join-Path $FiscalBase 'SefazLive')}
   if($Command -ceq 'Collect' -and $response.status -cin @('137','138')){$entry.queryObserved=$true;& $Save}
   return $response
  }.GetNewClosure()
  $nfeCompanyPath=Join-Path $FiscalBase ('SefazLive/'+$company)
  $queue={param($Action,$Id,$NextAt,$ErrorCode)
   switch($Action){
    'queue-next'{return [pscustomobject]@{job=[pscustomobject]@{id=1}}}
    'queue-renew'{& $Renew;return [pscustomobject]@{id=1;renewed=$true}}
    'queue-complete'{
     if($entry.queryObserved -eq $true){
      $incomplete=$false
      foreach($folder in @('unhandled-pending','scope-pending-date','outbox')){if(@(Get-ChildItem -LiteralPath (Join-Path $nfeCompanyPath $folder) -Filter '*.json' -File -ErrorAction SilentlyContinue).Count -gt 0){$incomplete=$true}}
      $entry.result=if($incomplete){@{status='failed';code='INCOMPLETE';documents=@($entry.deliveredIds).Count}}else{@{status='succeeded';documents=@($entry.deliveredIds).Count}}
      & $Save
     }
     return [pscustomobject]@{id=1;completed=$true}
    }
    'queue-defer'{return [pscustomobject]@{id=1;deferred=$true}}
    default{throw 'MANUAL_NFE_QUEUE_ACTION'}
   }
  }.GetNewClosure()
  $native=& $workerCommand -WorkerConfigPath $WorkerConfigPath -CollectorConfigPath $CollectorConfigPath -DataRoot (Join-Path $FiscalBase 'SefazLive') -MaxBatches 1 -MaxMinutes 2 -QueueAction $queue -CollectorAction $collect -SendBatch $sender -AuxiliaryAction {param($c,$w,$r,$n) @{status='MANUAL_SEPARATE'}} -NotificationDrain {param($c,$r) @{status='MANUAL_SEPARATE'}}
  if($native.status -ceq 'COMPLETED' -and $entry.result.status -cin @('succeeded','failed')){return $entry.result}
  $statePath=Join-Path $FiscalBase ('SefazLive/'+$company+'/state.json')
  $nfeState=if([IO.File]::Exists($statePath)){Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json -DateKind String}else{$null}
  $next=if($native.nextAllowedAt){[string]$native.nextAllowedAt}elseif($nfeState.nextAllowedAt -and [DateTimeOffset]::Parse([string]$nfeState.nextAllowedAt) -gt [DateTimeOffset]::UtcNow){[string]$nfeState.nextAllowedAt}else{[DateTimeOffset]::UtcNow.AddMinutes(1).ToString('o')}
  return @{status='waiting';code=$(if($native.status -cin @('WAIT','DEFERRED')){'COOLDOWN'}elseif($native.status -ceq 'BUSY'){'BUSY'}else{'SYNC_FAILED'});nextAllowedAt=$next;documents=@($entry.deliveredIds).Count}
 }
 Import-Module (Join-Path $PSScriptRoot 'AuxiliaryFiscal.psm1') -DisableNameChecking
 $path=Join-Path $FiscalBase ('SefazAuxLive/'+$company+'/'+$Source)
 $native=Invoke-AuxiliaryFiscalSource -Source $Source -Config $config -WorkerConfig $worker -DataPath $path -Slot $slot -MaxBatches 1 -SendBatch $sender
 if($native.status -cin @('COMPLETED','ALREADY_COMPLETED') -and $native.lastCompletedManualSlot -ceq $slot){
  $incomplete=$false
  foreach($folder in @('unhandled-pending','scope-pending-date','outbox')){if(@(Get-ChildItem -LiteralPath (Join-Path $path $folder) -Filter '*.json' -File -ErrorAction SilentlyContinue).Count -gt 0){$incomplete=$true}}
  if($incomplete){return @{status='failed';code='INCOMPLETE';documents=@($entry.deliveredIds).Count}}
  return @{status='succeeded';documents=@($entry.deliveredIds).Count}
 }
 $statePath=Join-Path $path 'state.json';$next=[DateTimeOffset]::UtcNow.AddMinutes(1)
 if([IO.File]::Exists($statePath)){$s=Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json -DateKind String;if($s.nextAllowedAt){$held=[DateTimeOffset]::Parse([string]$s.nextAllowedAt);if($held -gt $next){$next=$held}}}
 return @{status='waiting';code=$(if($native.status -ceq 'LOCK_BUSY'){'BUSY'}elseif($native.status -ceq 'PAGE_LIMIT'){'DELIVERY_PENDING'}else{'COOLDOWN'});nextAllowedAt=$next.ToString('o');documents=@($entry.deliveredIds).Count}
}
Export-ModuleMember -Function Invoke-ManualFiscalSync,Invoke-ManualFiscalSource,Invoke-ManualFiscalQueue
