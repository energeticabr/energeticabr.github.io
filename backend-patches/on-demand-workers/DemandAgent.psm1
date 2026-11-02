function ConvertFrom-DemandEvent([string]$Line){
 if([string]::IsNullOrWhiteSpace($Line) -or $Line.Length -gt 512){throw 'DEMAND_INVALID_EVENT'}
 $event=$Line|ConvertFrom-Json -AsHashtable -ErrorAction Stop
 if($event -isnot [System.Collections.IDictionary]){throw 'DEMAND_INVALID_EVENT'}
 if($event.event -cin @('ready','heartbeat') -and $event.Count -eq 1){return $event}
 if($event.event -ceq 'wake' -and $event.Count -eq 2 -and $event.queue -cin @('dda','fiscal')){return $event}
 throw 'DEMAND_INVALID_EVENT'
}

function New-DemandConnection($Config){
 if($Config.host -cnotmatch '^[A-Za-z_][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9.-]*$' -or
    $Config.remoteScript -cnotmatch '^/[A-Za-z0-9_./-]+\.py$'){throw 'DEMAND_INVALID_CONFIG'}
 $info=[Diagnostics.ProcessStartInfo]::new('C:\Windows\System32\OpenSSH\ssh.exe')
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.WindowStyle='Hidden'
 $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.RedirectStandardInput=$true
 $info.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
 foreach($arg in @('-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15',
  '-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-i',[string]$Config.keyPath,[string]$Config.host,
  ('sudo -n -u energetica-whatsapp /usr/bin/python3 -u '+$Config.remoteScript))){$info.ArgumentList.Add($arg)}
 return $info
}

function Invoke-DemandDispatch($Event,$TaskMap,$Folder){
 if($Event.event -cne 'wake' -or $Event.queue -cnotin @('dda','fiscal')){throw 'DEMAND_INVALID_DISPATCH'}
 $name=[string]$TaskMap[$Event.queue]
 if([string]::IsNullOrWhiteSpace($name)){throw 'DEMAND_MISSING_TASK'}
 $task=$Folder.GetTask($name)
 if($task.State -in @(2,4)){return 'BUSY'}
 if($task.State -ne 3){throw 'DEMAND_TASK_UNAVAILABLE'}
 $null=$task.Run($null)
 return 'STARTED'
}

function Test-DemandTaskHealth($TaskMap,$Folder){
 foreach($kind in @('dda','fiscal')){
  $task=$Folder.GetTask([string]$TaskMap[$kind])
  if($task.State -notin @(2,3,4) -or $task.Definition.Actions.Count -ne 1 -or
     -not [IO.File]::Exists($task.Definition.Actions.Item(1).Path)) {throw 'DEMAND_TASK_UNAVAILABLE'}
  $action=$task.Definition.Actions.Item(1)
  if([IO.Path]::GetFileName([string]$action.Path) -like 'WindowlessTask*.exe'){
   $path=([string]$action.Arguments).Trim('"')
   if(-not [IO.File]::Exists($path)){throw 'DEMAND_LAUNCH_CONFIG_MISSING'}
   $launch=[xml](Get-Content -LiteralPath $path -Raw)
   if(-not [IO.File]::Exists([string]$launch.Launch.Executable)){throw 'DEMAND_RUNTIME_MISSING'}
  }
 }
}

function Write-DemandStatus($Config,$State){
 $State.updatedAt=[DateTimeOffset]::UtcNow.ToString('o')
 $temporary=$Config.statusPath+'.tmp'
 [IO.File]::WriteAllText($temporary,($State|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
 [IO.File]::Move($temporary,$Config.statusPath,$true)
}

function Write-DemandLog($Config,[string]$Code,[string]$Queue=''){
 $entry=@{at=[DateTimeOffset]::UtcNow.ToString('o');code=$Code}
 if($Queue){$entry.queue=$Queue}
 if([IO.File]::Exists($Config.logPath) -and ([IO.FileInfo]$Config.logPath).Length -gt 262144){
  [IO.File]::Move($Config.logPath,($Config.logPath+'.previous'),$true)
 }
 [IO.File]::AppendAllText($Config.logPath,($entry|ConvertTo-Json -Compress)+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
}

function Invoke-DemandAgent($Config){
 $scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect();$folder=$scheduler.GetFolder('\')
 $status=@{connected=$false;connections=0;dispatches=0;lastQueue=$null;lastDispatchAt=$null}
 $delay=2
 try{
  while(-not [IO.File]::Exists($Config.stopPath)){
   $process=$null
   try{
    Test-DemandTaskHealth $Config.tasks $folder
    $process=[Diagnostics.Process]::new();$process.StartInfo=New-DemandConnection $Config
    if(-not $process.Start()){throw 'DEMAND_CONNECTION_START'}
    $process.StandardInput.Close()
    $errors=$process.StandardError.ReadToEndAsync()
    $lineTask=$process.StandardOutput.ReadLineAsync()
    $lastMessage=[DateTimeOffset]::UtcNow
    while(-not [IO.File]::Exists($Config.stopPath)){
     if(-not $lineTask.Wait(500)){
      if($process.HasExited -or ([DateTimeOffset]::UtcNow-$lastMessage).TotalSeconds -gt 95){throw 'DEMAND_CONNECTION_LOST'}
      continue
     }
     $line=$lineTask.GetAwaiter().GetResult()
     if($null -eq $line){throw 'DEMAND_CONNECTION_CLOSED'}
     $event=ConvertFrom-DemandEvent $line
     $lastMessage=[DateTimeOffset]::UtcNow
     Test-DemandTaskHealth $Config.tasks $folder
     if($event.event -ceq 'ready'){
      $status.connected=$true;$status.connections++;$delay=2
      Write-DemandLog $Config 'CONNECTED'
     }elseif($event.event -ceq 'wake'){
      try{
       $result=Invoke-DemandDispatch $event $Config.tasks $folder
       Write-DemandLog $Config $result $event.queue
       if($result -ceq 'STARTED'){
        $status.dispatches++;$status.lastQueue=$event.queue;$status.lastDispatchAt=[DateTimeOffset]::UtcNow.ToString('o')
       }
      }catch{Write-DemandLog $Config 'DISPATCH_FAILED' $event.queue;throw}
     }
     Write-DemandStatus $Config $status
     $lineTask=$process.StandardOutput.ReadLineAsync()
    }
   }catch{
    $status.connected=$false;Write-DemandStatus $Config $status
    Write-DemandLog $Config 'RECONNECTING'
   }finally{
    if($null -ne $process){
     try{if(-not $process.HasExited){$process.Kill($true)}}catch{}
     $process.Dispose()
    }
   }
   $until=[DateTimeOffset]::UtcNow.AddSeconds($delay)
   while(-not [IO.File]::Exists($Config.stopPath) -and [DateTimeOffset]::UtcNow -lt $until){Start-Sleep -Milliseconds 250}
   $delay=[Math]::Min(60,$delay*2)
  }
 }finally{$status.connected=$false;Write-DemandStatus $Config $status;Write-DemandLog $Config 'STOPPED'}
}
Export-ModuleMember -Function ConvertFrom-DemandEvent,New-DemandConnection,Invoke-DemandDispatch,Invoke-DemandAgent
