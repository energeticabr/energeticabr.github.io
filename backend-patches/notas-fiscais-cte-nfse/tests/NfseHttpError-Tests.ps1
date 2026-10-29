$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/Nfse.psm1') -Force -DisableNameChecking
Add-Type -AssemblyName System.Net.Http
if(-not ('NfseHttpFixtureException' -as [type])){Add-Type 'public sealed class NfseHttpFixtureException : System.Exception { public object Response {get;set;} public NfseHttpFixtureException(object response) : base("Synthetic HTTP transport error") {Response=response;} }'}
$script:passed=0
function Equal($Actual,$Expected,$Name){if($Actual -cne $Expected){throw "$Name : expected [$Expected], actual [$Actual]"};$script:passed++}
$module=Get-Module Nfse
$fixture=[pscustomobject]@{calls=0;error=$null}
& $module {param($Fixture)
    $script:nfseHttpFixture=$Fixture
    function script:Get-CompanyCertificate($Config){return 'SYNTHETIC_CERTIFICATE_SENTINEL'}
    function script:Invoke-WebRequest {
        param($Uri,$Method,$Certificate,$Headers,$TimeoutSec,[switch]$UseBasicParsing,$MaximumRedirection)
        $script:nfseHttpFixture.calls++
        throw $script:nfseHttpFixture.error
    }
} $fixture
function HttpFailure([int]$Status,[string]$Body,[switch]$Disposed,[switch]$NoErrorDetails,[switch]$Stream){
    if($Stream){
        $response=[pscustomobject]@{StatusCode=$Status;Body=$Body}
        if($Disposed){$response|Add-Member ScriptMethod GetResponseStream {throw [ObjectDisposedException]::new('Synthetic response stream')}}
        else{$response|Add-Member ScriptMethod GetResponseStream {return [IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($this.Body))}}
    }else{
        # PS5.1's older HttpStatusCode enum has no named429 member.
        $response=[Net.Http.HttpResponseMessage]::new([Enum]::ToObject([Net.HttpStatusCode],$Status))
        $response.Content=[Net.Http.StringContent]::new($Body)
        if($Disposed){$response.Dispose()}
    }
    $exception=[NfseHttpFixtureException]::new($response)
    $record=[Management.Automation.ErrorRecord]::new($exception,'HTTP_FIXTURE',[Management.Automation.ErrorCategory]::InvalidOperation,$null)
    if(-not $NoErrorDetails){$record.ErrorDetails=[Management.Automation.ErrorDetails]::new($Body)}
    return [pscustomobject]@{record=$record;response=$response}
}
function Call($Failure){$fixture.error=$Failure.record;Invoke-NfseDistribution ([pscustomobject]@{companyCnpj='38626750000146';environment='1'}) '58'}
$empty='{"StatusProcessamento":"NENHUM_DOCUMENTO_LOCALIZADO","LoteDFe":[],"Erros":[],"Alertas":[],"TipoAmbiente":"PRODUCAO"}'
$reject='{"StatusProcessamento":"REJEICAO","LoteDFe":[],"Erros":[{"Codigo":"FIXTURE","Descricao":"Synthetic rejection"}]}'
$emptyFailure=HttpFailure 404 $empty -Disposed
Equal (Call $emptyFailure) $empty 'disposed response uses captured ErrorDetails instead of throwing ObjectDisposedException'
$parsed=ConvertFrom-NfseDistributionResponse (Call $emptyFailure) '38626750000146'
Equal $parsed.status 'NENHUM_DOCUMENTO_LOCALIZADO' 'official empty response remains interpretable'
Equal $parsed.lastNsu $null 'empty response never invents a cursor'
Equal $parsed.hasMore $false 'empty response ends the source sweep'
Equal $parsed.retryAfterSeconds 3900 'empty response retains conservative cooldown policy'
$rejectionFailure=HttpFailure 400 $reject -Disposed
Equal (Call $rejectionFailure) $reject 'HTTP400 retains captured government rejection body'
$parsed=ConvertFrom-NfseDistributionResponse (Call $rejectionFailure) '38626750000146'
Equal $parsed.status 'REJEICAO' 'HTTP400 body retains official processing status'
Equal $parsed.errors[0].Codigo 'FIXTURE' 'rejection details survive body extraction'
$readable=HttpFailure 404 $empty -NoErrorDetails
try{Equal (Call $readable) $empty 'readable HttpContent remains a fallback when ErrorDetails absent'}finally{$readable.response.Dispose()}
$unreadable=HttpFailure 404 $empty -Disposed -NoErrorDetails
$caught=$false
try{Call $unreadable|Out-Null}catch{$caught=$true;Equal ([object]::ReferenceEquals($_.Exception,$unreadable.record.Exception)) $true 'unreadable fallback preserves original HTTP exception'}
Equal $caught $true 'missing body cannot fabricate successful empty distribution'
foreach($status in @(401,403,429,500)){
    $failure=HttpFailure $status $empty -Disposed
    $caught=$false
    try{Call $failure|Out-Null}catch{$caught=$true;Equal ([object]::ReferenceEquals($_.Exception,$failure.record.Exception)) $true ('other HTTP exception propagated unchanged '+$status)}
    Equal $caught $true ('other HTTP status never treated as fiscal empty '+$status)
}
$streamBody=HttpFailure 404 $empty -Stream -NoErrorDetails
Equal (Call $streamBody) $empty 'legacy response stream is a readable fallback'
$disposedStream=HttpFailure 400 $reject -Stream -Disposed
Equal (Call $disposedStream) $reject 'captured ErrorDetails wins over disposed legacy stream'
$unreadableStream=HttpFailure 404 $empty -Stream -Disposed -NoErrorDetails
$caught=$false
try{Call $unreadableStream|Out-Null}catch{$caught=$true;Equal ([object]::ReferenceEquals($_.Exception,$unreadableStream.record.Exception)) $true 'disposed legacy stream preserves original HTTP failure'}
Equal $caught $true 'unreadable stream cannot fabricate official empty body'
Equal $fixture.calls 13 'every invocation performs one GET only; no hidden retry'
Write-Output ('PASS NFS-e HTTP error assertions: '+$script:passed+'; real API calls:0; durable source writes:0')
