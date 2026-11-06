# 5道原题的知识点与考点分析

状态：5题考点分析样本，已通过独立核对，待用户试读反馈。只分析原题，不生成卡片，不增加正式卡数、原题verified数或题卡覆盖PASS。

本次回答：题目究竟要求判断什么？依靠哪些AWS知识才能解释选项？学完后应该具备什么能力？知识点写成有依据的陈述，考点写清条件如何决定方案。

选取Q282、Q562、Q324、Q456、Q508，覆盖访问控制、私有访问路径、本地存储及跨区域备份。Q456/Q508保留为同主题对照，用来检查共享知识和各题的区别。样本有意包含已知题源问题，不据此估算全库问题比例。

## 1．Q282：后端已经在私有子网，为什么还要限制访问来源？

**原题任务：** 公有子网中的ALB已经向私有子网中的EC2转发Web流量。现在要求EC2只接受ALB的流量，阻止来自该私有子网内外的任何其他来源。

**核心考点：** 怎样在接收请求的后端实施来源限制，使其他资源不能绕过ALB直接访问后端。

**决定性条件：** “只来自ALB”同时排除了其他内部来源。EC2处在私有子网这一事实，并没有表达这项来源许可。

**必须掌握的知识：**

- EC2的入站安全组规则控制哪些来源可以进入EC2。控制点应对应本次请求的接收资源。
- 可以把ALB专用安全组设为EC2入站规则的来源。引用来源组，允许的是关联该组的发送资源；若其他资源也关联该组，它们也属于允许来源。
- 要实现“只允许”，EC2关联的全部安全组不能另有允许其他来源的入站规则，因为各组的allow规则会合并。这是本判断的实施条件，暂不预定单独拆卡。

| 原选项 | 判题依据 |
| --- | --- |
| A：改路由，指向EC2私有IP | 没有实现EC2要求的ALB来源限制；不需要先学完整路由课程才能指出这个缺口。 |
| B：EC2安全组只允许来自ALB安全组的流量 | 与接收端、允许来源两项要求匹配。实际设置须保证来源组专用，并收口其他入站许可。 |
| C：移到公有子网并分配EIP | 改变位置和寻址，没有实施题目要求的来源限制。 |
| D：ALB安全组允许任意TCP端口 | 未限制EC2这一侧可以接收谁的流量。 |

**结论：** B有官方技术依据。保留原题“所有其他来源”的范围，不能只检查一个Web端口便声称原题全部入站限制完成。

**学完应能做到：** 解释为何“部署在私有子网”与“只接受指定上游”需要分别判断，并在目标端选对限制来源的方法。

**官方依据：** [安全组的控制范围](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)、[来源引用与规则合并](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html)、[ALB目标只接受负载均衡器流量](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html)。摘录N02–N05；官方明确写明将负载均衡器安全组作为目标安全组入站来源。

## 2．Q562：EC2调用DynamoDB，怎样让请求不经过互联网？

**原题任务：** VPC中的EC2调用DynamoDB，要求API调用不经过互联网；从五个选项中选择两项。

**核心考点：** 根据请求实际访问的服务选择私有访问路径，并让发起请求的子网使用该路径。

**决定性条件：** 应用运行在EC2上，请求的终点是DynamoDB。端点需要服务于这次DynamoDB调用。

**必须掌握的知识：**

- DynamoDB网关端点可供VPC内资源访问DynamoDB，无须互联网网关或NAT设备。
- 网关端点通过路由表起作用：选择实例所在子网关联的路由表后，AWS自动添加“DynamoDB服务前缀列表 → 网关端点”的路由。
- EC2接口端点提供对EC2 API的私有连接，不为实例发出的全部AWS服务请求统一提供出口。

