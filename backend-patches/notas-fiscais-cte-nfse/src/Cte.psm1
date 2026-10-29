Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Sefaz.psm1') -DisableNameChecking

function Read-CteSafeXml([byte[]]$Bytes){
    if($Bytes.Length -gt 80000000){throw 'XML CT-e excede limite de tamanho.'}
    $settings=New-Object Xml.XmlReaderSettings
    $settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver=$null
    $settings.MaxCharactersInDocument=80000000
    $stream=New-Object IO.MemoryStream(,$Bytes)
    $reader=$null
    try{
        $reader=[Xml.XmlReader]::Create($stream,$settings)
        $xml=New-Object Xml.XmlDocument
        $xml.XmlResolver=$null
        $xml.PreserveWhitespace=$true
        $xml.Load($reader)
        return ,$xml
    }catch{throw 'XML CT-e invalido ou recurso externo/DTD proibido.'}
    finally{if($null -ne $reader){$reader.Dispose()};$stream.Dispose()}
}
function Get-CteXmlText($Node,[string]$Path){
    if($null -eq $Node){return $null}
    $match=$Node.SelectSingleNode($Path)
    if($null -ne $match){return $match.InnerText}
    return $null
}
function Get-CteChild($Node,[string]$Name){
    if($null -ne $Node){return $Node.SelectSingleNode("./*[local-name()='"+$Name+"']")}
    return $null
}
function Get-CteChildText($Node,[string]$Name){
    return Get-CteXmlText $Node ("./*[local-name()='"+$Name+"']")
}
function Add-CteField($Fields,[string]$Name,$Node,[string]$Element,[switch]$Money){
    $value=Get-CteChildText $Node $Element
    if([string]::IsNullOrWhiteSpace($value)){return}
    if($Money){
        if($value -cnotmatch '^\d+(\.\d{1,2})?$'){throw 'Valor monetario CT-e invalido.'}
        $value=[decimal]::Parse($value,[Globalization.CultureInfo]::InvariantCulture)
    }
    $Fields[$Name]=$value
}
function ConvertTo-CteNsu([string]$Nsu){
    if($Nsu -cnotmatch '^\d{1,15}$'){throw 'NSU CT-e invalido.'}
    return $Nsu.PadLeft(15,'0')
}
function Get-CteNotes($Node,[string]$TextName,[string]$ObservationsName){
    $parts=New-Object 'Collections.Generic.List[string]'
    $text=Get-CteChildText $Node $TextName
    if(-not [string]::IsNullOrWhiteSpace($text)){$parts.Add($text.Trim())}
    if($null -ne $Node){
        foreach($obs in $Node.SelectNodes("./*[local-name()='"+$ObservationsName+"']")){
            $text=Get-CteChildText $obs 'xTexto'
            if([string]::IsNullOrWhiteSpace($text)){continue}
            $label=$obs.GetAttribute('xCampo')
            if([string]::IsNullOrWhiteSpace($label)){$parts.Add($text.Trim())}else{$parts.Add($label.Trim()+': '+$text.Trim())}
        }
    }
    if($parts.Count -gt 0){return [string]::Join("`n",$parts)}
    return $null
}
function Get-CtePartyId($Node){
    return Get-CteXmlText $Node "./*[local-name()='CNPJ' or local-name()='CPF']"
}
function ConvertFrom-CteXml {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][object]$Text,[Parameter(Mandatory=$true)][string]$Nsu,[Parameter(Mandatory=$true)][string]$CompanyCnpj)
    # Strings are encoded once as UTF-8. Distribution passes byte[] to retain the
    # exact decompressed bytes, including BOM; never hash or store reserialized XML.
    if($Text -is [byte[]]){$bytes=[byte[]]$Text}
    elseif($Text -is [string]){$bytes=[Text.Encoding]::UTF8.GetBytes([string]$Text)}
    else{throw 'XML CT-e deve ser texto UTF-8 ou bytes originais.'}
    if($bytes.Length -gt 16000000){throw 'XML CT-e excede limite de tamanho.'}
    $nsu15=ConvertTo-CteNsu $Nsu
    if($CompanyCnpj -cnotmatch '^[A-Z0-9]{12}\d{2}$'){throw 'CNPJ da empresa invalido.'}
    $xml=Read-CteSafeXml $bytes
    $root=$xml.DocumentElement
    $kind=$root.LocalName
    if($root.NamespaceURI -cne 'http://www.portalfiscal.inf.br/cte'){throw 'XML CT-e com namespace nao suportado.'}
    $f=[ordered]@{ULTIMO_NSU=$nsu15;CNPJ_CONSULTADO=$CompanyCnpj;TIPO_FISCAL='CT-e';TIPO_DOCUMENTO=$kind}
    $key=$null
    $deliveries=New-Object 'Collections.Generic.List[object]'
    if($kind -in @('cteProc','cteOSProc','cteSimpProc')){
        $isSimplified=$kind -ceq 'cteSimpProc'
        $documentName=if($kind -ceq 'cteOSProc'){'CTeOS'}elseif($isSimplified){'CTeSimp'}else{'CTe'}
        $inf=Get-CteChild (Get-CteChild $root $documentName) 'infCte'
        if($null -eq $inf){throw 'XML CT-e completo sem infCte.'}
        $key=$inf.GetAttribute('Id') -creplace '^CTe',''
        $ide=Get-CteChild $inf 'ide'
        $emit=Get-CteChild $inf 'emit'
        $prest=if($isSimplified){Get-CteChild $inf 'total'}else{Get-CteChild $inf 'vPrest'}
        $protocol=Get-CteChild (Get-CteChild $root 'protCTe') 'infProt'
        if($null -eq $ide -or $null -eq $emit -or $null -eq $prest -or $null -eq $protocol){throw 'CT-e incompleto: identificacao, emitente, totais ou protocolo ausente.'}
        $model=Get-CteChildText $ide 'mod'
        if(($kind -in @('cteProc','cteSimpProc') -and $model -cne '57') -or ($kind -ceq 'cteOSProc' -and $model -cne '67')){throw 'CT-e com modelo incompativel com a raiz.'}
        $protocolKey=Get-CteChildText $protocol 'chCTe'
        if($protocolKey -cne $key){throw 'A chave do protocolo CT-e diverge do documento.'}
        if((Get-CteChildText $protocol 'cStat') -cne '100'){throw 'Protocolo CT-e sem autorizacao aceita.'}
        if([string]::IsNullOrWhiteSpace((Get-CteChildText $protocol 'nProt'))){throw 'CT-e autorizado sem protocolo.'}
        Add-CteField $f 'Title' $emit 'xNome'
        $f.CNPJ_FORNECEDOR=Get-CtePartyId $emit
        Add-CteField $f 'UF_FORNECEDOR' (Get-CteChild $emit 'enderEmit') 'UF'
        foreach($pair in @(@('NUMERO_NOTA','nCT'),@('SERIE','serie'),@('MODELO','mod'),@('DATA_EMISSAO','dhEmi'),@('NATUREZA_OPERACAO','natOp'))){Add-CteField $f $pair[0] $ide $pair[1]}
        if($f.Contains('DATA_EMISSAO')){$f.DATA_EMISSAO_ORIGINAL=$f.DATA_EMISSAO}
        $parties=[ordered]@{REMETENTE=(Get-CteChild $inf 'rem');EXPEDIDOR=(Get-CteChild $inf 'exped');RECEBEDOR=(Get-CteChild $inf 'receb');DESTINATARIO=(Get-CteChild $inf 'dest')}
        $tomador=$null
        if($model -ceq '67' -or $isSimplified){
            $tomador=Get-CteChild $inf 'toma'
            if($isSimplified){
                if($null -eq $tomador){throw 'CT-e simplificado sem cadastro do tomador.'}
                $code=Get-CteChildText $tomador 'toma'
                if($code -cnotmatch '^[0-4]$'){throw 'CT-e simplificado com papel do tomador invalido.'}
                $map=@{'0'='REMETENTE';'1'='EXPEDIDOR';'2'='RECEBEDOR';'3'='DESTINATARIO'}
                # The simplified XSD has no individual rem/dest groups in det.
                # toma explicitly declares its own role; do not infer any other
                # recipient identity from municipalities or referenced NF-e keys.
                if($map.ContainsKey($code)){$parties[$map[$code]]=$tomador}
            }
        }
        else{
            $toma3=Get-CteChild $ide 'toma3';$toma4=Get-CteChild $ide 'toma4'
            if($null -ne $toma3 -and $null -ne $toma4){throw 'CT-e com tomador ambiguo: toma3 e toma4.'}
            if($null -ne $toma4){
                if((Get-CteChildText $toma4 'toma') -cne '4'){throw 'CT-e com codigo toma4 invalido.'}
                $tomador=$toma4
            }elseif($null -ne $toma3){
                $code=Get-CteChildText $toma3 'toma'
                $map=@{'0'='REMETENTE';'1'='EXPEDIDOR';'2'='RECEBEDOR';'3'='DESTINATARIO'}
                if(-not $map.ContainsKey($code)){throw 'CT-e com codigo toma3 invalido.'}
                $tomador=$parties[$map[$code]]
                if($null -eq $tomador){throw 'CT-e sem cadastro do tomador indicado por toma3.'}
            }else{throw 'CT-e sem toma3 ou toma4.'}
        }
        if($null -ne $tomador){
            Add-CteField $f 'TOMADOR' $tomador 'xNome'
            $id=Get-CtePartyId $tomador
            if(-not [string]::IsNullOrWhiteSpace($id)){$f.CNPJ_TOMADOR=$id}
        }
        foreach($name in $parties.Keys){
            if($null -eq $parties[$name]){continue}
            Add-CteField $f $name $parties[$name] 'xNome'
            $id=Get-CtePartyId $parties[$name]
            if(-not [string]::IsNullOrWhiteSpace($id)){$f['CNPJ_'+$name]=$id}
        }
        $roles=New-Object 'Collections.Generic.List[string]'
        if($f.CNPJ_FORNECEDOR -ceq $CompanyCnpj){$roles.Add('EMITENTE')}
        $isTomador=$f.Contains('CNPJ_TOMADOR') -and $f.CNPJ_TOMADOR -ceq $CompanyCnpj
        if($isTomador){$roles.Add('TOMADOR')}
        foreach($name in $parties.Keys){if((Get-CtePartyId $parties[$name]) -ceq $CompanyCnpj){$roles.Add($name)}}
        foreach($auth in $inf.SelectNodes("./*[local-name()='autXML']")){
            if((Get-CtePartyId $auth) -ceq $CompanyCnpj){$roles.Add('AUTORIZADO_XML');break}
        }
        $f.PAPEL_EMPRESA=if($roles.Count -eq 0){'NAO_IDENTIFICADO_NO_XML'}else{[string]::Join(';',$roles)}
        $f.DIRECAO='TERCEIROS'
        if($f.CNPJ_FORNECEDOR -ceq $CompanyCnpj){$f.DIRECAO='SAIDA'}elseif($isTomador){$f.DIRECAO='ENTRADA'}
        Add-CteField $f 'VALOR_TOTAL_NOTA' $prest 'vTPrest' -Money
        $receivableTag=if($isSimplified){'vTRec'}else{'vRec'}
        Add-CteField $f 'VALOR_LIQUIDO' $prest $receivableTag -Money
        if(-not $f.Contains('VALOR_TOTAL_NOTA')){throw 'CT-e sem vTPrest.'}
        if(-not $f.Contains('VALOR_LIQUIDO')){throw ('CT-e sem '+$receivableTag+'; liquido nao pode ser inferido.')}
        $f.ORIGEM_LIQUIDO=if($isSimplified){'total/vTRec'}else{'vPrest/vRec'}
        if($isSimplified){
            $details=@($inf.SelectNodes("./*[local-name()='det']"))
            if($details.Count -eq 0 -or $details.Count -gt 999){throw 'CT-e simplificado sem entregas ou acima do limite do leiaute.'}
            $numbers=@{}
            foreach($detail in $details){
                $number=$detail.GetAttribute('nItem')
                if($number -cnotmatch '^[1-9]\d{0,2}$' -or $numbers.ContainsKey($number)){throw 'CT-e simplificado com numero de entrega invalido ou duplicado.'}
                $numbers[$number]=$true
                $delivery=[ordered]@{number=$number;originCode=(Get-CteChildText $detail 'cMunIni');originName=(Get-CteChildText $detail 'xMunIni');destinationCode=(Get-CteChildText $detail 'cMunFim');destinationName=(Get-CteChildText $detail 'xMunFim')}
                Add-CteField $delivery 'total' $detail 'vPrest' -Money
                Add-CteField $delivery 'receivable' $detail 'vRec' -Money
                Add-CteField $delivery 'netWithoutTaxes' $detail 'vPrestLiq' -Money
                if(-not $delivery.Contains('total') -or -not $delivery.Contains('receivable')){throw 'CT-e simplificado com valores ausentes em uma entrega.'}
                $delivery.nfeKeys=@($detail.SelectNodes("./*[local-name()='infNFe']/*[local-name()='chNFe'] | ./*[local-name()='infDocAnt']/*[local-name()='infNFeTranspParcial']/*[local-name()='chNFe']") | ForEach-Object {$_.InnerText})
                $delivery.cteKeys=@($detail.SelectNodes("./*[local-name()='infDocAnt']/*[local-name()='chCTe']") | ForEach-Object {$_.InnerText})
                $deliveries.Add([pscustomobject]$delivery)
            }
        }
        # vTPrest-vRec can have other causes. Only an explicit billing discount
        # is exposed, and never deducted again from the XML's vRec.
        $fat=$inf.SelectSingleNode("./*[local-name()='infCTeNorm']/*[local-name()='cobr']/*[local-name()='fat'] | ./*[local-name()='cobr']/*[local-name()='fat']")
        Add-CteField $f 'DESCONTOS' $fat 'vDesc' -Money
        if($f.Contains('DESCONTOS')){$f.DESCONTO_FATURA=$f.DESCONTOS}
        Add-CteField $f 'VALOR_ORIGINAL_FATURA' $fat 'vOrig' -Money
        Add-CteField $f 'VALOR_LIQUIDO_FATURA' $fat 'vLiq' -Money
        $imp=Get-CteChild $inf 'imp'
        $icms=Get-CteChild $imp 'ICMS'
        $tax=if($null -ne $icms){$icms.SelectSingleNode('./*')}else{$null}
        if($null -ne $tax){
            Add-CteField $f 'ICMS' $tax 'vICMS' -Money
            if(-not $f.Contains('ICMS')){Add-CteField $f 'ICMS' $tax 'vICMSOutraUF' -Money}
            Add-CteField $f 'ICMS_ST' $tax 'vICMSSTRet' -Money
        }
        $compl=Get-CteChild $inf 'compl'
        $notes=Get-CteNotes $compl 'xObs' 'ObsCont'
        if($isSimplified){
            $lines=New-Object 'Collections.Generic.List[string]'
            if(-not [string]::IsNullOrWhiteSpace($notes)){$lines.Add($notes)}
            foreach($delivery in $deliveries){
                $line='Entrega '+$delivery.number+': '+$delivery.originName+' ['+$delivery.originCode+'] -> '+$delivery.destinationName+' ['+$delivery.destinationCode+']'
                if($delivery.nfeKeys.Count -gt 0){$line+=' | NF-e: '+[string]::Join(', ',$delivery.nfeKeys)}
                if($delivery.cteKeys.Count -gt 0){$line+=' | CT-e anterior: '+[string]::Join(', ',$delivery.cteKeys)}
                $lines.Add($line)
            }
            $notes=[string]::Join("`n",$lines)
        }
        if($null -ne $notes){$f.OBSERVACOES_NOTA=$notes}
        $fiscal=New-Object 'Collections.Generic.List[string]'
        $text=Get-CteChildText $imp 'infAdFisco'
        if(-not [string]::IsNullOrWhiteSpace($text)){$fiscal.Add($text.Trim())}
        $text=Get-CteNotes $compl 'infAdFisco' 'ObsFisco'
        if(-not [string]::IsNullOrWhiteSpace($text)){$fiscal.Add($text)}
        if($fiscal.Count -gt 0){$f.INFORMACOES_FISCO=[string]::Join("`n",$fiscal)}
        Add-CteField $f 'PROTOCOLO' $protocol 'nProt'
        $f.SITUACAO='AUTORIZADA';$f.STATUS_IMPORTACAO='XML_COMPLETO'
        $f.STATUS_DANFE='PENDENTE_GERACAO'
    }elseif($kind -ceq 'procEventoCTe'){
        $event=Get-CteChild (Get-CteChild $root 'eventoCTe') 'infEvento'
        $ret=Get-CteChild (Get-CteChild $root 'retEventoCTe') 'infEvento'
        if($null -eq $event -or $null -eq $ret){throw 'Evento CT-e processado incompleto.'}
        $key=Get-CteChildText $event 'chCTe'
        if((Get-CteChildText $event 'tpEvento') -cnotmatch '^\d{6}$'){throw 'Evento CT-e sem tipo valido.'}
        if((Get-CteChildText $event 'nSeqEvento') -cnotmatch '^\d{1,3}$'){throw 'Evento CT-e sem sequencia valida.'}
        $retKey=Get-CteChildText $ret 'chCTe'
        if($retKey -cne $key){throw 'Evento CT-e com chave divergente no retorno.'}
        foreach($tag in @('tpEvento','nSeqEvento')){
            if((Get-CteChildText $event $tag) -cne (Get-CteChildText $ret $tag)){throw 'Evento CT-e com tipo ou sequencia divergente no retorno.'}
        }
        Add-CteField $f 'TIPO_EVENTO' $event 'tpEvento'
        Add-CteField $f 'SEQUENCIA_EVENTO' $event 'nSeqEvento'
        Add-CteField $f 'DATA_EVENTO' $event 'dhEvento'
        Add-CteField $f 'PROTOCOLO_EVENTO' $ret 'nProt'
        Add-CteField $f 'STATUS_EVENTO' $ret 'cStat'
        $f.STATUS_IMPORTACAO='EVENTO_SEM_XML'
        $accepted=(Get-CteChildText $ret 'cStat') -ceq '135'
        if($accepted -and -not $f.Contains('PROTOCOLO_EVENTO')){throw 'Evento CT-e aceito sem protocolo.'}
        if($accepted -and $f.Contains('TIPO_EVENTO') -and $f.TIPO_EVENTO -ceq '110111'){$f.SITUACAO='CANCELADA'}
    }else{throw 'Documento CT-e nao suportado; preserve resposta bruta e cursor para revisao.'}
    # NT 2026.004 permits alphanumeric CNPJ bodies; preserve identifiers as text.
    if($key -cnotmatch '^\d{6}[A-Z0-9]{12}\d{26}$'){throw 'Chave CT-e invalida no documento.'}
    $keyModel=$key.Substring(20,2)
    if($keyModel -notin @('57','67')){throw 'Chave CT-e com modelo nao suportado.'}
    if($f.Contains('MODELO') -and $f.MODELO -cne $keyModel){throw 'Modelo CT-e diverge da chave.'}
    $f.MODELO=$keyModel;$f.CHAVE_ACESSO=$key
    $hash=[Security.Cryptography.SHA256]::Create()
    try{$sha=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
    $id=$nsu15+'-'+$sha.Substring(0,16)
    return [pscustomobject]@{id=$id;nsu=$nsu15;key=$key;kind=$kind;fields=$f;deliveries=@($deliveries.ToArray());xmlBase64=[Convert]::ToBase64String($bytes);fileName=($key+'-'+$id+'.xml');sha256=$sha}
}
function Expand-CteDocZip([string]$Base64){
    try{$compressed=[Convert]::FromBase64String($Base64)}catch{throw 'docZip CT-e com base64 invalido.'}
    if($compressed.Length -gt 8000000){throw 'docZip CT-e excede limite de tamanho.'}
    $stream=New-Object IO.MemoryStream(,$compressed)
    $gzip=$null;$output=New-Object IO.MemoryStream
    try{
        $gzip=New-Object IO.Compression.GZipStream($stream,[IO.Compression.CompressionMode]::Decompress)
        $buffer=New-Object byte[] 8192
        while(($read=$gzip.Read($buffer,0,$buffer.Length)) -gt 0){
            if($output.Length+$read -gt 16000000){throw 'docZip CT-e descompactado excede limite de tamanho.'}
            $output.Write($buffer,0,$read)
        }
        return ,$output.ToArray()
    }catch{throw 'docZip CT-e gzip invalido ou excede limite de tamanho.'}
    finally{if($null -ne $gzip){$gzip.Dispose()};$stream.Dispose();$output.Dispose()}
}
function New-CteUnhandledDocument([byte[]]$Bytes,[string]$Nsu,[string]$Schema,$Xml){
    $root=$Xml.DocumentElement
    $kind=$root.LocalName
    $key=Get-CteXmlText $root "./*[local-name()='protCTe']/*[local-name()='infProt']/*[local-name()='chCTe'] | ./*[local-name()='eventoCTe']/*[local-name()='infEvento']/*[local-name()='chCTe'] | ./*[local-name()='eventoMDFe']/*[local-name()='infEvento']/*[local-name()='chMDFe']"
    if($key -cnotmatch '^\d{6}[A-Z0-9]{12}\d{26}$'){$key=$null}
    $outOfScope=($root.NamespaceURI -ceq 'http://www.portalfiscal.inf.br/mdfe') -or ($root.NamespaceURI -ceq 'http://www.portalfiscal.inf.br/cte' -and ($kind -ceq 'GTVeProc' -or ($null -ne $key -and $key.Substring(20,2) -ceq '64')))
    $reason=if($outOfScope){'OUT_OF_SCOPE'}elseif($root.NamespaceURI -ceq 'http://www.portalfiscal.inf.br/cte'){'UNSUPPORTED_CTE_SCHEMA'}else{'UNKNOWN_DISTRIBUTED_SCHEMA'}
    $message=if($outOfScope){'Documento fora do escopo CT-e; XML preservado integralmente, sem importacao fiscal.'}else{'Documento pendente de interpretacao; XML preservado integralmente, sem classificacao fiscal inventada.'}
    $hash=[Security.Cryptography.SHA256]::Create()
    try{$sha=([BitConverter]::ToString($hash.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
    $nsu15=ConvertTo-CteNsu $Nsu
    $id=$nsu15+'-'+$sha.Substring(0,16)
    return [pscustomobject]@{id=$id;nsu=$nsu15;schema=$Schema;kind=$kind;key=$key;xmlBase64=[Convert]::ToBase64String($Bytes);fileName=($id+'.xml');sha256=$sha;reason=$reason;message=$message;pendingInterpretation=(-not $outOfScope)}
}
function ConvertFrom-CteDistributionResponse {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][string]$Text,[Parameter(Mandatory=$true)][string]$CompanyCnpj)
    $xml=Read-CteSafeXml ([Text.Encoding]::UTF8.GetBytes($Text))
    if($null -ne $xml.SelectSingleNode("//*[local-name()='Fault']")){throw 'SOAP Fault CT-e; resposta bruta deve ser preservada.'}
    $returns=$xml.SelectNodes("//*[local-name()='retDistDFeInt' and namespace-uri()='http://www.portalfiscal.inf.br/cte']")
    if($returns.Count -ne 1){throw 'Resposta SOAP CT-e sem retorno unico retDistDFeInt.'}
    $ret=$returns[0]
    $status=Get-CteChildText $ret 'cStat'
    if($status -cnotmatch '^\d{3}$'){throw 'Resposta CT-e com cStat invalido.'}
    $last=Get-CteChildText $ret 'ultNSU';$max=Get-CteChildText $ret 'maxNSU'
    if(-not [string]::IsNullOrWhiteSpace($last)){$last=ConvertTo-CteNsu $last}else{$last=$null}
    if(-not [string]::IsNullOrWhiteSpace($max)){$max=ConvertTo-CteNsu $max}else{$max=$null}
    if($status -in @('137','138') -and ($null -eq $last -or $null -eq $max)){throw 'Resposta CT-e sem NSU obrigatorio.'}
    # Error responses may return a resumption hint together with maxNSU=0.
    # They are evidence only; a caller must never adopt them as imported cursor.
    if($status -in @('137','138') -and $null -ne $last -and $null -ne $max -and [long]$last -gt [long]$max){throw 'NSU final CT-e excede maxNSU.'}
    $compressed=@($ret.SelectNodes("./*[local-name()='loteDistDFeInt']/*[local-name()='docZip']"))
    if($compressed.Count -gt 50){throw 'Resposta CT-e excede50documentos.'}
    if($status -ceq '138' -and $compressed.Count -eq 0){throw 'Resposta CT-e cStat138 sem documentos.'}
    if($status -cne '138' -and $compressed.Count -gt 0){throw 'Resposta CT-e com documentos e status diferente de138.'}
    $documents=New-Object 'Collections.Generic.List[object]'
    $unhandled=New-Object 'Collections.Generic.List[object]'
    $previous=$null
    foreach($zip in $compressed){
        $nsu=ConvertTo-CteNsu $zip.GetAttribute('NSU')
        if([long]$nsu -gt [long]$last){throw 'NSU documento CT-e excede ultNSU.'}
        if($null -ne $previous){
            if([long]$nsu -le [long]$previous){throw 'NSU documento CT-e fora de sequencia.'}
            if([long]$nsu -ne ([long]$previous+1)){throw 'Lacuna interna na sequencia NSU CT-e; preservar lote para recuperacao.'}
        }
        $schema=$zip.GetAttribute('schema')
        $bytes=Expand-CteDocZip $zip.InnerText
        $docXml=Read-CteSafeXml $bytes
        $kind=$docXml.DocumentElement.LocalName
        $expected=@{cteProc='^procCTe_v\d\.\d{2}\.xsd$';cteOSProc='^procCTeOS_v\d\.\d{2}\.xsd$';cteSimpProc='^procCTeSimp_v\d\.\d{2}\.xsd$';procEventoCTe='^procEventoCTe_v\d\.?\d{2}\.xsd$'}
        $eventKey=Get-CteXmlText $docXml.DocumentElement "./*[local-name()='eventoCTe']/*[local-name()='infEvento']/*[local-name()='chCTe']"
        $outsideEvent=$kind -ceq 'procEventoCTe' -and $eventKey -cmatch '^\d{6}[A-Z0-9]{12}\d{26}$' -and $eventKey.Substring(20,2) -ceq '64'
        if($docXml.DocumentElement.NamespaceURI -ceq 'http://www.portalfiscal.inf.br/cte' -and $expected.ContainsKey($kind) -and -not $outsideEvent){
            if($schema -cnotmatch $expected[$kind]){throw 'Atributo schema CT-e incompativel com a raiz do documento.'}
            $doc=ConvertFrom-CteXml $bytes $nsu $CompanyCnpj
            $doc | Add-Member -NotePropertyName schema -NotePropertyValue $schema
            $documents.Add($doc)
        }else{
            $unhandled.Add((New-CteUnhandledDocument $bytes $nsu $schema $docXml))
        }
        $previous=$nsu
    }
    if($status -ceq '138' -and $previous -cne $last){throw 'ultNSU CT-e diverge do ultimo documento do lote.'}
    return [pscustomobject]@{status=$status;lastNsu=$last;maxNsu=$max;documents=@($documents.ToArray());unhandledDocuments=@($unhandled.ToArray());reason=(Get-CteChildText $ret 'xMotivo');responseAt=(Get-CteChildText $ret 'dhResp')}
}
function Invoke-CteDistribution {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)]$Config,[Parameter(Mandatory=$true)][string]$LastNsu)
    if($LastNsu -cnotmatch '^\d{15}$'){throw 'NSU inicial CT-e deve ter15digitos.'}
    if($Config.companyCnpj -cnotmatch '^[A-Z0-9]{12}\d{2}$' -or $Config.ufCode -cnotmatch '^\d{2}$' -or $Config.environment -notin @('1','2')){throw 'CNPJ, UF ou ambiente CT-e invalidos.'}
    $url='https://www1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx'
    if($Config.environment -eq '2'){$url='https://hom1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx'}
    $certificate=Get-CompanyCertificate $Config
    $soap=@"
