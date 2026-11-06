"""Reference-only domain views over the existing, reviewed question blueprint."""
import argparse
import copy
import csv
import hashlib
import json
from collections import defaultdict
from pathlib import Path

DOMAINS = {'1': '安全架构', '2': '弹性架构', '3': '高性能架构', '4': '成本优化架构'}
TASKS = [f'{d}.{i}' for d, count in [('1', 3), ('2', 2), ('3', 5), ('4', 4)] for i in range(1, count + 1)]
NEED_FIELDS = ['qid', 'conditions', 'mustJudge', 'toVerify', 'anomalies']
OBJECTIVE_FIELDS = ['objectiveId', 'goal', 'scope', 'qids', 'needRefs', 'conditions', 'variants', 'compositionRefs', 'verificationTopicIds', 'sourceAnomalyQids', 'factsVerified']


def read(path):
    return json.loads(Path(path).read_text())


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def load_sources(config):
    index = Path(config['sourceIndex'])
    files = {key: index / name for key, name in [('questions', 'questions.normalized.jsonl'), ('needs', 'needs.jsonl'), ('objectives', 'candidate-objectives.json'), ('verification', 'verify-ledger.jsonl'), ('coverage', 'coverage-check.json')]}
    files.update(classification=Path(config['classificationCsv']), acceptedCards=Path(config['acceptedCards']), cardAcceptance=Path(config['cardAcceptance']))
    with files['classification'].open(encoding='utf-8-sig', newline='') as stream:
        # Answer columns and learning snapshots never enter derived views.
        classification = [{**{k: row[k] for k in ['题号', '归类状态', '主领域', '主任务', '跨领域任务']}, 'hasReviewNotes': bool(row.get('待核实事项', '').strip())} for row in csv.DictReader(stream)]
    sources = {'questions': list(map(json.loads, files['questions'].read_text().splitlines())), 'needs': list(map(json.loads, files['needs'].read_text().splitlines())), 'blueprint': read(files['objectives']), 'classification': classification, 'acceptedUids': [x['stableUid'] for x in read(files['acceptedCards'])]}
    return sources, {k: {'path': str(p), 'sha256': sha(p)} for k, p in files.items()}


