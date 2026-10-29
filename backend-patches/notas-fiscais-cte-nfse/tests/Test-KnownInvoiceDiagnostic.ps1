$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot '../src/Sefaz.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../src/GapRecovery.psm1') -DisableNameChecking
$module=Join-Path $PSScriptRoot '../src/KnownInvoiceDiagnostic.psm1'
if(Test-Path $module){Import-Module $module -Force -DisableNameChecking}else{function Invoke-KnownInvoiceDiagnostic {return $null}}
$script:checks=0
function Equal($actual,$expected,$name){if($actual -cne $expected){throw "ASSERT_$name actual=$actual expected=$expected"};$script:checks++}
$now=[DateTimeOffset]::Parse('2026-10-29T20:00:00Z');$clock={ $now }.GetNewClosure()
$company='38626750000146';$issuer='12345678000195';$key='31261012345678000195550010000000011000000010'
$sum=0;for($i=42;$i -ge 0;$i--){$sum+=[int]::Parse($key.Substring($i,1))*(2+((42-$i)%8))};$dv=11-($sum%11);if($dv -ge 10){$dv=0};$key=$key.Substring(0,43)+$dv
$cfg=[pscustomobject]@{companyCnpj=$company;ufCode='31';environment='1'}
$full='<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe'+$key+'"><ide><mod>55</mod><nNF>1</nNF><serie>1</serie><dhEmi>2026-10-20T12:00:00-03:00</dhEmi></ide><emit><CNPJ>'+$issuer+'</CNPJ><xNome>SYNTHETIC</xNome></emit><dest><CNPJ>'+$company+'</CNPJ></dest><total><ICMSTot><vNF>123.45</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><cStat>100</cStat><chNFe>'+$key+'</chNFe><nProt>123456789012345</nProt></infProt></protNFe></nfeProc>'
$summary='<resNFe xmlns="http://www.portalfiscal.inf.br/nfe"><chNFe>'+$key+'</chNFe><CNPJ>'+$issuer+'</CNPJ><xNome>SYNTHETIC</xNome><dhEmi>2026-10-20T12:00:00-03:00</dhEmi><vNF>123.45</vNF><cSitNFe>1</cSitNFe></resNFe>'
function Soap($text,$nsu='1270'){
    $memory=[IO.MemoryStream]::new();$gzip=[IO.Compression.GZipStream]::new($memory,[IO.Compression.CompressionMode]::Compress,$true)
    $bytes=[Text.Encoding]::UTF8.GetBytes($text);$gzip.Write($bytes,0,$bytes.Length);$gzip.Dispose();$base64=[Convert]::ToBase64String($memory.ToArray());$memory.Dispose()
    return '<retDistDFeInt><cStat>138</cStat><loteDistDFeInt><docZip NSU="'+$nsu+'">'+$base64+'</docZip></loteDistDFeInt></retDistDFeInt>'
}
$root=Join-Path ([IO.Path]::GetTempPath()) ('known-invoice-tests-'+[guid]::NewGuid().ToString('N'))
function Setup($name){
    $case=Join-Path $root $name;$live=Join-Path $case 'live';$gap=Join-Path $case 'gap';$diagnostic=Join-Path $case 'diagnostic'
    [IO.Directory]::CreateDirectory((Join-Path $live ($company+'-1')))|Out-Null;[IO.Directory]::CreateDirectory($gap)|Out-Null
    foreach($path in @((Join-Path $live 'worker.lock'),(Join-Path $live ($company+'-1/collector.lock')),(Join-Path $gap 'worker.lock'),(Join-Path $gap 'collector.lock'))){[IO.File]::WriteAllText($path,'')}
    Write-AtomicJson (Join-Path $live ($company+'-1/state.json')) @{lastNsu='000000000001387';nextAllowedAt=$now.AddHours(-1).ToString('o')}
    Write-AtomicJson (Join-Path $gap 'point-ledger.json') @{version=1;attempts=@();holds=@();events=@()}
    Write-AtomicJson (Join-Path $gap 'queue.json') @{sentinel='DO_NOT_CHANGE'}
    return @{Config=$cfg;Key=$key;IssueDate='2026-10-20';LiveDataRoot=$live;GapDataRoot=$gap;DataRoot=$diagnostic;Clock=$clock}
}
try{
    $p=Setup 'full';$point=Join-Path $p.GapDataRoot 'point-ledger.json';$queue=Join-Path $p.GapDataRoot 'queue.json';$state=Join-Path $p.LiveDataRoot ($company+'-1/state.json')
    $hashQueue=(Get-FileHash $queue).Hash;$hashState=(Get-FileHash $state).Hash;$reply=Soap $full
    $transport={param($config,$target)
        # This closure crosses a module boundary: do not depend on helpers scoped
        # to the calling test script (different under -File versus & script.ps1).
        $reserved=([IO.File]::ReadAllText($point)|ConvertFrom-Json).attempts[0]
        $shared=[IO.File]::ReadAllText((Join-Path $p.GapDataRoot 'global-cooldown.json'))|ConvertFrom-Json
        if($target -cne $key -or $reserved.target -cne $key -or $reserved.queryType -cne 'consChNFe' -or $reserved.status -cne 'REQUEST_RESERVED' -or $shared.reason -cne 'REQUEST_RESERVED'){throw 'SYNTHETIC_RESERVATION_CONTRACT_FAILED'}
        return $reply
    }.GetNewClosure()
    $result=Invoke-KnownInvoiceDiagnostic @p -Transport $transport
    Equal ($null -ne $result) $true 'diagnostic_exists'
    Equal $result.status 'FULL' 'full_xml_reported';Equal $result.recipientVerified $true 'full_recipient_verified'
    Equal (Read-GapJson $point).attempts[0].status '138' 'successful_attempt_releases_hold'
    Equal (Get-FileHash $queue).Hash $hashQueue 'queue_untouched';Equal (Get-FileHash $state).Hash $hashState 'cursor_untouched'
    $record=Read-GapJson $result.recordPath;Equal $record.document.nsu '000000000001270' 'authentic_nsu_normalized'
    Equal ([IO.File]::ReadAllText($result.rawPath)) $reply 'raw_soap_preserved'
    Equal ([IO.Directory]::Exists((Join-Path $p.DataRoot 'outbox'))) $false 'diagnostic_never_queues_delivery'
    Equal (Invoke-KnownInvoiceDiagnostic @p -Transport {throw 'MUST_NOT_RETRY'}).status 'ALREADY_ATTEMPTED' 'one_attempt_only'
    $p=Setup 'summary';$reply=Soap $summary
    $r=Invoke-KnownInvoiceDiagnostic @p -Transport {$reply}.GetNewClosure()
    Equal $r.status 'SUMMARY' 'summary_truthful';Equal $r.recipientVerified $false 'summary_does_not_claim_recipient';Equal (Read-GapJson $r.recordPath).document.kind 'resNFe' 'summary_preserved'
    foreach($code in @('137','656')){
        $p=Setup $code;$reply='<retDistDFeInt><cStat>'+$code+'</cStat></retDistDFeInt>'
        $r=Invoke-KnownInvoiceDiagnostic @p -Transport {$reply}.GetNewClosure()
        Equal $r.status $(if($code -eq '137'){'EMPTY'}else{'BLOCKED_656'}) ('status_'+$code)
        $held=Get-GapGovernorNextAllowed (Read-GapJson (Join-Path $p.GapDataRoot 'point-ledger.json')) (Read-GapJson (Join-Path $p.LiveDataRoot ($company+'-1/state.json'))) $now
        Equal $held.allowed ($code -eq '137') ('cooldown_'+$code)
    }
    foreach($fault in @('recipient','protocol','number','nsu','parse','network')){
        $p=Setup $fault
        $reply=switch($fault){recipient {Soap ($full.Replace('<dest><CNPJ>'+$company,'<dest><CNPJ>11111111000191'))};protocol {Soap ($full.Replace('<chNFe>'+$key,'<chNFe>'+('1'*44)))};number {Soap ($full.Replace('<nNF>1</nNF>','<nNF>2</nNF>'))};nsu {Soap $full '0'};parse {'<broken'};default {''}}
        $transport={if($fault -eq 'network'){throw 'SIMULATED_NETWORK_FAILURE'};return $reply}.GetNewClosure()
        $r=Invoke-KnownInvoiceDiagnostic @p -Transport $transport
        Equal $r.status 'UNCERTAIN' ($fault+'_uncertain')
        Equal (Invoke-KnownInvoiceDiagnostic @p -Transport {throw 'MUST_NOT_RETRY'}).status 'ALREADY_ATTEMPTED' ($fault+'_no_retry')
        if($fault -ne 'network'){Equal ([IO.File]::ReadAllText($r.rawPath)) $reply ($fault+'_raw_preserved')}
        Equal (Get-GapGovernorNextAllowed (Read-GapJson (Join-Path $p.GapDataRoot 'point-ledger.json')) (Read-GapJson (Join-Path $p.LiveDataRoot ($company+'-1/state.json'))) $now).allowed $false ($fault+'_holds')
    }
    foreach($reason in @('shared','live','rate','reserved','busy')){
        $p=Setup $reason;$point=Join-Path $p.GapDataRoot 'point-ledger.json';$handle=$null
        switch($reason){
            shared {Write-GapSharedCooldown $p.GapDataRoot ([pscustomobject]@{reason='REQUEST_UNCERTAIN';nextAllowedAt=$now.AddMinutes(10).ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'")}) $now}
            live {Write-AtomicJson (Join-Path $p.LiveDataRoot ($company+'-1/state.json')) @{lastNsu='000000000001387';nextAllowedAt=$now.AddMinutes(10).ToString('o')}}
            rate {$ledger=Read-GapJson $point;$ledger.attempts=@(1..18|ForEach-Object{[pscustomobject]@{queryType='consNSU';target=[string]$_;startedAt=$now.AddMinutes(-30).ToString('o');holdUntil=$now.AddMinutes(-30).ToString('o');status='138'}});Write-AtomicJson $point $ledger}
            reserved {$ledger=Read-GapJson $point;$ledger.attempts=@([pscustomobject]@{queryType='consNSU';target='123';startedAt=$now.ToString('o');holdUntil=$now.AddMinutes(65).ToString('o');status='REQUEST_RESERVED'});Write-AtomicJson $point $ledger}
            busy {$handle=[IO.FileStream]::new((Join-Path $p.GapDataRoot 'collector.lock'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}
        }
        try{$r=Invoke-KnownInvoiceDiagnostic @p -Transport {throw 'MUST_NOT_CALL'};Equal $r.status $(if($reason -eq 'busy'){'BUSY'}else{'WAIT'}) ($reason+'_no_request')}finally{if($handle){$handle.Dispose()}}
    }
    Write-Output "PASS $script:checks known-invoice diagnostic checks (synthetic only)"
}finally{if([IO.Directory]::Exists($root)){Remove-Item -LiteralPath $root -Recurse -Force}}
