param([string]$ModulePath=(Join-Path $PSScriptRoot '../src/Sefaz.psm1'))
$ErrorActionPreference='Stop'
Import-Module $ModulePath -Force -DisableNameChecking
$key='31261012345678000123550010000001231000001234'
$xml='<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe'+$key+'"><ide><mod>55</mod></ide><emit><CNPJ>12345678000123</CNPJ><xNome>FICTICIO</xNome></emit><dest><CNPJ>38626750000146</CNPJ></dest><det nItem="1"><prod><xProd>ESCORAMENTO METALICO</xProd></prod></det><det nItem="2"><prod><xProd>LOCACAO DE ANDAIME</xProd></prod></det><total><ICMSTot><vNF>1000.00</vNF><vICMS>180.00</vICMS><vST>40.00</vST><vPIS>6.50</vPIS><vCOFINS>30.00</vCOFINS><vTotTrib>250.00</vTotTrib></ICMSTot>__RET__</total></infNFe></NFe><protNFe><infProt><cStat>100</cStat></infProt></protNFe></nfeProc>'
function Equal($actual,$expected,$label){if($actual -cne $expected){throw "$label : expected [$expected], actual [$actual]"};$script:passed++}
function Parse($ret){ConvertFrom-FiscalXml ($xml.Replace('__RET__',$ret)) '000000000000001' '38626750000146'}
$script:passed=0
$tags='<retTrib><vRetPIS>6.50</vRetPIS><vRetCOFINS>30.00</vRetCOFINS><vRetCSLL>10.00</vRetCSLL><vBCIRRF>1000.00</vBCIRRF><vIRRF>15.00</vIRRF><vBCRetPrev>1000.00</vBCRetPrev><vRetPrev>110.00</vRetPrev></retTrib><ISSQNtot><vISS>50.00</vISS><vISSRet>25.00</vISSRet></ISSQNtot>'
$doc=Parse $tags
Equal $doc.fields.STATUS_RETENCOES 'RETENCAO_INFORMADA_XML' 'positive withholding is identified'
foreach($pair in @(@('PIS_RETIDO',6.50),@('COFINS_RETIDA',30),@('CSLL_RETIDA',10),@('IRRF_RETIDO',15),@('INSS_RETIDO',110),@('ISS_RETIDO',25))){Equal $doc.fields[$pair[0]] ([decimal]$pair[1]) $pair[0]}
Equal $doc.fields.VALOR_TOTAL_NOTA ([decimal]1000) 'withholding does not change total'
Equal $doc.fields.VALOR_LIQUIDO ([decimal]1000) 'withholding does not deduct net a second time'
Equal $doc.fields.DIRECAO 'ENTRADA' 'buyer is company'
Equal $doc.fields.DESCRICAO_ITENS 'ESCORAMENTO METALICO; LOCACAO DE ANDAIME' 'product descriptions preserve fiscal item order'
$none=Parse ''
Equal $none.fields.STATUS_RETENCOES 'NAO_INFORMADA_XML' 'normal taxes and substitution do not imply buyer withholding'
Equal $none.fields.Contains('PIS_RETIDO') $false 'missing withholding is not invented zero'
$baseOnly=Parse '<retTrib><vBCIRRF>1000.00</vBCIRRF><vBCRetPrev>1000.00</vBCRetPrev><vIRRF>0.00</vIRRF></retTrib>'
Equal $baseOnly.fields.STATUS_RETENCOES 'NAO_INFORMADA_XML' 'tax bases alone are not withheld tax'
Equal $baseOnly.fields.IRRF_RETIDO ([decimal]0) 'explicit zero preserved'
foreach($tag in @('vRetPIS','vRetCOFINS','vRetCSLL','vIRRF','vRetPrev')){Equal (Parse ('<retTrib><'+$tag+'>0.01</'+$tag+'></retTrib>')).fields.STATUS_RETENCOES 'RETENCAO_INFORMADA_XML' ('minimum positive '+$tag)}
Equal (Parse '<ISSQNtot><vISSRet>0.01</vISSRet></ISSQNtot>').fields.STATUS_RETENCOES 'RETENCAO_INFORMADA_XML' 'ISS alone identifies withholding'
$summary=ConvertFrom-FiscalXml ('<resNFe><chNFe>'+$key+'</chNFe><vNF>1000.00</vNF></resNFe>') '000000000000002' '38626750000146'
Equal $summary.fields.Contains('STATUS_RETENCOES') $false 'summary withholding remains unknown'
$merged=Merge-FiscalFields $doc.fields $summary.fields
Equal $merged.INSS_RETIDO ([decimal]110) 'summary does not erase withholding'
Equal $merged.STATUS_RETENCOES 'RETENCAO_INFORMADA_XML' 'summary preserves analysis'
$cleared=Merge-FiscalFields $doc.fields $none.fields
Equal $cleared.Contains('INSS_RETIDO') $false 'complete reanalysis clears missing optional retained amount'
Equal $cleared.STATUS_RETENCOES 'NAO_INFORMADA_XML' 'complete reanalysis updates status'
Write-Output ('PASS retention assertions: '+$script:passed)
