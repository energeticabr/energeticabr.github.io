Set-StrictMode -Version Latest
$script:DdaSite='https://energeticaltda-my.sharepoint.com/personal/bernardonotini_energeticabr_com'
$script:DdaList='33804dc0-a580-4dfe-96a0-c9621c5b8755'
$script:FiscalSite='https://energeticaltda.sharepoint.com/sites/energetica'
$script:FiscalList='NOTAS_FISCAIS_SEFAZ'

function New-DdaFiscalConnectorAction([string]$Operation,[hashtable]$Parameters,[hashtable]$After=@{}) {
    return [ordered]@{
        type='OpenApiConnection'
        inputs=[ordered]@{
            host=@{apiId='/providers/Microsoft.PowerApps/apis/shared_sharepointonline';connectionName='shared_sharepointonline';operationId=$Operation}
            parameters=$Parameters
            authentication="@parameters('`$authentication')"
        }
        runAfter=$After
        runtimeConfiguration=@{secureData=@{properties=@('inputs','outputs')}}
    }
}

function New-DdaFiscalCondition($Expression,[hashtable]$Actions,[hashtable]$ElseActions=@{},[hashtable]$After=@{}) {
    return [ordered]@{type='If';expression=$Expression;actions=$Actions;else=@{actions=$ElseActions};runAfter=$After}
}

