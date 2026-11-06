# 领域1第二批：网络路径与访问控制

7张双语卡（1 Easy、6 Rare）全部通过独立事实／教学设计复核及真实解析器导入回读，尚未发布。

## 1．VPC：能到达与允许访问 / Routing and access · Easy

**问：** 同一VPC中，应用和数据库位于不同子网。默认local路由负责什么？不单列应用子网的路由，就能禁止应用访问数据库吗，为什么？

**答：** local路由负责VPC内部的路径；不单列应用子网路由，不能据此认定它已被隔离。

**考点：** 默认local路由覆盖VPC的地址范围，已经包含其中各子网。它按目的地址选路；允许哪些服务器访问数据库，要由数据库的安全组等访问规则限制。

**Question：** Within one VPC, an application and a database are in different subnets. What does the default local route provide? Does omitting a separate application-subnet route block the application from the database? Why?

**Answer：** The local route provides paths within the VPC. Omitting a separate application-subnet route does not establish isolation.

**Key point：** The default local route covers the VPC address range, including its subnets. It routes by destination address; rules such as the database’s security group control which servers may access the database.

## 2．VPC Peering：直接互联 / Direct VPC connectivity · Rare

**问：** 两个地址不重叠的VPC只需私网直连，没有集中检查或中转需求。选VPC peering，还是新建运行EC2路由设备的Transit VPC，更省成本，为什么？

**答：** 选择VPC peering。

**考点：** peering直接连接两个VPC；这里不需要另建Transit VPC中的EC2中转设备，因此避免了这些设备的运行与维护成本。

**易错提醒：** peering连接的是两个VPC；同一VPC里的两个子网不需要先建立peering。

**Question：** Two VPCs with non-overlapping address ranges only need direct private connectivity, with no centralized inspection or transit requirement. Is VPC peering or a new Transit VPC running EC2 routing appliances more cost-effective? Why?

**Answer：** Choose VPC peering.

**Key point：** Peering directly connects the two VPCs. This case does not require EC2 transit appliances in another VPC, avoiding their running and management costs.

**Watch out：** Peering connects two VPCs. Two subnets in the same VPC do not first need a peering connection.

## 3．VPC Peering：两侧路由 / Routes on both sides · Rare

**问：** 两个VPC的peering已经Active，相关安全组也已允许通信。只在应用VPC配置到数据库VPC的路由，能保证请求和响应往返吗？还要给哪边配置什么，为什么？

**答：** 不能。还要在数据库VPC参与通信的子网路由表中，加入到应用VPC地址范围、下一跳为这条peering的路由。

**考点：** 请求要找到数据库，响应也要找到应用。peering不会自动替双方添加对端路由，需要两侧参与通信的路由表都有相应路径。

**Question：** Two VPCs have active peering, and the relevant security groups allow communication. Does adding a route only in the application VPC guarantee a request-response path to the database VPC? What is still needed, and why?

**Answer：** No. The database VPC’s participating subnet route tables also need a route to the application VPC’s address range, targeting that peering connection.

**Key point：** The request needs a path to the database, and the response needs a path back to the application. Peering does not automatically add peer routes; participating route tables on both sides need them.

## 4．VPC Peering：同Region来源 / Same-Region peer sources · Rare

**问：** 同Region的App VPC与Cache VPC已建立Active peering，路由已配置。缓存只允许应用服务器访问。应该在哪个资源的安全组写入站规则，来源能直接引用应用安全组吗？

**答：** 在缓存的安全组写入站规则；同Region对等VPC间，可以把应用专用安全组设为来源。

**考点：** 路径已经通了，缓存仍要决定接收谁的连接。规则写在接收请求的缓存安全组上；peering不会替资源自动放行访问。

**Question：** An App VPC and a Cache VPC in the same Region have active peering and configured routes. Only the application servers should access the cache. Whose security group needs an inbound rule, and can its source reference the application security group?

**Answer：** Add the inbound rule to the cache’s security group. Same-Region peer VPCs can reference the application’s dedicated security group as the source.

**Key point：** Even with a path available, the cache must allow the caller. The rule belongs to the receiving cache’s security group; peering does not automatically allow access to resources.

## 5．VPC Peering：跨Region来源 / Cross-Region peer sources · Rare

**问：** 应用与数据库在不同Region，通过VPC peering通信，双方路由已配置。数据库入站来源能直接填远端应用安全组ID吗？应该用什么，为什么？

**答：** 不能。应在数据库安全组中允许应用服务器的私有IP或适当收窄的CIDR地址范围。

**考点：** 跨Region peering可以提供网络路径，但不支持引用另一Region的安全组。网络能互通，不代表安全组ID也能跨Region引用。

**易错提醒：** 修改接收请求的数据库入站规则；只修改应用的入站规则，不能代替数据库放行。

**Question：** An application and a database are in different Regions, connected by VPC peering with routes configured on both sides. Can the database’s inbound source directly reference the remote application security group ID? What should it use, and why?

**Answer：** No. In the database security group, allow the application servers’ private IP addresses or an appropriately restricted CIDR range.

