$ErrorActionPreference='Stop'
$env:DDA_PRIVATE_ROOT='/var/lib/energetica-whatsapp/dda-collector'
$collector='/opt/energetica-whatsapp/dda-collector'
. (Join-Path $collector 'DdaPlatform.ps1')
. (Join-Path $collector 'DdaBankHttp.ps1')
$config=Read-PrivateJson (Join-Path $env:DDA_PRIVATE_ROOT 'sharepoint-bank-credentials.dpapi')
$dedicated=Read-PrivateJson (Join-Path $env:DDA_PRIVATE_ROOT 'sicoob-movements-credentials.dpapi')
if (!$dedicated.Count -or $dedicated.cnpj -cne $config.cnpj -or $dedicated.accountNumber -cne $config.accountNumber) { throw 'Aplicativo dedicado indisponivel' }
$cert=Get-CompanyClientCertificate -Cnpj $config.cnpj
try {
 $scope='pixpagamentos_consulta'
 $token=Invoke-RestMethod -Method Post -Uri 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token' -Certificate $cert -ContentType 'application/x-www-form-urlencoded' -TimeoutSec 20 -MaximumRedirection 0 -Body @{grant_type='client_credentials';client_id=$dedicated.clientId;scope=$scope}
 if (($token.scope -split ' ') -notcontains $scope){throw 'Escopo ausente'}
 $headers=@{Authorization='Bearer '+$token.access_token;client_id=$dedicated.clientId;Accept='application/json'}
 $req=ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
 if ($req.account -cne $config.accountNumber) { throw 'SICOOB_PIX_ACCOUNT_MISMATCH' }
 $results=[ordered]@{}
 foreach($id in $req.ids){
  if($id -notmatch '^E[0-9]{20}[a-zA-Z0-9]{11}$'){continue}
  $uri="https://api.sicoob.com.br/pix-pagamentos/v2/pagamentos/$id"
  for($attempt=1;$attempt -le 4;$attempt++){
   $res=Invoke-WebRequest -Uri $uri -Certificate $cert -Headers $headers -TimeoutSec 20 -MaximumRedirection 0 -SkipHttpErrorCheck
   if ($res.StatusCode -eq 429 -and $attempt -eq 1) {
    $retryAfter = [string]($res.Headers['Retry-After'] | Select-Object -First 1)
    $seconds = 0
    $retryDate = [datetimeoffset]::MinValue
    if (-not [int]::TryParse($retryAfter, [ref]$seconds)) {
     $seconds = if ([datetimeoffset]::TryParse($retryAfter, [ref]$retryDate)) {
      [math]::Ceiling(($retryDate - [datetimeoffset]::UtcNow).TotalSeconds)
     } else { 60 }
    }
    if ($seconds -gt 90) { break }
    Start-Sleep -Seconds ([math]::Max(1, $seconds))
    continue
   }
   if($res.StatusCode -ne 403 -or $res.Content -notmatch 'Not registered to plan' -or $attempt -eq 4){break}
   Start-Sleep -Seconds $attempt
  }
  $results[$id]=@{status=[int]$res.StatusCode; result=$(if($res.StatusCode -eq 200){ConvertFrom-Json -DateKind String -InputObject $res.Content})}
  if ($res.StatusCode -eq 429) { break }
 }
 @{payer_document=$config.cnpj;results=$results}|ConvertTo-Json -Depth 10 -Compress
} finally { $cert.Dispose() }
