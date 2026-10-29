Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Sefaz.psm1') -DisableNameChecking

function Read-GapJson([string]$Path){
    $options=@{};if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){$options.DateKind='String'}
    return ([IO.File]::ReadAllText($Path)|ConvertFrom-Json @options)
}
function Read-GapXml([string]$Text){
    $settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit;$settings.XmlResolver=$null;$settings.MaxCharactersInDocument=16000000
    $reader=[Xml.XmlReader]::Create([IO.StringReader]::new($Text),$settings)
    try{$xml=[Xml.XmlDocument]::new();$xml.XmlResolver=$null;$xml.Load($reader);return ,$xml}finally{$reader.Dispose()}
}
function ConvertTo-GapUtc([DateTimeOffset]$Time){return $Time.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'",[Globalization.CultureInfo]::InvariantCulture)}
function Write-GapRaw([string]$Path,[string]$Text){
    [IO.Directory]::CreateDirectory((Split-Path $Path -Parent))|Out-Null
    $file=[IO.FileStream]::new($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes($Text);$file.Write($bytes,0,$bytes.Length);$file.Flush($true)}finally{$file.Dispose()}
}
function Get-GapArchivedDocuments([string[]]$ArchivePaths,[string]$CompanyCnpj='38626750000146'){
    $seen=@{}
    foreach($path in $ArchivePaths){
        if(-not [IO.Directory]::Exists($path)){throw 'GAP_ARCHIVE_PATH_MISSING'}
        foreach($file in @(Get-ChildItem -LiteralPath $path -Filter '*.json' -File)){
            $saved=Read-GapJson $file.FullName
            $bytes=[Convert]::FromBase64String([string]$saved.xmlBase64)
            $doc=ConvertFrom-FiscalXml ([Text.UTF8Encoding]::new($false,$true).GetString($bytes)) ([string]$saved.nsu) $CompanyCnpj
            if($doc.id -cne $saved.id -or $doc.key -cne $saved.key -or $doc.sha256 -cne $saved.sha256){throw 'GAP_ARCHIVE_INTEGRITY'}
            if(-not $seen.ContainsKey($doc.id)){$seen[$doc.id]=$true;Write-Output $doc}
        }
    }
}
function New-GapRecoveryPlan([object[]]$KnownDocuments,[string]$CompanyCnpj,[DateTimeOffset]$Now){
    if($CompanyCnpj -cne '38626750000146'){throw 'GAP_COMPANY_INVALID'}
    $anchors=@(1251,1253,1273,1306,1329,1339);$known=@{}
    foreach($doc in $KnownDocuments){
        if([string]$doc.nsu -cnotmatch '^\d{15}$'){throw 'GAP_ANCHOR_INVALID'}
        if([long]$doc.nsu -in $anchors){
            if($doc.kind -cne 'nfeProc' -or $doc.fields.CNPJ_DESTINATARIO -cne $CompanyCnpj){throw 'GAP_ANCHOR_INVALID'}
            $known[[long]$doc.nsu]=$true
        }
    }
    if($known.Count -ne 6){throw 'GAP_ANCHOR_MISSING'}
    $targets=@(1251..1339|Where-Object{$_ -notin $anchors}|ForEach-Object{[pscustomobject]@{nsu=$_.ToString('000000000000000');status='PENDING';attemptId=$null;documentId=$null}})
    return [pscustomobject]@{version=1;scope='INTERNAL_VERIFIED_ANCHORS_1251_1339';companyCnpj=$CompanyCnpj;createdAt=(ConvertTo-GapUtc $Now);baselineIds=@($KnownDocuments|Where-Object{[long]$_.nsu -in $anchors}|ForEach-Object{$_.id});targets=$targets;whole90DaysRecovered=$false}
}
function New-GapPointLedger([object[]]$PriorSources,[DateTimeOffset]$Now){
    $attempts=@();$holds=@();$proofs=@();$seen=@{}
    foreach($source in $PriorSources){
        if([string]$source.sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or (Get-FileHash -LiteralPath $source.path -Algorithm SHA256).Hash -ine $source.sha256){throw 'GAP_SEED_HASH_MISMATCH'}
        $prior=Read-GapJson $source.path
        if(-not $prior.PSObject.Properties['attempts'] -or -not $prior.PSObject.Properties['nextAllowedAt']){throw 'GAP_SEED_INVALID'}
        $all=@($prior.attempts)
        $proved=$prior.status -ceq 'COMPLETED' -and [int]$prior.acknowledged -eq 3 -and $all.Count -eq 3 -and @($all|Where-Object{$_.status -cne '138' -or @($_.documentIds).Count -ne 1}).Count -eq 0
        foreach($old in $all){
            if([string]$old.index -cnotmatch '^[123]$'){throw 'GAP_SEED_INDEX_INVALID'}
            $id=([string]$source.sha256).ToLowerInvariant()+'-'+[string]$old.index
            if($seen.ContainsKey($id)){throw 'GAP_SEED_DUPLICATE'};$seen[$id]=$true
            $started=[DateTimeOffset]::Parse([string]$old.startedAt,[Globalization.CultureInfo]::InvariantCulture)
            if($started -gt $Now.AddMinutes(1)){throw 'GAP_SEED_FUTURE_ATTEMPT'}
            $attempts+=@([pscustomobject]@{id=$id;queryType='consChNFe';target=$null;startedAt=(ConvertTo-GapUtc $started);status=[string]$old.status;holdUntil=(ConvertTo-GapUtc $started)})
        }
        $oldHold=[DateTimeOffset]::Parse([string]$prior.nextAllowedAt,[Globalization.CultureInfo]::InvariantCulture)
        if(-not $proved){$holds+=@([pscustomobject]@{reason='UNVERIFIED_PRIOR_HOLD';until=(ConvertTo-GapUtc $oldHold)})}
        $proofs+=@([pscustomobject]@{sha256=([string]$source.sha256).ToUpperInvariant();attempts=$all.Count;completed138WithThreeAck=$proved;legacyNextAllowedAt=(ConvertTo-GapUtc $oldHold)})
    }
    return [pscustomobject]@{version=1;attempts=$attempts;holds=$holds;events=@([pscustomobject]@{type='POLICY_CHANGE_RECALCULATED';at=(ConvertTo-GapUtc $Now);reason='NT2014.002v1.40_SECTION_3.11.4.2';policy='18_POINT_REQUESTS_PER_ROLLING_HOUR';sources=$proofs})}
}
function Get-GapGovernorNextAllowed($PointLedger,$LiveState,[DateTimeOffset]$Now){
    if([int]$PointLedger.version -ne 1){throw 'GAP_POINT_LEDGER_VERSION'}
    if([string]$LiveState.lastNsu -cnotmatch '^\d{15}$' -or -not $LiveState.PSObject.Properties['nextAllowedAt']){throw 'GAP_LIVE_STATE_INVALID'}
    $next=$Now;$reason='NONE'
    $recent=@($PointLedger.attempts|Where-Object{[DateTimeOffset]::Parse([string]$_.startedAt,[Globalization.CultureInfo]::InvariantCulture) -gt $Now.AddHours(-1)}|Sort-Object {[DateTimeOffset]::Parse([string]$_.startedAt,[Globalization.CultureInfo]::InvariantCulture)})
    if($recent.Count -ge 18){$next=[DateTimeOffset]::Parse([string]$recent[$recent.Count-18].startedAt,[Globalization.CultureInfo]::InvariantCulture).AddHours(1).AddMilliseconds(1);$reason='POINT_RATE_LIMIT'}
    foreach($hold in @($PointLedger.holds)){
        $until=[DateTimeOffset]::Parse([string]$hold.until,[Globalization.CultureInfo]::InvariantCulture)
        if($until -gt $next){$next=$until;$reason=[string]$hold.reason}
    }
    foreach($attempt in @($PointLedger.attempts)){
        $until=[DateTimeOffset]::Parse([string]$attempt.holdUntil,[Globalization.CultureInfo]::InvariantCulture)
        if($until -gt $next){$next=$until;$reason=if($attempt.status -ceq '656'){'SEFAZ_656'}elseif($attempt.status -ceq 'REQUEST_RESERVED'){'REQUEST_RESERVED'}else{'REQUEST_UNCERTAIN'}}
    }
    $liveNext=[DateTimeOffset]::Parse([string]$LiveState.nextAllowedAt,[Globalization.CultureInfo]::InvariantCulture)
    if($liveNext -gt $next){$next=$liveNext;$reason='LIVE_DISTRIBUTION_COOLDOWN'}
    return [pscustomobject]@{allowed=($next -le $Now);nextAllowedAt=(ConvertTo-GapUtc $next);reason=$reason;recent=$recent.Count;available=[Math]::Max(0,18-$recent.Count)}
}
function Write-GapSharedCooldown([string]$DataRoot,$Decision,[DateTimeOffset]$Now){
    if([string]$Decision.reason -cnotmatch '^[A-Z][A-Z0-9_]{0,63}$'){throw 'GAP_SHARED_REASON_INVALID'}
    Write-AtomicJson (Join-Path $DataRoot 'global-cooldown.json') ([ordered]@{version=1;nextAllowedAt=[string]$Decision.nextAllowedAt;reason=[string]$Decision.reason;updatedAt=(ConvertTo-GapUtc $Now)})
}
function Read-GapSharedCooldown([string]$DataRoot){
    $path=Join-Path $DataRoot 'global-cooldown.json';if(-not [IO.File]::Exists($path)){return $null}
    $value=Read-GapJson $path
    $iso='^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$'
    if([int]$value.version -ne 1 -or [string]$value.reason -cnotmatch '^[A-Z][A-Z0-9_]{0,63}$' -or [string]$value.nextAllowedAt -cnotmatch $iso -or [string]$value.updatedAt -cnotmatch $iso){throw 'GAP_SHARED_INVALID'}
    $null=[DateTimeOffset]::Parse([string]$value.nextAllowedAt,[Globalization.CultureInfo]::InvariantCulture)
    $null=[DateTimeOffset]::Parse([string]$value.updatedAt,[Globalization.CultureInfo]::InvariantCulture)
    return $value
}
function Test-GapScheduleWindow([DateTimeOffset]$Now){
    $local=[TimeZoneInfo]::ConvertTime($Now,[TimeZoneInfo]::FindSystemTimeZoneById('E. South America Standard Time'))
    $minutes=$local.Hour*60+$local.Minute
    return (@(9,15,20|Where-Object{[Math]::Abs($minutes-($_*60)) -le 5}).Count -gt 0)
}
function Initialize-GapRecoveryFiles([string]$DataRoot,$SeedLedger,[object[]]$KnownDocuments,[string]$CompanyCnpj,[DateTimeOffset]$Now){
    $pointPath=Join-Path $DataRoot 'point-ledger.json';$queuePath=Join-Path $DataRoot 'queue.json'
    $hasPoint=[IO.File]::Exists($pointPath);$hasQueue=[IO.File]::Exists($queuePath)
    $null=Read-GapSharedCooldown $DataRoot
    if(-not $hasPoint -and $hasQueue){throw 'GAP_INITIALIZATION_INCOMPLETE'}
    if(-not $hasPoint){Write-AtomicJson $pointPath $SeedLedger}
    $point=Read-GapJson $pointPath
    $expected=@($SeedLedger.events[0].sources|ForEach-Object{$_.sha256}|Sort-Object)
    $actual=@($point.events[0].sources|ForEach-Object{$_.sha256}|Sort-Object)
    if(($expected -join ',') -cne ($actual -join ',')){throw 'GAP_SEED_PROOF_CHANGED'}
    if(-not $hasQueue){
        if(@($point.attempts|Where-Object{$_.queryType -ceq 'consNSU'}).Count){throw 'GAP_INITIALIZATION_INCOMPLETE'}
        Write-AtomicJson $queuePath (New-GapRecoveryPlan $KnownDocuments $CompanyCnpj $Now)
    }
    $queue=Read-GapJson $queuePath
    $expectedNsus=@(1251..1339|Where-Object{$_ -notin @(1251,1253,1273,1306,1329,1339)}|ForEach-Object{$_.ToString('000000000000000')})
    $null=Assert-GapQueueScope $queue
    return [pscustomobject]@{initialized=(-not $hasPoint);queueRepaired=($hasPoint -and -not $hasQueue)}
}
function Reset-GapRetryableTargets([string]$DataRoot,[string]$PointLedgerPath,[DateTimeOffset]$Now){
    $queuePath=Join-Path $DataRoot 'queue.json';$queue=Read-GapJson $queuePath;$ledger=Read-GapJson $PointLedgerPath;$count=0
    foreach($target in @($queue.targets|Where-Object{$_.status -ceq 'BLOCKED_656'})){
        $last=@($ledger.attempts|Where-Object{$_.id -ceq $target.attemptId})
        if($last.Count -ne 1 -or $last[0].status -cne '656'){throw 'GAP_RETRY_EVIDENCE_INVALID'}
        if([DateTimeOffset]::Parse([string]$last[0].holdUntil,[Globalization.CultureInfo]::InvariantCulture) -gt $Now){continue}
        if(-not @($ledger.events|Where-Object{$_.type -ceq 'RETRY_AFTER_656' -and $_.attemptId -ceq $target.attemptId}).Count){
            $ledger.events=@($ledger.events)+@([pscustomobject]@{type='RETRY_AFTER_656';attemptId=$target.attemptId;at=(ConvertTo-GapUtc $Now)})
        }
        $target.status='PENDING';$count++
    }
    if($count){Write-AtomicJson $PointLedgerPath $ledger;Write-AtomicJson $queuePath $queue}
    return $count
}
function New-GapConsNsuSoap($Config,[string]$TargetNsu){
    if($Config.companyCnpj -cne '38626750000146' -or [string]$Config.environment -cne '1' -or [string]$Config.ufCode -cnotmatch '^\d{2}$' -or $TargetNsu -cnotmatch '^\d{15}$' -or [long]$TargetNsu -lt 1251 -or [long]$TargetNsu -gt 1387){throw 'GAP_REQUEST_INVALID'}
    return '<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg><distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>'+$Config.ufCode+'</cUFAutor><CNPJ>'+$Config.companyCnpj+'</CNPJ><consNSU><NSU>'+$TargetNsu+'</NSU></consNSU></distDFeInt></nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>'
}
function Invoke-GapConsNsu($Config,[string]$TargetNsu,[string]$DataRoot){
    if([long]$TargetNsu -gt 1339){
        if([string]::IsNullOrWhiteSpace($DataRoot)){throw 'GAP_EXTENSION_REQUIRED'}
        $queue=Read-GapJson (Join-Path $DataRoot 'queue.json');$null=Assert-GapQueueScope $queue
        if([int]$queue.version -ne 2 -or -not @($queue.targets|Where-Object{$_.nsu -ceq $TargetNsu}).Count){throw 'GAP_EXTENSION_REQUIRED'}
    }
    $soap=New-GapConsNsuSoap $Config $TargetNsu;$cert=Get-CompanyCertificate $Config
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    $action='http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse'
    $reply=Invoke-WebRequest -Uri 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx' -Method Post -Certificate $cert -ContentType ('application/soap+xml; charset=utf-8; action="'+$action+'"') -Body ([Text.Encoding]::UTF8.GetBytes($soap)) -TimeoutSec 90 -UseBasicParsing
    return [string]$reply.Content
}
function ConvertFrom-GapResponse([string]$Soap,[string]$TargetNsu,[string]$CompanyCnpj,[DateTimeOffset]$Now){
    $xml=Read-GapXml $Soap;$responses=@($xml.SelectNodes("//*[local-name()='retDistDFeInt']"))
    if($responses.Count -ne 1){throw 'GAP_RESPONSE_INVALID'};$ret=$responses[0]
    $node=$ret.SelectSingleNode("./*[local-name()='cStat']");if($null -eq $node){throw 'GAP_STATUS_UNKNOWN'};$status=$node.InnerText
    if($status -in @('137','656')){return [pscustomobject]@{status=$status;document=$null;xml=$null}}
    if($status -cne '138'){throw 'GAP_STATUS_UNKNOWN'}
    $docs=@($ret.SelectNodes("./*[local-name()='loteDistDFeInt']/*[local-name()='docZip']"))
    if($docs.Count -ne 1 -or $docs[0].GetAttribute('NSU') -cne $TargetNsu -or $TargetNsu -cnotmatch '^\d{15}$'){throw 'GAP_RESPONSE_NSU_MISMATCH'}
    $text=Expand-DocZip $docs[0].InnerText;$document=ConvertFrom-FiscalXml $text $TargetNsu $CompanyCnpj
    if($document.key.Substring(20,2) -cne '55'){throw 'GAP_MODEL_INVALID'}
    if($document.fields.Contains('CNPJ_FORNECEDOR') -and ([string]$document.fields.CNPJ_FORNECEDOR).Length -eq 14 -and $document.fields.CNPJ_FORNECEDOR -cne $document.key.Substring(6,14)){throw 'GAP_ISSUER_KEY_MISMATCH'}
    if($document.kind -ceq 'nfeProc'){
        $fiscal=Read-GapXml $text
        $roles=@($fiscal.SelectNodes("/*[local-name()='nfeProc']/*[local-name()='NFe']/*[local-name()='infNFe']/*[local-name()='emit' or local-name()='dest' or local-name()='autXML']/*[local-name()='CNPJ']")|ForEach-Object{$_.InnerText})
        if($roles -cnotcontains $CompanyCnpj){throw 'GAP_COMPANY_ROLE_MISMATCH'}
        $protocol=$fiscal.SelectSingleNode("/*[local-name()='nfeProc']/*[local-name()='protNFe']/*[local-name()='infProt']/*[local-name()='chNFe']")
        if($null -eq $protocol -or $protocol.InnerText -cne $document.key){throw 'GAP_PROTOCOL_KEY_MISMATCH'}
    }
    return [pscustomobject]@{status='138';document=$document;xml=$text}
}
function Get-GapDocumentDisposition($Document,[object[]]$Evidence,[DateTimeOffset]$Now,[string]$MinimumIssueDate=''){
    if(-not [string]::IsNullOrWhiteSpace($MinimumIssueDate)){
        if(-not (Get-Command Get-SefazDocumentScopeDisposition -ErrorAction SilentlyContinue)){throw 'GAP_SCOPE_HELPER_MISSING'}
        return Get-SefazDocumentScopeDisposition $Document $Evidence $MinimumIssueDate $Now
    }
    $date=$null
    if($Document.fields.Contains('DATA_EMISSAO')){$date=[string]$Document.fields.DATA_EMISSAO}
    elseif($Document.kind -in @('procEventoNFe','resEvento')){
        $matches=@($Evidence|Where-Object{$_.key -ceq $Document.key -and $_.fields.Contains('DATA_EMISSAO')}|Sort-Object nsu)
        if($matches.Count){$date=[string]$matches[-1].fields.DATA_EMISSAO}
    }
    if([string]::IsNullOrWhiteSpace($date)){return 'PENDING_DATE'}
    $issued=[DateTimeOffset]::Parse($date,[Globalization.CultureInfo]::InvariantCulture)
    if($issued -gt $Now){return 'FUTURE_DATE'}
    if($issued -lt $Now.AddDays(-90)){return 'OUTSIDE_90_DAYS'}
    return 'READY'
}
function Reserve-GapRequest([string]$DataRoot,[string]$PointLedgerPath,[string]$TargetNsu,$LiveState,[DateTimeOffset]$Now){
    $queuePath=Join-Path $DataRoot 'queue.json';$queue=Read-GapJson $queuePath;$ledger=Read-GapJson $PointLedgerPath
    $null=Assert-GapQueueScope $queue
    $matches=@($queue.targets|Where-Object{$_.nsu -ceq $TargetNsu})
    if($matches.Count -ne 1){throw 'GAP_TARGET_OUTSIDE_QUEUE'};$target=$matches[0]
    $past=@($ledger.attempts|Where-Object{$_.queryType -ceq 'consNSU' -and $_.target -ceq $TargetNsu})
    $notRetryable=@($past|Where-Object{$_.status -cne '656' -or [DateTimeOffset]::Parse([string]$_.holdUntil,[Globalization.CultureInfo]::InvariantCulture) -gt $Now})
    if($target.status -cne 'PENDING' -or $notRetryable.Count){throw 'GAP_TARGET_ALREADY_ATTEMPTED'}
    $decision=Get-GapGovernorNextAllowed $ledger $LiveState $Now
    if(-not $decision.allowed -or $decision.available -le 0){throw 'GAP_GOVERNOR_WAIT'}
    $attempt=[pscustomobject]@{id=[guid]::NewGuid().ToString('N');queryType='consNSU';target=$TargetNsu;startedAt=(ConvertTo-GapUtc $Now);status='REQUEST_RESERVED';holdUntil=(ConvertTo-GapUtc $Now.AddMinutes(65))}
    $ledger.attempts=@($ledger.attempts)+@($attempt);Write-AtomicJson $PointLedgerPath $ledger
    Write-GapSharedCooldown $DataRoot ([pscustomobject]@{reason='REQUEST_RESERVED';nextAllowedAt=$attempt.holdUntil}) $Now
    $target.status='RESERVED';$target.attemptId=$attempt.id;Write-AtomicJson $queuePath $queue
    return $attempt
}
function Complete-GapAttempt([string]$DataRoot,[string]$PointLedgerPath,[string]$AttemptId,[string]$Status,$LiveState,[DateTimeOffset]$Now){
    $ledger=Read-GapJson $PointLedgerPath;$matches=@($ledger.attempts|Where-Object{$_.id -ceq $AttemptId})
    if($matches.Count -ne 1){throw 'GAP_ATTEMPT_NOT_FOUND'};$attempt=$matches[0];$attempt.status=$Status
    $attempt.holdUntil=if($Status -in @('137','138')){ConvertTo-GapUtc $Now}else{ConvertTo-GapUtc $Now.AddMinutes(65)}
    Write-AtomicJson $PointLedgerPath $ledger
    $decision=Get-GapGovernorNextAllowed $ledger $LiveState $Now;Write-GapSharedCooldown $DataRoot $decision $Now
    return $decision
}
function Save-GapResponse([string]$DataRoot,[string]$PointLedgerPath,[string]$AttemptId,[string]$TargetNsu,[string]$Soap,[string]$CompanyCnpj,[DateTimeOffset]$Now,$LiveState){
    Write-GapRaw (Join-Path $DataRoot ('raw/'+$AttemptId+'.xml')) $Soap
    $queuePath=Join-Path $DataRoot 'queue.json';$queue=Read-GapJson $queuePath;$target=@($queue.targets|Where-Object{$_.nsu -ceq $TargetNsu})[0]
    try{
        $parsed=ConvertFrom-GapResponse $Soap $TargetNsu $CompanyCnpj $Now
        if($parsed.status -ceq '138'){
            $document=$parsed.document
            Write-GapRaw (Join-Path $DataRoot ('xml/'+$document.fileName)) $parsed.xml
            Write-AtomicJson (Join-Path $DataRoot ('staged/'+$document.id+'.json')) $document
            $target.status='RECOVERED';$target.documentId=$document.id
        }elseif($parsed.status -ceq '137'){$target.status='EMPTY'}else{$target.status='BLOCKED_656'}
        Write-AtomicJson $queuePath $queue
        $null=Complete-GapAttempt $DataRoot $PointLedgerPath $AttemptId $parsed.status $LiveState $Now
        return [pscustomobject]@{status=$parsed.status;targetNsu=$TargetNsu}
    }catch{
        $target.status='UNCERTAIN';Write-AtomicJson $queuePath $queue
        $null=Complete-GapAttempt $DataRoot $PointLedgerPath $AttemptId 'REQUEST_UNCERTAIN' $LiveState $Now
        throw
    }
}
function Publish-GapOutbox([string]$DataRoot,[object[]]$KnownDocuments,[DateTimeOffset]$Now,[string]$MinimumIssueDate=''){
    $staged=Join-Path $DataRoot 'staged';$documents=@()
    if([IO.Directory]::Exists($staged)){
        $documents=@(Get-ChildItem -LiteralPath $staged -Filter '*.json' -File|ForEach-Object{
            $saved=Read-GapJson $_.FullName;$bytes=[Convert]::FromBase64String([string]$saved.xmlBase64)
            $normalized=ConvertFrom-FiscalXml ([Text.UTF8Encoding]::new($false,$true).GetString($bytes)) ([string]$saved.nsu) '38626750000146'
            if($normalized.id -cne $saved.id -or $normalized.sha256 -cne $saved.sha256 -or $normalized.key -cne $saved.key){throw 'GAP_STAGED_INTEGRITY'}
            Write-Output $normalized
        })
    }
    $evidence=@($KnownDocuments)+@($documents);$knownIds=@($KnownDocuments|ForEach-Object{$_.id});$published=0
    foreach($document in $documents){
        $normalized=$document
        if($knownIds -ccontains $normalized.id -or [IO.File]::Exists((Join-Path $DataRoot ('archive/'+$normalized.id+'.json')))){continue}
        if((Get-GapDocumentDisposition $normalized $evidence $Now $MinimumIssueDate) -cne 'READY'){continue}
        Write-AtomicJson (Join-Path $DataRoot ('outbox/'+$normalized.id+'.json')) $normalized;$published++
    }
    return [pscustomobject]@{staged=$documents.Count;published=$published}
}
function Read-GapScopeDocument([string]$Path){
    $saved=Read-GapJson $Path;$bytes=[Convert]::FromBase64String([string]$saved.xmlBase64)
    $doc=ConvertFrom-FiscalXml ([Text.UTF8Encoding]::new($false,$true).GetString($bytes)) ([string]$saved.nsu) '38626750000146'
    if($doc.id -cne $saved.id -or $doc.sha256 -cne $saved.sha256 -or $doc.key -cne $saved.key){throw 'GAP_SCOPE_DOCUMENT_INTEGRITY'}
    return $doc
}
function Move-GapScopeRecord([string]$Source,[string]$Destination){
    [IO.Directory]::CreateDirectory((Split-Path $Destination -Parent))|Out-Null
    if([IO.File]::Exists($Destination)){
        if((Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash -cne (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash){throw 'GAP_SCOPE_FILE_CONFLICT'}
        [IO.File]::Delete($Source)
    }else{[IO.File]::Move($Source,$Destination)}
}
function Protect-GapOutboxScope([string]$DataRoot,[object[]]$Evidence,[DateTimeOffset]$Now,[string]$MinimumIssueDate=''){
    if(-not [string]::IsNullOrWhiteSpace($MinimumIssueDate) -and -not (Get-Command Get-SefazDocumentScopeDisposition -ErrorAction SilentlyContinue)){throw 'GAP_SCOPE_HELPER_MISSING'}
    $all=@($Evidence)
    foreach($name in @('staged','outbox','archive','scope-pending-date','scope-excluded')){
        $folder=Join-Path $DataRoot $name
        if([IO.Directory]::Exists($folder)){$all+=@(Get-ChildItem -LiteralPath $folder -Filter '*.json' -File|ForEach-Object{Read-GapScopeDocument $_.FullName})}
    }
    $excluded=0;$pending=0;$restored=0
    foreach($name in @('scope-pending-date','outbox')){
        $folder=Join-Path $DataRoot $name;if(-not [IO.Directory]::Exists($folder)){continue}
        foreach($file in @(Get-ChildItem -LiteralPath $folder -Filter '*.json' -File)){
            $doc=Read-GapScopeDocument $file.FullName;$disposition=Get-GapDocumentDisposition $doc $all $Now $MinimumIssueDate
            if($disposition -ceq 'READY'){
                if($name -ceq 'scope-pending-date' -and -not [IO.File]::Exists((Join-Path $DataRoot ('archive/'+$doc.id+'.json')))){
                    Move-GapScopeRecord $file.FullName (Join-Path $DataRoot ('outbox/'+$doc.id+'.json'));$restored++
                }
            }elseif($disposition -in @('BEFORE_SCOPE','OUTSIDE_90_DAYS')){
                Move-GapScopeRecord $file.FullName (Join-Path $DataRoot ('scope-excluded/'+$doc.id+'.json'));$excluded++
            }elseif($disposition -in @('PENDING_DATE','FUTURE_DATE')){
                if($name -cne 'scope-pending-date'){Move-GapScopeRecord $file.FullName (Join-Path $DataRoot ('scope-pending-date/'+$doc.id+'.json'));$pending++}
            }else{throw 'GAP_SCOPE_DISPOSITION_UNKNOWN'}
        }
    }
    return [pscustomobject]@{excluded=$excluded;pendingDate=$pending;restored=$restored}
}
function Get-GapPendingTargets($Queue){return @($Queue.targets|Where-Object{$_.status -ceq 'PENDING'}|Sort-Object nsu -Descending)}
function Send-GapOutbox([string]$DataRoot,[scriptblock]$SendBatch,[object[]]$Evidence=@(),[string]$MinimumIssueDate='',[DateTimeOffset]$Now=[DateTimeOffset]::UtcNow){
    $acknowledged=0;$batches=0
    while($true){
        $null=Protect-GapOutboxScope $DataRoot $Evidence $Now $MinimumIssueDate
        $pending=@(Get-PendingDocuments $DataRoot 10 1500000);if(-not $pending.Count){break}
        $receipt=& $SendBatch $pending;$ids=@($pending|ForEach-Object{$_.id})
        if($null -eq $receipt -or $receipt.source -cne 'SEFAZ' -or @($receipt.acknowledgedIds).Count -ne $ids.Count -or @($receipt.acknowledgedIds|Select-Object -Unique).Count -ne $ids.Count){throw 'GAP_RECEIPT_INVALID'}
        foreach($id in $ids){if(@($receipt.acknowledgedIds) -cnotcontains $id){throw 'GAP_RECEIPT_INCOMPLETE'}}
        if([string]$receipt.runId -cnotmatch '^[A-Za-z0-9]+$'){throw 'GAP_RECEIPT_RUN_INVALID'}
        Write-AtomicJson (Join-Path $DataRoot ('receipts/'+$receipt.runId+'.json')) $receipt
        Confirm-Documents $DataRoot $ids;$acknowledged+=$ids.Count;$batches++
    }
    return [pscustomobject]@{acknowledged=$acknowledged;batches=$batches}
}
function Get-GapFiscalInventory([string[]]$Stores){
    foreach($store in $Stores){
        if(-not [IO.Directory]::Exists($store)){throw 'GAP_EXTENSION_STORE_MISSING'}
        foreach($file in @(Get-ChildItem -LiteralPath $store -Recurse -File)){
            $normal=$file.FullName.Replace('\','/')
            if($normal -match '/(raw|xml|staged|outbox|archive|history-gaps)/' -or $file.Name -in @('recovery-ledger.json','point-ledger.json','state.json')){
                [pscustomobject]@{path=$file.FullName;sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash}
            }
        }
    }
}
function Assert-GapPinnedFile([string]$Path,[string]$Sha256){
    if($Sha256 -cnotmatch '^[A-Fa-f0-9]{64}$' -or (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ine $Sha256){throw 'GAP_EXTENSION_PIN_MISMATCH'}
}
function Copy-GapImmutableFile([string]$Source,[string]$Destination,[string]$Sha256){
    if([IO.File]::Exists($Destination)){Assert-GapPinnedFile $Destination $Sha256;return}
    [IO.Directory]::CreateDirectory((Split-Path $Destination -Parent))|Out-Null
    $bytes=[IO.File]::ReadAllBytes($Source);$file=[IO.FileStream]::new($Destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$file.Write($bytes,0,$bytes.Length);$file.Flush($true)}finally{$file.Dispose()}
    Assert-GapPinnedFile $Destination $Sha256
}
function Assert-GapQueueScope($Queue){
    if($Queue.companyCnpj -cne '38626750000146' -or $Queue.whole90DaysRecovered -ne $false){throw 'GAP_QUEUE_SCOPE_CHANGED'}
    $base=@(1251..1339|Where-Object{$_ -notin @(1251,1253,1273,1306,1329,1339)}|ForEach-Object{$_.ToString('000000000000000')})
    $nsus=@($Queue.targets|ForEach-Object{[string]$_.nsu})
    if([int]$Queue.version -eq 1){
        if($Queue.scope -cne 'INTERNAL_VERIFIED_ANCHORS_1251_1339' -or $nsus.Count -ne 83 -or ($nsus -join ',') -cne ($base -join ',')){throw 'GAP_QUEUE_SCOPE_CHANGED'}
        return $true
    }
    if([int]$Queue.version -ne 2 -or $Queue.scope -cne 'VERIFIED_ANCHORS_AND_BOUNDARY_1251_1387'){throw 'GAP_QUEUE_SCOPE_CHANGED'}
    $m=$Queue.migration
    Assert-GapPinnedFile $m.proofPath $m.proofSha256;Assert-GapPinnedFile $m.snapshotPath $m.snapshotSha256
    $proof=Read-GapJson $m.proofPath;$snapshot=Read-GapJson $m.snapshotPath
    if([int]$snapshot.version -ne 1){throw 'GAP_EXTENSION_SNAPSHOT_INVALID'};$null=Assert-GapQueueScope $snapshot
    Assert-GapPinnedFile $proof.boundary.path $proof.boundary.sha256
    $added=@($m.addedNsus);$excluded=@($m.excludedNsus);$suffix=@(1340..1387|ForEach-Object{$_.ToString('000000000000000')})
    if($proof.status -cne 'VERIFIED' -or $proof.companyCnpj -cne '38626750000146' -or [string]$proof.environment -cne '1' -or [string]$proof.fromInclusive -cne $suffix[0] -or [string]$proof.throughInclusive -cne $suffix[-1]){throw 'GAP_EXTENSION_PROOF_INVALID'}
    if(($added -join ',') -cne (@($proof.targets) -join ',') -or ($excluded -join ',') -cne (@($proof.excludedNsus) -join ',') -or (@(@($added)+@($excluded)|Sort-Object) -join ',') -cne ($suffix -join ',')){throw 'GAP_EXTENSION_PARTITION_INVALID'}
    if($nsus.Count -ne (83+$added.Count) -or ($nsus -join ',') -cne (@($base)+@($added) -join ',') -or (@($Queue.baselineIds) -join ',') -cne (@($snapshot.baselineIds) -join ',')){throw 'GAP_QUEUE_SCOPE_CHANGED'}
    return $true
}
function Extend-GapRecoveryQueue([string]$DataRoot,[string]$LiveDataRoot,[string]$ConfigPath,[string]$ProofPath,[string]$ProofSha256,[DateTimeOffset]$Now){
    Assert-GapPinnedFile $ProofPath $ProofSha256;$proof=Read-GapJson $ProofPath
    $queuePath=Join-Path $DataRoot 'queue.json';$pointPath=Join-Path $DataRoot 'point-ledger.json';$queue=Read-GapJson $queuePath
    $null=Assert-GapQueueScope $queue
    if([int]$queue.version -eq 2){
        if($queue.migration.proofSha256 -ine $ProofSha256){throw 'GAP_EXTENSION_ALREADY_DIFFERENT_PROOF'}
        return [pscustomobject]@{status='ALREADY_EXTENDED';targets=@($queue.targets).Count;added=0}
    }
    if($proof.status -cne 'VERIFIED' -or [int]$proof.fiscalCalls -ne 0 -or $proof.companyCnpj -cne '38626750000146' -or [string]$proof.environment -cne '1' -or $proof.whole90DaysRecovered -ne $false){throw 'GAP_EXTENSION_PROOF_INVALID'}
    $captured=[DateTimeOffset]::Parse([string]$proof.capturedAt,[Globalization.CultureInfo]::InvariantCulture)
    if($captured -gt $Now.AddMinutes(1) -or $captured -lt $Now.AddMinutes(-30)){throw 'GAP_EXTENSION_PROOF_STALE'}
    foreach($pair in @(@($proof.queue.path,$queuePath),@($proof.pointLedger.path,$pointPath),@($proof.config.path,$ConfigPath))){if([IO.Path]::GetFullPath($pair[0]) -ine [IO.Path]::GetFullPath($pair[1])){throw 'GAP_EXTENSION_CONTEXT_PATH'}}
    foreach($pin in @($proof.queue,$proof.pointLedger,$proof.config,$proof.boundary)){Assert-GapPinnedFile $pin.path $pin.sha256}
    $rawRoot=[IO.Path]::GetFullPath((Join-Path $LiveDataRoot '38626750000146-1/raw')).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
    if(-not [IO.Path]::GetFullPath([string]$proof.boundary.path).StartsWith($rawRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'GAP_EXTENSION_BOUNDARY_CONTEXT'}
    if($proof.boundary.status -cne '137' -or [string]$proof.boundary.environment -cne '1' -or $proof.boundary.lastNsu -cne '000000000001387' -or $proof.boundary.maxNsu -cne '000000000001387'){throw 'GAP_EXTENSION_BOUNDARY_INVALID'}
    $cfg=Read-GapJson $ConfigPath;if($cfg.companyCnpj -cne $proof.companyCnpj -or [string]$cfg.environment -cne '1' -or $proof.boundary.companyContext -cne $proof.companyCnpj){throw 'GAP_EXTENSION_COMPANY_CONTEXT'}
    $soap=Read-GapXml ([IO.File]::ReadAllText($proof.boundary.path));$ret=@($soap.SelectNodes("//*[local-name()='retDistDFeInt']"))
    if($ret.Count -ne 1){throw 'GAP_EXTENSION_BOUNDARY_INVALID'}
    foreach($field in @(@('tpAmb','1'),@('cStat','137'),@('ultNSU','000000000001387'),@('maxNSU','000000000001387'))){$node=$ret[0].SelectSingleNode("./*[local-name()='"+$field[0]+"']");if($null -eq $node -or $node.InnerText -cne $field[1]){throw 'GAP_EXTENSION_BOUNDARY_INVALID'}}
    $livePath=Join-Path $LiveDataRoot '38626750000146-1/state.json';$live=Read-GapJson $livePath
    if($live.status -cne '137' -or $live.lastNsu -cne '000000000001387' -or $live.maxNsu -cne '000000000001387'){throw 'GAP_EXTENSION_LIVE_BOUNDARY_CHANGED'}
    $parent=Split-Path ([IO.Path]::GetFullPath($LiveDataRoot)) -Parent
    $stores=@(@('Sefaz','SefazLive','SefazKeyRecovery','SefazKeyRecoveryBatch2','SefazGapRecovery')|ForEach-Object{Join-Path $parent $_}|Where-Object{[IO.Directory]::Exists($_)}|Sort-Object)
    if((@($proof.stores|Sort-Object) -join '|') -ine ($stores -join '|')){throw 'GAP_EXTENSION_STORES_CHANGED'}
    $inventory=@(Get-GapFiscalInventory $stores);$expected=@{}
    foreach($item in @($proof.inventory)){if($expected.ContainsKey($item.path)) {throw 'GAP_EXTENSION_INVENTORY_INVALID'};$expected[$item.path]=[string]$item.sha256}
    if($inventory.Count -ne $expected.Count){throw 'GAP_EXTENSION_INVENTORY_CHANGED'}
    $present=@{};$attempted=@{}
    foreach($item in $inventory){
        if(-not $expected.ContainsKey($item.path) -or $expected[$item.path] -ine $item.sha256){throw 'GAP_EXTENSION_INVENTORY_CHANGED'}
        if([IO.Path]::GetExtension($item.path) -ieq '.json'){
            $json=Read-GapJson $item.path
            if($json.PSObject.Properties['nsu'] -and [string]$json.nsu -cmatch '^\d{15}$'){$present[[string]$json.nsu]=$true}
            if($json.PSObject.Properties['attempts']){foreach($a in @($json.attempts)){
                if($a.PSObject.Properties['documentIds']){foreach($id in @($a.documentIds)){if([string]$id -cmatch '^(\d{15})-'){$present[$Matches[1]]=$true}}}
                if($a.PSObject.Properties['queryType'] -and $a.queryType -ceq 'consNSU' -and [string]$a.target -cmatch '^\d{15}$'){$attempted[[string]$a.target]=$true}
            }}
        }elseif([IO.Path]::GetExtension($item.path) -ieq '.xml'){
            $xml=Read-GapXml ([IO.File]::ReadAllText($item.path));foreach($doc in $xml.SelectNodes("//*[local-name()='docZip']")){$nsu=$doc.GetAttribute('NSU');if($nsu -cmatch '^\d{15}$'){$present[$nsu]=$true}}
        }
    }
    if((@($present.Keys|Sort-Object) -join ',') -cne (@($proof.presentNsus|Sort-Object) -join ',') -or (@($attempted.Keys|Sort-Object) -join ',') -cne (@($proof.attemptedNsus|Sort-Object) -join ',')){throw 'GAP_EXTENSION_RECONCILIATION_CHANGED'}
    $suffix=@(1340..1387|ForEach-Object{$_.ToString('000000000000000')});$excluded=@($suffix|Where-Object{$present.ContainsKey($_) -or $attempted.ContainsKey($_)});$added=@($suffix|Where-Object{$_ -cnotin $excluded})
    if($proof.fromInclusive -cne $suffix[0] -or $proof.throughInclusive -cne $suffix[-1] -or ($excluded -join ',') -cne (@($proof.excludedNsus) -join ',') -or ($added -join ',') -cne (@($proof.targets) -join ',')){throw 'GAP_EXTENSION_PARTITION_INVALID'}
    $proofCopy=Join-Path $DataRoot ('migrations/proof-'+$ProofSha256.ToLowerInvariant()+'.json');$snapshot=Join-Path $DataRoot ('migrations/queue-'+$proof.queue.sha256.ToLowerInvariant()+'.json')
    foreach($copy in @(@($ProofPath,$proofCopy,$ProofSha256),@($queuePath,$snapshot,$proof.queue.sha256))){
        Copy-GapImmutableFile $copy[0] $copy[1] $copy[2]
    }
    $queue.version=2;$queue.scope='VERIFIED_ANCHORS_AND_BOUNDARY_1251_1387'
    $queue.targets=@($queue.targets)+@($added|ForEach-Object{[pscustomobject]@{nsu=$_;status='PENDING';attemptId=$null;documentId=$null}})
    $queue|Add-Member -NotePropertyName migration -NotePropertyValue ([pscustomobject]@{type='FINITE_SUFFIX_EXTENSION';at=(ConvertTo-GapUtc $Now);proofPath=$proofCopy;proofSha256=$ProofSha256;snapshotPath=$snapshot;snapshotSha256=$proof.queue.sha256;addedNsus=$added;excludedNsus=$excluded})
    $null=Assert-GapQueueScope $queue
    Write-AtomicJson $queuePath $queue
    return [pscustomobject]@{status='EXTENDED';targets=@($queue.targets).Count;added=$added.Count;excluded=$excluded.Count;pending=@($queue.targets|Where-Object{$_.status -ceq 'PENDING'}).Count;recovered=@($queue.targets|Where-Object{$_.status -ceq 'RECOVERED'}).Count;fiscalCalls=0;pointLedgerChanged=$false;whole90DaysRecovered=$false}
}
Export-ModuleMember -Function Read-GapJson,Get-GapArchivedDocuments,New-GapRecoveryPlan,New-GapPointLedger,Get-GapGovernorNextAllowed,Write-GapSharedCooldown,Read-GapSharedCooldown,Test-GapScheduleWindow,Initialize-GapRecoveryFiles,Reset-GapRetryableTargets,New-GapConsNsuSoap,Invoke-GapConsNsu,ConvertFrom-GapResponse,Get-GapDocumentDisposition,Reserve-GapRequest,Complete-GapAttempt,Save-GapResponse,Publish-GapOutbox,Send-GapOutbox,Protect-GapOutboxScope,Get-GapPendingTargets,Get-GapFiscalInventory,Assert-GapQueueScope,Extend-GapRecoveryQueue
