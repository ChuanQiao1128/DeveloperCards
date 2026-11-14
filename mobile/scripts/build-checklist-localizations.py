"""Build the read-only OTA localization table from the already reviewed public deck."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parents[2]
artifacts = root / 'exports/aws-checklist-zh-20261114'
expected = {
    'source-public-deck.json': 'c994e567628dbe7d9bcf1372ae8cb4ee610873fcf95196e637a15cb6fcca6e0b',
    'public-deck.candidate.json': '2efebddaa972aff940a2f9121f54986eeabd12374591665c4b9fe672da512785',
}
decks = {}
for name, digest in expected.items():
    raw = (artifacts / name).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == digest, name
    decks[name] = json.loads(raw)
for packet in sorted((artifacts / 'batches').glob('*-input.json')):
    output = packet.with_name(packet.name.replace('-input', '-zh'))
    review = json.loads(packet.with_name(packet.name.replace('-input', '-review')).read_text())
    assert review['overall'] == 'PASS' and all(c['verdict'] == 'PASS' for c in review['cards'])
    assert review['inputSha256'] == hashlib.sha256(packet.read_bytes()).hexdigest()
    assert review['outputSha256'] == hashlib.sha256(output.read_bytes()).hexdigest()
assert len(list((artifacts / 'batches').glob('*-input.json'))) == 38
source = decks['source-public-deck.json']
candidate = decks['public-deck.candidate.json']
assert source['slug'] == candidate['slug'] == 'aws-saa-fundamentals'
rows = {}
assert len(source['cards']) == len(candidate['cards']) == 379
for before, after in zip(source['cards'], candidate['cards']):
    uid = before['stableUid']
    assert uid == after['stableUid'] and uid not in rows
    zh = after['teaching']['zh-CN'].pop('mustAnswer')
    assert after == before, uid
    en = before['teaching']['mustAnswer']
    assert len(en) == len(zh) and all(isinstance(s, str) and s.strip() for s in en + zh)
    rows[uid] = {'en': en, 'zh': zh}
assert len(rows) == 379 and sum(len(row['zh']) for row in rows.values()) == 757
target = root / 'mobile/src/content/checklistZh20261114.json'
target.write_text(json.dumps(rows, ensure_ascii=False, separators=(',', ':')) + '\n')
print(f'Generated {len(rows)} cards / 757 points, {target.stat().st_size} bytes; source and all 38 review hashes match.')
