Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Sefaz.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'GapRecovery.psm1') -DisableNameChecking

function Get-SefazRecentGap([string]$CompanyPath,[string]$InitialResumeNsu){
    Get-SefazCollectionGaps $CompanyPath $InitialResumeNsu |
        Where-Object {$_.record.status -cin @('HISTORICAL_RECOVERY_REQUIRED','CAPTURED')} |
        Sort-Object path -Descending
}

function Invoke-SefazRecentGapRecovery($Config,[string]$CompanyPath,[string]$GovernorPath,$LiveState,[DateTimeOffset]$Now,[scriptblock]$Request){
    $bootstrap=if($Config.PSObject.Properties['initialResumeNsu']){[string]$Config.initialResumeNsu}else{''}
    $gaps=@(Get-SefazRecentGap $CompanyPath $bootstrap)
    if(-not $gaps.Count){return [pscustomobject]@{status='RECONCILED'}}
    $ledgerPath=Join-Path $GovernorPath 'point-ledger.json'
    $receiptDirectory=Join-Path $CompanyPath 'history-gap-receipts'
    $calls=0
    $pendingDelivery=$false
    $confirmedCorrections=Get-SefazConfirmedCorrection $CompanyPath
    foreach($gap in $gaps){
        $gapHasDocuments=$false
        $gapAllArchived=$true
        $gapAllSettled=$true
        for($number=[long]$gap.record.fromExclusive+1;$number -le [long]$gap.record.throughInclusive;$number++){
            $nsu=$number.ToString('000000000000000')
            $receiptPath=Join-Path $receiptDirectory "$nsu.json"
            if(-not [IO.File]::Exists($receiptPath)){
                $folder=Join-Path $CompanyPath 'history-gap-raw'
                if([IO.Directory]::Exists($folder)){
                    foreach($rawFile in @(Get-ChildItem -LiteralPath $folder -File -Filter "$nsu-*.xml" | Sort-Object LastWriteTimeUtc -Descending)){
                        try{$parsed=ConvertFrom-GapResponse ([IO.File]::ReadAllText($rawFile.FullName)) $nsu ([string]$Config.companyCnpj) $Now}catch{continue}
                        $null=Save-SefazRecentGapReceipt $rawFile.FullName $CompanyPath $nsu $receiptPath $parsed
                        if([IO.File]::Exists($receiptPath)){break}
                    }
                }
            }
            if(-not [IO.File]::Exists($receiptPath)){
                if($calls -ge 2){return [pscustomobject]@{status='PROGRESS';nextAllowedAt=$Now.AddMinutes(1).ToString('o')}}
                if([DateTimeOffset]::Parse($LiveState.nextAllowedAt) -gt $Now){return [pscustomobject]@{status='WAIT';nextAllowedAt=$LiveState.nextAllowedAt}}
                if(-not [IO.File]::Exists($ledgerPath)){throw 'SEFAZ_GAP_POINT_LEDGER_MISSING'}
                $ledger=Read-GapJson $ledgerPath
                $shared=Read-GapSharedCooldown $GovernorPath
                $decision=Get-GapGovernorNextAllowed $ledger $LiveState $Now
                if($null -ne $shared -and $shared.reason -cne 'POINT_RATE_LIMIT' -and [DateTimeOffset]::Parse($shared.nextAllowedAt) -gt $Now){return [pscustomobject]@{status='WAIT';nextAllowedAt=$shared.nextAllowedAt}}
                if(-not $decision.allowed -or $decision.available -le 0){return [pscustomobject]@{status='WAIT';nextAllowedAt=$decision.nextAllowedAt;pointQuotaOnly=($decision.reason -ceq 'POINT_RATE_LIMIT')}}
                $receipt=Get-SefazRecentGapDocument $Config $CompanyPath $GovernorPath $ledgerPath $ledger $LiveState $Request $nsu $receiptPath $Now
                $calls++
                $Now=[DateTimeOffset]::UtcNow
                if($receipt.status -cnotin @('137','138')){return [pscustomobject]@{status='WAIT';nextAllowedAt=$receipt.nextAllowedAt}}
            }
            $receipt=Read-GapJson $receiptPath
            if($receipt.nsu -cne $nsu -or $receipt.status -cnotin @('137','138') -or $receipt.rawFile -cnotmatch ('^'+$nsu+'-[a-f0-9]{32}\.xml$') -or $receipt.sha256 -cnotmatch '^[a-f0-9]{64}$'){
                throw 'SEFAZ_GAP_RECEIPT_INVALID'
            }
            $raw=Join-Path $CompanyPath "history-gap-raw/$($receipt.rawFile)"
            if(-not [IO.File]::Exists($raw) -or (Get-FileHash -LiteralPath $raw).Hash -ine $receipt.sha256){throw 'SEFAZ_GAP_RESPONSE_CHANGED'}
            if($receipt.status -ceq '138'){
                if($receipt.documentId -cnotmatch ('^'+$nsu+'-[a-f0-9]{16}$')){throw 'SEFAZ_GAP_RECEIPT_INVALID'}
                $gapHasDocuments=$true
                if(-not [IO.File]::Exists((Join-Path $CompanyPath "archive/$($receipt.documentId).json"))){
                    $gapAllArchived=$false
                    $settled=@('scope-excluded','summaries' | Where-Object {[IO.File]::Exists((Join-Path $CompanyPath "$_/$($receipt.documentId).json"))})
                    $correction=$false
                    $pendingDate=Join-Path $CompanyPath "scope-pending-date/$($receipt.documentId).json"
                    if([IO.File]::Exists($pendingDate)){
                        $doc=Read-GapJson $pendingDate
                        $correction=$doc.kind -ceq 'procEventoNFe' -and $doc.fields.PSObject.Properties['TIPO_EVENTO'] -and
                            $doc.fields.TIPO_EVENTO -ceq '110110' -and $confirmedCorrections[$doc.sha256] -ceq $doc.key
                    }
                    if(-not $settled.Count -and -not $correction){
                        $gapAllSettled=$false
                        if(-not @(Get-SefazRecentGapLocalDocument $CompanyPath $receipt.documentId).Count){
                            $parsed=ConvertFrom-GapResponse ([IO.File]::ReadAllText($raw)) $nsu ([string]$Config.companyCnpj) $Now
                            if($parsed.status -cne '138' -or $parsed.document.id -cne $receipt.documentId){throw 'SEFAZ_GAP_DOCUMENT_CHANGED'}
                            Write-AtomicJson (Join-Path $CompanyPath "outbox/$($receipt.documentId).json") $parsed.document
                        }
                    }
                }
            }
        }
        $nextStatus=if($gapAllSettled){'RECOVERED'}else{'CAPTURED'}
        if(-not $gapAllSettled){$pendingDelivery=$true}
        if($gap.record.status -ceq $nextStatus){continue}
        $gap.record.status=$nextStatus
        $gap.record.documentsImportedFromThisRange=$gapHasDocuments -and $gapAllArchived
        $gap.record|Add-Member -NotePropertyName reconciledAt -NotePropertyValue $Now.ToString('o') -Force
        $gap.record|Add-Member -NotePropertyName pointReceiptsRequired -NotePropertyValue $true -Force
        Write-AtomicJson $gap.path $gap.record
    }
    if($pendingDelivery){return [pscustomobject]@{status='CAPTURED';nextAllowedAt=$Now.AddMinutes(1).ToString('o')}}
    return [pscustomobject]@{status='RECONCILED'}
}

