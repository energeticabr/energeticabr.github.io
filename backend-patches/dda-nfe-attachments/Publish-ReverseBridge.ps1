param([Parameter(Mandatory=$true)][string]$SessionScript)
$ErrorActionPreference='Stop'
# SessionScript must initialize flowBase/flowAuth; never include tokens in this repository.
. $SessionScript
$id='63618d6b-74aa-4a3d-a315-60cdd788d201'
$url=$script:flowBase+'/flows/'+$id+'?api-version=2016-11-01'
$live=Invoke-RestMethod -Uri $url -Headers $script:flowAuth
$backup=Join-Path $env:TEMP ('dda-fiscal-definition-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json')
$live.properties.definition|ConvertTo-Json -Depth 100|Set-Content $backup
Copy-Item $backup (Join-Path $PSScriptRoot 'live-definition-before.json')
& (Join-Path $PSScriptRoot 'Build-ReverseBridge.ps1')
$definition=Get-Content (Join-Path $PSScriptRoot 'fiscal-bridge-definition.json') -Raw|ConvertFrom-Json -AsHashtable
$latest=Invoke-RestMethod -Uri $url -Headers $script:flowAuth
if(($live.properties.definition|ConvertTo-Json -Depth 100 -Compress) -cne ($latest.properties.definition|ConvertTo-Json -Depth 100 -Compress)){throw 'FLOW_CHANGED_DURING_BUILD'}
$body=@{properties=@{apiId=$live.properties.apiId;displayName=$live.properties.displayName;state=$live.properties.state;definition=$definition;connectionReferences=$live.properties.connectionReferences;flowFailureAlertSubscribed=$false}}|ConvertTo-Json -Depth 100
$null=Invoke-RestMethod -Uri $url -Method PATCH -Headers $script:flowAuth -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body))
$readback=Invoke-RestMethod -Uri $url -Headers $script:flowAuth
if($readback.properties.state -ne 'Started' -or 'dda_sync' -notin $readback.properties.definition.triggers.manual.inputs.schema.properties.mode.enum){throw 'PUBLISH_READBACK_FAILED'}
@{flowId=$id;state=$readback.properties.state;backup=$backup}|ConvertTo-Json
