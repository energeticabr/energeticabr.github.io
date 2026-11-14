[CmdletBinding()]
param([switch]$Apply, [switch]$AdditionalOrders)
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
    Invoke-RestMethod -Method Post -Uri $endpoint -Headers $auth -ContentType application/json -TimeoutSec 40 `
        -Body ([Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 12 -Compress)))
}

$list = Invoke-SharePoint GET "_api/web/lists/GetByTitle('MOVIMENTACOESFINANCEIRAS')?`$select=Id,Title"
if ($list.Title -cne 'MOVIMENTACOESFINANCEIRAS' -or !$list.Id) { throw 'Lista de movimentações não confirmada.' }
$base = "_api/web/lists(guid'$([guid]$list.Id)')"
$name = if ($AdditionalOrders) { 'SICOOB_PEDIDOS_ADICIONAIS' } else { 'SICOOB_SEM_VINCULACAO_REGULAR' }
$type = if ($AdditionalOrders) { 'Note' } else { 'Boolean' }
$fieldPath = "$base/fields?`$select=InternalName,TypeAsString,DefaultValue,ReadOnlyField,Required,SchemaXml&`$filter=InternalName eq '$name'"
$fields = @((Invoke-SharePoint GET $fieldPath).value | Where-Object InternalName -CEQ $name)
$created = $false
if ($Apply -and $fields.Count -eq 0) {
    $xml = if ($AdditionalOrders) {
        "<Field Type='Note' Name='$name' StaticName='$name' DisplayName='$name' Required='FALSE' RichText='FALSE' AppendOnly='FALSE' />"
    } else {
        "<Field Type='Boolean' Name='$name' StaticName='$name' DisplayName='$name' Required='FALSE'><Default>0</Default></Field>"
    }
    $null = Invoke-SharePoint POST "$base/fields/createfieldasxml" @{ parameters = @{ SchemaXml = $xml; Options = 8 } }
    $created = $true
    $fields = @((Invoke-SharePoint GET $fieldPath).value | Where-Object InternalName -CEQ $name)
}
if (!$Apply -and $fields.Count -eq 0) {
    [pscustomobject]@{ listVerified = $true; columnVerified = $false }
    return
}
if ($fields.Count -ne 1 -or $fields[0].TypeAsString -cne $type -or
    $fields[0].ReadOnlyField -or $fields[0].Required) {
    throw "Esquema da coluna $name divergente."
}
if ($AdditionalOrders) {
    $schema = ([xml]$fields[0].SchemaXml).Field
    if ($schema.RichText -ieq 'TRUE' -or $schema.AppendOnly -ieq 'TRUE') {
        throw "A coluna $name deve aceitar texto simples e substituição."
    }
} elseif ([string]$fields[0].DefaultValue -ne '0') {
    throw "Valor padrão da coluna $name divergente."
}
$null = Invoke-SharePoint GET "$base/items?`$top=1&`$select=ID,ORIGEMMOVIMENTACAO,IDPEDIDO,$name&`$filter=ORIGEMMOVIMENTACAO eq 'SICOOB'"
[pscustomobject]@{ listVerified = $true; columnVerified = $true; columnCreated = $created; itemsModified = 0 }