def assemble(sources):
    questions, needs, goals = sources['questions'], sources['needs'], sources['blueprint']['objectives']
    qids = {q['qid'] for q in questions}
    assert len(qids) == len(questions) and 868 not in qids
    assert qids == {n['qid'] for n in needs} == set(sources['blueprint']['allSourceQids'])
    cls = {int(row['题号']): row for row in sources['classification']}
    assert len(cls) == len(sources['classification']) and qids <= set(cls)
    goal_by_q, goals_by_need = defaultdict(list), defaultdict(list)
    for goal in goals:
        assert set(goal['qids']) == {int(ref.split(':')[0][1:]) for ref in goal['needRefs']}
        for q in goal['qids']:
            goal_by_q[q].append(goal['objectiveId'])
        for ref in goal['needRefs']:
            goals_by_need[ref].append(goal['objectiveId'])
    refs = {'questions': {}, 'objectives': {}, 'judgments': {}}
    qpos = {q['qid']: i + 1 for i, q in enumerate(questions)}
    for line, need in enumerate(needs, 1):
        q = need['qid']
        row = cls[q]
        primary, task = row['主领域'], row['主任务']
        cross = sorted(set(filter(None, row['跨领域任务'].split(';'))))
        assert primary in DOMAINS and task in TASKS and task.startswith(primary + '.')
        assert set(cross) <= set(TASKS)
        refs['questions'][str(q)] = {'qid': q, 'questionRef': questions[qpos[q] - 1]['questionRef'], 'questionLine': qpos[q], 'needsLine': line, 'classification': {'primaryDomain': primary, 'primaryTask': task, 'crossTasks': cross, 'sourceStatus': row['归类状态'], 'hasReviewNotes': row['hasReviewNotes'], 'sourceRecordKey': {'题号': str(q)}, 'reviewNotesReferenceOnly': True}, 'objectiveIds': sorted(set(goal_by_q[q])), 'needRefs': [f"Q{q}:{j['id']}" for j in need['mustJudge']], 'conditionRefs': [f"Q{q}:{c['id']}" for c in need['conditions']], 'sourceNeedsReviewStatus': sources['blueprint']['sourceCasesByQid'][str(q)]['needsReviewStatus'], 'cardSupportStatus': 'not_assessed_by_this_index'}
        for j, judgment in enumerate(need['mustJudge']):
            ref = f"Q{q}:{judgment['id']}"
            assert ref not in refs['judgments']
            refs['judgments'][ref] = {'qid': q, 'kind': judgment['kind'], 'conditionRefs': [f'Q{q}:{c}' for c in judgment['conditionIds']], 'objectiveIds': sorted(set(goals_by_need[ref])), 'needsLine': line, 'pointer': f'/mustJudge/{j}', 'cardSupportStatus': 'not_assessed_by_this_index'}
    for pos, goal in enumerate(goals):
        tasks = {t for q in goal['qids'] for t in [refs['questions'][str(q)]['classification']['primaryTask'], *refs['questions'][str(q)]['classification']['crossTasks']]}
        refs['objectives'][goal['objectiveId']] = {'sourcePointer': f'/objectives/{pos}', 'qids': list(goal['qids']), 'needRefs': list(goal['needRefs']), 'conditions': copy.deepcopy(goal['conditions']), 'variantPointers': [f'/objectives/{pos}/variants/{i}' for i in range(len(goal['variants']))], 'compositionRefs': list(goal['compositionRefs']), 'verificationTopicIds': list(goal['verificationTopicIds']), 'navigationDomains': sorted({t.split('.')[0] for t in tasks}), 'navigationTasks': sorted(tasks), 'navigationBasis': 'question_labels_only_not_confirmed_objective_classification', 'primaryDomain': None, 'primaryTask': None, 'domainAssignmentStatus': 'unconfirmed', 'relationStatus': 'existing_candidate_blueprint_relation', 'authoringStatus': 'existing_card_binding_not_established', 'cardSupportStatus': 'not_assessed_by_this_index'}
    views = {'domains': {}, 'tasks': {}, 'navigationStatus': 'candidate_views_from_existing_question_classification'}
    for domain, title in DOMAINS.items():
        primary = sorted(q for q in qids if refs['questions'][str(q)]['classification']['primaryDomain'] == domain)
        inclusive = sorted(q for q in qids if any(t.startswith(domain + '.') for t in question_tasks(refs['questions'][str(q)])))
        views['domains'][domain] = {'title': title, 'primaryQuestionIds': primary, 'inclusiveQuestionIds': inclusive, 'taskCodes': [t for t in TASKS if t.startswith(domain + '.')], 'candidateObjectiveIds': sorted({g for q in inclusive for g in goal_by_q[q]})}
    for task in TASKS:
        primary = sorted(q for q in qids if refs['questions'][str(q)]['classification']['primaryTask'] == task)
        inclusive = sorted(q for q in qids if task in question_tasks(refs['questions'][str(q)]))
        views['tasks'][task] = {'domain': task.split('.')[0], 'primaryQuestionIds': primary, 'inclusiveQuestionIds': inclusive, 'candidateObjectiveIds': sorted({g for q in inclusive for g in goal_by_q[q]})}
    for entry in list(views['domains'].values()) + list(views['tasks'].values()):
        entry['classificationReviewQuestionIds'] = [q for q in entry['inclusiveQuestionIds'] if refs['questions'][str(q)]['classification']['sourceStatus'] != '已逐题归类']
    inventory = {'acceptedUids': sorted(sources['acceptedUids']), 'acceptedCount': len(sources['acceptedUids']), 'objectiveBindings': {}, 'bindingStatus': 'not_established_do_not_infer_no_existing_cards', 'questionCoverageStatus': 'not_assessed_by_this_index', 'authoringPreflight': 'Check existing accepted cards and establish objective binding before generating potentially duplicate content. No association is inferred from names or batch membership.'}
    return {'domain-views.json': views, 'bidirectional-index.json': refs, 'card-inventory.json': inventory}


