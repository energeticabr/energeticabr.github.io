param([Parameter(Mandatory)][string]$ConfigPath)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'DemandAgent.psm1') -Force
$hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($ConfigPath))))
$mutex=[Threading.Mutex]::new($false,('Local\EnergeticaDemandAgent-'+$hash.Substring(0,16)))
$held=$false
try{
 try{$held=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$held=$true}
 if(-not $held){exit 0}
 $config=Get-Content -LiteralPath $ConfigPath -Raw|ConvertFrom-Json -AsHashtable
 Invoke-DemandAgent $config
}finally{if($held){$mutex.ReleaseMutex()};$mutex.Dispose()}
