#requires -Version 7.0

[CmdletBinding(SupportsShouldProcess)]
param(
  [switch]$InstallPnP,
  [string]$ClientId = "94018e25-f756-4aa6-974e-27b8b43d7fe9"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Module -ListAvailable -Name PnP.PowerShell)) {
  if (-not $InstallPnP) {
    throw "Instale o PnP.PowerShell ou execute novamente com -InstallPnP."
  }
  Install-Module PnP.PowerShell -Scope CurrentUser -Force -AllowClobber
}

Import-Module PnP.PowerShell

# Campos usados pelo portal em pesquisa, filtros e ordenacao das galerias.
# A rotina so altera uma coluna quando ela existe na lista e ainda nao esta indexada.
$portalColumns = @(
  "Title", "FILIAL", "STATUS", "FORNECEDOR", "CLIENTE", "IMOVEL",
  "PRODUTO", "ETAPA", "RESPONSAVEL", "OBRA", "DATA", "MODIFIED",
  "CPF_CNPJ", "EMAIL", "DOCUMENTO", "CONTRATO", "TAREFA", "INQUILINO",
  "PEDIDO", "DESCRICAO", "DESCRIÇÃO", "TIPO", "TIPO DESPESA",
  "CONCLUÍDO", "CONCLUIDO", "HOMOLOGACAO", "NOME", "RG", "TELEFONE"
)
$normalizedPortalColumns = [System.Collections.Generic.HashSet[string]]::new(
  [System.StringComparer]::OrdinalIgnoreCase
)
$portalColumns | ForEach-Object {
  $normalized = ([string]$_).Normalize([Text.NormalizationForm]::FormD) -replace '\p{M}', ''
  [void]$normalizedPortalColumns.Add(($normalized -replace '[^A-Za-z0-9]', ''))
}

$sites = @(
  "https://energeticaltda.sharepoint.com/sites/energetica",
  "https://energeticaltda-my.sharepoint.com/personal/bernardonotini_energeticabr_com"
)

foreach ($site in $sites) {
  Write-Host "`nConectando a $site" -ForegroundColor Cyan
  Connect-PnPOnline -Url $site -Interactive -ClientId $ClientId

  $lists = Get-PnPList | Where-Object { -not $_.Hidden }
  foreach ($list in $lists) {
    $fields = Get-PnPField -List $list.Title -Includes Indexed,InternalName,Hidden,ReadOnly,TypeAsString
    $candidates = $fields | Where-Object {
      $internal = (([string]$_.InternalName).Normalize([Text.NormalizationForm]::FormD) -replace '\p{M}', '') -replace '[^A-Za-z0-9]', ''
      $display = (([string]$_.Title).Normalize([Text.NormalizationForm]::FormD) -replace '\p{M}', '') -replace '[^A-Za-z0-9]', ''
      ($normalizedPortalColumns.Contains($internal) -or $normalizedPortalColumns.Contains($display)) -and
      -not $_.Hidden -and
      $_.TypeAsString -notin @("Computed", "Attachments")
    }

    foreach ($field in $candidates) {
      if ($field.Indexed -eq $true) {
        Write-Host "  OK  $($list.Title) / $($field.InternalName)" -ForegroundColor DarkGray
        continue
      }
      $target = "$($list.Title) / $($field.InternalName)"
      if ($PSCmdlet.ShouldProcess($target, "Criar indice SharePoint")) {
        Set-PnPField -List $list.Title -Identity $field.InternalName -Values @{ Indexed = $true }
        Write-Host "  INDEXADO  $target" -ForegroundColor Green
      }
    }
  }
}

Disconnect-PnPOnline
Write-Host "`nIndexacao concluida. Nenhum dado de item foi alterado." -ForegroundColor Cyan