<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><cteDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe"><cteDadosMsg><distDFeInt xmlns="http://www.portalfiscal.inf.br/cte" versao="1.00"><tpAmb>$($Config.environment)</tpAmb><cUFAutor>$($Config.ufCode)</cUFAutor><CNPJ>$($Config.companyCnpj)</CNPJ><distNSU><ultNSU>$LastNsu</ultNSU></distNSU></distDFeInt></cteDadosMsg></cteDistDFeInteresse></soap12:Body></soap12:Envelope>
"@
    $action='http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe/cteDistDFeInteresse'
    $parameters=@{Uri=$url;Method='Post';Certificate=$certificate;ContentType=('application/soap+xml; charset=utf-8; action="'+$action+'"');Body=([Text.Encoding]::UTF8.GetBytes($soap));TimeoutSec=90;UseBasicParsing=$true;MaximumRedirection=0}
    if($PSVersionTable.PSVersion.Major -ge 6){$parameters.SslProtocol='Tls12';$parameters.MaximumRetryCount=0}
    $previousProtocol=[Net.ServicePointManager]::SecurityProtocol
    try{
        [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
        # One POST only. Caller persists raw SOAP, documents, cursor and cooldown;
        # this transport neither retries nor manifests, emits or cancels anything.
        $response=Invoke-WebRequest @parameters
        return [string]$response.Content
    }finally{[Net.ServicePointManager]::SecurityProtocol=$previousProtocol}
}
Export-ModuleMember -Function ConvertFrom-CteXml,ConvertFrom-CteDistributionResponse,Invoke-CteDistribution