def question_tasks(q):
    c = q['classification']
    return set([c['primaryTask'], *c['crossTasks']])


def validate(model, sources):
    refs, views = model['bidirectional-index.json'], model['domain-views.json']
    questions = {q['qid']: q for q in sources['questions']}
    needs = {n['qid']: n for n in sources['needs']}
    goals = {g['objectiveId']: g for g in sources['blueprint']['objectives']}
    cls = {int(r['题号']): r for r in sources['classification']}
    assert set(views['domains']) == set(DOMAINS) and set(views['tasks']) == set(TASKS)
    assert views['navigationStatus'] == 'candidate_views_from_existing_question_classification'
    assert set(map(int, refs['questions'])) == set(questions) and '868' not in refs['questions']
    assert set(refs['objectives']) == set(goals)
    assert set(refs['judgments']) == {f"Q{q}:{j['id']}" for q, n in needs.items() for j in n['mustJudge']}
    for q, entry in refs['questions'].items():
        q = int(q)
        assert entry['classification']['primaryDomain'] == cls[q]['主领域']
        assert entry['classification']['primaryTask'] == cls[q]['主任务']
        assert entry['classification']['crossTasks'] == sorted(set(filter(None, cls[q]['跨领域任务'].split(';'))))
        assert entry['classification']['sourceStatus'] == cls[q]['归类状态']
        assert entry['classification']['hasReviewNotes'] == cls[q]['hasReviewNotes']
        assert set(entry['objectiveIds']) == {g for g, o in goals.items() if q in o['qids']}
        assert entry['needRefs'] == [f"Q{q}:{j['id']}" for j in needs[q]['mustJudge']]
        assert entry['conditionRefs'] == [f"Q{q}:{c['id']}" for c in needs[q]['conditions']]
        assert entry['questionRef'] == questions[q]['questionRef']
        assert sources['questions'][entry['questionLine'] - 1]['qid'] == q
        assert sources['needs'][entry['needsLine'] - 1]['qid'] == q
        assert entry['cardSupportStatus'] == 'not_assessed_by_this_index'
    for oid, entry in refs['objectives'].items():
        goal = goals[oid]
        for field in ['qids', 'needRefs', 'conditions', 'compositionRefs', 'verificationTopicIds']:
            assert entry[field] == goal[field], (oid, field)
        assert entry['primaryDomain'] is None and entry['primaryTask'] is None
        assert entry['domainAssignmentStatus'] == 'unconfirmed'
        pos = sources['blueprint']['objectives'].index(goal)
        assert entry['sourcePointer'] == f'/objectives/{pos}'
        assert entry['variantPointers'] == [f'/objectives/{pos}/variants/{i}' for i in range(len(goal['variants']))]
        assert entry['navigationBasis'] == 'question_labels_only_not_confirmed_objective_classification'
        assert entry['relationStatus'] == 'existing_candidate_blueprint_relation'
        assert entry['cardSupportStatus'] == 'not_assessed_by_this_index'
        assert entry['authoringStatus'] == 'existing_card_binding_not_established'
        assert set(entry['navigationTasks']) == {t for q in goal['qids'] for t in question_tasks(refs['questions'][str(q)])}
        assert set(entry['navigationDomains']) == {t.split('.')[0] for t in entry['navigationTasks']}
        for ref in entry['needRefs']:
            assert oid in refs['judgments'][ref]['objectiveIds']
    for ref, entry in refs['judgments'].items():
        assert set(entry['objectiveIds']) == {g for g, o in goals.items() if ref in o['needRefs']}
        judgment = next(j for j in needs[entry['qid']]['mustJudge'] if ref == f"Q{entry['qid']}:{j['id']}")
        assert entry['kind'] == judgment['kind']
        assert entry['conditionRefs'] == [f"Q{entry['qid']}:{c}" for c in judgment['conditionIds']]
        assert entry['cardSupportStatus'] == 'not_assessed_by_this_index'
    for key, entry in {**views['domains'], **views['tasks']}.items():
        if '.' in key:
            expected = {int(q) for q, row in refs['questions'].items() if key in question_tasks(row)}
            primary = {q for q in questions if cls[q]['主任务'] == key}
        else:
            expected = {int(q) for q, row in refs['questions'].items() if key in {t.split('.')[0] for t in question_tasks(row)}}
            primary = {q for q in questions if cls[q]['主领域'] == key}
        assert set(entry['primaryQuestionIds']) == primary
        assert set(entry['inclusiveQuestionIds']) == expected
        assert len(entry['inclusiveQuestionIds']) == len(expected)
        assert set(entry['candidateObjectiveIds']) == {oid for oid, o in goals.items() if set(o['qids']) & expected}
        assert set(entry['classificationReviewQuestionIds']) == {q for q in expected if cls[q]['归类状态'] != '已逐题归类'}
    inv = model['card-inventory.json']
    assert set(inv['acceptedUids']) == set(sources['acceptedUids'])
    assert len(inv['acceptedUids']) == len(set(inv['acceptedUids'])) == inv['acceptedCount']
    assert inv['objectiveBindings'] == {} and inv['bindingStatus'].startswith('not_established')
    forbidden = {'建议答案', 'PDF答案', '社区最高票', '学习状态', 'frontEn', 'frontZh', 'answerEn', 'answerZh'}
    def scan(value):
        if isinstance(value, dict):
            assert not forbidden & set(value)
            for child in value.values():
                scan(child)
        elif isinstance(value, list):
            for child in value:
                scan(child)
    scan(model)
    return {'questions': len(questions), 'options': sum(len(q['options']) for q in questions.values()), 'objectives': len(goals), 'judgments': len(refs['judgments']), 'objectiveQuestionLinks': sum(len(g['qids']) for g in goals.values()), 'objectiveJudgmentLinks': sum(len(g['needRefs']) for g in goals.values()), 'domains': len(views['domains']), 'tasks': len(views['tasks']), 'acceptedInventoryCount': inv['acceptedCount']}


