import contextlib, importlib.util, io, json, pathlib, subprocess, sys, tempfile, unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('maintenance',pathlib.Path(__file__).parents[1]/'maintenance-version.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
ROLE='arn:aws:iam::000000000000:role/developercards-db-maintenance-role'
ARN='arn:aws:lambda:ap-southeast-2:000000000000:function:core-vpc'
SHA='a'*43+'='
SECRET='local-maintenance-not-public'
class Commands(unittest.TestCase):
    def run_tool(self,action='invoke',body=None,fault=None,gateway='prod',aliased=False,config_mode=0o600,config_reads=None):
        calls=[];configs=[];payloads=[]
        current={'FunctionArn':ARN,'Role':'runtime-role','Handler':'runtime-handler','Environment':{'Variables':{'PGPASSWORD':'local-runtime'}},'RevisionId':'r1','CodeSha256':SHA}
        safe={'PGUSER':'developercards_migrator','PGHOST':'localhost','PGDATABASE':'test','PGSSLMODE':'verify-full','DB_ACCESS_MODE':'maintenance','AUTOMATION_MODE':'off','AI_QA_ENABLED':'0'}
        def aws(command,**kwargs):
            calls.append(command);name=command[2];data={}
            if name=='get-caller-identity':data={'Arn':'arn:aws:sts::000000000000:assumed-role/devcards-admin-mfa/test'}
            if name=='get-function-configuration':
                if '--qualifier' in command:data=dict(current,Role=ROLE,Handler=module.HANDLER,Environment={'Variables':safe},CodeSha256='wrong' if fault=='frozen' else SHA)
                else:
                    data=current.copy()
                    if fault=='base' or fault=='latest' and configs:data=dict(data,CodeSha256='wrong')
            if name=='list-aliases':data={'Aliases':[{'Name':'prod','FunctionVersion':'22' if aliased else '10'}]}
            if name=='get-integrations':data={'Items':[{'IntegrationUri':ARN+':'+gateway}]}
            if name=='update-function-configuration':
                path=pathlib.Path(command[command.index('--cli-input-json')+1][7:]);self.assertEqual(0o600,path.stat().st_mode & 0o777)
                config=json.loads(path.read_text());configs.append(config);current.update(config)
            if name=='publish-version':
                if fault=='publish':return subprocess.CompletedProcess(command,1,'','secret-diagnostic-must-not-leak')
                data={'Version':'22','CodeSha256':'wrong' if fault=='published' else SHA}
            if name=='invoke':
                arg=command[command.index('--payload')+1];self.assertTrue(arg.startswith('file://'))
                path=pathlib.Path(arg[7:]);self.assertEqual(0o600,path.stat().st_mode & 0o777);payloads.append(json.loads(path.read_text()))
                result=body if body is not None else {'statusCode':200,'body':json.dumps({'success':True,'data':{'dryRun':True,'pending':[{'version':56,'name':'rollback','file':'private','destructive':False}]}})}
                pathlib.Path(command[-3]).write_text(json.dumps(result))
            return subprocess.CompletedProcess(command,0,json.dumps(data),'')
        out=io.StringIO();error=None
        with tempfile.TemporaryDirectory() as d:
            config=pathlib.Path(d)/'private.json';config.write_text('{}');config.chmod(config_mode)
            # Keep the synthetic owner credential in memory; only this exact input read is mocked.
            private={'Environment':{'Variables':dict({k:v for k,v in safe.items() if k not in ('DB_ACCESS_MODE','AUTOMATION_MODE','AI_QA_ENABLED')},PGPASSWORD=SECRET)}}
            read_text=pathlib.Path.read_text
            def read_config(path,*args,**kwargs):
                if path == config:
                    if config_reads is not None:config_reads.append(path)
                    return json.dumps(private)
                return read_text(path,*args,**kwargs)
            args=[action,'--api-id','local','--role-arn',ROLE,'--expected-code-sha256',SHA,'--config',str(config)]
            if fault=='missing-hash':del args[5:7]
            if action!='create':args+=['--version','22']
            if body and 'blockedBy' in str(body):args+=['--operation','migrate']
            if fault!='dry':args+=['--apply']
            with patch.object(sys,'argv',['maintenance',*args]),patch.object(module.subprocess,'run',side_effect=aws),patch.object(pathlib.Path,'read_text',read_config),contextlib.redirect_stdout(out):
                try:module.main()
                except (RuntimeError,SystemExit) as ex:error=str(ex)
        return calls,out.getvalue(),error,current,configs,payloads
    def test_dry_run_has_zero_aws_calls(self):
        calls,out,error,*_=self.run_tool('create',fault='dry');self.assertFalse(calls);self.assertIsNone(error);self.assertIn('dryRun',out)
    def test_create_never_publishes_secret_even_transiently_and_restores(self):
        for fault in [None,'publish']:
            calls,out,error,current,configs,_=self.run_tool('create',fault=fault)
            self.assertEqual(fault is not None,error is not None);self.assertEqual('runtime-handler',current['Handler'])
            self.assertNotIn('PGPASSWORD',configs[0]['Environment']['Variables']);self.assertNotIn(SECRET,json.dumps(configs)+json.dumps(calls)+out+str(error));self.assertFalse(any(c[2]=='update-alias' for c in calls))
    def test_private_config_permissions_are_checked_before_mocked_read(self):
        for action in ['create','invoke']:
            reads=[]
            _,_,error,_,configs,payloads=self.run_tool(action,config_mode=0o644,config_reads=reads)
            self.assertEqual('Private owner 0600 maintenance config required',error)
            self.assertFalse(reads);self.assertFalse(configs);self.assertFalse(payloads)
    def test_hash_binding_rejects_base_latest_published_and_frozen_mismatch(self):
        for fault in ['base','latest','published','frozen']:
            calls,_,error,_,_,payloads=self.run_tool('invoke' if fault=='frozen' else 'create',fault=fault)
            self.assertIsNotNone(error,fault);self.assertFalse(payloads)
            if fault=='base':self.assertFalse(any(c[2]=='update-function-configuration' for c in calls))
    def test_invoke_private_file_payload_and_allowlisted_plan(self):
        calls,out,error,_,_,payloads=self.run_tool();self.assertIsNone(error);self.assertEqual(SECRET,payloads[0]['Password'])
        command=next(c for c in calls if c[2]=='invoke');self.assertTrue(command[command.index('--payload')+1].startswith('file://'));self.assertNotIn(SECRET,json.dumps(calls)+out)
        self.assertEqual(56,json.loads(out)['pending'][0]['version']);self.assertNotIn('file',out)
    def test_blocked_and_invalid_response_fail_closed_without_error_echo(self):
        cases=[{'statusCode':200},{'statusCode':200,'body':'not-json'},{'statusCode':500,'body':'secret-database-error'},{'statusCode':200,'body':json.dumps({'success':True,'data':{'dryRun':False,'applied':[],'blockedBy':{'version':57,'name':'stop','file':'secret-database-error'}}})}]
        for body in cases:
            _,out,error,*_=self.run_tool(body=body);self.assertIsNotNone(error);self.assertNotIn('secret-database-error',out+error)
        self.assertIn('"complete": false',out);self.assertIn('"blockedBy"',out)
    def test_existing_cd_reads_cannot_obtain_a_secret_and_handler_never_uses_static_pool(self):
        root=pathlib.Path(__file__).parents[3]
        policy=(root/'infra/modules/operators/main.tf').read_text()
        for action in ['lambda:GetFunction','lambda:GetFunctionConfiguration','lambda:ListVersionsByFunction']:self.assertIn(action,policy)
        _,out,error,_,configs,_=self.run_tool('create');self.assertIsNone(error)
        # GetFunction Configuration, GetFunctionConfiguration and version listings all serialize the same environment.
        public=configs[0]['Environment']
        responses=[{'Configuration':{'Environment':public}},{'Environment':public},{'Versions':[{'Environment':public}]}]
        self.assertNotIn(SECRET,json.dumps(responses)+out)
        handler=(root/'src_C/Vpc/Db/MaintenanceFunction.cs').read_text()
        self.assertIn('Pooling = false',handler);self.assertNotIn('Pg.OpenConnection',handler);self.assertNotIn('SetEnvironmentVariable',handler)
    def test_expected_hash_is_required_before_any_aws_calls(self):
        for action in ['create','invoke']:
            calls,_,error,*_=self.run_tool(action,fault='missing-hash');self.assertIsNotNone(error);self.assertFalse(calls)
    def test_applied_summary_omits_arbitrary_response_fields(self):
        body={'statusCode':200,'body':json.dumps({'success':True,'data':{'dryRun':False,'applied':[{'version':56,'name':'056_rollback','file':'hidden'}],'blockedBy':None,'message':'private-database-diagnostic'}})}
        # Invoke migrate using the same realistic response shape as the handler.
        _,out,error,*_=self.run_tool(body=body);self.assertIsNone(error)
        self.assertTrue(json.loads(out)['complete']);self.assertEqual(56,json.loads(out)['applied'][0]['version'])
        self.assertNotIn('private-database-diagnostic',out);self.assertNotIn('hidden',out)
    def test_gateway_or_alias_refused(self):
        for kwargs in [{'gateway':'22'},{'aliased':True}]:
            calls,_,error,*_=self.run_tool('cleanup',**kwargs);self.assertIsNotNone(error);self.assertFalse(any(c[2]=='delete-function' for c in calls))
if __name__=='__main__':unittest.main()
