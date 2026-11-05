from pathlib import Path
import hashlib,json
src=Path.cwd();app=Path('/tmp/octopus-rc1-final-20261105/octopus_DSH.app')
resources=app/'Contents/Resources/resources'
manifest=json.loads(Path('.plans/rc1-execution/dependent-final-artifact.json').read_text())
packages={}
for p in (src/'packages').glob('*/*/package.json'):
 j=json.loads(p.read_text());packages[j['name']]=p.parent
roots=[resources/'harness/node_modules',resources/'profile-plugins']
matched=[]; mismatches=[]
for root in roots:
 for scope in root.glob('@*'):
  for p in scope.glob('*/package.json'):
   j=json.loads(p.read_text()); source=packages.get(j.get('name'))
   if source is None: continue
   for built in (p.parent/'lib').rglob('*'):
    if not built.is_file() or built.suffix not in {'.js','.css'}: continue
    rel=built.relative_to(p.parent);original=source/rel
    if not original.is_file(): continue
    a=hashlib.sha256(original.read_bytes()).hexdigest();b=hashlib.sha256(built.read_bytes()).hexdigest()
    row={'package':j['name'],'file':str(rel),'sourceSha256':a,'artifactSha256':b}
    (matched if a==b else mismatches).append(row)
for rel in ['desktop-companion.js']:
 a=src/'apps/cli/lib'/rel;b=resources/'harness/lib'/rel
 if a.exists() and b.exists():
  assert a.read_bytes()==b.read_bytes(),rel
  matched.append({'package':'apps/cli','file':'lib/'+rel,'sourceSha256':hashlib.sha256(a.read_bytes()).hexdigest(),'artifactSha256':hashlib.sha256(b.read_bytes()).hexdigest()})
result={'artifact':manifest,'matchedBuiltJsCssFiles':len(matched),'mismatches':mismatches,'files':matched}
Path('.plans/rc1-execution/dependent-final-artifact-correspondence.json').write_text(json.dumps(result,indent=2)+'\n')
print('Compared built JS/CSS:',len(matched),'mismatches:',len(mismatches))
assert len(matched)>100
assert not mismatches,[(r['package'],r['file'])for r in mismatches[:10]]
