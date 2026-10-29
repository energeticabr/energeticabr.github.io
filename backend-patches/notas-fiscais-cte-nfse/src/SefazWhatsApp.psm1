Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Sefaz.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'FiscalDocuments.psm1') -DisableNameChecking

function Write-SefazNotificationJson([string]$Path,$Value){
    [IO.Directory]::CreateDirectory((Split-Path $Path -Parent))|Out-Null
    $temporary=$Path+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
    $bytes=[Text.Encoding]::UTF8.GetBytes(($Value|ConvertTo-Json -Depth 35 -Compress))
    $stream=New-Object IO.FileStream($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
    try{
        if([IO.File]::Exists($Path)){
            $backup=$temporary+'.backup'
            [IO.File]::Replace($temporary,$Path,$backup)
            [IO.File]::Delete($backup)
        }else{[IO.File]::Move($temporary,$Path)}
    }finally{if([IO.File]::Exists($temporary)){[IO.File]::Delete($temporary)}}
}

function Get-SefazNotificationBlockPath([string]$Root,[string]$Key){
    if($Key -cnotmatch '^(?:\d{6}[A-Z0-9]{12}\d{26}|\d{50})$'){throw 'WHATSAPP_DOCUMENT_INVALID'}
    return Join-Path (Join-Path $Root 'fiscal-blocks') ($Key+'.json')
}

function Test-SefazNotificationBlocked([string]$Root,[string]$Key){
    $path=Get-SefazNotificationBlockPath $Root $Key
    if(-not [IO.File]::Exists($path)){return $false}
    $block=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
    if($block.version -ne 1 -or $block.source -cne 'SEFAZ' -or $block.key -cne $Key -or $block.fiscalSituation -cnotin @('CANCELADA','SUBSTITUIDA')){throw 'WHATSAPP_FISCAL_BLOCK_INVALID'}
    return $true
}

function Set-SefazPendingNotificationSuppressed([string]$Root,[string]$Key){
    $path=Join-Path $Root ($Key+'.json')
    if(-not [IO.File]::Exists($path)){return}
    $item=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
    if($item.request.document.key -cne $Key){throw 'WHATSAPP_QUEUE_IDENTITY_INVALID'}
    # A local tombstone cannot recall an item already handed to the remote queue.
    if($item.state -cne 'pending'){return}
    $item.state='suppressed';$item.code='FISCAL_CANCELLED_OR_SUBSTITUTED';$item.nextRetryAt=$null
    Write-SefazNotificationJson $path $item
}

function Save-SefazWhatsAppNotification([object[]]$Documents,$Receipt,[string]$Root){
    if($null -eq $Receipt -or $Receipt.source -cne 'SEFAZ'){throw 'WHATSAPP_FISCAL_RECEIPT_REQUIRED'}
    foreach($doc in $Documents){
        if(@($Receipt.acknowledgedIds|Where-Object {$_ -ceq $doc.id}).Count -ne 1){throw 'WHATSAPP_FISCAL_RECEIPT_REQUIRED'}
    }
    $complete=@($Documents|Where-Object {$_.kind -cin @('nfeProc','cteProc','cteOSProc','cteSimpProc','NFSe') -and $_.fields.SITUACAO -ceq 'AUTORIZADA'})
    $blocked=@($Documents|Where-Object {$_.fields.SITUACAO -cin @('CANCELADA','SUBSTITUIDA')})
    if($complete.Count -eq 0 -and $blocked.Count -eq 0){return}
    [IO.Directory]::CreateDirectory($Root)|Out-Null
    $lock=New-Object IO.FileStream((Join-Path $Root 'notifications.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try{
        # Persist every confirmed negative state before considering full XMLs,
        # independently of input order and even when no full XML is in the batch.
        foreach($doc in $blocked){
            $path=Get-SefazNotificationBlockPath $Root ([string]$doc.key)
            if(-not (Test-SefazNotificationBlocked $Root ([string]$doc.key))){
                Write-SefazNotificationJson $path ([ordered]@{version=1;source='SEFAZ';key=[string]$doc.key;fiscalSituation=[string]$doc.fields.SITUACAO;documentId=[string]$doc.id;confirmedAt=[DateTimeOffset]::UtcNow.ToString('o')})
            }
            Set-SefazPendingNotificationSuppressed $Root ([string]$doc.key)
        }
        foreach($doc in $complete){
            if([string]$doc.key -cnotmatch '^(?:\d{6}[A-Z0-9]{12}\d{26}|\d{50})$' -or -not $doc.PSObject.Properties['danfe']){throw 'WHATSAPP_DOCUMENT_INVALID'}
            if(Test-SefazNotificationBlocked $Root ([string]$doc.key)){Set-SefazPendingNotificationSuppressed $Root ([string]$doc.key);continue}
            $path=Join-Path $Root ($doc.key+'.json')
            if([IO.File]::Exists($path)){
                $existing=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
                if($existing.request.document.key -cne $doc.key){throw 'WHATSAPP_QUEUE_IDENTITY_INVALID'}
                # A later import/update may render a PDF with a new creation
                # timestamp. Keep the first confirmed notification immutable;
                # deduplication must not block subsequent fiscal ACKs.
                continue
            }
            $request=[ordered]@{mode='stage';source='SEFAZ';receipt=[ordered]@{source='SEFAZ';acknowledgedIds=@($Receipt.acknowledgedIds)};document=$doc}
            Write-SefazNotificationJson $path ([ordered]@{state='pending';attempts=0;nextRetryAt=$null;code='';createdAt=[DateTimeOffset]::UtcNow.ToString('o');request=$request})
        }
    }finally{$lock.Dispose()}
}

function Invoke-SefazWhatsAppRemote($Config,$Request){
    if($PSVersionTable.PSVersion.Major -lt 7){throw 'WHATSAPP_POWERSHELL7_REQUIRED'}
    if($Config.sshHost -notmatch '^[A-Za-z_][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9.-]*$' -or
       $Config.danfePython -notmatch '^/[A-Za-z0-9_./-]+$' -or $Config.whatsappDispatcher -notmatch '^/[A-Za-z0-9_./-]+$'){throw 'WHATSAPP_CONFIG_INVALID'}
    $info=[Diagnostics.ProcessStartInfo]::new()
    $info.FileName=(Get-Command ssh.exe -ErrorAction Stop).Source
    foreach($arg in @('-T','-o','BatchMode=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=2','-i',[string]$Config.sshKeyPath,[string]$Config.sshHost,
        ('sudo -n '+$Config.danfePython+' '+$Config.whatsappDispatcher))){$info.ArgumentList.Add($arg)}
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true
    $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $info.StandardInputEncoding=[Text.UTF8Encoding]::new($false)
    $info.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
    $info.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)
    $process=[Diagnostics.Process]::new();$process.StartInfo=$info
    try{
        if(-not $process.Start()){throw 'WHATSAPP_PROCESS_START'}
        $output=$process.StandardOutput.ReadToEndAsync();$errors=$process.StandardError.ReadToEndAsync()
        $writing=$process.StandardInput.WriteAsync(($Request|ConvertTo-Json -Compress -Depth 35))
        if(-not $writing.Wait(45000)){throw 'WHATSAPP_PROCESS_TIMEOUT'}
        $process.StandardInput.Close()
        if(-not $process.WaitForExit(45000)){throw 'WHATSAPP_PROCESS_TIMEOUT'}
        $text=$output.GetAwaiter().GetResult();$null=$errors.GetAwaiter().GetResult()
        if($process.ExitCode -ne 0 -or $text.Length -gt 65536){throw 'WHATSAPP_PROCESS_FAILED'}
        try{return ($text|ConvertFrom-Json -ErrorAction Stop)}catch{throw 'WHATSAPP_PROCESS_RESPONSE_INVALID'}
    }finally{
        if(-not $process.HasExited){try{$process.Kill($true)}catch{}}
        $process.Dispose()
    }
}

function Invoke-SefazWhatsAppDrain($Config,[string]$Root,[scriptblock]$Remote){
    if(-not $Config.PSObject.Properties['whatsappEnabled'] -or $Config.whatsappEnabled -ne $true){return [pscustomobject]@{status='disabled'}}
    if($null -eq $Remote){$Remote={param($Config,$Request) Invoke-SefazWhatsAppRemote $Config $Request}}
    $lock=$null;$failed=$false;$staged=0;$attempted=0
    try{
        [IO.Directory]::CreateDirectory($Root)|Out-Null
        try{$lock=New-Object IO.FileStream((Join-Path $Root 'notifications.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch{return [pscustomobject]@{status='busy'}}
        foreach($file in @(Get-ChildItem -LiteralPath $Root -Filter '*.json' -File|Sort-Object Name)){
            $item=$null
            try{
                $item=Get-Content -LiteralPath $file.FullName -Raw|ConvertFrom-Json
                if($item.state -ne 'pending'){continue}
                if(Test-SefazNotificationBlocked $Root ([string]$item.request.document.key)){
                    Set-SefazPendingNotificationSuppressed $Root ([string]$item.request.document.key)
                    continue
                }
                if($Config.PSObject.Properties['minimumIssueDate']){
                    $disposition=Get-FiscalDocumentScopeDisposition $item.request.document @() ([string]$Config.minimumIssueDate) ([DateTimeOffset]::UtcNow)
                    if($disposition -eq 'BEFORE_SCOPE'){
                        $item.state='scope_excluded';$item.code='BEFORE_MINIMUM_ISSUE_DATE';$item.nextRetryAt=$null
                        Write-SefazNotificationJson $file.FullName $item
                        continue
                    }
                    if($disposition -ne 'READY'){continue}
                }
                if($item.nextRetryAt -and [DateTimeOffset]::Parse([string]$item.nextRetryAt) -gt [DateTimeOffset]::UtcNow){continue}
                if($attempted -ge 10){break};$attempted++
                $answer=& $Remote $Config $item.request
                if($null -eq $answer -or $answer.key -cne $item.request.document.key -or $answer.status -notin @('staged','text_queued','text_sent','pdf_queued','pdf_blocked','unconfirmed','sent','baseline','scope_excluded')){throw 'WHATSAPP_RECEIPT_INVALID'}
                $item.state=if($answer.status -eq 'scope_excluded'){'scope_excluded'}else{'remote_staged'};$item.code='';$item.nextRetryAt=$null
                Write-SefazNotificationJson $file.FullName $item
                $staged++
            }catch{
                $failed=$true
                if($null -ne $item){
                    try{
                        $item.attempts=[int]$item.attempts+1;$item.code='WHATSAPP_RETRY'
                        $seconds=[Math]::Min(3600,60*[Math]::Pow(2,[Math]::Min(6,$item.attempts-1)))
                        $item.nextRetryAt=[DateTimeOffset]::UtcNow.AddSeconds($seconds).ToString('o')
                        Write-SefazNotificationJson $file.FullName $item
                    }catch{}
                }
            }
        }
        try{
            $answer=& $Remote $Config ([pscustomobject]@{mode='drain'})
            if($null -eq $answer -or $answer.status -cne 'reconciled'){throw 'WHATSAPP_DRAIN_RECEIPT_INVALID'}
        }catch{$failed=$true}
        return [pscustomobject]@{status=$(if($failed){'retry'}else{'reconciled'});staged=$staged}
    }catch{return [pscustomobject]@{status='retry';staged=$staged}}finally{if($null -ne $lock){$lock.Dispose()}}
}

Export-ModuleMember -Function Save-SefazWhatsAppNotification,Invoke-SefazWhatsAppDrain
