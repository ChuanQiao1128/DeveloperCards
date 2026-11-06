# 领域1正式卡片：安全组首批5张

> **最新用户反馈：这5张晦涩难懂，教学可用性退回校准。** 下方独立核验、导入和题目支撑结果保留为历史，不代表学习者已经学会或能够做对题。当前新增接受0张。

状态：5张全部通过独立知识／教学核验及真实导入回读。分类：领域1 · 任务1.2；1 Easy、3 Rare、1 Legend。尚未发布。

# 5张AWS双语卡片

## 1．安全组：连接方向 / Security group direction · Easy

**问：** Web服务器主动向数据库发起TCP 3306连接。检查这次新请求时，Web和数据库各自的安全组应看入站还是出站规则？

**答：** Web看出站规则；数据库看入站规则。

**考点：** 入站、出站以规则所属资源为参照：同一请求离开Web、进入数据库。因此Web侧检查数据库目的地，数据库侧检查Web来源，协议和端口对应这次请求。

**Question：** A web server initiates a TCP connection to a database on port 3306. For this new request, should you check inbound or outbound rules in each resource’s security group?

**Answer：** Check outbound rules for the web server and inbound rules for the database.

**Key point：** Direction is relative to the resource whose rules you are checking: the same request leaves the web server and enters the database. The web side checks the database destination; the database side checks the web source, using the protocol and port for this request.

## 2．安全组：按应用角色授权 / Application role boundaries · Rare

**问：** 同VPC内直接通信的三层应用，只应放行各层必需的业务连接，各角色使用专用安全组。设置入站来源和出站目的地时，应引用对端安全组，还是放行整个VPC或子网？为什么？

**答：** 引用对端的专用安全组，并限定所需协议和端口。

**考点：** 组引用按对端组关联的网络接口私有地址匹配，表达“允许哪个应用角色”；整个VPC或子网只表达地址范围，可能包含其他角色。

**易错提醒：** 专用组必须只关联允许通信的角色；组名本身不会限制成员。

**Question：** A three-tier application communicates directly within one VPC. Each role has a dedicated security group, and only required connections between tiers should be allowed. For inbound sources and outbound destinations, should you reference the peer security group or allow the entire VPC or subnet? Why?

**Answer：** Reference the peer’s dedicated security group and restrict the protocol and ports to those required.

**Key point：** A group reference matches private addresses of network interfaces associated with that group, expressing which application role is allowed. An entire VPC or subnet specifies an address range that may include other roles.

**Watch out：** A dedicated group must be associated only with the roles allowed to communicate; its name does not restrict its membership.

## 3．安全组：只允许与规则叠加 / Combined allow rules · Rare

**问：** 目标EC2只应接受应用负载均衡器（ALB）发起的新入站连接。已添加ALB专用安全组来源规则，但EC2的另一个安全组仍允许其他来源。这样已经满足“只允许ALB”了吗，为什么？

**答：** 没有。还须检查所有关联安全组的入站规则，收窄或移除允许其他来源的许可。

**考点：** 安全组只有Allow规则，多个关联组的许可合并生效。新增窄规则不会覆盖另一个组仍保留的宽许可。

**Question：** An EC2 target should accept new inbound connections only from an Application Load Balancer (ALB). You added a rule whose source is the ALB’s dedicated security group, but another group attached to EC2 still allows other sources. Is the ALB-only requirement satisfied? Why?

**Answer：** No. Check inbound rules in every attached security group and narrow or remove permissions that allow other sources.

**Key point：** Security groups have allow rules only, and permissions from attached groups are combined. Adding a narrow rule does not override a broader permission retained in another group.

## 4．安全组：公网入口与后端入口 / Public and backend entry · Rare

**问：** Web服务器直接向任意IPv4互联网客户端提供HTTPS（TCP 443），数据库只供这些Web服务器访问。两者在同VPC内直接通信，各角色安全组专用，其他相关入站许可已收口。Web的443入站应允许什么来源？数据库能照抄吗？

**答：** Web的TCP 443入站允许0.0.0.0/0；数据库不能照抄，应只允许Web专用安全组访问所需数据库端口。

