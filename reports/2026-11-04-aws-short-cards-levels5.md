# 五张短卡试读：Easy、Rare、Legend

状态：已生成5张双语教学小样，独立审查及局部复核已通过；学习者效果待测试。无正式UID，正式接受卡数仍15。

本轮沿用上一组的“决定条件→选择→原因”标准。五张都归领域1：安全架构／任务1.2：设计安全工作负载与应用；Easy、Rare、Legend另表示回忆任务，不替代考试领域分类。共享卡只存一份，其他领域需要时引用。

| 小样 | 层级 | 学什么 | 本组先修 |
| --- | --- | --- | --- |
| C3 | Easy | 已允许连接为什么能自动回包 | — |
| C4 | Easy | 多个安全组的允许规则怎样合并 | — |
| C5 | Rare | 如何仅允许指定应用访问数据库 | C4 |
| C6 | Rare | 如何在ALB入口临时封禁恶意IP | — |
| C7 | Legend | 把直接上游限制应用到两跳链路 | C4、C5 |

Easy要求解释机制；Rare要求根据实际条件作判断；Legend只组合少量已学动作，不增加完整部署清单。

## C3．Easy｜安全组如何处理回包

**问：** Web服务器已通过安全组允许客户端的HTTPS连接。为什么响应不需要再单独加一条安全组出站放行规则？

**答：** 安全组会自动允许已放行连接的响应流量。

**考点：** 安全组有状态：它记录已允许的连接，因此能识别对应的回包。

**易错提醒：** 这不允许服务器任意新建对外连接；新连接仍需相应的出站许可。

**Question:** A web server security group already allows a client HTTPS connection. Why does the response not require a separate outbound security-group allow rule?

**Answer:** Security groups automatically allow response traffic for an allowed connection.

**Key point:** Security groups are stateful: they track allowed connections and can therefore recognize their response traffic.

**Watch out:** This does not permit arbitrary new outbound connections from the server; those still need an applicable outbound allow rule.

依据：[AWS 1](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html)

## C4．Easy｜多个安全组的许可如何合并

**问：** EC2关联两个安全组。同一端口，一个只允许Web实例，另一个允许整个子网。来自该子网其他实例的新连接，会被更窄的规则挡住吗？

**答：** 不会。两个组的允许规则会合并；任一组允许，就通过安全组这一关。

**考点：** 更窄的规则不会撤销另一个组的许可，因此收紧访问必须检查所有关联安全组。

**Question:** An EC2 instance has two security groups. For the same port, one allows only web instances and the other allows the whole subnet. Does the narrower rule block a new connection from another instance in that subnet?

**Answer:** No. The allow rules are combined; an allow in either group passes the security-group check.

**Key point:** A narrower rule does not revoke another group's allowance, so restricting access requires checking every associated security group.

依据：[AWS 1](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html)

## C5．Rare｜仅允许指定应用访问数据库

**问：** 同一VPC内，Web实例的IP会变化。数据库的3306端口只能接受这些Web实例的连接，应怎样设置数据库的入站来源？

**答：** 以Web专用安全组作为来源，仅允许TCP 3306。

**考点：** 许可跟随关联这个安全组的Web实例，无需逐个维护它们的IP地址。

**易错提醒：** 该组不能混入无关实例；数据库其他关联组也不能保留更宽的3306许可。

**Question:** Within one VPC, web-instance IP addresses can change. The database must accept connections on port 3306 only from these web instances. What source should its inbound rule use?

**Answer:** Use a web-only security group as the source and allow only TCP 3306.

**Key point:** The allowance follows web instances associated with that security group, without maintaining each instance IP address individually.

**Watch out:** Keep unrelated instances out of the source group, and remove broader port-3306 allowances from every other security group associated with the database.

依据：[AWS 1](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html) · [AWS 2](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)

## C6．Rare｜在入口封禁恶意IP

**问：** ALB位于公有子网，后端EC2在私有子网。若用安全组或网络ACL临时封禁几个已知恶意来源IP，应在哪设置什么规则？

