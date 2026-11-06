"""Local cumulative closeout; semantic verdicts must come from frozen reviews."""
import copy
from contextlib import contextmanager, redirect_stdout
import fcntl
import io
from pathlib import Path
import tempfile
import time

import domain_index
from pipeline import digest, read, save, sha


def merge_cards(previous, current):
    def index(rows):
        result={x['stableUid']:x for x in rows}
        if len(result)!=len(rows):raise ValueError('duplicate cumulative UID')
        return result
    old=index(previous);new=index(current)
    counts={'newUids':sorted(new.keys()-old.keys()),
        'revisedUids':sorted(u for u in new.keys()&old.keys() if new[u]!=old[u]),
        'unchangedUids':sorted(u for u in new.keys()&old.keys() if new[u]==old[u])}
    merged={**old,**new}
    return [merged[u] for u in sorted(merged)],counts


def merge_questions(previous, current, changed_keys, current_fingerprints=None):
    old={x['qid']:copy.deepcopy(x) for x in previous};new={x['qid']:x for x in current}
    if len(old)!=len(previous) or len(new)!=len(current):raise ValueError('duplicate cumulative question')
    for q,row in old.items():
        dependencies=row.get('cardFingerprints',{})
        stale=current_fingerprints is not None and (not dependencies or any(u in current_fingerprints and current_fingerprints[u]!=value for u,value in dependencies.items()))
        if q not in new and (stale or set(row['cardKeys'])&changed_keys):
            row.setdefault('previousStatus',row['status']);row['status']='needs_recheck'
            row['recheckReason']='Supporting dependency changed or legacy full dependency binding missing; previous judgment is historical only.'
    old.update(new);rows=[old[q] for q in sorted(old)]
    summary={'uniqueQuestionsReviewed':len(rows),'learnerPerformanceVerified':False}
    for status,key in [('sufficient_decision_support','sufficientQids'),('partial','partialQids'),('unknown','unknownQids'),('needs_recheck','needsRecheckQids')]:
        summary[key]=[x['qid'] for x in rows if x['status']==status]
    return {'questions':rows,'summary':summary}


def binding(path):
    return {'path':str(Path(path).resolve()),'sha256':sha(path)}


def check_snapshot(path):
    manifest=read(path);frozen=dict(manifest);frozen.pop('runtimeGuard',None)
    domain_index.verify_sources(frozen)
    if sha(domain_index.__file__)!=manifest['builderSha256']:raise ValueError('index builder changed')
    root=Path(path).parent
    if any(sha(root/name)!=value for name,value in manifest['outputHashes'].items()):raise ValueError('index snapshot changed')
    sources,_=domain_index.load_sources(manifest['config'])
    model={name:read(root/name) for name in ['domain-views.json','bidirectional-index.json','card-inventory.json']}
    if domain_index.validate(model,sources)!=manifest['counts']:raise ValueError('index snapshot counts changed')


def check_current(path):
    manifest=read(path);guard=manifest.get('runtimeGuard')
    if guard:
        current=read(guard['path'])['fourDomainOrganization']
        if Path(current['indexManifestPath']).resolve()!=Path(path).resolve() or current['indexManifestSha256']!=sha(path):raise ValueError('index is not the current runtime version')
    return domain_index.check(path)


@contextmanager
def runtime_lock(path):
    # All local card closeouts sharing a runtime serialize comparison and replacement.
    with Path(str(path)+'.cards.lock').open('a') as stream:
        fcntl.flock(stream,fcntl.LOCK_EX)
        try:yield
        finally:fcntl.flock(stream,fcntl.LOCK_UN)


def complete_prepared(manifest_path, options):
    out=manifest_path.parent;result=read(manifest_path)
    for name,value in result['outputHashes'].items():
        if sha(out/name)!=value:raise ValueError('closeout artifact changed')
    if sha(result['indexManifestPath'])!=result['indexManifestSha256']:raise ValueError('closeout index changed')
    if options.get('commitRuntime'):
        run_path=Path(options['runPath']);snapshot=out/'run.snapshot.json'
        check_snapshot(result['indexManifestPath'])
        prospective=read(result['indexManifestPath'])
        prospective['runtimeGuard']=dict(prospective['runtimeGuard'],path=str(snapshot))
        domain_index.verify_sources(prospective)
        proposed=read(snapshot)['fourDomainOrganization']
        if Path(proposed['indexManifestPath']).resolve()!=Path(result['indexManifestPath']).resolve() or proposed['indexManifestSha256']!=result['indexManifestSha256']:raise ValueError('prepared runtime points to a different index')
        with runtime_lock(run_path):
            actual=sha(run_path)
            if actual!=sha(snapshot):
                if actual!=options['expectedRuntimeSha256']:raise ValueError('runtime changed; keep prepared closeout without committing')
                save(run_path,read(snapshot))
            check_current(result['indexManifestPath'])
            result['runtimeCommitted']=True;save(manifest_path,result)
    else:
        check_current(result['indexManifestPath']);save(manifest_path,result)
    return {'manifestPath':str(manifest_path),'acceptedTotal':result['acceptedTotal'],'counts':result['counts'],'runtimeCommitted':result['runtimeCommitted']}


