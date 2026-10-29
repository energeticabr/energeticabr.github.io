[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Key,
    [Parameter(Mandatory)][string]$IssueDate,
    [string]$ConfigPath=(Join-Path $PSScriptRoot '../config/energetica.json'),
    [string]$DataRoot=(Join-Path $env:LOCALAPPDATA 'Energetica/KnownInvoiceDiagnostic'),
    [string]$GapDataRoot=(Join-Path $env:LOCALAPPDATA 'Energetica/SefazGapRecovery'),
    [string]$LiveDataRoot=(Join-Path $env:LOCALAPPDATA 'Energetica/SefazLive')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/GapRecovery.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../src/KnownInvoiceDiagnostic.psm1') -DisableNameChecking
$result=Invoke-KnownInvoiceDiagnostic -Config (Read-GapJson $ConfigPath) -Key $Key -IssueDate $IssueDate -DataRoot $DataRoot -GapDataRoot $GapDataRoot -LiveDataRoot $LiveDataRoot
$result|ConvertTo-Json -Depth 8 -Compress
if($result.status -in @('ERROR','UNCERTAIN')){exit 1}