**答：** 在ALB所在公有子网的网络ACL中，添加这些来源IP的入站Deny规则。

**考点：** 在请求进入ALB前按来源IP拦截；安全组只有Allow规则，网络ACL才支持显式Deny。

**易错提醒：** Deny的规则号要小于会放行这些IP的Allow规则号，确保先匹配到拒绝。

**Question:** An ALB is in public subnets, with backend EC2 instances in private subnets. Using security groups or network ACLs, where should you temporarily block a few known malicious source IP addresses, and with what rule?

**Answer:** Add inbound Deny rules for those source IP addresses to the network ACLs of the public subnets containing the ALB.

**Key point:** Block by source IP before requests reach the ALB. Security groups have only Allow rules, whereas network ACLs support explicit Deny rules.

**Watch out:** Use a lower rule number for Deny than for an Allow that would permit those IP addresses, so the Deny matches first.

依据：[AWS 1](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html) · [AWS 2](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html)

## C7．Legend｜逐层只允许直接上游

**问：** 同一VPC中，ALB以HTTPS（TCP 443）访问Web，Web用TCP 3306访问MySQL。公网入口及其余网络条件已满足。如何让这两条业务连接只接受直接上游？

**答：** Web的443入站只允许ALB专用安全组；数据库的3306入站只允许Web专用安全组。

**考点：** 每一跳都在接收端限定上游身份，避免同子网其他机器绕过上一层直接访问。

**易错提醒：** 检查两层全部关联安全组，移除相应端口的其他来源许可；新增窄规则不会覆盖旧的宽规则。

**Question:** In one VPC, an ALB connects to web servers over HTTPS on TCP port 443, and the web servers access MySQL on TCP port 3306. Public ingress and all other network conditions are satisfied. How should these two business connections be restricted to their immediate upstream tier?

**Answer:** Allow inbound port 443 to the web tier only from an ALB-only security group, and inbound port 3306 to the database only from a web-only security group.

**Key point:** Each receiving tier restricts the upstream identity, preventing other machines in the same subnet from bypassing the preceding tier.

**Watch out:** Check every security group associated with both tiers and remove other source allowances on those ports; adding a narrow rule does not override an existing broad rule.

依据：[AWS 1](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html) · [AWS 2](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html) · [AWS 3](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html)

## 对做题的帮助

| 卡片 | 关联题 | 本轮支撑边界 |
| --- | --- | --- |
| C3 | Q74、Q406、Q884 | 帮助区分回包与新连接；单卡不解完整综合题 |
| C4 | Q55、Q282 | 帮助检查宽泛许可是否仍存在；属于先修或部分判断 |
| C5 | Q55、Q254；另关联Q282、Q385、Q406、Q884 | 前两题可用该来源规则选择方案；其他题只覆盖相关一跳或一个判断 |
| C6 | Q509 | 对应入口子网ACL封禁已知IP的判断 |
| C7 | Q385；另关联Q884 | 完成前者的两跳规则选择；后者有更多层次，保留部分支撑 |

上述是当前卡文与完整原题的设计核对，不代表你已学会，亦不计入正式0/50题卡覆盖。8道来源题中，Q55/Q254/Q385/Q509用于本组方案选择核对，其余保留部分支撑。原题完整题干、选项、条件和待核事项均留在私有输入，未改写原题以凑覆盖。

前两张试读卡C1/C2继续保留，本轮新增样例用C3—C7编号。没有重新提取既有考点，也没有把旧347卡或已退回10卡正文当知识源。C3的自动回包仅说明安全组这一关；C6是具体IP的临时入口阻断，不宣称完整DDoS防护。

可以先只读中文；英文与中文保留相同条件。闭卡后先解释各张的原因，再尝试C7。实际理解、作答和隔日记忆仍待试读。

本轮为小样制作，无正式UID或Deck导入；无发布、OTA、自动化恢复。当前原生作者与独立审查token用量unknown，作者CLI调用0，历史预算与修复计数不重置。计时从首轮索引读取后的阶段初始化起，之前首次读取未计入，不称完整会话总耗时。
