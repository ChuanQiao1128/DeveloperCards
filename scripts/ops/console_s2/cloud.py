"""Finite root-only S2 SDK lifecycle. Import and local tests make no cloud calls.

No Terraform apply, arbitrary SQL, credential files or generic command executor.
Callers pass an authenticated session and in-memory credential/DB callbacks.
"""
from __future__ import annotations

import base64
from datetime import timedelta
import hashlib
import json
from io import BytesIO
import zipfile
from pathlib import Path
import time

from guards import (ACCOUNT, REGION, Blocked, LIMITS, PREREQUISITES, require,
                    sdk_client, stamp, validate_manifest, digest)

KINDS = ("core", "worker", "observer", "collector")
# Ownership parentage is not deletion parentage. Only these native containment
# pairs permit absence proof from an actually absent parent. A Scheduler role
# and a Cognito pool domain are deliberately excluded.
ABSENCE_CASCADES = frozenset({
    ("api","route"),("api","authorizer"),("api","integration"),("api","stage"),
    ("function","alias"),("pool","poolClient"),("pool","poolGroup"),
    ("pool","user"),("role","policy"),
})
ROUTES = {
    "ANY /api/v1/admin/{proxy+}": "console", "ANY /api/v1/authoring/{proxy+}": "console",
    "GET /api/v1/authoring/publish/jobs": "console", "ANY /api/v1/sync/{proxy+}": "app",
    "ANY /api/v1/draw-state/{proxy+}": "app", "ANY /api/v1/user/{proxy+}": "app",
    "GET /api/v1/me": "app", "GET /health": "none", "OPTIONS /{proxy+}": "none",
    "OPTIONS /api/v1/admin/{proxy+}": "none", "OPTIONS /api/v1/authoring/{proxy+}": "none",
}
SUFFIXES = ("core-vpc-errors", "worker-errors", "synthetic-check-failing", "sqs-oldest-age",
            "dlq-nonempty", "sync-http-errors", "publish-stalled", "operations-observer-unavailable")
SPECS = {
    "core": ("dotnet10", "RecallSmith.Lambda::RecallSmith.Lambda.VpcFunction::Handler", 512, 90, 2),
    "worker": ("dotnet10", "RecallSmith.Lambda.Worker::RecallSmith.Lambda.Worker.WorkerFunction::FunctionHandler", 512, 615, 2),
    "observer": ("dotnet10", "RecallSmith.Lambda.OperationsObserver::RecallSmith.Lambda.OperationsObserver.Function::Handler", 256, 8, 1),
    "collector": ("python3.12", "synthetic_check.handler.lambda_handler", 256, 60, 1),
}
ABSENT = {"NoSuchEntity", "ResourceNotFoundException", "ResourceNotFound", "NotFoundException",
          "NoSuchBucket", "AWS.SimpleQueueService.NonExistentQueue", "QueueDoesNotExist",
          "InvalidGroup.NotFound", "InvalidSecurityGroupRuleId.NotFound", "NoSuchTagSet", "404"}


def _fixed(_response, identity):
    return identity


def _name(m):
    return "dc-console-s2-" + m["runId"]


def _tags(m):
    return {"ManagedBy": "console-acceptance-s2", "RunId": m["runId"], "ExpiresAt": m["expiresAt"]}


def _tag_list(m):
    return [{"Key": k, "Value": v} for k, v in _tags(m).items()]


def _arn(service, resource):
    return f"arn:aws:{service}:{REGION}:{ACCOUNT}:{resource}"


def _optional(call):
    try:
        return call()
    except Exception as error:
        code = getattr(error, "response", {}).get("Error", {}).get("Code")
        if code in ABSENT:
            return None
        raise Blocked("PROVIDER_READ_FAILED") from None


def _client(c, service):
    if service not in c["clients"]:
        c["clients"][service] = sdk_client(c["session"], service, c["ledger"], cleanup=c["cleanup"],deadline_monotonic=c.get("deadline"))
    return c["clients"][service]


def _record(c, key):
    with c["ledger"].state() as state:
        value = state["intents"].get(key)
        return None if value is None else dict(value)


def _identity(c, key):
    record = _record(c, key)
    require(record is not None and record.get("status") == "owned", "OWNED_RESOURCE_REQUIRED")
    return record["id"]


def _mark(c, key, **safe):
    with c["ledger"].state() as state:
        state["intents"][key].update(safe)


def _pages(client, operation, result_key, *, token_key="NextToken", request_token_key=None, max_pages=2, **kwargs):
    """Every page is a separate instrumented send. Never an unbounded paginator."""
    result = []
    for _ in range(max_pages):
        page = getattr(client, operation)(**kwargs)
        result.extend(page.get(result_key, []))
        token = page.get(token_key)
        if not token:
            return result
        kwargs[request_token_key or token_key] = token
    raise Blocked("PAGINATION_BOUND_EXCEEDED")


def _parent(c, key):
    if key not in c["verified"]:
        record = _record(c, key)
        require(record and record.get("status") == "owned", "PARENT_NOT_OWNED")
        live = _lookup(c, key, record)
        require(live and live["id"] == record["id"] and live["tags"] == _tags(c["manifest"]), "PARENT_OWNERSHIP_CHANGED")
        c["verified"].add(key)
    return _record(c, key)


