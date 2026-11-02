param([Parameter(Mandatory)][string]$RemoteProbe,[Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($root)|Out-Null
$worker=Get-Content -LiteralPath 'C:\Users\Bernardonotini\AppData\Local\Energetica\SefazIntegration\config\worker.json' -Raw|ConvertFrom-Json
$runtime='C:\Users\Bernardonotini\AppData\Local\Energetica\Runtime\PowerShell7\pwsh.exe'
$name='Energetica-Demand-Probe-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$marker=Join-Path $root 'task-starts.txt'
$stop=Join-Path $root 'stop'
if(Test-Path -LiteralPath $stop){Remove-Item -LiteralPath $stop}
if(Test-Path -LiteralPath $marker){Remove-Item -LiteralPath $marker}
$probe=Join-Path $root 'probe-task.ps1'
@'
param([string]$Marker)
[IO.File]::AppendAllText($Marker,[DateTimeOffset]::UtcNow.ToString('o')+[Environment]::NewLine)
Start-Sleep -Seconds 5
exit 37
'@|Set-Content -LiteralPath $probe -Encoding utf8
$launcher=Join-Path $root 'WindowlessTask.exe'
& 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /target:winexe /optimize+ /out:$launcher (Join-Path $PSScriptRoot 'WindowlessTask.cs')
if($LASTEXITCODE){throw 'Native launcher compilation failed'}
$doc=[xml]'<Launch><Executable/><Arguments/><WorkingDirectory/></Launch>'
$doc.Launch.Executable=$runtime
$doc.Launch.Arguments='-NoProfile -NonInteractive -File "'+$probe+'" -Marker "'+$marker+'"'
$doc.Launch.WorkingDirectory=$root
$taskConfig=Join-Path $root 'task.xml';$doc.Save($taskConfig)
$config=@{host=$worker.sshHost;keyPath=$worker.sshKeyPath;remoteScript=$RemoteProbe;
 tasks=@{dda=$name;fiscal=$name};stopPath=$stop;statusPath=(Join-Path $root 'status.json');logPath=(Join-Path $root 'agent.jsonl')}
$configPath=Join-Path $root 'config.json';$config|ConvertTo-Json|Set-Content -LiteralPath $configPath -Encoding utf8
$principal=(Get-ScheduledTask -TaskName 'ENERGETICA-SEFAZ-Sincronizacao-Manual').Principal
$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $name -Action (New-ScheduledTaskAction -Execute $launcher -Argument ('"'+$taskConfig+'"')) -Principal $principal -Settings $settings|Out-Null
$process=$null
try{
 $psi=[Diagnostics.ProcessStartInfo]::new($runtime)
 $psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
 foreach($arg in @('-NoProfile','-NonInteractive','-File',(Join-Path $PSScriptRoot 'Start-DemandAgent.ps1'),'-ConfigPath',$configPath)){$psi.ArgumentList.Add($arg)}
 $process=[Diagnostics.Process]::Start($psi)
 $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
 $scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect();$folder=$scheduler.GetFolder('\')
 $until=[DateTimeOffset]::UtcNow.AddSeconds(45)
 do{
  if($process.HasExited){throw ('Agent exited: '+$stderr.GetAwaiter().GetResult())}
  Start-Sleep -Milliseconds 500
  $task=$folder.GetTask($name)
 }while([DateTimeOffset]::UtcNow -lt $until -and (-not (Test-Path -LiteralPath $marker) -or $task.State -ne 3))
 if(-not (Test-Path -LiteralPath $marker)){throw 'No event reached the Windows task'}
 if(@(Get-Content -LiteralPath $marker).Count -ne 1){throw 'Duplicate event started duplicate work'}
 if($task.LastTaskResult -ne 37){throw 'Task did not preserve exit code'}
 $status=Get-Content -LiteralPath $config.statusPath -Raw|ConvertFrom-Json
 if($status.connections -lt 2){throw 'Reconnect was not exercised'}
 if(-not $status.connected){throw 'Stream is not connected'}
 Disable-ScheduledTask -TaskName $name|Out-Null
 $until=[DateTimeOffset]::UtcNow.AddSeconds(8)
 do{Start-Sleep -Milliseconds 400;$health=Get-Content -LiteralPath $config.statusPath -Raw|ConvertFrom-Json}while($health.connected -and [DateTimeOffset]::UtcNow -lt $until)
 if($health.connected){throw 'Disabled task was still advertised healthy'}
 $evidence=@{at=[DateTimeOffset]::UtcNow.ToString('o');taskStarts=1;taskExitCode=37;connections=$status.connections;dispatches=$status.dispatches;isolatedQueues=$true;disabledTaskDisconnects=$true}
 $evidence|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'evidence.json') -Encoding utf8
 $evidence|ConvertTo-Json -Compress
}finally{
 [IO.File]::WriteAllText($stop,'stop')
 if($process){if(-not $process.WaitForExit(10000)){$process.Kill($true)};$process.Dispose()}
 Stop-ScheduledTask -TaskName $name
 Unregister-ScheduledTask -TaskName $name -Confirm:$false
}