| 原选项 | 判题依据 |
| --- | --- |
| A：为端点创建路由表条目 | 有关的确是网关端点路由，但官方操作是关联路由表，由AWS自动添加条目。不能教成必须另手工创建一条路由。 |
| B：创建DynamoDB网关端点 | 满足所需的服务访问路径。 |
| C：创建EC2接口端点 | 连接的服务API与DynamoDB调用不匹配。 |
| D：为端点在每个子网创建ENI | 描述接口端点一类的机制，不是本方案网关端点的必要操作。 |
| E：修改端点安全组 | 本方案用路由表接入网关端点，不采用接口端点的ENI安全组接入方式。 |

**结论：** 技术实现是“DynamoDB网关端点＋关联相关路由表”。A、B可以按配置结果理解为原题的组合；若A被解释为必须独立手工创建路由，措辞不准确。保留该限制。DynamoDB也支持接口端点，不能从本题推出“DynamoDB只支持网关端点”。

**学完应能做到：** 画清“EC2中的程序 → DynamoDB”的请求去向，说明网关端点怎样被这次请求使用，而非只认出一个端点名称。

**官方依据：** [Gateway endpoints及自动路由](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html)、[DynamoDB端点](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-ddb.html)、[EC2接口端点的API范围](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/interface-vpc-endpoints.html)。摘录N08/N09/N11/N18。

## 3．Q324：完整数据要留在本地，stored就一定是答案吗？

**原题任务：** 现有本地文件服务器使用iSCSI卷，单个文件存储卷描述为数百TB。需要灾备、用户继续在本地即时访问所有文件，并尽量少改基础设施。

**核心考点：** 同时判断数据主存位置、访问协议和容量是否符合要求。选中一种架构后，还必须核对它能否容纳题目中的数据。

**决定性条件：** “所有数据本地低延迟”“保留iSCSI方式”“最少改动”，以及不能遗漏的“数百TB单卷”。题干的“无延迟”按避免云端回源等待理解，不解释为物理零延迟。

**必须掌握的知识：**

- stored volumes把主数据完整留在本地，经iSCSI访问，并异步备份为EBS快照；cached volumes以S3为主存，只在本地缓存部分数据，未命中需要云端读取。
- 已有官方配额为stored单卷最大16 TiB、每网关最多32卷及总计512 TiB。总容量上限不能替代单卷上限。
- Tape Gateway用于备份归档。给现有卷增加磁带备份，并不意味着用户日常必须改为从磁带读取。

| 原选项 | 判题依据 |
| --- | --- |
| A：S3 File Gateway、10 TB缓存、应用改NFS | 明确引入访问协议改动；部分缓存不能保证所有数据都在本地读取。 |
| B：原数据做虚拟磁带备份 | 不能用“磁带读取慢”直接排除：原工作卷仍保留，可继续供用户访问。恢复步骤、额外备份软件和最少改动比较仍需核实；本次不将B认证为完整可行方案。 |
| C：cached volume、10 TB缓存 | iSCSI保留，但缓存未命中仍需回源；单个cached volume的32 TiB上限也与数百TB单卷不匹配。 |
| D：同容量stored volume | 数据位置和协议方向匹配；按单个数百TB卷的字面描述，超过stored单卷16 TiB配额。不能用多卷总额掩盖。 |

**结论：** 不能将D登记为原题的无条件正确答案，也没有足够依据认证唯一解。D符合一部分架构意图，容量限制未满足；B的日常读取路径又不能被错误理由排除。保留题源矛盾与待核事项。

**学完应能做到：** 在容量适用的情形下解释stored与cached的取舍，同时识别“方向正确、具体规格不成立”的方案。若另写容量符合配额的教学场景，须明确它与原题不同。

