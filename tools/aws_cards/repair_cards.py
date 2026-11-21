#!/usr/bin/env python3
"""Render a bounded semantic repair patch into local drafts; never publish or grant review PASS."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse

TEXT = ('frontEn', 'frontZh', 'answerEn', 'answerZh', 'keyPointEn', 'keyPointZh', 'goalEn', 'goalZh')
OPTIONAL = ('watchOutEn', 'watchOutZh')
REQUIRED = set(TEXT) | {'uid', 'mustAnswer', 'evidenceIds', 'scopeChange'}


def read(path):
    return json.loads(Path(path).read_text())


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def view(card):
    """One copy of learner-visible semantics, not repeated serialization layers."""
    t = card['teaching']
    z = t['zh-CN']
    return {'uid': card['stableUid'], 'frontEn': card['question'],
            'frontZh': card['translations']['zh-CN']['question'],
            **{f'{k}{lang}': data.get(k, '') for lang, data in [('En', t), ('Zh', z)]
               for k in ['answer', 'keyPoint', 'watchOut', 'goal']},
            'mustAnswer': t['mustAnswer'],
            **({'existingGlossary': glossary_of(card)} if t.get('backHelp') or card.get('frontHelp') else {})}


def glossary_of(card):
    return {
        'frontEn': card.get('frontHelp') or [],
        'frontZh': card['translations']['zh-CN'].get('frontHelp') or [],
        'backEn': card['teaching'].get('backHelp') or [],
        'backZh': card['teaching']['zh-CN'].get('backHelp') or [],
    }


def apply_glossary(card, raw):
    if not isinstance(raw, dict) or set(raw) != {'frontEn', 'frontZh', 'backEn', 'backZh'}:
        raise ValueError('Expected English and Chinese front/back glossary arrays')
    translation = card['translations']['zh-CN']
    teaching = card['teaching']
    faces = {
        'frontEn': (card, 'frontHelp', card['question']),
        'frontZh': (translation, 'frontHelp', translation['question']),
        'backEn': (teaching, 'backHelp', teaching['answer'] + '\n' + teaching['keyPoint']),
        'backZh': (teaching['zh-CN'], 'backHelp', teaching['zh-CN']['answer'] + '\n' + teaching['zh-CN']['keyPoint']),
    }
    for side, (target, field, text) in faces.items():
        entries = raw[side]
        if not isinstance(entries, list) or len(entries) > 2:
            raise ValueError('A face permits at most two glossary anchors per language')
        seen = set()
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) != {'term', 'definition'}:
                raise ValueError('A glossary entry requires a term and definition')
            term, definition = entry['term'], entry['definition']
            if (not isinstance(term, str) or not 1 <= len(term) <= 80 or term != term.strip()
                    or term not in text or term.lower() in seen
                    or not isinstance(definition, str) or not 1 <= len(definition) <= 240
                    or definition != definition.strip()):
                raise ValueError('Invalid or unanchored glossary entry: ' + side)
            seen.add(term.lower())
        if entries:
            target[field] = entries
        else:
            target.pop(field, None)
    if any(len(raw[side + 'En']) != len(raw[side + 'Zh']) for side in ('front', 'back')):
        raise ValueError('Glossary arrays must match across languages')


def render(baseline_path, patch_path, output, source_overrides=None):
    base = read(baseline_path)
    originals = base['cards'] if isinstance(base, dict) else base
    by_uid = {c['stableUid']: c for c in originals}
    if len(by_uid) != len(originals):
        raise ValueError('Baseline has duplicate identities')
    patches = read(patch_path)['cards']
    if not 1 <= len(patches) <= 10:
        raise ValueError('Expected 1-10 repaired cards')
    seen, cards, notes = set(), [], []
    source_overrides = source_overrides or {}
    for patch in patches:
        if not REQUIRED <= set(patch) or set(patch) - REQUIRED - set(OPTIONAL) - {'glossary'}:
            raise ValueError('Unexpected or missing semantic fields')
        uid = patch['uid']
        if uid not in by_uid or uid in seen:
            raise ValueError('Unknown or repeated repair identity')
        seen.add(uid)
        for name in TEXT:
            if not isinstance(patch[name], str) or not patch[name].strip() or patch[name] != patch[name].strip():
                raise ValueError('Missing bilingual field: ' + name)
        for name in OPTIONAL:
            if not isinstance(patch.get(name, ''), str):
                raise ValueError('Invalid optional reminder')
        if bool(patch.get('watchOutEn')) != bool(patch.get('watchOutZh')):
            raise ValueError('Reminder must exist in both languages or neither')
        for name in ['mustAnswer', 'evidenceIds']:
            if not isinstance(patch[name], list) or not patch[name] or not all(isinstance(s, str) and s.strip() for s in patch[name]):
                raise ValueError('Expected nonempty ' + name)
        if not isinstance(patch['scopeChange'], str):
            raise ValueError('Scope change must be explicit text')
        c = copy.deepcopy(by_uid[uid])
        if uid in source_overrides:
            if urlparse(source_overrides[uid]).hostname not in {'docs.aws.amazon.com', 'aws.amazon.com'}:
                raise ValueError('Source override must be official AWS documentation')
            c['source'] = {'url': source_overrides[uid], 'quote': None}
        c.pop('revision', None)
        c['question'] = patch['frontEn']
        c['translations']['zh-CN']['question'] = patch['frontZh']
        teaching = copy.deepcopy(c['teaching'])
        teaching.update({'schema': 'teaching-v1', 'mustAnswer': patch['mustAnswer']})
        for lang, target, labels in [('En', teaching, ('Answer: ', 'Key point: ', 'Watch out: ')),
                                     ('Zh', copy.deepcopy(teaching.get('zh-CN', {})), ('答：', '考点：', '易错提醒：'))]:
            for key in ['answer', 'keyPoint', 'goal']:
                target[key] = patch[key + lang]
            target.pop('watchOut', None)
            if patch.get('watchOut' + lang):
                target['watchOut'] = patch['watchOut' + lang]
            body = labels[0] + target['answer'] + '\n' + labels[1] + target['keyPoint']
            if 'watchOut' in target:
                body += '\n' + labels[2] + target['watchOut']
            if lang == 'En':
                c['explanation'] = body
            else:
                teaching['zh-CN'] = target
                c['translations']['zh-CN']['explanation'] = body
        if by_uid[uid]['teaching'].get('prerequisites'):
            teaching['prerequisites'] = copy.deepcopy(by_uid[uid]['teaching']['prerequisites'])
        c['teaching'] = teaching
        if 'glossary' in patch:
            apply_glossary(c, patch['glossary'])
        elif c['teaching'].get('backHelp'):
            apply_glossary(c, glossary_of(c))
        cards.append(c)
        note = {k: patch[k] for k in ['uid', 'evidenceIds', 'scopeChange']}
        if uid in source_overrides:
            note['sourceUrlChangedTo'] = source_overrides[uid]
        notes.append(note)
    if set(source_overrides) - seen:
        raise ValueError('Source override outside repaired identities')
    cards.sort(key=lambda c: c['orderInDeck'])
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    def write(name, data):
        (output / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    write('candidate.cards.json', cards)
    write('cards.json', cards)  # Existing real-parser roundtrip consumes this filename.
    write('repair-notes.json', notes)
    deck, reading = ['# deck: aws-saa-fundamentals', ''], ['# 修订稿（未发布）', '']
    for c in cards:
        deck += ['## ' + c['stableUid'] + ' | d' + str(c['difficulty']), 'TOPIC: ' + c['topic'],
                 'Q:', c['question'], 'Q_ZH:', c['translations']['zh-CN']['question'],
                 'A:', c['explanation'], 'A_ZH:', c['translations']['zh-CN']['explanation'],
                 'SOURCE: ' + c['source']['url'], '']
        reading += ['## ' + '顺序 ' + str(c['orderInDeck']) + ' · ' + c['topic'], '',
                    '**问：** ' + c['translations']['zh-CN']['question'], '',
                    c['translations']['zh-CN']['explanation'], '',
                    '**Question:** ' + c['question'], '', c['explanation'], '']
    (output / 'cards.deck.md').write_text('\n'.join(deck))
    (output / 'cards.md').write_text('\n'.join(reading))
    write('draft-manifest.json', {'status': 'DRAFT_GENERATED_NOT_SEMANTICALLY_APPROVED',
                                'baselineSha256': sha(baseline_path), 'patchSha256': sha(patch_path),
                                'candidateSha256': sha(output / 'candidate.cards.json'), 'cards': len(cards),
                                'sourceOverrides': source_overrides,
                                'serverRevisionsNotPredicted': True, 'published': False})
    return cards


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline', type=Path)
    parser.add_argument('patch', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    cards = render(args.baseline, args.patch, args.output)
    print(json.dumps({'status': 'LOCAL_DRAFT_GENERATED', 'cards': len(cards), 'output': str(args.output)}))
