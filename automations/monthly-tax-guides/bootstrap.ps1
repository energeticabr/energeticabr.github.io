[CmdletBinding()]
param(
    [string]$SessionScript='C:\Users\Bernardonotini\Documents\Codex\2026-10-29\quero-que-desenvolva-para-mim-em\scripts\PowerPlatform-Session.ps1'
)
$ErrorActionPreference='Stop'
. $SessionScript
$site='https://energeticaltda-my.sharepoint.com/personal/bernardonotini_energeticabr_com'
$endpoint='https://200b8072-cebe-e4d7-b154-640eab964ee5.08.common.brazil.azure-apihub.net/apim/sharepointonline/e8453cf8f87449249f35c514af2acecb/datasets/'+[uri]::EscapeDataString([uri]::EscapeDataString($site))+'/httprequest'
$auth=@{Authorization='Bearer '+(Get-PowerPlatformSessionToken 'https://apihub.azure.com')}
$list="_api/web/lists/GetByTitle('GUIASINSSFGTS')"
function Invoke-GuideSp($Method,$Path,$Body=$null,$Extra=@{}){
    if($Method -ne 'GET' -and $Path -ne '_api/web/lists' -and -not $Path.StartsWith($list+'/')){throw 'Mutation outside guide schema'}
    $headers=@{Accept='application/json;odata=nometadata'}
    foreach($key in $Extra.Keys){$headers[$key]=$Extra[$key]}
    $payload=@{method=$Method;uri=$Path;headers=$headers}
    if($null -ne $Body){$headers['Content-Type']='application/json;odata=nometadata';$payload.body=ConvertTo-Json -InputObject $Body -Depth 20 -Compress}
    $response=Invoke-WebRequest -Method Post -Uri $endpoint -Headers $auth -ContentType application/json -Body ([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $payload -Depth 25 -Compress))) -TimeoutSec 60
    if(-not [string]::IsNullOrWhiteSpace($response.Content)){ConvertFrom-Json -InputObject $response.Content -AsHashtable}
}
$lists=Invoke-GuideSp GET '_api/web/lists?$select=Id,Title&$top=500'
if($lists.'odata.nextLink' -or $lists.'@odata.nextLink'){throw 'List enumeration incomplete'}
$found=@($lists.value | Where-Object {$_.Title -ceq 'GUIASINSSFGTS'})
if($found.Count -gt 1){throw 'Ambiguous guide list'}
if($found.Count -eq 0){$null=Invoke-GuideSp POST '_api/web/lists' @{Title='GUIASINSSFGTS';BaseTemplate=100;Description='Solicitações mensais das guias oficiais de INSS e FGTS por filial.'}}
$fields=@(
    @('CHAVE','Text','<Field Name="CHAVE" StaticName="CHAVE" DisplayName="Chave da solicitação" Type="Text" Required="TRUE" Indexed="TRUE" EnforceUniqueValues="TRUE" MaxLength="255" />'),
    @('COMPETENCIA','DateTime','<Field Name="COMPETENCIA" StaticName="COMPETENCIA" DisplayName="Data competência" Type="DateTime" Format="DateOnly" Required="TRUE" />'),
    @('FILIAL','Text','<Field Name="FILIAL" StaticName="FILIAL" DisplayName="Filial" Type="Text" Required="TRUE" MaxLength="255" />'),
    @('TIPO','Choice','<Field Name="TIPO" StaticName="TIPO" DisplayName="Tipo" Type="Choice" Required="TRUE"><CHOICES><CHOICE>INSS</CHOICE><CHOICE>FGTS</CHOICE></CHOICES></Field>'),
    @('VENCIMENTO','DateTime','<Field Name="VENCIMENTO" StaticName="VENCIMENTO" DisplayName="Data vencimento" Type="DateTime" Format="DateOnly" />'),
    @('VALOR','Currency','<Field Name="VALOR" StaticName="VALOR" DisplayName="Valor" Type="Currency" LCID="1046" Decimals="2" Min="0" />')
)
$schema=Invoke-GuideSp GET ($list+'/fields?$select=Id,InternalName,TypeAsString,Indexed,EnforceUniqueValues&$top=500')
foreach($field in $fields){
    $matches=@($schema.value | Where-Object {$_.InternalName -ceq $field[0]})
    if($matches.Count -eq 0){
        # SharePoint derives InternalName from DisplayName unless the hint is used.
        $xml=[xml]$field[2];$display=$xml.Field.DisplayName;$xml.Field.DisplayName=$field[0]
        $created=Invoke-GuideSp POST ($list+'/fields/createfieldasxml') @{parameters=@{SchemaXml=$xml.OuterXml;Options=8}}
        if($created.InternalName -cne $field[0]){throw 'Created internal name differs from requested name'}
        $null=Invoke-GuideSp POST ($list+"/fields(guid'$($created.Id)')") @{Title=$display} @{'X-HTTP-Method'='MERGE';'IF-MATCH'='*'}
    }
    elseif($matches.Count -ne 1 -or $matches[0].TypeAsString -cne $field[1]){throw ('Unexpected field: '+$field[0])}
}
$schema=Invoke-GuideSp GET ($list+'/fields?$select=Id,InternalName,TypeAsString,Indexed,EnforceUniqueValues&$top=500')
foreach($field in $fields){$matches=@($schema.value | Where-Object {$_.InternalName -ceq $field[0]});if($matches.Count -ne 1 -or $matches[0].TypeAsString -cne $field[1]){throw ('Schema readback mismatch: '+$field[0]+' expected '+$field[1]+' found '+(ConvertTo-Json -InputObject $matches -Compress))}}
$key=@($schema.value | Where-Object {$_.InternalName -ceq 'CHAVE'})[0]
if(-not $key.Indexed -or -not $key.EnforceUniqueValues){throw 'Monthly uniqueness not confirmed'}
$metadata=Invoke-GuideSp GET ($list+'?$select=Id,Title,EnableAttachments')
if(-not $metadata.EnableAttachments){throw 'Guide attachments disabled'}
[ordered]@{listId=$metadata.Id;list=$metadata.Title;uniqueKey=$true;attachments=$true;fields=$fields.Count} | ConvertTo-Json
