# 领域1第三批：S3私网路径与跨Region来源授权

本次新增5张、修订1张。导入包另含4张未变先修（相同UID，不计新增），共10条；当前共32张接受卡、44个历史唯一UID。独立复核与真实导入回读已通过，尚未发布。

## 1．跨Region网络：SG引用 / Cross-Region SG references · Rare

**问：** 应用和数据库位于不同Region，已有私网连接，双方路由已配置。数据库入站来源能直接填远端应用安全组ID吗？应该用什么，为什么？

**答：** 不能。应在数据库安全组中允许应用服务器的私有IP或适当收窄的CIDR地址范围。

**考点：** 跨Region网络互通不会让远端安全组ID变成可引用的来源。VPC peering不支持跨Region引用；换成Transit Gateway对等连接也不支持安全组引用。

**易错提醒：** 修改接收请求的数据库入站规则；只修改应用的入站规则，不能代替数据库放行。

**Question：** An application and a database are in different Regions, with a private connection and routes configured on both sides. Can the database’s inbound source directly use the remote application security group ID? What should it use, and why?

**Answer：** No. In the database security group, allow the application servers’ private IP addresses or an appropriately restricted CIDR range.

**Key point：** Cross-Region network reachability does not make the remote security group ID a valid source reference. VPC peering does not support inter-Region group references, and transit gateway peering connections do not support security-group referencing either.

**Watch out：** Update the receiving database’s inbound rules. Changing only the application’s inbound rules does not allow access at the database.

## 2．S3：绕开NAT / Bypass NAT for S3 · Easy

**问：** VPC私有子网里的应用要上传文件到同Region的S3，现有NAT已经拥堵。S3 gateway endpoint能怎样改变这条请求路径？

**答：** 把发往S3的请求通过网关端点送到S3，不再交给NAT。

**考点：** 应用仍调用S3 API；改变的是网络路径。关联的路由表把S3流量送往网关端点，这条路径不需要Internet Gateway或NAT。

**Question：** An application in private VPC subnets uploads files to S3 in the same Region, but its NAT is congested. How can an S3 gateway endpoint change that request path?

**Answer：** Send S3 requests through the gateway endpoint instead of the NAT.

**Key point：** The application still calls the S3 API; the network path changes. Associated route tables send S3 traffic to the gateway endpoint, without requiring an internet gateway or NAT.

## 3．S3：关联调用方路由表 / Associate caller route tables · Rare

**问：** 两个私有子网各用不同的路由表，应用都要通过同Region的S3网关端点访问S3。只创建端点、只关联其中一个子网的路由表，两个子网都会改走端点吗？应该关联哪些表，为什么？

**答：** 不会。应关联两个调用方子网实际使用的路由表。

**考点：** 关联后，AWS自动加入“目的地为S3地址列表、目标为网关端点”的路由。没关联的子网不会因为同属一个VPC就自动使用这个端点。

**易错提醒：** S3端点路由比通往NAT的0.0.0.0/0更具体，通常无需删除其他互联网流量的默认路由。

**Question：** Two private subnets use different route tables, and applications in both must use an S3 gateway endpoint in the same Region. If the endpoint is created but associated with only one subnet’s route table, do both subnets switch to it? Which tables should be associated, and why?

**Answer：** No. Associate the route tables actually used by both caller subnets.

**Key point：** AWS adds a route whose destination is the S3 service prefix list and whose target is the gateway endpoint. A subnet does not automatically use that endpoint merely because it is in the same VPC.

**Watch out：** The S3 endpoint route is more specific than a 0.0.0.0/0 route to NAT, so the default route for other internet traffic usually need not be removed.

## 4．S3：端点选型与成本 / Endpoint choice and cost · Rare

**问：** 应用只需从自己的VPC访问同Region的S3，不需要从本地机房或其他网络通过这个端点接入。gateway和interface端点都可实现私有访问，最小化端点费用应选谁，为什么？

**答：** 选择S3 gateway endpoint。

**考点：** gateway endpoint没有额外使用费，S3 interface endpoint需要付费。S3请求改走网关端点后，也避开了这段NAT的数据处理费。

**Question：** An application only needs to access S3 in the same Region from its own VPC; it does not need on-premises or other-network access through this endpoint. Both gateway and interface endpoints can provide private access. Which minimizes endpoint charges, and why?

**Answer：** Choose an S3 gateway endpoint.

**Key point：** Gateway endpoints have no additional usage charge, while S3 interface endpoints are charged. Sending S3 requests through a gateway endpoint also avoids NAT data-processing charges for that traffic.

## 5．S3：权限与路径 / Permissions and network path · Rare

**问：** 应用目前经NAT和Internet Gateway调用S3。只把bucket policy改成允许该NAT的Elastic IP，就会让请求改走VPC端点吗，为什么？

