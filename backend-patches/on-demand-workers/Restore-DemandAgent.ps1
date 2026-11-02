param([Parameter(Mandatory)][string]$BackupDirectory,[string]$InstallRoot=(Join-Path $env:USERPROFILE '.codex\local-tools\demand-agent'))
$ErrorActionPreference='Stop'
$manifest=Get-Content -LiteralPath (Join-Path $BackupDirectory 'manifest.json') -Raw|ConvertFrom-Json
$allowed=@('Energetica - DDA consultas pelo aplicativo','ENERGETICA-SEFAZ-Sincronizacao-Manual')
if($manifest.Count -ne 2 -or @($manifest|Where-Object {$_.Name -cnotin $allowed}).Count){throw 'Unexpected rollback manifest'}
$s=New-Object -ComObject Schedule.Service;$s.Connect();$folder=$s.GetFolder('\')
[IO.File]::WriteAllText((Join-Path $InstallRoot 'stop'),'stop')
$agent=Get-ScheduledTask -TaskName 'Energetica - Agente sob demanda' -ErrorAction SilentlyContinue
if($agent){Stop-ScheduledTask -TaskName $agent.TaskName;Unregister-ScheduledTask -TaskName $agent.TaskName -Confirm:$false}
foreach($item in $manifest){
 $xml=[xml](Get-Content -LiteralPath $item.Backup -Raw)
 $null=$folder.RegisterTask($item.Name,$xml.OuterXml,6,[string]$xml.Task.Principals.Principal.UserId,$null,3)
 Write-Output ('RESTORED: '+$item.Name)
}