def render(out, model, sources):
    goals = {g['objectiveId']: g for g in sources['blueprint']['objectives']}
    views = model['domain-views.json']
    for domain, view in views['domains'].items():
        lines = [f"# 领域{domain} · {view['title']}", '', '此页按原题分类提供候选导航，不表示考点主归已确认或卡片已覆盖原题。正文与条件保留在当前权威蓝图；本页为可重建引用视图。', '', f"主归题{len(view['primaryQuestionIds'])}；含交叉题{len(view['inclusiveQuestionIds'])}；候选目标{len(view['candidateObjectiveIds'])}。", f"保留分类待核题：{', '.join('Q'+str(q) for q in view['classificationReviewQuestionIds']) or '无'}。", '', '索引里的“已有卡片未绑定目标”不等于没有出卡；制卡前需查已有接受卡清单并绑定。', '']
        for task in view['taskCodes']:
            entry = views['tasks'][task]
            lines += [f'## 考试任务 {task}', '', f"主归题{len(entry['primaryQuestionIds'])}；含交叉题{len(entry['inclusiveQuestionIds'])}；候选目标{len(entry['candidateObjectiveIds'])}。", '', '| 候选目标 | 本任务关联题 | 该目标全部来源题 |', '| --- | --- | --- |']
            for oid in entry['candidateObjectiveIds']:
                goal = goals[oid]
                local = sorted(set(goal['qids']) & set(entry['inclusiveQuestionIds']))
                title = goal['goal'].replace('|', '\\|').replace('\n', ' ')
                lines.append(f"| {oid}：{title} | {', '.join('Q'+str(q) for q in local)} | {', '.join('Q'+str(q) for q in goal['qids'])} |")
            lines.append('')
        (out / f'domain-{domain}.md').write_text('\n'.join(lines))


