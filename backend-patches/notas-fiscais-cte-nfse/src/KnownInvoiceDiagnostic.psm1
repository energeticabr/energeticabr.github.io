Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Sefaz.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'GapRecovery.psm1') -DisableNameChecking

function ConvertTo-KnownUtc([DateTimeOffset]$Time){return $Time.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'",[Globalization.CultureInfo]::InvariantCulture)}
function Read-KnownXml([string]$Text){
    $settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit;$settings.XmlResolver=$null;$settings.MaxCharactersInDocument=16000000
    $reader=[Xml.XmlReader]::Create([IO.StringReader]::new($Text),$settings)
    try{$xml=[Xml.XmlDocument]::new();$xml.XmlResolver=$null;$xml.Load($reader);return ,$xml}finally{$reader.Dispose()}
}
function Write-KnownRaw([string]$Path,[string]$Text){
    [IO.Directory]::CreateDirectory((Split-Path $Path -Parent))|Out-Null
    $file=[IO.FileStream]::new($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes($Text);$file.Write($bytes,0,$bytes.Length);$file.Flush($true)}finally{$file.Dispose()}
}

function Invoke-KnownInvoiceRequest($Config,[string]$Key){
    # Same production consChNFe mTLS endpoint/action; one POST, no retry or event.
    $soap='<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg><distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>31</cUFAutor><CNPJ>38626750000146</CNPJ><consChNFe><chNFe>'+$Key+'</chNFe></consChNFe></distDFeInt></nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>'
    $certificate=Get-CompanyCertificate $Config
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    $action='http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse'
    $response=Invoke-WebRequest -Uri 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx' -Method Post -Certificate $certificate -ContentType ('application/soap+xml; charset=utf-8; action="'+$action+'"') -Body ([Text.Encoding]::UTF8.GetBytes($soap)) -TimeoutSec 90 -UseBasicParsing
    return [string]$response.Content
}
function ConvertFrom-KnownInvoiceResponse([string]$Soap,[string]$Key,[string]$IssueDate,[string]$CompanyCnpj,[DateTimeOffset]$Now){
    $xml=Read-KnownXml $Soap;$responses=@($xml.SelectNodes("//*[local-name()='retDistDFeInt']"))
    if($responses.Count -ne 1){throw 'KNOWN_RESPONSE_INVALID'};$ret=$responses[0]
    $node=$ret.SelectSingleNode("./*[local-name()='cStat']");if($null -eq $node){throw 'KNOWN_STATUS_MISSING'};$status=$node.InnerText
    $nodes=@($ret.SelectNodes("./*[local-name()='loteDistDFeInt']/*[local-name()='docZip']"))
    if($status -in @('137','656')){
        if($nodes.Count){throw 'KNOWN_UNEXPECTED_DOCUMENT'}
        return [pscustomobject]@{status=$status;kind=if($status -ceq '137'){'EMPTY'}else{'BLOCKED_656'};recipientVerified=$false;document=$null;xml=$null}
    }
    if($status -cne '138' -or $nodes.Count -ne 1){throw 'KNOWN_RESPONSE_INVALID'}
    $rawNsu=$nodes[0].GetAttribute('NSU')
    if($rawNsu -cnotmatch '^\d{1,15}$' -or [long]$rawNsu -le 0){throw 'KNOWN_NSU_INVALID'}
    $nsu=([long]$rawNsu).ToString('000000000000000');$text=Expand-DocZip $nodes[0].InnerText
    $document=ConvertFrom-FiscalXml $text $nsu $CompanyCnpj
    if($document.kind -cnotin @('nfeProc','resNFe') -or $document.key -cne $Key -or $document.fields.CNPJ_FORNECEDOR -cne $Key.Substring(6,14) -or $document.fields.MODELO -cne '55'){throw 'KNOWN_IDENTITY_MISMATCH'}
    $issued=[DateTimeOffset]::Parse([string]$document.fields.DATA_EMISSAO,[Globalization.CultureInfo]::InvariantCulture)
    if($issued.ToString('yyyy-MM-dd') -cne $IssueDate -or $issued.ToString('yyMM') -cne $Key.Substring(2,4) -or $issued -gt $Now -or $issued -lt $Now.AddDays(-90)){throw 'KNOWN_DATE_INVALID'}
    $full=$document.kind -ceq 'nfeProc'
    if($full){
        if($document.fields.CNPJ_DESTINATARIO -cne $CompanyCnpj){throw 'KNOWN_RECIPIENT_MISMATCH'}
        if([long]$document.fields.NUMERO_NOTA -ne [long]$Key.Substring(25,9) -or [int]$document.fields.SERIE -ne [int]$Key.Substring(22,3)){throw 'KNOWN_IDENTITY_MISMATCH'}
        $fiscal=Read-KnownXml $text
        $protocol=$fiscal.SelectSingleNode("/*[local-name()='nfeProc']/*[local-name()='protNFe']/*[local-name()='infProt']/*[local-name()='chNFe']")
        if($null -eq $protocol -or $protocol.InnerText -cne $Key -or [string]$document.fields.PROTOCOLO -cnotmatch '^\d{15}$'){throw 'KNOWN_PROTOCOL_MISMATCH'}
    }
    return [pscustomobject]@{status='138';kind=if($full){'FULL'}else{'SUMMARY'};recipientVerified=$full;document=$document;xml=$text}
}
function Invoke-KnownInvoiceDiagnostic {
    [CmdletBinding()]
    param($Config,[string]$Key,[string]$IssueDate,[string]$DataRoot,[string]$GapDataRoot,[string]$LiveDataRoot,
        [scriptblock]$Transport={param($cfg,$target) Invoke-KnownInvoiceRequest $cfg $target},[scriptblock]$Clock={[DateTimeOffset]::UtcNow})
    $locks=[Collections.Generic.List[IDisposable]]::new();$attempt=$null;$rawPath=$null;$live=$null;$snapshots=@();$pointPath=Join-Path $GapDataRoot 'point-ledger.json'
    try{
        if($Config.companyCnpj -cne '38626750000146' -or [string]$Config.ufCode -cne '31' -or [string]$Config.environment -cne '1' -or $Key -cnotmatch '^\d{44}$' -or $Key.Substring(20,2) -cne '55' -or $IssueDate -cnotmatch '^\d{4}-\d{2}-\d{2}$'){throw 'KNOWN_CONFIG_INVALID'}
        $sum=0;for($i=42;$i -ge 0;$i--){$sum+=[int]::Parse($Key.Substring($i,1))*(2+((42-$i)%8))};$dv=11-($sum%11);if($dv -ge 10){$dv=0}
        if($dv -ne [int]::Parse($Key.Substring(43,1))){throw 'KNOWN_KEY_INVALID'}
        $now=[DateTimeOffset](& $Clock);$date=[DateTimeOffset]::ParseExact($IssueDate+'T12:00:00-03:00',"yyyy-MM-dd'T'HH:mm:sszzz",[Globalization.CultureInfo]::InvariantCulture)
        if($date -gt $now -or $date -lt $now.AddDays(-90) -or $date.ToString('yyMM') -cne $Key.Substring(2,4)){throw 'KNOWN_DATE_INVALID'}
        $roots=@($DataRoot,$GapDataRoot,$LiveDataRoot|ForEach-Object{[IO.Path]::GetFullPath($_).TrimEnd('\','/')})
        for($a=0;$a -lt 3;$a++){for($b=$a+1;$b -lt 3;$b++){if($roots[$a].Equals($roots[$b],[StringComparison]::OrdinalIgnoreCase) -or $roots[$a].StartsWith($roots[$b]+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or $roots[$b].StartsWith($roots[$a]+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'KNOWN_ROOTS_OVERLAP'}}}
        $companyPath=Join-Path $LiveDataRoot ($Config.companyCnpj+'-1');$statePath=Join-Path $companyPath 'state.json';$queuePath=Join-Path $GapDataRoot 'queue.json'
        try{
            foreach($path in @((Join-Path $LiveDataRoot 'worker.lock'),(Join-Path $companyPath 'collector.lock'),(Join-Path $GapDataRoot 'worker.lock'),(Join-Path $GapDataRoot 'collector.lock'))){$locks.Add([IO.FileStream]::new($path,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None))}
        }catch{return [pscustomobject]@{status='BUSY';requests=0;complete=$false}}
        $snapshots=@($statePath,$queuePath|ForEach-Object{[pscustomobject]@{path=$_;hash=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash}})
        $live=Read-GapJson $statePath;$ledger=Read-GapJson $pointPath
        if(@($ledger.attempts|Where-Object{$_.queryType -ceq 'consChNFe' -and $_.target -ceq $Key}).Count){return [pscustomobject]@{status='ALREADY_ATTEMPTED';requests=0;complete=$true}}
        $now=[DateTimeOffset](& $Clock);$live=Read-GapJson $statePath;$decision=Get-GapGovernorNextAllowed $ledger $live $now
        $shared=Read-GapSharedCooldown $GapDataRoot
        if($null -ne $shared -and [DateTimeOffset]::Parse([string]$shared.nextAllowedAt) -gt [DateTimeOffset]::Parse([string]$decision.nextAllowedAt)){$decision=[pscustomobject]@{allowed=$false;nextAllowedAt=$shared.nextAllowedAt;reason=$shared.reason;available=$decision.available}}
        if(-not $decision.allowed -or $decision.available -le 0){return [pscustomobject]@{status='WAIT';requests=0;complete=$false;governor=$decision}}
        $attempt=[pscustomobject]@{id=[guid]::NewGuid().ToString('N');queryType='consChNFe';target=$Key;startedAt=(ConvertTo-KnownUtc $now);status='REQUEST_RESERVED';holdUntil=(ConvertTo-KnownUtc $now.AddMinutes(65))}
        $ledger.attempts=@($ledger.attempts)+@($attempt);Write-AtomicJson $pointPath $ledger
        Write-GapSharedCooldown $GapDataRoot ([pscustomobject]@{reason='REQUEST_RESERVED';nextAllowedAt=$attempt.holdUntil}) $now
        $soap=[string](& $Transport $Config $Key)
        $rawPath=Join-Path $DataRoot ('raw/'+$attempt.id+'.xml');Write-KnownRaw $rawPath $soap
        $parsed=ConvertFrom-KnownInvoiceResponse $soap $Key $IssueDate $Config.companyCnpj ([DateTimeOffset](& $Clock))
        $recordPath=Join-Path $DataRoot ('records/'+$attempt.id+'.json')
        if($null -ne $parsed.document){Write-KnownRaw (Join-Path $DataRoot ('xml/'+$parsed.document.fileName)) $parsed.xml}
        $result=[ordered]@{status=$parsed.kind;complete=$true;requests=1;attemptId=$attempt.id;key=$Key;recipientVerified=$parsed.recipientVerified;rawPath=$rawPath;recordPath=$recordPath;delivery='NOT_REQUESTED';document=$parsed.document}
        Write-AtomicJson $recordPath $result
        $null=Complete-GapAttempt $GapDataRoot $pointPath $attempt.id $parsed.status (Read-GapJson $statePath) ([DateTimeOffset](& $Clock))
        $result.Remove('document');return [pscustomobject]$result
    }catch{
        Write-Verbose $_.ScriptStackTrace
        $code=if($_.Exception.Message -cmatch '^KNOWN_[A-Z_]+$'){$_.Exception.Message}else{'KNOWN_DIAGNOSTIC_FAILURE'}
        if($null -ne $attempt){
            try{$null=Complete-GapAttempt $GapDataRoot $pointPath $attempt.id 'REQUEST_UNCERTAIN' $live ([DateTimeOffset](& $Clock))}catch{}
            return [pscustomobject]@{status='UNCERTAIN';code=$code;complete=$true;requests=1;attemptId=$attempt.id;rawPath=$rawPath}
        }
        return [pscustomobject]@{status='ERROR';code=$code;complete=$false;requests=0}
    }finally{
        try{foreach($snapshot in $snapshots){if((Get-FileHash -LiteralPath $snapshot.path -Algorithm SHA256).Hash -cne $snapshot.hash){throw 'KNOWN_NATIVE_STATE_CHANGED'}}}
        finally{foreach($handle in $locks){$handle.Dispose()}}
    }
}
Export-ModuleMember -Function Invoke-KnownInvoiceDiagnostic,ConvertFrom-KnownInvoiceResponse
