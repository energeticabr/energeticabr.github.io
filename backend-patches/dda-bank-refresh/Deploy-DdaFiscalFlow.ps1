param(
    [Parameter(Mandatory)][string]$RuntimeRoot,
    [string]$FlowId='8ab2e1fb-6c82-4846-a0f3-e8e609589b38',
    [switch]$Check,
    [switch]$Deploy
)
$ErrorActionPreference='Stop'
if($Check -eq $Deploy){throw 'Escolha exatamente um modo: -Check ou -Deploy.'}
$root=[IO.Path]::GetFullPath($RuntimeRoot)
$flowClient=Join-Path $root 'SharePointFlow.ps1'
if(-not [IO.File]::Exists($flowClient)){throw 'DDA_FLOW_CLIENT_MISSING'}
. $flowClient
Import-Module (Join-Path $PSScriptRoot 'DdaFiscalFlow.psm1') -Force
Connect-DdaFlow
$flow=Invoke-DdaFlowApi ('/'+$FlowId)
if($flow.properties.displayName -ne 'DDAS SICOOB - sincronizacao e espelhos' -or $flow.properties.state -ne 'Started'){throw 'DDA_FLOW_UNEXPECTED'}
$original=($flow.properties.definition|ConvertTo-Json -Depth 100 -Compress)|ConvertFrom-Json -AsHashtable
$candidate=Add-DdaFiscalFlowDefinition -Definition $original
$json=$candidate|ConvertTo-Json -Depth 100 -Compress
$null=$json|ConvertFrom-Json -AsHashtable
$hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($json)))
if($Check){
    [pscustomobject]@{status='checked';flowId=$FlowId;candidateHash=$hash;actions=$candidate.actions.Count;alreadyInstalled=$original.actions.ContainsKey('Vincular_nota_fiscal')}|ConvertTo-Json -Compress
    exit 0
}
$originalPayload=@{properties=@{displayName=$flow.properties.displayName;definition=$original;connectionReferences=$flow.properties.connectionReferences;flowFailureAlertSubscribed=[bool]$flow.properties.flowFailureAlertSubscribed}}
$candidatePayload=@{properties=@{displayName=$flow.properties.displayName;definition=$candidate;connectionReferences=$flow.properties.connectionReferences;flowFailureAlertSubscribed=[bool]$flow.properties.flowFailureAlertSubscribed}}
try{
    $null=Invoke-DdaFlowApi ('/'+$FlowId) 'PATCH' $candidatePayload
    $verified=Invoke-DdaFlowApi ('/'+$FlowId)
    $definition=($verified.properties.definition|ConvertTo-Json -Depth 100 -Compress)|ConvertFrom-Json -AsHashtable
    if($verified.properties.state -ne 'Started' -or -not $definition.actions.ContainsKey('Vincular_nota_fiscal') -or
        -not $definition.actions.Recibo.runAfter.ContainsKey('Vincular_nota_fiscal') -or
        $definition.actions.Recibo.inputs.fiscalStatus -ne "@variables('FiscalStatus')") { throw 'DDA_FISCAL_FLOW_VERIFY_FAILED' }
    $verifiedJson=$definition|ConvertTo-Json -Depth 100 -Compress
    $verifiedHash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($verifiedJson)))
    [pscustomobject]@{status='deployed';flowId=$FlowId;state=$verified.properties.state;candidateHash=$hash;verifiedHash=$verifiedHash}|ConvertTo-Json -Compress
}catch{
    try{$null=Invoke-DdaFlowApi ('/'+$FlowId) 'PATCH' $originalPayload}catch{}
    throw
}