**考点：** 来源由直接上游决定：Web面对任意IPv4客户端，0.0.0.0/0涵盖所有IPv4地址；数据库面对的是Web服务器这个应用角色。

**Question：** Web servers directly provide HTTPS on TCP 443 to any IPv4 internet client. A database is for these web servers only. The roles communicate directly within one VPC, their security groups are dedicated, and other relevant inbound permissions have been restricted. What source should Web’s port-443 inbound rule allow? Can the database copy it?

**Answer：** Allow 0.0.0.0/0 for Web’s TCP 443 inbound rule. The database must instead allow only the web servers’ dedicated security group on the required database port.

**Key point：** The source follows the immediate upstream caller: Web serves any IPv4 client, and 0.0.0.0/0 covers all IPv4 addresses; the database serves the web-server role.

## 5．安全组：两跳最小权限 / Two-hop access · Legend

**问：** 同VPC内，负载均衡器以TCP 443连接Web，Web以TCP 3306连接MySQL。三者各用专用安全组并直接通信；路由、出站已满足，其他入站许可已收口。为仅接收各自上游的业务请求，Web和数据库入站分别怎样设置？

**答：** Web：TCP 443，来源为负载均衡器安全组。
数据库：TCP 3306，来源为Web安全组。

**考点：** 沿连接链逐跳看接收端：Web的直接上游是负载均衡器，数据库的直接上游是Web。每层只放行这一跳所需的来源和端口。

**Question：** Within one VPC, a load balancer connects to Web on TCP 443, and Web connects to MySQL on TCP 3306. Each role has a dedicated security group and communicates directly with the next role. Routing and outbound permissions are satisfied, and other inbound permissions have been restricted. How should Web and the database allow only their respective upstream callers?

**Answer：** Web: allow TCP 443 from the load balancer’s security group.
Database: allow TCP 3306 from Web’s security group.

**Key point：** Follow each hop to its receiver: Web’s immediate upstream caller is the load balancer; the database’s is Web. Each tier allows only the source and port required for that hop.


## 原题支撑与边界

这是当前卡面能否解释必要判题的核查，学习者记忆和实际正确率尚未测试。

| 原题 | 当前结果 | 已知边界／缺口 |
| --- | --- | --- |
| Q55 | 部分支撑 | 已能解释允许私有EC2组的数据库入口配置；但路由候选与同VPC子网peering的作用边界未教，未验唯一方案比较。 |
| Q254 | 部分支撑 | 只缺instance ID与安全组引用在规则字段中的可表达性区别；无需扩成完整参数清单。 |
| Q282 | 必要选型支撑充分 | 原j2的可达性技术对照未教，仅保留为未覆盖范围；当前四个候选的必要来源限制已可从卡文解释。 |
| Q385 | 部分支撑 | 需补闭合NACL能否表达安全组来源这一实际竞争边界；不需要学习NACL完整部署。 |
| Q406 | 必要选型支撑充分 | 无已确认的必要选型缺口；不代表完整部署已验证。 |

原9项判断逐项已登记：4项充分、5项部分；完整条件保留在私有映射。没有因卡片事实通过而自动提高原题覆盖。

复核：逐卡FACT/B1/U1/R1/T1/S1/P1通过；必要单条件迁移通过。1项超问评分缺陷已修正，正文未改，其他有效结果沿用。Linter：5卡、0问题、0警告；真实解析器回读：5卡通过。

[Deck Markdown导入文件](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-sg-cards-production-20261104/deliverables/cards.deck.md) · [双语JSON](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-sg-cards-production-20261104/deliverables/cards.json) · [真实解析回读JSON](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-sg-cards-production-20261104/deliverables/cards.import.json) · [原题支撑原件](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-sg-cards-production-20261104/question-support.json)

本批端到端用时：约19.6分钟，平均3.9分钟/张；包括素材适配、双语写作、独立核查、1次评分修正、导出与回读，尚未达到1分钟/张。双语稿首次保存前约6.3分钟；其后核查、修正及封装约13.3分钟。原生token未知，本批作者CLI调用0；历史用量保持。