**Key point：** Inter-Region peering provides a network path but does not support referencing a security group in another Region. Network reachability does not extend security-group ID references across Regions.

**Watch out：** Update the receiving database’s inbound rules. Changing only the application’s inbound rules does not allow access at the database.

## 6．网络ACL：拦截原始客户端 / Blocking original clients · Rare

**问：** 流量是访客→公网ALB→私有EC2。少量公网IP正在发送大量恶意请求，要立即在网络层按这些原始IP拒绝。入站Deny应放在ALB公有子网，还是后端私有子网的网络ACL上，为什么？

**答：** 放在ALB所在公有子网的网络ACL上。

**考点：** 客户端先连接ALB，ALB再连接后端。后端收到的网络连接来自ALB，因此在后端子网按原始客户端IP拦截，会错过这些已转发的连接。

**易错提醒：** 把Deny放在可能匹配的宽Allow之前：网络ACL按规则号从小到大，第一条匹配即生效。

**Question：** Traffic flows from a visitor to an internet-facing ALB and then to private EC2 instances. A few public IPs are sending many malicious requests. To immediately deny those original IPs at the network layer, should the inbound deny be in the ALB’s public-subnet NACL or the backend’s private-subnet NACL? Why?

**Answer：** Use the network ACL on the ALB’s public subnets.

**Key point：** The client connects to the ALB, which makes a separate connection to the backend. Backend network connections come from the ALB, so filtering the original client IPs at the backend subnet misses those forwarded connections.

**Watch out：** Place the deny before any matching broad allow: NACL rules are evaluated in ascending rule-number order, and the first match applies.

## 7．NAT：私有实例出网 / Private-instance internet access · Rare

**问：** 私有子网的EC2要通过NAT访问IPv4互联网。应该选public还是private NAT gateway，放在公有还是私有子网，为什么？

**答：** 选择public NAT gateway，放在同VPC的公有子网。

**考点：** public NAT关联Elastic IP，通过VPC的Internet Gateway访问互联网。private NAT不能靠路由到Internet Gateway来访问互联网，这类流量会被丢弃。

**易错提醒：** EC2所在私有子网的互联网路由应指向NAT；路径是私有EC2→public NAT→Internet Gateway。

**Question：** EC2 instances in private subnets need IPv4 internet access through NAT. Should the NAT gateway be public or private, and should it be in a public or private subnet? Why?

**Answer：** Use a public NAT gateway in a public subnet of the same VPC.

**Key point：** A public NAT gateway has an Elastic IP and accesses the internet through the VPC’s internet gateway. Routing a private NAT gateway to an internet gateway does not provide internet access; that traffic is dropped.

**Watch out：** The private EC2 subnet’s internet route should target the NAT: private EC2 → public NAT → internet gateway.


## 本组原题支撑

| 原题 | 当前判题支撑 | 保留缺口 |
| --- | --- | --- |
| Q55 | 充分 | 无已确认的必要判题缺口 |
| Q262 | 充分 | 无已确认的必要判题缺口 |
| Q510 | 部分 | C的peering、双方路由及数据库按应用IP授权已有卡面支撑；D的跨Region Transit Gateway安全组引用条件仍需定向官方证据及必要教学，当前不宣称C已获唯一选项支撑。原文C的“VPUpdate”连字保留，不凭该排版问题排除。 |
| Q509 | 充分 | 无已确认的必要判题缺口 |
| Q708 | 充分 | 无已确认的必要判题缺口 |

Q55此前的路由和peering缺口已由本批卡＋上一批来源授权卡闭合。Q510能解释C和排除A/B，但尚未教TGW跨Region安全组引用边界，不能声称完整排除D。

两批共12张网络主题卡，累计核对9道唯一题：8题设计判题支撑充分、Q510部分。领域1其余题尚未完成本轮制作；这不是学习者记忆或正确率的测量。

核查：本批7卡全部七项PASS、2项条件迁移PASS，无阻断finding及内容返修；20个原选项、9项原判断均有当前去向。真实Deck Linter与解析回读通过。

[Deck导入文件](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch02-20261105/deliverables/cards.deck.md) · [双语JSON](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch02-20261105/deliverables/cards.json) · [本组题目支撑](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch02-20261105/question-support.json) · [两批逐题汇总](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch02-20261105/question-support.cumulative.json)

官方依据包括：[默认local路由](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html)、[VPC peering与双方路由](https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-basics.html)、[对等VPC安全组引用范围](https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-security-groups.html)、[Transit VPC成本](https://docs.aws.amazon.com/whitepapers/latest/building-scalable-secure-multi-vpc-network-infrastructure/transit-vpc-solution.html)、[ALB与客户端IP](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/x-forwarded-headers.html)、[NAT类型](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html)。官方原句、版本及定位保留在私有输入，不进入学习正文。

全程约40.1分钟（平均5.7分钟/张），其中初稿约10.1分钟。总计时包括iCloud占位文件的读取超时与恢复、官方资料补证、独立复核、封装及索引刷新；未准确隔离纯外部等待，不将本批总时长当作稳定生产速度。新CLI作者调用0，native token未知；没有重置原时钟。
