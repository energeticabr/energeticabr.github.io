Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function Invoke-SefazDanfeRenderer($Config,$Request){
    if($PSVersionTable.PSVersion.Major -lt 7){throw 'DANFE_POWERSHELL7_REQUIRED'}
    if($Config.sshHost -notmatch '^[A-Za-z_][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9.-]*$' -or
       $Config.danfePython -notmatch '^/[A-Za-z0-9_./-]+$' -or
       $Config.danfeRenderer -notmatch '^/[A-Za-z0-9_./-]+$'){throw 'DANFE_HOST_CONFIG_INVALID'}
    $info=[Diagnostics.ProcessStartInfo]::new()
    $info.FileName=(Get-Command ssh.exe -ErrorAction Stop).Source
    foreach($arg in @('-T','-o','BatchMode=yes','-o','ConnectTimeout=20','-i',[string]$Config.sshKeyPath,[string]$Config.sshHost,
        ('sudo -n '+$Config.danfePython+' '+$Config.danfeRenderer))){$info.ArgumentList.Add($arg)}
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true
    $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $info.StandardInputEncoding=[Text.UTF8Encoding]::new($false)
    $info.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
    $info.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)
    $process=[Diagnostics.Process]::new();$process.StartInfo=$info
    try{
        if(-not $process.Start()){throw 'DANFE_PROCESS_START'}
        $output=$process.StandardOutput.ReadToEndAsync();$errors=$process.StandardError.ReadToEndAsync()
        $writing=$process.StandardInput.WriteAsync(($Request|ConvertTo-Json -Compress -Depth 10))
        if(-not $writing.Wait(90000)){throw 'DANFE_PROCESS_TIMEOUT'}
        $process.StandardInput.Close()
        if(-not $process.WaitForExit(90000)){throw 'DANFE_PROCESS_TIMEOUT'}
        $text=$output.GetAwaiter().GetResult();$null=$errors.GetAwaiter().GetResult()
        if($process.ExitCode -ne 0 -or $text.Length -gt 2800000){throw 'DANFE_PROCESS_FAILED'}
        try{return ($text|ConvertFrom-Json -ErrorAction Stop)}catch{throw 'DANFE_PROCESS_RESPONSE_INVALID'}
    }finally{
        if(-not $process.HasExited){try{$process.Kill($true)}catch{}}
        $process.Dispose()
    }
}

function Add-SefazDanfe($Document,$Config,[scriptblock]$Render){
    if($Document.kind -notin @('nfeProc','cteProc','cteOSProc','cteSimpProc','NFSe')){return $Document}
    Import-Module (Join-Path $PSScriptRoot 'FiscalDocuments.psm1') -DisableNameChecking
    $request=[ordered]@{key=$Document.key;companyCnpj='38626750000146';xmlSha256=$Document.sha256;xmlBase64=$Document.xmlBase64}
    if($Document.kind -eq 'NFSe' -and $Document.fields.SITUACAO -in @('CANCELADA','SUBSTITUIDA')){$request.fiscalSituation=$Document.fields.SITUACAO}
    if($null -eq $Render){$result=Invoke-SefazDanfeRenderer $Config $request}else{$result=& $Render $Config $request}
    $expected=(Get-FiscalPdfPrefix $Document)+'-'+$Document.key+'-'+$Document.sha256.Substring(0,16)+'.pdf'
    if($null -eq $result -or $result.key -cne $Document.key -or $result.xmlSha256 -cne $Document.sha256 -or
        $result.fileName -cne $expected -or [string]$result.pdfSha256 -cnotmatch '^[0-9a-f]{64}$' -or
        [string]$result.pdfBase64 -notmatch '^[A-Za-z0-9+/]*={0,2}$' -or $result.pdfBase64.Length -gt 2700000){throw 'DANFE_IDENTITY_INVALID'}
    try{$pdf=[Convert]::FromBase64String($result.pdfBase64)}catch{throw 'DANFE_PDF_INVALID'}
    if($pdf.Length -lt 20 -or $pdf.Length -gt 2000000 -or [Text.Encoding]::ASCII.GetString($pdf,0,5) -cne '%PDF-' -or
       [Text.Encoding]::ASCII.GetString($pdf,[Math]::Max(0,$pdf.Length-32),[Math]::Min(32,$pdf.Length)) -notmatch '%%EOF\s*$'){throw 'DANFE_PDF_INVALID'}
    $sha=[Security.Cryptography.SHA256]::Create()
    try{$digest=([BitConverter]::ToString($sha.ComputeHash($pdf))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
    if($digest -cne $result.pdfSha256){throw 'DANFE_PDF_HASH_MISMATCH'}
    $copy=[ordered]@{}
    foreach($property in $Document.PSObject.Properties){$copy[$property.Name]=$property.Value}
    $copy.danfe=[ordered]@{fileName=$expected;pdfBase64=$result.pdfBase64;sha256=$digest}
    return [pscustomobject]$copy
}

Export-ModuleMember -Function Add-SefazDanfe
