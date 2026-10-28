$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'DdaWorker.psm1') -Force
$started=[datetime]::UtcNow.AddSeconds(-5)
$base=@{status='succeeded';failed=0;completedUtc=[datetime]::UtcNow.ToString('o');created=1;updated=2;verified=3}
function Assert($Value,$Expected){if($Value -ne $Expected){throw "Expected $Expected, got $Value"}}
Assert (ConvertTo-DdaWorkerReceipt ($base|ConvertTo-Json -Compress) 0 $started).status 'succeeded'
Assert (ConvertTo-DdaWorkerReceipt ($base|ConvertTo-Json -Compress) 1 $started).status 'failed'
Assert (ConvertTo-DdaWorkerReceipt '' 0 $started).status 'failed'
$base.completedUtc=$started.AddDays(-1).ToString('o')
Assert (ConvertTo-DdaWorkerReceipt ($base|ConvertTo-Json -Compress) 0 $started).status 'failed'
$base.completedUtc=[datetime]::UtcNow.ToString('o');$base.failed=1
Assert (ConvertTo-DdaWorkerReceipt ($base|ConvertTo-Json -Compress) 0 $started).status 'failed'
$base.failed=0;$base.verified='3'
Assert (ConvertTo-DdaWorkerReceipt ($base|ConvertTo-Json -Compress) 0 $started).status 'failed'
'6 worker receipt checks passed'