**官方依据：** [Volume Gateway两种架构](https://docs.aws.amazon.com/storagegateway/latest/vgw/StorageGatewayConcepts.html)、[Volume Gateway配额](https://docs.aws.amazon.com/storagegateway/latest/vgw/resource-gateway-limits.html)、[Tape Gateway用途](https://docs.aws.amazon.com/storagegateway/latest/tgw/StorageGatewayConcepts.html)、[File Gateway文件协议及缓存](https://docs.aws.amazon.com/filegateway/latest/files3/what-is-file-s3.html)。摘录E01–E04/E06。

## 4．Q456：跨区域EC2备份，何时优先集中式备份服务？

**原题任务：** 将一个Region中的EC2备份到第二个Region；还希望在第二Region provision EC2 resources，并从一个AWS账户centrally manage EC2 instances；要求最具成本效益。

**核心考点：** 区分跨区域备份恢复、常驻备用计算与单独复制磁盘数据；检查所选服务实际承担了哪些管理职责。

**决定性条件：** 要跨区域备份和集中管理，未给出必须常驻同规模实例或明确RTO。保留题干对“provision/manage EC2”的原始表述，不能直接改成“集中管理备份”。

**必须掌握的知识：**

- AWS Backup可以集中设置备份策略，并按计划跨Region复制备份。
- 恢复EC2时，AWS Backup会创建AMI、实例及相关EBS卷等资源；它不等于完整的跨Region基础设施编排或EC2日常运维管理服务，且不备份恢复EC2 user-data。
- 备份恢复方案需要在恢复时重新部署相关基础设施、配置和应用；保存备份不代表已经具备常驻接管能力。

| 原选项 | 判题依据 |
| --- | --- |
| A：第二Region保留相似数量EC2并复制数据 | 引入常驻计算；题目未给出要求这项投入的恢复时间目标，也未交代集中管理办法。 |
| B：周期复制EBS快照 | 提供磁盘备份的一部分；未完整描述EC2恢复配置和集中管理流程。不能把“EBS快照”直接等同于“完整EC2恢复方案”。 |
| C：AWS Backup计划＋跨Region复制 | 最贴合集中备份与EC2恢复这一解读。其能力不能被扩大为管理所有EC2资源生命周期。 |
| D：同规模EC2＋DataSync | 常驻计算和数据传输本身没有给出集中EC2备份恢复方案；也缺少足够理由承担同规模备用计算。 |

**结论：** 若provision/manage指备份恢复语境中的EC2恢复及其集中备份管理，C是有依据的优选。若指完整资源编排和日常实例管理，C单独不足以证明全部满足。题干无用量、价格和RTO，不能据本分析承诺绝对最低账单或恢复时长。

**学完应能做到：** 说明为什么此类需求优先考虑集中式备份恢复，同时识别它与常驻容灾、完整实例运维的职责边界。

**官方依据：** [AWS Backup的集中备份范围](https://docs.aws.amazon.com/aws-backup/latest/devguide/whatisbackup.html)、[跨Region复制](https://docs.aws.amazon.com/aws-backup/latest/devguide/cross-region-backup.html)、[EC2恢复会创建什么](https://docs.aws.amazon.com/aws-backup/latest/devguide/restoring-ec2.html)、[灾备中的基础设施重部署](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html)。摘录B01/B02/B10/B11/B12；DataSync仅按已有官方E21记录的传输用途理解，不展开收费或完整服务能力。

## 5．Q508：每天自动备份，为什么还不等于跨区域灾备已经做好？

**原题任务：** Windows EC2位于us-west-1；发生区域灾难时需在us-west-2快速恢复，数据丢失不超过24小时，备份自动化，管理工作最少。选择两种解决方案。

**核心考点：** 将恢复点时效和区域故障要求同时落实到“定时生成备份＋自动把可用副本送到目标Region”。比较两条原生自动化路线。

**决定性条件：** 灾难可能使源Region不可用，不能等灾后才按需复制；需要检查目标Region中的恢复点，而不仅是源Region的备份频率。

**必须掌握的知识：**

- Data Lifecycle Manager的EBS-backed AMI策略可按标签选择资源、定时创建AMI并配置跨Region复制。
- AWS Backup也可按标签分配资源，按计划备份并原生跨Region复制；本题不需要额外自建Lambda复制任务。
- “一天两次”描述备份计划，不是目标Region中恢复点年龄的硬保证。实际数据丢失窗口还受作业成功、启动窗口、复制耗时等影响；“快速恢复”也没有给出可验收的具体RTO。

| 原选项 | 判题依据 |
| --- | --- |
| A：一天两次AMI，按需复制 | 复制未自动化，不能据此保证区域灾难前目标Region已有近期副本。 |
| B：一天两次AMI，配置自动复制到us-west-2 | 原生自动创建与跨Region复制路线。原题的“EC2-backed AMI”按对应官方机制理解为EBS-backed AMI，保留术语差异。 |
| C：AWS Backup＋定时Lambda复制 | 引入自建任务的开发与维护；AWS Backup已有原生复制能力，管理工作更多。 |
| D：AWS Backup计划，一天两次并指定us-west-2为复制目的地 | 原生备份计划与跨Region复制路线。 |
| E：一天两次AWS Backup，按需复制 | 与A一样，未落实自动跨Region复制。 |

**结论：** 在方案能力和最低管理工作这一层面，B、D各自是一条可选路线，不是要求同时部署两套。两项原生能力有依据；仅凭选项文字还不能认证每个时刻均满足24小时实际RPO或某个恢复时长。实施须检查目标Region最新成功恢复点的年龄及恢复演练。

**学完应能做到：** 解释“备份频率”“异地副本是否可用”“恢复要多久”分别影响什么，并识别原生自动复制为何优于按需或自建复制流程。

Windows是本题背景；题目未要求应用一致性，不因此追加VSS等独立必背内容。

**官方依据：** [DLM AMI策略、标签、计划与跨Region复制](https://docs.aws.amazon.com/ebs/latest/userguide/ami-policy.html)、[AWS Backup资源分配](https://docs.aws.amazon.com/aws-backup/latest/devguide/assigning-resources.html)、[Backup跨Region复制](https://docs.aws.amazon.com/aws-backup/latest/devguide/cross-region-backup.html)、[AMI复制完成时间](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/CopyingAMIs.html)。摘录B02–B06/B08/B09。

## 这5题对后续制卡的实际输入

| 原题 | 学习者需要掌握的判断 | 进入制作前保留的限制 |
| --- | --- | --- |
| Q282 | 通过目标端来源规则限制绕过上游的访问 | 所有关联安全组及原题全部入站来源范围；不是只检查Web端口 |
| Q562 | 为实际被访问的服务选择私有路径，并关联相关路由表 | A的自动路由措辞；DynamoDB也支持接口端点 |
| Q324 | 用主数据位置、协议与单卷容量一起检验存储方案 | 不认证唯一答案；不错误排除仍保留本地工作卷的备份方案 |
| Q456 | 按管理职责和恢复目标比较集中备份与备用计算 | 集中备份管理不等于完整EC2编排运维；成本及RTO未定量 |
| Q508 | 检查目标Region是否持续拥有近期可恢复副本 | 计划频率不等于实际RPO，选择两条替代路线不等于两套都部署 |

Q456与Q508可共享“原生跨Region备份复制”知识；各自的判断重点仍须保留。卡数、难度、是否需要先修卡，留到这些分析经核对和试读后决定。本轮没有将表中每一行或每个知识句强制拆成卡。

## 来源与核对范围

原题全文和全部22个选项来自规范源；未使用印刷答案或社区投票判定事实，未读取旧347卡或当前卡片正文作为知识源。AWS依据复用2026-11-03保存的官方页面快照。

本次私有资料目录：`/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/question-exam-analysis5-20261104/`。保留questions.json、official-evidence.json及独立核对记录。原题、原需求索引与原蓝图均未覆盖。

“分析核对通过”仅表示考点提炼、选项解释与不确定性记录达到本轮要求，不表示学习者已学会、记住，亦不升级旧原题账本或题卡覆盖。
