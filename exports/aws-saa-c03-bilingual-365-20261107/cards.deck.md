# deck: aws-saa-c03-pack-20261107

## aws-rb2-20261107-pack-ca03 | d1
TOPIC: Session management and private access / 会话管理与私网访问
Q:
An administrator needs to reach a private-subnet EC2 instance without distributing shared SSH keys or maintaining a bastion host. The SSM Agent is installed and can reach the service. What else is needed to connect to and manage the instance?
Q_ZH:
管理员要进入私网EC2，不想分发共享SSH密钥或维护跳板机。SSM Agent已安装且能连接服务，还应怎样让实例接入并管理？
A:
Answer: Attach an instance role with the permissions SSM requires, then use Session Manager, with IAM controlling administrator session access.
Key point: The SSM Agent connects to the management service and carries the session using the instance role; this path does not rely on opening SSH inbound or distributing SSH keys.
A_ZH:
答：给实例关联具备SSM所需权限的实例角色，再用Session Manager并以IAM控制管理员会话访问。
考点：SSM Agent凭实例角色连接管理服务并承载会话；这条路径不靠开放SSH入站或分发SSH密钥。
SOURCE: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-getting-started-instance-profile.html

## aws-rb2-20261107-pack-ca08 | d2
TOPIC: Cross-account authorization paths / 跨账户授权路径
Q:
An application in an external account must access resources in your account. When the design must assume a restricted identity in your account versus preserving the caller's original identity, how do the authorization paths differ?
Q_ZH:
外部账户的应用要访问本账户资源。需要代入本账户受限身份，与必须保留它原有身份时，授权路径有何不同？
A:
Answer: To assume a target identity, create a restricted role in your account that trusts the caller; once the caller is allowed AssumeRole, it obtains temporary credentials. If the service supports resource policies (for example an SQS queue) and the caller's identity must be preserved, grant the external identity access directly in the resource policy; the caller's side must also allow the action.
Key point: AssumeRole calls as the target role, while a resource policy grants access to the existing caller identity. Cross-account access cannot be judged by looking at only one side's Allow, and no long-term user keys need to be distributed.
A_ZH:
答：代入目标身份时，在本账户建受限角色并信任调用方，调用方获准AssumeRole后取得临时凭证。若服务支持资源策略（例如SQS队列）、且要保留调用方身份，可直接在资源策略授权该外部身份，调用方也须获准该操作。
考点：AssumeRole会以目标角色身份调用；资源策略把访问权授给现有调用身份。跨账户不能只看一边的Allow，也不用为此分发目标账户长期用户密钥。
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html

## aws-rb2-20261107-pack-ca09 | d1
TOPIC: IAM groups and managed policies / IAM组与托管策略
Q:
Several IAM users must share one set of staff permissions, and new hires should inherit it automatically. How should this be organized? If this group is approved to access all AWS services and resources, which managed policy should be chosen, and why?
Q_ZH:
几名IAM用户要共享同一套人员权限，新人也能继承。怎样组织？若这组已获批准要访问全部AWS服务和资源，应选哪份托管策略，为什么？
A:
Answer: Attach the identity policy to an IAM group and add the users to it; use AdministratorAccess only when access to all services and resources is genuinely required.
Key point: A group gives its members shared authorization; AdministratorAccess grants full access through Action:* and Resource:*. It is an identity policy and cannot be attached as a resource policy to user groups.
A_ZH:
答：把相应身份策略附给IAM组，再加入用户；确需全部服务和资源权限时使用AdministratorAccess。
考点：组使成员继承共同授权；AdministratorAccess以Action:*和Resource:*授予全面访问。它是身份策略，不能把资源策略附到用户组。
SOURCE: https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AdministratorAccess.html

## aws-rb2-20261107-pack-ca10 | d1
TOPIC: Multi-account workforce access / 多账户人员访问
Q:
Staff must access multiple AWS accounts with team-based permissions and frequent new joiners. How do you avoid recreating users and permissions in every account?
Q_ZH:
员工要访问多个AWS账户，团队权限不同且经常有新人加入。怎样避免在每个账户重复建用户和授权？
A:
Answer: Manage people and team groups with IAM Identity Center; assign each group a permission set and target accounts, and connect the existing identity source.
Key point: A permission set is a reusable permission template; Identity Center provisions the corresponding roles in target accounts, and team members use the assigned account access.
A_ZH:
答：用IAM Identity Center管理人员和团队组，为组分配permission set及目标账户，并接入既有身份源。
考点：permission set是可复用权限模板；Identity Center在目标账户配置相应角色，团队成员使用已分配的账户访问。
SOURCE: https://docs.aws.amazon.com/singlesignon/latest/userguide/permissionsetsconcept.html

## aws-rb2-20261107-pack-ca11 | d2
TOPIC: User pools vs identity pools / 用户池与身份池
Q:
An application with many customers needs login, and after login the client must access S3 directly with approved permissions. Can the user pool's login token be used directly as AWS access keys?
Q_ZH:
应用有大量客户要登录；登录后还要让客户端以获准的权限直接访问S3。用户池的登录令牌能直接当AWS访问密钥吗？
A:
Answer: No. The user pool handles customer sign-in; to call AWS APIs such as S3, obtain temporary AWS credentials through a Cognito identity pool, constrained by the permissions of an IAM role.
Key point: The login token proves the user is authenticated; the identity pool exchanges an accepted signed-in identity for temporary AWS credentials, and the IAM role decides what operations are allowed on which data.
A_ZH:
答：不能。用户池负责客户登录；需要调用S3等AWS API时，通过Cognito身份池取得受IAM角色权限约束的临时AWS凭证。
考点：登录令牌证明用户已验证；身份池把受认可的登录身份换成AWS临时凭证，IAM角色再决定能对哪些数据执行什么操作。
SOURCE: https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html

## aws-rb2-20261107-pack-ca18 | d2
TOPIC: EKS pod workload identity / EKS Pod工作负载身份
Q:
Different pods in the same EKS cluster need different AWS permissions according to each workload's identity. How should the permissions be bound?
Q_ZH:
同一EKS集群里的不同Pod，需要按各自工作负载身份授予不同的AWS权限。权限怎样绑定？
A:
Answer: Give each workload its own Kubernetes service account and link it to its restricted IAM role through IRSA.
Key point: The service account's OIDC identity is used to obtain temporary credentials for the corresponding IAM role, so the role's permissions take effect for that calling identity; applications do not have to share the node role as their calling identity.
A_ZH:
答：为它们设置不同的Kubernetes service account，通过IRSA关联各自受限的IAM角色。
考点：service account的OIDC身份用于取得相应IAM角色的临时凭证，角色权限随这次调用身份生效；应用不必共同使用节点角色作为调用身份。
SOURCE: https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html

## aws-rb2-20261107-pack-ca19 | d2
TOPIC: API entry authentication / API入口身份验证
Q:
A REST API must verify the caller before business processing. With Cognito login tokens, custom tokens, and IAM role temporary credentials in hand, how should each identity type be validated at the entry?
Q_ZH:
REST API要在业务处理前验证调用方。已有Cognito登录令牌、自定义令牌、IAM角色临时凭据，这些身份该怎样接入口验证？
A:
Answer: Use a Cognito authorizer for Cognito tokens, a Lambda authorizer for custom validation, and AWS_IAM with signed requests for IAM credentials.
Key point: The entry must validate the identity material the caller actually holds; the IAM method verifies the request signature and checks call permissions—AWS keys must not be treated as a Cognito login token.
Watch out: An API key with a usage plan identifies customers and meters or throttles usage; it cannot replace the authentication and authorization above.
A_ZH:
答：Cognito令牌用适用的Cognito authorizer；自定义验证用Lambda authorizer；IAM凭据用AWS_IAM并签名请求。
考点：入口须验证调用方实际持有的身份材料；IAM方式校验请求签名并检查调用权限，不能把AWS密钥当成Cognito登录令牌。
易错提醒：API key配合usage plan用于识别客户、计量和限流，不能代替上述身份认证与授权。
SOURCE: https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-usage-plans.html

## aws-rb2-20261107-pack-cb04 | d2
TOPIC: ALB entry scope / ALB入口范围
Q:
EC2 backends must stay in private subnets. For an internet-facing website versus a website used only by the VPN-connected office, how should the ALB entry be chosen?
Q_ZH:
EC2后端必须保留在私有子网。面向互联网的网站和只供VPN办公室使用的网站，ALB入口应怎样选择？
A:
Answer: Use an internet-facing ALB in public subnets for the internet site; use an internal ALB for the office-only site. Backend instances stay private either way.
Key point: The ALB receives entry connections and then connects to private targets; whether the entry faces the public internet depends on the audience. VPN provides the office-to-private-network path, so the backend does not need to be exposed.
A_ZH:
答：互联网网站用公网子网中的internet-facing ALB；仅办公室使用的站点用internal ALB。后端实例保持私有。
考点：ALB接收入口连接后再连接私有目标。入口是否面向公网取决于访问者范围；VPN提供办公室到私网的路径，不必把后端公开。
SOURCE: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-troubleshooting.html

## aws-rb2-20261107-pack-cb05 | d2
TOPIC: IPv4 and IPv6 egress gateways / IPv4与IPv6出站网关
Q:
VPC instances must initiate outbound internet access while the internet must not initiate connections to them. Which gateway handles outbound traffic for IPv4 versus IPv6?
Q_ZH:
VPC实例要主动访问互联网，又不允许互联网主动连入。出站流量分别为IPv4与IPv6时，各用什么网关？
A:
Answer: Use a public NAT gateway for IPv4 and an egress-only internet gateway for IPv6, with the corresponding outbound routes.
Key point: NAT translates addresses for IPv4 egress; the egress-only gateway needs no address translation for IPv6—it lets instances initiate connections and their return traffic while blocking internet-initiated IPv6 connections. A public NAT gateway must sit in a public subnet and egress through an elastic IP and internet gateway; the private subnet's internet route points to it.
A_ZH:
答：IPv4使用公有NAT gateway；IPv6使用egress-only internet gateway，并配置相应的出站路由。
考点：NAT为IPv4出站转换地址；egress-only网关不需要替IPv6做地址转换，允许实例发起连接及其返回流量，并阻止互联网发起IPv6连接。公有NAT须放在公有子网，借助弹性公网IP和Internet Gateway出站；私有子网的互联网路由指向它。
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/egress-only-internet-gateway.html

## aws-rb2-20261107-pack-cb10 | d2
TOPIC: WAF and HTTP entry points / WAF与HTTP入口
Q:
A website is served through CloudFront, an ALB, or an API Gateway REST API, and you must filter SQL injection or XSS attempts, or control access by registered client IPs. Where should this be done?
Q_ZH:
CloudFront、ALB或API Gateway REST API承载网站请求，要过滤SQL注入、XSS或按登记的客户端IP控制访问，应在哪里做？
A:
Answer: Associate a WAF web ACL with whichever supported HTTP entry actually serves the requests, configuring content rules or IP set rules as needed.
Key point: WAF inspects HTTP requests and applies rules; an IP set is a reusable collection of source addresses, and tens of thousands of addresses can be managed across multiple sets and rules. WAF does not associate directly with an NLB, and network port rules are not HTTP content filtering.
A_ZH:
答：在实际承载请求的受支持HTTP入口关联WAF web ACL，配置相应内容规则或IP set规则。
考点：WAF检查HTTP请求并执行规则；IP set是可复用的来源地址集合，上万地址可分多个集合和规则管理。WAF不直接关联NLB，网络端口规则也不等于HTTP内容过滤。
SOURCE: https://docs.aws.amazon.com/waf/latest/developerguide/what-is-aws-waf.html

## aws-rb2-20261107-pack-cb12 | d2
TOPIC: Geo-based access filtering / 按来源国家过滤
Q:
To filter content access by the country located from the request source IP, where should the control be applied?
Q_ZH:
希望按请求来源IP定位到的国家过滤内容访问，应该在哪里控制？
A:
Answer: Set country allow or deny rules at the actual entry, such as CloudFront geo restriction or a WAF geo rule in front of an ALB.
Key point: Rules match the geolocation result of the request IP; the country where servers are deployed or signed URLs alone do not perform this source filtering. It is not absolute proof of a person's real physical location.
A_ZH:
答：在实际入口设置国家允许或拒绝规则，例如CloudFront地域限制或ALB前的WAF地域规则。
考点：依据请求IP的地理定位结果匹配国家规则；服务器部署国家或签名URL本身不会完成这种来源过滤。它不是对人员真实物理位置的绝对证明。
SOURCE: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/georestrictions.html

## aws-rb2-20261107-pack-cb13 | d2
TOPIC: ACM certificate Regions / ACM证书Region
Q:
To use an external-CA certificate for the HTTPS entry of a Regional API Gateway or CloudFront, into which Region's ACM should it be imported, and why?
Q_ZH:
外部CA证书要给Regional API Gateway或CloudFront的HTTPS入口使用，应导入哪个Region的ACM，为什么？
A:
Answer: Import the certificate into ACM and bind it to the actual TLS entry: Regional API Gateway uses a certificate in the same Region as the API; the CloudFront viewer certificate is imported into us-east-1. An ALB HTTPS listener can also terminate client TLS with a certificate imported into ACM.
Key point: The certificate follows the requirements of the entry that actually completes the TLS handshake; CloudFront's certificate Region is not determined by the Region of the S3 origin bucket.
Watch out: The minimum TLS version is set separately by the security policy the entry supports—for example current API Gateway HTTP APIs can negotiate TLS 1.3; changing the certificate's issuing CA does not change the versions the entry allows.
A_ZH:
答：将证书导入ACM并绑定实际TLS入口。Regional API Gateway用API同Region的证书；CloudFront查看者证书导入us-east-1。ALB的HTTPS监听器也可使用导入ACM的证书终止客户端TLS。
考点：证书跟随实际完成TLS握手的入口要求；CloudFront的证书Region不由S3源桶所在Region决定。
易错提醒：最低TLS版本另由入口支持的安全策略决定，例如现行API Gateway HTTP API可协商TLS 1.3；换证书签发CA不会改变入口允许的版本。
SOURCE: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-ciphers.html

## aws-rb2-20261107-pack-cb15 | d2
TOPIC: Stateful SG vs NACL return traffic / 有状态安全组与NACL回程
Q:
A server already allows clients to send HTTPS requests from ephemeral ports. How do the security group and the NACL differ in permitting the responses, and which port should the NACL outbound rule match?
Q_ZH:
服务器已允许客户端从临时端口发来HTTPS请求。安全组与NACL对响应的放行有何不同，NACL回程应匹配哪个端口？
A:
Answer: The security group automatically allows responses of permitted connections; the NACL needs a separate outbound allow rule whose destination port matches the client's ephemeral port.
Key point: Security groups are stateful and remember connections; NACLs check each direction. The response leaves the server's port 443 but must return to the ephemeral port the client originally chose—the destination port is not 443.
Watch out: The ephemeral port range is determined by the requesting client; 32768–65535 is not a guarantee that applies to all clients.
A_ZH:
答：安全组自动允许已放行连接的响应；NACL必须另有出站允许规则，目的端口应匹配客户端的临时端口。
考点：安全组有状态，记住连接；NACL逐方向检查。响应从服务器443端口发出，但要返回客户端当初选择的临时端口，目的端口不是443。
易错提醒：临时端口范围由发起请求的客户端决定；32768–65535不是所有客户端都通用的保证。
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html

## aws-rb2-20261107-pack-cb19 | d2
TOPIC: Rate-based rules / 速率限制规则
Q:
Source IPs of an HTTP request flood keep changing, so a fixed blacklist is hard to maintain. To rate-limit such traffic per request group, how should the rule be configured?
Q_ZH:
HTTP请求洪泛的来源IP不断变化，固定黑名单难维护。要按请求组的速率限制此类流量，怎样配置？
A:
Answer: Configure a WAF rate-based rule on the actual supported HTTP entry, choosing the aggregation condition, threshold, and Block action appropriate to that request group.
Key point: The rule counts requests per aggregation group and applies the configured action to groups over the threshold; per-IP aggregation cannot guarantee stopping the overall distributed traffic when each individual IP stays under the limit.
A_ZH:
答：在实际受支持的HTTP入口配置WAF rate-based规则，选择适合该请求组的聚合条件、阈值及Block动作。
考点：规则统计每个聚合组的请求，并对超阈值的组执行设定动作；若按单IP聚合，每个IP都未超限时，不能保证拦住整体分布式流量。
SOURCE: https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based.html

## aws-rb2-20261107-pack-cc01 | d2
TOPIC: Managed patching vs custom commands / 托管补丁与自定义命令
Q:
A fleet of managed EC2 instances needs patching: OS patches are supported by the managed tool; if custom third-party Linux software patches are required instead, how should the execution method be chosen?
Q_ZH:
一批受管EC2要安装补丁：操作系统补丁已被托管工具支持；若换成自定义第三方Linux软件补丁，执行方法应怎样选？
A:
Answer: Use Systems Manager Patch Manager for supported patches; use Run Command to run the appropriate commands for custom installation steps.
Key point: Patch Manager executes and tracks against the supported patch catalog; Run Command sends custom commands to instances. A maintenance window controls when work runs and does not replace the installation action.
A_ZH:
答：受支持的补丁用Systems Manager Patch Manager；自定义安装步骤用Run Command执行相应命令。
考点：Patch Manager按受支持的补丁目录执行与跟踪；Run Command把自定义命令发送到实例。维护窗口规定何时运行，不能代替安装动作。
SOURCE: https://docs.aws.amazon.com/systems-manager/latest/userguide/patch-manager.html

## aws-rb2-20261107-pack-cc02 | d2
TOPIC: Vulnerabilities and threats / 漏洞与威胁检测
Q:
Which services find known vulnerabilities in EC2 software versus continuously detect suspicious access activity in AWS?
Q_ZH:
要找EC2软件的已知漏洞，与要持续发现AWS环境可疑访问行为，应分别选什么？
A:
Answer: Use Inspector where applicable for known software vulnerabilities; use GuardDuty for suspicious behavior and threat indicators.
Key point: Vulnerability scans match software versions against known weaknesses. GuardDuty finds anomalous activity: with RDS Protection enabled, it can analyze successful, failed, or incomplete login patterns in supported Aurora/RDS databases. Merely storing logs does not perform detection.
Watch out: Threat detection does not itself block logins. RDS Protection produces findings; response controls must be configured separately.
A_ZH:
答：已知软件漏洞用适用的Inspector；可疑行为与威胁迹象用GuardDuty。
考点：漏洞扫描匹配软件版本的已知弱点；GuardDuty寻找异常活动。例如启用RDS Protection后，可分析受支持Aurora/RDS数据库的成功、失败或未完成登录模式，发现异常登录。单纯保存日志不等于完成检测。
易错提醒：威胁发现不等于已经阻断登录；RDS Protection会生成发现，响应控制仍须另行配置。
SOURCE: https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html

## aws-rb2-20261107-pack-cc05 | d2
TOPIC: KMS key control / KMS密钥管理权
Q:
A service supports both AWS managed and customer managed KMS keys. How does the choice differ between needing only annual rotation and usage auditing versus creating, rotating, and disabling keys yourself?
Q_ZH:
服务同时支持AWS managed和customer managed KMS key。只要年度轮换和使用审计，与需要自行创建、轮换、禁用密钥，选择有何不同？
A:
Answer: Use the service-supported AWS managed key when no custom control is needed; use a customer managed key to control the key lifecycle yourself.
Key point: AWS managed keys use fixed behavior to reduce administration and fixed key-storage charges. Customer managed keys put policy and lifecycle control in the customer's hands.
A_ZH:
答：无自定义控制需求时可用服务支持的AWS managed key；要自行控制密钥生命周期时用customer managed key。
考点：AWS代管密钥以固定行为减少管理与固定密钥存储费用；客户管理密钥把策略和生命周期控制权交给客户。
SOURCE: https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html

## aws-rb2-20261107-pack-cc06 | d2
TOPIC: KMS rotation and key material / KMS轮换材料来源
Q:
A KMS key must rotate automatically each year. Can you import arbitrary customer key material and enable the same rotation as for an AWS-generated symmetric key?
Q_ZH:
要求KMS密钥按年度自动轮换。能否随便导入一份客户密钥材料，就把它当作AWS生成的对称密钥开启相同轮换？
A:
Answer: Choose a symmetric KMS key with AWS-generated material that supports automatic rotation, and enable the required rotation. Do not assume imported material supports the same behavior.
Key point: Rotation requires the key-management system to generate and retain usable new material. Customer managed describes who controls a key, not its material's origin or supported rotation methods.
A_ZH:
答：选择AWS生成密钥材料、支持自动轮换的对称KMS key，并开启所需轮换；不能把导入材料默认视为同样支持。
考点：轮换要由密钥管理系统生成并维护可用的新材料；“客户管理”只说明管理权，不说明材料来源与支持的轮换方式。
SOURCE: https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html

## aws-rb2-20261107-pack-cc08 | d2
TOPIC: Database encryption at rest / 数据库静态加密
Q:
RDS and Redshift data must be encrypted at rest. What can new storage use, and can adding a TLS certificate change an existing unencrypted RDS database's storage?
Q_ZH:
RDS和Redshift的数据都要静态加密。新建存储可用什么；若已有RDS未加密运行，能只加TLS证书改变存储吗？
A:
Answer: Enable KMS encryption at rest for new RDS storage; Redshift also offers KMS-based server-side storage encryption. For existing unencrypted RDS, take a snapshot, copy it with encryption, restore a new encrypted DB, and arrange cutover. A TLS certificate does not encrypt storage.
Key point: The snapshot copy creates encrypted data and the restored DB inherits encryption. Client TLS and password storage protect different boundaries; neither replaces encryption at rest. Subsequent automated backups and snapshots of an encrypted DB remain encrypted.
A_ZH:
答：新RDS可启用KMS静态加密，Redshift也提供基于KMS的服务端存储加密。已有未加密RDS应制作快照、复制并加密该快照，再恢复新加密DB并安排切换；TLS证书不会加密存储。
考点：快照复制实际产生加密数据，恢复的新库继承加密；客户端传输TLS和密码保存各保护不同边界，均不能替代静态加密。加密DB的后续自动备份和快照也保持加密。
SOURCE: https://docs.aws.amazon.com/redshift/latest/mgmt/working-with-db-encryption.html

## aws-rb2-20261107-pack-cc09 | d2
TOPIC: Encrypting new and existing EBS volumes / EBS新旧卷加密
Q:
All new EBS volumes in an account and Region must be encrypted automatically, and existing unencrypted volumes must also be converted. Is enabling default encryption enough, and what happens to old volumes?
Q_ZH:
同账户同Region的新EBS卷都要自动加密，已有未加密卷也要改造。只打开默认加密够吗，旧卷应怎样处理？
A:
Answer: Enable EBS encryption by default for new volumes. Snapshot existing volumes, create encrypted replacement volumes from the snapshots, and arrange replacement.
Key point: The default applies at creation and does not rewrite existing block storage. Creating an encrypted volume from a snapshot actually produces an encrypted data copy.
A_ZH:
答：新卷开启EBS默认加密；旧卷先做快照，再从快照创建加密新卷并安排替换。
考点：默认设置在创建时生效，不会直接改写已有块存储；从快照新建加密卷才实际生成加密的数据副本。
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/ebs-encryption.html

## aws-rb2-20261107-pack-cc10 | d2
TOPIC: Configuration evaluation and remediation / 配置评估与整改
Q:
You must continuously check actual configuration, such as EBS encryption and resource tags, and automatically correct noncompliance. Is a Config noncompliant flag enough, and how should responsibilities be split?
Q_ZH:
要持续检查EBS卷是否加密、资源是否有标签等真实配置，并自动纠正不合规。只让Config把资源标红够吗，怎样分工？
A:
Answer: Use appropriate AWS Config rules to evaluate actual configuration, and associate a Systems Manager Automation document to execute supported or custom remediation actions.
Key point: Config determines whether resources deviate from requirements; Automation performs changes. A tag declaration or cost report cannot prove encryption, and an evaluation result does not modify a resource by itself.
A_ZH:
答：用AWS Config匹配的规则评估实际配置；再关联Systems Manager Automation文档，执行所需的受支持或自定义整改动作。
考点：Config判断资源是否偏离要求；Automation实际执行修改步骤。标签声明或费用报表不能证明已经加密，评估结果也不会自己改写资源。
SOURCE: https://docs.aws.amazon.com/config/latest/developerguide/WhatIsConfig.html

## aws-rb2-20261107-pack-cc14 | d2
TOPIC: S3 permanent-deletion verification / S3永久删除验证
Q:
S3 already retains document versions. To prevent accidental permanent deletion of versions using ordinary user credentials, is enabling MFA for user sign-in enough?
Q_ZH:
S3已经保留文档版本，还想防止凭普通用户凭证意外永久删除版本，只给用户登录启用MFA就够吗？
A:
Answer: Enable applicable S3 MFA Delete protection. It requires Versioning and is not automatically replaced by sign-in MFA.
Key point: Sign-in verification and version-deletion verification occur on different operations. MFA Delete adds verification requirements to the relevant permanent deletions and versioning-setting operations.
A_ZH:
答：启用适用的S3 MFA Delete保护；它依赖Versioning，不能由登录MFA自动替代。
考点：登录验证与版本删除验证发生在不同操作；MFA Delete为相应永久删除及版本设置操作增加验证要求。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/MultiFactorAuthenticationDelete.html

## aws-rb2-20261107-pack-cc16 | d2
TOPIC: Restricting S3 endpoint paths / S3端点路径限制
Q:
EC2 must privately access S3 through a specified VPC endpoint, and requests must not bypass that entry. Is the endpoint alone enough?
Q_ZH:
EC2要经指定VPC端点私下访问S3，同时防止请求绕过这个入口，只有端点够吗？
A:
Answer: No. Establish the endpoint path and restrict allowed endpoint origins in the bucket policy.
Key point: The endpoint supplies a private path to S3; the bucket policy checks during authorization whether the request came through the allowed entry.
A_ZH:
答：不够；建立所需端点路径，并在桶策略中限制允许的端点来源。
考点：端点提供到S3的私网路径；桶策略才在授权时检查请求是否来自允许入口。
SOURCE: https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html

## aws-rb2-20261107-pack-cc18 | d2
TOPIC: Regional sensitive-data discovery / 分Region敏感数据发现
Q:
S3 object contents may contain PII, and the data spans two Regions. Is an object inventory enough, and where should content discovery run?
Q_ZH:
S3对象正文可能含PII，数据分布在两个Region。查对象清单够吗，应在哪里运行内容发现？
A:
Answer: Configure applicable Macie sensitive-data discovery jobs and identifiers in each Region containing the data.
Key point: An inventory describes object attributes and API logs describe operations. Macie inspects sensitive content in supported objects. A centralized dashboard does not mean a job in one Region scanned another Region.
A_ZH:
答：在数据所在的每个Region配置适用的Macie敏感数据发现作业与识别器。
考点：清单只描述对象属性，API日志只描述操作；Macie检查受支持对象中的敏感内容。一个Region的作业不能据集中看板就算扫描了另一个Region。
SOURCE: https://docs.aws.amazon.com/macie/latest/user/what-is-macie.html

## aws-rb2-20261107-pack-cc19 | d2
TOPIC: Fine-grained data-lake access / 数据湖细粒度授权
Q:
In a Lake Formation-governed data lake, different teams should see different columns or rows of the same data. Should sensitive fields be deleted for everyone?
Q_ZH:
Lake Formation治理的数据湖中，不同团队应看同一数据的不同列或行，应该把敏感字段给所有人都删掉吗？
A:
Answer: No. Use applicable Lake Formation fine-grained permissions or data filters to provide each identity its permitted data scope.
Key point: Users have different permissions. Query-time filtering preserves the original data while limiting each user's view; global deletion changes everyone's data.
A_ZH:
答：不应；用适用的Lake Formation细粒度授权或数据过滤，按身份提供允许的数据范围。
考点：不同用户的权限不同，查询时的过滤保留原数据并分别限制可见范围；全局删除会改变所有人的数据。
SOURCE: https://docs.aws.amazon.com/lake-formation/latest/dg/tag-based-access-control.html

## aws-rb2-20261107-pack-cc20 | d2
TOPIC: Time-limited direct S3 access / S3限时直传
Q:
How can an external user read one private S3 object for a limited time, or a browser upload directly to S3, without making the bucket public or relaying the whole file?
Q_ZH:
外部用户只需在有限时间内读取一个私有S3对象，或浏览器应直接上传到S3，怎样避免公开桶和转发整个文件？
A:
Answer: An authorized application issues an S3 presigned URL limited to the object, operation, and lifetime; the client requests S3 directly.
Key point: The URL carries the signer's authorized object, operation, and expiry and is reusable within that period. Data bypasses the application server without exposing the bucket. SigV4 allows up to seven days, but never beyond the signing credentials' lifetime; temporary credentials expiring earlier invalidate the URL earlier.
A_ZH:
答：由有权限的应用签发限定对象、操作和期限的S3 presigned URL，让客户端直接请求S3。
考点：签名把签发者可授权的特定对象、操作和期限放进URL，期限内可重复使用；数据不必经过应用服务器，也不用公开整个桶。使用SigV4签名可设置最长7天，但不能超过签发凭证自身的有效期；临时凭证先过期，URL也提前失效。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html

## aws-rb2-20261107-pack-cc21 | d2
TOPIC: CloudFront content signatures / CloudFront内容签名
Q:
Content is distributed through CloudFront to authorized customers only. Where does the signature go when the client does not support cookies versus when the URL cannot change?
Q_ZH:
内容经CloudFront分发，只给获授权客户访问。客户端不支持Cookie，与URL不可改动时，签名放在哪里？
A:
Answer: Use CloudFront signed URLs for clients without cookies; use signed cookies when the existing URL must remain unchanged and the client supports cookies.
Key point: CloudFront validates access conditions in both cases; authorization travels in the link or cookie. An S3 presigned URL authorizes a direct S3 request and cannot replace the CloudFront entry signature.
A_ZH:
答：不支持Cookie的客户端使用CloudFront signed URL；不能改变现有URL但能带Cookie的客户端用signed cookies。
考点：两种签名都由CloudFront验证内容访问条件，差别是授权信息放在链接还是Cookie。S3 presigned URL授权的是直接S3请求，不能代替CloudFront入口签名。
SOURCE: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-choosing-signed-urls-cookies.html

## aws-rb2-20261107-pack-cc23 | d2
TOPIC: CloudTrail event categories / CloudTrail事件类别
Q:
Which records identify who changed a security group or read or wrote an S3 object? Is a configuration snapshot sufficient?
Q_ZH:
要查谁改了安全组，或谁读写了S3对象，该看哪类记录？配置快照够吗？
A:
Answer: Use CloudTrail management events for resource-management APIs and select the relevant data events for S3 object operations.
Key point: Events identify the caller, action, and time to trace operations or permission failures. Config describes resource-state changes and cannot alone replace attribution. Object access and resource management are different event categories.
A_ZH:
答：看CloudTrail：资源管理API使用相应management events；S3对象操作须选择相应data events。
考点：事件记录带调用者、动作和时间，才能追溯操作或权限失败；Config说明资源状态如何变化，不能单独替代归因。对象读写与资源管理也不属于同一事件类别。
SOURCE: https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html

## aws-rb2-20261107-pack-cmp-m02 | d2
TOPIC: Choosing private S3 endpoints / S3私网端点选择
Q:
An application in this VPC accesses same-Region S3 or DynamoDB; an on-premises site accesses S3 over an existing dedicated connection. Both must bypass IGW and NAT. Which endpoints suit each, and why?
Q_ZH:
本VPC应用访问同Region的S3或DynamoDB，与机房经已有专线访问S3，都要绕过IGW和NAT。应分别选哪类端点，为什么？
A:
Answer: Within this VPC, use the service's gateway endpoint associated with the actual callers' subnet route tables. For on-premises S3 access, use an S3 interface endpoint reachable over the dedicated connection.
Key point: A gateway endpoint routes service traffic within its VPC without extra endpoint fees, still using public service addresses. It is not an endpoint ENI with security groups and cannot extend to on-premises clients. An interface endpoint supplies private ENIs, with security groups and charges.
Watch out: Endpoints do not replace service authorization; instance security groups and subnet NACLs must allow traffic. The on-premises branch here covers only S3.
A_ZH:
答：本VPC可用对应服务的gateway endpoint，关联实际调用子网的路由表；机房访问S3用可经专线到达的S3 interface endpoint。
考点：gateway按本VPC路由接走服务流量，没有额外端点费，仍使用服务公有地址；它不是带安全组的端点网卡，也不能延伸给机房客户端。interface提供私有网卡入口，有安全组及相应费用。
易错提醒：端点不代替服务授权；实例安全组和子网NACL也仍需放行。机房分支这里仅讨论S3。
SOURCE: https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html

## aws-rb2-20261107-pack-cmp-m03 | d2
TOPIC: Updating existing S3 objects in bulk / 批量修改历史对象
Q:
Millions of existing S3 objects need encryption or retention changes. Is changing the bucket's new default sufficient, and how can old objects be updated in bulk?
Q_ZH:
数百万已有S3对象要补加密或改保留属性。修改桶的新默认就够吗，怎样批量改旧对象？
A:
Answer: No. Use manifest-driven S3 Batch Operations with an applicable operation; invoke Lambda when custom logic is required.
Key point: Defaults affect applicable subsequent writes and do not rewrite all historical objects. Batch jobs perform supported changes on manifest entries.
Watch out: Verify operation support: arbitrary custom deletion is not a native S3 Batch operation.
A_ZH:
答：不够；对已有对象使用清单驱动的S3 Batch Operations及适用操作，需要自定义逻辑时调用Lambda。
考点：默认配置影响后续适用写入，不会回写全部历史对象；批作业按清单逐个执行受支持的修改。
易错提醒：须确认操作类型受支持，不能把任意自定义删除动作说成S3 Batch的原生操作。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/batch-ops.html

## aws-rb2-20261107-pack-cmp-m04 | d2
TOPIC: Publishing and consuming PrivateLink / PrivateLink发布与消费
Q:
Clients inside a VPC or connected by an existing dedicated connection must call services privately. For a supported AWS service versus a vendor's custom TCP service, what do provider and consumer configure?
Q_ZH:
客户端在VPC内或经已有专线连入VPC，要私下调用服务。调用受支持AWS服务，与供应商自建TCP服务，发布端和消费端分别做什么？
A:
Answer: For an AWS service, the customer creates its corresponding interface endpoint. For custom TCP, the vendor fronts the service with an NLB and publishes an endpoint service; the customer creates an interface endpoint to it.
Key point: The endpoint service publishes the entry; the interface endpoint is the consumer's private ENI entry and must target the actual service. Endpoint security groups allow client connections. Supported AWS endpoint policies control authorization, not network reachability. Connections originate from consumers; providers cannot initiate reverse connections to the consumer VPC through this endpoint.
Watch out: If NLB backend IPs change, such as after RDS failover, registered targets must be updated. Creating an endpoint once does not solve backend changes.
A_ZH:
答：AWS服务的客户创建对应service的interface endpoint；供应商自建TCP服务，供应商先在服务前配置NLB并发布endpoint service，客户再建interface endpoint连接它。
考点：endpoint service是发布入口，interface endpoint是消费侧私有网卡入口，须连接实际被调用的服务；端点安全组允许客户端连接。对支持端点策略的AWS服务，端点策略控制授权，不能代替网络放行。 连接由消费端发起，提供方不能通过这条PrivateLink端点新建到消费VPC的反向连接。
易错提醒：若NLB后端IP会变，例如RDS故障切换，注册目标须同步更新；不能把创建一次端点当作已解决后端变化。
SOURCE: https://docs.aws.amazon.com/vpc/latest/privatelink/privatelink-share-your-services.html

## aws-rb2-20261107-pack-cmp-m05 | d2
TOPIC: SCP attachment scope / SCP挂载范围
Q:
Only development member accounts must be barred from certain AWS operations, even for their administrators or root users; production must remain unaffected. Where should the restriction be attached?
Q_ZH:
只禁止开发成员账户执行某些AWS操作，成员管理员甚至root也不能绕过，生产账户不受影响。限制应放哪里、挂在哪个范围？
A:
Answer: Attach an explicitly denying SCP to those development member accounts or a separate development OU (an account grouping), not the organization root shared with production.
Key point: SCPs cap member-account permissions; local administrator Allows cannot override them. Accounts inherit their OU's SCPs, so attachment scope determines which accounts are restricted.
Watch out: SCPs do not constrain the organization's management account; the member-root boundary does not extend to it.
A_ZH:
答：用含明确Deny的SCP，挂到这些开发成员账户，或挂到独立开发OU（账户分组）；不要挂到开发、生产共同的组织根。
考点：SCP设置成员账户权限上限，账户内管理员的Allow不能越过它；OU下账户继承SCP，因此挂载范围决定哪些成员账户受限。
易错提醒：SCP不约束组织管理账户本身，不能把成员账户root边界泛化到管理账户。
SOURCE: https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html

## aws-rb2-20261107-pack-cmp-m06 | d1
TOPIC: Application roles and temporary credentials / 应用角色临时凭证
Q:
EC2 or Lambda code must read S3 without storing long-term access keys. How do you give the running code permissions, and why avoid saved user keys?
Q_ZH:
EC2或Lambda里的应用要读S3，不保存长期访问密钥。怎样把权限交给运行代码，为什么不直接保存用户密钥？
A:
Answer: Grant an IAM role the needed S3 actions and resources. Associate the role with EC2 through an instance profile, or attach a Lambda execution role.
Key point: An instance profile passes a role to EC2; the execution role serves Lambda. Code obtains automatically refreshed temporary credentials without distributing long-term user keys; applications can have separate restricted roles.
Watch out: A Lambda resource policy controls who invokes the function; it does not replace the execution role's permissions for code accessing other resources.
A_ZH:
答：授给具备所需S3动作和资源权限的IAM角色：EC2通过instance profile关联角色，Lambda关联执行角色。
考点：instance profile把角色交给EC2使用；Lambda执行角色交给函数使用。代码取得可自动更新的临时凭据，不必分发长期用户密钥，不同应用可各用受限角色。
易错提醒：Lambda函数资源策略管谁能调用函数，不能替代函数代码访问其他资源的执行角色权限。
SOURCE: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html

## aws-rb2-20261107-pack-cmp-m07 | d2
TOPIC: Secret storage and rotation / 秘密存储与轮换
Q:
Application passwords or supported-size sensitive values must be retrieved under access control rather than hardcoded. Database passwords also need regular rotation, and the same credential must be read in multiple Regions. How should this be managed?
Q_ZH:
应用密码或受支持大小的敏感值不能写死在代码中，要受控取用；数据库密码还须定期轮换。同一凭据需在多Region读取，怎样管理？
A:
Answer: Store secrets centrally in Secrets Manager for authorized runtime retrieval; configure applicable automatic database-password rotation. Replicate the primary secret for nearby reads, and rotate at the primary.
Key point: KMS protects managed secret storage and retrieval uses controlled decryption. Database rotation must also update the actual password; the primary's new value propagates to replicas. Rotating only a KMS key does not change the database password.
Watch out: Replicating a secret synchronizes one credential; it does not rotate passwords for several independent databases.
A_ZH:
答：集中放Secrets Manager，由获授权应用运行时读取；数据库密码配置适用自动轮换。同一凭据需就近读取时复制主secret，在主secret轮换。
考点：服务用KMS保护秘密并提供托管存储，取值时受控解密；数据库轮换还须更新实际密码，主secret的新值再传播到副本。仅换KMS key不会更换数据库密码。
易错提醒：复制secret是在同步同一份凭据，不能据此认为多个独立数据库的密码都已被轮换。
SOURCE: https://aws.amazon.com/secrets-manager/sla/

## aws-rb2-20261107-pack-cmp-m08 | d2
TOPIC: Layers and changing secrets / Layer与动态秘密
Q:
Several Lambda functions share database-secret retrieval logic. Will putting the password into a layer automatically synchronize rotated values? How should sharing work?
Q_ZH:
多个Lambda共用读取数据库秘密的逻辑。把密码也打包进layer，能让轮换后的值自动同步吗？应怎样共享？
A:
Answer: No. Put shared retrieval code and dependencies in the layer; keep the secret in Secrets Manager for authorized runtime reads.
Key point: A layer is a versioned deployment archive: updates require publishing a version and updating functions. It is not an automatically changing shared file. GetSecretValue reads one secret; BatchGetSecretValue reads several. Separate code from changing values.
Watch out: Parameter Store values require its own retrieval API; passing another service's parameter to Secrets Manager's batch API does not retrieve it.
A_ZH:
答：不能。layer只打包共享取值代码和依赖；秘密集中存Secrets Manager，由获授权的函数运行时读取。
考点：layer是版本化部署归档，更新须发布新版本并更新函数，不能当自动变化的共享文件。GetSecretValue读一份secret，BatchGetSecretValue读多份；代码与会变化的值分开。
易错提醒：Parameter Store中的值要用其自己的取值API；把另一服务的参数交给Secrets Manager批量接口不会读到。
SOURCE: https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_BatchGetSecretValue.html

## aws-rb2-20261107-pack-cmp-m09 | d2
TOPIC: Requester and resource ownership / 请求者与资源归属
Q:
S3 policies must separately enforce 'only identities from this organization may access' and 'the application may access only this account's buckets.' Which side is checked, using which condition?
Q_ZH:
S3策略要分别限制“只有本组织的身份能来访问”和“应用只能访问本账户的桶”。该检查请求者还是桶，用什么条件？
A:
Answer: For the first, check aws:PrincipalOrgID in the bucket policy. For the second, explicitly deny buckets owned by other accounts using s3:ResourceAccount in the application role policy.
Key point: Principal conditions identify the requester; resource conditions identify the owner. Organization or ownership checks continue to match new members or buckets without itemized lists.
Watch out: The role still needs an Allow for the actions; retain necessary exceptions for AWS-service-owned buckets.
A_ZH:
答：前者在桶策略检查aws:PrincipalOrgID；后者在应用角色策略用s3:ResourceAccount，对非本账户所有的桶明确Deny。
考点：Principal条件回答谁来访问；Resource条件回答资源归谁。检查组织或所有者关系，新增成员或新桶仍能按规则匹配，不必逐个维护清单。
易错提醒：角色仍需相应动作的Allow；若需AWS服务托管的桶，应明确保留必要例外。
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html

## aws-rb2-20261107-pack-cmp-m10 | d2
TOPIC: Security groups and the actual previous hop / 实际上一跳安全组
Q:
For connections into a tiered application, how should inbound security groups use the actual previous hop and server port? If the path becomes cross-Region private connectivity, can the remote security group still be referenced?
Q_ZH:
分层应用接收连接时，如何按实际上一跳和服务端口设置入站安全组？如果连接改为跨Region私网路径，还能引用远端安全组吗？
A:
Answer: At the receiver, allow only the actual previous hop and destination service port, referencing its security group where supported. Cross-Region peering or TGW peering paths do not support remote security-group references; use actual source private IPs or narrow CIDRs.
Key point: Each new connection changes its initiator: office-to-bastion uses the office public egress, bastion-to-private-server uses the bastion private address; ALB-to-web targets references the ALB group. Group references track workload scaling without individual IP updates.
Watch out: Use the receiver's listening port, such as SQL Server's default 1433. To restrict egress, configure the initiator toward the receiver, not just inbound on the wrong side.
A_ZH:
答：在接收端只放行实际上一跳和目标服务端口；支持引用时用上一跳的安全组。跨Region peering或TGW对等路径不支持远端安全组引用，用实际来源私有IP或收窄CIDR。
考点：每次重新建立连接，来源随发起者改变：公司连跳板看到公司公网出口，跳板连私网看到跳板私有地址；ALB连Web目标时引用ALB安全组。安全组引用可随工作负载增减，无须逐个改IP。
易错提醒：端口是接收端实际监听端口，如默认SQL Server 1433；需要限制出站时，在发起端指向接收端，不要只改错误一侧的入站。
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html

## aws-rb2-20261107-pack-cmp-m11 | d2
TOPIC: Private networking and TLS / 私网与TLS边界
Q:
Data is encrypted at rest and requests use a private network. Does that replace TLS? For EC2 connecting to RDS MySQL, how does the client encrypt the connection and verify the database's identity?
Q_ZH:
数据已静态加密、请求又走私网，能代替TLS吗？以EC2连接RDS MySQL为例，客户端怎样加密连接并验证数据库身份？
A:
Answer: Enable TLS in the database client and validate the server certificate with AWS's RDS CA bundle.
Key point: At-rest encryption protects stored data; private or dedicated networking selects the transport path. Establishing TLS protects the connection. The CA certificate enables server verification; downloading it alone does not enable TLS. S3 can reject non-SecureTransport requests to enforce HTTPS.
Watch out: After proxy or edge TLS termination, the next hop is a separate connection. Network-layer IPsec does not automatically enable application TLS.
A_ZH:
答：仍须启用数据库客户端TLS，并使用AWS提供的RDS CA证书包验证服务端证书。
考点：静态加密保护落盘，私网或专线规定承载路径；真正建立TLS才保护连接。CA证书供客户端核对服务器，只下载证书不会启用TLS。S3可拒绝非SecureTransport请求来强制HTTPS。
易错提醒：代理或边缘终止TLS后，后续是另一条连接；网络层IPsec也不会自动替应用连接启用TLS。
SOURCE: https://docs.aws.amazon.com/vpn/latest/s2svpn/data-protection.html

## aws-rb2-20261107-pack-cmp-m16 | d2
TOPIC: Enforced retention and legal hold / 强制保留与法律保留
Q:
S3 versions or backups must resist even administrator deletion for a fixed period. If S3 instead must wait until authorized staff release retention, which controls apply? Can Versioning or Lifecycle replace them?
Q_ZH:
S3版本或备份在固定保留期内连管理员也不能提前删；若S3改成等获准人员解除保留才可删，应怎样选择？Versioning或Lifecycle能替代吗？
A:
Answer: Use the applicable Object Lock or Backup Vault Lock compliance mode for fixed retention; use S3 legal hold for indefinite retention until release. Versioning retains history and Lifecycle schedules cleanup; neither replaces enforced retention.
Key point: Effective compliance retention prevents early deletion; authorized users can bypass governance. Legal hold persists until an authorized user releases it, without an invented far-future expiry.
Watch out: S3 cleanup concerns specific protected versions. Lifecycle cannot bypass an effective lock, and retention ending does not instantly remove every version.
A_ZH:
答：固定期用对应Object Lock或Backup Vault Lock的compliance模式；S3无限期等待解除用legal hold。Versioning留历史，Lifecycle安排清理，不能替代强制保留。
考点：已生效的compliance保留约束提前删除；governance可被有权者绕过。legal hold不设猜测的超长到期日，持续到获准用户解除。
易错提醒：S3清理须考虑受保护的具体版本；Lifecycle不会越过有效锁，保留结束也不等于所有版本立即消失。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html

## aws-rb2-20261107-pack-cmp-m20 | d2
TOPIC: Client-side encryption before storage / 存储前客户端加密
Q:
Sensitive data must already be ciphertext under the customer's own key before reaching S3 or a database. Does SSE-C qualify? How can EMR ETL output meet this requirement?
Q_ZH:
敏感数据交给S3或数据库前就必须用客户自己的密钥成为密文。SSE-C符合吗？EMR的ETL输出可怎样落实这一要求？
A:
Answer: No. Encrypt in the application with an accessible customer key before sending data to storage. On EMR with EMRFS support, CSE-Custom with a custom key provider can encrypt output before upload.
Key point: The deciding condition is whether data is encrypted before storage receives it. SSE-C uses a customer-supplied key on each request but S3 still encrypts after receipt. Client-side encryption delivers ciphertext to storage.
Watch out: Glue job-bookmark encryption protects progress bookmarks; it does not prove ETL output was encrypted before upload.
A_ZH:
答：SSE-C不符合：应用应先用可调用的客户密钥完成客户端加密，再交给存储。使用支持EMRFS的EMR时，可用CSE-Custom及客户自定义key provider加密输出后上传。
考点：决定条件是存储收到数据前是否已成为密文。SSE-C虽由客户逐请求提供key，仍是S3收到数据后加密；客户端加密才把密文交给存储。
易错提醒：Glue job bookmark加密保护的是任务进度书签，不能据此认为ETL输出已在上传前加密。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingClientSideEncryption.html

## aws-rb2-20261107-pack-cmp-m22 | d2
TOPIC: Shield protection at the actual entry / Shield保护真实入口
Q:
A public application needs Shield Advanced DDoS mitigation and expert collaboration. Traffic enters through Global Accelerator or directly through EC2/NLB. Which resources should be registered for protection?
Q_ZH:
公网应用需要Shield Advanced增强DDoS缓解及专家协作。流量先进入Global Accelerator，或直接进入EC2/NLB时，应把哪种资源登记保护？
A:
Answer: Register a standard Global Accelerator directly. For EC2 or NLB, protect supported associated resources such as Elastic IPs rather than always specifying a backend instance ID. Work with the Shield Response Team as needed.
Key point: Mitigation must target a supported actual public entry. Shield Advanced detects and mitigates DDoS; a vulnerability or threat finding alone does not block attacks.
Watch out: An event's top-source summary is not a full forensic log. HTTP attribution also needs entry access logs, and application-layer analysis uses WAF logs.
A_ZH:
答：标准Global Accelerator直接登记加速器；EC2或NLB按其关联Elastic IP等受支持资源配置保护，不能一律填后端实例ID。按需要与Shield Response Team协作。
考点：缓解要作用在受支持的真实公网入口；Shield Advanced检测并缓解DDoS，漏洞或威胁发现报告本身不会拦下攻击。
易错提醒：事件主要来源汇总不是完整取证日志；HTTP请求溯源还需入口访问日志，应用层判断看WAF日志。
SOURCE: https://aws.amazon.com/shield/features/

## aws-rb2-20261107-pack-cmp-m25 | d2
TOPIC: Connecting to private databases / 私有数据库连接
Q:
Lambda or Managed Grafana is authorized to read private RDS. Are IAM permissions or an RDS interface endpoint sufficient? What should it connect to?
Q_ZH:
Lambda或Managed Grafana有访问权限，要读取私有RDS。仅有IAM权限或创建RDS interface endpoint就够吗，应连接哪里？
A:
Answer: No. Configure VPC connectivity for the function or workspace, choose subnets with a path to the target, allow the actual security groups, and connect to the database's own private endpoint and port.
Key point: IAM controls permitted actions; VPC connectivity provides the network path. An RDS interface endpoint serves management APIs such as creation or modification, not MySQL or other SQL connections. Lambda can also reach an on-premises database over existing private routes.
Watch out: Grafana need not make RDS public. Database login authorization is still required after networking works.
A_ZH:
答：不够。为函数或工作区配置VPC连接，选有目标私网路径的子网并放行实际安全组，连接数据库自己的私有endpoint和端口。
考点：IAM决定允许做什么，VPC连接提供网络路径；RDS interface endpoint用于创建、修改等管理API，不承载MySQL等数据库SQL连接。Lambda也可沿已有私网路线到本地数据库。
易错提醒：Grafana不需为此把RDS公开；网络连通后仍须满足数据库实际登录授权。
SOURCE: https://docs.aws.amazon.com/grafana/latest/userguide/AMG-configure-vpc.html

## aws-rb2-20261107-pack-fh01 | d2
TOPIC: Log subscriptions and OpenSearch / 日志订阅与OpenSearch
Q:
VPC Flow Logs are in a CloudWatch Logs log group and must reach OpenSearch Service near real time. Can Firehose deliver the subscribed log-group records directly to OpenSearch, and what should be chosen?
Q_ZH:
VPC Flow Logs已写入CloudWatch Logs日志组，要近实时送到OpenSearch Service分析。有人提议直接经Kinesis Data Firehose把日志组记录送到OpenSearch。这条直接路径可行吗，应选什么？
A:
Answer: No. CloudWatch Logs subscriptions combine multiple log events into one record; Firehose does not support directly delivering that input to OpenSearch Service. Use a supported path with an actual consumer, such as a subscription to Kinesis Data Streams and a Lambda consumer that decodes records and writes to OpenSearch.
Key point: Subscriptions forward packed records, not individual events. The OpenSearch destination requires one indexable log per record, so this input/destination combination is unsupported. On the KDS path, the consumer decodes and performs writes.
Watch out: General Firehose support for an OpenSearch destination does not imply support for CloudWatch Logs multi-event input. Receiving subscriptions and supporting a destination do not ensure the two compose.
A_ZH:
答：不可行。CloudWatch Logs订阅记录把多条日志事件合并成一条记录，Firehose不支持把这种CloudWatch Logs输入直接交付到OpenSearch Service目的地；应选带实际消费者处理记录的受支持路径，如订阅到Kinesis Data Streams，由Lambda消费者解码并写入OpenSearch。
考点：订阅过滤器转发的是打包记录而非单条日志：CloudWatch把多条日志事件合成一条记录，OpenSearch目的地要求一条记录对应一条可索引日志，所以这个输入/目的地组合不被支持。KDS路径由消费者解码并负责写入，因此成立。
易错提醒：“Firehose支持OpenSearch目的地”只说目的地通用受支持，不能推出CloudWatch Logs这种多事件打包输入也能直送；不要因为Firehose能接订阅、也能连OpenSearch就默认两段可拼。
SOURCE: https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/SubscriptionFilters.html

## aws-rb2-20261107-pack-na03 | d2
TOPIC: Connection and HTTP logs / 连接与HTTP日志
Q:
Which logs show connections to an ENI and port versus HTTP request paths and responses at an ALB?
Q_ZH:
要看谁连接了哪块网卡、哪个端口，或要看ALB上的HTTP请求路径和响应，分别应查什么日志？
A:
Answer: Use VPC Flow Logs for network-connection metadata and ALB access logs for HTTP requests. ALB logs can go to S3; Flow Logs can go to CloudWatch Logs or S3.
Key point: Flow Logs contain IP traffic metadata, not HTTP request bodies. ALB access logs record client IPs, request paths, latency, and server responses; these observe different layers.
A_ZH:
答：网络连接元数据看VPC Flow Logs；HTTP请求看ALB access logs，可把ALB日志投递到S3。VPC Flow Logs也可投递CloudWatch Logs或S3。
考点：Flow Logs记录IP流量元数据，不包含HTTP请求正文；ALB访问日志记录客户端IP、请求路径、延迟和服务器响应，观察的是不同层次。
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html

## aws-rb2-20261107-pack-nb03 | d2
TOPIC: CloudFront origin authorization / CloudFront源站授权
Q:
CloudFront must serve private S3 content and may accept uploads. Does a customer's access signature alone let CloudFront access S3?
Q_ZH:
CloudFront要提供私有S3内容，也可能接收上传。客户已经有访问签名，就足够让CloudFront访问S3吗？
A:
Answer: No. Configure origin access for the distribution and grant it the needed S3 actions in the bucket policy. OAC signs origin requests; legacy OAI provides a dedicated origin identity for its supported S3-read scenarios.
Key point: Client-to-CloudFront and CloudFront-to-S3 are separate authorization boundaries. The distribution also needs permissions. Read-only permission cannot upload; uploads require the actual write actions.
A_ZH:
答：不够；为分发配置源站访问机制，在桶策略授权它执行所需S3动作。OAC为源站请求签名；旧OAI在其支持的S3读取场景中提供专用源站身份。
考点：客户到CloudFront与CloudFront到S3是两段授权，分发也要有对应权限。只给读取权限不能上传；上传须允许实际写动作。
SOURCE: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html

## aws-rb2-20261107-pack-nc03 | d2
TOPIC: Customer key isolation / 客户密钥隔离
Q:
Customers' data needs separate encryption and separate control over who decrypts it. Can all customers share one KMS key with identical permissions?
Q_ZH:
多客户数据必须分别加密、分别控制谁能解密。能否让所有客户共用一把具有相同权限的KMS key？
A:
Answer: Create appropriate independent KMS keys per customer and restrict each customer's key usage to its data boundary.
Key point: Separate keys distinguish permissions and audits by customer. Different object prefixes under one key do not automatically create independent decryption permissions.
A_ZH:
答：按客户建立适当的独立KMS key，并把各客户的用钥权限限制到对应数据边界。
考点：分开的key使权限与审计可按客户区分；只给同一把key换不同对象前缀，并不会自动产生独立的解密权限。
SOURCE: https://aws.amazon.com/blogs/architecture/simplify-multi-tenant-encryption-with-a-cost-conscious-aws-kms-key-strategy/

## aws-rb2-20261107-pack-nc05 | d1
TOPIC: Control Tower baselines / Control Tower基线
Q:
An organization wants low-maintenance account provisioning and governance with shared audit baselines. Is creating accounts and OUs in Organizations enough, and why?
Q_ZH:
组织要少维护地开通和治理有共同审计基线的账户，只在Organizations创建账户和OU够吗，为什么？
A:
Answer: No. Establish a Control Tower landing zone in the management account, enable required service integrations such as CloudTrail, and enroll the targeted new and existing accounts.
Key point: Control Tower supplies managed baselines and account-provisioning integration; preventive controls can block requests through SCPs. Existing organization membership alone does not enroll accounts. Auditing depends on actually enabled service integrations.
A_ZH:
答：不够；在管理账户建立Control Tower landing zone，启用所需CloudTrail等服务集成，并把新旧目标账户纳入管理。
考点：Control Tower提供托管基线和账户开通衔接；其预防型control可通过SCP在请求时阻止操作。已有账户不会仅因属于同一组织就自动纳管，审计须在实际启用的服务集成中落实。
SOURCE: https://docs.aws.amazon.com/controltower/latest/userguide/how-control-tower-works.html

## aws-rb2-20261107-pack-nc06 | d1
TOPIC: Centralized security findings / 统一安全发现
Q:
A company needs a unified view of security-service findings and security-standard control status. Should a new service rescan every threat?
Q_ZH:
公司要统一查看安全服务发现及安全标准控制状态，应该让一个新服务重新扫描所有威胁吗？
A:
Answer: Use Security Hub to centralize applicable findings and enable the required standards and account scope. The source services still perform detection.
Key point: The unified view aggregates security results and standard checks show control compliance. It does not turn PII scanning, vulnerability scanning, and behavior detection into the same task.
A_ZH:
答：用Security Hub集中管理相应发现，并启用所需安全标准及账户范围；源检测仍由对应服务执行。
考点：统一视图汇总安全结果，标准检查呈现控制是否满足要求；它不把PII扫描、漏洞扫描和行为检测变成同一种工作。
SOURCE: https://docs.aws.amazon.com/securityhub/latest/userguide/what-is-securityhub.html

## aws-rb2-20261107-pack-new01 | d1
TOPIC: Root MFA with backup devices / Root多设备MFA
Q:
Root already has a strong unique password. How can you prevent takeover with only a leaked password and reduce the risk of losing one verification device?
Q_ZH:
root已经使用强而唯一的密码，还应怎样防止仅凭泄露密码就接管账户，并降低一个验证设备丢失带来的风险？
A:
Answer: Enable root MFA and preregister more than one protected MFA device as backups.
Key point: MFA requires a factor beyond the password. Another registered device remains usable if one is lost. An ordinary administrator's permissions cannot directly replace root sign-in.
A_ZH:
答：给root启用MFA，并预先登记不止一个受保护的MFA设备作为备用。
考点：MFA要求除密码外的验证因素；一个设备丢失时可用已登记的另一设备。普通管理员账户的权限不能直接替代root登录。
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html

## aws-rb2-20261107-pack-new02 | d2
TOPIC: Certificate validation and renewal / 证书验证与续期
Q:
How does an ACM certificate use DNS to prove domain control and renew automatically? Can ACM also renew an imported external-CA certificate, and why?
Q_ZH:
ACM证书怎样用DNS证明域名归属并自动续期？导入的外部CA证书也能由ACM自动续领吗，为什么？
A:
Answer: For ACM-issued certificates, add the supplied CNAME to DNS, retain it, and meet renewal conditions such as certificate use. Renew imported certificates with the external CA and reimport them.
Key point: The CNAME proves domain control for subsequent ACM renewal validation. ACM cannot issue a new certificate on an external CA's behalf; an expiry reminder is not renewal.
Watch out: An already issued email-validated certificate cannot be directly switched to DNS validation; request a new certificate.
A_ZH:
答：ACM签发的证书把提供的CNAME加入域名DNS，保留记录并满足证书在用等续期条件；导入证书仍须向外部CA续领后重新导入。
考点：CNAME是域名控制权证明，可供ACM后续验证续期；ACM不能代替外部CA签发新证书，到期提醒也不等于续领。
易错提醒：已用邮件验证签发的证书不能直接切成DNS验证，需重新申请。
SOURCE: https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html

## aws-rb2-20261107-pack-new03 | d2
TOPIC: Explicit denial with NACLs / NACL明确拒绝
Q:
A public ALB receives traffic from a few known malicious IPs. Are security groups sufficient to explicitly deny those IPs at the network layer, and where should the rule go?
Q_ZH:
公网ALB遭少数已知恶意IP访问。要在网络层明确拒绝这些地址，安全组够吗，应在哪里设置？
A:
Answer: Security groups have only allow rules. Add source-IP deny rules to the NACLs of the ALB entry subnets.
Key point: NACLs evaluate rule numbers in ascending order and apply the first matching allow or deny. Place denials before rules that would otherwise allow that traffic.
A_ZH:
答：安全组只有允许规则；可在ALB所在入口子网的NACL设置针对这些来源IP的拒绝规则。
考点：NACL在子网边界按规则号从小到大匹配，先匹配的允许或拒绝规则生效；拒绝规则须排在会先放行这些流量的规则前。
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html

## aws-rb2-20261107-pack-new05 | d2
TOPIC: Explicit Deny precedence / 显式Deny优先
Q:
One policy allows ec2:* and another explicitly denies ec2:TerminateInstances; resources and conditions in both apply. Can another Allow for termination enable it?
Q_ZH:
一条策略允许ec2:*，另一条明确拒绝ec2:TerminateInstances；两条的资源和条件都适用。再加一条允许终止的策略，就能终止实例吗？
A:
Answer: No. The explicit Deny matching this termination request wins; another Allow does not remove it.
Key point: The Action wildcard matches any characters at that position, so ec2:* already includes termination. Policies do not overwrite by order. Find statements matching the action, resource, and conditions; a nonmatching Deny does not affect this request.
A_ZH:
答：不能。匹配当前终止请求的显式Deny优先，增加Allow不会解除它。
考点：Action中的*匹配该位置任意字符，因此ec2:*已包含终止动作；策略不是按先后顺序覆盖。须先按当前动作、资源和条件找适用声明，不匹配的Deny不参与这次判断。
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html

## aws-rb2-20261107-pack-sc01 | d2
TOPIC: Resource and key authorization / 资源与密钥授权
Q:
An execution identity can read an encrypted resource. Why might access still fail, and what must be checked even if IAM allows KMS?
Q_ZH:
运行身份已有读取加密资源的权限，为什么仍可能被拒绝？即使IAM策略写了KMS Allow，还要检查什么？
A:
Answer: Check that the actual key-using identity is authorized for the required KMS operations. IAM Allow also requires the key policy to permit that authorization method.
Key point: Resource authorization and key authorization are separate checks. A key policy can grant access directly or enable IAM-based authorization. Without the latter, adding only an IAM Allow is ineffective.
Watch out: Sharing objects or snapshots does not automatically share KMS-key permissions.
A_ZH:
答：检查实际用钥身份是否获准执行所需KMS操作；IAM Allow还需要该key的key policy允许这种授权方式。
考点：资源授权与用钥授权是两道检查。key policy可直接授权，也可允许IAM策略参与授权；未开放后者时，单加IAM Allow无效。
易错提醒：共享对象或快照不会自动共享其KMS key权限。
SOURCE: https://docs.aws.amazon.com/kms/latest/developerguide/key-policies.html

## aws-rb2-20261107-pack-xa003 | d2
TOPIC: Self-managed AD and SSO / 自管AD与SSO
Q:
Staff remain in on-premises self-managed AD but need Identity Center cross-account SSO. How can the directory connect, and which trust direction is needed if using AWS Managed Microsoft AD?
Q_ZH:
人员继续在本地自管AD维护，又要用Identity Center跨账户SSO。如何连接原目录？如果经过AWS Managed Microsoft AD，信任应是什么方向？
A:
Answer: Bridge the existing AD with AD Connector; if connecting through AWS Managed Microsoft AD, establish a two-way forest trust.
Key point: AD Connector forwards directory requests to the original AD. One trust direction serves authentication and the other lets Identity Center read user and group information.
Watch out: AD Connector sees only its connected single domain; use the Managed Microsoft AD path for multiple domains or forests.
A_ZH:
答：可用AD Connector桥接原AD；若经AWS Managed Microsoft AD连接原目录，建立双向林信任。
考点：AD Connector把目录请求转回原AD；双向信任一边用于身份验证，另一边让Identity Center读取用户和组信息。
易错提醒：AD Connector只看到所连接的单个域；需要多域或多林时采用Managed Microsoft AD路径。
SOURCE: https://docs.aws.amazon.com/singlesignon/latest/userguide/connectonpremad.html

## aws-rb2-20261107-pack-xa004 | d2
TOPIC: Cross-Region client-side decryption / 跨Region客户端解密
Q:
An application encrypts client-side in two Regions and must decrypt ciphertext directly in the other Region without calling the original Region or reencrypting under a different key. Which KMS keys fit?
Q_ZH:
应用在两个Region做客户端加密，密文要在另一Region直接解密，不想回调原Region或换钥重加密。怎样选KMS key？
A:
Answer: Deploy related KMS multi-Region keys in both Regions.
Key point: Related primary and replica keys share key material and key ID, allowing ciphertext from one Region to be decrypted with its related key in another.
Watch out: Key policies remain independently managed by Region. S3 server-side cross-Region replication still reencrypts using the destination Region's key; shared material does not skip that step.
A_ZH:
答：在两个Region部署同一组相关的KMS multi-Region keys。
考点：相关主密钥与副本共享密钥材料和key ID，所以一地加密的密文可在另一地用相关key解密。
易错提醒：各Region的key策略仍分别管理；S3服务端跨Region复制仍会按目标Region的key重加密，不能据材料相同推断其跳过该步骤。
SOURCE: https://docs.aws.amazon.com/kms/latest/developerguide/multi-region-keys-overview.html

## aws-rb2-20261107-pack-xa005 | d2
TOPIC: Certificate expiry notifications / 证书临期通知
Q:
An ALB uses an imported ACM certificate and needs a warning 30 days early. How can ACM events and Config evaluations each trigger it? Does the warning renew the certificate?
Q_ZH:
ALB使用导入ACM的证书，要提前30天通知。ACM事件和Config评估分别怎样触发提醒，提醒会自动续期吗？
A:
Answer: Filter ACM approaching-expiry events by DaysToExpiry at 30 days, or set the Config certificate-expiry rule to a 30-day threshold; connect the notification chain through EventBridge. Neither renews with the external CA.
Key point: ACM emits approaching-expiry events for active imported certificates; Config evaluates the threshold. These generate reminder signals; obtaining and reimporting a certificate is a separate action.
A_ZH:
答：可用ACM临近到期事件按DaysToExpiry筛到30天，或用Config证书到期规则设30天阈值；经EventBridge接通知链。两者都不会代外部CA续期。
考点：ACM发布活动导入证书的临期事件，Config按阈值评估是否到期；它们产生提醒信号，取得新证书并重新导入是另一项动作。
SOURCE: https://docs.aws.amazon.com/acm/latest/userguide/supported-events.html

## aws-rb2-20261107-pack-xa006 | d2
TOPIC: Negated SourceIp conditions / SourceIp否定条件
Q:
An Allow matches EC2 termination. A Deny uses NotIpAddress on aws:SourceIp with two allowed network ranges. The request comes from neither range. What happens, and why?
Q_ZH:
终止EC2的Allow已匹配；另有Deny，条件为NotIpAddress、aws:SourceIp列出两个允许网段。请求来自两个网段之外，会怎样，为什么？
A:
Answer: The request is denied.
Key point: aws:SourceIp checks the requester's IP, not the terminated instance's. NotIpAddress matches when the source is outside every listed range; the matching explicit Deny overrides Allow.
Watch out: ec2:Region checks the target Region. StringNotEquals:us-east-1 matches other Regions; this differs from the requester's source IP.
A_ZH:
答：会被Deny拒绝。
考点：aws:SourceIp检查请求者来源IP，不是被终止实例的IP；NotIpAddress在来源不属于任一列出网段时匹配，匹配的显式Deny覆盖Allow。
易错提醒：ec2:Region检查请求目标Region；StringNotEquals:us-east-1只在其他Region匹配。它与请求者来源IP是两种条件。
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html

## aws-rb2-20261107-pack-xa007 | d2
TOPIC: Cross-account WAF management / 跨账户WAF管理
Q:
REST APIs across multiple accounts and Regions need continuous application of the same WAF protections. How can you avoid manually copying and maintaining them in each account?
Q_ZH:
多个账户、多个Region的REST API都要持续应用同一套WAF防护，怎样避免各账户手工复制维护？
A:
Answer: Use Firewall Manager to manage WAF policies centrally, configuring protection scope in the involved Regions.
Key point: It applies central policies to scoped accounts and resources, including newly added eligible resources. WAF still inspects individual HTTP requests.
A_ZH:
答：使用Firewall Manager集中管理WAF策略，并在涉及的Region配置保护范围。
考点：它把中央策略应用到范围内的账户和资源，新加入的适用资源也会获得保护；WAF仍负责检查具体HTTP请求。
SOURCE: https://docs.aws.amazon.com/waf/latest/developerguide/fms-chapter.html

## aws-rb2-20261107-pack-xa008 | d1
TOPIC: Account contacts / 账户联系人
Q:
Important AWS account email must survive staff departures, while billing, operations, and security messages should reach responsible teams. How should contacts be arranged?
Q_ZH:
AWS账户重要邮件不能因一人离职而漏接，还要按账单、运维、安全类别送给负责团队。联系人怎样安排？
A:
Answer: Use a controlled administrator distribution list for each account's root email; set billing, operations, and security alternate contacts to their respective team lists.
Key point: Root email maintains continuity for account-owner messages. Alternate contacts route category-specific notices to teams and do not replace root-email maintenance.
A_ZH:
答：每个账户的root邮箱使用受控管理员分发列表；再分别设置billing、operations、security备用联系人为对应团队列表。
考点：root邮箱保障账户负责人持续收信；备用联系人把相应类别通知送到职责团队，不能代替维护root邮箱。
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html

## aws-rb2-20261107-pack-xa011 | d2
TOPIC: Field-level encryption / 字段级加密
Q:
Users submit sensitive forms through CloudFront. Beyond HTTPS, selected fields must remain ciphertext through intermediate applications and be readable only by a designated downstream application. What fits?
Q_ZH:
用户经CloudFront提交敏感表单，HTTPS之外还要求经过中间应用时字段仍是密文，只有指定下游应用可读。选什么？
A:
Answer: Configure CloudFront field-level encryption to encrypt the selected form fields at the edge.
Key point: CloudFront encrypts selected fields with a public key. They remain ciphertext through subsequent applications; only an application holding the corresponding private key can decrypt them.
Watch out: HTTPS protects connections and CloudFront signed URLs control content requests; neither keeps downstream fields encrypted.
A_ZH:
答：配置CloudFront field-level encryption，对指定表单字段在边缘加密。
考点：CloudFront用公钥加密选定字段，数据经过后续应用时仍为密文；只有持对应私钥的应用能解密。
易错提醒：HTTPS保护连接；CloudFront签名URL控制谁能请求内容，均不让下游字段持续保持密文。
SOURCE: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/field-level-encryption.html

## aws-rb2-20261107-pack-xa014 | d1
TOPIC: IAM password policy / IAM密码策略
Q:
All IAM users in one account need uniform console-password complexity and expiry. At which level is the policy configured?
Q_ZH:
一个账户内所有IAM用户的控制台密码，都必须满足统一复杂度和到期周期。策略设在哪一级？
A:
Answer: Set the AWS account's IAM password policy.
Key point: The account password policy applies uniformly to IAM-user passwords, without separate complexity rules per user.
Watch out: It does not govern the root password or invalidate IAM access keys when passwords expire.
A_ZH:
答：设置该AWS账户的IAM password policy。
考点：账户密码策略统一作用于IAM用户密码，不必逐用户另建复杂度规则。
易错提醒：它不管root密码，也不让IAM access key随密码到期而失效。
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_passwords_account-policy.html

## aws-rb2-20261107-pack-xa015 | d2
TOPIC: CloudFormation service roles / CloudFormation服务角色
Q:
A deployment engineer should operate only specified stacks without directly receiving permissions to create EC2 and other resources. How can CloudFormation deploy them?
Q_ZH:
部署工程师只应操作指定堆栈，创建EC2等资源的权限不想直接交给他。CloudFormation怎样完成部署？
A:
Answer: Give the engineer required stack-operation permissions and let the stack use a CloudFormation service role limited to required resource actions. Initially specifying the role requires the corresponding iam:PassRole permission.
Key point: The engineer initiates stack operations; CloudFormation assumes the service role to create resources. The identities can have different permissions without granting the engineer AdministratorAccess.
A_ZH:
答：给工程师所需的堆栈操作权限，并让堆栈使用仅含所需资源动作的CloudFormation service role；首次指定角色需有相应iam:PassRole。
考点：工程师发起堆栈操作，CloudFormation代入服务角色创建实际资源；两种身份可拥有不同权限，不必给工程师AdministratorAccess。
SOURCE: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-servicerole.html

## aws-rb2-20261107-pack-xa017 | d2
TOPIC: BoolIfExists and action scope / BoolIfExists与动作范围
Q:
A policy denies StopInstances and TerminateInstances when BoolIfExists tests aws:MultiFactorAuthPresent=false. If that field is false or absent, which actions are denied, and why?
Q_ZH:
策略对StopInstances和TerminateInstances设Deny，条件是BoolIfExists检查aws:MultiFactorAuthPresent=false。MFA字段为false或根本缺失时，会拒绝哪些动作，为什么？
A:
Answer: Both cases match the Deny, but only its listed stop and terminate actions are denied.
Key point: BoolIfExists matches a missing field; when present, its value must be false. The Deny's effect remains limited by Action and does not automatically cover every EC2 operation.
A_ZH:
答：两种情况都匹配这条Deny，但只拒绝声明列出的停止和终止动作。
考点：BoolIfExists使字段缺失也匹配条件；字段存在时再检查是否为false。Deny的影响仍受Action范围限制，不会自动覆盖全部EC2操作。
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html

## aws-rb2-20261107-pack-xa018 | d2
TOPIC: Lake Formation tag authorization / Lake Formation标签授权
Q:
Lake Formation tables are growing. How can an engineering team receive cross-account access to data with a certain category of tags without table-by-table grants, and why?
Q_ZH:
Lake Formation里的表越来越多，要把符合某类标签的数据跨账户授权给工程团队，怎样避免逐表授权，为什么？
A:
Answer: Use Lake Formation tag-based access control (LF-TBAC): attach LF-Tags to Data Catalog resources and grant cross-account permissions by tag values.
Key point: Permissions follow resource-tag matches. Correctly tagging new tables lets the same rule manage them, reducing individual grants.
Watch out: LF-Tags are Lake Formation permission tags; ordinary IAM tags are not interchangeable with them.
A_ZH:
答：使用Lake Formation tag-based access control（LF-TBAC），给数据目录资源贴LF-Tag，按标签值授予跨账户权限。
考点：授权跟随资源标签匹配；同类新表正确标记后可按同一规则管理，减少逐表维护。
易错提醒：LF-Tag是Lake Formation权限标签，不能直接拿普通IAM标签当作它。
SOURCE: https://docs.aws.amazon.com/lake-formation/latest/dg/tag-based-access-control.html

## aws-rb2-20261107-pack-xa020 | d2
TOPIC: Controlled self-service provisioning / 受控自助开通
Q:
Developers need to provision company-approved databases and tools themselves, using only permitted configurations. How can central management and self-service coexist, and why?
Q_ZH:
开发者要自己开通公司批准的数据库等工具，但只能使用限定配置。怎样兼顾中央管理和自助部署，为什么？
A:
Answer: Publish approved configurations as Service Catalog products, expose the appropriate portfolio to developers, and set provisioning constraints.
Key point: Administrators manage provisionable products and configuration boundaries; users launch from the authorized catalog. Merely supplying template files does not centrally manage available products.
A_ZH:
答：把批准配置发布为Service Catalog产品，向开发者开放相应portfolio，并设置开通约束。
考点：管理员维护可开通的产品和配置边界，用户从授权目录自助启动；只给模板文件不等于集中管理可用产品。
SOURCE: https://docs.aws.amazon.com/servicecatalog/latest/adminguide/introduction.html

## aws-rb2-20261107-pack-xa021 | d2
TOPIC: EKS control-plane encryption / EKS控制平面加密
Q:
Sensitive values are in Kubernetes Secrets on EKS. To protect control-plane etcd data, which encryption layer matters? Is encrypting EBS or keeping another copy in Secrets Manager enough, and why?
Q_ZH:
EKS中敏感值已写进Kubernetes Secret，目标是保护控制平面etcd里的数据。应检查哪一层加密，改EBS卷或把另一份值放Secrets Manager够吗，为什么？
A:
Answer: Check KMS envelope encryption for EKS Kubernetes API data. EKS 1.28 and later provide it by default; use a customer managed KMS key as needed.
Key point: The API server encrypts data before storing it in etcd, and KMS protects the data key. Node EBS encryption or an external secret store is not this control-plane protection.
A_ZH:
答：检查EKS Kubernetes API数据的KMS封套加密；EKS 1.28及以上已默认提供，可按需要使用客户管理KMS key。
考点：API服务器先加密数据再存etcd，数据密钥又由KMS key保护；节点EBS加密或外部秘密库不是控制平面etcd的这层保护。
SOURCE: https://docs.aws.amazon.com/eks/latest/userguide/envelope-encryption.html

## aws-rb2-20261107-pack-xa023 | d2
TOPIC: Control Tower drift / Control Tower漂移
Q:
In a Control Tower-managed environment, governance relationships change, such as an account moving OUs. How can operations detect and receive alerts with little maintenance, and why?
Q_ZH:
Control Tower纳管环境中，账户被移到其他OU等治理关系发生变化，需要少维护地发现并提醒运维。应使用什么能力，为什么？
A:
Answer: Use Control Tower drift detection and subscribe to applicable drift notifications.
Key point: Control Tower checks deviations in managed governance state, including account drift from moves. CloudFormation drift compares stack resources and does not automatically cover organization-wide governance relationships.
Watch out: Notifications depend on configuration; documented account SNS drift notifications are unavailable when account auto-enroll is enabled.
A_ZH:
答：使用Control Tower drift detection，并订阅适用的漂移通知。
考点：Control Tower检查纳管治理状态的偏离，账户移动等变化可成为account drift；CloudFormation drift只比较堆栈资源，不自动覆盖整套组织治理关系。
易错提醒：具体通知随配置而变；启用账户auto-enroll时，文档所列账户SNS漂移通知不可用。
SOURCE: https://docs.aws.amazon.com/controltower/latest/userguide/drift.html

## aws-rb2-20261107-pack-xa025 | d2
TOPIC: Moving between organizations / 组织迁移
Q:
An existing subsidiary AWS account must move to another organization while retaining its resources. Can it belong to both during transition? What order applies, and why?
Q_ZH:
子公司现有AWS账户要迁入另一组织，并保留账户内资源。能同时加入两个组织过渡吗，应按什么顺序，为什么？
A:
Answer: No. Leave the original organization before accepting the new management account's invitation.
Key point: An account belongs to only one Organizations organization at a time. Changing membership does not require creating a new account and moving all resources.
A_ZH:
答：不能；先退出原组织，再接受新组织管理账户的邀请。
考点：一个账户同一时间只能属于一个Organizations组织；迁成员资格不等于必须新建账户搬全部资源。
SOURCE: https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_accounts_invites.html

## aws-rb2-20261107-pack-xa026 | d2
TOPIC: Corporate directory federation / 企业目录联合身份
Q:
Staff must sign into AWS through the corporate directory without new IAM users. How do temporary-identity paths differ for an existing SAML 2.0 IdP versus an LDAP directory without SAML support, and why?
Q_ZH:
员工要沿用企业目录登录AWS，不另建IAM用户。已有SAML 2.0身份提供商与只有不兼容SAML的LDAP目录时，临时身份的桥接路径有什么不同，为什么？
A:
Answer: Use SAML federation mapped to authorized IAM roles for the former. For the latter, a custom identity broker can authenticate against LDAP and obtain temporary STS credentials.
Key point: The corporate directory still authenticates staff; AWS grants access through restricted roles or temporary credentials, not by turning corporate passwords into long-term AWS access keys.
A_ZH:
答：前者建立SAML federation并映射到授权IAM角色；后者可由自建identity broker先验证LDAP身份，再向STS取得临时凭证。
考点：企业目录仍验证员工；AWS端用受限角色或临时凭证授予访问，而不是把企业密码变成长期AWS access key。
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_common-scenarios_federated-users.html

## aws-rb2-20261107-pack-xa027 | d2
TOPIC: Wildcard certificate scope / 通配符证书范围
Q:
A website serves example.com, cn.example.com, and nz.example.com. Is *.example.com alone sufficient on its certificate, and why?
Q_ZH:
网站要同时支持example.com、cn.example.com和nz.example.com。证书只写*.example.com够吗，为什么？
A:
Answer: No. Include both example.com and *.example.com.
Key point: The wildcard covers only that subdomain level, not the apex or deeper names such as test.cn.example.com. One certificate can list multiple names.
A_ZH:
答：不够；证书须同时包含example.com和*.example.com。
考点：通配符只覆盖这一层子域，不覆盖根域，也不覆盖test.cn.example.com这样的更深一层；同一证书可列多个名称。
SOURCE: https://docs.aws.amazon.com/acm/latest/userguide/acm-public-certificates.html

## aws-rb2-20261107-pack-xa028 | d2
TOPIC: ACM public certificate charges / ACM公有证书费用
Q:
Public browsers use an ALB or CloudFront custom domain. Which ACM certificate avoids additional certificate charges, and why?
Q_ZH:
公众浏览器访问ALB或CloudFront自定义域名，要用ACM证书且不增加证书费用，应选哪类证书，为什么？
A:
Answer: Choose an ACM non-exportable public certificate for use with integrated AWS services.
Key point: A public certificate is issued by a publicly trusted CA for public domains. This non-exportable integrated-service certificate has no additional certificate charge; that pricing does not extend to exportable certificates or Private CA.
A_ZH:
答：选择供集成AWS服务使用的ACM non-exportable public certificate。
考点：public certificate由公信CA签发供公网域名使用；这一非导出型集成服务证书没有额外证书费用，不能把价格套到可导出证书或Private CA。
SOURCE: https://docs.aws.amazon.com/acm/latest/userguide/acm-concepts.html

## aws-rb2-20261107-pack-xa029 | d2
TOPIC: KMS external key stores / KMS外部密钥库
Q:
Regulations require actual cryptographic keys to remain in an on-premises third-party key manager while integrating encryption and decryption with KMS. Which key store fits, and why?
Q_ZH:
法规要求实际密码密钥始终留在本地第三方密钥管理器，还要让AWS KMS衔接加解密。选哪类key store，为什么？
A:
Answer: Use a KMS external key store, with the external key manager retaining and using the actual keys.
Key point: KMS delegates cryptographic operations through the XKS proxy and cannot read, create, or delete those external keys. This differs from importing material into AWS.
Watch out: External manager or connectivity failures affect key availability; you operate that path.
A_ZH:
答：使用KMS external key store，由外部key manager保留并使用实际密钥。
考点：KMS经XKS proxy把密码操作交给外部管理器，不能读取、创建或删除其中的外部密钥；这不同于把材料导入AWS。
易错提醒：外部管理器或连接不可用会影响用钥可用性，需要自行承担这条路径的运维。
SOURCE: https://docs.aws.amazon.com/kms/latest/developerguide/keystore-external.html

## aws-rb2-20261107-pack-xa030 | d2
TOPIC: Shared CIDR lists / 共享CIDR清单
Q:
Office CIDRs change often, requiring security-group updates across accounts. Only a centrally maintained address list is needed. How can maintenance and extra governance-service charges be reduced?
Q_ZH:
全球办公室的CIDR经常变化，多账户安全组都要跟着更新。只需集中维护地址清单，怎样减少维护和额外治理服务费用？
A:
Answer: Create a customer-managed prefix list, share it through AWS RAM, and reference it from the security groups.
Key point: The prefix list centrally stores reusable CIDRs. After central updates, groups use the same new list; RAM cross-account sharing adds no sharing fee.
Watch out: Firewall Manager offers broader security-group governance but has per-Region policy charges and related Config costs. CIDR synchronization alone does not require it.
A_ZH:
答：建立customer-managed prefix list，经AWS RAM共享给相关账户；各安全组引用这份列表。
考点：prefix list集中保存可引用的CIDR集合，中央更新后各安全组使用同一新清单；AWS RAM跨账户共享没有额外共享费用。
易错提醒：Firewall Manager能做更完整的安全组治理，但其安全组策略有按Region的策略费和相关Config费用；只需同步CIDR时不必引入这套治理。
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/managed-prefix-lists.html

## aws-rb2-20261107-pack-xa032 | d2
TOPIC: Requiring tags to exist / 强制标签存在
Q:
EC2 must have Sensitivity=sensitive or nonsensitive, and users must not delete that tag. Is an Organizations tag policy alone enough, and why?
Q_ZH:
EC2必须有Sensitivity标签，值只能是sensitive或nonsensitive，而且用户不能删除它。只启用Organizations tag policy够吗，为什么？
A:
Answer: No. Use the tag policy for allowed values on supported resources, plus SCP restrictions on creation without the tag and on deleting it.
Key point: Tag policies validate submitted tags but do not evaluate untagged resources. Denying the relevant requests with SCPs covers missing-tag creation and deletion.
A_ZH:
答：不够；tag policy规范受支持资源的标签值，再用SCP限制缺标签的创建请求与删除该标签的操作。
考点：tag policy校验已提交标签的合规值，不评估未标记资源；SCP在相应请求发生时拒绝，才能补上缺失和删除这两个入口。
SOURCE: https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_tag-policies.html

## aws-rb2-20261107-pack-xa033 | d2
TOPIC: MSK public access and mTLS / MSK公网与mTLS
Q:
MSK Provisioned already meets public-subnet routing and security-group requirements. Internet clients need certificate authentication and encrypted connections. What else must be configured at the cluster entry, and why?
Q_ZH:
MSK Provisioned已满足公有子网路由和安全组条件。互联网客户要用证书验证身份并加密连接，集群入口还应怎样设置，为什么？
A:
Answer: Enable public access after cluster creation, and use mTLS authentication with TLS encryption.
Key point: Public access exposes public broker endpoints; mTLS authenticates clients with certificates and TLS protects connections. Public-subnet connectivity alone does not enable the MSK public entry.
A_ZH:
答：在集群创建后启用public access，并使用mTLS认证及TLS加密。
考点：public access提供公网broker入口；mTLS用客户端证书向MSK验证身份，TLS保护连接。只有公有子网路径，不会自动打开MSK公网入口。
SOURCE: https://docs.aws.amazon.com/msk/latest/developerguide/public-access.html

## aws-rb2-20261107-pack-xa035 | d1
TOPIC: Root usage boundaries / Root使用边界
Q:
Should daily administration of a new AWS account use root? How can necessary root capability be retained while reducing credential exposure, and why?
Q_ZH:
新AWS账户的日常管理工作，应直接使用root吗？如何保留必要root能力又降低凭据暴露，为什么？
A:
Answer: Use workforce identities with appropriate permissions for daily work. Reserve root for tasks requiring it and protect its sign-in credentials.
Key point: Root spans the entire account. Frequent routine use repeatedly exposes these powerful credentials; ordinary administration can be delegated to controlled identities.
A_ZH:
答：日常使用获授适当权限的人员身份；root仅用于确需root的任务，并保护其登录凭据。
考点：root权限覆盖整个账户，频繁日常使用会不断暴露这套高权限凭据；普通管理权限可授给受控身份，不必用root执行。
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html

## aws-rb2-20261107-pack-xa037 | d2
TOPIC: Sharing AMIs by OU / AMI按OU共享
Q:
Only accounts in the development OU may launch a company-approved AMI, not the whole organization. How should its sharing scope be set, and why?
Q_ZH:
公司批准的AMI只应给开发OU中的账户启动，不能让整个组织都用。应怎样设定共享范围，为什么？
A:
Answer: Add the development OU ARN to the AMI launch permissions.
Key point: AMI launch access can be granted by OU. The target OU defines scope; the organization root or organization-wide scope would include other accounts.
Watch out: Sharing an encrypted AMI for launch does not automatically grant access to the snapshot's KMS key.
A_ZH:
答：把开发OU的ARN加入AMI launch permissions。
考点：AMI支持按OU授予启动使用权，范围随目标OU确定；把组织根或全组织作为范围会把其他账户也包括进来。
易错提醒：加密AMI的启动共享不自动授予快照KMS key的使用权限。
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/share-amis-with-organizations-and-OUs.html

## aws-rb2-20261107-pack-xa038 | d2
TOPIC: EFS read-only IAM enforcement / EFS只读IAM限制
Q:
An EC2 application may only read EFS reference data; IAM must prevent changes and deletion. It already uses the EFS mount helper and IAM authentication. What restriction applies, and why?
Q_ZH:
EC2应用只准读取EFS参考数据，必须由IAM阻止它改写或删除。已使用EFS mount helper及IAM认证，应怎样限制，为什么？
A:
Answer: Explicitly deny elasticfilesystem:ClientWrite to the application role in the EFS filesystem resource policy.
Key point: ClientWrite is the EFS client's write permission. Denial prevents file-data modification through this IAM authorization path; a client-selected read-only mount is not a server-side IAM restriction.
A_ZH:
答：在EFS文件系统资源策略中，对应用角色明确拒绝elasticfilesystem:ClientWrite。
考点：ClientWrite是EFS客户端写权限；拒绝它使应用不能通过这条IAM授权路径修改文件数据，客户端自行选择只读挂载不是服务端IAM限制。
SOURCE: https://docs.aws.amazon.com/efs/latest/ug/iam-access-control-nfs-efs.html

## aws-rb2-20261107-pack-xa039 | d2
TOPIC: Proactive deployment controls / 部署前主动控制
Q:
In Control Tower, resource configuration must be checked before CloudFormation creation and noncompliant deployment blocked. Which control fits, and why not a later Config alert?
Q_ZH:
Control Tower环境中，要在CloudFormation创建资源前检查配置，不合规就阻止部署。应选哪种control，为什么不是事后Config告警？
A:
Answer: Enable the applicable proactive control.
Key point: Its CloudFormation hook checks targeted resources before creation or update. Detective controls or Config evaluations examine existing configuration and cannot guarantee predeployment blocking.
Watch out: These hooks check CloudFormation operations; do not infer they block all direct service API calls.
A_ZH:
答：启用对应的proactive control。
考点：它通过CloudFormation hook在创建或更新前检查目标资源；detective control或Config评估发现的是已存在配置，不能据此保证部署前阻止。
易错提醒：这类hook检查CloudFormation操作，不应推断能拦住所有直接服务API调用。
SOURCE: https://docs.aws.amazon.com/controltower/latest/controlreference/proactive-controls.html

## aws-rb2-20261107-pack-xa040 | d2
TOPIC: Isolating Lambda environment values / Lambda环境值隔离
Q:
Lambda needs a sensitive environment value. Developers may view configuration but must not see plaintext. How can the function use it while developers cannot decrypt it, and why?
Q_ZH:
Lambda需要使用环境变量中的敏感值，开发者能查看配置却不应看到明文。怎样让函数可用、开发者不可解密，为什么？
A:
Answer: Use KMS and Lambda encryption helpers for client-side encryption. Function code decrypts; grant kms:Decrypt to the execution role, not developers.
Key point: Configuration holds ciphertext for application decryption. Configuration visibility and key use are separately controlled; default encryption at rest alone does not create that separation.
A_ZH:
答：用KMS和Lambda encryption helpers做客户端加密；函数代码解密，执行角色获kms:Decrypt，开发者不获该解密权限。
考点：配置中保存的是应用要解密的密文，谁能看配置与谁能用key分开控制；仅靠默认静态加密不会自动形成这条权限隔离。
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars-encryption.html

## aws-rb2-20261107-pack-xa041 | d2
TOPIC: Canceling KMS deletion / 取消KMS删除
Q:
A symmetric customer managed KMS key was mistakenly scheduled for deletion and its waiting period has not ended. What saves it? Can cancellation recover it after actual deletion, and why?
Q_ZH:
对称客户管理KMS key被误计划删除，等待期还未结束。应执行什么操作保住key，真正删除后还能靠取消找回吗，为什么？
A:
Answer: Run CancelKeyDeletion during the waiting period. After actual deletion, cancellation cannot recover it.
Key point: ScheduleKeyDeletion first places the key in pending deletion; destruction occurs after the waiting period. Cancellation applies to an existing key. After cancellation it is Disabled and needs EnableKey before reuse.
A_ZH:
答：等待期内执行CancelKeyDeletion；真正删除后不能再靠取消恢复。
考点：ScheduleKeyDeletion先把key置于待删除状态，等待期结束才销毁；取消针对尚存在的key。取消后key处于Disabled，恢复使用还需EnableKey。
SOURCE: https://docs.aws.amazon.com/kms/latest/APIReference/API_ScheduleKeyDeletion.html

## aws-rb2-20261107-pack-xa042 | d2
TOPIC: Cognito adaptive authentication / Cognito风险验证
Q:
An application needs extra verification for sign-in risks such as unusual IPs, devices, or locations. At which Cognito layer should risk be assessed and MFA required as configured, and why?
Q_ZH:
应用要根据异常IP、设备或地点等登录风险追加验证。应在Cognito哪一层评估风险并按配置要求MFA，为什么？
A:
Answer: Enable supported threat-protection adaptive authentication in the Cognito user pool and configure risk-based MFA requirements.
Key point: The user pool evaluates sign-in risk and applies challenges. An identity pool primarily exchanges identities for temporary AWS credentials, not customer sign-in risk validation.
Watch out: Once a user enables MFA, later sign-ins still require MFA challenges; low risk does not automatically cancel enabled MFA.
A_ZH:
答：在Cognito user pool启用支持的threat protection adaptive authentication，并按风险配置要求MFA。
考点：用户池评估本次登录风险，再执行对应挑战；identity pool主要换AWS临时凭证，不负责这种客户登录风险验证。
易错提醒：用户一旦启用MFA，后续登录仍要接受MFA挑战；不能理解为低风险会自动取消已启用的MFA。
SOURCE: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pool-settings-adaptive-authentication.html

## aws-rb2-20261107-pack-xa044 | d1
TOPIC: Managed-node inventory / 受管节点清单
Q:
Hundreds of managed EC2 instances need regular centralized information on installed software, versions, and system configuration. How can it be obtained, and why?
Q_ZH:
数百台受管EC2需要定期知道装了哪些软件和版本、哪些系统配置，怎样集中取得清单，为什么？
A:
Answer: Configure Systems Manager Inventory to collect managed-node metadata.
Key point: Inventory captures software versions and configuration to identify machines needing updates. It neither installs patches nor scans known vulnerabilities.
A_ZH:
答：配置Systems Manager Inventory收集受管节点的元数据。
考点：Inventory采集软件版本和配置，帮助找出需要更新的机器；它不是安装补丁或扫描已知漏洞的执行工具。
SOURCE: https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-inventory.html

## aws-rb2-20261107-pack-xa045 | d2
TOPIC: Cross-account storage metrics / 跨账户存储指标
Q:
S3 buckets span accounts and Regions. What should centrally summarize versioning status and incomplete multipart-upload counts instead of inspecting every API log?
Q_ZH:
组织在多个账户和Region都有S3桶，要集中看版本控制状态、未完成分块上传数量等指标。应汇总什么，而不是翻每条API日志？
A:
Answer: Use S3 Storage Lens metrics with the appropriate scope.
Key point: It aggregates storage and protection metrics by organization, account, Region, and bucket. CloudTrail operation records do not directly replace a current storage-state summary.
Watch out: Configure the level required by the metric; access-activity analysis differs from capacity or protection-configuration metrics.
A_ZH:
答：使用适用范围的S3 Storage Lens指标汇总。
考点：它按组织、账户、Region和桶汇总存储及保护等指标；CloudTrail操作记录不能直接代替当前存储状态汇总。
易错提醒：按指标所需级别配置汇总；访问活动分析与仅看容量或保护配置是不同指标用途。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage_lens.html

## aws-rb2-20261107-pack-xa047 | d2
TOPIC: Unified security data lake / 统一安全数据湖
Q:
Security logs and events come from multiple accounts, SaaS, and on-premises environments. What should first collect them into an analyzable unified data lake with little development, and why?
Q_ZH:
安全日志和事件来自多个账户、SaaS及本地环境，希望少开发地汇入统一可分析数据湖。应先选什么，为什么？
A:
Answer: Use Amazon Security Lake to collect security data from supported sources.
Key point: It centralizes security logs and events into an S3 data lake in your account and normalizes formats. Security Hub aggregates findings and control results, not this raw security-data collection layer.
A_ZH:
答：使用Amazon Security Lake收集受支持来源的安全数据。
考点：它把安全日志与事件集中到本账户的S3数据湖，并规范化数据格式；Security Hub汇总安全发现和控制结果，不能直接代替这层原始安全数据汇聚。
SOURCE: https://docs.aws.amazon.com/security-lake/latest/userguide/what-is-security-lake.html

## aws-rb2-20261107-pack-xa048 | d2
TOPIC: Unused-access analysis / 未用权限分析
Q:
To review whether organization IAM users and roles retain long-unused permissions, choose permission analysis or software vulnerability scanning, and why?
Q_ZH:
要审查组织中IAM用户和角色是否长期拥有未使用的权限，应选权限分析还是软件漏洞扫描，为什么？
A:
Answer: Use IAM Access Analyzer unused access analysis, then reduce permissions according to actual needs.
Key point: It identifies unused access for IAM identities to support least-privilege reviews. Inspector analyzes software vulnerabilities, not whether IAM permissions are used.
Watch out: Unused access is a review lead, not proof it will never be needed; verify actual responsibilities before changes.
A_ZH:
答：使用IAM Access Analyzer的unused access analysis，再据实际需要收敛权限。
考点：它识别IAM身份未使用的访问权，帮助最小权限审查；Inspector分析软件漏洞，不负责判断IAM权限是否用得上。
易错提醒：未使用是审查线索，不是自动证明业务永远不需要；修改前仍要核实真实职责。
SOURCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/what-is-access-analyzer.html

## aws-rb2-20261107-pack-xa049 | d2
TOPIC: Cross-account SNS invocation / 跨账户SNS调用
Q:
Account A's SNS topic must invoke account B's Lambda. Where are subscription-creation permission and subsequent function-invocation permission granted, and why?
Q_ZH:
账户A的SNS主题要调用账户B的Lambda。创建订阅的权限，和消息到达后调用函数的权限，分别在哪一侧授权，为什么？
A:
Answer: A's topic resource policy permits B's subscribing identity to subscribe; B's function resource policy permits the SNS service to invoke it from that topic.
Key point: Subscription registers delivery with the topic; delivery is SNS calling Lambda. These requests target different resources and use different identities. Giving the function execution role resource-read permission is insufficient.
A_ZH:
答：A的主题资源策略允许B的订阅创建身份订阅；B的函数资源策略允许SNS服务从该主题调用函数。
考点：订阅是有人向主题登记投递关系，投递时则是SNS调用Lambda；这两个请求的目标和调用身份不同，不能只给函数执行角色读资源的权限。
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/with-sns-example.html

## aws-rb2-20261107-pack-xa051 | d2
TOPIC: EMR job identity / EMR作业身份
Q:
Teams share an EMR cluster supporting runtime roles. Jobs need isolated permissions and must not obtain host permissions through instance metadata. How should jobs be submitted, and why?
Q_ZH:
多个团队共用支持runtime role的EMR集群，作业权限要各自隔离，也不能借节点元数据拿到整机权限。应怎样提交作业，为什么？
A:
Answer: Enable EMR runtime roles, grant restricted roles per team, and specify the appropriate runtime role at job submission.
Key point: Jobs access AWS resources as their specified role instead of sharing the EC2 instance role. Jobs in this mode cannot access cluster EC2 IMDS or borrow its instance profile.
A_ZH:
答：启用EMR runtime roles，为各团队授受限角色，并在提交作业时指定对应runtime role。
考点：作业以指定角色访问AWS资源，而不是共享EC2实例角色；此模式的作业不能访问集群EC2的Instance Metadata Service或借用其instance profile。
SOURCE: https://docs.aws.amazon.com/emr/latest/ManagementGuide/emr-steps-runtime-roles.html

## aws-rb2-20261107-pack-xa053 | d2
TOPIC: API source-IP admission / API来源IP准入
Q:
An API needs source-IP admission. How do REST API resource policies and HTTP API Lambda authorizers implement it? Can the configuration be copied directly?
Q_ZH:
API要按来源IP准入。REST API资源策略，与HTTP API的Lambda authorizer，应怎样落实，能直接照搬配置吗？
A:
Answer: REST APIs can use an applicable resource policy. HTTP APIs do not support that policy; a Lambda authorizer can judge the source IP in request context. Do not copy the REST policy directly.
Key point: Match the mechanism the API product actually supports. HTTP APIs usually have lower per-request prices but must meet required capabilities. HTTP authorizer 2.0 events expose requestContext.http.sourceIp; trust API context, not client-supplied IP headers.
Watch out: If results differ by IP, do not reuse authorization caching across IPs; setting authorizer TTL to zero reevaluates every request.
A_ZH:
答：REST API可用适用resource policy；HTTP API不支持这项策略，但可让Lambda authorizer用请求上下文来源IP判断是否允许。不能直接照搬REST策略。
考点：先匹配API产品实际支持的准入机制；HTTP API通常请求单价较低，但能力须够用。HTTP authorizer的2.0事件可读取requestContext.http.sourceIp，应使用API上下文，而非信任客户端自填IP请求头。
易错提醒：若不同IP应有不同结果，不能把同一授权缓存跨IP复用；可将authorizer缓存TTL设0，每次重新判断。
SOURCE: https://aws.amazon.com/api-gateway/pricing/

## aws-rb2-20261107-pack-xa054 | d2
TOPIC: Key identity for node launches / 节点启动用钥身份
Q:
Auto Scaling launches an EKS managed node group's nodes with a customer-managed-key-encrypted root EBS volume. Besides pod roles, which role needs key authorization, and why?
Q_ZH:
EKS managed node group由Auto Scaling启动节点，根EBS卷使用客户管理KMS key。除Pod角色外，应授权哪种角色使用这把key，为什么？
A:
Answer: Authorize the Auto Scaling service-linked role actually launching instances to use the customer managed key.
Key point: The Auto Scaling launch workflow creates encrypted EBS volumes. Pod workload permissions or only granting the EKS control-plane role does not authorize this caller automatically.
A_ZH:
答：授权实际启动实例的Auto Scaling service-linked role使用该客户管理key。
考点：创建加密EBS卷的是Auto Scaling启动流程；Pod工作负载角色或只给EKS控制平面角色权限，不会自动替这个调用身份取得用钥权限。
SOURCE: https://docs.aws.amazon.com/autoscaling/ec2/userguide/key-policy-requirements-EBS-encryption.html

## aws-rb2-20261107-pack-xa056 | d2
TOPIC: NLB TLS termination / NLB终止TLS
Q:
Devices connect through an NLB to EC2. The client connection must be encrypted and the NLB must complete the TLS handshake. How should listener and certificate be configured, and why?
Q_ZH:
设备经NLB连接EC2，希望客户端这段连接加密，并由NLB完成TLS握手。监听器与证书应怎样配置，为什么？
A:
Answer: Configure a TLS listener and associate at least one server certificate with it.
Key point: The TLS listener encrypts and decrypts the NLB's client connection; its server certificate supports that handshake. WAF rules or EBS at-rest encryption do not enable connection TLS.
Watch out: If decryption must occur at the backend, use a TCP listener to pass existing TLS through. NLB TLS termination does not automatically encrypt the next connection.
A_ZH:
答：配置TLS listener，并在这个监听器关联至少一张服务器证书。
考点：TLS listener在NLB处理客户端连接的加解密，服务器证书用于这段TLS握手；WAF规则或EBS静态加密不会把客户端连接变成TLS。
易错提醒：若必须让后端解密，可用TCP监听器透传既有TLS流量；在NLB终止TLS也不会自动加密后续连接。
SOURCE: https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-listeners.html

## aws-rb2-20261107-pack-xb001 | d2
TOPIC: Domain-based egress filtering / 域名出站过滤
Q:
Private-subnet servers may access only approved software-repository domains. What inspects and blocks other outbound HTTP/HTTPS traffic, and why are threat alerts alone insufficient?
Q_ZH:
私有子网中的服务器只能访问批准的软件仓库域名。要在出站途中检查并拦下其他HTTP/HTTPS流量，应使用什么，为什么不能只收集威胁告警？
A:
Answer: Use an AWS Network Firewall domain allow list, ensure unmatched HTTP/HTTPS traffic is dropped, and route traffic through the firewall.
Key point: Only traffic traversing the firewall can be checked against HTTP Host or TLS SNI domain names. Alerts report findings but do not automatically create a blocking point.
A_ZH:
答：使用AWS Network Firewall域名允许列表，确保未匹配的HTTP/HTTPS流量被丢弃，并用路由表把流量导向防火墙。
考点：流量实际经过防火墙后，规则才能按HTTP Host或TLS SNI中的域名检查和放行；告警只报告发现，不会自动成为流量的阻断点。
SOURCE: https://docs.aws.amazon.com/network-firewall/latest/developerguide/what-is-aws-network-firewall.html

## aws-rb2-20261107-pack-xb002 | d2
TOPIC: GWLB inspection paths / GWLB检查路径
Q:
A third-party firewall supports GWLB's required GENEVE encapsulation. Traffic from several application VPCs must transparently traverse it. How should they connect?
Q_ZH:
第三方防火墙已支持GWLB所需的GENEVE封装。多个应用VPC的流量都要透明经过它检查，应怎样连接？
A:
Answer: Deploy Gateway Load Balancer on the appliance side, create GWLB endpoints on the application side, and route traffic needing inspection to those endpoints.
Key point: GWLB distributes network-layer IP traffic to inspection appliances. Its endpoints connect application and appliance VPCs, making inspection a hop in the request path.
Watch out: Appliances must support GENEVE; receiving ordinary IP packets alone does not prove compatibility.
A_ZH:
答：设备侧部署Gateway Load Balancer，应用侧创建GWLB endpoint，并用路由把待检查流量送至该端点。
考点：GWLB在网络层把IP流量分配给检查设备；GWLB endpoint把应用VPC与设备VPC连接起来，让检查成为请求路径的一跳。
易错提醒：设备必须兼容GENEVE；只知道设备能接收普通IP包，还不足以确认兼容。
SOURCE: https://docs.aws.amazon.com/elasticloadbalancing/latest/gateway/introduction.html

## aws-rb2-20261107-pack-xb003 | d2
TOPIC: External dashboard sharing / 外部仪表板共享
Q:
A product manager without an AWS account only needs periodic viewing of one CloudWatch dashboard. How can access be provided without shared IAM login credentials?
Q_ZH:
产品经理没有AWS账号，只需定期查看一个CloudWatch仪表板。怎样给他入口，而不分发共享IAM登录凭据？
A:
Answer: Share the dashboard in CloudWatch with their email address; after accepting the invitation, they open the shared link using their own password.
Key point: Dashboard sharing supplies an external viewing entry without borrowing the team's AWS login identity.
Watch out: Sharing still permits querying all CloudWatch metrics and EC2 names/tags in the account; it does not promise visibility limited to data on that chart.
A_ZH:
答：在CloudWatch分享该仪表板，指定他的邮箱，完成邀请后让他用自己的密码打开分享链接。
考点：仪表板共享自带外部查看入口，收件人不必借用团队的AWS登录身份。
易错提醒：共享权限仍允许查询账户内全部CloudWatch指标及EC2名称/标签；不能承诺只看得到这张图上的数据。
SOURCE: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch-dashboard-sharing.html

## aws-rb2-20261107-pack-xb005 | d2
TOPIC: HTTP redirection / HTTP重定向
Q:
An ALB listens on HTTP and HTTPS, but visitors can still open HTTP URLs. How can requests switch to HTTPS, and why is a certificate alone insufficient?
Q_ZH:
网站的ALB已分别监听HTTP和HTTPS，但访问者仍可能打开HTTP地址。怎样让这些请求转为HTTPS，为什么只装证书不够？
A:
Answer: Configure the HTTP listener with a redirect action to the HTTPS URL.
Key point: The certificate enables an HTTPS connection. Redirect returns a new HTTPS address, prompting the originally HTTP client to establish an encrypted connection.
A_ZH:
答：给HTTP监听器配置redirect动作，重定向到HTTPS地址。
考点：证书让HTTPS连接能够建立；redirect则返回新的HTTPS地址，让原本走HTTP的客户端重新发起加密连接。
SOURCE: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/rule-action-types.html

## aws-rb2-20261107-pack-xb008 | d2
TOPIC: Database audit-log retention / 数据库审计日志保留
Q:
Aurora PostgreSQL business data is retained five years, but internal database audit logs need long-term retention. Can backup retention alone be extended? How should logs be handled?
Q_ZH:
Aurora PostgreSQL的业务数据只保留5年，但数据库内部操作审计日志必须长期保留。能只延长备份保留期吗，应怎样处理日志？
A:
Answer: No. Configure required database auditing, continuously export PostgreSQL logs to CloudWatch Logs, and set log retention without automatic expiry.
Key point: Backups preserve recoverable data state. Audits record who performed which operations; exported logs follow independent log retention rather than database-backup expiration.
A_ZH:
答：不能；配置所需数据库审计记录，把PostgreSQL日志持续导出到CloudWatch Logs，并设置不自动到期的日志保留。
考点：备份保存可恢复的数据状态；数据库审计记录谁做了哪些操作，导出后按独立日志保留设置保存，不受数据库备份到期策略支配。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Appendix.PostgreSQL.CommonDBATasks.pgaudit.html

## aws-rb2-20261107-pack-xb012 | d2
TOPIC: Function URL authentication / Function URL认证
Q:
A Lambda needs HTTPS access for internal IAM callers and a third-party webhook that cannot sign AWS requests but can send an agreed signature. How should authentication differ?
Q_ZH:
一个Lambda需要HTTPS入口。内部IAM调用方，与不能签AWS请求、但能发送约定签名的第三方webhook，认证怎样选？
A:
Answer: Use a function URL: choose AWS_IAM with invocation permission for IAM callers; for the webhook, NONE with an allowing resource policy, and verify the agreed signature inside the function.
Key point: A function URL sends HTTPS directly to Lambda without a full API-management layer for a simple entry. NONE bypasses Lambda IAM authentication, so the function must verify business trust.
Watch out: Public invocability does not establish trust; NONE is not completed business authentication.
A_ZH:
答：用function URL：IAM调用选AWS_IAM并授予调用权限；第三方webhook可选NONE及允许访问的资源策略，由函数校验约定签名。
考点：function URL直接把HTTPS请求交给函数，无须为简单入口维护完整API管理层；NONE跳过Lambda的IAM认证，业务可信性要由函数验证。
易错提醒：公开可调用不等于请求可信；不能把NONE当作已完成业务认证。
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html

## aws-rb2-20261107-pack-xb014 | d2
TOPIC: SFTP with existing AD identities / SFTP沿用AD身份
Q:
Existing SFTP users authenticate with on-premises Microsoft AD. Files should move to S3 without client changes or a new user directory. How should the managed entry connect identity?
Q_ZH:
现有SFTP用户用本地Microsoft AD凭据登录，文件要放S3，又不想改客户端或另建一套用户。托管入口应怎样接身份？
A:
Answer: Use a Transfer Family SFTP server with AWS Directory Service as identity provider; bridge on-premises AD with AD Connector and grant directory groups appropriate file access.
Key point: Transfer Family manages SFTP while AD Connector sends identity checks back to the existing directory, letting users keep AD credentials without reissued migration passwords.
Watch out: The directory and server must meet Region and other support requirements. Simple AD is unsupported; AD Connector integration does not imply support for existing RADIUS MFA.
A_ZH:
答：使用Transfer Family SFTP服务器，选AWS Directory Service身份提供方；用AD Connector桥接本地Microsoft AD，并授予相应目录组文件访问。
考点：SFTP协议由Transfer Family托管，AD Connector把身份检查接回原目录，因此用户沿用原AD凭据，不必迁移时重发密码。
易错提醒：目录与Transfer服务器须符合Region等支持条件；不支持Simple AD，也不能把AD Connector接入等同于支持现有RADIUS MFA。
SOURCE: https://docs.aws.amazon.com/transfer/latest/userguide/directory-services-users.html

## aws-rb2-20261107-pack-xb018 | d2
TOPIC: SFTP endpoint scope / SFTP入口范围
Q:
A Transfer Family SFTP entry must restrict connectivity. Which VPC-hosted endpoint fits an already connected corporate network versus partners using specified public IPs?
Q_ZH:
Transfer Family SFTP入口需要限制谁能连接。仅从已连通公司网络访问，与必须让指定公网IP的伙伴访问，应怎样选VPC托管端点？
A:
Answer: Choose Internal for corporate private access. For public partners, choose Internet Facing, associate Elastic IPs, and restrict endpoint security groups to trusted sources.
Key point: Internal provides private addresses requiring an existing private path. Internet Facing supplies an internet entry; security groups restrict callers. IAM file permissions do not replace network-entry restrictions.
A_ZH:
答：公司私网访问选Internal；公网伙伴访问选Internet Facing，关联Elastic IP，并用端点安全组只放行可信来源。
考点：Internal只有私有地址，需现有私网路径；Internet Facing提供互联网入口，安全组再控制允许连接的来源，IAM文件权限不会替代网络入口限制。
SOURCE: https://docs.aws.amazon.com/transfer/latest/userguide/create-server-in-vpc.html

## aws-rb2-20261107-pack-xb021 | d2
TOPIC: S3 object ARNs / S3对象ARN
Q:
A policy allows ListBucket and DeleteObject on arn:aws:s3:::example-bucket, but object deletion fails. What is the minimal addition, and why?
Q_ZH:
策略已允许对arn:aws:s3:::example-bucket执行ListBucket和DeleteObject，却仍删不了桶内对象。怎样最小补充，为什么？
A:
Answer: Add object resource arn:aws:s3:::example-bucket/* for s3:DeleteObject; retain ListBucket on the bucket ARN.
Key point: ListBucket targets a bucket; DeleteObject targets an object. Object ARNs have a slash and object key after the bucket name. The bucket ARN alone does not match objects.
A_ZH:
答：为s3:DeleteObject增加对象资源arn:aws:s3:::example-bucket/*，保留列桶动作在桶ARN上。
考点：ListBucket操作桶；DeleteObject操作桶内对象。对象ARN在桶名后有斜线和对象键，只有桶ARN并没有匹配到对象。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/security_iam_service-with-iam.html

## aws-rb2-20261107-pack-xb023 | d2
TOPIC: Migrating Windows permissions / 迁移Windows权限
Q:
On-premises Windows SMB files must move to FSx for Windows with users' read/write permissions intact. Which transfer fits, and why not copy only content?
Q_ZH:
本地Windows SMB文件要迁到FSx for Windows，要求用户原有读写权限不变。应选择什么传输方式，为什么不能只复制文件内容？
A:
Answer: Use DataSync SMB-to-FSx for Windows transfer with an identity authorized to copy Windows ACLs and other required metadata.
Key point: Content and access control are separate data. The SMB path can retain NTFS ACLs so the target enforces original user/group permissions; ordinary object copying does not guarantee Windows permission preservation.
A_ZH:
答：使用DataSync的SMB→FSx for Windows传输，并让传输身份具备复制Windows ACL等元数据的必要权限。
考点：文件内容与访问控制是不同数据；SMB路径可保留NTFS访问控制列表，目标继续按原用户/组的权限判断，而普通对象复制不能据此保证保留Windows权限。
SOURCE: https://docs.aws.amazon.com/datasync/latest/userguide/metadata-copied.html

## aws-rb2-20261107-pack-xb025 | d2
TOPIC: EKS API entry types / EKS两类API入口
Q:
An EKS cluster has a private Kubernetes API endpoint and nodes in the same VPC. Can an additional EKS interface VPC endpoint replace node connectivity to the Kubernetes control plane?
Q_ZH:
EKS集群已启用私有Kubernetes API端点，节点也在同VPC。再创建EKS的interface VPC endpoint，就能代替节点到Kubernetes控制面的连接吗？
A:
Answer: No. Nodes must connect to the cluster's own private Kubernetes API endpoint, allowed by the cluster security group. The EKS interface endpoint serves AWS EKS management APIs.
Key point: AWS EKS APIs manage cluster resources; Kubernetes APIs serve node registration and cluster operations. They are different entries.
A_ZH:
答：不能。节点要连集群自己的私有Kubernetes API端点，并获集群安全组放行；EKS interface endpoint用于AWS EKS管理API。
考点：AWS EKS管理API负责管理集群资源；Kubernetes API服务节点注册和集群操作，二者不是同一个入口。
SOURCE: https://docs.aws.amazon.com/eks/latest/userguide/vpc-interface-endpoints.html

## aws-rb2-20261107-pack-xb026 | d2
TOPIC: SSM session archiving / SSM会话归档
Q:
An administrator's native interactive Session Manager sessions must be archived in S3. Does successful login automatically archive content? What is needed?
Q_ZH:
管理员使用Session Manager原生交互会话，要求会话内容进入S3留档。已能登录就会自动归档吗，应配置什么？
A:
Answer: No. Enable S3 logging in Session Manager preferences, specify the bucket, and configure required write/encryption permissions.
Key point: Session establishment proves only the access path. Logging preferences separately control archive output. Native session logs need no extra CloudWatch Agent forwarding.
Watch out: Port forwarding and SSH tunneled through Session Manager do not provide this session-content logging.
A_ZH:
答：不会；在Session Manager preferences启用S3 logging，指定归档桶，并配置必要写入/加密权限。
考点：能建立会话只证明访问路径可用；日志偏好另行决定交互会话数据是否输出到归档位置，无需额外装CloudWatch Agent转存这类原生日志。
易错提醒：端口转发或经Session Manager隧道使用SSH时，不提供这种会话内容日志。
SOURCE: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-logging-s3.html

## aws-rb2-20261107-pack-xb033 | d2
TOPIC: ECS application roles / ECS应用角色
Q:
ECS container code must read S3. Does permission belong in the task role or task execution role, and why not only the image-pulling role?
Q_ZH:
ECS容器里的应用要读S3。应把权限给task role还是task execution role，为什么不能只给拉取镜像的角色？
A:
Answer: Grant the application's needed S3 permissions to the task role.
Key point: Its credentials are provided to application code. The task execution role serves ECS/Fargate agent actions such as image pulls and logging; those credentials are not directly provided to application code.
Watch out: On shared EC2 container hosts, task roles alone are not strict isolation boundaries; appropriate host and network isolation is also needed.
A_ZH:
答：给task role（任务角色）授予应用需要的S3权限。
考点：任务角色的凭据交给容器应用调用AWS；task execution role供ECS/Fargate Agent拉镜像、写日志等运行任务操作，不直接把凭据交给应用代码。
易错提醒：共享EC2容器主机上任务角色本身不构成严格隔离边界；还需适当主机与网络隔离。
SOURCE: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html

## aws-rb2-20261107-pack-xb036 | d2
TOPIC: SSM default host management / SSM默认主机管理
Q:
An existing EC2 application role accesses databases and cannot be replaced. SSM Agent, IMDSv2, and connectivity meet automatic-management conditions. How can Systems Manager manage it without breaking application permissions?
Q_ZH:
EC2现有实例角色只供应用访问数据库，不能被替换。实例的SSM Agent、IMDSv2和联网均满足自动纳管条件。怎样让Systems Manager纳管，又不破坏应用权限？
A:
Answer: Enable Default Host Management Configuration in the account/Region and manage through its default management role, retaining the application role.
Key point: Default host management separates SSM management permissions from the application instance role, without attaching a second instance role. The original role retains database permissions.
Watch out: If the existing instance profile allows ssm:UpdateInstanceInformation, the agent prefers it; follow official conditions to use default management permissions.
A_ZH:
答：在该账户/Region启用Default Host Management Configuration，使用其默认管理角色纳管实例，保留应用角色。
考点：默认主机管理把SSM管理权限与应用实例角色分开，不必给EC2挂第二个实例角色；应用原有数据库权限继续由原角色提供。
易错提醒：若现有instance profile允许ssm:UpdateInstanceInformation，Agent优先使用它；须按官方条件处理才能使用默认管理权限。
SOURCE: https://docs.aws.amazon.com/systems-manager/latest/userguide/fleet-manager-default-host-management-configuration.html

## aws-rb2-20261107-pack-xb040 | d2
TOPIC: ECR image scanning / ECR镜像扫描
Q:
ECS must retain its task deployment while both existing and future images need known-vulnerability checks. How can a managed registry provide scanning without switching to EKS?
Q_ZH:
ECS仍用原来的任务部署，但已有镜像和以后新推送镜像都要检查已知漏洞。怎样用托管仓库接入扫描，不必改成EKS？
A:
Answer: Store images in private ECR repositories and configure basic scan on push for the relevant repositories; manually initiate scans for existing images as needed.
Key point: Scanning checks image packages against known CVEs. Push triggers cover future images. ECS/EKS is the runtime choice; changing orchestrators does not automatically scan repository images.
A_ZH:
答：把镜像放在ECR私有仓库，对相应仓库配置basic scan on push；已有镜像按需要启动一次手动扫描。
考点：扫描针对镜像中的软件包和已知CVE，推送触发负责后续新镜像；ECS/EKS是运行方式，换容器编排器不会自动扫描仓库镜像。
SOURCE: https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning-basic.html

## aws-rb2-20261107-pack-xb042 | d2
TOPIC: Per-application access points / 按应用访问点
Q:
Many applications share an S3 bucket, each limited to its own prefix. How can permission maintenance avoid one huge bucket policy without copying data?
Q_ZH:
许多应用共用一个S3桶，每个应用只能操作自己的前缀。怎样减少把全部权限塞进一条大桶策略的维护负担，而不复制数据？
A:
Answer: Create separate S3 Access Points per application; each access-point policy restricts application identity and allowed prefixes.
Key point: Access points are named entries to the same stored data with separate policies. Objects stay in the original bucket without permission-driven copies.
Watch out: Access-point and underlying bucket policies must both allow access; a new entry does not bypass bucket permissions.
A_ZH:
答：为各应用创建独立S3 Access Point，在各自访问点策略中限制应用身份及允许的前缀。
考点：访问点是同一存储数据的命名入口，各入口可有独立策略；对象仍在原桶中，不必为了应用权限拆出多份副本。
易错提醒：访问点策略须与底层桶策略共同允许；新建入口不会自动绕过桶权限。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-points.html

## aws-rb2-20261107-pack-xb043 | d2
TOPIC: Adding NLB security groups / NLB补加安全组
Q:
An existing NLB was created without any security group. It must now accept only trusted IPs. Can a group be added directly, and what should be done?
Q_ZH:
现有NLB创建时没有关联任何安全组，现在要只允许可信IP连接。能直接给它补上安全组吗，应怎样处理？
A:
Answer: No. Create a replacement NLB with a security group, configure trusted-source rules, switch entry traffic, and close the old unrestricted entry.
Key point: NLB security-group associations can be changed later only if a group was associated at creation. Adding a restricted NLB alongside an open original leaves the old access path intact.
A_ZH:
答：不能；创建带安全组的替代NLB，配置可信来源规则后切换入口，并关闭旧的未受限入口。
考点：NLB只有创建时已关联安全组，之后才可修改关联；并排增加一个受限NLB，却留下原入口，不会消除原来的访问路径。
SOURCE: https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-security-groups.html

## aws-rb2-20261107-pack-xb045 | d2
TOPIC: Patching with traffic draining / 补丁自动上下线
Q:
EC2 is registered in a load-balancer target group by instance ID and SSM requirements are met. Business traffic must pause during patching and resume afterward. Which managed workflow does more than scheduling a maintenance time?
Q_ZH:
EC2已按实例ID注册到负载均衡目标组，SSM条件已满足。补丁期间必须暂停接收业务，打完再恢复。应选哪个托管自动化流程，而不只安排一个维护时间？
A:
Answer: Use the AWSEC2-PatchLoadBalancerInstance Automation runbook: deregister, wait for connection draining, patch, and reregister.
Key point: A maintenance window schedules execution; this runbook orchestrates removing and restoring traffic rather than patching while receiving new business requests.
Watch out: Target-group type cannot change in place. Moving IP registration to instance IDs requires a new instance-type target group and cutover.
A_ZH:
答：使用AWSEC2-PatchLoadBalancerInstance Automation runbook：移出目标、等待连接排空、执行补丁，再重新注册。
考点：维护窗口安排何时运行；该runbook才编排下线与恢复流量，让补丁不是在继续接收新业务时盲目执行。
易错提醒：目标组类型不能原地修改；若需从IP注册改为实例ID，应新建instance类型目标组再切换。
SOURCE: https://docs.aws.amazon.com/systems-manager-automation-runbooks/latest/userguide/automation-awsec2-patch-load-balancer-instance.html

## aws-rb2-20261107-pack-xr102 | d2
TOPIC: Remote-worker VPN / 员工远程VPN
Q:
Staff at home or traveling need secure access from personal devices to VPC file shares. Choose Client VPN or the office Site-to-Site VPN, and why?
Q_ZH:
员工在家或流动地点，要从自己的设备安全访问VPC内的文件共享。应使用Client VPN还是办公室的Site-to-Site VPN，为什么？
A:
Answer: Use AWS Client VPN for encrypted client connections, granting target-network access by user or group.
Key point: Client VPN connects individual devices without requiring office-network presence. Site-to-Site VPN connects fixed-network gateways, such as an office, to AWS.
Watch out: VPN authorizes network access; FSx, AD, and other file permissions still control files.
A_ZH:
答：用AWS Client VPN，让员工通过VPN客户端建立加密连接，并按用户或组授予目标网络访问权限。
考点：Client VPN接入的是个人终端，不要求员工先位于办公室网络；Site-to-Site VPN连接办公室等固定网络的网关与AWS。
易错提醒：VPN授权的是网络访问；文件本身仍由FSx和AD等文件权限控制。
SOURCE: https://docs.aws.amazon.com/vpn/latest/clientvpn-admin/what-is.html

## aws-rb2-20261107-pack-aws-rb2-20261105-boundary-aurora-iam-token-login | d2
TOPIC: Aurora token login / Aurora令牌登录
Q:
An EC2 application connects to Aurora without maintaining a static database password. Networking works and the database version supports IAM authentication. Which authentication and EC2 identity fit, and why?
Q_ZH:
EC2应用要连接Aurora，但不想维护静态数据库密码。网络已连通，数据库版本支持IAM认证。应采用什么认证方式，EC2应使用哪种身份，为什么？
A:
Answer: Enable IAM database authentication and create the corresponding database user. Grant the EC2 instance role connection permission; the application logs in using an authentication token obtained with the role.
Key point: The role supplies temporary AWS credentials. IAM database authentication uses them to generate a login token instead of storing a long-term database password.
Watch out: Associate the role through an instance profile; an IAM user cannot be attached as an instance role.
A_ZH:
答：启用IAM数据库认证并创建对应数据库用户；给EC2实例角色授予连接权限，应用使用角色获取的认证令牌登录。
考点：角色为EC2应用提供临时AWS凭据；IAM数据库认证用这些凭据生成登录令牌，替代应用保存长期数据库密码。
易错提醒：EC2通过instance profile关联IAM角色，不能把IAM用户当作实例角色来关联。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.IAMDBAuth.html

## aws-rb2-20261107-pack-aws-rb2-domain1-normal-batch06-20261105-roles-anywhere-workload-identity | d2
TOPIC: On-premises workload identity / 机房机器身份
Q:
An unattended on-premises VM application needs S3 without long-term AWS keys. It has an X.509 certificate from a trusted corporate CA. Which credentials fit, and why?
Q_ZH:
机房VM上的无人值守应用要访问S3，不想保存长期AWS访问密钥。公司已有受信任CA签发的X.509证书。应采用什么凭据方案，为什么？
A:
Answer: Use IAM Roles Anywhere: authenticate with the certificate and obtain temporary credentials for an IAM role with required S3 permissions.
Key point: A CA issues certificates. Registering it as a trust anchor lets the certificate authenticate the external workload; the role defines its allowed AWS operations.
Watch out: Existing Identity Center access for employees does not automatically give on-premises applications this machine identity.
A_ZH:
答：使用IAM Roles Anywhere，让应用用证书验证身份，换取有相应S3权限的IAM角色临时凭据。
考点：CA是证书签发机构。将其登记为信任锚后，证书用于验证外部应用身份，角色规定它能执行哪些AWS操作。
易错提醒：已有Identity Center供员工登录，不等于机房应用已经获得这种机器身份。
SOURCE: https://docs.aws.amazon.com/singlesignon/latest/userguide/permissionsetsconcept.html

## aws-rb2-20261107-pack-aws-rb2-domain1-normal-batch08-20261105-s3-account-public-access-guardrail | d2
TOPIC: Account-wide public-access prevention / 账户级防公开
Q:
Existing and future S3 buckets in Organizations member accounts must resist accidental employee exposure, and employees must not disable protection. What control combination can work, and why is it preferable to repair after exposure?
Q_ZH:
Organizations成员账户的现有和未来S3桶都不能被员工误公开，员工也不能关闭防护。可采用什么控制组合？为什么比发现公开后再修复更合适？
A:
Answer: For example, enable every account-level S3 Block Public Access setting and use an SCP to deny employee changes to those settings.
Key point: Block Public Access prevents exposure through public policies or ACLs; the SCP caps organization-level permissions and protects the settings themselves, before objects become public.
Watch out: Protecting one bucket does not cover an account. Account-level settings cover existing and future buckets.
A_ZH:
答：例如：启用账户级全部S3 Block Public Access设置，再用SCP拒绝员工更改这些防护设置。
考点：Block Public Access预先阻止公共策略或ACL造成公开；SCP是组织层权限上限，可保护设置本身，不必等对象已公开再补救。
易错提醒：只给某一个桶开启防护不能覆盖全账户；账户级设置作用于现有和未来的桶。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html

## aws-rb2-20261107-pack-vc-008 | d2
TOPIC: New security-group defaults / 新建安全组默认值
Q:
Web and database servers in one VPC use separately created security groups. Default routing and the default NACL are unchanged. The database runs but cannot be reached. Why check database-group inbound rules first?
Q_ZH:
同一VPC的Web和数据库使用分别新建的安全组，默认路由和默认NACL未改。数据库运行正常却连不上，为什么应先看数据库安全组入站？
A:
Answer: The VPC already has its local route and the default NACL permits traffic, but new security groups deny inbound by default. Allow the Web group to reach the database listening port.
Key point: An existing network path does not authorize new connections at the receiver. Security groups are independent admission gates, not a missing same-VPC route.
Watch out: The VPC's default security group has a same-group self-reference; distinguish it from a newly created group's initial state.
A_ZH:
答：同VPC默认已有local路由，默认NACL允许流量，但新安全组默认不允许入站；须在数据库组放行Web组到数据库监听端口。
考点：网络路径已具备，不等于接收端已授权新连接。安全组是独立的准入门，不能用“还需要一条同VPC路由”代替它。
易错提醒：VPC自带default security group另有同组自引用规则；不要把它和“新建安全组的初始状态”混为一谈。
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/default-network-acl.html

## aws-rb2-20261107-pack-vc-011 | d2
TOPIC: S3 default encryption choices / S3默认加密选择
Q:
S3 needs ordinary at-rest encryption without key management versus an explicit customer KMS key. Is default encryption enough?
Q_ZH:
S3只要求普通静态加密、不想自行管理密钥，与明确要求客户KMS key时，默认加密够吗？
A:
Answer: Ordinary requirements can use S3-managed SSE-S3, already automatic for new uploads. A customer-KMS-key requirement needs SSE-KMS with that customer key.
Key point: Both protect stored data; key control differs. S3 manages SSE-S3 keys, also compatible with encrypted cross-Region replication. KMS supplies corresponding key-policy and key-use auditing controls.
A_ZH:
答：普通要求可用S3管理密钥的SSE-S3，当前新上传已自动启用；要求客户KMS key时应选对应客户key的SSE-KMS。
考点：两者都保护落盘数据，区别在密钥控制。SSE-S3由S3管理key，也可配合跨Region复制保持对象加密；KMS方式提供相应的key policy和用钥审计控制。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-bucket-encryption.html

## aws-rb2-20261107-pack-vc-013 | d2
TOPIC: SSE-C keys on each request / SSE-C逐请求密钥
Q:
Existing and future S3 objects must use SSE-C with a customer-supplied key on every request. Is changing bucket default encryption enough, and what is required?
Q_ZH:
S3旧对象和今后上传都必须采用客户逐次提供密钥的SSE-C。只改桶默认加密就够吗，应怎样处理？
A:
Answer: No. Copy or rewrite old objects using SSE-C-supported requests to create encrypted copies. Future uploads must supply the key on each request; SSE-C cannot be bucket default encryption.
Key point: S3 does not store this customer key; encryption and reads need it each time. Defaults do not rewrite old bytes; specifying target encryption during copy creates the required copy.
Watch out: Bucket settings may currently block SSE-C writes by default, requiring explicit allowance. If the source is also SSE-C, provide its decryption key too.
A_ZH:
答：不够；旧对象需用支持SSE-C的copy/重写请求生成加密副本，后续上传也须逐请求提供客户密钥，不能把SSE-C设成桶的默认加密方式。
考点：S3不保存这把客户密钥；每次加密/读取都要提供它。改默认设置不会改写旧对象的字节，copy时指定目标加密才生成所需副本。
易错提醒：当前SSE-C写入可能默认被桶设置禁止，需显式允许；若复制源本来也是SSE-C，还要提供源对象解密所需的密钥。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/ServerSideEncryptionCustomerKeys.html

## aws-rb2-20261107-pack-ca15 | d2
TOPIC: Highly available Windows files / Windows文件高可用
Q:
A Windows application must retain SMB and AD file permissions and minimize loss of just-written files during maintenance or an AZ failure. How should file storage be deployed?
Q_ZH:
Windows应用要保留SMB和AD文件权限，计划维护或一个AZ故障时，还要尽量不丢刚写入的文件。应怎样部署文件后端？
A:
Answer: Use a fully managed FSx for Windows File Server Multi-AZ deployment integrated with AD.
Key point: AWS manages file servers; Multi-AZ synchronously replicates between two AZs and fails over automatically. AD identities and Windows ACLs still control access.
Watch out: Daily cross-Region backups are separate recovery points; they do not themselves guarantee only five minutes of data loss in a Region disaster.
A_ZH:
答：使用适配AD的全托管FSx for Windows File Server Multi-AZ部署。
考点：AWS管理底层文件服务器；Multi-AZ在两个AZ间同步复制并自动接管，文件访问仍由AD身份和Windows ACL控制。
易错提醒：跨Region每日备份是独立恢复点；它本身不保证发生Region灾难时也只有5分钟数据丢失。
SOURCE: https://docs.aws.amazon.com/fsx/latest/WindowsGuide/what-is.html

## aws-rb2-20261107-pack-cb01 | d2
TOPIC: RDS Multi-AZ types / RDS两类Multi-AZ
Q:
RDS needs cross-AZ automatic failover and more read capacity. What differs between a classic Multi-AZ standby and a Multi-AZ DB cluster?
Q_ZH:
RDS需要跨AZ自动接管，还要增加读容量。经典Multi-AZ standby和Multi-AZ DB cluster有什么关键差别？
A:
Answer: A classic Multi-AZ DB instance's standby serves no reads. A Multi-AZ DB cluster includes two readable replicas accessible through the reader endpoint.
Key point: Cluster replicas support both failover and reads; most failovers typically take under 35 seconds. A classic standby synchronously protects the primary rather than receiving read traffic.
Watch out: Typical failover time is not a hard SLA for every failure. Distinguish deployment types when scaling reads.
A_ZH:
答：经典Multi-AZ DB instance的standby不服务读取；Multi-AZ DB cluster内置两个可读副本，读请求可走reader endpoint。
考点：cluster让副本同时承担接管与读取，多数故障切换通常少于35秒；经典standby主要同步保护主库，不是读流量入口。
易错提醒：通常的切换时间不是所有故障的硬性SLA；需要扩读时要分清是哪种Multi-AZ部署。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html

## aws-rb2-20261107-pack-cb03 | d1
TOPIC: Compute capacity across AZs / 跨AZ计算容量
Q:
Compute must not stop entirely when one AZ fails. How should subnets and instances be placed, and what does Auto Scaling do?
Q_ZH:
计算层不能因一个AZ失效全部停止。子网和实例应怎样放，Auto Scaling负责什么？
A:
Answer: Create subnets in multiple AZs, distribute instances, and maintain capacity with a multi-AZ Auto Scaling group.
Key point: A subnet belongs to one AZ. Distributing instances across independent AZs avoids simultaneous failure in one fault domain; Auto Scaling replenishes lost capacity.
Watch out: Cross-AZ deployment is not Region-level disaster recovery; many instances within one AZ still share its failure risk.
A_ZH:
答：在多个AZ各设子网并分散实例，由跨AZ Auto Scaling组维持容量。
考点：一张子网只属于一个AZ；把实例分散到独立AZ，才避免同一故障域一起失效，Auto Scaling再补足损失。
易错提醒：同Region跨AZ不能替代Region级灾备；单AZ内多台实例仍共享AZ故障风险。
SOURCE: https://docs.aws.amazon.com/autoscaling/ec2/userguide/auto-scaling-benefits.html

## aws-rb2-20261107-pack-cb06 | d2
TOPIC: Independent NAT per AZ / 每AZ独立NAT
Q:
Private instances across AZs need internet egress. One AZ failure must not cut off other AZs. How should NAT paths be arranged?
Q_ZH:
多个AZ的私有实例都依赖互联网出站，不能让某一AZ故障切断其他AZ出口，应怎样安排NAT路径？
A:
Answer: Deploy a NAT gateway in each AZ and route private subnets through their own AZ's gateway.
Key point: AWS manages NAT gateways with redundancy inside their AZ and automatic bandwidth scaling. Sharing one AZ's egress still creates a common failure point; separate paths across AZs.
A_ZH:
答：每个AZ部署自己的NAT gateway，私有子网使用本AZ的NAT出口。
考点：NAT gateway由AWS托管、在所属AZ内冗余并自动扩展带宽；但共用一个AZ的出口仍有共同故障点，须把各AZ出站路径分开。
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html

## aws-rb2-20261107-pack-cc13 | d2
TOPIC: S3 historical-version recovery / S3历史版本恢复
Q:
S3 documents are continually updated, and historical versions must be recoverable after accidental deletion. What should be enabled, and why is the current object list insufficient?
Q_ZH:
S3文档允许持续修改上传，但需要误删后找回历史版本，应启用什么？为什么只看对象列表不够？
A:
Answer: Enable Versioning and inspect object versions during recovery, not only the current object list.
Key point: Same-name uploads retain separate versions. Ordinary deletion can add a delete marker hiding the current object while history remains. Authorized deletion of a specified version can still permanently remove it.
A_ZH:
答：启用Versioning；恢复时检查对象版本，而不只看当前对象列表。
考点：同名上传保留独立版本，普通删除可加入delete marker而隐藏当前对象；历史版本可仍在，授权的指定版本删除仍可能永久删除它。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html

## aws-rb2-20261107-pack-nb04 | d2
TOPIC: Historical backups versus current replicas / 历史备份与当前副本
Q:
A database mistake requires old data, or an emptied cache needs restoration. Can the current cross-AZ replica replace historical backups?
Q_ZH:
数据库误改后要找回过去的数据，或内存缓存清空后要恢复。跨AZ当前副本能代替历史备份吗？
A:
Answer: No. Use supported RDS/Aurora or DynamoDB backup/PITR mechanisms. Redis OSS/Valkey ElastiCache can restore snapshots into a new cache.
Key point: Continuously replicated copies follow current changes; backups retain old states. Restoring a Redshift snapshot creates an independent point-in-time cluster that does not follow later source updates. Aurora continuous backups support PITR within its window; cache snapshots retain capture-time data.
Watch out: Snapshots do not synchronously persist every write; cache data added afterward can still be lost.
A_ZH:
答：不能。RDS/Aurora或DynamoDB使用各自支持的备份/时间点恢复；ElastiCache的Redis OSS/Valkey可从快照恢复到新缓存。
考点：持续复制的副本追随当前变化，历史备份保留旧状态。Redshift从snapshot另建集群是独立的时间点副本，不追随源集群后续更新。Aurora自动持续备份支持窗口内PITR，缓存快照则保留拍摄时的数据。
易错提醒：快照不是每次写入都同步落盘；缓存快照后新增的数据仍可能丢失。
SOURCE: https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/backups.html

## aws-rb2-20261107-pack-nb05 | d2
TOPIC: Recycle Bin versus Snapshot Lock / 回收站与快照锁
Q:
EBS snapshots or eligible AMIs need easy recovery after accidental deletion within a retention window. Which control fits? What if EBS snapshot deletion itself must be prevented?
Q_ZH:
EBS快照或适用AMI误删后，要在保留窗口内方便恢复，选什么？若对EBS快照要求删除请求本身被阻止呢？
A:
Answer: Use preconfigured, resource-matching Recycle Bin retention rules for recovery after deletion; use EBS Snapshot Lock during its effective lock period to prevent deletion.
Key point: Recycle Bin holds deleted resources until its window ends. Snapshot Lock restricts deletion on the resource without removing every administrator deletion permission. A recovery window is not pre-deletion prevention.
A_ZH:
答：删除后恢复用预先配置、匹配资源的Recycle Bin保留规则；阻止EBS快照删除用处于有效锁定期的EBS Snapshot Lock。
考点：Recycle Bin暂存已删除资源，窗口到期再清理；Snapshot Lock在资源上限制删除操作，不必靠收走管理员全部删除权限。恢复窗口不能当作事前禁止删除。
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/recycle-bin.html

## aws-rb2-20261107-pack-nb08 | d2
TOPIC: Stickiness and session persistence / 粘滞与会话持久化
Q:
Web instances behind an ALB store sessions locally. How do sticky sessions route requests? Do they preserve sessions after instance failure?
Q_ZH:
ALB后Web实例本机保存会话。开启sticky sessions会怎样分配请求？能保证实例故障后会话还在吗？
A:
Answer: Requests from a session preferentially continue to the same target, but stickiness does not replicate local sessions. For state across instances, externalize sessions to shared storage such as DynamoDB or Redis.
Key point: Instances use a shared session identifier to read/write shared data, allowing another instance to continue after one leaves. Changing routing alone does not preserve a machine's local state.
A_ZH:
答：同一会话尽量继续到同一目标；粘滞不复制本机会话。要跨实例保留状态，可把会话外置到DynamoDB或Redis等共享存储。
考点：各Web实例用同一会话标识读写共享会话数据，某台实例退出后其他实例仍可接着读取；仅改变请求去向不会保存那台机器的本地状态。
SOURCE: https://aws.amazon.com/blogs/developer/elasticache-as-an-asp-net-session-store/

## aws-rb2-20261107-pack-new04 | d2
TOPIC: S3 replication of new and old objects / S3新旧对象复制
Q:
S3 needs continuous replication to another bucket, including existing objects. How do same-Region and cross-Region choices differ, and is live replication alone enough?
Q_ZH:
S3需要向另一桶持续复制，还要包括历史对象。同Region和跨Region怎样选，只打开live replication够吗？
A:
Answer: Use SRR within a Region and CRR across Regions; both can target supported cross-account destinations. Live replication handles eligible new versions; use Batch Replication or another valid backfill for old objects.
Key point: Location determines replication type; new-versus-existing scope determines backfill. Enabling a rule does not automatically replicate all existing data. Lifecycle is not a cross-bucket replicator.
A_ZH:
答：同Region选SRR，跨Region选CRR；两者可用于受支持的跨账户目标。live replication处理符合规则的新版本，历史对象用Batch Replication等有效补复制。
考点：位置决定复制类型，新旧范围决定是否补历史；规则开启不会自动回头复制全部存量，Lifecycle也不是跨桶复制器。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html

## aws-rb2-20261107-pack-ns03 | d2
TOPIC: Backup planning tools / 备份计划工具
Q:
To schedule backups and retention expiry, how do tools differ for only EBS snapshots/EBS-backed AMIs versus unified protection across services?
Q_ZH:
要自动安排备份周期与到期保留。仅管理EBS快照或EBS-backed AMI，与统一保护多个服务时，工具怎样选？
A:
Answer: Use Data Lifecycle Manager for EBS snapshot and EBS-backed AMI lifecycles, including configured automatic cross-Region copies. Use AWS Backup for unified cross-service plans.
Key point: AWS Backup manages periodic recovery points for supported resources, including long retention and supported cross-Region copies such as EFS. Long-term periodic snapshots differ from continuous PITR with a limited window.
Watch out: DynamoDB backup cold-tier transitions require AWS Backup advanced features. A unified plan does not mean every resource and backup supports cold storage.
A_ZH:
答：EBS快照和EBS-backed AMI生命周期可用Data Lifecycle Manager，也可配置自动跨Region复制；跨服务统一计划用AWS Backup。
考点：AWS Backup统一管理受支持资源的周期恢复点，可按计划长期保留并安排支持的跨Region副本，例如EFS。周期快照的长期保留，不等于PITR只有有限时间窗口的连续恢复。
易错提醒：DynamoDB备份转冷层需启用AWS Backup高级功能；统一计划不表示每种资源和备份都支持转冷。
SOURCE: https://docs.aws.amazon.com/aws-backup/latest/devguide/advanced-ddb-backup.html

## aws-rb2-20261107-pack-xb016 | d2
TOPIC: Lifecycle wait points / 生命周期等待关口
Q:
Auto Scaling instances must report to auditing after launch and before termination. Termination cannot delete an instance before reporting. Which mechanism fits?
Q_ZH:
Auto Scaling实例启动后、终止前都要向审计系统提交信息；终止时不能在上报前就删掉实例。应使用什么机制？
A:
Answer: Configure launch and termination lifecycle hooks to trigger reporting and continue the lifecycle only after completion during the wait.
Key point: Hooks pause transitions in a wait state for custom actions. User data mainly runs on launch and cannot replace the pretermination wait point.
A_ZH:
答：为启动和终止配置lifecycle hooks，触发上报动作，在等待期间完成后再继续生命周期。
考点：生命周期hook把转换暂停在等待状态，给自定义动作时间；user data主要在启动执行，不能替代终止前的等待关口。
SOURCE: https://docs.aws.amazon.com/autoscaling/ec2/userguide/lifecycle-hooks.html

## aws-rb2-20261107-pack-xb030 | d1
TOPIC: Outposts site responsibilities / Outposts现场责任
Q:
AWS maintains equipment inside an Outposts rack. What must the company provide for on-site operation, and why cannot all failure reserve be left to AWS?
Q_ZH:
公司安装Outposts rack，AWS维护机柜内设备。公司还要为现场运行保障什么，为什么不能把故障余量都交给AWS？
A:
Answer: Provide physical site access control, power, and network connectivity, and plan sufficient workload and spare failure capacity.
Key point: AWS manages rack hardware and services, while the customer supplies site conditions. Rack capacity is finite; extra servers do not appear as with Region resources, so failure/maintenance reserve needs advance planning.
A_ZH:
答：公司负责场地物理访问控制、供电和网络连接，并规划足够工作负载容量及故障备用容量。
考点：AWS管理机柜内硬件和服务；客户场地条件仍由客户提供。机柜容量有限，不会像Region资源那样自动出现额外服务器，故障或维护余量须提前安排。
SOURCE: https://docs.aws.amazon.com/whitepapers/latest/aws-outposts-high-availability-design/aws-outposts-high-availability-design.html

## aws-rb2-20261107-pack-gcl-011 | d2
TOPIC: Blue/green validation / 蓝绿部署验证
Q:
A release must be independently verified while the old version keeps serving, then receive traffic after passing. Why does blue/green fit better than directly changing production?
Q_ZH:
新版本要先独立验证，旧版本继续服务，通过后再切流。蓝绿部署为什么比直接改生产环境更适合？
A:
Answer: Build a parallel environment, validate it, then switch the entry using supported mechanisms; maintain applicable synchronization for stateful data.
Key point: Isolation tests changes before production traffic moves, reducing unverified user impact. Application environments and RDS have their own managed blue/green approaches.
Watch out: Parallel environments do not guarantee synchronization, and not every engine/version supports the same managed switch.
A_ZH:
答：建立并行的新环境，验证后按受支持机制切换入口；有状态数据还须保持适用同步。
考点：变化先在隔离环境检验，生产流量最后切换，减少未经验证的变更直接影响用户；应用环境与RDS有各自的托管蓝绿方式。
易错提醒：并行环境本身不保证数据同步，也不是任意引擎和版本都支持同一种托管切换。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments.html

## aws-rb2-20261107-pack-gcl-012 | d2
TOPIC: Self-managed database failover / 自管数据库接管
Q:
A database must be self-managed on EC2 with automatic failover. Is one instance plus an AMI, or merely two instances in different AZs, enough?
Q_ZH:
数据库必须自管在EC2，要求故障后自动接管。只留一台机器加AMI，或简单建两台不同AZ机器，够吗？
A:
Answer: No. Replicate data across failure domains and configure a database-cluster mechanism supporting automatic failover.
Key point: A second machine must possess usable data, detect failure, and assume service to provide failover. AMI rebuilding is postfailure recovery.
Watch out: EC2 automatic recovery or ASG replacement does not automatically implement arbitrary database replication and cluster takeover.
A_ZH:
答：不够；需要跨故障域的数据复制，并配置支持自动故障接管的数据库集群机制。
考点：第二台机器只有持有可接管数据、又能获知故障并承担服务，才形成自动接管；AMI重建走的是事后恢复流程。
易错提醒：EC2自动恢复或ASG补实例，不会自动替客户完成任意数据库复制和集群接管。
SOURCE: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_withstand_component_failures.html

## aws-rb2-20261107-pack-gcl-014 | d2
TOPIC: EC2 instance backup scope / EC2实例备份范围
Q:
AWS Backup must restore EC2 configuration and attached EBS data volumes. Should the plan select the EC2 resource or only EBS volumes?
Q_ZH:
要用AWS Backup恢复EC2实例配置以及附加EBS数据卷，应把EC2资源还是仅EBS卷纳入计划？
A:
Answer: Select supported EC2 instance resource backup, not just individual volumes.
Key point: Instance-level backup preserves applicable instance-restoration information and supported attached volumes. Standalone snapshots mainly preserve block data, not full instance configuration.
Watch out: Restoring in another Region also requires an available backup copy there; a local backup does not establish remote recoverability.
A_ZH:
答：选择受支持的EC2实例资源备份，而不是只选择各卷。
考点：实例级备份保存相应实例恢复信息及受支持附加卷；单独卷快照主要保存块数据，不等于完整实例配置备份。
易错提醒：恢复到另一个Region还须有相应可用备份副本，本地有备份不等于异地已可恢复。
SOURCE: https://docs.aws.amazon.com/aws-backup/latest/devguide/ec2-backups.html

## aws-rb2-20261107-pack-gcl-019 | d2
TOPIC: Database backup formats / 数据库备份格式
Q:
Does placing a backup in S3 directly create Aurora? How do native snapshots, logical SQL dumps, and supported physical backups differ?
Q_ZH:
备份放S3就能直接创建Aurora吗？原生快照、逻辑SQL dump与受支持物理备份怎样区分？
A:
Answer: A compatible-version native RDS MySQL snapshot can migrate directly to Aurora MySQL. SQL dumps usually need client-side logical import; physical backup restoration from S3 requires a format supported by the target engine.
Key point: A common storage location does not imply a common backup format. Restoration depends on whether the database understands that format.
Watch out: A mysqldump file is neither a native snapshot nor automatically a supported physical backup.
A_ZH:
答：兼容版本的RDS MySQL原生快照可直接迁为Aurora MySQL；SQL dump通常用客户端逻辑导入；从S3恢复物理备份须符合目标引擎支持的格式。
考点：存放位置相同不代表备份格式相同；恢复方式取决于数据库能否理解该格式。
易错提醒：不能把mysqldump文件当作原生快照或受支持的物理备份。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraMySQL.Migrating.RDSMySQL.Snapshot.html

## aws-rb2-20261107-pack-gcl-022 | d2
TOPIC: Persistent Lustre deployments / Lustre持久部署
Q:
Lustre working data must last long term and survive file-server failure. Choose scratch or persistent?
Q_ZH:
Lustre工作数据要长期使用，文件服务器故障也不能丢失该份数据。选scratch还是persistent？
A:
Answer: Choose persistent.
Key point: Persistent replicates data and replaces failed servers. Scratch does not replicate data and file-server failure may lose it.
Watch out: Scratch suits regenerable temporary computation data; performance does not replace protection.
A_ZH:
答：选persistent。
考点：persistent复制数据并在服务器故障后替换服务器；scratch不复制数据，文件服务器故障可能导致数据丢失。
易错提醒：scratch适合能重新生成的临时计算数据，不能靠高性能替代数据保护。
SOURCE: https://docs.aws.amazon.com/fsx/latest/LustreGuide/what-is.html

## aws-rb2-20261107-pack-gsc-002 | d2
TOPIC: EFS cross-AZ protection / EFS跨AZ保护
Q:
Shared files must remain usable after one AZ fails. Choose EFS Regional or One Zone, and why?
Q_ZH:
共享文件必须在一个AZ故障后仍可使用。EFS选Regional还是One Zone，为什么？
A:
Answer: Choose Regional and arrange mount paths for client AZs.
Key point: Regional stores data across multiple AZs; One Zone stores in a single AZ and cannot protect against its complete failure.
Watch out: Connecting to One Zone from multiple AZs does not make its storage multi-AZ.
A_ZH:
答：选Regional，并为客户端所在AZ安排挂载路径。
考点：Regional文件系统跨多个AZ保存数据；One Zone的数据保存在单个AZ，不能承担AZ整体故障保护。
易错提醒：从多个AZ连接One Zone，不会把它变成跨AZ存储。
SOURCE: https://docs.aws.amazon.com/efs/latest/ug/how-it-works.html

## aws-rb2-20261107-pack-gsc-008 | d2
TOPIC: SnapMirror replica takeover / SnapMirror副本接管
Q:
FSx for ONTAP has a cross-Region SnapMirror replica. After primary-Region failure, is completed replication enough to let applications write at the destination?
Q_ZH:
FSx for ONTAP已有跨Region SnapMirror副本，主Region故障后，要让应用在目标端写入，只有“复制完成”够吗？
A:
Answer: No. Activate the destination as writable through the supported disaster-recovery process and connect applications to that storage.
Key point: Replication prepares data. Breaking the applicable replication relationship and enabling destination writes completes storage takeover; applications must use destination paths.
Watch out: Check synchronization progress before promotion; asynchronous replicas do not guarantee zero data loss.
A_ZH:
答：不够；须按支持的灾备流程把目标副本激活为可写，并把应用接到目标存储。
考点：复制准备数据，解除适用复制关系并开放目标写入才完成存储接管，应用还须使用目标端路径。
易错提醒：提升前核对同步进度，不能把异步副本当作零数据损失保证。
SOURCE: https://docs.aws.amazon.com/fsx/latest/ONTAPGuide/using-netapp-snapmirror.html

## aws-rb2-20261107-pack-gsc-011 | d2
TOPIC: Restoring backup volumes to EC2 / 备份卷恢复到EC2
Q:
On premises is unavailable and Volume Gateway backup volumes must run on EC2. Compatible EBS snapshots exist. Can an S3 bucket be mounted directly as a disk?
Q_ZH:
机房不可用，要在EC2上继续使用Volume Gateway的备份卷。已有兼容的EBS快照，能把S3桶直接当磁盘挂载吗？
A:
Answer: Create EBS volumes from the snapshots and attach them to suitable EC2 instances.
Key point: A snapshot is a volume recovery point. Creating an EBS volume produces an attachable block device.
Watch out: Check snapshot/volume capacity, Region, and AZ requirements. S3-stored backups are not ordinary directly readable file buckets.
A_ZH:
答：从快照创建EBS卷，再把卷挂到合适的EC2实例。
考点：快照是卷的恢复点；创建EBS卷后才得到EC2能挂载的块设备。
易错提醒：须核对快照和目标卷的容量、Region及AZ要求；存储在S3中的备份不是普通可直接读取的文件桶。
SOURCE: https://docs.aws.amazon.com/storagegateway/latest/vgw/StorageGatewayConcepts.html

## aws-rb2-20261107-pack-gsc-039 | d2
TOPIC: Multi-Region DynamoDB reads and writes / DynamoDB多Region读写
Q:
Applications in multiple Regions need nearby reads and writes to the same DynamoDB business data. Is one regional table enough?
Q_ZH:
多个Region的应用都要就近读写同一份DynamoDB业务数据，只部署一张区域表够吗？
A:
Answer: Consider DynamoDB global tables with supported replicas in the needed Regions.
Key point: Global tables manage cross-Region replication, letting applications use local replicas rather than return to one Region every time.
Watch out: Evaluate consistency and conflict behavior under the selected mode; do not assume every cross-Region write is instantly visible everywhere.
A_ZH:
答：考虑DynamoDB global tables，在所需Region建立受支持的副本。
考点：global tables管理跨Region复制，应用可以访问所在Region的副本，减少每次回到单一Region。
易错提醒：复制一致性和冲突行为须按所选模式判断；不要假设任何跨Region写入都会立刻在所有副本可见。
SOURCE: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html

## aws-rb2-20261107-pack-gsc-045 | d2
TOPIC: Read-replica lag / 读副本复制延迟
Q:
Why can an established RDS read replica return old data? Will adding replicas guarantee keeping up with the primary?
Q_ZH:
RDS读副本已建立，为什么仍可能读到旧数据？多加几个副本就能保证跟上主库吗？
A:
Answer: No guarantee: asynchronous replication has lag, and replicas need enough resources to replay primary writes and serve reads.
Key point: Supported engines can place read replicas in another Region, such as RDS PostgreSQL, but replication remains asynchronous. More replicas divide reads without eliminating change-replay delay.
Watch out: Size for actual load; neither mechanically halving capacity nor matching primary size guarantees zero lag.
A_ZH:
答：不能保证；异步复制有延迟，副本也要有足够资源重放主库写入并服务读取。
考点：按引擎支持，读副本也可建在另一Region，例如RDS PostgreSQL；但复制仍异步，新增副本只分担读取，不能消除重放变更的延迟。
易错提醒：按实际负载选副本规格，不能机械减半，也不能把同规格当作绝对无延迟保证。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.XRgn.html

## aws-rb2-20261107-pack-gsc-047 | d2
TOPIC: Recent PITR and long-term history / 近期PITR与多年历史
Q:
RDS must restore to just before a recent mistake and retain years of history. Is increasing automatic-backup retention enough?
Q_ZH:
RDS既要恢复到近期某个误操作前的时刻，又要保留多年历史。只把自动备份窗口设大就够吗？
A:
Answer: No. Use PITR within its supported recent window and manual snapshots or applicable long-term backup retention for years of history.
Key point: Automated backups combine snapshots and transaction logs; PITR supports up to 35 days. RDS DB instances upload logs roughly every five minutes, with actual progress determining the latest recovery point. Manual snapshots remain until explicitly deleted but each captures one instant.
A_ZH:
答：不够；近期用支持窗口内的PITR，多年历史另用手工快照或适用的长期备份保留策略。
考点：自动备份结合快照与事务日志，PITR窗口最多35天；RDS DB实例约每5分钟上传日志，近期恢复点看实际进度。手工快照留到主动删除，可长留，但每张只代表拍摄时刻。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateSnapshot.html

## aws-rb2-20261107-pack-gsc-053 | d2
TOPIC: Backups and deletion protection / 备份与删除保护
Q:
An RDS instance or DynamoDB table is backed up. Does backup prevent accidental deletion requests?
Q_ZH:
RDS实例或DynamoDB表已有备份，担心有人误发删除请求。备份就能阻止删除吗？
A:
Answer: No. Enable the resource's supported deletion protection and appropriately restrict administrative permissions.
Key point: Backups support recovery afterward; deletion protection rejects deletion while enabled. DynamoDB supports table-level deletion protection too.
Watch out: Someone authorized to disable protection may disable then delete; it is not an unlimited permission boundary.
A_ZH:
答：不能；启用该资源支持的删除保护，并正确限制管理权限。
考点：备份用于事后恢复，删除保护直接拒绝保护状态下的删除操作；DynamoDB也支持表级deletion protection。
易错提醒：有权关闭保护的身份仍可能先关闭再删除，保护不是无限制的权限边界。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_DeleteInstance.html

## aws-rb2-20261107-pack-gsc-056 | d2
TOPIC: Aurora cross-Region failover / Aurora跨Region接管
Q:
Aurora needs disaster recovery in another Region with little manual promotion or connection reconfiguration. How does replication become a write-recovery path?
Q_ZH:
Aurora要在第二Region准备灾备，故障后少做手工提升与改连接。怎样把复制副本变成恢复写入服务的路径？
A:
Answer: Use Aurora Global Database and supported managed switchover/failover to make the target Region primary; connect through the Global Database writer endpoint.
Key point: Cross-Region replication prepares data. The managed process changes the primary, and the global writer endpoint follows it, reducing manual promotion and entry changes.
Watch out: Replication is typically under one second but does not guarantee zero loss. Planned switchovers and failovers have different data risks.
A_ZH:
答：用Aurora Global Database及受支持的受管切换/故障转移流程，使目标Region成为主写入区；应用连接Global Database writer endpoint。
考点：跨Region复制先准备数据；受管流程负责更换主区，全球writer端点指向当前主区，减少自行提升和重配入口的工作。
易错提醒：跨Region复制通常低于1秒，但不是零损失保证；计划切换与故障转移的数据风险不同。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database.html

## aws-rb2-20261107-pack-gsc-064 | d2
TOPIC: Migration and continuous disaster recovery / 迁移与持续灾备
Q:
On-premises servers need low-change migration to AWS versus ongoing disaster recovery for on premises. Should both use the same tool merely because both replicate?
Q_ZH:
机房服务器要少改应用迁到AWS，与持续为机房建立灾后恢复能力，应该只因为都做复制就用同一种工具吗？
A:
Answer: No. Evaluate applicable Application Migration Service or other paths for whole-server migration, and Elastic Disaster Recovery for ongoing DR.
Key point: Migration ends by changing the running location; DR continuously maintains recoverability. Similar replication technology supports different lifecycles.
Watch out: Tools and new-customer eligibility must meet current support scope; product names do not replace cutover or recovery drills.
A_ZH:
答：不应；整机迁移评估适用的Application Migration Service等路径，持续灾备评估Elastic Disaster Recovery。
考点：迁移的终点是切换运行位置，灾备持续维护可恢复环境；相似复制技术服务于不同生命周期。
易错提醒：实际工具和新客户资格须符合当前支持范围，不能靠产品名省略切换或恢复演练。
SOURCE: https://docs.aws.amazon.com/drs/latest/userguide/what-is-drs.html

## aws-rb2-20261107-pack-gsc-065 | d2
TOPIC: Testing and final cutover / 测试与最终切换
Q:
Servers continuously replicate to AWS and need testing before cutover. Does a successful test launch remove the need for final synchronization while the source keeps writing?
Q_ZH:
服务器已持续复制到AWS，要先测试再正式切换。测试启动成功，就能忽略源端继续写入的最终同步吗？
A:
Answer: No. Testing validates replica operation. Final cutover must control source writes, verify final synchronization, and then move business traffic.
Key point: A test and the last production recovery point are different. Changes still generated by the source must be handled during cutover.
Watch out: Prevent uncontrolled test writes to production resources so validation does not disrupt real workloads.
A_ZH:
答：不能；测试用于验证副本运行，正式切换还要控制源端写入并核对最终同步，再迁移业务流量。
考点：测试与最后一个生产恢复点不同，源继续产生的变化必须在正式切换流程中处理。
易错提醒：测试环境应避免不受控地同时写生产资源，防止验证过程干扰真实业务。
SOURCE: https://docs.aws.amazon.com/mgn/latest/ug/launching-test-instances.html

## aws-rb2-20261107-pack-gsc-067 | d1
TOPIC: RPO and RTO / RPO与RTO
Q:
DR allows at most five minutes of lost data and one hour to restore service. What do RPO and RTO constrain?
Q_ZH:
灾备要求最多丢5分钟数据，并在1小时恢复服务。RPO和RTO分别限制什么？
A:
Answer: RPO limits the time span of tolerable data loss; RTO limits permitted service-recovery downtime.
Key point: Replication or backup progress determines how recent a recovery point is. Environment preparation, restoration, and traffic switching determine time to resume service.
Watch out: A backup every five minutes does not prove one-hour recovery; include replication completion and actual restoration time.
A_ZH:
答：RPO限制可丢失的数据时间范围；RTO限制恢复服务允许的停机时间。
考点：复制或备份进度影响能回到多近的恢复点；目标环境准备、恢复和切流过程影响多久能重新服务。
易错提醒：每5分钟做备份不自动证明1小时能恢复，还要计入复制完成和实际恢复时间。
SOURCE: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/plan-for-disaster-recovery-dr.html

## aws-rb2-20261107-pack-gsc-068 | d2
TOPIC: Pilot light and warm standby / Pilot light与Warm standby
Q:
Recovery must be faster than rebuilding from backups, without paying for two full running sites. How do pilot light and warm standby differ?
Q_ZH:
需要比“故障后从备份重建”更快恢复，又不想一直支付完整双站点运行成本。怎样理解pilot light和warm standby？
A:
Answer: Pilot light retains critical data and a minimal foundation; warm standby continuously runs a scaled-down usable environment.
Key point: More complete pre-disaster preparation usually reduces rebuilding/scaling work and recovery time, at greater ongoing cost.
Watch out: Names do not guarantee recovery time; exercise the actual workload.
A_ZH:
答：pilot light保留关键数据及最小基础；warm standby持续运行一套缩小的可用环境。
考点：灾前准备越完整，灾后补建与扩容越少，通常恢复越快，但持续成本也更高。
易错提醒：名称不是恢复时间保证，仍须按真实工作负载演练。
SOURCE: https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html

## aws-rb2-20261107-pack-gsc-070 | d2
TOPIC: Actual destination RPO / 目标端实际RPO
Q:
The source Region snapshots hourly, but cross-Region copies sometimes lag. Is the DR Region's RPO automatically one hour?
Q_ZH:
源Region每小时做快照，但跨Region复制偶尔拖延。灾备Region的RPO能直接算作1小时吗？
A:
Answer: No. Check the timestamp covered by the latest usable recovery point in the destination Region.
Key point: A completed source snapshot does not mean a recoverable destination copy has arrived. Copy delay adds a data-loss window.
Watch out: Arrival of a recovery point does not mean application recovery is complete; that is another part of RTO.
A_ZH:
答：不能；应看目标Region最近已可用恢复点覆盖到哪个时刻。
考点：源端完成快照不等于目标已经收到可恢复副本，复制延迟也会形成数据损失窗口。
易错提醒：恢复点已到达仍不代表应用已经恢复；那是RTO的另一部分。
SOURCE: https://docs.aws.amazon.com/aws-backup/latest/devguide/cross-region-backup.html

## aws-rb2-20261107-pack-gsc-071 | d2
TOPIC: VPN backup for Direct Connect / 专线备用VPN
Q:
On premises uses Direct Connect and must stay connected after the main circuit fails. Should a VPN be created during failure or prepared beforehand?
Q_ZH:
机房以Direct Connect访问AWS，主专线断开后仍要继续连接。应该故障时才建VPN，还是预先准备？
A:
Answer: Prebuild and test a Site-to-Site VPN backup and configure applicable route failover.
Key point: An established backup can be used when the circuit fails. Creating it then adds configuration, validation, and routing-convergence delay.
Watch out: The backup needs enough capacity; internet VPN performance is not identical to a dedicated circuit.
A_ZH:
答：预建并测试Site-to-Site VPN备用路径，配置适用的路由切换。
考点：线路故障时可直接用已建立的备用通路；临时创建还要等待配置、验证和路由收敛。
易错提醒：备用链路也要有足够容量，VPN经互联网的性能不等同专线。
SOURCE: https://docs.aws.amazon.com/directconnect/latest/UserGuide/backup-connections.html

## aws-rb2-20261107-pack-gsc-079 | d2
TOPIC: Durable work queues / 持久工作队列
Q:
EC2 may stop while processing work. How can unfinished tasks survive a coordinator process stopping?
Q_ZH:
任务交给EC2处理，实例可能处理中断。怎样避免协调进程一停就丢掉尚未完成的工作？
A:
Answer: Store tasks in a durable work queue such as SQS; acknowledge and delete only after successful processing, allowing failed work to retry.
Key point: Work state is not confined to one temporary coordinator. Unacknowledged tasks remain available for other consumers.
Watch out: Duplicate delivery remains possible. Use idempotency and appropriate retention and processing timeouts.
A_ZH:
答：用SQS等持久工作队列保存任务，消费者成功处理后再确认删除，失败任务允许重试。
考点：工作状态不只保存在某台临时协调实例内；未成功确认的任务仍能由其他消费者继续处理。
易错提醒：重复投递仍可能发生，须有幂等处理，并合理设置保留期和处理超时。
SOURCE: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html

## aws-rb2-20261107-pack-gsc-081 | d2
TOPIC: Visibility timeout / 可见性超时
Q:
Another consumer receives an SQS task before processing has finished. Which timeout should be checked first?
Q_ZH:
一个SQS任务还没处理完，就又被其他消费者取到。应先检查哪个超时？
A:
Answer: Check that visibility timeout covers actual processing time; extend it or renew it during processing as needed.
Key point: The message is only temporarily hidden from other consumers. After timeout, an undeleted message becomes visible again.
Watch out: An excessively long timeout delays failed-task retries; balance task duration and recovery requirements.
A_ZH:
答：检查visibility timeout是否覆盖实际处理时间，必要时延长或处理期间续期。
考点：消息只是暂时对其他消费者不可见；超时后尚未删除的消息会重新可见。
易错提醒：把超时设得极长也会拖慢失败任务重试，应按任务时长和恢复要求设置。
SOURCE: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html

## aws-rb2-20261107-pack-gsc-082 | d2
TOPIC: Business idempotency / 业务幂等
Q:
Payment messages or API retries may arrive more than once. How can double charging be prevented? Is message deduplication alone enough?
Q_ZH:
支付消息或API重试可能重复到达，怎样避免同一笔业务被扣款两次？只靠消息不重复就够吗？
A:
Answer: Use a stable business ID for idempotency checks, returning the existing result for a completed operation rather than charging again.
Key point: Business duplication and duplication of one message differ. Reliably recording business IDs and results lets retries identify the same operation.
Watch out: Checking and execution must avoid concurrency races. Resubmission with a new business ID is not automatically recognized by message deduplication.
A_ZH:
答：用稳定的业务ID做幂等检查，让已完成的同一笔操作返回已有结果，而非再次扣款。
考点：业务重复与某一次消息的重复不是同一层；把业务ID及处理结果可靠记录，重试才能识别同一业务。
易错提醒：检查和执行必须避免并发竞态；换一个新业务ID的重复提交不会自动被消息去重识别。
SOURCE: https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_prevent_interaction_failure_idempotent.html

## aws-rb2-20261107-pack-gsc-083 | d2
TOPIC: Dead-letter isolation / 死信隔离
Q:
One bad queue task fails repeatedly and must not retry forever at other work's expense. How is it isolated?
Q_ZH:
队列里某个坏任务一直失败，不能让它无限重试影响其他工作。怎样隔离？
A:
Answer: Set an appropriate retry count and dead-letter queue, moving messages over the threshold there for analysis.
Key point: Retry handles temporary failures; removing persistently failing tasks from the normal path prevents continuous consumer-capacity waste.
Watch out: Isolation is not a fix. Assess replay after correction, and consider its impact on strictly ordered workflows.
A_ZH:
答：设置合适的重试次数和dead-letter queue，把超过阈值的消息转入死信队列分析。
考点：暂时性故障可以重试，持续失败则移出正常处理路径，避免一直消耗消费者能力。
易错提醒：死信隔离不等于问题已修复；修正后才评估重放，严格顺序业务还要考虑隔离的影响。
SOURCE: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html

## aws-rb2-20261107-pack-gsc-085 | d2
TOPIC: End-to-end message ordering / 端到端消息顺序
Q:
SNS broadcasts orders to queues, and messages for each order ID must remain ordered. Is changing only the final SQS queue to FIFO sufficient?
Q_ZH:
SNS广播订单到多个队列，同一订单ID的消息要保持顺序。只把末端SQS改成FIFO够吗？
A:
Answer: No. Use a supported SNS FIFO-to-SQS FIFO path and put messages for the same order ID in the same message group.
Key point: A group collects messages requiring mutual order. Relevant hops must preserve it; the final FIFO cannot reconstruct order already lost upstream.
Watch out: Ordering applies within the relevant group, not globally across all order IDs.
A_ZH:
答：不够；使用受支持的SNS FIFO到SQS FIFO链路，并把同一订单ID的消息归入同一message group。
考点：消息组把需要互相有序的消息放在同一组；相关环节都要保留组内顺序，上游已打乱时末端FIFO不能猜回原顺序。
易错提醒：顺序只在相应消息组内保证，不要求所有订单ID之间全局串行。
SOURCE: https://docs.aws.amazon.com/sns/latest/dg/fifo-message-grouping.html

## aws-rb2-20261107-pack-gsc-087 | d2
TOPIC: RabbitMQ cross-AZ availability / RabbitMQ跨AZ高可用
Q:
Amazon MQ for RabbitMQ needs cross-AZ availability. How should it deploy, and why not copy ActiveMQ active/standby?
Q_ZH:
Amazon MQ for RabbitMQ要跨AZ高可用，应如何部署，为什么不能照搬ActiveMQ的active/standby？
A:
Answer: Use RabbitMQ-supported multi-node cross-AZ clustering and corresponding queue replication, not ActiveMQ's primary/standby pattern.
Key point: Applicable replicas span AZs so others can serve queues after node or AZ failure. A single node retains a single point of failure.
Watch out: Clustering alone does not give every queue the same replication guarantee; use the chosen version's supported queue-availability mechanism.
A_ZH:
答：使用RabbitMQ支持的跨AZ多节点集群与相应队列复制，而不是套用ActiveMQ主备模式。
考点：适用副本分散在不同AZ，一个节点或AZ失效后，其他副本可继续提供队列服务；只有单个节点会保留单点风险。
易错提醒：节点组成集群不代表任意队列都自动有相同复制保证，须使用所选版本支持的队列高可用机制。
SOURCE: https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/rabbitmq-broker-architecture.html

## aws-rb2-20261107-pack-gsc-088 | d2
TOPIC: Durable workflow state / 持久工作流状态
Q:
Order processing needs steps, external waits, retries, and progress between steps. Should wait state live only inside one function invocation?
Q_ZH:
订单处理有多个步骤，需要等待外部确认、失败重试，并在步骤之间保留进度。应该把等待状态只放在某次函数内吗？
A:
Answer: No. Use an appropriate durable workflow orchestrator such as Step Functions.
Key point: The workflow manages step state, waits, and retries. Individual business functions perform their work without running continuously to retain the entire process's progress.
Watch out: Choose a workflow type supporting required duration and execution semantics, and handle business idempotency.
A_ZH:
答：不应；使用Step Functions等适用的持久工作流编排。
考点：工作流管理步骤状态、等待和重试，单次业务函数只完成自己的处理，不必一直运行来保存整条流程的进度。
易错提醒：仍须选择支持所需时长和执行语义的工作流类型，并处理业务幂等。
SOURCE: https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html

## aws-rb2-20261107-pack-gsc-091 | d2
TOPIC: Kinesis replay windows / Kinesis重读窗口
Q:
A Kinesis consumer may stop for a long time and must replay unprocessed records. Can adding shards recover expired records?
Q_ZH:
Kinesis消费者停了较长时间，恢复后必须重读未处理记录。只增加shard就能找回已经过期的数据吗？
A:
Answer: No. Set stream retention in advance to cover expected outage and catch-up time.
Key point: Kinesis retains records for 24 hours by default, extendable to 365 days. Retention determines replay history; shards determine throughput. More throughput cannot recover deleted records.
Watch out: Retention remains finite and the consumer must catch up fast enough.
A_ZH:
答：不能；应提前把流记录保留期限设到能覆盖预计中断和追赶窗口。
考点：Kinesis默认保留24小时，可按需延长至365天；保留窗口决定能重读多远，shard容量影响吞吐，增加吞吐找不回已删除记录。
易错提醒：保留窗口仍有限，也要确认消费者追赶速度足够。
SOURCE: https://docs.aws.amazon.com/streams/latest/dev/kinesis-extended-retention.html

## aws-rb2-20261107-pack-gsc-115 | d2
TOPIC: Application health and ASG / 应用健康与ASG
Q:
An EC2 OS works but its Web application cannot handle requests. Can an ASG using only EC2 basic health checks guarantee replacement?
Q_ZH:
EC2操作系统仍正常，但Web应用已无法处理请求。ASG只看EC2基础健康检查，能保证替换这台实例吗？
A:
Answer: No. Configure load-balancer health checks reflecting application status and let the ASG use the relevant ELB results.
Key point: Machine survival and application availability differ. The ASG needs an application-unhealthy signal to replace for that reason.
Watch out: Removing an instance from load-balanced traffic does not automatically authorize ASG termination and replacement.
A_ZH:
答：不能；应配置能反映应用状态的负载均衡健康检查，并让ASG使用相应ELB健康结果。
考点：机器存活与应用可用是不同层次，ASG必须接收到应用不健康信号才能按该原因替换。
易错提醒：负载均衡器把实例移出流量，不自动等于ASG已经获准据此终止替换。
SOURCE: https://docs.aws.amazon.com/autoscaling/ec2/userguide/health-checks-overview.html

## aws-rb2-20261107-pack-gsc-116 | d2
TOPIC: Capacity reserve for AZ failure / AZ故障容量余量
Q:
An application spans AZs and must immediately handle normal traffic after losing one. Is one instance per AZ sufficient?
Q_ZH:
应用平时跨多个AZ运行，要求少一个AZ后仍立即承受正常流量。只保证每个AZ各有一台就够吗？
A:
Answer: No. Total available capacity in the surviving AZs must still meet required service capacity.
Key point: Surviving running capacity must carry traffic at failure time. Both failure-domain distribution and capacity reserve are necessary.
Watch out: Auto Scaling replenishment takes startup time; future replacement capacity is not capacity already available at failure.
A_ZH:
答：不够；必须让剩余AZ的可用容量合计仍达到所需服务容量。
考点：故障发生时要用还在运行的容量承接流量，故障域分散与容量余量缺一不可。
易错提醒：Auto Scaling会补建实例，但启动需要时间，不能把未来补足当作故障当下已有容量。
SOURCE: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/design-your-workload-to-withstand-component-failures.html

## aws-rb2-20261107-pack-gsc-118 | d2
TOPIC: EC2 host recovery / EC2底层主机恢复
Q:
A legacy application runs on one instance. After host failure it should recover its instance identity and disks. Under supported conditions, how does EC2 automatic recovery help?
Q_ZH:
遗留应用只能运行单个实例，底层主机故障后希望恢复原实例身份和磁盘。支持条件下EC2自动恢复怎样帮助？
A:
Answer: It recovers the instance on healthy underlying hardware while retaining applicable identity, addresses, and attached EBS state.
Key point: It addresses infrastructure failure rather than making a nonparallel application replicated. The instance can boot on new healthy hardware.
Watch out: RAM is not preserved. It does not fix arbitrary application faults or replace AZ-level DR.
A_ZH:
答：把实例恢复到健康的底层主机，并保留适用的实例身份、地址和附加EBS等状态。
考点：它处理底层基础设施故障，不是让不支持并行的应用凭空变成多副本；实例可在新的健康硬件上继续启动。
易错提醒：RAM内容不因此保留，也不能修复任意应用软件故障或替代AZ级灾备。
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-recover.html

## aws-rb2-20261107-pack-gsc-126 | d2
TOPIC: DNS primary/secondary routing / DNS主备路由
Q:
A backup site should receive traffic only when the primary fails. How should DNS answer using health?
Q_ZH:
主站正常时不希望用备用站，主站故障才切到备用入口。DNS应怎样按健康状态回答？
A:
Answer: Use applicable Route 53 failover routing with required health evaluation.
Key point: Return the primary while healthy and the secondary when the primary is judged unhealthy, matching their primary/backup roles.
Watch out: DNS changes do not replicate business data. Client caching and recovery preparation affect actual takeover time.
A_ZH:
答：使用适用的Route 53 failover路由，并配置所需健康评估。
考点：正常时回答主资源，主资源被判不健康时回答备用资源，符合主用与备用的关系。
易错提醒：切DNS不复制业务数据，客户端缓存和恢复准备也影响实际接管时间。
SOURCE: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-failover.html

## aws-rb2-20261107-pack-vc-001 | d1
TOPIC: SQS-to-Lambda mapping / SQS到Lambda映射
Q:
Tasks are in SQS and should run on Lambda without a self-managed permanent poller. Under default whole-batch acknowledgment, who retrieves messages and confirms completion?
Q_ZH:
任务已进入SQS，想由Lambda处理、免自建常驻轮询程序。按默认整批确认方式，谁负责取消息与确认完成？
A:
Answer: Configure an SQS event source mapping. The Lambda service polls, invokes the function in batches, and deletes messages after whole-batch success.
Key point: The queue stores work and the function processes it; the managed connection retrieves and acknowledges tasks without a dedicated EC2 polling loop.
Watch out: Failed-batch messages may reappear after visibility timeout; the function must safely handle duplicates.
A_ZH:
答：配置SQS事件源映射：Lambda服务轮询队列并批量调用函数，整批成功后删除消息。
考点：队列保存待办，函数处理业务；取任务和确认完成由受管连接承担，不需另养一台EC2来循环取消息。
易错提醒：失败批次的消息可在可见性超时后重新出现，函数仍须能安全处理重复消息。
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html

## aws-rb2-20261107-pack-vc-009 | d2
TOPIC: Delivery and execution failures / 投递与执行失败隔离
Q:
SNS sends events to Lambda. Final failures must be retained for 14 days for investigation. Is increasing SNS retries sufficient, and where should failures go?
Q_ZH:
SNS把事件交给Lambda处理，要把最终失败的事件保留14天排查。只增加SNS投递重试够吗，失败该接在哪里？
A:
Answer: No. Route SNS delivery failures to the subscription's SQS DLQ. For events Lambda accepted but ultimately failed asynchronously, use the function's SQS on-failure destination with required retention.
Key point: Delivery and business processing are different stages; isolation must capture the failed stage. SQS retains messages for at most 14 days.
Watch out: Retained failure records do not fix the business operation; replay must safely handle duplicates.
A_ZH:
答：不够；SNS交付失败用订阅的SQS死信队列；Lambda已接收但异步处理最终失败，用函数的SQS失败目的地，并配置所需保留期。
考点：交付和业务处理是不同阶段，隔离要接住实际失败的那一段；SQS消息最长可保留14天。
易错提醒：留下失败记录不等于修复业务，重放仍须安全处理重复。
SOURCE: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html

## aws-rb2-20261107-pack-vc-015 | d2
TOPIC: API canary deployment / API金丝雀发布
Q:
A REST API Gateway release should first receive a small share of real requests before expansion. Which mechanism fits, and why is it safer than immediate full cutover?
Q_ZH:
API Gateway REST API要发新版本，先让少量真实请求验证，通过后再推广。用什么机制，为什么比直接全量切换稳妥？
A:
Answer: Enable canary deployment on the stage: assign a small traffic percentage to the new deployment, then promote after validation.
Key point: A stage is the API's release-entry configuration. The old deployment serves most traffic while a controlled real-traffic share validates the new one, limiting impact when problems appear.
Watch out: This splits requests inside API Gateway. Changing a Route 53 alias to the new API switches the whole entry.
A_ZH:
答：启用stage的canary（金丝雀）发布：给新部署设置小流量比例，验证后提升为正式部署。
考点：stage是API的发布入口配置。旧部署继续处理大部分请求，新版本先用受控比例的真实流量验证，发现问题时受影响范围更小。
易错提醒：这是API Gateway内部的请求分流；仅把Route 53别名改到新API会整体切换入口。
SOURCE: https://docs.aws.amazon.com/apigateway/latest/developerguide/canary-release.html

## aws-rb2-20261107-pack-ca13 | d2
TOPIC: Global HTTP edge entry / 全球HTTP边缘入口
Q:
A website serves global HTTP users from regional static and dynamic origins. How can requests first enter AWS near users?
Q_ZH:
网站向全球用户交付HTTP内容，静态和动态源站都在Region。怎样让请求先走靠近用户的AWS入口？
A:
Answer: Use CloudFront distribution. API Gateway REST APIs also offer an edge-optimized entry with a built-in CloudFront path.
Key point: Edge locations accept nearby connections, serving eligible cached content and forwarding misses or dynamic requests to origins, reducing long-distance access impact.
Watch out: An edge entry does not move business computation near every user; dynamic requests may still reach regional origins.
A_ZH:
答：使用CloudFront分发；API Gateway REST API也有内置CloudFront路径的edge-optimized入口。
考点：边缘位置就近承接连接，适用内容可从缓存返回，未命中或动态请求再到源站，减少远距离访问的影响。
易错提醒：边缘入口不等于业务计算已经迁到每个用户附近，动态请求仍可能访问区域源站。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/website-hosting-cloudfront-walkthrough.html

## aws-rb2-20261107-pack-ca16 | d1
TOPIC: Static website hosting / 静态网站托管
Q:
A website contains only HTML, CSS, browser JavaScript, and images, with no server-executed code. How can it be hosted with less server maintenance?
Q_ZH:
网站只有HTML、CSS、浏览器JavaScript和图片，没有需要服务器执行的代码。怎样托管可少维护服务器？
A:
Answer: Use S3 static website hosting or a suitable managed static-frontend service.
Key point: Storage returns page files directly and scripts execute in browsers. Server-side code such as PHP needs a compute backend and cannot execute in S3 static hosting.
A_ZH:
答：可用S3静态网站托管或适配的托管静态前端服务。
考点：存储直接返回页面文件，脚本在浏览器运行；PHP等服务器端代码需要计算后端，不能由S3静态托管执行。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteHosting.html

## aws-rb2-20261107-pack-ca17 | d2
TOPIC: Direct API service integration / API直接服务集成
Q:
An HTTP entry handles short business logic in one case and only forwards to SQS or Kinesis/Firehose in another. Must every backend go through Lambda?
Q_ZH:
HTTP入口收到请求：一类要执行短时业务逻辑，另一类只转发到SQS队列或Kinesis/Firehose数据流。后端都必须经过Lambda吗？
A:
Answer: No. API Gateway can invoke Lambda for business computation; pure forwarding can call the target through a supported AWS service integration.
Key point: Managed entry and compute handle requests without maintaining always-running Web server capacity. Pure forwarding can proxy supported AWS APIs and omit the intermediate function.
A_ZH:
答：不必。有业务计算时可由API Gateway调用Lambda；纯转发可用受支持的AWS服务集成直接调用目标服务。
考点：入口和计算由托管服务按请求承载，不必自己维持始终运行的Web服务器容量；纯转发可代理受支持的AWS API，省去中间函数。
SOURCE: https://docs.aws.amazon.com/apigateway/latest/developerguide/integrating-api-with-aws-services-kinesis.html

## aws-rb2-20261107-pack-cb16 | d2
TOPIC: Peering and routes / 对等连接与路由
Q:
EC2 in two nonoverlapping VPCs needs direct private communication, without centralized inspection or transit-appliance failure/bandwidth bottlenecks. What fits, which routes are needed, and why?
Q_ZH:
两个地址不重叠的VPC要让EC2直接私网通信，没有集中检查需求，也不想引入中转设备单点或带宽瓶颈。选什么，路由还须怎样配，为什么？
A:
Answer: Use VPC peering and configure peer routes in both communicating subnets' route tables.
Key point: Peering uses VPC infrastructure without a separate gateway or transit appliance, avoiding that appliance's failure and bandwidth bottlenecks. Request and response routes still need separate configuration. Peering has no connection fee and avoids TGW attachment-hour and processing charges, but actual data-transfer charges still apply.
Watch out: Any overlapping IPv4 or IPv6 CIDR prevents peering, even if only nonoverlapping portions would be used.
A_ZH:
答：选择VPC peering，并为两边参与通信子网设置指向对端的路由。
考点：peering复用VPC基础设施，不依赖单独网关或中转设备，因此连接本身不引入这种设备的单点与带宽瓶颈；请求和响应的路由仍须分别配置。 peering连接本身不另收连接费；相较TGW可避免其附件小时费和处理费，但仍须计实际数据传输费。
易错提醒：两个VPC的IPv4或IPv6 CIDR只要有重叠，就不能建立peering；即便只打算使用不重叠的那部分地址也不行。
SOURCE: https://aws.amazon.com/vpc/pricing/

## aws-rb2-20261107-pack-cb18 | d2
TOPIC: RDS connection proxy / RDS连接代理
Q:
Lambda concurrency spikes or a database writer changes. How does RDS Proxy reduce the application's direct exposure to connection changes?
Q_ZH:
Lambda并发猛增或数据库writer切换时，想让应用少直接承担数据库连接变化。RDS Proxy怎样帮助？
A:
Answer: Connect applications to RDS Proxy, which manages database connection pools and reconnects the backend during applicable failovers.
Key point: It separates client and database connection lifecycles, reducing connection storms and the impact of backend-role changes on clients.
Watch out: It neither caches query results nor removes the database promotion process.
A_ZH:
答：让应用连接RDS Proxy，由代理管理到数据库的连接池，并在适用故障切换中重新连接后端。
考点：它隔开客户端连接与数据库连接的生命周期，减少连接风暴，也降低后端角色变化对客户端的影响。
易错提醒：代理不缓存查询结果，也不让数据库本身的提升过程消失。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html

## aws-rb2-20261107-pack-cc03 | d2
TOPIC: Occasional SQL on S3 / S3数据偶发SQL
Q:
Structured results or logs are in S3 and need occasional SQL with little server administration. Must they first move into a self-managed database?
Q_ZH:
结构化结果或日志已经在S3，偶尔用SQL分析且希望少管服务器，是否需要先搬到自管数据库？
A:
Answer: Use Athena with appropriate table definitions, without moving data into a self-managed database. Encrypted data must meet readable-format requirements and have required table properties and permissions.
Key point: Athena scans S3 in parallel using table definitions, with compute occurring for queries. It supports qualifying CSE-KMS client-encrypted data, not arbitrary custom ciphertext.
Watch out: EMRFS-uploaded CSE-KMS Parquet requires disabling multipart; same-Region, compatible encryption-client, and correct key-use requirements still apply.
A_ZH:
答：用Athena查询S3数据并建立相应表定义，不必先搬进自管数据库；加密数据还要符合其读取格式并配好所需表属性和权限。
考点：Athena查询引擎按表定义并行扫描S3，计算按查询发生。它支持符合要求的CSE-KMS客户端加密数据，不等于任何自定义密文都能直接解释。
易错提醒：EMRFS上传的CSE-KMS Parquet需禁用multipart；同Region、兼容加密客户端和正确用钥配置仍须满足。
SOURCE: https://aws.amazon.com/athena/faqs/

## aws-rb2-20261107-pack-cc17 | d2
TOPIC: Event filtering and transformation / 事件筛选与转换
Q:
Application events or GuardDuty findings must conditionally reach functions, each receiving only needed fields. What do EventBridge patterns and input transformation each do, and why?
Q_ZH:
应用事件或GuardDuty发现要按条件送给处理函数，每个函数只接收需要的字段。EventBridge事件模式与输入转换各负责什么，为什么？
A:
Answer: Event patterns filter and route events; target input transformers select or rearrange fields sent to functions.
Key point: Sources include application events, directly published service findings, or supported API calls recorded by CloudTrail. Filtering decides recipients; transformation decides content. Target functions still perform actual resource changes.
A_ZH:
答：事件模式筛选并路由事件；目标的input transformer裁剪或重排发送给函数的字段。
考点：来源既可为应用事件、服务直接发布的发现，也可为CloudTrail记录的受支持API调用；筛选决定交给谁，转换决定对方收到什么，实际改资源仍由目标函数执行。
SOURCE: https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_findings_eventbridge.html

## aws-rb2-20261107-pack-cc22 | d2
TOPIC: Managed relational databases / 关系数据库托管
Q:
A relational application must retain applicable engine and transaction capabilities while reducing server/platform maintenance. Why consider RDS instead of self-managing EC2?
Q_ZH:
关系应用要保留适用的数据库引擎与事务能力，又希望减少服务器和数据库平台维护，为什么考虑RDS而非在EC2自管？
A:
Answer: Migrate to the corresponding RDS engine if its engine and features are compatible.
Key point: RDS handles database infrastructure and platform maintenance. Customers still choose database configuration, maintenance windows, and data access. Object or key-value models may require application changes.
A_ZH:
答：在引擎和功能兼容的前提下迁移到相应RDS。
考点：RDS接管数据库基础设施和平台维护；客户仍决定数据库配置、维护窗口与数据访问，换成对象或键值模型可能要求应用改造。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html

## aws-rb2-20261107-pack-cmp-m15 | d2
TOPIC: Recording diarization and redaction / 录音分离与脱敏
Q:
Customer recordings need text. Which features respectively distinguish speakers and hide PII in the output?
Q_ZH:
客户录音要变成文字。要区分不同人的发言，与要在输出中隐藏PII，两种条件分别启用什么？
A:
Answer: Use Transcribe, enabling speaker diarization to separate speakers and supported PII redaction to hide personal information.
Key point: Transcription turns speech into text. Diarization adds speaker labels and timing; redaction identifies and masks sensitive content. They address different text requirements and cannot replace one another.
Watch out: Language and transcription-mode support conditions apply. A speaker label does not establish a person's real identity.
A_ZH:
答：用Transcribe转录；区分发言启用speaker diarization（说话人分离），隐藏PII启用受支持的PII redaction（个人信息脱敏）。
考点：转录把声音变文字；分离为不同声音的文字添加说话人标签和时间信息，脱敏识别并遮蔽敏感内容。两者处理的是文字的不同需求，不能互相替代。
易错提醒：这些功能须符合相应语言及转录方式的支持条件；说话人标签不等于查明此人的真实身份。
SOURCE: https://docs.aws.amazon.com/transcribe/latest/dg/diarization.html

## aws-rb2-20261107-pack-cmp-m19 | d2
TOPIC: Managed transfer backends / 托管传输后端
Q:
Partners must retain SFTP or FTP clients with less transfer-server administration. Which backend fits object access versus Linux shared files with user/group permissions?
Q_ZH:
伙伴要保留SFTP或FTP客户端、少管传输服务器。后端只需对象存取，与要Linux共享文件及用户/组权限时，怎样选择？
A:
Answer: Use a Transfer Family entry supporting the protocol. Choose S3 for objects, or EFS with POSIX user/group identities for shared Linux files.
Key point: Transfer Family supports SFTP, FTPS, and FTP, with scalable multi-AZ-redundant managed entries. S3 retains objects while EFS retains shared-file/POSIX semantics; protocol entry does not change backend semantics.
Watch out: FTP is not encrypted SFTP. Meet protocol-specific endpoint, networking, identity, and file-permission requirements.
A_ZH:
答：用支持该协议的Transfer Family入口；对象存取接S3，Linux共享文件接EFS并配置POSIX用户/组身份。
考点：Transfer Family支持SFTP、FTPS和FTP，托管入口可跨AZ冗余并伸缩；S3保存对象，EFS保留共享文件及POSIX权限，协议入口不改变后端文件语义。
易错提醒：FTP不是加密的SFTP；还要满足所用协议的端点、网络、身份和文件权限要求。
SOURCE: https://docs.aws.amazon.com/transfer/latest/userguide/what-is-aws-transfer-family.html

## aws-rb2-20261107-pack-lm01 | d2
TOPIC: Large batch-job platforms / 大规格批作业平台
Q:
A CPU-heavy batch job needs 64 vCPUs and 512 GiB in one execution unit, finishing within 15 minutes. Why not Lambda or Lightsail, and which platform fits?
Q_ZH:
CPU密集的批作业实际要在一个执行单位里用64vCPU和512GiB内存，15分钟内跑完。Lambda和Lightsail为什么承载不了，应放到哪类平台？
A:
Answer: Lambda is capped at 10,240 MB memory, with proportional CPU (about one vCPU at 1,769 MB), and 15 minutes per invocation. Lightsail targets simple starter websites/applications. Schedule this large job with AWS Batch on sufficiently sized EC2 compute.
Key point: First check platform hard limits. Functions provide quota-limited temporary execution; simple VPS targets small workloads. Jobs above function and hostless-container limits need Batch-scheduled EC2 resources.
Watch out: Fargate permits up to 32 vCPUs/244 GiB per job. Below its limits it can avoid host maintenance; above them use Batch with EC2.
A_ZH:
答：Lambda单函数内存上限10,240MB、CPU按所配内存比例给（约1,769MB对应1vCPU），单次调用最长15分钟；Lightsail面向快速起步的简易网站与应用。这种大规格作业应由AWS Batch在足够规格的EC2计算环境里调度。
考点：平台先过硬上限：函数计算是受配额限制的短暂执行环境，简配VPS面向小型负载；超过函数与免主机容器上限的作业，用Batch调度EC2资源。
易错提醒：Fargate单作业上限为32vCPU/244GiB：作业低于上限且想免维护主机时Fargate可行，超过则Batch+EC2。
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html

## aws-rb2-20261107-pack-na02 | d2
TOPIC: BI dashboard sharing / BI仪表板分享
Q:
Data comes from S3 and relational databases. Teams need interactive charts, with management and staff seeing different scopes. How should dashboards be provided and assigned?
Q_ZH:
数据来自S3和关系数据库，团队要交互图表，管理层与普通员工的查看范围不同。应怎样提供并分配仪表板？
A:
Answer: Connect datasets in QuickSight, build visualizations, publish dashboards, and share with appropriate QuickSight users or groups.
Key point: The BI layer organizes queried data into business charts. Dashboard recipients determine who can view it; possessing an AWS IAM role does not mean the dashboard is shared with you.
Watch out: Dashboard viewers can also see data used by related analyses; sensitive rows/columns need separate restrictions.
A_ZH:
答：用QuickSight连接相应数据集、建立可视化并发布仪表板，再分享给相应QuickSight用户或组。
考点：BI层把查询数据组织成业务图表；仪表板的分享对象决定谁能查看，拥有AWS IAM角色并不等于已被分享该仪表板。
易错提醒：能查看仪表板的用户也能看到相关分析使用的数据；敏感行列仍须另外限制。
SOURCE: https://docs.aws.amazon.com/quick/latest/userguide/sharing-a-dashboard.html

## aws-rb2-20261107-pack-na05 | d2
TOPIC: Multi-AZ object storage / 多AZ对象存储
Q:
Applications need durable files across AZs through object access, without mounting disks. Should those files be tied to one EC2 EBS volume?
Q_ZH:
应用只需按对象存取文件，无须把它挂成磁盘；大量持久文件要供多个AZ的应用访问。应把它绑定某台EC2的EBS卷吗？
A:
Answer: Prefer an appropriate multi-AZ S3 storage class such as S3 Standard instead of a single-AZ block volume.
Key point: Regional object storage keeps independent objects accessible through APIs, beyond a single instance/block-volume lifecycle. Multi-AZ classes also distribute AZ failure risk.
A_ZH:
答：优先放在适合的多AZ S3存储类别，例如S3 Standard，而不绑定单个AZ的块卷。
考点：区域对象存储把文件作为独立对象保存，应用按API访问，不受单个实例和其块卷的生命周期约束；多AZ类别还分散单AZ故障风险。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/DataDurability.html

## aws-rb2-20261107-pack-nb01 | d2
TOPIC: Dedicated connections and internet VPNs / 专线与互联网VPN
Q:
On premises needs long-term AWS access without public-internet transit, or wants its main link unaffected by internet congestion. Which connection fits?
Q_ZH:
本地要长期连接AWS，数据不得经公共互联网，或要避免互联网拥塞影响主链路，应选什么？
A:
Answer: Use AWS Direct Connect. Internet-based Site-to-Site VPN is a different transport path.
Key point: Direct Connect supplies a dedicated connection to AWS, bypassing public-internet transit. VPN encryption does not turn the internet into a dedicated circuit.
A_ZH:
答：选择AWS Direct Connect专线；经过公共互联网的Site-to-Site VPN不是同一种承载路径。
考点：专线提供到AWS的专用网络连接，绕开公共互联网承载；VPN的加密不能把互联网变成专线。
SOURCE: https://aws.amazon.com/directconnect/

## aws-rb2-20261107-pack-nc01 | d2
TOPIC: Managed stream processing / 托管流计算
Q:
Continuously arriving data needs near-real-time analysis before long-term storage, with little cluster maintenance. Which processing fits, and why is a delivery stream alone insufficient?
Q_ZH:
数据持续到达，必须在进入长期存储前近实时分析，又想少维护计算集群。应选哪类处理，为什么只建一条存储交付流不够？
A:
Answer: Use managed stream processing such as Managed Service for Apache Flink, reading supported Kinesis Data Streams or Kafka/MSK input. Deliver results through a Firehose sink or write S3 with an S3 sink.
Key point: Processing code consumes source records and sinks emit results. Firehose is an output delivery service, not Flink's input queue. Creating a delivery stream does not connect analysis code; compatible source and output connectors are required.
Watch out: Occasional SQL over data already in S3 can use Athena, which queries landed data.
A_ZH:
答：用Managed Service for Apache Flink等托管流处理，读取Kinesis Data Streams或Kafka/MSK等支持的输入；处理后可用Firehose sink交付，或用S3 sink直接写S3。
考点：处理代码消费源记录，sink把计算结果写出；Firehose是输出交付服务，不是Flink输入队列。创建交付流并不会自动接通分析代码，仍须配置兼容的源与输出连接器。
易错提醒：如果只是对已在S3的数据偶发做SQL查询，可用Athena；它处理的是已落地数据。
SOURCE: https://docs.aws.amazon.com/managed-flink/latest/java/how-sinks.html

## aws-rb2-20261107-pack-nc04 | d2
TOPIC: SQS ordering and cost / SQS顺序与费用
Q:
How does SQS choice change between at-least-once asynchronous delivery and ordered receipt for each business ID? Why not proactively choose FIFO when order is unnecessary?
Q_ZH:
异步请求只需至少投递一次，与同一业务ID必须按发送顺序接收，这两个条件怎样改变SQS选型？没有顺序要求时，为什么不必主动选择FIFO？
A:
Answer: Use Standard when ordering is unnecessary; use FIFO with message groups by business ID when order is required.
Key point: Standard already meets at-least-once delivery without strict order. In verified comparable ordinary paid us-east-1 tiers, Standard requests cost less than FIFO, avoiding payment for unneeded ordering.
Watch out: Delivery guarantee is not business success. Standard may duplicate; failures and retries still need separate design.
A_ZH:
答：无顺序要求时可用Standard；同一业务ID必须有序时，用FIFO并按该ID设置message group。
考点：Standard已经满足至少一次且无需严格顺序的条件；已核us-east-1相同普通付费档中，Standard请求单价低于FIFO，不必为未要求的顺序能力选择更高请求费率。
易错提醒：投递保证不是业务成功；Standard可能重复，处理失败与重试仍要单独设计。
SOURCE: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html

## aws-rb2-20261107-pack-nc07 | d2
TOPIC: CLI and DataSync transfers / CLI与DataSync传输
Q:
On-premises files move to S3 once at 100 GB with no further changes versus ongoing changes with shared-link bandwidth control. Which transfer fits each?
Q_ZH:
机房文件搬到S3：一次性100GB后不再改，与源文件持续变化、还要控制共享链路占用，传输方式怎样选？
A:
Answer: Use AWS CLI s3 sync for a small one-time move; use DataSync tasks for managed ongoing transfer, validation, or throttling.
Key point: CLI compares and copies files needing updates and verifies certificates over encrypted connections by default. DataSync protects AWS-bound transfers with TLS and manages repetition, validation, and bandwidth limits.
Watch out: Verify completion against volume, bandwidth, and deadline. One-time transfer does not mean every scale suits CLI.
A_ZH:
答：一次小规模搬运可用AWS CLI s3 sync；持续托管传输、校验或限速需求可用DataSync任务。
考点：CLI比较并复制需更新的文件，默认通过加密连接校验证书；DataSync以TLS保护传入AWS的数据，并管理重复传输、校验和限速。
易错提醒：仍须按数据量、可用带宽和期限验证能否完成；一次性不等于任何规模都适合CLI。
SOURCE: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-options.html

## aws-rb2-20261107-pack-nc11 | d2
TOPIC: Graph traversal queries / 图遍历查询
Q:
Queries follow connections between people or resources through multiple relationship levels instead of fetching one record by key. Why consider Neptune?
Q_ZH:
查询的重点是沿人或资源之间的连接寻找多层关联，而非按键取一条记录，为什么考虑Neptune？
A:
Answer: Use an appropriate graph model with entities as nodes and relationships as edges, traversing connections with graph queries.
Key point: Graphs treat relationships as first-class data for multihop connections. Merely mentioning employees or relationships is insufficient; the deciding feature is traversing those relationships.
A_ZH:
答：用适合的图模型，以节点和边表示实体及关系，并用图查询沿连接遍历。
考点：图把关系作为一等数据，便于表达多跳连接；数据里出现“员工”或“关系”二字本身还不够，关键是查询是否沿关系走。
SOURCE: https://docs.aws.amazon.com/neptune/latest/userguide/intro.html

## aws-rb2-20261107-pack-ns01 | d2
TOPIC: Stream delivery and transformation / 流记录交付转换
Q:
Continuous records need transformation and near-real-time delivery to S3, OpenSearch, or Redshift. Is creating Kinesis Data Streams enough?
Q_ZH:
持续流记录要转换后近实时进入S3、OpenSearch或Redshift。只建Kinesis Data Streams就够吗？
A:
Answer: No. Data Firehose can manage buffered delivery and supported format conversion or invoke Lambda for custom transformations.
Key point: A stream retains records; a delivery stream processes and writes destinations, such as JSON-to-Parquet delivery to S3. AWS manages delivery servers and host/AZ availability migration.
A_ZH:
答：不够；Data Firehose可托管缓冲交付，做受支持的格式转换，或调用Lambda做自定义变换。
考点：流负责保存记录，交付流负责加工并写目的地；例如写S3时可把JSON转Parquet。AWS管理交付服务器及主机、AZ可用性迁移。
SOURCE: https://docs.aws.amazon.com/firehose/latest/dev/basic-deliver.html

## aws-rb2-20261107-pack-ns02 | d2
TOPIC: Fixed public entry addresses / 固定公网入口
Q:
Client firewalls need fixed entry IPs. How do NLB and Global Accelerator differ for one Region versus one entry spanning Regions?
Q_ZH:
客户防火墙要求固定入口IP。单Region负载均衡与多Region统一入口，应怎样区分NLB和Global Accelerator？
A:
Answer: Use NLB per-AZ static addresses for a regional entry. Consider Global Accelerator for a unified fixed multi-Region entry with health-based routing.
Key point: NLB distributes within one Region. Global Accelerator carries TCP/UDP from nearby edges over AWS's network and selects regional endpoints by performance and health. A public accelerator can target supported internal NLBs/ALBs without publicizing backends.
Watch out: An ALB DNS name does not make its current resolved IPs permanently fixed firewall allow-list entries.
A_ZH:
答：区域入口可用NLB的每AZ静态地址；多Region应用需要统一固定入口并健康选路时，考虑Global Accelerator。
考点：NLB在一个Region内分流；Global Accelerator把TCP/UDP流量从附近边缘送入AWS网络，再按性能和健康选择区域端点。公网加速器也可连接受支持的内部NLB/ALB，后端不必因此改为公网。
易错提醒：ALB的DNS名称不代表客户端能永远固定其当前解析IP；不能直接把动态地址当防火墙白名单。
SOURCE: https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html

## aws-rb2-20261107-pack-ns04 | d2
TOPIC: SaaS transfers and encryption keys / SaaS传输与用钥
Q:
Supported SaaS such as Salesforce exposes APIs and must deliver to S3 or Redshift with little extraction code. If S3 data needs a customer managed KMS key, what should be checked/configured first, and why?
Q_ZH:
Salesforce等受支持SaaS已提供API，需要把数据送到S3或Redshift，又想少写抓取代码。若S3数据还要求客户管理KMS key加密，应先检查并配置什么，为什么？
A:
Answer: Choose an AppFlow flow supporting the source and destination; for S3, configure target-data SSE-KMS with the customer managed key.
Key point: Flows manage SaaS connectivity and transfer, protected by TLS. The at-rest key still needs explicit configuration rather than assumption from a managed connection.
A_ZH:
答：选用支持该源和目标的AppFlow flow；S3场景为目标数据选择客户管理KMS key的SSE-KMS配置。
考点：flow管理SaaS连接和传输，AppFlow使用TLS保护传输；落盘使用哪把key仍要明确配置，不能只凭“托管连接”推定。
SOURCE: https://docs.aws.amazon.com/appflow/latest/userguide/data-protection.html

## aws-rb2-20261107-pack-sm01 | d1
TOPIC: Managed model inference endpoints / 托管模型推理入口
Q:
A trained model needs on-demand prediction calls without a self-managed always-running inference service. Which SageMaker form provides it, and why is it simpler?
Q_ZH:
模型已训练好，业务要按需调用得到预测，不想自建常驻推理服务。SageMaker用什么形态对外提供推理，为什么比自己起服务省心？
A:
Answer: Deploy a SageMaker endpoint: a managed interactive inference entry returning predictions per request without maintaining inference servers yourself.
Key point: An endpoint is the model's online serving form. Its managed environment loads the model and returns predictions, supports autoscaling, and removes server maintenance; you still manage model and resource configuration.
Watch out: Large offline predictions have a separate batch-transform path; endpoints suit interactive on-demand calls. Choose by access pattern.
A_ZH:
答：把模型部署为SageMaker endpoint：这是托管的交互式推理入口，调用方按请求得到预测，无需自己维护推理服务器。
考点：endpoint是模型的在线服务形态：请求进来由托管环境加载模型并返回预测，免服务器维护且支持自动扩展；模型与资源配置仍由你管理。
易错提醒：大批量离线预测另有批量变换路径；endpoint适合按需交互调用，按访问模式选择。
SOURCE: https://docs.aws.amazon.com/sagemaker/latest/dg/realtime-endpoints.html

## aws-rb2-20261107-pack-xa012 | d2
TOPIC: Cross-Region tag search / 跨Region标签查询
Q:
An application's EC2, Lambda, and RDS resources span Regions and share an application tag. How can its components be found quickly without per-service scripts?
Q_ZH:
某应用的EC2、Lambda、RDS等资源散在多个Region，已带相同application标签。怎样最快查出组成资源，避免逐服务脚本查询？
A:
Answer: Use Resource Groups Tag Editor, selecting relevant Regions and resource types and searching by the application tag key/value.
Key point: Tag Editor searches supported resource tags across selected Regions. CloudTrail events do not directly list all currently tagged resources.
A_ZH:
答：用Resource Groups Tag Editor，选择相关Region和资源类型，按application标签键值查询。
考点：Tag Editor跨所选Region搜索受支持的资源标签；CloudTrail事件日志不会直接给出当前所有带该标签的资源清单。
SOURCE: https://docs.aws.amazon.com/tag-editor/latest/userguide/find-resources-to-tag.html

## aws-rb2-20261107-pack-xa013 | d2
TOPIC: Edge execution and caching / 边缘执行与缓存
Q:
CloudFront requests need custom authentication or supported content processing with fewer trips to a central origin. Where should code run, and can a cache policy replace execution?
Q_ZH:
CloudFront请求要先自定义鉴权或做受支持的内容处理，希望少回到集中源站。代码放在哪一层，缓存策略能代替执行吗？
A:
Answer: Run code in an applicable CloudFront edge function, such as Lambda@Edge. Cache or request-header policies alone do not execute custom processing.
Key point: Functions execute logic in the edge request path, performing processing suitable for that runtime before origin access.
Watch out: Choose the event phase correctly: viewer-response can modify viewer response headers but does not change an already cached object's lifetime. Adding Expires there cannot set edge TTL.
A_ZH:
答：在适用的CloudFront边缘函数中执行，例如Lambda@Edge；仅改缓存或请求头策略不能执行自定义处理代码。
考点：函数在边缘请求链路中真正运行逻辑，可在回源前完成适合该运行环境的处理。
易错提醒：须选择正确事件阶段：viewer-response可修改发给用户的响应头，但不会改变CloudFront已缓存对象的寿命；不能靠这一阶段补Expires来设置边缘TTL。
SOURCE: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-the-edge.html

## aws-rb2-20261107-pack-xa031 | d1
TOPIC: Repeatable template deployment / 模板重复部署
Q:
A verified network, load balancer, instances, and database must repeatedly deploy into new environments. How can manual per-service creation be avoided, and why?
Q_ZH:
已验证的一套网络、负载均衡、实例和数据库，要反复在新环境自动部署。怎样避免逐服务手工创建，为什么？
A:
Answer: Declare resources and properties in a CloudFormation template and deploy a stack.
Key point: The template declares desired infrastructure; CloudFormation provisions and configures dependent resources. Config records/evaluates existing configuration rather than creating the entire environment from a template.
A_ZH:
答：把资源及属性写成CloudFormation模板，以stack部署。
考点：模板声明期望基础设施，CloudFormation负责开通并配置依赖资源；Config记录与评估现有配置，不负责按模板创建整套环境。
SOURCE: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/Welcome.html

## aws-rb2-20261107-pack-xa036 | d2
TOPIC: Cross-account observability / 跨账户可观测性
Q:
CloudWatch metrics, logs, and traces from several accounts in one Region need unified queries in a dedicated monitoring account. How is sharing established, and why?
Q_ZH:
同一Region内多个AWS账户的CloudWatch指标、日志和追踪要在专用监控账户统一查询，如何建立共享关系，为什么？
A:
Answer: Configure CloudWatch cross-account observability: create the receiving configuration in the monitoring account and sharing links from each source account.
Key point: The monitoring account reads selected source observability data. Creating IAM users there or attaching SCPs does not automatically establish data-sharing links.
A_ZH:
答：配置CloudWatch cross-account observability：监控账户建立接收配置，各源账户建立到它的共享链接。
考点：监控账户读取源账户选定的可观测性数据；只在监控账户建IAM用户，或附SCP，不会自动建立这些数据共享链接。
SOURCE: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Unified-Cross-Account.html

## aws-rb2-20261107-pack-xa046 | d2
TOPIC: Shared VPC subnets / 共享VPC子网
Q:
Workloads use separate accounts while a central team owns networking. Can they create their own resources inside the central VPC, and why?
Q_ZH:
各工作负载要分账户部署，但网络由中央团队统一维护。能让它们在中央VPC里创建自己的资源吗，为什么？
A:
Answer: Yes. The network account shares VPC subnets through AWS RAM with workload accounts in the same organization.
Key point: Participants deploy their own EC2, RDS, and other resources in shared subnets while the network account retains VPC management, avoiding a duplicate VPC per account.
Watch out: Subnet sharing does not let participants manage other participants' or the VPC owner's application resources.
A_ZH:
答：可以；网络账户用AWS RAM把VPC子网共享给同组织的工作负载账户。
考点：参与账户把自己的EC2、RDS等资源部署到共享子网，网络账户保留中央VPC管理；不必为每个账户复制整套VPC。
易错提醒：共享子网不让参与账户管理其他参与者或VPC所有者的应用资源。
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-sharing.html

## aws-rb2-20261107-pack-xb004 | d2
TOPIC: Multi-consumer ingestion / 多消费者摄取
Q:
Continuous transactions need independent reads by several applications plus a processing path stripping sensitive fields before DynamoDB writes. How should ingestion and processing be organized?
Q_ZH:
持续到达的交易既要供多个应用分别读取，又要由一条处理路径去掉敏感字段后写DynamoDB。怎样组织摄取与处理？
A:
Answer: Write transactions to Kinesis Data Streams. Applications consume independently; a separate Lambda consumer cleans records and writes DynamoDB.
Key point: The stream retains records for consumers. Lambda receives batches through an event source mapping, and function code cleans and writes them; Kinesis does not rewrite records automatically.
A_ZH:
答：把交易写入Kinesis Data Streams；各应用作为消费者读取，另用Lambda消费者清理记录并写入DynamoDB。
考点：流保留记录供消费者读取；Lambda通过事件源映射取得一批记录，再由函数代码完成清理和写库，Kinesis不会自动改写记录。
SOURCE: https://docs.aws.amazon.com/streams/latest/dev/key-concepts.html

## aws-rb2-20261107-pack-xb006 | d2
TOPIC: Scanned medical-record extraction / 扫描病历识别
Q:
A hospital uploads English scanned medical PDFs or JPEGs and needs medical information or PHI identified without its own model. Which services run in sequence?
Q_ZH:
医院上传英文扫描病历PDF或JPEG，要找出其中的医疗信息或受保护健康信息PHI，又不想自建识别模型。应先后调用什么？
A:
Answer: Use Textract to extract text, then Comprehend Medical to identify medical entities or PHI.
Key point: OCR first converts scans to text; medical language analysis then identifies meaning and sensitive entities. Their input/output stages must connect.
Watch out: Comprehend Medical processes English text. Results are not diagnoses; important uses still require appropriate confidence thresholds and human review.
A_ZH:
答：先用Textract提取文字，再用Comprehend Medical识别文字中的医疗实体或PHI。
考点：扫描文件先需要OCR把图像变成文字；医疗自然语言分析再识别文字的医学含义和敏感实体，两步输入输出才能衔接。
易错提醒：Comprehend Medical处理英文文字；识别结果不是医学诊断，重要用途仍需按置信度和人工复核要求处理。
SOURCE: https://docs.aws.amazon.com/textract/latest/dg/what-is.html

## aws-rb2-20261107-pack-xb010 | d2
TOPIC: Relational ingestion into a lake / 关系数据入湖
Q:
An S3 lake has fine-grained permissions. Relational database data must join it for combined analysis. Is granting Lake Formation permission on the original database enough, and how should it connect?
Q_ZH:
S3数据湖已有细粒度权限，团队还要把关系数据库的数据放进同一个湖做联合分析。只给原数据库加Lake Formation授权够吗，应怎样接入？
A:
Answer: No. Establish a supported Glue JDBC connection and use a Lake Formation blueprint workflow to ingest relational data into S3, then grant lake-table permissions.
Key point: JDBC connects to relational data; the blueprint generates a Glue ingestion workflow. After data becomes lake tables, Lake Formation governs row/column access on supported query paths.
A_ZH:
答：不够；建立受支持的Glue JDBC连接，用Lake Formation蓝图工作流把关系数据摄取到S3数据湖，再授予湖表所需权限。
考点：JDBC是读取关系库的连接方式；蓝图生成在Glue运行的摄取流程。数据进入湖表后，Lake Formation才能在受支持查询路径上管理行列权限。
SOURCE: https://docs.aws.amazon.com/lake-formation/latest/dg/workflows-about.html

## aws-rb2-20261107-pack-xb011 | d2
TOPIC: Event notification and execution / 事件通知与执行
Q:
EventBridge has matched AWS service events. Which targets send people email versus execute resource-changing code?
Q_ZH:
EventBridge已匹配到需要处理的AWS服务事件。要给人员发邮件，与要运行代码修改资源，应分别选什么目标？
A:
Answer: Use an SNS topic with confirmed email subscriptions for email; target the appropriate Lambda function for custom actions.
Key point: EventBridge filters/delivers events, SNS notifies subscribers, and Lambda executes code. SQS is a consumer queue and does not directly email people.
A_ZH:
答：人员邮件用SNS主题和已确认的邮件订阅；执行自定义动作则把相应Lambda函数设为目标。
考点：EventBridge筛选并投递事件；SNS把消息送给订阅者，Lambda运行处理代码。SQS只是让消费者取消息的队列，不会直接把邮件送给人员。
SOURCE: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-targets.html

## aws-rb2-20261107-pack-xb013 | d2
TOPIC: Key access and analytical warehousing / 键值访问与分析仓库
Q:
How should DynamoDB and Redshift be chosen for high-concurrency known-key access versus parallel SQL analysis of large datasets?
Q_ZH:
按已知键高并发读写，和对大量数据做并行SQL分析，应怎样在DynamoDB与Redshift间选择？
A:
Answer: Prefer DynamoDB for online key-value/document access and Redshift for parallel warehouse analytics; applicable Redshift Serverless reduces cluster administration.
Key point: DynamoDB locates records by designed keys; ordinary attributes can vary by item and sort keys organize hierarchy. Redshift MPP splits large analytics across compute units.
A_ZH:
答：在线键值/文档访问优先考虑DynamoDB；数据仓库的并行分析考虑Redshift，少管理集群可用适用的Redshift Serverless。
考点：DynamoDB围绕设计好的键定位记录，普通属性可随项目变化，排序键可组织层级；Redshift以MPP把大分析任务分给多个计算单元并行完成。
SOURCE: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html

## aws-rb2-20261107-pack-xb019 | d2
TOPIC: Fargate and kernel control / Fargate与内核控制
Q:
How does the choice between Fargate and self-managed EC2 change when containers need less host maintenance versus mandatory Linux-kernel changes?
Q_ZH:
容器只想少维护主机，与应用必须修改Linux内核，这两个条件怎样改变Fargate和自管EC2的选择？
A:
Answer: Choose Fargate to reduce host maintenance; kernel control requires an applicable deployment with a self-managed OS, such as EC2.
Key point: Managed infrastructure transfers host administration to AWS and removes customer control over that OS. Control and maintenance responsibility move together.
Watch out: ECS orchestration does not remove customer instance-OS maintenance when using EC2.
A_ZH:
答：少维护宿主机可选Fargate；必须自行控制内核时，需要能自管OS的EC2等适用部署。
考点：托管基础设施让AWS承担宿主机管理，也收回客户对底层OS的控制；控制权和维护责任一起变化。
易错提醒：ECS负责容器编排，不表示使用EC2时客户也不必维护实例系统。
SOURCE: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html

## aws-rb2-20261107-pack-xb020 | d2
TOPIC: Private API backend integration / API私网后端集成
Q:
A public REST API has container backends in private VPC subnets. How does API Gateway reach them, and why not create a private API endpoint for clients?
Q_ZH:
对外REST API的容器后端在私有VPC子网中。API Gateway怎样把请求送到后端，为什么不是给客户端建private API端点？
A:
Answer: Configure a REST API private integration with a VPC link to a supported ALB or NLB, then the container service.
Key point: VPC link handles API Gateway-to-private-backend connectivity. An interface endpoint handles client-to-private-API connectivity; direction and connected resource differ.
A_ZH:
答：配置REST API的private integration，通过VPC link连接受支持的ALB或NLB，再转到容器服务。
考点：VPC link解决API Gateway到私网后端这一段；interface endpoint解决客户端到private API这一段，方向和被连接对象不同。
SOURCE: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-private-integration.html

## aws-rb2-20261107-pack-xb029 | d2
TOPIC: On-site EKS control plane / 现场EKS控制面
Q:
Kubernetes must run on company premises using AWS-managed EKS capabilities. Which infrastructure goes on site, and how does its control plane stay there too?
Q_ZH:
Kubernetes应用必须在公司机房运行，并想使用AWS管理的EKS能力。AWS应把哪种基础设施交付到现场，怎样让Kubernetes控制面也留在现场？
A:
Answer: Deploy an Outposts rack and use an EKS local cluster when both control plane and nodes must stay on site.
Key point: Outposts brings supported AWS compute/storage to the customer site. A local cluster keeps control plane and nodes on the Outpost; an extended cluster keeps the control plane in a Region.
A_ZH:
答：部署Outposts rack；需要控制面与节点都在现场时使用EKS local cluster。
考点：Outposts把受支持AWS计算/存储放进客户场地；EKS local cluster的控制面与节点都在Outpost，extended cluster则把控制面放在Region。
SOURCE: https://docs.aws.amazon.com/eks/latest/userguide/eks-outposts.html

## aws-rb2-20261107-pack-xb031 | d2
TOPIC: Managed AS2 entry / 托管AS2入口
Q:
Supply-chain partners require AS2 file exchange with little protocol-server maintenance. Which AWS entry fits, and why cannot ordinary file synchronization directly replace it?
Q_ZH:
供应链伙伴要求用AS2交换文件，想少维护协议服务器。应选哪种AWS入口，为什么普通文件同步任务不能直接替代？
A:
Answer: Use a Transfer Family AS2 server and applicable AS2 connection configuration.
Key point: AS2 defines message exchange and partner configuration. Transfer Family supplies that protocol entry; a copying task such as DataSync does not become AS2 merely by moving files.
Watch out: AS2 servers cannot select a Lambda identity provider like SFTP servers. Design application login for the actual entry.
A_ZH:
答：使用Transfer Family的AS2服务器及适用的AS2连接配置。
考点：AS2有规定的消息交换协议与伙伴配置；Transfer Family提供协议入口，DataSync之类的数据复制任务不会仅因能搬文件就成为AS2端点。
易错提醒：AS2服务器不能像SFTP服务器那样选择Lambda身份提供方；应用登录认证应另按实际入口设计。
SOURCE: https://docs.aws.amazon.com/transfer/latest/userguide/create-as2-transfer-server.html

## aws-rb2-20261107-pack-xb032 | d2
TOPIC: Three DNS routing criteria / DNS三类选路依据
Q:
DNS must choose by country-specific content, user/resource geographic distance, or actual network latency. How do these criteria differ?
Q_ZH:
DNS要按国家分内容、按用户与资源的地理距离、或按实际网络延迟选入口，这三种依据怎样区分？
A:
Answer: Use geolocation for country content, geoproximity for geographic distance, and latency routing for network latency.
Key point: Source country, map distance, and network measurements are different inputs; geographic proximity does not guarantee a faster network.
Watch out: Eligible non-AWS target records can also associate a Region for latency decisions. DNS selection is not content-access authorization.
A_ZH:
答：国家内容用geolocation；地理距离用geoproximity；网络延迟用latency routing。
考点：来源国家、地图距离和网络测量是不同依据；地理更近不保证网络更快。
易错提醒：非AWS目标也可按适用记录关联用于延迟判断的Region；DNS选择入口不等于内容访问授权。
SOURCE: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy.html

## aws-rb2-20261107-pack-xb034 | d2
TOPIC: Forwarding DNS on premises / 向机房转发DNS
Q:
A VPC application must resolve private on-premises domains over an already working VPN. Which Route 53 Resolver endpoint applies, and how are domains selected?
Q_ZH:
VPC应用要解析本地机房的私有域名，VPN网络已连通。Route 53 Resolver应使用哪种端点，如何决定哪些域名转交机房？
A:
Answer: Create an outbound Resolver endpoint, configure rules forwarding the relevant domains to on-premises DNS, and associate the rules with the application VPC.
Key point: Queries leave the VPC for on premises, so use outbound. Domain rules select forwarding targets; VPN or a private hosted zone alone does not forward queries to the original DNS.
A_ZH:
答：创建Resolver outbound endpoint，配置将相应域名转发到机房DNS的规则，并把规则关联应用VPC。
考点：查询从VPC出去到机房，所以使用outbound；域名规则选择转发目标，仅有网络VPN或一个私有托管区不会自动把查询交给原机房DNS。
SOURCE: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver-forwarding-outbound-queries.html

## aws-rb2-20261107-pack-xb035 | d2
TOPIC: Upload-completion workflows / 上传完成工作流
Q:
Transfer Family order uploads must immediately trigger custom processing instead of hourly directory scans. How should processing start, and why?
Q_ZH:
Transfer Family上传订单文件后，应立即运行自定义处理，而不是每小时扫描目录。怎样触发处理，为什么？
A:
Answer: Associate a post-upload managed workflow with the Transfer Family server and invoke Lambda through a custom step.
Key point: Upload completion directly starts processing and Lambda runs business logic, without waiting for the next scheduled scan to discover files.
A_ZH:
答：给Transfer Family服务器关联上传完成后的managed workflow，用自定义步骤调用Lambda。
考点：上传完成事件直接启动处理流程，Lambda执行自定义业务逻辑；不必等下一次定时扫描才发现新文件。
SOURCE: https://docs.aws.amazon.com/transfer/latest/userguide/transfer-workflows.html

## aws-rb2-20261107-pack-xb037 | d2
TOPIC: Configuration and secret management / 配置与秘密管理
Q:
An application needs secure database-password storage and gradual release of ordinary settings such as log levels or feature flags. Which service manages ordinary settings, and why not treat everything as secrets?
Q_ZH:
应用既要安全保管数据库密码，又要分批发布日志级别、功能开关等普通配置。普通配置应由什么管理，为什么不把一切都当秘密？
A:
Answer: Use AppConfig to manage and deploy ordinary application configuration; retain passwords and sensitive credentials in Secrets Manager.
Key point: AppConfig handles validation, gradual rollout, and behavior changes. Secrets Manager handles controlled secret retrieval and rotation; their management goals differ.
A_ZH:
答：用AppConfig管理和发布普通应用配置；密码等敏感凭据仍放Secrets Manager。
考点：AppConfig解决配置验证、渐进发布和改变应用行为；Secrets Manager解决秘密的受控读取与轮换，两者管理目标不同。
SOURCE: https://docs.aws.amazon.com/appconfig/latest/userguide/what-is-appconfig.html

## aws-rb2-20261107-pack-xb038 | d2
TOPIC: Cross-VPC service connectivity / 跨VPC服务连接
Q:
Lambda and EKS microservices across accounts/VPCs need HTTPS calls and service-name discovery. Is routing alone enough, and which managed mechanism fits?
Q_ZH:
多个账户/VPC中的Lambda和EKS微服务要用HTTPS互相调用，并能按服务名发现对方。只建立VPC路由够吗，应采用什么托管机制？
A:
Answer: Use a VPC Lattice service network, associating calling VPCs and services; configure HTTPS listeners and actual compute targets.
Key point: The service network centralizes application connectivity and discovery. Clients call service DNS names and Lattice routes to registered targets. Peering supplies network reachability without service registration/discovery.
A_ZH:
答：用VPC Lattice service network，把需要调用的VPC与服务关联；为服务配置HTTPS监听器及其实际计算目标。
考点：服务网络集中提供应用连接与服务发现；客户端按服务DNS名请求，Lattice再路由到注册目标。单纯peering只提供网络互通，不会建立服务注册发现。
SOURCE: https://docs.aws.amazon.com/vpc-lattice/latest/ug/what-is-vpc-lattice.html

## aws-rb2-20261107-pack-xb041 | d2
TOPIC: Transport and HTTP load balancing / 传输层与HTTP分流
Q:
Which load balancer fits low-latency transport forwarding at millions of requests per second versus choosing backends by HTTP path or hostname?
Q_ZH:
只需低延迟传输层转发、面对百万级请求/秒，或需要按HTTP路径/主机名选后端，负载均衡器怎样选？
A:
Answer: Evaluate NLB for the former; use ALB listener rules for HTTP fields. UDP also uses a protocol-supporting NLB.
Key point: NLB forwards connections at the transport layer for high throughput and low latency. ALB understands HTTP content and can choose backends by request fields.
Watch out: Millions per second describes positioning, not a guarantee for arbitrary configurations. HTTPS still needs listeners and certificates.
A_ZH:
答：前者评估NLB；按HTTP字段分流用ALB监听器规则。UDP也使用支持该协议的NLB。
考点：NLB在传输层转发连接，面向高吞吐低延迟；ALB理解HTTP内容，所以能按请求字段选择后端。
易错提醒：百万级是能力定位，不是任意配置的吞吐保证；HTTPS仍需配置监听和证书。
SOURCE: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html

## aws-rb2-20261107-pack-xb044 | d2
TOPIC: Pod subnets and IAM roles / Pod子网与IAM角色
Q:
EKS uses Linux IPv4 EC2 nodes. Pods need specified subnets different from the node primary ENI's subnet. Where is this configured, and why not change the service account's IAM role?
Q_ZH:
EKS使用Linux IPv4 EC2节点，Pod必须分配到与节点主网卡不同的指定子网。应在哪层配置，为什么不是给service account换IAM角色？
A:
Answer: Enable/configure custom networking in Amazon VPC CNI to select Pod-interface subnets and security groups.
Key point: CNI manages Pod interfaces and addresses. A service account IAM role controls AWS API access, not the subnet supplying a Pod IP.
Watch out: Subnets and security groups must remain in the node VPC. Fargate profile controls Fargate subnet selection.
A_ZH:
答：在Amazon VPC CNI启用并配置custom networking，为Pod的网络接口选择所需子网和安全组。
考点：CNI负责Pod网络接口和地址分配；service account的IAM角色决定Pod能调用哪些AWS API，不决定Pod的IP来自哪个子网。
易错提醒：这些子网与安全组仍须属于节点所在VPC；Fargate的子网选择由Fargate profile控制。
SOURCE: https://docs.aws.amazon.com/eks/latest/userguide/cni-custom-network.html

## aws-rb2-20261107-pack-xr001 | d1
TOPIC: Read-time object transformation / 读取时对象转换
Q:
A team eligible for S3 Object Lambda needs redacted or filtered views of one original object for different applications, without pre-storing copies. How does it work?
Q_ZH:
已获S3 Object Lambda使用资格的团队，希望读取同一原始对象时，按应用需要返回脱敏或筛选后的结果，又不预存多份副本。这项服务怎样完成？
A:
Answer: Send GET requests through an Object Lambda access point; Lambda processes the object before returning results.
Key point: Transformation occurs on the read-response path. Applications receive processed views without precreating and storing an object for every view.
A_ZH:
答：让GET请求经过Object Lambda access point，由Lambda处理后再把结果返回应用。
考点：转换发生在读取的返回路径，应用得到处理后的视图；不必为每种视图预先创建并保存一份衍生对象。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/transforming-objects.html

## aws-rb2-20261107-pack-xr003 | d2
TOPIC: Private SaaS data flows / SaaS私有数据流
Q:
Supported SaaS such as Salesforce must deliver records to S3 or Redshift with little extraction code and no public-internet business-data transfer. How should it connect?
Q_ZH:
Salesforce等受支持SaaS要把业务记录送到S3或Redshift，希望少写抓取代码且实际传输不走公网。应怎样接入？
A:
Answer: Use AppFlow with a PrivateLink-based private flow for a supported source connection, first verifying SaaS-account and Region support.
Key point: AppFlow manages supported SaaS connections and flows; private flows carry runtime business data over AWS private paths. Arbitrary SaaS VPC peering does not create the same integration.
Watch out: Private business-data transfer does not automatically make metadata/authorization calls private; explicitly enable supported private options if those calls are restricted too.
A_ZH:
答：使用AppFlow，并为支持的源连接选择基于PrivateLink的private flow；先确认SaaS账户和Region已支持该私有连接。
考点：AppFlow管理数据流和支持的SaaS连接，private flow使运行中的业务数据经AWS私有路径传输；不是给任意SaaS建立VPC peering就能得到同样连接。
易错提醒：私有业务数据流不自动保证元数据/授权调用也私有；若这些调用也受限，要显式启用服务支持的对应私有选项。
SOURCE: https://docs.aws.amazon.com/appflow/latest/userguide/private-flows.html

## aws-rb2-20261107-pack-xr101 | d2
TOPIC: Log metrics versus raw content / 日志指标与原文
Q:
CloudWatch Logs has received logs. What handles alarms on matching-event counts versus sending raw logs to OpenSearch search?
Q_ZH:
CloudWatch Logs已收到日志。要根据匹配事件的次数告警，和要把日志原文交给OpenSearch检索，两种需求应分别用什么处理方式？
A:
Answer: For counts, create metrics with a metric filter and notify through a CloudWatch metric alarm's SNS action. For raw search, use a subscription filter and supported OpenSearch forwarding path, such as the official Lambda subscription integration.
Key point: Metric filters extract numbers and alarms evaluate thresholds. Subscriptions copy matched log content downstream. Choose statistics versus original content.
A_ZH:
答：计数告警用metric filter生成指标，再用CloudWatch metric alarm的SNS动作通知；原文检索用subscription filter，经受支持的转发路径送OpenSearch，例如官方Lambda订阅集成。
考点：metric filter把匹配日志提炼成数字，alarm判断阈值；subscription复制匹配日志内容供下游处理。选择取决于需要统计结果还是原文。
SOURCE: https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/MonitoringLogData.html

## aws-rb2-20261107-pack-gcl-001 | d2
TOPIC: Application email versus notifications / 应用邮件与通知
Q:
An application sends custom HTML reports, order confirmations, or marketing email. Is an SNS event-email subscription equivalent?
Q_ZH:
应用要向客户发送自定义HTML报告、订单确认或营销邮件。SNS发事件通知的邮件订阅就等价吗？
A:
Answer: No. Evaluate a dedicated email-delivery service such as SES.
Key point: Application email needs content and delivery-process control supplied by dedicated email services. Topic email primarily serves subscriber notifications.
Watch out: Sender verification, sending eligibility, and delivery restrictions still apply; arbitrary unverified senders cannot simply mass-mail.
A_ZH:
答：不等价；应评估SES等专门的邮件投递服务。
考点：应用邮件需要控制内容和投递流程，专门邮件服务承担相应发送能力；事件主题邮件主要用于订阅通知。
易错提醒：邮件服务仍有身份验证、发送资格和投递限制，不是让任意未验证发件地址直接群发。
SOURCE: https://docs.aws.amazon.com/ses/latest/dg/Welcome.html

## aws-rb2-20261107-pack-gcl-002 | d2
TOPIC: Incremental monolith decomposition / 单体逐步拆分
Q:
A monolith requires full release for every feature change. It should retain much existing code while allowing independent feature updates. How should it evolve?
Q_ZH:
旧单体每改一个功能都要整体发布，希望尽量保留原代码，又能按功能独立更新。怎样逐步重构？
A:
Answer: Split along business boundaries into independent services and, where appropriate, containerize the existing execution environment.
Key point: Containers help retain the runtime model; service boundaries allow separate deployment and scaling, reducing whole-monolith coupling.
Watch out: Putting the entire monolith in one container does not automatically make features independently deployable.
A_ZH:
答：按业务边界拆成独立服务，并在适用情况下用容器封装既有执行环境。
考点：容器有助沿用原运行模型，独立服务边界让各部分分别部署和伸缩，减少一次变化牵动整个单体。
易错提醒：只把完整单体装进一个容器，不会自动获得各功能独立发布能力。
SOURCE: https://docs.aws.amazon.com/whitepapers/latest/microservices-on-aws/microservices-on-aws.html

## aws-rb2-20261107-pack-gcl-004 | d2
TOPIC: Scaling activity details / 伸缩活动明细
Q:
EC2 Auto Scaling activity IDs and success/failure statuses must reach S3 near real time without affecting instance startup. Does Metric Streams contain these details?
Q_ZH:
要把EC2 Auto Scaling每次活动的ID和成功/失败状态近实时存入S3，不影响实例启动。仅开Metric Streams能拿到这些明细吗？
A:
Answer: No. Schedule Lambda at the required frequency to call DescribeScalingActivities and write activity records to S3.
Key point: Activity records describe individual scaling outcomes. Metric Streams exports existing numeric CloudWatch metrics, deliverable through Firehose, not activity details. Independent scheduled collection need not enter instance startup scripts.
A_ZH:
答：不能；可按需要的频率调度Lambda，调用DescribeScalingActivities取得活动记录后写S3。
考点：活动记录描述一次次伸缩的结果；Metric Streams导出的是已有CloudWatch数值指标，可经Firehose交付，但不承载这些活动详情。独立定时采集也不必塞进实例启动脚本。
SOURCE: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Metric-Streams.html

## aws-rb2-20261107-pack-gcl-006 | d2
TOPIC: Managed Web environments / 托管Web运行环境
Q:
A supported server-side Web application needs few code changes and less manual load-balancer, scaling, and deployment setup. Does one EC2 instance provide that management?
Q_ZH:
已有受支持的服务器端Web应用，希望少改代码，并少手工配置负载均衡、伸缩和部署环境。只给一台EC2就完成这些管理了吗？
A:
Answer: No. Evaluate an Elastic Beanstalk managed application environment.
Key point: For supported platforms it organizes deployment and related AWS resource management, reducing individually assembled environment components.
Watch out: Applications must meet platform support. Customers still maintain application code and applicable configuration.
A_ZH:
答：没有；可评估Elastic Beanstalk托管应用环境。
考点：它为支持的应用平台组织部署和相关AWS资源管理，减少逐项搭建运行环境的工作。
易错提醒：应用仍须符合平台支持，托管环境不表示应用代码与所有配置都不再需要客户维护。
SOURCE: https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/Welcome.html

## aws-rb2-20261107-pack-gcl-007 | d2
TOPIC: GraphQL pipeline resolution / GraphQL多步解析
Q:
A GraphQL request must query multiple supported data sources sequentially and combine the response without hand-coding all orchestration in one application function. What fits?
Q_ZH:
GraphQL API要先后从多个受支持数据源取数，再组合响应，不想在一个应用函数中手写全部调用编排。可怎样实现？
A:
Answer: Use an applicable AppSync pipeline resolver, organizing data-access steps as pipeline functions.
Key point: Resolvers resolve API fields; pipelines let successive steps consume inputs and preceding results to combine sources.
Watch out: This composes data within an API request, not arbitrary long-running business workflows with durable waits.
A_ZH:
答：使用适用的AppSync pipeline resolver，把数据访问步骤组织成流水线函数。
考点：resolver处理API字段的数据解析，pipeline允许多个步骤依次使用输入和前一步结果，组合多个来源。
易错提醒：这是API请求内的数据组合，不等于管理任意长时间、需要持久等待的业务工作流。
SOURCE: https://docs.aws.amazon.com/appsync/latest/devguide/pipeline-resolvers.html

## aws-rb2-20261107-pack-gcl-008 | d1
TOPIC: FSx gateway and cloud files / FSx网关与云端文件
Q:
An existing eligible hybrid Windows deployment uses FSx File Gateway with cloud files and an on-premises cache. What do FSx and the local gateway each do?
Q_ZH:
一个符合FSx File Gateway使用资格的既有混合Windows部署，用云端文件后端和机房缓存。FSx与本地网关分别承担什么？
A:
Answer: FSx for Windows File Server stores shared files in the cloud. Local FSx File Gateway caches accessed data for low-latency on-premises reads.
Key point: The filesystem holds shared data; the gateway extends access on premises and caches hot data, reducing always-remote file reads.
Watch out: This is not S3-backed S3 File Gateway; confirm current service eligibility before design.
A_ZH:
答：FSx for Windows File Server保存云端共享文件；本地FSx File Gateway缓存访问数据，供机房客户端低延迟读取。
考点：文件系统保存共享数据，网关把访问延伸到机房并缓存热点，避免把全部文件访问都当作实时远程读取。
易错提醒：这不是后端为S3的S3 File Gateway；现行服务资格须在设计前确认。
SOURCE: https://docs.aws.amazon.com/filegateway/latest/filefsxw/what-is-file-fsxw.html

## aws-rb2-20261107-pack-gcl-009 | d2
TOPIC: Application protocol and file source / 应用协议与文件源
Q:
An on-premises SFTP application stores files on an NFS share, to be migrated with DataSync to configured EFS. Does DataSync connect through SFTP or the actual file interface?
Q_ZH:
机房SFTP应用的文件实际存在NFS共享上，要用DataSync迁到已配置的EFS。DataSync按SFTP应用入口还是底层文件接口接入？
A:
Answer: Configure an NFS source location and use an applicable on-premises agent to reach it.
Key point: An application's public SFTP protocol does not make its storage a DataSync SFTP location. The agent accesses the local file interface; the location defines the read source.
Watch out: Destination and task configuration are still required. SFTP in an application's name does not mean Transfer Family replaces file migration.
A_ZH:
答：按实际NFS文件源配置DataSync source location，并通过机房侧适用agent访问源。
考点：应用对外讲SFTP，不代表磁盘数据源也是DataSync的SFTP位置；agent连接本地文件接口，location定义传输从哪里读。
易错提醒：目标位置和任务也须成立；不能因应用名字带SFTP就选Transfer Family来代替文件迁移。
SOURCE: https://docs.aws.amazon.com/datasync/latest/userguide/how-datasync-transfer-works.html

## aws-rb2-20261107-pack-gcl-010 | d2
TOPIC: Kubernetes management layers / Kubernetes托管层级
Q:
Containers already run on EC2 and need less Kubernetes-node/platform administration. How does an EKS managed node group differ from an ordinary EC2 ASG?
Q_ZH:
已选EC2运行容器，想少维护Kubernetes节点和编排平台。EKS managed node group与仅用EC2 ASG管理主机有什么差别？
A:
Answer: EKS supplies a managed Kubernetes control plane and managed node groups handle applicable node lifecycle. An ordinary ASG mainly scales hosts, not complete Kubernetes orchestration.
Key point: Having machines does not supply scheduling and node-management platforms. Managing each layer reduces the corresponding self-built work.
Watch out: Customers still maintain applications and required node-version updates; managed does not mean all maintenance disappears.
A_ZH:
答：EKS提供托管Kubernetes控制面，managed node group管理适用节点生命周期；普通ASG主要伸缩主机，不提供完整Kubernetes编排。
考点：有机器不等于已有容器调度和节点管理平台，托管各层能减少相应自建工作。
易错提醒：客户仍须维护应用及应由客户执行的节点版本更新等工作，不能把managed理解成全部免维护。
SOURCE: https://docs.aws.amazon.com/eks/latest/userguide/managed-node-groups.html

## aws-rb2-20261107-pack-gcl-013 | d2
TOPIC: Preparing read-replica creation / 读副本创建准备
Q:
Before creating an RDS MySQL read replica, what backup state and long-transaction preparation are needed?
Q_ZH:
RDS MySQL要创建读副本，创建前备份状态和长事务应怎样准备？
A:
Answer: Enable required automated backups with nonzero retention. To reduce initial-copy impact, follow recommendations to wait for long transactions to finish before creation.
Key point: Replicas require supported backups and replication logs; source workload state affects the initial copy.
Watch out: This prepares replication creation, not Multi-AZ failover priority, and does not require permanently stopping all normal transactions.
A_ZH:
答：启用所需自动备份，保留期不为0；为减少初始复制影响，按建议等待长事务完成再安排创建。
考点：读副本需要受支持的备份与复制日志基础，初始复制还会受到源库当时工作状态影响。
易错提醒：这是创建复制的准备，不是设置Multi-AZ failover priority，也不表示所有正常事务必须永久停止。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html

## aws-rb2-20261107-pack-gcl-015 | d2
TOPIC: Glue input-progress bookmarks / Glue输入进度书签
Q:
Glue ETL repeatedly processes newly arriving supported S3 files, such as applicable XML, without rereading every old input. Which progress mechanism fits?
Q_ZH:
Glue ETL定期处理持续新增的受支持S3文件输入，例如适用XML，不想每次重读全部旧输入。应使用什么进度机制？
A:
Answer: Use applicable job bookmarks to record processed progress.
Key point: Bookmarks identify processed inputs on later runs, preventing historical data from repeatedly becoming new work. Reducing workers does not track progress.
Watch out: Bookmarks track supported input progress; they do not automatically match and delete arbitrary duplicate records by business fields.
A_ZH:
答：使用适用的job bookmarks记录已处理进度。
考点：书签让后续运行识别已处理输入，避免把相同历史数据反复作为新工作；减少worker并不实现这种进度跟踪。
易错提醒：书签跟踪支持的输入处理进度，不等于按业务字段自动匹配并删除任意重复记录。
SOURCE: https://docs.aws.amazon.com/glue/latest/dg/monitor-continuations.html

## aws-rb2-20261107-pack-gcl-016 | d2
TOPIC: MongoDB-compatible migration / MongoDB兼容迁移
Q:
An existing MongoDB application needs fewer access changes and less database administration. Why evaluate DocumentDB rather than directly switch to DynamoDB?
Q_ZH:
已有MongoDB应用想少改访问方式并减少自管数据库工作。为什么可评估DocumentDB，而不是直接换成DynamoDB？
A:
Answer: DocumentDB offers a supported MongoDB-compatible interface; DynamoDB has different APIs and a different data model.
Key point: Retaining applicable protocols/query patterns reduces changes, but both managed operation and compatibility must meet actual application needs.
Watch out: MongoDB compatibility does not mean complete feature identity or zero code changes for every application.
A_ZH:
答：DocumentDB提供受支持的MongoDB兼容接口；DynamoDB是不同的访问API和数据模型。
考点：保留适用协议和查询方式能减少改造，但托管与兼容须同时满足实际应用需要。
易错提醒：MongoDB兼容不等于所有功能完全相同，也不保证任何应用一行代码都不用改。
SOURCE: https://docs.aws.amazon.com/documentdb/latest/developerguide/what-is.html

## aws-rb2-20261107-pack-gcl-021 | d2
TOPIC: EFS network mount entries / EFS网络挂载入口
Q:
EC2 across AZs needs network access to one EFS. Does adding access points create per-AZ network entries?
Q_ZH:
EC2跨AZ访问同一个EFS，需要网络挂载入口。多建access point，就等于各AZ已有网络入口吗？
A:
Answer: No. Mount targets are network entries; access points mainly define application-visible directories and file-access identities.
Key point: Mount targets provide connectable NFS addresses. Access points constrain filesystem usage and cannot replace networking.
Watch out: Arrange Regional EFS mount targets appropriately for client AZs; network reachability and file permissions remain separate requirements.
A_ZH:
答：不等于；网络入口是mount target，access point主要定义应用看到的目录和文件访问身份等。
考点：mount target给客户端可连接的NFS地址；access point限定怎样使用文件系统，不能代替网络路径。
易错提醒：Regional EFS应按客户端AZ合理安排mount target；网络连通与文件权限仍是两层条件。
SOURCE: https://docs.aws.amazon.com/efs/latest/ug/efs-access-points.html

## aws-rb2-20261107-pack-gcl-024 | d2
TOPIC: EventBridge processing metrics / EventBridge处理指标
Q:
An EventBridge target gets no traffic. You need to know whether events matched and targets were invoked. Are DLQ or CloudTrail checks enough?
Q_ZH:
EventBridge规则目标没收到流量，要知道“有没有匹配”和“有没有调用目标”。只查看DLQ或CloudTrail够吗？
A:
Answer: No. Inspect matching, invocation, failure, and related CloudWatch metrics in AWS/Events.
Key point: These metrics distinguish matching and target-delivery stages. DLQs mainly capture eligible final failures, and API auditing is not a complete event-processing counter.
Watch out: Identify the failed stage first; missing target traffic does not prove the rule never matched.
A_ZH:
答：不够；查看CloudWatch中AWS/Events对应的匹配、调用及失败等指标。
考点：这些指标分别定位规则匹配和目标交付阶段；DLQ主要反映符合条件的最终失败，API审计不是完整事件处理计数。
易错提醒：先区分失败发生在哪一阶段，不能因目标没收到就直接认定规则从未匹配。
SOURCE: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-monitoring.html

## aws-rb2-20261107-pack-gcl-026 | d2
TOPIC: Large-scale Map processing / Map大规模并行
Q:
A dataset in S3 has thousands of independent items for large on-demand Step Functions parallel processing. Inline Map or Distributed Map?
Q_ZH:
S3数据集有数千独立项，要用Step Functions按需大规模并行处理。Inline Map和Distributed Map怎样选？
A:
Answer: Evaluate Distributed Map.
Key point: It delegates items to independent child executions, supporting large parallelism and separate histories instead of one inline execution's concurrency/history limits.
Watch out: Inline Map also supports parallelism, with different scope and limits. Match actual concurrency and input capabilities.
A_ZH:
答：评估Distributed Map。
考点：它把项目处理分给独立子执行，可支持大规模并行与独立执行历史，避免全部塞进一个内联执行的并发和历史限制。
易错提醒：Inline Map也能并行，但范围和限制不同；仍须按实际并发与数据输入能力选择。
SOURCE: https://docs.aws.amazon.com/step-functions/latest/dg/state-map.html

## aws-rb2-20261107-pack-gcl-027 | d2
TOPIC: Compute placement near users / 用户附近计算部署
Q:
Application code must deploy near users. How do Local Zones and Wavelength differ for ordinary city low latency versus carrier 5G-edge scenarios?
Q_ZH:
应用代码须实际部署到靠近用户的位置：普通城市低延迟部署，与运营商5G网络边缘场景，怎样区分Local Zones和Wavelength？
A:
Answer: Evaluate Local Zones for Region extensions near cities, and Wavelength for carrier-network edge scenarios.
Key point: Both provide actual workload deployment locations with different networking and sites. CloudFront content caching does not run arbitrary EC2 applications.
Watch out: Check actual sites, parent-Region dependencies, and regulations. Low-latency goals do not prove every location is compliant.
A_ZH:
答：城市附近的区域扩展评估Local Zones；运营商网络边缘场景评估Wavelength。
考点：两者提供实际工作负载部署位置，接入网络和地点不同；CloudFront内容缓存不能直接运行任意EC2应用。
易错提醒：仍须核对具体地点、父Region依赖和法规要求，低延迟目标不自动证明任意位置都合规。
SOURCE: https://docs.aws.amazon.com/local-zones/latest/ug/what-is-aws-local-zones.html

## aws-rb2-20261107-pack-gcl-028 | d2
TOPIC: Fargate mounting EFS / Fargate挂载EFS
Q:
An EKS Fargate Pod needs a selected EFS filesystem. Can it copy an ECS task's volume declaration or assume dynamic provisioning works?
Q_ZH:
EKS Fargate Pod要使用已选好的EFS，能照搬ECS任务的volume声明，或假设动态供给必然支持吗？
A:
Answer: No. Associate EFS through EKS-supported static PV/PVC configuration and check Fargate provisioning limits.
Key point: A PV describes storage and a PVC requests it for Pods. Kubernetes storage integration differs from ECS task definitions; Fargate does not support dynamic provisioning on this path.
A_ZH:
答：不能；按EKS支持方式用静态PV/PVC关联EFS，核对Fargate的供给限制。
考点：PV描述可用存储，PVC供Pod申请使用；Kubernetes存储接入与ECS任务定义不同，Fargate也不支持这条路径的动态供给。
SOURCE: https://docs.aws.amazon.com/eks/latest/userguide/efs-csi.html

## aws-rb2-20261107-pack-gcl-029 | d2
TOPIC: Unified multi-Region object entry / 多Region对象统一入口
Q:
S3 data spans Regions and applications need a unified nearby read/write entry. Is bucket replication alone enough?
Q_ZH:
S3数据分布在多个Region，应用希望用统一入口就近读写。仅开启桶间复制就够吗？
A:
Answer: No. An S3 Multi-Region Access Point can provide the unified object-request entry; replication separately distributes data.
Key point: MRAP accelerates over AWS's global network and routes to nearby active buckets; routing/failover controls can move regional traffic. Entry routing determines where requests go, while replication determines whether objects are there.
Watch out: Routing does not synchronously copy objects, and newly written data is not automatically readable in every other bucket immediately.
A_ZH:
答：不够；可用S3 Multi-Region Access Point提供统一对象请求入口，复制另行负责数据分布。
考点：MRAP用AWS全球网络加速，把请求路由到就近的活动桶；可用路由/故障切换控制转移Region流量。入口决定请求去哪，复制决定对象有没有到另一个桶。
易错提醒：不能假设路由会同步复制对象，或任意区域刚写入的数据已立刻在其他桶可读。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/MultiRegionAccessPoints.html

## aws-rb2-20261107-pack-gcl-030 | d2
TOPIC: Lambda cross-account EFS mounts / Lambda挂载跨账户EFS
Q:
Lambda reaches cross-account EFS through peered VPCs in the same physical AZ, with permissions satisfied. Does VPC configuration alone let code read files?
Q_ZH:
Lambda经已连通的对等VPC读取同一物理AZ的跨账户EFS，权限已满足。仅给函数加VPC配置，代码就能直接读文件吗？
A:
Answer: No. Configure a supported EFS access point and the function's local mount path too.
Key point: Peering supplies networking; the access point and mount configuration expose a readable directory to code. Same-AZ cross-account access can work, but connectivity is not mounting.
Watch out: Peered-VPC access may incur transfer charges; verify actual AZ, network, and file authorization.
A_ZH:
答：不能；还须配置受支持的EFS接入点和函数本地挂载路径。
考点：对等连接提供网络通路，EFS接入点与挂载配置把文件系统呈现为代码可读目录。同AZ跨账户路径可用，但连通网络不等于已完成文件挂载。
易错提醒：对等VPC访问文件系统仍可能计数据传输费用；须核实际AZ、网络与文件访问授权。
SOURCE: https://aws.amazon.com/blogs/compute/using-amazon-efs-for-aws-lambda-in-your-serverless-applications/

## aws-rb2-20261107-pack-gcl-031 | d2
TOPIC: Windows shared block access / Windows共享块访问
Q:
Windows needs a shared block interface with managed cross-AZ failover. Are ordinary SMB sharing or single-AZ EBS Multi-Attach equivalent?
Q_ZH:
Windows应用需要共享块存储接口，还要托管的跨AZ故障切换。普通SMB文件共享或单AZ EBS Multi-Attach等价吗？
A:
Answer: No. Evaluate applicable Multi-AZ FSx for ONTAP iSCSI block access.
Key point: iSCSI exposes block devices; SMB exposes files. ONTAP supports the corresponding block protocol and managed availability deployment, while EBS shared volumes remain AZ-scoped.
Watch out: Client connectivity, concurrent-write coordination, and failover configuration must support the block-storage design.
A_ZH:
答：不等价；评估适用Multi-AZ FSx for ONTAP的iSCSI块访问。
考点：iSCSI向主机提供块设备，SMB提供文件共享；ONTAP支持相应块协议和托管高可用部署，而EBS共享卷仍有AZ范围限制。
易错提醒：客户端连接、并发写协调和故障切换配置仍须支持该块存储方案。
SOURCE: https://docs.aws.amazon.com/fsx/latest/ONTAPGuide/what-is-fsx-ontap.html

## aws-rb2-20261107-pack-gcl-032 | d1
TOPIC: Containerization and runtime platforms / 容器化与运行平台
Q:
An eligible existing App2Container customer has a supported legacy Web application/environment to package for ECS/EKS. What do the tool and runtime platform each do?
Q_ZH:
已有App2Container使用资格，旧Web应用及环境受支持，要分析并打包成容器交ECS/EKS运行。工具与运行平台分别负责什么？
A:
Answer: App2Container analyzes, containerizes, and generates applicable deployment artifacts; ECS/EKS actually orchestrates and runs containers.
Key point: Producing migration artifacts and executing them are separate stages. Choosing a runtime does not automatically package an application.
Watch out: App2Container is closed to new customers. Existing eligibility does not make every program automatically convertible into microservices.
A_ZH:
答：App2Container分析、容器化并生成适用部署工件；ECS/EKS承担容器的实际编排运行。
考点：制作迁移工件与运行这些工件是两个阶段，选了运行平台不代表应用已经完成自动打包。
易错提醒：App2Container不再向新客户开放；既有资格也不表示任意程序都能自动改成微服务。
SOURCE: https://docs.aws.amazon.com/app2container/latest/UserGuide/what-is-a2c.html

## aws-rb2-20261107-pack-gsc-001 | d1
TOPIC: Shared Linux files / 共享Linux文件
Q:
Linux instances need the same files rather than independent copies. Writes are closed or synchronized as required before others read. How should storage work?
Q_ZH:
多台Linux实例要共同使用同一批文件，不想各自保留一份独立副本。写入按文件系统要求关闭或同步后供其他实例读取，应怎样存？
A:
Answer: Store files in one EFS filesystem and mount it from the instances.
Key point: EFS exposes shared files over NFS and scales capacity with file growth/shrinkage without prebuying disk size. Independent block volumes do not synchronize writes automatically.
Watch out: Shared files do not make arbitrary unsynchronized writes instantly visible; file-access and cache-consistency semantics still apply.
A_ZH:
答：把文件放在同一个EFS文件系统，让实例共同挂载。
考点：EFS以NFS提供同一份共享文件，并随文件增减自动伸缩容量，无需预先买定磁盘大小；各实例独立块卷不会自动同步写入。
易错提醒：共享文件不等于任意未同步写入都立即对其他客户端可见，仍须遵守文件访问与缓存一致性语义。
SOURCE: https://docs.aws.amazon.com/efs/latest/ug/how-it-works.html

## aws-rb2-20261107-pack-gsc-003 | d2
TOPIC: ECS EFS mounting / ECS挂载EFS
Q:
ECS containers need an existing EFS, with network and permissions satisfied. Does creating the filesystem automatically connect container directories?
Q_ZH:
ECS容器要读写已有EFS，网络和权限都已满足。只创建文件系统，容器目录会自动接上吗？
A:
Answer: No. Declare an EFS volume in the task definition and mount it at the required container directory.
Key point: The volume declaration selects storage; the mount point connects it to the container path. Together they establish usable file access.
Watch out: This is ECS task configuration, not a direct copy of EBS or Kubernetes configuration.
A_ZH:
答：不会；在任务定义声明EFS卷，并把该卷挂到容器所需目录。
考点：卷声明选定存储，mount point把存储接到容器文件路径；两者建立应用实际使用的文件访问关系。
易错提醒：这是ECS任务定义，不是把EBS或Kubernetes配置直接复制进来。
SOURCE: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/efs-volumes.html

## aws-rb2-20261107-pack-gsc-005 | d2
TOPIC: Lustre media and latency / Lustre介质与延迟
Q:
Thousands of compute nodes process shared files in parallel and require sustained submillisecond access to the entire dataset. Which filesystem and media fit?
Q_ZH:
数千计算节点要并行处理同一批文件，要求全数据集持续亚毫秒访问。应考虑哪种文件存储，介质怎样选？
A:
Answer: Consider FSx for Lustre SSD storage.
Key point: FSx for Lustre is a managed parallel filesystem. SSD suits small random file operations and stable submillisecond access across the full dataset.
Watch out: Not every Lustre medium meets this: HDD and SSD caching for only hot data have different latency characteristics.
A_ZH:
答：考虑FSx for Lustre的SSD存储。
考点：FSx for Lustre是全托管并行文件系统；SSD适合小而随机的文件操作，为完整数据集提供稳定亚毫秒访问。
易错提醒：不能只看到“Lustre”就认定所有介质均满足：HDD与仅热点使用SSD缓存的方案有不同延迟特性。
SOURCE: https://docs.aws.amazon.com/fsx/latest/LustreGuide/what-is.html

## aws-rb2-20261107-pack-gsc-006 | d2
TOPIC: Connecting Lustre and S3 / Lustre与S3衔接
Q:
HPC data is in S3, applications need file access, and final results must return to S3. How does Lustre bridge them?
Q_ZH:
HPC数据已经在S3，计算程序必须按文件访问，结果最终也要保留在S3。Lustre怎样衔接这两端？
A:
Answer: Associate FSx for Lustre with the S3 repository, process files, and export results to S3.
Key point: Association presents S3 objects as files. Returned Snowball data imports into S3, so it can enter the bucket first and then be associated with Lustre. Results require an applicable export process into the durable repository.
Watch out: S3 association does not mean every new result was automatically exported; configure and verify the export process.
A_ZH:
答：把FSx for Lustre关联S3数据仓库，按文件处理数据，再把结果导出回S3。
考点：关联把S3对象呈现为文件；返运Snowball的导入目标是S3，可先导入该桶，再关联Lustre。处理结果须按适用导出流程写回持久数据仓库。
易错提醒：关联S3不等于任何新结果已经自动写回；须配置并确认适用的导出流程。
SOURCE: https://docs.aws.amazon.com/fsx/latest/LustreGuide/create-dra-linked-data-repo.html

## aws-rb2-20261107-pack-gsc-007 | d2
TOPIC: NFS and SMB over shared data / NFS与SMB同份数据
Q:
Linux uses NFS and Windows uses SMB, but both must access the same shared data. How can duplicate file copies be avoided?
Q_ZH:
Linux客户端用NFS，Windows客户端用SMB，但两边必须访问同一份共享数据。怎样避免维护两份文件副本？
A:
Answer: Choose multiprotocol FSx for NetApp ONTAP and configure corresponding file permissions.
Key point: One storage system provides NFS and SMB interfaces, avoiding separate data copies just for protocol differences.
Watch out: Dual-protocol support does not automatically align permissions; configure identities and file access correctly.
A_ZH:
答：选择支持多协议访问的FSx for NetApp ONTAP，并配置相应的文件访问权限。
考点：同一存储系统可提供NFS和SMB接口，客户端不必为了协议不同各存一份数据。
易错提醒：支持两种协议不表示权限自动一致；用户身份和文件权限仍须正确配置。
SOURCE: https://docs.aws.amazon.com/fsx/latest/ONTAPGuide/what-is-fsx-ontap.html

## aws-rb2-20261107-pack-gsc-010 | d2
TOPIC: Stored versus cached primary data / Stored与Cached主数据
Q:
Volume Gateway must keep all primary data on premises at all times, within capacity quotas. Choose stored or cached, and why?
Q_ZH:
Volume Gateway要求完整主数据始终留在机房，容量符合配额。选stored还是cached，为什么？
A:
Answer: Choose stored volumes.
Key point: Stored keeps complete primary data locally for everyday access and asynchronously backs it up to AWS over encrypted connections.
Watch out: Cached uses S3 primary storage and local cache; misses fetch online without Glacier-style restore. Cloud egress can still cost money: no archive retrieval fee does not mean all reads/transfers are free.
A_ZH:
答：选stored volumes。
考点：stored把完整主数据留在本地，日常访问使用本地存储，并经加密连接把数据异步备份到AWS。
易错提醒：cached以S3为主存，只在本地保留缓存；未命中会在线回源，无需Glacier式归档恢复，但云端出站传输仍可能收费。不能把“没有归档取回费”理解为所有读取和传输免费。
SOURCE: https://aws.amazon.com/storagegateway/pricing/

## aws-rb2-20261107-pack-gsc-012 | d2
TOPIC: File gateways and NFS locking / 文件网关与NFS锁
Q:
On premises needs SMB/NFS files stored as S3 objects with hot caching. If applications also require NFSv4 locks to coordinate writes, how do S3 File Gateway and EFS differ?
Q_ZH:
机房想用SMB/NFS把文件以S3对象保存并缓存热点；若应用还必须靠NFSv4文件锁协调多客户端写入，S3 File Gateway和EFS怎样选？
A:
Answer: Use S3 File Gateway for ordinary file entry, S3 object backing, and local hot caching. Mandatory NFSv4 locking requires a filesystem supporting it, such as EFS.
Key point: File Gateway translates file access into S3 objects and mounts NFS with nolock. EFS supports NFSv4 byte-range locks for coordinating concurrent file access.
Watch out: A local cache does not guarantee all primary data remains local and does not provide iSCSI block volumes.
A_ZH:
答：普通文件入口、S3对象后端和本地热点缓存可用S3 File Gateway；必须保留NFSv4文件锁时，应选支持该语义的EFS等文件系统。
考点：File Gateway把本地文件接口转换为S3对象，NFS共享按nolock挂载；EFS提供共享文件系统并支持NFSv4字节范围锁，让客户端协调同一文件的并发访问。
易错提醒：本地缓存不是完整主数据必须常驻的保证，也不是给应用提供iSCSI块卷。
SOURCE: https://docs.aws.amazon.com/efs/latest/ug/features.html

## aws-rb2-20261107-pack-gsc-013 | d2
TOPIC: Virtual tape interfaces / 虚拟磁带接口
Q:
A company wants to retain its tape-backup software/workflow without managing physical tapes. Which gateway connects it?
Q_ZH:
公司已有磁带备份软件，想保留备份流程，却不再管理实体磁带。哪种网关能接上原软件？
A:
Answer: Tape Gateway.
Key point: It exposes virtual tape library and tape-device interfaces to backup software, with virtual tape data stored by AWS.
Watch out: File Gateway exposes files and Volume Gateway exposes block volumes; gateway naming alone does not supply tape-device compatibility.
A_ZH:
答：Tape Gateway。
考点：它向备份软件提供虚拟磁带库和磁带设备接口，写入的虚拟磁带数据由AWS保存。
易错提醒：File Gateway提供文件接口，Volume Gateway提供块卷；不能仅因都叫网关就替代磁带设备接口。
SOURCE: https://docs.aws.amazon.com/storagegateway/latest/tgw/StorageGatewayConcepts.html

## aws-rb2-20261107-pack-gsc-014 | d2
TOPIC: Temporary local disks / 临时本地盘
Q:
Original videos are safely stored and intermediate files are regenerable; local high I/O is the priority. Can instance store work, and when should EBS replace it?
Q_ZH:
视频原件已可靠保存，处理中间文件可重建，主要追求本机高I/O。instance store能用吗，什么时候应换EBS？
A:
Answer: Use instance store for temporary working sets; data that must survive instance stop or host loss needs durable storage such as EBS.
Key point: Local temporary disks fit regenerable data and live with the instance lifecycle. Stop, termination, and similar events lose data.
Watch out: Reboot usually retaining data does not mean stop does. Verify total local-disk capacity too.
A_ZH:
答：临时工作集可用instance store；必须在实例停止或主机丢失后保留的数据应放持久存储，如EBS。
考点：本地临时盘适合可重建的数据；它随实例生命周期存在，停止、终止等事件会丢失数据。
易错提醒：重启通常保留数据，不代表停止也保留；还须确认实例本地盘总容量足够。
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-store-lifetime.html

## aws-rb2-20261107-pack-gsc-015 | d2
TOPIC: Block-volume capacity and performance / 块卷容量与性能
Q:
A volume has enough capacity but insufficient IOPS. Must gp2 and gp3 both buy more GiB to improve performance?
Q_ZH:
块卷容量已经够，但IOPS不够。gp2与gp3提高性能，都必须继续多买GiB吗？
A:
Answer: gp2 baseline IOPS grows with capacity. Within supported limits gp3 can raise IOPS or throughput independently, avoiding unnecessary capacity purchases.
Key point: gp2 baseline is about 3 IOPS/GiB, such as roughly 3,000 IOPS for 1,000 GiB RDS gp2. gp3 separates performance and capacity; applicable EC2 gp3 can provide 15,000 IOPS.
Watch out: EC2 gp3 base storage costs less than gp2. RDS pricing, capacity thresholds, and IOPS limits follow database-product rules, not EC2 rules.
A_ZH:
答：gp2基线IOPS随容量增长；gp3在支持范围内可单独提高IOPS或吞吐，不必仅为性能购买多余容量。
考点：gp2基线约3IOPS/GiB，例如RDS的1000GiB gp2约3000IOPS；gp3把容量和性能配置分开，例如适用的EC2 gp3可提供15000IOPS。
易错提醒：EC2 gp3基础存储单价低于gp2；RDS的价格、容量门槛及IOPS上限须按数据库产品，不能照搬EC2规则。
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/general-purpose.html

## aws-rb2-20261107-pack-gsc-016 | d2
TOPIC: Volume and instance EBS bottlenecks / 卷与实例EBS瓶颈
Q:
Database I/O hits one EBS volume's limit. Is striping more volumes always useful, and which layer is checked first?
Q_ZH:
数据库I/O已碰到单块EBS卷上限。增加卷做条带化一定有用吗，要先检查哪一层？
A:
Answer: Check instance EBS bandwidth first. Striping can improve aggregate performance only while the instance has headroom.
Key point: Performance is limited by the lesser of aggregate volume capability and the instance-to-EBS path. For example, io1 reaches 64,000 IOPS per volume on supported instances; striping can increase aggregate capacity if the instance still has room.
Watch out: Striping spreads I/O without redundancy; backups and recovery remain necessary.
A_ZH:
答：先看实例EBS带宽；实例仍有余量时，多卷条带化才可能提高聚合性能。
考点：性能受卷侧聚合能力和实例到EBS路径中较小者限制。例如在受支持实例上，io1单卷最高64000IOPS；单卷已到上限但实例仍有余量时，可通过多卷条带化提高聚合能力。
易错提醒：条带化分摊I/O，不提供冗余；备份与恢复仍须安排。
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/ebs-io-characteristics.html

## aws-rb2-20261107-pack-gsc-017 | d2
TOPIC: Preinitializing snapshot volumes / 快照卷预初始化
Q:
An EBS volume restored from a snapshot must immediately handle high performance without slow first reads of some blocks. How should it be prepared?
Q_ZH:
从快照创建的EBS卷要马上承担高性能业务，不能接受首次读取某些块时变慢。应怎样准备？
A:
Answer: Enable Fast Snapshot Restore for that snapshot in the target AZ before creating the volume, or finish volume initialization before going live.
Key point: Ordinary snapshot restores require block initialization. Eligible FSR-created volumes are initialized at creation, avoiding extra first-read waits.
Watch out: FSR is enabled per snapshot and AZ, not automatically for every subsequent snapshot.
A_ZH:
答：在目标AZ对该快照启用Fast Snapshot Restore，再创建卷；或在上线前完成卷初始化。
考点：普通快照恢复需要初始化数据块；FSR让符合条件的新卷在创建时已初始化，避免首次读块的额外等待。
易错提醒：FSR按快照和AZ启用，不是对所有后续快照自动生效。
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/ebs-fast-snapshot-restore.html

## aws-rb2-20261107-pack-gsc-020 | d2
TOPIC: Multi-Attach boundaries / Multi-Attach边界
Q:
Instances want to write one EBS volume together. Does Multi-Attach provide EFS-like cross-AZ sharing of an ordinary filesystem?
Q_ZH:
多台实例想共同写一个EBS卷。开启Multi-Attach，就能像EFS一样跨AZ共享普通文件系统吗？
A:
Answer: No. It shares applicable io1/io2 block volumes among supported instances only in one AZ; applications or clustered filesystems must coordinate writes.
Key point: It shares a block device, not concurrent-file-write management or cross-AZ file service.
Watch out: Concurrent multi-host writes to an ordinary single-host filesystem may corrupt data.
A_ZH:
答：不能。Multi-Attach只在同一AZ给受支持实例共享适用io1/io2块卷，还需要应用或集群文件系统协调写入。
考点：它共享的是同一块设备，不替应用管理并发文件写入，也不会把卷变成跨AZ文件服务。
易错提醒：把普通单机文件系统同时挂给多台机器写入，可能损坏数据。
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes-multi.html

## aws-rb2-20261107-pack-gsc-021 | d2
TOPIC: S3 multipart upload / S3分块上传
Q:
Large S3 uploads are slow and a network interruption should not force full-file retransmission. How should uploads work?
Q_ZH:
大文件上传S3速度慢，而且网络中断后不想重传整个文件。怎样上传？
A:
Answer: Use multipart upload with parallel parts and retry only failed parts.
Key point: Parts transfer independently, so another part's failure does not force successful parts to repeat. Completion assembles one object.
Watch out: Complete or abort unfinished uploads; uploaded parts otherwise keep consuming storage.
A_ZH:
答：使用multipart upload，把对象分块并行上传，只重试失败的块。
考点：每个part独立传输，成功的块不必因另一个块失败而重传；全部完成后合成一个对象。
易错提醒：未完成的上传要完成或中止，否则已上传的分块会继续占用存储。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html

## aws-rb2-20261107-pack-gsc-022 | d2
TOPIC: Parallel S3 range downloads / S3并行范围下载
Q:
One connection cannot download a large S3 object fast enough. Beyond multipart uploads, how can downloading run in parallel?
Q_ZH:
要从S3下载一个大对象，单连接吞吐不足。除了上传时分块，下载能怎样并行？
A:
Answer: Use multiple GETs for different byte ranges and assemble them in order.
Key point: Range requests return specified portions, allowing multiple connections to retrieve separate sections in parallel.
Watch out: The object does not automatically become many objects; the client manages range division and assembly.
A_ZH:
答：用多个GET请求读取对象的不同字节范围，再按顺序组合。
考点：Range请求只传指定部分，多个连接可以并行取回同一对象的不同区段。
易错提醒：这不会把一个大对象自动变成很多对象；客户端仍负责范围划分和组合。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance-guidelines.html

## aws-rb2-20261107-pack-gsc-023 | d2
TOPIC: Accelerating object transfers / 双向对象传输加速
Q:
Global users upload/download unique large files to one S3 bucket. Distance slows transfers and download cache reuse is poor. How can the path improve?
Q_ZH:
全球用户对同一S3桶上传和下载独有大文件，远距离传输慢，下载也很难复用缓存。怎样优化路径？
A:
Answer: Evaluate S3 Transfer Acceleration, using its accelerated endpoint for supported uploads and downloads.
Key point: Requests traverse nearby edges and optimized network paths to/from the bucket. It improves bidirectional object transfers rather than repeated-content cache hits.
Watch out: Acceleration can add charges. Test benefits from actual source locations and meet bucket/request restrictions.
A_ZH:
答：评估S3 Transfer Acceleration，使用加速端点执行支持的上传与下载操作。
考点：请求经附近边缘位置及优化网络路径往返目标桶；它优化双向对象传输路径，不是靠缓存重复内容命中来加速。
易错提醒：加速可能增加费用，须测试实际来源地点的收益，并满足桶和请求限制。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/transfer-acceleration.html

## aws-rb2-20261107-pack-gsc-029 | d2
TOPIC: Object-creation triggers / 对象创建触发
Q:
New S3 files need immediate processing without hourly bucket scans. How should computation start?
Q_ZH:
文件一进入S3就要处理，不想每小时扫描整个桶。怎样触发后续计算？
A:
Answer: Use S3 object-created events to notify Lambda or SQS as needed, or route through EventBridge; EventBridge can also target supported SageMaker Pipelines.
Key point: Writes trigger processing of changes without repeatedly listing the entire bucket to discover files.
Watch out: Avoid recursive triggers when processing writes into the same trigger scope; consumers must tolerate duplicate events.
A_ZH:
答：使用S3对象创建事件，按需要通知Lambda、送入SQS，或经EventBridge路由；EventBridge也可把SageMaker Pipelines设为受支持目标。
考点：由写入事件启动处理，只响应变化，不必反复列举整个桶寻找新文件。
易错提醒：若处理又写回同一触发范围，要防止递归触发；消费者也应承受重复事件。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html

## aws-rb2-20261107-pack-gsc-030 | d2
TOPIC: S3 creation event types / S3创建事件类型
Q:
Will listening only for ObjectCreated:Put cover CopyObject and completed multipart uploads for Lambda processing?
Q_ZH:
Lambda要处理S3新增对象，只监听ObjectCreated:Put，会覆盖CopyObject和完成分块上传产生的对象吗？
A:
Answer: No. Match Copy and CompleteMultipartUpload events, or all ObjectCreated subtypes as required.
Key point: Objects arise through different operations; filtering matches the actual operation, not a universal Put for every new object.
A_ZH:
答：不会；应匹配相应的Copy、CompleteMultipartUpload事件，或按业务使用ObjectCreated的全部子类型。
考点：对象创建有不同操作来源，事件过滤匹配的是实际操作类型，不是所有新增对象都叫Put。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html

## aws-rb2-20261107-pack-gsc-031 | d2
TOPIC: Object metadata indexes / 对象元数据索引
Q:
Files in S3 must be found by attributes such as year or customer. Do object tags alone provide a search database?
Q_ZH:
大量文件放S3，业务要按年份、客户等属性检索后取回对应文件。只给对象加标签，就等于已有搜索数据库吗？
A:
Answer: No. Build a queryable metadata index recording business attributes and corresponding S3 object locations.
Key point: Object storage holds files; the index finds them by business conditions, such as querying RDS metadata and then reading S3 by object key.
Watch out: Tags support classification and policies, but do not imply an existing search interface for arbitrary business conditions.
A_ZH:
答：不等于；应建立可查询的元数据索引，记录业务属性和对应S3对象位置。
考点：对象存储负责保存文件，索引负责按业务条件找到对象；例如用RDS查询元数据，再按对象键读取S3文件。
易错提醒：标签可供分类和策略使用，但不能假设任意业务条件已经有现成的标签搜索接口。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-tagging.html

## aws-rb2-20261107-pack-gsc-032 | d2
TOPIC: Node-based cache failover / 节点缓存复制接管
Q:
Repeated reads overload a database. A node-based ElastiCache cache needs low latency, replicas, and automatic failover. Redis OSS/Valkey or Memcached?
Q_ZH:
重复读取拖慢数据库，需低延迟缓存；采用node-based ElastiCache且要求副本与自动故障接管。Redis OSS/Valkey与Memcached怎样选？
A:
Answer: Choose an appropriate Redis OSS/Valkey replication group with replicas and applicable failover.
Key point: Cache hits read in-memory copies with typical submillisecond access, reducing repeated database work. Node-based Redis OSS/Valkey also supplies replication groups and failover.
Watch out: Memcached Serverless also offers multi-AZ redundancy and snapshots. This comparison is limited to node-based deployments.
A_ZH:
答：选满足要求的Redis OSS/Valkey复制组，并配置副本和适用的接管。
考点：缓存命中时直接读内存中的数据副本，提供典型亚毫秒访问并减少数据库重复工作；node-based Redis OSS/Valkey还提供复制组及故障接管。
易错提醒：Memcached Serverless也提供跨AZ冗余及快照；本卡比较只限node-based，不能把其差异套到所有部署模式。
SOURCE: https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Replication.html

## aws-rb2-20261107-pack-gsc-033 | d2
TOPIC: Maintaining cached values / 缓存写入一致性
Q:
A self-managed cache-aside application reads cache first, then the database on misses. Does updating only the database automatically remove old cached values?
Q_ZH:
应用使用自己维护的cache-aside缓存：先查缓存，未命中再读数据库。只更新数据库后，缓存中的旧值会自动消失吗？
A:
Answer: No. Application writes must update or invalidate the corresponding cache. Updating the cache with database writes is a write-through strategy.
Key point: In this independent cache mode, database success does not synchronize cache for the application. Read and write paths jointly maintain freshness.
Watch out: TTL only limits stale-value lifetime; application code remains responsible for writes and invalidation.
A_ZH:
答：不会；应用应在写入时更新或使相应缓存失效。写数据库时同步更新缓存，称为write-through策略。
考点：在这种独立缓存模式中，数据库写成功不会替应用同步缓存；读路径和写路径须共同维护新鲜度。
易错提醒：TTL只限制旧值保留时间；这里的写入与失效由应用维护，不会因数据库写成功就自动完成。
SOURCE: https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Strategies.html

## aws-rb2-20261107-pack-gsc-034 | d2
TOPIC: Leaderboard sorted sets / 排行榜有序集合
Q:
Game scores change frequently and the top ten must be available without sorting a full table each time. Which Redis structure fits?
Q_ZH:
游戏分数频繁变化，要随时取得前十名，而不是每次扫描整张成绩表排序。Redis哪种结构适合？
A:
Answer: A sorted set storing players with scores.
Key point: It maintains score order and retrieves members by rank or score range, supporting changing leaderboards.
Watch out: Ordinary key-value caching retrieves one player but does not automatically maintain everyone's live ranking.
A_ZH:
答：有序集合（sorted set），把玩家和分数一起保存。
考点：集合按分数维护顺序，可直接按排名或分数范围取成员，适合不断更新的排行榜。
易错提醒：普通键值缓存能取某个玩家，但不自动提供全体玩家的实时排名。
SOURCE: https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/elasticache-use-cases.html

## aws-rb2-20261107-pack-gsc-035 | d2
TOPIC: Redis geospatial indexes / Redis地理索引
Q:
An application needs nearby stores. Do ordinary Redis key-values by store ID directly support distance filtering?
Q_ZH:
应用要快速找出用户位置附近的门店。Redis只按门店ID存普通键值，能直接按距离筛选吗？
A:
Answer: No. Store coordinates in a Redis geospatial index and query by distance.
Key point: The index organizes longitude/latitude for location searches rather than reading every store for application-side calculations.
Watch out: Coordinates are query data; an ordinary cache hit does not supply spatial search.
A_ZH:
答：不能直接做到；可用Redis地理空间索引保存坐标并按距离查询。
考点：地理索引把经纬度组织成可按位置检索的数据，不必逐个读取全部门店再由应用计算。
易错提醒：坐标属于查询数据，普通缓存命中本身不提供空间检索能力。
SOURCE: https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/RedisUseCases.html

## aws-rb2-20261107-pack-gsc-036 | d2
TOPIC: DynamoDB read caching / DynamoDB读缓存
Q:
DynamoDB responds in milliseconds, but repeated reads of the same items need submillisecond latency. Which compatible cache fits?
Q_ZH:
DynamoDB已经提供毫秒响应，但大量相同项目反复读取，业务需要亚毫秒读响应。哪种兼容缓存可考虑？
A:
Answer: DynamoDB Accelerator (DAX).
Key point: DAX caches DynamoDB read results in memory; hits reduce direct-table latency.
Watch out: It targets DynamoDB. Strongly consistent reads do not get the same cache-hit acceleration, and DAX does not cache RDS.
A_ZH:
答：DynamoDB Accelerator（DAX）。
考点：DAX在内存中缓存DynamoDB读取结果，命中时减少直接访问表的延迟。
易错提醒：它面向DynamoDB；强一致读取不会靠缓存命中变成同样的加速路径，也不能拿来缓存RDS。
SOURCE: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DAX.html

## aws-rb2-20261107-pack-gsc-037 | d2
TOPIC: Latest-write visibility / 最新写入可见性
Q:
Reads sometimes return old DynamoDB values after a successful write. For the latest completed write, add DAX or change consistency?
Q_ZH:
DynamoDB刚写成功，随后的读取偶尔还见旧值。若必须读到最新已完成写入，应该加DAX还是改变读取一致性？
A:
Answer: Use strongly consistent reads on supported read paths.
Key point: Eventual consistency permits briefly stale results. Strong consistency addresses visibility; adding cache does not increase consistency.
Watch out: Confirm the API/index supports it; this does not extend to unsupported paths such as GSIs.
A_ZH:
答：对支持的读取使用强一致读取。
考点：最终一致读取允许短暂旧值；强一致读取解决可见性要求，增加缓存不等于提高一致性。
易错提醒：先确认所用接口和索引支持强一致；不能把这一结论直接套到GSI等不支持的路径。
SOURCE: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html

## aws-rb2-20261107-pack-gsc-040 | d2
TOPIC: Asynchronous TTL cleanup / TTL异步清理
Q:
Expired DynamoDB records must not be displayed. Does TTL guarantee deletion at the exact expiry second?
Q_ZH:
DynamoDB记录过期后不应再展示。启用TTL，就能保证到期那一秒已从表中删除吗？
A:
Answer: No. TTL deletes asynchronously; filter expired records when reading too.
Key point: The TTL attribute stores an expiry timestamp in Unix epoch seconds, not retention days. Background cleanup cannot implement second-exact access control.
Watch out: Expired items not yet deleted may still appear in reads.
A_ZH:
答：不能；TTL异步删除，读取时还应过滤过期记录。
考点：TTL属性存过期时刻的Unix epoch秒值，不是保留天数；后台按此时刻异步清理，不能用它实现到秒的访问控制。
易错提醒：未实际删除的过期项目仍可能出现在读取结果中。
SOURCE: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html

## aws-rb2-20261107-pack-gsc-041 | d2
TOPIC: Large payloads and object references / 大载荷与对象引用
Q:
A file exceeds database-item or queue-message limits but needs ID lookup or queued processing. How should storage be divided?
Q_ZH:
文件太大，超出数据库项目或队列消息的载荷限制，还要按ID查找或排队处理。怎样分开存？
A:
Answer: Put the body in S3 and keep metadata/object references in the database or message; readers fetch the body by reference.
Key point: Separate large files from query/scheduling information rather than forcing bytes into small-payload interfaces. SQS Extended Client Library can manage this with fewer Java-code changes.
Watch out: An S3 address alone does not make arbitrary consumers download it; consumer code or a compatible client must fetch it.
A_ZH:
答：正文放S3，数据库或消息保留元数据和对象引用，读取方按引用取回正文。
考点：大文件与查询、调度信息分工，避免把全部字节塞进受限的小载荷接口；SQS少改Java代码可用Extended Client Library管理存取。
易错提醒：只写一个S3地址不会让任意消费者自动下载；消费者或兼容客户端必须执行取回。
SOURCE: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-managing-large-messages.html

## aws-rb2-20261107-pack-gsc-042 | d2
TOPIC: Business-data change streams / 业务数据变更流
Q:
DynamoDB item or Neptune graph changes need processing. Are service management-state notifications equivalent to data-change streams?
Q_ZH:
DynamoDB项目或Neptune图数据每次变化后要做处理。服务的管理状态通知，等于业务数据变更流吗？
A:
Answer: No. Use DynamoDB Streams or Neptune Streams for business-data changes, then connect application processing.
Key point: Change streams describe changed business data; resource-state notices usually describe events affecting resources such as database instances.
Watch out: Enabling a stream does not automatically run processing code.
A_ZH:
答：不等于；DynamoDB用DynamoDB Streams，Neptune用Neptune Streams记录业务数据变化，应用再接入处理。
考点：数据变更流告诉你哪些业务数据发生了变化；资源状态通知通常告诉你数据库实例等资源出了什么事，不能互相代替。
易错提醒：启用变更流不等于处理代码已自动运行。
SOURCE: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html

## aws-rb2-20261107-pack-gsc-046 | d2
TOPIC: Using read-replica endpoints / 读副本端点使用
Q:
An RDS read replica exists but all application queries still use the primary endpoint. Will reads automatically shift?
Q_ZH:
给RDS建了read replica，应用却仍把所有查询发到原主库端点。读负载会自动分过去吗？
A:
Answer: No. Connect eligible read-only requests to the replica endpoint.
Key point: Replication creates a copy without changing application destinations. Reads reach the replica only when actually directed there.
Watch out: Writes still use the writable primary; account for replica lag.
A_ZH:
答：不会；应把适用的只读请求连接到副本端点。
考点：复制建立数据副本，不自动改写应用连接目标；请求真正到达副本，才分担主库读取工作。
易错提醒：写请求仍走可写主库，并考虑副本读取的复制延迟。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html

## aws-rb2-20261107-pack-gsc-048 | d2
TOPIC: Snapshot export and restoration / 快照导出与恢复
Q:
Can S3 data files exported from an RDS snapshot directly restore the same database as the original native snapshot?
Q_ZH:
RDS快照导出的S3数据文件，可以当作原RDS快照直接恢复出同一个数据库吗？
A:
Answer: No. Snapshot export serves analytics; restore through supported snapshot-restoration or data-import paths.
Key point: Queryable data files and native recovery points are different artifacts. Export does not preserve all database state in a directly restorable form.
Watch out: A copy of database data in S3 does not mean any engine can directly restore those files.
A_ZH:
答：不可以；快照导出面向数据分析，恢复数据库应使用受支持的快照恢复或数据导入路径。
考点：可查询的数据文件与服务原生数据库恢复点是不同产物，导出不等于保存了可直接恢复的全部数据库状态。
易错提醒：S3有一份数据库数据，不代表任意引擎都能直接从这些文件恢复。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ExportSnapshot.html

## aws-rb2-20261107-pack-gsc-049 | d2
TOPIC: Database OS customization / 数据库底层定制
Q:
A database requires an OS patch or engine customization unavailable through ordinary RDS permissions. How should deployment be chosen?
Q_ZH:
数据库必须使用某个操作系统补丁或引擎定制，普通RDS不给所需底层权限。如何判断部署方式？
A:
Answer: Use RDS Custom within support scope, such as BYOL Oracle; evaluate self-managed EC2 if the required customization or topology is unsupported.
Key point: Ordinary managed databases reduce operations by limiting low-level control. Custom or self-managed options provide more control and customer maintenance responsibility.
Watch out: RDS Custom for Oracle does not support managed cross-Region read replicas; ordinary RDS features do not all carry over.
A_ZH:
答：在支持范围内可用RDS Custom，例如采用自带许可证（BYOL）的Oracle；不支持所需定制或拓扑时评估EC2自管。
考点：普通托管数据库限制底层控制来减少运维；Custom或自管提供更多控制，也带来更多客户维护责任。
易错提醒：Oracle版不支持受管跨Region读副本；不能把普通RDS的所有功能直接套用到Custom。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/custom-oracle-feature-support.html

## aws-rb2-20261107-pack-gsc-050 | d2
TOPIC: RDS storage growth / RDS存储扩展
Q:
RDS data grows toward full storage while CPU is lightly used. Prioritize a larger compute instance or storage autoscaling?
Q_ZH:
RDS数据量持续增长，担心存储空间耗尽，但CPU并不忙。应优先扩计算实例还是安排存储自动扩展？
A:
Answer: Configure engine-supported storage autoscaling with an appropriate maximum.
Key point: It increases storage capacity. More CPU and memory does not replace disk-space growth.
Watch out: Automatic growth does not imply automatic shrinking or fixing all IOPS bottlenecks.
A_ZH:
答：安排符合引擎条件的存储自动扩展，并设定合适上限。
考点：它增长的是可用存储容量；扩大CPU和内存规格不能代替解决磁盘空间不足。
易错提醒：自动增加存储不等于自动缩容，也不保证修复所有IOPS瓶颈。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIOPS.Autoscaling.html

## aws-rb2-20261107-pack-gsc-051 | d2
TOPIC: RDS gp3 performance configuration / RDS gp3性能配置
Q:
Confirmed storage IOPS limits RDS writes. MySQL/PostgreSQL above 400 GiB needs 15,000 or over 20,000 IOPS. Must it immediately use the most expensive storage?
Q_ZH:
RDS写入慢，已确认瓶颈是存储IOPS。MySQL/ PostgreSQL容量在400GiB以上，要15000或超过20000IOPS，就必须直接换最贵存储吗？
A:
Answer: First increase gp3 IOPS within supported limits; compare io2 when sustained-performance or other needs remain unmet. Check instance I/O capability too.
Key point: These engines' gp3 starts at 12,000 baseline IOPS from 400 GiB and allows up to 64,000. A 2-TB database exceeding 20,000 IOPS does not inherently require io2. Address the constrained storage layer; more CPU may not fix it.
Watch out: Engine, capacity, and instance limits vary. Do not copy EC2-volume rules or assume gp3 is cheapest everywhere.
A_ZH:
答：先在支持范围内提高gp3 IOPS，满足不了持续性能等要求时再比较io2；也要确认实例I/O能力。
考点：这些引擎的gp3从400GiB起有12000基线IOPS，可配置到64000IOPS；例如2TB并不因超过20000IOPS就必须换io2。按真正不足的存储层调整，扩CPU不一定消除I/O瓶颈。
易错提醒：RDS各引擎、容量门槛和实例能力不同，不能照搬EC2卷的限制或保证所有场景gp3最便宜。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html

## aws-rb2-20261107-pack-gsc-055 | d2
TOPIC: Aurora read endpoint scope / Aurora读取端点范围
Q:
Aurora has several readers. Ordinary queries can use all, but reporting should use a specific subset. Which endpoints differ?
Q_ZH:
Aurora有多个读实例，普通查询可用全部reader，但报表只想使用指定的一组实例。连接入口怎样区分？
A:
Answer: Use the reader endpoint for ordinary reads and a supported custom endpoint for the selected instance group.
Key point: Endpoints determine eligible destinations for new connections. Custom membership narrows the pool instead of assigning all readers to every workload.
Watch out: Reader endpoints mainly distribute connections, not every SQL statement on an existing connection equally.
A_ZH:
答：普通读流量用reader endpoint；指定实例组可使用受支持的custom endpoint。
考点：端点决定新连接可以落在哪些实例，custom endpoint缩小成员范围，不必把所有reader用于同一工作负载。
易错提醒：reader endpoint主要分配连接，不保证把一个既有连接上的每条SQL逐条均分。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.Endpoints.html

## aws-rb2-20261107-pack-gsc-057 | d2
TOPIC: Aurora compute scaling dimensions / Aurora计算扩展维度
Q:
Aurora is MySQL/PostgreSQL-compatible. How do Serverless v2 and Aurora Auto Scaling change compute with load?
Q_ZH:
Aurora是兼容MySQL/PostgreSQL的关系库。负载变化时，Serverless v2与Aurora Auto Scaling分别怎样扩展计算能力？
A:
Answer: Serverless v2 adjusts eligible instance capacity; Aurora Auto Scaling changes reader count based on read-load metrics.
Key point: Serverless v2 changes one instance's ACUs, each approximately 2 GiB memory plus corresponding CPU/network. Auto Scaling changes the number of read-serving instances; identify the required dimension.
Watch out: More readers do not distribute writes among multiple writers.
A_ZH:
答：Serverless v2调整适用实例的计算容量；Aurora Auto Scaling按读负载指标自动增减reader副本。
考点：Serverless v2按ACU改变单实例算力，每ACU约对应2GiB内存及相应CPU/网络；Auto Scaling改变分担读取的实例数量，先分清需求落在哪一维。
易错提醒：读副本数量增加不会把写操作自动分摊到多个writer。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Integrating.AutoScaling.html

## aws-rb2-20261107-pack-gsc-060 | d2
TOPIC: Ongoing changes during migration / 迁移中的持续变化
Q:
A source database keeps writing during migration. What does one full copy miss, and what should supplement it?
Q_ZH:
迁数据库时源库仍持续写入。只做一次全量复制，切换时会有什么缺口，应补什么？
A:
Answer: Use supported continuous replication and cut over after catching up. A general path is DMS full load plus CDC; RDS PostgreSQL can also migrate through a native Aurora PostgreSQL read replica, caught up then promoted.
Key point: Full load moves existing data and continuous replication carries later changes. Supported SCT/Snowball workflows can move large initial copies offline before DMS continues online changes. A snapshot/export alone does not follow ongoing writes.
Watch out: One-way CDC does not resolve both databases writing the same data; define write direction.
A_ZH:
答：采用受支持的持续复制，追赶后再安排切换：通用路径是DMS全量加载加CDC；RDS PostgreSQL迁Aurora PostgreSQL也可创建原生Aurora只读副本，追平后提升。
考点：全量搬已有数据，持续复制接着搬变化，追赶后再切换。受支持的SCT/Snowball流程可把大库初始副本离线运入，DMS再接续线上变更；一次快照/导出本身不会追上仍写入的源。
易错提醒：单向CDC不自动解决两库同时写同一数据的冲突；迁移必须明确写入方向。
SOURCE: https://aws.amazon.com/blogs/storage/enable-large-scale-database-migrations-with-aws-dms-and-aws-snowball/

## aws-rb2-20261107-pack-gsc-061 | d2
TOPIC: Cross-engine schema conversion / 跨引擎结构转换
Q:
Oracle moves to PostgreSQL with DMS data replication ready. Are schemas, stored procedures, and SQL differences automatically all resolved?
Q_ZH:
Oracle迁PostgreSQL，已经准备DMS复制数据。数据库结构、存储过程和SQL差异也会自动全部解决吗？
A:
Answer: No. Separately assess/convert with an applicable schema-conversion tool and repair incompatible code.
Key point: Replication moves records; schema/SQL conversion makes structures and programs understandable to the target engine.
Watch out: Conversion tools can leave manual work. Copied data does not establish application compatibility.
A_ZH:
答：不会；应另用适用的schema conversion工具评估和转换，并修正不兼容代码。
考点：数据复制负责移动记录，结构与SQL转换负责让目标引擎理解数据结构和程序，两者职责不同。
易错提醒：转换工具也可能留下人工改造项，不能把“完成复制”当作应用已经兼容。
SOURCE: https://docs.aws.amazon.com/dms/latest/userguide/CHAP_SchemaConversion.html

## aws-rb2-20261107-pack-gsc-062 | d2
TOPIC: SQL Server compatibility layer / SQL Server兼容层
Q:
A SQL Server application moves to Aurora PostgreSQL with fewer T-SQL and connection-protocol changes. Which compatibility feature merits evaluation?
Q_ZH:
SQL Server应用要迁Aurora PostgreSQL，又希望减少T-SQL和连接协议改造。哪种兼容能力值得先评估？
A:
Answer: Babelfish for Aurora PostgreSQL.
Key point: It supplies supported SQL Server protocol and T-SQL compatibility so some applications retain their access patterns.
Watch out: Check actual feature support; compatibility does not reproduce every SQL Server behavior.
A_ZH:
答：Babelfish for Aurora PostgreSQL。
考点：它提供受支持的SQL Server协议和T-SQL兼容能力，让部分既有应用沿用原访问方式。
易错提醒：必须核对所用功能的支持范围；兼容层不代表完整复制SQL Server所有行为。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/babelfish.html

## aws-rb2-20261107-pack-gsc-066 | d2
TOPIC: Migration discovery and assessment / 迁移发现与评估
Q:
Before migration, server configuration, actual utilization, and dependencies are needed rather than hardware purchase specifications alone. Which AWS discovery capabilities can supply them?
Q_ZH:
迁移前要取得服务器配置、实际利用率及依赖，而非只按购买的硬件选云资源。可以从什么AWS发现能力取得这些数据？
A:
Answer: Eligible existing customers can use applicable Application Discovery Service collection; new customers should evaluate currently supported AWS Transform discovery/assessment paths.
Key point: Collected inventory, utilization, and dependencies reveal resource demand and systems needing joint migration. Rated hardware specifications cannot replace actual data.
Watch out: Check service eligibility and platform support; previously available paths may not admit new customers.
A_ZH:
答：已有使用资格时可使用Application Discovery Service的适用采集能力；新客户评估AWS Transform当前支持的发现和评估路径。
考点：真实采集的清单、利用率与依赖反映工作负载需要多少资源、哪些系统须一起迁移，额定硬件规格不能代替这些数据。
易错提醒：服务有资格和平台支持范围，不能因为旧方案曾可用就假定新客户可按相同路径开通。
SOURCE: https://docs.aws.amazon.com/application-discovery/latest/userguide/what-is-appdiscovery.html

## aws-rb2-20261107-pack-gsc-073 | d2
TOPIC: Direct Connect VIF paths / 专线VIF路径
Q:
Can on-premises Direct Connect access to AWS public-service addresses and private VPC addresses use the same VIF path indiscriminately?
Q_ZH:
机房经Direct Connect访问AWS公有服务地址，与访问VPC私网地址，能都照搬同一种VIF路径吗？
A:
Answer: No. Public services usually use public VIFs; private VPC access uses applicable private/transit VIFs and gateways.
Key point: VIF/gateway selection determines destinations. Private VIFs can connect through a Direct Connect gateway to VGWs/VPCs in different Regions; transit VIFs serve TGW paths. Physical connectivity does not establish arbitrary routing.
Watch out: Public VIF does not mean ordinary internet transit. DX gateways do not automatically provide transitive VGW-to-VGW or data-center connectivity.
A_ZH:
答：不能；公有服务通常用public VIF，VPC私网用适用的private或transit VIF及对应网关。
考点：VIF与网关决定哪些目的地址可达。private VIF可经Direct Connect gateway关联不同Region的VGW/VPC；transit VIF用于TGW路径。专线物理接通，不等于各网络已取得任意互通路由。
易错提醒：public VIF不代表流量走普通公网；DX gateway可接跨Region VPC，却不自动提供VGW之间或数据中心之间的传递互通。
SOURCE: https://docs.aws.amazon.com/directconnect/latest/UserGuide/WorkingWithVirtualInterfaces.html

## aws-rb2-20261107-pack-gsc-075 | d2
TOPIC: Hub routing across networks / 多网络中心转接
Q:
Two VPCs grow into many, all needing communication with each other and on premises. What is wrong with continuing pairwise peering, and what fits?
Q_ZH:
VPC从两个增长到很多个，还要让各VPC与机房多方互通。继续逐对建peering有什么问题，应考虑什么？
A:
Answer: Evaluate a Transit Gateway hub topology.
Key point: Peering is nontransitive. TGW routes among multiple networks within a Region; cross-Region TGW peering requires explicit routes at both ends.
Watch out: Attachments still need correct route tables and access controls; they do not open every network automatically.
A_ZH:
答：评估Transit Gateway的中心转接拓扑。
考点：VPC peering不提供传递路由，TGW以Region内中心路由连接多个网络；跨Region可连接两端TGW的peering，并为两端明确配置路由。
易错提醒：接上TGW仍须配置正确路由表和访问控制，不会自动开放全部网络。
SOURCE: https://docs.aws.amazon.com/vpc/latest/tgw/what-is-transit-gateway.html

## aws-rb2-20261107-pack-gsc-076 | d2
TOPIC: Expanding VPC address space / VPC地址扩展
Q:
A VPC's original IPv4 range is exhausted. Must all applications move to another VPC?
Q_ZH:
VPC原IPv4地址段不够用了。一定要把所有应用迁到另一个VPC吗？
A:
Answer: Not necessarily. Associate an additional CIDR where permitted and create subnets in the new range.
Key point: Additional address space expands the same VPC while retaining existing resource relationships.
Watch out: IPv4 blocks must be /16–/28 and nonoverlapping; /32 host addresses cannot form a VPC. Existing subnets cannot simply expand.
A_ZH:
答：不一定；在规则允许时关联额外CIDR，并在新地址范围创建子网。
考点：增加地址段可以扩展同一VPC可用地址，保留原有VPC中的资源关系。
易错提醒：IPv4 CIDR块须在/16到/28之间且不与已有段重叠；/32主机地址不能用来建VPC。已有子网也不能直接扩成更大网段。
SOURCE: https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html

## aws-rb2-20261107-pack-gsc-077 | d2
TOPIC: Online and offline transfer / 在线与离线搬迁
Q:
Historical data has a fixed cloud-migration deadline but little shared-network bandwidth. How should online versus offline-device transfer be judged?
Q_ZH:
海量历史数据须在固定期限内迁云，但共享网络带宽很小。怎样判断在线搬运还是离线设备运输？
A:
Answer: Estimate an online lower bound as volume divided by actual available rate; if the window is insufficient, compare applicable offline devices.
Key point: Use migration-available bandwidth, not total bandwidth. Eligible Snowball devices bypass narrow links with 256-bit device encryption and KMS-protected keys, but preparation, shipping, and import still take time.
Watch out: Verify current eligibility, capacity, and delivery window; retired devices or omitted shipping time cannot prove feasibility.
A_ZH:
答：先用数据量÷实际可用传输速率估算在线下限；窗口不够时，比较适用的离线设备方案。
考点：先区分迁移可用带宽和总带宽。适用Snowball离线设备可避开窄链路，设备数据有256位加密，KMS保护加密密钥；但仍要计入准备、运输及导入时间。
易错提醒：须核对设备现行可用资格、可用容量和交付窗口，不能用退役设备或忽略运输时间证明可行。
SOURCE: https://docs.aws.amazon.com/datasync/latest/userguide/datasync-large-migration-timelines.html

## aws-rb2-20261107-pack-gsc-080 | d2
TOPIC: Filtering and fan-out / 过滤与扇出
Q:
Each downstream system needs its own copy of an event, restricted to relevant event types. Are consumers competing on one SQS queue sufficient?
Q_ZH:
同一事件要让多个下游各收到一份，还希望下游只收自己关心的类型。多个消费者竞争同一SQS队列够吗？
A:
Answer: No. Use SNS publish/subscribe fan-out with subscription filters.
Key point: Independent subscriptions have separate delivery paths. Buffered consumers can each use SQS; supported HTTP subscriptions use their endpoints. One competing queue normally divides work rather than copying it to everyone.
Watch out: Endpoint durability/retries differ; HTTP subscriptions are not SQS queues.
A_ZH:
答：不够；用SNS发布订阅扇出，并给相应订阅设置过滤。
考点：独立订阅各有自己的投递路径；需要缓冲的下游可各接SQS，受支持的HTTP等订阅则接对应端点。竞争一个队列通常会分走工作，不是每方各一份。
易错提醒：不同端点的持久性和重试行为不同，不把HTTP订阅当成SQS队列。
SOURCE: https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html

## aws-rb2-20261107-pack-gsc-086 | d2
TOPIC: Messaging protocol compatibility / 消息协议兼容
Q:
A legacy application must retain JMS or AMQP while moving to AWS with few changes. Can SQS replace it merely because both are queues?
Q_ZH:
旧应用必须保留JMS或AMQP消息接口，希望少改代码迁AWS。能只因为SQS也叫队列就直接替换吗？
A:
Answer: No. Evaluate an Amazon MQ engine compatible with the required protocol.
Key point: Similar messaging purposes do not imply compatible clients. Managed brokers retain applicable existing protocols; SQS has its own API.
Watch out: Check engine, protocol version, and features; do not interchange all ActiveMQ/RabbitMQ capabilities.
A_ZH:
答：不能；应评估兼容所需协议的Amazon MQ引擎。
考点：消息用途相似不等于客户端协议兼容；托管消息代理可保留适用的既有协议，SQS使用自身API。
易错提醒：仍须核对引擎、协议版本和应用特性，不能把ActiveMQ与RabbitMQ所有能力混用。
SOURCE: https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/welcome.html

## aws-rb2-20261107-pack-gsc-089 | d2
TOPIC: Time and event triggers / 时间与事件触发
Q:
How do triggers differ for a report at a fixed daily time versus processing immediately when an order event occurs?
Q_ZH:
每天固定时间运行报表，与订单事件出现时立即启动处理，触发方式怎样选？
A:
Answer: Use an appropriate scheduler such as EventBridge Scheduler for fixed times; use event matching such as EventBridge rules for business events.
Key point: One follows a clock and the other actual event content. Periodic scanning introduces delay and checks unchanged data.
Watch out: A scheduled trigger does not guarantee business success; manage target permissions, retries, and outcomes.
A_ZH:
答：固定时间用适用调度器，如EventBridge Scheduler；业务事件用EventBridge规则等事件匹配路径。
考点：一个按时钟触发，一个按实际事件内容触发；定时扫描会引入等待并检查大量没有变化的数据。
易错提醒：调度触发不保证业务已经成功，目标权限、失败重试和运行结果仍须管理。
SOURCE: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rules.html

## aws-rb2-20261107-pack-gsc-090 | d2
TOPIC: HTTPS event destinations / HTTPS事件目标
Q:
A matched business event must call a third-party HTTPS API with authentication without a Lambda just for forwarding. Which EventBridge capability fits?
Q_ZH:
业务事件匹配后要带认证调用第三方HTTPS接口，不想为简单转发额外写Lambda。EventBridge可用什么？
A:
Answer: Use an applicable API destination with a connection managing the required authentication.
Key point: The rule decides when, the API destination identifies the HTTP target, and the connection supplies supported authentication.
Watch out: Authentication, timeout, and retry limits still apply; this does not durably wait for arbitrarily long HTTP work.
A_ZH:
答：适用的API destination，并配置connection管理所需认证。
考点：规则决定何时转发，API destination定义HTTP目标，connection提供支持的认证信息。
易错提醒：目标调用仍受认证方式、超时和重试等边界限制，不等于持久等待任意长的HTTP任务。
SOURCE: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html

## aws-rb2-20261107-pack-gsc-093 | d2
TOPIC: Kinesis on-demand capacity / Kinesis按需容量
Q:
Kinesis traffic is unpredictable and manual shard calculations are undesirable. Which capacity mode fits?
Q_ZH:
Kinesis流量难预测，不想持续人工计算shard数量。可考虑哪种容量模式？
A:
Answer: Evaluate Kinesis Data Streams on-demand mode.
Key point: The service manages scaling for applicable load, reducing manual shard management compared with provisioned capacity.
Watch out: Throughput and sudden-growth limits remain; on-demand does not guarantee no throttling for arbitrary peaks.
A_ZH:
答：评估Kinesis Data Streams的on-demand模式。
考点：服务按适用负载管理容量伸缩，减少手工分片管理；provisioned模式则需要管理相应容量。
易错提醒：按需仍有吞吐与突增等边界，不能解释成任意峰值都保证不节流。
SOURCE: https://docs.aws.amazon.com/streams/latest/dev/how-do-i-size-a-stream.html

## aws-rb2-20261107-pack-gsc-094 | d2
TOPIC: Kinesis partition ordering / Kinesis分区顺序
Q:
Events from one device need ordered processing. Is a random different partition key for every record suitable?
Q_ZH:
Kinesis中同一设备的事件要按顺序处理。随机给每条记录不同partition key合适吗？
A:
Answer: No. Use a consistent partition key for the ordered business key and consume in shard order.
Key point: Partition keys select shards. Splitting related records across shards loses their shared shard-order relationship.
Watch out: Shard ordering is not global ordering across shards; producer/consumer concurrency must also preserve required order.
A_ZH:
答：不合适；同一有序业务键应使用一致的partition key，并按分片顺序消费。
考点：分区键决定记录进入的shard；需要关联顺序的记录分散到不同shard，就没有同一分片的顺序关系。
易错提醒：同一shard有序不等于所有shard之间全局有序，生产和消费并发也须遵守所需顺序。
SOURCE: https://docs.aws.amazon.com/streams/latest/dev/key-concepts.html

## aws-rb2-20261107-pack-gsc-095 | d2
TOPIC: Crawlers and ETL / Crawler与ETL
Q:
Data must transform into S3 for analytics, from landed CSV or continuous MSK/Kinesis streams. Is running a Glue crawler enough?
Q_ZH:
数据要转换后进入S3供分析，可能是已落地CSV，也可能来自MSK/Kinesis持续流。只运行Glue crawler够吗？
A:
Answer: No. Run actual Glue ETL: batch jobs can convert CSV to Parquet; streaming ETL can consume MSK/Kinesis, transform, and write S3.
Key point: Glue provides serverless ETL with AWS-managed execution; applicable Spark workers parallelize transformation. Crawlers discover schema/update catalogs; jobs actually read, transform, and write.
Watch out: A cataloged schema does not mean original bytes became Parquet.
A_ZH:
答：不够；应运行实际Glue ETL作业：批作业可把CSV转Parquet，streaming ETL可从MSK/Kinesis消费并转换后写S3。
考点：Glue提供无服务器ETL，AWS管理执行基础设施，适用Spark作业可由多个worker并行分担转换。crawler只发现结构并更新目录，ETL作业才真正读取、转换和写出数据。
易错提醒：目录中登记了表结构，不代表原始文件字节已经变成Parquet。
SOURCE: https://docs.aws.amazon.com/glue/latest/dg/add-job-streaming.html

## aws-rb2-20261107-pack-gsc-096 | d2
TOPIC: Visual data preparation / 可视化数据准备
Q:
Analysts need no-code visual field cleanup, quality analysis, processing provenance, and shared reusable steps. What fits?
Q_ZH:
分析员不写清洗代码，要可视化规范字段、分析数据质量、追溯处理来源，并共享重复使用的清洗步骤。可考虑什么？
A:
Answer: Use Glue DataBrew where applicable and save transformations as shareable recipes.
Key point: Recipes describe cleaning, profiles describe distribution/quality, and lineage shows origin and processing, supporting reuse and traceability.
Watch out: This is preparation, not merely crawler schema discovery or predictive-model training.
A_ZH:
答：在适用环境中使用Glue DataBrew；把转换步骤保存为可共享复用的recipe。
考点：recipe记录怎样清洗；data profile描述数据分布与质量，data lineage展示数据从哪里来、经过哪些处理，便于复用并追踪同一准备流程。
易错提醒：这是数据清洗，不是只扫描schema的crawler，也不等于训练预测模型。
SOURCE: https://docs.aws.amazon.com/databrew/latest/dg/core-concepts-and-terms.html

## aws-rb2-20261107-pack-gsc-097 | d2
TOPIC: Distributed data processing / 分布式数据计算
Q:
Parallelizable data work outgrows one server. How can multiple nodes help instead of endlessly enlarging one machine?
Q_ZH:
大量数据的处理可以拆分并行，单台服务器越来越慢。怎样利用多节点处理，而不是只不断加大一台机器？
A:
Answer: Evaluate distributed Spark/Hadoop frameworks such as EMR. If processing must stay on premises, supported Outposts can host an EMR cluster.
Key point: Frameworks divide suitable computation across nodes. Outposts places supported AWS infrastructure on site, so distributed scaling need not move processing into a Region.
Watch out: Code does not all parallelize automatically; match framework and data partitioning.
A_ZH:
答：评估Spark/Hadoop等分布式框架，例如Amazon EMR；若处理必须留在机房，可在受支持的Outposts上运行EMR集群。
考点：分布式框架把可拆分计算分给多个节点；Outposts把受支持AWS基础设施放在现场，使扩展处理不必等于把业务数据计算搬进Region。
易错提醒：并非所有代码都能自动并行，必须适合所用框架与数据分区。
SOURCE: https://docs.aws.amazon.com/emr/latest/ManagementGuide/emr-plan-outposts.html

## aws-rb2-20261107-pack-gsc-102 | d2
TOPIC: Redshift service API / Redshift服务API
Q:
Lambda occasionally queries supported Redshift without maintaining traditional persistent database connections. Which interface fits?
Q_ZH:
Lambda要偶尔查询受支持的Redshift，不想自己维护传统持久数据库连接。可以使用哪种调用接口？
A:
Answer: Redshift Data API.
Key point: Submit SQL and obtain results through a service API, reducing caller-managed connection pools and driver sessions.
Watch out: Authorization and applicable authentication remain required; it is not a universal SQL API for any database.
A_ZH:
答：Redshift Data API。
考点：通过服务API提交SQL并取得结果，减少调用方维护数据库连接池和驱动会话的工作。
易错提醒：仍须具备授权及适用认证配置，不是给任意数据库都通用的SQL接口。
SOURCE: https://docs.aws.amazon.com/redshift/latest/mgmt/data-api.html

## aws-rb2-20261107-pack-gsc-103 | d2
TOPIC: Warehouse SQL machine learning / 仓库SQL机器学习
Q:
SQL analysts want to train on warehouse data and invoke predictions in SQL without building a separate full model service. Which Redshift capability fits?
Q_ZH:
分析员主要会SQL，想用仓库数据训练模型并在SQL中调用预测，不想另外手写整套模型服务。Redshift有什么适用能力？
A:
Answer: Evaluate Redshift ML.
Key point: It integrates applicable model creation and inference into SQL workflows, reducing external training/deployment setup by analysts.
Watch out: Prepare suitable training data and check model support; ordinary aggregate reports do not train models themselves.
A_ZH:
答：评估Redshift ML。
考点：它把适用的模型创建和预测调用接入SQL工作流，减少分析员自行搭建外部训练与部署流程的工作。
易错提醒：仍须准备适合训练的数据并核对模型支持范围，普通聚合报表本身不会训练模型。
SOURCE: https://docs.aws.amazon.com/redshift/latest/dg/machine_learning.html

## aws-rb2-20261107-pack-gsc-104 | d2
TOPIC: Full-text content search / 正文全文检索
Q:
New documents need keyword searches over their bodies. Do S3 files plus a few tags provide full-text search?
Q_ZH:
持续新增的文档需要按正文关键词检索。仅把文件放S3并加几个标签，等于已经有全文搜索了吗？
A:
Answer: No. Build an index of applicable text using a search engine such as OpenSearch.
Key point: Search engines organize content into searchable indexes for body conditions; object storage saves the files.
Watch out: Tag/object lookup and body full-text indexes are different query tasks.
A_ZH:
答：没有；应把适用文本建立搜索索引，例如使用OpenSearch。
考点：搜索引擎把内容组织成可检索索引，支持按正文条件查找；文件存储只负责保存对象。
易错提醒：对象标签索引与正文全文索引是不同查询任务，不能用“能找对象”替代全文检索能力。
SOURCE: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/what-is.html

## aws-rb2-20261107-pack-gsc-105 | d2
TOPIC: Understanding existing text / 已有文本的理解
Q:
Customer reviews are already text and need sentiment/entity detection. Start with transcription, OCR, or text understanding?
Q_ZH:
客户评论已经是文字，要识别情绪和实体。应先做语音转录、OCR，还是文本理解？
A:
Answer: Use applicable text understanding such as Amazon Comprehend.
Key point: The missing step is understanding textual features. Transcription converts audio to text and OCR converts images; neither replaces sentiment analysis.
Watch out: Check language/feature support instead of assuming every language fits the same model.
A_ZH:
答：使用适用的文本理解能力，如Amazon Comprehend。
考点：输入已经是文字，所缺的是理解文字内容的特征；转录解决音频到文字，OCR解决图像到文字，不能代替情绪分析。
易错提醒：先核对语言和功能支持，不能把所有文字语言都假设为同一模型范围。
SOURCE: https://docs.aws.amazon.com/comprehend/latest/dg/what-is.html

## aws-rb2-20261107-pack-gsc-106 | d2
TOPIC: Translation after transcription / 转录后的翻译
Q:
Non-English recordings are transcribed into their original language, but downstream analysis accepts only English. Analyze sentiment directly or add which step?
Q_ZH:
非英语录音已转成原语言文字，但下游分析只接受英语。应直接做情绪分析，还是先补哪一步？
A:
Answer: First translate supported text into English, such as with Amazon Translate.
Key point: Transcription changes the audio medium; translation changes text language. Downstream models need supported-language input.
Watch out: Translation is neither retranscribing audio nor automatically analyzing sentiment/entities.
A_ZH:
答：先用适用的翻译能力把文字转换为英语，例如Amazon Translate。
考点：转录改变音频载体，翻译改变文字语言，下游模型只有收到支持的语言输入才能按要求处理。
易错提醒：翻译不是重新转录音频，也不自动给出情绪或实体分析。
SOURCE: https://docs.aws.amazon.com/translate/latest/dg/what-is.html

## aws-rb2-20261107-pack-gsc-107 | d2
TOPIC: Pretrained image analysis / 预训练图像分析
Q:
Uploaded images need common-object recognition or inappropriate-content moderation without custom vision training. What fits?
Q_ZH:
用户上传图片，需要用现成模型识别常见物体或审核不适宜内容，不想自建视觉训练流程。可用什么？
A:
Answer: Evaluate applicable Amazon Rekognition image recognition or moderation.
Key point: Supported pretrained visual analysis reduces custom training for common recognition tasks.
Watch out: Image recognition is not arbitrary document-structure extraction; check custom-category/domain support.
A_ZH:
答：评估Amazon Rekognition对应的图像识别或内容审核能力。
考点：服务提供受支持的预训练视觉分析，减少为常见识别任务自行训练模型的需要。
易错提醒：识别图像内容不等于提取任意文档结构；自定义类别和特殊领域还要核对支持范围。
SOURCE: https://docs.aws.amazon.com/rekognition/latest/dg/what-is.html

## aws-rb2-20261107-pack-gsc-109 | d2
TOPIC: Specialized forecasting versus custom models / 专用预测与自建模型
Q:
An eligible Forecast customer lacks modeling expertise and needs only supported standard time-series forecasting. How should this compare with SageMaker model training/deployment?
Q_ZH:
已有Forecast使用资格，团队缺少ML建模经验，只需受支持的标准时序预测。与自行在SageMaker训练部署模型相比，应怎样取舍？
A:
Answer: Prefer evaluating a suitable specialized managed forecasting service such as Forecast; consider custom modeling for greater control.
Key point: Specialized services manage more forecasting steps. Modeling platforms offer control with additional modeling/operations responsibility.
Watch out: Eligibility and task support are prerequisites; old exam references do not establish new-customer availability.
A_ZH:
答：优先评估符合需求的专用托管预测能力，如Forecast；需要更多定制控制时再考虑自行建模。
考点：专用服务承担更多预测流程，自建模型平台提供更大控制空间，也要求团队承担相应建模和运维。
易错提醒：资格与任务支持是前提，不能因为旧题提过某服务就假定新客户也能使用。
SOURCE: https://docs.aws.amazon.com/forecast/latest/dg/what-is-forecast.html

## aws-rb2-20261107-pack-gsc-110 | d2
TOPIC: Video transcoding and caching / 视频转码与缓存
Q:
Existing video formats/bitrates do not suit target players. Does CloudFront caching automatically create suitable versions?
Q_ZH:
已有视频文件的格式或码率不适合目标播放器。只放到CloudFront缓存，就能自动变成合适的视频版本吗？
A:
Answer: Transcode first, then distribute output. Managed MediaConvert is one option; self-managed EC2 encoding is also possible with greater program/server maintenance.
Key point: Transcoding changes encoding/output versions; caching changes delivery location without converting source formats.
Watch out: On-demand files and live processing use different paths; check input and playback modes.
A_ZH:
答：先进行适用转码，再分发输出。例如用托管MediaConvert；也可在EC2自管编码程序，但要承担更多程序与服务器维护。
考点：转码改变媒体编码和输出版本；缓存主要改变交付位置，不会自行转换原始文件格式。
易错提醒：点播文件转码与直播实时处理有不同服务路径，先确认输入和播放方式。
SOURCE: https://docs.aws.amazon.com/mediaconvert/latest/ug/what-is.html

## aws-rb2-20261107-pack-gsc-111 | d2
TOPIC: Sizing for memory bottlenecks / 按内存瓶颈选型
Q:
CPU is lightly used but memory is continually insufficient. Add identical instances or first change which sizing dimension?
Q_ZH:
实例CPU利用率不高，内存却持续不足。应只增加同类实例数量，还是先按什么调整规格？
A:
Answer: Evaluate memory capacity matching the actual bottleneck, such as an applicable memory-optimized instance.
Key point: CPU headroom does not supply memory. Increase the constrained resource instead of buying unused compute.
Watch out: Validate metrics and horizontal scalability; one transient peak does not justify permanent overprovisioning.
A_ZH:
答：先按真实资源瓶颈评估更合适的内存规格，例如适用的memory-optimized实例。
考点：CPU余量不代表内存足够，选型要增加当前缺的资源，避免购买大量用不到的计算能力。
易错提醒：先确认指标可信、应用是否可横向拆分，不能凭一个瞬时内存峰值永久过配。
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-types.html

## aws-rb2-20261107-pack-gsc-112 | d2
TOPIC: ASG limits and policies / ASG上下限与策略
Q:
An ASG has minimum/maximum sizes. Will rising traffic automatically scale toward a CPU target?
Q_ZH:
ASG已设最小和最大实例数，流量增长时就会自动按目标CPU扩容吗？
A:
Answer: Limits alone do not do that. Configure an applicable dynamic policy such as target tracking.
Key point: Limits bound allowed capacity; target tracking changes desired capacity from the selected load metric.
Watch out: Metrics must represent workload, with size limits and startup time still applying.
A_ZH:
答：不会只因设置上下限就按CPU伸缩；应配置适用的动态策略，例如target tracking。
考点：上下限限定允许的容量范围，目标追踪才根据选定负载指标调整desired capacity。
易错提醒：指标要能反映工作负载，且仍受容量上下限与启动时间限制。
SOURCE: https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-target-tracking.html

## aws-rb2-20261107-pack-gsc-113 | d2
TOPIC: Preparing capacity in advance / 提前准备容量
Q:
Capacity must be ready before peaks. How do a fixed daily opening time and prediction from traffic history change scaling choice?
Q_ZH:
高峰到来前就得准备实例：已知每天固定开场时间，与需要从历史流量预测高峰，扩容怎样安排？
A:
Answer: Use scheduled scaling for known times/capacities and predictive scaling for historical patterns, combined with real-time dynamic adjustment.
Key point: Advance preparation avoids waiting to launch after high load arrives. Forecasts and manually supplied schedules are different capacity inputs.
Watch out: Unexpected traffic still needs real-time policies; forecasts do not guarantee actual demand.
A_ZH:
答：已知日历和容量用scheduled scaling；按历史规律估计容量可用predictive scaling，并配合实时动态调整。
考点：提前准备减少等高负载出现后才启动实例的等待；历史预测和人工给定日历是不同的容量来源。
易错提醒：临时偏离预测的流量仍需实时策略应对，预测不是保证实际负载完全一致。
SOURCE: https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-predictive-scaling.html

## aws-rb2-20261107-pack-gsc-114 | d2
TOPIC: Scaling queue workloads / 队列工作量伸缩
Q:
SQS consumers have low CPU but a growing queue. Does CPU alone accurately measure backlog?
Q_ZH:
消费者处理SQS工作，CPU还不高但排队越来越长。只按CPU扩容能准确反映积压吗？
A:
Answer: Not necessarily. Scale from workload metrics such as backlog per instance or waiting time.
Key point: The same queue length imposes different pressure with different consumer counts. Per-instance backlog relates work to processing capacity.
Watch out: Set targets using average processing time; raw total queue length is not stable per-instance pressure.
A_ZH:
答：不一定；用每实例积压量或等候时间等适合的工作量指标驱动伸缩。
考点：相同队列长度由更多消费者分担时压力不同，每实例积压量把待处理工作与处理容量联系起来。
易错提醒：应按任务平均处理时间设置目标，不能把全部队列长度不加换算地当稳定的每实例压力。
SOURCE: https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-using-sqs-queue.html

## aws-rb2-20261107-pack-gsc-117 | d2
TOPIC: Hibernated warm pools / 休眠预热池
Q:
An ASG initializes instances in a warm pool and must resume loaded RAM state on scale-out. Is a Stopped pool enough?
Q_ZH:
ASG把实例先初始化、放入warm pool候命。扩容时还要直接续用已加载的RAM状态，只用Stopped预热够吗？
A:
Answer: No. Evaluate a supported Hibernated warm pool to retain RAM state too.
Key point: Ordinary stopping mainly preserves disks; hibernation saves RAM to EBS and resumes memory/process state, reducing reload preparation.
Watch out: Warm instances still have support requirements and charges; arbitrary application state cannot be prepared without limits.
A_ZH:
答：不够；可评估支持休眠的Hibernated warm pool，把RAM状态也保存下来。
考点：普通停止主要保留磁盘；休眠把RAM写入EBS，恢复时接续内存和进程状态，减少重新加载这部分准备的等待。
易错提醒：预热实例仍有支持条件和费用，不等于任何应用状态都能无限预先准备。
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Hibernate.html

## aws-rb2-20261107-pack-gsc-119 | d2
TOPIC: Placement latency and isolation / 放置延迟与隔离
Q:
How do placement strategies differ for tightly coupled low-latency compute versus independent nodes needing hardware-failure separation?
Q_ZH:
紧耦合计算要降低节点间通信延迟，与独立节点要分散硬件故障风险，placement策略取舍是什么？
A:
Answer: Use cluster placement for communication-intensive nodes and applicable spread-style strategies for hardware isolation.
Key point: Proximity helps communication; dispersion reduces shared hardware-failure impact. Placement serves different objectives.
Watch out: Different accounts or tenancy names do not automatically prove hardware separation.
A_ZH:
答：通信密集可用cluster placement把节点集中；需要硬件隔离时用适用的spread等分散策略。
考点：靠近有利于通信，分散降低共同硬件故障影响，放置位置服务于不同目标。
易错提醒：账户不同或tenancy名称不同，不自动证明节点已按要求分散到不同硬件。
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/placement-groups.html

## aws-rb2-20261107-pack-gsc-120 | d2
TOPIC: HPC communication interfaces / HPC通信接口
Q:
Supported Linux HPC nodes exchange data frequently, communication-stack overhead is the bottleneck, and compatible libraries exist. Which interface merits evaluation, and why?
Q_ZH:
受支持Linux HPC节点频繁交换数据，瓶颈在通信栈，应用已有适用通信库。应评估哪种接口，为什么？
A:
Answer: Elastic Fabric Adapter (EFA).
Key point: Applicable software uses Libfabric and similar paths to bypass traditional OS-kernel communication, reducing tightly coupled low-latency communication overhead.
Watch out: Instance, driver, and software support are required; EFA does not replace global internet-entry acceleration.
A_ZH:
答：评估Elastic Fabric Adapter（EFA）。
考点：适用通信软件可通过Libfabric等绕过传统OS内核通信路径，减少开销，适合低延迟紧耦合节点通信。
易错提醒：须满足实例、驱动和软件支持；它不替代全球用户到Region的互联网入口加速。
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/efa.html

## aws-rb2-20261107-pack-gsc-121 | d2
TOPIC: Instance network bottlenecks / 实例网络瓶颈
Q:
EC2 throughput or packets per second is limiting. Will adding ENIs necessarily raise the instance's total network ceiling?
Q_ZH:
EC2网络吞吐或每秒包数成了瓶颈。只多挂几块网卡就一定提高实例总网络上限吗？
A:
Answer: No. Evaluate instance network specifications and supported enhanced networking such as ENA.
Key point: Interface count and instance network capability differ. Enhanced networking and appropriate instance sizing affect the relevant data path.
Watch out: Drivers, instance support, and actual limits apply; extra ENIs are not unlimited bandwidth.
A_ZH:
答：不一定；应评估实例网络规格及适用的ENA等增强网络能力。
考点：网卡数量与实例可用网络能力不是同一指标，增强网络和合适实例规格才作用于相应数据路径。
易错提醒：驱动、实例支持和具体网络限额仍须匹配，不能把任意实例加网卡当作无限扩带宽。
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/enhanced-networking.html

## aws-rb2-20261107-pack-gsc-123 | d2
TOPIC: Routing by outstanding requests / 按未完成请求分流
Q:
ALB RequestCount and TargetResponseTime rise and some targets accumulate work. How can new requests avoid targets with many unfinished requests?
Q_ZH:
ALB监控中RequestCount（请求数）和TargetResponseTime（后端响应耗时）升高，部分目标积压。怎样让新请求避开仍有大量未完成工作的目标？
A:
Answer: Evaluate least outstanding requests routing to eligible targets with fewer unfinished requests.
Key point: It reflects current unfinished work better than simple rotation. Monitoring diagnoses the problem; two CloudWatch thresholds do not directly route requests.
Watch out: ActiveConnectionCount measures connections, not response time; unfinished requests are not CPU usage.
A_ZH:
答：评估least outstanding requests算法，将新请求导向未完成请求较少的适用目标。
考点：它依据当前未完成工作数分配请求，比只轮流分配更能反映这类忙闲差异；监控指标用于诊断，不是两条CloudWatch阈值直接控制路由。
易错提醒：ActiveConnectionCount量连接而非响应耗时；未完成请求数也不等于CPU使用率。
SOURCE: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-cloudwatch-metrics.html

## aws-rb2-20261107-pack-gsc-124 | d2
TOPIC: On-premises IP targets / 机房IP目标
Q:
A regional load balancer must reach on-premises servers over working private connectivity. Can a non-EC2 server be registered by AWS instance ID?
Q_ZH:
区域负载均衡要把流量送到已通过私网连通的机房服务器。能按AWS实例ID注册这台非EC2服务器吗？
A:
Answer: No. Use supported IP targets with reachable addresses in allowed ranges.
Key point: Instance IDs identify AWS instances. IP targeting decouples destinations from EC2 identity for supported remote private services.
Watch out: Address, routing, and health-check restrictions remain; arbitrary public addresses are not all valid targets.
A_ZH:
答：不能；应使用服务支持的IP目标方式，注册允许范围内的可达目标地址。
考点：实例ID指向相应AWS实例，IP目标把转发目标与EC2身份分开，可接入支持范围内的远端私网服务。
易错提醒：仍须满足目标地址、路由和健康检查规则，不意味着任意公网地址都能注册。
SOURCE: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html

## aws-rb2-20261107-pack-gsc-127 | d2
TOPIC: Weighted DNS releases / DNS权重发布
Q:
A new release should get a small DNS traffic share, then increase gradually. Which routing policy controls proportions?
Q_ZH:
新版本只想先接收少量DNS流量，再逐步增加。按比例分流应使用哪类路由？
A:
Answer: Route 53 weighted routing with appropriate old/new record weights.
Key point: Weights set relative DNS-selection probabilities; latency/geographic policies use other criteria. Selection is random by configured weights, including equal-weight random distribution.
Watch out: Caching affects actual request proportions; HTTP requests are not guaranteed to divide exactly per ten requests.
A_ZH:
答：Route 53 weighted routing，给新旧入口设置相应权重。
考点：权重控制DNS选择各记录的相对比例，适合逐步发布；延迟和地理路由按其他条件选择。 Route 53按所设权重随机选择DNS记录；相等权重可用于随机分流。
易错提醒：DNS缓存等会影响实际终端请求比例，不保证每十个HTTP请求严格按同样比例分配。
SOURCE: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-weighted.html

## aws-rb2-20261107-pack-gsc-128 | d2
TOPIC: Multivalue DNS answers / DNS多值回答
Q:
DNS should return several healthy service addresses per answer. Which routing fits, and is it a real load balancer?
Q_ZH:
DNS希望一次回答多个健康服务地址，而不是始终只给一个地址。可以考虑什么路由，它等同真正负载均衡器吗？
A:
Answer: Consider Route 53 multivalue answer; it is not a connection/HTTP load balancer.
Key point: It can randomly return up to eight appropriately health-filtered addresses; clients choose destinations. Multiple answers do not proxy subsequent connections.
Watch out: It does not proxy connections, apply HTTP routing, or migrate established connections automatically.
A_ZH:
答：可考虑Route 53 multivalue answer；它不等同连接层或HTTP负载均衡器。
考点：Route 53可随机返回最多8个经过适用健康筛选的资源地址，客户端再选择连接目标；返回多地址不等于DNS代理后续业务连接。
易错提醒：它不会代理每条连接、执行HTTP路由或让已有连接自动迁移到健康实例。
SOURCE: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-multivalue.html

## aws-rb2-20261107-pack-gsc-129 | d2
TOPIC: Authoritative DNS delegation / 权威DNS委派
Q:
A public domain's authoritative DNS moves to Route 53. Does forwarding Resolver queries to the old DNS complete migration?
Q_ZH:
公网域名的权威DNS要迁到Route 53。只让Resolver把查询转发给旧DNS，就完成权威托管迁移了吗？
A:
Answer: No. Create a public hosted zone/records and delegate the domain to Route 53's supplied name servers.
Key point: Delegation determines the final authoritative source in global resolution. Forwarding only changes the query path and may leave authority at the old system.
Watch out: Private hosted zones do not directly provide public authority for arbitrary internet users.
A_ZH:
答：没有；应建立public hosted zone和对应记录，并把域名的权威委派指向Route 53提供的名称服务器。
考点：权威委派决定全球解析链最终向谁取记录；转发查询只是换了解析路径，权威记录仍可能在旧系统。
易错提醒：私有托管区域不能直接承担任意互联网用户的公网权威解析。
SOURCE: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/MigratingDNS.html

## aws-rb2-20261107-pack-gsc-130 | d2
TOPIC: Cache keys and content variants / 缓存键与内容变体
Q:
One URL returns different languages. CloudFront forwards the language header but omits it from the cache key. What goes wrong?
Q_ZH:
同一URL按语言返回不同内容。CloudFront只转发语言请求头，但缓存键不区分语言，会有什么问题？
A:
Answer: Languages may share one cached response. Include values actually determining content versions in the applicable cache key.
Key point: Origin forwarding and which requests cache treats as identical are separate configurations. Keys must distinguish actual variants.
Watch out: CachingOptimized excludes Authorization and query parameters. Forwarding them alone does not isolate content; irrelevant key fields also reduce reuse.
A_ZH:
答：不同语言可能共用同一缓存响应；应把真正影响内容版本的值纳入适用缓存键。
考点：源站收到哪些字段与缓存把哪些请求视作同一个对象，是两种配置；键必须区分实际内容变体。
易错提醒：CachingOptimized的缓存键不包含Authorization或查询参数，不能仅因转发了这些字段就当成已隔离内容；也别把所有无关字段都加入键而降低复用率。
SOURCE: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/controlling-the-cache-key.html

## aws-rb2-20261107-pack-gsc-131 | d2
TOPIC: Invalidation and revalidation / 失效与持续重验证
Q:
S3 changed but CloudFront may serve old data. What handles one-time removal versus freshness checks before each reuse?
Q_ZH:
S3源端已更新，CloudFront还可能返回旧响应。单次清除旧副本，与每次复用前验证新鲜度，分别用什么？
A:
Answer: Use invalidation for a one-time update; use compliant no-cache or zero-effective-lifetime policies for continuous revalidation.
Key point: Origin strong consistency does not clear edges. Default TTL applies without explicit origin lifetime; max-age must be evaluated with policy min/max TTL. Invalidation forces later origin retrieval; revalidation checks whether old responses remain usable.
Watch out: A positive minimum TTL can override no-cache/no-store; CachingOptimized's minimum is one second. Match policy to required freshness.
A_ZH:
答：单次更新可用invalidation使旧对象失效；持续重验证用符合要求的no-cache或零有效期策略。
考点：源端强一致不清除边缘副本。默认TTL用于源未给明确缓存时长时；源给max-age等时须连同缓存策略最小/最大TTL判断。发布时失效让下次回源，重验证则检查旧响应能否继续用。
易错提醒：最小TTL大于0可能覆盖源站no-cache/no-store要求；例如CachingOptimized最小TTL是1秒。实际缓存策略必须符合所需新鲜度。
SOURCE: https://aws.amazon.com/cloudfront/faqs/

## aws-rb2-20261107-pack-gsc-132 | d2
TOPIC: CloudFront multi-origin routing / CloudFront多源路由
Q:
S3 static files and an ALB dynamic API need one CloudFront domain. Must both move to one origin?
Q_ZH:
静态文件在S3，动态接口在ALB，希望用户用同一个CloudFront域名。必须把两类内容搬到同一个源站吗？
A:
Answer: No. Configure multiple origins and path cache behaviors routing requests to each.
Key point: A unified entry selects storage/compute origins by path while preserving separate backend responsibilities.
Watch out: Configure dynamic caching/forwarding appropriately; multiple origins alone do not guarantee correct routing.
A_ZH:
答：不必；为分发配置多个origin，并用路径cache behavior把请求送到相应源站。
考点：分发入口统一，后端按请求路径选择数据或计算源，静态和动态服务可保留各自职责。
易错提醒：动态行为的缓存和转发规则要按业务配置，多个origin本身不会保证请求正确分流。
SOURCE: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesCacheBehavior.html

## aws-rb2-20261107-pack-gsc-133 | d2
TOPIC: Lambda execution compatibility / Lambda运行环境兼容
Q:
Both tasks run minutes: a Python function needs 1 GB and another is an existing Windows container. Can both use standard Lambda?
Q_ZH:
同样只跑几分钟：Python函数需要1GB内存，另一项是现成Windows容器。两者都能直接用标准Lambda吗？
A:
Answer: Use a supported Python runtime with 1 GB for the function. Standard Lambda does not fit Windows containers; use a Windows-version-compatible ECS/Fargate or Batch environment.
Key point: Standard Lambda provides supported Linux function environments with configurable memory. Short duration does not make a different-OS container compatible.
Watch out: Standard invocation is generally limited to 900 seconds. Specialized execution-product modes have their own limits, not universally identical rules.
A_ZH:
答：Python函数可用受支持的Python运行时并配置1GB内存；Windows容器不适合标准Lambda，可在支持该Windows版本的ECS/Fargate或Batch Windows环境运行。
考点：标准Lambda提供受支持的Linux函数执行环境，内存可以配置；任务短不等于能把另一种操作系统的现成容器直接运行进去。
易错提醒：标准Lambda调用通常受900秒上限；特殊执行产品模式另按其限制判断，不能把一种模式的规则推给全部计算。
SOURCE: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-windows-considerations.html

## aws-rb2-20261107-pack-gsc-134 | d2
TOPIC: Concurrency limits and prewarming / 并发额度与预热
Q:
Lambda must limit simultaneous executions and also preprepare environments to reduce cold starts. What do reserved and provisioned concurrency do?
Q_ZH:
Lambda既有“限制最多同时运行多少”，又有“提前准备执行环境减少冷启动”的需求。reserved和provisioned concurrency各解决什么？
A:
Answer: Reserved concurrency reserves and caps concurrency; provisioned concurrency preinitializes execution environments.
Key point: Execution slots and whether environments are ready are separate dimensions.
Watch out: Reserved concurrency alone does not prewarm every environment.
A_ZH:
答：reserved concurrency预留并限制并发额度；provisioned concurrency预先初始化相应执行环境。
考点：允许同时执行的名额，与环境是否已准备好，是两个不同维度。
易错提醒：只设置reserved concurrency不会自动把所有环境预热。
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html

## aws-rb2-20261107-pack-gsc-135 | d2
TOPIC: Java cold-start snapshots / Java冷启动快照
Q:
Java 11 Lambda initializes slowly and needs fewer scaling cold starts, without a strict prewarmed-environment guarantee. How can it improve, and why compare SnapStart first?
Q_ZH:
Java 11 Lambda初始化慢，希望减少扩容冷启动，没有严格的预热环境保证要求。怎样改善，为什么先比较SnapStart？
A:
Answer: Save an initialization-state snapshot when publishing an applicable version; new environments restore from it.
Key point: Reusing initialization avoids repeating expensive setup. Managed Java runtime SnapStart has no additional feature charge, making it worth comparing before continuously paid provisioned concurrency.
Watch out: Check compatibility. Snapshots are not always-prewarmed environments; values requiring per-environment uniqueness cannot simply be frozen into a shared snapshot.
A_ZH:
答：发布适用版本时保存初始化状态快照，新环境可从快照恢复。
考点：复用初始化状态，避免新环境重复昂贵初始化；Java受管运行时的SnapStart无额外功能费用，适合先比较它，而不是持续付费维持provisioned concurrency。
易错提醒：先核对功能兼容；快照不等于始终预热的环境，需要每环境唯一的值不能直接固化在共享快照里。
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html

## aws-rb2-20261107-pack-gsc-137 | d2
TOPIC: ECS tasks and hosting capacity / ECS任务与承载容量
Q:
ECS needs more tasks with business load, but EC2 hosts cannot fit them. What do service and underlying-capacity scaling each manage?
Q_ZH:
ECS要随业务负载自动增加任务副本；如果用EC2承载，新任务却放不下。服务伸缩和底层容量伸缩各管什么？
A:
Answer: Service Auto Scaling changes service task count using CloudWatch metrics. On EC2, applicable capacity providers or instance scaling must supply underlying resources too.
Key point: Task count is desired application copies; instance capacity supplies CPU/memory to fit them. More task demand does not create hosts automatically.
Watch out: Fargate and self-managed EC2 differ; do not apply the same ASG steps to every deployment.
A_ZH:
答：Service Auto Scaling按CloudWatch指标增减服务任务数；EC2承载时，还要用适用容量提供者或实例伸缩补足底层资源。
考点：任务数是要运行多少份应用，实例容量是有没有CPU和内存放下它们；增加任务需求不会自动创造主机容量。
易错提醒：Fargate与自管EC2的底层管理不同，不把同一ASG步骤套到所有ECS部署。
SOURCE: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/cluster-auto-scaling.html

## aws-rb2-20261107-pack-gsc-138 | d2
TOPIC: Pod and node scaling / Pod与节点扩容
Q:
HPA added EKS Pods but insufficient node resources leave them Pending. Is increasing replicas alone enough?
Q_ZH:
EKS已由HPA增加Pod副本，但Pod因节点资源不足一直Pending。继续只提高Pod副本数有用吗？
A:
Answer: No. Add schedulable nodes through applicable node autoscaling such as Karpenter or Cluster Autoscaler.
Key point: HPA changes workload copies; node scaling supplies their hosting resources. Both layers must cooperate.
Watch out: Pending has other causes too; confirm capacity shortage that more nodes can solve.
A_ZH:
答：不够；还要用适用的节点自动伸缩能力增加可调度节点，如Karpenter或Cluster Autoscaler。
考点：HPA调整工作负载副本，节点伸缩补充承载资源，两个层次须配合。
易错提醒：Pending也可能由其他调度条件造成，先确认确实是可解决的节点容量不足。
SOURCE: https://docs.aws.amazon.com/eks/latest/best-practices/autoscaling.html

## aws-rb2-20261107-pack-gsc-139 | d2
TOPIC: Orchestrator compatibility and cost / 编排兼容与费用
Q:
How should EKS/ECS differ when Kubernetes deployment objects/APIs must stay versus no such requirement and lower host/orchestration administration cost is desired?
Q_ZH:
必须保留Kubernetes部署对象与API，或没有这项要求、只想少维护主机并降低编排成本，EKS和ECS怎样选？
A:
Answer: Evaluate EKS for Kubernetes compatibility; otherwise evaluate ECS with Fargate.
Key point: Similar images do not imply identical orchestration APIs. EKS offers Kubernetes control planes with cluster charges; ECS orchestration has no additional fee. Fargate reduces host maintenance for either.
Watch out: Underlying compute still costs money; managed EKS does not remove all application maintenance.
A_ZH:
答：保留Kubernetes方式优先评估EKS；没有该要求时可评估ECS配Fargate。
考点：镜像相似不代表编排接口相同。EKS提供Kubernetes控制面并有集群费用；ECS编排无额外费用，Fargate在两者中都可减少主机维护。
易错提醒：仍要支付底层计算等资源费用；EKS托管控制面也不等于应用全部免维护。
SOURCE: https://aws.amazon.com/ecs/pricing/

## aws-rb2-20261107-pack-gsc-140 | d2
TOPIC: On-premises ECS execution / 本地ECS运行
Q:
Containers must remain on premises while ECS manages them. Does cloud management automatically move computation to Fargate?
Q_ZH:
容器必须继续在机房运行，但希望由ECS管理。把管理接到AWS，会自动把计算也迁到Fargate吗？
A:
Answer: No. Evaluate ECS Anywhere for eligible external instances while workloads execute on local hosts.
Key point: Management control-plane location and actual container execution location can differ. Cloud management does not imply moving local compute.
Watch out: External-instance, connectivity, and feature requirements apply; cloud Fargate is not on-premises hosting.
A_ZH:
答：不会；可评估ECS Anywhere把适用外部实例纳入管理，工作负载仍在本地主机执行。
考点：管理控制面所在位置与实际运行容器的位置可以分开，连接云端管理不等于搬走本地计算。
易错提醒：外部实例、联网和功能支持仍须满足，不能把云端Fargate承载能力当作机房本地运行。
SOURCE: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-anywhere.html

## aws-rb2-20261107-pack-gsc-141 | d2
TOPIC: Collecting memory metrics / 采集内存指标
Q:
EC2 must scale by memory pressure but default CloudWatch has CPU and other existing metrics. Does faster dashboard refresh produce memory metrics?
Q_ZH:
EC2要按内存压力扩容，但默认CloudWatch监控里只有现成CPU等指标。提高监控展示刷新速度就会出现内存指标吗？
A:
Answer: No. Collect/publish the required custom memory metrics with CloudWatch Agent or another applicable method.
Key point: More frequent display cannot create uncollected data. Metric sources and display intervals are separate.
Watch out: Verify arrival and dimensions before scaling from the metric.
A_ZH:
答：不会；须用CloudWatch Agent或其他适用方式采集并发布所需自定义内存指标。
考点：没有采集的数据，不能靠更频繁展示生成；指标来源和展示间隔是不同问题。
易错提醒：先确认指标实际到达且维度正确，再让伸缩策略使用它。
SOURCE: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Install-CloudWatch-Agent.html

## aws-rb2-20261107-pack-gsc-142 | d2
TOPIC: Request tracing / 请求链路追踪
Q:
One user request spans microservices and is slow, but the slow hop is unknown. Is AWS API auditing enough?
Q_ZH:
一次用户请求经过多个微服务，整体变慢，却不知道时间耗在哪个调用环节。只看AWS API审计够吗？
A:
Answer: No. Use applicable distributed tracing, such as X-Ray/OpenTelemetry integration.
Key point: Traces correlate calls within one request and expose hop durations. API auditing mainly identifies who operated AWS resources.
Watch out: Services must propagate correlation and be instrumented; opening a dashboard does not create complete traces.
A_ZH:
答：不够；使用适用的分布式追踪，如X-Ray/OpenTelemetry相关接入。
考点：追踪把同一请求的不同调用片段关联起来，显示各环节耗时；API审计主要回答谁操作了AWS资源。
易错提醒：服务须实际接入并传递关联信息，不是打开一个仪表板就自动得到完整业务链路。
SOURCE: https://docs.aws.amazon.com/xray/latest/devguide/aws-xray.html

## aws-rb2-20261107-pack-gsc-143 | d2
TOPIC: Container runtime metrics / 容器运行指标
Q:
Does CloudTrail API auditing supply ECS/EKS CPU, memory, and logs?
Q_ZH:
要看ECS或EKS容器的CPU、内存与日志，CloudTrail记录AWS API操作就够吗？
A:
Answer: No. Enable applicable workload metric/log collection such as Container Insights.
Key point: Container runtime behavior differs from who invoked management APIs; performance needs corresponding runtime data.
Watch out: Collection must actually be configured; creating a cluster does not automatically expose every container log.
A_ZH:
答：不够；应启用适用的Container Insights等工作负载指标和日志采集。
考点：容器运行时表现与谁调用AWS管理API是不同信息，应用性能必须来自对应运行数据。
易错提醒：监控要实际配置采集，不能因为集群已创建就假定全部容器日志自动可查。
SOURCE: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ContainerInsights.html

## aws-rb2-20261107-pack-gsc-144 | d2
TOPIC: Composite alarm conditions / 组合告警条件
Q:
Notify on-call only when both high CPU and another health alarm occur. Can two independent email alarms directly express that?
Q_ZH:
只有CPU高并且另一个健康告警也触发时，才通知值班。两个独立alarm各自发邮件能表达这个条件吗？
A:
Answer: No. Use a composite alarm combining existing alarm states.
Key point: AND/OR logic evaluates multiple alarm states and notifies when the combined condition holds.
Watch out: Underlying metric collection and alarms must still be configured correctly.
A_ZH:
答：不能直接表达共同条件；可用composite alarm组合已有alarm状态。
考点：组合告警用AND、OR等逻辑判断多个告警状态，在满足整体条件时才采取相应通知。
易错提醒：组合的是告警状态，底层各指标仍须正确采集并设置。
SOURCE: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Create_Composite_Alarm.html

## aws-rb2-20261107-pack-gsc-145 | d2
TOPIC: Sampling and display resolution / 采样与展示粒度
Q:
EC2 analysis needs one-minute data, but ordinary metrics have five-minute points. Does refreshing every second fix it, and what should change?
Q_ZH:
EC2性能分析要达到1分钟粒度，普通指标每5分钟一个点。每秒刷新仪表板能补齐吗，应改哪里？
A:
Answer: No. Enable detailed monitoring for applicable EC2 standard metrics to obtain one-minute data. For second-level needs, collect supported high-resolution custom metrics.
Key point: Sampling/storage resolution determines whether changes were recorded. Display only rereads points: basic commonly five minutes, detailed one minute, high-resolution custom as fine as one second.
Watch out: Some status checks already have one-minute data. Reuploading low-frequency values does not create real high-frequency observations.
A_ZH:
答：不能靠刷新补齐；对适用EC2标准指标启用详细监控，可得到1分钟粒度。若需秒级，则按支持范围采集高分辨率自定义指标。
考点：采样与存储粒度决定有没有记录变化，展示只是重读已有点；基本监控常见5分钟，详细监控1分钟，高分辨率自定义指标可到1秒。
易错提醒：部分状态检查指标本来就是1分钟；重复上传低频值也不会产生真实高频观测。
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/manage-detailed-monitoring.html

## aws-rb2-20261107-pack-vc-002 | d2
TOPIC: Batch compute-environment limits / Batch计算环境上限
Q:
When can managed Batch scheduling use Fargate, and when EC2? A single job actually needs 64 vCPUs and 512 GiB.
Q_ZH:
批任务要托管排队调度，何时能用AWS Batch配Fargate，何时应改用EC2计算环境？例如单作业实际需要64vCPU和512GiB。
A:
Answer: Use Batch/Fargate within its supported job scope for no host maintenance. The 64-vCPU/512-GiB job exceeds it and needs sufficiently sized Batch EC2 compute.
Key point: Batch queues/schedules while compute environments provide resources. Fargate's current maximum job size is 32 vCPUs/244 GiB; managed scheduling does not remove that ceiling.
Watch out: Source-server size is not actual job usage; verify OS, resource combinations, and execution features.
A_ZH:
答：符合Fargate作业范围时可用Batch+Fargate免维护主机；64vCPU/512GiB超当前单作业范围，应让Batch在足够规格的EC2计算环境调度。
考点：Batch负责排队与调度，计算环境提供实际资源；当前Fargate作业支持的最大档为32vCPU/244GiB，托管调度不会解除执行环境上限。
易错提醒：原服务器的配置不等于作业实际占用；仍要确认操作系统、资源组合和运行特性适用。
SOURCE: https://docs.aws.amazon.com/batch/latest/APIReference/API_ResourceRequirement.html

## aws-rb2-20261107-pack-vc-003 | d2
TOPIC: Aurora shared-storage failover / Aurora共享存储接管
Q:
Do Aurora writer and readers each store a separate complete database? Why can a reader take over?
Q_ZH:
Aurora的writer（写实例）、reader（读实例）各自保存独立的整份数据库吗？reader为什么也能用于故障接管？
A:
Answer: They share regional cluster storage. Readers serve reads and an eligible reader can be promoted after writer failure.
Key point: Storage protects the shared cluster data across AZs. Regional-reader lag is typically under 100 milliseconds, supporting low-latency read scaling.
Watch out: Heavy writes can increase lag; typical latency does not guarantee every read is current.
A_ZH:
答：它们共用区域集群存储；reader平时分担读查询，writer故障时可由适用reader提升接管。
考点：存储层跨AZ保护同一份集群数据；区域reader复制延迟通常低于100毫秒，适合低延迟扩读。
易错提醒：高写入负载仍可能加剧复制延迟；通常值不是所有读取都最新的保证。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Replication.html

## aws-rb2-20261107-pack-vc-004 | d2
TOPIC: Lambda temporary space / Lambda临时空间
Q:
Lambda needs 2 GB local temporary file workspace; memory/duration fit. With default 512 MB insufficient, must it move to EC2?
Q_ZH:
Lambda处理文件时需2GB本地临时工作空间，内存和运行时间均适合。默认512MB不够，必须换EC2吗？
A:
Answer: No. Configure Lambda /tmp storage to 2 GB.
Key point: Each execution environment has configurable temporary disk from 512 to 10,240 MB, independent of matching memory size.
Watch out: It is not shared across environments or a durable disk; save results to persistent storage such as S3.
A_ZH:
答：不必；可把Lambda的/tmp临时存储配置到2GB。
考点：/tmp为每个执行环境提供可配置的临时磁盘，范围512至10240MB；增加工作空间不要求把内存也增加到相同大小。
易错提醒：它不是跨执行环境共享或长期保留的数据盘；结果应写回S3等持久存储。
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/configuration-ephemeral-storage.html

## aws-rb2-20261107-pack-vc-005 | d2
TOPIC: Viewing external clusters / 外部集群集中查看
Q:
Existing EKS and on-premises Kubernetes clusters need centralized cluster/workload views in EKS while retaining local cluster management. What fits?
Q_ZH:
已有EKS和机房Kubernetes集群，要从EKS控制台集中查看集群与工作负载，保留机房集群现有管理方式。用什么？
A:
Answer: Register/connect eligible external Kubernetes through EKS Connector.
Key point: It displays cluster state, configuration, and workloads in EKS without first migrating the cluster into EKS.
Watch out: Connector enables viewing, not EKS takeover of external-cluster management.
A_ZH:
答：用EKS Connector注册并连接符合要求的外部Kubernetes集群。
考点：Connector把集群状态、配置和工作负载呈现在EKS控制台，统一查看不要求先把现有集群迁入EKS。
易错提醒：连接后可查看，不能因此通过EKS接管外部集群的管理。
SOURCE: https://docs.aws.amazon.com/eks/latest/userguide/eks-connector.html

## aws-rb2-20261107-pack-vc-014 | d2
TOPIC: Block-storage I/O patterns / 块存储I/O模式
Q:
How do SSD and HDD EBS choices differ for frequent small random database I/O versus sequential large-file scans?
Q_ZH:
EBS存放频繁随机小块读写的数据库，与连续扫描大文件，这两种负载怎样选择SSD和HDD卷？
A:
Answer: Consider gp3/io-series SSD for random small I/O, IOPS, and latency. Compare st1/sc1 HDD for sequential large-block throughput.
Key point: SSD handles many scattered small operations quickly; HDD emphasizes sequential throughput. Equal capacity does not imply equal random-access performance.
Watch out: gp3 suitability still depends on IOPS, throughput, and instance capacity; not every database needs the most expensive io2.
A_ZH:
答：随机小I/O、看重IOPS和低延迟时考虑gp3或io系列SSD；连续大块吞吐工作负载才比较st1/sc1等HDD。
考点：SSD适合快速完成大量分散的小操作；HDD侧重连续读取/写入的吞吐量。存储容量同样足够，不代表两类卷能提供相同随机访问性能。
易错提醒：gp3是否足够仍取决于所需IOPS、吞吐和实例能力，不能把所有数据库都直接判给最贵io2。
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volume-types.html

## aws-rb2-20261107-pack-cb02 | d2
TOPIC: Compute commitment scope / 计算承诺覆盖范围
Q:
Stable compute spans EC2, Lambda, and Fargate with changing EC2 types, plus SageMaker usage. How can few plan types cover it?
Q_ZH:
稳定计算同时使用EC2、Lambda、Fargate，EC2型号还可能变化；另有SageMaker用量。怎样用尽量少的计划类型覆盖？
A:
Answer: Use Compute Savings Plans for EC2/Lambda/Fargate and separate SageMaker Savings Plans for SageMaker.
Key point: Compute plans discount eligible committed compute flexibly without one EC2 family, but service coverage remains limited; SageMaker is not included automatically.
Watch out: Compute plans also exclude RDS instance charges. Verify stable usage before committing.
A_ZH:
答：EC2、Lambda、Fargate用Compute Savings Plans；SageMaker用其自己的Savings Plans。
考点：Compute SP按适用计算用量承诺提供灵活折扣，不绑单一EC2实例族；服务范围仍有限，SageMaker不自动算入Compute SP。
易错提醒：Compute SP也不覆盖RDS实例费用；承诺前核对真实稳定用量。
SOURCE: https://docs.aws.amazon.com/savingsplans/latest/userguide/plan-types.html

## aws-rb2-20261107-pack-cmp-m01 | d2
TOPIC: Infrequent multi-AZ retrieval / 低频多AZ取回
Q:
Infrequent S3 files need multi-AZ storage. How does immediate access versus waiting for restore change storage-class choice?
Q_ZH:
低频S3文件仍需多AZ保存。必须立即读取，与允许先恢复后读取，两种条件怎样改变存储层选择？
A:
Answer: Immediate access can use applicable instant tiers such as Standard-IA or Glacier Instant Retrieval. With restore delay acceptable, consider Glacier Flexible Retrieval/Deep Archive and lifecycle transitions.
Key point: Satisfy retrieval delay and multi-AZ needs before total cost. Deep Archive exchanges longer waits for the lowest archive storage rate, fitting rare multi-year access; Glacier Instant Retrieval retains immediate access for rare long-retained data.
Watch out: One Zone-IA is single-AZ. Retrieval charges, minimum duration, and object overhead mean lowest unit rate is not necessarily the lowest bill.
A_ZH:
答：立即读取可选Standard-IA或Glacier Instant Retrieval等适用即时层；能等待恢复时，才考虑Glacier Flexible Retrieval或Deep Archive，并按阶段用Lifecycle转换。
考点：先满足取回等待与多AZ要求，再比总费用。Deep Archive以更长等待换最低的归档存储单价，适合多年极少读取；Glacier Instant Retrieval仍可即时读，适合长保留且极少读取。
易错提醒：One Zone-IA只有单AZ；低单价仍要计取回费、最低保留期和对象开销，不能直接等同最低总账单。
SOURCE: https://aws.amazon.com/s3/pricing/

## aws-rb2-20261107-pack-xa019 | d2
TOPIC: Budget alerts and restrictions / 预算通知与限制
Q:
After a budget threshold, notify the owner and automatically prohibit new resources. Is an alert alone enough, and why?
Q_ZH:
账户达到预算阈值后，既要通知负责人，又要自动禁止继续创建资源。只设预算告警够吗，为什么？
A:
Answer: No. Configure an AWS Budgets action with an authorized service role applying a denying IAM policy or SCP, plus notifications.
Key point: Alerts inform; budget actions enforce permission restrictions. The service role authorizes Budgets to attach policies.
Watch out: Cost/action updates lag and existing resources may keep charging; this is not an absolute spending cap.
A_ZH:
答：不够；配置AWS Budgets action，由有权限的服务角色应用拒绝新建资源的IAM策略或SCP，并设置通知。
考点：告警负责告知，budget action才执行权限限制；服务角色使Budgets有权代为附加策略。
易错提醒：费用数据和动作有更新延迟，已有资源也可能继续计费，不能当作绝对费用硬上限。
SOURCE: https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html

## aws-rb2-20261107-pack-xa022 | d2
TOPIC: Sharing commitment discounts / 共享承诺折扣
Q:
Previously separately billed accounts need unused purchased Savings Plans discounts shared. How should accounts and sharing be organized, and why?
Q_ZH:
多个原先独立计费的账户要共用已购买但用不完的Savings Plans折扣，怎样组织并开启共享，为什么？
A:
Answer: Join the same Organizations consolidated-billing organization and enable applicable account discount sharing in the management account's Billing preferences.
Key point: Sharing applies commitment discounts to eligible usage; RAM does not transfer a compute resource or plan to another account.
A_ZH:
答：把相关账户纳入同一Organizations合并计费组织，由管理账户在Billing preferences启用相应账户的折扣共享。
考点：共享的是承诺折扣在符合条件用量上的抵扣，不是通过RAM把一台计算资源或一份计划迁给别的账户。
SOURCE: https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/ri-turn-off.html

## aws-rb2-20261107-pack-xa055 | d2
TOPIC: CloudFront transfer charges / CloudFront传出计费
Q:
Why can CloudFront lower S3 large-file egress costs to North American/European users? Does that make downloads entirely free?
Q_ZH:
S3大文件要交给北美和欧洲用户。改由CloudFront分发，为什么可能降低传出费？这等于用户下载全部免费吗？
A:
Answer: AWS S3-to-CloudFront origin transfer has no data-transfer-out charge; viewer downloads follow the selected CloudFront plan. Verified common paid North America/Europe tiers can have lower edge rates than direct us-east-1 S3 egress, but distribution is not free.
Key point: Origin-to-edge and edge-to-viewer are separate charging segments. Compare actual tiers/destination rates; nearby caching also retains CA13's performance benefit.
Watch out: Compare usage-based or flat-rate plans with actual traffic and requests. Free origin transfer is not free overall delivery.
A_ZH:
答：S3到CloudFront的AWS回源免数据传出费；用户下载改按所选CloudFront方案核算。已核的北美、欧洲常见付费档，边缘传出单价可低于us-east-1的S3直出，不能把整个分发当免费。
考点：回源与边缘到用户是两段收费范围；比较的是实际流量档和边缘目的地费率。CloudFront还可从附近缓存交付，延续CA13已教的性能收益。
易错提醒：CloudFront有按用量和flat-rate等方案；应按实际方案、流量及请求核算，免回源不代表免全部费用。
SOURCE: https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/

## aws-rb2-20261107-pack-xb027 | d2
TOPIC: Aurora idle pausing / Aurora空闲暂停
Q:
A development PostgreSQL DB is idle for long periods and can tolerate a short resume wait. On an Aurora Serverless version supporting pause, how can idle compute cost fall?
Q_ZH:
开发PostgreSQL数据库长时间没人连接，可接受恢复时短暂等待。使用支持自动暂停的Aurora Serverless版本时，怎样减少空闲算力费用？
A:
Answer: Enable automatic pause, set a supported minimum of zero ACUs, and configure the idle wait.
Key point: After no user connections for a period, the instance pauses; the next connection triggers resume. Serverless naming alone does not mean zero capacity by default or instant responses.
A_ZH:
答：启用自动暂停，把支持的最小容量设为0 ACU，并设定空闲等待时间。
考点：没有用户连接一段时间后实例可暂停，下一次连接触发恢复；只是选了Serverless名称，并不等于默认就会降到零或立刻响应。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html

## aws-rb2-20261107-pack-aws-rb2-domain1-normal-batch07-20261105-s3-bucket-key-request-cost | d2
TOPIC: S3 Bucket Key request charges / S3 Bucket Key请求费
Q:
S3 objects use SSE-KMS with continuing new writes and frequent reads. KMS encryption must stay. How can KMS request costs fall, and why?
Q_ZH:
S3对象使用SSE-KMS，新增对象持续写入且读取频繁。必须继续使用KMS加密，怎样减少KMS请求费用，为什么？
A:
Answer: Enable S3 Bucket Key for new objects.
Key point: S3 temporarily retains a KMS-derived bucket-level key to generate object data keys, reducing per-object KMS requests.
Watch out: This reduces rather than eliminates KMS calls. Existing objects do not automatically adopt Bucket Keys when the bucket setting changes.
A_ZH:
答：为新增对象启用S3 Bucket Key（桶密钥）。
考点：S3临时保留从KMS取得的桶级密钥，用它生成对象数据密钥，减少逐对象访问KMS的请求。
易错提醒：这会减少而非消除KMS调用；已有对象不会因开启桶设置就自动使用Bucket Key。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-key.html

## aws-rb2-20261107-pack-gcl-005 | d2
TOPIC: Aurora headless DR secondaries / Aurora无实例灾备副本
Q:
An Aurora global database DR Region serves no queries. How does a supported headless secondary retain replication while reducing resident compute cost?
Q_ZH:
Aurora global database灾备Region暂不提供查询，希望保留复制数据却少付常驻数据库计算费。支持的headless secondary怎样取舍？
A:
Answer: Retain supported secondary storage without DB instances, adding compute when recovery needs it.
Key point: Replicated storage and database compute can be separate. No resident secondary instances means lower compute cost but later compute startup.
Watch out: Engine/version support applies. Storage still costs money and no immediately usable query/failover instance is provided.
A_ZH:
答：可以保留支持的无DB实例secondary存储，灾后需要时再补相应计算。
考点：Aurora复制存储与运行数据库计算可以分开，平时不运行secondary实例可减少计算费，但恢复时需要启动计算。
易错提醒：须为相应引擎和版本支持的部署；存储仍收费，也不等于具备立即可用的查询或接管实例。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database-attach.html

## aws-rb2-20261107-pack-gcl-018 | d2
TOPIC: EFS cold-file tiering / EFS冷文件分层
Q:
Shared POSIX files are rarely read but must retain the same file paths. How can EFS cost fall without changing applications to object access?
Q_ZH:
共享POSIX文件长期少读，但应用仍要沿用同一文件路径。怎样减少EFS存储费用，而不是改成取对象的应用？
A:
Answer: Evaluate EFS lifecycle management to move eligible cold files into lower-cost access tiers.
Key point: Tiering occurs inside the filesystem, preserving file interfaces while trading storage charges against cold-file access charges.
Watch out: Per-GiB pricing alone is insufficient; access volume and tier eligibility affect total cost.
A_ZH:
答：评估EFS生命周期管理，把符合条件的冷文件转入较低成本的EFS访问层。
考点：分层在文件系统内发生，应用继续通过文件接口访问，存储费用与冷文件访问费用之间产生取舍。
易错提醒：不是只看每GiB单价；访问量和所选层适用条件也影响总费用。
SOURCE: https://aws.amazon.com/efs/pricing/

## aws-rb2-20261107-pack-gcl-023 | d2
TOPIC: DynamoDB table-class costs / DynamoDB表类费用
Q:
How do Standard and Standard-IA compare for frequent DynamoDB requests versus large rarely accessed datasets dominated by storage cost?
Q_ZH:
DynamoDB读写频繁，与大量数据很少读写、主要付存储费，这两种负载的Standard和Standard-IA表类怎样取舍？
A:
Answer: Usually compare Standard for frequent requests and Standard-IA total cost for storage-heavy rare access.
Key point: Standard-IA lowers eligible storage rates with different request pricing. Calculate storage and request volume together.
Watch out: Table class is independent of on-demand/provisioned mode. Reserved provisioned-capacity discounts apply only to single-Region Standard, not Standard-IA.
A_ZH:
答：频繁请求通常比较Standard；存储费用占主导且访问稀少时比较Standard-IA总费用。
考点：Standard-IA降低适用存储单价，同时有不同请求计价，须按存储量与请求量共同计算。
易错提醒：表类与on-demand/provisioned容量模式是独立选择；预留预置容量折扣只适用于单Region的Standard，Standard-IA不适用。
SOURCE: https://aws.amazon.com/dynamodb/pricing/

## aws-rb2-20261107-pack-gcl-025 | d2
TOPIC: Burst credits and charges / 突发积分与费用
Q:
EC2 has low baseline CPU with occasional strong bursts. How do burstable T-instance credits and Unlimited affect selection?
Q_ZH:
EC2平时CPU基线很低，偶尔显著突发。T类burstable实例的credit和unlimited怎样影响选择？
A:
Answer: Assess burst frequency/duration. Credits permit above-baseline bursts; Unlimited can continue under applicable conditions but may add charges.
Key point: Low average workloads use accumulated credits. Sustained high CPU changes performance and cost, so base instance price alone is insufficient.
Watch out: For long high-CPU periods compare sustained-compute types. Unlimited is not free unlimited CPU.
A_ZH:
答：评估突发频率和时长：credit允许在基线以上突发，unlimited可在相应条件下继续突发，但可能收取额外费用。
考点：低平均负载可利用积累积分，长期高CPU会改变性能和费用结果，不应只看实例基础单价。
易错提醒：若CPU长期高，应比较持续计算规格；unlimited不等于免费无限CPU。
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances.html

## aws-rb2-20261107-pack-gsc-009 | d2
TOPIC: ONTAP hot/cold tiering / ONTAP冷热分层
Q:
Few ONTAP files are active and most are cold. How can expensive SSD capacity fall while preserving hot-data latency?
Q_ZH:
ONTAP文件中只有少量经常访问，其余长期很冷。怎样减少昂贵SSD容量，又保留热点低延迟？
A:
Answer: Use ONTAP data tiering to move cold data into its lower-cost capacity tier.
Key point: Performance-tier SSD serves active data while capacity storage holds infrequent data, avoiding SSD purchases for all history.
Watch out: Cold retrieval has different performance/access charges; not every cold read retains SSD-hot latency.
A_ZH:
答：使用ONTAP数据分层，把冷数据转入较低成本的容量层。
考点：性能层的SSD承担活跃数据访问，容量层接纳低频数据，减少为了全部历史数据购买SSD。
易错提醒：从容量层取回冷数据有不同的性能和访问费用，不能要求所有冷数据始终具有SSD热读体验。
SOURCE: https://docs.aws.amazon.com/fsx/latest/ONTAPGuide/what-is-fsx-ontap.html

## aws-rb2-20261107-pack-gsc-018 | d2
TOPIC: EBS archive billing size / EBS归档计费大小
Q:
Old unread EBS snapshots have a lower archive per-GiB price. Is archive necessarily cheaper?
Q_ZH:
EBS旧快照长期不读，归档每GiB便宜，就一定比标准层省钱吗？
A:
Answer: No. Compare full archived-snapshot size with retention and restoration charges.
Key point: Standard snapshots share incremental blocks. Archiving produces a full snapshot of all written blocks at that recovery point, potentially increasing billed size.
Watch out: Archive must be restored before creating volumes; storage unit rates alone are insufficient.
A_ZH:
答：不一定，要按归档后的完整快照大小及保留、恢复费用比较。
考点：标准层快照利用增量块共享；归档时会转成包含该恢复点全部已写数据块的完整快照，计费数据量可能变大。
易错提醒：归档快照须先恢复才能用于创建卷，不能只比较存储单价。
SOURCE: https://docs.aws.amazon.com/ebs/latest/userguide/how_snapshots_work.html

## aws-rb2-20261107-pack-gsc-024 | d2
TOPIC: Costs of many small objects / 海量小对象费用
Q:
Can archive per-GiB rates alone identify the cheapest S3 class for many rarely read tiny files?
Q_ZH:
有海量小文件，很少读取。只看归档层每GiB单价，就能选出最便宜的S3存储层吗？
A:
Answer: No. Include minimum billable object size, transition requests, and applicable metadata overhead.
Key point: For tiny files, per-object charges and minimum billing units can outweigh actual bytes. A lower GiB rate need not lower the total bill.
Watch out: Minimum retention and retrieval requirements still apply; unsuitable access tiers are not valid comparisons.
A_ZH:
答：不能；还要计算最小计费对象大小、每次转换请求和适用的元数据开销。
考点：单文件很小时，按对象收取的费用和最低计费单位可能超过实际数据存储费用；较低的GiB单价不一定降低总账单。
易错提醒：还须满足最短保留时间及取回要求，不能把不满足访问条件的层拿来比价。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-transition-general-considerations.html

## aws-rb2-20261107-pack-gsc-025 | d2
TOPIC: Automatic S3 instant tiering / S3自动即时分层
Q:
S3 access patterns are unpredictable and reads must remain immediate. How can per-object manual tier decisions be reduced?
Q_ZH:
S3对象冷热难预测，用户仍需立即读取。怎样减少手工判断每个对象应放哪一层？
A:
Answer: Use S3 Intelligent-Tiering to adjust applicable instant-access tiers from observed access.
Key point: It tracks patterns and moves inactive objects to cheaper tiers. These instant tiers retain data across at least three AZs without switching to single-AZ storage.
Watch out: Per-object monitoring costs apply. Known patterns can use Lifecycle directly; optional asynchronous archive tiers require restores, and automatic tiering is not always cheaper.
A_ZH:
答：使用S3 Intelligent-Tiering，让它按访问情况调整适用的即时访问层。
考点：它跟踪访问模式，把不活跃对象转到更低成本的访问层；这些即时访问层跨至少三个AZ保存数据，不必为省钱退回单AZ。
易错提醒：它有按对象的监控费用；冷热分界已知时可直接用Lifecycle，不能无条件断言自动分层更便宜。可选异步归档层还需要恢复等待。
SOURCE: https://aws.amazon.com/s3/pricing/

## aws-rb2-20261107-pack-gsc-026 | d2
TOPIC: Noncurrent version cleanup / 非当前版本清理
Q:
A versioned S3 bucket expires current objects but its bill keeps growing. Which lifecycle rules need checking?
Q_ZH:
S3桶启用了版本控制，已设置当前对象过期，账单却仍不断增长。还应检查什么生命周期规则？
A:
Answer: Configure/check expiration or transitions for noncurrent versions.
Key point: New uploads make old versions noncurrent. Current-version rules do not automatically remove that stored history.
Watch out: Keeping the newest two means current plus one noncurrent. Noncurrent counts exclude current, and age/other conditions must also hold before asynchronous expiry.
A_ZH:
答：检查并设置非当前版本的过期或转层规则。
考点：新上传会让旧版本变成非当前版本；只处理当前版本，不会自动清理这些仍占空间的历史版本。
易错提醒：只保留最新两版时，是当前版加一个非当前版；非当前保留计数不含当前版，还要同时满足年龄等条件后才异步过期。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html

## aws-rb2-20261107-pack-gsc-027 | d2
TOPIC: Incomplete multipart cleanup / 未完成分块清理
Q:
Visible S3 object count is unchanged, but failed multipart uploads increase storage charges. What should be cleaned and how prevented?
Q_ZH:
S3可见对象数量没增加，但大量分块上传失败后存储费增长。应清理什么，怎样避免反复发生？
A:
Answer: Clean unfinished-upload parts and configure AbortIncompleteMultipartUpload lifecycle rules.
Key point: Uploaded unassembled parts consume storage and are not handled just by object listings or current-object expiration.
Watch out: Aborting incomplete uploads does not delete completed objects.
A_ZH:
答：清理未完成multipart upload的分块，并配置AbortIncompleteMultipartUpload生命周期规则。
考点：已上传但尚未合成对象的part仍占空间，不能只靠对象列表或当前对象过期规则处理。
易错提醒：中止未完成上传，不等于删除已经完成的对象。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html

## aws-rb2-20261107-pack-gsc-028 | d2
TOPIC: Requester Pays / 请求者付费
Q:
External partners read S3 data and should pay read requests/download transfer. How can charge responsibility change?
Q_ZH:
公司向外部合作方开放S3数据读取，希望由对方承担读取请求和下载传输费用。怎样改变费用承担方？
A:
Answer: Enable Requester Pays on eligible buckets and have requesters acknowledge payment as required.
Key point: Applicable request/transfer charges shift to requesters; bucket owners retain storage charges.
Watch out: This changes the payer, not necessarily total cost, and does not grant read access.
A_ZH:
答：对适用桶启用Requester Pays，并让请求者按要求确认付费。
考点：它把适用的请求和数据传输费用交给请求者，桶所有者仍承担存储费用。
易错提醒：这改变谁付款，不会自动降低总费用，也不是授予读取权限。
SOURCE: https://docs.aws.amazon.com/AmazonS3/latest/userguide/RequesterPaysBuckets.html

## aws-rb2-20261107-pack-gsc-038 | d2
TOPIC: DynamoDB capacity modes / DynamoDB容量模式
Q:
How do DynamoDB capacity modes differ for unpredictable traffic without capacity estimates versus long-term stable plannable usage?
Q_ZH:
DynamoDB流量难预测，不想预先估计读写容量；与长期稳定且能规划容量的业务，容量模式怎样选？
A:
Answer: Consider on-demand for unpredictable load; compare provisioned with autoscaling for stable plannable workloads.
Key point: On-demand avoids preset RCU/WCU quantities. Provisioned sets read/write capacity explicitly and can autoscale, with potential cost benefits under stable utilization.
Watch out: On-demand is not unlimited instantaneous peaks; check quotas and scaling characteristics.
A_ZH:
答：难预测的负载考虑on-demand；稳定且可规划时比较provisioned配合自动伸缩。
考点：按需模式无需预配具体RCU／WCU；预置模式显式配置读写容量并可自动伸缩，稳定利用时可比较其费用优势。
易错提醒：按需不代表任意瞬时峰值都无限承接；仍须核对配额和扩展特性。
SOURCE: https://aws.amazon.com/dynamodb/pricing/

## aws-rb2-20261107-pack-gsc-043 | d2
TOPIC: Separating analytics and live reads / 分析与在线读取隔离
Q:
DynamoDB history needs analysis without large Scans consuming production read capacity. How can workloads separate?
Q_ZH:
要分析DynamoDB历史数据，又不能用大量Scan挤占线上表读取能力。可怎样把分析与在线读取分开？
A:
Answer: Export table data to S3 under supported conditions and analyze the export.
Key point: Supported export avoids scanning table read capacity. Analytics operates on another data copy.
Watch out: Point-in-time, format, and PITR conditions apply; exports do not continuously match live data in real time.
A_ZH:
答：在支持条件下把表数据导出S3，再对导出数据分析。
考点：受支持的数据导出不靠扫描消耗表的读取容量，分析在另一个数据副本上进行。
易错提醒：导出有时间点、格式及PITR等适用条件，不代表分析副本持续实时等于在线表。
SOURCE: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/S3DataExport.HowItWorks.html

## aws-rb2-20261107-pack-gsc-052 | d2
TOPIC: Long-idle RDS / RDS长期闲置
Q:
A development RDS database will be idle for weeks. Can stopping keep it stopped indefinitely without compute charges?
Q_ZH:
开发RDS库要闲置好几周。停止实例后就能一直保持停止、不再产生计算费吗？
A:
Answer: No. Eligible stopped instances automatically restart after a limited period. For long inactivity, evaluate snapshot retention followed by deletion and on-demand restore.
Key point: Stopping suits short gaps. Removing compute avoids automatic restart, but recovery takes time and backup storage still costs money.
Watch out: Verify engine/topology stop/restore support and acceptable postrestore connection changes.
A_ZH:
答：不能；适用RDS实例停止一段受限时间后会自动启动，长期不用可评估保留快照后删除，再按需恢复。
考点：临时停止适合短期空闲；长期删除计算资源可避免自动重启，但恢复要时间且存储备份仍收费。
易错提醒：须先确认引擎、拓扑支持停止及快照恢复，并能接受恢复后的连接调整。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateSnapshot.html

## aws-rb2-20261107-pack-gsc-054 | d2
TOPIC: RDS commitment discounts / RDS承诺折扣
Q:
A stable RDS database compares only Reserved DB Instances with Compute Savings Plans. Which discounts its instance charges?
Q_ZH:
一个RDS数据库长期稳定运行。若只比较RDS Reserved DB Instances和Compute Savings Plans，哪种承诺可抵扣它的数据库实例费用？
A:
Answer: RDS Reserved DB Instances matching purchase attributes.
Key point: RDS reservations cover eligible database instances; Compute Savings Plans exclude RDS instance charges.
Watch out: Check engine, Region, deployment, and other match conditions. Reservation discounts do not make storage/I/O free.
A_ZH:
答：符合购买属性的RDS Reserved DB Instances。
考点：RDS预留折扣面向适用数据库实例；Compute Savings Plans的计算服务范围不包含RDS实例费用。
易错提醒：购买承诺前核对引擎、Region和部署等匹配条件；预留折扣不等于存储和I/O免费。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithReservedDBInstances.html

## aws-rb2-20261107-pack-gsc-058 | d2
TOPIC: Aurora copy-on-write clones / Aurora写时复制克隆
Q:
Development/testing needs a large Aurora database copy quickly without initially copying all storage. What fits?
Q_ZH:
开发测试要快速得到一份大型Aurora数据库数据，不想一开始就复制全部底层存储。怎样做？
A:
Answer: A supported Aurora clone.
Key point: Copy-on-write initially shares underlying pages and allocates storage for subsequent changes.
Watch out: The clone is independently usable, not a read replica automatically following new production writes.
A_ZH:
答：使用受支持的Aurora克隆。
考点：克隆采用copy-on-write，起初共享底层数据页，后续发生变化才为相应数据分配存储。
易错提醒：克隆是用于独立使用的数据库，不是自动跟随生产最新写入的读副本。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Managing.Clone.html

## aws-rb2-20261107-pack-gsc-059 | d2
TOPIC: Aurora I/O pricing tradeoffs / Aurora I/O计费取舍
Q:
Aurora storage I/O dominates a sustained bill. Compare only instance prices, or which deployment pricing?
Q_ZH:
Aurora账单中存储I/O费用占比很高，而且负载会持续。应只看实例单价，还是比较什么部署计费方式？
A:
Answer: Compare Aurora I/O-Optimized, especially the officially recommended range where I/O requests exceed 25% of total Aurora cost.
Key point: It removes separate eligible storage read/write I/O request charges in exchange for higher other rates. A comparable workload with 40% I/O fits that criterion. Compare cluster configuration, not RDS gp3/io2 volumes.
Watch out: High traffic alone does not prove savings; total compute, storage, and I/O costs matter.
A_ZH:
答：优先比较Aurora I/O-Optimized；I/O请求费占比超过总Aurora费用25%时，是官方建议重点采用的范围。
考点：I/O-Optimized不另收适用存储读写I/O请求费，用较高的其他单价换更低总费；例如同等负载下I/O占40%就符合这一判断。Aurora按集群配置比较，不是选择RDS的gp3或io2卷。
易错提醒：仅流量大不证明总费更低；仍要按计算、存储和I/O合计比较。
SOURCE: https://aws.amazon.com/rds/aurora/pricing/

## aws-rb2-20261107-pack-gsc-063 | d2
TOPIC: Elastic DMS replication capacity / DMS弹性复制容量
Q:
DMS load varies and continual manual replication-instance sizing is undesirable. Which supported capacity option merits comparison?
Q_ZH:
DMS复制负载变化明显，不想一直人工给复制实例选固定规格。有什么受支持的容量方式可比较？
A:
Answer: DMS Serverless, managing replication scaling within supported scope and capacity bounds.
Key point: The service adjusts resources to replication workload, reducing ongoing fixed-instance sizing.
Watch out: Check source, target, and task-feature support; serverless is neither unlimited nor free.
A_ZH:
答：评估DMS Serverless，在适用范围和容量上下限内管理复制资源伸缩。
考点：让服务按复制工作量调整所需容量，减少固定复制实例的持续规格管理。
易错提醒：先确认源、目标及任务功能受支持；Serverless不是无限容量或不产生费用。
SOURCE: https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Serverless.html

## aws-rb2-20261107-pack-gsc-074 | d2
TOPIC: Lower-bandwidth dedicated access / 低带宽专线类型
Q:
On premises needs modest Direct Connect bandwidth below dedicated physical-connection starting sizes. Which connection types should be compared?
Q_ZH:
机房只需较小带宽的专线，不想按独享物理连接的起始规格购买。可以比较哪种连接方式？
A:
Answer: Partner-provided hosted connections versus dedicated connections.
Key point: For example, 200 Mbps is a supported hosted capacity. Dedicated supplies an exclusive physical connection, not an arbitrarily selectable 200-Mbps console slice.
Watch out: Check capacity/features by connection type; hosted does not mean manually subdividing any dedicated port.
A_ZH:
答：比较Direct Connect合作伙伴提供的hosted connection与dedicated connection。
考点：例如200 Mbps属于合作伙伴hosted支持的容量；dedicated给客户独享物理连接，不能在控制台把其端口任意切成200 Mbps。
易错提醒：支持的容量和功能按连接类型核对，不能把hosted理解为自行把任意dedicated端口切小。
SOURCE: https://docs.aws.amazon.com/directconnect/latest/UserGuide/WorkingWithConnections.html

## aws-rb2-20261107-pack-gsc-078 | d2
TOPIC: Compute near data / 计算靠近数据
Q:
Large source data produces small results and cross-AZ/Region transfer costs apply. Subject to availability needs, how can transfer fall?
Q_ZH:
应用与数据跨AZ或Region传输需要付费，原始数据很大、处理结果很小。在满足可用性要求前提下，怎样减少传输？
A:
Answer: Prefer computation near the large dataset, sending only small results where needed.
Key point: Cost is volume times path rate. Co-location reduces bytes moved. Where Direct Connect already exists and applicable same-Region egress pricing applies, its typically lower outbound rate can reduce that portion too.
Watch out: Compare actual Regions/access points/tiers. New port costs are not ignorable, and savings must not undermine failure isolation.
A_ZH:
答：优先让计算靠近大数据所在位置，只把较小结果传往需要的地方。
考点：费用取决于传输量乘路径单价。先让计算靠近大数据、只传小结果；在已有Direct Connect且适用同Region出站计费时，还可利用专线通常较低的出站单价降低这部分费用。
易错提醒：按实际Region/接入点和计费档比较；已有专线不代表新增专线的端口费可忽略，也不能为省传输破坏故障隔离。
SOURCE: https://aws.amazon.com/directconnect/faqs/

## aws-rb2-20261107-pack-gsc-099 | d2
TOPIC: EMR Spot node responsibilities / EMR Spot节点职责
Q:
EMR should save with Spot, but control and critical HDFS nodes must avoid interruption. Which nodes should use Spot first?
Q_ZH:
EMR要用Spot降费，但控制节点和承载关键HDFS数据的节点不希望被中断。优先把Spot放在哪类节点？
A:
Answer: Prefer task nodes without HDFS storage whose computations can rerun. Use reliability-appropriate stable capacity for critical primary/core nodes.
Key point: Task nodes supply compute without the same data-retention duty, making interrupted computation easier to recover than lost control/data nodes.
Watch out: Reevaluate different data/recovery architectures; this premise does not dictate one purchase model for every EMR cluster.
A_ZH:
答：优先用于不存HDFS数据、可重新执行任务的task节点；关键primary/core按可靠性要求使用稳定容量。
考点：task节点提供计算而不承担同样的数据保存职责，中断后重做计算通常比丢控制或数据节点更易恢复。
易错提醒：若具体架构的数据和恢复能力不同，应重新评估，不把这个部署前提推广成所有EMR唯一买法。
SOURCE: https://docs.aws.amazon.com/emr/latest/ManagementGuide/emr-master-core-task-nodes.html

## aws-rb2-20261107-pack-gsc-136 | d2
TOPIC: Lambda memory and total cost / Lambda内存与总费
Q:
A Lambda is CPU-bound. Does lowering memory always reduce per-run cost?
Q_ZH:
Lambda是CPU密集型任务。减少内存配置就一定降低单次运行费用吗？
A:
Answer: No. Memory also affects CPU allocation; compare resulting duration and total cost for each configuration.
Key point: Fewer resources can run longer and more resources can finish faster. Cost combines resource allocation and duration.
Watch out: Measure real workloads; increasing memory is not universally cheaper either.
A_ZH:
答：不一定；内存配置也影响分配的CPU资源，应比较配置变化后的运行时长和总费用。
考点：较少资源可能让任务运行更久，较高资源也可能更快完成；费用取决于资源与持续时间的共同结果。
易错提醒：应实测真实负载，不能把“加内存必定更便宜”当通用结论。
SOURCE: https://docs.aws.amazon.com/lambda/latest/dg/configuration-memory.html

## aws-rb2-20261107-pack-gsc-146 | d2
TOPIC: Interruptible Spot work / Spot可中断任务
Q:
Some batch work retries, while service baseline cannot tolerate Spot reclamation. Which should use Spot first?
Q_ZH:
有可重试的批任务，也有不能因Spot回收而中断的服务基线。Spot降费应该优先承载哪一部分？
A:
Answer: Interruption-tolerant recoverable tasks, with reliability-appropriate stable capacity for critical baseline.
Key point: Spot discounts come with reclamation risk. Ability to rerun/resume matters, not simply workload duration.
Watch out: Recoverable tasks still need checkpoints/idempotency/retries. Other purchase options do not eliminate all application failures.
A_ZH:
答：优先承载能容忍中断并恢复的任务，关键基线使用符合可靠性要求的稳定容量。
考点：Spot价格优惠伴随容量被回收的风险，是否能重做或续跑决定适用性，不能只看工作负载运行多久。
易错提醒：可恢复任务仍要做好检查点、幂等或重试；其他购买方式也不等于应用永远不会故障。
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-spot-instances.html

## aws-rb2-20261107-pack-gsc-147 | d2
TOPIC: Price discounts and capacity / 价格折扣与容量
Q:
EC2 capacity in a specified AZ is mandatory short term. Do Compute Savings Plans or Regional RI discounts guarantee it?
Q_ZH:
短期必须在指定AZ有EC2算力。Compute Savings Plans或Regional RI的价格折扣，能保证所需容量吗？
A:
Answer: No. Evaluate applicable On-Demand Capacity Reservations or other capacity reservations.
Key point: Discount commitments manage price; capacity reservations manage corresponding instance availability in an AZ.
Watch out: Some zonal RIs include capacity benefits; do not claim every RI lacks a capacity guarantee.
A_ZH:
答：不能据此保证；应评估适用的On-Demand Capacity Reservation等容量预留。
考点：折扣承诺管理价格，容量预留管理相应AZ可用实例容量，目标不同。
易错提醒：某些zonal RI也含容量权益，须按具体产品判断，不能说所有RI都没有容量保证。
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-capacity-reservations.html

## aws-rb2-20261107-pack-gsc-149 | d2
TOPIC: Physical-host licensing / 物理主机许可证
Q:
Licenses count physical sockets/cores and require host visibility/control. Is Dedicated Instance equivalent to Dedicated Host?
Q_ZH:
软件许可证按物理socket或core计量，还需可见并控制承载物理主机。普通Dedicated Instance就等价于Dedicated Host吗？
A:
Answer: No. Evaluate a Dedicated Host meeting the license conditions.
Key point: Hosts provide dedicated physical servers with placement/host-information control suited to some physical-host BYOL licensing.
Watch out: Dedicated instances do not automatically provide equivalent control; license terms still must permit migration.
A_ZH:
答：不等价；应评估满足授权条件的Dedicated Host。
考点：Host提供专用物理服务器及相关放置、主机信息控制，适合某些按物理主机计量的BYOL要求。
易错提醒：专用实例不自动提供同等主机控制，实际许可证是否允许迁入还要匹配授权条款。
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/dedicated-hosts-overview.html

## aws-rb2-20261107-pack-gsc-150 | d2
TOPIC: No traffic versus released compute / 无流量与释放计算
Q:
Nonproduction is unused overnight. Does deregistering instances from the load balancer stop compute charges?
Q_ZH:
非生产应用夜间无人使用。把实例移出负载均衡目标组，就能停止实例计算收费吗？
A:
Answer: No. Actually stop, terminate, or reduce eligible compute capacity.
Key point: No traffic does not release compute; charges depend on its continuing billable running state.
Watch out: Storage can still charge after stopping; satisfy recovery needs and dependencies.
A_ZH:
答：不能；应按可停条件实际停止、终止或缩减相应计算容量。
考点：没有流量不等于计算资源已释放，费用取决于资源是否仍处于计费运行状态。
易错提醒：停止计算后存储等资源仍可能收费，恢复要求和依赖也须满足。
SOURCE: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html

## aws-rb2-20261107-pack-gsc-151 | d2
TOPIC: Rightsizing recommendations / 规格优化建议
Q:
Supported EC2, ASGs, and ECS Fargate services need concrete sizing recommendations. Are monitoring charts alone enough?
Q_ZH:
想为EC2、EC2 Auto Scaling组、ECS的Fargate服务等受支持资源取得具体规格建议，只看监控图够吗？
A:
Answer: Evaluate applicable AWS Compute Optimizer recommendations.
Key point: Monitoring supplies utilization. Compute Optimizer analyzes supported EC2/ASGs/EBS/Lambda/ECS Fargate resources for sizing/configuration; EBS recommendations can include estimated monthly savings.
Watch out: Enough data and supported resource types are required; not every AWS resource is covered.
A_ZH:
答：评估AWS Compute Optimizer的适用资源建议。
考点：监控提供利用率数据；Compute Optimizer分析EC2、EC2 Auto Scaling组、EBS、Lambda及适用ECS Fargate服务等资源，给出规格/配置建议，EBS建议还可列预计月度节省。
易错提醒：建议必须有足够数据且资源受支持，不能将任意AWS资源都视作已纳入建议范围。
SOURCE: https://docs.aws.amazon.com/compute-optimizer/latest/ug/requirements.html

## aws-rb2-20261107-pack-gsc-152 | d2
TOPIC: Cost anomalies and budgets / 费用异常与预算
Q:
Should abnormal spending patterns and a fixed monthly budget threshold use the same alert rule?
Q_ZH:
费用明显偏离平时模式，与费用达到明确月预算阈值，应该用同一种告警规则吗？
A:
Answer: Evaluate Cost Anomaly Detection for unusual deviation and AWS Budgets for defined thresholds.
Key point: One compares normal spending patterns; the other compares preset money/usage targets.
Watch out: Alerts do not stop resources; automatic restrictions require separately configured supported actions.
A_ZH:
答：异常偏离评估Cost Anomaly Detection；明确预算阈值使用AWS Budgets。
考点：一个比较正常消费模式，一个比较预先设定的金额或用量目标，触发依据不同。
易错提醒：收到告警不等于资源已停止，自动限制操作还需另外配置受支持动作。
SOURCE: https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html

## aws-rb2-20261107-pack-gsc-153 | d2
TOPIC: Cost views and line items / 费用视图与明细
Q:
How do Cost Explorer and CUR differ for interactive historical/forecast analysis versus raw billing-line analysis?
Q_ZH:
要交互分析历史费用或预测，与要逐行分析原始账单明细，Cost Explorer和CUR怎样分工？
A:
Answer: Use Cost Explorer views/applicable APIs for interactive analysis; use CUR or appropriate billing data exports for fine-grained raw analysis.
Key point: Cost Explorer provides ready views/APIs and monthly forecasts up to 12 future months. CUR supplies detailed records for custom querying.
Watch out: Consolidated-billing analysis needs appropriate account permissions/delivery scope; member visibility is not automatically complete organization billing.
A_ZH:
答：交互分析及适用API查询用Cost Explorer；原始细粒度账单分析用CUR或相应账单数据导出。
考点：Cost Explorer提供现成视图和适用API，并可按月预测未来12个月；CUR交付细粒度明细，供自定义查询和分析。
易错提醒：组织合并账单须有相应账户权限与交付范围，成员账户可见数据不自动等于全组织完整账单。
SOURCE: https://docs.aws.amazon.com/cost-management/latest/userguide/ce-api-best-practices.html

## aws-rb2-20261107-pack-gsc-154 | d2
TOPIC: Activating cost-allocation tags / 激活成本分配标签
Q:
Under consolidated billing, resources have department tags but bills cannot be allocated accordingly. Who must do what in cost management?
Q_ZH:
在组织集中计费下，资源已打业务部门标签，却不能据此正常分摊账单。还要由谁在费用管理侧做什么？
A:
Answer: The management account activates the cost allocation tag in Billing, then groups available cost views such as Cost Explorer by that tag.
Key point: Resource tags identify resources; activation adds billing dimensions. Correctly recorded Owner tags can aggregate ownership, but IAM users are not automatically universal billing dimensions.
Watch out: Historical allocation depends on supported backfill and historic tags; adding a tag today does not guarantee old bills are correctly attributed.
A_ZH:
答：由组织管理账户在Billing激活相应cost allocation tag，再在Cost Explorer等费用视图按实际可用的该标签维度分组分析。
考点：资源标签用于标识资源，激活的成本分配标签才进入账单分析维度；如已正确记录Owner用户的资源归属，可按Owner标签汇总，不能把IAM用户身份自动当所有服务的账单维度。
易错提醒：历史费用是否能补齐取决于支持的回填和历史标签条件，不是今天加标签就保证全部旧账单已有正确归属。
SOURCE: https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html

## aws-rb2-20261107-pack-gsc-155 | d2
TOPIC: Utilization and coverage budgets / 利用率与覆盖率预算
Q:
Which budget metrics separately monitor idle Savings Plans commitments and eligible usage lacking discounts, with automatic notification?
Q_ZH:
已购Savings Plans承诺闲置，与用量没被折扣覆盖，需要哪种预算指标来分别监控并自动通知？
A:
Answer: Set utilization budgets for unused commitments and coverage budgets for uncovered usage, with thresholds/notifications in AWS Budgets.
Key point: Utilization measures consumed purchased commitment; coverage measures discounted usage share. Correct denominators trigger alerts below the respective targets.
Watch out: Buying more with low utilization expands idle commitments; low coverage still requires assessing future stable usage.
A_ZH:
答：承诺闲置看utilization budget；适用用量没被覆盖看coverage budget。在AWS Budgets设置相应阈值及通知。
考点：utilization比较用掉多少已购承诺，coverage比较多少用量已被覆盖；选对分母，预算才能在相应比例低于目标时提醒。
易错提醒：利用率低还加买会扩大闲置；覆盖率低也要先评估未来稳定用量，不等于立即购买。
SOURCE: https://docs.aws.amazon.com/savingsplans/latest/userguide/ce-sp-usingPR.html

## aws-rb2-20261107-pack-gsc-156 | d2
TOPIC: Organization optimization permissions / 组织优化建议权限
Q:
Does consolidated billing automatically allow cross-account access to every resource savings recommendation?
Q_ZH:
组织已合并账单，是否就自动能跨账户查看所有资源的节省建议？
A:
Answer: No. Configure organization integration, authorization, and applicable account scope in each optimization service.
Key point: Billing consolidation differs from recommendation permissions. Current Trusted Advisor RDS reservation advice gives payer-wide versus linked-account scope and requires its Cost Optimization Hub prerequisite.
Watch out: One service's access is not universal. Historical single-account limits are not restrictions on every current check.
A_ZH:
答：不自动等于能看全部；按优化服务配置组织接入、授权和适用账户范围。
考点：合并账单与建议服务权限不同。例如现行Trusted Advisor的RDS预留购买建议，payer看到付款范围、linked账户看到本账户范围，并须启用其Cost Optimization Hub前提。
易错提醒：不能把一个服务的授权当全部服务通行证，也不能把旧检查的单账户范围当作所有现行检查的限制。
SOURCE: https://docs.aws.amazon.com/awssupport/latest/user/cost-optimization-checks.html

## aws-rb2-20261107-pack-vc-006 | d2
TOPIC: Archive retrieval tiers / 归档取回档位
Q:
Archived files need retrieval within minutes or a day. Is 'Glacier' enough, and why select a retrieval tier?
Q_ZH:
归档文件必须在几分钟或一天内取回，只写“用Glacier”就够吗？为什么还要选取回档位？
A:
Answer: No. Flexible Retrieval Expedited typically takes 1–5 minutes for objects below 250 MB and Standard 3–5 hours. Deep Archive Standard typically takes 12 hours and Bulk 48 hours.
Key point: Class and retrieval tier jointly determine wait/cost. A six-hour budget can compare Flexible Standard without paying for Expedited solely for speed; a 24-hour budget excludes Deep Archive Bulk.
Watch out: Typical times are not hard guarantees. Large-object throughput matters; strict minute-level needs require evaluating provisioned retrieval capacity and object size.
A_ZH:
答：不够。Flexible Retrieval的Expedited对小于250MB的对象通常1–5分钟，Standard通常3–5小时；Deep Archive的Standard通常12小时，Bulk通常48小时。
考点：类别与取回档位共同决定等待和费用；例如6小时预算可比较Flexible Standard，没必要只为速度付Expedited费；24小时预算不能选Deep Archive Bulk。
易错提醒：通常时长不是硬保证；大对象还受取回吞吐影响，严格分钟级需求要评估预置取回容量及实际对象大小。
SOURCE: https://aws.amazon.com/s3/pricing/

## aws-rb2-20261107-pack-vc-007 | d2
TOPIC: Commitment duration and prepayment / 承诺期限与预付
Q:
Stable usage lasts three years. For eligible EC2/RDS reservations, Dedicated Host reservations, and Compute Savings Plans, are fees owed only while running? How can prepayment deepen discounts?
Q_ZH:
稳定用量可持续三年，比较适用EC2/RDS预留、Dedicated Host预留及Compute Savings Plans。只在开机时付承诺费吗，能预付时怎样争取更深折扣？
A:
Answer: Committed fees remain due throughout the term. Among matching options, longer terms/more prepayment generally deepen discounts; compare three-year all-upfront.
Key point: Discounts exchange future usage/payment flexibility. Dedicated Hosts also have applicable one-/three-year reservations. Stopping or part-time use does not cancel committed fees.
Watch out: Check service, availability, and utilization; not every Savings Plan has identical terms/payment options. Scheduled Instances cannot be newly purchased.
A_ZH:
答：承诺期内约定费用仍需支付；在这些匹配的选项中，较长期限和更多预付通常换取更深折扣，可比较三年全预付。
考点：折扣来自交出未来用量和付款灵活性；Dedicated Host也有适用的一年/三年预留。关机或只在部分小时运行，不会自动取消承诺期费用。
易错提醒：先核服务、供给和未来利用率；不是每种Savings Plan都有同一期限/支付选项。Scheduled Instances也已不能新购。
SOURCE: https://aws.amazon.com/savingsplans/compute-pricing/

## aws-rb2-20261107-pack-vc-010 | d2
TOPIC: Native RDS cluster PITR / RDS集群原生PITR
Q:
RDS PostgreSQL Multi-AZ DB clusters need 30 days of native automatic backups/PITR. Can AWS Backup periodic snapshots directly take over that continuous window?
Q_ZH:
RDS PostgreSQL Multi-AZ DB cluster要保留最近30天原生自动备份/PITR。AWS Backup周期快照计划能直接接管这段连续窗口吗？
A:
Answer: No. Configure native cluster automatic-backup retention to 30 days, within its 1–35-day range.
Key point: AWS Backup currently does not support continuous backup/PITR for this Multi-AZ DB cluster type. Periodic snapshots retain discrete points, not the native continuous window.
A_ZH:
答：不能；为集群原生自动备份设置30天保留期，其合法范围为1–35天。
考点：AWS Backup当前不支持这种Multi-AZ DB cluster的连续备份/PITR。周期快照只保留离散恢复点，不能冒充原生自动备份的连续窗口。
SOURCE: https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_ModifyDBCluster.html

## aws-rb2-20261107-pack-vc-012 | d2
TOPIC: Minimum storage billing periods / 最低存储计费期
Q:
Files stay only 60 days after archival. Does deletion then mean paying just those 60 days?
Q_ZH:
文件转归档后只再保留60天。到期删除后，就只付实际60天存储费吗？
A:
Answer: Not necessarily. If below the class's minimum billable duration, remaining storage-duration charges apply.
Key point: The minimum starts on entry: Standard-IA/One Zone-IA 30 days, Glacier Instant/Flexible Retrieval 90, Deep Archive 180. Lifecycle deletion or another transition does not waive it.
Watch out: This is billing, not a ban on early deletion. Compare rates too; being under the minimum does not alone prove a tier more expensive.
A_ZH:
答：不一定；若低于该层的最低存储计费期，还要支付剩余天数的存储费。
考点：最低计费期从进入该层起算：Standard-IA/One Zone-IA为30天，Glacier Instant/Flexible Retrieval为90天，Deep Archive为180天。Lifecycle删除或再次转层不会免除这笔费用。
易错提醒：最低计费期是费用规则，不是禁止提前删除；还要比较该层单价，不能仅因不足期限就断定它更贵。
SOURCE: https://aws.amazon.com/s3/pricing/

## aws-rb2-20261107-pack-vc-016 | d2
TOPIC: S3 storage-rate ordering / S3存储单价排序
Q:
Data stays years with almost no reads and all candidate tiers meet retrieval waits. What is the approximate descending S3 per-GB-month order, and why?
Q_ZH:
数据要保存多年、几乎不读取，几个存储层都满足取回等待要求。只按每GB月单价比较，S3各存储层的贵贱顺序是什么，依据什么？
A:
Answer: Roughly Standard, Standard-IA, Glacier Instant Retrieval, Glacier Flexible Retrieval, then Glacier Deep Archive. One Zone-IA is below Standard-IA but single-AZ. Use current S3 pricing for exact rates.
Key point: Accepting restore waits enables lower archive rates. Glacier classes target low-cost long-term archives, with minimum duration and retrieval charges.
Watch out: Tiny objects or early deletion can reverse total-cost results through duration/per-object charges; do not price small files by GB alone.
A_ZH:
答：即时访问层的存储单价高于需等待恢复的归档层，从高到低大致是：S3 Standard、Standard-IA、Glacier Instant Retrieval、Glacier Flexible Retrieval、Glacier Deep Archive；One Zone-IA低于Standard-IA但只存单AZ。现行具体数值以S3定价页为准。
考点：单价用等待换：能接受恢复等待，才进入更低的归档价位。Glacier系列存储层就是为低成本长期存档设计的，代价是最低存储期和取回费。
易错提醒：对象很小或提前删除时，最低计费期和按对象收取的费用可能反转结论；小文件不能只看每GB单价。
SOURCE: https://aws.amazon.com/s3/pricing/
