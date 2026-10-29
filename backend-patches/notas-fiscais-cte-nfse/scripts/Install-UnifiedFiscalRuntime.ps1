<#
.SYNOPSIS
Validates or schedules a transactional update of the existing native fiscal runtime.
.EXAMPLE
pwsh -NoProfile -File scripts/Install-UnifiedFiscalRuntime.ps1 -Mode Validate -RunOfflineTests
.EXAMPLE
pwsh -NoProfile -File scripts/Install-UnifiedFiscalRuntime.ps1 -Mode Install
.NOTES
Validate is the default and does not register/start tasks or change native files.
Install copies code only; existing company/worker configuration and fiscal data
are preserved. auxiliaryFiscalEnabled becomes true only after final verification.
No government, SharePoint, SSH or WhatsApp request is made by this installer.
#>
[CmdletBinding()]
param(
    [ValidateSet('Validate','Install')][string]$Mode='Validate',
    [string]$SourceRoot='',
    [string]$EvidencePath='C:/Users/Public/Documents/Energetica-SEFAZ-Unificado.json',
    [switch]$RunOfflineTests
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([string]::IsNullOrWhiteSpace($SourceRoot)){
    $sourceScript=$PSCommandPath
    if([string]::IsNullOrWhiteSpace($sourceScript)){$sourceScript=$MyInvocation.MyCommand.Path}
    if([string]::IsNullOrWhiteSpace($sourceScript)){throw 'UNIFIED_SOURCE_ROOT_REQUIRED'}
    $SourceRoot=Split-Path (Split-Path $sourceScript -Parent) -Parent
}
function Get-UnifiedHash([byte[]]$Bytes){
    $sha=[Security.Cryptography.SHA256]::Create()
    try{return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
}
$files=@('src/Sefaz.psm1','src/Cte.psm1','src/Nfse.psm1','src/FiscalDocuments.psm1','src/AuxiliaryFiscal.psm1',
    'src/FlowTransport.psm1','src/Danfe.psm1','src/SefazWhatsApp.psm1','src/GapRecovery.psm1',
    'scripts/PowerPlatform-Session.ps1','scripts/Invoke-Collector.ps1','scripts/Invoke-SefazWorker.ps1','scripts/Invoke-GapRecovery.ps1',
    'src/danfe_renderer.py','src/fiscal_document.py','src/national_danfse.py')
$root=[IO.Path]::GetFullPath($SourceRoot)
$entries=New-Object 'Collections.Generic.List[object]'
foreach($relative in $files){
    $path=Join-Path $root $relative
    if(-not [IO.File]::Exists($path)){throw 'UNIFIED_SOURCE_MISSING'}
    $bytes=[IO.File]::ReadAllBytes($path)
    $text=[Text.UTF8Encoding]::new($false,$true).GetString($bytes)
    if($relative -notlike '*.py'){
        $tokens=$null;$errors=$null;$null=[Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errors)
        if($errors.Count -ne 0){throw 'UNIFIED_SOURCE_PARSE_FAILED'}
    }
    if($relative -ceq 'scripts/Invoke-SefazWorker.ps1'){
        $hook=$text.IndexOf('auxiliaryFiscalEnabled',[StringComparison]::Ordinal)
        $preflight=$text.IndexOf('SHARED_COOLDOWN_PREFLIGHT',[StringComparison]::Ordinal)
        if($hook -lt 0 -or $preflight -le $hook){throw 'UNIFIED_WORKER_HOOK_MISSING'}
    }
    $entries.Add([pscustomobject]@{relative=$relative;sha256=(Get-UnifiedHash $bytes);length=$bytes.Length;base64=[Convert]::ToBase64String($bytes)})
}
$tests=New-Object 'Collections.Generic.List[object]'
if($RunOfflineTests){
    $exe=(Get-Command pwsh -ErrorAction Stop).Source
    foreach($name in @('Run-Tests.ps1','Cte-Tests.ps1','Nfse-Tests.ps1','FiscalDocuments-Tests.ps1','AuxiliaryFiscal-Tests.ps1')){
        $testPath=Join-Path (Join-Path $root 'tests') $name
        if(-not [IO.File]::Exists($testPath)){throw 'UNIFIED_OFFLINE_TEST_MISSING'}
        $output=@(& $exe -NoProfile -File $testPath 2>&1)
        if($LASTEXITCODE -ne 0){throw 'UNIFIED_OFFLINE_TEST_FAILED'}
        $tests.Add([pscustomobject]@{name=$name;passed=$true})
    }
}
$nativeCode=@'
param($Package,[string]$Staging,[string]$EvidencePath)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Hash-Bytes([byte[]]$Bytes){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function Read-Json([string]$Path){$options=@{};if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){$options.DateKind='String'};return ([IO.File]::ReadAllText($Path)|ConvertFrom-Json @options)}
function Write-Bytes([string]$Path,[byte[]]$Bytes){
 [IO.Directory]::CreateDirectory((Split-Path $Path -Parent))|Out-Null
 $temporary=$Path+'.unified-'+[guid]::NewGuid().ToString('N')+'.tmp'
 try{$f=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$f.Write($Bytes,0,$Bytes.Length);$f.Flush($true)}finally{$f.Dispose()};[IO.File]::Move($temporary,$Path,$true)}finally{if([IO.File]::Exists($temporary)){[IO.File]::Delete($temporary)}}
}
function Json-Bytes($Value){return ,([Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 35 -Compress)))}
function Get-ConfigWithoutFlag($Config){$other=[ordered]@{};foreach($p in $Config.PSObject.Properties){if($p.Name -cne 'auxiliaryFiscalEnabled'){$other[$p.Name]=$p.Value}};return ($other|ConvertTo-Json -Depth 35 -Compress)}
function Snapshot-Data([string[]]$Roots){
 $result=@{}
 foreach($directory in $Roots){if(-not [IO.Directory]::Exists($directory)){continue};foreach($file in @(Get-ChildItem -LiteralPath $directory -Recurse -Force -File)){
  if($file.Extension -ceq '.lock'){continue}
  $result[$file.FullName]=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
 }}
 return ,$result
}
function Assert-Data($Before,[string[]]$Roots){$after=Snapshot-Data $Roots;if($after.Count -ne $Before.Count){throw 'UNIFIED_DATA_CHANGED'};foreach($key in $Before.Keys){if(-not $after.ContainsKey($key) -or $after[$key] -cne $Before[$key]){throw 'UNIFIED_DATA_CHANGED'}}}
function Get-TaskActivity([string[]]$Names){
 $service=New-Object -ComObject 'Schedule.Service';$service.Connect();$folder=$service.GetFolder('\')
 try{foreach($name in $Names){$task=$folder.GetTask($name);try{if([int]$task.State -in @(2,4)){return $true}}finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($task)}};return $false}
 finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($folder);[void][Runtime.InteropServices.Marshal]::ReleaseComObject($service)}
}
$target=Join-Path $env:LOCALAPPDATA 'Energetica/SefazIntegration'
$runtime=Join-Path $env:LOCALAPPDATA 'Energetica/Runtime/PowerShell7/pwsh.exe'
$workerPath=Join-Path $target 'config/worker.json';$collectorPath=Join-Path $target 'config/energetica.json'
$names=@('ENERGETICA-SEFAZ-Coletor','ENERGETICA-SEFAZ-Recuperar-Gap')
$taskStates=@{};$locks=New-Object 'Collections.Generic.List[IDisposable]';$changed=New-Object 'Collections.Generic.List[object]'
$installerLock=$null;$oldWorker=$null;$workerTouched=$false;$verified=$false;$restored=$true;$before=$null;$protected=@()
$proof=[ordered]@{status='STARTED';at=[DateTimeOffset]::UtcNow.ToString('o');governmentRequests=0;sharepointRequests=0;whatsappRequests=0;files=@();dataFilesPreserved=0;configurationPreserved=$false;taskStatesRestored=$false;auxiliaryFiscalEnabled=$false;backupPath=(Join-Path $Staging 'backup')}
function Rollback-Code {
 $ok=$true
 for($index=$changed.Count-1;$index -ge 0;$index--){$entry=$changed[$index];try{
  if($entry.existed){Write-Bytes $entry.path ([IO.File]::ReadAllBytes($entry.backup));if((Get-FileHash -LiteralPath $entry.path -Algorithm SHA256).Hash -cne $entry.oldHash){throw 'UNIFIED_ROLLBACK_HASH'}}
  elseif([IO.File]::Exists($entry.path)){[IO.File]::Delete($entry.path)}
 }catch{$ok=$false}}
 if($workerTouched -and $null -ne $oldWorker){try{Write-Bytes $workerPath $oldWorker}catch{$ok=$false}}
 return $ok
}
try{
 if($PSVersionTable.PSVersion.Major -lt 7){throw 'UNIFIED_POWERSHELL7_REQUIRED'}
 if(-not [IO.Directory]::Exists($target) -or -not [IO.File]::Exists($workerPath) -or -not [IO.File]::Exists($collectorPath)){throw 'UNIFIED_EXISTING_INSTALL_REQUIRED'}
 $installerLock=[IO.File]::Open((Join-Path $target 'unified-install.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 $signature=Get-AuthenticodeSignature -LiteralPath $runtime
 if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*Microsoft Corporation*'){throw 'UNIFIED_RUNTIME_SIGNATURE_INVALID'}
 $allowed=@('src/Sefaz.psm1','src/Cte.psm1','src/Nfse.psm1','src/FiscalDocuments.psm1','src/AuxiliaryFiscal.psm1','src/FlowTransport.psm1','src/Danfe.psm1','src/SefazWhatsApp.psm1','src/GapRecovery.psm1','scripts/PowerPlatform-Session.ps1','scripts/Invoke-Collector.ps1','scripts/Invoke-SefazWorker.ps1','scripts/Invoke-GapRecovery.ps1','src/danfe_renderer.py','src/fiscal_document.py','src/national_danfse.py')
 if(@($Package.files).Count -ne $allowed.Count){throw 'UNIFIED_MANIFEST_INVALID'}
 $seen=@{}
 foreach($entry in $Package.files){
  if($entry.relative -cnotin $allowed -or $seen.ContainsKey([string]$entry.relative)){throw 'UNIFIED_MANIFEST_INVALID'};$seen[[string]$entry.relative]=$true
  $bytes=[Convert]::FromBase64String($entry.base64);if((Hash-Bytes $bytes) -cne $entry.sha256 -or $bytes.Length -ne $entry.length){throw 'UNIFIED_PAYLOAD_HASH_INVALID'}
  $staged=Join-Path (Join-Path $Staging 'files') $entry.relative;Write-Bytes $staged $bytes
 }
 $localPython=Join-Path $env:LOCALAPPDATA 'Energetica/Runtime/FiscalPdf/Scripts/python.exe'
 if(-not [IO.File]::Exists($localPython)){throw 'UNIFIED_LOCAL_PDF_RUNTIME_REQUIRED'}
 $pythonCheck='import pathlib,sys; p=pathlib.Path(sys.argv[1]); [compile(f.read_bytes(),str(f),"exec") for f in p.glob("*.py")]; sys.path.insert(0,str(p)); from national_danfse import font_directory; font_directory(); import danfe_renderer, pypdf'
 $null=& $localPython -B -c $pythonCheck (Join-Path $Staging 'files/src')
 if($LASTEXITCODE -ne 0){throw 'UNIFIED_LOCAL_PDF_PREREQUISITE_FAILED'}
 foreach($name in $names){$task=Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue;if($null -eq $task){if($name -ceq 'ENERGETICA-SEFAZ-Coletor'){throw 'UNIFIED_COLLECTOR_TASK_REQUIRED'};continue};$taskStates[$name]=[bool]$task.Settings.Enabled;Disable-ScheduledTask -TaskName $name|Out-Null}
 $deadline=[DateTimeOffset]::UtcNow.AddMinutes(3)
 while(Get-TaskActivity @($taskStates.Keys)){if([DateTimeOffset]::UtcNow -ge $deadline){throw 'UNIFIED_WORKER_NOT_IDLE'};Start-Sleep -Seconds 1}
 $cfg=Read-Json $collectorPath
 if($cfg.companyCnpj -cne '38626750000146' -or [string]$cfg.environment -cne '1'){throw 'UNIFIED_COMPANY_CONFIG_INVALID'}
 $company=([string]$cfg.companyCnpj)+'-'+([string]$cfg.environment)
 $base=Join-Path $env:LOCALAPPDATA 'Energetica'
 $protected=@('Sefaz','SefazLive','SefazGapRecovery','SefazAuxLive','SefazKeyRecovery','SefazKeyRecoveryBatch2')|ForEach-Object{Join-Path $base $_}
 $evidenceFull=[IO.Path]::GetFullPath($EvidencePath)
 foreach($protectedRoot in $protected){$prefix=[IO.Path]::GetFullPath($protectedRoot).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar;if($evidenceFull.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'UNIFIED_EVIDENCE_OVERLAPS_DATA'}}
 $lockPaths=@((Join-Path $base 'SefazLive/worker.lock'),(Join-Path $base ('SefazLive/'+$company+'/collector.lock')),(Join-Path $base 'SefazGapRecovery/worker.lock'),(Join-Path $base 'SefazGapRecovery/collector.lock'),(Join-Path $base ('SefazAuxLive/'+$company+'/CTE/worker.lock')),(Join-Path $base ('SefazAuxLive/'+$company+'/NFSE/worker.lock')),(Join-Path $base 'SefazLive/notifications/notifications.lock'))
 while($true){
  try{foreach($path in $lockPaths){if([IO.Directory]::Exists((Split-Path $path -Parent))){$locks.Add([IO.File]::Open($path,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None))}};break}
  catch{foreach($handle in $locks){$handle.Dispose()};$locks.Clear();if([DateTimeOffset]::UtcNow -ge $deadline){throw 'UNIFIED_RUNTIME_BUSY'};Start-Sleep -Seconds 1}
 }
 $before=Snapshot-Data $protected
 $collectorHash=(Get-FileHash -LiteralPath $collectorPath -Algorithm SHA256).Hash
 $oldWorker=[IO.File]::ReadAllBytes($workerPath);Write-Bytes (Join-Path $Staging 'backup/config/worker.json') $oldWorker
 $worker=Read-Json $workerPath;$workerOther=Get-ConfigWithoutFlag $worker
 $worker|Add-Member -NotePropertyName auxiliaryFiscalEnabled -NotePropertyValue $false -Force
 $workerTouched=$true;Write-Bytes $workerPath (Json-Bytes $worker)
 foreach($entry in $Package.files){
  $path=Join-Path $target $entry.relative
  $resolved=[IO.Path]::GetFullPath($path);$targetPrefix=[IO.Path]::GetFullPath($target).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
  if(-not $resolved.StartsWith($targetPrefix,[StringComparison]::OrdinalIgnoreCase)){throw 'UNIFIED_TARGET_PATH_INVALID'}
  $exists=[IO.File]::Exists($path);$backup=Join-Path (Join-Path $Staging 'backup') $entry.relative;$oldHash=$null
  if($exists){$oldBytes=[IO.File]::ReadAllBytes($path);$oldHash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash;Write-Bytes $backup $oldBytes}
  $changed.Add([pscustomobject]@{path=$path;existed=$exists;backup=$backup;oldHash=$oldHash})
  Write-Bytes $path ([IO.File]::ReadAllBytes((Join-Path (Join-Path $Staging 'files') $entry.relative)))
  if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256){throw 'UNIFIED_NATIVE_HASH_INVALID'}
  if($entry.relative -notlike '*.py'){
   $tokens=$null;$errors=$null;$null=[Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors);if($errors.Count -ne 0){throw 'UNIFIED_NATIVE_PARSE_FAILED'}
  }
 }
 foreach($name in @('Sefaz','Cte','Nfse','FiscalDocuments','AuxiliaryFiscal','FlowTransport','Danfe','SefazWhatsApp','GapRecovery')){Import-Module (Join-Path $target ('src/'+$name+'.psm1')) -Force -DisableNameChecking}
 foreach($name in @('ConvertFrom-UnifiedFiscalXml','Invoke-CteDistribution','Invoke-NfseDistribution','Invoke-AuxiliaryFiscalScheduledCycle','Send-SefazBatch','Add-SefazDanfe','Invoke-SefazWhatsAppDrain')){if($null -eq (Get-Command $name -ErrorAction SilentlyContinue)){throw 'UNIFIED_NATIVE_COMMAND_MISSING'}}
 . (Join-Path $target 'scripts/Invoke-SefazWorker.ps1')
 if($null -eq (Get-Command Invoke-SefazWorker -ErrorAction SilentlyContinue)){throw 'UNIFIED_WORKER_SMOKE_FAILED'}
 $key='31261012345678000123570010000001231000001234'
 $xml='<cteProc xmlns="http://www.portalfiscal.inf.br/cte"><CTe><infCte Id="CTe'+$key+'"><ide><mod>57</mod><nCT>123</nCT><serie>1</serie><dhEmi>2026-10-02T12:00:00-03:00</dhEmi><toma4><toma>4</toma><CNPJ>38626750000146</CNPJ><xNome>Tomador Ficticio</xNome></toma4></ide><emit><CNPJ>12345678000123</CNPJ><xNome>Transportadora Ficticia</xNome></emit><vPrest><vTPrest>100.00</vTPrest><vRec>90.00</vRec></vPrest></infCte></CTe><protCTe><infProt><chCTe>'+$key+'</chCTe><cStat>100</cStat><nProt>123</nProt></infProt></protCTe></cteProc>'
 $doc=ConvertFrom-UnifiedFiscalXml $xml '000000000000001' '38626750000146'
 if($doc.kind -cne 'cteProc' -or $doc.fields.VALOR_LIQUIDO -ne 90){throw 'UNIFIED_CTE_SMOKE_FAILED'}
 $empty=ConvertFrom-NfseDistributionResponse '{"StatusProcessamento":"NENHUM_DOCUMENTO_LOCALIZADO","LoteDFe":[]}' '38626750000146'
 if($empty.status -cne 'NENHUM_DOCUMENTO_LOCALIZADO' -or @($empty.documents).Count -ne 0){throw 'UNIFIED_NFSE_SMOKE_FAILED'}
 $stub={param($Source,$Config,$DataPath,$Slot,$WorkerConfig,$Now,$MaxBatches)return [pscustomobject]@{source=$Source;status='OFFLINE_SMOKE'}}
 $cycle=Invoke-AuxiliaryFiscalScheduledCycle -Config $cfg -WorkerConfig $worker -DataRoot (Join-Path $Staging 'smoke-data') -Now ([DateTimeOffset]::Parse('2026-10-29T12:00:00Z')) -SourceInvoker $stub
 if(@($cycle.results).Count -ne 2 -or @($cycle.results|Where-Object status -ne 'OFFLINE_SMOKE').Count -ne 0){throw 'UNIFIED_AUXILIARY_SMOKE_FAILED'}
 Assert-Data $before $protected
 if((Get-FileHash -LiteralPath $collectorPath -Algorithm SHA256).Hash -cne $collectorHash -or (Get-ConfigWithoutFlag (Read-Json $workerPath)) -cne $workerOther){throw 'UNIFIED_CONFIG_CHANGED'}
 $verified=$true
}catch{
 $proof.code=if($_.Exception.Message -cmatch '^UNIFIED_[A-Z_]+$'){$_.Exception.Message}else{'UNIFIED_INSTALL_FAILED'}
 $proof.rollbackSucceeded=Rollback-Code
 $proof.status='ERROR'
}finally{
 foreach($name in $taskStates.Keys){try{if($taskStates[$name]){Enable-ScheduledTask -TaskName $name|Out-Null}else{Disable-ScheduledTask -TaskName $name|Out-Null};if([bool](Get-ScheduledTask -TaskName $name).Settings.Enabled -ne $taskStates[$name]){throw 'UNIFIED_TASK_RESTORE_FAILED'}}catch{$restored=$false}}
 $proof.taskStatesRestored=$restored
 if($verified -and $restored){
  try{
   Assert-Data $before $protected
   foreach($entry in $Package.files){if((Get-FileHash -LiteralPath (Join-Path $target $entry.relative) -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256){throw 'UNIFIED_FINAL_HASH_INVALID'}}
   $worker=Read-Json $workerPath
   if((Get-ConfigWithoutFlag $worker) -cne $workerOther -or (Get-FileHash -LiteralPath $collectorPath -Algorithm SHA256).Hash -cne $collectorHash){throw 'UNIFIED_CONFIG_CHANGED'}
   $worker|Add-Member -NotePropertyName auxiliaryFiscalEnabled -NotePropertyValue $true -Force
   Write-Bytes $workerPath (Json-Bytes $worker)
   $final=Read-Json $workerPath
   if($final.auxiliaryFiscalEnabled -ne $true -or (Get-ConfigWithoutFlag $final) -cne $workerOther){throw 'UNIFIED_ENABLE_VERIFY_FAILED'}
   Assert-Data $before $protected
   $proof.status='INSTALLED';$proof.auxiliaryFiscalEnabled=$true;$proof.configurationPreserved=$true;$proof.dataFilesPreserved=$before.Count
   $proof.files=@($Package.files|ForEach-Object{[ordered]@{relative=$_.relative;sha256=$_.sha256}})
  }catch{$proof.status='ERROR';$proof.code=if($_.Exception.Message -cmatch '^UNIFIED_[A-Z_]+$'){$_.Exception.Message}else{'UNIFIED_FINAL_VERIFY_FAILED'};$proof.rollbackSucceeded=Rollback-Code}
 }elseif($verified){$proof.status='ERROR';$proof.code='UNIFIED_TASK_RESTORE_FAILED';$proof.rollbackSucceeded=Rollback-Code}
 foreach($handle in $locks){$handle.Dispose()};if($null -ne $installerLock){$installerLock.Dispose()}
 $proof.tasks=@($taskStates.Keys|ForEach-Object{[ordered]@{name=$_;wasEnabled=$taskStates[$_]}})
 Write-Bytes $EvidencePath (Json-Bytes $proof)
 $transport=Join-Path $Staging 'package.b64';if([IO.File]::Exists($transport)){[IO.File]::Delete($transport)}
}
if($proof.status -cne 'INSTALLED'){exit 1}
'@
$tokens=$null;$errors=$null;$null=[Management.Automation.Language.Parser]::ParseInput($nativeCode,[ref]$tokens,[ref]$errors)
if($errors.Count -ne 0){throw 'UNIFIED_INSTALLER_PARSE_FAILED'}
$package=[ordered]@{version=1;files=@($entries.ToArray());installerScript=$nativeCode}
$packageBytes=[Text.UTF8Encoding]::new($false).GetBytes(($package|ConvertTo-Json -Depth 8 -Compress))
$memory=New-Object IO.MemoryStream;$gzip=New-Object IO.Compression.GZipStream($memory,[IO.Compression.CompressionMode]::Compress,$true)
try{$gzip.Write($packageBytes,0,$packageBytes.Length)}finally{$gzip.Dispose()}
$compressed=$memory.ToArray();$memory.Dispose();$encoded=[Convert]::ToBase64String($compressed)
$packageSha=Get-UnifiedHash $compressed
$actionCount=[int][Math]::Ceiling($encoded.Length/6000.0)+1
if($actionCount -gt 30){throw 'UNIFIED_TRANSPORT_TOO_LARGE'}
foreach($entry in $entries){if((Get-UnifiedHash ([IO.File]::ReadAllBytes((Join-Path $root $entry.relative)))) -cne $entry.sha256){throw 'UNIFIED_SOURCE_CHANGED_RETRY'}}
if($Mode -ceq 'Validate'){
    [ordered]@{status='VALIDATED';nativeFilesChanged=0;tasksChanged=0;governmentRequests=0;sharepointRequests=0;whatsappRequests=0;transportActions=$actionCount;compressedBytes=$compressed.Length;packageSha256=$packageSha;files=@($entries|ForEach-Object{[ordered]@{relative=$_.relative;sha256=$_.sha256;length=$_.length}});tests=@($tests.ToArray())}|ConvertTo-Json -Depth 8 -Compress
    return
}
$runtime=Join-Path $env:LOCALAPPDATA 'Energetica/Runtime/PowerShell7/pwsh.exe'
if(-not [IO.File]::Exists($runtime)){throw 'UNIFIED_EXISTING_RUNTIME_REQUIRED'}
$signature=Get-AuthenticodeSignature -LiteralPath $runtime
if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*Microsoft Corporation*'){throw 'UNIFIED_RUNTIME_SIGNATURE_INVALID'}
$taskName='ENERGETICA-SEFAZ-Instalar-Unificado'
$prior=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if($null -ne $prior){
    $service=New-Object -ComObject 'Schedule.Service';$service.Connect();$folder=$service.GetFolder('\');$priorCom=$null
    try{$priorCom=$folder.GetTask($taskName);if([int]$priorCom.State -in @(2,4)){throw 'UNIFIED_INSTALLER_ALREADY_RUNNING'}}
    finally{if($null -ne $priorCom){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($priorCom)};[void][Runtime.InteropServices.Marshal]::ReleaseComObject($folder);[void][Runtime.InteropServices.Marshal]::ReleaseComObject($service)}
}
$staging=Join-Path $env:LOCALAPPDATA ('Energetica/SefazIntegration/.unified-install/'+[guid]::NewGuid().ToString('N'))
$transport=Join-Path $staging 'package.b64';$literal=$transport.Replace("'","''")
$actions=New-Object 'Collections.Generic.List[object]'
function Add-UnifiedAction([string]$Code){$argument=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Code));if($argument.Length -gt 30000){throw 'UNIFIED_COMMAND_TOO_LONG'};$actions.Add((New-ScheduledTaskAction -Execute $runtime -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand '+$argument)))}
for($offset=0;$offset -lt $encoded.Length;$offset+=6000){
    $part=$encoded.Substring($offset,[Math]::Min(6000,$encoded.Length-$offset));$method=if($offset -eq 0){'WriteAllText'}else{'AppendAllText'}
    Add-UnifiedAction ("`$ErrorActionPreference='Stop';`$p='"+$literal+"';[IO.Directory]::CreateDirectory((Split-Path `$p -Parent))|Out-Null;[IO.File]::"+$method+"(`$p,'"+$part+"',[Text.UTF8Encoding]::new(`$false))")
}
$bootstrap=@'
$ErrorActionPreference='Stop'
$compressed=[Convert]::FromBase64String([IO.File]::ReadAllText('__TRANSPORT__'))
$hash=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($hash.ComputeHash($compressed))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
if($actual -cne '__PACKAGE_SHA__'){throw 'UNIFIED_PACKAGE_HASH_INVALID'}
$stream=[IO.MemoryStream]::new($compressed);$gzip=[IO.Compression.GZipStream]::new($stream,[IO.Compression.CompressionMode]::Decompress);$reader=[IO.StreamReader]::new($gzip,[Text.UTF8Encoding]::new($false,$true))
try{$package=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose();$gzip.Dispose();$stream.Dispose()}
if($package.version -ne 1){throw 'UNIFIED_PACKAGE_VERSION_INVALID'}
$evidence=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__EVIDENCE__'))
& ([scriptblock]::Create($package.installerScript)) -Package $package -Staging '__STAGING__' -EvidencePath $evidence
'@
$bootstrap=$bootstrap.Replace('__TRANSPORT__',$literal).Replace('__PACKAGE_SHA__',$packageSha).Replace('__STAGING__',$staging.Replace("'","''")).Replace('__EVIDENCE__',[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($EvidencePath)))
Add-UnifiedAction $bootstrap
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName $taskName -Action $actions.ToArray() -Principal $principal -Settings $settings -Force|Out-Null
Start-ScheduledTask -TaskName $taskName
[ordered]@{status='INSTALL_STARTED';task=$taskName;actions=$actions.Count;packageSha256=$packageSha;evidencePath=$EvidencePath;governmentRequests=0;sharepointRequests=0;whatsappRequests=0}|ConvertTo-Json -Compress
