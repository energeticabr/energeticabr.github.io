Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
foreach($module in @('Sefaz.psm1','Cte.psm1','Nfse.psm1')){Import-Module (Join-Path $PSScriptRoot $module) -DisableNameChecking -Scope Local}

function Get-FiscalXmlType($Text){
 $bytes=if($Text -is [byte[]]){$Text}else{[Text.Encoding]::UTF8.GetBytes([string]$Text)}
 $settings=New-Object Xml.XmlReaderSettings
 $settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit;$settings.XmlResolver=$null;$settings.MaxCharactersInDocument=80000000
 $stream=New-Object IO.MemoryStream(,$bytes);$reader=$null
 try{
  $reader=[Xml.XmlReader]::Create($stream,$settings);$null=$reader.MoveToContent()
  if($reader.NamespaceURI -eq 'http://www.portalfiscal.inf.br/nfe' -or $reader.LocalName -in @('nfeProc','resNFe','procEventoNFe','resEvento')){return 'NFE'}
  if($reader.NamespaceURI -eq 'http://www.portalfiscal.inf.br/cte'){return 'CTE'}
  if($reader.NamespaceURI -eq 'http://www.sped.fazenda.gov.br/nfse'){return 'NFSE'}
  throw 'FISCAL_XML_TYPE_UNSUPPORTED'
 }finally{if($null -ne $reader){$reader.Dispose()};$stream.Dispose()}
}
function ConvertFrom-UnifiedFiscalXml($Text,[string]$Nsu,[string]$CompanyCnpj){
 $type=Get-FiscalXmlType $Text
 switch($type){
  NFE{
   if($Nsu -notmatch '^\d{1,15}$'){throw 'FISCAL_NFE_NSU_INVALID'}
   $value=if($Text -is [byte[]]){[Text.UTF8Encoding]::new($false,$true).GetString($Text)}else{[string]$Text}
   $doc=ConvertFrom-FiscalXml $value $Nsu $CompanyCnpj
   $doc.fields.TIPO_FISCAL='NF-e';$doc.fields.ORIGEM_FISCAL='SEFAZ_NFE'
  }
  CTE{$doc=ConvertFrom-CteXml $Text $Nsu $CompanyCnpj;$doc.fields.ORIGEM_FISCAL='SEFAZ_CTE'}
  NFSE{
   $value=if($Text -is [byte[]]){[Text.UTF8Encoding]::new($false,$true).GetString($Text)}else{[string]$Text}
   $doc=ConvertFrom-NfseXml $value $Nsu $CompanyCnpj;$doc.fields.ORIGEM_FISCAL='ADN_NFSE'
  }
 }
 return $doc
}
function Assert-FiscalDocumentIntegrity($Document,[string]$CompanyCnpj='38626750000146'){
 if([string]$Document.nsu -notmatch '^\d{15,19}$'){throw 'FISCAL_DOCUMENT_NSU_INVALID'}
 $raw=[Convert]::FromBase64String([string]$Document.xmlBase64)
 $normalized=ConvertFrom-UnifiedFiscalXml $raw ([string]$Document.nsu) $CompanyCnpj
 foreach($field in @('id','key','kind','sha256','fileName')){if([string]$normalized.$field -cne [string]$Document.$field){throw 'FISCAL_DOCUMENT_INTEGRITY_INVALID'}}
 return $normalized
}
function Get-FiscalField($Fields,[string]$Name){
 if($null -eq $Fields){return $null}
 if($Fields -is [Collections.IDictionary]){if($Fields.Contains($Name)){return $Fields[$Name]}}
 elseif($Fields.PSObject.Properties[$Name]){return $Fields.$Name}
 return $null
}
function Get-FiscalPdfPrefix($Document){
 switch([string](Get-FiscalField $Document.fields 'TIPO_FISCAL')){'CT-e'{return 'DACTE'};'NFS-e'{return 'DANFSe'};default{return 'DANFE'}}
}
function Get-FiscalDocumentScopeDisposition($Document,[object[]]$Evidence,[string]$MinimumIssueDate,[DateTimeOffset]$Now){
 if($Document.kind -in @('nfeProc','resNFe','procEventoNFe','resEvento')){return Get-SefazDocumentScopeDisposition $Document $Evidence $MinimumIssueDate $Now}
 if([string]::IsNullOrWhiteSpace($MinimumIssueDate)){return 'READY'}
 $minimum=[DateTime]::ParseExact($MinimumIssueDate,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
 $doc=Assert-FiscalDocumentIntegrity $Document
 $date=[string](Get-FiscalField $doc.fields 'DATA_EMISSAO_ORIGINAL')
 if([string]::IsNullOrWhiteSpace($date)){$date=[string](Get-FiscalField $doc.fields 'DATA_EMISSAO')}
 if([string]::IsNullOrWhiteSpace($date)){
  foreach($candidate in @($Evidence|Where-Object{$_.key -ceq $doc.key})){
   $actual=Assert-FiscalDocumentIntegrity $candidate
   $date=[string](Get-FiscalField $actual.fields 'DATA_EMISSAO_ORIGINAL')
   if([string]::IsNullOrWhiteSpace($date)){$date=[string](Get-FiscalField $actual.fields 'DATA_EMISSAO')}
   if(-not [string]::IsNullOrWhiteSpace($date)){break}
  }
 }
 if([string]::IsNullOrWhiteSpace($date)){return 'PENDING_DATE'}
 $issued=[DateTimeOffset]::Parse($date,[Globalization.CultureInfo]::InvariantCulture)
 if($issued -gt $Now){return 'FUTURE_DATE'}
 if($issued.Date -lt $minimum.Date){return 'BEFORE_SCOPE'}
 return 'READY'
}
Export-ModuleMember -Function ConvertFrom-UnifiedFiscalXml,Assert-FiscalDocumentIntegrity,Get-FiscalDocumentScopeDisposition,Get-FiscalPdfPrefix
