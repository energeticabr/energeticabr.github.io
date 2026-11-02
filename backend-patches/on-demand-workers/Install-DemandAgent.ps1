param(
 [string]$WorkerConfigPath='C:\Users\Bernardonotini\AppData\Local\Energetica\SefazIntegration\config\worker.json',
 [string]$InstallRoot=(Join-Path $env:USERPROFILE '.codex\local-tools\demand-agent'),
 [string]$RemoteScript='/opt/energetica-whatsapp/worker/demand_watch.py'
)
$ErrorActionPreference='Stop'
$names=@('Energetica - DDA consultas pelo aplicativo','ENERGETICA-SEFAZ-Sincronizacao-Manual')
$automatic=@('Energetica - DDA novos avisos WhatsApp','Energetica - DDA reenvio de alertas',
 'Energetica - DDAs Sicoob SharePoint','ENERGETICA-SEFAZ-Coletor','ENERGETICA-SEFAZ-Recuperar-Gap')
$agentName='Energetica - Agente sob demanda'
$root=[IO.Path]::GetFullPath($InstallRoot)
if($root -like '*\AppData\*'){throw 'Use a non-virtualized installation path'}
[IO.Directory]::CreateDirectory($root)|Out-Null
$scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect();$folder=$scheduler.GetFolder('\')
$autoBefore=@{};foreach($name in $automatic){$autoBefore[$name]=$folder.GetTask($name).Xml}
$backup=Join-Path $root ('backups\'+(Get-Date -Format yyyyMMdd-HHmmss)+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
[IO.Directory]::CreateDirectory($backup)|Out-Null
$plan=@()
foreach($name in $names){
 $task=$folder.GetTask($name);$xml=[xml]$task.Xml
 if($task.Definition.Principal.LogonType -ne 3 -or @($xml.Task.Actions.Exec).Count -ne 1){throw 'Unexpected manual task identity or actions'}
 $exec=$xml.Task.Actions.Exec
 if([IO.Path]::GetFileName([string]$exec.Command) -like 'WindowlessTask*.exe'){
  $source=[xml](Get-Content -LiteralPath ([string]$exec.Arguments).Trim('"') -Raw)
  $exe=[string]$source.Launch.Executable;$arguments=[string]$source.Launch.Arguments;$directory=[string]$source.Launch.WorkingDirectory
 }elseif([IO.Path]::GetFileName([string]$exec.Command) -ceq 'pwsh.exe'){
  $exe=[string]$exec.Command;$arguments=[string]$exec.Arguments;$directory=[string]$exec.WorkingDirectory
 }else{throw 'Unexpected manual task executable'}
 if(-not [IO.File]::Exists($exe)){throw 'Missing manual runtime'}
 $index=$plan.Count
 if($index -eq 0){
  if($arguments -notlike '*Invoke-DdaRequestWorker.ps1*'){throw 'Unexpected DDA script'}
  if($arguments -notmatch '(?i)(?:^|\s)-Once(?:\s|$)'){$arguments+=' -Once'}
 }elseif($arguments -notlike '*Invoke-ManualFiscalSync.ps1*'){throw 'Unexpected fiscal script'}
 $original=Join-Path $backup ($index.ToString()+'.xml')
 $task.Xml|Set-Content -LiteralPath $original -Encoding unicode
 $plan+=[pscustomobject]@{Name=$name;Backup=$original;Executable=$exe;Arguments=$arguments;Directory=$directory}
}
$plan|Select-Object Name,Backup|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $backup 'manifest.json') -Encoding utf8
$stopPath=Join-Path $root 'stop'
$existing=Get-ScheduledTask -TaskName $agentName -TaskPath '\' -ErrorAction SilentlyContinue
$oldAgentXml=$null;$wasRunning=$false;$priorStop=[IO.File]::Exists($stopPath)
if($existing){
 $oldAgentXml=$folder.GetTask($agentName).Xml;$wasRunning=$folder.GetTask($agentName).State -in @(2,4)
 $oldAgentXml|Set-Content -LiteralPath (Join-Path $backup 'agent-task.xml') -Encoding unicode
 @{wasRunning=$wasRunning;stopPresent=$priorStop}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $backup 'agent-state.json') -Encoding utf8
}
$files=@('Start-DemandAgent.ps1','DemandAgent.psm1','WindowlessTask.cs')
$hashes=foreach($file in $files){(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $file) -Algorithm SHA256).Hash}
$sourceHash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes(($hashes -join ':')))).Substring(0,16)
$versionRoot=Join-Path $root ('versions\'+$sourceHash)
[IO.Directory]::CreateDirectory($versionRoot)|Out-Null
foreach($file in $files){
 $target=Join-Path $versionRoot $file
 if(-not [IO.File]::Exists($target)){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $target}
}
$launcher=Join-Path $versionRoot 'WindowlessTask.exe'
if(-not [IO.File]::Exists($launcher)){
 & 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /target:winexe /optimize+ /out:$launcher (Join-Path $versionRoot 'WindowlessTask.cs')
 if($LASTEXITCODE){throw 'Native launcher compilation failed'}
}
$worker=Get-Content -LiteralPath $WorkerConfigPath -Raw|ConvertFrom-Json
$config=@{host=$worker.sshHost;keyPath=$worker.sshKeyPath;remoteScript=$RemoteScript;
 tasks=@{dda=$names[0];fiscal=$names[1]};stopPath=$stopPath;
 statusPath=(Join-Path $root 'status.json');logPath=(Join-Path $root 'agent.jsonl')}
$configPath=Join-Path $root 'config.json'
function Save-Launch($Path,$Executable,$Arguments,$Directory){
 $doc=[xml]'<Launch><Executable/><Arguments/><WorkingDirectory/></Launch>'
 $doc.Launch.Executable=$Executable;$doc.Launch.Arguments=$Arguments;$doc.Launch.WorkingDirectory=$Directory
 $doc.Save($Path)
}
$agentLaunch=Join-Path $root 'agent.xml'
$principal=(Get-ScheduledTask -TaskName $names[1]).Principal
$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $principal.UserId
$managed=@('config.json','agent.xml')+@($names|ForEach-Object {$_+'.xml'})
$previousFiles=@{}
foreach($file in $managed){
 $path=Join-Path $root $file
 if([IO.File]::Exists($path)){
  $previousFiles[$file]=[IO.File]::ReadAllBytes($path)
  [IO.Directory]::CreateDirectory((Join-Path $backup 'files'))|Out-Null
  [IO.File]::WriteAllBytes((Join-Path (Join-Path $backup 'files') $file),$previousFiles[$file])
 }
}
try{
 [IO.File]::WriteAllText($stopPath,'stop')
 if($existing){
  $until=[DateTimeOffset]::UtcNow.AddSeconds(10)
  while($folder.GetTask($agentName).State -eq 4 -and [DateTimeOffset]::UtcNow -lt $until){Start-Sleep -Milliseconds 250}
  if($folder.GetTask($agentName).State -in @(2,4)){Stop-ScheduledTask -TaskName $agentName}
 }
 $config|ConvertTo-Json|Set-Content -LiteralPath $configPath -Encoding utf8
 Save-Launch $agentLaunch $plan[1].Executable ('-NoLogo -NoProfile -NonInteractive -File "'+(Join-Path $versionRoot 'Start-DemandAgent.ps1')+'" -ConfigPath "'+$configPath+'"') $root
 Register-ScheduledTask -TaskName $agentName -Action (New-ScheduledTaskAction -Execute $launcher -Argument ('"'+$agentLaunch+'"')) -Principal $principal -Trigger $trigger -Settings $settings -Force|Out-Null
 if([IO.File]::Exists($config.statusPath)){Remove-Item -LiteralPath $config.statusPath}
 Remove-Item -LiteralPath $stopPath
 Start-ScheduledTask -TaskName $agentName
 $until=[DateTimeOffset]::UtcNow.AddSeconds(40);$connected=$false
 do{
  Start-Sleep -Milliseconds 500
  if([IO.File]::Exists($config.statusPath)){$connected=(Get-Content -LiteralPath $config.statusPath -Raw|ConvertFrom-Json).connected}
 }while(-not $connected -and [DateTimeOffset]::UtcNow -lt $until)
 if(-not $connected){throw 'Resident agent could not connect; minute triggers were preserved'}
 foreach($item in $plan){
  $launch=Join-Path $root ($item.Name+'.xml')
  Save-Launch $launch $item.Executable $item.Arguments $item.Directory
  $definition=$folder.GetTask($item.Name).Definition
  $definition.Triggers.Clear()
  $definition.Actions.Clear()
  $action=$definition.Actions.Create(0);$action.Path=$launcher;$action.Arguments='"'+$launch+'"'
  $null=$folder.RegisterTaskDefinition($item.Name,$definition,6,$principal.UserId,$null,3)
  if($folder.GetTask($item.Name).Definition.Triggers.Count -ne 0){throw 'Minute trigger remains'}
 }
 foreach($name in $automatic){if($folder.GetTask($name).Xml -cne $autoBefore[$name]){throw ('Automatic task changed: '+$name)}}
 $deployment=@{at=[DateTimeOffset]::UtcNow.ToString('o');agentTask=$agentName;backup=$backup;manualTasks=$names;automaticSchedulesPreserved=$true;sourceHash=$sourceHash;connected=$true}
 $deployment|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'deployment.json') -Encoding utf8
 $deployment|ConvertTo-Json -Compress
}catch{
 $failure=$_
 [IO.File]::WriteAllText($stopPath,'stop')
 $newAgent=Get-ScheduledTask -TaskName $agentName -ErrorAction SilentlyContinue
 if($newAgent){Stop-ScheduledTask -TaskName $agentName}
 foreach($file in $previousFiles.Keys){[IO.File]::WriteAllBytes((Join-Path $root $file),$previousFiles[$file])}
 foreach($item in $plan){$null=$folder.RegisterTask($item.Name,(Get-Content -LiteralPath $item.Backup -Raw),6,$principal.UserId,$null,3)}
 if($oldAgentXml){
  $null=$folder.RegisterTask($agentName,$oldAgentXml,6,$principal.UserId,$null,3)
  if(-not $priorStop){Remove-Item -LiteralPath $stopPath}
  if($wasRunning -and -not $priorStop){Start-ScheduledTask -TaskName $agentName}
 }elseif($newAgent){Unregister-ScheduledTask -TaskName $agentName -Confirm:$false}
 throw $failure
}
