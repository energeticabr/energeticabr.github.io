"""Exercise the actual PowerShell reader with an isolated, fake bank transport."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class PixTransportTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('pwsh'), 'PowerShell is required')
    def test_preserves_responses_for_ids_that_differ_only_in_case(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'DdaPlatform.ps1').write_text('''
function Read-PrivateJson { @{cnpj='12345678000190'; accountNumber='1234'; clientId='fixture'} }
function Get-CompanyClientCertificate {
    $cert=[pscustomobject]@{}
    $cert | Add-Member -MemberType ScriptMethod -Name Dispose -Value {}
    return $cert
}
function Start-Sleep {}
function Invoke-RestMethod { @{scope='pixpagamentos_consulta'; access_token='fixture'} }
function Invoke-WebRequest {
    param($Uri)
    $id=($Uri -split '/')[-1]
    @{StatusCode=200; Content=(@{endToEndId=$id}|ConvertTo-Json -Compress)}
}
''', encoding='utf-8')
            (root / 'DdaBankHttp.ps1').write_text('', encoding='utf-8')
            source = Path(__file__).with_name('Read-SicoobPixDetails.ps1').read_text(encoding='utf-8')
            source = source.replace("$collector='/opt/energetica-whatsapp/dda-collector'",
                                    "$collector='" + str(root).replace("'", "''") + "'")
            script = root / 'Read-SicoobPixDetails.ps1'
            script.write_text(source, encoding='utf-8')
            ids = ['E12345678202611111234aAbBcCdDeEf', 'E12345678202611111234AAbBcCdDeEf']
            result = subprocess.run(
                ['pwsh', '-NoLogo', '-NoProfile', '-NonInteractive', '-File', str(script)],
                input=json.dumps({'account': '1234', 'ids': ids}), text=True,
                encoding='utf-8', capture_output=True, timeout=30, check=True)
            answers = json.loads(result.stdout)['results']
            self.assertEqual(set(answers), set(ids))
            for identifier in ids:
                self.assertEqual(answers[identifier]['status'], 200)
                self.assertEqual(answers[identifier]['result']['endToEndId'], identifier)
