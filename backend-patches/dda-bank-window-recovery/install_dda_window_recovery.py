"""Install bounded DDA bank-list recovery in the OCI collector."""
import argparse
import fcntl
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone

COLLECTOR = Path("/opt/energetica-whatsapp/dda-collector")
TARGET = COLLECTOR / "DdaMonitor.psm1"
LOCK = Path("/var/lib/energetica-whatsapp/dda-collector/sync.lock")
EXPECTED = "e6607ce905ab3fb37bf200246017973c1b507944b98601ce8f19be2c9df8dbb8"
OLD = """            $from=$windowStart.ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
            $until=$windowEnd.ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
            $dateType=if($AllOpen){3}else{1}
            $uri='https://api.sicoob.com.br/pagamentos/v3/boletos?numeroConta='+[uri]::EscapeDataString([string]$Credentials.accountNumber)+'&dataInicial='+$from+'&dataFinal='+$until+'&situacao='+$Situacao+'&tipoData='+$dateType
            $query=@{Method='GET';Uri=$uri;Headers=@{client_id=$Credentials.clientId;Accept='application/json'};Body=$null}
            $rows=Invoke-QueryRequest $query
            # Empty historical blocks return HTTP 204, exposed as "" by Invoke-RestMethod.
            if($rows -is [string] -and $rows.Length -eq 0){$rows=@()}
            if($rows.hasMore -or $rows.nextLink -or $rows.'@odata.nextLink'){throw 'UNEXPECTED_BANK_PAGINATION'}
            if($null -ne $rows -and $rows.PSObject.Properties.Name -contains 'resultado'){$rows=$rows.resultado}
"""
HELPER = """    function Invoke-QueryWindow([datetime]$Start,[datetime]$End,[bool]$CanSplit) {
        $from=$Start.ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
        $until=$End.ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
        $dateType=if($AllOpen){3}else{1}
        $uri='https://api.sicoob.com.br/pagamentos/v3/boletos?numeroConta='+[uri]::EscapeDataString([string]$Credentials.accountNumber)+'&dataInicial='+$from+'&dataFinal='+$until+'&situacao='+$Situacao+'&tipoData='+$dateType
        $query=@{Method='GET';Uri=$uri;Headers=@{client_id=$Credentials.clientId;Accept='application/json'};Body=$null}
        try{$rows=Invoke-QueryRequest $query}catch{
            $data=$_.Exception.Data
            # Retry the failed window as two smaller reads, at most once.
            # OAuth/TLS errors and bank rejections keep their original behavior.
            if($CanSplit -and $Start -lt $End -and $data['BankFailureKind'] -eq 'TRANSIENT_NETWORK' -and -not $data['BankTokenFailure']){
                $mid=$Start.AddDays([math]::Floor(($End-$Start).Days/2))
                Invoke-QueryWindow $Start $mid $false
                & $Wait 1
                Invoke-QueryWindow ($mid.AddDays(1)) $End $false
                return
            }
            $data['BankQueryStart']=$from;$data['BankQueryEnd']=$until
            throw
        }
        # Empty historical blocks return HTTP 204, exposed as "" by Invoke-RestMethod.
        if($rows -is [string] -and $rows.Length -eq 0){return}
        if($rows.hasMore -or $rows.nextLink -or $rows.'@odata.nextLink'){throw 'UNEXPECTED_BANK_PAGINATION'}
        if($null -ne $rows -and $rows.PSObject.Properties.Name -contains 'resultado'){$rows=$rows.resultado}
        return $rows
    }
"""
ANCHOR = "    try {\n        $collected="
DIAG = "        if($from){$safe.Data['BankQueryStart']=$from;$safe.Data['BankQueryEnd']=$until}"
NEW_DIAG = """        if($_.Exception.Data.Contains('BankQueryStart')){
            $safe.Data['BankQueryStart']=$_.Exception.Data['BankQueryStart']
            $safe.Data['BankQueryEnd']=$_.Exception.Data['BankQueryEnd']
        }elseif($windowStart){
            $safe.Data['BankQueryStart']=$windowStart.ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
            $safe.Data['BankQueryEnd']=$windowEnd.ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
        }"""


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise RuntimeError("COLLECTOR_SOURCE_ANCHOR_CHANGED")
    return source.replace(old, new)


def make_candidate(raw):
    if hashlib.sha256(raw).hexdigest() != EXPECTED:
        raise RuntimeError("LIVE_SOURCE_CHANGED")
    source = raw.decode()
    crlf = "\r\n" in source
    source = source.replace("\r\n", "\n")
    source = replace_once(source, OLD, "            $rows=@(Invoke-QueryWindow $windowStart $windowEnd ([bool]$AllOpen))\n")
    source = replace_once(source, ANCHOR, HELPER + ANCHOR)
    source = replace_once(source, DIAG, NEW_DIAG)
    return (source.replace("\n", "\r\n") if crlf else source).encode()


def install_atomic(data, original_stat):
    fd, tmp = tempfile.mkstemp(prefix=".DdaMonitor.", dir=COLLECTOR)
    with os.fdopen(fd, "wb") as f:
        try:
            f.write(data)
            f.flush()
            os.fchown(f.fileno(), original_stat.st_uid, original_stat.st_gid)
            os.fchmod(f.fileno(), original_stat.st_mode & 0o777)
            os.fsync(f.fileno())
            os.replace(tmp, TARGET)
        finally:
            Path(tmp).unlink(missing_ok=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("test", type=Path)
    p.add_argument("--apply", action="store_true")
    args = p.parse_args()
    original = TARGET.read_bytes()
    candidate = make_candidate(original)
    with tempfile.TemporaryDirectory(prefix="dda-window-test-") as temp:
        stage = Path(temp)
        for name in ("DdaPlatform.ps1", "DdaBankHttp.ps1", "DdaBankStatus.ps1"):
            shutil.copyfile(COLLECTOR / name, stage / name)
        (stage / TARGET.name).write_bytes(candidate)
        subprocess.run(["pwsh", "-NoLogo", "-NoProfile", "-NonInteractive", "-File",
                        str(args.test.resolve()), "-CollectorPath", temp], check=True, timeout=60)
    print(f"candidate_sha256={hashlib.sha256(candidate).hexdigest()}", flush=True)
    if not args.apply:
        return
    with LOCK.open("r+b") as lock:
        fcntl.lockf(lock, fcntl.LOCK_EX | fcntl.LOCK_NB, 1)
        if TARGET.read_bytes() != original:
            raise RuntimeError("LIVE_SOURCE_CHANGED_UNDER_LOCK")
        stat = TARGET.stat()
        backup_dir = Path("/var/backups/energetica-dda-window-recovery") / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup_dir.mkdir(mode=0o700, parents=True)
        backup = backup_dir / TARGET.name
        shutil.copy2(TARGET, backup)
        try:
            install_atomic(candidate, stat)
            if TARGET.read_bytes() != candidate:
                raise RuntimeError("INSTALL_READBACK_MISMATCH")
        except BaseException:
            install_atomic(original, stat)
            raise
        print(f"installed={TARGET} backup={backup}", flush=True)


if __name__ == "__main__":
    main()
