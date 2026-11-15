"""Exercise the actual PowerShell reader with an isolated, fake bank transport."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


@unittest.skipUnless(shutil.which('pwsh'), 'PowerShell is required')
class PixTransportTests(unittest.TestCase):
    def read(self, ids, transport):
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
''' + transport, encoding='utf-8')
            (root / 'DdaBankHttp.ps1').write_text('', encoding='utf-8')
            source = Path(__file__).with_name('Read-SicoobPixDetails.ps1').read_text(encoding='utf-8')
            source = source.replace("$collector='/opt/energetica-whatsapp/dda-collector'",
                                    "$collector='" + str(root).replace("'", "''") + "'")
            script = root / 'Read-SicoobPixDetails.ps1'
            script.write_text(source, encoding='utf-8')
            result = subprocess.run(
                ['pwsh', '-NoLogo', '-NoProfile', '-NonInteractive', '-File', str(script)],
                input=json.dumps({'account': '1234', 'ids': ids}), text=True,
                encoding='utf-8', capture_output=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)['results']

    def test_preserves_responses_for_ids_that_differ_only_in_case(self):
        ids = ['E12345678202611111234aAbBcCdDeEf', 'E12345678202611111234AAbBcCdDeEf']
        answers = self.read(ids, '''
function Invoke-WebRequest {
    param($Uri)
    $id=($Uri -split '/')[-1]
    @{StatusCode=200; Content=(@{endToEndId=$id}|ConvertTo-Json -Compress)}
}
''')
        self.assertEqual(set(answers), set(ids))
        for identifier in ids:
            self.assertEqual(answers[identifier]['status'], 200)
            self.assertEqual(answers[identifier]['result']['endToEndId'], identifier)

    def test_retries_binary_plan_errors_and_parses_binary_success(self):
        identifier = 'E12345678202611111234aAbBcCdDeEf'
        answers = self.read([identifier], '''
$script:transportCalls=0
function Invoke-WebRequest {
    param($Uri)
    $script:transportCalls++
    if ($script:transportCalls -eq 1) {
        return @{StatusCode=403; Content=[Text.Encoding]::UTF8.GetBytes('{"error":"Not registered to plan"}')}
    }
    $id=($Uri -split '/')[-1]
    $content=[Text.Encoding]::UTF8.GetBytes((@{endToEndId=$id}|ConvertTo-Json -Compress))
    return @{StatusCode=200; Content=$content}
}
''')
        self.assertEqual(answers[identifier], {'status': 200, 'result': {'endToEndId': identifier}})

    def test_marks_only_denials_that_name_the_requested_identifier(self):
        ids = ['E12345678202611111234aAbBcCdDeEf', 'E12345678202611111234AAbBcCdDeEf']
        answers = self.read(ids, '''
function Invoke-WebRequest {
    param($Uri)
    $id=($Uri -split '/')[-1]
    $detail=if($id.EndsWith('aAbBcCdDeEf')){"O usuário não possui permissão para consultar $id"}else{"O usuário não possui permissão para consultar ${id}X"}
    $content=[Text.Encoding]::UTF8.GetBytes((@{detail=$detail}|ConvertTo-Json -Compress))
    return @{StatusCode=403; Content=$content}
}
''')
        self.assertEqual(answers[ids[0]], {'status': 403, 'result': None, 'identifierDenied': True})
        self.assertEqual(answers[ids[1]], {'status': 403, 'result': None})

    def test_does_not_retry_an_unclassified_403(self):
        identifier = 'E12345678202611111234aAbBcCdDeEf'
        answers = self.read([identifier], '''
$script:transportCalls=0
function Invoke-WebRequest {
    $script:transportCalls++
    if ($script:transportCalls -gt 1) { throw 'Unexpected retry' }
    @{StatusCode=403; Content=[Text.Encoding]::UTF8.GetBytes('{"error":"Access denied"}')}
}
''')
        self.assertEqual(answers[identifier], {'status': 403, 'result': None})
