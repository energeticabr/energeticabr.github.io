[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SessionScript,
    [Parameter(Mandatory)][string]$BackupPath,
    [switch]$Publish,
    [switch]$Status,
    [switch]$Offline
)

$ErrorActionPreference='Stop'
if(-not $Offline){. $SessionScript}
$environment='Default-0c10f511-7ede-4702-a2d9-bedb26937e0e'
$id='bd5db344-5c0f-4ed9-8442-182dc5c94819'
$base="https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/$environment/flows/$id"
$auth=if(-not $Offline){@{Authorization='Bearer '+(Get-PowerPlatformSessionToken 'https://service.powerapps.com')}}
$to='bernardonotini@energeticabr.com'
$subject='[Energética] NF-e pendente de recuperação há mais de 12 horas'
$first='Ler_lacunas_NFe'
$last='Confirmar_email_NFe'

function Request([string]$Method,[string]$Route='',$Body=$null){
    $args=@{Method=$Method;Uri=($base+$Route+'?api-version=2016-11-01');Headers=$auth;TimeoutSec=65}
    if($null -ne $Body){
        $args.ContentType='application/json'
        $args.Body=[Text.Encoding]::UTF8.GetBytes(($Body|ConvertTo-Json -Depth 100 -Compress))
    }
    Invoke-RestMethod @args
}
function Copy-Map($Value){return ($Value|ConvertTo-Json -Depth 60 -Compress|ConvertFrom-Json -AsHashtable)}
function SharePoint-Action($Template,[string]$Method,[string]$Uri,$After){
    $action=Copy-Map $Template
    $action.runAfter=$After
    $action.inputs.parameters['parameters/method']=$Method
    $action.inputs.parameters['parameters/uri']=$Uri
    $null=$action.inputs.parameters.Remove('parameters/body')
    return $action
}
function Status-Report($Flow){
    $actions=$Flow.properties.definition.actions
    $runs=@((Request GET '/runs').value|Select-Object -First 8)
    $details=foreach($run in $runs){
        $items=@((Request GET ("/runs/"+$run.name+"/actions")).value)
        $match=@($items|Where-Object {$_.name -in @($first,'Enviar_email_NFe',$last,'Ler_pendencias','Alertar')} |
            ForEach-Object {[ordered]@{name=$_.name;status=$_.properties.status}})
        if($match|Where-Object {$_.name -eq $first}){
            [ordered]@{run=$run.name;started=$run.properties.startTime;status=$run.properties.status;actions=$match}
        }
        if($match|Where-Object {$_.name -eq 'Enviar_email_NFe' -and $_.status -eq 'Succeeded'}){break}
    }
    [ordered]@{state=$Flow.properties.state;configured=($null -ne $actions.$first);runs=@($details)}|ConvertTo-Json -Depth 12 -Compress
}

$flow=if($Offline){Get-Content -LiteralPath $BackupPath -Raw|ConvertFrom-Json}else{Request GET}
if($Status){Status-Report $flow;return}
$properties=Copy-Map $flow.properties
$actions=$properties.definition.actions
$daily=Copy-Map $actions
$dailyJson=$daily|ConvertTo-Json -Depth 80 -Compress
$connections=$properties.connectionReferences|ConvertTo-Json -Depth 30 -Compress
if($properties.state -cne 'Started' -or $properties.definition.triggers.Recorrencia.runtimeConfiguration.concurrency.runs -ne 1 -or
   $actions.Alertar.actions.Enviar_email.inputs.host.operationId -cne 'SendEmailV2' -or
   $actions.Alertar.actions.Enviar_email.inputs.parameters['emailMessage/To'] -cne $to -or
   $actions.Ler_pendencias.inputs.parameters['parameters/uri'] -cnotmatch 'DIARIO-GALERIAS-'){
    throw 'NF_E_ALERT_UNEXPECTED_EXISTING_FLOW'
}
if($actions.Contains($first)){
    if($actions.Se_houver_lacunas_NFe.actions.Enviar_email_NFe.inputs.parameters['emailMessage/Subject'] -cne $subject){throw 'NF_E_ALERT_ALREADY_EXISTS'}
    [ordered]@{id=$id;state=$properties.state;configured=$true}|ConvertTo-Json -Compress
    return
}

