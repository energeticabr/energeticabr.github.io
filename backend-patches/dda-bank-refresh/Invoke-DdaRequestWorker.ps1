param([switch]$Once,[int]$IdleSeconds=45)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'DdaWorker.psm1') -Force
$mutex=[Threading.Mutex]::new($false,'Local\EnergeticaDdaRequestWorker')
if(-not $mutex.WaitOne(0)){$mutex.Dispose();exit 0}
try {
    $config=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'worker-config.json') -Raw|ConvertFrom-Json -AsHashtable
    $until=[datetime]::UtcNow.AddSeconds($IdleSeconds)
    do {
        $claim=Invoke-DdaWorkerRemote $config claim
        if($claim.job){
            $id=[string]$claim.job.requestId
            if($id -notmatch '^[a-f0-9]{32}$'){throw 'INVALID_REQUEST_ID'}
            $started=[datetime]::UtcNow
            $psi=[Diagnostics.ProcessStartInfo]::new((Get-Command pwsh.exe).Source)
            foreach($arg in @('-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',(Join-Path $PSScriptRoot 'Sync-DdaSharePoint.ps1'),'-WaitForLockSeconds','1200')){$psi.ArgumentList.Add($arg)}
            $psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
            $process=[Diagnostics.Process]::Start($psi)
            try {
                $output=$process.StandardOutput.ReadToEndAsync();$errors=$process.StandardError.ReadToEndAsync()
                while(-not $process.WaitForExit(15000)){
                    try{Invoke-DdaWorkerRemote $config heartbeat|Out-Null}catch{}
                    if([datetime]::UtcNow -gt $started.AddMinutes(40)){$process.Kill($true);break}
                }
                $process.WaitForExit()
                $receipt=ConvertTo-DdaWorkerReceipt ($output.GetAwaiter().GetResult()) $process.ExitCode $started
                $receipt.requestId=$id
                Invoke-DdaWorkerRemote $config complete $receipt|Out-Null
                @{status=$receipt.status;requestId=$id}|ConvertTo-Json -Compress
            } finally {$process.Dispose()}
        }
        if(-not $Once -and [datetime]::UtcNow -lt $until){Start-Sleep -Seconds 5}
    } while(-not $Once -and [datetime]::UtcNow -lt $until)
} catch {
    @{status='failed';code='DDA_WORKER_FAILED'}|ConvertTo-Json -Compress
    exit 1
} finally {$mutex.ReleaseMutex();$mutex.Dispose()}
