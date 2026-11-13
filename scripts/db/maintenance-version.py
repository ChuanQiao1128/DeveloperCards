#!/usr/bin/env python3
"""Owner/MFA-only direct invocation. Dry-run default; no alias is ever updated.
Credentials arrive in a 0600 config file, never CLI arguments, stdout or Terraform.
"""
import argparse, json, os, pathlib, re, stat, subprocess, tempfile

HANDLER = 'RecallSmith.Lambda::RecallSmith.Lambda.Vpc.Db.MaintenanceFunction::Handler'

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['create', 'invoke', 'cleanup'])
    p.add_argument('--function', default='core-vpc')
    p.add_argument('--api-id', required=True)
    p.add_argument('--role-arn', required=True)
    p.add_argument('--config', type=pathlib.Path, help='0600 JSON: Environment.Variables with independent maintenance PG values')
    p.add_argument('--version', type=int)
    p.add_argument('--expected-code-sha256', help='Reviewed ZIP SHA-256 in Lambda base64 format; required for create/invoke')
    p.add_argument('--operation', choices=['plan', 'migrate'], default='plan')
    p.add_argument('--confirm-destructive')
    p.add_argument('--apply', action='store_true')
    a = p.parse_args()
    if not re.fullmatch(r'arn:aws:iam::\d{12}:role/developercards-db-maintenance-role', a.role_arn):
        p.error('exact maintenance execution role ARN required')
    if a.action != 'create' and (not a.version or a.version < 1):
        p.error('positive immutable --version required')
    if a.apply and a.action in ('create', 'invoke') and not re.fullmatch(r'[A-Za-z0-9+/]{43}=', a.expected_code_sha256 or ''):
        p.error('Reviewed --expected-code-sha256 required for create/invoke')
    if not a.apply:
        print(json.dumps({'dryRun': True, 'action': a.action, 'function': a.function,
            'version': a.version, 'steps': ['assert MFA owner', 'assert every gateway integration uses prod alias',
            'assert aliases exclude maintenance', 'create: snapshot latest privately, configure public PG/TLS/handler/role only, publish, restore latest',
            'invoke: exact numeric version only; default operation plan', 'cleanup: delete exact unaliased numeric version only'],
            'aliasUpdates': False}))
        return
    def aws(*args):
        # CLI errors may echo configuration; retain neither stdout nor stderr on failure.
        result = subprocess.run(['aws', *args, '--output', 'json'], capture_output=True, text=True)
        if result.returncode: raise RuntimeError('AWS maintenance command failed (details suppressed)')
        return json.loads(result.stdout or '{}')
    caller = aws('sts', 'get-caller-identity')['Arn']
    if ':assumed-role/devcards-admin-mfa/' not in caller:
        raise RuntimeError('Use the existing devcards-admin-mfa session')
    base = aws('lambda', 'get-function-configuration', '--function-name', a.function)
    arn = base['FunctionArn'].split(':function:')[0] + ':function:' + a.function
    if base.get('Environment',{}).get('Variables',{}).get('DB_ACCESS_MODE') == 'maintenance':
        raise RuntimeError('Latest configuration requires owner recovery before proceeding')
    aliases = aws('lambda', 'list-aliases', '--function-name', a.function)['Aliases']
    prod = next((x for x in aliases if x['Name'] == 'prod'), None)
    if not prod: raise RuntimeError('prod alias is required')
    integrations = aws('apigatewayv2', 'get-integrations', '--api-id', a.api_id).get('Items', [])
    for item in integrations:
        uri = item.get('IntegrationUri', '')
        if arn in uri and not (uri == arn + ':prod' or arn + ':prod/invocations' in uri):
            raise RuntimeError('Gateway must target only the prod alias')
    if not any(arn in i.get('IntegrationUri','') for i in integrations):
        raise RuntimeError('No protected gateway integration found')
    def unaliased(version):
        current = aws('lambda', 'list-aliases', '--function-name', a.function)['Aliases']
        if current != aliases: raise RuntimeError('Aliases changed; stop and investigate')
        if any(x['FunctionVersion'] == str(version) or str(version) in x.get('RoutingConfig',{}).get('AdditionalVersionWeights',{}) for x in current):
            raise RuntimeError('Maintenance version must have no alias')
    def reviewed(config):
        if config.get('CodeSha256') != a.expected_code_sha256:
            raise RuntimeError('Artifact differs from reviewed ZIP CodeSha256')
    def private_config():
        if not a.config: raise RuntimeError('Private 0600 maintenance config required')
        info = a.config.lstat()
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.getuid():
            raise RuntimeError('Private owner 0600 maintenance config required')
        env = json.loads(a.config.read_text()).get('Environment', {}).get('Variables', {})
        if (env.get('PGUSER') != 'developercards_migrator' or not isinstance(env.get('PGPASSWORD'), str)
            or not env['PGPASSWORD'] or env.get('PGSSLMODE') != 'verify-full'):
            raise RuntimeError('Independent maintenance credentials and verify-full required')
        if set(env) - {'PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','PGSSLROOTCERT','API_ENV'}:
            raise RuntimeError('Only maintenance PG/TLS configuration is accepted')
        return env
    with tempfile.TemporaryDirectory(prefix='recallsmith-maintenance-') as tmp:
        def config_file(name, value):
            path = pathlib.Path(tmp) / name
            with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
                json.dump(value, stream)
            return 'file://' + str(path)
        if a.action == 'create':
            reviewed(base)
            env = private_config()
            password = env.pop('PGPASSWORD')
            if base.get('Environment',{}).get('Variables',{}).get('PGPASSWORD') == password:
                raise RuntimeError('Runtime and maintenance passwords must differ')
            env.update(DB_ACCESS_MODE='maintenance', AUTOMATION_MODE='off', AI_QA_ENABLED='0')
            restore = {k:base[k] for k in ['Role','Handler','Environment'] if k in base}
            restore['FunctionName'] = a.function
            try:
                aws('lambda','update-function-configuration','--cli-input-json',config_file('maintenance.json',
                    {'FunctionName':a.function,'Role':a.role_arn,'Handler':HANDLER,'Environment':{'Variables':env},'RevisionId':base['RevisionId']}))
                aws('lambda','wait','function-updated-v2','--function-name',a.function)
                latest = aws('lambda','get-function-configuration','--function-name',a.function)
                reviewed(latest)
                if latest.get('Role') != a.role_arn or latest.get('Handler') != HANDLER or latest.get('Environment',{}).get('Variables') != env:
                    raise RuntimeError('Latest configuration changed; refusing to publish')
                published = aws('lambda','publish-version','--function-name',a.function,'--revision-id',latest['RevisionId'],
                    '--code-sha256',a.expected_code_sha256,'--description','operator-only-db-maintenance')
                reviewed(published)
                unaliased(published['Version'])
                print(json.dumps({'maintenanceVersion':published['Version'],'codeSha256':published['CodeSha256']}))
            finally:
                aws('lambda','update-function-configuration','--cli-input-json',config_file('restore.json',restore))
                aws('lambda','wait','function-updated-v2','--function-name',a.function)
        else:
            unaliased(a.version)
            frozen = aws('lambda','get-function-configuration','--function-name',a.function,'--qualifier',str(a.version))
            if a.action == 'invoke': reviewed(frozen)
            if 'PGPASSWORD' in frozen.get('Environment',{}).get('Variables',{}):
                raise RuntimeError('Maintenance version must not contain a stored password')
            if frozen.get('Role') != a.role_arn or frozen.get('Handler') != HANDLER or frozen.get('Environment',{}).get('Variables',{}).get('DB_ACCESS_MODE') != 'maintenance':
                raise RuntimeError('Version is not a dedicated maintenance artifact')
            if a.action == 'cleanup':
                aws('lambda','delete-function','--function-name',a.function,'--qualifier',str(a.version))
            else:
                env = private_config()
                public = {k:v for k,v in env.items() if k != 'PGPASSWORD'}
                stored = frozen.get('Environment',{}).get('Variables',{})
                if any(stored.get(k) != v for k,v in public.items()):
                    raise RuntimeError('Private config does not match the reviewed maintenance version')
                payload = {'Operation':a.operation,'ConfirmDestructive':a.confirm_destructive,'Password':env['PGPASSWORD']}
                out = str(pathlib.Path(tmp)/'response.json')
                response = aws('lambda','invoke','--function-name',a.function,'--qualifier',str(a.version),
                    '--cli-binary-format','raw-in-base64-out','--payload',config_file('invoke.json',payload),out)
                if response.get('FunctionError'): raise RuntimeError('Maintenance handler failed')
                result = json.loads(pathlib.Path(out).read_text())
                if result.get('statusCode') != 200: raise RuntimeError('Maintenance request rejected')
                summary = migration_summary(result, a.operation)
                print(json.dumps(dict(version=a.version, operation=a.operation, **summary)))
                if not summary['complete'] and a.operation == 'migrate':
                    raise RuntimeError('Migration incomplete; destructive confirmation required')
        unaliased(a.version or published['Version'])