$list="_api/web/lists/getbytitle('SEFAZ_MONITORAMENTO')/items"
$criteria="startswith(Title,'NFE-LACUNA-') and STATUS eq 'Pending' and ALERTA_RESERVADO_EM eq null and ALERTA_ENVIADO_EM eq null and INICIADO_EM lt datetime'@{formatDateTime(addHours(utcNow(),-12),'yyyy-MM-ddTHH:mm:ssZ')}'"
$readUri=$list+'?$select=Id,Title,DETALHES,STATUS,ALERTA_RESERVADO_EM,ALERTA_ENVIADO_EM&$orderby=Id%20asc&$top=50&$filter='+$criteria
$actions[$first]=SharePoint-Action $actions.Ler_pendencias GET $readUri @{}
$actions[$first].inputs.parameters['parameters/headers'] = @{Accept='application/json;odata=nometadata'}
$template=$actions.Alertar.actions.Reservar_aviso
$read=SharePoint-Action $template GET ($list+"(@{items('Reservar_lacunas_NFe')?['Id']})") @{}
$read.inputs.parameters['parameters/headers']=@{Accept='application/json;odata=verbose'}
$reserve=SharePoint-Action $template POST ($list+"(@{items('Reservar_lacunas_NFe')?['Id']})") @{}
$reserve.inputs.parameters['parameters/headers']['IF-MATCH']="@body('Ler_lacuna_atual_NFe')?['d']?['__metadata']?['etag']"
$reserve.inputs.parameters['parameters/body']="@string(setProperty(json('{}'),'ALERTA_RESERVADO_EM',utcNow()))"
$filter=@{type='If';runAfter=@{Ler_lacuna_atual_NFe=@('Succeeded')};expression=@{and=@(
    @{equals=@("@body('Ler_lacuna_atual_NFe')?['d']?['STATUS']", 'Pending')},
    @{equals=@("@body('Ler_lacuna_atual_NFe')?['d']?['ALERTA_ENVIADO_EM']", $null)},
    @{equals=@("@body('Ler_lacuna_atual_NFe')?['d']?['ALERTA_RESERVADO_EM']", $null)},
    @{not=@{equals=@("@coalesce(body('Ler_lacuna_atual_NFe')?['d']?['__metadata']?['etag'],'')",'')}}
)};actions=@{
    Reservar_NFe=$reserve
    Identificar_lacuna_reservada_NFe=@{type='AppendToArrayVariable';runAfter=@{Reservar_NFe=@('Succeeded')};inputs=@{
        name='LacunasNFeReservadas';value="@body('Ler_lacuna_atual_NFe')?['d']"}}
}}
$actions.Iniciar_lacunas_NFe=@{type='InitializeVariable';runAfter=@{};inputs=@{variables=@(@{name='LacunasNFeReservadas';type='array';value=@()})}}
$actions.Reservar_lacunas_NFe=@{type='Foreach';operationOptions='Sequential';foreach="@coalesce(body('Ler_lacunas_NFe')?['value'],json('[]'))";
    runAfter=@{Ler_lacunas_NFe=@('Succeeded');Iniciar_lacunas_NFe=@('Succeeded')};actions=@{Ler_lacuna_atual_NFe=$read;Reservar_se_aberta_NFe=$filter}}
