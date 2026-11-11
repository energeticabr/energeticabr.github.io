param([ValidateSet('Check','Register')][string]$Mode='Check')
$ErrorActionPreference='Stop'
$env:DDA_PRIVATE_ROOT='/var/lib/energetica-whatsapp/dda-collector'
$collector='/opt/energetica-whatsapp/dda-collector'
. (Join-Path $collector 'DdaPlatform.ps1')
. (Join-Path $collector 'DdaBankHttp.ps1')
function Read-ResponseJson($Response) {
 $content=if($Response.Content -is [byte[]]){[Text.Encoding]::UTF8.GetString($Response.Content)}else{[string]$Response.Content}
 return ConvertFrom-Json -InputObject $content -DateKind String
}
function Get-WebhookConfiguration($Uri,$Certificate,$Headers) {
 # Newly activated applications can alternate valid responses and gateway 401.
 # Retry reads only, with a fixed bound; never infer success from authorization.
 for($attempt=1;$attempt -le 5;$attempt++){
  $result=Invoke-WebRequest -Uri $Uri -Certificate $Certificate -Headers $Headers -TimeoutSec 20 -MaximumRedirection 0 -SkipHttpErrorCheck
  if($result.StatusCode -ne 401 -or $attempt -eq 5){return $result}
  Start-Sleep -Seconds (2*$attempt)
 }
}
$config=Read-PrivateJson (Join-Path $env:DDA_PRIVATE_ROOT 'sharepoint-bank-credentials.dpapi')
$dedicated=Read-PrivateJson (Join-Path $env:DDA_PRIVATE_ROOT 'sicoob-webhook-credentials.dpapi')
if (!$dedicated.Count) {$dedicated=Read-PrivateJson (Join-Path $env:DDA_PRIVATE_ROOT 'sicoob-movements-credentials.dpapi')}
if (!$dedicated.Count -or $dedicated.cnpj -cne $config.cnpj -or $dedicated.accountNumber -cne $config.accountNumber){throw 'SICOOB_ACCOUNT_MISMATCH'}
$cert=Get-CompanyClientCertificate -Cnpj $config.cnpj
try {
 $scope='pixpagamentos_webhook'
 $response=Invoke-WebRequest -Method Post -Uri 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token' -Certificate $cert -ContentType 'application/x-www-form-urlencoded' -TimeoutSec 20 -MaximumRedirection 0 -SkipHttpErrorCheck -Body @{grant_type='client_credentials';client_id=$dedicated.clientId;scope=$scope}
 if($response.StatusCode -ne 200){
  $errorName=(Read-ResponseJson $response).error
  @{token_http=[int]$response.StatusCode; error=$errorName; registered=$false}|ConvertTo-Json -Compress
  exit 2
 }
 $token=Read-ResponseJson $response
 if(($token.scope -split ' ') -notcontains $scope){throw 'WEBHOOK_SCOPE_MISSING'}
 $headers=@{Authorization='Bearer '+$token.access_token; client_id=$dedicated.clientId; Accept='application/json'}
 $uri='https://api.sicoob.com.br/pix-pagamentos/v2/pagamentos/webhook'
 $response=Get-WebhookConfiguration -Uri $uri -Certificate $cert -Headers $headers
 $current=$null
 if($response.StatusCode -eq 200){
  $current=Read-ResponseJson $response
  if($current.resultado){$current=$current.resultado}
 }
 if($Mode -eq 'Check'){
  @{token_http=200;scope_granted=$true;webhook_http=[int]$response.StatusCode;configured=[bool]$current.webhookUrl}|ConvertTo-Json -Compress
  exit 0
 }
 if($response.StatusCode -notin @(200,404)){throw 'WEBHOOK_CONFIGURATION_UNAVAILABLE'}
 $secret=(Get-Content -LiteralPath '/var/lib/energetica-sicoob-movements/pix-events/callback-token' -Raw).Trim()
 if($secret -cnotmatch '^[A-Za-z0-9_-]{43}$'){throw 'INVALID_CALLBACK_CONFIG'}
 $desired='https://163-176-171-217.sslip.io/api/sicoob-pix/'+$secret
 if($current -and (!$current.webhookUrl -or $current.webhookUrl.TrimEnd('/') -cne $desired)){throw 'EXISTING_CALLBACK_PRESERVED'}
 $health=Invoke-RestMethod -Uri 'https://163-176-171-217.sslip.io/api/sicoob-pix/health' -TimeoutSec 10 -MaximumRedirection 0
 if($health.status -cne 'ok'){throw 'CALLBACK_HEALTH_FAILED'}
 if(!$current){
  Start-Sleep -Milliseconds 1100
  $response=Invoke-WebRequest -Method Put -Uri $uri -Certificate $cert -Headers $headers -ContentType 'application/json' -Body (@{webhookUrl=$desired}|ConvertTo-Json -Compress) -TimeoutSec 20 -MaximumRedirection 0 -SkipHttpErrorCheck
  if($response.StatusCode -notin @(200,201)){throw 'WEBHOOK_REGISTRATION_FAILED'}
 }
 Start-Sleep -Milliseconds 1100
 $response=Get-WebhookConfiguration -Uri $uri -Certificate $cert -Headers $headers
 if($response.StatusCode -ne 200){throw 'WEBHOOK_READBACK_FAILED'}
 $verified=Read-ResponseJson $response
 if($verified.resultado){$verified=$verified.resultado}
 if(!$verified.webhookUrl -or $verified.webhookUrl.TrimEnd('/') -cne $desired){throw 'WEBHOOK_READBACK_MISMATCH'}
 @{token_http=200;scope_granted=$true;registered=$true;verified=$true}|ConvertTo-Json -Compress
} finally {$cert.Dispose()}