**答：** 不会。桶策略限制谁有权访问，不会替应用创建端点或修改路由。

**考点：** 请求是否获准与数据包走哪条路是两件事。要改用S3网关端点路径，需要配置端点并关联应用子网的路由表；只改权限条件，原网络路径仍不变。

**Question：** An application currently calls S3 through a NAT and an internet gateway. If its bucket policy is changed to allow the NAT’s Elastic IP, does the request switch to a VPC endpoint? Why?

**Answer：** No. A bucket policy limits access permission; it does not create an endpoint or change the application’s routes.

**Key point：** Whether a request is permitted and which network path it takes are different questions. An S3 gateway-endpoint path requires an endpoint and associated application-subnet route tables; changing only a permission condition leaves the network path unchanged.

## 6．VPC互联与服务端点 / VPC links and service endpoints · Rare

**问：** 两个账户的VPC地址不重叠，一台EC2要用私有IP访问另一VPC的EC2文件服务器，并希望互通连接不引入中转设备单点或带宽瓶颈。应使用VPC peering还是gateway endpoint，为什么？

**答：** 使用VPC peering，并配置所需路由和资源访问权限。

**考点：** peering连接两个VPC，不依赖单独的中转设备；gateway endpoint提供到S3或DynamoDB的服务路径，不能把它当成另一VPC里EC2文件服务器的入口。

**Question：** VPCs in two accounts have non-overlapping address ranges. One EC2 instance must access a file server on EC2 in the other VPC by private IP, without adding a transit-appliance single point of failure or bandwidth bottleneck. Should it use VPC peering or a gateway endpoint? Why?

**Answer：** Use VPC peering, with the required routes and resource-access permissions.

**Key point：** Peering connects the two VPCs without relying on a separate transit appliance. A gateway endpoint provides a service path to S3 or DynamoDB, not an entry to an EC2 file server in another VPC.


## 本批题目支撑

| 原题 | 正确方案方向 | 完整判题支撑 | 保留限制 |
| --- | --- | --- | --- |
| Q510 | C | 充分 | 无已确认必要缺口 |
| Q237 | A | 部分 | 确认两VPC地址不重叠；补足C/D不构成所述两VPC完整互联方案的最小机制依据，无须展开VPN或Direct Connect全课程。 |
| Q471 | C | 部分 | 同Region前提未由原题确认；A/B与端点路径的最小职责区别尚未由当前正文教会。 |
| Q839 | C | 部分 | 保留未确认的S3同Region条件；补足TGW attachment本身不提供S3服务入口的最小已教依据，不要求TGW部署清单。 |
| Q860 | A | 部分 | 原题未确认S3同Region，故整体保持partial；未教B/D之间精确跨AZ成本排序，不将其列为选A的必要背诵项，也不声称NAT到S3物理流量必定离开AWS骨干网。 |
| Q1016 | B | 部分 | S3同Region前提未确认，保留partial；不把NAT/IGW公共服务端点路径等同于物理流量必定离开AWS骨干网。 |

Q510此前未教的Transit Gateway peering安全组引用限制已补齐。其余5题的卡片可解释相应正确动作，但原题未确认的同Region、地址不重叠及部分竞争方案职责边界仍保留，不能当完整覆盖。

三批共17张当前网络主题卡，累计核对14题：9题设计支撑充分、5题部分。学习者实际理解、记忆与正确率尚未测试。

一次修正：路由表题面补明两个子网使用不同路由表，避免共用表时答案相反。只复核该卡及依赖它的桶策略卡；其余8条有效版本未重审。旧FAIL、稳定finding B03-S1-001与闭合证据均保留。

[本批Deck导入文件（含4旧先修）](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch03-20261105/deliverables/cards.deck.md) · [双语JSON](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch03-20261105/deliverables/cards.json) · [逐题证据](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch03-20261105/question-support.current.json) · [三批汇总](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch03-20261105/question-support.cumulative.json)

官方依据：[TGW安全组引用限制](https://docs.aws.amazon.com/vpc/latest/tgw/tgw-vpc-attachments.html)、[S3网关端点](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html)、[网关端点路由](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html)、[绕开NAT处理费的路由](https://docs.aws.amazon.com/vpc/latest/userguide/route-table-options.html)、[桶策略的权限职责](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-policies.html)、[VPC peering用途](https://docs.aws.amazon.com/vpc/latest/peering/what-is-vpc-peering.html)。原句和精确版本保留在私有输入。

全流程约26.5分钟；首轮草稿约6.6分钟。新增5张、修订1张，复用4张不计入新增吞吐。总计时包含补证、独立检查、一次前提修正、导出和索引刷新，未达到1分钟/张。新CLI调用0，native token未知。
