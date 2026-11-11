$ErrorActionPreference = 'Stop'
$env:DDA_PRIVATE_ROOT = '/var/lib/energetica-whatsapp/dda-collector'
$collector = '/opt/energetica-whatsapp/dda-collector'
$cert = $null
$clock = [Diagnostics.Stopwatch]::StartNew()
try {
    . (Join-Path $collector 'DdaPlatform.ps1')
    . (Join-Path $collector 'DdaBankHttp.ps1')
    $config = Read-PrivateJson (Join-Path $env:DDA_PRIVATE_ROOT 'sharepoint-bank-credentials.dpapi')
    $dedicated = Read-PrivateJson (Join-Path $env:DDA_PRIVATE_ROOT 'sicoob-movements-credentials.dpapi')
    $inputData = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
    if (-not $dedicated.clientId -or $dedicated.cnpj -cne $config.cnpj -or
        $dedicated.accountNumber -cne $config.accountNumber -or $inputData.account -cne $config.accountNumber) {
        throw 'SICOOB_RECEIPT_ACCOUNT_MISMATCH'
    }
    $cert = Get-CompanyClientCertificate -Cnpj $config.cnpj
    $requestToken = {
        $value = Invoke-RestMethod -Method Post -Uri 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token' `
            -Certificate $cert -ContentType 'application/x-www-form-urlencoded' -TimeoutSec 25 -MaximumRedirection 0 `
            -Body @{grant_type = 'client_credentials'; client_id = $dedicated.clientId; scope = 'pagamentos_consulta'}
        if (-not $value.access_token -or $value.scope -split ' ' -notcontains 'pagamentos_consulta') {
            throw 'SICOOB_RECEIPT_SCOPE_NOT_GRANTED'
        }
        return $value
    }
    $token = Invoke-DdaBankRequest $requestToken
    $headers = @{Authorization = 'Bearer ' + $token.access_token; client_id = $dedicated.clientId; Accept = 'application/json'}
    $results = [ordered]@{}
    foreach ($reference in $inputData.references) {
        if ($reference -notmatch '^\d{4,18}$') { throw 'SICOOB_INVALID_RECEIPT_REFERENCE' }
        # Return completed reads before the Python caller's 840-second timeout.
        if ($clock.Elapsed.TotalSeconds -ge 600) { break }
        $uri = "https://api.sicoob.com.br/pagamentos/v3/boletos/pagamentos/$reference/comprovantes?numeroConta=$($config.accountNumber)"
        $results[$reference] = @{status = 0; receipt = $null}
        $refreshToken = $false
        $refreshedToken = $false
        for ($attempt = 1; $attempt -le 4; $attempt++) {
            if ($clock.Elapsed.TotalSeconds -ge 600) { break }
            try {
                if ($refreshToken) {
                    $token = & $requestToken
                    $headers.Authorization = 'Bearer ' + $token.access_token
                    $refreshToken = $false
                    $refreshedToken = $true
                }
                $response = Invoke-WebRequest -Uri $uri -Certificate $cert -Headers $headers -TimeoutSec 25 -MaximumRedirection 0 -SkipHttpErrorCheck
                $content = if ($response.Content -is [byte[]]) {
                    [Text.Encoding]::UTF8.GetString($response.Content)
                } else { [string]$response.Content }
                $status = [int]$response.StatusCode
                $receipt = if ($status -eq 200) { (ConvertFrom-Json -DateKind String -InputObject $content).resultado }
                $results[$reference] = @{status = $status; receipt = $receipt}
                if ($status -eq 401 -and -not $refreshedToken) {
                    $refreshToken = $true
                } elseif (-not (($status -eq 403 -and $content -match 'Not registered to plan') -or
                                $status -in @(408, 500, 502, 503, 504))) { break }
            } catch {
                # One unavailable or malformed receipt must not discard other receipts.
                $results[$reference] = @{status = 0; receipt = $null}
            }
            if ($attempt -eq 4) { break }
            Start-Sleep -Seconds $attempt
        }
        if ($results[$reference].status -eq 429) { break }
    }
    $results | ConvertTo-Json -Depth 12 -Compress
} catch {
    [Console]::Error.WriteLine('SICOOB_RECEIPT_READ_FAILED')
    exit 1
} finally {
    if ($cert) { $cert.Dispose() }
}
