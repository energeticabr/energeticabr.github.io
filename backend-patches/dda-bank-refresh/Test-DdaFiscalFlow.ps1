$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'DdaFiscalFlow.psm1') -Force
function Assert-True([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
function Assert-Equal($Actual,$Expected,[string]$Message){if($Actual -ne $Expected){throw "$Message. Esperado=[$Expected] Obtido=[$Actual]"}}

$definition=@{
 actions=[ordered]@{
  Localizar=@{type='OpenApiConnection'}
  Iniciar_id=@{type='InitializeVariable';inputs=@{variables=@(@{type='integer';value=0;name='ItemId'})};runAfter=@{Rejeitar_duplicidade=@('Succeeded')}}
  Gravar=@{type='If';runAfter=@{Iniciar_id=@('Succeeded')}}
  Conferir_PDF=@{type='OpenApiConnection';runAfter=@{Espelho_gravado=@('Succeeded')}}
  Recibo=@{type='Compose';runAfter=@{Conferir_PDF=@('Succeeded')};inputs=@{correlation="@triggerBody()?['correlation']";itemId="@variables('ItemId')"}}
  Responder=@{type='Response';runAfter=@{Recibo=@('Succeeded')}}
 }
}
$result=Add-DdaFiscalFlowDefinition -Definition $definition
$actions=$result.actions
$variables=@($actions.Iniciar_id.inputs.variables)
Assert-Equal (@($variables|Where-Object{$_.name -eq 'FiscalStatus'}).Count) 1 'O status fiscal deve ser inicializado uma vez'
Assert-Equal $actions.Vincular_nota_fiscal.type 'If' 'A vinculacao deve ser uma condicao propria'
Assert-Equal $actions.Vincular_nota_fiscal.expression.equals[0] "@length(body('Localizar')?['value'])" 'O ramo deve observar a deduplicacao do DDA'
Assert-Equal $actions.Vincular_nota_fiscal.expression.equals[1] 0 'Somente DDA novo pode consultar notas'
Assert-Equal @($actions.Vincular_nota_fiscal.runAfter.Keys)[0] 'Conferir_PDF' 'A busca fiscal deve ocorrer depois do espelho DDA confirmado'

$createBranch=$actions.Vincular_nota_fiscal.actions
$eligibility=$createBranch.Dados_fiscais_elegiveis
Assert-Equal $eligibility.type 'If' 'Dados fiscais incompletos devem ser tratados sem executar a consulta'
Assert-Equal $eligibility.expression.and.Count 3 'A elegibilidade deve exigir data, fornecedor e valor'
Assert-Equal $eligibility.else.actions.Definir_fiscal_inelegivel.inputs.value 'unmatched' 'DDA incompleto deve continuar com recibo sem correspondencia'
$eligibilityJson=$eligibility.expression|ConvertTo-Json -Depth 20 -Compress
foreach($field in @('EMISSAO','CNPJ_FORNECEDOR','VALOR')){
 Assert-True ($eligibilityJson.Contains("coalesce(triggerBody()?['fields']?['$field'],''")) "A elegibilidade deve tolerar $field ausente"
}
Assert-True (-not $createBranch.ContainsKey('Localizar_notas_fiscais')) 'A consulta fiscal nao pode existir fora da guarda de elegibilidade'
$inside=$eligibility.actions
$query=$inside.Localizar_notas_fiscais.inputs.parameters.'parameters/uri'
foreach($required in @("CNPJ_FORNECEDOR eq","DATA_EMISSAO ge","DATA_EMISSAO lt","VALOR_LIQUIDO eq","VALOR_TOTAL_NOTA eq","VALOR_SERVICOS eq","STATUS_DANFE eq 'DISPONIVEL'","SITUACAO ne 'CANCELADA'",'&$top=2')){
 Assert-True ($query.Contains($required)) "A consulta precisa conter: $required"
}
Assert-Equal $inside.Localizar_notas_fiscais.inputs.parameters.dataset 'https://energeticaltda.sharepoint.com/sites/energetica' 'A consulta deve usar o site fiscal'
$unique=$inside.Correspondencia_unica
Assert-Equal $unique.expression.equals[0] "@length(body('Localizar_notas_fiscais')?['value'])" 'A condicao deve contar as candidatas'
Assert-Equal $unique.expression.equals[1] 1 'Somente correspondencia unica pode avancar'
Assert-Equal $unique.actions.Anexos_da_nota.inputs.host.operationId 'GetItemAttachments' 'A nota deve fornecer seu anexo real'
Assert-Equal $unique.actions.Anexos_da_nota.inputs.parameters.table 'NOTAS_FISCAIS_SEFAZ' 'O PDF deve vir da lista fiscal'
$pdfUnique=$unique.actions.PDF_fiscal_unico
Assert-Equal $pdfUnique.expression.equals[1] 1 'A nota deve possuir exatamente um PDF fiscal'
Assert-Equal $pdfUnique.actions.Anexar_PDF_fiscal.inputs.host.operationId 'CreateAttachment' 'O PDF deve ser anexado ao DDA'
Assert-Equal $pdfUnique.actions.Anexar_PDF_fiscal.inputs.parameters.table '33804dc0-a580-4dfe-96a0-c9621c5b8755' 'O destino deve ser a lista DDA'
Assert-True ([string]$pdfUnique.actions.Anexar_PDF_fiscal.inputs.parameters.displayName -like '*FISCAL-*') 'O anexo fiscal deve ter nome identificavel'
Assert-Equal $pdfUnique.actions.Validar_anexo_fiscal.expression.equals[1] 1 'O upload deve ser conferido antes do sucesso'
Assert-Equal $actions.Recibo.runAfter.Contains('Vincular_nota_fiscal') $true 'O recibo deve aguardar a vinculacao'
Assert-Equal $actions.Recibo.inputs.fiscalStatus "@variables('FiscalStatus')" 'O resultado deve ser auditavel no recibo'

$again=Add-DdaFiscalFlowDefinition -Definition $result
Assert-Equal @($again.actions.Iniciar_id.inputs.variables|Where-Object{$_.name -eq 'FiscalStatus'}).Count 1 'A transformacao deve ser idempotente'
Assert-Equal @($again.actions.Keys|Where-Object{$_ -eq 'Vincular_nota_fiscal'}).Count 1 'A acao nao pode ser duplicada'
'PASS: fluxo incremental DDA x nota fiscal validado'
