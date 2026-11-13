import contextlib
import importlib.util
import io
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('maintenance', pathlib.Path(__file__).parents[1] / 'maintenance-version.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ROLE='arn:aws:iam::000000000000:role/developercards-db-maintenance-role'
ARN='arn:aws:lambda:ap-southeast-2:000000000000:function:core-vpc'

class Commands(unittest.TestCase):
    def run_tool(self, args, fail_publish=False, gateway='prod', aliased=False):
        calls=[]
        env={'PGUSER':'developercards_app','PGPASSWORD':'local-runtime'}
        current={'FunctionArn':ARN,'Role':'runtime-role','Handler':'runtime-handler','Environment':{'Variables':env},'RevisionId':'r1','CodeSha256':'code-hash'}
        def aws(command,**kwargs):
            calls.append(command)
            name=command[2]
            data={}
            if name=='get-caller-identity': data={'Arn':'arn:aws:sts::000000000000:assumed-role/devcards-admin-mfa/test'}
            if name=='get-function-configuration':
                if '--qualifier' in command:
                    data=dict(current,Role=ROLE,Handler=module.HANDLER,Environment={'Variables':{'DB_ACCESS_MODE':'maintenance'}})
                else:data=current.copy()
            if name=='list-aliases':data={'Aliases':[{'Name':'prod','FunctionVersion':'22' if aliased else '10'}]}
            if name=='get-integrations':data={'Items':[{'IntegrationUri':ARN+':'+gateway}]}
            if name=='update-function-configuration':
                config=json.loads(pathlib.Path(command[command.index('--cli-input-json')+1][7:]).read_text())
                current.update(config)
            if name=='publish-version':
                if fail_publish:return subprocess.CompletedProcess(command,1,'','secret-diagnostic-must-not-leak')
                data={'Version':'22','CodeSha256':'code-hash'}
            if name=='invoke':
                pathlib.Path(command[-3]).write_text(json.dumps({'statusCode':200}))
            return subprocess.CompletedProcess(command,0,json.dumps(data),'')
        out=io.StringIO()
        with patch.object(sys,'argv',['maintenance',*args]),patch.object(module.subprocess,'run',side_effect=aws),contextlib.redirect_stdout(out):
            try:module.main()
            except RuntimeError as ex:return calls,out.getvalue(),str(ex),current
        return calls,out.getvalue(),None,current
    def args(self,action,*extra):return [action,'--api-id','local-api','--role-arn',ROLE,*extra]
    def test_dry_run_has_zero_aws_calls(self):
        calls,out,error,_=self.run_tool(self.args('create'))
        self.assertFalse(calls);self.assertIsNone(error);self.assertIn('"dryRun": true',out)
    def test_create_restores_latest_and_never_changes_alias(self):
        with tempfile.TemporaryDirectory() as d:
            config=pathlib.Path(d)/'config.json';config.write_text(json.dumps({'Environment':{'Variables':{'PGUSER':'developercards_migrator','PGPASSWORD':'local-maintenance','PGSSLMODE':'verify-full'}}}));config.chmod(0o600)
            calls,out,error,current=self.run_tool(self.args('create','--config',str(config),'--apply'))
            self.assertIsNone(error);self.assertEqual('runtime-handler',current['Handler']);self.assertEqual('runtime-role',current['Role'])
            self.assertNotIn('local-maintenance',out);self.assertNotIn('local-runtime',out)
            self.assertTrue(any(c[2]=='publish-version' for c in calls));self.assertFalse(any(c[2]=='update-alias' for c in calls))
            calls,out,error,current=self.run_tool(self.args('create','--config',str(config),'--apply'),fail_publish=True)
            self.assertIsNotNone(error);self.assertEqual('runtime-handler',current['Handler']);self.assertNotIn('secret-diagnostic',out+error)
    def test_gateway_numeric_and_alias_target_fail_before_mutation(self):
        for kwargs in [{'gateway':'22'},{'aliased':True}]:
            calls,_,error,_=self.run_tool(self.args('cleanup','--version','22','--apply'),**kwargs)
            self.assertIsNotNone(error);self.assertFalse(any(c[2]=='delete-function' for c in calls))
    def test_cleanup_and_invoke_use_only_numeric_qualified_version(self):
        for action in ['cleanup','invoke']:
            calls,_,error,_=self.run_tool(self.args(action,'--version','22','--apply'))
            self.assertIsNone(error)
            command=next(c for c in calls if c[2]==('delete-function' if action=='cleanup' else 'invoke'))
            self.assertEqual('22',command[command.index('--qualifier')+1])
            self.assertFalse(any(c[2]=='update-alias' for c in calls))

if __name__=='__main__':unittest.main()
