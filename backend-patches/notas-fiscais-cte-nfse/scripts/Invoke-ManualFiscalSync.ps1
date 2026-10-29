[CmdletBinding()]
param([string]$WorkerConfigPath=(Join-Path $PSScriptRoot '../config/worker.json'),[string]$CollectorConfigPath=(Join-Path $PSScriptRoot '../config/energetica.json'),[string]$FiscalBase=(Join-Path $env:LOCALAPPDATA 'Energetica'))
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/ManualFiscalSync.psm1') -Force -DisableNameChecking
$config=Get-Content -LiteralPath $WorkerConfigPath -Raw|ConvertFrom-Json -DateKind String
$queue={param($operation,$payload) Invoke-ManualFiscalQueue -Config $config -Operation $operation -Payload $payload}.GetNewClosure()
$source={param($name,$id,$record,$save,$renew) Invoke-ManualFiscalSource -Source $name -RequestId $id -Record $record -Save $save -Renew $renew -WorkerConfigPath $WorkerConfigPath -CollectorConfigPath $CollectorConfigPath -FiscalBase $FiscalBase}.GetNewClosure()
try{
 $result=Invoke-ManualFiscalSync -DataRoot (Join-Path $FiscalBase 'SefazManualSync') -Queue $queue -RunSource $source
 @{status=$result.status;requestId=$result.requestId;at=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json -Compress
}catch{
 # Operational logs deliberately omit remote responses and credential paths.
 Write-Output '{"status":"RETRY","code":"MANUAL_SYNC_RETRY"}'
 exit 1
}
