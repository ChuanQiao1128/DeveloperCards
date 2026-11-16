"""Offline SDK-shape/transport checks. No credentials, service clients or cloud calls."""
from copy import deepcopy
from datetime import datetime,timezone,timedelta
import base64
import hashlib
import json
import zipfile
from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from guards import Blocked, Ledger
from test_guards import manifest
import cloud

try:
    import botocore.session
    from botocore import xform_name
    from botocore.exceptions import ClientError
    from botocore.validate import validate_parameters
except ImportError:
    botocore = None


class Transport:
    """Small service-state fixture; validates EVERY outgoing input via pinned SDK."""
    def __init__(self,ledger):
        self.ledger=ledger;self.calls=[];self.data={};self.models={};self.counter=0
    def factory(self,session,service,ledger,cleanup=False,deadline_monotonic=None):
        outer=self
        class Client:
            def __getattr__(self,operation):
                def send(**kwargs):
                    ledger.consume("cleanupSDK" if cleanup else "sdkControl")
                    if service=="lambda" and operation=="invoke":ledger.consume("handlerInvocations",cleanup=cleanup)
                    if service not in outer.models:outer.models[service]=botocore.session.get_session().get_service_model(service)
                    model=outer.models[service]
                    api=next(x for x in model.operation_names if xform_name(x)==operation)
                    validate_parameters(kwargs,model.operation_model(api).input_shape)
                    outer.calls.append((service,operation))
                    return outer.reply(service,operation,kwargs)
                return send
        return Client()
    def missing(self):
        raise ClientError({"Error":{"Code":"ResourceNotFoundException"}},"Fixture")
    def new(self,prefix):
        self.counter+=1;return prefix+str(self.counter)
    def reply(self,s,o,k):
        d=self.data
        if s=="sts":return {"Account":"622994489535"}
        if s=="ec2":
            groups=d.setdefault("sg",{});rules=d.setdefault("rules",{})
            if o=="create_security_group":
                ident=self.new("sg-");groups[ident]={"GroupId":ident,"GroupName":k["GroupName"],"Tags":k["TagSpecifications"][0]["Tags"],"IpPermissionsEgress":[]};return {"GroupId":ident}
            if o=="describe_security_groups":return {"SecurityGroups":[x for key,x in groups.items() if key in k.get("GroupIds",groups)]}
            if o.startswith("authorize_security_group_"):
                ident=self.new("sgr-");rules[ident]={"SecurityGroupRuleId":ident,"Tags":k["TagSpecifications"][0]["Tags"]};return {"SecurityGroupRules":[rules[ident]]}
            if o=="describe_security_group_rules":
                values=list(rules.values())
                if "SecurityGroupRuleIds" in k:values=[x for x in values if x["SecurityGroupRuleId"] in k["SecurityGroupRuleIds"]]
                else:
                    key=next(x["Values"][0] for x in k["Filters"] if x["Name"]=="tag:S2Key")
                    values=[x for x in values if {t["Key"]:t["Value"] for t in x["Tags"]}.get("S2Key")==key]
                return {"SecurityGroupRules":values}
            if o.startswith("revoke_security_group_"):
                for ident in k.get("SecurityGroupRuleIds",[]):rules.pop(ident,None)
                return {}
            if o=="delete_security_group":groups.pop(k["GroupId"]);return {}
        if s=="iam":
            roles=d.setdefault("roles",{});policies=d.setdefault("policies",{})
            if o=="get_role":
                if k["RoleName"] not in roles:self.missing()
                return {"Role":roles[k["RoleName"]]}
            if o=="create_role":roles[k["RoleName"]]={"RoleName":k["RoleName"],"Tags":k["Tags"]};return {"Role":roles[k["RoleName"]]}
            pair=(k.get("RoleName"),k.get("PolicyName"))
            if o=="put_role_policy":policies[pair]=k["PolicyDocument"];return {"ResponseMetadata":{}}
            if o=="get_role_policy":
                if pair not in policies:self.missing()
                return {"PolicyName":pair[1]}
            if o=="delete_role_policy":policies.pop(pair);return {}
            if o=="delete_role":roles.pop(k["RoleName"]);return {}
        if s=="logs":
            logs=d.setdefault("logs",{})
            if o=="describe_log_groups":return {"logGroups":[{"logGroupName":name} for name in logs if name.startswith(k["logGroupNamePrefix"])]}
            if o=="create_log_group":logs[k["logGroupName"]]=k["tags"];return {"ResponseMetadata":{}}
            if o=="list_tags_log_group":return {"tags":logs[k["logGroupName"]]}
            if o=="put_retention_policy":return {}
            if o=="delete_log_group":logs.pop(k["logGroupName"]);return {}
        if s=="lambda":
            functions=d.setdefault("functions",{});aliases=d.setdefault("aliases",{});mappings=d.setdefault("mappings",{})
            name=k.get("FunctionName")
            if o=="invoke":return {"StatusCode":200,"Payload":BytesIO(b"{}") }
            if o=="get_function_configuration":
                if name not in functions:self.missing()
                return functions[name]
            if o=="create_function":
                functions[name]={"FunctionName":name,"FunctionArn":cloud._arn("lambda","function:"+name),"Version":"1","CodeSha256":base64.b64encode(hashlib.sha256(k["Code"]["ZipFile"]).digest()).decode(),"Handler":k["Handler"],"State":"Active","LastUpdateStatus":"Successful","Tags":k["Tags"]};return functions[name]
            if o=="list_tags":
                arn=k["Resource"]
                if ":event-source-mapping:" in arn:return {"Tags":next(x["Tags"] for x in mappings.values() if x["EventSourceMappingArn"]==arn)}
                return {"Tags":next(x["Tags"] for x in functions.values() if x["FunctionArn"]==arn)}
            if o=="update_function_code":functions[name]["CodeSha256"]=base64.b64encode(hashlib.sha256(k["ZipFile"]).digest()).decode();return functions[name]
            if o=="update_function_configuration":functions[name]["Handler"]=k["Handler"];return functions[name]
            if o=="publish_version":functions[name]["Version"]=str(int(functions[name]["Version"])+1);return functions[name]
            if o=="put_function_concurrency":return {}
            pair=(name,k.get("Name"))
            if o=="get_alias":
                if pair not in aliases:self.missing()
                return aliases[pair]
            if o=="create_alias" or o=="update_alias":aliases[pair]={"AliasArn":cloud._arn("lambda","function:"+name+":"+k["Name"]),"FunctionVersion":k["FunctionVersion"]};return aliases[pair]
            if o=="add_permission" or o=="put_function_event_invoke_config":return {}
            if o=="list_event_source_mappings":return {"EventSourceMappings":list(mappings.values())}
            if o=="create_event_source_mapping":
                self.counter+=1;ident="12345678-1234-1234-1234-"+format(self.counter,"012d");mappings[ident]={"UUID":ident,"EventSourceArn":k["EventSourceArn"],"EventSourceMappingArn":cloud._arn("lambda","event-source-mapping:"+ident),"Tags":k["Tags"]};return mappings[ident]
            if o=="get_event_source_mapping":
                if k["UUID"] not in mappings:self.missing()
                return mappings[k["UUID"]]
            if o=="update_event_source_mapping":return mappings[k["UUID"]]
            if o=="delete_event_source_mapping":return mappings.pop(k["UUID"])
            if o=="delete_function":functions.pop(name);return {}
        if s=="cognito-idp":
            pools=d.setdefault("pools",{});clients=d.setdefault("clients",{});groups=d.setdefault("groups",{});domains=d.setdefault("domains",{})
            if o=="list_user_pools":return {"UserPools":list(pools.values())}
            if o=="create_user_pool":
                ident="ap-southeast-2_"+self.new("Pool");pools[ident]={"Id":ident,"Name":k["PoolName"],"Tags":k["UserPoolTags"]};return {"UserPool":pools[ident]}
            if o=="describe_user_pool":
                if k["UserPoolId"] not in pools:self.missing()
                return {"UserPool":pools[k["UserPoolId"]]}
            if o=="list_tags_for_resource":return {"Tags":pools[k["ResourceArn"].split("/")[-1]]["Tags"]}
            if o=="list_user_pool_clients":return {"UserPoolClients":list(clients.values())}
            if o=="create_user_pool_client":
                ident=self.new("client");clients[ident]={"ClientId":ident,"ClientName":k["ClientName"]};return {"UserPoolClient":clients[ident]}
            pair=(k.get("UserPoolId"),k.get("GroupName"))
            if o=="get_group":
                if pair not in groups:self.missing()
                return {"Group":{"GroupName":pair[1]}}
            if o=="create_group":groups[pair]=True;return {"ResponseMetadata":{}}
            if o=="describe_user_pool_domain":return {"DomainDescription":domains.get(k["Domain"],{})}
            if o=="create_user_pool_domain":domains[k["Domain"]]={"UserPoolId":k["UserPoolId"]};return {"ResponseMetadata":{}}
            if o=="delete_user_pool_domain":
                if d.pop("deleteDomainErrorOnce",False):raise ClientError({"Error":{"Code":"InternalErrorException"}},"DeleteUserPoolDomain")
                domains.pop(k["Domain"]);return {}
            if o=="delete_user_pool":pools.pop(k["UserPoolId"]);return {}
        if s=="s3":
            buckets=d.setdefault("buckets",{})
            if o=="head_bucket":
                if k["Bucket"] not in buckets:self.missing()
                return {"ResponseMetadata":{}}
            if o=="create_bucket":buckets[k["Bucket"]]={};return {"ResponseMetadata":{}}
            if o=="put_bucket_tagging":buckets[k["Bucket"]]=k["Tagging"];return {}
            if o=="get_bucket_tagging":return buckets[k["Bucket"]]
            if o in ("put_public_access_block","put_bucket_encryption"):return {}
            if o=="list_object_versions":return {"IsTruncated":False,"Versions":d.setdefault("bucketVersions",{}).get(k["Bucket"],[])}
            if o=="delete_objects":
                if d.pop("deleteObjectErrorOnce",False):return {"Errors":[{"Key":k["Delete"]["Objects"][0]["Key"],"Code":"InternalError"}]}
                d.setdefault("bucketVersions",{})[k["Bucket"]]=[];return {}
            if o=="list_objects_v2":return {"KeyCount":len(d.setdefault("bucketVersions",{}).get(k["Bucket"],[]))}
            if o=="delete_bucket":buckets.pop(k["Bucket"]);return {}
        if s=="sqs":
            queues=d.setdefault("queues",{});url=k.get("QueueUrl")
            if o=="create_queue":url=f'https://sqs.ap-southeast-2.amazonaws.com/622994489535/{k["QueueName"]}';queues[url]=k["tags"];return {"QueueUrl":url}
            if o=="get_queue_attributes":
                if url not in queues:self.missing()
                return {"Attributes":{"QueueArn":cloud._arn("sqs",url.split("/")[-1])}}
            if o=="list_queue_tags":return {"Tags":queues[url]}
            if o=="delete_queue":queues.pop(url);return {}
        if s=="apigatewayv2":
            apis=d.setdefault("apis",{});children=d.setdefault("children",{})
            if o=="get_apis":return {"Items":list(apis.values())}
            if o=="create_api":ident=self.new("api");apis[ident]={"ApiId":ident,"Name":k["Name"],"Tags":k["Tags"]};return apis[ident]
            if o=="get_api":
                if k["ApiId"] not in apis:self.missing()
                return apis[k["ApiId"]]
            for singular,idkey,namekey in [("authorizer","AuthorizerId","Name"),("integration","IntegrationId","IntegrationUri"),("route","RouteId","RouteKey"),("stage","StageName","StageName")]:
                values=children.setdefault(singular,{})
                if o=="get_"+singular+"s":return {"Items":list(values.values())}
                if o=="create_"+singular:
                    ident=k.get(idkey,self.new(singular));values[ident]={idkey:ident,namekey:k[namekey]};return values[ident]
            if o=="delete_api":apis.pop(k["ApiId"]);return {}
        if s=="cloudwatch":
            alarms=d.setdefault("alarms",{})
            if o=="describe_alarms":return {"MetricAlarms":[{"AlarmName":x} for x in k["AlarmNames"] if x in alarms]}
            if o=="put_metric_alarm":alarms[k["AlarmName"]]=k["Tags"];return {"ResponseMetadata":{}}
            if o=="list_tags_for_resource":return {"Tags":alarms[k["ResourceARN"].split(":alarm:")[1]]}
            if o=="disable_alarm_actions":return {}
            if o=="delete_alarms":
                for x in k["AlarmNames"]:alarms.pop(x)
                return {}
        if s=="scheduler":
            schedules=d.setdefault("schedules",{})
            if o=="get_schedule":
                if k["Name"] not in schedules:self.missing()
                return schedules[k["Name"]]
            if o=="create_schedule" or o=="update_schedule":schedules[k["Name"]]=k;return {"ResponseMetadata":{}}
            if o=="delete_schedule":
                if d.pop("deleteScheduleErrorOnce",False):raise ClientError({"Error":{"Code":"InternalServerException"}},"DeleteSchedule")
                schedules.pop(k["Name"]);return {}
        raise AssertionError("Unhandled local fixture operation "+s+"."+o)


