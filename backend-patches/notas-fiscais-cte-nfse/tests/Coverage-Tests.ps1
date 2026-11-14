$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/Sefaz.psm1') -DisableNameChecking
$root=Join-Path ([IO.Path]::GetTempPath()) ('sefaz-coverage-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root)|Out-Null
try{
    $key='31261112345678000123550010000001231000001234'
    $cnpj='38626750000146'
    $summary="<resNFe><chNFe>$key</chNFe><CNPJ>12345678000123</CNPJ><dhEmi>2026-11-13T09:54:00-03:00</dhEmi><vNF>753.80</vNF><cSitNFe>1</cSitNFe></resNFe>"
    $invoice="<nfeProc><NFe><infNFe Id='NFe$key'><ide><mod>55</mod><nNF>123</nNF><dhEmi>2026-11-13T09:54:00-03:00</dhEmi></ide><emit><CNPJ>12345678000123</CNPJ></emit><dest><CNPJ>$cnpj</CNPJ></dest><total><ICMSTot><vNF>753.80</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>$key</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>"
    $nsu='000000000001441'
    $before='000000000001440'
    $now=[DateTimeOffset]::UtcNow
    $memory=[IO.MemoryStream]::new()
    $gzip=[IO.Compression.GZipStream]::new($memory,[IO.Compression.CompressionMode]::Compress,$true)
    $bytes=[Text.Encoding]::UTF8.GetBytes($summary);$gzip.Write($bytes,0,$bytes.Length);$gzip.Dispose()
    $zip=[Convert]::ToBase64String($memory.ToArray());$memory.Dispose()
    $soap="<retDistDFeInt><cStat>138</cStat><ultNSU>$nsu</ultNSU><maxNSU>$nsu</maxNSU><loteDistDFeInt><docZip NSU='$nsu'>$zip</docZip></loteDistDFeInt></retDistDFeInt>"
    $summaryDoc=ConvertFrom-FiscalXml $summary $nsu $cnpj
    $fullDoc=ConvertFrom-FiscalXml $invoice '000000000001442' $cnpj
    $state=Save-DistributionBatch $soap $root $cnpj $before $now 65
    if(-not $state.PSObject.Properties['responseSha256']){throw 'Resposta persistida sem prova de integridade'}
    $outbox=Join-Path $root "outbox/$($summaryDoc.id).json"
    [IO.File]::Delete($outbox)
    $result=Get-SefazCollectionCoverage $root '2026-10-29' $now -Recover
    if($result.complete -or -not [IO.File]::Exists($outbox)){throw 'Documento perdido nao foi recuperado da resposta original'}
    $summaries=Join-Path $root "summaries/$($summaryDoc.id).json"
    Write-AtomicJson $summaries $summaryDoc
    [IO.File]::Delete($outbox)
    $result=Get-SefazCollectionCoverage $root '2026-10-29' $now -Recover
    if($result.complete -or $result.pendingXml -ne 1){throw 'Resumo sem XML completo passou pela trava'}
    Write-AtomicJson (Join-Path $root "archive/$($fullDoc.id).json") $fullDoc
    $result=Get-SefazCollectionCoverage $root '2026-10-29' $now
    if(-not $result.complete){throw 'XML confirmado para a mesma chave deveria liberar a coleta'}
    $badRaw=Join-Path $root "raw/$($state.responseFile)"
    $bytes=[IO.File]::ReadAllBytes($badRaw)
    [IO.File]::WriteAllText($badRaw,'<truncated/>')
    $blocked=$false
    try{Get-SefazCollectionCoverage $root '2026-10-29' $now|Out-Null}catch{if($_.Exception.Message -ceq 'SEFAZ_COVERAGE_RESPONSE_CHANGED'){$blocked=$true}else{throw}}
    if(-not $blocked){throw 'Resposta corrompida passou pela trava'}
    [IO.File]::WriteAllBytes($badRaw,$bytes)
    $journal=Join-Path $root "distribution-receipts/$($state.responseFile).json"
    [IO.File]::Delete($journal)
    $blocked=$false
    try{Get-SefazCollectionCoverage $root '2026-10-29' $now|Out-Null}catch{if($_.Exception.Message -ceq 'SEFAZ_COVERAGE_JOURNAL_MISSING'){$blocked=$true}else{throw}}
    if(-not $blocked){throw 'Lote sem comprovante passou pela trava'}
    $pendingState=[pscustomobject]@{
        status='PROCESSANDO_RESPOSTA';requestNsu=$before;lastNsu=$before;responseFile=$state.responseFile
        responseSha256=$state.responseSha256;queryStartedAt=$state.queryStartedAt;responseReceivedAt=$state.responseReceivedAt
    }
    $restored=Resume-SefazDistributionBatch $root $cnpj $pendingState 65
    if($restored.lastNsu -cne $nsu -or -not [IO.File]::Exists($journal)){throw 'Reinicio entre resposta e comprovante perdeu a coleta'}
    Register-SefazDistributionGap $root $before $nsu $now
    if((Get-SefazCollectionCoverage $root '2026-10-29' $now).complete){throw 'Coleta concluida com uma lacuna aberta'}
    Write-Host 'PASS recibo, perda local, replay, resumo, XML entregue e lacuna pendente.'
}finally{
    $path=[IO.Path]::GetFullPath($root)
    $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('/','\')+[IO.Path]::DirectorySeparatorChar
    if(-not $path.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($path) -notlike 'sefaz-coverage-*'){throw 'Pasta temporaria fora do alvo'}
    Remove-Item -LiteralPath $path -Recurse -Force
}