function Add-DdaFiscalFlowDefinition {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Definition)
    $copy=($Definition|ConvertTo-Json -Depth 100 -Compress)|ConvertFrom-Json -AsHashtable
    $actions=$copy.actions
    foreach($required in @('Localizar','Iniciar_id','Gravar','Conferir_PDF','Recibo','Responder')){
        if(-not $actions.ContainsKey($required)){throw "DDA_FISCAL_FLOW_ANCHOR_MISSING_$required"}
    }
    $variables=[Collections.Generic.List[object]]::new()
    foreach($variable in @($actions.Iniciar_id.inputs.variables)){$variables.Add($variable)}
    if(-not @($variables|Where-Object{$_.name -eq 'FiscalStatus'}).Count){$variables.Add(@{type='string';value='not_created';name='FiscalStatus'})}
    $actions.Iniciar_id.inputs.variables=$variables.ToArray()

    $queryUri="_api/web/lists/getbytitle('$script:FiscalList')/items?`$select=Id,CHAVE_ACESSO,TIPO_FISCAL&`$filter="+
        "CNPJ_FORNECEDOR eq '@{triggerBody()?['fields']?['CNPJ_FORNECEDOR']}' and "+
        "DATA_EMISSAO ge datetime'@{concat(substring(triggerBody()?['fields']?['EMISSAO'],0,10),'T03:00:00Z')}' and "+
        "DATA_EMISSAO lt datetime'@{formatDateTime(addDays(concat(substring(triggerBody()?['fields']?['EMISSAO'],0,10),'T03:00:00Z'),1),'yyyy-MM-ddTHH:mm:ssZ')}' and "+
        "STATUS_DANFE eq 'DISPONIVEL' and SITUACAO ne 'CANCELADA' and "+
        "(VALOR_LIQUIDO eq @{string(triggerBody()?['fields']?['VALOR'])} or VALOR_TOTAL_NOTA eq @{string(triggerBody()?['fields']?['VALOR'])} or VALOR_SERVICOS eq @{string(triggerBody()?['fields']?['VALOR'])})&`$orderby=Id desc&`$top=2"
    $locate=New-DdaFiscalConnectorAction 'HttpRequest' @{
        dataset=$script:FiscalSite
        'parameters/method'='GET'
        'parameters/uri'=$queryUri
        'parameters/headers'=@{Accept='application/json;odata=nometadata';'Content-Type'='application/json;odata=nometadata'}
    }
    $fiscalAttachments=New-DdaFiscalConnectorAction 'GetItemAttachments' @{
        dataset=$script:FiscalSite;table=$script:FiscalList;itemId="@int(first(body('Localizar_notas_fiscais')?['value'])?['Id'])"
    }
    $pdfFilter=[ordered]@{
        type='Query';runAfter=@{Anexos_da_nota=@('Succeeded')}
        inputs=@{from="@body('Anexos_da_nota')";where="@endsWith(toLower(item()?['DisplayName']),'.pdf')"}
        runtimeConfiguration=@{secureData=@{properties=@('inputs','outputs')}}
    }
    $download=New-DdaFiscalConnectorAction 'GetAttachmentContent' @{
        dataset=$script:FiscalSite;table=$script:FiscalList
        itemId="@int(first(body('Localizar_notas_fiscais')?['value'])?['Id'])"
        attachmentId="@first(body('PDFs_da_nota'))?['Id']"
    }
    $upload=New-DdaFiscalConnectorAction 'CreateAttachment' @{
        dataset=$script:DdaSite;table=$script:DdaList;itemId="@variables('ItemId')"
        displayName="@concat('FISCAL-',first(body('PDFs_da_nota'))?['DisplayName'])"
        body="@body('Baixar_PDF_fiscal')"
    } @{Baixar_PDF_fiscal=@('Succeeded')}
    $verifyAttachments=New-DdaFiscalConnectorAction 'GetItemAttachments' @{
        dataset=$script:DdaSite;table=$script:DdaList;itemId="@variables('ItemId')"
    } @{Anexar_PDF_fiscal=@('Succeeded')}
    $verifyFilter=[ordered]@{
        type='Query';runAfter=@{Conferir_anexos_fiscais=@('Succeeded')}
        inputs=@{from="@body('Conferir_anexos_fiscais')";where="@equals(item()?['DisplayName'],concat('FISCAL-',first(body('PDFs_da_nota'))?['DisplayName']))"}
        runtimeConfiguration=@{secureData=@{properties=@('inputs','outputs')}}
    }
    $setLinked=[ordered]@{type='SetVariable';inputs=@{name='FiscalStatus';value='linked'};runAfter=@{}}
    $failReadback=[ordered]@{type='Terminate';inputs=@{runStatus='Failed';runError=@{code='FISCAL_ATTACHMENT_NOT_VERIFIED';message='O PDF fiscal nao foi confirmado no item DDA.'}};runAfter=@{}}
    $validate=New-DdaFiscalCondition @{equals=@("@length(body('Anexo_fiscal_gravado'))",1)} @{Definir_fiscal_vinculado=$setLinked} @{Falhar_conferencia_fiscal=$failReadback} @{Anexo_fiscal_gravado=@('Succeeded')}
    $setUnavailable=[ordered]@{type='SetVariable';inputs=@{name='FiscalStatus';value='pdf_unavailable'};runAfter=@{}}
    $pdfUnique=New-DdaFiscalCondition @{equals=@("@length(body('PDFs_da_nota'))",1)} ([ordered]@{
        Baixar_PDF_fiscal=$download
        Anexar_PDF_fiscal=$upload
        Conferir_anexos_fiscais=$verifyAttachments
        Anexo_fiscal_gravado=$verifyFilter
        Validar_anexo_fiscal=$validate
    }) @{Definir_pdf_indisponivel=$setUnavailable} @{PDFs_da_nota=@('Succeeded')}
    $notMatched=[ordered]@{type='SetVariable';inputs=@{name='FiscalStatus';value="@if(equals(length(body('Localizar_notas_fiscais')?['value']),0),'unmatched','ambiguous')"};runAfter=@{}}
    $unique=New-DdaFiscalCondition @{equals=@("@length(body('Localizar_notas_fiscais')?['value'])",1)} ([ordered]@{
        Anexos_da_nota=$fiscalAttachments
        PDFs_da_nota=$pdfFilter
        PDF_fiscal_unico=$pdfUnique
    }) @{Definir_fiscal_nao_vinculado=$notMatched} @{Localizar_notas_fiscais=@('Succeeded')}
    $setIneligible=[ordered]@{type='SetVariable';inputs=@{name='FiscalStatus';value='unmatched'};runAfter=@{}}
    $eligible=New-DdaFiscalCondition @{and=@(
        @{equals=@("@greaterOrEquals(length(string(coalesce(triggerBody()?['fields']?['EMISSAO'],''))),10)",$true)}
        @{equals=@("@greater(length(string(coalesce(triggerBody()?['fields']?['CNPJ_FORNECEDOR'],''))),0)",$true)}
        @{equals=@("@greater(length(string(coalesce(triggerBody()?['fields']?['VALOR'],''))),0)",$true)}
    )} ([ordered]@{
        Localizar_notas_fiscais=$locate
        Correspondencia_unica=$unique
    }) @{Definir_fiscal_inelegivel=$setIneligible}
    $branch=New-DdaFiscalCondition @{equals=@("@length(body('Localizar')?['value'])",0)} ([ordered]@{
        Dados_fiscais_elegiveis=$eligible
    }) @{} @{Conferir_PDF=@('Succeeded')}
    $actions.Vincular_nota_fiscal=$branch
    $actions.Recibo.runAfter=[ordered]@{Vincular_nota_fiscal=@('Succeeded')}
    $actions.Recibo.inputs.fiscalStatus="@variables('FiscalStatus')"
    return $copy
}

Export-ModuleMember -Function Add-DdaFiscalFlowDefinition
