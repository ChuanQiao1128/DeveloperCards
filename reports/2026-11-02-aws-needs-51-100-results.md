# AWS累计第51–100条制卡需求清单

本批50条全部生成并通过程序检查；风险/随机复核范围内的条目通过需求语义复核，其余明确保留为候选。不是标准答案、AWS事实验收或正式卡片。

| 项目 | 实际结果 |
| --- | --- |
| 编号 | 累计51–100；原题Q1–Q52，跳过Q39/Q44 |
| 新增需求／程序检查通过 | 50／50 |
| 本批语义复核通过／未审候选 | 41／9 |
| 复用方式 | 35份旧分析绑定有效；34份不直接兼容而补抽，Q14从已接受分析提取；另15题新抽 |
| 全库需求／剩余 | 100／918（范围1,018题） |
| 正式新卡 | 0；最终卡数未知 |
| 本轮开始至交付准备墙钟 | 14.77分钟，含准备、对照、生成、复核和投影 |
| CLI可观测token | 84,640；主对话/原生复核用量unknown |

## 时间与优化效果

同一组已见10题回放：旧调用250.4秒，新调用89.4秒，调用耗时下降64.3%；输出从13,843降至5,050token，下降63.52%。平均505token/题，450软目标尚未达到。独立复核未发现决定性漏项，Q416正例通过、误加合取负例被拒绝。

该对照只能说明这组题上的格式改善。本批49题源文抽取＋1题已接受分析投影，与上一批40新＋10回归的构成不同；不把整批差异全部归因于优化。

| CLI作业 | 秒 | 输入token | 输出token |
| --- | ---: | ---: | ---: |
| control10 | 89.412 | 25931 | 5050 |
| fresh49 | 302.683 | 37716 | 15943 |

推理量已包含于原CLI输出口径，不再重复相加。20分钟/12万可观测token为停派线；在途与必要收尾全部计入实际时长。模型与供应商配置沿用原通道，上游身份未暴露。

## 分项耗时与后续估算

| 部分 | 实际耗时 | 口径 |
| --- | ---: | --- |
| 准备至首个对照调用 | 1.46分钟 | 含状态/来源检查、适配与本地控制 |
| 10题短格式对照生成 | 1.49分钟 | CLI实测 |
| 对照复核窗口 | 1.75分钟 | 请求到结果文件窗口，含派发/落盘；worker报告83秒不另加 |
| 49题正式源文抽取 | 5.04分钟 | CLI实测，另1题Q14从既有分析投影 |
| 41题需求复核窗口 | 3.41分钟 | 请求到结果窗口；worker报告167.3秒不另加 |
| 结果验收并首次落盘 | 14.77分钟 | 从本轮第一条准备操作开始的墙钟 |
| 含时间评估及记录收尾 | 15.84分钟 | 截至05:20:26 UTC |

正式49题平均输出325.37token/题，低于450软目标；同10题对照平均505，不能混为同一组结果。35份旧分析只有Q14实际用于需求投影，其余34题回退抽取成本已计入正式调用。

若后续源文长度及风险比例与本批相近，复用现成工具、不重复本次10题对照，暂按**每50题9–12分钟**估计。剩余918题约为**2.75–3.67小时，可按3–4小时安排**，仅限需求清单及相同的风险/随机语义复核。来源更长或实质错误触发扩审/修复时需上调；这不是硬工期，不含需求聚合、AWS官方事实研究、制卡和最终全题覆盖验收。没有启动剩余918题。

本批41/50触发语义复核，审查节省小于原先19题预期。以后应少写不必要的先修候选；真正必要的先修仍须保留并复核。Q9的copy/“搬走”措辞备注已保留，因后续判断仍明确核验源空间释放，不构成实质失败，本轮不返修。

## 检查范围

全部50题保留完整规范题干及全部选项；程序检查qid、字段、引用归属、来源哈希、唯一性和旧50条保留。S是题干，O1…是按原始顺序的选项提议；普通定位为block_ref，不声称精确字符跨度。

语义复核题号：Q1、Q2、Q3、Q4、Q6、Q7、Q9、Q10、Q11、Q12、Q14、Q15、Q18、Q19、Q20、Q21、Q23、Q24、Q25、Q26、Q27、Q28、Q30、Q31、Q32、Q33、Q35、Q36、Q37、Q38、Q40、Q41、Q42、Q43、Q46、Q47、Q48、Q49、Q50、Q51、Q52。固定随机/来源风险并集19题，另含Q14及输出风险。未逐题复核的记录没有semantic PASS。

## 逐条需求

### 第51条 · Q1

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：跨洲城市站点采集温度、湿度和气压，每站平均500 GB/天，均有高速Internet；尽快汇聚至单个Amazon S3 bucket，并最小化运维复杂度。

**必要判断**

- j1（显式）：比较S3 Transfer Acceleration配合multipart upload直传、就近Region上传后Cross-Region Replication并删除源数据、每日Snowball Edge转运后复制的汇聚时效与运维。〔S, O1, O2, O3〕
- j2（显式）：判断就近EC2/EBS落盘、定期snapshot跨Region复制并恢复的链路，是否完成向目标S3 bucket汇聚及其时效目标。〔S, O4〕

**待官方核验**

- 待查各上传、离线转运、跨Region复制及EBS snapshot恢复路径的适用范围、端到端步骤和时间开销。〔j1, j2〕

### 第52条 · Q2

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：专有应用日志已以JSON存于Amazon S3；执行简单、按需查询，尽量少改现有架构并最小化运维。

**必要判断**

