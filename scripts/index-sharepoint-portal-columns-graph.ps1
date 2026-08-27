#requires -Version 7.0

[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$TenantId = "0c10f511-7ede-4702-a2d9-bedb26937e0e",
  [string]$ClientId = "94018e25-f756-4aa6-974e-27b8b43d7fe9",
  [int]$LoginTimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"

# These are the fields the portal uses for combobox searches, gallery filters,
# and ordering. Only fields that actually exist are considered.
$portalColumns = @(
  "Title", "FILIAL", "STATUS", "FORNECEDOR", "CLIENTE", "IMOVEL",
  "PRODUTO", "ETAPA", "RESPONSAVEL", "OBRA", "DATA", "MODIFIED",
  "CPF_CNPJ", "EMAIL", "DOCUMENTO", "CONTRATO", "TAREFA", "INQUILINO",
  "PEDIDO", "DESCRICAO", "DESCRIÇÃO", "TIPO", "TIPO DESPESA",
  "CONCLUÍDO", "CONCLUIDO", "HOMOLOGACAO", "NOME", "RG", "TELEFONE",
  "TICKETCODIGO", "CLIENTEID", "CLIENTENOME", "CLIENTEEMAIL",
  "ULTIMAACAOPOR", "ULTIMAMENSAGEM", "SUPERBASETICKETID"
)
# Fallback para execuções em máquinas sem Node no PATH. A lista é gerada por
# powerapps-index-column-requirements.mjs a partir dos ComboBox reais do app.
$portalColumns += @(
  "ACR_x00c9_SCIMO", "ACUMULADO", "APROVADO", "ASSINATURA", "ASSOCIAÇÃO",
  "ATIVIDADE", "ATIVIDADE EXECUTADA", "ATIVIDADEEXECUTADA", "CADASTRO", "CIDADE",
  "ComplianceAssetId", "CONTA", "CORRETOR", "DATA PGTO EFETUADO", "DESCRICAO",
  "DESCRICAOIMOVEL", "DIFICULDADE", "EMPREITEIRO", "ETAPA", "FAMÍLIA", "field_1",
  "field_3", "FORMAPGTO", "FUNCAO", "GRUPO", "GRUPOIMOBILIZADOS", "HOMOLOGAÇÃO",
  "IDCONTRATO", "IMAGEM", "IMOBILIZADO", "IMPACTO", "IMÓVEL ADQUIRIDO", "INQUILINO",
  "MOTIVOBAIXA", "NOME", "NOME INQUILINO", "NOMECORRETORA", "NUMEROCONTRATO",
  "PATOLOGIA", "PESSOARELACIONADA", "PROFISS_x00c3_O", "PROFISSÃO",
  "SUBFAMÍLIAS CADASTRADAS", "TIPO DE TRANSAÇAO", "TIPODOCUMENTO", "TIPOHOMOLOGACAO",
  "TIPOINCONSISTENCIA3", "TIPOMARCO", "Título", "UNIDADE MEDIDA", "URGÊNCIA"
)

$requirementsScript = Join-Path $PSScriptRoot "powerapps-index-column-requirements.mjs"
if (Test-Path $requirementsScript) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    try {
      $powerAppsColumns = @((& $node.Source $requirementsScript | ConvertFrom-Json))
      $portalColumns += $powerAppsColumns
      Write-Host "Campos adicionais descobertos nos contratos Power Apps: $($powerAppsColumns.Count)" -ForegroundColor DarkGray
    }
    catch {
      Write-Warning "Nao foi possivel ler os contratos Power Apps; sera usada a lista de campos base. $($_.Exception.Message)"
    }
  }
}

function Normalize-ColumnName {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
  $normalized = $Value.Normalize([Text.NormalizationForm]::FormD) -replace '\p{M}', ''
  return $normalized -replace '[^A-Za-z0-9]', ''
}

