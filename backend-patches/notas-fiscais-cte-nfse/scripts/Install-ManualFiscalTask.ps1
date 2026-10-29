[CmdletBinding()]
param([ValidateSet('Validate','Install')][string]$Mode='Validate',[string]$EvidencePath='')
$ErrorActionPreference='Stop'
if(-not $EvidencePath){$EvidencePath='C:/Users/Public/Documents/Energetica-ManualFiscalTask-'+[guid]::NewGuid().ToString('N')+'.json'}
$native=@'
$ErrorActionPreference='Stop'
$runtime=Join-Path $env:LOCALAPPDATA 'Energetica/Runtime/PowerShell7/pwsh.exe'
$root=Join-Path $env:LOCALAPPDATA 'Energetica/SefazIntegration'
$entry=Join-Path $root 'scripts/Invoke-ManualFiscalSync.ps1'
foreach($file in @($entry,(Join-Path $root 'src/ManualFiscalSync.psm1'),(Join-Path $root 'config/worker.json'),(Join-Path $root 'config/energetica.json'))){if(-not [IO.File]::Exists($file)){throw 'MANUAL_RUNTIME_NOT_INSTALLED'}}
$signature=Get-AuthenticodeSignature -LiteralPath $runtime
if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*Microsoft Corporation*'){throw 'MANUAL_RUNTIME_SIGNATURE_INVALID'}
$name='ENERGETICA-SEFAZ-Sincronizacao-Manual'
$previous=Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if($previous -and [string]$previous.State -eq 'Running'){throw 'MANUAL_TASK_BUSY'}
$action=New-ScheduledTaskAction -Execute $runtime -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -File "'+$entry+'"')
$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force|Out-Null
$saved=Get-ScheduledTask -TaskName $name
if(-not $saved.Settings.Enabled -or -not $saved.Settings.StartWhenAvailable -or $saved.Triggers[0].Repetition.Interval -cne 'PT1M' -or $saved.Actions[0].Execute -cne $runtime){throw 'MANUAL_TASK_NOT_VERIFIED'}
Start-ScheduledTask -TaskName $name
[IO.File]::WriteAllText('__EVIDENCE__',(@{status='INSTALLED';task=$name;enabled=$true;pollInterval='PT1M';startWhenAvailable=$true;dailyTasksUnchanged=$true;at=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
'@
$native=$native.Replace('__EVIDENCE__',$EvidencePath.Replace("'","''"))
$tokens=$null;$errors=$null;$null=[Management.Automation.Language.Parser]::ParseInput($native,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'MANUAL_INSTALLER_PARSE_FAILED'}
if($Mode -ceq 'Validate'){@{status='VALIDATED';tasksChanged=0;governmentRequests=0}|ConvertTo-Json -Compress;return}
$runtime=Join-Path $env:LOCALAPPDATA 'Energetica/Runtime/PowerShell7/pwsh.exe'
$action=New-ScheduledTaskAction -Execute $runtime -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($native)))
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value) -LogonType Interactive -RunLevel Limited
$name='ENERGETICA-SEFAZ-Instalar-Manual-'+[guid]::NewGuid().ToString('N')
Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Settings (New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 3))|Out-Null
Start-ScheduledTask -TaskName $name
@{status='INSTALL_STARTED';task=$name;evidencePath=$EvidencePath}|ConvertTo-Json -Compress