- j1（显式）：比较Athena直接查询S3、Redshift集中加载、迁入CloudWatch Logs后查询，以及Glue catalog配合临时EMR Apache Spark SQL的架构变更和运维。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断各查询链路对JSON、SQL、数据搬迁、catalog及计算集群准备的要求。〔O1, O2, O3, O4〕

**待官方核验**

- 待查各服务对S3 JSON按需查询的支持、CloudWatch查询接口及所需加载、元数据和计算资源。〔j1, j2〕

### 第53条 · Q3

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：AWS Organizations集中管理部门多账号；management account中的S3项目报告仅允许组织内账号用户访问，并最小化运维。

**必要判断**

- j1（显式）：比较bucket policy按organization ID、部门OU路径或用户tag限定访问时的组织边界与维护负担。〔S, O1, O2, O4〕
- j2（显式）：比较CloudTrail监控CreateAccount、InviteAccountToOrganization、LeaveOrganization、RemoveAccountFromOrganization后更新policy，与条件键方案在成员变动时的维护差异。〔S, O1, O2, O3, O4〕

**待官方核验**

- 待查aws PrincipalOrgID、aws:PrincipalOrgPaths、aws:PrincipalTag的准确标识、匹配范围及账号进出组织时的策略维护要求。〔j1, j2〕

**源异常／歧义**

- O1条件键写为aws PrincipalOrgID，技术标识格式需确认。

### 第54条 · Q4

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：VPC内EC2应用处理S3日志；EC2须在无Internet连接时获得到S3的私有网络连接。

**必要判断**

- j1（显式）：比较S3 gateway VPC endpoint、CloudWatch Logs转存、EC2 instance profile及API Gateway配合private link，能否建立所需EC2到S3私有访问路径。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：区分网络连通、访问授权与日志搬运各自解决的需求，并判断API Gateway方案所需的实际服务衔接。〔O1, O2, O3, O4〕

**待官方核验**

- 待查S3私有连接方式、instance profile权限作用，以及API Gateway/private link访问S3的支持与网络前提。〔j1, j2〕

### 第55条 · Q5

状态：程序检查通过，未做逐题语义复核的候选；技术事实待官方核验。

**关键条件**

- c1〔S〕：原单EC2/EBS文档应用为扩展性和可用性复制到另一AZ，两实例位于ALB后；刷新仅见不同文档子集，需同时看见全部文档。

**必要判断**

- j1（显式）：比较复制两份EBS数据与迁移两卷数据至EFS并将新文档写入EFS，能否持续提供跨实例完整文档视图。〔S, O1, O3〕
- j2（显式）：判断ALB按文档位置选择服务器或向两服务器同时发请求并合并返回，能否解决文档分散问题及需要哪些应用配合。〔S, O2, O4〕

**待官方核验**

- 待查跨AZ文件共享、EBS数据复制与后续写入一致性，以及ALB路由、请求分发和响应合并能力边界。〔j1, j2〕

### 第56条 · Q6

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：本地NAS通过NFS存放视频，单文件1 MB–500 GB，总量70 TB且不再增长；尽快迁往S3，同时尽可能少占网络带宽。

**必要判断**

- j1（显式）：比较IAM role授权AWS CLI复制、Snowball Edge本地装载并寄回导入，以及S3 File Gateway通过NFS搬迁的总时效与网络占用。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断File Gateway公共service endpoint与新建Direct Connect/public VIF两种链路的连接前提、部署时间和数据搬运路径。〔O3, O4〕

**待官方核验**

- 待查各路径对NFS、70 TB及最大500 GB文件的支持，Snowball Edge导入流程，以及File Gateway与Direct Connect/public VIF衔接条件。〔j1, j2〕

### 第57条 · Q7

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：消息由数十个应用和微服务快速消费；流量剧烈变化，突增至100,000条/秒，需解耦并增强扩展性。

**必要判断**

- j1（显式）：比较Kinesis Data Analytics持久化消费、摄取EC2按CPU扩缩、单shard Kinesis Data Streams→Lambda预处理→DynamoDB读取，以及SNS→多个队列订阅的解耦与多消费者交付。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断各链路在100,000条/秒突发下的容量、缓冲、消费隔离及新增中间处理瓶颈。〔O1, O2, O3, O4〕

**待官方核验**

- 待查各服务的消息存储/扇出定位、单shard吞吐与扩缩机制，以及SNS与队列订阅的交付和配额限制。〔j1, j2〕

**源异常／歧义**

- O4的Amazon Simple Queue Service缩写写为Amazon SOS，服务标识不一致。

### 第58条 · Q8

状态：程序检查通过，未做逐题语义复核的候选；技术事实待官方核验。

**关键条件**

- c1〔S〕：分布式应用迁往AWS，负载可变；旧平台由primary server协调多个计算节点，现代化需最大化弹性恢复能力与扩展性。

**必要判断**

- j1（显式）：比较SQS作业队列配合EC2 Auto Scaling的定时扩缩与按队列大小扩缩，对可变负载及协调层故障的适应性。〔S, O1, O2〕
- j2（显式）：比较保留primary server并将节点纳入Auto Scaling，以CloudTrail或EventBridge接收作业、按primary或计算节点负载扩缩的完整调度链路。〔S, O3, O4〕

**待官方核验**

- 待查SQS、CloudTrail、EventBridge的作业接收与交付边界，以及定时、队列大小、服务器负载扩缩的指标和故障处理要求。〔j1, j2〕

### 第59条 · Q9

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：本地SMB服务器存大文件，创建后最初几天频繁访问，7天后少访问；数据增长接近容量上限，需扩容、保留最近访问文件的低延迟并提供生命周期管理。

**必要判断**

