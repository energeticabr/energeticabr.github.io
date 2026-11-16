[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$SessionScript,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
. $SessionScript
$headers = @{ Authorization = 'Bearer ' + (Get-PowerPlatformSessionToken 'https://apihub.azure.com') }
$hub = 'https://200b8072-cebe-e4d7-b154-640eab964ee5.08.common.brazil.azure-apihub.net/apim/sharepointonline/e8453cf8f87449249f35c514af2acecb/datasets/'
$company = 'https://energeticaltda.sharepoint.com/sites/energetica'
$personal = 'https://energeticaltda-my.sharepoint.com/personal/bernardonotini_energeticabr_com'
$fields = @(
  @{ Site = $company; List = '5830d6f6-e7fb-4dce-9b11-fc50944ec9a9'; Title = 'NOTAS_FISCAIS_SEFAZ'; Name = 'NFEDESCRITIVO'; Type = 'Number' }
  @{ Site = $personal; List = '514bf67a-9e76-4bfc-99b7-1f7297ae611a'; Title = 'DESCRITIVOPROVISAO'; Name = 'NFEORIGEM'; Type = 'Text' }
  @{ Site = $personal; List = '6e5c235e-797a-4a86-8c05-25e0ab6ad870'; Title = 'PROVISÃO PGTOS'; Name = 'NFELINHA'; Type = 'Text' }
)

function Invoke-SharePoint($spec, $path, $body = $null) {
  $dataset = [uri]::EscapeDataString([uri]::EscapeDataString($spec.Site))
  $payload = @{
    method = 'GET'
    uri = "_api/web/lists(guid'$($spec.List)')$path"
    headers = @{ Accept = 'application/json;odata=nometadata' }
  }
  if ($null -ne $body) {
    $payload.method = 'POST'
    $payload.headers['Content-Type'] = 'application/json;odata=nometadata'
    $payload.body = $body | ConvertTo-Json -Depth 8 -Compress
  }
  Invoke-RestMethod -Method Post -Uri ($hub + $dataset + '/httprequest') -Headers $headers `
    -ContentType 'application/json; charset=utf-8' -Body ($payload | ConvertTo-Json -Depth 8 -Compress)
}

foreach ($spec in $fields) {
  $list = Invoke-SharePoint $spec '?$select=Id,Title,EnableAttachments'
  if ($list.Id -ne $spec.List -or $list.Title -cne $spec.Title -or !$list.EnableAttachments) {
    throw "A lista $($spec.Title) diverge da lista esperada."
  }
  $query = '/fields?$select=InternalName,EntityPropertyName,TypeAsString,ReadOnlyField,Required,Indexed,EnforceUniqueValues&$filter=InternalName eq ' + "'$($spec.Name)'"
  $current = @( (Invoke-SharePoint $spec $query).value | Where-Object { $_ } )
  $unique = $spec.Type -eq 'Text'
  if (!$current.Count -and $Apply) {
    $attributes = if ($unique) { 'Indexed="TRUE" EnforceUniqueValues="TRUE" MaxLength="64"' } else { 'Decimals="0" Min="1"' }
    $schema = '<Field Type="{0}" Name="{1}" StaticName="{1}" DisplayName="{1}" Required="FALSE" {2} />' -f $spec.Type, $spec.Name, $attributes
    $null = Invoke-SharePoint $spec '/fields/createfieldasxml' @{ parameters = @{ SchemaXml = $schema; Options = 0 } }
    $current = @( (Invoke-SharePoint $spec $query).value | Where-Object { $_ } )
  }
  if ($current.Count -ne 1 -or $current[0].TypeAsString -cne $spec.Type -or $current[0].EntityPropertyName -cne $spec.Name `
    -or $current[0].ReadOnlyField -or $current[0].Required -or $unique -and (!$current[0].Indexed -or !$current[0].EnforceUniqueValues)) {
    throw "A coluna $($spec.Name) na lista $($spec.Title) está ausente ou diverge da configuração esperada."
  }
  Write-Output "$($spec.Title) · $($spec.Name) verificada"
}
