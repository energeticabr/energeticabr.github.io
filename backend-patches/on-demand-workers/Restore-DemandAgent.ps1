param([Parameter(Mandatory)][string]$BackupDirectory,[string]$InstallRoot=(Join-Path $env:USERPROFILE '.codex\local-tools\demand-agent'))
$ErrorActionPreference='Stop'
$manifest=Get-Content -LiteralPath (Join-Path $BackupDirectory 'manifest.json') -Raw|ConvertFrom-Json
$allowed=@('Energetica - DDA consultas pelo aplicativo','ENERGETICA-SEFAZ-Sincronizacao-Manual')
if($manifest.Count -ne 2 -or @($manifest|Where-Object {$_.Name -cnotin $allowed}).Count){throw 'Unexpected rollback manifest'}
$s=New-Object -ComObject Schedule.Service;$s.Connect();$folder=$s.GetFolder('\')
[IO.File]::WriteAllText((Join-Path $InstallRoot 'stop'),'stop')
$agent=Get-ScheduledTask -TaskName 'Energetica - Agente sob demanda' -ErrorAction SilentlyContinue
if($agent){Stop-ScheduledTask -TaskName $agent.TaskName;Unregister-ScheduledTask -TaskName $agent.TaskName -Confirm:$false}
foreach($name in @('config.json','agent.xml')+@($allowed|ForEach-Object {$_+'.xml'})){
 $saved=Join-Path (Join-Path $BackupDirectory 'files') $name
 if([IO.File]::Exists($saved)){[IO.File]::WriteAllBytes((Join-Path $InstallRoot $name),[IO.File]::ReadAllBytes($saved))}
}
foreach($item in $manifest){
 $xml=[xml](Get-Content -LiteralPath $item.Backup -Raw)
 $null=$folder.RegisterTask($item.Name,$xml.OuterXml,6,[string]$xml.Task.Principals.Principal.UserId,$null,3)
 Write-Output ('RESTORED: '+$item.Name)
}
$previousAgent=Join-Path $BackupDirectory 'agent-task.xml'
if([IO.File]::Exists($previousAgent)){
 $xml=[xml](Get-Content -LiteralPath $previousAgent -Raw)
 $state=Get-Content -LiteralPath (Join-Path $BackupDirectory 'agent-state.json') -Raw|ConvertFrom-Json
 $null=$folder.RegisterTask('Energetica - Agente sob demanda',$xml.OuterXml,6,[string]$xml.Task.Principals.Principal.UserId,$null,3)
 if(-not $state.stopPresent){Remove-Item -LiteralPath (Join-Path $InstallRoot 'stop')}
 if($state.wasRunning -and -not $state.stopPresent){Start-ScheduledTask -TaskName 'Energetica - Agente sob demanda'}
}
