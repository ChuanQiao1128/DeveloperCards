"""Workflow boundaries: exact question dependencies, closeout recovery and CAS."""
import copy
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch

import pipeline as p
import closeout as c

CONFIG=p.read(p.HERE/'replay-15.json')


class WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adapter=p.load_adapter();cls.rules=cls.adapter.RULES
        cls.standard=p.read(p.read(CONFIG['importReviews'][1])['inputPath'])['designStandard']
        cls.packet=p.read(CONFIG['batches'][1]['packet']);cls.cards=p.read(CONFIG['batches'][1]['candidate'])['cards']
        cls.ev=p.verify_evidence(cls.packet['officialEvidence'],CONFIG['sourceDir'])
        cls.fp=p.fingerprints(cls.cards,cls.ev,cls.standard,cls.rules)

    def question_job(self, root, selected=None, fp=None):
        selected=selected or [(1,self.cards[0]['cardKey'])];fp=fp or self.fp
        questions={'questions':[{'qid':q,'stem':'original question','options':[{'text':'A'},{'text':'B'}]} for q,k in selected],
            'needs':[{'qid':q,'mustJudge':[{'id':'j1'}]} for q,k in selected]}
        request=p.review_job(root,self.cards,self.ev,self.standard,self.rules,fp,{},questions)
        req=p.read(request);uid=self.cards[0]['stableUid'];key=self.cards[0]['cardKey']
        output={'requestId':req['requestId'],'inputSha256':req['inputSha256'],'artifactSha256':req['artifactSha256'],
            'overall':'PASS','cards':[{'stableUid':x['stableUid'],'rules':{r:'PASS' for r in p.RULE_IDS}} for x in self.cards],
            'findings':[],'transferChecks':[{'stableUid':u,'supportedByCard':True} for u in req['requiredTransferUids']],
            'questionSupport':[{'qid':q,'status':'sufficient_decision_support','cardKeys':[k],
                'judgments':[{'needRef':f'Q{q}:j1','status':'sufficient_decision_support','supportingCardKeys':[k],
                    'cardTextAnchor':'current text anchor','gap':''}],'remainingGaps':[]} for q,k in selected]}
        p.save(request.parent/'output.json',output)
        return request,output

    def test_original_context_preserves_options_conditions_and_no_old_proofs(self):
        packet=copy.deepcopy(self.packet);packet['questions']=[{'qid':1,'stem':'full condition','options':[{'ordinal':1,'text':'full option','locations':[]}]}]
        packet['originalQuestionCoverage']={'needs':[{'qid':1,'conditions':[{'text':'condition'}],
            'mustJudge':[{'id':'j1'}],'anomalies':['unclear source'],'reviewProof':{'oldPass':True}}]}
        context=p.question_context(packet)
        self.assertEqual([o['text'] for o in context['questions'][0]['options']],[o['text'] for o in packet['questions'][0]['options']])
        self.assertEqual(context['needs'][0]['anomalies'],['unclear source']);self.assertNotIn('reviewProof',context['needs'][0])
        packet['originalQuestionCoverage']['needs']*=2
        with self.assertRaisesRegex(ValueError,'duplicate source needs'):p.question_context(packet)

    def test_question_support_binds_source_standard_and_only_affected_dependencies(self):
        with tempfile.TemporaryDirectory() as temp:
            request,_=self.question_job(Path(temp))
            rows=p.question_support(request,self.cards,self.fp);self.assertEqual(len(rows),1)
            self.assertIn(self.cards[0]['stableUid'],rows[0]['cardFingerprints'])
            changed=dict(self.fp);changed[self.cards[-1]['stableUid']]='unrelated-change'
            self.assertEqual(len(p.question_support(request,self.cards,changed)),1)
            changed[self.cards[0]['stableUid']]='same-body-new-source-or-standard'
            self.assertEqual(p.question_support(request,self.cards,changed),[])

    def test_missing_judgment_and_contradictory_sufficiency_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            request,out=self.question_job(Path(temp));out['questionSupport'][0]['remainingGaps']=['still missing a prerequisite']
            p.save(request.parent/'output.json',out)
            with self.assertRaisesRegex(ValueError,'contradicts gaps'):p.question_support(request,self.cards,self.fp)
            out['questionSupport'][0]['remainingGaps']=[];out['questionSupport'][0]['judgments'][0]['needRef']='Q1:wrong'
            p.save(request.parent/'output.json',out)
            with self.assertRaisesRegex(ValueError,'missing required judgment'):p.question_support(request,self.cards,self.fp)

    def test_subset_review_survives_later_unrelated_repair(self):
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp);selected=[(1,self.cards[0]['cardKey']),(2,self.cards[1]['cardKey'])]
            request,_=self.question_job(folder,selected)
            context=p.read(p.read(request)['inputPath'])['questionContext']
            fp2=dict(self.fp);fp2[self.cards[1]['stableUid']]='new-source-second'
            self.assertEqual(set(p.reuse_question_reviews(folder,context,self.cards,fp2)),{1})
            self.question_job(folder,[selected[1]],fp2)
            self.assertEqual(set(p.reuse_question_reviews(folder,context,self.cards,fp2)),{1,2})
            fp3=dict(fp2);fp3[self.cards[0]['stableUid']]='new-source-first'
            self.assertEqual(set(p.reuse_question_reviews(folder,context,self.cards,fp3)),{2})

    def test_repair_context_uses_prior_mapping_without_sending_old_verdicts(self):
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp);request,_=self.question_job(folder,[(1,self.cards[-1]['cardKey'])])
            old=p.read(p.read(request)['inputPath']);cards=copy.deepcopy(self.cards)
            cards[-1]['keyPointZh']+='（修正）';fp=p.fingerprints(cards,self.ev,self.standard,self.rules)
            proofs=p.proof_from_review(request,CONFIG['sourceDir']);valid={(u,v['fingerprint']):v for u,v in proofs.items()}
            contexts={};self.assertEqual(p.reuse_question_reviews(folder,old['questionContext'],cards,fp,contexts),{})
            job=p.review_job(folder,cards,self.ev,self.standard,self.rules,fp,valid,old['questionContext'],contexts)
            req=p.read(job);payload=p.read(req['inputPath'])
            keys={x['cardKey'] for x in payload['cards']+payload['contextCards']}
            targets=[x for x in cards if (x['stableUid'],fp[x['stableUid']]) not in valid]
            expected={x['cardKey'] for x in targets}
            def parents(key):
                for key in next(x for x in cards if x['cardKey']==key)['prerequisiteCardKeys']:
                    if key not in expected:expected.add(key);parents(key)
            for key in list(expected):parents(key)
            self.assertEqual(keys,expected);self.assertLess(len(keys),len(cards))
            self.assertEqual(payload['questionContext'],old['questionContext'])
            self.assertEqual(payload['designStandard'],self.standard)
            self.assertEqual(payload['rules'],self.rules)
            used={e for x in targets+payload['contextCards'] for cite in x['citations'] for e in cite['evidenceIds']}
            self.assertEqual({e['evidenceId'] for e in payload['officialEvidence']},used)
            for e in payload['officialEvidence']:self.assertEqual(e['text'],self.ev[e['evidenceId']]['text'])
            self.assertEqual(set(req['questionCardFingerprints']),{x['stableUid'] for x in payload['cards']+payload['contextCards']})
            self.assertEqual(req['questionReviewUniverse'],fp)
            self.assertNotIn('questionSupport',payload);self.assertNotIn('reviewProof',payload)

    def test_missing_mapping_or_changed_universe_keeps_full_context(self):
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp);request,_=self.question_job(folder)
            questions=p.read(p.read(request)['inputPath'])['questionContext']
            # A new card identity cannot inherit the old question routing.
            cards=copy.deepcopy(self.cards);cards[-1]['stableUid']+='new';fp=p.fingerprints(cards,self.ev,self.standard,self.rules)
            contexts={};reused=p.reuse_question_reviews(folder,questions,cards,fp,contexts)
            self.assertEqual(reused,{});self.assertEqual(contexts,{})
            valid={(u,v):{} for u,v in fp.items()}
            for mapping in [None,{}, {1:set()}, {1:{'unknown-key'}}]:
                job=p.review_job(folder,cards,self.ev,self.standard,self.rules,fp,valid,questions,mapping)
                payload=p.read(p.read(job)['inputPath'])
                self.assertEqual(len(payload['contextCards']),len(cards))

    def test_unknown_or_unmapped_judgment_keeps_full_context(self):
        for status,empty_row in [('unknown',False),('unknown',True),('partial',False),('partial',True)]:
            with self.subTest(status=status,empty_row=empty_row),tempfile.TemporaryDirectory() as temp:
                folder=Path(temp);request,out=self.question_job(folder,[(1,self.cards[-1]['cardKey'])])
                row=out['questionSupport'][0];row['status']='partial';row['remainingGaps']=['unmapped necessary judgment']
                row['judgments'][0].update(status=status,supportingCardKeys=[],cardTextAnchor='',gap='unmapped necessary judgment')
                if empty_row:row['cardKeys']=[]
                p.save(request.parent/'output.json',out)
                self.assertEqual(p.question_support(request,self.cards,self.fp)[0]['cardFingerprints'],self.fp)
                questions=p.read(p.read(request)['inputPath'])['questionContext'];cards=copy.deepcopy(self.cards)
                cards[-1]['keyPointZh']+='（修正）';fp=p.fingerprints(cards,self.ev,self.standard,self.rules)
                contexts={};self.assertEqual(p.reuse_question_reviews(folder,questions,cards,fp,contexts),{})
                proofs=p.proof_from_review(request,CONFIG['sourceDir']);valid={(u,v['fingerprint']):v for u,v in proofs.items()}
                job=p.review_job(folder,cards,self.ev,self.standard,self.rules,fp,valid,questions,contexts)
                payload=p.read(p.read(job)['inputPath'])
                self.assertEqual(len(payload['cards']+payload['contextCards']),len(cards))

    def test_scoped_question_proof_rejects_cards_not_supplied_to_reviewer(self):
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp);questions={'questions':[{'qid':1,'stem':'full question','options':[{'text':'A'}]}],
                'needs':[{'qid':1,'mustJudge':[{'id':'j1'}]}]}
            valid={(u,v):{'transferVerified':True} for u,v in self.fp.items()}
            job=p.review_job(folder,self.cards,self.ev,self.standard,self.rules,self.fp,valid,questions,{1:{self.cards[0]['cardKey']}})
            req=p.read(job);uid=self.cards[0]['stableUid'];key=self.cards[0]['cardKey']
            out={'requestId':req['requestId'],'inputSha256':req['inputSha256'],'artifactSha256':req['artifactSha256'],
                'overall':'PASS','cards':[],'findings':[],'transferChecks':[],
                'questionSupport':[{'qid':1,'status':'sufficient_decision_support','cardKeys':[key],
                    'judgments':[{'needRef':'Q1:j1','status':'sufficient_decision_support','supportingCardKeys':[key],'cardTextAnchor':'a precise anchor','gap':''}],'remainingGaps':[]}]}
            p.save(job.parent/'output.json',out)
            self.assertEqual(p.proof_from_review(job,CONFIG['sourceDir']),{})
            self.assertEqual(len(p.question_support(job,self.cards,self.fp)),1)
            other=self.cards[1]['cardKey'];out['questionSupport'][0]['cardKeys']=[other]
            out['questionSupport'][0]['judgments'][0]['supportingCardKeys']=[other];p.save(job.parent/'output.json',out)
            with self.assertRaisesRegex(ValueError,'unknown support card'):p.question_support(job,self.cards,self.fp)

    def test_same_count_stale_index_pointer_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            run,snapshot,manifest,options=self.prepared(Path(temp))
            index=Path(p.read(manifest)['indexManifestPath'])
            with patch.object(c.domain_index,'check'):
                with self.assertRaisesRegex(ValueError,'not the current'):c.check_current(index)

    def test_cached_proof_verified_once_per_request(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);request,_=self.question_job(root/'batch')
            proofs=p.proof_from_review(request,CONFIG['sourceDir'])
            for uid,proof in proofs.items():p.save(root/'cache'/(uid+'.json'),proof)
            with patch.object(p,'proof_from_review',wraps=p.proof_from_review) as checked:
                self.assertEqual(len(p.cached(root,CONFIG['sourceDir'])),len(self.cards));self.assertEqual(checked.call_count,1)

    def test_cumulative_merge_counts_revisions_without_duplicates(self):
        previous=[{'stableUid':'a','text':'old'},{'stableUid':'b','text':'same'}]
        merged,counts=c.merge_cards(previous,[{'stableUid':'a','text':'new'},{'stableUid':'b','text':'same'},{'stableUid':'c','text':'new'}])
        self.assertEqual(len(merged),3);self.assertEqual(counts,{'newUids':['c'],'revisedUids':['a'],'unchangedUids':['b']})
        with self.assertRaisesRegex(ValueError,'duplicate cumulative UID'):c.merge_cards(previous,previous*2)

    def test_question_merge_retains_partial_and_invalidates_stale_or_legacy(self):
        rows=[{'qid':1,'status':'sufficient_decision_support','cardKeys':['k'],'cardFingerprints':{'u':'old'}},
            {'qid':2,'status':'partial','cardKeys':['v'],'cardFingerprints':{'v':'same'}},
            {'qid':3,'status':'sufficient_decision_support','cardKeys':['legacy']}]
        out=c.merge_questions(rows,[],set(),{'u':'changed','v':'same'})
        self.assertEqual(out['summary']['needsRecheckQids'],[1,3]);self.assertEqual(out['summary']['partialQids'],[2])
        self.assertEqual(out['questions'][0]['previousStatus'],'sufficient_decision_support')
        again=c.merge_questions(out['questions'],[],set(),{'u':'changed','v':'same'})
        self.assertEqual(again['questions'][0]['previousStatus'],'sufficient_decision_support')

    def prepared(self, root, wrong_blueprint=False):
        run=root/'run.json';snapshot=root/'run.snapshot.json';index=root/'index.json';manifest=root/'manifest.json'
        p.save(run,{'formalCardCount':1,'gneedPlan':{'outputDirectory':'source'},'fourDomainOrganization':{'indexManifestPath':'old'}})
        p.save(snapshot,{'formalCardCount':2,'gneedPlan':{'outputDirectory':'wrong' if wrong_blueprint else 'source'},'fourDomainOrganization':{'indexManifestPath':str(index)}})
        p.save(index,{'sources':{},'runtimeGuard':{'path':str(run),'acceptedCount':2,'sourceIndex':'source'}})
        proposed=p.read(snapshot);proposed['fourDomainOrganization']['indexManifestSha256']=p.sha(index);p.save(snapshot,proposed)
        result={'outputHashes':{'run.snapshot.json':p.sha(snapshot)},'indexManifestPath':str(index),'indexManifestSha256':p.sha(index),
            'acceptedTotal':2,'counts':{},'runtimeCommitted':False}
        p.save(manifest,result)
        return run,snapshot,manifest,{'runPath':str(run),'expectedRuntimeSha256':p.sha(run),'commitRuntime':True}

    def test_interrupted_prepared_commit_resumes_and_repeats_idempotently(self):
        with tempfile.TemporaryDirectory() as temp:
            run,snapshot,manifest,options=self.prepared(Path(temp))
            with patch.object(c,'check_snapshot'),patch.object(c.domain_index,'check'):
                self.assertTrue(c.complete_prepared(manifest,options)['runtimeCommitted'])
                committed=p.sha(run);self.assertEqual(committed,p.sha(snapshot))
                self.assertTrue(c.complete_prepared(manifest,options)['runtimeCommitted']);self.assertEqual(p.sha(run),committed)

    def test_runtime_race_or_wrong_blueprint_never_commits(self):
        for wrong_blueprint in [False,True]:
            with self.subTest(wrong_blueprint=wrong_blueprint),tempfile.TemporaryDirectory() as temp:
                run,_,manifest,options=self.prepared(Path(temp),wrong_blueprint)
                if not wrong_blueprint:p.save(run,dict(p.read(run),externalChange=True))
                before=p.sha(run)
                with patch.object(c,'check_snapshot'),patch.object(c.domain_index,'check'):
                    with self.assertRaises((ValueError,AssertionError)):c.complete_prepared(manifest,options)
                self.assertEqual(p.sha(run),before);self.assertFalse(p.read(manifest)['runtimeCommitted'])

    def test_competing_process_rechecks_runtime_inside_shared_lock(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);run,_,manifest,options=self.prepared(root);p.save(root/'options.json',options)
            script='''import sys
from pathlib import Path
from contextlib import contextmanager
sys.path.insert(0,sys.argv[1])
import closeout as c
c.check_snapshot=lambda path:None
c.domain_index.check=lambda path:None
original=c.runtime_lock
@contextmanager
def notify(path):
 print('at-lock',flush=True)
 with original(path):yield
c.runtime_lock=notify
try:c.complete_prepared(Path(sys.argv[2]),c.read(sys.argv[3]));print('committed',flush=True)
except ValueError as exc:print(str(exc),flush=True)
'''
            with c.runtime_lock(run):
                child=subprocess.Popen([sys.executable,'-u','-c',script,str(p.HERE),str(manifest),str(root/'options.json')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
                self.assertEqual(child.stdout.readline().strip(),'at-lock')
                p.save(run,dict(p.read(run),otherWriter=True));expected=p.sha(run)
            output,error=child.communicate(timeout=5)
            self.assertEqual(child.returncode,0,error);self.assertIn('runtime changed',output)
            self.assertEqual(p.sha(run),expected);self.assertFalse(p.read(manifest)['runtimeCommitted'])

    def test_entry_failure_clears_old_completion(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);stage=root/'stage';p.save(stage/'state.json',{'status':'complete_local_pipeline'})
            p.save(stage/'final-readback.json',{'status':'COMPLETE_LOCAL_DELIVERY'})
            p.save(stage/'task-clock.json',{'startedUtc':'2026-11-04T00:00:00+00:00','completedUtc':'2026-11-04T00:01:00+00:00','taskEntryToDeliverySeconds':60})
            cfg=dict(CONFIG,stage=str(stage));manifest=root/'config.json';p.save(manifest,cfg)
            with patch.object(p,'preflight',side_effect=ValueError('file unavailable')),patch('sys.argv',['pipeline.py',str(manifest)]):
                with self.assertRaisesRegex(ValueError,'file unavailable'):p.main()
            self.assertEqual(p.read(stage/'state.json')['status'],'failed')
            self.assertEqual(p.read(stage/'final-readback.json')['status'],'failed')
            clock=p.read(stage/'task-clock.json');self.assertNotIn('completedUtc',clock)
            self.assertEqual(clock['completionHistory'][0]['taskEntryToDeliverySeconds'],60)
            self.assertEqual(clock['startedUtc'],'2026-11-04T00:00:00+00:00')

    def test_author_cannot_bypass_question_check_or_use_replay_mode(self):
        with tempfile.TemporaryDirectory() as temp:
            stage=Path(temp)
            with p.phase(stage,'entry'),patch.object(p,'preflight'):
                with self.assertRaisesRegex(ValueError,'new author runs require'):p.advance(CONFIG,stage,True)

    def test_compact_author_preserves_full_question_and_need_semantics(self):
        packet=copy.deepcopy(self.packet);packet['questions']=[{'qid':1,'stem':'full source conditions','options':[{'ordinal':1,'text':'full option','locations':['coordinate']}],'sourceFlags':['unclear'] }]
        packet['originalQuestionCoverage']={'needs':[{'qid':1,'conditions':[{'text':'required condition'}],'mustJudge':[{'id':'j1'}],'anomalies':['exception'],'reviewProof':{'oldPass':True}}]}
        lean=p.compact_packet(packet,self.standard,True)
        self.assertNotIn('originalQuestionCoverage',lean);self.assertNotIn('questions',lean)
        self.assertEqual(lean['questionContext']['questions'][0]['stem'],'full source conditions')
        self.assertEqual(lean['questionContext']['questions'][0]['options'][0]['text'],'full option')
        self.assertEqual(lean['questionContext']['needs'][0]['anomalies'],['exception'])
        self.assertNotIn('reviewProof',lean['questionContext']['needs'][0])
        self.assertEqual(lean['officialEvidence'][0]['text'],packet['officialEvidence'][0]['text'])

    def test_automatic_delivery_keeps_partial_status_and_original_clock(self):
        with tempfile.TemporaryDirectory() as temp:
            stage=Path(temp);out=stage/'output';p.save(out/'cards.json',[])
            p.save(stage/'batch'/'candidate.snapshot.json',{'cards':self.cards})
            p.save(stage/'question-support.current.json',{'questions':[{'qid':1,'status':'partial','remainingGaps':['unresolved condition']}]})
            p.save(stage/'task-clock.json',{'startedUtc':'2026-11-04T00:00:00+00:00','toolingAtStart':{'pipeline.py':'previous-version'}})
            p.save(stage/'closeout.json',{'acceptedTotal':6,'counts':{'newUids':[c['stableUid'] for c in self.cards],'revisedUids':[]},'indexManifestPath':'unused'})
            state={'artifactDirectory':str(out),'artifacts':{'cards.json':p.sha(out/'cards.json')},'closeout':{'manifestPath':str(stage/'closeout.json')},'authorDispatchAttemptsRecorded':0}
            with patch.object(c,'check_current'):p.delivery_report({'deliveryReport':str(stage/'report.md'),'batches':[{'id':'batch'}]},stage,state)
            final=p.read(stage/'final-readback.json');self.assertEqual(final['partialQids'],[1]);self.assertEqual(final['sufficientQids'],[])
            self.assertTrue(final['toolingChangedDuringBatch'])
            self.assertIn('unresolved condition',(stage/'report.md').read_text());self.assertEqual(p.read(stage/'task-clock.json')['startedUtc'],'2026-11-04T00:00:00+00:00')
            (out/'cards.json').write_text('tampered')
            with self.assertRaisesRegex(ValueError,'artifact changed'):p.delivery_report({'deliveryReport':str(stage/'report.md')},stage,state)

    def selection_fixture(self, root):
        prior=root/'prior';sources=prior/'official-sources';text='Complete official condition.\nRequired boundary stays here.'
        text_hash=p.hashlib.sha256(text.encode()).hexdigest()
        p.save(sources/'source.json',{'url':'https://docs.aws.amazon.com/example','status':200,'text':text,'textSha256':text_hash})
        evidence={'evidenceId':'OLD','url':'https://docs.aws.amazon.com/example','text':text,'charStart':0,'charEnd':len(text),'sourceTextSha256':text_hash,'textSha256':text_hash}
        p.save(prior/'packet.json',{'officialEvidence':[evidence]})
        blueprint=root/'blueprint';blueprint.mkdir()
        question={'qid':1,'stem':'All original scenario conditions.','options':[{'ordinal':1,'text':'Complete option A'},{'ordinal':2,'text':'Complete option B'}],'sourceFlags':['ambiguity']}
        need={'qid':1,'conditions':[{'id':'c1','text':'condition'}],'mustJudge':[{'id':'j1'}],'toVerify':['difference'],'anomalies':['source limit']}
        (blueprint/'questions.normalized.jsonl').write_text(p.json.dumps(question)+'\n');(blueprint/'needs.jsonl').write_text(p.json.dumps(need)+'\n')
        index=root/'index'/'manifest.json';p.save(index,{'config':{'sourceIndex':str(blueprint),'acceptedCards':str(root/'accepted.json')}})
        p.save(index.parent/'bidirectional-index.json',{'questions':{'1':{'classification':{'primaryTask':'1.1','crossTasks':[]}}}})
        p.save(root/'accepted.json',[]);p.save(root/'run.json',{'fourDomainOrganization':{'indexManifestPath':str(index)},'cardWorkflowCloseout':{'questionSupportPath':str(root/'support.json')}})
        selection={'runPath':str(root/'run.json'),'stage':str(root/'work'),'qids':[1],
            'cards':[{'cardKey':'goal'+str(i),'kind':'Rare','learningGoal':'one decision','focusHint':'preserve the condition'} for i in range(5)],
            'reuseEvidence':[{'packet':str(prior/'packet.json'),'ids':{'OLD':'NEW'}}]}
        path=root/'inputs'/'selection.json';p.save(path,selection)
        return path,selection,question,need

    def test_normal_prepare_reuses_exact_sources_and_resumes_without_rebinding(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);path,selection,question,need=self.selection_fixture(root)
            with patch.object(c,'check_current'):
                manifest=Path(p.prepare_selected(path));config=p.read(manifest)
                packet=p.read(manifest.parent/'packet.json');self.assertEqual(packet['questions'],[question]);self.assertEqual(packet['originalQuestionCoverage']['needs'],[need])
                evidence=packet['officialEvidence'][0];self.assertEqual(evidence['evidenceId'],'NEW')
                checked=p.verify_evidence([evidence],config['sourceDir'])['NEW']
                self.assertEqual(Path(checked['sourcePath']).read_bytes(),(root/'prior/official-sources/source.json').read_bytes())
                bound=p.read(manifest.parent/'selection-binding.json');clock=p.read(root/'work/task-clock.json');before=manifest.read_bytes()
                self.assertEqual(p.prepare_selected(path),str(manifest));self.assertEqual(manifest.read_bytes(),before)
                self.assertEqual(p.read(root/'work/task-clock.json'),clock)
                self.assertEqual(p.sha(Path(config['stage'])/config['batches'][0]['id']/'author-input.json'),bound['authorInputSha256'])
                batch=dict(config['batches'][0],candidate=str(root/'repair-r2.json'));folder=Path(config['stage'])/batch['id']
                p.prepare_batch(config,batch,folder,p.standard(config['agents']),self.adapter)
                with self.assertRaisesRegex(ValueError,'frozen author inputs changed'):p.prepare_batch(config,batch,folder,p.standard(config['agents'])+'changed',self.adapter)
                config['closeout']['expectedRuntimeSha256']='tampered';p.save(manifest,config)
                with self.assertRaisesRegex(ValueError,'frozen preparation changed'):p.prepare_selected(path)

    def test_partial_preparation_is_preserved_and_not_rebound(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);path,_,_,_=self.selection_fixture(root)
            with patch.object(c,'check_current'):
                manifest=Path(p.prepare_selected(path));binding=manifest.parent/'selection-binding.json';before=binding.read_bytes();manifest.unlink()
                with self.assertRaisesRegex(ValueError,'incomplete preparation retained'):p.prepare_selected(path)
                self.assertEqual(binding.read_bytes(),before)

    def test_cached_quote_tampering_and_alias_collisions_are_rejected(self):
        for corruption in ['quote','duplicate','source_duplicate']:
            with self.subTest(corruption=corruption),tempfile.TemporaryDirectory() as temp:
                root=Path(temp);path,selection,_,_=self.selection_fixture(root)
                if corruption=='quote':
                    old=root/'prior/packet.json';packet=p.read(old);packet['officialEvidence'][0]['text']+=' changed';p.save(old,packet)
                elif corruption=='source_duplicate':
                    old=root/'prior/packet.json';packet=p.read(old);packet['officialEvidence']*=2;p.save(old,packet)
                else:selection['reuseEvidence']*=2;p.save(path,selection)
                with patch.object(c,'check_current'):
                    with self.assertRaisesRegex(ValueError,'excerpt changed|duplicate evidence alias'):p.prepare_selected(path)
                self.assertFalse((path.parent/'manifest.json').exists())

    def test_begin_keeps_original_start_and_tool_versions(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);clock=p.begin_task(root)
            with patch.object(p,'tooling_versions',return_value={'changed':'version'}):self.assertEqual(p.begin_task(root),clock)
            self.assertIn('pipeline.py',clock['toolingAtStart'])

    def test_reused_excerpts_reject_out_of_range_and_noninteger_offsets(self):
        for value in ['negative','overrun','boolean']:
            with self.subTest(value=value),tempfile.TemporaryDirectory() as temp:
                root=Path(temp);path,selection,_,_=self.selection_fixture(root);old=root/'prior/packet.json';packet=p.read(old);e=packet['officialEvidence'][0]
                if value=='negative':e['charStart']=-len(e['text'])
                elif value=='overrun':e['charEnd']+=100
                else:e['charStart']=False
                p.save(old,packet)
                with patch.object(c,'check_current'):
                    with self.assertRaisesRegex(ValueError,'invalid excerpt offsets'):p.prepare_selected(path)
                self.assertFalse((path.parent/'manifest.json').exists())


if __name__=='__main__':unittest.main()
