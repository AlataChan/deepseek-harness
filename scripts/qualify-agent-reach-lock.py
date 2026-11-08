"""Qualify downloaded wheels against PyPI digests; never runs during user setup."""
import argparse
import concurrent.futures
import email
import hashlib
import json
import pathlib
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1] / 'packages' / 'experimental' / 'agent-reach'
parser = argparse.ArgumentParser(description=__doc__)
for field in ['wheel-root', 'python-metadata', 'uv-assets', 'source-archive', 'qualified-wheel','supplemental-source','supplemental-wheel']:
    parser.add_argument('--'+field, type=pathlib.Path, required=True)
args = parser.parse_args()
ARTIFACTS = args.wheel_root
metadata = json.loads(args.python_metadata.read_text())
assets = [json.loads(line) for line in args.uv_assets.read_text().splitlines()]
platforms = {}
for key, os_name, arch, triple in [
    ('darwin-arm64', 'darwin', 'aarch64', 'aarch64-apple-darwin'),
    ('darwin-x64', 'darwin', 'x86_64', 'x86_64-apple-darwin'),
    ('linux-x64', 'linux', 'x86_64', 'x86_64-unknown-linux-gnu'),
    ('win32-x64', 'windows', 'x86_64', 'x86_64-pc-windows-msvc'),
]:
    python_key = f'cpython-3.12.12-{os_name}-{arch}-' + ('gnu' if os_name == 'linux' else 'none')
    uv_name = f'uv-{triple}.' + ('zip' if os_name == 'windows' else 'tar.gz')
    uv = next(asset for asset in assets if asset['name'] == uv_name)
    platforms[key] = {
        'uv': {'url': uv.get('url') or uv['browser_download_url'], 'sha256': uv['digest'].split(':')[1],
               'filename': uv_name, 'executable': 'uv.exe' if os_name == 'windows' else f'uv-{triple}/uv'},
        'python': {'key': python_key, 'metadata': metadata[python_key]},
        'wheels': {},
    }

wheel_files = sorted({file.name: file for file in ARTIFACTS.rglob('*.whl') if not file.name.startswith('agent_reach-')}.values())
def qualify(file):
    with zipfile.ZipFile(file) as wheel:
        name = next(name for name in wheel.namelist() if name.endswith('.dist-info/METADATA'))
        msg = email.message_from_bytes(wheel.read(name))
    data = json.load(urllib.request.urlopen(f"https://pypi.org/pypi/{msg['Name']}/{msg['Version']}/json"))
    entry = next(row for row in data['urls'] if row['filename'] == file.name)
    digest = hashlib.sha256(file.read_bytes()).hexdigest()
    if digest != entry['digests']['sha256']:
        raise ValueError(f'Digest mismatch: {file.name}')
    return file.name, {'name': msg['Name'], 'version': msg['Version'], 'filename': file.name,
                       'url': entry['url'], 'sha256': digest,
                       'license': msg.get('License-Expression') or msg.get('License') or 'See wheel license files'}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    wheels = dict(pool.map(qualify, wheel_files))
for platform, value in platforms.items():
    for group in ['core', 'build', 'bili']:
        value['wheels'][group] = [wheels[file.name] for file in sorted((ARTIFACTS/platform/group).glob('*.whl'))
                                   if not file.name.startswith('agent_reach-')]
source = args.source_archive
wheel = args.qualified_wheel
lock = {'schemaVersion': 1, 'uvVersion': '0.10.8', 'pythonVersion': '3.12.12', 'source': {
    'url': 'https://codeload.github.com/Panniantong/Agent-Reach/tar.gz/c70ae6da5d39bc90e09ad2ae0575ccc89f31e284',
    'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'directory': 'Agent-Reach-c70ae6da5d39bc90e09ad2ae0575ccc89f31e284',
    'wheelFilename': wheel.name, 'wheelSha256': hashlib.sha256(wheel.read_bytes()).hexdigest(),
    'sourceDateEpoch': '315532800',
}, 'platforms': platforms,
 'supplementalSources': [{'name':'qrcode-terminal','version':'0.8','license':'MIT',
   'url':'https://files.pythonhosted.org/packages/' + '',
   'sha256':hashlib.sha256(args.supplemental_source.read_bytes()).hexdigest(),
   'directory':'qrcode-terminal-0.8', 'wheelFilename':args.supplemental_wheel.name,
   'wheelSha256':hashlib.sha256(args.supplemental_wheel.read_bytes()).hexdigest(),
   'sourceDateEpoch':'315532800'}]}
# The qualified sdist URL is release metadata, not a mutable index resolution during setup.
source_metadata=json.load(urllib.request.urlopen('https://pypi.org/pypi/qrcode-terminal/0.8/json'))
sdist=next(item for item in source_metadata['urls'] if item['filename']=='qrcode-terminal-0.8.tar.gz')
assert sdist['digests']['sha256']==lock['supplementalSources'][0]['sha256']
lock['supplementalSources'][0]['url']=sdist['url']
(ROOT/'dependency-lock.json').write_text(json.dumps(lock, indent=2)+'\n')
print(f'Qualified {len(wheels)} distinct wheels for {len(platforms)} platforms')