def migration_summary(result, operation):
    # The handler envelope is untrusted output. Never forward error/message/file/SQL details.
    try:
        if not isinstance(result, dict): raise ValueError()
        body = json.loads(result['body'])
        if not isinstance(body, dict): raise ValueError()
        data = body['data']
        if result['statusCode'] != 200 or body.get('success') is not True or not isinstance(data, dict): raise ValueError()
        if data.get('dryRun') is not (operation == 'plan'): raise ValueError()
        def item(value, destructive=False):
            version, name = value['version'], value['name']
            if type(version) is not int or version < 1 or not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', name): raise ValueError()
            out = {'version':version, 'name':name}
            if destructive:
                if type(value['destructive']) is not bool: raise ValueError()
                out['destructive'] = value['destructive']
            return out
        if operation == 'plan':
            if not isinstance(data['pending'], list): raise ValueError()
            return {'complete':True, 'dryRun':True, 'pending':[item(v, True) for v in data['pending']]}
        if not isinstance(data['applied'], list): raise ValueError()
        blocked = data['blockedBy']
        return {'complete':blocked is None, 'dryRun':False, 'applied':[item(v) for v in data['applied']],
            'blockedBy':None if blocked is None else item(blocked)}
    except (KeyError, TypeError, ValueError):
        raise RuntimeError('Invalid maintenance response (details suppressed)') from None

if __name__ == '__main__':
    try: main()
    except Exception:
        raise SystemExit('Maintenance failed; response/configuration details suppressed')
