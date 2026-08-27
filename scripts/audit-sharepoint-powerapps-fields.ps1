#requires -Version 7.0

[CmdletBinding()]
param(
  [string]$TenantId = "0c10f511-7ede-4702-a2d9-bedb26937e0e",
  [string]$ClientId = "94018e25-f756-4aa6-974e-27b8b43d7fe9",
  [string]$HostName = "energeticaltda-my.sharepoint.com",
  [string]$SitePath = "/personal/bernardonotini_energeticabr_com",
  [int]$Port = 18421,
  [int]$LoginTimeoutSeconds = 900,
  [string]$OutputPath = "$env:TEMP\energetica-sharepoint-fields-audit.json",
  [string]$SamplesOutputPath = "$env:TEMP\energetica-sharepoint-options-audit.json",
  [string]$SecurityOutputPath = "$env:TEMP\energetica-sharepoint-security-audit.json"
)

$ErrorActionPreference = "Stop"

function ConvertTo-Base64Url {
  param([byte[]]$Bytes)
  return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-SharePointToken {
  $redirectUri = "http://localhost:$Port/"
  $listener = [Net.HttpListener]::new()
  $listener.Prefixes.Add($redirectUri)
  $listener.Start()
  try {
    $verifier = ConvertTo-Base64Url ([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
    $challenge = ConvertTo-Base64Url ([Security.Cryptography.SHA256]::HashData([Text.Encoding]::ASCII.GetBytes($verifier)))
    $scope = "openid profile offline_access https://$HostName/AllSites.Read"
    $parameters = @{
      client_id = $ClientId
      response_type = "code"
      redirect_uri = $redirectUri
      response_mode = "query"
      scope = $scope
      code_challenge = $challenge
      code_challenge_method = "S256"
      prompt = "none"
    }.GetEnumerator() | ForEach-Object {
      "{0}={1}" -f [uri]::EscapeDataString($_.Key), [uri]::EscapeDataString($_.Value)
    }
    $authorizeUri = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/authorize?" + ($parameters -join '&')
    Write-Host "Abrindo a autenticacao Microsoft para auditar as fontes SharePoint..." -ForegroundColor Cyan
    Start-Process $authorizeUri
    $contextTask = $listener.GetContextAsync()
    if (-not $contextTask.Wait([TimeSpan]::FromSeconds($LoginTimeoutSeconds))) {
      throw "A autenticacao Microsoft nao foi concluida dentro do prazo."
    }
    $context = $contextTask.Result
    $query = [Web.HttpUtility]::ParseQueryString($context.Request.Url.Query)
    $message = [Text.Encoding]::UTF8.GetBytes("Autenticacao concluida. Esta aba pode ser fechada.")
    $context.Response.ContentType = "text/plain; charset=utf-8"
    $context.Response.ContentLength64 = $message.Length
    $context.Response.OutputStream.Write($message, 0, $message.Length)
    $context.Response.Close()
    if ($query["error"]) { throw "A autenticacao foi recusada: $($query['error_description'])" }
    if (-not $query["code"]) { throw "A Microsoft nao retornou o codigo de autenticacao." }
    return (Invoke-RestMethod -Method Post -ContentType "application/x-www-form-urlencoded" `
      -Uri "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token" `
      -Body @{
        client_id = $ClientId
        grant_type = "authorization_code"
        code = $query["code"]
        redirect_uri = $redirectUri
        code_verifier = $verifier
      }).access_token
  }
  finally {
    if ($listener.IsListening) { $listener.Stop() }
    $listener.Close()
  }
}

function Get-RestCollection {
  param([string]$Uri, [hashtable]$Headers)
  $items = @()
  do {
    $response = Invoke-RestMethod -Headers $Headers -Uri $Uri -Method Get
    if ($response -is [string]) { $response = $response | ConvertFrom-Json -AsHashtable }
    $items += @($response.value ?? $response.d.results)
    $Uri = $response.'odata.nextLink' ?? $response.'@odata.nextLink' ?? $response.d.__next
  } while ($Uri)
  return $items
}

function Get-RestListItemsRecursive {
  param(
    [string]$SiteUrl,
    [string]$ListId,
    [string[]]$Fields,
    [hashtable]$Headers
  )
  $viewFields = ($Fields | ForEach-Object { "<FieldRef Name='$([Web.HttpUtility]::HtmlEncode($_))'/>" }) -join ''
  $body = @{
    query = @{
      __metadata = @{ type = "SP.CamlQuery" }
      ViewXml = "<View Scope='RecursiveAll'><ViewFields>$viewFields</ViewFields><RowLimit>5000</RowLimit></View>"
    }
  } | ConvertTo-Json -Depth 6
  $response = Invoke-RestMethod -Headers $Headers -ContentType "application/json;odata=verbose" `
    -Uri "$SiteUrl/_api/web/lists(guid'$ListId')/GetItems" -Method Post -Body $body
  if ($response -is [string]) { $response = $response | ConvertFrom-Json -AsHashtable }
  return @($response.value ?? $response.d.results)
}

$token = Get-SharePointToken
$headers = @{ Authorization = "Bearer $token"; Accept = "application/json;odata=nometadata" }
$siteUrl = "https://$HostName$SitePath"
$lists = Get-RestCollection -Headers $headers -Uri "$siteUrl/_api/web/lists?`$select=Id,Title,Hidden,BaseTemplate,ItemCount,ReadSecurity,WriteSecurity,HasUniqueRoleAssignments,EnableModeration,DraftVersionVisibility,EffectiveBasePermissions&`$filter=Hidden eq false&`$top=500"
$currentUser = Invoke-RestMethod -Headers $headers -Uri "$siteUrl/_api/web/currentuser?`$select=Id,Title,Email,LoginName,IsSiteAdmin" -Method Get
$targetNames = @(
  "FILIAIS", "EMPREITEIRO", "DESCRICAOMEDICOES", "ATIVIDADE EXECUTADA",
  "LANCAMENTOOBRA", "IMOVEL CADASTRADO", "PROFISSÃO", "DEMONSTRATIVOETAPA", "FORNECEDORES"
)
$audit = @()
$samples = @()
$security = @()
$portalChecks = @()
$sampleFields = @{
  "FILIAIS" = @("Title")
  "EMPREITEIRO" = @("ID", "FORNECEDOR", "STATUS", "ACR_x00c9_SCIMO")
  "DESCRICAOMEDICOES" = @("ID", "FORNECEDOR", "STATUS", "NUMEROCONTRATO", "ASSINATURA")
  "ATIVIDADE EXECUTADA" = @("ID", "ATIVIDADEEXECUTADA", "FILIAL", "ETAPA")
  "LANCAMENTOOBRA" = @("ID", "field_3", "FILIAL", "STATUS")
  "IMOVEL CADASTRADO" = @("ID", "IMOVEL", "FILIAL", "STATUS")
  "PROFISSÃO" = @("ID", "PROFISS_x00c3_O", "STATUS")
  "DEMONSTRATIVOETAPA" = @("ID", "ATIVIDADEEXECUTADA", "FILIAL", "FORNECEDOR", "IMOVEL", "STATUS")
  "FORNECEDORES" = @("ID", "CADASTRO", "FILIAL", "IMOVEL", "STATUS")
}
foreach ($targetName in $targetNames) {
  foreach ($list in @($lists | Where-Object Title -EQ $targetName)) {
    $roleAssignments = @()
    $roleAssignmentError = ""
    try {
      $roleAssignments = Get-RestCollection -Headers $headers -Uri "$siteUrl/_api/web/lists(guid'$($list.Id)')/RoleAssignments?`$select=Member/Id,Member/Title,Member/LoginName,Member/Email,Member/PrincipalType,RoleDefinitionBindings/Name,RoleDefinitionBindings/RoleTypeKind&`$expand=Member,RoleDefinitionBindings&`$top=500"
    }
    catch { $roleAssignmentError = $_.Exception.Message }
    $security += [pscustomobject]@{
      List = $targetName
      ListId = $list.Id
      ItemCount = $list.ItemCount
      ReadSecurity = $list.ReadSecurity
      WriteSecurity = $list.WriteSecurity
      HasUniqueRoleAssignments = $list.HasUniqueRoleAssignments
      EffectiveBasePermissions = $list.EffectiveBasePermissions
      EnableModeration = $list.EnableModeration
      DraftVersionVisibility = $list.DraftVersionVisibility
      CurrentUser = [pscustomobject]@{
        Id = $currentUser.Id
        Title = $currentUser.Title
        Email = $currentUser.Email
        LoginName = $currentUser.LoginName
        IsSiteAdmin = $currentUser.IsSiteAdmin
      }
      RoleAssignments = @($roleAssignments)
      RoleAssignmentError = $roleAssignmentError
    }
    $fields = Get-RestCollection -Headers $headers -Uri "$siteUrl/_api/web/lists(guid'$($list.Id)')/fields?`$select=InternalName,Title,Indexed,Hidden,ReadOnlyField,TypeAsString,Filterable,Sortable&`$top=500"
    foreach ($field in $fields) {
      $audit += [pscustomobject]@{
        List = $targetName
        ListId = $list.Id
        ItemCount = $list.ItemCount
        InternalName = $field.InternalName
        Title = $field.Title
        Indexed = $field.Indexed
        Hidden = $field.Hidden
        ReadOnly = $field.ReadOnlyField
        Type = $field.TypeAsString
        Filterable = $field.Filterable
        Sortable = $field.Sortable
      }
    }
    $resolvedSampleFields = [ordered]@{}
    foreach ($requestedField in $sampleFields[$targetName]) {
      $match = @($fields | Where-Object { $_.InternalName -eq $requestedField }) | Select-Object -First 1
      if (-not $match) {
        $match = @($fields | Where-Object {
          $_.Title -eq $requestedField -and -not $_.Hidden -and -not $_.ReadOnlyField
        }) | Select-Object -First 1
      }
      if ($match) { $resolvedSampleFields[$requestedField] = $match.InternalName }
    }
    $select = @($resolvedSampleFields.Values | Select-Object -Unique) -join ','
    $items = Get-RestListItemsRecursive -Headers $headers -SiteUrl $siteUrl -ListId $list.Id -Fields @($resolvedSampleFields.Values | Select-Object -Unique)
    foreach ($item in $items) {
      $sample = [ordered]@{ List = $targetName }
      foreach ($requestedField in $resolvedSampleFields.Keys) {
        $sample[$requestedField] = $item.($resolvedSampleFields[$requestedField])
      }
      $samples += [pscustomobject]$sample
    }
    $check = switch ($targetName) {
      "FILIAIS" { @{ Select = "ID,Title"; Filter = "startswith(Title,'0')" } }
      "EMPREITEIRO" { @{ Select = "ID,FORNECEDOR,STATUS"; Filter = "startswith(FORNECEDOR,'') and STATUS eq 'ATIVO'" } }
      "DESCRICAOMEDICOES" { @{ Select = "ID,FORNECEDOR,STATUS,NUMEROCONTRATO"; Filter = "startswith(FORNECEDOR,'') and STATUS eq 'ATIVO'" } }
      "ATIVIDADE EXECUTADA" { @{ Select = "ID,ATIVIDADEEXECUTADA"; Filter = "startswith(ATIVIDADEEXECUTADA,'A')" } }
      "LANCAMENTOOBRA" { @{ Select = "ID,field_3,FILIAL"; Filter = "startswith(field_3,'') and FILIAL eq '004 - EDIFÍCIO XAVANTE'" } }
      "IMOVEL CADASTRADO" { @{ Select = "ID,IMOVEL,FILIAL"; Filter = "startswith(IMOVEL,'') and FILIAL eq '004 - EDIFÍCIO XAVANTE'" } }
      "PROFISSÃO" { @{ Select = "ID,PROFISS_x00c3_O,STATUS"; Filter = "startswith(PROFISS_x00c3_O,'') and STATUS eq 'ATIVO'" } }
      "DEMONSTRATIVOETAPA" { @{ Select = "ID,ATIVIDADEEXECUTADA,FILIAL,STATUS"; Filter = "startswith(ATIVIDADEEXECUTADA,'') and FILIAL eq '004 - EDIFÍCIO XAVANTE' and STATUS eq 'ATIVIDADE INICIADA'" } }
      default { $null }
    }
    if ($check) {
      $filter = [uri]::EscapeDataString($check.Filter)
      $checkItems = Get-RestCollection -Headers $headers -Uri "$siteUrl/_api/web/lists(guid'$($list.Id)')/items?`$select=$($check.Select)&`$filter=$filter&`$top=20"
      $portalChecks += [pscustomobject]@{ List = $targetName; Filter = $check.Filter; Count = @($checkItems).Count }
    }
  }
}

$audit | ConvertTo-Json -Depth 5 | Set-Content $OutputPath -Encoding utf8
$samples | ConvertTo-Json -Depth 5 | Set-Content $SamplesOutputPath -Encoding utf8
$security | ConvertTo-Json -Depth 10 | Set-Content $SecurityOutputPath -Encoding utf8
$portalChecks | ConvertTo-Json -Depth 5 | Set-Content "$env:TEMP\energetica-sharepoint-portal-checks.json" -Encoding utf8
Write-Host "Listas encontradas: $(@($audit | Select-Object -ExpandProperty List -Unique).Count) / $($targetNames.Count)" -ForegroundColor Cyan
Write-Host "Itens auditados: $($samples.Count)" -ForegroundColor Cyan
$audit | Where-Object {
  $_.InternalName -match 'Title|FILIAL|FORNECEDOR|STATUS|IMOVEL|ETAPA|ATIV|PROF|FORMA|NUMERO|ASSIN|ACR|ID' -or
  $_.Title -match 'Título|FILIAL|FORNECEDOR|STATUS|IMOVEL|ETAPA|ATIV|PROF|FORMA|NUMERO|ASSIN|ACR|ID'
} | Sort-Object List, Title, InternalName | Format-Table -AutoSize
