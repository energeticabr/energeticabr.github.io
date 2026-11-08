param([Parameter(Mandatory)][string]$CollectorPath)
$ErrorActionPreference='Stop'
$env:DDA_PRIVATE_ROOT=$PSScriptRoot
Import-Module (Join-Path $CollectorPath 'DdaMonitor.psm1') -DisableNameChecking
Remove-Item Env:DDA_PRIVATE_ROOT
$credentials=@{clientId='fixture';accountNumber='1';cnpj=('1'*14)}
$today=[datetime]'2009-12-16'
$first='2009-10-19:2009-11-17'
$second='2009-11-18:2009-12-16'
$whole='2009-10-19:2009-12-16'
function Check($value,[string]$message){if(-not $value){throw $message}}
function MakeBill([string]$code,[int]$status){
 [pscustomobject]@{dataVencimentoBoleto='2009-12-16';codigoTipoSituacaoBoleto=$status;numeroCpfCnpjPagador=('1'*14);numeroCodigoBarras=($code*44)}
}
foreach($case in @('healthy','network_recovery','second_half_fails','tls_fails','token_fails')){
 $calls=[Collections.Generic.List[string]]::new()
 $transport={
  param($request)
  if($request.Method -eq 'POST'){
   $calls.Add('oauth')
   if($case -eq 'token_fails'){throw [Net.Http.HttpRequestException]::new('simulated OAuth network failure')}
   return @{access_token='fixture';expires_in=3600}
  }
  if($request.Uri -notmatch 'dataInicial=([0-9-]+)&dataFinal=([0-9-]+)&situacao=3&tipoData=3'){throw 'BAD_QUERY'}
  $range=$Matches[1]+':'+$Matches[2]
  $calls.Add($range)
  if($range -eq $whole -and $case -eq 'tls_fails'){throw [Security.Authentication.AuthenticationException]::new('simulated TLS failure')}
  if(($range -eq $whole -and $case -in @('network_recovery','second_half_fails')) -or ($range -eq $second -and $case -eq 'second_half_fails')){
   throw [Net.Http.HttpRequestException]::new('simulated response ended prematurely')
  }
  if($range -eq $whole){return [pscustomobject]@{resultado=@((MakeBill '1' 3),(MakeBill '2' 3))}}
  if($range -eq $first){return [pscustomobject]@{resultado=@((MakeBill '1' 3),(MakeBill '9' 1))}}
  if($range -eq $second){return [pscustomobject]@{resultado=@((MakeBill '1' 3),(MakeBill '2' 3))}}
  throw 'UNEXPECTED_RANGE'
 }
 $received=[Collections.Generic.List[object]]::new()
 $failure=$null
 try{Invoke-SicoobDdaQuery -Credentials $credentials -Today $today -AllOpen -Situacao 3 -Transport $transport -Wait {} | ForEach-Object {$received.Add($_)}}catch{$failure=$_.Exception}
 switch($case){
  'healthy' {Check ($null -eq $failure -and $received.Count -eq 2 -and ($calls -join ',') -eq "oauth,$whole") 'Healthy read changed'}
  'network_recovery' {
   Check ($null -eq $failure -and $received.Count -eq 2) 'Transient network failure did not recover the complete result'
   Check ((@($calls|Where-Object {$_ -eq $whole})).Count -eq 4) 'Normal retry policy changed'
   Check (($calls -contains $first) -and ($calls -contains $second)) 'Fallback ranges have a gap or overlap'
  }
  'second_half_fails' {
   Check ($failure.Message -eq 'BANK_QUERY_FAILED' -and $received.Count -eq 0) 'Incomplete snapshot escaped'
   Check ($failure.Data['BankQueryStart'] -eq '2009-11-18' -and $failure.Data['BankQueryEnd'] -eq '2009-12-16') 'Failed half missing from diagnostics'
   Check (($calls|Select-Object -Unique).Count -eq 4) 'Fallback split recursively'
  }
  'tls_fails' {Check ($failure.Data['BankFailureKind'] -eq 'TLS_FAILURE' -and $calls.Count -eq 2 -and $received.Count -eq 0) 'TLS failure was retried or hidden'}
  'token_fails' {Check ($failure.Data['BankFailureKind'] -eq 'TRANSIENT_NETWORK' -and $calls.Count -eq 4 -and $received.Count -eq 0) 'OAuth failure triggered range fallback'}
 }
 Write-Output "PASS $case"
}
