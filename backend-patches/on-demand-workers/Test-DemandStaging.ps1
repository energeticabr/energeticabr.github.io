param([Parameter(Mandatory)][string]$InstalledRoot,[Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($root)|Out-Null
foreach($name in @('Install-DemandAgent.ps1','Start-DemandAgent.ps1','DemandAgent.psm1')){
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $root $name) -Force
}
'This is deliberately invalid C# for an isolated staging failure.'|Set-Content -LiteralPath (Join-Path $root 'WindowlessTask.cs')
$scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect();$folder=$scheduler.GetFolder('\')
$task=$folder.GetTask('Energetica - Agente sob demanda');$before=$task.LastRunTime
$definitions=@{};foreach($name in @('Energetica - DDA consultas pelo aplicativo','ENERGETICA-SEFAZ-Sincronizacao-Manual')){$definitions[$name]=$folder.GetTask($name).Xml}
$status=Get-Content -LiteralPath (Join-Path $InstalledRoot 'status.json') -Raw|ConvertFrom-Json
if(-not $status.connected){throw 'Existing agent must be connected for this test'}
$psi=[Diagnostics.ProcessStartInfo]::new((Get-Command pwsh.exe).Source)
$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
foreach($arg in @('-NoProfile','-NonInteractive','-File',(Join-Path $root 'Install-DemandAgent.ps1'),'-InstallRoot',(Join-Path $root 'isolated-install'))){$psi.ArgumentList.Add($arg)}
$process=[Diagnostics.Process]::Start($psi)
$stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
try{
 if(-not $process.WaitForExit(20000)){$process.Kill($true);throw 'Failure probe timed out'}
 if($process.ExitCode -eq 0){throw 'Invalid compiler fixture unexpectedly installed'}
 if($folder.GetTask('Energetica - Agente sob demanda').LastRunTime -ne $before){throw 'Existing agent was restarted by failed staging'}
 if($folder.GetTask('Energetica - Agente sob demanda').State -ne 4){throw 'Existing agent was stopped by failed staging'}
 foreach($name in $definitions.Keys){if($folder.GetTask($name).Xml -cne $definitions[$name]){throw 'Failed staging changed a manual task'}}
 if(-not (Get-Content -LiteralPath (Join-Path $InstalledRoot 'status.json') -Raw|ConvertFrom-Json).connected){throw 'Existing connection was interrupted'}
 Write-Output 'PASS: failed staging preserves the running agent and both task definitions.'
}finally{$process.Dispose()}
