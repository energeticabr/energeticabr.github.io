param([string]$ModulePath=(Join-Path $PSScriptRoot '../src/AuxiliaryFiscal.psm1'))
$ErrorActionPreference='Stop'
$script:passed=0
function Equal($Actual,$Expected,[string]$Name){if($Actual -cne $Expected){throw "$Name : esperado [$Expected], recebido [$Actual]"};$script:passed++}
function Throws([scriptblock]$Action,[string]$Pattern,[string]$Name){$caught=$false;try{& $Action|Out-Null}catch{if($_.Exception.Message -notmatch $Pattern){throw};$caught=$true};Equal $caught $true $Name}
if(-not (Test-Path -LiteralPath $ModulePath)){throw 'AUXILIARY_ENGINE_MISSING: engine duravel auxiliar ainda nao implementada.'}
Import-Module $ModulePath -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../src/Sefaz.psm1') -DisableNameChecking
$now=[DateTimeOffset]::Parse('2026-10-29T12:30:00Z')
$slot='2026-10-29-09'
$cfg=[pscustomobject]@{companyCnpj='38626750000146';environment='1';minimumIssueDate='2026-10-01';scheduleHours=@(9,15,20)}
$noRequest={param($Config,$LastNsu)throw 'TEST_UNEXPECTED_NETWORK'}
$noSend={param($Documents)throw 'TEST_UNEXPECTED_SEND'}
$ready={param($Document,$Evidence,$MinimumIssueDate,$Now)return 'READY'}
$script:sent=0
$ack={param($Documents)$script:sent++;return [pscustomobject]@{source='SEFAZ';acknowledgedIds=@($Documents|ForEach-Object {$_.id})}}
function Doc([string]$Nsu,[string]$Date='2026-10-02T12:00:00-03:00',[string]$Key='fixture-key'){
    $n=$Nsu.PadLeft(15,'0');$bytes=[Text.Encoding]::UTF8.GetBytes('synthetic-xml-'+$Nsu)
    $hash=[Security.Cryptography.SHA256]::Create();try{$sha=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
    $fields=[ordered]@{DATA_EMISSAO_ORIGINAL=$Date;DATA_EMISSAO=$Date;STATUS_IMPORTACAO='XML_COMPLETO'}
    return [pscustomobject]@{id=($n+'-'+$sha.Substring(0,16));nsu=$n;key=$Key;kind='cteProc';fields=$fields;xmlBase64=[Convert]::ToBase64String($bytes);sha256=$sha;fileName=($n+'.xml')}
}
function Batch($Documents,[string]$Status='138',[string]$Last='1',[string]$Max='1',$Unhandled=@()){
    return [pscustomobject]@{status=$Status;lastNsu=$Last;maxNsu=$Max;documents=@($Documents);unhandledDocuments=@($Unhandled)}
}
function Cached([string]$Path,$Parsed,[string]$Previous='000000000000000',[string]$Source='CTE'){
    [IO.Directory]::CreateDirectory($Path)|Out-Null
    Write-AtomicJson (Join-Path $Path 'state.json') ([ordered]@{version=1;source=$Source;lastNsu=$Previous;maxNsu=$null;status='REQUEST_RESERVED';nextAllowedAt=$now.AddMinutes(65).ToString('o');lastCompletedSlot=$null;pendingSlot=$slot})
    Write-AtomicJson (Join-Path $Path 'pending-response.json') ([ordered]@{previousNsu=$Previous;requestedAt=$now.ToString('o');body='synthetic-response'})
    $copy=$Parsed
    return {param($Body,$CompanyCnpj)return $copy}.GetNewClosure()
}
function State([string]$Path){Get-Content -LiteralPath (Join-Path $Path 'state.json') -Raw|ConvertFrom-Json}
function Count([string]$Path,[string]$Folder){$folderPath=Join-Path $Path $Folder;if(-not (Test-Path -LiteralPath $folderPath)){return 0};return @(Get-ChildItem -LiteralPath $folderPath -Filter '*.json').Count}
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('auxiliary-fiscal-test-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot)|Out-Null
try{
    $path=Join-Path $testRoot 'cached';$parse=Cached $path (Batch @((Doc '1')))
    $result=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Request $noRequest -Parse $parse -Scope $ready -SendBatch $noSend -StageOnly
    Equal $result.status 'STAGED' 'cache e processado durante cooldown sem envio'
    Equal (Count $path 'outbox') 1 'documento pronto persistido'
    Equal (Count $path 'raw') 1 'resposta bruta persistida antes cursor'
    Equal (Test-Path -LiteralPath (Join-Path $path 'pending-response.json')) $false 'journal removido somente depois staging'
    Equal (State $path).lastNsu '000000000000001' 'cursor apos staging duravel'
    Equal (State $path).lastCompletedSlot $null 'StageOnly nao finge entrega'
    $result=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Request $noRequest -Scope $ready -SendBatch $ack
    Equal $result.status 'COMPLETED' 'outbox entregue ignorando cooldown de consultas'
    Equal (Count $path 'archive') 1 'ACK exato arquiva documento'
    Equal (Count $path 'outbox') 0 'outbox esvaziada apos ACK'
    Equal (State $path).lastCompletedSlot $slot 'slot concluido somente apos ACK'
    $null=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now.AddHours(3) -Request $noRequest -Scope $ready -SendBatch $noSend
    Equal $script:sent 1 'slot concluido nao consulta nem reenvia'

    $path=Join-Path $testRoot 'bad-ack';$parse=Cached $path (Batch @((Doc '1'),(Doc '2')) '138' '2' '2')
    $null=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Request $noRequest -Parse $parse -Scope $ready -SendBatch $noSend -StageOnly
    $badAck={param($Documents)return [pscustomobject]@{source='SEFAZ';acknowledgedIds=@($Documents[0].id,$Documents[0].id)}}
    Throws {Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Request $noRequest -Scope $ready -SendBatch $badAck} 'AUX_ACK_INVALID' 'ACK duplicado bloqueia conclusao'
    Equal (Count $path 'outbox') 2 'falha ACK conserva lote inteiro'
    Equal (Count $path 'archive') 0 'nenhum arquivo antes ACK inteiro'
    Equal (State $path).lastCompletedSlot $null 'falha ACK nao conclui slot'
    $null=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot '2026-10-29-15' -Now $now.AddMinutes(1) -Request $noRequest -Scope $ready -SendBatch $ack
    Equal (State $path).lastCompletedSlot $slot 'retomada conclui pendingSlot original'

    $path=Join-Path $testRoot 'reserved';$counter=[pscustomobject]@{calls=0;reserved=$false}
    $request={param($Config,$LastNsu)$counter.calls++;$saved=[IO.File]::ReadAllText((Join-Path $path 'state.json'))|ConvertFrom-Json;$counter.reserved=($saved.status -eq 'REQUEST_RESERVED' -and [DateTimeOffset]$saved.nextAllowedAt -ge $now.AddMinutes(65) -and [DateTimeOffset]$saved.nextAllowedAt -lt $now.AddMinutes(65).AddSeconds(10));throw 'SECRET_XML_MUST_NOT_ESCAPE'}.GetNewClosure()
    Throws {Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Request $request -Parse {throw 'TEST_PARSE_NOT_EXPECTED'} -Scope $ready -SendBatch $ack} 'AUX_REQUEST_FAILED' 'rede falha com codigo sem dados sensiveis'
    Equal $counter.reserved $true 'reserva persistida antes chamada externa'
    $result=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now.AddMinutes(1) -Request $request -Scope $ready -SendBatch $ack
    Equal $result.status 'COOLDOWN' 'falha rede conserva espera'
    Equal $counter.calls 1 'cooldown impede repeticao'
    Equal ((Get-Content (Join-Path $path 'logs/worker.jsonl') -Raw).Contains('SECRET_XML')) $false 'log nao contem mensagem externa ou XML'

    $path=Join-Path $testRoot 'pages';$queue=[pscustomobject]@{requests=0}
    $request={param($Config,$LastNsu)$queue.requests++;return [string]$queue.requests}.GetNewClosure()
    $parse={param($Body,$CompanyCnpj)if($Body -eq '1'){return Batch @((Doc '1')) '138' '1' '2'};return Batch @() '137' '1' '1'}
    $result=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -MaxBatches 3 -Request $request -Parse $parse -Scope $ready -SendBatch $ack
    Equal $queue.requests 2 '138 com saldo continua depois de persistir e entregar'
    Equal $result.status 'COMPLETED' '137 conclui rodada'
    Equal (State $path).lastNsu '000000000000001' '137 preserva ultimo cursor'

    $path=Join-Path $testRoot 'page-failure';$counter=[pscustomobject]@{calls=0}
    $request={param($Config,$LastNsu)$counter.calls++;if($counter.calls -eq 1){return 'page1'};throw 'SECRET_SECOND_REQUEST_FAILURE'}.GetNewClosure()
    $firstPage=Batch @((Doc '1')) '138' '1' '2';$parse={param($Body,$CompanyCnpj)return $firstPage}.GetNewClosure()
    Throws {Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Request $request -Parse $parse -Scope $ready -SendBatch $ack} 'AUX_REQUEST_FAILED' 'falha na segunda pagina preserva reserva'
    $result=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now.AddMinutes(1) -Request $noRequest -Scope $ready -SendBatch $ack
    Equal $result.status 'COOLDOWN' 'hasMore antigo nao contorna cooldown depois de falha request'
    Equal $counter.calls 2 'nao repete terceira chamada apos falha'

    $path=Join-Path $testRoot 'fresh-clock';$clockState=[pscustomobject]@{time=$now;calls=0;secondReservation=$null}
    $clock={return $clockState.time}.GetNewClosure()
    $request={param($Config,$LastNsu)$clockState.calls++;if($clockState.calls -eq 1){return 'page1'};$saved=[IO.File]::ReadAllText((Join-Path $path 'state.json'))|ConvertFrom-Json;$clockState.secondReservation=[DateTimeOffset]$saved.nextAllowedAt;throw 'SECRET_DELAYED_FAILURE'}.GetNewClosure()
    $send={param($Documents)$clockState.time=$clockState.time.AddMinutes(10);return [pscustomobject]@{source='SEFAZ';acknowledgedIds=@($Documents|ForEach-Object {$_.id})}}.GetNewClosure()
    $parse={param($Body,$CompanyCnpj)return $firstPage}.GetNewClosure()
    Throws {Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Clock $clock -Request $request -Parse $parse -Scope $ready -SendBatch $send} 'AUX_REQUEST_FAILED' 'relogio avanca durante envio entre paginas'
    Equal $clockState.secondReservation $now.AddMinutes(75) 'segunda reserva usa hora fresca apos atraso de10min'
    $clockState.time=$now.AddMinutes(70)
    $result=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Clock $clock -Request $noRequest -Scope $ready -SendBatch $noSend
    Equal $result.status 'COOLDOWN' '65min da hora original nao libera reserva da segunda pagina'
    Equal $clockState.calls 2 'nenhuma consulta adicional antes do prazo renovado'
    $path=Join-Path $testRoot 'fresh-completion';$clockState.time=$now;$parse=Cached $path (Batch @((Doc '1')))
    $null=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Clock $clock -Request $noRequest -Parse $parse -Scope $ready -SendBatch $send
    Equal ([DateTimeOffset](State $path).nextAllowedAt) $now.AddMinutes(75) 'conclusao conta65min apos entrega e nao apos inicio'
    $path=Join-Path $testRoot 'fresh-rejection';$clockState.time=$now;$null=Cached $path (Batch @() '656' '0' '0')
    $parse={param($Body,$CompanyCnpj)$clockState.time=$clockState.time.AddMinutes(20);return [pscustomobject]@{status='656';lastNsu='0';maxNsu='0';documents=@()}}.GetNewClosure()
    $null=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Clock $clock -Request $noRequest -Parse $parse -Scope $ready -SendBatch $noSend
    Equal ([DateTimeOffset](State $path).nextAllowedAt) $now.AddMinutes(85) 'rejeicao usa hora fresca antes do cooldown'

    $path=Join-Path $testRoot 'parse-recovery';$parse=Cached $path (Batch @((Doc '1')))
    Throws {Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Request $noRequest -Parse {throw 'SECRET_BAD_XML'} -Scope $ready -SendBatch $ack} 'AUX_PARSE_FAILED' 'falha de interpretacao sanitizada'
    Equal (Test-Path -LiteralPath (Join-Path $path 'pending-response.json')) $true 'falha parse conserva cache original'
    Equal (State $path).lastNsu '000000000000000' 'parse incompleto nao avanca cursor'
    $result=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now.AddMinutes(1) -Request $noRequest -Parse $parse -Scope $ready -SendBatch $ack
    Equal $result.status 'COMPLETED' 'correcao parser reprocessa cache sem nova consulta'

    $path=Join-Path $testRoot 'raw-history';$emptyBatch=Batch @() '137' '0' '0';$parse={param($Body,$CompanyCnpj)return $emptyBatch}.GetNewClosure()
    $null=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Request {'identical-empty-response'} -Parse $parse -Scope $ready -SendBatch $noSend
    $null=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot '2026-10-29-15' -Now $now.AddHours(6) -Request {'identical-empty-response'} -Parse $parse -Scope $ready -SendBatch $noSend
    Equal (Count $path 'raw') 2 'respostas identicas em tentativas distintas conservam journals separados'

    $path=Join-Path $testRoot 'unhandled';$unknown=Doc '1';$unknown|Add-Member pendingInterpretation $true
    $parse=Cached $path (Batch @() '138' '1' '1' @($unknown))
    $result=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Request $noRequest -Parse $parse -Scope $ready -SendBatch $noSend
    Equal (Count $path 'unhandled-pending') 1 'tipo nao interpretado conservado em fila propria'
    Equal (Count $path 'archive') 0 'tipo desconhecido nao e alegado importado'
    Equal (State $path).lastNsu '000000000000001' 'cursor somente depois pacote bruto duravel'

    $path=Join-Path $testRoot 'rejected';$parse=Cached $path (Batch @() '656' '99' '0') '000000000000003'
    $result=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Request $noRequest -Parse $parse -Scope $ready -SendBatch $noSend
    Equal $result.status 'REJECTED' '656 sinaliza rejeicao'
    Equal (State $path).lastNsu '000000000000003' '656 nunca avanca cursor confirmado'
    Equal (State $path).serverNsuHint '000000000000099' 'hint em campo separado'
    Equal (State $path).lastCompletedSlot $null '656 nao conclui slot'

    $path=Join-Path $testRoot 'nfse-empty';$largeNsu='9223372036854775800'
    $parse=Cached $path ([pscustomobject]@{status='NENHUM_DOCUMENTO_LOCALIZADO';lastNsu=$null;hasMore=$false;documents=@()}) $largeNsu 'NFSE'
    $result=Invoke-AuxiliaryFiscalSource -Source NFSE -Config $cfg -DataPath $path -Slot $slot -Now $now -Request $noRequest -Parse $parse -Scope $ready -SendBatch $noSend
    Equal (State $path).lastNsu $largeNsu 'NFS-e vazio conserva cursor int64 de19digitos'
    Equal (State $path).lastCompletedSlot $slot 'NFS-e vazio conclui slot'

    $path=Join-Path $testRoot 'scope';$old=Doc '1' '2026-09-30T23:59:00-03:00' 'old';$full=Doc '2' '2026-10-01T00:01:00-03:00' 'same';$event=Doc '3' '' 'same';$event.fields.STATUS_IMPORTACAO='EVENTO_SEM_XML';$future=Doc '4' '2026-12-01T00:00:00-03:00' 'future'
    $parse=Cached $path (Batch @($old,$full,$event,$future) '138' '4' '4')
    $scope={param($Document,$Evidence,$MinimumIssueDate,$Now)$date=$Document.fields.DATA_EMISSAO_ORIGINAL;if(-not $date){$date=@($Evidence|Where-Object {$_.key -eq $Document.key -and $_.fields.DATA_EMISSAO_ORIGINAL}|Select-Object -First 1)[0].fields.DATA_EMISSAO_ORIGINAL};if(-not $date){return 'PENDING_DATE'};$issued=[DateTimeOffset]::Parse($date);if($issued -gt $Now){return 'FUTURE_DATE'};if($issued.Date -lt [DateTime]::Parse($MinimumIssueDate).Date){return 'BEFORE_SCOPE'};return 'READY'}
    $null=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Request $noRequest -Parse $parse -Scope $scope -SendBatch $noSend -StageOnly
    Equal (Count $path 'outbox') 2 'evento usa evidencia da nota no mesmo lote'
    Equal (Count $path 'scope-excluded') 1 'emissao anterior ao corte fica separada'
    Equal (Count $path 'scope-pending-date') 1 'emissao futura aguarda sem bloquear cursor'
    Equal (State $path).lastNsu '000000000000004' 'corte nao interrompe sequencia'

    $path=Join-Path $testRoot 'batching';$docs=@(1..11|ForEach-Object {Doc ([string]$_)})
    $parse=Cached $path (Batch $docs '138' '11' '11');$sizes=New-Object 'Collections.Generic.List[int]'
    $send={param($Documents)$sizes.Add($Documents.Count);return [pscustomobject]@{source='SEFAZ';acknowledgedIds=@($Documents|ForEach-Object {$_.id})}}.GetNewClosure()
    $null=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Request $noRequest -Parse $parse -Scope $ready -SendBatch $send
    Equal $sizes.Count 2 'onze documentos em dois envios'
    Equal $sizes[0] 10 'limite dez documentos'
    Equal $sizes[1] 1 'restante enviado sem truncar rodada'
    Equal (Count $path 'archive') 11 'todos documentos confirmados'

    $path=Join-Path $testRoot 'size-limit';$largeOne=Doc '1';$largeTwo=Doc '2';$largeOne.fields.OBSERVACOES_NOTA='x'*800000;$largeTwo.fields.OBSERVACOES_NOTA='y'*800000
    $parse=Cached $path (Batch @($largeOne,$largeTwo) '138' '2' '2');$wireSizes=New-Object 'Collections.Generic.List[int]'
    $send={param($Documents)$wireSizes.Add([Text.Encoding]::UTF8.GetByteCount(($Documents|ConvertTo-Json -Depth 35 -Compress)));return [pscustomobject]@{source='SEFAZ';acknowledgedIds=@($Documents|ForEach-Object {$_.id})}}.GetNewClosure()
    $null=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Request $noRequest -Parse $parse -Scope $ready -SendBatch $send
    Equal $wireSizes.Count 2 'limite bytes separa lote antes de1.5MB'
    Equal (@($wireSizes|Where-Object {$_ -gt 1500000}).Count) 0 'todo lote respeita limite bytes'

    $path=Join-Path $testRoot 'nfse-large-nsu';$bigDocument=Doc '9223372036854775801';$parse=Cached $path ([pscustomobject]@{status='DOCUMENTOS_LOCALIZADOS';lastNsu=$bigDocument.nsu;hasMore=$false;documents=@($bigDocument)}) '9223372036854775800' 'NFSE'
    $null=Invoke-AuxiliaryFiscalSource -Source NFSE -Config $cfg -DataPath $path -Slot $slot -Now $now -Request $noRequest -Parse $parse -Scope $ready -SendBatch $ack
    Equal (Count $path 'archive') 1 'ACK suporta identidade NSU19digitos'
    Equal (State $path).lastNsu '9223372036854775801' 'NSU19 nao convertido para double nem truncado'

    $path=Join-Path $testRoot 'default-parser-scope';$actualKey='31261012345678000123570010000001231000001234'
    $actualXml='<cteProc xmlns="http://www.portalfiscal.inf.br/cte"><CTe><infCte Id="CTe'+$actualKey+'"><ide><mod>57</mod><nCT>123</nCT><serie>1</serie><dhEmi>2026-10-02T12:00:00-03:00</dhEmi><toma4><toma>4</toma><CNPJ>38626750000146</CNPJ><xNome>Tomador Ficticio</xNome></toma4></ide><emit><CNPJ>12345678000123</CNPJ><xNome>Transportadora Ficticia</xNome></emit><vPrest><vTPrest>100.00</vTPrest><vRec>90.00</vRec></vPrest></infCte></CTe><protCTe><infProt><chCTe>'+$actualKey+'</chCTe><cStat>100</cStat><nProt>123</nProt></infProt></protCTe></cteProc>'
    $bytes=[Text.Encoding]::UTF8.GetBytes($actualXml);$stream=[IO.MemoryStream]::new();$gzip=[IO.Compression.GZipStream]::new($stream,[IO.Compression.CompressionMode]::Compress,$true)
    try{$gzip.Write($bytes,0,$bytes.Length)}finally{$gzip.Dispose()};$zipped=[Convert]::ToBase64String($stream.ToArray());$stream.Dispose()
    $null=Cached $path (Batch @())
    $actualResponse='<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/cte"><cStat>138</cStat><ultNSU>1</ultNSU><maxNSU>1</maxNSU><loteDistDFeInt><docZip NSU="1" schema="procCTe_v4.00.xsd">'+$zipped+'</docZip></loteDistDFeInt></retDistDFeInt>'
    Write-AtomicJson (Join-Path $path 'pending-response.json') ([ordered]@{previousNsu='000000000000000';requestedAt=$now.ToString('o');body=$actualResponse})
    $result=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Request $noRequest -SendBatch $noSend -StageOnly
    Equal $result.status 'STAGED' 'parser e scope reais funcionam offline com XML sintetico'
    Equal (Count $path 'outbox') 1 'normalizacao e validacao unificada real em outbox'

    $path=Join-Path $testRoot 'locked';[IO.Directory]::CreateDirectory($path)|Out-Null
    $held=[IO.File]::Open((Join-Path $path 'worker.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try{$result=Invoke-AuxiliaryFiscalSource -Source CTE -Config $cfg -DataPath $path -Slot $slot -Now $now -Request $noRequest -SendBatch $noSend;Equal $result.status 'LOCK_BUSY' 'lock de arquivo impede concorrencia'}finally{$held.Dispose()}

    $schedulerRoot=Join-Path $testRoot 'scheduler';$calls=New-Object 'Collections.Generic.List[string]'
    $invoke={param($Source,$Config,$DataPath,$Slot,$WorkerConfig,$Now,$MaxBatches)$calls.Add($Source+':'+$Slot);if($Source -eq 'CTE'){throw 'SECRET_ONE_SOURCE_FAILURE'};return [pscustomobject]@{status='COMPLETED'}}.GetNewClosure()
    $cycle=Invoke-AuxiliaryFiscalScheduledCycle -Config $cfg -WorkerConfig ([pscustomobject]@{}) -DataRoot $schedulerRoot -Now ([DateTimeOffset]::Parse('2026-10-29T11:59:00Z')) -SourceInvoker $invoke
    Equal $calls.Count 2 'falha de uma fonte nao interrompe outra'
    Equal $calls[0] 'CTE:2026-10-28-20' 'antes das9 BRT usa ultimo horario da vespera'
    Equal $calls[1] 'NFSE:2026-10-28-20' 'mesmo slot calculado por fonte'
    Equal $cycle.results[0].status 'FAILED' 'scheduler expoe falha isolada'
    Equal (($cycle|ConvertTo-Json -Depth 10).Contains('SECRET')) $false 'scheduler nao expoe erro sensivel'
    foreach($source in @('CTE','NFSE')){Write-AtomicJson (Join-Path (Join-Path $schedulerRoot $source) 'state.json') ([ordered]@{version=1;source=$source;lastNsu='000000000000000';status='COMPLETED';nextAllowedAt=$null;lastCompletedSlot='2026-10-29-09';pendingSlot=$null})}
    $cycle=Invoke-AuxiliaryFiscalScheduledCycle -Config $cfg -WorkerConfig ([pscustomobject]@{}) -DataRoot $schedulerRoot -Now $now -SourceInvoker {throw 'TEST_ALREADY_COMPLETED_SOURCE_MUST_NOT_RUN'}
    Equal $cycle.results[0].status 'ALREADY_COMPLETED' 'mesmo slot concluido nao inicia CTE'
    Equal $cycle.results[1].status 'ALREADY_COMPLETED' 'mesmo slot concluido nao inicia NFS-e'
}finally{
    $resolved=[IO.Path]::GetFullPath($testRoot);$tempBase=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
    if(-not $resolved.StartsWith($tempBase,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'auxiliary-fiscal-test-*'){throw 'TEST_TEMP_PATH_INVALID'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
Write-Output ('PASS auxiliary fiscal assertions: '+$script:passed+'; consultas reais:0; envios reais:0')