- j1（显式）：比较DataSync搬走超过7天数据、S3 File Gateway配合7天后转Glacier Deep Archive、FSx for Windows File Server，以及客户端工具访问S3配合7天后转Glacier Flexible Retrieval。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断各方案的SMB访问衔接、本地容量释放、近期访问缓存与归档后取回行为，及生命周期是否完整。〔O1, O2, O3, O4〕

**待官方核验**

- 待查SMB/File Gateway缓存与生命周期配合、DataSync迁移后的源空间处理、FSx扩容管理及两种Glacier取回限制。〔j1, j2〕

**非阻塞备注**

- “搬走”比O1的copy表述偏强；同条mustJudge[1]与toVerify[0]仍将本地空间释放和源空间处理保留为待判断，未断言复制会自动删除源数据，因此仅为非阻断措辞备注。

### 第60条 · Q10

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：电商新订单经Amazon API Gateway REST API提交处理，须按接收顺序处理。

**必要判断**

- j1（显式）：比较API Gateway→SNS→Lambda、API Gateway→SQS FIFO/standard→Lambda，以及authorizer在处理期间阻止请求，对订单顺序和请求接收的影响。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断消息顺序范围与Lambda并发处理如何衔接，是否需要明确全局顺序或分组顺序。〔S, O1, O2, O4〕

**待官方核验**

- 待查SNS、SQS FIFO/standard的顺序语义、API Gateway集成和authorizer边界，以及Lambda消费时的顺序与并发配置。〔j1, j2〕

### 第61条 · Q11

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：EC2应用以本地文件中的用户名和密码连接Aurora；需最小化凭证管理运维。

**必要判断**

- j1（显式）：比较Secrets Manager自动轮换、Systems Manager Parameter Store所提自动轮换，与凭证文件迁至KMS加密S3或各EC2加密EBS的管理负担。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断集中存储、静态加密与数据库凭证轮换的职责差异，以及应用读取和轮换后同步所需改动。〔O1, O2, O3, O4〕

**待官方核验**

- 待查Secrets Manager和Parameter Store的Aurora凭证轮换支持、配置要求，以及S3/EBS文件方案所需自管环节。〔j1, j2〕

### 第62条 · Q12

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：全球Web应用为ALB后EC2，静态数据在S3；自有域名注册于Route 53，需改善静态和动态数据性能并降低延迟。

**必要判断**

- j1（显式）：比较CloudFront同时使用S3与ALB origins，及CloudFront仅用ALB或S3并搭配Global Accelerator的静态、动态完整请求路径。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断Global Accelerator所提S3、ALB、CloudFront endpoints是否适用，并比较Route 53指向CloudFront、单域名指向accelerator与静动态双域名的衔接。〔O1, O2, O3, O4〕

**待官方核验**

- 待查CloudFront多origin与动态内容处理、Global Accelerator endpoint类型，以及各DNS链路能否覆盖两类数据。〔j1, j2〕

### 第63条 · Q13

状态：程序检查通过，未做逐题语义复核的候选；技术事实待官方核验。

**关键条件**

- c1〔S〕：每月维护期间需轮换多个AWS Regions中RDS for MySQL的凭证，并最小化运维。

**必要判断**

- j1（显式）：比较Secrets Manager多Region secret replication加定时轮换，与Systems Manager secure string所提复制和轮换机制。〔S, O1, O2〕
- j2（显式）：比较SSE加密S3→EventBridge→Lambda轮换，以及KMS multi-Region customer managed keys→DynamoDB global table→Lambda读取→RDS API轮换的跨Region协调与自管负担。〔S, O3, O4〕

**待官方核验**

- 待查跨Region secret复制与轮换职责、Parameter Store对应能力，以及自定义方案对RDS凭证更新、调度和同步的要求。〔j1, j2〕

### 第64条 · Q14

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：The Auto Scaling group scales based on CPU utilization metrics.
- c2〔S〕：transaction data in a MySQL 8.0 database that is hosted on a large EC2 instance.
- c3〔S〕：more read requests than write transactions.
- c4〔S〕：automatically scale the database to meet the demand of unpredictable read workloads while maintaining high availability.
- c5〔O1〕：Amazon Redshift with a single node for leader and compute functionality.
- c6〔O2〕：Amazon RDS with a Single-AZ deployment
- c7〔O2〕：Configure Amazon RDS to add reader instances in a different Availability Zone.
- c8〔O3〕：Amazon Aurora with a Multi-AZ deployment.
- c9〔O3〕：Configure Aurora Auto Scaling with Aurora Replicas.
- c10〔O4〕：Amazon ElastiCache for Memcached with EC2 Spot Instances.

**必要判断**

- j1（显式）：MySQL 8.0事务库读多写少、不可预测读负载下，如何联合判断引擎兼容、读容量自动扩缩和跨AZ高可用；比较Redshift单节点、RDS Single-AZ及增加reader、Aurora Multi-AZ/副本扩缩、Memcached+Spot的角色？〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：针对副本扩缩组合，怎样核验已有reader前提、reader与writer扩展边界、min/max和监控响应，以及应用连接新增副本后才能利用读容量的条件？〔S, O3〕

**待官方核验**

- 核验MySQL版本兼容、跨AZ读卸载/故障接管及副本自动扩缩的起始前提、连接方式与响应边界。〔j1, j2〕

### 第65条 · Q15

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：迁入AWS后需保护production VPC进出流量，复现本地inspection server的流量检查与过滤功能。

**必要判断**

- j1（显式）：比较GuardDuty、Traffic Mirroring、Network Firewall规则与Firewall Manager规则，是否覆盖生产VPC双向流量的检查和过滤。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：区分威胁检测、流量复制、实际过滤执行与集中策略管理所需组件及流量路径。〔O1, O2, O3, O4〕

