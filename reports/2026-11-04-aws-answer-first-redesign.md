# 从正确方案反推：安全组教学小试验

状态：方法试验稿，尚未接受为正式卡片。复用已核验的原题和官方依据；只重新表述这5题的正确方案理由，不重提全库。

## 先看正确方案为什么成立

| 原题 | 决定条件 | 正确方案及原因 | 共用卡 |
| --- | --- | --- | --- |
| Q55 | 只有私有子网里的应用EC2可以访问RDS。 | C：让RDS这一接收方只允许应用EC2专用安全组的来源。 | A＋B |
| Q254 | 三层应用的入站和出站都要求最小权限。 | B：用对端专用安全组ID表达相应应用层，再限制必需协议和端口。 | A |
| Q282 | EC2只接受ALB的连接，其他子网内外来源都不允许。 | B：在EC2接收端只允许ALB专用安全组，并检查其他关联组不再允许其他来源。 | A＋B |
| Q385 | 负载均衡器到Web，再由Web到MySQL，各层最小权限。 | C：Web的443只允许负载均衡器组，MySQL的3306只允许Web组。 | A＋B |
| Q406 | 访客能访问网站443，但数据库3306只给Web访问。 | C＋D：网站允许任意IPv4来源，数据库只允许Web专用安全组。 | A＋B＋C |

A教主要判断，B解释“只允许”的真实边界，C处理公开网站与内部数据库的访问者区别。两跳应用用练习检查，不再为重复应用另加一张必背卡。

## 卡A · Rare

**问：** 数据库只允许Web服务器访问，同一子网还有其他业务服务器。在同VPC直接通信的前提下，应该在谁的安全组里允许谁，为什么不能直接允许整个子网？

**答：** 在数据库的安全组里，把允许来源设为Web服务器的专用安全组。

**考点：** 安全组规定资源允许哪些网络连接。数据库是接收方；只关联Web服务器的组，代表这批允许访问的服务器。整个子网还包含其他业务服务器，范围更大。

**易错提醒：** 数据库关联的其他安全组若仍允许别的来源，也要一起修改；新增窄规则不会取消那些允许。

**Question：** A database must be accessible only to web servers, but their subnet also contains servers for other workloads. Assuming direct communication within one VPC, whose security group should allow which source, and why is allowing the entire subnet insufficient?

**Answer：** In the database’s security group, set the allowed source to the web servers’ dedicated security group.

**Key point：** A security group specifies which network connections a resource allows. The database is the receiver. A group associated only with the web servers identifies this set of permitted servers; the entire subnet also includes other workload servers and is broader.

**Watch out：** If another security group attached to the database still allows other sources, change those rules too. Adding a narrow rule does not cancel those permissions.

## 卡B · Rare

**问：** EC2同时关联两个安全组：一个只允许负载均衡器发起连接，另一个允许所有来源。现在EC2的安全组能挡住其他来源的新连接吗，为什么？

**答：** 不能。另一个安全组仍允许其他来源。

**考点：** 多个安全组的允许规则一起生效。只要某个组仍允许这些来源，它们就能通过安全组检查；另一个组更严格，不会取消这项允许。

**Question：** EC2 has two attached security groups: one allows connections only from the load balancer, while the other allows all sources. Do its security groups now block new connections from other sources? Why?

**Answer：** No. The other security group still allows those sources.

**Key point：** Allow rules from attached security groups work together. If one group still allows those sources, they can pass the security-group check; stricter rules in another group do not cancel that permission.

## 卡C · Rare

**问：** Web服务器要让任意IPv4访客访问HTTPS（TCP 443），数据库只供Web访问（TCP 3306）。两者同VPC直接通信、各用专用安全组。它们的入站来源应该分别允许谁，为什么？

**答：** Web的443入口允许0.0.0.0/0；数据库的3306入口只允许Web服务器的安全组。

**考点：** 0.0.0.0/0表示所有IPv4地址，符合网站让任意访客访问的要求。数据库的访问者则只有Web服务器，所以按Web这批服务器放行。

**Question：** Web servers must accept HTTPS on TCP 443 from any IPv4 visitor; a database is for Web only on TCP 3306. They communicate directly within one VPC and use dedicated security groups. Which inbound source should each allow, and why?

**Answer：** Allow 0.0.0.0/0 at Web’s port-443 entry. At the database’s port-3306 entry, allow only the web servers’ security group.

**Key point：** 0.0.0.0/0 means all IPv4 addresses, matching a website open to any visitor. The database’s callers are only the web servers, so access is limited to that set of servers.

## 两个迁移练习

先不看卡，尝试回答；它们检查能否应用判断。

P1：把卡A的数据库换成EC2，Web服务器换成负责转发请求的ALB，应该修改谁的安全组，允许谁？

<details><summary>参考答案</summary>

EC2入站允许ALB专用安全组；其他关联组不得允许其他来源。

</details>

P2：负载均衡器→Web（TCP443）→MySQL（TCP3306）。角色安全组专用、同VPC直接通信，其他规则已符合要求。Web和数据库分别允许谁？

<details><summary>参考答案</summary>

Web443来源负载均衡器组；数据库3306来源Web组。

</details>

## 支撑范围

以下是本次明确保留的边界，不能因为正确方案能被解释就自动宣布整题充分。

- Q55：只解释正确来源配置；路由、子网peering选项边界未在卡中教学。
- Q254：A只教入站示例；出站目的地及instance ID不属于可用字段尚未教，不计充分。
- Q282：不声称路由或公网地址相关背景已教。
- Q385：卡中不另背两跳答案；NACL不能引用SG来源尚未教，不计完整方案辨析。
- Q406：只核当前必要选型，ACL分支未单独教学。

独立核查结果：3张试验卡的事实、双语及教学设计检查通过，两道迁移练习可以据卡回答；学习者是否理解、记住及做对原题尚未验证。

补充辨析边界：当前卡文未明确教“安全组不能写Deny”，Q55/Q406的相关选项辨析仍不抵扣；Q254的出站和instance ID字段、Q385的NACL来源表达等缺口也保留。

用时：3张双语初稿约4.3分钟；含独立核查及保存约8.6分钟。本轮是无UID方法试验，未做正式Deck封装与导入，不用此时间冒充生产吞吐。新CLI调用0，native token未知。
