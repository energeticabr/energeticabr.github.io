import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from deploy_webhook import patched_caddy


class ConfigurationTests(unittest.TestCase):
    def test_caddy_preserves_existing_routes_and_rejects_second_install(self):
        original = 'example.com {\n\thandle /api/portal-chat {\n\t\treverse_proxy 127.0.0.1:8765\n\t}\n}\n'
        updated = patched_caddy(original)
        self.assertIn('\t\treverse_proxy 127.0.0.1:8765', updated)
        self.assertEqual(updated.count('reverse_proxy 127.0.0.1:8775'), 1)
        with self.assertRaises(ValueError):
            patched_caddy(updated)

    def run_registration(self, scenario):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = '''
$script:registered=$false
function Read-PrivateJson {
 param($Path)
 if($Path -match 'sicoob-webhook-credentials'){
  if($scenario -eq 'fallback'){return @{}}
  return @{cnpj='12345678000190';accountNumber='1234';clientId='webhook-client'}
 }
 return @{cnpj='12345678000190'; accountNumber='1234'; clientId='fixture'}
}
function Get-CompanyClientCertificate {
 $cert=[pscustomobject]@{}
 $cert|Add-Member -MemberType ScriptMethod -Name Dispose -Value {}
 return $cert
}
function Start-Sleep {}
function Get-Content { 'x'*43 }
function Invoke-RestMethod { @{status='ok'} }
function Invoke-WebRequest {
 param($Uri,$Method,$Body)
 if($Uri -match '/token$'){
  $expected=if($scenario -eq 'fallback'){'fixture'}else{'webhook-client'}
  if($Body.client_id -cne $expected){throw 'WRONG_WEBHOOK_CLIENT'}
  if($scenario -eq 'invalid_scope'){return @{StatusCode=400;Content='{"error":"invalid_scope"}'}}
  return @{StatusCode=200;Content='{"scope":"pixpagamentos_webhook","access_token":"fixture"}'}
 }
 if($Method -eq 'Put'){
  if($scenario -eq 'existing'){throw 'UNEXPECTED_OVERWRITE'}
  $value=ConvertFrom-Json $Body
  if($value.webhookUrl -cne ('https://163-176-171-217.sslip.io/api/sicoob-pix/'+('x'*43))){throw 'BAD_REGISTRATION'}
  $script:registered=$true
  return @{StatusCode=200;Content='{}'}
 }
 if($scenario -eq 'existing' -or ($script:registered -and $scenario -eq 'bad_readback')){
  return @{StatusCode=200;Content='{"webhookUrl":"https://existing.example/callback"}'}
 }
 if($script:registered){
  return @{StatusCode=200;Content=(@{webhookUrl=('https://163-176-171-217.sslip.io/api/sicoob-pix/'+('x'*43))}|ConvertTo-Json)}
 }
 return @{StatusCode=404;Content='{}'}
}
'''
            (root / 'DdaPlatform.ps1').write_text("$scenario='" + scenario + "'\n" + fixture, encoding='utf-8')
            (root / 'DdaBankHttp.ps1').write_text('', encoding='utf-8')
            source = Path(__file__).with_name('Configure-SicoobPixWebhook.ps1').read_text(encoding='utf-8')
            source = source.replace("$collector='/opt/energetica-whatsapp/dda-collector'",
                                    "$collector='" + str(root).replace("'", "''") + "'")
            script = root / 'Configure.ps1'
            script.write_text(source, encoding='utf-8')
            return subprocess.run(['pwsh', '-NoLogo', '-NoProfile', '-NonInteractive', '-File', str(script), '-Mode', 'Register'],
                                  capture_output=True, encoding='utf-8', timeout=30)

    @unittest.skipUnless(shutil.which('pwsh'), 'PowerShell is required')
    def test_registration_requires_scope_preserves_other_callback_and_verifies_readback(self):
        denied = self.run_registration('invalid_scope')
        self.assertEqual(denied.returncode, 2)
        self.assertEqual(json.loads(denied.stdout)['error'], 'invalid_scope')
        existing = self.run_registration('existing')
        self.assertNotEqual(existing.returncode, 0)
        self.assertIn('EXISTING_CALLBACK_PRESERVED', existing.stderr)
        self.assertNotIn('UNEXPECTED_OVERWRITE', existing.stderr)
        mismatch = self.run_registration('bad_readback')
        self.assertNotEqual(mismatch.returncode, 0)
        self.assertIn('WEBHOOK_READBACK_MISMATCH', mismatch.stderr)
        registered = self.run_registration('new')
        self.assertEqual(registered.returncode, 0, registered.stderr)
        self.assertTrue(json.loads(registered.stdout)['verified'])
        self.assertNotIn('x'*43, registered.stdout + registered.stderr)
        fallback = self.run_registration('fallback')
        self.assertEqual(fallback.returncode, 0, fallback.stderr)
