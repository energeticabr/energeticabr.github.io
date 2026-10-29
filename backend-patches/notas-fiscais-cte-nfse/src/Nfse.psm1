Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Sefaz.psm1') -DisableNameChecking -Scope Local

function Get-NfseProperty($Object,[string]$Name){
    if($null -eq $Object){return $null}
    if($Object -is [Collections.IDictionary]){return $Object[$Name]}
    $property=$Object.PSObject.Properties[$Name]
    if($null -ne $property){return $property.Value}
    return $null
}
function Get-NfseNsu([string]$Value){
    # ADN declares int64. NSU15 is a minimum width, never a truncation rule.
    $parsed=[long]0
    if($Value -notmatch '^\d{1,19}$' -or -not [long]::TryParse($Value,[ref]$parsed)){throw 'NSU NFS-e ausente ou fora do intervalo int64.'}
    return $parsed.ToString([Globalization.CultureInfo]::InvariantCulture).PadLeft(15,'0')
}
function Get-NfseXmlValue($Node,[string]$Path){
    if($null -eq $Node){return $null}
    $found=$Node.SelectSingleNode($Path)
    if($null -ne $found){return $found.InnerText}
    return $null
}
function Add-NfseField($Fields,[string]$Name,$Node,[string]$Path,[switch]$Money){
    $value=Get-NfseXmlValue $Node $Path
    if([string]::IsNullOrWhiteSpace($value)){return}
    if($Money){
        if($value -notmatch '^\d{1,15}(\.\d{1,2})?$'){throw "Valor monetario NFS-e invalido: $Name."}
        $value=[decimal]::Parse($value,[Globalization.CultureInfo]::InvariantCulture)
    }
    $Fields[$Name]=$value
}
function Read-NfseXml([string]$Text){
    # XmlReader over a TextReader sees U+FEFF as content, unlike a byte stream.
    # Strip only for parsing; document hashing/base64 still use untouched Text.
    if($Text.Length -gt 0 -and $Text[0] -eq [char]0xFEFF){$Text=$Text.Substring(1)}
    $settings=New-Object Xml.XmlReaderSettings
    $settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver=$null
    $settings.MaxCharactersInDocument=16000000
    $reader=[Xml.XmlReader]::Create((New-Object IO.StringReader($Text)),$settings)
    try{$xml=New-Object Xml.XmlDocument;$xml.PreserveWhitespace=$true;$xml.XmlResolver=$null;$xml.Load($reader);return ,$xml}finally{$reader.Dispose()}
}
function Expand-NfseXml([string]$Base64){
    $bytes=[Convert]::FromBase64String($Base64)
    if($bytes.Length -gt 8000000){throw 'ArquivoXml GZip NFS-e excede limite local.'}
    $inputStream=New-Object IO.MemoryStream(,$bytes)
    $gzip=New-Object IO.Compression.GZipStream($inputStream,[IO.Compression.CompressionMode]::Decompress)
    $output=New-Object IO.MemoryStream
    try{
        $buffer=New-Object byte[] 8192
        while(($read=$gzip.Read($buffer,0,$buffer.Length)) -gt 0){
            if($output.Length+$read -gt 16000000){throw 'XML NFS-e descompactado excede limite local.'}
            $output.Write($buffer,0,$read)
        }
        # Decoder must throw: replacing malformed bytes would destroy source fidelity.
        return [Text.UTF8Encoding]::new($false,$true).GetString($output.ToArray())
    }finally{$gzip.Dispose();$inputStream.Dispose();$output.Dispose()}
}
function ConvertFrom-NfseXml([string]$Text,[string]$Nsu,[string]$CompanyCnpj){
    $nsu15=Get-NfseNsu $Nsu
    if($CompanyCnpj -notmatch '^\d{14}$'){throw 'CNPJ consultado NFS-e invalido.'}
    $xml=Read-NfseXml $Text
    $root=$xml.DocumentElement
    if($root.NamespaceURI -cne 'http://www.sped.fazenda.gov.br/nfse'){throw 'Namespace XML NFS-e nacional invalido.'}
    $kind=$root.LocalName
    $f=[ordered]@{ULTIMO_NSU=$nsu15;CNPJ_CONSULTADO=$CompanyCnpj;TIPO_FISCAL='NFS-e';MODELO='NFS-e';TIPO_DOCUMENTO=$kind;FONTE_FISCAL='ADN_NACIONAL_NFSE'}
    $key=$null
    if($kind -ceq 'NFSe'){
        $inf=$root.SelectSingleNode("./*[local-name()='infNFSe']")
        if($null -eq $inf){throw 'NFS-e sem infNFSe.'}
        $id=$inf.GetAttribute('Id')
        if($id -cnotmatch '^NFS\d{50}$'){throw 'Chave NFS-e nacional invalida.'}
        $key=$id.Substring(3)
        $dps=$inf.SelectSingleNode("./*[local-name()='DPS']/*[local-name()='infDPS']")
        $prest=$dps.SelectSingleNode("./*[local-name()='prest']")
        $toma=$dps.SelectSingleNode("./*[local-name()='toma']")
        $emit=$inf.SelectSingleNode("./*[local-name()='emit']")
        $values=$inf.SelectSingleNode("./*[local-name()='valores']")
        if($null -eq $prest -or $null -eq $values){throw 'NFS-e incompleta: prestador ou valores ausentes.'}
        $status=Get-NfseXmlValue $inf "./*[local-name()='cStat']"
        if($status -notin @('100','102','103','107')){throw "cStat NFS-e desconhecido: $status."}
        $f.SITUACAO='AUTORIZADA';$f.STATUS_IMPORTACAO='XML_COMPLETO';$f.STATUS_DANFE='PENDENTE_GERACAO'
        Add-NfseField $f 'CNPJ_FORNECEDOR' $prest "./*[local-name()='CNPJ' or local-name()='CPF']"
        Add-NfseField $f 'Title' $prest "./*[local-name()='xNome']"
        # Emitente da NFS-e can be the service taker/intermediary. Only use it for
        # a provider's missing name when both identities explicitly agree.
        $emitIdentity=Get-NfseXmlValue $emit "./*[local-name()='CNPJ' or local-name()='CPF']"
        if(-not $f.Contains('Title') -and $f.Contains('CNPJ_FORNECEDOR') -and $emitIdentity -ceq $f.CNPJ_FORNECEDOR){Add-NfseField $f 'Title' $emit "./*[local-name()='xNome']"}
        if(-not $f.Contains('Title')){
            $providerIdentity=Get-NfseXmlValue $prest "./*[local-name()='CNPJ' or local-name()='CPF' or local-name()='NIF']"
            $f.Title='Prestador '+$providerIdentity
        }
        Add-NfseField $f 'TOMADOR' $toma "./*[local-name()='xNome']"
        Add-NfseField $f 'CNPJ_TOMADOR' $toma "./*[local-name()='CNPJ' or local-name()='CPF']"
        if($f.Contains('TOMADOR')){$f.DESTINATARIO=$f.TOMADOR}
        if($f.Contains('CNPJ_TOMADOR')){$f.CNPJ_DESTINATARIO=$f.CNPJ_TOMADOR}
        Add-NfseField $f 'NUMERO_NOTA' $inf "./*[local-name()='nNFSe']"
        # Series belongs to DPS, not NFS-e. Keep its provenance explicit.
        Add-NfseField $f 'SERIE_DPS' $dps "./*[local-name()='serie']"
        Add-NfseField $f 'NUMERO_DPS' $dps "./*[local-name()='nDPS']"
        Add-NfseField $f 'DATA_EMISSAO_DPS' $dps "./*[local-name()='dhEmi']"
        Add-NfseField $f 'DATA_EMISSAO' $inf "./*[local-name()='dhProc']"
        if(-not $f.Contains('DATA_EMISSAO')){throw 'NFS-e sem data de geracao dhProc.'}
        if($f.DATA_EMISSAO -notmatch '(Z|[+-]\d{2}:\d{2})$'){throw 'NFS-e sem fuso na data de geracao.'}
        $null=[DateTimeOffset]::Parse($f.DATA_EMISSAO,[Globalization.CultureInfo]::InvariantCulture)
        $f.DATA_EMISSAO_ORIGINAL=$f.DATA_EMISSAO;$f.ORIGEM_DATA_EMISSAO='infNFSe/dhProc'
        Add-NfseField $f 'VALOR_TOTAL_NOTA' $dps "./*[local-name()='valores']/*[local-name()='vServPrest']/*[local-name()='vServ']" -Money
        Add-NfseField $f 'VALOR_LIQUIDO' $values "./*[local-name()='vLiq']" -Money
        if(-not $f.Contains('VALOR_TOTAL_NOTA') -or -not $f.Contains('VALOR_LIQUIDO')){throw 'NFS-e sem vServ ou vLiq explicito.'}
        $f.VALOR_SERVICOS=$f.VALOR_TOTAL_NOTA
        Add-NfseField $f 'ISS' $values "./*[local-name()='vISSQN']" -Money
        $f.ORIGEM_LIQUIDO='infNFSe/valores/vLiq'
        $discounts=$dps.SelectSingleNode("./*[local-name()='valores']/*[local-name()='vDescCondIncond']")
        Add-NfseField $f 'DESCONTO_CONDICIONADO' $discounts "./*[local-name()='vDescCond']" -Money
        Add-NfseField $f 'DESCONTO_INCONDICIONADO' $discounts "./*[local-name()='vDescIncond']" -Money
        if($f.Contains('DESCONTO_CONDICIONADO') -or $f.Contains('DESCONTO_INCONDICIONADO')){
            $sum=[decimal]0
            foreach($name in @('DESCONTO_CONDICIONADO','DESCONTO_INCONDICIONADO')){if($f.Contains($name)){$sum+=$f[$name]}}
            $f.DESCONTOS=$sum
        }
        $service=$dps.SelectSingleNode("./*[local-name()='serv']")
        Add-NfseField $f 'CODIGO_SERVICO' $service "./*[local-name()='cServ']/*[local-name()='cTribNac']"
        # TCLocPrest is a choice: municipality IBGE or foreign country. Never
        # label a country, incidence locality or issuer locality as municipality.
        $municipality=Get-NfseXmlValue $service "./*[local-name()='locPrest']/*[local-name()='cLocPrestacao']"
        if(-not [string]::IsNullOrWhiteSpace($municipality)){
            Add-NfseField $f 'MUNICIPIO_PRESTACAO' $inf "./*[local-name()='xLocPrestacao']"
            if(-not $f.Contains('MUNICIPIO_PRESTACAO')){$f.MUNICIPIO_PRESTACAO=$municipality}
        }
        $parts=New-Object 'Collections.Generic.List[string]'
        foreach($path in @("./*[local-name()='cServ']/*[local-name()='xDescServ']","./*[local-name()='infoCompl']/*[local-name()='xInfComp']")){
            $part=Get-NfseXmlValue $service $path
            if(-not [string]::IsNullOrWhiteSpace($part)){$parts.Add($part)}
        }
        if($parts.Count -gt 0){$f.OBSERVACOES_NOTA=[string]::Join("`n",$parts);$f.DESCRICAO_SERVICO=$parts[0]}
        Add-NfseField $f 'INFORMACOES_FISCO' $inf "./*[local-name()='xOutInf']"
        $trib=$dps.SelectSingleNode("./*[local-name()='valores']/*[local-name()='trib']")
        $fed=$trib.SelectSingleNode("./*[local-name()='tribFed']")
        $pis=$null;if($null -ne $fed){$pis=$fed.SelectSingleNode("./*[local-name()='piscofins']")}
        Add-NfseField $f 'PIS' $pis "./*[local-name()='vPis']" -Money
        Add-NfseField $f 'COFINS' $pis "./*[local-name()='vCofins']" -Money
        $retType=Get-NfseXmlValue $pis "./*[local-name()='tpRetPisCofins']"
        if($retType -and $retType -notin @('0','1','2','3','4','5','6','7','8','9')){throw 'Tipo de retencao PIS/COFINS desconhecido.'}
        if($retType -in @('1','3','4','5','9')){Add-NfseField $f 'PIS_RETIDO' $pis "./*[local-name()='vPis']" -Money}
        if($retType -in @('1','3','4','6','7')){Add-NfseField $f 'COFINS_RETIDA' $pis "./*[local-name()='vCofins']" -Money}
        # CSLL, IRRF and previdencia use explicit retained values, never bases,
        # rates, an aggregate retention total, or free-text descriptions.
        foreach($pair in @(@('CSLL_RETIDA','vRetCSLL'),@('IRRF_RETIDO','vRetIRRF'),@('INSS_RETIDO','vRetCP'))){Add-NfseField $f $pair[0] $fed ("./*[local-name()='"+$pair[1]+"']") -Money}
        $issType=Get-NfseXmlValue $trib "./*[local-name()='tribMun']/*[local-name()='tpRetISSQN']"
        if($issType -and $issType -notin @('1','2','3')){throw 'Tipo de retencao ISSQN desconhecido.'}
        if($issType -eq '2'){Add-NfseField $f 'ISS_RETIDO' $values "./*[local-name()='vISSQN']" -Money}
        $f.STATUS_RETENCOES='NAO_INFORMADA_XML'
        foreach($name in @('PIS_RETIDO','COFINS_RETIDA','CSLL_RETIDA','IRRF_RETIDO','INSS_RETIDO','ISS_RETIDO')){if($f.Contains($name) -and $f[$name] -gt 0){$f.STATUS_RETENCOES='RETENCAO_INFORMADA_XML'}}
        $f.DIRECAO='TERCEIROS';$f.PAPEL_EMPRESA='TERCEIROS'
        $intermediary=Get-NfseXmlValue $dps "./*[local-name()='interm']/*[local-name()='CNPJ' or local-name()='CPF']"
        if($f.Contains('CNPJ_TOMADOR') -and $f.CNPJ_TOMADOR -ceq $CompanyCnpj){$f.DIRECAO='ENTRADA';$f.PAPEL_EMPRESA='TOMADOR'}
        elseif($f.Contains('CNPJ_FORNECEDOR') -and $f.CNPJ_FORNECEDOR -ceq $CompanyCnpj){$f.DIRECAO='SAIDA';$f.PAPEL_EMPRESA='PRESTADOR'}
        elseif($intermediary -ceq $CompanyCnpj){$f.PAPEL_EMPRESA='INTERMEDIARIO'}
    }elseif($kind -ceq 'evento'){
        $inf=$root.SelectSingleNode("./*[local-name()='infEvento']")
        if($null -eq $inf){throw 'XML evento NFS-e sem registro infEvento.'}
        $request=$inf.SelectSingleNode("./*[local-name()='pedRegEvento']/*[local-name()='infPedReg']")
        $key=Get-NfseXmlValue $request "./*[local-name()='chNFSe']"
        $id=$inf.GetAttribute('Id')
        if($id -cnotmatch '^EVT\d{59}$' -or $id.Substring(3,50) -cne $key){throw 'Chave e identificador do evento NFS-e divergentes.'}
        $type=$id.Substring(53,6)
        $details=$request.SelectSingleNode("./*[local-name()='e"+$type+"']")
        if($null -eq $details){throw 'Tipo do evento nao corresponde ao identificador.'}
        $f.TIPO_EVENTO=$type;$f.STATUS_IMPORTACAO='EVENTO_SEM_XML'
        Add-NfseField $f 'DATA_EVENTO' $inf "./*[local-name()='dhProc']"
        if(-not $f.Contains('DATA_EVENTO')){throw 'Evento NFS-e sem data de registro.'}
        if($type -in @('101101','105102','105104','305101')){$f.SITUACAO='CANCELADA'}
    }else{throw "Documento NFS-e nao suportado: $kind. Cursor deve ser preservado."}
    if($key -cnotmatch '^\d{50}$'){throw 'Chave NFS-e nacional invalida.'}
    $f.CHAVE_ACESSO=$key
    $bytes=[Text.Encoding]::UTF8.GetBytes($Text)
    $hash=[Security.Cryptography.SHA256]::Create()
    try{$sha=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
    $documentId=$nsu15+'-'+$sha.Substring(0,16)
    return [pscustomobject]@{id=$documentId;nsu=$nsu15;key=$key;kind=$kind;fields=$f;xmlBase64=[Convert]::ToBase64String($bytes);sha256=$sha;fileName=($key+'-'+$documentId+'.xml')}
}
function ConvertFrom-NfseDistributionResponse([string]$Text,[string]$CompanyCnpj){
    $response=$Text|ConvertFrom-Json -ErrorAction Stop
    $status=[string](Get-NfseProperty $response 'StatusProcessamento')
    if($status -cnotin @('DOCUMENTOS_LOCALIZADOS','NENHUM_DOCUMENTO_LOCALIZADO','REJEICAO')){throw 'StatusProcessamento NFS-e desconhecido.'}
    $items=@(Get-NfseProperty $response 'LoteDFe'|Where-Object{$null -ne $_})
    $errors=@(Get-NfseProperty $response 'Erros'|Where-Object{$null -ne $_})
    if($status -ceq 'DOCUMENTOS_LOCALIZADOS' -and $items.Count -eq 0){throw 'Status DOCUMENTOS_LOCALIZADOS sem documentos.'}
    if($status -cne 'DOCUMENTOS_LOCALIZADOS' -and $items.Count -gt 0){throw 'Status NFS-e inconsistente com lote de documentos.'}
    if($status -ceq 'DOCUMENTOS_LOCALIZADOS' -and $errors.Count -gt 0){throw 'Lote NFS-e localizado com erros; cursor preservado.'}
    if($items.Count -gt 50){throw 'Lote NFS-e excede 50 documentos; revisar contrato oficial antes de avancar cursor.'}
    $documents=New-Object 'Collections.Generic.List[object]'
    $last=$null
    foreach($item in $items){
        $nsu=Get-NfseNsu ([string](Get-NfseProperty $item 'NSU'))
        if($null -ne $last -and [long]$nsu -le [long]$last){throw 'NSU duplicado ou fora da ordem crescente no lote NFS-e.'}
        $type=[string](Get-NfseProperty $item 'TipoDocumento')
        if($type -cnotin @('NFSE','EVENTO')){throw "TipoDocumento NFS-e nao suportado: $type."}
        $compressed=[string](Get-NfseProperty $item 'ArquivoXml')
        if([string]::IsNullOrWhiteSpace($compressed)){throw 'ArquivoXml ausente no lote NFS-e.'}
        $document=ConvertFrom-NfseXml (Expand-NfseXml $compressed) $nsu $CompanyCnpj
        $key=[string](Get-NfseProperty $item 'ChaveAcesso')
        if($key -cne $document.key){throw 'Chave de acesso da distribuicao difere do XML NFS-e.'}
        if(($type -ceq 'NFSE' -and $document.kind -cne 'NFSe') -or ($type -ceq 'EVENTO' -and $document.kind -cne 'evento')){throw 'TipoDocumento da distribuicao difere do XML.'}
        $documents.Add($document);$last=$nsu
    }
    $more=$status -ceq 'DOCUMENTOS_LOCALIZADOS'
    $wait=3900;if($more){$wait=0}
    return [pscustomobject]@{status=$status;lastNsu=$last;hasMore=$more;documents=$documents.ToArray();retryAfterSeconds=$wait;retryPolicy='LOCAL_CONSERVATIVE_65_MIN_AFTER_EMPTY_OR_REJECTION';cursorSource='MAX_NSU_RETURNED_OR_NULL';errors=$errors;alerts=@(Get-NfseProperty $response 'Alertas'|Where-Object{$null -ne $_});environment=(Get-NfseProperty $response 'TipoAmbiente');processedAt=(Get-NfseProperty $response 'DataHoraProcessamento');applicationVersion=(Get-NfseProperty $response 'VersaoAplicativo')}
}
function Get-NfseDistributionUri($Config,[string]$LastNsu){
    $nsu=Get-NfseNsu $LastNsu
    if($Config.companyCnpj -notmatch '^\d{14}$' -or $Config.environment -notin @('1','2')){throw 'CNPJ ou ambiente NFS-e invalidos.'}
    $base='https://adn.nfse.gov.br/contribuintes'
    if($Config.environment -eq '2'){$base='https://adn.producaorestrita.nfse.gov.br/contribuintes'}
    return $base+'/DFe/'+([long]$nsu).ToString([Globalization.CultureInfo]::InvariantCulture)+'?cnpjConsulta='+$Config.companyCnpj+'&lote=true'
}
function Invoke-NfseDistribution($Config,[string]$LastNsu){
    $uri=Get-NfseDistributionUri $Config $LastNsu
    $certificate=Get-CompanyCertificate $Config
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    try{
        # No application retries: caller must persist raw reply and outbox before cursor.
        $response=Invoke-WebRequest -Uri $uri -Method Get -Certificate $certificate -Headers @{Accept='application/json'} -TimeoutSec 90 -UseBasicParsing -MaximumRedirection 0
        return [string]$response.Content
    }catch{
        # Government supplies its distribution contract for HTTP 400/404 too.
        # Preserve that body for the caller's durable raw response journal.
        $failure=$_
        $http=Get-NfseProperty $failure.Exception 'Response'
        $status=Get-NfseProperty $http 'StatusCode'
        if($null -ne $status -and [int]$status -in @(400,404)){
            # Invoke-WebRequest may already have disposed HttpResponseMessage
            # after capturing its body in ErrorDetails (notably on PS7).
            if($null -ne $failure.ErrorDetails -and -not [string]::IsNullOrWhiteSpace($failure.ErrorDetails.Message)){
                return [string]$failure.ErrorDetails.Message
            }
            $body=$null
            try{
                if($http.PSObject.Methods['GetResponseStream']){
                    $stream=$null;$reader=$null
                    try{
                        $stream=$http.GetResponseStream()
                        if($null -ne $stream){$reader=New-Object IO.StreamReader($stream);$body=$reader.ReadToEnd()}
                    }finally{
                        if($null -ne $reader){$reader.Dispose()}
                        if($null -ne $stream){$stream.Dispose()}
                    }
                }elseif($http.PSObject.Properties['Content'] -and $null -ne $http.Content){$body=$http.Content.ReadAsStringAsync().GetAwaiter().GetResult()}
            }catch{
                # An unreadable/disposed fallback must not hide the original
                # HTTP failure or manufacture an empty distribution response.
                $body=$null
            }
            if(-not [string]::IsNullOrWhiteSpace($body)){return [string]$body}
        }
        throw $failure
    }
}
Export-ModuleMember -Function ConvertFrom-NfseXml,ConvertFrom-NfseDistributionResponse,Get-NfseDistributionUri,Invoke-NfseDistribution
