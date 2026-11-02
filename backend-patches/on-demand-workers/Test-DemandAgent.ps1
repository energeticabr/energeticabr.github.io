$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'DemandAgent.psm1') -Force
$checks=0
function Reject([string]$Line){
 $rejected=$false
 try{$null=ConvertFrom-DemandEvent $Line}catch{$rejected=$true}
 if(-not $rejected){throw "Accepted invalid event: $Line"}
 $script:checks++
}
foreach($line in @('not json','{}','{"event":"wake"}','{"event":"wake","queue":"powershell"}',
 '{"event":"wake","queue":"DDA"}','{"event":"wake","queue":"dda","command":"anything"}',
 '{"event":"ready","queue":"dda"}','{"event":"other"}','[]',('x'*513))){Reject $line}
foreach($name in @('ready','heartbeat')){
 $event=ConvertFrom-DemandEvent ('{"event":"'+$name+'"}')
 if($event.event -cne $name){throw 'Control event changed'}
 $checks++
}
foreach($name in @('dda','fiscal')){
 $event=ConvertFrom-DemandEvent ('{"event":"wake","queue":"'+$name+'"}')
 if($event.queue -cne $name){throw 'Queue changed'}
 $checks++
}
$cfg=@{host='opc@example.test';keyPath='C:\key with spaces';remoteScript='/opt/energetica-whatsapp/worker/demand_watch.py'}
$psi=New-DemandConnection $cfg
if($psi.UseShellExecute -or -not $psi.CreateNoWindow -or -not $psi.RedirectStandardOutput -or -not $psi.RedirectStandardError){throw 'Connection must be windowless with drained output'}
if(-not $psi.ArgumentList.Contains('StrictHostKeyChecking=yes')){throw 'SSH host verification missing'}
if($psi.ArgumentList[-1] -cne 'sudo -n -u energetica-whatsapp /usr/bin/python3 -u /opt/energetica-whatsapp/worker/demand_watch.py'){throw 'Unexpected remote command'}
$checks++
$cfg.remoteScript='/opt/watch.py;touch /tmp/anything'
$rejected=$false;try{$null=New-DemandConnection $cfg}catch{$rejected=$true}
if(-not $rejected){throw 'Remote shell injection accepted'}
$checks++
Write-Output "$checks demand agent checks passed"