**待官方核验**

- 待查四种服务的检查、阻断、策略管理边界，以及实现VPC进出流量过滤的部署前提。〔j1, j2〕

### 第66条 · Q16

状态：程序检查通过，未做逐题语义复核的候选；技术事实待官方核验。

**关键条件**

- c1〔S〕：数据湖包含S3和RDS for PostgreSQL；报表须覆盖全部数据源并提供可视化，仅管理团队可完整访问，其他员工仅有限访问。

**必要判断**

- j1（显式）：判断QuickSight连接全部数据源、建datasets并发布dashboards的方案，按IAM roles分享与按users/groups分享能否表达访问层级。〔S, O1, O2〕
- j2（显式）：比较Glue crawler/table加ETL生成S3报表，与Glue加Athena Federated Query访问PostgreSQL后生成S3报表，对全源覆盖、可视化和bucket policy权限分层的满足程度。〔S, O3, O4〕

**待官方核验**

- 待查QuickSight数据源与dashboard分享主体、权限粒度，以及Glue/Athena联邦查询、报表可视化和S3访问控制的衔接。〔j1, j2〕

### 第67条 · Q17

状态：程序检查通过，未做逐题语义复核的候选；技术事实待官方核验。

**关键条件**

- c1〔S〕：新业务应用运行于两台EC2，以S3 bucket存文档；需确保两实例有权访问该bucket。

**必要判断**

- j1（显式）：比较将授予S3访问权限的IAM role、policy、group或user关联到EC2的方案，判断身份、权限与实例关联链路。〔S, O1, O2, O3, O4〕

**待官方核验**

- 待查EC2可关联的IAM实体、instance profile与role/policy关系，以及实例取得S3访问凭证的机制。〔j1〕

### 第68条 · Q18

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：Web上传大图至S3，Lambda压缩后存入另一S3 bucket；需以持久、无状态组件自动处理，选择两个动作。

**必要判断**

- j1（显式）：判断S3上传通知→SQS、SQS触发Lambda及成功处理后删消息，如何组合成自动处理与结果写入链路。〔S, O1, O2〕
- j2（显式）：比较Lambda轮询S3并以内存文本跟踪、EC2轮询SQS并以本地文本记录后调用Lambda，以及EventBridge→SNS邮件交由owner继续处理，对持久性、无状态和自动化的影响。〔S, O3, O4, O5〕

**待官方核验**

- 待查S3通知、SQS与Lambda事件源衔接、消息确认/重试，以及内存或EC2本地状态和邮件流程的处理边界。〔j1, j2〕

### 第69条 · Q19

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：三层应用Web在VPC公有子网，应用和数据库在同VPC私有子网；独立inspection VPC内Marketplace防火墙以IP接口收包，须在到Web前检查全部入站流量，且运维最少。

**必要判断**

- j1（显式）：比较应用VPC公有子网中的NLB/ALB导向设备、inspection VPC的transit gateway路由，以及Gateway Load Balancer配合endpoint转发设备的跨VPC检查路径。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断各方案的IP包转发、设备接入协议、路由覆盖与Web前强制经过检查的部署及运维要求。〔O1, O2, O3, O4〕

**待官方核验**

- 待查NLB、ALB、transit gateway、Gateway Load Balancer及endpoint对第三方IP设备的接入、封装和跨VPC路由要求。〔j1, j2〕

### 第70条 · Q20

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：同Region将EC2/EBS上的大量生产数据克隆到测试环境；测试修改不得影响生产，访问软件需持续高I/O，且克隆时间最短。

**必要判断**

- j1（显式）：比较snapshot恢复至instance store、生产EBS Multi-Attach至测试，以及snapshot恢复至独立新EBS，对数据隔离和恢复目标的满足程度。〔S, O1, O2, O3, O4〕
- j2（显式）：比较先创建并初始化新EBS、挂载后再恢复的流程，与启用fast snapshot restore后恢复并挂载的克隆耗时及初始I/O表现。〔S, O3, O4〕

**待官方核验**

- 待查snapshot可恢复目标、Multi-Attach数据共享语义、EBS恢复/初始化顺序，以及fast snapshot restore的启用范围和性能前提。〔j1, j2〕

### 第71条 · Q21

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：每日仅一个促销商品，持续24小时；高峰每小时数百万请求且毫秒级延迟，需最少运维。

**必要判断**

- j1（显式）：比较全站多S3 bucket/CloudFront且订单存S3、多AZ EC2 Auto Scaling加前后端两个ALB及RDS MySQL、EKS容器加Cluster Autoscaler及RDS MySQL、静态S3/CloudFront加API Gateway/Lambda及DynamoDB的端到端能力。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断各方案的动态订单处理、突发扩容、数据访问延迟与运维负担，并核对所提Cluster Autoscaler调整pods的职责。〔O1, O2, O3, O4〕

**待官方核验**

- 待查各托管/自管链路的扩缩与延迟约束、订单存储处理要求，以及EKS Cluster Autoscaler与pod扩缩的能力边界。〔j1, j2〕

### 第72条 · Q22

状态：程序检查通过，未做逐题语义复核的候选；技术事实待官方核验。

**关键条件**

- c1〔S〕：数字媒体存于S3，须抵御一个AZ丢失；文件冷热混合且访问模式不可预测，需最小化存储与取回的总体成本。

**必要判断**

- j1（显式）：比较S3 Standard、Intelligent-Tiering、Standard-IA、One Zone-IA的AZ故障覆盖、访问模式适应性及存储和取回成本组合。〔S, O1, O2, O3, O4〕

**待官方核验**

