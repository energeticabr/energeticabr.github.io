Set-StrictMode -Version Latest
function ConvertTo-DdaWorkerReceipt($Text, [int]$ExitCode, [datetime]$StartedUtc) {
    $failed=@{status='failed';failed=1}
    if($ExitCode -ne 0){return $failed}
    try {
        $lines=@(([string]$Text -split "\r?\n") | Where-Object { $_.Trim().StartsWith('{') })
        if($lines.Count -ne 1){return $failed}
        $value=$lines[0]|ConvertFrom-Json -AsHashtable
        if($value.status -ne 'succeeded' -or $value.failed -ne 0){return $failed}
        $completed=if($value.completedUtc -is [datetime]){$value.completedUtc.ToUniversalTime()}else{[datetimeoffset]::Parse($value.completedUtc,[Globalization.CultureInfo]::InvariantCulture).UtcDateTime}
        if($completed -lt $StartedUtc -or $completed -gt [datetime]::UtcNow.AddMinutes(1)){return $failed}
        $result=@{status='succeeded';failed=0}
        foreach($key in @('created','updated','verified')){
            if($value[$key] -isnot [long] -and $value[$key] -isnot [int]){return $failed}
            if($value[$key] -lt 0 -or $value[$key] -gt 1000000){return $failed}
            $result[$key]=$value[$key]
        }
        if($value.ContainsKey('createdItemIds')){
            $ids=$value.createdItemIds
            if($ids -isnot [array] -or $ids.Count -ne $result.created -or $ids.Count -gt 10000){return $failed}
            $seen=[Collections.Generic.HashSet[int]]::new()
            foreach($id in $ids){
                if(($id -isnot [long] -and $id -isnot [int]) -or $id -lt 1 -or $id -gt [int]::MaxValue){return $failed}
                if(-not $seen.Add([int]$id)){return $failed}
            }
            $result.createdItemIds=@($ids)
        }
        return $result
    } catch { return $failed }
}
function Invoke-DdaWorkerRemote($Config,[ValidateSet('heartbeat','claim','complete')][string]$Operation,$Payload=$null){
    if($Config.host -notmatch '^opc@[a-zA-Z0-9.-]+$'){throw 'INVALID_WORKER_HOST'}
    $psi=[Diagnostics.ProcessStartInfo]::new('C:\Windows\System32\OpenSSH\ssh.exe')
    foreach($arg in @('-T','-i',[string]$Config.keyPath,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2',[string]$Config.host,
        ('sudo -n -u energetica-whatsapp /usr/bin/python3 /opt/energetica-whatsapp/dda_sync.py '+$Operation))){$psi.ArgumentList.Add($arg)}
    $psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
    $psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.RedirectStandardInput=$true
    $process=[Diagnostics.Process]::Start($psi)
    try {
        if($null-ne $Payload){$process.StandardInput.WriteLine(($Payload|ConvertTo-Json -Compress))}
        $process.StandardInput.Close()
        $output=$process.StandardOutput.ReadToEndAsync();$errors=$process.StandardError.ReadToEndAsync()
        if(-not $process.WaitForExit(25000)){$process.Kill($true);throw 'WORKER_CONNECTION_TIMEOUT'}
        if($process.ExitCode -ne 0){throw 'WORKER_CONNECTION_FAILED'}
        return $output.GetAwaiter().GetResult()|ConvertFrom-Json -AsHashtable
    } finally {$process.Dispose()}
}
Export-ModuleMember -Function ConvertTo-DdaWorkerReceipt,Invoke-DdaWorkerRemote
