[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$source=Join-Path $root 'src/Sefaz.psm1'
$hash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
$memory=New-Object IO.MemoryStream
$zip=New-Object IO.Compression.GZipStream($memory,[IO.Compression.CompressionMode]::Compress,$true)
$bytes=[IO.File]::ReadAllBytes($source);$zip.Write($bytes,0,$bytes.Length);$zip.Dispose()
$encoded=[Convert]::ToBase64String($memory.ToArray());$memory.Dispose()
$code=@'
$ErrorActionPreference='Stop'
$names=@('ENERGETICA-SEFAZ-Coletor','ENERGETICA-SEFAZ-Recuperar-Gap')
$enabled=@{};$target=Join-Path $env:LOCALAPPDATA 'Energetica/SefazIntegration/src/Sefaz.psm1'
$cursor=Join-Path $env:LOCALAPPDATA 'Energetica/SefazLive/38626750000146-1/state.json'
$proof=[ordered]@{status='STARTED';sefazCalls=0;whatsappCalls=0;at=[DateTimeOffset]::UtcNow.ToString('o')}
$oldBytes=$null;$changed=$false
try{
 foreach($name in $names){$task=Get-ScheduledTask -TaskName $name;$enabled[$name]=$task.State -ne 'Disabled';Disable-ScheduledTask -TaskName $name|Out-Null}
 $deadline=[DateTimeOffset]::UtcNow.AddMinutes(3)
 while(@($names|ForEach-Object{Get-ScheduledTask $_}|Where-Object State -eq 'Running').Count -gt 0){if([DateTimeOffset]::UtcNow -gt $deadline){throw 'RETENTION_WORKER_NOT_IDLE'};Start-Sleep -Seconds 1}
 $before=(Get-FileHash -LiteralPath $cursor).Hash
 $oldBytes=[IO.File]::ReadAllBytes($target)
 $inputStream=New-Object IO.MemoryStream(,[Convert]::FromBase64String('__MODULE__'))
 $gzip=New-Object IO.Compression.GZipStream($inputStream,[IO.Compression.CompressionMode]::Decompress)
 $out=New-Object IO.MemoryStream
 try{$gzip.CopyTo($out);$temporary=$target+'.retention-update';[IO.File]::WriteAllBytes($temporary,$out.ToArray());[IO.File]::Move($temporary,$target,$true);$changed=$true}finally{$gzip.Dispose();$inputStream.Dispose();$out.Dispose()}
 if((Get-FileHash -LiteralPath $target).Hash -cne '__HASH__'){throw 'RETENTION_NATIVE_HASH_MISMATCH'}
 Import-Module $target -Force -DisableNameChecking
 $key='31261012345678000123550010000001231000001234'
 $xml='<nfeProc><NFe><infNFe Id="NFe'+$key+'"><ide><mod>55</mod></ide><emit><CNPJ>12345678000123</CNPJ></emit><dest><CNPJ>38626750000146</CNPJ></dest><total><ICMSTot><vNF>1000.00</vNF></ICMSTot><retTrib><vRetPrev>110.00</vRetPrev></retTrib></total></infNFe></NFe><protNFe><infProt><cStat>100</cStat></infProt></protNFe></nfeProc>'
 $test=ConvertFrom-FiscalXml $xml '000000000000001' '38626750000146'
 if($test.fields.INSS_RETIDO -ne 110 -or $test.fields.STATUS_RETENCOES -cne 'RETENCAO_INFORMADA_XML'){throw 'RETENTION_NATIVE_SMOKE_FAILED'}
 if((Get-FileHash -LiteralPath $cursor).Hash -cne $before){throw 'RETENTION_CURSOR_CHANGED'}
 $cfg=Get-Content (Join-Path $env:LOCALAPPDATA 'Energetica/SefazIntegration/config/energetica.json') -Raw|ConvertFrom-Json
 $proof.status='INSTALLED';$proof.moduleSha256='__HASH__';$proof.cursorPreserved=$true;$proof.minimumIssueDate=$cfg.minimumIssueDate;$proof.hours=$cfg.scheduleHours
}catch{
 if($changed -and $null -ne $oldBytes){[IO.File]::WriteAllBytes($target,$oldBytes)}
 $proof.status='ERROR';$proof.code=if($_.Exception.Message -match '^RETENTION_[A-Z_]+$'){$_.Exception.Message}else{'RETENTION_NATIVE_ERROR'}
}finally{
 foreach($name in $enabled.Keys){if($enabled[$name]){Enable-ScheduledTask -TaskName $name|Out-Null}}
 $proof.tasks=@($names|ForEach-Object{$task=Get-ScheduledTask $_;@{name=$_;state=[string]$task.State}})
 [IO.File]::WriteAllText('C:/Users/Public/Documents/Energetica-SEFAZ-Retencoes.json',($proof|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
 [IO.File]::Delete($target+'.retention-install.b64')
}
if($proof.status -ne 'INSTALLED'){exit 1}
'@
$transport=Join-Path $env:LOCALAPPDATA 'Energetica/SefazIntegration/src/Sefaz.psm1.retention-install.b64'
$runtime=Join-Path $env:LOCALAPPDATA 'Energetica/Runtime/PowerShell7/pwsh.exe'
$actions=@()
for($offset=0;$offset -lt $encoded.Length;$offset+=6000){
 $part=$encoded.Substring($offset,[Math]::Min(6000,$encoded.Length-$offset))
 $method=if($offset -eq 0){'WriteAllText'}else{'AppendAllText'}
 $piece="[IO.File]::"+$method+"('"+$transport.Replace("'","''")+"','"+$part+"',[Text.UTF8Encoding]::new(`$false))"
 $actions+=New-ScheduledTaskAction -Execute $runtime -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($piece)))
}
$code=$code.Replace("[Convert]::FromBase64String('__MODULE__')","[Convert]::FromBase64String([IO.File]::ReadAllText('"+$transport.Replace("'","''")+"'))").Replace('__HASH__',$hash)
$command=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
if($command.Length -gt 30000){throw 'RETENTION_INSTALL_COMMAND_TOO_LONG'}
$actions+=New-ScheduledTaskAction -Execute $runtime -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand '+$command)
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'ENERGETICA-SEFAZ-Atualizar-Retencoes' -Action $actions -Principal $principal -Settings (New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)) -Force|Out-Null
Start-ScheduledTask -TaskName 'ENERGETICA-SEFAZ-Atualizar-Retencoes'
Write-Output 'RETENTION_NATIVE_INSTALL_STARTED'
