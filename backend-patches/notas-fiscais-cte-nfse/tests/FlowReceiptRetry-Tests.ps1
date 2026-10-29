$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/FlowTransport.psm1') -Force -DisableNameChecking
$script:passed=0
function Equal($Actual,$Expected,$Name){if($Actual -cne $Expected){throw "$Name : expected [$Expected], actual [$Actual]"};$script:passed++}
if(-not ('FiscalReceiptTestException' -as [type])){
    Add-Type 'public sealed class FiscalReceiptTestException : System.Exception { public object Response {get;set;} public FiscalReceiptTestException(object response) : base("Synthetic HTTP failure") {Response=response;} }'
}
function ErrorRecord([int]$Status,[string]$Code){
    $ex=[FiscalReceiptTestException]::new([pscustomobject]@{StatusCode=$Status})
    $record=[Management.Automation.ErrorRecord]::new($ex,'FISCAL_LOOKUP_FIXTURE',[Management.Automation.ErrorCategory]::InvalidOperation,$null)
    $record.ErrorDetails=[Management.Automation.ErrorDetails]::new((@{error=@{code=$Code;message='Synthetic lookup failure'}}|ConvertTo-Json -Compress))
    return $record
}
function Scenario([int]$MissingCount=1,[int]$Status=404,[string]$Code='WorkflowRunActionNotFound'){
    $state=[pscustomobject]@{now=[DateTimeOffset]::Parse('2026-10-29T12:00:00Z');reads=0;delays=0;delayTotal=0;missing=$MissingCount;error=(ErrorRecord $Status $Code);uris=[Collections.Generic.List[string]]::new();timeouts=[Collections.Generic.List[int]]::new()}
    $read={param($Uri,$Headers,$TimeoutSec)
        $state.reads++;$state.uris.Add($Uri);$state.timeouts.Add($TimeoutSec)
        if($state.reads -le $state.missing){throw $state.error}
        return [pscustomobject]@{name='Recibo';properties=[pscustomobject]@{status='Succeeded';outputsLink=[pscustomobject]@{uri='https://example.invalid/fixture-receipt'}}}
    }.GetNewClosure()
    $delay={param($Seconds)$state.delays++;$state.delayTotal+=$Seconds;$state.now=$state.now.AddSeconds($Seconds)}.GetNewClosure()
    $now={$state.now}.GetNewClosure()
    return [pscustomobject]@{state=$state;read=$read;delay=$delay;now=$now}
}
function Lookup($Scenario){Get-SefazReceiptAction -RunBase 'https://example.invalid/existing-run' -Headers @{Authorization='Fixture'} -Read $Scenario.read -Delay $Scenario.delay -Now $Scenario.now}
$eventual=Scenario 2
$result=Lookup $eventual
Equal $result.name 'Recibo' 'missing action eventually becomes visible'
Equal $eventual.state.reads 3 'two missing reads plus one successful lookup'
Equal $eventual.state.delays 2 'only missing reads wait'
Equal $eventual.state.delayTotal 6 'retry interval is bounded and injectable'
Equal @($eventual.state.uris|Select-Object -Unique).Count 1 'all reads target the same existing run action'
Equal $eventual.state.uris[0] 'https://example.invalid/existing-run/actions/Recibo?api-version=2016-11-01' 'only receipt lookup repeated'
$timeout=Scenario 1000
$caught=$null
try{Lookup $timeout|Out-Null}catch{$caught=$_.Exception.Message}
Equal $caught 'FLOW_RECEIPT_ACTION_WAIT_TIMEOUT' 'missing receipt times out without acknowledging'
Equal $timeout.state.delayTotal 30 'total wait never exceeds thirty seconds'
Equal $timeout.state.reads 10 'deadline prevents further reads'
Equal (@($timeout.state.timeouts|Where-Object {$_ -gt 5 -or $_ -lt 1}).Count) 0 'HTTP timeout bounded by remaining lookup budget'
foreach($case in @(@(401,'Unauthorized'),@(403,'AuthorizationFailed'),@(500,'WorkflowRunActionNotFound'),@(404,'WorkflowNotFound'))){
    $scenario=Scenario 1000 $case[0] $case[1]
    $caught=$false
    try{Lookup $scenario|Out-Null}catch{$caught=$true;Equal $_.Exception.GetType().Name 'FiscalReceiptTestException' ('original error preserved '+$case[0])}
    Equal $caught $true ('non transient error propagates '+$case[0])
    Equal $scenario.state.reads 1 ('non transient read never retried '+$case[0])
    Equal $scenario.state.delays 0 ('non transient error never delayed '+$case[0])
}
function WrappedScenario([int]$Status,[string]$NestedCode='WorkflowRunActionNotFound'){
    $scenario=Scenario 2 $Status 'AzureResourceManagerRequestFailed'
    $nested=@{error=@{code=$NestedCode;message='Synthetic action lookup failure'}}|ConvertTo-Json -Compress
    $message="Request to Azure Resource Manager failed with error: '"+$nested+"'"
    $body=@{error=@{code='AzureResourceManagerRequestFailed';message=$message}}|ConvertTo-Json -Compress
    $scenario.state.error.ErrorDetails=[Management.Automation.ErrorDetails]::new($body)
    return $scenario
}
foreach($status in @(404,500)){
    $wrapped=WrappedScenario $status
    Equal (Lookup $wrapped).name 'Recibo' ('exact nested ARM missing action is transient '+$status)
    Equal $wrapped.state.reads 3 ('ARM wrapper retries only action lookup '+$status)
}
foreach($case in @(@(401,'WorkflowRunActionNotFound'),@(403,'WorkflowRunActionNotFound'),@(500,'AuthorizationFailed'),@(404,'WorkflowNotFound'))){
    $wrapped=WrappedScenario $case[0] $case[1]
    $caught=$false
    try{Lookup $wrapped|Out-Null}catch{$caught=$true}
    Equal $caught $true ('ARM auth or unrelated nested code propagates '+$case[0]+' '+$case[1])
    Equal $wrapped.state.reads 1 'unrelated ARM wrapper is never retried'
    Equal $wrapped.state.delays 0 'unrelated ARM wrapper is never delayed'
}
$malformed=WrappedScenario 500
$body=@{error=@{code='AzureResourceManagerRequestFailed';message="Request to Azure Resource Manager failed with error: 'WorkflowRunActionNotFound but not JSON'"}}|ConvertTo-Json -Compress
$malformed.state.error.ErrorDetails=[Management.Automation.ErrorDetails]::new($body)
$caught=$false
try{Lookup $malformed|Out-Null}catch{$caught=$true}
Equal $caught $true 'code mentioned in unstructured wrapper text is not enough'
Equal $malformed.state.reads 1 'malformed wrapper is not retried'
$slow=Scenario 1000
$slowState=$slow.state
$slow.read={param($Uri,$Headers,$TimeoutSec)$slowState.reads++;$slowState.now=$slowState.now.AddSeconds(5);throw $slowState.error}.GetNewClosure()
$caught=$null
try{Lookup $slow|Out-Null}catch{$caught=$_.Exception.Message}
Equal $caught 'FLOW_RECEIPT_ACTION_WAIT_TIMEOUT' 'HTTP read time counts toward the deadline'
Equal $slow.state.reads 4 'slow missing reads cannot reset thirty second budget'
Equal $slow.state.delayTotal 10 'last delay shortened to remaining one second'
# Exercise the real Send-SefazBatch control flow offline, not a mock of the retry helper.
$module=Get-Module FlowTransport
$fixture=[pscustomobject]@{triggerCount=0;actionReads=0;runReads=0;receiptReads=0;delays=0;error=(ErrorRecord 404 'WorkflowRunActionNotFound')}
& $module {param($Fixture)
    $script:receiptRetryFixture=$Fixture
    function script:Get-PowerPlatformSessionToken {param($Resource)return 'SYNTHETIC_SESSION'}
    function script:Get-Content {param($LiteralPath,[switch]$Raw)return '{"whatsappEnabled":false}'}
    function script:Start-Sleep {param($Seconds,$Milliseconds)$script:receiptRetryFixture.delays++}
    function script:Invoke-WebRequest {
        param($Uri,$Method,$Headers,$ContentType,$Body,$TimeoutSec,[switch]$UseBasicParsing)
        if($Method -ne 'Post' -or $Uri -notlike '*/triggers/manual/run?*'){throw 'Unexpected trigger request'}
        $script:receiptRetryFixture.triggerCount++
        return [pscustomobject]@{StatusCode=202;Headers=@{'x-ms-workflow-run-id'='FIXTURERUN'}}
    }
    function script:Invoke-RestMethod {
        param($Uri,$Headers,$TimeoutSec)
        if($Uri -like '*/apis/shared_logicflows?*'){return [pscustomobject]@{properties=[pscustomobject]@{primaryRuntimeUrl='https://fixture.azure-apihub.net/apim/logicflows'}}}
        if($Uri -like '*/actions/Recibo?*'){
            $script:receiptRetryFixture.actionReads++
            if($script:receiptRetryFixture.actionReads -eq 1){throw $script:receiptRetryFixture.error}
            return [pscustomobject]@{properties=[pscustomobject]@{outputsLink=[pscustomobject]@{uri='https://example.invalid/fixture-receipt'}}}
        }
        if($Uri -eq 'https://example.invalid/fixture-receipt'){$script:receiptRetryFixture.receiptReads++;return [pscustomobject]@{source='SEFAZ';acknowledgedIds=@()}}
        if($Uri -like '*/runs/FIXTURERUN?*'){$script:receiptRetryFixture.runReads++;return [pscustomobject]@{properties=[pscustomobject]@{status='Succeeded'}}}
        throw 'Unexpected read request'
    }
} $fixture
$sent=Send-SefazBatch -Documents @() -FlowId '11111111-1111-4111-8111-111111111111' -EnvironmentId 'Default-fixture'
Equal $fixture.triggerCount 1 'eventual receipt never launches another workflow'
Equal $fixture.runReads 1 'completed workflow is not restarted or repolled'
Equal $fixture.actionReads 2 'only action lookup is repeated after success'
Equal $fixture.receiptReads 1 'receipt downloaded once after action is visible'
Equal $sent.runId 'FIXTURERUN' 'same original run is acknowledged'
Write-Output ('PASS receipt retry assertions: '+$script:passed+'; actual network calls: 0')
