[CmdletBinding()]
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../notas-fiscais-cte-nfse/scripts/PowerPlatform-Session.ps1')

$site = 'https://energeticaltda-my.sharepoint.com/personal/bernardonotini_energeticabr_com'
$connector = 'https://200b8072-cebe-e4d7-b154-640eab964ee5.08.common.brazil.azure-apihub.net/apim/sharepointonline/e8453cf8f87449249f35c514af2acecb'
$endpoint = $connector + '/datasets/' + [uri]::EscapeDataString([uri]::EscapeDataString($site)) + '/httprequest'
$auth = @{ Authorization = 'Bearer ' + (Get-PowerPlatformSessionToken 'https://apihub.azure.com') }

function Invoke-SharePoint($Method, $Path, $Body = $null) {
    $headers = @{ Accept = 'application/json;odata=nometadata' }
    $payload = @{ method = $Method; uri = $Path; headers = $headers }
    if ($null -ne $Body) {
        $headers['Content-Type'] = 'application/json;odata=nometadata'
        $payload.body = $Body | ConvertTo-Json -Depth 10 -Compress
    }
    $response = Invoke-WebRequest -Method Post -Uri $endpoint -Headers $auth -ContentType application/json -TimeoutSec 40 `
        -Body ([Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 12 -Compress)))
    if ($response.Content) { $response.Content | ConvertFrom-Json -AsHashtable }
}

$list = Invoke-SharePoint GET "_api/web/lists/GetByTitle('DDAS SICOOB')?`$select=Id,Title"
if ($list.Title -cne 'DDAS SICOOB' -or !$list.Id) { throw 'Lista DDA não confirmada.' }
$base = "_api/web/lists(guid'$([guid]$list.Id)')"
$name = 'DATA_PRIOR'
$fieldPath = "$base/fields?`$select=InternalName,TypeAsString,Required,ReadOnlyField,SchemaXml&`$filter=InternalName eq '$name'"
$fields = @((Invoke-SharePoint GET $fieldPath).value | Where-Object InternalName -CEQ $name)
$created = $false
if ($Apply -and $fields.Count -eq 0) {
    $xml = '<Field Type="DateTime" Name="DATA_PRIOR" StaticName="DATA_PRIOR" DisplayName="DATA_PRIOR" Format="DateOnly" Required="FALSE" />'
    $null = Invoke-SharePoint POST "$base/fields/createfieldasxml" @{ parameters = @{ SchemaXml = $xml; Options = 0 } }
    $created = $true
    $fields = @((Invoke-SharePoint GET $fieldPath).value | Where-Object InternalName -CEQ $name)
}
if (!$Apply -and $fields.Count -eq 0) {
    [pscustomobject]@{ listVerified = $true; columnVerified = $false }
    return
}
if ($fields.Count -ne 1 -or $fields[0].TypeAsString -cne 'DateTime' -or $fields[0].Required -or
    $fields[0].ReadOnlyField -or $fields[0].SchemaXml -notmatch 'Format="DateOnly"') {
    throw 'A coluna DATA_PRIOR precisa ser uma data opcional editável.'
}
$null = Invoke-SharePoint GET "$base/items?`$top=1&`$select=Id,$name"
[pscustomobject]@{ listVerified = $true; columnVerified = $true; columnCreated = $created; itemsModified = 0 }
