# Main-agent commands only: not executed by this slice

The following commands stage/write and eventually deploy. Only the main agent
should execute them. This slice's actual VM operations were read-only.

From PowerShell, define the package and literal reviewed hash pins:

```powershell
$taskRepo = 'C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/work/energeticabr.github.io/.worktrees/orders-gallery-layout'
$taskBundle = "$taskRepo/backend-patches/launch-gallery-quick-search"
$taskKey = 'C:/Users/Bernardonotini/OneDrive - energetica/Documents/New project/whatsapp-sharepoint-oci/.secrets/oci_vm_rsa'
$taskVm = 'opc@163.176.171.217'
$taskStage = '/home/opc/gallery-quick-search-20261009'
$taskManifestSha = '5b80b27e6827d3629b23cb0309c193047a842f839fb6f485ff7f760596315ca2'
$taskCandidateSha = '7f680cd0271b04142831eb5cbcbfd802d937873fc0755570f8dd4353c9c12c26'
$taskWrapperSha = '79d2e31cea242e7256124e89a0efe447e51548f24277d6b9c2beac9c62011248'
$taskRunnerSha = '01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2'
if ((Get-FileHash -LiteralPath "$taskBundle/deploy-manifest.json").Hash.ToLower() -ne $taskManifestSha) { throw 'Manifest drift' }
if ((Get-FileHash -LiteralPath "$taskBundle/candidate/worker/launch_gallery.py").Hash.ToLower() -ne $taskCandidateSha) { throw 'Candidate drift' }
if ((Get-FileHash -LiteralPath "$taskBundle/deploy.py").Hash.ToLower() -ne $taskWrapperSha) { throw 'Wrapper drift' }
if ((Get-FileHash -LiteralPath "$taskRepo/backend-patches/launch-payroll-per-payment/deploy.py").Hash.ToLower() -ne $taskRunnerSha) { throw 'Runner drift' }
```

Reconfirm both baselines immediately before staging against deploy-manifest.json.
Changed hashes require a refreshed rebase/test/manifest.

```powershell
ssh -i $taskKey -o BatchMode=yes $taskVm 'sha256sum /home/opc/energetica-build/worker/launch_gallery.py && sudo -n sha256sum /opt/energetica-whatsapp/worker/launch_gallery.py'
```

## Existing stage: wrapper-only update for the concurrent-change rollback fix

Use the variables and local hash gates above. This fix changes only the wrapper,
not the candidate, deploy manifest or shared runner. Do not recreate the existing
stage or reupload its other files. If the main agent's separate candidate/manifest
changes land, refresh their reviewed pins independently before running any check.

```powershell
ssh -i $taskKey -o BatchMode=yes $taskVm "test -d $taskStage && test -f $taskStage/shared_deploy_runner.py && test -f $taskStage/deploy-manifest.json && test -f $taskStage/candidate/worker/launch_gallery.py"
if ($LASTEXITCODE -ne 0) { throw 'Existing stage is incomplete' }
scp -i $taskKey -o BatchMode=yes "$taskBundle/deploy.py" ($taskVm + ':' + $taskStage + '/deploy.py')
if ($LASTEXITCODE -ne 0) { throw 'Wrapper-only upload failed' }
ssh -i $taskKey -o BatchMode=yes $taskVm "sha256sum $taskStage/deploy.py $taskStage/shared_deploy_runner.py $taskStage/deploy-manifest.json $taskStage/candidate/worker/launch_gallery.py"
if ($LASTEXITCODE -ne 0) { throw 'Stage hash inspection failed' }
```

Verify all four remote hashes against the pins above, then use the check/deploy
commands below. A rollback receipt containing rollback_incomplete and
"Concurrent source change preserved; rollback copy blocked: <target>" means the
wrapper intentionally preserved an uninstalled target's concurrent change while
the runner attempted restoration of every other installed target. Inspect the
receipt and preserved target; do not retry with the old manifest or blindly copy
the backup over the concurrent change.

## Initial staging only (skip when updating the existing stage)

Create a fresh stage (refuses an existing directory) and upload only the candidate
module plus the wrapper, manifest and exact unchanged shared runner:

```powershell
ssh -i $taskKey -o BatchMode=yes $taskVm "test ! -e $taskStage && mkdir -p $taskStage/candidate/worker"
if ($LASTEXITCODE -ne 0) { throw 'Stage creation failed or stage already exists' }
scp -i $taskKey -o BatchMode=yes "$taskBundle/candidate/worker/launch_gallery.py" ($taskVm + ':' + $taskStage + '/candidate/worker/launch_gallery.py')
if ($LASTEXITCODE -ne 0) { throw 'Candidate upload failed' }
scp -i $taskKey -o BatchMode=yes "$taskBundle/deploy.py" "$taskBundle/deploy-manifest.json" ($taskVm + ':' + $taskStage + '/')
if ($LASTEXITCODE -ne 0) { throw 'Wrapper/manifest upload failed' }
scp -i $taskKey -o BatchMode=yes "$taskRepo/backend-patches/launch-payroll-per-payment/deploy.py" ($taskVm + ':' + $taskStage + '/shared_deploy_runner.py')
if ($LASTEXITCODE -ne 0) { throw 'Runner upload failed' }
ssh -i $taskKey -o BatchMode=yes $taskVm "sha256sum $taskStage/deploy.py $taskStage/shared_deploy_runner.py $taskStage/deploy-manifest.json $taskStage/candidate/worker/launch_gallery.py"
```

## Main-agent check and deployment

Verify these four remote hashes against the four literal pins before proceeding.
The wrapper's --check compiles the stage and takes/creates the deployment lock:
it is not a read-only VM operation for this slice, despite not installing/restarting.

```powershell
ssh -i $taskKey -o BatchMode=yes $taskVm "sudo -n /opt/energetica-whatsapp/.venv/bin/python $taskStage/deploy.py --check $taskManifestSha"
if ($LASTEXITCODE -ne 0) { throw 'Deployment check failed' }
```

The actual deployment remains with the main agent:

```powershell
ssh -i $taskKey -o BatchMode=yes $taskVm "sudo -n /opt/energetica-whatsapp/.venv/bin/python $taskStage/deploy.py --deploy $taskManifestSha"
if ($LASTEXITCODE -ne 0) { throw 'Deployment failed; inspect rollback receipt' }
ssh -i $taskKey -o BatchMode=yes $taskVm 'sha256sum /home/opc/energetica-build/worker/launch_gallery.py && sudo -n sha256sum /opt/energetica-whatsapp/worker/launch_gallery.py'
```

Both final hashes must equal the candidate pin. Verify the returned deployed
receipt and the authenticated launch gallery in the main agent's workflow.
Frontend, tests outside this backend slice and releases remain with the main.
