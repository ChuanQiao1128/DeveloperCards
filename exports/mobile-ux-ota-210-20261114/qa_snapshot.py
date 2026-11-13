"""Read only synthetic QA progress, never a production app container or auth values."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

APP = 'com.timeawake.recallsmith.qa.ota210'
DEVICE = '2F530C24-4E61-4727-B78B-9D7BCA00C913'
container = Path(subprocess.check_output(['xcrun', 'simctl', 'get_app_container', DEVICE, APP, 'data'], text=True).strip())
store = container / 'Library/Application Support' / APP / 'RCTAsyncLocalStorage_V1'
manifest = json.loads((store / 'manifest.json').read_text())
def read(key):
    raw = manifest.get(key)
    if key in manifest and raw is None:
        raw = (store / hashlib.md5(key.encode()).hexdigest()).read_text()
    return json.loads(raw) if raw is not None else None
slug = 'aws-saa-fundamentals'
wallet = read('devcards:u:anon:recallsmith:deck-wallets:v1')
progress = read('devcards:u:anon:deck-progress:' + slug) or []
position = read('devcards:u:anon:recallsmith:session-checkpoint:v1:' + slug)
content = container / 'Documents/devcards-decks-v2/anon/aws-saa-fundamentals.json'
deck = json.loads(content.read_text())
result = {'appId': APP, 'wallet': wallet['decks'][slug] if wallet else None,
          'learned': sum(bool(p.get('lastReviewedAt')) for p in progress),
          'position': {k: position[k] for k in ['currentUid', 'showAnswer', 'limit', 'dateKey']} if position else None,
          'session': {k: position['session'][k] for k in ['sessionId', 'completedCount']} if position else None,
          'contentVersion': deck['version'], 'contentSha256': hashlib.sha256(content.read_bytes()).hexdigest(),
          'chineseChecklistPoints': sum(len(c.get('teaching', {}).get('zh-CN', {}).get('mustAnswer', [])) for c in deck['cards'])}
dest = Path(__file__).resolve().parent / ('state-' + sys.argv[1] + '.json')
dest.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False))
