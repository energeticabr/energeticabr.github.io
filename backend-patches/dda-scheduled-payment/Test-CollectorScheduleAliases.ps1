param([Parameter(Mandatory)][string]$CollectorPath)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $CollectorPath 'DdaMonitor.psm1') -Force
Import-Module (Join-Path $CollectorPath 'DdaSharePoint.psm1') -Force -DisableNameChecking
$payer='11111111000191'
$code='1'*44
$item=@{Id=8;CHAVE_DDA=(Get-DdaHash ($payer+'|CIP:12345'));CNPJ_PAGADOR=$payer;CODIGO_BARRAS=$code}
function BankRow($status,$description,$owner=$payer){
 [pscustomobject]@{numeroCodigoBarras=$code;numeroCpfCnpjPagador=$owner;numeroIdentificadorBoletoCip='12345';codigoTipoSituacaoBoleto=$status;descricaoSituacaoBoleto=$description;dataVencimentoBoleto='2026-11-09'}
}
$scheduled=BankRow 99 'Agendado'
$paid=BankRow 23 'Liquidado'
$unknown=BankRow 99 'Outro'
$differentOwner=BankRow 99 'Agendado' '22222222000191'
$fixtures=@($scheduled,$paid,$unknown,$differentOwner)
$transport={param($request)
 if($request.Method -eq 'POST'){return @{access_token='FAKE';expires_in=300}}
 [pscustomobject]@{resultado=$fixtures}
}.GetNewClosure()
$query=@{Credentials=@{clientId='FAKE';accountNumber='123';cnpj=$payer};Today=[datetime]'2009-11-01';AllOpen=$true;Transport=$transport;Wait={}}
$scheduledRows=@(Invoke-SicoobDdaQuery @query -Situacao 2)
$paidRows=@(Invoke-SicoobDdaQuery @query -Situacao 3)
if($scheduledRows.Count -ne 1 -or $scheduledRows[0].codigoTipoSituacaoBoleto -ne 99 -or (Get-DdaReconciledStatus $item $scheduledRows).status -ne 'Agendado'){throw 'SCHEDULE_ALIAS_NOT_RECONCILED'}
if($paidRows.Count -ne 1 -or $paidRows[0].codigoTipoSituacaoBoleto -ne 23 -or (Get-DdaReconciledStatus $item $paidRows).status -ne 'Pago'){throw 'PAID_ALIAS_NOT_RECONCILED'}
if((Get-DdaReconciledStatus $item $fixtures).confirmed){throw 'CONFLICT_MARKED_CONFIRMED'}
$script:testItem=$item
$script:writeAttempts=0
$receipt=Invoke-DdaStatusReconciliation -BankRows $scheduledRows -Remote {param($request)
 if($request.mode -eq 'list'){return @{value=@($script:testItem)}}
 $script:writeAttempts++
 if($script:writeAttempts -eq 1){throw 'SIMULATED_CONCURRENT_EDIT'}
 @{Id=$request.id;STATUS_DDA=$request.status;STATUS_CONSULTADO_EM=$request.checkedAt}
}
if($receipt.verified -ne 1 -or $script:writeAttempts -ne 2){throw 'STATUS_WRITE_RETRY_FAILED'}
'PASS: OCI bank response variants survive the scan, are reconciled, and ambiguous evidence is rejected.'
