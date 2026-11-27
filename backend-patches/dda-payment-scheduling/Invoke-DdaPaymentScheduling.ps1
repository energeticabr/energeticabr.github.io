[CmdletBinding()]
param([Parameter(Mandatory, Position=0)][ValidateSet('quote','dispatch','lookup')][string]$Operation)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:POWERSHELL_TELEMETRY_OPTOUT = '1'
$env:DDA_PRIVATE_ROOT = '/var/lib/energetica-whatsapp/dda-collector'
$collector = '/opt/energetica-whatsapp/dda-collector'
$tokenUrl = 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token'
$certificate = $null
$submitted = $false

function Get-ScopeHeaders($Client, [string]$Scope) {
    $response = Invoke-DdaBankRequest {
        Invoke-WebRequest -Method Post -Uri $tokenUrl -Certificate $certificate -TimeoutSec 8 -MaximumRedirection 0 `
            -ContentType 'application/x-www-form-urlencoded' -SkipHttpErrorCheck `
            -Body @{grant_type='client_credentials'; client_id=$Client; scope=$Scope}
    }
    if ($response.StatusCode -ne 200) { return }
    $token = $response.Content | ConvertFrom-Json -AsHashtable
    if (-not $token.access_token -or -not $token.scope -or
        @($Scope.Split(' ') | Where-Object { $_ -cnotin $token.scope.Split(' ') }).Count) { return }
    return @{Authorization='Bearer ' + $token.access_token; client_id=$Client; Accept='application/json'}
}

function Invoke-Bank([string]$Method, [string]$Path, [hashtable]$Headers, [hashtable]$Payment) {
    $options = @{Method=$Method; Uri=$api + $Path; Headers=$Headers; Certificate=$certificate;
        TimeoutSec=8; MaximumRedirection=0; SkipHttpErrorCheck=$true}
    if ($Payment) {
        $options.ContentType = 'application/json'
        $options.Body = $Payment | ConvertTo-Json -Depth 5 -Compress
    }
    return Invoke-DdaBankRequest { Invoke-WebRequest @options }
}

function Get-BankRows($Response) {
    if ($Response.StatusCode -eq 204) { return }
    if ($Response.StatusCode -ne 200) { throw 'DDA_READ_FAILED' }
    $result = $Response.Content | ConvertFrom-Json -AsHashtable -NoEnumerate
    if ($result -is [System.Collections.IDictionary]) {
        if ($result.hasMore -or $result.nextLink -or $result.'@odata.nextLink') { throw 'DDA_INCOMPLETE' }
        $result = $result.resultado
    }
    if ($null -eq $result -or $result -isnot [array]) { throw 'DDA_INVALID_RESULT' }
    return $result
}

function Get-PendingBankOrder {
    $due = [string]$inputData.due
    $response = Invoke-Bank GET "/boletos?numeroConta=$account&dataInicial=$due&dataFinal=$due&situacao=2&tipoData=1" $headers
    return @(Get-BankRows $response | Where-Object { $_.numeroCodigoBarras -ceq $barcode }).Count -gt 0
}

function Get-AmountCents($Value) {
    if ($null -eq $Value) { throw 'DDA_INVALID_AMOUNT' }
    $amount = [decimal]::Parse([string]$Value, [Globalization.CultureInfo]::InvariantCulture)
    if ($amount -lt 0 -or $amount -gt 999999999999.99 -or [math]::Round($amount, 2) -ne $amount) { throw 'DDA_INVALID_AMOUNT' }
    return [long]($amount * 100)
}

function Get-ReceiptState($Response) {
    if ($Response.StatusCode -eq 202 -and $Operation -eq 'dispatch') { return @{status='approval'} }
    if ($Response.StatusCode -in 400,406 -and $Operation -eq 'dispatch') {
        $deny = $Response.Content | ConvertFrom-Json -AsHashtable -ErrorAction SilentlyContinue
        if ($deny.mensagens) { return @{status='rejected'} }
    }
    if ($Response.StatusCode -ne 200) { return @{status='pending'} }
    $result = ($Response.Content | ConvertFrom-Json -AsHashtable).resultado
    $line = ([string]$result.numeroLinhaDigitavel) -replace '[ .-]', ''
    if ($line -notmatch '^[0-9]{47}$') { return @{status='pending'} }
    $receiptCode = $line.Substring(0,4) + $line.Substring(32,15) + $line.Substring(4,5) + $line.Substring(10,10) + $line.Substring(21,10)
    if ($receiptCode -cne $barcode) { return @{status='pending'} }
    if ($result.situacaoPagamento -in 'Rejeitado','Cancelado') { return @{status='rejected'} }
    if ($result.dataPagamento -cne $inputData.date -or (Get-AmountCents $result.valorPagamento) -ne $inputData.amountCents -or
        [string]$result.idPagamento -notmatch '^[1-9][0-9]{0,17}$') { return @{status='pending'} }
    switch ($result.situacaoPagamento) {
        'Agendado' { return @{status='scheduled'; paymentId=[long]$result.idPagamento} }
        'Efetivado' { return @{status='effective'; paymentId=[long]$result.idPagamento} }
        default { return @{status='pending'} }
    }
}

