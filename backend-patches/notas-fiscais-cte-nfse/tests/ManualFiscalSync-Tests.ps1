$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/ManualFiscalSync.psm1') -Force -DisableNameChecking
$script:checks=0
function Eq($a,$b,$label){if($a -cne $b){throw "$label expected [$b] got [$a]"};$script:checks++}
$base=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')
$root=Join-Path $base ('manual-fiscal-test-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root)|Out-Null
$id='a'*32;$token='b'*64
try{
 $script:job=@{requestId=$id;leaseToken=$token;sources=@{NFE=@{status='queued'};CTE=@{status='queued'};NFSE=@{status='queued'}}}
 $script:calls=[Collections.Generic.List[string]]::new();$script:reports=[Collections.Generic.List[object]]::new()
 $queue={param($action,$payload)
  $script:calls.Add($action)
  switch($action){
   'heartbeat'{return @{ok=$true}}
   'claim'{return @{job=$script:job}}
   'renew'{return @{ok=$true}}
   'progress'{$script:reports.Add($payload);return @{ok=$true;job=@{requestId=$id}}}
   'complete'{return @{ok=$true;job=@{requestId=$id;status='succeeded'}}}
   default{throw 'unexpected queue action'}
  }
 }
 $script:executed=[Collections.Generic.List[string]]::new()
 $run={param($source,$requestId,$record,$save,$renew)
  $script:executed.Add($source);& $renew
  return @{status='succeeded';documents=0}
 }
 $r=Invoke-ManualFiscalSync -DataRoot (Join-Path $root 'success') -Queue $queue -RunSource $run
 Eq ($script:executed -join ',') 'CTE,NFSE,NFE' 'all three sources run even before NFE cooldown'
 Eq @($script:reports|Where-Object {$_.result.status -ceq 'succeeded'}).Count 3 'three completion receipts'
 Eq $r.status 'succeeded' 'server aggregate returned'
 $script:executed.Clear()
 $null=Invoke-ManualFiscalSync -DataRoot (Join-Path $root 'success') -Queue $queue -RunSource $run
 Eq $script:executed.Count 0 'lost progress replays persisted completions without collection'
 $script:executed.Clear();$script:reports.Clear()
 $waitRun={param($source,$requestId,$record,$save,$renew)
  $script:executed.Add($source)
  if($source -ceq 'CTE'){throw 'do not leak arbitrary upstream content'}
  if($source -ceq 'NFE'){return @{status='waiting';code='COOLDOWN';nextAllowedAt='2030-01-01T00:00:00Z'}}
  return @{status='succeeded';documents=2}
 }
 $null=Invoke-ManualFiscalSync -DataRoot (Join-Path $root 'partial') -Queue $queue -RunSource $waitRun
 Eq ($script:executed -join ',') 'CTE,NFSE,NFE' 'failure does not prevent other source attempt'
 Eq @($script:reports|Where-Object {$_.source -ceq 'CTE' -and $_.result.code -ceq 'SYNC_FAILED'}).Count 1 'sanitized durable retry'
 Eq @($script:reports|Where-Object {$_.source -ceq 'NFE' -and $_.result.status -ceq 'waiting'}).Count 1 'cooldown is not success'
 $script:executed.Clear()
 $script:job.sources.CTE=@{status='succeeded';documents=1};$script:job.sources.NFSE=@{status='succeeded';documents=0}
 $null=Invoke-ManualFiscalSync -DataRoot (Join-Path $root 'resume') -Queue $queue -RunSource $run
 Eq ($script:executed -join ',') 'NFE' 'server completed sources never re-run'
 $busy=Join-Path $root 'busy';[IO.Directory]::CreateDirectory($busy)|Out-Null
 $lock=[IO.File]::Open((Join-Path $busy 'worker.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 try{$r=Invoke-ManualFiscalSync -DataRoot $busy -Queue {throw 'unexpected network'} -RunSource $run;Eq $r.status 'BUSY' 'native concurrent pass skipped'}finally{$lock.Dispose()}
 $script:job.sources.CTE=@{status='queued'};$script:job.sources.NFSE=@{status='queued'}
 $script:job.requestId='../invalid';$failed=$false
 try{Invoke-ManualFiscalSync -DataRoot (Join-Path $root 'invalid') -Queue $queue -RunSource {throw 'must not collect'}|Out-Null}catch{$failed=$true}
 Eq $failed $true 'invalid remote request rejected'
 $script:job.requestId=$id
 $script:executed.Clear();$script:reports.Clear()
 $invalidRun={param($source) @{status='succeeded';documents=-1}}
 $null=Invoke-ManualFiscalSync -DataRoot (Join-Path $root 'invalid-result') -Queue $queue -RunSource $invalidRun
 Eq @($script:reports|Where-Object {$_.result.status -ceq 'succeeded'}).Count 0 'invalid result cannot become successful'
 Write-Output "PASS ManualFiscalSync $script:checks assertions"
}finally{
 $resolved=[IO.Path]::GetFullPath($root)
 if((Split-Path $resolved -Parent) -cne $base -or (Split-Path $resolved -Leaf) -notlike 'manual-fiscal-test-*'){throw 'UNSAFE_TEST_CLEANUP'}
 Remove-Item -LiteralPath $resolved -Recurse -Force
}
