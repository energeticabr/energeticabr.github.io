Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function Get-OfficialNfsePdfUri($Config,[string]$Key){
    if($Key -cnotmatch '^\d{50}$'){throw 'DANFSE_KEY_INVALID'}
    if($Config.companyCnpj -cnotmatch '^\d{14}$' -or [string]$Config.environment -cnotin @('1','2')){throw 'DANFSE_CONFIG_INVALID'}
    # Fixed government endpoints: never allow callers or HTTP redirects to choose a host.
    $hostName='adn.nfse.gov.br'
    if([string]$Config.environment -ceq '2'){$hostName='adn.producaorestrita.nfse.gov.br'}
    return 'https://'+$hostName+'/danfse/'+$Key
}

function Test-OfficialNfsePortalFallback($Config,[int]$Status){
    return ([string]$Config.environment -ceq '1' -and $Status -in @(502,503,504))
}

function Assert-OfficialNfsePortalUri([uri]$Uri){
    if(-not $Uri.IsAbsoluteUri -or $Uri.Scheme -cne 'https' -or $Uri.Port -ne 443 -or $Uri.UserInfo -or $Uri.Fragment -or
        $Uri.Host -cnotin @('certificado.nfse.gov.br','www.nfse.gov.br') -or
        -not $Uri.AbsolutePath.StartsWith('/EmissorNacional/',[StringComparison]::Ordinal) -or $Uri.AbsolutePath -match '%|\\'){throw 'DANFSE_PORTAL_URI_UNTRUSTED'}
}

