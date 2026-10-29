param([string]$ModulePath=(Join-Path $PSScriptRoot '../src/Cte.psm1'))
$ErrorActionPreference='Stop'
$script:passed=0
function Equal($Actual,$Expected,[string]$Name){
    if($Actual -cne $Expected){throw "$Name : esperado [$Expected], recebido [$Actual]"}
    $script:passed++
}
function Throws([scriptblock]$Action,[string]$Pattern,[string]$Name){
    $caught=$false
    try{& $Action | Out-Null}catch{if($_.Exception.Message -notmatch $Pattern){throw};$caught=$true}
    Equal $caught $true $Name
}
if(-not (Test-Path -LiteralPath $ModulePath)){throw 'CTE_CONNECTOR_MISSING: conector CT-e ainda nao implementado.'}
Import-Module $ModulePath -Force -DisableNameChecking
$company='38626750000146'
$key='31261012345678000123570010000001231000001234'
$full=@"
<?xml version="1.0" encoding="UTF-8"?>
<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><CTe><infCte Id="CTe$key" versao="4.00"><ide><mod>57</mod><nCT>123</nCT><serie>1</serie><dhEmi>2026-10-01T00:15:00-03:00</dhEmi><natOp>PRESTACAO DE TRANSPORTE</natOp><toma3><toma>0</toma></toma3></ide><compl><xObs>Pedido ficticio &amp; Companhia</xObs><ObsCont xCampo="OBRA"><xTexto>Local A</xTexto></ObsCont><ObsFisco xCampo="REGIME"><xTexto>Texto fiscal</xTexto></ObsFisco></compl><emit><CNPJ>12345678000123</CNPJ><xNome>Transportadora Ficticia</xNome><enderEmit><UF>MG</UF></enderEmit></emit><rem><CNPJ>$company</CNPJ><xNome>Empresa Tomadora</xNome></rem><exped><CNPJ>22222222000122</CNPJ><xNome>Expedidor Ficticio</xNome></exped><receb><CNPJ>33333333000133</CNPJ><xNome>Recebedor Ficticio</xNome></receb><dest><CNPJ>44444444000144</CNPJ><xNome>Destinatario Ficticio</xNome></dest><vPrest><vTPrest>1000.00</vTPrest><vRec>980.00</vRec><Comp><xNome>FRETE PESO</xNome><vComp>1000.00</vComp></Comp></vPrest><imp><ICMS><ICMS00><CST>00</CST><vBC>1000.00</vBC><pICMS>12.00</pICMS><vICMS>120.00</vICMS></ICMS00></ICMS><infAdFisco>Observacao tributaria</infAdFisco></imp></infCte></CTe><protCTe><infProt><chCTe>$key</chCTe><cStat>100</cStat><nProt>131260000000123</nProt></infProt></protCTe></cteProc>
"@
$doc=ConvertFrom-CteXml $full '1' $company
Equal $doc.kind 'cteProc' 'raiz CT-e processado preservada'
Equal $doc.key $key 'chave verdadeira CT-e'
Equal $doc.nsu '000000000000001' 'NSU normalizado para15digitos'
Equal ($doc.id -match '^000000000000001-[a-f0-9]{16}$') $true 'identidade NSU e SHA'
Equal $doc.fields.TIPO_FISCAL 'CT-e' 'tipo fiscal'
Equal $doc.fields.MODELO '57' 'modelo57'
Equal $doc.fields.Title 'Transportadora Ficticia' 'fornecedor e emitente'
Equal $doc.fields.CNPJ_FORNECEDOR '12345678000123' 'CNPJ emitente'
Equal $doc.fields.TOMADOR 'Empresa Tomadora' 'toma3 resolve remetente'
Equal $doc.fields.CNPJ_TOMADOR $company 'CNPJ tomador real'
Equal $doc.fields.DESTINATARIO 'Destinatario Ficticio' 'destinatario nao e confundido com tomador'
Equal $doc.fields.CNPJ_DESTINATARIO '44444444000144' 'CNPJ destinatario real'
Equal $doc.fields.PAPEL_EMPRESA 'TOMADOR;REMETENTE' 'papeis reais da empresa'
Equal $doc.fields.DIRECAO 'ENTRADA' 'somente tomador e entrada'
Equal $doc.fields.VALOR_TOTAL_NOTA ([decimal]1000) 'total da prestacao'
Equal $doc.fields.VALOR_LIQUIDO ([decimal]980) 'valor a receber sem deducao dupla'
Equal $doc.fields.ORIGEM_LIQUIDO 'vPrest/vRec' 'origem liquido'
Equal $doc.fields.Contains('DESCONTOS') $false 'diferenca total-liquido nao inventa desconto'
Equal $doc.fields.ICMS ([decimal]120) 'ICMS informado'
Equal $doc.fields.OBSERVACOES_NOTA "Pedido ficticio & Companhia`nOBRA: Local A" 'observacoes comerciais'
Equal $doc.fields.INFORMACOES_FISCO "Observacao tributaria`nREGIME: Texto fiscal" 'observacoes fiscais'
Equal $doc.fields.DATA_EMISSAO_ORIGINAL '2026-10-01T00:15:00-03:00' 'emissao e fuso originais'
Equal $doc.fields.SITUACAO 'AUTORIZADA' 'protocolo autorizado'
Equal $doc.fields.STATUS_IMPORTACAO 'XML_COMPLETO' 'XML completo'
Equal ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($doc.xmlBase64))) $full 'XML sem reserializacao'
$sha=[Security.Cryptography.SHA256]::Create()
try{$expectedSha=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($full)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
Equal $doc.sha256 $expectedSha 'hash bytes XML'
Equal $doc.fileName ($key+'-'+$doc.id+'.xml') 'nome arquivo equivalente NFe'
Equal (ConvertFrom-CteXml $full '2' '44444444000144').fields.DIRECAO 'TERCEIROS' 'destinatario nao tomador e terceiros'
Equal (ConvertFrom-CteXml $full '2' '44444444000144').fields.PAPEL_EMPRESA 'DESTINATARIO' 'papel destinatario'
Equal (ConvertFrom-CteXml $full '2' '12345678000123').fields.DIRECAO 'SAIDA' 'emitente e saida'
Equal (ConvertFrom-CteXml $full '2' '22222222000122').fields.PAPEL_EMPRESA 'EXPEDIDOR' 'papel expedidor'
Equal (ConvertFrom-CteXml $full '2' '33333333000133').fields.PAPEL_EMPRESA 'RECEBEDOR' 'papel recebedor'
Equal (ConvertFrom-CteXml $full '2' '99999999000199').fields.PAPEL_EMPRESA 'NAO_IDENTIFICADO_NO_XML' 'empresa nao identificada nao e tomadora'
foreach($pair in @(@('1','22222222000122','Expedidor Ficticio'),@('2','33333333000133','Recebedor Ficticio'),@('3','44444444000144','Destinatario Ficticio'))){
    $xml=$full.Replace('<toma>0</toma>','<toma>'+$pair[0]+'</toma>')
    $d=ConvertFrom-CteXml $xml '3' $pair[1]
    Equal $d.fields.TOMADOR $pair[2] ('resolve toma3='+$pair[0])
    Equal $d.fields.DIRECAO 'ENTRADA' ('direcao toma3='+$pair[0])
}
$other=$full.Replace('<toma3><toma>0</toma></toma3>',('<toma4><toma>4</toma><CNPJ>'+$company+'</CNPJ><xNome>Outro Tomador</xNome></toma4>'))
Equal (ConvertFrom-CteXml $other '4' $company).fields.TOMADOR 'Outro Tomador' 'toma4 resolve cadastral explicito'
$discounted=$full.Replace('</infCte>','<infCTeNorm><cobr><fat><vOrig>1000.00</vOrig><vDesc>20.00</vDesc><vLiq>980.00</vLiq></fat></cobr></infCTeNorm></infCte>')
Equal (ConvertFrom-CteXml $discounted '5' $company).fields.DESCONTOS ([decimal]20) 'desconto explicito fatura'
$authorized=$full.Replace('</infCte>',('<autXML><CNPJ>55555555000155</CNPJ></autXML></infCte>'))
Equal (ConvertFrom-CteXml $authorized '5' '55555555000155').fields.PAPEL_EMPRESA 'AUTORIZADO_XML' 'autorizado e papel proprio'
$keyOs=$key.Substring(0,20)+'67'+$key.Substring(22)
$os=$full.Replace($key,$keyOs).Replace('cteProc','cteOSProc').Replace('<CTe>','<CTeOS>').Replace('</CTe>','</CTeOS>').Replace('<mod>57</mod>','<mod>67</mod>').Replace('<toma3><toma>0</toma></toma3>','').Replace('</emit>',('</emit><toma><CNPJ>'+$company+'</CNPJ><xNome>Tomador OS</xNome></toma>'))
$osDoc=ConvertFrom-CteXml $os '6' $company
Equal $osDoc.kind 'cteOSProc' 'raiz oficial CTeOS'
Equal $osDoc.fields.MODELO '67' 'modelo67'
Equal $osDoc.fields.TOMADOR 'Tomador OS' 'CTeOS infCte toma'
Equal $osDoc.fields.DIRECAO 'ENTRADA' 'CTeOS tomador e entrada'
$osNoToma=$os -replace '<toma><CNPJ>.*?</toma>',''
Equal (ConvertFrom-CteXml $osNoToma '6' $company).fields.DIRECAO 'TERCEIROS' 'CTeOS excesso de bagagem pode omitir toma'
$nfeKeyA=$key.Replace('57001','55001')
$nfeKeyB=$nfeKeyA.Substring(0,43)+'5'
$simp=@"
<cteSimpProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><CTeSimp><infCte Id="CTe$key" versao="4.00"><ide><mod>57</mod><nCT>123</nCT><serie>1</serie><dhEmi>2026-10-01T00:15:00-03:00</dhEmi><natOp>PRESTACAO SIMPLIFICADA</natOp><UFIni>MG</UFIni><UFFim>SP</UFFim></ide><compl><xObs>Pedido simplificado ficticio</xObs></compl><emit><CNPJ>12345678000123</CNPJ><xNome>Transportadora Simplificada Ficticia</xNome></emit><toma><toma>3</toma><indIEToma>1</indIEToma><CNPJ>$company</CNPJ><xNome>Tomador Destinatario Ficticio</xNome></toma><det nItem="1"><cMunIni>3106705</cMunIni><xMunIni>Betim</xMunIni><cMunFim>3550308</cMunFim><xMunFim>Sao Paulo</xMunFim><vPrest>600.00</vPrest><vPrestLiq>550.00</vPrestLiq><vRec>590.00</vRec><infNFe><chNFe>$nfeKeyA</chNFe></infNFe></det><det nItem="2"><cMunIni>3106705</cMunIni><xMunIni>Betim</xMunIni><cMunFim>3509502</cMunFim><xMunFim>Campinas</xMunFim><vPrest>400.00</vPrest><vRec>385.00</vRec><infNFe><chNFe>$nfeKeyB</chNFe></infNFe></det><cobr><fat><vDesc>25.00</vDesc></fat></cobr><imp><ICMS><ICMS00><vICMS>120.00</vICMS></ICMS00></ICMS></imp><total><vTPrest>1000.00</vTPrest><vTPrestLiq>900.00</vTPrestLiq><vTRec>975.00</vTRec><vTotDFe>1000.00</vTotDFe></total></infCte></CTeSimp><protCTe><infProt><chCTe>$key</chCTe><cStat>100</cStat><nProt>131260000000123</nProt></infProt></protCTe></cteSimpProc>
"@
$simpDoc=ConvertFrom-CteXml $simp '9' $company
Equal $simpDoc.kind 'cteSimpProc' 'CT-e simplificado preserva raiz oficial'
Equal $simpDoc.fields.Title 'Transportadora Simplificada Ficticia' 'simplificado preserva emitente'
Equal $simpDoc.fields.TOMADOR 'Tomador Destinatario Ficticio' 'simplificado usa toma cadastral'
Equal $simpDoc.fields.PAPEL_EMPRESA 'TOMADOR;DESTINATARIO' 'simplificado toma3 declara papel destinatario'
Equal $simpDoc.fields.DIRECAO 'ENTRADA' 'simplificado tomador e entrada'
Equal $simpDoc.fields.VALOR_TOTAL_NOTA ([decimal]1000) 'simplificado total vem de total vTPrest'
Equal $simpDoc.fields.VALOR_LIQUIDO ([decimal]975) 'simplificado liquido e vTRec sem deducao dupla'
Equal $simpDoc.fields.ORIGEM_LIQUIDO 'total/vTRec' 'vTPrestLiq sem tributos nao e valor a receber'
Equal $simpDoc.fields.DESCONTOS ([decimal]25) 'simplificado desconto explicito'
Equal $simpDoc.fields.ICMS ([decimal]120) 'simplificado ICMS explicitado'
Equal $simpDoc.fields.DESTINATARIO 'Tomador Destinatario Ficticio' 'destinatario declarado pelo papel do tomador'
Equal $simpDoc.deliveries.Count 2 'duas entregas independentes preservadas'
Equal $simpDoc.deliveries[0].number '1' 'numero literal da entrega'
Equal $simpDoc.deliveries[0].destinationName 'Sao Paulo' 'primeiro destino literal'
Equal $simpDoc.deliveries[1].destinationName 'Campinas' 'segundo destino literal'
Equal $simpDoc.deliveries[0].nfeKeys[0] $nfeKeyA 'NF-e referenciada nao e convertida em destinatario'
Equal $simpDoc.deliveries[1].nfeKeys[0] $nfeKeyB 'segunda referencia preservada'
Equal $simpDoc.deliveries[0].total ([decimal]600) 'valor por entrega literal'
Equal $simpDoc.deliveries[1].receivable ([decimal]385) 'valor a receber por entrega literal'
Equal ($simpDoc.fields.OBSERVACOES_NOTA.Contains('Sao Paulo') -and $simpDoc.fields.OBSERVACOES_NOTA.Contains('Campinas')) $true 'galeria lista todos os destinos sem eleger um'
$simpOther=ConvertFrom-CteXml ($simp.Replace('<toma>3</toma>','<toma>4</toma>')) '9' $company
Equal $simpOther.fields.Contains('DESTINATARIO') $false 'simplificado outros nao inventa destinatarios pelas NF-e'
Equal $simpOther.fields.Contains('CNPJ_DESTINATARIO') $false 'chave NF-e nao revela CNPJ destinatario'
Throws {ConvertFrom-CteXml ($simp.Replace('<vTRec>975.00</vTRec>','')) '9' $company} 'vTRec' 'simplificado nao infere liquido ausente pelos detalhes'
Throws {ConvertFrom-CteXml ($simp -replace '<det nItem="1">.*?</det>','' -replace '<det nItem="2">.*?</det>','') '9' $company} 'entrega' 'simplificado sem entregas e incompleto'
$event=@"
<procEventoCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><eventoCTe><infEvento><chCTe>$key</chCTe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><dhEvento>2026-10-02T13:00:00-03:00</dhEvento><detEvento><evCancCTe><descEvento>Cancelamento</descEvento></evCancCTe></detEvento></infEvento></eventoCTe><retEventoCTe><infEvento><cStat>135</cStat><chCTe>$key</chCTe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><nProt>131260000000999</nProt></infEvento></retEventoCTe></procEventoCTe>
"@
$evt=ConvertFrom-CteXml $event '7' $company
Equal $evt.kind 'procEventoCTe' 'evento preservado'
Equal $evt.key $key 'evento vincula chave real'
Equal $evt.fields.STATUS_IMPORTACAO 'EVENTO_SEM_XML' 'evento nao cria documento completo'
Equal $evt.fields.SITUACAO 'CANCELADA' 'cancelamento registrado'
Equal $evt.fields.Contains('Title') $false 'evento nao inventa fornecedor'
Equal $evt.fields.Contains('VALOR_TOTAL_NOTA') $false 'evento nao inventa valor'
Equal (ConvertFrom-CteXml ($event.Replace('<cStat>135</cStat>','<cStat>573</cStat>')) '8' $company).fields.Contains('SITUACAO') $false 'evento rejeitado nao cancela'
Equal (ConvertFrom-CteXml ($event.Replace('<tpEvento>110111</tpEvento>','<tpEvento>610110</tpEvento>')) '8' $company).fields.Contains('SITUACAO') $false 'desacordo nao significa cancelamento CT-e'
Throws {ConvertFrom-CteXml ($event.Replace('<tpEvento>110111</tpEvento>','')) '8' $company} 'tipo' 'evento sem tipo nao recebe identidade fiscal inventada'
Throws {ConvertFrom-CteXml ($event.Replace('<nSeqEvento>1</nSeqEvento>','')) '8' $company} 'sequencia' 'evento sem sequencia bloqueado'
Throws {ConvertFrom-CteXml ($event.Replace('<retEventoCTe>','<retEventoCTe>').Replace('<nProt>131260000000999</nProt>','')) '8' $company} 'protocolo' 'evento processado exige protocolo para sucesso'
Throws {ConvertFrom-CteXml ($full.Replace('<cStat>100</cStat>','<cStat>110</cStat>')) '8' $company} 'autorizacao' 'CT-e denegado nao vira autorizada'
Throws {ConvertFrom-CteXml ($full.Replace('<chCTe>'+$key+'</chCTe>','<chCTe>'+('9'*44)+'</chCTe>')) '8' $company} 'chave' 'chave protocolo deve coincidir'
Throws {ConvertFrom-CteXml ($full.Replace('<mod>57</mod>','<mod>55</mod>')) '8' $company} 'modelo' 'modelo incoerente bloqueado'
Throws {ConvertFrom-CteXml ($full.Replace('<vRec>980.00</vRec>','')) '8' $company} 'vRec' 'liquido ausente nao inferido'
Throws {ConvertFrom-CteXml '<resCTe/>' '8' $company} 'suportado' 'schema desconhecido exige preservacao e revisao'
Throws {ConvertFrom-CteXml '<!DOCTYPE cteProc [<!ENTITY x SYSTEM "file:///c:/windows/win.ini">]><cteProc>&x;</cteProc>' '8' $company} 'XML|DTD' 'XXE proibido'
Throws {ConvertFrom-CteXml $full '-1' $company} 'NSU' 'NSU documento invalido'
$alphaKey=$key.Replace('12345678000123','12ABC678000123')
Equal (ConvertFrom-CteXml ($full.Replace($key,$alphaKey)) '8' $company).key $alphaKey 'chave alfanumerica NT2026.004'
function Zip([byte[]]$Bytes){
    $stream=[IO.MemoryStream]::new();$gzip=[IO.Compression.GZipStream]::new($stream,[IO.Compression.CompressionMode]::Compress,$true)
    try{$gzip.Write($Bytes,0,$Bytes.Length)}finally{$gzip.Dispose()}
    try{return [Convert]::ToBase64String($stream.ToArray())}finally{$stream.Dispose()}
}
function Response([string]$Docs,[string]$Status='138',[string]$Last='2',[string]$Max='2'){
    return '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><cteDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe"><cteDistDFeInteresseResult><retDistDFeInt xmlns="http://www.portalfiscal.inf.br/cte" versao="1.00"><cStat>'+$Status+'</cStat><xMotivo>Resposta ficticia</xMotivo><ultNSU>'+$Last+'</ultNSU><maxNSU>'+$Max+'</maxNSU><loteDistDFeInt>'+$Docs+'</loteDistDFeInt></retDistDFeInt></cteDistDFeInteresseResult></cteDistDFeInteresseResponse></soap:Body></soap:Envelope>'
}
$bomBytes=[byte[]](@(239,187,191)+[Text.Encoding]::UTF8.GetBytes($full))
$zipped=Zip $bomBytes
$docXml='<docZip NSU="1" schema="procCTe_v4.00.xsd">'+$zipped+'</docZip>'
$eventXml='<docZip NSU="2" schema="procEventoCTe_v4.00.xsd">'+(Zip ([Text.Encoding]::UTF8.GetBytes($event)))+'</docZip>'
$batch=ConvertFrom-CteDistributionResponse (Response ($docXml+$eventXml)) $company
Equal $batch.status '138' 'status lote'
Equal $batch.lastNsu '000000000000002' 'ultimo NSU normalizado'
Equal $batch.maxNsu '000000000000002' 'maximo NSU normalizado'
Equal $batch.documents.Count 2 'dois docs normalizados'
Equal $batch.documents[0].xmlBase64 ([Convert]::ToBase64String($bomBytes)) 'bytes exatos docZip incluindo BOM'
Equal $batch.documents[0].schema 'procCTe_v4.00.xsd' 'schema distribuido preservado'
Equal $batch.documents[1].fields.SITUACAO 'CANCELADA' 'evento no lote'
Equal $batch.unhandledDocuments.Count 0 'lote CT-e nao possui foraescopo'
$simpZip='<docZip NSU="3" schema="procCTeSimp_v4.00.xsd">'+(Zip ([Text.Encoding]::UTF8.GetBytes($simp)))+'</docZip>'
$simpBatch=ConvertFrom-CteDistributionResponse (Response ($docXml+$eventXml+$simpZip) '138' '3' '3') $company
Equal $simpBatch.documents[2].kind 'cteSimpProc' 'simplificado normalizado junto com CT-e e evento'
$gtvKey=$key.Substring(0,20)+'64'+$key.Substring(22)
$gtv='<GTVeProc xmlns="http://www.portalfiscal.inf.br/cte"><GTVe><infCte Id="GTVe'+$gtvKey+'"/></GTVe><protCTe><infProt><chCTe>'+$gtvKey+'</chCTe></infProt></protCTe></GTVeProc>'
$gtvBytes=[Text.Encoding]::UTF8.GetBytes($gtv)
$gtvZip='<docZip NSU="2" schema="procGTVe_v4.00.xsd">'+(Zip $gtvBytes)+'</docZip>'
$mixed=ConvertFrom-CteDistributionResponse (Response ($docXml+$gtvZip)) $company
Equal $mixed.documents.Count 1 'GTV-e nao entra como CT-e'
Equal $mixed.unhandledDocuments.Count 1 'GTV-e possui pacote duravel separado'
Equal $mixed.unhandledDocuments[0].nsu '000000000000002' 'NSU foraescopo preservado'
Equal $mixed.unhandledDocuments[0].key $gtvKey 'GTV-e conserva sua propria chave explicita'
Equal $mixed.unhandledDocuments[0].schema 'procGTVe_v4.00.xsd' 'schema foraescopo preservado'
Equal $mixed.unhandledDocuments[0].reason 'OUT_OF_SCOPE' 'GTV-e explicitamente foraescopo'
Equal $mixed.unhandledDocuments[0].xmlBase64 ([Convert]::ToBase64String($gtvBytes)) 'GTV-e bytes integrais'
Equal ($mixed.unhandledDocuments[0].id -match '^000000000000002-[a-f0-9]{16}$') $true 'pacote foraescopo identifica NSU SHA'
Equal $mixed.lastNsu '000000000000002' 'ultNSU inclui NSUs foraescopo que worker deve persistir'
$mdfe='<procEventoMDFe xmlns="http://www.portalfiscal.inf.br/mdfe"><eventoMDFe><infEvento><chMDFe>'+($key.Substring(0,20)+'58'+$key.Substring(22))+'</chMDFe><tpEvento>110112</tpEvento></infEvento></eventoMDFe></procEventoMDFe>'
$mdfeZip='<docZip NSU="2" schema="procEventoMDFe_v3.00.xsd">'+(Zip ([Text.Encoding]::UTF8.GetBytes($mdfe)))+'</docZip>'
$mdfeBatch=ConvertFrom-CteDistributionResponse (Response $mdfeZip) $company
Equal $mdfeBatch.documents.Count 0 'evento MDF-e nao e CT-e'
Equal $mdfeBatch.unhandledDocuments[0].reason 'OUT_OF_SCOPE' 'evento MDF-e explicitamente foraescopo'
$future='<cteFuturoProc xmlns="http://www.portalfiscal.inf.br/cte"><CTeFuturo><infCte Id="CTe'+$key+'"/></CTeFuturo><protCTe><infProt><chCTe>'+$key+'</chCTe></infProt></protCTe></cteFuturoProc>'
$futureZip='<docZip NSU="2" schema="procCTeFuturo_v5.00.xsd">'+(Zip ([Text.Encoding]::UTF8.GetBytes($future)))+'</docZip>'
$futureBatch=ConvertFrom-CteDistributionResponse (Response $futureZip) $company
Equal $futureBatch.documents.Count 0 'CT-e desconhecido nao finge interpretacao'
Equal $futureBatch.unhandledDocuments[0].reason 'UNSUPPORTED_CTE_SCHEMA' 'CT-e sem parser sinaliza pendencia explicita'
Equal $futureBatch.unhandledDocuments[0].pendingInterpretation $true 'CT-e futuro pendente de interpretacao'
Equal $futureBatch.unhandledDocuments[0].key $key 'CT-e futuro conserva chave explicita'
$empty=ConvertFrom-CteDistributionResponse (Response '' '137' '0' '0') $company
Equal $empty.documents.Count 0 '137 retorna array vazio'
Equal $empty.unhandledDocuments.Count 0 '137 array foraescopo vazio'
$busy=ConvertFrom-CteDistributionResponse '<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/cte"><cStat>656</cStat><xMotivo>Consumo indevido</xMotivo></retDistDFeInt>' $company
Equal $busy.status '656' '656 repassado para cooldown pelo worker'
Equal $busy.lastNsu $null '656 sem cursor nao inventa zero'
$hint=ConvertFrom-CteDistributionResponse (Response '' '656' '1387' '0') $company
Equal $hint.lastNsu '000000000001387' '656 preserva hint sem considera-lo cursor confirmado'
Throws {ConvertFrom-CteDistributionResponse (Response '') $company} '138' '138 sem docs bloqueado'
Throws {ConvertFrom-CteDistributionResponse (Response ($eventXml+$docXml)) $company} 'sequencia' 'NSU descendente bloqueado'
Throws {ConvertFrom-CteDistributionResponse (Response ($docXml+$eventXml.Replace('NSU="2"','NSU="3"')) '138' '3' '3') $company} 'lacuna' 'lacuna interna bloqueada'
Throws {ConvertFrom-CteDistributionResponse (Response $docXml '138' '2' '2') $company} 'ultimo|ultNSU' 'cursor posterior ao ultimo doc bloqueado'
Throws {ConvertFrom-CteDistributionResponse (Response $docXml '137' '1' '1') $company} 'documentos' '137 nao carrega documentos'
Throws {ConvertFrom-CteDistributionResponse (Response $docXml '138' '1' '0') $company} 'NSU' 'ultimo maior que maximo bloqueado'
Throws {ConvertFrom-CteDistributionResponse (Response ($docXml.Replace('procCTe_v4.00.xsd','procEventoCTe_v4.00.xsd')) '138' '1' '1') $company} 'schema' 'schema e raiz devem concordar'
Throws {ConvertFrom-CteDistributionResponse (Response '<docZip NSU="1" schema="procCTe_v4.00.xsd">!!!</docZip>' '138' '1' '1') $company} 'docZip' 'base64 invalido bloqueado'
Throws {ConvertFrom-CteDistributionResponse '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><soap:Fault><soap:Reason>Erro</soap:Reason></soap:Fault></soap:Body></soap:Envelope>' $company} 'SOAP' 'SOAP Fault nao tratado como lote vazio'
Throws {Invoke-CteDistribution @{companyCnpj=$company;ufCode='31';environment='1'} '1'} 'NSU' 'transporte exige cursor15digitos'
Throws {Invoke-CteDistribution @{companyCnpj='bad';ufCode='31';environment='1'} '000000000000000'} 'CNPJ' 'config invalida falha antes do certificado'
# Boundary stub: capture the actual generated SOAP and prevent every network operation.
$module=Get-Module Cte
& $module {
    function script:Get-CompanyCertificate($Config){return 'CERTIFICATE_REFERENCE_ONLY'}
    function script:Invoke-WebRequest {
        param($Uri,$Method,$Certificate,$ContentType,$Body,$TimeoutSec,$MaximumRedirection,$SslProtocol,$MaximumRetryCount,[switch]$UseBasicParsing)
        $script:cteRequest=[pscustomobject]@{Uri=$Uri;Method=$Method;Certificate=$Certificate;ContentType=$ContentType;Body=$Body;Timeout=$TimeoutSec;Redirects=$MaximumRedirection;Retries=$MaximumRetryCount;SslProtocol=$SslProtocol}
        return [pscustomobject]@{Content='<synthetic-soap-response/>'}
    }
}
Equal (Invoke-CteDistribution @{companyCnpj=$company;ufCode='31';environment='1'} '000000000000009') '<synthetic-soap-response/>' 'transporte retorna SOAP bruto'
$request=& $module {$script:cteRequest}
Equal $request.Uri 'https://www1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx' 'endpoint oficial producao'
Equal $request.Method 'Post' 'SOAP POST unico'
Equal $request.Certificate 'CERTIFICATE_REFERENCE_ONLY' 'referencia A1 reaproveitada sem exportar'
Equal $request.Redirects 0 'sem redirecionamento certificado'
Equal ($request.ContentType -match 'application/soap\+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe/cteDistDFeInteresse"') $true 'SOAP12 action WSDL'
$sent=[xml][Text.Encoding]::UTF8.GetString($request.Body)
$payload=$sent.SelectSingleNode('//*[local-name()="cteDistDFeInteresse"]/*[local-name()="cteDadosMsg"]/*[local-name()="distDFeInt"]')
Equal $payload.NamespaceURI 'http://www.portalfiscal.inf.br/cte' 'namespace CT-e dados'
Equal $payload.GetAttribute('versao') '1.00' 'versao distribuicao1.00'
Equal $payload.SelectSingleNode('*[local-name()="distNSU"]/*[local-name()="ultNSU"]').InnerText '000000000000009' 'consulta somente distNSU'
Equal $payload.SelectSingleNode('*[local-name()="cUFAutor"]').InnerText '31' 'UF autor'
$null=Invoke-CteDistribution @{companyCnpj=$company;ufCode='31';environment='2'} '000000000000009'
Equal (& $module {$script:cteRequest.Uri}) 'https://hom1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx' 'endpoint homologacao confirmado WSDL'
Remove-Module Cte
Write-Output ('PASS CT-e assertions: '+$script:passed+'; consultas fiscais reais: 0')