def _lookup(c, key, r):
    """Return only ID/name/tags, never provider environment or token/user payload."""
    m, name, kind = c["manifest"], r["expectedIdentity"], r["kind"]
    parent = r.get("parent")
    parent_record = _parent(c, parent) if parent else None
    ident = r.get("id")
    live = None
    if kind == "securityGroup":
        rows = _client(c,"ec2").describe_security_groups(Filters=[{"Name":"group-name","Values":[name]}, {"Name":"vpc-id","Values":[m["cloud"]["vpcId"]]}])["SecurityGroups"]
        require(len(rows) <= 1, "AMBIGUOUS_SECURITY_GROUP")
        if rows: live = {"id": rows[0]["GroupId"], "name": rows[0]["GroupName"], "tags": {t["Key"]:t["Value"] for t in rows[0].get("Tags",[])}}
    elif kind in ("ingressRule","egressRule"):
        args = {"SecurityGroupRuleIds":[ident]} if ident else {"Filters":[{"Name":"tag:RunId","Values":[m["runId"]]},{"Name":"tag:S2Key","Values":[key]}]}
        raw = _optional(lambda: _client(c,"ec2").describe_security_group_rules(**args))
        rows = [] if raw is None else raw["SecurityGroupRules"]
        require(len(rows) <= 1, "AMBIGUOUS_SG_RULE")
        if rows:
            tags={t["Key"]:t["Value"] for t in rows[0].get("Tags",[])}
            require(tags.pop("S2Key",None)==key,"RULE_KEY_MISMATCH")
            live={"id":rows[0]["SecurityGroupRuleId"],"name":name,"tags":tags}
    elif kind == "role":
        raw = _optional(lambda: _client(c,"iam").get_role(RoleName=name))
        if raw: live={"id":raw["Role"]["RoleName"],"name":raw["Role"]["RoleName"],"tags":{t["Key"]:t["Value"] for t in raw["Role"].get("Tags",[])}}
    elif kind == "logGroup":
        rows=_pages(_client(c,"logs"),"describe_log_groups","logGroups",token_key="nextToken",logGroupNamePrefix=name,limit=50)
        rows=[x for x in rows if x["logGroupName"]==name]
        if rows:
            tags=_client(c,"logs").list_tags_log_group(logGroupName=name).get("tags",{})
            live={"id":name,"name":name,"tags":tags}
    elif kind == "function":
        raw=_optional(lambda: _client(c,"lambda").get_function_configuration(FunctionName=name))
        if raw:
            arn=raw["FunctionArn"].split(":function:")[0]+":function:"+name
            tags=_client(c,"lambda").list_tags(Resource=arn).get("Tags",{})
            live={"id":name,"name":raw["FunctionName"],"tags":tags}
    elif kind == "bucket":
        raw=_optional(lambda: _client(c,"s3").head_bucket(Bucket=name,ExpectedBucketOwner=ACCOUNT))
        if raw is not None:
            tagged=_optional(lambda: _client(c,"s3").get_bucket_tagging(Bucket=name,ExpectedBucketOwner=ACCOUNT))
            live={"id":name,"name":name,"tags":{} if tagged is None else {t["Key"]:t["Value"] for t in tagged["TagSet"]}}
    elif kind == "queue":
        url=f"https://sqs.{REGION}.amazonaws.com/{ACCOUNT}/{name}"
        raw=_optional(lambda: _client(c,"sqs").get_queue_attributes(QueueUrl=url,AttributeNames=["QueueArn"]))
        if raw:
            require(raw["Attributes"]["QueueArn"]==_arn("sqs",name),"QUEUE_ARN_MISMATCH")
            live={"id":url,"name":name,"tags":_client(c,"sqs").list_queue_tags(QueueUrl=url).get("Tags",{})}
    elif kind == "pool":
        if ident:
            raw=_optional(lambda:_client(c,"cognito-idp").describe_user_pool(UserPoolId=ident))
            rows=[] if raw is None else [raw["UserPool"]]
        else:
            rows=_pages(_client(c,"cognito-idp"),"list_user_pools","UserPools",MaxResults=60)
            rows=[x for x in rows if x["Name"]==name]
        require(len(rows)<=1,"AMBIGUOUS_POOL")
        if rows:
            pool=rows[0]["Id"]
            tags=_client(c,"cognito-idp").list_tags_for_resource(ResourceArn=_arn("cognito-idp","userpool/"+pool)).get("Tags",{})
            live={"id":pool,"name":rows[0]["Name"],"tags":tags}
    elif kind == "api":
        if ident:
            raw=_optional(lambda:_client(c,"apigatewayv2").get_api(ApiId=ident))
            rows=[] if raw is None else [raw]
        else:
            rows=_pages(_client(c,"apigatewayv2"),"get_apis","Items",MaxResults="100")
            rows=[x for x in rows if x["Name"]==name]
        require(len(rows)<=1,"AMBIGUOUS_API")
        if rows: live={"id":rows[0]["ApiId"],"name":rows[0]["Name"],"tags":rows[0].get("Tags",{})}
    elif kind == "alarm":
        rows=_client(c,"cloudwatch").describe_alarms(AlarmNames=[name],AlarmTypes=["MetricAlarm"]).get("MetricAlarms",[])
        if rows:
            tags=_client(c,"cloudwatch").list_tags_for_resource(ResourceARN=_arn("cloudwatch","alarm:"+name)).get("Tags",[])
            live={"id":name,"name":name,"tags":{t["Key"]:t["Value"] for t in tags}}
    elif kind == "schedule":
        raw=_optional(lambda:_client(c,"scheduler").get_schedule(Name=name,GroupName="default"))
        if raw:
            require(parent_record and raw["Target"]["RoleArn"]==f"arn:aws:iam::{ACCOUNT}:role/{parent_record['id']}" and raw["Target"]["Arn"]==_arn("lambda","function:"+_name(m)+"-collector:test"),"SCHEDULE_TARGET_MISMATCH")
            live={"id":name,"name":raw["Name"],"tags":_tags(m)}
    elif kind == "mapping":
        if ident:
            raw=_optional(lambda:_client(c,"lambda").get_event_source_mapping(UUID=ident))
            rows=[] if raw is None else [raw]
        else:
            rows=_pages(_client(c,"lambda"),"list_event_source_mappings","EventSourceMappings",token_key="NextMarker",request_token_key="Marker",EventSourceArn=_arn("sqs",_name(m)),FunctionName=_arn("lambda","function:"+_name(m)+"-worker:test"),MaxItems=100)
        require(len(rows)<=1,"AMBIGUOUS_MAPPING")
        if rows:
            require(rows[0]["EventSourceArn"]==_arn("sqs",_name(m)),"MAPPING_QUEUE_MISMATCH")
            tags=_client(c,"lambda").list_tags(Resource=rows[0]["EventSourceMappingArn"]).get("Tags",{})
            live={"id":rows[0]["UUID"],"name":name,"tags":tags}
    elif parent_record:
        live=_lookup_child(c,key,r,parent_record)
    else:
        raise Blocked("UNKNOWN_RESOURCE_KIND")
    return live


def _lookup_child(c,key,r,parent):
    kind,name=r["kind"],r["expectedIdentity"]
    pid=parent["id"]
    rows=[]
    if kind=="policy":
        raw=_optional(lambda:_client(c,"iam").get_role_policy(RoleName=pid,PolicyName=r["localName"]))
        if raw: rows=[{"id":r["localName"],"name":name}]
    elif kind=="alias":
        raw=_optional(lambda:_client(c,"lambda").get_alias(FunctionName=pid,Name="test"))
        if raw: rows=[{"id":raw["AliasArn"],"name":name}]
    elif kind=="poolClient":
        raw=_pages(_client(c,"cognito-idp"),"list_user_pool_clients","UserPoolClients",UserPoolId=pid,MaxResults=60)
        rows=[{"id":x["ClientId"],"name":name} for x in raw if x["ClientName"]==name]
    elif kind=="poolGroup":
        raw=_optional(lambda:_client(c,"cognito-idp").get_group(UserPoolId=pid,GroupName=r["localName"]))
        if raw: rows=[{"id":pid+":"+r["localName"],"name":name}]
    elif kind=="poolDomain":
        raw=_client(c,"cognito-idp").describe_user_pool_domain(Domain=name).get("DomainDescription",{})
        if raw.get("UserPoolId"):
            require(raw["UserPoolId"]==pid,"DOMAIN_POOL_MISMATCH")
            rows=[{"id":name,"name":name}]
    elif kind in ("authorizer","integration","route","stage"):
        plural={"authorizer":("get_authorizers","AuthorizerId","Name"),"integration":("get_integrations","IntegrationId",None),"route":("get_routes","RouteId","RouteKey"),"stage":("get_stages","StageName","StageName")}
        operation,idkey,namekey=plural[kind]
        raw=_pages(_client(c,"apigatewayv2"),operation,"Items",ApiId=pid,MaxResults="100")
        for x in raw:
            matches=(x.get(namekey)==r["localName"]) if namekey else x.get("IntegrationUri")==r["localName"]
            if matches: rows.append({"id":x[idkey],"name":name})
    require(len(rows)<=1,"AMBIGUOUS_CHILD_RESOURCE")
    return None if not rows else {**rows[0],"tags":_tags(c["manifest"])}


def _ensure(c,key,kind,name,create,*,parent=None,local_name=None,after=None):
    existing=_record(c,key)
    spec={"kind":kind,"expectedIdentity":name}
    if parent: spec["parent"]=parent
    if local_name is not None: spec["localName"]=local_name
    parent_record = _parent(c,parent) if parent else None
    # Untaggable children are scoped to an already ownership-verified exact new
    # parent ID. First creation response is authoritative; resume/cleanup re-read.
    live=None if parent and existing is None else _lookup(c,key,existing or spec)
    if live:
        require(existing is not None,"PREEXISTING_RESOURCE_COLLISION")
        if existing.get("id"): require(live["id"]==existing["id"],"RESOURCE_ID_CHANGED")
        c["ledger"].reconcile(key,live["id"],live["tags"],actual_name=live["name"])
        return live["id"]
    require(existing is None,"UNRESOLVED_CREATION_INTENT")
    c["ledger"].creation_intent(key,name)
    _mark(c,key,**{k:v for k,v in spec.items() if k!="expectedIdentity"})
    try:
        identity=create()
        c["ledger"].returned(key,identity)
        if after: after(identity)
    except Exception:
        # No retry/create replay. One bounded ownership read resolves response loss.
        live=_lookup(c,key,_record(c,key))
        if not live: raise Blocked("CREATE_UNCERTAIN_RECONCILE_BEFORE_RESUME") from None
        c["ledger"].reconcile(key,live["id"],live["tags"],actual_name=live["name"])
        return live["id"]
    live={"id":identity,"name":name,"tags":_tags(c["manifest"])} if parent else _lookup(c,key,_record(c,key))
    require(live is not None,"CREATE_READBACK_MISSING")
    c["ledger"].reconcile(key,live["id"],live["tags"],actual_name=live["name"])
    return live["id"]


def estimate(manifest):
    """Conservative healthy-path provisioning estimate; actual sends remain capped.

    No promise that propagation/reconciliation fits. Work stops at400; cleanup250
    remains separately available. Root can reserve more for actual incident polls.
    """
    reserve=manifest.get("cloud",{}).get("incidentControlReserve",50)
    require(type(reserve) is int and reserve>=50,"INCIDENT_CONTROL_RESERVE_TOO_SMALL")
    return {"healthyProvisionEstimate":240,"incidentReserve":reserve,
            "productionReserve":0 if manifest.get("cloud",{}).get("productionControlComplete") is True else 100,
            "requiredAvailableWorkCalls":240+reserve+(0 if manifest.get("cloud",{}).get("productionControlComplete") is True else 100),"cleanupReserve":250}