$mail=Copy-Map $actions.Alertar.actions.Enviar_email
$mail.runAfter=@{Tabela_lacunas_NFe=@('Succeeded')}
$mail.inputs.parameters['emailMessage/Subject']=$subject
$mail.inputs.parameters['emailMessage/Body']="<p>O coletor detectou lacunas na distribuição de NF-e da SEFAZ que seguem pendentes há mais de 12 horas.</p><p>@{body('Tabela_lacunas_NFe')}</p><p>Um NSU pode corresponder a uma nota ou a um evento fiscal. O coletor mantém a recuperação pendente.</p><p><a href='https://energeticaltda.sharepoint.com/sites/energetica/Lists/NOTAS_FISCAIS_SEFAZ'>Abrir galeria fiscal</a></p>"
$confirm=SharePoint-Action $template POST ($list+"(@{items('Confirmar_email_NFe')?['Id']})") @{}
$confirm.inputs.parameters['parameters/body']="@string(setProperty(json('{}'),'ALERTA_ENVIADO_EM',utcNow()))"
$release=SharePoint-Action $template POST ($list+"(@{items('Liberar_limitadas_NFe')?['Id']})") @{}
$release.inputs.parameters['parameters/body']='{"ALERTA_RESERVADO_EM":null}'
$actions.Se_houver_lacunas_NFe=@{type='If';runAfter=@{Reservar_lacunas_NFe=@('Succeeded','Failed')};expression=@{
    greater=@("@length(variables('LacunasNFeReservadas'))",0)
};actions=@{
    Tabela_lacunas_NFe=@{type='Table';runAfter=@{};inputs=@{from="@variables('LacunasNFeReservadas')";format='HTML';columns=@(@{header='Pendências de recuperação';value="@item()?['DETALHES']"})}}
    Enviar_email_NFe=$mail
    Confirmar_email_NFe=@{type='Foreach';operationOptions='Sequential';foreach="@variables('LacunasNFeReservadas')";runAfter=@{Enviar_email_NFe=@('Succeeded')};
        actions=@{Registrar_envio_NFe=$confirm}}
    Repetir_se_limitado_NFe=@{type='If';runAfter=@{Enviar_email_NFe=@('Failed')};
        expression=@{equals=@("@string(outputs('Enviar_email_NFe')?['statusCode'])",'429')};actions=@{
            Liberar_limitadas_NFe=@{type='Foreach';operationOptions='Sequential';foreach="@variables('LacunasNFeReservadas')";runAfter=@{};
                actions=@{Liberar_reserva_NFe=$release}}
        }}
}}
$payload=@{properties=@{definition=$properties.definition;displayName=$properties.displayName;apiId=$properties.apiId;
    state=$properties.state;connectionReferences=$properties.connectionReferences}}
if(-not $Publish -or $Offline){[ordered]@{id=$id;candidate=$true;readUri=$readUri;recipient=$to;dailyActions=$daily.Keys.Count}|ConvertTo-Json -Compress;return}

[IO.File]::WriteAllText($BackupPath,($flow|ConvertTo-Json -Depth 100),[Text.UTF8Encoding]::new($false))
$null=Request PATCH '' $payload
$after=Request GET
$updated=Copy-Map $after.properties.definition.actions
$actualDaily=[ordered]@{Ler_pendencias=$updated.Ler_pendencias;Alertar=$updated.Alertar}|ConvertTo-Json -Depth 80 -Compress
if($after.properties.state -cne 'Started' -or $dailyJson -cne $actualDaily -or
   $connections -cne ($after.properties.connectionReferences|ConvertTo-Json -Depth 30 -Compress) -or
   $updated[$first].inputs.parameters['parameters/uri'] -cne $readUri -or
   $updated.Se_houver_lacunas_NFe.actions.Enviar_email_NFe.inputs.parameters['emailMessage/To'] -cne $to -or
   $updated.Se_houver_lacunas_NFe.actions.Enviar_email_NFe.inputs.retryPolicy.type -cne 'none'){
    throw 'NF_E_ALERT_READBACK_INVALID'
}
[ordered]@{id=$id;state=$after.properties.state;published=$true;verified=$true}|ConvertTo-Json -Compress
