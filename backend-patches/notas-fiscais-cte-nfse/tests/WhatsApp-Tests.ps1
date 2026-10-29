$ErrorActionPreference='Stop'
$module=Join-Path $PSScriptRoot '../src/SefazWhatsApp.psm1'
if(-not (Test-Path -LiteralPath $module)){throw 'FALHOU: fila duravel WhatsApp ainda nao implementada'}
Import-Module $module -Force
Import-Module (Join-Path $PSScriptRoot '../src/Sefaz.psm1') -Force -DisableNameChecking
$root=Join-Path ([IO.Path]::GetTempPath()) ('sefaz-whatsapp-tests-'+[Guid]::NewGuid().ToString('N'))
$script:passed=0
function Assert-True($Value,[string]$Name){if(-not $Value){throw "FALHOU: $Name"};$script:passed++;Write-Host "PASS $Name"}
function Assert-Fails([scriptblock]$Action,[string]$Name){$failed=$false;try{& $Action}catch{$failed=$true};Assert-True $failed $Name}
try{
    $doc=ConvertFrom-FiscalXml ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fixtures/nfe-danfe-homologacao.xml'))) '000000000000001' '38626750000146'
    $pdf=[Text.Encoding]::ASCII.GetBytes("%PDF-1.4`nSYNTHETIC UNIT TEST ONLY`n%%EOF`n")
    $sha=[Security.Cryptography.SHA256]::Create()
    try{$digest=([BitConverter]::ToString($sha.ComputeHash($pdf))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
    $doc|Add-Member -NotePropertyName danfe -NotePropertyValue ([pscustomobject]@{fileName=('DANFE-'+$doc.key+'-'+$doc.sha256.Substring(0,16)+'.pdf');pdfBase64=[Convert]::ToBase64String($pdf);sha256=$digest})
    $receipt=[pscustomobject]@{source='SEFAZ';acknowledgedIds=@($doc.id)}
    $bad=[pscustomobject]@{source='SEFAZ';acknowledgedIds=@('other')}
    Assert-Fails {Save-SefazWhatsAppNotification @($doc) $bad $root} 'sem ACK fiscal exato nao existe notificacao'
    Assert-True (-not [IO.Directory]::Exists($root)) 'ACK invalido nao cria fila'
    $null=Save-SefazWhatsAppNotification @($doc) $receipt $root
    $path=Join-Path $root ($doc.key+'.json')
    $queued=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
    Assert-True ($queued.state -eq 'pending' -and $queued.request.document.danfe.pdfBase64 -ceq $doc.danfe.pdfBase64) 'fila persiste exatamente PDF confirmado'
    $null=Save-SefazWhatsAppNotification @($doc) $receipt $root
    Assert-True (@(Get-ChildItem -LiteralPath $root -Filter '*.json').Count -eq 1) 'mesma chave nao duplica fila'
    $script:stages=0;$script:drains=0
    $remote={param($Config,$Request) if($Request.mode -eq 'drain'){$script:drains++;return [pscustomobject]@{status='reconciled'}};$script:stages++;throw 'OFFLINE'}
    $cfg=[pscustomobject]@{whatsappEnabled=$true}
    $r=Invoke-SefazWhatsAppDrain $cfg $root $remote
    Assert-True ($r.status -eq 'retry' -and $script:stages -eq 1) 'falha remota fica para retomada sem lancar excecao fiscal'
    $queued=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
    Assert-True ($queued.state -eq 'pending' -and $queued.attempts -eq 1 -and $queued.code -eq 'WHATSAPP_RETRY') 'erro auditado sem corpo da excecao'
    $null=Invoke-SefazWhatsAppDrain $cfg $root $remote
    Assert-True ($script:stages -eq 1) 'backoff impede tentativas locais em loop'
    $queued.nextRetryAt='2000-01-01T00:00:00Z';$queued|ConvertTo-Json -Depth 35|Set-Content -LiteralPath $path -Encoding utf8
    $remote={param($Config,$Request) if($Request.mode -eq 'drain'){$script:drains++;return [pscustomobject]@{status='reconciled'}};$script:stages++;return [pscustomobject]@{status='staged';key=$Request.document.key;duplicate=$false}}
    $null=Invoke-SefazWhatsAppDrain $cfg $root $remote
    $null=Invoke-SefazWhatsAppDrain $cfg $root $remote
    Assert-True ($script:stages -eq 2 -and $script:drains -ge 2) 'aceite duravel remoto encerra reenvio e reconcilia em separado'
    $queued=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
    Assert-True ($queued.state -eq 'remote_staged') 'registro local distingue enfileirado de efetivamente enviado'
    $queued.state='pending';$queued.nextRetryAt=$null;$queued|ConvertTo-Json -Depth 35|Set-Content -LiteralPath $path -Encoding utf8
    $null=Invoke-SefazWhatsAppDrain $cfg $root {param($Config,$Request);if($Request.mode -eq 'drain'){return [pscustomobject]@{status='reconciled'}};return [pscustomobject]@{status='retention_queued';key=$Request.document.key;duplicate=$true}}
    $queued=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
    Assert-True ($queued.state -eq 'remote_staged') 'retomada com aviso de retencao ja enfileirado nao reenvia nota'
    $disabled=[pscustomobject]@{whatsappEnabled=$false}
    $r=Invoke-SefazWhatsAppDrain $disabled $root {throw 'NAO_DEVE_CHAMAR'}
    Assert-True ($r.status -eq 'disabled') 'recurso desabilitado nao abre SSH'
    Import-Module (Join-Path $PSScriptRoot '../src/FlowTransport.psm1') -Force -DisableNameChecking
    $flowRoot=Join-Path $root 'flow-hook'
    Assert-Fails {Complete-SefazFlowDelivery @($doc) $bad 'run1' $cfg $flowRoot} 'hook fiscal bloqueia notificacao sem recibo exato'
    $completed=Complete-SefazFlowDelivery @($doc) $receipt 'run1' $cfg $flowRoot
    Assert-True ($completed.acknowledgedIds[0] -ceq $doc.id -and (Test-Path -LiteralPath (Join-Path $flowRoot ($doc.key+'.json')))) 'hook retorna ACK somente com notificacao duravel local'
    $doc.danfe.sha256='0'*64
    $null=Save-SefazWhatsAppNotification @($doc) $receipt $root
    $original=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
    Assert-True ($original.request.document.danfe.sha256 -ceq $digest) 'atualizacao da mesma chave preserva primeira notificacao sem bloquear ACK fiscal'
    $scopeRoot=Join-Path $root 'scope'
    Import-Module (Join-Path $PSScriptRoot '../src/Sefaz.psm1') -Force -DisableNameChecking
    $oldXml=([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fixtures/nfe-danfe-homologacao.xml'))).Replace('2026-10-20T12:00:00-03:00','2026-09-30T23:30:00-03:00')
    $oldDoc=ConvertFrom-FiscalXml $oldXml '000000000000002' '38626750000146'
    $oldDoc|Add-Member -NotePropertyName danfe -NotePropertyValue $doc.danfe
    Save-SefazWhatsAppNotification @($oldDoc) ([pscustomobject]@{source='SEFAZ';acknowledgedIds=@($oldDoc.id)}) $scopeRoot
    $scopeCfg=[pscustomobject]@{whatsappEnabled=$true;minimumIssueDate='2026-10-01'}
    $script:scopeStages=0
    $null=Invoke-SefazWhatsAppDrain $scopeCfg $scopeRoot {param($Config,$Request);if($Request.mode -eq 'stage'){$script:scopeStages++};return [pscustomobject]@{status='reconciled'}}
    $scopeItem=Get-Content -LiteralPath (Join-Path $scopeRoot ($oldDoc.key+'.json')) -Raw|ConvertFrom-Json
    Assert-True ($script:scopeStages -eq 0 -and $scopeItem.state -eq 'scope_excluded') 'old pending notification retained without remote staging'
    Assert-True ($scopeItem.request.document.xmlBase64 -ceq $oldDoc.xmlBase64) 'excluded notification preserves original fiscal bytes'
    Write-Host "RESULTADO: $script:passed verificacoes WhatsApp aprovadas."
}finally{
    if([IO.Directory]::Exists($root)){$resolved=[IO.Path]::GetFullPath($root);$base=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/');if((Split-Path $resolved -Parent) -cne $base -or (Split-Path $resolved -Leaf) -notlike 'sefaz-whatsapp-tests-*'){throw 'UNSAFE_TEST_CLEANUP'};Remove-Item -LiteralPath $resolved -Recurse -Force}
}
