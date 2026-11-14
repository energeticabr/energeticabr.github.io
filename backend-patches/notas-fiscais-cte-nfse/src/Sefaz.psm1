Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function Read-SafeXml([string]$Text) {
    $settings=New-Object System.Xml.XmlReaderSettings
    $settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver=$null
    $settings.MaxCharactersInDocument=16000000
    $reader=[Xml.XmlReader]::Create((New-Object IO.StringReader($Text)),$settings)
    try {$xml=New-Object Xml.XmlDocument;$xml.XmlResolver=$null;$xml.Load($reader);return ,$xml} finally {$reader.Dispose()}
}
function Get-XmlValue($Node,[string]$Path) {
    $match=$Node.SelectSingleNode($Path)
    if($null -ne $match){return $match.InnerText}
    return $null
}
function Add-XmlField($Fields,[string]$Name,$Node,[string]$Path,[switch]$Money) {
    $value=Get-XmlValue $Node $Path
    if(-not [string]::IsNullOrWhiteSpace($value)) {
        if($Money){$value=[decimal]::Parse($value,[Globalization.CultureInfo]::InvariantCulture)}
        $Fields[$Name]=$value
    }
}
function Get-FiscalAdditionalText($Node,[string]$TextElement,[string]$ObservationElement){
    if($null -eq $Node){return $null}
    $parts=New-Object 'Collections.Generic.List[string]'
    $text=Get-XmlValue $Node ("./*[local-name()='"+$TextElement+"']")
    if(-not [string]::IsNullOrWhiteSpace($text)){$parts.Add($text.Trim())}
    foreach($observation in $Node.SelectNodes("./*[local-name()='"+$ObservationElement+"']")){
        $text=Get-XmlValue $observation "./*[local-name()='xTexto']"
        if([string]::IsNullOrWhiteSpace($text)){continue}
        $label=$observation.GetAttribute('xCampo')
        if([string]::IsNullOrWhiteSpace($label)){$parts.Add($text.Trim())}else{$parts.Add($label.Trim()+': '+$text.Trim())}
    }
    if($parts.Count -gt 0){return [string]::Join("`n",$parts)}
    return $null
}
function Get-Sha256([byte[]]$Bytes) {
    $hash=[Security.Cryptography.SHA256]::Create()
    try {return ([BitConverter]::ToString($hash.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()} finally {$hash.Dispose()}
}
function Expand-DocZip([string]$Base64) {
    $compressed=[Convert]::FromBase64String($Base64)
    if($compressed.Length -gt 8000000){throw 'docZip excede limite de tamanho.'}
    $inputStream=New-Object IO.MemoryStream(,$compressed)
    $gzip=New-Object IO.Compression.GZipStream($inputStream,[IO.Compression.CompressionMode]::Decompress)
    $outputStream=New-Object IO.MemoryStream
    try {
        $buffer=New-Object byte[] 8192
        while(($read=$gzip.Read($buffer,0,$buffer.Length)) -gt 0){
            if($outputStream.Length+$read -gt 16000000){throw 'XML descompactado excede limite de tamanho.'}
            $outputStream.Write($buffer,0,$read)
        }
        return [Text.Encoding]::UTF8.GetString($outputStream.ToArray())
    } finally {$gzip.Dispose();$inputStream.Dispose();$outputStream.Dispose()}
}
function ConvertFrom-FiscalXml([string]$Text,[string]$Nsu,[string]$CompanyCnpj) {
    $xml=Read-SafeXml $Text
    $root=$xml.DocumentElement
    $f=[ordered]@{ ULTIMO_NSU=$Nsu;CNPJ_CONSULTADO=$CompanyCnpj;MODELO='55';STATUS_DANFE='PENDENTE_GERACAO' }
    $kind=$root.LocalName
    switch($kind) {
        'nfeProc' {
            $inf=$root.SelectSingleNode("./*[local-name()='NFe']/*[local-name()='infNFe']")
            if($null -eq $inf){throw 'XML completo sem infNFe.'}
            $key=$inf.GetAttribute('Id') -replace '^NFe',''
            $ide=$inf.SelectSingleNode("./*[local-name()='ide']")
            $emit=$inf.SelectSingleNode("./*[local-name()='emit']")
            $dest=$inf.SelectSingleNode("./*[local-name()='dest']")
            $tot=$inf.SelectSingleNode("./*[local-name()='total']/*[local-name()='ICMSTot']")
            if($null -eq $ide -or $null -eq $emit -or $null -eq $tot){throw 'NF-e incompleta: ide, emit ou total ausente.'}
            Add-XmlField $f 'Title' $emit "./*[local-name()='xNome']"
            Add-XmlField $f 'CNPJ_FORNECEDOR' $emit "./*[local-name()='CNPJ' or local-name()='CPF']"
            Add-XmlField $f 'UF_FORNECEDOR' $emit "./*[local-name()='enderEmit']/*[local-name()='UF']"
            if($null -ne $dest){
                Add-XmlField $f 'CNPJ_DESTINATARIO' $dest "./*[local-name()='CNPJ' or local-name()='CPF']"
                Add-XmlField $f 'DESTINATARIO' $dest "./*[local-name()='xNome']"
            }
            Add-XmlField $f 'NUMERO_NOTA' $ide "./*[local-name()='nNF']"
            Add-XmlField $f 'SERIE' $ide "./*[local-name()='serie']"
            Add-XmlField $f 'MODELO' $ide "./*[local-name()='mod']"
            Add-XmlField $f 'DATA_EMISSAO' $ide "./*[local-name()='dhEmi' or local-name()='dEmi']"
            if($f.Contains('DATA_EMISSAO')){$f.DATA_EMISSAO_ORIGINAL=$f.DATA_EMISSAO}
            Add-XmlField $f 'NATUREZA_OPERACAO' $ide "./*[local-name()='natOp']"
            $additional=$inf.SelectSingleNode("./*[local-name()='infAdic']")
            $notes=Get-FiscalAdditionalText $additional 'infCpl' 'obsCont'
            $taxNotes=Get-FiscalAdditionalText $additional 'infAdFisco' 'obsFisco'
            if($null -ne $notes){$f.OBSERVACOES_NOTA=$notes}
            if($null -ne $taxNotes){$f.INFORMACOES_FISCO=$taxNotes}
            $itemDescriptions=New-Object 'Collections.Generic.List[string]'
            foreach($item in $inf.SelectNodes("./*[local-name()='det']/*[local-name()='prod']/*[local-name()='xProd']")){
                if(-not [string]::IsNullOrWhiteSpace($item.InnerText)){$itemDescriptions.Add($item.InnerText.Trim())}
            }
            if($itemDescriptions.Count -gt 0){$f.DESCRICAO_ITENS=[string]::Join('; ',$itemDescriptions)}
            $moneyMap=@{VALOR_PRODUTOS='vProd';VALOR_TOTAL_NOTA='vNF';DESCONTOS='vDesc';FRETE='vFrete';SEGURO='vSeg';OUTRAS_DESPESAS='vOutro';IPI='vIPI';ICMS='vICMS';PIS='vPIS';COFINS='vCOFINS';ICMS_ST='vST';ICMS_DESONERADO='vICMSDeson';FCP_ST='vFCPST';IMPOSTO_IMPORTACAO='vII'}
            foreach($name in $moneyMap.Keys){Add-XmlField $f $name $tot ("./*[local-name()='"+$moneyMap[$name]+"']") -Money}
            $retention=$inf.SelectSingleNode("./*[local-name()='total']/*[local-name()='retTrib']")
            $retentionMap=@{PIS_RETIDO='vRetPIS';COFINS_RETIDA='vRetCOFINS';CSLL_RETIDA='vRetCSLL';IRRF_RETIDO='vIRRF';INSS_RETIDO='vRetPrev'}
            if($null -ne $retention){foreach($name in $retentionMap.Keys){Add-XmlField $f $name $retention ("./*[local-name()='"+$retentionMap[$name]+"']") -Money}}
            $issTotals=$inf.SelectSingleNode("./*[local-name()='total']/*[local-name()='ISSQNtot']")
            if($null -ne $issTotals){Add-XmlField $f 'ISS_RETIDO' $issTotals "./*[local-name()='vISSRet']" -Money}
            $f.STATUS_RETENCOES='NAO_INFORMADA_XML'
            foreach($name in @('PIS_RETIDO','COFINS_RETIDA','CSLL_RETIDA','IRRF_RETIDO','INSS_RETIDO','ISS_RETIDO')){
                if($f.Contains($name) -and $f[$name] -gt 0){$f.STATUS_RETENCOES='RETENCAO_INFORMADA_XML'}
            }
            if(-not $f.Contains('VALOR_TOTAL_NOTA')){throw 'NF-e sem vNF.'}
            $fat=$inf.SelectSingleNode("./*[local-name()='cobr']/*[local-name()='fat']")
            if($null -ne $fat){
                Add-XmlField $f 'VALOR_ORIGINAL_FATURA' $fat "./*[local-name()='vOrig']" -Money
                Add-XmlField $f 'DESCONTO_FATURA' $fat "./*[local-name()='vDesc']" -Money
                Add-XmlField $f 'VALOR_LIQUIDO' $fat "./*[local-name()='vLiq']" -Money
            }
            if($f.Contains('VALOR_LIQUIDO')){$f.ORIGEM_LIQUIDO='cobr/fat/vLiq'}else{$f.VALOR_LIQUIDO=$f.VALOR_TOTAL_NOTA;$f.ORIGEM_LIQUIDO='vNF (sem fatura no XML)'}
            Add-XmlField $f 'PROTOCOLO' $root "./*[local-name()='protNFe']/*[local-name()='infProt']/*[local-name()='nProt']"
            $status=Get-XmlValue $root "./*[local-name()='protNFe']/*[local-name()='infProt']/*[local-name()='cStat']"
            if($status -notin @('100','150')){throw "Protocolo NF-e sem autorizacao aceita: $status"}
            $f.SITUACAO='AUTORIZADA';$f.STATUS_IMPORTACAO='XML_COMPLETO'
            $f.DIRECAO='TERCEIROS'
            if($f.Contains('CNPJ_DESTINATARIO') -and $f.CNPJ_DESTINATARIO -eq $CompanyCnpj){$f.DIRECAO='ENTRADA'}
            elseif($f.CNPJ_FORNECEDOR -eq $CompanyCnpj){$f.DIRECAO='SAIDA'}
            # O XML original conserva parcelas, itens, retencoes e novos tributos RTC sem perda.
        }
        'resNFe' {
            $key=Get-XmlValue $root "./*[local-name()='chNFe']"
            Add-XmlField $f 'Title' $root "./*[local-name()='xNome']"
            Add-XmlField $f 'CNPJ_FORNECEDOR' $root "./*[local-name()='CNPJ' or local-name()='CPF']"
            Add-XmlField $f 'DATA_EMISSAO' $root "./*[local-name()='dhEmi']"
            if($f.Contains('DATA_EMISSAO')){$f.DATA_EMISSAO_ORIGINAL=$f.DATA_EMISSAO}
            Add-XmlField $f 'VALOR_TOTAL_NOTA' $root "./*[local-name()='vNF']" -Money
            $f.STATUS_IMPORTACAO='RESUMO_AGUARDANDO_XML'
            $status=Get-XmlValue $root "./*[local-name()='cSitNFe']"
            if($status -eq '3'){$f.SITUACAO='CANCELADA'}
        }
        {$_ -in @('procEventoNFe','resEvento')} {
            $inf=$root.SelectSingleNode("./*[local-name()='evento']/*[local-name()='infEvento']")
            if($null -eq $inf){$inf=$root}
            $key=Get-XmlValue $inf "./*[local-name()='chNFe']"
            Add-XmlField $f 'TIPO_EVENTO' $inf "./*[local-name()='tpEvento']"
            Add-XmlField $f 'DATA_EVENTO' $inf "./*[local-name()='dhEvento']"
            $f.STATUS_IMPORTACAO='EVENTO_SEM_XML'
            $status=Get-XmlValue $root "./*[local-name()='retEvento']/*[local-name()='infEvento']/*[local-name()='cStat']"
            $registeredSummary=$kind -eq 'resEvento' -and -not [string]::IsNullOrWhiteSpace((Get-XmlValue $root "./*[local-name()='nProt']"))
            if($f.Contains('TIPO_EVENTO') -and $f.TIPO_EVENTO -eq '110111' -and ($status -in @('135','155') -or $registeredSummary)){$f.SITUACAO='CANCELADA'}
        }
        default {throw "Documento fiscal nao suportado: $kind. Resposta preservada; cursor nao avancado."}
    }
    # NT 2026.004: a chave pode conter o CNPJ alfanumerico nas posicoes 7 a 18.
    if($key -cnotmatch '^\d{6}[A-Z0-9]{12}\d{26}$'){throw 'Chave NF-e invalida no documento.'}
    $f.CHAVE_ACESSO=$key
    $f.TIPO_DOCUMENTO=$kind
    $bytes=[Text.Encoding]::UTF8.GetBytes($Text)
    $sha=Get-Sha256 $bytes
    $id=$Nsu.PadLeft(15,'0')+'-'+$sha.Substring(0,16)
    return [pscustomobject]@{id=$id;nsu=$Nsu.PadLeft(15,'0');key=$key;kind=$kind;fields=$f;xmlBase64=[Convert]::ToBase64String($bytes);fileName=($key+'-'+$id+'.xml');sha256=$sha}
}
function Merge-FiscalFields([System.Collections.IDictionary]$Existing,[System.Collections.IDictionary]$Incoming) {
    $result=[ordered]@{}
    foreach($k in $Existing.Keys){$result[$k]=$Existing[$k]}
    # A complete XML reanalysis clears optional values no longer present.
    if($Incoming['STATUS_IMPORTACAO'] -eq 'XML_COMPLETO'){
        foreach($k in @('PIS_RETIDO','COFINS_RETIDA','CSLL_RETIDA','IRRF_RETIDO','INSS_RETIDO','ISS_RETIDO')){if(-not $Incoming.Contains($k)){$result.Remove($k)}}
    }
    $full=$Existing.Contains('STATUS_IMPORTACAO') -and $Existing['STATUS_IMPORTACAO'] -eq 'XML_COMPLETO'
    foreach($k in $Incoming.Keys){
        if($full -and $Incoming['STATUS_IMPORTACAO'] -ne 'XML_COMPLETO' -and $k -notin @('SITUACAO','ULTIMO_NSU','TIPO_EVENTO','DATA_EVENTO')){continue}
        if($k -eq 'SITUACAO' -and $Existing.Contains($k) -and $Existing[$k] -eq 'CANCELADA'){continue}
        if($k -eq 'ULTIMO_NSU' -and $Existing.Contains($k) -and [long]$Existing[$k] -gt [long]$Incoming[$k]){continue}
        if($k -eq 'STATUS_DANFE' -and $Existing.Contains($k) -and $Existing[$k] -eq 'DISPONIVEL'){continue}
        if($null -ne $Incoming[$k]){$result[$k]=$Incoming[$k]}
    }
    return $result
}
function Get-DistributionDecision([string]$Status,[string]$LastNsu,[string]$MaxNsu,[DateTimeOffset]$Now,[int]$Cooldown=65) {
    if($LastNsu -notmatch '^\d{15}$' -or $MaxNsu -notmatch '^\d{15}$' -or [long]$LastNsu -gt [long]$MaxNsu){throw 'NSU invalido na resposta.'}
    if($Status -notin @('137','138','656')){throw "SEFAZ retornou codigo $Status; cursor preservado."}
    $more=$Status -eq '138' -and [long]$LastNsu -lt [long]$MaxNsu
    $next=$Now.AddMinutes([Math]::Max(65,$Cooldown))
    if($more){$next=$Now}
    return [pscustomobject]@{nextNsu=$LastNsu;shouldContinue=$more;nextAllowedAt=$next.ToString('o')}
}
function Get-SefazCursorPlan([string]$LastNsu,[string]$ServerHint){
    if($LastNsu -notmatch '^\d{15}$' -or $ServerHint -notmatch '^\d{15}$'){throw 'NSU de retomada invalido.'}
    $result=[ordered]@{requestNsu=$LastNsu;historyGapFrom=$null;historyGapThrough=$null}
    if([long]$ServerHint -gt [long]$LastNsu){
        $result.requestNsu=$ServerHint
        $result.historyGapFrom=$LastNsu
        $result.historyGapThrough=$ServerHint
    }
    return [pscustomobject]$result
}
function Write-AtomicJson([string]$Path,$Value) {
    $parent=Split-Path $Path -Parent
    [IO.Directory]::CreateDirectory($parent)|Out-Null
    $tmp=$Path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
    try {
        $bytes=[Text.Encoding]::UTF8.GetBytes(($Value|ConvertTo-Json -Depth 35 -Compress))
        $file=New-Object IO.FileStream($tmp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try{$file.Write($bytes,0,$bytes.Length);$file.Flush($true)}finally{$file.Dispose()}
        if([IO.File]::Exists($Path)){
            # PowerShell converte $null para string vazia no overload de File.Replace.
            $backup=$tmp+'.backup'
            [IO.File]::Replace($tmp,$Path,$backup)
            [IO.File]::Delete($backup)
        }else{[IO.File]::Move($tmp,$Path)}
    }finally{if([IO.File]::Exists($tmp)){[IO.File]::Delete($tmp)}}
}
function Register-SefazDistributionGap([string]$DataPath,[string]$FromExclusive,[string]$ThroughInclusive,[DateTimeOffset]$Now,[switch]$Bootstrap){
    if($FromExclusive -cnotmatch '^\d{15}$' -or $ThroughInclusive -cnotmatch '^\d{15}$' -or [long]$FromExclusive -ge [long]$ThroughInclusive){throw 'SEFAZ_GAP_RANGE_INVALID'}
    $path=Join-Path $DataPath "history-gaps/$FromExclusive-$ThroughInclusive.json"
    if(-not [IO.File]::Exists($path)){
        Write-AtomicJson $path ([ordered]@{status='HISTORICAL_RECOVERY_REQUIRED';source='SEFAZ';fromExclusive=$FromExclusive;throughInclusive=$ThroughInclusive;recordedAt=$Now.ToString('o');documentsImportedFromThisRange=$false;bootstrap=[bool]$Bootstrap})
    }
}
function Save-DistributionBatch([string]$Soap,[string]$DataPath,[string]$CompanyCnpj,[string]$PreviousNsu,[DateTimeOffset]$Now,[int]$Cooldown=65,$PendingResponse=$null) {
    [IO.Directory]::CreateDirectory($DataPath)|Out-Null
    [IO.Directory]::CreateDirectory((Join-Path $DataPath 'raw'))|Out-Null
    # Antes de parsing: uma consulta ja ocorreu; uma falha nao autoriza outra consulta imediata.
    $statePath=Join-Path $DataPath 'state.json'
    $held=[ordered]@{lastNsu=$PreviousNsu;nextAllowedAt=$Now.AddMinutes([Math]::Max(65,$Cooldown)).ToString('o');status='PROCESSANDO_RESPOSTA'}
    $epochPath=Join-Path $DataPath 'coverage-start.json'
    if(-not [IO.File]::Exists($epochPath)){
        Write-AtomicJson $epochPath @{startedAt=$Now.UtcDateTime.ToString('yyyyMMddTHHmmssfffffff');startNsu=$PreviousNsu}
    }
    $bytes=[Text.Encoding]::UTF8.GetBytes($Soap)
    $rawName=if($PendingResponse){$PendingResponse.responseFile}else{$Now.UtcDateTime.ToString('yyyyMMddTHHmmssfffffff')+'-'+[guid]::NewGuid().ToString('N')+'.xml'}
    $rawPath=Join-Path (Join-Path $DataPath 'raw') $rawName
    $held.requestNsu=$PreviousNsu
    $held.responseFile=$rawName
    $held.responseSha256=Get-Sha256 $bytes
    $held.queryStartedAt=$Now.ToString('o')
    $held.responseReceivedAt=if($PendingResponse){$PendingResponse.responseReceivedAt}else{[DateTimeOffset]::UtcNow.ToString('o')}
    if(-not $PendingResponse){
        Write-AtomicJson $statePath $held
        if(-not [IO.File]::Exists($rawPath)){
            $temp=$rawPath+'.tmp'
            $stream=[IO.FileStream]::new($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
            try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
            [IO.File]::Move($temp,$rawPath)
        }
    }
    $xml=Read-SafeXml $Soap
    $ret=$xml.SelectSingleNode("//*[local-name()='retDistDFeInt']")
    if($null -eq $ret){throw 'Resposta SOAP sem retDistDFeInt.'}
    $status=Get-XmlValue $ret "./*[local-name()='cStat']"
    $last=Get-XmlValue $ret "./*[local-name()='ultNSU']"
    $max=Get-XmlValue $ret "./*[local-name()='maxNSU']"
    # Alguns erros nao retornam cursores. Codigo 656 nunca os altera.
    if($status -eq '656'){
        $held.status='656'
        $reason=Get-XmlValue $ret "./*[local-name()='xMotivo']"
        if($last -match '^\d{15}$' -and [long]$last -gt [long]$PreviousNsu -and $reason -match 'ultNSU'){
            $held.serverNsuHint=$last
            $held.historyRecoveryRequired=$true
            Register-SefazDistributionGap $DataPath $PreviousNsu $last $Now
        }
        $held.responseStatus=$status
        Write-AtomicJson $statePath $held
        return [pscustomobject]$held
    }
    $decision=Get-DistributionDecision $status $last $max $Now $Cooldown
    if([long]$last -lt [long]$PreviousNsu){throw 'NSU retornou para tras; cursor preservado.'}
    $docs=@($ret.SelectNodes("./*[local-name()='loteDistDFeInt']/*[local-name()='docZip']"))
    if($status -eq '138' -and $docs.Count -eq 0){throw 'cStat 138 sem documentos; cursor preservado.'}
    $previousDoc=[long]$PreviousNsu
    $ranges=@()
    foreach($doc in $docs){
        $docNsu=$doc.GetAttribute('NSU')
        if($docNsu -notmatch '^\d{15}$' -or [long]$docNsu -le $previousDoc -or [long]$docNsu -gt [long]$last){throw 'NSU de documento fora da sequencia.'}
        if([long]$docNsu -gt ($previousDoc+1)){$ranges+=@(@{from=$previousDoc;through=([long]$docNsu-1)})}
        $previousDoc=[long]$docNsu
        $parsed=ConvertFrom-FiscalXml (Expand-DocZip $doc.InnerText) $docNsu $CompanyCnpj
        $outPath=Join-Path (Join-Path $DataPath 'outbox') ($parsed.id+'.json')
        $archived=Join-Path (Join-Path $DataPath 'archive') ($parsed.id+'.json')
        if(-not [IO.File]::Exists($archived)){Write-AtomicJson $outPath $parsed}
    }
    if([long]$last -gt $previousDoc){$ranges+=@(@{from=$previousDoc;through=([long]$last)})}
    foreach($range in $ranges){
        Register-SefazDistributionGap $DataPath ($range.from.ToString('000000000000000')) ($range.through.ToString('000000000000000')) $Now
    }
    $state=$held
    $state.lastNsu=$last
    $state.maxNsu=$max
    $state.nextAllowedAt=$decision.nextAllowedAt
    $state.status=$status
    $state.responseStatus=$status
    $state.coverageJournalRequired=$true
    Write-AtomicJson (Join-Path $DataPath "distribution-receipts/$rawName.json") ([ordered]@{
        responseFile=$rawName;responseSha256=$held.responseSha256;companyCnpj=$CompanyCnpj;requestNsu=$PreviousNsu;lastNsu=$last;responseStatus=$status
    })
    if($ranges.Count){$state.historyRecoveryRequired=$true}
    Write-AtomicJson $statePath $state
    return [pscustomobject]$state
}
function Resume-SefazDistributionBatch([string]$DataPath,[string]$CompanyCnpj,$State,[int]$Cooldown){
    if($null -eq $State -or $State.status -cne 'PROCESSANDO_RESPOSTA' -or -not $State.PSObject.Properties['responseFile']){return $State}
    if($State.responseFile -cnotmatch '^\d{8}T\d+-[a-f0-9]{32}\.xml$' -or $State.responseSha256 -cnotmatch '^[a-f0-9]{64}$' -or
       $State.requestNsu -cnotmatch '^\d{15}$' -or $State.requestNsu -cne $State.lastNsu){throw 'SEFAZ_PENDING_RESPONSE_INVALID'}
    $raw=Join-Path $DataPath "raw/$($State.responseFile)"
    if(-not [IO.File]::Exists($raw)){
        $temp=$raw+'.tmp'
        if(-not [IO.File]::Exists($temp)){return $State}
        if((Get-Sha256 ([IO.File]::ReadAllBytes($temp))) -cne $State.responseSha256){return $State}
        [IO.File]::Move($temp,$raw)
    }
    $bytes=[IO.File]::ReadAllBytes($raw)
    if((Get-Sha256 $bytes) -cne $State.responseSha256){throw 'SEFAZ_PENDING_RESPONSE_CHANGED'}
    return Save-DistributionBatch ([Text.Encoding]::UTF8.GetString($bytes)) $DataPath $CompanyCnpj $State.requestNsu ([DateTimeOffset]::Parse($State.queryStartedAt)) $Cooldown $State
}
function Get-SefazSavedDocument([string]$Path){
    $item=Read-SefazScopeJson $Path
    $name=[IO.Path]::GetFileNameWithoutExtension($Path)
    if($name -cnotmatch '^\d{15}-[a-f0-9]{16}$' -or $item.id -cne $name -or $item.nsu -cne $name.Substring(0,15) -or
       $item.sha256 -cnotmatch '^[a-f0-9]{64}$' -or -not $item.sha256.StartsWith($name.Substring(16),[StringComparison]::Ordinal) -or
       (Get-Sha256 ([Convert]::FromBase64String([string]$item.xmlBase64))) -cne $item.sha256){
        throw 'SEFAZ_SAVED_DOCUMENT_INVALID'
    }
    return $item
}

function Get-SefazCollectionGaps([string]$DataPath,[string]$InitialResumeNsu){
    foreach($file in @(Get-ChildItem -LiteralPath (Join-Path $DataPath 'history-gaps') -File -Filter '*.json' -ErrorAction SilentlyContinue)){
        if($file.BaseName -cnotmatch '^\d{15}-\d{15}$'){continue}
        $record=Read-SefazScopeJson $file.FullName
        if($record.source -cne 'SEFAZ' -or "$($record.fromExclusive)-$($record.throughInclusive)" -cne $file.BaseName -or
           [long]$record.fromExclusive -ge [long]$record.throughInclusive){throw 'SEFAZ_COVERAGE_GAP_INVALID'}
        $bootstrap=$record.PSObject.Properties['bootstrap']
        if(($bootstrap -and $bootstrap.Value -eq $true) -or (-not $bootstrap -and [long]$record.fromExclusive -eq 0 -and $record.throughInclusive -ceq $InitialResumeNsu)){continue}
        [pscustomobject]@{path=$file.FullName;record=$record}
    }
}

function Get-SefazConfirmedCorrection([string]$DataPath){
    $fiscalBase=[IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($DataPath)))
    $attached=@{}
    foreach($file in @(Get-ChildItem -LiteralPath (Join-Path $fiscalBase 'CceSync/events') -File -Filter '*.json' -ErrorAction SilentlyContinue)){
        $proof=Read-SefazScopeJson $file.FullName
        $data=$proof.PSObject.Properties
        if($data['attached'] -and $data['attached'].Value -eq $true -and $data['itemId'] -and $data['itemId'].Value -gt 0 -and
           $data['metadataVersion'] -and $data['metadataVersion'].Value -eq 1 -and $data['xmlSha256'] -and
           $data['xmlSha256'].Value -cmatch '^[a-f0-9]{64}$' -and $data['key'] -and
           (($data['originalComplete'] -and $data['originalComplete'].Value -eq $true) -or
            ($data['originalStatus'] -and $data['originalStatus'].Value -ceq 'PRAZO_SEFAZ_EXPIRADO'))){
            $attached[$data['xmlSha256'].Value]=$data['key'].Value
        }
    }
    return $attached
}

function Get-SefazCollectionCoverage([string]$DataPath,[string]$MinimumIssueDate,[DateTimeOffset]$Now,[string]$InitialResumeNsu='', [switch]$Recover){
    $stored=@{}
    $fullInvoices=@{}
    $summaries=[Collections.Generic.List[object]]::new()
    $pending=0
    $fiscalBase=[IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($DataPath)))
    foreach($file in @(Get-ChildItem -LiteralPath (Join-Path $fiscalBase 'SefazGapRecovery/archive') -File -Filter '*.json' -ErrorAction SilentlyContinue)){
        $doc=Get-SefazSavedDocument $file.FullName
        if($doc.kind -ceq 'nfeProc'){$fullInvoices[$doc.key]=$true}
    }
    $attached=Get-SefazConfirmedCorrection $DataPath
    foreach($folder in @('archive','scope-excluded','summaries','scope-pending-date','outbox')){
        foreach($file in @(Get-ChildItem -LiteralPath (Join-Path $DataPath $folder) -File -Filter '*.json' -ErrorAction SilentlyContinue)){
            $doc=Get-SefazSavedDocument $file.FullName
            $stored[$doc.id]=$doc
            if($folder -ceq 'outbox'){$pending++}
            if($folder -ceq 'scope-pending-date'){
                if($doc.kind -cne 'procEventoNFe' -or (Get-SefazScopeField $doc.fields 'TIPO_EVENTO') -cne '110110' -or
                   $attached[$doc.sha256] -cne $doc.key){
                    $pending++
                }
            }
            if($folder -ceq 'archive' -and ($doc.kind -ceq 'nfeProc' -or
               (Get-SefazScopeField $doc.fields 'SITUACAO') -ceq 'CANCELADA')){$fullInvoices[$doc.key]=$true}
            if($doc.kind -ceq 'resNFe' -and $folder -cne 'scope-excluded' -and (Get-SefazScopeField $doc.fields 'SITUACAO') -cne 'CANCELADA'){$summaries.Add($doc)}
        }
    }
    $gaps=@(Get-SefazCollectionGaps $DataPath $InitialResumeNsu)
    $unresolved=@($gaps | Where-Object {$_.record.status -cne 'RECOVERED'}).Count
    $rawDirectory=Join-Path $DataPath 'raw'
    $epochPath=Join-Path $DataPath 'coverage-start.json'
    if([IO.File]::Exists($epochPath)){
        $epoch=Read-SefazScopeJson $epochPath
        if($epoch.startedAt -cnotmatch '^\d{8}T\d{13}$' -or $epoch.startNsu -cnotmatch '^\d{15}$'){throw 'SEFAZ_COVERAGE_EPOCH_INVALID'}
    }else{$epoch=$null}

    $replayed=0
    $rawNames=@{}
    $coveredThrough=if($epoch){[long]$epoch.startNsu}else{0L}
    $orderedGaps=@($gaps | Sort-Object {$_.record.fromExclusive})
    $unresolvedNsu=@{}
    $pointEvidence=@{}
    foreach($entry in @(Get-ChildItem -LiteralPath (Join-Path $DataPath 'history-gap-receipts') -File -Filter '*.json' -ErrorAction SilentlyContinue)){
        $point=Read-SefazScopeJson $entry.FullName
        if($point.nsu -cnotmatch '^\d{15}$' -or $point.nsu -cne $entry.BaseName -or $point.status -cnotin @('137','138') -or
           $point.rawFile -cnotmatch ('^'+$point.nsu+'-[a-f0-9]{32}\.xml$') -or $point.sha256 -cnotmatch '^[a-f0-9]{64}$'){
            throw 'SEFAZ_COVERAGE_POINT_RECEIPT_INVALID'
        }
        $raw=Join-Path $DataPath "history-gap-raw/$($point.rawFile)"
        if((Get-Sha256 ([IO.File]::ReadAllBytes($raw))) -cne $point.sha256){throw 'SEFAZ_COVERAGE_RESPONSE_CHANGED'}
        $pointEvidence[$point.nsu]=$true
        if($point.status -ceq '138'){
            if($point.documentId -cnotmatch ('^'+$point.nsu+'-[a-f0-9]{16}$')){throw 'SEFAZ_COVERAGE_POINT_RECEIPT_INVALID'}
            if(-not $stored.ContainsKey($point.documentId)){$unresolvedNsu[$point.nsu]=$point}
        }
    }
    foreach($gap in $gaps){
        $record=$gap.record
        if($record.status -cne 'RECOVERED' -or -not $record.PSObject.Properties['pointReceiptsRequired'] -or -not $record.pointReceiptsRequired){continue}
        for($number=[long]$record.fromExclusive+1;$number -le [long]$record.throughInclusive;$number++){
            if($pointEvidence[$number.ToString('000000000000000')]){continue}
            $unresolved++
            if($Recover){
                $record.status='HISTORICAL_RECOVERY_REQUIRED'
                $record.documentsImportedFromThisRange=$false
                Write-AtomicJson $gap.path $record
            }
            break
        }
    }
    foreach($point in $unresolvedNsu.Values){
        $raw=Join-Path $DataPath "history-gap-raw/$($point.rawFile)"
        $bytes=[IO.File]::ReadAllBytes($raw)
        if((Get-Sha256 $bytes) -cne $point.sha256){throw 'SEFAZ_COVERAGE_RESPONSE_CHANGED'}
        $xml=Read-SafeXml ([Text.Encoding]::UTF8.GetString($bytes))
        $parts=@($xml.SelectNodes("//*[local-name()='retDistDFeInt']/*[local-name()='loteDistDFeInt']/*[local-name()='docZip']"))
        if($parts.Count -ne 1 -or $parts[0].GetAttribute('NSU') -cne $point.nsu){throw 'SEFAZ_COVERAGE_POINT_RECEIPT_INVALID'}
        $doc=ConvertFrom-FiscalXml (Expand-DocZip $parts[0].InnerText) $point.nsu ((Split-Path $DataPath -Leaf) -split '-')[0]
        if($doc.id -cne $point.documentId){throw 'SEFAZ_COVERAGE_POINT_RECEIPT_INVALID'}
        $pending++
        if($Recover){
            Write-AtomicJson (Join-Path $DataPath "outbox/$($doc.id).json") $doc
            $stored[$doc.id]=$doc
            $replayed++
        }
    }
    foreach($entry in @(Get-ChildItem -LiteralPath (Join-Path $DataPath 'distribution-receipts') -File -Filter '*.xml.json' -ErrorAction SilentlyContinue | Sort-Object Name)){
        $proof=Read-SefazScopeJson $entry.FullName
        if($proof.responseFile -cnotmatch '^\d{8}T\d+-[a-f0-9]{32}\.xml$' -or "$($proof.responseFile).json" -cne $entry.Name -or
           $proof.responseSha256 -cnotmatch '^[a-f0-9]{64}$' -or $proof.responseStatus -cnotin @('137','138') -or
           $proof.requestNsu -cnotmatch '^\d{15}$' -or $proof.lastNsu -cnotmatch '^\d{15}$' -or
           [long]$proof.requestNsu -gt [long]$proof.lastNsu -or $proof.companyCnpj -cnotmatch '^[A-Z0-9]{12}\d{2}$'){
            throw 'SEFAZ_COVERAGE_RECEIPT_INVALID'
        }
        $rawNames[$proof.responseFile]=$true
        if($epoch -and [long]$proof.requestNsu -gt $coveredThrough){
            $end=[long]$proof.requestNsu
            $cursor=$coveredThrough
            foreach($gap in $orderedGaps){
                if([long]$gap.record.fromExclusive -le $cursor -and [long]$gap.record.throughInclusive -gt $cursor){
                    $cursor=[long]$gap.record.throughInclusive
                }
            }
            if($cursor -lt $end){
                $unresolved++
                if($Recover){Register-SefazDistributionGap $DataPath ($cursor.ToString('000000000000000')) $proof.requestNsu $Now}
            }
        }
        $coveredThrough=[Math]::Max($coveredThrough,[long]$proof.lastNsu)
        $path=Join-Path $DataPath "raw/$($proof.responseFile)"
        $bytes=[IO.File]::ReadAllBytes($path)
        if((Get-Sha256 $bytes) -cne $proof.responseSha256){throw 'SEFAZ_COVERAGE_RESPONSE_CHANGED'}
        $xml=Read-SafeXml ([Text.Encoding]::UTF8.GetString($bytes))
        $ret=$xml.SelectSingleNode("//*[local-name()='retDistDFeInt']")
        if($null -eq $ret -or (Get-XmlValue $ret "./*[local-name()='cStat']") -cne $proof.responseStatus -or
           (Get-XmlValue $ret "./*[local-name()='ultNSU']") -cne $proof.lastNsu){throw 'SEFAZ_COVERAGE_RESPONSE_INCONSISTENT'}
        $previous=[long]$proof.requestNsu
        foreach($part in $ret.SelectNodes("./*[local-name()='loteDistDFeInt']/*[local-name()='docZip']")){
            $number=[long]$part.GetAttribute('NSU')
            if($number -gt ($previous+1)){
                $missingFrom=$previous.ToString('000000000000000')
                $missingThrough=($number-1).ToString('000000000000000')
                if(-not [IO.File]::Exists((Join-Path $DataPath "history-gaps/$missingFrom-$missingThrough.json"))){
                    $unresolved++
                    if($Recover){Register-SefazDistributionGap $DataPath $missingFrom $missingThrough $Now}
                }
            }
            $previous=$number
            $doc=ConvertFrom-FiscalXml (Expand-DocZip $part.InnerText) $part.GetAttribute('NSU') $proof.companyCnpj
            if($stored.ContainsKey($doc.id)){continue}
            $pending++
            if($Recover){
                Write-AtomicJson (Join-Path $DataPath "outbox/$($doc.id).json") $doc
                $stored[$doc.id]=$doc
                $replayed++
            }
        }
        if([long]$proof.lastNsu -gt $previous){
            $missingFrom=$previous.ToString('000000000000000')
            if(-not [IO.File]::Exists((Join-Path $DataPath "history-gaps/$missingFrom-$($proof.lastNsu).json"))){
                $unresolved++
                if($Recover){Register-SefazDistributionGap $DataPath $missingFrom $proof.lastNsu $Now}
            }
        }
    }
    $statePath=Join-Path $DataPath 'state.json'
    if([IO.File]::Exists($statePath)){
        $state=Read-SefazScopeJson $statePath
        if($state.status -cin @('137','138') -and $state.PSObject.Properties['coverageJournalRequired'] -and
           $state.coverageJournalRequired -and -not $rawNames[[string]$state.responseFile]){throw 'SEFAZ_COVERAGE_JOURNAL_MISSING'}
    }
    if($epoch){
        foreach($file in @(Get-ChildItem -LiteralPath $rawDirectory -File -Filter '*.xml' -ErrorAction SilentlyContinue)){
            if($file.Name -cnotmatch '^\d{8}T\d{13}-[a-f0-9]{32}\.xml$' -or
               [string]::CompareOrdinal($file.Name.Substring(0,22),$epoch.startedAt) -lt 0 -or $rawNames[$file.Name]){continue}
            $xml=Read-SafeXml ([IO.File]::ReadAllText($file.FullName))
            $ret=$xml.SelectSingleNode("//*[local-name()='retDistDFeInt']")
            if($null -eq $ret){throw 'SEFAZ_COVERAGE_RESPONSE_INCONSISTENT'}
            if((Get-XmlValue $ret "./*[local-name()='cStat']") -cin @('137','138')){throw 'SEFAZ_COVERAGE_JOURNAL_MISSING'}
        }
    }
    $summaryKeys=@($summaries | Where-Object {-not $fullInvoices.ContainsKey($_.key) -and
        (Get-SefazDocumentScopeDisposition $_ @() $MinimumIssueDate $Now) -ceq 'READY'} |
        Group-Object key | ForEach-Object {$_.Name})
    $pendingXml=$summaryKeys.Count
    return [pscustomobject]@{complete=($unresolved -eq 0 -and $pending -eq 0 -and $pendingXml -eq 0);openGaps=$unresolved;pendingDelivery=$pending;pendingXml=$pendingXml;replayed=$replayed}
}

function Write-SefazCoverageStatus([string]$DataPath,$Coverage,[DateTimeOffset]$Now){
    Write-AtomicJson (Join-Path $DataPath 'coverage-status.json') ([ordered]@{
        checkedAt=$Now.ToString('o');complete=$Coverage.complete;openGaps=$Coverage.openGaps
        pendingDelivery=$Coverage.pendingDelivery;pendingXml=$Coverage.pendingXml;replayed=$Coverage.replayed
    })
}
function Get-PendingDocuments([string]$DataPath,[int]$MaxDocuments=10,[int]$MaxOutputBytes=1500000) {
    $folder=Join-Path $DataPath 'outbox'
    if(-not [IO.Directory]::Exists($folder)){return}
    $count=0;$size=256
    foreach($file in @(Get-ChildItem -LiteralPath $folder -Filter '*.json' | Sort-Object Name)){
        if($count -ge $MaxDocuments){break}
        if($file.Length+$size -gt $MaxOutputBytes){
            if($count -eq 0){throw 'Documento excede limite de saida PAD; aumente maxOutputBytes de forma compativel com o conector.'}
            break
        }
        $content=[IO.File]::ReadAllText($file.FullName)
        $size += [Text.Encoding]::UTF8.GetByteCount($content)+1
        $count++
        Write-Output ($content|ConvertFrom-Json)
    }
}
function Confirm-Documents([string]$DataPath,[string[]]$Ids) {
    [IO.Directory]::CreateDirectory((Join-Path $DataPath 'archive'))|Out-Null
    foreach($id in $Ids){
        if($id -notmatch '^\d{15}-[0-9a-f]{16}$'){throw 'ID invalido na confirmacao.'}
        $source=Join-Path (Join-Path $DataPath 'outbox') ($id+'.json')
        $dest=Join-Path (Join-Path $DataPath 'archive') ($id+'.json')
        if([IO.File]::Exists($source)){
            if([IO.File]::Exists($dest)){
                if((Get-Sha256 ([IO.File]::ReadAllBytes($source))) -ne (Get-Sha256 ([IO.File]::ReadAllBytes($dest)))){throw 'Conflito no arquivo de confirmacao.'}
                [IO.File]::Delete($source)
            }else{[IO.File]::Move($source,$dest)}
        }elseif(-not [IO.File]::Exists($dest)){throw "ID de pacote nao encontrado: $id"}
    }
}
function Get-CompanyCertificate($Config) {
    if($Config.certificateStore -notin @('CurrentUser','LocalMachine')){throw 'certificateStore invalido.'}
    $path='Cert:\'+$Config.certificateStore+'\My\'+$Config.certificateThumbprint
    $cert=Get-Item -LiteralPath $path -ErrorAction Stop
    if(-not $cert.HasPrivateKey -or $cert.NotAfter -le (Get-Date) -or $cert.NotBefore -gt (Get-Date)){throw 'Certificado sem chave privada ou fora de validade.'}
    if($cert.Subject -notlike ('*'+$Config.companyCnpj+'*')){throw 'Certificado nao corresponde ao CNPJ configurado.'}
    return $cert
}
function Invoke-SefazDistribution($Config,[string]$LastNsu,[switch]$Point) {
    if($LastNsu -notmatch '^\d{15}$'){throw 'NSU inicial deve ter 15 digitos.'}
    if($Config.companyCnpj -notmatch '^[A-Z0-9]{12}\d{2}$' -or $Config.ufCode -notmatch '^\d{2}$' -or $Config.environment -notin @('1','2')){throw 'CNPJ, UF ou ambiente invalidos.'}
    $url='https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'
    if($Config.environment -eq '2'){$url='https://hom.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'}
    $certificate=Get-CompanyCertificate $Config
    $query=if($Point){"<consNSU><NSU>$LastNsu</NSU></consNSU>"}else{"<distNSU><ultNSU>$LastNsu</ultNSU></distNSU>"}
    $soap=@"
<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg><distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>$($Config.environment)</tpAmb><cUFAutor>$($Config.ufCode)</cUFAutor><CNPJ>$($Config.companyCnpj)</CNPJ>$query</distDFeInt></nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>
"@
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    $action='http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse'
    # Invoke-WebRequest nao repete automaticamente POST. Cadeia TLS e hostname continuam validados.
    try{
        $timeout=if($Point){15}else{90}
        $response=Invoke-WebRequest -Uri $url -Method Post -Certificate $certificate -ContentType ('application/soap+xml; charset=utf-8; action="'+$action+'"') -Body ([Text.Encoding]::UTF8.GetBytes($soap)) -TimeoutSec $timeout -UseBasicParsing
        return [string]$response.Content
    }finally{$certificate.Dispose()}
}
function ConvertTo-SefazScopeDocument($Document){
    if($Document.PSObject.Properties['xmlBase64'] -and $Document.PSObject.Properties['nsu']){
        $bytes=[Convert]::FromBase64String([string]$Document.xmlBase64)
        $normalized=ConvertFrom-FiscalXml ([Text.UTF8Encoding]::new($false,$true).GetString($bytes)) ([string]$Document.nsu) '38626750000146'
        if($normalized.id -cne $Document.id -or $normalized.key -cne $Document.key -or $normalized.sha256 -cne $Document.sha256){throw 'SCOPE_DOCUMENT_INTEGRITY'}
        return $normalized
    }
    return $Document
}
function Get-SefazScopeField($Fields,[string]$Name){
    if($Fields -is [Collections.IDictionary]){if($Fields.Contains($Name)){return [string]$Fields[$Name]}}
    elseif($Fields.PSObject.Properties[$Name]){return [string]$Fields.$Name}
    return $null
}
function Get-SefazDocumentScopeDisposition($Document,[object[]]$Evidence,[string]$MinimumIssueDate,[DateTimeOffset]$Now){
    if([string]::IsNullOrWhiteSpace($MinimumIssueDate)){return 'READY'}
    $minimum=[DateTime]::ParseExact($MinimumIssueDate,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
    $doc=ConvertTo-SefazScopeDocument $Document
    $date=Get-SefazScopeField $doc.fields 'DATA_EMISSAO_ORIGINAL'
    if([string]::IsNullOrWhiteSpace($date)){$date=Get-SefazScopeField $doc.fields 'DATA_EMISSAO'}
    if([string]::IsNullOrWhiteSpace($date) -and $doc.kind -in @('procEventoNFe','resEvento')){
        foreach($candidate in @($Evidence|Where-Object{$_.key -ceq $doc.key})){
            $actual=ConvertTo-SefazScopeDocument $candidate
            $date=Get-SefazScopeField $actual.fields 'DATA_EMISSAO_ORIGINAL'
            if([string]::IsNullOrWhiteSpace($date)){$date=Get-SefazScopeField $actual.fields 'DATA_EMISSAO'}
            if(-not [string]::IsNullOrWhiteSpace($date)){break}
        }
    }
    if([string]::IsNullOrWhiteSpace($date)){return 'PENDING_DATE'}
    $issued=[DateTimeOffset]::Parse($date,[Globalization.CultureInfo]::InvariantCulture)
    if($issued -gt $Now){return 'FUTURE_DATE'}
    # Date retains the invoice's original offset/calendar day, never UTC's day.
    if($issued.Date -lt $minimum.Date){return 'BEFORE_SCOPE'}
    return 'READY'
}
function Read-SefazScopeJson([string]$Path){
    $options=@{};if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){$options.DateKind='String'}
    return ([IO.File]::ReadAllText($Path)|ConvertFrom-Json @options)
}
function Set-SefazOutboxScope([string]$DataRoot,[object[]]$Evidence,[string]$MinimumIssueDate,[DateTimeOffset]$Now){
    if([string]::IsNullOrWhiteSpace($MinimumIssueDate)){return [pscustomobject]@{excluded=0;pendingDate=0;released=0}}
    $null=[DateTime]::ParseExact($MinimumIssueDate,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
    $files=@();$documents=@();$known=@($Evidence)
    foreach($folder in @('outbox','scope-pending-date','archive','scope-excluded')){
        $path=Join-Path $DataRoot $folder
        if(-not [IO.Directory]::Exists($path)){continue}
        foreach($file in @(Get-ChildItem -LiteralPath $path -Filter '*.json' -File)){
            $doc=ConvertTo-SefazScopeDocument (Read-SefazScopeJson $file.FullName);$known+=@($doc)
            if($folder -cnotin @('archive','scope-excluded')){$files+=@($file);$documents+=@($doc)}
        }
    }
    $excluded=0;$pending=0;$released=0
    for($index=0;$index -lt $files.Count;$index++){
        $file=$files[$index];$disposition=Get-SefazDocumentScopeDisposition $documents[$index] $known $MinimumIssueDate $Now
        $folder=if($disposition -ceq 'BEFORE_SCOPE'){'scope-excluded'}elseif($disposition -ceq 'READY'){'outbox'}else{'scope-pending-date'}
        $destination=Join-Path (Join-Path $DataRoot $folder) $file.Name
        if([IO.Path]::GetFullPath($destination) -ieq $file.FullName){continue}
        [IO.Directory]::CreateDirectory((Split-Path $destination -Parent))|Out-Null
        if([IO.File]::Exists($destination)){
            if((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -cne (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash){throw 'SCOPE_DOCUMENT_CONFLICT'}
            [IO.File]::Delete($file.FullName)
        }else{[IO.File]::Move($file.FullName,$destination)}
        if($folder -ceq 'scope-excluded'){$excluded++}elseif($folder -ceq 'outbox'){$released++}else{$pending++}
    }
    return [pscustomobject]@{excluded=$excluded;pendingDate=$pending;released=$released}
}
Export-ModuleMember -Function ConvertFrom-FiscalXml,Merge-FiscalFields,Expand-DocZip,Get-DistributionDecision,Get-SefazCursorPlan,Register-SefazDistributionGap,Save-DistributionBatch,Resume-SefazDistributionBatch,Get-SefazCollectionGaps,Get-SefazConfirmedCorrection,Get-SefazCollectionCoverage,Write-SefazCoverageStatus,Get-PendingDocuments,Confirm-Documents,Get-CompanyCertificate,Invoke-SefazDistribution,Write-AtomicJson,Get-SefazDocumentScopeDisposition,Set-SefazOutboxScope
