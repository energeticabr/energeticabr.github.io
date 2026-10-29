param([string]$ModulePath=(Join-Path $PSScriptRoot '../src/Nfse.psm1'))
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $ModulePath){Import-Module $ModulePath -Force -DisableNameChecking}
$script:passed=0
function Equal($Actual,$Expected,$Name){if($Actual -cne $Expected){throw "$Name : expected [$Expected], actual [$Actual]"};$script:passed++}
function Throws([scriptblock]$Action,[string]$Pattern,[string]$Name){$caught=$false;try{& $Action|Out-Null}catch{if($_.Exception.Message -notmatch $Pattern){throw};$caught=$true};Equal $caught $true $Name}
$company='38626750000146'
# National key is 50 digits. All XMLs below are synthetic parser fixtures, not fiscal documents.
$key='35503081212345678000123000000000123261000000000111'
Equal $key.Length 50 'fixture national key length'
$fixture=@'
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS__KEY__"><nNFSe>123</nNFSe><cStat>100</cStat><dhProc>2026-10-20T12:01:00-03:00</dhProc><emit><CNPJ>12345678000123</CNPJ><xNome>Prestador fiscal</xNome></emit><valores><vBC>9999.00</vBC><vISSQN>50.00</vISSQN><vLiq>763.50</vLiq></valores><xOutInf>Informacao do fisco</xOutInf><DPS><infDPS><tpAmb>1</tpAmb><dhEmi>2026-10-20T12:00:00-03:00</dhEmi><serie>1</serie><nDPS>432</nDPS><prest><CNPJ>12345678000123</CNPJ><xNome>Prestador &amp; Companhia</xNome></prest><toma><CNPJ>38626750000146</CNPJ><xNome>Tomador ficticio</xNome></toma><interm><CNPJ>99999999000199</CNPJ></interm><serv><cServ><xDescServ>Servico &lt;b&gt;literal&lt;/b&gt;</xDescServ></cServ><infoCompl><xInfComp>Contrato ficticio</xInfComp></infoCompl></serv><valores><vServPrest><vServ>1000.00</vServ></vServPrest><vDescCondIncond><vDescCond>10.00</vDescCond><vDescIncond>20.00</vDescIncond></vDescCondIncond><trib><tribMun><tpRetISSQN>2</tpRetISSQN></tribMun><tribFed>__FED__</tribFed></trib></valores></infDPS></DPS></infNFSe></NFSe>
'@
$fixture=$fixture.Replace('__KEY__',$key)
$federal='<piscofins><CST>01</CST><vBCPisCofins>9999.00</vBCPisCofins><vPis>6.50</vPis><vCofins>30.00</vCofins><tpRetPisCofins>3</tpRetPisCofins></piscofins><vRetCP>110.00</vRetCP><vRetIRRF>15.00</vRetIRRF><vRetCSLL>10.00</vRetCSLL>'
function Parse([string]$Xml=$fixture.Replace('__FED__',$federal),[string]$Company=$company){ConvertFrom-NfseXml $Xml '7' $Company}
$doc=Parse
Equal $doc.kind 'NFSe' 'full national service invoice recognized'
Equal $doc.key $key '50 digit key is preserved'
Equal $doc.nsu '000000000000007' 'NSU padded without arithmetic'
Equal $doc.id.Substring(0,16) '000000000000007-' 'stable shared id convention'
Equal ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($doc.xmlBase64))) ($fixture.Replace('__FED__',$federal)) 'original XML preserved byte for byte as UTF8'
Equal $doc.fields.Title 'Prestador & Companhia' 'supplier comes from prest not issuer'
Equal $doc.fields.CNPJ_FORNECEDOR '12345678000123' 'service provider identity'
Equal $doc.fields.DESTINATARIO 'Tomador ficticio' 'recipient is service taker'
Equal $doc.fields.CNPJ_DESTINATARIO $company 'recipient identity'
Equal $doc.fields.DIRECAO 'ENTRADA' 'company is service taker'
Equal $doc.fields.PAPEL_EMPRESA 'TOMADOR' 'taker role explicit'
Equal (Parse -Company '12345678000123').fields.DIRECAO 'SAIDA' 'provider is outgoing'
Equal (Parse -Company '12345678000123').fields.PAPEL_EMPRESA 'PRESTADOR' 'provider role explicit'
Equal (Parse -Company '99999999000199').fields.DIRECAO 'TERCEIROS' 'intermediary is not incoming'
Equal (Parse -Company '99999999000199').fields.PAPEL_EMPRESA 'INTERMEDIARIO' 'intermediary role explicit'
Equal (Parse -Company '11111111000111').fields.PAPEL_EMPRESA 'TERCEIROS' 'non participant not classified as buyer'
Equal $doc.fields.TIPO_FISCAL 'NFS-e' 'service invoice discriminator'
Equal $doc.fields.MODELO 'NFS-e' 'not model 55'
Equal $doc.fields.VALOR_TOTAL_NOTA ([decimal]1000) 'gross service amount never tax base'
Equal $doc.fields.VALOR_LIQUIDO ([decimal]763.50) 'literal net value never subtracts retention twice'
Equal $doc.fields.DESCONTOS ([decimal]30) 'explicit conditioned plus unconditioned discounts'
Equal $doc.fields.NUMERO_NOTA '123' 'national number not DPS number'
Equal $doc.fields.Contains('SERIE') $false 'DPS series is not NFS-e series'
Equal $doc.fields.DATA_EMISSAO_ORIGINAL '2026-10-20T12:01:00-03:00' 'national generation time and timezone'
Equal $doc.fields.OBSERVACOES_NOTA "Servico <b>literal</b>`nContrato ficticio" 'description and complementary text preserve literal text'
Equal $doc.fields.INFORMACOES_FISCO 'Informacao do fisco' 'municipal fiscal text separate'
foreach($p in @(@('PIS_RETIDO',6.50),@('COFINS_RETIDA',30),@('CSLL_RETIDA',10),@('IRRF_RETIDO',15),@('INSS_RETIDO',110),@('ISS_RETIDO',50))){Equal $doc.fields[$p[0]] ([decimal]$p[1]) ('explicit withheld '+$p[0])}
Equal $doc.fields.STATUS_RETENCOES 'RETENCAO_INFORMADA_XML' 'positive explicit withholdings'
$none=$fixture.Replace('__FED__','').Replace('<tpRetISSQN>2</tpRetISSQN>','<tpRetISSQN>1</tpRetISSQN>')
Equal (Parse $none).fields.STATUS_RETENCOES 'NAO_INFORMADA_XML' 'tax base and ordinary ISS are not withholding'
Equal (Parse $none).fields.Contains('ISS_RETIDO') $false 'missing withheld amount not invented zero'
Equal (Parse ($none.Replace('<tpRetISSQN>1</tpRetISSQN>','<tpRetISSQN>3</tpRetISSQN>'))).fields.Contains('ISS_RETIDO') $false 'intermediary withholding excluded from buyer ISS'
foreach($row in @(@('0',$false,$false),@('1',$true,$true),@('2',$false,$false),@('3',$true,$true),@('4',$true,$true),@('5',$true,$false),@('6',$false,$true),@('7',$false,$true),@('8',$false,$false),@('9',$true,$false))){
    $fed='<piscofins><vPis>6.50</vPis><vCofins>30.00</vCofins><tpRetPisCofins>'+ $row[0]+'</tpRetPisCofins></piscofins>'
    $parsed=Parse ($none.Replace('<tribFed></tribFed>','<tribFed>'+$fed+'</tribFed>'))
    Equal $parsed.fields.Contains('PIS_RETIDO') $row[1] ('official PIS retention code '+$row[0])
    Equal $parsed.fields.Contains('COFINS_RETIDA') $row[2] ('official COFINS retention code '+$row[0])
}
$ordinary=Parse ($none.Replace('<tribFed></tribFed>','<tribFed><piscofins><vBCPisCofins>9999.00</vBCPisCofins><vPis>6.50</vPis><vCofins>30.00</vCofins></piscofins><vRetIRRF>0.00</vRetIRRF></tribFed>'))
Equal $ordinary.fields.Contains('PIS_RETIDO') $false 'tax value without retention type not inferred'
Equal $ordinary.fields.IRRF_RETIDO ([decimal]0) 'explicit zero retained'
Equal $ordinary.fields.STATUS_RETENCOES 'NAO_INFORMADA_XML' 'zero and bases alone not positive withholding'
$issuerTaker=$fixture.Replace('__FED__','').Replace('<emit><CNPJ>12345678000123</CNPJ><xNome>Prestador fiscal</xNome></emit>','<emit><CNPJ>38626750000146</CNPJ><xNome>Tomador emissor</xNome></emit>')
Equal (Parse $issuerTaker).fields.Title 'Prestador & Companhia' 'taker issuer never becomes supplier'
Throws {Parse ($none.Replace($key,'123'))} 'Chave' 'reject NF-e or malformed key'
Throws {Parse ($none.Replace('<cStat>100</cStat>','<cStat>999</cStat>'))} 'cStat' 'unrecognized invoice status not authorized'
Throws {Parse ($none.Replace('<vServ>1000.00</vServ>','<vServ>-1.00</vServ>'))} 'monetario' 'negative amount rejected'
Throws {Parse ('<!DOCTYPE NFSe [<!ENTITY e SYSTEM "file:///secret">]>'+$none)} 'DTD|DOCTYPE|prohibit' 'DTD cannot access local files'
$event='<evento xmlns="http://www.sped.fazenda.gov.br/nfse"><infEvento Id="EVT'+$key+'101101001"><dhProc>2026-10-21T09:00:00-03:00</dhProc><pedRegEvento><infPedReg><dhEvento>2026-10-21T08:59:00-03:00</dhEvento><chNFSe>'+$key+'</chNFSe><e101101><xDesc>Cancelamento de NFS-e</xDesc></e101101></infPedReg></pedRegEvento></infEvento></evento>'
$cancel=Parse $event
Equal $cancel.kind 'evento' 'registered national event recognized'
Equal $cancel.fields.SITUACAO 'CANCELADA' 'registered cancellation changes situation'
Equal $cancel.fields.STATUS_IMPORTACAO 'EVENTO_SEM_XML' 'event does not replace complete invoice'
Equal $cancel.fields.Contains('STATUS_RETENCOES') $false 'event cannot erase retention analysis'
Equal (Parse ($event.Replace('101101','101103'))).fields.Contains('SITUACAO') $false 'request for fiscal analysis is not cancellation'
Throws {Parse ($event.Replace('<chNFSe>'+$key+'</chNFSe>','<chNFSe>'+('9'*50)+'</chNFSe>'))} 'evento|Chave' 'event identifier and linked key must agree'
function Zip($Text){$s=[IO.MemoryStream]::new();$g=[IO.Compression.GZipStream]::new($s,[IO.Compression.CompressionMode]::Compress,$true);if($Text -is [byte[]]){$b=$Text}else{$b=[Text.Encoding]::UTF8.GetBytes([string]$Text)};$g.Write($b,0,$b.Length);$g.Dispose();$out=[Convert]::ToBase64String($s.ToArray());$s.Dispose();$out}
function Response($Items,[string]$Status='DOCUMENTOS_LOCALIZADOS'){@{StatusProcessamento=$Status;LoteDFe=@($Items);Erros=@();Alertas=@();TipoAmbiente='PRODUCAO';VersaoAplicativo='fixture';DataHoraProcessamento='2026-10-29T10:00:00-03:00'}|ConvertTo-Json -Depth 8 -Compress}
$item=@{NSU=7;ChaveAcesso=$key;TipoDocumento='NFSE';ArquivoXml=(Zip $none)}
$batch=ConvertFrom-NfseDistributionResponse (Response @($item)) $company
Equal $batch.status 'DOCUMENTOS_LOCALIZADOS' 'official PascalCase distribution parsed'
Equal $batch.lastNsu '000000000000007' 'cursor only from returned NSU'
Equal $batch.documents.Count 1 'gzip base64 doc decoded'
Equal $batch.hasMore $true 'nonempty batch permits next probe; no server max invented'
Equal $batch.retryAfterSeconds 0 'next batch can be requested'
$empty=ConvertFrom-NfseDistributionResponse (Response @() 'NENHUM_DOCUMENTO_LOCALIZADO') $company
Equal $empty.lastNsu $null 'empty response cannot manufacture cursor zero'
Equal $empty.hasMore $false 'empty terminates current sweep'
Equal $empty.retryAfterSeconds 3900 'conservative 65 minute cooldown after empty'
$reject=ConvertFrom-NfseDistributionResponse '{"StatusProcessamento":"REJEICAO","Erros":[{"Codigo":"E999","Descricao":"Ficticio"}]}' $company
Equal $reject.status 'REJEICAO' 'rejection preserved without throwing raw body away'
Equal $reject.lastNsu $null 'rejection cannot advance cursor'
Equal $reject.errors[0].Codigo 'E999' 'government rejection detail preserved'
Equal $reject.retryAfterSeconds 3900 'rejection not immediately retried'
Throws {ConvertFrom-NfseDistributionResponse (Response @() ) $company} 'sem documentos' 'nonempty status with empty batch fails closed'
$bad=@{}+$item;$bad.ChaveAcesso='9'*50
Throws {ConvertFrom-NfseDistributionResponse (Response @($bad)) $company} 'Chave' 'wrapper key must match signed XML key'
$bad=@{}+$item;$bad.NSU=$null
Throws {ConvertFrom-NfseDistributionResponse (Response @($bad)) $company} 'NSU' 'missing NSU cannot be invented'
$bad=@{}+$item;$bad.TipoDocumento='DPS'
Throws {ConvertFrom-NfseDistributionResponse (Response @($bad)) $company} 'TipoDocumento' 'unsupported payload cannot advance cursor'
Throws {ConvertFrom-NfseDistributionResponse (Response @($item,$item)) $company} 'NSU' 'duplicate NSUs fail closed'
Throws {ConvertFrom-NfseDistributionResponse '{"StatusProcessamento":"UNKNOWN"}' $company} 'Status' 'new server status requires inspection'
$request=Get-NfseDistributionUri ([pscustomobject]@{companyCnpj=$company;environment='1'}) '000000000000007'
Equal $request 'https://adn.nfse.gov.br/contribuintes/DFe/7?cnpjConsulta=38626750000146&lote=true' 'last known NSU passed without increment and official query name'
Equal (Get-NfseDistributionUri ([pscustomobject]@{companyCnpj=$company;environment='2'}) '0') 'https://adn.producaorestrita.nfse.gov.br/contribuintes/DFe/0?cnpjConsulta=38626750000146&lote=true' 'test environment separated'
Throws {Get-NfseDistributionUri ([pscustomobject]@{companyCnpj=$company;environment='3'}) '0'} 'ambiente' 'invalid environment never defaults to production'
Throws {Get-NfseDistributionUri ([pscustomobject]@{companyCnpj=$company;environment='1'}) '-1'} 'NSU' 'negative NSU never sent'
# Offline transport seam: no certificate access or fiscal endpoint request in tests.
$module=Get-Module Nfse
& $module {
    function script:Get-CompanyCertificate($Config){return 'TEST_CERTIFICATE_SENTINEL'}
    function script:Invoke-WebRequest {
        param($Uri,$Method,$Certificate,$Headers,$TimeoutSec,[switch]$UseBasicParsing,$MaximumRedirection)
        if($Uri -cne 'https://adn.nfse.gov.br/contribuintes/DFe/7?cnpjConsulta=38626750000146&lote=true' -or $Method -cne 'Get' -or $Certificate -cne 'TEST_CERTIFICATE_SENTINEL' -or $Headers.Accept -cne 'application/json' -or $MaximumRedirection -ne 0){throw 'Incorrect authenticated transport request'}
        return [pscustomobject]@{Content='{"StatusProcessamento":"NENHUM_DOCUMENTO_LOCALIZADO"}'}
    }
}
Equal (Invoke-NfseDistribution ([pscustomobject]@{companyCnpj=$company;environment='1'}) '7') '{"StatusProcessamento":"NENHUM_DOCUMENTO_LOCALIZADO"}' 'single authenticated GET returns raw body intact'
$bad=@{}+$item;$bad.ArquivoXml=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('<NFSe/>'))
Throws {ConvertFrom-NfseDistributionResponse (Response @($bad)) $company} 'GZip|archive|arquivo|magic|compression|compact|corrupt|invalid' 'non-gzip payload cannot become accepted fiscal XML'
$before=@{}+$item;$before.NSU=6
Throws {ConvertFrom-NfseDistributionResponse (Response @($item,$before)) $company} 'NSU' 'descending NSUs fail closed'
Equal (ConvertFrom-NfseXml $none '9223372036854775807' $company).nsu '9223372036854775807' 'maximum int64 preserved without truncating NSU'
Throws {ConvertFrom-NfseXml $none '9223372036854775808' $company} 'NSU' 'overflow beyond official int64 rejected'
Throws {ConvertFrom-NfseXml ($none.Replace('http://www.sped.fazenda.gov.br/nfse','urn:unexpected')) '7' $company} 'Namespace' 'unrelated invoice dialect rejected'
Throws {ConvertFrom-NfseXml ($none.Replace('<vLiq>763.50</vLiq>','')) '7' $company} 'vLiq' 'missing official net amount not synthesized'
$unknownRetention=$none.Replace('<tpRetISSQN>1</tpRetISSQN>','<tpRetISSQN>9</tpRetISSQN>')
Throws {Parse $unknownRetention} 'ISSQN desconhecido' 'unknown ISS retention code requires review'
$missingPisAmount=$none.Replace('<tribFed></tribFed>','<tribFed><piscofins><tpRetPisCofins>1</tpRetPisCofins></piscofins></tribFed>')
Equal (Parse $missingPisAmount).fields.Contains('PIS_RETIDO') $false 'retention flag cannot fabricate an amount'
$badBytes=[Text.Encoding]::UTF8.GetBytes($none);$badBytes[$none.IndexOf('Contrato ficticio')]=255
$invalidUtf8=@{}+$item;$invalidUtf8.ArquivoXml=Zip $badBytes
Throws {ConvertFrom-NfseDistributionResponse (Response @($invalidUtf8)) $company} 'UTF|Unicode|translate|traduz|codifica' 'invalid UTF8 must not silently alter original XML'
$maximum=@{}+$item;$maximum.NSU=[long]::MaxValue
Equal (ConvertFrom-NfseDistributionResponse (Response @($maximum)) $company).lastNsu '9223372036854775807' 'official int64 JSON retains all 19 digits'
$withBom=([string][char]0xFEFF)+$none
$bomDoc=ConvertFrom-NfseXml $withBom '7' $company
Equal $bomDoc.key $key 'UTF8 BOM does not hide national invoice'
Equal ([Convert]::FromBase64String($bomDoc.xmlBase64)[0]) ([byte]239) 'original UTF8 BOM retained in original XML artifact'
$serviceFields=$none.Replace('<nNFSe>123</nNFSe>','<xLocPrestacao>Betim</xLocPrestacao><nNFSe>123</nNFSe>').Replace('<serv><cServ>','<serv><locPrest><cLocPrestacao>3106705</cLocPrestacao></locPrest><cServ><cTribNac>010101</cTribNac><cTribMun>999</cTribMun>')
$serviceDoc=Parse $serviceFields
Equal $serviceDoc.fields.VALOR_SERVICOS ([decimal]1000) 'service alias is literal vServ rather than net or tax base'
Equal $serviceDoc.fields.ISS ([decimal]50) 'ISS alias is explicit vISSQN even when not retained'
Equal $serviceDoc.fields.Contains('ISS_RETIDO') $false 'ordinary ISS alias does not create buyer withholding'
Equal $serviceDoc.fields.MUNICIPIO_PRESTACAO 'Betim' 'municipality uses explicit description for service locality'
Equal $serviceDoc.fields.CODIGO_SERVICO '010101' 'national service code retains leading zero and is not municipal code'
$codeOnly=Parse ($serviceFields.Replace('<xLocPrestacao>Betim</xLocPrestacao>',''))
Equal $codeOnly.fields.MUNICIPIO_PRESTACAO '3106705' 'missing municipality description retains literal IBGE code without lookup'
$noOptional=Parse ($none.Replace('<vISSQN>50.00</vISSQN>',''))
foreach($name in @('ISS','MUNICIPIO_PRESTACAO','CODIGO_SERVICO')){Equal $noOptional.fields.Contains($name) $false ('missing optional alias remains absent '+$name)}
$zero=Parse ($none.Replace('<vISSQN>50.00</vISSQN>','<vISSQN>0.00</vISSQN>'))
Equal $zero.fields.ISS ([decimal]0) 'explicit zero ISS stays zero'
$foreign=Parse ($serviceFields.Replace('<cLocPrestacao>3106705</cLocPrestacao>','<cPaisPrestacao>US</cPaisPrestacao>').Replace('<xLocPrestacao>Betim</xLocPrestacao>','<xLocPrestacao>Exterior</xLocPrestacao>'))
Equal $foreign.fields.Contains('MUNICIPIO_PRESTACAO') $false 'foreign country is not invented Brazilian municipality'
$municipalOnly=Parse ($serviceFields.Replace('<cTribNac>010101</cTribNac>',''))
Equal $municipalOnly.fields.Contains('CODIGO_SERVICO') $false 'municipal code does not masquerade as national service code'
Throws {Parse ($none.Replace('<vServ>1000.00</vServ>',''))} 'vServ' 'missing required service amount never creates zero alias'
Write-Output ('PASS NFS-e assertions: '+$script:passed)
