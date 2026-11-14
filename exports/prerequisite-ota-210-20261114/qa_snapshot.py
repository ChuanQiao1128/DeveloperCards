"""Read only dedicated simulator QA data with synthetic guest ownership and learning."""
from pathlib import Path
import hashlib,json,subprocess,sys
APP='com.timeawake.recallsmith.qa.prerequisites'
DEVICE='2F530C24-4E61-4727-B78B-9D7BCA00C913'
container=Path(subprocess.check_output(['xcrun','simctl','get_app_container',DEVICE,APP,'data'],text=True).strip())
assert '/CoreSimulator/Devices/' in str(container)
store=container/'Library/Application Support'/APP/'RCTAsyncLocalStorage_V1'
manifest=json.loads((store/'manifest.json').read_text())
def read(key):
 raw=manifest.get(key)
 if key in manifest and raw is None: raw=(store/hashlib.md5(key.encode()).hexdigest()).read_text()
 return json.loads(raw) if raw is not None else None
slug='aws-saa-fundamentals'; scope='devcards:u:anon:'
wallet=read(scope+'recallsmith:deck-wallets:v1')['decks'][slug]
owned=read(scope+'devcards:draw-state:'+slug)['owned']
progress=read(scope+'deck-progress:'+slug)
history=read(scope+'devcards:draw-history:'+slug) or []
checkpoint=read(scope+'recallsmith:session-checkpoint:v1:'+slug)
content=container/'Documents/devcards-decks-v2/anon/aws-saa-fundamentals.json'
result={'appId':APP,'wallet':wallet,'ownedUids':owned,'learnedUids':[p['stableUid'] for p in progress if p.get('lastReviewedAt')],
'progressSha256':hashlib.sha256(json.dumps(progress,sort_keys=True).encode()).hexdigest(),
'lastDrawnUids':history[-1]['drawnUids'] if history else [],
'historySha256':hashlib.sha256(json.dumps(history,sort_keys=True).encode()).hexdigest(),
'historyPolicy':history[-1].get('selectionPolicy') if history else None,
'historyFingerprintPolicy':history[-1].get('sortingHash','').split(':',1)[0] if history else None,
'checkpoint':{'uid':checkpoint['currentUid'],'showAnswer':checkpoint['showAnswer'],'sessionId':checkpoint['session']['sessionId'],'completedCount':checkpoint['session']['completedCount']} if checkpoint else None,
'contentSha256':hashlib.sha256(content.read_bytes()).hexdigest()}
(Path(__file__).parent/('state-'+sys.argv[1]+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in ['ownedUids','learnedUids']},ensure_ascii=False))
print('owned',len(owned),'learned',len(result['learnedUids']))