function Get-SefazRecentGapLocalDocument([string]$CompanyPath,[string]$DocumentId){
    @('archive','outbox','summaries','scope-excluded','scope-pending-date' | Where-Object {[IO.File]::Exists((Join-Path $CompanyPath "$_/$DocumentId.json"))})
}

function Save-SefazRecentGapReceipt([string]$RawPath,[string]$CompanyPath,[string]$Nsu,[string]$ReceiptPath,$Parsed){
    $receipt=[ordered]@{nsu=$Nsu;status=$parsed.status;rawFile=[IO.Path]::GetFileName($RawPath);sha256=(Get-FileHash -LiteralPath $RawPath).Hash.ToLowerInvariant()}
    if($parsed.status -ceq '138'){
        $document=$parsed.document
        if(-not @(Get-SefazRecentGapLocalDocument $CompanyPath $document.id).Count){
            Write-AtomicJson (Join-Path $CompanyPath "outbox/$($document.id).json") $document
        }
        $receipt.documentId=$document.id
    }
    if($parsed.status -cin @('137','138')){Write-AtomicJson $ReceiptPath $receipt}
    return $receipt
}

function Get-SefazRecentGapDocument($Config,[string]$CompanyPath,[string]$GovernorPath,[string]$LedgerPath,$Ledger,$LiveState,[scriptblock]$Request,[string]$Nsu,[string]$ReceiptPath,[DateTimeOffset]$Now){
    $attempt=[pscustomobject]@{
        id=[guid]::NewGuid().ToString('N')
        queryType='consNSU'
        target=$Nsu
        startedAt=$Now.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'")
        status='REQUEST_RESERVED'
        holdUntil=$Now.AddMinutes(65).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'")
    }
    $Ledger.attempts=@($Ledger.attempts)+@($attempt)
    Write-AtomicJson $LedgerPath $Ledger
    Write-GapSharedCooldown $GovernorPath ([pscustomobject]@{reason='REQUEST_RESERVED';nextAllowedAt=$attempt.holdUntil}) $Now
    try{
        $soap=if($Request){& $Request $Config $Nsu}else{Invoke-SefazDistribution $Config $Nsu -Point}
        $folder=Join-Path $CompanyPath 'history-gap-raw'
        [IO.Directory]::CreateDirectory($folder)|Out-Null
        $file=Join-Path $folder "$Nsu-$($attempt.id).xml"
        $stream=[IO.FileStream]::new($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        $bytes=[Text.Encoding]::UTF8.GetBytes($soap)
        try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
        $parsed=ConvertFrom-GapResponse $soap $Nsu ([string]$Config.companyCnpj) $Now
        $receipt=Save-SefazRecentGapReceipt $file $CompanyPath $Nsu $ReceiptPath $parsed
    }catch{
        $hold=Complete-GapAttempt $GovernorPath $LedgerPath $attempt.id 'REQUEST_UNCERTAIN' $LiveState ([DateTimeOffset]::UtcNow)
        return [pscustomobject]@{status='ERROR';nextAllowedAt=$hold.nextAllowedAt}
    }
    $hold=Complete-GapAttempt $GovernorPath $LedgerPath $attempt.id $receipt.status $LiveState ([DateTimeOffset]::UtcNow)
    if($receipt.status -ceq '656'){$receipt.nextAllowedAt=$hold.nextAllowedAt}
    return [pscustomobject]$receipt
}

Export-ModuleMember -Function Get-SefazRecentGap,Invoke-SefazRecentGapRecovery
