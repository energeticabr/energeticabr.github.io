$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$configPath=Join-Path $root 'config/worker.json'
$before=if(Test-Path $configPath){(Get-FileHash $configPath).Hash}else{$null}
$output=& (Join-Path $root 'scripts/Install-UnifiedFiscalRuntime.ps1') -Mode Validate
$result=$output|ConvertFrom-Json
foreach($name in @('src/danfe_renderer.py','src/fiscal_document.py','src/national_danfse.py')){
 $entry=@($result.files|Where-Object relative -ceq $name)
 if($entry.Count -ne 1){throw 'LOCAL_PDF_INSTALL_PACKAGE_MISSING'}
 if($entry[0].sha256 -cne (Get-FileHash (Join-Path $root $name)).Hash.ToLowerInvariant()){throw 'LOCAL_PDF_PACKAGE_HASH_INVALID'}
}
if($result.status -cne 'VALIDATED' -or $result.nativeFilesChanged -ne 0 -or $result.governmentRequests -ne 0){throw 'LOCAL_PDF_VALIDATE_SIDE_EFFECT'}
$after=if(Test-Path $configPath){(Get-FileHash $configPath).Hash}else{$null}
if($after -cne $before){throw 'LOCAL_PDF_VALIDATE_CONFIG_MUTATED'}
'LOCAL_PDF_INSTALLER_TESTS_PASSED'