def context(session,ledger,manifest,*,cleanup=False,deadline_monotonic=None):
    require(manifest.get("executionBudgetVersion")=="s2-execution-budget-v3","AMENDED_EXECUTION_BUDGET_REVIEW_REQUIRED")
    validate_manifest(manifest,phase=ledger.phase)
    require(manifest==ledger.manifest,"DRIVER_LEDGER_MANIFEST_MISMATCH")
    source=Path(manifest.get("sourceManifestPath",""));plan=Path(manifest.get("savedPlanPath",""))
    require(source.is_absolute() and source.stat().st_size<=1048576 and digest(source)==manifest["sourceSha256"],"REVIEWED_SOURCE_MANIFEST_CHANGED")
    require(plan.is_absolute() and digest(plan)==manifest["savedPlanSha256"],"REVIEWED_SAVED_PLAN_CHANGED")
    sources=json.loads(source.read_text()).get("files",{})
    repo=Path(__file__).resolve().parents[3]
    require("scripts/ops/console_s2/cloud.py" in sources and "scripts/ops/console_s2/guards.py" in sources,"DRIVER_SOURCE_NOT_FROZEN")
    for path,expected in sources.items():
        relative=Path(path)
        require(not relative.is_absolute() and ".." not in relative.parts and digest(repo/relative)==expected,"REVIEWED_SOURCE_BYTES_CHANGED")
    cloud=manifest.get("cloud",{})
    for key in ("vpcId","rdsSecurityGroupId","sqsEndpointSecurityGroupId","s3PrefixListId"):
        require(isinstance(cloud.get(key),str) and cloud[key] and "*" not in cloud[key],"NETWORK_BINDING_MISSING")
    require(cloud.get("subnetIds") and all(x.startswith("subnet-") for x in cloud["subnetIds"]),"SUBNETS_MISSING")
    require(cloud.get("snsTopicArn","").startswith(_arn("sns","")),"SNS_BINDING_MISMATCH")
    c={"session":session,"ledger":ledger,"manifest":manifest,"cleanup":cleanup,"clients":{},"verified":set(),"deadline":deadline_monotonic}
    account=_client(c,"sts").get_caller_identity()
    require(account.get("Account")==ACCOUNT,"LIVE_ACCOUNT_MISMATCH")
    return c


def _artifact(spec):
    path=Path(spec["path"])
    require(path.is_absolute() and path.is_file() and path.stat().st_size<=50*1024*1024,"ARTIFACT_FILE_INVALID")
    data=path.read_bytes()
    require(hashlib.sha256(data).hexdigest()==spec["sha256"],"ARTIFACT_HASH_MISMATCH")
    return data


def _role_policy(m,sg,kind,*,bootstrap=False):
    name=_name(m)
    statements=[{"Sid":"OwnLogStreams","Effect":"Allow","Action":["logs:CreateLogStream","logs:PutLogEvents"],"Resource":[_arn("logs",f"log-group:/aws/lambda/{name}-{kind}:*")]}]
    if kind!="collector":
        statements += [
            {"Sid":"VpcDescribe","Effect":"Allow","Action":["ec2:DescribeNetworkInterfaces","ec2:DescribeSubnets"],"Resource":["*"],"Condition":{"StringEquals":{"aws:RequestedRegion":REGION}}},
            # EC2 authorizes the new ENI, subnet and SG separately; condition keys differ per resource.
            {"Sid":"CreateInExactNetwork","Effect":"Allow","Action":["ec2:CreateNetworkInterface"],"Resource":[_arn("ec2","network-interface/*"),_arn("ec2","security-group/"+sg),*[_arn("ec2","subnet/"+x) for x in m["cloud"]["subnetIds"]]]},
            {"Sid":"ManageVpcInterfaces","Effect":"Allow","Action":["ec2:DeleteNetworkInterface","ec2:AssignPrivateIpAddresses","ec2:UnassignPrivateIpAddresses"],"Resource":[_arn("ec2","network-interface/*")],"Condition":{"ArnEquals":{"ec2:Vpc":_arn("ec2","vpc/"+m["cloud"]["vpcId"])}}},
            {"Sid":"NoEniCallsFromHandler","Effect":"Deny","Action":["ec2:CreateNetworkInterface","ec2:DeleteNetworkInterface","ec2:DescribeNetworkInterfaces","ec2:DescribeSubnets","ec2:AssignPrivateIpAddresses","ec2:UnassignPrivateIpAddresses"],"Resource":["*"],"Condition":{"ArnEquals":{"lambda:SourceFunctionArn":_arn("lambda","function:"+name+"-"+kind)}}},
        ]
    if not bootstrap and kind in ("core","worker"):
        statements += [
            {"Sid":"OwnBucketList","Effect":"Allow","Action":["s3:ListBucket"],"Resource":[f"arn:aws:s3:::{name}"]},
            {"Sid":"OwnContent","Effect":"Allow","Action":["s3:GetObject","s3:PutObject"],"Resource":[f"arn:aws:s3:::{name}/content/*",f"arn:aws:s3:::{name}/premium/*"]},
            {"Sid":"OwnQueue","Effect":"Allow","Action":["sqs:SendMessage","sqs:GetQueueAttributes"] if kind=="core" else ["sqs:ReceiveMessage","sqs:DeleteMessage","sqs:GetQueueAttributes","sqs:ChangeMessageVisibility"],"Resource":[_arn("sqs",name)]},
        ]
    snapshot=f"arn:aws:s3:::{name}/ops/console-monitor/v1/current.json"
    if not bootstrap and kind=="core":
        statements.append({"Sid":"ReadSnapshot","Effect":"Allow","Action":["s3:GetObject"],"Resource":[snapshot]})
    if kind=="collector":
        statements += [
            {"Sid":"ReadSnapshot","Effect":"Allow","Action":["s3:GetObject"],"Resource":[snapshot]},
            {"Sid":"WriteEncryptedSnapshot","Effect":"Allow","Action":["s3:PutObject"],"Resource":[snapshot],"Condition":{"StringEquals":{"s3:x-amz-server-side-encryption":"AES256"}}},
            {"Sid":"InvokeOnlyObserver","Effect":"Allow","Action":["lambda:InvokeFunction"],"Resource":[_arn("lambda","function:"+name+"-observer:test")]},
            {"Sid":"ReadOnlyOwnAlarms","Effect":"Allow","Action":["cloudwatch:DescribeAlarms"],"Resource":[_arn("cloudwatch","alarm:"+name+"-"+x) for x in SUFFIXES]},
        ]
    statements.append({"Sid":"DenyProductionResources","Effect":"Deny","Action":["s3:*","sqs:*","execute-api:*","secretsmanager:*","ssm:*","lambda:InvokeFunction"],"Resource":m["productionDenyArns"]})
    return {"Version":"2012-10-17","Statement":statements}