- 待查四种storage class的AZ范围、自动分层机制、存储/访问/监控费用及最小计费约束。〔j1〕

### 第73条 · Q23

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：备份目前存S3 Standard，首1个月频繁访问，之后不再访问但须无限期保留；追求最高成本效益。

**必要判断**

- j1（显式）：比较Intelligent-Tiering自动迁移，与Lifecycle在1个月后从Standard转Glacier Deep Archive、Standard-IA或One Zone-IA的长期保留成本。〔S, O1, O2, O3, O4〕

**待官方核验**

- 待查各类别的长期存储、自动分层和转换费用、最小计费期限及Lifecycle支持，按题设访问阶段比较总成本。〔j1〕

### 第74条 · Q24

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：最近账单EC2成本上升，若干实例发生非预期instance type纵向扩容；需比较最近2个月成本图并深入分析扩容根因，运维最少。

**必要判断**

- j1（显式）：比较AWS Budgets报告、Cost Explorer细粒度过滤、Billing and Cost Management dashboard图，以及Cost and Usage Reports→S3→QuickSight交互图，对按instance type比较2个月成本的支持与运维。〔S, O1, O2, O3, O4〕
- j2（显式）：判断各方案提供的成本细分是否足以回答题干所称纵向扩容根因，以及还缺少何种分析信息。〔S, O1, O2, O3, O4〕

**待官方核验**

- 待查各成本工具的历史图表、instance type过滤与明细粒度，以及成本归因和实际变更原因的证据范围。〔j1, j2〕

**源异常／歧义**

- “扩容根因”未明确指费用增长归因，还是发起实例类型变更的行为原因。

### 第75条 · Q25

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：API Gateway→Lambda→Aurora PostgreSQL高量写入；PoC需大幅提高Lambda quotas，改造需提高扩展性并最小化配置工作。

**必要判断**

- j1（显式）：比较改写为EC2 Apache Tomcat/JDBC、改用DynamoDB配DAX/client SDK，以及拆成接收和入库两个Lambda并以SNS或SQS衔接的改造量与扩展性。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断SNS与SQS在接收入库解耦、流量缓冲和消费速率协调上的差异，并辨别DAX方案是否针对题设写入问题及现有接口。〔O2, O3, O4〕

**待官方核验**

- 待查Lambda配额与入库链路限制、SNS/SQS消费机制，以及DAX适用操作和从Aurora迁移所需接口改动。〔j1, j2〕

**源异常／歧义**

- O2提到“existing DynamoDB API calls”，与题干现有Aurora PostgreSQL不一致；DynamoDProvision处亦有文本粘连。

### 第76条 · Q26

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：审查AWS部署，确认S3 buckets没有未经授权的配置变更。

**必要判断**

- j1（显式）：比较AWS Config rules、Trusted Advisor checks、Inspector assessment template，以及S3 server access logging配合EventBridge，对S3配置变更与授权合规审查的覆盖。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：区分资源配置记录/规则评估、建议检查、漏洞评估与访问日志事件，判断如何表达“未经授权”。〔S, O1, O2, O3, O4〕

**待官方核验**

- 待查各服务对S3配置历史、变更评估和规则的支持，以及server access logging与EventBridge组合可获得的事件范围。〔j1, j2〕

### 第77条 · Q27

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：产品经理需定期查看CloudWatch应用指标dashboard，现无AWS账号；提供访问须遵循最小权限。

**必要判断**

- j1（显式）：比较CloudWatch按邮箱分享链接、专用IAM user配CloudWatchReadOnlyAccess、员工共用IAM user配ViewOnlyAccess，以及按需启动公有子网bastion并经RDP使用缓存AWS凭证。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断各路径的dashboard可见范围、AWS身份需求、凭证共享和远程主机权限是否超出查看目标。〔O1, O2, O3, O4〕

**待官方核验**

- 待查CloudWatch dashboard邮箱分享的认证与权限边界、两项managed policy范围，以及bastion缓存凭证路径的授权范围。〔j1, j2〕

### 第78条 · Q28

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：应用部署在Organizations集中管理的不同账号；需覆盖全部账号的SSO，用户和组须继续由本地自管Microsoft Active Directory管理。

**必要判断**

- j1（显式）：比较启用AWS SSO并经AWS Directory Service for Microsoft Active Directory建立单向forest/domain trust或双向forest trust的身份衔接。〔S, O1, O2〕
- j2（显式）：判断仅Directory Service双向trust，或本地部署IdP并启用AWS SSO，能否完整覆盖多账号SSO且保留本地用户组管理。〔S, O3, O4〕

**待官方核验**

- 待查AWS SSO与Organizations、本地AD、Directory Service或外部IdP的集成要求，及trust方向、类型与用户组同步条件。〔j1, j2〕

### 第79条 · Q29

状态：程序检查通过，未做逐题语义复核的候选；技术事实待官方核验。

**关键条件**

- c1〔S〕：VoIP使用UDP，EC2位于Auto Scaling group并跨多个Regions部署；须路由到最低延迟Region并实现跨Region自动故障转移。

**必要判断**

- j1（显式）：比较各Region的NLB或ALB配target group/Auto Scaling group并作为Global Accelerator endpoint，对UDP、延迟选路及故障转移的支持。〔S, O1, O2〕
- j2（显式）：比较NLB→Route 53 latency aliases→CloudFront origin，与ALB→Route 53 weighted aliases→CloudFront origin的完整协议、选路和故障处理链路。〔S, O3, O4〕

**待官方核验**

- 待查NLB、ALB、Global Accelerator和CloudFront的UDP支持，以及latency/weighted routing、健康检查与跨Region故障转移语义。〔j1, j2〕

