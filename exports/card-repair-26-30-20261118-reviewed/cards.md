# 修订稿（未发布）

## 顺序 260 · Time-limited direct S3 access / S3限时直传

**问：** 外部客户端需要临时下载一个私有S3对象，或直接上传到指定对象键。应用怎样授权，才能既不公开桶，也不转发文件？

答：由有权限的应用生成S3预签名URL，限定对象键、HTTP操作和到期时间；客户端使用该URL直接与S3传输。
考点：请求使用签发身份的凭证，因此可以只委托特定对象和操作的访问权限，而不必公开桶。URL在到期前可以重复使用，并非一次性链接。
易错提醒：使用IAM用户凭证和SigV4签名时，有效期最长可达7天。使用临时凭证签发的URL会随凭证到期而失效，即使URL原设期限更长。

**Question:** An external client needs temporary access to download one private S3 object or upload directly to a specific object key. How can the application allow this without making the bucket public or relaying the file?

Answer: Have an authorized application generate an S3 presigned URL for the specific object key, HTTP operation, and expiration time. The client uses that URL to transfer directly with S3.
Key point: The request uses the signing principal's credentials, so access can be delegated for a specific object and operation without making the bucket public. The URL can be used more than once before it expires; it is not a one-time link.
Watch out: With IAM-user credentials and SigV4, validity can be up to seven days. A URL signed with temporary credentials expires when those credentials expire, even if its requested lifetime is longer.

## 顺序 270 · CloudFront content signatures / CloudFront内容签名

**问：** 私有内容通过CloudFront分发。客户端不能使用Cookie时，应选哪种授权机制？URL必须保持不变、但客户端支持Cookie时，又应选哪种？

答：客户端不能使用Cookie时，使用CloudFront签名URL；URL必须保持不变且客户端支持Cookie时，使用CloudFront签名Cookie。
考点：两种机制都用于控制CloudFront私有内容访问。选择取决于客户端能把授权信息放在哪里：放在URL中，或通过Cookie单独携带。
易错提醒：对于当前未签名的URL，如果已有查询参数名为Expires、Policy、Signature、Key-Pair-Id或Hash-Algorithm，两种机制都不能直接使用，须先解决参数冲突。

**Question:** Private content is delivered through CloudFront. Which authorization mechanism should you choose for a client that cannot use cookies, and which should you choose when the URL must stay unchanged but cookies are supported?

Answer: Use CloudFront signed URLs when the client cannot use cookies. Use CloudFront signed cookies when the URL must remain unchanged and the client supports cookies.
Key point: Both mechanisms control access to private CloudFront content. The choice depends on where the client can carry authorization: in the URL or separately in cookies.
Watch out: For currently unsigned URLs, existing query parameters named Expires, Policy, Signature, Key-Pair-Id, or Hash-Algorithm prevent use of either mechanism; resolve that conflict first.

## 顺序 280 · CloudTrail event categories / CloudTrail事件类别

**问：** 需要查明谁修改了安全组，以及谁读写了S3对象。应分别查看CloudTrail的哪类事件？只看AWS Config配置快照够吗？

答：安全组修改查看CloudTrail管理事件；S3对象读写查看S3数据事件。仅靠AWS Config配置快照不足以确定这些操作由谁执行。
考点：管理事件覆盖资源管理操作，数据事件覆盖对象本身的操作。CloudTrail记录调用者、动作和时间；Config则描述资源配置及其变化。

**Question:** You need to identify who changed a security group and who read or wrote an S3 object. Which CloudTrail event categories should you examine, and would AWS Config snapshots alone answer these questions?

Answer: Examine CloudTrail management events for security-group changes and S3 data events for object reads and writes. AWS Config snapshots alone are insufficient for attributing these actions.
Key point: Management events cover resource-management operations; data events cover operations on the objects themselves. CloudTrail records the actor, action, and time, whereas Config describes resource configurations and their changes.

## 顺序 290 · Choosing private S3 endpoints / S3私网端点选择

**问：** VPC内的应用需要访问同Region的S3或DynamoDB，既不经过互联网网关或NAT设备，也不增加端点费用。应选哪种端点，哪些路由表必须使用它？

答：使用对应服务的网关端点，并关联调用应用所在子网实际使用的路由表，让发往该服务的流量路由到端点。
考点：网关端点通过路由提供到S3或DynamoDB的连接，不需要互联网网关或NAT设备，也没有额外端点费。访问仍使用服务的公有端点；使用公有服务地址不代表这条路径需要互联网连接。
易错提醒：调用实例的安全组及其子网的网络ACL仍须允许与该服务之间的流量。

**Question:** Applications in a VPC need to access same-Region S3 or DynamoDB without an internet gateway or NAT device and without an additional endpoint charge. Which endpoint should you use, and which route tables must use it?

Answer: Use a gateway endpoint for the relevant service. Associate it with the route tables used by the calling applications' subnets so service-destined traffic is routed to the endpoint.
Key point: A gateway endpoint provides a route to S3 or DynamoDB without requiring an internet gateway or NAT device, with no additional endpoint charge. Access still uses the service's public endpoint; public service addressing does not mean this path requires internet connectivity.
Watch out: The calling instances' security groups and their subnets' network ACLs must still allow traffic to and from the service.

## 顺序 300 · Updating existing S3 objects in bulk / 批量修改历史对象

**问：** 数百万已有S3对象需要改用SSE-KMS加密，或调整Object Lock保留期限。修改桶的默认加密会更新已有对象吗？这两类修改应怎样批量执行？

答：不会。使用S3 Batch Operations，并用清单列出目标对象。改用SSE-KMS时，运行Copy作业，将对象以SSE-KMS加密写回同一桶；调整保留期限时，使用Batch Operations的Object Lock保留期限操作。
考点：修改默认加密不会改变已有对象的加密方式。Batch Operations对清单中的对象执行选定动作：复制会按指定加密方式重写对象，保留期限操作则修改Object Lock的保留期限。
易错提醒：执行保留期限操作时，若要修改特定版本，须在清单中指定版本ID；否则操作针对最新版本。

**Question:** Millions of existing S3 objects need SSE-KMS encryption or Object Lock retention-period changes. Will changing the bucket's default encryption update existing objects, and how should you apply each change in bulk?

Answer: No. Use S3 Batch Operations with a manifest listing the target objects. For SSE-KMS, run a Copy job that writes the objects back to the same bucket with SSE-KMS encryption. For retention changes, use the Batch Operations Object Lock retention operation.
Key point: Changing default encryption does not alter existing objects' encryption. Batch Operations applies a selected action to the listed objects: copying rewrites the objects with the chosen encryption, while the retention operation changes Object Lock retention periods.
Watch out: For the retention operation, include a version ID in the manifest when a specific version must be changed; otherwise the operation targets the latest version.