def _role(c,kind,sg,*,bootstrap=False):
    m=c["manifest"]; name=_name(m)+"-"+kind
    trust={"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
    role=_ensure(c,"role-"+kind,"role",name,lambda:_client(c,"iam").create_role(RoleName=name,AssumeRolePolicyDocument=json.dumps(trust),Tags=_tag_list(m))["Role"]["RoleName"])
    document=_role_policy(m,sg,kind,bootstrap=bootstrap)
    key="policy-"+kind
    policy_written=False
    def put_policy():
        nonlocal policy_written
        policy_written=True
        return _fixed(_client(c,"iam").put_role_policy(RoleName=role,PolicyName="isolated-only",PolicyDocument=json.dumps(document)),"isolated-only")
    if _record(c,key):
        _parent(c,"role-"+kind)
        # An owned bootstrap role is upgraded only after runtime gate; no broad
        # policy is ever attached to the bootstrap function before that gate.
        if not bootstrap:
            put_policy()
    else:
        _ensure(c,key,"policy",role+":isolated-only",put_policy,parent="role-"+kind,local_name="isolated-only")
    if policy_written:
        # IAM role/trust and inline policy propagation precede the single Lambda create attempt.
        time.sleep(15)
    return role


def _logs(c,kind):
    m=c["manifest"];name="/aws/lambda/"+_name(m)+"-"+kind
    return _ensure(c,"log-"+kind,"logGroup",name,
        lambda:_fixed(_client(c,"logs").create_log_group(logGroupName=name,tags=_tags(m)),name),
        after=lambda _: _client(c,"logs").put_retention_policy(logGroupName=name,retentionInDays=3))


def _wait_function(c,name):
    for attempt in range(4):
        raw=_client(c,"lambda").get_function_configuration(FunctionName=name)
        if raw.get("State")=="Active" and raw.get("LastUpdateStatus","Successful")=="Successful": return
        require(raw.get("State")!="Failed" and raw.get("LastUpdateStatus")!="Failed","FUNCTION_DEPLOYMENT_FAILED")
        if attempt<3: time.sleep(2)
    raise Blocked("FUNCTION_NOT_READY_WITHIN_FOUR_POLLS")


def _function(c,kind,artifact,environment,*,bootstrap=False):
    m=c["manifest"];name=_name(m)+"-"+kind;sg=_identity(c,"security-group")
    runtime,handler,memory,timeout,concurrency=SPECS[kind]
    if bootstrap:
        handler=artifact["handler"]
        concurrency=1
    payload=_artifact(artifact)
    kwargs=dict(FunctionName=name,Runtime=runtime,Role=f"arn:aws:iam::{ACCOUNT}:role/{name}",Handler=handler,
                Code={"ZipFile":payload},Publish=True,Timeout=timeout,MemorySize=memory,Architectures=["arm64"],
                Environment={"Variables":environment},Tags=_tags(m),LoggingConfig={"LogFormat":"Text","LogGroup":"/aws/lambda/"+name})
    if kind!="collector":kwargs["VpcConfig"]={"SubnetIds":m["cloud"]["subnetIds"],"SecurityGroupIds":[sg]}
    def create():
        result=_client(c,"lambda").create_function(**kwargs)
        # Numeric version is public metadata; no response/config body is persisted.
        c["ledger"].returned("function-"+kind,result["FunctionName"])
        require(result["CodeSha256"]==base64.b64encode(hashlib.sha256(payload).digest()).decode(),"DEPLOYED_CODE_HASH_MISMATCH")
        _mark(c,"function-"+kind,version=result["Version"],codeSha256=result["CodeSha256"])
        return result["FunctionName"]
    existing=_record(c,"function-"+kind)
    _ensure(c,"function-"+kind,"function",name,create)
    _wait_function(c,name)
    if existing and not bootstrap:
        result=_client(c,"lambda").update_function_code(FunctionName=name,ZipFile=payload,Publish=False)
        _wait_function(c,name)
        # Never persist environment or raw result. This call contains credentials
        # only in owner memory; boto3 debug logging must remain disabled.
        _client(c,"lambda").update_function_configuration(FunctionName=name,Handler=handler,Runtime=runtime,Timeout=timeout,MemorySize=memory,Environment={"Variables":environment})
        _wait_function(c,name)
        result=_publish_version(c,kind,payload,handler)
        _mark(c,"function-"+kind,version=result["Version"],codeSha256=result["CodeSha256"])
    else:
        # Response-loss reconciliation may have recovered function identity but
        # not its numeric create version; publish at most once with exact hash.
        record=_record(c,"function-"+kind)
        if not record.get("version"):
            result=_publish_version(c,kind,payload,handler)
            _mark(c,"function-"+kind,version=result["Version"],codeSha256=result["CodeSha256"])
    _client(c,"lambda").put_function_concurrency(FunctionName=name,ReservedConcurrentExecutions=concurrency)
    return _record(c,"function-"+kind)


def foundation(session,ledger,manifest,watchdog):
    """Create only bootstrap support and numeric owner helper. No business alias/API."""
    require(ledger.phase=="foundation","FOUNDATION_PHASE_REQUIRED")
    estimate_=estimate(manifest)
    with ledger.state() as state:
        used=state["counts"].get("sdkControl",0)
    require(LIMITS["sdkControl"]-used>=estimate_["requiredAvailableWorkCalls"],"SDK_BUDGET_INSUFFICIENT_BEFORE_CREATE")
    require(callable(watchdog),"INDEPENDENT_WATCHDOG_REQUIRED")
    # Root registers an independent process/thread that can call cleanup even
    # if this stack fails; callback must return before any create API.
    require(watchdog(ledger.path,manifest) is True,"WATCHDOG_REGISTRATION_FAILED")
    if not ledger.path.exists() or not _record({"ledger":ledger},"security-group"):
        with ledger.state() as state: already=state["cleanupRegistered"]
        if not already: ledger.register_cleanup()
    c=context(session,ledger,manifest);m=manifest;cloud=m["cloud"];name=_name(m)
    sg=_ensure(c,"security-group","securityGroup",name,lambda:_client(c,"ec2").create_security_group(GroupName=name,Description="Isolated Console S2 only",VpcId=cloud["vpcId"],TagSpecifications=[{"ResourceType":"security-group","Tags":_tag_list(m)}])["GroupId"])
    # Remove new group's AWS default outbound rule before any function is made.
    if not _record(c,"security-group").get("defaultEgressRemoved"):
        current=_client(c,"ec2").describe_security_groups(GroupIds=[sg])["SecurityGroups"][0]
        defaults=[x for x in current.get("IpPermissionsEgress",[]) if x.get("IpProtocol")=="-1" and any(y.get("CidrIp")=="0.0.0.0/0" for y in x.get("IpRanges",[]))]
        if defaults:_client(c,"ec2").revoke_security_group_egress(GroupId=sg,IpPermissions=defaults)
        _mark(c,"security-group",defaultEgressRemoved=True)
    rules=[("rds-in","ingressRule",cloud["rdsSecurityGroupId"],5432,sg),
           ("sqs-in","ingressRule",cloud["sqsEndpointSecurityGroupId"],443,sg),
           ("rds-out","egressRule",sg,5432,cloud["rdsSecurityGroupId"]),
           ("sqs-out","egressRule",sg,443,cloud["sqsEndpointSecurityGroupId"]),
           ("s3-out","egressRule",sg,443,cloud["s3PrefixListId"])]
    for key,kind,group,port,target in rules:
        permission={"IpProtocol":"tcp","FromPort":port,"ToPort":port}
        permission["PrefixListIds" if target.startswith("pl-") else "UserIdGroupPairs"]=[{"PrefixListId":target} if target.startswith("pl-") else {"GroupId":target}]
        def create_rule(key=key,kind=kind,group=group,permission=permission):
            operation="authorize_security_group_ingress" if kind=="ingressRule" else "authorize_security_group_egress"
            return getattr(_client(c,"ec2"),operation)(GroupId=group,IpPermissions=[permission],TagSpecifications=[{"ResourceType":"security-group-rule","Tags":_tag_list(m)+[{"Key":"S2Key","Value":key}]}])["SecurityGroupRules"][0]["SecurityGroupRuleId"]
        _ensure(c,key,kind,name+":"+key,create_rule)
        _mark(c,key,groupId=group)
    _logs(c,"core");_role(c,"core",sg,bootstrap=True)
    db=cloud["database"]
    env={"S2_RUN_ID":m["runId"],"S2_MANIFEST_SHA256":ledger.manifest_hash,"S2_PRODUCTION_DATABASE":db["productionDatabase"],"S2_EXPIRES_AT":m["expiresAt"],"PGHOST":db["host"],"PGPORT":"5432","PGSSLMODE":"verify-full","PGSSLROOTCERT":db["sslRootCert"],"API_ENV":"production"}
    result=_function(c,"core",cloud["bootstrapArtifact"],env,bootstrap=True)
    _mark(c,"function-core",bootstrapManifestSha256=ledger.manifest_hash,bootstrapVersion=result["version"])
    return {"functionName":name+"-core","numericVersion":result["version"],"manifestSha256":ledger.manifest_hash,"status":"BOOTSTRAP_ONLY_NO_BUSINESS_ALIAS"}


def prepare_identity(session,ledger,manifest):
    """Passive real Cognito resources for public JWKS packaging; no business API."""
    for key in ("productionAcl","isolatedAcl","schema61","explain"):
        proof=manifest["prerequisites"][key]
        require(proof.get("status")=="PASS","IDENTITY_REQUIRES_MEASURED_DB_PROOFS")
    c=context(session,ledger,manifest);m=manifest;name=_name(m)
    pool=_ensure(c,"pool","pool",name,lambda:_client(c,"cognito-idp").create_user_pool(PoolName=name,UserPoolTags=_tags(m),AdminCreateUserConfig={"AllowAdminCreateUserOnly":True},Policies={"PasswordPolicy":{"MinimumLength":16}})["UserPool"]["Id"])
    clients={}
    for kind in ("console","app"):
        params={"UserPoolId":pool,"ClientName":name+"-"+kind,"GenerateSecret":False,"AccessTokenValidity":5,"IdTokenValidity":5,"RefreshTokenValidity":60,"TokenValidityUnits":{"AccessToken":"minutes","IdToken":"minutes","RefreshToken":"minutes"},"ExplicitAuthFlows":["ALLOW_REFRESH_TOKEN_AUTH"] if kind=="console" else ["ALLOW_USER_SRP_AUTH","ALLOW_REFRESH_TOKEN_AUTH"],"PreventUserExistenceErrors":"ENABLED"}
        if kind=="console":params.update(AllowedOAuthFlowsUserPoolClient=True,AllowedOAuthFlows=["code"],AllowedOAuthScopes=["openid","email","profile"],SupportedIdentityProviders=["COGNITO"],CallbackURLs=[m["callback"]],LogoutURLs=[m["logout"]])
        clients[kind]=_ensure(c,"client-"+kind,"poolClient",name+"-"+kind,lambda params=params:_client(c,"cognito-idp").create_user_pool_client(**params)["UserPoolClient"]["ClientId"],parent="pool")
    for group in ("super_admin","editor"):
        _ensure(c,"group-"+group,"poolGroup",pool+":"+group,lambda group=group:_fixed(_client(c,"cognito-idp").create_group(UserPoolId=pool,GroupName=group),pool+":"+group),parent="pool",local_name=group)
    _ensure(c,"domain","poolDomain",name,lambda:_fixed(_client(c,"cognito-idp").create_user_pool_domain(UserPoolId=pool,Domain=name),name),parent="pool")
    return {"poolId":pool,"issuer":f"https://cognito-idp.{REGION}.amazonaws.com/{pool}","clientIds":clients,"domain":f"https://{name}.auth.{REGION}.amazoncognito.com"}


def alarm_definitions(m):
    name=_name(m);namespace=m["metricNamespace"];sns=m["cloud"]["snsTopicArn"]
    def basic(suffix,ns,metric,stat,period,threshold,comparison,periods,missing,dimensions):
        return {"AlarmName":name+"-"+suffix,"Namespace":ns,"MetricName":metric,"Statistic":stat,"Period":period,"Threshold":threshold,"ComparisonOperator":comparison,"EvaluationPeriods":periods,"DatapointsToAlarm":periods,"TreatMissingData":missing,"Dimensions":[{"Name":k,"Value":v} for k,v in dimensions.items()]}
    alarms=[
        basic("core-vpc-errors","AWS/Lambda","Errors","Sum",300,1,"GreaterThanOrEqualToThreshold",1,"notBreaching",{"FunctionName":name+"-core"}),
        basic("worker-errors","AWS/Lambda","Errors","Sum",300,1,"GreaterThanOrEqualToThreshold",1,"notBreaching",{"FunctionName":name+"-worker"}),
        basic("synthetic-check-failing",namespace,"SyntheticCheckSuccess","Maximum",900,1,"LessThanThreshold",2,"breaching",{"Service":"synthetic-check"}),
        basic("sqs-oldest-age","AWS/SQS","ApproximateAgeOfOldestMessage","Maximum",300,900,"GreaterThanThreshold",1,"notBreaching",{"QueueName":name}),
        basic("dlq-nonempty","AWS/SQS","ApproximateNumberOfMessagesVisible","Maximum",300,0,"GreaterThanThreshold",1,"notBreaching",{"QueueName":name+"-dlq"}),
        basic("publish-stalled",namespace,"PublishStalled","Maximum",900,1,"GreaterThanOrEqualToThreshold",1,"missing",{"Service":"operations-observer"}),
    ]
    sync={"AlarmName":name+"-sync-http-errors","ComparisonOperator":"GreaterThanOrEqualToThreshold","Threshold":1,"EvaluationPeriods":1,"DatapointsToAlarm":1,"TreatMissingData":"notBreaching","Metrics":[{"Id":"errors","Expression":"SUM([FILL(e0,0),FILL(e1,0),FILL(e2,0),FILL(e3,0),FILL(e4,0)])","ReturnData":True}]}
    for i,(route,method) in enumerate([(p,"POST") for p in ("/api/v1/sync/progress/events","/api/v1/sync/push")]+[(p,"GET") for p in ("/api/v1/sync/progress","/api/v1/sync/pull")]+[("/api/v1/draw-state/sync","POST")]):
        sync["Metrics"].append({"Id":"e"+str(i),"ReturnData":False,"MetricStat":{"Metric":{"Namespace":namespace,"MetricName":"Errors","Dimensions":[{"Name":"Service","Value":"core-vpc"},{"Name":"Route","Value":route},{"Name":"Method","Value":method}]},"Stat":"Sum","Period":300}})
    unavailable={"AlarmName":name+"-operations-observer-unavailable","ComparisonOperator":"LessThanThreshold","Threshold":1,"EvaluationPeriods":2,"DatapointsToAlarm":2,"TreatMissingData":"breaching","Metrics":[{"Id":"available","Expression":"MIN([FILL(observer,0),FILL(invoke,0)])","ReturnData":True}]}
    for key,metric,service in [("observer","ObserverSuccess","operations-observer"),("invoke","ObserverInvokeSuccess","synthetic-check")]:
        unavailable["Metrics"].append({"Id":key,"ReturnData":False,"MetricStat":{"Metric":{"Namespace":namespace,"MetricName":metric,"Dimensions":[{"Name":"Service","Value":service}]},"Stat":"Maximum","Period":900}})
    alarms += [sync,unavailable]
    for alarm in alarms:
        alarm.update(AlarmActions=[sns],OKActions=[sns],ActionsEnabled=alarm["AlarmName"].endswith(("-sync-http-errors","-sqs-oldest-age")),Tags=_tag_list(m))
    return alarms


def _public_environment(c,kind):
    m=c["manifest"];cloud=m["cloud"];db=cloud["database"];name=_name(m)
    database="dc_console_s2_"+m["runId"].replace("-","_")
    pool=_identity(c,"pool");issuer=f"https://cognito-idp.{REGION}.amazonaws.com/{pool}"
    env={"PGHOST":db["host"],"PGPORT":"5432","PGDATABASE":database,"PGSSLMODE":"verify-full","PGSSLROOTCERT":db["sslRootCert"],"PG_MAX":"1","API_ENV":"production","DB_ACCESS_MODE":db["legacyMode"],"AUTOMATION_MODE":"off","METRICS_NAMESPACE":m["metricNamespace"]}
    if kind=="observer":return {**env,"PGUSER":database+"_observer"}
    if kind in ("core","worker"):
        return {**env,"PGUSER":database+"_runtime","CONTENT_BUCKET":name,"PREMIUM_BUCKET":name,"PUBLISH_JOB_QUEUE_URL":_identity(c,"queue"),"AUTH_ISSUERS":issuer,"AUTH_CONSOLE_ISSUER":issuer,"AUTH_CONSOLE_CLIENT_IDS":_identity(c,"client-console"),"AUTH_AGENT_CLIENT_IDS":"isolated-no-agent-client","AUTH_ALLOW_UNVERIFIED":"0","CORS_ORIGIN":"http://localhost:5188"}
    api=_identity(c,"api")
    targets={**m["syntheticTargets"],"API_BASE":f"https://{api}.execute-api.{REGION}.amazonaws.com","COGNITO_CONSOLE_ISSUER":issuer,"COGNITO_MOBILE_ISSUER":issuer}
    return {**targets,"CHECK_TIMEOUT_SECONDS":"10","CHECK_USER_AGENT":"DeveloperCards-Console-S2/1.0","LOG_LEVEL":"info","METRICS_NAMESPACE":m["metricNamespace"],"OPS_SNAPSHOT_BUCKET":name,"OPS_SNAPSHOT_KEY":"ops/console-monitor/v1/current.json","OPS_ALARM_NAMES":json.dumps([name+"-"+x for x in SUFFIXES]),"OPS_OBSERVER_FUNCTION_ARN":_arn("lambda","function:"+name+"-observer:test")}


def _alias(c,kind):
    name=_name(c["manifest"])+"-"+kind;version=_record(c,"function-"+kind)["version"]
    require(version.isdecimal() and int(version)>0,"NUMERIC_VERSION_REQUIRED")
    arn=_ensure(c,"alias-"+kind,"alias",name+":test",lambda:_client(c,"lambda").create_alias(FunctionName=name,Name="test",FunctionVersion=version)["AliasArn"],parent="function-"+kind)
    # Re-entry may find the prior alias after a code/config publish; exact update,
    # no trusted authorizer claims or arbitrary alias targets.
    _client(c,"lambda").update_alias(FunctionName=name,Name="test",FunctionVersion=version)
    raw=_client(c,"lambda").get_alias(FunctionName=name,Name="test")
    require(raw["FunctionVersion"]==version and raw["AliasArn"]==arn,"ALIAS_TARGET_MISMATCH")
    return arn


def _runtime(session,ledger,manifest,credential_callback):
    """Provision exact runtime after measured gates. Secrets only callback memory."""
    ledger.require_runtime();require(callable(credential_callback),"OWNER_CREDENTIAL_CALLBACK_REQUIRED")
    c=context(session,ledger,manifest);m=manifest;name=_name(m);sg=_identity(c,"security-group")
    require(_record(c,"pool") is not None,"PREPARE_REAL_IDENTITY_AND_JWKS_FIRST")
    for kind in KINDS:_artifact(m["cloud"]["artifacts"][kind])
    # JWKS is public, but it must be rooted in this actual pool before deploying.
    jwks=m["cloud"].get("publicJwks",{})
    pool=_identity(c,"pool");issuer=f"https://cognito-idp.{REGION}.amazonaws.com/{pool}"
    require(jwks.get("poolId")==pool and jwks.get("issuer")==issuer and jwks.get("sourceUrl")==issuer+"/.well-known/jwks.json","REAL_PUBLIC_JWKS_BINDING_REQUIRED")
    jwks_data=_artifact(jwks)
    public=json.loads(jwks_data)
    require(isinstance(public.get("keys"),list) and 1<=len(public["keys"])<=5,"INVALID_PUBLIC_JWKS")
    for key in public["keys"]:
        require(key.get("kty")=="RSA" and key.get("alg")=="RS256" and key.get("use")=="sig" and all(isinstance(key.get(x),str) and key[x] for x in ("kid","n","e")) and not set(key).intersection(("d","p","q","dp","dq","qi","oth")),"INVALID_PUBLIC_JWKS")
    with zipfile.ZipFile(BytesIO(_artifact(m["cloud"]["artifacts"]["core"]))) as package:
        require(package.read("Jwks/"+pool+".json")==jwks_data,"BUNDLED_PUBLIC_JWKS_MISMATCH")
    _ensure(c,"bucket","bucket",name,lambda:_fixed(_client(c,"s3").create_bucket(Bucket=name,CreateBucketConfiguration={"LocationConstraint":REGION},ObjectOwnership="BucketOwnerEnforced"),name),after=lambda bucket:_client(c,"s3").put_bucket_tagging(Bucket=bucket,ExpectedBucketOwner=ACCOUNT,Tagging={"TagSet":_tag_list(m)}))
    _client(c,"s3").put_public_access_block(Bucket=name,ExpectedBucketOwner=ACCOUNT,PublicAccessBlockConfiguration={"BlockPublicAcls":True,"IgnorePublicAcls":True,"BlockPublicPolicy":True,"RestrictPublicBuckets":True})
    _client(c,"s3").put_bucket_encryption(Bucket=name,ExpectedBucketOwner=ACCOUNT,ServerSideEncryptionConfiguration={"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]})
    dlq=_ensure(c,"dlq","queue",name+"-dlq",lambda:_client(c,"sqs").create_queue(QueueName=name+"-dlq",Attributes={"MessageRetentionPeriod":"86400","SqsManagedSseEnabled":"true"},tags=_tags(m))["QueueUrl"])
    _ensure(c,"queue","queue",name,lambda:_client(c,"sqs").create_queue(QueueName=name,Attributes={"VisibilityTimeout":"3700","MessageRetentionPeriod":"86400","SqsManagedSseEnabled":"true","RedrivePolicy":json.dumps({"deadLetterTargetArn":_arn("sqs",name+"-dlq"),"maxReceiveCount":3})},tags=_tags(m))["QueueUrl"])
    # API identity is needed by the collector's explicit probe config. No routes
    # or integration exist until final core numeric version + real alias below.
    api=_ensure(c,"api","api",name,lambda:_client(c,"apigatewayv2").create_api(Name=name,ProtocolType="HTTP",Tags=_tags(m),CorsConfiguration={"AllowOrigins":["http://localhost:5188"],"AllowCredentials":False,"AllowMethods":["GET","POST","PUT","DELETE","OPTIONS"],"AllowHeaders":["accept","authorization","content-type"],"MaxAge":600})["ApiId"])
    for kind in KINDS:
        _logs(c,kind);_role(c,kind,sg)
        env=_public_environment(c,kind)
        secret={}
        if kind!="collector":
            secret=credential_callback(kind)
            require(isinstance(secret,dict) and set(secret)=={"PGPASSWORD"} and isinstance(secret["PGPASSWORD"],str) and 40<=len(secret["PGPASSWORD"])<=64 and secret["PGPASSWORD"].isascii() and secret["PGPASSWORD"].isalnum(),"DEDICATED_MEMORY_CREDENTIAL_REQUIRED")
        try:
            _function(c,kind,m["cloud"]["artifacts"][kind],{**env,**secret})
            _alias(c,kind)
        finally:
            secret.clear()
    authorizers={}
    pool=_identity(c,"pool");issuer=f"https://cognito-idp.{REGION}.amazonaws.com/{pool}"
    for kind in ("console","app"):
        authorizers[kind]=_ensure(c,"authorizer-"+kind,"authorizer",api+":"+kind,lambda kind=kind:_client(c,"apigatewayv2").create_authorizer(ApiId=api,Name=kind,AuthorizerType="JWT",IdentitySource=["$request.header.Authorization"],JwtConfiguration={"Issuer":issuer,"Audience":[_identity(c,"client-"+kind)]})["AuthorizerId"],parent="api",local_name=kind)
    core_alias=_arn("lambda","function:"+name+"-core:test")
    integration=_ensure(c,"integration","integration",api+":core",lambda:_client(c,"apigatewayv2").create_integration(ApiId=api,IntegrationType="AWS_PROXY",IntegrationMethod="POST",IntegrationUri=core_alias,PayloadFormatVersion="2.0",TimeoutInMillis=30000)["IntegrationId"],parent="api",local_name=core_alias)
    for i,(route,auth) in enumerate(ROUTES.items()):
        args={"ApiId":api,"RouteKey":route,"Target":"integrations/"+integration,"AuthorizationType":"NONE" if auth=="none" else "JWT"}
        if auth!="none":args["AuthorizerId"]=authorizers[auth]
        _ensure(c,"route-"+str(i),"route",api+":"+route,lambda args=args:_client(c,"apigatewayv2").create_route(**args)["RouteId"],parent="api",local_name=route)
    _ensure(c,"stage","stage",api+":$default",lambda:_client(c,"apigatewayv2").create_stage(ApiId=api,StageName="$default",AutoDeploy=True,DefaultRouteSettings={"ThrottlingBurstLimit":10,"ThrottlingRateLimit":5,"DetailedMetricsEnabled":True})["StageName"],parent="api",local_name="$default")
    # The permission is a child of our exact function; no shared gateway edit.
    _mutation(c,"api-permission",lambda:_client(c,"lambda").add_permission(FunctionName=name+"-core",Qualifier="test",StatementId="isolated-api-only",Action="lambda:InvokeFunction",Principal="apigateway.amazonaws.com",SourceAccount=ACCOUNT,SourceArn=f"arn:aws:execute-api:{REGION}:{ACCOUNT}:{api}/*/*"))
    _ensure(c,"mapping","mapping",name+":worker-mapping",lambda:_client(c,"lambda").create_event_source_mapping(EventSourceArn=_arn("sqs",name),FunctionName=_arn("lambda","function:"+name+"-worker:test"),Enabled=False,BatchSize=1,FunctionResponseTypes=["ReportBatchItemFailures"],ScalingConfig={"MaximumConcurrency":2},Tags=_tags(m))["UUID"])
    for alarm in alarm_definitions(m):
        _ensure(c,"alarm-"+alarm["AlarmName"][len(name)+1:],"alarm",alarm["AlarmName"],lambda alarm=alarm:_fixed(_client(c,"cloudwatch").put_metric_alarm(**alarm),alarm["AlarmName"]))
    _schedule(c)
    _mutation(c,"collector-no-async-retries",lambda:_client(c,"lambda").put_function_event_invoke_config(FunctionName=name+"-collector",Qualifier="test",MaximumRetryAttempts=0,MaximumEventAgeInSeconds=900))
    return {"status":"RUNTIME_PROVISIONED_NOT_ACCEPTED","apiBase":f"https://{api}.execute-api.{REGION}.amazonaws.com","mappingDisabled":True,"scheduleDisabled":True}


def _mutation(c,key,call):
    with c["ledger"].state() as state:
        mutations=state.setdefault("mutations",{})
        if mutations.get(key)=="done":return
        require(key not in mutations,"RECONCILE_MUTATION_RESPONSE_LOSS")
        mutations[key]="pending"
    call()
    with c["ledger"].state() as state:state["mutations"][key]="done"


def _schedule(c):
    m=c["manifest"];name=_name(m);role=name+"-schedule"
    trust={"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"scheduler.amazonaws.com"},"Action":"sts:AssumeRole","Condition":{"StringEquals":{"aws:SourceAccount":ACCOUNT},"ArnEquals":{"aws:SourceArn":_arn("scheduler","schedule-group/default")}}}]}
    _ensure(c,"role-scheduler","role",role,lambda:_client(c,"iam").create_role(RoleName=role,AssumeRolePolicyDocument=json.dumps(trust),Tags=_tag_list(m))["Role"]["RoleName"])
    document={"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["lambda:InvokeFunction"],"Resource":[_arn("lambda","function:"+name+"-collector:test")]}]}
    _ensure(c,"policy-scheduler","policy",role+":invoke-isolated-collector",lambda:_fixed(_client(c,"iam").put_role_policy(RoleName=role,PolicyName="invoke-isolated-collector",PolicyDocument=json.dumps(document)),"invoke-isolated-collector"),parent="role-scheduler",local_name="invoke-isolated-collector")
    _ensure(c,"schedule","schedule",name,lambda:_fixed(_client(c,"scheduler").create_schedule(Name=name,GroupName="default",State="DISABLED",ScheduleExpression="rate(15 minutes)",FlexibleTimeWindow={"Mode":"OFF"},Target={"Arn":_arn("lambda","function:"+name+"-collector:test"),"RoleArn":f"arn:aws:iam::{ACCOUNT}:role/{role}","Input":json.dumps({"job":"synthetic-check"}),"RetryPolicy":{"MaximumRetryAttempts":0}}),name),parent="role-scheduler")


def cleanup(session,ledger,manifest,db_cleanup_callback,*,evidence_exported=False,timeout_seconds=600):
    """Exact ownership teardown. Failures retain tombstones; never report partial PASS.

    DB callback must use supplied instrumented Lambda client (cleanup reserve) and
    exact bootstrap numeric version. It receives no arbitrary SQL or secret file.
    """
    require(300<=timeout_seconds<=900,"CLEANUP_TIMEOUT_OUT_OF_BOUNDS")
    started=time.monotonic();c=context(session,ledger,manifest,cleanup=True,deadline_monotonic=started+timeout_seconds)
    m=manifest;name=_name(m);failures=[];deleted=[];retained=[]
    def remaining():require(time.monotonic()-started<timeout_seconds,"CLEANUP_TIME_LIMIT")
    def active(key):
        record=_record(c,key)
        return record if record and record.get("status")!="absent" else None
    def owned_live(key):
        record=active(key)
        if record is None:return None
        live=_lookup(c,key,record)
        if live is None:
            _mark(c,key,status="absent")
            return None
        if record.get("status") in ("pending","returned"):
            ledger.reconcile(key,live["id"],live["tags"],actual_name=live["name"])
        ledger.cleanup_target(key,live["id"],live["tags"])
        return _record(c,key)
    def attempt(key,operation):
        r=_record(c,key)
        if r is None or r.get("status")=="absent":return
        try:
            remaining()
            live=_lookup(c,key,r)
            if live is None:
                _mark(c,key,status="absent");deleted.append(key);return
            if r.get("status") in ("pending","returned"):
                # Response-loss resolution requires exact provider ID/name and
                # actual tags (or exact owned parent for untaggable children).
                ledger.reconcile(key,live["id"],live["tags"],actual_name=live["name"])
                r=_record(c,key)
            ledger.cleanup_target(key,live["id"],live["tags"])
            operation(r)
            remaining()
            absent=_lookup(c,key,r)
            require(absent is None,"DELETE_ABSENCE_NOT_OBSERVED")
            _mark(c,key,status="absent");deleted.append(key)
            c["verified"].discard(key)
        except Exception:
            failures.append(key)
            _mark(c,key,cleanupFailure="DELETE_OR_OWNERSHIP_UNCONFIRMED")
    # No new injection, schedule or notification transitions after cleanup starts.
    with ledger.state() as state:state["cleanupStartedAt"]=ledger.now().isoformat().replace("+00:00","Z")
    if active("schedule"):
        try:
            if owned_live("schedule"):
                raw=_client(c,"scheduler").get_schedule(Name=name,GroupName="default")
                _client(c,"scheduler").update_schedule(Name=name,GroupName="default",State="DISABLED",ScheduleExpression="rate(15 minutes)",FlexibleTimeWindow={"Mode":"OFF"},Target=raw["Target"])
        except Exception:failures.append("disable-schedule")
    alarm_keys=["alarm-"+x for x in SUFFIXES if _record(c,"alarm-"+x) and _record(c,"alarm-"+x).get("status")!="absent"]
    alarm_names=[]
    try:
        names=[_record(c,key)["expectedIdentity"] for key in alarm_keys]
        values=[] if not names else _client(c,"cloudwatch").describe_alarms(AlarmNames=names,AlarmTypes=["MetricAlarm"]).get("MetricAlarms",[])
        live_names={x["AlarmName"] for x in values}
        for key in alarm_keys:
            r=_record(c,key);alarm=r["expectedIdentity"]
            if alarm not in live_names:
                _mark(c,key,status="absent");continue
            raw=_client(c,"cloudwatch").list_tags_for_resource(ResourceARN=_arn("cloudwatch","alarm:"+alarm)).get("Tags",[])
            tags={x["Key"]:x["Value"] for x in raw}
            if r.get("status") in ("pending","returned"):ledger.reconcile(key,alarm,tags,actual_name=alarm)
            ledger.cleanup_target(key,alarm,tags)
            alarm_names.append(alarm)
        if alarm_names:_client(c,"cloudwatch").disable_alarm_actions(AlarmNames=alarm_names)
    except Exception:failures.append("disable-alarm-actions")
    if active("mapping"):
        try:
            record=owned_live("mapping")
            if record:_client(c,"lambda").update_event_source_mapping(UUID=record["id"],Enabled=False)
        except Exception:failures.append("disable-mapping")
    if active("function-worker"):
        try:
            record=owned_live("function-worker")
            if record:_client(c,"lambda").put_function_concurrency(FunctionName=record["id"],ReservedConcurrentExecutions=0)
        except Exception:failures.append("stop-worker")
    core=_record(c,"function-core")
    db_binding={"runId":m["runId"],"functionName":name+"-core","numericVersion":None if core is None else core.get("bootstrapVersion"),"manifestSha256":None if core is None else core.get("bootstrapManifestSha256")}
    db_result={"isolatedDatabaseAbsent":True,"isolatedRolesAbsent":True,"blockersReleased":True}
    with ledger.state() as state:
        receipt=state.get("databaseCleanupConfirmed",{})
    db_confirmed=receipt.get("binding")==db_binding and receipt.get("result")==db_result
    if core and not db_confirmed:
        try:
            require(callable(db_cleanup_callback),"DB_CLEANUP_CALLBACK_REQUIRED")
            require(owned_live("function-core") is not None,"DB_HELPER_ABSENT_WITHOUT_DB_PROOF")
            callback_result=db_cleanup_callback(db_binding,_client(c,"lambda"))
            require(callback_result==db_result,"DB_CLEANUP_NOT_CONFIRMED")
            with ledger.state() as state:
                state["databaseCleanupConfirmed"]={"binding":db_binding,"result":db_result,"observedAt":ledger.now().isoformat().replace("+00:00","Z")}
            db_confirmed=True
        except Exception:failures.append("database-and-roles")
    preserve_db_path=bool(core) and not db_confirmed
    if preserve_db_path:
        retained=[key for key in ("function-core","role-core","policy-core","log-core","security-group","rds-in","rds-out") if active(key)]
    # Preserve the owner helper if DB cleanup remains unresolved.
    attempt("schedule",lambda r:_client(c,"scheduler").delete_schedule(Name=r["id"],GroupName="default"))
    attempt("mapping",lambda r:_client(c,"lambda").delete_event_source_mapping(UUID=r["id"]))
    attempt("api",lambda r:_client(c,"apigatewayv2").delete_api(ApiId=r["id"]))
    if alarm_names and "disable-alarm-actions" not in failures:
        try:
            _client(c,"cloudwatch").delete_alarms(AlarmNames=alarm_names)
            rows=_client(c,"cloudwatch").describe_alarms(AlarmNames=alarm_names,AlarmTypes=["MetricAlarm"]).get("MetricAlarms",[])
            require(not rows,"ALARM_DELETE_ABSENCE_NOT_OBSERVED")
            for key in alarm_keys:_mark(c,key,status="absent")
        except Exception:failures.append("delete-exact-alarms")
    attempt("domain",lambda r:_client(c,"cognito-idp").delete_user_pool_domain(UserPoolId=_identity(c,"pool"),Domain=r["id"]))
    if active("domain"):
        if active("pool"):retained.append("pool")
    else:
        attempt("pool",lambda r:_client(c,"cognito-idp").delete_user_pool(UserPoolId=r["id"]))
    for kind in ("collector","observer","worker","core"):
        if kind=="core" and preserve_db_path:continue
        attempt("function-"+kind,lambda r:_client(c,"lambda").delete_function(FunctionName=r["id"]))
    for key in ("queue","dlq"):attempt(key,lambda r:_client(c,"sqs").delete_queue(QueueUrl=r["id"]))
    def bucket_delete(r):
        versions=_client(c,"s3").list_object_versions(Bucket=r["id"],ExpectedBucketOwner=ACCOUNT,MaxKeys=1000)
        require(not versions.get("IsTruncated"),"BUCKET_OBJECT_PAGE_LIMIT")
        values=versions.get("Versions",[])+versions.get("DeleteMarkers",[])
        require(sum(x.get("Size",0) for x in values)<=1048576,"BUCKET_BYTE_LIMIT")
        if values:
            result=_client(c,"s3").delete_objects(Bucket=r["id"],ExpectedBucketOwner=ACCOUNT,Delete={"Objects":[{"Key":x["Key"],"VersionId":x["VersionId"]} for x in values],"Quiet":True})
            require(not result.get("Errors"),"BUCKET_OBJECT_DELETE_PARTIAL")
        empty=_client(c,"s3").list_objects_v2(Bucket=r["id"],ExpectedBucketOwner=ACCOUNT,MaxKeys=1)
        require(empty.get("KeyCount",0)==0,"BUCKET_NOT_EMPTY")
        _client(c,"s3").delete_bucket(Bucket=r["id"],ExpectedBucketOwner=ACCOUNT)
    attempt("bucket",bucket_delete)
    for key in ("rds-in","sqs-in","rds-out","sqs-out","s3-out"):
        if preserve_db_path and key in ("rds-in","rds-out"):continue
        def remove_rule(r,key=key):
            group=r.get("groupId")
            if not group:group=m["cloud"]["rdsSecurityGroupId"] if key=="rds-in" else m["cloud"]["sqsEndpointSecurityGroupId"] if key=="sqs-in" else _identity(c,"security-group")
            method="revoke_security_group_ingress" if r["kind"]=="ingressRule" else "revoke_security_group_egress"
            getattr(_client(c,"ec2"),method)(GroupId=group,SecurityGroupRuleIds=[r["id"]])
        attempt(key,remove_rule)
    if not preserve_db_path:attempt("security-group",lambda r:_client(c,"ec2").delete_security_group(GroupId=r["id"]))
    # Infer absence only for native containment, never an ownership-proof edge.
    with ledger.state() as state:
        for r in state["intents"].values():
            parent_key=r.get("parent")
            parent=state["intents"].get(parent_key,{})
            if parent.get("status")=="absent" and (parent.get("kind"),r.get("kind")) in ABSENCE_CASCADES:
                r["status"]="absent"
                r["absenceProof"]={"kind":"providerParentAbsent","parentKey":parent_key,"parentKind":parent["kind"]}
    for kind in (*KINDS,"scheduler"):
        if kind=="scheduler" and active("schedule"):
            retained.extend(key for key in ("policy-scheduler","role-scheduler") if active(key))
            failures.append("retain-scheduler-role");continue
        if kind=="core" and preserve_db_path:continue
        if kind in ("core","worker","observer") and _record(c,"security-group") and _record(c,"security-group").get("status")!="absent":
            failures.append("retain-eni-role-"+kind);continue
        attempt("policy-"+kind,lambda r:_client(c,"iam").delete_role_policy(RoleName=_identity(c,r["parent"]),PolicyName=r["id"]))
        if active("policy-"+kind):
            if active("role-"+kind):retained.append("role-"+kind)
            continue
        attempt("role-"+kind,lambda r:_client(c,"iam").delete_role(RoleName=r["id"]))
    if evidence_exported:
        for kind in KINDS:
            if kind=="core" and preserve_db_path:continue
            attempt("log-"+kind,lambda r:_client(c,"logs").delete_log_group(logGroupName=r["id"]))
    else:
        for kind in KINDS:
            if active("log-"+kind):failures.append("evidence-not-exported-log-"+kind)
    with ledger.state() as state:
        remaining_keys=[k for k,r in state["intents"].items() if r.get("status")!="absent"]
        state["cleanupComplete"]=not failures and not remaining_keys
        state["cleanupTombstones"]={"failures":sorted(set(failures)),"remaining":remaining_keys,"retainedDependencies":retained}
    return {"status":"CLEANUP_COMPLETE" if not failures and not remaining_keys else "CLEANUP_INCOMPLETE","deleted":deleted,"failures":sorted(set(failures)),"remaining":remaining_keys,"retainedDependencies":retained,"productionBaseline":"ROOT_READBACK_REQUIRED"}


def runtime(session,ledger,manifest,credential_callback):
    try:
        return _runtime(session,ledger,manifest,credential_callback)
    except Blocked:
        raise
    except Exception:
        raise Blocked("RUNTIME_PROVIDER_FAILURE_NO_SECRET_DETAILS") from None


def _publish_version(c,kind,payload,handler):
    name=_name(c["manifest"])+"-"+kind
    code_hash=base64.b64encode(hashlib.sha256(payload).digest()).decode()
    with c["ledger"].state() as state:
        versions=state.setdefault("versionIntents",{})
        key=kind+":"+code_hash
        intent=versions.get(key)
        if intent is None:
            intent={"status":"pending","at":c["ledger"].now().isoformat().replace("+00:00","Z")}
            versions[key]=intent
    if intent.get("status")=="done":
        return {"Version":intent["version"],"CodeSha256":code_hash}
    # One list recovers a successful PublishVersion whose response was lost.
    if intent.get("attempted"):
        values=_pages(_client(c,"lambda"),"list_versions_by_function","Versions",token_key="NextMarker",request_token_key="Marker",FunctionName=name,MaxItems=50)
        candidates=[x for x in values if x.get("Version","").isdecimal() and x.get("CodeSha256")==code_hash and x.get("Handler")==handler and stamp(x["LastModified"].replace("+0000","Z"))>=stamp(intent["at"])]
        require(len(candidates)==1,"PUBLISH_VERSION_RESPONSE_LOSS_UNRESOLVED")
        result=candidates[0]
    else:
        with c["ledger"].state() as state:state["versionIntents"][key]["attempted"]=True
        result=_client(c,"lambda").publish_version(FunctionName=name,CodeSha256=code_hash)
    with c["ledger"].state() as state:state["versionIntents"][key].update(status="done",version=result["Version"])
    return {"Version":result["Version"],"CodeSha256":result["CodeSha256"]}