### 第80条 · Q30

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：启用Performance Insights的通用型RDS for MySQL每月仅测试使用48小时，测试资源密集；降低成本且不降低DB instance计算和内存属性。

**必要判断**

- j1（显式）：比较测试后停止/按需启动、Auto Scaling、snapshot后终止/按需恢复，以及闲时降规格再恢复的月度总成本与资源属性约束。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断跨月闲置期间的停止时限、自动重启、持续计费、snapshot恢复和规格调整对下次测试准备的影响。〔O1, O2, O3, O4〕

**待官方核验**

- 待查RDS MySQL停止期限和计费、实例Auto Scaling适用范围、snapshot恢复成本及Performance Insights相关保留与收费。〔j1, j2〕

### 第81条 · Q31

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：需检查所有EC2 instances、RDS DB instances和Redshift clusters均配置tags，并最小化检查的配置和运维工作。

**必要判断**

- j1（显式）：比较Config rules检测缺失/不当tags、Cost Explorer查找后手工标记，以及自编API检查在EC2定期运行或由CloudWatch调度Lambda运行的覆盖与维护负担。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断各机制对三种资源的tag检查支持，以及合规检测与实际补标签的职责边界。〔O1, O2, O3, O4〕

**待官方核验**

- 待查Config tag规则的资源覆盖、Cost Explorer可见范围，以及自定义API扫描与定时执行所需配置。〔j1, j2〕

### 第82条 · Q32

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：为其他团队托管仅含HTML、CSS、客户端JavaScript和图片的网站，追求最高成本效益。

**必要判断**

- j1（显式）：比较AWS Fargate容器、S3 bucket托管、EC2 Web server，以及ALB→Lambda target配Express.js，对这些内容的托管能力及总体成本。〔S, O1, O2, O3, O4〕

**待官方核验**

- 待查各方案静态内容托管前提、持续运行资源与请求/存储收费，以及ALB/Lambda集成所需组件。〔j1〕

### 第83条 · Q33

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：在线市场高峰数十万用户；需可扩展、近实时地向多个内部应用共享数百万金融交易，并在写入文档数据库前去除敏感数据，以低延迟检索。

**必要判断**

- j1（显式）：比较DynamoDB写入规则脱敏后Streams共享、Firehose/Lambda脱敏写DynamoDB与S3后从S3消费、Kinesis Data Streams/Lambda脱敏写DynamoDB并从stream消费，以及S3批文件/Lambda处理后写DynamoDB。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断各链路的多消费者近实时性、脱敏先后顺序、文档数据检索，以及所提写入规则和Firehose目的地支持。〔O1, O2, O3, O4〕

**待官方核验**

- 待查DynamoDB规则/Streams、Firehose目的地与转换、Kinesis多消费者和Lambda处理机制，以及S3批量路径的延迟。〔j1, j2〕

### 第84条 · Q34

状态：程序检查通过，未做逐题语义复核的候选；技术事实待官方核验。

**关键条件**

- c1〔S〕：AWS多层应用为合规、治理、审计和安全，须跟踪资源配置变化并记录针对资源的API调用历史。

**必要判断**

- j1（显式）：判断AWS Config、CloudTrail和CloudWatch如何分别承担配置变更与API历史两项职责，并比较选项中的互换及组合。〔S, O1, O2, O3, O4〕

**待官方核验**

- 待查三项服务对资源配置历史、API事件记录及其覆盖范围和启用要求。〔j1〕

### 第85条 · Q35

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：待发布公网Web应用为VPC内EC2加ELB，DNS由第三方提供；需检测并防护大规模DDoS。

**必要判断**

- j1（显式）：比较账号GuardDuty、EC2 Inspector、Shield关联Route 53，以及Shield Advanced关联ELB，对DDoS检测、防护与既有第三方DNS架构的适配。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：区分检测、漏洞评估和流量防护，并判断保护资源选择及DNS是否需要改变。〔O1, O2, O3, O4〕

**待官方核验**

- 待查GuardDuty、Inspector、Shield/Shield Advanced的DDoS职责、可保护资源，以及第三方DNS下保护ELB的条件。〔j1, j2〕

### 第86条 · Q36

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：两个Regions各有S3 bucket，全部数据须用KMS customer managed key加密；两bucket须用同一KMS key加解密，数据与key在两Region均存放，运维最少。

**必要判断**

- j1（显式）：比较customer managed multi-Region KMS key配客户端加密，与各Region独立KMS key配SSE-KMS，对同一key和双Region本地存放要求的满足程度。〔S, O2, O4〕
- j2（显式）：判断SSE-S3加复制、另建KMS key但仍配置SSE-S3，以及各方案的S3 replication、加解密责任与运维差异。〔S, O1, O2, O3, O4〕

**待官方核验**

- 待查multi-Region KMS key的身份/密钥材料关系、客户端加密与SSE-S3/SSE-KMS差异，以及跨Region复制的加密处理。〔j1, j2〕

**源异常／歧义**

- “同一KMS key”未明确指同一key资源标识，还是跨Region关联key共享的密钥材料。

### 第87条 · Q37

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：多种新EC2工作负载需安全远程访问与管理；流程须可重复、使用AWS原生服务、遵循Well-Architected Framework且运维最少。

**必要判断**

- j1（显式）：比较EC2 serial console、现有及新实例绑定IAM role后用Session Manager建立所提SSH会话、公有子网bastion配统一SSH key，以及Site-to-Site VPN配本地SSH访问。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断各路径的实例接入前提、身份与密钥管理、网络暴露和新实例重复配置成本。〔O1, O2, O3, O4〕

**待官方核验**

