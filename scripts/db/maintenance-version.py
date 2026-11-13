#!/usr/bin/env python3
"""Owner/MFA-only direct invocation. Dry-run default; no alias is ever updated.
Credentials arrive in a 0600 config file, never CLI arguments, stdout or Terraform.
"""
import argparse, json, os, pathlib, re, subprocess, tempfile

HANDLER = 'RecallSmith.Lambda::RecallSmith.Lambda.Vpc.Db.MaintenanceFunction::Handler'

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['create', 'invoke', 'cleanup'])
    p.add_argument('--function', default='core-vpc')
    p.add_argument('--api-id', required=True)
    p.add_argument('--role-arn', required=True)
    p.add_argument('--config', type=pathlib.Path, help='0600 JSON: Environment.Variables with independent maintenance PG values')
    p.add_argument('--version', type=int)
    p.add_argument('--operation', choices=['plan', 'migrate'], default='plan')
    p.add_argument('--confirm-destructive')
    p.add_argument('--apply', action='store_true')
    a = p.parse_args()
    if not re.fullmatch(r'arn:aws:iam::\d{12}:role/developercards-db-maintenance-role', a.role_arn):
        p.error('exact maintenance execution role ARN required')
    if a.action != 'create' and (not a.version or a.version < 1):
        p.error('positive immutable --version required')
    if not a.apply:
        print(json.dumps({'dryRun': True, 'action': a.action, 'function': a.function,
            'version': a.version, 'steps': ['assert MFA owner', 'assert every gateway integration uses prod alias',
            'assert aliases exclude maintenance', 'create: snapshot latest privately, configure isolated credentials/handler/role, publish, restore latest',
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
    with tempfile.TemporaryDirectory(prefix='recallsmith-maintenance-') as tmp:
        def config_file(name, value):
            path = pathlib.Path(tmp) / name
            path.write_text(json.dumps(value)); path.chmod(0o600)
            return 'file://' + str(path)
        if a.action == 'create':
            if not a.config or a.config.stat().st_mode & 0o077: raise RuntimeError('Private 0600 maintenance config required')
            config = json.loads(a.config.read_text())
            env = config.get('Environment',{}).get('Variables',{})
            if env.get('PGUSER') != 'developercards_migrator' or not env.get('PGPASSWORD') or env.get('PGSSLMODE') != 'verify-full':
                raise RuntimeError('Independent maintenance credentials and verify-full required')
            if set(env) - {'PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','PGSSLROOTCERT','API_ENV'}:
                raise RuntimeError('Only maintenance PG/TLS configuration is accepted')
            env.update(DB_ACCESS_MODE='maintenance', AUTOMATION_MODE='off', AI_QA_ENABLED='0')
            if base.get('Environment',{}).get('Variables',{}).get('PGPASSWORD') == env['PGPASSWORD']:
                raise RuntimeError('Runtime and maintenance passwords must differ')
            restore = {k:base[k] for k in ['Role','Handler','Environment'] if k in base}
            restore['FunctionName'] = a.function
            try:
                aws('lambda','update-function-configuration','--cli-input-json',config_file('maintenance.json',
                    {'FunctionName':a.function,'Role':a.role_arn,'Handler':HANDLER,'Environment':{'Variables':env},'RevisionId':base['RevisionId']}))
                aws('lambda','wait','function-updated-v2','--function-name',a.function)
                latest = aws('lambda','get-function-configuration','--function-name',a.function)
                if latest.get('Role') != a.role_arn or latest.get('Handler') != HANDLER or latest.get('Environment',{}).get('Variables') != env:
                    raise RuntimeError('Latest configuration changed; refusing to publish')
                published = aws('lambda','publish-version','--function-name',a.function,'--revision-id',latest['RevisionId'],
                    '--code-sha256',latest['CodeSha256'],'--description','operator-only-db-maintenance')
                unaliased(published['Version'])
                print(json.dumps({'maintenanceVersion':published['Version'],'codeSha256':published['CodeSha256']}))
            finally:
                aws('lambda','update-function-configuration','--cli-input-json',config_file('restore.json',restore))
                aws('lambda','wait','function-updated-v2','--function-name',a.function)
        else:
            unaliased(a.version)
            frozen = aws('lambda','get-function-configuration','--function-name',a.function,'--qualifier',str(a.version))
            if frozen.get('Role') != a.role_arn or frozen.get('Handler') != HANDLER or frozen.get('Environment',{}).get('Variables',{}).get('DB_ACCESS_MODE') != 'maintenance':
                raise RuntimeError('Version is not a dedicated maintenance artifact')
            if a.action == 'cleanup':
                aws('lambda','delete-function','--function-name',a.function,'--qualifier',str(a.version))
            else:
                payload = {'Operation':a.operation,'ConfirmDestructive':a.confirm_destructive}
                out = str(pathlib.Path(tmp)/'response.json')
                response = aws('lambda','invoke','--function-name',a.function,'--qualifier',str(a.version),
                    '--cli-binary-format','raw-in-base64-out','--payload',json.dumps(payload),out)
                if response.get('FunctionError'): raise RuntimeError('Maintenance handler failed')
                result = json.loads(pathlib.Path(out).read_text())
                if result.get('statusCode') != 200: raise RuntimeError('Maintenance request rejected')
                print(json.dumps({'statusCode':200,'version':a.version,'operation':a.operation}))
        unaliased(a.version or published['Version'])
if __name__ == '__main__': main()
