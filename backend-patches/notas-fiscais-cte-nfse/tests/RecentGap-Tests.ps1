$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/Sefaz.psm1') -DisableNameChecking
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('sefaz-recent-gap-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temporary)|Out-Null
$nsu1439='000000000001439'
$nsu1440='000000000001440'
$nsu1441='000000000001441'
$now=[DateTimeOffset]::UtcNow
$company='38626750000146'
$sequence="<retDistDFeInt><cStat>656</cStat><xMotivo>Deve ser utilizado o ultNSU nas solicitacoes subsequentes</xMotivo><ultNSU>$nsu1441</ultNSU><maxNSU>000000000000000</maxNSU></retDistDFeInt>"
try{
    $state=Save-DistributionBatch $sequence $temporary $company $nsu1439 $now 65
    $gap=Join-Path $temporary "history-gaps/$nsu1439-$nsu1441.json"
    if(-not [IO.File]::Exists($gap)){throw '656 de sequencia nao persistiu a lacuna antes da retomada'}
    if($state.lastNsu -cne $nsu1439){throw 'A rejeicao avancou o cursor'}
    Import-Module (Join-Path $PSScriptRoot '../src/RecentGap.psm1') -DisableNameChecking
    Import-Module (Join-Path $PSScriptRoot '../src/GapRecovery.psm1') -DisableNameChecking
    $key='31261112345678000123550010000001231000001234'
    $invoice="<nfeProc><NFe><infNFe Id='NFe$key'><ide><mod>55</mod><nNF>123</nNF><dhEmi>2026-11-13T09:54:00-03:00</dhEmi></ide><emit><CNPJ>12345678000123</CNPJ></emit><dest><CNPJ>$company</CNPJ></dest><total><ICMSTot><vNF>753.80</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>$key</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>"
    $memory=[IO.MemoryStream]::new()
    $gzip=[IO.Compression.GZipStream]::new($memory,[IO.Compression.CompressionMode]::Compress,$true)
    $bytes=[Text.Encoding]::UTF8.GetBytes($invoice)
    $gzip.Write($bytes,0,$bytes.Length);$gzip.Dispose()
    $zip=[Convert]::ToBase64String($memory.ToArray());$memory.Dispose()
    $calls=[Collections.Generic.List[string]]::new()
    $request={
        param($config,$nsu)
        $calls.Add($nsu)
        if($nsu -ceq $nsu1440){return '<retDistDFeInt><cStat>137</cStat></retDistDFeInt>'}
        return "<retDistDFeInt><cStat>138</cStat><loteDistDFeInt><docZip NSU='$nsu1441'>$zip</docZip></loteDistDFeInt></retDistDFeInt>"
    }.GetNewClosure()
    $governor=Join-Path $temporary 'governor'
    [IO.Directory]::CreateDirectory($governor)|Out-Null
    Write-AtomicJson (Join-Path $governor 'point-ledger.json') @{version=1;holds=@();attempts=@()}
    $config=[pscustomobject]@{companyCnpj=$company;environment='1'}
    $wait=Invoke-SefazRecentGapRecovery $config $temporary $governor $state $now $request
    if($wait.status -cne 'WAIT' -or $calls.Count){throw 'Lacuna ignorou o cooldown'}
    $state.nextAllowedAt=$now.AddMinutes(-1).ToString('o')
    Invoke-SefazRecentGapRecovery $config $temporary $governor $state $now $request|Out-Null
    if($calls.Count -ne 2 -or $calls[0] -cne $nsu1440 -or $calls[1] -cne $nsu1441){throw 'NSUs faltantes nao foram consultados em ordem'}
    $pending=@(Get-PendingDocuments $temporary 10 1500000)
    if($pending.Count -ne 1 -or $pending[0].nsu -cne $nsu1441 -or $pending[0].fields.VALOR_TOTAL_NOTA -ne 753.80){throw 'NF-e recuperada nao entrou na fila normal'}
    if((Read-GapJson $gap).status -cne 'CAPTURED'){throw 'Lacuna marcada como recuperada antes da entrega'}
    [IO.File]::Delete((Join-Path $temporary "history-gap-receipts/$nsu1441.json"))
    [IO.File]::Delete((Join-Path $temporary "outbox/$($pending[0].id).json"))
    $replay=Invoke-SefazRecentGapRecovery $config $temporary $governor $state $now $request
    if($replay.status -cne 'CAPTURED' -or $calls.Count -ne 2 -or @(Get-PendingDocuments $temporary 10 1500000).Count -ne 1){throw 'Reinicio perdeu resposta persistida ou repetiu consulta'}
    Confirm-Documents $temporary @($pending[0].id)
    $again=Invoke-SefazRecentGapRecovery $config $temporary $governor $state $now $request
    if($again.status -cne 'RECONCILED' -or $calls.Count -ne 2){throw 'Reinicio repetiu consulta ja registrada'}
    if((Read-GapJson $gap).status -cne 'RECOVERED'){throw 'Lacuna nao confirmou entrega'}
    $different="<retDistDFeInt><cStat>138</cStat><loteDistDFeInt><docZip NSU='$nsu1440'>$zip</docZip></loteDistDFeInt></retDistDFeInt>"
    $failed=$false
    try{ConvertFrom-GapResponse $different $nsu1441 $company $now|Out-Null}catch{$failed=$true}
    if(-not $failed){throw 'Resposta de outro NSU aceita'}
    $normal=Join-Path $temporary 'normal'
    [IO.Directory]::CreateDirectory((Join-Path $normal 'raw'))|Out-Null
    $batch="<retDistDFeInt><cStat>138</cStat><ultNSU>$nsu1441</ultNSU><maxNSU>$nsu1441</maxNSU><loteDistDFeInt><docZip NSU='$nsu1441'>$zip</docZip></loteDistDFeInt></retDistDFeInt>"
    $saved=Save-DistributionBatch $batch $normal $company $nsu1439 $now 65
    if(-not $saved.historyRecoveryRequired -or -not [IO.File]::Exists((Join-Path $normal "history-gaps/$nsu1439-$nsu1440.json"))){throw 'Lote 138 com lacuna foi tratado como completo'}
    $legacy=Join-Path $temporary 'legacy'
    $legacyCompany=Join-Path $legacy "$company-1"
    Write-AtomicJson (Join-Path $legacyCompany 'state.json') @{status='656';lastNsu=$nsu1439;serverNsuHint=$nsu1441;nextAllowedAt=$now.AddMinutes(60).ToString('o')}
    $configPath=Join-Path $temporary 'collector-config.json'
    Write-AtomicJson $configPath @{companyCnpj=$company;environment='1';initialNsu='000000000000000';cooldownMinutes=65;maxBatchDocuments=10;maxOutputBytes=1500000}
    $result=(& (Join-Path $PSScriptRoot '../scripts/Invoke-Collector.ps1') -Command Collect -ConfigPath $configPath -DataRoot $legacy | ConvertFrom-Json)
    if($result.status -cne 'GAP_PENDING' -or $result.state.lastNsu -cne $nsu1439 -or -not [IO.File]::Exists((Join-Path $legacyCompany "history-gaps/$nsu1439-$nsu1441.json"))){throw 'Estado anterior sem manifesto pulou recuperacao'}
    Write-Host 'PASS sequencia 656, cooldown, consNSU, fila fiscal, replay, NSU incorreto e lote com lacuna.'
} finally {
    $canonical=[IO.Path]::GetFullPath($temporary)
    $parent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('/','\')+[IO.Path]::DirectorySeparatorChar
    if(-not $canonical.StartsWith($parent,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($canonical) -notlike 'sefaz-recent-gap-*'){throw 'Pasta temporaria fora do alvo'}
    Remove-Item -LiteralPath $canonical -Recurse -Force
}
