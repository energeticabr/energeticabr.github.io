$ErrorActionPreference = 'Stop'
$env:DDA_PRIVATE_ROOT = '/var/lib/energetica-whatsapp/dda-collector'
$collector = '/opt/energetica-whatsapp/dda-collector'
$cert = $null
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
    $token = Invoke-DdaBankRequest {
        Invoke-RestMethod -Method Post -Uri 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token' `
            -Certificate $cert -ContentType 'application/x-www-form-urlencoded' -TimeoutSec 25 -MaximumRedirection 0 `
            -Body @{grant_type = 'client_credentials'; client_id = $dedicated.clientId; scope = 'pagamentos_consulta'}
    }
    if (-not $token.access_token -or $token.scope -split ' ' -notcontains 'pagamentos_consulta') {
        throw 'SICOOB_RECEIPT_SCOPE_NOT_GRANTED'
    }
    $headers = @{Authorization = 'Bearer ' + $token.access_token; client_id = $dedicated.clientId; Accept = 'application/json'}
    $results = [ordered]@{}
    foreach ($reference in $inputData.references) {
        if ($reference -notmatch '^\d{4,18}$') { throw 'SICOOB_INVALID_RECEIPT_REFERENCE' }
        $uri = "https://api.sicoob.com.br/pagamentos/v3/boletos/pagamentos/$reference/comprovantes?numeroConta=$($config.accountNumber)"
        for ($attempt = 1; $attempt -le 4; $attempt++) {
            $response = Invoke-WebRequest -Uri $uri -Certificate $cert -Headers $headers -TimeoutSec 25 -MaximumRedirection 0 -SkipHttpErrorCheck
            if ($response.StatusCode -ne 403 -or $response.Content -notmatch 'Not registered to plan' -or $attempt -eq 4) { break }
            Start-Sleep -Seconds $attempt
        }
        $results[$reference] = @{
            status = [int]$response.StatusCode
            receipt = $(if ($response.StatusCode -eq 200) {
                (ConvertFrom-Json -DateKind String -InputObject $response.Content).resultado
            })
        }
        if ($response.StatusCode -eq 429) { break }
    }
    $results | ConvertTo-Json -Depth 12 -Compress
} catch {
    [Console]::Error.WriteLine('SICOOB_RECEIPT_READ_FAILED')
    exit 1
} finally {
    if ($cert) { $cert.Dispose() }
}