def verify_sources(manifest):
    for role, binding in manifest['sources'].items():
        assert sha(binding['path']) == binding['sha256'], f'Stale source: {role}'
    guard = manifest.get('runtimeGuard')
    if guard:
        run = read(guard['path'])
        assert run['formalCardCount'] == guard['acceptedCount'], 'Accepted-card inventory changed; refresh index'
        assert run['gneedPlan']['outputDirectory'] == guard['sourceIndex'], 'Current blueprint changed; refresh index'


def check(manifest_path):
    manifest = read(manifest_path)
    verify_sources(manifest)
    assert sha(__file__) == manifest['builderSha256'], 'Builder changed; rebuild and re-review'
    root = Path(manifest_path).parent
    for name, value in manifest['outputHashes'].items():
        assert sha(root / name) == value, f'Changed output: {name}'
    sources, _ = load_sources(manifest['config'])
    model = {name: read(root / name) for name in ['domain-views.json', 'bidirectional-index.json', 'card-inventory.json']}
    counts = validate(model, sources)
    assert counts == manifest['counts'], 'Manifest counts do not match actual index'
    for key, value in manifest['config'].get('expectedCounts', {}).items():
        assert counts[key] == value
    return counts


def build(config_path):
    config = read(config_path)
    out = Path(config['outputDirectory'])
    assert not out.exists(), 'Use a new output version; do not overwrite reviewed artifacts'
    sources, bindings = load_sources(config)
    model = assemble(sources)
    counts = validate(model, sources)
    for key, value in config.get('expectedCounts', {}).items():
        assert counts[key] == value, (key, counts[key], value)
    out.mkdir(parents=True)
    for name, value in model.items():
        write(out / name, value)
    render(out, model, sources)
    manifest = {'schema': 'aws-domain-reference-index-v1', 'config': config, 'sources': bindings, 'builderPath': str(Path(__file__).resolve()), 'builderSha256': sha(__file__), 'counts': counts, 'semanticScope': 'Reference navigation only; no re-extraction, objective reclassification, new mergers, AWS verification or card coverage acceptance.', 'outputHashes': {p.name: sha(p) for p in sorted(out.iterdir())}}
    if config.get('runPath'):
        manifest['runtimeGuard'] = {'path': config['runPath'], 'acceptedCount': counts['acceptedInventoryCount'], 'sourceIndex': config['sourceIndex']}
    write(out / 'manifest.json', manifest)
    assert check(out / 'manifest.json') == counts
    print(json.dumps({'manifest': str(out / 'manifest.json'), 'counts': counts}, ensure_ascii=False))


def lookup(manifest_path, kind, key):
    check(manifest_path)
    manifest = read(manifest_path)
    root = Path(manifest_path).parent
    refs = read(root / 'bidirectional-index.json')
    sources, _ = load_sources(manifest['config'])
    if kind in ['domain', 'task']:
        value = read(root / 'domain-views.json')['domains' if kind == 'domain' else 'tasks'][key]
    elif kind == 'objective':
        value = {'index': refs['objectives'][key], 'currentObjective': {k: v for k, v in next(g for g in sources['blueprint']['objectives'] if g['objectiveId'] == key).items() if k in OBJECTIVE_FIELDS}}
    else:
        qid = int(key)
        value = {'index': refs['questions'][str(qid)], 'question': next(q for q in sources['questions'] if q['qid'] == qid), 'needs': {k: v for k, v in next(n for n in sources['needs'] if n['qid'] == qid).items() if k in NEED_FIELDS}}
    return {'result': value, 'cardReadiness': read(root / 'card-inventory.json')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('build').add_argument('config')
    sub.add_parser('check').add_argument('manifest')
    query = sub.add_parser('lookup')
    query.add_argument('manifest')
    query.add_argument('kind', choices=['domain', 'task', 'objective', 'question'])
    query.add_argument('key')
    args = parser.parse_args()
    if args.command == 'build':
        build(args.config)
    elif args.command == 'check':
        print(json.dumps(check(args.manifest), ensure_ascii=False))
    else:
        print(json.dumps(lookup(args.manifest, args.kind, args.key), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
