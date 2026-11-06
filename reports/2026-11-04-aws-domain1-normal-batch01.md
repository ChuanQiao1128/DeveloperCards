# 领域1首批正常制作：5张双语卡

采用已确认的“正确方案理由→共享判断→短卡→回原题”写法。前3张由试验稿转成正式版本，后2张补出站和网络ACL来源表达；不重复制作两跳背诵卡。5张均按实际学习任务归为Rare。

# 5张AWS双语卡片

## 1．安全组：允许哪些服务器 / Allowed servers · Rare

**问：** 数据库只允许Web服务器访问，同一子网还有其他业务服务器。在同VPC直接通信的前提下，应该在谁的安全组里允许谁，为什么不能直接允许整个子网？

**答：** 在数据库的安全组里，把允许来源设为Web服务器的专用安全组。

**考点：** 安全组规定资源允许哪些网络连接。数据库是接收方；只关联Web服务器的组，代表这批允许访问的服务器。整个子网还包含其他业务服务器，范围更大。

**易错提醒：** 数据库关联的其他安全组若仍允许别的来源，也要一起修改；新增窄规则不会取消那些允许。

**Question：** A database must be accessible only to web servers, but their subnet also contains servers for other workloads. Assuming direct communication within one VPC, whose security group should allow which source, and why is allowing the entire subnet insufficient?

**Answer：** In the database’s security group, set the allowed source to the web servers’ dedicated security group.

**Key point：** A security group specifies which network connections a resource allows. The database is the receiver. A group associated only with the web servers identifies this set of permitted servers; the entire subnet also includes other workload servers and is broader.

**Watch out：** If another security group attached to the database still allows other sources, change those rules too. Adding a narrow rule does not cancel those permissions.

## 2．安全组：多个组同时允许 / Combined permissions · Rare

**问：** EC2同时关联两个安全组：一个只允许负载均衡器发起连接，另一个允许所有来源。现在EC2的安全组能挡住其他来源的新连接吗，为什么？

**答：** 不能。另一个安全组仍允许其他来源。

**考点：** 安全组只有Allow规则，没有Deny规则。多个组的允许一起生效：只要某个组仍允许这些来源，它们就能通过安全组检查；另一个组更严格，不会取消这项允许。

**Question：** EC2 has two attached security groups: one allows connections only from the load balancer, while the other allows all sources. Do its security groups now block new connections from other sources? Why?

**Answer：** No. The other security group still allows those sources.

**Key point：** Security groups have allow rules only, with no deny rules. Permissions from attached groups work together: if one group still allows those sources, they can pass the security-group check; stricter rules in another group do not cancel that permission.

## 3．安全组：网站与数据库 / Web and database · Rare

**问：** Web服务器要让任意IPv4访客访问HTTPS（TCP 443），数据库只供Web访问（TCP 3306）。两者同VPC直接通信、各用专用安全组。它们的入站来源应该分别允许谁，为什么？

**答：** Web的443入口允许0.0.0.0/0；数据库的3306入口只允许Web服务器的安全组。

**考点：** 0.0.0.0/0表示所有IPv4地址，符合网站让任意访客访问的要求。数据库的访问者则只有Web服务器，所以按Web这批服务器放行。

**Question：** Web servers must accept HTTPS on TCP 443 from any IPv4 visitor; a database is for Web only on TCP 3306. They communicate directly within one VPC and use dedicated security groups. Which inbound source should each allow, and why?

**Answer：** Allow 0.0.0.0/0 at Web’s port-443 entry. At the database’s port-3306 entry, allow only the web servers’ security group.

**Key point：** 0.0.0.0/0 means all IPv4 addresses, matching a website open to any visitor. The database’s callers are only the web servers, so access is limited to that set of servers.

## 4．安全组：发出的连接 / Outbound connections · Rare

**问：** Web只能主动连接同VPC里的数据库服务器，使用TCP 3306。两者直接通信、各用专用安全组。应在谁的哪类规则里限制目的地，填什么，为什么？

**答：** 在Web安全组的出站规则中，目的地填数据库安全组ID，允许TCP 3306。

**考点：** 请求从Web发出，所以Web的出站规则决定它可以连接谁。数据库专用组按服务器成员关系放行；VPC或子网CIDR按地址范围放行，不会按数据库组的成员关系筛选。

**易错提醒：** 这里填写安全组ID，不能把EC2实例ID当成安全组规则的来源或目的地。

**Question：** Web may initiate TCP 3306 connections only to database servers in the same VPC. They communicate directly and use dedicated security groups. Whose rules, in which direction, should restrict the destination? What should you enter, and why?

**Answer：** In Web’s security-group outbound rules, use the database security group ID as the destination and allow TCP 3306.

**Key point：** The request leaves Web, so Web’s outbound rules determine whom it may connect to. The dedicated database group limits peers by group membership. A VPC or subnet CIDR allows an address range; it does not filter by membership in the database group.

**Watch out：** Enter a security group ID here. An EC2 instance ID cannot be used as a security-group rule source or destination.

## 5．安全组与网络ACL：按组放行 / Group-based sources · Rare

**问：** 同VPC里，数据库要按“Web这组服务器”限定访问来源。应该用数据库的安全组，还是数据库子网的网络ACL来引用Web安全组ID？为什么？

**答：** 使用数据库的安全组，把Web专用安全组ID设为入站来源。

**考点：** 安全组规则可以引用另一个安全组。网络ACL的来源字段填写IP地址范围（CIDR），不能直接填安全组ID。

**Question：** Within one VPC, a database must limit sources to the set of web servers. Should you use the database’s security group or its subnet’s network ACL to reference the Web security group ID? Why?

**Answer：** Use the database’s security group and set the inbound source to Web’s dedicated security group ID.

**Key point：** A security-group rule can reference another security group. A network ACL’s source field takes an IP address range (CIDR), not a security group ID.


## 原题支撑

| 原题 | 当前判题支撑 | 尚未闭合的必要差异 |
| --- | --- | --- |
| Q55 | 部分 | C的接收方与允许来源配置有支撑，B的Deny语义也能排除；A的内部路由限制及D的peering对象/作用未由当前正文建立，保留唯一判题缺口。 |
| Q254 | 充分 | 无已确认的必要判题缺口 |
| Q282 | 充分 | 无已确认的必要判题缺口 |
| Q385 | 充分 | 无已确认的必要判题缺口 |
| Q406 | 充分 | 无已确认的必要判题缺口 |

这是当前卡文的设计支撑，不是学习者已经记住或实际做对的证据。Q55保留部分状态，下一组处理网络路径与访问许可的区别时闭合；不把这个缺口塞入现有卡片。

核查：5张逐卡七项检查、2项条件迁移通过；Q254仅定向补充出站卡解释并复核1张，其余4张沿用有效凭证。真实Linter和解析器导入回读通过。

[Deck Markdown](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch01-20261104/deliverables/cards.deck.md) · [双语JSON](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch01-20261104/deliverables/cards.json) · [逐题支撑](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch01-20261104/question-support.current.json)

全程约19.2分钟，平均3.8分钟/张；首次稿约6.2分钟。计时含源格式适配失败及修正、写作、审查等待、定向补充、导出和引用快照刷新，尚未达到1分钟/张。新CLI作者调用0，native token未知。
