from pathlib import Path
import json,hashlib,copy,collections
s=Path(__file__).resolve().parent
if not (s/'selection.json').exists():s=Path.home()/'.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/global-card-proof-20261106/domain1-card-backtrace-20261108/pilot10'
rd=lambda p:json.loads(Path(p).read_text());sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
selection=rd(s/'selection.json');questions=rd(s/'questions.json');cards=rd(s/'cards.domain1.visible.json');pool={c['stableUid']:c for c in cards};assert len(pool)==len(cards)==159
assert len(questions)==10 and {q['qid'] for q in questions}==set(selection['pilotQids'])
for path,digest in selection['inputHashes'].items():assert sha(s/Path(path).name)==digest
ind=rd(s/'independent/results.json');author=rd(s/'author/results.json')
for path,digest in ind['inputsSha256'].items():assert sha(s/Path(path).name)==digest
for path,digest in author['inputHashes'].items():assert sha(s/Path(path).name)==digest
source=rd(selection['originalQuestionSource']);originalMatches=0
def check_original(q):
 src=source[str(q['qid'])];assert q['stem']==src['stem'],'original stem drift'
 assert q['options']==[{k:o[k] for k in ['ordinal','originalLabel','text']} for o in src['options']],'original options drift'
for q in questions:
 check_original(q);originalMatches+=1
 def allowed_input_keys(q):return set(q)=={'qid','primaryTask','family','stem','options'}
 assert allowed_input_keys(q)
def citations(obj):
 if isinstance(obj,dict):
  if {'stableUid','field','quote'}<=set(obj):yield obj
  for v in obj.values():yield from citations(v)
 elif isinstance(obj,list):
  for v in obj:yield from citations(v)
def check_citation(c,known=pool):
 assert c['stableUid'] in known,'unknown visible-card UID'
 assert c['field'] in ['frontEn','backEn','frontZh','backZh']
 assert c['quote'] and c['quote'] in known[c['stableUid']][c['field']],'quote not on visible card'
for obj in [author,ind]:
 for c in citations(obj):check_citation(c)
a={r['qid']:r for r in author['results']};b={r['qid']:r for r in ind['results']};assert set(a)==set(b)==set(selection['pilotQids'])
for qid in a:
 assert a[qid]['status']==b[qid]['status'],(qid,'status disagreement')
 assert a[qid].get('selectedOptionOrdinals',a[qid].get('candidateOptionOrdinals'))==b[qid].get('selectedOptionOrdinals',b[qid].get('candidateOptionOrdinals')),(qid,'choice disagreement')
 assert set(a[qid].get('selectedOptionOrdinals',a[qid].get('candidateOptionOrdinals'))) <= {o['ordinal'] for o in next(q for q in questions if q['qid']==qid)['options']}
 if a[qid]['status']=='PARTIAL':assert a[qid]['missingJudgments'] and b[qid]['missingJudgments']
# Controls reject nonexistent quotes and out-of-pool knowledge citations.
first=next(citations(author));controls=0
for bad in [dict(first,quote='CONTROL_NONEXISTENT_CARD_SENTENCE_20261108'),dict(first,stableUid='CONTROL_OUTSIDE_DOMAIN1')]:
 try:check_citation(bad)
 except AssertionError:controls+=1
assert controls==2
changed=copy.deepcopy(questions[0]);changed['stem']+=' CONTROL_CHANGED_CONDITION'
try:check_original(changed)
except AssertionError:controls+=1
counts=dict(collections.Counter(r['status'] for r in a.values()));assert counts=={'SUPPORTED':8,'PARTIAL':2}
nav=rd(Path('/Users/qc/Desktop/DeveloperCards/exports/aws-saa-c03-bilingual-365-20261107/domain-index.json'));assert set(pool)==set(nav['domains']['1']['sharedReviewStableUids'])
used={c['stableUid'] for c in citations(author)};primary=set(nav['domains']['1']['primaryStableUids'])
fallback=rd(s/'independent/global-fallback.json');globalpool={c['stableUid']:c for c in rd(s/'cards.global.visible.json')}
assert sha(s/'independent/results.restricted-v1.json')=='0b1daef1ebe00e6561c75ee443c731708b6859ff73a98c459cea508886b5c018'
for path,digest in fallback['inputsSha256'].items():
 candidate=Path(path)
 if not candidate.is_absolute():candidate=s/candidate
 assert sha(candidate)==digest,(path,'fallback input drift')
assert set(fallback['outerPoolReadback']['reviewedStableUids'])==set(globalpool)-set(pool)
assert len(fallback['outerPoolReadback']['reviewedStableUids'])==206
assert {r['qid'] for r in fallback['results']}=={761,189}
assert all(r['classification']=='CONTENT_BOUNDARY_NOT_FOUND' and not r['global365BoundaryFound'] for r in fallback['results'])
for c in citations(fallback):check_citation(c,globalpool)
public=rd('/Users/qc/Desktop/DeveloperCards/exports/aws-saa-c03-bilingual-365-20261107/cards.public.json')
projection=[dict(stableUid=c['stableUid'],topic=c['topic'],frontEn=c['question'],backEn=c['explanation'],frontZh=c['translations']['zh-CN']['question'],backZh=c['translations']['zh-CN']['explanation']) for c in public]
assert projection==rd(s/'cards.global.visible.json'),'existing card bodies changed'
out=dict(status='PASS_INTEGRITY_AND_RECONCILIATION_ONLY',semanticCertificationByThisScript=False,questionCount=10,domain1PrimaryQuestionCount=310,remainingDomain1QuestionsNotAuditedHere=300,domain1VisibleCards=159,questionStatuses=counts,exactOriginalQuestionsMatched=originalMatches,authorCitationCount=sum(1 for _ in citations(author)),independentCitationCount=sum(1 for _ in citations(ind)),negativeControlsPassed=controls,usedCards=len(used),sharedCardsUsed=sorted(used-primary),global365FallbackChangesRestrictedVerdicts=False,artifactHashes={str(f.relative_to(s)):sha(f) for f in [s/'selection.json',s/'questions.json',s/'cards.domain1.visible.json',s/'author/results.json',s/'independent/results.json']},humanOutcomeMeasured=False,cardBodiesModified=False,globalFallbackClassification={'NAVIGATION_GAP':0,'CONTENT_BOUNDARY_NOT_FOUND':2})
(s/'readback.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in out.items() if k!='artifactHashes'},ensure_ascii=False))
