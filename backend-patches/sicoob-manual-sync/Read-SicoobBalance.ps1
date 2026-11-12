$ErrorActionPreference = 'Stop'
$env:POWERSHELL_TELEMETRY_OPTOUT = '1'
$env:DDA_PRIVATE_ROOT = '/var/lib/energetica-whatsapp/dda-collector'
$collector = '/opt/energetica-whatsapp/dda-collector'
$cert = $null
try {
    . (Join-Path $collector 'DdaPlatform.ps1')
    . (Join-Path $collector 'DdaBankHttp.ps1')
    $config = Read-PrivateJson (Join-Path $env:DDA_PRIVATE_ROOT 'sharepoint-bank-credentials.dpapi')
    $dedicated = Read-PrivateJson (Join-Path $env:DDA_PRIVATE_ROOT 'sicoob-movements-credentials.dpapi')
    if ($dedicated.Count -and ($dedicated.cnpj -cne $config.cnpj -or $dedicated.accountNumber -cne $config.accountNumber -or -not $dedicated.clientId)) {
        throw 'SICOOB_DEDICATED_CREDENTIAL_MISMATCH'
    }
    $clientId = if ($dedicated.Count) { $dedicated.clientId } else { $config.clientId }
    $account = [string]$config.accountNumber
    if ($account -notmatch '^\d{4,20}$' -or -not $clientId) { throw 'SICOOB_INVALID_ACCOUNT_CONFIGURATION' }
    $cert = Get-CompanyClientCertificate -Cnpj $config.cnpj
    $token = Invoke-DdaBankRequest {
        Invoke-RestMethod -Method Post -Uri 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token' `
            -Certificate $cert -ContentType 'application/x-www-form-urlencoded' -TimeoutSec 8 -MaximumRedirection 0 `
            -Body @{grant_type = 'client_credentials'; client_id = $clientId; scope = 'cco_consulta'}
    }
    if (-not $token.access_token -or ($token.scope -and $token.scope -split ' ' -notcontains 'cco_consulta')) {
        throw 'SICOOB_BALANCE_AUTH_REJECTED'
    }
    $headers = @{Authorization = 'Bearer ' + $token.access_token; client_id = $clientId; Accept = 'application/json'}
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        try {
            $balance = Invoke-DdaBankRequest {
                Invoke-RestMethod -Uri "https://api.sicoob.com.br/conta-corrente/v4/saldo?numeroContaCorrente=$account" `
                    -Certificate $cert -Headers $headers -TimeoutSec 8 -MaximumRedirection 0
            }
            break
        } catch {
            if ($attempt -eq 2 -or [int]$_.Exception.Response.StatusCode -ne 403 -or
                $_.ErrorDetails.Message -notmatch '"moreInformation"\s*:\s*"Not registered to plan"') {
                throw
            }
            Start-Sleep -Seconds ([math]::Pow(2, $attempt + 1))
        }
    }
    [Console]::Out.WriteLine([Convert]::ToString($balance.resultado.saldo, [Globalization.CultureInfo]::InvariantCulture))
} catch {
    exit 1
} finally {
    if ($cert) { $cert.Dispose() }
}