function ConvertTo-Base64Url {
  param([byte[]]$Bytes)
  return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-PortalGraphToken {
  param([string]$Tenant, [string]$ApplicationId, [int]$TimeoutSeconds)

  $port = 18420
  $redirectUri = "http://localhost:$port/"
  $listener = [System.Net.HttpListener]::new()
  $listener.Prefixes.Add($redirectUri)
  $listener.Start()

  try {
    $verifier = ConvertTo-Base64Url ([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
    $challenge = ConvertTo-Base64Url ([Security.Cryptography.SHA256]::HashData([Text.Encoding]::ASCII.GetBytes($verifier)))
    $scope = "openid profile offline_access https://graph.microsoft.com/Sites.Manage.All"
    $parameters = @{
      client_id = $ApplicationId
      response_type = "code"
      redirect_uri = $redirectUri
      response_mode = "query"
      scope = $scope
      code_challenge = $challenge
      code_challenge_method = "S256"
      prompt = "select_account"
    }.GetEnumerator() | ForEach-Object {
      "{0}={1}" -f [uri]::EscapeDataString($_.Key), [uri]::EscapeDataString($_.Value)
    }
    $authorizeUri = "https://login.microsoftonline.com/$Tenant/oauth2/v2.0/authorize?" + ($parameters -join '&')

    Write-Host "Abrindo a autenticacao Microsoft para indexar as listas..." -ForegroundColor Cyan
    Start-Process $authorizeUri
    $contextTask = $listener.GetContextAsync()
    if (-not $contextTask.Wait([TimeSpan]::FromSeconds($TimeoutSeconds))) {
      throw "A autenticacao Microsoft nao foi concluida dentro do prazo."
    }

    $context = $contextTask.Result
    $query = [System.Web.HttpUtility]::ParseQueryString($context.Request.Url.Query)
    $responseText = "Autenticacao concluida. Esta janela pode ser fechada."
    $buffer = [Text.Encoding]::UTF8.GetBytes($responseText)
    $context.Response.ContentType = "text/plain; charset=utf-8"
    $context.Response.ContentLength64 = $buffer.Length
    $context.Response.OutputStream.Write($buffer, 0, $buffer.Length)
    $context.Response.Close()

    if ($query["error"]) {
      throw "A autenticacao Microsoft foi recusada: $($query['error_description'])"
    }
    if (-not $query["code"]) { throw "A Microsoft nao retornou o codigo de autenticacao." }

    $tokenResponse = Invoke-RestMethod -Method Post -ContentType "application/x-www-form-urlencoded" `
      -Uri "https://login.microsoftonline.com/$Tenant/oauth2/v2.0/token" `
      -Body @{
        client_id = $ApplicationId
        grant_type = "authorization_code"
        code = $query["code"]
        redirect_uri = $redirectUri
        code_verifier = $verifier
      }
    return $tokenResponse.access_token
  }
  finally {
    if ($listener.IsListening) { $listener.Stop() }
    $listener.Close()
  }
}

function Get-GraphCollection {
  param([string]$Uri, [hashtable]$Headers)
  $items = @()
  do {
    $response = Invoke-RestMethod -Headers $Headers -Uri $Uri -Method Get
    $items += @($response.value)
    $Uri = $response.'@odata.nextLink'
  } while ($Uri)
  return $items
}

$indexedNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$portalColumns | ForEach-Object { [void]$indexedNames.Add((Normalize-ColumnName $_)) }

$token = Get-PortalGraphToken -Tenant $TenantId -ApplicationId $ClientId -TimeoutSeconds $LoginTimeoutSeconds
$headers = @{ Authorization = "Bearer $token"; Accept = "application/json"; "Content-Type" = "application/json" }
$sites = @(
  @{ Host = "energeticaltda.sharepoint.com"; Path = "/sites/energetica" },
  @{ Host = "energeticaltda-my.sharepoint.com"; Path = "/personal/bernardonotini_energeticabr_com" }
)

$updated = 0
$alreadyIndexed = 0
$skipped = 0
foreach ($siteConfig in $sites) {
  $siteUri = "https://graph.microsoft.com/v1.0/sites/$($siteConfig.Host):$($siteConfig.Path)?`$select=id,displayName,webUrl"
  $site = Invoke-RestMethod -Headers $headers -Uri $siteUri -Method Get
  Write-Host "`nVerificando $($site.webUrl)" -ForegroundColor Cyan

  $listsUri = "https://graph.microsoft.com/v1.0/sites/$($site.id)/lists?`$select=id,displayName,webUrl"
  $lists = Get-GraphCollection -Uri $listsUri -Headers $headers
  foreach ($list in $lists) {
    $columnsUri = "https://graph.microsoft.com/v1.0/sites/$($site.id)/lists/$($list.id)/columns?`$top=999"
    $columns = Get-GraphCollection -Uri $columnsUri -Headers $headers
    $candidates = $columns | Where-Object {
      $name = Normalize-ColumnName $_.name
      $displayName = Normalize-ColumnName $_.displayName
      ($indexedNames.Contains($name) -or $indexedNames.Contains($displayName)) -and
      -not $_.hidden -and -not $_.readOnly -and -not $_.computed
    }

    foreach ($column in $candidates) {
      $label = "$($list.displayName) / $($column.displayName)"
      if ($column.indexed -eq $true) {
        $alreadyIndexed++
        Write-Host "  OK        $label" -ForegroundColor DarkGray
        continue
      }

      if ($PSCmdlet.ShouldProcess($label, "Criar indice SharePoint")) {
        try {
          $updateUri = "https://graph.microsoft.com/v1.0/sites/$($site.id)/lists/$($list.id)/columns/$($column.id)"
          Invoke-RestMethod -Headers $headers -Uri $updateUri -Method Patch -Body '{"indexed":true}' | Out-Null
          $verified = Invoke-RestMethod -Headers $headers -Uri "$($updateUri)?`$select=indexed,displayName" -Method Get
          if ($verified.indexed -ne $true) { throw "O SharePoint nao confirmou o indice." }
          $updated++
          Write-Host "  INDEXADO  $label" -ForegroundColor Green
        }
        catch {
          $skipped++
          Write-Warning "Nao foi possivel indexar $($label): $($_.Exception.Message)"
        }
      }
    }
  }
}

Write-Host "`nConcluido. Novos indices: $updated | Ja indexados: $alreadyIndexed | Nao aplicados: $skipped" -ForegroundColor Cyan
