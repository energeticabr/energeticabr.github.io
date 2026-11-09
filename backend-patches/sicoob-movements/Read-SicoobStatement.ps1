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
    $windows = ConvertFrom-Json -NoEnumerate -InputObject ([Console]::In.ReadToEnd())
    if (-not $windows.Count) { throw 'SICOOB_EMPTY_REQUEST' }

    try {
        $token = Invoke-DdaBankRequest {
            Invoke-RestMethod -Method Post -Uri 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token' `
                -Certificate $cert -ContentType 'application/x-www-form-urlencoded' -TimeoutSec 30 -MaximumRedirection 0 `
                -Body @{grant_type = 'client_credentials'; client_id = $clientId; scope = 'cco_consulta'}
        }
    } catch {
        if ($_.ErrorDetails.Message -match '"error"\s*:\s*"invalid_scope"') {
            throw 'SICOOB_EXTRATO_SCOPE_NOT_GRANTED'
        }
        throw
    }
    if (-not $token.access_token -or ($token.scope -and $token.scope -split ' ' -notcontains 'cco_consulta')) {
        throw 'SICOOB_EXTRATO_AUTH_REJECTED'
    }

    $headers = @{Authorization = 'Bearer ' + $token.access_token; client_id = $clientId; Accept = 'application/json'}
    $results = [Collections.Generic.List[object]]::new()
    foreach ($window in $windows) {
        if ($window.Count -ne 2) { throw 'SICOOB_INVALID_MONTH_WINDOW' }
        $first = [datetime]::ParseExact($window[0], 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
        $last = [datetime]::ParseExact($window[1], 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
        if ($first -gt $last -or $first.Month -ne $last.Month -or $first.Year -ne $last.Year) {
            throw 'SICOOB_INVALID_MONTH_WINDOW'
        }
        $uri = "https://api.sicoob.com.br/conta-corrente/v4/extrato/$($first.Month)/$($first.Year)?diaInicial=$($first.Day)&diaFinal=$($last.Day)&numeroContaCorrente=$account&agruparCNAB=false"
        for ($attempt = 0; $attempt -lt 4; $attempt++) {
            try {
                $result = Invoke-DdaBankRequest {
                    Invoke-WebRequest -Uri $uri -Certificate $cert -Headers $headers -TimeoutSec 45 -MaximumRedirection 0
                }
                break
            } catch {
                if ([int]$_.Exception.Response.StatusCode -ne 403 -or
                    $_.ErrorDetails.Message -notmatch '"moreInformation"\s*:\s*"Not registered to plan"') {
                    throw
                }
                if ($attempt -eq 3) { throw 'SICOOB_EXTRATO_PLAN_NOT_REGISTERED' }
                Start-Sleep -Seconds ([math]::Pow(2, $attempt + 1))
            }
        }
        $results.Add([string]$result.Content)
    }
    @{account = $account; statements = $results} | ConvertTo-Json -Depth 15 -Compress
} catch {
    $message = $_.Exception.Message
    if ($message -cmatch '^SICOOB_[A-Z0-9_]{1,40}$') { [Console]::Out.WriteLine($message) }
    else { [Console]::Out.WriteLine('SICOOB_STATEMENT_READ_FAILED') }
    exit 1
} finally {
    if ($cert) { $cert.Dispose() }
}