@unittest.skipIf(botocore is None,"Run with pinned synthetic-check runtime for offline SDK model checks")
class CloudTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.m=manifest();self.m["executionBudgetVersion"]="s2-execution-budget-v3"
        directory=Path(self.tmp.name);artifacts={}
        for kind in ("bootstrap",*cloud.KINDS):
            path=directory/(kind+".zip");path.write_bytes(("local-model-fixture-"+kind).encode())
            artifacts[kind]={"path":str(path),"sha256":hashlib.sha256(path.read_bytes()).hexdigest()}
        artifacts["bootstrap"]["handler"]="ConsoleS2.DbBootstrap::ConsoleS2.DbBootstrap.Function::Handler"
        source=directory/"source-manifest.json"
        source.write_text(json.dumps({"files":{str(Path("scripts/ops/console_s2")/x):hashlib.sha256((Path(__file__).parent/x).read_bytes()).hexdigest() for x in ("cloud.py","guards.py")}}))
        plan=directory/"reviewed-plan.json";plan.write_text('{"scope":"offline fixture only"}')
        self.m.update(sourceManifestPath=str(source),sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),savedPlanPath=str(plan),savedPlanSha256=hashlib.sha256(plan.read_bytes()).hexdigest())
        self.m["cloud"]={"vpcId":"vpc-12345678","subnetIds":["subnet-12345678"],"rdsSecurityGroupId":"sg-rds","sqsEndpointSecurityGroupId":"sg-sqs","s3PrefixListId":"pl-s3","snsTopicArn":cloud._arn("sns","test"),"database":{"host":"isolated.private.invalid","productionDatabase":"production","legacyMode":"legacy","sslRootCert":"Certificates/ap-southeast-2-bundle.pem"},"bootstrapArtifact":artifacts.pop("bootstrap"),"artifacts":artifacts,"incidentControlReserve":50}
        for key in ("productionAcl","isolatedAcl","schema61","explain"):self.m["prerequisites"][key]["status"]="UNKNOWN"
        self.ledger=Ledger(directory/"ledger.json",self.m,now=lambda:datetime(2026,11,16,1,tzinfo=timezone.utc),phase="foundation")
        self.transport=Transport(self.ledger)
        self.patch=patch.object(cloud,"sdk_client",self.transport.factory);self.patch.start();self.addCleanup(self.patch.stop)

    def ready(self):
        result=cloud.foundation(None,self.ledger,self.m,lambda *_:True)
        self.assertEqual(result["numericVersion"],"1")
        self.assertFalse(self.transport.data.get("aliases"))
        self.assertFalse(self.transport.data.get("apis"))
        ready=deepcopy(self.m)
        for proof in ready["prerequisites"].values():proof["status"]="PASS"
        self.ledger.attest_foundation(ready);self.m=ready
        identity=cloud.prepare_identity(None,self.ledger,self.m)
        ready=deepcopy(self.m)
        public=json.dumps({"keys":[{"kid":"offline-model-only","kty":"RSA","use":"sig","alg":"RS256","n":"A"*344,"e":"AQAB"}]}).encode()
        public_path=Path(self.tmp.name)/"public-jwks.json";public_path.write_bytes(public)
        issuer=identity["issuer"]
        ready["cloud"]["publicJwks"]={"poolId":identity["poolId"],"issuer":issuer,"sourceUrl":issuer+"/.well-known/jwks.json","path":str(public_path),"sha256":hashlib.sha256(public).hexdigest()}
        core=Path(ready["cloud"]["artifacts"]["core"]["path"])
        with zipfile.ZipFile(core,"w") as package:package.writestr("Jwks/"+identity["poolId"]+".json",public)
        ready["cloud"]["artifacts"]["core"]["sha256"]=hashlib.sha256(core.read_bytes()).hexdigest()
        self.ledger.promote_runtime(ready);self.m=ready

    def test_entire_lifecycle_shape_validation_and_no_secrets_in_ledger(self):
        self.ready()
        result=cloud.runtime(None,self.ledger,self.m,lambda _: {"PGPASSWORD":"Z"*48})
        self.assertEqual(result["status"],"RUNTIME_PROVISIONED_NOT_ACCEPTED")
        saved=self.ledger.path.read_text();self.assertNotIn("Z"*48,saved);self.assertNotIn("PGPASSWORD",saved)
        with self.ledger.state() as state:
            self.assertLessEqual(state["counts"]["sdkControl"],240)
            self.assertEqual(state["intents"]["function-core"]["bootstrapVersion"],"1")
            provision_calls=state["counts"]["sdkControl"]
        result=cloud.cleanup(None,self.ledger,self.m,lambda *_:{"isolatedDatabaseAbsent":True,"isolatedRolesAbsent":True,"blockersReleased":True},evidence_exported=True)
        self.assertEqual(result["status"],"CLEANUP_COMPLETE",result)
        with self.ledger.state() as state:
            self.assertLessEqual(state["counts"]["cleanupSDK"],250)
            print(json.dumps({"scope":"offline modeled SDK sends only","provisionCalls":provision_calls,"cleanupCalls":state["counts"]["cleanupSDK"]}))

    def db_cleanup(self,binding,client):
        response=client.invoke(FunctionName=binding["functionName"],Qualifier=binding["numericVersion"],InvocationType="RequestResponse",Payload=b'{}')
        self.assertEqual(response["Payload"].read(3),b'{}')
        return {"isolatedDatabaseAbsent":True,"isolatedRolesAbsent":True,"blockersReleased":True}

    def expire_work(self):
        self.ledger.now=lambda:datetime(2026,11,16,5,tzinfo=timezone.utc)

    def test_db_failure_retains_recovery_path_until_retry_confirms_absence(self):
        self.ready();cloud.runtime(None,self.ledger,self.m,lambda _:{"PGPASSWORD":"Z"*48})
        def fail(binding,client):
            self.db_cleanup(binding,client)
            raise RuntimeError("offline callback timeout")
        first=cloud.cleanup(None,self.ledger,self.m,fail,evidence_exported=True)
        self.assertEqual(first["status"],"CLEANUP_INCOMPLETE")
        expected={"function-core","role-core","policy-core","log-core","security-group","rds-in","rds-out"}
        self.assertTrue(expected.issubset(set(first["retainedDependencies"])))
        with self.ledger.state() as state:
            before=deepcopy(state)
            for key in expected:self.assertNotEqual(state["intents"][key]["status"],"absent")
            for key in ("queue","bucket","api","function-worker"):self.assertEqual(state["intents"][key]["status"],"absent")
        self.expire_work()
        def retry(binding,client):
            self.assertIn(binding["functionName"],self.transport.data["functions"])
            for key in ("rds-in","rds-out"):
                self.assertIn(before["intents"][key]["id"],self.transport.data["rules"])
            return self.db_cleanup(binding,client)
        second=cloud.cleanup(None,self.ledger,self.m,retry,evidence_exported=True)
        self.assertEqual(second["status"],"CLEANUP_COMPLETE",second)
        with self.ledger.state() as state:
            self.assertEqual(state["firstCreateAt"],before["firstCreateAt"])
            self.assertEqual(state["manifestHistory"],before["manifestHistory"])
            self.assertGreater(state["counts"]["cleanupSDK"],before["counts"]["cleanupSDK"])
            self.assertLessEqual(state["counts"]["cleanupSDK"],250)
            self.assertEqual(state["counts"]["handlerInvocations"],2)

    def test_completed_cleanup_reentry_after_work_expiry_stays_complete(self):
        self.ready();cloud.runtime(None,self.ledger,self.m,lambda _:{"PGPASSWORD":"Z"*48})
        self.assertEqual(cloud.cleanup(None,self.ledger,self.m,self.db_cleanup,evidence_exported=True)["status"],"CLEANUP_COMPLETE")
        with self.ledger.state() as state:before=deepcopy(state)
        self.expire_work()
        second=cloud.cleanup(None,self.ledger,self.m,lambda *_:self.fail("DB callback must not repeat"),evidence_exported=True)
        self.assertEqual(second["status"],"CLEANUP_COMPLETE",second)
        with self.ledger.state() as state:
            self.assertEqual(state["counts"]["cleanupSDK"],before["counts"]["cleanupSDK"]+1)
            self.assertEqual(state["databaseCleanupConfirmed"],before["databaseCleanupConfirmed"])
            self.assertEqual(state["counts"]["sdkControl"],before["counts"]["sdkControl"])
            self.assertEqual(state["manifestHistory"],before["manifestHistory"])

    def test_retained_logs_cleanup_reentry_reuses_durable_db_result(self):
        self.ready();cloud.runtime(None,self.ledger,self.m,lambda _:{"PGPASSWORD":"Z"*48})
        first=cloud.cleanup(None,self.ledger,self.m,self.db_cleanup,evidence_exported=False)
        self.assertEqual(first["status"],"CLEANUP_INCOMPLETE")
        self.assertEqual(set(first["remaining"]),{"log-"+x for x in cloud.KINDS})
        self.expire_work()
        second=cloud.cleanup(None,self.ledger,self.m,lambda *_:self.fail("DB callback must not repeat"),evidence_exported=True)
        self.assertEqual(second["status"],"CLEANUP_COMPLETE",second)
        with self.ledger.state() as state:self.assertLessEqual(state["counts"]["cleanupSDK"],250)

    def test_partial_nonempty_object_delete_converges_without_counter_reset(self):
        self.ready();cloud.runtime(None,self.ledger,self.m,lambda _:{"PGPASSWORD":"Z"*48})
        bucket=cloud._name(self.m)
        self.transport.data["bucketVersions"]={bucket:[{"Key":"content/fixture.json","VersionId":"null","Size":32}]}
        self.transport.data["deleteObjectErrorOnce"]=True
        first=cloud.cleanup(None,self.ledger,self.m,self.db_cleanup,evidence_exported=True)
        self.assertEqual(first["status"],"CLEANUP_INCOMPLETE")
        self.assertEqual(first["remaining"],["bucket"])
        with self.ledger.state() as state:before=state["counts"]["cleanupSDK"]
        self.expire_work()
        second=cloud.cleanup(None,self.ledger,self.m,lambda *_:self.fail("DB callback must not repeat"),evidence_exported=True)
        self.assertEqual(second["status"],"CLEANUP_COMPLETE",second)
        with self.ledger.state() as state:
            self.assertGreater(state["counts"]["cleanupSDK"],before)
            self.assertLessEqual(state["counts"]["cleanupSDK"],250)

    def test_failed_schedule_delete_retains_role_until_actual_absence(self):
        self.ready();cloud.runtime(None,self.ledger,self.m,lambda _:{"PGPASSWORD":"Z"*48})
        name=cloud._name(self.m)
        self.transport.data["deleteScheduleErrorOnce"]=True
        first=cloud.cleanup(None,self.ledger,self.m,self.db_cleanup,evidence_exported=True)
        self.assertEqual(first["status"],"CLEANUP_INCOMPLETE")
        self.assertIn(name,self.transport.data["schedules"])
        self.assertIn(name+"-schedule",self.transport.data["roles"])
        self.assertIn((name+"-schedule","invoke-isolated-collector"),self.transport.data["policies"])
        with self.ledger.state() as state:
            before=deepcopy(state)
            self.assertEqual(state["intents"]["schedule"]["status"],"owned")
        self.assertTrue({"role-scheduler","policy-scheduler"}.issubset(set(first["retainedDependencies"])))
        self.expire_work()
        second=cloud.cleanup(None,self.ledger,self.m,lambda *_:self.fail("DB callback must not repeat"),evidence_exported=True)
        self.assertEqual(second["status"],"CLEANUP_COMPLETE",second)
        self.assertFalse(self.transport.data["schedules"])
        self.assertNotIn(name+"-schedule",self.transport.data["roles"])
        with self.ledger.state() as state:
            self.assertEqual(state["firstCreateAt"],before["firstCreateAt"])
            self.assertEqual(state["manifestHistory"],before["manifestHistory"])
            self.assertGreater(state["counts"]["cleanupSDK"],before["counts"]["cleanupSDK"])
            self.assertLessEqual(state["counts"]["cleanupSDK"],250)
        third=cloud.cleanup(None,self.ledger,self.m,lambda *_:self.fail("DB callback must not repeat"),evidence_exported=True)
        self.assertEqual(third["status"],"CLEANUP_COMPLETE")
        self.assertFalse(self.transport.data["schedules"])

    def test_failed_domain_delete_retains_pool_until_domain_absence(self):
        self.ready();cloud.runtime(None,self.ledger,self.m,lambda _:{"PGPASSWORD":"Z"*48})
        name=cloud._name(self.m)
        self.transport.data["deleteDomainErrorOnce"]=True
        first=cloud.cleanup(None,self.ledger,self.m,self.db_cleanup,evidence_exported=True)
        self.assertEqual(first["status"],"CLEANUP_INCOMPLETE")
        self.assertIn(name,self.transport.data["domains"])
        self.assertTrue(self.transport.data["pools"])
        self.assertIn("pool",first["retainedDependencies"])
        with self.ledger.state() as state:self.assertEqual(state["intents"]["domain"]["status"],"owned")
        self.expire_work()
        second=cloud.cleanup(None,self.ledger,self.m,lambda *_:self.fail("DB callback must not repeat"),evidence_exported=True)
        self.assertEqual(second["status"],"CLEANUP_COMPLETE",second)
        self.assertFalse(self.transport.data["domains"])
        self.assertFalse(self.transport.data["pools"])
        with self.ledger.state() as state:self.assertLessEqual(state["counts"]["cleanupSDK"],250)

    def test_absence_cascades_exclude_ownership_only_edges(self):
        self.assertNotIn(("role","schedule"),cloud.ABSENCE_CASCADES)
        self.assertNotIn(("pool","poolDomain"),cloud.ABSENCE_CASCADES)
        self.assertNotIn(("role","function"),cloud.ABSENCE_CASCADES)
        for pair in [("api","route"),("api","authorizer"),("api","integration"),("api","stage"),("function","alias"),("pool","poolClient"),("pool","poolGroup"),("pool","user"),("role","policy")]:
            self.assertIn(pair,cloud.ABSENCE_CASCADES)

    def test_response_loss_reconciles_native_tags_without_recreating(self):
        original=self.transport.reply
        lost=[False]
        def reply(service,operation,kwargs):
            value=original(service,operation,kwargs)
            if operation=="create_security_group" and not lost[0]:
                lost[0]=True
                raise OSError("local simulated response loss")
            return value
        self.transport.reply=reply
        cloud.foundation(None,self.ledger,self.m,lambda *_:True)
        self.assertEqual(sum(op=="create_security_group" for _,op in self.transport.calls),1)
        with self.ledger.state() as state:self.assertEqual(state["intents"]["security-group"]["status"],"owned")

    def test_cleanup_refuses_changed_queue_ownership(self):
        self.ready()
        cloud.runtime(None,self.ledger,self.m,lambda _:{"PGPASSWORD":"Z"*48})
        queue=next(x for x in self.transport.data["queues"] if not x.endswith("-dlq"))
        self.transport.data["queues"][queue]={"RunId":"another-run"}
        result=cloud.cleanup(None,self.ledger,self.m,lambda *_:{"isolatedDatabaseAbsent":True,"isolatedRolesAbsent":True,"blockersReleased":True},evidence_exported=True)
        self.assertEqual(result["status"],"CLEANUP_INCOMPLETE")
        self.assertIn(queue,self.transport.data["queues"])
        self.assertIn("queue",result["failures"])

    def test_budget_forecast_blocks_before_create(self):
        for _ in range(11):self.ledger.consume("sdkControl")
        with self.assertRaisesRegex(Blocked,"SDK_BUDGET_INSUFFICIENT_BEFORE_CREATE"):
            cloud.foundation(None,self.ledger,self.m,lambda *_:True)
        self.assertEqual(self.transport.calls,[])

    def test_runtime_rejects_foundation_even_with_callable_credentials(self):
        with self.assertRaisesRegex(Blocked,"RUNTIME_PHASE_REQUIRED"):
            cloud.runtime(None,self.ledger,self.m,lambda _: {"PGPASSWORD":"Z"*48})
        self.assertEqual(self.transport.calls,[])

    def test_alarm_and_policy_bounds(self):
        alarms=cloud.alarm_definitions(self.m)
        self.assertEqual(len(alarms),8)
        self.assertEqual(sum(x["ActionsEnabled"] for x in alarms),2)
        observer=cloud._role_policy(self.m,"sg-owned","observer")
        allows=[a for s in observer["Statement"] if s["Effect"]=="Allow" for a in s["Action"]]
        self.assertFalse(any(x.startswith(("s3:","sqs:","lambda:","secretsmanager:","sns:")) for x in allows))
        bootstrap=cloud._role_policy(self.m,"sg-owned","core",bootstrap=True)
        self.assertFalse(any(a.startswith(("s3:","sqs:")) for s in bootstrap["Statement"] if s["Effect"]=="Allow" for a in s["Action"]))


if __name__=="__main__":unittest.main()
