"""Regression checks for card-level invalidation and retained proof integrity."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import pipeline as p

CONFIG=p.read(p.HERE/'replay-15.json')

class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adapter=p.load_adapter();cls.rules=cls.adapter.RULES;cls.standard=p.read(p.read(CONFIG['importReviews'][1])['inputPath'])['designStandard'];cls.batch=CONFIG['batches'][1]
        cls.packet=p.read(cls.batch['packet']);cls.cards=p.read(cls.batch['candidate'])['cards'];cls.ev=p.verify_evidence(cls.packet['officialEvidence'],CONFIG['sourceDir'])
        cls.fp=p.fingerprints(cls.cards,cls.ev,cls.standard,cls.rules)
        cls.valid=p.proof_from_review(CONFIG['importReviews'][1],CONFIG['sourceDir'])

    def invalidated(self,cards=None,ev=None,teaching=None,rules=None):
        fp=p.fingerprints(cards or self.cards,ev or self.ev,teaching or self.standard,rules or self.rules)
        return {u for u in fp if fp[u]!=self.fp[u]}

    def test_leaf_change_only_reopens_leaf(self):
        cards=copy.deepcopy(self.cards);cards[-1]['frontZh']+='（条件调整）'
        self.assertEqual(self.invalidated(cards),{cards[-1]['stableUid']})

    def test_prerequisite_reopens_dependent_legends(self):
        cards=copy.deepcopy(self.cards);cards[0]['answerZh']+='。'
        self.assertEqual(self.invalidated(cards),{cards[i]['stableUid'] for i in [0,4,5]})

    def test_source_and_standard_changes_invalidate(self):
        ev=copy.deepcopy(self.ev);ev['B01']['text']+=' changed'
        changed=self.invalidated(ev=ev)
        self.assertIn(self.cards[0]['stableUid'],changed);self.assertIn(self.cards[-1]['stableUid'],changed)
        self.assertEqual(len(self.invalidated(teaching=self.standard+'Changed standard')),6)
        rules=copy.deepcopy(self.rules);rules[0]['condition']+=' changed'
        self.assertEqual(len(self.invalidated(rules=rules)),6)

    def test_cycle_and_source_mismatch_rejected(self):
        cards=copy.deepcopy(self.cards);cards[0]['prerequisiteCardKeys']=[cards[-1]['cardKey']]
        with self.assertRaisesRegex(ValueError,'cycle'):self.invalidated(cards)
        evidence=copy.deepcopy(self.packet['officialEvidence']);evidence[0]['text']+=' tampered'
        with self.assertRaisesRegex(ValueError,'excerpt'):p.verify_evidence(evidence,CONFIG['sourceDir'])

    def test_leaf_review_has_no_unrelated_targets_or_author_story(self):
        cards=copy.deepcopy(self.cards);cards[-1]['frontZh']+='（条件调整）';fp=p.fingerprints(cards,self.ev,self.standard,self.rules)
        valid={(u,c['fingerprint']):c for u,c in self.valid.items()}
        with tempfile.TemporaryDirectory() as temp:
            request=p.review_job(Path(temp),cards,self.ev,self.standard,self.rules,fp,valid);req=p.read(request);packet=p.read(req['inputPath'])
            self.assertEqual([x['stableUid'] for x in packet['cards']],[cards[-1]['stableUid']])
            self.assertEqual(len(packet['contextCards']),4)
            self.assertEqual(req['requiredTransferUids'],[])
            self.assertNotIn('scopeChange',packet['cards'][0])
            self.assertNotIn('supportedClaim',packet['cards'][0]['citations'][0])

    def test_lean_packet_preserves_scenarios_and_every_official_word(self):
        lean=p.compact_packet(self.packet,self.standard)
        self.assertEqual([x['text'] for x in lean['officialEvidence']],[x['text'] for x in self.packet['officialEvidence']])
        self.assertEqual([x['frontZh'] for x in lean['cards']],[x['frontZh'] for x in self.packet['cards']])
        self.assertNotIn('answerZh',lean['cards'][0])
        schema=p.lean_schema(self.adapter);self.assertNotIn('stableUid',schema['properties']['cards']['items']['required'])

    def test_corrupted_cached_review_rejected(self):
        reqpath=Path(CONFIG['importReviews'][1]);req=p.read(reqpath);original=p.read(reqpath.parent/'output.json');bad=copy.deepcopy(original);bad['cards'][0]['rules']['FACT']='FAIL'
        real=p.read
        with patch.object(p,'read',side_effect=lambda path:bad if Path(path)==reqpath.parent/'output.json' else real(path)):
            with self.assertRaisesRegex(ValueError,'overall'):p.proof_from_review(reqpath,CONFIG['sourceDir'])
        bad=copy.deepcopy(original);bad['inputSha256']='0'*64
        with patch.object(p,'read',side_effect=lambda path:bad if Path(path)==reqpath.parent/'output.json' else real(path)):
            with self.assertRaisesRegex(ValueError,'stale'):p.proof_from_review(reqpath,CONFIG['sourceDir'])

    def test_nested_timing_keeps_all_phases_and_original_start(self):
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp)
            with p.phase(folder,'outer'):
                with p.phase(folder,'inner'):pass
            first=p.read(folder/'timings.json');self.assertEqual({x['name'] for x in first['phases']},{'inner','outer'})
            with p.phase(folder,'resume'):pass
            self.assertEqual(p.read(folder/'timings.json')['startedUtc'],first['startedUtc'])

    def test_later_agents_sections_do_not_invalidate_teaching_standard(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'AGENTS.md';part='## 4. 卡片设计与教学验收标准\n教学正文\n'
            path.write_text(part);before=p.standard(path)
            path.write_text(part+'\n---\n\n## 5. 生成脚本\n仅执行说明\n')
            self.assertEqual(p.standard(path),before)

    def make_author_job(self, job, folder, lean):
        job.mkdir(parents=True,exist_ok=True);folder.mkdir(parents=True,exist_ok=True)
        p.save(job/'input.json',lean);p.save(job/'schema.json',p.lean_schema(self.adapter));p.save(job/'output.raw.json',{'cards':self.cards})
        prompt=p.AUTHOR_RULES+'\nBEGIN UNTRUSTED SOURCE DATA\n'+json.dumps(lean,ensure_ascii=False,separators=(',',':'))+'\nEND UNTRUSTED SOURCE DATA\n'
        (job/'prompt.txt').write_text(prompt);(folder/'author-prompt.txt').write_text(prompt)
        p.save(job/'result.json',{'status':'completed','exitCode':0,'usage':{'input_tokens':1,'output_tokens':1},'inputSha256':p.sha(job/'input.json'),'schemaSha256':p.sha(job/'schema.json'),'promptSha256':p.sha(job/'prompt.txt')})
        p.save(job/'mechanical-check.json',{'status':'PASS_STRUCTURE_ONLY','outputSha256':p.sha(job/'output.raw.json')})

    def test_author_parent_created_before_runner_and_channel_reused(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);ledger=root/'ledger';folder=root/'stage'/'batch-test';folder.mkdir(parents=True)
            lean=p.compact_packet(self.packet,self.standard)
            def fake_infer(name,path):
                job=ledger/name;self.assertTrue(job.parent.exists());self.make_author_job(job,folder,lean)
            runner=self.adapter.c
            with patch.multiple(runner,HERE=runner.HERE,RUN=runner.RUN,RULES=runner.RULES,schema=runner.schema,validate=runner.validate,infer=fake_infer):
                actual=p.call_author({'generationLedger':str(ledger),'runRoot':str(root)},self.batch,folder,self.packet,lean,self.adapter)
                self.assertTrue(actual.exists())

    def test_author_resume_rejects_timeout_and_input_output_drift(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);job=root/'author';folder=root/'stage';lean=p.compact_packet(self.packet,self.standard);self.make_author_job(job,folder,lean)
            self.assertEqual(p.verify_author_job(job,lean,folder,self.adapter),job/'output.raw.json')
            changed=copy.deepcopy(lean);changed['cards'][0]['frontZh']+=' changed'
            with self.assertRaisesRegex(ValueError,'input changed'):p.verify_author_job(job,changed,folder,self.adapter)
            result=p.read(job/'result.json');result['status']='timeout';p.save(job/'result.json',result)
            with self.assertRaisesRegex(ValueError,'unfinished'):p.verify_author_job(job,lean,folder,self.adapter)
            result['status']='completed';p.save(job/'result.json',result)
            (job/'output.raw.json').write_text((job/'output.raw.json').read_text()+' ')
            with self.assertRaisesRegex(ValueError,'output proof'):p.verify_author_job(job,lean,folder,self.adapter)

    def test_repair_limits_and_closed_failure_do_not_reopen(self):
        uid=self.cards[-1]['stableUid'];base=self.fp[uid];new='new-fingerprint'
        with tempfile.TemporaryDirectory() as temp:
            stage=Path(temp);history={uid:{'open':True,'attempts':0,'failedVersions':[base],'repairVersions':[],'findings':['stable-finding']}}
            self.assertEqual(p.repair_state(stage,history,self.cards,self.fp,{},2),[uid]);self.assertEqual(history[uid]['attempts'],0)
            fp=dict(self.fp);fp[uid]=new;p.repair_state(stage,history,self.cards,fp,{},2);self.assertEqual(history[uid]['attempts'],1)
            p.repair_state(stage,history,self.cards,fp,{},2);self.assertEqual(history[uid]['attempts'],1)
            p.repair_state(stage,history,self.cards,fp,{(uid,new):{}},2);self.assertFalse(history[uid]['open'])
            fp[uid]='ordinary-new-revision';p.repair_state(stage,history,self.cards,fp,{},2);self.assertEqual(history[uid]['attempts'],1)
            history[uid]['open']=True;history[uid]['attempts']=2
            with self.assertRaisesRegex(ValueError,'repair limit'):p.repair_state(stage,history,self.cards,fp,{},2)

    def test_blocking_finding_is_retained_once_without_reopening_closed_failure(self):
        uid=self.cards[-1]['stableUid']
        with tempfile.TemporaryDirectory() as temp:
            stage=Path(temp);job=stage/'batch-02'/'reviews'/'fake';job.mkdir(parents=True)
            p.save(job/'request.json',{'targetFingerprints':{uid:self.fp[uid]}})
            p.save(job/'output.json',{'cards':[{'stableUid':uid,'rules':{r:'PASS' for r in p.RULE_IDS}}], 'findings':[{'id':'issue','stableUid':uid,'ruleId':'S1','blocking':True}]})
            config=dict(CONFIG,repairHistoryPaths=[])
            history=p.failure_history(stage,config);self.assertTrue(history[uid]['open'])
            history[uid]['open']=False;p.save(stage/'repair-history.json',history)
            history=p.failure_history(stage,config);self.assertFalse(history[uid]['open'])

if __name__=='__main__':unittest.main()