- 待查serial console适用条件、Session Manager与SSH会话所需IAM/agent/网络配置，以及bastion和VPN的管理要求。〔j1, j2〕

### 第88条 · Q38

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：静态网站托管S3并用Route 53 DNS；全球需求增长，需以最高成本效益降低用户访问延迟。

**必要判断**

- j1（显式）：比较复制到所有Regions加Route 53 geolocation、Global Accelerator IP关联S3并改DNS、S3前加CloudFront并改DNS，以及S3 Transfer Acceleration endpoint配DNS的访问加速与成本。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断各机制适用的流量方向、S3 endpoint支持、缓存或副本维护，以及DNS能否形成完整网站访问链路。〔O1, O2, O3, O4〕

**待官方核验**

- 待查S3网站与CloudFront、Global Accelerator、Transfer Acceleration的集成边界，以及多Region复制和各加速路径的费用。〔j1, j2〕

### 第89条 · Q40

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：数千edge devices每天生成1 TB告警，每条约2 KB；须高可用摄取存储供未来分析，14天数据可立即分析，超过14天归档，成本低且不管理额外基础设施，运维最高效。

**必要判断**

- j1（显式）：比较Firehose→S3→14天Lifecycle转Glacier，与跨两AZ EC2/ELB加自编S3写入脚本及相同Lifecycle的可用性、容量、成本和运维。〔S, O1, O2〕
- j2（显式）：比较Firehose→OpenSearch每日手工snapshot并删14天旧数据，与SQS standard保留14天、消费者按年龄分析/转S3/删除，对即时分析和完整归档的满足程度。〔S, O3, O4〕

**待官方核验**

- 待查Firehose交付与缓冲、S3 Lifecycle、OpenSearch snapshot/删除，以及SQS保留到期和消费语义对14天分析/归档衔接的限制。〔j1, j2〕

### 第90条 · Q41

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：多SaaS数据由同一EC2接收、上传S3分析并在完成后通知用户；当前性能慢，需尽可能改善应用性能并最小化运维。

**必要判断**

- j1（显式）：比较EC2 Auto Scaling配S3完成事件→SNS，与每个SaaS经AppFlow→S3并用相同事件通知，对整体性能和运维的影响。〔S, O1, O2〕
- j2（显式）：判断每源EventBridge rule→S3及第二rule→SNS，和ECS容器替代EC2配Container Insights→SNS，能否完成SaaS传输及准确的上传完成通知。〔S, O3, O4〕

**待官方核验**

- 待查AppFlow的SaaS/S3连接支持、S3完成事件与SNS、EventBridge目标及Container Insights事件能力，并比较链路运维。〔j1, j2〕

### 第91条 · Q42

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：高可用图像应用在单VPC的多AZ、多子网EC2上运行，实例互不通信，均经单NAT gateway上传下载S3；需最具成本效益地避免Regional数据传输费用。

**必要判断**

- j1（显式）：比较每AZ配置NAT gateway、改用NAT instance、S3 gateway VPC endpoint，以及EC2 Dedicated Host，对S3流量路径与Regional传输费用的影响。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：区分跨AZ传输、NAT处理及其他资源费用，判断避免目标费用后的总体成本。〔O1, O2, O3, O4〕

**待官方核验**

- 待查跨AZ访问NAT、S3 gateway endpoint路由和收费，以及NAT instance、Dedicated Host是否改变相关传输计费。〔j1, j2〕

### 第92条 · Q43

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：本地应用产生大量时效敏感数据并备份S3；增长引发Internet带宽投诉，需长期方案保证及时备份且尽量少影响内部用户Internet连接。

**必要判断**

- j1（显式）：比较VPN并经VPC gateway endpoint代理流量、新建Direct Connect专供备份、每日Snowball装载寄回，以及请求解除S3 service limits，对备份时效与Internet竞争的影响。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断各链路的本地到S3可达性、实际带宽瓶颈和长期持续传输方式。〔O1, O2, O3, O4〕

**待官方核验**

- 待查VPN与gateway endpoint的接入边界、Direct Connect到S3路径、Snowball周转时效，以及S3限额与本地Internet带宽的区别。〔j1, j2〕

### 第93条 · Q45

状态：程序检查通过，未做逐题语义复核的候选；技术事实待官方核验。

**关键条件**

- c1〔S〕：SNS通知新数据到达，Lambda处理并记录metadata；网络问题偶发失败后须手工重跑，需未来自动摄取全部数据，选择两个动作。

**必要判断**

- j1（显式）：判断SNS订阅SQS与Lambda改读SQS如何组合，以在网络失败后保留待处理数据并恢复摄取。〔S, O2, O5〕
- j2（显式）：比较Lambda多AZ部署、增加CPU/内存和增加所提provisioned throughput，是否针对题设网络失败后的遗漏与手工恢复问题。〔S, O1, O3, O4〕

**待官方核验**

- 待查SNS/SQS/Lambda交付、保留、确认和重试机制，以及Lambda的AZ部署、资源配置与provisioned throughput标识和能力。〔j1, j2〕

### 第94条 · Q46

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：门店通过SFTP上传交易数据用于营销分析，部分文件超过200 GB；须检测不应包含的PII、告警管理员并自动修复，开发工作最少。

**必要判断**

- j1（显式）：比较S3中转配Inspector或Macie扫描，与对象上传触发自定义Lambda扫描，对SFTP接入、超200 GB文件和PII检测的适配及开发量。〔S, O1, O2, O3, O4〕
- j2（显式）：判断所提Lifecycle删除、SNS通知管理员删除，以及SES通知加Lifecycle删除，是否同时形成告警和自动修复闭环。〔S, O1, O2, O3, O4〕

**待官方核验**