try {
    . (Join-Path $collector 'DdaPlatform.ps1')
    . (Join-Path $collector 'DdaBankHttp.ps1')
    $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json -AsHashtable
    $company = Read-PrivateJson (Join-Path $env:DDA_PRIVATE_ROOT 'sharepoint-bank-credentials.dpapi')
    $payments = Read-PrivateJson (Join-Path $env:DDA_PRIVATE_ROOT 'sicoob-payments-credentials.dpapi')
    $barcode = [string]$inputData.barcode
    $account = [string]$company.accountNumber
    if ($barcode -notmatch '^[0-9]{44}$' -or $account -notmatch '^[0-9]{1,14}$' -or
        $inputData.date -notmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' -or $inputData.due -notmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' -or
        $inputData.company -cne $company.cnpj) { throw 'INVALID_DDA_SCOPE' }
    $certificate = Get-CompanyClientCertificate -Cnpj $company.cnpj
    $headers = $null
    $canConfirm = $false
    $version = 'v3'
    if ($payments.Count) {
        if ($payments.cnpj -cne $company.cnpj -or [string]$payments.accountNumber -cne $account -or
            [string]$payments.cooperative -notmatch '^[0-9]{1,4}$' -or -not $payments.clientId -or
            ($payments.apiVersion -and $payments.apiVersion -cnotin 'v3','v4')) { throw 'DDA_PAYMENT_CONFIGURATION_MISMATCH' }
        $headers = Get-ScopeHeaders $payments.clientId 'pagamentos_consulta pagamentos_inclusao'
        if ($headers) {
            $canConfirm = $true
            if ($payments.apiVersion) { $version = $payments.apiVersion }
            $identity = "$($payments.clientId)|$account|$($payments.cooperative)|$version"
            $configuration = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($identity)))
        }
    }
    if ($Operation -eq 'quote' -and -not $headers) { $headers = Get-ScopeHeaders $company.clientId 'pagamentos_consulta' }
    if (-not $headers) { throw 'DDA_PAYMENT_AUTH_UNAVAILABLE' }
    $api = "https://api.sicoob.com.br/pagamentos/$version"

    $result = switch ($Operation) {
        'quote' {
            if (Get-PendingBankOrder) { @{status='already_scheduled'}; break }
            $response = Invoke-Bank GET "/boletos/${barcode}?numeroConta=$account&dataPagamento=$($inputData.date)" $headers
            if ($response.StatusCode -in 400,404,406) { @{status='unavailable'}; break }
            if ($response.StatusCode -ne 200) { throw 'DDA_QUOTE_FAILED' }
            $bank = ($response.Content | ConvertFrom-Json -AsHashtable).resultado
            if ($bank.bloquearPagamento -ne $false -or $bank.consultaEmContingencia -ne $false -or
                [string]$bank.codigoSituacaoBoletoPagamento -ne '12' -or $bank.codigoBarras -cne $barcode -or
                $bank.dataVencimentoBoleto -cne $inputData.due -or $bank.dataPagamento -cne $inputData.date -or
                $bank.numeroCpfCnpjPagador -cne $company.cnpj -or [string]::IsNullOrWhiteSpace($bank.nomeRazaoSocialBeneficiario) -or
                [string]::IsNullOrWhiteSpace($bank.nomeRazaoSocialPagador) -or [string]::IsNullOrWhiteSpace($bank.identificadorConsulta)) {
                @{status='unavailable'}; break
            }
            $quoted = @{status='quoted'; date=$inputData.date; amountCents=(Get-AmountCents $bank.valorPagamento);
                beneficiary=$bank.nomeRazaoSocialBeneficiario; canConfirm=$canConfirm}
            if ($canConfirm) {
                $quoted.configuration = $configuration
                $quoted.bankQuote = @{identificadorConsulta=$bank.identificadorConsulta;
                    valorBoleto=[decimal]$bank.valorBoleto; valorDescontoAbatimento=[decimal]$bank.valorAbatimentoDesconto;
                    valorMultaMora=[decimal]$bank.valorMultaMora; nomePortador=$bank.nomeRazaoSocialPagador}
            }
            $quoted
        }
        default {
            if (-not $canConfirm -or $inputData.configuration -cne $configuration -or
                $inputData.orderKey -notmatch '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$') { throw 'DDA_PAYMENT_AUTH_UNAVAILABLE' }
            $orderKey = "$($payments.cooperative)-$account-$($inputData.orderKey)"
            if ($Operation -eq 'lookup') {
                Get-ReceiptState (Invoke-Bank GET "/boletos/pagamentos/$orderKey/idempotency/comprovantes" $headers)
                break
            }
            if (Get-PendingBankOrder) { @{status='not_sent'}; break }
            $today = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, 'America/Sao_Paulo').ToString('yyyy-MM-dd')
            if ([string]::CompareOrdinal($inputData.date,$today) -le 0) { @{status='not_sent'}; break }
            $data = $inputData.bankQuote
            $data.aceitaValorDivergente = $false
            $data.numeroCpfCnpjPortador = $company.cnpj
            $data.amount = [decimal]$inputData.amountCents / 100
            $data.date = $inputData.date
            $data.debtorAccount = @{issuer=[int]$payments.cooperative; number=[long]$account; accountType=0; personType=1}
            $headers['x-idempotency-key'] = $orderKey
            $submitted = $true
            Get-ReceiptState (Invoke-Bank POST "/boletos/pagamentos/$barcode" $headers $data)
        }
    }
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 8 -Compress))
} catch {
    if ($Operation -eq 'dispatch' -and -not $submitted) { [Console]::Out.WriteLine('{"status":"not_sent"}'); exit 0 }
    if ($Operation -ne 'quote') { [Console]::Out.WriteLine('{"status":"pending"}'); exit 0 }
    exit 1
} finally {
    if ($certificate) { $certificate.Dispose() }
}
