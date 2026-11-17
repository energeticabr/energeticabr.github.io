$ErrorActionPreference='Stop'
$definition=Get-Content (Join-Path $PSScriptRoot 'live-definition-before.json') -Raw | ConvertFrom-Json -AsHashtable
$site='https://energeticaltda.sharepoint.com/sites/energetica'; $table='NOTAS_FISCAIS_SEFAZ'
function Connector($Operation,$Parameters,$After=@{}) {
 return @{type='OpenApiConnection';inputs=@{host=@{apiId='/providers/Microsoft.PowerApps/apis/shared_sharepointonline';connectionName='shared_sharepointonline';operationId=$Operation};parameters=$Parameters;authentication="@parameters('`$authentication')"};runAfter=$After;runtimeConfiguration=@{secureData=@{properties=@('inputs','outputs')}}}
}
function Reply($Body,$After=@{},$Status=200) {
 return @{type='Response';kind='Http';runAfter=$After;inputs=@{statusCode=$Status;body=$Body};operationOptions='Asynchronous';runtimeConfiguration=@{secureData=@{properties=@('inputs')}}}
}
function ReadNote($After=@{}) {
 $old=$definition.actions.Operacao.else.actions.Obter_PDF.actions.Ler_nota | ConvertTo-Json -Depth 100 | ConvertFrom-Json -AsHashtable
 $old.runAfter=$After;return $old
}
function Attachments($After=@{}) {return Connector 'GetItemAttachments' @{dataset=$site;table=$table;itemId="@int(triggerBody()?['itemId'])"} $After}
function Filter($InputName,$After=@{}) {return @{type='Query';runAfter=$After;inputs=@{from="@body('$InputName')";where="@equals(toLower(item()?['DisplayName']),toLower(triggerBody()?['filename']))"};runtimeConfiguration=@{secureData=@{properties=@('inputs','outputs')}}}}
$props=$definition.triggers.manual.inputs.schema.properties
$props.mode.enum=@('inventory','pdf','dda_sync')
$props.filename=@{type='string';maxLength=100}
$props.ddaId=@{type='integer';minimum=1}
$props.sourceName=@{type='string';minLength=32;maxLength=32}
$props.content=@{type='string';maxLength=26666668}
$props.expectedKey=@{type='string';minLength=44;maxLength=50}
$branch=$definition.actions.Operacao.else.actions.Obter_PDF
$branch.actions.PDFs.inputs.where="@and(endsWith(toLower(item()?['DisplayName']),'.pdf'),not(startsWith(toLower(item()?['DisplayName']),'cce-')),not(startsWith(toLower(item()?['DisplayName']),'dda-')))"
$add=Connector 'CreateAttachment' @{dataset=$site;table=$table;itemId="@int(triggerBody()?['itemId'])";displayName="@triggerBody()?['filename']";body="@base64ToBinary(triggerBody()?['content'])"}
$add.inputs.retryPolicy=@{type='none'}
$ifMissing=@{type='If';runAfter=@{DDA_mesmo_nome=@('Succeeded')};expression="@equals(length(body('DDA_mesmo_nome')),0)";actions=@{DDA_adicionar=$add};else=@{actions=@{}}}
$download=Connector 'GetAttachmentContent' @{dataset=$site;table=$table;itemId="@int(triggerBody()?['itemId'])";attachmentId="@first(body('DDA_final_nome'))?['Id']"}
$valid=@{type='If';runAfter=@{DDA_final_nome=@('Succeeded')};expression="@equals(length(body('DDA_final_nome')),1)";actions=@{
 DDA_baixar=$download
 DDA_registro_final=(ReadNote @{DDA_baixar=@('Succeeded')})
 DDA_responder=(Reply @{status="@if(equals(length(body('DDA_mesmo_nome')),0),'linked','already_linked')";content="@body('DDA_baixar')";record="@body('DDA_registro_final')"} @{DDA_registro_final=@('Succeeded')})
};else=@{actions=@{DDA_duplicado=(Reply @{status='duplicate_attachment'} @{} 409)}}}
$authorized=@{type='If';runAfter=@{DDA_nota=@('Succeeded')};expression="@and(equals(body('DDA_nota')?['CHAVE_ACESSO'],triggerBody()?['expectedKey']),equals(body('DDA_nota')?['SITUACAO'],'AUTORIZADA'),equals(body('DDA_nota')?['STATUS_IMPORTACAO'],'XML_COMPLETO'),equals(body('DDA_nota')?['STATUS_DANFE'],'DISPONIVEL'))";actions=@{
 DDA_anexos=(Attachments)
 DDA_mesmo_nome=(Filter 'DDA_anexos' @{DDA_anexos=@('Succeeded')})
 DDA_se_ausente=$ifMissing
 DDA_anexos_final=(Attachments @{DDA_se_ausente=@('Succeeded')})
 DDA_final_nome=(Filter 'DDA_anexos_final' @{DDA_anexos_final=@('Succeeded')})
 DDA_unico=$valid
};else=@{actions=@{DDA_nota_alterada=(Reply @{status='fiscal_changed'} @{} 409)}}}
# Fixed original collector name and positive IDs; no arbitrary filenames, overwrite or list updates.
$hex="last(split(first(split(triggerBody()?['filename'],'.pdf')),'_'))"
$clean=$hex
foreach($ch in '0123456789abcdef'.ToCharArray()) {$clean="replace($clean,'$ch','')"}
$expression="@and(equals(triggerBody()?['mode'],'dda_sync'),greater(int(triggerBody()?['itemId']),0),startsWith(triggerBody()?['filename'],'DDA-'),greater(int(triggerBody()?['ddaId']),0),equals(triggerBody()?['filename'],concat('DDA-',string(int(triggerBody()?['ddaId'])),'-',triggerBody()?['sourceName'])),equals(triggerBody()?['sourceName'],concat('Espelho_DDA_',$hex,'.pdf')),contains(triggerBody()?['filename'],'-Espelho_DDA_'),endsWith(triggerBody()?['filename'],'.pdf'),equals(length($hex),16),equals($clean,''),not(contains(triggerBody()?['filename'],'/')),not(contains(triggerBody()?['filename'],'\')),not(contains(triggerBody()?['filename'],'''')),not(contains(triggerBody()?['filename'],'%')),not(contains(triggerBody()?['filename'],'..')),startsWith(triggerBody()?['content'],'JVBERi0'),lessOrEquals(length(triggerBody()?['content']),26666668))"
$reverse=@{type='If';runAfter=@{};expression=$expression;actions=@{DDA_nota=(ReadNote);DDA_autorizada=$authorized};else=@{actions=@{DDA_invalido=(Reply @{status='invalid_dda_request'} @{} 400)}}}
$branch.else.actions=@{Sincronizar_DDA=$reverse}
$definition|ConvertTo-Json -Depth 100|Set-Content (Join-Path $PSScriptRoot 'fiscal-bridge-definition.json')
@{status='built';modes=$props.mode.enum}|ConvertTo-Json
