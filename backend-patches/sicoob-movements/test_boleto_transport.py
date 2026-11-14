"""Run the actual PowerShell receipt reader against controlled bank failures."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


@unittest.skipUnless(shutil.which('pwsh'), 'PowerShell is required')
class BoletoTransportTest(unittest.TestCase):
    def read(self, scenario):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = r'''
$script:attempts=@{}
function Read-PrivateJson { @{cnpj='12345678000190';accountNumber='1234';clientId='fixture'} }
function Get-CompanyClientCertificate {
 $c=[pscustomobject]@{}; $c|Add-Member -MemberType ScriptMethod -Name Dispose -Value {}; return $c
}
function Start-Sleep {}
function Invoke-DdaBankRequest([scriptblock]$Action) {
 for($i=1;$i -le 2;$i++){try{return & $Action}catch{if($i -eq 2){throw}}}
}
function Invoke-RestMethod { @{access_token='fixture';scope='pagamentos_consulta'} }
function Invoke-WebRequest {
 param($Uri)
 $reference=($Uri -split '/')[-2]
 $script:attempts[$reference]++
 if($reference -eq '1111'){
  if($scenario -eq 'permanent-network'){throw [System.Net.Http.HttpRequestException]::new('offline')}
  if($scenario -eq 'transient-network' -and $script:attempts[$reference] -eq 1){throw [System.Net.Http.HttpRequestException]::new('temporary')}
  if($scenario -eq 'gateway401' -and $script:attempts[$reference] -eq 1){return @{StatusCode=401;Content='{}'}}
  if($scenario -eq 'service503' -and $script:attempts[$reference] -eq 1){return @{StatusCode=503;Content='{}'}}
  if($scenario -eq 'malformed'){return @{StatusCode=200;Content='not-json'}}
  if($scenario -eq 'unauthorized'){return @{StatusCode=401;Content='{}'}}
  if($scenario -eq 'forbidden'){return @{StatusCode=403;Content='access denied'}}
  if($scenario -eq 'not-found'){return @{StatusCode=404;Content='{}'}}
  if($scenario -eq 'rate-limit'){return @{StatusCode=429;Content='{}'}}
 }
 $body='{"resultado":{"nomeRazaoSocialBeneficiario":"Beneficiario Exemplo"}}'
 if($scenario -eq 'bytes'){$body=[Text.Encoding]::UTF8.GetBytes($body)}
 return @{StatusCode=200;Content=$body}
}
'''
            (root / 'DdaPlatform.ps1').write_text("$scenario='" + scenario + "'\n" + fixture, encoding='utf-8')
            (root / 'DdaBankHttp.ps1').write_text('', encoding='utf-8')
            source = Path(__file__).with_name('Read-SicoobBoletoReceipts.ps1').read_text(encoding='utf-8')
            source = source.replace("$collector = '/opt/energetica-whatsapp/dda-collector'",
                                    "$collector = '" + str(root).replace("'", "''") + "'")
            script = root / 'Read.ps1'
            script.write_text(source, encoding='utf-8')
            result = subprocess.run(['pwsh', '-NoProfile', '-NonInteractive', '-File', str(script)],
                input=json.dumps({'account':'1234','references':['1111','2222']}),
                capture_output=True, encoding='utf-8', timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)

    def test_transient_reads_recover_and_decode_bytes(self):
        for scenario in ('transient-network', 'gateway401', 'service503', 'bytes'):
            with self.subTest(scenario=scenario):
                result = self.read(scenario)
                self.assertEqual(result['1111']['status'], 200)
                self.assertEqual(result['2222']['receipt']['nomeRazaoSocialBeneficiario'], 'Beneficiario Exemplo')

    def test_one_failed_reference_does_not_discard_other_receipts(self):
        for scenario in ('permanent-network', 'malformed'):
            with self.subTest(scenario=scenario):
                result = self.read(scenario)
                self.assertEqual(result['1111']['status'], 0)
                self.assertIsNone(result['1111']['receipt'])
                self.assertEqual(result['2222']['status'], 200)

    def test_failed_permissions_and_missing_receipts_remain_unverified(self):
        for scenario, status in [('unauthorized', 401), ('forbidden', 403), ('not-found', 404)]:
            with self.subTest(scenario=scenario):
                result = self.read(scenario)
                self.assertEqual(result['1111'], {'status': status, 'receipt': None})
                self.assertEqual(result['2222']['status'], 200)

    def test_rate_limit_stops_batch(self):
        result = self.read('rate-limit')
        self.assertEqual(result, {'1111': {'status': 429, 'receipt': None}})
