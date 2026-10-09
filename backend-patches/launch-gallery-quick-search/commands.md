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
$taskWrapperSha = 'c692fd9518c7961dda082b8105e079416da39c56a4ec1b5c3dc5a545361d4c86'
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
