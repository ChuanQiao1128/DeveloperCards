from pathlib import Path
import base64
import re
from email import policy
from email.parser import BytesParser
import hashlib
import json
import subprocess
import urllib.request

root=Path('/Users/qc/.codex/worktrees/mobile-ux-ota-210-20261114/draw-motion-20261113')
out=root/'exports/prerequisite-ota-210-20261114'
log=Path('/private/tmp/recallsmith-prerequisite-20261114/ota-publish.log').read_text()
expected_group=re.search(r'Update group ID\s+([0-9a-f-]+)',log).group(1)
expected_update=re.search(r'iOS update ID\s+([0-9a-f-]+)',log).group(1)
raw=subprocess.check_output(['eas','channel:view','production','--json','--non-interactive'],cwd=root/'mobile',text=True,stderr=subprocess.DEVNULL)
obj=json.loads(raw[raw.index('{'):])['currentPage']
keys=['id','group','message','createdAt','runtimeVersion','platform','gitCommitHash','isGitWorkingTreeDirty','environment','manifestPermalink']
records=[{k:u[k] for k in keys} for b in obj['updateBranches'] for g in b['updateGroups'] for u in g]
assert not obj['isPaused'] and obj['name']=='production'
u=next(u for u in records if u['platform']=='ios' and u['runtimeVersion']=='2.1.0')
assert u['group']==expected_group
assert u['id']==expected_update
assert u['gitCommitHash']=='1b3605c61191ca158866060cf637ca6a82a1d606'
assert not u['isGitWorkingTreeDirty'] and u['environment']=='production'
(out/'production-after.json').write_text(json.dumps({'channel':obj['name'],'channelId':obj['id'],'paused':obj['isPaused'],'updates':records},indent=2)+'\n')
req=urllib.request.Request('https://u.expo.dev/7fa3a504-b9b6-4e49-8b16-f738332cc198',headers={
'expo-platform':'ios','expo-runtime-version':'2.1.0','expo-channel-name':'production','expo-protocol-version':'1',
'accept':'multipart/mixed,application/expo+json,application/json'})
def get_https(url, destination, headers=None):
 args=['curl','--fail','--silent','--show-error','--location','--max-time','30','--output',str(destination),
       '--write-out','%{http_code}\\n%{content_type}']
 args.extend(['--config','-'])
 args.append(url)
 config=[]
 for key,value in (headers or {}).items():
  assert isinstance(value,str) and '\r' not in value and '\n' not in value
  config.append('header = '+json.dumps(key+': '+value))
 info=subprocess.check_output(args,input='\n'.join(config)+'\n',text=True).splitlines()
 return destination.read_bytes(),int(info[0]),info[1]
body,status,content_type=get_https(req.full_url,Path('/private/tmp/recallsmith-prerequisite-20261114/live-manifest.raw'),dict(req.header_items()))
if content_type.startswith('multipart/'):
 msg=BytesParser(policy=policy.default).parsebytes(('Content-Type: '+content_type+'\r\n\r\n').encode()+body)
 candidates=[]
 for part in msg.iter_parts():
  try: candidates.append(json.loads(part.get_payload(decode=True)))
  except (ValueError,TypeError): pass
 manifest=next(m for m in candidates if isinstance(m,dict) and m.get('id')==u['id'])
 extensions=next((m for m in candidates if isinstance(m,dict) and 'assetRequestHeaders' in m),{})
else:
 manifest=json.loads(body)
 extensions={}
assert manifest['id']==u['id'] and manifest['runtimeVersion']=='2.1.0'
launch=manifest['launchAsset']
assert launch['url'].startswith('https://')
asset_headers=extensions.get('assetRequestHeaders',{}).get(launch['key'],{})
assert 'authorization' in asset_headers
bundle,bundle_status,_=get_https(launch['url'],Path('/private/tmp/recallsmith-prerequisite-20261114/live-bundle.hbc'),asset_headers)
assert len(bundle)<30_000_001
hash_bytes=hashlib.sha256(bundle).digest()
hash_url=base64.urlsafe_b64encode(hash_bytes).decode().rstrip('=')
assert hash_url==launch['hash'].rstrip('='),(hash_url,launch['hash'])
local=next((root/'mobile/dist/_expo/static/js/ios').glob('*.hbc'))
assert local.read_bytes()==bundle
record={'status':'PASS','channel':'production','runtimeVersion':'2.1.0','updateId':u['id'],'group':u['group'],
'gitCommitHash':u['gitCommitHash'],'manifestHttpStatus':status,'bundleHttpStatus':bundle_status,
'bundleBytes':len(bundle),'bundleSha256':hash_bytes.hex(),'manifestHashMatched':True,'localPublishedBundleMatched':True,
'bundleContentType':launch['contentType'],'createdAt':manifest['createdAt']}
(out/'live-delivery.json').write_text(json.dumps(record,indent=2)+'\n')
Path('/private/tmp/recallsmith-prerequisite-20261114/live-bundle.hbc').write_bytes(bundle)
Path('/private/tmp/recallsmith-prerequisite-20261114/live-manifest.raw').unlink()
print(json.dumps(record,indent=2))
