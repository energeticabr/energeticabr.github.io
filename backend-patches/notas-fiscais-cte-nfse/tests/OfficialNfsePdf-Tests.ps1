$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/Nfse.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../src/Danfe.psm1') -Force
$script:passed=0
function Assert-True($Value,[string]$Name){if(-not $Value){throw "FALHOU: $Name"};$script:passed++;Write-Host "PASS $Name"}
function Assert-Fails([scriptblock]$Action,[string]$Pattern,[string]$Name){$failed=$false;try{$null=& $Action}catch{if($_.Exception.Message -notmatch $Pattern){throw};$failed=$true};Assert-True $failed $Name}
$doc=ConvertFrom-NfseXml ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fixtures/nfse-ficticia.xml'))) '1' '38626750000146'
$config=[pscustomobject]@{companyCnpj='38626750000146';environment='2';certificateStore='CurrentUser';certificateThumbprint='SYNTHETIC'}
$uri=Get-OfficialNfsePdfUri $config $doc.key
Assert-True ($uri -ceq ('https://adn.producaorestrita.nfse.gov.br/danfse/'+$doc.key)) 'DANFSe usa servico oficial separado no ambiente configurado'
$production=[pscustomobject]@{companyCnpj=$config.companyCnpj;environment='1'}
Assert-True ((Get-OfficialNfsePdfUri $production $doc.key) -ceq ('https://adn.nfse.gov.br/danfse/'+$doc.key)) 'DANFSe producao usa dominio oficial fixo'
Assert-Fails {Get-OfficialNfsePdfUri $config ($doc.key+'?url=https://evil.invalid')} 'DANFSE_KEY_INVALID' 'Chave nao aceita injecao na URI'
Assert-Fails {Get-OfficialNfsePdfUri ([pscustomobject]@{companyCnpj=$config.companyCnpj;environment='3'}) $doc.key} 'DANFSE_CONFIG_INVALID' 'Ambiente desconhecido bloqueado'
$script:bytes=[Text.Encoding]::ASCII.GetBytes("%PDF-1.4`nSYNTHETIC TRANSPORT TEST ONLY`n%%EOF`n")
$script:reply=[pscustomobject]@{statusCode=200;contentType='application/pdf';bytes=$script:bytes}
$transport={param($Config,$Uri) $script:reply}
$script:portalCalls=[Collections.Generic.List[string]]::new()
$portalPdfUri='https://www.nfse.gov.br/EmissorNacional/Notas/Download/DANFSe/'+$doc.key
$portalRequest={param($Uri)
    $script:portalCalls.Add([string]$Uri)
    if([string]$Uri -ceq 'https://certificado.nfse.gov.br/EmissorNacional/Certificado'){return [pscustomobject]@{statusCode=302;location='https://www.nfse.gov.br/EmissorNacional/Dashboard'}}
    if([string]$Uri -ceq 'https://www.nfse.gov.br/EmissorNacional/Dashboard'){return [pscustomobject]@{statusCode=200;contentType='text/html';bytes=[Text.Encoding]::UTF8.GetBytes('<html>Dashboard</html>')}}
    return [pscustomobject]@{statusCode=200;contentType='application/pdf';bytes=$script:bytes}
}
$portal=& (Get-Module Danfe) {param($C,$K,$R) Invoke-OfficialNfsePortalPdfTransport $C $K $R} $production $doc.key $portalRequest
Assert-True ($portal.source -ceq 'PORTAL_NFSE_OFFICIAL' -and $portal.sourceUrl -ceq $portalPdfUri -and $script:portalCalls.Count -eq 3) 'Portal autentica por certificado e baixa rota oficial da chave em sessao unica'
$unsafeRedirect={param($Uri) [pscustomobject]@{statusCode=302;location='https://outside.example/EmissorNacional/Dashboard'}}
Assert-Fails {& (Get-Module Danfe) {param($C,$K,$R) Invoke-OfficialNfsePortalPdfTransport $C $K $R} $production $doc.key $unsafeRedirect} 'DANFSE_PORTAL_URI_UNTRUSTED' 'Portal bloqueia redirect para host externo antes de enviar certificado'
$authLoop={param($Uri) [pscustomobject]@{statusCode=302;location='https://www.nfse.gov.br/EmissorNacional/Dashboard'}}
Assert-Fails {& (Get-Module Danfe) {param($C,$K,$R) Invoke-OfficialNfsePortalPdfTransport $C $K $R} $production $doc.key $authLoop} 'DANFSE_PORTAL_REDIRECT_LIMIT' 'Portal limita redirecionamentos de autenticacao'
$challenge={param($Uri) [pscustomobject]@{statusCode=200;contentType='text/html';bytes=[Text.Encoding]::UTF8.GetBytes('<html>Login challenge</html>')}}
Assert-Fails {& (Get-Module Danfe) {param($C,$K,$R) Invoke-OfficialNfsePortalPdfTransport $C $K $R} $production $doc.key $challenge} 'DANFSE_PORTAL_AUTH_REQUIRED' 'Pagina de login ou desafio nao e tratada como sessao autenticada'
$htmlDownload={param($Uri)
    if(([uri]$Uri).AbsolutePath -like '*/Download/*'){return [pscustomobject]@{statusCode=200;contentType='text/html';bytes=[Text.Encoding]::UTF8.GetBytes('<html>CAPTCHA challenge</html>')}}
    & $portalRequest $Uri
}
Assert-Fails {& (Get-Module Danfe) {param($C,$K,$R) Invoke-OfficialNfsePortalPdfTransport $C $K $R} $production $doc.key $htmlDownload} 'DANFSE_CONTENT_TYPE_INVALID' 'HTML de desafio no download nunca vira PDF nem recebe tratamento de CAPTCHA'
foreach($location in @('http://www.nfse.gov.br/EmissorNacional/Dashboard','https://www.nfse.gov.br/Other/Dashboard','https://www.nfse.gov.br.evil.invalid/EmissorNacional/Dashboard','https://user:password@www.nfse.gov.br/EmissorNacional/Dashboard')){
    $script:unsafeLocation=$location
    $redirect={param($Uri) [pscustomobject]@{statusCode=302;location=$script:unsafeLocation}}
    Assert-Fails {& (Get-Module Danfe) {param($C,$K,$R) Invoke-OfficialNfsePortalPdfTransport $C $K $R} $production $doc.key $redirect} 'DANFSE_PORTAL_URI_UNTRUSTED' 'Redirecionamento rejeita HTTP namespace host semelhante ou credenciais na URL'
}
foreach($status in @(401,403,429,500)){
    $fallback=& (Get-Module Danfe) {param($C,$S) Test-OfficialNfsePortalFallback $C $S} $production $status
    Assert-True (-not $fallback) 'Falha autenticacao limite ou erro nao transitorio nao aciona portal'
}
foreach($status in @(502,503,504)){
    Assert-True (& (Get-Module Danfe) {param($C,$S) Test-OfficialNfsePortalFallback $C $S} $production $status) 'Portal oficial pode atender indisponibilidade transitoria da API em producao'
}
Assert-True (-not (& (Get-Module Danfe) {param($C) Test-OfficialNfsePortalFallback $C 503} $config)) 'Homologacao nao utiliza portal de producao'
$result=Get-OfficialNfsePdf $doc $config $transport
$cultureBefore=[Globalization.CultureInfo]::CurrentCulture
try{
    [Globalization.CultureInfo]::CurrentCulture=[Globalization.CultureInfo]::GetCultureInfo('pt-BR')
    $archived=$doc|ConvertTo-Json -Depth 10|ConvertFrom-Json -DateKind String
    $fromArchive=Get-OfficialNfsePdf $archived $config $transport
    Assert-True ($fromArchive.key -ceq $doc.key -and $fromArchive.pdfSha256 -ceq $result.pdfSha256) 'JSON arquivado aceita valores .00 e .50 sem depender de formato ou cultura pt-BR'
    $archived.fields.PSObject.Properties.Remove('PAPEL_EMPRESA')
    $fromOldArchive=Get-OfficialNfsePdf $archived $config $transport
    Assert-True ($fromOldArchive.key -ceq $doc.key) 'Papel ausente nos metadados antigos usa atores explicitos do XML'
    $archived.fields.VALOR_LIQUIDO=763.51
    Assert-Fails {Get-OfficialNfsePdf $archived $config $transport} 'DANFSE_DOCUMENT_IDENTITY_INVALID' 'Comparacao monetaria exige centavos exatos depois do JSON'
    $archived.fields.VALOR_LIQUIDO=763.5000000000001
    Assert-Fails {Get-OfficialNfsePdf $archived $config $transport} 'DANFSE_DOCUMENT_IDENTITY_INVALID' 'Valor JSON adulterado abaixo do centavo nao e arredondado para aceitar identidade'
}finally{[Globalization.CultureInfo]::CurrentCulture=$cultureBefore}
foreach($actorCompany in @('12345678000123','99999999000199')){
    $actorConfig=[pscustomobject]@{companyCnpj=$actorCompany;environment='2'}
    $actorDoc=ConvertFrom-NfseXml ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fixtures/nfse-ficticia.xml'))) '1' $actorCompany
    $actorResult=Get-OfficialNfsePdf $actorDoc $actorConfig $transport
    Assert-True ($actorResult.key -ceq $doc.key) 'Prestador ou intermediario explicito no XML tem identidade autorizada'
}
$outsiderConfig=[pscustomobject]@{companyCnpj='88888888000188';environment='2'}
$outsiderDoc=ConvertFrom-NfseXml ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fixtures/nfse-ficticia.xml'))) '1' $outsiderConfig.companyCnpj
$outsiderDoc.fields.PAPEL_EMPRESA='TOMADOR'
Assert-Fails {Get-OfficialNfsePdf $outsiderDoc $outsiderConfig $transport} 'DANFSE_DOCUMENT_IDENTITY_INVALID' 'Papel forjado nos metadados nao autoriza CNPJ ausente do XML'
Assert-True ($result.pdfBase64 -ceq [Convert]::ToBase64String($script:bytes)) 'PDF oficial preserva bytes sem recriar ou marcar paginas'
Assert-True ($result.source -ceq 'ADN_DANFSE_OFFICIAL' -and $result.sourceUrl -ceq $uri -and $result.key -ceq $doc.key -and $result.xmlSha256 -ceq $doc.sha256) 'Proveniencia oficial vincula chave e XML'
Assert-True ($result.fileName -ceq ('DANFSe-'+$doc.key+'-'+$doc.sha256.Substring(0,16)+'.pdf')) 'Nome de anexo mantem contrato existente'
$script:reply.statusCode=302
Assert-Fails {Get-OfficialNfsePdf $doc $config $transport} 'DANFSE_HTTP_STATUS' 'Redirect nao vira PDF nem permite host alternativo'
$script:reply.statusCode=200;$script:reply.contentType='text/html'
Assert-Fails {Get-OfficialNfsePdf $doc $config $transport} 'DANFSE_CONTENT_TYPE_INVALID' 'Resposta HTML nao aceita como documento fiscal'
$script:reply.contentType='application/pdf';$script:reply.bytes=[Text.Encoding]::ASCII.GetBytes('<html>erro</html>')
Assert-Fails {Get-OfficialNfsePdf $doc $config $transport} 'DANFSE_PDF_INVALID' 'Assinatura PDF obrigatoria'
$script:reply.bytes=[Text.Encoding]::ASCII.GetBytes("%PDF-1.4`nDOCUMENTO TRUNCADO SEM MARCADOR FINAL")
Assert-Fails {Get-OfficialNfsePdf $doc $config $transport} 'DANFSE_PDF_INVALID' 'PDF truncado rejeitado'
$script:reply.bytes=[byte[]]::new(2000001)
Assert-Fails {Get-OfficialNfsePdf $doc $config $transport} 'DANFSE_PDF_INVALID' 'PDF acima do limite rejeitado'
$script:reply.bytes=$script:bytes
$bad=$doc|ConvertTo-Json -Depth 10|ConvertFrom-Json;$bad.key='9'*50
Assert-Fails {Get-OfficialNfsePdf $bad $config $transport} 'DANFSE_DOCUMENT_IDENTITY_INVALID' 'Chave deve corresponder ao XML original'
$bad=$doc|ConvertTo-Json -Depth 10|ConvertFrom-Json;$bad.fields.NUMERO_NOTA='999999'
Assert-Fails {Get-OfficialNfsePdf $bad $config $transport} 'DANFSE_DOCUMENT_IDENTITY_INVALID' 'Numero dos metadados nao diverge do XML'
$bad=$doc|ConvertTo-Json -Depth 10|ConvertFrom-Json;$bad.sha256='0'*64
Assert-Fails {Get-OfficialNfsePdf $bad $config $transport} 'DANFSE_DOCUMENT_IDENTITY_INVALID' 'Hash XML divergente bloqueia download'
$worker=[pscustomobject]@{collectorConfig=$config}
$script:localResponse=[pscustomobject]@{key=$doc.key;xmlSha256=$doc.sha256;fileName=$result.fileName;pdfBase64=[Convert]::ToBase64String($script:bytes);pdfSha256=$result.pdfSha256;source='LOCAL_DANFSE_NACIONAL'}
$localRender={param($Config,$Request)
    if($Request.key -cne $doc.key -or $Request.xmlBase64 -cne $doc.xmlBase64){throw 'LOCAL_RENDER_INPUT_INVALID'}
    if($doc.fields.SITUACAO -in @('CANCELADA','SUBSTITUIDA') -and $Request.fiscalSituation -cne $doc.fields.SITUACAO){throw 'LOCAL_SITUATION_MISSING'}
    $script:localResponse
}
$localAttached=Add-SefazDanfe $doc $worker $localRender
Assert-True ($localAttached.danfe.source -ceq 'LOCAL_DANFSE_NACIONAL' -and -not $localAttached.danfe.Contains('sourceUrl')) 'Rotina NFSe gera DANFSe nacional local sem dependencia da API PDF e sem alegar download oficial'
$localAppDataBefore=$env:LOCALAPPDATA
try{
    $env:LOCALAPPDATA=Join-Path ([IO.Path]::GetTempPath()) ('missing-fiscal-runtime-'+[guid]::NewGuid().ToString('N'))
    Assert-Fails {Add-SefazDanfe $doc $worker} 'DANFSE_LOCAL_RUNTIME_REQUIRED' 'NFSe padrao usa Python Windows e falha fechado se runtime local estiver ausente'
    $withInjectedRenderer=Add-SefazDanfe $doc $worker $localRender
    Assert-True ($withInjectedRenderer.danfe.sha256 -ceq $result.pdfSha256) 'Render injetado preserva compatibilidade sem consultar runtime nem servicos externos'
}finally{$env:LOCALAPPDATA=$localAppDataBefore}
foreach($situation in @('CANCELADA','SUBSTITUIDA')){
    $doc.fields.SITUACAO=$situation
    $attached=Add-SefazDanfe $doc $worker $localRender
    Assert-True ($attached.fields.SITUACAO -ceq $situation -and $attached.xmlBase64 -ceq $doc.xmlBase64) 'DANFSe local recebe situacao terminal e preserva XML original'
}
$script:localResponse.source='ADN_DANFSE_OFFICIAL'
Assert-Fails {Add-SefazDanfe $doc $worker $localRender} 'DANFSE_LOCAL_SOURCE_INVALID' 'Geracao local rejeita label indevido de PDF oficial baixado'
$script:localResponse.source='LOCAL_DANFSE_NACIONAL';$script:localResponse.pdfSha256='0'*64
Assert-Fails {Add-SefazDanfe $doc $worker $localRender} 'DANFE_PDF_HASH_MISMATCH' 'DANFSe local exige hash exato dos bytes renderizados'
$script:localResponse.pdfSha256=$result.pdfSha256
Assert-Fails {Add-SefazDanfe $bad $worker {throw 'INVALID_XML_MUST_NOT_RENDER'}} 'DANFSE_DOCUMENT_IDENTITY_INVALID' 'DANFSe local valida XML chave hash e atores antes de renderizar'
$script:reply.statusCode=503
Assert-Fails {Get-OfficialNfsePdf $doc $config $transport} 'DANFSE_HTTP_STATUS' 'Utilitario de download continua falhando fechado quando API nao retorna PDF'
$whileUnavailable=Add-SefazDanfe $doc $worker $localRender
Assert-True ($whileUnavailable.danfe.source -ceq 'LOCAL_DANFSE_NACIONAL') 'Rotina automatica local continua disponivel com API PDF503'
$portalTransport={param($Config,$Uri) $portal}
$fromPortal=Get-OfficialNfsePdf $doc $production $portalTransport
Assert-True ($fromPortal.source -ceq 'PORTAL_NFSE_OFFICIAL' -and $fromPortal.sourceUrl -ceq $portalPdfUri -and $fromPortal.pdfBase64 -ceq [Convert]::ToBase64String($script:bytes)) 'Download oficial preserva proveniencia real do portal e bytes originais'
$portal.sourceUrl='https://outside.example/fake.pdf'
Assert-Fails {Get-OfficialNfsePdf $doc $production $portalTransport} 'DANFSE_SOURCE_INVALID' 'Proveniencia do portal deve corresponder a rota canonica exata da chave'
Write-Host "RESULTADO: $script:passed verificacoes DANFSe oficial aprovadas."