def finish(config, stage, cards, public, valid, fingerprints, question_rows):
    options=config['closeout'];baseline=Path(options['previousIndexManifest'])
    check_snapshot(baseline)
    prior=read(baseline);previous_path=prior['config']['acceptedCards']
    previous=read(previous_path);merged,counts=merge_cards(previous,public)
    proofs=[]
    for card in cards:
        key=(card['stableUid'],fingerprints[card['stableUid']])
        if key not in valid:raise ValueError('closeout requires current per-card semantic proof')
        proofs.append(valid[key])
    changed_uids=set(counts['newUids']+counts['revisedUids'])
    changed_keys={x['cardKey'] for x in cards if x['stableUid'] in changed_uids}
    while True:
        descendants={x['cardKey'] for x in cards if set(x['prerequisiteCardKeys'])&changed_keys}
        if descendants<=changed_keys:break
        changed_keys|=descendants
    previous_support=read(options['previousQuestionSupport'])
    support=merge_questions(previous_support['questions'],question_rows,changed_keys,fingerprints)
    sources={'previousIndex':binding(baseline),'previousCards':binding(previous_path),
        'previousAcceptance':binding(prior['config']['cardAcceptance']),
        'previousQuestionSupport':binding(options['previousQuestionSupport'])}
    run_path=Path(options['runPath']) if options.get('runPath') else None
    if options.get('commitRuntime') and not run_path:raise ValueError('runtime commit requires runPath')
    if run_path:
        runtime=read(run_path)
        sources['runtime']={'path':str(run_path.resolve()),'sha256':options['expectedRuntimeSha256']}
    signature=digest({'sources':sources,'public':public,'proofs':proofs,'support':support,'commit':options.get('commitRuntime',False)})
    out=stage/'closeout'/signature[:20];manifest_path=out/'manifest.json'
    if manifest_path.exists():return complete_prepared(manifest_path,options)
    if run_path:
        if sha(run_path)!=options['expectedRuntimeSha256']:raise ValueError('runtime changed before closeout')
        if runtime['formalCardCount']!=len(previous) or runtime['fourDomainOrganization']['indexManifestPath']!=str(baseline):raise ValueError('baseline is not current runtime inventory')
    save(out/'accepted-cards.current.json',merged)
    inventory={'status':'accepted_locally_not_published','acceptedTotal':len(merged),'previousAcceptance':sources['previousAcceptance'],
        'currentBatch':dict(counts,importBundleCards=len(public),reviewProofs=proofs),
        'learnerPerformanceVerified':False,'historicalUidCount':'not_inferred_from_current_inventory'}
    save(out/'accepted-inventory.json',inventory);save(out/'question-support.cumulative.json',support)
    index_config=copy.deepcopy(prior['config']);index_config.update(acceptedCards=str(out/'accepted-cards.current.json'),
        cardAcceptance=str(out/'accepted-inventory.json'),outputDirectory=str(out/'index'))
    index_config.pop('runPath',None)
    index_config.setdefault('expectedCounts',{})['acceptedInventoryCount']=len(merged)
    # A failed build leaves the authoritative runtime untouched; never overwrite an index version.
    save(out/'index-config.json',index_config)
    if (out/'index'/'manifest.json').exists():check_snapshot(out/'index'/'manifest.json')
    else:
        if (out/'index').exists():(out/'index').rename(out/('index.incomplete-'+str(time.time_ns())))
        with tempfile.TemporaryDirectory(prefix='.index-build-',dir=out) as temp:
            temp_root=Path(temp);temp_config=dict(index_config,outputDirectory=str(temp_root/'index'))
            save(temp_root/'config.json',temp_config)
            with redirect_stdout(io.StringIO()):domain_index.build(temp_root/'config.json')
            (temp_root/'index').rename(out/'index')
            built=read(out/'index'/'manifest.json');built['config']=index_config;save(out/'index'/'manifest.json',built)
    index_path=out/'index'/'manifest.json';index=read(index_path)
    if run_path:
        proposed=copy.deepcopy(runtime);proposed['formalCardCount']=len(merged)
        domain=proposed['fourDomainOrganization'];domain.update(indexManifestPath=str(index_path),indexCounts=index['counts'],
            knownAcceptedCardInventoryCount=len(merged),domainViewPath=str(out/'index'/'domain-views.json'),
            bidirectionalIndexPath=str(out/'index'/'bidirectional-index.json'),cardInventoryPath=str(out/'index'/'card-inventory.json'))
        guard_path=run_path if options.get('commitRuntime') else out/'run.snapshot.json'
        index['runtimeGuard']={'path':str(guard_path),'acceptedCount':len(merged),'sourceIndex':index_config['sourceIndex']}
        save(index_path,index);domain['indexManifestSha256']=sha(index_path)
        proposed['cardWorkflowCloseout']={'manifestPath':str(manifest_path),'questionSupportPath':str(out/'question-support.cumulative.json')}
        save(out/'run.snapshot.json',proposed)
        if not options.get('commitRuntime'):domain_index.check(index_path)
    report=['# 本批本地收尾','',f"累计接受：{len(merged)}；本批新增{len(counts['newUids'])}、修订{len(counts['revisedUids'])}、复用{len(counts['unchangedUids'])}。",'',
        f"题目支撑：{support['summary']}。",'', '知识卡接受、整题支撑与学习者效果分别记录；未发布。','']
    (out/'summary.md').write_text('\n'.join(report))
    result={'schema':'aws-card-closeout-v1','sources':sources,'acceptedTotal':len(merged),'counts':counts,
        'indexManifestPath':str(index_path),'indexManifestSha256':sha(index_path),'runtimeCommitted':False,
        'outputHashes':{p.name:sha(p) for p in out.iterdir() if p.is_file() and p!=manifest_path}}
    save(manifest_path,result)
    return complete_prepared(manifest_path,options)
