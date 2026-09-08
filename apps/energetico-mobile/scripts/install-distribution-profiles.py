"""Install only the two ENERGETICO App Store profiles on an ephemeral macOS runner."""
import base64
import datetime
import json
import os
import pathlib
import plistlib
import subprocess

team = os.environ['APPLE_TEAM_ID']
temporary = pathlib.Path(os.environ['RUNNER_TEMP'])
profiles = {}
for bundle, variable in (
    ('br.com.energetica.energetico', 'APPLE_APP_PROFILE_B64'),
    ('br.com.energetica.energetico.share', 'APPLE_SHARE_PROFILE_B64'),
):
    content = base64.b64decode(os.environ[variable], validate=True)
    source = temporary / (variable + '.mobileprovision')
    source.write_bytes(content)
    source.chmod(0o600)
    decoded = subprocess.run(['security', 'cms', '-D', '-i', str(source)], capture_output=True, check=True).stdout
    profile = plistlib.loads(decoded)
    entitlements = profile['Entitlements']
    assert profile['TeamIdentifier'] == [team], 'Unexpected profile team'
    assert entitlements['application-identifier'] == team + '.' + bundle, 'Unexpected profile bundle'
    assert entitlements.get('get-task-allow') is False, 'Development profiles are not allowed'
    assert not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices'), 'App Store profile required'
    assert 'group.br.com.energetica.energetico' in entitlements.get('com.apple.security.application-groups', []), 'Missing shared app group'
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

(temporary / 'energetico-signing.json').write_text(json.dumps({'team': team, 'profiles': profiles}))
with (temporary / 'ExportOptions.plist').open('wb') as output:
    plistlib.dump({'method': 'app-store-connect', 'destination': 'upload', 'signingStyle': 'manual',
                  'teamID': team, 'signingCertificate': 'Apple Distribution', 'provisioningProfiles': profiles,
                  'manageAppVersionAndBuildNumber': True}, output)
