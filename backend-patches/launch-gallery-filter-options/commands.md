# Scoped rollout commands

Run from the repository root, using the existing authorized SSH key without
printing or reading its contents. These commands preserve the old quick-search
stage and deploy only `worker/launch_gallery.py` to the two pinned roots.

```powershell
$taskKey = 'C:/Users/Bernardonotini/OneDrive - energetica/Documents/New project/whatsapp-sharepoint-oci/.secrets/oci_vm_rsa'
$taskVm = 'opc@163.176.171.217'
$taskStage = '/home/opc/gallery-filter-options-20261009'
ssh -i $taskKey -o BatchMode=yes -o ConnectTimeout=10 $taskVm 'sha256sum /home/opc/energetica-build/worker/launch_gallery.py && sudo -n sha256sum /opt/energetica-whatsapp/worker/launch_gallery.py'
ssh -i $taskKey -o BatchMode=yes $taskVm "test ! -e $taskStage && mkdir -p $taskStage/candidate/worker"
scp -i $taskKey -o BatchMode=yes backend-patches/launch-gallery-quick-search/candidate/worker/launch_gallery.py "${taskVm}:$taskStage/candidate/worker/launch_gallery.py"
scp -i $taskKey -o BatchMode=yes backend-patches/launch-gallery-filter-options/deploy.py backend-patches/launch-gallery-filter-options/deploy-manifest.json "${taskVm}:$taskStage/"
scp -i $taskKey -o BatchMode=yes backend-patches/launch-gallery-quick-search/deploy.py "${taskVm}:$taskStage/gallery_deploy_runner.py"
scp -i $taskKey -o BatchMode=yes backend-patches/launch-payroll-per-payment/deploy.py "${taskVm}:$taskStage/shared_deploy_runner.py"
ssh -i $taskKey -o BatchMode=yes $taskVm "sha256sum $taskStage/deploy.py $taskStage/deploy-manifest.json $taskStage/gallery_deploy_runner.py $taskStage/shared_deploy_runner.py $taskStage/candidate/worker/launch_gallery.py"
$taskManifestHash = (Get-FileHash backend-patches/launch-gallery-filter-options/deploy-manifest.json -Algorithm SHA256).Hash.ToLowerInvariant()
ssh -i $taskKey -o BatchMode=yes $taskVm "sudo -n /opt/energetica-whatsapp/.venv/bin/python $taskStage/deploy.py --check $taskManifestHash"
# Only after the checks, regression tests and review pass:
ssh -i $taskKey -o BatchMode=yes $taskVm "sudo -n /opt/energetica-whatsapp/.venv/bin/python $taskStage/deploy.py --deploy $taskManifestHash"
ssh -i $taskKey -o BatchMode=yes $taskVm 'sha256sum /home/opc/energetica-build/worker/launch_gallery.py && sudo -n sha256sum /opt/energetica-whatsapp/worker/launch_gallery.py && systemctl is-active energetica-channel-bridge.service energetica-whatsmeow.service && curl -fsS http://127.0.0.1:8765/health'
```

Compare all five staged digests with the local digests before invoking the CLI.
The manifest SHA-256 is
`22d741d9bae0800c12e1b2e2b93b9dab6783db64cc98c19128c36b4b5d19fe73`.
The new wrapper SHA-256 is
`8a0b635de2eef8c73d2732dca6f01d934fdf1a2cfd71cb84ad69526686813c91`.
The reused runner and candidate pins are listed in `README.md`.