function Invoke-OfficialNfsePortalGet($Client,[uri]$Uri){
    Assert-OfficialNfsePortalUri $Uri
    $response=$null;$stream=$null;$output=$null
    try{
        $response=$Client.GetAsync($Uri,[Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        $status=[int]$response.StatusCode
        $location='';if($null -ne $response.Headers.Location){$location=[string]$response.Headers.Location}
        $contentType='';if($null -ne $response.Content.Headers.ContentType){$contentType=$response.Content.Headers.ContentType.MediaType}
        # Redirect/error bodies may contain session data. Do not read or expose them.
        if($status -ne 200){return [pscustomobject]@{statusCode=$status;location=$location;contentType=$contentType;bytes=[byte[]]::new(0)}}
        if($response.Content.Headers.ContentLength -gt 2000000){throw 'DANFSE_PDF_INVALID'}
        $stream=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult();$output=[IO.MemoryStream]::new();$buffer=[byte[]]::new(8192)
        $deadline=[DateTimeOffset]::UtcNow.AddSeconds(90)
        while($true){
            $remaining=$deadline-[DateTimeOffset]::UtcNow
            if($remaining.TotalMilliseconds -le 0){throw 'DANFSE_DOWNLOAD_TIMEOUT'}
            $reading=$stream.ReadAsync($buffer,0,$buffer.Length)
            if(-not $reading.Wait([int][Math]::Min(90000,$remaining.TotalMilliseconds))){throw 'DANFSE_DOWNLOAD_TIMEOUT'}
            $read=$reading.GetAwaiter().GetResult();if($read -le 0){break}
            if($output.Length+$read -gt 2000000){throw 'DANFSE_PDF_INVALID'}
            $output.Write($buffer,0,$read)
        }
        return [pscustomobject]@{statusCode=$status;location=$location;contentType=$contentType;bytes=$output.ToArray()}
    }finally{
        if($null -ne $stream){$stream.Dispose()};if($null -ne $output){$output.Dispose()};if($null -ne $response){$response.Dispose()}
    }
}

function Invoke-OfficialNfsePortalPdfTransport($Config,[string]$Key,[scriptblock]$Request){
    $null=Get-OfficialNfsePdfUri $Config $Key
    if([string]$Config.environment -cne '1'){throw 'DANFSE_PORTAL_PRODUCTION_REQUIRED'}
    $handler=$null;$client=$null
    try{
        if($null -eq $Request){
            if($PSVersionTable.PSVersion.Major -lt 7){throw 'DANFE_POWERSHELL7_REQUIRED'}
            Import-Module (Join-Path $PSScriptRoot 'Sefaz.psm1') -DisableNameChecking -Scope Local
            $certificate=Get-CompanyCertificate $Config
            $handler=[Net.Http.HttpClientHandler]::new();$handler.AllowAutoRedirect=$false
            $handler.UseCookies=$true;$handler.CookieContainer=[Net.CookieContainer]::new()
            $handler.ClientCertificateOptions=[Net.Http.ClientCertificateOption]::Manual;$null=$handler.ClientCertificates.Add($certificate)
            $handler.SslProtocols=[Security.Authentication.SslProtocols]::Tls12
            $client=[Net.Http.HttpClient]::new($handler);$client.Timeout=[TimeSpan]::FromSeconds(90)
            $Request={param($Uri) Invoke-OfficialNfsePortalGet $client ([uri]$Uri)}
        }
        [uri]$authUri='https://certificado.nfse.gov.br/EmissorNacional/Certificado'
        $redirects=0
        while($true){
            Assert-OfficialNfsePortalUri $authUri
            $auth=& $Request $authUri
            if([int]$auth.statusCode -in @(301,302,303,307,308)){
                if($redirects -ge 8){throw 'DANFSE_PORTAL_REDIRECT_LIMIT'}
                if([string]::IsNullOrWhiteSpace([string]$auth.location)){throw 'DANFSE_PORTAL_AUTH_REQUIRED'}
                $authUri=[uri]::new($authUri,[string]$auth.location);Assert-OfficialNfsePortalUri $authUri;$redirects++;continue
            }
            if([int]$auth.statusCode -ne 200 -or $authUri.Host -cne 'www.nfse.gov.br' -or $authUri.AbsolutePath -cne '/EmissorNacional/Dashboard' -or $authUri.Query){throw 'DANFSE_PORTAL_AUTH_REQUIRED'}
            break
        }
        [uri]$downloadUri='https://www.nfse.gov.br/EmissorNacional/Notas/Download/DANFSe/'+$Key
        Assert-OfficialNfsePortalUri $downloadUri
        $download=& $Request $downloadUri
        if([int]$download.statusCode -ne 200){throw ('DANFSE_PORTAL_HTTP_STATUS_'+[int]$download.statusCode)}
        if([string]$download.contentType -inotmatch '^application/pdf(?:\s*;.*)?$'){throw 'DANFSE_CONTENT_TYPE_INVALID'}
        if($download.bytes -isnot [byte[]]){throw 'DANFSE_PDF_INVALID'}
        [byte[]]$bytes=$download.bytes
        if($bytes.Length -lt 20 -or $bytes.Length -gt 2000000 -or [Text.Encoding]::ASCII.GetString($bytes,0,5) -cne '%PDF-' -or
            [Text.Encoding]::ASCII.GetString($bytes,[Math]::Max(0,$bytes.Length-32),[Math]::Min(32,$bytes.Length)) -notmatch '%%EOF\s*$'){throw 'DANFSE_PDF_INVALID'}
        return [pscustomobject]@{statusCode=200;contentType='application/pdf';bytes=$bytes;source='PORTAL_NFSE_OFFICIAL';sourceUrl=$downloadUri.AbsoluteUri}
    }finally{
        # Session cookies exist only inside this handler and are never serialized.
        if($null -ne $client){$client.Dispose()}elseif($null -ne $handler){$handler.Dispose()}
    }
}

function Invoke-OfficialNfsePdfTransport($Config,[string]$Uri){
    if($PSVersionTable.PSVersion.Major -lt 7){throw 'DANFE_POWERSHELL7_REQUIRED'}
    $parsed=[uri]$Uri
    if($parsed.Scheme -cne 'https' -or $parsed.Host -cnotin @('adn.nfse.gov.br','adn.producaorestrita.nfse.gov.br') -or
        $parsed.Port -ne 443 -or $parsed.UserInfo -or $parsed.Query -or $parsed.Fragment -or $parsed.AbsolutePath -cnotmatch '^/danfse/\d{50}$'){throw 'DANFSE_URI_UNTRUSTED'}
    Import-Module (Join-Path $PSScriptRoot 'Sefaz.psm1') -DisableNameChecking -Scope Local
    # Private key remains in the Windows certificate store, never exported.
    $certificate=Get-CompanyCertificate $Config
    $handler=[Net.Http.HttpClientHandler]::new();$client=$null;$response=$null;$stream=$null;$output=$null
    try{
        $handler.AllowAutoRedirect=$false
        $handler.ClientCertificateOptions=[Net.Http.ClientCertificateOption]::Manual
        $null=$handler.ClientCertificates.Add($certificate)
        $handler.SslProtocols=[Security.Authentication.SslProtocols]::Tls12
        $client=[Net.Http.HttpClient]::new($handler);$client.Timeout=[TimeSpan]::FromSeconds(90)
        $client.DefaultRequestHeaders.Accept.ParseAdd('application/pdf')
        $response=$client.GetAsync($parsed,[Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        if(Test-OfficialNfsePortalFallback $Config ([int]$response.StatusCode)){
            return Invoke-OfficialNfsePortalPdfTransport $Config ($parsed.AbsolutePath.Substring('/danfse/'.Length))
        }
        if([int]$response.StatusCode -ne 200){throw ('DANFSE_HTTP_STATUS_'+[int]$response.StatusCode)}
        $contentType='';if($null -ne $response.Content.Headers.ContentType){$contentType=$response.Content.Headers.ContentType.MediaType}
        if($contentType -ine 'application/pdf'){throw 'DANFSE_CONTENT_TYPE_INVALID'}
        if($response.Content.Headers.ContentLength -gt 2000000){throw 'DANFSE_PDF_INVALID'}
        $stream=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult();$output=[IO.MemoryStream]::new()
        $buffer=[byte[]]::new(8192)
        $deadline=[DateTimeOffset]::UtcNow.AddSeconds(90)
        while($true){
            $remaining=$deadline-[DateTimeOffset]::UtcNow
            if($remaining.TotalMilliseconds -le 0){throw 'DANFSE_DOWNLOAD_TIMEOUT'}
            $reading=$stream.ReadAsync($buffer,0,$buffer.Length)
            if(-not $reading.Wait([int][Math]::Min(90000,$remaining.TotalMilliseconds))){throw 'DANFSE_DOWNLOAD_TIMEOUT'}
            $read=$reading.GetAwaiter().GetResult();if($read -le 0){break}
            if($output.Length+$read -gt 2000000){throw 'DANFSE_PDF_INVALID'}
            $output.Write($buffer,0,$read)
        }
        return [pscustomobject]@{statusCode=[int]$response.StatusCode;contentType=$contentType;bytes=$output.ToArray()}
    }finally{
        if($null -ne $stream){$stream.Dispose()};if($null -ne $output){$output.Dispose()}
        if($null -ne $response){$response.Dispose()};if($null -ne $client){$client.Dispose()}else{$handler.Dispose()}
    }
}

function Assert-NfsePdfDocumentIdentity($Document,[string]$CompanyCnpj){
    Import-Module (Join-Path $PSScriptRoot 'Nfse.psm1') -DisableNameChecking -Scope Local
    try{
        $xmlBytes=[Convert]::FromBase64String([string]$Document.xmlBase64)
        $xml=[Text.UTF8Encoding]::new($false,$true).GetString($xmlBytes)
        $verified=ConvertFrom-NfseXml $xml ([string]$Document.nsu) $CompanyCnpj
        if($Document.kind -cne 'NFSe' -or $verified.kind -cne 'NFSe' -or $verified.key -cne $Document.key -or $verified.sha256 -cne $Document.sha256){throw 'identity'}
        foreach($field in @('CNPJ_CONSULTADO','CNPJ_FORNECEDOR','NUMERO_NOTA')){
            if([string]$verified.fields[$field] -cne [string]$Document.fields.$field){throw 'identity'}
        }
        foreach($field in @('VALOR_TOTAL_NOTA','VALOR_LIQUIDO')){
            # Archive JSON numbers lose decimal scale (.00 -> integer, .50 -> double).
            # Compare numeric amounts exactly, never locale-dependent display strings.
            $stored=$Document.fields.$field
            if($null -eq $stored -or $stored -is [bool]){throw 'identity'}
            if($stored -is [string] -and $stored -cnotmatch '^\d{1,15}(?:\.\d{1,2})?$'){throw 'identity'}
            if($stored -is [double] -or $stored -is [single]){
                # Convert.ToDecimal(double) rounds to 15 digits. Preserve the
                # complete round-trip value so a sub-cent mutation cannot pass.
                $amount=[decimal]::Parse($stored.ToString('R',[Globalization.CultureInfo]::InvariantCulture),[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture)
            }else{$amount=[Convert]::ToDecimal($stored,[Globalization.CultureInfo]::InvariantCulture)}
            if($amount -ne [decimal]$verified.fields[$field]){throw 'identity'}
        }
        # Older archived metadata need not contain PAPEL_EMPRESA. Authorization
        # comes only from company identity explicitly present as an XML actor.
        $settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit;$settings.XmlResolver=$null;$settings.MaxCharactersInDocument=16000000
        $xmlForIdentity=$xml;if($xmlForIdentity.Length -gt 0 -and $xmlForIdentity[0] -eq [char]0xFEFF){$xmlForIdentity=$xmlForIdentity.Substring(1)}
        $reader=[Xml.XmlReader]::Create([IO.StringReader]::new($xmlForIdentity),$settings)
        try{$identityXml=[Xml.XmlDocument]::new();$identityXml.XmlResolver=$null;$identityXml.Load($reader)}finally{$reader.Dispose()}
        $actorIds=$identityXml.SelectNodes("/*[local-name()='NFSe']/*[local-name()='infNFSe']/*[local-name()='DPS']/*[local-name()='infDPS']/*[local-name()='prest' or local-name()='toma' or local-name()='interm']/*[local-name()='CNPJ' or local-name()='CPF']")
        $actorMatch=$false
        foreach($actorId in $actorIds){if($actorId.InnerText -ceq $CompanyCnpj){$actorMatch=$true;break}}
        if(-not $actorMatch){throw 'identity'}
    }catch{throw 'DANFSE_DOCUMENT_IDENTITY_INVALID'}
}

function Get-OfficialNfsePdf($Document,$Config,[scriptblock]$Transport){
    $uri=Get-OfficialNfsePdfUri $Config ([string]$Document.key)
    Assert-NfsePdfDocumentIdentity $Document ([string]$Config.companyCnpj)
    if($null -eq $Transport){$response=Invoke-OfficialNfsePdfTransport $Config $uri}else{$response=& $Transport $Config $uri}
    if($null -eq $response -or [int]$response.statusCode -ne 200){throw 'DANFSE_HTTP_STATUS'}
    if([string]$response.contentType -inotmatch '^application/pdf(?:\s*;.*)?$'){throw 'DANFSE_CONTENT_TYPE_INVALID'}
    if($response.bytes -isnot [byte[]]){throw 'DANFSE_PDF_INVALID'}
    [byte[]]$pdf=$response.bytes
    if($pdf.Length -lt 20 -or $pdf.Length -gt 2000000 -or [Text.Encoding]::ASCII.GetString($pdf,0,5) -cne '%PDF-' -or
        [Text.Encoding]::ASCII.GetString($pdf,[Math]::Max(0,$pdf.Length-32),[Math]::Min(32,$pdf.Length)) -notmatch '%%EOF\s*$'){throw 'DANFSE_PDF_INVALID'}
    $sha=[Security.Cryptography.SHA256]::Create()
    try{$digest=([BitConverter]::ToString($sha.ComputeHash($pdf))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
    $source='ADN_DANFSE_OFFICIAL';$sourceUrl=$uri
    if($response.PSObject.Properties['source']){
        $portalUrl='https://www.nfse.gov.br/EmissorNacional/Notas/Download/DANFSe/'+$Document.key
        if($response.source -cne 'PORTAL_NFSE_OFFICIAL' -or [string]$Config.environment -cne '1' -or $response.sourceUrl -cne $portalUrl){throw 'DANFSE_SOURCE_INVALID'}
        $source=$response.source;$sourceUrl=$response.sourceUrl
    }
    return [pscustomobject]@{key=$Document.key;xmlSha256=$Document.sha256;fileName=('DANFSe-'+$Document.key+'-'+$Document.sha256.Substring(0,16)+'.pdf');pdfBase64=[Convert]::ToBase64String($pdf);pdfSha256=$digest;source=$source;sourceUrl=$sourceUrl}
}

function Invoke-SefazDanfeRenderer($Config,$Request){
    if($PSVersionTable.PSVersion.Major -lt 7){throw 'DANFE_POWERSHELL7_REQUIRED'}
    if($Config.sshHost -notmatch '^[A-Za-z_][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9.-]*$' -or
       $Config.danfePython -notmatch '^/[A-Za-z0-9_./-]+$' -or
       $Config.danfeRenderer -notmatch '^/[A-Za-z0-9_./-]+$'){throw 'DANFE_HOST_CONFIG_INVALID'}
    $info=[Diagnostics.ProcessStartInfo]::new()
    $info.FileName=(Get-Command ssh.exe -ErrorAction Stop).Source
    foreach($arg in @('-T','-o','BatchMode=yes','-o','ConnectTimeout=20','-i',[string]$Config.sshKeyPath,[string]$Config.sshHost,
        ('sudo -n '+$Config.danfePython+' '+$Config.danfeRenderer))){$info.ArgumentList.Add($arg)}
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true
    $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $info.StandardInputEncoding=[Text.UTF8Encoding]::new($false)
    $info.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
    $info.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)
    $process=[Diagnostics.Process]::new();$process.StartInfo=$info
    try{
        if(-not $process.Start()){throw 'DANFE_PROCESS_START'}
        $output=$process.StandardOutput.ReadToEndAsync();$errors=$process.StandardError.ReadToEndAsync()
        $writing=$process.StandardInput.WriteAsync(($Request|ConvertTo-Json -Compress -Depth 10))
        if(-not $writing.Wait(90000)){throw 'DANFE_PROCESS_TIMEOUT'}
        $process.StandardInput.Close()
        if(-not $process.WaitForExit(90000)){throw 'DANFE_PROCESS_TIMEOUT'}
        $text=$output.GetAwaiter().GetResult();$null=$errors.GetAwaiter().GetResult()
        if($process.ExitCode -ne 0 -or $text.Length -gt 2800000){throw 'DANFE_PROCESS_FAILED'}
        try{return ($text|ConvertFrom-Json -ErrorAction Stop)}catch{throw 'DANFE_PROCESS_RESPONSE_INVALID'}
    }finally{
        if(-not $process.HasExited){try{$process.Kill($true)}catch{}}
        $process.Dispose()
    }
}

function Invoke-SefazLocalDanfseRenderer($Config,$Request){
    if($PSVersionTable.PSVersion.Major -lt 7){throw 'DANFE_POWERSHELL7_REQUIRED'}
    $python=Join-Path $env:LOCALAPPDATA 'Energetica/Runtime/FiscalPdf/Scripts/python.exe'
    $renderer=Join-Path $PSScriptRoot 'danfe_renderer.py'
    if(-not [IO.File]::Exists($python) -or -not [IO.File]::Exists($renderer)){throw 'DANFSE_LOCAL_RUNTIME_REQUIRED'}
    $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$python
    $info.ArgumentList.Add('-B');$info.ArgumentList.Add($renderer)
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true
    $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $info.StandardInputEncoding=[Text.UTF8Encoding]::new($false)
    $info.StandardOutputEncoding=[Text.UTF8Encoding]::new($false,$true)
    $info.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)
    $process=[Diagnostics.Process]::new();$process.StartInfo=$info;$started=$false;$output=[IO.MemoryStream]::new()
    try{
        $started=$process.Start();if(-not $started){throw 'DANFSE_LOCAL_PROCESS_START'}
        $deadline=[DateTimeOffset]::UtcNow.AddSeconds(90)
        $errors=$process.StandardError.ReadToEndAsync()
        $writing=$process.StandardInput.WriteAsync(($Request|ConvertTo-Json -Compress -Depth 10))
        if(-not $writing.Wait(90000)){throw 'DANFSE_LOCAL_PROCESS_TIMEOUT'}
        $process.StandardInput.Close()
        $buffer=[byte[]]::new(8192)
        while($true){
            $remaining=$deadline-[DateTimeOffset]::UtcNow
            if($remaining.TotalMilliseconds -le 0){throw 'DANFSE_LOCAL_PROCESS_TIMEOUT'}
            $reading=$process.StandardOutput.BaseStream.ReadAsync($buffer,0,$buffer.Length)
            if(-not $reading.Wait([int][Math]::Min(90000,$remaining.TotalMilliseconds))){throw 'DANFSE_LOCAL_PROCESS_TIMEOUT'}
            $read=$reading.GetAwaiter().GetResult();if($read -le 0){break}
            if($output.Length+$read -gt 2800000){throw 'DANFSE_LOCAL_PROCESS_RESPONSE_INVALID'}
            $output.Write($buffer,0,$read)
        }
        $remaining=$deadline-[DateTimeOffset]::UtcNow
        if($remaining.TotalMilliseconds -le 0 -or -not $process.WaitForExit([int][Math]::Min(90000,$remaining.TotalMilliseconds))){throw 'DANFSE_LOCAL_PROCESS_TIMEOUT'}
        $null=$errors.GetAwaiter().GetResult()
        if($process.ExitCode -ne 0){throw 'DANFSE_LOCAL_PROCESS_FAILED'}
        try{return ([Text.UTF8Encoding]::new($false,$true).GetString($output.ToArray())|ConvertFrom-Json -ErrorAction Stop)}catch{throw 'DANFSE_LOCAL_PROCESS_RESPONSE_INVALID'}
    }finally{
        if($started -and -not $process.HasExited){try{$process.Kill($true)}catch{}}
        $output.Dispose();$process.Dispose()
    }
}

function Add-SefazDanfe($Document,$Config,[scriptblock]$Render){
    if($Document.kind -notin @('nfeProc','cteProc','cteOSProc','cteSimpProc','NFSe')){return $Document}
    Import-Module (Join-Path $PSScriptRoot 'FiscalDocuments.psm1') -DisableNameChecking
    $request=[ordered]@{key=$Document.key;companyCnpj='38626750000146';xmlSha256=$Document.sha256;xmlBase64=$Document.xmlBase64}
    if($Document.kind -ceq 'NFSe'){
        Assert-NfsePdfDocumentIdentity $Document $request.companyCnpj
        if($Document.fields.SITUACAO -in @('CANCELADA','SUBSTITUIDA')){$request.fiscalSituation=$Document.fields.SITUACAO}
    }
    if($null -ne $Render){$result=& $Render $Config $request}
    elseif($Document.kind -ceq 'NFSe'){$result=Invoke-SefazLocalDanfseRenderer $Config $request}
    else{$result=Invoke-SefazDanfeRenderer $Config $request}
    if($Document.kind -ceq 'NFSe' -and ($null -eq $result -or $null -eq $result.PSObject.Properties['source'] -or $result.source -cne 'LOCAL_DANFSE_NACIONAL')){throw 'DANFSE_LOCAL_SOURCE_INVALID'}
    $expected=(Get-FiscalPdfPrefix $Document)+'-'+$Document.key+'-'+$Document.sha256.Substring(0,16)+'.pdf'
    if($null -eq $result -or $result.key -cne $Document.key -or $result.xmlSha256 -cne $Document.sha256 -or
        $result.fileName -cne $expected -or [string]$result.pdfSha256 -cnotmatch '^[0-9a-f]{64}$' -or
        [string]$result.pdfBase64 -notmatch '^[A-Za-z0-9+/]*={0,2}$' -or $result.pdfBase64.Length -gt 2700000){throw 'DANFE_IDENTITY_INVALID'}
    try{$pdf=[Convert]::FromBase64String($result.pdfBase64)}catch{throw 'DANFE_PDF_INVALID'}
    if($pdf.Length -lt 20 -or $pdf.Length -gt 2000000 -or [Text.Encoding]::ASCII.GetString($pdf,0,5) -cne '%PDF-' -or
       [Text.Encoding]::ASCII.GetString($pdf,[Math]::Max(0,$pdf.Length-32),[Math]::Min(32,$pdf.Length)) -notmatch '%%EOF\s*$'){throw 'DANFE_PDF_INVALID'}
    $sha=[Security.Cryptography.SHA256]::Create()
    try{$digest=([BitConverter]::ToString($sha.ComputeHash($pdf))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
    if($digest -cne $result.pdfSha256){throw 'DANFE_PDF_HASH_MISMATCH'}
    $copy=[ordered]@{}
    foreach($property in $Document.PSObject.Properties){$copy[$property.Name]=$property.Value}
    $copy.danfe=[ordered]@{fileName=$expected;pdfBase64=$result.pdfBase64;sha256=$digest}
    if($Document.kind -ceq 'NFSe'){$copy.danfe.source='LOCAL_DANFSE_NACIONAL'}
    return [pscustomobject]$copy
}

Export-ModuleMember -Function Add-SefazDanfe,Get-OfficialNfsePdfUri,Get-OfficialNfsePdf
