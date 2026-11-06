# 两张短卡试读：一条访问路径，一项来源限制

状态：教学小样，已生成；独立核查已通过，学习者效果待测试。无正式UID，不计入15张正式接受卡。

分类直接采用现有四领域及任务：本组同属领域1安全架构，卡片主归按其实际教学判断确定；同一知识供其他领域引用时不复制卡片。原题分类、全库目标主归均未改。

| 小样 | 主归任务 | 交叉引用 | 训练内容 |
| --- | --- | --- | --- |
| C1 | 1.2 设计安全工作负载与应用 | — | 怎样建立EC2到S3的访问路径 |
| C2 | 1.3 确定适当的数据安全控制 | 1.2 | 怎样让桶拒绝其他请求来源 |

主归是本次两张试读卡的教学处置，不是批量重分类。两张均为Rare，类型不规定配额。

## C1．S3私网访问路径

**问：** VPC内的EC2要访问同Region的S3，流量不能经过互联网网关或NAT。请给出一种合适的访问方案。

**答：** 创建S3网关端点，并关联EC2所在子网使用的路由表。

**考点：** 路由表把发往S3的请求送到端点，因此这段访问不需要互联网网关或NAT。

**易错提醒：** IAM权限决定能否访问数据，不能替代这条网络路径。

**Question:** EC2 instances in a VPC need to access S3 in the same Region without using an internet gateway or NAT. Give one suitable access solution.

**Answer:** Create an S3 gateway endpoint and associate the route table used by the EC2 subnet.

**Key point:** The route table sends S3 requests to the endpoint, so this access requires neither an internet gateway nor NAT.

**Watch out:** IAM permissions determine whether data access is authorized; they do not provide this network path.

依据：[AWS 1](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html) · [AWS 2](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html)

## C2．S3请求来源限制

**问：** 到S3的私网路径已建好。现在要求桶只接受经过指定VPC端点的请求，应怎样限制？

**答：** 在桶策略中用aws:SourceVpce（请求经过的端点ID），显式拒绝其他来源的请求。

**考点：** 端点提供访问路径；桶策略检查请求来源，才能把其他路径的请求挡在桶外。

**易错提醒：** 来源限制不会自动授予读写权限，正常的数据访问授权仍需满足。

**Question:** The private path to S3 is already in place. The bucket must now accept requests only through a specified VPC endpoint. How should you enforce this?

**Answer:** Use aws:SourceVpce, the endpoint ID through which the request passes, in the bucket policy to explicitly deny requests from other sources.

**Key point:** The endpoint provides an access path; the bucket policy checks the request source and blocks requests using other paths.

**Watch out:** A source restriction does not grant read or write permissions; normal data-access authorization must still be satisfied.

依据：[AWS 1](https://docs.aws.amazon.com/AmazonS3/latest/userguide/example-bucket-policies-vpc-endpoint.html) · [AWS 2](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html)

## 与原题的关系

| 原题 | 本组帮助做什么 | 支撑范围 |
| --- | --- | --- |
| Q4、Q91、Q480 | 选择EC2到S3的端点访问路径 | C1可直接用于这些题的方案选择；三题共享同一规则，重复验证不等于三次独立学习效果证明 |
| Q612 | 同时检查端点路径和桶策略 | C1＋C2支持题面中的端点方案；题面未要求排他来源，C2的显式拒绝是更强的来源限制示例，不作为该题额外必答 |
| Q92 | 路径与访问许可需要分别处理 | 部分支撑；只限制端点不能证明仅应用层身份可访问 |
| Q710 | 桶策略不会自行创建网络路径 | 部分支撑；原选项缺少端点接入前提，不认证无条件整题答案 |

Q998的“不使用public endpoint”与网关端点仍使用S3公共服务端点存在措辞冲突，未拿来凑覆盖。Q208涉及接口端点和网关端点配置差异，本组未教完，不计整题支撑。网关端点是一种方案，S3也支持接口端点。

这些是当前卡文与原题之间的设计核对；尚无学习者作答或隔日记忆结果，不计入正式0/50题卡覆盖。原题对“互联网”的措辞不被扩写成“经NAT访问S3必然离开AWS网络”。

## 试读方式

先读中文卡面，再关闭卡片做配套小测，写下选择及一条决定理由；不会的地方标明“不理解哪个词／不知如何应用”。测试没有在题面标答案。英文保留同等技术含义，试读时可先不展开。题目正确率、解释能力与隔日回忆分别记录。

本轮复用既有考点与官方语料，不重新抽取原题；没有派正式作者CLI、恢复自动化、发布或OTA。小样使用当前原生作者通道，token用量unknown。准备阶段未完整计时；阶段账本只计开始保存输入之后的可观测时段，不作本轮总耗时。
