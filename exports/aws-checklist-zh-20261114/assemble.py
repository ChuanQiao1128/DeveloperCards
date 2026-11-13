"""Validate one-to-one checklist translations and prepare local publication artifacts only."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parent
source = json.loads((ROOT / 'source.json').read_text())
source_path = Path(source['path'])
raw = (source_path if source_path.is_absolute() else ROOT / source_path).read_bytes()
assert hashlib.sha256(raw).hexdigest() == source['sha256'], 'frozen source changed'
deck = json.loads(raw)
by_uid = {c['stableUid']: c for c in deck['cards']}
translated = set()
receipts = []
for packet in sorted((ROOT / 'batches').glob('*-input.json')):
    output = packet.with_name(packet.name.replace('-input', '-zh'))
    if not output.exists():
        continue
    inputs, outputs = json.loads(packet.read_text()), json.loads(output.read_text())
    assert len(inputs) == len(outputs) <= 10, packet
    for row, points in zip(inputs, outputs):
        assert row['uid'] not in translated, row['uid']
        assert isinstance(points, list) and len(points) == len(row['pointsEn']), row['uid']
        assert len(set(points)) == len(points), row['uid']
        assert all(isinstance(p, str) and p.strip() == p and 0 < len(p) <= 500 for p in points), row['uid']
        assert all(any('\u4e00' <= c <= '\u9fff' for c in p) for p in points), row['uid']
        by_uid[row['uid']]['teaching']['zh-CN']['mustAnswer'] = points
        translated.add(row['uid'])
    review_path = packet.with_name(packet.name.replace('-input', '-review'))
    review = json.loads(review_path.read_text()) if review_path.exists() else None
    if review:
        assert review['inputSha256'] == hashlib.sha256(packet.read_bytes()).hexdigest(), packet
        assert review['outputSha256'] == hashlib.sha256(output.read_bytes()).hexdigest(), output
        assert [c['uid'] for c in review['cards']] == [r['uid'] for r in inputs], packet
        assert review['overall'] == 'PASS' and all(c['verdict'] == 'PASS' for c in review['cards']), packet
    receipts.append({'batch': packet.stem[:2], 'inputSha256': hashlib.sha256(packet.read_bytes()).hexdigest(),
                     'outputSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                     'cards': len(inputs), 'points': sum(map(len, outputs)), 'semanticReview': 'PASS' if review else 'pending'})
print(json.dumps({'translatedCards': len(translated), 'translatedPoints': sum(r['points'] for r in receipts),
                  'totalCards': 379, 'totalPoints': 757}, ensure_ascii=False))
if len(translated) == 379:
    original = json.loads(raw)
    for before, after in zip(original['cards'], deck['cards']):
        restored = json.loads(json.dumps(after))
        del restored['teaching']['zh-CN']['mustAnswer']
        assert before == restored, before['stableUid']
    deck['version'] = 'local-candidate-zh-checklist-20261114'
    (ROOT / 'public-deck.candidate.json').write_text(json.dumps(deck, ensure_ascii=False, indent=2) + '\n')
    (ROOT / 'import-cards.candidate.json').write_text(json.dumps(deck['cards'], ensure_ascii=False, indent=2) + '\n')
    (ROOT / 'translation-receipts.json').write_text(json.dumps(receipts, ensure_ascii=False, indent=2) + '\n')
    reviewed = len(receipts) == 38 and all(r['semanticReview'] == 'PASS' for r in receipts)
    completion = {'status': 'reviewed_not_published' if reviewed else 'draft',
                  'cards': 379, 'points': 757, 'reviewedBatches': sum(r['semanticReview'] == 'PASS' for r in receipts),
                  'sourceSha256': source['sha256'], 'onlyChangedCardField': 'teaching.zh-CN.mustAnswer',
                  'preserved': ['UIDs', 'order', 'revision', 'English fields', 'existing Chinese prose', 'source', 'tags', 'prerequisites'],
                  'artifactHashes': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in
                    ['public-deck.candidate.json', 'import-cards.candidate.json', 'translation-receipts.json']},
                  'publication': 'not_published'}
    (ROOT / 'completion.json').write_text(json.dumps(completion, ensure_ascii=False, indent=2) + '\n')
    print('Reviewed candidate ready; publication not performed.' if reviewed else 'Draft candidate; review remains pending.')
