"""Apply only the reviewed civil-date changes, preserving independent source roots."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from urllib.request import urlopen

ROOTS = [Path('/opt/energetica-whatsapp'), Path('/home/opc/energetica-build')]
EXPECTED = {
    str(ROOTS[0]/'worker/clients.py'): 'b221bb102727ed0f9f36d0f116e7ddf2ea32b0c237fe1801f23829cebede882f',
    str(ROOTS[1]/'worker/clients.py'): 'b221bb102727ed0f9f36d0f116e7ddf2ea32b0c237fe1801f23829cebede882f',
    str(ROOTS[0]/'worker/provision_description_settlement.py'): '78e232bb30455b80d5a1c5ef10f2b8fa9fff342cd938a671b05f5362fef707b7',
    str(ROOTS[1]/'worker/provision_description_settlement.py'): 'dd66a95ddac338cfaae86ff979d22e4f93380ef25a049b305d34ad4e3199e283',
}

def change(text, name):
    if name == 'clients.py':
        old = '            return actual_datetime == expected_datetime\n'
        new = ('            if field_type == "DateTime" and actual_datetime.tzinfo is not None:\n'
               '                # A date-only expectation confirms a civil day, including\n'
               '                # values normalized to noon by downstream SharePoint flows.\n'
               '                return actual_datetime.astimezone(SAO_PAULO_TZ).date() == date.fromisoformat(expected)\n'+old)
        assert text.count(old) == 1
        return text.replace(old,new)
    old = "if key in {'DATA PGTO EFETUADO', 'DATA PREVISTO PGTO'}"
    assert text.count(old) == 1
    text=text.replace(old,"if key in {'DATA PGTO EFETUADO', 'DATA PREVISTO PGTO', 'DATA PEDIDO'}")
    old="            order = {**copy.deepcopy(live), 'VALORTOTAL': _canonical(total)}\n"
    assert text.count(old) == 1
    return text.replace(old,old+"            # SharePoint reads DateTime as ISO; keep the frozen order plan date-only.\n"+COMPAT)

COMPAT = ("            frozen = prior or next((plan.get('fields') or {}\n"
    "                for plan in (group.get('journal') or {}).get('order_plan', [])\n"
    "                if plan.get('token') == token), {})\n"
    "            frozen_date = frozen.get('DATA PEDIDO')\n"
    "            order['DATA PEDIDO'] = (frozen_date if _same('DATA PEDIDO', live['DATA PEDIDO'], frozen_date)\n"
    "                                    else _date(live['DATA PEDIDO']).isoformat())\n")

def restart():
    subprocess.run(['systemctl','restart','energetica-channel-bridge','energetica-whatsapp'],check=True)
    for attempt in range(15):
        try:
            with urlopen('http://127.0.0.1:8765/health',timeout=4) as response:
                if json.load(response).get('status') == 'ok': return
        except Exception: pass
        time.sleep(1)
    raise RuntimeError('Service health did not recover')

def main():
    plan=[]
    expected_sources = EXPECTED
    if '--upgrade-v1' in sys.argv:
        expected_sources = {
            str(ROOTS[0]/'worker/provision_description_settlement.py'): '7c33f13bf8c670c6c04bf2b3f3229d3a35f835566f7a6274822fe8ad3fd6a0df',
            str(ROOTS[1]/'worker/provision_description_settlement.py'): 'd1b1a2524dfddb14bcd99cb73c0303993137d37f06630ddb20b4c051e46987eb',
        }
    for name,expected in expected_sources.items():
        path=Path(name); before=path.read_bytes()
        assert hashlib.sha256(before).hexdigest()==expected, 'Source drift: '+name
        if '--upgrade-v1' in sys.argv:
            old="            order['DATA PEDIDO'] = _date(live['DATA PEDIDO']).isoformat()\n"
            assert before.decode().count(old)==1
            after=before.decode().replace(old,COMPAT).encode()
        else:
            after=change(before.decode(),path.name).encode()
        compile(after,name,'exec')
        plan.append((path,after))
    report={'files':[{'path':str(p),'before':expected_sources[str(p)],'after':hashlib.sha256(a).hexdigest()} for p,a in plan]}
    if '--apply' not in sys.argv:
        print(json.dumps(report));return
    backup=ROOTS[0]/'backups'/('provision-dates-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(mode=0o700)
    originals=[]
    try:
        for index,(path,after) in enumerate(plan):
            saved=backup/str(index);shutil.copy2(path,saved);originals.append((path,saved))
            stat=path.stat();temporary=path.with_name(path.name+'.dates-new')
            temporary.write_bytes(after);os.chmod(temporary,stat.st_mode);os.chown(temporary,stat.st_uid,stat.st_gid)
            os.replace(temporary,path)
        restart()
    except Exception:
        for path,saved in originals: shutil.copy2(saved,path)
        restart();raise
    report.update(installed=True,backup=str(backup),health='ok')
    (backup/'manifest.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report))

if __name__=='__main__':main()