- 待查Inspector/Macie的S3 PII扫描范围和文件大小限制、Lambda处理限制，以及检测结果到通知和自动删除的集成能力。〔j1, j2〕

**源异常／歧义**

- O2/O3仅描述通知管理员删除，未交代题干要求的自动修复；O4删除对象写为meats，指代异常。

### 第95条 · Q47

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：即将举行的活动持续1周，须保证指定Region内三个指定AZ的EC2容量。

**必要判断**

- j1（显式）：比较Reserved Instances与On-Demand Capacity Reservation，分别仅指定Region或同时覆盖三个指定AZ时的容量保证范围与1周需求适配。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断Region/AZ级购买或预留的粒度、三个AZ需如何分别配置，以及期限承诺与容量预留的区别。〔O1, O2, O3, O4〕

**待官方核验**

- 待查Regional/Zonal Reserved Instances和On-Demand Capacity Reservation的容量保证、AZ粒度、创建时机与期限约束。〔j1, j2〕

### 第96条 · Q48

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：网站商品catalog当前存于EC2 instance store；需高可用且存放位置持久。

**必要判断**

- j1（显式）：比较迁至ElastiCache for Redis、换更大EC2和instance store、迁至S3 Glacier Deep Archive或EFS，对catalog高可用、持久存储及网站访问的适配。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断各方案在实例故障或生命周期变化下的数据保留、可用性配置及归档取回前提。〔O1, O2, O3, O4〕

**待官方核验**

- 待查instance store数据生命周期、Redis持久性/高可用配置、Glacier Deep Archive取回机制及EFS可用性与持久性范围。〔j1, j2〕

### 第97条 · Q49

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：通话转录文件按月存储，通话后1年内随机访问，之后少访问；不足1年的文件须尽快查询和取回，旧文件允许取回延迟，成本效益最高。

**必要判断**

- j1（显式）：比较全程Glacier Instant Retrieval加tags查询、Intelligent-Tiering满1年转Glacier Flexible Retrieval配Athena/Glacier Select、Standard加S3 metadata满1年转Instant Retrieval，以及Standard满1年转Deep Archive配RDS metadata。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断tags、S3 metadata、RDS和查询服务能否完成文件定位与取回衔接，并比较冷热阶段延迟及存储、查询、检索总成本。〔O1, O2, O3, O4〕

**待官方核验**

- 待查各storage class的访问/取回和转换限制、tags及metadata检索方式，以及Athena和S3 Glacier Select的适用数据与可用条件。〔j1, j2〕

### 第98条 · Q50

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：生产工作负载运行于1,000台EC2 Linux，使用第三方软件；须尽快为全部实例打补丁以修复严重安全漏洞。

**必要判断**

- j1（显式）：比较自定义Lambda、Systems Manager Patch Manager、maintenance window及Run Command自定义命令，对第三方Linux软件的大规模即时补丁执行能力。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：区分补丁目录/基线支持、调度窗口与远程命令执行，并判断1,000台实例接入、并发与执行结果跟踪要求。〔O1, O2, O3, O4〕

**待官方核验**

- 待查Patch Manager对Linux第三方软件的支持边界、maintenance window与Run Command职责、managed node前提及批量执行配额。〔j1, j2〕

### 第99条 · Q51

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：应用通过REST API提供订单配送统计；需每天早晨同一时间提取、整理成易读HTML，并向多个邮箱发送报告，选择两个步骤。

**必要判断**

- j1（显式）：比较EventBridge定时调用Glue job或Lambda查询REST API，以及应用发送至Kinesis Data Firehose，对定时统计提取和HTML整理的衔接。〔S, O1, O3, O4〕
- j2（显式）：判断SES所提格式化与邮件发送，和S3存储→事件→SNS邮件，如何与提取步骤组合以满足HTML、多收件人与每日定时要求。〔S, O2, O5〕

**待官方核验**

- 待查EventBridge调度、Glue/Lambda调用REST API、HTML格式化职责，以及SES和SNS邮件内容、收件人与发送限制。〔j1, j2〕

### 第100条 · Q52

状态：需求语义复核通过；技术事实待官方核验。

**关键条件**

- c1〔S〕：本地应用迁至AWS，输出文件从数十GB到数百TB；数据须保持标准文件系统结构，方案须自动扩展、高可用且运维最少。

**必要判断**

- j1（显式）：比较ECS容器加S3、EKS容器加EBS、Multi-AZ EC2 Auto Scaling加EFS，以及相同计算部署加EBS，对文件系统语义、自动扩展、高可用和运维的整体满足程度。〔S, O1, O2, O3, O4〕
- j2（先修候选，待核验）：判断各存储对单文件数十GB至数百TB的限制、跨实例/AZ访问与计算扩缩时的数据持久关联要求。〔S, O1, O2, O3, O4〕

**待官方核验**

- 待查S3/EBS/EFS文件或对象大小与容量限制、文件系统语义、跨AZ共享/挂载及扩展机制，并核对各计算部署的运维前提。〔j1, j2〕

## 后续使用与边界

后续按全库学习目标聚合需求，再集中检索AWS官方依据和制作双语卡。全部N张卡事实/双语/教学审核及全部1,018题完整原文逐选项与卡集对照仍为必选；本批候选不抵扣这些验收。旧347卡、UID和学习记录未复用。

- [执行与用量](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/needs-51-100-20261102/progress.json)
- [语义复核](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/needs-51-100-20261102/batch-review.json)
- [对照与坏例复核](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/needs-51-100-20261102/control-review.json)
- [复用检查](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/needs-51-100-20261102/reuse-audit.json)
- [当前需求索引](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/needs-index-20261102/needs.jsonl)
