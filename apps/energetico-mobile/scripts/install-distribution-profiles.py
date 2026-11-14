"""Install the selected app's two App Store profiles on an ephemeral macOS runner."""
import base64
import datetime
import hashlib
import json
import os
import pathlib
import plistlib
import subprocess
import sys

team = os.environ['APPLE_TEAM_ID']
temporary = pathlib.Path(os.environ['RUNNER_TEMP'])
nb = sys.argv[1:] == ['--nb']
assert not sys.argv[1:] or nb, 'Unknown distribution profile mode'
bundle_base = 'br.com.energetica.nbparticipacoes' if nb else 'br.com.energetica.energetico'
variables = ('nb-app.mobileprovision', 'nb-share.mobileprovision') if nb else ('APPLE_APP_PROFILE_B64', 'APPLE_SHARE_PROFILE_B64')
identities = subprocess.run(['security', 'find-identity', '-v', '-p', 'codesigning'], check=True,
                            capture_output=True, text=True).stdout if nb else ''
profiles = {}
for bundle, variable in zip((bundle_base, bundle_base + '.share'), variables):
    source = temporary / (variable if nb else variable + '.mobileprovision')
    if not nb:
        source.write_bytes(base64.b64decode(os.environ[variable], validate=True))
    content = source.read_bytes()
    source.chmod(0o600)
    decoded = subprocess.run(['security', 'cms', '-D', '-i', str(source)], capture_output=True, check=True).stdout
    profile = plistlib.loads(decoded)
    entitlements = profile['Entitlements']
    assert profile['TeamIdentifier'] == [team], 'Unexpected profile team'
    assert entitlements['application-identifier'] == team + '.' + bundle, 'Unexpected profile bundle'
    assert entitlements.get('get-task-allow') is False, 'Development profiles are not allowed'
    assert not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices'), 'App Store profile required'
    assert 'group.' + bundle_base in entitlements.get('com.apple.security.application-groups', []), 'Missing shared app group'
    if nb:
        assert entitlements['com.apple.security.application-groups'] == ['group.' + bundle_base], 'Unexpected NB app group'
        assert any(hashlib.sha1(cert).hexdigest().upper() in identities for cert in profile['DeveloperCertificates']), 'NB profile does not match the installed signing identity'
    assert profile['ExpirationDate'] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), 'Expired profile'
    uuid = profile['UUID']
    # Xcode 16+ uses UserData; older Xcode uses MobileDevice. Both are ephemeral runner paths.
    for directory in ('Library/Developer/Xcode/UserData/Provisioning Profiles', 'Library/MobileDevice/Provisioning Profiles'):
        destination = pathlib.Path.home() / directory
        destination.mkdir(parents=True, exist_ok=True)
        path = destination / (uuid + '.mobileprovision')
        path.write_bytes(content)
        path.chmod(0o600)
    profiles[bundle] = uuid
    print('Validated App Store distribution profile for ' + bundle)

(temporary / ('nb-signing.json' if nb else 'energetico-signing.json')).write_text(
    json.dumps({'team': team, 'profiles': profiles}))
with (temporary / 'ExportOptions.plist').open('wb') as output:
    plistlib.dump({'method': 'app-store-connect', 'destination': 'upload', 'signingStyle': 'manual',
                  'teamID': team, 'signingCertificate': 'Apple Distribution', 'provisioningProfiles': profiles,
                  'manageAppVersionAndBuildNumber': not nb,
                  **({'testFlightInternalTestingOnly': True} if nb else {})}, output)
